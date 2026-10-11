// Phase 16: the previous worker cached EVERY non-document same-origin GET after fetching it from the
// network - including Next.js RSC/flight payloads for dynamic (possibly signed-in) pages. That gave no
// speed-up (always network-first), grew the cache without bound, and could keep personal page data on disk.
// Now: immutable build assets and static images are served from cache; everything else goes to the network.
const CACHE_NAME = "gamevortex-shell-v3";
const STATIC_CACHE = "gamevortex-static-v3";
const APP_SHELL = ["/", "/games", "/apps", "/vip"];

self.addEventListener("install", (event) => {
  // One failing page must not abort installation (cache.addAll is all-or-nothing).
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(APP_SHELL.map((url) => cache.add(url)))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME && key !== STATIC_CACHE).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

// Content-hashed build output and the site's own static images never change for a given URL.
const STATIC_PATH = /^\/(_next\/static\/|images\/|icon-\d+\.png$|apple-touch-icon\.png$|icon\.svg$)/;
// Never cache API, auth, wallet, orders or downloads: private / time-sensitive data.
const PRIVATE_PATH = /^\/(api|auth|wallet|orders|payment|admin)(\/|$)/;

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || !request.url.startsWith(self.location.origin)) return;
  const path = new URL(request.url).pathname;
  if (PRIVATE_PATH.test(path)) return;

  // Static assets: cache-first, filled on first use.
  if (STATIC_PATH.test(path)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then((cache) =>
        cache.match(request).then(
          (cached) =>
            cached ||
            fetch(request).then((response) => {
              if (response.ok) cache.put(request, response.clone());
              return response;
            })
        )
      )
    );
    return;
  }

  // Pages: network-first, offline fallback to the cached home shell. Nothing else is stored.
  if (request.destination === "document") {
    event.respondWith(fetch(request).catch(() => caches.match(request).then((cached) => cached || caches.match("/"))));
  }
  // Anything else (RSC payloads, fonts from the framework, etc.) is left to the browser.
});
