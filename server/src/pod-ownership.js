import { competitionError } from './competition-values.js';

const activeAdmin = member => member?.status === 'active' && member.role === 'admin';
const review = () => ({ ownerId:null, nextOwnerId:null, needsReview:true, tenures:new Map() });

// The old format did not record a creator. Only a Pod with one member record
// has structural evidence of its creator; join timestamps cannot prove it.
function legacyOwnership(scope) {
  const members=Object.values(scope.members).filter(member=>member.kind==='member');
  if (members.length!==1 || !Number.isFinite(members[0].joinedAt)) return null;
  const owner=members[0];
  return {ownerId:owner.id,tenures:new Map([[owner.id,{order:0,since:owner.joinedAt}]])};
}

export function podOwnership(scope,directory) {
  const eligible=Object.values(scope.members).filter(member=>activeAdmin(member) && directory.identities[member.identityId]);
  const legacy=scope.ownerId===undefined?legacyOwnership(scope):null;
  if (scope.ownerId===undefined && !legacy) return review();
  const tenures=legacy?.tenures || new Map(eligible.map(member=>[member.id,{order:member.adminOrder,since:member.adminSince}]));
  const orders=new Set();
  for (const member of eligible) {
    const tenure=tenures.get(member.id);
    if (!Number.isSafeInteger(tenure?.order) || tenure.order<0 || !Number.isFinite(tenure.since) || orders.has(tenure.order)) return review();
    orders.add(tenure.order);
  }
  const ranked=eligible.sort((a,b)=>tenures.get(a.id).order-tenures.get(b.id).order);
  const storedOwner=scope.ownerId ?? legacy?.ownerId;
  const owner=scope.members[storedOwner];
  // Account erasure removes eligibility. An existing admin may inherit, but an
  // ordinary member never acquires admin rights through vacancy or a race.
  if (!activeAdmin(owner)) return review();
  if (!directory.identities[owner.identityId] && !directory.erasedIdentities?.[owner.identityId]) return review();
  const ownerId=ranked.some(member=>member.id===storedOwner)?storedOwner:ranked[0]?.id || null;
  return {ownerId,nextOwnerId:ranked.find(member=>member.id!==ownerId)?.id || null,needsReview:!ownerId,tenures};
}

export function applyPodOwnership(scope,policy) {
  if (!policy.ownerId) return false;
  let changed=scope.ownerId!==policy.ownerId;
  scope.ownerId=policy.ownerId;
  for (const [id,tenure] of policy.tenures) {
    const member=scope.members[id];
    if (!activeAdmin(member)) continue;
    changed ||= member.adminOrder!==tenure.order || member.adminSince!==tenure.since;
    member.adminOrder=tenure.order; member.adminSince=tenure.since;
  }
  return changed;
}

export function requirePodOwner(policy,memberId) {
  if (policy.needsReview) throw competitionError('This Pod needs an ownership review before changing admins or deleting it.',409,'POD_OWNERSHIP_REVIEW_REQUIRED');
  if (policy.ownerId!==memberId) throw competitionError('Only the Pod owner can do that.',403,'POD_OWNER_REQUIRED');
}
