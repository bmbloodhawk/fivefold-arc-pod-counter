import assert from 'node:assert/strict';
import test from 'node:test';
import { blankMatchMoment, chooseMatchMoment, personalMatchMoment, recordMatchMoment, recordTurnMoment, tableMatchMomentDecisions } from '../src/match-moments.js';

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
  const decide = () => tableMatchMomentDecisions({ seats, winnerSeatId: 99, seed: 'test' }).get(0);
  assert.ok(!decide().eligibleCategories.includes('Commander Magnet'));

  recordMatchMoment(defender, { counter: 'commanderDamage', delta: 4, commanderSourceId: 'seat-1-commander-a', lifeAfter: 25, gameStarted: true });
  assert.ok(decide().eligibleCategories.includes('Commander Magnet'));
  const largerTable = personalMatchMoment({ seat: defender, seats: [defender, niv, atraxa, seat(3, 'Mira'), seat(4, 'Jay')], winnerSeatId: 99, seed: 'test' });
  assert.equal(largerTable.category, 'Commander Magnet');
  assert.match(largerTable.fact, /10 from Niv-Mizzet/);
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

test('life loss milestones use net damage in one turn against starting life', () => {
  const alex = seat(0, 'Alex');
  recordMatchMoment(alex, { counter: 'life', delta: -15, lifeBefore: 40, lifeAfter: 25, gameStarted: true, turnKey: 100 });
  recordMatchMoment(alex, { counter: 'commanderDamage', delta: 5, lifeBefore: 25, lifeAfter: 20, gameStarted: true, turnKey: 100 });
  assert.equal(alex.matchMoment.largestLifeLossInTurn, 20);
  assert.equal(alex.matchMoment.lifeAtLargestLossTurnStart, 40);
  assert.equal(alex.matchMoment.lostHalfLifeInOneTurn, true);
  recordMatchMoment(alex, { counter: 'life', delta: -20, lifeBefore: 20, lifeAfter: 0, gameStarted: true, turnKey: 200 });
  assert.equal(alex.matchMoment.largestLifeLossInTurn, 20);
  assert.equal(alex.matchMoment.lostAllLifeInOneTurn, false);
  recordMatchMoment(alex, { counter: 'life', delta: -20, lifeBefore: 40, lifeAfter: 20, gameStarted: true, turnKey: 300 });
  recordMatchMoment(alex, { counter: 'life', delta: -20, lifeBefore: 20, lifeAfter: 0, gameStarted: true, turnKey: 300 });
  assert.equal(alex.matchMoment.lostAllLifeInOneTurn, true);
});

test('rapid life corrections do not count as gain life or damage milestones', () => {
  const alex = seat(0, 'Alex');
  recordMatchMoment(alex, { counter: 'life', delta: -20, lifeBefore: 40, lifeAfter: 20, gameStarted: true, turnKey: 100 });
  recordMatchMoment(alex, { counter: 'life', delta: 11, lifeBefore: 20, lifeAfter: 31, gameStarted: true, turnKey: 100, isCorrection: true });
  assert.equal(alex.matchMoment.lifeGained, 0);
  assert.equal(alex.matchMoment.largestLifeLossInTurn, 9);
  assert.equal(alex.matchMoment.lostHalfLifeInOneTurn, false);
});

test('recovery tracking counts only play that continues after a reclaim', () => {
  const alex = seat(0, 'Alex');
  recordMatchMoment(alex, { counter: 'life', delta: 1, lifeAfter: 41, gameStarted: true });
  recordTurnMoment(alex, 1_000);
  assert.equal(alex.matchMoment.actionsAfterReclaim, 0);
  assert.equal(alex.matchMoment.turnsAfterReclaim, 0);
  alex.matchMoment.reclaimedDuringGame = true;
  recordMatchMoment(alex, { counter: 'life', delta: -1, lifeAfter: 40, gameStarted: true });
  recordTurnMoment(alex, 1_000);
  assert.equal(alex.matchMoment.actionsAfterReclaim, 1);
  assert.equal(alex.matchMoment.turnsAfterReclaim, 1);
});

