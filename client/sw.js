const CACHE = 'fivefold-arc-v368';
const APP_SHELL = ['./', './index.html', './privacy.html', './terms.html', './styles.css?v=243', './app.js?v=305', './dial-layout.css?v=1', './dial-layout.js?v=1', './appearance-catch-up.js?v=2', './competition.css?v=1', './competition-ui.js?v=5', './pod-invite-qr.mjs?v=1', './competition-model.mjs?v=1', './collection-visual.css?v=5', './collection-visual.js?v=4', './join-qr-scanner.js?v=5', './game-wake-lock.js?v=1', './account-auth.js?v=7', './create-account.js?v=1', './vendor/jsqr.js?v=1', './commander-source-flow.js?v=1', './card-interaction-advice.js?v=1', './realtime.js?v=89', './table-device-id.js?v=1', './life-adjustment-batcher.js?v=73', './vendor/dice-box/dice-box.es.js', './vendor/dice-box/Dice.js', './vendor/dice-box/assets/themes/default/default.json', './vendor/dice-box/assets/themes/default/diffuse-dark.png', './vendor/dice-box/assets/themes/default/specular.jpg', './vendor/dice-box/assets/themes/default/theme.config.json', './manifest.webmanifest', './icons/arc-mark.svg', './assets/elimination-skull-v1.png', './assets/elimination-skull-poison-v1.png', './assets/elimination-skull-commander-v1.png'];

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
