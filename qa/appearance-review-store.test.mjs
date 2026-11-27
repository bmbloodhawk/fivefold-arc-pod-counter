import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openAppearanceReviewStore } from './appearance-review-store.mjs';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
const seed = () => ({ schemaVersion: 1, revision: 0, selected: '__neutral_arc__', skins: [], assets: [], gameDefaultLayout: null });
const art = () => ({ id: 'saved-art', name: 'Saved original fixture', source: 'Synthetic local test', placement: 'background', status: 'Pending', data: png });
const location = async () => join(await mkdtemp(join(tmpdir(), 'appearance-review-store-')), 'review.json');
async function startFixture(path = '', extraEnv = {}) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./appearance-studio-local.mjs', import.meta.url)), '0'], { env: { ...process.env, STUDIO_REVIEW_STORE: path, STUDIO_DESIGN_REVIEW: '0', STUDIO_DESIGN_REVIEW_ART: '0', STUDIO_INHERITED_FIXTURE: '0', STUDIO_EXPANDED_FIXTURE: '0', STUDIO_GLOBAL_LAYOUT_FIXTURE: '0', STUDIO_COUNTER_DESIGN_FIXTURE: '0', ...extraEnv }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = '';
  child.stderr.on('data', value => { errors += value; });
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Disposable fixture startup timed out.')); }, 10000);
    let output = '';
    child.stdout.on('data', value => { output += value; const match = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(errors || 'Disposable fixture exited.')); });
  });
  const response = await fetch(origin + '/review'), html = await response.text();
  const key = JSON.parse(html.match(/setItem\("fivefold-arc:developer-key",("(?:[^"\\]|\\.)*")\)/)[1]);
  const request = (path, { method = 'GET', body, developer = false, oldKey } = {}) => fetch(origin + path, { method, headers: { 'content-type': 'application/json', ...(developer || oldKey ? { 'x-feedback-portal-key': oldKey || key } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { key, mode: response.headers.get('x-studio-fixture'), request, async stop(signal = 'SIGTERM') { if (child.exitCode !== null || child.signalCode !== null) return; const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(signal); await exited; } };
}

test('local review store seeds once and preserves catalog plus private raster bytes across restart', async () => {
  const path = await location(); let seeds = 0;
  let store = await openAppearanceReviewStore({ path, seed: () => { seeds++; return seed(); } });
  await store.writeAsset('saved-art', art(), { createOnly: true });
  const { data, ...metadata } = art();
  const catalog = { ...seed(), revision: 1, skins: [{ id: 'saved-draft', name: 'Saved draft', status: 'Draft', backgroundAsset: 'saved-art' }], assets: [metadata] };
  await store.write(catalog, { expectedRevision: 0 }); await store.close();
  store = await openAppearanceReviewStore({ path, seed: () => { throw new Error('An existing store must never reseed.'); } });
  assert.deepEqual(await store.read(), catalog); assert.equal((await store.readAsset('saved-art')).data, png); assert.equal(seeds, 1);
  const snapshot = JSON.parse(await readFile(path, 'utf8')); assert.equal(snapshot.schemaVersion, 1); assert.equal(snapshot.blobs[0].data, png);
  assert.equal(JSON.stringify(snapshot).includes('developer-key'), false);
  await store.close(); assert.deepEqual((await readdir(join(path, '..'))).filter(name => name.includes('.tmp-')), []);
});

test('a second writer is refused and closing releases only its own lock', async () => {
  const path = await location(), first = await openAppearanceReviewStore({ path, seed });
  await assert.rejects(openAppearanceReviewStore({ path, seed }), /already open|writer|lock/i);
  await first.close(); const second = await openAppearanceReviewStore({ path, seed }); await second.close();
});

test('simultaneous stale catalog writes cannot overwrite a completed snapshot', async () => {
  const path = await location(), store = await openAppearanceReviewStore({ path, seed });
  const results = await Promise.allSettled(['first', 'second'].map(id => store.write({ ...seed(), revision: 1, skins: [{ id, status: 'Draft' }] }, { expectedRevision: 0 })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.status, 409);
  assert.equal((await store.read()).skins[0].id, 'first'); await store.close();
  assert.equal(JSON.parse(await readFile(path, 'utf8')).catalog.skins[0].id, 'first');
});

test('corrupt or unrelated files refuse startup without reseeding or changing their bytes', async () => {
  for (const content of ['{broken', '{}', JSON.stringify({ schemaVersion: 2, catalog: seed(), blobs: [] }), JSON.stringify({ schemaVersion: 1, catalog: seed(), blobs: [{ id: 'bad', data: 'https://invalid.test/art' }] })]) {
    const path = await location(); await writeFile(path, content);
    await assert.rejects(openAppearanceReviewStore({ path, seed }), /review store|snapshot|corrupt|unsupported|asset/i);
    assert.equal(await readFile(path, 'utf8'), content);
  }
});

test('an interrupted temporary write does not replace the last complete snapshot and a dead writer lock is recoverable', async () => {
  const path = await location(), store = await openAppearanceReviewStore({ path, seed }); await store.close();
  const completed = await readFile(path, 'utf8');
  await writeFile(path + '.tmp-interrupted', '{partial');
  await writeFile(path + '.lock', JSON.stringify({ pid: 2147483647, token: 'dead-fixture-process' }));
  const restored = await openAppearanceReviewStore({ path, seed: () => { throw new Error('Do not reseed.'); } });
  assert.deepEqual(await restored.read(), seed()); assert.equal(await readFile(path, 'utf8'), completed); await restored.close();
});

test('private review files cannot be created under the public client directory', async () => {
  await assert.rejects(openAppearanceReviewStore({ path: fileURLToPath(new URL('../client/..private-review-test.json', import.meta.url)), seed }), /outside the public/i);
});

test('real local fixture saves and crash-restarts with private blob hydration and a rotated developer key', { timeout: 30000 }, async t => {
  const path = await location(); let fixture = await startFixture(path); t.after(() => fixture.stop());
  assert.equal(fixture.mode, 'file');
  await assert.rejects(startFixture(path), /already open|writer|lock/i);
  const upload = await fixture.request('/api/appearance-studio/assets/saved-art', { method: 'PUT', body: art(), developer: true }); assert.equal(upload.status, 200);
  const { data, ...metadata } = (await upload.json()).asset;
  const { catalog } = await (await fixture.request('/api/appearance-studio/catalog', { developer: true })).json();
  const draft = { id: 'persisted-study', name: 'Restarted review', status: 'Draft', rendererVersion: 2, backgroundAsset: 'saved-art', sourceSkinId: '__neutral_arc__' };
  const saved = await fixture.request('/api/appearance-studio/catalog', { method: 'PUT', developer: true, body: { ...catalog, revision: catalog.revision ?? 0, assets: [...catalog.assets, metadata], skins: [...catalog.skins, draft] } }); assert.equal(saved.status, 200);
  let current = (await saved.json()).catalog;
  const approved = await fixture.request('/api/appearance-studio/assets/saved-art/approve', { method: 'POST', developer: true, body: { revision: current.revision } }); assert.equal(approved.status, 200); current = (await approved.json()).catalog;
  const published = await fixture.request('/api/appearance-studio/skins/persisted-study/publish', { method: 'POST', developer: true, body: { revision: current.revision } }); assert.equal(published.status, 200);
  assert.equal((await (await fixture.request('/api/game-skins/persisted-study')).json()).skin.backgroundData, png);
  const oldKey = fixture.key; await fixture.stop('SIGKILL');
  // This combination would fail while creating the sample seed. Existing data
  // must remain authoritative without even invoking the seed/artwork loader.
  fixture = await startFixture(path, { STUDIO_DESIGN_REVIEW_ART: '1', STUDIO_DESIGN_REVIEW: '0' });
  assert.equal(fixture.mode, 'file'); assert.notEqual(fixture.key, oldKey);
  assert.equal((await fixture.request('/api/appearance-studio/catalog', { oldKey })).status, 403);
  const restored = await (await fixture.request('/api/appearance-studio/catalog', { developer: true })).json();
  assert.equal(restored.catalog.skins.find(row => row.id === draft.id).status, 'Approved'); assert.equal(restored.catalog.skins.length, catalog.skins.length + 1);
  assert.equal((await (await fixture.request('/api/appearance-studio/assets/saved-art', { developer: true })).json()).asset.data, png);
  assert.equal((await (await fixture.request('/api/game-skins/persisted-study')).json()).skin.backgroundData, png);
  const bytes = await readFile(path, 'utf8'); assert.equal(bytes.includes(oldKey), false); assert.equal(bytes.includes(fixture.key), false);
});

test('default automated fixtures keep the memory header and discard their samples on restart', { timeout: 30000 }, async t => {
  let fixture = await startFixture(); t.after(() => fixture.stop()); assert.equal(fixture.mode, 'memory');
  const { catalog } = await (await fixture.request('/api/appearance-studio/catalog', { developer: true })).json();
  const saved = await fixture.request('/api/appearance-studio/catalog', { method: 'PUT', developer: true, body: { ...catalog, revision: catalog.revision ?? 0, skins: [...catalog.skins, { id: 'temporary', status: 'Draft' }] } }); assert.equal(saved.status, 200);
  await fixture.stop(); fixture = await startFixture(); assert.equal(fixture.mode, 'memory');
  const restored = await (await fixture.request('/api/appearance-studio/catalog', { developer: true })).json(); assert.equal(restored.catalog.skins.some(row => row.id === 'temporary'), false);
});

test('Rose Window review artwork and a metadata-only author save survive a flag-free restart', { timeout: 30000 }, async t => {
  const path = await location(); let fixture = await startFixture(path, { STUDIO_DESIGN_REVIEW: '1', STUDIO_DESIGN_REVIEW_ART: '1' }); t.after(() => fixture.stop());
  const { catalog } = await (await fixture.request('/api/appearance-studio/catalog', { developer: true })).json();
  const originalPixels = catalog.assets.map(({ id, data }) => [id, data]); assert.equal(originalPixels.length, 2);
  const edited = { ...catalog, revision: catalog.revision ?? 0, selected: 'studio-example-rose-window', assets: catalog.assets.map(({ data, ...metadata }) => metadata), skins: catalog.skins.map(row => row.id === 'studio-example-rose-window' ? { ...row, name: 'Rose local edit' } : row) };
  assert.equal((await fixture.request('/api/appearance-studio/catalog', { method: 'PUT', developer: true, body: edited })).status, 200);
  await fixture.stop(); fixture = await startFixture(path);
  const restored = await (await fixture.request('/api/appearance-studio/catalog', { developer: true })).json();
  assert.equal(restored.catalog.skins.find(row => row.id === edited.selected).name, 'Rose local edit');
  assert.deepEqual(restored.catalog.assets.map(({ id, data }) => [id, data]), originalPixels);
  for (const [id, data] of originalPixels) assert.equal((await (await fixture.request('/api/appearance-studio/assets/' + id, { developer: true })).json()).asset.data, data);
});
