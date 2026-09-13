self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = { title: "Two of Us", body: "A chore needs attention.", url: "/app" };
  try { payload = { ...payload, ...(event.data ? event.data.json() : {}) }; } catch { /* Ignore malformed push payloads. */ }
  event.waitUntil(self.registration.showNotification(payload.title, { body: payload.body, icon: "/icon-192.png", badge: "/icon-192.png", tag: payload.tag || "two-of-us", data: { url: payload.url } }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/app", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => client.url.startsWith(self.location.origin));
    return existing ? existing.focus().then(() => existing.navigate(target)) : self.clients.openWindow(target);
  }));
});
