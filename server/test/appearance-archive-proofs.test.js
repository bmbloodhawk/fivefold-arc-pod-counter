import assert from 'node:assert/strict';
import test from 'node:test';
import * as recovery from '../src/appearance-history-recovery.js';

const START = Date.UTC(2026, 8, 1, 12);
const HOUR = 3_600_000;

function fixture(index = 0, { roomCode = 'ABC123', createdAt = START, completedAt = START + (index + 1) * HOUR } = {}) {
  const gameId = `archived${String(index).padStart(8, '0')}`;
  const saved = {
    gameId: `game_saved-${index}`, sourceGameId: `${roomCode}:${completedAt}:0`,
    savedAt: completedAt + 1000, tableSize: 4, won: true,
    achievementFacts: { lowestLife: 1, tableGameNumber: 99 }, commanderName: 'A Commander Name',
  };
  const seats = [0, 1, 2, 3, 4, 5, 6, 7].map(seatId => ({ seatId, claimed: seatId < 4, counters: { life: 20 + seatId } }));
  const diagnostic = {
    gameId,
    recap: {
      gameId, roomCode, createdAt, completedAt, incomplete: false,
      winner: { seatId: 0 }, players: [0, 1, 2, 3].map(seatId => ({ seatId })),
    },
    checkpoints: [{
      gameId, sequence: 20,
      recap: { gameId, roomCode, completedAt },
      snapshot: {
        gameId, code: roomCode, config: { gameFormat: 'commander' }, sessionKind: 'standard',
        turn: { gameStarted: true, gameStartedAt: completedAt - HOUR, startedAsDevelopment: false },
        gameResult: { gameId, winnerSeatId: 0, decidedAt: completedAt }, seats,
      },
    }],
  };
  return { saved, diagnostic };
}

const proofs = (saved, diagnostics) => recovery.completionProofsFromDiagnostics(saved, diagnostics);

test('a later rematch retained under an old reused diagnostic id cannot erase or alter the earlier archived finish', () => {
  const f = fixture();
  const later = structuredClone(f.diagnostic.checkpoints[0]);
  later.at = f.diagnostic.recap.completedAt + HOUR;
  later.recap.completedAt = later.at;
  later.snapshot.gameResult.decidedAt = later.at;
  later.snapshot.seats[0].counters.life = 1;
  f.diagnostic.checkpoints.push(later);
  const [proof] = proofs([f.saved], [f.diagnostic]);
  assert.ok(proof);
  assert.equal(proof.achievementFacts.lowestLife, 20);
});

test('the retained final checkpoint yields an exact Commander completion with actual participants and winner', () => {
  const f = fixture();
  const [proof] = proofs([f.saved], [f.diagnostic]);
  assert.ok(proof);
  assert.equal(proof.sourceGameId, f.saved.sourceGameId);
  assert.equal(proof.gameId, f.diagnostic.gameId);
  assert.equal(proof.completedAt, f.diagnostic.recap.completedAt);
  assert.equal(proof.seatId, 0);
  assert.equal(proof.gameFormat, 'commander');
  assert.equal(proof.sessionKind, 'standard');
  assert.equal(proof.tableSize, 4); // Eight UI seats are not eight participants.
  assert.equal(proof.winnerSeatId, 0);
});

test('the final completion checkpoint controls format rather than a stale earlier snapshot', () => {
  const f = fixture();
  const earlier = structuredClone(f.diagnostic.checkpoints[0]);
  earlier.sequence = 1;
  earlier.recap.completedAt = null;
  earlier.snapshot.config.gameFormat = 'casual';
  earlier.snapshot.gameResult = null;
  f.diagnostic.checkpoints.unshift(earlier);
  assert.equal(proofs([f.saved], [f.diagnostic])[0]?.gameFormat, 'commander');

  f.diagnostic.checkpoints.at(-1).snapshot.config.gameFormat = 'casual';
  earlier.snapshot.config.gameFormat = 'commander';
  assert.deepEqual(proofs([f.saved], [f.diagnostic]), []);
});

test('unfinished, practice, development and evidence-free completions are excluded', () => {
  const cases = [
    f => { f.diagnostic.recap.incomplete = true; },
    f => { f.diagnostic.recap.completedAt = null; },
    f => { f.diagnostic.recap.winner = null; },
    f => { f.diagnostic.checkpoints = []; },
    f => { f.diagnostic.checkpoints[0].recap.completedAt -= 1; },
    f => { f.diagnostic.checkpoints[0].snapshot.gameResult = null; },
    f => { f.diagnostic.checkpoints[0].snapshot.gameResult.decidedAt -= 1; },
    f => { f.diagnostic.checkpoints[0].snapshot.sessionKind = 'practice'; },
    f => { f.diagnostic.checkpoints[0].snapshot.sessionKind = 'development'; },
    f => { f.diagnostic.checkpoints[0].snapshot.turn.startedAsDevelopment = true; },
    f => { delete f.diagnostic.checkpoints[0].snapshot.config.gameFormat; },
    f => { delete f.diagnostic.checkpoints[0].snapshot.sessionKind; },
  ];
  for (const [index, alter] of cases.entries()) {
    const f = fixture(index);
    alter(f);
    assert.deepEqual(proofs([f.saved], [f.diagnostic]), [], `case ${index}`);
  }
});

