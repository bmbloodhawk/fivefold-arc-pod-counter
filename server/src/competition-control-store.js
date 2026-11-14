import { competitionError, digest } from './competition-values.js';
import { coordinateCompetitionWrites } from './competition-write-coordinator.js';
import { databaseKeyCompare } from './database-key-page.js';
import { controlActor, controlReference, controlReferenceDigest, sameControlReference } from './competition-control-authorization.js';

const sections = ['metadata', 'members', 'invites', 'tables', 'rounds', 'joinRequests', 'work'];
const immutableSections = ['audit'];
const forbiddenKeys = new Set(['__proto__', 'constructor', 'prototype']);
const privateFields = new Set(['accountid', 'accountkey', 'providersubject', 'displayname', 'names',
  'seattoken', 'guesttoken', 'hostrecoverykey', 'authorization', 'ownerconnectionid', 'secret']);
const input = message => competitionError(message, 400, 'CONTROL_INPUT');
const conflict = () => competitionError('Stored competition control is inconsistent.', 503, 'CONTROL_STORAGE_CONFLICT');
const pending = () => competitionError('Competition setup is still being saved.', 409, 'CONTROL_PENDING');
const changed = () => competitionError('Competition control changed. Refresh and retry.', 409, 'CONTROL_VERSION_CONFLICT');
const reused = () => competitionError('That operation ID has different input.', 409, 'CONTROL_OPERATION_CONFLICT');
const validVersion = value => Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER;
function key(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value) || forbiddenKeys.has(value)) throw input('Invalid control record key.');
  return value;
}
function binding(kind, id) {
  key(id);
  if (!['pod', 'tournament'].includes(kind) || !id.startsWith(kind === 'pod' ? 'pod_' : 'event_')) throw input('Invalid competition control target.');
  return { kind, id };
}
function paths(kind, id) {
  binding(kind, id);
  const root = `competitions-v2/groups/${id}`;
  return { head: `${root}/head.json`, registry: `competitions-v2/group-registry/${id}.json`,
    ready: `competitions-v2/group-work/${id}.json`, row: (section, row) => `${root}/rows/${section}/${row}.json`,
    receipt: operation => `${root}/operations/${operation}.json` };
}
function jsonValue(value, section, depth = 0) {
  if (depth > 30) throw input('Control values are too deeply nested.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object') throw input('Control values must be finite JSON data.');
  if (Array.isArray(value)) return value.map(item => jsonValue(item, section, depth + 1));
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw input('Control values must be plain JSON data.');
  return Object.fromEntries(Object.keys(value).sort().map(field => {
    if (forbiddenKeys.has(field) || privateFields.has(field.toLowerCase())
      || (field.toLowerCase() === 'name' && !(section === 'metadata' && depth === 0))) throw input('Personal names and credentials do not belong in control operations.');
    return [field, jsonValue(value[field], section, depth + 1)];
  }));
}
function operation(value) {
  key(value?.operationId);
  if (!value.operationId.startsWith('control_') || !validVersion(value.baseVersion) || !validVersion(value.baseVersion + 1)
    || !Array.isArray(value.changes) || value.changes.length < 1 || value.changes.length > 512) throw input('Invalid control operation.');
  const seen = new Set();
  const changes = value.changes.map(change => {
    if (!change || Object.keys(change).some(field => !['section', 'key', 'value'].includes(field))
      || ![...sections, ...immutableSections].includes(change.section)) throw input('Invalid control row change.');
    key(change.key);
    const identity = `${change.section}/${change.key}`;
    if (seen.has(identity)) throw input('A control operation must change each row once.');
    seen.add(identity);
    const row = jsonValue(change.value, change.section);
    if (immutableSections.includes(change.section) && row === null) throw input('An immutable control event cannot be deleted.');
    if (Buffer.byteLength(JSON.stringify(row)) > 65536) throw input('A control row exceeds 64 KiB.');
    return { section: change.section, key: change.key, value: row };
  }).sort((a, b) => databaseKeyCompare(`${a.section}/${a.key}`, `${b.section}/${b.key}`));
  const json = JSON.stringify({ baseVersion: value.baseVersion, changes });
  if (Buffer.byteLength(json) > 1048576) throw input('A control operation exceeds 1 MiB.');
  return { operationId: value.operationId, json, requestHash: digest(json), version: value.baseVersion + 1, changes };
}
function authorizationReference(value, kind, id, next, payloadHash) {
  return controlReference({ ...value, kind, id, operationId: next.operationId, version: next.version, requestHash: next.requestHash, payloadHash });
}
const authorizationReceipt = next => ({ outcome: 'committed', payloadHash: next.authorization.payloadHash,
  authorization: controlReferenceDigest(next.authorization), ...(next.claimOutcome ? { claimOutcome: next.claimOutcome } : {}) });
