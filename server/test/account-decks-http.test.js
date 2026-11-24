import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountHistory, MemoryAccountHistoryStore } from '../src/account-history.js';
import { createRealtimeServer } from '../src/app.js';

const PATH = '/api/account/decks';
const ORIGIN = 'https://phone.example.test';
const NOW = Date.UTC(2026, 10, 23, 12);
const paired = {
  commanderNames: ['Thrasios, Triton Hero', 'Tymna the Weaver'],
  commanderColors: [['G', 'U', 'U'], ['W', 'B']],
  name: '  Connected   Engines ', colors: ['W', 'U', 'B', 'G', 'U'],
  notes: ' Private   opening plan ', favorite: true,
};

async function fixture(t) {
  let id = 0;
  const store = new MemoryAccountHistoryStore();
  const history = new AccountHistory({ store, now: () => NOW, createId: () => `fixture-${++id}` });
  const alice = await history.ensureAccount('alice');
  const bob = await history.ensureAccount('bob');
  const verified = [];
  const { server } = createRealtimeServer({
    appEnv: 'local', allowedOrigin: ORIGIN, accountHistory: history,
    accountVerifier: { async verify(token) {
      verified.push(token);
      if (!['alice', 'bob'].includes(token)) throw Object.assign(new Error('Fixture sign-in required'), {
        status: 401, code: 'SIGN_IN_REQUIRED',
      });
      return { providerSubject: token };
    } },
    lookupCommanderIdentity: async () => null,
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const request = async (path = PATH, { method = 'GET', token = 'alice', body, rawBody, headers = {} } = {}) => {
    const payload = rawBody === undefined ? body === undefined ? undefined : JSON.stringify(body) : rawBody;
    const response = await fetch('http://127.0.0.1:' + server.address().port + path, {
      method,
      headers: {
        ...(token === null ? {} : { authorization: 'Bearer ' + token }),
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }), ...headers,
      },
      ...(payload === undefined ? {} : { body: payload }),
    });
    const text = await response.text();
    return { response, status: response.status, text, data: text ? JSON.parse(text) : null };
  };
  return { request, history, store, alice, bob, verified };
}

const operations = [
  { method: 'GET', path: id => PATH },
  { method: 'POST', path: id => PATH },
  { method: 'PATCH', path: id => PATH + '/' + id },
  { method: 'DELETE', path: id => PATH + '/' + id },
];
const snapshot = store => structuredClone([...store.values]);
function assertHeaders(response) {
  assert.equal(response.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('permissions-policy'), 'camera=(self), microphone=(), geolocation=()');
}

for (const operation of operations) for (const token of [null, 'invalid']) {
  test(`${operation.method} decks rejects ${token === null ? 'missing' : 'invalid'} authentication before reading a body`, async t => {
    const f = await fixture(t);
    const deck = await f.history.createDeck(f.alice, paired);
    const before = snapshot(f.store);
    const result = await f.request(operation.path(deck.deckId), {
      method: operation.method, token, ...(operation.method === 'GET' ? {} : { rawBody: '{invalid' }),
    });
    assert.equal(result.status, 401);
    assert.equal(result.data.error.code, 'SIGN_IN_REQUIRED');
    assertHeaders(result.response);
    assert.match(result.response.headers.get('cache-control'), /no-store/);
    assert.deepEqual(snapshot(f.store), before);
  });
}

for (const operation of operations) {
  test(`${operation.method} decks preserves the global spectator-header denial before account access`, async t => {
    const f = await fixture(t);
    const deck = await f.history.createDeck(f.alice, paired);
    const before = snapshot(f.store);
    const result = await f.request(operation.path(deck.deckId), {
      method: operation.method, headers: { 'x-event-viewer-token': 'fixture-viewer' },
      ...(operation.method === 'GET' ? {} : { rawBody: '{invalid' }),
    });
    assert.equal(result.status, 403);
    assert.equal(result.data.error.code, 'SPECTATOR_READ_ONLY');
    assert.deepEqual(f.verified, [], 'The outer spectator guard runs before account verification.');
    assertHeaders(result.response);
    assert.deepEqual(snapshot(f.store), before);
  });
}

