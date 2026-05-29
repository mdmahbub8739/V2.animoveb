const CACHE = 'animoweb-v1';
const PRECACHE = ['/', '/index.html', '/style.css', '/app.js', '/anime.js', '/player.js', '/config.js', '/anime.css'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(r => {
      const c = r.clone();
      caches.open(CACHE).then(cache => cache.put(e.request, c));
      return r;
    }).catch(() => caches.match(e.request))
  );
});
