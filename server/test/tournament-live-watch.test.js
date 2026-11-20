import assert from 'node:assert/strict';
import test from 'node:test';
import { Competitions } from '../src/competitions.js';
import { Tournaments } from '../src/tournaments.js';
import { CompetitionTables } from '../src/competition-tables.js';
import { TournamentSpectators } from '../src/tournament-spectators.js';
import { RoomService } from '../src/app.js';
import { MemoryAccountHistoryStore } from '../src/account-history.js';
import { MemoryPlaytestLedger } from '../src/playtest-ledger.js';

async function fixture({ start = true, count = 4 } = {}) {
  let now = 1_800_000_000_000;
  const store = new MemoryAccountHistoryStore(), ledger = new MemoryPlaytestLedger();
  const domain = new Competitions({ store, now: () => now });
  const tournaments = new Tournaments({ domain }), service = new RoomService({ ledger, now: () => now });
  const tables = new CompetitionTables({ domain, service, ledger, tournaments }); tournaments.tables = tables;
  const spectators = new TournamentSpectators({ domain, tournaments, tables }), host = { accountId: 'organizer' };
  const event = await tournaments.create(host.accountId, { name: 'Private Friday', displayName: 'Host', rounds: 2, minutes: 60 });
  const invite = await domain.invite(host.accountId, 'tournament', event.id), entrants = [];
  for (let i = 0; i < count; i++) entrants.push(await tournaments.join(`account_${i}`, invite.token, { displayName: `Alias ${i}` }));
  const prepared = await tournaments.prepareRound(host, event.id), assignment = prepared.rounds[0].assignments[0];
  await tournaments.startRound(host, event.id, { roundId: prepared.rounds[0].id, baseVersion: prepared.version });
  const accounts = assignment.participantIds.map(id => `account_${entrants.findIndex(row => row.me === id)}`);
  const aliases = assignment.participantIds.map(id => `Alias ${entrants.findIndex(row => row.me === id)}`);
  const connections = accounts.map(() => service.createConnection({ supportedTableProtocols: [1, 2] }).connectionId);
  const created = service.createRoom(connections[0], { playerCount: count, startingLife: 40, commanderCount: 2, commanderNames: ['Veyran', 'Partner'], name: 'Private room name' });
  const code = created.snapshot.code;
  for (let i = 1; i < connections.length; i++) service.claimSeat(code, connections[i], { seatId: i, name: `Private name ${i}`, commanderNames: [`Commander ${i}`] });
  await tables.bind(accounts[0], { kind: 'tournament', id: event.id, assignmentId: assignment.id, code, connectionId: connections[0] });
  for (let i = 1; i < connections.length; i++) await tables.claim(accounts[i], { code, connectionId: connections[i] });
  const room = service.rooms.get(code);
  if (start) await tables.start(code, connections[0], { baseVersion: room.version });
  const issued = await spectators.change(host, event.id, { action: 'create' });
  const watch = (token = issued.viewerToken, selection = { roundNumber: 1, tableNumber: 1 }) => spectators.watch(event.id, token, selection);
  return { store, ledger, domain, tournaments, service, tables, spectators, host, event, assignment, room, code, connections, issued, created, watch, aliases,
    now: () => now, advance: ms => { now += ms; } };
}

test('private table watch needs its own valid event viewer capability on every read', async () => {
  const f = await fixture();
  for (const token of [null, '', 'organizer', f.created.reclaimToken, f.created.hostRecoveryKey, 'x'.repeat(43)]) {
    await assert.rejects(() => f.watch(token), { status: 403, code: 'EVENT_VIEWER_ACCESS' });
  }
  const other = await f.tournaments.create(f.host.accountId, { name: 'Other', displayName: 'Host' });
  await assert.rejects(() => f.spectators.watch(other.id, f.issued.viewerToken, { roundNumber: 1, tableNumber: 1 }), { status: 403 });
  assert.equal((await f.watch()).status, 'playing');
  await f.spectators.change(f.host, f.event.id, { action: 'revoke' });
  await assert.rejects(() => f.watch(), { status: 403, code: 'EVENT_VIEWER_ACCESS' });
  const fresh = await f.spectators.change(f.host, f.event.id, { action: 'create' });
  f.advance(86_400_000);
  await assert.rejects(() => f.watch(fresh.viewerToken), { status: 403, code: 'EVENT_VIEWER_ACCESS' });
});

