export function blankMatchMoment(startingLife) {
  return { lifeGained: 0, lifeLostOnOwnTurn: 0, lowestLife: startingLife, playerCountAtStart: null, poisonGained: 0, commanderDamageReceived: 0, commanderDamageBySource: {}, energyGained: 0, radiationGained: 0, turnCount: 0, totalTurnMs: 0 };
}

export function recordMatchMoment(seat, { counter, delta, commanderSourceId, lifeAfter, gameStarted, isOwnTurn = false }) {
  if (!gameStarted || !seat.matchMoment) return;
  const m = seat.matchMoment;
  if (counter === 'life') { if (delta > 0) m.lifeGained += delta; if (delta < 0 && isOwnTurn) m.lifeLostOnOwnTurn += -delta; m.lowestLife = Math.min(m.lowestLife, lifeAfter); }
  if (counter === 'commanderDamage') {
    if (delta > 0) {
      m.commanderDamageReceived += delta;
      if (commanderSourceId) m.commanderDamageBySource[commanderSourceId] = (m.commanderDamageBySource[commanderSourceId] || 0) + delta;
    }
    m.lowestLife = Math.min(m.lowestLife, lifeAfter);
  }
  if (counter === 'poison' && delta > 0) m.poisonGained += delta;
  if (counter === 'energy' && delta > 0) m.energyGained += delta;
  if (counter === 'radiation' && delta > 0) m.radiationGained += delta;
}

export function recordTurnMoment(seat, turnLengthMs) {
  if (!seat.matchMoment) return;
  seat.matchMoment.turnCount += 1;
  seat.matchMoment.totalTurnMs += Math.max(0, turnLengthMs);
}

function named(seed, titles, line, fact) {
  const value = [...String(seed)].reduce((sum, character) => sum + character.codePointAt(0), 0);
  return { category: titles[0], variant: value % titles.length, title: titles[value % titles.length], line, fact };
}

function commanderName(sourceId, seats) {
  const match = /^seat-(\d+)-commander-([ab])$/.exec(sourceId || '');
  if (!match) return 'one commander';
  const owner = seats.find((item) => item.seatId === Number(match[1]));
  const slot = match[2] === 'a' ? 0 : 1;
  return owner?.commanderNames?.[slot] || owner?.name || 'one commander';
}

