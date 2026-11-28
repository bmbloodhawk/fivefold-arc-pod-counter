import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { AccountHistory, MemoryAccountHistoryStore, studioAchievementCatalog } from '../src/account-history.js';
import { beginExplorationCommission, advanceExplorationCommission, explorationCommissionProgress, EXPLORATION_COMMISSION } from '../src/exploration-commission.js';
import eligibility from '../static-data/star-trek-commanders.v1.json' with { type: 'json' };
import { describeStudioRewards } from '../src/studio-reward-rules.js';
import { startingCommanderEvidenceFor } from '../src/starting-commander-evidence.js';
import { APPEARANCE_ACHIEVEMENTS, NIGHT_WATCH_REWARD, PRISMATIC_PATH_ACHIEVEMENT } from '../src/appearance-milestones.js';

const DAY = 86_400_000;
const START = Date.UTC(2026, 10, 20, 12);
const native = eligibility.cards.filter(card => card.eligibleNames.includes(card.name));
const [a, b] = native;
function evidence(cards = [a]) {
  return {schemaVersion: 1, eligibilityVersion: eligibility.version, resolved: true,
    cards: cards.map(card => ({identity: 'oracle:' + card.oracleId, oracleId: card.oracleId, name: card.name, matchedName: card.eligibleNames[0]}))};
}
function completion(id = 'one', at = START + 1000, cards = [a], turns = 9) {
  return {gameId: id, seatId: 0, tableIdentity: 'table', sessionKind: 'standard', startedAt: at - 100,
    completedAt: at, moments: [], game: {gameFormat: 'commander', tableSize: 4, won: false,
      startingCommanderEvidence: evidence(cards), achievementFacts: {turnCount: turns, tableTurnNumber: 99}}};
}
function advance(mission, c) { return advanceExplorationCommission(mission, c, c.gameId); }

test('mission captures one named IANA timezone, rejects offsets, and reports three independent objectives', () => {
  for (const zone of ['+01:00', 'PST', '', 'Mars/Olympus', null]) assert.throws(() => beginExplorationCommission(zone, START));
  const mission = beginExplorationCommission('America/Los_Angeles', START);
  assert.deepEqual(explorationCommissionProgress(mission), {startedAt: START, timeZone: 'America/Los_Angeles', earnedAt: null, commanderVariety: 0, recordedTurns: 0, playDates: 0});
});

test('same pair, reversed order, aliases and repeated saves cannot fill two slots', () => {
  let mission = beginExplorationCommission('UTC', START);
  const pair = completion('pair', START + 1000, [a, b]);
  mission = advance(mission, pair);
  assert.equal(explorationCommissionProgress(mission).commanderVariety, 1);
  assert.strictEqual(advance(mission, pair), mission);
  mission = advance(mission, completion('reverse', START + DAY, [b, a]));
  assert.equal(explorationCommissionProgress(mission).commanderVariety, 1);
  mission = advance(mission, completion('single', START + 2 * DAY, [a]));
  assert.equal(explorationCommissionProgress(mission).commanderVariety, 2);
  assert.equal(explorationCommissionProgress(mission).recordedTurns, 25);
  assert.equal(explorationCommissionProgress(mission).playDates, 3);
  assert.equal(mission.earnedAt, START + 2 * DAY);
});

test('only eligible starting evidence and frozen personal turns count', () => {
  const start = beginExplorationCommission('UTC', START);
  const cases = [
    c => { c.sessionKind = 'practice'; },
    c => { c.game.gameFormat = 'casual'; },
    c => { delete c.game.startingCommanderEvidence; c.game.commanderName = a.name; },
    c => { c.game.startingCommanderEvidence.resolved = false; },
    c => { c.game.startingCommanderEvidence.cards[0].oracleId = 'unknown'; },
    c => { c.game.startingCommanderEvidence.cards[0].matchedName = 'A loose Trek guess'; },
    c => { c.startedAt = START - 1; },
    c => { c.completedAt = c.startedAt - 1; },
  ];
  for (const change of cases) { const c = completion(); change(c); assert.strictEqual(advance(start, c), start); }
  const c = completion('valid', START + 1000, [a], 2);
  c.game.commanderName = 'Changed during play';
  let mission = advance(start, c);
  assert.equal(explorationCommissionProgress(mission).recordedTurns, 2);
  const missingTurns = completion('no-turns', START + DAY, [b]);
  delete missingTurns.game.achievementFacts.turnCount;
  mission = advance(mission, missingTurns);
  assert.equal(explorationCommissionProgress(mission).recordedTurns, 2);
  assert.equal(explorationCommissionProgress(mission).commanderVariety, 2);
  assert.equal(mission.earnedAt, undefined);
});

