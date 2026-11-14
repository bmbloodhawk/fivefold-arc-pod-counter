import assert from 'node:assert/strict';
import test from 'node:test';
import { Competitions, scopePath } from '../src/competitions.js';
import { MemoryAccountHistoryStore, AccountHistory } from '../src/account-history.js';
import { createRealtimeServer } from '../src/app.js';
import { MemoryPlaytestLedger } from '../src/playtest-ledger.js';
import { CompetitionRecovery } from '../src/competition-recovery.js';

const directoryPath = 'competitions/directory.json';
function fixture() {
  const store = new MemoryAccountHistoryStore(); let sequence = 0, beforePodWrite = null, failDirectory = false;
  const adapter = { read: path => store.read(path), update: async (path, change) => {
    if (path === directoryPath && failDirectory) throw new Error('Fixture directory outage');
    if (path.startsWith('competitions/pods/') && beforePodWrite) {
      const action = beforePodWrite; beforePodWrite = null; await action(path);
    }
    return store.update(path, change);
  } };
  const domain = new Competitions({ store: adapter, createId: () => `delete${++sequence}` });
  return { store, adapter, domain, intercept: action => { beforePodWrite = action; }, failDirectory: value => { failDirectory = value; } };
}
async function group(f) {
  const pod = await f.domain.createPod('owner', { name: 'Delete this Pod', displayName: 'Owner in deleted Pod' });
  const invite = await f.domain.invite('owner', 'pod', pod.id);
  const member = await f.domain.joinPod('member', invite.token, { displayName: 'Member in deleted Pod' });
  return { pod, invite, member };
}
const remove = (domain, pod) => domain.deletePod('owner', pod.id, { confirmationName: pod.name });

test('deletion removes the whole Pod and directory references while preserving other groups and account data', async () => {
  const f = fixture(), { pod, invite } = await group(f);
  const other = await f.domain.createPod('owner', { name: 'Keep this Pod', displayName: 'Owner elsewhere' });
  await f.store.update(scopePath('pod', pod.id), scope => ({ ...scope,
    games: { private: { original: {}, revisions: [], history: 'private Pod result' } }, standings: { rated: { rating: 1200 } } }));
  await f.store.update(directoryPath, dir => { dir.tables.old = { kind: 'pod', id: pod.id }; dir.tables.keep = { kind: 'pod', id: other.id }; return dir; });
  const accounts = (await f.domain.directory()).accounts;
  assert.deepEqual(await remove(f.domain, pod), { deleted: true });
  assert.deepEqual((await f.domain.list('owner')).pods.map(p => p.id), [other.id]);
  assert.deepEqual((await f.domain.list('member')).pods, []);
  await assert.rejects(() => f.domain.getPod('owner', pod.id), { status: 404 });
  await assert.rejects(() => f.domain.preview(invite.token), { status: 404 });
  await assert.rejects(() => f.domain.joinPod('member', invite.token, { displayName: 'Return' }), { status: 404 });
  const marker = await f.store.read(scopePath('pod', pod.id)), dir = await f.domain.directory();
  assert.equal(marker.deleted, true); assert.equal(marker.members, undefined); assert.equal(marker.games, undefined); assert.equal(marker.standings, undefined);
  assert.equal(JSON.stringify(marker).includes(pod.name), false);
  assert.equal(Object.keys(dir.aliases).some(key => key.startsWith(pod.id + '_')), false);
  assert.equal(Object.values(dir.scopes).some(refs => refs[pod.id]), false);
  assert.equal(dir.tables.old, undefined); assert.equal(dir.tables.keep.id, other.id);
  assert.deepEqual(dir.accounts, accounts); assert.equal((await f.domain.getPod('owner', other.id)).name, other.name);
});

test('members, outsiders, unsigned callers and a wrong confirmation cannot delete a Pod', async () => {
  const f = fixture(), { pod } = await group(f);
  await f.domain.createPod('outsider', { name: 'Outside', displayName: 'Outside' });
  for (const actor of ['member', 'outsider']) await assert.rejects(() => f.domain.deletePod(actor, pod.id, { confirmationName: pod.name }), { status: 403 });
  await assert.rejects(() => f.domain.deletePod(null, pod.id, { confirmationName: pod.name }), { status: 401 });
  await assert.rejects(() => f.domain.deletePod('owner', pod.id, { confirmationName: 'Wrong Pod' }), { status: 400 });
  assert.equal((await f.domain.getPod('owner', pod.id)).members.length, 2);
});

test('permission, current name and accepted captures are rechecked against the conditional write state', async () => {
  for (const race of ['demotion', 'rename', 'game start']) {
    const f = fixture(), { pod } = await group(f);
    f.intercept(path => f.store.update(path, scope => {
      if (race === 'demotion') scope.members[pod.me].role = 'member';
      if (race === 'rename') scope.name = 'Renamed Pod';
      if (race === 'game start') scope.tables.race = { captures: { active: { status: 'accepted', seats: [] } } };
      return scope;
    }));
    await assert.rejects(() => remove(f.domain, pod), { status: race === 'demotion' ? 403 : race === 'rename' ? 400 : 409 });
    assert.equal((await f.store.read(scopePath('pod', pod.id))).deleted, undefined);
  }
});

