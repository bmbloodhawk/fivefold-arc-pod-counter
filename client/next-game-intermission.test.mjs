import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

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

for (const { name, moment, earned, title } of [
  { name: 'a routine result', moment: { kind: 'recap', title: 'Game complete', line: 'Your table finished the game.', fact: '45 min' }, earned: true, title: 'Arc Complete' },
  { name: 'an unavailable match moment', moment: null, earned: false, title: 'Arc Complete' },
  { name: 'a standout result', moment: { kind: 'accolade', title: 'Phoenix Return', category: 'Phoenix Return', fact: 'Lowest life: 4 · +15 recovered' }, earned: true, title: 'Phoenix Return' },
]) {
  test(name + ' shows an accolade before any achievement or next-game setup', async () => {
    const key = 'completed-game';
    const events = [];
    const hint = { textContent: '' };
    const dom = {
      victoryDialog: { open: true, dataset: { stage: 'winner' }, setAttribute() {}, close() { this.open = false; } },
      achievementDialog: { open: false },
      personalMatchMoment: { hidden: true, toggleAttribute() {} },
      personalMatchMomentTitle: {}, personalMatchMomentLine: {}, personalMatchMomentFact: {},
      personalMatchArt: { dataset: {}, style: {} },
    };
    const context = {
      dom, state: { gameResult: { gameId: key } }, victoryStage: 'winner',
      victoryKey: result => result.gameId, accoladeArtUrl: name => name,
      dismissedVictoryKeys: new Set(), automaticSavePromises: new Map(), personalMomentPromises: new Map(),
      $: () => hint,
      showAchievementUnlocks() {
        if (earned) events.push('achievement');
        return earned;
      },
      beginIntermission() { events.push('next game'); },
    };
    const start = app.indexOf('function showPersonalMatchMoment(');
    const end = app.indexOf('async function loadSaveGameDecks(', start);
    const flow = runInNewContext(app.slice(start, end) + '\n({ showPersonalMatchMoment, advanceEndGameFlow })', context);

    if (moment) flow.showPersonalMatchMoment(moment);
    flow.advanceEndGameFlow(key);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(dom.victoryDialog.dataset.stage, 'accolade');
    assert.equal(dom.personalMatchMomentTitle.textContent, title);
    assert.deepEqual(events, []);

    flow.advanceEndGameFlow(key);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(dom.victoryDialog.open, false);
    assert.deepEqual(events, [earned ? 'achievement' : 'next game']);
  });
}

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
