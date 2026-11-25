// Service worker: notificaciones push y caché básica para abrir rápido.
const CACHE = "diario-v1";
const SHELL = ["/", "/index.html", "/styles.css", "/app.js", "/patterns.js", "/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// Red primero (para tener siempre la última versión), caché si no hay conexión. La API nunca se cachea.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("/"))),
  );
});

self.addEventListener("push", (e) => {
  let data = { title: "Diario de migraña", body: "¿Qué tal el día? Graba tu audio 🎙️", url: "/" };
  try {
    data = { ...data, ...e.data.json() };
  } catch {}
  e.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title, {
        body: data.body,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        tag: "recordatorio-diario", // cada aviso nuevo sustituye al anterior
        data: { url: data.url },
      }),
      self.navigator.setAppBadge ? self.navigator.setAppBadge(1).catch(() => {}) : null,
    ]),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if ("focus" in c) return c.focus();
      return self.clients.openWindow(e.notification.data?.url || "/");
    }),
  );
});
