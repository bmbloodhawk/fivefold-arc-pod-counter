import test from 'node:test';
import assert from 'node:assert/strict';
import { createRealtimeServer } from '../src/app.js';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
const draft = () => ({ id: 'studio-draft', name: 'Studio draft', status: 'Draft', background: '#080808', surface: '#161616', text: '#f4ecd9', accent: '#d8ae61' });
const approved = () => ({ ...draft(), id: 'existing-approved', status: 'Approved', versions: [{ id: 'v1', label: 'Private revision', savedAt: '2026-11-23', appearance: { id: 'private-source' } }], provenance: { note: 'private provenance' } });
const metadata = () => ({ id: 'asset-test', name: 'Original', source: 'My original art', placement: 'symbol', status: 'Pending' });
async function fixture(t, initial = { schemaVersion: 1, skins: [approved(), draft()], assets: [], selected: 'studio-draft', gameDefaultLayout: null }) {
  const assets = new Map();
  const catalog = { value: structuredClone(initial), async read() { return structuredClone(this.value); }, async write(value) { this.value = structuredClone(value); return this.value; }, async readAsset(id) { return assets.get(id); }, async writeAsset(id, value) { assets.set(id, structuredClone(value)); return value; }, async deleteAsset(id) { assets.delete(id); } };
  const { server } = createRealtimeServer({ feedbackPortalKey: 'studio-test-key', appearanceCatalog: catalog });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const request = (path, method = 'GET', body, authorized = true, extraHeaders = {}) => {
    if (method === 'DELETE' || (/\/(publish|approve)$/.test(path) && body)) body = { revision: catalog.value.revision ?? 0, ...body };
    return fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { 'content-type': 'application/json', ...(authorized ? { 'x-feedback-portal-key': 'studio-test-key' } : {}), ...extraHeaders }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  };
  return { catalog, assets, request };
}

test('ordinary catalog saves cannot mutate approval, approved appearance, or global layout', async t => {
  const { catalog, request } = await fixture(t), before = structuredClone(catalog.value);
  for (const change of [value => { value.skins[0].text = '#000000'; }, value => { value.skins[1].status = 'Approved'; }, value => { value.skins.shift(); }, value => { value.gameDefaultLayout = { modeLayouts: {} }; }, value => { value.schemaVersion = 99; }]) {
    const value = structuredClone(before); change(value);
    assert.equal((await request('/api/appearance-studio/catalog', 'PUT', value)).status, 400);
    assert.deepEqual(catalog.value, before);
  }
  const next = structuredClone(before); next.skins[1].name = 'New draft name';
  assert.equal((await request('/api/appearance-studio/catalog', 'PUT', next)).status, 200);
  assert.deepEqual(catalog.value.skins[0], before.skins[0]);
});

test('public skin detail projects appearance only and never sends revision or provenance metadata', async t => {
  const { request } = await fixture(t);
  const response = await request('/api/game-skins/existing-approved', 'GET', undefined, false);
  assert.equal(response.status, 200);
  const { skin } = await response.json();
  assert.equal(skin.id, 'existing-approved');
  assert.equal(JSON.stringify(skin).includes('private'), false);
  assert.equal(Object.hasOwn(skin, 'versions'), false);
});

test('publish is explicit, protected, validates stored draft, and preserves original approved skin', async t => {
  const { catalog, request } = await fixture(t), before = structuredClone(catalog.value.skins[0]);
  const path = '/api/appearance-studio/skins/studio-draft/publish';
  assert.equal((await request(path, 'POST', {}, false)).status, 403);
  const response = await request(path, 'POST', {});
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.skin.status, 'Approved');
  assert.deepEqual(result.catalog.skins[0], before);
  assert.deepEqual(catalog.value.skins[0], before);
});

test('a low contrast draft can be saved for recovery but cannot be published', async t => {
  const { catalog, request } = await fixture(t);
  const next = structuredClone(catalog.value); next.skins[1].text = next.skins[1].surface;
  assert.equal((await request('/api/appearance-studio/catalog', 'PUT', next)).status, 200);
  assert.equal((await request('/api/appearance-studio/skins/studio-draft/publish', 'POST', {})).status, 400);
  assert.equal(catalog.value.skins[1].status, 'Draft');
});

test('forks of invitation and achievement skins cannot become public catalog skins', async t => {
  for (const sourceSkinId of ['neutral', 'field-notes', 'skin-1789600182594']) {
    const initial = { skins: [{ ...draft(), sourceSkinId }], assets: [] };
    const { request, catalog } = await fixture(t, initial);
    assert.equal((await request('/api/appearance-studio/skins/studio-draft/publish', 'POST', {})).status, 400);
    assert.equal(catalog.value.skins[0].status, 'Draft');
  }
});

