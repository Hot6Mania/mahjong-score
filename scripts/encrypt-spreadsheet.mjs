#!/usr/bin/env node
/**
 * scripts/encrypt-spreadsheet.mjs
 * 
 * 스프레드시트 접근 주소(ID)를 AES-GCM-256 알고리즘과 비밀키(해시값)를 사용하여
 * 안전한 암호화 토큰으로 변환해주는 CLI 도구입니다.
 * 
 * 사용법:
 *   node scripts/encrypt-spreadsheet.mjs [스프레드시트ID] [비밀키]
 * 
 * 인자가 없을 경우 기본값으로 암호화 토큰을 생성합니다.
 */

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

export async function encrypt(text, secretKey) {
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

  return Buffer.from(combined).toString("base64url");
}

export async function decrypt(token, secretKey) {
  const key = await getCryptoKey(secretKey);
  const data = Buffer.from(token, "base64url");
  const iv = data.subarray(0, 12);
  const ciphertext = data.subarray(12);

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}

// CLI 직접 실행 시
if (process.argv[1].endsWith("encrypt-spreadsheet.mjs")) {
  (async () => {
    const spreadsheetId = process.argv[2] || "1uJeP0UUunqbMHYVN_Azl4Z1yQyWXkHWTcr8dtCP6alI";
    const secretKey = process.argv[3] || "mahjong_secret_salt_key_20260926";

    console.log("=================================================");
    console.log("  구글 스프레드시트 ID 보안 암호화 도구");
    console.log("=================================================");
    console.log(`- 원본 스프레드시트 ID: ${spreadsheetId}`);
    console.log(`- 암호화 비밀키/해시값 : ${secretKey}`);

    const token = await encrypt(spreadsheetId, secretKey);
    console.log(`\n[생성된 암호화 토큰]\n${token}\n`);

    // 검증 복호화
    const decrypted = await decrypt(token, secretKey);
    if (decrypted === spreadsheetId) {
      console.log("복호화 검증 완료: 정상 복호화 일치 (Match: OK)");
    } else {
      console.error("복호화 검증 실패: 일치하지 않음!");
      process.exit(1);
    }

    console.log("\n-------------------------------------------------");
    console.log("1. Cloudflare Worker Secret 등록 명령어 (서버용):");
    console.log(`   npx wrangler secret put ENCRYPTED_SPREADSHEET_ID`);
    console.log(`   (값으로 '${token}' 입력)`);
    console.log(`   npx wrangler secret put ENCRYPTION_KEY`);
    console.log(`   (값으로 '${secretKey}' 입력)`);
    console.log("-------------------------------------------------");
    console.log("2. 로컬 .env 설정 (클라이언트용):");
    console.log(`   VITE_ENCRYPTED_SPREADSHEET_ID=${token}`);
    console.log(`   VITE_ENCRYPTION_KEY=${secretKey}`);
    console.log("=================================================\n");
  })();
}
