import { randomBytes } from 'node:crypto';
import { competitionError, digest } from './competitions.js';
import { POINT_UNIT, tournamentPoints } from './competition-scoring.js';

const DAY_MS = 86_400_000;
const unavailable = () => competitionError('This event viewing link is unavailable. Ask an event host for a new link.', 403, 'EVENT_VIEWER_ACCESS');
const organizer = (member, directory) => member?.kind === 'member' && ['active', 'left'].includes(member.status)
  && member.role === 'admin' && Boolean(directory.identities[member.identityId]);
const activeLink = (scope, directory, now) => scope.spectatorLink?.expiresAt > now
  && organizer(scope.members[scope.spectatorLink.by], directory);
const identity = room => Buffer.from(room.hostRecoveryKeyHash || []).toString('base64');
const seatNumber = value => Number(value) + 1;
const resultReasons = new Set(['declared_winner', 'last_player_standing', 'timed_draw']);
const selector = value => {
  if (!/^[1-9]\d{0,5}$/.test(String(value)) || !['number', 'string'].includes(typeof value)) {
    throw competitionError('Choose a valid round and Table number.');
  }
  return Number(value);
};
function eliminationReason(seat, damage) {
  if (['milled_out', 'alternate_loss'].includes(seat.alternateElimination?.reason)) return seat.alternateElimination.reason;
  if (seat.counters.life <= 0) return 'life';
  if (seat.counters.poison >= 10) return 'poison';
  return damage.some(row => row.damage >= 21) ? 'commander_damage' : null;
}
function liveSeats(room, command, alias) {
  const commanders = command.seats.flatMap(row => {
    const seat = room.seats[Number(row.seatId)];
    return room.config.gameFormat === 'commander' ? Array.from({ length: seat.commanderCount }, (_, slot) => ({
      seatId: row.seatId, source: `seat-${row.seatId}-commander-${slot ? 'b' : 'a'}`, slot,
    })) : [];
  });
  return command.seats.map(row => {
    const seat = room.seats[Number(row.seatId)];
    const damage = commanders.map(source => ({ seatNumber: seatNumber(source.seatId), commanderNumber: source.slot + 1,
      damage: seat.commanderDamageReceived?.[source.source] || 0 }));
    const reason = eliminationReason(seat, damage);
    return { seatNumber: seatNumber(row.seatId), alias: alias(row.participantId),
      counters: Object.fromEntries(['life', 'radiation', 'poison', 'energy', 'generic'].map(key => [key, seat.counters[key] || 0])),
      commanders: commanders.filter(source => source.seatId === row.seatId).map(source => ({ commanderNumber: source.slot + 1,
        name: seat.commanderNames?.[source.slot] || '', colors: [...(seat.commanderColors?.[source.slot] || [])],
        castCount: seat.commanderCastCounts?.[source.source] || 0, tax: (seat.commanderCastCounts?.[source.source] || 0) * 2 })),
      commanderDamageReceived: damage, eliminated: Boolean(reason), eliminationReason: reason };
  }).sort((a, b) => a.seatNumber - b.seatNumber);
}
function watchResult(room, command, game, alias) {
  const frozen = room.completedGames?.find(row => row.gameId === command.gameId);
  const source = frozen?.source;
  const original = room.gameResult || (source?.tableIdentity === command.tableIdentity ? {
    reason: source.originalOutcome.reason, winnerSeatId: source.originalOutcome.winnerSeatId,
    placementGroups: source.inferredOrder, decidedAt: source.completedAt,
  } : null);
  if (!original) return null;
  const revision = game?.revisions.at(-1);
  const byParticipant = id => command.seats.find(row => row.participantId === id)?.seatId;
  const groups = revision ? revision.order.map(group => group.map(byParticipant))
    : original.placementGroups || original.finishingOrder?.map(id => [id]) || [];
  const winner = revision ? (groups[0]?.length === 1 ? groups[0][0] : null) : original.winnerSeatId;
  const winnerSeat = winner == null ? null : command.seats.find(row => row.seatId === String(winner));
  return { reason: resultReasons.has(original.reason) ? original.reason : null,
    winnerSeatNumber: winnerSeat ? seatNumber(winnerSeat.seatId) : null,
    winnerAlias: winnerSeat ? alias(winnerSeat.participantId) : null, decidedAt: original.decidedAt ?? frozen?.completedAt ?? null,
    placementGroups: groups.map(group => group.filter(id => command.seats.some(row => row.seatId === String(id))).map(seatNumber)) };
}

