// Service worker: the CRM opens like an app from the home screen and works without internet with the last saved data.
// Pages and scripts: network first (so every update reaches the phone at once), the saved copy when offline or when the network takes over 2 s.
// Fonts: saved once and reused. Calls to GitHub, Gemini and Telegram are never cached.
const CACHE = 'mital-crm-v124';
const SHELL = ['./', './index.html', './manifest.json', './me.html', './me.js', './me-uz.js', './me-manifest.json', './icon.svg', './icon-192.png', './icon-512.png', './apple-touch-icon.png',
  './style.css', './theme.css', './ios.css', './nova.css', './work.css', './charts.js', './ui.js', './xl.js', './xgrid.js', './wh.js', './ag.js', './engine.bundle.js', './static-api.js', './auth.js', './country.js', './menuorder.js', './cloud.js', './up.js',
  './rep.js', './tg.js', './chat.js', './ai.js', './copilot.js', './lb.js', './cl.js', './card.js', './kb.js', './sig.js', './agent.js', './wh2.js', './route.js', './lx.js', './remind.js', './assort.js', './anew.js', './wake.js', './credit.js', './inst.js', './debt.js', './invo.js', './disc.js', './pay.js', './archive.js', './talk.js', './agentcab.js', './atask.js', './wcount.js', './visits.js', './field.js', './dolg.js', './gps.js', './linko-jobs.json', './linko.js', './ux.js', './pwa.js', './refresh.js', './live.js', './bal.js', './my.js', './day.js', './abc.js', './gone.js', './nova.js', './app.js', './icon-maskable-512.png', './splash-192.png', './splash-512.png', './app-maskable-192.png', './app-maskable-512.png'];

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
  // a library of a fixed version from the CDN (supabase-js@2.45.4) never changes: cache first, no network wait on every start
  if (url.hostname === 'cdn.jsdelivr.net' && /@\d/.test(url.pathname)) {
    e.respondWith(caches.open(CACHE).then(async c => (await c.match(req)) || fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; })));
    return;
  }
  if (url.origin !== location.origin) return; // GitHub, Gemini, Telegram, other CDNs: straight to the network
  // scripts and styles with a version (app.js?v=202611250100): a new version is a new address, so the saved copy of THIS address
  // is always right — taken at once, without waiting for the network (the CRM used to wait up to 2 s for each of 60 files)
  if (url.searchParams.has('v') && /\.(js|css)$/.test(url.pathname)) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE), hit = await c.match(req, { ignoreVary: true });
      if (hit) return hit;
      try {
        const r = await fetch(req);
        if (r.ok) { c.put(req, r.clone()); c.keys().then(ks => ks.forEach(k => { const u = new URL(k.url); if (u.pathname === url.pathname && u.search !== url.search) c.delete(k); })); }
        return r;
      } catch {
        return (await c.match(new Request(url.origin + url.pathname))) || new Response('', { status: 503 });
      }
    })());
    return;
  }
  e.respondWith((async () => {
    const c = await caches.open(CACHE), key = url.pathname.endsWith('/') ? new Request(url.origin + url.pathname + 'index.html') : new Request(url.origin + url.pathname);
    // slow internet: if the network hasn't answered in 2 s, open the saved copy now; the network answer still refreshes it for next time
    const net = fetch(req, { cache: 'no-cache' }).then(r => { if (r.ok) c.put(key, r.clone()); return r; });
    const saved = await c.match(key);
    try {
      if (!saved) return await net;
      net.catch(() => {});
      return await Promise.race([net, new Promise(res => setTimeout(() => res(saved), 2000))]);
    } catch {
      return (await c.match(key)) || (await c.match('./index.html')) || new Response('Нет интернета', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
