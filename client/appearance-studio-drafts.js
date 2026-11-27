// Pure draft transitions: catalog records are never normalized or edited in place.
export const CANONICAL_NEUTRAL_ID = '__neutral_arc__';
const copy = value => structuredClone(value);

export function prepareDraftSave({ catalog, draft, selectedId, id, edited, duplicate = false, forceCopy = false }) {
  const source = catalog.skins.find(skin => skin.id === selectedId);
  const fork = duplicate || forceCopy || !source || source.status === 'Approved' || selectedId === CANONICAL_NEUTRAL_ID;
  const targetId = fork ? id : selectedId;
  if (!targetId || (fork && catalog.skins.some(skin => skin.id === targetId))) throw new Error('Choose a new unique draft ID.');
  const skin = { ...copy(draft), id: targetId, status: 'Draft', edited };
  skin.name = String(skin.name || '').trim() || 'Untitled skin';
  if (fork) {
    skin.sourceSkinId = source?.id || draft.sourceSkinId || CANONICAL_NEUTRAL_ID;
    skin.versions = [];
    if (duplicate) skin.name = `${skin.name} copy`.slice(0, 32);
    else if ((source?.status === 'Approved' && skin.name === source.name) || selectedId === CANONICAL_NEUTRAL_ID || skin.name === 'Neutral Arc') skin.name = `${skin.name} draft`.slice(0, 32);
  }
  const next = copy(catalog);
  if (fork) next.skins.unshift(skin);
  else next.skins[next.skins.findIndex(item => item.id === targetId)] = skin;
  next.selected = targetId;
  return { catalog: next, skin, selectedId: targetId, fork };
}

export function settleDraftSave(change, { draft, changedDuringSave = false }) {
  const saved = copy(change.skin);
  return {
    original: saved,
    draft: changedDuringSave ? { ...copy(draft), id: saved.id, status: 'Draft', sourceSkinId: saved.sourceSkinId, versions: saved.versions, edited: saved.edited } : copy(saved)
  };
}

export function draftsEqual(first, second) {
  const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, ordered(item)])) : value;
  return JSON.stringify(ordered(first)) === JSON.stringify(ordered(second));
}

export function restoreDraftSnapshot(snapshot, { original, selectedId }) {
  if (original.id === CANONICAL_NEUTRAL_ID && snapshot.id === CANONICAL_NEUTRAL_ID) return { selectedId: CANONICAL_NEUTRAL_ID, draft: copy(original) };
  const legacyOriginal = original.id !== CANONICAL_NEUTRAL_ID && original.rendererVersion !== 2;
  const undoExpansion = legacyOriginal && snapshot.id === original.id && snapshot.rendererVersion !== 2;
  const redoExpansion = legacyOriginal && selectedId === original.id && snapshot.id !== original.id && snapshot.rendererVersion === 2;
  const target = undoExpansion ? original.id : redoExpansion || (original.id === CANONICAL_NEUTRAL_ID && selectedId === CANONICAL_NEUTRAL_ID) ? snapshot.id : selectedId;
  const draft = copy(snapshot);
  for (const field of ['status', 'edited', 'versions', 'sourceSkinId', 'access', 'invitation', 'achievement', 'provenance', 'grants']) {
    if (Object.hasOwn(original, field)) draft[field] = copy(original[field]); else delete draft[field];
  }
  draft.id = target;
  if (original.id === CANONICAL_NEUTRAL_ID) { draft.status = 'Draft'; draft.sourceSkinId = CANONICAL_NEUTRAL_ID; }
  if (legacyOriginal && target !== original.id && snapshot.rendererVersion === 2) { draft.status = 'Draft'; draft.sourceSkinId = original.id; }
  return { selectedId: target, draft };
}

export function comparisonOptions(skins, selectedId) {
  return [{ value: 'saved', label: 'Last saved version' }, { value: 'neutral', label: 'Neutral Arc baseline' }, ...skins.filter(skin => skin.id !== selectedId).map(skin => ({ value: `skin:${skin.id}`, label: skin.name }))];
}

export function resolveComparisonSkin(target, { skins, original, neutral }) {
  if (target === 'neutral') return copy(neutral);
  if (target.startsWith('skin:')) return copy(skins.find(skin => skin.id === target.slice(5)) || original || neutral);
  return copy(original || neutral);
}

