import assert from 'node:assert/strict';
import test from 'node:test';
import { blankMatchMoment, personalMatchMoment, recordMatchMoment } from '../src/match-moments.js';

function seat(seatId, name, commanderNames = []) {
  return { seatId, name, commanderNames, counters: { life: 40 }, matchMoment: blankMatchMoment(40) };
}

test('Commander Magnet requires ten damage from one commander, not ten damage spread around the table', () => {
  const defender = seat(0, 'Alex');
  const niv = seat(1, 'Sam', ['Niv-Mizzet']);
  const atraxa = seat(2, 'Jo', ['Atraxa']);
  const seats = [defender, niv, atraxa];

  recordMatchMoment(defender, { counter: 'commanderDamage', delta: 6, commanderSourceId: 'seat-1-commander-a', lifeAfter: 34, gameStarted: true });
  recordMatchMoment(defender, { counter: 'commanderDamage', delta: 5, commanderSourceId: 'seat-2-commander-a', lifeAfter: 29, gameStarted: true });
  assert.notEqual(personalMatchMoment({ seat: defender, seats, winnerSeatId: 99, seed: 'test' }).category, 'Commander Magnet');

  recordMatchMoment(defender, { counter: 'commanderDamage', delta: 4, commanderSourceId: 'seat-1-commander-a', lifeAfter: 25, gameStarted: true });
  const moment = personalMatchMoment({ seat: defender, seats, winnerSeatId: 99, seed: 'test' });
  assert.equal(moment.category, 'Commander Magnet');
  assert.match(moment.fact, /10 from Niv-Mizzet/);
});

test('match moments ignore setup changes and preserve the low-life and comeback priorities', () => {
  const defender = seat(0, 'Alex');
  const seats = [defender];
  recordMatchMoment(defender, { counter: 'life', delta: -36, lifeAfter: 4, gameStarted: false });
  assert.equal(defender.matchMoment.lowestLife, 40);

  recordMatchMoment(defender, { counter: 'life', delta: -36, lifeAfter: 4, gameStarted: true });
  recordMatchMoment(defender, { counter: 'life', delta: 10, lifeAfter: 14, gameStarted: true });
  assert.equal(personalMatchMoment({ seat: defender, seats, winnerSeatId: 99, seed: 'test' }).category, 'Comeback Kid');
});

test('Legend Collector goes only to the unique player hit by the most different commanders', () => {
  const alex = seat(0, 'Alex');
  const sam = seat(1, 'Sam', ['Niv-Mizzet']);
  const jo = seat(2, 'Jo', ['Atraxa']);
  const kaya = seat(3, 'Kaya', ['Krenko']);
  const seats = [alex, sam, jo, kaya];
  for (const source of ['seat-1-commander-a', 'seat-2-commander-a', 'seat-3-commander-a']) recordMatchMoment(alex, { counter: 'commanderDamage', delta: 2, commanderSourceId: source, lifeAfter: 34, gameStarted: true });
  recordMatchMoment(sam, { counter: 'commanderDamage', delta: 2, commanderSourceId: 'seat-0-commander-a', lifeAfter: 38, gameStarted: true });
  assert.equal(personalMatchMoment({ seat: alex, seats, winnerSeatId: 99, seed: 'test' }).category, 'Legend Collector');

  recordMatchMoment(sam, { counter: 'commanderDamage', delta: 2, commanderSourceId: 'seat-2-commander-a', lifeAfter: 36, gameStarted: true });
  recordMatchMoment(sam, { counter: 'commanderDamage', delta: 2, commanderSourceId: 'seat-3-commander-a', lifeAfter: 34, gameStarted: true });
  assert.notEqual(personalMatchMoment({ seat: alex, seats, winnerSeatId: 99, seed: 'test' }).category, 'Legend Collector');
});

test('Royal Reception scales with the table size and requires a unique highest total', () => {
  const alex = seat(0, 'Alex');
  const sam = seat(1, 'Sam');
  const jo = seat(2, 'Jo');
  const kaya = seat(3, 'Kaya');
  const seats = [alex, sam, jo, kaya];
  for (const item of seats) item.matchMoment.playerCountAtStart = 4;
  recordMatchMoment(alex, { counter: 'commanderDamage', delta: 7, commanderSourceId: 'seat-1-commander-a', lifeAfter: 33, gameStarted: true });
  recordMatchMoment(alex, { counter: 'commanderDamage', delta: 6, commanderSourceId: 'seat-2-commander-a', lifeAfter: 27, gameStarted: true });
  assert.notEqual(personalMatchMoment({ seat: alex, seats, winnerSeatId: 99, seed: 'test' }).category, 'Royal Reception');
  recordMatchMoment(alex, { counter: 'commanderDamage', delta: 1, commanderSourceId: 'seat-2-commander-a', lifeAfter: 26, gameStarted: true });
  assert.equal(personalMatchMoment({ seat: alex, seats, winnerSeatId: 99, seed: 'test' }).category, 'Royal Reception');
  recordMatchMoment(sam, { counter: 'commanderDamage', delta: 14, commanderSourceId: 'seat-0-commander-a', lifeAfter: 26, gameStarted: true });
  assert.notEqual(personalMatchMoment({ seat: alex, seats, winnerSeatId: 99, seed: 'test' }).category, 'Royal Reception');
});
