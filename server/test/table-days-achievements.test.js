import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountHistory, MemoryAccountHistoryStore } from '../src/account-history.js';

const DAY = 86_400_000;
const START = Date.UTC(2026, 0, 1, 12);
const FIRST_TIER = 'long-table-days-1';
const awardIds = result => result.unlockedAchievements.map(award => award.id);

async function fixture() {
  let sequence = 0;
  let now = START;
  const store = new MemoryAccountHistoryStore();
  const history = new AccountHistory({ store, now: () => now });
  const account = await history.ensureAccount('fixture-account');
  function completion(date) {
    const completedAt = START + (date - 1) * DAY;
    return {
      gameId: 'fixture-game-' + (++sequence),
      seatId: 1,
      tableIdentity: 'fixture-table',
      startedAt: completedAt - 30 * 60_000,
      completedAt,
      sessionKind: 'standard',
      game: { tableSize: 4, won: false, achievementFacts: { durationMs: 30 * 60_000 } },
      moments: [{ id: 'arc-complete', kind: 'accolade', title: 'Arc Complete' }],
    };
  }
  async function save(date, savedDate = date) {
    now = START + (savedDate - 1) * DAY;
    return history.saveCompletedGame(account, completion(date));
  }
  return { history, store, account, completion, save, setNow: value => { now = value; } };
}

test('the first table-days achievement needs 50 distinct verified completion dates', async () => {
  const f = await fixture();
  for (let day = 1; day <= 49; day++) {
    assert.ok(!awardIds(await f.save(day)).includes(FIRST_TIER));
  }
  // Saving an older game on the next date cannot add another completion day.
  assert.ok(!awardIds(await f.save(49, 50)).includes(FIRST_TIER));
  const onDay50 = f.completion(50);
  assert.ok(awardIds(await f.history.saveCompletedGame(f.account, onDay50)).includes(FIRST_TIER));
  assert.deepEqual((await f.history.saveCompletedGame(f.account, onDay50)).unlockedAchievements, []);
  assert.ok(!awardIds(await f.save(51)).includes(FIRST_TIER));
  assert.equal((await f.history.summary(f.account)).achievements.filter(award => award.id === FIRST_TIER).length, 1);
});

test('all table-days tiers release at their verified date thresholds and record the measured evidence', async () => {
  const f = await fixture();
  const accountPath = 'account-history/accounts/' + encodeURIComponent(f.account) + '.json';
  const account = await f.store.read(accountPath);
  const otherTracks = ['chronicle', 'crowns', 'deck-mastery', 'deck-victory', 'resilience', 'endurance'];
  await f.store.write(accountPath, {
    ...account,
    longTermAchievementIds: otherTracks.flatMap(track => Array.from({ length: 10 }, (_, index) => 'long-' + track + '-' + (index + 1))),
  });
  const thresholds = [50, 100, 125, 150, 175, 200, 225, 250, 275, 300, 325, 350, 450, 500, 550, 600, 650, 750, 1000];
  for (let day = 1; day <= 1001; day++) {
    const index = thresholds.indexOf(day);
    const result = await f.save(day);
    const earned = awardIds(result).filter(id => id.startsWith('long-table-days-'));
    assert.deepEqual(earned, index < 0 ? [] : ['long-table-days-' + (index + 1)], 'completion day ' + day);
  }
  const progress = await f.store.read('account-history/verified-progress/' + encodeURIComponent(f.account) + '.json');
  for (const [index, threshold] of thresholds.entries()) {
    const evidence = progress.awards['long-table-days-' + (index + 1)];
    assert.equal(evidence.target, threshold);
    assert.equal(evidence.measured, threshold);
    assert.ok(evidence.gameId && evidence.ruleVersion);
  }
});

test('legacy saves and another profile do not supply verified table days', async () => {
  const f = await fixture();
  for (let day = 0; day < 50; day++) {
    f.setNow(START + day * DAY);
    await f.history.saveGame(f.account, { tableSize: 4, won: false });
  }
  const saved = await f.save(51);
  assert.ok(!awardIds(saved).includes(FIRST_TIER));
  assert.equal((await f.history.summary(f.account)).gamesPlayed, 51);
  const other = await f.history.ensureAccount('other-fixture-account');
  assert.ok(!awardIds(await f.history.saveCompletedGame(other, f.completion(52))).includes(FIRST_TIER));
});