function activeKeys(previous, changes) {
  const next = Object.fromEntries(Object.entries(previous || {}).map(([section, keys]) =>
    [section, Object.fromEntries(Object.entries(keys || {}).filter(([, live]) => live === true))]));
  for (const row of changes) {
    if (immutableSections.includes(row.section)) continue;
    const group = { ...(next[row.section] || {}) };
    if (row.value === null) delete group[row.key];
    else group[row.key] = true;
    if (Object.keys(group).length > 4096) throw input('A control collection exceeds 4,096 active rows.');
    next[row.section] = group;
  }
  return next;
}
function storedHead(value, kind, id) {
  if (value === null) return null;
  if (!value || value.schemaVersion !== 2 || value.kind !== kind || value.id !== id || !validVersion(value.version)) throw conflict();
  for (const [section, keys] of Object.entries(value.keys || {})) {
    if (!sections.includes(section) || !keys || typeof keys !== 'object') throw conflict();
    const live = Object.entries(keys).filter(([, present]) => present != null);
    if (live.length > 4096 || live.some(([, present]) => present !== true)) throw conflict();
    for (const [row] of live) { try { key(row); } catch { throw conflict(); } }
  }
  return value;
}
function storedOperation(head) {
  const value = head.pending;
  try {
    const parsed = JSON.parse(value.json), result = operation({ ...parsed, operationId: value.operationId });
    if (result.json !== value.json || result.requestHash !== (value.payloadHash || value.requestHash)
      || !/^[a-f0-9]{64}$/.test(value.requestHash || '') || result.version !== head.version + 1
      || result.version !== value.version || !Number.isSafeInteger(value.applied) || value.applied < 0 || value.applied > result.changes.length) throw conflict();
    if (value.authorization) {
      const actor = controlReference(value.authorization);
      if (actor.kind !== head.kind || actor.id !== head.id || actor.operationId !== result.operationId || actor.version !== result.version
        || actor.requestHash !== value.requestHash || actor.payloadHash !== result.requestHash) throw conflict();
      if (actor.type === 'capability' && !['pending', 'committed', 'cancelled'].includes(value.decision)) throw conflict();
    }
    return { ...result, requestHash: value.requestHash, applied: value.applied, ...(value.authorization ? { authorization: value.authorization } : {}) };
  } catch { throw conflict(); }
}

// Trusted control storage only. Domain authorization and account erasure fencing
// remain required; this class has no live-room or life-counter callbacks.
export class CompetitionControlStore {
  constructor({ store, resolveAuthorization, finishAuthorization } = {}) {
    if (!store?.read || !store?.update || !store?.page) throw new TypeError('Competition control requires conditional records and bounded pages.');
    this.store = coordinateCompetitionWrites(store);
    if (resolveAuthorization !== undefined && typeof resolveAuthorization !== 'function') throw new TypeError('A control authorization resolver must be a function.');
    this.resolveAuthorization = resolveAuthorization;
    if (finishAuthorization !== undefined && typeof finishAuthorization !== 'function') throw new TypeError('An authorization finisher must be a function.');
    this.finishAuthorization = finishAuthorization;
  }

  async register(kind, id) {
    const path = paths(kind, id);
    await this.store.update(path.registry, current => {
      if (current && (current.id !== id || current.kind !== kind)) throw conflict();
      return current || { kind, id };
    });
  }

