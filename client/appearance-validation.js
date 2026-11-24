// Shared input boundary for Studio files, protected APIs, and renderer messages.
// This module never changes a catalog, executes styles, or reads game state.
import { appearanceReadability } from './appearance-readability.js';
import { appearanceFontKeys } from './appearance-fonts.js';
import { designArtworkReferences } from './appearance-design-artwork.js';
import { sceneDesignSpec } from './appearance-scene-design.js';
import { surfaceDesignSpec } from './appearance-surface-design.js';
import { surfaceArtSpec, surfaceArtDataSpec } from './appearance-surface-art.js';
import { canvasDesignSpec, tableDesignSpec } from './appearance-table-design.js';
import { counterDesignSpec, counterArtDataSpec } from './counter-design.js';
export const APPEARANCE_SCHEMA_VERSION = 1;
export const APPEARANCE_ASSET_ROLES = Object.freeze(['background', 'symbol', 'overlay', 'seal', 'dial', 'thumbnail', 'button', 'panel']);
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function appearanceAssetMetadata(value) { const { data, pendingUpload, ...metadata } = value; return metadata; }
export function appearanceAssetRecordMatches(previous, next) {
  if (!object(previous) || !object(next) || !same(appearanceAssetMetadata(previous), appearanceAssetMetadata(next))) return false;
  return previous.data === undefined || next.data === undefined || previous.data === next.data;
}
const color = { type: 'color' }, bool = { type: 'boolean' };
const text = max => ({ type: 'text', max });
const number = (min, max) => ({ type: 'number', min, max });
const choice = (...values) => ({ type: 'enum', values });
const record = fields => ({ type: 'object', fields });
const id = { type: 'id' }, image = { type: 'image' };
const map = (keys, value) => Object.fromEntries(keys.map(key => [key, value]));
const modes = ['life', 'commander', 'radiation', 'poison', 'energy', 'generic'];
const slots = ['seat', 'counter', 'dial'];
const regions = ['podStrip', 'counterReadout', 'dialSurface', 'commanderDamage', 'turnActions', 'adjustControls', 'customLife', 'commanderTax', 'modeNav'];
const componentPrefixes = ['button', 'lifeButton', 'customLife', 'commanderTax', 'commanderDamage', 'seat'];
const effects = { backgroundTreatment: choice('plain', 'rays', 'grain', 'mist', 'stars'), buttonTreatment: choice('glass', 'solid', 'outline'), seatTreatment: choice('raised', 'flat', 'glass') };
const layoutFields = {
  labelTextScale: number(85, 115), seatTextScale: number(85, 115), seatRadius: number(0, 24), buttonRadius: number(0, 24), seatGap: number(4, 16),
  counterOffsetY: number(-18, 18), turnOffsetY: number(-12, 12), controlsOffsetY: number(-12, 12), centerSealScale: number(60, 150),
  centerSealOffsetX: number(-18, 18), centerSealOffsetY: number(-18, 18), lifeNumberScale: number(75, 140), lifeNumberOffsetX: number(-14, 14), lifeNumberOffsetY: number(-14, 14), dialArtSpin: bool,
  componentLayout: record(map(regions, record({ x: number(-100, 100), y: number(-140, 140), scale: number(70, 140) }))),
  overlays: record(map(slots, id)), overlayOpacity: record(map(slots, number(0, 70))), overlayScale: record(map(slots, number(50, 160))), overlayBlend: record(map(slots, choice('normal', 'screen', 'multiply', 'overlay'))),
  overlayData: record(map(slots, image)),
};
const typography = { family: choice(...appearanceFontKeys), weight: choice(400, 500, 600, 700), lineHeight: number(1.1, 1.6), letterSpacing: number(-.02, .08), textTransform: choice('none', 'uppercase'), labelAlignment: choice('inherit', 'start', 'center'), textEffect: choice('none', 'soft-shadow') };
const tokenColors = ['canvas', 'surface', 'text', 'textMuted', 'accentPrimary', 'accentSecondary', 'atmosphere', 'success', 'warning', 'danger', 'focus', 'border', 'disabled'];
const componentColors = record({ ...map(['background', 'text', 'border', 'selectedText', 'selectedBorder'], color) });
const visualFields = {
  rendererVersion: choice(1, 2), canvasDesign: canvasDesignSpec, sceneDesign: sceneDesignSpec, tableDesign: tableDesignSpec, surfaceArt: surfaceArtSpec, surfaceDesign: surfaceDesignSpec, counterDesign: counterDesignSpec,
  ...map(['background', 'surface', 'accent', 'secondary', 'text', 'muted', 'atmosphereColor', 'stateSuccess', 'stateWarning', 'stateDanger', 'focusColor', 'borderColor', 'disabledColor'], color),
  variants: record({ dial: choice('native', 'engraved', 'plain'), seal: choice('native', 'etched', 'medallion'), counterMode: choice('native', 'badge', 'underlined'), navigation: choice('native', 'underline', 'framed'), commander: choice('native', 'accent', 'quiet'), panels: choice('native', 'outlined', 'raised'), numerals: choice('native', 'tabular', 'proportional') }),
  ...effects, atmosphere: choice('dark', 'light', 'custom'), atmospherePosition: choice('top', 'center', 'bottom'), atmosphereStrength: number(0, 80),
  backgroundScale: number(50, 200), backgroundPositionX: number(0, 100), backgroundPositionY: number(0, 100), ring: choice('arc', 'orbit', 'none'),
  backgroundAsset: id, sealAsset: id, thumbnailAsset: id, buttonAsset: id, symbolAssets: record(map(modes, id)), symbols: record(map(modes, text(12))), symbolScale: record(map(modes, number(60, 200))),
  interfaceStyle: choice('button', 'dial'), fontFamily: typography.family, fontWeight: typography.weight, lineHeight: typography.lineHeight, letterSpacing: typography.letterSpacing,
  textTransform: typography.textTransform, labelAlignment: typography.labelAlignment, textEffect: typography.textEffect,
  ...layoutFields, modeLayouts: record(map(['button', 'dial'], record(layoutFields))),
  componentColors: record(map(['endTurn', 'lifeButtons', 'playerCards', 'navigation'], componentColors)),
  tokens: record({ schemaVersion: choice(1), color: record(map(tokenColors, color)), typography: record(typography), effects: record(effects), components: record(map(componentPrefixes, record({ opacity: number(35, 100), blur: number(0, 16), border: number(0, 100) }))) }),
};
for (const prefix of componentPrefixes) Object.assign(visualFields, { [`${prefix}Opacity`]: number(35, 100), [`${prefix}Blur`]: number(0, 16), [`${prefix}Border`]: number(0, 100) });
const previewFields = {
  surfaceArtData: surfaceArtDataSpec, counterArtData: counterArtDataSpec,
  useGameBase: bool, previewReadOnly: bool, previewState: choice('turn', 'other', 'damage', 'offline', 'lobby', 'dialog', 'status', 'error', 'finished', 'end', 'endgame', 'menu', 'radiationDialog', 'commanderDialog', 'eliminated', 'longLabels'), previewMode: choice(...modes), previewPlayers: choice(2, 3, 4, 5, 6, 7, 8), previewColorScheme: choice('', 'dark', 'light'),
  backgroundData: image, sealData: image, buttonData: image, symbolData: record(map(modes, image)), overlayData: record(map(slots, image)),
};
const privateFields = map(['access', 'invitation', 'achievement', 'provenance', 'grants'], { type: 'metadata' });
const skinFields = { id, name: text(80), status: choice('Draft', 'Approved'), edited: text(80), schemaVersion: choice(1), sourceSkinId: id, ...visualFields, ...privateFields };
const issue = (path, message, fix) => ({ path, message, fix });
const result = () => ({ errors: [], warnings: [] });
function check(value, spec, path, report) {
  const fail = (message, fix = 'Choose a supported value in the Studio.') => { if (report.errors.length < 50) report.errors.push(issue(path, message, fix)); };
  if (spec.type === 'object') {
    if (!object(value)) return fail('This section must be an object.');
    for (const [key, item] of Object.entries(value)) {
      if (report.errors.length >= 50) break;
      if (!Object.hasOwn(spec.fields, key)) fail(`Unsupported appearance field “${key}”.`, 'Remove this field; arbitrary selectors, scripts and settings are not supported.');
      else check(item, spec.fields[key], `${path}.${key}`, report);
    }
  } else if (spec.type === 'color') { if (typeof value !== 'string' || !/^#[\da-f]{6}$/i.test(value)) fail('Use a six-digit color such as #f4ecd9.'); }
  else if (spec.type === 'number') { if (!['number', 'string'].includes(typeof value) || value === '' || !Number.isFinite(Number(value)) || Number(value) < spec.min || Number(value) > spec.max) fail(`Value must be between ${spec.min} and ${spec.max}.`); }
  else if (spec.type === 'enum') { if (!spec.values.includes(value)) fail(`Choose one of: ${spec.values.join(', ')}.`); }
  else if (spec.type === 'boolean') { if (typeof value !== 'boolean') fail('This setting must be true or false.'); }
  else if (spec.type === 'id') { if (value !== '' && (typeof value !== 'string' || !ID.test(value))) fail('Use a stable ID containing letters, numbers, underscores or hyphens.'); }
  else if (spec.type === 'text') { if (typeof value !== 'string' || value.length > spec.max || /[\p{Cc}\p{Cf}]/u.test(value)) fail(`Use plain text up to ${spec.max} characters.`); }
  else if (spec.type === 'image') { if (value !== '') { try { inspectImageData(value); } catch (error) { fail(error.message, 'Import a supported raster image through the asset library.'); } } }
  else if (spec.type === 'metadata') {
    if (JSON.stringify(value)?.length > 16000 || typeof value === 'function') fail('Private appearance metadata is too large.');
  }
}

export function inspectImageData(data) {
  const match = typeof data === 'string' && /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
  if (!match || match[2].length % 4 !== 0) throw new TypeError('Use a base64 PNG, JPEG or WebP image data URL.');
  if (match[2].length > 2_000_000) throw new TypeError('Image exceeds the 1.5 MB optimized asset limit.');
  const bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0));
  const view = new DataView(bytes.buffer), ascii = (start, length) => String.fromCharCode(...bytes.subarray(start, start + length));
  let width = 0, height = 0;
  if (match[1] === 'image/png') {
    if (bytes.length < 45 || ascii(0, 8) !== '\x89PNG\r\n\x1a\n' || ascii(12, 4) !== 'IHDR' || view.getUint32(8) !== 13) throw new TypeError('PNG content does not match its image type.');
    width = view.getUint32(16); height = view.getUint32(20);
    let position = 8, ended = false, hasData = false;
    while (position + 12 <= bytes.length) {
      const length = view.getUint32(position), kind = ascii(position + 4, 4);
      if (position + length + 12 > bytes.length) break;
      if (kind === 'IDAT') hasData = true;
      position += length + 12;
      if (kind === 'IEND') { ended = position === bytes.length && length === 0; break; }
    }
    if (!ended || !hasData) throw new TypeError('PNG image is incomplete; import a complete exported image.');
  } else if (match[1] === 'image/jpeg') {
    if (bytes.length < 12 || view.getUint16(0) !== 0xffd8 || view.getUint16(bytes.length - 2) !== 0xffd9) throw new TypeError('JPEG content does not match its image type.');
    let position = 2;
    while (position + 4 < bytes.length) {
      if (bytes[position++] !== 0xff) break;
      while (bytes[position] === 0xff) position++;
      const marker = bytes[position++];
      if (marker === 0xda || marker === 0xd9) break;
      const length = view.getUint16(position);
      if (length < 2 || position + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 8) { height = view.getUint16(position + 3); width = view.getUint16(position + 5); break; }
      position += length;
    }
  } else {
    if (bytes.length < 30 || ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WEBP' || view.getUint32(4, true) + 8 !== bytes.length) throw new TypeError('WebP content does not match its image type.');
    const kind = ascii(12, 4), u24 = offset => bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16);
    if (kind === 'VP8X') { if (bytes[20] & 2) throw new TypeError('Animated artwork is not supported; export one still image.'); width = u24(24) + 1; height = u24(27) + 1; }
    else if (kind === 'VP8 ' && ascii(23, 3) === '\x9d\x01\x2a') { width = view.getUint16(26, true) & 0x3fff; height = view.getUint16(28, true) & 0x3fff; }
    else if (kind === 'VP8L' && bytes[20] === 0x2f) { width = 1 + bytes[21] + ((bytes[22] & 0x3f) << 8); height = 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0xf) << 10); }
  }
  if (!width || !height || width > 4096 || height > 4096 || width * height > 16_000_000) throw new TypeError('Image dimensions must be 1–4096 pixels and below 16 megapixels.');
  return { mimeType: match[1], width, height, bytes: bytes.length };
}

