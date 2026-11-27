import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { CANONICAL_NEUTRAL_ID, prepareDraftSave, settleDraftSave, comparisonOptions, resolveComparisonSkin, resetAppearanceSection, appearanceAudience, restoreDraftSnapshot, draftsEqual } from './appearance-studio-drafts.js';
import { validateAppearanceCatalog, validateAppearanceAsset, assertAppearanceValid } from './appearance-validation.js';
import { materializeRendererSkin } from './renderer-bridge.js';
import { isLegacyAppearance, legacyDraftAppearance, historyEntry } from './appearance-renderer-lifecycle.js';
import { prepareCatalogRestore, backupMetadata } from './appearance-studio-backups.js';
import { nativeDraftIcons } from './counter-design.js';

const studio = await readFile(new URL('appearance-studio.js', import.meta.url), 'utf8');

test('saving an approved appearance creates a restricted draft and leaves the source exact', () => {
  const source = { id: 'neutral', status: 'Approved', name: 'Legacy artwork', access: { type: 'invite', accountIds: ['owner'] }, tokens: { legacy: true }, edited: 'Prior' };
  const catalog = { skins: [source], assets: [], selected: source.id };
  const before = structuredClone(catalog);
  const change = prepareDraftSave({ catalog, draft: { ...source, name: 'Edited artwork' }, selectedId: source.id, id: 'draft-copy', edited: 'Today' });
  assert.deepEqual(catalog, before);
  assert.deepEqual(change.catalog.skins[1], source);
  assert.equal(change.skin.id, 'draft-copy');
  assert.equal(change.skin.status, 'Draft');
  assert.equal(change.skin.sourceSkinId, 'neutral');
  assert.deepEqual(change.skin.access, source.access);
});

test('canonical Neutral Arc is virtual and saves into a new draft without replacing legacy neutral', () => {
  const legacy = { id: 'neutral', name: 'A legacy customized skin', status: 'Approved' };
  const change = prepareDraftSave({ catalog: { skins: [legacy], assets: [] }, selectedId: CANONICAL_NEUTRAL_ID, draft: { id: CANONICAL_NEUTRAL_ID, name: 'Neutral Arc', status: 'Approved' }, id: 'new-draft', edited: 'Today' });
  assert.deepEqual(change.catalog.skins[1], legacy);
  assert.ok(change.catalog.skins.every(skin => skin.id !== CANONICAL_NEUTRAL_ID));
  assert.equal(change.skin.status, 'Draft');
});

test('saving an existing draft updates that draft only', () => {
  const source = { id: 'draft-one', name: 'Draft', status: 'Draft', sourceSkinId: 'invited-skin' };
  const change = prepareDraftSave({ catalog: { skins: [source] }, selectedId: source.id, draft: { ...source, name: 'Updated' }, id: 'unused-id', edited: 'Today' });
  assert.equal(change.catalog.skins.length, 1);
  assert.equal(change.skin.id, source.id);
  assert.equal(change.skin.sourceSkinId, 'invited-skin');
});

test('a genuinely new draft preserves its nonblank custom name when first saved', () => {
  const change = prepareDraftSave({ catalog: { skins: [] }, selectedId: 'unsaved-one', draft: { id: 'unsaved-one', name: '  Harbor prototype  ', status: 'Draft', sourceSkinId: CANONICAL_NEUTRAL_ID }, id: 'saved-one', edited: 'Today' });
  assert.equal(change.skin.name, 'Harbor prototype');
});

test('retrying a stale save creates a separate copy and preserves the concurrently updated draft', () => {
  const concurrent = { id: 'shared-draft', name: 'Other window edits', status: 'Draft' };
  const change = prepareDraftSave({ catalog: { skins: [concurrent] }, selectedId: concurrent.id, draft: { id: concurrent.id, name: 'My retained work', status: 'Draft' }, id: 'retained-copy', edited: 'Today', forceCopy: true });
  assert.equal(change.selectedId, 'retained-copy');
  assert.deepEqual(change.catalog.skins.find(skin => skin.id === concurrent.id), concurrent);
  assert.equal(change.skin.name, 'My retained work');
});

