import { createHash } from 'node:crypto';

const keyFor = value => createHash('sha256').update(value).digest('hex');

// Old releases did not always checkpoint the finish. The original recap can
// still prove it, paired with explicitly timestamped, consistent gameplay
// checkpoints for that same server game. Missing or conflicting facts fail shut.
export function completionProofsFromDiagnostics(legacyGames, diagnostics) {
  const candidates = new Map();
  for (const diagnostic of diagnostics) {
    const recap = diagnostic.recap;
    if (!recap || recap.gameId !== diagnostic.gameId || recap.incomplete === true
      || !Number.isSafeInteger(recap.completedAt) || recap.completedAt <= 0
      || !/^[A-Z0-9]{6}$/.test(recap.roomCode || '') || !Array.isArray(recap.players)
      || !recap.players.some(player => player.seatId === recap.winner?.seatId)) continue;
    const checkpoints = diagnostic.checkpoints || [];
    const belongs = checkpoint => checkpoint.gameId === diagnostic.gameId
      && (!checkpoint.snapshot?.gameId || checkpoint.snapshot.gameId === diagnostic.gameId)
      && checkpoint.snapshot?.code === recap.roomCode;
    const resultCheckpoints = checkpoints.filter(checkpoint => checkpoint.snapshot?.gameResult)
      .filter(checkpoint => !(belongs(checkpoint) && Number.isFinite(checkpoint.at)
        && checkpoint.snapshot.gameResult.decidedAt > recap.completedAt
        && checkpoint.at >= checkpoint.snapshot.gameResult.decidedAt
        && checkpoint.recap?.completedAt === checkpoint.at));
    const final = resultCheckpoints.filter(checkpoint => belongs(checkpoint)
      && (checkpoint.recap?.completedAt === recap.completedAt
        || (Number.isFinite(checkpoint.at) && checkpoint.at >= recap.completedAt
          && checkpoint.recap?.completedAt === checkpoint.at))
      && checkpoint.snapshot.gameResult.decidedAt === recap.completedAt
      && (!checkpoint.snapshot.gameResult.gameId || checkpoint.snapshot.gameResult.gameId === diagnostic.gameId)
      && checkpoint.snapshot.gameResult.winnerSeatId === recap.winner.seatId);
    if (final.length !== resultCheckpoints.length) continue;
    let evidence = final;
    if (!evidence.length) {
      evidence = checkpoints.filter(checkpoint => checkpoint.snapshot?.turn?.gameStarted === true);
      if (!evidence.length || evidence.some(checkpoint => !belongs(checkpoint)
        || !Number.isFinite(checkpoint.at) || checkpoint.at >= recap.completedAt)) continue;
    }
    if (evidence.some(checkpoint => checkpoint.snapshot.config?.gameFormat !== 'commander'
      || checkpoint.snapshot.sessionKind !== 'standard' || checkpoint.snapshot.turn?.startedAsDevelopment === true)) continue;
    const players = [...new Set(recap.players.map(player => player.seatId))];
    if (players.length !== recap.players.length || players.length < 2 || players.length > 8
      || players.some(seatId => !Number.isInteger(seatId) || seatId < 0 || seatId > 7)) continue;
    for (const seatId of players) {
      const sourceGameId = `${recap.roomCode}:${recap.completedAt}:${seatId}`;
      if (!legacyGames.some(saved => saved.sourceGameId === sourceGameId)) continue;
      const life = checkpoints.filter(checkpoint => belongs(checkpoint)
        && checkpoint.snapshot.turn?.gameStarted === true
        && (!Number.isFinite(checkpoint.at) || checkpoint.at <= recap.completedAt)
        && checkpoint.snapshot.turn.gameStartedAt <= recap.completedAt)
        .map(checkpoint => checkpoint.snapshot.seats?.find(seat => seat.seatId === seatId)?.counters?.life)
        .filter(Number.isFinite);
      const proof = {
        sourceGameId, gameId: diagnostic.gameId, completedAt: recap.completedAt, seatId,
        gameFormat: 'commander', sessionKind: 'standard', winnerSeatId: recap.winner.seatId,
        tableSize: players.length, achievementFacts: {
          ...(life.length ? { lowestLife: Math.min(...life) } : {}),
        },
      };
      const entries = candidates.get(sourceGameId) || [];
      entries.push({ proof, tableIdentity: Number.isFinite(recap.createdAt) ? `${recap.roomCode}:${recap.createdAt}` : null });
      candidates.set(sourceGameId, entries);
    }
  }
  const verified = [...candidates.values()].filter(entries => entries.length === 1).map(([entry]) => entry)
    .sort((a, b) => a.proof.completedAt - b.proof.completedAt);
  const tableGames = new Map();
  for (const { proof, tableIdentity } of verified) {
    if (!tableIdentity) continue;
    // Include the seat so unrelated players' records cannot create a rematch.
    const key = tableIdentity + ':' + proof.seatId;
    const count = (tableGames.get(key) || 0) + 1;
    tableGames.set(key, count);
    proof.achievementFacts.tableGameNumber = count;
  }
  return verified.map(({ proof }) => proof);
}