export function validateAppearanceAsset(asset, { requireData = false } = {}) {
  const report = result();
  const fields = { id, name: text(80), source: text(1000), placement: choice(...APPEARANCE_ASSET_ROLES), status: choice('Pending', 'Approved'), width: number(1, 4096), height: number(1, 4096), bytes: number(1, 1_500_000), mimeType: choice('image/png', 'image/jpeg', 'image/webp'), data: image, pendingUpload: bool };
  check(asset, record(fields), 'asset', report);
  if (!object(asset)) return report;
  if (typeof asset.id !== 'string' || !ID.test(asset.id)) report.errors.push(issue('asset.id', 'An asset needs a stable ID.', 'Import the asset again.'));
  for (const key of ['name', 'source', 'placement']) if (!asset[key]) report.errors.push(issue(`asset.${key}`, `An asset needs its ${key}.`, 'Complete the asset details before saving.'));
  if (requireData && !asset.data) report.errors.push(issue('asset.data', 'Image data is missing.', 'Import the original image again.'));
  if (asset.data) {
    try {
      const info = inspectImageData(asset.data);
      for (const key of ['width', 'height', 'bytes', 'mimeType']) if (asset[key] != null && asset[key] !== info[key]) report.errors.push(issue(`asset.${key}`, `Stored ${key} does not match the image.`, 'Import the original image again to refresh its metadata.'));
      if (['symbol', 'seal', 'thumbnail'].includes(asset.placement) && (info.width / info.height > 1.5 || info.height / info.width > 1.5)) report.warnings.push(issue('asset.placement', 'This icon or seal is far from square and may crop poorly.', 'Use square artwork or review its fit before approval.'));
    } catch { /* The image field already reports the specific content error. */ }
  }
  return report;
}

