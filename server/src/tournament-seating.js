import { createHash } from 'node:crypto';
import { competitionError } from './competitions.js';
export const SEATING_RULE_VERSION = 'seeded-swap-v1';

export function balancedTableSizes(count, preferredSize = 4) {
  if (!Number.isInteger(count) || count < 2 || count > 128) throw competitionError('Seat two to 128 entrants per event.');
  if (!Number.isInteger(preferredSize) || preferredSize < 2 || preferredSize > 8) throw competitionError('Choose a preferred Table size from 2 to 8.');
  const tableCount = Math.min(Math.ceil(count / preferredSize), Math.floor(count / 2));
  const base = Math.floor(count / tableCount);
  return Array.from({ length: tableCount }, (_, index) => base + (index < count % tableCount ? 1 : 0));
}
export function validateSeating(tables, participantIds) {
  if (!Array.isArray(tables) || !tables.length || new Set(participantIds).size !== participantIds.length) throw competitionError('Choose a valid entrant roster.');
  const seen = new Set();
  for (const table of tables) {
    if (!Array.isArray(table) || table.length < 2 || table.length > 8) throw competitionError('Each Table needs two to eight (2–8) entrants.');
    for (const id of table) {
      if (seen.has(id)) throw competitionError('Duplicate entrant in seating.');
      if (!participantIds.includes(id)) throw competitionError('Unknown entrant in seating.');
      seen.add(id);
    }
  }
  if (seen.size !== participantIds.length) throw competitionError('Seat every attending entrant exactly once.');
}
const pairKey = (a, b) => [a, b].sort().join(':');
function meetings(previousTables) {
  const counts = new Map();
  for (const table of previousTables) for (let i = 0; i < table.length; i++) for (let j = i + 1; j < table.length; j++) {
    const key = pairKey(table[i], table[j]); counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}
function costs(tables, scores, counts) {
  let repeatPairs = 0, repeatMeetings = 0, standingSpread = 0;
  for (const table of tables) for (let i = 0; i < table.length; i++) for (let j = i + 1; j < table.length; j++) {
    const count = counts.get(pairKey(table[i], table[j])) || 0;
    repeatPairs += count ? 1 : 0; repeatMeetings += count;
    standingSpread += Math.abs((scores.get(table[i]) || 0) - (scores.get(table[j]) || 0));
  }
  return { repeatPairs, repeatMeetings, standingSpread };
}
export function seatingCost(tables, participants, previousTables = []) {
  return costs(tables, new Map(participants.map(row => [row.id, row.pointsUnits])), meetings(previousTables));
}
function seededRandom(seed) {
  let state = createHash('sha256').update(String(seed)).digest().readUInt32LE(0);
  return () => {
    state += 0x6D2B79F5;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
const shuffle = (ids, random) => {
  const result = [...ids];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};
const partition = (ids, sizes) => {
  let offset = 0; return sizes.map(size => { const group = ids.slice(offset, offset + size); offset += size; return group; });
};
const better = (a, b, priority) => {
  const keys = priority === 'standings' ? ['standingSpread', 'repeatPairs', 'repeatMeetings'] : ['repeatPairs', 'repeatMeetings', 'standingSpread'];
  for (const key of keys) if (a[key] !== b[key]) return a[key] < b[key];
  return false;
};

// A bounded seeded search, not a claim of globally optimal pairings. Every
// suggestion is saved and remains editable before the host starts a round.
export function suggestSeating({ participants, previousTables = [], preferredSize = 4,
  roundNumber = 1, seed, priority = 'new_opponents' }) {
  const ids = participants.map(row => row.id).sort();
  if (!['new_opponents', 'standings'].includes(priority) || !seed || new Set(ids).size !== ids.length) throw competitionError('Invalid seating inputs.');
  const sizes = balancedTableSizes(ids.length, preferredSize); const random = seededRandom(seed);
  if (roundNumber === 1) return partition(shuffle(ids, random), sizes);
  const counts = meetings(previousTables); const scores = new Map(participants.map(row => [row.id, row.pointsUnits]));
  let best = partition([...ids].sort((a, b) => (scores.get(b) || 0) - (scores.get(a) || 0) || a.localeCompare(b)), sizes);
  let bestCost = costs(best, scores, counts);
  for (let attempt = 0; attempt < (ids.length > 32 ? 12 : 24); attempt++) {
    const candidate = attempt === 0 ? structuredClone(best) : partition(shuffle(ids, random), sizes);
    let cost = costs(candidate, scores, counts);
    for (let step = 0; step < Math.min(1000, ids.length ** 2 * 4); step++) {
      if (candidate.length === 1) break;
      const a = Math.floor(random() * candidate.length), b = Math.floor(random() * candidate.length);
      if (a === b) continue;
      const i = Math.floor(random() * candidate[a].length), j = Math.floor(random() * candidate[b].length);
      [candidate[a][i], candidate[b][j]] = [candidate[b][j], candidate[a][i]];
      const next = costs(candidate, scores, counts);
      if (better(next, cost, priority)) cost = next;
      else [candidate[a][i], candidate[b][j]] = [candidate[b][j], candidate[a][i]];
    }
    if (better(cost, bestCost, priority)) { best = candidate; bestCost = cost; }
  }
  validateSeating(best, ids);
  return best;
}
