import { createRealtimeServer } from "./app.js";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createPlaytestLedgerFromEnv, FirebasePlaytestLedger } from "./playtest-ledger.js";
import { createAppearanceCatalogFromEnv } from "./appearance-catalog.js";
import { AccountHistory } from "./account-history.js";
import { createFirebaseIdTokenVerifierFromEnv } from "./firebase-id-token.js";
import { createLocalCommanderIdentityLookup, loadCardIdentityIndex } from "./card-identity-index.js";
import { FirebaseRoomStore } from "./room-store.js";

const port = Number(process.env.PORT ?? 8787);
const staticDir = resolve(fileURLToPath(new URL("../../client/", import.meta.url)));
const cardIdentityIndex = await loadCardIdentityIndex(resolve(fileURLToPath(new URL("../static-data/card-identity-index.json", import.meta.url))));
const ledger = createPlaytestLedgerFromEnv();
const appearanceCatalog = createAppearanceCatalogFromEnv({ path: resolve(fileURLToPath(new URL("../data/appearance-studio-catalog.json", import.meta.url))) });
const derivedProjectId = /^https:\/\/([a-z0-9-]+)-default-rtdb\./.exec(process.env.FIREBASE_DATABASE_URL || "")?.[1];
const accountVerifier = createFirebaseIdTokenVerifierFromEnv({ ...process.env, FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || derivedProjectId });
const accountHistory = accountVerifier && process.env.FIREBASE_DATABASE_URL && process.env.FIREBASE_SERVICE_ACCOUNT_EMAIL && process.env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY ? new AccountHistory({ store: ledger }) : null;
const { server, service } = createRealtimeServer({ staticDir, ledger, appearanceCatalog, accountVerifier, accountHistory, appEnv: process.env.APP_ENV, lookupCommanderIdentity: createLocalCommanderIdentityLookup(cardIdentityIndex) });
if (process.env.APP_ENV === "staging") service.durableBenchmark = await runDurableBenchmark();
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

async function runDurableBenchmark() {
  const { FIREBASE_DATABASE_URL: databaseUrl, FIREBASE_SERVICE_ACCOUNT_EMAIL: clientEmail, FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey } = process.env;
  if (!databaseUrl || !clientEmail || !privateKey) return { available: false, reason: "Firebase server credentials are unavailable" };
  const ledger = new FirebasePlaytestLedger({ databaseUrl, clientEmail, privateKey });
  const store = new FirebaseRoomStore({ databaseUrl, accessToken: () => ledger.accessToken() });
  const code = randomBytes(3).toString("hex").toUpperCase();
  const samples = [];
  const elapsed = async (work) => { const started = performance.now(); const result = await work(); return { result, ms: performance.now() - started }; };
  let result;
  let cleanupSucceeded = false;
  try {
    const created = await elapsed(() => store.create({ schemaVersion: 1, code, version: 1, seats: [] }));
    let version = 1;
    for (let index = 0; index < 12; index += 1) {
      const next = { schemaVersion: 1, code, version: version + 1, seats: [] };
      const result = await elapsed(() => store.compareAndSwap(code, version, next));
      if (!result.result.committed) throw new Error("Durable benchmark encountered a version conflict");
      version += 1; samples.push(result.ms);
    }
    const ordered = [...samples].sort((left, right) => left - right);
    const percentile = (ratio) => ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * ratio) - 1)];
    result = { available: true, samples: samples.length, createMs: Math.round(created.ms), p50Ms: Math.round(percentile(.5)), p95Ms: Math.round(percentile(.95)), maxMs: Math.round(ordered.at(-1)) };
  } catch (error) {
    result = { available: false, reason: error?.message || "Durable benchmark failed" };
  } finally {
    try {
      const token = await ledger.accessToken();
      const response = await fetch(`${String(databaseUrl).replace(/\/$/, "")}/live-rooms/${code}.json`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
      cleanupSucceeded = response.ok;
    } catch { /* The response records that the temporary benchmark record was not removed. */ }
  }
  return { ...result, cleanupSucceeded };
}
