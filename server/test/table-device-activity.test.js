import assert from "node:assert/strict";
import test from "node:test";
import { RoomService, createRealtimeServer } from "../src/app.js";
import { TableDeviceActivity } from "../src/table-device-activity.js";

const DAY = 86_400_000;
const id = n => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
function memoryStore() {
  const values = new Map();
  return {
    values,
    async read(path) { return structuredClone(values.get(path) ?? null); },
    async update(path, change) {
      const next = change(structuredClone(values.get(path) ?? null));
      values.set(path, structuredClone(next));
      return structuredClone(next);
    },
  };
}

test("successful creates and joins count each browser once, including after a server restart", async () => {
  const store = memoryStore();
  const now = () => 1_800_000_000_000;
  const activity = new TableDeviceActivity({ store, environment: "staging", now });
  const service = new RoomService({ tableDeviceActivity: activity });
  const host = service.createConnection({ tableDeviceId: id(1) });
  const guest = service.createConnection({ tableDeviceId: id(2) });
  const failed = service.createConnection({ tableDeviceId: id(3) });
  const made = service.createRoom(host.connectionId, { playerCount: 2, startingLife: 40 });
  service.claimSeat(made.snapshot.code, guest.connectionId, { seatId: 1, name: "Fixture Guest" });
  assert.throws(() => service.claimSeat(made.snapshot.code, failed.connectionId, { seatId: 1 }), /reserved/);
  const returning = service.createConnection({ tableDeviceId: id(1) });
  service.createRoom(returning.connectionId, { playerCount: 2, startingLife: 40 });
  await activity.flush();

  const summary = await activity.summary();
  assert.deepEqual(summary.counts, { last24Hours: 2, last7Days: 2, last30Days: 2 });
  assert.equal(summary.collectionStartedAt, now());
  const stored = JSON.stringify([...store.values]);
  for (const privateValue of [id(1), id(2), id(3), made.snapshot.code, "Fixture Guest"]) {
    assert.equal(stored.includes(privateValue), false);
  }
  const restarted = new TableDeviceActivity({ store, environment: "staging", now });
  assert.deepEqual((await restarted.summary()).counts, summary.counts);
  const production = new TableDeviceActivity({ store, environment: "production", now });
  assert.deepEqual((await production.summary()).counts, { last24Hours: 0, last7Days: 0, last30Days: 0 });
});

test("rolling windows use the latest visit and discard records older than 30 days", async () => {
  const store = memoryStore();
  const end = 1_800_000_000_000;
  let clock = end - 31 * DAY;
  const activity = new TableDeviceActivity({ store, now: () => clock });
  activity.record(id(1));
  clock = end - 30 * DAY; activity.record(id(2));
  clock = end - 7 * DAY; activity.record(id(3));
  clock = end - DAY; activity.record(id(4));
  clock = end - 3_600_000; activity.record(id(5));
  clock = end; activity.record(id(5));
  await activity.flush();

  assert.deepEqual((await activity.summary()).counts, { last24Hours: 2, last7Days: 3, last30Days: 4 });
  assert.equal(Object.keys([...store.values.values()][0].devices).length, 4);
  clock += 31 * DAY;
  activity.prune();
  await activity.flush();
  assert.deepEqual((await activity.summary()).counts, { last24Hours: 0, last7Days: 0, last30Days: 0 });
  assert.equal(Object.keys([...store.values.values()][0].devices).length, 0);
});

test("missing IDs and failed measurement writes preserve the successful table flow", async () => {
  const store = memoryStore();
  store.update = async () => { throw new Error("fixture unavailable"); };
  const activity = new TableDeviceActivity({ store, logger: { warn() {} } });
  const service = new RoomService({ tableDeviceActivity: activity });
  for (const input of [{}, { tableDeviceId: "malformed" }, { tableDeviceId: id(1) }]) {
    const connection = service.createConnection(input);
    assert.ok(service.createRoom(connection.connectionId, { playerCount: 2, startingLife: 40 }).snapshot);
  }
  await activity.flush();
  assert.equal((await activity.summary()).collectionStatus, "partial");
  assert.equal((await new TableDeviceActivity().summary()).configured, false);
});

test("device totals require owner access and expose only aggregate data", async t => {
  const activity = new TableDeviceActivity({ store: memoryStore(), now: () => 1_800_000_000_000 });
  activity.record(id(1));
  const { server } = createRealtimeServer({ tableDeviceActivity: activity, feedbackPortalKey: "fixture-owner" });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  t.after(() => new Promise(done => { server.close(done); server.closeAllConnections(); }));
  const url = "http://127.0.0.1:" + server.address().port + "/api/feedback/device-activity";
  assert.equal((await fetch(url)).status, 403);
  const response = await fetch(url, { headers: { "x-feedback-portal-key": "fixture-owner" } });
  assert.equal(response.status, 200);
  const { deviceActivity } = await response.json();
  assert.deepEqual(Object.keys(deviceActivity).sort(), ["asOf", "collectionStartedAt", "collectionStatus", "configured", "counts", "retentionDays"]);
  assert.deepEqual(deviceActivity.counts, { last24Hours: 1, last7Days: 1, last30Days: 1 });
  assert.equal(JSON.stringify(deviceActivity).includes(id(1)), false);
});
