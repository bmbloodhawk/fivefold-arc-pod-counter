import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { startCompetitionRestFixture } from '../../qa/competition-rest-fixture.mjs';
import { FirebasePlaytestLedger } from '../src/playtest-ledger.js';
import { competitionStoreForEnvironment } from '../src/competitions.js';
import { CompetitionIdentityStore } from '../src/competition-identity-store.js';

async function open(databaseUrl) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../../qa/competition-local-server.mjs', import.meta.url))], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: process.env.TEMP, TMP: process.env.TMP,
      COMPETITION_QA_PORT: '0', COMPETITION_QA_DATABASE_URL: databaseUrl, COMPETITION_QA_NATIVE_GROUPS: 'true' },
  });
  let output = '', errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Setup QA startup timed out: ' + errors)); }, 10000);
    child.stdout.on('data', chunk => { output += chunk; const match = /COMPETITION_QA_READY (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
      if (match) { clearTimeout(timer); resolve(match[1]); } });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error('Setup QA exited: ' + code + ' ' + errors)); });
  });
  const kill = async () => { if (child.exitCode === null && child.signalCode === null) { const stopped = once(child, 'exit'); child.kill('SIGKILL'); await stopped; } };
  const call = async (path, body, { guestToken, connectionId, timeoutMs = 15000 } = {}) => {
    const response = await fetch(origin + path, { method: body ? 'POST' : 'GET', headers: {
      ...(guestToken ? { 'x-event-token': guestToken } : { authorization: 'Bearer qa-setup-host' }),
      ...(body ? { 'content-type': 'application/json' } : {}), ...(connectionId ? { 'x-connection-id': connectionId } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(timeoutMs) });
    const data = await response.json(); assert.ok(response.ok, JSON.stringify(data)); return data;
  };
  return { child, origin, kill, call };
}

async function prepare(app, type) {
  if (type === 'account') {
    const scope = await app.call('/api/competitions/pods', { name: 'Process setup Pod', displayName: 'Synthetic host' });
    return { scope, participantId: scope.me };
  }
  const scope = await app.call('/api/competitions/tournaments', { name: 'Process guest setup', displayName: 'Synthetic host', preferredSize: 2, rounds: 1 });
  const invitation = await app.call(`/api/competitions/tournament/${scope.id}/invites`, {});
  const entrants = [];
  for (let index = 0; index < 2; index++) {
    const response = await fetch(app.origin + '/api/competitions/join', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: invitation.token, displayName: `Synthetic guest ${index}`, requestId: `setup_process_guest_${index}` }), signal: AbortSignal.timeout(10000) });
    const entrant = await response.json(); assert.ok(response.ok, JSON.stringify(entrant)); entrants.push(entrant);
  }
  const prepared = await app.call(`/api/competitions/tournament/${scope.id}/rounds/prepare`, {}), assignment = prepared.rounds[0].assignments[0];
  const host = entrants.find(row => row.me === assignment.hostId); assert.ok(host?.guestToken);
  return { scope, participantId: host.me, assignmentId: assignment.id, guestToken: host.guestToken };
}

