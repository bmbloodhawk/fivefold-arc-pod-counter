import assert from 'node:assert/strict';
import test from 'node:test';
import { Competitions } from '../src/competitions.js';
import { Tournaments } from '../src/tournaments.js';
import { CompetitionTables } from '../src/competition-tables.js';
import { RoomService } from '../src/app.js';
import { MemoryAccountHistoryStore } from '../src/account-history.js';
import { MemoryPlaytestLedger } from '../src/playtest-ledger.js';
import { suggestSeating, SEATING_RULE_VERSION } from '../src/tournament-seating.js';

async function fixture({ count = 8, rounds = 2, minutes = null, preferredSize = 4 } = {}) {
  let time = 1000;
  const store = new MemoryAccountHistoryStore(); const ledger = new MemoryPlaytestLedger();
  const domain = new Competitions({ store, now: () => time });
  const tournaments = new Tournaments({ domain });
  const service = new RoomService({ ledger, now: () => time });
  const tables = new CompetitionTables({ domain, service, ledger, tournaments });
  tournaments.tables = tables;
  const event = await tournaments.create('organizer', { name: 'Saturday', displayName: 'Host', rounds, minutes, preferredSize });
  const invite = await domain.invite('organizer', 'tournament', event.id);
  const entrants = [];
  for (let i = 0; i < count; i++) entrants.push(await tournaments.join(`account_${i}`, invite.token, { displayName: `Player ${i}` }));
  const host = { accountId: 'organizer' };
  const advance = ms => { time += ms; };
  return { store, ledger, domain, tournaments, service, tables, event, invite, entrants, host, advance };
}
async function nextRound(f) {
  let event = await f.tournaments.prepareRound(f.host, f.event.id);
  event = await f.tournaments.startRound(f.host, f.event.id, { roundId: event.rounds.at(-1).id, baseVersion: event.version });
  return event;
}
async function playAssignment(f, assignment, { finish = true } = {}) {
  const entrants = assignment.participantIds.map(id => {
    const index = f.entrants.findIndex(entry => entry.me === id);
    return { account: `account_${index}`, name: `Player ${index}`, id };
  });
  const connections = entrants.map(() => f.service.createConnection({ supportedTableProtocols: [1, 2] }).connectionId);
  const created = f.service.createRoom(connections[0], { playerCount: entrants.length, startingLife: 40, name: entrants[0].name });
  const code = created.snapshot.code;
  for (let i = 1; i < entrants.length; i++) f.service.claimSeat(code, connections[i], { seatId: i, name: entrants[i].name });
  await f.tables.bind(entrants[0].account, { kind: 'tournament', id: f.event.id, code, connectionId: connections[0], assignmentId: assignment.id });
  for (let i = 1; i < entrants.length; i++) await f.tables.claim(entrants[i].account, { code, connectionId: connections[i] });
  await f.tables.start(code, connections[0], { baseVersion: f.service.room(code).version });
  if (!finish) return { code, connections, hostAccount: entrants[0].account };
  f.service.declareWinner(code, connections[0], { winnerSeatId: 0, baseVersion: f.service.room(code).version });
  await f.tables.reconcile('tournament', f.event.id);
  const gameId = f.service.room(code).gameId;
  return f.tables.confirm(f.host, 'tournament', f.event.id, gameId, {
    order: assignment.participantIds.map(id => [id]), baseRevision: 0,
    requestId: `confirm_${assignment.id}`, reasonCode: 'host_confirmation',
  });
}

test('tournaments are standalone, require signed-in creation, and disclose fixed scoring/clock rules', async () => {
  const f = await fixture();
  assert.equal(f.event.settings.rounds, 2);
  assert.equal(f.event.settings.preferredSize, 4);
  assert.equal(f.event.settings.priority, 'new_opponents');
  assert.equal(f.event.settings.minutes, null);
  assert.match(f.event.rules, /five additional turns/i);
  await assert.rejects(() => f.tournaments.create(null, { name: 'Event', displayName: 'X', rounds: 2 }), { status: 401 });
  const values = JSON.stringify([...f.store.values.entries()]);
  assert.equal(values.includes('competitions/pods/'), false);
  await assert.rejects(() => f.tournaments.get({ accountId: 'outsider' }, f.event.id), { status: 403 });
});

