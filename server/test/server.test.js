import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createCardInteractionLookup, createCardLookup, createCommanderIdentityLookup, createRealtimeServer, RoomService } from "../src/app.js";
import { compatibleOperationId, LifeAdjustmentBatcher } from "../../client/life-adjustment-batcher.js";
import { MemoryPlaytestLedger } from "../src/playtest-ledger.js";

let server;
let baseUrl;

before(async () => {
  ({ server } = createRealtimeServer({ connectionTtlMs: 60_000, lookupCommanderIdentity: async (name) => {
    if (name === "Unknown Commander") throw Object.assign(new Error("Commander not found. Check the spelling and try again."), { status: 404, code: "COMMANDER_NOT_FOUND" });
    return { name: "Atraxa, Praetors' Voice", colors: ["W", "U", "B", "G"] };
  }, lookupCard: async (name) => {
    if (name === "Unknown Card") throw Object.assign(new Error("No exact card name was found. Check or edit the title, then try again."), { status: 404, code: "CARD_NOT_FOUND" });
    return { name: "Lightning Bolt", oracleId: "id", typeLine: "Instant", manaCost: "{R}", oracleText: "Lightning Bolt deals 3 damage to any target.", scryfallUrl: "https://scryfall.com/card/m10/146/lightning-bolt", gathererUrl: "https://gatherer.wizards.com/Pages/Card/Details.aspx?multiverseid=191245", retrievedAt: "2026-08-31T00:00:00.000Z" };
  } }));
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

async function raw(path) {
  return fetch(`${baseUrl}${path}`);
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
  test("keeps Oracle lookup available when supporting rulings are absent", async () => {
    const lookup = createCardLookup(async (url) => ({
      ok: true,
      status: 200,
      json: async () => String(url).includes("rulings") ? { data: [{ source: "wotc", published_at: "2025-01-01", comment: "A published ruling." }] } : { name: "Test Card", oracle_text: "Test text.", rulings_uri: "https://example.test/rulings" },
    }));
    const card = await lookup("Test Card");
    assert.equal(card.oracleText, "Test text.");
    assert.deepEqual(card.rulings, [{ source: "wotc", publishedAt: "2025-01-01", comment: "A published ruling." }]);
  });

  test("returns documented community combos separately from card rulings", async () => {
    const lookup = createCardInteractionLookup(async () => ({ ok: true, json: async () => ({ results: [{ id: "combo-id", description: "Step one.\nStep two.", produces: [{ feature: { name: "Infinite damage" } }], easyPrerequisites: "Both cards are on the battlefield.", uses: [{ battlefieldCardState: "attached to Test One" }] }] }) }));
    const result = await lookup("Test One", "Test Two");
    assert.equal(result.source, "Commander Spellbook");
    assert.deepEqual(result.combos[0].result, ["Infinite damage"]);
    assert.match(result.combos[0].prerequisites.join(" "), /attached to Test One/);
  });

  test("looks up a commander identity through the pod server", async () => {
    const found = await call("/api/commander-identity?name=Atraxa%2C%20Praetors%27%20Voice");
    assert.equal(found.status, 200);
    assert.deepEqual(found.body, { name: "Atraxa, Praetors' Voice", colors: ["W", "U", "B", "G"] });
    const missing = await call("/api/commander-identity?name=Unknown%20Commander");
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, "COMMANDER_NOT_FOUND");
  });

  test("returns current card data only for a player-confirmed exact name", async () => {
    const found = await call("/api/cards/lookup?name=Lightning%20Bolt");
    assert.equal(found.status, 200);
    assert.equal(found.body.name, "Lightning Bolt");
    assert.equal(found.body.oracleText, "Lightning Bolt deals 3 damage to any target.");
    const missing = await call("/api/cards/lookup?name=Unknown%20Card");
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, "CARD_NOT_FOUND");
  });

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

  test("shares optional commander card names while retaining stable commander source IDs", async () => {
    const made = await room({ commanderCount: 2, commanderNames: ["Thrasios, Triton Hero", "Tymna the Weaver"] });
    assert.deepEqual(made.snapshot.seats[0].commanderNames, ["Thrasios, Triton Hero", "Tymna the Weaver"]);
    assert.deepEqual(made.snapshot.commanderSources, [
      { id: "seat-0-commander-a", label: "Thrasios, Triton Hero", commanderName: "Thrasios, Triton Hero", ownerSeatId: 0 },
      { id: "seat-0-commander-b", label: "Tymna the Weaver", commanderName: "Tymna the Weaver", ownerSeatId: 0 },
    ]);
    const renamed = await call(`/api/rooms/${made.snapshot.code}/me`, {
      method: "PATCH", connectionId: made.connectionId,
      body: { baseVersion: made.snapshot.version, commanderCount: 1, commanderNames: ["Thrasios, Triton Hero"] },
    });
    assert.equal(renamed.status, 200);
    assert.deepEqual(renamed.body.snapshot.commanderSources, [
      { id: "seat-0-commander-a", label: "Thrasios, Triton Hero", commanderName: "Thrasios, Triton Hero", ownerSeatId: 0 },
    ]);
  });

  test("provides a QR join link without placing a reclaim credential in it", async () => {
    const made = await room();
    const response = await raw(`/api/rooms/${made.snapshot.code}/join-qr.svg`);
    const svg = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /image\/svg\+xml/);
    assert.match(svg, /<svg/);
    assert.equal(svg.includes(made.reclaimToken), false);
  });

  test("shares commander color identity and rejects invalid color letters", async () => {
    const made = await room({ commanderCount: 2, commanderColors: [["W", "U"], ["B", "R"]] });
    assert.deepEqual(made.snapshot.seats[0].commanderColors, [["W", "U"], ["B", "R"]]);
    assert.deepEqual(made.snapshot.commanderSources.map(({ id, commanderColors }) => ({ id, commanderColors })), [
      { id: "seat-0-commander-a", commanderColors: ["W", "U"] },
      { id: "seat-0-commander-b", commanderColors: ["B", "R"] },
    ]);
    const invalid = await call("/api/rooms", {
      method: "POST", connectionId: await connection(),
      body: { playerCount: 2, startingLife: 40, commanderColors: [["X"]] },
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, "INVALID_INPUT");
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

  test("allows a defender to record damage from their own commander when another player controls it", async () => {
    const made = await room();
    const allowed = await call(`/api/rooms/${made.snapshot.code}/me`, {
      method: "PATCH", connectionId: made.connectionId,
      body: { baseVersion: made.snapshot.version, commanderDamageReceived: { "seat-0-commander-a": 1 } },
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.snapshot.seats[0].commanderDamageReceived["seat-0-commander-a"], 1);
    for (const source of ["seat-1-commander-a", "0"]) {
      const denied = await call(`/api/rooms/${made.snapshot.code}/me`, {
        method: "PATCH",
        connectionId: made.connectionId,
        body: { baseVersion: allowed.body.snapshot.version, commanderDamageReceived: { [source]: 1 } },
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

  test("shares a life change with two claimed phone windows", async () => {
    const made = await room({ playerCount: 2, startingLife: 40 });
    const playerConnection = await connection();
    const claimed = await call(`/api/rooms/${made.snapshot.code}/claim`, {
      method: "POST", connectionId: playerConnection, body: { seatId: 1, name: "Player two" },
    });
    assert.equal(claimed.status, 200);
    const openStream = async (connectionId) => {
      const response = await fetch(`${baseUrl}/api/rooms/${made.snapshot.code}/events?connectionId=${encodeURIComponent(connectionId)}`);
      assert.equal(response.status, 200);
      const reader = response.body.getReader(); const decoder = new TextDecoder();
      await reader.read(); // initial authoritative snapshot
      return { reader, decoder };
    };
    const hostWindow = await openStream(made.connectionId);
    const playerWindow = await openStream(playerConnection);
    const updated = await call(`/api/rooms/${made.snapshot.code}/adjust`, {
      method: "POST", connectionId: made.connectionId, body: { counter: "life", delta: -3, operationId: "two-window-life-change-0001" },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.snapshot.seats[0].counters.life, 37);
    const [hostEvent, playerEvent] = await Promise.all([hostWindow.reader.read(), playerWindow.reader.read()]);
    for (const event of [hostEvent, playerEvent]) {
      const payload = hostWindow.decoder.decode(event.value);
      assert.match(payload, /"life":37/);
      assert.match(payload, /"name":"Player two"/);
    }
    await Promise.all([hostWindow.reader.cancel(), playerWindow.reader.cancel()]);
  });

  test("shares a coin toss without changing the gameplay version", async () => {
    const made = await room();
    const tossed = await call(`/api/rooms/${made.snapshot.code}/coin-toss`, {
      method: "POST", connectionId: made.connectionId,
    });
    assert.equal(tossed.status, 200);
    assert.equal(tossed.body.snapshot.version, made.snapshot.version);
    assert.ok(["heads", "tails"].includes(tossed.body.snapshot.lastCoinToss.result));
    assert.equal(tossed.body.snapshot.lastCoinToss.tossedBySeatId, 0);
    assert.equal(typeof tossed.body.snapshot.lastCoinToss.tossedAt, "number");
  });

  test("waits for every local d20 before choosing the first player and rerolls ties", () => {
    let now = 100_000;
    const service = new RoomService({ now: () => now });
    const host = service.createConnection();
    const created = service.createRoom(host.connectionId, { playerCount: 3, startingLife: 40 });
    const other = service.createConnection();
    const claimed = service.claimSeat(created.snapshot.code, other.connectionId, { seatId: 1, name: "Jace" });
    const selected = service.chooseStartingPlayer(created.snapshot.code, host.connectionId, { baseVersion: claimed.snapshot.version });
    const roll = selected.snapshot.turn.startingPlayerRoll;
    assert.ok(roll);
    assert.equal(roll.startedAt, now);
    assert.equal(roll.status, "rolling");
    assert.equal(roll.winnerSeatId, null);
    assert.deepEqual(roll.rounds[0].contenderSeatIds, [0, 1]);
    assert.equal(roll.rounds[0].rolls.length, 0);
    assert.throws(() => service.startGame(created.snapshot.code, host.connectionId, { baseVersion: selected.snapshot.version }), { code: "ROLL_IN_PROGRESS" });
    const hostRoll = service.reportStartingPlayerRoll(created.snapshot.code, host.connectionId, { value: 14 });
    assert.equal(hostRoll.snapshot.turn.startingPlayerRoll.rounds[0].rolls.length, 1);
    const tied = service.reportStartingPlayerRoll(created.snapshot.code, other.connectionId, { value: 14 });
    assert.deepEqual(tied.snapshot.turn.startingPlayerRoll.rounds.at(-1).contenderSeatIds, [0, 1]);
    assert.equal(tied.snapshot.turn.startingPlayerRoll.rounds.at(-1).rolls.length, 0);
    const secondHostRoll = service.reportStartingPlayerRoll(created.snapshot.code, host.connectionId, { value: 8 });
    const completed = service.reportStartingPlayerRoll(created.snapshot.code, other.connectionId, { value: 19 });
    assert.equal(secondHostRoll.snapshot.turn.startingPlayerRoll.status, "rolling");
    assert.equal(completed.snapshot.turn.startingPlayerRoll.status, "complete");
    assert.equal(completed.snapshot.turn.startingPlayerRoll.winnerSeatId, 1);
    assert.equal(completed.snapshot.turn.startingPlayerSeatId, 1);
    now += 1;
    const manual = service.chooseStartingPlayer(created.snapshot.code, host.connectionId, { baseVersion: completed.snapshot.version, startingSeatId: 1 });
    assert.equal(manual.snapshot.turn.startingPlayerSeatId, 1);
    assert.equal(manual.snapshot.turn.startingPlayerRoll, null);
  });

  test("tracks an active turn, supports a 15-second owner-only undo, and never auto-advances", async () => {
    let now = 100_000;
    const service = new RoomService({ now: () => now });
    const host = service.createConnection();
    const created = service.createRoom(host.connectionId, { playerCount: 3, startingLife: 40, roundLimitMinutes: 60 });
    const initial = created.snapshot;
    assert.equal(initial.turn.activeSeatId, 0);
    assert.equal(initial.turn.gameStarted, false);
    assert.equal(initial.turn.gameStartedAt, null);

    const other = service.createConnection();
    const claimed = service.claimSeat(initial.code, other.connectionId, { seatId: 1, name: "Jace" });
    const selected = service.chooseStartingPlayer(initial.code, host.connectionId, { baseVersion: claimed.snapshot.version, startingSeatId: 1 });
    assert.equal(selected.snapshot.turn.startingPlayerSeatId, 1);
    const started = service.startGame(initial.code, host.connectionId, { baseVersion: selected.snapshot.version });
    assert.equal(started.snapshot.turn.gameStarted, true);
    assert.equal(started.snapshot.turn.gameStartedAt, now);
    assert.equal(started.snapshot.turn.roundEndsAt, now + 60 * 60 * 1000);

    now += 6_000;
    const activeConnectionId = started.snapshot.turn.activeSeatId === 0 ? host.connectionId : other.connectionId;
    const handedOff = service.handoffTurn(initial.code, activeConnectionId, { baseVersion: started.snapshot.version });
    assert.equal(handedOff.snapshot.turn.activeSeatId, 0);
    assert.deepEqual(handedOff.snapshot.turn.lastHandoff, { fromSeatId: started.snapshot.turn.activeSeatId, toSeatId: handedOff.snapshot.turn.activeSeatId, handedOffAt: now, turnLengthMs: 6_000 });

    const nonOwnerConnectionId = activeConnectionId === host.connectionId ? other.connectionId : host.connectionId;
    assert.throws(() => service.undoTurnHandoff(initial.code, nonOwnerConnectionId, { baseVersion: service.snapshot(service.room(initial.code)).version }), { code: "HANDOFF_UNDO_OWNER_ONLY" });
    const current = service.snapshot(service.room(initial.code));
    const undone = service.undoTurnHandoff(initial.code, activeConnectionId, { baseVersion: current.version });
    assert.equal(undone.snapshot.turn.activeSeatId, started.snapshot.turn.activeSeatId);
    assert.equal(undone.snapshot.turn.lastHandoff, null);

    const again = service.handoffTurn(initial.code, activeConnectionId, { baseVersion: undone.snapshot.version });
    now += 15_001;
    assert.throws(() => service.undoTurnHandoff(initial.code, activeConnectionId, { baseVersion: again.snapshot.version }), { code: "HANDOFF_UNDO_EXPIRED" });
    assert.equal(service.snapshot(service.room(initial.code)).turn.activeSeatId, 0);
  });

  test("host can pause or disable turn tracking, and handoffs skip eliminated seats", () => {
    let now = 100_000;
    const service = new RoomService({ now: () => now });
    const host = service.createConnection();
    const created = service.createRoom(host.connectionId, { playerCount: 3, startingLife: 40 });
    const second = service.createConnection();
    const third = service.createConnection();
    let snapshot = service.claimSeat(created.snapshot.code, second.connectionId, { seatId: 1, name: "Jace" }).snapshot;
    snapshot = service.claimSeat(created.snapshot.code, third.connectionId, { seatId: 2, name: "Nissa" }).snapshot;
    snapshot = service.setTurnTracking(created.snapshot.code, host.connectionId, { baseVersion: snapshot.version, enabled: false }).snapshot;
    assert.equal(snapshot.turn.gameStarted, false);
    assert.equal(snapshot.turn.trackingEnabled, false);
    snapshot = service.setTurnTracking(created.snapshot.code, host.connectionId, { baseVersion: snapshot.version, enabled: true }).snapshot;
    snapshot = service.setTurnCues(created.snapshot.code, host.connectionId, { baseVersion: snapshot.version, enabled: true }).snapshot;
    assert.equal(snapshot.turn.cuesEnabled, true);
    assert.throws(() => service.setTurnCues(created.snapshot.code, second.connectionId, { baseVersion: snapshot.version, enabled: false }), { code: "HOST_ONLY" });
    snapshot = service.startGame(created.snapshot.code, host.connectionId, { baseVersion: snapshot.version }).snapshot;
    now += 3_000;
    snapshot = service.setTurnPaused(created.snapshot.code, host.connectionId, { baseVersion: snapshot.version, paused: true }).snapshot;
    assert.equal(snapshot.turn.pausedAt, now);
    assert.throws(() => service.handoffTurn(created.snapshot.code, host.connectionId, { baseVersion: snapshot.version }), { code: "TURN_PAUSED" });
    now += 5_000;
    snapshot = service.setTurnPaused(created.snapshot.code, host.connectionId, { baseVersion: snapshot.version, paused: false }).snapshot;
    assert.equal(snapshot.turn.pausedAt, null);
    assert.equal(snapshot.turn.gameStartedAt, 105_000);
    snapshot = service.adjustOwnSeat(created.snapshot.code, second.connectionId, { counter: "life", delta: -40 }).snapshot;
    snapshot = service.handoffTurn(created.snapshot.code, host.connectionId, { baseVersion: snapshot.version }).snapshot;
    assert.equal(snapshot.turn.activeSeatId, 2);
    snapshot = service.setTurnTracking(created.snapshot.code, host.connectionId, { baseVersion: snapshot.version, enabled: false }).snapshot;
    assert.equal(snapshot.turn.trackingEnabled, false);
    assert.throws(() => service.handoffTurn(created.snapshot.code, third.connectionId, { baseVersion: snapshot.version }), { code: "TURN_TRACKING_OFF" });
  });

  test("handoffs retain a disconnected living player's turn", () => {
    const service = new RoomService();
    const host = service.createConnection();
    const created = service.createRoom(host.connectionId, { playerCount: 3, startingLife: 40 });
    const second = service.createConnection();
    const third = service.createConnection();
    let snapshot = service.claimSeat(created.snapshot.code, second.connectionId, { seatId: 1, name: "Jace" }).snapshot;
    snapshot = service.claimSeat(created.snapshot.code, third.connectionId, { seatId: 2, name: "Nissa" }).snapshot;
    snapshot = service.startGame(created.snapshot.code, host.connectionId, { baseVersion: snapshot.version }).snapshot;

    service.expireConnection(service.getConnection(second.connectionId));
    assert.equal(service.snapshot(service.room(created.snapshot.code)).seats[1].connected, false);

    snapshot = service.handoffTurn(created.snapshot.code, host.connectionId, { baseVersion: service.snapshot(service.room(created.snapshot.code)).version }).snapshot;
    assert.equal(snapshot.turn.activeSeatId, 1);
  });

  test("handoffs skip poison and commander-damage eliminations", () => {
    const service = new RoomService();
    const host = service.createConnection();
    const created = service.createRoom(host.connectionId, { playerCount: 4, startingLife: 40 });
    const second = service.createConnection();
    const third = service.createConnection();
    const fourth = service.createConnection();
    let snapshot = service.claimSeat(created.snapshot.code, second.connectionId, { seatId: 1, name: "Jace" }).snapshot;
    snapshot = service.claimSeat(created.snapshot.code, third.connectionId, { seatId: 2, name: "Nissa" }).snapshot;
    snapshot = service.claimSeat(created.snapshot.code, fourth.connectionId, { seatId: 3, name: "Kaya" }).snapshot;
    snapshot = service.startGame(created.snapshot.code, host.connectionId, { baseVersion: snapshot.version }).snapshot;
    snapshot = service.adjustOwnSeat(created.snapshot.code, second.connectionId, { counter: "poison", delta: 10 }).snapshot;
    snapshot = service.adjustOwnSeat(created.snapshot.code, third.connectionId, { counter: "commanderDamage", commanderSourceId: "seat-0-commander-a", delta: 21 }).snapshot;

    snapshot = service.handoffTurn(created.snapshot.code, host.connectionId, { baseVersion: snapshot.version }).snapshot;
    assert.equal(snapshot.turn.activeSeatId, 3);
  });

  test("applies concurrent live counter deltas without a stale-version re-entry error", async () => {
    const made = await room();
    const playerConnection = await connection();
    const claimed = await call(`/api/rooms/${made.snapshot.code}/claim`, {
      method: "POST", connectionId: playerConnection, body: { seatId: 1, name: "Jace" },
    });
    const hostChange = await call(`/api/rooms/${made.snapshot.code}/adjust`, {
      method: "POST", connectionId: made.connectionId, body: { counter: "life", delta: -5 },
    });
    const playerChange = await call(`/api/rooms/${made.snapshot.code}/adjust`, {
      method: "POST", connectionId: playerConnection, body: { counter: "life", delta: -3 },
    });
    assert.equal(hostChange.status, 200);
    assert.equal(playerChange.status, 200);
    assert.equal(playerChange.body.snapshot.seats[0].counters.life, 35);
    assert.equal(playerChange.body.snapshot.seats[1].counters.life, 37);
    assert.equal(playerChange.body.snapshot.version, claimed.body.snapshot.version + 2);
  });

  test("records a last-player-standing winner and allows only the host to declare alternate wins", async () => {
    const made = await room({ playerCount: 2 });
    const playerConnection = await connection();
    const claimed = await call(`/api/rooms/${made.snapshot.code}/claim`, {
      method: "POST", connectionId: playerConnection, body: { seatId: 1, name: "Jace" },
    });
    const started = await call(`/api/rooms/${made.snapshot.code}/start-game`, {
      method: "POST", connectionId: made.connectionId, body: { baseVersion: claimed.body.snapshot.version },
    });
    const eliminated = await call(`/api/rooms/${made.snapshot.code}/adjust`, {
      method: "POST", connectionId: playerConnection, body: { counter: "life", delta: -40 },
    });
    assert.deepEqual(eliminated.body.snapshot.gameResult, {
      winnerSeatId: 0, reason: "last_player_standing", decidedAt: eliminated.body.snapshot.gameResult.decidedAt,
    });
    const reset = await call(`/api/rooms/${made.snapshot.code}/reset`, {
      method: "POST", connectionId: made.connectionId, body: { baseVersion: eliminated.body.snapshot.version },
    });
    assert.equal(reset.body.snapshot.gameResult, null);
    const denied = await call(`/api/rooms/${made.snapshot.code}/declare-winner`, {
      method: "POST", connectionId: playerConnection, body: { baseVersion: reset.body.snapshot.version, winnerSeatId: 1 },
    });
    assert.equal(denied.status, 403);
    const declared = await call(`/api/rooms/${made.snapshot.code}/declare-winner`, {
      method: "POST", connectionId: made.connectionId, body: { baseVersion: reset.body.snapshot.version, winnerSeatId: 1 },
    });
    assert.equal(declared.status, 200);
    assert.equal(declared.body.snapshot.gameResult.winnerSeatId, 1);
    assert.equal(declared.body.snapshot.gameResult.reason, "declared_winner");
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

test("stores player-owned playtest notes and limits recaps to the host", async () => {
  const made = await room({ playerCount: 2, name: "Host" });
  const playerConnection = await connection();
  const claimed = await call(`/api/rooms/${made.snapshot.code}/claim`, { method: "POST", connectionId: playerConnection, body: { seatId: 1, name: "Jace" } });
  assert.equal(claimed.status, 200);
  const note = await call(`/api/rooms/${made.snapshot.code}/playtest-notes`, { method: "POST", connectionId: playerConnection, body: { text: "Turn handoff was easy to find." } });
  assert.equal(note.status, 201);
  assert.equal(note.body.note.authorSeatId, 1);
  const notes = await call(`/api/rooms/${made.snapshot.code}/playtest-notes`, { connectionId: made.connectionId });
  assert.equal(notes.status, 200);
  assert.equal(notes.body.notes[0].text, "Turn handoff was easy to find.");
  const invalid = await call(`/api/rooms/${made.snapshot.code}/playtest-notes`, { method: "POST", connectionId: playerConnection, body: { text: " " } });
  assert.equal(invalid.status, 400);
  const denied = await call(`/api/rooms/${made.snapshot.code}/playtest-recap`, { connectionId: playerConnection });
  assert.equal(denied.status, 403);
  const recap = await call(`/api/rooms/${made.snapshot.code}/playtest-recap`, { connectionId: made.connectionId });
  assert.equal(recap.status, 200);
  assert.equal(recap.body.recap.players[1].name, "Jace");
  assert.equal(recap.body.recap.notes.length, 1);
});

test("archives a reset playtest with its notes and hands turns only to claimed seats", () => {
  let clock = 10_000;
  const ledger = new MemoryPlaytestLedger();
  const service = new RoomService({ now: () => clock, ledger });
  const host = service.createConnection();
  const made = service.createRoom(host.connectionId, { playerCount: 3, startingLife: 40, name: "Host" });
  const other = service.createConnection();
  const claimed = service.claimSeat(made.snapshot.code, other.connectionId, { seatId: 2, name: "Nissa" });
  service.chooseStartingPlayer(made.snapshot.code, host.connectionId, { baseVersion: claimed.snapshot.version, startingSeatId: 0 });
  const started = service.startGame(made.snapshot.code, host.connectionId, { baseVersion: service.snapshot(service.room(made.snapshot.code)).version });
  clock += 4_000;
  const handoff = service.handoffTurn(made.snapshot.code, host.connectionId, { baseVersion: started.snapshot.version });
  assert.equal(handoff.snapshot.turn.activeSeatId, 2);
  service.addPlaytestNote(made.snapshot.code, other.connectionId, { text: "The table stayed readable." });
  const reset = service.resetRoom(made.snapshot.code, host.connectionId, { baseVersion: service.snapshot(service.room(made.snapshot.code)).version });
  assert.notEqual(reset.snapshot.version, started.snapshot.version);
  const completed = ledger.records.find((entry) => entry.kind === "complete");
  assert.equal(completed.record.incomplete, true);
  assert.equal(completed.record.notes[0].text, "The table stayed readable.");
  assert.equal(completed.record.players[1].name, "Nissa");
});

test("records only an explicit, bounded host field-test summary", () => {
  let clock = 10_000;
  const ledger = new MemoryPlaytestLedger();
  const service = new RoomService({ now: () => clock, ledger });
  const host = service.createConnection();
  const made = service.createRoom(host.connectionId, { playerCount: 2, startingLife: 40 });
  const guest = service.createConnection();
  service.claimSeat(made.snapshot.code, guest.connectionId, { seatId: 1 });
  service.chooseStartingPlayer(made.snapshot.code, host.connectionId, { baseVersion: service.snapshot(service.room(made.snapshot.code)).version, startingSeatId: 0 });
  service.startGame(made.snapshot.code, host.connectionId, { baseVersion: service.snapshot(service.room(made.snapshot.code)).version });
  clock += 50_000;
  const result = service.recordFieldTest(made.snapshot.code, host.connectionId, { realTable: true, deviceMix: "mixed", repeatUse: "yes", dispute: "none", issues: ["setup", "reconnect"], note: "Everyone found life changes." });
  assert.equal(result.record.playerCount, 2);
  assert.equal(result.record.setupMs, 0);
  assert.equal(result.record.elapsedMs, 50_000);
  assert.equal(ledger.records.filter((entry) => entry.kind === "field_test").length, 1);
  assert.throws(() => service.recordFieldTest(made.snapshot.code, host.connectionId, { realTable: true, deviceMix: "mixed", repeatUse: "yes", dispute: "none", issues: [] }), { code: "FIELD_TEST_ALREADY_RECORDED" });
});

test("developer insights aggregate bounded field-test data without identities or observations", async () => {
  const ledger = new MemoryPlaytestLedger();
  ledger.fieldTest({ realTable: true, playerCount: 4, setupMs: 12_000, elapsedMs: 3_600_000, deviceMix: "mixed", repeatUse: "yes", dispute: "none", issues: ["readability", "turn-flow"], note: "Do not expose this." });
  ledger.fieldTest({ realTable: true, playerCount: 2, setupMs: 8_000, elapsedMs: 2_400_000, deviceMix: "ios", repeatUse: "unknown", dispute: "app", issues: ["reconnect"], note: "Or this." });
  const insights = await new RoomService({ ledger }).developerFieldTestInsights();
  assert.equal(insights.fieldTestCount, 2);
  assert.equal(insights.averageSetupMs, 10_000);
  assert.equal(insights.playerCounts[4], 1);
  assert.equal(insights.friction["turn-flow"], 1);
  assert.equal(JSON.stringify(insights).includes("Do not expose this."), false);
});

test("treats repeated life operation IDs as one adjustment", async () => {
  const made = await room({ playerCount: 2, startingLife: 40 });
  const operationId = "a4a5b5ce-8e3b-4d62-a7c5-5b5d2e6a2b3c";
  const first = await call(`/api/rooms/${made.snapshot.code}/adjust`, { method: "POST", connectionId: made.connectionId, body: { counter: "life", delta: -3, operationId } });
  const retry = await call(`/api/rooms/${made.snapshot.code}/adjust`, { method: "POST", connectionId: made.connectionId, body: { counter: "life", delta: -3, operationId } });
  assert.equal(first.status, 200); assert.equal(retry.status, 200);
  assert.equal(retry.body.deduplicated, true);
  assert.equal(retry.body.snapshot.seats[0].counters.life, 37);
});

test("bounds commander lookups and never turns an outage into a colorless result", async () => {
  const lookup = createCommanderIdentityLookup((_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })), { timeoutMs: 20 });
  await assert.rejects(() => lookup("Atraxa"), (error) => error.code === "COMMANDER_LOOKUP_UNAVAILABLE" && /without a color identity/.test(error.message));
  const connectionId = await connection();
  const made = await call("/api/rooms", { method: "POST", connectionId, body: { playerCount: 2, startingLife: 40, name: "<svg onload=alert(1)>" } });
  assert.equal(made.status, 201);
  assert.equal(made.body.snapshot.seats[0].name, "<svg onload=alert(1)>");
  assert.equal(JSON.stringify(made.body.snapshot).includes(made.body.reclaimToken), false);
});

test("restores a private recovery record with disconnected seats and token-scoped ownership", async () => {
  const ledger = new MemoryPlaytestLedger();
  const original = new RoomService({ ledger });
  const host = original.createConnection();
  const made = original.createRoom(host.connectionId, { playerCount: 2, startingLife: 40, commanderNames: ["Atraxa"] });
  const player = original.createConnection();
  const claimed = original.claimSeat(made.snapshot.code, player.connectionId, { seatId: 1, name: "Jace", commanderNames: ["Krenko"] });
  original.adjustOwnSeat(made.snapshot.code, player.connectionId, { counter: "commanderDamage", commanderSourceId: "seat-0-commander-a", delta: 7 });
  original.mutateOwnSeat(made.snapshot.code, player.connectionId, { baseVersion: original.snapshot(original.room(made.snapshot.code)).version, commanderCastCounts: { "seat-1-commander-a": 2 } });

  const restarted = new RoomService({ ledger });
  const restored = await restarted.restoreRoom(made.snapshot.code, made.hostRecoveryKey);
  assert.equal(restored.restored, true);
  assert.equal(restored.snapshot.seats[0].connected, false);
  assert.equal(restored.snapshot.seats[1].connected, false);
  assert.equal(restored.snapshot.seats[1].commanderDamageReceived["seat-0-commander-a"], 7);
  assert.equal(restored.snapshot.seats[1].nextCommanderTax["seat-1-commander-a"], 4);

  const stranger = restarted.createConnection();
  assert.throws(() => restarted.adjustOwnSeat(made.snapshot.code, stranger.connectionId, { counter: "life", delta: -1 }), { code: "NOT_SEAT_OWNER" });
  assert.throws(() => restarted.claimSeat(made.snapshot.code, stranger.connectionId, { seatId: 1, reclaimToken: made.reclaimToken }), { code: "SEAT_RESERVED" });
  const hostConnection = restarted.createConnection();
  restarted.claimSeat(made.snapshot.code, hostConnection.connectionId, { seatId: 0, reclaimToken: made.reclaimToken });
  const playerConnection = restarted.createConnection();
  const reclaimed = restarted.claimSeat(made.snapshot.code, playerConnection.connectionId, { seatId: 1, reclaimToken: claimed.reclaimToken });
  assert.equal(reclaimed.snapshot.seats[1].connected, true);
  const selfCommanderDamage = restarted.mutateOwnSeat(made.snapshot.code, hostConnection.connectionId, { baseVersion: reclaimed.snapshot.version, commanderDamageReceived: { "seat-0-commander-a": 8 } });
  assert.equal(selfCommanderDamage.snapshot.seats[0].commanderDamageReceived["seat-0-commander-a"], 8);
  assert.throws(() => restarted.mutateOwnSeat(made.snapshot.code, hostConnection.connectionId, { baseVersion: selfCommanderDamage.snapshot.version, commanderCastCounts: { "seat-1-commander-a": 3 } }), { code: "INVALID_INPUT" });
});

test("batches rapid life taps into one fresh client operation", async () => {
  const jobs = []; const sent = [];
  const batcher = new LifeAdjustmentBatcher({ operationId: () => `operation-${sent.length + 1}-fresh-id`, schedule: (job) => { jobs.push(job); return jobs.length; }, cancel: () => {}, send: (operation) => sent.push(operation) });
  batcher.add(-1); batcher.add(-5);
  await batcher.flush();
  assert.deepEqual(sent, [{ delta: -6, operationId: "operation-1-fresh-id" }]);
  batcher.add(1); await batcher.flush();
  assert.equal(sent[1].operationId, "operation-2-fresh-id");
});

test("uses a compatible life operation ID when randomUUID is unavailable", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  try {
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: { getRandomValues: (bytes) => { bytes.forEach((_value, index) => { bytes[index] = index; }); return bytes; } } });
    assert.equal(compatibleOperationId(), "000102030405060708090a0b0c0d0e0f");
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
    else delete globalThis.crypto;
  }
});
