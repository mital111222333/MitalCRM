// JUMAVOY app shell: the page opens even with a bad connection (network first, the saved copy if offline).
// Questions to the bot are never cached. Only good answers are saved: a 404 / 500 page from GitHub while it is being
// updated used to replace the good saved copy, and then the app opened that error page without the internet.
const C = 'jumavoy-v11', SHELL = ['./', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok && r.type === 'basic') { const copy = r.clone(); caches.open(C).then(c => c.put(e.request, copy)).catch(() => {}); return r; }
    return caches.match(e.request, { ignoreSearch: true }).then(m => m || r);
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