test('signed-in early leavers and pending entrants retain event resume access in their list', async () => {
  const f = await fixture({ count: 4 });
  await f.tournaments.memberAction({ accountId: 'account_0' }, f.event.id, { action: 'leave' });
  assert.equal((await f.domain.list('account_0')).tournaments[0].id, f.event.id);
  await f.tournaments.join('organizer', f.invite.token, { displayName: 'Host' });
  await f.tournaments.memberAction(f.host, f.event.id, { action: 'leave' });
  assert.equal((await f.domain.list('organizer')).tournaments[0].role, 'admin');
  await nextRound(f);
  await f.tournaments.join('late', f.invite.token, { displayName: 'Late' }).catch(error => assert.equal(error.code, 'ENTRY_BETWEEN_ROUNDS'));
  for (const assignment of (await f.tournaments.get(f.host, f.event.id)).rounds[0].assignments) await playAssignment(f, assignment);
  const late = await f.tournaments.join('late', f.invite.token, { displayName: 'Late' });
  assert.equal(late.members.find(row => row.id === late.me).status, 'pending');
  assert.equal((await f.domain.list('late')).tournaments[0].id, f.event.id);
});

test('tournament publication and account erasure preserve unrelated Pod ratings and guest aliases', async () => {
  const f = await fixture({ count: 4, rounds: 1 });
  const pod = await f.domain.createPod('account_0', { name: 'Independent', displayName: 'Member' });
  const before = await f.domain.readScope('pod', pod.id);
  const guest = await f.tournaments.addGuest(f.host, f.event.id, { displayName: 'Attested guest' });
  const guestRow = guest.members.find(row => row.name === 'Attested guest');
  await f.tournaments.memberAction(f.host, f.event.id, { action: 'leave', targetId: guestRow.id });
  const round = await nextRound(f);
  for (const assignment of round.rounds[0].assignments) await playAssignment(f, assignment);
  assert.deepEqual(await f.domain.readScope('pod', pod.id), before);
  await f.domain.eraseAccount('organizer');
  const remaining = await f.tournaments.get({ accountId: 'account_0' }, f.event.id);
  assert.equal(remaining.members.find(row => row.id === guestRow.id).name, 'Attested guest');
  assert.ok(remaining.members.some(row => row.name === 'Deleted member'));
});

test('guests self-enter without accounts; retries reclaim the same entry, names remain clearly attested', async () => {
  const f = await fixture({ count: 0 });
  const input = { displayName: 'Guest A', requestId: 'guest_request_123' };
  const guest = await f.tournaments.join(null, f.invite.token, input);
  const retry = await f.tournaments.join(null, f.invite.token, input);
  assert.equal(guest.me, retry.me); assert.equal(guest.guestToken, retry.guestToken);
  const event = await f.tournaments.get({ guestToken: guest.guestToken }, f.event.id);
  assert.equal(event.standings[0].kind, 'guest'); assert.equal(event.standings[0].points, 0);
  assert.equal(event.standings[0].provenance, 'self_named_guest');
  assert.equal(/guestAccessHash|identityId|accountId/.test(JSON.stringify(event)), false);
  const attested = await f.tournaments.addGuest(f.host, f.event.id, { displayName: 'Guest B' });
  assert.ok(attested.standings.some(row => row.name === 'Guest B' && row.provenance === 'organizer_attested_guest'));
  await assert.rejects(() => f.tournaments.prepareRound({ guestToken: guest.guestToken }, f.event.id), { status: 403 });
});

