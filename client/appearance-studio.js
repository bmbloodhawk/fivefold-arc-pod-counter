import { mountStudioReleaseEditor } from './studio-release-editor.js';
import { mountStudioRewardEditor } from './studio-reward-editor.js';
import { mountDevicePreview } from './device-preview.js?v=7';
import { PREVIEW_STATES, previewMessageAllowed, previewViewportChecks, phoneLayoutChanges, rendererComponentDefaults, materializeRendererSkin, appearanceFingerprint, needsGeometryPreflight, preflightProofMatches } from './renderer-bridge.js?v=11';
import { publicAppearanceSkin, validateAppearanceSkin, appearanceAssetReferences, inspectImageData } from './appearance-validation.js?v=5';
import { mountSurfaceEditor } from './appearance-surface-editor.js';
import { appearanceFontKeys, mountAppearanceFontPicker } from './appearance-fonts.js';
import { mountSurfaceArtEditor } from './appearance-surface-art-editor.js';
import { mountPartPicker } from './appearance-part-picker.js';
import { mountStarterPicker } from './appearance-starter-picker.js';
import { mountTableDesignEditor } from './appearance-table-editor.js?v=3';
import { openAssetCrop } from './appearance-asset-crop.js';
import { mountCommanderTreatmentEditor } from './commander-treatment-editor.js?v=3';
import { mountStudioWorkspace } from './appearance-workspace.js';
import { mountAppearanceTreatments } from './appearance-studio-controls.js';
import { mountPaletteInputs } from './appearance-studio-palette.js';
import { nativeDraftIcons } from './counter-design.js?v=5';
import { renderNativeIconEditor, mountCounterDesignEditor } from './counter-design-editor.js?v=6';
import { resolveDesignArtwork } from './appearance-design-artwork.js?v=2';
import { measurePreviewDocument, settlePreviewDocument } from './appearance-preflight.js';
import { appearanceReadability } from './appearance-readability.js?v=4';
import { assetUsages, renderAssetLibrary, assetInspection, artworkSizeHint, artworkFitNote } from './appearance-studio-assets.js';
let rendererPreviewPayload = null, rendererPreviewSync = null, preflightProof = null;
import { CANONICAL_NEUTRAL_ID, prepareDraftSave, settleDraftSave, comparisonOptions, resolveComparisonSkin, resetAppearanceSection, appearanceAudience, restoreDraftSnapshot, draftsEqual } from './appearance-studio-drafts.js';
import { validateAppearanceCatalog, validateAppearanceAsset, assertAppearanceValid } from './appearance-validation.js?v=5';
import { isLegacyAppearance, legacyDraftAppearance, expandedDraft, historyEntry, mountRendererLifecycle } from './appearance-renderer-lifecycle.js';
import { prepareCatalogRestore, backupMetadata, PORTABLE_BACKUP_FILE_LIMIT } from './appearance-studio-backups.js';
const $ = s => document.querySelector(s); const $$ = s => [...document.querySelectorAll(s)];
const KEY = 'fivefold-arc:appearance-studio'; let developerKey = sessionStorage.getItem('fivefold-arc:developer-key') || '';
const RECOVERY_KEY = `${KEY}:recovery`;
let studioReady = false, draftRevision = 0, confirmedCatalog = null, lastSavedCatalog = null, comparisonTarget = 'saved', recoveryAttempted = false, catalogConflict = false;
let catalogAudiences = new Map(), catalogAudienceRecords = new Map();
let legacyDraftSource = null, renderRendererLifecycle = () => {}, renderCounterDesign = () => {};
let exactPreviewFallbackTimer = 0;
function showExactPreviewRecovery() {
  document.body.dataset.previewFallback = 'true';
  const recovery = $('#exactPreviewRecovery');
  if (recovery) recovery.hidden = false;
  const note = $('#compareNote');
  if (note) note.innerHTML = 'This browser blocked the embedded preview. Use the <strong>exact phone preview</strong> instead—its dial, life total, and seal are the real game renderer.';
}
function markExactPreviewReady() {
  clearTimeout(exactPreviewFallbackTimer);
  document.body.dataset.previewFallback = 'false';
  const recovery = $('#exactPreviewRecovery');
  if (recovery) recovery.hidden = true;
  renderExactPreview();
}
window.addEventListener('message', event => {
  if (previewMessageAllowed(event, location.origin, $('#exactPreview')?.contentWindow) && event.data?.type === 'fivefold-arc:appearance-preview-ready') markExactPreviewReady();
});
const icons = { life: '♥', commander: '♜', radiation: '☢', poison: '☠', energy: 'ϟ', generic: '◇' };
const labels = { life: 'Life', commander: 'Commander damage', radiation: 'Radiation', poison: 'Poison', energy: 'Energy', generic: 'Generic counters' };
const neutral = { id: 'neutral', name: 'Neutral Arc', status: 'Approved', edited: 'Built in', background: '#080808', surface: '#161616', accent: '#d8ae61', secondary: '#6e552a', text: '#f4ecd9', muted: '#afa590', atmosphere: 'dark', atmosphereColor: '#70a97a', atmosphereStrength: 35, atmospherePosition: 'top', backgroundTreatment: 'plain', backgroundAsset: '', backgroundScale: 100, backgroundPositionX: 50, backgroundPositionY: 50, ring: 'arc', sealAsset: '', buttonTreatment: 'glass', buttonOpacity: 100, buttonBlur: 0, buttonBorder: 70, lifeButtonOpacity: 100, lifeButtonBlur: 0, lifeButtonBorder: 70, customLifeOpacity: 100, customLifeBlur: 0, customLifeBorder: 70, commanderTaxOpacity: 100, commanderTaxBlur: 0, commanderTaxBorder: 70, commanderDamageOpacity: 100, commanderDamageBlur: 0, commanderDamageBorder: 70, seatTreatment: 'raised', seatOpacity: 100, seatBlur: 0, seatBorder: 70, symbols: { ...icons }, symbolAssets: {}, symbolScale: {} };
neutral.id = CANONICAL_NEUTRAL_ID;
let store; try { store = JSON.parse(localStorage.getItem(KEY)) || { skins: [], selected: CANONICAL_NEUTRAL_ID }; } catch { store = { skins: [], selected: CANONICAL_NEUTRAL_ID }; }
store.assets ||= []; store.skins ||= [];
let selectedId = store.selected || CANONICAL_NEUTRAL_ID, draft = null, original = null, previewState = 'turn', previewMode = 'life', previewPlayers = 4, showingBaseline = false;
let commanderPreviewContext = { previewCommanderColors: ['U', 'R'] };
const fields = ['name','background','surface','accent','secondary','text','muted','atmosphere','atmosphereColor','atmosphereStrength','atmospherePosition','backgroundTreatment','backgroundScale','backgroundPositionX','backgroundPositionY','ring','sealAsset','buttonTreatment','buttonOpacity','buttonBlur','buttonBorder','lifeButtonOpacity','lifeButtonBlur','lifeButtonBorder','customLifeOpacity','customLifeBlur','customLifeBorder','commanderTaxOpacity','commanderTaxBlur','commanderTaxBorder','commanderDamageOpacity','commanderDamageBlur','commanderDamageBorder','seatTreatment','seatOpacity','seatBlur','seatBorder'];
// Foundation used to be one permanently expanded form. Group the existing
// controls without changing their IDs or their behavior, so the live preview
// stays beside the one visual decision the designer is making.
function foldControls(summary, nodes, className = 'studio-fold') { const fold = document.createElement('details'); fold.className = className; fold.innerHTML = `<summary>${summary}</summary>`; nodes.filter(Boolean).forEach(node => fold.append(node)); return fold; }
function compactFoundation() { const foundation = $('.property-editor'); const heading = foundation?.querySelector('.section-heading'); if (!foundation || !heading) return; const skinName = $('#skinName')?.closest('label'); const colors = foundation.querySelector('.color-grid'); const atmosphere = [$('#atmosphere')?.closest('label'), foundation.querySelector('.atmosphere-controls')]; const appearance = [$('#backgroundTreatment')?.closest('label'), $('#backgroundAsset')?.closest('label'), foundation.querySelector('.background-art-controls'), $('#ring')?.closest('label'), $('#sealAsset')?.closest('label')]; const buttonTreatment = $('#buttonTreatment')?.closest('label'); const groups = [foldControls('Skin name', [skinName]), foldControls('Colors & atmosphere', [colors, ...atmosphere]), foldControls('Background & center seal', appearance), foldControls('Action treatment', [buttonTreatment])]; groups.reverse().forEach(group => heading.after(group)); const advanced = foundation.querySelector('.advanced-styling'); if (!advanced) return; advanced.classList.add('studio-fold'); advanced.open = false; const helper = advanced.querySelector('.helper'); const blocks = Array.from(advanced.querySelectorAll(':scope > .background-art-controls')); const seatTreatment = advanced.querySelector(':scope > label'); if (helper) helper.remove(); const advancedGroups = [foldControls('End Turn button', [blocks[0]], 'component-placement'), foldControls('Life change buttons', [blocks[1]], 'component-placement'), foldControls('Custom life button', [blocks[2]], 'component-placement'), foldControls('Commander card', [blocks[3]], 'component-placement'), foldControls('Commander damage cards', [blocks[4]], 'component-placement'), foldControls('Player cards', [seatTreatment, blocks[5]], 'component-placement')]; advancedGroups.forEach(group => advanced.append(group)); }
compactFoundation();
function normalizeSkin(skin) { Object.assign(skin,materializeRendererSkin(skin)); skin.atmosphere ||= 'custom'; skin.ring ||= 'arc'; skin.backgroundAsset ||= ''; skin.sealAsset ||= ''; skin.symbolAssets ||= {}; skin.symbolScale ||= {}; skin.atmosphereColor ||= skin.secondary || '#70a97a'; skin.atmosphereStrength = tokenNumber(skin.atmosphereStrength, 0, 0, 80); skin.atmospherePosition ||= 'top'; skin.backgroundScale = Math.min(200, Math.max(50, Number(skin.backgroundScale) || 100)); skin.backgroundPositionX = tokenNumber(skin.backgroundPositionX, 50, 0, 100); skin.backgroundPositionY = tokenNumber(skin.backgroundPositionY, 50, 0, 100); ['button','lifeButton','customLife','commanderTax','commanderDamage','seat'].forEach(prefix => { skin[`${prefix}Opacity`] = Math.min(100, Math.max(35, Number(skin[`${prefix}Opacity`]) || 100)); skin[`${prefix}Blur`] = Math.min(16, Math.max(0, Number(skin[`${prefix}Blur`]) || 0)); skin[`${prefix}Border`] = Math.min(100, Math.max(0, Number.isFinite(Number(skin[`${prefix}Border`])) ? Number(skin[`${prefix}Border`]) : 70)); }); }
const normalizeSkinBase = normalizeSkin;
normalizeSkin = function(skin) { normalizeSkinBase(skin); skin.symbols ||= skin.rendererVersion === 2 ? {} : { ...icons }; Object.keys(icons).forEach(mode => { skin.symbolScale[mode] = tokenNumber(skin.symbolScale[mode], 100, 60, 200); }); };
function saveStore() { try { if (location.protocol !== 'file:') { localStorage.removeItem(KEY); return true; } localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* direct-file cache is optional */ } return true; }
const catalogHeaders = { 'content-type': 'application/json', get 'x-feedback-portal-key'() { return developerKey; } };
let savingCatalog = false;
function setCatalogSaving(active, label = 'Saving draft') { savingCatalog = active; ['saveButton', 'duplicateButton', 'publishButton', 'importAssetButton', 'restoreCatalogButton'].forEach(id => { const button = $(`#${id}`); if (button) button.disabled = active; }); if (active) setSaveState(`${label}…`); updateDraftActionControls(); }
async function saveCatalog({ label = 'Saving draft', catalog = store, restore = false } = {}) {
  if (savingCatalog) return false;
  setCatalogSaving(true, label);
  try {
    const snapshot = clone(catalog);
    const metadata = { ...snapshot, assets: snapshot.assets.map(({ data, pendingUpload, ...asset }) => asset) };
    assertAppearanceValid(validateAppearanceCatalog(metadata, { previous: confirmedCatalog, mode: restore ? 'restore' : 'draft' }));
    const assets = snapshot.assets.filter(item => item.data && item.pendingUpload);
    for (let index = 0; index < assets.length; index += 1) {
      assertAppearanceValid(validateAppearanceAsset(assets[index], { requireData: true }));
      setSaveState(`${label}… artwork ${index + 1} of ${assets.length}`);
      const response = await fetch(`/api/appearance-studio/assets/${assets[index].id}`, { method: 'PUT', headers: catalogHeaders, body: JSON.stringify(assets[index]) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The artwork upload failed.');
      Object.assign(assets[index], result.asset || {});
      delete assets[index].pendingUpload;
    }
    setSaveState(`${label}… catalog`);
    const payload = { ...snapshot, assets: snapshot.assets.map(({ data, pendingUpload, ...asset }) => asset) };
    const response = await fetch(restore ? '/api/appearance-studio/catalog/restore' : '/api/appearance-studio/catalog', { method: restore ? 'POST' : 'PUT', headers: catalogHeaders, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error || 'The protected catalog rejected this save.'), { status: response.status });
    confirmedCatalog = clone(result.catalog || payload);
    lastSavedCatalog = { ...clone(confirmedCatalog), assets: confirmedCatalog.assets.map(asset => ({ ...asset, data: snapshot.assets.find(item => item.id === asset.id)?.data })) };
    return true;
  } catch (error) {
    if (error.status === 409) { showCatalogConflict(); return false; }
    setSaveState('Save failed — try again');
    toast(error.message || 'The catalog was not saved. Check your connection and developer access, then retry.');
    return false;
  } finally { setCatalogSaving(false); }
}
async function loadAssetData(asset) { if (asset.data) return asset; const response = await fetch(`/api/appearance-studio/assets/${asset.id}`, { headers: { 'x-feedback-portal-key': developerKey } }); if (!response.ok) throw new Error(); const loaded = (await response.json()).asset; return { ...asset, data: loaded?.data }; }
function showAssetLoadStatus(ids) {
  const status = $('#assetStatus');
  let retry = $('#retryCatalogAssets');
  if (ids.length) {
    status.textContent = `${ids.length} artwork file${ids.length === 1 ? ' is' : 's are'} unavailable. Catalog metadata is retained so you can inspect placements and edit unrelated skins. Retry loading the files before exporting or publishing a skin that uses them.`;
    if (!retry) { retry = document.createElement('button'); retry.id = 'retryCatalogAssets'; retry.type = 'button'; retry.className = 'secondary-action'; retry.textContent = 'Retry missing artwork'; retry.addEventListener('click', () => { void loadCatalog(); }); status.after(retry); }
    retry.hidden = false;
    toast('Catalog opened with unavailable artwork. Review the Asset library and retry the missing files.');
  } else { if (retry) { retry.hidden = true; status.textContent = 'All catalog artwork loaded.'; } }
}
function selected() { return selectedId === CANONICAL_NEUTRAL_ID ? neutral : store.skins.find(s => s.id === selectedId) || neutral; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function relativeDate() { return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date()); }
function toast(message) { const el = $('#toast'); el.textContent = message; el.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => el.hidden = true, 2600); }
function setSaveState(text = 'Unsaved') { $('#saveState').textContent = text; updateDraftActionControls(); notifyDraftState(); }
function updateDraftActionControls() {
  const reference = selectedId === CANONICAL_NEUTRAL_ID && !isDraftDirty();
  const save = $('#saveButton'), approve = $('#publishButton'), duplicate = $('#duplicateButton');
  if (save) { save.disabled = savingCatalog || reference; save.setAttribute('aria-describedby', 'saveState'); }
  if (approve) { approve.disabled = savingCatalog || reference; approve.setAttribute('aria-describedby', 'saveState'); }
  if (duplicate) { duplicate.disabled = savingCatalog; duplicate.textContent = reference ? 'Start editable neutral draft' : 'Duplicate skin'; }
  renderRendererLifecycle();
}
function normalizeEditableSkin(skin) {
  normalizeSkin(skin);
  if (studioReady) { normalizeUxSkin(skin); normalizeAppearanceTokens(skin); normalizeComponentColors(skin); }
  return skin;
}
function getDraftAppearance() { return isLegacyAppearance(draft) ? legacyDraftAppearance(draft, legacyDraftSource || original) : clone(draft); }
function isDraftDirty() { return studioReady && draft && original && ((selectedId !== CANONICAL_NEUTRAL_ID && !store.skins.some(skin => skin.id === selectedId)) || (isLegacyAppearance(draft) ? !draftsEqual(getDraftAppearance(), original) : !draftsEqual(normalizeEditableSkin(clone(draft)), normalizeEditableSkin(clone(original))))); }
function draftStatusLabel() { return isDraftDirty() ? 'Unsaved draft' : selectedId === CANONICAL_NEUTRAL_ID ? 'Game default reference · start an editable draft to save' : original.status === 'Approved' ? 'Approved source · edits save as a new draft' : 'Saved draft'; }
function notifyDraftState() {
  if (!studioReady) return;
  document.dispatchEvent(new CustomEvent('studio:draft-state', { detail: { selectedId, dirty: Boolean(isDraftDirty()), comparisonTarget, comparing: showingBaseline, saving: savingCatalog } }));
}
function rememberDraft() {
  if (!studioReady) return;
  try { if (isDraftDirty()) sessionStorage.setItem(RECOVERY_KEY, JSON.stringify({ selectedId, draft, original, legacySource: legacyDraftSource })); else if (recoveryAttempted) sessionStorage.removeItem(RECOVERY_KEY); } catch { /* The active draft still remains in memory. */ }
}
function recoverDraft() {
  if (recoveryAttempted || !studioReady || isDraftDirty()) return;
  recoveryAttempted = true;
  try {
    const recovery = JSON.parse(sessionStorage.getItem(RECOVERY_KEY) || 'null');
    if (!recovery?.draft) return;
    if (!confirm('Recover the unsaved appearance draft from this tab? This does not save or publish it.')) { sessionStorage.removeItem(RECOVERY_KEY); return; }
    selectedId = recovery.selectedId;
    legacyDraftSource = isLegacyAppearance(recovery.draft) ? clone(recovery.legacySource || recovery.draft) : null;
    draft = normalizeEditableSkin(clone(recovery.draft));
    original = clone(recovery.original || selected());
    draftRevision += 1;
    resetDraftHistory(); renderLibrary(); renderEditor(); renderPreview(); validate(); setSaveState('Recovered unsaved draft');
  } catch { toast('The recovery copy could not be opened. Your saved catalog is unchanged.'); }
}
function newDraftId() { return `skin-${crypto.randomUUID()}`; }
function newSkin({ name = 'Untitled skin', appearance = {} } = {}) {
  if (savingCatalog || (isDraftDirty() && !confirm('Discard these unsaved changes and create a new skin draft?'))) return;
  selectedId = newDraftId();
  draft = normalizeEditableSkin(nativeDraftIcons({ ...clone(neutral), ...clone(appearance), id: selectedId, sourceSkinId: CANONICAL_NEUTRAL_ID, name, status: 'Draft', rendererVersion: 2, edited: relativeDate() }));
  original = clone(draft); legacyDraftSource = null; showingBaseline = false; comparisonTarget = 'saved'; draftRevision += 1;
  renderLibrary(); renderEditor(); renderPreview(); validate(); resetDraftHistory(); rememberDraft(); setSaveState('New unsaved draft');
  return true;
}
function getStudioComparisonOptions() { return comparisonOptions(store.skins, selectedId); }
function showCatalogConflict(refreshed = false) {
  catalogConflict = true;
  setSaveState(refreshed ? 'Catalog refreshed · retained draft will save as a new copy' : 'Catalog changed elsewhere · unsaved draft retained');
  showPublishFeedback(refreshed ? 'Catalog refreshed. Your draft is retained.' : 'The catalog changed in another window.', refreshed ? 'Review your retained work, then Save draft again. It will create a separate new draft so changes from the other window are preserved.' : 'Your unsaved work is retained. Refresh the catalog before retrying; the next save will create a separate new draft and preserve changes from the other window.');
  if (!refreshed) {
    const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'secondary-action'; retry.id = 'refreshCatalogButton'; retry.textContent = 'Refresh catalog safely';
    retry.addEventListener('click', () => { void loadCatalog(); }); $('#publishFeedback').append(retry);
  }
}
function getPreviewSkin() { return showingBaseline ? resolveComparisonSkin(comparisonTarget, { skins: store.skins, original, neutral }) : getDraftAppearance(); }
function useExpandedControls() {
  if (savingCatalog || !isLegacyAppearance(draft)) return;
  draft = expandedDraft(draft, newDraftId()); selectedId = draft.id; legacyDraftSource = null;
  renderLibrary(); renderEditor(); changed();
  toast('Expanded controls are staged in a separate unsaved draft. Compare shows the saved original; Undo reverses this change.');
}
function setStudioComparison(target) { comparisonTarget = getStudioComparisonOptions().some(option => option.value === target) ? target : 'saved'; showingBaseline = true; renderPreview(); notifyDraftState(); }
function toggleStudioComparison() { showingBaseline = !showingBaseline; renderPreview(); notifyDraftState(); }
function resetStudioSection(section) {
  if (savingCatalog || !draft) return;
  if (isLegacyAppearance(draft)) return toast('Use expanded controls before resetting visual sections. The original appearance is preserved.');
  draft = resetAppearanceSection(draft, normalizeEditableSkin(clone(original || neutral)), section);
  normalizeEditableSkin(draft); renderEditor(); changed();
  toast('This section was reset to its last saved values. Undo restores your changes.');
}
function revertDraft() {
  if (savingCatalog) return;
  const restored = restoreDraftSnapshot(original, { original, selectedId });
  selectedId = restored.selectedId; legacyDraftSource = isLegacyAppearance(restored.draft) ? clone(original) : null; draft = normalizeEditableSkin(restored.draft); showingBaseline = false; draftRevision += 1;
  renderLibrary(); renderEditor(); renderPreview(); validate(); recordDraftHistory(); rememberDraft(); setSaveState(draftStatusLabel());
}
function clearPublishFeedback() { $('#publishFeedback').hidden = true; $('#publishFeedback').replaceChildren(); }
function showPublishFeedback(title, reason) { const feedback = $('#publishFeedback'); feedback.replaceChildren(); const heading = document.createElement('strong'), detail = document.createElement('span'); heading.textContent = title; detail.textContent = reason; feedback.append(heading, detail); feedback.hidden = false; feedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
function skinLibraryThumbnail(skin) {
  const asset = store.assets.find(item => item.id === skin.thumbnailAsset && item.placement === 'thumbnail');
  if (asset && !validateAppearanceAsset(asset, { requireData: true }).errors.length) return `<img class="skin-thumb" src="${asset.data}" alt="" loading="lazy">`;
  const color = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value)) ? value : fallback;
  return `<span class="skin-thumb" style="--thumb-bg:${color(skin.background, neutral.background)};--thumb-accent:${color(skin.accent, neutral.accent)}"></span>`;
}
function skinLibraryAccess(skin) {
  if (skin.id === CANONICAL_NEUTRAL_ID) return 'Built-in game default · reference. Start an editable neutral draft to customize it.';
  const policy = appearanceAudience(skin, { skins: store.skins, audiences: catalogAudiences, records: catalogAudienceRecords });
  if (['Invitation', 'Achievement', 'Restricted source'].includes(policy)) return `${skin.status === 'Draft' ? 'Studio draft · ' : ''}Catalog policy: ${policy}. Individual access remains server controlled.`;
  if (skin.invitation) return 'Invitation metadata recorded · access remains server controlled';
  if (skin.achievement) return 'Achievement metadata recorded · access remains server controlled';
  if (skin.access || skin.grants) return 'Access restrictions recorded · no grants changed';
  if (skin.sourceSkinId) return 'Source lineage retained · access checked when publishing';
  if (policy === 'Available to select') return 'Catalog policy: Available to select · personal and table choices are unchanged';
  if (policy === 'Studio draft') return 'Studio draft · save and approval are separate from active player appearance';
  if (skin.status === 'Approved') return 'Approved catalog appearance · selection availability is checked by the server';
  return 'Catalog appearance · active table and personal selection unchanged';
}
function renderLibrary() {
  const query = $('#skinSearch').value.trim().toLowerCase();
  const rows = [neutral, ...store.skins, ...(draft && draft.id === selectedId && selectedId !== CANONICAL_NEUTRAL_ID && !store.skins.some(skin => skin.id === selectedId) ? [{ ...draft, status: 'Unsaved draft' }] : [])];
  $('#skinLibrary').innerHTML = rows.filter(skin => String(skin.name || '').toLowerCase().includes(query)).map(skin => `<div class="skin-library-item"><button class="skin-card ${skin.id === selectedId ? 'selected' : ''}" data-skin="${escape(skin.id)}" type="button" aria-pressed="${skin.id === selectedId}">${skinLibraryThumbnail(skin)}<span><strong>${escape(skin.name || 'Untitled skin')}</strong><small>${escape(skin.id === CANONICAL_NEUTRAL_ID ? 'Baseline' : skin.status || 'Saved record')}${skin.edited && skin.id !== CANONICAL_NEUTRAL_ID ? ` · ${escape(skin.edited)}` : ''}</small></span></button>${skin.id === CANONICAL_NEUTRAL_ID || skin.status === 'Approved' ? '' : `<button class="delete-skin-button" data-delete-skin="${escape(skin.id)}" type="button" aria-label="Delete ${escape(skin.name)}">Delete</button>`}</div>`).join('') || '<p class="empty">No skins match. Clear the search or create a new draft.</p>';
  $$('#skinLibrary [data-skin]').forEach(button => button.addEventListener('click', () => selectSkin(button.dataset.skin)));
  $$('#skinLibrary [data-delete-skin]').forEach(button => button.addEventListener('click', () => deleteSkin(button.dataset.deleteSkin)));
  const details = $('.skin-management');
  if (details) {
    let source = details.querySelector('.skin-source-info');
    if (!source) { source = document.createElement('p'); source.className = 'helper skin-source-info'; details.querySelector('summary').after(source); }
    const skin = draft || selected();
    source.textContent = skinLibraryAccess(skin) + (skin.sourceSkinId ? ` · Source: ${skin.sourceSkinId === CANONICAL_NEUTRAL_ID ? 'Neutral Arc baseline' : skin.sourceSkinId}` : '');
    let recipe = details.querySelector('#neutralRecipeNote');
    if (!recipe) { recipe = document.createElement('p'); recipe.id = 'neutralRecipeNote'; recipe.className = 'helper'; recipe.textContent = 'Uses the editable Neutral palette. Compare with Neutral Arc to see the game default.'; source.after(recipe); }
    recipe.hidden = skin.id === CANONICAL_NEUTRAL_ID || skin.sourceSkinId !== CANONICAL_NEUTRAL_ID;
  }
}
function escape(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function assetOptions(roles, value, empty) {
  const allowed = Array.isArray(roles) ? roles : [roles];
  return '<option value="">' + escape(empty) + '</option>' + store.assets.filter(asset => allowed.includes(asset.placement)).map(asset =>
    '<option value="' + escape(asset.id) + '"' + (asset.id === value ? ' selected' : '') + '>' + escape(asset.name) + (asset.status === 'Pending' ? ' · pending' : '') + '</option>'
  ).join('');
}

function renderSymbols() { renderNativeIconEditor({mount:$('#symbolControls'),skin:draft,assetOptions,changed,render:renderEditor}); renderCounterDesign(); }
function renderAssets() {
  $('#backgroundAsset').innerHTML = assetOptions('background',draft.backgroundAsset,'Foundation color');
  $('#sealAsset').innerHTML = assetOptions(['seal','symbol'],draft.sealAsset,'Built-in seal');
  const buttonArt = $('#buttonAsset');
  if (buttonArt) buttonArt.innerHTML = assetOptions('button',draft.buttonAsset,'Current button treatment');
  const thumb = $('#thumbnailAsset');
  if (thumb) thumb.innerHTML = assetOptions('thumbnail',draft.thumbnailAsset,'Skin color swatch');
  renderAssetLibrary($('#assetLibrary'),{assets:store.assets,skins:store.skins,draft,approve:approveAsset,remove:deleteAsset,crop:cropLibraryAsset,saving:savingCatalog});
}

async function storeLibraryAsset(asset, label) {
  assertAppearanceValid(validateAppearanceAsset(asset,{requireData:true}));
  if (store.assets.some(item => item.id === asset.id)) return true;
  // A new, unsaved draft has no catalog row yet. Saving its artwork must
  // preserve the existing catalog selection until the designer saves the skin.
  const selected = store.skins.some(skin => skin.id === selectedId) ? selectedId : confirmedCatalog?.selected ?? CANONICAL_NEUTRAL_ID;
  const candidate = {...store, selected, assets:[asset,...store.assets]};
  if (!await saveCatalog({label,catalog:candidate})) return false;
  store = lastSavedCatalog;
  return true;
}

function cropLibraryAsset(id) {
  const asset = store.assets.find(item => item.id === id);
  if (!asset?.data || savingCatalog || preparingAsset) return;
  openAssetCrop(asset, {
    save: async copy => {
      if (!await storeLibraryAsset(copy,'Saving cropped artwork')) throw new Error('The catalog did not save this crop. Your framing is ready to retry.');
      renderEditor(); renderLibrary(); renderPreview(); validate();
      setSaveState(isDraftDirty() ? 'Unsaved draft' : 'Saved');
    },
    returnFocus: () => document.querySelector('[data-crop-source="' + CSS.escape(id) + '"]')?.focus(),
  });
}

async function deleteSkin(id) {
  if (savingCatalog || id === CANONICAL_NEUTRAL_ID) return;
  const skin = store.skins.find(item => item.id === id);
  if (!skin) return;
  if (skin.status === 'Approved' || store.skins.some(item => item.sourceSkinId === id)) return toast('Approved and referenced source skins are preserved. Create or edit a draft instead.');
  if (!confirm(`Delete “${skin.name}” from this protected Studio catalog? Any unsaved changes to that draft will also be discarded.`)) return;
  const candidate = clone(store); candidate.skins = candidate.skins.filter(item => item.id !== id);
  candidate.selected = id === selectedId ? CANONICAL_NEUTRAL_ID : selectedId;
  if (!await saveCatalog({ label: 'Deleting draft', catalog: candidate })) return;
  store = lastSavedCatalog;
  if (id === selectedId) selectSkin(CANONICAL_NEUTRAL_ID, { force: true });
  else { renderLibrary(); notifyDraftState(); }
  toast('Draft deleted. Approved sources are unchanged.');
}
async function reviseAsset(id, approving) {
  if (savingCatalog) return;
  const asset = store.assets.find(item => item.id === id);
  if (!asset || asset.status !== 'Pending') return;
  if (!approving && assetUsages(id,store.skins,draft).length) return toast('This artwork is in use. Clear its placements before removing it.');
  if (!confirm(approving ? 'Approve “' + asset.name + '” for use in published skins?' : 'Permanently remove unused pending artwork “' + asset.name + '”?')) return;
  const status = $('#assetStatus'); setCatalogSaving(true,approving ? 'Approving artwork' : 'Removing artwork');
  try {
    const response = await fetch('/api/appearance-studio/assets/' + encodeURIComponent(id) + (approving ? '/approve' : ''), {
      method:approving ? 'POST' : 'DELETE', headers:catalogHeaders, body:JSON.stringify({revision:confirmedCatalog?.revision ?? 0})
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'The catalog could not update this artwork.');
    const images = new Map(store.assets.map(item=>[item.id,item.data]));
    confirmedCatalog = clone(result.catalog);
    lastSavedCatalog = {...clone(result.catalog),assets:result.catalog.assets.map(item=>({...item,data:images.get(item.id)}))};
    store = lastSavedCatalog;
    status.textContent = approving ? asset.name + ' is approved for publishing.' : asset.name + ' removed from the library.';
  } catch (error) { status.textContent = error.message; }
  finally { setCatalogSaving(false); renderEditor(); renderLibrary(); renderPreview(); validate(); setSaveState(isDraftDirty() ? 'Unsaved draft' : 'Saved'); }
}
function approveAsset(id) { return reviseAsset(id,true); }
function deleteAsset(id) { return reviseAsset(id,false); }

function renderEditor() { fields.forEach(key => { const el = $(`#${key === 'name' ? 'skinName' : key}`); if (el) el.value = draft[key]; }); $('#atmosphereStrengthValue').textContent = `${draft.atmosphereStrength}%`; $('#backgroundScaleValue').textContent = `${draft.backgroundScale}%`; $('#backgroundPositionXValue').textContent = `${draft.backgroundPositionX}%`; $('#backgroundPositionYValue').textContent = `${draft.backgroundPositionY}%`; ['button','lifeButton','customLife','commanderTax','commanderDamage','seat'].forEach(prefix => { $(`#${prefix}OpacityValue`).textContent = `${draft[`${prefix}Opacity`]}%`; $(`#${prefix}BlurValue`).textContent = `${draft[`${prefix}Blur`]}px`; $(`#${prefix}BorderValue`).textContent = `${draft[`${prefix}Border`]}%`; }); $('#skinNameLabel').textContent = draft.name; renderAssets(); renderSymbols(); constrainIconScales(); }
function constrainIconScales() { $$('#symbolControls input[data-symbol-scale]').forEach(el => { const value = Math.min(200, Math.max(60, Number(el.value) || 100)); el.value = String(value); draft.symbolScale[el.dataset.symbolScale] = value; const output = el.parentElement?.querySelector('output'); if (output) output.textContent = `${value}%`; }); }
function selectSkin(id, { force = false } = {}) {
  if (savingCatalog) return false;
  if (!force && isDraftDirty() && !confirm('Discard the unsaved changes to this appearance and choose another skin?')) return false;
  selectedId = id === CANONICAL_NEUTRAL_ID || store.skins.some(skin => skin.id === id) ? id : CANONICAL_NEUTRAL_ID;
  store.selected = selectedId;
  original = clone(selected()); legacyDraftSource = isLegacyAppearance(original) ? clone(original) : null; draft = normalizeEditableSkin(clone(original));
  showingBaseline = false; comparisonTarget = 'saved'; draftRevision += 1;
  renderLibrary(); renderEditor(); renderPreview(); validate(); saveStore();
  setSaveState(draftStatusLabel());
  rememberDraft();
  return true;
}
function changed() { clearPublishFeedback(); if (selectedId === CANONICAL_NEUTRAL_ID) { selectedId = newDraftId(); draft = nativeDraftIcons({ ...draft, id: selectedId, name: draft.name === 'Neutral Arc' ? 'Neutral Studio draft' : draft.name, status: 'Draft', sourceSkinId: CANONICAL_NEUTRAL_ID, rendererVersion: 2 }); legacyDraftSource = null; renderLibrary(); renderEditor(); } draftRevision += 1; showingBaseline = false; $('#skinNameLabel').textContent = draft.name || 'Untitled skin'; renderPreview(); validate(); rememberDraft(); setSaveState('Unsaved draft'); }
function validate() {
  const appearance = getDraftAppearance();
  const rows = confirmedCatalog?.skins || store.skins;
  const sourceSkin = rows.find(item=>item.id === appearance.sourceSkinId) || rows.find(item=>item.id === selectedId && item.status === 'Approved');
  const report = validateAppearanceSkin(appearance, {assets:store.assets, requireApprovedAssets:true, publish:true, sourceSkin});
  const audience = appearanceAudience(appearance,{skins:store.skins,audiences:catalogAudiences,records:catalogAudienceRecords});
  if (['Invitation','Achievement','Restricted source'].includes(audience)) {
    report.errors.push({path:'sourceSkinId',message:'This source is restricted by its catalog access policy.',fix:'Keep this design as a private draft. For a generally available skin, start a new design from Neutral Arc.'});
  }
  const checkedAssets = new Set();
  for (const ref of appearanceAssetReferences(appearance)) {
    if (checkedAssets.has(ref.id)) continue;
    checkedAssets.add(ref.id);
    const asset = store.assets.find(item => item.id === ref.id);
    const fit = asset && artworkFitNote(asset.placement,assetInspection(asset).info);
    if (fit) report.warnings.push({path:ref.path,message:'Review the shape of “' + asset.name + '” for this slot.',fix:fit});
    if (asset && assetInspection(asset).error) report.errors.push({path:ref.path,message:'Artwork “' + asset.name + '” has no usable image data.',fix:'Reload the catalog from Asset library, or replace the artwork in this slot.'});
  }
  const polish = appearanceReadability(appearance).filter(item => item.severity === 'polish');
  validate.requiredFailures = report.errors.map(item => ({label:item.message, ...item}));
  const reviewButton = $('#workspaceReview');
  reviewButton.textContent = report.errors.length ? 'Validate (' + report.errors.length + ')' : 'Validate';
  const counts = [[report.errors.length,'blocking'],[report.warnings.length,'warnings'],[polish.length,'optional']];
  const summary = $('#validationSummary');
  summary.textContent = counts.map(([count,label]) => count + ' ' + label).join(' · ');
  summary.className = 'validation-summary ' + (report.errors.length ? 'fail' : report.warnings.length ? 'review' : 'pass');
  const list = $('#validationList');
  list.replaceChildren();
  for (const [items,label,icon,style] of [[report.errors,'Fix before publishing','!','fail'],[report.warnings,'Review','!','review'],[polish,'Optional','◇','polish']]) {
    for (const item of items) {
      const row = document.createElement('li'), mark = document.createElement('span');
      const body = document.createElement('div'), title = document.createElement('strong'), detail = document.createElement('small');
      row.className = style; mark.textContent = icon; mark.setAttribute('aria-hidden','true');
      title.textContent = label + ' · ' + (item.message || item.label);
      detail.textContent = item.fix; body.append(title,detail); row.append(mark,body); list.append(row);
    }
  }
  if (!report.errors.length && !report.warnings.length) {
    const row = document.createElement('li'); row.className = 'pass'; row.textContent = 'Token ranges, named artwork references and measured color pairs passed.'; list.prepend(row);
  }
  return !report.errors.length;
}

function renderPreview() {
  const button = $('#previewButton');
  button.textContent = showingBaseline ? 'Back to draft' : 'Compare';
  button.setAttribute('aria-pressed',String(showingBaseline));
  const comparison = getStudioComparisonOptions().find(option=>option.value === comparisonTarget);
  $('#compareNote').textContent = showingBaseline ? 'Comparing with ' + (comparison?.label || 'last saved version') + '. Choose Back to draft to edit.' : 'Live game renderer · isolated example state. Touch placement and phone usability require a separate real-device check.';
  renderExactPreview();
}

async function saveDraft(label = 'Saving draft', { duplicate = false } = {}) {
  if (savingCatalog) return false;
  if (selectedId === CANONICAL_NEUTRAL_ID && !isDraftDirty()) { toast('Neutral Arc is the built-in game default. Start an editable neutral draft to create a skin.'); return false; }
  const revision = draftRevision, historyIndex = draftHistoryIndex;
  const appearance = getDraftAppearance();
  const change = prepareDraftSave({ catalog: store, draft: isLegacyAppearance(appearance) ? appearance : materializeAppearanceSkin(appearance), selectedId, id: newDraftId(), edited: relativeDate(), duplicate, forceCopy: catalogConflict });
  recordSavedSkinVersion(change.skin, label);
  if (!await saveCatalog({ label, catalog: change.catalog })) return false;
  const settled = settleDraftSave(change, { draft, changedDuringSave: draftRevision !== revision });
  store = lastSavedCatalog; selectedId = change.selectedId; store.selected = selectedId;
  catalogConflict = false; clearPublishFeedback();
  original = clone(settled.original); draft = normalizeEditableSkin(settled.draft); legacyDraftSource = isLegacyAppearance(draft) ? clone(original) : null;
  if (draftHistory[historyIndex]) draftHistory[historyIndex] = historyEntry(original, legacyDraftSource);
  showingBaseline = false;
  saveStore(); rememberDraft(); renderLibrary(); renderEditor(); renderPreview(); validate();
  setSaveState(isDraftDirty() ? 'Saved snapshot · newer changes unsaved' : 'Saved draft');
  toast(change.fork ? 'Saved a new draft. The approved source is unchanged.' : 'Draft saved to the developer catalog.');
  return true;
}
async function duplicate() { if (selectedId === CANONICAL_NEUTRAL_ID && !isDraftDirty()) return newSkin({ name: 'Neutral Studio draft' }); return saveDraft('Duplicating draft', { duplicate: true }); }
async function publish() {
  if (savingCatalog) return;
  if (selectedId === CANONICAL_NEUTRAL_ID && !isDraftDirty()) { showPublishFeedback('Choose an editable draft first.', 'Neutral Arc is the built-in game default. Start an editable neutral draft to customize and approve a separate skin.'); return false; }
  clearPublishFeedback();
  if (!validate()) { const reasons = (validate.requiredFailures || []).map(check => check.label).join(' '); showPublishFeedback('Cannot publish this skin yet.', `${reasons} Correct the required checks before approving this draft.`); return; }
  if (!await ensureGeometryPreflight()) return false;
  if (!confirm(`Approve “${draft.name || 'Untitled skin'}” in this protected server catalog? This saves a separate draft when the source is approved. Gameplay, the default layout, access grants, and active player/table selections are unchanged.`)) return;
  if (!await saveDraft('Preparing publish')) { showPublishFeedback('Publishing stopped because the draft could not save.', 'The protected catalog did not confirm the draft. Check your connection and developer access, then retry.'); return; }
  if (isDraftDirty()) { showPublishFeedback('Publishing stopped.', 'New changes arrived while saving. Review and save those changes before approving this draft.'); return; }
  const revision = draftRevision, id = selectedId;
  setCatalogSaving(true, 'Approving skin');
  try {
    const response = await fetch(`/api/appearance-studio/skins/${encodeURIComponent(id)}/publish`, { method: 'POST', headers: catalogHeaders, body: JSON.stringify({ revision: confirmedCatalog?.revision ?? 0 }) });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error || 'The server did not approve this draft.'), { status: response.status });
    const assetData = store.assets;
    confirmedCatalog = clone(result.catalog);
    store = { ...clone(result.catalog), assets: result.catalog.assets.map(asset => ({ ...asset, data: assetData.find(item => item.id === asset.id)?.data })) };
    original = clone(result.skin);
    draft = draftRevision === revision ? normalizeEditableSkin(clone(original)) : { ...draft, status: 'Approved' };
    legacyDraftSource = isLegacyAppearance(draft) ? clone(original) : null;
    saveStore(); rememberDraft(); renderLibrary(); renderEditor(); renderPreview(); validate();
    setSaveState(isDraftDirty() ? 'Source approved · newer changes unsaved' : 'Approved source');
    toast('Skin approved in the protected catalog. Active appearances are unchanged.');
  } catch (error) { if (error.status === 409) showCatalogConflict(); else showPublishFeedback('Publishing failed.', `${error.message} The saved draft remains available; no approval was confirmed.`); }
  finally { setCatalogSaving(false); }
}
fields.forEach(key => { const el = $(`#${key === 'name' ? 'skinName' : key}`); el.addEventListener('input', () => { draft[key] = ['atmosphereStrength', 'backgroundScale', 'backgroundPositionX', 'backgroundPositionY', 'seatOpacity', 'seatBlur', 'seatBorder'].includes(key) ? Number(el.value) : el.value; if (key === 'atmosphere' && el.value !== 'custom') {
      draft.atmosphereStrength = el.value === 'light' ? 60 : 20;
      $('#atmosphereStrength').value = draft.atmosphereStrength;
      $('#atmosphereStrengthValue').textContent = draft.atmosphereStrength + '%';
    }
    if (key === 'atmosphereStrength') { draft.atmosphere = 'custom'; $('#atmosphere').value = 'custom'; } if (key === 'atmosphereStrength') $('#atmosphereStrengthValue').textContent = `${el.value}%`; if (key === 'backgroundScale') $('#backgroundScaleValue').textContent = `${el.value}%`; if (key === 'backgroundPositionX') $('#backgroundPositionXValue').textContent = `${el.value}%`; if (key === 'backgroundPositionY') $('#backgroundPositionYValue').textContent = `${el.value}%`; if (key === 'seatOpacity') $('#seatOpacityValue').textContent = `${el.value}%`; if (key === 'seatBlur') $('#seatBlurValue').textContent = `${el.value}px`; if (key === 'seatBorder') $('#seatBorderValue').textContent = `${el.value}%`; changed(); }); });
