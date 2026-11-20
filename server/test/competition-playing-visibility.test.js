import assert from 'node:assert/strict';
import test from 'node:test';
import { Competitions } from '../src/competitions.js';
import { CompetitionTables } from '../src/competition-tables.js';
import { RoomService } from '../src/app.js';
import { MemoryAccountHistoryStore } from '../src/account-history.js';
import { MemoryPlaytestLedger } from '../src/playtest-ledger.js';

async function fixture() {
  let time = 1_000_000, writes = 0;
  const store = new MemoryAccountHistoryStore(), update = store.update.bind(store);
  store.update = (...args) => { writes++; return update(...args); };
  const ledger = new MemoryPlaytestLedger();
  const domain = new Competitions({ store, now: () => time, podOwnershipEnabled: true });
  const service = new RoomService({ ledger, now: () => time });
  const tables = new CompetitionTables({ domain, service, ledger });
  const pod = await domain.createPod('host', { name: 'Locked-phone Pod', displayName: 'Mira' });
  const invite = await domain.invite('host', 'pod', pod.id);
  const member = await domain.joinPod('member', invite.token, { displayName: 'Nico' });
  const host = service.createConnection().connectionId, participant = service.createConnection().connectionId;
  const guest = service.createConnection().connectionId;
  const created = service.createRoom(host, { playerCount: 4, startingLife: 40, name: 'Host Table alias' });
  const code = created.snapshot.code;
  service.claimSeat(code, participant, { seatId: 1, name: 'Member Table alias' });
  service.claimSeat(code, guest, { seatId: 2, name: 'Private guest name' });
  await tables.bind('host', { kind: 'pod', id: pod.id, code, connectionId: host });
  await tables.claim('member', { code, connectionId: participant });
  const room = service.rooms.get(code);
  const start = () => tables.start(code, host, { baseVersion: room.version });
  const quiet = () => { time += service.connectionTtlMs + 1; };
  const advance = delta => { time += delta; };
  return { domain, service, tables, ledger, pod, member, host, participant, guest, code, room, created, start, quiet, advance,
    now: () => time, writes: () => writes };
}

function assertQuietPlaying(table, code) {
  assert.ok(table, 'A game in progress remains listed when every phone stops contacting the server');
  assert.equal(table.code, code);
  assert.equal(table.lifecycle, 'playing');
  assert.equal(table.recentlyConnectedSeats, 0, 'Game visibility must not fabricate a fresh phone connection');
  assert.equal(table.availableSeats, 0, 'Locked phones do not open their claimed seats to new players');
  assert.equal(table.claimedSeats, 3);
  assert.deepEqual(table.members, [
    { name: 'Mira', recentlyConnected: false }, { name: 'Nico', recentlyConnected: false },
    { name: 'Guest', recentlyConnected: false },
  ]);
}

test('an in-progress Pod game stays visible after all connection timestamps pass the freshness window', async () => {
  const f = await fixture(); await f.start(); f.quiet();
  assert.ok(f.room.seats[0].ownerConnectionId, 'The test checks stale timestamps before the normal sweep');
  const result = await f.tables.activity('member', f.pod.id);
  assertQuietPlaying(result.tables[0], f.code);
  assert.equal(result.presenceWindowMs, 90_000);
});

test('a game remains visible after connection expiry clears every seat owner, and activity reads remain pure', async () => {
  const f = await fixture(); await f.start(); f.quiet(); f.service.sweep();
  assert.equal(f.service.connections.size, 0);
  assert.ok(f.room.seats.filter(seat => seat.claimed).every(seat => seat.ownerConnectionId === null));
  const before = { version: f.room.version, lastActiveAt: f.room.lastActiveAt, writes: f.writes(),
    room: structuredClone(f.room), connections: [...f.service.connections] };
  f.advance(1000);
  assertQuietPlaying((await f.tables.activity('host', f.pod.id)).tables[0], f.code);
  assertQuietPlaying((await f.tables.activity('member', f.pod.id)).tables[0], f.code);
  assert.equal(f.room.version, before.version);
  assert.equal(f.room.lastActiveAt, before.lastActiveAt);
  assert.equal(f.writes(), before.writes);
  assert.deepEqual(structuredClone(f.room), before.room);
  assert.deepEqual([...f.service.connections], before.connections);
});

test('pausing turn tracking does not hide an unfinished game when its phones become quiet', async () => {
  const f = await fixture(); await f.start();
  f.service.setTurnPaused(f.code, f.host, { baseVersion: f.room.version, paused: true });
  f.quiet(); f.service.sweep();
  assert.ok(f.room.turn.pausedAt);
  assertQuietPlaying((await f.tables.activity('host', f.pod.id)).tables[0], f.code);
});

test('quiet lobbies, completed games and between-game setup still require a recent connection', async () => {
  for (const lifecycle of ['lobby', 'complete', 'intermission']) {
    const f = await fixture();
    if (lifecycle !== 'lobby') {
      await f.start();
      f.service.declareWinner(f.code, f.host, { baseVersion: f.room.version, winnerSeatId: 0, winCondition: 'other_declared' });
      if (lifecycle === 'intermission') f.service.beginIntermission(f.code, f.host, { baseVersion: f.room.version });
    }
    assert.equal(f.room.lifecycle.status, lifecycle);
    f.quiet(); f.service.sweep();
    assert.deepEqual((await f.tables.activity('host', f.pod.id)).tables, [], `The playing exception must not retain ${lifecycle}`);
  }
});