  async begin(kind, id, value, { guard, prepare, authorization } = {}) {
    const path = paths(kind, id), next = operation(value);
    const actor = authorization === undefined ? null : controlActor(authorization);
    const payloadHash = next.requestHash;
    if (actor) {
      if (!this.resolveAuthorization || !this.finishAuthorization) throw input('Account control requires decision recovery and retirement.');
      next.requestHash = digest({ requestHash: next.requestHash, authorization: actor });
    }
    if (guard !== undefined && typeof guard !== 'function') throw input('A control guard must be synchronous.');
    if (prepare !== undefined && typeof prepare !== 'function') throw input('A control preparer must be synchronous.');
    await this.register(kind, id);
    // Receipt observation belongs to this head version. A later version cannot
    // reuse an ID whose receipt was still absent in an earlier snapshot.
    const observed = storedHead(await this.store.read(path.head), kind, id);
    const observedVersion = observed?.version || 0;
    const duplicate = await this.#committedReceipt(kind, id, next);
    if (duplicate) return duplicate;
    const immutable = new Map();
    for (const row of next.changes.filter(row => immutableSections.includes(row.section))) {
      const current = await this.store.read(path.row(row.section, row.key));
      immutable.set(`${row.section}/${row.key}`, current?.json ?? null);
    }
    let head;
    try {
      head = await this.store.update(path.head, current => {
        current = storedHead(current, kind, id) || { schemaVersion: 2, kind, id, version: 0, keys: {} };
        const result = guard?.(structuredClone(current));
        if (result?.then) { void Promise.resolve(result).catch(() => undefined); throw input('A control guard must be synchronous.'); }
        if (current.version !== observedVersion) throw changed();
        if (current.settling) throw pending();
        if (current.pending) {
          if (current.pending.operationId !== next.operationId) throw pending();
          if (current.pending.requestHash !== next.requestHash) throw reused();
          return current;
        }
        if (current.version !== next.version - 1) throw changed();
        let admitted = { ...next, requestHash: payloadHash };
        if (prepare) {
          const rows = prepare(structuredClone(current));
          if (rows?.then) { void Promise.resolve(rows).catch(() => undefined); throw input('A control preparer must be synchronous.'); }
          admitted = operation({ operationId: next.operationId, baseVersion: next.version - 1, changes: rows });
        }
        const audits = admitted.changes.filter(row => immutableSections.includes(row.section));
        if (audits.length !== immutable.size || audits.some(row => !immutable.has(`${row.section}/${row.key}`))) throw input('Prepared immutable row keys must match the request.');
        for (const row of audits) {
          const existing = immutable.get(`${row.section}/${row.key}`);
          if (existing !== null && existing !== JSON.stringify(row.value)) throw reused();
        }
        activeKeys(current.keys, admitted.changes);
        return { ...current, pending: { operationId: next.operationId, version: next.version,
          requestHash: next.requestHash, payloadHash: admitted.requestHash, json: admitted.json, applied: 0,
          ...(actor ? { authorization: authorizationReference(actor, kind, id, next, admitted.requestHash) } : {}),
          ...(actor?.type === 'capability' ? { decision: 'pending' } : {}) } };
      });
    } catch (error) {
      // The first receipt read can precede another helper's commit. Re-observe
      // only this operation; do not replay the stale edit against a new version.
      if (['CONTROL_VERSION_CONFLICT', 'CONTROL_PENDING'].includes(error.code)) {
        const committed = await this.#committedReceipt(kind, id, next);
        if (committed) return committed;
      }
      throw error;
    }
    await this.#ticket(kind, id, head.pending.version);
    return { operationId: next.operationId, version: next.version, pending: true,
      ...(head.pending.authorization ? { authorization: structuredClone(head.pending.authorization) } : {}) };
  }

