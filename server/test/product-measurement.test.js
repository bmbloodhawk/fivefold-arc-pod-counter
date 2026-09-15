import assert from "node:assert/strict";
import test from "node:test";
import { RoomService } from "../src/app.js";
import { ProductMeasurement, productMeasurementRecord, productMeasurementSummary } from "../src/product-measurement.js";

test("product measurement is disabled by default", () => {
  const writes = [];
  const measurement = new ProductMeasurement({ write: (record) => writes.push(record) });
  assert.equal(measurement.record({ event: "game_started" }), false);
  assert.deepEqual(writes, []);
});

test("product measurement accepts only bounded outcome fields", () => {
  assert.deepEqual(productMeasurementRecord({ event: "feature_used", feature: "commander_damage" }), {
    schemaVersion: 1,
    event: "feature_used",
    feature: "commander_damage",
  });
  assert.deepEqual(productMeasurementRecord({ event: "seat_claim_failed", failureCategory: "seat_unavailable" }), {
    schemaVersion: 1,
    event: "seat_claim_failed",
    failureCategory: "seat_unavailable",
  });
  assert.throws(() => productMeasurementRecord({ event: "counter_tapped" }), /event is not allowed/);
  assert.throws(() => productMeasurementRecord({ event: "game_started", feature: "poison" }), /Feature is allowed only/);
});

test("privacy fields and raw gameplay values cannot enter a measurement record", () => {
  const forbidden = ["playerName", "roomCode", "reclaimToken", "connectionId", "deckName", "counterValue", "ipAddress", "accountId", "gameId"];
  for (const field of forbidden) {
    assert.throws(() => productMeasurementRecord({ event: "game_started", [field]: "private" }), new RegExp(field));
  }
});

test("product summaries contain counts only", () => {
  assert.deepEqual(productMeasurementSummary([
    { event: "pod_creation_started" },
    { event: "pod_creation_succeeded" },
    { event: "feature_used", feature: "commander_tax" },
    { event: "feature_used", feature: "commander_tax" },
    { event: "server_error", failureCategory: "connection" },
  ]), {
    events: { pod_creation_started: 1, pod_creation_succeeded: 1, feature_used: 2, server_error: 1 },
    features: { commander_tax: 2 },
    failures: { connection: 1 },
  });
});

test("room outcomes use the disabled-by-default measurement boundary without identifiers", () => {
  const writes = [];
  const productMeasurement = new ProductMeasurement({ enabled: true, write: (record) => writes.push(record) });
  const service = new RoomService({ productMeasurement });
  const host = service.createConnection();
  const created = service.createRoom(host.connectionId, { playerCount: 2, startingLife: 40 });
  const guest = service.createConnection();
  const claimed = service.claimSeat(created.snapshot.code, guest.connectionId, { seatId: 1, name: "Private player" });
  service.startGame(created.snapshot.code, host.connectionId, { baseVersion: claimed.snapshot.version });

  assert.deepEqual(writes.map((record) => record.event), [
    "pod_creation_succeeded",
    "seat_claim_succeeded",
    "second_player_joined",
    "game_started",
  ]);
  assert.equal(JSON.stringify(writes).includes(created.snapshot.code), false);
  assert.equal(JSON.stringify(writes).includes(host.connectionId), false);
  assert.equal(JSON.stringify(writes).includes("Private player"), false);
});
