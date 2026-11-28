import eligibility from '../static-data/star-trek-commanders.v1.json' with { type: 'json' };

export const EXPLORATION_COMMISSION = Object.freeze({
  id: 'exploration-commission', title: 'Exploration Commission', rarity: 'rare',
  detail: 'Complete Command Rotation, Survey Record, and Return Voyages.',
});
const exactName = value => typeof value === 'string' ? value.normalize('NFC').trim().toLocaleLowerCase('en-US') : '';
const eligibleNames = new Map(eligibility.cards.map(card => [card.oracleId, new Set(card.eligibleNames.map(exactName))]));
const timestamp = value => Number.isSafeInteger(value) && value >= 0;
const invalidTimeZone = message => Object.assign(new TypeError(message), {status: 400, code: 'INVALID_INPUT'});

export function beginExplorationCommission(timeZone, startedAt) {
  // Intl also accepts fixed offsets and abbreviations. This track requires a
  // named IANA zone, so reject those before asking Intl to validate the name.
  if (typeof timeZone !== 'string' || timeZone.length > 100
    || !/^(?:UTC|GMT|[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)+)$/.test(timeZone) || !timestamp(startedAt)) {
    throw invalidTimeZone('Choose a named IANA timezone to begin Exploration Commission.');
  }
  let canonical;
  try { canonical = new Intl.DateTimeFormat('en-US', {timeZone}).resolvedOptions().timeZone; }
  catch { throw invalidTimeZone('Choose a valid IANA timezone to begin Exploration Commission.'); }
  return {ruleVersion: 1, eligibilityVersion: eligibility.version, startedAt, timeZone: canonical, credits: {}};
}

function objectiveCounts(mission) {
  const credits = Object.values(mission?.credits || {});
  // Two distinct cards must be represented in separate games with different
  // starting lineups. Two partners in one game fill only the first slot.
  const lineups = new Map();
  for (const credit of credits) {
    const ids = lineups.get(credit.lineup) || new Set();
    credit.eligibleIds.forEach(id => ids.add(id));
    lineups.set(credit.lineup, ids);
  }
  const [first, ...others] = [...lineups.values()];
  const commanderVariety = !first ? 0 : others.some(ids => [...first].some(a => [...ids].some(b => a !== b))) ? 2 : 1;
  return {commanderVariety, recordedTurns: Math.min(25, credits.reduce((sum, credit) => sum + credit.turns, 0)),
    playDates: Math.min(3, new Set(credits.map(credit => credit.playDate)).size)};
}

export function explorationCommissionProgress(mission) {
  return {startedAt: mission?.startedAt ?? null, timeZone: mission?.timeZone ?? null,
    earnedAt: mission?.earnedAt ?? null, ...objectiveCounts(mission)};
}

export function advanceExplorationCommission(mission, completion, key) {
  if (!mission || mission.earnedAt != null || mission.credits?.[key]
    || mission.ruleVersion !== 1 || mission.eligibilityVersion !== eligibility.version
    || completion.sessionKind !== 'standard' || completion.game?.gameFormat !== 'commander'
    || !timestamp(completion.startedAt) || completion.startedAt < mission.startedAt
    || !timestamp(completion.completedAt) || completion.completedAt < completion.startedAt) return mission;
  const evidence = completion.game.startingCommanderEvidence;
  if (evidence?.schemaVersion !== 1 || evidence.eligibilityVersion !== mission.eligibilityVersion
    || evidence.resolved !== true || !Array.isArray(evidence.cards) || evidence.cards.length < 1 || evidence.cards.length > 2
    || evidence.cards.some(card => typeof card?.identity !== 'string' || !card.identity)
    || new Set(evidence.cards.map(card => card.identity)).size !== evidence.cards.length) return mission;
  const eligibleIds = [...new Set(evidence.cards.filter(card => card.identity === 'oracle:' + card.oracleId
    && eligibleNames.get(card.oracleId)?.has(exactName(card.matchedName))).map(card => card.oracleId))];
  if (!eligibleIds.length) return mission;
  const parts = new Intl.DateTimeFormat('en-US', {timeZone: mission.timeZone, year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(completion.completedAt);
  const datePart = type => parts.find(part => part.type === type).value;
  const rawTurns = completion.game.achievementFacts?.turnCount;
  const credit = {completedAt: completion.completedAt, playDate: `${datePart('year')}-${datePart('month')}-${datePart('day')}`,
    turns: Number.isSafeInteger(rawTurns) && rawTurns >= 0 ? Math.min(25, rawTurns) : 0,
    lineup: JSON.stringify(evidence.cards.map(card => card.identity).sort()), eligibleIds};
  const next = {...mission, credits: {...mission.credits, [key]: credit}};
  const counts = objectiveCounts(next);
  if (counts.commanderVariety === 2 && counts.recordedTurns === 25 && counts.playDates === 3) {
    next.earnedAt = Math.max(...Object.values(next.credits).map(item => item.completedAt));
  }
  return next;
}
