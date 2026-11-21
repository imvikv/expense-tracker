/*
 * Service worker: caches ONLY this app's own static files so it opens offline.
 * Requests to Google (accounts.google.com, gmail.googleapis.com) and anything
 * else cross-origin are never intercepted or cached, so no email data or tokens
 * ever end up in the Cache Storage.
 */
const CACHE = 'pet-shell-v1';
const scope = self.registration.scope; // e.g. https://imvikv.github.io/expense-tracker/
const INDEX = new URL('./', scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll([INDEX, new URL('manifest.webmanifest', scope).href, new URL('icons/icon-192.png', scope).href]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Remove cached build assets that the current index.html no longer references. */
async function prune(html) {
  const cache = await caches.open(CACHE);
  const wanted = new Set([...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => new URL(m[1], scope).href));
  for (const req of await cache.keys()) {
    if (req.url.includes('/assets/') && !wanted.has(req.url)) await cache.delete(req);
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !req.url.startsWith(scope)) return; // never touch Google or other origins
  if (req.headers.has('authorization')) return;

  if (req.mode === 'navigate') {
    // Network first so new deployments show up; fall back to the cached shell offline.
    event.respondWith(
      fetch(req)
        .then(async (res) => {
          if (res.ok) {
            const copy = res.clone();
            const cache = await caches.open(CACHE);
            await cache.put(INDEX, copy.clone());
            copy.text().then(prune).catch(() => undefined);
          }
          return res;
        })
        .catch(async () => (await caches.match(INDEX)) || Response.error()),
    );
    return;
  }

  // Hashed build assets never change: cache first. Other own files: stale-while-revalidate.
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res.ok && res.type === 'basic') cache.put(req, res.clone());
          return res;
        })
        .catch(() => hit || Response.error());
      if (hit && url.pathname.includes('/assets/')) return hit;
      return hit || network;
    }),
  );
});
