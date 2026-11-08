import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountHistory, MemoryAccountHistoryStore } from '../src/account-history.js';
import { RoomService } from '../src/app.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const CHECKPOINTS = [5, 25, 100];
const RECOVERY_GAMES = new Set([2, 3, 4, 15]);
const VARIED_WINS = new Set([40, 80, 95]);
const HOUR_GAMES = new Set([7, 12, 20, 29, 35, 45, 55, 65, 79, 95]);
const PLAYER_SEAT = 1;

function createTable(service, playerCount, advance) {
  const connections = [service.createConnection().connectionId];
  const { snapshot: { code } } = service.createRoom(connections[0], { playerCount, startingLife: 40 });
  for (let seatId = 1; seatId < playerCount; seatId += 1) {
    const { connectionId } = service.createConnection();
    service.claimSeat(code, connectionId, { seatId });
    connections.push(connectionId);
  }

  const room = () => service.room(code);
  const act = (method, input, seatId = 0) =>
    service[method](code, connections[seatId], { ...input, baseVersion: room().version });
  return {
    start() {
      if (room().gameResult) {
        act('beginIntermission');
        for (let seatId = 0; seatId < playerCount; seatId += 1) act('setNextGameReady', { ready: true }, seatId);
      }
      act('startGame');
    },
    damage(seatId, amount) { act('adjustOwnSeat', { counter: 'life', delta: -amount }, seatId); },
    gainLife(seatId, amount) { act('adjustOwnSeat', { counter: 'life', delta: amount }, seatId); },
    activeSeat: () => room().turn.activeSeatId,
    handoff() {
      advance(2 * MINUTE);
      act('handoffTurn', {}, room().turn.activeSeatId);
    },
    finish(winnerSeatId) {
      act('declareWinner', { winnerSeatId });
      return service.completedSeat(code, connections[PLAYER_SEAT], room().gameId);
    },
  };
}

function playRecovery(table) {
  // Two separate opposing turns bring the player from 40 to 4 without one
  // big damage spike. The next recorded action is a real recovery to 19.
  if (table.activeSeat() === PLAYER_SEAT) table.handoff();
  table.damage(PLAYER_SEAT, 18);
  table.handoff();
  if (table.activeSeat() === PLAYER_SEAT) table.handoff();
  table.damage(PLAYER_SEAT, 18);
  table.gainLife(PLAYER_SEAT, 15);
}

function playRoutine(table) {
  table.damage(0, 2);
  table.damage(PLAYER_SEAT, 3);
  table.handoff();
}

async function playThrough(playstyle) {
  let now = Date.UTC(2026, 10, 1, 12);
  let nextId = 0;
  const advance = (duration) => { now += duration; };
  const clock = () => now;
  const accountHistory = new AccountHistory({
    store: new MemoryAccountHistoryStore(),
    now: clock,
    createId: () => String(++nextId),
  });
  const accountId = await accountHistory.ensureAccount(playstyle);
  const service = new RoomService({ now: clock, connectionTtlMs: 168 * HOUR, roomTtlMs: 168 * HOUR });
  const steady = playstyle === 'steady';
  const tables = (steady ? [4] : [3, 4]).map(size => createTable(service, size, advance));
  const deck = steady ? await accountHistory.createDeck(accountId, { commanderName: 'Example Commander', name: 'Steady deck' }) : null;
  const games = [];
  const snapshots = new Map();
  let retry;

  for (let number = 1; number <= 100; number += 1) {
    advance(MINUTE);
    const startedAt = now;
    const table = tables[(number - 1) % tables.length];
    table.start();
    const recovery = RECOVERY_GAMES.has(number);
    if (recovery) playRecovery(table);
    else playRoutine(table);
    const duration = steady ? 35 * MINUTE : HOUR_GAMES.has(number) ? HOUR : (20 + number % 15) * MINUTE;
    advance(startedAt + duration - now);
    const won = steady ? number % 2 === 1 && !recovery : VARIED_WINS.has(number);
    const completion = table.finish(won ? PLAYER_SEAT : 0);
    const saved = await accountHistory.saveCompletedGame(accountId, completion, deck?.deckId);
    games.push({ number, won, saved });
    if (number === 2) retry = await accountHistory.saveCompletedGame(accountId, completion, deck?.deckId);
    if (CHECKPOINTS.includes(number)) snapshots.set(number, await accountHistory.summary(accountId));
  }

  return { games, snapshots, retry, deck };
}

