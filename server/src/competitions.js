import { createHash, randomBytes } from 'node:crypto';
import { coordinateCompetitionWrites } from './competition-write-coordinator.js';

export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export function competitionError(message, status = 400, code = 'COMPETITION_INPUT') {
  return Object.assign(new Error(message), { status, code });
}
export function cleanText(value, label, max = 80) {
  if (typeof value !== 'string' || /[\p{Cc}\p{Cf}<>]/u.test(value)) throw competitionError(`${label} must be printable text.`);
  const text = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (!text || Array.from(text).length > max) throw competitionError(`${label} must contain 1–${max} characters.`);
  return text;
}
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
const requiredId = id => {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw competitionError('Invalid competition identifier.');
  return id;
};
const active = member => member?.status === 'active';

// Identity writes live exclusively in the directory. Numerical scope records never
// contain account IDs, names, or correction free text. A closed account cannot be
// recreated by queued setup/capture work after an erasure.
export class Competitions {
  constructor({ store, now = () => Date.now(), createId = () => randomBytes(18).toString('base64url') } = {}) {
    if (!store?.read || !store?.update) throw new TypeError('Competition storage requires conditional updates.');
    this.store = coordinateCompetitionWrites(store); this.now = now; this.createId = createId;
  }

  async directory() { return normalizeDirectory(await this.store.read(directoryPath)); }
  async changeDirectory(change) {
    return normalizeDirectory(await this.store.update(directoryPath, current => change(structuredClone(normalizeDirectory(current)))));
  }
  async identity(accountId, createName) {
    if (!accountId) throw competitionError('Sign in to join a Pod.', 401, 'SIGN_IN_REQUIRED');
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
    const text = cleanText(name, 'Your name');
    await this.changeDirectory(directory => {
      if (!directory.identities[identityId]) throw competitionError('Account data was removed.', 403, 'IDENTITY_CLOSED');
      directory.aliases[`${scopeId}_${participantId}`] = { identityId, name: text };
      (directory.scopes[identityId] ??= {})[scopeId] = true;
      return directory;
    });
  }
  name(directory, scopeId, member) {
    return directory.aliases[`${scopeId}_${member.id}`]?.name || (member.kind === 'guest' ? 'Guest' : 'Deleted member');
  }
  async readScope(kind, id) {
    if (!['pod', 'tournament'].includes(kind)) throw competitionError('Unknown competition kind.');
    const scope = await this.store.read(scopePath(kind, requiredId(id)));
    if (!scope) throw competitionError('That private group or event is unavailable.', 404, 'COMPETITION_NOT_FOUND');
    return normalizeScope(scope);
  }
  async changeScope(kind, id, change) {
    const result = await this.store.update(scopePath(kind, requiredId(id)), current => {
      if (!current) throw competitionError('That private group or event is unavailable.', 404, 'COMPETITION_NOT_FOUND');
      const next = normalizeScope(current);
      if (change(next) === false) return current;
      next.version++;
      return next;
    });
    return normalizeScope(result);
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
      pendingGames: Object.values(scope.games).filter(game => !game.revisions.length).length,
    };
  }

  async createPod(accountId, { name, displayName } = {}) {
    const title = cleanText(name, 'Pod name'); const memberName = cleanText(displayName, 'Your name');
    const identityId = await this.identity(accountId, memberName);
    const id = `pod_${this.createId()}`; const memberId = `member_${this.createId()}`;
    await this.setAlias(identityId, id, memberId, memberName);
    await this.store.update(scopePath('pod', id), current => {
      if (current) throw competitionError('Please try creating that Pod again.', 409);
      return {
        schemaVersion: 1, id, kind: 'pod', name: title, createdAt: this.now(), version: 1,
        members: { [memberId]: { id: memberId, identityId, kind: 'member', role: 'admin', status: 'active', joinedAt: this.now() } },
        invites: {}, tables: {}, games: {}, standings: {}, audit: [],
      };
    });
    return this.getPod(accountId, id);
  }
  async getPod(accountId, id) {
    const identityId = await this.identity(accountId);
    const scope = await this.readScope('pod', id); const directory = await this.directory();
    if (!directory.identities[identityId]) throw competitionError('Account data was removed.', 403);
    return this.podDto(scope, directory, identityId);
  }
  async list(accountId) {
    // First-time account users have no memberships; reads never create an identity.
    const directory = await this.directory();
    const identityId = directory.accounts[digest(accountId || '')];
    if (!accountId || !identityId || !directory.identities[identityId]) return { pods: [], tournaments: [] };
    const result = { pods: [], tournaments: [] };
    for (const id of Object.keys(directory.scopes[identityId] || {})) {
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
    });
    return { id: inviteId, token: `${kind}.${id}.${secret}`, expiresAt };
  }
  async listInvites(accountId, kind, id) {
    const identityId = await this.identity(accountId); const scope = await this.readScope(kind, id);
    const directory = await this.directory();
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
    });
    return { revoked: true };
  }
  async preview(token) {
    const { kind, id, secretHash } = this.parseInvite(token);
    const scope = await this.readScope(kind, id); const invite = this.validInvite(scope, secretHash);
    const directory = await this.directory();
    if (!directory.identities[scope.members[invite.by].identityId]) throw competitionError('That invite is unavailable.', 404);
    return { kind, id, name: scope.name, inviter: this.name(directory, id, scope.members[invite.by]), expiresAt: invite.expiresAt };
  }
  async joinPod(accountId, token, { displayName } = {}) {
    const name = cleanText(displayName, 'Your name');
    const { kind, id, secretHash } = this.parseInvite(token);
    if (kind !== 'pod') throw competitionError('Use this invite’s tournament entry screen.');
    const identityId = await this.identity(accountId, name);
    const directory = await this.directory();
    const candidateId = `member_${this.createId()}`;
    const scope = await this.changeScope('pod', id, state => {
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
    });
    const member = Object.values(scope.members).find(item => item.identityId === identityId);
    await this.setAlias(identityId, id, member.id, name);
    return this.getPod(accountId, id);
  }
  async podMemberAction(accountId, id, { action, targetId, enabled, name } = {}) {
    const identityId = await this.identity(accountId);
    const directory = await this.directory();
    await this.changeScope('pod', id, scope => {
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
    });
    return action === 'leave' ? { left: true } : this.getPod(accountId, id);
  }

  async eraseAccount(accountId) {
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
  };
}
