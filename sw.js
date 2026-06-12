const CACHE_NAME = "jkcrew-shell-v2.11.12";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=2.11.12",
  "./app.js?v=2.11.12",
  "./manifest.webmanifest?v=2.11.12",
  "./icons/jkc-logo.png?v=2.11.12",
  "./icons/jkcoaching-wordmark.png?v=2.11.12",
  "./icons/app-icon.svg",
  "./icons/app-icon-192.png?v=2.11.12",
  "./icons/app-icon-512.png?v=2.11.12",
  "./icons/app-icon-maskable-512.png?v=2.11.12",
  "./icons/apple-touch-icon.png?v=2.11.12",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: "window" }))
      .then((clients) => clients.forEach((client) => {
        const url = new URL(client.url);
        if (url.origin === self.location.origin && !url.searchParams.has("jkcrew-updated")) {
          url.searchParams.set("jkcrew-updated", "1");
          client.navigate(url.href);
        }
      })),
  );
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== "GET" || requestUrl.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.match("./index.html")),
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
