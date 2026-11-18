import assert from 'node:assert/strict';
import test from 'node:test';
import { createRealtimeServer } from '../src/app.js';
import { AccountHistory, MemoryAccountHistoryStore } from '../src/account-history.js';
import { MemoryPlaytestLedger } from '../src/playtest-ledger.js';

async function fixture(t, { count = 4 } = {}) {
  let now = 1_800_000_000_000;
  const store = new MemoryAccountHistoryStore();
  const profileStore = new MemoryAccountHistoryStore();
  const app = createRealtimeServer({ appEnv: 'test', competitionStore: store, now: () => now,
    accountHistory: new AccountHistory({ store: profileStore }), ledger: new MemoryPlaytestLedger(),
    accountVerifier: { verify: async token => ({ providerSubject: token }) } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => app.server.close(resolve)));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = async (path, { account = 'host', viewerToken, guestToken, connectionId, method = 'GET', body } = {}) => {
    const response = await fetch(base + path, { method, headers: {
      ...(account ? { authorization: `Bearer ${account}` } : {}),
      ...(viewerToken !== undefined ? { 'x-event-viewer-token': viewerToken } : {}),
      ...(guestToken ? { 'x-event-token': guestToken } : {}),
      ...(connectionId ? { 'x-connection-id': connectionId } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: response.status === 204 ? null : await response.json() };
  };
  const event = (await request('/api/competitions/tournaments', { method: 'POST', body: {
    name: 'Private Friday', displayName: 'Organizer', rounds: 2, minutes: 60,
  } })).data;
  const path = `/api/competitions/tournament/${event.id}`;
  const invite = (await request(`${path}/invites`, { method: 'POST', body: {} })).data;
  const entrants = [];
  for (let i = 0; i < count; i++) entrants.push((await request('/api/competitions/join', {
    account: `player_${i}`, method: 'POST', body: { token: invite.token, displayName: `Player ${i}` },
  })).data);
  const createLink = async (account = 'host') => {
    const response = await request(`${path}/spectator-links`, { account, method: 'POST', body: { action: 'create' } });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    return response.data;
  };
  return { ...app, store, request, event, path, entrants, invite, createLink, advance: ms => { now += ms; }, now: () => now };
}

test('spectator links are admin-issued, single-use disclosures with one active 24-hour capability per event', async t => {
  const f = await fixture(t);
  const before = await f.competitions.readScope('tournament', f.event.id);
  assert.equal((await f.request(`${f.path}/spectator-links`, { account: 'player_0', method: 'POST', body: { action: 'create' } })).status, 403);
  assert.equal((await f.request(`${f.path}/spectator-links`, { account: 'outsider' })).status, 403);
  const issued = await f.createLink();
  assert.deepEqual(Object.keys(issued).sort(), ['eventId', 'expiresAt', 'viewerToken']);
  assert.equal(issued.eventId, f.event.id);
  assert.match(issued.viewerToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(issued.expiresAt, f.now() + 86_400_000);
  assert.deepEqual((await f.competitions.readScope('tournament', f.event.id)).members, before.members);
  const metadata = await f.request(`${f.path}/spectator-links`);
  assert.deepEqual(metadata.data, { eventId: f.event.id, active: true, expiresAt: issued.expiresAt });
  assert.equal(/secretHash|viewerToken/.test(JSON.stringify(metadata.data)), false);
  assert.equal(JSON.stringify([...f.store.values.values()]).includes(issued.viewerToken), false);
  assert.equal((await f.request(`${f.path}/spectator`, { account: null, viewerToken: issued.viewerToken })).status, 200);
  const replacement = await f.createLink();
  assert.notEqual(replacement.viewerToken, issued.viewerToken);
  assert.equal((await f.request(`${f.path}/spectator`, { account: null, viewerToken: issued.viewerToken })).status, 403);
  const other = (await f.request('/api/competitions/tournaments', { method: 'POST', body: { name: 'Other event', displayName: 'Host' } })).data;
  assert.equal((await f.request(`/api/competitions/tournament/${other.id}/spectator`, { account: null, viewerToken: replacement.viewerToken })).status, 403);
  assert.equal((await f.request(`${f.path}/spectator`, { account: null })).status, 403);
  assert.equal((await f.request(`${f.path}/spectator`, { account: 'host' })).status, 403);
  assert.equal((await f.request(`${f.path}/spectator-links`, { method: 'POST', body: { action: 'unknown' } })).status, 400);
  for (const body of [null, [], 'create']) {
    assert.equal((await f.request(`${f.path}/spectator-links`, { method: 'POST', body })).status, 400);
  }
});

test('spectator expiry, revocation, organizer role and identity validity are rechecked on every read', async t => {
  const f = await fixture(t);
  let issued = await f.createLink();
  f.advance(86_400_000);
  assert.equal((await f.request(`${f.path}/spectator`, { account: null, viewerToken: issued.viewerToken })).status, 403);
  assert.deepEqual((await f.request(`${f.path}/spectator-links`)).data, { eventId: f.event.id, active: false, expiresAt: null });
  issued = await f.createLink();
  assert.equal((await f.request(`${f.path}/spectator-links`, { method: 'POST', body: { action: 'revoke' } })).status, 200);
  assert.equal((await f.request(`${f.path}/spectator`, { account: null, viewerToken: issued.viewerToken })).status, 403);
  await f.request(`${f.path}/members`, { method: 'POST', body: { action: 'cohost', targetId: f.entrants[0].me, enabled: true } });
  issued = await f.createLink('player_0');
  await f.request(`${f.path}/members`, { method: 'POST', body: { action: 'cohost', targetId: f.entrants[0].me, enabled: false } });
  assert.equal((await f.request(`${f.path}/spectator`, { account: null, viewerToken: issued.viewerToken })).status, 403);
  await f.request(`${f.path}/members`, { method: 'POST', body: { action: 'cohost', targetId: f.entrants[0].me, enabled: true } });
  await f.request(`${f.path}/members`, { account: 'player_0', method: 'POST', body: { action: 'leave' } });
  issued = await f.createLink('player_0');
  assert.equal((await f.request(`${f.path}/spectator`, { account: null, viewerToken: issued.viewerToken })).status, 200);
  await f.request(`${f.path}/members`, { method: 'POST', body: { action: 'cohost', targetId: f.entrants[0].me, enabled: false } });
  assert.equal((await f.request(`${f.path}/spectator`, { account: null, viewerToken: issued.viewerToken })).status, 403);
  await f.request('/api/competitions/join', { method: 'POST', body: { token: f.invite.token, displayName: 'Organizer' } });
  issued = await f.createLink();
  await f.request(`${f.path}/members`, { method: 'POST', body: { action: 'leave' } });
  assert.equal((await f.request(`${f.path}/spectator`, { account: null, viewerToken: issued.viewerToken })).status, 200);
  assert.equal((await f.request(`${f.path}/spectator-links`)).status, 200);
  issued = await f.createLink();
  await f.request(`${f.path}/members`, { account: 'player_1', method: 'POST', body: { action: 'leave' } });
  for (const method of ['GET', 'POST']) {
    assert.equal((await f.request(`${f.path}/spectator-links`, { account: 'player_1', method,
      ...(method === 'POST' ? { body: { action: 'create' } } : {}) })).status, 403);
  }
  // Left attendance preserves a genuine organizer role; invalid membership does not.
  await f.competitions.changeScope('tournament', f.event.id, scope => { scope.members[f.event.me].status = 'removed'; });
  assert.equal((await f.request(`${f.path}/spectator`, { account: null, viewerToken: issued.viewerToken })).status, 403);
  assert.equal((await f.request(`${f.path}/spectator-links`, { method: 'POST', body: { action: 'create' } })).status, 403);
  await f.competitions.changeScope('tournament', f.event.id, scope => { scope.members[f.event.me].status = 'active'; });
  issued = await f.createLink();
  await f.request('/api/account', { method: 'DELETE' });
  assert.equal((await f.request(`${f.path}/spectator`, { account: null, viewerToken: issued.viewerToken })).status, 403);
});

test('guest access never issues viewer links and erased entrant aliases are removed from an existing board', async t => {
  const f = await fixture(t);
  const guest = (await f.request('/api/competitions/join', { account: null, method: 'POST', body: {
    token: f.invite.token, displayName: 'Guest Alias', requestId: 'spectator_guest_entry',
  } })).data;
  const issued = await f.createLink();
  for (const method of ['GET', 'POST']) {
    assert.equal((await f.request(`${f.path}/spectator-links`, { account: null, guestToken: guest.guestToken, method,
      ...(method === 'POST' ? { body: { action: 'create' } } : {}) })).status, 403);
  }
  await f.request('/api/account', { account: 'player_0', method: 'DELETE' });
  const board = (await f.request(`${f.path}/spectator`, { account: null, viewerToken: issued.viewerToken })).data;
  assert.ok(board.standings.some(row => row.alias === 'Guest Alias'));
  assert.ok(board.standings.some(row => row.alias === 'Deleted member'));
  assert.equal(JSON.stringify(board).includes('Player 0'), false);
});

test('spectator board exposes only aliases and confirmed totals, without recovering rooms or writing activity', async t => {
  const f = await fixture(t);
  const issued = await f.createLink();
  const ids = f.entrants.map(row => row.me);
  await f.competitions.changeScope('tournament', f.event.id, scope => {
    scope.status = 'playing';
    scope.rounds = [{ id: 'round_private', number: 1, status: 'playing', seed: 'private_seed',
      startedAt: f.now(), endsAt: f.now() + 3_600_000,
      assignments: [
        { id: 'assignment_pending', participantIds: ids.slice(0, 2), hostId: ids[0], gameId: 'game_pending',
          clock: { phase: 'extra_turns', remaining: 3, sourceGameId: 'game_pending' }, clockActions: { private_retry: 'finish_turn' } },
        { id: 'assignment_confirmed', participantIds: ids.slice(2), hostId: ids[2], gameId: 'game_confirmed' },
        { id: 'assignment_cancelled', participantIds: [], cancelled: true },
      ] }];
    scope.games = {
      game_pending: { starterIds: ids.slice(0, 2), original: { winnerId: ids[0], inferredOrder: ids.slice(0, 2).map(id => [id]) }, revisions: [] },
      game_confirmed: { starterIds: ids.slice(2), revisions: [{ by: f.event.me, order: ids.slice(2).map(id => [id]), reasonCode: 'private_reason', requestId: 'private_revision' }] },
    };
    scope.tables = { private_table: { roomCode: 'SECRET', assignmentId: 'assignment_pending', seats: {}, captures: {} } };
    // Totals are reconstructed from confirmed results, never an unconfirmed winner or stale cache.
    scope.standings = { [ids[0]]: { points: 99, pointsUnits: 83160, gamesPlayed: 9 } };
  });
  const before = JSON.stringify([...f.store.values.entries()]);
  for (const method of ['ensureRoom', 'restoreRoom', 'heartbeat']) f.service[method] = () => { throw new Error(`Spectators must not call ${method}`); };
  const originalUpdate = f.store.update;
  f.store.update = () => { throw new Error('Spectators must not write'); };
  t.after(() => { f.store.update = originalUpdate; });
  const response = await f.request(`${f.path}/spectator`, { account: null, viewerToken: issued.viewerToken });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  const board = response.data;
  assert.equal(board.name, 'Private Friday');
  assert.equal(board.roundNumber, 1); assert.equal(board.plannedRounds, 2);
  assert.equal(board.serverNow, f.now()); assert.equal(board.expiresAt, issued.expiresAt);
  assert.deepEqual(board.timing, { startedAt: f.now(), endsAt: f.now() + 3_600_000 });
  assert.deepEqual(board.resultCounts, { total: 3, confirmed: 1, awaitingConfirmation: 1, playing: 0, cancelled: 1 });
  assert.deepEqual(board.rounds[0].assignments[0], { tableNumber: 1, status: 'awaiting_confirmation', participants: ['Player 0', 'Player 1'], clock: { phase: 'extra_turns', remaining: 3 } });
  assert.deepEqual(board.standings.find(row => row.alias === 'Player 0'), { alias: 'Player 0', points: 0, gamesPlayed: 0, rank: 2 });
  assert.deepEqual(board.standings.find(row => row.alias === 'Player 2'), { alias: 'Player 2', points: 3, gamesPlayed: 1, rank: 1 });
  assert.equal(/SECRET|private_|identityId|accountId|entrant_|roomCode|guestAccess|revision|participantIds|hostId|sourceGameId|secretHash/.test(JSON.stringify(board)), false);
  assert.equal(JSON.stringify([...f.store.values.entries()]), before);
});

test('viewer credentials cannot access members, guest keys, seats, counters, clocks, results, or link controls', async t => {
  const f = await fixture(t);
  const issued = await f.createLink();
  const connectionId = f.service.createConnection().connectionId;
  const secondConnection = f.service.createConnection().connectionId;
  const room = f.service.createRoom(connectionId, { playerCount: 2, startingLife: 40 });
  const code = room.snapshot.code;
  const cases = [
    [f.path, 'GET'], [`${f.path}/history`, 'GET'], [`${f.path}/spectator-links`, 'GET'],
    [`${f.path}/members`, 'POST', { action: 'leave' }], [`${f.path}/guest-access`, 'POST', { targetId: f.entrants[0].me }],
    [`${f.path}/spectator-links`, 'POST', { action: 'create' }], [`${f.path}/rounds/prepare`, 'POST', {}],
    [`${f.path}/clock/assignment_private`, 'POST', { action: 'time_called', requestId: 'spectator_clock' }],
    [`${f.path}/games/private/confirm`, 'POST', { order: [], baseRevision: 0, requestId: 'spectator_result' }],
    [`${f.path}/release-table`, 'POST', { assignmentId: 'assignment_private' }],
    ['/api/competitions/tables/claim', 'POST', { code }],
    [`/api/rooms/${code}`, 'GET'], [`/api/rooms/${code}/claim`, 'POST', { seatId: 1 }],
    [`/api/rooms/${code}/adjust`, 'POST', { counter: 'life', delta: -1 }],
    [`/api/rooms/${code}/start-game`, 'POST', { baseVersion: room.snapshot.version }],
    ['/api/connections/heartbeat', 'POST', {}], [`/api/recovery/${code}`, 'POST', { hostRecoveryKey: room.hostRecoveryKey }],
  ];
  for (const [path, method, body] of cases) {
    const response = await f.request(path, { account: null, viewerToken: issued.viewerToken, connectionId: method === 'POST' && path.endsWith('/claim') ? secondConnection : connectionId, method, body });
    assert.equal(response.status, 403, `${method} ${path}: ${JSON.stringify(response.data)}`);
  }
  assert.equal((await f.request(`${f.path}/members`, { account: 'host', viewerToken: issued.viewerToken, method: 'POST', body: { action: 'leave' } })).status, 403);
  assert.equal((await f.request(`${f.path}/members`, { account: 'host', viewerToken: '', method: 'POST', body: { action: 'leave' } })).status, 403);
  assert.equal((await f.request(f.path, { account: null, guestToken: issued.viewerToken })).status, 403);
  assert.equal(f.service.room(code).seats[0].counters.life, 40);
  assert.equal(f.service.room(code).seats[1].claimed, false);
});

test('event hosts can release an unstarted table through HTTP while entrants cannot', async t => {
  const f = await fixture(t, { count: 2 });
  for (const body of [null, [], 'assignment_private', {}, { assignmentId: 12 }]) {
    assert.equal((await f.request(`${f.path}/release-table`, { method: 'POST', body })).status, 400);
  }
  const prepared = (await f.request(`${f.path}/rounds/prepare`, { method: 'POST', body: {} })).data;
  const assignment = prepared.rounds[0].assignments[0];
  const tableHostIndex = f.entrants.findIndex(row => row.me === assignment.hostId);
  const connectionId = f.service.createConnection({ supportedTableProtocols: [1, 2] }).connectionId;
  const created = f.service.createRoom(connectionId, { playerCount: 2, startingLife: 40 });
  const code = created.snapshot.code;
  const bound = await f.request('/api/competitions/tables/bind', { account: `player_${tableHostIndex}`, method: 'POST', connectionId,
    body: { kind: 'tournament', id: f.event.id, assignmentId: assignment.id, code } });
  assert.equal(bound.status, 200, JSON.stringify(bound.data));
  const input = { method: 'POST', body: { assignmentId: assignment.id } };
  assert.equal((await f.request(`${f.path}/release-table`, { ...input, account: `player_${tableHostIndex}` })).status, 403);
  const released = await f.request(`${f.path}/release-table`, input);
  assert.equal(released.status, 200, JSON.stringify(released.data));
  assert.equal(released.data.rounds[0].assignments[0].roomCode, null);
  const restarted = await f.request(`/api/rooms/${code}/start-game`, { method: 'POST', connectionId, body: { baseVersion: f.service.room(code).version } });
  assert.equal(restarted.status, 409);
  assert.equal(restarted.data.error.code, 'EVENT_TABLE_RELEASED');
});