// This capability is distinct from entrant access and seat ownership. Only its
// hash is stored; every read rechecks the issuing organizer and returns an allowlist.
export class TournamentSpectators {
  constructor({ domain, tournaments, tables = null }) { this.domain = domain; this.tournaments = tournaments; this.tables = tables; }

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

  async access(id, viewerToken, selectedTable = null) {
    if (typeof viewerToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(viewerToken)) throw unavailable();
    const scope = await this.domain.readScope('tournament', id);
    if (scope.spectatorLink?.secretHash !== digest(viewerToken) || scope.spectatorLink.expiresAt <= this.domain.now()) throw unavailable();
    let selection = null;
    if (selectedTable) {
      const roundNumber = selector(selectedTable.roundNumber), tableNumber = selector(selectedTable.tableNumber);
      const round = scope.rounds.find(row => row.number === roundNumber), assignment = round?.assignments[tableNumber - 1];
      if (!assignment) throw competitionError('That event Table is unavailable.', 404);
      selection = { roundNumber, tableNumber, round, assignment };
    }
    const directory = selection
      ? await this.domain.participantDirectory(scope, null, [...new Set([scope.spectatorLink.by, ...selection.assignment.participantIds])])
      : await this.domain.directory(scope);
    const serverNow = this.domain.now();
    if (!activeLink(scope, directory, serverNow)) throw unavailable();
    const alias = id => {
      const member = scope.members[id];
      if (!member) return 'Former entrant';
      if (member.kind === 'member' && !directory.identities[member.identityId]) return 'Deleted member';
      return this.domain.name(directory, scope.id, member);
    };
    return { scope, serverNow, alias, selection };
  }

