// Service worker: caches every app file so Study Planner works offline.
// Bump CACHE if you add or rename files so the precache list is refreshed.
const CACHE = 'study-planner-v1';
const FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './scheduler.js',
  './db.js',
  './manifest.webmanifest',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network first (so updates pushed to GitHub show up), falling back to the cache
// when offline or when the network is slow. Every successful response refreshes the cache.
const TIMEOUT_MS = 3000;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const network = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, TIMEOUT_MS));
  try {
    const res = await Promise.race([network, timeout]);
    if (res) return res;
  } catch { /* offline */ }
  const hit = await cache.match(req, { ignoreSearch: true })
    || (req.mode === 'navigate' ? await cache.match('./index.html') : undefined);
  if (hit) return hit;
  return network.catch(() => Response.error());
}