function distinctCommanderCount(item) {
  return Object.values(item.matchMoment?.commanderDamageBySource || {}).filter((damage) => damage > 0).length;
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

function earnedMatchMoments({ seat, seats, winnerSeatId }) {
  const m = seat.matchMoment || blankMatchMoment(seat.counters.life);
  const earned = []; const add = (titles, line, fact) => earned.push({ titles, line, fact });
  if (seat.seatId === winnerSeatId) add(['Last One Standing', 'Table Monarch', 'Arc Victor'], 'The table ran out of answers.', 'Winner');
  if (m.lowestLife === 1) add(['Refused to Die', 'One Is Plenty', 'Barely Breathing'], 'You hit 1 life and kept the game going.', 'Lowest recorded life: 1');
  if (m.lowestLife >= 2 && m.lowestLife <= 5 && m.lifeGained >= 10) add(['Comeback Kid', 'Second Wind', 'Not Today'], 'You climbed back after a close call.', `Lowest life: ${m.lowestLife} · +${m.lifeGained} life gained`);
  if (m.lowestLife >= 2 && m.lowestLife <= 5) add(['Hanging By a Thread', 'Too Close for Comfort', 'Five Alarm Fire'], 'You got dangerously close to the edge.', `Lowest recorded life: ${m.lowestLife}`);
  const [largestCommanderSource, largestCommanderDamage = 0] = Object.entries(m.commanderDamageBySource || {}).reduce((largest, entry) => entry[1] > largest[1] ? entry : largest, ['', 0]);
  if (largestCommanderDamage >= 10) add(['Commander Magnet', 'Marked by Legends', 'A Familiar Foe'], 'One commander kept finding you.', `${largestCommanderDamage} from ${commanderName(largestCommanderSource, seats)}`);
  const distinctCommanders = distinctCommanderCount(seat);
  if (distinctCommanders >= 3 && uniqueLeader(seat, seats, distinctCommanderCount)) add(['Legend Collector', 'Gathered Legends', 'An Expanding Collection'], 'More opposing commanders found you than anyone else.', `${distinctCommanders} different commanders dealt damage`);
  const totalCommanderDamage = m.commanderDamageReceived;
  const threshold = royalThreshold(seat, seats);
  if (totalCommanderDamage >= threshold && uniqueLeader(seat, seats, (item) => item.matchMoment?.commanderDamageReceived || 0)) add(['Royal Reception', 'Grand Audience', 'All Eyes on You'], 'You took the table\'s heaviest commander attention.', `${totalCommanderDamage} commander damage · ${threshold} needed`);
  if (m.lifeLostOnOwnTurn >= 8 && uniqueLeader(seat, seats, (item) => item.matchMoment?.lifeLostOnOwnTurn || 0)) add(['Paid in Blood', 'Life Is a Resource', 'High Stakes'], 'You recorded the most life lost during your own turns.', `${m.lifeLostOnOwnTurn} life lost on your turns`);
  if (m.poisonGained >= 5) add(['Poison Snack', 'Toxic Relationship', 'Venom Sommelier'], 'You collected a concerning amount of poison.', `${m.poisonGained} poison received`);
  if (m.lifeGained >= 10) add(['Health Potion Hoarder', 'Second Breakfast', 'Life Insurance'], 'You found your way back up.', `+${m.lifeGained} life gained`);
  if (m.energyGained >= 5) add(['Reactor Core', 'Battery Included', 'Fully Charged'], 'You kept the energy flowing.', `+${m.energyGained} energy gained`);
  if (m.radiationGained >= 5) add(['Glowing Problem', 'Nuclear Option', 'Radiant Citizen'], 'You left the game a little brighter.', `+${m.radiationGained} radiation received`);
  const eligible = seats.filter(item => item.matchMoment?.turnCount >= 2);
  const average = m.turnCount ? m.totalTurnMs / m.turnCount : Infinity;
  const fastest = eligible.length ? Math.min(...eligible.map(item => item.matchMoment.totalTurnMs / item.matchMoment.turnCount)) : Infinity;
  if (eligible.length >= 2 && average === fastest && eligible.filter(item => item.matchMoment.totalTurnMs / item.matchMoment.turnCount === fastest).length === 1) {
    add(['Speedrunner', 'Lightning Round', 'No Notes'], 'You had the fastest average recorded turn.', `Average turn: ${Math.round(average / 1000)} sec`);
  }
  return earned.length ? earned : [{ titles: ['Arc Complete', 'Table Tale', 'Pod Veteran'], line: 'Another table, another tale.', fact: 'Match complete' }];
}

export function tableMatchMomentDecisions({ seats, winnerSeatId, seed }) {
  const candidates = seats.filter((seat) => seat.claimed !== false).map((seat) => ({ seat, moments: earnedMatchMoments({ seat, seats, winnerSeatId }) }));
  const used = new Set(); const selected = new Map();
  for (const item of [...candidates].sort((a, b) => a.moments.length - b.moments.length || a.seat.seatId - b.seat.seatId)) {
    const firstEligible = item.moments[0]; const selectedOption = item.moments.find((option) => !used.has(option.titles[0])) || firstEligible;
    used.add(selectedOption.titles[0]);
    selected.set(item.seat.seatId, { moment: named(`${seed}:${item.seat.seatId}:${selectedOption.titles[0]}`, selectedOption.titles, selectedOption.line, selectedOption.fact), eligibleCategories: item.moments.map((option) => option.titles[0]), selectionReason: selectedOption === firstEligible ? "Highest-priority eligible accolade" : "Next eligible accolade chosen to avoid duplicating a table category" });
  }
  return selected;
}

export function tableMatchMoments(input) { return new Map([...tableMatchMomentDecisions(input)].map(([seatId, decision]) => [seatId, decision.moment])); }

export function personalMatchMoment({ seat, seats, winnerSeatId, seed }) { return tableMatchMoments({ seats, winnerSeatId, seed }).get(seat.seatId); }
