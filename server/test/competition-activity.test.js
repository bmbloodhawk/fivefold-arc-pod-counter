import assert from 'node:assert/strict';
import test from 'node:test';
import { Competitions } from '../src/competitions.js';
import { CompetitionTables } from '../src/competition-tables.js';
import { RoomService, createRealtimeServer } from '../src/app.js';
import { AccountHistory, MemoryAccountHistoryStore } from '../src/account-history.js';
import { MemoryPlaytestLedger } from '../src/playtest-ledger.js';

async function fixture() {
  let time = 1_000_000, writes = 0;
  const store = new MemoryAccountHistoryStore(), update = store.update.bind(store);
  store.update = (...args) => { writes++; return update(...args); };
  const ledger = new MemoryPlaytestLedger();
  const domain = new Competitions({ store, now: () => time, podOwnershipEnabled: true });
  const service = new RoomService({ ledger, now: () => time });
  const tables = new CompetitionTables({ domain, service, ledger });
  const pod = await domain.createPod('host', { name: 'Private Friday', displayName: 'Mira' });
  const invite = await domain.invite('host', 'pod', pod.id);
  const member = await domain.joinPod('member', invite.token, { displayName: 'Nico' });
  const host = service.createConnection().connectionId, participant = service.createConnection().connectionId;
  const guest = service.createConnection().connectionId;
  const created = service.createRoom(host, { playerCount: 4, startingLife: 40, name: 'Host Table name' });
  const code = created.snapshot.code;
  const memberSeat = service.claimSeat(code, participant, { seatId: 1, name: 'Other Table name' });
  service.claimSeat(code, guest, { seatId: 2, name: 'Private guest name' });
  await tables.bind('host', { kind: 'pod', id: pod.id, code, connectionId: host });
  await tables.claim('member', { code, connectionId: participant });
  return { domain, service, tables, ledger, store, pod, member, host, participant, guest, code, created, memberSeat,
    now: () => time, advance: delta => { time += delta; }, writes: () => writes };
}

test('Pod activity returns the current private Table summary and no credentials or unlinked guest names', async () => {
  const f = await fixture();
  assert.deepEqual(await f.tables.activity('member', f.pod.id), {
    asOf: f.now(), presenceWindowMs: 90_000,
    tables: [{ code: f.code, lifecycle: 'lobby', claimedSeats: 3, capacity: 4, availableSeats: 1,
      recentlyConnectedSeats: 3, members: [
        { name: 'Mira', recentlyConnected: true }, { name: 'Nico', recentlyConnected: true },
        { name: 'Guest', recentlyConnected: true },
      ] }],
  });
});

test('activity authorization denies outsiders, removed members and erased accounts before inspecting live Tables', async () => {
  const f = await fixture();
  Object.defineProperty(f.service, 'rooms', { get() { throw new Error('Unauthorized reads must not inspect live Tables'); } });
  await assert.rejects(() => f.tables.activity(null, f.pod.id), { status: 401 });
  await assert.rejects(() => f.tables.activity({ guestToken: 'event-only' }, f.pod.id), { status: 401 });
  await assert.rejects(() => f.tables.activity('outsider', f.pod.id), { status: 403 });
  await f.domain.podMemberAction('host', f.pod.id, { action: 'remove', targetId: f.member.me });
  await assert.rejects(() => f.tables.activity('member', f.pod.id), { status: 403 });
  await f.domain.eraseAccount('host');
  await assert.rejects(() => f.tables.activity('host', f.pod.id), { status: 403 });
});

