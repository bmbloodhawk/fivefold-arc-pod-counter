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
  assert.match(app, /data-move-next-seat/);
  assert.match(app, /async function moveNextGameSeat\(seatId, direction\)/);
  assert.match(transport, /async beginIntermission\(\) \{ return this\.\#hostGameRequest\('\/begin-intermission'\); \}/);
  assert.match(transport, /async reorderNextGameSeats\(seatIds\) \{ return this\.\#hostGameRequest\('\/next-game-reorder', \{ seatIds \}\); \}/);
});

test('pod setup separates first-game players from future seat capacity', () => {
  assert.match(page, /Players for game one/);
  assert.match(page, /id="seatCapacity" name="seatCapacity"/);
  for (const capacity of [2, 3, 4, 5, 6, 7, 8]) assert.match(page, new RegExp(`<option value="${capacity}"`));
  assert.match(app, /function syncSeatCapacityChoices\(\)/);
  assert.match(app, /option\.disabled = Number\(option\.value\) < players/);
  assert.match(app, /const seatCapacity = Number\(form\.get\('seatCapacity'\)\);/);
  assert.match(transport, /async createRoom\(\{ playerCount, seatCapacity = playerCount,/);
});

test('achievement reveals wait for the personal match moment dismissal and its save', () => {
  assert.match(app, /const automaticSavePromises = new Map\(\); const dismissedVictoryKeys = new Set\(\);/);
  assert.match(app, /automaticSavePromises\.set\(key, saveGameToHistory\(\{ automatic: true, gameKey: key \}\)\);/);
  assert.match(app, /dismissedVictoryKeys\.add\(key\); void \(async \(\) => \{ await automaticSavePromises\.get\(key\); if \(!showAchievementUnlocks\(key\)\) openQuickFeedback\(\); \}\)\(\);/);
});
