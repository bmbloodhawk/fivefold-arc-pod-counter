import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');

test('the full visible dial starts a drag without covering the side tap zones', () => {
  assert.match(styles, /\.dial-controls \{ position: absolute; z-index: 5;[\s\S]*pointer-events: auto; touch-action: none;/);
  assert.match(styles, /\.dial-controls \{ position: absolute; z-index: 5;[\s\S]*grid-template-columns: minmax\(64px, 1fr\) minmax\(168px, 255px\) minmax\(64px, 1fr\);/);
  assert.match(styles, /\.dial-gesture \{[\s\S]*z-index: 0;[\s\S]*width: min\(79vw, 310px\);[\s\S]*height: min\(79vw, 310px\);[\s\S]*pointer-events: auto;[\s\S]*transform: translate\(-50%, -50%\);/);
  assert.match(styles, /\.dial-step \{ position: relative; z-index: 1;[\s\S]*pointer-events: auto; touch-action: manipulation;/);
  assert.match(styles, /\.dial-step-minus \{ grid-column: 1; \}/);
  assert.match(styles, /\.dial-step-plus \{ grid-column: 3; \}/);
  assert.match(app, /event\.target\.closest\('\[data-delta\]'\)/);
  assert.match(app, /dom\.dialControls\.addEventListener\('pointerup',[\s\S]*?\.dial-step\[data-delta\][\s\S]*?void adjust\(Number\(button\.dataset\.delta\)\)/);
});

test('rendering a Dial simulation reads the saved interface style without invoking it', () => {
  assert.match(app, /dom\.dialControls\.hidden = freezeGameControls \|\| interfaceStyle !== 'dial';/);
  assert.doesNotMatch(app, /interfaceStyle\(\)/);
});

test('visible Dial layers use one shared center while the life total gets only an optical lift', () => {
  assert.match(styles, /#gameView\[data-interface-style="dial"\] \{ --dial-center-y: 48%; \}/);
  assert.match(styles, /counter-stage::after \{ transform: translate\(-50%, -50%\) rotate/);
  assert.match(styles, /counter-sigil \{[\s\S]*transform: translate\(-50%, -50%\) rotate/);
  assert.match(styles, /counter-stage::after \{ top: var\(--dial-center-y\); \}/);
  assert.match(styles, /dial-controls \{ top: var\(--dial-center-y\); \}/);
  assert.match(styles, /counter-readout \.main-value \{ position: absolute; top: var\(--dial-center-y\); left: 50%;[\s\S]*translate\(-50%, calc\(-50% - 6px\)\)/);
});

test('the tracked mode label is centered by its visible lettering', () => {
  assert.match(index, /<p class="counter-mode"><span id="modeTitle">LIFE<\/span><\/p>/);
  assert.match(styles, /\.counter-mode > #modeTitle \{ margin-right: -\.16em; margin-left: \.16em; \}/);
  assert.match(styles, /#gameView\[data-interface-style="dial"\] \.counter-readout \.counter-mode \{ position: absolute; top: calc\(var\(--dial-center-y\) - min\(22vw, 88px\)\); left: 50%; width: 100%; margin: 0; transform: translateX\(-50%\); \}/);
});
