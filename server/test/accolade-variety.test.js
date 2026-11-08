import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountHistory, MemoryAccountHistoryStore } from '../src/account-history.js';
import { RoomService } from '../src/app.js';

const MINUTE = 60_000;

function fixture() {
  let now = Date.UTC(2026, 10, 1, 12);
  const clock = () => now;
  const service = new RoomService({ now: clock, connectionTtlMs: 24 * 60 * MINUTE });
  const history = new AccountHistory({ store: new MemoryAccountHistoryStore(), now: clock });

  function table(size) {
    const ids = Array.from({ length: size }, () => service.createConnection().connectionId);
    const { snapshot: { code } } = service.createRoom(ids[0], { playerCount: size, startingLife: 40 });
    for (let seatId = 1; seatId < size; seatId += 1) service.claimSeat(code, ids[seatId], { seatId });

    const room = () => service.room(code);
    const act = (method, input, seatId = 0) =>
      service[method](code, ids[seatId], { ...input, baseVersion: room().version });
    return {
      start() {
        if (room().gameResult) {
          act('beginIntermission');
          for (let seatId = 0; seatId < size; seatId += 1) act('setNextGameReady', { ready: true }, seatId);
        }
        act('startGame');
      },
      adjust(seatId, counter, delta, extra) { act('adjustOwnSeat', { counter, delta, ...extra }, seatId); },
      finish(winnerSeatId = 0) {
        now += 12 * MINUTE;
        act('declareWinner', { winnerSeatId });
        const gameId = room().gameId;
        return {
          completion: (seatId) => service.completedSeat(code, ids[seatId], gameId),
          cards: () => ids.map(connectionId => service.personalMatchMoment(code, connectionId, [], gameId).moment),
        };
      },
    };
  }

  return {
    table, history,
    accounts: size => Promise.all(Array.from({ length: size }, (_, seatId) => history.ensureAccount('player-' + seatId))),
    save: (accountId, game, seatId) => history.saveCompletedGame(accountId, game.completion(seatId)),
  };
}

function assertDistinctCards(cards, context) {
  for (const [seatId, card] of cards.entries()) {
    assert.equal(card?.kind, 'accolade', context + ' seat ' + seatId);
    assert.ok(card.id && card.title && card.fact, context + ' must show a named accolade with a fact');
  }
  assert.equal(new Set(cards.map(card => card.id)).size, cards.length, context + ' must not repeat an accolade');
  assert.equal(new Set(cards.map(card => card.title)).size, cards.length, context + ' must not repeat the displayed title');
}

function commanderPressure(table, targetSeatId) {
  for (let opponent = 0; opponent < 4; opponent += 1) {
    if (opponent === targetSeatId) continue;
    table.adjust(targetSeatId, 'commanderDamage', 10, { commanderSourceId: 'seat-' + opponent + '-commander-a' });
  }
}

test('an eight-player quiet finish gives each seat a distinct accolade and saves the verified result', async () => {
  const f = fixture();
  const table = f.table(8);
  const accounts = await f.accounts(8);
  table.start();
  const game = table.finish();
  const saved = await Promise.all(accounts.map((account, seatId) => f.save(account, game, seatId)));

  assertDistinctCards(game.cards(), 'The room');
  assertDistinctCards(saved.map(result => result.moment), 'Profile saves');
  for (const [seatId, result] of saved.entries()) {
    assert.equal(result.game.accoladeId, result.moment.id);
    assert.equal(result.game.tableSize, 8);
    assert.equal(result.game.won, seatId === 0);
    assert.equal(result.game.achievementFacts.durationMs, 12 * MINUTE);
    assert.equal(result.game.achievementFacts.turnCount, 0);
    assert.deepEqual(result.game.counterTotals, { poison: 0, energy: 0, radiation: 0, commanderDamage: 0 });
    assert.ok(!['phoenix-return', 'full-court', 'quick-study', 'late-chapter'].includes(result.moment.id));
  }
});

test('sixteen quiet games at a full eight-seat table rotate cards past the last five for each profile', async () => {
  const f = fixture();
  const table = f.table(8);
  const accounts = await f.accounts(8);
  const games = [];
  for (let number = 0; number < 16; number += 1) {
    table.start();
    const game = table.finish();
    games.push(await Promise.all(accounts.map((account, seatId) => f.save(account, game, seatId))));
  }

  for (const [index, results] of games.entries()) {
    assertDistinctCards(results.map(result => result.moment), 'Game ' + (index + 1));
  }
  for (const [seatId, accountId] of accounts.entries()) {
    const ids = games.map(results => results[seatId].game.accoladeId);
    for (const [index, id] of ids.entries()) {
      assert.ok(!ids.slice(Math.max(0, index - 5), index).includes(id), 'seat ' + seatId + ' should get a fresh card in game ' + (index + 1));
    }
    const profile = await f.history.summary(accountId);
    assert.equal(profile.gamesPlayed, games.length);
    assert.deepEqual(profile.games.map(game => game.accoladeId).reverse(), ids);
  }
});

test('profile history cannot make two seats choose the same standout accolade', async () => {
  const f = fixture();
  const accounts = await f.accounts(4);

  const prior = f.table(4);
  prior.start();
  commanderPressure(prior, 2);
  await f.save(accounts[2], prior.finish(), 2);

  const contested = f.table(4);
  contested.start();
  contested.adjust(1, 'life', -36);
  contested.adjust(1, 'life', 15);
  commanderPressure(contested, 2);
  contested.adjust(2, 'life', -6);
  contested.adjust(2, 'life', 15);
  const game = contested.finish();
  const [first, second] = await Promise.all([f.save(accounts[1], game, 1), f.save(accounts[2], game, 2)]);

  assert.equal(first.game.achievementFacts.lifeGainedAfterLow, 15);
  assert.equal(second.game.achievementFacts.lifeGainedAfterLow, 15);
  assert.equal(second.game.achievementFacts.everyOpponentCommanderAt10, 1);
  assertDistinctCards([first.moment, second.moment], 'Contested profile saves');
});

test('a save retry retains the earned card and does not release achievements again', async () => {
  const f = fixture();
  const [account] = await f.accounts(1);
  const table = f.table(4);
  table.start();
  commanderPressure(table, 1);
  const game = table.finish();
  const first = await f.save(account, game, 1);
  const repeated = await f.save(account, game, 1);

  assert.ok(first.moment.id);
  assert.ok(first.unlockedAchievements.length > 0);
  assert.deepEqual(repeated.moment, first.moment);
  assert.equal(repeated.game.gameId, first.game.gameId);
  assert.deepEqual(repeated.unlockedAchievements, []);
  assert.equal((await f.history.summary(account)).gamesPlayed, 1);
});
