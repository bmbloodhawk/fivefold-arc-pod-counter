import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import QRCode from "qrcode";
import { NullPlaytestLedger, recapFromRoom } from "./playtest-ledger.js";
import { blankMatchMoment, personalMatchMoment, recordMatchMoment, recordTurnMoment, tableMatchMomentDecisions } from "./match-moments.js";

const JOIN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MUTABLE_COUNTERS = new Set(["life", "radiation", "poison", "energy", "generic", "commanderDamage"]);
const COMMANDER_IDENTITY_TTL_MS = 6 * 60 * 60 * 1000;
const COMMANDER_LOOKUP_TIMEOUT_MS = 6_000;
const COMMANDER_LOOKUP_MIN_INTERVAL_MS = 100;
const MAX_RECENT_OPERATION_IDS = 100;
const DICE_IDENTITY_COLORS = { w: "#eee4c9", u: "#4f92c6", b: "#6f5b91", r: "#bd5a4c", g: "#4f8a63" };
const STATIC_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".svg", "image/svg+xml"],
  [".webmanifest", "application/manifest+json"],
]);

async function serveStatic(res, staticDir, pathname) {
  if (!staticDir) return false;
  const root = resolve(staticDir);
  const requested = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const filePath = resolve(root, requested);
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) return false;
  try {
    if (!(await stat(filePath)).isFile()) return false;
    const body = await readFile(filePath);
    res.writeHead(200, {
      "content-type": STATIC_TYPES.get(extname(filePath).toLowerCase()) ?? "application/octet-stream",
      "cache-control": pathname === "/" || pathname.endsWith(".html") ? "no-cache" : "public, max-age=300",
    });
    res.end(body);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function opaque(bytes = 24) {
  return randomBytes(bytes).toString("base64url");
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest();
}

function tokenMatches(token, expectedHash) {
  if (typeof token !== "string" || !Buffer.isBuffer(expectedHash)) return false;
  return timingSafeEqual(tokenHash(token), expectedHash);
}

function encodedHash(hash) { return Buffer.from(hash).toString("base64url"); }
function decodedHash(hash) { return Buffer.from(String(hash), "base64url"); }

function json(res, status, body, extraHeaders = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders,
  });
  res.end(data);
}

async function serveJoinQr(res, code, origin) {
  const joinUrl = new URL("/", origin);
  joinUrl.searchParams.set("join", code);
  const svg = await QRCode.toString(joinUrl.toString(), { type: "svg", errorCorrectionLevel: "M", margin: 1, width: 320 });
  res.writeHead(200, {
    "content-type": "image/svg+xml; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
  });
  res.end(svg);
}

function diceSkin(key) {
  const normalized = String(key || "").toLowerCase();
  if (!/^(c|w?u?b?r?g?)$/.test(normalized) || normalized === "") return null;
  const colors = normalized === "c" ? ["#80613c", "#3f2c1d"] : [...normalized].map(color => DICE_IDENTITY_COLORS[color]);
  if (colors.some(color => !color)) return null;
  const stops = colors.map((color, index) => `<stop offset="${Math.round(index * 100 / Math.max(colors.length - 1, 1))}%" stop-color="${color}"/>`).join("");
  const label = normalized === "c" ? "Colorless" : normalized.toUpperCase();
  const config = { name: `Fivefold Arc ${label}`, systemName: `fivefold-${normalized}`, author: "Fivefold Arc", version: 1, extends: "default", material: { type: "color", diffuseTexture: { light: "skin.svg", dark: "skin.svg" }, diffuseLevel: 1 }, diceAvailable: ["d20"] };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1024 1024"><defs><linearGradient id="gem" x1="0" y1="0" x2="1" y2="1">${stops}</linearGradient><radialGradient id="shine" cx="28%" cy="18%" r="80%"><stop offset="0" stop-color="#ffffff" stop-opacity=".38"/><stop offset=".42" stop-color="#ffffff" stop-opacity="0"/><stop offset="1" stop-color="#09070c" stop-opacity=".32"/></radialGradient></defs><rect width="1024" height="1024" fill="url(#gem)"/><path d="M0 0 512 0 280 512Z M512 0 1024 0 760 512Z M0 1024 512 1024 280 512Z M512 1024 1024 1024 760 512Z" fill="#ffffff" fill-opacity=".11"/><rect width="1024" height="1024" fill="url(#shine)"/><image x="0" y="0" width="1024" height="1024" href="/vendor/dice-box/assets/themes/default/diffuse-light.png" xlink:href="/vendor/dice-box/assets/themes/default/diffuse-light.png"/></svg>`;
  return { config, svg };
}

function serveDiceSkin(res, key, file) {
  const skin = diceSkin(key); if (!skin) return false;
  if (file === "theme.config.json") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" }); res.end(JSON.stringify(skin.config)); return true;
  }
  if (file === "skin.svg") {
    res.writeHead(200, { "content-type": "image/svg+xml", "cache-control": "public, max-age=300" }); res.end(skin.svg); return true;
  }
  return false;
}

function errorBody(code, message, snapshot) {
  return { error: { code, message }, ...(snapshot ? { snapshot } : {}) };
}

async function readJson(req, limit = 32 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Request body is too large"), { status: 413, code: "BODY_TOO_LARGE" });
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON"), { status: 400, code: "INVALID_JSON" });
  }
}

function asInteger(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw Object.assign(new Error(`${name} must be an integer from ${min} to ${max}`), { status: 400, code: "INVALID_INPUT" });
  }
  return value;
}

function normalizeName(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== "string") throw Object.assign(new Error("name must be text"), { status: 400, code: "INVALID_INPUT" });
  const name = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (!name || Array.from(name).length > 24 || /[\p{Cc}\p{Cf}]/u.test(name)) {
    throw Object.assign(new Error("name must contain 1 to 24 printable characters"), { status: 400, code: "INVALID_INPUT" });
  }
  return name;
}

function normalizeCardName(value) {
  if (typeof value !== "string") throw Object.assign(new Error("Card name must be text"), { status: 400, code: "INVALID_INPUT" });
  const name = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (!name || Array.from(name).length > 120 || /[\p{Cc}\p{Cf}]/u.test(name)) throw Object.assign(new Error("Enter a card name of up to 120 printable characters"), { status: 400, code: "INVALID_INPUT" });
  return name;
}

function normalizeCommanderCount(value, fallback = 1) {
  if (value === undefined) return fallback;
  return asInteger(value, "commanderCount", 1, 2);
}

function normalizeCommanderNames(value, commanderCount, fallback = []) {
  if (value === undefined) return Array.from({ length: commanderCount }, (_, slot) => fallback[slot] || "");
  if (!Array.isArray(value) || value.length !== commanderCount) {
    throw Object.assign(new Error("commanderNames must contain one name for each commander"), { status: 400, code: "INVALID_INPUT" });
  }
  return value.map((candidate) => {
    if (typeof candidate !== "string") throw Object.assign(new Error("commander names must be text"), { status: 400, code: "INVALID_INPUT" });
    const name = candidate.normalize("NFC").trim().replace(/\s+/gu, " ");
    if (Array.from(name).length > 60 || /[\p{Cc}\p{Cf}]/u.test(name)) {
      throw Object.assign(new Error("commander names may contain up to 60 printable characters"), { status: 400, code: "INVALID_INPUT" });
    }
    return name;
  });
}

const COMMANDER_COLORS = new Set(["W", "U", "B", "R", "G"]);

