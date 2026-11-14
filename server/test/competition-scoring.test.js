import assert from 'node:assert/strict';
import test from 'node:test';
import {
  POINT_UNIT, RATING_RULE_VERSION, rankPlacements, tournamentPoints,
  ratePodGame, replayPodGames,
} from '../src/competition-scoring.js';

const seats = ['a', 'b', 'c', 'd'];
const order = seats.map(id => [id]);
const near = (actual, expected, tolerance = 1e-9) => assert.ok(
  Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`,
);
const game = (id, completedAt, finishingOrder = order, eligibleIds = seats) => ({
  gameId: id, completedAt, status: 'confirmed', starterIds: seats,
  order: finishingOrder, eligibleIds, ratingVersion: RATING_RULE_VERSION,
});

test('a confirmed order must cover the exact starter roster, with no invented or repeated seat', () => {
  assert.throws(() => rankPlacements([['a'], ['b']], seats), /starter/i);
  assert.throws(() => rankPlacements([['a'], ['b'], ['c'], ['x']], seats), /starter/i);
  assert.throws(() => rankPlacements([['a'], ['b'], ['c'], ['c']], seats), /repeat|duplicate/i);
  assert.throws(() => rankPlacements([['a'], [], ['b', 'c', 'd']], seats), /empty/i);
  assert.throws(() => rankPlacements([['a']], ['a']), /two|2/i);
  assert.throws(() => rankPlacements(Array.from({ length: 9 }, (_, i) => [String(i)]),
    Array.from({ length: 9 }, (_, i) => String(i))), /eight|8/i);
});

test('explicit ties occupy consecutive ranks and do not mutate the recorded input', () => {
  const input = Object.freeze([Object.freeze(['a']), Object.freeze(['c', 'b']), Object.freeze(['d'])]);
  const rows = rankPlacements(input, seats);
  assert.deepEqual(rows.map(row => [row.id, row.firstPlace, row.lastPlace, row.rank]), [
    ['a', 1, 1, 1], ['b', 2, 3, 2.5], ['c', 2, 3, 2.5], ['d', 4, 4, 4],
  ]);
  assert.deepEqual(input[1], ['c', 'b']);
});

test('four-player event points are exactly 3/2/1/0 and tied survivors split the remaining places', () => {
  assert.deepEqual(tournamentPoints(order, seats).map(row => row.points), [3, 2, 1, 0]);
  const draw = tournamentPoints([['a', 'b'], ['c'], ['d']], seats);
  assert.deepEqual(draw.map(row => row.points), [2.5, 2.5, 1, 0]);
  assert.ok(draw.every(row => Number.isInteger(row.pointsUnits)));
});

test('all supported table sizes share exact point units without rounded-score tie errors', () => {
  for (let count = 2; count <= 8; count++) {
    const ids = Array.from({ length: count }, (_, i) => `p${i}`);
    const rows = tournamentPoints(ids.map(id => [id]), ids);
    assert.equal(rows[0].points, 3);
    assert.equal(rows.at(-1).points, 0);
    assert.equal(rows.reduce((sum, row) => sum + row.pointsUnits, 0), count * 1260);
    assert.ok(rows.every(row => Number.isInteger(row.pointsUnits)));
    const tied = tournamentPoints([ids], ids);
    assert.ok(tied.every(row => row.pointsUnits === 1.5 * POINT_UNIT));
  }
  const eight = Array.from({ length: 8 }, (_, i) => `e${i}`);
  assert.equal(tournamentPoints(eight.map(id => [id]), eight)[1].pointsUnits, 2160);
  assert.equal(tournamentPoints([['a'], ['b'], ['c']], ['a', 'b', 'c'])[1].points, 1.5);
});

test('equal four-player ratings change by +12/+4/-4/-12 using the whole finishing order', () => {
  const result = ratePodGame({ order, starterIds: seats, eligibleIds: seats });
  assert.equal(result.version, RATING_RULE_VERSION);
  assert.equal(result.rated, true);
  assert.deepEqual(result.updates.map(row => row.delta), [12, 4, -4, -12]);
  assert.deepEqual(result.updates.map(row => row.after), [1012, 1004, 996, 988]);
  near(result.updates.reduce((sum, row) => sum + row.delta, 0), 0);
});

test('an upset carries more rating credit while second place can lose rating against expectations', () => {
  const ratings = { a: 1000, b: 1200, c: 1100, d: 900 };
  const result = ratePodGame({ order, starterIds: seats, eligibleIds: seats, ratings });
  near(result.updates[0].delta, 14.07797541318366);
  assert.ok(result.updates[0].delta > 12);
  assert.ok(result.updates[1].delta < 0);
  near(result.updates.reduce((sum, row) => sum + row.delta, 0), 0);
  assert.deepEqual(ratings, { a: 1000, b: 1200, c: 1100, d: 900 });
});

test('guest positions never become rating opponents and fewer than two members do not rate', () => {
  const result = ratePodGame({ order, starterIds: seats, eligibleIds: ['a', 'd'] });
  assert.deepEqual(result.updates.map(row => [row.id, row.delta]), [['a', 12], ['d', -12]]);
  const oneMember = ratePodGame({ order, starterIds: seats, eligibleIds: ['a'] });
  assert.equal(oneMember.rated, false);
  assert.deepEqual(oneMember.updates, []);
  assert.throws(() => ratePodGame({ order, starterIds: seats, eligibleIds: ['a', 'a'] }), /repeat|duplicate/i);
  assert.throws(() => ratePodGame({ order, starterIds: seats, eligibleIds: ['a', 'x'] }), /starter/i);
});

test('larger tables retain one game of rating weight and ties split comparisons', () => {
  for (let count = 2; count <= 8; count++) {
    const ids = Array.from({ length: count }, (_, i) => `p${i}`);
    const result = ratePodGame({ order: ids.map(id => [id]), starterIds: ids, eligibleIds: ids });
    near(result.updates[0].delta, 12);
    near(result.updates.at(-1).delta, -12);
    near(result.updates.reduce((sum, row) => sum + row.delta, 0), 0);
  }
  assert.deepEqual(ratePodGame({ order: [['a'], ['b', 'c'], ['d']], starterIds: seats, eligibleIds: seats })
    .updates.map(row => row.delta), [12, 0, 0, -12]);
});

test('replay uses completion chronology, deduplicates exact retries and rejects conflicting reuse', () => {
  const first = game('first', 10);
  const second = game('second', 20, [...order].reverse());
  assert.deepEqual(replayPodGames([second, first, structuredClone(first)]), replayPodGames([first, second]));
  const replay = replayPodGames([first, second]);
  assert.equal(replay.members.a.gamesPlayed, 2);
  assert.equal(replay.members.a.ratedGames, 2);
  assert.equal(replay.members.a.wins, 1);
  assert.throws(() => replayPodGames([first, { ...first, order: [...order].reverse() }]), /conflict/i);
});

test('correcting an earlier effective result changes later ratings without adding another game', () => {
  const first = game('first', 10);
  const second = game('second', 20, [['b'], ['a'], ['c'], ['d']]);
  const before = replayPodGames([first, second]);
  const after = replayPodGames([{ ...first, order: [['b'], ['c'], ['a'], ['d']] }, second]);
  assert.notEqual(before.games[1].updates.find(row => row.id === 'a').before,
    after.games[1].updates.find(row => row.id === 'a').before);
  assert.equal(after.members.a.gamesPlayed, 2);
  assert.equal(after.members.a.ratedGames, 2);
  assert.deepEqual(first.order, order);
});

test('only rated games advance provisional progress; pending/void results never enter statistics', () => {
  const solo = game('solo', 1, order, ['a']);
  const nine = Array.from({ length: 9 }, (_, i) => game(`g${i}`, i + 2));
  const pending = { ...game('pending', 99), status: 'pending', order: null };
  const voided = { ...game('voided', 100), status: 'void', order: null };
  const before = replayPodGames([solo, ...nine, pending, voided]);
  assert.equal(before.members.a.gamesPlayed, 10);
  assert.equal(before.members.a.ratedGames, 9);
  assert.equal(before.members.a.provisional, true);
  const after = replayPodGames([solo, ...nine, game('tenth', 12)]);
  assert.equal(after.members.a.ratedGames, 10);
  assert.equal(after.members.a.provisional, false);
  const noGuestWin = replayPodGames([game('guest-win', 20, [['b'], ['a'], ['c'], ['d']], ['a', 'c', 'd'])]);
  assert.equal(noGuestWin.members.a.wins, 0);
});

test('a chronological replay is deterministic over long history without attendance decay or drift', () => {
  const games = Array.from({ length: 1200 }, (_, i) => game(`g${i}`, i * 86_400_000,
    Array.from({ length: 4 }, (_, j) => [seats[(i + j) % 4]])));
  const replay = replayPodGames(games);
  const repeat = replayPodGames([...games].reverse());
  assert.deepEqual(repeat, replay);
  near(Object.values(replay.members).reduce((sum, member) => sum + member.rating, 0), 4000, 1e-6);
  assert.ok(Object.values(replay.members).every(member => member.ratedGames === 1200 && !member.provisional));
  assert.ok(replay.games.every(item => item.updates.every(row => Math.abs(row.delta) <= 24)));
});
