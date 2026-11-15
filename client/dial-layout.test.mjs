import assert from 'node:assert/strict';
import test from 'node:test';
import { glyphCenterCorrection } from './dial-layout.js';

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