function assetReferences(skin) {
  const references = [...designArtworkReferences(skin)];
  const add = (value, path, roles) => { if (value) references.push({ id: value, path, roles }); };
  add(skin.backgroundAsset, 'backgroundAsset', ['background']); add(skin.sealAsset, 'sealAsset', ['symbol', 'seal']); add(skin.thumbnailAsset, 'thumbnailAsset', ['thumbnail']); add(skin.buttonAsset, 'buttonAsset', ['button']);
  for (const [key, value] of Object.entries(skin.symbolAssets || {})) add(value, `symbolAssets.${key}`, ['symbol']);
  for (const [name, layout] of [['skin', skin], ...Object.entries(skin.modeLayouts || {})]) if (object(layout)) for (const [slot, value] of Object.entries(layout.overlays || {})) add(value, `${name}.overlays.${slot}`, slot === 'dial' ? ['overlay', 'background', 'dial'] : ['overlay', 'background', 'panel']);
  return references;
}
export function appearanceAssetReferences(skin) {
  const references = assetReferences(skin);
  for (const [index, version] of (Array.isArray(skin.versions) ? skin.versions : []).entries()) if (object(version?.appearance)) references.push(...assetReferences(version.appearance).map(reference => ({ ...reference, path: `versions.${index}.${reference.path}` })));
  return references;
}

