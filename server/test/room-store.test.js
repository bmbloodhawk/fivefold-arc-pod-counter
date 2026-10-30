import assert from "node:assert/strict";
import test from "node:test";
import { FirebaseRoomStore, MemoryRoomStore } from "../src/room-store.js";
import { RoomService } from "../src/app.js";

test("memory room store rejects a stale durable version without replacing the room", async () => {
  const store = new MemoryRoomStore();
  await store.create({ schemaVersion: 1, code: "ARC123", version: 1, seats: [] });
  const committed = await store.compareAndSwap("ARC123", 1, { schemaVersion: 1, code: "ARC123", version: 2, seats: [{ seatId: 0 }] });
  const stale = await store.compareAndSwap("ARC123", 1, { schemaVersion: 1, code: "ARC123", version: 2, seats: [{ seatId: 1 }] });

  assert.deepEqual(committed, { committed: true, room: { schemaVersion: 1, code: "ARC123", version: 2, seats: [{ seatId: 0 }] } });
  assert.equal(stale.committed, false);
  assert.deepEqual(stale.room.seats, [{ seatId: 0 }]);
});

test("Firebase room store writes with the ETag returned by its latest read", async () => {
  const calls = [];
  const store = new FirebaseRoomStore({
    databaseUrl: "https://example.firebaseio.test",
    accessToken: async () => "server-token",
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if ((options.method || "GET") === "GET") return new Response(JSON.stringify({ schemaVersion: 1, code: "ARC123", version: 1 }), { headers: { etag: '"room-v1"' } });
      return new Response(JSON.stringify({ schemaVersion: 1, code: "ARC123", version: 2 }), { headers: { etag: '"room-v2"' } });
    },
  });

  const result = await store.compareAndSwap("ARC123", 1, { schemaVersion: 1, code: "ARC123", version: 2 });

  assert.equal(result.committed, true);
  assert.equal(calls[0].options.headers["x-firebase-etag"], "true");
  assert.equal(calls[1].options.headers["if-match"], '"room-v1"');
  assert.equal(calls[1].options.headers.authorization, "Bearer server-token");
});

test("Firebase room store returns the current room on an ETag conflict", async () => {
  const store = new FirebaseRoomStore({
    databaseUrl: "https://example.firebaseio.test",
    accessToken: async () => "server-token",
    fetchImpl: async (_url, options = {}) => (options.method || "GET") === "GET"
      ? new Response(JSON.stringify({ schemaVersion: 1, code: "ARC123", version: 3 }), { headers: { etag: '"room-v3"' } })
      : new Response(JSON.stringify({ schemaVersion: 1, code: "ARC123", version: 4 }), { status: 412, headers: { etag: '"room-v4"' } }),
  });

  const result = await store.compareAndSwap("ARC123", 3, { schemaVersion: 1, code: "ARC123", version: 4 });

  assert.deepEqual(result, { committed: false, room: { schemaVersion: 1, code: "ARC123", version: 4 } });
});

test("a new server instance loads a durable room and accepts the existing seat reclaim token", async () => {
  const store = new MemoryRoomStore();
  const original = new RoomService({ roomStore: store });
  const host = original.createConnection();
  const created = await original.createRoomDurably(host.connectionId, { playerCount: 2, startingLife: 40 });
  await original.mutateDurably(created.snapshot.code, () => original.adjustOwnSeat(created.snapshot.code, host.connectionId, { counter: "life", delta: -3 }));

  const restarted = new RoomService({ roomStore: store });
  const reconnected = restarted.createConnection();
  const reclaimed = await restarted.mutateDurably(created.snapshot.code, () => restarted.claimSeat(created.snapshot.code, reconnected.connectionId, { seatId: 0, reclaimToken: created.reclaimToken }));

  assert.equal(reclaimed.snapshot.seats[0].counters.life, 37);
  assert.equal(reclaimed.snapshot.seats[0].connected, true);
});