$('#skinSearch').addEventListener('input',renderLibrary);
$('#newSkinButton').addEventListener('click',newSkin);
$('#saveButton').addEventListener('click',()=>{ void saveDraft(); });
$('#duplicateButton').addEventListener('click',duplicate);
$('#publishButton').addEventListener('click',publish);
$('#revertButton').addEventListener('click',revertDraft);
$('#previewButton').addEventListener('click',toggleStudioComparison);

$$('[data-state]').forEach(b => b.addEventListener('click', () => { previewState = b.dataset.state; if (previewState === 'damage') { previewMode = 'commander'; $$('[data-preview-mode]').forEach(button => button.classList.toggle('selected',button.dataset.previewMode === previewMode)); } $$('[data-state]').forEach(x => x.classList.toggle('selected', x === b)); renderPreview(); }));
const importedArtStyle = document.createElement('style'); importedArtStyle.textContent = '.preview-symbol-image{width:22px;height:22px;object-fit:contain}.preview-seats div{border-color:color-mix(in srgb,#5b594f calc(var(--seat-border,70) * 1%),transparent);background:color-mix(in srgb,var(--surface) calc(var(--seat-opacity,100) * 1%),transparent);backdrop-filter:blur(calc(var(--seat-blur,0) * 1px))}.preview-screen[data-seat="glass"] .preview-seats div{background:color-mix(in srgb,var(--surface) calc(var(--seat-opacity,100) * .72%),transparent)}'; document.head.append(importedArtStyle);
$('#backgroundAsset').addEventListener('input', () => { draft.backgroundAsset = $('#backgroundAsset').value; changed(); });
$('#assetFile').addEventListener('change', () => { $('#assetStatus').textContent = ''; });
function readData(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); }); }
async function scaleForStudio(file, placement) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const small = ['symbol','seal','thumbnail'].includes(placement);
    const target = small ? 512 : 1536, limit = Math.max(image.naturalWidth,image.naturalHeight);
    if (!limit) throw new Error('This artwork has no usable image dimensions.');
    if (file.type !== 'image/svg+xml' && file.size <= 700000 && limit <= target) {
      const data = await readData(file);
      return {data, ...inspectImageData(data), resized:false};
    }
    const scale = Math.min(1,target/limit);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1,Math.round(image.naturalWidth*scale)); canvas.height = Math.max(1,Math.round(image.naturalHeight*scale));
    const context = canvas.getContext('2d'); context.drawImage(image,0,0,canvas.width,canvas.height);
    for (let quality = .88; quality >= .4; quality -= .08) {
      const data = canvas.toDataURL('image/webp',quality);
      if (data.length * .75 <= 700000) return {data,...inspectImageData(data),resized:scale < 1};
    }
    throw new Error('Crop the image or export a smaller file, then import again.');
  } finally { URL.revokeObjectURL(url); }
}