export function validateAppearanceSkin(skin, { assets, preview = false, requireApprovedAssets = false, publish = false, sourceSkin } = {}) {
  const report = result();
  check(skin, record({ ...skinFields, ...(preview ? previewFields : {}), versions: { type: 'versions' } }), 'skin', report);
  // Resolve geometry, references and contrast only after the input shape checks.
  if (!object(skin) || report.errors.length) return report;
  if (!preview && skin.rendererVersion !== 2 && ['surfaceDesign','surfaceArt','counterDesign','tableDesign','canvasDesign','sceneDesign'].some(key => Object.hasOwn(skin,key))) report.errors.push(issue('skin.rendererVersion','These design controls need the expanded renderer.','Open the source skin and choose Use expanded controls before adding these settings.'));
  if (!preview && Object.values(skin.modeLayouts || {}).some(layout => layout?.overlayData)) report.errors.push(issue('skin.modeLayouts.overlayData', 'Store asset IDs instead of embedded renderer image data.', 'Choose artwork through the asset library.'));
  if (!preview && (typeof skin.id !== 'string' || !ID.test(skin.id))) report.errors.push(issue('skin.id', 'A skin needs a stable ID.', 'Create a new draft.'));
  if (skin.versions !== undefined) {
    if (!Array.isArray(skin.versions) || skin.versions.length > 12) report.errors.push(issue('skin.versions', 'Saved history must contain at most 12 versions.', 'Export the catalog and keep the latest 12 saved versions.'));
    else for (const version of skin.versions) {
      check(version, record({ id, label: text(80), savedAt: text(40), appearance: record(skinFields) }), 'skin.versions', report);
    }
  }
  if (report.errors.length) return report;
  if (assets) for (const reference of appearanceAssetReferences(skin)) {
    const found = assets.find(item => item.id === reference.id);
    if (!found) report.errors.push(issue(reference.path, `Artwork “${reference.id}” is missing.`, 'Choose an existing asset or clear this artwork slot.'));
    else if (!reference.roles.includes(found.placement)) report.errors.push(issue(reference.path, 'Artwork has the wrong role for this slot.', `Choose ${reference.roles.join(' or ')} artwork.`));
    else if (requireApprovedAssets && found.status && found.status !== 'Approved') report.errors.push(issue(reference.path, 'This artwork is still pending approval.', 'Review and approve the asset before publishing.'));
  }
  if (publish) for (const [name, layout] of [['skin', skin], ...Object.entries(skin.modeLayouts || {})]) {
    const inherited = name === 'skin' ? sourceSkin : { ...sourceSkin, ...sourceSkin?.modeLayouts?.[name] };
    for (const [region, placement] of Object.entries(layout.componentLayout || {})) for (const [field, min, max] of [['x', -32, 32], ['y', -36, 36], ['scale', 85, 115]]) {
      const value = Number(placement[field]);
      if (Number.isFinite(value) && (value < min || value > max) && value !== Number(inherited?.componentLayout?.[region]?.[field])) report.errors.push(issue(`${name}.componentLayout.${region}.${field}`, `New placements must stay between ${min} and ${max}.`, 'Reset this region or use the supported placement controls; unchanged legacy source values remain readable.'));
    }
  }
  for (const finding of appearanceReadability(skin)) {
    if (finding.severity === 'polish') continue;
    const target = finding.severity === 'error' && publish ? report.errors : report.warnings;
    target.push(issue(finding.path, finding.label, finding.fix));
  }
  return report;
}

