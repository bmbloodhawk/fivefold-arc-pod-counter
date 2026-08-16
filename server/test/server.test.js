import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createRealtimeServer, RoomService } from "../src/app.js";

let server;
let baseUrl;

before(async () => {
  ({ server } = createRealtimeServer({ connectionTtlMs: 60_000 }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function call(path, { method = "GET", connectionId, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(connectionId ? { "x-connection-id": connectionId } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

async function connection() {
  return (await call("/api/connections", { method: "POST" })).body.connectionId;
}

async function room(config = {}) {
  const connectionId = await connection();
  const created = await call("/api/rooms", {
    method: "POST",
    connectionId,
    body: { playerCount: 4, startingLife: 40, ...config },
  });
  assert.equal(created.status, 201);
  return { connectionId, ...created.body };
}

describe("room configuration and claims", () => {
  test("creates a 2-8 player room with an opaque code and private reclaim token", async () => {
    const made = await room({ playerCount: 8, startingLife: 30, commanderCount: 2 });
    assert.match(made.snapshot.code, /^[A-HJ-NP-Z2-9]{6}$/);
    assert.equal(made.snapshot.seats.length, 8);
    assert.equal(made.snapshot.seats[0].counters.life, 30);
    assert.equal(made.snapshot.seats[0].commanderCount, 2);
    assert.deepEqual(made.snapshot.seats[0].commanderDamageReceived, {});
    assert.deepEqual(made.snapshot.seats[0].commanderCastCounts, {
      "seat-0-commander-a": 0,
      "seat-0-commander-b": 0,
    });
    assert.deepEqual(made.snapshot.seats[0].nextCommanderTax, {
      "seat-0-commander-a": 0,
      "seat-0-commander-b": 0,
    });
    assert.deepEqual(made.snapshot.seats[1].commanderCastCounts, {});
    assert.deepEqual(made.snapshot.commanderSources, [
      { id: "seat-0-commander-a", label: "P1 A", ownerSeatId: 0 },
      { id: "seat-0-commander-b", label: "P1 B", ownerSeatId: 0 },
    ]);
    assert.ok(made.reclaimToken.length >= 40);
    assert.equal(JSON.stringify(made.snapshot).includes(made.reclaimToken), false);
  });

  test("rejects unsupported life totals and player counts", async () => {
    const connectionId = await connection();
    const bad = await call("/api/rooms", { method: "POST", connectionId, body: { playerCount: 9, startingLife: 25 } });
    assert.equal(bad.status, 400);
  });

  test("defaults commanderCount to one and rejects unsupported counts", async () => {
    const made = await room();
    assert.equal(made.snapshot.seats[0].commanderCount, 1);
    assert.deepEqual(made.snapshot.commanderSources, [
      { id: "seat-0-commander-a", label: "P1", ownerSeatId: 0 },
    ]);

    const connectionId = await connection();
    const bad = await call("/api/rooms", {
      method: "POST",
      connectionId,
      body: { playerCount: 4, startingLife: 40, commanderCount: 3 },
    });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, "INVALID_INPUT");
  });

  test("normalizes short display names while preserving P# fallbacks and stable source IDs", async () => {
    const made = await room({ name: "  E\u0301owyn \n Forge  ", commanderCount: 2 });
    assert.equal(made.snapshot.seats[0].name, "Éowyn Forge");
    assert.equal(made.snapshot.seats[1].name, "P2");
    assert.deepEqual(made.snapshot.commanderSources, [
      { id: "seat-0-commander-a", label: "Éowyn Forge A", ownerSeatId: 0 },
      { id: "seat-0-commander-b", label: "Éowyn Forge B", ownerSeatId: 0 },
    ]);

    const playerConnection = await connection();
    const claimed = await call(`/api/rooms/${made.snapshot.code}/claim`, {
      method: "POST",
      connectionId: playerConnection,
      body: { seatId: 1, name: "  Jace\tBeleren  " },
    });
    assert.equal(claimed.body.snapshot.seats[1].name, "Jace Beleren");
    assert.deepEqual(claimed.body.snapshot.commanderSources.map(({ id, label }) => ({ id, label })), [
      { id: "seat-0-commander-a", label: "Éowyn Forge A" },
      { id: "seat-0-commander-b", label: "Éowyn Forge B" },
      { id: "seat-1-commander-a", label: "Jace Beleren" },
    ]);
  });

  test("rejects invalid display names without claiming or mutating a seat", async () => {
    for (const name of [null, 7, "   ", "x".repeat(25), "Jace\u0000Beleren", "Jace\u200bBeleren"]) {
      const connectionId = await connection();
      const bad = await call("/api/rooms", {
        method: "POST",
        connectionId,
        body: { playerCount: 2, startingLife: 40, name },
      });
      assert.equal(bad.status, 400);
      assert.equal(bad.body.error.code, "INVALID_INPUT");
    }

    const made = await room();
    const playerConnection = await connection();
    const badClaim = await call(`/api/rooms/${made.snapshot.code}/claim`, {
      method: "POST",
      connectionId: playerConnection,
      body: { seatId: 1, name: "x".repeat(25) },
    });
    assert.equal(badClaim.status, 400);
    const authoritative = await call(`/api/rooms/${made.snapshot.code}`);
    assert.equal(authoritative.body.snapshot.version, made.snapshot.version);
    assert.equal(authoritative.body.snapshot.seats[1].claimed, false);
    assert.equal(authoritative.body.snapshot.seats[1].name, "P2");
  });

  test("claims atomically, reserves seats, and enforces one seat per connection", async () => {
    const made = await room();
    const playerConnection = await connection();
    const claimed = await call(`/api/rooms/${made.snapshot.code}/claim`, {
      method: "POST", connectionId: playerConnection, body: { seatId: 1, name: "Jace", commanderCount: 2 },
    });
    assert.equal(claimed.status, 200);
    assert.equal(claimed.body.snapshot.seats[1].name, "Jace");
    assert.equal(claimed.body.snapshot.seats[1].commanderCount, 2);
    assert.deepEqual(claimed.body.snapshot.commanderSources, [
      { id: "seat-0-commander-a", label: "P1", ownerSeatId: 0 },
      { id: "seat-1-commander-a", label: "Jace A", ownerSeatId: 1 },
      { id: "seat-1-commander-b", label: "Jace B", ownerSeatId: 1 },
    ]);
    assert.deepEqual(claimed.body.snapshot.seats[0].commanderDamageReceived, {
      "seat-1-commander-a": 0,
      "seat-1-commander-b": 0,
    });
    assert.deepEqual(claimed.body.snapshot.seats[1].commanderDamageReceived, { "seat-0-commander-a": 0 });
    assert.deepEqual(claimed.body.snapshot.seats[1].commanderCastCounts, {
      "seat-1-commander-a": 0,
      "seat-1-commander-b": 0,
    });
    const rivalConnection = await connection();
    const reserved = await call(`/api/rooms/${made.snapshot.code}/claim`, {
      method: "POST", connectionId: rivalConnection, body: { seatId: 1 },
    });
    assert.equal(reserved.status, 403);
    assert.equal(reserved.body.error.code, "SEAT_RESERVED");
    const secondSeat = await call(`/api/rooms/${made.snapshot.code}/claim`, {
      method: "POST", connectionId: playerConnection, body: { seatId: 2 },
    });
    assert.equal(secondSeat.status, 409);
  });
});

describe("authority and convergence", () => {
  test("allows an exact-version owner rename and keeps duplicate names presentation-only", async () => {
    const made = await room({ name: "Alex" });
    const playerConnection = await connection();
    const claimed = await call(`/api/rooms/${made.snapshot.code}/claim`, {
      method: "POST",
      connectionId: playerConnection,
      body: { seatId: 1, name: "Jace", commanderCount: 2 },
    });
    const renamed = await call(`/api/rooms/${made.snapshot.code}/me`, {
      method: "PATCH",
      connectionId: playerConnection,
      body: { baseVersion: claimed.body.snapshot.version, name: "  Alex  " },
    });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.snapshot.seats[0].name, "Alex");
    assert.equal(renamed.body.snapshot.seats[1].name, "Alex");
    assert.deepEqual(renamed.body.snapshot.commanderSources, [
      { id: "seat-0-commander-a", label: "Alex", ownerSeatId: 0 },
      { id: "seat-1-commander-a", label: "Alex A", ownerSeatId: 1 },
      { id: "seat-1-commander-b", label: "Alex B", ownerSeatId: 1 },
    ]);
    assert.deepEqual(Object.keys(renamed.body.snapshot.seats[0].commanderDamageReceived), [
      "seat-1-commander-a",
      "seat-1-commander-b",
    ]);

    const stale = await call(`/api/rooms/${made.snapshot.code}/me`, {
      method: "PATCH",
      connectionId: playerConnection,
      body: { baseVersion: claimed.body.snapshot.version, name: "Liliana" },
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, "VERSION_CONFLICT");
    assert.equal(stale.body.snapshot.seats[1].name, "Alex");

    const invalid = await call(`/api/rooms/${made.snapshot.code}/me`, {
      method: "PATCH",
      connectionId: playerConnection,
      body: { baseVersion: renamed.body.snapshot.version, name: [] },
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, "INVALID_INPUT");
    const authoritative = await call(`/api/rooms/${made.snapshot.code}`);
    assert.equal(authoritative.body.snapshot.version, renamed.body.snapshot.version);
    assert.equal(authoritative.body.snapshot.seats[1].name, "Alex");
  });

  test("allows only defender-owned state and rejects stale writes with a snapshot", async () => {
    const made = await room();
    const playerConnection = await connection();
    const claimed = await call(`/api/rooms/${made.snapshot.code}/claim`, {
      method: "POST", connectionId: playerConnection, body: { seatId: 1 },
    });
    const updated = await call(`/api/rooms/${made.snapshot.code}/me`, {
      method: "PATCH",
      connectionId: playerConnection,
      body: {
        baseVersion: claimed.body.snapshot.version,
        counters: { life: 37, poison: 2 },
        commanderDamageReceived: { "seat-0-commander-a": 5 },
      },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.snapshot.seats[1].counters.life, 37);
    assert.equal(updated.body.snapshot.seats[1].commanderDamageReceived["seat-0-commander-a"], 5);
    assert.equal(updated.body.snapshot.seats[0].counters.life, 40);

    const stale = await call(`/api/rooms/${made.snapshot.code}/me`, {
      method: "PATCH", connectionId: playerConnection, body: { baseVersion: claimed.body.snapshot.version, counters: { life: 1 } },
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, "VERSION_CONFLICT");
    assert.equal(stale.body.snapshot.version, updated.body.snapshot.version);
  });

  test("changes only the owner's commander count at an exact version and preserves unaffected damage", async () => {
    const made = await room({ commanderCount: 2 });
    const playerConnection = await connection();
    const claimed = await call(`/api/rooms/${made.snapshot.code}/claim`, {
      method: "POST",
      connectionId: playerConnection,
      body: { seatId: 1 },
    });
    const playerDamage = await call(`/api/rooms/${made.snapshot.code}/me`, {
      method: "PATCH",
      connectionId: playerConnection,
      body: {
        baseVersion: claimed.body.snapshot.version,
        commanderDamageReceived: {
          "seat-0-commander-a": 5,
          "seat-0-commander-b": 2,
        },
      },
    });
    const hostDamage = await call(`/api/rooms/${made.snapshot.code}/me`, {
      method: "PATCH",
      connectionId: made.connectionId,
      body: {
        baseVersion: playerDamage.body.snapshot.version,
        commanderDamageReceived: { "seat-1-commander-a": 4 },
      },
    });
    const hostSingle = await call(`/api/rooms/${made.snapshot.code}/me`, {
      method: "PATCH",
      connectionId: made.connectionId,
      body: { baseVersion: hostDamage.body.snapshot.version, commanderCount: 1 },
    });
    assert.equal(hostSingle.status, 200);
    assert.deepEqual(hostSingle.body.snapshot.commanderSources, [
      { id: "seat-0-commander-a", label: "P1", ownerSeatId: 0 },
      { id: "seat-1-commander-a", label: "P2", ownerSeatId: 1 },
    ]);
    assert.deepEqual(hostSingle.body.snapshot.seats[1].commanderDamageReceived, { "seat-0-commander-a": 5 });
    assert.deepEqual(hostSingle.body.snapshot.seats[0].commanderDamageReceived, { "seat-1-commander-a": 4 });

    const playerPartners = await call(`/api/rooms/${made.snapshot.code}/me`, {
      method: "PATCH",
      connectionId: playerConnection,
      body: { baseVersion: hostSingle.body.snapshot.version, commanderCount: 2 },
    });
    assert.equal(playerPartners.status, 200);
    assert.deepEqual(playerPartners.body.snapshot.seats[0].commanderDamageReceived, {
      "seat-1-commander-a": 4,
      "seat-1-commander-b": 0,
    });
    assert.deepEqual(playerPartners.body.snapshot.seats[1].commanderDamageReceived, { "seat-0-commander-a": 5 });

    const stale = await call(`/api/rooms/${made.snapshot.code}/me`, {
      method: "PATCH",
      connectionId: playerConnection,
      body: { baseVersion: hostSingle.body.snapshot.version, commanderCount: 1 },
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, "VERSION_CONFLICT");
  });

  test("tracks owner-only commander casts and derives the next tax", async () => {
    const made = await room();
    const playerConnection = await connection();
    const claimed = await call(`/api/rooms/${made.snapshot.code}/claim`, {
      method: "POST",
      connectionId: playerConnection,
      body: { seatId: 1, commanderCount: 2 },
    });
    const counted = await call(`/api/rooms/${made.snapshot.code}/me`, {
      method: "PATCH",
      connectionId: playerConnection,
      body: {
        baseVersion: claimed.body.snapshot.version,
        commanderCastCounts: {
          "seat-1-commander-a": 1,
          "seat-1-commander-b": 3,
        },
      },
    });
    assert.equal(counted.status, 200);
    assert.deepEqual(counted.body.snapshot.seats[1].commanderCastCounts, {
      "seat-1-commander-a": 1,
      "seat-1-commander-b": 3,
    });
    assert.deepEqual(counted.body.snapshot.seats[1].nextCommanderTax, {
      "seat-1-commander-a": 2,
      "seat-1-commander-b": 6,
    });
    assert.deepEqual(counted.body.snapshot.seats[0].commanderCastCounts, { "seat-0-commander-a": 0 });

    const stale = await call(`/api/rooms/${made.snapshot.code}/me`, {
      method: "PATCH",
      connectionId: playerConnection,
      body: { baseVersion: claimed.body.snapshot.version, commanderCastCounts: { "seat-1-commander-a": 2 } },
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, "VERSION_CONFLICT");
    assert.deepEqual(stale.body.snapshot.seats[1].commanderCastCounts, counted.body.snapshot.seats[1].commanderCastCounts);
  });

  test("rejects foreign, inactive, derived-tax, and invalid commander cast edits", async () => {
    const made = await room();
    const playerConnection = await connection();
    const claimed = await call(`/api/rooms/${made.snapshot.code}/claim`, {
      method: "POST",
      connectionId: playerConnection,
      body: { seatId: 1 },
    });
    const baseVersion = claimed.body.snapshot.version;
    const invalidPatches = [
      { commanderCastCounts: { "seat-0-commander-a": 1 } },
      { commanderCastCounts: { "seat-1-commander-b": 1 } },
      { commanderCastCounts: { "seat-1-commander-a": -1 } },
      { commanderCastCounts: { "seat-1-commander-a": 1.5 } },
      { commanderCastCounts: { "seat-1-commander-a": "1" } },
      { commanderCastCounts: { "seat-1-commander-a": 1000 } },
      { commanderCastCounts: null },
      { nextCommanderTax: { "seat-1-commander-a": 2 } },
      { commanderCount: 2, commanderCastCounts: { "seat-1-commander-b": 1 } },
    ];
    for (const patch of invalidPatches) {
      const denied = await call(`/api/rooms/${made.snapshot.code}/me`, {
        method: "PATCH",
        connectionId: playerConnection,
        body: { baseVersion, ...patch },
      });
      assert.equal(denied.status, 400);
      assert.equal(denied.body.error.code, "INVALID_INPUT");
    }
    const authoritative = await call(`/api/rooms/${made.snapshot.code}`);
    assert.equal(authoritative.body.snapshot.version, baseVersion);
    assert.equal(authoritative.body.snapshot.seats[1].commanderCount, 1);
    assert.deepEqual(authoritative.body.snapshot.seats[1].commanderCastCounts, { "seat-1-commander-a": 0 });
  });

  test("preserves A, adds B at zero, and removes B with dynamic commander sources", async () => {
    const made = await room();
    const countedA = await call(`/api/rooms/${made.snapshot.code}/me`, {
      method: "PATCH",
      connectionId: made.connectionId,
      body: { baseVersion: made.snapshot.version, commanderCastCounts: { "seat-0-commander-a": 4 } },
    });
    const partners = await call(`/api/rooms/${made.snapshot.code}/me`, {
      method: "PATCH",
      connectionId: made.connectionId,
      body: { baseVersion: countedA.body.snapshot.version, commanderCount: 2 },
    });
    assert.deepEqual(partners.body.snapshot.seats[0].commanderCastCounts, {
      "seat-0-commander-a": 4,
      "seat-0-commander-b": 0,
    });
    assert.deepEqual(partners.body.snapshot.seats[0].nextCommanderTax, {
      "seat-0-commander-a": 8,
      "seat-0-commander-b": 0,
    });
    const countedB = await call(`/api/rooms/${made.snapshot.code}/me`, {
      method: "PATCH",
      connectionId: made.connectionId,
      body: { baseVersion: partners.body.snapshot.version, commanderCastCounts: { "seat-0-commander-b": 2 } },
    });
    const single = await call(`/api/rooms/${made.snapshot.code}/me`, {
      method: "PATCH",
      connectionId: made.connectionId,
      body: { baseVersion: countedB.body.snapshot.version, commanderCount: 1 },
    });
    assert.deepEqual(single.body.snapshot.seats[0].commanderCastCounts, { "seat-0-commander-a": 4 });
    assert.deepEqual(single.body.snapshot.seats[0].nextCommanderTax, { "seat-0-commander-a": 8 });
  });

  test("reclaim preserves commanderCount and cannot silently change it", async () => {
    const made = await room();
    const playerConnection = await connection();
    const claim = await call(`/api/rooms/${made.snapshot.code}/claim`, {
      method: "POST",
      connectionId: playerConnection,
      body: { seatId: 1, name: "Jace", commanderCount: 2 },
    });
    const replacement = await connection();
    const counted = await call(`/api/rooms/${made.snapshot.code}/me`, {
      method: "PATCH",
      connectionId: playerConnection,
      body: {
        baseVersion: claim.body.snapshot.version,
        commanderCastCounts: { "seat-1-commander-a": 2, "seat-1-commander-b": 1 },
      },
    });
    const denied = await call(`/api/rooms/${made.snapshot.code}/claim`, {
      method: "POST",
      connectionId: replacement,
      body: { seatId: 1, reclaimToken: claim.body.reclaimToken, commanderCount: 1 },
    });
    assert.equal(denied.status, 409);
    assert.equal(denied.body.error.code, "COMMANDER_COUNT_MISMATCH");
    assert.equal(denied.body.snapshot.seats[1].commanderCount, 2);
    assert.equal(denied.body.snapshot.version, counted.body.snapshot.version);

    const reclaimed = await call(`/api/rooms/${made.snapshot.code}/claim`, {
      method: "POST",
      connectionId: replacement,
      body: { seatId: 1, reclaimToken: claim.body.reclaimToken },
    });
    assert.equal(reclaimed.status, 200);
    assert.equal(reclaimed.body.snapshot.seats[1].commanderCount, 2);
    assert.equal(reclaimed.body.snapshot.seats[1].name, "Jace");
    assert.deepEqual(reclaimed.body.snapshot.seats[1].commanderCastCounts, {
      "seat-1-commander-a": 2,
      "seat-1-commander-b": 1,
    });
  });

  test("rejects self, inactive, and legacy positional commander source keys", async () => {
    const made = await room();
    for (const source of ["seat-0-commander-a", "seat-1-commander-a", "0"]) {
      const denied = await call(`/api/rooms/${made.snapshot.code}/me`, {
        method: "PATCH",
        connectionId: made.connectionId,
        body: { baseVersion: made.snapshot.version, commanderDamageReceived: { [source]: 1 } },
      });
      assert.equal(denied.status, 400);
      assert.equal(denied.body.error.code, "INVALID_INPUT");
    }
  });

  test("reclaims with the token, invalidates the old connection, and preserves state", async () => {
    const made = await room();
    const playerConnection = await connection();
    const claim = await call(`/api/rooms/${made.snapshot.code}/claim`, {
      method: "POST", connectionId: playerConnection, body: { seatId: 1, name: "Jace" },
    });
    const newConnection = await connection();
    const reclaimed = await call(`/api/rooms/${made.snapshot.code}/claim`, {
      method: "POST",
      connectionId: newConnection,
      body: { seatId: 1, reclaimToken: claim.body.reclaimToken, name: "  Ajani  " },
    });
    assert.equal(reclaimed.status, 200);
    assert.equal(reclaimed.body.snapshot.seats[1].name, "Ajani");
    const oldWrite = await call(`/api/rooms/${made.snapshot.code}/me`, {
      method: "PATCH", connectionId: playerConnection, body: { baseVersion: reclaimed.body.snapshot.version, counters: { life: 10 } },
    });
    assert.equal(oldWrite.status, 403);
    const newWrite = await call(`/api/rooms/${made.snapshot.code}/me`, {
      method: "PATCH", connectionId: newConnection, body: { baseVersion: reclaimed.body.snapshot.version, counters: { life: 39 } },
    });
    assert.equal(newWrite.status, 200);
  });

  test("permits reset only for host and retains claims", async () => {
    const made = await room();
    const playerConnection = await connection();
    const claim = await call(`/api/rooms/${made.snapshot.code}/claim`, {
      method: "POST",
      connectionId: playerConnection,
      body: { seatId: 1, name: "Jace", commanderCount: 2 },
    });
    const denied = await call(`/api/rooms/${made.snapshot.code}/reset`, {
      method: "POST", connectionId: playerConnection, body: { baseVersion: claim.body.snapshot.version },
    });
    assert.equal(denied.status, 403);
    const counted = await call(`/api/rooms/${made.snapshot.code}/me`, {
      method: "PATCH",
      connectionId: playerConnection,
      body: {
        baseVersion: claim.body.snapshot.version,
        commanderCastCounts: { "seat-1-commander-a": 3, "seat-1-commander-b": 2 },
      },
    });
    const reset = await call(`/api/rooms/${made.snapshot.code}/reset`, {
      method: "POST", connectionId: made.connectionId, body: { baseVersion: counted.body.snapshot.version },
    });
    assert.equal(reset.status, 200);
    assert.equal(reset.body.snapshot.seats[1].claimed, true);
    assert.equal(reset.body.snapshot.seats[1].name, "Jace");
    assert.equal(reset.body.snapshot.seats[1].counters.life, 40);
    assert.equal(reset.body.snapshot.seats[1].commanderCount, 2);
    assert.deepEqual(reset.body.snapshot.seats[1].commanderCastCounts, {
      "seat-1-commander-a": 0,
      "seat-1-commander-b": 0,
    });
    assert.deepEqual(reset.body.snapshot.seats[1].nextCommanderTax, {
      "seat-1-commander-a": 0,
      "seat-1-commander-b": 0,
    });
  });

  test("pushes authoritative snapshots over SSE", async () => {
    const made = await room();
    const streamResponse = await fetch(
      `${baseUrl}/api/rooms/${made.snapshot.code}/events?connectionId=${encodeURIComponent(made.connectionId)}`,
    );
    assert.equal(streamResponse.status, 200);
    const reader = streamResponse.body.getReader();
    const decoder = new TextDecoder();
    const initial = decoder.decode((await reader.read()).value);
    assert.match(initial, /event: snapshot/);

    const updated = await call(`/api/rooms/${made.snapshot.code}/me`, {
      method: "PATCH",
      connectionId: made.connectionId,
      body: { baseVersion: made.snapshot.version, counters: { life: 38 }, commanderCount: 2 },
    });
    assert.equal(updated.status, 200);
    const pushed = decoder.decode((await reader.read()).value);
    assert.match(pushed, /\"life\":38/);
    assert.match(pushed, /\"commanderCount\":2/);
    assert.match(pushed, /seat-0-commander-b/);
    await reader.cancel();
  });
});

test("expired connections release transport ownership but preserve seat reservation", () => {
  let clock = 1_000;
  const service = new RoomService({ now: () => clock, connectionTtlMs: 100, roomTtlMs: 10_000 });
  const { connectionId } = service.createConnection();
  const created = service.createRoom(connectionId, { playerCount: 2, startingLife: 20 });
  clock += 101;
  service.sweep();
  const snapshot = service.snapshot(service.room(created.snapshot.code));
  assert.equal(snapshot.seats[0].claimed, true);
  assert.equal(snapshot.seats[0].connected, false);
  assert.throws(() => service.heartbeat(connectionId), { code: "CONNECTION_EXPIRED" });

  const replacement = service.createConnection();
  const reclaimed = service.claimSeat(created.snapshot.code, replacement.connectionId, {
    seatId: 0,
    reclaimToken: created.reclaimToken,
  });
  assert.equal(reclaimed.snapshot.seats[0].connected, true);
});
