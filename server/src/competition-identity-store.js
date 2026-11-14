import { randomBytes } from 'node:crypto';
import { cleanText, competitionError, competitionId, digest } from './competition-values.js';
import { coordinateCompetitionWrites } from './competition-write-coordinator.js';
import { CompetitionTableClaims, tableClaimKey, tableClaimTarget } from './competition-table-claims.js';
import { CompetitionAccountControl } from './competition-account-control.js';
import { CompetitionTableSetup } from './competition-table-setup.js';
import { CompetitionErasureControl } from './competition-erasure-control.js';

const legacyRoot = 'competitions/directory.json';
const legacyLeaf = (field, key) => `competitions/directory/${field}/${key}.json`;
const accountPath = key => `competitions-v2/accounts/${key}.json`;
const valuePath = id => `competitions-v2/identities/${id}.json`;
const closed = () => competitionError('This account’s group data was removed. Sign out and sign in again.', 403, 'IDENTITY_CLOSED');
const inconsistent = () => competitionError('The stored group identity is inconsistent.', 503, 'IDENTITY_STORAGE_CONFLICT');
const unavailable = () => competitionError('You do not have access to this group.', 403, 'COMPETITION_ACCESS');
const identityId = id => {
  competitionId(id);
  if (!id.startsWith('identity_')) throw competitionError('Invalid group identity.');
  return id;
};
const accountKey = id => {
  if (typeof id !== 'string' || !id) throw competitionError('Sign in to join a Pod.', 401, 'SIGN_IN_REQUIRED');
  return digest(id);
};
const closedRow = () => ({ schemaVersion: 2, state: 'closed' });
const isClosedRow = row => row?.schemaVersion === 2 && row.state === 'closed' && Object.keys(row).length === 2;
const authorizationRevision = row => {
  const value = row?.authorizationRevision ?? 0;
  if (!Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) throw inconsistent();
  return value;
};
const setupPending = () => competitionError('The host must finish linking this Table.', 409, 'TABLE_SETUP_PENDING');
const ticketReference = ({ state, ...reference }) => reference;

// This store is for setup, identity views and account erasure only. It has no
// RoomService hooks, live-counter callbacks or private-award authority.
export class CompetitionIdentityStore {
  constructor({ store, legacyBridge = false, createId = () => randomBytes(18).toString('base64url'), now = Date.now } = {}) {
    if (!store?.read || !store?.update || !store?.page) throw new TypeError('Identity storage requires conditional records and bounded pages.');
    this.store = coordinateCompetitionWrites(store); this.legacyBridge = legacyBridge; this.createId = createId;
    this.tableClaims = new CompetitionTableClaims({ store: this.store });
    this.controlAuthorization = new CompetitionAccountControl({ store: this.store, now });
    this.tableSetup = new CompetitionTableSetup({ store: this.store, accounts: this.controlAuthorization, claims: this.tableClaims, now });
    this.controlStore = this.tableSetup.control;
    this.erasureControl = new CompetitionErasureControl({ store: this.store, control: this.controlStore, accounts: this.tableSetup });
  }

  async identity(accountId, createName) {
    const key = accountKey(accountId);
    if (createName !== undefined) cleanText(createName, 'Your name');
    return this.resolveKey(key, createName !== undefined);
  }

  // Observation only: unlike identity(), never help opening/erasure from a view.
  async lookup(accountId) {
    const key = accountKey(accountId);
    const [index, legacyClosed] = await Promise.all([
      this.store.read(accountPath(key)), this.store.read(legacyLeaf('closed', key)),
    ]);
    if (legacyClosed) return null;
    if (index && index.schemaVersion !== 2) throw inconsistent();
    if (['opening', 'closing', 'closed'].includes(index?.state)) return null;
    if (index && index.state !== 'active') throw inconsistent();
    const id = index?.identityId || await this.store.read(legacyLeaf('accounts', key));
    if (!id) return null;
    const profile = await this.profile(identityId(id));
    if (!profile) return null;
    if (profile.accountKey !== key) throw inconsistent();
    return id;
  }

