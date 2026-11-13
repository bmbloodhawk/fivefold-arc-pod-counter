import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { digest } from '../src/competition-values.js';
import { FirebasePlaytestLedger } from '../src/playtest-ledger.js';
import { CompetitionIdentityStore } from '../src/competition-identity-store.js';
import { competitionStoreForEnvironment } from '../src/competitions.js';
import { startCompetitionRestFixture } from '../../qa/competition-rest-fixture.mjs';

const workerPath = fileURLToPath(new URL('../../qa/identity-local-worker.mjs', import.meta.url));
const root = fileURLToPath(new URL('../../', import.meta.url));
function startWorker(t, url, operation, account) {
  const child = spawn(process.execPath, [workerPath, operation, ...(account ? [account] : [])], {
    cwd: root, windowsHide: true, env: { ...process.env, IDENTITY_QA_DATABASE_URL: url }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '', errors = '';
  child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { errors += chunk; });
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Identity worker timed out.')); }, 10000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (code !== 0) { reject(new Error(`Identity worker stopped (${code ?? signal}): ${errors}`)); return; }
      const line = output.split('\n').find(row => row.startsWith('IDENTITY_QA_RESULT '));
      if (!line) { reject(new Error('Identity worker returned no evidence.')); return; }
      try { resolve(JSON.parse(line.slice('IDENTITY_QA_RESULT '.length))); } catch (error) { reject(error); }
    });
  });
  const kill = async () => {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await once(child, 'close'); }
  };
  t.after(kill);
  return { result, kill };
}
function identities(url) {
  const ledger = new FirebasePlaytestLedger({ databaseUrl: url, clientEmail: 'fixture@example.invalid', privateKey: 'unused-local-fixture-key' });
  ledger.accessToken = async () => 'local-fixture-only';
  return new CompetitionIdentityStore({ store: competitionStoreForEnvironment(ledger, 'qa') });
}

test('two actual identity worker processes converge on one reserved identity through shared REST storage', { timeout: 15000 }, async t => {
  const database = await startCompetitionRestFixture(); t.after(() => database.close());
  const first = startWorker(t, database.url, 'identity', 'qa-concurrent');
  const second = startWorker(t, database.url, 'identity', 'qa-concurrent');
  const [left, right] = await Promise.all([first.result, second.result]);
  assert.equal(left.identityId, right.identityId);
  assert.equal(database.read(`qa/competitions-v2/accounts/${digest('qa-concurrent')}.json`).identityId, left.identityId);
});

test('killing an identity worker during initialization retains the reserved ID for a fresh process', { timeout: 15000 }, async t => {
  let entered, release, held = false;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; }); t.after(() => release());
  const database = await startCompetitionRestFixture({ beforeConditionalPut: async ({ path }) => {
    if (held || !path.startsWith('/qa/competitions-v2/identities/')) return;
    held = true; entered(); await gate;
  } }); t.after(() => database.close());
  const worker = startWorker(t, database.url, 'identity', 'qa-killed-open');
  const stopped = assert.rejects(worker.result, /worker stopped/);
  await started;
  const reserved = database.read(`qa/competitions-v2/accounts/${digest('qa-killed-open')}.json`);
  assert.equal(reserved.state, 'opening'); await worker.kill(); await stopped; release();
  const fresh = startWorker(t, database.url, 'identity', 'qa-killed-open');
  assert.equal((await fresh.result).identityId, reserved.identityId);
});

test('a fresh worker discovers and finishes a killed erasure without being given the account ID', { timeout: 15000 }, async t => {
  let target = null, entered, release, held = false;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; }); t.after(() => release());
  const database = await startCompetitionRestFixture({ beforeConditionalPut: async ({ path }) => {
    if (held || path !== target) return;
    held = true; entered(); await gate;
  } }); t.after(() => database.close());
  const ids = identities(database.url), id = await ids.identity('qa-killed-erase', 'Synthetic');
  await ids.setAlias(id, 'pod_one', 'member_one', 'Name to erase');
  target = `/qa/competitions-v2/identities/${id}.json`;
  const worker = startWorker(t, database.url, 'erase', 'qa-killed-erase');
  const stopped = assert.rejects(worker.result, /worker stopped/);
  await started;
  assert.equal(database.read(`qa/competitions-v2/accounts/${digest('qa-killed-erase')}.json`).state, 'closing');
  await worker.kill(); await stopped; release();
  const fresh = startWorker(t, database.url, 'resume');
  assert.equal((await fresh.result).processed, 1);
  assert.deepEqual(database.read(`qa/competitions-v2/identities/${id}.json`), { schemaVersion: 2, state: 'closed' });
  assert.deepEqual(database.read(`qa/competitions-v2/accounts/${digest('qa-killed-erase')}.json`), { schemaVersion: 2, state: 'closed' });
});

test('a fresh worker resumes a killed Table-claim erasure fence from the durable account ticket', { timeout: 15000 }, async t => {
  let target = null, entered, release, held = false;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  t.after(() => release());
  const database = await startCompetitionRestFixture({ beforeConditionalPut: async ({ path }) => {
    if (held || path !== target) return;
    held = true; entered(); await gate;
  } }); t.after(() => database.close());
  const ids = identities(database.url), account = 'qa-fenced-claim', id = await ids.identity(account, 'Synthetic');
  await ids.setAlias(id, 'pod_one', 'member_one', 'Name to erase');
  const key = digest('process-table'), binding = { kind: 'pod', id: 'pod_one', roomCode: 'ABC123' };
  const ticket = await ids.beginTableClaim(id, key, binding);
  await ids.tableClaims.reserve(key, binding, ticket);
  target = `/qa/competitions-v2/table-claims/${key}.json`;
  const worker = startWorker(t, database.url, 'erase', account), stopped = assert.rejects(worker.result, /worker stopped/);
  await started;
  assert.equal(database.read(`qa/competitions-v2/accounts/${digest(account)}.json`).state, 'closing');
  await worker.kill(); await stopped;
  const fresh = startWorker(t, database.url, 'resume');
  assert.equal((await fresh.result).processed, 1); release();
  assert.equal(await identities(database.url).tableClaims.read(key), null);
  assert.deepEqual(database.read(`qa/competitions-v2/accounts/${digest(account)}.json`), { schemaVersion: 2, state: 'closed' });
  assert.equal(JSON.stringify(database.read('qa/competitions-v2.json')).includes('Name to erase'), false);
});
