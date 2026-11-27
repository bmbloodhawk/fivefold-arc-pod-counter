import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const source = await readFile(new URL('./sw.js', import.meta.url), 'utf8');
const origin = 'https://counter.test/';
const currentName = source.match(/const CACHE = '([^']+)'/)[1];
const shell = [...source.match(/const APP_SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(match => new URL(match[1], origin).href);
const url = path => new URL(path, origin).href;

test('the offline shell includes the shared production appearance renderer and validator', () => {
  for (const path of ['./renderer-bridge.js?v=11','./commander-art-regions.js','./commander-region-renderer.js','./studio-reward-rule.js','./appearance-practice.js','./appearance-practice.css','./commander-glass-art.js','./appearance-validation.js','./renderer-theme.css?v=1']) assert.ok(shell.includes(url(path)), `${path} is available offline`);
});

function worker({ offline = false, quota = false, stores = new Map() } = {}) {
  const listeners = new Map();
  const requests = [];
  let unavailable = offline;
  let rejectWrites = quota;
  let denyStorage = false;
  let failedAsset = null;
  const key = request => typeof request === 'string' ? url(request) : request.url;
  const cache = entries => ({
    async keys() { return [...entries.keys()].map(value => new Request(value)); },
    async match(request) { return entries.get(key(request))?.clone(); },
    async put(request, response) {
      if (rejectWrites) throw new DOMException('Quota full', 'QuotaExceededError');
      entries.set(key(request), response.clone());
    },
    async delete(request) { return entries.delete(key(request)); },
    async addAll(paths) { for (const path of paths) await this.put(path, await network(path)); },
  });
  const caches = {
    async keys() { return [...stores.keys()]; },
    async open(name) { if (denyStorage) throw new DOMException('Storage blocked', 'SecurityError'); if (!stores.has(name)) stores.set(name, new Map()); return cache(stores.get(name)); },
    async delete(name) { return stores.delete(name); },
    async match(request) { for (const entries of stores.values()) { const hit = await cache(entries).match(request); if (hit) return hit; } },
  };
  async function network(request) {
    const target = key(request);
    requests.push(target);
    if (unavailable) throw new TypeError('Offline');
    const parsed = new URL(target);
    if (parsed.pathname === failedAsset) return new Response('not found', { status: 404 });
    if (parsed.pathname.endsWith('/status.png')) return new Response('error', { status: 500 });
    if (parsed.pathname.endsWith('/private.png')) return new Response('private', { headers: { 'Cache-Control': 'private, max-age=20' } });
    if (parsed.pathname.endsWith('/no-store.png')) return new Response('secret', { headers: { 'Cache-Control': 'no-store' } });
    if (parsed.pathname.endsWith('/large.png')) return new Response(new Uint8Array(4 * 1024 * 1024 + 1));
    if (parsed.pathname.endsWith('/redirect.png')) {
      const response = new Response('foreign body');
      Object.defineProperty(response, 'redirected', { value: true });
      Object.defineProperty(response, 'clone', { value: () => response });
      return response;
    }
    return new Response(`body ${parsed.pathname}`);
  }
  vm.runInNewContext(source, {
    self: { location: new URL(origin), registration: { scope: origin }, addEventListener: (name, listener) => listeners.set(name, listener) },
    caches, fetch: network, URL, Request, Response, AbortController, setTimeout, clearTimeout, console,
  });
  async function dispatch(type, request) {
    const pending = [];
    let response;
    listeners.get(type)?.({ request, waitUntil: promise => pending.push(promise), respondWith: promise => { response = promise; } });
    const value = response ? await response : undefined;
    await Promise.all(pending);
    return value;
  }
  async function seed(name, entries) {
    const target = await caches.open(name);
    for (const [path, body] of Object.entries(entries)) await target.put(path, new Response(body));
  }
  return {
    stores, caches, requests, dispatch, seed,
    offline(value) { unavailable = value; }, quota(value) { rejectWrites = value; },
    storageDenied(value) { denyStorage = value; }, failAsset(path) { failedAsset = path; },
    get(path, options) { return dispatch('fetch', new Request(url(path), options)); },
  };
}

test('Built-in dial and tab symbols are all present in the offline shell', async () => {
  const css = await readFile(new URL('./dial-layout.css', import.meta.url), 'utf8');
  const paths = new Set([...css.matchAll(/url\(["']?(icons\/(?:neutral-(?:counter|tab)|tabs)-[a-z]+\.svg)["']?\)/g)].map(match => match[1]));
  const modes = ['life', 'commander', 'radiation', 'poison', 'energy', 'generic'];
  const expected = modes.flatMap(mode => [`icons/neutral-counter-${mode}.svg`, `icons/neutral-tab-${mode}.svg`]);
  expected.push(...['ink','circuit','glass'].map(set => `icons/tabs-${set}.svg`));
  assert.deepEqual(paths, new Set(expected));
  for (const path of paths) {
    assert.ok(shell.includes(url(path)), `missing offline symbol: ${path}`);
    assert.match(await readFile(new URL(path, import.meta.url), 'utf8'), /<svg\b/);
  }
});

test('waiting installs create no build caches, including repeated replacements', async () => {
  const w = worker();
  for (let n = 0; n < 10; n++) await w.dispatch('install');
  assert.deepEqual(await w.caches.keys(), []);
  assert.equal(w.requests.length, 0);
  assert.doesNotMatch(source, /skipWaiting\(|clients\.claim\(/);
});

test('activation pins the complete current local module graph and essential HTML assets', async () => {
  const seen = new Set();
  async function imports(specifier) {
    if (seen.has(specifier)) return;
    seen.add(specifier);
    assert.ok(shell.includes(url(specifier)), `missing offline module: ${specifier}`);
    const file = new URL(specifier, new URL('./', import.meta.url));
    file.search = '';
    const js = await readFile(file, 'utf8');
    for (const match of js.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"]([^'"]+)['"]/g)) {
      if (match[1].startsWith('.')) await imports(new URL(match[1], url(specifier)).href.slice(origin.length));
    }
  }
  const index = await readFile(new URL('./index.html', import.meta.url), 'utf8');
  for (const match of index.matchAll(/<(?:script|link|img)\b[^>]*(?:src|href)="([^"#]+)"/g)) {
    if (/^(?:https?:|data:)/.test(match[1])) continue;
    assert.ok(shell.includes(url(match[1])), `missing initial HTML asset: ${match[1]}`);
    if (/\.m?js(?:\?|$)/.test(match[1]) && !match[1].startsWith('vendor/')) await imports(match[1]);
  }
  const w = worker();
  await w.seed('unrelated-data', { '/other': 'keep' });
  await w.seed('fivefold-arc-v100', { '/obsolete': 'old' });
  await w.dispatch('activate');
  assert.ok(w.stores.has('unrelated-data'));
  assert.ok(!w.stores.has('fivefold-arc-v100'));
  for (const pin of shell) assert.ok(await (await w.caches.open(currentName)).match(pin), pin);
});

test('offline activation retains the complete older active graph instead of newer incomplete waiting precaches', async () => {
  const w = worker();
  const old = { '/index.html': '<script type="module" src="app.js?v=old"></script>', '/app.js?v=old': "import './connection-state.js?v=old';", '/connection-state.js?v=old': 'export const connected = true;' };
  await w.seed('fivefold-arc-v100', old);
  await w.seed('fivefold-arc-v101', { '/index.html': old['/index.html'], '/app.js?v=old': old['/app.js?v=old'] });
  await w.seed('unrelated-data', { '/other': 'keep' });
  w.offline(true);
  await w.dispatch('activate');
  assert.deepEqual((await w.caches.keys()).sort(), ['fivefold-arc-v100', 'unrelated-data']);
  assert.equal(await (await w.get('/index.html')).text(), old['/index.html']);
  assert.equal(await (await w.get('/app.js?v=old')).text(), old['/app.js?v=old']);
  assert.equal(await (await w.get('/connection-state.js?v=old')).text(), old['/connection-state.js?v=old']);
});

test('missing decorative art does not disqualify a complete older boot graph', async () => {
  const w = worker();
  await w.seed('fivefold-arc-v100', { '/index.html': '<link rel="icon" href="icons/missing.svg"><link rel="manifest" href="manifest.webmanifest"><img src="assets/optional.png"><script type="module" src="app.js?v=old"></script>', '/app.js?v=old': 'window.oldApp = true;' });
  w.offline(true);
  await w.dispatch('activate');
  assert.deepEqual(await w.caches.keys(), ['fivefold-arc-v100']);
  assert.match(await (await w.get('/index.html')).text(), /app\.js\?v=old/);
});

test('runtime writes keep at most eight extra static entries under concurrent requests, preserving pinned HTML', async () => {
  const w = worker();
  await w.dispatch('activate');
  const target = await w.caches.open(currentName);
  const original = await (await target.match('/index.html')).text();
  await Promise.all(Array.from({ length: 20 }, (_, n) => w.get(`/assets/runtime-${n}.png`)));
  const extra = (await target.keys()).filter(request => request.url.includes('/assets/runtime-'));
  assert.equal(extra.length, 8);
  await w.get('/index.html');
  assert.equal(await (await target.match('/index.html')).text(), original);
});

test('runtime ignores query variants, API, non-public/error responses, no-store requests and oversized bodies', async () => {
  const w = worker();
  await w.dispatch('activate');
  for (const path of ['/assets/a.png?v=1', '/api/room', '/api', '/health', '/random.html', '/assets/status.png', '/assets/private.png', '/assets/no-store.png', '/assets/large.png', '/assets/redirect.png', '/appearance-collection.enc']) await w.get(path);
  await w.get('/assets/request-secret.png', { cache: 'no-store' });
  await w.get('/assets/header-secret.png', { headers: { 'Cache-Control': 'no-store' } });
  await w.get('/assets/account.png', { headers: { Authorization: 'test-only' } });
  const target = await w.caches.open(currentName);
  for (const request of await target.keys()) assert.ok(shell.includes(request.url) || request.url.includes('__offline-shell-complete__'), `unexpected cache entry: ${request.url}`);
});

test('offline invite navigation uses common HTML while preserving exact module versions', async () => {
  const w = worker();
  await w.dispatch('activate');
  w.offline(true);
  const request = new Request(url('/?join=INVITE'));
  Object.defineProperty(request, 'mode', { value: 'navigate' });
  const response = await w.dispatch('fetch', request);
  assert.equal(await response.text(), 'body /index.html');
  const missing = await w.get('/app.js?v=unavailable');
  assert.equal(missing.type, 'error');
  assert.equal(request.url, url('/?join=INVITE'));
});

test('failed precaching discards partial new HTML and keeps the earlier complete graph', async () => {
  const w = worker();
  await w.seed('fivefold-arc-v100', {
    '/index.html': '<script type="module" src="app.js?v=old"></script>',
    '/app.js?v=old': 'window.oldApp = true;',
    '/assets/old.png?variant=100': 'remove legacy excess',
  });
  w.quota(true);
  await w.dispatch('activate');
  assert.ok(!w.stores.has(currentName));
  assert.ok(w.stores.has('fivefold-arc-v100'));
  const previous = await w.caches.open('fivefold-arc-v100');
  assert.equal(await previous.match('/assets/old.png?variant=100'), undefined);
  w.offline(true);
  const index = await w.get('/index.html');
  assert.match(await index.text(), /app\.js\?v=old/);
});

test('quota and cache errors do not break successful network responses or later caching', async () => {
  const w = worker();
  await w.dispatch('activate');
  w.quota(true);
  const response = await w.get('/assets/quota.png');
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'body /assets/quota.png');
  w.quota(false);
  await w.get('/assets/recovered.png');
  assert.ok(await (await w.caches.open(currentName)).match('/assets/recovered.png'));
  w.storageDenied(true);
  assert.equal((await w.get('/assets/storage-denied.png')).status, 200);
});

test('one missing pinned asset retains the complete older graph and discards partial replacement', async () => {
  const w = worker();
  await w.seed('fivefold-arc-v100', { '/index.html': '<script type="module" src="app.js?v=old"></script>', '/app.js?v=old': 'window.oldApp = true;' });
  w.failAsset('/connection-state.js');
  await w.dispatch('activate');
  assert.deepEqual(await w.caches.keys(), ['fivefold-arc-v100']);
  w.offline(true);
  assert.match(await (await w.get('/index.html')).text(), /app\.js\?v=old/);
});

test('a restarted worker rediscovers its complete shell without network or a new cache', async () => {
  const first = worker();
  await first.dispatch('activate');
  const restarted = worker({ offline: true, stores: first.stores });
  assert.equal((await restarted.get('/index.html')).status, 200);
  assert.equal((await restarted.get('/connection-state.js?v=1')).status, 200);
  assert.deepEqual(await restarted.caches.keys(), [currentName]);
});