  async resolveKey(key, create) {
    const [current, legacyClosed] = await Promise.all([
      this.store.read(accountPath(key)), this.store.read(legacyLeaf('closed', key)),
    ]);
    if (legacyClosed || ['closing', 'closed'].includes(current?.state)) {
      if (current && current.state !== 'closed') await this.eraseKey(key);
      throw closed();
    }
    if (current) return this.finishOpening(key, current);
    const previous = await this.store.read(legacyLeaf('accounts', key));
    if (previous) {
      identityId(previous);
      const owner = await this.store.read(legacyLeaf('identities', previous));
      if (owner?.accountKey !== key) throw inconsistent();
    }
    if (!create) { if (previous) return previous; throw unavailable(); }
    const candidate = previous || identityId(`identity_${this.createId()}`);
    const reserved = await this.store.update(accountPath(key), row => row || {
      schemaVersion: 2, state: 'opening', identityId: candidate,
      mode: this.legacyBridge ? 'legacy_bridge' : 'native', resolved: !this.legacyBridge, reservedIds: [candidate],
    });
    return this.finishOpening(key, reserved);
  }

  async finishOpening(key, initial) {
    let index = initial;
    if (index?.schemaVersion !== 2) throw inconsistent();
    if (['closing', 'closed'].includes(index.state)) throw closed();
    if (index.state === 'opening' && index.mode === 'legacy_bridge' && !index.resolved) {
      // Claim the ID in the same per-ID namespace used by native creators before
      // publishing a legacy owner. The account is still opening, so names stay private.
      try { await this.initializeValue(key, identityId(index.identityId)); }
      catch (error) {
        if (error.code !== 'IDENTITY_CLOSED') throw error;
        const latest = await this.store.read(accountPath(key));
        if (latest?.state === 'active' || (latest?.state === 'opening' && latest.resolved && latest.identityId !== index.identityId)) {
          return this.finishOpening(key, latest);
        }
        throw error;
      }
      const directory = await this.store.update(legacyRoot, current => {
        if (current?.closed?.[key]) throw closed();
        if (current?.accounts?.[key]) {
          if (current.identities?.[current.accounts[key]]?.accountKey !== key) throw inconsistent();
          return current;
        }
        if (current?.identities?.[index.identityId] && current.identities[index.identityId].accountKey !== key) throw inconsistent();
        const next = structuredClone(current || { schemaVersion: 1 });
        next.accounts = { ...next.accounts, [key]: index.identityId };
        next.identities = { ...next.identities, [index.identityId]: { accountKey: key } };
        return next;
      });
      const canonical = identityId(directory.accounts[key]);
      index = await this.store.update(accountPath(key), row => {
        if (row?.state !== 'opening') return row;
        if (row.resolved) { if (row.identityId !== canonical) throw inconsistent(); return row; }
        return { ...row, identityId: canonical, resolved: true,
          reservedIds: [...new Set([...(row.reservedIds || []), row.identityId, canonical])] };
      });
    }
    if (['closing', 'closed'].includes(index?.state)) throw closed();
    if (!index || !['opening', 'active'].includes(index.state)) throw inconsistent();
    const id = identityId(index.identityId);
    if (index.state === 'opening') {
      if (await this.store.read(legacyLeaf('closed', key))) { await this.eraseKey(key); throw closed(); }
      await this.initializeValue(key, id);
      for (const provisional of index.reservedIds || []) {
        if (provisional !== id) await this.closeOwnedValue(key, identityId(provisional));
      }
      index = await this.store.update(accountPath(key), row => {
        if (['closing', 'closed'].includes(row?.state)) throw closed();
        if (row?.identityId !== id || !['opening', 'active'].includes(row.state)) throw inconsistent();
        if (row.state === 'active') return row;
        return { schemaVersion: 2, state: 'active', identityId: id, mode: row.mode };
      });
    }
    const value = await this.store.read(valuePath(id));
    if (value?.state === 'closed') throw closed();
    if (value?.schemaVersion !== 2 || value.state !== 'active' || value.accountKey !== key) throw inconsistent();
    return index.identityId;
  }

