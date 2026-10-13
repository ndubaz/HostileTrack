// Offline cache for Hostile Track. Bump VERSION on each deploy that changes index.html.
const VERSION = 'ht-v1';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(VERSION).then(cc => cc.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
