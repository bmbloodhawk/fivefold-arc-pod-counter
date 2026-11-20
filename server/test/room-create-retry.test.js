import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomService, createRealtimeServer } from '../src/app.js';

const operationId = 'fixture-create-operation-0001';
const input = overrides => ({ playerCount: 2, startingLife: 40, operationId, ...overrides });

test('one connection replays one creation with the original credentials and a current snapshot', () => {
  const service = new RoomService();
  const connection = service.createConnection().connectionId;
  const first = service.createRoom(connection, input());
  const guest = service.createConnection().connectionId;
  service.claimSeat(first.snapshot.code, guest, { seatId: 1, name: 'Guest' });
  const replay = service.createRoom(connection, input());
  assert.equal(service.rooms.size, 1);
  assert.equal(replay.snapshot.code, first.snapshot.code);
  assert.equal(replay.reclaimToken, first.reclaimToken);
  assert.equal(replay.hostRecoveryKey, first.hostRecoveryKey);
  assert.equal(replay.snapshot.version, service.room(first.snapshot.code).version);
  assert.equal(replay.snapshot.seats.filter(seat => seat.claimed).length, 2);
  const publicAndStoredRoom = JSON.stringify({ snapshot: replay.snapshot, room: service.room(first.snapshot.code) });
  assert.ok(!publicAndStoredRoom.includes(first.reclaimToken));
  assert.ok(!publicAndStoredRoom.includes(first.hostRecoveryKey));
});

test('creation replay compares canonical defaults, names, and color sets', () => {
  const service = new RoomService(), connection = service.createConnection().connectionId;
  const first = service.createRoom(connection, input({ name: '  Mi\u0301ra  ', commanderNames: ['  Commander   Name '], commanderColors: [['G', 'R', 'G']] }));
  const replay = service.createRoom(connection, input({ seatCapacity: 2, gameFormat: 'commander', commanderCount: 1,
    name: 'Míra', commanderNames: ['Commander Name'], commanderColors: [['R', 'G']], roundLimitMinutes: null, tableSkinId: null }));
  assert.equal(replay.snapshot.code, first.snapshot.code);
});

for (const changed of [{ name: 'Other' }, { playerCount: 3 }, { seatCapacity: 4 }, { startingLife: 30 },
  { gameFormat: 'casual' }, { commanderCount: 2, commanderNames: ['', ''], commanderColors: [[], []] },
  { commanderNames: ['Other Commander'] }, { commanderColors: [['U']] }, { roundLimitMinutes: 50 }, { tableSkinId: 'staging-ember' }]) {
  test(`a creation identifier cannot change ${Object.keys(changed)[0]}`, () => {
    const service = new RoomService(), connection = service.createConnection().connectionId;
    const first = service.createRoom(connection, input());
    assert.throws(() => service.createRoom(connection, input(changed)), { status: 409, code: 'ROOM_CREATE_RETRY_CONFLICT' });
    assert.equal(service.rooms.size, 1);
    assert.equal(service.room(first.snapshot.code).version, first.snapshot.version);
  });
}

test('another connection using the same identifier creates only its own independent room', () => {
  const service = new RoomService(), a = service.createConnection().connectionId, b = service.createConnection().connectionId;
  const first = service.createRoom(a, input()), second = service.createRoom(b, input());
  assert.notEqual(first.snapshot.code, second.snapshot.code);
  assert.notEqual(first.reclaimToken, second.reclaimToken);
  assert.notEqual(first.hostRecoveryKey, second.hostRecoveryKey);
  assert.equal(service.createRoom(b, input()).snapshot.code, second.snapshot.code);
});

test('legacy creation without an identifier retains its existing one-seat ownership restriction', () => {
  const service = new RoomService(), a = service.createConnection().connectionId, b = service.createConnection().connectionId;
  const first = service.createRoom(a, { playerCount: 2, startingLife: 40 });
  assert.throws(() => service.createRoom(a, { playerCount: 2, startingLife: 40 }), { code: 'CONNECTION_HAS_SEAT' });
  assert.notEqual(service.createRoom(b, { playerCount: 2, startingLife: 40 }).snapshot.code, first.snapshot.code);
});

for (const bad of ['', 'short', 'x'.repeat(129), 42, null, []]) {
  test(`creation rejects a malformed identifier of type ${typeof bad} and length ${String(bad).length}`, () => {
    const service = new RoomService(), connection = service.createConnection().connectionId;
    assert.throws(() => service.createRoom(connection, input({ operationId: bad })), { status: 400, code: 'INVALID_INPUT' });
    assert.equal(service.rooms.size, 0);
  });
}

test('an expired connection cannot replay creation credentials', () => {
  let now = 1;
  const service = new RoomService({ now: () => now, connectionTtlMs: 90_000 });
  const connection = service.createConnection().connectionId;
  service.createRoom(connection, input());
  now += 90_001;
  assert.throws(() => service.createRoom(connection, input()), { code: 'CONNECTION_EXPIRED' });
  assert.ok(!service.connections.has(connection));
});

test('a creation replay cannot recover credentials after its seat moves to another connection', () => {
  const service = new RoomService(), connection = service.createConnection().connectionId;
  const first = service.createRoom(connection, input()), replacement = service.createConnection().connectionId;
  service.claimSeat(first.snapshot.code, replacement, { seatId: 0, reclaimToken: first.reclaimToken });
  assert.throws(() => service.createRoom(connection, input()), { status: 409, code: 'ROOM_CREATE_RETRY_UNAVAILABLE' });
  assert.equal(service.rooms.size, 1);
});

test('a removed room cannot be recreated by replaying an old creation identifier', () => {
  const service = new RoomService(), connection = service.createConnection().connectionId;
  const first = service.createRoom(connection, input());
  service.rooms.delete(first.snapshot.code);
  assert.throws(() => service.createRoom(connection, input()), { status: 409, code: 'ROOM_CREATE_RETRY_UNAVAILABLE' });
  assert.equal(service.rooms.size, 0);
});

test('HTTP creation replays still require the earned skin authorization', async t => {
  let earned = true;
  const { server, service } = createRealtimeServer({ appEnv: 'staging',
    appearanceSkins: [{ id: 'field-notes', name: 'Field Notes' }],
    accountHistory: { async ensureAccount(subject) { return subject; }, async earnedSkinAwards() { return earned ? { 'appearance-field-notes': true } : {}; } },
    accountVerifier: { async verify(token) { if (token !== 'fixture-owner') throw Object.assign(new Error('Sign in'), { status: 401 }); return { providerSubject: token }; } },
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const connection = service.createConnection().connectionId;
  const post = token => fetch(`http://127.0.0.1:${server.address().port}/api/rooms`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-connection-id': connection, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(input({ tableSkinId: 'field-notes' })),
  });
  const created = await post('fixture-owner');
  assert.equal(created.status, 201);
  const first = await created.json();
  assert.equal((await post()).status, 401);
  earned = false;
  assert.equal((await post('fixture-owner')).status, 403);
  earned = true;
  const replay = await post('fixture-owner');
  assert.equal(replay.status, 201);
  assert.equal((await replay.json()).reclaimToken, first.reclaimToken);
  assert.equal(service.rooms.size, 1);
});
