/*
 * The Founder's Ledger as an app: the code is kept on the phone, so opening it again does not wait
 * on the network for anything but the ledger itself.
 *
 *   - Hashed files under assets/ never change once published: served from the cache, fetched once.
 *   - The page itself: network first, so a new deploy arrives on the next open; the cached copy
 *     only when there is no signal. Each fresh page also clears cached files it no longer uses.
 *   - The API is never touched: saves, sign-in and the coach always go to the server.
 */
const CACHE = 'founders-ledger-v1';
const BASE = new URL('./', self.location).pathname; // /founders-ledger/

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE && k.startsWith('founders-ledger-')) await caches.delete(k);
    await self.clients.claim();
  })());
});

/** Deletes cached files the current page no longer uses: those named in the page, plus the chunks
 *  its entry script names (the engine), are kept. */
async function prune(html) {
  // File names only: the page names assets/x.js, the entry script names ./x.js.
  const names = text => [...text.matchAll(/([\w-]+-[\w-]{8}\.(?:js|css))/g)].map(m => m[1]);
  const used = new Set(names(html));
  const c = await caches.open(CACHE);
  for (const n of [...used]) {
    if (!n.endsWith('.js')) continue;
    const url = BASE + 'assets/' + n;
    const res = (await c.match(url)) || (await fetch(url).catch(() => null));
    if (res && res.ok) for (const m of names(await res.clone().text())) used.add(m);
  }
  for (const req of await c.keys()) {
    const p = new URL(req.url).pathname;
    if (p.startsWith(BASE + 'assets/') && !used.has(p.slice(p.lastIndexOf('/') + 1))) await c.delete(req);
  }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE) || url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) {
          const copy = res.clone();
          e.waitUntil((async () => {
            const c = await caches.open(CACHE);
            await c.put(BASE, copy.clone());
            await prune(await copy.text());
          })());
        }
        return res;
      } catch {
        const hit = await caches.match(BASE);
        if (hit) return hit;
        throw new Error('offline');
      }
    })());
    return;
  }

  if (url.pathname.startsWith(BASE + 'assets/')) {
    e.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) { const c = await caches.open(CACHE); await c.put(req, res.clone()); }
      return res;
    })());
  }
});
