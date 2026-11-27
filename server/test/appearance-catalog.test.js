import test from "node:test";
import assert from "node:assert/strict";
import { APPEARANCE_CATALOG_SCHEMA_VERSION, AppearanceCatalog, FirebaseAppearanceCatalog, createAppearanceCatalogFromEnv, normalizeCatalog } from "../src/appearance-catalog.js";

test("Firebase appearance catalog reads and writes a dedicated catalog path", async () => {
  const calls = [];
  const catalog = new FirebaseAppearanceCatalog({ client: { async read(path) { calls.push(["read", path]); return { skins: [{ id: "skin-a" }], assets: [], selected: "skin-a" }; }, async write(path, value) { calls.push(["write", path, value]); } } });
  assert.deepEqual(await catalog.read(), { schemaVersion: APPEARANCE_CATALOG_SCHEMA_VERSION, revision: 0, skins: [{ id: "skin-a" }], assets: [], selected: "skin-a", gameDefaultLayout: null });
  assert.deepEqual(await catalog.write({ skins: "invalid", assets: [{ id: "asset-a" }], selected: 4 }), { schemaVersion: APPEARANCE_CATALOG_SCHEMA_VERSION, revision: 0, skins: [], assets: [{ id: "asset-a" }], selected: "__neutral_arc__", gameDefaultLayout: null });
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

test('appearance storage rejects future schema versions instead of silently downgrading them', () => {
  assert.throws(() => normalizeCatalog({ schemaVersion: 99, skins: [], assets: [] }), /Unsupported/);
});

test('appearance asset storage rejects path traversal independently of HTTP routing', () => {
  const catalog = new AppearanceCatalog('catalog.json');
  assert.throws(() => catalog.assetPath('../private'), /Invalid/);
  assert.throws(() => catalog.assetPath('a/b'), /Invalid/);
});

test('independent Firebase catalog adapters reject one stale revision instead of losing a concurrent save', async () => {
  let current = { schemaVersion: 1, revision: 0, skins: [], assets: [] };
  const client = { async read() { return current; }, async write(_path, value) { current = value; }, async update(_path, change) { await Promise.resolve(); const next = change(current); current = next; return next; } };
  const first = new FirebaseAppearanceCatalog({ client }), second = new FirebaseAppearanceCatalog({ client });
  const outcomes = await Promise.allSettled([first.write({ ...current, revision: 1, skins: [{ id: 'one' }] }, { expectedRevision: 0 }), second.write({ ...current, revision: 1, skins: [{ id: 'two' }] }, { expectedRevision: 0 })]);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  const failure = outcomes.find(item => item.status === 'rejected');
  assert.equal(failure.reason.code, 'APPEARANCE_CONFLICT');
  assert.equal(current.revision, 1);
  assert.equal(current.skins.length, 1);
});

test('Firebase asset creation keeps a stable ID immutable across independent adapters and identical retries', async () => {
  let current = null;
  const client = { async read() { return current; }, async write(_path, value) { current = value; }, async update(_path, change) { await Promise.resolve(); const next = change(current); current = next; return next; } };
  const first = new FirebaseAppearanceCatalog({ client }), second = new FirebaseAppearanceCatalog({ client });
  const original = { id: 'asset-test', name: 'Original', source: 'Original', placement: 'symbol', data: 'first' };
  const outcomes = await Promise.allSettled([first.writeAsset('asset-test', original, { createOnly: true }), second.writeAsset('asset-test', { ...original, data: 'other' }, { createOnly: true })]);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(current.data, 'first');
  assert.deepEqual(await second.writeAsset('asset-test', original, { createOnly: true }), original);
});

test('virtual Neutral Arc selection round-trips independently from the legacy neutral-ID skin', async () => {
  const legacy = { id: 'neutral', name: 'Carl MTG', status: 'Approved' };
  const input = { schemaVersion: 1, skins: [legacy], assets: [], selected: '__neutral_arc__' };
  const client = { value: input, async read() { return this.value; }, async write(_path, value) { this.value = value; } };
  const catalog = new FirebaseAppearanceCatalog({ client });
  assert.equal((await catalog.read()).selected, '__neutral_arc__');
  assert.equal((await catalog.write(input)).selected, '__neutral_arc__');
  assert.equal((await catalog.read()).selected, '__neutral_arc__');
  assert.deepEqual(client.value.skins, [legacy]);
  assert.equal(normalizeCatalog({ skins: [legacy], assets: [] }).selected, '__neutral_arc__');
  assert.equal(normalizeCatalog({ skins: [legacy], assets: [], selected: 'missing' }).selected, '__neutral_arc__');
  assert.equal(normalizeCatalog({ skins: [legacy], assets: [], selected: 'neutral' }).selected, 'neutral');
  assert.equal(normalizeCatalog(null).selected, '__neutral_arc__');
  assert.equal(normalizeCatalog({ skins: [], assets: [], selected: 'neutral' }).selected, '__neutral_arc__');
});
