self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Computicket", message: event.data?.text() || "Nova notificação" };
  }

  event.waitUntil(
    (async () => {
      const targetUrl = payload.url || "/";
      if (await isInternalChatFocused(targetUrl)) {
        const silent = await self.registration.showNotification(payload.title || "Computicket", {
          silent: true,
          tag: "ic-focused-skip",
          data: { url: targetUrl },
        });
        const notes = await self.registration.getNotifications({ tag: "ic-focused-skip" });
        notes.forEach((n) => n.close());
        return silent;
      }

      const internal = payload.type === "internal_chat" || payload.entity_type === "internal_chat";
      const pending = payload.type === "helpdesk_pending";
      return self.registration.showNotification(payload.title || "Computicket", {
        body: payload.message || "Você recebeu uma nova notificação.",
        tag:
          payload.entity_type && payload.entity_id
            ? `${payload.entity_type}-${payload.entity_id}`
            : `notification-${payload.id || Date.now()}`,
        data: { url: targetUrl },
        badge: "/favicon.ico",
        vibrate: internal ? [80, 60, 80, 60, 120] : pending ? [220, 80, 120, 80, 220] : [160, 80, 160],
      });
    })(),
  );
});

function chatIdFromUrl(url) {
  try {
    const parsed = new URL(url, self.location.origin);
    if (!parsed.pathname.startsWith("/chat")) return null;
    const id = Number(parsed.searchParams.get("c"));
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

async function isInternalChatFocused(targetUrl) {
  const chatId = chatIdFromUrl(targetUrl);
  if (chatId == null) return false;
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  return windows.some((client) => client.focused && chatIdFromUrl(client.url) === chatId);
}

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
