import assert from 'node:assert/strict';
import test from 'node:test';
import { Competitions, competitionStoreForEnvironment } from '../src/competitions.js';
import { CompetitionIdentityStore } from '../src/competition-identity-store.js';
import { digest } from '../src/competition-values.js';
import { FirebasePlaytestLedger } from '../src/playtest-ledger.js';
import { startCompetitionRestFixture } from '../../qa/competition-rest-fixture.mjs';

async function fixture(t, options) {
  const database = await startCompetitionRestFixture(options); t.after(() => database.close());
  const writer = fetchImpl => {
    const ledger = new FirebasePlaytestLedger({ databaseUrl: database.url, clientEmail: 'fixture@example.invalid',
      privateKey: 'unused-local-fixture-key', ...(fetchImpl ? { fetchImpl } : {}), logger: { error() {} } });
    ledger.accessToken = async () => 'local-fixture-only'; return ledger;
  };
  const raw = writer();
  const store = () => competitionStoreForEnvironment(writer(), 'qa');
  const identities = extra => new CompetitionIdentityStore({ store: store(), ...extra });
  return { database, raw, writer, store, identities };
}
const accountPath = account => `qa/competitions-v2/accounts/${digest(account)}.json`;
const valuePath = identity => `qa/competitions-v2/identities/${identity}.json`;
async function seedLegacy(f, account = 'legacy', id = 'identity_legacy') {
  const key = digest(account);
  await f.raw.write('qa/competitions/directory.json', {
    schemaVersion: 1, accounts: { [key]: id }, identities: { [id]: { accountKey: key } },
    scopes: { [id]: { pod_old: true } },
    aliases: { pod_old_member_old: { identityId: id, name: 'Legacy name' } },
  });
  return { key, id };
}

test('independent native creators converge on one account identity without the global directory', async t => {
  const f = await fixture(t);
  const results = await Promise.all(Array.from({ length: 16 }, () => f.identities().identity('same-account', 'Player')));
  assert.equal(new Set(results).size, 1);
  assert.equal(f.database.read(accountPath('same-account')).state, 'active');
  assert.equal(f.database.read(accountPath('same-account')).identityId, results[0]);
  assert.equal(f.database.read(valuePath(results[0])).accountKey, digest('same-account'));
  assert.equal(await f.identities().identity('same-account'), results[0]);
  assert.equal(f.database.calls.some(row => row.path === '/qa/competitions/directory.json'), false);
});

test('different accounts, scoped aliases and membership indexes do not contend on a directory document', async t => {
  const f = await fixture(t), ids = f.identities();
  const values = await Promise.all(Array.from({ length: 24 }, async (_, index) => {
    const id = await ids.identity(`account-${index}`, `Name ${index}`);
    await ids.setAlias(id, 'pod_friends', `member_${index}`, `Name ${index}`); return id;
  }));
  assert.equal(new Set(values).size, 24);
  assert.equal(await ids.alias(values[7], 'pod_friends', 'member_7'), 'Name 7');
  assert.deepEqual(await ids.memberships(values[7]), ['pod_friends']);
  assert.equal(f.database.calls.some(row => row.path === '/qa/competitions/directory.json'), false);
  const before = f.database.calls.filter(row => row.method === 'PUT').length;
  await ids.setAlias(values[7], 'pod_friends', 'member_7', 'Name 7');
  assert.equal(f.database.calls.filter(row => row.method === 'PUT').length, before, 'Identical name/index retries are no-ops.');
  assert.equal(f.database.calls.some(row => row.path === '/qa/competitions/directory.json'), false);
});

test('read-only unknown account lookup and invalid names never create identity data', async t => {
  const f = await fixture(t), ids = f.identities();
  await assert.rejects(() => ids.identity('unknown'), { status: 403 });
  const calls = f.database.calls.length;
  await assert.rejects(() => ids.identity(null, 'Guest'), { status: 401 });
  await assert.rejects(() => ids.identity('bad', '<script>'), { status: 400 });
  assert.equal(f.database.calls.length, calls);
  assert.equal(f.database.calls.some(row => row.method === 'PUT'), false);
});