test('a new domain instance and list read finish deletion after interruption during directory cleanup', async () => {
  const f = fixture(), { pod } = await group(f);
  f.failDirectory(true);
  await assert.rejects(() => remove(f.domain, pod), /Fixture directory outage/);
  assert.equal((await f.store.read(scopePath('pod', pod.id))).deleted, true);
  await assert.rejects(() => f.domain.list('member'), /Fixture directory outage/);
  f.failDirectory(false);
  const restarted = new Competitions({ store: f.adapter });
  assert.deepEqual((await restarted.list('member')).pods, []);
  const dir = await restarted.directory();
  assert.equal(dir.deletedScopes[pod.id], true);
  assert.equal(Object.keys(dir.aliases).some(key => key.startsWith(pod.id + '_')), false);
  assert.equal(Object.values(dir.scopes).some(refs => refs[pod.id]), false);
  assert.deepEqual(await remove(restarted, pod), { deleted: true });
});

test('late alias, guest-name, binding and scope updates cannot resurrect a deleted Pod', async () => {
  const f = fixture(), { pod } = await group(f), identity = await f.domain.identity('owner');
  await remove(f.domain, pod);
  await assert.rejects(() => f.domain.setAlias(identity, pod.id, pod.me, 'Resurrected'), { status: 404 });
  await assert.rejects(() => f.domain.setGuestAlias(pod.id, 'guest_late', 'Resurrected'), { status: 404 });
  await assert.rejects(() => f.domain.claimTable('late', { kind: 'pod', id: pod.id, roomCode: 'ABCDEF' }), { status: 404 });
  await assert.rejects(() => f.domain.changeScope('pod', pod.id, scope => { scope.name = 'Resurrected'; }), { status: 404 });
  assert.equal(JSON.stringify([...f.store.values.values()]).includes('Resurrected'), false);
});

test('native/scoped activation remains outside the staging deletion feature', async () => {
  const f = fixture(), { pod } = await group(f); f.domain.scopeStore = {};
  await assert.rejects(() => remove(f.domain, pod), { status: 501 });
  assert.equal((await f.store.read(scopePath('pod', pod.id))).deleted, undefined);
});

test('deletion requires a bounded confirmation object instead of accepting other payload shapes', async () => {
  const f = fixture(), { pod } = await group(f);
  for (const input of [null, [], { confirmationName: pod.name, extra: true }, {}]) {
    await assert.rejects(() => f.domain.deletePod('owner', pod.id, input), { status: 400 });
  }
  assert.equal((await f.domain.getPod('owner', pod.id)).name, pod.name);
});

test('recovery retires confirmed deleted Pods but keeps transient failures pending', async () => {
  const pendingScopes = new Map([['pod:deleted', { kind: 'pod', id: 'deleted' }], ['pod:retry', { kind: 'pod', id: 'retry' }]]), errors = [];
  const tables = { pendingScopes, reconcile: async (_, id) => { throw Object.assign(new Error('Fixture unavailable'), id === 'deleted' ? { status: 404, code: 'POD_DELETED' } : {}); } };
  const recovery = new CompetitionRecovery({ domain: {}, tables, logger: { error: (...args) => errors.push(args) } });
  recovery.discovered = true; await recovery.tick();
  assert.equal(pendingScopes.has('pod:deleted'), false); assert.equal(pendingScopes.has('pod:retry'), true); assert.equal(errors.length, 1);
});

