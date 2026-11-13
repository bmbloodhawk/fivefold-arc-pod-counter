import { competitionError, competitionId } from './competition-values.js';
import { coordinateCompetitionWrites } from './competition-write-coordinator.js';
import { controlReference, controlReferenceDigest, sameControlReference, controlValueDigest, controlClaimTicket } from './competition-control-authorization.js';
import { CompetitionTableClaims } from './competition-table-claims.js';

const accountPath = key => `competitions-v2/accounts/${key}.json`;
const identityPath = id => `competitions-v2/identities/${id}.json`;
const groupPath = id => `competitions-v2/groups/${id}`;
const conflict = () => competitionError('Stored account authorization is inconsistent.', 503, 'CONTROL_AUTHORIZATION_CONFLICT');
const pending = () => competitionError('Account authorization is still pending.', 409, 'CONTROL_AUTHORIZATION_PENDING');
const cancelled = () => competitionError('This unfinished edit was cancelled. Refresh and try again.', 409, 'CONTROL_AUTHORIZATION_CANCELLED');
const closed = () => competitionError('Account group data was removed.', 403, 'IDENTITY_CLOSED');
export function accountAuthorizationRevision(row) {
  const value = row?.authorizationRevision ?? 0;
  if (!Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) throw conflict();
  return value;
}
function target(kind, id) {
  competitionId(id);
  if (!['pod', 'tournament'].includes(kind) || !id.startsWith(kind === 'pod' ? 'pod_' : 'event_')) throw conflict();
}
function reference(value) {
  try { const ref = controlReference(value); if (ref.type !== 'account') throw conflict(); return ref; }
  catch { throw conflict(); }
}
function exact(ticket, ref) {
  if (!ticket) return null;
  const { state, ...value } = ticket;
  try { if (!sameControlReference(value, ref) || !['pending', 'committed', 'cancelled'].includes(state)) throw conflict(); }
  catch { throw conflict(); }
  return ticket;
}
function decision(row, ref) {
  const ticket = exact(row?.controlOperations?.[ref.operationId], ref);
  if (ref.claim) {
    const claim = row?.tableClaims?.[ref.claim.requestHash];
    if (!ticket && !claim) return null;
    if (!ticket || !claim || controlValueDigest(claim) !== controlValueDigest(controlClaimTicket(ref, ticket.state))) throw conflict();
  }
  return ticket;
}
function withDecision(row, ref, state) {
  return { ...row, authorizationRevision: accountAuthorizationRevision(row) + 1,
    controlOperations: { ...row.controlOperations, [ref.operationId]: { ...ref, state } },
    ...(ref.claim ? { tableClaims: { ...row.tableClaims, [ref.claim.requestHash]: controlClaimTicket(ref, state) } } : {}) };
}
function guardNow(guard) {
  const result = guard?.();
  if (result?.then) { void Promise.resolve(result).catch(() => undefined); throw new TypeError('Account decision guards must be synchronous.'); }
}
const authorizationHash = controlReferenceDigest;

// Cross-record authorization decisions. The owning account CAS arbitrates
// commitment versus erasure/abort. Only committed frozen group payloads replay.
export class CompetitionAccountControl {
  constructor({ store, now = Date.now, abortAfterMs = 30000 } = {}) {
    if (!store?.read || !store?.update || typeof now !== 'function' || !Number.isInteger(abortAfterMs)
      || abortAfterMs < 1 || abortAfterMs > 120000) throw new TypeError('Account control requires conditional storage and a bounded abort delay.');
    this.store = coordinateCompetitionWrites(store); this.now = now; this.abortAfterMs = abortAfterMs;
    this.claims = new CompetitionTableClaims({ store: this.store });
  }

  async prepare(identityId, kind, id) {
    competitionId(identityId); target(kind, id);
    const profile = await this.store.read(identityPath(identityId));
    if (profile?.state !== 'active') throw closed();
    if (!/^[a-f0-9]{64}$/.test(profile.accountKey || '')) throw conflict();
    await this.store.update(identityPath(identityId), row => {
      if (row?.state !== 'active') throw closed();
      if (row.accountKey !== profile.accountKey) throw conflict();
      if (row.scopes?.[id] === true) return row;
      if (Object.keys(row.scopes || {}).length >= 4096) throw competitionError('This identity has too many group references.', 409, 'CONTROL_REFERENCE_LIMIT');
      return { ...row, scopes: { ...row.scopes, [id]: true } };
    });
    const account = await this.store.read(accountPath(profile.accountKey));
    if (account?.state !== 'active' || account.identityId !== identityId) throw closed();
    return { type: 'account', accountKey: profile.accountKey, identityId,
      admissionRevision: accountAuthorizationRevision(account), abortAfter: this.now() + this.abortAfterMs };
  }

