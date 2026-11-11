import { createRealtimeServer } from "./app.js";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createPlaytestLedgerFromEnv } from "./playtest-ledger.js";
import { createAppearanceCatalogFromEnv } from "./appearance-catalog.js";
import { AccountHistory, accountHistoryStoreForEnvironment } from "./account-history.js";
import { loadAppearanceSkins } from "./appearance-collection.js";
import { createFirebaseIdTokenVerifierFromEnv } from "./firebase-id-token.js";
import { createLocalCommanderIdentityLookup, loadCardIdentityIndex } from "./card-identity-index.js";
import { competitionStoreForEnvironment } from './competitions.js';
import { CompetitionRecovery } from './competition-recovery.js';

const port = Number(process.env.PORT ?? 8787);
const appEnv = process.env.APP_ENV ?? "production";
const staticDir = resolve(fileURLToPath(new URL("../../client/", import.meta.url)));
const cardIdentityIndex = await loadCardIdentityIndex(resolve(fileURLToPath(new URL("../static-data/card-identity-index.json", import.meta.url))));
const ledger = createPlaytestLedgerFromEnv();
const durableRecoveryEnabled = typeof ledger.accessToken === "function" && process.env.DURABLE_ROOM_RECOVERY_ENABLED !== "false";
const appearanceCatalog = createAppearanceCatalogFromEnv({ path: resolve(fileURLToPath(new URL("../data/appearance-studio-catalog.json", import.meta.url))) });
const derivedProjectId = /^https:\/\/([a-z0-9-]+)-default-rtdb\./.exec(process.env.FIREBASE_DATABASE_URL || "")?.[1];
// The staging site uses the same sign-in provider, with separate profile storage.
const authProjectId = process.env.FIREBASE_PROJECT_ID || (appEnv === "staging" ? "fivefold-arc-playtest" : derivedProjectId);
const accountVerifier = createFirebaseIdTokenVerifierFromEnv({ ...process.env, FIREBASE_PROJECT_ID: authProjectId });
const accountHistory = accountVerifier && typeof ledger.accessToken === "function"
  ? new AccountHistory({ store: accountHistoryStoreForEnvironment(ledger, appEnv) }) : null;
// Local implementation is shipped disabled until a separately approved release.
// Separate adapter/token/write queue from live room recovery and personal awards.
const competitionWriter = process.env.COMPETITIONS_ENABLED === 'true' && accountHistory ? createPlaytestLedgerFromEnv() : null;
const competitionStore = competitionWriter ? competitionStoreForEnvironment(competitionWriter, appEnv) : null;
const appearanceSkins = await loadAppearanceSkins({
  path: resolve(staticDir, "appearance-collection.enc"),
  key: process.env.APPEARANCE_PACK_KEY || (appEnv === "staging" ? process.env.STAGING_APPEARANCE_PACK_KEY : ""),
}).catch(() => {
  console.warn("Appearance pack could not be loaded");
  return [];
});
const { server, service, competitions, competitionTables } = createRealtimeServer({
  appEnv, staticDir, ledger, appearanceCatalog, accountVerifier, accountHistory, appearanceSkins,
  durableRecoveryEnabled, competitionStore, lookupCommanderIdentity: createLocalCommanderIdentityLookup(cardIdentityIndex),
});
const competitionRecovery = competitions ? new CompetitionRecovery({ domain: competitions, tables: competitionTables }) : null;
if (competitionRecovery) await competitionRecovery.discover().catch(error => console.error('Competition recovery discovery pending', error.message));
const competitionTimer = competitionRecovery ? setInterval(() => { void competitionRecovery.tick(); }, 15_000) : null;
competitionTimer?.unref();
const sweepTimer = setInterval(() => service.sweep(), 30_000);
sweepTimer.unref();

server.listen(port, "0.0.0.0", () => {
  console.log(`Fivefold Arc realtime server listening on port ${port}`);
});

async function shutdown() {
  clearInterval(sweepTimer);
  if (competitionTimer) clearInterval(competitionTimer);
  for (const connection of service.connections.values()) service.closeStreams(connection, "server_shutdown");
  await new Promise((resolve) => server.close(resolve));
  await ledger.flush();
  await service.tableDeviceActivity.flush();
  await competitionWriter?.flush();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
