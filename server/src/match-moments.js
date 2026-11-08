export function blankMatchMoment(startingLife) {
  return { startingLife, lifeGained: 0, lifeLostOnOwnTurn: 0, lowestLife: startingLife, lifeGainedAfterLow: 0, actionsAfterLow: 0, reclaimedDuringGame: false, actionsAfterReclaim: 0, turnsAfterReclaim: 0, playerCountAtStart: null, tableGameNumber: 1, usedLocalD20: false, poisonGained: 0, commanderDamageReceived: 0, commanderDamageBySource: {}, energyGained: 0, radiationGained: 0, turnCount: 0, totalTurnMs: 0, lifeLossByTurn: {}, largestLifeLossInTurn: 0, lifeAtLargestLossTurnStart: startingLife, lostHalfLifeInOneTurn: false, lostAllLifeInOneTurn: false };
}

export function recordMatchMoment(seat, { counter, delta, commanderSourceId, lifeBefore, lifeAfter, gameStarted, isOwnTurn = false, turnKey = null, isCorrection = false }) {
  if (!gameStarted || !seat.matchMoment) return;
  const m = seat.matchMoment;
  const priorLowest = m.lowestLife;
  if (m.lostAllLifeInOneTurn && !isCorrection && delta !== 0 && lifeBefore > 0) m.continuedAfterAllLifeLoss = true;
  if (counter === 'life') { if (delta > 0 && !isCorrection) m.lifeGained += delta; if (delta < 0 && isOwnTurn) m.lifeLostOnOwnTurn += -delta; m.lowestLife = Math.min(m.lowestLife, lifeAfter); }
  if (counter === 'commanderDamage') {
    if (delta > 0) {
      m.commanderDamageReceived += delta;
      // Older durable records did not retain the per-commander achievement map.
      // Rebuild it lazily so a valid damage entry cannot fail the game action.
      if (!m.commanderDamageBySource || typeof m.commanderDamageBySource !== 'object') m.commanderDamageBySource = {};
      if (commanderSourceId) m.commanderDamageBySource[commanderSourceId] = (m.commanderDamageBySource[commanderSourceId] || 0) + delta;
    }
    m.lowestLife = Math.min(m.lowestLife, lifeAfter);
  }
  const lifeLossDelta = counter === 'life' ? delta < 0 ? -delta : isCorrection ? -delta : 0 : counter === 'commanderDamage' ? delta : 0;
  if (lifeLossDelta && turnKey != null) {
    const key = String(turnKey); m.lifeLossByTurn ||= {};
    m.lifeLossByTurn[key] = Math.max(0, (m.lifeLossByTurn[key] || 0) + lifeLossDelta);
    const losses = Object.values(m.lifeLossByTurn);
    m.largestLifeLossInTurn = Math.max(0, ...losses);
    m.lifeAtLargestLossTurnStart = m.startingLife;
    m.lostHalfLifeInOneTurn = losses.some(loss => loss * 2 >= m.startingLife);
    m.lostAllLifeInOneTurn = losses.some(loss => loss >= m.startingLife);
  }
  if (counter === 'poison' && delta > 0) {
    m.poisonGained += delta;
    m.peakPoison = Math.max(m.peakPoison || 0, seat.counters?.poison || 0);
  }
  if (counter === 'energy' && delta > 0) m.energyGained += delta;
  if (counter === 'radiation' && delta > 0) m.radiationGained += delta;
  if (m.lowestLife < priorLowest) { m.lifeGainedAfterLow = 0; m.actionsAfterLow = 0; }
  else if (m.lowestLife <= 5 && !isCorrection && delta !== 0) { m.actionsAfterLow += 1; if (counter === 'life' && delta > 0) m.lifeGainedAfterLow += delta; }
  if (m.reclaimedDuringGame && !isCorrection && delta !== 0) m.actionsAfterReclaim += 1;
}

export function recordTurnMoment(seat, turnLengthMs) {
  if (!seat.matchMoment) return;
  seat.matchMoment.turnCount += 1;
  if (seat.matchMoment.reclaimedDuringGame) seat.matchMoment.turnsAfterReclaim += 1;
  seat.matchMoment.totalTurnMs += Math.max(0, turnLengthMs);
}