// Only the private operator supplies proofs, after reading the retained server
// archive. A commander name, starting life or client-supplied fact is no proof.
export function legacyAppearanceGames(legacyGames, progress, completionProofs) {
  const proofs = new Map();
  for (const proof of completionProofs) {
    if (!proof || typeof proof.sourceGameId !== 'string') continue;
    const previous = proofs.get(proof.sourceGameId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(proof)) proofs.set(proof.sourceGameId, { ambiguous: true });
    else if (!previous) proofs.set(proof.sourceGameId, proof);
  }
  const games = {}, skipped = [];
  for (const saved of legacyGames) {
    const proof = proofs.get(saved.sourceGameId);
    const skip = reason => skipped.push({ gameId: saved.gameId, reason });
    if (!proof) { skip('missing-completion-evidence'); continue; }
    if (proof.ambiguous) { skip('ambiguous-completion-evidence'); continue; }
    if (proof.gameFormat !== 'commander') { skip('not-commander'); continue; }
    if (proof.sessionKind !== 'standard') { skip('not-standard'); continue; }
    const source = /^([A-Z0-9]{6}):([0-9]+):([0-7])$/.exec(saved.sourceGameId || '');
    if (!source || !Number.isSafeInteger(proof.completedAt) || proof.completedAt <= 0
      || Number(source[2]) !== proof.completedAt || Number(source[3]) !== proof.seatId
      || !/^[A-Za-z0-9_-]{16}$/.test(proof.gameId || '')
      || !Number.isInteger(proof.winnerSeatId) || proof.winnerSeatId < 0 || proof.winnerSeatId > 7
      || !Number.isInteger(proof.tableSize) || proof.tableSize < 2 || proof.tableSize > 8
      || proof.tableSize !== saved.tableSize || (proof.winnerSeatId === proof.seatId) !== saved.won) {
      skip('completion-does-not-match'); continue;
    }
    const key = keyFor(proof.gameId);
    if (progress.removed?.[key] || progress.removedLegacy?.[keyFor(saved.sourceGameId)]) { skip('removed-game'); continue; }
    if (progress.games?.[key] || games[key]) { skip('already-verified'); continue; }
    const achievementFacts = {};
    if (Number.isFinite(proof.achievementFacts?.lowestLife)) achievementFacts.lowestLife = proof.achievementFacts.lowestLife;
    if (Number.isSafeInteger(proof.achievementFacts?.tableGameNumber) && proof.achievementFacts.tableGameNumber > 0) achievementFacts.tableGameNumber = proof.achievementFacts.tableGameNumber;
    games[key] = {
      gameId: saved.gameId, sourceGameId: saved.sourceGameId, completedAt: proof.completedAt,
      gameFormat: 'commander', completionVerified: true, won: saved.won,
      tableSize: proof.tableSize, deckId: saved.deckId || null, achievementFacts,
    };
  }
  return { games, skipped };
}

export function appearanceCommanderGames(progress, legacyGames) {
  const sources = new Map(legacyGames.map(game => [game.gameId, game.sourceGameId]));
  const recovered = Object.entries(progress.appearanceRecovery?.games || {})
    .filter(([key, game]) => !progress.games?.[key] && !progress.removed?.[key]
      && sources.get(game.gameId) === game.sourceGameId)
    .map(([, game]) => game);
  return [...Object.values(progress.games || {}), ...recovered]
    .filter(game => game.completionVerified === true && game.gameFormat === 'commander');
}
