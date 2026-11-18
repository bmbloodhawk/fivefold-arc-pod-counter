import assert from 'node:assert/strict';
import test from 'node:test';
import { Competitions, competitionStoreForEnvironment } from '../src/competitions.js';
import { CompetitionIdentityStore } from '../src/competition-identity-store.js';
import { CompetitionScopeStore } from '../src/competition-scope-store.js';
import { Tournaments } from '../src/tournaments.js';
import { TournamentSpectators } from '../src/tournament-spectators.js';
import { CompetitionTables } from '../src/competition-tables.js';
import { FirebasePlaytestLedger, MemoryPlaytestLedger } from '../src/playtest-ledger.js';
import { RoomService } from '../src/app.js';
import { startCompetitionRestFixture } from '../../qa/competition-rest-fixture.mjs';

for (const mode of ['scoped', 'partitioned']) {
  test(`${mode} spectator capability and guest aliases survive fresh coordinators and persist revocation`, { timeout: 30000 }, async t => {
    const database = await startCompetitionRestFixture();
    t.after(() => database.close());
    const open = () => {
      const raw = new FirebasePlaytestLedger({ databaseUrl: database.url, clientEmail: 'fixture', privateKey: 'fixture' });
      raw.accessToken = async () => 'local-fixture-only';
      const store = competitionStoreForEnvironment(raw, 'qa'), identities = new CompetitionIdentityStore({ store });
      const domain = new Competitions({ store, identityStore: identities,
        scopeStore: mode === 'partitioned' ? new CompetitionScopeStore({ identities }) : null });
      const tournaments = new Tournaments({ domain }), ledger = new MemoryPlaytestLedger(), service = new RoomService({ ledger });
      tournaments.tables = new CompetitionTables({ domain, service, ledger, tournaments });
      return { domain, tournaments, spectators: new TournamentSpectators({ domain, tournaments }) };
    };
    const first = open(), host = { accountId: 'organizer' };
    const event = await first.tournaments.create(host.accountId, { name: 'Native spectator event', displayName: 'Organizer',
      rounds: 2, preferredSize: 2, requestId: `spectators_create_${mode}` });
    const invite = await first.domain.invite(host.accountId, 'tournament', event.id);
    for (let index = 0; index < 2; index++) await first.tournaments.join(null, invite.token, {
      displayName: `Guest ${index}`, requestId: `spectators_guest_${mode}_${index}`,
    });
    await first.tournaments.prepareRound(host, event.id);
    const before = await first.domain.readScope('tournament', event.id);
    const issued = await first.spectators.change(host, event.id, { action: 'create' });
    assert.deepEqual((await first.domain.readScope('tournament', event.id)).members, before.members);
    assert.equal(JSON.stringify(database.read('qa')).includes(issued.viewerToken), false);
    assert.equal(mode === 'partitioned' ? database.read(`qa/competitions/tournaments/${event.id}.json`) === null
      : database.read(`qa/competitions/tournaments/${event.id}.json`)?.kind === 'tournament', true);

    const fresh = open();
    const metadata = await fresh.spectators.metadata(host, event.id);
    assert.deepEqual(metadata, { eventId: event.id, active: true, expiresAt: issued.expiresAt });
    assert.equal(/secretHash|viewerToken/.test(JSON.stringify(metadata)), false);
    const callsBeforeRead = database.calls.length;
    const board = await fresh.spectators.board(event.id, issued.viewerToken);
    assert.equal(board.name, 'Native spectator event');
    assert.equal(board.roundNumber, 1); assert.equal(board.plannedRounds, 2);
    assert.equal(board.rounds[0].status, 'draft');
    assert.deepEqual([...board.rounds[0].assignments[0].participants].sort(), ['Guest 0', 'Guest 1']);
    assert.deepEqual(board.standings.map(row => row.alias).sort(), ['Guest 0', 'Guest 1']);
    assert.ok(board.standings.every(row => row.points === 0 && row.gamesPlayed === 0 && row.rank === 1));
    assert.equal(/secretHash|guestAccess|identityId|accountId|entrant_|roomCode|participantIds|revision/.test(JSON.stringify(board)), false);
    assert.ok(database.calls.slice(callsBeforeRead).every(call => call.method === 'GET'), 'A fresh viewer read must not write native storage.');

    await fresh.spectators.change(host, event.id, { action: 'revoke' });
    const afterRevocation = open();
    await assert.rejects(() => afterRevocation.spectators.board(event.id, issued.viewerToken), { status: 403, code: 'EVENT_VIEWER_ACCESS' });
    assert.deepEqual(await afterRevocation.spectators.metadata(host, event.id), { eventId: event.id, active: false, expiresAt: null });
    assert.equal(JSON.stringify(database.read('qa')).includes(issued.viewerToken), false);
    assert.equal(database.calls.some(call => call.path === '/qa/competitions/directory.json'), false);
  });
}
