import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomService } from '../src/app.js';
import { MemoryPlaytestLedger } from '../src/playtest-ledger.js';

function game({ starter = 0 } = {}) {
  let now = 100_000;
  const ledger = new MemoryPlaytestLedger();
  const service = new RoomService({ now: () => now, ledger });
  const connections = Array.from({ length: 4 }, () => service.createConnection());
  const created = service.createRoom(connections[0].connectionId, {
    playerCount: 4, startingLife: 40, roundLimitMinutes: 15, name: 'Host',
  });
  const code = created.snapshot.code;
  for (const seatId of [3, 1, 2]) service.claimSeat(code, connections[seatId].connectionId, { seatId, name: `Player ${seatId + 1}` });
  const room = service.room(code);
  const snapshot = () => service.snapshot(room);
  const act = (method, seatId = 0, input = {}) => service[method](code, connections[seatId].connectionId, { baseVersion: room.version, ...input }).snapshot;
  if (starter !== 0) act('chooseStartingPlayer', 0, { startingSeatId: starter });
  act('startGame');
  return { service, connections, code, room, ledger, snapshot, act, tick(ms) { now += ms; } };
}

test('host can fix order during another player’s turn without changing game or seat state', () => {
  const f = game();
  f.tick(5_000); f.act('handoffTurn');
  f.act('adjustOwnSeat', 2, { counter: 'life', delta: -3 });
  f.tick(2_000);
  const turn = structuredClone(f.room.turn), seats = structuredClone(f.room.seats);
  const gameId = f.room.gameId;
  const snapshot = f.act('reorderNextGameSeats', 0, { seatIds: [0, 1, 3, 2] });
  assert.deepEqual(snapshot.lifecycle.seatIds, [0, 1, 3, 2]);
  assert.equal(snapshot.lifecycle.seatOrderConfirmed, true);
  assert.deepEqual(f.room.turn, turn);
  assert.deepEqual(structuredClone(f.room.seats), seats);
  assert.equal(f.room.gameId, gameId);
  assert.equal(snapshot.turn.activeSeatId, 1);
  assert.equal(f.act('handoffTurn', 1).turn.activeSeatId, 3);
  assert.equal(f.act('handoffTurn', 3).turn.activeSeatId, 2);
  assert.equal(f.act('handoffTurn', 2).turn.activeSeatId, 0);
});

test('a corrected order keeps the current round and advances at the starter boundary', () => {
  const f = game();
  f.act('handoffTurn');
  assert.equal(f.snapshot().turn.turnNumber, 1);
  const changed = f.act('reorderNextGameSeats', 0, { seatIds: [0, 2, 3, 1] });
  assert.equal(changed.turn.turnNumber, 1);
  assert.equal(changed.turn.startingPlayerSeatId, 0);
  const wrapped = f.act('handoffTurn', 1);
  assert.equal(wrapped.turn.activeSeatId, 0);
  assert.equal(wrapped.turn.turnNumber, 2);
  const next = f.act('handoffTurn');
  assert.equal(next.turn.activeSeatId, 2);
  assert.equal(next.turn.turnNumber, 2);
});

test('corrected turn order still skips eliminated seats', () => {
  const f = game();
  f.act('eliminatePlayer', 0, { targetSeatId: 3, reason: 'milled_out' });
  f.act('reorderNextGameSeats', 0, { seatIds: [0, 3, 2, 1] });
  const next = f.act('handoffTurn');
  assert.equal(next.turn.activeSeatId, 2);
  assert.deepEqual(next.lifecycle.seatIds, [0, 3, 2, 1]);
});

test('correcting order preserves a historical handoff and its undo', () => {
  const f = game();
  f.tick(4_000); f.act('handoffTurn');
  const handoff = structuredClone(f.room.turn.lastHandoff);
  f.act('reorderNextGameSeats', 0, { seatIds: [0, 3, 1, 2] });
  assert.deepEqual(f.room.turn.lastHandoff, handoff);
  const undone = f.act('undoTurnHandoff');
  assert.equal(undone.turn.activeSeatId, 0);
  assert.equal(undone.turn.turnNumber, 1);
  assert.equal(f.act('handoffTurn').turn.activeSeatId, 3);
});

