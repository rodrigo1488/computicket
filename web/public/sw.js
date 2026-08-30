self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Computicket", message: event.data?.text() || "Nova notificação" };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || "Computicket", {
      body: payload.message || "Você recebeu uma nova notificação.",
      tag: payload.entity_type && payload.entity_id
        ? `${payload.entity_type}-${payload.entity_id}`
        : `notification-${payload.id || Date.now()}`,
      data: { url: payload.url || "/" },
      badge: "/favicon.ico",
      vibrate: [160, 80, 160],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return clients.openWindow ? clients.openWindow(target) : undefined;
    }),
  );
});
