import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildRendererTheme, normalizePreviewFixture } from './renderer-bridge.js';

const root = new URL('./', import.meta.url);
const studio = await readFile(new URL('appearance-studio.js', root), 'utf8');
const devicePreview = await readFile(new URL('device-preview.js', root), 'utf8');
const app = await readFile(new URL('app.js', root), 'utf8');
const html = await readFile(new URL('appearance-studio.html', root), 'utf8');
const rendererCss = await readFile(new URL('renderer-theme.css', root), 'utf8');
const rendererV2Css = rendererCss.split('/* Released v1 production CSS.')[0];

test('Appearance Studio uses the isolated live renderer and recovers blocked embeds with an exact phone session', () => {
  assert.match(html, /<iframe id="exactPreview"[^>]*src="index\.html\?appearance-preview=1"/);
  assert.doesNotMatch(html, /id="phonePreview"|id="previewScreen"/);
  assert.match(studio, /function showExactPreviewRecovery\(\)/);
  assert.match(studio, /Open fast browser preview/);
  assert.match(app, /createRendererBridge\(document/);
  assert.match(app, /previewMessageAllowed\(event, location.origin, expected\)/);
  assert.match(app, /document.querySelector\('main'\).inert = true/);
  assert.doesNotMatch(app, /appearancePreviewStyle|appearanceUxStyle/);
});

test('Device Preview uses live app iframes with persisted iPhone-first presets', () => {
  for (const name of ['iPhone 16','iPhone SE (3rd gen)','iPad mini','Desktop game window']) assert.ok(devicePreview.includes(name));
  assert.match(devicePreview, /index\.html\?appearance-preview=1/);
  assert.match(devicePreview, /localStorage\.setItem\(STORAGE_KEY/);
  assert.match(devicePreview, /fitPreviewScale\(width,height/);
  assert.match(devicePreview, /ResizeObserver/);
  assert.match(devicePreview, /screen.moveBefore\(frame,status\)/);
  assert.doesNotMatch(devicePreview, /grid.replaceChildren/);
});

test('button and dial layout values are stored independently in a skin', () => {
  assert.match(studio, /skin\.modeLayouts\[mode\] \|\|=/);
  assert.match(studio, /function activeModeLayout/);
  assert.match(studio, /activeModeLayout\(\)\[key\] = Number/);
  assert.match(studio, /const layout = legacy \? \{\} : activeModeLayout\(skin\)/);
});

test('supported layout regions stay bounded and keep functional structure locked', () => {
  assert.match(studio, /placement\.x = Math\.min\(100, Math\.max\(-100/);
  assert.match(studio, /placement\.y = Math\.min\(140, Math\.max\(-140/);
  assert.match(studio, /placement\.scale = Math\.min\(140, Math\.max\(70/);
  assert.match(studio, /Inherited placement:/);
  assert.match(studio, /data-placement-field="x" type="range" min="-32" max="32"/);
  assert.match(studio, /data-placement-field="y" type="range" min="-36" max="36"/);
  assert.match(studio, /data-placement-field="scale" type="range" min="85" max="115" step="1"/);
  assert.match(studio, /controls remain reachable before publishing/);
});

test('the center seal and life total can be positioned independently in each control layout', () => {
  const theme = buildRendererTheme({rendererVersion:2,id:'review',modeLayouts:{dial:{centerSealScale:125,centerSealOffsetX:8,lifeNumberScale:110,lifeNumberOffsetX:-4}}},'dial');
  assert.equal(theme.variables['--skin-seal-scale'],'1.25');
  assert.equal(theme.variables['--skin-center-seal-offset-x'],'8px');
  assert.equal(theme.variables['--appearance-life-number-scale'],'1.1');
  assert.equal(theme.variables['--skin-life-number-offset-x'],'-4px');
});

test('the Studio exposes separate safe text sizing controls and collapsible editing groups', () => {
  const theme = buildRendererTheme({rendererVersion:2,id:'review',labelTextScale:110,seatTextScale:90});
  assert.equal(theme.variables['--skin-label-text-scale'],'1.1');
  assert.equal(theme.variables['--skin-seat-text-scale'],'0.9');
  assert.match(html,/studio-fold/);
});

test('player-card spacing is bounded per supported control layout', () => {
  assert.equal(buildRendererTheme({rendererVersion:2,id:'review',modeLayouts:{dial:{seatGap:99}}},'dial').variables['--skin-seat-gap'],'16px');
  assert.equal(buildRendererTheme({rendererVersion:2,id:'review',modeLayouts:{button:{seatGap:2}}},'button').variables['--skin-seat-gap'],'4px');
});

test('dial artwork can rotate with the dial and the Studio can open a shared phone layout editor', () => {
  assert.match(rendererCss,/rotate\(var\(--dial-seal-rotation,0deg\)\)/);
  assert.match(rendererCss,/dial-gesture > \.skin-overlay/);
  assert.match(studio,/fivefold-arc:phone-layout-sync/);
  assert.match(app,/phoneLayoutSessionId/);
  assert.match(app,/previewReadOnly/);
});

test('dial artwork keeps its full canvas for the overlay to frame', () => {
  assert.match(rendererCss,/\.skin-overlay \{ position: absolute; inset: 0;[\s\S]*pointer-events: none;/);
  assert.match(rendererCss,/dial-gesture > \.skin-overlay \{ border-radius: 0; object-fit: contain; object-position: center;/);
  assert.doesNotMatch(rendererV2Css,/\.dial-gesture\s*\{[^}]*position:/);
});

test('the exact preview and the phone session use the same active layout payload', () => {
  assert.match(studio,/skin: buildDevicePreviewSkin\(\)/);
  assert.match(studio,/rendererPreviewPayload = buildDevicePreviewSkin/);
  assert.match(studio,/getSkin: buildDevicePreviewSkin/);
  assert.match(studio,/phoneLayoutChanges\(session.skin\)/);
  assert.doesNotMatch(studio,/draft = \{ \.\.\.draft, \.\.\.session.skin \}/);
});

test('Neutral Arc baseline bypasses Studio-only card and background treatments', () => {
  assert.match(studio,/useGameBase: true/);
  assert.equal(buildRendererTheme({id:'__neutral_arc__',background:'#ff0000'}).native,true);
  assert.deepEqual(buildRendererTheme({id:'__neutral_arc__'}).variables,{});
  assert.doesNotMatch(app,/customAppearance = !skin.useGameBase/);
  assert.doesNotMatch(rendererCss,/html\.appearance-preview/);
});

test('a non-baseline skin can be deleted without allowing Neutral Arc to be removed', () => {
  assert.match(studio, /data-delete-skin/);
  assert.match(studio, /async function deleteSkin/);
  assert.match(studio, /id === CANONICAL_NEUTRAL_ID/);
  assert.match(studio, /skin\.status === 'Approved' \|\| store\.skins\.some/);
});

test('the Studio preview preserves the app seal as an absolutely centered layer', () => {
  assert.match(rendererCss,/counter-sigil \{ transform: translate\(-50%,var\(--counter-seal-anchor-y,-50%\)\)/);
  assert.doesNotMatch(rendererV2Css,/counter-readout\s*\{[^}]*position:/);
  assert.doesNotMatch(rendererV2Css,/\.dial-gesture\s*\{[^}]*position:/);
});

test('every counter icon can be previewed and scaled within bounded limits', () => {
  for (const mode of ['life','commander','radiation','poison','energy','generic']) {
    const theme = buildRendererTheme({rendererVersion:2,id:'review',symbolScale:{[mode]:999}});
    assert.equal(theme.assets.symbolScale[mode],2);
    assert.equal(buildRendererTheme({rendererVersion:2,id:'review',symbolScale:{[mode]:5}}).assets.symbolScale[mode],.6);
  }
});

test('Studio checks decoded artwork, rasterizes SVG and bounds optimized imports', () => {
  assert.match(studio,/file\.size > 20000000/);
  assert.match(studio,/await image\.decode\(\)/);
  assert.match(studio,/file\.type !== 'image\/svg\+xml'/);
  assert.match(studio,/canvas\.toDataURL\('image\/webp',quality\)/);
  assert.match(studio,/inspectImageData\(data\)/);
});


test('Studio makes catalog saves visible and uploads only newly imported artwork', () => {
  assert.match(html, /id="saveState" role="status" aria-live="polite"/);
  assert.match(studio, /setCatalogSaving\(true, label\)/);
  assert.match(studio, /\$\{label\}… artwork \$\{index \+ 1\} of \$\{assets\.length\}/);
  assert.match(studio, /item\.data && item\.pendingUpload/);
  assert.match(studio, /pendingUpload:\s*true/);
  assert.match(studio, /Save failed — try again/);
  assert.match(studio, /async function saveDraft\(label = 'Saving draft',/);
});

test('Studio makes publish failures prominent and specific', () => {
  assert.match(html, /id="publishFeedback" class="publish-feedback" role="alert" aria-live="assertive" hidden/);
  assert.match(studio, /function showPublishFeedback\(title, reason\)/);
  assert.match(studio, /validate\.requiredFailures = report\.errors\.map/);
  assert.match(studio, /Cannot publish this skin yet\./);
  assert.match(studio, /Publishing stopped because the draft could not save\./);
  assert.match(studio, /Publishing failed\./);
  assert.match(studio, /saveDraft\('Preparing publish'\)/);
});

test('the exact preview covers phone sizes and 4, 6, and 8-player tables', () => {
  assert.match(studio,/width: 393, height: 852/);
  assert.match(studio,/width: 320, height: 700/);
  for (const players of [4,6,8]) assert.equal(normalizePreviewFixture({previewPlayers:players}).players,players);
  assert.match(studio,/frame.style.width = \x60\$\{size.width\}px\x60/);
  assert.match(studio,/frame.style.height = \x60\$\{size.height\}px\x60/);
});

test('the exact preview can render every supported counter mode', () => {
  for (const mode of ['life','commander','radiation','poison','energy','generic']) assert.equal(normalizePreviewFixture({previewMode:mode}).mode,mode);
  for (const state of ['lobby','turn','other','damage','offline','status','dialog','error','end']) assert.equal(normalizePreviewFixture({previewState:state}).state,state);
  assert.match(app,/showTableView\(\); render\(\)/);
  assert.match(app,/dom.customLifeDialog.showModal\(\)/);
});

test('the exact preview receives every appearance control family', () => {
  const theme = buildRendererTheme({rendererVersion:2,id:'review',seatOpacity:60,buttonOpacity:75,lifeButtonOpacity:65,customLifeOpacity:55,commanderTaxOpacity:45,commanderDamageOpacity:35});
  assert.equal(theme.variables['--skin-seat-opacity'],'0.6');
  assert.equal(theme.variables['--skin-button-opacity'],'0.75');
  assert.equal(theme.variables['--skin-life-button-opacity'],'0.65');
  assert.equal(theme.variables['--skin-custom-life-opacity'],'0.55');
  assert.equal(theme.variables['--skin-commander-tax-opacity'],'0.45');
  assert.equal(theme.variables['--skin-commander-damage-opacity'],'0.35');
  assert.match(app,/productionSkinRenderer.apply\(skin, interfaceStyle\)/);
});

test('Studio preflight checks the exact-app matrix without saving or publishing a draft', () => {
  assert.match(studio,/id="runPreflightButton"[^>]*>Run preflight/);
  assert.match(studio,/async function renderPreflightFixture/);
  assert.match(studio,/fivefold-arc:appearance-rendered/);
  assert.match(studio,/previewViewportChecks/);
  assert.match(studio,/Touch comfort and readability across a table still need a playtest/);
  const preflight = studio.slice(studio.indexOf('async function runPreflight()'),studio.indexOf('function renderExactPreview()',studio.indexOf('async function runPreflight()')));
  assert.doesNotMatch(preflight,/saveDraft\(|publish\(|changed\(/);
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
  for (const id of ['stateSuccess','stateWarning','stateDanger','focusColor','fontWeight','lineHeight','letterSpacing','textTransform','labelAlignment','textEffect']) assert.ok(studio.includes('id="'+id+'"'));
  const theme = buildRendererTheme({rendererVersion:2,id:'review',stateSuccess:'#112233',fontWeight:500,lineHeight:1.5,letterSpacing:.02,textTransform:'uppercase',textEffect:'soft-shadow'});
  assert.equal(theme.variables['--safe'],'#112233');
  assert.equal(theme.variables['--skin-font-weight'],'500');
  assert.equal(theme.variables['--skin-line-height'],'1.5');
  assert.equal(theme.variables['--skin-letter-spacing'],'0.02em');
  assert.equal(theme.variables['--skin-text-transform'],'uppercase');
});

test('Studio supports only named component color overrides with resets', () => {
  assert.match(studio,/data-component-color-reset/);
  const theme = buildRendererTheme({rendererVersion:2,id:'review',componentColors:{endTurn:{background:'#112233'},lifeButtons:{text:'#aabbcc'},arbitrary:{background:'#ffffff'}}});
  assert.equal(theme.variables['--skin-end-turn-background'],'#112233');
  assert.equal(theme.variables['--skin-life-buttons-text'],'#aabbcc');
  assert.equal(Object.keys(theme.variables).some(key => key.includes('arbitrary')),false);
});

test('Studio presets affect only the unsaved visual draft and remain undoable', () => {
  assert.match(studio, /const appearancePresets =/);
  for (const preset of ['neutral', 'highContrast', 'midnightGlass']) assert.match(studio, new RegExp(`\\b${preset}\\b`));
  assert.match(studio, /Visual presets/);
  assert.match(studio, /Apply a visual starting point to this unsaved draft/);
  assert.match(studio, /Object\.assign\(draft, clone\(preset\.values\)\)/);
  assert.match(studio, /Undo restores the exact prior draft/);
});

test('component token contrast is required before publishing', async () => {
  const {validateAppearanceSkin} = await import('./appearance-validation.js');
  const skin = {id:'safe-draft',rendererVersion:2,componentColors:{navigation:{background:'#181818',text:'#ffffff',selectedText:'#242424'}}};
  assert.equal(validateAppearanceSkin(skin).errors.length,0);
  const failures = validateAppearanceSkin(skin,{publish:true}).errors;
  assert.ok(failures.some(failure=>failure.path === 'componentColors.navigation.selectedText' && failure.fix.includes('4.5')));
});


test('saved skin versions are bounded and restore only into an unsaved draft', () => {
  assert.match(studio, /const SKIN_VERSION_LIMIT = 12/);
  assert.match(studio, /function recordSavedSkinVersion\(skin, label\)/);
  assert.match(studio, /recordSavedSkinVersion\(change\.skin, label\)/);
  assert.match(studio, /appearance-studio\/skins\/\$\{encodeURIComponent\(id\)\}\/publish/);
  assert.match(studio, /Restore to draft/);
  assert.match(studio, /only this unsaved visual draft/);
  assert.match(studio, /versions, status \}/);
});