for (const mode of ['paused', 'tracking off']) {
  test(`correcting order preserves timers while ${mode}`, () => {
    const f = game(); f.tick(7_000);
    if (mode === 'paused') f.act('setTurnPaused', 0, { paused: true });
    else f.act('setTurnTracking', 0, { enabled: false });
    const turn = structuredClone(f.room.turn);
    f.tick(2_000); f.act('reorderNextGameSeats', 0, { seatIds: [0, 3, 1, 2] });
    assert.deepEqual(f.room.turn, turn);
    assert.throws(() => f.act('handoffTurn'), { code: mode === 'paused' ? 'TURN_PAUSED' : 'TURN_TRACKING_OFF' });
  });
}

test('non-host, stale and invalid order requests leave the live game unchanged', () => {
  const f = game();
  const cases = [
    { seatId: 1, input: { seatIds: [0, 3, 1, 2] }, code: 'HOST_ONLY' },
    { input: { seatIds: [0, 3, 1, 2], baseVersion: f.room.version - 1 }, code: 'VERSION_CONFLICT' },
    ...[[0, 1, 2], [0, 1, 1, 3], [0, 1, 2, 4], [0, 1, 2, '3'], null]
      .map(seatIds => ({ input: { seatIds }, code: 'INVALID_INPUT' })),
  ];
  for (const attempt of cases) {
    const before = f.snapshot();
    assert.throws(() => f.act('reorderNextGameSeats', attempt.seatId ?? 0, attempt.input), { code: attempt.code });
    assert.deepEqual(f.snapshot(), before);
  }
});

test('completed and unstarted playing states reject reordering without mutation', () => {
  for (const state of ['unstarted', 'complete', 'result with playing lifecycle']) {
    const f = game();
    if (state === 'unstarted') f.room.turn.gameStarted = false;
    else {
      f.act('declareWinner', 0, { winnerSeatId: 0, winCondition: 'other_declared' });
      if (state === 'result with playing lifecycle') f.room.lifecycle.status = 'playing';
    }
    const before = f.snapshot();
    assert.throws(() => f.act('reorderNextGameSeats', 0, { seatIds: [0, 3, 1, 2] }), { code: 'GAME_IN_PROGRESS' });
    assert.deepEqual(f.snapshot(), before);
  }
});

test('next-game setup still allows host reordering without changing completed game history', () => {
  const f = game();
  f.act('reorderNextGameSeats', 0, { seatIds: [0, 3, 1, 2] });
  f.act('declareWinner', 0, { winnerSeatId: 0, winCondition: 'other_declared' });
  f.act('beginIntermission');
  const turn = structuredClone(f.room.turn), seats = structuredClone(f.room.seats);
  const completedGames = structuredClone(f.room.completedGames);
  const completion = structuredClone(f.ledger.records.filter(record => record.kind === 'complete'));
  const snapshot = f.act('reorderNextGameSeats', 0, { seatIds: [3, 0, 1, 2] });
  assert.equal(snapshot.lifecycle.status, 'intermission');
  assert.deepEqual(snapshot.lifecycle.seatIds, [3, 0, 1, 2]);
  assert.equal(snapshot.turn.startingPlayerSeatId, 1);
  assert.equal(snapshot.turn.activeSeatId, 1);
  assert.deepEqual({ ...f.room.turn, activeSeatId: turn.activeSeatId, startingPlayerSeatId: turn.startingPlayerSeatId }, turn);
  assert.deepEqual(structuredClone(f.room.seats), seats);
  assert.deepEqual(f.room.completedGames, completedGames);
  assert.deepEqual(f.ledger.records.filter(record => record.kind === 'complete'), completion);
});

