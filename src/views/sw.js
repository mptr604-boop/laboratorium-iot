// src/views/sw.js
// Natywny Service Worker dla PWA LIMS - Obsługa trybu Offline i buforowania zasobów

const CACHE_NAME = 'lims-v1-cache';
const ASSETS_TO_CACHE = [
  '/login',
  '/manifest.json'
];

// Instalacja Service Workera i zamrażanie krytycznych zasobów w pamięci podręcznej urządzenia
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SERVICE-WORKER] Buforowanie zasobów offline...');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// Przechwytywanie żądań sieciowych (Fetch) - Strategia: Sieć, a przy awarii (Offline) -> Cache
self.addEventListener('fetch', (event) => {
  // Przechwytujemy tylko standardowe żądania GET (widoki)
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});
