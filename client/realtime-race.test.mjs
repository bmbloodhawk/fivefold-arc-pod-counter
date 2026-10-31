import assert from 'node:assert/strict';
import test from 'node:test';

function response(payload) { return { ok: true, json: async () => payload }; }

class FakeEventSource {
  static instances = [];
  constructor(url) { this.url = url; this.listeners = new Map(); this.closed = false; FakeEventSource.instances.push(this); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  close() { this.closed = true; }
  emit(type, event = {}) { this.listeners.get(type)?.(event); }
}

test('does not emit a second state event for an unchanged snapshot', async () => {
  const originals = Object.fromEntries(['fetch', 'EventSource', 'document', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    globalThis.document = { visibilityState: 'visible' };
    globalThis.EventSource = FakeEventSource;
    globalThis.localStorage = { getItem: () => null, setItem: () => {} };
    globalThis.fetch = async (url, options = {}) => {
      const path = new URL(url).pathname;
      if (path === '/api/connections') return response({ connectionId: 'connection-1' });
      if (path === '/api/rooms' && options.method === 'POST') return response({ snapshot: { code: 'POD123', version: 1 }, seatId: 0, reclaimToken: 'pod-token' });
      if (path === '/api/rooms/POD123') return response({ snapshot: { code: 'POD123', version: 1 } });
      throw new Error(`Unexpected request: ${options.method || 'GET'} ${path}`);
    };

    const { RealtimeAdapter } = await import(new URL(`./realtime.js?same-snapshot=${Date.now()}`, import.meta.url));
    const adapter = new RealtimeAdapter({ apiBase: 'https://pod.test' }); const states = [];
    adapter.addEventListener('state', event => states.push(event.detail.version));
    await adapter.createRoom({ playerCount: 2, startingLife: 40 });
    FakeEventSource.instances.at(-1).emit('snapshot', { data: JSON.stringify({ code: 'POD123', version: 1 }) });

    assert.deepEqual(states, [1]);
    adapter.clearSession();
  } finally {
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test('30-second snapshot safety polling pauses while an SSE reconnect is pending', async () => {
  const originals = Object.fromEntries(['fetch', 'EventSource', 'document', 'localStorage', 'setInterval', 'clearInterval'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const intervals = [];
  let roomReads = 0;
  try {
    globalThis.document = { visibilityState: 'visible' };
    globalThis.EventSource = FakeEventSource;
    globalThis.localStorage = { getItem: () => null, setItem: () => {} };
    globalThis.setInterval = (callback, delay) => { const timer = { callback, delay }; intervals.push(timer); return timer; };
    globalThis.clearInterval = () => {};
    globalThis.fetch = async (url, options = {}) => {
      const path = new URL(url).pathname;
      if (path === '/api/connections') return response({ connectionId: 'connection-1' });
      if (path === '/api/rooms' && options.method === 'POST') return response({ snapshot: { code: 'POD123', version: 1 }, seatId: 0, reclaimToken: 'pod-token' });
      if (path === '/api/rooms/POD123') { roomReads += 1; return response({ snapshot: { code: 'POD123', version: 2 } }); }
      if (path === '/api/rooms/POD123/client-diagnostics') return response({});
      throw new Error(`Unexpected request: ${options.method || 'GET'} ${path}`);
    };

    const { RealtimeAdapter } = await import(new URL(`./realtime.js?reconnect-poll=${Date.now()}`, import.meta.url));
    const adapter = new RealtimeAdapter({ apiBase: 'https://pod.test' });
    await adapter.createRoom({ playerCount: 2, startingLife: 40 });
    const snapshotPoll = intervals.find(timer => timer.delay === 30_000);
    assert.ok(snapshotPoll);
    FakeEventSource.instances.at(-1).emit('error');
    const readsBeforeSafetyPoll = roomReads;
    await snapshotPoll.callback();
    assert.equal(roomReads, readsBeforeSafetyPoll);
    adapter.clearSession();
  } finally {
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test('an SSE-only drop keeps scoring connected when the confirmed room read succeeds', async () => {
  const originals = Object.fromEntries(['fetch', 'EventSource', 'document', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    FakeEventSource.instances = [];
    globalThis.document = { visibilityState: 'visible' };
    globalThis.EventSource = FakeEventSource;
    globalThis.localStorage = { getItem: () => null, setItem: () => {} };
    globalThis.fetch = async (url, options = {}) => {
      const path = new URL(url).pathname;
      if (path === '/api/connections') return response({ connectionId: 'connection-1' });
      if (path === '/api/rooms' && options.method === 'POST') return response({ snapshot: { code: 'POD123', version: 1 }, seatId: 0, reclaimToken: 'pod-token' });
      if (path === '/api/rooms/POD123') return response({ snapshot: { code: 'POD123', version: 2 } });
      if (path === '/api/rooms/POD123/client-diagnostics') return response({});
      throw new Error(`Unexpected request: ${options.method || 'GET'} ${path}`);
    };

    const { RealtimeAdapter } = await import(new URL(`./realtime.js?sse-recover=${Date.now()}`, import.meta.url));
    const adapter = new RealtimeAdapter({ apiBase: 'https://pod.test' }); const statuses = [];
    adapter.addEventListener('status', event => statuses.push(event.detail));
    await adapter.createRoom({ playerCount: 2, startingLife: 40 });
    FakeEventSource.instances.at(-1).emit('error');
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.equal(adapter.status, 'connected');
    assert.equal(adapter.snapshot.version, 2);
    assert.equal(FakeEventSource.instances.length, 2);
    assert.deepEqual(statuses, ['waiting', 'connected']);
    adapter.clearSession();
  } finally {
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test('returning from background coalesces resume requests into one fresh claim and stream', async () => {
  const originals = Object.fromEntries(['fetch', 'EventSource', 'document', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let connectionNumber = 0; let resumeClaims = 0; let releaseResumeClaim; let adapter;
  try {
    FakeEventSource.instances = [];
    globalThis.document = { visibilityState: 'visible' };
    globalThis.EventSource = FakeEventSource;
    globalThis.localStorage = { getItem: () => null, setItem: () => {} };
    globalThis.fetch = async (url, options = {}) => {
      const path = new URL(url).pathname;
      if (path === '/api/connections') return response({ connectionId: `connection-${++connectionNumber}` });
      if (path === '/api/rooms' && options.method === 'POST') return response({ snapshot: { code: 'POD123', version: 1 }, seatId: 0, reclaimToken: 'pod-token' });
      if (path === '/api/rooms/POD123/claim' && options.method === 'POST') {
        resumeClaims += 1;
        return new Promise(resolve => { releaseResumeClaim = () => resolve(response({ snapshot: { code: 'POD123', version: 1 } })); });
      }
      throw new Error(`Unexpected request: ${options.method || 'GET'} ${path}`);
    };

    const { RealtimeAdapter } = await import(new URL(`./realtime.js?resume=${Date.now()}`, import.meta.url));
    adapter = new RealtimeAdapter({ apiBase: 'https://pod.test' });
    await adapter.createRoom({ playerCount: 2, startingLife: 40 });
    const originalStream = FakeEventSource.instances.at(-1);

    const firstResume = adapter.resume();
    const secondResume = adapter.resume();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(resumeClaims, 1);
    releaseResumeClaim();
    await Promise.all([firstResume, secondResume]);

    assert.equal(connectionNumber, 2);
    assert.equal(FakeEventSource.instances.length, 2);
    assert.equal(originalStream.closed, true);
    assert.equal(adapter.status, 'connected');
    adapter.clearSession();
  } finally {
    adapter?.clearSession();
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test('foreground resume takes over when an SSE-only recovery is already reading a stale connection', async () => {
  const originals = Object.fromEntries(['fetch', 'EventSource', 'document', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let connectionNumber = 0; let resumeClaims = 0; let releaseRecoveryRead;
  try {
    FakeEventSource.instances = [];
    globalThis.document = { visibilityState: 'visible' };
    globalThis.EventSource = FakeEventSource;
    globalThis.localStorage = { getItem: () => null, setItem: () => {} };
    globalThis.fetch = async (url, options = {}) => {
      const path = new URL(url).pathname;
      if (path === '/api/connections') return response({ connectionId: `connection-${++connectionNumber}` });
      if (path === '/api/rooms' && options.method === 'POST') return response({ snapshot: { code: 'POD123', version: 1 }, seatId: 0, reclaimToken: 'pod-token' });
      if (path === '/api/rooms/POD123' && options.method === 'GET') return new Promise(resolve => { releaseRecoveryRead = () => resolve(response({ snapshot: { code: 'POD123', version: 1 } })); });
      if (path === '/api/rooms/POD123/claim' && options.method === 'POST') { resumeClaims += 1; return response({ snapshot: { code: 'POD123', version: 2 } }); }
      if (path === '/api/rooms/POD123/client-diagnostics') return response({});
      throw new Error(`Unexpected request: ${options.method || 'GET'} ${path}`);
    };

    const { RealtimeAdapter } = await import(new URL(`./realtime.js?foreground-wins=${Date.now()}`, import.meta.url));
    const adapter = new RealtimeAdapter({ apiBase: 'https://pod.test' });
    await adapter.createRoom({ playerCount: 2, startingLife: 40 });

    FakeEventSource.instances.at(-1).emit('error');
    await new Promise(resolve => setImmediate(resolve));
    await adapter.resume();

    assert.equal(connectionNumber, 2);
    assert.equal(resumeClaims, 1);
    releaseRecoveryRead();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(FakeEventSource.instances.length, 2);
    assert.equal(adapter.status, 'connected');
    adapter.clearSession();
  } finally {
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test('a cleared room cannot overwrite a newly created room with late SSE or mutation snapshots', async () => {
  const originals = Object.fromEntries(['fetch', 'EventSource', 'document', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let connectionNumber = 0; let roomNumber = 0; let releaseOldMutation;
  try {
    globalThis.document = { visibilityState: 'visible' };
    globalThis.EventSource = FakeEventSource;
    globalThis.localStorage = { getItem: () => null, setItem: () => {} };
    globalThis.fetch = async (url, options = {}) => {
      const path = new URL(url).pathname;
      if (path === '/api/connections') return response({ connectionId: `connection-${++connectionNumber}` });
      if (path === '/api/rooms' && options.method === 'POST') {
        const code = roomNumber++ === 0 ? 'OLD111' : 'NEW222';
        return response({ snapshot: { code, version: 1 }, seatId: 0, reclaimToken: `${code}-token` });
      }
      if (path.endsWith('/me') && options.method === 'PATCH') return new Promise(resolve => { releaseOldMutation = () => resolve(response({ snapshot: { code: 'OLD111', version: 99 } })); });
      throw new Error(`Unexpected request: ${options.method || 'GET'} ${path}`);
    };

    const { RealtimeAdapter } = await import(new URL(`./realtime.js?race=${Date.now()}`, import.meta.url));
    const adapter = new RealtimeAdapter({ apiBase: 'https://pod.test' }); const states = [];
    adapter.addEventListener('state', event => states.push(event.detail.code));

    await adapter.createRoom({ playerCount: 2, startingLife: 40 });
    const oldEvents = FakeEventSource.instances.at(-1); const oldMutation = adapter.mutate({ counters: { life: 39 } });
    await Promise.resolve(); assert.equal(typeof releaseOldMutation, 'function');

    adapter.clearSession();
    await adapter.createRoom({ playerCount: 2, startingLife: 40 });
    oldEvents.emit('snapshot', { data: JSON.stringify({ code: 'OLD111', version: 100 }) });
    releaseOldMutation();
    const staleResult = await oldMutation;

    assert.equal(staleResult.ignored, true);
    assert.equal(adapter.roomCode, 'NEW222');
    assert.equal(adapter.snapshot.code, 'NEW222');
    assert.deepEqual(states, ['OLD111', 'NEW222']);
    adapter.clearSession();
  } finally {
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
