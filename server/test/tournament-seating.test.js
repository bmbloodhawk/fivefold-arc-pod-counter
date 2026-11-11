import assert from 'node:assert/strict';
import test from 'node:test';
import { balancedTableSizes, suggestSeating, seatingCost, validateSeating } from '../src/tournament-seating.js';

const players = count => Array.from({ length: count }, (_, i) => ({ id: `p${i}`, pointsUnits: (count - i) * 840 }));

test('balanced tables cover every attendance size without singletons and support eight seats', () => {
  for (let preferred = 2; preferred <= 8; preferred++) for (let count = 2; count <= 128; count++) {
    const sizes = balancedTableSizes(count, preferred);
    assert.equal(sizes.reduce((a, b) => a + b, 0), count);
    assert.ok(sizes.every(size => size >= 2 && size <= 8));
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1);
  }
  assert.deepEqual(balancedTableSizes(5, 4), [3, 2]);
  assert.deepEqual(balancedTableSizes(8, 8), [8]);
  assert.throws(() => balancedTableSizes(1, 4), /two|2/);
});

test('first round is seeded random, reproducible, complete and independent of standings', () => {
  const input = { participants: players(16), preferredSize: 4, roundNumber: 1, seed: 'first-round' };
  const result = suggestSeating(input);
  assert.deepEqual(suggestSeating(input), result);
  assert.deepEqual(suggestSeating({ ...input, participants: players(16).map(row => ({ ...row, pointsUnits: 0 })) }), result);
  assert.notDeepEqual(suggestSeating({ ...input, seed: 'another-round' }), result);
  assert.deepEqual(result.flat().sort(), players(16).map(row => row.id).sort());
});

test('new opponents first avoids an available rematch even when standings first chooses close points', () => {
  const participants = players(8);
  const previousTables = [['p0', 'p1', 'p2', 'p3'], ['p4', 'p5', 'p6', 'p7']];
  const input = { participants, previousTables, preferredSize: 4, roundNumber: 2, seed: 'round2' };
  const fresh = suggestSeating({ ...input, priority: 'new_opponents' });
  const close = suggestSeating({ ...input, priority: 'standings' });
  const freshCost = seatingCost(fresh, participants, previousTables);
  const closeCost = seatingCost(close, participants, previousTables);
  assert.ok(freshCost.repeatPairs < closeCost.repeatPairs);
  assert.ok(closeCost.standingSpread < freshCost.standingSpread);
  assert.equal(freshCost.repeatPairs, 4); // Two members from each old table: unavoidable repeats.
});

test('host edits must be an exact legal partition; no missing, repeated or invented entrant', () => {
  const ids = players(5).map(row => row.id);
  assert.doesNotThrow(() => validateSeating([ids.slice(0, 3), ids.slice(3)], ids));
  assert.throws(() => validateSeating([['p0', 'p1'], ['p2', 'p3']], ids), /entrant/);
  assert.throws(() => validateSeating([['p0', 'p1'], ['p1', 'p2', 'p3', 'p4']], ids), /repeat|duplicate/i);
  assert.throws(() => validateSeating([['p0'], ['p1', 'p2', 'p3', 'p4']], ids), /2|two/);
  assert.throws(() => validateSeating([['p0', 'p1'], ['p2', 'p3', 'foreign']], ids), /entrant/);
});

test('unavoidable rematches prefer fewer prior meetings, with deterministic retries', () => {
  const participants = players(8); const previousTables = [
    ['p0', 'p1', 'p2', 'p3'], ['p4', 'p5', 'p6', 'p7'],
    ['p0', 'p1', 'p4', 'p5'], ['p2', 'p3', 'p6', 'p7'],
  ];
  const input = { participants, previousTables, preferredSize: 4, roundNumber: 3, seed: 'round3' };
  const result = suggestSeating(input);
  assert.deepEqual(result, suggestSeating(input));
  assert.ok(seatingCost(result, participants, previousTables).repeatMeetings
    < seatingCost([['p0', 'p1', 'p2', 'p3'], ['p4', 'p5', 'p6', 'p7']], participants, previousTables).repeatMeetings);
});
