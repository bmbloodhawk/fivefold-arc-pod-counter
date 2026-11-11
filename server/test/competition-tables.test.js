import assert from 'node:assert/strict';
import test from 'node:test';
import { Competitions } from '../src/competitions.js';
import { CompetitionTables } from '../src/competition-tables.js';
import { RoomService } from '../src/app.js';
import { MemoryAccountHistoryStore } from '../src/account-history.js';
import { MemoryPlaytestLedger } from '../src/playtest-ledger.js';

async function fixture({ ledger = new MemoryPlaytestLedger(), store = new MemoryAccountHistoryStore() } = {}) {
  let time = 1000;
  const domain = new Competitions({ store, now: () => time++ });
  const service = new RoomService({ ledger, now: () => time++ });
  const tables = new CompetitionTables({ domain, service, ledger });
  const pod = await domain.createPod('a', { name: 'Friday', displayName: 'A' });
  const invite = await domain.invite('a', 'pod', pod.id);
  await domain.joinPod('b', invite.token, { displayName: 'B' });
  const host = service.createConnection().connectionId; const guest = service.createConnection().connectionId;
  const created = service.createRoom(host, { playerCount: 2, seatCapacity: 8, startingLife: 40, name: 'A' });
  const code = created.snapshot.code;
  const claimed = service.claimSeat(code, guest, { seatId: 2, name: 'B' });
  await tables.bind('a', { kind: 'pod', id: pod.id, code, connectionId: host });
  await tables.claim('b', { code, connectionId: guest });
  const start = () => tables.start(code, host, { baseVersion: service.room(code).version });
  const finish = () => service.declareWinner(code, host, { winnerSeatId: 0, baseVersion: service.room(code).version });
  return { domain, service, tables, ledger, store, pod, host, guest, code, created, claimed, start, finish };
}
async function publish(f, reverse = false, requestId = 'confirmation_0001') {
  await f.tables.reconcile('pod', f.pod.id);
  const scope = await f.domain.readScope('pod', f.pod.id);
  const game = scope.games[f.service.room(f.code).gameId];
  const order = game.starterIds.map(id => [id]);
  return f.tables.confirm('a', 'pod', f.pod.id, game.gameId, {
    order: reverse ? order.reverse() : order, baseRevision: game.revisions.length,
    requestId, reasonCode: game.revisions.length ? 'order_error' : 'host_confirmation',
  });
}

test('a proven participating account is bound once; reclaim keeps identity and replacement cannot steal it', async () => {
  const f = await fixture();
  const replacement = f.service.createConnection().connectionId;
  f.service.claimSeat(f.code, replacement, { seatId: 2, reclaimToken: f.claimed.reclaimToken });
  await f.tables.claim('b', { code: f.code, connectionId: replacement });
  await assert.rejects(() => f.tables.claim('a', { code: f.code, connectionId: replacement }), { status: 409 });
  await assert.rejects(() => f.tables.claim('b', { code: f.code, connectionId: f.guest }), { status: 403 });
  await f.start(); f.finish();
  const result = await publish(f);
  assert.equal(result.revisions.length, 1);
  assert.equal((await f.domain.getPod('b', f.pod.id)).members.find(item => item.name === 'B').gamesPlayed, 1);
});

test('only completed host-confirmed full orders count; guest/no-show seats never become rated members', async () => {
  const f = await fixture();
  await f.start();
  await f.tables.reconcile('pod', f.pod.id);
  assert.equal((await f.domain.getPod('a', f.pod.id)).members[0].gamesPlayed, 0);
  f.finish(); await f.tables.reconcile('pod', f.pod.id);
  const state = await f.domain.readScope('pod', f.pod.id); const id = f.service.room(f.code).gameId;
  assert.equal(state.games[id].starterIds.length, 2);
  assert.equal((await f.domain.getPod('a', f.pod.id)).members[0].gamesPlayed, 0);
  await assert.rejects(() => f.tables.confirm('a', 'pod', f.pod.id, id, {
    order: [[state.games[id].starterIds[0]]], baseRevision: 0, requestId: 'missing_starter_01',
  }), /starter/i);
  await publish(f);
  assert.equal((await f.domain.getPod('a', f.pod.id)).members[0].gamesPlayed, 1);
});