  async #reservation(ref) {
    const head = await this.store.read(`${groupPath(ref.id)}/head.json`);
    if (head?.version >= ref.version) {
      const receipt = await this.store.read(`${groupPath(ref.id)}/operations/${ref.operationId}.json`);
      if (receipt?.version === ref.version && receipt.requestHash === ref.requestHash && receipt.outcome === 'cancelled') throw cancelled();
    }
    if (head?.version !== ref.version - 1 || head.kind !== ref.kind || !head.pending?.authorization
      || !sameControlReference(head.pending.authorization, ref)
      || head.pending.operationId !== ref.operationId || head.pending.requestHash !== ref.requestHash
      || head.pending.payloadHash !== ref.payloadHash || head.pending.applied !== 0) throw conflict();
    if (ref.claim) {
      let changes; try { changes = JSON.parse(head.pending.json).changes; } catch { throw conflict(); }
      if (!changes?.some(row => row.section === 'tables' && row.key === ref.claim.key && row.value?.roomCode === ref.claim.binding.roomCode)) throw conflict();
    }
  }

  async admit(value) {
    const ref = reference(value); await this.#reservation(ref);
    const account = await this.store.update(accountPath(ref.accountKey), row => {
      if (row?.state !== 'active' || row.identityId !== ref.identityId) throw closed();
      const previous = decision(row, ref);
      if (previous?.state === 'cancelled') throw cancelled();
      if (previous) return row;
      if (accountAuthorizationRevision(row) !== ref.admissionRevision) throw cancelled();
      if (Object.keys(row.controlOperations || {}).length >= 256) throw competitionError('Account setup has too many unfinished operations.', 409, 'CONTROL_REFERENCE_LIMIT');
      return withDecision(row, ref, 'pending');
    });
    return account.controlOperations[ref.operationId].state;
  }

  async commit(value, { guard } = {}) {
    const ref = reference(value);
    if (guard !== undefined && typeof guard !== 'function') throw new TypeError('An account guard must be a function.');
    await this.#reservation(ref);
    if (ref.claim && (typeof guard !== 'function' || !await this.claims.reserved(ref.claim.key, ref.claim.binding, ref.claim.operationId))) {
      throw competitionError('The host must finish reserving this Table.', 409, 'TABLE_SETUP_PENDING');
    }
    const account = await this.store.update(accountPath(ref.accountKey), row => {
      if (row?.state !== 'active' || row.identityId !== ref.identityId) throw closed();
      const previous = decision(row, ref);
      if (!previous) {
        if (accountAuthorizationRevision(row) !== ref.admissionRevision) throw cancelled();
        throw pending();
      }
      if (previous.state === 'cancelled') throw cancelled();
      if (previous.state === 'committed') return row;
      guardNow(guard);
      return withDecision(row, ref, 'committed');
    });
    return account.controlOperations[ref.operationId].state;
  }

  async resolve(value, { cancel = false } = {}) {
    const ref = reference(value), path = accountPath(ref.accountKey);
    const observed = await this.store.read(path);
    const ticket = decision(observed, ref);
    if (ticket?.state === 'committed' || ticket?.state === 'cancelled') return ticket.state;
    if (!ticket) {
      const terminal = await this.#terminal(ref);
      if (terminal) return terminal;
    }
    if (observed?.state === 'closed') return 'cancelled';
    if (!['active', 'closing'].includes(observed?.state)) throw conflict();
    const due = row => row.state === 'closing' || cancel || this.now() >= ref.abortAfter
      || (!row.controlOperations?.[ref.operationId] && accountAuthorizationRevision(row) !== ref.admissionRevision);
    if (!due(observed)) return 'pending';
    const account = await this.store.update(path, row => {
      if (row?.state === 'closed') return row;
      if (!['active', 'closing'].includes(row?.state)) throw conflict();
      const previous = decision(row, ref);
      if (previous?.state === 'committed' || previous?.state === 'cancelled' || !due(row)) return row;
      // An absent admission is fenced by a permanent revision advance. No
      // temporary marker is needed, and retirement cannot restore its old ETag.
      if (!previous) {
        if (accountAuthorizationRevision(row) !== ref.admissionRevision) return row;
        return { ...row, authorizationRevision: accountAuthorizationRevision(row) + 1 };
      }
      return withDecision(row, ref, 'cancelled');
    });
    const current = decision(account, ref);
    if (current) return current.state;
    const terminal = await this.#terminal(ref);
    if (terminal) return terminal;
    return account.state === 'closed' || accountAuthorizationRevision(account) !== ref.admissionRevision ? 'cancelled' : 'pending';
  }

  async #terminal(ref) {
    const root = groupPath(ref.id);
    const receipt = await this.store.read(`${root}/operations/${ref.operationId}.json`);
    if (!receipt) return null;
    if (receipt.version !== ref.version || receipt.requestHash !== ref.requestHash || receipt.payloadHash !== ref.payloadHash
      || receipt.authorization !== authorizationHash(ref) || !['committed', 'cancelled'].includes(receipt.outcome)) throw conflict();
    const head = await this.store.read(`${root}/head.json`);
    return head?.version >= ref.version ? receipt.outcome : null;
  }

  async retire(value, { claimVerified = false } = {}) {
    const ref = reference(value), root = groupPath(ref.id);
    if (ref.claim && !claimVerified) throw pending();
    const [head, receipt] = await Promise.all([this.store.read(`${root}/head.json`), this.store.read(`${root}/operations/${ref.operationId}.json`)]);
    if (!(head?.version >= ref.version) || head.pending?.operationId === ref.operationId || receipt?.version !== ref.version
      || receipt.requestHash !== ref.requestHash || receipt.payloadHash !== ref.payloadHash
      || receipt.authorization !== authorizationHash(ref) || !['committed', 'cancelled'].includes(receipt.outcome)) throw pending();
    await this.store.update(accountPath(ref.accountKey), row => {
      const previous = decision(row, ref);
      if (!previous) return row;
      if (previous.state !== receipt.outcome || !['active', 'closing'].includes(row.state)) throw conflict();
      const next = { ...row, authorizationRevision: accountAuthorizationRevision(row) + 1,
        controlOperations: { ...row.controlOperations } };
      delete next.controlOperations[ref.operationId];
      if (!Object.keys(next.controlOperations).length) delete next.controlOperations;
      if (ref.claim) {
        next.tableClaims = { ...row.tableClaims }; delete next.tableClaims[ref.claim.requestHash];
        if (!Object.keys(next.tableClaims).length) delete next.tableClaims;
      }
      return next;
    });
  }
}
