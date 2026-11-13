// Local storage-drain baseline. No remote target, OAuth, live accounts or SSE claim.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { startCompetitionRestFixture } from './competition-rest-fixture.mjs';
import { FirebasePlaytestLedger } from '../server/src/playtest-ledger.js';
import { RoomService } from '../server/src/app.js';

const args = Object.fromEntries(process.argv.slice(2).map(value => {
  const match = /^--(commands|players|tables|delay-ms)=(\d+)$/.exec(value);
  if (!match) throw new Error('Use only --commands, --players, --tables and --delay-ms; no remote target is supported.');
  return [match[1], Number(match[2])];
}));
const commands = args.commands ?? 200, players = args.players ?? 4, delayMs = args['delay-ms'] ?? 5;
const tables = args.tables ?? 1;
assert.ok(commands >= 10 && commands <= 5000 && players >= 2 && players <= 8 && delayMs <= 100
  && tables >= 1 && tables <= 250 && tables <= commands);
const database = await startCompetitionRestFixture({ delayMs });
let puts = 0, bytes = 0, writeErrors = 0;
const ledger = new FirebasePlaytestLedger({ databaseUrl: database.url, clientEmail: 'fixture@example.invalid', privateKey: 'unused-local-fixture-key',
  fetchImpl: async (url, options = {}) => {
    if (options.method === 'PUT' || options.method === 'PATCH') { puts++; bytes += Buffer.byteLength(options.body || '', 'utf8'); }
    return fetch(url, options);
  }, logger: { error() { writeErrors++; } } });
ledger.accessToken = async () => 'local-fixture-only';
try {
  const service = new RoomService({ ledger }), rooms = [];
  for (let table = 0; table < tables; table++) {
    const host = service.createConnection().connectionId;
    const created = service.createRoom(host, { playerCount: players, startingLife: 40, name: 'Synthetic host' });
    const code = created.snapshot.code;
    for (let seatId = 1; seatId < players; seatId++) {
      service.claimSeat(code, service.createConnection().connectionId, { seatId, name: `Synthetic ${seatId}` });
    }
    service.startGame(code, host, { baseVersion: service.room(code).version });
    rooms.push({ code, host, beforeSequence: service.room(code).ledgerSequence, commands: 0 });
  }
  await ledger.flush();
  const beforePuts = puts, beforeBytes = bytes;
  const start = performance.now();
  for (let index = 0; index < commands; index++) {
    const table = rooms[index % tables];
    service.adjustOwnSeat(table.code, table.host, { counter: 'life', delta: table.commands++ % 2 ? 1 : -1, operationId: `capacity_probe_${index}` });
  }
  const appliedMs = performance.now() - start;
  await ledger.flush(); const drainedMs = performance.now() - start;
  assert.equal(writeErrors, 0, 'Every queued write, including checkpoints, must finish without logged failures.');
  for (const table of rooms) {
    const room = service.room(table.code), saved = await ledger.readRecovery(table.code);
    assert.ok(saved?.room, 'The writer must persist a recovery record for every Table.');
    assert.equal(saved.room.version, room.version);
    assert.equal(saved.room.seats[0].counters.life, table.commands % 2 ? 39 : 40);
    const events = database.read(`playtests/${room.gameId}/events.json`);
    assert.ok(events && typeof events === 'object', 'The writer must persist diagnostic events.');
    assert.equal(Object.values(events).filter(row => row?.sequence > table.beforeSequence).length, table.commands);
  }
  const report = { sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()),
    syntheticCommands: commands, tables, players, fixtureDelayMs: delayMs, writeErrors,
    appliedMs: Number(appliedMs.toFixed(2)), drainedMs: Number(drainedMs.toFixed(2)), writes: puts - beforePuts, bytes: bytes - beforeBytes,
    effectiveStorageCommandsPerSecond: Number((commands * 1000 / drainedMs).toFixed(2)), finalLife: service.room(rooms[0].code).seats[0].counters.life,
    verified: ['every diagnostic event persisted', 'latest recovery version and life match authoritative state'],
    limits: 'Local RoomService and real diagnostics/recovery REST writes. No SSE clients, hosted Firebase or application-capacity claim. Measures writer drain.' };
  await mkdir(new URL('../.local/evidence/', import.meta.url), { recursive: true });
  await writeFile(new URL('../.local/evidence/counter-storage-probe.json', import.meta.url), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await database.close(); }
