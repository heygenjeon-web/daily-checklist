// 앱으로 설치할 수 있게 하는 최소 서비스 워커 — 페이지 파일은 저장해 두지 않는다 (늘 최신 판을 받아 옴)
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
