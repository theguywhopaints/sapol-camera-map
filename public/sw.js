const CACHE = 'sapol-v3';
const TILE_CACHE = 'sapol-tiles-v3';
const MAX_TILES = 250;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(['/'])).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE && k !== TILE_CACHE).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Map tiles → cache-first with LRU cap
  if (url.hostname.includes('carto') || url.hostname.includes('openstreetmap')) {
    e.respondWith(tilesCacheFirst(e.request));
    return;
  }

  // API → network-first, fall back to cached response
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Static assets → stale-while-revalidate
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fresh = fetch(e.request).then((res) => {
        caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
        return res;
      });
      return cached || fresh;
    })
  );
});

// Show a camera alert notification from any context (foreground or background)
self.addEventListener('message', (e) => {
  if (e.data?.type !== 'CAMERA_ALERT') return;
  const { title, body, tag, urgent } = e.data;
  const opts = {
    body,
    tag,
    renotify: true,
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    requireInteraction: !!urgent,
    vibrate: urgent
      ? [500, 100, 500, 100, 500, 100, 800]
      : [300, 150, 300, 150, 500],
    actions: [{ action: 'dismiss', title: 'Dismiss' }],
    data: { url: '/' },
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

// Tap a notification → focus existing tab or open a new one
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  if (e.action === 'dismiss') return;
  e.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((list) => {
        for (const client of list) {
          if (client.url.startsWith(self.location.origin) && 'focus' in client) {
            return client.focus();
          }
        }
        return clients.openWindow('/');
      })
  );
});

async function tilesCacheFirst(request) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  cache.put(request, response.clone());

  // Prune oldest tiles if over limit
  const keys = await cache.keys();
  if (keys.length > MAX_TILES) {
    await cache.delete(keys[0]);
  }

  return response;
}