export function createCommanderIdentityLookup(fetchImpl = fetch, { timeoutMs = COMMANDER_LOOKUP_TIMEOUT_MS, now = () => Date.now() } = {}) {
  const cache = new Map();
  let nextRequestAt = 0;
  return async (rawName) => {
    const name = normalizeCommanderNames([rawName], 1)[0];
    if (!name) throw Object.assign(new Error("A commander name is required"), { status: 400, code: "INVALID_INPUT" });
    const cached = cache.get(name.toLocaleLowerCase());
    if (cached && cached.expiresAt > now()) return cached.value;
    const waitMs = Math.max(0, nextRequestAt - now());
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    nextRequestAt = now() + COMMANDER_LOOKUP_MIN_INTERVAL_MS;
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`, { signal: abort.signal, headers: { accept: "application/json", "user-agent": "Fivefold Arc Pod Counter/0.1 (commander identity lookup)" } });
    } catch {
      throw Object.assign(new Error("Commander lookup is temporarily unavailable. You can still start without a color identity."), { status: 503, code: "COMMANDER_LOOKUP_UNAVAILABLE" });
    } finally { clearTimeout(timeout); }
    if (response.status === 404) throw Object.assign(new Error("Commander not found. Check the spelling and try again."), { status: 404, code: "COMMANDER_NOT_FOUND" });
    if (!response.ok) throw Object.assign(new Error("Commander lookup is temporarily unavailable. You can still start without a color identity."), { status: 503, code: "COMMANDER_LOOKUP_UNAVAILABLE" });
    const card = await response.json();
    const value = { name: String(card.name || name), colors: normalizeCommanderColors([Array.isArray(card.color_identity) ? card.color_identity : []], 1)[0] };
    cache.set(name.toLocaleLowerCase(), { value, expiresAt: now() + COMMANDER_IDENTITY_TTL_MS });
    return value;
  };
}

function normalizeCommanderColors(value, commanderCount, fallback = []) {
  if (value === undefined) return Array.from({ length: commanderCount }, (_, slot) => [...(fallback[slot] || [])]);
  if (!Array.isArray(value) || value.length !== commanderCount) {
    throw Object.assign(new Error("commanderColors must contain one color list for each commander"), { status: 400, code: "INVALID_INPUT" });
  }
  return value.map((colors) => {
    if (!Array.isArray(colors) || colors.some((color) => typeof color !== "string" || !COMMANDER_COLORS.has(color))) {
      throw Object.assign(new Error("commander colors must use W, U, B, R, or G"), { status: 400, code: "INVALID_INPUT" });
    }
    return [...new Set(colors)];
  });
}

function normalizeRoundLimitMinutes(value) {
  if (value === undefined || value === null || value === "") return null;
  return asInteger(value, "roundLimitMinutes", 1, 999);
}

function commanderSourceId(seatId, slot) {
  return `seat-${seatId}-commander-${slot === 0 ? "a" : "b"}`;
}

function ownCommanderSourceIds(seat, commanderCount = seat.commanderCount) {
  if (!seat.claimed) return [];
  return Array.from({ length: commanderCount }, (_, slot) => commanderSourceId(seat.seatId, slot));
}

function commanderSources(room) {
  return room.seats.flatMap((seat) => {
    if (!seat.claimed) return [];
    const playerLabel = seat.name;
    return Array.from({ length: seat.commanderCount }, (_, slot) => {
      const commanderName = seat.commanderNames[slot] || "";
      const colors = [...(seat.commanderColors[slot] || [])];
      return {
        id: commanderSourceId(seat.seatId, slot),
        label: commanderName || (seat.commanderCount === 1 ? playerLabel : `${playerLabel} ${slot === 0 ? "A" : "B"}`),
        ...(commanderName ? { commanderName } : {}),
        ...(colors.length ? { commanderColors: colors } : {}),
        ownerSeatId: seat.seatId,
      };
    });
  });
}

function synchronizeCommanderState(room) {
  const sources = commanderSources(room);
  for (const seat of room.seats) {
    if (!seat.claimed) {
      seat.commanderDamageReceived = {};
      seat.commanderCastCounts = {};
      continue;
    }
    const previous = seat.commanderDamageReceived;
    seat.commanderDamageReceived = Object.fromEntries(
      sources
        .filter((source) => source.ownerSeatId !== seat.seatId || (previous[source.id] || 0) > 0)
        .map((source) => [source.id, Object.hasOwn(previous, source.id) ? previous[source.id] : 0]),
    );
    const previousCastCounts = seat.commanderCastCounts;
    seat.commanderCastCounts = Object.fromEntries(
      ownCommanderSourceIds(seat).map((sourceId) => [
        sourceId,
        Object.hasOwn(previousCastCounts, sourceId) ? previousCastCounts[sourceId] : 0,
      ]),
    );
  }
}

function seatIsEliminated(seat) {
  return seat.counters.life <= 0
    || seat.counters.poison >= 10
    || Object.values(seat.commanderDamageReceived).some((damage) => damage >= 21);
}

function createStartingPlayerRoll(claimedSeats, selectedAt) {
  const contenderSeatIds = claimedSeats.map((seat) => seat.seatId);
  return { startedAt: selectedAt, status: "rolling", winnerSeatId: null, rounds: [{ contenderSeatIds, rolls: [] }] };
}

// Card titles are requested only after player confirmation. This layer keeps no
// search cache or persistence and is intentionally separate from rules advice.
export function createCardLookup(fetchImpl = fetch, { timeoutMs = COMMANDER_LOOKUP_TIMEOUT_MS } = {}) {
  return async (rawName) => {
    const name = normalizeCardName(rawName);
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`, { signal: abort.signal, headers: { accept: "application/json", "user-agent": "Fivefold Arc Pod Counter/0.1 (player-confirmed card lookup)" } });
    } catch {
      throw Object.assign(new Error("Card lookup is temporarily unavailable. Check the card in Gatherer instead."), { status: 503, code: "CARD_LOOKUP_UNAVAILABLE" });
    } finally { clearTimeout(timeout); }
    if (response.status === 404) throw Object.assign(new Error("No exact card name was found. Check or edit the title, then try again."), { status: 404, code: "CARD_NOT_FOUND" });
    if (!response.ok) throw Object.assign(new Error("Card lookup is temporarily unavailable. Check the card in Gatherer instead."), { status: 503, code: "CARD_LOOKUP_UNAVAILABLE" });
    const card = await response.json();
    // Rulings are supporting material, not a substitute for Oracle text. A
    // failed rulings request must never turn a valid card lookup into an error.
    let rulings = [];
    if (typeof card.rulings_uri === "string") {
      const rulingsAbort = new AbortController();
      const rulingsTimeout = setTimeout(() => rulingsAbort.abort(), timeoutMs);
      try {
        const rulingsResponse = await fetchImpl(card.rulings_uri, { signal: rulingsAbort.signal, headers: { accept: "application/json", "user-agent": "Fivefold Arc Pod Counter/0.1 (player-confirmed card rulings)" } });
        if (rulingsResponse.ok) {
          const payload = await rulingsResponse.json();
          rulings = Array.isArray(payload.data) ? payload.data.slice(-20).map((ruling) => ({ source: String(ruling.source || "Unknown source"), publishedAt: String(ruling.published_at || "Unknown date"), comment: String(ruling.comment || "") })).filter((ruling) => ruling.comment) : [];
        }
      } catch { /* Oracle data remains usable when rulings are unavailable. */ }
      finally { clearTimeout(rulingsTimeout); }
    }
    const faces = Array.isArray(card.card_faces) ? card.card_faces.map((face) => ({ name: String(face.name || ""), typeLine: String(face.type_line || ""), manaCost: String(face.mana_cost || ""), oracleText: String(face.oracle_text || "") })).filter((face) => face.name) : [];
    const oracleText = typeof card.oracle_text === "string" ? card.oracle_text : faces.map((face) => `${face.name}${face.oracleText ? ` — ${face.oracleText}` : ""}`).join("\n");
    return { name: String(card.name || name), oracleId: typeof card.oracle_id === "string" ? card.oracle_id : null, layout: typeof card.layout === "string" ? card.layout : "normal", typeLine: typeof card.type_line === "string" ? card.type_line : "", manaCost: typeof card.mana_cost === "string" ? card.mana_cost : "", oracleText, faces, rulings, scryfallUrl: typeof card.scryfall_uri === "string" ? card.scryfall_uri : null, gathererUrl: typeof card.related_uris?.gatherer === "string" ? card.related_uris.gatherer : null, retrievedAt: new Date().toISOString() };
  };
}

// Commander Spellbook is a community-maintained combo catalogue. It is used
// only as a separately labelled supplement to Oracle text and official rules.
export function createCardInteractionLookup(fetchImpl = fetch, { timeoutMs = COMMANDER_LOOKUP_TIMEOUT_MS } = {}) {
  return async (rawFirst, rawSecond) => {
    const first = normalizeCardName(rawFirst);
    const second = normalizeCardName(rawSecond);
    const query = `card:"${first.replaceAll('"', '\\"')}" card:"${second.replaceAll('"', '\\"')}"`;
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`https://backend.commanderspellbook.com/variants/?q=${encodeURIComponent(query)}&limit=3`, { signal: abort.signal, headers: { accept: "application/json", "user-agent": "Fivefold Arc Pod Counter/0.1 (player-requested combo lookup)" } });
      if (!response.ok) throw new Error("Combo lookup unavailable");
      const payload = await response.json();
      const combos = Array.isArray(payload.results) ? payload.results.slice(0, 3).map((variant) => ({
        id: String(variant.id || ""),
        description: String(variant.description || ""),
        result: Array.isArray(variant.produces) ? variant.produces.map((item) => String(item.feature?.name || "")).filter(Boolean) : [],
        prerequisites: [String(variant.easyPrerequisites || ""), String(variant.notablePrerequisites || ""), ...(Array.isArray(variant.requires) ? variant.requires.map((item) => String(item.template?.name || "")).filter(Boolean) : []), ...(Array.isArray(variant.uses) ? variant.uses.map((item) => String(item.battlefieldCardState || "")).filter(Boolean) : [])].filter(Boolean),
        sourceUrl: variant.id ? `https://backend.commanderspellbook.com/variants/${encodeURIComponent(variant.id)}/` : "https://commanderspellbook.com/",
      })).filter((combo) => combo.id && combo.description) : [];
      return { source: "Commander Spellbook", sourceUrl: "https://commanderspellbook.com/", combos, retrievedAt: new Date().toISOString() };
    } catch {
      return { source: "Commander Spellbook", sourceUrl: "https://commanderspellbook.com/", combos: [], retrievedAt: new Date().toISOString(), unavailable: true };
    } finally { clearTimeout(timeout); }
  };
}

function recordLastPlayerStanding(room, now) {
  if (room.gameResult || !room.turn.gameStarted) return;
  const claimedSeats = room.seats.filter((seat) => seat.claimed);
  if (claimedSeats.length < 2) return;
  const survivors = claimedSeats.filter((seat) => !seatIsEliminated(seat));
  if (survivors.length === 1) {
    room.gameResult = { winnerSeatId: survivors[0].seatId, reason: "last_player_standing", decidedAt: now };
  }
}

export class RoomService {
  constructor({ now = () => Date.now(), roomTtlMs = 6 * 60 * 60 * 1000, connectionTtlMs = 90 * 1000, ledger = new NullPlaytestLedger() } = {}) {
    this.now = now;
    this.roomTtlMs = roomTtlMs;
    this.connectionTtlMs = connectionTtlMs;
    this.rooms = new Map();
    this.connections = new Map();
    this.ledger = ledger;
  }

  createConnection() {
    this.sweep();
    const connectionId = opaque();
    this.connections.set(connectionId, { connectionId, seatKey: null, lastSeen: this.now(), streams: new Set() });
    return { connectionId, expiresInMs: this.connectionTtlMs };
  }

  getConnection(connectionId, { touch = true } = {}) {
    const connection = typeof connectionId === "string" ? this.connections.get(connectionId) : null;
    if (!connection || this.now() - connection.lastSeen > this.connectionTtlMs) {
      if (connection) this.expireConnection(connection);
      throw Object.assign(new Error("Create a new connection and reclaim the seat"), { status: 401, code: "CONNECTION_EXPIRED" });
    }
    if (touch) connection.lastSeen = this.now();
    return connection;
  }

  heartbeat(connectionId) {
    const connection = this.getConnection(connectionId);
    return { ok: true, expiresInMs: this.connectionTtlMs };
  }

