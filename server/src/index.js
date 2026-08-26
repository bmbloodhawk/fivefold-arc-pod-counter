import { createRealtimeServer } from "./app.js";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createPlaytestLedgerFromEnv } from "./playtest-ledger.js";

const port = Number(process.env.PORT ?? 8787);
const staticDir = resolve(fileURLToPath(new URL("../../client/", import.meta.url)));
const { server, service } = createRealtimeServer({ staticDir, ledger: createPlaytestLedgerFromEnv() });
const sweepTimer = setInterval(() => service.sweep(), 30_000);
sweepTimer.unref();

server.listen(port, "0.0.0.0", () => {
  console.log(`Fivefold Arc realtime server listening on port ${port}`);
});

function shutdown() {
  clearInterval(sweepTimer);
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
