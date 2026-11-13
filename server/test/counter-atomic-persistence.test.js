import assert from 'node:assert/strict';
import test from 'node:test';
import { createRealtimeServer } from '../src/app.js';
import { FirebasePlaytestLedger } from '../src/playtest-ledger.js';
import { startCompetitionRestFixture } from '../../qa/competition-rest-fixture.mjs';

const gate = () => { let release; return { promise: new Promise(resolve => { release = resolve; }), release }; };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const event = (sequence = 1) => ({ gameId: 'game_atomic', roomCode: 'FIX123', sequence, type: 'counter_adjusted', counter: 'life', delta: 1 });
const recovery = (version = 2, life = 41) => ({ schemaVersion: 1, roomCode: 'FIX123', room: { code: 'FIX123', gameId: 'game_atomic', version, seats: [{ counters: { life } }] } });
const recoveryKey = code => `recovery/${code}`;
const eventKey = sequence => `playtests/game_atomic/events/${sequence}`;

async function fixture(t, intercept = async () => null) {
  const database = await startCompetitionRestFixture(), releases = [], attempts = [];
  const ledger = new FirebasePlaytestLedger({ databaseUrl: database.url, clientEmail: 'fixture', privateKey: 'fixture', logger: { error() {} },
    fetchImpl: async (url, options = {}) => {
      assert.equal(new URL(url).origin, database.url, 'No external storage access.');
      if (options.method === 'PATCH') attempts.push({ body: options.body, updates: JSON.parse(options.body) });
      const response = await intercept(url, options); return response || fetch(url, options);
    } });
  ledger.accessToken = async () => 'local-fixture-only';
  const app = createRealtimeServer({ appEnv: 'test', ledger, autoRecoverRooms: true });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    for (const release of releases) release();
    await ledger.flush(); app.server.closeAllConnections();
    await new Promise(resolve => app.server.close(resolve)); await database.close();
  });
  const origin = 'http://127.0.0.1:' + app.server.address().port;
  const call = async (code, connectionId, body) => {
    const response = await fetch(`${origin}/api/rooms/${code}/adjust`, { method: 'POST', signal: AbortSignal.timeout(10000),
      headers: { 'content-type': 'application/json', 'x-connection-id': connectionId }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  async function room() {
    const host = app.service.createConnection().connectionId, guest = app.service.createConnection().connectionId;
    const code = app.service.createRoom(host, { playerCount: 2, startingLife: 40 }).snapshot.code;
    app.service.claimSeat(code, guest, { seatId: 1 });
    app.service.startGame(code, host, { baseVersion: app.service.room(code).version });
    await ledger.flush(); return { code, host, guest };
  }
  return { ...app, ledger, database, attempts, releases, call, room };
}

test('REST fixture applies multipath updates atomically and rejects a whole overlapping or invalid patch', async t => {
  const db = await startCompetitionRestFixture(); t.after(() => db.close());
  const send = updates => fetch(db.url + '/.json', { method: 'PATCH', headers: { authorization: 'Bearer local-fixture-only', 'content-type': 'application/json' }, body: JSON.stringify(updates) });
  assert.equal((await send({ 'unrelated/keep': 7, [eventKey(1)]: event(), [recoveryKey('FIX123')]: recovery() })).status, 200);
  assert.equal(db.read('unrelated/keep.json'), 7); assert.equal(db.read('recovery/FIX123.json').room.version, 2);
  for (const invalid of [{ 'unrelated/keep': 99, a: 1, 'a/child': 2 },
    { 'unrelated/keep': 99, a: 1, 'a-': 9, 'a/child': 2 }, { 'unrelated/keep': 99, 'bad.#key': 1 }]) {
    assert.equal((await send(invalid)).status, 400);
    assert.equal(db.read('unrelated/keep.json'), 7, 'A rejected patch must not partially change another location.');
    assert.equal(db.read('a.json'), null);
  }
  assert.equal((await fetch(db.url + '/.json', { method: 'PATCH', headers: { authorization: 'wrong' }, body: '{}' })).status, 401);
  await send({ 'nested/rows': [{ life: 40, untouched: 'first' }, { life: 40, untouched: 'second' }], 'nested/keep': true });
  const scoped = await fetch(db.url + '/nested.json', { method: 'PATCH', headers: { authorization: 'Bearer local-fixture-only', 'content-type': 'application/json' },
    body: JSON.stringify({ 'rows/0/life': 39, 'rows/1/life': 38 }) });
  assert.equal(scoped.status, 200);
  assert.deepEqual(db.read('nested.json'), { rows: [{ life: 39, untouched: 'first' }, { life: 38, untouched: 'second' }], keep: true });
  assert.equal(db.read('unrelated/keep.json'), 7);
});

for (const checkpointDue of [false, true]) {
  test(`ordinary life HTTP atomically persists event and recovery${checkpointDue ? ' plus due checkpoint' : ''} in one write`, async t => {
    const f = await fixture(t), a = await f.room();
    const room = f.service.room(a.code), sequence = room.ledgerSequence + 1;
    if (checkpointDue) room.ledgerLastCheckpointAt = 0;
    const before = f.database.calls.length, attemptsBefore = f.attempts.length;
    const result = await f.call(a.code, a.host, { counter: 'life', delta: 1, operationId: `single_atomic_write_${checkpointDue}_001` });
    assert.equal(result.status, 200); await f.ledger.flush();
    const calls = f.database.calls.slice(before);
    assert.deepEqual(calls.map(call => call.method), ['PATCH'], 'One durable write, with no additional read or separate event/recovery PUT.');
    const updates = f.attempts.slice(attemptsBefore)[0].updates;
    assert.deepEqual(Object.keys(updates).sort(), [recoveryKey(a.code), `playtests/${room.gameId}/events/${sequence}`,
      ...(checkpointDue ? [`playtests/${room.gameId}/checkpoints/${sequence}`] : [])].sort());
    const saved = f.database.read(`recovery/${a.code}.json`);
    assert.equal(saved.room.version, result.data.snapshot.version); assert.equal(saved.room.seats[0].counters.life, 41);
    assert.ok(Number.isSafeInteger(saved.savedAt));
    assert.equal(f.database.read(`playtests/${room.gameId}/events/${sequence}.json`).type, 'counter_adjusted');
    if (checkpointDue) assert.equal(f.database.read(`playtests/${room.gameId}/checkpoints/${sequence}.json`).snapshot.seats[0].counters.life, 41);
  });
}

test('a held atomic write cannot confirm life early and does not block an independent Table', { timeout: 10000 }, async t => {
  const entered = gate(), blocked = gate(); let target;
  const f = await fixture(t, async (_url, options) => {
    if (options.method === 'PATCH' && Object.hasOwn(JSON.parse(options.body), recoveryKey(target))) { entered.release(); await blocked.promise; }
  });
  assert.equal(typeof f.ledger.recordWithRecovery, 'function'); f.releases.push(blocked.release);
  const a = await f.room(), b = await f.room(); target = a.code; let replied = false;
  const pending = f.call(a.code, a.host, { counter: 'life', delta: 1, operationId: 'held_atomic_change_001' }).then(value => { replied = true; return value; });
  await entered.promise; await pause(35);
  assert.equal(replied, false); assert.equal(f.database.read(`recovery/${a.code}.json`).room.seats[0].counters.life, 40);
  const other = await f.call(b.code, b.host, { counter: 'life', delta: 1, operationId: 'independent_atomic_001' });
  assert.equal(other.status, 200); assert.equal(f.database.read(`recovery/${b.code}.json`).room.seats[0].counters.life, 41);
  blocked.release(); assert.equal((await pending).status, 200);
  assert.equal(f.database.read(`recovery/${a.code}.json`).room.seats[0].counters.life, 41);
});

test('failed atomic save rejects acknowledgement and retry preserves event, checkpoint and frozen recovery bytes', async t => {
  let fail = true;
  const f = await fixture(t, async (_url, options) => options.method === 'PATCH' && fail ? Response.json({ error: 'fixture outage' }, { status: 503 }) : null);
  assert.equal(typeof f.ledger.recordWithRecovery, 'function');
  const originalEvent = event(), originalRecovery = recovery(), checkpoint = { gameId: 'game_atomic', roomCode: 'FIX123', sequence: 1, marker: 'original' };
  await assert.rejects(f.ledger.recordWithRecovery(originalEvent, originalRecovery, checkpoint), /503/);
  assert.equal(f.database.read('recovery/FIX123.json'), null); assert.equal(f.database.read('playtests/game_atomic/events/1.json'), null);
  originalEvent.delta = 999; originalRecovery.room.version = 999; originalRecovery.room.seats[0].counters.life = 999; checkpoint.marker = 'changed';
  fail = false; await f.ledger.waitForRecovery('FIX123');
  assert.equal(f.database.read('recovery/FIX123.json').room.version, 2);
  assert.equal(f.database.read('recovery/FIX123.json').room.seats[0].counters.life, 41);
  assert.equal(f.database.read('playtests/game_atomic/events/1.json').delta, 1);
  assert.equal(f.database.read('playtests/game_atomic/checkpoints/1.json').marker, 'original');
  const fullSaves = f.attempts.filter(attempt => Object.hasOwn(attempt.updates, recoveryKey('FIX123')));
  assert.ok(fullSaves.length >= 2); assert.ok(fullSaves.every(attempt => attempt.body === fullSaves[0].body), 'Recovery retries retain the exact original bytes.');
  for (const repair of f.attempts.filter(attempt => !Object.hasOwn(attempt.updates, recoveryKey('FIX123')))) {
    assert.deepEqual(Object.keys(repair.updates).sort(), [eventKey(1), 'playtests/game_atomic/checkpoints/1'].sort(), 'A diagnostic repair cannot carry an older recovery snapshot.');
    assert.equal(repair.updates[eventKey(1)].delta, 1); assert.equal(repair.updates['playtests/game_atomic/checkpoints/1'].marker, 'original');
  }
});

test('a failed older batch cannot lose its event or overwrite newer recovery after a later save succeeds', async t => {
  let fail = true;
  const f = await fixture(t, async (_url, options) => options.method === 'PATCH' && fail ? Response.json({ error: 'fixture outage' }, { status: 503 }) : null);
  assert.equal(typeof f.ledger.recordWithRecovery, 'function');
  await assert.rejects(f.ledger.recordWithRecovery(event(1), recovery(2, 41)), /503/);
  fail = false; await f.ledger.recordWithRecovery(event(2), recovery(3, 42)); await f.ledger.waitForRecovery('FIX123'); await f.ledger.flush();
  assert.equal(f.database.read('recovery/FIX123.json').room.version, 3);
  assert.equal(f.database.read('recovery/FIX123.json').room.seats[0].counters.life, 42);
  assert.equal(f.database.read('playtests/game_atomic/events/1.json')?.sequence, 1, 'Superseding recovery must not discard the earlier diagnostic event.');
  assert.equal(f.database.read('playtests/game_atomic/events/2.json')?.sequence, 2);
});

test('a later standalone recovery drains failed diagnostics before its snapshot is confirmed', async t => {
  let fail = true;
  const f = await fixture(t, async (_url, options) => options.method === 'PATCH' && fail
    ? Response.json({ error: 'fixture outage' }, { status: 503 }) : null);
  await assert.rejects(f.ledger.recordWithRecovery(event(1), recovery(2, 41)), /503/);
  fail = false;
  await f.ledger.recovery(recovery(3, 42));
  assert.equal(f.database.read('playtests/game_atomic/events/1.json')?.sequence, 1);
  assert.equal(f.database.read('recovery/FIX123.json').room.version, 3);
});

test('queued atomic saves retain admission-time values, every event and final FIFO recovery without touching unrelated data', async t => {
  const f = await fixture(t); assert.equal(typeof f.ledger.recordWithRecovery, 'function');
  await f.ledger.write('unrelated/keep.json', { value: 7 });
  const blocked = gate(), entered = gate(); f.releases.push(blocked.release);
  const first = f.ledger.writeQueue.enqueue('room:FIX123', async () => { entered.release(); await blocked.promise; }); await entered.promise;
  const events = Array.from({ length: 8 }, (_, index) => event(index + 1));
  const snapshots = events.map((_, index) => recovery(index + 2, 41 + index));
  const pending = events.map((item, index) => f.ledger.recordWithRecovery(item, snapshots[index]));
  for (const item of events) item.delta = 999;
  for (const item of snapshots) item.room.version = 999;
  blocked.release(); await first; await Promise.all(pending); await f.ledger.flush();
  assert.equal(f.database.read('recovery/FIX123.json').room.version, 9); assert.equal(f.database.read('recovery/FIX123.json').room.seats[0].counters.life, 48);
  const persisted = Object.values(f.database.read('playtests/game_atomic/events.json'));
  assert.deepEqual(persisted.map(item => item.sequence), [1, 2, 3, 4, 5, 6, 7, 8]); assert.ok(persisted.every(item => item.delta === 1));
  assert.deepEqual(f.database.read('unrelated/keep.json'), { value: 7 });
});

test('mismatched event/recovery Table or checkpoint identity is rejected before storage admission', async t => {
  const f = await fixture(t); assert.equal(typeof f.ledger.recordWithRecovery, 'function');
  const before = f.database.calls.length;
  for (const args of [[event(), { ...recovery(), roomCode: 'OTHER1' }],
    [event(), recovery(), { gameId: 'different', roomCode: 'FIX123', sequence: 1 }],
    [event(), recovery(), { gameId: 'game_atomic', roomCode: 'FIX123', sequence: 2 }]]) {
    await assert.rejects(Promise.resolve().then(() => f.ledger.recordWithRecovery(...args)), /match|same|invalid|Table|room|checkpoint/i);
  }
  assert.equal(f.database.calls.length, before);
});

test('flush begun before batch failure waits for the resulting diagnostic repair', { timeout: 10000 }, async t => {
  const batchEntered = gate(), batchRelease = gate(), repairEntered = gate(), repairRelease = gate();
  const f = await fixture(t, async (_url, options) => {
    if (options.method !== 'PATCH') return null;
    const updates = JSON.parse(options.body);
    if (Object.hasOwn(updates, recoveryKey('FIX123'))) {
      batchEntered.release(); await batchRelease.promise;
      return Response.json({ error: 'fixture batch outage' }, { status: 503 });
    }
    repairEntered.release(); await repairRelease.promise;
    return null;
  });
  assert.equal(typeof f.ledger.recordWithRecovery, 'function');
  f.releases.push(batchRelease.release, repairRelease.release);
  const rejected = f.ledger.recordWithRecovery(event(), recovery()).then(() => false, () => true);
  await batchEntered.promise;
  let drained = false;
  const drain = f.ledger.flush().then(() => { drained = true; });
  batchRelease.release(); await repairEntered.promise; await pause(25);
  assert.equal(drained, false, 'Shutdown must not report drained while an admitted save still has a pending diagnostic repair.');
  assert.equal(f.database.read('playtests/game_atomic/events/1.json'), null);
  repairRelease.release(); await drain;
  assert.equal(await rejected, true, 'Diagnostic success cannot turn failed recovery into a successful receipt.');
  assert.equal(f.database.read('playtests/game_atomic/events/1.json').sequence, 1);
  assert.equal(f.database.read('recovery/FIX123.json'), null);
});

test('an already queued newer batch repairs the failed older diagnostics before acknowledging its new snapshot', { timeout: 10000 }, async t => {
  const firstEntered = gate(), firstRelease = gate(), repairFailed = gate(), repairRelease = gate();
  let repairAttempts = 0;
  const f = await fixture(t, async (_url, options) => {
    if (options.method !== 'PATCH') return null;
    const updates = JSON.parse(options.body), snapshot = updates[recoveryKey('FIX123')];
    if (snapshot?.room.version === 2) {
      firstEntered.release(); await firstRelease.promise;
      return Response.json({ error: 'initial atomic write outage' }, { status: 503 });
    }
    if (!snapshot && Object.hasOwn(updates, eventKey(1)) && ++repairAttempts <= 3) {
      if (repairAttempts === 3) { repairFailed.release(); await repairRelease.promise; }
      return Response.json({ error: 'initial diagnostic repair outage' }, { status: 503 });
    }
    return null;
  });
  f.releases.push(firstRelease.release, repairRelease.release);
  const oldEvent = event(1), oldSnapshot = recovery(2, 41);
  const checkpoint = { gameId: 'game_atomic', roomCode: 'FIX123', sequence: 1, marker: 'original' };
  const oldRejected = f.ledger.recordWithRecovery(oldEvent, oldSnapshot, checkpoint).then(() => false, () => true);
  await firstEntered.promise;
  const newEvent = event(2), newSnapshot = recovery(3, 42); let acknowledged;
  const newer = f.ledger.recordWithRecovery(newEvent, newSnapshot).then(() => {
    acknowledged = { event: f.database.read('playtests/game_atomic/events/1.json'),
      checkpoint: f.database.read('playtests/game_atomic/checkpoints/1.json'), recovery: f.database.read('recovery/FIX123.json') };
  });
  oldEvent.delta = 999; oldSnapshot.room.version = 999; checkpoint.marker = 'changed';
  newEvent.delta = 888; newSnapshot.room.version = 888;
  firstRelease.release(); await repairFailed.promise;
  assert.equal(acknowledged, undefined, 'The newer save is already admitted but cannot bypass its Table FIFO.');
  assert.equal(f.database.read('playtests/game_atomic/events/1.json'), null);
  repairRelease.release(); assert.equal(await oldRejected, true);
  await newer;
  assert.equal(acknowledged.event?.sequence, 1, 'Older diagnostics must exist when the newer recovery acknowledgement resolves.');
  assert.equal(acknowledged.event.delta, 1); assert.equal(acknowledged.checkpoint.marker, 'original');
  assert.equal(acknowledged.recovery.room.version, 3); assert.equal(acknowledged.recovery.room.seats[0].counters.life, 42);
  await f.ledger.waitForRecovery('FIX123'); await f.ledger.flush();
  assert.equal(f.database.read('playtests/game_atomic/events/2.json').delta, 1);
  assert.equal(f.database.read('recovery/FIX123.json').room.version, 3, 'Old failed work cannot roll the recovery snapshot back.');
});