test('a routine loss shows a completion accolade supported by the finished game', () => {
  const alex = seat(0, 'Alex'); const sam = seat(1, 'Sam');
  alex.counters.life = 18;
  const context = { durationMs: 42 * 60_000, startingSeatId: 1, gameFormat: 'commander', finishReason: 'declared_winner' };
  const decisions = tableMatchMomentDecisions({ seats: [alex, sam], winnerSeatId: 1, seed: 'test', context });
  const { moment, alternatives, selectionReason } = decisions.get(0);
  assert.equal(moment.kind, 'accolade');
  assert.equal(moment.completion, true);
  assert.equal(selectionReason, 'Recorded completion fact');
  const facts = new Set([moment, ...alternatives].map(card => card.fact));
  const actualGameFacts = ['Seat 1 · Game finished', '2-player game · Seat 1', 'Position 2 of 2 in the opening order',
    'Completed game 1 for this seat', 'Commander · Seat 1', 'Table started at 40 life · Seat 1',
    '42 min recorded · Seat 1', 'Participating seat · Seat 1', 'Winner declared · Seat 1', '18 life at the finish · Seat 1'];
  assert.ok([...facts].every(fact => actualGameFacts.includes(fact)));
  assert.equal(decisions.get(1).moment.id, 'table-victor');
});

test('a recovery receives the winner’s highlight over routine play', () => {
  const alex = seat(0, 'Alex'); const sam = seat(1, 'Sam');
  recordMatchMoment(alex, { counter: 'life', delta: -36, lifeAfter: 4, gameStarted: true });
  recordMatchMoment(alex, { counter: 'life', delta: 10, lifeAfter: 14, gameStarted: true });
  Object.assign(alex.matchMoment, { turnCount: 5, energyGained: 5 });
  const winner = tableMatchMomentDecisions({ seats: [alex, sam], winnerSeatId: 0, seed: 'winner-story' }).get(0);
  assert.equal(winner.moment.kind, 'accolade');
  assert.equal(winner.moment.category, 'Arc Victor');
  assert.match(winner.moment.fact, /Lowest life: 4/);
  assert.equal(winner.selectionReason, 'Specific standout recorded');
});

test('recovery evidence must follow the low and survival requires a real near-lethal poison count', () => {
  const alex = seat(0, 'Alex'); const sam = seat(1, 'Sam');
  Object.assign(alex.matchMoment, { lowestLife: 4, lifeGained: 30, lifeGainedAfterLow: 0, poisonGained: 9, peakPoison: 5 });
  const decide = context => tableMatchMomentDecisions({ seats: [alex, sam], winnerSeatId: 1, seed: 'recovery', context }).get(0);
  assert.ok(!decide({}).eligibleCategories.includes('Comeback Kid'));
  assert.ok(!decide({}).eligibleCategories.includes('Poison Proof'));
  alex.matchMoment.peakPoison = 9;
  assert.ok(!decide({ eliminatedSeatIds: [0] }).eligibleCategories.includes('Poison Proof'));
  assert.ok(decide({}).eligibleCategories.includes('Poison Proof'));
});

test('expanded accolades use only recorded game facts and an existing illustration key', () => {
  const alex = seat(0, 'Alex'); const sam = seat(1, 'Sam'); const seats = [alex, sam];
  Object.assign(alex.matchMoment, { lifeGained: 25, reclaimedDuringGame: true, turnsAfterReclaim: 2, actionsAfterReclaim: 3, poisonGained: 8, energyGained: 10, radiationGained: 10, usedLocalD20: true, tableGameNumber: 3, commanderDamageBySource: { 'seat-1-commander-a': 5, 'seat-1-commander-b': 5 } });
  const decision = tableMatchMomentDecisions({ seats, winnerSeatId: 99, seed: 'expanded' }).get(0);
  assert.ok(['Signal Kept', 'Charged and Glowing', 'Hazard Triad', 'Opening Ceremony'].every(category => decision.eligibleCategories.includes(category)));
  assert.ok(['arc-signal-kept-v1', 'arc-hazard-triad-v1'].includes(decision.moment.art));
});

test('new gameplay accolades use already-recorded facts and share their visual families', () => {
  const alex = seat(0, 'Alex'); const sam = seat(1, 'Sam'); const seats = [alex, sam];
  Object.assign(alex.matchMoment, {
    lowestLife: 3, lifeGained: 45, lifeGainedAfterLow: 16, actionsAfterLow: 4, lifeLostOnOwnTurn: 12,
    poisonGained: 9, peakPoison: 9, energyGained: 20, radiationGained: 15, playerCountAtStart: 6, turnCount: 5,
    commanderDamageBySource: { 'seat-1-commander-a': 2, 'seat-2-commander-a': 2, 'seat-3-commander-a': 2 },
  });
  const decision = tableMatchMomentDecisions({ seats, winnerSeatId: 99, seed: 'new-gameplay' }).get(0);
  for (const category of ['Phoenix Return', 'One More Turn', 'Tidal Shift', 'Held the Line', 'Ninth Life', 'Overflow Charge', 'Fallout March', 'All Systems Lit', 'Commander Gauntlet', 'Table Anchor', 'Long Haul', 'Wide Table Veteran']) {
    assert.ok(decision.eligibleCategories.includes(category), `${category} should be eligible`);
  }
  assert.ok(decision.eligibleCategories.includes(decision.moment.category));
  assert.equal(typeof decision.moment.art, 'string');
});

