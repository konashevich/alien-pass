// Basic offline-first service worker for AlienPass with version bumping
const VERSION = 'v1.0.1';
const CACHE_NAME = `alienpass-cache-${VERSION}`;
// Build scope-relative URLs so it works on custom domain and GitHub project pages
function toAbs(path) { return new URL(path, self.registration.scope).toString(); }
const OFFLINE_URLS = [
  toAbs(`index.html?v=${VERSION}`),
  toAbs(`xxhash.min.js?v=${VERSION}`),
  toAbs(`alienpass.svg?v=${VERSION}`),
  toAbs(`icons/icon-192.svg?v=${VERSION}`),
  toAbs(`icons/icon-512.svg?v=${VERSION}`),
  toAbs(`manifest.webmanifest?v=${VERSION}`),
  toAbs(`app-version.json?v=${VERSION}`)
];
const OFFLINE_SET = new Set(OFFLINE_URLS);

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
  const reqUrl = new URL(req.url);
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match(toAbs('index.html'), { ignoreSearch: true }))
    );
    return;
  }
  // Only cache safe static assets from our own origin
  if (req.method === 'GET' && reqUrl.origin === location.origin) {
    const isStatic = OFFLINE_SET.has(req.url) || /\.(?:js|css|svg|png|jpg|jpeg|webp|gif|ico|webmanifest)(?:\?|#|$)/i.test(reqUrl.pathname);
    if (isStatic) {
      event.respondWith(
        caches.match(req, { ignoreSearch: true }).then((cached) => cached || fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        }).catch(() => cached))
      );
    }
  }
});