test('completion instants determine fixed play dates across midnight and both DST transitions', () => {
  const dates = [
    ['2026-11-21T07:59:59Z', '2026-11-21T08:00:00Z', 2],
    ['2027-03-14T09:59:59Z', '2027-03-14T10:00:00Z', 1],
    ['2027-11-07T08:30:00Z', '2027-11-07T09:30:00Z', 1],
  ];
  for (const [first, second, count] of dates) {
    const start = Date.parse(first) - DAY;
    let mission = beginExplorationCommission('America/Los_Angeles', start);
    mission = advance(mission, completion('first', Date.parse(first)));
    mission = advance(mission, completion('second', Date.parse(second), [b]));
    assert.equal(explorationCommissionProgress(mission).playDates, count);
    assert.deepEqual(Object.values(mission.credits).map(credit => credit.playDate), count === 2 ? ['2026-11-20', '2026-11-21'] : [first.slice(0, 10), second.slice(0, 10)]);
  }
});

test('the original Studio achievement definitions and ordering remain byte-for-byte unchanged', () => {
  const original = studioAchievementCatalog.filter(item => item.id !== EXPLORATION_COMMISSION.id);
  assert.equal(original.length, 178);
  assert.equal(createHash('sha256').update(JSON.stringify(original)).digest('hex'), '33e5cdb701f0dbff83fa9e86d9dd1358b11cba8236a3578e4597e3944113dd00');
  assert.equal(studioAchievementCatalog.at(-1).id, EXPLORATION_COMMISSION.id);
});

async function fixture() {
  let now = START;
  const store = new MemoryAccountHistoryStore(), history = new AccountHistory({store, now: () => now});
  const account = await history.ensureAccount('explorer');
  return {store, history, account, setNow: value => {now = value;}};
}

test('all objectives award independently, duplicate concurrent saves are idempotent, and ownership survives history removal', async () => {
  const f = await fixture();
  await f.history.startExplorationCommission(f.account, 'America/Los_Angeles');
  const releases = describeStudioRewards([{skin: {id: 'skin-local-starship-test', name: 'Local starship test'},
    rewardRule: {allOf: [EXPLORATION_COMMISSION.id]}, activatedAt: START}]);
  const saved = [];
  for (let day = 0; day < 3; day++) {
    const c = completion('game-' + day, START + day * DAY + 1000, day === 1 ? [b] : [a]);
    f.setNow(START + 20 * DAY); // Delayed save never supplies the play date.
    const result = await f.history.saveCompletedGame(f.account, c, null, [], releases);
    saved.push(result.game.gameId);
    assert.equal(result.unlockedAchievements.some(item => item.id === EXPLORATION_COMMISSION.id), day === 2);
    if (day === 0) assert.ok(result.unlockedAchievements.some(item => item.id === 'first-chronicle'));
    const retries = await Promise.all(Array.from({length: 3}, () => f.history.saveCompletedGame(f.account, c, null, [], releases)));
    assert.ok(retries.every(result => result.unlockedAchievements.length === 0));
  }
  const before = (await f.history.summary(f.account)).explorationCommission;
  assert.deepEqual({...before, earnedAt: null}, {startedAt: START, timeZone: 'America/Los_Angeles', earnedAt: null, commanderVariety: 2, recordedTurns: 25, playDates: 3});
  assert.deepEqual(await f.history.startExplorationCommission(f.account, 'Pacific/Auckland'), before);
  assert.notEqual((await f.history.studioSkinChoices(f.account, releases))[0].state, 'locked');
  for (const id of saved) await f.history.removeGame(f.account, id);
  assert.deepEqual((await f.history.summary(f.account)).explorationCommission, before);
  assert.equal((await f.history.summary(f.account)).achievements.filter(item => item.id === EXPLORATION_COMMISSION.id).length, 1);
  assert.notEqual((await f.history.studioSkinChoices(f.account, releases))[0].state, 'locked');
});

