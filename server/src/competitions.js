import { randomBytes } from 'node:crypto';
import { coordinateCompetitionWrites } from './competition-write-coordinator.js';
import { cleanText, competitionError, competitionId as requiredId, digest } from './competition-values.js';
import { CompetitionDirectoryView } from './competition-directory-view.js';
import { CompetitionTableClaims } from './competition-table-claims.js';
export { cleanText, competitionError, digest } from './competition-values.js';
const blankDirectory = () => ({ schemaVersion: 1, accounts: {}, identities: {}, closed: {}, aliases: {}, scopes: {}, tables: {} });
const normalizeDirectory = input => ({ ...blankDirectory(), ...(input || {}) });
const array = value => Array.isArray(value) ? value.filter(item => item != null) : Object.values(value || {});
function normalizeScope(input) {
  const scope = structuredClone(input);
  for (const key of ['members', 'invites', 'tables', 'games', 'standings', 'joinRequests']) scope[key] ||= {};
  scope.audit = array(scope.audit); scope.rounds = array(scope.rounds);
  for (const table of Object.values(scope.tables)) {
    table.seats = Object.fromEntries(Object.entries(table.seats || {}).filter(([, seat]) => seat));
    table.captures ||= {};
    for (const command of Object.values(table.captures)) {
      command.seats = array(command.seats); command.eligibleIds = array(command.eligibleIds);
    }
  }
  for (const game of Object.values(scope.games)) {
    game.revisions = array(game.revisions); game.ratingChanges = array(game.ratingChanges);
    game.eligibleIds = array(game.eligibleIds); game.seats = array(game.seats);
    game.original = { winnerId: null, inferredOrder: null, ...game.original };
  }
  for (const round of scope.rounds) round.assignments = array(round.assignments);
  return scope;
}
export const scopePath = (kind, id) => `competitions/${kind === 'pod' ? 'pods' : 'tournaments'}/${id}.json`;
const directoryPath = 'competitions/directory.json';
const active = member => member?.status === 'active';

// Numerical scope records never contain account IDs, names, or correction free
// text. The optional identity store selects scoped storage during integration;
// deployment keeps the legacy default until the compatible-writer rollout gate.
export class Competitions {
  constructor({ store, now = () => Date.now(), createId = () => randomBytes(18).toString('base64url'), identityStore = null,
    scopeStore = null, createPartitionedGroups = Boolean(scopeStore) } = {}) {
    if (!store?.read || !store?.update) throw new TypeError('Competition storage requires conditional updates.');
    this.store = coordinateCompetitionWrites(store); this.now = now; this.createId = createId;
    this.identityStore = identityStore;
    if (scopeStore && !identityStore) throw new TypeError('Partitioned group control requires scoped identities.');
    this.scopeStore = scopeStore;
    this.createPartitionedGroups = createPartitionedGroups;
    this.directoryView = identityStore ? new CompetitionDirectoryView({ store: this.store, identities: identityStore }) : null;
    this.tableClaims = identityStore ? new CompetitionTableClaims({ store: this.store }) : null;
    this.directoryContexts = new WeakMap();
  }