test('pending final elimination rejects reordering without disturbing undo or completion state', () => {
  const f = game();
  for (const seatId of [1, 2, 3]) f.act('adjustOwnSeat', seatId, { counter: 'poison', delta: 10 });
  const before = f.snapshot(), records = structuredClone(f.ledger.records);
  assert.ok(before.pendingFinish);
  assert.equal(before.gameResult, null);
  assert.throws(() => f.act('reorderNextGameSeats', 0, { seatIds: [0, 3, 1, 2] }), { code: 'FINISH_PENDING' });
  assert.deepEqual(f.snapshot(), before);
  assert.deepEqual(f.ledger.records, records);
  assert.equal(f.room.completedGames.length, 0);
});

test('an order corrected during play becomes the next-game anchor and preserves a valid later override', () => {
  const f = game();
  f.act('reorderNextGameSeats', 0, { seatIds: [2, 0, 3, 1] });
  f.act('declareWinner', 0, { winnerSeatId: 0, winCondition: 'other_declared' });
  const completedGames = structuredClone(f.room.completedGames);
  const completion = structuredClone(f.ledger.records.filter(record => record.kind === 'complete'));
  let snapshot = f.act('beginIntermission');
  assert.deepEqual(snapshot.lifecycle.nextGameStarter, {
    previousStarterSeatId: 0, previousSeatIds: [2, 0, 3, 1],
    defaultSeatId: 3, overrideSeatId: null, departedSeatIds: [],
  });
  assert.equal(snapshot.turn.startingPlayerSeatId, 3);
  snapshot = f.act('reorderNextGameSeats', 0, { seatIds: [1, 3, 0, 2] });
  assert.equal(snapshot.lifecycle.nextGameStarter.defaultSeatId, 2);
  assert.equal(snapshot.turn.startingPlayerSeatId, 2);
  f.act('chooseStartingPlayer', 0, { startingSeatId: 3 });
  snapshot = f.act('reorderNextGameSeats', 0, { seatIds: [0, 1, 2, 3] });
  assert.deepEqual(snapshot.lifecycle.nextGameStarter, {
    previousStarterSeatId: 0, previousSeatIds: [2, 0, 3, 1],
    defaultSeatId: 1, overrideSeatId: 3, departedSeatIds: [],
  });
  assert.equal(snapshot.turn.startingPlayerSeatId, 3);
  assert.deepEqual(f.room.completedGames, completedGames);
  assert.deepEqual(f.ledger.records.filter(record => record.kind === 'complete'), completion);
});

test('departure fallback uses the corrected last-game order without giving replacement occupants its history', () => {
  const f = game({ starter: 2 });
  f.act('reorderNextGameSeats', 0, { seatIds: [0, 2, 3, 1] });
  f.act('declareWinner', 0, { winnerSeatId: 0, winCondition: 'other_declared' });
  const completedGames = structuredClone(f.room.completedGames);
  f.act('beginIntermission');
  f.act('reorderNextGameSeats', 0, { seatIds: [2, 1, 0, 3] });
  let snapshot = f.act('leaveIntermission', 2);
  assert.equal(snapshot.turn.startingPlayerSeatId, 3);
  assert.deepEqual(snapshot.lifecycle.nextGameStarter.previousSeatIds, [0, 2, 3, 1]);
  assert.deepEqual(snapshot.lifecycle.nextGameStarter.departedSeatIds, [2]);
  const replacement = f.service.createConnection();
  snapshot = f.service.claimSeat(f.code, replacement.connectionId, { seatId: 2, name: 'New player' }).snapshot;
  assert.equal(snapshot.turn.startingPlayerSeatId, 3);
  snapshot = f.act('leaveIntermission', 3);
  assert.equal(snapshot.turn.startingPlayerSeatId, 1);
  assert.deepEqual(snapshot.lifecycle.nextGameStarter.previousSeatIds, [0, 2, 3, 1]);
  assert.deepEqual(snapshot.lifecycle.nextGameStarter.departedSeatIds, [2, 3]);
  assert.deepEqual(f.room.completedGames, completedGames);
});
