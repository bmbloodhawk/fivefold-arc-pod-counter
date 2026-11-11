import { randomBytes } from 'node:crypto';
import { digest, competitionError } from './competitions.js';
import { sourceDigest } from './competition-source.js';
import { rankPlacements, replayPodGames, RATING_RULE_VERSION } from './competition-scoring.js';

const proof = seat => Buffer.from(seat.tokenHash || []).toString('base64');
const roomIdentity = room => Buffer.from(room.hostRecoveryKeyHash || []).toString('base64');
const tableKey = room => digest(roomIdentity(room));
const roster = room => (room.lifecycle?.seatIds || []).map(id => room.seats[id]).filter(seat => seat?.claimed);
const rosterProof = room => digest(roster(room).map(seat => [seat.seatId, proof(seat)]));
const live = (member, directory) => member?.status === 'active'
  && (member.kind === 'guest' || Boolean(directory.identities[member.identityId]));
const TIMED_DRAW_TABLE_PROTOCOL = 2;

// All methods here are setup, explicit administration or completion operations.
// RoomService never calls this coordinator during a counter mutation or broadcast.
export class CompetitionTables {
  constructor({ domain, service, ledger, tournaments = null }) {
    this.domain = domain; this.service = service; this.ledger = ledger; this.tournaments = tournaments;
    this.service.completionEvidenceEnabled = true;
    this.pendingScopes = new Map();
    this.pendingClaims = new Map(); this.unresolvedClaims = new Map();
  }
  actor(scope, auth, directory, { admin = false } = {}) {
    const accountId = typeof auth === 'string' ? auth : auth?.accountId;
    const identityId = directory.accounts[digest(accountId || '')];
    const guestHash = auth?.guestToken ? digest(auth.guestToken) : null;
    const member = Object.values(scope.members).find(item =>
      (identityId && item.identityId === identityId && directory.identities[identityId])
      || (guestHash && item.guestAccessHash === guestHash));
    const permitted = live(member, directory) || (scope.kind === 'tournament' && ['left', 'pending'].includes(member?.status)
      && (member.kind === 'guest' || directory.identities[member.identityId]));
    if (!permitted || (admin && member.role !== 'admin')) {
      throw competitionError(admin ? 'An event host is required.' : 'You do not have access to this group or event.', 403, 'COMPETITION_ACCESS');
    }
    return member;
  }
  async binding(room) { return (await this.domain.directory()).tables[tableKey(room)] || null; }
  own(code, connectionId, hostOnly = false) {
    const room = this.service.room(code); const owner = this.service.requireOwner(room, connectionId);
    if (hostOnly && owner.seatId !== room.hostSeatId) throw competitionError('The Table host must do this.', 403, 'HOST_ONLY');
    return { room, ...owner };
  }
  requireDrawSupport(room) {
    for (const seat of room.seats.filter(row => row.claimed && row.ownerConnectionId)) {
      const connection = this.service.connections.get(seat.ownerConnectionId);
      if (!connection?.supportedTableProtocols.includes(TIMED_DRAW_TABLE_PROTOCOL)) {
        throw competitionError('Update every phone at this Table before using timed tournament rounds.', 409, 'TABLE_PROTOCOL_INCOMPATIBLE');
      }
    }
  }
  enableDrawSupport(room) {
    this.requireDrawSupport(room);
    if (room.protocolVersion === TIMED_DRAW_TABLE_PROTOCOL) return false;
    room.protocolVersion = TIMED_DRAW_TABLE_PROTOCOL; room.version++;
    this.service.recordLedger(room, 'timed_draw_protocol_enabled', room.hostSeatId, { protocolVersion: TIMED_DRAW_TABLE_PROTOCOL });
    this.service.broadcast(room);
    return true;
  }
  async claimRoom(code, connectionId, input, resolveAccount) {
    let release;
    const barrier = new Promise(resolve => { release = resolve; });
    const pending = this.pendingClaims.get(code) || new Set(); pending.add(barrier); this.pendingClaims.set(code, pending);
    try {
      const accountId = await resolveAccount();
      const result = this.service.claimSeat(code, connectionId, input);
      try {
        await this.claim({ accountId }, { code, connectionId });
        this.unresolvedClaims.delete(`${code}:${result.seatId}`);
      } catch (error) {
        if (error.code === 'COMPETITION_ACCESS') this.unresolvedClaims.delete(`${code}:${result.seatId}`);
        else {
          this.unresolvedClaims.set(`${code}:${result.seatId}`, proof(this.service.room(code).seats[result.seatId]));
          result.competitionWarning = 'Your seat joined. Group linking needs a retry before the host starts the game.';
        }
      }
      return result;
    } finally { release(); pending.delete(barrier); if (!pending.size) this.pendingClaims.delete(code); }
  }
  async bind(auth, { kind, id, code, connectionId, assignmentId } = {}) {
    const { room, seat, seatId } = this.own(code, connectionId, true);
    const ownerHash = proof(seat);
    const guard = () => {
      const current = this.own(code, connectionId, true);
      if (current.seatId !== seatId || proof(current.seat) !== ownerHash) throw competitionError('Seat ownership changed. Reclaim before linking.', 403);
      if (room.turn.gameStarted && !room.gameResult) throw competitionError('Link a Table before starting play.', 409, 'ROSTER_SEALED');
    };
    const directory = await this.domain.directory(); const scope = await this.domain.readScope(kind, id);
    const me = this.actor(scope, auth, directory);
    if (kind === 'tournament' && scope.settings.minutes) this.requireDrawSupport(room);
    const key = tableKey(room);
    const existing = directory.tables[key];
    if (existing && (existing.kind !== kind || existing.id !== id)) throw competitionError('This Table already belongs to another competition.', 409, 'TABLE_ALREADY_LINKED');
    if (room.turn.gameStarted && !existing) throw competitionError('Link this Table before starting the game.', 409, 'LINK_BEFORE_START');
    if (kind === 'tournament') this.tournaments?.checkTableBinding(scope, me.id, assignmentId);
    await this.domain.changeDirectory(state => {
      guard();
      const current = state.tables[key];
      if (current && (current.kind !== kind || current.id !== id)) throw competitionError('This Table already belongs to another competition.', 409, 'TABLE_ALREADY_LINKED');
      if (me.identityId && !state.identities[me.identityId]) throw competitionError('Account data was removed.', 403);
      state.tables[key] = { kind, id, roomCode: room.code };
      return state;
    });
    await this.domain.changeScope(kind, id, state => {
      guard();
      const actor = this.actor(state, auth, directory);
      const table = state.tables[key] ??= { key, roomCode: room.code, seats: {}, captures: {} };
      if (kind === 'tournament') {
        this.tournaments.checkTableBinding(state, actor.id, assignmentId);
        const assignment = this.tournaments.assignment(state, assignmentId);
        const duplicate = Object.values(state.tables).some(item => item.key !== key && item.assignmentId === assignmentId);
        if (duplicate) throw competitionError('That assignment already has a linked Table.', 409);
        table.assignmentId = assignment.id;
      }
      const previous = table.seats[seatId];
      if (previous?.ownerHash === ownerHash && previous.participantId !== actor.id) throw competitionError('This seat is already linked to another participant.', 409);
      table.seats[seatId] = { participantId: actor.id, ownerHash };
      table.hostId = actor.id;
    });
    if (kind === 'tournament' && scope.settings.minutes) this.enableDrawSupport(room);
    return this.context(auth, code, connectionId);
  }
  async claim(auth, { code, connectionId } = {}) {
    const { room, seat, seatId } = this.own(code, connectionId);
    const ownerHash = proof(seat);
    const binding = await this.binding(room);
    if (!binding) return { linked: false };
    const directory = await this.domain.directory();
    if (room.turn.gameStarted && !room.gameResult) {
      const scope = await this.domain.readScope(binding.kind, binding.id); const me = this.actor(scope, auth, directory);
      const sealed = scope.tables[tableKey(room)]?.captures[room.gameId]?.seats.find(row => row.seatId === String(seatId));
      if (sealed?.ownerHash === ownerHash && sealed.participantId === me.id) return this.context(auth, code, connectionId);
      throw competitionError('Seats are sealed for this game. Your next game can be linked.', 409, 'ROSTER_SEALED');
    }
    await this.domain.changeScope(binding.kind, binding.id, scope => {
      const current = this.own(code, connectionId);
      if (proof(current.seat) !== ownerHash || current.seatId !== seatId) throw competitionError('Seat ownership changed. Reclaim before linking.', 403);
      if (room.turn.gameStarted && !room.gameResult) throw competitionError('Seats are sealed for this game.', 409, 'ROSTER_SEALED');
      const me = this.actor(scope, auth, directory);
      const table = scope.tables[tableKey(room)];
      if (!table) throw competitionError('The host must finish linking this Table.', 409);
      if (binding.kind === 'tournament' && !this.tournaments.assignment(scope, table.assignmentId).participantIds.includes(me.id)) {
        throw competitionError('You are assigned to a different Table.', 403);
      }
      const previous = table.seats[seatId];
      if (previous?.ownerHash === ownerHash && previous.participantId !== me.id) throw competitionError('This seat is already linked to another participant.', 409);
      const duplicate = Object.entries(table.seats).some(([id, row]) => Number(id) !== seatId && row.participantId === me.id
        && row.ownerHash === proof(room.seats[Number(id)]));
      if (duplicate) throw competitionError('One participant can link only one seat.', 409);
      table.seats[seatId] = { participantId: me.id, ownerHash };
    });
    this.unresolvedClaims.delete(`${code}:${seatId}`);
    return this.context(auth, code, connectionId);
  }
  async context(auth, code, connectionId) {
    const { room, seatId } = this.own(code, connectionId);
    const binding = await this.binding(room);
    if (!binding) return { linked: false };
    const scope = await this.domain.readScope(binding.kind, binding.id); const directory = await this.domain.directory();
    let me;
    try { me = this.actor(scope, auth, directory); }
    catch (error) { if (error.status === 403) return { linked: true, kind: binding.kind, canAccess: false }; throw error; }
    const table = scope.tables[tableKey(room)];
    const capture = Object.values(table?.captures || {}).find(item => item.gameId === room.gameId);
    return { linked: true, canAccess: true, kind: binding.kind, id: binding.id, name: scope.name,
      me: me.id, host: table?.hostId === me.id, seatLinked: table?.seats[seatId]?.participantId === me.id,
      gameId: capture?.gameId || null, captureStatus: capture?.status || null,
      assignmentId: table?.assignmentId || null,
      assignedGuests: binding.kind === 'tournament' && table?.assignmentId ? this.tournaments.assignment(scope, table.assignmentId).participantIds
        .map(id => scope.members[id]).filter(row => row.kind === 'guest').map(row => ({ id: row.id, name: this.domain.name(directory, scope.id, row) })) : [],
      roster: roster(room).map(seat => {
        const linked = table?.seats[seat.seatId]; const member = linked?.ownerHash === proof(seat) && scope.members[linked.participantId];
        return { seatId: seat.seatId, participantId: live(member, directory) ? member.id : null, kind: live(member, directory) ? member.kind : 'guest',
          name: live(member, directory) ? this.domain.name(directory, scope.id, member) : seat.name };
      }),
    };
  }

