import { createRealtimeServer } from "./app.js";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createPlaytestLedgerFromEnv } from "./playtest-ledger.js";
import { createAppearanceCatalogFromEnv } from "./appearance-catalog.js";
import { AccountHistory } from "./account-history.js";
import { createFirebaseIdTokenVerifierFromEnv } from "./firebase-id-token.js";

const port = Number(process.env.PORT ?? 8787);
const staticDir = resolve(fileURLToPath(new URL("../../client/", import.meta.url)));
const ledger = createPlaytestLedgerFromEnv();
const appearanceCatalog = createAppearanceCatalogFromEnv({ path: resolve(fileURLToPath(new URL("../data/appearance-studio-catalog.json", import.meta.url))) });
const derivedProjectId = /^https:\/\/([a-z0-9-]+)-default-rtdb\./.exec(process.env.FIREBASE_DATABASE_URL || "")?.[1];
const accountVerifier = createFirebaseIdTokenVerifierFromEnv({ ...process.env, FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || derivedProjectId });
const accountHistory = accountVerifier && process.env.FIREBASE_DATABASE_URL && process.env.FIREBASE_SERVICE_ACCOUNT_EMAIL && process.env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY ? new AccountHistory({ store: ledger }) : null;
const { server, service } = createRealtimeServer({ staticDir, ledger, appearanceCatalog, accountVerifier, accountHistory });
const sweepTimer = setInterval(() => service.sweep(), 30_000);
sweepTimer.unref();

server.listen(port, "0.0.0.0", () => {
  console.log(`Fivefold Arc realtime server listening on port ${port}`);
});

async function shutdown() {
  clearInterval(sweepTimer);
  for (const connection of service.connections.values()) service.closeStreams(connection, "server_shutdown");
  await new Promise((resolve) => server.close(resolve));
  await ledger.flush();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
