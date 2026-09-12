const CACHE_PREFIX = "jkcrew-riley-shell-";
const RELEASE_VERSION = "2.14.112";
const CACHE_NAME = `${CACHE_PREFIX}v${RELEASE_VERSION}`;
const APP_SHELL = [
  "./vendor/supabase-2.116.0.min.js",
  "./",
  "./index.html",
  "./styles.css?v=2.14.112",
  "./app.js?v=2.14.112",
  "./daily-completion.js?v=2.14.112",
  "./daily-completion.css?v=2.14.112",
  "./progress-sharing.js?v=2.14.112",
  "./progress-sharing.css?v=2.14.112",
  "./battle-rematches.js?v=2.14.112",
  "./battle-rematches.css?v=2.14.112",
  "./bike-parts-catalog.js?v=2.14.112",
  "./bike-config.js?v=2.14.112",
  "./bike-seat-designs.js?v=2.14.112",
  "./bike-photo-masks.js?v=2.14.112",
  "./bike-renderer.js?v=2.14.112",
  "./bike-preview.js?v=2.14.112",
  "./bike-preview.css?v=2.14.112",
  "./bike-three.js?v=2.14.112",
  "./bike-garage.js?v=2.14.112",
  "./bike-garage.css?v=2.14.112",
  "./manifest.webmanifest?v=2.14.112",
  "./icons/jkc-logo.png?v=2.11.77",
  "./icons/jkcoaching-wordmark.png?v=2.11.77",
  "./icons/app-icon-192.png?v=2.11.77",
  "./icons/app-icon-512.png?v=2.11.77",
  "./icons/app-icon-maskable-512.png?v=2.11.77",
  "./icons/apple-touch-icon.png?v=2.11.77",
  "./icons/badges/prestige-01.png?v=2.14.112",
];

// Public bike photos are fetched only when the garage needs them, then cached.
// They do not delay sign-in or service-worker installation.
const BIKE_PHOTO_ASSETS = [
  "./images/bike-garage/studio-white-v1.webp",
  "./images/bike-garage/studio-options-v1.webp",
  "./images/bike-garage/studio-hardware-v2.webp",
  "./images/bike-garage/studio-metal-v2.webp",
  "./images/bike-garage/studio-top-plastic-v5.webp",
  "./images/bike-garage/studio-front-metal-v5.webp",
  "./images/bike-garage/studio-four-top-v5.webp",
  "./images/bike-garage/studio-four-front-v5.webp",
  "./images/bike-garage/studio-chrome-v3.webp",
  "./images/bike-garage/studio-chrome-options-v3.webp",
  "./images/bike-garage/studio-jetfuel-v3.webp",
  "./images/bike-garage/studio-jetfuel-options-v3.webp",
  "./images/bike-garage/studio-chrome-top-stem-v3.webp",
  "./images/bike-garage/studio-chrome-front-stem-v3.webp",
  "./images/bike-garage/studio-lhd-v4.webp",
  "./images/bike-garage/studio-lhd-chrome-v4.webp",
  "./images/bike-garage/studio-lhd-jetfuel-v4.webp",
  "./images/bike-garage/scene-street-v4.webp",
  "./images/bike-garage/scene-skatepark-v4.webp",
  "./images/bike-garage/scene-warehouse-v4.webp",
  "./images/bike-garage/scene-rooftop-v4.webp",
  "./images/bike-garage/scene-street-v4-thumb.webp",
  "./images/bike-garage/scene-skatepark-v4-thumb.webp",
  "./images/bike-garage/scene-warehouse-v4-thumb.webp",
  "./images/bike-garage/scene-rooftop-v4-thumb.webp",
];

// 3D code is optional public content, cached after opening Bike Garage.
const BIKE_3D_ASSETS = [
  "./bike-three-model.js?v=2.14.112",
  "./vendor/three.module.min.js",
  "./vendor/three.core.min.js",
  "./vendor/OrbitControls.js",
  "./vendor/RoomEnvironment.js",
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
    const appBase = new URL("./", self.location.href);
    if (requestUrl.pathname !== appBase.pathname && requestUrl.pathname !== `${appBase.pathname}index.html`) return;
    // Serve only this release's public shell. Refresh HTML in the background;
    // the existing service-worker update flow still activates new releases.
    const network = fetch(event.request, { cache: "reload" }).then(async response => {
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put("./index.html", response.clone());
      }
      return response;
    });
    event.waitUntil(network.catch(() => {}));
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      return await cache.match("./index.html") || network;
    })());
    return;
  }

  // Versioned public assets can be reused immediately, even on a weak signal.
  // Never cache API/account data or assets outside the explicit public lists.
  const shellUrls = new Set([...APP_SHELL, ...BIKE_PHOTO_ASSETS, ...BIKE_3D_ASSETS].map(path => new URL(path, self.location.href).href));
  if (!shellUrls.has(requestUrl.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok) await cache.put(event.request, response.clone());
    return response;
  })());
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
