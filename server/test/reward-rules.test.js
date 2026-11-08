import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomService } from '../src/app.js';
import { blankMatchMoment, tableMatchMomentDecisions } from '../src/match-moments.js';

const MINUTE = 60_000;

function table(playerCount = 2) {
  let clock = 100_000;
  const service = new RoomService({ now: () => clock, connectionTtlMs: 8 * 60 * MINUTE });
  const host = service.createConnection().connectionId;
  const created = service.createRoom(host, { playerCount, startingLife: 40 });
  const code = created.snapshot.code;
  const connections = [host];
  const tokens = [created.reclaimToken];
  for (let seatId = 1; seatId < playerCount; seatId += 1) {
    const connection = service.createConnection().connectionId;
    const joined = service.claimSeat(code, connection, { seatId });
    connections.push(connection);
    tokens.push(joined.reclaimToken);
  }

  const snapshot = () => service.snapshot(service.room(code));
  const act = (method, input = {}, seatId = 0) =>
    service[method](code, connections[seatId], { ...input, baseVersion: snapshot().version });
  return {
    act,
    snapshot,
    advance: (milliseconds) => { clock += milliseconds; },
    finish: (winnerSeatId = 0) => act('declareWinner', { winnerSeatId }),
    moment: (seatId = 1, recentIds = []) => service.personalMatchMoment(code, connections[seatId], recentIds),
    reclaim(seatId) {
      const connection = service.createConnection().connectionId;
      service.claimSeat(code, connection, { seatId, reclaimToken: tokens[seatId] });
      connections[seatId] = connection;
    },
  };
}

test('the completed-game number ignores aborted games and counts distinct finishes', () => {
  const room = table();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    room.act('startGame');
    room.advance(MINUTE);
    room.act('resetRoom');
  }

  room.act('startGame');
  room.advance(MINUTE);
  room.finish();
  assert.equal(room.moment().achievementFacts.tableGameNumber, 1);

  room.act('beginIntermission');
  room.act('resetRoom');
  room.act('startGame');
  room.advance(MINUTE);
  room.finish();
  assert.equal(room.moment().achievementFacts.tableGameNumber, 2);
});

test('a guest can still read the original duration and counters after the host starts intermission', () => {
  const room = table();
  room.act('startGame');
  room.act('adjustOwnSeat', { counter: 'energy', delta: 11 }, 1);
  room.advance(61 * MINUTE);
  room.finish();
  const original = room.moment();
  assert.equal(original.achievementFacts.durationMs, 61 * MINUTE);
  assert.equal(original.counterTotals.energy, 11);

  room.act('beginIntermission');
  const after = room.moment();
  assert.deepEqual(after.achievementFacts, original.achievementFacts);
  assert.deepEqual(after.counterTotals, original.counterTotals);
  assert.deepEqual(after.moment, original.moment);
});

test('a seat reclaim after game end preserves the in-game reclaim evidence', () => {
  const room = table();
  room.act('startGame');
  room.reclaim(1);
  for (let action = 0; action < 3; action += 1) {
    room.act('adjustOwnSeat', { counter: 'energy', delta: 1 }, 1);
  }
  room.advance(MINUTE);
  room.finish();
  assert.equal(room.moment().achievementFacts.actionsAfterReclaim, 3);

  room.reclaim(1);
  const after = room.moment();
  assert.equal(after.achievementFacts.actionsAfterReclaim, 3);
  assert.equal(after.achievementFacts.reclaimedDuringGame, 1);
});

test('time in an open pause does not count toward finishing a one-hour game', () => {
  const room = table();
  room.act('startGame');
  room.advance(45 * MINUTE);
  room.act('setTurnPaused', { paused: true });
  room.advance(30 * MINUTE);
  room.finish();

  assert.equal(room.moment().achievementFacts.durationMs, 45 * MINUTE);
  assert.notEqual(room.moment().moment.category, 'Late Chapter');
});

test('recent accolade history does not remove the finished duration from selection', () => {
  const room = table();
  room.act('startGame');
  room.advance(60 * MINUTE + 1);
  room.finish();

  const seats = [0, 1].map(seatId => ({ seatId, ...room.moment(seatId, ['opening-ceremony']) }));
  assert.ok(seats.every(seat => seat.achievementFacts.durationMs === 60 * MINUTE + 1));
  const lateChapter = seats.filter(seat => seat.moment.id === 'late-chapter');
  assert.equal(lateChapter.length, 1);
  assert.equal(lateChapter[0].moment.fact, '60 minutes');
  assert.notEqual(room.moment(lateChapter[0].seatId, ['late-chapter']).moment.id, 'late-chapter');
});

