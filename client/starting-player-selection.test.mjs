import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');

test('the lobby retains a host draft first-player choice through a re-render', () => {
  assert.match(app, /let pendingStartingSeatId = null;/);
  assert.match(app, /dom\.startingSeat\.value = String\(pendingStartingSeatId \?\? authoritativeSeatId\);/);
  assert.match(app, /dom\.startingSeat\.addEventListener\('change', \(\) => \{ pendingStartingSeatId = Number\(dom\.startingSeat\.value\); renderTurnFlow\(\); \}\)/);
  assert.match(app, /chooseStartingPlayer\(pendingStartingSeatId \?\? Number\(dom\.startingSeat\.value\)\)/);
  assert.match(app, /pendingStartingSeatId = null;\s*if \(transport\.status === 'local'\)/);
});