window.addEventListener('message', event => { if (event.origin !== location.origin || event.data?.type !== 'fivefold-arc:appearance-studio-key') return; developerKey = String(event.data.key || ''); void loadCatalog(); });
async function loadCatalog() {
  try {
    const response = await fetch('/api/appearance-studio/catalog', { headers: { 'x-feedback-portal-key': developerKey } });
    if (!response.ok) {
      if ([401,403].includes(response.status)) $('#studioAccess').hidden = false;
      throw new Error('Open Studio through Developer Assets to load the protected catalog.');
    }
    $('#studioAccess').hidden = true;
    if (response.headers?.get('X-Studio-Fixture') === 'file' && location.hostname === '127.0.0.1') {
      $('.library-panel .kicker').textContent = 'LOCAL DESIGN LIBRARY';
      $('#publicationControls p').textContent = 'Approval here applies only to this computer’s design catalog.';
    }
    const payload = await response.json(), remote = payload.catalog;
    if (!remote || !Array.isArray(remote.skins) || !Array.isArray(remote.assets)) throw new Error('The protected catalog response could not be read.');
    const reads = await Promise.allSettled(remote.assets.map(loadAssetData));
    const assets = reads.map((result, index) => result.status === 'fulfilled' ? result.value : { ...remote.assets[index] });
    const unavailable = reads.flatMap((result, index) => result.status === 'rejected' || !assets[index].data ? [remote.assets[index].id] : []);
    if (savingCatalog) return;
    const keepDraft = isDraftDirty();
    catalogAudiences = new Map(Object.entries(payload.audiences || {}));
    catalogAudienceRecords = new Map(remote.skins.map(skin => [skin.id, JSON.stringify(skin)]));
    confirmedCatalog = clone(remote);
    store = { ...remote, assets };
    if (!keepDraft) selectSkin(store.selected || CANONICAL_NEUTRAL_ID, { force: true });
    else { renderLibrary(); renderEditor(); renderPreview(); validate(); notifyDraftState(); }
    recoverDraft();
    showAssetLoadStatus(unavailable);
    if (catalogConflict) showCatalogConflict(true);
  } catch (error) { setSaveState('Catalog unavailable · draft retained'); toast(error.message || 'The catalog could not load. Retry from Developer Assets; your active draft is retained.'); }
}
selectSkin(selectedId);
if (developerKey) void loadCatalog();
$('#restoreCatalogButton').addEventListener('click', async () => {
  const status = $('#catalogRestoreStatus');
  if (savingCatalog) return;
  try {
    const checked = inspectCatalogBackup(await readCatalogBackupFile()), restored = checked.catalog;
    if (!confirm(`Restore the validated backup to this protected server catalog? ${checked.draftedSkins} imported skins restore as Draft; ${checked.pendingAssets} artwork files remain Pending until explicit approval. This replaces saved drafts and discards current unsaved edits. Existing approved sources, player access grants, active appearances, and the global layout stay protected. Export the current catalog first if you need a rollback.`)) return;
    const revision = draftRevision;
    const candidate = { schemaVersion: APPEARANCE_CATALOG_SCHEMA_VERSION, revision: confirmedCatalog?.revision ?? 0, skins: restored.skins, assets: restored.assets.map(asset => ({ ...asset, data: asset.data || store.assets.find(item => item.id === asset.id)?.data, pendingUpload: Boolean(asset.data) && !confirmedCatalog?.assets?.some(item => item.id === asset.id) })), selected: restored.selected || CANONICAL_NEUTRAL_ID, gameDefaultLayout: restored.gameDefaultLayout || null };
    if (!await saveCatalog({ label: 'Restoring catalog', catalog: candidate, restore: true })) return;
    store = lastSavedCatalog;
    if (draftRevision === revision) selectSkin(store.selected, { force: true });
    else { renderLibrary(); renderEditor(); renderPreview(); validate(); rememberDraft(); setSaveState('Catalog restored · newer draft edits retained'); }
    status.textContent = `Restored ${store.skins.length} saved skins and ${store.assets.length} images. New artwork still requires explicit approval.`;
    toast('Protected Studio catalog restored.');
  } catch (error) { status.textContent = error.message || 'This catalog backup could not be restored.'; }
});
const assetHints = document.createElement('p');
assetHints.id = 'assetSizeHint'; assetHints.className = 'helper'; assetHints.setAttribute('aria-live','polite');
const placementPicker = $('#assetPlacement');
placementPicker.closest('label').after(assetHints);
placementPicker.setAttribute('aria-describedby',assetHints.id);
const describePlacement = () => { assetHints.textContent = artworkSizeHint(placementPicker.value); };
placementPicker.addEventListener('input',describePlacement); describePlacement();
let preparingAsset = false, retryArtwork = null;
$('#assetFile').addEventListener('change',()=>{ retryArtwork = null; });
$('#importAssetButton').addEventListener('click', async () => {
  if (preparingAsset || savingCatalog) return;
  const file = $('#assetFile').files[0], name = $('#assetName').value.trim(), source = $('#assetSource').value.trim();
  const placement = $('#assetPlacement').value, status = $('#assetStatus');
  if (!file || !name || !source) { status.textContent = 'Choose an image and enter its name and rights or source.'; return; }
  if (!['image/png','image/jpeg','image/webp','image/svg+xml'].includes(file.type) || file.size > 20000000) {
    status.textContent = 'Choose a PNG, JPEG, WebP or SVG up to 20 MB.'; return;
  }
  preparingAsset = true; $('#importAssetButton').disabled = true;
  try {
    status.textContent = 'Checking and preparing artwork…';
    const details = JSON.stringify([name,source,placement]);
    if (!retryArtwork || retryArtwork.file !== file || retryArtwork.details !== details) {
      const {resized,...prepared} = await scaleForStudio(file,placement);
      const asset = {id:'asset-'+crypto.randomUUID(),name,source,placement,status:'Pending',pendingUpload:true,...prepared};
      retryArtwork = {file, details, resized, asset};
    }
    const {resized,asset} = retryArtwork;

    if (!await storeLibraryAsset(asset,'Importing artwork')) { status.textContent = 'Import was not saved. Your file is still selected for retry.'; return; }

    retryArtwork = null;
    $('#assetFile').value = ''; $('#assetName').value = ''; $('#assetSource').value = '';
    status.textContent = name + ' is pending review' + (resized ? ' after resizing' : '') + '. Check the preview, then approve the artwork.';
    renderEditor(); renderLibrary(); renderPreview(); validate(); setSaveState(isDraftDirty() ? 'Unsaved draft' : 'Saved');
  } catch (error) { status.textContent = error.message || 'This image could not be decoded. Try another file.'; }
  finally { preparingAsset = false; $('#importAssetButton').disabled = savingCatalog; }
});