test('recent table accolades are avoided when another meaningful moment is available', () => {
  const alex = seat(0, 'Alex'); const sam = seat(1, 'Sam');
  Object.assign(alex.matchMoment, { poisonGained: 8, energyGained: 10 });
  const decision = tableMatchMomentDecisions({ seats: [alex, sam], winnerSeatId: 99, seed: 'fresh', recentCategoriesBySeat: { 0: ['Ninth Life'] } }).get(0);
  assert.equal(decision.moment.category, 'Power Surge');
});

test('recent profile accolades are avoided without adding profile state to a room', () => {
  const alex = seat(0, 'Alex'); const sam = seat(1, 'Sam');
  Object.assign(alex.matchMoment, { poisonGained: 8, energyGained: 10 });
  const decision = tableMatchMomentDecisions({ seats: [alex, sam], winnerSeatId: 99, seed: 'profile-fresh', recentAccoladeIdsBySeat: { 0: ['ninth-life'] } }).get(0);
  assert.equal(decision.moment.category, 'Power Surge');
  assert.equal(decision.moment.id, 'power-surge');
});

test('seeds choose different eligible accolades without changing a completed-game result', () => {
  const alex = seat(0, 'Alex'); const sam = seat(1, 'Sam');
  Object.assign(alex.matchMoment, { lifeGained: 25, energyGained: 10 });
  const decide = seed => tableMatchMomentDecisions({ seats: [alex, sam], winnerSeatId: 99, seed }).get(0);
  assert.deepEqual(decide('variety-a'), decide('variety-a'));
  const moments = new Set(Array.from({ length: 20 }, (_, index) => decide('variety-' + index).moment.id));
  assert.deepEqual(moments, new Set(['power-surge', 'second-serving']));
  assert.equal(decide('variety-a').selectionReason, 'Distinct match moment recorded');
});

test('profile recency chooses a fresh reserved card or the least recently shown eligible card', () => {
  const recovery = { id: 'phoenix-return' };
  const clock = { id: 'clock-record' };
  const finish = { id: 'arc-complete' };
  const options = [recovery, clock, finish];
  assert.equal(chooseMatchMoment(options, ['second-wind', 'clock-record']), finish);
  assert.equal(chooseMatchMoment(options, ['arc-complete', 'phoenix-return', 'clock-record']), clock);
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
  assert.ok(tableMatchMomentDecisions({ seats, winnerSeatId: 99, seed: 'test' }).get(0).eligibleCategories.includes('Royal Reception'));
  recordMatchMoment(sam, { counter: 'commanderDamage', delta: 14, commanderSourceId: 'seat-0-commander-a', lifeAfter: 26, gameStarted: true });
  assert.notEqual(personalMatchMoment({ seat: alex, seats, winnerSeatId: 99, seed: 'test' }).category, 'Royal Reception');
});

test('Paid in Blood records only manual life lost on that player\'s own turn', () => {
  const alex = seat(0, 'Alex');
  const sam = seat(1, 'Sam');
  const seats = [alex, sam];
  recordMatchMoment(alex, { counter: 'life', delta: -9, lifeAfter: 31, gameStarted: true, isOwnTurn: false });
  assert.equal(alex.matchMoment.lifeLostOnOwnTurn, 0);
  recordMatchMoment(alex, { counter: 'commanderDamage', delta: 9, commanderSourceId: 'seat-1-commander-a', lifeAfter: 22, gameStarted: true, isOwnTurn: true });
  assert.equal(alex.matchMoment.lifeLostOnOwnTurn, 0);
  recordMatchMoment(alex, { counter: 'life', delta: -8, lifeAfter: 14, gameStarted: true, isOwnTurn: true });
  assert.equal(personalMatchMoment({ seat: alex, seats, winnerSeatId: 99, seed: 'test' }).category, 'Paid in Blood');
});
