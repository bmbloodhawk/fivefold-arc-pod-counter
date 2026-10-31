// A waiting worker is promoted only after every open game page confirms that
// it is safe. The old controller keeps serving a complete release otherwise.
const RELEASE_ID = '2026-10-30-safe-reclaim-8';
const CACHE_PREFIX = 'fivefold-arc-release-';
const CACHE = `${CACHE_PREFIX}${RELEASE_ID}`;
const PREVIOUS_RELEASE_CACHE = 'fivefold-arc-release-2026-10-30-safe-reclaim-7';
const RELEASE_STATUS_REQUEST = 'fivefold-arc:release-status-request';
const RELEASE_STATUS_REPLY = 'fivefold-arc:release-status-reply';
const ACTIVATE_WHEN_SAFE = 'fivefold-arc:activate-when-safe';
const pendingActivationChecks = new Map();
const APP_SHELL = [
  './', './index.html', './privacy.html', './terms.html', './styles.css?v=237', './app.js?v=272',
  './account-auth.js?v=6', './active-table-recovery.js?v=1', './release-update.js?v=2', './connection-state.js?v=1', './game-wake-lock.js?v=1',
  './commander-source-flow.js?v=1', './card-interaction-advice.js?v=1', './join-qr-scanner.js?v=3', './realtime.js?v=79',
  './life-adjustment-batcher.js?v=72', './dice-roll-3d.js?v=114', './vendor/jsqr.js?v=1', './vendor/three/three.module.js',
  './vendor/three/three.core.js', './vendor/rapier/rapier.mjs', './vendor/dice-box/dice-box.es.js', './vendor/dice-box/Dice.js',
  './vendor/dice-box/assets/themes/default/default.json', './vendor/dice-box/assets/themes/default/diffuse-dark.png',
  './vendor/dice-box/assets/themes/default/normal.png', './vendor/dice-box/assets/themes/default/specular.jpg',
  './vendor/dice-box/assets/themes/default/theme.config.json', './manifest.webmanifest', './icons/arc-mark.svg',
  './assets/elimination-skull-v1.png', './assets/elimination-skull-poison-v1.png', './assets/elimination-skull-commander-v1.png'
];

self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_SHELL))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys
  .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE && key !== PREVIOUS_RELEASE_CACHE)
  .map(key => caches.delete(key))))));
self.addEventListener('message', event => {
  if (event.data?.type === RELEASE_STATUS_REPLY) {
    const check = pendingActivationChecks.get(event.data.requestId);
    if (check && event.source?.id && check.clientIds.has(event.source.id)) {
      check.responses.set(event.source.id, event.data.safe === true);
      if (check.responses.size === check.clientIds.size) check.complete([...check.responses.values()].every(Boolean));
    }
    return;
  }
  if (event.data?.type === ACTIVATE_WHEN_SAFE) event.waitUntil(activateWhenEveryGamePageIsSafe());
});

async function activateWhenEveryGamePageIsSafe() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const gameClients = clients.filter(client => {
    const path = new URL(client.url).pathname;
    return path === '/' || path.endsWith('/index.html');
  });
  if (!gameClients.length) return self.skipWaiting();
  const requestId = `${Date.now()}-${Math.random()}`;
  const clientIds = new Set(gameClients.map(client => client.id));
  const safe = await new Promise(resolve => {
    const timeout = setTimeout(() => complete(false), 1000);
    const complete = result => {
      clearTimeout(timeout);
      pendingActivationChecks.delete(requestId);
      resolve(result);
    };
    pendingActivationChecks.set(requestId, { clientIds, responses: new Map(), complete });
    gameClients.forEach(client => client.postMessage({ type: RELEASE_STATUS_REQUEST, requestId }));
  });
  if (safe) await self.skipWaiting();
}
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname === '/health') return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (event.request.mode !== 'navigate') {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      return fetch(event.request);
    }
    try { return await fetch(event.request); }
    catch { return cache.match('./index.html') || Response.error(); }
  })());
});
