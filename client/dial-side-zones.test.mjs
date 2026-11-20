import assert from 'node:assert/strict';
import test from 'node:test';
import { dialSideZones, bindDialSideTaps } from './dial-side-zones.js';

test('curved zones keep the measured dial unchanged and fill only its outside side space', () => {
  const circle = Object.freeze({ left: 18, top: 200, width: 284, height: 284 });
  const zones = dialSideZones(circle, { left: 0, right: 320 });
  assert.deepEqual([zones.minus.left, zones.minus.top, zones.minus.width, zones.minus.height], [0, 200, 160, 284]);
  assert.deepEqual([zones.plus.left, zones.plus.top, zones.plus.width, zones.plus.height], [160, 200, 160, 284]);
  // The arc is a circle six pixels outside the existing artwork, not a rectangle over it.
  const leftArc = zones.minus.path.match(/A ([\d.]+) ([\d.]+) 0 0 0 ([\d.-]+) ([\d.]+)/);
  assert.ok(leftArc);
  assert.equal(Number(leftArc[1]), 148);
  assert.equal(Number(leftArc[2]), 148);
  assert.ok(Math.abs((160 - Number(leftArc[3])) ** 2 + 142 ** 2 - 148 ** 2) < .001);
  assert.equal(Number(leftArc[4]), 284);
  assert.match(zones.plus.path, /A 148 148 0 0 1 /);
});

test('zones follow viewport safe bounds and dynamically sized or offset circles', () => {
  for (const [width, diameter] of [[320, 220], [390, 354], [720, 400]]) {
    const circle = { left: (width - diameter) / 2 + 4, top: 123, width: diameter, height: diameter };
    const zones = dialSideZones(circle, { left: 8, right: width - 12 });
    assert.equal(zones.minus.left, 8);
    assert.equal(zones.plus.left + zones.plus.width, width - 12);
    for (const zone of Object.values(zones)) {
      assert.equal(zone.top, circle.top);
      assert.equal(zone.height, diameter);
      assert.ok(zone.width > 0);
    }
  }
});

test('upper lobes retain a real 44px tap square independently of the symbol positions', () => {
  for (const width of [320, 390]) {
    const diameter = width - 36, radius = diameter / 2;
    const circle = { left: 18, top: 200, width: diameter, height: diameter };
    const zones = dialSideZones(circle, { left: 0, right: width });
    for (const [side, zone] of Object.entries(zones)) {
      const tapCenterX = side === 'minus' ? 22 : width - 22;
      const tapCenterY = circle.top + 22;
      for (const x of [tapCenterX - 22, tapCenterX + 22]) {
        for (const y of [tapCenterY - 22, tapCenterY + 22]) {
          assert.ok(x >= 0 && x <= width && y >= circle.top && y <= circle.top + diameter);
          assert.ok(Math.hypot(x - width / 2, y - circle.top - radius) >= radius + 6 - 1e-8);
        }
      }
    }
  }
});

test('symbols sit at dial mid-height and halfway from its actual edge to each safe screen edge', () => {
  for (const [width, diameter, safeLeft, safeRight] of [[320, 284, 0, 320], [390, 354, 0, 390], [720, 400, 8, 708]]) {
    const circle = { left: (width - diameter) / 2, top: 123, width: diameter, height: diameter };
    const zones = dialSideZones(circle, { left: safeLeft, right: safeRight });
    assert.equal(zones.minus.left + zones.minus.labelX, (safeLeft + circle.left) / 2);
    assert.equal(zones.plus.left + zones.plus.labelX, (circle.left + diameter + safeRight) / 2);
    for (const zone of Object.values(zones)) assert.equal(zone.top + zone.labelY, circle.top + diameter / 2);
    assert.equal(zones.minus.gapWidth, circle.left - safeLeft);
    assert.equal(zones.plus.gapWidth, safeRight - circle.left - diameter);
  }
});