  async attestGuest(auth, { code, connectionId, seatId, participantId } = {}) {
    const { room } = this.own(code, connectionId, true); const binding = await this.binding(room);
    if (!binding || binding.kind !== 'tournament') throw competitionError('Choose a tournament Table.', 409);
    const directory = await this.domain.directory();
    await this.domain.changeScope('tournament', binding.id, scope => {
      this.own(code, connectionId, true);
      if (room.turn.gameStarted && !room.gameResult) throw competitionError('Link guest seats before starting.', 409);
      const me = this.actor(scope, auth, directory); const table = scope.tables[tableKey(room)];
      const assignment = this.tournaments.assignment(scope, table.assignmentId);
      if (me.role !== 'admin' && me.id !== assignment.hostId) throw competitionError('The Table host must attest guest seats.', 403);
      const guest = scope.members[participantId]; const seat = room.seats[seatId];
      if (guest?.kind !== 'guest' || guest.status !== 'active' || !assignment.participantIds.includes(guest.id) || !seat?.claimed) throw competitionError('Choose an assigned guest and a claimed seat.');
      if (Object.entries(table.seats).some(([id, row]) => Number(id) !== Number(seatId) && row.participantId === guest.id && row.ownerHash === proof(room.seats[Number(id)]))) throw competitionError('A guest can occupy only one seat.', 409);
      const previous = table.seats[seatId];
      if (previous?.ownerHash === proof(seat) && previous.participantId !== guest.id) throw competitionError('This seat is already linked to a different entrant.', 409);
      table.seats[seatId] = { participantId: guest.id, ownerHash: proof(seat) };
    });
    return this.context(auth, code, connectionId);
  }
  async timedDraw(auth, { code, connectionId, baseVersion } = {}) {
    const { room } = this.own(code, connectionId, true); const binding = await this.binding(room);
    if (!binding || binding.kind !== 'tournament') throw competitionError('Timed draws are available only in a timed tournament.', 409);
    const scope = await this.domain.readScope('tournament', binding.id); const directory = await this.domain.directory();
    const me = this.actor(scope, auth, directory); const table = scope.tables[tableKey(room)];
    const command = table?.captures[room.gameId];
    const assignment = this.tournaments.assignment(scope, command?.assignmentId);
    if ((me.role !== 'admin' && me.id !== command.hostId) || assignment.clock?.phase !== 'done'
      || assignment.clock.sourceGameId !== command.gameId) throw competitionError('Finish the current turn and all five additional turns of this game first.', 409, 'FIVE_TURNS_REQUIRED');
    this.enableDrawSupport(room);
    return this.service.completeTimedDraw(code, connectionId, { baseVersion });
  }