test('a scoped profile returns only requested names and reads the identity value once', async t => {
  const f = await fixture(t), ids = f.identities();
  const id = await ids.identity('scoped-account', 'Player');
  await ids.setAlias(id, 'pod_friends', 'member_one', 'Member name');
  await ids.setAlias(id, 'pod_friends', 'guest_one', 'Attested name');
  await ids.setAlias(id, 'pod_other', 'member_other', 'Other private name');
  const before = f.database.calls.length;
  assert.deepEqual(await ids.scopeProfile(id, 'pod_friends', ['member_one', 'guest_one', 'missing', 'member_one']), {
    identityId: id, names: { member_one: 'Member name', guest_one: 'Attested name' },
  });
  const reads = f.database.calls.slice(before);
  assert.equal(reads.filter(call => call.path === `/${valuePath(id)}`).length, 1);
  assert.equal(reads.some(call => call.path === '/qa/competitions/directory.json'), false);
});

test('scoped legacy names read through by leaf and closing identities grant no names', async t => {
  const f = await fixture(t), previous = await seedLegacy(f), ids = f.identities();
  f.database.calls.splice(0);
  assert.deepEqual(await ids.scopeProfile(previous.id, 'pod_old', ['member_old']), {
    identityId: previous.id, names: { member_old: 'Legacy name' },
  });
  assert.equal(f.database.calls.some(call => call.path === '/qa/competitions/directory.json'), false);
  await f.raw.write(`qa/competitions/directory/closed/${previous.key}.json`, true);
  const before = f.database.calls.length;
  assert.equal(await ids.scopeProfile(previous.id, 'pod_old', ['member_old']), null);
  assert.equal(f.database.calls.slice(before).some(call => call.path.includes('/aliases/')), false);
});

test('scoped name input is validated before profile or alias storage is read', async t => {
  const f = await fixture(t), ids = f.identities();
  const before = f.database.calls.length;
  for (const args of [['identity_valid', 'pod_valid', null], ['../bad', 'pod_valid', []],
    ['identity_valid', '../bad', []], ['identity_valid', 'pod_valid', ['../bad']]]) {
    await assert.rejects(ids.scopeProfile(...args), { status: 400 });
  }
  assert.equal(f.database.calls.length, before);
});

test('lookup observes account state without helping opening or erasure work', async t => {
  const f = await fixture(t), ids = f.identities();
  assert.equal(await ids.lookup('unknown'), null);
  const id = await ids.identity('known', 'Known');
  assert.equal(await ids.lookup('known'), id);
  await f.raw.write(accountPath('known'), { schemaVersion: 2, state: 'opening', identityId: id, mode: 'native', resolved: true, reservedIds: [id] });
  const before = f.database.calls.length;
  assert.equal(await ids.lookup('known'), null);
  assert.equal(f.database.calls.slice(before).filter(call => call.method === 'PUT').length, 0);
  assert.equal(f.database.read(accountPath('known')).state, 'opening');
});

test('lookup rejects a foreign canonical identity without changing either account', async t => {
  const f = await fixture(t), ids = f.identities(), id = await ids.identity('victim', 'Victim');
  await f.raw.write(accountPath('other'), { schemaVersion: 2, state: 'active', identityId: id, mode: 'native' });
  const before = f.database.calls.length;
  await assert.rejects(ids.lookup('other'), { code: 'IDENTITY_STORAGE_CONFLICT' });
  assert.equal(f.database.calls.slice(before).filter(call => call.method === 'PUT').length, 0);
});

test('legacy identity, membership and names are reused with scoped reads and no bulk copying', async t => {
  const f = await fixture(t), legacy = await seedLegacy(f), ids = f.identities();
  const before = f.database.calls.length;
  assert.equal(await ids.identity('legacy', 'Updated'), legacy.id);
  assert.equal(await ids.alias(legacy.id, 'pod_old', 'member_old'), 'Legacy name');
  await ids.setAlias(legacy.id, 'pod_new', 'member_new', 'New name');
  assert.deepEqual(await ids.memberships(legacy.id), ['pod_new', 'pod_old']);
  assert.equal(f.database.calls.slice(before).some(row => row.path === '/qa/competitions/directory.json'), false);
  assert.equal(f.database.read(valuePath(legacy.id)).aliases.pod_old, undefined, 'Legacy names are read through, not copied in bulk.');
});

