import assert from 'node:assert/strict';
import test from 'node:test';
import { Competitions } from '../src/competitions.js';
import { Tournaments } from '../src/tournaments.js';
import { CompetitionTables } from '../src/competition-tables.js';
import { RoomService } from '../src/app.js';
import { MemoryAccountHistoryStore } from '../src/account-history.js';
import { MemoryPlaytestLedger } from '../src/playtest-ledger.js';
import { digest } from '../src/competition-values.js';

function open(store = new MemoryAccountHistoryStore()) {
  const ledger = new MemoryPlaytestLedger(), domain = new Competitions({ store, now: () => 1000 });
  const tournaments = new Tournaments({ domain }), service = new RoomService({ ledger, now: () => 1000 });
  const tables = new CompetitionTables({ domain, service, ledger, tournaments }); tournaments.tables = tables;
  return { store, ledger, domain, tournaments, service, tables, host: { accountId: 'organizer' } };
}
async function fixture({ count = 4, rounds = 2, minutes = null } = {}) {
  const f = open();
  f.event = await f.tournaments.create('organizer', { name: 'Weekly', displayName: 'Host', rounds, minutes });
  f.invite = await f.domain.invite('organizer', 'tournament', f.event.id);
  f.entrants = [];
  for (let index = 0; index < count; index++) f.entrants.push(await f.tournaments.join(`account_${index}`, f.invite.token, { displayName: `Player ${index}` }));
  return f;
}
const account = (f, id) => `account_${f.entrants.findIndex(row => row.me === id)}`;
async function prepare(f, { start = false } = {}) {
  let event = await f.tournaments.prepareRound(f.host, f.event.id);
  if (start) event = await f.tournaments.startRound(f.host, f.event.id, { roundId: event.rounds.at(-1).id, baseVersion: event.version });
  return event;
}
async function link(f, assignment) {
  const connections = assignment.participantIds.map(() => f.service.createConnection({ supportedTableProtocols: [1, 2] }).connectionId);
  const created = f.service.createRoom(connections[0], { playerCount: assignment.participantIds.length, startingLife: 40 });
  const code = created.snapshot.code;
  for (let i = 1; i < connections.length; i++) f.service.claimSeat(code, connections[i], { seatId: i });
  await f.tables.bind(account(f, assignment.hostId), { kind: 'tournament', id: f.event.id, assignmentId: assignment.id, code, connectionId: connections[0] });
  for (let i = 1; i < connections.length; i++) await f.tables.claim(account(f, assignment.participantIds[i]), { code, connectionId: connections[i] });
  return { code, connections, room: f.service.room(code) };
}
async function finish(f, assignment) {
  const table = await link(f, assignment);
  await f.tables.start(table.code, table.connections[0], { baseVersion: table.room.version });
  f.service.declareWinner(table.code, table.connections[0], { winnerSeatId: 0, baseVersion: table.room.version });
  await f.tables.reconcile('tournament', f.event.id);
  await f.tables.confirm(f.host, 'tournament', f.event.id, table.room.gameId, {
    order: assignment.participantIds.map(id => [id]), baseRevision: 0, requestId: `confirm_${assignment.id}`,
  });
}

test('saving unchanged seating preserves its linked assignment and seat proofs', async () => {
  const f = await fixture(), prepared = await prepare(f), assignment = prepared.rounds[0].assignments[0];
  const table = await link(f, assignment), current = await f.tournaments.get(f.host, f.event.id);
  const before = await f.domain.readScope('tournament', f.event.id);
  const saved = await f.tournaments.editSeating(f.host, f.event.id, { roundId: current.rounds[0].id, baseVersion: current.version,
    tables: current.rounds[0].assignments.map(row => row.participantIds) });
  assert.equal(saved.rounds[0].assignments[0].id, assignment.id);
  assert.equal(saved.rounds[0].assignments[0].roomCode, table.code);
  assert.deepEqual((await f.domain.readScope('tournament', f.event.id)).tables, before.tables);
  await f.tournaments.startRound(f.host, f.event.id, { roundId: saved.rounds[0].id, baseVersion: saved.version });
  await f.tables.start(table.code, table.connections[0], { baseVersion: table.room.version });
  assert.equal(table.room.turn.gameStarted, true);
});