test('a slow save preserves edits made while the request is pending', () => {
  const change = prepareDraftSave({ catalog: { skins: [{ id: 'approved', status: 'Approved' }] }, selectedId: 'approved', draft: { id: 'approved', status: 'Approved', name: 'Submitted' }, id: 'copy', edited: 'Today' });
  const result = settleDraftSave(change, { draft: { id: 'approved', status: 'Approved', name: 'Edited during save' }, changedDuringSave: true });
  assert.equal(result.draft.name, 'Edited during save');
  assert.equal(result.draft.id, 'copy');
  assert.equal(result.draft.status, 'Draft');
  assert.equal(result.original.name, 'Submitted');
});

test('comparison supports saved, canonical Neutral Arc, and other skins without editing them', () => {
  const original = { id: 'one', name: 'Saved', status: 'Draft' }, neutral = { id: CANONICAL_NEUTRAL_ID, name: 'Neutral Arc' };
  const skins = [original, { id: 'neutral', name: 'Legacy neutral' }];
  assert.deepEqual(comparisonOptions(skins, 'one'), [{ value: 'saved', label: 'Last saved version' }, { value: 'neutral', label: 'Neutral Arc baseline' }, { value: 'skin:neutral', label: 'Legacy neutral' }]);
  const comparison = resolveComparisonSkin('skin:neutral', { skins, original, neutral });
  comparison.name = 'Changed preview clone';
  assert.equal(skins[1].name, 'Legacy neutral');
  assert.equal(resolveComparisonSkin('neutral', { skins, original, neutral }).id, CANONICAL_NEUTRAL_ID);
});

test('section reset restores only the requested fields in the current layout', () => {
  const source = { background: '#000000', text: '#ffffff', fontFamily: 'system', modeLayouts: { button: { seatGap: 8 }, dial: { seatGap: 10 } }, interfaceStyle: 'dial' };
  const draft = { ...structuredClone(source), background: '#222222', fontFamily: 'mono', modeLayouts: { button: { seatGap: 14 }, dial: { seatGap: 16 } } };
  const reset = resetAppearanceSection(draft, source, 'layout');
  assert.equal(reset.background, '#222222');
  assert.equal(reset.fontFamily, 'mono');
  assert.equal(reset.modeLayouts.button.seatGap, 14);
  assert.equal(reset.modeLayouts.dial.seatGap, 10);
  assert.equal(draft.modeLayouts.dial.seatGap, 16);
});

test('palette reset preserves background artwork treatment, which belongs to the artwork section', () => {
  const source = { background: '#000000', backgroundTreatment: 'plain', interfaceStyle: 'button' };
  const draft = { ...source, background: '#222222', backgroundTreatment: 'stars' };
  const reset = resetAppearanceSection(draft, source, 'foundation');
  assert.equal(reset.background, source.background);
  assert.equal(reset.backgroundTreatment, 'stars');
  assert.equal(resetAppearanceSection(draft, source, 'artwork').backgroundTreatment, 'plain');
});

test('normalizing editable clones preserves valid zero positions and atmosphere strength', () => {
  const declaration = studio.match(/function normalizeSkin\(skin\) \{[^\n]+\}/)[0];
  const normalize = new Function('tokenNumber', 'materializeRendererSkin', `${declaration}; return normalizeSkin;`)((value, fallback, min, max) => Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : fallback)), materializeRendererSkin);
  const skin = { atmosphereStrength: 0, backgroundPositionX: 0, backgroundPositionY: 0 };
  normalize(skin);
  assert.equal(skin.atmosphereStrength, 0);
  assert.equal(skin.backgroundPositionX, 0);
  assert.equal(skin.backgroundPositionY, 0);
});

test('symbol defaults normalize identically before rendering so a fresh selection is clean', () => {
  const base = studio.match(/function normalizeSkin\(skin\) \{[^\n]+\}/)[0];
  const extension = studio.slice(studio.indexOf('const normalizeSkinBase ='), studio.indexOf('function saveStore()'));
  const icons = { life: '♥', commander: '♜', radiation: '☢', poison: '☠', energy: 'ϟ', generic: '◇' };
  const normalize = new Function('icons', 'tokenNumber', 'materializeRendererSkin', `${base}\n${extension};return normalizeSkin;`)(icons, (value, fallback, min, max) => Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : fallback)), materializeRendererSkin);
  const original = { symbolScale: {} };
  normalize(original);
  assert.deepEqual(original.symbolScale, Object.fromEntries(Object.keys(icons).map(key => [key, 100])));
});