test('legacy-bridge creation and a real legacy creator racing through ETags return one canonical ID', { timeout: 10000 }, async t => {
  let arrivals = 0, release;
  const gate = new Promise(resolve => { release = resolve; }); t.after(() => release());
  const f = await fixture(t, { beforeConditionalPut: async ({ path }) => {
    if (path !== '/qa/competitions/directory.json' || arrivals >= 2) return;
    if (++arrivals === 2) release(); await gate;
  } });
  const legacy = new Competitions({ store: f.store() });
  const modern = f.identities({ legacyBridge: true });
  const [oldId, newId] = await Promise.all([legacy.identity('racing', 'Old'), modern.identity('racing', 'New')]);
  assert.equal(arrivals, 2); assert.ok(f.database.conflicts > 0);
  assert.equal(oldId, newId);
  assert.equal(f.database.read(accountPath('racing')).identityId, oldId);
});

test('a failed identity initialization resumes its reserved ID under a fresh adapter', async t => {
  const f = await fixture(t); let failed = false;
  const broken = f.writer(async (url, options) => {
    if (!failed && options.method === 'PUT' && new URL(url).pathname.startsWith('/qa/competitions-v2/identities/')) {
      failed = true; return new Response('{}', { status: 503 });
    }
    return fetch(url, options);
  });
  const ids = new CompetitionIdentityStore({ store: competitionStoreForEnvironment(broken, 'qa') });
  await assert.rejects(() => ids.identity('interrupted', 'Player'), /503/);
  const opening = f.database.read(accountPath('interrupted')); assert.equal(opening.state, 'opening');
  assert.equal(await f.identities().identity('interrupted', 'Player'), opening.identityId);
  assert.equal(f.database.read(accountPath('interrupted')).state, 'active');
});

test('an opening record keeps its legacy-bridge mode when a native-mode helper resumes it', async t => {
  const f = await fixture(t); let failed = false;
  const broken = f.writer(async (url, options) => {
    if (!failed && options.method === 'PUT' && new URL(url).pathname === '/qa/competitions/directory.json') {
      failed = true; return new Response('{}', { status: 503 });
    }
    return fetch(url, options);
  });
  const ids = new CompetitionIdentityStore({ store: competitionStoreForEnvironment(broken, 'qa'), legacyBridge: true });
  await assert.rejects(() => ids.identity('bridge-interrupted', 'Player'), /503/);
  const opening = f.database.read(accountPath('bridge-interrupted'));
  const result = await f.identities().identity('bridge-interrupted', 'Player');
  assert.equal(result, opening.identityId);
  assert.equal(f.database.read('qa/competitions/directory.json').accounts[digest('bridge-interrupted')], result);
});

test('dual-format erasure clears identifying values and preserves other people and numeric results', async t => {
  const f = await fixture(t), legacy = await seedLegacy(f), ids = f.identities();
  await ids.identity('legacy', 'Legacy name'); await ids.setAlias(legacy.id, 'pod_new', 'member_new', 'Private new name');
  const other = await ids.identity('other', 'Other'); await ids.setAlias(other, 'pod_new', 'member_other', 'Other name');
  await f.raw.write('qa/numeric-results/game_one.json', { rating: 1012, order: ['member_new', 'member_other'] });
  const numerical = f.database.read('qa/numeric-results/game_one.json');
  assert.deepEqual(await ids.eraseAccount('legacy'), { erased: true });
  assert.deepEqual(f.database.read(accountPath('legacy')), { schemaVersion: 2, state: 'closed' });
  assert.deepEqual(f.database.read(valuePath(legacy.id)), { schemaVersion: 2, state: 'closed' });
  const old = f.database.read('qa/competitions/directory.json');
  assert.equal(old.accounts?.[legacy.key], undefined); assert.equal(old.identities?.[legacy.id], undefined);
  assert.equal(old.aliases?.pod_old_member_old, undefined); assert.equal(old.closed[legacy.key], true);
  assert.equal(await ids.profile(legacy.id), null); assert.equal(await ids.alias(legacy.id, 'pod_new', 'member_new'), null);
  await assert.rejects(() => ids.identity('legacy', 'Restored'), { code: 'IDENTITY_CLOSED' });
  assert.equal(await ids.alias(other, 'pod_new', 'member_other'), 'Other name');
  assert.deepEqual(f.database.read('qa/numeric-results/game_one.json'), numerical);
});

