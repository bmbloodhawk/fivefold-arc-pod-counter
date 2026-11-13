import { readFileSync } from "node:fs";
import { archivedSource, assertSameSource, publicLedgerValue, sourceArchive } from './competition-source.js';
import { keyPageRequest, keyPageResult } from './database-key-page.js';
import { KeyedWriteQueue } from './keyed-write-queue.js';

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
  async readArchivedSource() { return null; }
  async retrySourceArchive() { throw new Error('Completion archive is not configured.'); }
  async listArchive() { return []; }
  async listFeedback() { return []; }
  async listFieldTests() { return []; }
  async findDiagnostics() { return []; }
  async listRecentDiagnostics() { return []; }
  async readDiagnostics() { return null; }
  async updateFeedback() { throw new Error("Feedback storage is not configured"); }
  async flush() {}
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
    const previous = this.records.find(item => item.kind === 'complete' && item.record.gameId === record.gameId);
    if (record._competitionSource && previous) return;
    this.records.push({ kind: "complete", record: structuredClone(record) });
    return { archived: true };
  }
  async readArchivedSource(gameId) { return archivedSource(this.records.find(item => item.kind === 'complete' && item.record.gameId === gameId)?.record); }
  async retrySourceArchive(source, recap) {
    const existing = await this.readArchivedSource(source.gameId);
    if (existing) assertSameSource(existing, source);
    else this.complete(recap || sourceArchive(source));
    return { archived: true };
  }
  recovery(record) { this.records.push({ kind: "recovery", record }); }
  note(record) { this.records.push({ kind: "note", record }); }
  fieldTest(record) { this.records.push({ kind: "field_test", record }); }
  async readRecovery(roomCode) { return this.records.filter((item) => item.kind === "recovery" && item.record.roomCode === roomCode).at(-1)?.record ?? null; }
  async listArchive() { return this.records.filter((item) => item.kind === "complete").map((item) => publicLedgerValue(item.record)); }
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
  async flush() {}
}

// Server-only Firebase writer. The service-account key is supplied through
// Render environment variables and is never exposed to a phone or committed.
export class FirebasePlaytestLedger {
  #recoveryWrites = new Map();
  #diagnosticRepairs = new Map();

  constructor({ databaseUrl, clientEmail, privateKey, fetchImpl = fetch, now = () => Date.now(), logger = console, writeConcurrency = 8 } = {}) {
    this.databaseUrl = String(databaseUrl || "").replace(/\/$/, "");
    this.clientEmail = clientEmail;
    this.privateKey = String(privateKey || "").replace(/\\n/g, "\n");
    this.fetch = fetchImpl;
    this.now = now;
    this.logger = logger;
    this.writeQueue = new KeyedWriteQueue({ concurrency: writeConcurrency });
    this.token = null;
    this.tokenRequest = null;
  }

