import assert from 'node:assert/strict';
import test from 'node:test';
import { liveStreamLimitsFromEnv } from '../src/live-stream-limits.js';
import { createRealtimeServer } from '../src/app.js';

test('live-stream settings preserve existing defaults and accept bounded staging overrides', () => {
  assert.deepEqual(liveStreamLimitsFromEnv({}), { maxStreamsPerIp: 32, maxStreamsGlobal: 64 });
  assert.deepEqual(liveStreamLimitsFromEnv({ MAX_LIVE_STREAMS_PER_IP: '128', MAX_LIVE_STREAMS_GLOBAL: '256' }), { maxStreamsPerIp: 128, maxStreamsGlobal: 256 });
});

test('invalid or inconsistent stream settings fail before the server starts', () => {
  for (const value of ['0', '-1', '1.5', 'unlimited', '1025', '']) assert.throws(() => liveStreamLimitsFromEnv({ MAX_LIVE_STREAMS_PER_IP: value }), /MAX_LIVE_STREAMS_PER_IP/);
  assert.throws(() => liveStreamLimitsFromEnv({ MAX_LIVE_STREAMS_PER_IP: '128', MAX_LIVE_STREAMS_GLOBAL: '64' }), /global|GLOBAL/);
});

async function fixture(t, limits) {
  const app = createRealtimeServer(limits), controllers = [];
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { for (const controller of controllers) controller.abort(); app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve)); });
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const owner = () => {
    const connectionId = app.service.createConnection().connectionId;
    return { connectionId, code: app.service.createRoom(connectionId, { playerCount: 2, startingLife: 40 }).snapshot.code };
  };
  const open = async (entry, network) => {
    const controller = new AbortController(); controllers.push(controller);
    return fetch(`${origin}/api/rooms/${entry.code}/events?connectionId=${entry.connectionId}`, { signal: controller.signal, headers: { 'x-forwarded-for': network } });
  };
  return { owner, open };
}

test('HTTP SSE applies configured per-network and whole-server caps independently', async t => {
  const f = await fixture(t, { maxStreamsPerIp: 2, maxStreamsGlobal: 3 });
  assert.equal((await f.open(f.owner(), '198.51.100.1')).status, 200);
  assert.equal((await f.open(f.owner(), '198.51.100.1')).status, 200);
  const sameNetwork = await f.open(f.owner(), '198.51.100.1');
  assert.equal(sameNetwork.status, 429); assert.match((await sameNetwork.json()).error.message, /from this network/);
  assert.equal((await f.open(f.owner(), '198.51.100.2')).status, 200);
  const global = await f.open(f.owner(), '198.51.100.3');
  assert.equal(global.status, 429); assert.equal((await global.json()).error.code, 'SSE_LIMIT');
});

test('raised settings support more than 64 streams while each phone remains limited to two', async t => {
  const f = await fixture(t, liveStreamLimitsFromEnv({ MAX_LIVE_STREAMS_PER_IP: '128', MAX_LIVE_STREAMS_GLOBAL: '256' }));
  const owners = Array.from({ length: 65 }, f.owner);
  assert.ok((await Promise.all(owners.map(entry => f.open(entry, '198.51.100.1')))).every(response => response.status === 200));
  assert.equal((await f.open(owners[0], '198.51.100.1')).status, 200);
  const third = await f.open(owners[0], '198.51.100.1');
  assert.equal(third.status, 429); assert.equal((await third.json()).error.code, 'SSE_LIMIT');
});
