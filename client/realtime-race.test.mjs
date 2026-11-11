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
      if (path === '/api/connections') {
        const { tableDeviceId, ...capabilities } = JSON.parse(options.body);
        assert.deepEqual(capabilities, { supportedTableProtocols: [1] });
        assert.match(tableDeviceId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i);
        return response({ connectionId: 'connection-1' });
      }
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

test('a delayed manual refresh returns the newer snapshot already received over SSE', async () => {
  const originals = Object.fromEntries(['fetch', 'EventSource', 'document', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let adapter;
  let releaseRefresh;
  const initial = { code: 'POD123', version: 1 };
  const newer = { code: 'POD123', version: 2 };
  try {
    globalThis.document = { visibilityState: 'visible' };
    globalThis.EventSource = FakeEventSource;
    globalThis.localStorage = { getItem: () => null, setItem: () => {} };
    globalThis.fetch = async (url, options = {}) => {
      const path = new URL(url).pathname;
      if (path === '/api/connections') return response({ connectionId: 'connection-1' });
      if (path === '/api/rooms' && options.method === 'POST') return response({ snapshot: initial, seatId: 0, reclaimToken: 'pod-token' });
      if (path === '/api/rooms/POD123') return new Promise(resolve => { releaseRefresh = () => resolve(response({ snapshot: initial })); });
      throw new Error(`Unexpected request: ${options.method || 'GET'} ${path}`);
    };

    const { RealtimeAdapter } = await import('./realtime.js');
    adapter = new RealtimeAdapter({ apiBase: 'https://pod.test' });
    await adapter.createRoom({ playerCount: 2, startingLife: 40 });
    const refresh = adapter.refreshRoom();
    FakeEventSource.instances.at(-1).emit('snapshot', { data: JSON.stringify(newer) });
    releaseRefresh();

    assert.deepEqual(adapter.snapshot, newer);
    assert.deepEqual((await refresh).snapshot, newer);
  } finally {
    adapter?.clearSession();
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test('a locked post-game adjustment adopts confirmed state without interrupting the stream', async () => {
  const originals = Object.fromEntries(['fetch', 'EventSource', 'document', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const playing = { code: 'POD123', version: 1, lifecycle: { status: 'playing' } };
  const complete = { ...playing, version: 2, lifecycle: { status: 'complete' } };
  const intermission = { ...playing, version: 3, lifecycle: { status: 'intermission' } };
  const locked = { ok: false, status: 409, json: async () => ({ error: { code: 'GAME_NOT_PLAYING' }, snapshot: complete }) };
  const states = [];
  const statuses = [];
  let adapter;
  let requests = 0;
  let finishDelayedAdjustment;
  try {
    globalThis.document = { visibilityState: 'visible' };
    globalThis.EventSource = FakeEventSource;
    globalThis.localStorage = { getItem: () => null, setItem: () => {} };
    globalThis.fetch = async url => {
      const path = new URL(url).pathname;
      if (path === '/api/connections') return response({ connectionId: 'connection-1' });
      if (path === '/api/rooms') return response({ snapshot: playing, seatId: 0, reclaimToken: 'pod-token' });
      if (path === '/api/rooms/POD123/adjust') {
        requests += 1;
        if (requests === 1) return locked;
        return new Promise(resolve => { finishDelayedAdjustment = () => resolve(locked); });
      }
      throw new Error('Unexpected request: ' + path);
    };

    const { RealtimeAdapter } = await import('./realtime.js');
    adapter = new RealtimeAdapter({ apiBase: 'https://pod.test' });
    adapter.addEventListener('state', event => states.push(event.detail.version));
    adapter.addEventListener('status', event => statuses.push(event.detail));
    await adapter.createRoom({ playerCount: 2, startingLife: 40 });
    const stream = FakeEventSource.instances.at(-1);
    const adjustment = { counter: 'life', delta: -1, operationId: 'post-game-lock-test' };

    assert.deepEqual(await adapter.adjust(adjustment), { locked: true });
    assert.deepEqual(adapter.snapshot, complete);

    const delayed = adapter.adjust(adjustment);
    stream.emit('snapshot', { data: JSON.stringify(intermission) });
    finishDelayedAdjustment();
    assert.deepEqual(await delayed, { locked: true });
    assert.deepEqual(adapter.snapshot, intermission);
    assert.deepEqual(states, [1, 2, 3]);
    assert.deepEqual(statuses, ['waiting', 'connected']);
    assert.equal(stream.closed, false);
    assert.equal(requests, 2);
  } finally {
    adapter?.clearSession();
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

test('coalesces rapid SSE recovery loops into one connection incident summary', async () => {
  const originals = Object.fromEntries(['fetch', 'EventSource', 'document', 'localStorage', 'setTimeout', 'clearTimeout'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const diagnostics = [];
  const timers = [];
  let adapter;
  try {
    FakeEventSource.instances = [];
    globalThis.document = { visibilityState: 'visible' };
    globalThis.EventSource = FakeEventSource;
    globalThis.localStorage = { getItem: () => null, setItem: () => {} };
    globalThis.setTimeout = (callback, delay) => { const timer = { callback, delay, cleared: false }; timers.push(timer); return timer; };
    globalThis.clearTimeout = timer => { if (timer) timer.cleared = true; };
    globalThis.fetch = async (url, options = {}) => {
      const path = new URL(url).pathname;
      if (path === '/api/connections') return response({ connectionId: 'connection-1' });
      if (path === '/api/rooms' && options.method === 'POST') return response({ snapshot: { code: 'POD123', version: 1 }, seatId: 0, reclaimToken: 'pod-token' });
      if (path === '/api/rooms/POD123') return response({ snapshot: { code: 'POD123', version: 2 } });
      if (path === '/api/rooms/POD123/client-diagnostics') { diagnostics.push(JSON.parse(options.body)); return response({}); }
      throw new Error(`Unexpected request: ${options.method || 'GET'} ${path}`);
    };

    const { RealtimeAdapter } = await import(new URL(`./realtime.js?incident-summary=${Date.now()}`, import.meta.url));
    adapter = new RealtimeAdapter({ apiBase: 'https://pod.test' });
    await adapter.createRoom({ playerCount: 2, startingLife: 40 });
    FakeEventSource.instances.at(-1).emit('error');
    await new Promise(resolve => setImmediate(resolve));
    FakeEventSource.instances.at(-1).emit('error');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(diagnostics.map(({ outcome, occurrences }) => ({ outcome, occurrences })), [{ outcome: 'failed', occurrences: 1 }]);
    const recovery = timers.find(timer => timer.delay === 30_000 && !timer.cleared);
    assert.ok(recovery);
    recovery.callback();
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(diagnostics.map(({ kind, operation, outcome, reason, occurrences, reconnectAttempts }) => ({ kind, operation, outcome, reason, occurrences, reconnectAttempts })), [
      { kind: 'connection_incident', operation: 'sse', outcome: 'failed', reason: 'event_source_error', occurrences: 1, reconnectAttempts: 0 },
      { kind: 'connection_incident', operation: 'sse', outcome: 'recovered', reason: 'event_source_error', occurrences: 2, reconnectAttempts: 2 },
    ]);
  } finally {
    adapter?.clearSession();
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test('an SSE recovery reclaims before reporting connected when the server no longer owns the seat', async () => {
  const originals = Object.fromEntries(['fetch', 'EventSource', 'document', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let connectionNumber = 0; let reclaimCalls = 0;
  try {
    FakeEventSource.instances = [];
    globalThis.document = { visibilityState: 'visible' };
    globalThis.EventSource = FakeEventSource;
    globalThis.localStorage = { getItem: () => null, setItem: () => {} };
    globalThis.fetch = async (url, options = {}) => {
      const path = new URL(url).pathname;
      if (path === '/api/connections') return response({ connectionId: `connection-${++connectionNumber}` });
      if (path === '/api/rooms' && options.method === 'POST') return response({ snapshot: { code: 'POD123', version: 1 }, seatId: 0, reclaimToken: 'pod-token' });
      if (path === '/api/rooms/POD123' && options.method !== 'POST') return response({ snapshot: { code: 'POD123', version: 2 }, ownership: { ownsSeat: false } });
      if (path === '/api/rooms/POD123/claim' && options.method === 'POST') {
        reclaimCalls += 1;
        assert.equal(options.headers['X-Connection-Id'], 'connection-2');
        return response({ snapshot: { code: 'POD123', version: 3 } });
      }
      if (path === '/api/rooms/POD123/client-diagnostics') return response({});
      throw new Error(`Unexpected request: ${options.method || 'GET'} ${path}`);
    };

    const { RealtimeAdapter } = await import(new URL(`./realtime.js?restart-reclaim=${Date.now()}`, import.meta.url));
    const adapter = new RealtimeAdapter({ apiBase: 'https://pod.test' });
    await adapter.createRoom({ playerCount: 2, startingLife: 40 });
    FakeEventSource.instances.at(-1).emit('error');
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(reclaimCalls, 1);
    assert.equal(adapter.connectionId, 'connection-2');
    assert.equal(adapter.status, 'connected');
    assert.equal(adapter.snapshot.version, 3);
    adapter.clearSession();
  } finally {
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test('a transient heartbeat failure refreshes the room before attempting a reclaim', async () => {
  const originals = Object.fromEntries(['fetch', 'EventSource', 'document', 'localStorage', 'setInterval', 'clearInterval'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const intervals = [];
  try {
    FakeEventSource.instances = [];
    globalThis.document = { visibilityState: 'visible' };
    globalThis.EventSource = FakeEventSource;
    globalThis.localStorage = { getItem: () => null, setItem: () => {} };
    globalThis.setInterval = (callback, delay) => { const timer = { callback, delay }; intervals.push(timer); return timer; };
    globalThis.clearInterval = () => {};
    globalThis.fetch = async (url, options = {}) => {
      const path = new URL(url).pathname;
      if (path === '/api/connections') return response({ connectionId: 'connection-1' });
      if (path === '/api/rooms' && options.method === 'POST') return response({ snapshot: { code: 'POD123', version: 1 }, seatId: 0, reclaimToken: 'pod-token' });
      if (path === '/api/connections/heartbeat') throw new Error('temporary heartbeat failure');
      if (path === '/api/rooms/POD123') return response({ snapshot: { code: 'POD123', version: 2 } });
      if (path === '/api/rooms/POD123/claim') throw new Error('a healthy room read must not reclaim the seat');
      throw new Error(`Unexpected request: ${options.method || 'GET'} ${path}`);
    };

    const { RealtimeAdapter } = await import(new URL(`./realtime.js?heartbeat-recover=${Date.now()}`, import.meta.url));
    const adapter = new RealtimeAdapter({ apiBase: 'https://pod.test' });
    await adapter.createRoom({ playerCount: 2, startingLife: 40 });
    const heartbeat = intervals.find(timer => timer.delay === 40_000);
    assert.ok(heartbeat);
    await heartbeat.callback();
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(adapter.status, 'connected');
    assert.equal(adapter.snapshot.version, 2);
    assert.equal(FakeEventSource.instances.length, 2);
    adapter.clearSession();
  } finally {
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test('returning to a healthy foreground session refreshes its stream without reclaiming the seat', async () => {
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
      if (path === '/api/connections/heartbeat') return response({ ok: true });
      if (path === '/api/rooms/POD123') return response({ snapshot: { code: 'POD123', version: 2 } });
      if (path === '/api/rooms/POD123/claim') throw new Error('a healthy foreground return must not reclaim the seat');
      throw new Error(`Unexpected request: ${options.method || 'GET'} ${path}`);
    };

    const { RealtimeAdapter } = await import(new URL(`./realtime.js?healthy-resume=${Date.now()}`, import.meta.url));
    const adapter = new RealtimeAdapter({ apiBase: 'https://pod.test' });
    await adapter.createRoom({ playerCount: 2, startingLife: 40 });
    await adapter.resume();

    assert.equal(adapter.status, 'connected');
    assert.equal(adapter.snapshot.version, 2);
    assert.equal(FakeEventSource.instances.length, 2);
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

test('an old stream error cannot interrupt an in-flight background reclaim', async () => {
  const originals = Object.fromEntries(['fetch', 'EventSource', 'document', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let connectionNumber = 0; let releaseResumeClaim; let adapter;
  try {
    FakeEventSource.instances = [];
    globalThis.document = { visibilityState: 'visible' };
    globalThis.EventSource = FakeEventSource;
    globalThis.localStorage = { getItem: () => null, setItem: () => {} };
    globalThis.fetch = async (url, options = {}) => {
      const path = new URL(url).pathname;
      if (path === '/api/connections') return response({ connectionId: `connection-${++connectionNumber}` });
      if (path === '/api/rooms' && options.method === 'POST') return response({ snapshot: { code: 'POD123', version: 1 }, seatId: 0, reclaimToken: 'pod-token' });
      if (path === '/api/rooms/POD123/claim' && options.method === 'POST') return new Promise(resolve => { releaseResumeClaim = () => resolve(response({ snapshot: { code: 'POD123', version: 1 } })); });
      throw new Error(`Unexpected request: ${options.method || 'GET'} ${path}`);
    };
    const { RealtimeAdapter } = await import(new URL(`./realtime.js?resume-stream=${Date.now()}`, import.meta.url));
    adapter = new RealtimeAdapter({ apiBase: 'https://pod.test' }); const statuses = [];
    adapter.addEventListener('status', event => statuses.push(event.detail));
    await adapter.createRoom({ playerCount: 2, startingLife: 40 });
    const originalStream = FakeEventSource.instances.at(-1);
    const resume = adapter.resume();
    originalStream.emit('error');
    await new Promise(resolve => setImmediate(resolve));
    releaseResumeClaim(); await resume;
    assert.equal(connectionNumber, 2);
    assert.equal(adapter.status, 'connected');
    assert.deepEqual(statuses, ['waiting', 'connected']);
    adapter.clearSession();
  } finally {
    adapter?.clearSession();
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test('a cleared room cannot overwrite or mutate a new room through late responses', async () => {
  const originals = Object.fromEntries(['fetch', 'EventSource', 'document', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let connectionNumber = 0; let roomNumber = 0; let releaseOldMutation;
  let rejectOldAdjustment;
  const adjustmentPaths = [];
  const oldRefreshRequests = [];
  let adapter;
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
      if (path === '/api/rooms/OLD111' && options.method === 'GET') {
        return new Promise((resolve, reject) => { oldRefreshRequests.push({ resolve, reject }); });
      }
      if (path.endsWith('/adjust')) {
        adjustmentPaths.push(path);
        if (path === '/api/rooms/OLD111/adjust') return new Promise((_, reject) => { rejectOldAdjustment = reject; });
        return response({ snapshot: { code: 'NEW222', version: 2 } });
      }
      throw new Error(`Unexpected request: ${options.method || 'GET'} ${path}`);
    };

    const { RealtimeAdapter } = await import(new URL(`./realtime.js?race=${Date.now()}`, import.meta.url));
    adapter = new RealtimeAdapter({ apiBase: 'https://pod.test' }); const states = [];
    adapter.addEventListener('state', event => states.push(event.detail.code));

    await adapter.createRoom({ playerCount: 2, startingLife: 40 });
    const oldEvents = FakeEventSource.instances.at(-1); const oldMutation = adapter.mutate({ counters: { life: 39 } });
    const oldAdjustment = adapter.adjust({ counter: 'life', delta: -3, operationId: 'test-old-life-operation' });
    const oldRefresh = adapter.refreshRoom();
    const failedOldRefresh = adapter.refreshRoom().catch(error => ({ error }));
    await Promise.resolve(); assert.equal(typeof releaseOldMutation, 'function');

    adapter.clearSession();
    await adapter.createRoom({ playerCount: 2, startingLife: 40 });
    oldEvents.emit('snapshot', { data: JSON.stringify({ code: 'OLD111', version: 100 }) });
    releaseOldMutation();
    rejectOldAdjustment(new TypeError('Old adjustment response dropped'));
    oldRefreshRequests[0].resolve(response({ snapshot: { code: 'OLD111', version: 101 } }));
    oldRefreshRequests[1].reject(new TypeError('Old refresh response dropped'));
    const [staleResult, staleAdjustment, staleRefresh, staleRefreshError] = await Promise.all([oldMutation, oldAdjustment, oldRefresh, failedOldRefresh]);

    assert.equal(staleResult.ignored, true);
    assert.equal(staleAdjustment.ignored, true);
    assert.deepEqual(staleRefresh, { ignored: true });
    assert.deepEqual(staleRefreshError, { ignored: true });
    assert.deepEqual(adjustmentPaths, ['/api/rooms/OLD111/adjust']);
    assert.equal(adapter.roomCode, 'NEW222');
    assert.equal(adapter.snapshot.code, 'NEW222');
    assert.deepEqual(states, ['OLD111', 'NEW222']);
  } finally {
    adapter?.clearSession();
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
