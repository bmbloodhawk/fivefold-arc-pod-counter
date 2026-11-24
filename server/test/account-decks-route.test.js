import assert from 'node:assert/strict';
import test from 'node:test';
import { accountDeckRoute } from '../src/account-decks-http.js';

function route(method, path, overrides = {}) {
  const url = new URL(path, 'http://localhost');
  return accountDeckRoute({
    req: { method }, url, parts: url.pathname.split('/').filter(Boolean),
    account: async () => 'owner', readBody: async () => ({ name: 'Saved deck' }),
    accountHistory: {}, ...overrides,
  });
}

test('unrelated and unsupported requests fall through without authentication or body reads', async () => {
  const forbidden = () => assert.fail('Unmatched routes must not touch account data');
  for (const [method, path] of [
    ['DELETE', '/api/account/games/game_1'], ['GET', '/api/account/history'],
    ['PUT', '/api/account/decks'], ['GET', '/api/account/decks/deck_1'],
    ['POST', '/api/account/decks/'], ['PATCH', '/api/account/decks'],
  ]) {
    assert.equal(await route(method, path, {
      account: forbidden, readBody: forbidden, accountHistory: new Proxy({}, { get: forbidden }),
    }), null, `${method} ${path}`);
  }
});

for (const [method, path, operation, expectedStatus, expectedData] of [
  ['POST', '/api/account/decks', 'createDeck', 201, { deck: { deckId: 'deck_saved' } }],
  ['PATCH', '/api/account/decks/deck_saved', 'updateDeck', 200, { deck: { deckId: 'deck_saved' } }],
  ['DELETE', '/api/account/decks/deck_saved', 'removeDeck', 204, {}],
]) {
  test(`${method} never acknowledges a write while the account operation is pending`, async () => {
    let release, entered;
    const gate = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    let settled = false;
    const response = route(method, path, { accountHistory: {
      async [operation]() { entered(); await gate; return { deckId: 'deck_saved' }; },
    } });
    void response.then(() => { settled = true; });
    await started;
    await Promise.resolve();
    assert.equal(settled, false);
    release();
    assert.deepEqual(await response, { status: expectedStatus, data: expectedData });
  });

  test(`${method} propagates a failed account operation to the shared HTTP error boundary`, async () => {
    const failure = new Error('Synthetic storage failure');
    await assert.rejects(route(method, path, { accountHistory: {
      async [operation]() { throw failure; },
    } }), error => error === failure);
  });
}
