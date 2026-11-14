import assert from 'node:assert/strict';
import test from 'node:test';
import { createRealtimeServer } from '../src/app.js';
import { AccountHistory, MemoryAccountHistoryStore } from '../src/account-history.js';
import { FirebasePlaytestLedger, MemoryPlaytestLedger } from '../src/playtest-ledger.js';
import { Competitions, competitionStoreForEnvironment } from '../src/competitions.js';
import { CompetitionIdentityStore } from '../src/competition-identity-store.js';
import { CompetitionScopeStore } from '../src/competition-scope-store.js';
import { CompetitionRecovery } from '../src/competition-recovery.js';
import { startCompetitionRestFixture } from '../../qa/competition-rest-fixture.mjs';

async function fixture(t, databaseOptions) {
  const database = await startCompetitionRestFixture(databaseOptions), servers = [];
  t.after(async () => { for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } await database.close(); });
  const history = new AccountHistory({ store: new MemoryAccountHistoryStore() });
  async function open({ partitioned = true } = {}) {
    const writer = new FirebasePlaytestLedger({ databaseUrl: database.url, clientEmail: 'fixture', privateKey: 'fixture' });
    writer.accessToken = async () => 'local-fixture-only';
    const store = competitionStoreForEnvironment(writer, 'qa');
    const identities = new CompetitionIdentityStore({ store });
    const scopeStore = partitioned ? new CompetitionScopeStore({ identities }) : null;
    const domain = new Competitions({ store, identityStore: identities, scopeStore });
    const instance = createRealtimeServer({ appEnv: 'test', competitions: domain, ledger: new MemoryPlaytestLedger(), accountHistory: history,
      accountVerifier: { verify: async token => ({ providerSubject: token }) } });
    await new Promise(resolve => instance.server.listen(0, '127.0.0.1', resolve)); servers.push(instance.server);
    const origin = `http://127.0.0.1:${instance.server.address().port}`;
    const request = async (path, { token = 'host', method = 'GET', body, guestToken, connectionId, timeoutMs = 15000 } = {}) => {
      const response = await fetch(origin + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}), ...(guestToken ? { 'x-event-token': guestToken } : {}),
        ...(connectionId ? { 'x-connection-id': connectionId } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(timeoutMs) });
      return { status: response.status, data: response.status === 204 ? {} : await response.json() };
    };
    const ok = async (...args) => { const result = await request(...args); assert.ok(result.status >= 200 && result.status < 300, JSON.stringify(result)); return result.data; };
    return { ...instance, domain, scopeStore, request, ok };
  }
  return { ...await open(), database, open };
}
const post = (body, extra = {}) => ({ method: 'POST', body, ...extra });
const privateDto = value => assert.equal(/accountKey|identityId|ownerHash|guestAccessHash|secretHash|identity_/.test(JSON.stringify(value)), false);
const nativeOnly = f => assert.ok(f.database.calls.every(call => call.path !== '/qa/competitions/directory.json'));
async function nativeTableHost(f, actorType) {
  if (actorType === 'account') return { scope: await f.ok('/api/competitions/pods', post({ name: 'Compound Pod', displayName: 'Host' })) };
  const scope = await f.ok('/api/competitions/tournaments', post({ name: 'Compound guest event', displayName: 'Host', rounds: 1, preferredSize: 2 }));
  const invite = await f.ok(`/api/competitions/tournament/${scope.id}/invites`, post({})), entrants = [];
  for (let index = 0; index < 2; index++) entrants.push(await f.ok('/api/competitions/join', post({ token: invite.token,
    displayName: `Guest ${index}`, requestId: `compound_guest_${index}` }, { token: null })));
  const prepared = await f.ok(`/api/competitions/tournament/${scope.id}/rounds/prepare`, post({})), assignment = prepared.rounds[0].assignments[0];
  return { scope, assignment, guestToken: entrants.find(row => row.me === assignment.hostId).guestToken };
}