const studioScaleStyle = document.createElement('style'); studioScaleStyle.textContent = '.symbol-controls .symbol-control{display:grid!important;grid-template-columns:minmax(0,1fr) 76px 112px;gap:8px;align-items:center}.symbol-controls .symbol-control>span{grid-column:1/2}.symbol-controls .symbol-control input[type=range]{grid-column:1/-1;width:100%;margin:3px 0 0}.symbol-controls .symbol-control>small:last-child{grid-column:1/-1;color:#d8b36b}.preview-symbol-image{transition:transform .12s ease}'; document.head.append(studioScaleStyle);
const atmosphereStyle = document.createElement('style'); atmosphereStyle.textContent = '.atmosphere-controls{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}.atmosphere-controls label{margin-top:0!important;font-size:.68rem!important}.atmosphere-controls input[type=color]{height:38px;min-height:38px;margin-top:4px;padding:3px}.atmosphere-controls select{margin-top:4px}.atmosphere-controls .atmosphere-strength{grid-column:1/-1}.atmosphere-strength output{float:right;color:#d8b36b}.atmosphere-strength input{width:100%;min-height:auto;margin:7px 0 0;padding:0}.preview-screen:before,.preview-screen:after{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none}.preview-screen:before{background:radial-gradient(circle at var(--atmosphere-position),color-mix(in srgb,var(--atmosphere) calc(var(--atmosphere-strength) * 100%),transparent),transparent 58%)}.preview-screen[data-atmosphere=light]:after{background:#fff;opacity:.08}.preview-screen[data-atmosphere=custom]:after{background:linear-gradient(180deg,color-mix(in srgb,var(--atmosphere) calc(var(--atmosphere-strength) * 55%),transparent),transparent 48%)}.preview-screen[data-art=rays]:after,.preview-screen[data-art=grain]:after,.preview-screen[data-art=mist]:after,.preview-screen[data-art=stars]:after{opacity:.18}.preview-screen[data-art=rays]:after{background:repeating-conic-gradient(from 0deg at 50% 35%,transparent 0 12deg,var(--accent) 13deg 14deg,transparent 15deg 28deg)}.preview-screen[data-art=grain]:after{background:repeating-linear-gradient(70deg,transparent 0 3px,#fff 4px 5px)}.preview-screen[data-art=mist]:after{background:radial-gradient(ellipse at 10% 18%,#fff8,transparent 32%),radial-gradient(ellipse at 88% 66%,var(--atmosphere),transparent 42%);filter:blur(18px)}.preview-screen[data-art=stars]:after{background-image:radial-gradient(circle,#fff 0 1px,transparent 1.5px),radial-gradient(circle,var(--accent) 0 1px,transparent 1.5px);background-position:0 0,17px 23px;background-size:31px 37px,43px 47px}'; document.head.append(atmosphereStyle);
const preflightSizes = [{ id: 'phone', label: '393 × 852', width: 393, height: 852 }, { id: 'compact', label: '320 × 700', width: 320, height: 700 }];
const preflightPlayers = [2, 3, 4, 5, 6, 7, 8];
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const preflightPanel = document.createElement('section'); preflightPanel.className = 'preflight-panel'; preflightPanel.innerHTML = '<p class="kicker">LOCAL PREFLIGHT</p><h2>Draft readiness</h2><p class="helper">Checks the actual game at two narrow phone sizes, tables of two through eight players, and all six counters. It never saves or publishes your draft.</p><button id="runPreflightButton" class="secondary-action" type="button">Run preflight</button><p id="preflightSummary" class="preflight-summary" aria-live="polite">Not run for this draft.</p><ul id="preflightList" class="preflight-list" hidden></ul>'; $('.validation-panel').insertBefore(preflightPanel, $('.validation-panel').children[1]);
function renderPreflight(results) {
  const failed = results.filter(check => !check.pass);
  const summary = $('#preflightSummary'), list = $('#preflightList');
  summary.textContent = failed.length
    ? failed.length + ' of ' + results.length + ' local checks need attention. The affected screens appear first.'
    : results.length + ' exact-app screens passed locally. Touch comfort and readability across a table still need a playtest.';
  summary.className = 'preflight-summary ' + (failed.length ? 'fail' : 'pass');
  const rows = [...failed,...results.filter(check => check.pass)].map(check => {
    const row = document.createElement('li'), icon = document.createElement('span'), body = document.createElement('div');
    const title = document.createElement('strong'), detail = document.createElement('small');
    row.className = check.pass ? 'pass' : 'fail';
    icon.setAttribute('aria-hidden','true'); icon.textContent = check.pass ? '✓' : '!';
    title.textContent = check.label; detail.textContent = check.detail;
    body.append(title,detail); row.append(icon,body); return row;
  });
  list.replaceChildren(...rows); list.hidden = false;
}
async function renderPreflightFixture(frame, skin, size) {
  frame.style.width = `${size.width}px`; frame.style.height = `${size.height}px`;
  frame.style.transform = `scale(${Math.min(120 / size.width,180 / size.height)})`;
  const requestId = `preflight-${crypto.randomUUID()}`;
  await new Promise((resolve,reject) => {
    const timeout = setTimeout(() => { window.removeEventListener('message',ready); reject(new Error('The exact renderer did not acknowledge this screen. Reload the preview and try again.')); }, 5000);
    function ready(event) { if (!previewMessageAllowed(event,location.origin,frame.contentWindow) || event.data?.type !== 'fivefold-arc:appearance-rendered' || event.data.requestId !== requestId) return; clearTimeout(timeout); window.removeEventListener('message',ready); resolve(); }
    window.addEventListener('message',ready);
    frame.contentWindow.postMessage({ type: 'fivefold-arc:appearance-skin', skin: { ...skin, useGameBase: true, previewRequestId: requestId } },location.origin);
  });
  await settlePreviewDocument(frame.contentDocument);
  return previewViewportChecks(measurePreviewDocument(frame.contentDocument),size);
}
async function runPreflight() {
  const button = $('#runPreflightButton'); if (button.disabled) return false;
  button.disabled = true; button.textContent = 'Running…'; $('#preflightSummary').textContent = 'Checking the actual game renderer…'; $('#preflightList').hidden = true;
  const frame = document.createElement('iframe'); frame.title = 'Isolated readability check'; frame.tabIndex = -1; frame.inert = true; frame.setAttribute('aria-hidden','true'); frame.style.cssText = 'position:fixed;right:16px;bottom:16px;opacity:0;border:0;pointer-events:none;transform-origin:bottom right';
  const results = [], snapshot = clone(getDraftAppearance()), revision = draftRevision, fingerprint = appearanceFingerprint(getDraftAppearance());
  try {
    const loaded = new Promise((resolve,reject) => { frame.addEventListener('load',resolve,{once:true}); frame.addEventListener('error',() => reject(new Error('Could not load the exact renderer.')),{once:true}); });
    frame.src = 'index.html?appearance-preview=1'; document.body.append(frame); await loaded;
    const scenarios = [];
    for (const size of preflightSizes) for (const players of preflightPlayers) for (const mode of Object.keys(icons)) for (const style of ['button','dial']) scenarios.push({ size,players,mode,style,state:'turn' });
    for (const state of PREVIEW_STATES.filter(state => state !== 'turn')) for (const style of ['button','dial']) scenarios.push({ size: preflightSizes[0], players: 4, mode: state === 'damage' ? 'commander' : 'life', style, state });
    for (const size of [{label:'440 × 956',width:440,height:956},{label:'744 × 1133',width:744,height:1133},{label:'1280 × 900',width:1280,height:900}]) for (const style of ['button','dial']) scenarios.push({size,players:4,mode:'life',style,state:'turn'});
    for (const [index,scenario] of scenarios.entries()) {
      $('#preflightSummary').textContent = `Checking screen ${index + 1} of ${scenarios.length}…`;
      const skin = buildDevicePreviewSkin({ ...clone(snapshot), interfaceStyle: scenario.style });
      const checks = await renderPreflightFixture(frame,{ ...skin, previewPlayers: scenario.players, previewMode: scenario.mode, previewState: scenario.state },scenario.size);
      const failed = checks.filter(check => !check.pass);
      results.push({ label: `${scenario.size.label} · ${scenario.players} players · ${labels[scenario.mode]} · ${scenario.style} · ${scenario.state}`, pass: failed.length === 0, detail: failed.length ? `${failed.map(check => check.label).join('; ')}. Reset the affected section or reduce its offset/scale, then check again.` : 'Viewport, required actions, target bounds, labels and counter value checked.' });
    }
  } catch (error) { results.push({ label:'Exact renderer connection',pass:false,detail:error.message || 'Reload Studio and try again.' }); }
  finally {
    frame.remove(); button.disabled = false; button.textContent = 'Run preflight';
    const unchanged = revision === draftRevision && fingerprint === appearanceFingerprint(getDraftAppearance());
    preflightProof = { revision,fingerprint,pass:unchanged && results.length > 0 && results.every(result => result.pass) };
    if (unchanged) renderPreflight(results);
    else invalidatePreflight('The draft changed during these checks. Run preflight again for the current layout.');
  }
  return preflightProofMatches(preflightProof,getDraftAppearance(),draftRevision);
}
function invalidatePreflight(message = 'Not run for this draft. Run preflight to check its current layout.') {
  preflightProof = null;
  const summary = $('#preflightSummary'); if (!summary) return;
  summary.textContent = message; summary.className = 'preflight-summary review'; $('#preflightList').hidden = true;
}
async function ensureGeometryPreflight() {
  if (!needsGeometryPreflight(getDraftAppearance())) return true;
  if (preflightProofMatches(preflightProof,getDraftAppearance(),draftRevision)) return true;
  if ($('#runPreflightButton').disabled) { showPublishFeedback('Layout checks are still running.','Wait for the current checks to finish, then publish again. No draft was published.'); return false; }
  const passed = await runPreflight();
  if (!passed) showPublishFeedback('The layout needs review.','Open Validate and review the current renderer measurements. Reset the affected section or reduce its scale/offset, then check again. Your draft is preserved.');
  return passed;
}
function renderExactPreview() {
  if (preflightProof && (preflightProof.revision !== draftRevision || preflightProof.fingerprint !== appearanceFingerprint(getDraftAppearance()))) invalidatePreflight();
  if (!rendererPreviewPayload) return;
  if (rendererPreviewSync) rendererPreviewSync();
  else $('#exactPreview').contentWindow?.postMessage({ type: 'fivefold-arc:appearance-skin', skin: rendererPreviewPayload() },location.origin);
  if (rendererPreviewSync) void publishPhoneLayoutSession();
}
const podPreviewControl = document.createElement('div'); podPreviewControl.className = 'segmented'; podPreviewControl.setAttribute('role', 'group'); podPreviewControl.setAttribute('aria-label', 'Preview pod size'); podPreviewControl.innerHTML = preflightPlayers.map(count => `<button data-preview-players="${count}" class="${count === 4 ? 'selected' : ''}" type="button">${count} players</button>`).join(''); $('.preview-toolbar').append(podPreviewControl); $$('[data-preview-players]').forEach(button => button.addEventListener('click', () => { previewPlayers = Number(button.dataset.previewPlayers); $$('[data-preview-players]').forEach(item => item.classList.toggle('selected', item === button)); renderPreview(); }));
const modePreviewControl = document.createElement('div'); modePreviewControl.className = 'segmented'; modePreviewControl.setAttribute('role', 'group'); modePreviewControl.setAttribute('aria-label', 'Preview counter mode'); modePreviewControl.innerHTML = Object.entries(labels).map(([mode, label]) => `<button data-preview-mode="${mode}" class="${mode === previewMode ? 'selected' : ''}" type="button">${label}</button>`).join(''); $('.preview-toolbar').append(modePreviewControl); $$('[data-preview-mode]').forEach(button => button.addEventListener('click', () => { previewMode = button.dataset.previewMode; $$('[data-preview-mode]').forEach(item => item.classList.toggle('selected', item === button)); renderPreview(); }));
const additionalPreviewStates = { lobby: 'Lobby', status: 'Warning', dialog: 'Dialog', error: 'Error', end: 'Game complete', menu:'Game menu', radiationDialog:'Resolve radiation', commanderDialog:'Commander sources', eliminated:'Eliminated player', longLabels:'Long names & totals' };
Object.entries(additionalPreviewStates).forEach(([state,label]) => { const button = document.createElement('button'); button.type = 'button'; button.dataset.state = state; button.textContent = label; button.addEventListener('click',() => { previewState = state; $$('[data-state]').forEach(item => item.classList.toggle('selected',item === button)); renderPreview(); }); $('[aria-label="Preview state"]').append(button); });
$('#exactPreview').addEventListener('load', renderExactPreview); $('#runPreflightButton').addEventListener('click', runPreflight); renderPreview();
const exactPreviewFallbackStyle = document.createElement('style'); exactPreviewFallbackStyle.textContent = 'body[data-preview-fallback="true"] .device-preview-panel{display:none}.exact-preview-recovery{width:min(100%,560px);margin:18px auto;padding:22px;border:1px solid #d8b36b;border-radius:12px;background:#1d1b15;color:#f3eee3;text-align:center;box-shadow:0 14px 40px #0007}.exact-preview-recovery h2{margin:0;color:#f0ca80}.exact-preview-recovery p{margin:10px auto;max-width:48ch;color:#d1cbbd;line-height:1.45}.exact-preview-recovery button{min-height:40px;padding:8px 12px;border:1px solid #d4ad65;border-radius:5px;background:#d4ad65;color:#201a0f;font-weight:800}.exact-preview-recovery>div{display:grid;justify-items:center;gap:8px;margin-top:12px}.exact-preview-recovery img{width:180px;height:180px;padding:8px;border-radius:6px;background:#fff}.exact-preview-recovery input{width:min(100%,420px);min-height:34px;padding:5px 7px;border:1px solid #41423f;border-radius:5px;background:#121310;color:#f4ecd9;font-size:.65rem}'; document.head.append(exactPreviewFallbackStyle);
const backgroundArtControlsStyle = document.createElement('style'); backgroundArtControlsStyle.textContent = '.background-art-controls{display:grid;gap:8px;margin-top:10px}.background-art-controls label{display:grid!important;grid-template-columns:1fr auto;gap:5px;margin:0!important;font-size:.68rem!important}.background-art-controls output{color:#d8b36b}.background-art-controls input{grid-column:1/-1;width:100%;min-height:auto;margin:0;padding:0}'; document.head.append(backgroundArtControlsStyle);
['buttonOpacity','buttonBlur','buttonBorder','lifeButtonOpacity','lifeButtonBlur','lifeButtonBorder','customLifeOpacity','customLifeBlur','customLifeBorder','commanderTaxOpacity','commanderTaxBlur','commanderTaxBorder','commanderDamageOpacity','commanderDamageBlur','commanderDamageBorder'].forEach(key => $(`#${key}`).addEventListener('input', event => { draft[key] = Number(event.target.value); $(`#${key}Value`).textContent = `${event.target.value}${key.endsWith('Blur') ? 'px' : '%'}`; changed(); }));
$('#backgroundAutoFit').addEventListener('click', () => { draft.backgroundScale = 100; draft.backgroundPositionX = 50; draft.backgroundPositionY = 50; renderEditor(); changed(); });
renderPreview();

