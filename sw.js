// 예전 일일 체크리스트 앱이 기기에 남긴 서비스 워커를 지운다.
// 그 앱을 홈 화면에 깔았던 기기가 이 주소를 다시 열면, 저장해 둔 화면을 지우고 스스로 해제한 뒤 새로 불러온다.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) await caches.delete(k);
    await self.registration.unregister();
    for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
  })());
});
