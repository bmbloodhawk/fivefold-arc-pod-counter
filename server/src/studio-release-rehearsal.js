import { PRISMATIC_PATH_ACHIEVEMENT, PRISMATIC_PREREQUISITES } from './appearance-milestones.js';
import { AccountHistory, MemoryAccountHistoryStore } from './account-history.js';
import { describeStudioRewards } from './studio-reward-rules.js';

// Run the same entitlement decision that protects the game's owned-skin API,
// against isolated accounts. This never reads or writes a player's history.
export async function rehearseRewardAccess({skin,rewardRule}) {
  const store=new MemoryAccountHistoryStore(), history=new AccountHistory({store});
  const releases=describeStudioRewards([{skin,rewardRule,activatedAt:Date.now()}]);
  // Every real signed-in account already has Account Awakened. The Prismatic
  // Path is computed from its five real badges, including for migrated players.
  const evidence = [...new Set(rewardRule.allOf.flatMap(step => step === PRISMATIC_PATH_ACHIEVEMENT.id
    ? PRISMATIC_PREREQUISITES.map(item => item.id) : [step]))].filter(id => id !== 'account-awakened');
  const scenarios = evidence.length ? [
    {name:'locked', awards:[], owned:false},
    {name:'one missing', awards:evidence.slice(0,-1), owned:false},
    {name:'earned', awards:evidence, owned:true},
    {name:'prior owner', awards:[], grant:true, owned:true},
  ] : [
    {name:'signed out', anonymous:true, owned:false},
    {name:'earned on account creation', awards:[], owned:true},
    {name:'prior owner', awards:[], grant:true, owned:true},
  ];
  for (const fixture of scenarios) {
    if (fixture.anonymous) {
      if ((await history.studioSkinChoices('missing-account', releases)).length) throw new Error('Signed-out reward check failed.');
      continue;
    }
    const id=await history.ensureAccount('release-rehearsal-'+fixture.name);
    const awards=Object.fromEntries(fixture.awards.map(step=>[step,{gameId:'fixture',earnedAt:1,ruleVersion:1}]));
    await store.write('account-history/verified-progress/'+id+'.json',{awards,games:{}});
    if (fixture.grant) await history.grantSkin(id,skin.id);
    const [choice]=await history.studioSkinChoices(id,releases);
    if (!choice || (choice.state!=='locked')!==fixture.owned) throw new Error('Reward check failed for '+fixture.name+'.');
    if (fixture.name === 'one missing' && choice.progress.filter(step => !step.earned).length > 1) fixture.name = 'partial progress';
  }
  return scenarios.map(x=>x.name);
}
