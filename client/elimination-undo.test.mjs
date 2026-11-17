import assert from 'node:assert/strict';
import test from 'node:test';
import { eliminationUndoPresentation } from './elimination-undo.js';

function state() {
  return {
    ownerPlayerId: 'P1', activePlayerId: 'P2', localSimulation: false,
    lifecycle: { status: 'playing' }, gameResult: null,
    players: [
      { id: 'P1', eliminated: true, eliminationUndo: { id: 'own-elimination', expiresAt: 16_000 } },
      { id: 'P2', eliminated: true, eliminationUndo: { id: 'other-elimination', expiresAt: 25_000 } },
    ],
  };
}

test('shared play offers the claimed seat undo, not the inspected player undo', () => {
  const view = eliminationUndoPresentation(state(), { now: 1_000 });
  assert.deepEqual(view, {
    visible: true, disabled: false, eliminationId: 'own-elimination', seconds: 15,
    gamePending: false, pendingSeconds: 0,
  });
});

test('a living owner cannot undo the eliminated player being inspected', () => {
  const current = state(); current.players[0].eliminated = false;
  const view = eliminationUndoPresentation(current, { now: 1_000 });
  assert.equal(view.visible, false); assert.equal(view.disabled, true);
  assert.equal(view.eliminationId, null); assert.equal(view.seconds, 0);
});

test('local simulation follows its active player without requiring a shared connection', () => {
  const current = state(); current.localSimulation = true;
  const view = eliminationUndoPresentation(current, { now: 10_001, status: 'local' });
  assert.equal(view.visible, true); assert.equal(view.disabled, false);
  assert.equal(view.eliminationId, 'other-elimination'); assert.equal(view.seconds, 15);
});

test('pending finish is visible to an opponent without their own undo and with tracking off', () => {
  const current = state(); current.ownerPlayerId = 'P3';
  current.turn = { trackingEnabled: false };
  current.players.push({ id: 'P3', eliminated: false });
  current.pendingFinish = { winnerSeatId: 2, expiresAt: 16_000 };
  const view = eliminationUndoPresentation(current, { now: 1_001 });
  assert.equal(view.visible, false); assert.equal(view.gamePending, true);
  assert.equal(view.pendingSeconds, 15);
});

test('own undo expires at the exact server deadline, without a client-side result', () => {
  const current = state(); current.pendingFinish = { winnerSeatId: 1, expiresAt: 16_000 };
  assert.equal(eliminationUndoPresentation(current, { now: 15_999 }).seconds, 1);
  const atDeadline = eliminationUndoPresentation(current, { now: 16_000 });
  assert.equal(atDeadline.visible, false); assert.equal(atDeadline.eliminationId, null);
  assert.equal(atDeadline.seconds, 0); assert.equal(atDeadline.gamePending, true);
  assert.equal(atDeadline.pendingSeconds, 0);
  assert.equal(eliminationUndoPresentation(current, { now: 20_000 }).pendingSeconds, 0);
  assert.equal(current.gameResult, null);
});

test('final results and non-playing lifecycle states hide stale undo and pending finish', () => {
  for (const status of ['lobby', 'complete', 'intermission']) {
    const current = state(); current.lifecycle.status = status;
    current.pendingFinish = { winnerSeatId: 1, expiresAt: 16_000 };
    const view = eliminationUndoPresentation(current, { now: 1_000 });
    assert.equal(view.visible, false); assert.equal(view.gamePending, false);
  }
  const current = state(); current.gameResult = { winnerSeatId: 1 };
  current.pendingFinish = { winnerSeatId: 1, expiresAt: 16_000 };
  const view = eliminationUndoPresentation(current, { now: 1_000 });
  assert.equal(view.visible, false); assert.equal(view.gamePending, false);
});

test('offline undo stays visible but disabled and submitting prevents repeated activation', () => {
  for (const options of [{ status: 'disconnected' }, { status: 'waiting' }, { submitting: true }]) {
    const view = eliminationUndoPresentation(state(), { now: 1_000, ...options });
    assert.equal(view.visible, true); assert.equal(view.disabled, true);
    assert.equal(view.seconds, 15);
  }
});

test('missing or malformed undo records remain hidden without mutating state', () => {
  for (const undo of [null, {}, { id: '', expiresAt: 16_000 }, { id: 'invalid-time', expiresAt: '16000' }]) {
    const current = state(); current.players[0].eliminationUndo = undo;
    const before = JSON.stringify(current);
    assert.equal(eliminationUndoPresentation(current, { now: 1_000 }).visible, false);
    assert.equal(JSON.stringify(current), before);
  }
  assert.deepEqual(eliminationUndoPresentation(null, { now: 1_000 }), {
    visible: false, disabled: true, eliminationId: null, seconds: 0,
    gamePending: false, pendingSeconds: 0,
  });
});