test('duplicate, lost-response and concurrent publication produce one result; conflicting reuse rejects', async () => {
  const f = await fixture(); await f.start(); f.finish(); await f.tables.reconcile('pod', f.pod.id);
  const gameId = f.service.room(f.code).gameId;
  const game = (await f.domain.readScope('pod', f.pod.id)).games[gameId];
  // A retry resends the original payload, even after another request has saved it.
  const body = { order: game.starterIds.map(id => [id]), baseRevision: 0, requestId: 'confirmation_0001' };
  const results = await Promise.all(Array.from({ length: 3 }, () => f.tables.confirm('a', 'pod', f.pod.id, gameId, body)));
  assert.ok(results.every(item => item.revisions.length === 1));
  await assert.rejects(() => f.tables.confirm('a', 'pod', f.pod.id, gameId, { ...body, order: [...body.order].reverse() }), { status: 409 });
  const pod = await f.domain.getPod('a', f.pod.id);
  assert.ok(pod.members.every(member => member.gamesPlayed === 1));
});

test('duplicate source capture and confirmation leave the stored version and evidence unchanged', async () => {
  const f = await fixture(); await f.start(); f.finish(); await f.tables.reconcile('pod', f.pod.id);
  const gameId = f.service.room(f.code).gameId;
  const captured = await f.domain.readScope('pod', f.pod.id);
  const source = await f.ledger.readArchivedSource(gameId);
  const update = f.store.update.bind(f.store); let writes = 0;
  f.store.update = (path, change) => update(path, current => {
    const next = change(current); if (next !== current) writes++; return next;
  });
  await f.tables.capture('pod', f.pod.id, captured.games[gameId].tableKey, gameId, source);
  await assert.rejects(() => f.tables.capture('pod', f.pod.id, captured.games[gameId].tableKey, gameId,
    { ...source, completedAt: source.completedAt + 1 }), { code: 'SOURCE_CONFLICT' });
  assert.deepEqual(await f.domain.readScope('pod', f.pod.id), captured);
  assert.equal(writes, 0);
  const body = { order: captured.games[gameId].starterIds.map(id => [id]), baseRevision: 0, requestId: 'same_confirm_no_write' };
  const confirmed = await f.tables.confirm('a', 'pod', f.pod.id, gameId, body);
  const saved = await f.domain.readScope('pod', f.pod.id);
  assert.deepEqual(await f.tables.confirm('a', 'pod', f.pod.id, gameId, body), confirmed);
  assert.deepEqual(await f.domain.readScope('pod', f.pod.id), saved);
  assert.equal(writes, 1, 'Only the first confirmation writes; duplicates do not.');
});

test('life taps do not read, write or wait for a blocked competition save', { timeout: 5000 }, async t => {
  const f = await fixture(); await f.start();
  let release, entered;
  const blocked = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  t.after(() => release());
  const update = f.store.update.bind(f.store), read = f.store.read.bind(f.store);
  let reads = 0, writes = 0;
  f.store.read = (...args) => { reads++; return read(...args); };
  f.store.update = async (...args) => { writes++; entered(); await blocked; return update(...args); };
  const saving = f.domain.changeScope('pod', f.pod.id, scope => { scope.name = 'Saved later'; });
  await started;
  f.service.adjustOwnSeat(f.code, f.host, { counter: 'life', delta: -1 });
  assert.equal(f.service.room(f.code).seats[0].counters.life, 39);
  assert.deepEqual({ reads, writes }, { reads: 0, writes: 1 });
  release(); await saving;
});

test('a queued confirmation checks membership after an earlier queued departure commits', { timeout: 5000 }, async t => {
  const f = await fixture(); await f.start(); f.finish(); await f.tables.reconcile('pod', f.pod.id);
  const gameId = f.service.room(f.code).gameId;
  const game = (await f.domain.readScope('pod', f.pod.id)).games[gameId];
  let release, entered;
  const blocked = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; }); t.after(() => release());
  const update = f.store.update.bind(f.store);
  f.store.update = async (...args) => { entered(); await blocked; return update(...args); };
  const departure = f.domain.changeScope('pod', f.pod.id, scope => { scope.members[game.hostId].status = 'left'; });
  await started;
  const confirmation = assert.rejects(f.tables.confirm('a', 'pod', f.pod.id, gameId, {
    order: game.starterIds.map(id => [id]), baseRevision: 0, requestId: 'queued_member_departure',
  }), { status: 403, code: 'COMPETITION_ACCESS' });
  release(); await departure; await confirmation;
  assert.equal((await f.domain.readScope('pod', f.pod.id)).games[gameId].revisions.length, 0);
});

