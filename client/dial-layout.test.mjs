import assert from 'node:assert/strict';
import test from 'node:test';
import { glyphCenterCorrection, buttonReadoutBounds, fitReadoutBounds, feedbackBands, inkFitScale } from './dial-layout.js';

test('feedback can use full width only in the actual clear bands above or below flank cards', () => {
  const stage = { top: 217, bottom: 459, left: 12, right: 308, width: 296, height: 242 };
  const bands = feedbackBands(stage, [{ top: 245, bottom: 307 }, { top: 315, bottom: 377 }], 451);
  assert.deepEqual(bands, [{ top: 385, bottom: 451, width: 280 }, { top: 225, bottom: 237, width: 280 }]);
  const tall = feedbackBands({ ...stage, top: 252, bottom: 534 }, [{ top: 298, bottom: 470 }], 476);
  assert.equal(tall[1].bottom - tall[1].top, 30);
});

test('an authored readout scale and offset retain their center inside the same protected gap', () => {
  const bounds = fitReadoutBounds({ width: 166, height: 226 }, 14, -14, 1.4);
  assert.ok(Math.abs(bounds.width * 1.4 / 2 + 14 - 83) < 1e-8);
  assert.ok(Math.abs(bounds.height * 1.4 / 2 + 14 - 113) < 1e-8);
});

test('Button text uses the symmetric gap between actual flank cards and controls', () => {
  const stage = { left: 12, right: 378, top: 252, bottom: 534, width: 366, height: 282 };
  const cards = [{ left: 17, right: 104, top: 298, bottom: 380 },
    { left: 286, right: 373, top: 388, bottom: 470 }];
  assert.deepEqual(buttonReadoutBounds(stage, cards, [{ top: 484, bottom: 530 }]),
    { width: 166, height: 166, diameter: 354 });
  assert.equal(buttonReadoutBounds(stage, [], [{ top: 484, bottom: 530 }]).width, 350);
});

test('Button bounds respond to available space without viewport breakpoints', () => {
  for (const width of [296, 297, 336, 366, 500]) {
    const stage = { left: 0, right: width, top: 0, bottom: 282, width, height: 282 };
    const bounds = buttonReadoutBounds(stage, [], []);
    assert.equal(bounds.width, Math.min(width - 16, 400));
    assert.equal(bounds.height, 266);
    assert.equal(bounds.diameter, Math.min(width - 12, 400));
  }
});

test('the text frame never grows beyond its artwork on a wide stage', () => {
  assert.deepEqual(buttonReadoutBounds({ left: 0, right: 802, top: 0, bottom: 540,
    width: 802, height: 540 }, [], []), { width: 400, height: 400, diameter: 400 });
  assert.equal(feedbackBands({ top: 0, bottom: 540, width: 802 }, [], 532)[0].width, 400);
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
