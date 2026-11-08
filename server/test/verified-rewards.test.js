import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { AccountHistory, MemoryAccountHistoryStore } from '../src/account-history.js';
import { createRealtimeServer, RoomService } from '../src/app.js';
import { MemoryPlaytestLedger } from '../src/playtest-ledger.js';

const HOUR = 3_600_000;

async function fixture(t) {
  let now = Date.UTC(2026, 10, 7, 12);
  const clock = () => now;
  const store = new MemoryAccountHistoryStore();
  const ledger = new MemoryPlaytestLedger();
  const accountHistory = new AccountHistory({ store, now: clock });
  const { server, service } = createRealtimeServer({
    now: clock, connectionTtlMs: 24 * HOUR, ledger, accountHistory,
    accountVerifier: { async verify(token) {
      if (!token) throw Object.assign(new Error('Sign in'), { status: 401 });
      return { providerSubject: token };
    } },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  async function request(path, { body, connectionId, token = 'player-a', method } = {}) {
    const response = await fetch(base + '/api/account/' + path, {
      method: method || (body === undefined ? 'GET' : 'POST'),
      headers: {
        authorization: 'Bearer ' + token,
        ...(connectionId ? { 'x-connection-id': connectionId } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: response.status === 204 ? null : await response.json() };
  }
  function start({ sessionKind = 'standard', gameFormat = 'commander', startingLife = 40 } = {}) {
    now += 1000;
    const host = service.createConnection().connectionId;
    const guest = service.createConnection().connectionId;
    const made = service.createRoom(host, { playerCount: 2, startingLife, gameFormat });
    const code = made.snapshot.code;
    const join = service.claimSeat(code, guest, { seatId: 1 });
    if (sessionKind !== 'standard') service.setSessionKind(code, host, { baseVersion: join.snapshot.version, sessionKind });
    const version = () => service.room(code).version;
    service.startGame(code, host, { baseVersion: version() });
    return {
      host, guest, code, made, join,
      get reference() { return { roomCode: code, gameId: service.room(code).gameId }; },
      finish(duration) {
        now += duration;
        return service.declareWinner(code, host, { baseVersion: version(), winnerSeatId: 0 }).snapshot;
      },
      nextGameSetup() { return service.beginIntermission(code, host, { baseVersion: version() }); },
      startAgain() {
        service.beginIntermission(code, host, { baseVersion: version() });
        for (const owner of [host, guest]) service.setNextGameReady(code, owner, { baseVersion: version() });
        service.startGame(code, host, { baseVersion: version() });
      },
    };
  }
  const save = (game, options = {}) => request('games', { body: game.reference, connectionId: game.guest, ...options });
  const history = async (token) => (await request('history', { token })).data.history;
  return { request, start, save, history, accountHistory, store, service, ledger, clock };
}

test('only the server-recorded completed seat can create profile progression', async (t) => {
  const f = await fixture(t);
  const game = f.start();
  const originalReference = game.reference;
  assert.equal((await f.save(game)).status, 409);
  game.finish(45 * 60_000);
  const proofless = await f.request('games', { body: { tableSize: 8, won: true, achievementFacts: { durationMs: HOUR } } });
  assert.ok(proofless.status >= 400);
  const forged = await f.save(game, { body: { ...originalReference, achievementFacts: { durationMs: HOUR }, won: true } });
  assert.equal(forged.status, 400);
  const outside = f.service.createConnection().connectionId;
  assert.equal((await f.save(game, { connectionId: outside })).status, 403);
  const saved = await f.save(game);
  assert.equal(saved.status, 201);
  assert.equal(saved.data.game.achievementFacts.durationMs, 45 * 60_000);
  assert.equal(saved.data.game.won, false);
  assert.ok(saved.data.unlockedAchievements.some(award => award.id === 'first-chronicle'));
  assert.ok(!saved.data.unlockedAchievements.some(award => award.id === 'settling-in'));
  assert.ok(!saved.data.unlockedAchievements.some(award => award.id === 'flash-victory'));
  assert.equal((await f.history()).gamesPlayed, 1);
  assert.ok(!JSON.stringify(await f.history()).includes(game.code));
});

test('a short Commander game earns Flash Victory when turns were recorded', async (t) => {
  const f = await fixture(t);
  const game = f.start();
  f.service.handoffTurn(game.code, game.host, { baseVersion: f.service.room(game.code).version });
  game.finish(15 * 60_000);
  const saved = await f.save(game);
  assert.equal(saved.data.game.achievementFacts.handoffCount, 1);
  assert.ok(saved.data.unlockedAchievements.some(award => award.id === 'flash-victory'));
});

test('exactly an hour still qualifies after next-game setup and retries never release twice', async (t) => {
  const f = await fixture(t);
  const game = f.start();
  game.finish(HOUR);
  game.nextGameSetup();
  const attempts = await Promise.all([f.save(game), f.save(game), f.save(game)]);
  assert.ok(attempts.every(save => save.status === 201));
  assert.equal(new Set(attempts.map(save => save.data.game.gameId)).size, 1);
  assert.equal(attempts.flatMap(save => save.data.unlockedAchievements).filter(award => award.id === 'settling-in').length, 1);
  assert.equal((await f.history()).gamesPlayed, 1);
  assert.equal((await f.save(game, { token: 'player-b' })).status, 409);
  assert.equal((await f.history('player-b')).gamesPlayed, 0);
  const winner = await f.save(game, { token: 'player-b', connectionId: game.host });
  assert.equal(winner.status, 201);
  assert.equal(winner.data.game.won, true);
});

test('a retry finishes an interrupted save without exposing a partial award', async (t) => {
  const f = await fixture(t);
  const game = f.start();
  game.finish(HOUR);
  const update = f.store.update.bind(f.store);
  let failOnce = true;
  f.store.update = async (path, change) => {
    if (failOnce && path.includes('/verified-progress/')) {
      failOnce = false;
      throw Object.assign(new Error('Simulated interrupted write'), { status: 503 });
    }
    return update(path, change);
  };
  assert.equal((await f.save(game)).status, 503);
  assert.equal((await f.history()).gamesPlayed, 0);
  const saved = await f.save(game);
  assert.equal(saved.status, 201);
  assert.ok(saved.data.unlockedAchievements.some(award => award.id === 'settling-in'));
  assert.deepEqual((await f.save(game)).data.unlockedAchievements, []);
  assert.equal((await f.history()).gamesPlayed, 1);
});

test('deleting a saved game preserves awards but cannot restart its progression', async (t) => {
  const f = await fixture(t);
  const game = f.start();
  game.finish(HOUR);
  const saved = await f.save(game);
  assert.equal(saved.status, 201);
  assert.equal((await f.request('games/' + saved.data.game.gameId, { method: 'DELETE' })).status, 204);
  const profile = await f.history();
  assert.equal(profile.gamesPlayed, 0);
  assert.ok(profile.achievements.some(award => award.id === 'settling-in'));
  assert.equal((await f.save(game)).status, 409);
});

test('one account receives credit for a game once even when two of its devices own seats', async (t) => {
  const f = await fixture(t);
  const game = f.start();
  game.finish(HOUR);
  const connections = [game.guest, game.host];
  const competing = await Promise.all(connections.map(connectionId => f.save(game, { connectionId })));
  assert.deepEqual(competing.map(result => result.status).sort(), [201, 409]);
  assert.equal((await f.history()).gamesPlayed, 1);
  const otherConnection = connections[competing.findIndex(result => result.status === 409)];
  assert.equal((await f.save(game, { connectionId: otherConnection, token: 'player-b' })).status, 201);
});

test('a new profile at a shared seat starts its own verified table count', async (t) => {
  const f = await fixture(t);
  const game = f.start();
  for (let count = 1; count <= 4; count++) {
    game.finish(30 * 60_000);
    assert.equal((await f.save(game)).status, 201);
    game.startAgain();
  }
  game.finish(30 * 60_000);
  const newcomer = await f.save(game, { token: 'player-b' });
  assert.equal(newcomer.status, 201);
  assert.equal(newcomer.data.game.achievementFacts.tableGameNumber, 1);
  assert.ok(!newcomer.data.unlockedAchievements.some(award => award.id === 'one-more-before-bed'));
  assert.notEqual(newcomer.data.game.accoladeId, 'familiar-seats');
  game.startAgain();
  game.finish(30 * 60_000);
  const regular = await f.save(game);
  assert.equal(regular.data.game.achievementFacts.tableGameNumber, 5);
  assert.ok(regular.data.unlockedAchievements.some(award => award.id === 'one-more-before-bed'));
});

test('development games do not grant progress even through manual saves', async (t) => {
  const f = await fixture(t);
  const practice = f.start({ sessionKind: 'development' });
  practice.finish(HOUR);
  assert.equal((await f.save(practice)).status, 409);
  assert.equal((await f.history()).gamesPlayed, 0);
});

test('concurrent distinct completed games both persist for the same account', async (t) => {
  const f = await fixture(t);
  const first = f.start();
  first.finish(HOUR - 1);
  const second = f.start();
  second.finish(HOUR + 1);
  const results = await Promise.all([f.save(first), f.save(second)]);
  assert.ok(results.every(save => save.status === 201));
  assert.equal(results.flatMap(save => save.data.unlockedAchievements).filter(award => award.id === 'settling-in').length, 1);
  const profile = await f.history();
  assert.equal(profile.gamesPlayed, 2);
  assert.deepEqual(profile.games.map(game => game.achievementFacts.durationMs).sort((a, b) => a - b), [HOUR - 1, HOUR + 1]);
});

test('older progress is preserved and a deferred Endurance tier waits for a qualifying new game', async (t) => {
  const f = await fixture(t);
  const id = await f.accountHistory.ensureAccount('player-a');
  const accountPath = 'account-history/accounts/' + id + '.json';
  const gamesPath = 'account-history/games/' + id + '.json';
  const previous = await f.store.read(accountPath);
  await f.store.write(accountPath, { ...previous, longTermAchievementIds: ['long-endurance-1'] });
  await f.store.write(gamesPath, Object.fromEntries(Array.from({ length: 5 }, (_, index) => [
    'game_old-' + index,
    { gameId: 'game_old-' + index, savedAt: index, tableSize: 2, won: false, achievementFacts: { durationMs: HOUR } },
  ])));
  const short = f.start();
  short.finish(45 * 60_000);
  assert.equal((await f.save(short)).status, 201);
  let profile = await f.history();
  assert.equal(profile.gamesPlayed, 6);
  assert.ok(profile.achievements.some(award => award.id === 'table-regular'));
  assert.ok(profile.achievements.some(award => award.id === 'long-endurance-1'));
  assert.ok(!profile.achievements.some(award => award.id === 'long-endurance-2'));
  const qualifying = f.start();
  qualifying.finish(HOUR);
  assert.equal((await f.save(qualifying)).status, 201);
  profile = await f.history();
  assert.ok(profile.achievements.some(award => award.id === 'long-endurance-2'));
});

test('a resumed room deduplicates accepted play and keeps its finished evidence through another restore', async (t) => {
  const f = await fixture(t);
  const game = f.start();
  const action = { counter: 'energy', delta: 10, operationId: 'synthetic-applied-energy-op' };
  f.service.adjustOwnSeat(game.code, game.guest, action);

  async function restore() {
    const service = new RoomService({ now: f.clock, ledger: f.ledger });
    await service.restoreRoom(game.code, game.made.hostRecoveryKey);
    const host = service.createConnection().connectionId;
    const guest = service.createConnection().connectionId;
    service.claimSeat(game.code, host, { seatId: 0, reclaimToken: game.made.reclaimToken });
    service.claimSeat(game.code, guest, { seatId: 1, reclaimToken: game.join.reclaimToken });
    return { service, host, guest };
  }

  const resumed = await restore();
  const repeated = resumed.service.adjustOwnSeat(game.code, resumed.guest, action);
  assert.equal(repeated.deduplicated, true);
  assert.equal(repeated.snapshot.seats[1].counters.energy, 10);
  resumed.service.declareWinner(game.code, resumed.host, {
    baseVersion: resumed.service.room(game.code).version, winnerSeatId: 0,
  });

  const restarted = await restore();
  const completion = restarted.service.completedSeat(game.code, restarted.guest, game.reference.gameId);
  const id = await f.accountHistory.ensureAccount('restarted-profile');
  const saved = await f.accountHistory.saveCompletedGame(id, completion);
  assert.equal(saved.game.counterTotals.energy, 10);
  assert.ok(!saved.unlockedAchievements.some(award => award.id === 'capacitor-discharge'));
});

test('a replacement at the same seat cannot save the previous player’s completed result', async (t) => {
  const f = await fixture(t);
  const game = f.start();
  game.finish(HOUR);
  const reference = game.reference;
  game.nextGameSetup();
  f.service.leaveIntermission(game.code, game.guest, { baseVersion: f.service.room(game.code).version });
  const replacement = f.service.createConnection().connectionId;
  f.service.claimSeat(game.code, replacement, { seatId: 1 });
  const save = await f.save(game, { connectionId: replacement, body: reference, token: 'replacement' });
  assert.equal(save.status, 403);
  assert.equal((await f.history('replacement')).gamesPlayed, 0);
});

test('a custom starting value of five life is not a tracked close call', async (t) => {
  const f = await fixture(t);
  const game = f.start({ gameFormat: 'custom', startingLife: 5 });
  game.finish(30 * 60_000);
  const saved = await f.save(game, { connectionId: game.host });
  assert.equal(saved.status, 201);
  assert.ok(!saved.data.unlockedAchievements.some(award => award.id === 'last-breath' || award.id === 'hanging-by-a-thread'));
  assert.equal(saved.data.game.achievementFacts.lowestLife, undefined);
  assert.equal(saved.data.moment.kind, 'accolade');
  assert.doesNotMatch(saved.data.moment.fact, /Lowest (recorded )?life:/);
});

test('a completed loss at negative life is saved, and custom games never award Commander turn milestones', async (t) => {
  const f = await fixture(t);
  const game = f.start({ gameFormat: 'custom' });
  f.service.adjustOwnSeat(game.code, game.guest, { counter: 'life', delta: -41 });
  const saved = await f.save(game);
  assert.equal(saved.status, 201);
  assert.equal(saved.data.game.achievementFacts.lowestLife, -1);
  assert.ok(!saved.data.unlockedAchievements.some(award => award.id === 'flash-victory'));
});