  async directory(scope, auth, options) {
    if (!this.directoryView) return normalizeDirectory(await this.store.read(directoryPath));
    const directory = await this.directoryView.read(scope, auth, options);
    this.directoryContexts.set(directory, { scopeId: scope.id, auth, options, complete: true,
      identities: new Set(Object.values(scope.members || {}).map(member => member.identityId).filter(Boolean)) });
    return directory;
  }
  async scopeDirectory(kind, id, auth, options) { return this.directory(await this.readScope(kind, id), auth, options); }
  async participantDirectory(scope, auth, participantIds) {
    const members = Object.fromEntries(participantIds.filter(id => scope.members[id]).map(id => [id, scope.members[id]]));
    const directory = await this.directory({ ...scope, members }, auth, { participantIds });
    if (this.directoryView) this.directoryContexts.get(directory).complete = false;
    return directory;
  }
  assertDirectory(scope, directory) {
    const context = this.directoryContexts.get(directory);
    if (!context?.complete) return;
    if (context.scopeId !== scope.id) throw new TypeError('A scoped identity view belongs to a different group.');
    if (Object.values(scope.members).some(member => member.identityId && !context.identities.has(member.identityId))) {
      throw Object.assign(new Error('The group roster changed during setup.'), { staleDirectory: { directory, scope } });
    }
  }
  async changeDirectory(change) {
    if (this.identityStore) throw new TypeError('Scoped storage does not allow global directory mutations.');
    return normalizeDirectory(await this.store.update(directoryPath, current => change(structuredClone(normalizeDirectory(current)))));
  }
  async identity(accountId, createName) {
    if (!accountId) throw competitionError('Sign in to join a Pod.', 401, 'SIGN_IN_REQUIRED');
    if (this.identityStore) {
      if (createName !== undefined) return this.identityStore.identity(accountId, createName);
      const id = await this.identityStore.lookup(accountId);
      if (!id) throw competitionError('You do not have access to this group.', 403, 'COMPETITION_ACCESS');
      return id;
    }
    const key = digest(accountId);
    if (createName !== undefined) {
      cleanText(createName, 'Your name');
      const id = `identity_${this.createId()}`;
      const dir = await this.changeDirectory(directory => {
        if (directory.closed[key]) throw competitionError('This account’s group data was removed. Sign out and sign in again.', 403, 'IDENTITY_CLOSED');
        if (!directory.accounts[key]) {
          directory.accounts[key] = id;
          directory.identities[id] = { accountKey: key };
        }
        return directory;
      });
      return dir.accounts[key];
    }
    const directory = await this.directory();
    if (directory.closed[key] || !directory.accounts[key]) throw competitionError('You do not have access to this group.', 403, 'COMPETITION_ACCESS');
    return directory.accounts[key];
  }

