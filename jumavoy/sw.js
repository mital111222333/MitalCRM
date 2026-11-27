// JUMAVOY moved to https://mital111222333.github.io/jumavoy/jumavoy/ — this old service worker removes itself and its cache,
// so a phone that installed the old app opens the redirect (and then the new address) instead of a stale offline copy
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) await caches.delete(k);
  await self.registration.unregister();
  for (const c of await self.clients.matchAll()) c.navigate(c.url);
})()));
