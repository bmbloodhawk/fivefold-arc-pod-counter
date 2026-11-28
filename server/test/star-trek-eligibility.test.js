import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import list from '../static-data/star-trek-commanders.v1.json' with { type: 'json' };
import { startingCommanderEvidenceFor } from '../src/starting-commander-evidence.js';
import {
  beginExplorationCommission, advanceExplorationCommission, explorationCommissionProgress,
} from '../src/exploration-commission.js';

const START = Date.UTC(2026, 10, 20, 12);
const DAY = 86_400_000;
const fresh = () => beginExplorationCommission('America/Los_Angeles', START);
function complete(names, id = 'one', day = 0, turns = 1) {
  return {
    gameId: id, seatId: 0, tableIdentity: 'eligibility-test', sessionKind: 'standard',
    startedAt: START + day * DAY, completedAt: START + day * DAY + 1000,
    game: {
      gameFormat: 'commander',
      startingCommanderEvidence: startingCommanderEvidenceFor(names),
      achievementFacts: { turnCount: turns },
    },
  };
}
const advance = (mission, completion) => advanceExplorationCommission(mission, completion, completion.gameId);

test('reviewed v1 scope and canonical mappings stay fixed until deliberately versioned', () => {
  assert.equal(list.version, 'star-trek-commanders-v1-2026-11-27');
  assert.equal(list.cards.length, 228);
  assert.equal(list.cards.filter(card => card.scope === 'trek-native').length, 197);
  assert.equal(list.cards.filter(card => card.scope === 'explicit-trek-reskin').length, 31);
  assert.equal(list.cards.reduce((count, card) => count + card.printings.length, 0), 423);
  assert.equal(list.cards.reduce((count, card) => count + card.eligibleNames.length, 0), 229);
  assert.equal(new Set(list.cards.map(card => card.oracleId)).size, list.cards.length);
  assert.equal(createHash('sha256').update(JSON.stringify(list.cards)).digest('hex'),
    '560f314ce935eeab36e72dd07fd96784a3552b66beeb124a07e2e85da34f3b38');
  assert.ok(list.cards.every(card => card.commanderLegal && card.printings.length && card.eligibleNames.length));
  assert.deepEqual(list.cards.filter(card => card.keywords.includes('Partner')).map(card => card.name),
    ['Silas Renn, Seeker Adept', 'Thrasios, Triton Hero']);
});

test('every reviewed eligible name resolves its canonical starting identity and receives credit', () => {
  for (const card of list.cards) for (const name of card.eligibleNames) {
    const completion = complete([name]);
    assert.equal(completion.game.startingCommanderEvidence.resolved, true, name);
    assert.equal(completion.game.startingCommanderEvidence.cards[0].oracleId, card.oracleId, name);
    const progress = explorationCommissionProgress(advance(fresh(), completion));
    assert.deepEqual([progress.commanderVariety, progress.recordedTurns, progress.playDates], [1, 1, 1], name);
  }
});

test('all 31 generic mechanical reskin names resolve identity but never qualify through product membership', () => {
  for (const card of list.cards.filter(card => card.scope === 'explicit-trek-reskin')) {
    const mission = fresh();
    const generic = complete([card.name]);
    assert.equal(generic.game.startingCommanderEvidence.resolved, true, card.name);
    assert.equal(generic.game.startingCommanderEvidence.cards[0].oracleId, card.oracleId, card.name);
    assert.strictEqual(advance(mission, generic), mission, card.name);
    assert.equal(card.eligibleNames.includes(card.name), false, card.name);
    assert.ok(card.printings.every(printing => card.eligibleNames.includes(printing.trekName)), card.name);
  }
});

test('unrelated reprints and loose Trek guesses fail closed even with eligible final names', () => {
  const mission = fresh();
  for (const name of ['Loran of the Third Path', 'Sol Ring', 'Spock', 'Captain Kirk',
    'Commander Spock alternate art', 'S.S. Cerritos, California-Class']) {
    const completion = complete([name]);
    completion.game.commanderName = 'Commander Spock';
    assert.strictEqual(advance(mission, completion), mission, name);
  }
  assert.equal(list.cards.some(card => card.name === 'Loran of the Third Path'), false);
});

test('native reprints, exact casing and reviewed ASCII aliases remain one canonical card', () => {
  const spock = list.cards.find(card => card.name === 'Commander Spock');
  assert.ok(spock.printings.length >= 2);
  const first = complete(['Commander Spock'], 'spock-base', 0, 10);
  const reprint = complete(['  COMMANDER SPOCK  '], 'spock-reprint', 1, 10);
  assert.deepEqual(first.game.startingCommanderEvidence.cards.map(card => card.identity),
    reprint.game.startingCommanderEvidence.cards.map(card => card.identity));
  let mission = advance(advance(fresh(), first), reprint);
  assert.equal(explorationCommissionProgress(mission).commanderVariety, 1);
  assert.strictEqual(advance(mission, reprint), mission);
  assert.equal(explorationCommissionProgress(mission).recordedTurns, 20);

  const unicode = complete(['Vo\u0303x, Child of the Collective'], 'vox-unicode', 0);
  const ascii = complete(['Vox, Child of the Collective'], 'vox-ascii', 1);
  assert.deepEqual(unicode.game.startingCommanderEvidence.cards.map(card => card.identity),
    ascii.game.startingCommanderEvidence.cards.map(card => card.identity));
  mission = advance(advance(fresh(), unicode), ascii);
  assert.equal(explorationCommissionProgress(mission).commanderVariety, 1);
});

test('actual Tendi and Rutherford pair order, replay, and generic alias cannot fill both rotation slots', () => {
  const tendi = 'Tendi, Exploring the Future', rutherford = 'Rutherford, Rebuilding the Past';
  const pair = complete([tendi, rutherford], 'pair', 0, 9);
  let mission = advance(fresh(), pair);
  assert.equal(explorationCommissionProgress(mission).commanderVariety, 1);
  assert.strictEqual(advance(mission, pair), mission);
  mission = advance(mission, complete([rutherford, tendi], 'reversed', 1, 9));
  mission = advance(mission, complete([tendi, rutherford], 'replayed', 2, 9));
  mission = advance(mission, complete(['Thrasios, Triton Hero', rutherford], 'same-canonical-pair', 3, 9));
  assert.deepEqual(explorationCommissionProgress(mission), {
    startedAt: START, timeZone: 'America/Los_Angeles', earnedAt: null,
    commanderVariety: 1, recordedTurns: 25, playDates: 3,
  });
  mission = advance(mission, complete([tendi], 'distinct-starting-lineup', 4));
  assert.equal(explorationCommissionProgress(mission).commanderVariety, 2);
  assert.equal(mission.earnedAt, START + 4 * DAY + 1000);
});

test('a different card depicting the same Trek character counts separately in a separate game', () => {
  let mission = advance(fresh(), complete(['Commander Spock'], 'spock-commander'));
  mission = advance(mission, complete(['Mr. Spock, Science Officer'], 'spock-scientist', 1));
  assert.equal(explorationCommissionProgress(mission).commanderVariety, 2);
  assert.equal(explorationCommissionProgress(mission).recordedTurns, 2);
  assert.equal(mission.earnedAt, undefined);
});