  async initializeValue(key, id) {
    const owner = await this.store.read(legacyLeaf('identities', id));
    if (owner && owner.accountKey !== key) throw inconsistent();
    await this.store.update(valuePath(id), row => {
      if (row?.state === 'closed') throw closed();
      if (row) { if (row.schemaVersion !== 2 || row.state !== 'active' || row.accountKey !== key) throw inconsistent(); return row; }
      return { schemaVersion: 2, state: 'active', accountKey: key, aliases: {}, scopes: {} };
    });
  }

  async closeOwnedValue(key, id) {
    const legacyOwner = await this.store.read(legacyLeaf('identities', id));
    await this.store.update(valuePath(id), row => {
      if (isClosedRow(row)) return row;
      if (legacyOwner && legacyOwner.accountKey !== key) {
        if (row?.accountKey === key) throw inconsistent();
        return row;
      }
      if (row && row.accountKey !== key) return row;
      return closedRow();
    });
  }

  async freezeOwnedValue(key, id) {
    const [legacyOwner, legacyScopes] = await Promise.all([
      this.store.read(legacyLeaf('identities', id)), this.store.read(legacyLeaf('scopes', id)),
    ]);
    const value = await this.store.update(valuePath(id), row => {
      if (isClosedRow(row)) return row;
      if (legacyOwner && legacyOwner.accountKey !== key) {
        if (row?.accountKey === key) throw inconsistent();
        return row;
      }
      if (row && row.accountKey !== key) return row;
      const scopes = Object.fromEntries([...Object.keys(row?.scopes || {}), ...Object.keys(legacyScopes || {})].map(scope => {
        competitionId(scope); return [scope, true];
      }));
      return { schemaVersion: 2, state: 'closing', accountKey: key, scopes };
    });
    return value?.state === 'closing' && value.accountKey === key ? value.scopes || {} : {};
  }

  async profile(id) {
    identityId(id);
    const [value, legacy] = await Promise.all([
      this.store.read(valuePath(id)), this.store.read(legacyLeaf('identities', id)),
    ]);
    if (value?.state === 'closed') return null;
    const key = value?.accountKey || legacy?.accountKey;
    if (!key) return null;
    if (legacy && legacy.accountKey !== key) return null;
    if (!/^[a-f0-9]{64}$/.test(key)) throw inconsistent();
    const [index, legacyClosed] = await Promise.all([
      this.store.read(accountPath(key)), this.store.read(legacyLeaf('closed', key)),
    ]);
    if (legacyClosed || ['closing', 'closed'].includes(index?.state)) return null;
    if (value) {
      if (value.schemaVersion !== 2 || value.state !== 'active') throw inconsistent();
      if (index?.state === 'active' && index.identityId === id) return { ...value, identityId: id, source: 'partitioned' };
    }
    if (index?.state === 'active' && index.identityId !== id) return null;
    const linked = await this.store.read(legacyLeaf('accounts', key));
    return linked === id ? { schemaVersion: 1, identityId: id, accountKey: key, source: 'legacy' } : null;
  }

  async alias(id, scopeId, participantId) {
    const profile = await this.scopeProfile(id, scopeId, [participantId]);
    return Object.hasOwn(profile?.names || {}, participantId) ? profile.names[participantId] : null;
  }

  async scopeProfile(id, scopeId, participantIds) {
    identityId(id); competitionId(scopeId);
    if (!Array.isArray(participantIds)) throw competitionError('Choose scope participants.');
    participantIds.forEach(competitionId);
    const profile = await this.profile(id); if (!profile) return null;
    const aliases = Object.hasOwn(profile.aliases || {}, scopeId) ? profile.aliases[scopeId] || {} : {};
    const entries = [], participants = [...new Set(participantIds)];
    for (let offset = 0; offset < participants.length; offset += 8) {
      entries.push(...await Promise.all(participants.slice(offset, offset + 8).map(async participantId => {
        if (Object.hasOwn(aliases, participantId)) return [participantId, aliases[participantId]];
        const previous = await this.store.read(legacyLeaf('aliases', `${scopeId}_${participantId}`));
        return [participantId, previous?.identityId === id ? previous.name : null];
      })));
    }
    return { identityId: id, names: Object.fromEntries(entries.filter(([, name]) => typeof name === 'string')) };
  }

