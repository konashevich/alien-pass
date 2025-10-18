// Basic offline-first service worker for AlienPass with version bumping
const VERSION = 'v1.0.0';
const CACHE_NAME = `alienpass-cache-${VERSION}`;
const OFFLINE_URLS = [
  `/?v=${VERSION}`,
  `/index.html?v=${VERSION}`,
  `/xxhash.min.js?v=${VERSION}`,
  `/alienpass.svg?v=${VERSION}`,
  `/icons/icon-192.svg?v=${VERSION}`,
  `/icons/icon-512.svg?v=${VERSION}`,
  `/manifest.webmanifest?v=${VERSION}`,
  `/app-version.json?v=${VERSION}`
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(OFFLINE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => { if (k !== CACHE_NAME) return caches.delete(k); }))).then(() => self.clients.claim())
  );
});

// Cache-first for same-origin requests; network-first for navigations
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/index.html', { ignoreSearch: true }))
    );
    return;
  }
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then((cached) => cached || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      }).catch(() => cached))
    );
  }
});
