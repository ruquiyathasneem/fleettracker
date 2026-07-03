// FleetGPS Service Worker — enables PWA background capabilities
const CACHE_NAME = 'fleetgps-v1';
const ASSETS = [
  '/tracker-client/tracker.html',
  '/tracker-client/manifest.json'
];

// Install: cache core assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: serve from cache, fallback to network
self.addEventListener('fetch', event => {
  // Don't intercept API/location calls — let them go directly to network
  if (event.request.url.includes('/api/')) return;

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});

// Background Sync: flush queued location pings when connectivity is restored
self.addEventListener('sync', event => {
  if (event.tag === 'flush-location-queue') {
    event.waitUntil(flushQueue());
  }
});

async function flushQueue() {
  // Notify all open clients (tabs) to flush their offline queue
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(client => client.postMessage({ type: 'FLUSH_QUEUE' }));
}
