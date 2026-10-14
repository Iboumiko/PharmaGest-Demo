const CACHE = 'pharmagest-v52-shell';
const CORE = [
  './utilisateurs.html',
  './receptions.html',
  './login.html',
  './scanner.html',
  './produits.html',
  './rapports.html',
  './lots.html',
  './audit.html',
  './vente.html',
  './fournisseurs.html',
  './stocks.html',
  './parametres.html',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './assets/css/app.css',
  './assets/js/app.js',
  './assets/js/branding.js',
  './assets/js/offline.js',
  './assets/js/performance.js',
  './assets/js/mobile-role.js',
  './assets/js/mobile-shell.js',
  './assets/css/mobile-shell.css',
  './assets/css/modals.css',
  './assets/css/theme.css',
  './assets/js/modals.js',
  './assets/js/theme.js',
  './notifications.html'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // IMPORTANT : les pages de l'application sont désormais CACHE-FIRST.
  // Ainsi, une perte totale du Wi-Fi ne bloque pas la navigation.
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;

        return fetch(request).then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {});
          }
          return response;
        }).catch(() => caches.match('./vente.html').then(r => r || caches.match('./index.html')));
      })
    );
    return;
  }

  // Ressources statiques : cache d'abord, réseau ensuite.
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request).then(response => {
        if (response.ok && (
          url.pathname.endsWith('.js') ||
          url.pathname.endsWith('.css') ||
          url.pathname.endsWith('.html') ||
          url.pathname.endsWith('.webmanifest')
        )) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {});
        }
        return response;
      });
    })
  );
});