test('Tables in another Pod, unlinked Tables and reused room codes never enter the Pod activity list', async () => {
  const f = await fixture();
  const other = await f.domain.createPod('host', { name: 'Other Pod', displayName: 'Mira' });
  const otherHost = f.service.createConnection().connectionId;
  const otherCode = f.service.createRoom(otherHost, { playerCount: 2, startingLife: 40 }).snapshot.code;
  await f.tables.bind('host', { kind: 'pod', id: other.id, code: otherCode, connectionId: otherHost });
  const unlinkedHost = f.service.createConnection().connectionId;
  f.service.createRoom(unlinkedHost, { playerCount: 2, startingLife: 40 });
  assert.deepEqual((await f.tables.activity('host', f.pod.id)).tables.map(row => row.code), [f.code]);

  f.service.rooms.delete(f.code);
  const replacementHost = f.service.createConnection().connectionId;
  const replacementCode = f.service.createRoom(replacementHost, { playerCount: 2, startingLife: 40 }).snapshot.code;
  const replacement = f.service.rooms.get(replacementCode);
  f.service.rooms.delete(replacementCode); replacement.code = f.code; f.service.rooms.set(f.code, replacement);
  f.service.connections.get(replacementHost).seatKey = `${f.code}:0`;
  assert.deepEqual((await f.tables.activity('host', f.pod.id)).tables, [], 'Code reuse cannot inherit the old recovery identity binding');
});

test('presence is computed from fresh connections even before expiry sweep and reserves disconnected seats', async () => {
  const f = await fixture();
  f.advance(f.service.connectionTtlMs);
  assert.equal((await f.tables.activity('host', f.pod.id)).tables[0].recentlyConnectedSeats, 3, 'The normal TTL boundary is still current');
  f.advance(1);
  assert.ok(f.service.rooms.get(f.code).seats[1].ownerConnectionId, 'No sweep has expired the connection pointer');
  assert.deepEqual((await f.tables.activity('host', f.pod.id)).tables, [], 'No recent connection is not evidence of physical attendance');

  const replacementHost = f.service.createConnection().connectionId;
  f.service.claimSeat(f.code, replacementHost, { seatId: 0, reclaimToken: f.created.reclaimToken });
  const table = (await f.tables.activity('host', f.pod.id)).tables[0];
  assert.equal(table.recentlyConnectedSeats, 1);
  assert.equal(table.claimedSeats, 3);
  assert.equal(table.availableSeats, 1, 'Disconnected claimed seats remain reserved');
  assert.deepEqual(table.members.map(row => row.recentlyConnected), [true, false, false]);
});

test('only pre-game lobby and next-game setup advertise unclaimed seats as available', async () => {
  const f = await fixture(), room = f.service.rooms.get(f.code);
  assert.equal((await f.tables.activity('host', f.pod.id)).tables[0].availableSeats, 1);
  await f.tables.start(f.code, f.host, { baseVersion: room.version });
  let table = (await f.tables.activity('host', f.pod.id)).tables[0];
  assert.equal(table.lifecycle, 'playing'); assert.equal(table.availableSeats, 0);
  f.service.declareWinner(f.code, f.host, { baseVersion: room.version, winnerSeatId: 0, winCondition: 'other_declared' });
  table = (await f.tables.activity('host', f.pod.id)).tables[0];
  assert.equal(table.lifecycle, 'complete'); assert.equal(table.availableSeats, 0);
  f.service.beginIntermission(f.code, f.host, { baseVersion: room.version });
  table = (await f.tables.activity('host', f.pod.id)).tables[0];
  assert.equal(table.lifecycle, 'intermission'); assert.equal(table.availableSeats, 1);
});

test('current seat proof and active identity determine aliases without guessing from a matching Table name', async () => {
  const f = await fixture();
  const room = f.service.rooms.get(f.code);
  f.service.expireConnection(f.service.connections.get(f.participant));
  room.seats[1].claimed = false; room.seats[1].tokenHash = null;
  const replacement = f.service.createConnection().connectionId;
  f.service.claimSeat(f.code, replacement, { seatId: 1, name: 'Nico' });
  assert.equal((await f.tables.activity('host', f.pod.id)).tables[0].members[1].name, 'Guest');
  await f.tables.claim('member', { code: f.code, connectionId: replacement });
  assert.equal((await f.tables.activity('host', f.pod.id)).tables[0].members[1].name, 'Nico');
  await f.domain.eraseAccount('member');
  assert.equal((await f.tables.activity('host', f.pod.id)).tables[0].members[1].name, 'Guest');
});