test('a matching room and date cannot prove a missing seat or a different server game', () => {
  for (const alter of [
    f => { f.diagnostic.recap.players = f.diagnostic.recap.players.filter(player => player.seatId !== 0); },
    f => { f.diagnostic.recap.roomCode = 'ZZZ999'; },
    f => { f.diagnostic.checkpoints[0].gameId = 'differentgame000'; },
    f => { f.diagnostic.checkpoints[0].snapshot.gameResult.gameId = 'differentgame000'; },
    f => { f.saved.sourceGameId = `ABC123:${f.diagnostic.recap.completedAt + 1}:0`; },
  ]) {
    const f = fixture();
    alter(f);
    assert.deepEqual(proofs([f.saved], [f.diagnostic]), []);
  }
});

test('conflicting final format or winner evidence is ambiguous and cannot become a proof', () => {
  for (const alter of [
    checkpoint => { checkpoint.snapshot.config.gameFormat = 'casual'; },
    checkpoint => { checkpoint.snapshot.gameResult.winnerSeatId = 1; },
  ]) {
    const f = fixture();
    const conflicting = structuredClone(f.diagnostic.checkpoints[0]);
    conflicting.sequence += 1;
    alter(conflicting);
    f.diagnostic.checkpoints.push(conflicting);
    assert.deepEqual(proofs([f.saved], [f.diagnostic]), []);
  }
});

test('low-life evidence comes only from started checkpoints for this server game, never saved client facts', () => {
  const f = fixture();
  const started = structuredClone(f.diagnostic.checkpoints[0]);
  started.sequence = 10;
  started.recap.completedAt = null;
  started.snapshot.gameResult = null;
  started.snapshot.seats[0].counters.life = 12;
  const lobby = structuredClone(started);
  lobby.sequence = 1;
  lobby.snapshot.turn.gameStarted = false;
  lobby.snapshot.seats[0].counters.life = 1;
  const anotherGame = structuredClone(started);
  anotherGame.gameId = 'anothergame00000';
  anotherGame.snapshot.gameId = 'anothergame00000';
  anotherGame.snapshot.seats[0].counters.life = 2;
  f.diagnostic.checkpoints.unshift(lobby, anotherGame, started);
  const [proof] = proofs([f.saved], [f.diagnostic]);
  assert.equal(proof.achievementFacts.lowestLife, 12);
  assert.ok(!(proof.achievementFacts.tableGameNumber >= 2));

  started.snapshot.seats[0].counters.life = 3;
  assert.equal(proofs([f.saved], [f.diagnostic])[0].achievementFacts.lowestLife, 3);
});

test('rematches require two saved verified finishes from the same original table lifetime', () => {
  const first = fixture(0);
  const rematch = fixture(1);
  const restored = proofs([first.saved, rematch.saved], [first.diagnostic, rematch.diagnostic]);
  assert.equal(restored.length, 2);
  assert.ok(restored.find(proof => proof.sourceGameId === rematch.saved.sourceGameId).achievementFacts.tableGameNumber >= 2);

  const collision = fixture(2, { createdAt: START + HOUR, completedAt: START + 3 * HOUR });
  const separate = proofs([first.saved, collision.saved], [first.diagnostic, collision.diagnostic]);
  assert.equal(separate.length, 2);
  assert.ok(separate.every(proof => !(proof.achievementFacts?.tableGameNumber >= 2)));
});

test('unverified games and games absent from the account cannot manufacture rematch evidence', () => {
  const first = fixture(0);
  const second = fixture(1);
  const onlySecondSaved = proofs([second.saved], [first.diagnostic, second.diagnostic]);
  assert.equal(onlySecondSaved.length, 1);
  assert.ok(!(onlySecondSaved[0].achievementFacts?.tableGameNumber >= 2));

  first.diagnostic.checkpoints[0].snapshot.config.gameFormat = 'casual';
  const oneVerified = proofs([first.saved, second.saved], [first.diagnostic, second.diagnostic]);
  assert.equal(oneVerified.length, 1);
  assert.ok(!(oneVerified[0].achievementFacts?.tableGameNumber >= 2));
});

function legacyEarlierCheckpoints(index = 0) {
  const f = fixture(index);
  const earlier = f.diagnostic.checkpoints[0];
  earlier.at = f.diagnostic.recap.completedAt - 1000;
  earlier.recap.completedAt = earlier.at;
  earlier.snapshot.gameResult = null;
  earlier.snapshot.seats[0].counters.life = 12;
  const first = structuredClone(earlier);
  first.sequence -= 1;
  first.at -= 1000;
  first.recap.completedAt = first.at;
  first.snapshot.seats[0].counters.life = 18;
  f.diagnostic.checkpoints.unshift(first);
  return f;
}

