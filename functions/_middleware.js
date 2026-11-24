/**
 * Cloudflare Pages Edge Middleware
 * - knu-npm.kimk-house.party (또는 /knu-npm-2026) 요청 시 HTML 메타태그(title, description, OG, Twitter)와
 *   manifest.json을 서버(Edge) 단계에서 '2026 KNU X NPM MAHJONG TEAM LEAGUE'로 재작성합니다.
 * - 디스코드/카카오톡/슬랙 등 JS를 실행하지 않는 링크 미리보기 크롤러에서도
 *   김케이 하우스 문구가 노출되지 않도록 보장합니다.
 * - 기존 kimk-house.party 요청은 100% 원본 그대로 통과합니다.
 */

const EVENT_TITLE = '2026 KNU X NPM MAHJONG TEAM LEAGUE';
const EVENT_SHORT_TITLE = 'KNU X NPM 2026';
const EVENT_DESC =
  '2026 KNU X NPM MAHJONG TEAM LEAGUE — Live Scoreboard, Standings & 6-Round Schedule (Nov 28, 2026)';
const TEST_TITLE = '[TEST] 2026 KNU X NPM MAHJONG TEAM LEAGUE';
const TEST_DESC =
  'Test Sandbox — 2026 KNU X NPM MAHJONG TEAM LEAGUE Live Scoreboard & Standings';
const LIVE_TITLE = '[LIVE] 2026 KNU X NPM MAHJONG TEAM LEAGUE';
const LIVE_DESC =
  'Live 7-Table Projector Monitor — 2026 KNU X NPM MAHJONG TEAM LEAGUE';

function isKnuNpmRequest(url) {
  const host = (url.hostname || '').toLowerCase();
  const path = url.pathname || '';
  if (
    host === 'knu-npm.kimk-house.party' ||
    host.startsWith('knu-npm.') ||
    host.startsWith('knu-npm-')
  ) {
    return true;
  }
  if (path === '/knu-npm-2026' || path.startsWith('/knu-npm-2026/')) {
    return true;
  }
  if (url.searchParams.get('event') === 'knu-npm-2026') {
    return true;
  }
  return false;
}

function isSandboxRequest(url) {
  const path = url.pathname || '';
  return (
    path === '/test' ||
    path.startsWith('/test/') ||
    path === '/knu-npm-2026/test' ||
    path.startsWith('/knu-npm-2026/test/') ||
    url.searchParams.get('sandbox') === '1' ||
    url.searchParams.get('test') === '1'
  );
}

function escapeHtmlAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (!isKnuNpmRequest(url)) {
    return context.next();
  }

  // PWA manifest.json 동적 교체 (홈 화면 추가 / 탭 아이콘 메타에서 김케이 하우스 제거)
  if (url.pathname === '/manifest.json' || url.pathname.endsWith('/manifest.json')) {
    const manifest = {
      short_name: EVENT_SHORT_TITLE,
      name: EVENT_TITLE,
      icons: [
        { src: '/riichi-stick.svg', type: 'image/svg+xml', sizes: 'any', purpose: 'any' },
        { src: '/images/icon-192.png', type: 'image/png', sizes: '192x192' },
        { src: '/images/icon-512.png', type: 'image/png', sizes: '512x512' },
      ],
      start_url: '/',
      background_color: '#121212',
      theme_color: '#121212',
      display: 'standalone',
      orientation: 'any',
    };
    return new Response(JSON.stringify(manifest, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/manifest+json; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
    });
  }

  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    return response;
  }

  const isTest = isSandboxRequest(url);
  const isLive =
    url.pathname === '/live' ||
    url.pathname === '/test/live' ||
    url.pathname === '/knu-npm-2026/live' ||
    url.pathname === '/knu-npm-2026/test/live';
  const title = isLive
    ? isTest
      ? `[TEST LIVE] ${EVENT_TITLE}`
      : LIVE_TITLE
    : isTest
      ? TEST_TITLE
      : EVENT_TITLE;
  const description = isLive ? LIVE_DESC : isTest ? TEST_DESC : EVENT_DESC;
  const langParam = (url.searchParams.get('lang') || '').toLowerCase();
  const htmlLang = langParam === 'ja' || langParam === 'ko' ? langParam : 'en';
  const canonicalUrl = `${url.origin}${url.pathname === '/' ? '/' : url.pathname}`;
  const ogImage = `${url.origin}/images/icon-512.png`;

  const ogTags = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${escapeHtmlAttr(EVENT_TITLE)}">`,
    `<meta property="og:title" content="${escapeHtmlAttr(title)}">`,
    `<meta property="og:description" content="${escapeHtmlAttr(description)}">`,
    `<meta property="og:url" content="${escapeHtmlAttr(canonicalUrl)}">`,
    `<meta property="og:image" content="${escapeHtmlAttr(ogImage)}">`,
    `<meta name="twitter:card" content="summary">`,
    `<meta name="twitter:title" content="${escapeHtmlAttr(title)}">`,
    `<meta name="twitter:description" content="${escapeHtmlAttr(description)}">`,
  ].join('\n    ');

  if (typeof HTMLRewriter === 'undefined') {
    return response;
  }

  return new HTMLRewriter()
    .on('html', {
      element(el) {
        el.setAttribute('lang', htmlLang);
      },
    })
    .on('title', {
      element(el) {
        el.setInnerContent(title);
      },
    })
    .on('meta[name="description"]', {
      element(el) {
        el.setAttribute('content', description);
      },
    })
    .on('meta[name="author"]', {
      element(el) {
        el.setAttribute('content', EVENT_TITLE);
      },
    })
    .on('meta[name="keywords"]', {
      element(el) {
        el.setAttribute(
          'content',
          'KNU, NPM, Mahjong, Team League, Riichi Mahjong, Scoreboard, 2026, 麻雀, リーチ麻雀'
        );
      },
    })
    .on('meta[name="apple-mobile-web-app-title"]', {
      element(el) {
        el.setAttribute('content', EVENT_SHORT_TITLE);
      },
    })
    .on('link[rel="canonical"]', {
      element(el) {
        el.setAttribute('href', canonicalUrl);
      },
    })
    .on('link[rel="alternate"]', {
      element(el) {
        el.setAttribute('hreflang', htmlLang);
        el.setAttribute('href', canonicalUrl);
      },
    })
    .on('head', {
      element(el) {
        el.append(`\n    ${ogTags}\n`, { html: true });
      },
    })
    .transform(response);
}