export function validateAppearanceCatalog(catalog, { previous = null, mode = 'draft' } = {}) {
  const report = result();
  if (!object(catalog)) { report.errors.push(issue('catalog', 'Choose an Appearance Studio catalog object.', 'Export a catalog from Appearance Studio.')); return report; }
  if (catalog.schemaVersion != null && ![0, 1].includes(catalog.schemaVersion)) report.errors.push(issue('catalog.schemaVersion', 'This catalog uses an unsupported schema version.', 'Use a catalog exported by this Studio version; future formats are not downgraded.'));
  for (const key of Object.keys(catalog)) if (!['schemaVersion', 'revision', 'exportedAt', 'skins', 'assets', 'selected', 'gameDefaultLayout'].includes(key)) report.errors.push(issue(`catalog.${key}`, 'Unsupported catalog setting.', 'Remove settings unrelated to appearance.'));
  if (catalog.revision != null && (!Number.isSafeInteger(catalog.revision) || catalog.revision < 0)) report.errors.push(issue('catalog.revision', 'Catalog revision must be a nonnegative integer.', 'Reload the protected catalog before saving.'));
  for (const [key, limit] of [['skins', 100], ['assets', 250]]) {
    if (!Array.isArray(catalog[key]) || catalog[key].length > limit) report.errors.push(issue(`catalog.${key}`, `Catalog ${key} must be an array with at most ${limit} records.`, 'Use a valid Studio export.'));
    else { const ids = new Set(); for (const item of catalog[key]) { if (!object(item) || typeof item.id !== 'string' || !ID.test(item.id) || ids.has(item.id)) report.errors.push(issue(`catalog.${key}`, 'Records need unique stable IDs.', 'Remove duplicate records or import them as new drafts.')); ids.add(item?.id); } }
  }
  if (report.errors.length) return report;
  if (catalog.selected != null && (typeof catalog.selected !== 'string' || !ID.test(catalog.selected) || (!['neutral', '__neutral_arc__'].includes(catalog.selected) && !catalog.skins.some(row => row.id === catalog.selected)))) report.errors.push(issue('catalog.selected', 'The selected skin does not exist in this catalog.', 'Select an existing skin or the built-in Neutral Arc baseline.'));
  if (previous) {
    if ((catalog.revision ?? 0) !== (previous.revision ?? 0)) report.errors.push(issue('catalog.revision', 'The catalog changed in another Studio tab.', 'Reload the latest catalog and reapply the unsaved draft before saving.'));
    if (!same(catalog.gameDefaultLayout ?? null, previous.gameDefaultLayout ?? null)) report.errors.push(issue('catalog.gameDefaultLayout', 'Draft authoring cannot change the global game layout.', 'Keep the current default layout unchanged.'));
    for (const row of previous.skins || []) if (row.status === 'Approved' && !same(row, catalog.skins.find(item => item.id === row.id))) report.errors.push(issue(`skins.${row.id}`, 'An approved skin cannot be changed or removed by saving a draft.', 'Save changes as a separate new Draft skin.'));
    for (const row of previous.assets || []) if ((!row.status || row.status === 'Approved') && !appearanceAssetRecordMatches(row, catalog.assets.find(item => item.id === row.id))) report.errors.push(issue(`assets.${row.id}`, 'Approved artwork cannot be changed or removed by saving a draft.', 'Keep this asset and import replacement artwork under a new ID.'));
  }
  for (const row of catalog.skins) {
    const prior = previous?.skins?.find(item => item.id === row.id);
    if (prior?.status === 'Approved' && same(prior, row)) continue; // Preserve legacy approved records without rewriting them.
    if (previous && mode !== 'publish' && row.status === 'Approved') report.errors.push(issue(`skins.${row.id}.status`, 'A draft save or restore cannot approve a skin.', 'Use the explicit Publish action.'));
    const checked = validateAppearanceSkin(row, { assets: catalog.assets }); report.errors.push(...checked.errors); report.warnings.push(...checked.warnings);
  }
  for (const row of catalog.assets) {
    const prior = previous?.assets?.find(item => item.id === row.id);
    if (prior && appearanceAssetRecordMatches(prior, row)) continue;
    const checked = validateAppearanceAsset(row); report.errors.push(...checked.errors); report.warnings.push(...checked.warnings);
    if (prior && (prior.status === 'Approved' || !prior.status) && !appearanceAssetRecordMatches(prior, row)) report.errors.push(issue(`assets.${row.id}`, 'Approved asset metadata cannot change during a draft save.', 'Import changed artwork under a new asset ID.'));
  }
  return report;
}

