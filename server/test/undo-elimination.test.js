import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomService, createRealtimeServer } from '../src/app.js';
import { MemoryPlaytestLedger } from '../src/playtest-ledger.js';

function fixture(count = 2) {
  let now = 100_000;
  const timers = new Map(); let timerId = 0;
  const ledger = new MemoryPlaytestLedger();
  const service = new RoomService({ now: () => now, ledger,
    setTimeoutImpl(callback, delay) { const id = ++timerId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeoutImpl(id) { timers.delete(id); },
  });
  const connections = Array.from({ length: count }, () => service.createConnection());
  const made = service.createRoom(connections[0].connectionId, { playerCount: count, startingLife: 40 });
  const code = made.snapshot.code;
  for (let seatId = 1; seatId < count; seatId++) service.claimSeat(code, connections[seatId].connectionId, { seatId });
  const room = service.room(code);
  const act = (method, seatId = 0, input = {}) => service[method](code, connections[seatId].connectionId, { baseVersion: room.version, ...input });
  act('startGame');
  return { service, room, ledger, connections, code, made, act, timers, now: () => now,
    advance(ms, fire = true) { now += ms; if (fire) for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); } },
  };
}

test('final lethal point provides a private owner undo window without freezing a completed result', () => {
  const f = fixture(); const before = structuredClone(f.room.seats[0].matchMoment);
  const snapshot = f.act('adjustOwnSeat', 0, { counter: 'poison', delta: 10 }).snapshot;
  assert.equal(snapshot.gameResult, null); assert.equal(snapshot.completedGameEligible, false);
  assert.deepEqual(snapshot.pendingFinish, { winnerSeatId: 1, expiresAt: 115_000 });
  assert.equal(snapshot.seats[0].eliminationUndo.expiresAt, 115_000);
  assert.deepEqual(Object.keys(snapshot.seats[0].eliminationUndo).sort(), ['expiresAt', 'id']);
  assert.equal(f.room.ledgerCompletedAt, null); assert.equal(f.room.completedGames.length, 0);
  assert.equal(f.ledger.records.some(item => item.kind === 'complete'), false);
  f.advance(5_000);
  const undone = f.act('undoElimination', 0, { eliminationId: snapshot.seats[0].eliminationUndo.id }).snapshot;
  assert.equal(undone.pendingFinish, null); assert.equal(undone.seats[0].counters.poison, 0);
  assert.equal(undone.seats[0].counterTotals.poison, 0);
  assert.deepEqual(f.room.seats[0].matchMoment, before);
  assert.equal(undone.turn.activeSeatId, 0); assert.equal(undone.turn.pausedAt, null);
  assert.equal(undone.turn.turnStartedAt, 105_000);
  f.advance(20_000); assert.equal(f.room.gameResult, null);
});

test('server timer completes exactly once without a further room request', () => {
  const f = fixture(); f.act('adjustOwnSeat', 0, { counter: 'life', delta: -40 });
  assert.equal(f.timers.size, 1);
  f.advance(15_000);
  assert.equal(f.room.gameResult.winnerSeatId, 1); assert.equal(f.room.lifecycle.status, 'complete');
  assert.equal(f.room.completedGames.length, 1);
  const count = f.ledger.records.filter(item => item.kind === 'complete').length;
  f.advance(60_000); f.service.snapshot(f.room);
  assert.equal(f.ledger.records.filter(item => item.kind === 'complete').length, count);
});

test('late undo enforces the deadline even when the timer has not run', () => {
  const f = fixture(); const snapshot = f.act('adjustOwnSeat', 0, { counter: 'life', delta: -40 }).snapshot;
  f.advance(15_000, false);
  assert.throws(() => f.act('undoElimination', 0, { eliminationId: snapshot.seats[0].eliminationUndo.id }), { code: 'ELIMINATION_UNDO_UNAVAILABLE' });
  assert.equal(f.room.gameResult.winnerSeatId, 1);
});

test('only affected owner may undo; stale requests and changed own state cannot rewind', () => {
  const f = fixture(3);
  const snapshot = f.act('adjustOwnSeat', 1, { counter: 'poison', delta: 10 }).snapshot;
  const eliminationId = snapshot.seats[1].eliminationUndo.id;
  assert.throws(() => f.act('undoElimination', 0, { eliminationId }), { code: 'ELIMINATION_UNDO_UNAVAILABLE' });
  assert.throws(() => f.act('undoElimination', 1, { eliminationId, baseVersion: snapshot.version - 1 }), { code: 'VERSION_CONFLICT' });
  f.act('adjustOwnSeat', 1, { counter: 'energy', delta: 1 });
  assert.throws(() => f.act('undoElimination', 1, { eliminationId }), { code: 'ELIMINATION_UNDO_UNAVAILABLE' });
});

