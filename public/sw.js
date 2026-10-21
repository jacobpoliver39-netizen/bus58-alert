self.addEventListener("push", (event) => {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {
      title: "Bus 58 Alert",
      body: event.data ? event.data.text() : "You have a bus update.",
    };
  }

  const title = data.title || "Bus 58 Alert";

  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "Check the live bus status.",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag || "bus58-alert",
      data: { url: data.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = new URL(
    event.notification.data?.url || "/",
    self.location.origin
  ).href;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(
      (windows) => {
        for (const client of windows) {
          if (client.url.startsWith(self.location.origin) && "focus" in client) {
            return client.focus();
          }
        }

        return clients.openWindow(url);
      }
    )
  );
});
