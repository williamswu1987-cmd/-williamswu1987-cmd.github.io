/* NearBite service worker — app shell offline; live map APIs always network. */
const CACHE = "protiva-shell-v12";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./geo.js",
  "./monetization.js",
  "./trust.js",
  "./coach.js",
  "./manifest.webmanifest",
  "./privacy.html",
  "./terms.html",
  "./data/menus.js",
  "./data/cuisine-templates.js",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-180.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Never cache live location / map / font CDN in a stale way for API hosts
  const externalLive =
    /overpass|photon\.komoot|nominatim\.openstreetmap|googleapis|gstatic/.test(url.hostname);
  if (externalLive) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const fetched = fetch(req)
        .then((res) => {
          if (res.ok && url.origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetched;
    })
  );
});
