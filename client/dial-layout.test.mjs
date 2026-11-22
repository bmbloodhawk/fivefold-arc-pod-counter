import assert from 'node:assert/strict';
import test from 'node:test';
import { glyphCenterCorrection, buttonTextRegion, centeredButtonCircle, fitReadoutBounds, inkFitScale, createDialLayout } from './dial-layout.js';

test('an authored readout scale and offset retain their center inside the same protected gap', () => {
  const bounds = fitReadoutBounds({ width: 166, height: 226 }, 14, -14, 1.4);
  assert.ok(Math.abs(bounds.width * 1.4 / 2 + 14 - 83) < 1e-8);
  assert.ok(Math.abs(bounds.height * 1.4 / 2 + 14 - 113) < 1e-8);
});

test('Button readout uses the clear region even when artwork extends behind cards and controls', () => {
  const art = { top: 200, bottom: 390, left: 65, right: 255, width: 190 };
  const cards = [{ top: 225, bottom: 280, left: 12, right: 81 },
    { top: 286, bottom: 341, left: 239, right: 308 }];
  assert.deepEqual(buttonTextRegion(art, cards, 330), { width: 150, height: 126 });
  assert.deepEqual(buttonTextRegion(art, [], 400), { width: 182, height: 190 });
});

test('Button circle uses the full corridor when centered text fits', () => {
  assert.deepEqual(centeredButtonCircle({ top: 200, bottom: 400, width: 180 }, 194, 18),
    { centerY: 300, diameter: 180, readoutHeight: 152 });
});

test('Button circle and readout share a center next to controls', () => {
  assert.deepEqual(centeredButtonCircle({ top: 200, bottom: 410, width: 284 }, 112, 18),
    { centerY: 262, diameter: 124, readoutHeight: 64 });
});

test('ink fitting protects wide totals and tall or enlarged skin fonts without enlarging text', () => {
  assert.equal(inkFitScale({ actualBoundingBoxLeft: 0, actualBoundingBoxRight: 220,
    actualBoundingBoxAscent: 90, actualBoundingBoxDescent: 10 }, 110, 50), .5);
  assert.equal(inkFitScale({ actualBoundingBoxLeft: 0, actualBoundingBoxRight: 50,
    actualBoundingBoxAscent: 20, actualBoundingBoxDescent: 0 }, 110, 50), 1);
});

test('visible digit ink is centered even when its advance width is asymmetric', () => {
  const correction = glyphCenterCorrection({ width: 60, actualBoundingBoxLeft: -8, actualBoundingBoxRight: 43,
    actualBoundingBoxAscent: 50, actualBoundingBoxDescent: 0 }, 50, 60);
  assert.equal((43 + 8) / 2 + correction.x, 30);
  assert.equal(50 - 25 + correction.y, 30);
});

test('descenders, negative values and wider totals retain the same intended center', () => {
  for (const metrics of [
    { width: 50, actualBoundingBoxLeft: -2, actualBoundingBoxRight: 48, actualBoundingBoxAscent: 48, actualBoundingBoxDescent: 12 },
    { width: 115, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 110, actualBoundingBoxAscent: 52, actualBoundingBoxDescent: 0 },
    { width: 200, actualBoundingBoxLeft: -3, actualBoundingBoxRight: 197, actualBoundingBoxAscent: 45, actualBoundingBoxDescent: 8 },
  ]) {
    const correction = glyphCenterCorrection(metrics, 54, 64);
    assert.equal((metrics.actualBoundingBoxRight - metrics.actualBoundingBoxLeft) / 2 + correction.x, metrics.width / 2);
    assert.equal(54 + (metrics.actualBoundingBoxDescent - metrics.actualBoundingBoxAscent) / 2 + correction.y, 32);
  }
});