  makeJoinCode() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const bytes = randomBytes(6);
      let code = "";
      for (const byte of bytes) code += JOIN_ALPHABET[byte % JOIN_ALPHABET.length];
      if (!this.rooms.has(code)) return code;
    }
    throw Object.assign(new Error("Could not allocate a room code"), { status: 503, code: "CODE_SPACE_BUSY" });
  }

  createRoom(connectionId, input = {}) {
    const connection = this.getConnection(connectionId);
    if (connection.seatKey) throw Object.assign(new Error("One connection may own only one seat"), { status: 409, code: "CONNECTION_HAS_SEAT" });
    const playerCount = asInteger(input.playerCount, "playerCount", 2, 8);
    const startingLife = asInteger(input.startingLife, "startingLife", 20, 40);
    if (![20, 30, 40].includes(startingLife)) throw Object.assign(new Error("startingLife must be 20, 30, or 40"), { status: 400, code: "INVALID_INPUT" });
    const commanderCount = normalizeCommanderCount(input.commanderCount);
    const commanderNames = normalizeCommanderNames(input.commanderNames, commanderCount);
    const commanderColors = normalizeCommanderColors(input.commanderColors, commanderCount);
    const roundLimitMinutes = normalizeRoundLimitMinutes(input.roundLimitMinutes);
    const startedAt = this.now();
    const code = this.makeJoinCode();
    const reclaimToken = opaque(32);
    const hostRecoveryKey = opaque(32);
    const seats = Array.from({ length: playerCount }, (_, seatId) => ({
      seatId,
      name: seatId === 0 ? normalizeName(input.name, "P1") : `P${seatId + 1}`,
      claimed: seatId === 0,
      ownerConnectionId: seatId === 0 ? connectionId : null,
      tokenHash: seatId === 0 ? tokenHash(reclaimToken) : null,
      recentOperationIds: new Map(),
      commanderCount: seatId === 0 ? commanderCount : 1,
      commanderNames: seatId === 0 ? commanderNames : [""],
      commanderColors: seatId === 0 ? commanderColors : [[]],
      counters: { life: startingLife, radiation: 0, poison: 0, energy: 0, generic: 0 },
      commanderDamageReceived: {},
      commanderCastCounts: {},
      matchMoment: blankMatchMoment(startingLife),
    }));
    const room = {
      code,
      version: 1,
      createdAt: startedAt,
      lastActiveAt: startedAt,
      hostSeatId: 0,
      config: { playerCount, startingLife, roundLimitMinutes },
      lastCoinToss: null,
      gameResult: null,
      sessionKind: "standard",
      turn: {
        activeSeatId: 0,
        gameStarted: false,
        gameStartedAt: null,
        turnStartedAt: null,
        roundEndsAt: null,
        startingPlayerSeatId: null,
        startingPlayerRoll: null,
        lastHandoff: null,
        trackingEnabled: true,
        cuesEnabled: false,
        pausedAt: null,
        pausedDurationMs: 0,
      },
      seats,
      playtestNotes: [],
      gameId: opaque(12),
      ledgerSequence: 0,
      ledgerLastCheckpointAt: startedAt,
      ledgerCompletedAt: null,
      hostRecoveryKeyHash: tokenHash(hostRecoveryKey),
    };
    synchronizeCommanderState(room);
    this.rooms.set(code, room);
    this.recordLedger(room, "room_created", 0, { playerCount, startingLife });
    connection.seatKey = `${code}:0`;
    return { snapshot: this.snapshot(room), seatId: 0, reclaimToken, hostRecoveryKey };
  }

  room(code) {
    const room = this.rooms.get(String(code || "").toUpperCase());
    if (!room) throw Object.assign(new Error("Room not found or expired"), { status: 404, code: "ROOM_NOT_FOUND" });
    room.lastActiveAt = this.now();
    return room;
  }

  snapshot(room) {
    const sources = commanderSources(room);
    return {
      code: room.code,
      version: room.version,
      hostSeatId: room.hostSeatId,
      config: { ...room.config },
      lastCoinToss: room.lastCoinToss ? { ...room.lastCoinToss } : null,
      gameResult: room.gameResult ? { ...room.gameResult } : null,
      sessionKind: room.sessionKind || "standard",
      turn: {
        activeSeatId: room.turn.activeSeatId,
        gameStarted: room.turn.gameStarted,
        gameStartedAt: room.turn.gameStartedAt,
        turnStartedAt: room.turn.turnStartedAt,
        roundEndsAt: room.turn.roundEndsAt,
        startingPlayerSeatId: room.turn.startingPlayerSeatId,
        startingPlayerRoll: room.turn.startingPlayerRoll ? {
          ...room.turn.startingPlayerRoll,
          rounds: room.turn.startingPlayerRoll.rounds.map((round) => ({
            rolls: round.rolls.map((roll) => ({ ...roll })),
            contenderSeatIds: [...round.contenderSeatIds],
            ...(round.tiedSeatIds ? { tiedSeatIds: [...round.tiedSeatIds] } : {}),
          })),
        } : null,
        lastHandoff: room.turn.lastHandoff ? { ...room.turn.lastHandoff } : null,
        trackingEnabled: room.turn.trackingEnabled !== false,
        cuesEnabled: room.turn.cuesEnabled === true,
        pausedAt: room.turn.pausedAt ?? null,
        pausedDurationMs: room.turn.pausedDurationMs ?? 0,
      },
      commanderSources: sources,
      seats: room.seats.map(({ seatId, name, claimed, ownerConnectionId, commanderCount, commanderNames, commanderColors, counters, commanderDamageReceived, commanderCastCounts }) => ({
        seatId,
        name,
        claimed,
        connected: Boolean(ownerConnectionId),
        commanderCount,
        commanderNames: [...commanderNames],
        commanderColors: commanderColors.map((colors) => [...colors]),
        counters: { ...counters },
        commanderDamageReceived: { ...commanderDamageReceived },
        commanderCastCounts: { ...commanderCastCounts },
        nextCommanderTax: Object.fromEntries(
          Object.entries(commanderCastCounts).map(([sourceId, castCount]) => [sourceId, castCount * 2]),
        ),
      })),
    };
  }

  recordLedger(room, type, actorSeatId, detail = {}) {
    const at = this.now();
    const event = { gameId: room.gameId, roomCode: room.code, sequence: ++room.ledgerSequence, at, type, actorSeatId, ...detail };
    this.ledger.record(event);
    // This record is deliberately server-private: it contains only hashes of
    // credentials, never the reclaim or host recovery secrets themselves.
    this.ledger.recovery(this.recoveryRecord(room, at));
    if (event.sequence % 25 === 0 || at - room.ledgerLastCheckpointAt >= 60_000) {
      this.ledger.checkpoint({ gameId: room.gameId, roomCode: room.code, sequence: event.sequence, at, recap: recapFromRoom(room, at), snapshot: this.snapshot(room) });
      room.ledgerLastCheckpointAt = at;
    }
  }

  completePlaytest(room, completedAt, { incomplete = false } = {}) {
    if (room.ledgerCompletedAt) return;
    room.ledgerCompletedAt = completedAt;
    const recap = {
      ...recapFromRoom(room, completedAt),
      notes: room.playtestNotes.map((note) => ({ ...note })),
      incomplete,
    };
    if (room.gameResult) {
      const decisions = tableMatchMomentDecisions({ seats: room.seats, winnerSeatId: room.gameResult.winnerSeatId, seed: room.gameId });
      recap.accolades = room.seats.filter((seat) => seat.claimed).map((seat) => ({ seatId: seat.seatId, name: seat.name, ...decisions.get(seat.seatId) }));
      recap.accoladeCounts = recap.accolades.reduce((counts, selection) => ({ ...counts, [selection.moment.category]: (counts[selection.moment.category] || 0) + 1 }), {});
    }
    this.ledger.complete(recap);
  }

  recordCompletion(room) {
    if (!room.gameResult) return;
    this.completePlaytest(room, room.gameResult.decidedAt);
  }

  listPlaytestNotes(code, connectionId) {
    const room = this.room(code); this.requireOwner(room, connectionId);
    return { notes: room.playtestNotes.map((note) => ({ ...note })), gameId: room.gameId };
  }

  addPlaytestNote(code, connectionId, input = {}) {
    const room = this.room(code); const { seatId } = this.requireOwner(room, connectionId);
    if (typeof input.text !== "string") throw Object.assign(new Error("A note must be text"), { status: 400, code: "INVALID_INPUT" });
    const text = input.text.normalize("NFC").trim().replace(/\s+/gu, " ");
    if (!text || Array.from(text).length > 500 || /[\p{Cc}\p{Cf}]/u.test(text)) throw Object.assign(new Error("Notes must contain 1 to 500 printable characters"), { status: 400, code: "INVALID_INPUT" });
    const note = { noteId: opaque(12), gameId: room.gameId, roomCode: room.code, authorSeatId: seatId, authorName: room.seats[seatId].name, createdAt: this.now(), text };
    room.playtestNotes.push(note); this.ledger.note(note); this.recordLedger(room, "playtest_note_added", seatId, { noteId: note.noteId }); this.broadcast(room);
    return { note: { ...note } };
  }

  playtestRecap(code, connectionId) {
    const room = this.room(code); const { seatId } = this.requireOwner(room, connectionId);
    if (seatId !== room.hostSeatId) throw Object.assign(new Error("Only the host may view the playtest recap"), { status: 403, code: "HOST_ONLY" });
    return { recap: { ...recapFromRoom(room, this.now()), notes: room.playtestNotes.map((note) => ({ ...note })) } };
  }

  personalMatchMoment(code, connectionId) {
    const room = this.room(code); const { seat } = this.requireOwner(room, connectionId);
    if (!room.gameResult) throw Object.assign(new Error("A match moment is available after the game ends"), { status: 409, code: "GAME_NOT_COMPLETE" });
    return { moment: personalMatchMoment({ seat, seats: room.seats, winnerSeatId: room.gameResult.winnerSeatId, seed: room.gameId }) };
  }

  async developerFieldTestInsights() {
    const tests = await this.ledger.listFieldTests();
    const recaps = await this.ledger.listArchive();
    const countBy = (key) => tests.reduce((summary, test) => { const value = String(test[key] || "unknown"); summary[value] = (summary[value] || 0) + 1; return summary; }, {});
    const issueCounts = tests.reduce((summary, test) => { for (const issue of test.issues || []) summary[issue] = (summary[issue] || 0) + 1; return summary; }, {});
    const average = (key) => tests.length ? Math.round(tests.reduce((total, test) => total + Math.max(0, Number(test[key]) || 0), 0) / tests.length) : 0;
    return {
      fieldTestCount: tests.length,
      averageSetupMs: average("setupMs"),
      averageElapsedMs: average("elapsedMs"),
      playerCounts: countBy("playerCount"),
      deviceMix: countBy("deviceMix"),
      repeatUse: countBy("repeatUse"),
      disputes: countBy("dispute"),
      accoladeCounts: recaps.reduce((counts, recap) => Object.entries(recap.accoladeCounts || {}).reduce((next, [category, count]) => ({ ...next, [category]: (next[category] || 0) + Number(count || 0) }), counts), {}),
      accoladeReuse: recaps.reduce((counts, recap) => Object.entries(recap.accoladeCounts || {}).reduce((next, [category, count]) => Number(count) > 1 ? ({ ...next, [category]: (next[category] || 0) + Number(count) - 1 }) : next, counts), {}),
      friction: issueCounts,
    };
  }

  claimSeat(code, connectionId, input = {}) {
    const room = this.room(code);
    const connection = this.getConnection(connectionId);
    const seatId = asInteger(input.seatId, "seatId", 0, room.config.playerCount - 1);
    const seatKey = `${room.code}:${seatId}`;
    if (connection.seatKey && connection.seatKey !== seatKey) {
      throw Object.assign(new Error("One connection may own only one seat"), { status: 409, code: "CONNECTION_HAS_SEAT" });
    }
    const seat = room.seats[seatId];
    let reclaimToken = input.reclaimToken;
    if (!seat.claimed) {
      const name = normalizeName(input.name, seat.name);
      const commanderCount = normalizeCommanderCount(input.commanderCount);
      const commanderNames = normalizeCommanderNames(input.commanderNames, commanderCount);
      const commanderColors = normalizeCommanderColors(input.commanderColors, commanderCount);
      reclaimToken = opaque(32);
      seat.claimed = true;
      seat.tokenHash = tokenHash(reclaimToken);
      seat.recentOperationIds = new Map();
      seat.name = name;
      seat.commanderCount = commanderCount;
      seat.commanderNames = commanderNames;
      seat.commanderColors = commanderColors;
    } else {
      if (!tokenMatches(reclaimToken, seat.tokenHash)) {
        throw Object.assign(new Error("That seat is reserved; its reclaim token is required"), { status: 403, code: "SEAT_RESERVED" });
      }
      const name = normalizeName(input.name, seat.name);
      if (input.commanderCount !== undefined && normalizeCommanderCount(input.commanderCount) !== seat.commanderCount) {
        throw Object.assign(new Error("A reclaim cannot change commanderCount; reclaim first, then use an exact-version owner mutation"), {
          status: 409,
          code: "COMMANDER_COUNT_MISMATCH",
          snapshot: this.snapshot(room),
        });
      }
      if (input.commanderNames !== undefined) seat.commanderNames = normalizeCommanderNames(input.commanderNames, seat.commanderCount, seat.commanderNames);
      if (input.commanderColors !== undefined) seat.commanderColors = normalizeCommanderColors(input.commanderColors, seat.commanderCount, seat.commanderColors);
      seat.name = name;
      if (seat.ownerConnectionId && seat.ownerConnectionId !== connectionId) {
        const oldConnection = this.connections.get(seat.ownerConnectionId);
        if (oldConnection) {
          oldConnection.seatKey = null;
          this.closeStreams(oldConnection, "reclaimed");
        }
      }
    }
    seat.ownerConnectionId = connectionId;
    connection.seatKey = seatKey;
    synchronizeCommanderState(room);
    room.version += 1;
    this.recordLedger(room, seat.claimed && input.reclaimToken ? "seat_reclaimed" : "seat_claimed", seatId, { name: seat.name, commanderCount: seat.commanderCount });
    this.broadcast(room);
    return { snapshot: this.snapshot(room), seatId, ...(!input.reclaimToken ? { reclaimToken } : {}) };
  }

  requireOwner(room, connectionId) {
    const connection = this.getConnection(connectionId);
    if (!connection.seatKey?.startsWith(`${room.code}:`)) {
      throw Object.assign(new Error("This connection does not own a seat in the room"), { status: 403, code: "NOT_SEAT_OWNER" });
    }
    const seatId = Number(connection.seatKey.slice(room.code.length + 1));
    const seat = room.seats[seatId];
    if (!seat || seat.ownerConnectionId !== connectionId) {
      throw Object.assign(new Error("Seat ownership changed; reconnect and reclaim"), { status: 403, code: "NOT_SEAT_OWNER" });
    }
    return { connection, seat, seatId };
  }

  mutateOwnSeat(code, connectionId, input = {}) {
    const room = this.room(code);
    const { seat } = this.requireOwner(room, connectionId);
    if (input.baseVersion !== room.version) {
      throw Object.assign(new Error("State changed; apply the latest snapshot before retrying"), {
        status: 409,
        code: "VERSION_CONFLICT",
        snapshot: this.snapshot(room),
      });
    }
    const counters = input.counters ?? {};
    if (!counters || typeof counters !== "object" || Array.isArray(counters)) {
      throw Object.assign(new Error("counters must be an object"), { status: 400, code: "INVALID_INPUT" });
    }
    const nextCounters = { ...seat.counters };
    for (const [key, value] of Object.entries(counters)) {
      if (!MUTABLE_COUNTERS.has(key)) throw Object.assign(new Error(`Unknown counter: ${key}`), { status: 400, code: "INVALID_INPUT" });
      const min = key === "life" ? -999 : 0;
      nextCounters[key] = asInteger(value, key, min, 999);
    }
    const nextCommander = { ...seat.commanderDamageReceived };
    const commander = input.commanderDamageReceived ?? {};
    if (!commander || typeof commander !== "object" || Array.isArray(commander)) {
      throw Object.assign(new Error("commanderDamageReceived must be an object"), { status: 400, code: "INVALID_INPUT" });
    }
    const allowedCommanderSources = new Set(commanderSources(room).map((source) => source.id));
    for (const [source, value] of Object.entries(commander)) {
      if (!allowedCommanderSources.has(source)) {
        throw Object.assign(new Error("Commander damage may reference only another claimed seat's active commander source"), {
          status: 400,
          code: "INVALID_INPUT",
        });
      }
      nextCommander[source] = asInteger(value, `commanderDamageReceived.${source}`, 0, 999);
    }
    const hasCommanderCount = input.commanderCount !== undefined;
    const nextCommanderCount = normalizeCommanderCount(input.commanderCount, seat.commanderCount);
    const hasCommanderNames = input.commanderNames !== undefined;
    const nextCommanderNames = normalizeCommanderNames(input.commanderNames, nextCommanderCount, seat.commanderNames);
    const nextCommanderColors = normalizeCommanderColors(input.commanderColors, nextCommanderCount, seat.commanderColors);
    const hasName = input.name !== undefined;
    const nextName = normalizeName(input.name, seat.name);
    const commanderCastCounts = input.commanderCastCounts === undefined ? {} : input.commanderCastCounts;
    if (!commanderCastCounts || typeof commanderCastCounts !== "object" || Array.isArray(commanderCastCounts)) {
      throw Object.assign(new Error("commanderCastCounts must be an object"), { status: 400, code: "INVALID_INPUT" });
    }
    if (input.nextCommanderTax !== undefined) {
      throw Object.assign(new Error("nextCommanderTax is derived from commanderCastCounts and cannot be mutated"), {
        status: 400,
        code: "INVALID_INPUT",
      });
    }
    const currentlyActiveOwnSources = new Set(ownCommanderSourceIds(seat));
    const nextActiveOwnSources = new Set(ownCommanderSourceIds(seat, nextCommanderCount));
    const nextCommanderCastCounts = { ...seat.commanderCastCounts };
    for (const [sourceId, value] of Object.entries(commanderCastCounts)) {
      if (!currentlyActiveOwnSources.has(sourceId) || !nextActiveOwnSources.has(sourceId)) {
        throw Object.assign(new Error("Commander cast counts may reference only the owner's active commander sources"), {
          status: 400,
          code: "INVALID_INPUT",
        });
      }
      nextCommanderCastCounts[sourceId] = asInteger(value, `commanderCastCounts.${sourceId}`, 0, 999);
    }
    if (Object.keys(counters).length === 0 && Object.keys(commander).length === 0 && Object.keys(commanderCastCounts).length === 0 && !hasCommanderCount && !hasCommanderNames && !hasName) {
      throw Object.assign(new Error("Mutation contains no changes"), { status: 400, code: "INVALID_INPUT" });
    }
    seat.name = nextName;
    seat.counters = nextCounters;
    seat.commanderDamageReceived = nextCommander;
    seat.commanderCastCounts = nextCommanderCastCounts;
    seat.commanderCount = nextCommanderCount;
    seat.commanderNames = nextCommanderNames;
    seat.commanderColors = nextCommanderColors;
    synchronizeCommanderState(room);
    recordLastPlayerStanding(room, this.now());
    room.version += 1;
    this.recordLedger(room, "seat_configured", seat.seatId, {
      counters: Object.keys(counters), commanderDamageSources: Object.keys(commander), commanderCastSources: Object.keys(commanderCastCounts),
      renamed: hasName, commanderCountChanged: hasCommanderCount, commanderNamesChanged: hasCommanderNames,
    });
    this.recordCompletion(room);
    this.broadcast(room);
    return { snapshot: this.snapshot(room) };
  }

  adjustOwnSeat(code, connectionId, input = {}) {
    const room = this.room(code);
    const { seat } = this.requireOwner(room, connectionId);
    const operationId = input.operationId;
    if (operationId !== undefined && (typeof operationId !== "string" || operationId.length < 16 || operationId.length > 128)) {
      throw Object.assign(new Error("operationId must be a client-generated opaque identifier"), { status: 400, code: "INVALID_INPUT" });
    }
    if (operationId && seat.recentOperationIds.has(operationId)) return { snapshot: seat.recentOperationIds.get(operationId), deduplicated: true };
    const counter = input.counter;
    const delta = asInteger(input.delta, "delta", -999, 999);
    if (!MUTABLE_COUNTERS.has(counter) || delta === 0) {
      throw Object.assign(new Error("Adjustments require one supported counter and a non-zero delta"), { status: 400, code: "INVALID_INPUT" });
    }
    let applied = delta;
    if (counter === "commanderDamage") {
      const sourceId = input.commanderSourceId;
      const allowed = new Set(commanderSources(room).map((source) => source.id));
      if (!allowed.has(sourceId)) {
        throw Object.assign(new Error("Commander damage may reference only a claimed seat's active commander source"), { status: 400, code: "INVALID_INPUT" });
      }
      applied = Math.max(-seat.commanderDamageReceived[sourceId], delta);
      seat.commanderDamageReceived[sourceId] += applied;
      seat.counters.life = Math.max(-999, Math.min(999, seat.counters.life - applied));
    } else {
      const minimum = counter === "life" ? -999 : 0;
      seat.counters[counter] = Math.max(minimum, Math.min(999, (seat.counters[counter] ?? 0) + delta));
    }
    recordMatchMoment(seat, { counter, delta: applied, commanderSourceId: input.commanderSourceId, lifeAfter: seat.counters.life, gameStarted: room.turn.gameStarted, isOwnTurn: room.turn.activeSeatId === seat.seatId });
    recordLastPlayerStanding(room, this.now());
    room.version += 1;
    this.recordLedger(room, "counter_adjusted", seat.seatId, { counter, delta: applied, ...(counter === "commanderDamage" ? { commanderSourceId: input.commanderSourceId } : {}) });
    this.recordCompletion(room);
    this.broadcast(room);
    const snapshot = this.snapshot(room);
    if (operationId) {
      seat.recentOperationIds.set(operationId, snapshot);
      while (seat.recentOperationIds.size > MAX_RECENT_OPERATION_IDS) seat.recentOperationIds.delete(seat.recentOperationIds.keys().next().value);
    }
    return { snapshot };
  }

  resetRoom(code, connectionId, input = {}) {
    const room = this.room(code);
    const { seatId } = this.requireOwner(room, connectionId);
    if (seatId !== room.hostSeatId) throw Object.assign(new Error("Only the host seat may reset the room"), { status: 403, code: "HOST_ONLY" });
    if (input.baseVersion !== room.version) {
      throw Object.assign(new Error("State changed; apply the latest snapshot before retrying"), { status: 409, code: "VERSION_CONFLICT", snapshot: this.snapshot(room) });
    }
    this.completePlaytest(room, this.now(), { incomplete: !room.gameResult });
    for (const seat of room.seats) {
      seat.counters = { life: room.config.startingLife, radiation: 0, poison: 0, energy: 0, generic: 0 };
      seat.matchMoment = blankMatchMoment(room.config.startingLife);
      seat.commanderDamageReceived = Object.fromEntries(
        Object.keys(seat.commanderDamageReceived).map((sourceId) => [sourceId, 0]),
      );
      seat.commanderCastCounts = Object.fromEntries(
        Object.keys(seat.commanderCastCounts).map((sourceId) => [sourceId, 0]),
      );
    }
    room.lastCoinToss = null;
    room.gameResult = null;
    room.gameId = opaque(12);
    room.ledgerSequence = 0;
    room.ledgerLastCheckpointAt = this.now();
    room.ledgerCompletedAt = null;
    room.turn = {
      activeSeatId: 0,
      gameStarted: false,
      gameStartedAt: null,
      turnStartedAt: null,
      roundEndsAt: null,
      startingPlayerSeatId: null,
      startingPlayerRoll: null,
      lastHandoff: null,
      trackingEnabled: true,
      pausedAt: null,
      pausedDurationMs: 0,
    };
    room.version += 1;
    this.recordLedger(room, "room_reset", seatId);
    this.broadcast(room);
    return { snapshot: this.snapshot(room) };
  }

  tossCoin(code, connectionId) {
    const room = this.room(code);
    const { seatId } = this.requireOwner(room, connectionId);
    room.lastCoinToss = {
      result: (randomBytes(1)[0] & 1) === 0 ? "heads" : "tails",
      tossedBySeatId: seatId,
      tossedAt: this.now(),
    };
    this.recordLedger(room, "coin_tossed", seatId, { result: room.lastCoinToss.result });
    // A toss is shared table utility information, not gameplay state. It is
    // broadcast without advancing the counter-write version, avoiding a
    // needless conflict with a simultaneous life update.
    this.broadcast(room);
    return { snapshot: this.snapshot(room) };
  }

  declareWinner(code, connectionId, input = {}) {
    const room = this.room(code);
    const { seatId } = this.requireOwner(room, connectionId);
    if (seatId !== room.hostSeatId) throw Object.assign(new Error("Only the host seat may declare a winner"), { status: 403, code: "HOST_ONLY" });
    if (input.baseVersion !== room.version) {
      throw Object.assign(new Error("State changed; apply the latest snapshot before retrying"), { status: 409, code: "VERSION_CONFLICT", snapshot: this.snapshot(room) });
    }
    const winnerSeatId = asInteger(input.winnerSeatId, "winnerSeatId", 0, room.config.playerCount - 1);
    if (!room.seats[winnerSeatId].claimed) throw Object.assign(new Error("A winner must be a claimed seat"), { status: 400, code: "INVALID_INPUT" });
    room.gameResult = { winnerSeatId, reason: "declared_winner", decidedAt: this.now() };
    room.version += 1;
    this.recordLedger(room, "winner_declared", seatId, { winnerSeatId });
    this.recordCompletion(room);
    this.broadcast(room);
    return { snapshot: this.snapshot(room) };
  }

  chooseStartingPlayer(code, connectionId, input = {}) {
    const room = this.room(code);
    const { seatId } = this.requireOwner(room, connectionId);
    if (seatId !== room.hostSeatId) throw Object.assign(new Error("Only the host seat may choose the starting player"), { status: 403, code: "HOST_ONLY" });
    if (room.turn.gameStarted) throw Object.assign(new Error("The game has already started"), { status: 409, code: "GAME_ALREADY_STARTED", snapshot: this.snapshot(room) });
    if (input.baseVersion !== room.version) throw Object.assign(new Error("State changed; apply the latest snapshot before retrying"), { status: 409, code: "VERSION_CONFLICT", snapshot: this.snapshot(room) });
    const claimedSeats = room.seats.filter((seat) => seat.claimed);
    if (claimedSeats.length < 2) throw Object.assign(new Error("At least two claimed players are needed to choose who goes first"), { status: 409, code: "NOT_ENOUGH_PLAYERS", snapshot: this.snapshot(room) });
    const requestedSeatId = input.startingSeatId;
    const roll = requestedSeatId === undefined ? createStartingPlayerRoll(claimedSeats, this.now()) : null;
    const chosen = roll ? null : room.seats[asInteger(requestedSeatId, "startingSeatId", 0, room.config.playerCount - 1)];
    if (!roll && !chosen?.claimed) throw Object.assign(new Error("The starting player must be a claimed seat"), { status: 400, code: "INVALID_INPUT" });
    room.turn = roll
      ? { ...room.turn, startingPlayerRoll: roll, lastHandoff: null }
      : { ...room.turn, activeSeatId: chosen.seatId, startingPlayerSeatId: chosen.seatId, startingPlayerRoll: null, lastHandoff: null };
    room.version += 1;
    this.recordLedger(room, roll ? "first_player_roll_started" : "first_player_selected", seatId, roll ? { method: "local_d20" } : { startingSeatId: chosen.seatId, method: "host" });
    this.broadcast(room);
    return { snapshot: this.snapshot(room) };
  }

  startGame(code, connectionId, input = {}) {
    const room = this.room(code);
    const { seatId } = this.requireOwner(room, connectionId);
    if (seatId !== room.hostSeatId) throw Object.assign(new Error("Only the host seat may start the game"), { status: 403, code: "HOST_ONLY" });
    if (room.turn.gameStarted) throw Object.assign(new Error("The game has already started"), { status: 409, code: "GAME_ALREADY_STARTED", snapshot: this.snapshot(room) });
    if (input.baseVersion !== room.version) throw Object.assign(new Error("State changed; apply the latest snapshot before retrying"), { status: 409, code: "VERSION_CONFLICT", snapshot: this.snapshot(room) });
    const playerCountAtStart = room.seats.filter((seat) => seat.claimed).length;
    if (playerCountAtStart < 2) throw Object.assign(new Error("At least two claimed players are needed to start the game"), { status: 409, code: "NOT_ENOUGH_PLAYERS", snapshot: this.snapshot(room) });
    if (room.turn.startingPlayerRoll?.status === "rolling") throw Object.assign(new Error("Wait for every local d20 roll to report before starting the game"), { status: 409, code: "ROLL_IN_PROGRESS", snapshot: this.snapshot(room) });
    const startedAt = this.now();
    for (const seat of room.seats) seat.matchMoment.playerCountAtStart = playerCountAtStart;
    room.turn = {
      ...room.turn,
      gameStarted: true,
      gameStartedAt: startedAt,
      turnStartedAt: startedAt,
      roundEndsAt: room.config.roundLimitMinutes ? startedAt + room.config.roundLimitMinutes * 60 * 1000 : null,
      startingPlayerSeatId: room.turn.startingPlayerSeatId ?? room.turn.activeSeatId,
      lastHandoff: null,
    };
    room.version += 1;
    this.recordLedger(room, "game_started", seatId, { startingSeatId: room.turn.startingPlayerSeatId });
    this.broadcast(room);
    return { snapshot: this.snapshot(room) };
  }

  handoffTurn(code, connectionId, input = {}) {
    const room = this.room(code);
    const { seatId } = this.requireOwner(room, connectionId);
    if (!room.turn.gameStarted) throw Object.assign(new Error("Start the game before handing off turns"), { status: 409, code: "GAME_NOT_STARTED", snapshot: this.snapshot(room) });
    if (!room.turn.trackingEnabled) throw Object.assign(new Error("Turn tracking is off for this game"), { status: 409, code: "TURN_TRACKING_OFF", snapshot: this.snapshot(room) });
    if (room.turn.pausedAt) throw Object.assign(new Error("The host has paused turn tracking"), { status: 409, code: "TURN_PAUSED", snapshot: this.snapshot(room) });
    if (input.baseVersion !== room.version) {
      throw Object.assign(new Error("State changed; apply the latest snapshot before retrying"), { status: 409, code: "VERSION_CONFLICT", snapshot: this.snapshot(room) });
    }
    if (seatId !== room.turn.activeSeatId) {
      throw Object.assign(new Error("Only the active player may end this turn"), { status: 403, code: "NOT_ACTIVE_PLAYER" });
    }
    const handedOffAt = this.now();
    const previousTurnStartedAt = room.turn.turnStartedAt;
    // Connection status is deliberately not part of turn order: a disconnected
    // player keeps their turn until they reconnect. Only eliminated seats are skipped.
    const livingClaimedSeats = room.seats.filter((seat) => seat.claimed && !seatIsEliminated(seat));
    const eligibleSeats = livingClaimedSeats.length ? livingClaimedSeats : room.seats.filter((seat) => seat.claimed);
    const currentIndex = eligibleSeats.findIndex((seat) => seat.seatId === seatId);
    const toSeatId = eligibleSeats[(currentIndex + 1) % eligibleSeats.length].seatId;
    room.turn = {
      ...room.turn,
      activeSeatId: toSeatId,
      turnStartedAt: handedOffAt,
      lastHandoff: { fromSeatId: seatId, toSeatId, handedOffAt, turnLengthMs: Math.max(0, handedOffAt - (previousTurnStartedAt ?? handedOffAt)) },
    };
    recordTurnMoment(room.seats[seatId], room.turn.lastHandoff.turnLengthMs);
    room.version += 1;
    this.recordLedger(room, "turn_handed_off", seatId, { toSeatId, turnLengthMs: Math.max(0, handedOffAt - (previousTurnStartedAt ?? handedOffAt)) });
    this.broadcast(room);
    return { snapshot: this.snapshot(room) };
  }

  undoTurnHandoff(code, connectionId, input = {}) {
    const room = this.room(code);
    const { seatId } = this.requireOwner(room, connectionId);
    if (input.baseVersion !== room.version) {
      throw Object.assign(new Error("State changed; apply the latest snapshot before retrying"), { status: 409, code: "VERSION_CONFLICT", snapshot: this.snapshot(room) });
    }
    const handoff = room.turn.lastHandoff;
    if (!handoff || this.now() - handoff.handedOffAt > 15_000) {
      throw Object.assign(new Error("The turn-handoff undo window has expired"), { status: 409, code: "HANDOFF_UNDO_EXPIRED", snapshot: this.snapshot(room) });
    }
    if (seatId !== handoff.fromSeatId) {
      throw Object.assign(new Error("Only the player who ended the turn may undo that handoff"), { status: 403, code: "HANDOFF_UNDO_OWNER_ONLY" });
    }
    room.turn = {
      ...room.turn,
      activeSeatId: handoff.fromSeatId,
      turnStartedAt: handoff.handedOffAt,
      lastHandoff: null,
    };
    room.version += 1;
    this.recordLedger(room, "turn_handoff_undone", seatId, { toSeatId: handoff.fromSeatId });
    this.broadcast(room);
    return { snapshot: this.snapshot(room) };
  }

  resolveStreamTarget(code, connectionId, { maxStreamsPerConnection = 2, maxStreamsGlobal = 64 } = {}) {
    const room = this.room(code);
    const { connection } = this.requireOwner(room, connectionId);
    const streamCount = [...this.connections.values()].reduce((total, item) => total + item.streams.size, 0);
    if (connection.streams.size >= maxStreamsPerConnection || streamCount >= maxStreamsGlobal) {
      throw Object.assign(new Error("Too many live update connections. Close an older tab and try again."), { status: 429, code: "SSE_LIMIT" });
    }
    return { room, connection };
  }

  recordFieldTest(code, connectionId, input = {}) {
    const room = this.room(code); const { seatId } = this.requireOwner(room, connectionId);
    if (seatId !== room.hostSeatId) throw Object.assign(new Error("Only the host may record a field test"), { status: 403, code: "HOST_ONLY" });
    if (!room.turn.gameStarted) throw Object.assign(new Error("Start the game before recording a field test"), { status: 409, code: "GAME_NOT_STARTED" });
    if (room.fieldTestRecordedAt) throw Object.assign(new Error("This game already has a field-test record"), { status: 409, code: "FIELD_TEST_ALREADY_RECORDED" });
    const deviceMix = ["mixed", "ios", "android", "unknown"].includes(input.deviceMix) ? input.deviceMix : null;
    const repeatUse = ["yes", "no", "unknown"].includes(input.repeatUse) ? input.repeatUse : null;
    const dispute = ["none", "app", "other", "unknown"].includes(input.dispute) ? input.dispute : null;
    const allowedIssues = new Set(["setup", "reclaim", "reconnect", "authority", "readability", "turn-flow", "other"]);
    const issues = Array.isArray(input.issues) ? [...new Set(input.issues)] : [];
    if (!input.realTable || !deviceMix || !repeatUse || !dispute || issues.length > 3 || issues.some((issue) => !allowedIssues.has(issue))) throw Object.assign(new Error("Complete the bounded field-test record"), { status: 400, code: "INVALID_FIELD_TEST" });
    const note = typeof input.note === "string" ? input.note.normalize("NFC").trim().replace(/\s+/gu, " ") : "";
    if (Array.from(note).length > 500 || /[\p{Cc}\p{Cf}]/u.test(note)) throw Object.assign(new Error("Field-test notes must contain at most 500 printable characters"), { status: 400, code: "INVALID_FIELD_TEST" });
    const now = this.now();
    if (room.sessionKind === "development") throw Object.assign(new Error("Development runs cannot be recorded as field tests"), { status: 409, code: "DEVELOPMENT_RUN" });
    const record = { schemaVersion: 1, gameId: room.gameId, roomCode: room.code, recordedAt: now, realTable: true, playerCount: room.seats.filter((seat) => seat.claimed).length, setupMs: Math.max(0, room.turn.gameStartedAt - room.createdAt), elapsedMs: Math.max(0, now - room.turn.gameStartedAt), deviceMix, repeatUse, dispute, issues, note };
    room.fieldTestRecordedAt = now; this.ledger.fieldTest(record);
    return { record };
  }

  setSessionKind(code, connectionId, input = {}) {
    const room = this.room(code); const { seatId } = this.requireOwner(room, connectionId);
    if (seatId !== room.hostSeatId) throw Object.assign(new Error("Only the host may classify this run"), { status: 403, code: "HOST_ONLY" });
    if (input.baseVersion !== room.version) throw Object.assign(new Error("State changed; apply the latest snapshot before retrying"), { status: 409, code: "VERSION_CONFLICT", snapshot: this.snapshot(room) });
    if (!["standard", "development"].includes(input.sessionKind)) throw Object.assign(new Error("Choose a valid run type"), { status: 400, code: "INVALID_INPUT" });
    room.sessionKind = input.sessionKind; room.version += 1; this.recordLedger(room, "session_kind_changed", seatId, { sessionKind: room.sessionKind }); this.broadcast(room);
    return { snapshot: this.snapshot(room) };
  }

  setTurnTracking(code, connectionId, input = {}) {
    const room = this.room(code);
    const { seatId } = this.requireOwner(room, connectionId);
    if (seatId !== room.hostSeatId) throw Object.assign(new Error("Only the host seat may change turn tracking"), { status: 403, code: "HOST_ONLY" });
    if (input.baseVersion !== room.version) throw Object.assign(new Error("State changed; apply the latest snapshot before retrying"), { status: 409, code: "VERSION_CONFLICT", snapshot: this.snapshot(room) });
    if (typeof input.enabled !== "boolean") throw Object.assign(new Error("Turn tracking must be on or off"), { status: 400, code: "INVALID_INPUT" });
    const now = this.now();
    room.turn = { ...room.turn, trackingEnabled: input.enabled, pausedAt: null, turnStartedAt: input.enabled && room.turn.gameStarted ? now : room.turn.turnStartedAt, pausedDurationMs: input.enabled && room.turn.gameStarted ? 0 : room.turn.pausedDurationMs, lastHandoff: null };
    room.version += 1;
    this.recordLedger(room, "turn_tracking_changed", seatId, { enabled: input.enabled });
    this.broadcast(room);
    return { snapshot: this.snapshot(room) };
  }

  setTurnCues(code, connectionId, input = {}) {
    const room = this.room(code); const { seatId } = this.requireOwner(room, connectionId);
    if (seatId !== room.hostSeatId) throw Object.assign(new Error("Only the host seat may change table turn cues"), { status: 403, code: "HOST_ONLY" });
    if (input.baseVersion !== room.version) throw Object.assign(new Error("State changed; apply the latest snapshot before retrying"), { status: 409, code: "VERSION_CONFLICT", snapshot: this.snapshot(room) });
    if (typeof input.enabled !== "boolean") throw Object.assign(new Error("Turn cues must be on or off"), { status: 400, code: "INVALID_INPUT" });
    room.turn = { ...room.turn, cuesEnabled: input.enabled }; room.version += 1;
    this.recordLedger(room, "turn_cues_changed", seatId, { enabled: input.enabled }); this.broadcast(room); return { snapshot: this.snapshot(room) };
  }

  reportStartingPlayerRoll(code, connectionId, input = {}) {
    const room = this.room(code); const { seatId } = this.requireOwner(room, connectionId);
    if (room.turn.gameStarted) throw Object.assign(new Error("The game has already started"), { status: 409, code: "GAME_ALREADY_STARTED", snapshot: this.snapshot(room) });
    const roll = room.turn.startingPlayerRoll; if (!roll || roll.status !== "rolling") throw Object.assign(new Error("There is no active d20 roll-off"), { status: 409, code: "NO_ACTIVE_ROLL", snapshot: this.snapshot(room) });
    const round = roll.rounds.at(-1); if (!round.contenderSeatIds.includes(seatId)) throw Object.assign(new Error("Only a current contender may report this roll"), { status: 403, code: "NOT_A_CONTENDER" });
    if (round.rolls.some((item) => item.seatId === seatId)) throw Object.assign(new Error("This seat has already reported its roll"), { status: 409, code: "ROLL_ALREADY_REPORTED", snapshot: this.snapshot(room) });
    const value = asInteger(input.value, "value", 1, 20); round.rolls.push({ seatId, value, reportedAt: this.now() });
    if (round.rolls.length === round.contenderSeatIds.length) {
      const high = Math.max(...round.rolls.map((item) => item.value)); const tiedSeatIds = round.rolls.filter((item) => item.value === high).map((item) => item.seatId); round.tiedSeatIds = tiedSeatIds;
      if (tiedSeatIds.length === 1) { roll.status = "complete"; roll.winnerSeatId = tiedSeatIds[0]; room.turn = { ...room.turn, activeSeatId: tiedSeatIds[0], startingPlayerSeatId: tiedSeatIds[0], startingPlayerRoll: roll, lastHandoff: null }; this.recordLedger(room, "first_player_selected", seatId, { startingSeatId: tiedSeatIds[0], method: "local_d20" }); }
      else roll.rounds.push({ contenderSeatIds: tiedSeatIds, rolls: [] });
    }
    room.version += 1; this.broadcast(room); return { snapshot: this.snapshot(room) };
  }

  setTurnPaused(code, connectionId, input = {}) {
    const room = this.room(code);
    const { seatId } = this.requireOwner(room, connectionId);
    if (seatId !== room.hostSeatId) throw Object.assign(new Error("Only the host seat may pause turn tracking"), { status: 403, code: "HOST_ONLY" });
    if (!room.turn.gameStarted || !room.turn.trackingEnabled) throw Object.assign(new Error("Turn tracking is not running"), { status: 409, code: "TURN_TRACKING_OFF", snapshot: this.snapshot(room) });
    if (input.baseVersion !== room.version) throw Object.assign(new Error("State changed; apply the latest snapshot before retrying"), { status: 409, code: "VERSION_CONFLICT", snapshot: this.snapshot(room) });
    const now = this.now();
    if (input.paused === true && !room.turn.pausedAt) room.turn = { ...room.turn, pausedAt: now };
    else if (input.paused === false && room.turn.pausedAt) {
      const pausedFor = now - room.turn.pausedAt;
      room.turn = { ...room.turn, pausedAt: null, pausedDurationMs: (room.turn.pausedDurationMs ?? 0) + pausedFor, turnStartedAt: room.turn.turnStartedAt + pausedFor, gameStartedAt: room.turn.gameStartedAt + pausedFor, roundEndsAt: room.turn.roundEndsAt ? room.turn.roundEndsAt + pausedFor : null };
    } else return { snapshot: this.snapshot(room) };
    room.version += 1;
    this.recordLedger(room, input.paused ? "turn_tracking_paused" : "turn_tracking_resumed", seatId, {});
    this.broadcast(room);
    return { snapshot: this.snapshot(room) };
  }

  recoveryRecord(room, updatedAt = this.now()) {
    return {
      schemaVersion: 1, roomCode: room.code, updatedAt,
      hostRecoveryKeyHash: encodedHash(room.hostRecoveryKeyHash),
      room: {
        ...room,
        hostRecoveryKeyHash: undefined,
        seats: room.seats.map((seat) => ({
          ...seat,
          ownerConnectionId: null,
          tokenHash: seat.tokenHash ? encodedHash(seat.tokenHash) : null,
          recentOperationIds: [],
        })),
      },
    };
  }

  async restoreRoom(roomCode, hostRecoveryKey) {
    const code = String(roomCode || "").toUpperCase();
    if (this.rooms.has(code)) return { snapshot: this.snapshot(this.room(code)), restored: false };
    if (typeof hostRecoveryKey !== "string") throw Object.assign(new Error("A host recovery key is required"), { status: 403, code: "HOST_RECOVERY_REQUIRED" });
    const record = await this.ledger.readRecovery(code);
    if (!record?.room || !tokenMatches(hostRecoveryKey, decodedHash(record.hostRecoveryKeyHash))) {
      throw Object.assign(new Error("The host recovery key did not match this room"), { status: 403, code: "HOST_RECOVERY_DENIED" });
    }
    const room = record.room;
    if (room.code !== code || !Array.isArray(room.seats) || room.seats.length < 2 || room.seats.length > 8) {
      throw Object.assign(new Error("The saved recovery record is invalid"), { status: 422, code: "INVALID_RECOVERY_RECORD" });
    }
    room.hostRecoveryKeyHash = decodedHash(record.hostRecoveryKeyHash);
    room.seats = room.seats.map((seat) => ({ ...seat, ownerConnectionId: null, tokenHash: seat.tokenHash ? decodedHash(seat.tokenHash) : null, recentOperationIds: new Map() }));
    room.lastActiveAt = this.now();
    room.version += 1;
    synchronizeCommanderState(room);
    this.rooms.set(code, room);
    this.recordLedger(room, "room_restored", room.hostSeatId, { restoredAt: this.now() });
    return { snapshot: this.snapshot(room), restored: true };
  }

  async hostArchive(code, connectionId) {
    const room = this.room(code); const { seatId } = this.requireOwner(room, connectionId);
    if (seatId !== room.hostSeatId) throw Object.assign(new Error("Only the host may view saved playtests"), { status: 403, code: "HOST_ONLY" });
    const recaps = await this.ledger.listArchive();
    return { playtests: recaps.filter((recap) => recap.roomCode === room.code).map((recap) => ({ ...recap, notes: recap.notes || [] })) };
  }

  attachStream({ room, connection }, res) {
    connection.streams.add(res);
    res.write(`event: snapshot\ndata: ${JSON.stringify(this.snapshot(room))}\n\n`);
    return () => connection.streams.delete(res);
  }

  broadcast(room) {
    const payload = `event: snapshot\ndata: ${JSON.stringify(this.snapshot(room))}\n\n`;
    for (const seat of room.seats) {
      if (!seat.ownerConnectionId) continue;
      const connection = this.connections.get(seat.ownerConnectionId);
      if (!connection) continue;
      for (const stream of connection.streams) stream.write(payload);
    }
  }

  closeStreams(connection, reason) {
    for (const stream of connection.streams) {
      stream.write(`event: close\ndata: ${JSON.stringify({ reason })}\n\n`);
      stream.end();
    }
    connection.streams.clear();
  }

  expireConnection(connection) {
    this.closeStreams(connection, "expired");
    if (connection.seatKey) {
      const [code, rawSeatId] = connection.seatKey.split(":");
      const room = this.rooms.get(code);
      const seat = room?.seats[Number(rawSeatId)];
      if (seat?.ownerConnectionId === connection.connectionId) {
        seat.ownerConnectionId = null;
        room.version += 1;
        this.broadcast(room);
      }
    }
    this.connections.delete(connection.connectionId);
  }

  sweep() {
    const now = this.now();
    for (const connection of [...this.connections.values()]) {
      if (now - connection.lastSeen > this.connectionTtlMs) this.expireConnection(connection);
    }
    for (const [code, room] of this.rooms) {
      if (now - room.lastActiveAt > this.roomTtlMs) {
        this.completePlaytest(room, now, { incomplete: !room.gameResult });
        for (const seat of room.seats) {
          const connection = this.connections.get(seat.ownerConnectionId);
          if (connection) {
            connection.seatKey = null;
            this.closeStreams(connection, "room_expired");
          }
        }
        this.rooms.delete(code);
      }
    }
  }
}

