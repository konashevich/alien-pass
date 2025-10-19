// Basic offline-first service worker for AlienPass with cache-name versioning
let VERSION = 'v1.0.1'; // fallback if app-version.json not available
let CACHE_NAME = `alienpass-cache-${VERSION}`;
// Build scope-relative URLs so it works on custom domain and GitHub project pages
function toAbs(path) { return new URL(path, self.registration.scope).toString(); }
function getOfflineUrls() {
  return [
    toAbs('index.html'),
    toAbs('xxhash.min.js'),
    toAbs('alienpass.svg'),
    toAbs('icons/icon-192.svg'),
    toAbs('icons/icon-512.svg'),
    toAbs('manifest.webmanifest'),
    toAbs('app-version.json')
  ];
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      // Attempt to get version from app-version.json before precaching
      const res = await fetch(toAbs('app-version.json'), { cache: 'no-cache' });
      if (res && res.ok) {
        const data = await res.json();
        const v = (data && data.version) ? String(data.version) : VERSION;
        if (v) {
          VERSION = v;
          CACHE_NAME = `alienpass-cache-${VERSION}`;
        }
      }
    } catch { /* offline on first install; use fallback */ }
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(getOfflineUrls());
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      // Try to read current version file to detect changes and bump cache key
      const res = await fetch(toAbs('app-version.json'), { cache: 'no-cache' });
      if (res && res.ok) {
        const data = await res.json();
        const v = (data && data.version) ? String(data.version) : VERSION;
        if (v && v !== VERSION) {
          VERSION = v;
          CACHE_NAME = `alienpass-cache-${VERSION}`;
        }
      }
    } catch {
      // ignore network errors; keep fallback
    }
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => { if (k !== CACHE_NAME) return caches.delete(k); }));
    await self.clients.claim();
  })());
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
    const isStatic = /\.(?:js|css|svg|png|jpg|jpeg|webp|gif|ico|webmanifest|json)(?:\?|#|$)/i.test(reqUrl.pathname) || /\/index\.html$/.test(reqUrl.pathname);
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
