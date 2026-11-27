// Only the trusted server knows which game achievements may be used.
export const STUDIO_REWARD_LIMIT = 12;

export function validStudioRewardRule(rule) {
  return rule !== null && typeof rule === 'object' && !Array.isArray(rule)
    && Object.keys(rule).length === 1 && Object.hasOwn(rule, 'allOf')
    && Array.isArray(rule.allOf) && rule.allOf.length >= 1 && rule.allOf.length <= STUDIO_REWARD_LIMIT
    && new Set(rule.allOf).size === rule.allOf.length
    && rule.allOf.every(id => typeof id === 'string' && id.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id));
}
