import assert from 'node:assert/strict';
import test from 'node:test';
import { Competitions } from '../src/competitions.js';
import { CompetitionTables } from '../src/competition-tables.js';
import { competitionRoute } from '../src/competition-http.js';
import { RoomService } from '../src/app.js';
import { MemoryAccountHistoryStore } from '../src/account-history.js';
import { MemoryPlaytestLedger } from '../src/playtest-ledger.js';

async function fixture() {
  let time = 1000;
  const store = new MemoryAccountHistoryStore(), ledger = new MemoryPlaytestLedger();
  const domain = new Competitions({ store, now: () => time++ });
  const service = new RoomService({ ledger, now: () => time++ });
  const tables = new CompetitionTables({ domain, service, ledger });
  const pod = await domain.createPod('owner', { name: 'History Pod', displayName: 'Owner' });
  const invite = await domain.invite('owner', 'pod', pod.id);
  const member = await domain.joinPod('member', invite.token, { displayName: 'Member' });
  const starterIds = [pod.me, member.me];
  const seed = async entries => domain.changeScope('pod', pod.id, scope => {
    for (const { id, at, confirmed = false } of entries) scope.games[id] = {
      gameId: id, completedAt: at, startedAt: at - 10, hostId: pod.me,
      starterIds, eligibleIds: starterIds, seats: [], ratingChanges: [], original: {},
      revisions: confirmed ? [{ revision: 1, order: starterIds.map(id => [id]), by: pod.me }] : [],
    };
  });
  const history = query => tables.history('owner', 'pod', pod.id, query);
  return { store, ledger, domain, service, tables, pod, member, seed, history };
}

test('pending history finds an older result beyond twenty newer confirmed games', async () => {
  const f = await fixture();
  await f.seed([{ id: 'old_pending', at: 100 }, ...Array.from({ length: 25 }, (_, i) => ({
    id: `confirmed_${i}`, at: 200 + i, confirmed: true,
  }))]);
  const all = await f.history();
  assert.equal(all.games.length, 20);
  assert.ok(all.games.every(game => game.status === 'confirmed'));
  const pending = await f.history({ status: 'pending' });
  assert.deepEqual(pending, { games: [{ gameId: 'old_pending', completedAt: 100, playerCount: 2, status: 'pending', revision: 0 }], nextCursor: null });
});

test('pending pagination applies before slicing and keeps deterministic tied-time cursors', async () => {
  const f = await fixture();
  await f.seed([
    { id: 'pending_z', at: 300 }, { id: 'confirmed_new', at: 400, confirmed: true },
    { id: 'pending_a', at: 300 }, { id: 'confirmed_middle', at: 250, confirmed: true },
    { id: 'pending_old', at: 200 },
  ]);
  const first = await f.history({ status: 'pending', limit: 2 });
  assert.deepEqual(first.games.map(game => game.gameId), ['pending_z', 'pending_a']);
  assert.equal(first.nextCursor, '300:pending_a');
  const second = await f.history({ status: 'pending', limit: 2, cursor: first.nextCursor });
  assert.deepEqual(second.games.map(game => game.gameId), ['pending_old']);
  assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.games, ...second.games].map(game => game.gameId)).size, 3);
  await assert.rejects(() => f.history({ status: 'pending', cursor: '400:confirmed_new' }), { status: 409 });
});

test('pending history retains inclusive from and exclusive to bounds without changing stored history', async () => {
  const f = await fixture();
  await f.seed([
    { id: 'before', at: 99 }, { id: 'at_from', at: 100 },
    { id: 'confirmed_inside', at: 150, confirmed: true }, { id: 'inside', at: 199 }, { id: 'at_to', at: 200 },
  ]);
  const before = await f.domain.readScope('pod', f.pod.id);
  const page = await f.history({ status: 'pending', from: '100', to: '200' });
  assert.deepEqual(page.games.map(game => game.gameId), ['inside', 'at_from']);
  assert.equal(page.nextCursor, null);
  assert.deepEqual(await f.domain.readScope('pod', f.pod.id), before);
});