test('leaving after accepted start counts that game and return resumes the same rating', async () => {
  const f = await fixture(); await f.start();
  await f.domain.podMemberAction('b', f.pod.id, { action: 'leave' });
  f.finish(); await publish(f);
  await assert.rejects(() => f.domain.getPod('b', f.pod.id), { status: 403 });
  const invite = await f.domain.invite('a', 'pod', f.pod.id);
  const returned = await f.domain.joinPod('b', invite.token, { displayName: 'B' });
  const b = returned.members.find(member => member.name === 'B');
  assert.equal(b.ratedGames, 1); assert.equal(b.rating, 988);
});

test('leaving before accepted start excludes the former member from rating comparisons', async () => {
  const f = await fixture(); await f.domain.podMemberAction('b', f.pod.id, { action: 'leave' });
  await f.start(); f.finish(); const result = await publish(f);
  assert.equal(result.ratingChanges.length, 0);
  assert.equal(result.players.find(player => player.seatId === '2').kind, 'guest');
  const pod = await f.domain.getPod('a', f.pod.id);
  assert.equal(pod.members.find(member => member.name === 'A').ratedGames, 0);
});

test('whole Table session belongs to one scope, across successive games and a restart', async () => {
  const f = await fixture();
  const other = await f.domain.createPod('a', { name: 'Other', displayName: 'A' });
  await assert.rejects(() => f.tables.bind('a', { kind: 'pod', id: other.id, code: f.code, connectionId: f.host }), { status: 409 });
  await f.start(); f.finish(); await publish(f);
  const restarted = new CompetitionTables({ domain: new Competitions({ store: f.store }), service: f.service, ledger: f.ledger });
  await assert.rejects(() => restarted.bind('a', { kind: 'pod', id: other.id, code: f.code, connectionId: f.host }), { status: 409 });
});

test('archive survives source-cache eviction and a fresh RoomService; pending receipt repairs a missing archive', async () => {
  class FirstArchiveFails extends MemoryPlaytestLedger {
    complete(recap) { if (!this.failedOnce) { this.failedOnce = true; return; } return super.complete(recap); }
  }
  const f = await fixture({ ledger: new FirstArchiveFails() }); await f.start(); f.finish();
  const id = f.service.room(f.code).gameId;
  const originalRecap = structuredClone(f.service.room(f.code).completedGames[0].archiveRecap);
  delete originalRecap._competitionSource;
  assert.equal(await f.ledger.readArchivedSource(id), null);
  await f.tables.beforeProgress(f.code, f.host, 'begin-intermission');
  assert.equal((await f.ledger.readArchivedSource(id)).gameId, id);
  assert.deepEqual((await f.service.hostArchive(f.code, f.host)).playtests[0], originalRecap);
  f.service.room(f.code).completedGames = [];
  const restarted = new CompetitionTables({ domain: new Competitions({ store: f.store }), service: new RoomService({ ledger: f.ledger }), ledger: f.ledger });
  await restarted.reconcile('pod', f.pod.id);
  const state = await f.domain.readScope('pod', f.pod.id);
  assert.equal(state.games[id].gameId, id);
  assert.equal(state.tables[Object.keys(state.tables)[0]].captures[id].status, 'captured');
});

test('capture failure blocks progression but never a life tap or the existing private result proof', async () => {
  const f = await fixture(); await f.start();
  let reads = 0, writes = 0;
  const read = f.store.read.bind(f.store); const update = f.store.update.bind(f.store);
  f.store.read = async (...args) => { reads++; return read(...args); };
  f.store.update = async (...args) => { writes++; return update(...args); };
  f.service.adjustOwnSeat(f.code, f.host, { counter: 'life', delta: -1 });
  f.service.adjustOwnSeat(f.code, f.guest, { counter: 'life', delta: -40 });
  assert.deepEqual({ reads, writes }, { reads: 0, writes: 0 });
  assert.equal(f.service.completedSeat(f.code, f.host, f.service.room(f.code).gameId).game.tableSize, 2);
  f.store.update = async () => { throw new Error('Competition storage unavailable'); };
  await assert.rejects(() => f.tables.beforeProgress(f.code, f.host, 'reset'), /unavailable/);
  assert.ok(f.service.room(f.code).gameResult);
});