test('an authoritative older completion can use consistent timestamped prior gameplay when no final checkpoint was retained', () => {
  const f = legacyEarlierCheckpoints();
  const restored = proofs([f.saved], [f.diagnostic]);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].sourceGameId, f.saved.sourceGameId);
  assert.equal(restored[0].gameId, f.diagnostic.gameId);
  assert.equal(restored[0].completedAt, f.diagnostic.recap.completedAt);
  assert.equal(restored[0].gameFormat, 'commander');
  assert.equal(restored[0].sessionKind, 'standard');
  assert.equal(restored[0].winnerSeatId, 0);
  assert.equal(restored[0].tableSize, 4);
  assert.equal(restored[0].achievementFacts.lowestLife, 12);
});

test('legacy prior-checkpoint fallback rejects conflicting formats, sessions and development starts', () => {
  for (const alter of [
    checkpoint => { checkpoint.snapshot.config.gameFormat = 'casual'; },
    checkpoint => { delete checkpoint.snapshot.config.gameFormat; },
    checkpoint => { checkpoint.snapshot.sessionKind = 'practice'; },
    checkpoint => { checkpoint.snapshot.sessionKind = 'development'; },
    checkpoint => { delete checkpoint.snapshot.sessionKind; },
    checkpoint => { checkpoint.snapshot.turn.startedAsDevelopment = true; },
  ]) {
    const f = legacyEarlierCheckpoints();
    alter(f.diagnostic.checkpoints[0]);
    assert.deepEqual(proofs([f.saved], [f.diagnostic]), []);
  }
});

test('legacy fallback cannot borrow a foreign game or ignore unmatched result-bearing checkpoint evidence', () => {
  for (const alter of [
    (checkpoint, f) => { checkpoint.gameId = 'foreign_game0000'; },
    (checkpoint, f) => { checkpoint.snapshot.gameId = 'foreign_game0000'; },
    (checkpoint, f) => {
      checkpoint.snapshot.gameResult = { gameId: f.diagnostic.gameId, winnerSeatId: 0, decidedAt: checkpoint.at };
    },
  ]) {
    const f = legacyEarlierCheckpoints();
    alter(f.diagnostic.checkpoints[0], f);
    assert.deepEqual(proofs([f.saved], [f.diagnostic]), []);
  }
});

test('legacy fallback requires actual earlier gameplay timestamps and an independently complete original recap', () => {
  for (const alter of [
    f => { for (const checkpoint of f.diagnostic.checkpoints) delete checkpoint.at; },
    f => { for (const checkpoint of f.diagnostic.checkpoints) checkpoint.at = f.diagnostic.recap.completedAt; },
    f => { for (const checkpoint of f.diagnostic.checkpoints) checkpoint.snapshot.turn.gameStarted = false; },
    f => { f.diagnostic.recap.incomplete = true; },
    f => { f.diagnostic.recap.winner = null; },
    f => { f.diagnostic.recap.players = f.diagnostic.recap.players.filter(player => player.seatId !== 0); },
  ]) {
    const f = legacyEarlierCheckpoints();
    alter(f);
    assert.deepEqual(proofs([f.saved], [f.diagnostic]), []);
  }
});

test('a timestamped post-finish checkpoint can observe the exact immutable archived result', () => {
  const f = fixture();
  const checkpoint = f.diagnostic.checkpoints[0];
  checkpoint.at = f.diagnostic.recap.completedAt + 1000;
  checkpoint.recap.completedAt = checkpoint.at;
  // The recap timestamp is an observation, while the frozen result retains
  // the actual completion time and winner from the immutable archive.
  const restored = proofs([f.saved], [f.diagnostic]);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].sourceGameId, f.saved.sourceGameId);
  assert.equal(restored[0].completedAt, f.diagnostic.recap.completedAt);
  assert.equal(restored[0].winnerSeatId, f.diagnostic.recap.winner.seatId);
  assert.equal(restored[0].gameFormat, 'commander');
  assert.equal(restored[0].sessionKind, 'standard');
});

test('a post-finish observation must match the archived result and its own explicit timestamp', () => {
  for (const alter of [
    (checkpoint, f) => { checkpoint.snapshot.gameResult.decidedAt += 1; },
    (checkpoint, f) => { checkpoint.snapshot.gameResult.winnerSeatId = 1; },
    (checkpoint, f) => { checkpoint.recap.completedAt += 1; },
    (checkpoint, f) => { delete checkpoint.at; },
    (checkpoint, f) => {
      checkpoint.at = f.diagnostic.recap.completedAt - 1;
      checkpoint.recap.completedAt = checkpoint.at;
    },
    (checkpoint, f) => { checkpoint.snapshot.config.gameFormat = 'casual'; },
    (checkpoint, f) => { checkpoint.snapshot.sessionKind = 'development'; },
    (checkpoint, f) => { checkpoint.snapshot.gameResult.gameId = 'foreign_game0000'; },
  ]) {
    const f = fixture();
    const checkpoint = f.diagnostic.checkpoints[0];
    checkpoint.at = f.diagnostic.recap.completedAt + 1000;
    checkpoint.recap.completedAt = checkpoint.at;
    alter(checkpoint, f);
    assert.deepEqual(proofs([f.saved], [f.diagnostic]), []);
  }
});