test('an alias PUT delayed until after erasure cannot resurrect a name or account link', { timeout: 10000 }, async t => {
  let target = null, held = false, entered, release;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; }); t.after(() => release());
  const f = await fixture(t, { beforeConditionalPut: async ({ path }) => {
    if (path !== target || held) return;
    held = true; entered(); await gate;
  } });
  const ids = f.identities(), id = await ids.identity('delayed', 'Before');
  await ids.setAlias(id, 'pod_one', 'member_one', 'Before'); target = '/' + valuePath(id);
  const pending = assert.rejects(ids.setAlias(id, 'pod_one', 'member_one', 'Must not return'), { code: 'IDENTITY_CLOSED' });
  await started; await f.identities().eraseAccount('delayed'); release(); await pending;
  assert.deepEqual(f.database.read(valuePath(id)), { schemaVersion: 2, state: 'closed' });
  assert.deepEqual(f.database.read(accountPath('delayed')), { schemaVersion: 2, state: 'closed' });
});

test('a failed legacy redaction remains closing and a bounded recovery page completes it', async t => {
  const f = await fixture(t), legacy = await seedLegacy(f); let failed = false;
  const normal = f.identities(); await normal.identity('legacy', 'Legacy');
  await normal.setAlias(legacy.id, 'pod_new', 'member_new', 'Private new name');
  const broken = f.writer(async (url, options) => {
    if (!failed && options.method === 'PUT' && new URL(url).pathname === '/qa/competitions/directory.json') {
      failed = true; return new Response('{}', { status: 503 });
    }
    return fetch(url, options);
  });
  const ids = new CompetitionIdentityStore({ store: competitionStoreForEnvironment(broken, 'qa') });
  await assert.rejects(() => ids.eraseAccount('legacy'), /503/);
  assert.equal(f.database.read(accountPath('legacy')).state, 'closing');
  await assert.rejects(() => normal.setAlias(legacy.id, 'pod_new', 'member_new', 'Must not return'), { code: 'IDENTITY_CLOSED' });
  const resumed = await f.identities().resumeErasures({ limit: 10 });
  assert.equal(resumed.processed, 1); assert.equal(resumed.nextCursor, null);
  assert.equal(f.database.read(accountPath('legacy')).state, 'closed');
  assert.equal(f.database.read('qa/competitions/directory.json').aliases?.pod_old_member_old, undefined);
});

test('a closed legacy account never falls back to a newly minted native identity', async t => {
  const f = await fixture(t);
  await f.raw.write(`qa/competitions/directory/closed/${digest('deleted')}.json`, true);
  const before = f.database.calls.length;
  await assert.rejects(() => f.identities().identity('deleted', 'No restore'), { code: 'IDENTITY_CLOSED' });
  assert.equal(f.database.calls.slice(before).some(row => row.method === 'PUT'), false);
  assert.equal(f.database.read(accountPath('deleted')), null);
});

test('erasing an inconsistent reservation never erases another account identity', async t => {
  const f = await fixture(t), ids = f.identities();
  const other = await ids.identity('other', 'Other'); await ids.setAlias(other, 'pod_friends', 'member_other', 'Other name');
  await f.raw.write(accountPath('broken'), { schemaVersion: 2, state: 'opening', mode: 'native', identityId: other });
  await ids.eraseAccount('broken');
  assert.equal(await ids.alias(other, 'pod_friends', 'member_other'), 'Other name');
});

