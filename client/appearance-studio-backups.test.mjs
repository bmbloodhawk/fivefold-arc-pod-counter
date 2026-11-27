import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { crc32 } from 'node:zlib';
import { prepareCatalogRestore, assertBackupContentLimits, backupMetadata, PORTABLE_BACKUP_FILE_LIMIT } from './appearance-studio-backups.js';
import { validateAppearanceCatalog, validateAppearanceAsset, assertAppearanceValid } from './appearance-validation.js';

test('new approved backup records restore as drafts and pending artwork, while existing approvals stay exact', () => {
  const prior = { id: 'existing', status: 'Approved', name: 'Existing' };
  const oldArt = { id: 'old-art', name: 'Old', source: 'Original', placement: 'background', status: 'Approved' };
  const input = { skins: [prior, { id: 'imported', name: 'Imported', status: 'Approved', rendererVersion: 2, access: { type: 'invitation' } }], assets: [oldArt, { id: 'new-art', name: 'New', source: 'Original', placement: 'background', status: 'Approved' }] };
  const before = structuredClone(input);
  const result = prepareCatalogRestore(input, { skins: [prior], assets: [oldArt] });
  assert.deepEqual(result.catalog.skins[0], prior);
  assert.deepEqual(result.catalog.assets[0], oldArt);
  assert.equal(result.catalog.skins[1].status, 'Draft');
  assert.equal(result.catalog.assets[1].status, 'Pending');
  assert.deepEqual(result.catalog.skins[1].access, input.skins[1].access);
  assert.equal(result.draftedSkins, 1);
  assert.equal(result.pendingAssets, 1);
  assert.deepEqual(input, before);
});

test('metadata is capped independently of embedded artwork', () => {
  assert.throws(() => assertBackupContentLimits({ skins: [], assets: [], oversized: 'x'.repeat(8 * 1024 * 1024) }), /metadata.*8 MB/i);
});

test('an impossible oversized file is rejected before reading its contents', async () => {
  const studio = await readFile(new URL('appearance-studio.js', import.meta.url), 'utf8');
  const source = studio.slice(studio.indexOf('async function readCatalogBackupFile('), studio.indexOf("$('#exportCatalogButton').addEventListener"));
  let read = false;
  const file = { size: PORTABLE_BACKUP_FILE_LIMIT + 1, async text() { read = true; return '{}'; } };
  const context = { $: () => ({ files: [file] }), PORTABLE_BACKUP_FILE_LIMIT };
  vm.createContext(context); vm.runInContext(source, context);
  await assert.rejects(context.readCatalogBackupFile(), /maximum.*backup|backup.*maximum/i);
  assert.equal(read, false);
});

test('a portable backup larger than eight megabytes round-trips valid artwork in the same catalog', async () => {
  const original = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64');
  const text = Buffer.concat([Buffer.from('note\0'), Buffer.alloc(800_000, 120)]);
  const type = Buffer.from('tEXt'), length = Buffer.alloc(4), crc = Buffer.alloc(4);
  length.writeUInt32BE(text.length); crc.writeUInt32BE(crc32(Buffer.concat([type, text])));
  const png = 'data:image/png;base64,' + Buffer.concat([original.subarray(0, -12), length, type, text, crc, original.subarray(-12)]).toString('base64');
  const assets = Array.from({ length: 9 }, (_, index) => ({ id: `art-${index}`, name: `Art ${index}`, source: 'Original test artwork', placement: 'background', status: 'Approved', data: png }));
  const catalog = { schemaVersion: 1, skins: [], assets, selected: '__neutral_arc__', gameDefaultLayout: null };
  const metadata = { ...catalog, assets: assets.map(({ data, ...asset }) => asset) };
  const content = JSON.stringify(catalog, null, 2);
  assert.ok(Buffer.byteLength(content) > 8 * 1024 * 1024);
  const studio = await readFile(new URL('appearance-studio.js', import.meta.url), 'utf8');
  const source = studio.slice(studio.indexOf('function inspectCatalogBackup('), studio.indexOf("$('#exportCatalogButton').addEventListener"));
  const file = { size: Buffer.byteLength(content), text: async () => content };
  const context = { $: () => ({ files: [file] }), confirmedCatalog: metadata, store: { assets }, APPEARANCE_CATALOG_SCHEMA_VERSION: 1, validateAppearanceCatalog, validateAppearanceAsset, assertAppearanceValid, prepareCatalogRestore, assertBackupContentLimits, backupMetadata, PORTABLE_BACKUP_FILE_LIMIT };
  vm.createContext(context); vm.runInContext(source, context);
  const parsed = await context.readCatalogBackupFile();
  const result = context.inspectCatalogBackup(parsed);
  assert.equal(result.assets, 9);
  assert.equal(result.catalog.assets[0].data, png);
  assert.equal(result.catalog.assets[0].status, 'Approved');
  assert.equal(result.pendingAssets, 0);
});
