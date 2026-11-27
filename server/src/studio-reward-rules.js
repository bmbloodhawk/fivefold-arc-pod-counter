import { validStudioRewardRule } from '../../client/studio-reward-rule.js';
import { studioAchievementCatalog } from './account-history.js';
import { isAchievementSkin, isInvitationSkin } from './appearance-collection.js';

const catalog = new Map(studioAchievementCatalog.map(achievement => [achievement.id, achievement]));
const invalid = message => Object.assign(new TypeError(message), {status: 400, code: 'APPEARANCE_INVALID'});

export function validateStudioRewardRule(rule) {
  if (!validStudioRewardRule(rule) || !rule.allOf.every(id => catalog.has(id))) {
    throw invalid('Choose one to twelve distinct achievements from the game achievement list.');
  }
  return {allOf: [...rule.allOf]};
}

export function describeStudioRewards(entries) {
  const ids = new Set();
  return entries.map(({skin, loadSkin, rewardRule, rewardHistory = [], activatedAt}) => {
    const id = skin?.id;
    if (typeof id !== 'string' || !/^skin-[A-Za-z0-9_-]{1,75}$/.test(id) || ids.has(id) || isAchievementSkin(id) || isInvitationSkin(id)) {
      throw invalid('Each Studio reward needs its own skin ID.');
    }
    ids.add(id);
    const rule = validateStudioRewardRule(rewardRule);
    const previous = rewardHistory.map(({rewardRule: prior, activatedAt: start, retiredAt: end}) => {
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
        throw invalid('The previous reward release dates are invalid.');
      }
      return {rewardRule: validateStudioRewardRule(prior), activatedAt: start, retiredAt: end};
    });
    if (!Number.isSafeInteger(activatedAt) || activatedAt < 0 || previous.some(row => row.retiredAt > activatedAt)) {
      throw invalid('The reward release date is invalid.');
    }
    const prerequisites = rule.allOf.map(step => catalog.get(step));
    const achievement = {
      id: 'studio-' + id, title: skin.name, rarity: 'rare',
      detail: 'Earn ' + prerequisites.map(step => step.title).join(', ') + '.',
    };
    return {skin, loadSkin, id, achievement, prerequisites, rewardRule: rule, rewardHistory: previous, activatedAt};
  });
}

// Authorize the account or the live seat before reading the immutable artwork.
export async function studioRewardArtwork(release) {
  const skin = release.loadSkin ? await release.loadSkin() : release.skin;
  if (skin?.id !== release.id) throw invalid('Reward artwork does not match the authorized skin.');
  return {...skin, achievement: release.achievement};
}
