import { createHash } from 'node:crypto';
import {
  appearanceAssetReferences,
  assertAppearanceValid,
  publicAppearanceSkin,
  validateAppearanceSkin,
} from '../../client/appearance-validation.js';
import { checkedAsset, checkPublishedDraft } from './appearance-studio-boundary.js';
import { isAchievementSkin, isInvitationSkin } from './appearance-collection.js';
import { validateStudioRewardRule } from './studio-reward-rules.js';

export const MAX_RELEASE_BYTES = 8 * 1024 * 1024;
export const releaseError = (message, status = 400) =>
  Object.assign(new Error(message), { status, code: 'STUDIO_RELEASE' });
export const validDigest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function digestOf(body) {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

export async function buildSkinRelease(skin, catalog, readAsset, restrictedSkins) {
  if (!skin) throw releaseError('Choose a saved reward draft.');
  // Authoring history can refer to superseded or retired artwork. Only the
  // selected revision is reviewed, packaged and made available to players.
  const { versions, ...current } = skin;
  await checkPublishedDraft(current, catalog, readAsset, { restrictedSkins, rewardRelease: true });
  const visual = publicAppearanceSkin(current);
  const assetIds = [...new Set(appearanceAssetReferences(visual).map((ref) => ref.id))].sort();
  const assets = await Promise.all(
    assetIds.map(async (id) => {
      const meta = catalog.assets.find((row) => row.id === id);
      const stored = meta.data ? meta : await readAsset(id);
      return checkedAsset({ ...stored, ...meta, data: stored.data }, id);
    })
  );
  const body = {
    format: 'fivefold-reward-skin',
    version: 1,
    skin: visual,
    rewardRule: validateStudioRewardRule(skin.rewardRule),
    assets,
  };
  return checkedRelease({ digest: digestOf(body), body });
}

export function checkedRelease(envelope) {
  const body = envelope?.body;
  if (
    !body ||
    body.format !== 'fivefold-reward-skin' ||
    body.version !== 1 ||
    !validDigest(envelope.digest) ||
    Object.keys(body).some((key) => !['version', 'format', 'skin', 'rewardRule', 'assets'].includes(key)) ||
    Object.keys(envelope).some((key) => !['digest', 'body'].includes(key)) ||
    Buffer.byteLength(JSON.stringify(envelope)) > MAX_RELEASE_BYTES ||
    digestOf(body) !== envelope.digest
  ) {
    throw releaseError('Choose an intact single-skin Studio release, up to 8 MiB.');
  }
  const { skin, assets } = body;
  if (
    !/^skin-[A-Za-z0-9_-]{1,75}$/.test(skin?.id || '') ||
    isAchievementSkin(skin.id) ||
    isInvitationSkin(skin.id) ||
    !skin.name?.trim() ||
    skin.rendererVersion !== 2 ||
    !Array.isArray(assets) ||
    assets.length > 100
  ) {
    throw releaseError('A release needs its own named expanded-renderer skin.');
  }
  const visual = publicAppearanceSkin(skin);
  if (Object.keys(skin).some((key) => !Object.hasOwn(visual, key)))
    throw releaseError('Release files may contain visual settings only.');
  validateStudioRewardRule(body.rewardRule);
  assertAppearanceValid(validateAppearanceSkin(skin, { assets, publish: true, requireApprovedAssets: true }));
  const required = new Set(appearanceAssetReferences(skin).map((ref) => ref.id));
  if (assets.length !== required.size) throw releaseError('Include exactly the artwork this version uses.');
  for (const asset of assets) {
    if (!required.delete(asset?.id) || asset.status !== 'Approved')
      throw releaseError('Each referenced image needs one approved library entry.');
    checkedAsset(asset, asset.id);
  }
  return envelope;
}
