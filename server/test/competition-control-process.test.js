import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { startCompetitionRestFixture } from '../../qa/competition-rest-fixture.mjs';

function start(t, databaseUrl, action) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../../qa/competition-control-worker.mjs', import.meta.url)), databaseUrl, action], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: process.env.TEMP, TMP: process.env.TMP },
  });
  let output = '', errors = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { errors += chunk; });
  const result = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code !== 0 || signal) { reject(new Error('Control worker stopped: ' + code + '/' + signal + ' ' + errors)); return; }
      try { resolve(JSON.parse(output)); } catch (error) { reject(error); }
    });
  });
  const kill = async () => {
    if (child.exitCode === null && child.signalCode === null) { const stopped = once(child, 'close'); child.kill('SIGKILL'); await stopped; }
  };
  t.after(kill);
  return { child, result, kill };
}

test('a rejected asynchronous guard is reported without an unhandled rejection or process exit', async t => {
  const database = await startCompetitionRestFixture(); t.after(() => database.close());
  const result = await start(t, database.url, 'async-guard').result;
  assert.equal(result.code, 'CONTROL_INPUT');
  assert.equal(database.read('qa/competitions-v2/groups/pod_async_guard/head.json'), null);
});

for (const phase of ['intent', 'ticket', 'child', 'receipt', 'commit', 'cleanup']) {
  test(`a fresh process discovers and finishes a control operation killed at ${phase}, without a group ID or client retry`, { timeout: 20000 }, async t => {
    let release, entered, held = false, database;
    const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
    t.after(() => release());
    const id = 'pod_process_crash', headPath = `qa/competitions-v2/groups/${id}/head.json`;
    database = await startCompetitionRestFixture({ beforeConditionalPut: async ({ path }) => {
      const head = database.read(headPath);
      const target = phase === 'intent' ? path === '/' + headPath && !head
        : phase === 'ticket' ? path === `/qa/competitions-v2/group-work/${id}.json` && head?.version === 0
        : phase === 'child' ? path.endsWith(`/groups/${id}/rows/members/member_owner.json`)
        : phase === 'receipt' ? path.endsWith(`/groups/${id}/operations/control_process_create.json`)
        : phase === 'commit' ? path === '/' + headPath && head?.version === 0 && head?.pending?.applied === 2
        : path === `/qa/competitions-v2/group-work/${id}.json` && head?.version === 1;
      if (!held && target) { held = true; entered(); await gate; }
    } });
    t.after(() => database.close());
    const first = start(t, database.url, 'apply'), stopped = assert.rejects(first.result, /Control worker stopped/);
    await started; await first.kill(); await stopped;
    release(); await new Promise(resolve => setImmediate(resolve));
    const recovered = await start(t, database.url, 'recover').result;
    assert.ok(recovered.ticks.every(tick => tick.errors.length === 0));
    const head = database.read(headPath);
    assert.equal(head.version, 1); assert.equal(head.pending, undefined);
    assert.equal(database.read(`qa/competitions-v2/group-work/${id}.json`), null);
    assert.equal(JSON.parse(database.read(`qa/competitions-v2/groups/${id}/rows/members/member_owner.json`).json).role, 'admin');
    const retry = await start(t, database.url, 'apply').result;
    assert.equal(retry.admission.duplicate, true); assert.equal(retry.admission.version, 1);
    assert.equal(database.read(headPath).version, 1);
    assert.ok(database.calls.filter(call => /\/(group-work|group-registry)\.json$/.test(call.path)).every(call => call.query));
    assert.ok(database.calls.every(call => !/\/directory\.json$|\/games\/|\/table-claims\//.test(call.path)));
  });
}
