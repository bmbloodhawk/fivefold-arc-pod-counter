import { competitionError, competitionId } from './competition-values.js';
import { coordinateCompetitionWrites } from './competition-write-coordinator.js';
import { controlReference, controlValueDigest, sameControlReference } from './competition-control-authorization.js';

const path = key => `competitions-v2/table-claims/${key}.json`;
const legacyPath = key => `competitions/directory/tables/${key}.json`;
const conflict = () => competitionError('The stored Table claim is inconsistent.', 503, 'TABLE_STORAGE_CONFLICT');
const linked = () => competitionError('This Table already belongs to another competition.', 409, 'TABLE_ALREADY_LINKED');
const pending = () => competitionError('The host must finish linking this Table.', 409, 'TABLE_SETUP_PENDING');
const closed = () => competitionError('Account data was removed.', 403, 'IDENTITY_CLOSED');
const same = (a, b) => a.kind === b.kind && a.id === b.id && a.roomCode === b.roomCode;
const ready = row => row && (!row.state || row.state === 'ready');
const reauthorize = Symbol('reauthorize Table reservation');
function nextGeneration(row) {
  const previous = row?.generation || 0;
  if (!Number.isSafeInteger(previous) || previous < 0 || previous >= Number.MAX_SAFE_INTEGER) throw conflict();
  return previous + 1;
}
function operationId(id) {
  competitionId(id);
  if (!id.startsWith('claim_')) throw competitionError('Invalid Table claim operation.');
  return id;
}
function tableKey(key) {
  if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) throw competitionError('Invalid Table identity.');
  return key;
}
function target(value) {
  if (!value || !['pod', 'tournament'].includes(value.kind)) throw competitionError('Unknown competition kind.');
  competitionId(value.id);
  if (!value.id.startsWith(value.kind === 'pod' ? 'pod_' : 'event_') || typeof value.roomCode !== 'string' || !/^[A-Z0-9]{6}$/.test(value.roomCode)) {
    throw competitionError('Invalid Table claim.');
  }
  return { kind: value.kind, id: value.id, roomCode: value.roomCode };
}
function stored(value, native = false) {
  if (value == null) return null;
  try {
    if (native && (value.schemaVersion !== 2 || (value.state && !['pending', 'ready', 'cancelled'].includes(value.state)))) throw conflict();
    if (native && value.generation !== undefined && (!Number.isSafeInteger(value.generation) || value.generation < 0)) throw conflict();
    return target(value);
  } catch { throw conflict(); }
}
export { tableKey as tableClaimKey, target as tableClaimTarget };

// Setup only. This per-Table claim is distinct from application-node ownership.
// Unaware legacy writers must be retired/fenced before activating these writes.
export class CompetitionTableClaims {
  constructor({ store } = {}) {
    if (!store?.read || !store?.update) throw new TypeError('Table claims require conditional storage.');
    this.store = coordinateCompetitionWrites(store);
  }

  async read(key, { includePending = true } = {}) {
    tableKey(key);
    const [current, previous] = await Promise.all([this.store.read(path(key)), this.store.read(legacyPath(key))]);
    const claim = stored(current, true), legacy = stored(previous);
    if (claim && current.state !== 'cancelled' && legacy && !same(claim, legacy)) throw conflict();
    // A pending pointer routes seat setup to the group, whose Table entry is not
    // published until authorization commits. It is not permission to start play.
    return (current?.state === 'cancelled' || (!includePending && current?.state === 'pending') ? null : claim) || legacy;
  }

  async inspect(key) {
    tableKey(key);
    const [current, previous] = await Promise.all([this.store.read(path(key)), this.store.read(legacyPath(key))]);
    const claim = stored(current, true), legacy = stored(previous);
    if (claim && current.state !== 'cancelled' && legacy && !same(claim, legacy)) throw conflict();
    const row = current || previous, binding = claim || legacy;
    if (!row) return null;
    const value = { key, binding, operationId: row.operationId || null, state: row.state || 'ready',
      generation: row.generation || 0, storage: current ? 'native' : 'legacy' };
    return { ...value, recordHash: controlValueDigest(value) };
  }

  async claim(key, value, { guard } = {}) {
    tableKey(key); const next = target(value);
    if (guard !== undefined && typeof guard !== 'function') throw new TypeError('A Table claim guard must be a function.');
    const known = await this.read(key);
    if (known && !same(known, next)) throw linked();
    const result = await this.store.update(path(key), current => {
      guard?.();
      const existing = stored(current, true);
      if (current?.state === 'pending') throw pending();
      if (current?.state === 'cancelled') return { schemaVersion: 2, ...next, generation: nextGeneration(current) };
      if (existing && !same(existing, next)) throw linked();
      return current || { schemaVersion: 2, ...next };
    });
    return stored(result, true);
  }

