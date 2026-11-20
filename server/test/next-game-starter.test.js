import assert from 'node:assert/strict';
import test from 'node:test';
import { createRealtimeServer, RoomService } from '../src/app.js';
import { MemoryPlaytestLedger } from '../src/playtest-ledger.js';

function fixture({ order = [0, 2, 1, 3], starter = 2 } = {}) {
  const ledger = new MemoryPlaytestLedger(), service = new RoomService({ ledger });
  const owners = Array.from({ length: 8 }, () => service.createConnection());
  const made = service.createRoom(owners[0].connectionId, { playerCount: 8, startingLife: 40 });
  const code = made.snapshot.code, room = service.room(code);
  for (const seatId of order.filter(id => id !== 0)) service.claimSeat(code, owners[seatId].connectionId, { seatId });
  const act = (method, owner = room.hostSeatId, input = {}) => service[method](code, owners[owner].connectionId, { baseVersion: room.version, ...input });
  act('reorderNextGameSeats', 0, { seatIds: order }); act('chooseStartingPlayer', 0, { startingSeatId: starter }); act('startGame');
  act('declareWinner', 0, { winnerSeatId: 0, winCondition: 'other_declared' });
  const frozen = structuredClone(room.completedGames); act('beginIntermission');
  return { ledger, service, owners, code, room, act, frozen };
}
function selected(f, expected, defaultSeatId = expected, overrideSeatId = null, departedSeatIds = []) {
  const snapshot = f.service.snapshot(f.room);
  assert.equal(snapshot.turn.startingPlayerSeatId, expected); assert.equal(snapshot.turn.activeSeatId, expected);
  assert.deepEqual(snapshot.lifecycle.nextGameStarter, { previousStarterSeatId: 2, previousSeatIds: [0, 2, 1, 3], defaultSeatId, overrideSeatId, departedSeatIds });
  assert.deepEqual(f.room.completedGames, f.frozen);
}

test('next-game automatic default follows current order and wraps without seat-number assumptions', () => {
  const f = fixture(); selected(f, 1);
  f.act('reorderNextGameSeats', 0, { seatIds: [3, 1, 0, 2] }); selected(f, 3);
  f.act('skipNextGameSeat', 0, { seatId: 3 }); selected(f, 1);
});

test('when previous starter leaves, preserved prior-game order determines the first remaining player', () => {
  const f = fixture(); f.act('reorderNextGameSeats', 0, { seatIds: [2, 3, 0, 1] }); selected(f, 3);
  f.act('leaveIntermission', 2); selected(f, 1, 1, null, [2]);
  f.act('skipNextGameSeat', 0, { seatId: 1 }); selected(f, 3, 3, null, [2]);
  f.act('leaveIntermission', 3); selected(f, 0, 0, null, [2, 3]);
});

test('new occupants of departed starter and follower slots do not inherit previous-player rotation identity', () => {
  const f = fixture(); f.act('leaveIntermission', 2);
  const replacementStarter = f.service.createConnection();
  f.service.claimSeat(f.code, replacementStarter.connectionId, { seatId: 2, name: 'New player' });
  assert.equal(f.room.turn.startingPlayerSeatId, 1);
  assert.deepEqual(f.service.snapshot(f.room).lifecycle.nextGameStarter.departedSeatIds, [2]);
  f.act('leaveIntermission', 1);
  const replacementFollower = f.service.createConnection();
  f.service.claimSeat(f.code, replacementFollower.connectionId, { seatId: 1, name: 'Another new player' });
  assert.equal(f.room.turn.startingPlayerSeatId, 3);
  assert.deepEqual(f.room.lifecycle.seatIds, [0, 3, 2, 1]);
  assert.deepEqual(f.service.snapshot(f.room).lifecycle.nextGameStarter.departedSeatIds, [2, 1]);
  const record = structuredClone(f.service.recoveryRecord(f.room)), recovered = new RoomService();
  const room = recovered.hydrateRecoveryRecord(f.code, record);
  assert.equal(room.turn.startingPlayerSeatId, 3);
  assert.deepEqual(recovered.snapshot(room).lifecycle.nextGameStarter.departedSeatIds, [2, 1]);
  assert.deepEqual(room.completedGames, f.frozen);
});