test('changing a linked group or host is rejected without orphaning its Table', async () => {
  const f = await fixture({ count: 8 }), prepared = await prepare(f), assignment = prepared.rounds[0].assignments[0];
  await link(f, assignment);
  const current = await f.tournaments.get(f.host, f.event.id), groups = current.rounds[0].assignments.map(row => [...row.participantIds]);
  [groups[0][1], groups[1][1]] = [groups[1][1], groups[0][1]];
  const before = await f.domain.readScope('tournament', f.event.id);
  await assert.rejects(() => f.tournaments.editSeating(f.host, f.event.id, { roundId: current.rounds[0].id, baseVersion: current.version, tables: groups }), { code: 'EVENT_TABLE_LINKED' });
  assert.deepEqual(await f.domain.readScope('tournament', f.event.id), before);
  const changedHost = current.rounds[0].assignments.map(row => [...row.participantIds]); changedHost[0].reverse();
  await assert.rejects(() => f.tournaments.editSeating(f.host, f.event.id, { roundId: current.rounds[0].id, baseVersion: current.version, tables: changedHost }), { code: 'EVENT_TABLE_LINKED' });
});

test('reseed preserves an unchanged linked group or clearly refuses the changed linked setup', async () => {
  const f = await fixture({ count: 8 }), prepared = await prepare(f), assignment = prepared.rounds[0].assignments[0];
  const table = await link(f, assignment), current = await f.tournaments.get(f.host, f.event.id);
  try {
    const result = await f.tournaments.prepareRound(f.host, f.event.id, { reseed: true, baseVersion: current.version });
    const retained = result.rounds[0].assignments.find(row => row.id === assignment.id);
    assert.ok(retained, 'A linked assignment must survive reseeding with its original identity');
    assert.equal(retained.hostId, assignment.hostId); assert.equal(retained.roomCode, table.code);
    assert.deepEqual(new Set(retained.participantIds), new Set(assignment.participantIds));
  } catch (error) { assert.equal(error.code, 'EVENT_TABLE_LINKED'); }
});

test('unaffected linked assignments survive edits to another unlinked group', async () => {
  const f = await fixture({ count: 8 }), prepared = await prepare(f), assignment = prepared.rounds[0].assignments[0];
  await link(f, assignment);
  const current = await f.tournaments.get(f.host, f.event.id), groups = current.rounds[0].assignments.map(row => [...row.participantIds]);
  groups[1].reverse();
  const result = await f.tournaments.editSeating(f.host, f.event.id, { roundId: current.rounds[0].id, baseVersion: current.version, tables: groups });
  assert.equal(result.rounds[0].assignments[0].id, assignment.id);
  assert.notEqual(result.rounds[0].assignments[1].id, current.rounds[0].assignments[1].id);
});

test('creation retries survive a fresh coordinator and concurrent requests without duplicate events', async () => {
  const f = open(), input = { name: 'Weekly', displayName: 'Host', rounds: 2, minutes: 30, requestId: 'create_weekly_123' };
  const results = await Promise.all([f.tournaments.create('organizer', input), open(f.store).tournaments.create('organizer', input)]);
  const retry = await open(f.store).tournaments.create('organizer', input);
  assert.equal(results[0].id, results[1].id); assert.equal(retry.id, results[0].id); assert.equal(retry.me, results[0].me);
  assert.equal([...f.store.values.keys()].filter(key => key.startsWith('competitions/tournaments/')).length, 1);
  await assert.rejects(() => open(f.store).tournaments.create('organizer', { ...input, minutes: 45 }), { code: 'TOURNAMENT_CREATE_RETRY_CONFLICT' });
  assert.equal((await f.tournaments.get(f.host, results[0].id)).members[0].name, 'Host');
  const scope = await f.domain.readScope('tournament', results[0].id);
  await f.domain.setAlias(scope.members[scope.creatorId].identityId, scope.id, scope.creatorId, 'Current name');
  const unchanged = await f.tournaments.create('organizer', input);
  assert.equal(unchanged.members.find(row => row.id === unchanged.me).name, 'Current name');
  assert.equal(unchanged.version, results[0].version);
  await assert.rejects(() => f.tournaments.create('organizer', { ...input, requestId: 'bad' }), { status: 400 });
});

test('creation can resume after its durable reservation was saved but scope creation failed', async () => {
  const f = open(), input = { name: 'Weekly', displayName: 'Host', requestId: 'create_recovery_123' };
  const createScope = f.domain.createScope.bind(f.domain); let interrupted = true;
  f.domain.createScope = (...args) => { if (interrupted) { interrupted = false; throw new Error('fixture interruption'); } return createScope(...args); };
  await assert.rejects(() => f.tournaments.create('organizer', input), /fixture interruption/);
  const resumed = await open(f.store).tournaments.create('organizer', input), retry = await f.tournaments.create('organizer', input);
  assert.equal(resumed.id, retry.id);
  assert.equal([...f.store.values.keys()].filter(key => key.startsWith('competitions/tournaments/')).length, 1);
});

