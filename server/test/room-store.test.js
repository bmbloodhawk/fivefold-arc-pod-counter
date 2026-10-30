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

test("memory room store deletes only the durable version it inspected", async () => {
  const store = new MemoryRoomStore();
  await store.create({ schemaVersion: 1, code: "ARC123", version: 3, seats: [] });

  assert.equal((await store.delete("ARC123", 2)).deleted, false);
  assert.equal((await store.delete("ARC123", 3)).deleted, true);
  assert.equal(await store.read("ARC123"), null);
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

test("an expired durable room cannot be revived after a server restart", async () => {
  let now = 10_000;
  const store = new MemoryRoomStore();
  const original = new RoomService({ roomStore: store, now: () => now, roomTtlMs: 100 });
  const host = original.createConnection();
  const created = await original.createRoomDurably(host.connectionId, { playerCount: 2, startingLife: 40 });

  now += 101;
  const restarted = new RoomService({ roomStore: store, now: () => now, roomTtlMs: 100 });
  await assert.rejects(() => restarted.loadDurableRoom(created.snapshot.code), { code: "ROOM_NOT_FOUND", status: 404 });
  assert.equal(await store.read(created.snapshot.code), null);
});

test("host recovery reads the durable room before falling back to the legacy recovery ledger", async () => {
  const store = new MemoryRoomStore();
  const original = new RoomService({ roomStore: store });
  const host = original.createConnection();
  const created = await original.createRoomDurably(host.connectionId, { playerCount: 2, startingLife: 40 });
  await original.mutateDurably(created.snapshot.code, () => original.adjustOwnSeat(created.snapshot.code, host.connectionId, { counter: "life", delta: -4 }));

  const restarted = new RoomService({ roomStore: store });
  const restored = await restarted.restoreRoom(created.snapshot.code, created.hostRecoveryKey);

  assert.equal(restored.restored, false);
  assert.equal(restored.snapshot.seats[0].counters.life, 36);
});
