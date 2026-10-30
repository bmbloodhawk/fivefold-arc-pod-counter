// A waiting worker is deliberately not promoted here. The old controller keeps
// serving its complete release until every old page is gone or the player
// refreshes at a lifecycle boundary chosen by the app.
const RELEASE_ID = '2026-10-30-safe-reclaim-1';
const CACHE_PREFIX = 'fivefold-arc-release-';
const CACHE = `${CACHE_PREFIX}${RELEASE_ID}`;
const PREVIOUS_RELEASE_CACHE = 'fivefold-arc-v331';
const APP_SHELL = [
  './', './index.html', './privacy.html', './terms.html', './styles.css?v=236', './app.js?v=265',
  './account-auth.js?v=6', './active-table-recovery.js?v=1', './release-update.js?v=1', './connection-state.js?v=1',
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
