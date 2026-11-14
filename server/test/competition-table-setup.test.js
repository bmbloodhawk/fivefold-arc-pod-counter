import assert from 'node:assert/strict';
import test from 'node:test';
import { FirebasePlaytestLedger } from '../src/playtest-ledger.js';
import { competitionStoreForEnvironment } from '../src/competitions.js';
import { CompetitionIdentityStore } from '../src/competition-identity-store.js';
import { CompetitionTableSetup } from '../src/competition-table-setup.js';
import { digest } from '../src/competition-values.js';
import { startCompetitionRestFixture } from '../../qa/competition-rest-fixture.mjs';

const group = { kind: 'pod', id: 'pod_setup' }, binding = { ...group, roomCode: 'ABC123' }, key = digest('synthetic-table');
const groupPath = `qa/competitions-v2/groups/${group.id}`;
const claimPath = `qa/competitions-v2/table-claims/${key}.json`;
const accountPath = `qa/competitions-v2/accounts/${digest('owner')}.json`;
async function fixture(t, options) {
  const database = await startCompetitionRestFixture(options); t.after(() => database.close());
  let now = 1000;
  const open = (fetchImpl = fetch) => {
    const raw = new FirebasePlaytestLedger({ databaseUrl: database.url, clientEmail: 'fixture', privateKey: 'fixture', fetchImpl });
    raw.accessToken = async () => 'local-fixture-only';
    const store = competitionStoreForEnvironment(raw, 'qa'), identities = new CompetitionIdentityStore({ store, now: () => now });
    const setup = new CompetitionTableSetup({ store, accounts: identities.controlAuthorization, claims: identities.tableClaims, now: () => now });
    return { setup, control: setup.control, identities, raw };
  };
  const client = open(), identityId = await client.identities.identity('owner', 'Owner');
  await client.control.begin(group.kind, group.id, { operationId: 'control_initial', baseVersion: 0, changes: [
    { section: 'metadata', key: 'group', value: { ...group, name: 'Synthetic setup group' } },
    { section: 'members', key: 'member_host', value: { id: 'member_host', identityId, kind: 'member', role: 'admin', status: 'active' } },
    { section: 'members', key: 'guest_host', value: { id: 'guest_host', kind: 'guest', role: 'participant', status: 'active' } },
  ] }); await client.control.resume(group.kind, group.id);
  const reserve = async (type, receiver = client, { roomCode = binding.roomCode, hostId } = {}) => {
    const claim = { key, binding, operationId: 'claim_setup', requestHash: digest('control_setup:claim_setup') };
    const actor = type === 'account' ? await receiver.identities.controlAuthority(identityId, group.kind, group.id)
      : { type: 'capability', participantId: 'guest_host', abortAfter: now + 30000 };
    const accepted = await receiver.control.begin(group.kind, group.id, { operationId: 'control_setup', baseVersion: 1, changes: [
      { section: 'tables', key, value: { key, roomCode, hostId: hostId || (type === 'account' ? 'member_host' : 'guest_host'),
        seats: { '0': { participantId: type === 'account' ? 'member_host' : 'guest_host', ownerHash: 'synthetic-proof' } }, captures: {} } },
    ] }, { authorization: { ...actor, claim } });
    return accepted.authorization;
  };
  return { ...client, database, open, identityId, reserve, expire: () => { now += 30001; } };
}