  async reserve(key, value, ticket = {}) {
    const { operationId: id, guard } = ticket;
    tableKey(key); operationId(id); const next = target(value);
    if (guard !== undefined && typeof guard !== 'function') throw new TypeError('A Table claim guard must be a function.');
    const known = await this.read(key);
    if (known && !same(known, next)) throw linked();
    let authorizedState;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        return stored(await this.store.update(path(key), current => {
          guard?.(); const existing = stored(current, true);
          if (current?.state === 'cancelled') {
            if (current.operationId === id) throw closed();
            const stamp = JSON.stringify([current.generation || 0, current.operationId, existing]);
            if (authorizedState !== stamp) throw Object.assign(new Error('Reservation authorization needs a refresh.'), { [reauthorize]: stamp });
          }
          if (ready(current)) { if (!same(existing, next)) throw linked(); return current; }
          if (current?.state === 'pending') {
            if (current.operationId !== id) throw pending();
            if (!same(existing, next)) throw conflict();
            return current;
          }
          return { schemaVersion: 2, ...next, state: 'pending', operationId: id, generation: nextGeneration(current) };
        }), true);
      } catch (error) {
        if (!error[reauthorize]) throw error;
        await this.#authorizeReuse(key, next, ticket);
        authorizedState = error[reauthorize];
      }
    }
    throw pending();
  }

  async #authorizeReuse(key, binding, { accountKey, identityId, requestHash, operationId: id, authorization }) {
    if (authorization?.type === 'capability') {
      const ref = controlReference(authorization), claim = ref.claim;
      if (!claim || claim.key !== key || claim.operationId !== id || claim.requestHash !== requestHash || !same(claim.binding, binding)) throw closed();
      const head = await this.store.read(`competitions-v2/groups/${ref.id}/head.json`);
      if (head?.version !== ref.version - 1 || !head.pending?.authorization || !sameControlReference(head.pending.authorization, ref)
        || !['pending', 'committed'].includes(head.pending.decision)) throw closed();
      return;
    }
    if (!/^[a-f0-9]{64}$/.test(accountKey || '') || !/^[a-f0-9]{64}$/.test(requestHash || '')) throw closed();
    const account = await this.store.read(`competitions-v2/accounts/${accountKey}.json`);
    if (account?.state !== 'active' || account.identityId !== identityId) throw closed();
    const ticket = account.tableClaims?.[requestHash];
    if (!ticket || ticket.operationId !== id || ticket.key !== key || !same(target(ticket.binding), binding)
      || !['pending', 'committed'].includes(ticket.state)) throw pending();
    if (ticket.control) {
      const ref = controlReference(authorization), { state, ...value } = account.controlOperations?.[ref.operationId] || {};
      if (ref.type !== 'account' || !sameControlReference(value, ref) || state !== ticket.state
        || ticket.control.operationId !== ref.operationId || ticket.control.requestHash !== ref.requestHash
        || ticket.control.payloadHash !== ref.payloadHash || ticket.control.version !== ref.version) throw pending();
    }
  }

  async publish(key, value, { operationId: id, state } = {}) {
    tableKey(key); operationId(id); const next = target(value);
    if (state !== 'committed') throw new TypeError('Publishing requires a committed account decision.');
    return stored(await this.store.update(path(key), current => {
      const existing = stored(current, true);
      if (ready(current)) { if (!same(existing, next)) throw linked(); return current; }
      if (current?.state === 'cancelled' && current.operationId === id) throw closed();
      if (current?.state !== 'pending' || current.operationId !== id || !same(existing, next)) throw pending();
      return { ...current, state: 'ready', generation: nextGeneration(current) };
    }), true);
  }

  async reserved(key, value, id) {
    tableKey(key); operationId(id); const next = target(value);
    const current = await this.store.read(path(key)), existing = stored(current, true);
    if (current?.state === 'cancelled') return false;
    if (current?.state === 'pending') return current.operationId === id && same(existing, next);
    if (ready(current)) return same(existing, next);
    const legacy = stored(await this.store.read(legacyPath(key)));
    return Boolean(legacy && same(legacy, next));
  }

  async settleErasure({ key, binding, operationId: id, state }) {
    tableKey(key); operationId(id); const next = target(binding);
    if (!['pending', 'committed'].includes(state)) throw conflict();
    await this.store.update(path(key), current => {
      const existing = stored(current, true);
      if (ready(current) || (current?.state === 'pending' && current.operationId !== id)) return current;
      if (current?.operationId === id && !same(existing, next)) throw conflict();
      const settled = state === 'committed' ? 'ready' : 'cancelled';
      if (current?.operationId === id && current.state === settled) return current;
      if (current?.operationId === id && current.state === 'cancelled' && state === 'committed') throw conflict();
      return { schemaVersion: 2, ...next, operationId: id, state: settled, generation: nextGeneration(current) };
    });
    return this.inspect(key);
  }
}