test('optional co-host must be a signed-in entrant and can manage rounds without the creator', async () => {
  const f = await fixture({ count: 4 });
  let event = await f.tournaments.memberAction(f.host, f.event.id, { action: 'cohost', targetId: f.entrants[0].me, enabled: true });
  assert.equal(event.members.find(row => row.id === f.entrants[0].me).role, 'admin');
  const cohost = { accountId: 'account_0' };
  event = await f.tournaments.prepareRound(cohost, f.event.id);
  await f.tournaments.startRound(cohost, f.event.id, { roundId: event.rounds[0].id, baseVersion: event.version });
  assert.equal((await f.tournaments.get(cohost, f.event.id)).rounds[0].status, 'playing');
});

test('primary host cannot be demoted, and stopping play does not remove event administration or invitations', async () => {
  const f = await fixture({ count: 4 });
  await assert.rejects(() => f.tournaments.memberAction(f.host, f.event.id, { action: 'cohost', targetId: f.event.creatorId, enabled: false }), { status: 400 });
  await f.tournaments.memberAction(f.host, f.event.id, { action: 'leave' });
  const invite = await f.domain.invite('organizer', 'tournament', f.event.id);
  assert.equal((await f.domain.preview(invite.token)).kind, 'tournament');
  await nextRound(f);
});

test('the primary host can revoke a co-host who stopped playing', async () => {
  const f = await fixture({ count: 4 }); const targetId = f.entrants[0].me;
  await f.tournaments.memberAction(f.host, f.event.id, { action: 'cohost', targetId, enabled: true });
  await f.tournaments.memberAction({ accountId: 'account_0' }, f.event.id, { action: 'leave' });
  await f.tournaments.memberAction(f.host, f.event.id, { action: 'cohost', targetId, enabled: false });
  await assert.rejects(() => f.tournaments.prepareRound({ accountId: 'account_0' }, f.event.id), { status: 403 });
});

test('multiple Tables complete independently, then combined standings unlock the next manual round', async () => {
  const f = await fixture(); let event = await nextRound(f);
  assert.equal(event.rounds[0].assignments.length, 2);
  await assert.rejects(() => f.tournaments.prepareRound(f.host, f.event.id), { status: 409 });
  await playAssignment(f, event.rounds[0].assignments[0]);
  assert.equal((await f.tournaments.get(f.host, f.event.id)).rounds[0].status, 'playing');
  await playAssignment(f, event.rounds[0].assignments[1]);
  event = await f.tournaments.get(f.host, f.event.id);
  assert.equal(event.rounds[0].status, 'complete');
  assert.deepEqual(event.standings.map(row => row.points), [3, 3, 2, 2, 1, 1, 0, 0]);
  event = await f.tournaments.prepareRound(f.host, f.event.id);
  assert.equal(event.rounds[1].status, 'draft');
  assert.equal(event.rounds[1].assignments.flatMap(row => row.participantIds).length, 8);
});

test('late players wait for between-round host approval at zero; leavers retain points and final placing', async () => {
  const f = await fixture({ count: 4 }); let event = await nextRound(f);
  await assert.rejects(() => f.tournaments.join('late', f.invite.token, { displayName: 'Late' }), { status: 409 });
  await playAssignment(f, event.rounds[0].assignments[0]);
  const late = await f.tournaments.join('late', f.invite.token, { displayName: 'Late' });
  assert.equal(late.members.find(row => row.id === late.me).status, 'pending');
  event = await f.tournaments.memberAction(f.host, f.event.id, { action: 'approve', targetId: late.me });
  assert.equal(event.standings.find(row => row.id === late.me).points, 0);
  const winner = event.standings[0];
  event = await f.tournaments.memberAction(f.host, f.event.id, { action: 'leave', targetId: winner.id });
  assert.equal(event.standings.find(row => row.id === winner.id).points, 3);
  assert.equal(event.standings.find(row => row.id === winner.id).status, 'left');
  event = await f.tournaments.prepareRound(f.host, f.event.id);
  assert.equal(event.rounds[1].assignments.some(row => row.participantIds.includes(winner.id)), false);
});