// UX Studio extension: broad visual authorship constrained to named, safe
// gameplay regions. These settings remain preview/catalog data until a skin is
// deliberately offered to normal play.
const layoutRegions = {
  podStrip: 'Player cards', counterReadout: 'Life total and center', dialSurface: 'Dial surface',
  turnActions: 'End turn area', adjustControls: 'Life change buttons', customLife: 'Custom life button',
  commanderTax: 'Commander card', commanderDamage: 'Commander damage cards', modeNav: 'Bottom navigation'
};
const layoutRegionDefault = () => Object.fromEntries(Object.keys(layoutRegions).map(key => [key, { x: 0, y: 0, scale: 100 }]));
const uxDefaults = { interfaceStyle: 'button', fontFamily: 'system', labelTextScale: 100, seatTextScale: 100, seatRadius: 8, buttonRadius: 8, counterOffsetY: 0, turnOffsetY: 0, controlsOffsetY: 0, centerSealScale: 100, centerSealOffsetX: 0, centerSealOffsetY: 0, lifeNumberScale: 100, lifeNumberOffsetX: 0, lifeNumberOffsetY: 0, dialArtSpin: false, componentLayout: layoutRegionDefault(), overlays: { seat: '', counter: '', dial: '' }, overlayOpacity: { seat: 35, counter: 28, dial: 30 }, overlayScale: { seat: 100, counter: 100, dial: 100 }, overlayBlend: { seat: 'normal', counter: 'screen', dial: 'screen' } };
const modeLayoutKeys = ['labelTextScale','seatTextScale','seatRadius','buttonRadius','counterOffsetY','turnOffsetY','controlsOffsetY','centerSealScale','centerSealOffsetX','centerSealOffsetY','dialArtSpin','componentLayout','overlays','overlayOpacity','overlayScale','overlayBlend'];
$('#assetPlacement').insertAdjacentHTML('beforeend', '<option value="overlay">Transparent overlay</option><option value="panel">Panel artwork</option><option value="button">Button artwork</option>');
const componentPlacementControl = document.createElement('details');
componentPlacementControl.className = 'studio-fold';
  componentPlacementControl.innerHTML = '<summary>Place game regions</summary><div id="componentPlacementControls"></div>';
// Append instead of relying on a particular panel nesting level. The Studio
// markup can group its collapsible sections differently as it evolves.
$('#uxStudioPanel').append(componentPlacementControl);
const uxStudioFolds = Array.from(document.querySelectorAll('#uxStudioPanel > details.studio-fold'));
uxStudioFolds.forEach(fold => { fold.open = false; });
// Retained as a no-op for dynamically rendered region sections: each section
// is independently collapsible, and opening one never closes another.
const makeAccordion = () => {};
const uxNumeric = ['labelTextScale', 'seatTextScale', 'seatRadius', 'buttonRadius', 'counterOffsetY', 'turnOffsetY', 'controlsOffsetY', 'centerSealScale', 'centerSealOffsetX', 'centerSealOffsetY', 'lifeNumberScale', 'lifeNumberOffsetX', 'lifeNumberOffsetY'];
  function normalizeUxSkin(skin) { if (!skin) return; Object.entries(uxDefaults).forEach(([key, value]) => { if (skin[key] == null) skin[key] = clone(value); }); skin.interfaceStyle = skin.interfaceStyle === 'dial' ? 'dial' : 'button'; skin.fontFamily = appearanceFontKeys.includes(skin.fontFamily) ? skin.fontFamily : 'system'; skin.modeLayouts ||= {}; ['button','dial'].forEach(mode => { skin.modeLayouts[mode] ||= Object.fromEntries(modeLayoutKeys.map(key => [key, clone(skin[key])])) ; const layout = skin.modeLayouts[mode]; Object.entries(uxDefaults).forEach(([key, value]) => { if (!['interfaceStyle','fontFamily'].includes(key) && layout[key] == null) layout[key] = clone(skin[key] ?? value); }); layout.labelTextScale = Math.min(115, Math.max(85, Number(layout.labelTextScale) || 100)); layout.seatTextScale = Math.min(115, Math.max(85, Number(layout.seatTextScale) || 100)); layout.seatRadius = tokenNumber(layout.seatRadius, 8, 0, 24); layout.buttonRadius = tokenNumber(layout.buttonRadius, 8, 0, 24); layout.counterOffsetY = Math.min(18, Math.max(-18, Number(layout.counterOffsetY) || 0)); layout.turnOffsetY = Math.min(12, Math.max(-12, Number(layout.turnOffsetY) || 0)); layout.controlsOffsetY = Math.min(12, Math.max(-12, Number(layout.controlsOffsetY) || 0)); layout.centerSealScale = Math.min(150, Math.max(60, Number(layout.centerSealScale) || 100)); layout.centerSealOffsetX = Math.min(18, Math.max(-18, Number(layout.centerSealOffsetX) || 0)); layout.centerSealOffsetY = Math.min(18, Math.max(-18, Number(layout.centerSealOffsetY) || 0)); layout.lifeNumberScale = Math.min(140, Math.max(75, Number(layout.lifeNumberScale) || 100)); layout.lifeNumberOffsetX = Math.min(14, Math.max(-14, Number(layout.lifeNumberOffsetX) || 0)); layout.lifeNumberOffsetY = Math.min(14, Math.max(-14, Number(layout.lifeNumberOffsetY) || 0)); layout.dialArtSpin = Boolean(layout.dialArtSpin); layout.componentLayout ||= layoutRegionDefault(); Object.keys(layoutRegions).forEach(region => { const placement = layout.componentLayout[region] ||= { x: 0, y: 0, scale: 100 }; placement.x = Math.min(100, Math.max(-100, Number(placement.x) || 0)); placement.y = Math.min(140, Math.max(-140, Number(placement.y) || 0)); placement.scale = Math.min(140, Math.max(70, Number(placement.scale) || 100)); }); layout.overlays ||= {}; layout.overlayOpacity ||= {}; layout.overlayScale ||= {}; layout.overlayBlend ||= {}; ['seat','counter','dial'].forEach(slot => { layout.overlays[slot] ||= ''; layout.overlayOpacity[slot] = tokenNumber(layout.overlayOpacity[slot], skin.overlayOpacity?.[slot] ?? 0, 0, 70); layout.overlayScale[slot] = Math.min(160, Math.max(50, Number(layout.overlayScale[slot]) || 100)); layout.overlayBlend[slot] ||= skin.overlayBlend?.[slot] || 'normal'; }); }); }