export function createRealtimeServer(options = {}) {
  const service = options.service ?? new RoomService(options);
  const lookupCommanderIdentity = options.lookupCommanderIdentity ?? createCommanderIdentityLookup(options.fetchImpl);
  const lookupCard = options.lookupCard ?? createCardLookup(options.fetchImpl);
  const lookupCardInteraction = options.lookupCardInteraction ?? createCardInteractionLookup(options.fetchImpl);
  const allowedOrigin = options.allowedOrigin ?? process.env.ALLOWED_ORIGIN ?? "*";
  const staticDir = options.staticDir ?? null;
  const sseClients = new Map();
  const maxStreamsPerIp = options.maxStreamsPerIp ?? 12;
  const feedbackPortalKey = options.feedbackPortalKey ?? process.env.FEEDBACK_PORTAL_KEY ?? "";
  const feedbackKeyMatches = (provided) => {
    if (!feedbackPortalKey) throw Object.assign(new Error("The feedback inbox is not configured yet"), { status: 503, code: "FEEDBACK_NOT_CONFIGURED" });
    if (typeof provided !== "string" || provided.length !== feedbackPortalKey.length || !timingSafeEqual(Buffer.from(provided), Buffer.from(feedbackPortalKey))) throw Object.assign(new Error("That feedback key did not match"), { status: 403, code: "FEEDBACK_DENIED" });
  };
  const server = createServer(async (req, res) => {
    const cors = {
      "access-control-allow-origin": allowedOrigin,
      "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "access-control-allow-headers": "content-type,x-connection-id,x-feedback-portal-key",
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      return res.end();
    }
    Object.entries(cors).forEach(([key, value]) => res.setHeader(key, value));
    try {
      const url = new URL(req.url, "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      const connectionId = req.headers["x-connection-id"];
      if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true });
      if (req.method === "GET" && parts[0] === "dice-skins" && parts[1] && parts[2] && serveDiceSkin(res, parts[1], parts[2])) return;
      if (req.method === "GET" && url.pathname === "/api/feedback") { feedbackKeyMatches(req.headers["x-feedback-portal-key"]); return json(res, 200, { notes: await service.ledger.listFeedback() }); }
      if (req.method === "GET" && url.pathname === "/api/feedback/insights") { feedbackKeyMatches(req.headers["x-feedback-portal-key"]); return json(res, 200, { insights: await service.developerFieldTestInsights() }); }
      if (req.method === "GET" && url.pathname === "/api/feedback/diagnostics") {
        feedbackKeyMatches(req.headers["x-feedback-portal-key"]);
        const query = String(url.searchParams.get("query") || "").trim();
        if (!/^[A-Za-z0-9-]{4,64}$/.test(query)) throw Object.assign(new Error("Enter a room code or game reference"), { status: 400, code: "INVALID_INPUT" });
        return json(res, 200, { matches: await service.ledger.findDiagnostics(query) });
      }
      if (req.method === "GET" && url.pathname === "/api/feedback/diagnostics/recent") {
        feedbackKeyMatches(req.headers["x-feedback-portal-key"]);
        return json(res, 200, { games: await service.ledger.listRecentDiagnostics() });
      }
      if (req.method === "POST" && url.pathname === "/api/feedback/diagnostics/mark-review-development") {
        feedbackKeyMatches(req.headers["x-feedback-portal-key"]);
        return json(res, 200, { marked: await service.ledger.markReviewGamesDevelopment() });
      }
      if (req.method === "GET" && parts[0] === "api" && parts[1] === "feedback" && parts[2] === "diagnostics" && parts[3]) {
        feedbackKeyMatches(req.headers["x-feedback-portal-key"]);
        const gameId = String(parts[3] || "");
        if (!/^[A-Za-z0-9-]{4,64}$/.test(gameId)) throw Object.assign(new Error("The game reference was invalid"), { status: 400, code: "INVALID_INPUT" });
        const diagnostic = await service.ledger.readDiagnostics(gameId);
        if (!diagnostic) throw Object.assign(new Error("No retained diagnostic record was found for that game"), { status: 404, code: "NOT_FOUND" });
        return json(res, 200, { diagnostic });
      }
      if ((req.method === "PATCH" || req.method === "DELETE") && parts[0] === "api" && parts[1] === "feedback" && parts[2]) {
        feedbackKeyMatches(req.headers["x-feedback-portal-key"]);
        const input = req.method === "DELETE" ? await readJson(req) : await readJson(req);
        const gameId = typeof input.gameId === "string" ? input.gameId : "";
        const status = req.method === "DELETE" ? "deleted" : String(input.status || "open");
        const ownerNote = String(input.ownerNote || "").normalize("NFC").trim().replace(/\s+/gu, " ");
        if (!gameId || !["open", "addressed", "dismissed", "deleted"].includes(status) || Array.from(ownerNote).length > 1000 || /[\p{Cc}\p{Cf}]/u.test(ownerNote)) throw Object.assign(new Error("Feedback review details were invalid"), { status: 400, code: "INVALID_INPUT" });
        const review = { noteId: parts[2], gameId, status, ownerNote, updatedAt: Date.now() };
        await service.ledger.updateFeedback(review);
        return json(res, 200, { review });
      }
      if (req.method === "GET" && url.pathname === "/api/commander-identity") return json(res, 200, await lookupCommanderIdentity(url.searchParams.get("name") || ""));
      if (req.method === "GET" && url.pathname === "/api/cards/lookup") return json(res, 200, await lookupCard(url.searchParams.get("name") || ""));
      if (req.method === "GET" && url.pathname === "/api/cards/interaction") return json(res, 200, await lookupCardInteraction(url.searchParams.get("first") || "", url.searchParams.get("second") || ""));
      if (req.method === "POST" && url.pathname === "/api/connections") return json(res, 201, service.createConnection());
      if (req.method === "POST" && url.pathname === "/api/connections/heartbeat") return json(res, 200, service.heartbeat(connectionId));
      if (req.method === "POST" && url.pathname === "/api/rooms") return json(res, 201, service.createRoom(connectionId, await readJson(req)));
      if (req.method === "POST" && parts[0] === "api" && parts[1] === "recovery" && parts[2]) return json(res, 200, await service.restoreRoom(parts[2], (await readJson(req)).hostRecoveryKey));
      if (parts[0] === "api" && parts[1] === "rooms" && parts[2]) {
        const code = parts[2].toUpperCase();
        if (req.method === "GET" && parts[3] === "join-qr.svg") {
          service.room(code);
          const protocol = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
          const host = String(req.headers["x-forwarded-host"] || req.headers.host || "localhost").split(",")[0].trim();
          return serveJoinQr(res, code, `${protocol}://${host}`);
        }
        if (req.method === "GET" && parts.length === 3) return json(res, 200, { snapshot: service.snapshot(service.room(code)) });
        if (req.method === "POST" && parts[3] === "claim") return json(res, 200, service.claimSeat(code, connectionId, await readJson(req)));
        if (req.method === "PATCH" && parts[3] === "me") return json(res, 200, service.mutateOwnSeat(code, connectionId, await readJson(req)));
        if (req.method === "POST" && parts[3] === "adjust") return json(res, 200, service.adjustOwnSeat(code, connectionId, await readJson(req)));
        if (req.method === "POST" && parts[3] === "reset") return json(res, 200, service.resetRoom(code, connectionId, await readJson(req)));
        if (req.method === "POST" && parts[3] === "coin-toss") return json(res, 200, service.tossCoin(code, connectionId));
        if (req.method === "GET" && parts[3] === "playtest-notes") return json(res, 200, service.listPlaytestNotes(code, connectionId));
        if (req.method === "POST" && parts[3] === "playtest-notes") return json(res, 201, service.addPlaytestNote(code, connectionId, await readJson(req)));
        if (req.method === "GET" && parts[3] === "playtest-recap") return json(res, 200, service.playtestRecap(code, connectionId));
        if (req.method === "GET" && parts[3] === "match-moment") return json(res, 200, service.personalMatchMoment(code, connectionId));
        if (req.method === "POST" && parts[3] === "field-test") return json(res, 201, service.recordFieldTest(code, connectionId, await readJson(req)));
        if (req.method === "POST" && parts[3] === "session-kind") return json(res, 200, service.setSessionKind(code, connectionId, await readJson(req)));
        if (req.method === "GET" && parts[3] === "saved-playtests") return json(res, 200, await service.hostArchive(code, connectionId));
        if (req.method === "POST" && parts[3] === "declare-winner") return json(res, 200, service.declareWinner(code, connectionId, await readJson(req)));
        if (req.method === "POST" && parts[3] === "choose-starting-player") return json(res, 200, service.chooseStartingPlayer(code, connectionId, await readJson(req)));
        if (req.method === "POST" && parts[3] === "report-starting-player-roll") return json(res, 200, service.reportStartingPlayerRoll(code, connectionId, await readJson(req)));
        if (req.method === "POST" && parts[3] === "start-game") return json(res, 200, service.startGame(code, connectionId, await readJson(req)));
        if (req.method === "POST" && parts[3] === "turn-handoff" && parts[4] === "undo") return json(res, 200, service.undoTurnHandoff(code, connectionId, await readJson(req)));
        if (req.method === "POST" && parts[3] === "turn-tracking") return json(res, 200, service.setTurnTracking(code, connectionId, await readJson(req)));
        if (req.method === "POST" && parts[3] === "turn-cues") return json(res, 200, service.setTurnCues(code, connectionId, await readJson(req)));
        if (req.method === "POST" && parts[3] === "turn-pause") return json(res, 200, service.setTurnPaused(code, connectionId, await readJson(req)));
        if (req.method === "POST" && parts[3] === "turn-handoff") return json(res, 200, service.handoffTurn(code, connectionId, await readJson(req)));
        if (req.method === "GET" && parts[3] === "events") {
          const target = service.resolveStreamTarget(code, url.searchParams.get("connectionId"));
          const forwarded = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
          if ((sseClients.get(forwarded) || 0) >= maxStreamsPerIp) throw Object.assign(new Error("Too many live update connections from this network. Close an older tab and try again."), { status: 429, code: "SSE_LIMIT" });
          res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive",
            "x-accel-buffering": "no",
          });
          const detachService = service.attachStream(target, res);
          sseClients.set(forwarded, (sseClients.get(forwarded) || 0) + 1);
          const detach = () => { detachService(); const remaining = (sseClients.get(forwarded) || 1) - 1; if (remaining > 0) sseClients.set(forwarded, remaining); else sseClients.delete(forwarded); };
          req.on("close", detach);
          return;
        }
      }
      if (req.method === "GET" && url.pathname === "/feedback" && await serveStatic(res, staticDir, "/feedback.html")) return;
      if (req.method === "GET" && !url.pathname.startsWith("/api/") && await serveStatic(res, staticDir, url.pathname)) return;
      return json(res, 404, errorBody("NOT_FOUND", "Endpoint not found"));
    } catch (error) {
      return json(res, error.status ?? 500, errorBody(error.code ?? "INTERNAL_ERROR", error.status ? error.message : "Internal server error", error.snapshot));
    }
  });
  return { server, service };
}