test('default removal, host departure and newly claimed seats recompute the preview', () => {
  const f = fixture(); f.act('leaveIntermission', 1); selected(f, 3, 3, null, [1]);
  f.service.claimSeat(f.code, f.owners[4].connectionId, { seatId: 4 }); selected(f, 3, 3, null, [1]);
  f.act('reorderNextGameSeats', 0, { seatIds: [0, 2, 4, 3] }); selected(f, 4, 4, null, [1]);
  f.act('leaveIntermission', 0); selected(f, 4, 4, null, [1, 0]); assert.equal(f.room.hostSeatId, 2);
  f.act('chooseStartingPlayer', 2, { startingSeatId: 3 }); selected(f, 3, 4, 3, [1, 0]);
});

test('explicit override survives joins/reorder/removal of another seat and reset resumes automatic selection', () => {
  const f = fixture(); f.act('chooseStartingPlayer', 0, { startingSeatId: 0 }); selected(f, 0, 1, 0);
  f.service.claimSeat(f.code, f.owners[4].connectionId, { seatId: 4 }); selected(f, 0, 1, 0);
  f.act('reorderNextGameSeats', 0, { seatIds: [3, 1, 0, 2, 4] }); selected(f, 0, 4, 0);
  f.act('skipNextGameSeat', 0, { seatId: 1 }); selected(f, 0, 4, 0);
  f.act('chooseStartingPlayer', 0, { useDefault: true }); selected(f, 4);
  assert.equal(f.room.turn.startingPlayerRoll, null);
});

test('override departure resets to default and removed claimed seats cannot be selected', () => {
  const f = fixture(); f.act('chooseStartingPlayer', 0, { startingSeatId: 3 });
  f.act('leaveIntermission', 3); selected(f, 1, 1, null, [3]);
  f.act('skipNextGameSeat', 0, { seatId: 1 }); selected(f, 0, 0, null, [3]);
  const before = f.service.snapshot(f.room);
  assert.throws(() => f.act('chooseStartingPlayer', 0, { startingSeatId: 1 }), { code: 'INVALID_INPUT' });
  assert.deepEqual(f.service.snapshot(f.room), before);
});

test('starter preview changes require the current host and exact version', () => {
  const f = fixture(), before = f.service.snapshot(f.room), guest = f.service.createConnection();
  assert.throws(() => f.act('chooseStartingPlayer', 1, { startingSeatId: 3 }), { code: 'HOST_ONLY' });
  assert.throws(() => f.service.chooseStartingPlayer(f.code, guest.connectionId, { baseVersion: f.room.version, useDefault: true }), { code: 'NOT_SEAT_OWNER' });
  assert.throws(() => f.act('chooseStartingPlayer', 0, { useDefault: true, baseVersion: f.room.version - 1 }), { code: 'VERSION_CONFLICT' });
  assert.deepEqual(f.service.snapshot(f.room), before);
});

test('start uses the exact reviewed roster and starter, then captures a new anchor after finishing', () => {
  const f = fixture(); f.act('chooseStartingPlayer', 0, { startingSeatId: 3 });
  for (const id of f.room.lifecycle.seatIds) f.act('setNextGameReady', id);
  const reviewedVersion = f.room.version;
  f.act('reorderNextGameSeats', 0, { seatIds: [3, 0, 2, 1] }); selected(f, 3, 1, 3);
  assert.throws(() => f.act('startGame', 0, { baseVersion: reviewedVersion }), { code: 'VERSION_CONFLICT' });
  const started = f.act('startGame').snapshot;
  assert.equal(started.turn.activeSeatId, 3); assert.equal(started.turn.startingPlayerSeatId, 3);
  assert.deepEqual(started.lifecycle.seatIds, [3, 0, 2, 1]); assert.equal(started.lifecycle.nextGameStarter, null);
  f.act('declareWinner', 0, { winnerSeatId: 0, winCondition: 'other_declared' }); f.act('beginIntermission');
  assert.deepEqual(f.service.snapshot(f.room).lifecycle.nextGameStarter, { previousStarterSeatId: 3, previousSeatIds: [3, 0, 2, 1], defaultSeatId: 0, overrideSeatId: null, departedSeatIds: [] });
});

test('recovery retains the anchor, explicit override and frozen completion while later changes recompute default', async () => {
  const f = fixture(); f.act('chooseStartingPlayer', 0, { startingSeatId: 3 }); f.act('leaveIntermission', 2);
  const recovered = new RoomService({ ledger: f.ledger, autoRecoverRooms: true }); await recovered.ensureRoom(f.code);
  const room = recovered.room(f.code);
  assert.deepEqual(recovered.snapshot(room).lifecycle.nextGameStarter, { previousStarterSeatId: 2, previousSeatIds: [0, 2, 1, 3], defaultSeatId: 1, overrideSeatId: 3, departedSeatIds: [2] });
  assert.equal(room.turn.startingPlayerSeatId, 3); assert.deepEqual(room.completedGames, f.frozen);
  // Private ownership state remains absent until an ordinary valid reclaim.
  assert.equal(room.seats[0].ownerConnectionId, null);
});

