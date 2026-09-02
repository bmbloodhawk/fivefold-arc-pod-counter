// The ledger intentionally records only a compact, playtest-focused history.
// It never receives reclaim tokens, connection identifiers, IP addresses, or
// raw request bodies.
const QUALIFICATION_POLICY = { version: "v2", minimumGameplayMs: 3 * 60_000, minimumMsPerHandoff: 25_000, minimumHandoffs: 3, minimumGameplaySeats: 2 };
export class NullPlaytestLedger {
  record() {}
  checkpoint() {}
  complete() {}
  recovery() {}
  note() {}
  fieldTest() {}
  async readRecovery() { return null; }
  async listArchive() { return []; }
  async listFeedback() { return []; }
  async listFieldTests() { return []; }
  async findDiagnostics() { return []; }
  async listRecentDiagnostics() { return []; }
  async readDiagnostics() { return null; }
  async updateFeedback() { throw new Error("Feedback storage is not configured"); }
  async flush() { return { ok: true }; }
}

export class MemoryPlaytestLedger {
  constructor() {
    this.records = [];
  }

  record(record) {
    this.records.push({ kind: "event", record });
  }

  checkpoint(record) {
    this.records.push({ kind: "checkpoint", record });
  }

  complete(record) {
    this.records.push({ kind: "complete", record });
  }
  recovery(record) { this.records.push({ kind: "recovery", record }); }
  note(record) { this.records.push({ kind: "note", record }); }
  fieldTest(record) { this.records.push({ kind: "field_test", record }); }
  async readRecovery(roomCode) { return this.records.filter((item) => item.kind === "recovery" && item.record.roomCode === roomCode).at(-1)?.record ?? null; }
  async listArchive() { return this.records.filter((item) => item.kind === "complete").map((item) => item.record); }
  async listFeedback() {
    const notes = new Map();
    const reviews = new Map();
    for (const item of this.records) {
      if (item.kind === "note") notes.set(item.record.noteId, item.record);
      if (item.kind === "complete") for (const note of item.record.notes || []) notes.set(note.noteId, { ...note, roomCode: note.roomCode || item.record.roomCode, authorName: note.authorName || item.record.players?.find((player) => player.seatId === note.authorSeatId)?.name || `P${note.authorSeatId + 1}` });
      if (item.kind === "feedback_review") reviews.set(item.record.noteId, item.record);
    }
    return [...notes.values()].map((note) => ({ ...note, ...(reviews.get(note.noteId) || {}) })).sort((a, b) => b.createdAt - a.createdAt);
  }
  async listFieldTests() { return this.records.filter((item) => item.kind === "field_test").map((item) => ({ ...item.record })); }
  async findDiagnostics(query) {
    const needle = String(query || "").trim().toUpperCase();
    return (await this.listRecentDiagnostics()).filter((game) => game.gameId.toUpperCase().includes(needle) || String(game.roomCode || "").toUpperCase() === needle);
  }
  async listRecentDiagnostics() {
    const gameIds = [...new Set(this.records.filter((item) => ["event", "checkpoint", "complete"].includes(item.kind) && item.record?.gameId).map((item) => item.record.gameId))];
    const games = (await Promise.all(gameIds.map((gameId) => this.readDiagnostics(gameId)))).filter(Boolean);
    return games.sort((a, b) => b.lastEventAt - a.lastEventAt).slice(0, 24);
  }
  async readDiagnostics(gameId) {
    const events = this.records.filter((item) => item.kind === "event" && item.record.gameId === gameId).map((item) => ({ ...item.record })).sort((a, b) => a.sequence - b.sequence).slice(-200);
    const checkpoints = this.records.filter((item) => item.kind === "checkpoint" && item.record.gameId === gameId).map((item) => ({ ...item.record })).sort((a, b) => b.sequence - a.sequence).slice(0, 12);
    const recap = this.records.filter((item) => item.kind === "complete" && item.record.gameId === gameId).at(-1)?.record;
    if (!events.length && !checkpoints.length && !recap) return null;
    const review = this.records.filter((item) => item.kind === "diagnostic_review" && item.record.gameId === gameId).at(-1)?.record || null;
    return diagnosticMetadata({ gameId, roomCode: recap?.roomCode || events.at(-1)?.roomCode || checkpoints[0]?.roomCode, recap: recap ? { ...recap } : null, events, checkpoints, review });
  }
  async updateFeedback(review) { this.records.push({ kind: "feedback_review", record: review }); }
  async flush() { return { ok: true }; }
}

