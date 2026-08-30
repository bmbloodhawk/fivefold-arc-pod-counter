const CACHE = 'fivefold-arc-v116';
const APP_SHELL = ['./', './index.html', './styles.css?v=116', './app.js?v=114', './connection-state.js?v=1', './realtime.js?v=72', './life-adjustment-batcher.js?v=72', './vendor/three/three.module.js', './vendor/three/three.core.js', './vendor/rapier/rapier.mjs', './vendor/dice-box/dice-box.es.js', './vendor/dice-box/Dice.js', './vendor/dice-box/world.none.js', './vendor/dice-box/world.offscreen.js', './vendor/dice-box/assets/ammo/ammo.wasm.wasm', './vendor/dice-box/assets/themes/default/default.json', './vendor/dice-box/assets/themes/default/diffuse-dark.png', './vendor/dice-box/assets/themes/default/normal.png', './vendor/dice-box/assets/themes/default/specular.jpg', './vendor/dice-box/assets/themes/default/theme.config.json', './manifest.webmanifest', './icons/arc-mark.svg'];

self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_SHELL))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname === '/health') return;
  event.respondWith(fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then(cached => cached || (event.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});
