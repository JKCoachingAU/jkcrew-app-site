const CACHE_NAME = "jkcrew-shell-v2.11.40";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=2.11.40",
  "./app.js?v=2.11.40",
  "./manifest.webmanifest?v=2.11.40",
  "./icons/jkc-logo.png?v=2.11.40",
  "./icons/jkcoaching-wordmark.png?v=2.11.40",
  "./icons/app-icon-192.png?v=2.11.40",
  "./icons/app-icon-512.png?v=2.11.40",
  "./icons/app-icon-maskable-512.png?v=2.11.40",
  "./icons/apple-touch-icon.png?v=2.11.40",
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

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch (_error) {
    payload = { body: event.data?.text() || "You have a new JKCREW update." };
  }
  const title = payload.title || "JK Coaching";
  event.waitUntil(self.registration.showNotification(title, {
    body: payload.body || "You have a new JKCREW update.",
    icon: "./icons/app-icon-192.png?v=2.11.40",
    badge: "./icons/app-icon-192.png?v=2.11.40",
    tag: payload.notificationId || payload.type || "jkcrew-update",
    renotify: payload.type === "crew_chat",
    data: {
      url: payload.url || "./",
      view: payload.view || (payload.type === "parent_weekly_summary" ? "home" : "board"),
    },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "./", self.registration.scope).href;
  const view = event.notification.data?.view || "home";
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = clients.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.focus();
      existing.postMessage({ type: "JKCREW_PUSH_NAVIGATE", view });
      return;
    }
    await self.clients.openWindow(targetUrl);
  })());
});
