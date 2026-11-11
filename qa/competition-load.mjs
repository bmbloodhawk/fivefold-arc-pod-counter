// Local-only synthetic load. This program cannot target staging or production.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { startCompetitionRestFixture } from './competition-rest-fixture.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(value => {
  const match = /^--(players|networks|delay-ms|adjustments|rounds|streams-per-network|streams-global|busy-retries)=(\d+)$/.exec(value);
  if (!match) throw new Error('Unknown argument. No remote target is supported.');
  return [match[1], Number(match[2])];
}));
const players = args.players ?? 32, networks = args.networks ?? 1, delayMs = args['delay-ms'] ?? 5;
const adjustments = args.adjustments ?? 16, rounds = args.rounds ?? 1;
const maxStreamsPerIp = args['streams-per-network'] ?? 32, maxStreamsGlobal = args['streams-global'] ?? 64;
const busyRetries = args['busy-retries'] ?? 4;
assert.ok(busyRetries >= 0 && busyRetries <= 4);
assert.ok(players >= 8 && players <= 128 && players % 4 === 0);
assert.ok(networks >= 1 && networks <= 4 && Math.ceil(players / networks) <= maxStreamsPerIp, 'Use enough synthetic networks for the configured per-network limit.');
assert.ok(maxStreamsPerIp >= 1 && maxStreamsPerIp <= 1024 && maxStreamsGlobal >= maxStreamsPerIp && maxStreamsGlobal <= 1024);
assert.ok(delayMs >= 0 && delayMs <= 100 && adjustments >= 2 && adjustments <= 100 && rounds >= 1 && rounds <= 3);
const root = fileURLToPath(new URL('../', import.meta.url)), began = performance.now();
const db = await startCompetitionRestFixture({ delayMs });
const child = spawn(process.execPath, [fileURLToPath(new URL('./competition-local-server.mjs', import.meta.url))], {
  cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, COMPETITION_QA_PORT: '0', COMPETITION_QA_DATABASE_URL: db.url,
    MAX_LIVE_STREAMS_PER_IP:String(maxStreamsPerIp), MAX_LIVE_STREAMS_GLOBAL:String(maxStreamsGlobal) },
});
let serverErrors = ''; child.stderr.on('data', chunk => { serverErrors += chunk; });
const streams = [], metrics = new Map(), operations = new Map(), failures = [], expectedRejections = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
let origin;
try {
  origin = await new Promise((resolve, reject) => {
    let output = ''; const timer = setTimeout(() => reject(new Error('Owned QA server startup timed out.')), 15000);
    child.stdout.on('data', chunk => { output += chunk; const match = /COMPETITION_QA_READY (http:\/\/127\.0\.0\.1:\d+)/.exec(output); if (match) { clearTimeout(timer); resolve(match[1]); } });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error('Owned QA server exited: ' + code)); });
  });
  assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  async function call(path, { body, token = 'qa-organizer', connection, label = 'setup', expected = 200, retryBusy = false } = {}) {
    const operationStart = performance.now();
    for (let attempt = 0; ; attempt++) {
      const start = performance.now();
      const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(30000),
        headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(connection ? { 'x-connection-id': connection } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const data = await response.json();
      const sample = { ms: performance.now() - start, status: response.status };
      if (!metrics.has(label)) metrics.set(label, []); metrics.get(label).push(sample);
      if (retryBusy && response.status === 503 && data.error?.code === 'HISTORY_BUSY' && attempt < busyRetries) { await pause(30 * (attempt + 1)); continue; }
      if (response.status !== expected) { failures.push({ label, status: response.status, code: data.error?.code }); throw new Error(`${label}: expected ${expected}, got ${response.status}: ${JSON.stringify(data).slice(0,200)}`); }
      if (!operations.has(label)) operations.set(label, []);
      operations.get(label).push(performance.now() - operationStart);
      return data;
    }
  }
  async function pool(items, width, work) {
    let next = 0; const results = [];
    await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => { while (next < items.length) { const index = next++; results[index] = await work(items[index], index); } }));
    return results;
  }
  async function stream(code, entrant) {
    const controller = new AbortController();
    const response = await fetch(`${origin}/api/rooms/${code}/events?connectionId=${encodeURIComponent(entrant.connection)}`, {
      signal: controller.signal, headers: { 'x-forwarded-for': entrant.network, accept: 'text/event-stream' },
    });
    if (response.status !== 200) {
      const error = await response.json();
      failures.push({ label: 'sse_connect', status: response.status, code: error.error?.code, message: error.error?.message, connectedStreams: streams.length });
      throw new Error(`Synthetic SSE rejected after ${streams.length} streams: ${response.status} ${JSON.stringify(error)}`);
    }
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let latest = null, chunks = '', closed = false; const waiters = [];
    const pump = (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read(); if (done) break;
          chunks += decoder.decode(value, { stream: true }).replaceAll('\r\n', '\n');
          let boundary;
          while ((boundary = chunks.indexOf('\n\n')) >= 0) {
            const block = chunks.slice(0, boundary); chunks = chunks.slice(boundary + 2);
            if (!block.startsWith('event: snapshot\n')) continue;
            latest = JSON.parse(block.split('\n').find(line => line.startsWith('data:')).slice(5).trim());
            for (const waiter of [...waiters]) if (latest.version >= waiter.version) { clearTimeout(waiter.timer); waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(latest); }
          }
        }
      } catch (error) { if (!closed) failures.push({ label: 'sse', message: error.message }); }
    })();
    const handle = { entrant, code, get latest() { return latest; },
      async at(version) { if (latest?.version >= version) return latest; return new Promise((resolve, reject) => { const waiter = { version, resolve, timer: setTimeout(() => reject(new Error('SSE convergence exceeded 5s.')), 5000) }; waiters.push(waiter); }); },
      async close() { closed = true; controller.abort(); try { await reader.cancel(); } catch {} await pump; for (const waiter of waiters) clearTimeout(waiter.timer); },
    };
    streams.push(handle); await handle.at(1); return handle;
  }
  const event = await call('/api/competitions/tournaments', { body: { name: 'LOCAL synthetic load', displayName: 'Synthetic organizer', rounds, preferredSize: 4 }, expected: 201 });
  const invite = await call(`/api/competitions/tournament/${event.id}/invites`, { body: {} });
  const entrants = await pool(Array.from({ length: players }, (_, index) => index), 4, async index => {
    const token = `qa-load-${String(index).padStart(3,'0')}`;
    const joined = await call('/api/competitions/join', { token, body: { token: invite.token, displayName: `Synthetic player ${index + 1}` }, retryBusy: true });
    return { id: joined.me, token, name: `Synthetic player ${index + 1}`, network: `198.51.100.${Math.floor(index / Math.ceil(players / networks)) + 1}` };
  });
  console.log(JSON.stringify({ phase: 'registered', players, networks, elapsedSeconds: Math.round((performance.now() - began) / 1000) }));
  let limitProbe;
  for (let roundIndex = 0; roundIndex < rounds; roundIndex++) {
    let state = await call(`/api/competitions/tournament/${event.id}/rounds/prepare`, { body: {} });
    state = await call(`/api/competitions/tournament/${event.id}/rounds/start`, { body: { roundId: state.rounds.at(-1).id, baseVersion: state.version } });
    const tables = await pool(state.rounds.at(-1).assignments, 4, async assignment => {
      const roster = assignment.participantIds.map(id => entrants.find(row => row.id === id)).map(row => ({ ...row }));
      for (const entry of roster) entry.connection = (await call('/api/connections', { token: null, body: { supportedTableProtocols: [1,2] }, expected: 201 })).connectionId;
      const created = await call('/api/rooms', { token: null, connection: roster[0].connection, body: { playerCount: 4, startingLife: 40, name: roster[0].name }, expected: 201 });
      const code = created.snapshot.code; roster[0].reclaimToken = created.reclaimToken;
      await call('/api/competitions/tables/bind', { token: roster[0].token, connection: roster[0].connection,
        body: { kind: 'tournament', id: event.id, assignmentId: assignment.id, code }, retryBusy: true });
      for (let seat = 1; seat < 4; seat++) {
        const claimed = await call(`/api/rooms/${code}/claim`, { token: roster[seat].token, connection: roster[seat].connection, body: { seatId: seat, name: roster[seat].name }, retryBusy: true });
        roster[seat].reclaimToken = claimed.reclaimToken;
      }
      const snapshot = (await call(`/api/rooms/${code}`)).snapshot;
      await call(`/api/rooms/${code}/start-game`, { token: null, connection: roster[0].connection, body: { baseVersion: snapshot.version }, retryBusy: true });
      const live = await Promise.all(roster.map(entry => stream(code, entry)));
      return { code, roster, live, assignment };
    });
    console.log(JSON.stringify({ phase: 'playing', round: roundIndex + 1, tables: tables.length, streams: players }));
    if (!limitProbe && players / networks === maxStreamsPerIp) {
      const sample = tables[0]; const entry = sample.roster[0];
      const response = await fetch(`${origin}/api/rooms/${sample.code}/events?connectionId=${encodeURIComponent(entry.connection)}`, { headers: { 'x-forwarded-for': entry.network } });
      const data = await response.json(); assert.equal(response.status,429); assert.equal(data.error.code,'SSE_LIMIT');
      limitProbe = { streamsPerNetwork: maxStreamsPerIp, additionalStreamStatus: response.status, code: data.error.code }; expectedRejections.push(limitProbe);
    }
    async function adjust(table, phase, count, burst = 0) {
      await Promise.all(table.roster.map(async (entry, seat) => {
        for (let tap = 0; tap < count; tap++) await call(`/api/rooms/${table.code}/adjust`, { token: null, connection: entry.connection, label: phase,
          body: { counter: 'life', delta: tap % 2 ? 1 : -1, operationId: `${phase}_${roundIndex}_${seat}_${burst}_${tap}_${table.code}` } });
      }));
    }
    const before = digest(db.read('qa/competitions.json'));
    await Promise.all(tables.map(table => adjust(table, 'life_only', adjustments)));
    assert.equal(digest(db.read('qa/competitions.json')), before, 'Life-only activity must not change competition records.');
    for (const table of tables) {
      const snapshot = (await call(`/api/rooms/${table.code}`)).snapshot;
      const received = await Promise.all(table.live.map(handle => handle.at(snapshot.version)));
      assert.ok(received.every(row => digest(row) === digest(snapshot))); assert.ok(snapshot.seats.every(row => row.counters.life === 40));
    }
    // Reclaim one active seat and verify the old phone loses mutation authority.
    const reclaim = tables[0], old = reclaim.roster[1]; await reclaim.live[1].close();
    const replacement = (await call('/api/connections', { token: null, body: { supportedTableProtocols: [1,2] }, expected: 201 })).connectionId;
    await call(`/api/rooms/${reclaim.code}/claim`, { token: old.token, connection: replacement, body: { seatId: 1, reclaimToken: old.reclaimToken }, retryBusy: true });
    await call(`/api/rooms/${reclaim.code}/adjust`, { token: null, connection: old.connection, label: 'stale_authority', expected: 403, body: { counter: 'life', delta: -1 } });
    old.connection = replacement; reclaim.live[1] = await stream(reclaim.code, old);
    const control = tables[0], controlVersion = (await call(`/api/rooms/${control.code}`)).snapshot.version;
    const controlPlay = (async () => { for (let burst = 0; burst < 8; burst++) { await adjust(control, 'life_during_results', 2, burst); await pause(25); } })();
    async function finish(table) {
      const snapshot = (await call(`/api/rooms/${table.code}`)).snapshot;
      const result = await call(`/api/rooms/${table.code}/declare-winner`, { token: null, connection: table.roster[0].connection, label: 'completion',
        body: { winnerSeatId: 0, baseVersion: snapshot.version } });
      table.gameId = result.snapshot.completedGameId;
    }
    await Promise.all(tables.slice(1).map(finish));
    await call(`/api/competitions/tournament/${event.id}/reconcile`, { body: {}, label: 'capture', retryBusy: true });
    async function confirm(table) {
      const body = { order: table.assignment.participantIds.map(id => [id]), baseRevision: 0, requestId: `load_confirm_${roundIndex}_${table.code}` };
      const result = await call(`/api/competitions/tournament/${event.id}/games/${table.gameId}/confirm`, { body, label: 'confirmation', retryBusy: true });
      assert.equal(result.revisions.length, 1);
      const duplicate = await call(`/api/competitions/tournament/${event.id}/games/${table.gameId}/confirm`, { body, label: 'confirmation_retry', retryBusy: true });
      assert.equal(duplicate.revisions.length, 1);
    }
    await Promise.all(tables.slice(1).map(confirm)); await controlPlay;
    const stillPlaying = (await call(`/api/rooms/${control.code}`)).snapshot;
    assert.equal(stillPlaying.version, controlVersion + 64, 'Every control-phone life mutation applied exactly once during result traffic.');
    assert.ok((await Promise.all(control.live.map(handle => handle.at(stillPlaying.version)))).every(row => digest(row) === digest(stillPlaying)));
    await finish(control);
    await call(`/api/competitions/tournament/${event.id}/reconcile`, { body: {}, label: 'capture', retryBusy: true }); await confirm(control);
    state = await call(`/api/competitions/tournament/${event.id}`, { label: 'standings' });
    assert.equal(state.standings.length, players); assert.ok(state.standings.every(row => row.gamesPlayed === roundIndex + 1));
    assert.equal(state.standings.reduce((sum,row)=>sum+row.points,0), players * 1.5 * (roundIndex + 1));
    assert.equal(state.rounds.at(-1).status, 'complete');
    await Promise.all(tables.flatMap(table => table.live.map(handle => handle.close())));
    console.log(JSON.stringify({ phase: 'round_confirmed', round: roundIndex + 1, games: tables.length, duplicatesAdded: 0 }));
  }
  const stats = Object.fromEntries([...metrics].map(([label,samples]) => {
    const sorted = samples.map(row=>row.ms).sort((a,b)=>a-b), p=q=>Number(sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*q)-1)].toFixed(2));
    const logical = (operations.get(label) || []).sort((a,b)=>a-b);
    return [label,{ requests:samples.length,operations:logical.length,p50Ms:p(.5),p95Ms:p(.95),p99Ms:p(.99),
      operationP95Ms:Number(logical[Math.min(logical.length-1,Math.ceil(logical.length*.95)-1)]?.toFixed(2)),
      statuses:samples.reduce((out,row)=>(out[row.status]=(out[row.status]||0)+1,out),{}) }];
  }));
  const report = { passed:failures.length===0, sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    sourceDirty:Boolean(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim()),
    players,tablesPerRound:players/4,rounds,networks,delayMs,maxStreamsPerIp,maxStreamsGlobal,busyRetries,elapsedSeconds:Number(((performance.now()-began)/1000).toFixed(1)),
    stats,expectedRejections,conditionalConflicts:db.conflicts,failures,serverReportedErrors:serverErrors.split('\n').filter(Boolean).length,
    verified:['real HTTP + SSE across every simulated phone','life-only competition records unchanged','same authoritative snapshots','seat reclaim invalidates old phone','concurrent results and duplicate idempotency','complete event points and game counts'],
    limits:'Local computer + child application + synthetic auth + delayed REST/ETag fixture. No live Firebase, Render capacity, real phone rendering, venue Wi-Fi or long-duration reliability claim.' };
  await mkdir(new URL('../.local/evidence/',import.meta.url),{recursive:true});
  await writeFile(new URL(`../.local/evidence/competition-load-${players}-${networks}.json`,import.meta.url),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2)); assert.equal(report.passed,true);
} catch (error) {
  const report = { passed:false,players,networks,delayMs,rounds,maxStreamsPerIp,maxStreamsGlobal,busyRetries,connectedStreams:streams.length,
    elapsedSeconds:Number(((performance.now()-began)/1000).toFixed(1)),failures,message:error.message,
    limits:'Failure observed only in the isolated local HTTP/SSE simulation; not a staging or production outage.' };
  await mkdir(new URL('../.local/evidence/',import.meta.url),{recursive:true});
  await writeFile(new URL(`../.local/evidence/competition-load-${players}-${networks}.json`,import.meta.url),JSON.stringify(report,null,2));
  console.error(JSON.stringify(report,null,2)); throw error;
} finally {
  await Promise.allSettled(streams.map(handle=>handle.close()));
  if(child.exitCode==null&&child.signalCode==null) { child.kill('SIGKILL'); await once(child,'exit'); }
  await db.close();
}
