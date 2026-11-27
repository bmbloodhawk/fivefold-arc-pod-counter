import test from 'node:test';
import assert from 'node:assert/strict';
import { createRealtimeServer } from '../src/app.js';
import { AccountHistory, MemoryAccountHistoryStore } from '../src/account-history.js';
import { APPEARANCE_ACHIEVEMENTS } from '../src/appearance-milestones.js';
import { createStudioReleases } from '../src/studio-release-registry.js';
import { materializeAppearanceSkin } from '../src/appearance-artwork-payload.js';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
const colors = { background: '#080808', surface: '#161616', text: '#f4ecd9', muted: '#afa590', accent: '#d8ae61' };
const styled = id => ({ id, name: id, status: 'Approved', rendererVersion: 2, ...colors, surfaceArt: { turnBar: { assetId: 'panel-art', opacity: 20, callback: { private: true } } }, counterDesign: { modes: { life: { artAsset: 'dial-art', callback: { private: true } } } }, surfaceArtData: { turnBar: 'https://private.invalid/stale.png' }, counterArtData: { life: 'https://private.invalid/stale.png' }, versions: [{ private: true }], provenance: { private: true } });
async function fixture(t, options = {}) {
  const blobs = new Map(['panel-art', 'dial-art'].map((id, index) => [id, { id, name: id, source: 'Synthetic original art', placement: index ? 'dial' : 'panel', status: 'Approved', data: png }]));
  const catalog = { value: { revision: 0, skins: [styled('public-style')], assets: [...blobs.values()].map(({ data, ...asset }) => asset) }, async read() { return structuredClone(this.value); }, async write(value) { this.value = structuredClone(value); return this.value; }, async readAsset(id) { return blobs.get(id); }, async writeAsset(id, value) { blobs.set(id, value); }, async deleteAsset(id) { blobs.delete(id); } };
  const accountHistory = new AccountHistory({ store: new MemoryAccountHistoryStore() });
  const owner = await accountHistory.ensureAccount('owner');
  accountHistory.earnedSkinAwards = async account => account === owner ? { [APPEARANCE_ACHIEVEMENTS['field-notes'].id]: 'unlocked' } : {};
  const { server, service } = createRealtimeServer({ ...options, appearanceCatalog: catalog, feedbackPortalKey: 'fixture-key', accountHistory, accountVerifier: { async verify(token) { if (!['owner', 'locked'].includes(token)) throw Object.assign(new Error('Sign in'), { status: 401 }); return { providerSubject: token }; } }, appearanceSkins: [{ ...styled('field-notes'), visual: { schemaVersion: 1, treatment: 'grid', background: '#080808', surface: '#161616', accent: '#d8ae61', text: '#f4ecd9', muted: '#afa590', border: '#d8ae61' } }] });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const request = (path, { method = 'GET', body, token, connection, developer = false } = {}) => fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(connection ? { 'x-connection-id': connection } : {}), ...(developer ? { 'x-feedback-portal-key': 'fixture-key' } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { catalog, blobs, service, request };
}

test('public scoped artwork resolves approved roles and projects private nested data out of the DTO', async t => {
  const { request, catalog } = await fixture(t), before = structuredClone(catalog.value);
  const response = await request('/api/game-skins/public-style'); assert.equal(response.status, 200);
  const { skin } = await response.json();
  assert.equal(skin.surfaceArtData.turnBar, png); assert.equal(skin.counterArtData.life, png);
  assert.equal(JSON.stringify(skin).includes('private'), false);
  assert.deepEqual(catalog.value, before);
});
test('pending, wrong-role and missing blobs use native fallback without exposing stale hydrated images', async t => {
  const { request, catalog, blobs } = await fixture(t);
  catalog.value.assets[0].status = 'Pending';
  catalog.value.assets[1].placement = 'symbol';
  let skin = (await (await request('/api/game-skins/public-style')).json()).skin;
  assert.deepEqual([skin.surfaceArtData.turnBar, skin.counterArtData.life], ['', '']);
  catalog.value.assets[0].status = 'Approved'; blobs.delete('panel-art');
  skin = (await (await request('/api/game-skins/public-style')).json()).skin;
  assert.equal(skin.surfaceArtData.turnBar, ''); assert.equal(JSON.stringify(skin).includes('private.invalid'), false);
});
test('counter rings use protected library assets through a saved release, phone session and earned game skin', async t => {
  const registry = createStudioReleases({environment:'local'});
  const {request,catalog,blobs} = await fixture(t,{
    studioReleaseRegistry:registry, studioRewardSkins:registry.rewardSkins, studioReservedSkins:registry.reservedSkins,
  });
  const art = {id:'dial-ring',name:'Ring',source:'Original fixture art',placement:'overlay',status:'Approved',data:png};
  const {data,...metadata} = art;
  catalog.value.assets.push(metadata); blobs.set(art.id,art);
  const draft = {id:'skin-ring-study',name:'Ring study',status:'Draft',rendererVersion:2,...colors,
    sourceSkinId:'__neutral_arc__',rewardRule:{allOf:['account-awakened']},counterDesign:{modes:{life:{ringArtAsset:art.id},energy:{ringArtAsset:art.id}}}};
  const post = (path,body)=>request('/api/appearance-studio/'+path,{developer:true,method:'POST',body});
  const saved = await request('/api/appearance-studio/catalog',{developer:true,method:'PUT',
    body:{...catalog.value,skins:[...catalog.value.skins,draft]}});
  assert.equal(saved.status,200);
  assert.deepEqual(catalog.value.skins.at(-1).counterDesign,draft.counterDesign);
  const prepared = await post('releases/prepare',{id:draft.id,revision:catalog.value.revision});
  const release = await prepared.json();assert.equal(prepared.status,200,JSON.stringify(release.error));
  assert.deepEqual(release.body.assets.map(asset=>asset.id),[art.id]);
  assert.equal(release.body.skin.counterRingArtData,undefined);
  const play = await post('releases/playtest',{release});assert.equal(play.status,201);
  const {ticket} = await play.json();
  const dto = (await (await request('/api/studio-playtests/'+ticket)).json()).skin;
  assert.deepEqual(dto.counterRingArtData,{life:png,energy:png});
  assert.equal(dto.counterArtData,undefined);
  const phone = await post('phone-layout',{skin:{...dto,useGameBase:true}});
  const session = await phone.json();assert.equal(phone.status,201,JSON.stringify(session.error));
  assert.deepEqual((await (await request('/api/appearance-studio/phone-layout/'+session.id)).json()).skin.counterRingArtData,dto.counterRingArtData);
  assert.equal((await post('releases/activate',{release,lane:'staging',expected:null})).status,200);
  assert.deepEqual((await registry.reservedSkins())[0].reservedAssetIds,[art.id]);
  const detail = '/api/game-skins/'+draft.id;
  assert.equal((await request(detail)).status,404);
  assert.deepEqual((await (await request(detail,{token:'owner'})).json()).skin.counterRingArtData,dto.counterRingArtData);
  const stale = await materializeAppearanceSkin({...draft,counterRingArtData:{commander:png}}, {assets:[]});
  assert.deepEqual(stale.counterRingArtData,{life:'',energy:''});
});
test('owned and host-offered earned artwork hydrates only after existing account or seat authorization', async t => {
  const { request } = await fixture(t);
  assert.equal((await request('/api/game-skins/field-notes')).status, 404);
  assert.equal((await request('/api/game-skins/field-notes', { token: 'locked' })).status, 404);
  const owned = await request('/api/game-skins/field-notes', { token: 'owner' }); assert.equal(owned.status, 200);
  const ownerSkin = (await owned.json()).skin;
  assert.equal(ownerSkin.counterArtData.life, png); assert.equal(ownerSkin.surfaceArtData.turnBar, png);
  assert.equal(JSON.stringify(ownerSkin).includes('private'), false);
  const host = (await (await request('/api/connections', { method: 'POST', body: {} })).json()).connectionId;
  const guest = (await (await request('/api/connections', { method: 'POST', body: {} })).json()).connectionId;
  const created = await (await request('/api/rooms', { method: 'POST', body: { playerCount: 2, startingLife: 40 }, connection: host })).json();
  const code = created.snapshot.code;
  const claimed = await (await request(`/api/rooms/${code}/claim`, { method: 'POST', body: { seatId: 1 }, connection: guest })).json();
  assert.equal((await request(`/api/rooms/${code}/table-skin`, { method: 'POST', token: 'owner', connection: host, body: { baseVersion: claimed.snapshot.version, tableSkinId: 'field-notes' } })).status, 200);
  const shared = await request(`/api/rooms/${code}/table-skin`, { connection: guest }); assert.equal(shared.status, 200);
  assert.equal((await shared.json()).skin.surfaceArtData.turnBar, png);
  assert.equal((await request(`/api/rooms/${code}/table-skin`)).status, 401);
});
test('publication and deletion policies include current and saved-history scoped artwork references', async t => {
  const { request, catalog } = await fixture(t);
  catalog.value.skins = [{ ...styled('draft-style'), status: 'Draft', versions: [] }];
  delete catalog.value.skins[0].provenance; delete catalog.value.skins[0].surfaceArtData; delete catalog.value.skins[0].counterArtData;
  delete catalog.value.skins[0].surfaceArt.turnBar.callback; delete catalog.value.skins[0].counterDesign.modes.life.callback;
  catalog.value.assets[0].status = 'Pending';
  assert.equal((await request('/api/appearance-studio/skins/draft-style/publish', { method: 'POST', body: { revision: 0 }, developer: true })).status, 400);
  catalog.value.skins[0].surfaceArt = {};
  catalog.value.skins[0].versions = [{ id: 'old-art', label: 'Saved', appearance: { id: 'saved', surfaceArt: { turnBar: { assetId: 'panel-art' } } } }];
  assert.equal((await request('/api/appearance-studio/assets/panel-art', { method: 'DELETE', body: { revision: 0 }, developer: true })).status, 400);
});

test('a new public draft cannot reuse artwork reserved by configured earned packs', async t => {
  const { request, catalog } = await fixture(t);
  catalog.value.skins = [{ id: 'draft-style', name: 'Independent draft', status: 'Draft', rendererVersion: 2, ...colors, surfaceArt: { turnBar: { assetId: 'panel-art' } } }];
  const response = await request('/api/appearance-studio/skins/draft-style/publish', { method: 'POST', body: { revision: 0 }, developer: true });
  assert.equal(response.status, 400);
  assert.match(JSON.stringify(await response.json()), /restricted|achievement/i);
  assert.equal(catalog.value.skins[0].status, 'Draft');
});

test('independent approved scoped art publishes explicitly and exact previews validate every named nested field', async t => {
  const { request, catalog, blobs } = await fixture(t);
  const art = { id: 'independent-art', name: 'Independent study', source: 'Original fixture artwork', placement: 'panel', status: 'Approved', data: png };
  blobs.set(art.id, art); const { data, ...metadata } = art; catalog.value.assets.push(metadata);
  const draft = { id: 'independent-draft', name: 'Independent draft', status: 'Draft', rendererVersion: 2, ...colors, surfaceArt: { gameHeader: { assetId: art.id, fit: 'contain', scale: 100, positionX: 50, positionY: 50, opacity: 20 } } };
  const saved = await request('/api/appearance-studio/catalog', { method: 'PUT', body: { ...catalog.value, skins: [...catalog.value.skins, draft] }, developer: true });
  assert.equal(saved.status, 200);
  assert.equal((await request('/api/game-skins/independent-draft')).status, 404);
  const published = await request('/api/appearance-studio/skins/independent-draft/publish', { method: 'POST', body: { revision: catalog.value.revision }, developer: true });
  assert.equal(published.status, 200);
  assert.equal(catalog.value.skins.find(row => row.id === draft.id).status, 'Approved');
  const publicSkin = (await (await request('/api/game-skins/independent-draft')).json()).skin;
  assert.equal(publicSkin.surfaceArtData.gameHeader, png);
  const preview = { ...draft, surfaceArtData: { gameHeader: png }, useGameBase: true, previewState: 'dialog' };
  assert.equal((await request('/api/appearance-studio/phone-layout', { method: 'POST', body: { skin: preview }, developer: true })).status, 201);
  for (const surfaceArt of [{ arbitrarySelector: { assetId: art.id } }, { gameHeader: { assetId: art.id, opacity: 36 } }, { gameHeader: { assetId: art.id, selector: '#accountDialog' } }]) {
    assert.equal((await request('/api/appearance-studio/phone-layout', { method: 'POST', body: { skin: { ...preview, surfaceArt } }, developer: true })).status, 400);
  }
});
