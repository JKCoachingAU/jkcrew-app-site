const CACHE_PREFIX = "jkcrew-riley-shell-";
const RELEASE_VERSION = "2.14.2";
const CACHE_NAME = `${CACHE_PREFIX}v${RELEASE_VERSION}`;
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=2.14.2",
  "./app.js?v=2.14.2",
  "./manifest.webmanifest?v=2.14.2",
  "./icons/jkc-logo.png?v=2.11.77",
  "./icons/jkcoaching-wordmark.png?v=2.11.77",
  "./icons/app-icon-192.png?v=2.11.77",
  "./icons/app-icon-512.png?v=2.11.77",
  "./icons/app-icon-maskable-512.png?v=2.11.77",
  "./icons/apple-touch-icon.png?v=2.11.77",
  "./icons/badges/prestige-01.png?v=2.14.2",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    await Promise.all(windows.map(async (client) => {
      const url = new URL(client.url);
      if (url.origin !== self.location.origin || url.searchParams.get("jkcrew-version") === RELEASE_VERSION) return;
      url.searchParams.delete("jkcrew-updated");
      url.searchParams.set("jkcrew-version", RELEASE_VERSION);
      try {
        await client.navigate(url.href);
      } catch (_) {
        // A window can close while a new release is activating; keep updating the remaining clients.
      }
    }));
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "JKCREW_ACTIVATE_RELEASE") event.waitUntil(self.skipWaiting());
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== "GET" || requestUrl.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request, { cache: "reload" })
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
    fetch(event.request, { cache: "reload" })
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
    icon: "./icons/app-icon-192.png?v=2.11.77",
    badge: "./icons/app-icon-192.png?v=2.11.77",
    tag: payload.notificationId || payload.type || "jkcrew-update",
    renotify: payload.type === "crew_chat",
    silent: false,
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