// This is catalog policy, never evidence of an individual player's entitlement.
// GET labels are used only while their exact owning catalog record is current.
export function appearanceAudience(skin, { skins = [], audiences = new Map(), records = new Map() }) {
  const seen = new Set();
  let current = skin;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    const stored = skins.find(row => row.id === current.id) || current;
    const policy = records.get(stored.id) === JSON.stringify(stored) ? audiences.get(stored.id) : '';
    if (['Invitation', 'Achievement', 'Restricted source'].includes(policy)) return policy;
    if (current.access || current.grants || current.invitation || current.achievement) return 'Restricted source';
    if (!current.sourceSkinId || current.sourceSkinId === CANONICAL_NEUTRAL_ID) break;
    current = skins.find(row => row.id === current.sourceSkinId);
  }
  if (skin.status === 'Draft') return 'Studio draft';
  const stored = skins.find(row => row.id === skin.id) || skin;
  const policy = records.get(stored.id) === JSON.stringify(stored) ? audiences.get(stored.id) : '';
  return skin.status === 'Approved' && policy === 'Available to select' ? policy : '';
}

const sectionFields = {
  foundation: { top: ['canvasDesign', 'sceneDesign', 'commanderTreatment', 'commanderRegions', 'background', 'surface', 'accent', 'secondary', 'text', 'muted', 'atmosphere', 'atmosphereColor', 'atmosphereStrength', 'atmospherePosition'] },
  typography: { top: ['fontFamily', 'fontWeight', 'lineHeight', 'letterSpacing', 'textTransform', 'labelAlignment', 'textEffect', 'borderColor', 'disabledColor', 'stateSuccess', 'stateWarning', 'stateDanger', 'focusColor'], layout: ['labelTextScale', 'seatTextScale'] },
  components: { top: ['surfaceDesign', 'buttonTreatment', 'seatTreatment', 'componentColors', ...['button', 'lifeButton', 'customLife', 'commanderTax', 'commanderDamage', 'seat'].flatMap(prefix => ['Opacity', 'Blur', 'Border'].map(suffix => `${prefix}${suffix}`))] },
  layout: { top: ['tableDesign'], layout: ['seatRadius', 'buttonRadius', 'seatGap', 'counterOffsetY', 'turnOffsetY', 'controlsOffsetY', 'centerSealScale', 'centerSealOffsetX', 'centerSealOffsetY', 'lifeNumberScale', 'lifeNumberOffsetX', 'lifeNumberOffsetY', 'componentLayout'] },
  artwork: { top: ['surfaceArt', 'backgroundTreatment', 'backgroundAsset', 'backgroundScale', 'backgroundPositionX', 'backgroundPositionY', 'sealAsset', 'ring', 'thumbnailAsset', 'buttonAsset'], layout: ['overlays', 'overlayOpacity', 'overlayScale', 'overlayBlend', 'dialArtSpin'] },
  symbols: { top: ['counterDesign', 'symbols', 'symbolAssets', 'symbolScale'] }
};

export function resetAppearanceSection(draft, source, section) {
  const fields = sectionFields[section];
  if (!fields) throw new Error('Choose an appearance section to reset.');
  const result = copy(draft);
  const restore = (target, baseline, keys = []) => keys.forEach(key => {
    if (baseline && Object.hasOwn(baseline, key)) target[key] = copy(baseline[key]);
    else delete target[key];
  });
  restore(result, source, fields.top);
  const variants = section === 'typography' ? ['numerals'] : section === 'components' ? ['dial','navigation','commander','panels','counterMode'] : section === 'artwork' ? ['seal'] : [];
  if (variants.length && (result.variants || source.variants)) {
    result.variants ||= {};
    restore(result.variants,source.variants,variants);
    if (!Object.keys(result.variants).length) delete result.variants;
  }
  if (section === 'typography' && result.tokens?.color) restore(result.tokens.color,source.tokens?.color,['border','disabled']);
  if (fields.layout) {
    const mode = draft.interfaceStyle === 'dial' ? 'dial' : 'button';
    result.modeLayouts ||= {};
    result.modeLayouts[mode] ||= {};
    restore(result.modeLayouts[mode], source.modeLayouts?.[mode], fields.layout);
  }
  return result;
}
