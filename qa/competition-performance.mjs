// Local measurements, not a production capacity promise. Never reads credentials.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { RoomService } from '../server/src/app.js';
import { MemoryPlaytestLedger } from '../server/src/playtest-ledger.js';
import { replayPodGames, RATING_RULE_VERSION } from '../server/src/competition-scoring.js';
import { Competitions, scopePath } from '../server/src/competitions.js';
import { CompetitionTables } from '../server/src/competition-tables.js';
import { MemoryAccountHistoryStore } from '../server/src/account-history.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const baseline = 'b299d8a74ef7dcf14427cd8b138692aa8423fc69';
const sha = value => createHash('sha256').update(value).digest('hex');
const checks = [];
for (const [path, names] of [
  ['server/src/app.js', ['adjustOwnSeat', 'mutateOwnSeat', 'recordLedger', 'snapshot', 'recoveryRecord', 'broadcast', 'attachStream']],
  ['client/realtime.js', ['adjust', 'mutate', '#subscribe', '#acceptSnapshot', '#recoverSse']],
]) {
  const original = execFileSync('git', ['show', `${baseline}:${path}`], { cwd: root, encoding: 'utf8' }).replaceAll('\r\n', '\n');
  const current = (await readFile(new URL('../' + path, import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
  for (const name of names) {
    const pattern = new RegExp('^  (?:async )?' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\([^]*?^  \\}', 'm');
    const before = original.match(pattern)?.[0], after = current.match(pattern)?.[0];
    assert.ok(before && after, `Method found: ${name}`); assert.equal(after, before, `Unchanged live method: ${name}`);
    checks.push({ path, method: name, sha256: sha(after) });
  }
}
const batcher = 'client/life-adjustment-batcher.js';
assert.equal((await readFile(new URL('../' + batcher, import.meta.url), 'utf8')).replaceAll('\r\n', '\n'), execFileSync('git', ['show', `${baseline}:${batcher}`], { cwd: root, encoding: 'utf8' }).replaceAll('\r\n', '\n'));
const appPath = 'client/app.js';
const appBefore = execFileSync('git', ['show', `${baseline}:${appPath}`], { cwd: root, encoding: 'utf8' }).replaceAll('\r\n', '\n');
const appAfter = (await readFile(new URL('../' + appPath, import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
const adjustment = /^async function adjust\([^]*?^\}/m;
assert.ok(appBefore.match(adjustment)); assert.equal(appAfter.match(adjustment)?.[0], appBefore.match(adjustment)[0]);
checks.push({ path: appPath, method: 'adjust', sha256: sha(appAfter.match(adjustment)[0]) });

async function recoverySize(enabled) {
  let time = 1_000;
  const service = new RoomService({ ledger: new MemoryPlaytestLedger(), completionEvidenceEnabled: enabled, now: () => time++ });
  const connections = Array.from({ length: 8 }, () => service.createConnection().connectionId);
  const code = service.createRoom(connections[0], { playerCount: 8, startingLife: 40, name: 'Player 1' }).snapshot.code;
  for (let i = 1; i < 8; i++) service.claimSeat(code, connections[i], { seatId: i, name: `Player ${i + 1}` });
  for (let i = 0; i < 4; i++) {
    service.startGame(code, connections[0], { baseVersion: service.room(code).version });
    service.declareWinner(code, connections[0], { winnerSeatId: 0, baseVersion: service.room(code).version });
    await Promise.resolve();
    service.resetRoom(code, connections[0], { baseVersion: service.room(code).version });
  }
  const room = service.room(code);
  const timings = [];
  for (let run = 0; run < 5; run++) {
    const start = performance.now();
    for (let i = 0; i < 1000; i++) JSON.stringify(service.recoveryRecord(room));
    timings.push((performance.now() - start) / 1000);
  }
  return { bytes: Buffer.byteLength(JSON.stringify(service.recoveryRecord(room))), cachedGames: room.completedGames.length,
    stringifyMedianMs: timings.sort((a, b) => a - b)[2], repairRecaps: room.completedGames.filter(row => row.archiveRecap).length };
}
const recovery = { disabled: await recoverySize(false), enabled: await recoverySize(true) };
const replay = [];
for (const count of [1_000, 10_000]) {
  const games = Array.from({ length: count }, (_, i) => {
    const starterIds = Array.from({ length: 4 }, (_, seat) => `member_${(i * 3 + seat) % 40}`);
    return { gameId: `game_${String(i).padStart(8, '0')}`, completedAt: i + 1000, status: 'confirmed', ratingVersion: RATING_RULE_VERSION,
      starterIds, eligibleIds: starterIds, order: starterIds.map(id => [id]) };
  });
  const timings = []; let result;
  for (let run = 0; run < 5; run++) { const start = performance.now(); result = replayPodGames(games); timings.push(performance.now() - start); }
  assert.equal(result.games.length, count);
  replay.push({ games: count, members: Object.keys(result.members).length, medianMs: timings.sort((a, b) => a - b)[2] });
}
// Seed actual record shapes into disposable memory, then measure a real final CAS
// confirmation. The duplicated historical fixtures are synthetic, never real games.
async function confirmationScale(count) {
  const store = new MemoryAccountHistoryStore(), ledger = new MemoryPlaytestLedger();
  const domain = new Competitions({ store }); const service = new RoomService({ ledger });
  const tables = new CompetitionTables({ domain, service, ledger });
  const pod = await domain.createPod('qa_a', { name: 'Scale fixture', displayName: 'Player A' });
  const invite = await domain.invite('qa_a', 'pod', pod.id);
  await domain.joinPod('qa_b', invite.token, { displayName: 'Player B' });
  const host = service.createConnection().connectionId, other = service.createConnection().connectionId;
  const code = service.createRoom(host, { playerCount: 2, startingLife: 40 }).snapshot.code;
  service.claimSeat(code, other, { seatId: 1 }); await tables.bind('qa_a', { kind: 'pod', id: pod.id, code, connectionId: host });
  await tables.claim('qa_b', { code, connectionId: other }); await tables.start(code, host, { baseVersion: service.room(code).version });
  service.declareWinner(code, host, { winnerSeatId: 0, baseVersion: service.room(code).version }); await tables.reconcile('pod', pod.id);
  const scope = await domain.readScope('pod', pod.id); const source = scope.games[service.room(code).gameId];
  const order = source.starterIds.map(id => [id]);
  for (let i = 0; i < count - 1; i++) {
    const gameId = `scale_${String(i).padStart(8, '0')}`;
    scope.games[gameId] = { ...structuredClone(source), gameId, completedAt: source.completedAt - count + i,
      revisions: [{ revision: 1, order, reasonCode: 'host_confirmation', by: source.hostId, at: source.completedAt, requestId: gameId }] };
  }
  await store.write(scopePath('pod', pod.id), scope);
  const start = performance.now();
  await tables.confirm('qa_a', 'pod', pod.id, source.gameId, { order, baseRevision: 0, requestId: 'scale_confirmation' });
  const elapsedMs = performance.now() - start;
  return { syntheticGames: count, confirmationMs: elapsedMs, scopeBytes: Buffer.byteLength(JSON.stringify(await domain.readScope('pod', pod.id))),
    includes: 'In-memory CAS cloning, complete replay and projection; excludes REST latency, retries and richer/more-player records.' };
}
const confirmation = [await confirmationScale(1000), await confirmationScale(10000)];
const report = { baseline, node: process.version, at: new Date().toISOString(), unchangedMethods: checks, lifeBatcherUnchanged: true,
  recovery, replay, confirmation, limits: 'In-process local CPU/JSON only. Whole-scope CAS cost and database/network latency are additional; no live Firebase or phone capacity claim.' };
await mkdir(new URL('../.local/evidence/', import.meta.url), { recursive: true });
await writeFile(new URL('../.local/evidence/competition-performance.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
