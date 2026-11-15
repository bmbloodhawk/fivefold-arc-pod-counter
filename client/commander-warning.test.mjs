import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('./dial-layout.css', import.meta.url), 'utf8');

test('Commander near-lethal warnings retain their source and danger label in one wrapping phrase', () => {
  assert.match(app, /function renderStatusMessage\(status/);
  assert.match(app, /status\.endsWith\(' NEAR LETHAL'\)/);
  assert.match(app, /detail\.textContent = 'NEAR LETHAL'/);
  assert.match(styles, /:is\(\.life-change-indicator, \.status-message\) \{[^}]*white-space: normal; overflow-wrap: anywhere;/);
  assert.match(styles, /\.status-message\.commander-near-lethal > span \{ display: inline; \}/);
  assert.match(styles, /\.status-warning-detail::before \{ content: " · "; \}/);
});