test('an interrupted accepted start retries the reserved game ID after restart without creating a second command', async () => {
  const f = await fixture(); await f.start();
  const gameId = f.service.room(f.code).gameId;
  const room = f.service.room(f.code);
  // Recovery saved the pre-start room while the independent command had committed.
  room.turn.gameStarted = false; room.lifecycle.status = 'lobby'; room.gameId = 'prestart_room_id';
  const restarted = new CompetitionTables({ domain: new Competitions({ store: f.store }), service: f.service, ledger: f.ledger });
  await restarted.start(f.code, f.host, { baseVersion: room.version });
  assert.equal(room.gameId, gameId);
  const state = await f.domain.readScope('pod', f.pod.id);
  assert.equal(Object.keys(state.tables[Object.keys(state.tables)[0]].captures).length, 1);
});

test('correction requires the original host or an admin, retains revisions and replays later ratings', async () => {
  const f = await fixture(); await f.start(); f.finish(); const first = await publish(f);
  const b = first.players.find(player => player.name === 'B');
  await assert.rejects(() => f.tables.confirm('b', 'pod', f.pod.id, first.gameId, {
    order: [[b.id], [first.players.find(player => player.name === 'A').id]], baseRevision: 1,
    requestId: 'correction_attempt', reasonCode: 'order_error',
  }), { status: 403 });
  await f.tables.beforeProgress(f.code, f.host, 'reset');
  f.service.resetRoom(f.code, f.host, { baseVersion: f.service.room(f.code).version });
  await f.start(); f.finish(); await publish(f, false, 'confirmation_0002');
  const before = (await f.domain.getPod('a', f.pod.id)).members.find(member => member.name === 'A').rating;
  const corrected = await f.tables.confirm('a', 'pod', f.pod.id, first.gameId, {
    order: [...first.revisions[0].order].reverse(), baseRevision: 1,
    requestId: 'correct_first_game', reasonCode: 'order_error',
  });
  assert.equal(corrected.revisions.length, 2);
  assert.equal(corrected.revisions[1].reasonCode, 'order_error');
  const current = await f.domain.getPod('a', f.pod.id);
  assert.notEqual(current.members.find(member => member.name === 'A').rating, before);
  assert.ok(current.members.every(member => member.gamesPlayed === 2));
});

test('normal next-game intermission seals a new game and a replacement host owns that game’s confirmation', async () => {
  const f = await fixture();
  const invite = await f.domain.invite('a', 'pod', f.pod.id);
  await f.domain.joinPod('c', invite.token, { displayName: 'C' });
  const c = f.service.createConnection().connectionId;
  f.service.claimSeat(f.code, c, { seatId: 3, name: 'C' });
  await f.tables.claim('c', { code: f.code, connectionId: c });
  await f.start(); f.finish(); const first = await publish(f);
  await f.tables.beforeProgress(f.code, f.host, 'begin-intermission');
  f.service.beginIntermission(f.code, f.host, { baseVersion: f.service.room(f.code).version });
  f.service.leaveIntermission(f.code, f.host, { baseVersion: f.service.room(f.code).version });
  for (const connectionId of [f.guest, c]) f.service.setNextGameReady(f.code, connectionId, { baseVersion: f.service.room(f.code).version });
  await f.tables.start(f.code, f.guest, { baseVersion: f.service.room(f.code).version });
  f.service.declareWinner(f.code, f.guest, { winnerSeatId: 2, baseVersion: f.service.room(f.code).version });
  await f.tables.reconcile('pod', f.pod.id);
  const scope = await f.domain.readScope('pod', f.pod.id); const next = scope.games[f.service.room(f.code).gameId];
  assert.notEqual(next.gameId, first.gameId);
  assert.equal(next.hostId, first.players.find(row => row.name === 'B').id);
  const result = await f.tables.confirm('b', 'pod', f.pod.id, next.gameId, { order: next.starterIds.map(id => [id]), baseRevision: 0, requestId: 'replacement_host_confirm' });
  assert.equal(result.revisions.length, 1);
});

