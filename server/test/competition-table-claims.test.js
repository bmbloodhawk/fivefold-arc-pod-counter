import assert from 'node:assert/strict';
import test from 'node:test';
import { FirebasePlaytestLedger } from '../src/playtest-ledger.js';
import { CompetitionTableClaims } from '../src/competition-table-claims.js';
import { competitionStoreForEnvironment } from '../src/competitions.js';
import { digest } from '../src/competition-values.js';
import { startCompetitionRestFixture } from '../../qa/competition-rest-fixture.mjs';

async function fixture(t, options) {
  const database = await startCompetitionRestFixture(options); t.after(() => database.close());
  const writer = fetchImpl => {
    const ledger = new FirebasePlaytestLedger({ databaseUrl: database.url, clientEmail: 'fixture', privateKey: 'fixture', fetchImpl });
    ledger.accessToken = async () => 'local-fixture-only'; return ledger;
  };
  return { database, raw: writer(), claims: fetchImpl => new CompetitionTableClaims({ store: competitionStoreForEnvironment(writer(fetchImpl), 'qa') }) };
}
const target = { kind: 'pod', id: 'pod_friends', roomCode: 'ABC123' };
const legacyPath = key => `qa/competitions/directory/tables/${key}.json`;
const claimPath = key => `qa/competitions-v2/table-claims/${key}.json`;

test('independent adapters claiming the same Table converge and retries do not rewrite', async t => {
  const f = await fixture(t), key = digest('same-table');
  const values = await Promise.all(Array.from({ length: 16 }, () => f.claims().claim(key, target)));
  assert.ok(values.every(value => JSON.stringify(value) === JSON.stringify(target)));
  assert.deepEqual(f.database.read(claimPath(key)), { schemaVersion: 2, ...target });
  const before = f.database.calls.filter(call => call.method === 'PUT').length;
  assert.deepEqual(await f.claims().claim(key, target), target);
  assert.equal(f.database.calls.filter(call => call.method === 'PUT').length, before);
});

test('different groups racing for one Table produce one winner', async t => {
  const f = await fixture(t), key = digest('contested-table');
  const results = await Promise.allSettled(Array.from({ length: 12 }, (_, index) => f.claims().claim(key, { ...target, id: `pod_${index}` })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.ok(results.filter(result => result.status === 'rejected').every(result => result.reason.code === 'TABLE_ALREADY_LINKED'));
  assert.deepEqual(await f.claims().read(key), results.find(result => result.status === 'fulfilled').value);
});

test('different Tables never read or write a shared directory record', async t => {
  const f = await fixture(t);
  await f.raw.write('qa/competitions/directory/aliases.json', Object.fromEntries(Array.from({ length: 10000 }, (_, index) => [`unrelated_${index}`, { name: 'Private unrelated name' }])));
  f.database.calls.splice(0);
  await Promise.all(Array.from({ length: 24 }, (_, index) => f.claims().claim(digest(`table_${index}`), target)));
  assert.equal(f.database.conflicts, 0);
  assert.ok(f.database.calls.every(call => /^\/qa\/competitions(?:-v2\/table-claims|\/directory\/tables)\/[a-f0-9]{64}\.json$/.test(call.path)));
  assert.ok(f.database.calls.filter(call => call.method === 'GET').every(call => call.responseBytes < 256));
});

test('legacy claims read through without copying; conflicting legacy/new owners fail closed', async t => {
  const f = await fixture(t), key = digest('legacy-table');
  await f.raw.write(legacyPath(key), target);
  const before = f.database.calls.filter(call => call.method === 'PUT').length;
  assert.deepEqual(await f.claims().read(key), target);
  assert.equal(f.database.calls.filter(call => call.method === 'PUT').length, before);
  await assert.rejects(f.claims().claim(key, { ...target, id: 'pod_other' }), { code: 'TABLE_ALREADY_LINKED' });
  assert.deepEqual(await f.claims().claim(key, target), target);
  await f.raw.write(legacyPath(key), { ...target, id: 'pod_other' });
  await assert.rejects(f.claims().read(key), { code: 'TABLE_STORAGE_CONFLICT' });
});

test('current event-prefixed tournament IDs work for both legacy and new claims', async t => {
  const f = await fixture(t), event = { kind: 'tournament', id: 'event_existing', roomCode: 'DEF456' };
  const previous = digest('legacy-event-table'), current = digest('new-event-table');
  await f.raw.write(legacyPath(previous), event);
  assert.deepEqual(await f.claims().read(previous), event);
  assert.deepEqual(await f.claims().claim(previous, event), event);
  assert.deepEqual(await f.claims().claim(current, event), event);
  assert.deepEqual(await f.claims().read(current), event);
});

test('a guard is rechecked after a lost CAS race and prevents a stale host claim', async t => {
  let allowed = true, guardCalls = 0, failOnce = true;
  const f = await fixture(t), key = digest('guarded-table');
  const claims = f.claims(async (url, options = {}) => {
    if (options.method === 'PUT' && failOnce) {
      failOnce = false; allowed = false;
      return Response.json(null, { status: 412 });
    }
    return fetch(url, options);
  });
  await assert.rejects(claims.claim(key, target, { guard() {
    guardCalls++; if (!allowed) throw Object.assign(new Error('Host changed'), { code: 'HOST_ONLY' });
  } }), { code: 'HOST_ONLY' });
  assert.equal(guardCalls, 2);
  assert.equal(f.database.read(claimPath(key)), null);
});

test('a committed claim with a lost response can be resumed by a fresh adapter', async t => {
  const f = await fixture(t), key = digest('lost-response'); let loseOnce = true;
  const first = f.claims(async (url, options = {}) => {
    const response = await fetch(url, options);
    if (options.method === 'PUT' && loseOnce) { loseOnce = false; await response.body?.cancel(); throw new Error('Lost fixture response'); }
    return response;
  });
  await assert.rejects(first.claim(key, target), /Lost fixture response/);
  assert.deepEqual(await f.claims().claim(key, target), target);
  await assert.rejects(f.claims().claim(key, { ...target, id: 'pod_other' }), { code: 'TABLE_ALREADY_LINKED' });
});

test('invalid Table keys, targets and guards fail before storage I/O', async () => {
  let calls = 0;
  const claims = new CompetitionTableClaims({ store: { read: async () => { calls++; }, update: async () => { calls++; } } });
  await assert.rejects(claims.read('../bad'), { status: 400 });
  for (const value of [{ ...target, kind: 'public' }, { ...target, id: '../bad' }, { ...target, id: 'tournament_other' }, { ...target, roomCode: 'bad' }]) {
    await assert.rejects(claims.claim(digest('valid'), value), { status: 400 });
  }
  await assert.rejects(claims.claim(digest('valid'), target, { guard: 'invalid' }), /guard/i);
  assert.equal(calls, 0);
});
