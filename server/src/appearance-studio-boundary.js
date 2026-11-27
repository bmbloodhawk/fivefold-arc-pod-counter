import { validateStudioRewardRule } from './studio-reward-rules.js';
import { appearanceAssetReferences, assertAppearanceValid, inspectImageData, publicAppearanceSkin, validateAppearanceAsset, validateAppearanceCatalog, validateAppearanceSkin } from '../../client/appearance-validation.js';
import { isAchievementSkin, isInvitationSkin } from './appearance-collection.js';
import { sameAppearanceAssetContent } from './appearance-catalog.js';

const reservedAssetIds = skin => skin.reservedAssetIds ?? appearanceAssetReferences(skin).map(ref => ref.id);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const invalid = message => Object.assign(new TypeError(message), { status: 400, code: 'APPEARANCE_INVALID' });
export function assetMetadata(value) { const { data, pendingUpload, ...metadata } = value; return metadata; }
export function checkAppearanceRevision(revision, catalog) {
  if (revision != null && (!Number.isSafeInteger(revision) || revision < 0)) throw invalid('The expected catalog revision is invalid. Reload Appearance Studio.');
  if ((revision ?? 0) !== (catalog.revision ?? 0)) throw Object.assign(new Error('The catalog changed in another Studio tab. Reload the latest catalog and reapply the unsaved draft before saving.'), { status: 409, code: 'APPEARANCE_CONFLICT' });
}
export function checkedAsset(value, id) {
  assertAppearanceValid(validateAppearanceAsset(value, { requireData: true }));
  if (value.id !== id) throw invalid('The asset ID must match its protected storage path.');
  return { ...assetMetadata(value), ...inspectImageData(value.data), status: value.status || 'Pending', data: value.data };
}
export function isRestrictedAppearanceSource(skin, catalog, { rewardRelease = false, reservedSkins = [] } = {}) {
  const seen = new Set();
  let current = skin;
  const otherReserved = rewardRelease ? reservedSkins.filter(item => item.id !== skin.id) : reservedSkins;
  const reservedAssets = new Set(otherReserved.flatMap(reservedAssetIds));
  while (current) {
    if (seen.has(current.id)) return true;
    if ((!rewardRelease || current.id !== skin.id) && reservedSkins.some(item => item.id === current.id)) return true;
    if (appearanceAssetReferences(current).some(ref => reservedAssets.has(ref.id))) return true;
    seen.add(current.id);
    if (isInvitationSkin(current.id) || isAchievementSkin(current.id)) return true;
    if (current.rewardRule && (!rewardRelease || current.id !== skin.id)) return true;
    if (current.access || current.invitation || current.achievement || current.grants) return true;
    const source = current.sourceSkinId;
    if (!source || source === '__neutral_arc__') return false;
    if (isInvitationSkin(source) || isAchievementSkin(source)) return true;
    current = (catalog.skins || []).find(row => row.id === source);
    if (!current) return true;
  }
  return false;
}
export async function checkedCatalogWrite(input, previous, readAsset) {
  checkAppearanceRevision(input?.revision, previous);
  assertAppearanceValid(validateAppearanceCatalog(input, { previous, mode: 'draft' }));
  for (const skin of input.skins) {
    // Approved legacy rows may predate structured versions; draft writes cannot change them.
    if (skin.status === 'Approved') continue;
    for (const row of [skin, ...(skin.versions || []).map(version => version?.appearance)]) {
      if (row?.rewardRule !== undefined) validateStudioRewardRule(row.rewardRule);
    }
  }
  const next = structuredClone(input), uploads = [];
  next.schemaVersion = 1;
  next.revision = (previous.revision ?? 0) + 1;
  delete next.exportedAt;
  for (const row of previous.skins || []) if (row.status === 'Approved') for (const reference of appearanceAssetReferences(row)) {
    if (previous.assets?.some(asset => asset.id === reference.id) && !next.assets.some(asset => asset.id === reference.id)) throw invalid('Artwork used by an approved skin cannot be removed. Import replacement artwork under a new ID.');
  }
  for (let index = 0; index < next.assets.length; index++) {
    const row = next.assets[index], prior = previous.assets?.find(item => item.id === row.id);
    if (prior && same(assetMetadata(prior), assetMetadata(row))) {
      if (row.data) { const stored = prior.data ? prior : await readAsset(row.id).catch(() => null); if (!sameAppearanceAssetContent(stored, row)) throw invalid(`Artwork “${row.id}” differs from its existing immutable image. Import it under a new asset ID.`); }
      next.assets[index] = structuredClone(prior); continue;
    }
    const stored = prior?.data ? prior : await readAsset(row.id).catch(() => null);
    if (!stored && !row.data) throw invalid(`Artwork “${row.id}” has no uploaded image. Import it before saving.`);
    const verified = checkedAsset(row.data ? row : stored, row.id);
    if (stored && !sameAppearanceAssetContent(stored, verified)) throw invalid(`Artwork “${row.id}” already has different image data or metadata. Import it under a new asset ID.`);
    if (row.status === 'Approved' || verified.status === 'Approved') throw invalid('New artwork must be saved Pending and explicitly approved after review.');
    const canonical = { ...verified, status: 'Pending' };
    if (!same(assetMetadata(checkedAsset({ ...row, data: verified.data, status: 'Pending' }, row.id)), assetMetadata(canonical))) throw invalid(`Artwork “${row.id}” metadata does not match its uploaded image.`);
    if (row.data && !stored) uploads.push(canonical);
    next.assets[index] = assetMetadata(canonical);
  }
  return { catalog: next, uploads };
}
export async function checkPublishedDraft(skin, catalog, readAsset, { restrictedSkins = [], rewardRelease = false } = {}) {
  if (!skin || skin.status !== 'Draft') throw invalid('Choose a saved Draft skin to publish. Approved skins remain unchanged.');
  if (skin.id === '__neutral_arc__' || isRestrictedAppearanceSource(skin, catalog, { rewardRelease, reservedSkins: restrictedSkins })) throw invalid('This skin is built in or derives from restricted invitation or achievement material. Keep it private; its access policy cannot be widened by publication.');
  const sourceSkin = catalog.skins.find(item => item.id === skin.sourceSkinId);
  assertAppearanceValid(validateAppearanceSkin(skin, { assets: catalog.assets, requireApprovedAssets: true, publish: true, sourceSkin }));
  const restrictedAssets = new Set([...(catalog.skins || []), ...restrictedSkins].filter(row => (!rewardRelease || row.id !== skin.id) && isRestrictedAppearanceSource(row, catalog)).flatMap(row => appearanceAssetReferences(row).map(reference => reference.id)));
  for (const reference of appearanceAssetReferences(skin)) {
    if (restrictedAssets.has(reference.id)) throw invalid('This artwork belongs to a restricted invitation or achievement skin. Use independently approved artwork before public publication.');
    const row = catalog.assets.find(asset => asset.id === reference.id);
    if (!row) throw invalid(`Artwork “${reference.id}” is missing from this catalog. Choose an existing image or restore it before publishing.`);
    const stored = row.data ? row : await readAsset(row.id).catch(() => null);
    if (!stored) throw invalid(`Artwork “${row.id}” is missing from protected storage. Import it again.`);
    checkedAsset(stored, row.id);
    if (row.status && row.status !== 'Approved') throw invalid('Review and approve every referenced asset before publishing.');
  }
}
export function checkedPreviewSkin(skin) {
  assertAppearanceValid(validateAppearanceSkin(skin, { preview: true }));
  if (skin.useGameBase === false) throw invalid('Exact previews must use the normal game renderer baseline.');
  return publicAppearanceSkin(skin, { preview: true });
}
export { invalid as appearanceInputError };
