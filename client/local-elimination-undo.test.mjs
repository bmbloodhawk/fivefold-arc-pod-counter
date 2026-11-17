import assert from 'node:assert/strict';
import test from 'node:test';
import { captureLocalElimination, rememberLocalElimination, advanceLocalElimination, undoLocalElimination } from './local-elimination-undo.js';

function state(count = 2) {
  return {
    localSimulation: true, activePlayerId: 'P2', ownerPlayerId: 'P1', gameResult: null,
    lifecycle: { status: 'playing', seatIds: Array.from({ length: count }, (_, id) => id) },
    turnSeatId: 'P1', turn: { gameStarted: true, gameStartedAt: 100, turnStartedAt: 500, roundEndsAt: 20_000, pausedAt: null, activeSeatId: 0, turnNumber: 1 },
    players: Array.from({ length: count }, (_, id) => ({ id: `P${id + 1}`, name: `Player ${id + 1}`, life: 1, poison: 0, radiation: 3, energy: 0, generic: 0, commanderDamage: { P1: 0 }, alternateElimination: null, eliminated: false, lethalCause: null, warning: 'LOW LIFE', connectionStatus: 'connected' })),
  };
}
function eliminate(current, id = 'P2', now = 1_000) {
  const player = current.players.find(player => player.id === id), before = captureLocalElimination(player);
  player.life = 0; player.eliminated = true; player.lethalCause = 'LIFE 0';
  rememberLocalElimination(current, id, before, { now, id: `undo-${id}` });
  return player;
}

test('nonfinal local elimination offers a 15-second undo without changing turns', () => {
  const current = state(3), turn = structuredClone(current.turn);
  const player = eliminate(current);
  assert.equal(player.eliminationUndo.id, 'undo-P2');
  assert.equal(player.eliminationUndo.expiresAt, 16_000);
  assert.equal(current.gameResult, null); assert.equal(current.pendingFinish, undefined);
  assert.deepEqual(current.turn, turn);
});

test('final local elimination pauses the candidate and finalizes only at its original deadline', () => {
  const current = state(); eliminate(current);
  assert.equal(current.pendingFinish.winnerSeatId, 0); assert.equal(current.pendingFinish.expiresAt, 16_000);
  assert.equal(current.turn.pausedAt, 1_000); assert.equal(current.gameResult, null);
  advanceLocalElimination(current, { now: 15_999 }); assert.equal(current.gameResult, null);
  advanceLocalElimination(current, { now: 16_000 });
  assert.equal(current.gameResult.winnerSeatId, 0); assert.equal(current.gameResult.decidedAt, 1_000);
  assert.equal(current.lifecycle.status, 'complete'); assert.equal(current.pendingFinish, null);
  const result = structuredClone(current.gameResult); advanceLocalElimination(current, { now: 20_000 });
  assert.deepEqual(current.gameResult, result);
});

test('local undo cancels a pending result, preserves other players, and excludes the waiting interval from timers', () => {
  const current = state(); eliminate(current);
  current.players[0].energy = 7; const opponent = structuredClone(current.players[0]);
  undoLocalElimination(current, 'undo-P2', { now: 5_000 });
  assert.equal(current.players[1].life, 1); assert.equal(current.players[1].eliminated, false);
  assert.equal(current.players[1].eliminationUndo, null); assert.equal(current.pendingFinish, null);
  assert.equal(current.gameResult, null); assert.equal(current.turn.pausedAt, null);
  assert.equal(current.turn.gameStartedAt, 4_100); assert.equal(current.turn.turnStartedAt, 4_500);
  assert.equal(current.turn.roundEndsAt, 24_000); assert.equal(current.turn.activeSeatId, 0);
  assert.deepEqual(current.players[0], opponent);
});

test('nonfinal local undo never rewinds a later turn or a new player name', () => {
  const current = state(3); eliminate(current);
  current.turn.activeSeatId = 2; current.turn.turnStartedAt = 2_000; current.turn.lastHandoff = { fromSeatId: 0, toSeatId: 2 };
  current.players[1].name = 'Renamed player'; const turn = structuredClone(current.turn);
  undoLocalElimination(current, 'undo-P2', { now: 5_000 });
  assert.deepEqual(current.turn, turn); assert.equal(current.players[1].name, 'Renamed player');
});

test('a pre-existing manual pause is not resumed by elimination undo', () => {
  const current = state(); current.turn.pausedAt = 700; const turn = structuredClone(current.turn);
  eliminate(current); undoLocalElimination(current, 'undo-P2', { now: 5_000 });
  assert.deepEqual(current.turn, turn);
});

test('compound commander and radiation changes restore every affected own counter', () => {
  for (const kind of ['commander', 'radiation']) {
    const current = state(3), player = current.players[1]; player.life = 2; player.commanderDamage.P1 = 20;
    const before = captureLocalElimination(player);
    player.life = 0; player.eliminated = true;
    if (kind === 'commander') player.commanderDamage.P1 = 21; else player.radiation = 1;
    rememberLocalElimination(current, player.id, before, { now: 1_000, id: kind });
    undoLocalElimination(current, kind, { now: 2_000 });
    assert.equal(player.life, 2); assert.equal(player.commanderDamage.P1, 20); assert.equal(player.radiation, 3);
  }
});

test('local undo is active-seat-only, single-use and expired at the exact deadline', () => {
  const current = state(3); eliminate(current); current.activePlayerId = 'P1';
  assert.throws(() => undoLocalElimination(current, 'undo-P2', { now: 2_000 }), { code: 'ELIMINATION_UNDO_UNAVAILABLE' });
  current.activePlayerId = 'P2'; undoLocalElimination(current, 'undo-P2', { now: 2_000 });
  assert.throws(() => undoLocalElimination(current, 'undo-P2', { now: 3_000 }), { code: 'ELIMINATION_UNDO_UNAVAILABLE' });
  const expired = state(); eliminate(expired);
  assert.throws(() => undoLocalElimination(expired, 'undo-P2', { now: 16_000 }), { code: 'ELIMINATION_UNDO_UNAVAILABLE' });
  assert.equal(expired.gameResult.winnerSeatId, 0);
});

test('saved local state keeps its remaining deadline instead of starting another 15 seconds', () => {
  const current = state(); eliminate(current);
  const restored = JSON.parse(JSON.stringify(current));
  advanceLocalElimination(restored, { now: 11_000 });
  assert.equal(restored.pendingFinish.expiresAt, 16_000); assert.equal(restored.gameResult, null);
  advanceLocalElimination(restored, { now: 17_000 }); assert.equal(restored.gameResult.winnerSeatId, 0);
});

test('another own counter entry invalidates the earlier local undo', () => {
  const current = state(3), player = eliminate(current), before = captureLocalElimination(player);
  player.energy = 2; rememberLocalElimination(current, player.id, before, { now: 2_000 });
  assert.equal(player.eliminationUndo, null);
});

test('local helper never changes shared games', () => {
  const current = state(); current.localSimulation = false; const before = structuredClone(current);
  rememberLocalElimination(current, 'P2', captureLocalElimination(current.players[1]), { now: 1_000 });
  advanceLocalElimination(current, { now: 20_000 });
  assert.deepEqual(current, before);
});
