// The ledger intentionally records only a compact, playtest-focused history.
// It never receives reclaim tokens, connection identifiers, IP addresses, or
// raw request bodies.
export class NullPlaytestLedger {
  record() {}
  checkpoint() {}
  complete() {}
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

  enqueue(path, body) {
    this.pending = this.pending.then(() => this.writeWithRetry(path, body)).catch((error) => this.logger.error("Fivefold Arc playtest ledger write failed", error));
  }

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
