/* Offline cache: everything the app needs is stored on first load. */
const CACHE = 'dnb-v1.0.0';
const ASSETS = [
  "./",
  "app.js",
  "engine.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "img/square.png",
  "index.html",
  "manifest.webmanifest",
  "music/advance_Concert.ogg",
  "music/advance_Hot_Swing.ogg",
  "music/advance_Victory.ogg",
  "music/applause.ogg",
  "music/good_Corncob.ogg",
  "music/good_Emptiness.ogg",
  "music/good_Sea_Song.ogg",
  "music/great_Butterfly_Tea_-_Cavern_of_Time.ogg",
  "music/great_Human_Beat.ogg",
  "music/great_Lachaim.ogg",
  "sounds/c.webm",
  "sounds/h.webm",
  "sounds/k.webm",
  "sounds/l.webm",
  "sounds/q.webm",
  "sounds/r.webm",
  "sounds/s.webm",
  "sounds/t.webm",
  "style.css",
  "sync.js",
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return; // GitHub sync goes straight to network
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match('./index.html'))));
});