export function assertAppearanceValid(report) {
  if (report.errors.length) throw Object.assign(new TypeError(`${report.errors[0].path}: ${report.errors[0].message} ${report.errors[0].fix}`), { status: 400, code: 'APPEARANCE_INVALID', validation: report });
  return report;
}
function project(value, spec) {
  if (spec.type === 'object') {
    if (!object(value)) return undefined;
    return Object.fromEntries(Object.entries(value).filter(([key]) => Object.hasOwn(spec.fields, key)).map(([key, item]) => [key, project(item, spec.fields[key])]).filter(([, item]) => item !== undefined));
  }
  if (value === null || typeof value === 'object') return undefined;
  if (spec.type === 'boolean') return typeof value === 'boolean' ? value : undefined;
  if (spec.type === 'number') return (typeof value === 'number' || (typeof value === 'string' && value !== '')) && Number.isFinite(Number(value)) ? value : undefined;
  if (spec.type === 'enum') return spec.values.includes(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  if (spec.type === 'color') return /^#[\da-f]{6}$/i.test(value) ? value : undefined;
  if (spec.type === 'id') return value === '' || ID.test(value) ? value : undefined;
  if (spec.type === 'image') return value === '' || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : undefined;
  if (spec.type === 'text') return value.length <= spec.max && !/[\p{Cc}\p{Cf}]/u.test(value) ? value : undefined;
  return undefined;
}
export function publicAppearanceSkin(skin) { return project(skin, record({ id, name: text(80), edited: text(80), ...visualFields, ...previewFields })); }
