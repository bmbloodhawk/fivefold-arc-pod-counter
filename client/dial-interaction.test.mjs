import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');

test('the full visible dial starts a drag without covering the side tap zones', () => {
  assert.match(styles, /\.dial-controls \{ position: absolute; z-index: 5;[\s\S]*pointer-events: auto; touch-action: none;/);
  assert.match(styles, /\.dial-gesture \{[\s\S]*z-index: 2;[\s\S]*width: min\(79vw, 310px\);[\s\S]*height: min\(79vw, 310px\);[\s\S]*pointer-events: auto;[\s\S]*transform: translate\(-50%, -50%\);/);
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
