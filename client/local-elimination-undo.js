const WINDOW_MS = 15_000;
const RESTORE_FIELDS = ['life', 'poison', 'radiation', 'energy', 'generic', 'commanderDamage', 'alternateElimination', 'poisonReceived', 'eliminated', 'lethalCause', 'eliminationOutcome', 'warning'];

/** Capture only the affected player's entry, never another player or turn. */
export function captureLocalElimination(player) {
  return structuredClone(Object.fromEntries(RESTORE_FIELDS.map(key => [key, player[key]])));
}

function resumeCandidate(state, now) {
  const pending = state.pendingFinish;
  state.pendingFinish = null;
  if (!pending?.pausedByFinish) return;
  const pausedFor = Math.max(0, now - pending.startedAt);
  state.turn = {
    ...state.turn, pausedAt: null,
    pausedDurationMs: (state.turn.pausedDurationMs || 0) + pausedFor,
    gameStartedAt: state.turn.gameStartedAt + pausedFor,
    turnStartedAt: state.turn.turnStartedAt + pausedFor,
    roundEndsAt: state.turn.roundEndsAt == null ? null : state.turn.roundEndsAt + pausedFor,
  };
}

/** Call after the app evaluates local player elimination flags, including ticks. */
export function advanceLocalElimination(state, { now = Date.now() } = {}) {
  if (!state?.localSimulation) return;
  if (state.gameResult || !state.turn?.gameStarted || state.lifecycle?.status !== 'playing') return;
  for (const player of state.players) if (player.eliminationUndo?.expiresAt <= now) player.eliminationUndo = null;
  const roster = state.players.filter(player => player.connectionStatus !== 'waiting');
  const survivors = roster.filter(player => !player.eliminated);
  if (roster.length < 2 || survivors.length !== 1) {
    if (state.pendingFinish) resumeCandidate(state, now);
    return;
  }
  const winnerSeatId = Number(survivors[0].id.slice(1)) - 1;
  if (state.pendingFinish && state.pendingFinish.winnerSeatId !== winnerSeatId) resumeCandidate(state, now);
  if (!state.pendingFinish) {
    state.pendingFinish = {
      winnerSeatId, expiresAt: Math.max(now + WINDOW_MS, ...roster.map(player => player.eliminationUndo?.expiresAt || 0)),
      startedAt: now, pausedByFinish: state.turn.pausedAt == null,
    };
    if (state.pendingFinish.pausedByFinish) state.turn = { ...state.turn, pausedAt: now };
  }
  if (state.pendingFinish.expiresAt > now) return;
  state.gameResult = { winnerSeatId, reason: 'last_player_standing', decidedAt: state.pendingFinish.startedAt };
  state.lifecycle = { ...state.lifecycle, status: 'complete' };
  state.pendingFinish = null;
  for (const player of state.players) player.eliminationUndo = null;
}

/** Record one already-applied local entry after evaluatePlayer has run. */
export function rememberLocalElimination(state, playerId, before, { now = Date.now(), id } = {}) {
  if (!state?.localSimulation) return;
  const player = state.players.find(player => player.id === playerId);
  if (!player || !before) return;
  player.eliminationUndo = state.turn?.gameStarted && state.lifecycle?.status === 'playing' && !state.gameResult && !before.eliminated && player.eliminated
    ? { id: id || crypto.randomUUID(), expiresAt: now + WINDOW_MS, before } : null;
  advanceLocalElimination(state, { now });
}

/** The active simulated seat owns its undo. No transport or room rewind. */
export function undoLocalElimination(state, eliminationId, { now = Date.now() } = {}) {
  advanceLocalElimination(state, { now });
  const player = state?.players?.find(player => player.id === state.activePlayerId);
  const undo = player?.eliminationUndo;
  if (!state?.localSimulation || state.gameResult || state.lifecycle?.status !== 'playing' || !player?.eliminated || !undo || undo.id !== eliminationId || undo.expiresAt <= now) {
    throw Object.assign(new Error('This elimination can no longer be undone.'), { code: 'ELIMINATION_UNDO_UNAVAILABLE' });
  }
  for (const key of RESTORE_FIELDS) player[key] = structuredClone(undo.before[key]);
  player.eliminationUndo = null;
  advanceLocalElimination(state, { now });
}