for (const legacyBridge of [false, true]) {
  test(`${legacyBridge ? 'bridge' : 'native'} creation cannot shadow or overwrite a legacy-only identity collision`, async t => {
    const f = await fixture(t); await seedLegacy(f, 'other', 'identity_collision');
    const prior = f.database.read('qa/competitions/directory.json');
    const ids = f.identities({ legacyBridge, createId: () => 'collision' });
    await assert.rejects(() => ids.identity('collision-request', 'Wrong owner'), { code: 'IDENTITY_STORAGE_CONFLICT' });
    assert.deepEqual(f.database.read('qa/competitions/directory.json'), prior);
    assert.equal(f.database.read(valuePath('identity_collision')), null);
    assert.notEqual(f.database.read(accountPath('collision-request'))?.state, 'active');
    assert.equal(await f.identities().alias('identity_collision', 'pod_old', 'member_old'), 'Legacy name');
  });
  test(`${legacyBridge ? 'bridge' : 'native'} creation cannot publish an already erased identity ID`, async t => {
    const f = await fixture(t);
    await f.raw.write(valuePath('identity_erased'), { schemaVersion: 2, state: 'closed' });
    const ids = f.identities({ legacyBridge, createId: () => 'erased' });
    await assert.rejects(() => ids.identity('new-account', 'New'), { code: 'IDENTITY_CLOSED' });
    assert.equal(f.database.read('qa/competitions/directory.json'), null, 'A closed ID cannot acquire a new legacy owner.');
  });
}

test('a native creator cannot steal an ID already reserved by an in-flight bridge creator', { timeout: 10000 }, async t => {
  let entered, release, held = false;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; }); t.after(() => release());
  const f = await fixture(t, { beforeConditionalPut: async ({ path }) => {
    if (path !== '/qa/competitions/directory.json' || held) return;
    held = true; entered(); await gate;
  } });
  const bridge = f.identities({ legacyBridge: true, createId: () => 'shared_candidate' }).identity('bridge-owner', 'Bridge')
    .then(value => ({ value }), error => ({ error }));
  await started;
  const native = await f.identities({ createId: () => 'shared_candidate' }).identity('native-owner', 'Native')
    .then(value => ({ value }), error => ({ error }));
  release(); const completed = await bridge;
  assert.equal(native.error?.code, 'IDENTITY_STORAGE_CONFLICT');
  assert.equal(completed.value, 'identity_shared_candidate');
  assert.equal(f.database.read(valuePath(completed.value)).accountKey, digest('bridge-owner'));
});

test('a corrupt mapping cannot tombstone a foreign legacy-only identity', async t => {
  const f = await fixture(t), legacy = await seedLegacy(f, 'other', 'identity_foreign');
  await f.raw.write(`qa/competitions/directory/accounts/${digest('broken')}.json`, legacy.id);
  await f.identities().eraseAccount('broken');
  assert.equal(f.database.read(valuePath(legacy.id)), null);
  assert.equal(await f.identities().alias(legacy.id, 'pod_old', 'member_old'), 'Legacy name');
  assert.equal(await f.identities().identity('other', 'Still active'), legacy.id);
});

test('erasure durably fences a final legacy ID created after its first account lookup', async t => {
  const f = await fixture(t); let injected = false, finalId;
  const key = digest('late-final');
  await f.raw.write(accountPath('late-final'), { schemaVersion: 2, state: 'opening',
    mode: 'legacy_bridge', resolved: false, identityId: 'identity_provisional' });
  const delayed = f.writer(async (url, options) => {
    const response = await fetch(url, options);
    if (!injected && (!options.method || options.method === 'GET')
      && new URL(url).pathname === `/qa/competitions/directory/accounts/${key}.json`) {
      injected = true;
      finalId = await new Competitions({ store: f.store() }).identity('late-final', 'Legacy final');
    }
    return response;
  });
  const ids = new CompetitionIdentityStore({ store: competitionStoreForEnvironment(delayed, 'qa') });
  await ids.eraseAccount('late-final');
  assert.deepEqual(f.database.read(valuePath('identity_provisional')), { schemaVersion: 2, state: 'closed' });
  assert.deepEqual(f.database.read(valuePath(finalId)), { schemaVersion: 2, state: 'closed' });
  assert.deepEqual(f.database.read(accountPath('late-final')), { schemaVersion: 2, state: 'closed' });
});

