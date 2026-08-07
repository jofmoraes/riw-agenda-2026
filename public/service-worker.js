const CACHE_NAME = 'riw-agenda-shell-v8';
const SHELL = [
  './',
  './index.html',
  './style.css?v=20260807-1',
  './overrides-v4.css?v=20260807-1',
  './app-parts/00.js?v=20260807-1',
  './app-parts/01.js?v=20260807-1',
  './app-parts/02.js?v=20260807-1',
  './app-parts/03.js?v=20260807-1',
  './app-parts/04.js?v=20260807-1',
  './app-parts/05.js?v=20260807-1',
  './app-parts/06.js?v=20260807-1',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  if (requestUrl.pathname.startsWith('/api/')) { event.respondWith(fetch(event.request)); return; }
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request, {cache:'no-store'}).then(response => {
      const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy)); return response;
    }).catch(() => caches.match('./index.html')));
    return;
  }
  event.respondWith(fetch(event.request, {cache:'no-store'}).then(response => {
    if (response.ok) { const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)); }
    return response;
  }).catch(() => caches.match(event.request)));
});