function activeModeLayout(skin = draft) { normalizeUxSkin(skin); return skin.modeLayouts[skin.interfaceStyle === 'dial' ? 'dial' : 'button']; }
function overlayOptions(value,slot) {
  return assetOptions(slot === 'dial' ? ['dial','background','overlay'] : ['panel','background','overlay'],value,'No overlay');
}

  function renderUxStudio() { normalizeUxSkin(draft); const layout = activeModeLayout(); ['interfaceStyle','fontFamily',...uxNumeric].forEach(key => { const field = $(`#${key}`); if (field) field.value = ['interfaceStyle','fontFamily'].includes(key) ? draft[key] : layout[key]; const output = $(`#${key}Value`); if (output) output.textContent = key.endsWith('Scale') ? `${layout[key]}%` : `${layout[key]}px`; }); const placementPanel = $('#componentPlacementControls'); if (placementPanel) { placementPanel.innerHTML = `<p class="placement-intro">Supported regions use renderer-supported offsets and size bounds. Player order and game actions stay locked. Validate checks that moved or resized controls remain reachable before publishing.</p>${Object.entries(layoutRegions).map(([key, name]) => { const value = layout.componentLayout[key]; const inheritedNote = Math.abs(value.x) > 32 || Math.abs(value.y) > 36 || value.scale < 85 || value.scale > 115 ? `<p class="helper">Inherited placement: ${value.x}px across, ${value.y}px down, ${value.scale}% size. These saved values are preserved. Adjusting a slider uses the current protected limits; Reset returns this region to its baseline.</p>` : ''; return `<details class="component-placement"><summary>${name}</summary><div class="placement-fields">${inheritedNote}<label>Left / right <output>${value.x}px</output><input data-placement="${key}" data-placement-field="x" type="range" min="-32" max="32" step="2" value="${value.x}"></label><label>Up / down <output>${value.y}px</output><input data-placement="${key}" data-placement-field="y" type="range" min="-36" max="36" step="2" value="${value.y}"></label><label>Size <output>${value.scale}%</output><input data-placement="${key}" data-placement-field="scale" type="range" min="85" max="115" step="1" value="${value.scale}"></label><button type="button" data-placement-reset="${key}">Reset ${name}</button></div></details>`; }).join('')}`; makeAccordion(Array.from(placementPanel.querySelectorAll('.component-placement'))); $$('[data-placement]').forEach(el => el.addEventListener('input', () => { const placement = activeModeLayout().componentLayout[el.dataset.placement]; placement[el.dataset.placementField] = Number(el.value); el.previousElementSibling.textContent = `${el.value}${el.dataset.placementField === 'scale' ? '%' : 'px'}`; changed(); })); $$('[data-placement-reset]').forEach(button => button.addEventListener('click', () => { activeModeLayout().componentLayout[button.dataset.placementReset] = { x: 0, y: 0, scale: 100 }; renderUxStudio(); changed(); })); } $('#overlayControls').innerHTML = ['seat','counter','dial'].map(slot => `<div class="overlay-control"><strong>${slot === 'seat' ? 'Player cards' : slot === 'counter' ? 'Counter stage' : 'Dial surface'}</strong><select data-overlay="${slot}">${overlayOptions(layout.overlays[slot],slot)}</select><label>Opacity <output>${layout.overlayOpacity[slot]}%</output><input data-overlay-opacity="${slot}" type="range" min="0" max="70" step="5" value="${layout.overlayOpacity[slot]}"></label><label>Scale <output>${layout.overlayScale[slot]}%</output><input data-overlay-scale="${slot}" type="range" min="50" max="160" step="5" value="${layout.overlayScale[slot]}"></label><label>Blend<select data-overlay-blend="${slot}"><option value="normal">Normal</option><option value="screen">Screen</option><option value="multiply">Multiply</option><option value="overlay">Overlay</option></select></label>${slot === 'dial' ? `<label class="overlay-toggle"><input data-dial-art-spin type="checkbox" ${layout.dialArtSpin ? 'checked' : ''}> Spin this art with the dial</label>` : ''}</div>`).join(''); $$('[data-overlay]').forEach(el => el.addEventListener('input', () => { activeModeLayout().overlays[el.dataset.overlay] = el.value; changed(); })); $$('[data-overlay-opacity]').forEach(el => el.addEventListener('input', () => { const slot = el.dataset.overlayOpacity; activeModeLayout().overlayOpacity[slot] = Number(el.value); el.previousElementSibling.textContent = `${el.value}%`; changed(); })); $$('[data-overlay-scale]').forEach(el => el.addEventListener('input', () => { const slot = el.dataset.overlayScale; activeModeLayout().overlayScale[slot] = Number(el.value); el.previousElementSibling.textContent = `${el.value}%`; changed(); })); $$('[data-overlay-blend]').forEach(el => { el.value = activeModeLayout().overlayBlend[el.dataset.overlayBlend]; el.addEventListener('input', () => { activeModeLayout().overlayBlend[el.dataset.overlayBlend] = el.value; changed(); }); }); $('[data-dial-art-spin]')?.addEventListener('input', event => { activeModeLayout().dialArtSpin = event.target.checked; changed(); }); }
const renderEditorBase = renderEditor; renderEditor = function() { renderEditorBase(); renderUxStudio(); };
const renderPreviewBase = renderPreview; renderPreview = function() { normalizeUxSkin(draft); renderPreviewBase(); };
['interfaceStyle','fontFamily',...uxNumeric].forEach(key => $(`#${key}`).addEventListener('input', event => { if (uxNumeric.includes(key)) activeModeLayout()[key] = Number(event.target.value); else draft[key] = event.target.value; const output = $(`#${key}Value`); if (output) output.textContent = key.endsWith('Scale') ? `${event.target.value}%` : `${event.target.value}px`; if (key === 'interfaceStyle') renderUxStudio(); changed(); }));
normalizeUxSkin(neutral); normalizeUxSkin(draft); renderEditor(); renderPreview();
const uxStudioStyle = document.createElement('style'); uxStudioStyle.textContent = '.ux-studio-panel h3{margin:20px 0 4px;color:#e1b96c;font-size:.88rem}.ux-grid,.overlay-controls{display:grid;gap:10px;margin-top:12px}.ux-grid{grid-template-columns:1fr 1fr}.ux-grid label,.overlay-control label,.placement-fields label{display:grid!important;grid-template-columns:1fr auto;gap:5px;margin:0!important;font-size:.68rem!important}.ux-grid input,.overlay-control input,.placement-fields input{grid-column:1/-1;width:100%;min-height:auto!important;margin:0!important;padding:0!important}.ux-grid output,.overlay-control output,.placement-fields output{color:#d8b36b}.overlay-control,.component-placement{display:grid;gap:7px;padding:10px;border:1px solid #353633;background:#1b1c1a}.overlay-control strong{font-size:.76rem}.overlay-control select{width:100%;min-height:38px;margin:0!important}.placement-intro{margin:8px 0 10px;font-size:.7rem;line-height:1.4;color:var(--muted)}.component-placement{margin:8px 0}.component-placement summary{cursor:pointer;color:#e1b96c;font-size:.76rem;font-weight:800}.placement-fields{display:grid;gap:8px;margin-top:10px}.placement-fields button{justify-self:start;min-height:32px;padding:5px 8px;font-size:.68rem}'; document.head.append(uxStudioStyle);

// A device shell is only a measuring/frame layer. The iframe remains the exact
// app preview and receives the very same skin message as the primary preview.
const buildDevicePreviewSkin = (skin = getPreviewSkin()) => {
  const asset = id => store.assets.find(item => item.id === id)?.data || '';
  const legacy = skin.id !== CANONICAL_NEUTRAL_ID && skin.rendererVersion !== 2;
  const layout = legacy ? {} : activeModeLayout(skin);
  const identityFixture = !legacy && ['prismatic-glass','art-regions'].includes(skin.commanderTreatment) ? commanderPreviewContext : {};
  return { ...publicAppearanceSkin(skin), ...layout, ...resolveDesignArtwork(skin,(id,roles)=>store.assets.find(item=>item.id===id&&roles.includes(item.placement))?.data||''), useGameBase: true, previewReadOnly: showingBaseline || legacy, previewState, previewMode, previewPlayers, ...identityFixture, backgroundData: asset(skin.backgroundAsset), sealData: asset(skin.sealAsset), buttonData: asset(skin.buttonAsset), symbolData: Object.fromEntries(Object.keys(icons).map(key => [key, asset(skin.symbolAssets?.[key])])), overlayData: Object.fromEntries(Object.entries((legacy ? skin : layout).overlays || {}).map(([slot, id]) => [slot, asset(id)])) };
};
rendererPreviewPayload = buildDevicePreviewSkin;
exactPreviewFallbackTimer = window.setTimeout(showExactPreviewRecovery, 2200);
const devicePreview = mountDevicePreview({ primaryFrame: $('#exactPreview'), getSkin: buildDevicePreviewSkin });
rendererPreviewSync = devicePreview.sync;
const phoneLayoutControl = document.createElement('section'); phoneLayoutControl.className = 'phone-layout-control'; phoneLayoutControl.innerHTML = '<strong>Exact preview</strong><p>Use the browser preview for fast placement edits. The phone link is for final device verification.</p><button type="button" id="openBrowserExactPreview">Open fast browser preview</button><button type="button" id="openPhoneLayoutEditor">Create phone link</button><div id="phoneLayoutLink" hidden></div>'; $('#uxStudioPanel').insertBefore(phoneLayoutControl, $('#uxStudioPanel').querySelector('details:last-child'));
let phoneLayoutSession = null, phoneLayoutUpdatedAt = 0, applyingPhoneLayout = false, phoneLayoutChannel = null, lastPhoneLayoutPayload = '';
function connectPhoneLayoutChannel(sessionId) { phoneLayoutChannel?.close(); phoneLayoutChannel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(`fivefold-arc:phone-layout:${sessionId}`) : null; }
async function createPhoneLayoutSession({ linkTarget = '#phoneLayoutLink', button = $('#openPhoneLayoutEditor'), openInBrowser = false } = {}) { const previewWindow = openInBrowser ? window.open('about:blank', 'fivefold-arc-exact-preview') : null; button.disabled = true; button.textContent = 'Creating…'; try { const response = await fetch('/api/appearance-studio/phone-layout', { method: 'POST', headers: catalogHeaders, body: JSON.stringify({ skin: buildDevicePreviewSkin() }) }); if (!response.ok) throw new Error('Open Appearance Studio from Developer Assets before creating a phone link.'); const session = await response.json(); phoneLayoutSession = session.id; phoneLayoutUpdatedAt = 0; connectPhoneLayoutChannel(session.id); const qrResponse = await fetch(`/api/appearance-studio/phone-layout/${session.id}/qr`); if (!qrResponse.ok) throw new Error('Could not prepare the phone QR code.'); const qr = await qrResponse.json(); if (previewWindow) previewWindow.location.replace(qr.url); const target = $(linkTarget) || $('#phoneLayoutLink'); target.hidden = false; target.innerHTML = `<strong>Open the exact live preview</strong><img src="${qr.data}" alt="QR code for the exact Phone Layout Preview"><label>Backup link<input readonly value="${qr.url}" aria-label="Exact Phone Layout Preview link"></label><a href="${qr.url}" target="fivefold-arc-exact-preview" rel="noopener">Open exact preview</a><button type="button" data-copy-phone-layout-link>Copy link</button><small>This temporary link controls only this Studio draft.</small>`; target.querySelector('[data-copy-phone-layout-link]').addEventListener('click', async () => { await navigator.clipboard?.writeText(qr.url); toast('Exact Phone Layout Preview link copied.'); }); button.textContent = openInBrowser ? 'Open fast browser preview' : 'New phone QR code'; toast(openInBrowser ? 'Fast exact browser preview ready.' : 'Exact Phone Layout Preview ready.'); } catch (error) { previewWindow?.close(); toast(error.message || 'Could not create an exact phone preview.'); button.textContent = openInBrowser ? 'Open fast browser preview' : 'Create phone link'; } finally { button.disabled = false; } }
const exactPreviewRecovery = document.createElement('section'); exactPreviewRecovery.id = 'exactPreviewRecovery'; exactPreviewRecovery.className = 'exact-preview-recovery'; exactPreviewRecovery.hidden = true; exactPreviewRecovery.innerHTML = '<h2>Use the exact browser preview</h2><p>This embedded browser cannot load the live game inside Studio. Open the actual renderer in a separate browser tab for instant placement feedback; use the QR link for a final phone check.</p><button type="button" id="openExactPreviewButton">Open fast browser preview</button><div id="exactPreviewRecoveryLink" hidden></div>'; $('.preview-area').insertBefore(exactPreviewRecovery, $('#compareNote'));
async function syncPhoneLayoutSession() {
  if (!phoneLayoutSession || document.hidden || showingBaseline) return;
  try {
    const response = await fetch(`/api/appearance-studio/phone-layout/${phoneLayoutSession}`); if (!response.ok) return;
    const session = await response.json(); if (!session.updatedAt || session.updatedAt <= phoneLayoutUpdatedAt) return; phoneLayoutUpdatedAt = session.updatedAt;
    const update = phoneLayoutChanges(session.skin); if (!update || session.skin.id !== draft.id || JSON.stringify(update) === JSON.stringify({ interfaceStyle:draft.interfaceStyle,modeLayouts:draft.modeLayouts })) return;
    applyingPhoneLayout = true; draft.interfaceStyle = update.interfaceStyle; draft.modeLayouts = update.modeLayouts; normalizeUxSkin(draft); renderEditor(); changed();
  } catch { /* Keep the local draft available when the temporary link expires. */ }
  finally { applyingPhoneLayout = false; }
}
async function publishPhoneLayoutSession() {
  if (!phoneLayoutSession || applyingPhoneLayout) return;
  const skin = buildDevicePreviewSkin(), fingerprint = JSON.stringify(skin); if (fingerprint === lastPhoneLayoutPayload) return; lastPhoneLayoutPayload = fingerprint;
  phoneLayoutChannel?.postMessage({ type:'fivefold-arc:phone-layout-sync',skin });
  try { const response = await fetch(`/api/appearance-studio/phone-layout/${phoneLayoutSession}`, { method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({skin}) }); if (response.ok) phoneLayoutUpdatedAt = Math.max(phoneLayoutUpdatedAt,(await response.json()).updatedAt || 0); else lastPhoneLayoutPayload = ''; } catch { lastPhoneLayoutPayload = ''; }
}
const changedBeforePhoneLayout = changed; changed = function() { changedBeforePhoneLayout(); void publishPhoneLayoutSession(); };
$('#openPhoneLayoutEditor').addEventListener('click', () => createPhoneLayoutSession()); $('#openBrowserExactPreview').addEventListener('click', () => createPhoneLayoutSession({ button: $('#openBrowserExactPreview'), openInBrowser: true })); $('#openExactPreviewButton').addEventListener('click', () => createPhoneLayoutSession({ linkTarget: '#exactPreviewRecoveryLink', button: $('#openExactPreviewButton'), openInBrowser: true })); setInterval(syncPhoneLayoutSession, 1200);
devicePreview.sync();

