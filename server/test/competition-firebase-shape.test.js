import assert from 'node:assert/strict';
import test from 'node:test';
import { Competitions } from '../src/competitions.js';
import { CompetitionTables } from '../src/competition-tables.js';
import { RoomService } from '../src/app.js';
import { FirebasePlaytestLedger } from '../src/playtest-ledger.js';
import { archivedSource, sourceArchive } from '../src/competition-source.js';

// RTDB deletes null/empty children and may return numeric-key objects as arrays.
// Keep this adapter deliberately unlike the object-preserving in-memory store.
function rtdb(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') return value;
  const entries = Object.entries(value).map(([key, item]) => [key, rtdb(item)]).filter(([, item]) => item !== null);
  if (!entries.length) return null;
  if (entries.every(([key]) => /^(0|[1-9]\d*)$/.test(key))) {
    const max = Math.max(...entries.map(([key]) => Number(key)));
    if (max < entries.length * 2) return Array.from({ length: max + 1 }, (_, i) => entries.find(([key]) => Number(key) === i)?.[1] ?? null);
  }
  return Object.fromEntries(entries);
}
class ShapeStore {
  values = new Map();
  async read(path) { return structuredClone(this.values.get(path) ?? null); }
  async update(path, change) {
    const next = rtdb(change(structuredClone(this.values.get(path) ?? null)));
    this.values.set(path, next); return structuredClone(next);
  }
}

test('Pod lifecycle works when RTDB deletes empty children and numeric seat maps become arrays', async () => {
  const store = new ShapeStore(); const domain = new Competitions({ store });
  const documents = new Map(); const ledger = new FirebasePlaytestLedger({ databaseUrl: 'https://fixture.invalid', clientEmail: 'fixture', privateKey: 'fixture', logger: { error() {} },
    fetchImpl: async (url, options = {}) => {
      const key = new URL(url).pathname;
      if (options.method === 'PATCH') {
        const updates = JSON.parse(options.body);
        for (const [path, value] of Object.entries(updates)) documents.set('/' + path + '.json', rtdb(value));
        return Response.json(updates);
      }
      if (options.method !== 'PUT') return Response.json(documents.get(key) ?? null);
      if (options.headers['if-match'] === 'null_etag' && documents.has(key)) return new Response(null, { status: 412 });
      const value = rtdb(JSON.parse(options.body)); documents.set(key, value); return Response.json(value);
    } });
  ledger.accessToken = async () => 'fixture';
  const service = new RoomService({ ledger }); const tables = new CompetitionTables({ domain, service, ledger });
  const pod = await domain.createPod('a', { name: 'RTDB shape', displayName: 'A' });
  const invite = await domain.invite('a', 'pod', pod.id);
  await domain.joinPod('b', invite.token, { displayName: 'B' });
  const connections = [service.createConnection().connectionId, service.createConnection().connectionId];
  const code = service.createRoom(connections[0], { playerCount: 2, startingLife: 40 }).snapshot.code;
  service.claimSeat(code, connections[1], { seatId: 1 });
  await tables.bind('a', { kind: 'pod', id: pod.id, code, connectionId: connections[0] });
  await tables.claim('b', { code, connectionId: connections[1] });
  await tables.start(code, connections[0], { baseVersion: service.room(code).version });
  service.declareWinner(code, connections[0], { winnerSeatId: 0, baseVersion: service.room(code).version });
  await ledger.flush(); await tables.reconcile('pod', pod.id);
  const game = (await domain.readScope('pod', pod.id)).games[service.room(code).gameId];
  await tables.confirm('a', 'pod', pod.id, game.gameId, { order: game.starterIds.map(id => [id]), baseRevision: 0, requestId: 'firebase_confirmation' });
  assert.equal((await domain.getPod('a', pod.id)).members[0].gamesPlayed, 1);
  await domain.eraseAccount('b');
  assert.equal((await domain.getPod('a', pod.id)).members.find(row => row.name === 'Deleted member').gamesPlayed, 1);
});

test('immutable source digest survives RTDB null removal for declared winners and timed draws', () => {
  for (const winnerSeatId of [0, null]) {
    const source = { schemaVersion: 1, gameId: 'game_fixture', tableIdentity: 'proof', startedAt: 1, completedAt: 2,
      gameFormat: 'commander', sessionKind: 'standard', starters: [{ seatId: 0, ownerHash: 'one' }, { seatId: 1, ownerHash: 'two' }],
      originalOutcome: { kind: winnerSeatId === null ? 'timed_draw' : 'winner', winnerSeatId, reason: 'fixture', finishingOrder: null }, inferredOrder: null };
    assert.deepEqual(archivedSource(rtdb(sourceArchive(source))), source);
  }
});
