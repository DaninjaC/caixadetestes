const CACHE_NAME = 'rota-ninja-v7';
const FILES_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/estilo-base.css',
  '/css/layout.css',
  '/js/main.js',
  '/js/leitor.js',
  '/js/motor-auto.js',
  '/js/motor-manual.js',
  '/js/motor-doca.js',
  '/js/motor-gps.js',
  '/assets/ninjaspx.png'
];

self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(FILES_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) return caches.delete(key);
      }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (evt) => {
  evt.respondWith(
    caches.match(evt.request).then((res) => {
      return res || fetch(evt.request);
    })
  );
});
