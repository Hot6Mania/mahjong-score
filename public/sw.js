const CACHE_NAME = 'mahjong-score-v8';
const ASSETS = [
  '/',
  '/index.html',
  '/riichi-stick.svg',
  '/manifest.json'
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

  const url = new URL(e.request.url);
  // 외부 도메인 API(구글 Sheets API, Cloudflare Workers, Google Auth 등)는 네이티브 네트워크로 직접 위임
  if (url.origin !== self.location.origin) {
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then((networkResponse) => {
        // 응답이 성공적이면 백그라운드 캐시 스토리지 자동 갱신
        if (networkResponse && networkResponse.status === 200) {
          const contentType = networkResponse.headers.get('content-type') || '';
          // 정적 에셋(/assets/...) 요청인데 text/html 응답이 온 경우(404 SPA 리디렉트)는 캐시 오염 방지를 위해 캐시하지 않음
          const isAsset = url.pathname.startsWith('/assets/');
          if (isAsset && contentType.includes('text/html')) {
            return networkResponse;
          }
          const cacheCopy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, cacheCopy);
          });
        }
        return networkResponse;
      })
      .catch(async () => {
        // 오프라인 상태이거나 네트워크 연결 실패 시 캐시 매칭 복원
        const matched = await caches.match(e.request);
        if (matched) return matched;

        // SPA 네비게이션 요청의 경우 오프라인 fallback으로 index.html 반환
        if (e.request.mode === 'navigate') {
          const indexFallback = (await caches.match('/index.html')) || (await caches.match('/'));
          if (indexFallback) return indexFallback;
        }

        // 캐시에도 존재하지 않을 경우 안전한 Response 객체를 반환하여 TypeError 방지
        return new Response('오프라인 상태입니다.', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      })
  );
});
