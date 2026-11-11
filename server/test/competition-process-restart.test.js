import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { startCompetitionRestFixture } from '../../qa/competition-rest-fixture.mjs';

async function startApp(databaseUrl) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../../qa/competition-local-server.mjs', import.meta.url))], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)), windowsHide: true,
    env: { ...process.env, COMPETITION_QA_PORT: '0', COMPETITION_QA_DATABASE_URL: databaseUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '', errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`QA startup timed out: ${errors}`)); }, 10_000);
    child.stdout.on('data', chunk => {
      output += chunk; const match = /COMPETITION_QA_READY (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`QA server exited ${code}: ${errors}`)); });
  });
  return { url, child, async kill() { if (child.exitCode == null && child.signalCode == null) { child.kill('SIGKILL'); await once(child, 'exit'); } } };
}

test('real process restart retains five completed sources beyond the room cache and conditional concurrent confirmation stays idempotent', async t => {
  const database = await startCompetitionRestFixture(); t.after(() => database.close());
  const processes = []; t.after(async () => { for (const process of processes) await process.kill(); });
  let app = await startApp(database.url); processes.push(app);
  const call = async (path, { method = 'GET', token = 'qa-host', connection, body } = {}) => {
    const response = await fetch(app.url + path, { method, headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}), ...(connection ? { 'x-connection-id': connection } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: response.status === 204 ? null : await response.json() };
  };
  const created = await call('/api/competitions/pods', { method: 'POST', body: { name: 'Restart evidence', displayName: 'Mira' } });
  assert.equal(created.status, 201); const podId = created.data.id;
  const invite = (await call(`/api/competitions/pod/${podId}/invites`, { method: 'POST', body: {} })).data;
  assert.equal((await call('/api/competitions/join', { method: 'POST', token: 'qa-member', body: { token: invite.token, displayName: 'Nico' } })).status, 200);
  let host = (await call('/api/connections', { method: 'POST', body: {} })).data.connectionId;
  const member = (await call('/api/connections', { method: 'POST', body: {} })).data.connectionId;
  const room = (await call('/api/rooms', { method: 'POST', connection: host, body: { playerCount: 2, startingLife: 40, name: 'Mira' } })).data;
  const code = room.snapshot.code;
  assert.equal((await call('/api/competitions/tables/bind', { method: 'POST', connection: host, body: { kind: 'pod', id: podId, code } })).status, 200);
  assert.equal((await call(`/api/rooms/${code}/claim`, { method: 'POST', token: 'qa-member', connection: member, body: { seatId: 1, name: 'Nico' } })).status, 200);
  const gameIds = [];
  const snapshot = async () => (await call(`/api/rooms/${code}`, { connection: host })).data.snapshot;
  for (let game = 0; game < 5; game++) {
    assert.equal((await call(`/api/rooms/${code}/start-game`, { method: 'POST', connection: host, body: { baseVersion: (await snapshot()).version } })).status, 200);
    const finish = await call(`/api/rooms/${code}/declare-winner`, { method: 'POST', connection: host, body: { baseVersion: (await snapshot()).version, winnerSeatId: 0 } });
    assert.equal(finish.status, 200); gameIds.push(finish.data.snapshot.completedGameId);
    assert.equal((await call(`/api/rooms/${code}/reset`, { method: 'POST', connection: host, body: { baseVersion: (await snapshot()).version } })).status, 200);
  }
  const historyBefore = (await call(`/api/competitions/pod/${podId}/history`)).data;
  assert.equal(historyBefore.games.length, 5);
  assert.equal(new Set(gameIds).size, 5);
  // Kill the actual application process. The loopback REST database remains alive.
  await app.kill(); app = await startApp(database.url); processes.push(app);
  const historyAfter = await call(`/api/competitions/pod/${podId}/history`);
  assert.equal(historyAfter.status, 200); assert.deepEqual(historyAfter.data, historyBefore);
  const first = (await call(`/api/competitions/pod/${podId}/games/${gameIds[0]}`)).data;
  assert.equal(first.status, 'pending'); assert.equal(first.players.length, 2);
  assert.equal(/ownerHash|tableIdentity|identityId|accountId/.test(JSON.stringify(first)), false);
  const payload = { order: first.starterIds.map(id => [id]), baseRevision: 0, requestId: 'restart_concurrent_confirm' };
  const responses = await Promise.all(Array.from({ length: 4 }, () => call(`/api/competitions/pod/${podId}/games/${first.gameId}/confirm`, { method: 'POST', body: payload })));
  assert.ok(responses.every(response => response.status === 200 && response.data.revisions.length === 1));
  const conflict = await call(`/api/competitions/pod/${podId}/games/${first.gameId}/confirm`, { method: 'POST', body: { ...payload, order: [...payload.order].reverse() } });
  assert.equal(conflict.status, 409);
  const standings = (await call(`/api/competitions/pod/${podId}`)).data;
  assert.ok(standings.members.every(row => row.gamesPlayed === 1 && row.ratedGames === 1));
  assert.ok(database.conflicts > 0, 'The REST fixture must actually exercise a conditional-write conflict.');
  // Verified group publication cannot write another account’s personal awards.
  const personal = (await call('/api/account/history')).data.history;
  assert.equal(personal.gamesPlayed, 0); assert.equal(personal.wins, 0);
  host = (await call('/api/connections', { method: 'POST', body: {} })).data.connectionId;
  const reclaimed = await call(`/api/rooms/${code}/claim`, { method: 'POST', connection: host, body: { seatId: 0, reclaimToken: room.reclaimToken } });
  assert.equal(reclaimed.status, 200);
  assert.equal(reclaimed.data.snapshot.code, code);
  assert.equal(database.read('competitions.json'), null, 'QA competition writes must use their own namespace.');
  assert.ok(database.read('qa/competitions/directory.json'));
});
