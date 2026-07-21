/**
 * GFHF Service Worker — v3
 * Caches core app shell for offline functionality.
 * Implements cache-first then network-fallback strategy.
 */

const CACHE_NAME = 'gfhf-cache-v3';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './css/auth.css',
  './js/auth.js',
  './js/pwa.js',
  './js/script.js',
  './js/home.js',
  './js/livescores.js',
  './js/chat.js',
  './js/firebase-config.js',
  './js/firebase.js',
  './js/notifications.js',
  './js/predictions.js',
  './js/admin.js',
  './js/community.js',
  './js/dashboard.js',
  './js/donate.js',
  './js/news.js',
  './pages/about.html',
  './pages/competition.html',
  './pages/contact.html',
  './pages/donate.html',
  './pages/faq.html',
  './pages/login.html',
  './pages/register.html',
  './pages/news.html',
  './pages/community.html',
  './pages/dashboard.html',
  './pages/predictions.html',
  './pages/admin.html',
  './images/icon-192.svg',
  './images/icon-512.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // Skip non-essential requests like analytics
  if (url.pathname.includes('firebase') || url.pathname.includes('google')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        // Return cached version, then update cache in background for next time
        fetch(event.request).then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
        }).catch(() => { /* offline, cached response already returned */ });
        return cached;
      }

      // Not in cache — fetch from network and cache for future
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      }).catch(() => {
        // If offline and not cached, try serving index.html as a fallback
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});

// Listen for SKIP_WAITING message from the client
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
