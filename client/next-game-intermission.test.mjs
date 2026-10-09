import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [app, page, transport] = await Promise.all([
  readFile(new URL('./app.js', import.meta.url), 'utf8'),
  readFile(new URL('./index.html', import.meta.url), 'utf8'),
  readFile(new URL('./realtime.js', import.meta.url), 'utf8'),
]);

test('next-game setup is a distinct ready state with host start controls', () => {
  assert.match(page, /id="intermissionPanel"/);
  assert.match(page, /id="intermissionReadyButton"/);
  assert.match(app, /const isIntermission = lifecycleStatus === 'intermission';/);
  assert.match(app, /dom\.intermissionReadyButton\.addEventListener\('click', \(\) => void setNextGameReady\(\)\)/);
  assert.match(app, /dom\.nextGameButton\.addEventListener\('click'.*void beginIntermission\(\)/);
  assert.match(transport, /async beginIntermission\(\) \{ return this\.\#hostGameRequest\('\/begin-intermission'\); \}/);
});

test('achievement reveals wait for the personal match moment dismissal and its save', () => {
  assert.match(app, /const automaticSavePromises = new Map\(\); const dismissedVictoryKeys = new Set\(\);/);
  assert.match(app, /automaticSavePromises\.set\(key, saveGameToHistory\(\{ automatic: true, gameKey: key \}\)\);/);
  assert.match(app, /dismissedVictoryKeys\.add\(key\); void \(async \(\) => \{ await automaticSavePromises\.get\(key\); if \(!showAchievementUnlocks\(key\)\) openQuickFeedback\(\); \}\)\(\);/);
});
