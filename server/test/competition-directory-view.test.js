import assert from 'node:assert/strict';
import test from 'node:test';
import { CompetitionDirectoryView } from '../src/competition-directory-view.js';
import { CompetitionIdentityStore } from '../src/competition-identity-store.js';
import { FirebasePlaytestLedger } from '../src/playtest-ledger.js';
import { competitionStoreForEnvironment } from '../src/competitions.js';
import { digest } from '../src/competition-values.js';
import { startCompetitionRestFixture } from '../../qa/competition-rest-fixture.mjs';

async function fixture(t, options) {
  const database = await startCompetitionRestFixture(options); t.after(() => database.close());
  const raw = new FirebasePlaytestLedger({ databaseUrl: database.url, clientEmail: 'fixture', privateKey: 'fixture' });
  raw.accessToken = async () => 'local-fixture-only';
  const store = competitionStoreForEnvironment(raw, 'qa'), identities = new CompetitionIdentityStore({ store });
  return { database, raw, store, identities, view: new CompetitionDirectoryView({ store, identities }) };
}
const member = (id, identityId) => ({ id, identityId, kind: 'member', status: 'active', role: 'member' });
const guest = id => ({ id, kind: 'guest', status: 'active', role: 'participant' });

test('a scope view reads only its requested identities and names, excluding old Pod guests', async t => {
  const f = await fixture(t), id = await f.identities.identity('host', 'Host');
  await f.identities.setAlias(id, 'pod_friends', 'member_host', 'Host name');
  await f.identities.setAlias(id, 'pod_other', 'member_other', 'Private other Pod');
  await f.view.setGuestAlias('pod_friends', 'guest_current', 'Current guest');
  await f.view.setGuestAlias('pod_friends', 'guest_old', 'Old guest');
  await f.raw.write('qa/competitions/directory/aliases.json', Object.fromEntries(Array.from({ length: 10000 }, (_, index) => [`unrelated_${index}`, { name: 'Private unrelated name' }])));
  const scope = { id: 'pod_friends', kind: 'pod', members: { member_host: member('member_host', id), guest_current: guest('guest_current'), guest_old: guest('guest_old') } };
  f.database.calls.splice(0);
  const directory = await f.view.read(scope, { accountId: 'host' }, { participantIds: ['guest_current'] });
  assert.equal(directory.accounts[digest('host')], id);
  assert.ok(directory.identities[id]);
  assert.equal(directory.aliases.pod_friends_member_host.name, 'Host name');
  assert.equal(directory.aliases.pod_friends_guest_current.name, 'Current guest');
  assert.equal(directory.aliases.pod_friends_guest_old, undefined);
  assert.equal(/Private other|Private unrelated|Old guest|accountKey/.test(JSON.stringify(directory)), false);
  assert.equal(f.database.calls.some(call => /\/(directory|aliases|identities|accounts)\.json$/.test(call.path)), false);
  assert.equal(f.database.calls.some(call => call.path.includes('guest_old')), false);
  assert.ok(f.database.calls.filter(call => call.method === 'GET').every(call => call.responseBytes < 1024));
});

test('guest-entry retries preserve the first name; explicit updates and duplicate writes remain idempotent', async t => {
  const f = await fixture(t), scope = { id: 'event_test', kind: 'tournament', members: { guest_one: guest('guest_one') } };
  await f.view.setGuestAlias(scope.id, 'guest_one', 'First guest', { preserveExisting: true });
  await f.view.setGuestAlias(scope.id, 'guest_one', 'Retry name', { preserveExisting: true });
  assert.equal((await f.view.read(scope, null)).aliases.event_test_guest_one.name, 'First guest');
  await f.view.setGuestAlias(scope.id, 'guest_one', 'Updated guest');
  const before = f.database.calls.filter(call => call.method === 'PUT').length;
  await f.view.setGuestAlias(scope.id, 'guest_one', 'Updated guest');
  assert.equal(f.database.calls.filter(call => call.method === 'PUT').length, before);
  const owner = await f.identities.identity('unrelated', 'Unrelated');
  await assert.rejects(f.view.setGuestAlias(scope.id, 'guest_one', 'Wrong owner', { identityId: owner }), { code: 'ALIAS_OWNER_CONFLICT' });
  assert.equal(await f.identities.alias(owner, scope.id, 'guest_one'), null);
});