  async watch(id, viewerToken, input = {}) {
    const { scope, serverNow, alias, selection } = await this.access(id, viewerToken, input);
    const { roundNumber, tableNumber, round, assignment } = selection;
    const dto = { name: scope.name, roundNumber, tableNumber, status: 'unavailable', availabilityReason: 'room_unavailable',
      serverNow, expiresAt: scope.spectatorLink.expiresAt,
      timing: { startedAt: round.startedAt ?? null, endsAt: round.endsAt ?? null, phase: null, remaining: null },
      resultStatus: null, participants: assignment.participantIds.map(id => ({ seatNumber: null, alias: alias(id) })),
      hasLiveTotals: false, seats: [], turn: null, pendingFinish: null, result: null };
    if (assignment.cancelled) return { ...dto, status: 'cancelled', availabilityReason: 'cancelled' };
    const table = Object.values(scope.tables).find(row => row.assignmentId === assignment.id && !row.releasedAt);
    if (!table) {
      const started = assignment.gameId || Object.values(scope.tables).some(row => Object.values(row.captures).some(command =>
        command.assignmentId === assignment.id && ['accepted', 'captured', 'abandoned'].includes(command.status)));
      return started ? dto : { ...dto, status: 'ready', availabilityReason: 'not_started' };
    }
    // Inspect loaded memory only. Ordinary room reads can renew activity, finish
    // pending eliminations or recover storage; spectators must do none of those.
    const service = this.tables?.service, room = service?.rooms.get(table.roomCode);
    if (!room || !Number.isFinite(room.lastActiveAt) || serverNow - room.lastActiveAt > service.roomTtlMs) return dto;
    const roomIdentity = identity(room);
    if (!roomIdentity || room.code !== table.roomCode || digest(roomIdentity) !== table.key) {
      return { ...dto, availabilityReason: 'replaced' };
    }
    const command = table.captures[room.gameId];
    if (!command) {
      const previouslyStarted = assignment.gameId || Object.values(table.captures).some(row => row.assignmentId === assignment.id
        && ['accepted', 'captured', 'abandoned'].includes(row.status));
      return previouslyStarted ? { ...dto, availabilityReason: 'replaced' }
        : { ...dto, status: 'ready', availabilityReason: 'not_started' };
    }
    const sameRoster = command.seats.length === assignment.participantIds.length
      && new Set(command.seats.map(row => row.participantId)).size === command.seats.length
      && new Set(command.seats.map(row => row.seatId)).size === command.seats.length
      && command.seats.every(row => assignment.participantIds.includes(row.participantId) && /^\d+$/.test(row.seatId)
        && room.seats[Number(row.seatId)]);
    if (!['accepted', 'captured'].includes(command.status) || command.gameId !== room.gameId
      || command.assignmentId !== assignment.id || command.roomCode !== room.code || command.tableIdentity !== roomIdentity
      || (assignment.gameId && assignment.gameId !== command.gameId) || !sameRoster || command.resetIntent) {
      return { ...dto, availabilityReason: 'replaced' };
    }
    const game = scope.games[command.gameId];
    dto.participants = command.seats.map(row => ({ seatNumber: seatNumber(row.seatId), alias: alias(row.participantId) }))
      .sort((a, b) => a.seatNumber - b.seatNumber);
    if (assignment.clock?.sourceGameId === command.gameId) {
      dto.timing.phase = ['current_turn', 'extra_turns', 'done'].includes(assignment.clock.phase) ? assignment.clock.phase : null;
      dto.timing.remaining = assignment.clock.remaining ?? null;
    }
    dto.result = watchResult(room, command, game, alias);
    dto.resultStatus = dto.result ? (game?.revisions.length ? 'confirmed' : 'awaiting_confirmation') : null;
    // beginIntermission deliberately resets counters without changing gameId.
    // The immutable completion stores outcomes, not final current counters.
    if (!room.turn.gameStarted || room.lifecycle?.status === 'intermission') {
      return dto.result ? { ...dto, status: 'complete', availabilityReason: 'finished' } : dto;
    }
    if (!command.seats.every(row => room.seats[Number(row.seatId)].claimed
      && Buffer.from(room.seats[Number(row.seatId)].tokenHash || []).toString('base64') === row.ownerHash)
      || room.lifecycle.seatIds.length !== command.seats.length
      || !room.lifecycle.seatIds.every(id => command.seats.some(row => row.seatId === String(id)))) {
      return { ...dto, result: null, resultStatus: null, availabilityReason: 'replaced' };
    }
    const end = room.gameResult?.decidedAt ?? serverNow;
    const stop = room.turn.pausedAt == null ? end : Math.min(end, room.turn.pausedAt);
    const tracked = room.turn.trackingEnabled !== false;
    return { ...dto, status: dto.result ? 'complete' : 'playing', availabilityReason: null, hasLiveTotals: true,
      seats: liveSeats(room, command, alias), turn: { trackingEnabled: tracked,
        activeSeatNumber: tracked && command.seats.some(row => row.seatId === String(room.turn.activeSeatId)) ? seatNumber(room.turn.activeSeatId) : null,
        turnNumber: room.turn.turnNumber || 0, gameStartedAt: room.turn.gameStartedAt, turnStartedAt: room.turn.turnStartedAt,
        pausedAt: room.turn.pausedAt ?? null, gameElapsedMs: Math.max(0, stop - room.turn.gameStartedAt),
        turnElapsedMs: tracked && room.turn.turnStartedAt != null ? Math.max(0, stop - room.turn.turnStartedAt) : 0 },
      pendingFinish: room.pendingFinish?.gameId === command.gameId ? {
        winnerSeatNumber: seatNumber(room.pendingFinish.winnerSeatId), expiresAt: room.pendingFinish.expiresAt } : null };
  }

  async board(id, viewerToken) {
    const { scope, serverNow, alias } = await this.access(id, viewerToken);
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
