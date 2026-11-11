import assert from 'node:assert/strict';
import test from 'node:test';
import { createRealtimeServer } from '../src/app.js';
import { AccountHistory, MemoryAccountHistoryStore } from '../src/account-history.js';
import { MemoryPlaytestLedger } from '../src/playtest-ledger.js';

async function app(t) {
  const competitionStore = new MemoryAccountHistoryStore(); const profileStore = new MemoryAccountHistoryStore();
  const instance = createRealtimeServer({ appEnv: 'test', competitionStore,
    accountHistory: new AccountHistory({ store: profileStore }), ledger: new MemoryPlaytestLedger(),
    accountVerifier: { verify: async token => { if (!token) throw Object.assign(new Error('Sign in'), { status: 401 }); return { providerSubject: token }; } } });
  await new Promise(resolve => instance.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => instance.server.close(resolve)));
  const base = `http://127.0.0.1:${instance.server.address().port}`;
  const request = async (path, { token = 'host', method = 'GET', body, connectionId, guestToken } = {}) => {
    const response = await fetch(base + path, { method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(connectionId ? { 'x-connection-id': connectionId } : {}),
        ...(guestToken ? { 'x-event-token': guestToken } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = response.status === 204 ? null : await response.json(); return { status: response.status, data };
  };
  return { ...instance, request, profileStore, competitionStore };
}

test('HTTP Pod opt-in/ACL/invite/revoke/leave and account erasure are enforced server-side', async t => {
  const f = await app(t);
  assert.equal((await f.request('/api/competitions/config', { token: null })).data.enabled, true);
  const created = await f.request('/api/competitions/pods', { method: 'POST', body: { name: 'HTTP Pod', displayName: 'Host' } });
  assert.equal(created.status, 201); const id = created.data.id;
  assert.equal((await f.request(`/api/competitions/pod/${id}`, { token: 'outsider' })).status, 403);
  const invite = (await f.request(`/api/competitions/pod/${id}/invites`, { method: 'POST', body: {} })).data;
  const preview = await f.request('/api/competitions/invite-preview', { token: null, method: 'POST', body: { token: invite.token } });
  assert.equal(preview.status, 200); assert.equal('members' in preview.data, false);
  assert.equal((await f.request('/api/competitions/join', { token: null, method: 'POST', body: { token: invite.token, displayName: 'Guest' } })).status, 401);
  const joined = await f.request('/api/competitions/join', { token: 'member', method: 'POST', body: { token: invite.token, displayName: 'Member' } });
  assert.equal(joined.status, 200);
  await f.request('/api/account', { token: 'member', method: 'DELETE' });
  const current = (await f.request(`/api/competitions/pod/${id}`)).data;
  assert.ok(current.members.some(member => member.name === 'Deleted member'));
});

test('existing Table start/reset routes seal and retain competition results, without adding hot-path I/O', async t => {
  const f = await app(t);
  const pod = (await f.request('/api/competitions/pods', { method: 'POST', body: { name: 'Table test', displayName: 'Host' } })).data;
  const host = f.service.createConnection().connectionId; const guest = f.service.createConnection().connectionId;
  const code = f.service.createRoom(host, { playerCount: 2, startingLife: 40 }).snapshot.code;
  f.service.claimSeat(code, guest, { seatId: 1 });
  const bound = await f.request('/api/competitions/tables/bind', { method: 'POST', connectionId: host, body: { kind: 'pod', id: pod.id, code } });
  assert.equal(bound.status, 200);
  const start = await f.request(`/api/rooms/${code}/start-game`, { method: 'POST', connectionId: host, body: { baseVersion: f.service.room(code).version } });
  assert.equal(start.status, 200);
  const prior = JSON.stringify([...f.competitionStore.values.values()]);
  await f.request(`/api/rooms/${code}/adjust`, { method: 'POST', token: null, connectionId: guest, body: { counter: 'life', delta: -40 } });
  assert.equal(JSON.stringify([...f.competitionStore.values.values()]), prior);
  const reset = await f.request(`/api/rooms/${code}/reset`, { method: 'POST', token: null, connectionId: host, body: { baseVersion: f.service.room(code).version } });
  assert.equal(reset.status, 200);
  const history = await f.request(`/api/competitions/pod/${pod.id}/history`);
  assert.equal(history.data.games.length, 1); assert.equal(history.data.games[0].status, 'pending');
});

test('guest tournament HTTP entry/reclaim is account-optional and cannot access host controls', async t => {
  const f = await app(t);
  const event = (await f.request('/api/competitions/tournaments', { method: 'POST', body: { name: 'Event', displayName: 'Host', rounds: 2 } })).data;
  const invite = (await f.request(`/api/competitions/tournament/${event.id}/invites`, { method: 'POST', body: {} })).data;
  const guest = await f.request('/api/competitions/join', { token: null, method: 'POST', body: { token: invite.token, displayName: 'Guest', requestId: 'http_guest_entry' } });
  assert.equal(guest.status, 200); assert.ok(guest.data.guestToken);
  const auth = { token: null, guestToken: guest.data.guestToken };
  assert.equal((await f.request(`/api/competitions/tournament/${event.id}`, auth)).status, 200);
  assert.equal((await f.request(`/api/competitions/tournament/${event.id}/rounds/prepare`, { ...auth, method: 'POST', body: {} })).status, 403);
  assert.equal((await f.request(`/api/competitions/tournament/${event.id}`, { token: null, guestToken: 'fake' })).status, 403);
});
