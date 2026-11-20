/**
 * Read-only UI state for the owning player's elimination undo and shared finish
 * countdown. The server owns expiry/finalization; reaching zero never creates a
 * client result. Local simulation uses its active player instead of a claim.
 */
export function eliminationUndoPresentation(state, { now = Date.now(), status = 'connected', submitting = false } = {}) {
  const playing = state?.lifecycle?.status === 'playing' && !state.gameResult;
  const playerId = state?.localSimulation ? state.activePlayerId : state?.ownerPlayerId;
  const player = (Array.isArray(state?.players) ? state.players : []).find(player => player.id === playerId);
  const undo = player?.eliminationUndo;
  const remaining = Number.isFinite(undo?.expiresAt) ? Math.max(0, Math.ceil((undo.expiresAt - now) / 1_000)) : 0;
  const visible = Boolean(playing && player?.eliminated && typeof undo?.id === 'string' && undo.id.length && remaining > 0);
  const pending = state?.pendingFinish;
  const gamePending = Boolean(playing && Number.isInteger(pending?.winnerSeatId) && pending.winnerSeatId >= 0 && Number.isFinite(pending.expiresAt));
  return {
    visible,
    disabled: !visible || submitting || (!state?.localSimulation && status !== 'connected'),
    eliminationId: visible ? undo.id : null,
    seconds: visible ? remaining : 0,
    gamePending,
    pendingSeconds: gamePending ? Math.max(0, Math.ceil((pending.expiresAt - now) / 1_000)) : 0,
  };
}
