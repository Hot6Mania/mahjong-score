# Cloudflare Worker Google OAuth Refresh Proxy 배포 가이드

이 워커는 구글 Access Token(1시간 만료)을 백그라운드에서 무인으로 자동 갱신할 수 있도록 Refresh Token을 안전하게 중계하는 **100% 평생 무료** 초경량 프록시입니다.

---

## 1. 사전 준비 (구글 클라우드 콘솔)

1. [Google Cloud Console 사용자 인증 정보](https://console.cloud.google.com/apis/credentials)로 이동합니다.
2. 현재 마작 기록기에서 사용 중인 OAuth 2.0 클라이언트 ID를 클릭합니다.
3. 우측의 **클라이언트 보안 비밀(Client Secret)** 값을 복사합니다.
4. **승인된 자바스크립트 원본(Authorized JavaScript origins)**에 다음이 등록되어 있는지 확인합니다:
   - `https://<깃허브-아이디>.github.io`
   - `http://localhost:5173` (로컬 테스트 시)

---

## 2. Cloudflare Worker 배포 (웹 대시보드 - 3분 소요)

1. [Cloudflare 대시보드](https://dash.cloudflare.com)에 로그인합니다 (신용카드 없이 무료 가입 가능).
2. 좌측 메뉴에서 **Compute (Workers & Pages)** ➔ **Create application** ➔ **Create Worker**를 클릭합니다.
3. 워커 이름을 지정(예: `mahjong-auth-proxy`)하고 **Deploy**를 클릭합니다.
4. 배포 완료 후 **Edit code**를 클릭하고, 이 폴더의 `worker.js` 코드 전체를 복사하여 에디터에 붙여넣은 뒤 **Deploy**를 누릅니다.
5. 상단 탭에서 **Settings** ➔ **Variables and Secrets**로 이동하여 다음 3개의 암호화 변수(**Secret**)를 추가합니다:
   - `GOOGLE_CLIENT_ID`: 사용 중인 구글 클라이언트 ID (`1089115695270-...apps.googleusercontent.com`)
   - `GOOGLE_CLIENT_SECRET`: 1단계에서 복사한 구글 클라이언트 보안 비밀
   - `ENCRYPTION_KEY`: 32자리 임의 문자열 (예: 영문과 숫자를 섞은 32자 무작위 비밀키)
   - `ALLOWED_ORIGIN`: (선택 사항) 특정 깃허브 주소만 허용하려면 입력 (미입력 시 `*`)
6. 상단에 표시되는 워커 주소(`https://mahjong-auth-proxy.xxxx.workers.dev`)를 복사합니다.

---

## 3. 마작 점수 기록기 앱에 등록

1. 마작 점수 기록기 웹앱을 엽니다.
2. 상단 메뉴의 **[설정]**(톱니바퀴) ➔ **[구글 계정 및 연동 설정]**으로 이동합니다.
3. **[인증 프록시(Worker) 주소]** 입력란에 복사한 주소를 붙여넣고 저장합니다.
4. **[구글 로그인]**을 1회 진행합니다.
5. 이제 앱이 켜져 있는 동안 45분마다 백그라운드에서 토큰이 자동 갱신되며, 브라우저를 껐다 켜도 팝업 없이 영구적으로 세션이 유지됩니다!