  async memberships(id) {
    const profile = await this.profile(id); if (!profile) return [];
    const previous = await this.store.read(legacyLeaf('scopes', id));
    return [...new Set([...Object.keys(previous || {}), ...Object.keys(profile.scopes || {})])].sort();
  }

  async setAlias(id, scopeId, participantId, name) {
    identityId(id); competitionId(scopeId); competitionId(participantId);
    const text = cleanText(name, 'Your name');
    const profile = await this.profile(id); if (!profile) throw closed();
    if (await this.resolveKey(profile.accountKey, true) !== id) throw unavailable();
    await this.store.update(valuePath(id), row => {
      if (row?.state !== 'active') throw closed();
      if (row.accountKey !== profile.accountKey) throw inconsistent();
      const scopeAliases = Object.hasOwn(row.aliases || {}, scopeId) ? row.aliases[scopeId] : {};
      if (Object.hasOwn(scopeAliases, participantId) && scopeAliases[participantId] === text && row.scopes?.[scopeId] === true) return row;
      return { ...row, aliases: { ...row.aliases, [scopeId]: { ...scopeAliases, [participantId]: text } },
        scopes: { ...row.scopes, [scopeId]: true } };
    });
  }

  async controlAuthority(id, kind, scopeId) {
    const profile = await this.profile(id); if (!profile) throw closed();
    if (await this.resolveKey(profile.accountKey, true) !== id) throw unavailable();
    return this.controlAuthorization.prepare(id, kind, scopeId);
  }

  async beginTableClaim(id, key, binding, { intent = null, guard } = {}) {
    identityId(id); tableClaimKey(key); const value = tableClaimTarget(binding);
    if (intent !== null) competitionId(intent);
    if (guard !== undefined && typeof guard !== 'function') throw new TypeError('A Table claim guard must be a function.');
    const profile = await this.profile(id); if (!profile) throw closed();
    if (await this.resolveKey(profile.accountKey, true) !== id) throw unavailable();
    const requestHash = digest({ identityId: id, key, binding: value, intent });
    const candidate = { key, binding: value, operationId: `claim_${randomBytes(18).toString('base64url')}`, state: 'pending' };
    const observedRevision = authorizationRevision(await this.store.read(accountPath(profile.accountKey)));
    const index = await this.store.update(accountPath(profile.accountKey), row => {
      if (row?.state !== 'active' || row.identityId !== id) throw closed();
      guard?.();
      const previous = row.tableClaims?.[requestHash];
      if (previous) {
        if (previous.control) throw setupPending();
        if (previous.key !== key || digest(tableClaimTarget(previous.binding)) !== digest(value)
          || !['pending', 'committed'].includes(previous.state) || !/^claim_[\w-]+$/.test(previous.operationId || '')) throw inconsistent();
        return row;
      }
      if (authorizationRevision(row) !== observedRevision) throw setupPending();
      return { ...row, authorizationRevision: observedRevision + 1,
        tableClaims: { ...row.tableClaims, [requestHash]: candidate } };
    });
    return { ...index.tableClaims[requestHash], requestHash, accountKey: profile.accountKey, identityId: id };
  }