  async setAlias(identityId, scopeId, participantId, name) {
    if (this.identityStore) return this.identityStore.setAlias(identityId, scopeId, participantId, name);
    const text = cleanText(name, 'Your name');
    await this.changeDirectory(directory => {
      if (!directory.identities[identityId]) throw competitionError('Account data was removed.', 403, 'IDENTITY_CLOSED');
      directory.aliases[`${scopeId}_${participantId}`] = { identityId, name: text };
      (directory.scopes[identityId] ??= {})[scopeId] = true;
      return directory;
    });
  }
  async setGuestAlias(scopeId, participantId, name, { identityId = null, ...options } = {}) {
    return this.setGuestAliases(scopeId, [{ participantId, identityId, name }], options);
  }
  async setGuestAliases(scopeId, entries, { actorIdentityId = null, preserveExisting = false } = {}) {
    const names = entries.map(entry => ({ ...entry, name: cleanText(entry.name, 'Guest name'), identityId: entry.identityId || null }));
    if (this.directoryView) {
      if (actorIdentityId && !await this.identityStore.profile(actorIdentityId)) throw competitionError('Account data was removed.', 403, 'IDENTITY_CLOSED');
      return Promise.all(names.map(({ participantId, identityId, name }) => this.directoryView.setGuestAlias(scopeId, participantId, name, { identityId, preserveExisting })));
    }
    return this.changeDirectory(directory => {
      if (actorIdentityId && !directory.identities[actorIdentityId]) throw competitionError('Account data was removed.', 403, 'IDENTITY_CLOSED');
      for (const { participantId, identityId, name } of names) {
        const key = `${scopeId}_${participantId}`;
        if (!preserveExisting || !directory.aliases[key]) directory.aliases[key] = {
          identityId, name: identityId && !directory.identities[identityId] ? 'Deleted member' : name,
        };
      }
      return directory;
    });
  }
  async tableBinding(key, directory) {
    return this.tableClaims ? this.tableClaims.read(key) : (directory || await this.directory()).tables[key] || null;
  }
  async claimTable(key, binding, { guard, actorIdentityId, intent } = {}) {
    if (this.tableClaims) {
      if (!actorIdentityId) return this.tableClaims.claim(key, binding, { guard });
      const ticket = await this.identityStore.beginTableClaim(actorIdentityId, key, binding, { intent, guard });
      await this.tableClaims.reserve(key, binding, { ...ticket, guard });
      const decision = await this.identityStore.commitTableClaim(ticket, { guard });
      const result = await this.tableClaims.publish(key, binding, decision);
      await this.identityStore.finishTableClaim(decision);
      return result;
    }
    await this.changeDirectory(directory => {
      guard?.();
      const current = directory.tables[key];
      if (current && (current.kind !== binding.kind || current.id !== binding.id)) throw competitionError('This Table already belongs to another competition.', 409, 'TABLE_ALREADY_LINKED');
      if (actorIdentityId && !directory.identities[actorIdentityId]) throw competitionError('Account data was removed.', 403);
      directory.tables[key] = binding; return directory;
    });
    return binding;
  }
  name(directory, scopeId, member) {
    return directory.aliases[`${scopeId}_${member.id}`]?.name || (member.kind === 'guest' ? 'Guest' : 'Deleted member');
  }
  async readScope(kind, id) {
    if (!['pod', 'tournament'].includes(kind)) throw competitionError('Unknown competition kind.');
    const scope = await this.store.read(scopePath(kind, requiredId(id)));
    if (!scope && this.scopeStore) return normalizeScope(await this.scopeStore.read(kind, id));
    if (!scope) throw competitionError('That private group or event is unavailable.', 404, 'COMPETITION_NOT_FOUND');
    return normalizeScope(scope);
  }
  async changeScope(kind, id, change, options = {}) {
    const path = scopePath(kind, requiredId(id));
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        if (this.scopeStore && !await this.store.read(path)) {
          const accountId = typeof options.auth === 'string' ? options.auth : options.auth?.accountId;
          const actorIdentityId = options.actorIdentityId || (accountId ? await this.identity(accountId) : undefined);
          return normalizeScope(await this.scopeStore.change(kind, id, change, { ...options, actorIdentityId }));
        }
        return normalizeScope(await this.store.update(path, current => {
          if (!current) throw competitionError('That private group or event is unavailable.', 404, 'COMPETITION_NOT_FOUND');
          const next = normalizeScope(current);
          if (change(next) === false) return current;
          next.version++;
          return next;
        }));
      } catch (error) {
        const stale = error.staleDirectory, context = stale && this.directoryContexts.get(stale.directory);
        if (!context || context.scopeId !== id) throw error;
        const fresh = await this.directory(stale.scope, context.auth, context.options);
        Object.assign(stale.directory, fresh);
        this.directoryContexts.set(stale.directory, this.directoryContexts.get(fresh));
      }
    }
    throw competitionError('The group roster is changing. Review it and try again.', 409, 'ROSTER_CHANGED');
  }
  async createScope(kind, id, create, options = {}) {
    const path = scopePath(kind, requiredId(id));
    if (this.scopeStore && this.createPartitionedGroups) {
      const existing = await this.store.read(path);
      if (existing) { create(existing); throw competitionError('That private group or event already exists.', 409); }
      return this.scopeStore.create(kind, id, create(null), options);
    }
    return this.store.update(path, create);
  }
  member(scope, identityId, { admin = false } = {}) {
    const member = Object.values(scope.members).find(item => item.identityId === identityId);
    const canAdminEvent = scope.kind === 'tournament' && member?.status === 'left' && member.role === 'admin';
    if ((!active(member) && !canAdminEvent) || (admin && member.role !== 'admin')) {
      throw competitionError(admin ? 'An active admin is required.' : 'You are not an active member.', 403, 'COMPETITION_ACCESS');
    }
    return member;
  }
  audit(scope, action, actorId, targetId = null) {
    scope.audit.push({ action, actorId, targetId, at: this.now() });
  }
  podDto(scope, directory, identityId) {
    const me = this.member(scope, identityId);
    const members = Object.values(scope.members).filter(member => member.kind !== 'guest').map(member => ({
      id: member.id, name: this.name(directory, scope.id, member), role: member.role,
      status: directory.identities[member.identityId] ? member.status : 'deleted',
      ...(scope.standings?.[member.id] || { rating: 1000, gamesPlayed: 0, ratedGames: 0, wins: 0, provisional: true }),
    })).sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
    return {
      id: scope.id, kind: 'pod', name: scope.name, createdAt: scope.createdAt, version: scope.version,
      me: me.id, role: me.role, members,
      audit: scope.audit.slice(-30).map(item => ({ ...item,
        actor: this.name(directory, scope.id, scope.members[item.actorId] || { id: item.actorId }),
      })),
      pendingGames: scope.storageFormat ? scope.pendingGames : Object.values(scope.games).filter(game => !game.revisions.length).length,
    };
  }

  async createPod(accountId, { name, displayName } = {}) {
    const title = cleanText(name, 'Pod name'); const memberName = cleanText(displayName, 'Your name');
    const identityId = await this.identity(accountId, memberName);
    const id = `pod_${this.createId()}`; const memberId = `member_${this.createId()}`;
    await this.setAlias(identityId, id, memberId, memberName);
    await this.createScope('pod', id, current => {
      if (current) throw competitionError('Please try creating that Pod again.', 409);
      return {
        schemaVersion: 1, id, kind: 'pod', name: title, createdAt: this.now(), version: 1,
        members: { [memberId]: { id: memberId, identityId, kind: 'member', role: 'admin', status: 'active', joinedAt: this.now() } },
        invites: {}, tables: {}, games: {}, standings: {}, audit: [],
      };
    }, { actorIdentityId: identityId });
    return this.getPod(accountId, id);
  }
  async getPod(accountId, id) {
    const identityId = await this.identity(accountId);
    const scope = await this.readScope('pod', id); const directory = await this.directory(scope, accountId);
    if (!directory.identities[identityId]) throw competitionError('Account data was removed.', 403);
    return this.podDto(scope, directory, identityId);
  }
  async list(accountId) {
    // First-time account users have no memberships; reads never create an identity.
    if (!accountId) return { pods: [], tournaments: [] };
    const directory = this.identityStore ? null : await this.directory();
    const identityId = this.identityStore ? await this.identityStore.lookup(accountId) : directory.accounts[digest(accountId)];
    if (!identityId || (directory && !directory.identities[identityId])) return { pods: [], tournaments: [] };
    const scopes = this.identityStore ? await this.identityStore.memberships(identityId) : Object.keys(directory.scopes[identityId] || {});
    const result = { pods: [], tournaments: [] };
    for (const id of scopes) {
      const kind = id.startsWith('pod_') ? 'pod' : 'tournament';
      let scope;
      try { scope = await this.readScope(kind, id); }
      catch (error) { if (error.status === 404) continue; throw error; }
      const me = Object.values(scope.members).find(item => item.identityId === identityId
        && (kind === 'pod' ? active(item) : ['active', 'pending', 'left'].includes(item.status)));
      if (!me) continue;
      result[kind === 'pod' ? 'pods' : 'tournaments'].push({ id, kind, name: scope.name, role: me.role, status: scope.status || 'active' });
    }
    return result;
  }

  parseInvite(token) {
    if (typeof token !== 'string' || token.length > 240) throw competitionError('That invite is unavailable.', 404);
    const [kind, id, secret, extra] = token.split('.');
    if (extra || !['pod', 'tournament'].includes(kind) || !id || !secret || !/^[\w-]+$/.test(secret)) {
      throw competitionError('That invite is unavailable.', 404);
    }
    return { kind, id: requiredId(id), secretHash: digest(secret) };
  }
  validInvite(scope, secretHash) {
    const invite = Object.values(scope.invites).find(item => item.secretHash === secretHash);
    const inviter = scope.members[invite?.by];
    const hostWhoStoppedPlaying = scope.kind === 'tournament' && inviter?.role === 'admin' && inviter.status === 'left';
    if (!invite || invite.revoked || invite.expiresAt <= this.now() || (!active(inviter) && !hostWhoStoppedPlaying)) {
      throw competitionError('That invite has expired or was revoked.', 404, 'INVITE_UNAVAILABLE');
    }
    return invite;
  }
  async invite(accountId, kind, id) {
    const identityId = await this.identity(accountId);
    const inviteId = `invite_${this.createId()}`;
    const secret = randomBytes(24).toString('base64url');
    const expiresAt = this.now() + 7 * 86_400_000;
    await this.changeScope(kind, id, scope => {
      const me = this.member(scope, identityId, { admin: kind === 'tournament' });
      scope.invites[inviteId] = { id: inviteId, secretHash: digest(secret), by: me.id,
        adminIssued: me.role === 'admin', issuedVersion: scope.version, createdAt: this.now(), expiresAt };
    }, { actorIdentityId: identityId });
    return { id: inviteId, token: `${kind}.${id}.${secret}`, expiresAt };
  }
  async listInvites(accountId, kind, id) {
    const identityId = await this.identity(accountId); const scope = await this.readScope(kind, id);
    const directory = await this.directory(scope, accountId);
    if (!directory.identities[identityId]) throw competitionError('Account data was removed.', 403, 'COMPETITION_ACCESS');
    const me = this.member(scope, identityId, { admin: kind === 'tournament' });
    const invites = Object.values(scope.invites).filter(row => me.role === 'admin' || row.by === me.id).map(row => {
      const issuer = scope.members[row.by];
      const available = issuer && directory.identities[issuer.identityId]
        && (active(issuer) || (kind === 'tournament' && issuer.role === 'admin' && issuer.status === 'left'));
      return { id: row.id, issuer: this.name(directory, id, issuer || { id: row.by }),
        createdAt: row.createdAt || row.expiresAt - 7 * 86_400_000, expiresAt: row.expiresAt,
        status: row.revoked ? 'revoked' : row.expiresAt <= this.now() ? 'expired' : available ? 'active' : 'unavailable' };
    }).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
    return { invites };
  }
  async revokeInvite(accountId, kind, id, inviteId) {
    const identityId = await this.identity(accountId);
    await this.changeScope(kind, id, scope => {
      const me = this.member(scope, identityId);
      const invite = scope.invites[requiredId(inviteId)];
      if (!invite || (invite.by !== me.id && me.role !== 'admin')) throw competitionError('You cannot revoke that invite.', 403);
      invite.revoked = true;
    }, { actorIdentityId: identityId });
    return { revoked: true };
  }
  async preview(token) {
    const { kind, id, secretHash } = this.parseInvite(token);
    const scope = await this.readScope(kind, id); const invite = this.validInvite(scope, secretHash);
    const inviter = scope.members[invite.by];
    const directory = await this.directory({ ...scope, members: { [inviter.id]: inviter } });
    if (!directory.identities[scope.members[invite.by].identityId]) throw competitionError('That invite is unavailable.', 404);
    return { kind, id, name: scope.name, inviter: this.name(directory, id, scope.members[invite.by]), expiresAt: invite.expiresAt };
  }
  async joinPod(accountId, token, { displayName } = {}) {
    const name = cleanText(displayName, 'Your name');
    const { kind, id, secretHash } = this.parseInvite(token);
    if (kind !== 'pod') throw competitionError('Use this invite’s tournament entry screen.');
    const identityId = await this.identity(accountId, name);
    const directory = await this.scopeDirectory('pod', id, accountId);
    const candidateId = `member_${this.createId()}`;
    const scope = await this.changeScope('pod', id, state => {
      this.assertDirectory(state, directory);
      const invite = this.validInvite(state, secretHash);
      if (!directory.identities[state.members[invite.by].identityId]) throw competitionError('That invite is unavailable.', 404);
      const existing = Object.values(state.members).find(member => member.identityId === identityId);
      if (existing?.status === 'removed' && (!invite.adminIssued || state.members[invite.by].role !== 'admin'
        || invite.issuedVersion <= existing.removedVersion)) {
        throw competitionError('An admin must send you a new invite to return.', 403, 'ADMIN_READMISSION_REQUIRED');
      }
      if (existing) {
        if (existing.status !== 'active') existing.role = 'member';
        existing.status = 'active';
      }
      else state.members[candidateId] = { id: candidateId, identityId, kind: 'member', role: 'member', status: 'active', joinedAt: this.now() };
    }, { actorIdentityId: identityId });
    const member = Object.values(scope.members).find(item => item.identityId === identityId);
    await this.setAlias(identityId, id, member.id, name);
    return this.getPod(accountId, id);
  }
  async podMemberAction(accountId, id, { action, targetId, enabled, name } = {}) {
    const identityId = await this.identity(accountId);
    const directory = await this.scopeDirectory('pod', id, accountId);
    await this.changeScope('pod', id, scope => {
      this.assertDirectory(scope, directory);
      const me = this.member(scope, identityId);
      if (action === 'leave') {
        me.status = 'left'; me.role = 'member'; this.audit(scope, 'member_left', me.id); return;
      }
      if (action === 'takeover') {
        if (Object.values(scope.members).some(member => active(member) && member.role === 'admin' && directory.identities[member.identityId])) {
          throw competitionError('This Pod already has an active admin.', 409, 'ADMIN_PRESENT');
        }
        me.role = 'admin'; this.audit(scope, 'admin_takeover', me.id); return;
      }
      this.member(scope, identityId, { admin: true });
      if (action === 'rename') {
        scope.name = cleanText(name, 'Pod name'); this.audit(scope, 'pod_renamed', me.id); return;
      }
      const target = scope.members[requiredId(targetId)];
      if (!active(target)) throw competitionError('Choose an active member.');
      if (action === 'remove') {
        if (target.id === me.id) throw competitionError('Use Leave Pod for your own membership.');
        target.status = 'removed'; target.role = 'member'; target.removedVersion = scope.version;
        this.audit(scope, 'member_removed', me.id, target.id);
      } else if (action === 'admin' && typeof enabled === 'boolean') {
        target.role = enabled ? 'admin' : 'member'; this.audit(scope, enabled ? 'admin_appointed' : 'admin_removed', me.id, target.id);
      } else throw competitionError('Choose a valid member action.');
    }, { actorIdentityId: identityId });
    return action === 'leave' ? { left: true } : this.getPod(accountId, id);
  }

  async eraseAccount(accountId) {
    if (this.identityStore) return this.identityStore.eraseAccount(accountId);
    const key = digest(accountId);
    await this.changeDirectory(directory => {
      const identityId = directory.accounts[key];
      directory.closed[key] = true;
      delete directory.accounts[key];
      if (identityId) {
        delete directory.identities[identityId]; delete directory.scopes[identityId];
        for (const [aliasKey, alias] of Object.entries(directory.aliases)) {
          if (alias.identityId === identityId) delete directory.aliases[aliasKey];
        }
      }
      return directory;
    });
    return { erased: true };
  }
}

// Use a distinct adapter/instance from room recovery and private history. The
// production wiring is opt-in; disabled competitions leave ordinary play alone.
export function competitionStoreForEnvironment(store, environment) {
  const prefix = environment === 'production' ? '' : `${requiredId(environment)}/`;
  return {
    read: path => store.read(prefix + path),
    update: (path, change) => store.update(prefix + path, change),
    ...(typeof store.page === 'function' ? { page: (path, options) => store.page(prefix + path, options) } : {}),
  };
}
