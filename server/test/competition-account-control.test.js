import assert from 'node:assert/strict';
import test from 'node:test';
import { FirebasePlaytestLedger } from '../src/playtest-ledger.js';
import { competitionStoreForEnvironment } from '../src/competitions.js';
import { CompetitionIdentityStore } from '../src/competition-identity-store.js';
import { CompetitionAccountControl } from '../src/competition-account-control.js';
import { CompetitionControlStore } from '../src/competition-control-store.js';
import { digest } from '../src/competition-values.js';
import { startCompetitionRestFixture } from '../../qa/competition-rest-fixture.mjs';

async function fixture(t, options) {
  const database = await startCompetitionRestFixture(options); t.after(() => database.close());
  let now = 1000;
  const stores = (fetchImpl = fetch) => {
    const writer = new FirebasePlaytestLedger({ databaseUrl: database.url, clientEmail: 'fixture', privateKey: 'fixture', fetchImpl });
    writer.accessToken = async () => 'local-fixture-only';
    return competitionStoreForEnvironment(writer, 'qa');
  };
  const open = fetchImpl => {
    const store = stores(fetchImpl), accounts = new CompetitionAccountControl({ store, now: () => now });
    const control = new CompetitionControlStore({ store, resolveAuthorization: ref => accounts.resolve(ref), finishAuthorization: ref => accounts.retire(ref) });
    return { accounts, control, identities: new CompetitionIdentityStore({ store }) };
  };
  const first = open(), identityId = await first.identities.identity('owner', 'Owner');
  const reserve = async (client = first, id = 'pod_authority', operationId = 'control_setup') => {
    const authorization = await client.accounts.prepare(identityId, 'pod', id);
    const result = await client.control.begin('pod', id, { operationId, baseVersion: 0, changes: [
      { section: 'metadata', key: 'group', value: { kind: 'pod', id, name: 'Synthetic group' } },
    ] }, { authorization });
    return result.authorization;
  };
  return { ...first, database, open, reserve, identityId, expire: () => { now += 30001; } };
}
const account = `qa/competitions-v2/accounts/${digest('owner')}.json`;
const head = id => `qa/competitions-v2/groups/${id}/head.json`;

test('account control registers discovery before admission and retires only after exact publication', async t => {
  const f = await fixture(t), ref = await f.reserve();
  assert.equal(f.database.read(`qa/competitions-v2/identities/${f.identityId}.json`).scopes[ref.id], true);
  assert.equal(await f.accounts.resolve(ref), 'pending');
  await f.accounts.admit(ref);
  await assert.rejects(f.accounts.retire(ref), { code: 'CONTROL_AUTHORIZATION_PENDING' });
  await f.accounts.commit(ref);
  await f.open().control.resume(ref.kind, ref.id);
  assert.equal(f.database.read(account).controlOperations, undefined);
  assert.equal(f.database.read(head(ref.id)).settling, undefined);
  assert.equal((await f.control.read(ref.kind, ref.id)).rows.metadata.group.name, 'Synthetic group');
});

test('a process that dies before its account ticket exists can be safely aborted by a fresh helper', async t => {
  const f = await fixture(t), ref = await f.reserve();
  assert.equal(f.database.read(account).controlOperations, undefined);
  f.expire();
  const progress = await f.open().control.recover({ limit: 2, maxWrites: 4 });
  assert.deepEqual(progress.errors, []);
  assert.equal(f.database.read(head(ref.id)).version, 1);
  assert.equal(f.database.read(head(ref.id)).pending, undefined);
  await assert.rejects(f.accounts.admit(ref), { code: 'CONTROL_AUTHORIZATION_CANCELLED' });
  assert.equal(f.database.read(account).controlOperations, undefined);
});

test('an expired undecided ticket cancels, while a committed decision never expires', async t => {
  const f = await fixture(t), pending = await f.reserve();
  await f.accounts.admit(pending); f.expire();
  assert.equal(await f.accounts.resolve(pending), 'cancelled');
  await assert.rejects(f.accounts.commit(pending), { code: 'CONTROL_AUTHORIZATION_CANCELLED' });
  await f.control.resume(pending.kind, pending.id);
  const next = await f.reserve(f.open(), 'pod_committed', 'control_committed');
  await f.accounts.admit(next); await f.accounts.commit(next); f.expire();
  assert.equal(await f.open().accounts.resolve(next), 'committed');
  await f.control.resume(next.kind, next.id);
  assert.equal(f.database.read(head(next.id)).version, 1);
});

test('a paused initializer cannot recreate a ticket after an absent-ticket abort is retired', { timeout: 10000 }, async t => {
  let armed = false, release, entered;
  const started = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const f = await fixture(t, { beforeConditionalPut: async ({ path }) => {
    if (armed && path === '/' + account) { armed = false; entered(); await gate; }
  } });
  const ref = await f.reserve(); armed = true;
  const late = assert.rejects(f.accounts.admit(ref), { code: 'CONTROL_AUTHORIZATION_CANCELLED' });
  await started; f.expire(); await f.open().control.resume(ref.kind, ref.id); release(); await late;
  assert.equal(f.database.read(account).controlOperations, undefined);
  assert.equal(f.database.read(head(ref.id)).version, 1);
});

