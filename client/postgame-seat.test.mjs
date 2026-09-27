import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');

test('a shared-table phone returns to its claimed card before its personal accolade is revealed', () => {
  assert.match(app, /if \(key !== shownVictoryKey && !state\.localSimulation && state\.activePlayerId !== state\.ownerPlayerId\) \{\s+state\.activePlayerId = state\.ownerPlayerId;\s+render\(\);\s+return;/);
});