test('legacy cleanup never erases a foreign identity referenced by a corrupt account mapping', async t => {
  const f = await fixture(t), ids = f.identities();
  const other = await ids.identity('other', 'Other');
  await f.raw.write('qa/competitions/directory.json', { schemaVersion: 1,
    accounts: { [digest('broken')]: other, [digest('other')]: other },
    identities: { [other]: { accountKey: digest('other') } },
    scopes: { [other]: { pod_other: true } },
    aliases: { pod_other_member_other: { identityId: other, name: 'Other legacy name' } },
  });
  await ids.eraseAccount('broken');
  const directory = f.database.read('qa/competitions/directory.json');
  assert.equal(directory.accounts[digest('other')], other);
  assert.equal(directory.identities[other].accountKey, digest('other'));
  assert.equal(directory.scopes[other].pod_other, true);
  assert.equal(directory.aliases.pod_other_member_other.name, 'Other legacy name');
  assert.equal(await ids.alias(other, 'pod_other', 'member_other'), 'Other legacy name');
});

test('initialization committed with its response lost resumes one reserved identity', async t => {
  const f = await fixture(t); let lost = false;
  const broken = f.writer(async (url, options) => {
    const response = await fetch(url, options);
    if (!lost && options.method === 'PUT' && response.ok
      && new URL(url).pathname.startsWith('/qa/competitions-v2/identities/')) {
      lost = true; await response.arrayBuffer(); throw new Error('Simulated lost initialization response');
    }
    return response;
  });
  const ids = new CompetitionIdentityStore({ store: competitionStoreForEnvironment(broken, 'qa') });
  await assert.rejects(() => ids.identity('lost-open', 'Player'), /lost initialization/);
  const reserved = f.database.read(accountPath('lost-open'));
  assert.equal(reserved.state, 'opening'); assert.equal(f.database.read(valuePath(reserved.identityId)).state, 'active');
  const resumed = await f.identities().identity('lost-open', 'Player');
  assert.equal(resumed, reserved.identityId);
  assert.equal(f.database.calls.filter(row => row.path === '/' + valuePath(resumed) && row.method === 'PUT').length, 1);
});

test('legacy cleanup committed with its response lost remains recoverable without remembered account IDs', async t => {
  const f = await fixture(t), legacy = await seedLegacy(f); let lost = false;
  await f.identities().identity('legacy', 'Player');
  const broken = f.writer(async (url, options) => {
    const response = await fetch(url, options);
    if (!lost && options.method === 'PUT' && response.ok && new URL(url).pathname === '/qa/competitions/directory.json') {
      lost = true; await response.arrayBuffer(); throw new Error('Simulated lost redaction response');
    }
    return response;
  });
  const ids = new CompetitionIdentityStore({ store: competitionStoreForEnvironment(broken, 'qa') });
  await assert.rejects(() => ids.eraseAccount('legacy'), /lost redaction/);
  assert.equal(f.database.read(accountPath('legacy')).state, 'closing');
  assert.equal(f.database.read('qa/competitions/directory.json').identities?.[legacy.id], undefined);
  const result = await f.identities().resumeErasures({ limit: 10 });
  assert.equal(result.processed, 1); assert.equal(f.database.read(accountPath('legacy')).state, 'closed');
});

test('a delayed initializer cannot reopen the value after erasure acknowledges', { timeout: 10000 }, async t => {
  let held = false, entered, release;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; }); t.after(() => release());
  const f = await fixture(t, { beforeConditionalPut: async ({ path }) => {
    if (held || !path.startsWith('/qa/competitions-v2/identities/')) return;
    held = true; entered(); await gate;
  } });
  const opening = assert.rejects(f.identities().identity('late-initializer', 'Player'), { code: 'IDENTITY_CLOSED' });
  await started;
  const id = f.database.read(accountPath('late-initializer')).identityId;
  await f.identities().eraseAccount('late-initializer'); release(); await opening;
  assert.deepEqual(f.database.read(accountPath('late-initializer')), { schemaVersion: 2, state: 'closed' });
  assert.deepEqual(f.database.read(valuePath(id)), { schemaVersion: 2, state: 'closed' });
});

