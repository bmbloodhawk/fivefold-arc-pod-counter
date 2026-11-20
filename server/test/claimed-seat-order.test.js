import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomService } from '../src/app.js';

function table() {
  const service = new RoomService();
  const host = service.createConnection();
  const made = service.createRoom(host.connectionId, { playerCount: 4, startingLife: 40, name: 'Alex' });
  const code = made.snapshot.code;
  const connections = new Map([[0, host]]);
  return {
    service, host, code, connections,
    snapshot: () => service.snapshot(service.room(code)),
    claim(seatId) {
      const connection = service.createConnection();
      connections.set(seatId, connection);
      return service.claimSeat(code, connection.connectionId, { seatId, name: `Player ${seatId + 1}` });
    },
  };
}

test('new lobby claims follow claimed seat numbers immediately, regardless of arrival', () => {
  const f = table();
  assert.deepEqual(f.claim(3).snapshot.lifecycle.seatIds, [0, 3]);
  assert.deepEqual(f.claim(1).snapshot.lifecycle.seatIds, [0, 1, 3]);
  assert.deepEqual(f.claim(2).snapshot.lifecycle.seatIds, [0, 1, 2, 3]);
  let snapshot = f.service.startGame(f.code, f.host.connectionId, { baseVersion: f.snapshot().version }).snapshot;
  assert.deepEqual(snapshot.lifecycle.seatIds, [0, 1, 2, 3]);
  for (const [from, to] of [[0, 1], [1, 2], [2, 3], [3, 0]]) {
    snapshot = f.service.handoffTurn(f.code, f.connections.get(from).connectionId, { baseVersion: snapshot.version }).snapshot;
    assert.equal(snapshot.turn.activeSeatId, to);
  }
});

test('a partial table keeps its claimed seats and skips empty seats during turns', () => {
  const f = table();
  f.claim(3);
  let snapshot = f.service.startGame(f.code, f.host.connectionId, { baseVersion: f.snapshot().version }).snapshot;
  assert.deepEqual(snapshot.lifecycle.seatIds, [0, 3]);
  snapshot = f.service.handoffTurn(f.code, f.host.connectionId, { baseVersion: snapshot.version }).snapshot;
  assert.equal(snapshot.turn.activeSeatId, 3);
  snapshot = f.service.handoffTurn(f.code, f.connections.get(3).connectionId, { baseVersion: snapshot.version }).snapshot;
  assert.equal(snapshot.turn.activeSeatId, 0);
});

test('host arrangement survives later arrivals, game start, and turn handoffs', () => {
  const f = table();
  f.claim(3); f.claim(1);
  f.service.reorderNextGameSeats(f.code, f.host.connectionId, { baseVersion: f.snapshot().version, seatIds: [0, 3, 1] });
  assert.deepEqual(f.claim(2).snapshot.lifecycle.seatIds, [0, 3, 1, 2]);
  let snapshot = f.service.startGame(f.code, f.host.connectionId, { baseVersion: f.snapshot().version }).snapshot;
  assert.deepEqual(snapshot.lifecycle.seatIds, [0, 3, 1, 2]);
  for (const [from, to] of [[0, 3], [3, 1], [1, 2], [2, 0]]) {
    snapshot = f.service.handoffTurn(f.code, f.connections.get(from).connectionId, { baseVersion: snapshot.version }).snapshot;
    assert.equal(snapshot.turn.activeSeatId, to);
  }
});

test('reclaiming a seat preserves its identity and the host arrangement', () => {
  const f = table();
  const claimed = f.claim(3); f.claim(1);
  f.service.reorderNextGameSeats(f.code, f.host.connectionId, { baseVersion: f.snapshot().version, seatIds: [3, 0, 1] });
  const replacement = f.service.createConnection();
  const reclaimed = f.service.claimSeat(f.code, replacement.connectionId, { seatId: 3, reclaimToken: claimed.reclaimToken });
  assert.equal(reclaimed.seatId, 3);
  assert.deepEqual(reclaimed.snapshot.lifecycle.seatIds, [3, 0, 1]);
  assert.equal(reclaimed.snapshot.seats[3].name, 'Player 4');
});

test('a next-game arrival preserves the previous physical order', () => {
  const f = table();
  f.claim(3); f.claim(1);
  f.service.reorderNextGameSeats(f.code, f.host.connectionId, { baseVersion: f.snapshot().version, seatIds: [3, 0, 1] });
  f.service.startGame(f.code, f.host.connectionId, { baseVersion: f.snapshot().version });
  f.service.declareWinner(f.code, f.host.connectionId, { baseVersion: f.snapshot().version, winnerSeatId: 0, winCondition: 'other_declared' });
  f.service.beginIntermission(f.code, f.host.connectionId, { baseVersion: f.snapshot().version });
  const snapshot = f.claim(2).snapshot;
  assert.deepEqual(snapshot.lifecycle.seatIds, [3, 0, 1, 2]);
  assert.ok(snapshot.lifecycle.readySeatIds.includes(2));
});