function named(seed, titles, line, fact, art = titles[0]) {
  const value = [...String(seed)].reduce((sum, character) => sum + character.codePointAt(0), 0);
  return { kind: 'accolade', id: accoladeId(titles[0]), category: titles[0], variant: value % titles.length, title: titles[value % titles.length], line, fact, art };
}

function accoladeId(value) { return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

function seededIndex(seed, length) {
  let value = 2166136261;
  for (const character of String(seed)) { value ^= character.codePointAt(0); value = Math.imul(value, 16777619); }
  return Math.abs(value >>> 0) % length;
}

function commanderName(sourceId, seats) {
  const match = /^seat-(\d+)-commander-([ab])$/.exec(sourceId || '');
  if (!match) return 'one commander';
  const owner = seats.find((item) => item.seatId === Number(match[1]));
  const slot = match[2] === 'a' ? 0 : 1;
  return owner?.commanderNames?.[slot] || owner?.name || 'one commander';
}

function distinctCommanderCount(item) {
  return Object.entries(item.matchMoment?.commanderDamageBySource || {})
    .filter(([source, damage]) => damage > 0 && !source.startsWith('seat-' + item.seatId + '-commander-')).length;
}

function fastestAverage(seat, seats, minimumTurns) {
  const candidates = seats.filter(item => item.claimed !== false && item.matchMoment?.turnCount >= minimumTurns);
  if (candidates.length < 2 || !candidates.includes(seat)) return null;
  const average = seat.matchMoment.totalTurnMs / seat.matchMoment.turnCount;
  return candidates.every(item => item === seat || item.matchMoment.totalTurnMs / item.matchMoment.turnCount > average)
    ? average : null;
}

function damageFromOpponent(damageBySource, seatId) {
  return (damageBySource?.['seat-' + seatId + '-commander-a'] || 0)
    + (damageBySource?.['seat-' + seatId + '-commander-b'] || 0);
}

function uniqueLeader(seat, seats, valueFor) {
  const values = seats.filter((item) => item.claimed !== false).map((item) => [item, valueFor(item)]);
  const high = Math.max(...values.map(([, value]) => value));
  return high > 0 && valueFor(seat) === high && values.filter(([, value]) => value === high).length === 1;
}

function royalThreshold(seat, seats) {
  const claimedNow = seats.filter((item) => item.claimed !== false).length;
  const playerCount = seat.matchMoment?.playerCountAtStart || claimedNow || seats.length;
  return 10 + (2 * Math.max(0, playerCount - 2));
}

function earnedMatchMoments({ seat, seats, winnerSeatId, context = {} }) {
  const m = seat.matchMoment || blankMatchMoment(seat.counters.life);
  const low = m.lowestLife < m.startingLife ? m.lowestLife : Infinity;
  const survivedPoison = m.peakPoison >= 9 && !context.eliminatedSeatIds?.includes(seat.seatId);
  const earned = []; const add = (titles, line, fact, art = titles[0]) => earned.push({ titles, line, fact, art });
  if (low <= 5 && m.lifeGainedAfterLow >= 15) add(['Phoenix Return', 'Ashes to Armor', 'Rise Again'], 'You recovered a major life total after reaching the brink.', `Lowest life: ${m.lowestLife} · +${m.lifeGainedAfterLow} recovered`, 'phoenix-return-refresh-v1');
  if (low <= 5 && m.actionsAfterLow >= 4) add(['One More Turn', 'Still Breathing', 'Back from the Brink'], 'You stayed active after the game nearly got away from you.', `Lowest life: ${m.lowestLife} · ${m.actionsAfterLow} actions after`, 'one-more-turn-refresh-v1');
  if (low === 1 && m.actionsAfterLow >= 1) add(['Refused to Die', 'One Is Plenty', 'Barely Breathing'], 'You hit 1 life and kept the game going.', 'Lowest recorded life: 1');
  if (low >= 2 && low <= 5 && m.lifeGainedAfterLow >= 10) add(['Comeback Kid', 'Second Wind', 'Not Today'], 'You climbed back after a close call.', `Lowest life: ${low} · +${m.lifeGainedAfterLow} recovered`);
  if (low >= 2 && low <= 5) add(['Hanging By a Thread', 'Too Close for Comfort', 'Five Alarm Fire'], 'You got dangerously close to the edge.', `Lowest recorded life: ${m.lowestLife}`);
  if (m.lifeGained >= 40) add(['Tidal Shift', 'Deep Reserves', 'Overflow Protocol'], 'You rebuilt far beyond your starting cushion.', `+${m.lifeGained} life gained`, 'tidal-shift-refresh-v1');
  if (m.lifeGained >= 25) add(['Second Serving', 'Feast of Life', 'Overflowing Cup'], 'You rebuilt a serious life cushion.', `+${m.lifeGained} life gained`, 'second-serving');
  if (m.reclaimedDuringGame && (m.turnsAfterReclaim >= 2 || m.actionsAfterReclaim >= 3)) add(['Back in the Fight', 'Signal Restored', 'Rejoined the Arc'], 'You recovered your seat and kept the game moving.', `${m.turnsAfterReclaim} turns · ${m.actionsAfterReclaim} actions after reclaim`, 'back-in-the-fight');
  const [largestCommanderSource, largestCommanderDamage = 0] = Object.entries(m.commanderDamageBySource || {}).reduce((largest, entry) => entry[1] > largest[1] ? entry : largest, ['', 0]);
  if (largestCommanderDamage >= 10) add(['Commander Magnet', 'Marked by Legends', 'A Familiar Foe'], 'One commander kept finding you.', `${largestCommanderDamage} from ${commanderName(largestCommanderSource, seats)}`);
  const distinctCommanders = distinctCommanderCount(seat);
  if (distinctCommanders >= 3 && uniqueLeader(seat, seats, distinctCommanderCount)) add(['Legend Collector', 'Gathered Legends', 'An Expanding Collection'], 'More opposing commanders found you than anyone else.', `${distinctCommanders} different commanders dealt damage`);
  const totalCommanderDamage = m.commanderDamageReceived;
  const threshold = royalThreshold(seat, seats);
  if (totalCommanderDamage >= threshold && uniqueLeader(seat, seats, (item) => item.matchMoment?.commanderDamageReceived || 0)) add(['Royal Reception', 'Grand Audience', 'All Eyes on You'], 'You took the table\'s heaviest commander attention.', `${totalCommanderDamage} commander damage · ${threshold} needed`);
  if (distinctCommanders >= 2) add(['Commander Crossfire', 'Under Many Banners', 'Two Fronts'], 'More than one opposing commander found you.', `${distinctCommanders} different commanders dealt damage`, 'commander-crossfire');
  if (m.lifeLostOnOwnTurn >= 8 && uniqueLeader(seat, seats, (item) => item.matchMoment?.lifeLostOnOwnTurn || 0)) add(['Paid in Blood', 'Life Is a Resource', 'High Stakes'], 'You recorded the most life lost during your own turns.', `${m.lifeLostOnOwnTurn} life lost on your turns`);
  if (m.lifeLostOnOwnTurn >= 12 && uniqueLeader(seat, seats, (item) => item.matchMoment?.lifeLostOnOwnTurn || 0)) add(['Held the Line', 'Bloodied but Standing', 'Scarred Survivor'], 'You absorbed a punishing personal cost and stayed in the fight.', `${m.lifeLostOnOwnTurn} life lost on your turns`, 'held-the-line-refresh-v1');
  if (survivedPoison) add(['Ninth Life', 'Poison Proof', 'Venom Defiant'], 'You survived a near-lethal poison count.', `Peak poison: ${m.peakPoison}`, 'ninth-life-refresh-v1');
  if (m.poisonGained >= 8) add(['Hazard Pay', 'Toxic Tenacity', 'Venom Tested'], 'You kept going under serious poison pressure.', `${m.poisonGained} poison received`, 'hazard-pay');
  if (m.poisonGained >= 5) add(['Poison Snack', 'Toxic Relationship', 'Venom Sommelier'], 'You collected a concerning amount of poison.', `${m.poisonGained} poison received`);
  if (m.lifeGained >= 10) add(['Health Potion Hoarder', 'Second Breakfast', 'Life Insurance'], 'You found your way back up.', `+${m.lifeGained} life gained`);
  if (m.energyGained >= 10) add(['Power Surge', 'Grid Runner', 'Energy Reserve'], 'You built a substantial energy reserve.', `+${m.energyGained} energy gained`, 'power-surge');
  if (m.energyGained >= 20) add(['Overflow Charge', 'Capacitor Crown', 'Live Wire'], 'You generated an extraordinary amount of energy.', `+${m.energyGained} energy gained`, 'overflow-charge-refresh-v1');
  if (m.energyGained >= 5) add(['Reactor Core', 'Battery Included', 'Fully Charged'], 'You kept the energy flowing.', `+${m.energyGained} energy gained`);
  if (m.radiationGained >= 10) add(['Hot Zone', 'Fallout Veteran', 'Bright Side'], 'You endured a heavy radiation count.', `${m.radiationGained} radiation received`, 'hot-zone');
  if (m.radiationGained >= 15) add(['Fallout March', 'Radiant Resolve', 'Atomic Composure'], 'You endured extreme radiation pressure.', `${m.radiationGained} radiation received`, 'fallout-march-refresh-v1');
  if (m.radiationGained >= 5) add(['Glowing Problem', 'Nuclear Option', 'Radiant Citizen'], 'You left the game a little brighter.', `+${m.radiationGained} radiation received`);
  if (m.poisonGained > 0 && m.energyGained > 0 && m.radiationGained > 0) add(['All Systems Lit', 'Threefold Hazard', 'Arc Saturation'], 'Every supported counter pressure found its way to you.', `${m.poisonGained} poison · +${m.energyGained} energy · ${m.radiationGained} radiation`, 'all-systems-lit-refresh-v1');
  if (distinctCommanders >= 3) add(['Commander Gauntlet', 'Many Banners', 'Crossfire Veteran'], 'Three or more opposing commanders found you.', `${distinctCommanders} different commanders dealt damage`, 'commander-gauntlet-refresh-v1');
  if (m.playerCountAtStart >= 4 && m.turnCount >= 4) add(['Table Anchor', 'Roundkeeper', 'Steady Presence'], 'You held your place through a deep multiplayer battle.', `${m.playerCountAtStart}-player table · ${m.turnCount} turns`, 'table-anchor-refresh-v1');
  if (m.turnCount >= 5) add(['Long Haul', 'Fifth Turn', 'Endurance Run'], 'You stayed in for a substantial share of the game.', `${m.turnCount} recorded turns`, 'long-haul-refresh-v1');
  if (m.playerCountAtStart >= 6 && m.turnCount >= 3) add(['Wide Table Veteran', 'Sixfold Stamina', 'Deep Pod'], 'You made your mark at a truly crowded table.', `${m.playerCountAtStart}-player table · ${m.turnCount} turns`, 'wide-table-veteran-refresh-v1');
  if (m.tableGameNumber === 3) add(['Table Trilogy', 'Third Time Around', 'Pod Regulars'], 'You completed another chapter at the same table.', `Game ${m.tableGameNumber} at this table`, 'table-trilogy');
  const average = fastestAverage(seat, seats, 2);
  if (average !== null) {
    add(['Speedrunner', 'Lightning Round', 'No Notes'], 'You had the fastest average recorded turn.', `Average turn: ${Math.round(average / 1000)} sec`);
  }
  if (seat.seatId === winnerSeatId && context.finishReason === 'last_player_standing') add(['Last One Standing', 'Table Monarch', 'Arc Victor'], 'You were the final remaining player.', 'Last player standing');
  if (seat.seatId === winnerSeatId && context.finishReason === 'declared_winner') add(['Table Victor'], 'Your table recorded the win.', 'Declared winner', null);
  // Expansion catalog: each condition is deliberately stricter or mixed so it
  // adds a new moment instead of duplicating an existing accolade.
  if (m.lostHalfLifeInOneTurn) add(['Turning Point'], 'One brutal turn changed the whole game.', `Lost ${m.largestLifeLossInTurn} life in one turn`, 'arc-turning-point-v1');
  if (m.lostAllLifeInOneTurn && m.continuedAfterAllLifeLoss) add(['Clean Slate'], 'You rebuilt after a complete collapse.', 'All starting life lost in one turn', 'arc-clean-slate-v1');
  if (low <= 5 && m.lifeGainedAfterLow >= 15 && m.actionsAfterLow >= 4) add(['Lasting Spark'], 'You recovered from the brink and kept moving.', `Lowest life: ${m.lowestLife} · +${m.lifeGainedAfterLow} · ${m.actionsAfterLow} actions`, 'arc-lasting-spark-v1');
  if (m.lifeLostOnOwnTurn >= 12 && m.lifeGained >= 8) add(['Blood Price'], 'You paid dearly and still rebuilt.', `${m.lifeLostOnOwnTurn} life paid · +${m.lifeGained} regained`, 'arc-blood-price-v1');
  if (m.reclaimedDuringGame && m.turnsAfterReclaim >= 2 && m.actionsAfterReclaim >= 3) add(['Signal Kept'], 'You reclaimed your seat and held the signal.', `${m.turnsAfterReclaim} turns · ${m.actionsAfterReclaim} actions after reclaim`, 'arc-signal-kept-v1');
  if (largestCommanderDamage >= 15) add(['Marked Trail'], 'One commander left a lasting mark.', `${largestCommanderDamage} from one commander`, 'arc-marked-trail-v1');
  if (distinctCommanders >= 4) add(['Many Banners'], 'Pressure came from every banner.', `${distinctCommanders} commanders dealt damage`, 'arc-many-banners-v1');
  const opponents = seats.filter(item => item.claimed !== false && item.seatId !== seat.seatId);
  if (m.playerCountAtStart >= 4 && opponents.length >= 3 && opponents.every(item => damageFromOpponent(m.commanderDamageBySource, item.seatId) >= 10)) add(['Full Court'], 'Every opponent dealt you commander damage.', `10+ commander damage from each of ${opponents.length} opponents`, 'arc-full-court-v1');
  if (totalCommanderDamage >= threshold + 8 && uniqueLeader(seat, seats, item => item.matchMoment?.commanderDamageReceived || 0)) add(['Royal Gauntlet'], 'You withstood the table’s heaviest pressure.', `${totalCommanderDamage} commander damage`, 'arc-royal-gauntlet-v1');
  if (survivedPoison && m.lifeGained >= 10) add(['Poison Proof'], 'You endured poison and rebuilt.', `Peak poison: ${m.peakPoison} · +${m.lifeGained} life`, 'arc-poison-proof-v1');
  if (m.energyGained >= 10 && m.radiationGained >= 10) add(['Charged and Glowing'], 'Energy and radiation both surged.', `+${m.energyGained} energy · ${m.radiationGained} radiation`, 'arc-charged-and-glowing-v1');
  if (m.poisonGained >= 3 && m.energyGained >= 5 && m.radiationGained >= 5) add(['Hazard Triad'], 'All three hazards reached meaningful levels.', `${m.poisonGained} poison · +${m.energyGained} energy · ${m.radiationGained} radiation`, 'arc-hazard-triad-v1');
  if (m.energyGained >= 30) add(['Living Capacitor'], 'You stored an extraordinary charge.', `+${m.energyGained} energy`, 'arc-living-capacitor-v1');
  if (m.radiationGained >= 15 && m.lifeGained >= 10) add(['Fallout Shelter'], 'You survived the fallout and recovered.', `${m.radiationGained} radiation · +${m.lifeGained} life`, 'arc-fallout-shelter-v1');
  if (m.turnCount >= 7) add(['Long Vigil'], 'You stayed through a very long watch.', `${m.turnCount} recorded turns`, 'arc-long-vigil-v1');
  if (m.playerCountAtStart >= 6 && m.turnCount >= 4) add(['Deep Pod'], 'You held steady in a crowded pod.', `${m.playerCountAtStart} players · ${m.turnCount} turns`, 'arc-deep-pod-v1');
  const quickAverage = fastestAverage(seat, seats, 3);
  if (quickAverage !== null && quickAverage <= 60_000) add(['Quick Study'], 'Your quick turns set the pace.', `Average turn: ${Math.round(m.totalTurnMs / m.turnCount / 1000)} sec`, 'arc-quick-study-v1');
  if (m.turnCount >= 4 && m.totalTurnMs / m.turnCount <= 90_000) add(['Steady Hands'], 'Your turns stayed quick and controlled.', `Average turn: ${Math.round(m.totalTurnMs / m.turnCount / 1000)} sec`, 'arc-steady-hands-v1');
  if (m.usedLocalD20) add(['Opening Ceremony'], 'The table began with a local roll.', 'Local D20 start', 'arc-opening-ceremony-v1');
  if (m.tableGameNumber === 5) add(['Familiar Seats'], 'This table had become familiar ground.', `Game ${m.tableGameNumber} at this table`, 'arc-familiar-seats-v1');
  if (context.durationMs > 3_600_000) add(['Late Chapter'], 'This game became a long chapter.', `${Math.round(context.durationMs / 60000)} minutes`, 'arc-late-chapter-v1');
  if (seat.seatId === winnerSeatId && low <= 5) add(['Arc Victor'], 'You won after fighting from the brink.', `Lowest life: ${m.lowestLife}`, 'arc-arc-victor-v2');
  if (context.everyStarterTwoTurns && m.playerCountAtStart >= 4) add(['Table Tale'], 'Every starter had time to make a story.', `${m.playerCountAtStart}-player complete game`, 'arc-table-tale-v2');
  if (low <= 2 && m.lifeGainedAfterLow >= 25) add(['Second Wind'], 'You found a second wind at the edge.', `Lowest life: ${m.lowestLife} · +${m.lifeGainedAfterLow} recovered`, 'arc-second-wind-v2');
  return earned;
}

export const RECENT_ACCOLADE_LIMIT = 5;

const COMPLETION_TITLES = {
  complete: 'Arc Complete', company: 'Pod Company', order: 'Turn Order', chronicle: 'Table Chronicle',
  format: 'Format Finish', life: 'Starting Line', clock: 'Clock Record', result: 'Result Recorded',
  finish: 'Finish Call', turn: 'Turn Logged', place: 'Place Recorded', closing: 'Closing Total',
};
const COMPLETION_IDS = new Set(Object.values(COMPLETION_TITLES).map(accoladeId));
const ROUTINE_MOMENTS = new Set([
  'last-one-standing', 'table-victor', 'table-anchor', 'long-haul', 'wide-table-veteran', 'table-tale',
  'opening-ceremony', 'poison-snack', 'health-potion-hoarder', 'reactor-core', 'glowing-problem', 'all-systems-lit',
]);
const SIGNATURE_MOMENTS = new Set([
  'clean-slate', 'phoenix-return', 'comeback-kid', 'lasting-spark', 'second-wind', 'arc-victor',
  'signal-kept', 'full-court', 'royal-gauntlet', 'legend-collector', 'many-banners', 'marked-trail',
  'poison-proof', 'hazard-triad', 'charged-and-glowing', 'fallout-shelter', 'living-capacitor', 'quick-study',
]);
const FAMILIES = [
  ['second-wind', 'lasting-spark', 'arc-victor', 'clean-slate', 'phoenix-return', 'comeback-kid', 'one-more-turn', 'refused-to-die', 'hanging-by-a-thread'],
  ['tidal-shift', 'second-serving', 'health-potion-hoarder'],
  ['turning-point', 'paid-in-blood', 'held-the-line', 'blood-price'],
  ['back-in-the-fight', 'signal-kept'],
  ['full-court', 'royal-gauntlet', 'royal-reception', 'legend-collector', 'many-banners', 'marked-trail', 'commander-magnet', 'commander-crossfire', 'commander-gauntlet'],
  ['poison-proof', 'ninth-life', 'hazard-pay', 'poison-snack'],
  ['living-capacitor', 'overflow-charge', 'power-surge', 'reactor-core'],
  ['fallout-shelter', 'fallout-march', 'hot-zone', 'glowing-problem'],
  ['hazard-triad', 'charged-and-glowing', 'all-systems-lit'],
  ['long-vigil', 'deep-pod', 'long-haul', 'table-anchor', 'wide-table-veteran'],
  ['quick-study', 'speedrunner', 'steady-hands'],
];
const familyById = new Map(FAMILIES.flatMap(group => group.map((id, rank) => [id, { family: group[0], rank }])));
const momentFamily = id => familyById.get(id)?.family || id;

function momentLevel(id) {
  if (COMPLETION_IDS.has(id)) return 0;
  if (ROUTINE_MOMENTS.has(id)) return 1;
  return SIGNATURE_MOMENTS.has(id) ? 3 : 2;
}

function recentIndex(id, recentIds) {
  return recentIds.findIndex(value => {
    if (!value) return false;
    const recent = accoladeId(value);
    return momentFamily(recent) === momentFamily(id) && momentLevel(recent) >= momentLevel(id);
  });
}

function strongestByFamily(options) {
  const selected = new Map();
  for (const option of options) {
    const family = momentFamily(option.id);
    const previous = selected.get(family);
    if (!previous || momentLevel(option.id) > momentLevel(previous.id)
      || (momentLevel(option.id) === momentLevel(previous.id) && familyById.get(option.id)?.rank < familyById.get(previous.id)?.rank)) {
      selected.set(family, option);
    }
  }
  return [...selected.values()];
}

export function chooseMatchMoment(moments = [], recentIds = []) {
  const cards = moments.filter(moment => moment?.id);
  const fresh = cards.find(moment => recentIndex(moment.id, recentIds) < 0);
  if (fresh) return fresh;
  let leastRecent = null;
  let oldestIndex = -1;
  for (const moment of cards) {
    const index = recentIndex(moment.id, recentIds);
    if (index > oldestIndex) { leastRecent = moment; oldestIndex = index; }
  }
  return leastRecent;
}

function completionChoices(seat, seats, winnerSeatId, context) {
  const position = seats.indexOf(seat) + 1;
  const seatLabel = 'Seat ' + (seat.seatId + 1);
  const m = seat.matchMoment;
  const options = [];
  const add = (name, line, fact, art = null) => {
    options.push({ titles: [COMPLETION_TITLES[name]], line, fact, art, completion: true });
  };
  add('complete', 'You finished this game at the table.', seatLabel + ' · Game finished', 'arc-complete');
  if (seats.length > 1) add('company', 'You shared a table with other players.', seats.length + '-player game · ' + seatLabel);
  const starter = seats.findIndex(item => item.seatId === context.startingSeatId);
  if (starter >= 0) {
    const order = (position - 1 - starter + seats.length) % seats.length + 1;
    add('order', 'Your place in the opening rotation.', 'Position ' + order + ' of ' + seats.length + ' in the opening order');
  }
  if (m?.tableGameNumber > 0) add('chronicle', 'This result adds a chapter at your table.', 'Completed game ' + m.tableGameNumber + ' for this seat');
  const format = { commander: 'Commander', casual: 'Casual', custom: 'Custom' }[context.gameFormat];
  if (format) add('format', 'You completed a game in this format.', format + ' · ' + seatLabel);
  if (Number.isFinite(m?.startingLife)) add('life', 'You finished a game using this starting life.', 'Table started at ' + m.startingLife + ' life · ' + seatLabel);
  if (Number.isFinite(context.durationMs)) {
    const minutes = Math.floor(context.durationMs / 60_000);
    add('clock', 'Your table recorded its playing time.', (minutes ? minutes + ' min recorded' : 'Less than 1 min recorded') + ' · ' + seatLabel);
  }
  if (seats.some(item => item.seatId === winnerSeatId)) {
    const result = seat.seatId === winnerSeatId ? 'Win recorded' : 'Participating seat';
    add('result', 'Your seat was included in the finished result.', result + ' · ' + seatLabel);
  }
  if (context.finishReason === 'declared_winner' || context.finishReason === 'last_player_standing') {
    const reason = context.finishReason === 'declared_winner' ? 'Winner declared' : 'Last player standing';
    add('finish', 'The table recorded how this game ended.', reason + ' · ' + seatLabel);
  }
  if (Number.isFinite(seat.counters?.life)) add('closing', 'Your seat’s life total was recorded at the finish.', seat.counters.life + ' life at the finish · ' + seatLabel);
  if (m?.turnCount > 0) add('turn', 'You logged play through the turn tracker.', m.turnCount + (m.turnCount === 1 ? ' recorded turn' : ' recorded turns'));
  const place = (context.finishingOrder?.indexOf(seat.seatId) ?? -1) + 1;
  if (place > 0) add('place', 'Your finish is recorded in the table order.', 'Place ' + place + ' of ' + seats.length);
  return options;
}

function rankOptions(options, recent, seed) {
  const ranked = strongestByFamily(options.map(option => {
    const id = accoladeId(option.titles[0]);
    return { ...option, id, recentAt: recentIndex(id, recent), tiebreak: seededIndex(seed + ':' + id, 0x100000000) };
  }));
  return ranked.sort((a, b) => {
    if ((a.recentAt < 0) !== (b.recentAt < 0)) return Number(a.recentAt >= 0) - Number(b.recentAt >= 0);
    return b.recentAt - a.recentAt || momentLevel(b.id) - momentLevel(a.id) || a.tiebreak - b.tiebreak;
  });
}

export function tableMatchMomentDecisions({ seats, winnerSeatId, seed, recentCategoriesBySeat = {}, recentAccoladeIdsBySeat = {}, context = {} }) {
  const starters = seats.filter(seat => seat.claimed !== false);
  const entries = starters.map(seat => {
    const matched = earnedMatchMoments({ seat, seats: starters, winnerSeatId, context });
    const finish = completionChoices(seat, starters, winnerSeatId, context);
    const recent = [...(recentAccoladeIdsBySeat[seat.seatId] || []), ...(recentCategoriesBySeat[seat.seatId] || [])];
    const seatSeed = String(seed) + ':' + seat.seatId;
    return { seat, matched, finish, options: rankOptions([...matched, ...finish], recent, seatSeed), order: seededIndex(seatSeed, 0x100000000) };
  }).sort((a, b) => momentLevel(b.options[0].id) - momentLevel(a.options[0].id) || a.order - b.order);

  // Each reserved family belongs to one seat. A profile can pick a fresh
  // alternate within its own reservation without duplicating another seat.
  const owners = new Map();
  const matchedSeats = new Set();
  function reserve(entry, freshOnly, visited = new Set()) {
    // These milestones may be filtered later by the account's own table count.
    const options = entry.options.filter(option => option.id !== 'table-trilogy' && option.id !== 'familiar-seats'
      && (!freshOnly || option.recentAt < 0));
    for (const option of options) {
      const family = momentFamily(option.id);
      if (visited.has(family) || owners.has(family)) continue;
      owners.set(family, entry);
      matchedSeats.add(entry);
      return true;
    }
    for (const option of options) {
      const family = momentFamily(option.id);
      if (visited.has(family)) continue;
      visited.add(family);
      const other = owners.get(family);
      if (other && reserve(other, freshOnly, visited)) {
        owners.set(family, entry);
        matchedSeats.add(entry);
        return true;
      }
    }
    return false;
  }

  for (const entry of entries) reserve(entry, true);
  for (const entry of entries) if (!matchedSeats.has(entry)) reserve(entry, false);

  // Spread unclaimed alternatives across the eligible seats.
  let added;
  do {
    added = false;
    for (const entry of entries) {
      const extra = entry.options.find(option => !owners.has(momentFamily(option.id)));
      if (!extra) continue;
      owners.set(momentFamily(extra.id), entry);
      added = true;
    }
  } while (added);

  const titleIds = new Map();
  for (const entry of entries) {
    for (const option of entry.options) {
      if (owners.get(momentFamily(option.id)) !== entry) continue;
      for (const title of option.titles) {
        if (!titleIds.has(title)) titleIds.set(title, option.id);
        else if (titleIds.get(title) !== option.id) titleIds.set(title, null);
      }
    }
  }

  return new Map(entries.map(entry => {
    const { seat, matched, finish, options } = entry;
    const owned = options.filter(option => owners.get(momentFamily(option.id)) === entry);
    const chosen = owned[0] || { ...finish[0], id: accoladeId(finish[0].titles[0]) };
    const toMoment = option => {
      // An alternate title can also be another accolade's canonical name.
      const titles = option.titles.filter((title, index) => index === 0 || titleIds.get(title) === option.id);
      const moment = named(String(seed) + ':' + seat.seatId + ':' + option.id, titles, option.line, option.fact, option.art);
      return option.completion ? { ...moment, completion: true } : moment;
    };
    const alternatives = owned.slice(1).map(toMoment);
    const selectionReason = chosen.completion ? 'Recorded completion fact'
      : momentLevel(chosen.id) === 3 ? 'Specific standout recorded' : 'Distinct match moment recorded';
    return [seat.seatId, {
      moment: toMoment(chosen), alternatives, eligibleCategories: matched.map(option => option.titles[0]), selectionReason,
    }];
  }));
}

export function tableMatchMoments(input) { return new Map([...tableMatchMomentDecisions(input)].map(([seatId, decision]) => [seatId, decision.moment])); }

export function personalMatchMoment({ seat, seats, winnerSeatId, seed, recentAccoladeIds = [] }) { return tableMatchMoments({ seats, winnerSeatId, seed, recentAccoladeIdsBySeat: { [seat.seatId]: recentAccoladeIds } }).get(seat.seatId); }
