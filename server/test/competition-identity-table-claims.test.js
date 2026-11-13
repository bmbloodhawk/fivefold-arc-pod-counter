import assert from 'node:assert/strict';
import test from 'node:test';
import { FirebasePlaytestLedger } from '../src/playtest-ledger.js';
import { CompetitionIdentityStore } from '../src/competition-identity-store.js';
import { CompetitionTableClaims } from '../src/competition-table-claims.js';
import { competitionStoreForEnvironment } from '../src/competitions.js';
import { digest } from '../src/competition-values.js';
import { startCompetitionRestFixture } from '../../qa/competition-rest-fixture.mjs';

async function fixture(t, options) {
  const database = await startCompetitionRestFixture(options); t.after(() => database.close());
  const writer = fetchImpl => {
    const raw = new FirebasePlaytestLedger({ databaseUrl: database.url, clientEmail: 'fixture', privateKey: 'fixture', fetchImpl });
    raw.accessToken = async () => 'local-fixture-only'; return raw;
  };
  const stores = fetchImpl => competitionStoreForEnvironment(writer(fetchImpl), 'qa');
  const ids = fetchImpl => new CompetitionIdentityStore({ store: stores(fetchImpl) });
  const claims = fetchImpl => new CompetitionTableClaims({ store: stores(fetchImpl) });
  return { database, raw: writer(), ids, claims };
}
const binding = { kind: 'pod', id: 'pod_friends', roomCode: 'ABC123' };
const accountPath = account => `qa/competitions-v2/accounts/${digest(account)}.json`;
const claimPath = key => `qa/competitions-v2/table-claims/${key}.json`;

test('account authorization reserves one operation for concurrent retries and cleans a completed ticket', async t => {
  const f = await fixture(t), id = await f.ids().identity('owner', 'Owner'), key = digest('table');
  const tickets = await Promise.all(Array.from({ length: 8 }, () => f.ids().beginTableClaim(id, key, binding)));
  assert.equal(new Set(tickets.map(ticket => ticket.operationId)).size, 1);
  const ticket = tickets[0];
  await f.claims().reserve(key, binding, ticket);
  const decision = await f.ids().commitTableClaim(ticket);
  await f.claims().publish(key, binding, decision);
  await f.ids().finishTableClaim(decision);
  assert.deepEqual(await f.claims().read(key), binding);
  assert.equal(f.database.read(accountPath('owner')).tableClaims, undefined);
  const next = await f.ids().beginTableClaim(id, key, binding);
  assert.notEqual(next.operationId, ticket.operationId);
});

test('an account decision cannot commit before its Table reservation exists', async t => {
  const f = await fixture(t), ids = f.ids(), id = await ids.identity('owner', 'Owner'), key = digest('not-reserved');
  const ticket = await ids.beginTableClaim(id, key, binding);
  await assert.rejects(ids.commitTableClaim(ticket), { code: 'TABLE_SETUP_PENDING' });
  assert.equal(Object.values(f.database.read(accountPath('owner')).tableClaims)[0].state, 'pending');
});

test('erasure fences a reservation that has not arrived and rejects its late conditional PUT', async t => {
  let release, began, pause = true;
  const started = new Promise(resolve => { began = resolve; }), blocked = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { beforeConditionalPut: async ({ path }) => {
    if (pause && path.includes('/table-claims/')) { pause = false; began(); await blocked; }
  } }); t.after(() => release());
  const ids = f.ids(), id = await ids.identity('erased', 'Private owner'), key = digest('late-table');
  await ids.setAlias(id, 'pod_friends', 'member_owner', 'Private owner');
  const ticket = await ids.beginTableClaim(id, key, binding);
  const pending = assert.rejects(f.claims().reserve(key, binding, ticket), { code: 'IDENTITY_CLOSED' });
  await started; await f.ids().eraseAccount('erased'); release(); await pending;
  assert.equal(await f.claims().read(key), null);
  assert.deepEqual(f.database.read(accountPath('erased')), { schemaVersion: 2, state: 'closed' });
  assert.equal(JSON.stringify(f.database.read('qa/competitions-v2.json')).includes('Private owner'), false);
});