test('nonfinal undo restores the affected player but keeps other actions and the current turn', () => {
  const f = fixture(3); f.act('handoffTurn');
  const snapshot = f.act('adjustOwnSeat', 1, { counter: 'life', delta: -40 }).snapshot;
  assert.equal(snapshot.turn.activeSeatId, 2);
  f.act('adjustOwnSeat', 2, { counter: 'energy', delta: 3 });
  const turn = structuredClone(f.room.turn);
  const undone = f.act('undoElimination', 1, { eliminationId: snapshot.seats[1].eliminationUndo.id }).snapshot;
  assert.equal(undone.seats[1].counters.life, 40); assert.equal(undone.seats[2].counters.energy, 3);
  assert.deepEqual(f.room.turn, turn); assert.equal(undone.gameResult, null);
});

test('nonfinal undo retains completed turn accounting while reversing the mistaken action facts', () => {
  const f = fixture(3); f.act('handoffTurn');
  f.room.seats[1].matchMoment.reclaimedDuringGame = true;
  f.act('adjustOwnSeat', 1, { counter: 'energy', delta: 1 });
  const before = structuredClone(f.room.seats[1].matchMoment);
  f.advance(7_000);
  const snapshot = f.act('adjustOwnSeat', 1, { counter: 'poison', delta: 10 }).snapshot;
  f.act('adjustOwnSeat', 2, { counter: 'energy', delta: 2 });
  const turn = structuredClone(f.room.turn);
  f.act('undoElimination', 1, { eliminationId: snapshot.seats[1].eliminationUndo.id });
  const after = f.room.seats[1].matchMoment;
  assert.equal(after.turnCount, before.turnCount + 1);
  assert.equal(after.totalTurnMs, before.totalTurnMs + 7_000);
  assert.equal(after.turnsAfterReclaim, before.turnsAfterReclaim + 1);
  assert.equal(after.actionsAfterReclaim, before.actionsAfterReclaim);
  assert.equal(after.poisonGained, before.poisonGained);
  assert.deepEqual(f.room.turn, turn);
});

test('undo by an earlier eliminated player unblocks a still-eliminated active seat after pending finish', () => {
  const f = fixture(3);
  const earlier = f.act('adjustOwnSeat', 1, { counter: 'life', delta: -40 }).snapshot;
  f.advance(1_000);
  f.act('adjustOwnSeat', 0, { counter: 'life', delta: -40 });
  assert.ok(f.room.pendingFinish); assert.equal(f.room.turn.activeSeatId, 0);
  const snapshot = f.act('undoElimination', 1, { eliminationId: earlier.seats[1].eliminationUndo.id }).snapshot;
  assert.equal(snapshot.pendingFinish, null); assert.equal(snapshot.gameResult, null);
  assert.equal(snapshot.turn.activeSeatId, 1);
  assert.equal(snapshot.seats[0].counters.life, 0);
});

test('commander lethal undo reverses both damage and life, and host-marked elimination is owner-reversible', () => {
  const f = fixture();
  let snapshot = f.act('adjustOwnSeat', 0, { counter: 'commanderDamage', commanderSourceId: 'seat-1-commander-a', delta: 21 }).snapshot;
  snapshot = f.act('undoElimination', 0, { eliminationId: snapshot.seats[0].eliminationUndo.id }).snapshot;
  assert.equal(snapshot.seats[0].counters.life, 40); assert.equal(snapshot.seats[0].commanderDamageReceived['seat-1-commander-a'], 0);
  snapshot = f.act('eliminatePlayer', 0, { targetSeatId: 1, reason: 'milled_out' }).snapshot;
  snapshot = f.act('undoElimination', 1, { eliminationId: snapshot.seats[1].eliminationUndo.id }).snapshot;
  assert.equal(snapshot.seats[1].alternateElimination, null); assert.equal(snapshot.gameResult, null);
});

test('lethal radiation undo restores radiation, life and match bookkeeping exactly', () => {
  const f = fixture(); f.act('adjustOwnSeat', 0, { counter: 'life', delta: -38 });
  f.act('adjustOwnSeat', 0, { counter: 'radiation', delta: 3 });
  const before = structuredClone(f.room.seats[0].matchMoment);
  let snapshot = f.act('resolveRadiation', 0, { nonlandCount: 2 }).snapshot;
  snapshot = f.act('undoElimination', 0, { eliminationId: snapshot.seats[0].eliminationUndo.id }).snapshot;
  assert.equal(snapshot.seats[0].counters.life, 2); assert.equal(snapshot.seats[0].counters.radiation, 3);
  assert.deepEqual(f.room.seats[0].matchMoment, before);
});

test('pending finalization rejects counter/turn/result/reset bypasses', () => {
  const f = fixture(); f.act('adjustOwnSeat', 1, { counter: 'life', delta: -40 });
  for (const [method, input] of [
    ['adjustOwnSeat', { counter: 'energy', delta: 1 }], ['mutateOwnSeat', { counters: { life: 50 } }],
    ['handoffTurn', {}], ['resetRoom', {}], ['declareWinner', { winnerSeatId: 0, winCondition: 'other_declared' }],
    ['completeTimedDraw', {}], ['resolveRadiation', { nonlandCount: 0 }], ['setTurnPaused', { paused: false }],
  ]) assert.throws(() => f.act(method, 0, input), { code: 'FINISH_PENDING' }, method);
});

