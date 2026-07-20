const CACHE_NAME = 'shreevedha-static-cache-v2';

// Core assets to cache immediately on Service Worker installation
const PRECACHE_ASSETS = [
  '/',
  '/static/uploads/Shree.png',
  '/static/uploads/All_India_Council_for_Technical_Education_logo.png',
  '/static/uploads/MOE.png'
];

// Install event: cache the core shell assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[Service Worker] Pre-caching core offline assets');
      return cache.addAll(PRECACHE_ASSETS).catch(err => {
        console.warn('[Service Worker] Pre-cache failed for some assets (this is normal if some are offline):', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate event: clean up outdated caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Removing old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event: serve static files and cache them on-the-fly
self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);

  // We only cache GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Determine if the requested resource is a static asset to cache
  const isStaticAsset = 
    requestUrl.pathname.startsWith('/static/') ||
    event.request.destination === 'image' ||
    event.request.destination === 'style' ||
    event.request.destination === 'font' ||
    requestUrl.hostname.includes('unsplash.com') ||
    requestUrl.hostname.includes('pexels.com') ||
    requestUrl.hostname.includes('fonts.googleapis.com') ||
    requestUrl.hostname.includes('fonts.gstatic.com') ||
    requestUrl.hostname.includes('unpkg.com') ||
    requestUrl.hostname.includes('cdn.jsdelivr.net');

  if (isStaticAsset) {
    event.respondWith(
      caches.match(event.request).then(cachedResponse => {
        if (cachedResponse) {
          // Serve the cached resource immediately and fetch a fresh one in the background (Stale-While-Revalidate)
          fetch(event.request).then(networkResponse => {
            if (networkResponse && (networkResponse.status === 200 || networkResponse.status === 0)) {
              caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, networkResponse);
              });
            }
          }).catch(() => {
            // Fail silently on background fetch errors (e.g. offline)
          });
          return cachedResponse;
        }

        // Cache miss: perform standard fetch, cache the response, then return it
        return fetch(event.request).then(networkResponse => {
          if (!networkResponse || (networkResponse.status !== 200 && networkResponse.status !== 0)) {
            return networkResponse;
          }

          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });

          return networkResponse;
        }).catch(err => {
          console.error('[Service Worker] Fetch failed:', err);
          return null;
        });
      })
    );
  }
});
