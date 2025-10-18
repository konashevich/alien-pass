// Basic offline-first service worker for AlienPass with version bumping
const VERSION = 'v1.0.0';
const CACHE_NAME = `alienpass-cache-${VERSION}`;
// Build scope-relative URLs so it works on custom domain and GitHub project pages
function url(path) { return new URL(path, self.registration.scope).toString(); }
const OFFLINE_URLS = [
  url(`index.html?v=${VERSION}`),
  url(`xxhash.min.js?v=${VERSION}`),
  url(`alienpass.svg?v=${VERSION}`),
  url(`icons/icon-192.svg?v=${VERSION}`),
  url(`icons/icon-512.svg?v=${VERSION}`),
  url(`manifest.webmanifest?v=${VERSION}`),
  url(`app-version.json?v=${VERSION}`)
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
      fetch(req).catch(() => caches.match(url('index.html'), { ignoreSearch: true }))
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
