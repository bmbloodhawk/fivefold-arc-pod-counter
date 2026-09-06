import test from "node:test";
import assert from "node:assert/strict";
import { FirebaseAppearanceCatalog, createAppearanceCatalogFromEnv } from "../src/appearance-catalog.js";

test("Firebase appearance catalog reads and writes a dedicated catalog path", async () => {
  const calls = [];
  const catalog = new FirebaseAppearanceCatalog({ client: { async read(path) { calls.push(["read", path]); return { skins: [{ id: "skin-a" }], assets: [], selected: "skin-a" }; }, async write(path, value) { calls.push(["write", path, value]); } } });
  assert.deepEqual(await catalog.read(), { skins: [{ id: "skin-a" }], assets: [], selected: "skin-a" });
  assert.deepEqual(await catalog.write({ skins: "invalid", assets: [{ id: "asset-a" }], selected: 4 }), { skins: [], assets: [{ id: "asset-a" }], selected: "4" });
  assert.deepEqual(calls.map(([type, path]) => [type, path]), [["read", "appearance-studio/catalog.json"], ["write", "appearance-studio/catalog.json"]]);
});

test("appearance catalog falls back to local storage without Firebase credentials", () => {
  const catalog = createAppearanceCatalogFromEnv({ env: {}, path: "catalog.json" });
  assert.equal(catalog.constructor.name, "AppearanceCatalog");
});