test('a player who left before play rejoins the original active entry', async () => {
  const f = await fixture(); const original = f.entrants[0].me;
  await f.tournaments.memberAction({ accountId: 'account_0' }, f.event.id, { action: 'leave' });
  const joined = await f.tournaments.join('account_0', f.invite.token, { displayName: 'Player 0' });
  assert.equal(joined.me, original); assert.equal(joined.members.find(row => row.id === original).status, 'active');
  assert.equal(joined.members.filter(row => row.id === original).length, 1);
});

test('between rounds withdrawn entrants retain points and need approval on self rejoin; hosts can restore', async () => {
  const f = await fixture(), event = await prepare(f, { start: true });
  for (const assignment of event.rounds[0].assignments) await finish(f, assignment);
  const before = await f.tournaments.get(f.host, f.event.id), entrant = before.standings[0], entrantAccount = account(f, entrant.id);
  await f.tournaments.memberAction({ accountId: entrantAccount }, f.event.id, { action: 'leave' });
  const pending = await f.tournaments.join(entrantAccount, f.invite.token, { displayName: entrant.name });
  assert.equal(pending.me, entrant.id); assert.equal(pending.members.find(row => row.id === entrant.id).status, 'pending');
  await f.tournaments.memberAction(f.host, f.event.id, { action: 'approve', targetId: entrant.id });
  await f.tournaments.memberAction(f.host, f.event.id, { action: 'leave', targetId: entrant.id });
  const restored = await f.tournaments.memberAction(f.host, f.event.id, { action: 'restore', targetId: entrant.id });
  const row = restored.standings.find(row => row.id === entrant.id);
  assert.equal(row.status, 'active'); assert.equal(row.pointsUnits, entrant.pointsUnits); assert.equal(row.gamesPlayed, entrant.gamesPlayed);
  await assert.rejects(() => f.tournaments.memberAction({ accountId: 'account_1' }, f.event.id, { action: 'restore', targetId: entrant.id }), { status: 403 });
});

test('restoration during a playing round and withdrawal from a completed event are rejected', async () => {
  const f = await fixture({ rounds: 1 }); const withdrawn = f.entrants[0].me;
  await f.tournaments.memberAction(f.host, f.event.id, { action: 'leave', targetId: withdrawn });
  const event = await prepare(f, { start: true });
  await assert.rejects(() => f.tournaments.memberAction(f.host, f.event.id, { action: 'restore', targetId: withdrawn }), { code: 'ENTRY_BETWEEN_ROUNDS' });
  for (const assignment of event.rounds[0].assignments) await finish(f, assignment);
  const before = await f.domain.readScope('tournament', f.event.id);
  await assert.rejects(() => f.tournaments.memberAction(f.host, f.event.id, { action: 'leave', targetId: f.entrants[1].me }), { code: 'EVENT_COMPLETED' });
  assert.deepEqual(await f.domain.readScope('tournament', f.event.id), before);
});

test('an event host can release an unstarted assignment for a replacement Table while preserving its old claim', async () => {
  const f = await fixture(), prepared = await prepare(f), assignment = prepared.rounds[0].assignments[0], table = await link(f, assignment);
  const key = digest(Buffer.from(table.room.hostRecoveryKeyHash).toString('base64'));
  const claim = await f.domain.tableBinding(key), snapshot = f.service.snapshot(table.room);
  await assert.rejects(() => f.tables.releaseTournamentAssignment({ accountId: account(f, assignment.hostId) }, f.event.id, assignment.id), { status: 403 });
  const released = await f.tables.releaseTournamentAssignment(f.host, f.event.id, assignment.id);
  assert.equal(released.rounds[0].assignments[0].roomCode, null);
  assert.deepEqual(await f.domain.tableBinding(key), claim); assert.deepEqual(f.service.snapshot(table.room), snapshot);
  await assert.rejects(() => f.tables.start(table.code, table.connections[0], { baseVersion: table.room.version }), { code: 'EVENT_TABLE_RELEASED' });
  await assert.rejects(() => f.tables.bind(account(f, assignment.hostId), { kind: 'tournament', id: f.event.id, code: table.code, connectionId: table.connections[0], assignmentId: assignment.id }), { code: 'EVENT_TABLE_RELEASED' });
  const context = await f.tables.context(account(f, assignment.hostId), table.code, table.connections[0]);
  assert.equal(context.released, true); assert.equal(context.assignmentId, null);
  const replacement = await link(f, assignment), current = await f.tournaments.get(f.host, f.event.id);
  await f.tournaments.startRound(f.host, f.event.id, { roundId: current.rounds[0].id, baseVersion: current.version });
  await f.tables.start(replacement.code, replacement.connections[0], { baseVersion: replacement.room.version });
  assert.equal(replacement.room.turn.gameStarted, true);
});

