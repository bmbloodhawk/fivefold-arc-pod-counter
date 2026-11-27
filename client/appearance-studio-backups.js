export const BACKUP_METADATA_LIMIT = 8 * 1024 * 1024;
const MAX_SKINS = 100, MAX_ASSETS = 250, MAX_IMAGE_TEXT = 2_000_032;
// Coarse intake guard: every permitted image plus generous pretty-printed
// metadata/formatting room. Actual compact metadata and pixels are checked below.
export const PORTABLE_BACKUP_FILE_LIMIT = MAX_ASSETS * MAX_IMAGE_TEXT + BACKUP_METADATA_LIMIT * 16;
const record = value => value && typeof value === 'object' && !Array.isArray(value);

export function backupMetadata(catalog) {
  const { exportedAt, ...metadata } = catalog || {};
  return { ...metadata, assets: Array.isArray(catalog?.assets) ? catalog.assets.map(asset => { if (!record(asset)) return asset; const { data, pendingUpload, ...metadata } = asset; return metadata; }) : catalog?.assets };
}

export function assertBackupContentLimits(catalog) {
  if (!Array.isArray(catalog?.skins) || !Array.isArray(catalog?.assets)) throw new Error('A backup needs skins and assets arrays.');
  if (catalog.skins.length > MAX_SKINS || catalog.assets.length > MAX_ASSETS) throw new Error('A backup supports at most 100 skins and 250 artwork files.');
  const metadataBytes = new TextEncoder().encode(JSON.stringify(backupMetadata(catalog))).byteLength;
  if (metadataBytes > BACKUP_METADATA_LIMIT) throw new Error('Catalog metadata exceeds the 8 MB request limit. Export fewer saved skins or history records; artwork pixels are uploaded separately.');
  let imageCharacters = 0;
  for (const asset of catalog.assets) if (typeof asset?.data === 'string') {
    if (asset.data.length > MAX_IMAGE_TEXT) throw new Error('One artwork file exceeds the optimized image limit. Import it again at a supported size.');
    imageCharacters += asset.data.length;
  }
  // The actual content bound follows the catalog count and per-image limits;
  // pretty-print whitespace is not mistaken for request metadata or pixels.
  if (imageCharacters > catalog.assets.length * MAX_IMAGE_TEXT) throw new Error('Embedded artwork exceeds the catalog image limits.');
  return { metadataBytes, imageCharacters };
}

export function prepareCatalogRestore(value, previous) {
  if (!Array.isArray(value?.skins) || !Array.isArray(value?.assets) || value.skins.length > MAX_SKINS || value.assets.length > MAX_ASSETS) throw new Error('A backup needs at most 100 skins and 250 artwork files.');
  const catalog = structuredClone(value);
  let draftedSkins = 0, pendingAssets = 0;
  for (const skin of catalog.skins) {
    if (!record(skin)) continue;
    const prior = previous?.skins?.find(row => row.id === skin.id);
    if (prior?.status !== 'Approved' && (skin.status === 'Approved' || skin.status === undefined)) { skin.status = 'Draft'; draftedSkins += 1; }
  }
  for (const asset of catalog.assets) {
    if (!record(asset)) continue;
    const prior = previous?.assets?.find(row => row.id === asset.id);
    if (prior && (!prior.status || prior.status === 'Approved')) continue;
    if (['Approved', 'Pending', undefined].includes(asset.status)) { asset.status = 'Pending'; pendingAssets += 1; }
  }
  assertBackupContentLimits(catalog);
  return { catalog, draftedSkins, pendingAssets };
}
