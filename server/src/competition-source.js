import { createHash } from 'node:crypto';

const hash = bytes => Buffer.from(bytes || []).toString('base64');
function stableValue(value) {
  if (value == null) return undefined;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.length ? value.map(stableValue) : undefined;
  const entries = Object.keys(value).sort().map(key => [key, stableValue(value[key])]).filter(([, item]) => item !== undefined);
  return entries.length ? Object.fromEntries(entries) : undefined;
}
const canonical = value => JSON.stringify(stableValue(value) ?? null);
export const sourceDigest = source => createHash('sha256').update(canonical(source)).digest('hex');

// No names, deck details, free text, account identifiers or competition membership.
// This private receipt accompanies the existing once-per-completion archive write.
export function sourceFromRoom(room, starters, completedAt, sessionKind) {
  const original = room.gameResult;
  const originalOrder = original.finishingOrder;
  const inferredOrder = original.placementGroups?.map(group => group.map(String))
    || (Array.isArray(originalOrder) && originalOrder.length === starters.length ? originalOrder.map(id => [String(id)]) : null);
  return {
    schemaVersion: 1, gameId: room.gameId, tableIdentity: hash(room.hostRecoveryKeyHash),
    startedAt: room.turn.originalGameStartedAt ?? room.turn.gameStartedAt, completedAt,
    gameFormat: room.config.gameFormat, sessionKind,
    starters: starters.map(seat => ({ seatId: seat.seatId, ownerHash: hash(seat.tokenHash) })),
    originalOutcome: { kind: original.reason === 'timed_draw' ? 'timed_draw' : 'winner',
      winnerSeatId: Number.isInteger(original.winnerSeatId) ? original.winnerSeatId : null,
      reason: original.reason, finishingOrder: inferredOrder },
    inferredOrder,
  };
}

export function sourceArchive(source) {
  return { schemaVersion: 1, gameId: source.gameId, completedAt: source.completedAt,
    playerCount: source.starters.length, players: [], incomplete: false,
    _competitionSource: { digest: sourceDigest(source), source: structuredClone(source) } };
}
export function archivedSource(recap) {
  const receipt = recap?._competitionSource;
  if (!receipt) return null;
  if (sourceDigest(receipt.source) !== receipt.digest) throw new Error('Completion source digest is invalid.');
  const source = structuredClone(receipt.source);
  source.inferredOrder ??= null;
  source.originalOutcome = { winnerSeatId: null, finishingOrder: null, ...source.originalOutcome };
  return source;
}
export function assertSameSource(existing, incoming) {
  if (sourceDigest(existing) !== sourceDigest(incoming)) {
    throw Object.assign(new Error('Conflicting immutable completion source.'), { status: 409, code: 'SOURCE_CONFLICT' });
  }
}
export function publicLedgerValue(value) {
  if (Array.isArray(value)) return value.map(publicLedgerValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== '_competitionSource')
    .map(([key, item]) => [key, publicLedgerValue(item)]));
}
