import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('./', import.meta.url);
const studio = await readFile(new URL('appearance-studio.js', root), 'utf8');
const devicePreview = await readFile(new URL('device-preview.js', root), 'utf8');
const app = await readFile(new URL('app.js', root), 'utf8');
const html = await readFile(new URL('appearance-studio.html', root), 'utf8');

test('Appearance Studio uses the isolated live renderer as its visible preview', () => {
  assert.match(html, /<iframe id="exactPreview"[^>]*src="index\.html\?appearance-preview=1"/);
  assert.match(studio, /frame\.contentWindow\?\.postMessage\(\{ type: 'fivefold-arc:appearance-skin'/);
  assert.match(studio, /fivefold-arc:appearance-preview-ready/);
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
});

test('button and dial layout values are stored independently in a skin', () => {
  assert.match(studio, /skin\.modeLayouts\[mode\] \|\|=/);
  assert.match(studio, /function activeModeLayout/);
  assert.match(studio, /activeModeLayout\(\)\[key\] = Number/);
  assert.match(studio, /const layout = activeModeLayout\(skin\)/);
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

test('dial artwork can rotate with the dial and the Studio can open a shared phone layout editor', () => {
  assert.match(studio, /dialArtSpin/);
  assert.match(studio, /Spin this art with the dial/);
  assert.match(app, /appearance-dial-art/);
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
  assert.match(studio, /useGameBase: showingBaseline/);
  assert.match(app, /data-appearance-custom="false"/);
  assert.match(app, /customAppearance = !skin\.useGameBase/);
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
  for (const key of ['backgroundData', 'sealData', 'symbolData', 'seatOpacity', 'seatBlur', 'seatBorder', 'buttonOpacity', 'lifeButtonOpacity', 'customLifeOpacity', 'commanderTaxOpacity']) assert.match(studio, new RegExp(`\\b${key}\\b`));
  assert.match(app, /\['button','lifeButton','customLife','commanderTax'\]\.forEach/);
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