test('erasure publishes an already committed authorization before dropping account links', async t => {
  const f = await fixture(t), ids = f.ids(), id = await ids.identity('owner', 'Owner'), key = digest('committed-table');
  const ticket = await ids.beginTableClaim(id, key, binding);
  await f.claims().reserve(key, binding, ticket); await ids.commitTableClaim(ticket);
  await f.ids().eraseAccount('owner');
  assert.deepEqual(await f.claims().read(key), binding);
  assert.equal(f.database.read(claimPath(key)).state, 'ready');
  assert.deepEqual(f.database.read(accountPath('owner')), { schemaVersion: 2, state: 'closed' });
});

test('a failed erasure fence remains discoverable and a fresh eraser completes without the account ID', async t => {
  const f = await fixture(t), ids = f.ids(), id = await ids.identity('owner', 'Owner'), key = digest('retry-fence');
  const ticket = await ids.beginTableClaim(id, key, binding); await f.claims().reserve(key, binding, ticket);
  let fail = true;
  const eraser = f.ids(async (url, options = {}) => {
    if (fail && options.method === 'PUT' && url.includes('/table-claims/')) { fail = false; return Response.json({ error: 'fixture' }, { status: 503 }); }
    return fetch(url, options);
  });
  await assert.rejects(eraser.eraseAccount('owner'), /503/);
  const closing = f.database.read(accountPath('owner'));
  assert.equal(closing.state, 'closing'); assert.equal(Object.values(closing.tableClaims).length, 1);
  await f.ids().resumeErasures({ limit: 20 });
  assert.equal(await f.claims().read(key), null);
  assert.deepEqual(f.database.read(accountPath('owner')), { schemaVersion: 2, state: 'closed' });
});

test('erasing an uncommitted ticket preserves another operation’s established claim', async t => {
  const f = await fixture(t), ids = f.ids(), id = await ids.identity('owner', 'Owner'), key = digest('other-winner');
  const ticket = await ids.beginTableClaim(id, key, binding), other = { ...binding, id: 'pod_other' };
  await f.claims().claim(key, other);
  await f.ids().eraseAccount('owner');
  assert.deepEqual(await f.claims().read(key), other);
  await assert.rejects(f.claims().reserve(key, binding, ticket), { code: 'TABLE_ALREADY_LINKED' });
});

test('erasure fences every admitted intent for the same Table even when a later PUT is delayed', async t => {
  let release, began, pause = true;
  const started = new Promise(resolve => { began = resolve; }), blocked = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { beforeConditionalPut: async ({ path }) => {
    if (pause && path.includes('/table-claims/')) { pause = false; began(); await blocked; }
  } }); t.after(() => release());
  const ids = f.ids(), id = await ids.identity('owner', 'Owner'), key = digest('two-intents');
  await ids.beginTableClaim(id, key, binding, { intent: 'first_intent' });
  const second = await ids.beginTableClaim(id, key, binding, { intent: 'second_intent' });
  const late = assert.rejects(f.claims().reserve(key, binding, second), { code: 'IDENTITY_CLOSED' });
  await started; await f.ids().eraseAccount('owner'); release(); await late;
  assert.equal(await f.claims().read(key), null);
  const nextId = await f.ids().identity('next', 'Next'), next = await f.ids().beginTableClaim(nextId, key, binding);
  await f.claims().reserve(key, binding, next);
  const decision = await f.ids().commitTableClaim(next); await f.claims().publish(key, binding, decision);
  assert.deepEqual(await f.claims().read(key), binding);
});

test('a later account cancellation cannot revive an earlier erased reservation', async t => {
  let release, began, pause = true;
  const started = new Promise(resolve => { began = resolve; }), blocked = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { beforeConditionalPut: async ({ path }) => {
    if (pause && path.includes('/table-claims/')) { pause = false; began(); await blocked; }
  } }); t.after(() => release());
  const key = digest('successive-cancellations'), ids = f.ids(), firstId = await ids.identity('first', 'First');
  const first = await ids.beginTableClaim(firstId, key, binding);
  const late = assert.rejects(f.claims().reserve(key, binding, first), { code: 'IDENTITY_CLOSED' });
  await started; await f.ids().eraseAccount('first');
  const secondId = await f.ids().identity('second', 'Second'), second = await f.ids().beginTableClaim(secondId, key, binding);
  await f.claims().reserve(key, binding, second); await f.ids().eraseAccount('second');
  release(); await late;
  assert.equal(await f.claims().read(key), null);
});

