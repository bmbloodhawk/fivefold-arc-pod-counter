import assert from 'node:assert/strict';
import test from 'node:test';
import { bindDialTouchGuard } from './dial-touch-guard.js';

class Surface extends EventTarget {
  disabled = false;
  registrations = [];
  getAttribute(name) { return name === 'aria-disabled' ? String(this.disabled) : null; }
  addEventListener(type, handler, options) {
    this.registrations.push({ type, options });
    super.addEventListener(type, handler, options);
  }
  touch(type, identifiers, { cancelable = true } = {}) {
    const event = new Event(type, { cancelable });
    Object.assign(event, { touches: identifiers.map(identifier => ({ identifier, target: this })) });
    this.dispatchEvent(event);
    return event;
  }
}

test('rotary touch listeners are non-passive and already installed before input begins', () => {
  const surface = new Surface(); bindDialTouchGuard(surface);
  for (const type of ['touchstart', 'touchmove']) {
    assert.deepEqual(surface.registrations.find(item => item.type === type)?.options, { passive: false });
  }
});

test('the original enabled single touch cancels native scrolling at start and move', () => {
  const surface = new Surface(); bindDialTouchGuard(surface);
  assert.equal(surface.touch('touchstart', [7]).defaultPrevented, true);
  assert.equal(surface.touch('touchmove', [7]).defaultPrevented, true);
});

test('a move without an original dial start is never adopted or cancelled', () => {
  const surface = new Surface(); bindDialTouchGuard(surface);
  assert.equal(surface.touch('touchmove', [7]).defaultPrevented, false);
  const outside = new Surface();
  assert.equal(outside.touch('touchstart', [7]).defaultPrevented, false);
  assert.equal(surface.touch('touchmove', [7]).defaultPrevented, false);
});

test('end and cancellation release the original touch until a fresh start', () => {
  for (const ending of ['touchend', 'touchcancel']) {
    const surface = new Surface(); bindDialTouchGuard(surface);
    surface.touch('touchstart', [7]); surface.touch(ending, []);
    assert.equal(surface.touch('touchmove', [7]).defaultPrevented, false);
    assert.equal(surface.touch('touchstart', [8]).defaultPrevented, true);
  }
});

test('multiple touches clear ownership without adopting the remaining finger later', () => {
  const surface = new Surface(); bindDialTouchGuard(surface);
  surface.touch('touchstart', [7]);
  assert.equal(surface.touch('touchstart', [7, 8]).defaultPrevented, false);
  assert.equal(surface.touch('touchmove', [7]).defaultPrevented, false);
  surface.touch('touchstart', [9]);
  assert.equal(surface.touch('touchmove', [9, 10]).defaultPrevented, false);
  assert.equal(surface.touch('touchmove', [9]).defaultPrevented, false);
});

test('inspection or disabled controls never claim a touch and disablement clears an active one', () => {
  const surface = new Surface(); surface.disabled = true; bindDialTouchGuard(surface);
  assert.equal(surface.touch('touchstart', [7]).defaultPrevented, false);
  surface.disabled = false;
  assert.equal(surface.touch('touchmove', [7]).defaultPrevented, false);
  surface.touch('touchstart', [8]); surface.disabled = true;
  assert.equal(surface.touch('touchmove', [8]).defaultPrevented, false);
  surface.disabled = false;
  assert.equal(surface.touch('touchmove', [8]).defaultPrevented, false);
});

test('a different touch identifier cancels ownership instead of inheriting the gesture', () => {
  const surface = new Surface(); bindDialTouchGuard(surface);
  surface.touch('touchstart', [7]);
  assert.equal(surface.touch('touchmove', [8]).defaultPrevented, false);
  assert.equal(surface.touch('touchmove', [7]).defaultPrevented, false);
});

test('non-cancelable events are safe and disposing the guard removes cancellation', () => {
  const surface = new Surface(); const dispose = bindDialTouchGuard(surface);
  assert.equal(surface.touch('touchstart', [7], { cancelable: false }).defaultPrevented, false);
  assert.equal(surface.touch('touchmove', [7], { cancelable: false }).defaultPrevented, false);
  dispose();
  assert.equal(surface.touch('touchstart', [8]).defaultPrevented, false);
  assert.equal(surface.touch('touchmove', [7]).defaultPrevented, false);
});
