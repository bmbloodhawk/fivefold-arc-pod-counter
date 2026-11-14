// Disposable loopback QA ONLY. This entry point never reads live credentials.
import { createRealtimeServer } from '../server/src/app.js';
import { AccountHistory, MemoryAccountHistoryStore } from '../server/src/account-history.js';
import { MemoryPlaytestLedger, FirebasePlaytestLedger } from '../server/src/playtest-ledger.js';
import { Competitions, competitionStoreForEnvironment } from '../server/src/competitions.js';
import { CompetitionIdentityStore } from '../server/src/competition-identity-store.js';
import { CompetitionScopeStore } from '../server/src/competition-scope-store.js';
import { CompetitionRecovery } from '../server/src/competition-recovery.js';
import { liveStreamLimitsFromEnv } from '../server/src/live-stream-limits.js';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.COMPETITION_QA_PORT || 8793);
const databaseUrl = process.env.COMPETITION_QA_DATABASE_URL;
if (databaseUrl && !/^http:\/\/127\.0\.0\.1:\d+$/.test(databaseUrl)) throw new Error('QA database must be loopback.');
function fixtureAdapter() {
  const ledger = new FirebasePlaytestLedger({ databaseUrl, clientEmail: 'loopback-fixture', privateKey: 'not-a-key',
    fetchImpl: (url, options) => {
      if (new URL(url).origin !== databaseUrl) throw new Error('External storage access refused.');
      return fetch(url, options);
    } });
  ledger.accessToken = async () => 'local-fixture-only'; return ledger;
}
const ledger = databaseUrl ? fixtureAdapter() : new MemoryPlaytestLedger();
const profileStore = databaseUrl ? fixtureAdapter() : new MemoryAccountHistoryStore();
const competitionStore = databaseUrl ? competitionStoreForEnvironment(fixtureAdapter(), 'qa') : new MemoryAccountHistoryStore();
const nativeGroups = process.env.COMPETITION_QA_NATIVE_GROUPS === 'true';
if (nativeGroups && !databaseUrl) throw new Error('Native QA groups require the loopback REST fixture.');
const identities = nativeGroups ? new CompetitionIdentityStore({ store: competitionStore }) : null;
const competitions = nativeGroups ? new Competitions({ store: competitionStore,
  identityStore: identities,
  scopeStore: new CompetitionScopeStore({ identities }),
}) : null;
const instance = createRealtimeServer({ ...liveStreamLimitsFromEnv(), appEnv: 'test', staticDir: fileURLToPath(new URL('../client/', import.meta.url)),
  ledger, competitionStore, ...(competitions ? { competitions } : {}), autoRecoverRooms: true, durableRecoveryEnabled: false,
  accountHistory: new AccountHistory({ store: profileStore }),
  accountVerifier: { async verify(token) {
    if (!/^qa-[a-z0-9_-]{1,40}$/.test(token || '')) throw Object.assign(new Error('Fixture sign-in required.'), { status: 401, code: 'SIGN_IN_REQUIRED' });
    return { providerSubject: `loopback-fixture:${token}` };
  } },
  lookupCommanderIdentity: async () => null,
});
const recovery = new CompetitionRecovery({ domain: instance.competitions, tables: instance.competitionTables });
const timer = setInterval(() => { void recovery.tick(); }, 1000); timer.unref();
instance.server.listen(port, '127.0.0.1', () => {
  console.log(`COMPETITION_QA_READY http://127.0.0.1:${instance.server.address().port}`);
  void recovery.tick();
});
async function stop() {
  clearInterval(timer);
  for (const connection of instance.service.connections.values()) instance.service.closeStreams(connection, 'qa_shutdown');
  await ledger.flush(); instance.server.closeAllConnections();
  await new Promise(resolve => instance.server.close(resolve));
  process.exit(0);
}
process.on('SIGTERM', stop); process.on('SIGINT', stop);
