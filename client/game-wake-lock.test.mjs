import assert from 'node:assert/strict';
import test from 'node:test';
import { GameWakeLock } from './game-wake-lock.js';

function visibleDocument() {
  const listeners = new Map();
  return {
    visibilityState: 'visible',
    addEventListener(type, listener) { listeners.set(type, listener); },
    emit(type) { listeners.get(type)?.(); },
  };
}

function wakeLockApi() {
  const sentinels = []; let requests = 0;
  return {
    navigatorRef: { wakeLock: { request: async () => {
      requests += 1;
      const listeners = new Map();
      const sentinel = { released: false, addEventListener(type, listener) { listeners.set(type, listener); }, async release() { this.released = true; listeners.get('release')?.(); } };
      sentinels.push(sentinel);
      return sentinel;
    } } },
    get requests() { return requests; }, sentinels,
  };
}

test('holds the visible screen awake only while the player has an active game', async () => {
  const documentRef = visibleDocument(); const api = wakeLockApi();
  const lock = new GameWakeLock({ navigatorRef: api.navigatorRef, documentRef });

  await lock.sync({ active: true, enabled: true });
  assert.equal(api.requests, 1);
  assert.equal(lock.active, true);

  await lock.sync({ active: false, enabled: true });
  assert.equal(api.sentinels[0].released, true);
  assert.equal(lock.active, false);
});

test('reacquires after a visible return when the player still wants an active-game wake lock', async () => {
  const documentRef = visibleDocument(); const api = wakeLockApi();
  const lock = new GameWakeLock({ navigatorRef: api.navigatorRef, documentRef });

  await lock.sync({ active: true, enabled: true });
  documentRef.visibilityState = 'hidden';
  documentRef.emit('visibilitychange');
  assert.equal(api.sentinels[0].released, true);
  documentRef.visibilityState = 'visible';
  documentRef.emit('visibilitychange');
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(api.requests, 2);
  assert.equal(lock.active, true);
});

test('does not request unsupported wake locks and releases immediately when disabled', async () => {
  const documentRef = visibleDocument(); const api = wakeLockApi();
  const lock = new GameWakeLock({ navigatorRef: api.navigatorRef, documentRef });
  await lock.sync({ active: true, enabled: true });
  await lock.sync({ active: true, enabled: false });
  assert.equal(api.sentinels[0].released, true);

  const unsupported = new GameWakeLock({ navigatorRef: {}, documentRef: visibleDocument() });
  await unsupported.sync({ active: true, enabled: true });
  assert.equal(unsupported.supported, false);
  assert.equal(unsupported.active, false);
});

test('coalesces pending requests and releases a lock granted after opt-out', async () => {
  const request = Promise.withResolvers();
  let requests = 0;
  const sentinel = { released: false, async release() { this.released = true; } };
  const navigatorRef = { wakeLock: { request() { requests += 1; return request.promise; } } };
  const lock = new GameWakeLock({ navigatorRef, documentRef: visibleDocument() });

  const first = lock.sync({ active: true, enabled: true });
  const second = lock.sync({ active: true, enabled: true });
  await lock.sync({ active: true, enabled: false });
  request.resolve(sentinel);
  await Promise.all([first, second]);

  assert.equal(requests, 1);
  assert.equal(sentinel.released, true);
  assert.equal(lock.active, false);
});

test('a denied request waits for a new foreground attempt', async () => {
  const documentRef = visibleDocument();
  let requests = 0;
  const navigatorRef = { wakeLock: { async request() { requests += 1; throw new Error('Denied'); } } };
  const lock = new GameWakeLock({ navigatorRef, documentRef });

  await lock.sync({ active: true, enabled: true });
  await lock.sync({ active: true, enabled: true });
  assert.equal(requests, 1);
  documentRef.visibilityState = 'hidden';
  documentRef.emit('visibilitychange');
  documentRef.visibilityState = 'visible';
  documentRef.emit('visibilitychange');
  assert.equal(requests, 2);
  assert.equal(lock.active, false);
});

test('a pending request interrupted by hiding retries on return', async () => {
  const documentRef = visibleDocument();
  const request = Promise.withResolvers();
  const api = wakeLockApi();
  const acquire = api.navigatorRef.wakeLock.request;
  let firstRequest = true;
  api.navigatorRef.wakeLock.request = () => {
    if (!firstRequest) return acquire();
    firstRequest = false;
    return request.promise;
  };
  const lock = new GameWakeLock({ navigatorRef: api.navigatorRef, documentRef });

  const pending = lock.sync({ active: true, enabled: true });
  documentRef.visibilityState = 'hidden';
  documentRef.emit('visibilitychange');
  documentRef.visibilityState = 'visible';
  documentRef.emit('visibilitychange');
  request.reject(new Error('Interrupted'));
  await pending;
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(api.requests, 1);
  assert.equal(lock.active, true);
});