function byNumber(games, number) {
  return games[number - 1].saved;
}

function assertNoRepeatedRecovery(games, numbers) {
  for (const number of numbers) {
    const result = byNumber(games, number);
    assert.equal(result.moment.kind, 'accolade', 'game ' + number + ' should show an accolade');
    assert.equal(result.game.accoladeId, result.moment.id);
    assert.ok(result.moment.id && result.moment.fact);
    assert.doesNotMatch(result.moment.fact, /Lowest (recorded )?life:/, 'game ' + number + ' should avoid a repeated recovery');
  }
}

function assertRecovery(games, number) {
  const result = byNumber(games, number);
  assert.equal(result.game.achievementFacts.lowestLife, 4);
  assert.equal(result.game.achievementFacts.lifeGainedAfterLow, 15);
  assert.equal(result.moment.id, 'phoenix-return', 'game ' + number + ' should recognize the actual recovery');
  assert.equal(result.game.accoladeId, result.moment.id);
}

function assertProgress({ games, snapshots, retry }, t) {
  for (const [index, number] of CHECKPOINTS.entries()) {
    const profile = snapshots.get(number);
    assert.equal(profile.gamesPlayed, number);
    assert.equal(profile.wins, games.slice(0, number).filter(game => game.won).length);
    assert.equal(new Set(profile.games.map(game => game.gameId)).size, number);
    assert.ok(profile.games.every(game => game.completionVerified === true));
    const milestones = ['table-regular', 'seasoned', 'pod-pillar'];
    const earned = new Set(profile.achievements.map(award => award.id));
    assert.ok(earned.has('first-chronicle'));
    for (const [milestoneIndex, id] of milestones.entries()) assert.equal(earned.has(id), milestoneIndex <= index, id + ' at game ' + number);
    t.diagnostic('Game ' + number + ': ' + profile.gamesPlayed + ' verified saves, ' + profile.wins + ' wins, ' + earned.size + ' profile awards');
  }

  const released = new Set();
  for (const { number, saved } of games) {
    const paced = saved.unlockedAchievements.filter(award => award.id.startsWith('long-'));
    assert.ok(paced.length <= 1, 'game ' + number + ' may release at most one long-term award');
    for (const award of saved.unlockedAchievements) {
      assert.ok(!released.has(award.id), award.id + ' should release only once');
      released.add(award.id);
    }
  }
  assert.equal(retry.game.gameId, byNumber(games, 2).game.gameId);
  assert.deepEqual(retry.moment, byNumber(games, 2).moment);
  assert.deepEqual(retry.unlockedAchievements, []);
}

test('steady saved-deck play preserves profile milestones while routine finishes and close repeats get a different accolade', async (t) => {
  const replay = await playThrough('steady');
  assertProgress(replay, t);
  for (const number of CHECKPOINTS) {
    const stats = replay.snapshots.get(number).deckStats.find(deck => deck.deckId === replay.deck.deckId);
    assert.equal(stats.gamesPlayed, number);
  }
  assert.ok(replay.snapshots.get(25).achievements.some(award => award.id === 'long-deck-mastery-1'));

  assertNoRepeatedRecovery(replay.games, [1, 3, 4, 6, 25, 100]);
  assertRecovery(replay.games, 2);
  assertRecovery(replay.games, 15);
});

test('varied low-win play earns profile milestones and remembers recent recovery across tables', async (t) => {
  const replay = await playThrough('varied-low-win');
  assertProgress(replay, t);
  const middle = replay.snapshots.get(25);
  assert.equal(middle.wins, 0);
  assert.ok(middle.achievements.some(award => award.id === 'long-endurance-1'));
  assert.ok(middle.achievements.some(award => award.id === 'long-resilience-1'));
  assert.equal(replay.snapshots.get(100).wins, VARIED_WINS.size);

  assertNoRepeatedRecovery(replay.games, [1, 3, 4, 11, 25, 100]);
  assertRecovery(replay.games, 2);
  assertRecovery(replay.games, 15);
});
