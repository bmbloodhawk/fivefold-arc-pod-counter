const CACHE = 'fivefold-arc-v403';
const APP_SHELL = ['./index.html', './privacy.html', './terms.html', './styles.css?v=254', './app.js?v=335', './dial-layout.css?v=10', './dial-layout.js?v=7', './dial-side-zones.js?v=2', './dial-touch-guard.js?v=1', './appearance-catch-up.js?v=2', './competition.css?v=4', './competition-ui.js?v=10', './tournament-table-flow.mjs?v=1', './tournament-refresh.mjs?v=2', './tournament-spectator.mjs?v=2', './pod-invite-qr.mjs?v=1', './competition-model.mjs?v=2', './collection-visual.css?v=6', './collection-visual.js?v=4', './join-qr-scanner.js?v=5', './game-wake-lock.js?v=1', './account-auth.js?v=7', './create-account.js?v=1', './vendor/jsqr.js?v=1', './commander-source-flow.js?v=1', './card-interaction-advice.js?v=1', './realtime.js?v=95', './next-game-starter.js?v=1', './elimination-undo.js?v=1', './local-elimination-undo.js?v=1', './table-device-id.js?v=1', './life-adjustment-batcher.js?v=74', './connection-state.js?v=1', './dice-roll-3d.js?v=114', './vendor/three/three.module.js', './vendor/three/three.core.js', './vendor/rapier/rapier.mjs', './staging-appearance-review.js?v=3', './manifest.webmanifest', './icons/arc-mark.svg', './assets/victory-seal-v1.png', './assets/elimination-skull-v1.png', './assets/elimination-skull-poison-v1.png', './assets/elimination-skull-commander-v1.png'];

const SCOPE = self.registration.scope;
const SHELL_URLS = new Set(APP_SHELL.map(path => new URL(path, SCOPE).href));
const COMPLETE = new URL('./__offline-shell-complete__', SCOPE).href;
const MAX_RUNTIME_ENTRIES = 8;
const MAX_ENTRY_BYTES = 4 * 1024 * 1024;
const OWNED_CACHE = /^fivefold-arc-v\d+$/;
let selectedCache;
let writes = Promise.resolve();

// Waiting (including replaced waiting) workers allocate no caches. Let the browser
// activate normally after existing games close; never take over an active client.
self.addEventListener('activate', event => event.waitUntil(activate()));

function publicResponse(response) {
  return response.status === 200 && !response.redirected && (!response.url || new URL(response.url).origin === self.location.origin)
    && !/\b(?:no-store|private)\b/i.test(response.headers.get('Cache-Control') || '');
}

async function boundedResponse(response) {
  if (!publicResponse(response)) return false;
  if (Number(response.headers.get('Content-Length')) > MAX_ENTRY_BYTES) return false;
  const reader = response.clone().body?.getReader();
  if (!reader) return true;
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return true;
      size += value.byteLength;
      if (size > MAX_ENTRY_BYTES) { reader.cancel().catch(() => {}); return false; }
    }
  } finally { reader.releaseLock(); }
}

function runtimeAsset(url) {
  return !url.search && /\/(?:assets|icons)\/[^?]+\.(?:png|jpe?g|webp|svg|avif|gif|woff2?)$/i.test(url.pathname);
}

// Old waiting precaches omitted imported modules. Validate the cached HTML/import
// graph before choosing the one previous cache retained for offline activation.
async function legacyShell(cache) {
  const indexURL = new URL('./index.html', SCOPE).href;
  const index = await cache.match(indexURL);
  if (!index || !publicResponse(index)) return null;
  const keep = new Set([indexURL]);
  const html = await index.text();
  const modules = [];
  for (const match of html.matchAll(/<(script|link|img)\b[^>]*(?:src|href)=["']([^"'#]+)["']/g)) {
    const url = new URL(match[2], indexURL);
    if (url.origin !== self.location.origin) continue;
    const response = await cache.match(url.href);
    if (!response || !publicResponse(response)) {
      const required = match[1] === 'script' || (match[1] === 'link' && /\brel=["']stylesheet["']/i.test(match[0]));
      if (required) return null;
      continue;
    }
    keep.add(url.href);
    if (/\.m?js$/.test(url.pathname)) modules.push(url.href);
  }
  if (!modules.length) return null;
  for (let i = 0; i < modules.length; i++) {
    const moduleURL = modules[i];
    const response = await cache.match(moduleURL);
    if (!response || !publicResponse(response)) return null;
    const source = await response.text();
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*(?!\()\s*)['"]([^'"]+)['"]/g)) {
      if (!match[1].startsWith('.')) continue;
      const imported = new URL(match[1], moduleURL).href;
      if (keep.has(imported)) continue;
      keep.add(imported);
      modules.push(imported);
    }
  }
  for (const path of ['./privacy.html', './terms.html', './manifest.webmanifest', './assets/elimination-skull-v1.png', './assets/elimination-skull-poison-v1.png', './assets/elimination-skull-commander-v1.png']) {
    const url = new URL(path, SCOPE).href;
    if (await cache.match(url)) keep.add(url);
  }
  return keep;
}