test('asset bytes require matching raster content, approval, and immutable IDs for approved artwork', async t => {
  const { catalog, request, assets } = await fixture(t);
  const path = '/api/appearance-studio/assets/asset-test';
  assert.equal((await request(path, 'PUT', { ...metadata(), data: 'data:image/png;base64,bm90LWFuLWltYWdl' })).status, 400);
  const uploaded = await request(path, 'PUT', { ...metadata(), data: png });
  assert.equal(uploaded.status, 200);
  const asset = (await uploaded.json()).asset;
  assert.deepEqual([asset.status, asset.mimeType, asset.width, asset.height], ['Pending', 'image/png', 1, 1]);
  const { data, ...row } = asset;
  const next = structuredClone(catalog.value); next.assets = [row]; next.skins[1].sealAsset = asset.id;
  assert.equal((await request('/api/appearance-studio/catalog', 'PUT', next)).status, 200);
  assert.equal((await request('/api/appearance-studio/skins/studio-draft/publish', 'POST', {})).status, 400);
  const approval = await request(`${path}/approve`, 'POST', {});
  assert.equal(approval.status, 200);
  assert.equal((await approval.json()).asset.status, 'Approved');
  assert.equal((await request(path, 'PUT', { ...metadata(), data: png, name: 'Overwritten' })).status, 400);
  assert.equal((await request('/api/appearance-studio/skins/studio-draft/publish', 'POST', {})).status, 200);
  assert.equal((await request(path, 'DELETE')).status, 400);
  assert.equal(assets.has('asset-test'), true);
});

test('catalog restore validates files and preserves approved rows and the game default', async t => {
  const { catalog, request } = await fixture(t), before = structuredClone(catalog.value);
  assert.equal((await request('/api/appearance-studio/catalog/restore', 'POST', { ...before, skins: [draft()] })).status, 400);
  assert.equal((await request('/api/appearance-studio/catalog/restore', 'POST', { ...before, schemaVersion: 99 })).status, 400);
  assert.deepEqual(catalog.value, before);
  assert.equal((await request('/api/appearance-studio/catalog/restore', 'POST', before)).status, 200);
});

test('preview sessions validate untrusted input without acquiring game or catalog authority', async t => {
  const { catalog, request } = await fixture(t), before = structuredClone(catalog.value);
  const base = '/api/appearance-studio/phone-layout';
  assert.equal((await request(base, 'POST', { skin: { callback: 'evil', life: 9999 } })).status, 400);
  const response = await request(base, 'POST', { skin: { ...draft(), useGameBase: true } });
  assert.equal(response.status, 201);
  const { id } = await response.json();
  assert.equal((await request(`${base}/${id}`, 'PUT', { skin: { ...draft(), modeLayouts: { dial: { componentLayout: { counterReadout: { x: 9999 } } } } } }, false)).status, 400);
  assert.deepEqual(catalog.value, before);
  assert.equal((await request(base, 'POST', { skin: { ...draft(), useGameBase: false } })).status, 400);
  const safe = await request(base, 'POST', { skin: { ...approved(), useGameBase: true } });
  assert.equal(JSON.stringify(await safe.json()).includes('private'), false);
});

test('Studio global layout endpoint cannot modify the normal game default', async t => {
  const { request, catalog } = await fixture(t);
  assert.equal((await request('/api/appearance-studio/game-layout', 'PUT', { layout: { modeLayouts: {} } })).status, 400);
  assert.equal(catalog.value.gameDefaultLayout, null);
});

test('asset deletion checks saved-version references and keeps catalog consistent when blob cleanup fails', async t => {
  const initial = { skins: [{ ...draft(), versions: [{ id: 'old', label: 'Saved', appearance: { ...draft(), sealAsset: 'asset-test' } }] }], assets: [metadata()] };
  const { catalog, assets, request } = await fixture(t, initial);
  assets.set('asset-test', { ...metadata(), data: png });
  assert.equal((await request('/api/appearance-studio/assets/asset-test', 'DELETE')).status, 400);
  catalog.value.skins[0].versions = [];
  catalog.deleteAsset = async () => { throw new Error('Storage unavailable'); };
  const response = await request('/api/appearance-studio/assets/asset-test', 'DELETE');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).cleanupPending, true);
  assert.deepEqual(catalog.value.assets, []);
  assert.equal(assets.has('asset-test'), true);
});