test('partitioned Pod HTTP permissions, aliases, readmission and lists survive a fresh app instance', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const pod = await f.ok('/api/competitions/pods', post({ name: 'Partitioned Pod', displayName: 'Host' }));
  assert.equal(f.database.read(`qa/competitions/pods/${pod.id}.json`), null);
  assert.equal(f.database.read(`qa/competitions-v2/groups/${pod.id}/head.json`).schemaVersion, 2);
  const invite = await f.ok(`/api/competitions/pod/${pod.id}/invites`, post({}));
  const member = await f.ok('/api/competitions/join', post({ token: invite.token, displayName: 'Member' }, { token: 'member' }));
  assert.equal((await f.request(`/api/competitions/pod/${pod.id}`, { token: 'outsider' })).status, 403);
  await f.ok(`/api/competitions/pod/${pod.id}/members`, post({ action: 'remove', targetId: member.me }));
  assert.equal((await f.request('/api/competitions/join', post({ token: invite.token, displayName: 'Member' }, { token: 'member' }))).status, 403);
  const readmit = await f.ok(`/api/competitions/pod/${pod.id}/invites`, post({}));
  assert.equal((await f.ok('/api/competitions/join', post({ token: readmit.token, displayName: 'Member' }, { token: 'member' }))).me, member.me);
  await f.ok(`/api/competitions/pod/${pod.id}/members`, post({ action: 'rename', name: 'Renamed Pod' }));
  const fresh = await f.open();
  const loaded = await fresh.ok(`/api/competitions/pod/${pod.id}`, { token: 'member' });
  assert.equal(loaded.name, 'Renamed Pod'); assert.equal(loaded.members.length, 2); privateDto(loaded);
  assert.ok((await fresh.ok('/api/competitions/mine', { token: 'member' })).pods.some(row => row.id === pod.id));
  assert.ok(loaded.audit.some(row => row.action === 'pod_renamed'));
  nativeOnly(f);
});

test('partitioned tournament guest/cohost/seating HTTP uses separate control rows and retains permission rules', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const event = await f.ok('/api/competitions/tournaments', post({ name: 'Partitioned event', displayName: 'Host', rounds: 2, preferredSize: 2 }));
  assert.equal(f.database.read(`qa/competitions/tournaments/${event.id}.json`), null);
  const invite = await f.ok(`/api/competitions/tournament/${event.id}/invites`, post({}));
  const guest = await f.ok('/api/competitions/join', post({ token: invite.token, displayName: 'Guest', requestId: 'partitioned_guest' }, { token: null }));
  const member = await f.ok('/api/competitions/join', post({ token: invite.token, displayName: 'Member' }, { token: 'member' }));
  assert.equal((await f.request(`/api/competitions/tournament/${event.id}/rounds/prepare`, post({}, { token: null, guestToken: guest.guestToken }))).status, 403);
  await f.ok(`/api/competitions/tournament/${event.id}/members`, post({ action: 'cohost', targetId: member.me, enabled: true }));
  const prepared = await f.ok(`/api/competitions/tournament/${event.id}/rounds/prepare`, post({}, { token: 'member' }));
  const started = await f.ok(`/api/competitions/tournament/${event.id}/rounds/start`, post({ roundId: prepared.rounds[0].id, baseVersion: prepared.version }, { token: 'member' }));
  assert.equal(started.status, 'playing'); privateDto(started);
  const head = f.database.read(`qa/competitions-v2/groups/${event.id}/head.json`);
  assert.ok(Object.keys(head.keys.rounds).length > 0); assert.ok(Object.keys(head.keys.members).length === 3);
  nativeOnly(f);
});

test('partitioned recovery discovers registered groups without a global directory or remembered IDs', { timeout: 15000 }, async t => {
  const f = await fixture(t), pod = await f.ok('/api/competitions/pods', post({ name: 'Recover Pod', displayName: 'Host' }));
  const fresh = await f.open(), errors = [];
  const recovery = new CompetitionRecovery({ domain: fresh.domain, tables: fresh.competitionTables, logger: { error: (...args) => errors.push(args) } });
  f.database.calls.length = 0;
  await recovery.tick();
  assert.deepEqual(errors, []); assert.equal(recovery.discovered, true);
  assert.equal((await fresh.ok(`/api/competitions/pod/${pod.id}`)).name, 'Recover Pod');
  const pages = f.database.calls.filter(call => /\/(group-registry|group-work)\.json$/.test(call.path));
  assert.ok(pages.length >= 2); assert.ok(pages.every(call => call.query));
  nativeOnly(f);
});

