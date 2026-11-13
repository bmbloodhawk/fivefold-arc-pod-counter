import { randomBytes } from 'node:crypto';
import { competitionError } from './competition-values.js';

const collections = ['members', 'invites', 'tables', 'rounds', 'joinRequests', 'work'];
const json = value => JSON.stringify(value);
const stored = value => JSON.parse(json(value));
const invariant = () => competitionError('Competition data could not be saved safely. Refresh and try again.', 503, 'COMPETITION_STORAGE_CONFLICT');
const operationId = () => 'control_' + randomBytes(16).toString('base64url');
function edit(change, scope) {
  const result = change(scope);
  if (result?.then) {
    void Promise.resolve(result).catch(() => undefined);
    throw new TypeError('Scope control callbacks must be synchronous.');
  }
  return result;
}

function partition(scope) {
  const { schemaVersion, storageFormat, version, audit, games, standings, members = {}, invites = {}, tables = {},
    rounds = [], joinRequests = {}, work = {}, ...metadata } = scope;
  return { metadata: { group: stored({ ...metadata, pendingGames: metadata.pendingGames ?? 0 }) },
    members: stored(members), invites: stored(invites), tables: stored(tables), joinRequests: stored(joinRequests), work: stored(work),
    rounds: Object.fromEntries(rounds.map(round => {
      if (!round?.id) throw invariant();
      return [round.id, stored(round)];
    })) };
}
function historyUnchanged(before, after) {
  if (json(before.games || {}) !== json(after.games || {}) || json(before.standings || {}) !== json(after.standings || {})) throw invariant();
}
function auditSuffix(before, after) {
  if (!Array.isArray(after.audit) || after.audit.length < before.audit.length
    || json(after.audit.slice(0, before.audit.length)) !== json(before.audit)) throw invariant();
  return after.audit.slice(before.audit.length);
}
function changes(before, after, version) {
  const left = before ? partition(before) : {}, right = partition(after), output = [];
  for (const section of ['metadata', ...collections]) {
    for (const key of new Set([...Object.keys(left[section] || {}), ...Object.keys(right[section] || {})])) {
      const previous = left[section]?.[key], next = right[section]?.[key];
      if (json(previous) !== json(next)) output.push({ section, key, value: next ?? null });
    }
  }
  const appended = before ? auditSuffix(before, after) : after.audit || [];
  appended.forEach((entry, index) => output.push({ section: 'audit',
    key: `audit_${String(version).padStart(16, '0')}_${String(index).padStart(4, '0')}`, value: stored(entry) }));
  // An undefined callback result has always advanced the public group version,
  // even for an identical edit. Only an explicit false means a no-op.
  if (!output.length) output.push({ section: 'metadata', key: 'group', value: right.metadata.group });
  return output;
}
function setupChanges(before, after, version, tableClaim) {
  const rows = changes(before, after, version);
  if (tableClaim && !rows.some(row => row.section === 'tables' && row.key === tableClaim.key)) {
    const table = after.tables?.[tableClaim.key]; if (!table) throw invariant();
    rows.push({ section: 'tables', key: tableClaim.key, value: stored(table) });
  }
  return rows;
}

// Bridges the existing control callbacks to partitioned, versioned storage.
// Historical results/standings are deliberately not rewritten by this adapter.
export class CompetitionScopeStore {
  #lanes = new Map();
  constructor({ control, identities } = {}) {
    control ||= identities?.controlStore;
    if (!control?.begin || !control?.resume || !control?.read || !control?.recover) throw new TypeError('A scope store requires durable competition control.');
    this.control = control;
    this.identities = identities;
  }

  async create(kind, id, scope, { actorIdentityId, guard } = {}) {
    historyUnchanged({ games: {}, standings: {} }, scope);
    const value = stored(scope);
    const authorization = actorIdentityId ? await this.#authority(actorIdentityId, kind, id) : undefined;
    const accepted = await this.control.begin(kind, id, { operationId: operationId(), baseVersion: 0, changes: changes(null, value, 1) }, { authorization });
    await this.#publish(kind, id, accepted, guard);
    return this.read(kind, id);
  }

