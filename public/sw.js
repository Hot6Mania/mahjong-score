const CACHE_NAME = 'mahjong-score-v3';
const ASSETS = [
  '/mahjong-score/',
  '/mahjong-score/index.html',
  '/mahjong-score/riichi-stick.svg',
  '/mahjong-score/manifest.json'
];

self.addEventListener('install', (e) => {
  self.skipWaiting(); // 새 서비스 워커 설치 즉시 활성화 유도
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(ASSETS.map(asset => cache.add(asset)));
    })
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim()) // 새 활성 서비스 워커가 즉시 제어권 획득
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((res) => {
      return res || fetch(e.request).catch(() => {
        // 네트워크 실패 시 로컬 캐시로 fallback
      });
    })
  );
});
