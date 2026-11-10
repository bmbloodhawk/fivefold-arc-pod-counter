import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRealtimeServer } from "../src/app.js";
import { FirebasePlaytestLedger, createPlaytestLedgerFromEnv } from "../src/playtest-ledger.js";

test("conditional ledger writes retry a lost race against the newest data", async () => {
  let stored = { games: ["first"] };
  let tag = '"a"';
  let conflict = true;
  const ledger = new FirebasePlaytestLedger({
    databaseUrl: "https://fixture.invalid",
    fetchImpl: async (_url, options) => {
      if (!options.method) {
        assert.equal(options.headers["x-firebase-etag"], "true");
        return Response.json(stored, { headers: { etag: tag } });
      }
      assert.equal(options.headers["if-match"], tag);
      if (conflict) {
        conflict = false;
        tag = '"b"';
        stored = { games: ["first", "concurrent"] };
        return Response.json(stored, { status: 412, headers: { etag: tag } });
      }
      stored = JSON.parse(options.body);
      return Response.json(stored);
    },
  });
  ledger.accessToken = async () => "fixture-token";
  await ledger.update("profile.json", current => ({ games: [...current.games, "ours"] }));
  assert.deepEqual(stored.games, ["first", "concurrent", "ours"]);
});

test("creates the Firebase ledger from a protected service-account file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fivefold-firebase-"));
  const credentialPath = join(directory, "staging-service-account.json");
  await writeFile(credentialPath, JSON.stringify({
    client_email: "staging@example.test",
    private_key: "-----BEGIN PRIVATE KEY-----\\nsecret\\n-----END PRIVATE KEY-----\\n",
  }));

  try {
    const ledger = createPlaytestLedgerFromEnv({
      FIREBASE_DATABASE_URL: "https://staging.firebaseio.test",
      FIREBASE_SERVICE_ACCOUNT_FILE: credentialPath,
    });

    assert.ok(ledger instanceof FirebasePlaytestLedger);
    assert.equal(ledger.clientEmail, "staging@example.test");
    assert.match(ledger.privateKey, /BEGIN PRIVATE KEY/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("room diagnostics preserve the last confirmed Firebase save through a failed write and restart", async (t) => {
  const documents = new Map();
  let databaseTime = 1_800_000_000_000;
  let rejectedVersion;
  let rejectedWrites = 0;
  let recoveryReadFails = false;
  async function openStaging() {
    const ledger = new FirebasePlaytestLedger({
      databaseUrl: "https://fixture.invalid",
      clientEmail: "fixture@example.test",
      privateKey: "fixture-only",
      logger: { error() {} },
      fetchImpl: async (url, { method, body }) => {
        const path = new URL(url).pathname;
        const isRecovery = path.startsWith("/recovery/");
        if (method !== "PUT") {
          if (isRecovery && recoveryReadFails) return new Response(null, { status: 503 });
          return Response.json(documents.get(path) ?? null);
        }
        const data = JSON.parse(body);
        if (isRecovery) {
          if (data.room.version === rejectedVersion) {
            rejectedWrites += 1;
            return new Response(null, { status: 503 });
          }
          if (data.savedAt?.[".sv"] === "timestamp") data.savedAt = ++databaseTime;
        }
        documents.set(path, data);
        return Response.json(data);
      },
    });
    ledger.accessToken = async () => "fixture-token";
    const { server, service } = createRealtimeServer({ appEnv: "staging", ledger, feedbackPortalKey: "owner-fixture" });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const close = async () => { if (server.listening) await new Promise(resolve => server.close(resolve)); };
    t.after(close);
    return { service, ledger, close, url: "http://127.0.0.1:" + server.address().port };
  }
  const original = await openStaging();
  const host = original.service.createConnection().connectionId;
  const guest = original.service.createConnection().connectionId;
  const created = original.service.createRoom(host, { playerCount: 2, startingLife: 40 });
  const code = created.snapshot.code;
  const claimed = original.service.claimSeat(code, guest, { seatId: 1 });
  original.service.adjustOwnSeat(code, host, { counter: "life", delta: -2 });
  const saved = original.service.adjustOwnSeat(code, guest, { counter: "life", delta: -3 }).snapshot;
  rejectedVersion = saved.version + 1;
  original.service.adjustOwnSeat(code, guest, { counter: "life", delta: -5 });
  await original.ledger.flush();

  assert.equal(rejectedWrites, 3);
  const persisted = documents.get("/recovery/" + code + ".json");
  assert.equal(persisted.room.version, saved.version);
  assert.deepEqual(persisted.room.seats.map(seat => seat.counters.life), [38, 37]);

  const path = "/api/feedback/diagnostics/recovery?roomCode=" + code.toLowerCase();
  const readSave = async ({ url }) => {
    const response = await fetch(url + path, { headers: { "x-feedback-portal-key": "owner-fixture" } });
    assert.equal(response.status, 200);
    return (await response.json()).recoverySave;
  };
  assert.equal((await fetch(original.url + path)).status, 403);
  const confirmed = {
    roomCode: code, status: "saved", savedAt: databaseTime,
    savedVersion: saved.version, liveVersion: rejectedVersion,
  };
  assert.deepEqual(await readSave(original), confirmed);
  await original.close();

  const restarted = await openStaging();
  assert.deepEqual(await readSave(restarted), { ...confirmed, liveVersion: null });
  assert.equal(restarted.service.rooms.has(code), false);

  recoveryReadFails = true;
  assert.deepEqual(await readSave(restarted), {
    roomCode: code, status: "unavailable", savedAt: null, savedVersion: null, liveVersion: null,
  });
  recoveryReadFails = false;

  const response = await fetch(restarted.url + "/api/rooms/" + code);
  assert.equal(response.status, 200);
  const restored = (await response.json()).snapshot;
  assert.deepEqual(restored.seats.map(seat => seat.counters.life), [38, 37]);
  rejectedVersion = undefined;
  const returningHost = restarted.service.createConnection().connectionId;
  const returningGuest = restarted.service.createConnection().connectionId;
  restarted.service.claimSeat(code, returningHost, { seatId: 0, reclaimToken: created.reclaimToken });
  const rejoined = restarted.service.claimSeat(code, returningGuest, { seatId: 1, reclaimToken: claimed.reclaimToken });
  assert.deepEqual(rejoined.snapshot.seats.map(seat => [seat.connected, seat.counters.life]), [[true, 38], [true, 37]]);
  await restarted.ledger.flush();
});
