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

test('next-game setup owns a separate screen instead of sharing the live counter', () => {
  assert.match(page, /<section id="intermissionView" class="view setup-shell intermission-screen" hidden/);
  assert.match(page, /<section id="intermissionView"[\s\S]*id="intermissionPanel"/);
  const gameView = page.match(/<section id="gameView"[\s\S]*?<\/section>\s*<\/main>/)?.[0] || '';
  assert.doesNotMatch(gameView, /id="intermissionPanel"/);
  assert.match(app, /intermission: \$\('#intermissionView'\)/);
  assert.match(app, /function tableViewForState\(\) \{[\s\S]*lifecycle\?\.status === 'intermission'[\s\S]*return dom\.intermission/);
  assert.match(app, /function showTableView\(\) \{ showView\(tableViewForState\(\)\); \}/);
});

test('intermission supports self-service leaving and host invitations', () => {
  assert.match(page, /id="intermissionLeaveButton"[^>]*>Leave table/);
  assert.match(page, /id="intermissionLeaveDialog"/);
  assert.match(page, /id="copyIntermissionJoinLinkButton"/);
  assert.match(page, /id="showIntermissionJoinQrButton"/);
  assert.match(app, /async function leaveNextGameTable\(\)/);
  assert.match(app, /transport\.leaveIntermission\(\)/);
  assert.match(app, /!handoff\.automatic/);
  assert.match(transport, /async leaveIntermission\(\)/);
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

test('the end-game flow uses distinct winner, accolade, achievement, and ready stages', () => {
  assert.match(app, /const automaticSavePromises = new Map\(\); const dismissedVictoryKeys = new Set\(\);/);
  assert.match(app, /automaticSavePromises\.set\(key, saving\);/);
  assert.match(app, /function advanceEndGameFlow\(key\)/);
  assert.match(app, /victoryStage === 'winner'/);
  assert.match(app, /victoryStage = 'accolade';/);
  assert.match(app, /if \(!showAchievementUnlocks\(key\)\) void beginIntermission\(key\);/);
  assert.match(app, /dom\.achievementDialog\.addEventListener\('close'[\s\S]*?void beginIntermission\(gameKey\)/);
  assert.match(page, /id="victoryDialog"[^>]*data-stage/);
  assert.match(page, /id="personalMatchMoment"/);
  assert.doesNotMatch(page, /id="nextGameButton"/);
});
