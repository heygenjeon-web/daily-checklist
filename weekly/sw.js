// 알림만 받는 서비스 워커 — 페이지 파일은 저장해 두지 않는다 (늘 최신 판을 받아 옴)
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

// 알림 서버(push-worker)가 보낸 { title, body, tag, url }
self.addEventListener("push", e => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch (err) { m = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(m.title || "주간 체크", {
    body: m.body || "", tag: m.tag || undefined, icon: "icon-192.png", badge: "icon-192.png",
    data: { url: m.url || self.registration.scope },
  }));
});

// 알림을 누르면 열려 있는 체크리스트로, 없으면 새로 연다
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    const w = list.find(c => c.url.startsWith(self.registration.scope));
    return w ? w.focus() : self.clients.openWindow(url);
  }));
});
