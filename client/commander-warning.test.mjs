import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

test('Commander near-lethal warnings keep the source and danger label on separate lines', () => {
  assert.match(app, /function renderStatusMessage\(status/);
  assert.match(app, /status\.endsWith\(' NEAR LETHAL'\)/);
  assert.match(app, /detail\.textContent = 'NEAR LETHAL'/);
  assert.match(styles, /\.status-message\.commander-near-lethal \{[\s\S]*white-space: normal;/);
  assert.match(styles, /\.status-message\.commander-near-lethal > span \{ display: block; \}/);
});