test('the partitioned-capable app keeps existing legacy groups readable and writable', { timeout: 15000 }, async t => {
  const f = await fixture(t), old = await f.open({ partitioned: false });
  const pod = await old.ok('/api/competitions/pods', post({ name: 'Legacy Pod', displayName: 'Host' }));
  assert.equal(f.database.read(`qa/competitions/pods/${pod.id}.json`).schemaVersion, 1);
  assert.equal((await f.ok(`/api/competitions/pod/${pod.id}`)).name, 'Legacy Pod');
  await f.ok(`/api/competitions/pod/${pod.id}/members`, post({ action: 'rename', name: 'Legacy still plays' }));
  assert.equal((await old.ok(`/api/competitions/pod/${pod.id}`)).name, 'Legacy still plays');
  assert.equal(f.database.read(`qa/competitions-v2/groups/${pod.id}/head.json`), null);
});

test('scope callbacks reject asynchronous edits before publishing an incomplete intent', { timeout: 15000 }, async t => {
  const f = await fixture(t), pod = await f.ok('/api/competitions/pods', post({ name: 'Synchronous control', displayName: 'Host' }));
  const version = pod.version;
  await assert.rejects(f.domain.changeScope('pod', pod.id, async scope => { scope.name = 'Invalid async edit'; }), /synchronous/);
  const unchanged = await f.ok(`/api/competitions/pod/${pod.id}`);
  assert.equal(unchanged.version, version); assert.equal(unchanged.name, 'Synchronous control');
});

test('the admitted intent contains the successful callback payload rather than its stale preparation', { timeout: 15000 }, async t => {
  const f = await fixture(t), pod = await f.ok('/api/competitions/pods', post({ name: 'Before fresh input', displayName: 'Host' }));
  let current = 'Prepared input'; const observations = [];
  const begin = f.scopeStore.control.begin.bind(f.scopeStore.control);
  f.scopeStore.control.begin = (...args) => { current = 'Admission input'; return begin(...args); };
  await f.domain.changeScope('pod', pod.id, scope => { observations.push(current); scope.name = current; });
  assert.deepEqual(observations, ['Prepared input', 'Admission input']);
  assert.equal((await f.ok(`/api/competitions/pod/${pod.id}`)).name, 'Admission input');
});

test('independent audited HTTP edits retry a stale version instead of conflicting on the other edit audit key', { timeout: 20000 }, async t => {
  let release, entered, held = false;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  t.after(() => release());
  const f = await fixture(t), pod = await f.ok('/api/competitions/pods', post({ name: 'Audit race', displayName: 'Host' }));
  const second = await f.open(), begin = second.scopeStore.control.begin.bind(second.scopeStore.control);
  second.scopeStore.control.begin = async (...args) => { if (!held) { held = true; entered(); await gate; } return begin(...args); };
  const delayed = second.request(`/api/competitions/pod/${pod.id}/members`, post({ action: 'rename', name: 'Second audit edit' }));
  await started;
  await f.ok(`/api/competitions/pod/${pod.id}/members`, post({ action: 'rename', name: 'First audit edit' }));
  release();
  const response = await delayed; assert.equal(response.status, 200, JSON.stringify(response));
  assert.equal(response.data.name, 'Second audit edit'); assert.equal(response.data.version, pod.version + 2);
  assert.equal(response.data.audit.filter(row => row.action === 'pod_renamed').length, 2);
});

test('a delayed HTTP edit is reauthorized after another app demotes its actor', { timeout: 20000 }, async t => {
  let release, entered, target = null, held = false;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  t.after(() => release());
  const f = await fixture(t, { beforeConditionalPut: async ({ path }) => {
    if (!held && path === target) { held = true; entered(); await gate; }
  } });
  const pod = await f.ok('/api/competitions/pods', post({ name: 'Permission race', displayName: 'Host' }));
  const invite = await f.ok(`/api/competitions/pod/${pod.id}/invites`, post({}));
  const peer = await f.ok('/api/competitions/join', post({ token: invite.token, displayName: 'Peer' }, { token: 'peer' }));
  await f.ok(`/api/competitions/pod/${pod.id}/members`, post({ action: 'admin', targetId: peer.me, enabled: true }));
  const second = await f.open(); target = `/qa/competitions-v2/groups/${pod.id}/head.json`;
  const delayed = f.request(`/api/competitions/pod/${pod.id}/members`, post({ action: 'rename', name: 'Stale unauthorized title' }));
  await started;
  await second.ok(`/api/competitions/pod/${pod.id}/members`, post({ action: 'admin', targetId: pod.me, enabled: false }, { token: 'peer' }));
  release();
  assert.equal((await delayed).status, 403);
  const current = await second.ok(`/api/competitions/pod/${pod.id}`, { token: 'peer' });
  assert.equal(current.name, 'Permission race'); assert.equal(current.members.find(row => row.id === pod.me).role, 'member');
  assert.equal(current.audit.some(row => row.action === 'pod_renamed'), false);
  nativeOnly(f);
});

