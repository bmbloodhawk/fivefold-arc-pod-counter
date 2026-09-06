import { createRealtimeServer } from "./app.js";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createPlaytestLedgerFromEnv } from "./playtest-ledger.js";
import { AppearanceCatalog } from "./appearance-catalog.js";

const port = Number(process.env.PORT ?? 8787);
const staticDir = resolve(fileURLToPath(new URL("../../client/", import.meta.url)));
const ledger = createPlaytestLedgerFromEnv();
const appearanceCatalog = new AppearanceCatalog(resolve(fileURLToPath(new URL("../data/appearance-studio-catalog.json", import.meta.url))));
const { server, service } = createRealtimeServer({ staticDir, ledger, appearanceCatalog });
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
