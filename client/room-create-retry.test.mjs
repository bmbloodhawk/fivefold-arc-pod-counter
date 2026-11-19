import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomService, createRealtimeServer } from '../server/src/app.js';
import { MemoryPlaytestLedger } from '../server/src/playtest-ledger.js';
import { RealtimeAdapter } from './realtime.js';

const config = overrides => ({ playerCount: 2, startingLife: 40, ...overrides });
class FakeEventSource { constructor() {} addEventListener() {} close() {} }

function fixture(t, outcomes = []) {
  const keys = ['fetch', 'localStorage', 'document', 'EventSource', 'setInterval', 'clearInterval'];
  const originals = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const service = new RoomService(), storage = new Map(), posts = [], connections = [];
  globalThis.document = { visibilityState: 'visible' };
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  globalThis.EventSource = FakeEventSource;
  globalThis.setInterval = () => ({});
  globalThis.clearInterval = () => {};
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body), path = new URL(url).pathname;
    if (path === '/api/connections') {
      const result = service.createConnection(body);
      connections.push(result.connectionId);
      return Response.json(result, { status: 201 });
    }
    assert.equal(path, '/api/rooms');
    const request = { body, connection: options.headers['X-Connection-Id'], authorization: options.headers.Authorization };
    posts.push(request);
    const outcome = outcomes.shift();
    if (typeof outcome === 'number') return Response.json({ error: { code: 'FIXTURE_REJECTION', message: 'Rejected creation' } }, { status: outcome });
    let result;
    try { result = service.createRoom(request.connection, body); }
    catch (error) { return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status || 500 }); }
    if (typeof outcome === 'function') await outcome(result);
    if (outcome === 'lost') throw new TypeError('Fixture dropped the accepted creation response');
    if (outcome === 'body-lost') return new Response('{"snapshot":', { status: 201, headers: { 'content-type': 'application/json' } });
    return Response.json(result, { status: 201 });
  };
  const adapter = new RealtimeAdapter({ apiBase: 'https://fixture.invalid' });
  t.after(() => {
    adapter.clearSession();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  return { adapter, service, storage, posts, connections, outcomes };
}

test('a lost accepted creation response retries once with the same connection, body, and credentials', async t => {
  const f = fixture(t, ['lost']);
  const result = await f.adapter.createRoom(config({ accountToken: 'fixture-account-A' }));
  assert.equal(f.connections.length, 1);
  assert.equal(f.posts.length, 2);
  assert.deepEqual(f.posts[1], f.posts[0]);
  assert.equal(f.posts[0].authorization, 'Bearer fixture-account-A');
  assert.match(f.posts[0].body.operationId, /^[A-Za-z0-9_-]{16,128}$/);
  assert.equal(f.service.rooms.size, 1);
  assert.equal(f.adapter.roomCode, result.snapshot.code);
  assert.equal(f.storage.get(`fivefold-arc:reclaim:${result.snapshot.code}:0`), result.reclaimToken);
  assert.equal(f.storage.get(`fivefold-arc:host-recovery:${result.snapshot.code}`), result.hostRecoveryKey);
});

test('two lost responses remain bounded and a same-input manual retry recovers the original table', async t => {
  const f = fixture(t, ['lost', 'lost']);
  await assert.rejects(f.adapter.createRoom(config()), /could not be reached/);
  assert.equal(f.posts.length, 2);
  assert.equal(f.adapter.roomCode, null);
  const originalCode = [...f.service.rooms.keys()][0];
  const result = await f.adapter.createRoom(config());
  assert.equal(f.connections.length, 1);
  assert.equal(f.posts.length, 3);
  assert.deepEqual(f.posts[2], f.posts[0]);
  assert.equal(result.snapshot.code, originalCode);
  assert.equal(f.service.rooms.size, 1);
});

test('an interrupted successful response body also retries the original creation safely', async t => {
  const f = fixture(t, ['body-lost']);
  const result = await f.adapter.createRoom(config());
  assert.equal(f.posts.length, 2);
  assert.deepEqual(f.posts[1], f.posts[0]);
  assert.equal(f.service.rooms.size, 1);
  assert.equal(f.adapter.roomCode, result.snapshot.code);
});

test('an HTTP recovery-save failure retains the original creation for a later explicit retry', async t => {
  const fetchImpl = globalThis.fetch, f = fixture(t), ledger = new MemoryPlaytestLedger();
  let rejectSave = true, posts = 0;
  ledger.waitForRecovery = async () => { if (rejectSave) throw new Error('Fixture recovery save failed'); };
  const { server, service } = createRealtimeServer({ appEnv: 'staging', ledger });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  f.adapter.apiBase = `http://127.0.0.1:${server.address().port}`;
  globalThis.fetch = (url, options) => { if (new URL(url).pathname === '/api/rooms') posts++; return fetchImpl(url, options); };
  await assert.rejects(f.adapter.createRoom(config()), { status: 503, code: 'RECOVERY_SAVE_FAILED' });
  assert.equal(posts, 1, 'a definite save failure is never retried automatically');
  assert.equal(service.rooms.size, 1);
  const connection = [...service.connections.values()][0], original = connection.createdRoom;
  rejectSave = false;
  const replay = await f.adapter.createRoom(config());
  assert.equal(posts, 2);
  assert.equal(service.connections.size, 1);
  assert.equal(service.rooms.size, 1);
  assert.equal(replay.snapshot.code, original.code);
  assert.equal(replay.reclaimToken, original.reclaimToken);
  assert.equal(replay.hostRecoveryKey, original.hostRecoveryKey);
});

for (const status of [400, 401, 403, 409, 503]) {
  test(`a definite HTTP ${status} failure is not retried and retires that creation intent`, async t => {
    const f = fixture(t, [status]);
    await assert.rejects(f.adapter.createRoom(config()), { status });
    assert.equal(f.posts.length, 1);
    await f.adapter.createRoom(config());
    assert.equal(f.connections.length, 2);
    assert.notEqual(f.posts[1].body.operationId, f.posts[0].body.operationId);
  });
}

for (const changed of [{ name: 'New host' }, { accountToken: 'fixture-account-B' }]) {
  test(`changing ${Object.keys(changed)[0]} starts a distinct intent after an uncertain response`, async t => {
    const f = fixture(t, ['lost', 'lost']);
    await assert.rejects(f.adapter.createRoom(config({ accountToken: 'fixture-account-A' })), /could not be reached/);
    const firstCode = [...f.service.rooms.keys()][0];
    const result = await f.adapter.createRoom(config({ accountToken: 'fixture-account-A', ...changed }));
    assert.equal(f.connections.length, 2);
    assert.notEqual(f.posts[2].body.operationId, f.posts[0].body.operationId);
    assert.notEqual(result.snapshot.code, firstCode);
  });
}

for (const method of ['clearSession', 'useLocal', 'disconnect']) {
  test(`${method} retires uncertain creation before another same-input attempt`, async t => {
    const f = fixture(t, ['lost', 'lost']);
    await assert.rejects(f.adapter.createRoom(config()), /could not be reached/);
    f.adapter[method]();
    await f.adapter.createRoom(config());
    assert.equal(f.connections.length, 2);
    assert.notEqual(f.posts[2].body.operationId, f.posts[0].body.operationId);
  });
}

test('a session cancelled before its lost response cannot retry or adopt the old table', async t => {
  const gate = Promise.withResolvers(), entered = Promise.withResolvers();
  const f = fixture(t, [async () => { entered.resolve(); await gate.promise; throw new TypeError('Lost after cancellation'); }]);
  const pending = f.adapter.createRoom(config());
  await entered.promise;
  f.adapter.clearSession();
  gate.resolve();
  assert.deepEqual(await pending, { ignored: true });
  assert.equal(f.posts.length, 1);
  assert.equal(f.adapter.roomCode, null);
  assert.equal(f.storage.size, 1, 'only the non-secret device identifier may be stored');
});

test('concurrent same-input calls share the creation intent and freeze nested input before sending', async t => {
  const gate = Promise.withResolvers(), entered = Promise.withResolvers();
  const f = fixture(t, [async () => { entered.resolve(); await gate.promise; throw new TypeError('Fixture lost first response'); }]);
  const draft = config({ commanderNames: ['First name'], commanderColors: [['G']] });
  const first = f.adapter.createRoom(draft), second = f.adapter.createRoom(draft);
  await entered.promise;
  draft.commanderNames[0] = 'Edited later'; draft.commanderColors[0].push('R');
  gate.resolve();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.snapshot.code, b.snapshot.code);
  assert.equal(f.connections.length, 1);
  assert.equal(f.posts.length, 2);
  assert.deepEqual(f.posts[1].body.commanderNames, ['First name']);
  assert.deepEqual(f.posts[1].body.commanderColors, [['G']]);
});