test('table watch rejects invalid selectors and rechecks the issuing organizer identity', async () => {
  const f = await fixture();
  for (const selection of [{}, { roundNumber: 0, tableNumber: 1 }, { roundNumber: 1, tableNumber: 0 },
    { roundNumber: 1.2, tableNumber: 1 }, { roundNumber: '01', tableNumber: 1 }, { roundNumber: 1, tableNumber: [] }]) {
    await assert.rejects(() => f.watch(f.issued.viewerToken, selection), { status: 400 });
  }
  await assert.rejects(() => f.watch(f.issued.viewerToken, { roundNumber: 99, tableNumber: 1 }), { status: 404 });
  await f.domain.changeScope('tournament', f.event.id, scope => { scope.members[scope.creatorId].role = 'participant'; });
  await assert.rejects(() => f.watch(), { status: 403, code: 'EVENT_VIEWER_ACCESS' });
});

test('watch redacts erased entrant aliases and rejects an erased link issuer on the next read', async () => {
  const f = await fixture();
  assert.equal((await f.watch()).seats[0].alias, f.aliases[0]);
  await f.domain.eraseAccount(`account_${f.aliases[0].split(' ').at(-1)}`);
  const dto = await f.watch();
  assert.equal(dto.status, 'playing'); assert.equal(dto.seats[0].alias, 'Deleted member');
  assert.equal(dto.participants[0].alias, 'Deleted member');
  assert.equal(JSON.stringify(dto).includes(f.aliases[0]), false);
  await f.domain.eraseAccount(f.host.accountId);
  await assert.rejects(() => f.watch(), { status: 403, code: 'EVENT_VIEWER_ACCESS' });
});

test('selected Table name lookups include only its assigned entrants and link issuer', async () => {
  const f = await fixture({ count: 8 });
  const read = f.domain.directory.bind(f.domain), lookedUp = [];
  f.domain.directory = (scope, ...args) => { lookedUp.push(Object.keys(scope.members)); return read(scope, ...args); };
  const dto = await f.watch(); assert.equal(dto.status, 'playing');
  assert.equal(lookedUp.length, 1);
  const scope = await f.domain.readScope('tournament', f.event.id);
  assert.deepEqual(new Set(lookedUp[0]), new Set([scope.spectatorLink.by, ...f.assignment.participantIds]));
  assert.ok(lookedUp[0].length <= 9);
});