function withDialLayout(run, { warningHeight = 0, visualViewport } = {}) {
  const savedGlobals = new Map(['document', 'getComputedStyle', 'requestAnimationFrame', 'ResizeObserver', 'visualViewport']
    .map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const style = () => {
    const properties = new Map();
    return { height: '', setProperty(name, value) { properties.set(name, value); },
      getPropertyValue: name => properties.get(name) || '', removeProperty(name) { properties.delete(name); } };
  };
  const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });
  const assembly = { style: style(), getBoundingClientRect: () => rect(0, (stage.getBoundingClientRect().height - 300) / 2, 300, 300) };
  const stage = { style: style(), getBoundingClientRect() {
    return rect(0, 0, 300, Math.max(300, parseFloat(this.style.getPropertyValue('--counter-caption-min-height')) || 0));
  } };
  const value = { value: '40', style: style(), append() {}, getBoundingClientRect() {
    const factor = Number(this.style.getPropertyValue('--dial-digit-factor')) || 1;
    const height = 60 / factor, shift = parseFloat(this.style.getPropertyValue('--dial-glyph-y')) || 0;
    return rect(110, stage.getBoundingClientRect().height / 2 - height / 2 + shift, 80 / factor, height);
  } };
  const context = { getBoundingClientRect() {
    return rect(75, readout.getBoundingClientRect().top + (parseFloat(readout.style.getPropertyValue('--counter-context-top')) || 231), 150, 14);
  } };
  const mode = { getBoundingClientRect: () => rect(100, assembly.getBoundingClientRect().top + 60, 100, 14) };
  const readout = { style: style(), getBoundingClientRect: () => assembly.getBoundingClientRect(),
    querySelector: selector => selector === '.counter-context' ? context : selector === '.counter-mode' ? mode : null };
  const feedback = [0, 1].map(index => ({ hidden: index > 0 || !warningHeight,
    getClientRects() { return this.hidden ? [] : [this.getBoundingClientRect()]; },
    getBoundingClientRect: () => rect(0, context.getBoundingClientRect().bottom + 2, 300, warningHeight),
  }));
  const control = { getClientRects() { return [this.getBoundingClientRect()]; },
    getBoundingClientRect: () => rect(0, stage.getBoundingClientRect().bottom, 300, 44) };
  const minus = { style: style() }, plus = { style: style() };
  const minusLabel = { style: style() }, plusLabel = { style: style() };
  const controls = { getBoundingClientRect: () => assembly.getBoundingClientRect() };
  const game = { hidden: false, dataset: { interfaceStyle: 'dial' },
    querySelector: selector => ({ '.counter-stage': stage, '.dial-assembly': assembly, '.counter-readout': readout,
      '#dialControls': controls, '.dial-step-minus': minus, '.dial-step-plus': plus,
      '.dial-step-minus-label': minusLabel, '.dial-step-plus-label': plusLabel })[selector],
    querySelectorAll: selector => selector === '#lifeChangeIndicator, #statusMessage' ? feedback
      : selector === '#turnActions, #sourcePanel, .commander-tax-quick' && warningHeight ? [control] : [] };
  let frame;
  const canvas = { font: '', measureText(text) {
    const scale = parseFloat(/([\d.]+)px/.exec(this.font)?.[1] || '100') / 100;
    const descender = text === '39';
    return { width: 80 * scale, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 80 * scale,
      actualBoundingBoxAscent: (descender ? 40 : 50) * scale, actualBoundingBoxDescent: (descender ? 10 : 0) * scale };
  } };
  const probe = { style: {}, setAttribute() {}, remove() {}, getBoundingClientRect() {
    const factor = Number(value.style.getPropertyValue('--dial-digit-factor')) || 1;
    return rect(0, value.getBoundingClientRect().top + 52 / factor, 0, 0);
  } };
  try {
    globalThis.document = { documentElement: { clientWidth: 320 }, createElement: tag => tag === 'canvas' ? { getContext: () => canvas } : probe,
      body: { classList: { toggle() {} } }, fonts: { ready: { then() {} }, addEventListener() {} } };
    globalThis.getComputedStyle = node => node === value
      ? { fontStyle: 'normal', fontWeight: '400', fontSize: `${100 / (Number(value.style.getPropertyValue('--dial-digit-factor')) || 1)}px`,
        fontFamily: 'Georgia', fontKerning: 'auto', letterSpacing: 'normal', height: `${60 / (Number(value.style.getPropertyValue('--dial-digit-factor')) || 1)}px`,
        getPropertyValue: name => value.style.getPropertyValue(name) }
      : { height: '300px', visibility: 'visible', minHeight: '18px',
        top: `${context.getBoundingClientRect().bottom + 2 - assembly.getBoundingClientRect().top}px` };
    globalThis.requestAnimationFrame = callback => { frame = callback; return 1; };
    globalThis.ResizeObserver = class { observe() {} };
    globalThis.visualViewport = visualViewport;
    const layout = createDialLayout(game, value);
    run({ value, readout, assembly, stage, feedback, control, minus, plus, minusLabel, plusLabel,
      update() { layout.update(); frame(); } });
  } finally {
    for (const [name, descriptor] of savedGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  }
}

