import assert from "node:assert/strict";
import test from "node:test";
import { getTableDeviceId } from "./table-device-id.js";

test("table device identity is stable across connections and replaces corrupt storage", t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const entries = new Map();
  const storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  t.after(() => previous ? Object.defineProperty(globalThis, "localStorage", previous) : delete globalThis.localStorage);

  const first = getTableDeviceId();
  assert.match(first, /^[a-f0-9-]{36}$/);
  assert.equal(getTableDeviceId(), first);
  const [key] = entries.keys();
  entries.set(key, "invalid");
  const repaired = getTableDeviceId();
  assert.notEqual(repaired, first);
  assert.equal(getTableDeviceId(), repaired);
});

test("blocked browser storage skips device measurement", t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
  t.after(() => previous ? Object.defineProperty(globalThis, "localStorage", previous) : delete globalThis.localStorage);
  assert.equal(getTableDeviceId(), null);
});