test('watch exposes only live gameplay allowlist and leaves rooms, ownership, activity, storage, ledger and streams unchanged', async () => {
  const f = await fixture();
  f.service.adjustOwnSeat(f.code, f.connections[1], { counter: 'commanderDamage', commanderSourceId: 'seat-0-commander-b', delta: 6 });
  f.service.adjustOwnSeat(f.code, f.connections[2], { counter: 'commanderDamage', commanderSourceId: 'seat-1-commander-a', delta: 7 });
  f.service.mutateOwnSeat(f.code, f.connections[0], { baseVersion: f.room.version, commanderCastCounts: { 'seat-0-commander-a': 2 } });
  f.room.seats[0].counters.privateDeckNote = 'NEVER RETURN';
  f.room.seats[0].commanderDamageReceived['private-source'] = 100;
  f.room.privateNotes = 'NEVER RETURN';
  f.room.seats[0].privateDeck = 'NEVER RETURN';
  f.advance(5000);
  const beforeRoom = structuredClone(f.room), beforeConnections = structuredClone(f.service.connections);
  const beforeStore = structuredClone(f.store.values), beforeLedger = structuredClone(f.ledger);
  for (const name of ['room', 'ensureRoom', 'restoreRoom', 'heartbeat', 'broadcast', 'snapshot', 'requireOwner']) {
    f.service[name] = () => { throw new Error(`Watch called mutating/private room method ${name}`); };
  }
  f.store.update = () => { throw new Error('Watch must never write storage'); };
  f.ledger.readRecovery = () => { throw new Error('Watch must never recover rooms'); };
  const dto = await f.watch();
  assert.equal(dto.name, 'Private Friday'); assert.equal(dto.status, 'playing'); assert.equal(dto.hasLiveTotals, true);
  assert.equal(dto.serverNow, f.now()); assert.equal(dto.expiresAt, f.issued.expiresAt);
  assert.equal(dto.seats.length, 4); assert.deepEqual(dto.seats.map(row => row.seatNumber), [1, 2, 3, 4]);
  assert.deepEqual(dto.seats.map(row => row.alias), f.aliases);
  assert.equal(dto.seats[1].counters.life, 34);
  assert.equal(dto.seats[1].commanderDamageReceived.find(row => row.seatNumber === 1 && row.commanderNumber === 2).damage, 6);
  assert.equal(dto.seats[2].commanderDamageReceived.find(row => row.seatNumber === 2 && row.commanderNumber === 1).damage, 7);
  assert.deepEqual(dto.seats[0].commanders[0], { commanderNumber: 1, name: 'Veyran', colors: [], castCount: 2, tax: 4 });
  assert.deepEqual(dto.seats[0].counters, { life: 40, radiation: 0, poison: 0, energy: 0, generic: 0 });
  assert.equal(dto.turn.activeSeatNumber, 1); assert.equal(dto.turn.gameElapsedMs, 5000); assert.equal(dto.turn.turnElapsedMs, 5000);
  const json = JSON.stringify(dto);
  for (const secret of [f.code, f.created.reclaimToken, f.created.hostRecoveryKey, f.room.gameId, ...f.connections, ...f.assignment.participantIds]) assert.equal(json.includes(secret), false, secret);
  assert.equal(/NEVER RETURN|Private name|Private room|private-source|ownerHash|ownerConnectionId|identityId|participantId|roomCode|hostId|tokenHash|tableIdentity|sourceGameId/.test(json), false);
  assert.deepEqual(structuredClone(f.room), beforeRoom); assert.deepEqual(f.service.connections, beforeConnections); assert.deepEqual(f.store.values, beforeStore);
  delete f.ledger.readRecovery;
  assert.deepEqual(structuredClone(f.ledger), beforeLedger);
});

test('a fully disconnected loaded game stays watchable but missing and expired rooms are never revived or renewed', async () => {
  const f = await fixture();
  const lastActiveAt = f.room.lastActiveAt;
  f.advance(f.service.connectionTtlMs + 1);
  f.service.sweep();
  assert.equal(f.service.connections.size, 0); assert.ok(f.room.seats.every(seat => seat.ownerConnectionId === null));
  assert.equal((await f.watch()).status, 'playing'); assert.equal(f.room.lastActiveAt, lastActiveAt);
  f.room.lastActiveAt = f.now() - f.service.roomTtlMs - 1;
  const expired = await f.watch();
  assert.equal(expired.status, 'unavailable'); assert.equal(expired.availabilityReason, 'room_unavailable'); assert.deepEqual(expired.seats, []);
  f.service.rooms.delete(f.code);
  f.service.ensureRoom = () => { throw new Error('No revival'); };
  assert.equal((await f.watch()).status, 'unavailable'); assert.equal(f.service.rooms.has(f.code), false);
});

test('same code replacement, changed game, mismatched accepted roster and released assignment never expose another match', async () => {
  const f = await fixture(), original = structuredClone(f.room);
  f.room.hostRecoveryKeyHash = Buffer.from('different table');
  assert.equal((await f.watch()).availabilityReason, 'replaced');
  Object.assign(f.room, structuredClone(original));
  f.room.gameId = 'different-game';
  assert.equal((await f.watch()).status, 'unavailable');
  Object.assign(f.room, structuredClone(original));
  await f.domain.changeScope('tournament', f.event.id, scope => {
    const table = Object.values(scope.tables)[0]; table.captures[f.room.gameId].seats[0].participantId = 'different_participant';
  });
  assert.equal((await f.watch()).status, 'unavailable');
  await f.domain.changeScope('tournament', f.event.id, scope => { Object.values(scope.tables)[0].releasedAt = f.now(); });
  const released = await f.watch(); assert.equal(released.status, 'unavailable'); assert.deepEqual(released.seats, []);
});

