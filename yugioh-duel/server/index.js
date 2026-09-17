import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { DuelRoomService } from "./room-service.js";
import { FileDuelStore } from "./duel-store.js";

const port = Number(process.env.PORT || 8790); const root = join(dirname(fileURLToPath(import.meta.url)), "../client"); const dataPath = process.env.DUEL_DATA_FILE || join(dirname(fileURLToPath(import.meta.url)), "../data/duels.json"); const service = new DuelRoomService({ store: new FileDuelStore(dataPath) });
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
function json(res, status, body) { res.writeHead(status, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(body)); }
async function body(req) { const chunks = []; for await (const chunk of req) chunks.push(chunk); try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { throw Object.assign(new Error("Invalid request."), { status: 400, code: "INVALID_JSON" }); } }
function connection(req) { return req.headers["x-connection-id"]; }
async function serveFile(req, res) { const requested = req.url === "/" ? "/index.html" : new URL(req.url, "http://local").pathname; const file = normalize(join(root, requested)); if (!file.startsWith(root)) return false; try { if (!(await stat(file)).isFile()) return false; res.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream" }); res.end(await readFile(file)); return true; } catch { return false; } }
const routes = async (req, res) => {
  const url = new URL(req.url, "http://local"); const parts = url.pathname.split("/").filter(Boolean);
  if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true });
  if (req.method === "POST" && url.pathname === "/api/connections") return json(res, 201, service.connect());
  if (req.method === "POST" && url.pathname === "/api/duels") return json(res, 201, service.create(connection(req), await body(req)));
  if (parts[0] === "api" && parts[1] === "duels" && parts[2]) {
    const code = parts[2];
    if (req.method === "GET" && parts[3] === "events") { const room = service.room(code); res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" }); const send = snapshot => res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`); send(service.snapshot(room)); const unsubscribe = service.subscribe(code, send); req.on("close", unsubscribe); return; }
    if (req.method === "GET" && parts.length === 3) return json(res, 200, { snapshot: service.snapshot(service.room(code)) });
    if (req.method === "POST" && parts[3] === "claim") return json(res, 200, service.claim(code, connection(req), await body(req)));
    if (req.method === "POST" && parts[3] === "adjust") return json(res, 200, service.adjust(code, connection(req), await body(req)));
    if (req.method === "POST" && parts[3] === "correct") return json(res, 200, service.correct(code, connection(req), await body(req)));
    if (req.method === "POST" && parts[3] === "phase" && parts[4] === "advance") return json(res, 200, service.advancePhase(code, connection(req)));
    if (req.method === "POST" && parts[3] === "phase" && parts[4] === "undo") return json(res, 200, service.undoPhase(code, connection(req)));
    if (req.method === "POST" && parts[3] === "outcome") return json(res, 200, service.declareOutcome(code, connection(req), await body(req)));
    if (req.method === "POST" && parts[3] === "next-duel") return json(res, 200, service.nextDuel(code, connection(req), await body(req)));
    if (req.method === "POST" && parts[3] === "randomize") return json(res, 200, service.randomize(code, connection(req), await body(req)));
    if (req.method === "POST" && parts[3] === "shared-notes") return json(res, 200, service.addSharedNote(code, connection(req), await body(req)));
    if (req.method === "POST" && parts[3] === "counters") return json(res, 200, service.addCounter(code, connection(req), await body(req)));
    if (req.method === "POST" && parts[3] === "tokens") return json(res, 200, service.addToken(code, connection(req), await body(req)));
    if (req.method === "POST" && parts[3] === "tools" && parts[4] === "remove") return json(res, 200, service.removeToolItem(code, connection(req), await body(req)));
  }
  if (req.method === "GET" && await serveFile(req, res)) return; json(res, 404, { error: { code: "NOT_FOUND", message: "Not found." } });
};
createServer((req, res) => routes(req, res).catch(error => json(res, error.status || 500, { error: { code: error.code || "SERVER_ERROR", message: error.message || "Unexpected error." } }))).listen(port, () => console.log(`Fivefold Arc Duel running at http://localhost:${port}`));
