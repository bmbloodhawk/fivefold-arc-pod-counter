import { PRISMATIC_PATH_ACHIEVEMENT, PRISMATIC_PREREQUISITES } from './appearance-milestones.js';

export function recordedAward(award) {
  return award?.historical === true || award?.evidenceRemoved === true
    || (typeof award?.gameId === 'string' && award.gameId.length > 0
      && Number.isFinite(award.earnedAt) && Number.isInteger(award.ruleVersion) && award.ruleVersion > 0);
}

// A legacy marker without a timestamp predates Studio releases. Newly minted
// historical and removed-source records carry a date for future rule revisions.
function earnedAt(account, awards, id) {
  if (id === PRISMATIC_PATH_ACHIEVEMENT.id) {
    return Math.max(...PRISMATIC_PREREQUISITES.map(step => earnedAt(account, awards, step.id)));
  }
  if (id === 'account-awakened' && Number.isFinite(account.createdAt)) return account.createdAt;
  const award = awards?.[id];
  if (recordedAward(award)) return Number.isFinite(award.earnedAt) ? award.earnedAt : 0;
  if (id.startsWith('long-') && Array.isArray(account.longTermAchievementIds) && account.longTermAchievementIds.includes(id)) {
    if (!Object.hasOwn(account.studioLongTermDates || {}, id)) return 0;
    const at = account.studioLongTermDates[id];
    return Number.isFinite(at) && at >= 0 ? at : Infinity;
  }
  return Infinity;
}

export function studioRewardStatus(account, progress, release, legacyAwardsAt) {
  const {id, skin, achievement, prerequisites, rewardRule, rewardHistory} = release;
  const steps = prerequisites.map(({id, title, detail}) => ({id, title, detail, earned: Number.isFinite(earnedAt(account, progress.awards, id))}));
  const current = steps.every(step => step.earned);
  const receipt = progress.studioSkinGrants?.[id];
  const explicit = Array.isArray(account.skinEntitlements) && account.skinEntitlements.some(grant =>
    grant?.skinId === id && ['grant','payment','achievement'].includes(grant.source) && Number.isFinite(grant.grantedAt));
  const granted = Number.isFinite(receipt?.earnedAt) || explicit;
  const past = !granted && !current && rewardHistory.some(({rewardRule: old, activatedAt, retiredAt}) =>
    activatedAt < retiredAt && Number.isFinite(account.createdAt) && account.createdAt < retiredAt && old.allOf.every(key => {
      if (earnedAt(account, progress.awards, key) < retiredAt) return true;
      return progress.awards?.[key]?.historical === true && legacyAwardsAt?.(retiredAt)?.[key]?.historical === true;
    }));
  const eligible = current || past || granted;
  const viewed = Array.isArray(account.seenAchievementIds) && rewardRule.allOf.every(key => account.seenAchievementIds.includes(key));
  const state = !eligible ? 'locked' : current && !viewed && !explicit ? 'new' : 'unlocked';
  return {needsReceipt: eligible && !granted, choice: {id, name: skin.name, achievement, state, progress: steps}};
}