  async start(code, connectionId, input) {
    const { room } = this.own(code, connectionId, true);
    await Promise.all([...(this.pendingClaims.get(code) || [])]);
    if (roster(room).some(seat => this.unresolvedClaims.get(`${code}:${seat.seatId}`) === proof(seat))) throw competitionError('A signed-in seat still needs its group link retried before starting.', 409, 'SEAT_LINK_PENDING');
    const binding = await this.binding(room);
    if (!binding) return this.service.startGame(code, connectionId, input);
    await this.reconcile(binding.kind, binding.id);
    const directory = await this.domain.directory(); const key = tableKey(room);
    const before = await this.domain.readScope(binding.kind, binding.id);
    if (binding.kind === 'tournament' && before.settings.minutes && this.enableDrawSupport(room)) {
      throw Object.assign(competitionError('The timed Table is ready for updated phones. Review it and start again.', 409, 'VERSION_CONFLICT'), { snapshot: this.service.snapshot(room) });
    }
    const table = before.tables[key];
    if (!table) throw competitionError('Finish linking this Table before starting.', 409);
    const hostId = table.seats[room.hostSeatId]?.ownerHash === proof(room.seats[room.hostSeatId])
      ? table.seats[room.hostSeatId].participantId : null;
    if (!live(before.members[hostId], directory)) throw competitionError('The current Table host must link an active membership.', 403);
    const current = Object.values(table.captures).find(item => item.gameId === room.gameId);
    if (room.turn.gameStarted && !room.gameResult && current?.status === 'accepted') return { snapshot: this.service.snapshot(room) };
    if (room.turn.gameStarted) return this.service.startGame(code, connectionId, input);
    if (input.baseVersion !== room.version) throw competitionError('Refresh the Table before starting.', 409, 'VERSION_CONFLICT');
    if (roster(room).length < 2 || room.turn.startingPlayerRoll?.status === 'rolling') throw competitionError('Finish Table setup before starting.', 409);
    if (room.lifecycle.status === 'intermission' && room.lifecycle.seatIds.some(id => !room.lifecycle.readySeatIds.includes(id))) {
      throw competitionError('Wait for every listed player to be ready.', 409, 'PLAYERS_NOT_READY');
    }
    const interrupted = Object.values(table.captures).find(item => item.status === 'accepted');
    if (interrupted) {
      const exact = interrupted.seats.length === roster(room).length && roster(room).every(seat =>
        interrupted.seats.some(row => row.seatId === String(seat.seatId) && row.ownerHash === proof(seat)));
      if (!exact || hostId !== interrupted.hostId) {
        throw competitionError('An interrupted start has a different roster. Reset this unplayed game before starting again.', 409, 'START_REVIEW_REQUIRED');
      }
      // The durable accepted command is the eligibility boundary. Apply that same
      // command after a crash; do not mint a second game or silently reseal it.
      return this.service.startGame(code, connectionId, input, { preparedGameId: interrupted.gameId });
    }
    const signature = rosterProof(room); const version = room.version;
    const gameId = randomBytes(12).toString('base64url');
    const candidates = Object.fromEntries(roster(room).map(seat => [seat.seatId, `guest_${this.domain.createId()}`]));
    // Guest names are mutable, separate from immutable source and numerical ledger.
    await this.domain.changeDirectory(state => {
      if (!state.identities[before.members[hostId]?.identityId] && before.members[hostId]?.kind !== 'guest') throw competitionError('The host’s membership is unavailable.', 403);
      for (const seat of roster(room)) {
        const linked = table.seats[seat.seatId];
        const member = linked?.ownerHash === proof(seat) && before.members[linked.participantId];
        if (!live(member, directory)) {
          const knownIdentity = member?.kind === 'member' ? member.identityId : null;
          state.aliases[`${binding.id}_${candidates[seat.seatId]}`] = {
            identityId: knownIdentity,
            name: knownIdentity && !state.identities[knownIdentity] ? 'Deleted member' : seat.name,
          };
        }
      }
      return state;
    });
    const accepted = await this.domain.changeScope(binding.kind, binding.id, scope => {
      this.own(code, connectionId, true);
      const linkedTable = scope.tables[key]; const host = scope.members[hostId];
      linkedTable.hostId = hostId;
      if (!live(host, directory) || linkedTable.seats[room.hostSeatId]?.ownerHash !== proof(room.seats[room.hostSeatId])) {
        throw competitionError('An active participating host must link this seat.', 403);
      }
      if (binding.kind === 'tournament') this.tournaments.checkTableBinding(scope, host.id, linkedTable.assignmentId);
      const unacknowledged = Object.values(linkedTable.captures).find(item => item.status === 'accepted');
      if (unacknowledged) throw competitionError('The previous game still needs completion capture or an explicit reset.', 409, 'CAPTURE_PENDING');
      const seats = roster(room).map(seat => {
        const linked = linkedTable.seats[seat.seatId];
        const member = linked?.ownerHash === proof(seat) && scope.members[linked.participantId];
        if (live(member, directory)) return { seatId: String(seat.seatId), ownerHash: proof(seat), participantId: member.id, kind: member.kind };
        if (binding.kind === 'tournament') throw competitionError('Every event entrant must link their assigned seat, or the host must attest a guest.', 409, 'EVENT_SEATS_PENDING');
        const id = candidates[seat.seatId];
        scope.members[id] = { id, kind: 'guest', role: 'participant', status: 'active', provenance: 'organizer_attested' };
        return { seatId: String(seat.seatId), ownerHash: proof(seat), participantId: id, kind: 'guest' };
      });
      if (new Set(seats.map(seat => seat.participantId)).size !== seats.length) throw competitionError('A player cannot occupy two competition seats.', 409);
      if (binding.kind === 'tournament') this.tournaments.checkStartedRoster(scope, linkedTable.assignmentId, seats.map(seat => seat.participantId));
      linkedTable.captures[gameId] = { gameId, status: 'accepted', acceptedAt: this.domain.now(),
        tableIdentity: roomIdentity(room), roomCode: room.code, hostId: host.id, seats,
        eligibleIds: seats.filter(seat => seat.kind === 'member').map(seat => seat.participantId),
        assignmentId: linkedTable.assignmentId || null };
    });
    const command = accepted.tables[key].captures[gameId];
    this.pendingScopes.set(`${binding.kind}:${binding.id}`, binding);
    try {
      if (room.version !== version || rosterProof(room) !== signature) throw competitionError('The roster changed. Review it before starting.', 409, 'VERSION_CONFLICT');
      return this.service.startGame(code, connectionId, input, { preparedGameId: command.gameId });
    } catch (error) {
      await this.domain.changeScope(binding.kind, binding.id, scope => { scope.tables[key].captures[gameId].status = 'cancelled'; });
      throw error;
    }
  }

