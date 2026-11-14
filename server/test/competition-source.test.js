import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomService } from '../src/app.js';
import { MemoryPlaytestLedger, FirebasePlaytestLedger } from '../src/playtest-ledger.js';

function finished(ledger = new MemoryPlaytestLedger()) {
  const service = new RoomService({ ledger, now: () => 1000, completionEvidenceEnabled: true });
  const host = service.createConnection().connectionId;
  const other = service.createConnection().connectionId;
  const created = service.createRoom(host, { playerCount: 2, seatCapacity: 8, startingLife: 40 });
  const code = created.snapshot.code;
  service.claimSeat(code, other, { seatId: 3, name: 'Private table name' });
  service.startGame(code, host, { baseVersion: service.room(code).version });
  service.declareWinner(code, host, { winnerSeatId: 0, reason: 'alternate_win', declarationDetail: 'Private free text', baseVersion: service.room(code).version });
  return { service, ledger, host, other, code, gameId: service.room(code).gameId };
}

test('completion archive freezes actual starters, owner proofs and original outcome without names or account data', async () => {
  const f = finished(); const source = await f.ledger.readArchivedSource(f.gameId);
  assert.equal(source.gameId, f.gameId);
  assert.deepEqual(source.starters.map(seat => seat.seatId), [0, 3]);
  assert.ok(source.starters.every(seat => typeof seat.ownerHash === 'string' && seat.ownerHash.length > 20));
  assert.equal(source.originalOutcome.winnerSeatId, 0);
  assert.equal(source.inferredOrder, null);
  assert.equal(/Private|accountId|"name"|commanderName|commanderColors|declarationDetail/.test(JSON.stringify(source)), false);
  assert.deepEqual(f.service.room(f.code).completedGames[0].source, source);
  assert.equal(JSON.stringify(f.service.snapshot(f.service.room(f.code))).includes('ownerHash'), false);
});

test('all archive and diagnostic serializers strip private source evidence, including nested recap', async () => {
  const f = finished();
  for (const value of [await f.ledger.listArchive(), await f.ledger.readDiagnostics(f.gameId),
    await f.ledger.findDiagnostics(''), await f.ledger.listRecentDiagnostics(),
    await f.service.hostArchive(f.code, f.host), f.service.playtestRecap(f.code, f.host)]) {
    assert.equal(/ownerHash|_competitionSource|tableIdentity/.test(JSON.stringify(value)), false);
  }
});

test('archive repair is acknowledged, immutable, idempotent and independent of finalization counts', async () => {
  const f = finished(); const source = await f.ledger.readArchivedSource(f.gameId);
  const before = f.service.room(f.code).seats[0].completedGamesAtTable;
  await f.ledger.retrySourceArchive(source);
  await f.ledger.retrySourceArchive(structuredClone(source));
  await assert.rejects(() => f.ledger.retrySourceArchive({ ...source, completedAt: 2000 }), /conflict/i);
  assert.deepEqual(await f.ledger.readArchivedSource(f.gameId), source);
  assert.equal(f.service.room(f.code).seats[0].completedGamesAtTable, before);
});

test('an acknowledged archive drops the bulky repair recap before later life-recovery snapshots', async () => {
  const f = finished(); await Promise.resolve();
  const cached = f.service.room(f.code).completedGames[0];
  assert.equal(cached.archiveRecap, undefined);
  assert.ok(cached.source);
  assert.ok((await f.ledger.listArchive())[0].players.length);
});

test('Firebase uses one conditional archive PUT initially; identical retries succeed and conflicts never overwrite', async () => {
  let value = null; const methods = [];
  const ledger = new FirebasePlaytestLedger({ databaseUrl: 'https://fixture.invalid',
    clientEmail: 'fixture', privateKey: 'fixture', logger: { error() {} },
    fetchImpl: async (url, options = {}) => {
      methods.push(options.method || 'GET');
      if (options.method !== 'PUT') return Response.json(url.endsWith('/playtests.json')
        ? { [value?.gameId]: { recap: value } } : value);
      assert.equal(options.headers['if-match'], 'null_etag');
      if (value) return Response.json(value, { status: 412 });
      value = JSON.parse(options.body); return Response.json(value);
    },
  });
  ledger.accessToken = async () => 'fixture';
  const f = finished(); const receipt = await f.ledger.readArchivedSource(f.gameId);
  await ledger.retrySourceArchive(receipt);
  assert.deepEqual(methods, ['PUT']);
  await ledger.retrySourceArchive(receipt);
  await assert.rejects(() => ledger.retrySourceArchive({ ...receipt, completedAt: 2001 }), /conflict/i);
  assert.deepEqual(await ledger.readArchivedSource(f.gameId), receipt);
  assert.equal((await ledger.listArchive())[0]._competitionSource, undefined);
});