test('HTTP deck CRUD retains paired identities, private notes, favorites and archive response shapes', async t => {
  const f = await fixture(t);
  const created = await f.request(PATH, { method: 'POST', body: paired });
  assert.equal(created.status, 201);
  const deck = created.data.deck;
  assert.match(deck.deckId, /^deck_[A-Za-z0-9-]+$/);
  assert.deepEqual(created.data, { deck: {
    deckId: deck.deckId, commanderName: paired.commanderNames.join(' / '), commanderNames: paired.commanderNames,
    commanderColors: [['G', 'U'], ['W', 'B']], name: 'Connected Engines', colors: ['W', 'U', 'B', 'G'],
    notes: 'Private opening plan', favorite: true, createdAt: NOW, updatedAt: NOW,
  } });
  assertHeaders(created.response);
  assert.match(created.response.headers.get('cache-control'), /no-store/);
  assert.deepEqual((await f.request()).data, { decks: [deck] });
  const changed = await f.request(PATH + '/' + deck.deckId, {
    method: 'PATCH', body: { favorite: false, notes: ' Updated   private plan ', archived: true },
  });
  assert.equal(changed.status, 200);
  const archived = { ...deck, favorite: false, notes: 'Updated private plan', archived: true };
  assert.deepEqual(changed.data, { deck: archived });
  assert.deepEqual((await f.request()).data, { decks: [] });
  assert.deepEqual((await f.request(PATH + '?archived=true')).data, { decks: [] });
  assert.deepEqual((await f.request(PATH + '?archived=all')).data, { decks: [archived] });
  const restored = await f.request(PATH + '/' + deck.deckId, { method: 'PATCH', body: { archived: false, favorite: true } });
  assert.deepEqual(restored.data, { deck: { ...archived, archived: false, favorite: true } });
  const removed = await f.request(PATH + '/' + deck.deckId, { method: 'DELETE' });
  assert.equal(removed.status, 204); assert.equal(removed.text, '');
  assert.equal((await f.request(PATH + '/' + deck.deckId, { method: 'DELETE' })).status, 204);
  assert.deepEqual((await f.request(PATH + '?archived=all')).data, { decks: [] });
});

