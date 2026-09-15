export function commanderFallbackLabel(source, owner) {
  const ownerId = source.ownerPlayerId || owner?.id || 'Player';
  return `${ownerId}'s commander${owner?.commanderCount === 2 ? ` ${source.slot === 'B' ? '2' : '1'}` : ''}`;
}

export function commanderSourceSections({ sources, players, defenderDamage, turnSeatId, turnTrackingEnabled }) {
  const suggested = turnTrackingEnabled === false ? [] : sources.filter(source => source.ownerPlayerId === turnSeatId);
  const recent = sources.filter(source => Number(defenderDamage[source.id]) > 0 && !suggested.some(item => item.id === source.id));
  const groups = players.map(owner => ({ owner, sources: sources.filter(source => source.ownerPlayerId === owner.id) })).filter(group => group.sources.length);
  return { suggested, recent, groups };
}