function lifecycleHarness() {
  const source = { id: 'approved', name: 'Source', status: 'Approved', access: { type: 'invited' } };
  const context = {
    store: { skins: [structuredClone(source)], assets: [] }, draft: { ...structuredClone(source), name: 'Edited source' }, original: structuredClone(source), selectedId: source.id,
    CANONICAL_NEUTRAL_ID, draftRevision: 1, draftHistoryIndex: 0, draftHistory: [{}], legacyDraftSource: structuredClone(source), showingBaseline: false, savingCatalog: false, confirmedCatalog: null, catalogConflict: false,
    isLegacyAppearance, historyEntry,
    prepareDraftSave, settleDraftSave, clone: structuredClone, materializeAppearanceSkin: structuredClone,
    newDraftId: () => 'new-copy', relativeDate: () => 'Today', normalizeEditableSkin: skin => skin,
    recordSavedSkinVersion: skin => { skin.versions = []; }, saveStore() {}, rememberDraft() {}, renderLibrary() {}, renderEditor() {}, renderPreview() {}, validate: () => true,
    setSaveState() {}, toast() {}, clearPublishFeedback() {}, confirm: () => true, ensureGeometryPreflight: async () => true,
    showPublishFeedback(title, detail) { context.feedback = { title, detail }; },
    setCatalogSaving(active) { context.savingCatalog = active; },
    isDraftDirty() { return JSON.stringify(context.draft) !== JSON.stringify(context.original); }
  };
  context.getDraftAppearance = () => isLegacyAppearance(context.draft) ? legacyDraftAppearance(context.draft, context.legacyDraftSource || context.original) : structuredClone(context.draft);
  context.saveCatalog = async ({ catalog }) => { context.lastSavedCatalog = structuredClone(catalog); return true; };
  const save = studio.slice(studio.indexOf('async function saveDraft('), studio.indexOf('async function duplicate('));
  const publish = studio.slice(studio.indexOf('async function publish('), studio.indexOf('\nfields.forEach(', studio.indexOf('async function publish(')));
  vm.createContext(context);
  vm.runInContext(`${save}\n${publish}`, context);
  return context;
}

test('a rejected catalog save preserves selection, unsaved edits, and approved source', async () => {
  const context = lifecycleHarness();
  const before = structuredClone({ store: context.store, draft: context.draft, original: context.original, selectedId: context.selectedId });
  context.saveCatalog = async () => false;
  assert.equal(await context.saveDraft(), false);
  assert.deepEqual({ store: context.store, draft: context.draft, original: context.original, selectedId: context.selectedId }, before);
});

test('the actual legacy save path preserves raw appearance and version absence despite normalized editor fields', async () => {
  const context = lifecycleHarness();
  context.draft.fontWeight = 700;
  context.draft.componentColors = { navigation: { text: '#ffffff' } };
  assert.equal(await context.saveDraft(), true);
  const saved = context.store.skins.find(skin => skin.id === 'new-copy');
  assert.equal(Object.hasOwn(saved, 'rendererVersion'), false);
  assert.equal(Object.hasOwn(saved, 'componentColors'), false);
  assert.equal(Object.hasOwn(saved, 'fontWeight'), false);
  assert.equal(saved.name, 'Edited source');
  assert.deepEqual(context.store.skins.find(skin => skin.id === 'approved'), { id: 'approved', name: 'Source', status: 'Approved', access: { type: 'invited' } });
});

test('the actual save workflow adopts a new draft ID without dropping edits arriving during save', async () => {
  const context = lifecycleHarness();
  context.saveCatalog = async ({ catalog }) => {
    context.lastSavedCatalog = structuredClone(catalog);
    context.draft.name = 'Newer unsaved name'; context.draftRevision += 1;
    return true;
  };
  assert.equal(await context.saveDraft(), true);
  assert.equal(context.selectedId, 'new-copy');
  assert.equal(context.draft.name, 'Newer unsaved name');
  assert.equal(context.original.name, 'Edited source');
  assert.equal(context.store.skins.find(skin => skin.id === 'approved').name, 'Source');
  assert.equal(context.store.skins.find(skin => skin.id === 'new-copy').status, 'Draft');
});

