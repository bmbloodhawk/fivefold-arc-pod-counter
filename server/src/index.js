import { createRealtimeServer } from "./app.js";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createPlaytestLedgerFromEnv } from "./playtest-ledger.js";
import { monitorCounterWrites } from './counter-write-monitor.js';
import { createAppearanceCatalogFromEnv } from "./appearance-catalog.js";
import { AccountHistory, accountHistoryStoreForEnvironment } from "./account-history.js";
import { loadAppearanceSkins } from "./appearance-collection.js";
import { createFirebaseIdTokenVerifierFromEnv } from "./firebase-id-token.js";
import { createLocalCommanderIdentityLookup, loadCardIdentityIndex } from "./card-identity-index.js";
import { Competitions, competitionStoreForEnvironment } from './competitions.js';
import { CompetitionRecovery } from './competition-recovery.js';
import { liveStreamLimitsFromEnv } from './live-stream-limits.js';

const port = Number(process.env.PORT ?? 8787);
const appEnv = process.env.APP_ENV ?? "production";
const streamLimits = liveStreamLimitsFromEnv();
const staticDir = resolve(fileURLToPath(new URL("../../client/", import.meta.url)));
const cardIdentityIndex = await loadCardIdentityIndex(resolve(fileURLToPath(new URL("../static-data/card-identity-index.json", import.meta.url))));
const ledger = createPlaytestLedgerFromEnv();
// Staging-only numeric timings; the production path leaves the ledger untouched.
const counterWriteMonitor = monitorCounterWrites(ledger, { appEnv });
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
const competitionWriter = accountHistory ? createPlaytestLedgerFromEnv() : null;
const competitionPrivacyStore = competitionWriter ? competitionStoreForEnvironment(competitionWriter, appEnv) : null;
const competitionStore = process.env.COMPETITIONS_ENABLED === 'true' ? competitionPrivacyStore : null;
// Existing shared identities must remain erasable after a feature rollback.
// This domain has no setup hooks, routes or worker when the feature is disabled.
const competitionEraser = competitionPrivacyStore ? new Competitions({ store: competitionPrivacyStore, podOwnershipEnabled: ["staging", "production"].includes(appEnv) }) : null;
const appearanceSkins = await loadAppearanceSkins({
  path: resolve(staticDir, "appearance-collection.enc"),
  key: process.env.APPEARANCE_PACK_KEY || (appEnv === "staging" ? process.env.STAGING_APPEARANCE_PACK_KEY : ""),
}).catch(() => {
  console.warn("Appearance pack could not be loaded");
  return [];
});
const { server, service, competitions, competitionTables } = createRealtimeServer({
  ...streamLimits, appEnv, staticDir, ledger, appearanceCatalog, accountVerifier, accountHistory, appearanceSkins,
  durableRecoveryEnabled, competitionStore, competitionEraser, lookupCommanderIdentity: createLocalCommanderIdentityLookup(cardIdentityIndex),
});
const competitionRecovery = competitions ? new CompetitionRecovery({ domain: competitions, tables: competitionTables }) : null;
const competitionTimer = competitionRecovery ? setInterval(() => { void competitionRecovery.tick(); }, 15_000) : null;
competitionTimer?.unref();
const sweepTimer = setInterval(() => service.sweep(), 30_000);
sweepTimer.unref();

server.listen(port, "0.0.0.0", () => {
  console.log(`Fivefold Arc realtime server listening on port ${port}`);
  // Optional storage discovery must never delay casual Table availability.
  void competitionRecovery?.tick();
});

async function shutdown() {
  clearInterval(sweepTimer);
  if (competitionTimer) clearInterval(competitionTimer);
  for (const connection of service.connections.values()) service.closeStreams(connection, "server_shutdown");
  await new Promise((resolve) => server.close(resolve));
  await ledger.flush();
  await service.tableDeviceActivity.flush();
  await competitionWriter?.flush();
  counterWriteMonitor.stop();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
