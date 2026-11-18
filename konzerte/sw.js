/* Konzerte in der großen Stadt – Service Worker nur für Mitteilungen (kein Offline-Speicher). */
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener("push", function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { titel: "Konzerte", text: e.data ? e.data.text() : "" }; }
  e.waitUntil(
    self.registration.showNotification(d.titel || "Konzerte", {
      body: d.text || "", tag: d.tag || undefined, icon: "icon-180.png", badge: "icon-180.png",
      data: { url: d.url || "/konzerte/" }
    }).then(function () {
      // Rote Zahl am Symbol = Anzahl ungelesener Mitteilungen
      return self.registration.getNotifications().then(function (n) {
        if (self.navigator && self.navigator.setAppBadge) return self.navigator.setAppBadge(n.length);
      });
    }).catch(function () {})
  );
});

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || "/konzerte/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) { if ("focus" in list[i]) return list[i].focus(); }
    return self.clients.openWindow(url);
  }));
});