test('a delayed account-owned guest write cannot restore the erased player name', async t => {
  let release, started;
  const paused = new Promise(resolve => { started = resolve; }), blocked = new Promise(resolve => { release = resolve; });
  let pause = true;
  const f = await fixture(t, { beforeConditionalPut: async ({ path }) => {
    if (pause && path.includes('/guest-aliases/')) { pause = false; started(); await blocked; }
  } });
  t.after(() => release());
  const id = await f.identities.identity('erase-me', 'Private name');
  const pending = f.view.setGuestAlias('pod_friends', 'guest_former', 'Private name', { identityId: id });
  await paused; await f.identities.eraseAccount('erase-me'); release(); await pending;
  const scope = { id: 'pod_friends', kind: 'pod', members: { guest_former: guest('guest_former') } };
  const directory = await f.view.read(scope, null, { participantIds: ['guest_former'] });
  assert.equal(directory.aliases.pod_friends_guest_former.name, 'Deleted member');
  assert.equal(JSON.stringify(f.database.read('qa/competitions-v2.json')).includes('Private name'), false);
  assert.deepEqual(f.database.read('qa/competitions-v2/guest-aliases/pod_friends/guest_former.json'), { schemaVersion: 2, identityId: id, erasedBeforeName: true });
});

test('erasure after an owned guest name was recorded retains the existing generic guest fallback', async t => {
  const f = await fixture(t), id = await f.identities.identity('former', 'Former');
  await f.view.setGuestAlias('pod_friends', 'guest_former', 'Private name', { identityId: id });
  await f.identities.eraseAccount('former');
  const scope = { id: 'pod_friends', kind: 'pod', members: { guest_former: guest('guest_former') } };
  assert.equal((await f.view.read(scope, null, { participantIds: ['guest_former'] })).aliases.pod_friends_guest_former, undefined);
  assert.equal(JSON.stringify(f.database.read('qa/competitions-v2.json')).includes('Private name'), false);
});

test('an owned guest alias storage failure is visible and retry resumes the reserved pointer', async t => {
  const f = await fixture(t), id = await f.identities.identity('owner', 'Owner');
  const setAlias = f.identities.setAlias.bind(f.identities);
  f.identities.setAlias = async () => { throw Object.assign(new Error('Fixture unavailable'), { code: 'STORAGE_FAILURE' }); };
  await assert.rejects(f.view.setGuestAlias('pod_friends', 'guest_owned', 'Owned name', { identityId: id }), { code: 'STORAGE_FAILURE' });
  assert.deepEqual(f.database.read('qa/competitions-v2/guest-aliases/pod_friends/guest_owned.json'), { schemaVersion: 2, identityId: id });
  f.identities.setAlias = setAlias;
  await f.view.setGuestAlias('pod_friends', 'guest_owned', 'Owned name', { identityId: id });
  const directory = await f.view.read({ id: 'pod_friends', kind: 'pod', members: { guest_owned: guest('guest_owned') } }, null, { participantIds: ['guest_owned'] });
  assert.equal(directory.aliases.pod_friends_guest_owned.name, 'Owned name');
});

test('legacy owned guest names honor identity erasure while unrelated unowned guests remain', async t => {
  const f = await fixture(t), id = 'identity_legacy', key = digest('legacy');
  await f.raw.write('qa/competitions/directory.json', { schemaVersion: 1,
    accounts: { [key]: id }, identities: { [id]: { accountKey: key } },
    aliases: { event_old_member_one: { identityId: id, name: 'Legacy member' },
      event_old_guest_owned: { identityId: id, name: 'Legacy attested' },
      event_old_guest_unowned: { name: 'Other guest' } } });
  const scope = { id: 'event_old', kind: 'tournament', members: {
    member_one: member('member_one', id), guest_owned: guest('guest_owned'), guest_unowned: guest('guest_unowned'),
  } };
  const before = f.database.calls.length;
  assert.equal((await f.view.read(scope, 'legacy')).aliases.event_old_guest_owned.name, 'Legacy attested');
  assert.equal(f.database.calls.slice(before).some(call => call.path === '/qa/competitions/directory.json'), false);
  await f.identities.eraseAccount('legacy');
  const directory = await f.view.read(scope, 'legacy');
  assert.equal(Object.keys(directory.accounts).length, 0);
  assert.equal(directory.identities[id], undefined);
  assert.equal(directory.aliases.event_old_guest_owned, undefined);
  assert.equal(directory.aliases.event_old_guest_unowned.name, 'Other guest');
});