test('an exact accepted game also needs matching command identity, assignment, status and current ownership proof', async () => {
  const f = await fixture();
  const original = await f.domain.readScope('tournament', f.event.id);
  for (const mutation of [
    command => { command.tableIdentity = 'unrelated table'; },
    command => { command.assignmentId = 'unrelated assignment'; },
    command => { command.roomCode = 'OTHER1'; },
    command => { command.status = 'cancelled'; },
    command => { command.status = 'abandoned'; },
    command => { command.gameId = 'unrelated game'; },
    command => { command.seats[0].ownerHash = 'unrelated seat'; },
    command => { command.seats[1].seatId = command.seats[0].seatId; },
  ]) {
    await f.domain.changeScope('tournament', f.event.id, scope => {
      scope.tables = structuredClone(original.tables); mutation(Object.values(scope.tables)[0].captures[f.room.gameId]);
    });
    const dto = await f.watch(); assert.equal(dto.status, 'unavailable'); assert.deepEqual(dto.seats, []); assert.equal(dto.result, null);
  }
});

test('unstarted linked tables wait without exposing setup counters', async () => {
  const f = await fixture({ start: false });
  const dto = await f.watch();
  assert.equal(dto.status, 'ready'); assert.equal(dto.availabilityReason, 'not_started');
  assert.equal(dto.hasLiveTotals, false); assert.deepEqual(dto.seats, []); assert.equal(dto.turn, null);
});

test('an assignment awaiting its first Table waits, while a lost binding with an accepted start stays unavailable', async () => {
  const fresh = await fixture({ start: false });
  await fresh.domain.changeScope('tournament', fresh.event.id, scope => { scope.tables = {}; });
  const waiting = await fresh.watch(); assert.equal(waiting.status, 'ready'); assert.equal(waiting.availabilityReason, 'not_started');
  const started = await fixture();
  await started.domain.changeScope('tournament', started.event.id, scope => { delete Object.values(scope.tables)[0].assignmentId; });
  const unavailable = await started.watch(); assert.equal(unavailable.status, 'unavailable'); assert.deepEqual(unavailable.seats, []);
});

test('host pause freezes game and turn elapsed time while official event deadline continues', async () => {
  const f = await fixture();
  const deadline = (await f.watch()).timing.endsAt;
  f.advance(5000);
  f.service.setTurnPaused(f.code, f.connections[0], { paused: true, baseVersion: f.room.version });
  f.advance(7000);
  const paused = await f.watch();
  assert.equal(paused.turn.gameElapsedMs, 5000); assert.equal(paused.turn.turnElapsedMs, 5000);
  assert.equal(paused.turn.pausedAt, f.now() - 7000); assert.equal(paused.timing.endsAt, deadline);
  f.service.setTurnPaused(f.code, f.connections[0], { paused: false, baseVersion: f.room.version });
  f.advance(3000);
  const resumed = await f.watch(); assert.equal(resumed.turn.gameElapsedMs, 8000); assert.equal(resumed.turn.turnElapsedMs, 8000);
  assert.equal(resumed.timing.endsAt, deadline);
  f.advance(deadline - f.now());
  await f.tournaments.clock(f.host, f.event.id, f.assignment.id, { action: 'time_called', requestId: 'watch_time_called' });
  const called = await f.watch(); assert.equal(called.timing.phase, 'current_turn'); assert.equal(called.timing.remaining, 5);
});

