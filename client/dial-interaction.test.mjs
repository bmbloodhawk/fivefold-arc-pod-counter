import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');

test('the full visible dial starts a drag without covering the side tap zones', () => {
  assert.match(styles, /\.dial-gesture \{[\s\S]*width: min\(79vw, 310px\);[\s\S]*height: min\(79vw, 310px\);[\s\S]*transform: translate\(-50%, -50%\);/);
  assert.match(styles, /\.dial-step \{ position: relative; z-index: 1;/);
  assert.match(styles, /\.dial-step-minus \{ grid-column: 1; \}/);
  assert.match(styles, /\.dial-step-plus \{ grid-column: 3; \}/);
  assert.match(app, /event\.target\.closest\('\[data-delta\]'\)/);
});
