/* Offline cache. Core files are required; music is saved best-effort so a
 * slow or failed music download can never stop the app working offline. */
const VERSION = '1.0.2';
const CACHE = 'dnb-' + VERSION;
const CORE = [
  "./",
  "index.html",
  "app.js",
  "engine.js",
  "sync.js",
  "style.css",
  "manifest.webmanifest",
  "img/square.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "sounds/c.wav",
  "sounds/h.wav",
  "sounds/k.wav",
  "sounds/l.wav",
  "sounds/q.wav",
  "sounds/r.wav",
  "sounds/s.wav",
  "sounds/t.wav"
];
const OPTIONAL = [
  "music/advance_Concert.ogg",
  "music/advance_Hot_Swing.ogg",
  "music/advance_Victory.ogg",
  "music/applause.ogg",
  "music/good_Corncob.ogg",
  "music/good_Emptiness.ogg",
  "music/good_Sea_Song.ogg",
  "music/great_Butterfly_Tea_-_Cavern_of_Time.ogg",
  "music/great_Human_Beat.ogg",
  "music/great_Lachaim.ogg"
];
// cache:'reload' skips the browser's HTTP cache so an update never saves stale files
const fresh = (u) => new Request(u, { cache: 'reload' });
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(async (c) => {
    await c.addAll(CORE.map(fresh));
    await Promise.allSettled(OPTIONAL.map((u) => c.add(fresh(u))));
  }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('dnb-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => {
  if (e.data === 'status') {
    caches.open(CACHE).then(async (c) => {
      const missing = [];
      for (const u of CORE.concat(OPTIONAL)) if (!(await c.match(u, { ignoreSearch: true }))) missing.push(u);
      e.source.postMessage({ type: 'status', version: VERSION, total: CORE.length + OPTIONAL.length, missing,
        coreMissing: missing.filter((u) => CORE.includes(u)) });
    });
  }
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return; // GitHub sync goes straight to network
  if (req.mode === 'navigate') {
    e.respondWith(caches.open(CACHE).then(async (c) =>
      (await c.match('./')) || (await c.match('index.html')) || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  })));
});
