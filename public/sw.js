// ScanOrigin Service Worker
const CACHE_NAME = "scanorigin-v5";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./logo.png",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  
  // Network-first for API calls and HTML documents (always get latest code)
  if (url.pathname.startsWith("/api/") || e.request.mode === "navigate" || url.pathname.endsWith(".html") || url.pathname === "/scanorigin/" || url.pathname === "/scanorigin") {
    e.respondWith(
      fetch(e.request).then((resp) => {
        if (resp.ok && e.request.method === "GET") {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return resp;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  
  // Cache-first for static assets (icons, images)
  e.respondWith(
    caches.match(e.request).then((cached) => {
      return cached || fetch(e.request).then((resp) => {
        if (resp.ok && e.request.method === "GET") {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return resp;
      }).catch(() => cached);
    })
  );
});