test('automatic recovery recomputes a stale saved default from the preserved anchor and current roster', () => {
  const f = fixture(); f.act('leaveIntermission', 2); f.act('reorderNextGameSeats', 0, { seatIds: [3, 0, 1] });
  const record = structuredClone(f.service.recoveryRecord(f.room));
  record.room.lifecycle.nextGameStarter.defaultSeatId = 3;
  record.room.turn.startingPlayerSeatId = 3; record.room.turn.activeSeatId = 3;
  const recovered = new RoomService(), room = recovered.hydrateRecoveryRecord(f.code, record);
  assert.equal(room.turn.startingPlayerSeatId, 1);
  assert.deepEqual(recovered.snapshot(room).lifecycle.nextGameStarter, { previousStarterSeatId: 2, previousSeatIds: [0, 2, 1, 3], defaultSeatId: 1, overrideSeatId: null, departedSeatIds: [2] });
  assert.deepEqual(room.completedGames, f.frozen);
});

test('legacy recovery retains its eligible selected player without inventing the prior starter', () => {
  const f = fixture(), record = structuredClone(f.service.recoveryRecord(f.room));
  delete record.room.lifecycle.nextGameStarter;
  record.room.turn.startingPlayerSeatId = 3; record.room.turn.activeSeatId = 3;
  const recovered = new RoomService(), room = recovered.hydrateRecoveryRecord(f.code, record);
  assert.deepEqual(recovered.snapshot(room).lifecycle.nextGameStarter, { previousStarterSeatId: null, previousSeatIds: [0, 2, 1, 3], defaultSeatId: 0, overrideSeatId: 3, departedSeatIds: [] });
  assert.equal(room.turn.startingPlayerSeatId, 3); assert.deepEqual(room.completedGames, f.frozen);
});

test('intermission API roll becomes an explicit override and roster changes cancel unfinished rolls', () => {
  const f = fixture(); f.act('chooseStartingPlayer');
  for (const id of [0, 2, 1, 3]) f.act('reportStartingPlayerRoll', id, { value: id === 3 ? 20 : 1 });
  selected(f, 3, 1, 3); assert.equal(f.room.turn.startingPlayerRoll.status, 'complete');
  f.act('chooseStartingPlayer'); f.act('skipNextGameSeat', 0, { seatId: 3 }); selected(f, 1);
  assert.equal(f.room.turn.startingPlayerRoll, null);
});

test('first-game D20 still requires every participant and chooses the highest roll', () => {
  const service = new RoomService(), host = service.createConnection(), other = service.createConnection();
  const made = service.createRoom(host.connectionId, { playerCount: 2, startingLife: 40 }), code = made.snapshot.code, room = service.room(code);
  service.claimSeat(code, other.connectionId, { seatId: 1 });
  assert.throws(() => service.chooseStartingPlayer(code, host.connectionId, { baseVersion: room.version, useDefault: true }), { code: 'INVALID_INPUT' });
  service.chooseStartingPlayer(code, host.connectionId, { baseVersion: room.version });
  service.reportStartingPlayerRoll(code, host.connectionId, { value: 1 });
  assert.throws(() => service.startGame(code, host.connectionId, { baseVersion: room.version }), { code: 'ROLL_IN_PROGRESS' });
  service.reportStartingPlayerRoll(code, other.connectionId, { value: 20 });
  const started = service.startGame(code, host.connectionId, { baseVersion: room.version }).snapshot;
  assert.equal(started.turn.startingPlayerSeatId, 1); assert.equal(started.turn.activeSeatId, 1);
  assert.equal(started.lifecycle.nextGameStarter, null);
});

test('HTTP automatic reset returns the updated preview and never starts a D20 roll', async () => {
  const f = fixture(); f.act('chooseStartingPlayer', 0, { startingSeatId: 0 });
  const { server } = createRealtimeServer({ service: f.service }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/rooms/${f.code}/choose-starting-player`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-connection-id': f.owners[0].connectionId }, body: JSON.stringify({ baseVersion: f.room.version, useDefault: true }) });
    assert.equal(response.status, 200); const body = await response.json();
    assert.equal(body.snapshot.turn.startingPlayerSeatId, 1); assert.equal(body.snapshot.lifecycle.nextGameStarter.overrideSeatId, null);
    assert.equal(body.snapshot.turn.startingPlayerRoll, null);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