test('account identity controls lists and foreign update/delete attempts leave both owners unchanged', async t => {
  const f = await fixture(t);
  const owner = (await f.request(PATH, { method: 'POST', body: paired })).data.deck;
  const other = (await f.request(PATH, { method: 'POST', token: 'bob', body: { commanderName: 'Krenko', notes: 'Bob private note' } })).data.deck;
  const before = snapshot(f.store);
  const listed = await f.request(PATH + '?archived=all&accountId=' + f.alice, { token: 'bob' });
  assert.deepEqual(listed.data, { decks: [other] });
  assert.equal(listed.text.includes('Private opening plan'), false);
  const changed = await f.request(PATH + '/' + owner.deckId, { method: 'PATCH', token: 'bob', body: { notes: 'Overwrite attempted', favorite: false } });
  assert.equal(changed.status, 500, 'Existing domain TypeErrors are masked by the outer HTTP handler.');
  assert.deepEqual(changed.data, { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  assert.ok(changed.response.headers.get('x-request-id'));
  const removed = await f.request(PATH + '/' + owner.deckId, { method: 'DELETE', token: 'bob' });
  assert.equal(removed.status, 204, 'A foreign valid deck ID is currently an idempotent no-op.');
  assert.deepEqual(snapshot(f.store), before);
  assert.deepEqual((await f.request()).data, { decks: [owner] });
});

test('invalid deck domain inputs preserve stored state and retain the current masked error contract', async t => {
  const f = await fixture(t);
  const deck = (await f.request(PATH, { method: 'POST', body: paired })).data.deck;
  const before = snapshot(f.store);
  const cases = [
    ['POST', PATH, { commanderNames: [] }],
    ['POST', PATH, { ...paired, colors: ['Orange'] }],
    ['POST', PATH, { ...paired, accountId: f.bob }],
    ['PATCH', PATH + '/' + deck.deckId, { commanderNames: ['A', 'B', 'C'] }],
    ['PATCH', PATH + '/' + deck.deckId, { commanderColors: [['R']] }],
    ['PATCH', PATH + '/' + deck.deckId, { favorite: 'yes' }],
    ['PATCH', PATH + '/' + deck.deckId, { archived: 'yes' }],
    ['PATCH', PATH + '/' + deck.deckId, { notes: 'Invalid\u0000note' }],
    ['DELETE', PATH + '/not-a-deck', undefined],
  ];
  for (const [method, path, body] of cases) {
    const result = await f.request(path, { method, body });
    assert.equal(result.status, 500, JSON.stringify({ method, body }));
    assert.deepEqual(result.data, { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
    assert.ok(result.response.headers.get('x-request-id'));
    assert.deepEqual(snapshot(f.store), before);
  }
});

test('POST and PATCH keep explicit JSON syntax and body-size errors without changing decks', async t => {
  const f = await fixture(t);
  const deck = await f.history.createDeck(f.alice, paired);
  const before = snapshot(f.store);
  for (const method of ['POST', 'PATCH']) {
    const path = method === 'POST' ? PATH : PATH + '/' + deck.deckId;
    const invalid = await f.request(path, { method, rawBody: '{invalid' });
    assert.equal(invalid.status, 400); assert.equal(invalid.data.error.code, 'INVALID_JSON');
    const oversized = await f.request(path, { method, body: { notes: 'x'.repeat(33 * 1024) } });
    assert.equal(oversized.status, 413); assert.equal(oversized.data.error.code, 'BODY_TOO_LARGE');
  }
  assert.deepEqual(snapshot(f.store), before);
});

test('the outer handler retains CORS preflight and masks unexpected storage errors', async t => {
  const f = await fixture(t);
  const before = snapshot(f.store);
  const preflight = await f.request(PATH, { method: 'OPTIONS', token: null });
  assert.equal(preflight.status, 204); assert.equal(preflight.text, '');
  assertHeaders(preflight.response);
  assert.match(preflight.response.headers.get('access-control-allow-methods'), /PATCH/);
  assert.match(preflight.response.headers.get('access-control-allow-headers'), /authorization/);
  assert.deepEqual(f.verified, []);
  const actualWrite = f.store.write.bind(f.store);
  f.store.write = async (path, value) => {
    if (path.startsWith('account-history/decks/')) throw new Error('Synthetic private storage detail');
    return actualWrite(path, value);
  };
  const failed = await f.request(PATH, { method: 'POST', body: paired });
  assert.equal(failed.status, 500);
  assert.deepEqual(failed.data, { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  assert.ok(failed.response.headers.get('x-request-id'));
  assert.equal(failed.text.includes('Synthetic private storage detail'), false);
  assertHeaders(failed.response);
  assert.match(failed.response.headers.get('cache-control'), /no-store/);
  assert.deepEqual(snapshot(f.store), before);
});

test('current path matching stays exact for collection routes and preserves filtered item segments and encoded IDs', async t => {
  const f = await fixture(t);
  const deck = await f.history.createDeck(f.alice, paired);
  for (const method of ['GET', 'POST']) {
    const result = await f.request(PATH + '/', { method, ...(method === 'POST' ? { body: paired } : {}) });
    assert.equal(result.status, 404);
  }
  const encoded = PATH + '/%64' + deck.deckId.slice(1);
  assert.equal((await f.request(encoded, { method: 'PATCH', body: { favorite: false } })).status, 500);
  assert.equal((await f.request(encoded, { method: 'DELETE' })).status, 500);
  assert.deepEqual((await f.request()).data, { decks: [deck] });
  const extraPath = '/api/account//decks/' + deck.deckId + '/extra';
  const changed = await f.request(extraPath, { method: 'PATCH', body: { favorite: false } });
  assert.equal(changed.status, 200); assert.equal(changed.data.deck.favorite, false);
  const removed = await f.request(extraPath, { method: 'DELETE', rawBody: '{ignored' });
  assert.equal(removed.status, 204); assert.equal(removed.text, '');
  assert.deepEqual((await f.request()).data, { decks: [] });
});

test('DELETE account games still reaches its neighboring route without removing saved decks', async t => {
  const f = await fixture(t);
  const deck = await f.history.createDeck(f.alice, paired);
  const game = await f.history.saveGame(f.alice, { tableSize: 2, won: true, deckId: deck.deckId });
  const otherGame = await f.history.saveGame(f.bob, { tableSize: 2, won: false });
  const otherBefore = structuredClone(await f.history.summary(f.bob));
  const removed = await f.request('/api/account/games/' + game.gameId, { method: 'DELETE' });
  assert.equal(removed.status, 204); assert.equal(removed.text, '');
  assert.equal((await f.history.summary(f.alice)).games.some(item => item.gameId === game.gameId), false);
  assert.deepEqual((await f.request()).data, { decks: [deck] });
  assert.deepEqual(await f.history.summary(f.bob), otherBefore);
  assert.ok(otherBefore.games.some(item => item.gameId === otherGame.gameId));
});
