import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');

test('game menu dismisses on an outside pointer press without treating its button as outside', () => {
  assert.match(app, /function closeGameMenu\(\)/);
  assert.match(app, /document\.addEventListener\('pointerdown', event => \{ if \(dom\.gameMenu\.hidden \|\| dom\.gameMenu\.contains\(event\.target\) \|\| dom\.moreButton\.contains\(event\.target\)\) return; closeGameMenu\(\); \}\)/);
});
