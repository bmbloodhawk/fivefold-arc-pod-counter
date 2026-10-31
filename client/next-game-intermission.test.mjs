import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [app, page, transport] = await Promise.all([
  readFile(new URL('./app.js', import.meta.url), 'utf8'),
  readFile(new URL('./index.html', import.meta.url), 'utf8'),
  readFile(new URL('./realtime.js', import.meta.url), 'utf8'),
]);

test('next-game setup is a distinct ready state with host start controls', () => {
  assert.match(page, /id="lobbyView"/);
  assert.match(page, /id="lobbySeatStatus"/);
  assert.match(app, /function showCurrentTableView\(\)/);
  assert.match(app, /showView\(lifecycleStatus === 'lobby' \? dom\.lobby : dom\.game\)/);
  assert.match(page, /id="intermissionPanel"/);
  assert.match(page, /id="intermissionReadyButton"/);
  assert.match(app, /const isIntermission = lifecycleStatus === 'intermission';/);
  assert.match(app, /dom\.intermissionReadyButton\.addEventListener\('click', \(\) => void setNextGameReady\(\)\)/);
  assert.match(app, /dom\.postGameNextGameButton\.addEventListener\('click'.*void beginIntermission\(\)/);
  assert.match(page, /id="nextGameConfirmDialog"/);
  assert.match(page, /id="lobbyRoster"/);
  assert.match(app, /data-move-seat/);
  assert.match(app, /async function moveNextGameSeat\(seatId, direction\)/);
  assert.match(app, /async function confirmNextGameStart\(\)/);
  assert.match(app, /await transport\.refreshRoom\(\)/);
  assert.match(app, /Waiting for every player/);
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

test('achievement reveals wait for the personal match moment dismissal and then offer a next step', () => {
  assert.match(app, /const automaticSavePromises = new Map\(\); const dismissedVictoryKeys = new Set\(\);/);
  assert.match(app, /automaticSavePromises\.set\(key, saveGameToHistory\(\{ automatic: true, gameKey: key \}\)\);/);
  assert.match(app, /async function showPersonalMatchMoment\(gameKey\)/);
  assert.match(app, /async function continueAfterRewards\(gameKey\)/);
  assert.match(app, /if \(!showAchievementUnlocks\(gameKey\)\) showPostGameChoices\(\);/);
  assert.match(page, /id="postGameDialog"/);
});

test('local alternate eliminations declare the last remaining player', () => {
  assert.match(app, /player\.alternateElimination = \{ reason, detail: detail \|\| null \}; state\.players\.forEach\(evaluatePlayer\); localLastPlayerStanding\(\); render\(\);/);
  assert.doesNotMatch(app, /evaluateLocalVictory\(/);
});
