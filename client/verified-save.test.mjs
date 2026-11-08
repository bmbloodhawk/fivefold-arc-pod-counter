import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';

const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const segment = (from, to) => app.slice(app.indexOf(from), app.indexOf(to));
const source = segment('function victoryKey(', 'function winnerFromResult(') +
  segment('function resetAwardProfile(', 'function renderSavedTables(');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function browserFixture({ accountToken = async () => 'test-profile' } = {}) {
  const requests = [];
  const unlocked = new Map();
  const context = createContext({
    state: { podCode: 'ABC123', gameResult: { gameId: 'completed-first', saveEligible: true } },
    selectedDeckId: 'deck-first',
    transport: { seatId: 1, connectionId: 'seat-connection', sessionEpoch: 1 },
    dom: { saveGameButton: {}, victoryDialog: { open: true } },
    currentAccountToken: accountToken,
    googleAccountToken: async () => 'test-profile',
    savedGameKey: null, savingGameKey: null, savedGameMoment: null, awardProfileEpoch: 0,
    unlockedAchievementsByGame: unlocked, dismissedVictoryKeys: new Set(),
    async fetch(path, options) {
      requests.push({ path, headers: options.headers, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ moment: { id: 'late-chapter' }, unlockedAchievements: [{ id: 'settling-in' }] }) };
    },
  });
  runInContext(source, context);
  return { context, requests, unlocked, save: () => runInContext('saveGameToHistory({ automatic: true })', context) };
}

test('an automatic save sends the pinned completion reference and seat credential once', async () => {
  const browser = browserFixture();
  await Promise.all([browser.save(), browser.save()]);
  assert.equal(browser.requests.length, 1);
  const request = browser.requests[0];
  assert.equal(request.path, '/api/account/games');
  assert.equal(request.headers['x-connection-id'], 'seat-connection');
  assert.deepEqual(request.body, { roomCode: 'ABC123', gameId: 'completed-first', deckId: 'deck-first' });
  assert.equal(browser.unlocked.get('completed-first')[0].id, 'settling-in');
});

test('switching rooms while the account token resolves cancels that save', async () => {
  const token = deferred();
  const browser = browserFixture({ accountToken: () => token.promise });
  const pending = browser.save();
  browser.context.state = { podCode: 'DEF456', gameResult: { gameId: 'completed-second', saveEligible: true } };
  browser.context.transport.sessionEpoch++;
  browser.context.transport.connectionId = 'other-seat-connection';
  token.resolve('test-profile');
  assert.equal(await pending, null);
  assert.deepEqual(browser.requests, []);
});

test('the same seat may finish a late save after the next result without showing its reveal on the new game', async () => {
  const token = deferred();
  const browser = browserFixture({ accountToken: () => token.promise });
  const pending = browser.save();
  browser.context.state.gameResult = { gameId: 'completed-second', saveEligible: true };
  browser.context.selectedDeckId = 'deck-second';
  token.resolve('test-profile');
  assert.equal(await pending, null);
  assert.equal(browser.requests[0].body.gameId, 'completed-first');
  assert.equal(browser.requests[0].body.deckId, 'deck-first');
  assert.equal(browser.unlocked.size, 0);
});

test('changing profiles cancels a pending automatic save and clears old reveal state', async () => {
  const token = deferred();
  const browser = browserFixture({ accountToken: () => token.promise });
  const pending = browser.save();
  browser.unlocked.set('old-game', [{ id: 'old-award' }]);
  runInContext('resetAwardProfile()', browser.context);
  token.resolve('first-profile');
  assert.equal(await pending, null);
  assert.equal(browser.requests.length, 0);
  assert.equal(browser.unlocked.size, 0);
});