for (const type of ['account', 'capability']) {
  test(`${type} setup retains a complete intent before claim admission and a fresh helper publishes both documents`, async t => {
    const f = await fixture(t), ref = await f.reserve(type);
    assert.equal(f.database.read(claimPath), null);
    assert.ok(f.database.read(groupPath + '/head.json').pending.json.includes('synthetic-proof'));
    assert.equal((await f.control.resume(group.kind, group.id)).pending, true);
    await f.setup.admit(ref, { guard: () => {} });
    assert.equal(f.database.read(claimPath).state, 'pending');
    if (type === 'account') {
      const account = f.database.read(accountPath);
      assert.equal(account.controlOperations[ref.operationId].state, 'pending');
      assert.equal(account.tableClaims[ref.claim.requestHash].state, 'pending');
    }
    await f.setup.commit(ref, { guard: () => {} });
    if (type === 'account') {
      const account = f.database.read(accountPath);
      assert.equal(account.controlOperations[ref.operationId].state, 'committed');
      assert.equal(account.tableClaims[ref.claim.requestHash].state, 'committed');
    }
    f.expire(); await f.open().control.recover({ limit: 2, maxWrites: 4 });
    assert.equal(f.database.read(claimPath).state, 'ready');
    assert.equal(f.database.read(groupPath + '/head.json').pending, undefined);
    assert.equal(f.database.read(groupPath + '/head.json').settling, undefined);
    assert.equal((await f.control.read(group.kind, group.id)).rows.tables[key].hostId, type === 'account' ? 'member_host' : 'guest_host');
    assert.equal(f.database.read(accountPath).controlOperations, undefined);
    assert.equal(f.database.read(accountPath).tableClaims, undefined);
  });

  test(`${type} setup abort fences a claim PUT held through cancellation and retirement`, { timeout: 10000 }, async t => {
    let armed = true, entered, release;
    const started = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
    t.after(() => release());
    const f = await fixture(t, { beforeConditionalPut: async ({ path }) => {
      if (armed && path === '/' + claimPath) { armed = false; entered(); await gate; }
    } });
    const ref = await f.reserve(type);
    const delayed = assert.rejects(f.setup.admit(ref, { guard: () => {} }), { code: 'IDENTITY_CLOSED' });
    await started; f.expire(); await f.open().control.resume(group.kind, group.id); release(); await delayed;
    assert.equal(f.database.read(claimPath).state, 'cancelled');
    assert.equal((await f.control.read(group.kind, group.id)).rows.tables[key], undefined);
    assert.equal(f.database.read(accountPath).tableClaims, undefined);
    assert.equal(f.database.read(accountPath).controlOperations, undefined);
  });

  test(`${type} setup can reuse a ready same-binding claim without a nonce and retire after restart`, async t => {
    const f = await fixture(t);
    await f.identities.tableClaims.claim(key, binding);
    const previous = f.database.read(claimPath); assert.equal(previous.operationId, undefined);
    const ref = await f.reserve(type); await f.setup.admit(ref, { guard: () => {} }); await f.setup.commit(ref, { guard: () => {} });
    await f.open().control.resume(group.kind, group.id);
    assert.deepEqual(f.database.read(claimPath), previous);
    assert.equal(f.database.read(groupPath + '/head.json').settling, undefined);
    assert.ok((await f.control.read(group.kind, group.id)).rows.tables[key]);
  });

  test(`${type} cancellation preserves an unrelated pending claim with a durable supersession proof`, async t => {
    const f = await fixture(t), ref = await f.reserve(type), other = { ...binding, id: 'pod_other' };
    await f.identities.tableClaims.reserve(key, other, { operationId: 'claim_other' });
    const previous = f.database.read(claimPath); f.expire();
    await f.open().control.resume(group.kind, group.id);
    assert.deepEqual(f.database.read(claimPath), previous);
    const receipt = f.database.read(groupPath + `/operations/${ref.operationId}.json`);
    assert.equal(receipt.outcome, 'cancelled'); assert.equal(receipt.claimOutcome.type, 'superseded');
    assert.ok(receipt.claimOutcome.generation >= 1);
    assert.equal(f.database.read(groupPath + '/head.json').settling, undefined);
    await assert.rejects(f.setup.admit(ref, { guard: () => {} }), { code: 'CONTROL_AUTHORIZATION_CANCELLED' });
  });
}

test('ordinary account Table APIs cannot independently commit or retire a compound ticket', async t => {
  const f = await fixture(t), ref = await f.reserve('account'); await f.setup.admit(ref, { guard: () => {} });
  const ticket = { ...f.database.read(accountPath).tableClaims[ref.claim.requestHash],
    requestHash: ref.claim.requestHash, accountKey: ref.accountKey, identityId: ref.identityId };
  await assert.rejects(f.identities.commitTableClaim(ticket), { code: 'TABLE_SETUP_PENDING' });
  await assert.rejects(f.identities.finishTableClaim(ticket), { code: 'TABLE_SETUP_PENDING' });
  assert.equal(f.database.read(accountPath).controlOperations[ref.operationId].state, 'pending');
});