test('manual and unsupported historical history never supplies mission credit', async () => {
  const f = await fixture();
  await f.history.saveGame(f.account, {tableSize: 4, won: true, commanderName: a.name, achievementFacts: {turnCount: 99}});
  await f.history.startExplorationCommission(f.account, 'UTC');
  const c = completion(); delete c.game.startingCommanderEvidence;
  await f.history.saveCompletedGame(f.account, c);
  assert.equal((await f.history.summary(f.account)).explorationCommission.recordedTurns, 0);
});

test('alias eligibility changes within one canonical pair retain all prior eligible identities', () => {
  const c = (names, id, day) => ({...completion(id, START + day * DAY + 1000),
    game: {...completion().game, startingCommanderEvidence: startingCommanderEvidenceFor(names)}});
  let mission = beginExplorationCommission('UTC', START);
  mission = advance(mission, c(['Tendi, Exploring the Future', 'Silas Renn, Seeker Adept'], 'a-only', 0));
  mission = advance(mission, c(['Thrasios, Triton Hero', 'Rutherford, Rebuilding the Past'], 'b-only', 1));
  assert.equal(explorationCommissionProgress(mission).commanderVariety, 1);
  mission = advance(mission, c(['Rutherford, Rebuilding the Past'], 'b-single', 2));
  assert.equal(explorationCommissionProgress(mission).commanderVariety, 2);
  assert.equal(mission.earnedAt, START + 2 * DAY + 1000);
});

test('mission enrollment does not consume, suppress, or reorder any existing award or ownership fixture', async () => {
  const stores = [new MemoryAccountHistoryStore(), new MemoryAccountHistoryStore()];
  let now = START;
  const histories = stores.map(store => {
    let id = 0;
    return new AccountHistory({store, now: () => now, createId: () => 'fixture-' + (++id)});
  });
  const accounts = await Promise.all(histories.map(history => history.ensureAccount('same-profile')));
  for (const [index, history] of histories.entries()) await history.grantSkin(accounts[index], 'skin-existing-owner');
  await histories[1].startExplorationCommission(accounts[1], 'UTC');
  const approved = [...Object.values(APPEARANCE_ACHIEVEMENTS).map(item => item.id), NIGHT_WATCH_REWARD.id, PRISMATIC_PATH_ACHIEVEMENT.id];
  for (let day = 0; day < 80; day++) {
    now = START + day * DAY + 2000;
    const c = completion('comparison-' + day, now - 1000, day % 2 ? [a] : [b], 9);
    c.game.won = day % 3 !== 0;
    c.game.achievementFacts = {...c.game.achievementFacts, lowestLife: 3, durationMs: 3_700_000};
    const results = await Promise.all(histories.map((history, index) => history.saveCompletedGame(accounts[index], c, null, approved)));
    assert.deepEqual(results[1].unlockedAchievements.filter(item => item.id !== EXPLORATION_COMMISSION.id), results[0].unlockedAchievements, 'game ' + day);
    assert.deepEqual(results[1].moment, results[0].moment);
  }
  const summaries = await Promise.all(histories.map((history, index) => history.summary(accounts[index])));
  assert.deepEqual(summaries[1].achievements.filter(item => item.id !== EXPLORATION_COMMISSION.id), summaries[0].achievements);
  const access = await Promise.all(histories.map((history, index) => history.skinAccess(accounts[index])));
  assert.deepEqual(access[0].grants, access[1].grants);
  const progress = await Promise.all(stores.map((store, index) => store.read('account-history/verified-progress/' + accounts[index] + '.json')));
  const {['exploration-commission']: missionAward, ...existingAwards} = progress[1].awards;
  assert.ok(missionAward);
  assert.deepEqual(existingAwards, progress[0].awards);
});
