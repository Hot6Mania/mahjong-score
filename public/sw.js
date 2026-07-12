const CACHE_NAME = 'mahjong-score-v4';
const ASSETS = [
  '/mahjong-score/',
  '/mahjong-score/index.html',
  '/mahjong-score/riichi-stick.svg',
  '/mahjong-score/manifest.json'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
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
    }).then(() => self.clients.claim())
  );
});

// Network-First 전략: 온라인 상태에서는 언제나 서버의 최신 코드를 다운로드하고 오프라인시에만 캐시 복원
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  e.respondWith(
    fetch(e.request)
      .then((networkResponse) => {
        // 응답이 성공적이면 백그라운드 캐시 스토리지 자동 갱신
        if (networkResponse && networkResponse.status === 200) {
          const cacheCopy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, cacheCopy);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // 오프라인 상태이거나 네트워크 연결 실패 시 캐시 매칭 복원
        return caches.match(e.request);
      })
  );
});
