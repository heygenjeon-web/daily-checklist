// 오프라인 실행용 서비스 워커. 앱을 고치면 CACHE 이름의 숫자를 올린다.
const CACHE = 'checklist-v1';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'fonts/PretendardVariable.woff2',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// 저장해 둔 화면을 바로 보여 주고, 뒤에서 새 버전을 받아 둔다 (다음 실행 때 반영)
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(req, { ignoreSearch: true });
    const fresh = fetch(req)
      .then((res) => { if (res.ok) cache.put(req, res.clone()); return res; })
      .catch(() => cached);
    return cached || fresh;
  }));
});
