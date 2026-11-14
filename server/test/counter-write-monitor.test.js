import assert from 'node:assert/strict';
import test from 'node:test';
import { monitorCounterWrites } from '../src/counter-write-monitor.js';
import { KeyedWriteQueue } from '../src/keyed-write-queue.js';
import { FirebasePlaytestLedger } from '../src/playtest-ledger.js';
import { createRealtimeServer } from '../src/app.js';
import { startCompetitionRestFixture } from '../../qa/competition-rest-fixture.mjs';

const gate = () => { let release; return { promise: new Promise(resolve => { release = resolve; }), release }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const simpleLedger = () => ({ writeQueue: new KeyedWriteQueue({ concurrency: 2 }), async writeWithRetry(_path, payload) { return payload; } });

test('counter timing stays disabled outside staging and for a ledger without a durable queue', () => {
  for (const appEnv of ['production', 'test', '', undefined]) {
    const ledger = simpleLedger(), enqueue = ledger.writeQueue.enqueue, write = ledger.writeWithRetry;
    const monitor = monitorCounterWrites(ledger, { appEnv });
    assert.equal(monitor.enabled, false); assert.equal(monitor.emit(), null);
    assert.equal(ledger.writeQueue.enqueue, enqueue); assert.equal(ledger.writeWithRetry, write); monitor.stop();
  }
  assert.equal(monitorCounterWrites({}, { appEnv: 'staging' }).enabled, false);
});

test('staging timing observes a held write and lets an independent Table finish unchanged', async t => {
  const ledger = simpleLedger(), hold = gate(), began = gate(), logs = [];
  t.after(hold.release);
  const monitor = monitorCounterWrites(ledger, { appEnv: 'staging', logger: { log: line => logs.push(line) } });
  t.after(() => monitor.stop());
  const secret = 'private-room-and-payload-must-never-appear';
  const first = ledger.writeQueue.enqueue(secret, async () => { began.release(); await hold.promise; return ledger.writeWithRetry('/private-path', secret); });
  await began.promise;
  const other = ledger.writeQueue.enqueue('other-room', () => ledger.writeWithRetry('/other-private-path', 'unchanged'));
  assert.equal(await other, 'unchanged');
  const during = monitor.emit();
  assert.equal(during.gauges.pending, 1); assert.equal(during.gauges.active, 1);
  assert.equal(during.timings.queueWait.count, 2); assert.equal(during.timings.storageWork.count, 1);
  hold.release(); assert.equal(await first, secret); await ledger.writeQueue.flush();
  const after = monitor.emit();
  assert.equal(after.gauges.pending, 0); assert.equal(after.gauges.active, 0);
  assert.equal(after.timings.storageWork.count, 1);
  assert.ok(logs.every(line => !line.includes(secret) && !line.includes('/private-path') && !line.includes('other-room')));
});

test('timing retains original errors, synchronous validation and successful queue receipts', async t => {
  const ledger = simpleLedger(), expected = new Error('private failure must not be logged');
  ledger.writeWithRetry = async () => { throw expected; };
  const monitor = monitorCounterWrites(ledger, { appEnv: 'staging', logger: { log() {} } }); t.after(() => monitor.stop());
  assert.throws(() => ledger.writeQueue.enqueue('', () => {}), /key/i);
  assert.throws(() => ledger.writeQueue.enqueue('valid', null), /function/i);
  await assert.rejects(ledger.writeQueue.enqueue('valid', () => ledger.writeWithRetry('/private', 'secret')), error => error === expected);
  const row = monitor.emit();
  assert.equal(row.failedJobs, 1); assert.equal(row.failedStorageOperations, 1);
  assert.equal(row.gauges.pending, 0); assert.equal(row.gauges.active, 0);
  assert.ok(!JSON.stringify(row).includes(expected.message));
  assert.equal(await ledger.writeQueue.enqueue('valid', () => 47), 47);
});

test('fixed timing histograms count every operation without retaining per-Table series', async t => {
  const ledger = simpleLedger(), logs = []; let now = 0;
  const monitor = monitorCounterWrites(ledger, { appEnv: 'staging', clock: () => now, logger: { log: line => logs.push(line) } }); t.after(() => monitor.stop());
  for (let index = 0; index < 600; index++) await ledger.writeQueue.enqueue('secret-room-' + index, () => { now += index % 2 ? 30 : 90; return ledger.writeWithRetry('/secret-path-' + index, 'private body'); });
  const row = monitor.emit();
  for (const histogram of [row.timings.queueWait, row.timings.jobWork, row.timings.storageWork]) {
    assert.equal(histogram.count, 600); assert.equal(histogram.counts.reduce((sum, value) => sum + value, 0), 600);
    assert.equal(histogram.counts.length, histogram.upperBoundsMs.length + 1);
    assert.ok(histogram.counts.length < 24);
  }
  assert.ok(JSON.stringify(row).length < 3000); assert.ok(!logs.join('').includes('secret-room'));
  assert.equal(row.timings.writeFetchHeaders.count, 0);
  const empty = monitor.emit(); assert.equal(empty.timings.jobWork.count, 0); assert.equal(empty.gauges.pending, 0);
});

test('staging timing distinguishes retried write failures without consuming responses or recording data', async t => {
  let calls = 0;
  const ledger = new FirebasePlaytestLedger({ databaseUrl: 'http://127.0.0.1:1', clientEmail: 'fixture', privateKey: 'fixture', logger: { error() {} },
    fetchImpl: async () => Response.json({ privateValue: 'do-not-log-this' }, { status: ++calls === 1 ? 503 : 200 }) });
  ledger.accessToken = async () => 'local-fixture-only';
  const monitor = monitorCounterWrites(ledger, { appEnv: 'staging', logger: { log() {} } }); t.after(() => monitor.stop());
  await ledger.recovery({ roomCode: 'PRIVATE', room: { version: 1 } });
  const row = monitor.emit();
  assert.equal(calls, 2); assert.equal(row.timings.writeFetchHeaders.count, 2); assert.equal(row.timings.storageWork.count, 1);
  assert.equal(row.writeStatuses.serverError, 1); assert.equal(row.writeStatuses.ok, 1);
  assert.equal(row.failedStorageOperations, 0); assert.ok(!JSON.stringify(row).includes('do-not-log-this'));
});

test('a failing telemetry sink cannot change a receipt; stopping restores only this monitor', async () => {
  const ledger = simpleLedger(), enqueue = ledger.writeQueue.enqueue, write = ledger.writeWithRetry;
  const monitor = monitorCounterWrites(ledger, { appEnv: 'staging', logger: { log() { throw new Error('sink unavailable'); } } });
  assert.equal(await ledger.writeQueue.enqueue('room', () => ledger.writeWithRetry('/path', 'saved')), 'saved');
  assert.doesNotThrow(() => monitor.emit()); assert.doesNotThrow(() => monitor.stop());
  assert.equal(ledger.writeQueue.enqueue, enqueue); assert.equal(ledger.writeWithRetry, write);
  const second = monitorCounterWrites(ledger, { appEnv: 'staging', logger: { log() {} } });
  const external = () => 'new owner'; ledger.writeWithRetry = external; second.stop();
  assert.equal(ledger.writeWithRetry, external);
});

test('instrumented Firebase life HTTP still waits for its one durable atomic write', { timeout: 10000 }, async t => {
  const database = await startCompetitionRestFixture(), hold = gate(), entered = gate(); let armed = false;
  const ledger = new FirebasePlaytestLedger({ databaseUrl: database.url, clientEmail: 'fixture', privateKey: 'fixture', logger: { error() {} }, fetchImpl: async (url, options) => {
    assert.equal(new URL(url).origin, database.url);
    if (armed && options.method === 'PATCH') { entered.release(); await hold.promise; }
    return fetch(url, options);
  } });
  ledger.accessToken = async () => 'local-fixture-only';
  const monitor = monitorCounterWrites(ledger, { appEnv: 'staging', logger: { log() {} } });
  const app = createRealtimeServer({ appEnv: 'test', ledger });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { hold.release(); await ledger.flush(); monitor.stop(); app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve)); await database.close(); });
  const host = app.service.createConnection().connectionId, peer = app.service.createConnection().connectionId;
  const code = app.service.createRoom(host, { playerCount: 2, startingLife: 40 }).snapshot.code;
  app.service.claimSeat(code, peer, { seatId: 1 }); app.service.startGame(code, host, { baseVersion: app.service.room(code).version });
  await ledger.flush(); monitor.emit(); const before = database.calls.length; armed = true; let replied = false;
  const pending = fetch('http://127.0.0.1:' + app.server.address().port + '/api/rooms/' + code + '/adjust', { method: 'POST', headers: { 'content-type': 'application/json', 'x-connection-id': host }, body: JSON.stringify({ counter: 'life', delta: -1, operationId: 'instrumented-durable-ack-0001' }) }).then(async response => { replied = true; return { status: response.status, body: await response.json() }; });
  await entered.promise; await tick();
  assert.equal(replied, false); assert.equal(app.service.room(code).seats[0].counters.life, 39);
  assert.equal(database.read('recovery/' + code + '.json').room.seats[0].counters.life, 40);
  assert.equal(monitor.emit().gauges.active, 1);
  hold.release(); const response = await pending;
  assert.equal(response.status, 200); assert.equal(response.body.snapshot.seats[0].counters.life, 39);
  assert.equal(database.read('recovery/' + code + '.json').room.seats[0].counters.life, 39);
  assert.deepEqual(database.calls.slice(before).map(row => row.method), ['PATCH']);
});