test('finishing a retained game removes its playing-only visibility once the reconnected host becomes quiet', async () => {
  const f = await fixture(); await f.start(); f.quiet(); f.service.sweep();
  assertQuietPlaying((await f.tables.activity('host', f.pod.id)).tables[0], f.code);
  const returningHost = f.service.createConnection().connectionId;
  f.service.claimSeat(f.code, returningHost, { seatId: 0, reclaimToken: f.created.reclaimToken });
  f.service.declareWinner(f.code, returningHost, { baseVersion: f.room.version, winnerSeatId: 0, winCondition: 'other_declared' });
  assert.equal((await f.tables.activity('host', f.pod.id)).tables[0].lifecycle, 'complete', 'A fresh connection still lists a completed Table normally');
  f.quiet(); f.service.sweep();
  assert.deepEqual((await f.tables.activity('host', f.pod.id)).tables, []);
});

test('an already loaded recovered game remains visible without presenting its disconnected seats as recent', async () => {
  const f = await fixture(); await f.start();
  const restored = new RoomService({ ledger: f.ledger, now: f.now, autoRecoverRooms: true });
  restored.hydrateRecoveryRecord(f.code, structuredClone(f.service.recoveryRecord(f.room)));
  const recovered = restored.rooms.get(f.code);
  assert.equal(recovered.lifecycle.status, 'playing');
  assert.ok(recovered.seats.filter(seat => seat.claimed).every(seat => seat.ownerConnectionId === null));
  const tables = new CompetitionTables({ domain: f.domain, service: restored, ledger: f.ledger });
  assertQuietPlaying((await tables.activity('member', f.pod.id)).tables[0], f.code);
});

test('retaining a playing game does not revive or extend an expired room', async () => {
  const f = await fixture(); await f.start();
  const lastActiveAt = f.room.lastActiveAt;
  f.advance(f.service.roomTtlMs + 1);
  assert.deepEqual((await f.tables.activity('host', f.pod.id)).tables, []);
  assert.equal(f.room.lastActiveAt, lastActiveAt);
  assert.ok(f.service.rooms.has(f.code), 'Reading activity does not sweep expired rooms either');
  f.service.sweep();
  assert.equal(f.service.rooms.has(f.code), false);
  assert.deepEqual((await f.tables.activity('host', f.pod.id)).tables, []);
});

test('retained playing visibility remains private and honors removal without revealing guest identity', async () => {
  const f = await fixture(); await f.start(); f.quiet(); f.service.sweep();
  await assert.rejects(() => f.tables.activity(null, f.pod.id), { status: 401 });
  await assert.rejects(() => f.tables.activity('outsider', f.pod.id), { status: 403 });
  await f.domain.podMemberAction('host', f.pod.id, { action: 'remove', targetId: f.member.me });
  await assert.rejects(() => f.tables.activity('member', f.pod.id), { status: 403 });
  const table = (await f.tables.activity('host', f.pod.id)).tables[0];
  assert.ok(table);
  assert.deepEqual(table.members.map(row => row.name), ['Mira', 'Guest', 'Guest']);
  assert.ok(!JSON.stringify(table).includes('Private guest name'));
});

test('a pending elimination undo finish stays visible with disconnected phones, then stops being retained at completion', async () => {
  const f = await fixture(); await f.start();
  f.service.adjustOwnSeat(f.code, f.participant, { baseVersion: f.room.version, counter: 'life', delta: -40 });
  f.service.adjustOwnSeat(f.code, f.guest, { baseVersion: f.room.version, counter: 'life', delta: -40 });
  assert.ok(f.room.pendingFinish, 'The last elimination waits through its normal undo interval');
  assert.equal(f.room.gameResult, null);
  for (const connection of [...f.service.connections.values()]) f.service.expireConnection(connection);
  assertQuietPlaying((await f.tables.activity('host', f.pod.id)).tables[0], f.code);
  f.advance(15_001);
  assert.equal(f.service.finishExpiredElimination(f.room), true);
  assert.equal(f.room.lifecycle.status, 'complete');
  assert.ok(f.room.gameResult);
  assert.deepEqual((await f.tables.activity('host', f.pod.id)).tables, []);
});

test('legacy completed room data without lifecycle is not mistaken for a still-playing game', async () => {
  const f = await fixture(); await f.start();
  f.service.declareWinner(f.code, f.host, { baseVersion: f.room.version, winnerSeatId: 0, winCondition: 'other_declared' });
  assert.equal(f.room.turn.gameStarted, true, 'The started marker remains true after a normal completion');
  assert.ok(f.room.gameResult);
  delete f.room.lifecycle;
  const current = (await f.tables.activity('host', f.pod.id)).tables[0];
  assert.equal(current.lifecycle, 'complete');
  assert.equal(current.availableSeats, 0);
  f.quiet();
  assert.deepEqual((await f.tables.activity('host', f.pod.id)).tables, []);
});
