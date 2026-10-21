/* Service worker deliberadamente sin caché: las rutas y respuestas del CRM
   contienen datos privados y nunca se guardan para uso offline. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  event.waitUntil(
    (async () => {
      // Una suscripción explícita significa que el usuario pidió avisos del
      // sistema. No descartarlos por tener una pestaña abierta: Safari puede
      // mantener una ventana visible aunque la PWA no esté al frente.
      await self.registration.showNotification(
        typeof payload.title === "string" ? payload.title : "Nuevo mensaje",
        {
          body:
            typeof payload.body === "string"
              ? payload.body
              : "Tienes un mensaje nuevo en tu bandeja.",
          icon: "/icon",
          badge: "/icon",
          tag: "vocero-new-message",
          renotify: true,
          data: { path: "/inbox" },
        }
      );
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL("/inbox", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const sameOrigin = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (sameOrigin && "navigate" in sameOrigin) {
        return sameOrigin.navigate(target).then(() => sameOrigin.focus());
      }
      return self.clients.openWindow(target);
    })
  );
});
