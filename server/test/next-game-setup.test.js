import assert from 'node:assert/strict';
import test from 'node:test';
import { createRealtimeServer, RoomService } from '../src/app.js';
import { MemoryPlaytestLedger } from '../src/playtest-ledger.js';

const setup = { commanderCount: 2, commanderNames: ['New A', 'New B'], commanderColors: [['U'], ['R']] };
function fixture(phase = 'intermission') {
  const ledger = new MemoryPlaytestLedger(), service = new RoomService({ ledger });
  const owners = Array.from({ length: 3 }, () => service.createConnection());
  const made = service.createRoom(owners[0].connectionId, { playerCount: 3, startingLife: 40, name: 'Host' });
  const code = made.snapshot.code;
  for (const seatId of [1, 2]) service.claimSeat(code, owners[seatId].connectionId, { seatId, name: `Player ${seatId + 1}`, commanderNames: ['Previous'] });
  const room = service.room(code);
  const act = (method, seatId = 0, input = {}) => service[method](code, owners[seatId].connectionId, { baseVersion: room.version, ...input });
  if (phase !== 'lobby') act('startGame');
  if (['complete', 'intermission'].includes(phase)) act('declareWinner', 0, { winnerSeatId: 0, winCondition: 'other_declared' });
  if (phase === 'intermission') { act('beginIntermission'); for (const seatId of [0, 1, 2]) act('setNextGameReady', seatId); }
  if (phase === 'pending') { act('adjustOwnSeat', 1, { counter: 'life', delta: -40 }); act('adjustOwnSeat', 2, { counter: 'life', delta: -40 }); }
  return { service, ledger, owners, code, room, act };
}

test('next-game setup updates only its owner and clears only that owner ready before one broadcast', () => {
  const f = fixture(); const beforeHost = structuredClone(f.room.seats[0]), version = f.room.version;
  const frozen = structuredClone(f.room.completedGames), broadcasts = [];
  f.service.broadcast = room => broadcasts.push(f.service.snapshot(room));
  const snapshot = f.act('setNextGameSetup', 1, setup).snapshot;
  assert.equal(snapshot.version, version + 1); assert.deepEqual(snapshot.lifecycle.readySeatIds, [0, 2]);
  assert.equal(snapshot.seats[1].commanderCount, 2);
  assert.deepEqual(snapshot.seats[1].commanderNames, ['New A', 'New B']);
  assert.deepEqual(snapshot.seats[1].commanderColors, [['U'], ['R']]);
  // A new shared commander source adds a zero damage slot; host-owned state stays intact.
  beforeHost.commanderDamageReceived['seat-1-commander-b'] = 0;
  assert.deepEqual(structuredClone(f.room.seats[0]), beforeHost);
  assert.deepEqual(f.room.completedGames, frozen);
  assert.equal(broadcasts.length, 1); assert.deepEqual(broadcasts[0].lifecycle.readySeatIds, [0, 2]);
  assert.ok(snapshot.commanderSources.some(source => source.id === 'seat-1-commander-b' && source.commanderName === 'New B'));
});

test('stale saves and invalid metadata leave both ready state and commander data unchanged', () => {
  const f = fixture(), before = f.service.snapshot(f.room);
  assert.throws(() => f.act('setNextGameSetup', 1, { ...setup, baseVersion: f.room.version - 1 }), { code: 'VERSION_CONFLICT' });
  for (const invalid of [
    { ...setup, commanderCount: 0 }, { ...setup, commanderNames: [] }, { ...setup, commanderColors: [['Q'], []] },
    { ...setup, counters: { life: 1 } }, { ...setup, commanderCastCounts: { 'seat-1-commander-a': 1 } },
    { ...setup, name: 'Rename' }, { ...setup, seatId: 0 },
  ]) {
    assert.throws(() => f.act('setNextGameSetup', 1, invalid), { code: 'INVALID_INPUT' });
    assert.deepEqual(f.service.snapshot(f.room), before);
  }
  assert.throws(() => f.service.setNextGameSetup(f.code, f.owners[1].connectionId, null), { code: 'INVALID_INPUT' });
  assert.deepEqual(f.service.snapshot(f.room), before);
});

test('lobby, active, complete and pending-result states reject the next-game endpoint', () => {
  for (const phase of ['lobby', 'playing', 'complete', 'pending']) {
    const f = fixture(phase), before = f.service.snapshot(f.room);
    try {
      assert.throws(() => f.act('setNextGameSetup', 1, setup), { code: phase === 'pending' ? 'FINISH_PENDING' : 'NOT_IN_INTERMISSION' });
      assert.deepEqual(f.service.snapshot(f.room), before);
    } finally { f.service.clearEliminationTimers(); }
  }
});

test('a removed owner cannot edit the next-game roster or silently become ready again', () => {
  const f = fixture(); f.act('skipNextGameSeat', 0, { seatId: 1 });
  const before = f.service.snapshot(f.room);
  assert.throws(() => f.act('setNextGameSetup', 1, setup), { code: 'NOT_IN_INTERMISSION' });
  assert.deepEqual(f.service.snapshot(f.room), before);
});

test('a valid same-value setup save still requires its owner to mark ready afterward', () => {
  const f = fixture();
  const snapshot = f.act('setNextGameSetup', 1, { commanderCount: 1, commanderNames: ['Previous'], commanderColors: [[]] }).snapshot;
  assert.deepEqual(snapshot.lifecycle.readySeatIds, [0, 2]);
  assert.equal(snapshot.seats[1].counters.life, 40);
});

test('ordinary commander setup mutations retain their existing readiness behavior', () => {
  const f = fixture(), before = [...f.room.lifecycle.readySeatIds];
  f.act('mutateOwnSeat', 1, setup);
  assert.deepEqual(f.room.lifecycle.readySeatIds, before);
});

test('new commander setup and cleared readiness persist without changing the previous completion proof', async () => {
  const f = fixture(); const frozen = structuredClone(f.room.completedGames), gameId = f.room.gameId;
  f.act('setNextGameSetup', 1, setup);
  const recovered = new RoomService({ ledger: f.ledger, autoRecoverRooms: true });
  await recovered.ensureRoom(f.code); const snapshot = recovered.snapshot(recovered.room(f.code));
  assert.deepEqual(snapshot.lifecycle.readySeatIds, [0, 2]);
  assert.deepEqual(snapshot.seats[1].commanderNames, setup.commanderNames);
  assert.deepEqual(recovered.room(f.code).completedGames, frozen); assert.equal(recovered.room(f.code).gameId, gameId);
});

test('HTTP next-game setup authenticates the caller, rejects foreign targeting and emits its own updated seat', async () => {
  const f = fixture(), { server } = createRealtimeServer({ service: f.service });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = async (connection, extra = {}) => {
    const response = await fetch(`${origin}/api/rooms/${f.code}/next-game-setup`, { method: 'POST',
      headers: { 'content-type': 'application/json', ...(connection ? { 'x-connection-id': connection.connectionId } : {}) },
      body: JSON.stringify({ baseVersion: f.room.version, ...setup, ...extra }) });
    return { status: response.status, body: await response.json() };
  };
  try {
    assert.equal((await post(null)).status, 401);
    assert.equal((await post(f.owners[1], { seatId: 0 })).status, 400);
    const response = await post(f.owners[1]); assert.equal(response.status, 200);
    assert.deepEqual(response.body.snapshot.lifecycle.readySeatIds, [0, 2]);
    assert.equal(response.body.snapshot.seats[0].commanderCount, 1);
    assert.equal(response.body.snapshot.seats[1].commanderCount, 2);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