test('confirming a real captured result removes it from pending but preserves its confirmed history row', async () => {
  const f = await fixture();
  const host = f.service.createConnection().connectionId, member = f.service.createConnection().connectionId;
  const code = f.service.createRoom(host, { playerCount: 2, startingLife: 40, name: 'Owner' }).snapshot.code;
  f.service.claimSeat(code, member, { seatId: 1, name: 'Member' });
  await f.tables.bind('owner', { kind: 'pod', id: f.pod.id, code, connectionId: host });
  await f.tables.claim('member', { code, connectionId: member });
  await f.tables.start(code, host, { baseVersion: f.service.room(code).version });
  f.service.declareWinner(code, host, { winnerSeatId: 0, baseVersion: f.service.room(code).version });
  await f.tables.reconcile('pod', f.pod.id);
  const gameId = f.service.room(code).gameId;
  assert.deepEqual((await f.history({ status: 'pending' })).games.map(game => game.gameId), [gameId]);
  const source = (await f.domain.readScope('pod', f.pod.id)).games[gameId];
  await f.tables.confirm('owner', 'pod', f.pod.id, gameId, {
    order: source.starterIds.map(id => [id]), baseRevision: 0,
    requestId: 'pending_history_confirmation', reasonCode: 'host_confirmation',
  });
  assert.deepEqual(await f.history({ status: 'pending' }), { games: [], nextCursor: null });
  assert.deepEqual((await f.history()).games.map(({ gameId, status, revision }) => ({ gameId, status, revision })), [
    { gameId, status: 'confirmed', revision: 1 },
  ]);
});

test('pending history preserves active membership and cross-Pod authorization', async () => {
  const f = await fixture();
  await f.seed([{ id: 'private_result', at: 100 }]);
  await f.domain.createPod('outsider', { name: 'Other Pod', displayName: 'Outsider' });
  const before = await f.domain.readScope('pod', f.pod.id);
  for (const auth of ['outsider', null, {}]) {
    await assert.rejects(() => f.tables.history(auth, 'pod', f.pod.id, { status: 'pending' }), { status: 403, code: 'COMPETITION_ACCESS' });
  }
  assert.equal((await f.tables.history('member', 'pod', f.pod.id, { status: 'pending' })).games.length, 1);
  assert.deepEqual(await f.domain.readScope('pod', f.pod.id), before);
  await f.domain.podMemberAction('member', f.pod.id, { action: 'leave' });
  await assert.rejects(() => f.tables.history('member', 'pod', f.pod.id, { status: 'pending' }), { status: 403, code: 'COMPETITION_ACCESS' });
});

test('provided history status filters reject unsupported values instead of silently showing all games', async () => {
  const f = await fixture();
  await f.seed([{ id: 'pending_result', at: 100 }]);
  const before = await f.domain.readScope('pod', f.pod.id);
  for (const status of ['', 'confirmed', 'Pending', 'pending ', null, 0, [], {}]) {
    await assert.rejects(() => f.history({ status }), { status: 400 });
  }
  assert.deepEqual(await f.domain.readScope('pod', f.pod.id), before);
});

test('omitting the filter preserves mixed history response fields, sorting and pagination', async () => {
  const f = await fixture();
  await f.seed([{ id: 'pending_z', at: 300 }, { id: 'confirmed_a', at: 300, confirmed: true }, { id: 'older', at: 200 }]);
  const first = await f.history({ limit: 2 });
  assert.deepEqual(first, {
    games: [
      { gameId: 'pending_z', completedAt: 300, playerCount: 2, status: 'pending', revision: 0 },
      { gameId: 'confirmed_a', completedAt: 300, playerCount: 2, status: 'confirmed', revision: 1 },
    ],
    nextCursor: '300:confirmed_a',
  });
  assert.deepEqual(await f.history({ cursor: first.nextCursor, limit: 2 }), {
    games: [{ gameId: 'older', completedAt: 200, playerCount: 2, status: 'pending', revision: 0 }], nextCursor: null,
  });
});

test('existing HTTP history query forwards the pending filter and rejects invalid values', async () => {
  const f = await fixture();
  await f.seed([{ id: 'confirmed_new', at: 200, confirmed: true }, { id: 'pending_old', at: 100 }]);
  const request = status => competitionRoute({
    req: { method: 'GET', headers: { authorization: 'Bearer fixture-only' } },
    url: new URL(`http://127.0.0.1/api/competitions/pod/${f.pod.id}/history?status=${status}`),
    account: async () => 'owner', domain: f.domain, tables: f.tables,
  });
  const result = await request('pending');
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.games.map(game => game.gameId), ['pending_old']);
  await assert.rejects(() => request('unknown'), { status: 400 });
});