test('eliminations, pending finish and declared results are observable without leaking private details', async () => {
  const f = await fixture();
  f.service.eliminatePlayer(f.code, f.connections[0], { targetSeatId: 2, reason: 'milled_out', detail: 'PRIVATE elimination note', baseVersion: f.room.version });
  let dto = await f.watch(); assert.equal(dto.seats[2].eliminated, true); assert.equal(dto.seats[2].eliminationReason, 'milled_out');
  f.service.adjustOwnSeat(f.code, f.connections[1], { counter: 'life', delta: -40 });
  f.service.adjustOwnSeat(f.code, f.connections[3], { counter: 'poison', delta: 10 });
  dto = await f.watch(); assert.equal(dto.pendingFinish.winnerSeatNumber, 1); assert.equal(dto.result, null);
  assert.equal(dto.seats[1].eliminationReason, 'life'); assert.equal(dto.seats[3].eliminationReason, 'poison');
  assert.equal(JSON.stringify(dto).includes('PRIVATE'), false);
  // Completion is an explicit gameplay operation, never a side effect of watch.
  f.advance(16_000); f.service.finishExpiredElimination(f.room);
  await f.tables.reconcile('tournament', f.event.id);
  dto = await f.watch(); assert.equal(dto.status, 'complete'); assert.equal(dto.result.winnerSeatNumber, 1);
  assert.equal(dto.result.winnerAlias, dto.seats[0].alias); assert.equal(dto.resultStatus, 'awaiting_confirmation'); assert.equal(dto.hasLiveTotals, true);
});

test('next-game setup never passes its reset counters off as the completed game totals', async () => {
  const f = await fixture();
  f.service.adjustOwnSeat(f.code, f.connections[0], { counter: 'life', delta: -9 });
  f.service.declareWinner(f.code, f.connections[0], { winnerSeatId: 0, declarationDetail: 'PRIVATE outcome', baseVersion: f.room.version });
  await f.tables.reconcile('tournament', f.event.id);
  const finished = await f.watch(); assert.equal(finished.seats[0].counters.life, 31);
  await f.tables.confirm(f.host, 'tournament', f.event.id, f.room.gameId, {
    order: f.assignment.participantIds.map(id => [id]), baseRevision: 0, requestId: 'confirm_watch_game',
  });
  f.service.beginIntermission(f.code, f.connections[0], { baseVersion: f.room.version });
  assert.equal(f.room.seats[0].counters.life, 40);
  const intermission = await f.watch();
  assert.equal(intermission.status, 'complete'); assert.equal(intermission.availabilityReason, 'finished');
  assert.equal(intermission.hasLiveTotals, false); assert.deepEqual(intermission.seats, []); assert.equal(intermission.turn, null);
  assert.equal(intermission.result.winnerSeatNumber, 1); assert.equal(intermission.result.winnerAlias, finished.seats[0].alias);
  assert.equal(intermission.resultStatus, 'confirmed'); assert.equal(JSON.stringify(intermission).includes('PRIVATE'), false);
});

test('host corrections use the latest confirmed winner and tied placements in complete and intermission views', async () => {
  const f = await fixture();
  f.service.declareWinner(f.code, f.connections[0], { winnerSeatId: 0, baseVersion: f.room.version });
  await f.tables.reconcile('tournament', f.event.id);
  const initial = await f.watch(); assert.equal(initial.result.winnerAlias, f.aliases[0]);
  const ids = f.assignment.participantIds;
  await f.tables.confirm(f.host, 'tournament', f.event.id, f.room.gameId, {
    order: [[ids[1]], [ids[0]], [ids[2], ids[3]]], baseRevision: 0, requestId: 'confirm_corrected_winner',
  });
  const corrected = await f.watch(); assert.equal(corrected.result.winnerAlias, f.aliases[1]);
  assert.equal(corrected.result.winnerSeatNumber, 2); assert.equal(corrected.resultStatus, 'confirmed');
  assert.deepEqual(corrected.result.placementGroups.map(group => [...group].sort()), [[2], [1], [3, 4]]);
  f.service.beginIntermission(f.code, f.connections[0], { baseVersion: f.room.version });
  assert.equal((await f.watch()).result.winnerAlias, f.aliases[1]);
});
