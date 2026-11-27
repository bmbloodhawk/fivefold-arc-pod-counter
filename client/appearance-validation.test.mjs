import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAppearanceSkin, validateAppearanceAsset, validateAppearanceCatalog, inspectImageData, publicAppearanceSkin } from './appearance-validation.js';

const skin = () => ({ id: 'skin-test', name: 'Test', status: 'Draft', background: '#080808', surface: '#161616', text: '#f4ecd9', accent: '#d8ae61', modeLayouts: { dial: { seatRadius: 0, componentLayout: { counterReadout: { x: 0, y: 0, scale: 100 } } } } });
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
const asset = () => ({ id: 'asset-test', name: 'Seal', source: 'Original art', placement: 'symbol', data: png, status: 'Pending' });

test('appearance schema accepts supported legacy fields and zero values without changing input', () => {
  const value = skin(), before = JSON.stringify(value);
  assert.deepEqual(validateAppearanceSkin(value).errors, []);
  assert.equal(JSON.stringify(value), before);
});

test('appearance schema rejects executable fields, unknown selectors, invalid tokens and unbounded placement', () => {
  for (const change of [{ callback: 'evil' }, { selector: 'body' }, { text: 'url(https://example.test)' }, { fontFamily: 'custom-font' }, { modeLayouts: { dial: { componentLayout: { counterReadout: { x: 101, y: 0, scale: 100 } } } } }, { tokens: { schemaVersion: 99 } }]) {
    assert.ok(validateAppearanceSkin({ ...skin(), ...change }).errors.length, JSON.stringify(change));
  }
});

test('malformed nested imports report errors instead of throwing during reference validation', () => {
  for (const change of [{ id: { toString: {} } }, { text: { toString: {} } }, { modeLayouts: { dial: null } }, { modeLayouts: [] }, { symbolAssets: 'asset-test' }, { overlays: null }, { versions: {} }, { tokens: { color: null } }]) {
    assert.doesNotThrow(() => validateAppearanceSkin({ ...skin(), ...change }, { assets: [] }));
    assert.ok(validateAppearanceSkin({ ...skin(), ...change }, { assets: [] }).errors.length);
  }
  assert.doesNotThrow(() => validateAppearanceCatalog({ skins: [{ id: { toString: {} } }], assets: [] }));
  assert.doesNotThrow(() => validateAppearanceAsset({ ...asset(), id: { toString: {} } }));
});

test('image inspection verifies signature, dimensions, MIME agreement and memory bounds', () => {
  const info = inspectImageData(png);
  assert.equal(info.mimeType, 'image/png');
  assert.ok(info.width > 0 && info.height > 0 && info.bytes > 0);
  assert.throws(() => inspectImageData(png.replace('image/png', 'image/jpeg')), /match|JPEG/i);
  assert.throws(() => inspectImageData('data:image/png;base64,bm90LWFuLWltYWdl'), /PNG|image/i);
  assert.throws(() => inspectImageData('https://example.test/private.png'), /data|image/i);
  assert.throws(() => inspectImageData('data:image/svg+xml;base64,PHN2Zy8+'), /PNG|JPEG|WebP/i);
  const oversizedDimensions = Buffer.from(png.split(',')[1], 'base64');
  oversizedDimensions.writeUInt32BE(5000, 16);
  assert.throws(() => inspectImageData(`data:image/png;base64,${oversizedDimensions.toString('base64')}`), /dimensions|4096/i);
  assert.throws(() => inspectImageData(`data:image/png;base64,${'AAAA'.repeat(500001)}`), /1.5 MB/i);
});

test('asset validation checks roles, encoded data, dimensions and stable IDs', () => {
  assert.deepEqual(validateAppearanceAsset(asset(), { requireData: true }).errors, []);
  for (const change of [{ id: '../secret' }, { placement: 'arbitrary-selector' }, { data: 'not-an-image' }, { width: 2 }, { path: '/api/developer/private' }]) {
    assert.ok(validateAppearanceAsset({ ...asset(), ...change }, { requireData: true }).errors.length, JSON.stringify(change));
  }
});

test('missing, wrong-role and unapproved asset references block publication', () => {
  const value = { ...skin(), sealAsset: 'asset-test' };
  assert.ok(validateAppearanceSkin(value, { assets: [], requireApprovedAssets: true }).errors.length);
  assert.ok(validateAppearanceSkin(value, { assets: [{ ...asset(), placement: 'background', status: 'Approved' }], requireApprovedAssets: true }).errors.length);
  assert.ok(validateAppearanceSkin(value, { assets: [asset()], requireApprovedAssets: true }).errors.length);
  assert.deepEqual(validateAppearanceSkin(value, { assets: [{ ...asset(), status: 'Approved' }], requireApprovedAssets: true }).errors, []);
});

test('catalog validation rejects future schemas and duplicate IDs', () => {
  assert.ok(validateAppearanceCatalog({ schemaVersion: 99, skins: [], assets: [] }).errors.length);
  assert.ok(validateAppearanceCatalog({ skins: [skin(), skin()], assets: [] }).errors.length);
  const previous = { skins: [], assets: [{ ...asset(), status: 'Approved' }] };
  assert.ok(validateAppearanceCatalog({ skins: [], assets: [] }, { previous }).errors.length);
});

