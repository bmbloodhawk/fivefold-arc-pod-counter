import assert from 'node:assert/strict';
import test from 'node:test';
import { createRealtimeServer } from '../src/app.js';
import { CompetitionRecovery } from '../src/competition-recovery.js';

test('hanging optional discovery does not block casual HTTP play or launch overlapping recovery', async t => {
  let reads = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const instance = createRealtimeServer({ competitionStore: { read: async () => { reads++; return gate; }, update: async () => { throw new Error('Unexpected competition write'); } } });
  const recovery = new CompetitionRecovery({ domain: instance.competitions, tables: instance.competitionTables });
  const pending = recovery.tick();
  await new Promise(resolve => instance.server.listen(0, '127.0.0.1', resolve));
  t.after(() => { release({ tables: {} }); instance.server.closeAllConnections(); return new Promise(resolve => instance.server.close(resolve)); });
  const origin = `http://127.0.0.1:${instance.server.address().port}`;
  const health = await fetch(origin + '/health', { signal: AbortSignal.timeout(2000) });
  assert.equal(health.status, 200);
  const host = instance.service.createConnection().connectionId;
  const guest = instance.service.createConnection().connectionId;
  const code = instance.service.createRoom(host, { playerCount: 2, startingLife: 40 }).snapshot.code;
  instance.service.claimSeat(code, guest, { seatId: 1 });
  instance.service.startGame(code, host, { baseVersion: instance.service.room(code).version });
  const response = await fetch(`${origin}/api/rooms/${code}/adjust`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-connection-id': guest }, body: JSON.stringify({ counter: 'life', delta: -7 }), signal: AbortSignal.timeout(2000) });
  assert.equal(response.status, 200); assert.equal(instance.service.room(code).seats[1].counters.life, 33);
  await recovery.tick(); assert.equal(reads, 1);
  release({ tables: {} }); await pending; assert.equal(recovery.running, false);
});

test('failed discovery retries on the next tick and idle scopes leave the recovery set', async () => {
  let attempts = 0, captures = 0; const errors = [];
  const tables = { pendingScopes: new Map(), reconcile: async () => { captures++; } };
  const domain = { directory: async () => {
    if (++attempts === 1) throw new Error('Fixture unavailable');
    return { tables: { key: { kind: 'pod', id: 'pod_fixture' } } };
  }, readScope: async () => ({ tables: { key: { captures: {} } } }) };
  const recovery = new CompetitionRecovery({ domain, tables, logger: { error: (...message) => errors.push(message) } });
  await recovery.tick(); assert.equal(errors.length, 1); assert.equal(recovery.discovered, false);
  await recovery.tick(); assert.equal(captures, 1); assert.equal(recovery.discovered, true); assert.equal(tables.pendingScopes.size, 0);
});
