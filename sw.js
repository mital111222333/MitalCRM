// Service worker: the CRM opens like an app from the home screen and works without internet with the last saved data.
// Pages and scripts: network first (so every update reaches the phone at once), the saved copy when offline.
// Fonts: saved once and reused. Calls to GitHub, Gemini and Telegram are never cached.
const CACHE = 'mital-crm-v8';
const SHELL = ['./', './index.html', './manifest.json', './icon.svg', './icon-192.png', './icon-512.png', './apple-touch-icon.png',
  './style.css', './theme.css', './charts.js', './ui.js', './wh.js', './ag.js', './engine.bundle.js', './static-api.js', './cloud.js', './up.js',
  './rep.js', './tg.js', './ai.js', './lb.js', './cl.js', './card.js', './sig.js', './agent.js', './wh2.js', './route.js', './lx.js', './linko-jobs.json', './linko.js', './ux.js', './pwa.js', './app.js', './icon-maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) { // fonts: cache first
    e.respondWith(caches.open(CACHE).then(async c => (await c.match(req)) || fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; })));
    return;
  }
  if (url.origin !== location.origin) return; // GitHub, Gemini, Telegram, CDN: straight to the network
  e.respondWith((async () => {
    const c = await caches.open(CACHE), key = url.pathname.endsWith('/') ? new Request(url.origin + url.pathname + 'index.html') : new Request(url.origin + url.pathname);
    try {
      const r = await fetch(req, { cache: 'no-cache' });
      if (r.ok) c.put(key, r.clone());
      return r;
    } catch {
      return (await c.match(key)) || (await c.match('./index.html')) || new Response('Нет интернета', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