test('draft writes preserve approved records and global layout while allowing a separate draft', () => {
  const approved = { ...skin(), status: 'Approved', legacyPrivate: { preserve: true } };
  const previous = { schemaVersion: 1, skins: [approved], assets: [], gameDefaultLayout: { modeLayouts: {} } };
  const next = { ...structuredClone(previous), skins: [structuredClone(approved), { ...skin(), id: 'new-draft' }] };
  assert.deepEqual(validateAppearanceCatalog(next, { previous }).errors, []);
  next.skins[0].text = '#000000';
  assert.ok(validateAppearanceCatalog(next, { previous }).errors.some(item => /approved/i.test(item.message)));
  assert.ok(validateAppearanceCatalog({ ...previous, skins: [] }, { previous }).errors.length);
  assert.ok(validateAppearanceCatalog({ ...previous, gameDefaultLayout: null }, { previous }).errors.length);
});

test('public appearance projection omits versions, private notes and arbitrary metadata at every level', () => {
  const result = publicAppearanceSkin({ ...skin(), versions: [{ appearance: { secret: 'private' } }], source: 'private note', modeLayouts: { dial: { seatRadius: 0, callback: 'private' } }, tokens: { schemaVersion: 1, color: { text: '#ffffff', secret: 'private' } } });
  assert.equal(result.modeLayouts.dial.seatRadius, 0);
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.equal(result.tokens.color.text, '#ffffff');
});

test('contrast problems remain recoverable draft warnings and block publication with a specific correction', () => {
  const value = { ...skin(), text: '#161616' };
  assert.equal(validateAppearanceSkin(value).errors.length, 0);
  assert.ok(validateAppearanceSkin(value).warnings.some(item => /contrast/i.test(item.message) && item.fix));
  assert.ok(validateAppearanceSkin(value, { publish: true }).errors.some(item => /contrast/i.test(item.message)));
});

test('named visual variants and optional border disabled and button artwork stay allowlisted', () => {
  const value = { ...skin(), borderColor: '#c4b493', disabledColor: '#777777', variants: { dial: 'engraved', seal: 'medallion', counterMode: 'badge', navigation: 'framed', commander: 'quiet', panels: 'raised', numerals: 'tabular' }, buttonAsset: 'asset-button' };
  assert.deepEqual(validateAppearanceSkin(value, { assets: [{ ...asset(), id: 'asset-button', placement: 'button' }] }).errors, []);
  assert.ok(validateAppearanceSkin({ ...value, variants: { dial: 'javascript' } }).errors.length);
  assert.ok(validateAppearanceSkin({ ...value, borderColor: 'url(https://example.test)' }).errors.length);
  assert.ok(validateAppearanceSkin(value, { assets: [{ ...asset(), id: 'asset-button', placement: 'symbol' }] }).errors.length);
});

test('publication bounds newly authored geometry while preserving unchanged known legacy source geometry', () => {
  const legacy = { ...skin(), componentLayout: { counterReadout: { x: 60, y: 80, scale: 125 } } };
  assert.deepEqual(validateAppearanceSkin(legacy).errors, []);
  assert.ok(validateAppearanceSkin(legacy, { publish: true }).errors.length);
  assert.deepEqual(validateAppearanceSkin(legacy, { publish: true, sourceSkin: structuredClone(legacy) }).errors, []);
  assert.ok(validateAppearanceSkin({ ...legacy, componentLayout: { counterReadout: { x: 65, y: 80, scale: 125 } } }, { publish: true, sourceSkin: legacy }).errors.some(item => item.path.endsWith('.x')));
});

test('public projection drops malformed scalar objects and arrays without copying private content', () => {
  const result = publicAppearanceSkin({ ...skin(), background: { private: 'secret' }, fontWeight: ['secret'], name: null, buttonData: { private: 'secret' }, modeLayouts: { dial: { seatRadius: { private: 'secret' }, overlays: { dial: ['secret'] } } } });
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(Object.hasOwn(result, 'background'), false);
  assert.equal(Object.hasOwn(result.modeLayouts.dial, 'seatRadius'), false);
});

test('legacy inline asset metadata compares losslessly without requiring data in every draft payload', () => {
  const inline = { ...asset() }; delete inline.status;
  const previous = { skins: [], assets: [inline] };
  const { data, ...metadata } = inline;
  assert.deepEqual(validateAppearanceCatalog({ skins: [], assets: [metadata] }, { previous }).errors, []);
  assert.deepEqual(validateAppearanceCatalog({ skins: [], assets: [{ ...inline }] }, { previous }).errors, []);
  assert.ok(validateAppearanceCatalog({ skins: [], assets: [{ ...inline, data: png.replace('1HAwC', '2HAwC') }] }, { previous }).errors.length);
});

test('renderer versions are explicit and optional without stamping existing legacy appearances', () => {
  const legacy = skin();
  assert.equal(Object.hasOwn(publicAppearanceSkin(legacy), 'rendererVersion'), false);
  for (const rendererVersion of [1, 2]) {
    assert.deepEqual(validateAppearanceSkin({ ...legacy, rendererVersion }).errors, []);
    assert.equal(publicAppearanceSkin({ ...legacy, rendererVersion }).rendererVersion, rendererVersion);
    assert.deepEqual(validateAppearanceSkin({ ...legacy, rendererVersion, useGameBase: true }, { preview: true }).errors, []);
  }
  assert.ok(validateAppearanceSkin({ ...legacy, rendererVersion: 3 }).errors.length);
  assert.ok(validateAppearanceSkin({ ...legacy, rendererVersion: '2' }).errors.length);
});