test('stalled native recovery does not delay casual HTTP life changes or add competition requests to them', { timeout: 15000 }, async t => {
  let release, entered, target = null, held = false;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  t.after(() => release());
  const f = await fixture(t, { beforeConditionalPut: async ({ path }) => {
    if (!held && path === target) { held = true; entered(); await gate; }
  } });
  const pod = await f.ok('/api/competitions/pods', post({ name: 'Recovery stall', displayName: 'Host' }));
  const metadata = JSON.parse(f.database.read(`qa/competitions-v2/groups/${pod.id}/rows/metadata/group.json`).json);
  await f.scopeStore.control.begin('pod', pod.id, { operationId: 'control_stalled_recovery', baseVersion: pod.version,
    changes: [{ section: 'metadata', key: 'group', value: { ...metadata, name: 'Recovered title' } }] });
  target = `/qa/competitions-v2/groups/${pod.id}/rows/metadata/group.json`;
  const recovery = new CompetitionRecovery({ domain: f.domain, tables: f.competitionTables });
  const pending = recovery.tick(); await started;
  const host = f.service.createConnection().connectionId, guest = f.service.createConnection().connectionId;
  const code = f.service.createRoom(host, { playerCount: 2, startingLife: 40 }).snapshot.code;
  f.service.claimSeat(code, guest, { seatId: 1 });
  f.service.startGame(code, host, { baseVersion: f.service.room(code).version });
  const before = f.database.calls.length;
  const response = await f.request(`/api/rooms/${code}/adjust`, post({ counter: 'life', delta: -7 }, { connectionId: guest, timeoutMs: 2000 }));
  assert.equal(response.status, 200); assert.equal(response.data.snapshot.seats[1].counters.life, 33);
  assert.equal(f.database.calls.length, before, 'No competition request may originate from the life update.');
  release(); await pending;
});

test('account deletion cancels an HTTP edit reserved before its account decision', { timeout: 20000 }, async t => {
  const f = await fixture(t), pod = await f.ok('/api/competitions/pods', post({ name: 'Before account deletion', displayName: 'Host' }));
  const other = await f.open(); let release, entered, held = false;
  const started = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const begin = f.scopeStore.control.begin.bind(f.scopeStore.control);
  f.scopeStore.control.begin = async (...args) => {
    const result = await begin(...args);
    if (!held) { held = true; entered(); await gate; }
    return result;
  };
  const editing = f.request(`/api/competitions/pod/${pod.id}/members`, post({ action: 'rename', name: 'Unapproved late name' }));
  await started;
  assert.equal((await other.request('/api/account', { method: 'DELETE' })).status, 204);
  release(); const reply = await editing;
  assert.equal(reply.status, 403);
  const current = await other.domain.readScope('pod', pod.id);
  assert.equal(current.name, 'Before account deletion');
  assert.equal(current.members[pod.me].status, 'erased');
  assert.equal(current.audit.some(row => row.action === 'pod_renamed'), false);
  const head = f.database.read(`qa/competitions-v2/groups/${pod.id}/head.json`);
  assert.equal(head.pending, undefined); assert.equal(head.settling, undefined);
  nativeOnly(f);
});

test('account deletion fences an HTTP edit whose reservation PUT has not arrived', { timeout: 20000 }, async t => {
  let target = null, release, entered, held = false;
  const started = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const f = await fixture(t, { beforeConditionalPut: async ({ path }) => {
    if (!held && path === target) { held = true; entered(); await gate; }
  } });
  const pod = await f.ok('/api/competitions/pods', post({ name: 'Before delayed PUT', displayName: 'Host' }));
  const other = await f.open(); target = `/qa/competitions-v2/groups/${pod.id}/head.json`;
  const editing = f.request(`/api/competitions/pod/${pod.id}/members`, post({ action: 'rename', name: 'After deletion' }));
  await started;
  assert.equal((await other.request('/api/account', { method: 'DELETE' })).status, 204);
  release(); assert.equal((await editing).status, 403);
  const current = await other.domain.readScope('pod', pod.id);
  assert.equal(current.name, 'Before delayed PUT'); assert.equal(current.members[pod.me].status, 'erased');
  assert.equal(current.audit.some(row => row.action === 'pod_renamed'), false);
});

