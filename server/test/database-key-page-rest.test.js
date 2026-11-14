import assert from 'node:assert/strict';
import test from 'node:test';
import { FirebasePlaytestLedger } from '../src/playtest-ledger.js';
import { competitionStoreForEnvironment } from '../src/competitions.js';
import { coordinateCompetitionWrites } from '../src/competition-write-coordinator.js';
import { startCompetitionRestFixture } from '../../qa/competition-rest-fixture.mjs';

function fixtureLedger(databaseUrl, fetchImpl = fetch) {
  const ledger = new FirebasePlaytestLedger({ databaseUrl, clientEmail: 'fixture@example.invalid',
    privateKey: 'unused-local-fixture-key', fetchImpl, logger: { error() {} } });
  ledger.accessToken = async () => 'local-fixture-only';
  return ledger;
}
const key = index => `g_${String(index).padStart(5, '0')}`;

test('actual REST pages transfer a bounded subset of a 10,000-game collection in both directions', async t => {
  const database = await startCompetitionRestFixture(); t.after(() => database.close());
  const ledger = fixtureLedger(database.url);
  const history = Object.fromEntries(Array.from({ length: 10000 }, (_, index) =>
    [key(index), { gameId: `game_${index}`, completedAt: index, status: 'confirmed' }]));
  await ledger.write('qa/competitions-v2/history/pod_one.json', history);
  const store = coordinateCompetitionWrites(competitionStoreForEnvironment(ledger, 'qa'));
  const first = await store.page('competitions-v2/history/pod_one.json', { limit: 17 });
  assert.deepEqual(first.items.map(row => row.key), Array.from({ length: 17 }, (_, index) => key(index)));
  const second = await store.page('competitions-v2/history/pod_one.json', { limit: 17, cursor: first.nextCursor });
  assert.deepEqual(second.items.map(row => row.key), Array.from({ length: 17 }, (_, index) => key(index + 17)));
  const newest = await store.page('competitions-v2/history/pod_one.json', { limit: 17, direction: 'desc' });
  assert.deepEqual(newest.items.map(row => row.key), Array.from({ length: 17 }, (_, index) => key(9999 - index)));
  const older = await store.page('competitions-v2/history/pod_one.json', { limit: 17, direction: 'desc', cursor: newest.nextCursor });
  assert.deepEqual(older.items.map(row => row.key), Array.from({ length: 17 }, (_, index) => key(9982 - index)));
  const reads = database.calls.filter(row => row.method === 'GET');
  assert.equal(reads.length, 4, 'Each page is exactly one network read.');
  assert.ok(reads.every(row => row.path === '/qa/competitions-v2/history/pod_one.json'));
  assert.ok(reads.every(row => row.returnedEntries <= 19 && row.responseBytes < 4000), 'Server response, not only client slicing, must be bounded.');
  assert.ok(reads.every(row => JSON.parse(new URLSearchParams(row.query).get('orderBy')) === '$key'));
  assert.equal(database.read('competitions-v2/history/pod_one.json'), null, 'No production-namespace write occurred.');
});

test('REST cursor walks do not duplicate or omit rows when the boundary is deleted', async t => {
  const database = await startCompetitionRestFixture(); t.after(() => database.close());
  const ledger = fixtureLedger(database.url), path = 'qa/history/pod_walk.json';
  await ledger.write(path, Object.fromEntries(Array.from({ length: 31 }, (_, index) => [key(index), { index }])));
  const seen = []; let cursor = null;
  do {
    const page = await ledger.page(path, { limit: 7, cursor });
    seen.push(...page.items.map(row => row.value.index)); cursor = page.nextCursor;
    if (cursor) await ledger.update(`qa/history/pod_walk/${cursor}.json`, () => null);
  } while (cursor);
  assert.deepEqual(seen, Array.from({ length: 31 }, (_, index) => index));
});

test('an invalid page rejects before credentials or network access', async () => {
  let credentials = 0, network = 0;
  const ledger = fixtureLedger('https://fixture.invalid', async () => { network++; throw new Error('Unexpected network'); });
  ledger.accessToken = async () => { credentials++; return 'local-fixture-only'; };
  for (const [path, options] of [['../private.json', {}], ['history/pod.json', { limit: 1000 }],
    ['history/pod.json', { cursor: 'bad/key' }]]) {
    await assert.rejects(() => ledger.page(path, options), { code: 'INVALID_STORAGE_PAGE' });
  }
  assert.deepEqual({ credentials, network }, { credentials: 0, network: 0 });
});

test('storage failures cannot masquerade as an empty history page', async () => {
  const ledger = fixtureLedger('https://fixture.invalid', async () => new Response('{}', { status: 503 }));
  await assert.rejects(() => ledger.page('history/pod.json'), /read failed \(503\)/);
});

test('page reads remain independent while an unrelated competition write waits', { timeout: 5000 }, async t => {
  const database = await startCompetitionRestFixture(); t.after(() => database.close());
  const ledger = fixtureLedger(database.url), raw = competitionStoreForEnvironment(ledger, 'qa');
  const store = coordinateCompetitionWrites(raw); let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; }); t.after(() => release());
  raw.update = async () => { entered(); await gate; return null; };
  const writing = store.update('groups/blocked.json', () => ({ waiting: true }));
  await started;
  assert.deepEqual(await store.page('history/other.json'), { items: [], nextCursor: null });
  release(); await writing;
});