  async read(kind, id) {
    const state = await this.control.read(kind, id, { auditLimit: 30 });
    const metadata = state.rows.metadata.group;
    if (metadata?.id !== id || metadata.kind !== kind) throw invariant();
    return { ...metadata, schemaVersion: 2, storageFormat: 'partitioned-control-v1', version: state.version,
      members: state.rows.members, invites: state.rows.invites, tables: state.rows.tables,
      rounds: Object.values(state.rows.rounds).sort((a, b) => a.number - b.number), joinRequests: state.rows.joinRequests,
      work: state.rows.work, audit: Object.entries(state.rows.audit || {}).sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value),
      games: {}, standings: {} };
  }

  change(kind, id, change, options = {}) {
    const previous = this.#lanes.get(id) || Promise.resolve();
    const result = previous.then(() => this.#change(kind, id, change, options));
    const settled = result.then(() => undefined, () => undefined);
    this.#lanes.set(id, settled);
    void settled.then(() => { if (this.#lanes.get(id) === settled) this.#lanes.delete(id); });
    return result;
  }

  async #change(kind, id, change, { actorIdentityId, guard, tableClaim, participantId } = {}) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const before = await this.read(kind, id), next = structuredClone(before);
      if (edit(change, next) === false) return before;
      historyUnchanged(before, next);
      const value = { operationId: operationId(), baseVersion: before.version, changes: setupChanges(before, next, before.version + 1, tableClaim) };
      try {
        let authorization = actorIdentityId ? await this.#authority(actorIdentityId, kind, id) : undefined;
        if (tableClaim) {
          if (!this.identities?.tableSetup) throw new TypeError('Compound Table control requires its setup decision provider.');
          authorization = this.identities.tableSetup.prepare({ actor: authorization, participantId, tableClaim, operationId: value.operationId });
        }
        const accepted = await this.control.begin(kind, id, value, { authorization, prepare: () => {
          const recheck = structuredClone(before);
          if (edit(change, recheck) === false) throw competitionError('Competition state changed.', 409, 'CONTROL_VERSION_CONFLICT');
          historyUnchanged(before, recheck);
          // Publish the successful admission callback's live-derived values,
          // not the earlier preview (for example, a seat's ownership proof).
          return setupChanges(before, recheck, before.version + 1, tableClaim);
        } });
        await this.#publish(kind, id, accepted, guard);
        return this.read(kind, id);
      } catch (error) {
        if (!['CONTROL_VERSION_CONFLICT', 'CONTROL_PENDING'].includes(error.code)) throw error;
      }
    }
    throw competitionError('Competition control is changing. Refresh and try again.', 409, 'CONTROL_BUSY');
  }

  #authority(identityId, kind, id) {
    if (!this.identities?.controlAuthorization) throw new TypeError('Signed control requires account-fenced identities.');
    return this.identities.controlAuthority(identityId, kind, id);
  }

  async #publish(kind, id, accepted, guard) {
    const reference = accepted.authorization;
    if (accepted.outcome === 'cancelled') throw competitionError('The unfinished edit was cancelled.', 409, 'CONTROL_AUTHORIZATION_CANCELLED');
    if (reference) {
      const accounts = reference.claim ? this.identities.tableSetup : this.identities.controlAuthorization;
      try {
        await accounts.admit(reference, { guard });
        await accounts.commit(reference, { guard });
      } catch (error) {
        const resolved = await accounts.resolve(reference, { cancel: true });
        const decision = typeof resolved === 'string' ? resolved : resolved?.state;
        await this.control.resume(kind, id);
        if (decision !== 'committed') {
          if (reference.type === 'account' && !await this.identities.profile(reference.identityId)) throw competitionError('Account group data was removed.', 403, 'IDENTITY_CLOSED');
          throw error;
        }
      }
    }
    await this.control.resume(kind, id);
  }

  async recover(options) {
    const progress = await this.control.recover(options);
    return { ...progress, bindings: progress.finished.map(id => ({ id, kind: id.startsWith('pod_') ? 'pod' : 'tournament' })) };
  }
}