  async beforeProgress(code, connectionId, action) {
    const { room } = this.own(code, connectionId, true); const binding = await this.binding(room);
    if (!binding) return;
    await this.reconcile(binding.kind, binding.id);
    await this.domain.changeScope(binding.kind, binding.id, scope => {
      const command = scope.tables[tableKey(room)]?.captures[room.gameId];
      if (!command || command.status !== 'accepted') return;
      if (room.gameResult) throw competitionError('Capture this completed result before preparing another game. Retry from the group screen.', 503, 'CAPTURE_PENDING');
      if (action === 'reset') return;
      throw competitionError('This competition game is still in progress.', 409);
    });
  }
  async reset(code, connectionId, input) {
    const { room } = this.own(code, connectionId, true); const binding = await this.binding(room);
    if (!binding) return this.service.resetRoom(code, connectionId, input);
    if (input.baseVersion !== room.version) throw competitionError('Refresh the Table before resetting.', 409, 'VERSION_CONFLICT');
    await this.beforeProgress(code, connectionId, 'reset');
    const resetGameId = randomBytes(12).toString('base64url'); const key = tableKey(room);
    await this.domain.changeScope(binding.kind, binding.id, scope => {
      for (const command of Object.values(scope.tables[key]?.captures || {})) {
        if (command.status === 'accepted') command.resetIntent = { toGameId: resetGameId, requestedAt: this.domain.now() };
      }
    });
    let response;
    try { response = this.service.resetRoom(code, connectionId, input, { preparedGameId: resetGameId }); }
    catch (error) {
      await this.domain.changeScope(binding.kind, binding.id, scope => {
        for (const command of Object.values(scope.tables[key]?.captures || {})) {
          if (command.resetIntent?.toGameId === resetGameId) delete command.resetIntent;
        }
      });
      throw error;
    }
    await this.domain.changeScope(binding.kind, binding.id, scope => {
      for (const command of Object.values(scope.tables[key]?.captures || {})) {
        if (command.resetIntent?.toGameId === resetGameId) command.status = 'abandoned';
      }
    });
    return response;
  }
  async reconcile(kind, id) {
    const scope = await this.domain.readScope(kind, id);
    for (const table of Object.values(scope.tables)) {
      for (const command of Object.values(table.captures)) {
        if (command.status !== 'accepted') continue;
        if (command.resetIntent) {
          const room = this.service.rooms.get(command.roomCode);
          const saved = !room ? await this.ledger.readRecovery(command.roomCode) : null;
          if ((room || saved?.room)?.gameId === command.resetIntent.toGameId) {
            await this.domain.changeScope(kind, id, state => { state.tables[table.key].captures[command.gameId].status = 'abandoned'; });
            continue;
          }
        }
        let source = await this.ledger.readArchivedSource(command.gameId);
        if (!source) {
          const liveRoom = this.service.rooms.get(command.roomCode);
          let frozen = liveRoom?.completedGames?.find(item => item.gameId === command.gameId);
          if (!frozen?.source) {
            const recovered = await this.ledger.readRecovery(command.roomCode);
            frozen = recovered?.room?.completedGames?.find(item => item.gameId === command.gameId);
          }
          source = frozen?.source;
          if (source) await this.ledger.retrySourceArchive(source, frozen.archiveRecap);
        }
        if (source) {
          await this.capture(kind, id, table.key, command.gameId, source);
          const frozen = this.service.rooms.get(command.roomCode)?.completedGames?.find(item => item.gameId === command.gameId);
          if (frozen) delete frozen.archiveRecap;
        }
      }
    }
  }
  async capture(kind, id, key, gameId, source) {
    await this.domain.changeScope(kind, id, scope => {
      const command = scope.tables[key]?.captures[gameId];
      if (!command || !['accepted', 'captured'].includes(command.status)) throw competitionError('This source has no accepted start.', 409);
      if (source.gameId !== gameId || source.tableIdentity !== command.tableIdentity || source.sessionKind !== 'standard'
        || !Number.isFinite(source.startedAt) || source.completedAt < source.startedAt
        || source.starters.length !== command.seats.length || source.starters.some(seat =>
          !command.seats.some(row => row.seatId === String(seat.seatId) && row.ownerHash === seat.ownerHash))) {
        throw competitionError('The frozen completion does not match the accepted starter proofs.', 409, 'SOURCE_MISMATCH');
      }
      const hash = sourceDigest(source);
      if (scope.games[gameId]) {
        if (scope.games[gameId].sourceHash !== hash) throw competitionError('Conflicting source game.', 409, 'SOURCE_CONFLICT');
        return;
      }
      const participant = seatId => command.seats.find(seat => seat.seatId === String(seatId))?.participantId;
      scope.games[gameId] = { gameId, sourceHash: hash, completedAt: source.completedAt, startedAt: source.startedAt,
        gameFormat: source.gameFormat, hostId: command.hostId, tableKey: key, assignmentId: command.assignmentId,
        starterIds: command.seats.map(seat => seat.participantId),
        seats: command.seats.map(({ seatId, participantId, kind: seatKind }) => ({ seatId, participantId, kind: seatKind })),
        eligibleIds: command.eligibleIds,
        original: { kind: source.originalOutcome.kind, reason: source.originalOutcome.reason,
          winnerId: participant(source.originalOutcome.winnerSeatId) || null,
          inferredOrder: source.inferredOrder?.map(group => group.map(participant)) || null },
        revisions: [], ratingChanges: [], ratingVersion: RATING_RULE_VERSION };
      if (kind === 'tournament') this.tournaments.recordCaptured(scope, command.assignmentId, gameId);
      command.status = 'captured';
    });
  }
  async confirm(auth, kind, id, gameId, { order, baseRevision, requestId, reasonCode = 'host_confirmation' } = {}) {
    if (typeof requestId !== 'string' || !/^[\w-]{8,100}$/.test(requestId)) throw competitionError('A confirmation retry identifier is required.');
    const directory = await this.domain.directory();
    const result = await this.domain.changeScope(kind, id, scope => {
      const me = this.actor(scope, auth, directory); const game = scope.games[gameId];
      if (!game) throw competitionError('Capture the completed game before confirming.', 409, 'COMPLETION_PENDING');
      if (me.role !== 'admin' && me.id !== game.hostId) throw competitionError('Only this game’s original host or an admin may confirm or correct it.', 403, 'HOST_ONLY');
      rankPlacements(order, game.starterIds);
      const normalized = order.map(group => [...group].sort());
      if (game.original.kind === 'timed_draw' && JSON.stringify(normalized[0]) !== JSON.stringify([...game.original.inferredOrder[0]].sort())) {
        throw competitionError('The recorded surviving players must share the top places in a timed draw.');
      }
      const payloadHash = digest({ order: normalized, reasonCode });
      const previous = game.revisions.find(item => item.requestId === requestId);
      if (previous) {
        if (previous.payloadHash !== payloadHash) throw competitionError('That retry identifier was already used for a different order.', 409, 'CONFIRMATION_CONFLICT');
        return;
      }
      if (baseRevision !== game.revisions.length) throw competitionError('This result changed. Review the latest revision.', 409, 'REVISION_CONFLICT');
      if (game.revisions.length && !['order_error', 'tie_correction', 'recording_error'].includes(reasonCode)) throw competitionError('Select a reason for the correction.');
      if (!game.revisions.length && reasonCode !== 'host_confirmation') throw competitionError('Confirm the original result first.');
      game.revisions.push({ revision: game.revisions.length + 1, order: normalized, reasonCode, by: me.id,
        at: this.domain.now(), requestId, payloadHash });
      if (kind === 'pod') {
        const replay = replayPodGames(Object.values(scope.games).filter(item => item.revisions.length).map(item => ({
          ...item, status: 'confirmed', order: item.revisions.at(-1).order,
        })));
        scope.standings = replay.members;
        for (const item of replay.games) scope.games[item.gameId].ratingChanges = item.updates;
      } else this.tournaments.applyStandings(scope);
    });
    return this.detailDto(result, result.games[gameId], directory);
  }
  detailDto(scope, game, directory) {
    return { gameId: game.gameId, completedAt: game.completedAt, startedAt: game.startedAt, gameFormat: game.gameFormat,
      provenance: game.revisions.length ? 'Completion recorded by the app. Order confirmed by the host.' : 'Completion recorded by the app. Finishing order needs host confirmation.', status: game.revisions.length ? 'confirmed' : 'pending',
      hostId: game.hostId, starterIds: game.starterIds, original: game.original,
      players: game.seats.map(seat => ({ id: seat.participantId, seatId: seat.seatId, kind: seat.kind,
        name: this.domain.name(directory, scope.id, scope.members[seat.participantId]),
        provenance: seat.kind === 'guest' ? `${scope.members[seat.participantId]?.provenance || 'organizer_attested'}_guest` : 'verified_member_seat' })),
      revisions: game.revisions.map(({ revision, order, reasonCode, by, at }) => ({ revision, order, reasonCode, by,
        actor: this.domain.name(directory, scope.id, scope.members[by]), at })),
      ratingChanges: game.ratingChanges,
    };
  }
  async detail(auth, kind, id, gameId) {
    const directory = await this.domain.directory(); const scope = await this.domain.readScope(kind, id);
    this.actor(scope, auth, directory);
    if (!scope.games[gameId]) throw competitionError('That game is unavailable.', 404);
    return this.detailDto(scope, scope.games[gameId], directory);
  }
  async history(auth, kind, id, { cursor, limit = 20, from = 0, to = Infinity } = {}) {
    const directory = await this.domain.directory(); const scope = await this.domain.readScope(kind, id);
    this.actor(scope, auth, directory);
    const pageSize = Math.min(50, Math.max(1, Number(limit) || 20));
    const rows = Object.values(scope.games).filter(game => game.completedAt >= Number(from) && game.completedAt < Number(to))
      .sort((a, b) => b.completedAt - a.completedAt || b.gameId.localeCompare(a.gameId));
    const offset = cursor ? rows.findIndex(row => `${row.completedAt}:${row.gameId}` === cursor) + 1 : 0;
    if (cursor && offset === 0) throw competitionError('That history page has changed. Start again.', 409);
    const page = rows.slice(offset, offset + pageSize);
    return { games: page.map(game => ({ gameId: game.gameId, completedAt: game.completedAt, playerCount: game.starterIds.length,
      status: game.revisions.length ? 'confirmed' : 'pending', revision: game.revisions.length })),
      nextCursor: rows.length > offset + pageSize ? `${page.at(-1).completedAt}:${page.at(-1).gameId}` : null };
  }
}
