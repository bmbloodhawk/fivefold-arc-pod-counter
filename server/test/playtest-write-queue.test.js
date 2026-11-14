import assert from 'node:assert/strict';
import test from 'node:test';
import { FirebasePlaytestLedger } from '../src/playtest-ledger.js';
import { sourceArchive } from '../src/competition-source.js';
import { startCompetitionRestFixture } from '../../qa/competition-rest-fixture.mjs';

const gate = () => { let release; return { promise: new Promise(resolve => { release = resolve; }), release: () => release() }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function recap(gameId, roomCode) {
  return { ...sourceArchive({ schemaVersion: 1, gameId, completedAt: 100, starters: [], inferredOrder: null,
    originalOutcome: { winnerSeatId: null, finishingOrder: null } }), roomCode };
}

test('queued Table records require their room scheduling identity before any I/O', () => {
  let requests = 0;
  const ledger = new FirebasePlaytestLedger({ logger: { error() {} }, fetchImpl: async () => { requests++; return Response.json(null); } });
  for (const value of [undefined, null, '', ' ', 1]) {
    assert.throws(() => ledger.complete(recap('qa_A', value)), /room code/i);
    for (const method of ['record', 'recovery', 'checkpoint', 'note', 'fieldTest', 'complete']) {
      assert.throws(() => ledger[method]({ gameId: 'qa_A', sequence: 1, noteId: 'qa_note', roomCode: value }), /room code/i);
    }
  }
  assert.equal(requests, 0);
});

test('a completed Table does not wait behind another Table and its own archive keeps FIFO order', { timeout: 3000 }, async (t) => {
  const database = await startCompetitionRestFixture(), blocked = gate(), started = gate();
  t.after(async () => { blocked.release(); await ledger.flush(); await database.close(); });
  const ledger = new FirebasePlaytestLedger({ databaseUrl: database.url, clientEmail: 'fixture', privateKey: 'fixture',
    fetchImpl: async (url, options) => {
      if (url.endsWith('/playtests/qa_A/events/1.json')) { started.release(); await blocked.promise; }
      return fetch(url, options);
    } });
  ledger.accessToken = async () => 'local-fixture-only';
  ledger.record({ gameId: 'qa_A', roomCode: 'QA', sequence: 1 });
  const snapshot = { roomCode: 'QA', room: { version: 1 } };
  ledger.recovery(snapshot); snapshot.room.version = 999;
  ledger.checkpoint({ gameId: 'qa_A', roomCode: 'QA', sequence: 1 });
  const archiveA = ledger.complete(recap('qa_A', 'QA'));
  ledger.record({ gameId: 'qa_B', roomCode: 'QB', sequence: 1 });
  const archiveB = ledger.complete(recap('qa_B', 'QB'));
  await started.promise; await archiveB;
  assert.ok(database.read('playtests/qa_B/recap.json'));
  assert.equal(database.read('playtests/qa_A/recap.json'), null);
  blocked.release(); await archiveA; await ledger.flush();
  assert.equal(database.read('recovery/QA.json').room.version, 1, 'Capture recovery bytes before queued work waits.');
  assert.deepEqual(database.calls.filter(call => call.path.includes('qa_A') || call.path.includes('/QA.')).map(call => call.path), [
    '/playtests/qa_A/events/1.json', '/recovery/QA.json', '/playtests/qa_A/checkpoints/1.json', '/playtests/qa_A/recap.json',
  ]);
});

test('a rejected completion remains visible and cannot stop later recovery writes', async (t) => {
  const database = await startCompetitionRestFixture(); t.after(() => database.close());
  let failures = 0;
  const ledger = new FirebasePlaytestLedger({ databaseUrl: database.url, clientEmail: 'fixture', privateKey: 'fixture',
    logger: { error() { failures++; } }, fetchImpl: async (url, options) => url.endsWith('/recap.json')
      ? Response.json({ error: 'fixture failure' }, { status: 503 }) : fetch(url, options) });
  ledger.accessToken = async () => 'local-fixture-only';
  const failed = assert.rejects(ledger.complete(recap('qa_A', 'QA')), /503/);
  ledger.recovery({ roomCode: 'QA', room: { version: 2 } });
  await failed; await ledger.flush();
  assert.equal(failures, 1);
  assert.equal(database.read('recovery/QA.json').room.version, 2);
});

test('many Table writes use a bounded number of network requests and all recovery versions persist', async (t) => {
  const database = await startCompetitionRestFixture(), blocked = gate();
  t.after(async () => { blocked.release(); await ledger.flush(); await database.close(); });
  let running = 0, peak = 0, started = 0;
  const ledger = new FirebasePlaytestLedger({ databaseUrl: database.url, clientEmail: 'fixture', privateKey: 'fixture', writeConcurrency: 3,
    fetchImpl: async (url, options) => {
      started++; running++; peak = Math.max(peak, running);
      try { await blocked.promise; return await fetch(url, options); } finally { running--; }
    } });
  ledger.accessToken = async () => 'local-fixture-only';
  for (let version = 1; version <= 4; version++) for (let table = 0; table < 12; table++) {
    ledger.recovery({ roomCode: `QA_${table}`, room: { version } });
  }
  await tick(); assert.equal(started, 3);
  blocked.release(); await ledger.flush();
  assert.equal(started, 48); assert.equal(peak, 3);
  for (let table = 0; table < 12; table++) assert.equal(database.read(`recovery/QA_${table}.json`).room.version, 4);
});
