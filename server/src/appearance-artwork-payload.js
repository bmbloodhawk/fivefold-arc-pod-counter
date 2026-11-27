import { publicAppearanceSkin } from '../../client/appearance-validation.js';
import { hydrateDesignArtwork } from '../../client/appearance-design-artwork.js';
import { parseCollectionVisual, parseCollectionArtwork } from '../../client/collection-visual.js';
import { checkedAsset } from './appearance-studio-boundary.js';

export async function materializeEarnedAppearanceSkin(skin, appearanceCatalog) {
  if (skin.bundledAppearance) return { ...skin.bundledAppearance, achievement: skin.achievement };
  if (!skin.surfaceArt && !skin.counterDesign && skin.rendererVersion !== 2) return skin;
  return materializeAppearanceSkin(skin, await appearanceCatalog.read(), id => appearanceCatalog.readAsset(id), { collection: true });
}

// Authorization happens in the route before this helper is called. Only
// approved, role-matched IDs may resolve into inert raster data on the DTO.
export async function materializeAppearanceSkin(storedSkin, catalog, readAsset, { collection = false } = {}) {
  if (collection && !storedSkin.surfaceArt && !storedSkin.counterDesign && storedSkin.rendererVersion !== 2) return storedSkin;
  const skin = publicAppearanceSkin(storedSkin), resolved = new Map();
  delete skin.surfaceArtData; delete skin.counterArtData; delete skin.counterRingArtData;
  if (collection) {
    const visual = parseCollectionVisual(storedSkin.visual), artwork = parseCollectionArtwork(storedSkin.artwork);
    if (visual) skin.visual = visual;
    if (artwork) skin.artwork = artwork;
    if (storedSkin.achievement) skin.achievement = storedSkin.achievement;
  }
  const assetData = async (id, roles) => {
    const metadata = catalog.assets?.find(item => item.id === id);
    if (!id || !metadata || !roles.includes(metadata.placement) || (metadata.status && metadata.status !== 'Approved')) return '';
    if (!resolved.has(id)) resolved.set(id, (async () => {
      try { return checkedAsset(metadata.data ? metadata : await readAsset(id), id).data; }
      catch { return ''; }
    })());
    return resolved.get(id);
  };
  const overlays = async values => Object.fromEntries(await Promise.all(Object.entries(values || {}).map(async ([slot, id]) => [slot, await assetData(id, slot === 'dial' ? ['overlay', 'background', 'dial'] : ['overlay', 'background', 'panel'])])));
  const symbolData = Object.fromEntries(await Promise.all(Object.entries(skin.symbolAssets || {}).map(async ([mode, id]) => [mode, await assetData(id, ['symbol'])])));
  for (const layout of Object.values(skin.modeLayouts || {})) layout.overlayData = await overlays(layout.overlays);
  return { ...skin, backgroundData: await assetData(skin.backgroundAsset, ['background']), sealData: await assetData(skin.sealAsset, ['symbol', 'seal']), buttonData: await assetData(skin.buttonAsset, ['button']), symbolData, overlayData: await overlays(skin.overlays), ...await hydrateDesignArtwork(skin, assetData) };
}