test('release refuses accepted or actual starts and unverifiable expired Tables', async () => {
  const f = await fixture(), event = await prepare(f, { start: true }), assignment = event.rounds[0].assignments[0], table = await link(f, assignment);
  const scope = await f.domain.readScope('tournament', f.event.id), key = Object.keys(scope.tables)[0];
  await f.domain.changeScope('tournament', f.event.id, state => { state.tables[key].captures.synthetic = { gameId: 'synthetic', assignmentId: assignment.id, status: 'accepted', seats: [], eligibleIds: [] }; });
  await assert.rejects(() => f.tables.releaseTournamentAssignment(f.host, f.event.id, assignment.id), { code: 'EVENT_TABLE_STARTED' });
  await f.domain.changeScope('tournament', f.event.id, state => { delete state.tables[key].captures.synthetic; });
  await f.tables.start(table.code, table.connections[0], { baseVersion: table.room.version });
  await assert.rejects(() => f.tables.releaseTournamentAssignment(f.host, f.event.id, assignment.id), { code: 'EVENT_TABLE_STARTED' });
  const missing = await fixture(), draft = await prepare(missing), missingAssignment = draft.rounds[0].assignments[0], missingTable = await link(missing, missingAssignment);
  missing.service.rooms.delete(missingTable.code);
  missing.ledger.records = [];
  await assert.rejects(() => missing.tables.releaseTournamentAssignment(missing.host, missing.event.id, missingAssignment.id), { code: 'ROOM_RECOVERY_REQUIRED' });
});

test('release independently checks actual room history and can verify an unplayed recovery save', async () => {
  const f = await fixture(), event = await prepare(f, { start: true }), assignment = event.rounds[0].assignments[0], table = await link(f, assignment);
  // Model a legacy/direct start without any accepted competition command.
  f.service.startGame(table.code, table.connections[0], { baseVersion: table.room.version });
  await assert.rejects(() => f.tables.releaseTournamentAssignment(f.host, f.event.id, assignment.id), { code: 'EVENT_TABLE_STARTED' });
  const recovered = await fixture(), prepared = await prepare(recovered), recoveringAssignment = prepared.rounds[0].assignments[0], recoveringTable = await link(recovered, recoveringAssignment);
  recovered.ledger.recovery(recovered.service.recoveryRecord(recoveringTable.room));
  recovered.service.rooms.delete(recoveringTable.code);
  const released = await recovered.tables.releaseTournamentAssignment(recovered.host, recovered.event.id, recoveringAssignment.id);
  assert.equal(released.rounds[0].assignments[0].roomCode, null);
  assert.equal(recovered.service.rooms.has(recoveringTable.code), false);
});

test('a release racing an accepted start cannot orphan or casually start the assignment', async () => {
  for (const releaseFirst of [false, true]) {
    const f = await fixture(), event = await prepare(f, { start: true }), assignment = event.rounds[0].assignments[0], table = await link(f, assignment);
    const start = () => f.tables.start(table.code, table.connections[0], { baseVersion: table.room.version });
    const release = () => f.tables.releaseTournamentAssignment(f.host, f.event.id, assignment.id);
    const results = await Promise.allSettled(releaseFirst ? [release(), start()] : [start(), release()]);
    assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
    const scope = await f.domain.readScope('tournament', f.event.id), linked = Object.values(scope.tables)[0];
    if (table.room.turn.gameStarted) {
      assert.equal(linked.assignmentId, assignment.id); assert.equal(linked.releasedAt, undefined);
      assert.equal(Object.values(linked.captures).filter(row => row.status === 'accepted').length, 1);
    } else {
      assert.ok(linked.releasedAt); assert.equal(linked.assignmentId, undefined);
      assert.equal(Object.values(linked.captures).filter(row => row.status === 'accepted').length, 0);
    }
  }
});

test('every seated phone sees the authoritative tournament deadline even without event guest access', async () => {
  const f = await fixture({ minutes: 30 }), event = await prepare(f, { start: true }), assignment = event.rounds[0].assignments[0], table = await link(f, assignment);
  const context = await f.tables.context(account(f, assignment.hostId), table.code, table.connections[0]);
  assert.equal(context.eventStatus, 'playing');
  assert.deepEqual(context.tournamentRound, { number: 1, status: 'playing', endsAt: 1801000, serverNow: 1000 });
  const spectatorSeat = await f.tables.context(null, table.code, table.connections[1]);
  assert.equal(spectatorSeat.canAccess, false); assert.equal(spectatorSeat.kind, 'tournament');
  assert.deepEqual(spectatorSeat.tournamentRound, context.tournamentRound);
  assert.equal(spectatorSeat.id, undefined); assert.equal(spectatorSeat.roster, undefined);
});