test('seat ownership changing while a claim awaits storage never links the replacement owner to the previous account', async () => {
  const f = await fixture(); await f.start(); f.finish(); await publish(f);
  await f.tables.beforeProgress(f.code, f.host, 'begin-intermission');
  f.service.beginIntermission(f.code, f.host, { baseVersion: f.service.room(f.code).version });
  let resume, entered;
  const gate = new Promise(resolve => { resume = resolve; }); const waiting = new Promise(resolve => { entered = resolve; });
  const changeScope = f.domain.changeScope.bind(f.domain);
  f.domain.changeScope = async (...args) => { entered(); await gate; return changeScope(...args); };
  const claim = f.tables.claim('b', { code: f.code, connectionId: f.guest });
  await waiting;
  const oldHash = (await f.domain.readScope('pod', f.pod.id)).tables[Object.keys((await f.domain.readScope('pod', f.pod.id)).tables)[0]].seats[2].ownerHash;
  f.service.leaveIntermission(f.code, f.guest, { baseVersion: f.service.room(f.code).version });
  const replacement = f.service.createConnection().connectionId;
  f.service.claimSeat(f.code, replacement, { seatId: 2, name: 'Replacement' });
  resume(); await assert.rejects(() => claim, { status: 403 });
  const scope = await f.domain.readScope('pod', f.pod.id);
  assert.equal(scope.tables[Object.keys(scope.tables)[0]].seats[2].ownerHash, oldHash);
});

test('a concurrent life tap makes reset fail without abandoning the still-playable accepted game', async () => {
  const f = await fixture(); await f.start(); const id = f.service.room(f.code).gameId;
  const update = f.store.update.bind(f.store); let injected = false;
  f.store.update = async (path, change) => update(path, current => {
    const next = change(current);
    if (!injected && Object.values(next?.tables || {}).some(table => table.captures?.[id]?.resetIntent)) {
      injected = true; f.service.adjustOwnSeat(f.code, f.guest, { counter: 'life', delta: -1 });
    }
    return next;
  });
  await assert.rejects(() => f.tables.reset(f.code, f.host, { baseVersion: f.service.room(f.code).version }), { code: 'VERSION_CONFLICT' });
  f.finish(); await publish(f);
  assert.equal((await f.domain.getPod('a', f.pod.id)).members[0].gamesPlayed, 1);
});

test('erasure before a pending start cannot reintroduce the deleted player’s name through a guest fallback', async () => {
  const f = await fixture(); await f.domain.eraseAccount('b');
  await f.start(); f.finish(); const result = await publish(f);
  assert.equal(result.players.find(row => row.seatId === '2').name, 'Deleted member');
  assert.equal(JSON.stringify((await f.domain.directory()).aliases).includes('"name":"B"'), false);
});

test('an in-flight signed-in seat registration finishes before an accepted start can freeze eligibility', async () => {
  const f = await fixture();
  const invite = await f.domain.invite('a', 'pod', f.pod.id);
  await f.domain.joinPod('c', invite.token, { displayName: 'C' });
  const connectionId = f.service.createConnection().connectionId;
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }); const waiting = new Promise(resolve => { entered = resolve; });
  const claim = f.tables.claim.bind(f.tables);
  f.tables.claim = async (...args) => { entered(); await gate; return claim(...args); };
  const joining = f.tables.claimRoom(f.code, connectionId, { seatId: 3, name: 'C' }, async () => 'c');
  await waiting;
  let started = false;
  const starting = f.start().then(result => { started = true; return result; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(started, false);
  release(); await joining; await starting; f.finish(); await publish(f);
  const pod = await f.domain.getPod('a', f.pod.id);
  assert.equal(pod.members.find(row => row.name === 'C').ratedGames, 1);
});

test('a recovered optional claim failure cannot strand an ordinary unbound casual Table', async () => {
  const domain = new Competitions({ store: new MemoryAccountHistoryStore() });
  const service = new RoomService({ ledger: new MemoryPlaytestLedger() });
  const tables = new CompetitionTables({ domain, service, ledger: service.ledger });
  const host = service.createConnection().connectionId, other = service.createConnection().connectionId;
  const code = service.createRoom(host, { playerCount: 2, startingLife: 40 }).snapshot.code;
  const read = domain.directory.bind(domain); let failed = false;
  domain.directory = async () => { if (!failed) { failed = true; throw new Error('Transient optional store failure'); } return read(); };
  const joined = await tables.claimRoom(code, other, { seatId: 1, name: 'Casual guest' }, async () => 'signed_in_guest');
  assert.ok(joined.competitionWarning); assert.equal(tables.unresolvedClaims.size, 1);
  assert.deepEqual(await tables.context({}, code, other), { linked: false });
  await tables.start(code, host, { baseVersion: service.room(code).version });
  assert.equal(service.room(code).turn.gameStarted, true); assert.equal(tables.unresolvedClaims.size, 0);
});