test('host reviews legal seating before manual start; stale edits and singletons are rejected', async () => {
  const f = await fixture({ count: 5, preferredSize: 8 });
  let event = await f.tournaments.prepareRound(f.host, f.event.id);
  const roundId = event.rounds[0].id;
  assert.equal(event.rounds[0].assignments[0].participantIds.length, 5);
  await assert.rejects(() => f.tournaments.editSeating(f.host, f.event.id, { roundId, baseVersion: event.version,
    tables: [[f.entrants[0].me], f.entrants.slice(1).map(row => row.me)] }), /two|2/);
  const stale = event.version;
  event = await f.tournaments.editSeating(f.host, f.event.id, { roundId, baseVersion: event.version,
    tables: [f.entrants.slice(0, 3).map(row => row.me), f.entrants.slice(3).map(row => row.me)] });
  await assert.rejects(() => f.tournaments.startRound(f.host, f.event.id, { roundId, baseVersion: stale }), { status: 409 });
  await f.tournaments.startRound(f.host, f.event.id, { roundId, baseVersion: event.version });
  await assert.rejects(() => f.tournaments.editSeating(f.host, f.event.id, { roundId, baseVersion: event.version,
    tables: [f.entrants.map(row => row.me)] }), { status: 409 });
});

test('timer requires time, current-turn finish plus exactly five actual turn completions; retries cannot consume turns', async () => {
  const f = await fixture({ count: 4, minutes: 1 }); const event = await nextRound(f);
  const assignment = event.rounds[0].assignments[0];
  const call = (action, requestId) => f.tournaments.clock(f.host, f.event.id, assignment.id, { action, requestId });
  await assert.rejects(() => call('time_called', 'no_game_exists'), { code: 'TABLE_NOT_STARTED' });
  await playAssignment(f, assignment, { finish: false });
  await assert.rejects(() => call('time_called', 'before_time_01'), { status: 409 });
  f.advance(60_000);
  await call('time_called', 'call_time_0001');
  let current = await call('finish_turn', 'finish_current01');
  assert.equal(current.rounds[0].assignments[0].clock.remaining, 5);
  current = await call('finish_turn', 'finish_current01');
  assert.equal(current.rounds[0].assignments[0].clock.remaining, 5);
  for (let turn = 0; turn < 5; turn++) current = await call('finish_turn', `extra_turn_000${turn}`);
  assert.equal(current.rounds[0].assignments[0].clock.phase, 'done');
  assert.equal(current.rounds[0].assignments[0].clock.remaining, 0);
  assert.equal(current.standings.every(row => row.points === 0), true);
});

test('confirmed timed draw ties actual survivors, creates no fake winner and saves verified personal facts independently', async () => {
  const f = await fixture({ count: 4, rounds: 1, minutes: 1 }); const event = await nextRound(f);
  const assignment = event.rounds[0].assignments[0]; const table = await playAssignment(f, assignment, { finish: false });
  f.service.setTurnTracking(table.code, table.connections[0], { enabled: false, baseVersion: f.service.room(table.code).version });
  f.service.adjustOwnSeat(table.code, table.connections[3], { counter: 'life', delta: -40 });
  await assert.rejects(() => f.tables.timedDraw(table.hostAccount, { code: table.code, connectionId: table.connections[0], baseVersion: f.service.room(table.code).version }), { code: 'FIVE_TURNS_REQUIRED' });
  f.advance(60_000);
  await f.tournaments.clock(f.host, f.event.id, assignment.id, { action: 'time_called', requestId: 'timed_draw_call' });
  for (let i = 0; i < 6; i++) await f.tournaments.clock(f.host, f.event.id, assignment.id, { action: 'finish_turn', requestId: `draw_finish_turn_${i}` });
  const snapshot = (await f.tables.timedDraw(table.hostAccount, { code: table.code, connectionId: table.connections[0], baseVersion: f.service.room(table.code).version })).snapshot;
  assert.equal(snapshot.gameResult.winnerSeatId, null); assert.equal(snapshot.gameResult.reason, 'timed_draw');
  for (const connectionId of table.connections) assert.equal(f.service.completedSeat(table.code, connectionId, snapshot.completedGameId).game.won, false);
  await f.tables.reconcile('tournament', f.event.id);
  const detail = await f.tables.detail(f.host, 'tournament', f.event.id, snapshot.completedGameId);
  assert.equal(detail.original.inferredOrder[0].length, 3);
  await assert.rejects(() => f.tables.confirm(f.host, 'tournament', f.event.id, snapshot.completedGameId,
    { order: detail.starterIds.map(id => [id]), baseRevision: 0, requestId: 'fake_draw_winner' }), /share the top places/);
  await f.tables.confirm(f.host, 'tournament', f.event.id, snapshot.completedGameId, { order: detail.original.inferredOrder, baseRevision: 0, requestId: 'confirm_timed_draw' });
  const final = await f.tournaments.get(f.host, f.event.id);
  assert.equal(final.status, 'completed');
  assert.deepEqual(final.standings.map(row => row.points), [2, 2, 2, 0]);
  assert.deepEqual(final.standings.map(row => row.rank), [1, 1, 1, 4]);
  assert.ok(final.standings.every(row => row.wins === 0));
});