test('rejected explicit publication retains the saved Draft and approved source without false approval', async () => {
  const context = lifecycleHarness();
  context.fetch = async () => ({ ok: false, json: async () => ({ error: 'Restricted source cannot be published.' }) });
  await context.publish();
  assert.equal(context.store.skins.find(skin => skin.id === 'new-copy').status, 'Draft');
  assert.equal(context.draft.status, 'Draft');
  assert.equal(context.store.skins.find(skin => skin.id === 'approved').status, 'Approved');
  assert.equal(context.feedback.title, 'Publishing failed.');
  assert.equal(context.savingCatalog, false);
});

test('canceling publication performs no catalog or publish writes', async () => {
  const context = lifecycleHarness();
  context.confirm = () => false;
  context.saveCatalog = async () => { throw new Error('Catalog write must not run'); };
  context.fetch = async () => { throw new Error('Publish write must not run'); };
  await context.publish();
  assert.equal(context.store.skins.length, 1);
  assert.equal(context.selectedId, 'approved');
});

test('failed geometry preflight blocks publication before confirmation or writes', async () => {
  const context = lifecycleHarness();
  context.ensureGeometryPreflight = async () => false;
  context.confirm = () => { throw new Error('No approval prompt for failed geometry'); };
  context.saveCatalog = async () => { throw new Error('No catalog write for failed geometry'); };
  context.fetch = async () => { throw new Error('No publish write for failed geometry'); };
  assert.equal(await context.publish(), false);
  assert.equal(context.selectedId, 'approved');
});

test('repeated approved-source forks preserve its exact saved version payloads', () => {
  const source = { id: 'approved-source', name: 'Source', status: 'Approved', versions: [{ id: 'original-version', label: 'Original', savedAt: '2026-11-23', appearance: { id: 'approved-source', background: '#102030' } }] };
  const before = structuredClone(source);
  let catalog = { skins: [source] };
  for (let index = 0; index < 5; index++) catalog = prepareDraftSave({ catalog, selectedId: source.id, draft: { ...source, background: '#203040' }, id: `copy-${index}`, edited: 'Today' }).catalog;
  assert.deepEqual(catalog.skins.find(skin => skin.id === source.id), before);
  assert.deepEqual(source, before);
});

test('actual saved-version recording stays bounded and never nests prior version arrays', () => {
  const source = studio.slice(studio.indexOf('function versionAppearance('), studio.indexOf('const versionHistoryPanel ='));
  const context = { SKIN_VERSION_LIMIT: 12, clone: structuredClone };
  vm.createContext(context); vm.runInContext(source, context);
  const skin = { id: 'draft', name: 'Draft', status: 'Draft', versions: [] };
  for (let index = 0; index < 17; index++) { skin.name = `Revision ${index}`; context.recordSavedSkinVersion(skin, `Save ${index}`); }
  assert.equal(skin.versions.length, 12);
  assert.equal(skin.versions[0].label, 'Save 5');
  assert.ok(skin.versions.every(version => !Object.hasOwn(version.appearance, 'versions')));
});

test('editing canonical Neutral Arc immediately previews an editable draft identity', () => {
  const context = lifecycleHarness();
  Object.assign(context, { CANONICAL_NEUTRAL_ID, nativeDraftIcons, selectedId: CANONICAL_NEUTRAL_ID, draft: { id: CANONICAL_NEUTRAL_ID, name: 'Neutral Arc', status: 'Approved' }, $: () => ({}), renderLibrary() {} });
  vm.runInContext(studio.match(/function changed\(\) \{[^\n]+\}/)[0], context);
  context.changed();
  assert.equal(context.selectedId, 'new-copy');
  assert.equal(context.draft.id, 'new-copy');
  assert.equal(context.draft.sourceSkinId, CANONICAL_NEUTRAL_ID);
  assert.equal(context.draft.status, 'Draft');
  assert.equal(context.draft.name, 'Neutral Studio draft');
});

test('clean canonical Save is a no-op and canonical Duplicate starts an unsaved editable recipe', async () => {
  const context = lifecycleHarness();
  context.selectedId = CANONICAL_NEUTRAL_ID;
  context.draft = context.original = { id: CANONICAL_NEUTRAL_ID, name: 'Neutral Arc', status: 'Approved' };
  context.saveCatalog = async () => { throw new Error('The built-in reference must not write a catalog copy'); };
  assert.equal(await context.saveDraft(), false);
  context.newSkin = options => { context.newOptions = options; };
  const source = studio.slice(studio.indexOf('async function duplicate('), studio.indexOf('async function publish('));
  vm.runInContext(source, context);
  await context.duplicate();
  assert.equal(context.newOptions.name, 'Neutral Studio draft');
});

