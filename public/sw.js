// Rail Trail Tracker service worker.
// Bump SW_VERSION whenever this file or the app-shell asset list changes —
// it's the cache-busting key for the shell/API caches (map-tiles is versionless,
// since re-downloading a trail's tiles on every deploy would defeat the point).
const SW_VERSION = 'v4';
const SHELL_CACHE = `shell-${SW_VERSION}`;
const API_CACHE = `api-${SW_VERSION}`;
const TILE_CACHE = 'map-tiles';

const SHELL_URLS = [
  '/',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
];

const API_PATHS = ['/api/rides', '/api/trail-geometry', '/api/ignored-trails', '/api/trail-fetch-failures'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Cache each shell asset independently so one CDN hiccup doesn't fail install.
    await Promise.all(SHELL_URLS.map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res.ok) await cache.put(url, res);
      } catch (e) { /* offline install or CDN blip — app still installs, just without that asset cached yet */ }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k !== SHELL_CACHE && k !== API_CACHE && k !== TILE_CACHE)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isApiPath(pathname) {
  return API_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // POST/DELETE always go straight to network
  const url = new URL(req.url);

  // Map tiles — stale-while-revalidate. Pre-downloaded or previously-viewed
  // tiles serve instantly offline; anything new gets fetched and cached for next time.
  if (url.hostname.endsWith('basemaps.cartocdn.com')) {
    event.respondWith((async () => {
      const cache = await caches.open(TILE_CACHE);
      const cached = await cache.match(req);
      const network = fetch(req).then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      return cached || (await network) || new Response('', { status: 504 });
    })());
    return;
  }

  // Rail Trail Tracker's own API — network-first, falling back to the last
  // successful response when offline so the app still shows real (if stale) data.
  if (url.origin === self.location.origin && isApiPath(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(API_CACHE);
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch (e) {
        const cached = await cache.match(req);
        if (cached) return cached;
        throw e;
      }
    })());
    return;
  }

  // App shell navigation (the SPA itself) — network-first so a normal reload
  // always picks up a new deploy; offline falls back to the cached shell.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(SHELL_CACHE);
        if (res.ok) cache.put('/', res.clone());
        return res;
      } catch (e) {
        const cache = await caches.open(SHELL_CACHE);
        return (await cache.match('/')) || new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  // Everything else same-origin/CDN static (Leaflet JS/CSS, icons, manifest) — cache-first.
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (e) {
      return new Response('', { status: 504 });
    }
  })());
});

// Lets the page ask the SW to bulk-cache a specific set of tile URLs (the
// "Download trail for offline" feature) without duplicating the fetch/cache
// logic — the page computes which tiles a trail needs, the SW just stores them.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CACHE_TILES' && Array.isArray(event.data.urls)) {
    const { urls, requestId } = event.data;
    event.waitUntil((async () => {
      const cache = await caches.open(TILE_CACHE);
      let done = 0;
      const CONCURRENCY = 6;
      const queue = urls.slice();
      async function worker() {
        while (queue.length) {
          const url = queue.shift();
          try {
            const res = await fetch(url);
            if (res.ok) await cache.put(url, res);
          } catch (e) { /* skip failed tile, don't block the rest */ }
          done++;
          const clients = await self.clients.matchAll();
          for (const client of clients) {
            client.postMessage({ type: 'TILE_PROGRESS', requestId, done, total: urls.length });
          }
        }
      }
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    })());
  }
});
