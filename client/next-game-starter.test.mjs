import assert from 'node:assert/strict';
import test from 'node:test';
import { nextGameStarterPolicy } from './next-game-starter.js';

const policy = input => nextGameStarterPolicy({ previousStarterSeatId: 2, previousSeatIds: [0, 2, 1, 3], seatIds: [0, 2, 1, 3], ...input });

test('default follows the previous starter in the current table order, including wrap', () => {
  assert.equal(policy({}).defaultSeatId, 1);
  assert.equal(policy({ seatIds: [3, 1, 0, 2] }).defaultSeatId, 3);
  assert.equal(policy({ seatIds: [2, 3, 0, 1] }).defaultSeatId, 3);
});

test('an absent previous starter uses surviving players in preserved previous-game order', () => {
  assert.equal(policy({ seatIds: [3, 0, 1] }).defaultSeatId, 1);
  assert.equal(policy({ seatIds: [0, 3] }).defaultSeatId, 3);
  assert.equal(policy({ seatIds: [7, 6] }).defaultSeatId, 7);
  assert.equal(policy({ seatIds: [] }).defaultSeatId, null);
});

test('joining and removed players recompute automatic selection while a valid override persists', () => {
  assert.equal(policy({ seatIds: [0, 2, 7, 1, 3] }).selectedSeatId, 7);
  const overridden = policy({ seatIds: [0, 2, 7, 1], overrideSeatId: 0 });
  assert.equal(overridden.defaultSeatId, 7); assert.equal(overridden.selectedSeatId, 0); assert.equal(overridden.overrideSeatId, 0);
  const removed = policy({ seatIds: [2, 1, 3], overrideSeatId: 0 });
  assert.equal(removed.overrideSeatId, null); assert.equal(removed.selectedSeatId, 1);
});

test('policy leaves inputs unchanged and preserves its anchor even after the anchor leaves', () => {
  const input = Object.freeze({ previousStarterSeatId: 2, previousSeatIds: Object.freeze([0, 2, 1, 3]), seatIds: Object.freeze([3, 1]), overrideSeatId: null });
  const result = nextGameStarterPolicy(input);
  assert.deepEqual(result.previousSeatIds, [0, 2, 1, 3]); assert.equal(result.previousStarterSeatId, 2);
  assert.equal(result.defaultSeatId, 1); assert.equal(result.selectedSeatId, 1);
});

test('a new occupant of the departed previous starter slot cannot become the old anchor', () => {
  const result = policy({ seatIds: [0, 1, 3, 2], departedSeatIds: [2] });
  assert.equal(result.defaultSeatId, 1);
  assert.deepEqual(result.departedSeatIds, [2]);
});

test('preserved-order fallback skips replacement occupants, while current-order rotation includes newcomers', () => {
  assert.equal(policy({ seatIds: [0, 3, 2, 1], departedSeatIds: [2, 1] }).defaultSeatId, 3);
  // The real previous starter remains, so the new person next to them is eligible.
  assert.equal(policy({ seatIds: [0, 2, 1, 3], departedSeatIds: [1] }).defaultSeatId, 1);
  assert.equal(policy({ seatIds: [2, 1], departedSeatIds: [0, 2, 1, 3] }).defaultSeatId, 2);
});
