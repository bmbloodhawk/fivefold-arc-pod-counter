import assert from 'node:assert/strict';
import test from 'node:test';
import { createRealtimeServer } from '../src/app.js';
import { AccountHistory, MemoryAccountHistoryStore } from '../src/account-history.js';
import { MemoryPlaytestLedger } from '../src/playtest-ledger.js';

async function fixture(t) {
  const app = createRealtimeServer({ appEnv: 'test', competitionStore: new MemoryAccountHistoryStore(),
    accountHistory: new AccountHistory({ store: new MemoryAccountHistoryStore() }), ledger: new MemoryPlaytestLedger(),
    accountVerifier: { verify: async token => ({ providerSubject: token }) } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => { app.server.closeAllConnections(); return new Promise(resolve => app.server.close(resolve)); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = async (path, { account, viewerToken, method = 'GET', body } = {}) => {
    const response = await fetch(base + path, { method, headers: {
      ...(account ? { authorization: `Bearer ${account}` } : {}),
      ...(viewerToken !== undefined ? { 'x-event-viewer-token': viewerToken } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json(), headers: response.headers };
  };
  const event = (await request('/api/competitions/tournaments', { account: 'host', method: 'POST', body: { name: 'Watch QA', displayName: 'Host', rounds: 1 } })).data;
  const path = `/api/competitions/tournament/${event.id}`;
  const invite = (await request(`${path}/invites`, { account: 'host', method: 'POST', body: {} })).data;
  for (const account of ['first', 'second']) await request('/api/competitions/join', { account, method: 'POST', body: { token: invite.token, displayName: account } });
  await request(`${path}/rounds/prepare`, { account: 'host', method: 'POST', body: {} });
  const link = (await request(`${path}/spectator-links`, { account: 'host', method: 'POST', body: { action: 'create' } })).data;
  return { ...app, request, path, link };
}

test('private Watch Table route uses viewer capability without account or seat and creates no activity', async t => {
  const f = await fixture(t); const before = await f.competitions.readScope('tournament', f.path.split('/').at(-1));
  const response = await f.request(`${f.path}/spectator/table?round=1&table=1`, { viewerToken: f.link.viewerToken });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  assert.equal(response.data.status, 'ready'); assert.equal(response.data.hasLiveTotals, false);
  assert.equal(response.data.roundNumber, 1); assert.equal(response.data.tableNumber, 1);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(f.service.rooms.size, 0); assert.equal(f.service.connections.size, 0);
  assert.deepEqual(await f.competitions.readScope('tournament', f.path.split('/').at(-1)), before);
});

test('Watch Table rejects malformed selectors and capabilities and keeps writes forbidden', async t => {
  const f = await fixture(t);
  for (const query of ['', '?round=1', '?round=0&table=1', '?round=1.5&table=1', '?round=1&table=-1', '?round=1&round=2&table=1', '?round=1&table=1&table=2']) {
    assert.equal((await f.request(`${f.path}/spectator/table${query}`, { viewerToken: f.link.viewerToken })).status, 400, query);
  }
  const target = `${f.path}/spectator/table?round=1&table=1`;
  for (const options of [{}, { account: 'host' }, { viewerToken: '' }, { viewerToken: 'X'.repeat(43) }]) assert.equal((await f.request(target, options)).status, 403);
  for (const path of [target, `${f.path}/members`, '/api/connections', '/api/rooms/ABC123/claim']) {
    assert.equal((await f.request(path, { viewerToken: f.link.viewerToken, account: 'host', method: 'POST', body: {} })).status, 403, path);
  }
  await f.request(`${f.path}/spectator-links`, { account: 'host', method: 'POST', body: { action: 'revoke' } });
  assert.equal((await f.request(target, { viewerToken: f.link.viewerToken })).status, 403);
});
