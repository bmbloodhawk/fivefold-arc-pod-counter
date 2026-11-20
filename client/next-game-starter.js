// Array order describes the clockwise table. Departed IDs distinguish new
// occupants of reused seats from the players in the completed game's order.
export function nextGameStarterPolicy({ previousStarterSeatId = null, previousSeatIds = [], seatIds = [], overrideSeatId = null, departedSeatIds = [] } = {}) {
  const anchor = Number.isInteger(previousStarterSeatId) ? previousStarterSeatId : null;
  const previous = [...previousSeatIds], current = [...seatIds], departed = [...departedSeatIds];
  const currentAnchorIndex = current.indexOf(anchor);
  let defaultSeatId = null;
  if (currentAnchorIndex !== -1 && !departed.includes(anchor)) defaultSeatId = current[(currentAnchorIndex + 1) % current.length];
  else {
    const previousAnchorIndex = previous.indexOf(anchor);
    if (previousAnchorIndex !== -1) {
      for (let offset = 1; offset <= previous.length; offset++) {
        const candidate = previous[(previousAnchorIndex + offset) % previous.length];
        if (current.includes(candidate) && !departed.includes(candidate)) { defaultSeatId = candidate; break; }
      }
    }
    defaultSeatId ??= current[0] ?? null;
  }
  const override = current.includes(overrideSeatId) ? overrideSeatId : null;
  return { previousStarterSeatId: anchor, previousSeatIds: previous, defaultSeatId, overrideSeatId: override, departedSeatIds: departed, selectedSeatId: override ?? defaultSeatId };
}