test('scoped reads do not resume closing actors or download the large legacy directory', async t => {
  const f = await fixture(t), key = digest('closing'), id = 'identity_closing';
  await f.raw.write('qa/competitions/directory.json', { schemaVersion: 1,
    accounts: { [key]: id }, identities: { [id]: { accountKey: key } },
    aliases: Object.fromEntries(Array.from({ length: 10000 }, (_, index) => [`unrelated_${index}`, { name: 'Unrelated name' }])) });
  await f.raw.write(`qa/competitions-v2/accounts/${key}.json`, { schemaVersion: 2, state: 'closing', identityIds: [id] });
  f.database.calls.splice(0);
  const directory = await f.view.read({ id: 'pod_friends', kind: 'pod', members: {} }, 'closing');
  assert.equal(Object.keys(directory.accounts).length, 0);
  assert.equal(f.database.calls.some(call => call.path === '/qa/competitions/directory.json'), false);
  assert.equal(f.database.calls.filter(call => call.method === 'PUT').length, 0);
  assert.equal(f.database.read(`qa/competitions-v2/accounts/${key}.json`).state, 'closing');
});

test('identity lookups are bounded and do not cache erased names across calls', async t => {
  let release; const blocked = new Promise(resolve => { release = resolve; }); t.after(() => release());
  let running = 0, peak = 0, started = 0, closed = false;
  const view = new CompetitionDirectoryView({ concurrency: 3,
    store: { read: async () => null, update: async () => {} }, identities: {
      lookup: async () => 'identity_0', setAlias: async () => {}, scopeProfile: async (id, _scope, ids) => {
        started++; running++; peak = Math.max(peak, running); await blocked; running--;
        return closed ? null : { identityId: id, names: Object.fromEntries(ids.map(pid => [pid, 'Member name'])) };
      },
    } });
  const scope = { id: 'pod_many', kind: 'pod', members: Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`member_${index}`, member(`member_${index}`, `identity_${index}`)])) };
  const first = view.read(scope, null);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(started, 3);
  release(); assert.equal(Object.keys((await first).identities).length, 20); assert.equal(peak, 3);
  closed = true;
  assert.equal(Object.keys((await view.read(scope, null)).aliases).length, 0);
});

test('an identity storage failure is not rendered as deleted members or an empty successful view', async () => {
  const view = new CompetitionDirectoryView({ store: { read: async () => null, update: async () => {} }, identities: {
    lookup: async () => { throw Object.assign(new Error('Fixture unavailable'), { code: 'STORAGE_FAILURE' }); },
    scopeProfile: async () => null, setAlias: async () => {},
  } });
  await assert.rejects(view.read({ id: 'pod_friends', kind: 'pod', members: {} }, 'host'), { code: 'STORAGE_FAILURE' });
});

test('invalid scoped inputs and guest names fail before reading or writing storage', async t => {
  const f = await fixture(t), before = f.database.calls.length;
  await assert.rejects(f.view.read({ id: '../bad', kind: 'pod', members: {} }, null), { status: 400 });
  await assert.rejects(f.view.read({ id: 'pod_valid', kind: 'pod', members: {} }, null, { participantIds: ['../bad'] }), { status: 400 });
  await assert.rejects(f.view.setGuestAlias('pod_valid', 'guest_one', '<script>'), { status: 400 });
  await assert.rejects(f.view.setGuestAlias('pod_valid', '../bad', 'Name'), { status: 400 });
  await assert.rejects(f.view.setGuestAlias('pod_valid', 'guest_one', 'Name', { identityId: 'foreign' }), { status: 400 });
  assert.equal(f.database.calls.length, before);
});
