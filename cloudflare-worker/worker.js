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
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
});

function jsonResponse(data, status = 200, origin = "*") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS(origin),
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

    // 기본 404
    return jsonResponse({ error: "Route not found" }, 404, matchedOrigin);
  },
};
