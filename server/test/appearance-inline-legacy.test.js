import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { AppearanceCatalog } from '../src/appearance-catalog.js';
import { createRealtimeServer } from '../src/app.js';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
const colors = { background: '#080808', surface: '#161616', text: '#f4ecd9', muted: '#afa590', accent: '#d8ae61' };
const fingerprint = value => createHash('sha256').update(value).digest('hex');

test('file-backed unversioned inline artwork survives hydration, metadata-only draft saves, publication and backup restore', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'fivefold-appearance-legacy-'));
  t.after(async () => {
    const target = resolve(directory), temporaryRoot = resolve(tmpdir());
    assert.ok(target.startsWith(temporaryRoot + sep) && basename(target).startsWith('fivefold-appearance-legacy-'));
    await rm(target, { recursive: true, force: true });
  });
  const path = join(directory, 'appearance-studio-catalog.json');
  const legacy = {
    skins: [{ id: 'neutral', name: 'Carl MTG', status: 'Approved', sealAsset: 'legacy-seal', ...colors }, { id: 'legacy-draft', name: 'Legacy draft', status: 'Draft', backgroundAsset: 'legacy-background', ...colors }],
    assets: [{ id: 'legacy-seal', name: 'Seal', source: 'Original fixture art', placement: 'symbol', data: png }, { id: 'legacy-background', name: 'Background', source: 'Original fixture art', placement: 'background', data: png }],
    selected: 'neutral',
  };
  await writeFile(path, JSON.stringify(legacy));
  const catalog = new AppearanceCatalog(path);
  const { server } = createRealtimeServer({ feedbackPortalKey: 'legacy-fixture-key', appearanceCatalog: catalog });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const request = (url, method = 'GET', body, authorized = true) => fetch(`http://127.0.0.1:${server.address().port}${url}`, { method, headers: { 'content-type': 'application/json', ...(authorized ? { 'x-feedback-portal-key': 'legacy-fixture-key' } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

  const loaded = (await (await request('/api/appearance-studio/catalog')).json()).catalog;
  assert.equal(loaded.selected, 'neutral');
  assert.deepEqual(loaded.assets, legacy.assets);
  assert.equal((await catalog.readAsset('legacy-seal')).data, png);
  assert.equal((await (await request('/api/appearance-studio/assets/legacy-seal')).json()).asset.data, png);
  assert.equal((await request('/api/game-skins/neutral', 'GET', undefined, false)).status, 404);
  assert.equal((await request('/api/game-skins/legacy-draft', 'GET', undefined, false)).status, 404);

  const candidate = structuredClone(loaded);
  candidate.selected = '__neutral_arc__';
  candidate.skins[1].name = 'Edited legacy draft';
  candidate.assets = candidate.assets.map(({ data, ...metadata }) => metadata);
  const savedResponse = await request('/api/appearance-studio/catalog', 'PUT', candidate);
  assert.equal(savedResponse.status, 200);
  let saved = (await savedResponse.json()).catalog;
  assert.equal(saved.selected, '__neutral_arc__');
  assert.deepEqual(saved.skins[0], legacy.skins[0]);
  assert.deepEqual(saved.assets, legacy.assets);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')).assets, legacy.assets);

  const backupPath = join(directory, 'backup.json');
  await writeFile(backupPath, JSON.stringify(saved));
  const restoredResponse = await request('/api/appearance-studio/catalog/restore', 'POST', JSON.parse(await readFile(backupPath, 'utf8')));
  assert.equal(restoredResponse.status, 200);
  saved = (await restoredResponse.json()).catalog;
  assert.deepEqual(saved.assets, legacy.assets);
  const fileBefore = fingerprint(await readFile(path));
  const altered = structuredClone(saved); altered.assets[0].data = png.replace('1HAwC', '2HAwC');
  assert.equal((await request('/api/appearance-studio/catalog/restore', 'POST', altered)).status, 400);
  assert.equal(fingerprint(await readFile(path)), fileBefore);

  const published = await request('/api/appearance-studio/skins/legacy-draft/publish', 'POST', { revision: saved.revision });
  assert.equal(published.status, 200);
  const detail = await request('/api/game-skins/legacy-draft', 'GET', undefined, false);
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).skin.backgroundData, png);
  assert.deepEqual((await catalog.read()).assets, legacy.assets);
  assert.deepEqual((await catalog.read()).skins[0], legacy.skins[0]);
});
