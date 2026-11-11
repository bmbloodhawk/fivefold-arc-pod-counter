import { createHmac, randomBytes } from 'node:crypto';
import { competitionError, cleanText, digest, scopePath } from './competitions.js';
import { tournamentPoints, POINT_UNIT } from './competition-scoring.js';
import { suggestSeating, validateSeating } from './tournament-seating.js';

const RULES = 'Points: 3 × (table size − average finishing rank) ÷ (table size − 1). Ties share occupied placement points; equal final points share a placing. Timed rounds finish the current turn, then five additional turns total (including extra-turn effects). Surviving players then share the remaining top placement points after host confirmation. Tournament results never change Pod ratings.';
const integer = (value, min, max, name) => {
  if (!Number.isInteger(value) || value < min || value > max) throw competitionError(`${name} must be ${min}–${max}.`);
  return value;
};
const attending = scope => Object.values(scope.members).filter(row => row.participating && row.status === 'active');
const lastRound = scope => scope.rounds.at(-1);

export class Tournaments {
  constructor({ domain }) { this.domain = domain; this.tables = null; }
  actor(scope, auth, directory, options) { return this.tables.actor(scope, auth, directory, options); }
  async create(accountId, { name, displayName, rounds = 3, preferredSize = 4, priority = 'new_opponents', minutes = null } = {}) {
    const title = cleanText(name, 'Tournament name'); const yourName = cleanText(displayName, 'Your name');
    integer(rounds, 1, 20, 'Rounds'); integer(preferredSize, 2, 8, 'Table size');
    if (!['new_opponents', 'standings'].includes(priority)) throw competitionError('Choose a seating priority.');
    if (minutes !== null) integer(minutes, 1, 240, 'Round minutes');
    const identityId = await this.domain.identity(accountId, yourName);
    const id = `event_${this.domain.createId()}`, hostId = `entrant_${this.domain.createId()}`;
    await this.domain.setAlias(identityId, id, hostId, yourName);
    await this.domain.store.update(scopePath('tournament', id), current => {
      if (current) throw competitionError('Try creating this event again.', 409);
      return { schemaVersion: 1, id, kind: 'tournament', name: title, creatorId: hostId,
        createdAt: this.domain.now(), version: 1, status: 'registration',
        settings: { rounds, preferredSize, priority, minutes },
        members: { [hostId]: { id: hostId, identityId, kind: 'member', role: 'admin', status: 'active', participating: false } },
        invites: {}, tables: {}, games: {}, standings: {}, rounds: [], audit: [], joinRequests: {} };
    });
    return this.get({ accountId }, id);
  }
  async get(auth, id) {
    const scope = await this.domain.readScope('tournament', id); const directory = await this.domain.directory();
    const me = this.actor(scope, auth, directory);
    const members = Object.values(scope.members).map(row => ({
      id: row.id, name: this.domain.name(directory, scope.id, row), kind: row.kind, role: row.role,
      status: row.identityId && !directory.identities[row.identityId] ? 'deleted' : row.status,
      participating: row.participating, provenance: row.kind === 'guest' ? `${row.provenance}_guest` : 'signed_in_entrant',
      ...(scope.standings[row.id] || { points: 0, pointsUnits: 0, gamesPlayed: 0, wins: 0 }),
    }));
    const standings = members.filter(row => row.participating && !['pending', 'declined'].includes(row.status))
      .sort((a, b) => b.pointsUnits - a.pointsUnits || a.name.localeCompare(b.name));
    standings.forEach((row, index) => { row.rank = index && row.pointsUnits === standings[index - 1].pointsUnits ? standings[index - 1].rank : index + 1; });
    return { id: scope.id, kind: 'tournament', name: scope.name, status: scope.status, version: scope.version,
      me: me.id, role: me.role, creatorId: scope.creatorId, settings: scope.settings, rules: RULES,
      members, standings, serverNow: this.domain.now(),
      rounds: scope.rounds.map(round => ({ id: round.id, number: round.number, status: round.status,
        seatingStale: Boolean(round.seatingStale), startedAt: round.startedAt || null, endsAt: round.endsAt || null,
        assignments: round.assignments.map(row => ({ id: row.id, participantIds: row.participantIds, hostId: row.hostId,
          gameId: row.gameId || null, cancelled: Boolean(row.cancelled), clock: row.clock || null,
          roomCode: Object.values(scope.tables).find(table => table.assignmentId === row.id)?.roomCode || null })) })),
    };
  }
  async join(accountId, token, { displayName, requestId } = {}) {
    const name = cleanText(displayName, 'Your name');
    const parsed = this.domain.parseInvite(token);
    if (parsed.kind !== 'tournament') throw competitionError('This invite is for a Pod.');
    const previewScope = await this.domain.readScope('tournament', parsed.id);
    const invitation = this.domain.validInvite(previewScope, parsed.secretHash);
    const identityId = accountId ? await this.domain.identity(accountId, name) : null;
    const directory = await this.domain.directory();
    if (!directory.identities[previewScope.members[invitation.by].identityId]) throw competitionError('That invite is unavailable.', 404);
    if (!accountId && (typeof requestId !== 'string' || !/^[\w-]{8,100}$/.test(requestId))) throw competitionError('A guest entry retry identifier is required.');
    const candidateId = `entrant_${this.domain.createId()}`;
    const joinKey = digest(`${invitation.id}:${requestId}`);
    const guestToken = !accountId ? createHmac('sha256', token).update(requestId).digest('base64url') : null;
    const scope = await this.domain.changeScope('tournament', parsed.id, state => {
      this.domain.validInvite(state, parsed.secretHash);
      if (lastRound(state)?.status === 'playing' || state.status === 'completed') throw competitionError('Entries open before play or between rounds.', 409, 'ENTRY_BETWEEN_ROUNDS');
      const existing = identityId ? Object.values(state.members).find(row => row.identityId === identityId)
        : state.members[state.joinRequests[joinKey]];
      if (existing?.participating) return;
      const memberId = existing?.id || candidateId;
      if (Object.values(state.members).filter(row => row.participating).length >= 128) throw competitionError('This event is full (128 entrants).', 409);
      state.members[memberId] = { ...(existing || {}), id: memberId, identityId, kind: accountId ? 'member' : 'guest',
        role: existing?.role || 'participant', participating: true,
        status: state.rounds.some(round => round.startedAt) ? 'pending' : 'active',
        ...(!accountId ? { guestAccessHash: digest(guestToken), provenance: 'self_named' } : {}) };
      if (!accountId) state.joinRequests[joinKey] = memberId;
      if (lastRound(state)?.status === 'draft') lastRound(state).seatingStale = true;
    });
    const member = identityId ? Object.values(scope.members).find(row => row.identityId === identityId) : scope.members[scope.joinRequests[joinKey]];
    if (identityId) await this.domain.setAlias(identityId, scope.id, member.id, name);
    else await this.domain.changeDirectory(state => {
      state.aliases[`${scope.id}_${member.id}`] ??= { identityId: null, name }; return state;
    });
    const auth = identityId ? { accountId } : { guestToken };
    return { ...(await this.get(auth, scope.id)), ...(guestToken ? { guestToken } : {}) };
  }
  async addGuest(auth, id, { displayName, requestId = randomBytes(16).toString('hex') } = {}) {
    const name = cleanText(displayName, 'Guest name'); const directory = await this.domain.directory();
    const guestId = `entrant_${this.domain.createId()}`; const key = digest(`host:${requestId}`);
    const scope = await this.domain.changeScope('tournament', id, state => {
      this.actor(state, auth, directory, { admin: true });
      if (state.joinRequests[key]) return;
      if (lastRound(state)?.status === 'playing' || state.status === 'completed') throw competitionError('Add guests before play or between rounds.', 409);
      if (Object.values(state.members).filter(row => row.participating).length >= 128) throw competitionError('This event is full.', 409);
      state.members[guestId] = { id: guestId, kind: 'guest', role: 'participant', participating: true,
        status: 'active', provenance: 'organizer_attested' };
      state.joinRequests[key] = guestId;
      if (lastRound(state)?.status === 'draft') lastRound(state).seatingStale = true;
    });
    const actor = this.actor(scope, auth, directory, { admin: true });
    await this.domain.changeDirectory(state => {
      if (actor.identityId && !state.identities[actor.identityId]) throw competitionError('Account data was removed.', 403);
      state.aliases[`${id}_${scope.joinRequests[key]}`] = { identityId: actor.identityId, name }; return state;
    });
    return this.get(auth, id);
  }
  async memberAction(auth, id, { action, targetId, enabled } = {}) {
    const directory = await this.domain.directory();
    await this.domain.changeScope('tournament', id, scope => {
      const me = this.actor(scope, auth, directory); const target = scope.members[targetId || me.id];
      if (!target) throw competitionError('Choose an event entrant.');
      if (action === 'leave' && (target.id === me.id || me.role === 'admin')) {
        target.status = 'left';
      } else {
        this.actor(scope, auth, directory, { admin: true });
        if (action === 'approve' && target.status === 'pending') target.status = 'active';
        else if (action === 'cohost' && me.id === scope.creatorId && typeof enabled === 'boolean'
          && target.kind === 'member' && directory.identities[target.identityId] && target.status === 'active') target.role = enabled ? 'admin' : 'participant';
        else throw competitionError('Choose a valid event action.');
      }
      if (lastRound(scope)?.status === 'draft') lastRound(scope).seatingStale = true;
      this.domain.audit(scope, action, me.id, target.id);
    });
    return this.get(auth, id);
  }
  async guestAccess(auth, id, targetId) {
    const directory = await this.domain.directory(); const guestToken = randomBytes(32).toString('base64url');
    await this.domain.changeScope('tournament', id, scope => {
      this.actor(scope, auth, directory, { admin: true }); const guest = scope.members[targetId];
      if (guest?.kind !== 'guest' || !['active', 'pending', 'left'].includes(guest.status)) throw competitionError('Choose a guest entrant.');
      guest.guestAccessHash = digest(guestToken);
    });
    return { eventId: id, guestToken };
  }
  async cancelUnplayedTable(auth, id, assignmentId) {
    const directory = await this.domain.directory();
    await this.domain.changeScope('tournament', id, scope => {
      this.actor(scope, auth, directory, { admin: true }); const assignment = this.assignment(scope, assignmentId);
      const hasStart = Object.values(scope.tables).some(table => Object.values(table.captures).some(command =>
        command.assignmentId === assignmentId && ['accepted', 'captured'].includes(command.status)));
      if (hasStart || assignment.gameId) throw competitionError('A started Table must finish and confirm its result.', 409);
      assignment.cancelled = true;
      this.applyStandings(scope);
    });
    return this.get(auth, id);
  }
  assignment(scope, id) {
    const result = scope.rounds.flatMap(round => round.assignments).find(row => row.id === id);
    if (!result) throw competitionError('That Table assignment is unavailable.', 404);
    return result;
  }
  checkTableBinding(scope, participantId, assignmentId) {
    const round = lastRound(scope); const assignment = this.assignment(scope, assignmentId);
    if (!round?.assignments.includes(assignment) || !['draft', 'playing'].includes(round.status) || assignment.cancelled || assignment.gameId) throw competitionError('Choose an unplayed Table in the current round.', 409);
    if (assignment.hostId !== participantId) throw competitionError('The assigned Table host must link this Table.', 403);
  }
  checkStartedRoster(scope, assignmentId, participantIds) {
    const round = lastRound(scope); const assignment = this.assignment(scope, assignmentId);
    if (round.status !== 'playing' || !round.assignments.includes(assignment)) throw competitionError('The tournament host must start this round first.', 409, 'ROUND_NOT_STARTED');
    if (assignment.participantIds.length !== participantIds.length || assignment.participantIds.some(id => !participantIds.includes(id))) throw competitionError('The actual starters must match the reviewed Table assignment.', 409, 'ASSIGNMENT_MISMATCH');
  }
  async prepareRound(auth, id) {
    const directory = await this.domain.directory(); const roundId = `round_${this.domain.createId()}`;
    const seed = randomBytes(16).toString('hex');
    const assignmentIds = Array.from({ length: 64 }, () => `assignment_${this.domain.createId()}`);
    await this.domain.changeScope('tournament', id, scope => {
      this.actor(scope, auth, directory, { admin: true });
      const previous = lastRound(scope);
      if (previous?.status === 'playing') throw competitionError('Confirm every Table before preparing the next round.', 409);
      if (previous?.status === 'draft' && !previous.seatingStale) return;
      if (scope.rounds.filter(round => round.status === 'complete').length >= scope.settings.rounds) throw competitionError('All planned rounds are complete.', 409);
      const participants = attending(scope).filter(row => row.kind === 'guest' || directory.identities[row.identityId])
        .map(row => ({ id: row.id, pointsUnits: scope.standings[row.id]?.pointsUnits || 0 }));
      const number = previous?.status === 'draft' ? previous.number : scope.rounds.length + 1;
      const previousTables = scope.rounds.filter(round => round.status === 'complete').flatMap(round =>
        round.assignments.filter(row => !row.cancelled).map(row => row.participantIds));
      const seating = suggestSeating({ participants, previousTables, preferredSize: scope.settings.preferredSize,
        priority: scope.settings.priority, roundNumber: number, seed });
      const round = { id: previous?.status === 'draft' ? previous.id : roundId, number, status: 'draft', seed, seatingStale: false,
        assignments: seating.map((ids, index) => ({ id: assignmentIds[index], participantIds: ids, hostId: ids[0] })) };
      if (previous?.status === 'draft') scope.rounds[scope.rounds.length - 1] = round;
      else scope.rounds.push(round);
      scope.status = 'between_rounds';
    });
    return this.get(auth, id);
  }
  async editSeating(auth, id, { roundId, baseVersion, tables } = {}) {
    const directory = await this.domain.directory();
    const assignmentIds = Array.from({ length: 64 }, () => `assignment_${this.domain.createId()}`);
    await this.domain.changeScope('tournament', id, scope => {
      this.actor(scope, auth, directory, { admin: true }); const round = lastRound(scope);
      if (scope.version !== baseVersion || round?.id !== roundId || round.status !== 'draft') throw competitionError('Review the current unstarted round before editing.', 409, 'VERSION_CONFLICT');
      const ids = attending(scope).filter(row => row.kind === 'guest' || directory.identities[row.identityId]).map(row => row.id);
      validateSeating(tables, ids);
      round.assignments = tables.map((group, index) => ({ id: assignmentIds[index], participantIds: [...group], hostId: group[0] }));
      round.seatingStale = false;
    });
    return this.get(auth, id);
  }
  async startRound(auth, id, { roundId, baseVersion } = {}) {
    const directory = await this.domain.directory();
    await this.domain.changeScope('tournament', id, scope => {
      this.actor(scope, auth, directory, { admin: true }); const round = lastRound(scope);
      if (round?.id === roundId && round.status === 'playing') return;
      if (scope.version !== baseVersion || round?.id !== roundId || round.status !== 'draft' || round.seatingStale) throw competitionError('Review the current seating before starting.', 409, 'VERSION_CONFLICT');
      validateSeating(round.assignments.map(row => row.participantIds), attending(scope).filter(row => row.kind === 'guest' || directory.identities[row.identityId]).map(row => row.id));
      round.status = 'playing'; round.startedAt = this.domain.now();
      round.endsAt = scope.settings.minutes ? round.startedAt + scope.settings.minutes * 60_000 : null;
      scope.status = 'playing';
    });
    return this.get(auth, id);
  }
  recordCaptured(scope, assignmentId, gameId) {
    const assignment = this.assignment(scope, assignmentId);
    if (assignment.gameId && assignment.gameId !== gameId) throw competitionError('That round’s Table already has a game.', 409);
    assignment.gameId = gameId;
  }
  applyStandings(scope) {
    const standings = {};
    for (const game of Object.values(scope.games)) {
      if (!game.revisions.length) continue;
      const order = game.revisions.at(-1).order;
      for (const points of tournamentPoints(order, game.starterIds)) {
        const row = standings[points.id] ??= { pointsUnits: 0, points: 0, gamesPlayed: 0, wins: 0 };
        row.pointsUnits += points.pointsUnits; row.points = row.pointsUnits / POINT_UNIT; row.gamesPlayed++;
        if (order[0].length === 1 && order[0][0] === points.id) row.wins++;
      }
    }
    scope.standings = standings;
    for (const round of scope.rounds) {
      if (round.status !== 'playing') continue;
      if (round.assignments.every(row => row.cancelled || scope.games[row.gameId]?.revisions.length)) round.status = 'complete';
    }
    if (lastRound(scope)?.status === 'complete') scope.status = scope.rounds.length === scope.settings.rounds ? 'completed' : 'between_rounds';
    if (lastRound(scope)?.status === 'draft') lastRound(scope).seatingStale = true;
  }
  async clock(auth, id, assignmentId, { action, requestId } = {}) {
    if (typeof requestId !== 'string' || !/^[\w-]{8,100}$/.test(requestId)) throw competitionError('A turn retry identifier is required.');
    const directory = await this.domain.directory();
    await this.domain.changeScope('tournament', id, scope => {
      const me = this.actor(scope, auth, directory); const assignment = this.assignment(scope, assignmentId);
      const round = scope.rounds.find(row => row.assignments.includes(assignment));
      if (me.role !== 'admin' && me.id !== assignment.hostId) throw competitionError('This Table host or an event host must record the turn.', 403);
      if (!round.endsAt || round.status !== 'playing' || assignment.gameId || assignment.cancelled) throw competitionError('This timed Table is not playing.', 409);
      assignment.clockActions ??= {};
      if (assignment.clockActions[requestId]) {
        if (assignment.clockActions[requestId] !== action) throw competitionError('Conflicting turn retry.', 409);
        return;
      }
      if (action === 'time_called') {
        if (this.domain.now() < round.endsAt) throw competitionError('Round time has not ended.', 409);
        assignment.clock ??= { phase: 'current_turn', remaining: 5 };
      } else if (action === 'finish_turn') {
        if (!assignment.clock || assignment.clock.phase === 'done') throw competitionError('Call time first, then record each actual turn.', 409);
        if (assignment.clock.phase === 'current_turn') assignment.clock.phase = 'extra_turns';
        else if (--assignment.clock.remaining === 0) assignment.clock.phase = 'done';
      } else throw competitionError('Choose a valid clock action.');
      assignment.clockActions[requestId] = action;
    });
    return this.get(auth, id);
  }
}