function tapFixture() {
  const handlers = new Map(), scrolling = new Map(), changes = [];
  const target = registry => ({ addEventListener(type, handler) { registry.set(type, handler); },
    removeEventListener(type) { registry.delete(type); } });
  const minus = { disabled: false, dataset: { delta: '-1' }, closest() { return this; } };
  const plus = { disabled: false, dataset: { delta: '1' }, closest() { return this; } };
  let hit = plus, captured = false;
  plus.setPointerCapture = minus.setPointerCapture = () => { captured = true; };
  const controls = target(handlers);
  const cleanup = bindDialSideTaps(controls, delta => changes.push(delta), {
    hitTest: () => hit, scrollTarget: target(scrolling),
  });
  const fire = (type, properties = {}) => handlers.get(type)?.({
    pointerId: 1, isPrimary: true, button: 0, clientX: 30, clientY: 220,
    target: plus, preventDefault() {}, ...properties,
  });
  return { fire, minus, plus, changes, cleanup, handlers, hit(value) { hit = value; }, scroll() { scrolling.get('scroll')?.(); },
    releaseOutside() { hit = null; if (captured) fire('pointerup', { clientY: 500 }); captured = false; } };
}

test('one released tap makes one step and its subsequent synthetic click makes none', () => {
  const fixture = tapFixture();
  fixture.fire('pointerdown'); fixture.fire('pointerup'); fixture.fire('click', { detail: 1 });
  assert.deepEqual(fixture.changes, [1]);
  fixture.hit(fixture.minus);
  fixture.fire('pointerdown', { target: fixture.minus }); fixture.fire('pointerup', { target: fixture.minus });
  assert.deepEqual(fixture.changes, [1, -1]);
});

test('movement, cancellation, scrolling, wrong region and unmatched release never step', () => {
  for (const interrupt of [
    fixture => fixture.fire('pointermove', { clientY: 229 }),
    fixture => fixture.fire('pointercancel'),
    fixture => fixture.fire('lostpointercapture'),
    fixture => fixture.scroll(),
    fixture => fixture.hit(fixture.minus),
    fixture => fixture.fire('pointerdown', { pointerId: 2, isPrimary: false }),
    fixture => { fixture.plus.disabled = true; },
  ]) {
    const fixture = tapFixture(); fixture.fire('pointerdown'); interrupt(fixture); fixture.fire('pointerup');
    fixture.fire('click', { detail: 1 });
    assert.deepEqual(fixture.changes, []);
  }
  const fixture = tapFixture();
  fixture.fire('pointerup'); // A drag originating in the circle must not become a side tap.
  fixture.fire('pointerdown'); fixture.fire('pointerup', { pointerId: 2 });
  assert.deepEqual(fixture.changes, []);
});

test('release movement is checked even if no move event arrived', () => {
  const fixture = tapFixture(); fixture.fire('pointerdown'); fixture.fire('pointerup', { clientX: 39 });
  assert.deepEqual(fixture.changes, []);
});

test('a non-primary pointer, secondary mouse button or circle drag cannot start a side tap', () => {
  for (const properties of [{ isPrimary: false }, { button: 2 }, { target: { closest: () => null } }]) {
    const fixture = tapFixture(); fixture.fire('pointerdown', properties); fixture.fire('pointerup');
    assert.deepEqual(fixture.changes, []);
  }
});

test('releasing a mouse outside the dial cannot leave a stale start that swallows the next tap', () => {
  const fixture = tapFixture(); fixture.fire('pointerdown'); fixture.releaseOutside();
  fixture.hit(fixture.plus); fixture.fire('pointerdown'); fixture.fire('pointerup');
  assert.deepEqual(fixture.changes, [1]);
});

test('native keyboard activation steps once, respects disabled state, and cleans up listeners', () => {
  const fixture = tapFixture(); fixture.fire('click', { detail: 0 });
  assert.deepEqual(fixture.changes, [1]);
  fixture.plus.disabled = true; fixture.fire('click', { detail: 0 });
  assert.deepEqual(fixture.changes, [1]);
  fixture.cleanup(); assert.equal(fixture.handlers.size, 0);
});
