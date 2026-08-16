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
