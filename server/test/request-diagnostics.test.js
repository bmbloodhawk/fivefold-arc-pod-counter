import assert from "node:assert/strict";
import { test } from "node:test";
import { createRealtimeServer, RoomService } from "../src/app.js";

test("unexpected request errors log bounded fields and a server-generated response ID", async (t) => {
  const service = new RoomService();
  service.ensureRoom = async () => { throw new Error("synthetic private error text"); };
  const logger = t.mock.method(console, "error", () => {});
  const { server } = createRealtimeServer({ service });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const path = "/api/rooms/ROOM42/adjust?connectionId=synthetic-private-query";
  const headers = { "x-request-id": "synthetic-client-supplied-id" };

  const response = await fetch(`${base}${path}`, { method: "POST", headers });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  const requestId = response.headers.get("x-request-id");
  assert.match(requestId ?? "", /^[A-Za-z0-9_-]{22}$/);

  const unusualMethod = await fetch(`${base}${path}`, { method: "PROPFIND", headers });
  await unusualMethod.json();
  assert.equal(unusualMethod.status, 500);
  const unusualRequestId = unusualMethod.headers.get("x-request-id");
  assert.match(unusualRequestId ?? "", /^[A-Za-z0-9_-]{22}$/);
  assert.notEqual(requestId, unusualRequestId);

  const rejected = await fetch(`${base}/api/rooms`, { method: "POST" });
  await rejected.json();
  assert.equal(rejected.status, 401);
  assert.equal(rejected.headers.get("x-request-id"), null);

  assert.equal(logger.mock.callCount(), 2);
  for (const [index, id] of [requestId, unusualRequestId].entries()) {
    const args = logger.mock.calls[index].arguments;
    assert.equal(args.length, 1);
    const { at, ...event } = JSON.parse(args[0]);
    assert.equal(new Date(at).toISOString(), at);
    assert.deepEqual(event, { event: "request_failed", method: index === 0 ? "POST" : "other", feature: "rooms", status: 500, requestId: id });
  }
});