// Foundation: bounded in-memory draft history and portable catalog handling.
// This deliberately records drafts only. Publishing remains an explicit action
// and catalog writes remain protected by the existing developer-key endpoint.
const APPEARANCE_CATALOG_SCHEMA_VERSION = 1;
const DRAFT_HISTORY_LIMIT = 60;
let draftHistory = [], draftHistoryIndex = -1, restoringDraftHistory = false;

function updateDraftHistoryControls() {
  const undo = $('#undoButton'), redo = $('#redoButton');
  if (undo) undo.disabled = draftHistoryIndex <= 0;
  if (redo) redo.disabled = draftHistoryIndex < 0 || draftHistoryIndex >= draftHistory.length - 1;
}
function resetDraftHistory() {
  draftHistory = draft ? [historyEntry(draft, legacyDraftSource)] : [];
  draftHistoryIndex = draftHistory.length - 1;
  updateDraftHistoryControls();
}
function recordDraftHistory() {
  if (restoringDraftHistory || !draft) return;
  const snapshot = historyEntry(draft, legacyDraftSource), current = draftHistory[draftHistoryIndex];
  if (current && JSON.stringify(current) === JSON.stringify(snapshot)) return;
  draftHistory.splice(draftHistoryIndex + 1);
  draftHistory.push(snapshot);
  if (draftHistory.length > DRAFT_HISTORY_LIMIT) draftHistory.shift();
  draftHistoryIndex = draftHistory.length - 1;
  updateDraftHistoryControls();
}
function restoreDraftHistory(index) {
  if (index < 0 || index >= draftHistory.length) return;
  restoringDraftHistory = true;
  draftHistoryIndex = index;
  const entry = draftHistory[index], restored = restoreDraftSnapshot(entry.draft || entry, { original, selectedId });
  selectedId = restored.selectedId; legacyDraftSource = isLegacyAppearance(restored.draft) ? clone(entry.legacySource || restored.draft) : null; draft = normalizeEditableSkin(restored.draft);
  showingBaseline = false; draftRevision += 1;
  renderLibrary(); renderEditor(); renderPreview(); validate();
  rememberDraft(); setSaveState(draftStatusLabel());
  restoringDraftHistory = false;
  updateDraftHistoryControls();
  void publishPhoneLayoutSession();
}
const changedWithHistory = changed;
changed = function() { changedWithHistory(); recordDraftHistory(); };
const selectSkinWithHistory = selectSkin;
selectSkin = function(id, options) { const changedSelection = selectSkinWithHistory(id, options); if (changedSelection) resetDraftHistory(); return changedSelection; };
$('#undoButton').addEventListener('click', () => restoreDraftHistory(draftHistoryIndex - 1));
$('#redoButton').addEventListener('click', () => restoreDraftHistory(draftHistoryIndex + 1));
document.addEventListener('keydown', event => {
  if (!event.ctrlKey && !event.metaKey) return;
  if (event.target.closest?.('input,textarea,[contenteditable="true"]')) return;
  if (event.key.toLowerCase() === 'z' && !event.shiftKey) { event.preventDefault(); restoreDraftHistory(draftHistoryIndex - 1); }
  if (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey)) { event.preventDefault(); restoreDraftHistory(draftHistoryIndex + 1); }
});

function catalogBackup() {
  const unavailable = store.assets.filter(asset => validateAppearanceAsset(asset, { requireData: true }).errors.length);
  if (unavailable.length) throw new Error(`Export stopped: ${unavailable.length} artwork file${unavailable.length === 1 ? ' is' : 's are'} unavailable or invalid. Retry the missing artwork in the Asset library before exporting a complete portable backup.`);
  return { schemaVersion: APPEARANCE_CATALOG_SCHEMA_VERSION, revision: store.revision ?? 0, exportedAt: new Date().toISOString(), skins: clone(store.skins), assets: clone(store.assets), selected: selectedId, gameDefaultLayout: clone(store.gameDefaultLayout || null) };
}
function inspectCatalogBackup(value) {
  if (!value || !Array.isArray(value.assets)) throw new Error('Choose an Appearance Studio catalog with skins and assets arrays.');
  const prepared = prepareCatalogRestore(value, confirmedCatalog); value = prepared.catalog;
  const metadata = backupMetadata(value);
  const validation = assertAppearanceValid(validateAppearanceCatalog(metadata, { previous: confirmedCatalog, mode: 'restore' }));
  for (const asset of value.assets) {
    const exists = confirmedCatalog?.assets?.some(item => item.id === asset.id);
    assertAppearanceValid(validateAppearanceAsset(asset, { requireData: !exists }));
    if (exists && asset.data && store.assets.find(item => item.id === asset.id)?.data !== asset.data) throw new Error(`Artwork “${asset.name || asset.id}” differs from the stored image. Import different artwork under a new asset ID instead of replacing an existing image.`);
  }
  return { skins: value.skins.length, assets: value.assets.length, warnings: validation.warnings, catalog: value, draftedSkins: prepared.draftedSkins, pendingAssets: prepared.pendingAssets, legacy: Number(value.schemaVersion || 0) !== APPEARANCE_CATALOG_SCHEMA_VERSION };
}
async function readCatalogBackupFile() {
  const file = $('#catalogBackupFile').files[0];
  if (!file) throw new Error('Choose an appearance-studio-catalog.json backup first.');
  if (file.size > PORTABLE_BACKUP_FILE_LIMIT) throw new Error('This file exceeds the maximum portable backup envelope for 100 skins and 250 optimized artwork files. Export a supported catalog backup instead.');
  return JSON.parse(await file.text());
}
$('#exportCatalogButton').addEventListener('click', () => {
  if (savingCatalog) return toast('Wait for the current catalog operation before exporting.');
  let backup;
  try { backup = catalogBackup(); } catch (error) { $('#catalogRestoreStatus').textContent = error.message; toast(error.message); return; }
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = 'appearance-studio-catalog.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  $('#catalogRestoreStatus').textContent = `Catalog export downloaded. ${isDraftDirty() ? 'Unsaved edits are not included; save a draft to include them. ' : ''}Keep the backup private: it contains developer artwork and metadata.`;
});
$('#validateCatalogButton').addEventListener('click', async () => {
  const status = $('#catalogRestoreStatus');
  try {
    const result = inspectCatalogBackup(await readCatalogBackupFile());
    status.textContent = `Backup validation passed: ${result.skins} skins and ${result.assets} images. ${result.draftedSkins} imported skins restore as Draft; ${result.pendingAssets} artwork files remain Pending. ${result.warnings.length} warnings. Existing approvals, player access grants, and the global layout stay protected; the server validates again on restore.`;
  } catch (error) { status.textContent = error.message || 'This catalog backup could not be checked.'; }
});
resetDraftHistory();

