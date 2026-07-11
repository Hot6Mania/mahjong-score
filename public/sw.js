const CACHE_NAME = 'mahjong-score-v2';
const ASSETS = [
  '/mahjong-score/',
  '/mahjong-score/index.html',
  '/mahjong-score/assets/',
  '/mahjong-score/riichi-stick.svg',
  '/mahjong-score/manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // 일부 에셋 로드 실패해도 차단하지 않도록 catch로 감쌈
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
    })
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
