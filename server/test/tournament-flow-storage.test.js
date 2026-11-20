import assert from 'node:assert/strict';
import test from 'node:test';
import { Competitions, competitionStoreForEnvironment } from '../src/competitions.js';
import { CompetitionIdentityStore } from '../src/competition-identity-store.js';
import { CompetitionScopeStore } from '../src/competition-scope-store.js';
import { Tournaments } from '../src/tournaments.js';
import { CompetitionTables } from '../src/competition-tables.js';
import { FirebasePlaytestLedger, MemoryPlaytestLedger } from '../src/playtest-ledger.js';
import { RoomService } from '../src/app.js';
import { startCompetitionRestFixture } from '../../qa/competition-rest-fixture.mjs';

for (const mode of ['scoped', 'partitioned']) {
  test(`${mode} creation retries and competing coordinators share one durable event after restart`, { timeout: 20000 }, async t => {
    const database = await startCompetitionRestFixture(); t.after(() => database.close());
    const open = () => {
      const raw = new FirebasePlaytestLedger({ databaseUrl: database.url, clientEmail: 'fixture', privateKey: 'fixture' });
      raw.accessToken = async () => 'local-fixture-only';
      const store = competitionStoreForEnvironment(raw, 'qa'), identities = new CompetitionIdentityStore({ store });
      const domain = new Competitions({ store, identityStore: identities,
        scopeStore: mode === 'partitioned' ? new CompetitionScopeStore({ identities }) : null });
      const tournaments = new Tournaments({ domain }), ledger = new MemoryPlaytestLedger(), service = new RoomService({ ledger });
      tournaments.tables = new CompetitionTables({ domain, service, ledger, tournaments });
      return { domain, tournaments };
    };
    const first = open(), second = open(), input = { name: 'Durable weekly', displayName: 'Host', rounds: 2, requestId: `create_${mode}_123` };
    const [one, two] = await Promise.all([first.tournaments.create('host', input), second.tournaments.create('host', input)]);
    assert.equal(one.id, two.id); assert.equal(one.me, two.me);
    const fresh = open(), retry = await fresh.tournaments.create('host', input);
    assert.equal(retry.id, one.id); assert.equal(retry.version, one.version);
    await assert.rejects(() => fresh.tournaments.create('host', { ...input, preferredSize: 3 }), { code: 'TOURNAMENT_CREATE_RETRY_CONFLICT' });
    assert.equal((await fresh.domain.list('host')).tournaments.length, 1);
    assert.equal(database.calls.some(call => call.path === '/qa/competitions/directory.json'), false);
  });
}