const phases = ['stub', 'claim', 'decision', 'child', 'head', 'claim_publish', 'retire'];
for (const type of ['account', 'capability']) for (const phase of phases) {
  test(`fresh app recovers ${type} Table setup killed at ${phase} without a group ID or client retry`, { timeout: 65000 }, async t => {
    const workers = []; let database, headPath, active = false, held = false, release, entered;
    const started = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
    database = await startCompetitionRestFixture({ beforeConditionalPut: async ({ path }) => {
      if (!active || held) return;
      const head = database.read(headPath), ref = head?.pending?.authorization || head?.settling;
      const claimPath = ref?.claim ? `qa/competitions-v2/table-claims/${ref.claim.key}.json` : null;
      const claim = claimPath ? database.read(claimPath) : null;
      const account = ref?.accountKey ? database.read(`qa/competitions-v2/accounts/${ref.accountKey}.json`) : null;
      const receipt = ref ? database.read(`qa/competitions-v2/groups/${ref.id}/operations/${ref.operationId}.json`) : null;
      const match = phase === 'stub' ? path === '/' + headPath && !head?.pending && !head?.settling
        : phase === 'claim' ? path === '/' + claimPath && !claim
        : phase === 'decision' ? type === 'account'
          ? path === `/qa/competitions-v2/accounts/${ref?.accountKey}.json` && account?.controlOperations?.[ref.operationId]?.state === 'pending' && claim?.state === 'pending'
          : path === '/' + headPath && head?.pending?.decision === 'pending' && claim?.state === 'pending'
        : phase === 'child' ? ref && path === `/qa/competitions-v2/groups/${ref.id}/rows/tables/${ref.claim.key}.json`
        : phase === 'head' ? path === '/' + headPath && head?.pending?.applied > 0 && receipt?.outcome === 'committed'
        : phase === 'claim_publish' ? path === '/' + claimPath && head?.settling && claim?.state === 'pending'
        : type === 'account'
          ? path === `/qa/competitions-v2/accounts/${ref?.accountKey}.json` && head?.settling && claim?.state === 'ready'
          : path === '/' + headPath && head?.settling && claim?.state === 'ready';
      if (match) { held = true; entered(); await gate; }
    } });
    t.after(async () => { release(); for (const worker of workers) await worker.kill(); await database.close(); });
    const first = await open(database.url); workers.push(first);
    const context = await prepare(first, type), scope = context.scope;
    headPath = `qa/competitions-v2/groups/${scope.id}/head.json`;
    const baseVersion = database.read(headPath).version;
    const host = (await first.call('/api/connections', {})).connectionId;
    const room = await first.call('/api/rooms', { playerCount: 2, startingLife: 40 }, { connectionId: host });
    active = true;
    const interrupted = first.call('/api/competitions/tables/bind', { kind: scope.kind, id: scope.id, code: room.snapshot.code,
      ...(context.assignmentId ? { assignmentId: context.assignmentId } : {}) }, { guestToken: context.guestToken, connectionId: host, timeoutMs: 60000 })
      .then(value => ({ value }), error => ({ error: error.name }));
    await started;
    await first.kill(); assert.ok((await interrupted).error, 'The requester must actually die before its HTTP acknowledgement.');
    // Replacement input contains only the storage address, never the scope ID.
    const replacement = await open(database.url); workers.push(replacement);
    assert.equal((await fetch(replacement.origin + '/health', { signal: AbortSignal.timeout(2000) })).status, 200);
    const casualHost = (await replacement.call('/api/connections', {})).connectionId;
    const casualGuest = (await replacement.call('/api/connections', {})).connectionId;
    const casual = await replacement.call('/api/rooms', { playerCount: 2, startingLife: 40 }, { connectionId: casualHost });
    const claimed = await replacement.call(`/api/rooms/${casual.snapshot.code}/claim`, { seatId: 1 }, { connectionId: casualGuest });
    await replacement.call(`/api/rooms/${casual.snapshot.code}/start-game`, { baseVersion: claimed.snapshot.version }, { connectionId: casualHost });
    const adjusted = await replacement.call(`/api/rooms/${casual.snapshot.code}/adjust`, { counter: 'life', delta: -2 }, { connectionId: casualGuest, timeoutMs: 2000 });
    assert.equal(adjusted.snapshot.seats[1].counters.life, 38);
    if (phase === 'stub') release();
    const discoveryDeadline = Date.now() + 5000;
    while (!database.read(headPath)?.pending?.authorization && !database.read(headPath)?.settling && database.read(headPath)?.version === baseVersion
      && Date.now() < discoveryDeadline) await new Promise(resolve => setTimeout(resolve, 25));
    const visible = database.read(headPath), ref = visible.pending?.authorization || visible.settling;
    const approved = ['child', 'head', 'claim_publish', 'retire'].includes(phase);
    const deadline = approved ? Date.now() + 8000 : (ref?.abortAfter || 0) + 8000;
    while ((database.read(headPath).pending || database.read(headPath).settling) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    const completed = database.read(headPath);
    assert.equal(completed.pending, undefined, 'Background recovery must finish before any group GET.');
    assert.equal(completed.settling, undefined); assert.equal(completed.version, baseVersion + 1);
    release(); await new Promise(resolve => setTimeout(resolve, 100));
    const tableRows = Object.values(database.read(`qa/competitions-v2/groups/${scope.id}/rows/tables.json`) || {}).map(row => JSON.parse(row.json));
    const claims = Object.values(database.read('qa/competitions-v2/table-claims.json') || {}).filter(row => row.roomCode === room.snapshot.code);
    assert.equal(claims.length, 1);
    if (approved) {
      assert.equal(claims[0].state, 'ready'); assert.equal(tableRows.length, 1); assert.equal(tableRows[0].hostId, context.participantId);
    } else {
      assert.ok(Date.now() >= ref.abortAfter); assert.equal(claims[0].state, 'cancelled'); assert.equal(tableRows.length, 0);
    }
    for (const row of Object.values(database.read('qa/competitions-v2/accounts.json') || {})) {
      assert.equal(row.controlOperations, undefined); assert.equal(row.tableClaims, undefined);
    }
    const recovered = await replacement.call(`/api/competitions/${scope.kind}/${scope.id}`, undefined, { guestToken: context.guestToken });
    assert.equal(recovered.id, scope.id);
    assert.ok(database.calls.every(row => row.path !== '/qa/competitions/directory.json'));
    assert.ok(database.calls.some(row => row.path === '/qa/competitions-v2/group-registry.json' && row.query));
  });
}

function fixtureIdentities(database) {
  const raw = new FirebasePlaytestLedger({ databaseUrl: database.url, clientEmail: 'fixture', privateKey: 'fixture' });
  raw.accessToken = async () => 'local-fixture-only';
  return new CompetitionIdentityStore({ store: competitionStoreForEnvironment(raw, 'qa') });
}
for (const type of ['account', 'capability']) {
  test(`fresh app retires ${type} setup that reused an older ready claim without a nonce`, { timeout: 30000 }, async t => {
    let database, headPath, armed = false, seeded = false, retiring = false, stopAtRetire = false, enterSeed, releaseSeed, enterRetire, releaseRetire;
    const seedStarted = new Promise(resolve => { enterSeed = resolve; }), seedGate = new Promise(resolve => { releaseSeed = resolve; });
    const retireStarted = new Promise(resolve => { enterRetire = resolve; }), retireGate = new Promise(resolve => { releaseRetire = resolve; });
    const workers = [];
    database = await startCompetitionRestFixture({ beforeConditionalPut: async ({ path }) => {
      if (!armed) return;
      const head = database.read(headPath), ref = head?.pending?.authorization || head?.settling;
      if (!ref) return;
      const claim = database.read(`qa/competitions-v2/table-claims/${ref.claim.key}.json`);
      if (!seeded && path === `/qa/competitions-v2/table-claims/${ref.claim.key}.json` && !claim) {
        seeded = true; enterSeed(); await seedGate;
      } else if (stopAtRetire && !retiring && head.settling && claim?.state !== 'pending'
        && path === (type === 'account' ? `/qa/competitions-v2/accounts/${ref.accountKey}.json` : '/' + headPath)) {
        retiring = true; enterRetire(); await retireGate;
      }
    } });
    t.after(async () => { releaseSeed(); releaseRetire(); for (const worker of workers) await worker.kill(); await database.close(); });
    const first = await open(database.url); workers.push(first);
    const context = await prepare(first, type), scope = context.scope; headPath = `qa/competitions-v2/groups/${scope.id}/head.json`;
    const host = (await first.call('/api/connections', {})).connectionId;
    const room = await first.call('/api/rooms', { playerCount: 2, startingLife: 40 }, { connectionId: host });
    armed = true;
    const linking = first.call('/api/competitions/tables/bind', { kind: scope.kind, id: scope.id, code: room.snapshot.code,
      ...(context.assignmentId ? { assignmentId: context.assignmentId } : {}) }, { guestToken: context.guestToken, connectionId: host })
      .then(value => ({ value }), error => ({ error: error.name }));
    await seedStarted;
    const ref = database.read(headPath).pending.authorization, identities = fixtureIdentities(database);
    await identities.tableClaims.claim(ref.claim.key, ref.claim.binding);
    const previous = database.read(`qa/competitions-v2/table-claims/${ref.claim.key}.json`); assert.equal(previous.operationId, undefined);
    stopAtRetire = true; releaseSeed(); await retireStarted;
    await first.kill(); assert.ok((await linking).error);
    const replacement = await open(database.url); workers.push(replacement);
    const deadline = Date.now() + 8000;
    while (database.read(headPath).settling && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(database.read(headPath).settling, undefined);
    releaseRetire(); await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(database.read(`qa/competitions-v2/table-claims/${ref.claim.key}.json`), previous);
    for (const row of Object.values(database.read('qa/competitions-v2/accounts.json') || {})) {
      assert.equal(row.controlOperations, undefined); assert.equal(row.tableClaims, undefined);
    }
    const recovered = await replacement.call(`/api/competitions/${scope.kind}/${scope.id}`, undefined, { guestToken: context.guestToken });
    assert.equal(recovered.id, scope.id);
  });

  test(`fresh app retires superseded ${type} cancellation while preserving another pending claim`, { timeout: 65000 }, async t => {
    let database, headPath, armed = false, held = false, entered, release;
    const started = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; }), workers = [];
    database = await startCompetitionRestFixture({ beforeConditionalPut: async ({ path }) => {
      if (armed && !held && path.includes('/competitions-v2/table-claims/')) { held = true; entered(); await gate; }
    } });
    t.after(async () => { release(); for (const worker of workers) await worker.kill(); await database.close(); });
    const first = await open(database.url); workers.push(first);
    const context = await prepare(first, type), scope = context.scope; headPath = `qa/competitions-v2/groups/${scope.id}/head.json`;
    const host = (await first.call('/api/connections', {})).connectionId;
    const room = await first.call('/api/rooms', { playerCount: 2, startingLife: 40 }, { connectionId: host });
    armed = true;
    const linking = first.call('/api/competitions/tables/bind', { kind: scope.kind, id: scope.id, code: room.snapshot.code,
      ...(context.assignmentId ? { assignmentId: context.assignmentId } : {}) }, { guestToken: context.guestToken, connectionId: host, timeoutMs: 60000 })
      .then(value => ({ value }), error => ({ error: error.name }));
    await started;
    const ref = database.read(headPath).pending.authorization, identities = fixtureIdentities(database);
    const competitor = await identities.identity('synthetic-competitor', 'Synthetic competitor');
    const binding = { kind: 'pod', id: 'pod_competitor', roomCode: room.snapshot.code };
    const other = await identities.beginTableClaim(competitor, ref.claim.key, binding);
    await identities.tableClaims.reserve(ref.claim.key, binding, other);
    const claimPath = `qa/competitions-v2/table-claims/${ref.claim.key}.json`, previous = database.read(claimPath);
    await first.kill(); assert.ok((await linking).error);
    const replacement = await open(database.url); workers.push(replacement);
    const deadline = ref.abortAfter + 8000;
    while ((database.read(headPath).pending || database.read(headPath).settling) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(database.read(headPath).pending, undefined); assert.equal(database.read(headPath).settling, undefined);
    release(); await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(database.read(claimPath), previous);
    const receipt = database.read(`qa/competitions-v2/groups/${scope.id}/operations/${ref.operationId}.json`);
    assert.equal(receipt.outcome, 'cancelled'); assert.equal(receipt.claimOutcome.type, 'superseded');
    assert.ok(receipt.claimOutcome.generation >= 1);
    assert.equal(Object.keys(database.read(`qa/competitions-v2/groups/${scope.id}/rows/tables.json`) || {}).length, 0);
    if (type === 'account') assert.equal(database.read(`qa/competitions-v2/accounts/${ref.accountKey}.json`).tableClaims, undefined);
    const recovered = await replacement.call(`/api/competitions/${scope.kind}/${scope.id}`, undefined, { guestToken: context.guestToken });
    assert.equal(recovered.id, scope.id);
  });
}
