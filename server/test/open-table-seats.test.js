import assert from 'node:assert/strict';
import test from 'node:test';
import { createRealtimeServer, RoomService } from '../src/app.js';
import { MemoryPlaytestLedger } from '../src/playtest-ledger.js';

function table(capacity = 2) {
  const ledger = new MemoryPlaytestLedger();
  const service = new RoomService({ ledger });
  const host = service.createConnection(), guest = service.createConnection();
  const created = service.createRoom(host.connectionId, {
    playerCount: 2, seatCapacity: capacity, startingLife: 40, name: 'Host',
    commanderCount: 2, commanderNames: ['Commander A', 'Commander B'], commanderColors: [['U'], ['R']],
  });
  const code = created.snapshot.code;
  service.claimSeat(code, guest.connectionId, { seatId: 1, name: 'Guest' });
  const room = service.room(code);
  const act = (method, input = {}, connection = host) => service[method](code, connection.connectionId, { baseVersion: room.version, ...input });
  return { ledger, service, host, guest, created, code, room, act };
}

test('a host opens a legacy small lobby to eight stable seats without changing existing owners or counters', () => {
  const f = table(); f.act('adjustOwnSeat', { counter: 'life', delta: -3 });
  const seats = structuredClone(f.room.seats), turn = structuredClone(f.room.turn), lifecycle = structuredClone(f.room.lifecycle);
  const gameId = f.room.gameId, version = f.room.version;
  const snapshot = f.act('openTableSeats').snapshot;
  assert.equal(snapshot.seats.length, 8); assert.equal(snapshot.config.playerCount, 8); assert.equal(snapshot.config.seatCapacity, 8);
  assert.equal(snapshot.config.expectedPlayerCount, 2); assert.equal(snapshot.version, version + 1);
  assert.deepEqual(structuredClone(f.room.seats.slice(0, 2)), seats); assert.deepEqual(f.room.turn, turn);
  assert.deepEqual(f.room.lifecycle, lifecycle); assert.equal(f.room.gameId, gameId);
  for (const [index, seat] of f.room.seats.entries()) if (index >= 2) {
    assert.equal(seat.seatId, index); assert.equal(seat.name, `P${index + 1}`);
    assert.equal(seat.claimed, false); assert.equal(seat.ownerConnectionId, null); assert.equal(seat.tokenHash, null);
    assert.deepEqual(seat.counters, { life: 40, radiation: 0, poison: 0, energy: 0, generic: 0 });
    assert.equal(seat.recentOperationIds.size, 0); assert.equal(seat.matchMoment.lowestLife, 40);
  }
  const connection = f.service.createConnection();
  const joined = f.service.claimSeat(f.code, connection.connectionId, { seatId: 7, name: 'New P8' }).snapshot;
  assert.equal(joined.seats[7].claimed, true); assert.equal(joined.seats[7].name, 'New P8');
});

test('opening an eight-seat table is an idempotent read without a version or ledger write', () => {
  const f = table(8), before = f.service.snapshot(f.room), writes = f.ledger.records.length;
  assert.deepEqual(f.act('openTableSeats').snapshot, before);
  assert.equal(f.ledger.records.length, writes);
});

test('only the current host with the latest version can open seats', () => {
  const f = table(), before = f.service.snapshot(f.room);
  assert.throws(() => f.act('openTableSeats', {}, f.guest), { code: 'HOST_ONLY' });
  assert.throws(() => f.act('openTableSeats', { baseVersion: f.room.version - 1 }), { code: 'VERSION_CONFLICT' });
  assert.deepEqual(f.service.snapshot(f.room), before);
});

test('playing, pending finish, and completed games cannot change capacity', () => {
  const f = table(); f.act('startGame');
  assert.throws(() => f.act('openTableSeats'), { code: 'GAME_IN_PROGRESS' });
  f.act('adjustOwnSeat', { counter: 'life', delta: -40 });
  assert.throws(() => f.act('openTableSeats'), { code: 'FINISH_PENDING' });
  f.act('undoElimination', { eliminationId: f.service.snapshot(f.room).seats[0].eliminationUndo.id });
  f.act('declareWinner', { winnerSeatId: 0, winCondition: 'other_declared' });
  assert.throws(() => f.act('openTableSeats'), { code: 'GAME_IN_PROGRESS' });
  assert.equal(f.room.seats.length, 2);
});

test('intermission expansion preserves history, custom order and readiness, while a new seat joins ready', () => {
  const f = table(); f.act('startGame'); f.act('declareWinner', { winnerSeatId: 0, winCondition: 'other_declared' });
  f.act('beginIntermission'); f.act('reorderNextGameSeats', { seatIds: [1, 0] });
  f.act('setNextGameReady', { ready: true });
  const completed = structuredClone(f.room.completedGames), turn = structuredClone(f.room.turn), lifecycle = structuredClone(f.room.lifecycle);
  const gameId = f.room.gameId, seats = structuredClone(f.room.seats);
  f.act('openTableSeats');
  assert.deepEqual(f.room.completedGames, completed); assert.deepEqual(f.room.turn, turn);
  assert.deepEqual(f.room.lifecycle, lifecycle); assert.equal(f.room.gameId, gameId);
  assert.deepEqual(structuredClone(f.room.seats.slice(0, 2)), seats);
  const newConnection = f.service.createConnection();
  const snapshot = f.service.claimSeat(f.code, newConnection.connectionId, { seatId: 7 }).snapshot;
  assert.deepEqual(snapshot.lifecycle.seatIds, [1, 0, 7]);
  assert.ok(snapshot.lifecycle.readySeatIds.includes(7));
});

test('capacity expansion persists through recovery and original reservation tokens still reclaim the same seats', async () => {
  const f = table(); f.act('openTableSeats');
  const recovery = await f.ledger.readRecovery(f.code);
  assert.equal(recovery.room.seats.length, 8); assert.equal(recovery.room.config.seatCapacity, 8);
  const recovered = new RoomService({ ledger: f.ledger, autoRecoverRooms: true });
  await recovered.ensureRoom(f.code);
  const connection = recovered.createConnection();
  const result = recovered.claimSeat(f.code, connection.connectionId, { seatId: 0, reclaimToken: f.created.reclaimToken }, { reclaimOnly: true });
  assert.equal(result.seatId, 0); assert.equal(result.snapshot.seats.length, 8);
  assert.deepEqual(result.snapshot.seats[0].commanderNames, ['Commander A', 'Commander B']);
  assert.equal(result.snapshot.seats[0].name, 'Host');
});

test('the HTTP open-seats endpoint authenticates the host and makes every new seat available', async () => {
  const f = table(); const { server } = createRealtimeServer({ service: f.service });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = async connection => {
    const response = await fetch(`${origin}/api/rooms/${f.code}/open-seats`, { method: 'POST',
      headers: { 'content-type': 'application/json', ...(connection ? { 'x-connection-id': connection.connectionId } : {}) },
      body: JSON.stringify({ baseVersion: f.room.version }) });
    return { status: response.status, data: await response.json() };
  };
  try {
    assert.equal((await call(null)).status, 401); assert.equal((await call(f.guest)).status, 403);
    const result = await call(f.host); assert.equal(result.status, 200);
    assert.equal(result.data.snapshot.seats.filter(seat => !seat.claimed).length, 6);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