// Server-only Firebase writer. The service-account key is supplied through
// Render environment variables and is never exposed to a phone or committed.
export class FirebasePlaytestLedger {
  constructor({ databaseUrl, clientEmail, privateKey, fetchImpl = fetch, now = () => Date.now(), logger = console } = {}) {
    this.databaseUrl = String(databaseUrl || "").replace(/\/$/, "");
    this.clientEmail = clientEmail;
    this.privateKey = String(privateKey || "").replace(/\\n/g, "\n");
    this.fetch = fetchImpl;
    this.now = now;
    this.logger = logger;
    this.pending = Promise.resolve();
    this.token = null;
  }

  record(event) { this.enqueue(`playtests/${encodeURIComponent(event.gameId)}/events/${event.sequence}.json`, event); }
  checkpoint(checkpoint) { this.enqueue(`playtests/${encodeURIComponent(checkpoint.gameId)}/checkpoints/${checkpoint.sequence}.json`, checkpoint); }
  complete(recap) { this.enqueue(`playtests/${encodeURIComponent(recap.gameId)}/recap.json`, recap); }
  recovery(record) { this.enqueue(`recovery/${encodeURIComponent(record.roomCode)}.json`, record); }
  note(note) { this.enqueue(`playtests/${encodeURIComponent(note.gameId)}/notes/${encodeURIComponent(note.noteId)}.json`, note); }
  fieldTest(record) { this.enqueue(`field-tests/${encodeURIComponent(record.gameId)}.json`, record); }
  async readRecovery(roomCode) { return this.read(`recovery/${encodeURIComponent(roomCode)}.json`); }
  async listArchive() {
    const playtests = await this.read("playtests.json") || {};
    return Object.values(playtests).map((item) => item.recap).filter(Boolean);
  }
  async listFeedback() {
    const playtests = await this.read("playtests.json") || {};
    const notes = new Map();
    for (const item of Object.values(playtests)) {
      const recap = item?.recap || {};
      const reviews = item?.feedback || {};
      for (const note of Object.values(item?.notes || {})) {
        if (!note?.noteId) continue;
        notes.set(note.noteId, { ...note, ...(reviews[note.noteId] || {}), roomCode: note.roomCode || recap.roomCode, authorName: note.authorName || recap.players?.find((player) => player.seatId === note.authorSeatId)?.name || `P${Number(note.authorSeatId) + 1}` });
      }
      for (const note of recap.notes || []) {
        if (!note?.noteId) continue;
        notes.set(note.noteId, { ...note, ...(reviews[note.noteId] || {}), roomCode: note.roomCode || recap.roomCode, authorName: note.authorName || recap.players?.find((player) => player.seatId === note.authorSeatId)?.name || `P${Number(note.authorSeatId) + 1}` });
      }
    }
    return [...notes.values()].sort((a, b) => b.createdAt - a.createdAt);
  }
  async listFieldTests() {
    const records = await this.read("field-tests.json") || {};
    return Object.values(records).filter((record) => record && record.realTable === true);
  }
  async findDiagnostics(query) {
    const needle = String(query || "").trim().toUpperCase();
    const playtests = await this.read("playtests.json") || {};
    return Object.entries(playtests).map(([gameId, playtest]) => diagnosticSummary(gameId, playtest)).filter((game) => game && (game.gameId.toUpperCase().includes(needle) || String(game.roomCode || "").toUpperCase() === needle)).sort((a, b) => b.lastEventAt - a.lastEventAt).slice(0, 200);
  }
  async listRecentDiagnostics() { return this.findDiagnostics(""); }
  async readDiagnostics(gameId) {
    const playtest = await this.read(`playtests/${encodeURIComponent(gameId)}.json`);
    if (!playtest) return null;
    return diagnosticDetail(gameId, playtest);
  }
  async updateFeedback(review) { this.enqueue(`playtests/${encodeURIComponent(review.gameId)}/feedback/${encodeURIComponent(review.noteId)}.json`, review); await this.flush(); }

