import assert from 'node:assert/strict';
import test from 'node:test';
import { createInteractionAdvice } from './card-interaction-advice.js';

test('flags a literal direct target as possible rather than guaranteed', () => {
  const advice = createInteractionAdvice(
    { name: 'Lightning Bolt', typeLine: 'Instant', oracleText: 'Lightning Bolt deals 3 damage to any target.' },
    { name: 'Grizzly Bears', typeLine: 'Creature — Bear', oracleText: '' },
  );
  assert.equal(advice.kind, 'possible_direct_target');
  assert.match(advice.conclusion, /any target/);
});

test('finds a direct target matching a card type', () => {
  const advice = createInteractionAdvice(
    { name: 'Naturalize', typeLine: 'Instant', oracleText: 'Destroy target artifact or enchantment.' },
    { name: 'Sol Ring', typeLine: 'Artifact', oracleText: '' },
  );
  assert.equal(advice.kind, 'possible_direct_target');
  assert.match(advice.conclusion, /Sol Ring/);
  assert.match(advice.limitations, /not a guaranteed/i);
});