  record(event) { this.enqueue(`playtests/${encodeURIComponent(event.gameId)}/events/${event.sequence}.json`, event, roomWriteKey(event)); }
  checkpoint(checkpoint) { this.enqueue(`playtests/${encodeURIComponent(checkpoint.gameId)}/checkpoints/${checkpoint.sequence}.json`, checkpoint, roomWriteKey(checkpoint)); }
  complete(recap) {
    const key = roomWriteKey(recap);
    if (!recap._competitionSource) { this.enqueue(`playtests/${encodeURIComponent(recap.gameId)}/recap.json`, recap, key); return; }
    const frozen = structuredClone(recap);
    const attempt = this.writeQueue.enqueue(key, () => this.createSourceArchive(frozen)).then(() => ({ archived: true }));
    attempt.catch(error => this.logger.error('Fivefold Arc completion archive write failed', error));
    return attempt;
  }
  async readArchivedSource(gameId) { return archivedSource(await this.read(`playtests/${encodeURIComponent(gameId)}/recap.json`)); }
  async retrySourceArchive(source, recap) {
    if (recap) assertSameSource(archivedSource(recap), source);
    await this.createSourceArchive(recap || sourceArchive(source)); return { archived: true };
  }
  async createSourceArchive(recap) {
    const token = await this.accessToken();
    const url = `${this.databaseUrl}/playtests/${encodeURIComponent(recap.gameId)}/recap.json`;
    const response = await this.fetch(url, { method: 'PUT', headers: {
      authorization: `Bearer ${token}`, 'content-type': 'application/json', 'if-match': 'null_etag',
    }, body: JSON.stringify(recap) });
    await discardResponseBody(response);
    if (response.status === 412) {
      const existing = await this.readArchivedSource(recap.gameId);
      if (!existing) throw Object.assign(new Error('Existing archive has no immutable source.'), { status: 409, code: 'SOURCE_CONFLICT' });
      assertSameSource(existing, archivedSource(recap));
    } else if (!response.ok) throw new Error(`Completion archive write failed (${response.status}).`);
  }
  recovery(record) {
    const key = roomWriteKey(record), code = record.roomCode;
    const path = `recovery/${encodeURIComponent(code)}.json`;
    // Keep the same frozen bytes and FIFO lane for a retry after a storage failure.
    const payload = JSON.stringify({ ...record, savedAt: { ".sv": "timestamp" } });
    return this.#enqueueRecovery(code, path, payload, key);
  }
  // One durable operation retains the event and its matching recovery snapshot.
  // Existing paths and the Table's FIFO lane are shared with standalone saves.
  recordWithRecovery(event, record, checkpoint = null) {
    const key = roomWriteKey(record), code = record.roomCode;
    if (event?.roomCode !== code || !Number.isSafeInteger(event.sequence) || event.sequence < 1
        || ![event.gameId, code].every(value => typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value))
        || (record.room?.code && record.room.code !== code)
        || (record.room?.gameId && record.room.gameId !== event.gameId)
        || (checkpoint && (checkpoint.roomCode !== code || checkpoint.gameId !== event.gameId || checkpoint.sequence !== event.sequence))) {
      throw new TypeError('The event, recovery and checkpoint must match the same Table and game.');
    }
    const updates = { [`playtests/${event.gameId}/events/${event.sequence}`]: event };
    if (checkpoint) updates[`playtests/${event.gameId}/checkpoints/${event.sequence}`] = checkpoint;
    const diagnostics = JSON.stringify(updates);
    updates[`recovery/${code}`] = { ...record, savedAt: { '.sv': 'timestamp' } };
    return this.#enqueueRecovery(code, '.json', JSON.stringify(updates), key, 'PATCH', diagnostics);
  }
  #enqueueRecovery(code, path, payload, key, method = 'PUT', diagnosticPayload = null) {
    const retry = () => {
      const entry = { promise: this.#enqueuePayload(path, payload, key, method, diagnosticPayload), failed: false, retry };
      this.#recoveryWrites.set(code, entry);
      entry.promise.then(() => {
        if (this.#recoveryWrites.get(code) === entry) this.#recoveryWrites.delete(code);
      }, () => { entry.failed = true; });
      return entry.promise;
    };
    return retry();
  }
  // Only this Table's existing recovery write: no global drain or extra normal I/O.
  waitForRecovery(roomCode) {
    const entry = this.#recoveryWrites.get(roomCode);
    return entry?.failed ? entry.retry() : entry?.promise || Promise.resolve();
  }
  note(note) { this.enqueue(`playtests/${encodeURIComponent(note.gameId)}/notes/${encodeURIComponent(note.noteId)}.json`, note, roomWriteKey(note)); }
  fieldTest(record) { this.enqueue(`field-tests/${encodeURIComponent(record.gameId)}.json`, record, roomWriteKey(record)); }
  async readRecovery(roomCode) { return this.read(`recovery/${encodeURIComponent(roomCode)}.json`); }
  async readRecoverySave(roomCode) {
    const record = await this.readRecovery(roomCode);
    if (record == null) return null;
    const version = record.room?.version;
    if (record.schemaVersion !== 1 || record.roomCode !== roomCode || record.room?.code !== roomCode
        || !Number.isSafeInteger(version) || version < 1) throw new Error("Invalid room recovery record");
    const { savedAt } = record;
    return {
      savedVersion: version,
      savedAt: Number.isSafeInteger(savedAt) && savedAt > 0 && savedAt <= 8.64e15 ? savedAt : null,
    };
  }
  async listArchive() {
    const playtests = await this.read("playtests.json") || {};
    return Object.values(playtests).map((item) => publicLedgerValue(item.recap)).filter(Boolean);
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

  enqueue(path, body, key = path) {
    const reportFailure = (error) => this.logger.error("Fivefold Arc playtest ledger write failed", error);
    // Recovery records can reference live counters. Capture the bytes before the queue waits.
    let payload;
    try {
      payload = JSON.stringify(body);
    } catch (error) {
      reportFailure(error);
      return;
    }
    return this.#enqueuePayload(path, payload, key);
  }

  #enqueuePayload(path, payload, key, method = 'PUT', diagnosticPayload = null) {
    const attempt = this.writeQueue.enqueue(key, async () => {
      try {
        // A job may have been admitted before an older diagnostic write failed.
        // Drain at execution time, before acknowledging any newer snapshot.
        const pending = this.#diagnosticRepairs.get(key);
        if (pending) {
          await this.writeWithRetry('.json', pending, 'PATCH');
          this.#diagnosticRepairs.delete(key);
        }
        await this.writeWithRetry(path, payload, method);
      }
      catch (error) {
        if (diagnosticPayload) {
          // Keep repair inside the admitted FIFO job so flush includes it.
          // Never include an old recovery snapshot in a diagnostic-only repair.
          const pending = this.#diagnosticRepairs.get(key);
          const repair = pending ? JSON.stringify({ ...JSON.parse(pending), ...JSON.parse(diagnosticPayload) }) : diagnosticPayload;
          this.#diagnosticRepairs.set(key, repair);
          try {
            await this.writeWithRetry('.json', repair, 'PATCH');
            this.#diagnosticRepairs.delete(key);
          }
          catch (repairError) { this.logger.error('Fivefold Arc diagnostic repair failed', repairError); }
        }
        throw error;
      }
    });
    // Logging must not turn a failed save into a successful acknowledgement.
    attempt.catch(error => this.logger.error("Fivefold Arc playtest ledger write failed", error));
    return attempt;
  }

  // Wait for queued attempts. Firebase supplies the timestamp on the saved room record.
  async flush() { await this.writeQueue.flush(); }

  async writeWithRetry(path, payload, method = 'PUT') {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.#writePayload(path, payload, method);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  async write(path, body) {
    return this.#writePayload(path, JSON.stringify(body));
  }

  async #writePayload(path, payload, method = 'PUT') {
    if (!this.databaseUrl || !this.clientEmail || !this.privateKey) throw new Error("Firebase playtest ledger is missing server credentials");
    const token = await this.accessToken();
    const response = await this.fetch(`${this.databaseUrl}/${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: payload,
    });
    await discardResponseBody(response);
    if (!response.ok) throw new Error(`Firebase ledger write failed (${response.status})`);
  }

  async read(path) {
    if (!this.databaseUrl || !this.clientEmail || !this.privateKey) throw new Error("Firebase playtest ledger is missing server credentials");
    const token = await this.accessToken();
    const response = await this.fetch(`${this.databaseUrl}/${path}`, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) {
      await discardResponseBody(response);
      throw new Error(`Firebase ledger read failed (${response.status})`);
    }
    return response.json();
  }

  // Fetch a bounded key range; never download a collection and paginate afterward.
  async page(path, options) {
    const request = keyPageRequest(path, options);
    return keyPageResult(await this.read(request.path), request);
  }

  // Conditional PUT keeps a profile's save and its unlock decisions in one write.
  async update(path, change) {
    const token = await this.accessToken();
    const url = this.databaseUrl + "/" + path;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const read = await this.fetch(url, { headers: { authorization: "Bearer " + token, "x-firebase-etag": "true" } });
      if (!read.ok) {
        await discardResponseBody(read);
        throw new Error("Firebase conditional read failed (" + read.status + ")");
      }
      const current = await read.json();
      const next = change(current);
      if (next === current) return current;
      const tag = current == null ? "null_etag" : read.headers.get("etag");
      if (!tag) throw new Error("Firebase did not return a conditional write tag");
      const write = await this.fetch(url, {
        method: "PUT",
        headers: { authorization: "Bearer " + token, "content-type": "application/json", "if-match": tag },
        body: JSON.stringify(next),
      });
      await discardResponseBody(write);
      if (write.status === 412) continue;
      if (!write.ok) throw new Error("Firebase conditional write failed (" + write.status + ")");
      return next;
    }
    throw Object.assign(new Error("Your history changed while saving. Try again."), { status: 503, code: "HISTORY_BUSY" });
  }

  async accessToken() {
    if (this.token && this.token.expiresAt > this.now() + 60_000) return this.token.value;
    this.tokenRequest ??= this.exchangeToken().finally(() => { this.tokenRequest = null; });
    return this.tokenRequest;
  }

  async exchangeToken() {
    const { createSign } = await import("node:crypto");
    const encoded = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const issuedAt = Math.floor(this.now() / 1000);
    const header = encoded({ alg: "RS256", typ: "JWT" });
    const claim = encoded({ iss: this.clientEmail, scope: "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email", aud: "https://oauth2.googleapis.com/token", iat: issuedAt, exp: issuedAt + 3600 });
    const signer = createSign("RSA-SHA256"); signer.update(`${header}.${claim}`); signer.end();
    const assertion = `${header}.${claim}.${signer.sign(this.privateKey, "base64url")}`;
    const response = await this.fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString() });
    if (!response.ok) {
      await discardResponseBody(response);
      throw new Error(`Firebase credential exchange failed (${response.status})`);
    }
    const payload = await response.json();
    this.token = { value: payload.access_token, expiresAt: this.now() + Number(payload.expires_in || 3600) * 1000 };
    return this.token.value;
  }
}

function roomWriteKey(record) {
  if (typeof record?.roomCode !== 'string' || !record.roomCode.trim()) throw new TypeError('A queued Table record requires a room code.');
  return `room:${record.roomCode}`;
}

// Consume without buffering an unused JSON echo, including conflicts and errors.
// Node fetch cannot rely on garbage collection to release connection resources.
async function discardResponseBody(response) {
  try {
    if (response.body) for await (const chunk of response.body) { /* Discard each chunk. */ }
  } catch (error) {
    // A known HTTP failure still determines retry/verification behavior when its
    // unused echo is truncated. A successful status with a broken body fails visibly.
    if (response.ok) throw error;
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
  recap = publicLedgerValue(recap);
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
  const serviceAccount = env.FIREBASE_SERVICE_ACCOUNT_FILE
    ? JSON.parse(readFileSync(env.FIREBASE_SERVICE_ACCOUNT_FILE, "utf8"))
    : {};
  const clientEmail = env.FIREBASE_SERVICE_ACCOUNT_EMAIL || serviceAccount.client_email;
  const privateKey = env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY || serviceAccount.private_key;
  if (!env.FIREBASE_DATABASE_URL || !clientEmail || !privateKey) return new NullPlaytestLedger();
  return new FirebasePlaytestLedger({ databaseUrl: env.FIREBASE_DATABASE_URL, clientEmail, privateKey });
}

export function publicSeat(seat) {
  return {
    seatId: seat.seatId,
    name: seat.name,
    commanders: seat.commanderNames.filter(Boolean),
  };
}

export function activeGameDurationMs(turn, completedAt) {
  if (turn.gameStartedAt == null) return 0;
  const stop = turn.pausedAt == null ? completedAt : Math.min(completedAt, turn.pausedAt);
  return Math.max(0, stop - turn.gameStartedAt);
}

export function recapFromRoom(room, completedAt) {
  const lastTurnAt = room.turn.turnStartedAt;
  const result = room.gameResult;
  return {
    schemaVersion: 1,
    gameId: room.gameId,
    roomCode: room.code,
    createdAt: room.createdAt,
    completedAt,
    durationMs: activeGameDurationMs(room.turn, completedAt),
    playerCount: room.config.playerCount,
    startingLife: room.config.startingLife,
    players: room.seats.filter((seat) => seat.claimed).map(publicSeat),
    firstPlayerSeatId: room.turn.startingPlayerSeatId,
    winner: result ? { seatId: result.winnerSeatId, reason: result.reason, declarationDetail: result.declarationDetail || null, decidedAt: result.decidedAt } : null,
    latestTurnStartedAt: lastTurnAt,
  };
}
