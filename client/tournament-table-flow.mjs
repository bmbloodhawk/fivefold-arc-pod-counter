// Event deadlines are independent of the Table's paused game/turn clocks.
export function tournamentTableFlow(snapshot, context, now = Date.now()) {
  if (!snapshot || !context?.linked || context.kind !== 'tournament' || context.code !== snapshot.podCode) return null;
  const round = context.tournamentRound;
  const timed = Number.isFinite(round?.endsAt) && Number.isFinite(round?.serverNow);
  return {
    finished: Boolean(snapshot.gameResult) || ['complete', 'intermission'].includes(snapshot.lifecycle?.status),
    canOpenEvent: context.canAccess === true,
    remainingMs: timed ? Math.max(0, round.endsAt - round.serverNow - Math.max(0, now - context.receivedAt)) : null,
  };
}
