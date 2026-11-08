import assert from 'node:assert/strict';
import { AccountHistory, MemoryAccountHistoryStore } from '../server/src/account-history.js';
import { RoomService } from '../server/src/app.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const LIMIT = 2_000;
const CHECKPOINTS = new Set([5, 25, 100, 250, 500, 1_000, 1_500, LIMIT]);

const profiles = [
  { label: 'steady deck', sizes: [4], deckCount: 1, winsEvery: 2, nearLossEvery: 12, minutes: 45 },
  { label: 'varied low-win', sizes: [3, 4, 6], deckCount: 8, winsEvery: 19, nearLossEvery: 14, minutes: 38 },
  { label: 'long sessions', sizes: [4, 6], deckCount: 4, winsEvery: 9, nearLossEvery: 8, minutes: 74 },
];

function table(service, players) {
  const connections = Array.from({ length: players }, () => service.createConnection().connectionId);
  const { snapshot: { code } } = service.createRoom(connections[0], { playerCount: players, startingLife: 40 });
  for (let seatId = 1; seatId < players; seatId++) service.claimSeat(code, connections[seatId], { seatId });
  const room = () => service.room(code);
  const act = (name, seatId = 0, input = {}) => service[name](code, connections[seatId], { ...input, baseVersion: room().version });
  return {
    act,
    activeSeat: () => room().turn.activeSeatId,
    completion: () => service.completedSeat(code, connections[1], room().gameId),
    start() {
      if (room().gameResult) {
        act('beginIntermission');
        for (let seatId = 0; seatId < players; seatId++) act('setNextGameReady', seatId);
      }
      act('startGame');
    },
  };
}

function longestGap(progression, after, through) {
  let last = after;
  let longest = { from: after, to: after, gamesBetween: 0 };
  const awardGames = progression.filter(item => item.number > after && item.number <= through).map(item => item.number);
  for (const game of [...awardGames, through + 1]) {
    const gamesBetween = game - last - 1;
    if (gamesBetween > longest.gamesBetween) longest = { from: last, to: game, gamesBetween };
    last = game;
  }
  return longest;
}

for (const profile of profiles) {
  const replayStart = Date.UTC(2025, 0, 1, 12);
  let now = replayStart;
  let sequence = 0;
  const history = new AccountHistory({ store: new MemoryAccountHistoryStore(), now: () => now, createId: () => 'fixture-' + (++sequence) });
  const account = await history.ensureAccount('fixture-profile');
  const service = new RoomService({ now: () => now, roomTtlMs: 1_000 * DAY, connectionTtlMs: 1_000 * DAY });
  const tables = new Map(profile.sizes.map(size => [size, table(service, size)]));
  const decks = [];
  for (let n = 0; n < profile.deckCount; n++) {
    decks.push(await history.createDeck(account, { name: 'Fixture deck ' + (n + 1), commanderName: 'Fixture' }));
  }
  assert.equal((await history.decks(account)).length, profile.deckCount);
  const progression = [];
  const checkpoints = [];

  for (let number = 1; number <= LIMIT; number++) {
    now = replayStart + Math.floor((number - 1) / 3) * DAY + ((number - 1) % 3) * 3 * 60 * MINUTE;
    const size = profile.sizes[(number - 1) % profile.sizes.length];
    const pod = tables.get(size);
    const startedAt = now;
    pod.start();
    for (let turn = 0; turn < size; turn++) {
      now += 2 * MINUTE;
      pod.act('handoffTurn', pod.activeSeat());
    }
    pod.act('adjustOwnSeat', 1, { counter: 'life', delta: number % profile.nearLossEvery === 0 ? -36 : -4 });
    now = startedAt + (profile.minutes + number % 5) * MINUTE;
    pod.act('declareWinner', 0, { winnerSeatId: number % profile.winsEvery === 0 ? 1 : 0 });
    const deck = decks[(number - 1) % decks.length];
    const result = await history.saveCompletedGame(account, pod.completion(), deck.deckId);
    const earned = result.unlockedAchievements.map(item => item.id);
    assert.ok(earned.filter(id => id.startsWith('long-')).length <= 1);
    if (earned.length) progression.push({ number, earned });
    if (CHECKPOINTS.has(number)) {
      const saved = await history.summary(account);
      assert.equal(saved.gamesPlayed, number);
      checkpoints.push({ game: number, earned: saved.achievements.length, wins: saved.wins });
    }
  }

  console.log(JSON.stringify({
    playstyle: profile.label,
    checkpoints,
    longestGap101To1000: longestGap(progression, 100, 1_000),
    longestGap1001To2000: longestGap(progression, 1_000, LIMIT),
    awardsAfter100: progression.filter(item => item.number > 100),
  }));
}