test('public skins resolve separate button and dial overlay assets without private metadata', async t => {
  const initial = { skins: [{ ...approved(), buttonAsset: 'button-test', variants: { dial: 'engraved' }, modeLayouts: { button: { overlays: {} }, dial: { overlays: { dial: 'asset-test' } } } }], assets: [{ ...metadata(), placement: 'dial', status: 'Approved' }, { ...metadata(), id: 'button-test', placement: 'button', status: 'Approved' }] };
  const { assets, request } = await fixture(t, initial);
  assets.set('asset-test', { ...metadata(), placement: 'dial', status: 'Approved', data: png });
  assets.set('button-test', { ...metadata(), id: 'button-test', placement: 'button', status: 'Approved', data: png });
  const response = await request('/api/game-skins/existing-approved');
  assert.equal(response.status, 200);
  const { skin } = await response.json();
  assert.equal(skin.modeLayouts.dial.overlayData.dial, png);
  assert.deepEqual(skin.modeLayouts.button.overlayData, {});
  assert.equal(skin.buttonData, png);
  assert.equal(skin.variants.dial, 'engraved');
  assert.equal(Object.hasOwn(skin, 'versions'), false);
});

test('pending asset IDs allow identical retries and refuse changed data or role', async t => {
  const { request, assets } = await fixture(t);
  const path = '/api/appearance-studio/assets/asset-test';
  const input = { ...metadata(), data: png };
  assert.equal((await request(path, 'PUT', input)).status, 200);
  assert.equal((await request(path, 'PUT', input)).status, 200);
  assert.equal((await request(path, 'PUT', { ...input, placement: 'background' })).status, 400);
  assert.equal(assets.get('asset-test').placement, 'symbol');
});

test('concurrent catalog tabs cannot lose unrelated drafts or approve stale appearance', async t => {
  const { catalog, request } = await fixture(t), first = structuredClone(catalog.value), stale = structuredClone(catalog.value);
  first.skins.push({ ...draft(), id: 'another-new-draft' });
  stale.skins[1].name = 'Stale edit';
  const write = catalog.write.bind(catalog);
  let beginWrite;
  const writing = new Promise(resolve => { beginWrite = resolve; });
  catalog.write = async value => { beginWrite(); await new Promise(resolve => setTimeout(resolve, 10)); return write(value); };
  const firstResponse = request('/api/appearance-studio/catalog', 'PUT', first);
  await writing;
  const results = await Promise.all([firstResponse, request('/api/appearance-studio/catalog', 'PUT', stale)]);
  assert.deepEqual(results.map(response => response.status).sort(), [200, 409]);
  assert.equal(catalog.value.revision, 1);
  assert.ok(catalog.value.skins.some(row => row.id === 'another-new-draft'));
  assert.equal((await request('/api/appearance-studio/skins/studio-draft/publish', 'POST', { revision: 0 })).status, 409);
  assert.equal(catalog.value.skins[1].status, 'Draft');
});

test('publication validates missing saved-history assets and returns an actionable input error', async t => {
  const initial = { skins: [{ ...draft(), versions: [{ id: 'old', label: 'Saved', appearance: { ...draft(), sealAsset: 'missing-history-image' } }] }], assets: [] };
  const { request, catalog } = await fixture(t, initial);
  const response = await request('/api/appearance-studio/skins/studio-draft/publish', 'POST', {});
  assert.equal(response.status, 400);
  assert.match(JSON.stringify(await response.json()), /missing|artwork/i);
  assert.equal(catalog.value.skins[0].status, 'Draft');
});

test('publication fails closed when source lineage is missing or artwork belongs to restricted skins', async t => {
  const absent = await fixture(t, { skins: [{ ...draft(), sourceSkinId: 'deleted-source' }], assets: [] });
  assert.equal((await absent.request('/api/appearance-studio/skins/studio-draft/publish', 'POST', {})).status, 400);
  const initial = { skins: [{ ...approved(), id: 'neutral', sealAsset: 'asset-test' }, { ...draft(), sealAsset: 'asset-test' }], assets: [{ ...metadata(), status: 'Approved' }] };
  const protectedArt = await fixture(t, initial);
  protectedArt.assets.set('asset-test', { ...metadata(), status: 'Approved', data: png });
  assert.equal((await protectedArt.request('/api/appearance-studio/skins/studio-draft/publish', 'POST', {})).status, 400);
});