// Semantic token compatibility layer. Existing fields remain the rendering
// contract while `tokens` gives future controls one stable, named structure.
// A legacy catalog is upgraded in memory and saved back only on an explicit
// Studio save, publish, duplicate, or restore.
const APPEARANCE_TOKEN_SCHEMA_VERSION = 1;
const tokenColorFields = {
  canvas: 'background', surface: 'surface', text: 'text', textMuted: 'muted',
  accentPrimary: 'accent', accentSecondary: 'secondary', atmosphere: 'atmosphereColor'
};
const tokenEffectFields = {
  backgroundTreatment: 'backgroundTreatment', buttonTreatment: 'buttonTreatment', seatTreatment: 'seatTreatment'
};
function tokenNumber(value, fallback, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : fallback));
}
function normalizeAppearanceTokens(skin) {
  if (!skin) return;
  skin.tokens ||= {};
  const tokens = skin.tokens;
  tokens.schemaVersion = APPEARANCE_TOKEN_SCHEMA_VERSION;
  tokens.color ||= {};
  Object.entries(tokenColorFields).forEach(([token, field]) => {
    const value = typeof skin[field] === 'string' ? skin[field] : tokens.color[token];
    tokens.color[token] = /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : neutral[field];
    skin[field] = tokens.color[token];
  });
  for (const [token,key] of [['border','borderColor'],['disabled','disabledColor']]) {
    const value = skin[key] ?? tokens.color[token];
    if (/^#[0-9a-f]{6}$/i.test(value || '')) { skin[key] = value; tokens.color[token] = value; }
  }
  tokens.typography ||= {};
  tokens.typography.family = appearanceFontKeys.includes(skin.fontFamily) ? skin.fontFamily : (tokens.typography.family || 'system');
  skin.fontFamily = tokens.typography.family;
  tokens.typography.weight = [400, 500, 600, 700].includes(Number(skin.fontWeight)) ? Number(skin.fontWeight) : ([400, 500, 600, 700].includes(Number(tokens.typography.weight)) ? Number(tokens.typography.weight) : 700);
  tokens.typography.lineHeight = tokenNumber(skin.lineHeight, tokens.typography.lineHeight ?? 1.2, 1.1, 1.6);
  tokens.typography.letterSpacing = tokenNumber(skin.letterSpacing, tokens.typography.letterSpacing ?? 0, -.02, .08);
  tokens.typography.textTransform = ['none', 'uppercase'].includes(skin.textTransform) ? skin.textTransform : (['none', 'uppercase'].includes(tokens.typography.textTransform) ? tokens.typography.textTransform : 'none');
  tokens.typography.labelAlignment = ['inherit', 'start', 'center'].includes(skin.labelAlignment) ? skin.labelAlignment : (['inherit', 'start', 'center'].includes(tokens.typography.labelAlignment) ? tokens.typography.labelAlignment : 'inherit');
  tokens.typography.textEffect = ['none', 'soft-shadow'].includes(skin.textEffect) ? skin.textEffect : (['none', 'soft-shadow'].includes(tokens.typography.textEffect) ? tokens.typography.textEffect : 'none');
  skin.fontWeight = tokens.typography.weight;
  skin.lineHeight = tokens.typography.lineHeight;
  skin.letterSpacing = tokens.typography.letterSpacing;
  skin.textTransform = tokens.typography.textTransform;
  skin.labelAlignment = tokens.typography.labelAlignment;
  skin.textEffect = tokens.typography.textEffect;
  tokens.color.success = /^#[0-9a-f]{6}$/i.test(String(skin.stateSuccess || '')) ? skin.stateSuccess : (/^#[0-9a-f]{6}$/i.test(String(tokens.color.success || '')) ? tokens.color.success : '#85c799');
  tokens.color.warning = /^#[0-9a-f]{6}$/i.test(String(skin.stateWarning || '')) ? skin.stateWarning : (/^#[0-9a-f]{6}$/i.test(String(tokens.color.warning || '')) ? tokens.color.warning : '#efc968');
  tokens.color.danger = /^#[0-9a-f]{6}$/i.test(String(skin.stateDanger || '')) ? skin.stateDanger : (/^#[0-9a-f]{6}$/i.test(String(tokens.color.danger || '')) ? tokens.color.danger : '#ed866f');
  tokens.color.focus = /^#[0-9a-f]{6}$/i.test(String(skin.focusColor || '')) ? skin.focusColor : (/^#[0-9a-f]{6}$/i.test(String(tokens.color.focus || '')) ? tokens.color.focus : skin.accent);
  skin.stateSuccess = tokens.color.success; skin.stateWarning = tokens.color.warning; skin.stateDanger = tokens.color.danger; skin.focusColor = tokens.color.focus;
  tokens.effects ||= {};
  Object.entries(tokenEffectFields).forEach(([token, field]) => {
    tokens.effects[token] = typeof skin[field] === 'string' ? skin[field] : (tokens.effects[token] || (field === 'buttonTreatment' ? 'solid' : neutral[field]));
    skin[field] = tokens.effects[token];
  });
  tokens.components ||= {};
  ['button', 'lifeButton', 'customLife', 'commanderTax', 'commanderDamage', 'seat'].forEach(prefix => {
    const current = tokens.components[prefix] ||= {};
    current.opacity = tokenNumber(skin[`${prefix}Opacity`], current.opacity ?? 100, 35, 100);
    current.blur = tokenNumber(skin[`${prefix}Blur`], current.blur ?? 0, 0, 16);
    current.border = tokenNumber(skin[`${prefix}Border`], current.border ?? 70, 0, 100);
    skin[`${prefix}Opacity`] = current.opacity;
    skin[`${prefix}Blur`] = current.blur;
    skin[`${prefix}Border`] = current.border;
  });
}
function materializeAppearanceSkin(skin) {
  const result = clone(skin);
  normalizeAppearanceTokens(result);
  return result;
}
const changedWithTokens = changed;
changed = function() { normalizeAppearanceTokens(draft); changedWithTokens(); };
const selectSkinWithTokens = selectSkin;
selectSkin = function(id, options) { const changedSelection = selectSkinWithTokens(id, options); if (changedSelection) normalizeAppearanceTokens(draft); return changedSelection; };
normalizeAppearanceTokens(neutral); normalizeAppearanceTokens(draft);
renderExactPreview(); devicePreview.sync();

// Progressive disclosure: these are global semantic controls, while the
// existing per-layout sizing tools remain where designers already expect them.
const semanticTokensPanel = document.createElement('details');
semanticTokensPanel.className = 'studio-fold semantic-tokens-panel';
semanticTokensPanel.innerHTML = '<summary>State colors &amp; global type</summary><p class="helper">These named tokens apply to status messages and keyboard focus in the isolated preview. Core controls remain protected.</p><div class="ux-grid"><label>Success<input id="stateSuccess" type="color"></label><label>Warning<input id="stateWarning" type="color"></label><label>Danger<input id="stateDanger" type="color"></label><label>Focus ring<input id="focusColor" type="color"></label></div><label>Global text weight<select id="fontWeight"><option value="400">Regular</option><option value="500">Medium</option><option value="600">Semibold</option><option value="700">Bold</option></select></label><div class="ux-grid"><label>Line height <output id="lineHeightValue"></output><input id="lineHeight" type="range" min="1.1" max="1.6" step="0.05"></label><label>Letter spacing <output id="letterSpacingValue"></output><input id="letterSpacing" type="range" min="-0.02" max="0.08" step="0.01"></label></div><div class="ux-grid"><label>Label casing<select id="textTransform"><option value="none">Keep original</option><option value="uppercase">Uppercase</option></select></label><label>Label alignment<select id="labelAlignment"><option value="inherit">Keep original</option><option value="start">Start</option><option value="center">Center</option></select></label><label>Text effect<select id="textEffect"><option value="none">None</option><option value="soft-shadow">Soft shadow</option></select></label></div>';
$('#uxStudioPanel').insertBefore(semanticTokensPanel, $('#uxStudioPanel').querySelector('.phone-layout-control'));
function renderSemanticTokens() {
  normalizeAppearanceTokens(draft);
  ['stateSuccess', 'stateWarning', 'stateDanger', 'focusColor', 'fontWeight', 'lineHeight', 'letterSpacing', 'textTransform', 'labelAlignment', 'textEffect'].forEach(key => { const input = $(`#${key}`); if (input) input.value = String(draft[key]); });
  $('#lineHeightValue').textContent = `${Number(draft.lineHeight).toFixed(2)}×`;
  $('#letterSpacingValue').textContent = `${Number(draft.letterSpacing).toFixed(2)}em`;
}
const renderEditorWithSemanticTokens = renderEditor;
renderEditor = function() { renderEditorWithSemanticTokens(); renderSemanticTokens(); };
['stateSuccess', 'stateWarning', 'stateDanger', 'focusColor', 'fontWeight', 'lineHeight', 'letterSpacing', 'textTransform', 'labelAlignment', 'textEffect'].forEach(key => $(`#${key}`).addEventListener('input', event => {
  draft[key] = ['fontWeight', 'lineHeight', 'letterSpacing'].includes(key) ? Number(event.target.value) : event.target.value;
  renderSemanticTokens(); changed();
}));
renderSemanticTokens();

const componentColorDefaults = {
  endTurn: { label: 'End Turn action', background: '#d8ae61', text: '#201a0f', border: '#d8ae61' },
  lifeButtons: { label: 'Life change buttons', background: '#161616', text: '#f4ecd9', border: '#62583f' },
  playerCards: { label: 'Player cards', background: '#161616', text: '#f4ecd9', border: '#5b594f' },
  navigation: { label: 'Counter navigation', background: '#161616', text: '#afa590', border: '#4b4b44', selectedText: '#d8ae61', selectedBorder: '#d8ae61' }
};
function normalizeComponentColors(skin) {
  if (!skin) return; skin.componentColors ||= {};
  const paletteDefaults = rendererComponentDefaults(skin);
  Object.entries(componentColorDefaults).forEach(([key, defaults]) => {
    const colors = skin.componentColors[key] ||= {};
    Object.entries(defaults).forEach(([field, fallback]) => {
      if (field === 'label') return;
      colors[field] = /^#[0-9a-f]{6}$/i.test(String(colors[field] || '')) ? colors[field] : paletteDefaults[key][field];
    });
  });
}
const changedWithComponentColors = changed;
changed = function() { normalizeComponentColors(draft); changedWithComponentColors(); };
normalizeComponentColors(neutral); normalizeComponentColors(draft);
const componentColorsPanel = document.createElement('details');
componentColorsPanel.className = 'studio-fold component-colors-panel';
componentColorsPanel.innerHTML = '<summary>Component colors</summary><p class="helper">Override only these supported game surfaces. Reset a component to its safe defaults at any time.</p><div id="componentColorControls"></div>';
$('#uxStudioPanel').insertBefore(componentColorsPanel, semanticTokensPanel);
function renderComponentColors() {
  normalizeComponentColors(draft); const target = $('#componentColorControls');
  target.innerHTML = Object.entries(componentColorDefaults).map(([key, defaults]) => { const colors = draft.componentColors[key]; const fields = Object.keys(defaults).filter(field => field !== 'label'); return `<details class="component-placement"><summary>${defaults.label}</summary><div class="ux-grid">${fields.map(field => `<label>${field === 'selectedText' ? 'Selected text' : field === 'selectedBorder' ? 'Selected border' : field[0].toUpperCase() + field.slice(1)}<input data-component-color="${key}" data-component-color-field="${field}" type="color" value="${colors[field]}"></label>`).join('')}</div><button type="button" data-component-color-reset="${key}">Reset ${defaults.label}</button></details>`; }).join('');
  $$('[data-component-color]').forEach(input => input.addEventListener('input', event => { const colors = draft.componentColors[event.target.dataset.componentColor]; colors[event.target.dataset.componentColorField] = event.target.value; changed(); }));
  $$('[data-component-color-reset]').forEach(button => button.addEventListener('click', () => { draft.componentColors[button.dataset.componentColorReset] = rendererComponentDefaults(draft)[button.dataset.componentColorReset]; renderComponentColors(); changed(); }));
}
const renderEditorWithComponentColors = renderEditor;
renderEditor = function() { renderEditorWithComponentColors(); renderComponentColors(); };
renderComponentColors();

// Presets are draft-only visual recipes. They never touch room state, player
// ownership, networking, input handlers, or any gameplay setting.
const appearancePresets = {
  neutral: { name: 'Neutral Studio', values: { background: '#080808', surface: '#161616', accent: '#d8ae61', secondary: '#6e552a', text: '#f4ecd9', muted: '#afa590', atmosphereColor: '#70a97a', backgroundTreatment: 'plain', buttonTreatment: 'glass', seatTreatment: 'raised', fontFamily: 'system', fontWeight: 700, lineHeight: 1.2, letterSpacing: 0 } },
  highContrast: { name: 'High Contrast', values: { background: '#050505', surface: '#151515', accent: '#ffd36d', secondary: '#98d9a4', text: '#ffffff', muted: '#d6d6d6', atmosphereColor: '#98d9a4', backgroundTreatment: 'plain', buttonTreatment: 'solid', seatTreatment: 'raised', fontFamily: 'system', fontWeight: 700, lineHeight: 1.25, letterSpacing: .01 } },
  midnightGlass: { name: 'Midnight Glass', values: { background: '#07101b', surface: '#112235', accent: '#75c7ff', secondary: '#af9cff', text: '#f2f8ff', muted: '#b8c8dc', atmosphereColor: '#466f9d', backgroundTreatment: 'mist', buttonTreatment: 'glass', seatTreatment: 'glass', fontFamily: 'rounded', fontWeight: 600, lineHeight: 1.25, letterSpacing: 0 } },
  seasonalEmber: { name: 'Seasonal Ember', values: { background: '#180d09', surface: '#2a1911', accent: '#ffc38c', secondary: '#e1ab73', text: '#fff3df', muted: '#d9bda7', atmosphereColor: '#a44e20', backgroundTreatment: 'grain', buttonTreatment: 'solid', seatTreatment: 'flat', fontFamily: 'serif', fontWeight: 600, lineHeight: 1.3, letterSpacing: .01 } },
  achievementCandidate: { name: 'Verdant Victory candidate', values: { background: '#061711', surface: '#102c21', accent: '#9ee4bd', secondary: '#dbcb87', text: '#f0fff6', muted: '#b6d9c4', atmosphereColor: '#377d54', backgroundTreatment: 'rays', buttonTreatment: 'outline', seatTreatment: 'raised', fontFamily: 'rounded', fontWeight: 700, lineHeight: 1.25, letterSpacing: .02 } },
  premiumCandidate: { name: 'Gilded Night candidate', values: { background: '#130c22', surface: '#241736', accent: '#ead09b', secondary: '#c2abed', text: '#fbf3ff', muted: '#d1bedf', atmosphereColor: '#71509a', backgroundTreatment: 'stars', buttonTreatment: 'glass', seatTreatment: 'glass', fontFamily: 'serif', fontWeight: 600, lineHeight: 1.3, letterSpacing: .02 } }
};
for (const { values } of Object.values(appearancePresets)) values.componentColors = {
  endTurn: { background: values.accent, text: values.background, border: values.accent },
  lifeButtons: { background: values.surface, text: values.text, border: values.muted },
  playerCards: { background: values.surface, text: values.text, border: values.muted },
  navigation: { background: values.surface, text: values.muted, border: values.muted, selectedText: values.accent, selectedBorder: values.accent }
};
const presetsPanel = document.createElement('details');
presetsPanel.className = 'studio-fold appearance-presets-panel';
presetsPanel.innerHTML = `<summary>Visual presets</summary><p class="helper">Apply a visual starting point to this unsaved draft. Undo restores the exact prior draft. Candidate names describe design ideas only; they never grant paid or achievement access.</p><div class="preset-actions">${Object.entries(appearancePresets).map(([id, preset]) => `<button type="button" data-appearance-preset="${id}">${preset.name}</button>`).join('')}</div>`;
$('#uxStudioPanel').insertBefore(presetsPanel, componentColorsPanel);
$$('[data-appearance-preset]').forEach(button => button.addEventListener('click', () => {
  const preset = appearancePresets[button.dataset.appearancePreset]; if (!preset) return;
  if (isLegacyAppearance(draft)) return toast('Use expanded controls to apply a new visual starting point.');
  draft.rendererVersion = 2;
  if (['Untitled skin', 'Neutral Arc'].includes(draft.name)) draft.name = `${preset.name} draft`.slice(0, 32);
  Object.assign(draft, clone(preset.values)); normalizeAppearanceTokens(draft); normalizeComponentColors(draft); renderEditor(); changed(); toast(`${preset.name} applied to this draft.`);
}));

// Saved versions are bounded, portable with a catalog backup, and only ever
// restore into the current unsaved Studio draft. They never alter table state
// or approval status until the designer explicitly saves or publishes again.
const SKIN_VERSION_LIMIT = 12;
function versionAppearance(skin) {
  const appearance = clone(skin);
  delete appearance.versions;
  return appearance;
}
function recordSavedSkinVersion(skin, label) {
  skin.versions = Array.isArray(skin.versions) ? skin.versions.slice(-SKIN_VERSION_LIMIT) : [];
  skin.versions.push({ id: `version-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, label: String(label || 'Saved draft').slice(0, 80), savedAt: new Date().toISOString(), appearance: versionAppearance(skin) });
  if (skin.versions.length > SKIN_VERSION_LIMIT) skin.versions.splice(0, skin.versions.length - SKIN_VERSION_LIMIT);
}
const versionHistoryPanel = document.createElement('section');
versionHistoryPanel.className = 'property-editor version-history-panel';
versionHistoryPanel.innerHTML = '<p class="kicker">SAVED VERSIONS</p><h2>Recover a skin draft</h2><p class="helper">Restoring a saved version changes only this unsaved visual draft. Save or publish explicitly when it is ready.</p><div id="skinVersionList" class="skin-version-list"></div>';
$('.property-editor').insertAdjacentElement('afterend', versionHistoryPanel);
function renderVersionHistory() {
  const list = $('#skinVersionList');
  const versions = Array.isArray(draft?.versions) ? draft.versions : [];
  list.innerHTML = versions.length ? versions.slice().reverse().map((version, reverseIndex) => {
    const index = versions.length - reverseIndex - 1;
    const date = version.savedAt ? new Date(version.savedAt).toLocaleString() : 'Saved version';
    return `<div class="skin-version"><span><strong>${escape(version.label || 'Saved draft')}</strong><small>${escape(date)}</small></span><button type="button" data-restore-skin-version="${index}">Restore to draft</button></div>`;
  }).join('') : '<p class="helper">Save this skin to create its first recoverable version.</p>';
  $$('[data-restore-skin-version]').forEach(button => button.addEventListener('click', () => {
    const version = draft?.versions?.[Number(button.dataset.restoreSkinVersion)];
    if (!version?.appearance || !confirm(`Restore “${version.label || 'saved draft'}” into the current unsaved draft?`)) return;
    const versions = clone(draft.versions || []), status = draft.status;
    draft = { ...clone(version.appearance), id: selectedId, versions, status };
    legacyDraftSource = isLegacyAppearance(draft) ? clone(draft) : null;
    draft = normalizeEditableSkin(draft);
    renderEditor(); changed(); toast('Saved version restored to the unsaved draft.');
  }));
}
const renderEditorWithVersionHistory = renderEditor;
renderEditor = function() { renderEditorWithVersionHistory(); renderVersionHistory(); };
renderVersionHistory();

// Spacing is intentionally limited to the player-card grid. It keeps the
// responsive structure and every interactive game control intact.
const normalizeUxSkinWithSeatGap = normalizeUxSkin;
normalizeUxSkin = function(skin) {
  normalizeUxSkinWithSeatGap(skin);
  Object.values(skin?.modeLayouts || {}).forEach(layout => { layout.seatGap = Math.min(16, Math.max(4, Number(layout.seatGap) || 8)); });
};
const seatGapControl = document.createElement('label');
seatGapControl.innerHTML = 'Player-card gap <output id="seatGapValue"></output><input id="seatGap" type="range" min="4" max="16" step="2">';
$('#seatRadius').closest('.ux-grid')?.append(seatGapControl);
function renderSeatGap() {
  const layout = activeModeLayout();
  $('#seatGap').value = String(layout.seatGap);
  $('#seatGapValue').textContent = `${layout.seatGap}px`;
}
$('#seatGap').addEventListener('input', event => { activeModeLayout().seatGap = Number(event.target.value); renderSeatGap(); changed(); });
const renderEditorWithSeatGap = renderEditor;
renderEditor = function() { renderEditorWithSeatGap(); renderSeatGap(); };
renderSeatGap();
const workspace = mountStudioWorkspace({resetSection:resetStudioSection, compareOptions:getStudioComparisonOptions, setComparison:setStudioComparison,onSection:id=>{ if (id === 'assets') renderAssets(); }});
mountStarterPicker({start:newSkin});
mountPartPicker(workspace);
const renderTreatments = mountAppearanceTreatments({getDraft:()=>draft,change:()=>changed()});
const renderDesignEditors = [
  mountStudioRewardEditor({getDraft: () => draft, change: () => changed(), headers: catalogHeaders}),
  mountCommanderTreatmentEditor({
    getDraft: () => draft, getAssets: () => store.assets, change: () => { renderCounterDesign(); changed(); },
    preview: context => { commanderPreviewContext = context; renderPreview(); }
  }),
  mountTableDesignEditor({getDraft:()=>draft,change:changed}),
  mountSurfaceEditor({getDraft:()=>draft,getSource:()=>original,change:changed}),
  mountSurfaceArtEditor({getDraft:()=>draft,getAssets:()=>store.assets,change:changed})
];
const renderPalette = mountPaletteInputs();
renderCounterDesign = mountCounterDesignEditor({
  mount:$('#edit-symbols'),getSkin:()=>draft,assetOptions,changed,
  preview:mode=>{previewMode=mode;$$('[data-preview-mode]').forEach(button=>button.classList.toggle('selected',button.dataset.previewMode===mode));renderPreview();},
});
const renderEditorWithTreatments = renderEditor;
renderRendererLifecycle = mountRendererLifecycle({getDraft:()=>draft,saving:()=>savingCatalog,expand:useExpandedControls});
renderEditor = function() { renderEditorWithTreatments(); renderTreatments(); for (const render of renderDesignEditors) render(); renderPalette(); renderRendererLifecycle(); };
for (const key of ['thumbnailAsset','buttonAsset']) document.getElementById(key).addEventListener('change', event => { draft[key] = event.target.value; changed(); });

mountAppearanceFontPicker(document.getElementById('fontFamily'));
studioReady = true;
selectSkin(selectedId, { force: true });
window.addEventListener('beforeunload', event => { if (isDraftDirty()) { rememberDraft(); event.preventDefault(); event.returnValue = ''; } });
if (!developerKey) { $('#studioAccess').hidden = false; recoverDraft(); }

mountStudioReleaseEditor({ mount: $('#publicationControls'), getSelectedId: () => selectedId, headers: catalogHeaders, renderFixture: renderPreflightFixture,
  prepareDraft: async () => {
    if (!developerKey || !studioReady) throw new Error('Open the protected Studio catalog first.');
    if (!draft?.rewardRule) throw new Error('Choose the achievements for this skin in Review & publish.');
    if (isDraftDirty() && !await saveDraft('Preparing reward release')) throw new Error('Save the draft before preparing a release.');
    return { id: selectedId, revision: confirmedCatalog?.revision ?? 0 };
  }
});