test('an unplayed no-show Table may be cancelled without points; a started Table must produce a real result', async () => {
  const f = await fixture({ count: 4, rounds: 1 }); const event = await nextRound(f); const assignment = event.rounds[0].assignments[0];
  const final = await f.tournaments.cancelUnplayedTable(f.host, f.event.id, assignment.id);
  assert.equal(final.status, 'completed'); assert.ok(final.standings.every(row => row.gamesPlayed === 0 && row.points === 0));
  const playing = await fixture({ count: 4, rounds: 1 }); const next = await nextRound(playing);
  await playAssignment(playing, next.rounds[0].assignments[0], { finish: false });
  await assert.rejects(() => playing.tournaments.cancelUnplayedTable(playing.host, playing.event.id, next.rounds[0].assignments[0].id), { status: 409 });
});

test('host-recorded guests can receive scoped reclaim access without an account or personal awards', async () => {
  const f = await fixture({ count: 0 });
  const event = await f.tournaments.addGuest(f.host, f.event.id, { displayName: 'Attested' });
  const guest = event.members.find(row => row.kind === 'guest');
  const capability = await f.tournaments.guestAccess(f.host, f.event.id, guest.id);
  assert.equal((await f.tournaments.get({ guestToken: capability.guestToken }, f.event.id)).me, guest.id);
  await assert.rejects(() => f.tournaments.guestAccess({ guestToken: capability.guestToken }, f.event.id, guest.id), { status: 403 });
  const replacement = await f.tournaments.guestAccess(f.host, f.event.id, guest.id);
  await assert.rejects(() => f.tournaments.get({ guestToken: capability.guestToken }, f.event.id), { status: 403 });
  assert.equal((await f.tournaments.get({ guestToken: replacement.guestToken }, f.event.id)).me, guest.id);
});

test('guest-only play uses the same full-order points and preserves self-entered provenance', async () => {
  const f = await fixture({ count: 0, rounds: 1 }); const entries = [];
  for (let i = 0; i < 4; i++) entries.push(await f.tournaments.join(null, f.invite.token, { displayName: `Guest ${i}`, requestId: `guest_play_entry_${i}` }));
  const event = await nextRound(f); const assignment = event.rounds[0].assignments[0];
  const ordered = assignment.participantIds.map(id => entries.find(entry => entry.me === id));
  const connections = ordered.map(() => f.service.createConnection().connectionId);
  const code = f.service.createRoom(connections[0], { playerCount: 4, startingLife: 40 }).snapshot.code;
  for (let i = 1; i < 4; i++) f.service.claimSeat(code, connections[i], { seatId: i });
  await f.tables.bind({ guestToken: ordered[0].guestToken }, { kind: 'tournament', id: f.event.id, code, connectionId: connections[0], assignmentId: assignment.id });
  for (let i = 1; i < 4; i++) await f.tables.claim({ guestToken: ordered[i].guestToken }, { code, connectionId: connections[i] });
  await f.tables.start(code, connections[0], { baseVersion: f.service.room(code).version });
  f.service.declareWinner(code, connections[0], { winnerSeatId: 0, baseVersion: f.service.room(code).version });
  await f.tables.reconcile('tournament', f.event.id);
  const result = await f.tables.confirm({ guestToken: ordered[0].guestToken }, 'tournament', f.event.id, f.service.room(code).gameId,
    { order: assignment.participantIds.map(id => [id]), baseRevision: 0, requestId: 'guest_order_confirmation' });
  assert.ok(result.players.every(row => row.kind === 'guest' && row.provenance === 'self_named_guest'));
  const final = await f.tournaments.get(f.host, f.event.id);
  assert.deepEqual(final.standings.map(row => row.points), [3, 2, 1, 0]);
  assert.ok(final.standings.every(row => row.kind === 'guest' && row.gamesPlayed === 1));
});

