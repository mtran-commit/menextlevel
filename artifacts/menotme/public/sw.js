self.addEventListener("push", (event) => {
  let data = { title: "Me Next Level", body: "" };
  try {
    data = event.data.json();
  } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(data.title || "Me Next Level", {
      body: data.body || "",
      icon: undefined,
      badge: undefined,
      tag: data.type || "menextlevel",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) return c.focus();
      }
      return clients.openWindow("/");
    }),
  );
});
