import { cleanText, competitionError, competitionId, digest } from './competition-values.js';
import { coordinateCompetitionWrites } from './competition-write-coordinator.js';

const guestPath = (scope, participant) => `competitions-v2/guest-aliases/${scope}/${participant}.json`;
const legacyPath = (scope, participant) => `competitions/directory/aliases/${scope}_${participant}.json`;
const storageConflict = () => competitionError('The stored guest alias is inconsistent.', 503, 'ALIAS_STORAGE_CONFLICT');
const ownerConflict = () => competitionError('This guest name belongs to a different identity.', 409, 'ALIAS_OWNER_CONFLICT');
function ownerIdentity(id) {
  competitionId(id);
  if (!id.startsWith('identity_')) throw competitionError('Invalid group identity.');
  return id;
}
function guestRecord(value, native = false) {
  if (value == null) return null;
  try {
    if (native && value.schemaVersion !== 2) throw storageConflict();
    const identityId = value.identityId == null ? null : ownerIdentity(value.identityId);
    if (identityId && native && Object.hasOwn(value, 'name')) throw storageConflict();
    if (!identityId && typeof value.name !== 'string') throw storageConflict();
    return { identityId, ...(!identityId ? { name: value.name } : {
      erasedBeforeName: native ? value.erasedBeforeName === true : value.name === 'Deleted member',
    }) };
  } catch { throw storageConflict(); }
}
async function inBatches(values, limit, action) {
  for (let offset = 0; offset < values.length; offset += limit) await Promise.all(values.slice(offset, offset + limit).map(action));
}

// Private name/identity lookup for explicit setup and completed-game views only.
// The consumer must authorize the caller before returning any player-facing DTO.
export class CompetitionDirectoryView {
  constructor({ store, identities, concurrency = 8 } = {}) {
    if (!store?.read || !store?.update || !identities?.lookup || !identities?.scopeProfile || !identities?.setAlias) {
      throw new TypeError('Scoped views require identity and conditional name storage.');
    }
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new TypeError('Lookup concurrency must be 1–16.');
    this.store = coordinateCompetitionWrites(store); this.identities = identities; this.concurrency = concurrency;
  }

  async read(scope, auth, { participantIds = [] } = {}) {
    competitionId(scope?.id);
    if (!['pod', 'tournament'].includes(scope.kind) || !Array.isArray(participantIds)) throw competitionError('Choose scope participants.');
    participantIds.forEach(competitionId);
    const requested = new Set(participantIds), profiles = new Map();
    const directory = { accounts: Object.create(null), identities: Object.create(null), aliases: Object.create(null) };
    const add = (id, participant) => {
      ownerIdentity(id);
      if (!profiles.has(id)) profiles.set(id, new Set());
      if (participant) profiles.get(id).add(participant);
    };
    const accountId = typeof auth === 'string' ? auth : auth?.accountId;
    let actorId;
    if (accountId) {
      actorId = await this.identities.lookup(accountId);
      if (actorId) add(actorId);
    }
    const members = Object.values(scope.members || {}).filter(member => member
      && (member.kind === 'member' || scope.kind === 'tournament' || requested.has(member.id)));
    for (const member of members) if (member.kind === 'member' && member.identityId) add(member.identityId, member.id);
    await inBatches(members.filter(member => member.kind === 'guest'), this.concurrency, async member => {
      const record = await this.#guestRecord(scope.id, competitionId(member.id));
      if (record?.identityId) {
        add(record.identityId, member.id);
        if (record.erasedBeforeName) directory.aliases[`${scope.id}_${member.id}`] = { identityId: record.identityId, name: 'Deleted member' };
      }
      else if (record) directory.aliases[`${scope.id}_${member.id}`] = { identityId: null, name: record.name };
    });
    await inBatches([...profiles], this.concurrency, async ([id, participants]) => {
      const profile = await this.identities.scopeProfile(id, scope.id, [...participants]);
      if (!profile) return;
      directory.identities[id] = {};
      for (const participant of participants) if (Object.hasOwn(profile.names, participant)) {
        directory.aliases[`${scope.id}_${participant}`] = { identityId: id, name: profile.names[participant] };
      }
    });
    if (actorId && directory.identities[actorId]) directory.accounts[digest(accountId)] = actorId;
    return directory;
  }

  async #guestRecord(scope, participant) {
    const [current, previous] = await Promise.all([this.store.read(guestPath(scope, participant)), this.store.read(legacyPath(scope, participant))]);
    const next = guestRecord(current, true), legacy = guestRecord(previous);
    if (next && legacy && next.identityId !== legacy.identityId) throw storageConflict();
    return next || legacy;
  }

  async setGuestAlias(scope, participant, name, { identityId = null, preserveExisting = false } = {}) {
    competitionId(scope); competitionId(participant);
    const text = cleanText(name, 'Guest name'), owner = identityId == null ? null : ownerIdentity(identityId);
    if (typeof preserveExisting !== 'boolean') throw competitionError('Choose a guest name retry policy.');
    const previous = await this.#guestRecord(scope, participant);
    if (previous && previous.identityId !== owner) throw ownerConflict();
    await this.store.update(guestPath(scope, participant), current => {
      const existing = guestRecord(current, true);
      if (existing && existing.identityId !== owner) throw ownerConflict();
      if (owner) return current || { schemaVersion: 2, identityId: owner };
      const nextName = preserveExisting ? existing?.name ?? previous?.name ?? text : text;
      return existing?.name === nextName ? current : { schemaVersion: 2, name: nextName };
    });
    if (owner) {
      try { await this.identities.setAlias(owner, scope, participant, text); }
      catch (error) {
        if (error.code !== 'IDENTITY_CLOSED') throw error;
        // Preserve the existing erased-before-attestation label without storing
        // any identifying name outside the owner's permanently closed record.
        await this.store.update(guestPath(scope, participant), current => {
          if (guestRecord(current, true)?.identityId !== owner) throw ownerConflict();
          return current.erasedBeforeName ? current : { ...current, erasedBeforeName: true };
        });
      }
    }
  }
}