test('recovery rearms the remaining deadline, or finalizes an expired candidate before writes', () => {
  for (const elapsed of [5_000, 20_000]) {
    const f = fixture(); const snapshot = f.act('adjustOwnSeat', 0, { counter: 'life', delta: -40 }).snapshot;
    const recovery = structuredClone(f.service.recoveryRecord(f.room)); f.service.clearEliminationTimers();
    f.advance(elapsed, false);
    const restored = f.service.hydrateRecoveryRecord(f.code, recovery);
    if (elapsed < 15_000) {
      assert.equal(restored.pendingFinish.expiresAt, snapshot.pendingFinish.expiresAt); assert.equal(f.timers.size, 1);
      f.advance(10_000); assert.equal(restored.gameResult.winnerSeatId, 1);
    } else { assert.equal(restored.gameResult.winnerSeatId, 1); assert.equal(f.timers.size, 0); }
    assert.equal(restored.completedGames.length, 1);
  }
});

test('declared winners remain immediately final and cannot be undone', () => {
  const f = fixture(); const snapshot = f.act('declareWinner', 0, { winnerSeatId: 0, winCondition: 'other_declared' }).snapshot;
  assert.equal(snapshot.gameResult.reason, 'declared_winner'); assert.equal(snapshot.pendingFinish, null);
  assert.throws(() => f.act('undoElimination', 0, { eliminationId: 'not-an-elimination' }), { code: 'ELIMINATION_UNDO_UNAVAILABLE' });
});

test('reset and a new game reject old undo IDs and ignore a queued timer from the previous finish', () => {
  const f = fixture(); const first = f.act('adjustOwnSeat', 0, { counter: 'life', delta: -40 }).snapshot;
  const oldCallback = [...f.timers.values()][0].callback, oldId = first.seats[0].eliminationUndo.id;
  f.act('undoElimination', 0, { eliminationId: oldId });
  f.act('resetRoom'); f.act('startGame');
  assert.throws(() => f.act('undoElimination', 0, { eliminationId: oldId }), { code: 'ELIMINATION_UNDO_UNAVAILABLE' });
  const current = f.act('adjustOwnSeat', 0, { counter: 'life', delta: -40 }).snapshot;
  oldCallback();
  assert.equal(f.timers.size, 1); assert.equal(f.room.gameResult, null);
  assert.equal(f.room.pendingFinish.expiresAt, current.pendingFinish.expiresAt);
  f.advance(15_000); assert.equal(f.room.gameResult.winnerSeatId, 1);
});

test('undo does not unpause a game that the host had already paused', () => {
  const f = fixture(); f.act('setTurnPaused', 0, { paused: true });
  const before = structuredClone(f.room.turn); f.advance(1_000);
  const snapshot = f.act('adjustOwnSeat', 0, { counter: 'life', delta: -40 }).snapshot;
  f.advance(2_000); f.act('undoElimination', 0, { eliminationId: snapshot.seats[0].eliminationUndo.id });
  assert.deepEqual(f.room.turn, before); assert.equal(f.room.pendingFinish, null);
});

test('reclaiming keeps owner undo authority without erasing the legitimate reconnect fact', () => {
  const f = fixture(); const snapshot = f.act('adjustOwnSeat', 0, { counter: 'life', delta: -40 }).snapshot;
  const replacement = f.service.createConnection();
  const reclaimed = f.service.claimSeat(f.code, replacement.connectionId, { seatId: 0, reclaimToken: f.made.reclaimToken });
  f.service.undoElimination(f.code, replacement.connectionId, { baseVersion: reclaimed.snapshot.version, eliminationId: snapshot.seats[0].eliminationUndo.id });
  assert.equal(f.room.seats[0].counters.life, 40);
  assert.equal(f.room.seats[0].matchMoment.reclaimedDuringGame, true);
});

test('the HTTP undo route authenticates the affected owner and returns only public undo metadata', async () => {
  const f = fixture(); const snapshot = f.act('adjustOwnSeat', 1, { counter: 'life', delta: -40 }).snapshot;
  const { server } = createRealtimeServer({ service: f.service });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = async connectionId => {
    const response = await fetch(`${origin}/api/rooms/${f.code}/undo-elimination`, { method: 'POST',
      headers: { 'content-type': 'application/json', ...(connectionId ? { 'x-connection-id': connectionId } : {}) },
      body: JSON.stringify({ baseVersion: snapshot.version, eliminationId: snapshot.seats[1].eliminationUndo.id }) });
    return { status: response.status, body: await response.json() };
  };
  try {
    assert.equal((await post(null)).status, 401);
    assert.equal((await post(f.connections[0].connectionId)).status, 409);
    const result = await post(f.connections[1].connectionId);
    assert.equal(result.status, 200); assert.equal(result.body.snapshot.pendingFinish, null);
    assert.equal(result.body.snapshot.seats[1].counters.life, 40);
    assert.equal(JSON.stringify(result.body.snapshot).includes('eliminationBefore'), false);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