  enqueue(path, body) {
    this.pending = this.pending.then(() => this.writeWithRetry(path, body)).catch((error) => this.logger.error("Fivefold Arc playtest ledger write failed", error));
  }

  async flush() { await this.pending; return { ok: true }; }

  async writeWithRetry(path, body) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.write(path, body);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  async write(path, body) {
    if (!this.databaseUrl || !this.clientEmail || !this.privateKey) throw new Error("Firebase playtest ledger is missing server credentials");
    const token = await this.accessToken();
    const response = await this.fetch(`${this.databaseUrl}/${path}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Firebase ledger write failed (${response.status})`);
  }

  async read(path) {
    if (!this.databaseUrl || !this.clientEmail || !this.privateKey) throw new Error("Firebase playtest ledger is missing server credentials");
    const token = await this.accessToken();
    const response = await this.fetch(`${this.databaseUrl}/${path}`, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Firebase ledger read failed (${response.status})`);
    return response.json();
  }

  async accessToken() {
    if (this.token && this.token.expiresAt > this.now() + 60_000) return this.token.value;
    const { createSign } = await import("node:crypto");
    const encoded = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const issuedAt = Math.floor(this.now() / 1000);
    const header = encoded({ alg: "RS256", typ: "JWT" });
    const claim = encoded({ iss: this.clientEmail, scope: "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email", aud: "https://oauth2.googleapis.com/token", iat: issuedAt, exp: issuedAt + 3600 });
    const signer = createSign("RSA-SHA256"); signer.update(`${header}.${claim}`); signer.end();
    const assertion = `${header}.${claim}.${signer.sign(this.privateKey, "base64url")}`;
    const response = await this.fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString() });
    if (!response.ok) throw new Error(`Firebase credential exchange failed (${response.status})`);
    const payload = await response.json();
    this.token = { value: payload.access_token, expiresAt: this.now() + Number(payload.expires_in || 3600) * 1000 };
    return this.token.value;
  }
}

function diagnosticSummary(gameId, playtest = {}) {
  const events = Object.values(playtest.events || {}).filter(Boolean).sort((a, b) => a.sequence - b.sequence);
  const checkpoints = Object.values(playtest.checkpoints || {}).filter(Boolean).sort((a, b) => b.sequence - a.sequence);
  const recap = playtest.recap || null;
  const roomCode = recap?.roomCode || events.at(-1)?.roomCode || checkpoints[0]?.roomCode || Object.values(playtest.notes || {}).find(Boolean)?.roomCode;
  return diagnosticMetadata({ gameId, roomCode, recap, events, checkpoints, review: playtest.review || null });
}

function diagnosticDetail(gameId, playtest = {}) {
  const summary = diagnosticSummary(gameId, playtest);
  if (!summary) return null;
  return diagnosticMetadata({ ...summary, recap: playtest.recap || null, events: Object.values(playtest.events || {}).filter(Boolean).sort((a, b) => a.sequence - b.sequence).slice(-200), checkpoints: Object.values(playtest.checkpoints || {}).filter(Boolean).sort((a, b) => b.sequence - a.sequence).slice(0, 12), review: playtest.review || null });
}

function diagnosticMetadata({ gameId, roomCode, recap = null, events = [], checkpoints = [], review = null }) {
  if (!roomCode && !events.length && !checkpoints.length && !recap) return null;
  const snapshots = checkpoints.map((checkpoint) => checkpoint.snapshot).filter(Boolean);
  const counterChanges = Object.fromEntries([...new Set(events.filter((event) => event.type === "counter_adjusted").map((event) => event.counter))].map((counter) => [counter, events.filter((event) => event.type === "counter_adjusted" && event.counter === counter).length]));
  const roomCreated = events.find((event) => event.type === "room_created");
  const sessionKind = review?.sessionKind || [...events].reverse().find((event) => event.type === "session_kind_changed")?.sessionKind || "standard";
  const startedAt = events.find((event) => event.type === "game_started")?.at || null;
  const observedDurationMs = recap?.durationMs ?? (startedAt ? Math.max(0, Math.max(recap?.completedAt || 0, events.at(-1)?.at || 0, checkpoints[0]?.at || 0) - startedAt) : null);
  const handoffs = events.filter((event) => event.type === "turn_handed_off");
  const gameplayActors = new Set(events.filter((event) => event.type === "counter_adjusted" || event.type === "turn_handed_off").map((event) => event.actorSeatId));
  const requiredGameplayMs = Math.max(QUALIFICATION_POLICY.minimumGameplayMs, handoffs.length * QUALIFICATION_POLICY.minimumMsPerHandoff);
  const qualified = sessionKind !== "development" && Boolean(startedAt) && observedDurationMs >= requiredGameplayMs && handoffs.length >= QUALIFICATION_POLICY.minimumHandoffs && gameplayActors.size >= QUALIFICATION_POLICY.minimumGameplaySeats;
  const playerCount = recap?.playerCount || roomCreated?.playerCount || snapshots[0]?.config?.playerCount || null;
  const flags = [
    ...(sessionKind === "development" ? ["Development run"] : []),
    ...(sessionKind !== "development" && startedAt && observedDurationMs < requiredGameplayMs ? ["Rapid conclusion"] : []),
    ...(sessionKind !== "development" && !qualified ? ["Exploratory table"] : []),
    ...(recap?.incomplete ? ["Incomplete game"] : []),
    ...(recap && !recap.incomplete && !recap.winner ? ["Completed without winner"] : []),
    ...(snapshots.some((snapshot) => snapshot.seats?.some((seat) => Number(seat.counters?.life) < 0)) ? ["Life below zero"] : []),
    ...(events.length && !checkpoints.length ? ["No periodic snapshot"] : []),
  ];
  return { gameId, roomCode, startedAt: recap?.createdAt || events[0]?.at || checkpoints.at(-1)?.at || 0, lastEventAt: Math.max(recap?.completedAt || 0, events.at(-1)?.at || 0, checkpoints[0]?.at || 0), eventCount: events.length, snapshotCount: checkpoints.length, playerCount, durationMs: observedDurationMs, requiredGameplayMs, qualificationPolicyVersion: QUALIFICATION_POLICY.version, sessionKind, qualified, handoffCount: handoffs.length, gameplaySeatCount: gameplayActors.size, outcome: recap ? (recap.incomplete ? "Reset early" : recap.winner ? "Winner recorded" : "Completed") : "Not archived", winnerSeatId: recap?.winner?.seatId ?? null, counterChanges, flags, recap, events, checkpoints };
}

export function createPlaytestLedgerFromEnv(env = process.env) {
  if (!env.FIREBASE_DATABASE_URL || !env.FIREBASE_SERVICE_ACCOUNT_EMAIL || !env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY) return new NullPlaytestLedger();
  return new FirebasePlaytestLedger({ databaseUrl: env.FIREBASE_DATABASE_URL, clientEmail: env.FIREBASE_SERVICE_ACCOUNT_EMAIL, privateKey: env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY });
}

export function publicSeat(seat) {
  return {
    seatId: seat.seatId,
    name: seat.name,
    commanders: seat.commanderNames.filter(Boolean),
  };
}

export function recapFromRoom(room, completedAt) {
  const gameStartedAt = room.turn.gameStartedAt;
  const lastTurnAt = room.turn.turnStartedAt;
  const result = room.gameResult;
  return {
    schemaVersion: 1,
    gameId: room.gameId,
    roomCode: room.code,
    createdAt: room.createdAt,
    completedAt,
    durationMs: gameStartedAt ? Math.max(0, completedAt - gameStartedAt) : 0,
    playerCount: room.config.playerCount,
    startingLife: room.config.startingLife,
    players: room.seats.filter((seat) => seat.claimed).map(publicSeat),
    firstPlayerSeatId: room.turn.startingPlayerSeatId,
    winner: result ? { seatId: result.winnerSeatId, reason: result.reason, decidedAt: result.decidedAt } : null,
    latestTurnStartedAt: lastTurnAt,
  };
}