for (const actorType of ['account', 'guest']) {
  test(`native ${actorType} host records complete group setup before reserving its Table claim`, { timeout: 30000 }, async t => {
    let release, entered, held = false;
    const started = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
    t.after(() => release());
    const f = await fixture(t, { beforeConditionalPut: async ({ path }) => {
      if (!held && path.includes('/competitions-v2/table-claims/')) { held = true; entered(); await gate; }
    } });
    const { scope, assignment, guestToken } = await nativeTableHost(f, actorType);
    const host = f.service.createConnection().connectionId;
    const code = f.service.createRoom(host, { playerCount: 2, startingLife: 40 }).snapshot.code;
    const linking = f.request('/api/competitions/tables/bind', post({ kind: scope.kind, id: scope.id, code,
      ...(assignment ? { assignmentId: assignment.id } : {}) }, { token: guestToken ? null : 'host', guestToken, connectionId: host }));
    let response;
    try {
      await started;
      const head = f.database.read(`qa/competitions-v2/groups/${scope.id}/head.json`);
      assert.ok(head.pending?.authorization?.claim, 'The complete durable intent must precede the first claim PUT.');
      const changes = JSON.parse(head.pending.json).changes;
      assert.ok(changes.some(row => row.section === 'tables' && row.key === head.pending.authorization.claim.key && row.value.roomCode === code));
      assert.equal(head.pending.authorization.type, actorType === 'account' ? 'account' : 'capability');
    } finally { release(); response = await linking; }
    assert.equal(response.status, 200, JSON.stringify(response)); assert.equal(response.data.seatLinked, true); privateDto(response.data);
    const head = f.database.read(`qa/competitions-v2/groups/${scope.id}/head.json`);
    assert.equal(head.pending, undefined); assert.equal(head.settling, undefined);
    assert.equal(Object.values(f.database.read('qa/competitions-v2/table-claims.json')).filter(row => row.roomCode === code)[0].state, 'ready');
    for (const account of Object.values(f.database.read('qa/competitions-v2/accounts.json'))) {
      assert.equal(account.tableClaims, undefined); assert.equal(account.controlOperations, undefined);
    }
    nativeOnly(f);
  });

  test(`native ${actorType} Table setup cancels if the real seat is reclaimed before its decision`, { timeout: 30000 }, async t => {
    const f = await fixture(t), { scope, assignment, guestToken } = await nativeTableHost(f, actorType);
    const host = f.service.createConnection().connectionId, room = f.service.createRoom(host, { playerCount: 2, startingLife: 40 });
    let entered, release;
    const started = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
    t.after(() => release());
    const provider = f.domain.identityStore.tableSetup, commit = provider.commit.bind(provider);
    provider.commit = async (...args) => { entered(); await gate; return commit(...args); };
    const linking = f.request('/api/competitions/tables/bind', post({ kind: scope.kind, id: scope.id, code: room.snapshot.code,
      ...(assignment ? { assignmentId: assignment.id } : {}) }, { token: guestToken ? null : 'host', guestToken, connectionId: host }));
    await started;
    const replacement = f.service.createConnection().connectionId;
    f.service.claimSeat(room.snapshot.code, replacement, { seatId: 0, reclaimToken: room.reclaimToken });
    release(); const response = await linking;
    assert.equal(response.status, 403); assert.equal(response.data.error.code, 'NOT_SEAT_OWNER');
    const current = await f.domain.readScope(scope.kind, scope.id);
    assert.equal(Object.keys(current.tables).length, 0);
    assert.equal(Object.values(f.database.read('qa/competitions-v2/table-claims.json'))[0].state, 'cancelled');
    assert.equal(f.service.room(room.snapshot.code).seats[0].ownerConnectionId, replacement);
    nativeOnly(f);
  });
}