test('preexisting missing legacy artwork does not prevent an unrelated draft save', async t => {
  const initial = { skins: [{ ...approved(), sealAsset: 'missing-legacy-image' }, draft()], assets: [] };
  const { request, catalog } = await fixture(t, initial);
  const next = structuredClone(catalog.value); next.skins[1].name = 'Recoverable draft';
  assert.equal((await request('/api/appearance-studio/catalog', 'PUT', next)).status, 200);
  assert.deepEqual(catalog.value.skins[0], initial.skins[0]);
});

test('phone QR preview links use direct HTTP locally and the forwarded HTTPS scheme behind a proxy', async t => {
  const { request } = await fixture(t);
  const session = await (await request('/api/appearance-studio/phone-layout', 'POST', { skin: { interfaceStyle: 'dial', useGameBase: true } })).json();
  const path = `/api/appearance-studio/phone-layout/${session.id}/qr`;
  assert.match((await (await request(path)).json()).url, /^http:\/\/127\.0\.0\.1:/);
  assert.match((await (await request(path, 'GET', undefined, true, { 'x-forwarded-proto': 'https, http' })).json()).url, /^https:\/\/127\.0\.0\.1:/);
  assert.match((await (await request(path, 'GET', undefined, true, { 'x-forwarded-proto': 'javascript' })).json()).url, /^http:\/\/127\.0\.0\.1:/);
});

test('protected catalog audience labels describe server policy without altering persisted rows', async t => {
  const initial = { skins: [approved(), draft(), { ...approved(), id: 'neutral' }, { ...approved(), id: 'field-notes' }, { ...draft(), id: 'restricted-draft', sourceSkinId: 'neutral' }], assets: [] };
  const { request, catalog } = await fixture(t, initial);
  assert.equal((await request('/api/appearance-studio/catalog', 'GET', undefined, false)).status, 403);
  const result = await (await request('/api/appearance-studio/catalog')).json();
  assert.deepEqual(result.audiences, { 'existing-approved': 'Available to select', 'studio-draft': 'Studio draft', neutral: 'Invitation', 'field-notes': 'Achievement', 'restricted-draft': 'Restricted source' });
  assert.deepEqual(catalog.value, initial);
  assert.equal(Object.hasOwn(result.catalog, 'audiences'), false);
});

test('public renderer version projection preserves legacy absence and retains explicit enhanced version', async t => {
  const initial = { skins: [approved(), { ...approved(), id: 'enhanced-approved', rendererVersion: 2 }, draft()], assets: [] };
  const { request, catalog } = await fixture(t, initial);
  const legacy = (await (await request('/api/game-skins/existing-approved')).json()).skin;
  assert.equal(Object.hasOwn(legacy, 'rendererVersion'), false);
  const enhanced = (await (await request('/api/game-skins/enhanced-approved')).json()).skin;
  assert.equal(enhanced.rendererVersion, 2);
  const invalid = structuredClone(catalog.value); invalid.skins[2].rendererVersion = 99;
  assert.equal((await request('/api/appearance-studio/catalog', 'PUT', invalid)).status, 400);
  assert.deepEqual(catalog.value, initial);
});

test('HTTP table offers accept published skins and reject draft or unavailable IDs without changing shared state', async t => {
  const { request } = await fixture(t);
  const host = (await (await request('/api/connections', 'POST', {})).json()).connectionId;
  const headers = { 'x-connection-id': host };
  const created = await request('/api/rooms', 'POST', { playerCount: 2, startingLife: 40, tableSkinId: 'existing-approved' }, true, headers);
  assert.equal(created.status, 201);
  const { snapshot: initial } = await created.json();
  for (const tableSkinId of ['studio-draft', 'missing-skin']) {
    const response = await request(`/api/rooms/${initial.code}/table-skin`, 'POST', { baseVersion: initial.version, tableSkinId }, true, headers);
    assert.equal(response.status, 400);
    const current = (await (await request(`/api/rooms/${initial.code}`)).json()).snapshot;
    assert.equal(current.config.tableSkinId, 'existing-approved');
    assert.equal(current.version, initial.version);
    const anotherHost = (await (await request('/api/connections', 'POST', {})).json()).connectionId;
    assert.equal((await request('/api/rooms', 'POST', { playerCount: 2, startingLife: 40, tableSkinId }, true, { 'x-connection-id': anotherHost })).status, 400);
  }
  assert.equal((await request(`/api/rooms/${initial.code}/table-skin`, 'POST', { baseVersion: initial.version, tableSkinId: 'staging-slate' }, true, headers)).status, 200);
});
