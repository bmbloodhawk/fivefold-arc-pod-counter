import assert from 'node:assert/strict';
import test from 'node:test';
import { FirebasePlaytestLedger } from '../src/playtest-ledger.js';
import { competitionStoreForEnvironment } from '../src/competitions.js';
import { CompetitionControlStore } from '../src/competition-control-store.js';
import { startCompetitionRestFixture } from '../../qa/competition-rest-fixture.mjs';
import { digest } from '../src/competition-values.js';

async function fixture(t, options) {
  const database = await startCompetitionRestFixture(options);
  t.after(() => database.close());
  const writer = (fetchImpl = fetch) => {
    const ledger = new FirebasePlaytestLedger({ databaseUrl: database.url, clientEmail: 'fixture', privateKey: 'fixture', fetchImpl });
    ledger.accessToken = async () => 'local-fixture-only';
    return ledger;
  };
  const control = (fetchImpl, options = {}) => new CompetitionControlStore({ store: competitionStoreForEnvironment(writer(fetchImpl), 'qa'), finishAuthorization: async () => {}, ...options });
  return { database, writer, control };
}
const initial = id => ({ operationId: 'control_initial', baseVersion: 0, changes: [
  { section: 'metadata', key: 'group', value: { id, kind: 'pod', title: 'Synthetic Pod', createdAt: 1 } },
  { section: 'members', key: 'member_owner', value: { id: 'member_owner', identityId: 'identity_owner', role: 'admin', status: 'active' } },
] });
const headPath = id => `qa/competitions-v2/groups/${id}/head.json`;
const authorization = () => ({ type: 'account', accountKey: digest('synthetic-owner'), identityId: 'identity_owner',
  admissionRevision: 0, abortAfter: 30000 });

test('an undecided account reservation is discoverable but cannot write any control children', async t => {
  const f = await fixture(t), decisions = [], id = 'pod_undecided';
  const control = f.control(undefined, { resolveAuthorization: async ref => { decisions.push(ref); return 'pending'; } });
  const accepted = await control.begin('pod', id, initial(id), { authorization: authorization() });
  assert.equal(accepted.authorization.operationId, 'control_initial');
  assert.equal(accepted.authorization.payloadHash, f.database.read(headPath(id)).pending.payloadHash);
  f.database.calls.length = 0;
  const progress = await control.recover({ limit: 2, maxWrites: 4 });
  assert.equal(progress.writes, 0); assert.equal(progress.finished.length, 0);
  assert.equal(f.database.read(`qa/competitions-v2/groups/${id}/rows.json`), null);
  assert.ok(decisions.length > 0);
  assert.ok(f.database.calls.every(call => !/\/rows\//.test(call.path)));
  const other = f.control(); await other.begin('pod', 'pod_independent', initial('pod_independent'));
  assert.equal((await other.read('pod', 'pod_independent')).version, 1);
});

test('only a committed exact account decision releases frozen control publication', async t => {
  const f = await fixture(t), id = 'pod_authorized'; let state = 'pending';
  const control = f.control(undefined, { resolveAuthorization: async () => state });
  await control.begin('pod', id, initial(id), { authorization: authorization() });
  assert.equal((await control.resume('pod', id)).pending, true);
  state = 'committed';
  assert.equal((await control.read('pod', id)).rows.metadata.group.title, 'Synthetic Pod');
  assert.equal(f.database.read(`qa/competitions-v2/groups/${id}/operations/control_initial.json`).outcome, 'committed');
});

test('cancellation consumes the reserved version without applying rows or exposing an incomplete new group', async t => {
  const f = await fixture(t), id = 'pod_cancelled', control = f.control(undefined, { resolveAuthorization: async () => 'cancelled' });
  const auth = authorization();
  await control.begin('pod', id, initial(id), { authorization: auth });
  const finished = await control.resume('pod', id);
  assert.equal(finished.pending, false); assert.equal(finished.outcome, 'cancelled');
  assert.equal(f.database.read(headPath(id)).version, 1);
  assert.equal(f.database.read(`qa/competitions-v2/groups/${id}/rows.json`), null);
  assert.equal((await control.begin('pod', id, initial(id), { authorization: auth })).outcome, 'cancelled');
  await assert.rejects(control.read('pod', id), { code: 'COMPETITION_NOT_FOUND' });
  await assert.rejects(control.begin('pod', id, { ...initial(id), operationId: 'control_late' }, { authorization: auth }), { code: 'CONTROL_VERSION_CONFLICT' });
});

test('authorization is part of operation identity and requires an installed decision resolver', async t => {
  const f = await fixture(t), id = 'pod_actor_bound';
  await assert.rejects(f.control().begin('pod', id, initial(id), { authorization: authorization() }), { code: 'CONTROL_INPUT' });
  assert.equal(f.database.calls.length, 0);
  const control = f.control(undefined, { resolveAuthorization: async () => 'pending' });
  await control.begin('pod', id, initial(id), { authorization: authorization() });
  await assert.rejects(control.begin('pod', id, initial(id), { authorization: { ...authorization(), identityId: 'identity_other' } }), { code: 'CONTROL_OPERATION_CONFLICT' });
});

test('a delayed authorization finisher leaves a newer operation settlement intact', { timeout: 10000 }, async t => {
  const f = await fixture(t), id = 'pod_settlement_race';
  let releaseFirst, releaseSecond, enteredFirst, enteredSecond;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; }), secondGate = new Promise(resolve => { releaseSecond = resolve; });
  const firstStarted = new Promise(resolve => { enteredFirst = resolve; }), secondStarted = new Promise(resolve => { enteredSecond = resolve; });
  t.after(() => { releaseFirst(); releaseSecond(); });
  const first = f.control(undefined, { resolveAuthorization: async () => 'committed', finishAuthorization: async () => { enteredFirst(); await firstGate; } });
  const second = f.control(undefined, { resolveAuthorization: async () => 'committed', finishAuthorization: async ref => {
    if (ref.operationId === 'control_next') { enteredSecond(); await secondGate; }
  } });
  await first.begin('pod', id, initial(id), { authorization: authorization() });
  const finishing = first.resume('pod', id); await firstStarted;
  await second.resume('pod', id);
  await second.begin('pod', id, { operationId: 'control_next', baseVersion: 1,
    changes: [{ section: 'metadata', key: 'group', value: { id, kind: 'pod', title: 'New version' } }] }, { authorization: authorization() });
  const newer = second.resume('pod', id); await secondStarted;
  releaseFirst();
  try {
    await finishing;
    assert.equal(f.database.read(headPath(id)).settling.operationId, 'control_next');
  } finally { releaseSecond(); await newer; }
  assert.equal((await second.read('pod', id)).version, 2);
});

