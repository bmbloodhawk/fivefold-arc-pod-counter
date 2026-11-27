import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountHistory, MemoryAccountHistoryStore } from '../src/account-history.js';
import { APPEARANCE_ACHIEVEMENTS, DEEP_NIGHT_ACHIEVEMENT, PRISMATIC_PATH_ACHIEVEMENT, PRISMATIC_PREREQUISITES } from '../src/appearance-milestones.js';
import { describeStudioRewards, validateStudioRewardRule } from '../src/studio-reward-rules.js';
import { rehearseRewardAccess } from '../src/studio-release-rehearsal.js';
import { publicAppearanceSkin } from '../../client/appearance-validation.js';

const skin = {id:'skin-test-cloister',name:'Cloister'};
const rule = {allOf:['ten-crowns','table-regular']};

test('only unique, existing game achievements can become a Studio release rule', () => {
  for (const invalid of [{allOf:[]},{allOf:['not-an-achievement']},{allOf:['first-crown','first-crown']},
    {allOf:['first-crown'], grant:true},{anyOf:['first-crown']},{allOf:'first-crown'}]) {
    assert.throws(() => validateStudioRewardRule(invalid),{code:'APPEARANCE_INVALID'});
  }
  assert.deepEqual(validateStudioRewardRule(rule), rule);
  assert.equal(publicAppearanceSkin({...skin,rewardRule:rule}).rewardRule, undefined);
});

test('release rehearsals reflect automatic and composite achievements', async () => {
  const one = await rehearseRewardAccess({skin, rewardRule:{allOf:['account-awakened']}});
  assert.deepEqual(one,['signed out','earned on account creation','prior owner']);
  for (const allOf of [['first-chronicle','account-awakened'],[PRISMATIC_PATH_ACHIEVEMENT.id],
    [PRISMATIC_PATH_ACHIEVEMENT.id, ...PRISMATIC_PREREQUISITES.map(step=>step.id)]]) {
    const results = await rehearseRewardAccess({skin,rewardRule:{allOf}});
    assert.equal(results[0],'locked'); assert.equal(results.at(-2),'earned');
    assert.equal(results.at(-1),'prior owner'); assert.equal(results.length,4);
  }
});

test('prior Studio eligibility from pre-ledger games is bounded by retirement and retained after deletion', async () => {
  const store = new MemoryAccountHistoryStore();
  const history = new AccountHistory({store,now:()=>100});
  const releases = describeStudioRewards([{skin, rewardRule:rule, activatedAt:80,
    rewardHistory:[{rewardRule:{allOf:['first-crown']}, activatedAt:50, retiredAt:80}]}]);
  for (const [date, state] of [[79,'unlocked'],[80,'locked']]) {
    const id = await history.ensureAccount('player-' + date);
    await store.update('account-history/accounts/'+id+'.json', a=>({...a,createdAt:10}));
    const path = 'account-history/games/'+id+'.json';
    await store.write(path,{one:{gameId:'game_one',savedAt:date,won:true,tableSize:2}});
    const [choice] = await history.studioSkinChoices(id, releases);
    assert.equal(choice.state,state);
    await store.write(path,null);
    assert.equal((await history.studioSkinChoices(id,releases))[0].state,state);
  }
});

test('Studio rules recognize every legacy profile appearance award and require verified Commander milestones', async () => {
  const store = new MemoryAccountHistoryStore(), history = new AccountHistory({store, now: () => 100});
  const id = await history.ensureAccount('historical-owner');
  const appearanceIds = Object.values(APPEARANCE_ACHIEVEMENTS).map(achievement => achievement.id);
  const evidenceRequired = [...PRISMATIC_PREREQUISITES.map(achievement => achievement.id), DEEP_NIGHT_ACHIEVEMENT.id];
  const badges = [...appearanceIds, ...evidenceRequired];
  await store.update('account-history/accounts/' + id + '.json', account => ({
    ...account, createdAt: 10, longTermAchievementIds: badges,
  }));
  const releases = describeStudioRewards(badges.map(badge => ({
    skin: {id: 'skin-test-' + badge, name: 'Test'}, rewardRule: {allOf: [badge]}, activatedAt: 50,
  })));
  const builtIn = await history.earnedSkinAwards(id, badges);
  const choices = await history.studioSkinChoices(id, releases);
  for (const choice of choices) {
    const step = choice.progress[0];
    assert.equal(step.earned, Boolean(builtIn[step.id]), step.id);
    assert.equal(step.earned, appearanceIds.includes(step.id), step.id);
  }
  const revised = describeStudioRewards([{skin, rewardRule: rule, activatedAt: 70,
    rewardHistory: [{rewardRule: {allOf: appearanceIds}, activatedAt: 50, retiredAt: 70}]}]);
  assert.equal((await history.studioSkinChoices(id, revised))[0].state, 'unlocked');
});
