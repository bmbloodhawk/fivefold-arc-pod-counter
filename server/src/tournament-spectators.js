import { randomBytes } from 'node:crypto';
import { competitionError, digest } from './competitions.js';
import { POINT_UNIT, tournamentPoints } from './competition-scoring.js';

const DAY_MS = 86_400_000;
const unavailable = () => competitionError('This event viewing link is unavailable. Ask an event host for a new link.', 403, 'EVENT_VIEWER_ACCESS');
const organizer = (member, directory) => member?.kind === 'member' && ['active', 'left'].includes(member.status)
  && member.role === 'admin' && Boolean(directory.identities[member.identityId]);
const activeLink = (scope, directory, now) => scope.spectatorLink?.expiresAt > now
  && organizer(scope.members[scope.spectatorLink.by], directory);

// This capability is distinct from entrant access and seat ownership. Only its
// hash is stored; every read rechecks the issuing organizer and returns an allowlist.
export class TournamentSpectators {
  constructor({ domain, tournaments }) { this.domain = domain; this.tournaments = tournaments; }

  requireOrganizer(scope, auth, directory) {
    const actor = this.tournaments.actor(scope, auth, directory, { admin: true });
    if (!auth?.accountId || !organizer(actor, directory)) throw competitionError('A signed-in event host is required.', 403, 'COMPETITION_ACCESS');
    return actor;
  }

  async metadata(auth, id) {
    const scope = await this.domain.readScope('tournament', id);
    const directory = await this.domain.directory(scope, auth);
    this.requireOrganizer(scope, auth, directory);
    const active = Boolean(activeLink(scope, directory, this.domain.now()));
    return { eventId: id, active, expiresAt: active ? scope.spectatorLink.expiresAt : null };
  }

  async change(auth, id, input = {}) {
    const action = input && typeof input === 'object' && !Array.isArray(input) ? input.action : null;
    if (!['create', 'revoke'].includes(action)) throw competitionError('Choose create or revoke for the viewing link.');
    const directory = await this.domain.scopeDirectory('tournament', id, auth);
    const viewerToken = action === 'create' ? randomBytes(32).toString('base64url') : null;
    const expiresAt = this.domain.now() + DAY_MS;
    await this.domain.changeScope('tournament', id, scope => {
      const actor = this.requireOrganizer(scope, auth, directory);
      if (action === 'create') scope.spectatorLink = { secretHash: digest(viewerToken), by: actor.id, expiresAt };
      else delete scope.spectatorLink;
      this.domain.audit(scope, `spectator_link_${action}`, actor.id);
    }, { auth });
    return action === 'create' ? { eventId: id, viewerToken, expiresAt } : { eventId: id, active: false, expiresAt: null };
  }

  async board(id, viewerToken) {
    if (typeof viewerToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(viewerToken)) throw unavailable();
    const scope = await this.domain.readScope('tournament', id);
    if (scope.spectatorLink?.secretHash !== digest(viewerToken) || scope.spectatorLink.expiresAt <= this.domain.now()) throw unavailable();
    const directory = await this.domain.directory(scope);
    const serverNow = this.domain.now();
    if (!activeLink(scope, directory, serverNow)) throw unavailable();
    const alias = id => {
      const member = scope.members[id];
      if (!member) return 'Former entrant';
      if (member.kind === 'member' && !directory.identities[member.identityId]) return 'Deleted member';
      return this.domain.name(directory, scope.id, member);
    };
    const resultCounts = { total: 0, confirmed: 0, awaitingConfirmation: 0, playing: 0, cancelled: 0 };
    const rounds = scope.rounds.map(round => ({ number: round.number, status: round.status,
      startedAt: round.startedAt ?? null, endsAt: round.endsAt ?? null,
      assignments: round.assignments.map((assignment, index) => {
        const game = scope.games[assignment.gameId];
        const started = Object.values(scope.tables).some(table => Object.values(table.captures).some(command =>
          command.assignmentId === assignment.id && command.status === 'accepted'));
        const status = assignment.cancelled ? 'cancelled' : game?.revisions.length ? 'confirmed'
          : game ? 'awaiting_confirmation' : started ? 'playing' : 'ready';
        resultCounts.total++;
        if (status === 'awaiting_confirmation') resultCounts.awaitingConfirmation++;
        else if (status !== 'ready') resultCounts[status]++;
        return { tableNumber: index + 1, status, participants: assignment.participantIds.map(alias),
          clock: assignment.clock ? { phase: assignment.clock.phase, remaining: assignment.clock.remaining } : null };
      }),
    }));
    const totals = {};
    for (const game of Object.values(scope.games)) {
      const revision = game.revisions.at(-1);
      if (!revision) continue;
      for (const points of tournamentPoints(revision.order, game.starterIds)) {
        const row = totals[points.id] ??= { pointsUnits: 0, gamesPlayed: 0 };
        row.pointsUnits += points.pointsUnits; row.gamesPlayed++;
      }
    }
    const standings = Object.values(scope.members).filter(member => member.participating && !['pending', 'declined'].includes(member.status))
      .map(member => ({ alias: alias(member.id), points: (totals[member.id]?.pointsUnits || 0) / POINT_UNIT,
        gamesPlayed: totals[member.id]?.gamesPlayed || 0 }))
      .sort((a, b) => b.points - a.points || a.alias.localeCompare(b.alias));
    standings.forEach((row, index) => { row.rank = index && row.points === standings[index - 1].points ? standings[index - 1].rank : index + 1; });
    const current = rounds.at(-1);
    return { name: scope.name, status: scope.status, plannedRounds: scope.settings.rounds, roundNumber: current?.number || 0,
      serverNow, expiresAt: scope.spectatorLink.expiresAt,
      timing: { startedAt: current?.startedAt ?? null, endsAt: current?.endsAt ?? null }, rounds, resultCounts, standings };
  }
}