async function previousShell(names) {
  for (const name of names.filter(name => name !== CACHE).sort((a, b) => Number(b.match(/\d+$/)[0]) - Number(a.match(/\d+$/)[0]))) {
    const cache = await caches.open(name);
    if (await cache.match(COMPLETE)) return { name, keep: null };
    const keep = await legacyShell(cache);
    if (keep) return { name, keep };
  }
  return null;
}

async function activate() {
  try {
    const names = (await caches.keys()).filter(name => OWNED_CACHE.test(name));
    const previous = await previousShell(names);
    await Promise.all(names.filter(name => name !== previous?.name).map(name => caches.delete(name)));
    if (previous?.keep) {
      const cache = await caches.open(previous.name);
      // Remove legacy query variants and runtime extras before filling the new shell.
      for (const request of await cache.keys()) if (!previous.keep.has(request.url)) await cache.delete(request);
    }
    const cache = await caches.open(CACHE);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const results = await Promise.allSettled(APP_SHELL.map(async path => {
        const url = new URL(path, SCOPE).href;
        const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
        if (!await boundedResponse(response)) throw new Error('Uncacheable offline asset');
        await cache.put(url, response);
      }));
      if (results.some(result => result.status === 'rejected')) throw new Error('Incomplete offline shell');
      await cache.put(COMPLETE, new Response('complete'));
      selectedCache = CACHE;
      if (previous) await caches.delete(previous.name);
    } catch {
      await caches.delete(CACHE);
      // Keep a coherent old graph until a later worker update can replace it.
      // Online requests still use the network; no partial shell is published.
      selectedCache = previous?.name || null;
    } finally { clearTimeout(timeout); }
  } catch {
    // Storage denial must not prevent the online app or worker from activating.
    selectedCache = null;
  }
}

async function readableCache() {
  if (selectedCache === undefined) {
    const names = (await caches.keys()).filter(name => OWNED_CACHE.test(name));
    if (names.includes(CACHE) && await (await caches.open(CACHE)).match(COMPLETE)) selectedCache = CACHE;
    else selectedCache = (await previousShell(names))?.name || null;
  }
  return selectedCache ? caches.open(selectedCache) : null;
}

function cacheRuntime(url, response) {
  writes = writes.catch(() => {}).then(async () => {
    if (selectedCache === undefined) await readableCache();
    if (selectedCache !== CACHE || !await boundedResponse(response)) return;
    const cache = await caches.open(CACHE);
    const extras = (await cache.keys()).filter(request => !SHELL_URLS.has(request.url) && request.url !== COMPLETE);
    // Serialize eviction and insertion, including concurrent successful requests.
    for (const request of extras.slice(0, Math.max(0, extras.length - MAX_RUNTIME_ENTRIES + 1))) await cache.delete(request);
    await cache.put(url.href, response);
  }).catch(() => {});
  return writes;
}

async function offlineResponse(request, url) {
  try {
    const cache = await readableCache();
    if (cache) {
      const cached = await cache.match(request);
      if (cached) return cached;
      const relative = url.pathname.slice(new URL(SCOPE).pathname.length);
      if (request.mode === 'navigate' && ['', 'index.html', 'privacy.html', 'terms.html'].includes(relative)) {
        const page = await cache.match(new URL(relative || 'index.html', SCOPE).href);
        if (page) return page;
      }
    }
  } catch { /* Cache denial is equivalent to an offline miss. */ }
  return Response.error();
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || /^\/api(?:\/|$)/.test(url.pathname) || url.pathname === '/health' || request.headers.has('Authorization') || request.cache === 'no-store' || /\b(?:no-store|private)\b/i.test(request.headers.get('Cache-Control') || '')) return;
  let caching = Promise.resolve();
  const network = fetch(request).then(response => {
    // Runtime HTML/module writes could mix a newer server graph into the pinned
    // active shell. Only optional unversioned public art may grow this cache.
    if (runtimeAsset(url) && !SHELL_URLS.has(url.href)) caching = cacheRuntime(url, response.clone());
    return response;
  });
  event.respondWith(network.catch(() => offlineResponse(request, url)));
  event.waitUntil(network.then(() => caching).catch(() => {}));
});