test('ordinary catalog Duplicate retains its explicit saved-copy workflow', async () => {
  const context = lifecycleHarness();
  context.saveDraft = async (label, options) => { context.duplicateOptions = options; return true; };
  const source = studio.slice(studio.indexOf('async function duplicate('), studio.indexOf('async function publish('));
  vm.runInContext(source, context);
  assert.equal(await context.duplicate(), true);
  assert.equal(context.duplicateOptions.duplicate, true);
});

test('starter recipes contain cosmetic values only, including seasonal and premium or achievement candidates', () => {
  const presets = new Function(`${studio.slice(studio.indexOf('const appearancePresets ='), studio.indexOf('const presetsPanel ='))}; return appearancePresets;`)();
  for (const name of ['neutral', 'highContrast', 'midnightGlass', 'seasonalEmber', 'achievementCandidate', 'premiumCandidate']) {
    assert.ok(presets[name], name);
    assert.ok(presets[name].values.componentColors.endTurn);
    for (const forbidden of ['access', 'grants', 'invitation', 'achievement', 'status', 'id', 'gameDefaultLayout']) assert.ok(!Object.hasOwn(presets[name].values, forbidden), `${name} must not set ${forbidden}`);
  }
});

test('backup validation rejects changed artwork bytes under an existing stable asset ID', () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
  const otherPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const asset = { id: 'background', name: 'Backdrop', source: 'Original fixture', placement: 'background' };
  const confirmedCatalog = { schemaVersion: 1, skins: [], assets: [asset] };
  const source = studio.slice(studio.indexOf('function inspectCatalogBackup('), studio.indexOf('async function readCatalogBackupFile('));
  const context = { confirmedCatalog, store: { assets: [{ ...asset, data: png }] }, APPEARANCE_CATALOG_SCHEMA_VERSION: 1, validateAppearanceCatalog, validateAppearanceAsset, assertAppearanceValid, prepareCatalogRestore, backupMetadata };
  vm.createContext(context); vm.runInContext(source, context);
  assert.throws(() => context.inspectCatalogBackup({ ...confirmedCatalog, assets: [{ ...asset, data: otherPng }] }), /new asset ID|different artwork/i);
});

test('loading artwork hydrates bytes while preserving exact catalog metadata', async () => {
  const source = studio.match(/async function loadAssetData\(asset\) \{[^\n]+\}/)[0];
  const context = { developerKey: 'test', fetch: async () => ({ ok: true, json: async () => ({ asset: { id: 'art', status: 'Pending', width: 1, data: 'image-bytes' } }) }) };
  vm.createContext(context); vm.runInContext(source, context);
  const hydrated = await context.loadAssetData({ id: 'art', status: 'Approved', source: 'Exact old catalog metadata' });
  assert.deepEqual(JSON.parse(JSON.stringify(hydrated)), { id: 'art', status: 'Approved', source: 'Exact old catalog metadata', data: 'image-bytes' });
});

test('one missing artwork file keeps the catalog and unrelated artwork inspectable', async () => {
  const remote = { schemaVersion: 1, revision: 2, skins: [{ id: 'saved', name: 'Existing', status: 'Approved' }], assets: [{ id: 'missing', name: 'Missing metadata' }, { id: 'good', name: 'Good metadata' }], selected: 'saved' };
  const context = {
    developerKey: 'test', savingCatalog: false, store: null, confirmedCatalog: null, CANONICAL_NEUTRAL_ID, clone: structuredClone,
    fetch: async () => ({ ok: true, json: async () => ({ catalog: structuredClone(remote) }) }),
    loadAssetData: async asset => { if (asset.id === 'missing') throw new Error('Blob unavailable'); return { ...asset, data: 'good-image' }; },
    isDraftDirty: () => false, selectSkin() {}, renderLibrary() {}, renderEditor() {}, renderPreview() {}, validate() {}, notifyDraftState() {}, recoverDraft() {}, setSaveState() {}, toast() {},
    $: () => ({hidden:false}),
    showAssetLoadStatus(ids) { context.failedAssets = ids; }
  };
  const source = studio.slice(studio.indexOf('async function loadCatalog()'), studio.indexOf('\nselectSkin(selectedId);', studio.indexOf('async function loadCatalog()')));
  vm.createContext(context); vm.runInContext(source, context); await context.loadCatalog();
  assert.equal(context.store.skins[0].id, 'saved');
  assert.equal(context.store.assets.find(asset => asset.id === 'missing').name, 'Missing metadata');
  assert.equal(context.store.assets.find(asset => asset.id === 'good').data, 'good-image');
  assert.deepEqual(Array.from(context.failedAssets), ['missing']);
});

