import test from "node:test";
import assert from "node:assert/strict";
import { APPEARANCE_CATALOG_SCHEMA_VERSION, FirebaseAppearanceCatalog, createAppearanceCatalogFromEnv, normalizeCatalog } from "../src/appearance-catalog.js";

test("Firebase appearance catalog reads and writes a dedicated catalog path", async () => {
  const calls = [];
  const catalog = new FirebaseAppearanceCatalog({ client: { async read(path) { calls.push(["read", path]); return { skins: [{ id: "skin-a" }], assets: [], selected: "skin-a" }; }, async write(path, value) { calls.push(["write", path, value]); } } });
  assert.deepEqual(await catalog.read(), { schemaVersion: APPEARANCE_CATALOG_SCHEMA_VERSION, skins: [{ id: "skin-a" }], assets: [], selected: "skin-a", gameDefaultLayout: null });
  assert.deepEqual(await catalog.write({ skins: "invalid", assets: [{ id: "asset-a" }], selected: 4 }), { schemaVersion: APPEARANCE_CATALOG_SCHEMA_VERSION, skins: [], assets: [{ id: "asset-a" }], selected: "neutral", gameDefaultLayout: null });
  assert.deepEqual(calls.map(([type, path]) => [type, path]), [["read", "appearance-studio/catalog.json"], ["write", "appearance-studio/catalog.json"]]);
});

test("appearance catalog migrates legacy catalogs and ignores malformed records", () => {
  const catalog = normalizeCatalog({ skins: [{ id: "valid", name: "Kept" }, { id: "bad id" }, null], assets: [{ id: "art-1" }, { id: "" }], selected: "valid", gameDefaultLayout: [] });
  assert.equal(catalog.schemaVersion, APPEARANCE_CATALOG_SCHEMA_VERSION);
  assert.deepEqual(catalog.skins, [{ id: "valid", name: "Kept" }]);
  assert.deepEqual(catalog.assets, [{ id: "art-1" }]);
  assert.equal(catalog.selected, "valid");
  assert.equal(catalog.gameDefaultLayout, null);
});

test("appearance catalog bounds and de-nests saved skin versions", () => {
  const catalog = normalizeCatalog({ skins: [{ id: "valid", versions: Array.from({ length: 14 }, (_, index) => ({ id: `version-${index}`, label: "Saved", savedAt: "2026-10-13T00:00:00.000Z", appearance: { background: "#080808", versions: [{ id: "nested" }] } })) }], assets: [] });
  assert.equal(catalog.skins[0].versions.length, 12);
  assert.equal(catalog.skins[0].versions[0].id, "version-2");
  assert.equal(catalog.skins[0].versions[0].appearance.versions, undefined);
});

test("appearance catalog falls back to local storage without Firebase credentials", () => {
  const catalog = createAppearanceCatalogFromEnv({ env: {}, path: "catalog.json" });
  assert.equal(catalog.constructor.name, "AppearanceCatalog");
});