test('deletion between bridge resolution and resolved-ID publication fences both provisional and canonical IDs', { timeout: 10000 }, async t => {
  let legacyHeld = false, enteredLegacy, releaseLegacy, enteredPublication, releasePublication, accountWrites = 0;
  const legacyGate = new Promise(resolve => { releaseLegacy = resolve; });
  const legacyStarted = new Promise(resolve => { enteredLegacy = resolve; });
  const publicationGate = new Promise(resolve => { releasePublication = resolve; });
  const publicationStarted = new Promise(resolve => { enteredPublication = resolve; });
  t.after(() => { releaseLegacy(); releasePublication(); });
  const target = accountPath('bridge-delete');
  const f = await fixture(t, { beforeConditionalPut: async ({ path }) => {
    if (path === '/qa/competitions/directory.json' && !legacyHeld) {
      legacyHeld = true; enteredLegacy(); await legacyGate;
    }
    if (path === '/' + target && ++accountWrites === 2) { enteredPublication(); await publicationGate; }
  } });
  const opening = assert.rejects(f.identities({ legacyBridge: true }).identity('bridge-delete', 'Modern'), { code: 'IDENTITY_CLOSED' });
  await legacyStarted;
  const provisional = f.database.read(target).identityId;
  const legacy = new Competitions({ store: f.store() });
  const canonical = await legacy.identity('bridge-delete', 'Legacy');
  assert.notEqual(provisional, canonical);
  releaseLegacy(); await publicationStarted;
  await f.identities().eraseAccount('bridge-delete'); releasePublication(); await opening;
  assert.deepEqual(f.database.read(valuePath(provisional)), { schemaVersion: 2, state: 'closed' });
  assert.deepEqual(f.database.read(valuePath(canonical)), { schemaVersion: 2, state: 'closed' });
  assert.deepEqual(f.database.read(target), { schemaVersion: 2, state: 'closed' });
  assert.equal(f.database.read('qa/competitions/directory.json').identities?.[canonical], undefined);
});

test('a delayed same-account helper follows the canonical ID after an unused provisional ID closes', { timeout: 10000 }, async t => {
  let rootHeld = false, rootEntered, releaseRoot, valueEntered, releaseValue;
  const rootGate = new Promise(resolve => { releaseRoot = resolve; });
  const rootStarted = new Promise(resolve => { rootEntered = resolve; });
  const valueGate = new Promise(resolve => { releaseValue = resolve; });
  const valueStarted = new Promise(resolve => { valueEntered = resolve; });
  t.after(() => { releaseRoot(); releaseValue(); });
  const f = await fixture(t, { beforeConditionalPut: async ({ path }) => {
    if (path !== '/qa/competitions/directory.json' || rootHeld) return;
    rootHeld = true; rootEntered(); await rootGate;
  } });
  const first = f.identities({ legacyBridge: true, createId: () => 'provisional_concurrent' })
    .identity('canonical-helpers', 'First').then(id => ({ id }), error => ({ error }));
  await rootStarted;
  const provisional = f.database.read(accountPath('canonical-helpers')).identityId;
  let heldValue = false;
  const delayed = f.writer(async (url, options) => {
    if (!heldValue && (!options.method || options.method === 'GET') && new URL(url).pathname === '/' + valuePath(provisional)) {
      heldValue = true; valueEntered(); await valueGate;
    }
    return fetch(url, options);
  });
  const helper = new CompetitionIdentityStore({ store: competitionStoreForEnvironment(delayed, 'qa') });
  const second = helper.identity('canonical-helpers', 'Second').then(id => ({ id }), error => ({ error }));
  await valueStarted;
  const legacy = new Competitions({ store: f.store(), createId: () => 'legacy_canonical' });
  const canonical = await legacy.identity('canonical-helpers', 'Legacy');
  releaseRoot();
  assert.equal((await first).id, canonical);
  assert.deepEqual(f.database.read(valuePath(provisional)), { schemaVersion: 2, state: 'closed' });
  releaseValue(); const resumed = await second;
  assert.equal(resumed.error, undefined); assert.equal(resumed.id, canonical);
});
