import { competitionError, digest } from './competition-values.js';
import { coordinateCompetitionWrites } from './competition-write-coordinator.js';

const pending = () => competitionError('Account erasure still has recoverable group work.', 503, 'ERASURE_PENDING');
function erasedRows(members, invites, identityId, role) {
  const owned = Object.values(members || {}).filter(member => member?.identityId === identityId);
  const participants = new Set(owned.map(member => member.id));
  return [
    ...owned.map(member => ({ section: 'members', key: member.id, value: { ...member, status: 'erased', role } })),
    ...Object.entries(invites || {}).filter(([, invite]) => invite && participants.has(invite.by))
      .map(([key, invite]) => ({ section: 'invites', key, value: { ...invite, revoked: true } })),
  ];
}

// Per-identity frozen scope references drive erasure; never enumerate groups or
// history from here. Historical index completeness is a separate rollout gate.
export class CompetitionErasureControl {
  constructor({ store, control, accounts } = {}) {
    this.store = coordinateCompetitionWrites(store); this.control = control; this.accounts = accounts;
  }

  async fence(kind, id, identityId) {
    const root = `competitions-v2/groups/${id}`, marker = `erased_${identityId}`;
    const legacyPath = `competitions/${kind === 'pod' ? 'pods' : 'tournaments'}/${id}.json`;
    const legacy = await this.store.read(legacyPath);
    if (legacy) {
      await this.store.update(legacyPath, current => {
        if (!current || current.erasedIdentities?.[identityId]) return current;
        const next = structuredClone(current);
        for (const row of erasedRows(next.members, next.invites, identityId, kind === 'pod' ? 'member' : 'participant')) next[row.section][row.key] = row.value;
        next.erasedIdentities = { ...next.erasedIdentities, [identityId]: true };
        next.version++;
        return next;
      });
      return;
    }
    await this.control.register(kind, id);
    for (let attempt = 0; attempt < 8; attempt++) {
      let head = await this.store.read(`${root}/head.json`);
      if (!head) {
        head = await this.store.update(`${root}/head.json`, current => current || {
          schemaVersion: 2, kind, id, version: 1, keys: {}, unavailable: true,
        });
      }
      const actor = head.pending?.authorization || head.settling;
      if (actor?.identityId === identityId) await this.accounts.resolve(actor, { cancel: true });
      const progress = await this.control.resume(kind, id);
      if (progress.pending) throw pending();
      if (progress.unavailable) return;
      const state = await this.control.read(kind, id, { sections: ['members', 'invites', 'work'] });
      const remaining = erasedRows(state.rows.members, state.rows.invites, identityId, kind === 'pod' ? 'member' : 'participant')
        .filter(row => JSON.stringify(state.rows[row.section][row.key]) !== JSON.stringify(row.value));
      if (!remaining.length && state.rows.work[marker]?.throughVersion <= state.version) return;
      const changes = []; let bytes = 0;
      for (const row of remaining) {
        const size = Buffer.byteLength(JSON.stringify(row));
        if (changes.length === 512 || bytes + size > 900000) break;
        changes.push(row); bytes += size;
      }
      const complete = changes.length === remaining.length && changes.length < 512;
      if (complete) changes.push({ section: 'work', key: marker,
        value: { type: 'identity_erasure', identityId, throughVersion: state.version + 1 } });
      try {
        await this.control.begin(kind, id, { operationId: `control_erasure_${digest({ id, identityId, version: state.version }).slice(0, 48)}`,
          baseVersion: state.version, changes });
        await this.control.resume(kind, id);
        if (complete) return;
      } catch (error) {
        if (!['CONTROL_VERSION_CONFLICT', 'CONTROL_PENDING'].includes(error.code)) throw error;
      }
    }
    throw pending();
  }
}