test('activity reads never touch room timestamps, connections, storage, recovery or expired room retention', async () => {
  const f = await fixture(), room = f.service.rooms.get(f.code);
  const before = { lastActiveAt: room.lastActiveAt, version: room.version, writes: f.writes(),
    lastSeen: [...f.service.connections.values()].map(row => row.lastSeen) };
  f.advance(20_000);
  await f.tables.activity('host', f.pod.id); await f.tables.activity('member', f.pod.id);
  assert.deepEqual({ lastActiveAt: room.lastActiveAt, version: room.version, writes: f.writes(),
    lastSeen: [...f.service.connections.values()].map(row => row.lastSeen) }, before);

  f.advance(f.service.roomTtlMs);
  f.service.connections.get(f.host).lastSeen = f.now();
  assert.deepEqual((await f.tables.activity('host', f.pod.id)).tables, [], 'A stale room cannot be kept available by a fresh observer');
  assert.ok(f.service.rooms.has(f.code), 'An activity read does not sweep or remove rooms');
  f.service.rooms.clear();
  f.ledger.readRecovery = async () => { throw new Error('Activity must not load stale recovery records'); };
  assert.deepEqual((await f.tables.activity('host', f.pod.id)).tables, []);
});

test('restored room state is not presented as recently connected until a phone reclaims its seat', async () => {
  const f = await fixture(), record = f.service.recoveryRecord(f.service.rooms.get(f.code));
  const restored = new RoomService({ ledger: f.ledger, now: f.now, autoRecoverRooms: true });
  restored.hydrateRecoveryRecord(f.code, structuredClone(record));
  const tables = new CompetitionTables({ domain: f.domain, service: restored, ledger: f.ledger });
  assert.deepEqual((await tables.activity('member', f.pod.id)).tables, []);
  const reconnect = restored.createConnection().connectionId;
  restored.claimSeat(f.code, reconnect, { seatId: 0, reclaimToken: f.created.reclaimToken });
  const table = (await tables.activity('member', f.pod.id)).tables[0];
  assert.equal(table.recentlyConnectedSeats, 1);
  assert.equal(table.members[0].name, 'Mira');
});

test('HTTP Pod activity requires account membership, works without owning a Table seat and exposes no event guest access', async t => {
  const instance = createRealtimeServer({ appEnv: 'test', competitionStore: new MemoryAccountHistoryStore(),
    accountHistory: new AccountHistory({ store: new MemoryAccountHistoryStore() }), ledger: new MemoryPlaytestLedger(),
    accountVerifier: { verify: async token => {
      if (!token) throw Object.assign(new Error('Sign in'), { status: 401 });
      return { providerSubject: token };
    } } });
  await new Promise(resolve => instance.server.listen(0, '127.0.0.1', resolve));
  t.after(() => { instance.server.closeAllConnections(); return new Promise(resolve => instance.server.close(resolve)); });
  const base = `http://127.0.0.1:${instance.server.address().port}`;
  const request = async (path, { token = 'host', method = 'GET', body, connectionId, guestToken } = {}) => {
    const response = await fetch(base + path, { method, headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}), ...(connectionId ? { 'x-connection-id': connectionId } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}), ...(guestToken ? { 'x-event-token': guestToken } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  };
  const pod = (await request('/api/competitions/pods', { method: 'POST', body: { name: 'HTTP private Pod', displayName: 'Mira' } })).data;
  const invite = (await request(`/api/competitions/pod/${pod.id}/invites`, { method: 'POST', body: {} })).data;
  await request('/api/competitions/join', { token: 'member', method: 'POST', body: { token: invite.token, displayName: 'Nico' } });
  const host = instance.service.createConnection().connectionId;
  const code = instance.service.createRoom(host, { playerCount: 2, startingLife: 40 }).snapshot.code;
  await request('/api/competitions/tables/bind', { method: 'POST', connectionId: host, body: { kind: 'pod', id: pod.id, code } });
  const path = `/api/competitions/pod/${pod.id}/activity`;
  const response = await request(path, { token: 'member' });
  assert.equal(response.status, 200); assert.equal(response.data.tables[0].code, code);
  assert.equal((await request(path, { token: null })).status, 401);
  assert.equal((await request(path, { token: null, guestToken: 'event-capability' })).status, 401);
  assert.equal((await request(path, { token: 'outsider' })).status, 403);
  assert.equal((await request(`/api/competitions/tournament/${pod.id}/activity`)).status, 404);
});
