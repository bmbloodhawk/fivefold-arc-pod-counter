// Versioned, pure competition rules. Sources and revisions remain outside this module.
export const POINT_UNIT = 840;
export const RATING_RULE_VERSION = 'elo-placement-v1';
const INITIAL_RATING = 1000;
const K = 24;

export function rankPlacements(order, starterIds) {
  if (!Array.isArray(starterIds) || starterIds.length < 2 || starterIds.length > 8) {
    throw new Error('A table needs two to eight (2–8) starters.');
  }
  if (starterIds.some(id => typeof id !== 'string' || !id) || new Set(starterIds).size !== starterIds.length) {
    throw new Error('Duplicate or invalid starter.');
  }
  if (!Array.isArray(order) || !order.length) throw new Error('The order must cover every starter.');
  const seen = new Set();
  const rows = [];
  for (const group of order) {
    if (!Array.isArray(group) || !group.length) throw new Error('A placement group cannot be empty.');
    const firstPlace = rows.length + 1;
    const lastPlace = rows.length + group.length;
    for (const id of [...group].sort()) {
      if (seen.has(id)) throw new Error('Duplicate starter in finishing order.');
      if (!starterIds.includes(id)) throw new Error('Finishing order contains a foreign starter.');
      seen.add(id);
      rows.push({ id, firstPlace, lastPlace, rank: (firstPlace + lastPlace) / 2 });
    }
  }
  if (seen.size !== starterIds.length) throw new Error('The order must cover every starter.');
  return rows;
}

export function tournamentPoints(order, starterIds) {
  return rankPlacements(order, starterIds).map(row => {
    const pointsUnits = 3 * POINT_UNIT * (2 * starterIds.length - row.firstPlace - row.lastPlace)
      / (2 * (starterIds.length - 1));
    return { ...row, pointsUnits, points: pointsUnits / POINT_UNIT };
  });
}

export function ratePodGame({ order, starterIds, eligibleIds, ratings = {} }) {
  const places = rankPlacements(order, starterIds);
  if (!Array.isArray(eligibleIds) || new Set(eligibleIds).size !== eligibleIds.length) {
    throw new Error('Duplicate or invalid eligible member.');
  }
  if (eligibleIds.some(id => !starterIds.includes(id))) throw new Error('Eligible member must be a starter.');
  const members = places.filter(row => eligibleIds.includes(row.id));
  if (members.length < 2) return { version: RATING_RULE_VERSION, rated: false, updates: [] };
  const rating = id => {
    const value = ratings[id] ?? INITIAL_RATING;
    if (!Number.isFinite(value)) throw new Error('Invalid rating.');
    return value;
  };
  const updates = members.map(player => {
    const before = rating(player.id);
    const comparisons = members.filter(opponent => opponent.id !== player.id).map(opponent => {
      const actual = player.rank < opponent.rank ? 1 : player.rank === opponent.rank ? 0.5 : 0;
      const expected = 1 / (1 + 10 ** ((rating(opponent.id) - before) / 400));
      return actual - expected;
    });
    const delta = K * comparisons.reduce((sum, value) => sum + value, 0) / comparisons.length;
    return { id: player.id, before, delta, after: before + delta };
  });
  return { version: RATING_RULE_VERSION, rated: true, updates };
}

// Input is one effective revision per game. The ledger selects revisions, never arrival order.
export function replayPodGames(input) {
  const unique = new Map();
  for (const game of input) {
    if (game.status !== 'confirmed') continue;
    if (game.ratingVersion !== RATING_RULE_VERSION) throw new Error('Unsupported rating rule version.');
    if (!game.gameId || !Number.isFinite(game.completedAt)) throw new Error('Invalid source game.');
    const canonical = JSON.stringify({
      completedAt: game.completedAt, starterIds: [...game.starterIds].sort(),
      order: game.order.map(group => [...group].sort()), eligibleIds: [...game.eligibleIds].sort(),
      ratingVersion: game.ratingVersion,
    });
    if (unique.has(game.gameId) && unique.get(game.gameId).canonical !== canonical) {
      throw new Error('Conflicting reuse of a source game.');
    }
    unique.set(game.gameId, { game, canonical });
  }
  const members = Object.create(null);
  const games = [];
  for (const { game } of [...unique.values()].sort((a, b) =>
    a.game.completedAt - b.game.completedAt || a.game.gameId.localeCompare(b.game.gameId))) {
    const result = ratePodGame({ ...game, ratings: Object.fromEntries(
      Object.entries(members).map(([id, member]) => [id, member.rating]),
    ) });
    for (const id of game.eligibleIds) {
      const member = members[id] ??= { rating: INITIAL_RATING, gamesPlayed: 0, ratedGames: 0, wins: 0, provisional: true };
      member.gamesPlayed++;
      if (game.order[0].length === 1 && game.order[0][0] === id) member.wins++;
      const update = result.updates.find(row => row.id === id);
      if (update) {
        member.rating = update.after;
        member.ratedGames++;
        member.provisional = member.ratedGames < 10;
      }
    }
    games.push({ gameId: game.gameId, ...result });
  }
  return { members, games };
}