test('a delayed pending decision loses to an exact cancellation and cannot publish children', { timeout: 10000 }, async t => {
  let armed = false, release, entered;
  const started = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const f = await fixture(t, { beforeConditionalPut: async ({ path }) => {
    if (armed && path === '/' + account) { armed = false; entered(); await gate; }
  } });
  const ref = await f.reserve(); await f.accounts.admit(ref); armed = true;
  const late = assert.rejects(f.accounts.commit(ref), { code: 'CONTROL_AUTHORIZATION_CANCELLED' });
  await started; f.expire(); await f.open().control.resume(ref.kind, ref.id); release(); await late;
  assert.equal(f.database.read(`qa/competitions-v2/groups/${ref.id}/rows.json`), null);
});

test('a changed operation or payload cannot reuse an admitted account decision', async t => {
  const f = await fixture(t), ref = await f.reserve(); await f.accounts.admit(ref);
  for (const changed of [{ payloadHash: digest('different') }, { operationId: 'control_other' }, { version: ref.version + 1 }]) {
    await assert.rejects(f.accounts.commit({ ...ref, ...changed }), { code: 'CONTROL_AUTHORIZATION_CONFLICT' });
  }
  assert.equal(f.database.read(account).controlOperations[ref.operationId].state, 'pending');
});

test('a stale absent-ticket helper preserves the outcome of a committed and retired operation', { timeout: 10000 }, async t => {
  const f = await fixture(t), ref = await f.reserve();
  let armed = true, release, entered;
  const started = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const stale = f.open(async (url, options = {}) => {
    const response = await fetch(url, options);
    if (armed && !options.method && new URL(url).pathname === '/' + account) { armed = false; entered(); await gate; }
    return response;
  });
  const resolving = stale.accounts.resolve(ref); await started;
  await f.accounts.admit(ref); await f.accounts.commit(ref); await f.control.resume(ref.kind, ref.id);
  f.expire(); release();
  assert.equal(await resolving, 'committed');
  assert.equal(f.database.read(`qa/competitions-v2/groups/${ref.id}/operations/${ref.operationId}.json`).outcome, 'committed');
  assert.equal(f.database.read(account).controlOperations, undefined);
});

test('identity erasure cancels an undecided group and removes its private decision reference', async t => {
  const f = await fixture(t), ref = await f.reserve(); await f.accounts.admit(ref);
  await f.open().identities.eraseAccount('owner');
  assert.equal(f.database.read(head(ref.id)).pending, undefined);
  assert.equal(f.database.read(head(ref.id)).settling, undefined);
  assert.equal(f.database.read(`qa/competitions-v2/groups/${ref.id}/rows/metadata/group.json`), null);
  assert.deepEqual(f.database.read(account), { schemaVersion: 2, state: 'closed' });
  assert.equal(JSON.stringify(f.database.read('qa/competitions-v2/groups.json')).includes(digest('owner')), false);
});

test('identity erasure finishes a committed group before closing and permanently removes organizer authority', async t => {
  const f = await fixture(t), ref = await f.reserve(); await f.accounts.admit(ref); await f.accounts.commit(ref);
  await f.control.resume(ref.kind, ref.id);
  await f.control.begin('pod', ref.id, { operationId: 'control_member', baseVersion: 1, changes: [
    { section: 'members', key: 'member_owner', value: { id: 'member_owner', identityId: f.identityId, kind: 'member', role: 'admin', status: 'left' } },
    { section: 'invites', key: 'invite_owned', value: { id: 'invite_owned', by: 'member_owner', revoked: false } },
  ] }); await f.control.resume(ref.kind, ref.id);
  const authorization = await f.accounts.prepare(f.identityId, ref.kind, ref.id);
  const accepted = await f.control.begin(ref.kind, ref.id, { operationId: 'control_approved_rename', baseVersion: 2, changes: [
    { section: 'metadata', key: 'group', value: { kind: ref.kind, id: ref.id, name: 'Approved before deletion' } },
  ] }, { authorization });
  await f.accounts.admit(accepted.authorization); await f.accounts.commit(accepted.authorization);
  await f.open().identities.eraseAccount('owner');
  const current = await f.control.read(ref.kind, ref.id);
  assert.equal(current.rows.members.member_owner.status, 'erased');
  assert.equal(current.rows.members.member_owner.role, 'member');
  assert.equal(current.rows.invites.invite_owned.revoked, true);
  assert.equal(current.rows.metadata.group.name, 'Approved before deletion');
  assert.deepEqual(f.database.read(account), { schemaVersion: 2, state: 'closed' });
});

