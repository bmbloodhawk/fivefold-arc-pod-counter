import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('./', import.meta.url);
const studio = await readFile(new URL('appearance-studio.js', root), 'utf8');
const devicePreview = await readFile(new URL('device-preview.js', root), 'utf8');
const app = await readFile(new URL('app.js', root), 'utf8');
const html = await readFile(new URL('appearance-studio.html', root), 'utf8');

test('Appearance Studio uses the isolated live renderer and a visible blocked-iframe fallback', () => {
  assert.match(html, /<iframe id="exactPreview"[^>]*src="index\.html\?appearance-preview=1"/);
  assert.match(html, /class="preview-stage legacy-preview" hidden aria-hidden="true"/);
  assert.match(html, /visible preview is the live game interface/);
  assert.match(studio, /frame\.contentWindow\?\.postMessage\(\{ type: 'fivefold-arc:appearance-skin'/);
  assert.match(studio, /fivefold-arc:appearance-preview-ready/);
  assert.match(studio, /function useCompatibilityPreview\(\)/);
  assert.match(studio, /window\.setTimeout\(useCompatibilityPreview, 2200\)/);
  assert.match(studio, /function markExactPreviewReady\(\)/);
  assert.match(app, /appearancePreviewMode = new URLSearchParams\(location\.search\)\.get\('appearance-preview'\) === '1'/);
  assert.match(app, /event\.origin !== location\.origin \|\| event\.data\?\.type !== 'fivefold-arc:appearance-skin'/);
  assert.match(app, /window\.parent\.postMessage\(\{ type: 'fivefold-arc:appearance-preview-ready' \}, location\.origin\)/);
});

test('Device Preview uses live app iframes with persisted iPhone-first presets', () => {
  for (const device of ['iPhone 16', 'iPhone 16 Pro', 'iPhone 16 Pro Max', 'iPhone 15', 'iPhone SE (3rd gen)']) assert.match(devicePreview, new RegExp(device.replace(/[()]/g, '\\$&')));
  assert.match(devicePreview, /width: 393, height: 852, dpr: 3/);
  assert.match(devicePreview, /localStorage\.setItem\(STORAGE_KEY/);
  assert.match(devicePreview, /index\.html\?appearance-preview=1/);
  assert.match(devicePreview, /previewColorScheme/);
  assert.match(devicePreview, /Rotate landscape/);
  assert.match(devicePreview, /Safe areas/);
  assert.match(devicePreview, /live game renderer at the selected viewport/);
  assert.match(devicePreview, /same device or desktop window/);
  assert.match(devicePreview, /Each visible shell owns its device and orientation/);
  assert.match(devicePreview, /comparisonDevice\.name/);
  assert.match(devicePreview, /Compare devices/);
  assert.match(devicePreview, /Comparison device \$\{index \+ 1\}/);
  assert.match(devicePreview, /Desktop game window/);
  assert.match(devicePreview, /width: 860, height: 900, dpr: 1/);
  assert.match(devicePreview, /function displayScale/);
  assert.match(devicePreview, /--sim-layout-width/);
});

test('button and dial layout values are stored independently in a skin', () => {
  assert.match(studio, /skin\.modeLayouts\[mode\] \|\|=/);
  assert.match(studio, /function activeModeLayout/);
  assert.match(studio, /activeModeLayout\(\)\[key\] = Number/);
  assert.match(studio, /const layout = activeModeLayout\(skin\)/);
});

test('supported layout regions stay bounded and keep functional structure locked', () => {
  assert.match(studio, /placement\.x = Math\.min\(32, Math\.max\(-32/);
  assert.match(studio, /placement\.y = Math\.min\(36, Math\.max\(-36/);
  assert.match(studio, /placement\.scale = Math\.min\(115, Math\.max\(85/);
  assert.match(studio, /cannot be hidden, reordered, or made unreachable/);
});

test('the center seal and life total can be positioned independently in each control layout', () => {
  for (const label of ['Center seal size', 'Center seal left\/right', 'Life total size', 'Life total left\/right']) assert.match(html, new RegExp(label));
  for (const key of ['centerSealScale', 'centerSealOffsetX', 'centerSealOffsetY', 'lifeNumberScale', 'lifeNumberOffsetX', 'lifeNumberOffsetY']) assert.match(studio, new RegExp(`\\b${key}\\b`));
  assert.match(app, /--appearance-seal-scale/);
  assert.match(app, /--appearance-life-number-scale/);
});

test('the Studio exposes separate safe text sizing controls and collapsible editing groups', () => {
  for (const label of ['Labels &amp; buttons', 'Seat card text', 'Type &amp; readability', 'Shape &amp; spacing', 'Center readout']) assert.match(html, new RegExp(label));
  for (const key of ['labelTextScale', 'seatTextScale']) assert.match(studio, new RegExp(`\\b${key}\\b`));
  assert.match(app, /--appearance-label-text-scale/);
  assert.match(app, /--appearance-seat-text-scale/);
  assert.match(html, /class="studio-fold"/);
});

test('player-card spacing is bounded per supported control layout', () => {
  assert.match(studio, /Player-card gap/);
  assert.match(studio, /layout\.seatGap = Math\.min\(16, Math\.max\(4/);
  assert.match(app, /--appearance-seat-gap/);
  assert.match(app, /\.pod-strip\{gap:var\(--appearance-seat-gap,8px\)\}/);
});

test('dial artwork can rotate with the dial and the Studio can open a shared phone layout editor', () => {
  assert.match(studio, /dialArtSpin/);
  assert.match(studio, /layout\.dialArtSpin = true/);
  assert.match(studio, /Spin this art with the dial/);
  assert.match(app, /appearance-dial-art/);
  assert.match(app, /dial-gesture>\.skin-overlay/);
  assert.match(app, /dial-gesture>\.appearance-overlay/);
  assert.match(app, /transform-origin:50% 50%/);
  assert.match(app, /object-position:center/);
  assert.match(app, /phoneLayoutSessionId/);
  assert.match(studio, /Phone Layout Editor/);
  assert.match(studio, /phone-layout/);
});

test('the exact preview and the phone session use the same active layout payload', () => {
  assert.match(studio, /const exactSkin = buildDevicePreviewSkin\(\)/);
  assert.match(studio, /skin: buildDevicePreviewSkin\(\)/);
  assert.match(app, /phone-layout-editor-launcher/);
});

test('Neutral Arc baseline bypasses Studio-only card and background treatments', () => {
  assert.match(studio, /useGameBase: showingBaseline \|\| skin\.id === 'neutral'/);
  assert.match(app, /root\.dataset\.appearanceCustom = String\(customAppearance\)/);
  assert.match(app, /customAppearance = !skin\.useGameBase/);
  assert.match(app, /appearanceUxStyle\.disabled = !customAppearance/);
  assert.doesNotMatch(app, /\.pod-seat>\*:not\(\.appearance-overlay\)/);
  assert.match(app, /\.pod-seat>\.seat-name,html\.appearance-preview \.pod-seat>\.seat-life/);
  assert.doesNotMatch(app, /appearanceBaseStyle/);
  assert.doesNotMatch(app, /\.mode-nav button>span\{font-size:1\.4rem\}/);
  assert.match(app, /data-appearance-custom="true"\] \.mode-nav img/);
});

test('a non-baseline skin can be deleted without allowing Neutral Arc to be removed', () => {
  assert.match(studio, /data-delete-skin/);
  assert.match(studio, /async function deleteSkin/);
  assert.match(studio, /id === 'neutral'/);
});

test('the Studio preview preserves the app seal as an absolutely centered layer', () => {
  assert.match(app, /\.counter-readout\{translate:0 var\(--appearance-counter-offset,0\);position:relative;z-index:3\}/);
  assert.doesNotMatch(app, /\.counter-stage>\*:not\(\.appearance-overlay\)/);
});

test('every counter icon can be previewed and scaled within bounded limits', () => {
  for (const mode of ['life', 'commander', 'radiation', 'poison', 'energy', 'generic']) {
    assert.match(studio, new RegExp(`\\b${mode}\\b`));
  }
  assert.match(studio, /type="range" min="60" max="200" step="5"/);
  assert.match(app, /Math\.min\(200, Math\.max\(60, Number\(skin\.symbolScale/);
  assert.match(app, /MODES\.forEach\(mode =>/);
});

test('Studio accepts a 20 MB source image and optimizes large assets before saving', () => {
  assert.match(studio, /file\.size > 20000000/);
  assert.match(studio, /up to 20 MB/);
  assert.match(studio, /file\.size > 700000 \|\| file\.type === 'image\/svg\+xml' \? await scaleForStudio/);
  assert.match(studio, /placement === 'symbol' \? 256 : 1280/);
  assert.match(studio, /data\.length \* \.75 <= 700000/);
});

test('Studio makes catalog saves visible and uploads only newly imported artwork', () => {
  assert.match(html, /id="saveState" role="status" aria-live="polite"/);
  assert.match(studio, /setCatalogSaving\(true, label\)/);
  assert.match(studio, /\$\{label\}… artwork \$\{index \+ 1\} of \$\{assets\.length\}/);
  assert.match(studio, /item\.data && item\.pendingUpload/);
  assert.match(studio, /pendingUpload: true/);
  assert.match(studio, /Save failed — try again/);
  assert.match(studio, /async function saveDraft\(label = 'Saving draft'\)/);
});

test('Studio makes publish failures prominent and specific', () => {
  assert.match(html, /id="publishFeedback" class="publish-feedback" role="alert" aria-live="assertive" hidden/);
  assert.match(studio, /function showPublishFeedback\(title, reason\)/);
  assert.match(studio, /validate\.requiredFailures = failed/);
  assert.match(studio, /Cannot publish this skin yet\./);
  assert.match(studio, /Publishing stopped because the draft could not save\./);
  assert.match(studio, /Publishing failed\./);
  assert.match(studio, /saveDraft\('Preparing publish'\)/);
});

test('the exact preview covers phone sizes and 4, 6, and 8-player tables', () => {
  assert.match(html, /393 × 852/);
  assert.match(html, /320 × 700/);
  assert.match(studio, /previewPlayers = 4/);
  assert.match(studio, /data-preview-players="4"/);
  assert.match(studio, /data-preview-players="6"/);
  assert.match(studio, /data-preview-players="8"/);
  assert.match(studio, /\.exact-preview\{box-sizing:content-box;/);
  assert.match(app, /const previewPlayers = \[4, 6, 8\]\.includes\(Number\(skin\.previewPlayers\)\)/);
});

test('the exact preview can render every supported counter mode', () => {
  assert.match(studio, /aria-label', 'Preview counter mode'/);
  assert.match(studio, /data-preview-mode=/);
  assert.match(studio, /previewMode = button\.dataset\.previewMode/);
  assert.match(studio, /previewState, previewMode, previewPlayers/);
  assert.match(app, /const previewMode = MODES\.includes\(skin\.previewMode\)/);
  assert.match(app, /state\.mode = previewMode/);
});

test('the exact preview receives every appearance control family', () => {
  for (const key of ['backgroundData', 'sealData', 'symbolData', 'seatOpacity', 'seatBlur', 'seatBorder', 'buttonOpacity', 'lifeButtonOpacity', 'customLifeOpacity', 'commanderTaxOpacity', 'commanderDamageOpacity']) assert.match(studio, new RegExp(`\\b${key}\\b`));
  assert.match(app, /\['button','lifeButton','customLife','commanderTax','commanderDamage'\]\.forEach/);
  assert.match(app, /skin\[`\$\{prefix\}Opacity`\]/);
  assert.match(app, /--appearance-seat-opacity/);
  assert.match(app, /skin\.backgroundData/);
  assert.match(app, /skin\.sealData/);
  assert.match(app, /skin\.symbolData\?\.\[mode\]/);
  assert.match(app, /pointer-events:none/);
  assert.match(studio, /const renderPreviewBase = renderPreview/);
  assert.match(studio, /interfaceStyle: 'button'/);
  assert.match(studio, /overlayData/);
});

test('Studio preflight checks the exact-app matrix without saving or publishing a draft', () => {
  assert.match(studio, /id="runPreflightButton"[^>]*>Run preflight/);
  assert.match(studio, /const preflightSizes = \[\{ id: 'phone'.*\{ id: 'compact'/);
  assert.match(studio, /const preflightPlayers = \[4, 6, 8\]/);
  assert.match(studio, /for \(const mode of Object\.keys\(icons\)\)/);
  assert.match(studio, /root\.scrollWidth <= root\.clientWidth/);
  assert.match(studio, /root\.scrollHeight <= root\.clientHeight/);
  assert.match(studio, /Real-device touch and table-distance review still need a playtest/);
  const preflight = studio.match(/async function runPreflight\(\)[\s\S]*?\nfunction renderExactPreview/)?.[0] || '';
  assert.doesNotMatch(preflight, /saveDraft\(|publish\(/);
});

test('Studio foundation provides bounded undo redo and portable catalog validation', () => {
  assert.match(html, /id="undoButton"/);
  assert.match(html, /id="redoButton"/);
  assert.match(html, /id="exportCatalogButton"/);
  assert.match(html, /id="validateCatalogButton"/);
  assert.match(studio, /const APPEARANCE_CATALOG_SCHEMA_VERSION = 1/);
  assert.match(studio, /const DRAFT_HISTORY_LIMIT = 60/);
  assert.match(studio, /function recordDraftHistory\(\)/);
  assert.match(studio, /function restoreDraftHistory\(index\)/);
  assert.match(studio, /function inspectCatalogBackup\(value\)/);
  assert.match(studio, /Catalog export downloaded/);
});

test('Studio maintains semantic appearance tokens while preserving legacy skin fields', () => {
  assert.match(studio, /const APPEARANCE_TOKEN_SCHEMA_VERSION = 1/);
  assert.match(studio, /const tokenColorFields =/);
  assert.match(studio, /function normalizeAppearanceTokens\(skin\)/);
  assert.match(studio, /tokens\.color\[token\]/);
  assert.match(studio, /tokens\.typography\.family/);
  assert.match(studio, /tokens\.components\[prefix\]/);
  assert.match(studio, /function materializeAppearanceSkin\(skin\)/);
  assert.match(studio, /renderExactPreview\(\); devicePreview\.sync\(\);/);
});

test('Studio exposes bounded semantic state color and global typography controls', () => {
  for (const id of ['stateSuccess', 'stateWarning', 'stateDanger', 'focusColor', 'fontWeight', 'lineHeight', 'letterSpacing', 'textTransform', 'labelAlignment', 'textEffect']) assert.match(studio, new RegExp(`id=\\"${id}\\"`));
  assert.match(studio, /State colors &amp; global type/);
  assert.match(studio, /function renderSemanticTokens\(\)/);
  assert.match(app, /--appearance-font-weight/);
  assert.match(app, /--appearance-line-height/);
  assert.match(app, /--appearance-letter-spacing/);
  assert.match(app, /--appearance-text-transform/);
  assert.match(app, /--appearance-label-alignment/);
  assert.match(app, /--appearance-text-shadow/);
  assert.match(app, /--focus-ring/);
});

test('Studio supports only named component color overrides with resets', () => {
  for (const component of ['endTurn', 'lifeButtons', 'playerCards', 'navigation']) assert.match(studio, new RegExp(`\\b${component}\\b`));
  assert.match(studio, /Component colors/);
  assert.match(studio, /function normalizeComponentColors\(skin\)/);
  assert.match(studio, /data-component-color-reset/);
  assert.match(app, /appearance-end-turn-background/);
  assert.match(app, /appearance-life-buttons-background/);
  assert.match(app, /appearance-player-cards-background/);
  assert.match(app, /appearance-navigation-background/);
});

test('Studio presets affect only the unsaved visual draft and remain undoable', () => {
  assert.match(studio, /const appearancePresets =/);
  for (const preset of ['neutral', 'highContrast', 'midnightGlass']) assert.match(studio, new RegExp(`\\b${preset}\\b`));
  assert.match(studio, /Visual presets/);
  assert.match(studio, /Apply a visual starting point to this unsaved draft/);
  assert.match(studio, /Object\.assign\(draft, clone\(preset\.values\)\)/);
  assert.match(studio, /Undo restores the exact prior draft/);
});

test('component token contrast is required before publishing', () => {
  assert.match(studio, /const validateWithBaseChecks = validate/);
  assert.match(studio, /componentChecks = Object\.entries\(componentColorDefaults\)/);
  assert.match(studio, /text remains readable/);
  assert.match(studio, /contrast\(colors\.text, colors\.background\) >= 4\.5/);
});

test('saved skin versions are bounded and restore only into an unsaved draft', () => {
  assert.match(studio, /const SKIN_VERSION_LIMIT = 12/);
  assert.match(studio, /function recordSavedSkinVersion\(skin, label\)/);
  assert.match(studio, /recordSavedSkinVersion\(savedSkin, label\)/);
  assert.match(studio, /recordSavedSkinVersion\(skin, 'Published'\)/);
  assert.match(studio, /Restore to draft/);
  assert.match(studio, /only this unsaved visual draft/);
  assert.match(studio, /versions, status \}/);
});
