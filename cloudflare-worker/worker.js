/**
 * Cloudflare Worker: Google OAuth Stateless Refresh Token Proxy
 *
 * 이 워커는 구글 OAuth 2.0 Authorization Code를 받아 Access Token과 Refresh Token으로 교환하고,
 * Refresh Token을 AES-GCM-256으로 암호화하여 클라이언트에 전달함으로써
 * 별도의 데이터베이스 없이 100% 무상태(Stateless)로 백그라운드 무인 토큰 갱신을 지원합니다.
 *
 * 필수 환경 변수 (Cloudflare 대시보드 Settings -> Variables -> Secrets):
 * - GOOGLE_CLIENT_ID: 구글 OAuth 클라이언트 ID
 * - GOOGLE_CLIENT_SECRET: 구글 OAuth 클라이언트 보안 비밀
 * - ENCRYPTION_KEY: 암호화용 32자리 비밀 문자열 (예: 임의의 32자 영문/숫자)
 * - ALLOWED_ORIGIN: (선택) 허용할 프론트엔드 도메인 (기본값: *)
 */

const CORS_HEADERS = (origin) => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
});

function jsonResponse(data, status = 200, origin = "*", extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS(origin),
      ...extraHeaders,
    },
  });
}

// Web Crypto API: 문자열 키를 AES-GCM CryptoKey로 유도
async function getCryptoKey(secretKey) {
  const enc = new TextEncoder();
  const rawKey = enc.encode(secretKey.padEnd(32, "0").slice(0, 32));
  return await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

// AES-GCM-256 암호화 (IV + Ciphertext + Tag를 Base64Url로 패키징)
async function encrypt(text, secretKey) {
  const key = await getCryptoKey(secretKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const encoded = enc.encode(text);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded
  );

  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return btoa(String.fromCharCode(...combined))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// AES-GCM-256 복호화
async function decrypt(cipherB64, secretKey) {
  const key = await getCryptoKey(secretKey);

  let b64 = cipherB64.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const rawStr = atob(b64);
  const combined = new Uint8Array(rawStr.length);
  for (let i = 0; i < rawStr.length; i++) {
    combined[i] = rawStr.charCodeAt(i);
  }

  if (combined.length < 13) {
    throw new Error("Invalid cipher length");
  }

  const iv = combined.slice(0, 12);
  const data = combined.slice(12);

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    data
  );

  const dec = new TextDecoder();
  return dec.decode(decrypted);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "*";
    const allowedOrigin = env.ALLOWED_ORIGIN || "*";
    const matchedOrigin =
      allowedOrigin === "*" || allowedOrigin === origin ? origin : allowedOrigin;

    // 1. CORS Preflight 처리
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS(matchedOrigin),
      });
    }

    const url = new URL(request.url);

    // 2. Auth Code -> Tokens 교환 엔드포인트
    if (url.pathname === "/api/auth/exchange" && request.method === "POST") {
      try {
        const body = await request.json();
        const { code } = body;

        if (!code) {
          return jsonResponse({ error: "Missing 'code' parameter" }, 400, matchedOrigin);
        }

        if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.ENCRYPTION_KEY) {
          return jsonResponse(
            { error: "Server misconfigured: Missing environment secrets" },
            500,
            matchedOrigin
          );
        }

        // Google OAuth 토큰 엔드포인트 호출
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            redirect_uri: "postmessage",
            grant_type: "authorization_code",
          }),
        });

        const tokenData = await tokenRes.json();

        if (!tokenRes.ok || tokenData.error) {
          console.error("Google Token Exchange Failed:", tokenData);
          return jsonResponse(
            {
              error: tokenData.error_description || tokenData.error || "Token exchange failed",
            },
            400,
            matchedOrigin
          );
        }

        // Refresh Token 암호화
        let refreshCipher = null;
        if (tokenData.refresh_token) {
          refreshCipher = await encrypt(tokenData.refresh_token, env.ENCRYPTION_KEY);
        }

        return jsonResponse(
          {
            access_token: tokenData.access_token,
            expires_in: tokenData.expires_in,
            refresh_cipher: refreshCipher,
          },
          200,
          matchedOrigin
        );
      } catch (err) {
        console.error("Exchange Exception:", err);
        return jsonResponse({ error: err.message || "Internal server error" }, 500, matchedOrigin);
      }
    }

    // 3. Refresh Token으로 새 Access Token 발급 엔드포인트
    if (url.pathname === "/api/auth/refresh" && request.method === "POST") {
      try {
        const body = await request.json();
        const { refresh_cipher } = body;

        if (!refresh_cipher) {
          return jsonResponse({ error: "Missing 'refresh_cipher' parameter" }, 400, matchedOrigin);
        }

        if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.ENCRYPTION_KEY) {
          return jsonResponse(
            { error: "Server misconfigured: Missing environment secrets" },
            500,
            matchedOrigin
          );
        }

        // 암호화된 Refresh Token 복호화
        let refreshToken;
        try {
          refreshToken = await decrypt(refresh_cipher, env.ENCRYPTION_KEY);
        } catch (decryptErr) {
          return jsonResponse({ error: "Invalid refresh token cipher" }, 401, matchedOrigin);
        }

        // Google OAuth 토큰 갱신 호출
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            refresh_token: refreshToken,
            grant_type: "refresh_token",
          }),
        });

        const tokenData = await tokenRes.json();

        if (!tokenRes.ok || tokenData.error) {
          console.error("Google Token Refresh Failed:", tokenData);
          return jsonResponse(
            {
              error: tokenData.error_description || tokenData.error || "Token refresh failed",
            },
            401,
            matchedOrigin
          );
        }

        return jsonResponse(
          {
            access_token: tokenData.access_token,
            expires_in: tokenData.expires_in,
          },
          200,
          matchedOrigin
        );
      } catch (err) {
        console.error("Refresh Exception:", err);
        return jsonResponse({ error: err.message || "Internal server error" }, 500, matchedOrigin);
      }
    }

    // ==========================================
    // 3. 외부 공개 대시보드 API (Cloudflare Edge Cache 3분 적용)
    // 스프레드시트 ID는 하드코딩하지 않고, 서버 Secret의 암호화 토큰(ENCRYPTED_SPREADSHEET_ID)을 ENCRYPTION_KEY로 복호화하여 사용합니다.
    // ==========================================
    const CACHE_HEADERS = { "Cache-Control": "public, max-age=180, s-maxage=180" };

    async function resolveSpreadsheetId(env, url) {
      // 1) 쿼리 파라미터가 명시된 경우 (개발/테스트 호환성)
      const fromQuery = url.searchParams.get("spreadsheetId");
      if (fromQuery && fromQuery.trim()) return fromQuery.trim();

      // 2) 서버 환경변수(Secret)에 저장된 암호화 토큰 복호화
      if (env.ENCRYPTED_SPREADSHEET_ID && env.ENCRYPTION_KEY) {
        try {
          const decrypted = await decrypt(env.ENCRYPTED_SPREADSHEET_ID, env.ENCRYPTION_KEY);
          if (decrypted && decrypted.trim()) {
            return decrypted.trim();
          }
        } catch (err) {
          console.error("Failed to decrypt ENCRYPTED_SPREADSHEET_ID:", err);
        }
      }

      // 3) 서버 환경변수(Secret)에 평문 SPREADSHEET_ID가 설정된 경우
      if (env.SPREADSHEET_ID && env.SPREADSHEET_ID.trim()) {
        return env.SPREADSHEET_ID.trim();
      }

      return null;
    }

    // GET /api/public/stats : 전체 멤버별 통계 조회
    if (url.pathname === "/api/public/stats" && request.method === "GET") {
      try {
        const spreadsheetId = await resolveSpreadsheetId(env, url);
        if (!spreadsheetId) {
          return jsonResponse({ error: "Spreadsheet ID is not configured on server (ENCRYPTED_SPREADSHEET_ID required)" }, 500, matchedOrigin);
        }

        const gvizUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:json&gid=1698630951`;
        const res = await fetch(gvizUrl);
        const text = await res.text();
        const jsonStr = text.substring(text.indexOf("{"), text.lastIndexOf("}") + 1);
        const parsed = JSON.parse(jsonStr);

        return jsonResponse({ success: true, table: parsed.table }, 200, matchedOrigin, CACHE_HEADERS);
      } catch (err) {
        console.error("Public stats fetch failed:", err);
        return jsonResponse({ error: "Failed to fetch stats", details: err.message }, 500, matchedOrigin);
      }
    }

    // GET /api/public/stats-matrix : '통계' 탭(역대 회차별 매트릭스) 조회
    if (url.pathname === "/api/public/stats-matrix" && request.method === "GET") {
      try {
        const spreadsheetId = await resolveSpreadsheetId(env, url);
        if (!spreadsheetId) {
          return jsonResponse({ error: "Spreadsheet ID is not configured on server (ENCRYPTED_SPREADSHEET_ID required)" }, 500, matchedOrigin);
        }

        const sheetParam = encodeURIComponent("통계");
        const gvizUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:json&sheet=${sheetParam}`;
        const res = await fetch(gvizUrl);
        const text = await res.text();
        const jsonStr = text.substring(text.indexOf("{"), text.lastIndexOf("}") + 1);
        const parsed = JSON.parse(jsonStr);

        return jsonResponse({ success: true, table: parsed.table }, 200, matchedOrigin, CACHE_HEADERS);
      } catch (err) {
        console.error("Public stats matrix fetch failed:", err);
        return jsonResponse({ error: "Failed to fetch stats matrix", details: err.message }, 500, matchedOrigin);
      }
    }

    // GET /api/public/sessions : 회차 목록 조회
    if (url.pathname === "/api/public/sessions" && request.method === "GET") {
      try {
        const spreadsheetId = await resolveSpreadsheetId(env, url);
        if (!spreadsheetId) {
          return jsonResponse({ error: "Spreadsheet ID is not configured on server (ENCRYPTED_SPREADSHEET_ID required)" }, 500, matchedOrigin);
        }

        const editUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
        const res = await fetch(editUrl);
        const html = await res.text();
        const regex = /제\d+회\s*\d{6}/g;
        const matches = [...new Set(html.match(regex) || [])];

        // 회차 번호 내림차순 정렬
        matches.sort((a, b) => {
          const numA = parseInt(a.match(/제(\d+)회/)?.[1] || "0", 10);
          const numB = parseInt(b.match(/제(\d+)회/)?.[1] || "0", 10);
          return numB - numA;
        });

        return jsonResponse({ success: true, sessions: matches }, 200, matchedOrigin, CACHE_HEADERS);
      } catch (err) {
        console.error("Public sessions fetch failed:", err);
        return jsonResponse({ error: "Failed to fetch sessions", details: err.message }, 500, matchedOrigin);
      }
    }

    // GET /api/public/session-detail : 특정 회차 raw 데이터 조회
    if (url.pathname === "/api/public/session-detail" && request.method === "GET") {
      try {
        const spreadsheetId = await resolveSpreadsheetId(env, url);
        if (!spreadsheetId) {
          return jsonResponse({ error: "Spreadsheet ID is not configured on server (ENCRYPTED_SPREADSHEET_ID required)" }, 500, matchedOrigin);
        }

        const session = url.searchParams.get("session");
        if (!session) {
          return jsonResponse({ error: "Missing 'session' parameter" }, 400, matchedOrigin);
        }

        const match = session.match(/제(\d+)회/);
        const num = match ? parseInt(match[1], 10) : 9;
        const primarySheet = num >= 9 ? `${session} (raw)` : session;
        const secondarySheet = num >= 9 ? session : `${session} (raw)`;

        let parsed = null;
        try {
          const res = await fetch(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(primarySheet)}`);
          if (res.ok) {
            const text = await res.text();
            const start = text.indexOf("{");
            const end = text.lastIndexOf("}");
            if (start !== -1 && end !== -1) {
              const data = JSON.parse(text.substring(start, end + 1));
              if (data.table) parsed = data;
            }
          }
        } catch (e) {}

        if (!parsed) {
          const res2 = await fetch(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(secondarySheet)}`);
          const text2 = await res2.text();
          const start2 = text2.indexOf("{");
          const end2 = text2.lastIndexOf("}");
          if (start2 !== -1 && end2 !== -1) {
            parsed = JSON.parse(text2.substring(start2, end2 + 1));
          }
        }

        if (!parsed || !parsed.table) {
          return jsonResponse({ error: "Failed to parse session detail" }, 404, matchedOrigin);
        }

        return jsonResponse({ success: true, session, table: parsed.table }, 200, matchedOrigin, CACHE_HEADERS);
      } catch (err) {
        console.error("Public session detail fetch failed:", err);
        return jsonResponse({ error: "Failed to fetch session detail", details: err.message }, 500, matchedOrigin);
      }
    }

    // 기본 404
    return jsonResponse({ error: "Route not found" }, 404, matchedOrigin);
  },
};