test('export refuses a portable backup when an artwork file is unavailable', () => {
  const source = studio.slice(studio.indexOf('function catalogBackup()'), studio.indexOf('function inspectCatalogBackup('));
  const context = { store: { skins: [], assets: [{ id: 'missing', name: 'Lost artwork', source: 'Original', placement: 'background' }] }, selectedId: CANONICAL_NEUTRAL_ID, APPEARANCE_CATALOG_SCHEMA_VERSION: 1, clone: structuredClone, validateAppearanceAsset };
  vm.createContext(context); vm.runInContext(source, context);
  assert.throws(() => context.catalogBackup(), /export|missing|unavailable/i);
});

test('audience labels follow recorded server policy and copied source lineage without implying unlocks', () => {
  const source = { id: 'neutral', name: 'Legacy invitation', status: 'Approved' };
  const draft = { id: 'copy', sourceSkinId: source.id, status: 'Draft' };
  const audiences = new Map([[source.id, 'Invitation']]);
  const records = new Map([[source.id, JSON.stringify(source)]]);
  assert.equal(appearanceAudience(draft, { skins: [source, draft], audiences, records }), 'Invitation');
  assert.equal(appearanceAudience({ id: 'new', status: 'Draft' }, { skins: [], audiences, records }), 'Studio draft');
});

test('stale GET audience labels are invalidated when the corresponding saved record changes', () => {
  const old = { id: 'work', status: 'Draft', name: 'Before approval' };
  const now = { ...old, status: 'Approved' };
  assert.equal(appearanceAudience(now, { skins: [now], audiences: new Map([[old.id, 'Studio draft']]), records: new Map([[old.id, JSON.stringify(old)]]) }), '');
});

test('Undo of the first automatic baseline edit restores canonical identity and Redo restores its fork', () => {
  const original = { id: CANONICAL_NEUTRAL_ID, name: 'Neutral Arc', status: 'Approved', accent: '#d8ae61' };
  const fork = { ...original, id: 'automatic-fork', status: 'Draft', sourceSkinId: CANONICAL_NEUTRAL_ID, accent: '#abcdef' };
  const undone = restoreDraftSnapshot(original, { original, selectedId: fork.id });
  assert.equal(undone.selectedId, CANONICAL_NEUTRAL_ID);
  assert.deepEqual(undone.draft, original);
  const redone = restoreDraftSnapshot(fork, { original, selectedId: CANONICAL_NEUTRAL_ID });
  assert.equal(redone.selectedId, fork.id);
  assert.deepEqual(redone.draft, fork);
});

test('Undo keeps an explicitly created draft identity even when its values match the baseline', () => {
  const original = { id: 'explicit-new', name: 'New skin', status: 'Draft', sourceSkinId: CANONICAL_NEUTRAL_ID };
  const undone = restoreDraftSnapshot(original, { original, selectedId: original.id });
  assert.equal(undone.selectedId, original.id);
  assert.deepEqual(undone.draft, original);
});

test('Undo to saved values preserves current lifecycle metadata and compares clean despite object key order', () => {
  const original = { id: 'saved-copy', status: 'Draft', edited: 'Today', sourceSkinId: 'protected', versions: [], name: 'My skin', accent: '#abcdef', access: { type: 'invitation' } };
  const priorSnapshot = { name: 'My skin', accent: '#abcdef', id: 'protected', status: 'Approved', edited: 'Old', access: { type: 'invitation' } };
  const undone = restoreDraftSnapshot(priorSnapshot, { original, selectedId: original.id });
  assert.equal(draftsEqual(undone.draft, original), true);
  assert.deepEqual(undone.draft.access, original.access);
});
