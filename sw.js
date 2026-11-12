// Offline support. Everything the game loads from its own site is kept in a cache.
// Code and pages are fetched fresh whenever you are online (so updates arrive straight
// away) and served from the cache only when the network is unavailable. Sounds and the
// bundled libraries never change between releases, so those come from the cache first.
const CACHE = 'rampedup-v1';
const STATIC = /\/(sounds|vendor|icons)\//;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const key = url.origin + url.pathname; // ignore ?room=… and cache-busting queries
  const save = (res) => {
    if (res && res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
    return res;
  };
  if (STATIC.test(url.pathname)) {
    e.respondWith(caches.match(key).then((hit) => hit || fetch(req).then(save)));
  } else {
    e.respondWith(fetch(req).then(save).catch(() => caches.match(key).then((hit) => hit || Response.error())));
  }
});