async function http(t, appEnv = 'staging') {
  const store = new MemoryAccountHistoryStore(), personal = new MemoryAccountHistoryStore();
  const instance = createRealtimeServer({ appEnv, competitionStore: store,
    accountHistory: new AccountHistory({ store: personal }), ledger: new MemoryPlaytestLedger(),
    accountVerifier: { verify: async token => {
      if (!token) throw Object.assign(new Error('Sign in'), { status: 401 });
      return { providerSubject: token };
    } } });
  await new Promise(resolve => instance.server.listen(0, '127.0.0.1', resolve));
  t.after(() => { instance.server.closeAllConnections(); return new Promise(resolve => instance.server.close(resolve)); });
  const origin = `http://127.0.0.1:${instance.server.address().port}`;
  const request = async (path, { token = 'owner', method = 'GET', body, connectionId } = {}) => {
    const r = await fetch(origin + '/api/competitions/' + path, { method, headers: {
      ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body ? { 'content-type': 'application/json' } : {}),
      ...(connectionId ? { 'x-connection-id': connectionId } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, data: await r.json() };
  };
  return { ...instance, store, personal, request };
}

test('staging advertises deletion and enforces auth, typed name, and idempotent HTTP deletion', async t => {
  const f = await http(t);
  assert.equal((await f.request('config', { token: null })).data.podDeletionEnabled, true);
  const pod = (await f.request('pods', { method: 'POST', body: { name: 'HTTP delete', displayName: 'Owner' } })).data;
  const target = `pod/${pod.id}`, input = { method: 'DELETE', body: { confirmationName: pod.name } };
  assert.equal((await f.request(target, { ...input, token: null })).status, 401);
  assert.equal((await f.request(target, { ...input, token: 'outsider' })).status, 403);
  assert.equal((await f.request(target, { method: 'DELETE', body: { confirmationName: 'Wrong' } })).status, 400);
  await f.personal.write('personal-history-fixture.json', { games: [{ id: 'keep-personal-game', winner: true }] });
  const profilesBefore = JSON.stringify([...f.personal.values]);
  assert.equal((await f.request(target, input)).status, 200);
  assert.deepEqual((await f.request(target, input)).data, { deleted: true });
  assert.equal((await f.request(target)).status, 404);
  assert.deepEqual((await f.request('mine')).data.pods, []);
  assert.equal(JSON.stringify([...f.personal.values]), profilesBefore);
});

test('production advertises deletion but only the owner can delete after confirming the current name', async t => {
  const f = await http(t, 'production');
  assert.equal((await f.request('config', { token: null })).data.podDeletionEnabled, true);
  const pod = (await f.request('pods', { method: 'POST', body: { name: 'Production owner deletion', displayName: 'Owner' } })).data;
  const invite = (await f.request(`pod/${pod.id}/invites`, { method: 'POST', body: {} })).data;
  const admin = (await f.request('join', { token: 'admin', method: 'POST', body: { token: invite.token, displayName: 'Admin' } })).data;
  assert.equal((await f.request(`pod/${pod.id}/members`, { method: 'POST', body: { action: 'admin', targetId: admin.me, enabled: true } })).status, 200);
  const current = (await f.request(`pod/${pod.id}`, { token: 'admin' })).data;
  assert.equal(current.role, 'admin'); assert.equal(current.canDelete, false);
  const input = { method: 'DELETE', body: { confirmationName: pod.name } };
  assert.equal((await f.request(`pod/${pod.id}`, { ...input, token: null })).status, 401);
  const denied = await f.request(`pod/${pod.id}`, { ...input, token: 'admin' });
  assert.equal(denied.status, 403); assert.equal(denied.data.error.code, 'POD_OWNER_REQUIRED');
  assert.equal((await f.request(`pod/${pod.id}`, { method: 'DELETE', body: { confirmationName: 'Wrong name' } })).status, 400);
  assert.equal((await f.request(`pod/${pod.id}`, input)).status, 200);
  assert.equal((await f.request(`pod/${pod.id}`)).status, 404);
});

test('an unsupported environment does not advertise or accept Pod deletion', async t => {
  const f = await http(t, 'test');
  assert.equal((await f.request('config')).data.podDeletionEnabled, false);
  const pod = (await f.request('pods', { method: 'POST', body: { name: 'Keep unsupported environment', displayName: 'Owner' } })).data;
  assert.equal((await f.request(`pod/${pod.id}`, { method: 'DELETE', body: { confirmationName: pod.name } })).status, 404);
  assert.equal((await f.request(`pod/${pod.id}`)).status, 200);
});

test('running Pod games block deletion; completed and reconciled games permit deletion without changing the Table', async t => {
  const f = await http(t);
  const pod = (await f.request('pods', { method: 'POST', body: { name: 'Live Pod', displayName: 'Owner' } })).data;
  const host = f.service.createConnection().connectionId, peer = f.service.createConnection().connectionId;
  const code = f.service.createRoom(host, { playerCount: 2, startingLife: 40 }).snapshot.code;
  f.service.claimSeat(code, peer, { seatId: 1, name: 'Guest' });
  assert.equal((await f.request('tables/bind', { method: 'POST', connectionId: host, body: { kind: 'pod', id: pod.id, code } })).status, 200);
  await f.competitionTables.start(code, host, { baseVersion: f.service.room(code).version });
  const input = { method: 'DELETE', body: { confirmationName: pod.name } };
  assert.equal((await f.request(`pod/${pod.id}`, input)).status, 409);
  f.service.adjustOwnSeat(code, peer, { counter: 'life', delta: -1, operationId: 'deletion-block-life-check' });
  assert.equal(f.service.room(code).seats[1].counters.life, 39);
  f.service.declareWinner(code, host, { baseVersion: f.service.room(code).version, winnerSeatId: 0, winCondition: 'concession' });
  await f.competitionTables.reconcile('pod', pod.id);
  const completed = f.service.snapshot(f.service.room(code));
  assert.equal((await f.request(`pod/${pod.id}`, input)).status, 200);
  assert.deepEqual(f.service.snapshot(f.service.room(code)), completed);
  assert.equal((await f.request(`tables/context?code=${code}`, { connectionId: host })).data.linked, false);
});
