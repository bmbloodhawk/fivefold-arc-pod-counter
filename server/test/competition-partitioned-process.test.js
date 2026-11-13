import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { startCompetitionRestFixture } from '../../qa/competition-rest-fixture.mjs';

async function open(databaseUrl) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../../qa/competition-local-server.mjs', import.meta.url))], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: process.env.TEMP, TMP: process.env.TMP,
      COMPETITION_QA_PORT: '0', COMPETITION_QA_DATABASE_URL: databaseUrl, COMPETITION_QA_NATIVE_GROUPS: 'true' },
  });
  let output = '', errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Native QA startup timed out: ' + errors)); }, 10000);
    child.stdout.on('data', chunk => {
      output += chunk; const match = /COMPETITION_QA_READY (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error('Native QA exited: ' + code + ' ' + errors)); });
  });
  const kill = async () => { if (child.exitCode === null && child.signalCode === null) { const stopped = once(child, 'exit'); child.kill('SIGKILL'); await stopped; } };
  return { origin, child, kill };
}

test('a fresh native app process recovers an interrupted HTTP control change without a group ID or client retry', { timeout: 30000 }, async t => {
  let release, entered, replacementEntered, target = null, attempts = 0, paused = true;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  const replacementStarted = new Promise(resolve => { replacementEntered = resolve; });
  const workers = [];
  const database = await startCompetitionRestFixture({ beforeConditionalPut: async ({ path }) => {
    if (paused && path === target) {
      attempts++; if (attempts === 1) entered(); else replacementEntered();
      await gate;
    }
  } });
  t.after(async () => { release(); for (const worker of workers) await worker.kill(); await database.close(); });
  const first = await open(database.url); workers.push(first);
  const call = async (app, path, body, connectionId, timeoutMs = 15000) => {
    const response = await fetch(app.origin + path, { method: body ? 'POST' : 'GET', headers: {
      authorization: 'Bearer qa-native-host', ...(body ? { 'content-type': 'application/json' } : {}),
      ...(connectionId ? { 'x-connection-id': connectionId } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(timeoutMs) });
    const data = await response.json(); assert.ok(response.ok, JSON.stringify(data)); return data;
  };
  const pod = await call(first, '/api/competitions/pods', { name: 'Before process kill', displayName: 'Synthetic host' });
  target = `/qa/competitions-v2/groups/${pod.id}/rows/metadata/group.json`;
  const interrupted = call(first, `/api/competitions/pod/${pod.id}/members`, { action: 'rename', name: 'Recovered after kill' }).then(
    value => ({ value }), error => ({ error: error.name }));
  await started;
  const headPath = `qa/competitions-v2/groups/${pod.id}/head.json`;
  assert.ok(database.read(headPath).pending);
  await first.kill(); assert.ok((await interrupted).error);
  // The replacement receives only the disposable database address, never pod.id.
  const replacement = await open(database.url); workers.push(replacement);
  await replacementStarted;
  assert.equal((await fetch(replacement.origin + '/health', { signal: AbortSignal.timeout(2000) })).status, 200);
  const host = (await call(replacement, '/api/connections', {})).connectionId;
  const guest = (await call(replacement, '/api/connections', {})).connectionId;
  const room = await call(replacement, '/api/rooms', { playerCount: 2, startingLife: 40 }, host);
  const joined = await call(replacement, `/api/rooms/${room.snapshot.code}/claim`, { seatId: 1 }, guest);
  await call(replacement, `/api/rooms/${room.snapshot.code}/start-game`, { baseVersion: joined.snapshot.version }, host);
  const adjusted = await call(replacement, `/api/rooms/${room.snapshot.code}/adjust`, { counter: 'life', delta: -7 }, guest, 2000);
  assert.equal(adjusted.snapshot.seats[1].counters.life, 33, 'Stalled startup recovery must leave casual life updates available.');
  paused = false; release();
  const deadline = Date.now() + 5000;
  while ((database.read(headPath).pending || database.read(headPath).settling) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(database.read(headPath).pending, undefined, 'The background worker must finish before any client asks for its group.');
  assert.equal(database.read(headPath).version, pod.version + 1);
  const recovered = await call(replacement, `/api/competitions/pod/${pod.id}`);
  assert.equal(recovered.name, 'Recovered after kill');
  assert.equal(recovered.audit.filter(row => row.action === 'pod_renamed').length, 1);
  assert.equal(database.read(`qa/competitions/pods/${pod.id}.json`), null);
  assert.ok(database.calls.every(row => row.path !== '/qa/competitions/directory.json'));
  assert.ok(database.calls.some(row => row.path === '/qa/competitions-v2/group-registry.json' && row.query));
});

test('a real app killed before account admission leaves a safely abortable edit and responsive casual play', { timeout: 60000 }, async t => {
  let release, entered, target = null, held = false;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  const workers = [];
  const database = await startCompetitionRestFixture({ beforeConditionalPut: async ({ path }) => {
    if (!held && path === target) { held = true; entered(); await gate; }
  } });
  t.after(async () => { release(); for (const worker of workers) await worker.kill(); await database.close(); });
  const first = await open(database.url); workers.push(first);
  const call = async (app, path, body, connectionId, timeoutMs = 10000) => {
    const response = await fetch(app.origin + path, { method: body ? 'POST' : 'GET', headers: {
      authorization: 'Bearer qa-native-host', ...(body ? { 'content-type': 'application/json' } : {}),
      ...(connectionId ? { 'x-connection-id': connectionId } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(timeoutMs) });
    const data = await response.json(); assert.ok(response.ok, JSON.stringify(data)); return data;
  };
  const pod = await call(first, '/api/competitions/pods', { name: 'Before undecided crash', displayName: 'Synthetic host' });
  const accountKey = Object.keys(database.read('qa/competitions-v2/accounts.json'))[0];
  target = `/qa/competitions-v2/accounts/${accountKey}.json`;
  const interrupted = call(first, `/api/competitions/pod/${pod.id}/members`, { action: 'rename', name: 'Never approved' }, undefined, 45000)
    .then(value => ({ value }), error => ({ error: error.name }));
  await started;
  const path = `qa/competitions-v2/groups/${pod.id}/head.json`, reference = database.read(path).pending.authorization;
  assert.ok(reference); assert.equal(database.read(target.slice(1)).controlOperations, undefined);
  await first.kill(); assert.ok((await interrupted).error);
  const replacement = await open(database.url); workers.push(replacement);
  assert.equal((await fetch(replacement.origin + '/health', { signal: AbortSignal.timeout(2000) })).status, 200);
  const host = (await call(replacement, '/api/connections', {})).connectionId;
  const guest = (await call(replacement, '/api/connections', {})).connectionId;
  const room = await call(replacement, '/api/rooms', { playerCount: 2, startingLife: 40 }, host);
  const joined = await call(replacement, `/api/rooms/${room.snapshot.code}/claim`, { seatId: 1 }, guest);
  await call(replacement, `/api/rooms/${room.snapshot.code}/start-game`, { baseVersion: joined.snapshot.version }, host);
  const changed = await call(replacement, `/api/rooms/${room.snapshot.code}/adjust`, { counter: 'life', delta: -3 }, guest, 2000);
  assert.equal(changed.snapshot.seats[1].counters.life, 37);
  const deadline = reference.abortAfter + 8000;
  while ((database.read(path).pending || database.read(path).settling) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(database.read(path).pending, undefined, 'A fresh background worker must abort without a client retry or remembered group ID.');
  assert.ok(Date.now() >= reference.abortAfter, 'An undecided live admission must not be aborted before its default deadline.');
  assert.equal(database.read(path).version, pod.version + 1);
  assert.equal(database.read(path).settling, undefined);
  release(); await new Promise(resolve => setTimeout(resolve, 100));
  const account = database.read(target.slice(1));
  assert.ok(account.authorizationRevision > reference.admissionRevision);
  assert.equal(account.controlOperations, undefined, 'The late killed-process PUT cannot recreate a retired ticket.');
  const recovered = await call(replacement, `/api/competitions/pod/${pod.id}`);
  assert.equal(recovered.name, 'Before undecided crash');
  assert.equal(recovered.audit.some(row => row.action === 'pod_renamed'), false);
});
