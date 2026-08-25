import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

const JOIN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MUTABLE_COUNTERS = new Set(["life", "poison", "energy", "storm", "generic"]);
const STATIC_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
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

function json(res, status, body, extraHeaders = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders,
  });
  res.end(data);
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
        .filter((source) => source.ownerSeatId !== seat.seatId)
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

function rollD20() {
  // Reject the final 16 byte values so every d20 face has exactly the same
  // number of possible source values.
  let value = randomBytes(1)[0];
  while (value >= 240) value = randomBytes(1)[0];
  return (value % 20) + 1;
}

// The full sequence is created before it is broadcast. Clients may animate it,
// but never select or reroll an outcome themselves.
function createStartingPlayerRoll(claimedSeats, selectedAt) {
  let contenders = claimedSeats;
  const rounds = [];
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rolls = contenders.map((seat) => ({ seatId: seat.seatId, value: rollD20() }));
    const highRoll = Math.max(...rolls.map((roll) => roll.value));
    const tiedSeatIds = rolls.filter((roll) => roll.value === highRoll).map((roll) => roll.seatId);
    rounds.push({ rolls, tiedSeatIds });
    if (tiedSeatIds.length === 1) return { rounds, winnerSeatId: tiedSeatIds[0], selectedAt };
    contenders = claimedSeats.filter((seat) => tiedSeatIds.includes(seat.seatId));
  }
  throw Object.assign(new Error("Could not complete the d20 roll-off"), { status: 503, code: "ROLL_FAILED" });
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
  constructor({ now = () => Date.now(), roomTtlMs = 6 * 60 * 60 * 1000, connectionTtlMs = 90 * 1000 } = {}) {
    this.now = now;
    this.roomTtlMs = roomTtlMs;
    this.connectionTtlMs = connectionTtlMs;
    this.rooms = new Map();
    this.connections = new Map();
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
    const seats = Array.from({ length: playerCount }, (_, seatId) => ({
      seatId,
      name: seatId === 0 ? normalizeName(input.name, "P1") : `P${seatId + 1}`,
      claimed: seatId === 0,
      ownerConnectionId: seatId === 0 ? connectionId : null,
      tokenHash: seatId === 0 ? tokenHash(reclaimToken) : null,
      commanderCount: seatId === 0 ? commanderCount : 1,
      commanderNames: seatId === 0 ? commanderNames : [""],
      commanderColors: seatId === 0 ? commanderColors : [[]],
      counters: { life: startingLife, poison: 0, energy: 0, storm: 0, generic: 0 },
      commanderDamageReceived: {},
      commanderCastCounts: {},
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
      turn: {
        activeSeatId: 0,
        gameStarted: false,
        gameStartedAt: null,
        turnStartedAt: null,
        roundEndsAt: null,
        startingPlayerSeatId: null,
        startingPlayerRoll: null,
        lastHandoff: null,
      },
      seats,
    };
    synchronizeCommanderState(room);
    this.rooms.set(code, room);
    connection.seatKey = `${code}:0`;
    return { snapshot: this.snapshot(room), seatId: 0, reclaimToken };
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
            tiedSeatIds: [...round.tiedSeatIds],
          })),
        } : null,
        lastHandoff: room.turn.lastHandoff ? { ...room.turn.lastHandoff } : null,
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
    const allowedCommanderSources = new Set(
      commanderSources(room)
        .filter((source) => source.ownerSeatId !== seat.seatId)
        .map((source) => source.id),
    );
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
    this.broadcast(room);
    return { snapshot: this.snapshot(room) };
  }

  adjustOwnSeat(code, connectionId, input = {}) {
    const room = this.room(code);
    const { seat } = this.requireOwner(room, connectionId);
    const counter = input.counter;
    const delta = asInteger(input.delta, "delta", -999, 999);
    if (!MUTABLE_COUNTERS.has(counter) || delta === 0) {
      throw Object.assign(new Error("Adjustments require one supported counter and a non-zero delta"), { status: 400, code: "INVALID_INPUT" });
    }
    if (counter === "commanderDamage") {
      const sourceId = input.commanderSourceId;
      const allowed = new Set(commanderSources(room).filter((source) => source.ownerSeatId !== seat.seatId).map((source) => source.id));
      if (!allowed.has(sourceId)) {
        throw Object.assign(new Error("Commander damage may reference only another claimed seat's active commander source"), { status: 400, code: "INVALID_INPUT" });
      }
      const applied = Math.max(-seat.commanderDamageReceived[sourceId], delta);
      seat.commanderDamageReceived[sourceId] += applied;
      seat.counters.life = Math.max(-999, Math.min(999, seat.counters.life - applied));
    } else {
      const minimum = counter === "life" ? -999 : 0;
      seat.counters[counter] = Math.max(minimum, Math.min(999, seat.counters[counter] + delta));
    }
    recordLastPlayerStanding(room, this.now());
    room.version += 1;
    this.broadcast(room);
    return { snapshot: this.snapshot(room) };
  }

  resetRoom(code, connectionId, input = {}) {
    const room = this.room(code);
    const { seatId } = this.requireOwner(room, connectionId);
    if (seatId !== room.hostSeatId) throw Object.assign(new Error("Only the host seat may reset the room"), { status: 403, code: "HOST_ONLY" });
    if (input.baseVersion !== room.version) {
      throw Object.assign(new Error("State changed; apply the latest snapshot before retrying"), { status: 409, code: "VERSION_CONFLICT", snapshot: this.snapshot(room) });
    }
    for (const seat of room.seats) {
      seat.counters = { life: room.config.startingLife, poison: 0, energy: 0, storm: 0, generic: 0 };
      seat.commanderDamageReceived = Object.fromEntries(
        Object.keys(seat.commanderDamageReceived).map((sourceId) => [sourceId, 0]),
      );
      seat.commanderCastCounts = Object.fromEntries(
        Object.keys(seat.commanderCastCounts).map((sourceId) => [sourceId, 0]),
      );
    }
    room.lastCoinToss = null;
    room.gameResult = null;
    room.turn = {
      activeSeatId: 0,
      gameStarted: false,
      gameStartedAt: null,
      turnStartedAt: null,
      roundEndsAt: null,
      startingPlayerSeatId: null,
      startingPlayerRoll: null,
      lastHandoff: null,
    };
    room.version += 1;
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
    const chosen = roll
      ? room.seats[roll.winnerSeatId]
      : room.seats[asInteger(requestedSeatId, "startingSeatId", 0, room.config.playerCount - 1)];
    if (!chosen?.claimed) throw Object.assign(new Error("The starting player must be a claimed seat"), { status: 400, code: "INVALID_INPUT" });
    room.turn = { ...room.turn, activeSeatId: chosen.seatId, startingPlayerSeatId: chosen.seatId, startingPlayerRoll: roll, lastHandoff: null };
    room.version += 1;
    this.broadcast(room);
    return { snapshot: this.snapshot(room) };
  }

  startGame(code, connectionId, input = {}) {
    const room = this.room(code);
    const { seatId } = this.requireOwner(room, connectionId);
    if (seatId !== room.hostSeatId) throw Object.assign(new Error("Only the host seat may start the game"), { status: 403, code: "HOST_ONLY" });
    if (room.turn.gameStarted) throw Object.assign(new Error("The game has already started"), { status: 409, code: "GAME_ALREADY_STARTED", snapshot: this.snapshot(room) });
    if (input.baseVersion !== room.version) throw Object.assign(new Error("State changed; apply the latest snapshot before retrying"), { status: 409, code: "VERSION_CONFLICT", snapshot: this.snapshot(room) });
    if (room.seats.filter((seat) => seat.claimed).length < 2) throw Object.assign(new Error("At least two claimed players are needed to start the game"), { status: 409, code: "NOT_ENOUGH_PLAYERS", snapshot: this.snapshot(room) });
    const startedAt = this.now();
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
    this.broadcast(room);
    return { snapshot: this.snapshot(room) };
  }

  handoffTurn(code, connectionId, input = {}) {
    const room = this.room(code);
    const { seatId } = this.requireOwner(room, connectionId);
    if (!room.turn.gameStarted) throw Object.assign(new Error("Start the game before handing off turns"), { status: 409, code: "GAME_NOT_STARTED", snapshot: this.snapshot(room) });
    if (input.baseVersion !== room.version) {
      throw Object.assign(new Error("State changed; apply the latest snapshot before retrying"), { status: 409, code: "VERSION_CONFLICT", snapshot: this.snapshot(room) });
    }
    if (seatId !== room.turn.activeSeatId) {
      throw Object.assign(new Error("Only the active player may end this turn"), { status: 403, code: "NOT_ACTIVE_PLAYER" });
    }
    const handedOffAt = this.now();
    const toSeatId = (seatId + 1) % room.config.playerCount;
    room.turn = {
      ...room.turn,
      activeSeatId: toSeatId,
      turnStartedAt: handedOffAt,
      lastHandoff: { fromSeatId: seatId, toSeatId, handedOffAt },
    };
    room.version += 1;
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
    this.broadcast(room);
    return { snapshot: this.snapshot(room) };
  }

  attachStream(code, connectionId, res) {
    const room = this.room(code);
    const { connection } = this.requireOwner(room, connectionId);
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
  const allowedOrigin = options.allowedOrigin ?? process.env.ALLOWED_ORIGIN ?? "*";
  const staticDir = options.staticDir ?? null;
  const server = createServer(async (req, res) => {
    const cors = {
      "access-control-allow-origin": allowedOrigin,
      "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
      "access-control-allow-headers": "content-type,x-connection-id",
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
      if (req.method === "POST" && url.pathname === "/api/connections") return json(res, 201, service.createConnection());
      if (req.method === "POST" && url.pathname === "/api/connections/heartbeat") return json(res, 200, service.heartbeat(connectionId));
      if (req.method === "POST" && url.pathname === "/api/rooms") return json(res, 201, service.createRoom(connectionId, await readJson(req)));
      if (parts[0] === "api" && parts[1] === "rooms" && parts[2]) {
        const code = parts[2].toUpperCase();
        if (req.method === "GET" && parts.length === 3) return json(res, 200, { snapshot: service.snapshot(service.room(code)) });
        if (req.method === "POST" && parts[3] === "claim") return json(res, 200, service.claimSeat(code, connectionId, await readJson(req)));
        if (req.method === "PATCH" && parts[3] === "me") return json(res, 200, service.mutateOwnSeat(code, connectionId, await readJson(req)));
        if (req.method === "POST" && parts[3] === "adjust") return json(res, 200, service.adjustOwnSeat(code, connectionId, await readJson(req)));
        if (req.method === "POST" && parts[3] === "reset") return json(res, 200, service.resetRoom(code, connectionId, await readJson(req)));
        if (req.method === "POST" && parts[3] === "coin-toss") return json(res, 200, service.tossCoin(code, connectionId));
        if (req.method === "POST" && parts[3] === "declare-winner") return json(res, 200, service.declareWinner(code, connectionId, await readJson(req)));
        if (req.method === "POST" && parts[3] === "choose-starting-player") return json(res, 200, service.chooseStartingPlayer(code, connectionId, await readJson(req)));
        if (req.method === "POST" && parts[3] === "start-game") return json(res, 200, service.startGame(code, connectionId, await readJson(req)));
        if (req.method === "POST" && parts[3] === "turn-handoff" && parts[4] === "undo") return json(res, 200, service.undoTurnHandoff(code, connectionId, await readJson(req)));
        if (req.method === "POST" && parts[3] === "turn-handoff") return json(res, 200, service.handoffTurn(code, connectionId, await readJson(req)));
        if (req.method === "GET" && parts[3] === "events") {
          res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive",
            "x-accel-buffering": "no",
          });
          const detach = service.attachStream(code, url.searchParams.get("connectionId"), res);
          req.on("close", detach);
          return;
        }
      }
      if (req.method === "GET" && !url.pathname.startsWith("/api/") && await serveStatic(res, staticDir, url.pathname)) return;
      return json(res, 404, errorBody("NOT_FOUND", "Endpoint not found"));
    } catch (error) {
      return json(res, error.status ?? 500, errorBody(error.code ?? "INTERNAL_ERROR", error.status ? error.message : "Internal server error", error.snapshot));
    }
  });
  return { server, service };
}
