import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomService } from '../src/app.js';
import { MemoryPlaytestLedger, recapFromRoom } from '../src/playtest-ledger.js';

function table(capacity = 8) {
  const ledger = new MemoryPlaytestLedger(), service = new RoomService({ ledger });
  const host = service.createConnection(), guest = service.createConnection();
  const made = service.createRoom(host.connectionId, { playerCount: capacity, seatCapacity: capacity, startingLife: 40 });
  const code = made.snapshot.code, room = service.room(code);
  service.claimSeat(code, guest.connectionId, { seatId: 1 });
  return {
    service, ledger, host, guest, code, room,
    act: (method, input = {}, connection = host) => service[method](code, connection.connectionId, { baseVersion: room.version, ...input }),
    finish() { service.declareWinner(code, host.connectionId, { baseVersion: room.version, winnerSeatId: 0, winCondition: 'other_declared' }); },
    archived: () => ledger.records.filter(row => row.kind === 'complete').map(row => row.record),
  };
}

test('a two-player game in an eight-seat table archives two participants', () => {
  const f = table(); f.act('startGame'); f.finish();
  assert.equal(f.archived()[0].playerCount, 2);
  assert.equal(recapFromRoom(f.room, Date.now()).playerCount, 2);
  assert.equal(f.room.completedGames[0].seats[0].game.tableSize, 2);
});

test('growing the next-game roster preserves the frozen completed count and counts the next game separately', () => {
  const f = table(2); f.act('startGame'); f.finish();
  const firstId = f.room.gameId;
  f.act('beginIntermission'); f.act('openTableSeats');
  const joined = f.service.createConnection(); f.service.claimSeat(f.code, joined.connectionId, { seatId: 7 });
  assert.equal(recapFromRoom(f.room, Date.now()).playerCount, 2);
  f.act('setNextGameReady', { ready: true }); f.act('setNextGameReady', { ready: true }, f.guest);
  f.act('startGame'); f.finish();
  assert.notEqual(f.room.gameId, firstId);
  assert.deepEqual(f.archived().map(recap => recap.playerCount), [2, 3]);
  assert.equal(recapFromRoom(f.room, Date.now()).playerCount, 3);
});

test('claimed seats skipped from the next game do not inflate its participant count', () => {
  const f = table(); const third = f.service.createConnection();
  f.service.claimSeat(f.code, third.connectionId, { seatId: 3 });
  f.act('startGame'); f.finish(); f.act('beginIntermission');
  f.act('skipNextGameSeat', { seatId: 3 });
  assert.equal(recapFromRoom(f.room, Date.now()).playerCount, 3, 'the finished game keeps its frozen participants');
  f.act('setNextGameReady', { ready: true }); f.act('setNextGameReady', { ready: true }, f.guest);
  f.act('startGame');
  assert.equal(f.room.seats.filter(seat => seat.claimed).length, 3);
  assert.equal(recapFromRoom(f.room, Date.now()).playerCount, 2);
  f.finish(); assert.deepEqual(f.archived().map(recap => recap.playerCount), [3, 2]);
});

test('legacy rooms without roster evidence retain a configured-count fallback', () => {
  const room = { config: { playerCount: 4, startingLife: 40 }, turn: {}, seats: [] };
  assert.equal(recapFromRoom(room, Date.now()).playerCount, 4);
});
