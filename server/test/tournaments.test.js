import assert from 'node:assert/strict';
import test from 'node:test';
import { Competitions } from '../src/competitions.js';
import { Tournaments } from '../src/tournaments.js';
import { CompetitionTables } from '../src/competition-tables.js';
import { RoomService } from '../src/app.js';
import { MemoryAccountHistoryStore } from '../src/account-history.js';
import { MemoryPlaytestLedger } from '../src/playtest-ledger.js';

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
  const connections = entrants.map(() => f.service.createConnection().connectionId);
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
