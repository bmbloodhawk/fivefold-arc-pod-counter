import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const styles = await readFile(new URL('./styles.css', import.meta.url), 'utf8');

test('game menu uses a protected outside-tap layer above live dial controls', () => {
  assert.match(app, /function closeGameMenu\(\)/);
  assert.match(html, /id="gameMenuBackdrop" class="game-menu-backdrop" hidden/);
  assert.match(app, /dom\.gameMenuBackdrop\.addEventListener\('pointerdown', event => event\.stopPropagation\(\)\)/);
  assert.match(app, /dom\.gameMenuBackdrop\.addEventListener\('click', event => \{ event\.preventDefault\(\); event\.stopPropagation\(\); closeGameMenu\(\); \}\)/);
  assert.match(styles, /\.game-menu-backdrop \{ position: fixed; z-index: 59;/);
  assert.match(styles, /#moreButton \{ z-index: 60; \}/);
  assert.match(styles, /\.game-menu \{ z-index: 61; \}/);
});