test('undoing a handoff removes its contribution to turn and reclaim awards', () => {
  const room = table();
  room.act('startGame');
  room.reclaim(0);
  for (let attempt = 0; attempt < 7; attempt += 1) {
    room.advance(1000);
    room.act('handoffTurn');
    room.act('undoTurnHandoff');
  }
  room.advance(1000);
  room.act('handoffTurn');
  room.finish(1);

  const { achievementFacts, moment } = room.moment(0);
  assert.equal(achievementFacts.turnCount, 1);
  assert.equal(achievementFacts.turnsAfterReclaim, 1);
  assert.equal(achievementFacts.handoffCount, 1);
  assert.notEqual(moment.category, 'Long Vigil');
});

test('declaring a different winner after completion cannot overwrite the original result', () => {
  const room = table();
  room.act('startGame');
  room.advance(MINUTE);
  const completed = room.finish(0).snapshot.gameResult;
  room.advance(MINUTE);

  assert.throws(() => room.finish(1), { status: 409 });
  assert.deepEqual(room.snapshot().gameResult, completed);
});

test('rounds continue to accumulate when the original starting seat is eliminated', () => {
  const room = table(3);
  room.act('startGame');
  room.act('adjustOwnSeat', { counter: 'life', delta: -40 });
  for (let handoff = 0; handoff < 12; handoff += 1) {
    room.advance(1000);
    const seatId = room.snapshot().turn.activeSeatId;
    room.act('handoffTurn', {}, seatId);
  }
  room.finish(1);

  assert.ok(room.moment().achievementFacts.tableTurnNumber > 5);
});

function accoladeSeats(playerCount) {
  return Array.from({ length: playerCount }, (_, seatId) => ({
    seatId,
    claimed: true,
    commanderCount: 1,
    counters: { life: 40 },
    matchMoment: { ...blankMatchMoment(40), playerCountAtStart: playerCount },
  }));
}

function eligible(seats, seatId = 0) {
  return tableMatchMomentDecisions({ seats, winnerSeatId: 1, seed: 'reward-rule-test' }).get(seatId).eligibleCategories;
}

test('Full Court requires at least ten damage from every opposing seat', () => {
  const seats = accoladeSeats(4);
  const damage = seats[0].matchMoment.commanderDamageBySource;
  damage['seat-1-commander-a'] = 10;
  assert.equal(eligible(seats).includes('Full Court'), false);

  damage['seat-2-commander-a'] = 10;
  damage['seat-3-commander-a'] = 9;
  assert.equal(eligible(seats).includes('Full Court'), false);
  damage['seat-3-commander-a'] = 10;
  assert.equal(eligible(seats).includes('Full Court'), true);
  damage['seat-3-commander-a'] = 11;
  assert.equal(eligible(seats).includes('Full Court'), true);
});

test('Quick Study requires the unique fastest average of at most sixty seconds over three tracked turns', () => {
  const seats = accoladeSeats(3);
  const [fast, slower, tooFew] = seats.map(seat => seat.matchMoment);
  Object.assign(fast, { turnCount: 3, totalTurnMs: 180_001 });
  Object.assign(slower, { turnCount: 3, totalTurnMs: 210_000 });
  Object.assign(tooFew, { turnCount: 2, totalTurnMs: 2_000 });
  assert.equal(eligible(seats).includes('Quick Study'), false);

  fast.totalTurnMs = 180_000;
  assert.equal(eligible(seats).includes('Quick Study'), true);
  fast.totalTurnMs = 179_999;
  assert.equal(eligible(seats).includes('Quick Study'), true);

  slower.totalTurnMs = 179_999;
  assert.equal(eligible(seats).includes('Quick Study'), false);
  assert.equal(eligible(seats, 1).includes('Quick Study'), false);
  assert.equal(eligible(seats, 2).includes('Quick Study'), false);
});

test('a player with one turn cannot earn Speedrunner by matching a qualifying average', () => {
  const seats = accoladeSeats(3);
  Object.assign(seats[0].matchMoment, { turnCount: 1, totalTurnMs: 30_000 });
  Object.assign(seats[1].matchMoment, { turnCount: 2, totalTurnMs: 60_000 });
  Object.assign(seats[2].matchMoment, { turnCount: 2, totalTurnMs: 80_000 });

  assert.equal(eligible(seats).includes('Speedrunner'), false);
  assert.equal(eligible(seats, 1).includes('Speedrunner'), true);
});