test('erasure fences a registered creation whose reservation PUT has not arrived', { timeout: 10000 }, async t => {
  let armed = true, release, entered;
  const started = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const f = await fixture(t, { beforeConditionalPut: async ({ path }) => {
    if (armed && path === '/' + head('pod_authority')) { armed = false; entered(); await gate; }
  } });
  const late = assert.rejects(f.reserve(), { code: 'CONTROL_VERSION_CONFLICT' });
  await started; await f.open().identities.eraseAccount('owner'); release(); await late;
  assert.equal(f.database.read(head('pod_authority')).unavailable, true);
  assert.equal(f.database.read(head('pod_authority')).pending, undefined);
  assert.deepEqual(f.database.read(account), { schemaVersion: 2, state: 'closed' });
});

test('a failed scope-index handoff stays closing and a fresh eraser preserves its frozen references', async t => {
  const f = await fixture(t), ref = await f.reserve(); await f.accounts.admit(ref); await f.accounts.commit(ref);
  await f.control.resume(ref.kind, ref.id);
  let fail = true;
  const eraser = f.open(async (url, options = {}) => {
    if (fail && options.method === 'PUT' && new URL(url).pathname === '/' + account && JSON.parse(options.body).erasureScopes) {
      fail = false; return Response.json({ error: 'interrupted frozen index handoff' }, { status: 503 });
    }
    return fetch(url, options);
  });
  await assert.rejects(eraser.identities.eraseAccount('owner'), /503/);
  assert.equal(f.database.read(account).state, 'closing');
  const frozen = f.database.read(`qa/competitions-v2/identities/${f.identityId}.json`);
  assert.equal(frozen.state, 'closing'); assert.equal(frozen.scopes[ref.id], true); assert.equal(frozen.aliases, undefined);
  await f.open().identities.resumeErasures({ limit: 10 });
  assert.deepEqual(f.database.read(account), { schemaVersion: 2, state: 'closed' });
  assert.ok((await f.control.read(ref.kind, ref.id)).rows.work[`erased_${f.identityId}`]);
});

test('erasure revokes a valid large invite collection in bounded resumable control batches', { timeout: 30000 }, async t => {
  const f = await fixture(t), ref = await f.reserve(); await f.accounts.admit(ref); await f.accounts.commit(ref);
  await f.control.resume(ref.kind, ref.id);
  const root = `qa/competitions-v2/groups/${ref.id}`, group = f.database.read(root + '.json');
  const owner = { id: 'member_owner', identityId: f.identityId, kind: 'member', role: 'admin', status: 'active' };
  group.head.keys.members = { member_owner: true }; group.head.keys.invites = {};
  group.rows.members = { member_owner: { version: 1, operationId: ref.operationId, json: JSON.stringify(owner) } }; group.rows.invites = {};
  for (let index = 0; index < 511; index++) {
    const id = `invite_${String(index).padStart(4, '0')}`;
    group.head.keys.invites[id] = true;
    group.rows.invites[id] = { version: 1, operationId: ref.operationId,
      json: JSON.stringify({ id, by: owner.id, revoked: false }) };
  }
  assert.ok((await fetch(f.database.url + '/' + root + '.json', { method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: 'Bearer local-fixture-only' }, body: JSON.stringify(group) })).ok);
  assert.equal(Object.keys((await f.control.read(ref.kind, ref.id)).rows.invites).length, 511);
  const batches = []; let failMarker = true;
  const eraser = f.open(async (url, options = {}) => {
    if (options.method === 'PUT' && new URL(url).pathname === '/' + head(ref.id)) {
      const pending = JSON.parse(options.body).pending;
      if (pending) {
        const changes = JSON.parse(pending.json).changes;
        batches.push(changes.length);
        if (failMarker && changes.length === 1 && changes[0].section === 'work') {
          failMarker = false; return Response.json({ error: 'interrupted final erasure marker' }, { status: 503 });
        }
      }
    }
    return fetch(url, options);
  });
  await assert.rejects(eraser.identities.eraseAccount('owner'), /503/);
  assert.equal(f.database.read(account).state, 'closing');
  assert.equal(f.database.read(account).erasureScopes[f.identityId][ref.id], true);
  const partial = await f.control.read(ref.kind, ref.id);
  assert.equal(partial.rows.members.member_owner.status, 'erased');
  assert.equal(partial.rows.work[`erased_${f.identityId}`], undefined, 'No completeness marker may precede all completed batches.');
  await f.open().identities.resumeErasures({ limit: 10 });
  assert.ok(batches.length >= 2); assert.ok(batches.every(size => size <= 512));
  const state = await f.control.read(ref.kind, ref.id);
  assert.equal(state.rows.members.member_owner.status, 'erased');
  assert.equal(Object.values(state.rows.invites).every(invite => invite.revoked), true);
  assert.deepEqual(f.database.read(account), { schemaVersion: 2, state: 'closed' });
});