  async commitTableClaim(ticket, { guard } = {}) {
    if (ticket.control) throw setupPending();
    if (guard !== undefined && typeof guard !== 'function') throw new TypeError('A Table claim guard must be a function.');
    if (!await this.tableClaims.reserved(ticket.key, ticket.binding, ticket.operationId)) {
      throw competitionError('The host must finish linking this Table.', 409, 'TABLE_SETUP_PENDING');
    }
    const index = await this.store.update(accountPath(ticket.accountKey), row => {
      if (row?.state !== 'active' || row.identityId !== ticket.identityId) throw closed();
      guard?.();
      const previous = row.tableClaims?.[ticket.requestHash];
      if (previous?.control) throw setupPending();
      if (!previous || previous.operationId !== ticket.operationId || previous.key !== ticket.key
        || !['pending', 'committed'].includes(previous.state)
        || digest(tableClaimTarget(previous.binding)) !== digest(tableClaimTarget(ticket.binding))) throw inconsistent();
      if (previous.state === 'committed') return row;
      return { ...row, authorizationRevision: authorizationRevision(row) + 1,
        tableClaims: { ...row.tableClaims, [ticket.requestHash]: { ...previous, state: 'committed' } } };
    });
    return { ...ticket, ...index.tableClaims[ticket.requestHash], state: 'committed' };
  }

  async finishTableClaim(ticket) {
    if (ticket.control) throw setupPending();
    await this.store.update(accountPath(ticket.accountKey), row => {
      const previous = row?.tableClaims?.[ticket.requestHash];
      if (previous?.control) throw setupPending();
      if (row?.state !== 'active' || previous?.operationId !== ticket.operationId || previous.state !== 'committed') return row;
      const next = { ...row, authorizationRevision: authorizationRevision(row) + 1,
        tableClaims: { ...row.tableClaims } }; delete next.tableClaims[ticket.requestHash];
      if (!Object.keys(next.tableClaims).length) delete next.tableClaims;
      return next;
    });
  }

  async eraseAccount(accountId) { return this.eraseKey(accountKey(accountId)); }

