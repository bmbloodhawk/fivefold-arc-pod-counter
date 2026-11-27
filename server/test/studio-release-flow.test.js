import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSkinRelease, checkedRelease } from '../src/studio-release-package.js';
import { createHostedStudioReleases, createStudioReleases } from '../src/studio-release-registry.js';
import { createRealtimeServer } from '../src/app.js';
import { AccountHistory, MemoryAccountHistoryStore } from '../src/account-history.js';

const draft = {
  id: 'skin-release-fixture',
  name: 'Fixture cabinet',
  status: 'Draft',
  sourceSkinId: '__neutral_arc__',
  rendererVersion: 2,
  background: '#091719',
  surface: '#142325',
  text: '#fffbed',
  muted: '#dfd4c1',
  accent: '#edce83',
  rewardRule: { allOf: ['first-crown', 'trusted-blade'] },
};
const catalog = { revision: 1, skins: [draft], assets: [] };
const build = (changes = {}) => buildSkinRelease({ ...draft, ...changes }, catalog, async () => null, []);
test('a hosted release requires durable storage and player redemption while inspection and ordinary game routes stay available', async (t) => {
  const release = await build();
  const documents = new Map();
  const ledger = {
    accessToken: async () => {
      throw new Error('Unexpected credential request');
    },
    read: async (key) => documents.get(key) ?? null,
    write: async (key, value) => documents.set(key, value),
    update: async (key, change) => documents.set(key, change(documents.get(key) ?? null)),
  };
  const setup = {
    environment: 'staging',
    ledger,
    accountHistory: { studioSkinChoices() {} },
    accountVerifier: { verify() {} },
    fetchImpl: async () => {
      throw new Error('Unexpected network request');
    },
  };
  const ready = createHostedStudioReleases(setup);
  await ready.activate('staging', release, null);
  assert.equal((await ready.status(draft.id)).writeUnavailable, undefined);
  const before = [...documents];
  for (const missing of [{ accountVerifier: null }, { accountHistory: null }]) {
    const service = createHostedStudioReleases({ ...setup, ...missing });
    const status = await service.status(draft.id);
    assert.equal(status.lanes.staging[0].digest, release.digest);
    assert.match(status.writeUnavailable, /player sign-in/);
    assert.equal((await service.version('staging', release.digest)).digest, release.digest);
    assert.equal((await service.proof('staging', draft.id, release.digest)).verified, false);
    await assert.rejects(service.activate('staging', release, null), { status: 503 });
    await assert.rejects(service.withdraw('staging', draft.id, release.digest), { status: 503 });
  }
  assert.deepEqual([...documents], before);
  const service = createHostedStudioReleases({ ...setup, environment: 'public', ledger: null });
  const { server } = createRealtimeServer({
    studioReleaseRegistry: service,
    studioReservedSkins: service.reservedSkins,
    studioRewardSkins: service.rewardSkins,
    appearanceCatalog: { read: async () => catalog, readAsset: async () => null },
    feedbackPortalKey: 'fixture',
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const origin = 'http://127.0.0.1:' + server.address().port;
  const call = (path, body) =>
    fetch(origin + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', 'x-feedback-portal-key': 'fixture' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const base = '/api/appearance-studio/releases/';
  assert.equal((await call('/health')).status, 200);
  assert.ok((await (await call('/api/game-skins')).json()).skins.length);
  assert.match(
    (await (await call(base + 'status?skin=' + draft.id)).json()).writeUnavailable,
    /durable storage/
  );
  assert.equal((await call(base + 'inspect', { release })).status, 200);
  assert.equal((await call(base + 'render-check', { release })).status, 200);
  assert.equal((await call(base + 'activate', { release, lane: 'public', expected: null })).status, 503);
  assert.equal(
    (await call(base + 'withdraw', { id: draft.id, lane: 'public', expected: release.digest })).status,
    503
  );
  assert.deepEqual((await service.status(draft.id)).lanes.public, []);
});
test('portable releases bind every setting and rule and recover safely across a restart or simultaneous activation', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'arc-skin-release-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const options = { environment: 'local', directory };
  const service = createStudioReleases(options);
  const base = await build(),
    updated = await build({ name: 'Second version' }),
    other = await build({ name: 'Third version' });
  assert.equal(base.body.skin.rewardRule, undefined);
  assert.throws(() =>
    checkedRelease({ ...base, body: { ...base.body, skin: { ...base.body.skin, name: 'edited' } } })
  );
  await assert.rejects(service.activate('public', base, null), /Stage and check/);
  await service.activate('staging', base, null);
  await service.activate('public', base, null);
  const race = await Promise.allSettled(
    [updated, other].map((v) => service.activate('staging', v, base.digest))
  );
  assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
  const current = (await service.status(draft.id)).lanes.staging[0];
  assert.equal((await service.rewardSkins())[0].rewardHistory.length, 1);
  const restarted = createStudioReleases(options);
  assert.equal((await restarted.status(draft.id)).lanes.staging[0].digest, current.digest);
  assert.equal((await restarted.version('public', base.digest)).digest, base.digest);
  await restarted.activate('staging', base, current.digest);
  assert.equal((await restarted.status(draft.id)).lanes.staging.length, 3);
  assert.equal((await (await restarted.rewardSkins())[0].loadSkin()).name, draft.name);
});
test('public activation checks the real staging proof for this skin and digest', async () => {
  const release = await build();
  let matches = false;
  const service = createStudioReleases({
    environment: 'public',
    fetchImpl: async (url, opts) => {
      assert.equal(url.hostname, 'fivefold-arc-pod-counter-staging.onrender.com');
      assert.equal(opts.redirect, 'error');
      return Response.json({ id: draft.id, digest: matches ? release.digest : '0'.repeat(64), verified: true });
    },
  });
  await assert.rejects(service.activate('staging', release, null));
  await assert.rejects(service.activate('public', release, null), /Stage and check/);
  matches = true;
  assert.equal((await service.activate('public', release, null)).verified, true);
});
test('single-skin HTTP rehearsal checks accounts, scopes the phone ticket, and keeps preparation and history private', async (t) => {
  const registry = createStudioReleases({ environment: 'local' });
  const { server } = createRealtimeServer({
    studioReleaseRegistry: registry,
    feedbackPortalKey: 'fixture',
    appearanceCatalog: { read: async () => catalog, readAsset: async () => null },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const origin = 'http://127.0.0.1:' + server.address().port;
  const call = (path, body, authorized = true) =>
    fetch(origin + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        'content-type': 'application/json',
        ...(authorized ? { 'x-feedback-portal-key': 'fixture' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const url = '/api/appearance-studio/releases/';
  assert.equal((await call(url + 'prepare', { id: draft.id, revision: 1 }, false)).status, 403);
  assert.equal((await call(url + 'prepare', { id: draft.id, revision: 0 })).status, 409);
  const prepared = await call(url + 'prepare', { id: draft.id, revision: 1 });
  assert.equal(prepared.status, 200);
  const release = await prepared.json();
  const checks = await call(url + 'render-check', { release });
  assert.equal(checks.status, 200);
  assert.equal((await checks.json()).accounts.length, 4);
  const start = await call(url + 'playtest', { release });
  assert.equal(start.status, 201);
  const ticket = await start.json();
  assert.ok(ticket.qr.startsWith('data:image/png;base64,'));
  const path = '/api/studio-playtests/' + ticket.ticket;
  assert.equal((await (await call(path, null, false)).json()).skin.id, draft.id);
  assert.deepEqual(await (await call(path + '/status', null, false)).json(), { expiresAt: ticket.expiresAt });
  assert.equal((await call(url + 'activate', { lane: 'staging', expected: null, release })).status, 200);
  assert.equal((await call(url + 'version/staging/' + release.digest, null, false)).status, 403);
  assert.equal(
    (await call('/api/skin-release-proof/' + draft.id + '/' + release.digest, null, false)).status,
    404
  );
  assert.equal((await call(url + 'stop-playtest', { ticket: ticket.ticket })).status, 200);
  assert.equal((await call(path, null, false)).status, 404);
  assert.equal((await call(path + '/status', null, false)).status, 404);
});
test('a withdrawal removes active access and proof while retaining reservations and earlier earning windows', async () => {
  let clock = 1000;
  const registry = createStudioReleases({ environment: 'local', now: () => clock++ });
  const first = await build(),
    revised = await build({ rewardRule: { allOf: ['table-regular'] } });
  await registry.activate('staging', first, null);
  await assert.rejects(registry.withdraw('staging', draft.id, revised.digest), /changed/);
  await registry.withdraw('staging', draft.id, first.digest);
  await registry.withdraw('staging', draft.id, first.digest);
  assert.deepEqual(await registry.rewardSkins(), []);
  assert.equal((await registry.proof('staging', draft.id, first.digest)).verified, false);
  assert.ok((await registry.reservedSkins()).some((row) => row.id === draft.id));
  await registry.activate('staging', revised, null);
  const [active] = await registry.rewardSkins();
  assert.deepEqual(active.rewardRule, revised.body.rewardRule);
  assert.deepEqual(active.rewardHistory, [
    { rewardRule: first.body.rewardRule, activatedAt: 1000, retiredAt: 1002 },
  ]);
});

test('a release packages the selected draft without images that appear only in edit history', async () => {
  const historical = { id: 'older-version', appearance: { ...draft, backgroundAsset: 'retired-cabinet' } };
  const envelope = await build({ versions: [historical] });
  assert.deepEqual(envelope.body.assets, []);
  assert.equal(envelope.body.skin.versions, undefined);
});

test('simultaneous releases cannot reserve one piece of premium artwork for two skins', async () => {
  const art = {
    id: 'independent-panel',
    name: 'Original panel',
    source: 'Original test illustration',
    status: 'Approved',
    placement: 'panel',
    data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
  };
  const make = (id) => {
    const skin = { ...draft, id, surfaceArt: { gameHeader: { assetId: art.id, opacity: 20 } } };
    return buildSkinRelease(skin, { ...catalog, skins: [skin], assets: [art] }, async () => art, []);
  };
  const registry = createStudioReleases({ environment: 'local' });
  const releases = await Promise.all(['skin-first', 'skin-second'].map(make));
  const results = await Promise.allSettled(
    releases.map((release) => registry.activate('staging', release, null))
  );
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.match(results.find((result) => result.status === 'rejected').reason.message, /reserved this artwork/);
  assert.equal((await registry.rewardSkins()).length, 1);
});

test('an unavailable Studio release index preserves existing rewards, account access and starter tables', async t => {
  const store = new MemoryAccountHistoryStore();
  const accountHistory = new AccountHistory({store});
  const owner = await accountHistory.ensureAccount('previous-owner');
  await store.update('account-history/accounts/' + owner + '.json', row => ({
    ...row, longTermAchievementIds: ['appearance-field-notes'],
  }));
  const field = {id: 'field-notes', name: 'Field Notes'};
  const uncertain = {id: 'catalog-art', name: 'Unverified artwork', status: 'Approved'};
  const offline = async () => { throw new Error('Release index unavailable'); };
  const {server, service} = createRealtimeServer({
    appearanceSkins: [field], accountHistory,
    accountVerifier: {verify: async subject => ({providerSubject: subject})},
    studioRewardSkins: offline, studioReservedSkins: offline,
    appearanceCatalog: {read: async () => ({skins: [uncertain], assets: []})},
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  const host = service.createConnection().connectionId;
  const request = (path, method = 'GET', data, signedIn = true) => fetch(origin + path, {
    method, headers: {'content-type': 'application/json', 'x-connection-id': host,
      ...(signedIn && {authorization: 'Bearer previous-owner'})}, body: JSON.stringify(data),
  });
  const list = await (await request('/api/game-skins')).json();
  assert.deepEqual(list.skins.map(skin => skin.id).sort(), ['staging-ember', 'staging-slate']);
  assert.equal((await request('/api/game-skins/catalog-art')).status, 404);
  assert.equal((await request('/api/account/history')).status, 200);
  const preferences = await (await request('/api/account/preferences')).json();
  assert.ok(preferences.skins.find(skin => skin.id === field.id && skin.state !== 'locked'));
  assert.equal((await request('/api/game-skins/field-notes', 'GET', undefined, false)).status, 404);
  for (const id of ['field-notes', 'staging-slate']) {
    assert.equal((await request('/api/game-skins/' + id)).status, 200);
    assert.equal((await request('/api/account/preferences', 'PUT', {personalSkinId: id, usePersonalSkin: true})).status, 200);
  }
  const room = await request('/api/rooms', 'POST', {playerCount: 2, startingLife: 40, tableSkinId: field.id});
  assert.equal(room.status, 201);
  const {snapshot} = await room.json();
  const shared = await request('/api/rooms/' + snapshot.code + '/table-skin');
  assert.equal((await shared.json()).skin.id, field.id);
});
