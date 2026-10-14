import { mountDevicePreview } from './device-preview.js?v=2';
const $ = s => document.querySelector(s); const $$ = s => [...document.querySelectorAll(s)];
const KEY = 'fivefold-arc:appearance-studio'; let developerKey = sessionStorage.getItem('fivefold-arc:developer-key') || '';
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
  if (event.origin === location.origin && event.data?.type === 'fivefold-arc:appearance-preview-ready') markExactPreviewReady();
});
const icons = { life: '♥', commander: '♜', radiation: '☢', poison: '☠', energy: 'ϟ', generic: '◇' };
const labels = { life: 'Life', commander: 'Commander damage', radiation: 'Radiation', poison: 'Poison', energy: 'Energy', generic: 'Generic counters' };
const neutral = { id: 'neutral', name: 'Neutral Arc', status: 'Approved', edited: 'Built in', background: '#080808', surface: '#161616', accent: '#d8ae61', secondary: '#6e552a', text: '#f4ecd9', muted: '#afa590', atmosphere: 'dark', atmosphereColor: '#70a97a', atmosphereStrength: 35, atmospherePosition: 'top', backgroundTreatment: 'plain', backgroundAsset: '', backgroundScale: 100, backgroundPositionX: 50, backgroundPositionY: 50, ring: 'arc', sealAsset: '', buttonTreatment: 'glass', buttonOpacity: 100, buttonBlur: 0, buttonBorder: 70, lifeButtonOpacity: 100, lifeButtonBlur: 0, lifeButtonBorder: 70, customLifeOpacity: 100, customLifeBlur: 0, customLifeBorder: 70, commanderTaxOpacity: 100, commanderTaxBlur: 0, commanderTaxBorder: 70, commanderDamageOpacity: 100, commanderDamageBlur: 0, commanderDamageBorder: 70, seatTreatment: 'raised', seatOpacity: 100, seatBlur: 0, seatBorder: 70, symbols: { ...icons }, symbolAssets: {}, symbolScale: {} };
let store; try { store = JSON.parse(localStorage.getItem(KEY)) || { skins: [neutral], selected: 'neutral' }; } catch { store = { skins: [neutral], selected: 'neutral' }; }
if (!store.skins?.some(s => s.id === 'neutral')) store.skins.unshift(neutral);
store.assets ||= []; store.skins.forEach(normalizeSkin);
let selectedId = store.selected || 'neutral', draft = null, original = null, previewSize = 'phone', previewState = 'turn', previewMode = 'life', previewModeIndex = 0, previewPlayers = 4, showingBaseline = false;
const fields = ['name','background','surface','accent','secondary','text','muted','atmosphere','atmosphereColor','atmosphereStrength','atmospherePosition','backgroundTreatment','backgroundScale','backgroundPositionX','backgroundPositionY','ring','sealAsset','buttonTreatment','buttonOpacity','buttonBlur','buttonBorder','lifeButtonOpacity','lifeButtonBlur','lifeButtonBorder','customLifeOpacity','customLifeBlur','customLifeBorder','commanderTaxOpacity','commanderTaxBlur','commanderTaxBorder','commanderDamageOpacity','commanderDamageBlur','commanderDamageBorder','seatTreatment','seatOpacity','seatBlur','seatBorder'];
// Foundation used to be one permanently expanded form. Group the existing
// controls without changing their IDs or their behavior, so the live preview
// stays beside the one visual decision the designer is making.
function foldControls(summary, nodes, className = 'studio-fold') { const fold = document.createElement('details'); fold.className = className; fold.innerHTML = `<summary>${summary}</summary>`; nodes.filter(Boolean).forEach(node => fold.append(node)); return fold; }
function compactFoundation() { const foundation = $('.property-editor'); const heading = foundation?.querySelector('.section-heading'); if (!foundation || !heading) return; const skinName = $('#skinName')?.closest('label'); const colors = foundation.querySelector('.color-grid'); const atmosphere = [$('#atmosphere')?.closest('label'), foundation.querySelector('.atmosphere-controls')]; const appearance = [$('#backgroundTreatment')?.closest('label'), $('#backgroundAsset')?.closest('label'), foundation.querySelector('.background-art-controls'), $('#ring')?.closest('label'), $('#sealAsset')?.closest('label')]; const buttonTreatment = $('#buttonTreatment')?.closest('label'); const groups = [foldControls('Skin name', [skinName]), foldControls('Colors & atmosphere', [colors, ...atmosphere]), foldControls('Background & center seal', appearance), foldControls('Action treatment', [buttonTreatment])]; groups.reverse().forEach(group => heading.after(group)); const advanced = foundation.querySelector('.advanced-styling'); if (!advanced) return; advanced.classList.add('studio-fold'); advanced.open = false; const helper = advanced.querySelector('.helper'); const blocks = Array.from(advanced.querySelectorAll(':scope > .background-art-controls')); const seatTreatment = advanced.querySelector(':scope > label'); if (helper) helper.remove(); const advancedGroups = [foldControls('End Turn button', [blocks[0]], 'component-placement'), foldControls('Life change buttons', [blocks[1]], 'component-placement'), foldControls('Custom life button', [blocks[2]], 'component-placement'), foldControls('Commander card', [blocks[3]], 'component-placement'), foldControls('Commander damage cards', [blocks[4]], 'component-placement'), foldControls('Player cards', [seatTreatment, blocks[5]], 'component-placement')]; advancedGroups.forEach(group => advanced.append(group)); }
compactFoundation();
function normalizeSkin(skin) { skin.backgroundAsset ||= ''; skin.sealAsset ||= ''; skin.symbolAssets ||= {}; skin.symbolScale ||= {}; skin.atmosphereColor ||= skin.secondary || '#70a97a'; skin.atmosphereStrength = Math.min(80, Math.max(0, Number(skin.atmosphereStrength) || 35)); skin.atmospherePosition ||= 'top'; skin.backgroundScale = Math.min(200, Math.max(50, Number(skin.backgroundScale) || 100)); skin.backgroundPositionX = Math.min(100, Math.max(0, Number(skin.backgroundPositionX) || 50)); skin.backgroundPositionY = Math.min(100, Math.max(0, Number(skin.backgroundPositionY) || 50)); ['button','lifeButton','customLife','commanderTax','commanderDamage','seat'].forEach(prefix => { skin[`${prefix}Opacity`] = Math.min(100, Math.max(35, Number(skin[`${prefix}Opacity`]) || 100)); skin[`${prefix}Blur`] = Math.min(16, Math.max(0, Number(skin[`${prefix}Blur`]) || 0)); skin[`${prefix}Border`] = Math.min(100, Math.max(0, Number.isFinite(Number(skin[`${prefix}Border`])) ? Number(skin[`${prefix}Border`]) : 70)); }); }
const normalizeSkinBase = normalizeSkin;
normalizeSkin = function(skin) { normalizeSkinBase(skin); skin.symbols ||= { ...icons }; };
function saveStore() { try { if (location.protocol !== 'file:') { localStorage.removeItem(KEY); return true; } localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* direct-file cache is optional */ } return true; }
const catalogHeaders = { 'content-type': 'application/json', 'x-feedback-portal-key': developerKey };
let savingCatalog = false;
function setCatalogSaving(active, label = 'Saving draft') { savingCatalog = active; ['saveButton', 'duplicateButton', 'publishButton', 'importAssetButton', 'restoreCatalogButton'].forEach(id => { const button = $(`#${id}`); if (button) button.disabled = active; }); if (active) setSaveState(`${label}…`); }
async function saveCatalog({ label = 'Saving draft' } = {}) { if (savingCatalog) return false; setCatalogSaving(true, label); try { const assets = store.assets.filter(item => item.data && item.pendingUpload); for (let index = 0; index < assets.length; index += 1) { setSaveState(`${label}… artwork ${index + 1} of ${assets.length}`); const response = await fetch(`/api/appearance-studio/assets/${assets[index].id}`, { method: 'PUT', headers: catalogHeaders, body: JSON.stringify(assets[index]) }); if (!response.ok) throw new Error(); delete assets[index].pendingUpload; } setSaveState(`${label}… catalog`); const catalog = { ...store, skins: store.skins.map(materializeAppearanceSkin), assets: store.assets.map(({ data, pendingUpload, ...asset }) => asset) }; const response = await fetch('/api/appearance-studio/catalog', { method: 'PUT', headers: catalogHeaders, body: JSON.stringify(catalog) }); if (!response.ok) throw new Error(); return true; } catch { setSaveState('Save failed — try again'); toast('The catalog was not saved. Open Appearance Studio from the protected Developer Assets tab and try again.'); return false; } finally { setCatalogSaving(false); } }
async function loadAssetData(asset) { if (asset.data) return asset; const response = await fetch(`/api/appearance-studio/assets/${asset.id}`, { headers: { 'x-feedback-portal-key': developerKey } }); if (!response.ok) throw new Error(); return (await response.json()).asset; }
function selected() { return store.skins.find(s => s.id === selectedId) || neutral; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function relativeDate() { return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date()); }
function toast(message) { const el = $('#toast'); el.textContent = message; el.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => el.hidden = true, 2600); }
function setSaveState(text = 'Unsaved') { $('#saveState').textContent = text; }
function clearPublishFeedback() { $('#publishFeedback').hidden = true; $('#publishFeedback').replaceChildren(); }
function showPublishFeedback(title, reason) { const feedback = $('#publishFeedback'); feedback.replaceChildren(); const heading = document.createElement('strong'), detail = document.createElement('span'); heading.textContent = title; detail.textContent = reason; feedback.append(heading, detail); feedback.hidden = false; feedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
function renderLibrary() { const query = $('#skinSearch').value.trim().toLowerCase(); $('#skinLibrary').innerHTML = store.skins.filter(s => s.name.toLowerCase().includes(query)).map(s => `<div class="skin-library-item"><button class="skin-card ${s.id === selectedId ? 'selected' : ''}" data-skin="${s.id}" type="button"><span class="skin-thumb" style="--thumb-bg:${s.background};--thumb-accent:${s.accent}"></span><span><strong>${escape(s.name)}</strong><small>${s.status} · ${s.edited}</small></span></button>${s.id === 'neutral' ? '' : `<button class="delete-skin-button" data-delete-skin="${s.id}" type="button" aria-label="Delete ${escape(s.name)}">Delete</button>`}</div>`).join('') || '<p class="empty">No skins match.</p>'; $$('#skinLibrary [data-skin]').forEach(b => b.addEventListener('click', () => selectSkin(b.dataset.skin))); $$('#skinLibrary [data-delete-skin]').forEach(b => b.addEventListener('click', () => deleteSkin(b.dataset.deleteSkin)));
}
function escape(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function assetsFor(placement) { return store.assets.filter(asset => asset.placement === placement); }
function assetOptions(placement, value, empty) { return `<option value="">${empty}</option>${assetsFor(placement).map(asset => `<option value="${asset.id}" ${asset.id === value ? 'selected' : ''}>${escape(asset.name)}</option>`).join('')}`; }
function renderSymbols() { $('#symbolControls').innerHTML = Object.entries(labels).map(([key, label]) => `<div class="symbol-control"><span>${label}<small>Accessible label fixed</small></span><select data-symbol="${key}" aria-label="${label} built-in symbol">${Object.values(icons).map(symbol => `<option value="${symbol}" ${draft.symbols[key] === symbol ? 'selected' : ''}>${symbol}</option>`).join('')}</select><select data-symbol-asset="${key}" aria-label="${label} custom image">${assetOptions('symbol', draft.symbolAssets[key], 'Built-in symbol')}</select><label class="icon-scale">Icon scale <output>${draft.symbolScale[key] || 100}%</output><input data-symbol-scale="${key}" aria-label="${label} icon scale" type="range" min="60" max="200" step="5" value="${draft.symbolScale[key] || 100}"></label><button class="text-button" data-symbol-autofit="${key}" type="button">Auto-fit icon</button></div>`).join(''); $$('#symbolControls select[data-symbol]').forEach(el => el.addEventListener('input', () => { draft.symbols[el.dataset.symbol] = el.value; changed(); })); $$('#symbolControls select[data-symbol-asset]').forEach(el => el.addEventListener('input', () => { draft.symbolAssets[el.dataset.symbolAsset] = el.value; changed(); })); $$('#symbolControls input[data-symbol-scale]').forEach(el => el.addEventListener('input', () => { draft.symbolScale[el.dataset.symbolScale] = Number(el.value); el.previousElementSibling.textContent = `${el.value}%`; changed(); })); $$('#symbolControls [data-symbol-autofit]').forEach(button => button.addEventListener('click', () => { const key = button.dataset.symbolAutofit; draft.symbolScale[key] = 100; renderEditor(); changed(); })); }
function renderAssets() { $('#backgroundAsset').innerHTML = assetOptions('background', draft.backgroundAsset, 'No imported art'); $('#sealAsset').innerHTML = assetOptions('symbol', draft.sealAsset, 'Built-in seal'); $('#assetLibrary').innerHTML = store.assets.length ? store.assets.map(asset => `<div><b>${escape(asset.name)}</b><small>${asset.placement} · ${escape(asset.source)}</small><button type="button" class="text-button" data-delete-asset="${asset.id}">Delete</button></div>`).join('') : '<p class="helper">No imported assets yet.</p>'; $$('[data-delete-asset]').forEach(button => button.addEventListener('click', () => deleteAsset(button.dataset.deleteAsset))); }
function clearAssetReference(skin, id) { if (!skin) return; if (skin.backgroundAsset === id) skin.backgroundAsset = ''; if (skin.sealAsset === id) skin.sealAsset = ''; Object.keys(skin.symbolAssets || {}).forEach(key => { if (skin.symbolAssets[key] === id) skin.symbolAssets[key] = ''; }); }
async function deleteSkin(id) { if (id === 'neutral') return; const skin = store.skins.find(item => item.id === id); if (!skin || !confirm(`Delete “${skin.name}”? This removes the skin from the Studio library.`)) return; const previousStore = clone(store), previousSelected = selectedId; store.skins = store.skins.filter(item => item.id !== id); selectedId = id === selectedId ? 'neutral' : selectedId; store.selected = selectedId; if (!await saveCatalog()) { store = previousStore; selectedId = previousSelected; return; } selectSkin(selectedId); toast(`${skin.name} deleted from the Studio library.`); }
async function deleteAsset(id) { const asset = store.assets.find(item => item.id === id); if (!asset || !confirm(`Delete “${asset.name}” from the asset library? This cannot be undone.`)) return; const previousStore = clone(store), previousDraft = clone(draft), previousOriginal = clone(original); store.assets = store.assets.filter(item => item.id !== id); store.skins.forEach(skin => clearAssetReference(skin, id)); clearAssetReference(draft, id); clearAssetReference(original, id); if (!await saveCatalog()) { store = previousStore; draft = previousDraft; original = previousOriginal; renderEditor(); renderPreview(); return; } saveStore(); renderEditor(); renderPreview(); validate(); setSaveState('Asset deleted'); toast(`${asset.name} deleted from the server catalog.`); }
function renderEditor() { fields.forEach(key => { const el = $(`#${key === 'name' ? 'skinName' : key}`); if (el) el.value = draft[key]; }); $('#atmosphereStrengthValue').textContent = `${draft.atmosphereStrength}%`; $('#backgroundScaleValue').textContent = `${draft.backgroundScale}%`; $('#backgroundPositionXValue').textContent = `${draft.backgroundPositionX}%`; $('#backgroundPositionYValue').textContent = `${draft.backgroundPositionY}%`; ['button','lifeButton','customLife','commanderTax','commanderDamage','seat'].forEach(prefix => { $(`#${prefix}OpacityValue`).textContent = `${draft[`${prefix}Opacity`]}%`; $(`#${prefix}BlurValue`).textContent = `${draft[`${prefix}Blur`]}px`; $(`#${prefix}BorderValue`).textContent = `${draft[`${prefix}Border`]}%`; }); $('#skinNameLabel').textContent = draft.name; renderAssets(); renderSymbols(); constrainIconScales(); }
function constrainIconScales() { $$('#symbolControls input[data-symbol-scale]').forEach(el => { const value = Math.min(200, Math.max(60, Number(el.value) || 100)); el.value = String(value); draft.symbolScale[el.dataset.symbolScale] = value; const output = el.parentElement?.querySelector('output'); if (output) output.textContent = `${value}%`; }); }
function selectSkin(id) { selectedId = id; store.selected = id; normalizeSkin(selected()); original = clone(selected()); draft = clone(selected()); renderLibrary(); renderEditor(); renderPreview(); validate(); saveStore(); setSaveState(draft.status === 'Approved' ? 'Approved' : 'Saved'); }
function changed() { clearPublishFeedback(); $('#skinNameLabel').textContent = draft.name || 'Untitled skin'; renderPreview(); validate(); setSaveState('Unsaved'); }
function contrast(a, b) { const lum = hex => { const c = hex.replace('#','').match(/.{2}/g).map(v => parseInt(v,16)/255).map(v => v <= .03928 ? v/12.92 : ((v+.055)/1.055) ** 2.4); return .2126*c[0]+.7152*c[1]+.0722*c[2]; }; const [x,y] = [lum(a),lum(b)].sort((m,n) => n-m); return (x+.05)/(y+.05); }
function validate() { const checks = [
  { label: 'Life total is legible over its counter surface', pass: contrast(draft.text, draft.surface) >= 4.5, screen: 'Your turn · life total' },
  { label: 'Player and seat label remain distinct from life total', pass: contrast(draft.muted, draft.surface) >= 3, screen: 'Your turn · ownership' },
  { label: 'Turn label and End Turn control remain visible', pass: contrast(draft.text, draft.background) >= 4.5 && contrast(draft.accent, draft.background) >= 3, screen: 'Your turn · turn action' },
  { label: 'Artwork keeps controls readable', pass: !draft.backgroundAsset, advisory: true, screen: draft.backgroundAsset ? 'Needs visual review with imported art' : 'No imported art selected' },
  { label: 'Active turn is labeled, not color-only', pass: true, screen: 'Your turn / another turn' },
  { label: 'Connection state has an icon and label', pass: true, screen: 'Disconnected view' },
  { label: 'Labels fit at 320 × 700', pass: draft.name.length <= 32, screen: 'Compact phone' },
  { label: 'Preview touch targets are at least 44 px', pass: false, advisory: true, screen: 'Needs a real phone check' }
]; const failed = checks.filter(c => !c.pass && !c.advisory); const advisory = checks.filter(c => !c.pass && c.advisory); validate.requiredFailures = failed; $('#validationSummary').textContent = failed.length ? `${failed.length} required check${failed.length > 1 ? 's' : ''} need attention.` : advisory.length ? `${advisory.length} visual check${advisory.length > 1 ? 's' : ''} still need review.` : 'All required gameplay readability checks pass.'; $('#validationSummary').className = `validation-summary ${failed.length ? 'fail' : advisory.length ? 'review' : 'pass'}`; $('#validationList').innerHTML = checks.map(c => `<li class="${c.pass ? 'pass' : c.advisory ? 'review' : 'fail'}"><span>${c.pass ? '✓' : '!'}</span><div><strong>${c.label}</strong><small>${c.screen}</small></div></li>`).join(''); return !failed.length; }
function renderPreview() { const skin = showingBaseline ? neutral : draft; const root = $('#previewScreen'); root.style.setProperty('--bg', skin.background); root.style.setProperty('--surface', skin.surface); root.style.setProperty('--accent', skin.accent); root.style.setProperty('--secondary', skin.secondary); root.style.setProperty('--text', skin.text); root.style.setProperty('--muted', skin.muted); root.style.setProperty('--seat-opacity', skin.seatOpacity); root.style.setProperty('--seat-blur', skin.seatBlur); root.style.setProperty('--seat-border', skin.seatBorder); root.dataset.art = skin.backgroundTreatment; root.dataset.button = skin.buttonTreatment; root.dataset.seat = skin.seatTreatment; root.dataset.atmosphere = skin.atmosphere; $('#previewRing').textContent = skin.ring === 'none' ? '' : skin.ring === 'orbit' ? '◎' : '◇'; $('#previewRing').dataset.ring = skin.ring; const keys = Object.keys(icons), key = keys[previewModeIndex], values = [40, 16, 3, 2, 7, 4], data = previewState === 'damage' ? [['MIRA', 40], ['JORI', 16], ['BEA', 32], ['NOX', 27]] : [['MIRA', 40], ['JORI', 38], ['BEA', 31], ['NOX', 40]]; $('#previewSeats').innerHTML = data.map(([name, life], i) => `<div class="${i === 0 ? 'active' : ''}"><small>${name}</small><strong>${life}</strong></div>`).join(''); const other = previewState === 'other', offline = previewState === 'offline', damage = previewState === 'damage'; $('#previewOffline').hidden = !offline; $('#previewTurnLabel').textContent = other ? "JORI'S TURN" : 'YOUR TURN'; $('#previewTurnPlayer').textContent = other ? 'JORI' : 'MIRA'; $('#previewMode').textContent = damage ? 'COMMANDER DAMAGE' : labels[key].toUpperCase(); $('#previewCounter output').textContent = damage ? '16' : values[previewModeIndex]; $('#previewEndTurn').textContent = other ? 'Waiting for Jori' : 'End turn → Next player'; $('#previewEndTurn').disabled = other || offline; $('#phonePreview').className = `phone-preview size-${previewSize}`; $('#previewButton').textContent = showingBaseline ? 'Show draft' : 'Show baseline'; $('#compareNote').innerHTML = showingBaseline ? 'Viewing the <strong>Neutral Arc baseline</strong>. Choose “Show draft” to return to your unsaved changes.' : 'Editing against <strong>Neutral Arc</strong>. Preview content is representative only; no table data is connected.'; applyImportedArt(skin); applyAtmosphere(skin); applyButtonControls(skin); renderExactPreview(); }
async function saveDraft(label = 'Saving draft') { const previousStore = clone(store); draft.name = draft.name.trim() || 'Untitled skin'; const i = store.skins.findIndex(s => s.id === selectedId); const savedSkin = { ...clone(draft), id: selectedId, status: draft.status === 'Approved' ? 'Approved' : 'Draft', edited: relativeDate() }; recordSavedSkinVersion(savedSkin, label); store.skins[i] = savedSkin; if (!await saveCatalog({ label })) { store = previousStore; return false; } original = clone(store.skins[i]); saveStore(); renderLibrary(); renderEditor(); setSaveState('Saved draft'); toast('Draft saved to the developer catalog.'); return true; }
async function duplicate() { const previousStore = clone(store), id = `skin-${Date.now()}`; const copy = { ...clone(draft), id, name: `${draft.name || 'Untitled'} copy`, status: 'Draft', edited: relativeDate() }; store.skins.unshift(copy); selectedId = id; store.selected = id; if (!await saveCatalog()) { store = previousStore; selectedId = previousStore.selected || 'neutral'; return; } saveStore(); selectSkin(id); toast('Draft duplicated.'); }
async function publish() { clearPublishFeedback(); if (!validate()) { const reasons = (validate.requiredFailures || []).map(check => check.label).join(' '); showPublishFeedback('Cannot publish this skin yet.', `${reasons} Adjust the colors or treatment, then try Publish again.`); return toast('Publishing is blocked by a required readability check.'); } if (!await saveDraft('Preparing publish')) { showPublishFeedback('Publishing stopped because the draft could not save.', 'The protected catalog did not confirm the draft. Check your connection, then save the draft and try publishing again.'); return; } const skin = store.skins.find(s => s.id === selectedId); if (!skin) { showPublishFeedback('Publishing stopped.', 'The selected draft is no longer available. Select it again and retry.'); return; } const previousStore = clone(store); skin.status = 'Approved'; skin.edited = relativeDate(); recordSavedSkinVersion(skin, 'Published'); draft.status = 'Approved'; if (!await saveCatalog({ label: 'Publishing skin' })) { store = previousStore; showPublishFeedback('Publishing failed.', 'The draft remains unpublished because the protected catalog did not confirm the approval. Check your connection and try publishing again.'); return; } original = clone(skin); saveStore(); renderLibrary(); renderEditor(); setSaveState('Approved'); toast('Skin approved in the developer catalog.'); }
async function applyGameLayout() { if (!validate()) return toast('Resolve required readability checks before applying the layout.'); const button = $('#applyGameLayoutButton'); button.disabled = true; try { const layout = { modeLayouts: clone(draft.modeLayouts || {}) }; const response = await fetch('/api/appearance-studio/game-layout', { method: 'PUT', headers: catalogHeaders, body: JSON.stringify({ layout }) }); if (!response.ok) throw new Error(); toast('This layout is now the standard game layout.'); } catch { toast('Open Appearance Studio from Developer Assets to apply the game layout.'); } finally { button.disabled = false; } }
fields.forEach(key => { const el = $(`#${key === 'name' ? 'skinName' : key}`); el.addEventListener('input', () => { draft[key] = ['atmosphereStrength', 'backgroundScale', 'backgroundPositionX', 'backgroundPositionY', 'seatOpacity', 'seatBlur', 'seatBorder'].includes(key) ? Number(el.value) : el.value; if (key === 'atmosphereStrength') $('#atmosphereStrengthValue').textContent = `${el.value}%`; if (key === 'backgroundScale') $('#backgroundScaleValue').textContent = `${el.value}%`; if (key === 'backgroundPositionX') $('#backgroundPositionXValue').textContent = `${el.value}%`; if (key === 'backgroundPositionY') $('#backgroundPositionYValue').textContent = `${el.value}%`; if (key === 'seatOpacity') $('#seatOpacityValue').textContent = `${el.value}%`; if (key === 'seatBlur') $('#seatBlurValue').textContent = `${el.value}px`; if (key === 'seatBorder') $('#seatBorderValue').textContent = `${el.value}%`; changed(); }); });
$('#skinSearch').addEventListener('input', renderLibrary); $('#newSkinButton').addEventListener('click', () => { const id = `skin-${Date.now()}`; store.skins.unshift({ ...clone(neutral), id, name: 'Untitled skin', status: 'Draft', edited: relativeDate() }); selectedId = id; selectSkin(id); }); $('#saveButton').addEventListener('click', saveDraft); $('#duplicateButton').addEventListener('click', duplicate); $('#publishButton').addEventListener('click', publish); $('#applyGameLayoutButton').addEventListener('click', applyGameLayout); $('#revertButton').addEventListener('click', () => { draft = clone(original); renderEditor(); renderPreview(); validate(); setSaveState('Reverted'); }); $('#previewButton').addEventListener('click', () => { showingBaseline = !showingBaseline; renderPreview(); }); $('#previewEndTurn').addEventListener('click', () => { previewState = 'other'; $$('[data-state]').forEach(x => x.classList.toggle('selected', x.dataset.state === 'other')); renderPreview(); }); $$('.preview-nav button').forEach((button, index) => button.addEventListener('click', () => { previewModeIndex = index; renderPreview(); }));
$$('[data-size]').forEach(b => b.addEventListener('click', () => { previewSize = b.dataset.size; $$('[data-size]').forEach(x => x.classList.toggle('selected', x === b)); renderPreview(); })); $$('[data-state]').forEach(b => b.addEventListener('click', () => { previewState = b.dataset.state; $$('[data-state]').forEach(x => x.classList.toggle('selected', x === b)); renderPreview(); }));
function applyImportedArt(skin) { const background = store.assets.find(asset => asset.id === skin.backgroundAsset); const root = $('#previewScreen'); root.style.backgroundImage = background ? `linear-gradient(rgb(0 0 0 / .32), rgb(0 0 0 / .32)), url("${background.data}")` : ''; root.style.backgroundSize = background ? `${skin.backgroundScale}% auto` : ''; root.style.backgroundPosition = background ? `${skin.backgroundPositionX}% ${skin.backgroundPositionY}%` : ''; const keys = Object.keys(icons); $$('.preview-nav button').forEach((button, index) => { const key = keys[index], asset = store.assets.find(item => item.id === skin.symbolAssets[key]), scale = (Number(skin.symbolScale?.[key]) || 100) / 100; button.classList.toggle('active', index === previewModeIndex); button.innerHTML = asset ? `<img class="preview-symbol-image" src="${asset.data}" alt="" style="transform:scale(${scale})"><small>${escape(labels[key])}</small>` : `<span class="preview-symbol-glyph" style="font-size:${1.05 * scale}rem">${escape(skin.symbols[key])}</span><small>${escape(labels[key])}</small>`; }); }
const importedArtStyle = document.createElement('style'); importedArtStyle.textContent = '.preview-symbol-image{width:22px;height:22px;object-fit:contain}.preview-seats div{border-color:color-mix(in srgb,#5b594f calc(var(--seat-border,70) * 1%),transparent);background:color-mix(in srgb,var(--surface) calc(var(--seat-opacity,100) * 1%),transparent);backdrop-filter:blur(calc(var(--seat-blur,0) * 1px))}.preview-screen[data-seat="glass"] .preview-seats div{background:color-mix(in srgb,var(--surface) calc(var(--seat-opacity,100) * .72%),transparent)}'; document.head.append(importedArtStyle);
$('#backgroundAsset').addEventListener('input', () => { draft.backgroundAsset = $('#backgroundAsset').value; changed(); });
$('#assetFile').addEventListener('change', () => { $('#assetStatus').textContent = ''; });
function readData(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); }); }
async function scaleForStudio(file, placement) { const source = await readData(file); const image = new Image(); image.src = source; await image.decode(); const limit = placement === 'symbol' ? 256 : 1280, ratio = Math.min(1, limit / Math.max(image.naturalWidth, image.naturalHeight)); const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio)); canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio)); canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height); for (let quality = .88; quality >= .4; quality -= .08) { const data = canvas.toDataURL('image/webp', quality); if (data.length * .75 <= 700000) return { data, resized: canvas.width !== image.naturalWidth || canvas.height !== image.naturalHeight }; } throw new Error('This image could not be reduced below the local-library limit.'); }
window.addEventListener('message', event => { if (event.origin !== location.origin || event.data?.type !== 'fivefold-arc:appearance-studio-key') return; developerKey = String(event.data.key || ''); void loadCatalog(); });
async function loadCatalog() { try { const response = await fetch('/api/appearance-studio/catalog', { headers: { 'x-feedback-portal-key': developerKey } }); if (response.ok) { const remote = (await response.json()).catalog; if (remote?.skins?.length) { remote.assets = await Promise.all((remote.assets || []).map(loadAssetData)); store = remote; if (!store.skins.some(skin => skin.id === 'neutral')) store.skins.unshift(neutral); selectedId = store.selected || 'neutral'; selectSkin(selectedId); } } } catch { /* direct file use keeps the optional browser cache */ } }
store.skins.forEach(normalizeSkin);
selectSkin(selectedId);
if (developerKey) void loadCatalog();
$('#restoreCatalogButton').addEventListener('click', async () => { const status = $('#catalogRestoreStatus'); try { const restored = await readCatalogBackupFile(); inspectCatalogBackup(restored); if (!confirm('Restore this backup? It replaces the current protected catalog.')) return; const previousStore = clone(store), previousSelected = selectedId; store = { schemaVersion: APPEARANCE_CATALOG_SCHEMA_VERSION, skins: restored.skins, assets: restored.assets.map(asset => ({ ...asset, pendingUpload: Boolean(asset.data) })), selected: restored.selected || 'neutral', gameDefaultLayout: restored.gameDefaultLayout || null }; if (!store.skins.some(skin => skin.id === 'neutral')) store.skins.unshift(clone(neutral)); selectedId = store.skins.some(skin => skin.id === store.selected) ? store.selected : 'neutral'; if (!await saveCatalog({ label: 'Restoring catalog' })) { store = previousStore; selectedId = previousSelected; return; } selectSkin(selectedId); status.textContent = `Restored ${store.skins.length - 1} saved skin${store.skins.length === 2 ? '' : 's'} and ${store.assets.length} image${store.assets.length === 1 ? '' : 's'}.`; toast('Protected Studio catalog restored.'); } catch (error) { status.textContent = error.message || 'This catalog backup could not be restored.'; } });
$('#importAssetButton').addEventListener('click', async () => { const file = $('#assetFile').files[0], name = $('#assetName').value.trim(), source = $('#assetSource').value.trim(), placement = $('#assetPlacement').value, status = $('#assetStatus'); if (!file || !name || !source) { status.textContent = 'Choose an image and provide both its name and rights/source note.'; return; } if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.type) || file.size > 20000000) { status.textContent = 'Use a PNG, JPEG, WebP, or SVG up to 20 MB. Larger images can exhaust phone memory before they can be optimized.'; return; } try { status.textContent = 'Optimizing image for the server catalog…'; const result = file.size > 700000 || file.type === 'image/svg+xml' ? await scaleForStudio(file, placement) : { data: await readData(file), resized: false }; store.assets.unshift({ id: `asset-${Date.now()}`, name, source, placement, data: result.data, pendingUpload: true }); if (!await saveCatalog({ label: 'Importing artwork' })) { store.assets.shift(); return; } $('#assetFile').value = ''; $('#assetName').value = ''; $('#assetSource').value = ''; status.textContent = `${name} imported to the server catalog${result.resized ? ' and scaled to fit' : ''}.`; renderEditor(); renderPreview(); } catch (error) { status.textContent = error.message || 'This image could not be prepared for the server catalog.'; } });
const studioScaleStyle = document.createElement('style'); studioScaleStyle.textContent = '.symbol-controls .symbol-control{display:grid!important;grid-template-columns:minmax(0,1fr) 76px 112px;gap:8px;align-items:center}.symbol-controls .symbol-control>span{grid-column:1/2}.symbol-controls .symbol-control input[type=range]{grid-column:1/-1;width:100%;margin:3px 0 0}.symbol-controls .symbol-control>small:last-child{grid-column:1/-1;color:#d8b36b}.preview-symbol-image{transition:transform .12s ease}'; document.head.append(studioScaleStyle);
const atmosphereStyle = document.createElement('style'); atmosphereStyle.textContent = '.atmosphere-controls{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}.atmosphere-controls label{margin-top:0!important;font-size:.68rem!important}.atmosphere-controls input[type=color]{height:38px;min-height:38px;margin-top:4px;padding:3px}.atmosphere-controls select{margin-top:4px}.atmosphere-controls .atmosphere-strength{grid-column:1/-1}.atmosphere-strength output{float:right;color:#d8b36b}.atmosphere-strength input{width:100%;min-height:auto;margin:7px 0 0;padding:0}.preview-screen:before,.preview-screen:after{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none}.preview-screen:before{background:radial-gradient(circle at var(--atmosphere-position),color-mix(in srgb,var(--atmosphere) calc(var(--atmosphere-strength) * 100%),transparent),transparent 58%)}.preview-screen[data-atmosphere=light]:after{background:#fff;opacity:.08}.preview-screen[data-atmosphere=custom]:after{background:linear-gradient(180deg,color-mix(in srgb,var(--atmosphere) calc(var(--atmosphere-strength) * 55%),transparent),transparent 48%)}.preview-screen[data-art=rays]:after,.preview-screen[data-art=grain]:after,.preview-screen[data-art=mist]:after,.preview-screen[data-art=stars]:after{opacity:.18}.preview-screen[data-art=rays]:after{background:repeating-conic-gradient(from 0deg at 50% 35%,transparent 0 12deg,var(--accent) 13deg 14deg,transparent 15deg 28deg)}.preview-screen[data-art=grain]:after{background:repeating-linear-gradient(70deg,transparent 0 3px,#fff 4px 5px)}.preview-screen[data-art=mist]:after{background:radial-gradient(ellipse at 10% 18%,#fff8,transparent 32%),radial-gradient(ellipse at 88% 66%,var(--atmosphere),transparent 42%);filter:blur(18px)}.preview-screen[data-art=stars]:after{background-image:radial-gradient(circle,#fff 0 1px,transparent 1.5px),radial-gradient(circle,var(--accent) 0 1px,transparent 1.5px);background-position:0 0,17px 23px;background-size:31px 37px,43px 47px}'; document.head.append(atmosphereStyle);
function applyAtmosphere(skin) { const root = $('#previewScreen'); root.style.setProperty('--atmosphere', skin.atmosphereColor); root.style.setProperty('--atmosphere-strength', `${skin.atmosphereStrength / 100}`); root.style.setProperty('--atmosphere-position', skin.atmospherePosition === 'bottom' ? '50% 100%' : skin.atmospherePosition === 'center' ? '50% 50%' : '50% 0%'); }
const atmosphereLayerStyle = document.createElement('style'); atmosphereLayerStyle.textContent = '.preview-screen[data-art]:before{background:radial-gradient(circle at var(--atmosphere-position),color-mix(in srgb,var(--atmosphere) calc(var(--atmosphere-strength) * 100%),transparent),transparent 58%)}'; document.head.append(atmosphereLayerStyle);
const exactPreviewStyle = document.createElement('style'); exactPreviewStyle.textContent = '.preview-stage>.phone-preview{display:none}.exact-preview{box-sizing:content-box;display:block;overflow:hidden;border:8px solid #090a0a;border-radius:34px;background:#090a0a;box-shadow:0 20px 70px #0008;pointer-events:none}.exact-preview.size-phone{width:393px;height:852px}.exact-preview.size-compact{width:320px;height:700px}.exact-preview.size-desktop{width:min(740px,100%);height:760px;border-radius:18px}@media(max-width:720px){.exact-preview.size-phone{width:min(393px,100%);height:min(852px,calc(100vh - 170px))}.exact-preview.size-compact{height:700px}.exact-preview.size-desktop{height:600px}}'; document.head.append(exactPreviewStyle);
const preflightSizes = [{ id: 'phone', label: '393 × 852' }, { id: 'compact', label: '320 × 700' }];
const preflightPlayers = [4, 6, 8];
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const preflightPanel = document.createElement('section'); preflightPanel.className = 'preflight-panel'; preflightPanel.innerHTML = '<p class="kicker">LOCAL PREFLIGHT</p><h2>Draft readiness</h2><p class="helper">Checks the exact app preview at both supported phone sizes, 4/6/8-player tables, and every counter mode. It never saves or publishes your draft.</p><button id="runPreflightButton" class="secondary-action" type="button">Run preflight</button><p id="preflightSummary" class="preflight-summary" aria-live="polite">Not run for this draft.</p><ul id="preflightList" class="preflight-list" hidden></ul>'; $('.validation-panel').insertBefore(preflightPanel, $('.validation-panel').children[1]);
function preflightLabel({ size, players, mode }) { return `${size.label} · ${players} players · ${labels[mode]}`; }
function renderPreflight(results, extraChecks) { const checks = [...extraChecks, ...results], failed = checks.filter(check => !check.pass), screens = results.filter(check => check.pass), summary = $('#preflightSummary'), list = $('#preflightList'); summary.textContent = failed.length ? `${failed.length} of ${checks.length} local checks need attention. Review the listed exact-app screens before saving this draft.` : `${screens.length} exact-app screens and ${extraChecks.length} draft checks passed locally. Real-device touch and table-distance review still need a playtest.`; summary.className = `preflight-summary ${failed.length ? 'fail' : 'pass'}`; list.hidden = false; list.innerHTML = checks.map(check => `<li class="${check.pass ? 'pass' : 'fail'}"><span>${check.pass ? '✓' : '!'}</span><div><strong>${check.label}</strong><small>${check.detail}</small></div></li>`).join(''); }
async function runPreflight() { const button = $('#runPreflightButton'), frame = $('#exactPreview'); if (button.disabled) return; button.disabled = true; button.textContent = 'Running…'; $('#preflightSummary').textContent = 'Checking the exact app preview…'; $('#preflightSummary').className = 'preflight-summary review'; $('#preflightList').hidden = true; const remembered = { previewSize, previewPlayers, previewMode, previewModeIndex, previewState, showingBaseline }, skin = clone(draft), extraChecks = Object.entries(icons).map(([mode]) => { const scale = Number(skin.symbolScale?.[mode] || 100); return { label: `${labels[mode]} icon scale is within 60–200%`, pass: scale >= 60 && scale <= 200, detail: `${scale}% selected for this draft` }; }), results = []; try { for (const size of preflightSizes) for (const players of preflightPlayers) for (const mode of Object.keys(icons)) { previewSize = size.id; previewPlayers = players; previewMode = mode; previewModeIndex = Object.keys(icons).indexOf(mode); previewState = 'turn'; showingBaseline = false; renderPreview(); await nextFrame(); const root = frame.contentDocument?.documentElement, hasViewport = Boolean(root?.clientWidth && root?.clientHeight), fits = hasViewport && root.scrollWidth <= root.clientWidth && root.scrollHeight <= root.clientHeight; results.push({ label: preflightLabel({ size, players, mode }), pass: fits, detail: fits ? 'Exact app rendered without document overflow' : 'Exact app did not fit this preview; inspect this configuration' }); } } catch { results.push({ label: 'Exact app preview connection', pass: false, detail: 'The local exact preview could not be checked. Reload Studio and try again.' }); } finally { previewSize = remembered.previewSize; previewPlayers = remembered.previewPlayers; previewMode = remembered.previewMode; previewModeIndex = remembered.previewModeIndex; previewState = remembered.previewState; showingBaseline = remembered.showingBaseline; renderPreview(); button.disabled = false; button.textContent = 'Run preflight'; renderPreflight(results, extraChecks); } }
function renderExactPreview() { const skin = showingBaseline ? neutral : draft, frame = $('#exactPreview'); frame.className = `exact-preview size-${previewSize}`; frame.contentWindow?.postMessage({ type: 'fivefold-arc:appearance-skin', skin: { ...skin, previewState, previewMode, previewPlayers, backgroundData: store.assets.find(asset => asset.id === skin.backgroundAsset)?.data || '', sealData: store.assets.find(asset => asset.id === skin.sealAsset)?.data || '', symbolData: Object.fromEntries(Object.keys(icons).map(key => [key, store.assets.find(asset => asset.id === skin.symbolAssets?.[key])?.data || ''])) } }, location.origin); }
const podPreviewControl = document.createElement('div'); podPreviewControl.className = 'segmented'; podPreviewControl.setAttribute('role', 'group'); podPreviewControl.setAttribute('aria-label', 'Preview pod size'); podPreviewControl.innerHTML = '<button data-preview-players="4" class="selected" type="button">4 players</button><button data-preview-players="6" type="button">6 players</button><button data-preview-players="8" type="button">8 players</button>'; $('.preview-toolbar').append(podPreviewControl); $$('[data-preview-players]').forEach(button => button.addEventListener('click', () => { previewPlayers = Number(button.dataset.previewPlayers); $$('[data-preview-players]').forEach(item => item.classList.toggle('selected', item === button)); renderPreview(); }));
const modePreviewControl = document.createElement('div'); modePreviewControl.className = 'segmented'; modePreviewControl.setAttribute('role', 'group'); modePreviewControl.setAttribute('aria-label', 'Preview counter mode'); modePreviewControl.innerHTML = Object.entries(labels).map(([mode, label]) => `<button data-preview-mode="${mode}" class="${mode === previewMode ? 'selected' : ''}" type="button">${label}</button>`).join(''); $('.preview-toolbar').append(modePreviewControl); $$('[data-preview-mode]').forEach(button => button.addEventListener('click', () => { previewMode = button.dataset.previewMode; previewModeIndex = Object.keys(icons).indexOf(previewMode); $$('[data-preview-mode]').forEach(item => item.classList.toggle('selected', item === button)); renderPreview(); }));
$('#exactPreview').addEventListener('load', renderExactPreview); $('#runPreflightButton').addEventListener('click', runPreflight); renderPreview();
const exactPreviewPlacementStyle = document.createElement('style'); exactPreviewPlacementStyle.textContent = '.preview-area{display:flex;flex-direction:column;align-items:center}.preview-toolbar,.compare-note{width:100%;flex:none}.preview-stage{display:contents}.exact-preview{flex:none;margin:16px 0}'; document.head.append(exactPreviewPlacementStyle);
const exactPreviewFallbackStyle = document.createElement('style'); exactPreviewFallbackStyle.textContent = 'body[data-preview-fallback="true"] .device-preview-panel{display:none}.exact-preview-recovery{width:min(100%,560px);margin:18px auto;padding:22px;border:1px solid #d8b36b;border-radius:12px;background:#1d1b15;color:#f3eee3;text-align:center;box-shadow:0 14px 40px #0007}.exact-preview-recovery h2{margin:0;color:#f0ca80}.exact-preview-recovery p{margin:10px auto;max-width:48ch;color:#d1cbbd;line-height:1.45}.exact-preview-recovery button{min-height:40px;padding:8px 12px;border:1px solid #d4ad65;border-radius:5px;background:#d4ad65;color:#201a0f;font-weight:800}.exact-preview-recovery>div{display:grid;justify-items:center;gap:8px;margin-top:12px}.exact-preview-recovery img{width:180px;height:180px;padding:8px;border-radius:6px;background:#fff}.exact-preview-recovery input{width:min(100%,420px);min-height:34px;padding:5px 7px;border:1px solid #41423f;border-radius:5px;background:#121310;color:#f4ecd9;font-size:.65rem}'; document.head.append(exactPreviewFallbackStyle);
const backgroundArtControlsStyle = document.createElement('style'); backgroundArtControlsStyle.textContent = '.background-art-controls{display:grid;gap:8px;margin-top:10px}.background-art-controls label{display:grid!important;grid-template-columns:1fr auto;gap:5px;margin:0!important;font-size:.68rem!important}.background-art-controls output{color:#d8b36b}.background-art-controls input{grid-column:1/-1;width:100%;min-height:auto;margin:0;padding:0}'; document.head.append(backgroundArtControlsStyle);
const buttonControlsStyle = document.createElement('style'); buttonControlsStyle.textContent = '.preview-end-turn{border-color:color-mix(in srgb,var(--accent) calc(var(--button-border,70) * 1%),transparent);background:color-mix(in srgb,var(--accent) calc(var(--button-opacity,100) * 1%),transparent);backdrop-filter:blur(calc(var(--button-blur,0) * 1px))}.preview-adjust button{border-color:color-mix(in srgb,#58574f calc(var(--life-button-border,70) * 1%),transparent);background:color-mix(in srgb,var(--surface) calc(var(--life-button-opacity,100) * 1%),transparent);backdrop-filter:blur(calc(var(--life-button-blur,0) * 1px))}'; document.head.append(buttonControlsStyle);
function applyButtonControls(skin) { const root = $('#previewScreen'); ['button','lifeButton','customLife','commanderTax'].forEach(prefix => { const css = prefix.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`); root.style.setProperty(`--${css}-opacity`, skin[`${prefix}Opacity`]); root.style.setProperty(`--${css}-blur`, skin[`${prefix}Blur`]); root.style.setProperty(`--${css}-border`, skin[`${prefix}Border`]); }); }
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
$('#assetPlacement').insertAdjacentHTML('beforeend', '<option value="overlay">Transparent overlay</option>');
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
  function normalizeUxSkin(skin) { if (!skin) return; Object.entries(uxDefaults).forEach(([key, value]) => { if (skin[key] == null) skin[key] = clone(value); }); skin.interfaceStyle = skin.interfaceStyle === 'dial' ? 'dial' : 'button'; skin.fontFamily = ['system','serif','rounded','mono'].includes(skin.fontFamily) ? skin.fontFamily : 'system'; skin.modeLayouts ||= {}; ['button','dial'].forEach(mode => { skin.modeLayouts[mode] ||= Object.fromEntries(modeLayoutKeys.map(key => [key, clone(skin[key])])) ; const layout = skin.modeLayouts[mode]; layout.labelTextScale = Math.min(115, Math.max(85, Number(layout.labelTextScale) || 100)); layout.seatTextScale = Math.min(115, Math.max(85, Number(layout.seatTextScale) || 100)); layout.seatRadius = Math.min(24, Math.max(0, Number(layout.seatRadius) || 8)); layout.buttonRadius = Math.min(24, Math.max(0, Number(layout.buttonRadius) || 8)); layout.counterOffsetY = Math.min(18, Math.max(-18, Number(layout.counterOffsetY) || 0)); layout.turnOffsetY = Math.min(12, Math.max(-12, Number(layout.turnOffsetY) || 0)); layout.controlsOffsetY = Math.min(12, Math.max(-12, Number(layout.controlsOffsetY) || 0)); layout.centerSealScale = Math.min(150, Math.max(60, Number(layout.centerSealScale) || 100)); layout.centerSealOffsetX = Math.min(18, Math.max(-18, Number(layout.centerSealOffsetX) || 0)); layout.centerSealOffsetY = Math.min(18, Math.max(-18, Number(layout.centerSealOffsetY) || 0)); layout.lifeNumberScale = Math.min(140, Math.max(75, Number(layout.lifeNumberScale) || 100)); layout.lifeNumberOffsetX = Math.min(14, Math.max(-14, Number(layout.lifeNumberOffsetX) || 0)); layout.lifeNumberOffsetY = Math.min(14, Math.max(-14, Number(layout.lifeNumberOffsetY) || 0)); layout.dialArtSpin = Boolean(layout.dialArtSpin); layout.componentLayout ||= layoutRegionDefault(); Object.keys(layoutRegions).forEach(region => { const placement = layout.componentLayout[region] ||= { x: 0, y: 0, scale: 100 }; placement.x = Math.min(32, Math.max(-32, Number(placement.x) || 0)); placement.y = Math.min(36, Math.max(-36, Number(placement.y) || 0)); placement.scale = Math.min(115, Math.max(85, Number(placement.scale) || 100)); }); layout.overlays ||= {}; layout.overlayOpacity ||= {}; layout.overlayScale ||= {}; layout.overlayBlend ||= {}; ['seat','counter','dial'].forEach(slot => { layout.overlays[slot] ||= ''; layout.overlayOpacity[slot] = Math.min(70, Math.max(0, Number(layout.overlayOpacity[slot]) || 0)); layout.overlayScale[slot] = Math.min(160, Math.max(50, Number(layout.overlayScale[slot]) || 100)); layout.overlayBlend[slot] ||= 'normal'; }); }); }
const normalizeUxSkinWithFixedDialArt = normalizeUxSkin;
normalizeUxSkin = function(skin) { normalizeUxSkinWithFixedDialArt(skin); Object.values(skin?.modeLayouts || {}).forEach(layout => { layout.dialArtSpin = true; }); };
function activeModeLayout(skin = draft) { normalizeUxSkin(skin); return skin.modeLayouts[skin.interfaceStyle === 'dial' ? 'dial' : 'button']; }
function overlayOptions(value) { return `<option value="">No overlay</option>${store.assets.filter(asset => asset.placement !== 'symbol').map(asset => `<option value="${asset.id}" ${asset.id === value ? 'selected' : ''}>${escape(asset.name)}</option>`).join('')}`; }
  function renderUxStudio() { normalizeUxSkin(draft); const layout = activeModeLayout(); ['interfaceStyle','fontFamily',...uxNumeric].forEach(key => { const field = $(`#${key}`); if (field) field.value = ['interfaceStyle','fontFamily'].includes(key) ? draft[key] : layout[key]; const output = $(`#${key}Value`); if (output) output.textContent = key.endsWith('Scale') ? `${layout[key]}%` : `${layout[key]}px`; }); const placementPanel = $('#componentPlacementControls'); if (placementPanel) { placementPanel.innerHTML = `<p class="placement-intro">Supported regions use small visual offsets and safe size bounds. Player order, counter values, turn controls, and navigation stay locked so they cannot be hidden, reordered, or made unreachable.</p>${Object.entries(layoutRegions).map(([key, name]) => { const value = layout.componentLayout[key]; return `<details class="component-placement"><summary>${name}</summary><div class="placement-fields"><label>Left / right <output>${value.x}px</output><input data-placement="${key}" data-placement-field="x" type="range" min="-32" max="32" step="2" value="${value.x}"></label><label>Up / down <output>${value.y}px</output><input data-placement="${key}" data-placement-field="y" type="range" min="-36" max="36" step="2" value="${value.y}"></label><label>Size <output>${value.scale}%</output><input data-placement="${key}" data-placement-field="scale" type="range" min="85" max="115" step="2" value="${value.scale}"></label><button type="button" data-placement-reset="${key}">Reset ${name}</button></div></details>`; }).join('')}`; makeAccordion(Array.from(placementPanel.querySelectorAll('.component-placement'))); $$('[data-placement]').forEach(el => el.addEventListener('input', () => { const placement = activeModeLayout().componentLayout[el.dataset.placement]; placement[el.dataset.placementField] = Number(el.value); el.previousElementSibling.textContent = `${el.value}${el.dataset.placementField === 'scale' ? '%' : 'px'}`; changed(); })); $$('[data-placement-reset]').forEach(button => button.addEventListener('click', () => { activeModeLayout().componentLayout[button.dataset.placementReset] = { x: 0, y: 0, scale: 100 }; renderUxStudio(); changed(); })); } $('#overlayControls').innerHTML = ['seat','counter','dial'].map(slot => `<div class="overlay-control"><strong>${slot === 'seat' ? 'Player cards' : slot === 'counter' ? 'Counter stage' : 'Dial surface'}</strong><select data-overlay="${slot}">${overlayOptions(layout.overlays[slot])}</select><label>Opacity <output>${layout.overlayOpacity[slot]}%</output><input data-overlay-opacity="${slot}" type="range" min="0" max="70" step="5" value="${layout.overlayOpacity[slot]}"></label><label>Scale <output>${layout.overlayScale[slot]}%</output><input data-overlay-scale="${slot}" type="range" min="50" max="160" step="5" value="${layout.overlayScale[slot]}"></label><label>Blend<select data-overlay-blend="${slot}"><option value="normal">Normal</option><option value="screen">Screen</option><option value="multiply">Multiply</option><option value="overlay">Overlay</option></select></label>${slot === 'dial' ? `<label class="overlay-toggle"><input data-dial-art-spin type="checkbox" ${layout.dialArtSpin ? 'checked' : ''}> Spin this art with the dial</label>` : ''}</div>`).join(''); $$('[data-overlay]').forEach(el => el.addEventListener('input', () => { activeModeLayout().overlays[el.dataset.overlay] = el.value; changed(); })); $$('[data-overlay-opacity]').forEach(el => el.addEventListener('input', () => { const slot = el.dataset.overlayOpacity; activeModeLayout().overlayOpacity[slot] = Number(el.value); el.previousElementSibling.textContent = `${el.value}%`; changed(); })); $$('[data-overlay-scale]').forEach(el => el.addEventListener('input', () => { const slot = el.dataset.overlayScale; activeModeLayout().overlayScale[slot] = Number(el.value); el.previousElementSibling.textContent = `${el.value}%`; changed(); })); $$('[data-overlay-blend]').forEach(el => { el.value = activeModeLayout().overlayBlend[el.dataset.overlayBlend]; el.addEventListener('input', () => { activeModeLayout().overlayBlend[el.dataset.overlayBlend] = el.value; changed(); }); }); $('[data-dial-art-spin]')?.addEventListener('input', event => { activeModeLayout().dialArtSpin = event.target.checked; changed(); }); }
const renderEditorBase = renderEditor; renderEditor = function() { renderEditorBase(); renderUxStudio(); };
const clearAssetReferenceBase = clearAssetReference; clearAssetReference = function(skin, id) { clearAssetReferenceBase(skin, id); if (skin?.overlays) Object.keys(skin.overlays).forEach(slot => { if (skin.overlays[slot] === id) skin.overlays[slot] = ''; }); };
const renderPreviewBase = renderPreview; renderPreview = function() { normalizeUxSkin(draft); renderPreviewBase(); };
['interfaceStyle','fontFamily',...uxNumeric].forEach(key => $(`#${key}`).addEventListener('input', event => { if (uxNumeric.includes(key)) activeModeLayout()[key] = Number(event.target.value); else draft[key] = event.target.value; const output = $(`#${key}Value`); if (output) output.textContent = key.endsWith('Scale') ? `${event.target.value}%` : `${event.target.value}px`; if (key === 'interfaceStyle') renderUxStudio(); changed(); }));
const renderExactPreviewBase = renderExactPreview; renderExactPreview = function() { renderExactPreviewBase(); const skin = showingBaseline ? neutral : draft, asset = id => store.assets.find(item => item.id === id)?.data || '', overlayData = Object.fromEntries(Object.entries(skin.overlays || {}).map(([slot, id]) => [slot, asset(id)])); $('#exactPreview').contentWindow?.postMessage({ type: 'fivefold-arc:appearance-skin', skin: { ...skin, previewState, previewMode, previewPlayers, backgroundData: asset(skin.backgroundAsset), sealData: asset(skin.sealAsset), symbolData: Object.fromEntries(Object.keys(icons).map(key => [key, asset(skin.symbolAssets?.[key])])), overlayData } }, location.origin); };
store.skins.forEach(normalizeUxSkin); normalizeUxSkin(neutral); normalizeUxSkin(draft); renderEditor(); renderPreview();
const uxStudioStyle = document.createElement('style'); uxStudioStyle.textContent = '.ux-studio-panel h3{margin:20px 0 4px;color:#e1b96c;font-size:.88rem}.ux-grid,.overlay-controls{display:grid;gap:10px;margin-top:12px}.ux-grid{grid-template-columns:1fr 1fr}.ux-grid label,.overlay-control label,.placement-fields label{display:grid!important;grid-template-columns:1fr auto;gap:5px;margin:0!important;font-size:.68rem!important}.ux-grid input,.overlay-control input,.placement-fields input{grid-column:1/-1;width:100%;min-height:auto!important;margin:0!important;padding:0!important}.ux-grid output,.overlay-control output,.placement-fields output{color:#d8b36b}.overlay-control,.component-placement{display:grid;gap:7px;padding:10px;border:1px solid #353633;background:#1b1c1a}.overlay-control strong{font-size:.76rem}.overlay-control select{width:100%;min-height:38px;margin:0!important}.placement-intro{margin:8px 0 10px;font-size:.7rem;line-height:1.4;color:var(--muted)}.component-placement{margin:8px 0}.component-placement summary{cursor:pointer;color:#e1b96c;font-size:.76rem;font-weight:800}.placement-fields{display:grid;gap:8px;margin-top:10px}.placement-fields button{justify-self:start;min-height:32px;padding:5px 8px;font-size:.68rem}'; document.head.append(uxStudioStyle);

const fixedDialArtStudioStyle = document.createElement('style'); fixedDialArtStudioStyle.textContent = '#overlayControls .overlay-toggle{display:none}'; document.head.append(fixedDialArtStudioStyle);
// A device shell is only a measuring/frame layer. The iframe remains the exact
// app preview and receives the very same skin message as the primary preview.
const buildDevicePreviewSkin = () => {
  const skin = showingBaseline ? neutral : draft;
  const asset = id => store.assets.find(item => item.id === id)?.data || '';
  const layout = activeModeLayout(skin);
  return { ...skin, ...layout, useGameBase: showingBaseline || skin.id === 'neutral', previewState, previewMode, previewPlayers, backgroundData: asset(skin.backgroundAsset), sealData: asset(skin.sealAsset), symbolData: Object.fromEntries(Object.keys(icons).map(key => [key, asset(skin.symbolAssets?.[key])])), overlayData: Object.fromEntries(Object.entries(layout.overlays || {}).map(([slot, id]) => [slot, asset(id)])) };
};
exactPreviewFallbackTimer = window.setTimeout(showExactPreviewRecovery, 2200);
const devicePreview = mountDevicePreview({ primaryFrame: $('#exactPreview'), getSkin: buildDevicePreviewSkin });
const phoneLayoutControl = document.createElement('section'); phoneLayoutControl.className = 'phone-layout-control'; phoneLayoutControl.innerHTML = '<strong>Exact preview</strong><p>Use the browser preview for fast placement edits. The phone link is for final device verification.</p><button type="button" id="openBrowserExactPreview">Open fast browser preview</button><button type="button" id="openPhoneLayoutEditor">Create phone link</button><div id="phoneLayoutLink" hidden></div>'; $('#uxStudioPanel').insertBefore(phoneLayoutControl, $('#uxStudioPanel').querySelector('details:last-child'));
let phoneLayoutSession = null, phoneLayoutUpdatedAt = 0, applyingPhoneLayout = false, phoneLayoutChannel = null;
function connectPhoneLayoutChannel(sessionId) { phoneLayoutChannel?.close(); phoneLayoutChannel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(`fivefold-arc:phone-layout:${sessionId}`) : null; }
async function createPhoneLayoutSession({ linkTarget = '#phoneLayoutLink', button = $('#openPhoneLayoutEditor'), openInBrowser = false } = {}) { const previewWindow = openInBrowser ? window.open('about:blank', 'fivefold-arc-exact-preview') : null; button.disabled = true; button.textContent = 'Creating…'; try { const response = await fetch('/api/appearance-studio/phone-layout', { method: 'POST', headers: catalogHeaders, body: JSON.stringify({ skin: buildDevicePreviewSkin() }) }); if (!response.ok) throw new Error('Open Appearance Studio from Developer Assets before creating a phone link.'); const session = await response.json(); phoneLayoutSession = session.id; phoneLayoutUpdatedAt = 0; connectPhoneLayoutChannel(session.id); const qrResponse = await fetch(`/api/appearance-studio/phone-layout/${session.id}/qr`); if (!qrResponse.ok) throw new Error('Could not prepare the phone QR code.'); const qr = await qrResponse.json(); if (previewWindow) previewWindow.location.replace(qr.url); const target = $(linkTarget) || $('#phoneLayoutLink'); target.hidden = false; target.innerHTML = `<strong>Open the exact live preview</strong><img src="${qr.data}" alt="QR code for the exact Phone Layout Preview"><label>Backup link<input readonly value="${qr.url}" aria-label="Exact Phone Layout Preview link"></label><a href="${qr.url}" target="fivefold-arc-exact-preview" rel="noopener">Open exact preview</a><button type="button" data-copy-phone-layout-link>Copy link</button><small>This temporary link controls only this Studio draft.</small>`; target.querySelector('[data-copy-phone-layout-link]').addEventListener('click', async () => { await navigator.clipboard?.writeText(qr.url); toast('Exact Phone Layout Preview link copied.'); }); button.textContent = openInBrowser ? 'Open fast browser preview' : 'New phone QR code'; toast(openInBrowser ? 'Fast exact browser preview ready.' : 'Exact Phone Layout Preview ready.'); } catch (error) { previewWindow?.close(); toast(error.message || 'Could not create an exact phone preview.'); button.textContent = openInBrowser ? 'Open fast browser preview' : 'Create phone link'; } finally { button.disabled = false; } }
const exactPreviewRecovery = document.createElement('section'); exactPreviewRecovery.id = 'exactPreviewRecovery'; exactPreviewRecovery.className = 'exact-preview-recovery'; exactPreviewRecovery.hidden = true; exactPreviewRecovery.innerHTML = '<h2>Use the exact browser preview</h2><p>This embedded browser cannot load the live game inside Studio. Open the actual renderer in a separate browser tab for instant placement feedback; use the QR link for a final phone check.</p><button type="button" id="openExactPreviewButton">Open fast browser preview</button><div id="exactPreviewRecoveryLink" hidden></div>'; $('.preview-area').insertBefore(exactPreviewRecovery, $('#compareNote'));
async function syncPhoneLayoutSession() { if (!phoneLayoutSession || document.hidden) return; try { const response = await fetch(`/api/appearance-studio/phone-layout/${phoneLayoutSession}`); if (!response.ok) return; const session = await response.json(); if (!session.updatedAt || session.updatedAt <= phoneLayoutUpdatedAt) return; phoneLayoutUpdatedAt = session.updatedAt; if (session.skin?.modeLayouts) { applyingPhoneLayout = true; draft = { ...draft, ...session.skin }; normalizeUxSkin(draft); renderEditor(); changed(); applyingPhoneLayout = false; } } catch { applyingPhoneLayout = false; } }
async function publishPhoneLayoutSession() { if (!phoneLayoutSession || applyingPhoneLayout) return; const skin = buildDevicePreviewSkin(); phoneLayoutChannel?.postMessage({ type: 'fivefold-arc:phone-layout-sync', skin }); try { const response = await fetch(`/api/appearance-studio/phone-layout/${phoneLayoutSession}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ skin }) }); if (response.ok) phoneLayoutUpdatedAt = (await response.json()).updatedAt || phoneLayoutUpdatedAt; } catch {} }
const changedBeforePhoneLayout = changed; changed = function() { changedBeforePhoneLayout(); void publishPhoneLayoutSession(); };
$('#openPhoneLayoutEditor').addEventListener('click', () => createPhoneLayoutSession()); $('#openBrowserExactPreview').addEventListener('click', () => createPhoneLayoutSession({ button: $('#openBrowserExactPreview'), openInBrowser: true })); $('#openExactPreviewButton').addEventListener('click', () => createPhoneLayoutSession({ linkTarget: '#exactPreviewRecoveryLink', button: $('#openExactPreviewButton'), openInBrowser: true })); setInterval(syncPhoneLayoutSession, 1200);
const renderExactPreviewWithDevice = renderExactPreview;
renderExactPreview = function() { renderExactPreviewWithDevice(); const exactSkin = buildDevicePreviewSkin(); $('#exactPreview').contentWindow?.postMessage({ type: 'fivefold-arc:appearance-skin', skin: exactSkin }, location.origin); devicePreview.sync(); };
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
  draftHistory = draft ? [clone(draft)] : [];
  draftHistoryIndex = draftHistory.length - 1;
  updateDraftHistoryControls();
}
function recordDraftHistory() {
  if (restoringDraftHistory || !draft) return;
  const snapshot = clone(draft), current = draftHistory[draftHistoryIndex];
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
  draft = clone(draftHistory[index]);
  normalizeSkin(draft); normalizeUxSkin(draft);
  renderEditor(); renderPreview(); validate();
  setSaveState('Unsaved');
  restoringDraftHistory = false;
  updateDraftHistoryControls();
}
const changedWithHistory = changed;
changed = function() { changedWithHistory(); recordDraftHistory(); };
const selectSkinWithHistory = selectSkin;
selectSkin = function(id) { selectSkinWithHistory(id); resetDraftHistory(); };
$('#undoButton').addEventListener('click', () => restoreDraftHistory(draftHistoryIndex - 1));
$('#redoButton').addEventListener('click', () => restoreDraftHistory(draftHistoryIndex + 1));
document.addEventListener('keydown', event => {
  if (!event.ctrlKey && !event.metaKey) return;
  if (event.key.toLowerCase() === 'z' && !event.shiftKey) { event.preventDefault(); restoreDraftHistory(draftHistoryIndex - 1); }
  if (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey)) { event.preventDefault(); restoreDraftHistory(draftHistoryIndex + 1); }
});

function catalogBackup() {
  return { schemaVersion: APPEARANCE_CATALOG_SCHEMA_VERSION, exportedAt: new Date().toISOString(), skins: clone(store.skins), assets: clone(store.assets), selected: selectedId, gameDefaultLayout: clone(store.gameDefaultLayout || null) };
}
function inspectCatalogBackup(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('That file is not an Appearance Studio catalog.');
  if (!Array.isArray(value.skins) || !Array.isArray(value.assets)) throw new Error('A catalog needs both skins and assets arrays.');
  if (value.skins.length > 100 || value.assets.length > 250) throw new Error('This catalog exceeds the Studio safety limits.');
  const ids = new Set();
  for (const skin of value.skins) {
    if (!skin || typeof skin !== 'object' || !/^[A-Za-z0-9_-]{1,80}$/.test(String(skin.id || ''))) throw new Error('One or more skins has an invalid ID.');
    if (ids.has(skin.id)) throw new Error('Each skin needs a unique ID.');
    ids.add(skin.id);
  }
  const assetIds = new Set();
  for (const asset of value.assets) {
    if (!asset || typeof asset !== 'object' || !/^[A-Za-z0-9_-]{1,80}$/.test(String(asset.id || ''))) throw new Error('One or more assets has an invalid ID.');
    if (assetIds.has(asset.id)) throw new Error('Each asset needs a unique ID.');
    assetIds.add(asset.id);
    if (asset.data && (typeof asset.data !== 'string' || asset.data.length > 2_700_000)) throw new Error(`Artwork “${asset.name || asset.id}” is too large for a safe catalog restore.`);
  }
  return { skins: value.skins.length, assets: value.assets.length, legacy: Number(value.schemaVersion || 0) !== APPEARANCE_CATALOG_SCHEMA_VERSION };
}
async function readCatalogBackupFile() {
  const file = $('#catalogBackupFile').files[0];
  if (!file) throw new Error('Choose an appearance-studio-catalog.json backup first.');
  if (file.size > 8 * 1024 * 1024) throw new Error('This catalog is larger than the 8 MB protected catalog limit.');
  return JSON.parse(await file.text());
}
$('#exportCatalogButton').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(catalogBackup(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = 'appearance-studio-catalog.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  $('#catalogRestoreStatus').textContent = 'Catalog export downloaded. Keep it somewhere private: it may contain your artwork.';
});
$('#validateCatalogButton').addEventListener('click', async () => {
  const status = $('#catalogRestoreStatus');
  try {
    const result = inspectCatalogBackup(await readCatalogBackupFile());
    status.textContent = `Backup is safe to restore: ${result.skins} skin${result.skins === 1 ? '' : 's'} and ${result.assets} image${result.assets === 1 ? '' : 's'}${result.legacy ? '. It will be migrated to the current catalog format.' : '.'}`;
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
  tokens.typography ||= {};
  tokens.typography.family = ['system', 'serif', 'rounded', 'mono'].includes(skin.fontFamily) ? skin.fontFamily : (tokens.typography.family || 'system');
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
    tokens.effects[token] = typeof skin[field] === 'string' ? skin[field] : (tokens.effects[token] || neutral[field]);
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
selectSkin = function(id) { selectSkinWithTokens(id); normalizeAppearanceTokens(draft); normalizeAppearanceTokens(original); };
store.skins.forEach(skin => { normalizeAppearanceTokens(skin); normalizeUxSkin(skin); });
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
  Object.entries(componentColorDefaults).forEach(([key, defaults]) => {
    const colors = skin.componentColors[key] ||= {};
    Object.entries(defaults).forEach(([field, fallback]) => {
      if (field === 'label') return;
      colors[field] = /^#[0-9a-f]{6}$/i.test(String(colors[field] || '')) ? colors[field] : fallback;
    });
  });
}
const changedWithComponentColors = changed;
changed = function() { normalizeComponentColors(draft); changedWithComponentColors(); };
store.skins.forEach(normalizeComponentColors); normalizeComponentColors(neutral); normalizeComponentColors(draft);
const componentColorsPanel = document.createElement('details');
componentColorsPanel.className = 'studio-fold component-colors-panel';
componentColorsPanel.innerHTML = '<summary>Component colors</summary><p class="helper">Override only these supported game surfaces. Reset a component to its safe defaults at any time.</p><div id="componentColorControls"></div>';
$('#uxStudioPanel').insertBefore(componentColorsPanel, semanticTokensPanel);
function renderComponentColors() {
  normalizeComponentColors(draft); const target = $('#componentColorControls');
  target.innerHTML = Object.entries(componentColorDefaults).map(([key, defaults]) => { const colors = draft.componentColors[key]; const fields = Object.keys(defaults).filter(field => field !== 'label'); return `<details class="component-placement"><summary>${defaults.label}</summary><div class="ux-grid">${fields.map(field => `<label>${field === 'selectedText' ? 'Selected text' : field === 'selectedBorder' ? 'Selected border' : field[0].toUpperCase() + field.slice(1)}<input data-component-color="${key}" data-component-color-field="${field}" type="color" value="${colors[field]}"></label>`).join('')}</div><button type="button" data-component-color-reset="${key}">Reset ${defaults.label}</button></details>`; }).join('');
  $$('[data-component-color]').forEach(input => input.addEventListener('input', event => { const colors = draft.componentColors[event.target.dataset.componentColor]; colors[event.target.dataset.componentColorField] = event.target.value; changed(); }));
  $$('[data-component-color-reset]').forEach(button => button.addEventListener('click', () => { draft.componentColors[button.dataset.componentColorReset] = Object.fromEntries(Object.entries(componentColorDefaults[button.dataset.componentColorReset]).filter(([key]) => key !== 'label')); renderComponentColors(); changed(); }));
}
const renderEditorWithComponentColors = renderEditor;
renderEditor = function() { renderEditorWithComponentColors(); renderComponentColors(); };
renderComponentColors();

// Presets are draft-only visual recipes. They never touch room state, player
// ownership, networking, input handlers, or any gameplay setting.
const appearancePresets = {
  neutral: { name: 'Neutral Arc', values: { background: '#080808', surface: '#161616', accent: '#d8ae61', secondary: '#6e552a', text: '#f4ecd9', muted: '#afa590', atmosphereColor: '#70a97a', backgroundTreatment: 'plain', buttonTreatment: 'glass', seatTreatment: 'raised', fontFamily: 'system', fontWeight: 700, lineHeight: 1.2, letterSpacing: 0 } },
  highContrast: { name: 'High Contrast', values: { background: '#050505', surface: '#151515', accent: '#ffd36d', secondary: '#98d9a4', text: '#ffffff', muted: '#d6d6d6', atmosphereColor: '#98d9a4', backgroundTreatment: 'plain', buttonTreatment: 'solid', seatTreatment: 'raised', fontFamily: 'system', fontWeight: 700, lineHeight: 1.25, letterSpacing: .01 } },
  midnightGlass: { name: 'Midnight Glass', values: { background: '#07101b', surface: '#112235', accent: '#75c7ff', secondary: '#af9cff', text: '#f2f8ff', muted: '#b8c8dc', atmosphereColor: '#466f9d', backgroundTreatment: 'mist', buttonTreatment: 'glass', seatTreatment: 'glass', fontFamily: 'rounded', fontWeight: 600, lineHeight: 1.25, letterSpacing: 0 } }
};
const presetsPanel = document.createElement('details');
presetsPanel.className = 'studio-fold appearance-presets-panel';
presetsPanel.innerHTML = `<summary>Visual presets</summary><p class="helper">Apply a visual starting point to this unsaved draft. Undo restores the exact prior draft.</p><div class="preset-actions">${Object.entries(appearancePresets).map(([id, preset]) => `<button type="button" data-appearance-preset="${id}">${preset.name}</button>`).join('')}</div>`;
$('#uxStudioPanel').insertBefore(presetsPanel, componentColorsPanel);
$$('[data-appearance-preset]').forEach(button => button.addEventListener('click', () => {
  const preset = appearancePresets[button.dataset.appearancePreset]; if (!preset) return;
  Object.assign(draft, clone(preset.values)); normalizeAppearanceTokens(draft); normalizeComponentColors(draft); renderEditor(); changed(); toast(`${preset.name} applied to this draft.`);
}));

const validateWithBaseChecks = validate;
validate = function() {
  normalizeComponentColors(draft);
  const basePass = validateWithBaseChecks();
  const componentChecks = Object.entries(componentColorDefaults).map(([key, defaults]) => {
    const colors = draft.componentColors[key];
    return { label: `${defaults.label} text remains readable`, pass: contrast(colors.text, colors.background) >= 4.5, screen: `${defaults.label} component token` };
  });
  const failed = componentChecks.filter(check => !check.pass);
  if (!failed.length) return basePass;
  validate.requiredFailures = [...(validate.requiredFailures || []), ...failed];
  const summary = $('#validationSummary');
  summary.textContent = `${validate.requiredFailures.length} required check${validate.requiredFailures.length === 1 ? '' : 's'} need attention.`;
  summary.className = 'validation-summary fail';
  $('#validationList').insertAdjacentHTML('beforeend', failed.map(check => `<li class="fail"><span>!</span><div><strong>${check.label}</strong><small>${check.screen}</small></div></li>`).join(''));
  return false;
};

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
    normalizeAppearanceTokens(draft); normalizeComponentColors(draft); normalizeUxSkin(draft);
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