  async eraseKey(key) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw inconsistent();
    const previous = await this.store.read(legacyLeaf('accounts', key));
    let closing = await this.store.update(accountPath(key), row => {
      if (row?.state === 'closed') return row;
      const ids = [...(row?.identityIds || []), ...(row?.reservedIds || []), ...(row?.identityId ? [row.identityId] : []), ...(previous ? [previous] : [])];
      return { schemaVersion: 2, state: 'closing', identityIds: [...new Set(ids.map(identityId))],
        authorizationRevision: authorizationRevision(row),
        ...(row?.tableClaims ? { tableClaims: structuredClone(row.tableClaims) } : {}),
        ...(row?.controlOperations ? { controlOperations: structuredClone(row.controlOperations) } : {}),
        ...(row?.erasureScopes ? { erasureScopes: structuredClone(row.erasureScopes) } : {}),
        ...(row?.frozenIdentities ? { frozenIdentities: structuredClone(row.frozenIdentities) } : {}) };
    });
    if (closing.state === 'closed') return { erased: true };
    await this.store.update(legacyLeaf('closed', key), current => current === true ? current : true);
    // Freeze and record the final legacy ID after fencing its creator. Otherwise
    // root cleanup could remove the only discoverable link before it is tombstoned.
    const currentLegacy = await this.store.read(legacyLeaf('accounts', key));
    const currentOwner = currentLegacy ? await this.store.read(legacyLeaf('identities', identityId(currentLegacy))) : null;
    if (currentOwner?.accountKey === key) {
      closing = await this.store.update(accountPath(key), row => {
        if (row?.state === 'closed') return row;
        if (row?.state !== 'closing') throw inconsistent();
        if ((row.identityIds || []).includes(currentLegacy)) return row;
        return { ...row, identityIds: [...(row.identityIds || []), currentLegacy] };
      });
    }
    if (closing.state === 'closed') return { erased: true };
    for (const id of closing.identityIds || []) {
      const scopes = await this.freezeOwnedValue(key, id);
      closing = await this.store.update(accountPath(key), row => {
        if (row?.state === 'closed') return row;
        if (row?.state !== 'closing') throw inconsistent();
        const combined = { ...row.erasureScopes?.[id], ...scopes }, erasureScopes = { ...row.erasureScopes };
        if (Object.keys(combined).length) erasureScopes[id] = combined;
        else delete erasureScopes[id];
        const { erasureScopes: previous, ...rest } = row;
        return { ...rest, frozenIdentities: { ...row.frozenIdentities, [id]: true },
          ...(Object.keys(erasureScopes).length ? { erasureScopes } : {}) };
      });
      await this.closeOwnedValue(key, id);
    }
    const legacyOwners = await Promise.all((closing.identityIds || []).map(async id =>
      [id, await this.store.read(legacyLeaf('identities', id))]));
    if (currentLegacy || legacyOwners.some(([, owner]) => owner?.accountKey === key)) {
      await this.store.update(legacyRoot, current => {
        const next = structuredClone(current || { schemaVersion: 1 });
        const candidates = new Set([...(closing.identityIds || []), ...(next.accounts?.[key] ? [next.accounts[key]] : [])]);
        const owned = new Set([...candidates].filter(id => next.identities?.[id]?.accountKey === key));
        next.closed = { ...next.closed, [key]: true };
        if (next.accounts) delete next.accounts[key];
        for (const id of owned) { delete next.identities[id]; if (next.scopes) delete next.scopes[id]; }
        for (const [aliasKey, alias] of Object.entries(next.aliases || {})) {
          if (owned.has(alias.identityId)) delete next.aliases[aliasKey];
        }
        return next;
      });
    }
    for (const [identity, scopes] of Object.entries(closing.erasureScopes || {})) {
      for (const scopeId of Object.keys(scopes || {})) {
        await this.erasureControl.fence(scopeId.startsWith('pod_') ? 'pod' : 'tournament', scopeId, identity);
        await this.store.update(accountPath(key), row => {
          if (row?.state === 'closed' || !row?.erasureScopes?.[identity]?.[scopeId]) return row;
          if (row.state !== 'closing') throw inconsistent();
          const next = { ...row, erasureScopes: { ...row.erasureScopes, [identity]: { ...row.erasureScopes[identity] } } };
          delete next.erasureScopes[identity][scopeId];
          if (!Object.keys(next.erasureScopes[identity]).length) delete next.erasureScopes[identity];
          if (!Object.keys(next.erasureScopes).length) delete next.erasureScopes;
          return next;
        });
      }
    }
    let current = await this.store.read(accountPath(key));
    for (const ticket of Object.values(current?.controlOperations || {})) {
      await this.tableSetup.resolve(ticketReference(ticket), { cancel: true });
      const progress = await this.controlStore.resume(ticket.kind, ticket.id);
      if (progress.pending) throw competitionError('Account erasure still has recoverable work.', 503, 'ERASURE_PENDING');
    }
    current = await this.store.read(accountPath(key));
    for (const ticket of Object.values(current?.tableClaims || {})) {
      if (ticket.control) throw competitionError('Compound Table erasure still has recoverable group work.', 503, 'ERASURE_PENDING');
      await this.tableClaims.settleErasure(ticket);
    }
    await this.store.update(accountPath(key), row => {
      if (isClosedRow(row)) return row;
      if (row?.state !== 'closing') throw inconsistent();
      if ((row.identityIds || []).some(id => !row.frozenIdentities?.[id]) || Object.keys(row.erasureScopes || {}).length
        || Object.keys(row.controlOperations || {}).length
        || Object.entries(row.tableClaims || {}).some(([hash, ticket]) => JSON.stringify(ticket) !== JSON.stringify(current?.tableClaims?.[hash]))) {
        throw competitionError('Account erasure still has recoverable work.', 503, 'ERASURE_PENDING');
      }
      return closedRow();
    });
    return { erased: true };
  }

  async resumeErasures(options) {
    const page = await this.store.page('competitions-v2/accounts.json', options);
    let processed = 0;
    for (const { key, value } of page.items) {
      if (value.state !== 'closing') continue;
      await this.eraseKey(key); processed++;
    }
    return { processed, nextCursor: page.nextCursor };
  }
}