test('saved seating inputs replay the original suggestion after later state changes; explicit reseeding is version guarded', async () => {
  const f = await fixture(); const event = await f.tournaments.prepareRound(f.host, f.event.id);
  const scope = await f.domain.readScope('tournament', f.event.id); const original = structuredClone(scope.rounds[0]);
  assert.equal(original.seatingRuleVersion, SEATING_RULE_VERSION);
  assert.deepEqual(suggestSeating(original.seatingInputs), original.suggestedTables);
  await f.tournaments.memberAction(f.host, f.event.id, { action: 'leave', targetId: f.entrants[0].me });
  assert.deepEqual(suggestSeating(original.seatingInputs), original.suggestedTables);
  await assert.rejects(() => f.tournaments.prepareRound(f.host, f.event.id, { reseed: true, baseVersion: event.version }), { code: 'VERSION_CONFLICT' });
  const current = await f.tournaments.get(f.host, f.event.id);
  await f.tournaments.prepareRound(f.host, f.event.id, { reseed: true, baseVersion: current.version });
  const next = await f.domain.readScope('tournament', f.event.id);
  assert.notEqual(next.rounds[0].seed, original.seed);
  assert.equal(next.rounds[0].seatingInputs.participants.length, 7);
});

test('timed Tables require draw-capable phones; legacy phones keep ordinary Table access', async () => {
  const f = await fixture({ count: 4, minutes: 1 }); const event = await nextRound(f);
  const assignment = event.rounds[0].assignments[0]; const index = f.entrants.findIndex(row => row.me === assignment.hostId);
  const oldHost = f.service.createConnection({ supportedTableProtocols: [1] }).connectionId;
  const created = f.service.createRoom(oldHost, { playerCount: 4, startingLife: 40 }); const code = created.snapshot.code;
  await assert.rejects(() => f.tables.bind(`account_${index}`, { kind: 'tournament', id: f.event.id, code, connectionId: oldHost, assignmentId: assignment.id }), { code: 'TABLE_PROTOCOL_INCOMPATIBLE' });
  assert.equal(f.service.room(code).protocolVersion, 1);
  const newHost = f.service.createConnection({ supportedTableProtocols: [1, 2] }).connectionId;
  f.service.claimSeat(code, newHost, { seatId: 0, reclaimToken: created.reclaimToken });
  await f.tables.bind(`account_${index}`, { kind: 'tournament', id: f.event.id, code, connectionId: newHost, assignmentId: assignment.id });
  assert.equal(f.service.room(code).protocolVersion, 2);
  const oldGuest = f.service.createConnection({ supportedTableProtocols: [1] }).connectionId;
  assert.throws(() => f.service.claimSeat(code, oldGuest, { seatId: 1 }), { code: 'TABLE_PROTOCOL_INCOMPATIBLE' });
  // The optional feature must not upgrade or block a normal casual Table.
  const casual = f.service.createRoom(oldGuest, { playerCount: 2, startingLife: 40 });
  assert.equal(casual.snapshot.protocolVersion, 1);
});