  async #committedReceipt(kind, id, next) {
    const path = paths(kind, id);
    const receipt = await this.store.read(path.receipt(next.operationId));
    if (receipt) {
      if (receipt.requestHash !== next.requestHash || receipt.version !== next.version) throw reused();
      const head = storedHead(await this.store.read(path.head), kind, id);
      if (head?.version >= receipt.version) return { operationId: next.operationId, version: receipt.version, pending: false, duplicate: true,
        ...(receipt.outcome ? { outcome: receipt.outcome } : {}) };
    }
    return null;
  }

  async #ticket(kind, id, version) {
    await this.store.update(paths(kind, id).ready, current => {
      if (current && (current.id !== id || current.kind !== kind || !validVersion(current.version))) throw conflict();
      return current?.version >= version ? current : { kind, id, version };
    });
  }

  async #clearTicket(kind, id, version) {
    await this.store.update(paths(kind, id).ready, current => current && current.version <= version ? null : current);
  }

  async resume(kind, id, { maxWrites = 512 } = {}) {
    if (!Number.isInteger(maxWrites) || maxWrites < 0 || maxWrites > 512) throw input('Invalid control write budget.');
    const path = paths(kind, id);
    let head = storedHead(await this.store.read(path.head), kind, id);
    if (!head) return { missing: true, version: 0, pending: false, writes: 0 };
    if (!head.pending) {
      await this.#settle(kind, id, head);
      await this.#clearTicket(kind, id, head.version);
      return { version: head.version, pending: false, writes: 0, ...(head.unavailable ? { unavailable: true } : {}) };
    }
    const next = storedOperation(head);
    if (next.authorization) {
      if (!this.resolveAuthorization) throw competitionError('Account control recovery is unavailable.', 503, 'CONTROL_AUTHORIZATION_UNAVAILABLE');
      const resolved = await this.resolveAuthorization(structuredClone(next.authorization));
      const decision = typeof resolved === 'string' ? resolved : resolved?.state;
      if (decision === 'pending') return { version: head.version, pending: true, writes: 0 };
      if (decision === 'cancelled') return this.#cancel(kind, id, { ...next, ...(resolved?.claimOutcome ? { claimOutcome: resolved.claimOutcome } : {}) });
      if (decision !== 'committed') throw conflict();
    }
    const end = Math.min(next.changes.length, next.applied + maxWrites);
    await this.#ticket(kind, id, next.version);
    for (const row of next.changes.slice(next.applied, end)) {
      const json = JSON.stringify(row.value);
      await this.store.update(path.row(row.section, row.key), current => {
        if (current && (!validVersion(current.version) || typeof current.json !== 'string')) throw conflict();
        if (current && immutableSections.includes(row.section)) {
          if (current.json !== json) throw reused();
          return current;
        }
        if (current?.version > next.version) return current;
        if (current?.version === next.version) {
          if (current.operationId !== next.operationId || current.json !== json) throw conflict();
          return current;
        }
        return { version: next.version, operationId: next.operationId, json };
      });
    }
    const writes = end - next.applied;
    head = await this.store.update(path.head, current => {
      storedHead(current, kind, id);
      if (current.version >= next.version) return current;
      if (current.pending?.operationId !== next.operationId || current.pending.requestHash !== next.requestHash) throw conflict();
      if (current.pending.applied >= end) return current;
      return { ...current, pending: { ...current.pending, applied: end } };
    });
    if (head.version >= next.version) { await this.#settle(kind, id, head); await this.#clearTicket(kind, id, next.version); return { version: head.version, pending: Boolean(head.pending), writes }; }
    if (head.pending.applied < next.changes.length) return { version: head.version, pending: true, writes };
    await this.store.update(path.receipt(next.operationId), current => {
      if (current && (current.requestHash !== next.requestHash || current.version !== next.version)) throw reused();
      if (current?.outcome && current.outcome !== 'committed') throw conflict();
      return current || { operationId: next.operationId, requestHash: next.requestHash, version: next.version,
        ...(next.authorization ? authorizationReceipt(next) : {}) };
    });
    head = await this.store.update(path.head, current => {
      storedHead(current, kind, id);
      if (current.version >= next.version) return current;
      if (current.pending?.operationId !== next.operationId || current.pending.applied !== next.changes.length) throw conflict();
      const { pending: finished, ...committed } = current;
      return { ...committed, version: next.version, keys: activeKeys(current.keys, next.changes),
        ...(next.authorization ? { settling: next.authorization } : {}) };
    });
    await this.#settle(kind, id, head);
    await this.#clearTicket(kind, id, next.version);
    return { version: head.version, pending: Boolean(head.pending), writes };
  }

  async #cancel(kind, id, next) {
    if (next.applied !== 0) throw conflict();
    const path = paths(kind, id);
    await this.store.update(path.receipt(next.operationId), current => {
      if (current && (current.requestHash !== next.requestHash || current.version !== next.version || current.outcome !== 'cancelled')) throw conflict();
      return current || { operationId: next.operationId, requestHash: next.requestHash, version: next.version,
        ...authorizationReceipt(next), outcome: 'cancelled' };
    });
    const head = await this.store.update(path.head, current => {
      storedHead(current, kind, id);
      if (current.version >= next.version) return current;
      if (current.pending?.operationId !== next.operationId || current.pending.requestHash !== next.requestHash || current.pending.applied !== 0) throw conflict();
      const { pending: cancelled, ...rest } = current;
      return { ...rest, version: next.version, settling: next.authorization, ...(current.version === 0 ? { unavailable: true } : {}) };
    });
    await this.#settle(kind, id, head);
    await this.#clearTicket(kind, id, next.version);
    return { version: head.version, pending: Boolean(head.pending), writes: 0, outcome: 'cancelled', ...(head.unavailable ? { unavailable: true } : {}) };
  }

  async #settle(kind, id, head) {
    if (!head.settling) return;
    if (!this.finishAuthorization) throw competitionError('Account control retirement is unavailable.', 503, 'CONTROL_AUTHORIZATION_UNAVAILABLE');
    const reference = structuredClone(head.settling);
    await this.finishAuthorization(reference);
    await this.store.update(paths(kind, id).head, current => {
      storedHead(current, kind, id);
      if (!current.settling || current.version > reference.version) return current;
      if (!sameControlReference(current.settling, reference)) throw conflict();
      const { settling: finished, ...rest } = current;
      return rest;
    });
  }

  async read(kind, id, { sections: selected = sections, auditLimit = 0 } = {}) {
    const path = paths(kind, id);
    if (!Array.isArray(selected) || new Set(selected).size !== selected.length || selected.some(section => !sections.includes(section))) throw input('Invalid control read sections.');
    if (!Number.isInteger(auditLimit) || auditLimit < 0 || auditLimit > 100) throw input('Invalid control audit page limit.');
    for (let attempt = 0; attempt < 8; attempt++) {
      await this.resume(kind, id);
      const before = storedHead(await this.store.read(path.head), kind, id);
      if (!before || before.unavailable && !before.pending) throw competitionError('That competition control is unavailable.', 404, 'COMPETITION_NOT_FOUND');
      if (before.pending) continue;
      const rows = Object.fromEntries(selected.map(section => [section, {}]));
      const requested = selected.flatMap(section => Object.entries(before.keys?.[section] || {})
        .filter(([, live]) => live === true).map(([key]) => ({ section, key })));
      let cursor = 0, inconsistent = false;
      await Promise.all(Array.from({ length: Math.min(8, requested.length) }, async () => {
        while (cursor < requested.length) {
          const row = requested[cursor++], value = await this.store.read(path.row(row.section, row.key));
          if (!value || !validVersion(value.version) || value.version > before.version || typeof value.json !== 'string') { inconsistent = true; continue; }
          let parsed; try { parsed = JSON.parse(value.json); } catch { throw conflict(); }
          if (parsed === null) inconsistent = true;
          else rows[row.section][row.key] = parsed;
        }
      }));
      if (auditLimit) {
        rows.audit = {};
        const page = await this.store.page(`competitions-v2/groups/${id}/rows/audit.json`, { limit: auditLimit, direction: 'desc' });
        for (const row of page.items) {
          if (!validVersion(row.value?.version) || row.value.version > before.version || typeof row.value.json !== 'string') { inconsistent = true; continue; }
          try { rows.audit[row.key] = JSON.parse(row.value.json); } catch { throw conflict(); }
        }
      }
      const after = storedHead(await this.store.read(path.head), kind, id);
      if (after?.pending || before.version !== after?.version) continue;
      if (inconsistent) throw conflict();
      return { kind, id, version: before.version, rows };
    }
    throw competitionError('Competition control is changing. Refresh and retry.', 503, 'CONTROL_BUSY');
  }

  async recover({ workerId = 'competition', limit = 10, maxWrites = 64 } = {}) {
    key(workerId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(maxWrites) || maxWrites < 2 || maxWrites > 512) throw input('Invalid discovery budget.');
    const cursorPath = `competitions-v2/group-work-cursors/${workerId}.json`;
    const cursors = await this.store.read(cursorPath) || {}, result = { visited: 0, finished: [], writes: 0, errors: [] };
    // Registry repair has its own budget even while the ready queue remains busy.
    for (const [channel, collection, budget] of [['ready', 'group-work', Math.ceil(maxWrites / 2)], ['registry', 'group-registry', Math.floor(maxWrites / 2)]]) {
      const previous = cursors[channel] || null;
      const page = await this.store.page(`competitions-v2/${collection}.json`, { limit, cursor: previous });
      let remaining = budget, nextCursor = page.nextCursor;
      for (let index = 0; index < page.items.length; index++) {
        const row = page.items[index];
        if (remaining === 0) { nextCursor = index ? page.items[index - 1].key : previous; break; }
        try {
          const target = binding(row.value.kind, row.value.id);
          if (target.id !== row.key) throw conflict();
          const resumed = await this.resume(target.kind, target.id, { maxWrites: remaining });
          result.visited++; result.writes += resumed.writes; remaining -= resumed.writes;
          if (!resumed.pending && !resumed.missing && !resumed.unavailable) result.finished.push(target.id);
        } catch (error) {
          result.errors.push({ id: row.key, code: error.code || 'CONTROL_STORAGE_ERROR', message: error.message });
          // A failed attempt may have written children before its progress save.
          result.writes += remaining; remaining = 0;
        }
      }
      await this.store.update(cursorPath, current => {
        if ((current?.[channel] || null) !== previous) return current;
        return { ...(current || {}), [channel]: nextCursor };
      });
    }
    result.finished = [...new Set(result.finished)];
    return result;
  }
}