test('control admission and stable reads publish one coherent version with independent child rows', async t => {
  const f = await fixture(t), control = f.control(), id = 'pod_coherent';
  const accepted = await control.begin('pod', id, initial(id));
  assert.equal(accepted.pending, true);
  assert.equal(f.database.read(headPath(id)).version, 0);
  const state = await control.read('pod', id);
  assert.equal(state.version, 1);
  assert.equal(state.rows.metadata.group.title, 'Synthetic Pod');
  assert.equal(state.rows.members.member_owner.role, 'admin');
  assert.equal(f.database.read(headPath(id)).pending, undefined);
  assert.equal(f.database.read('qa/competitions-v2/group-work/' + id + '.json'), null);
  assert.ok(f.database.calls.every(call => !/competitions\/directory|\/games\//.test(call.path)));
});

test('same operation retries apply once; conflicting reuse, stale versions and another pending operation reject', async t => {
  const f = await fixture(t), a = f.control(), b = f.control(), id = 'pod_retries';
  await a.begin('pod', id, initial(id)); await b.resume('pod', id);
  const duplicate = await b.begin('pod', id, initial(id));
  assert.equal(duplicate.pending, false); assert.equal(duplicate.version, 1);
  await assert.rejects(b.begin('pod', id, { ...initial(id), changes: [{ section: 'metadata', key: 'group', value: { title: 'Conflicting' } }] }), { code: 'CONTROL_OPERATION_CONFLICT' });
  await assert.rejects(b.begin('pod', id, { ...initial(id), operationId: 'control_stale' }), { code: 'CONTROL_VERSION_CONFLICT' });
  await a.begin('pod', id, { operationId: 'control_next', baseVersion: 1, changes: [{ section: 'members', key: 'member_owner', value: null }] });
  await assert.rejects(b.begin('pod', id, { operationId: 'control_other', baseVersion: 1, changes: [{ section: 'metadata', key: 'group', value: { title: 'Other' } }] }), { code: 'CONTROL_PENDING' });
  await b.resume('pod', id); assert.equal((await a.read('pod', id)).version, 2);
});

test('admission freezes its version and row values before the first storage wait', async t => {
  const f = await fixture(t), control = f.control(), id = 'pod_frozen_input', value = initial(id);
  const admitted = control.begin('pod', id, value);
  value.baseVersion = 99;
  value.changes[0].value.title = 'Mutated after admission';
  await admitted;
  const state = await control.read('pod', id);
  assert.equal(state.version, 1);
  assert.equal(state.rows.metadata.group.title, 'Synthetic Pod');
});

test('a duplicate whose receipt read predates commit still resolves to the committed operation', { timeout: 10000 }, async t => {
  let release, entered, held = false;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  t.after(() => release());
  const f = await fixture(t), id = 'pod_commit_race', first = f.control();
  await first.begin('pod', id, initial(id));
  const retrying = f.control(async (url, options = {}) => {
    const response = await fetch(url, options);
    if (!held && !options.method && new URL(url).pathname.endsWith('/operations/control_initial.json')) { held = true; entered(); await gate; }
    return response;
  });
  const retry = retrying.begin('pod', id, initial(id)); await started;
  await first.resume('pod', id); release();
  assert.deepEqual(await retry, { operationId: 'control_initial', version: 1, pending: false, duplicate: true });
  assert.equal(f.database.read(headPath(id)).version, 1);
});

test('a delayed receipt read cannot admit reused operation input at a later group version', { timeout: 10000 }, async t => {
  let release, entered, held = false;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  t.after(() => release());
  const f = await fixture(t), id = 'pod_reuse_race', first = f.control();
  await first.begin('pod', id, initial(id));
  const later = f.control(async (url, options = {}) => {
    const response = await fetch(url, options);
    if (!held && !options.method && new URL(url).pathname.endsWith('/operations/control_initial.json')) { held = true; entered(); await gate; }
    return response;
  });
  const rejected = assert.rejects(later.begin('pod', id, { operationId: 'control_initial', baseVersion: 1,
    changes: [{ section: 'metadata', key: 'group', value: { id, kind: 'pod', title: 'Reused ID' } }] }), { code: 'CONTROL_OPERATION_CONFLICT' });
  await started; await first.resume('pod', id); release(); await rejected;
  assert.equal(f.database.read(headPath(id)).pending, undefined);
  assert.equal((await f.control().read('pod', id)).version, 1);
});

test('numeric row keys survive RTDB array shaping without phantom live entries', async t => {
  const f = await fixture(t), control = f.control(), id = 'pod_numeric_rows';
  await control.begin('pod', id, { operationId: 'control_numeric', baseVersion: 0, changes: [
    { section: 'metadata', key: 'group', value: { id, kind: 'pod' } },
    { section: 'members', key: '0', value: { status: 'active' } },
    { section: 'members', key: '2', value: { status: 'active' } },
  ] });
  assert.deepEqual(Object.keys((await control.read('pod', id)).rows.members), ['0', '2']);
  await control.begin('pod', id, { operationId: 'control_remove_numeric', baseVersion: 1,
    changes: [{ section: 'members', key: '0', value: null }] });
  assert.deepEqual(Object.keys((await control.read('pod', id)).rows.members), ['2']);
});

test('a next-version overflow rejects before any storage request', async t => {
  const f = await fixture(t);
  await assert.rejects(f.control().begin('pod', 'pod_overflow', { ...initial('pod_overflow'), baseVersion: Number.MAX_SAFE_INTEGER - 1 }), { code: 'CONTROL_INPUT' });
  assert.equal(f.database.calls.length, 0);
});

for (const callback of ['guard', 'prepare']) {
  test(`${callback} receives a detached head snapshot and cannot mutate publication state`, async t => {
    const f = await fixture(t), control = f.control(), id = 'pod_detached_' + callback, value = initial(id);
    const options = { [callback]: head => {
      head.version = 7;
      head.keys = { members: { phantom_member: true } };
      return callback === 'prepare' ? value.changes : undefined;
    } };
    await control.begin('pod', id, value, options);
    const state = await control.read('pod', id);
    assert.equal(state.version, 1); assert.equal(state.rows.members.phantom_member, undefined);
    assert.equal(state.rows.members.member_owner.role, 'admin');
  });
}

test('a receipt alone never reports commitment before the head publication succeeds', async t => {
  const f = await fixture(t), id = 'pod_receipt_boundary'; let fail = true;
  const control = f.control(async (url, options = {}) => {
    if (fail && options.method === 'PUT' && new URL(url).pathname === '/' + headPath(id)
      && f.database.read(headPath(id))?.pending?.applied === 2) { fail = false; return new Response('{}', { status: 503 }); }
    return fetch(url, options);
  });
  await control.begin('pod', id, initial(id)); await assert.rejects(control.resume('pod', id), /503/);
  assert.equal(f.database.read(headPath(id)).version, 0);
  assert.equal(f.database.read(`qa/competitions-v2/groups/${id}/operations/control_initial.json`).version, 1);
  assert.equal((await f.control().begin('pod', id, initial(id))).pending, true);
  assert.equal((await f.control().read('pod', id)).version, 1);
});

test('an identical prepared request retries its frozen audit payload after an interrupted publication', async t => {
  const f = await fixture(t), id = 'pod_prepared_retry'; let fail = true;
  const control = f.control(async (url, options = {}) => {
    if (fail && options.method === 'PUT' && new URL(url).pathname.endsWith('/operations/control_initial.json')) {
      fail = false; return new Response('{}', { status: 503 });
    }
    return fetch(url, options);
  });
  const value = initial(id);
  value.changes.push({ section: 'audit', key: 'audit_prepared', value: { action: 'placeholder' } });
  const prepare = () => value.changes.map(row => row.section === 'audit' ? { ...row, value: { action: 'actual', at: 1 } } : row);
  await control.begin('pod', id, value, { prepare });
  await assert.rejects(control.resume('pod', id), /503/);
  assert.equal((await f.control().begin('pod', id, value, { prepare })).pending, true);
  const state = await f.control().read('pod', id, { auditLimit: 5 });
  assert.equal(state.version, 1); assert.deepEqual(state.rows.audit.audit_prepared, { action: 'actual', at: 1 });
});

test('a guard is rechecked after a real conditional retry rather than publishing stale authority', { timeout: 10000 }, async t => {
  let release, entered, pause = false, held = false, permitted = true, checks = 0;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  t.after(() => release());
  const id = 'pod_guard_retry';
  const f = await fixture(t, { beforeConditionalPut: async ({ path }) => {
    if (pause && !held && path === '/' + headPath(id)) { held = true; entered(); await gate; }
  } });
  const first = f.control(), other = f.control(); await first.begin('pod', id, initial(id)); await first.resume('pod', id);
  pause = true;
  const denied = assert.rejects(first.begin('pod', id, { operationId: 'control_guarded', baseVersion: 1,
    changes: [{ section: 'members', key: 'member_owner', value: { role: 'admin', status: 'active' } }] }, {
    guard() { checks++; if (!permitted) throw Object.assign(new Error('Authority changed'), { code: 'GUARD_DENIED' }); },
  }), { code: 'GUARD_DENIED' });
  await started;
  await other.begin('pod', id, { operationId: 'control_demote', baseVersion: 1,
    changes: [{ section: 'members', key: 'member_owner', value: { role: 'member', status: 'active' } }] });
  await other.resume('pod', id); permitted = false; release(); await denied;
  assert.ok(checks >= 2);
  assert.equal((await other.read('pod', id)).rows.members.member_owner.role, 'member');
});

test('a read spanning a newer publication retries and returns the newer coherent version', { timeout: 10000 }, async t => {
  let release, entered, held = false;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  t.after(() => release());
  const f = await fixture(t), id = 'pod_read_race', writer = f.control();
  await writer.begin('pod', id, initial(id)); await writer.resume('pod', id);
  const reader = f.control(async (url, options = {}) => {
    const response = await fetch(url, options);
    if (!held && !options.method && new URL(url).pathname.endsWith('/rows/metadata/group.json')) { held = true; entered(); await gate; }
    return response;
  });
  const reading = reader.read('pod', id); await started;
  await writer.begin('pod', id, { operationId: 'control_change_both', baseVersion: 1, changes: [
    { section: 'metadata', key: 'group', value: { title: 'New group title' } },
    { section: 'members', key: 'member_owner', value: { role: 'member', status: 'active' } },
  ] });
  await writer.resume('pod', id); release();
  const state = await reading;
  assert.equal(state.version, 2); assert.equal(state.rows.metadata.group.title, 'New group title');
  assert.equal(state.rows.members.member_owner.role, 'member');
});

test('input limits and accidental identity/credential values reject before storage access', async t => {
  const f = await fixture(t), control = f.control(), id = 'pod_input';
  for (const changes of [
    [{ section: 'games', key: 'game_one', value: {} }],
    [{ section: 'members', key: 'member_one', value: { displayName: 'Personal name' } }],
    [{ section: 'members', key: 'member_one', value: { Name: 'Personal name' } }],
    [{ section: 'members', key: 'member_one', value: { accountId: 'raw-account' } }],
    [{ section: 'tables', key: 'table_one', value: { seatToken: 'raw-seat-token' } }],
    [{ section: 'members', key: '__proto__', value: {} }],
    [{ section: 'metadata', key: 'group', value: { padding: 'x'.repeat(65536) } }],
    Array.from({ length: 513 }, (_, index) => ({ section: 'members', key: 'member_' + index, value: { status: 'active' } })),
  ]) await assert.rejects(control.begin('pod', id, { operationId: 'control_invalid', baseVersion: 0, changes }), { code: 'CONTROL_INPUT' });
  assert.equal(f.database.calls.length, 0);
});

test('a blocked helper for one group does not block another group', { timeout: 10000 }, async t => {
  let release, entered, held = false;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  t.after(() => release());
  const f = await fixture(t, { beforeConditionalPut: async ({ path }) => {
    if (!held && path === '/qa/competitions-v2/groups/pod_blocked/rows/members/member_owner.json') { held = true; entered(); await gate; }
  } });
  const slow = f.control(); await slow.begin('pod', 'pod_blocked', initial('pod_blocked'));
  const pending = slow.resume('pod', 'pod_blocked'); await started;
  const fast = f.control(); await fast.begin('pod', 'pod_fast', initial('pod_fast')); await fast.resume('pod', 'pod_fast');
  assert.equal((await fast.read('pod', 'pod_fast')).version, 1);
  release(); await pending;
});

test('a delayed helper cannot overwrite a newer deletion or restore its live-key manifest', { timeout: 10000 }, async t => {
  let release, entered, held = false;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  t.after(() => release());
  const id = 'pod_stale_helper';
  const f = await fixture(t, { beforeConditionalPut: async ({ path }) => {
    if (!held && path === `/qa/competitions-v2/groups/${id}/rows/members/member_owner.json`) { held = true; entered(); await gate; }
  } });
  const old = f.control(), newer = f.control(); await old.begin('pod', id, initial(id));
  const delayed = old.resume('pod', id); await started;
  await newer.resume('pod', id);
  await newer.begin('pod', id, { operationId: 'control_remove', baseVersion: 1, changes: [{ section: 'members', key: 'member_owner', value: null }] });
  await newer.resume('pod', id); release(); await delayed;
  const state = await f.control().read('pod', id);
  assert.equal(state.version, 2); assert.deepEqual(state.rows.members, {});
  assert.equal(f.database.read(`qa/competitions-v2/groups/${id}/rows/members/member_owner.json`).version, 2);
  assert.equal(f.database.read(headPath(id)).keys?.members?.member_owner, undefined);
  assert.ok(f.database.conflicts > 0, 'The delayed conditional write must race on real ETags.');
});

test('registry repair finds an intent after ticket publication fails, without knowing its group ID', async t => {
  const f = await fixture(t), id = 'pod_missing_ticket'; let fail = true;
  const failing = f.control(async (url, options = {}) => {
    if (fail && options.method === 'PUT' && new URL(url).pathname === `/qa/competitions-v2/group-work/${id}.json`) { fail = false; return new Response('{}', { status: 503 }); }
    return fetch(url, options);
  });
  await assert.rejects(failing.begin('pod', id, initial(id)), /503/);
  assert.ok(f.database.read(headPath(id)).pending);
  assert.equal(f.database.read(`qa/competitions-v2/group-work/${id}.json`), null);
  const result = await f.control().recover({ workerId: 'fresh_worker', limit: 3, maxWrites: 8 });
  assert.deepEqual(result.errors, []);
  assert.equal(f.database.read(headPath(id)).version, 1);
  assert.equal(f.database.read(headPath(id)).pending, undefined);
  assert.ok(f.database.calls.some(call => call.path === '/qa/competitions-v2/group-registry.json' && call.query));
});

test('discovery persists rotating cursors and bounds both pages and child writes', async t => {
  const f = await fixture(t);
  for (let index = 0; index < 9; index++) { const id = 'pod_' + index; await f.control().begin('pod', id, initial(id)); }
  f.database.calls.length = 0;
  const first = await f.control().recover({ workerId: 'bounded_worker', limit: 3, maxWrites: 2 });
  assert.ok(first.writes <= 2);
  const cursor = f.database.read('qa/competitions-v2/group-work-cursors/bounded_worker.json');
  assert.ok(cursor.ready || cursor.registry);
  const firstCursor = JSON.stringify(cursor);
  const second = await f.control().recover({ workerId: 'bounded_worker', limit: 3, maxWrites: 2 });
  assert.ok(second.writes <= 2);
  assert.notEqual(JSON.stringify(f.database.read('qa/competitions-v2/group-work-cursors/bounded_worker.json')), firstCursor);
  const pages = f.database.calls.filter(call => /\/(group-work|group-registry)\.json$/.test(call.path));
  assert.equal(pages.length, 4); assert.ok(pages.every(call => call.query && call.returnedEntries <= 5));
  assert.ok(f.database.calls.every(call => !/\/directory\.json$|\/games\/|\/table-claims\//.test(call.path)));
});

test('stable control reads do not download ten thousand historical tombstones', async t => {
  const f = await fixture(t), id = 'pod_history_bound', control = f.control();
  await control.begin('pod', id, initial(id)); await control.resume('pod', id);
  const history = Object.fromEntries(Array.from({ length: 10000 }, (_, index) => ['table_old_' + index, { version: 1, operationId: 'control_old', deleted: true }]));
  await f.writer().write(`qa/competitions-v2/groups/${id}/rows/tables.json`, history);
  f.database.calls.length = 0;
  assert.deepEqual((await f.control().read('pod', id)).rows.tables, {});
  assert.ok(f.database.calls.every(call => !call.path.endsWith('/rows/tables.json')));
  assert.ok(f.database.calls.reduce((sum, call) => sum + (call.responseBytes || 0), 0) < 10000);
});

test('audit publication is append-only and stable reads fetch only a bounded recent page', async t => {
  const f = await fixture(t), id = 'pod_audit_bound', control = f.control();
  const value = initial(id);
  value.changes.push({ section: 'audit', key: 'audit_00000', value: { action: 'created', actorId: 'member_owner', at: 1 } });
  await control.begin('pod', id, value); await control.resume('pod', id);
  assert.equal(f.database.read(headPath(id)).keys?.audit, undefined, 'Historical audit keys must not accumulate in the active head.');
  await assert.rejects(control.begin('pod', id, { operationId: 'control_rewrite_audit', baseVersion: 1,
    changes: [{ section: 'audit', key: 'audit_00000', value: { action: 'rewritten' } }] }), { code: 'CONTROL_OPERATION_CONFLICT' });
  assert.equal(f.database.read(headPath(id)).pending, undefined);
  const audit = Object.fromEntries(Array.from({ length: 10000 }, (_, index) => ['audit_' + String(index).padStart(5, '0'),
    { version: 1, operationId: 'control_seed', json: JSON.stringify({ action: 'synthetic', at: index }) }]));
  await f.writer().write(`qa/competitions-v2/groups/${id}/rows/audit.json`, audit);
  f.database.calls.length = 0;
  const state = await control.read('pod', id, { auditLimit: 7 });
  assert.equal(Object.keys(state.rows.audit).length, 7);
  assert.deepEqual(Object.values(state.rows.audit).map(row => row.at), [9999, 9998, 9997, 9996, 9995, 9994, 9993]);
  const reads = f.database.calls.filter(call => call.path.endsWith('/rows/audit.json'));
  assert.equal(reads.length, 1); assert.ok(reads[0].query); assert.ok(reads[0].returnedEntries <= 9);
});