for (const type of ['account', 'capability']) test(`${type} malformed frozen setup rejects before claim work and remains safely abortable`, async t => {
  const f = await fixture(t), ref = await f.reserve(type, undefined, { roomCode: 'ZZZ999' });
  await assert.rejects(f.setup.admit(ref, { guard: () => {} }), { code: 'CONTROL_AUTHORIZATION_CONFLICT' });
  assert.equal(f.database.read(claimPath), null); assert.equal(f.database.read(accountPath).controlOperations, undefined);
  f.expire(); await f.control.resume(group.kind, group.id);
  assert.equal(f.database.read(groupPath + '/head.json').pending, undefined);
  assert.equal((await f.control.read(group.kind, group.id)).rows.tables[key], undefined);
});

test('a guest setup reference cannot authorize a frozen Table hosted by another participant', async t => {
  const f = await fixture(t), ref = await f.reserve('capability', undefined, { hostId: 'member_host' });
  await assert.rejects(f.setup.admit(ref, { guard: () => {} }), { code: 'CONTROL_AUTHORIZATION_CONFLICT' });
  assert.equal(f.database.read(claimPath), null);
});

for (const committed of [false, true]) {
  test(`account erasure ${committed ? 'finishes committed' : 'cancels undecided'} compound setup before dropping both indexes`, async t => {
    const f = await fixture(t), ref = await f.reserve('account'); await f.setup.admit(ref, { guard: () => {} });
    if (committed) await f.setup.commit(ref, { guard: () => {} });
    await f.open().identities.eraseAccount('owner');
    assert.deepEqual(f.database.read(accountPath), { schemaVersion: 2, state: 'closed' });
    const state = await f.control.read(group.kind, group.id);
    assert.equal(state.rows.members.member_host.status, 'erased');
    assert.equal(Boolean(state.rows.tables[key]), committed);
    assert.equal(f.database.read(claimPath).state, committed ? 'ready' : 'cancelled');
    assert.equal(f.database.read(groupPath + '/head.json').settling, undefined);
    assert.equal(JSON.stringify(f.database.read(groupPath + '.json')).includes(digest('owner')), false);
  });
}

test('compound setup and an ordinary unfinished Table ticket both remain erasable', async t => {
  const f = await fixture(t), ref = await f.reserve('account'); await f.setup.admit(ref, { guard: () => {} });
  const ordinaryKey = digest('ordinary-table'), ticket = await f.identities.beginTableClaim(f.identityId, ordinaryKey, binding);
  await f.identities.tableClaims.reserve(ordinaryKey, binding, ticket);
  await f.open().identities.eraseAccount('owner');
  assert.deepEqual(f.database.read(accountPath), { schemaVersion: 2, state: 'closed' });
  assert.equal(f.database.read(claimPath).state, 'cancelled');
  assert.equal(f.database.read(`qa/competitions-v2/table-claims/${ordinaryKey}.json`).state, 'cancelled');
});

test('an account decision retry rechecks the genuine Room guard after another account operation wins its ETag', { timeout: 10000 }, async t => {
  let armed = false, release, entered;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  t.after(() => release());
  const f = await fixture(t, { beforeConditionalPut: async ({ path }) => {
    if (armed && path === '/' + accountPath) { armed = false; entered(); await gate; }
  } });
  const ref = await f.reserve('account'); await f.setup.admit(ref, { guard: () => {} });
  let ownsSeat = true, checked = 0;
  const guard = () => { checked++; if (!ownsSeat) throw Object.assign(new Error('Seat owner changed'), { status: 403, code: 'SEAT_PROOF_CHANGED' }); };
  armed = true;
  const rejected = assert.rejects(f.setup.commit(ref, { guard }), { code: 'SEAT_PROOF_CHANGED' });
  await started;
  await f.open().identities.beginTableClaim(f.identityId, digest('another-table'), binding);
  ownsSeat = false; release(); await rejected;
  assert.ok(checked >= 2); assert.equal(f.database.read(accountPath).controlOperations[ref.operationId].state, 'pending');
  await f.setup.resolve(ref, { cancel: true }); await f.control.resume(group.kind, group.id);
  assert.equal((await f.control.read(group.kind, group.id)).rows.tables[key], undefined);
});
