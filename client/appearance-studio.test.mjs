import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('./', import.meta.url);
const studio = await readFile(new URL('appearance-studio.js', root), 'utf8');
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

test('every counter icon can be previewed and scaled within bounded limits', () => {
  for (const mode of ['life', 'commander', 'radiation', 'poison', 'energy', 'generic']) {
    assert.match(studio, new RegExp(`\\b${mode}\\b`));
  }
  assert.match(studio, /type="range" min="60" max="200" step="5"/);
  assert.match(app, /Math\.min\(200, Math\.max\(60, Number\(skin\.symbolScale/);
  assert.match(app, /MODES\.forEach\(mode =>/);
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
  assert.doesNotMatch(studio, /renderPreview\s*=/);
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