test('a repeated cancellation state cannot reuse a stale active-account authorization', { timeout: 10000 }, async t => {
  const f = await fixture(t), key = digest('cancelled-state-cycle'), oldIds = f.ids();
  const oldId = await oldIds.identity('old', 'Old'), oldTicket = await oldIds.beginTableClaim(oldId, key, binding);
  await f.ids().eraseAccount('old');
  const initial = f.database.read(claimPath(key));
  const ids = f.ids(), id = await ids.identity('current', 'Current'), ticket = await ids.beginTableClaim(id, key, binding);
  let release, began, pause = true;
  const started = new Promise(resolve => { began = resolve; }), blocked = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const driver = f.claims(async (url, options = {}) => {
    const response = await fetch(url, options);
    if (pause && !options.method && url.endsWith(`/${accountPath('current')}`)) { pause = false; began(); await blocked; }
    return response;
  });
  const late = assert.rejects(driver.reserve(key, binding, ticket), { code: 'IDENTITY_CLOSED' });
  await started; await f.ids().eraseAccount('current');
  // A second eraser may already hold this older closing ticket in memory.
  await f.claims().settleErasure(oldTicket);
  const repeated = f.database.read(claimPath(key));
  assert.equal(repeated.operationId, initial.operationId);
  assert.ok(repeated.generation > initial.generation);
  release(); await late;
  assert.equal(await f.claims().read(key), null);
});

test('an old operation cannot commit a later same-intent Table ticket', async t => {
  const f = await fixture(t), ids = f.ids(), id = await ids.identity('owner', 'Owner'), key = digest('exact-operation');
  const old = await ids.beginTableClaim(id, key, binding);
  await f.claims().reserve(key, binding, old);
  const decision = await ids.commitTableClaim(old);
  await f.claims().publish(key, binding, decision); await ids.finishTableClaim(decision);
  const current = await ids.beginTableClaim(id, key, binding);
  assert.notEqual(current.operationId, old.operationId);
  await assert.rejects(ids.commitTableClaim(old), { code: 'IDENTITY_STORAGE_CONFLICT' });
  assert.equal(f.database.read(accountPath('owner')).tableClaims[current.requestHash].state, 'pending');
});

test('a retired operation cannot reconstruct its authorization from an established Table', async t => {
  const f = await fixture(t), ids = f.ids(), id = await ids.identity('owner', 'Owner'), key = digest('retired-operation');
  const ticket = await ids.beginTableClaim(id, key, binding);
  await f.claims().reserve(key, binding, ticket);
  const decision = await ids.commitTableClaim(ticket);
  await f.claims().publish(key, binding, decision); await ids.finishTableClaim(decision);
  await assert.rejects(ids.commitTableClaim(ticket), { code: 'IDENTITY_STORAGE_CONFLICT' });
  assert.equal(f.database.read(accountPath('owner')).tableClaims, undefined);
});

test('a delayed ticket initializer cannot return after another admission has been retired', { timeout: 10000 }, async t => {
  let release, began, pause = false;
  const started = new Promise(resolve => { began = resolve; }), blocked = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { beforeConditionalPut: async ({ path }) => {
    if (pause && path === '/' + accountPath('owner')) { pause = false; began(); await blocked; }
  } }); t.after(() => release());
  const ids = f.ids(), id = await ids.identity('owner', 'Owner'), key = digest('initializer-aba');
  pause = true;
  const delayed = assert.rejects(ids.beginTableClaim(id, key, binding), { code: 'TABLE_SETUP_PENDING' });
  await started;
  const other = f.ids(), ticket = await other.beginTableClaim(id, key, binding);
  await f.claims().reserve(key, binding, ticket);
  const decision = await other.commitTableClaim(ticket);
  await f.claims().publish(key, binding, decision); await other.finishTableClaim(decision);
  release(); await delayed;
  assert.equal(f.database.read(accountPath('owner')).tableClaims, undefined);
});