test('changing digit shapes or digit count keeps the caption and feedback anchors stable', () => {
  withDialLayout(({ value, readout, assembly, update }) => {
    const samples = ['40', '39', '99', '100'].map(total => {
      value.value = total; update();
      return { total, caption: parseFloat(readout.style.getPropertyValue('--counter-context-top')),
        feedback: parseFloat(assembly.style.getPropertyValue('--counter-label-top')),
        glyph: parseFloat(value.style.getPropertyValue('--dial-glyph-y')) };
    });
    assert.notEqual(samples[0].glyph, samples[1].glyph, 'The fixture exercises distinct optical glyph corrections.');
    for (const sample of samples.slice(1)) {
      assert.ok(Math.abs(sample.caption - samples[0].caption) < 1e-6, `${sample.total} keeps the same caption anchor`);
      assert.ok(Math.abs(sample.feedback - samples[0].feedback) < 1e-6, `${sample.total} keeps the same feedback/fade anchor`);
    }
  });
});

test('a tall warning stays clear of the following action and keeps its space after expiry', () => {
  withDialLayout(({ stage, feedback, control, update }) => {
    const originalHeight = stage.getBoundingClientRect().height;
    update(); update();
    assert.ok(feedback[0].getBoundingClientRect().bottom + 8 <= control.getBoundingClientRect().top,
      'The warning clears the following action.');
    const reservedHeight = stage.getBoundingClientRect().height;
    assert.ok(reservedHeight > originalHeight, 'Dense feedback receives actual vertical space.');
    feedback[0].hidden = true; update();
    assert.equal(stage.getBoundingClientRect().height, reservedHeight, 'Expiring feedback does not move the counter back.');
  }, { warningHeight: 120 });
});

test('layout measures curved tap zones again after viewport changes without sizing the dial', () => {
  withDialLayout(({ assembly, minus, plus, update }) => {
    const original = assembly.getBoundingClientRect();
    update();
    assert.equal(minus.style.width, '150px');
    assert.equal(plus.style.width, '170px');
    assert.equal(minus.style.height, '300px');
    assert.match(minus.style.clipPath, /^path\("M /);
    document.documentElement.clientWidth = 390; update();
    assert.equal(plus.style.width, '240px');
    assert.deepEqual(assembly.getBoundingClientRect(), original);
  });
});

test('a stale wider visual viewport never extends side zones beyond the layout viewport', () => {
  withDialLayout(({ minus, plus, update }) => {
    update();
    assert.equal(minus.style.left, '0px');
    assert.equal(plus.style.left, '150px');
    assert.equal(plus.style.width, '170px');
  }, { visualViewport: { width: 390, offsetLeft: 0, addEventListener() {} } });
});

test('symbols are positioned as separate unclipped visuals without moving the curved buttons', () => {
  withDialLayout(({ minus, plus, minusLabel, plusLabel, update }) => {
    update();
    assert.equal(minusLabel.style.left, '0px');
    assert.equal(plusLabel.style.left, '310px');
    assert.equal(minusLabel.style.top, '150px');
    assert.equal(plusLabel.style.top, '150px');
    assert.equal(plusLabel.style.getPropertyValue('--dial-side-label-gap'), '20px');
    assert.equal(plus.style.left, '150px');
    assert.equal(plus.style.width, '170px');
    assert.match(minus.style.clipPath, /^path\("M /);
    assert.equal(plusLabel.style.clipPath, undefined);
  });
});
