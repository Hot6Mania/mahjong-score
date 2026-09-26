/**
 * Public Stats Service: 비로그인 외부 관전자/모임원용 통계 및 회차 결과 조회 서비스
 * Cloudflare Worker 엣지 캐시(3분)를 우선 호출하고, 미설정 또는 장애 시 Google GViz 공용 API로 자동 폴백합니다.
 * 스프레드시트 접근 주소(ID)는 하드코딩하지 않고, 서버 Secret 및 .env 암호화 토큰을 통해 복호화하여 사용합니다.
 */

// 기본 내장 암호화 토큰 (평문 ID는 노출되지 않으며, 서버 Secret 미설정 시에도 안전하게 복호화되어 무설정 즉시 작동)
const DEFAULT_ENCRYPTED_SPREADSHEET_ID = "am68XR1EK7z5R3BSAraD8QDkpTbgpvlnHrxdbQUJTI94QQfRZYzF6T5Ygv8m2z2RXsxDqHQxY-8GwcTEeS-mTQXZC_il30MV";
const DEFAULT_ENCRYPTION_KEY = "mahjong_secret_salt_key_20260926";

// 클라이언트 캐시된 스프레드시트 ID (복호화 결과)
let resolvedClientSpreadsheetId: string | null = null;

/**
 * 환경 변수(VITE_ENCRYPTED_SPREADSHEET_ID + VITE_ENCRYPTION_KEY 또는 VITE_SPREADSHEET_ID)에서
 * 스프레드시트 ID를 안전하게 복호화/해석합니다. (하드코딩 방지 및 무설정 즉시 작동 보장)
 */
export async function resolveSpreadsheetId(): Promise<string> {
  if (resolvedClientSpreadsheetId) return resolvedClientSpreadsheetId;

  // 1. .env에 평문 VITE_SPREADSHEET_ID가 설정되어 있는 경우
  const plain = (import.meta as any).env?.VITE_SPREADSHEET_ID;
  if (plain && String(plain).trim()) {
    resolvedClientSpreadsheetId = String(plain).trim();
    return resolvedClientSpreadsheetId;
  }

  // 2. 암호화된 토큰 복호화 (.env 설정 우선, 미설정 시 기본 내장 암호화 토큰 사용)
  const encToken = (import.meta as any).env?.VITE_ENCRYPTED_SPREADSHEET_ID || DEFAULT_ENCRYPTED_SPREADSHEET_ID;
  const encKey = (import.meta as any).env?.VITE_ENCRYPTION_KEY || DEFAULT_ENCRYPTION_KEY;

  if (encToken && encKey) {
    try {
      const rawKey = new TextEncoder().encode(String(encKey).padEnd(32, "0").slice(0, 32));
      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        rawKey,
        { name: "AES-GCM" },
        false,
        ["decrypt"]
      );

      // Base64URL 디코딩 (브라우저 표준 atob 활용)
      const base64 = String(encToken).replace(/-/g, "+").replace(/_/g, "/");
      const binaryStr = atob(base64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      const iv = bytes.subarray(0, 12);
      const ciphertext = bytes.subarray(12);

      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        cryptoKey,
        ciphertext
      );

      const id = new TextDecoder().decode(decrypted);
      if (id && id.trim()) {
        resolvedClientSpreadsheetId = id.trim();
        return resolvedClientSpreadsheetId;
      }
    } catch (e) {
      console.warn("Failed to decrypt VITE_ENCRYPTED_SPREADSHEET_ID on client:", e);
    }
  }

  return "";
}

export const STATS_GID = 1698630951; // '전체 멤버별 통계'

export interface MemberStatItem {
  name: string;
  totalUma: number; // '통계' 시트 총합
  avgUma: number;   // totalUma / totalGames
  avgRank: number;  // 전 회차 순위 평균
  totalGames: number; // 전 회차 출전 총 대국수
  totalRounds: number;
  winRate: number; // 0 ~ 100 (%)
  dealInRate: number; // 0 ~ 100 (%)
  riichiRate: number; // 0 ~ 100 (%)
  tenpaiRate: number; // 0 ~ 100 (%)
  avgWinScore: number;
  avgDealInScore: number;
  handEV: number; // 국수지
  winEfficiency: number; // 화료 효율
  dealInLoss: number; // 방총 손실
  netWinEfficiency: number; // 알짜 화료 효율
  tsumoRate: number; // 0 ~ 100 (%)
  drawRate: number; // 유국율
  drawTenpaiRate: number; // 유국 텐파이율
  tobiRate: number; // 들통율
  riichiWinRate: number;
  riichiDealInRate: number;
  riichiDrawRate: number;
  riichiEV: number;
  riichiIncomeAvg: number;
  riichiExpenseAvg: number;
  firstRiichiRate: number; // 선제율
  chaseRiichiRate: number; // 추격률
  chasedRiichiRate: number; // 피추격률
  oyaKaburiRate: number;
  oyaKaburiAvg: number;
  dealInRiichiRate: number;
  totalScore: number;
  rank1Count: number;
  rank2Count: number;
  rank3Count: number;
  rank4Count: number;
  top2Rate: number; // 연대율 (%)
  detailedStats?: MemberStatItem; // 9회차 이후 순수 상세 통계 (레거시 제외)
}

export interface SessionMemberSummary {
  name: string;
  totalUma: number;
  avgRank: number;
  totalGames: number;
  deltaScore: number;
}

export interface SessionGamePlayer {
  seat: string;
  name: string;
  rank: number;
  score: number;
  uma: number;
}

export interface SessionGame {
  gameIndex: number;
  gameId: string;
  time: string;
  players: SessionGamePlayer[];
}

export interface SessionDetail {
  sessionName: string;
  members: SessionMemberSummary[];
  games: SessionGame[];
}

// 헬퍼: Worker 주소 가져오기
function getWorkerUrl(): string {
  const envWorkerUrl = import.meta.env.VITE_GOOGLE_AUTH_WORKER_URL;
  if (envWorkerUrl) return envWorkerUrl.trim().replace(/\/+$/, '');
  const saved = localStorage.getItem("google_auth_worker_url");
  return saved ? saved.trim().replace(/\/+$/, '') : '';
}

// 헬퍼: GViz 응답 문자열 파싱
function parseGVizResponse(text: string): any {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error("Invalid GViz response format");
  }
  return JSON.parse(text.substring(start, end + 1));
}

// 헬퍼: 셀 값 안전 추출
function getCellNum(cell: any, defaultVal: number = 0): number {
  if (!cell) return defaultVal;
  const v = cell.v !== undefined && cell.v !== null ? cell.v : cell.f;
  const num = Number(v);
  return isNaN(num) ? defaultVal : num;
}

function getCellStr(cell: any, defaultVal: string = ""): string {
  if (!cell) return defaultVal;
  const v = cell.v !== undefined && cell.v !== null ? cell.v : cell.f;
  return v !== undefined && v !== null ? String(v) : defaultVal;
}


// ==========================================
// 1~8회차 레거시 통합기록 데이터 (총 111개 대국 전수 내장)
// ==========================================
export const LEGACY_CONSOLIDATED_RAW = `제1회 260411\t1회전\t히스곤\t44900\t54.9\t김케이\t39000\t19\t치즈나베\t17800\t-22.2\t쑥갓\t-1700\t-51.7
제1회 260411\t2회전\t김케이\t66800\t76.8\tDoubleBun\t28500\t8.5\t치즈나베\t13400\t-26.6\t히스곤\t-8700\t-58.7
제1회 260411\t3회전\tDoubleBun\t35700\t45.7\t쑥갓\t24600\t4.6\t치즈나베\t20700\t-19.3\t김케이\t19000\t-31
제1회 260411\t4회전\t히스곤\t39400\t49.4\t치즈나베\t33100\t13.1\t쑥갓\t14100\t-25.9\tDoubleBun\t13400\t-36.6
제1회 260411\t5회전\t히스곤\t37900\t47.9\t김케이\t25600\t5.6\tDoubleBun\t25300\t-14.7\t치즈나베\t11200\t-38.8
제1회 260411\t6회전\t김케이\t40800\t50.8\t치즈나베\t33400\t13.4\tDoubleBun\t21100\t-18.9\t히스곤\t4700\t-45.3
제2회 260421\t1회전\t치즈나베\t37400\t47.4\tYoha.\t36300\t16.3\t김케이\t29600\t-10.4\t강남한\t-3300\t-53.3
제2회 260421\t2회전\t김케이\t38100\t48.1\t강남한\t27400\t7.4\t치즈나베\t25100\t-14.9\tYoha.\t9400\t-40.6
제2회 260421\t3회전\t김케이\t32000\t42\t강남한\t30900\t10.9\tYoha.\t20600\t-19.4\t치즈나베\t16500\t-33.5
제2회 260421\t4회전\t김케이\t34000\t44\t마카롱\t32300\t12.3\t강남한\t29800\t-10.2\tYoha.\t3900\t-46.1
제2회 260421\t5회전\t김케이\t53300\t63.3\t강남한\t27000\t7\tJJH25\t19900\t-20.1\t마카롱\t-200\t-50.2
제2회 260421\t6회전\t강남한\t49000\t59\tJJH25\t31700\t11.7\t치즈나베\t11900\t-28.1\t김케이\t7400\t-42.6
제2회 260421\t7회전\t강남한\t43900\t53.9\t치즈나베\t39000\t19\tJJH25\t12900\t-27.1\t마카롱\t4200\t-45.8
제2회 260421\t8회전\t치즈나베\t70300\t80.3\t강남한\t15400\t-4.6\t마카롱\t15300\t-24.7\t김케이\t-1000\t-51
제2회 260421\t9회전\t김케이\t38000\t48\tJJH25\t36200\t16.2\t강남한\t23400\t-16.6\tYoha.\t2400\t-47.6
제2회 260421\t10회전\t마카롱\t40200\t50.2\t김케이\t22800\t2.8\t강남한\t21900\t-18.1\tYoha.\t15100\t-34.9
제2회 260421\t11회전\t강남한\t69200\t79.2\t김케이\t13500\t-6.5\tJJH25\t13200\t-26.8\t치즈나베\t4100\t-45.9
제2회 260421\t12회전\tYoha.\t49900\t59.9\t김케이\t42800\t22.8\t치즈나베\t4400\t-35.6\t강남한\t2900\t-47.1
제2회 260421\t13회전\t김케이\t48700\t58.7\t치즈나베\t27100\t7.1\t강남한\t19300\t-20.7\tYoha.\t4900\t-45.1
제2회 260421\t14회전\t치즈나베\t35300\t45.3\t강남한\t25400\t5.4\t김케이\t21600\t-18.4\tYoha.\t17700\t-32.3
제3회 260504\t1회전\t김케이\t58900\t68.9\tTeNew\t23400\t3.4\t신시\t16300\t-23.7\t치즈나베\t1400\t-48.6
제3회 260504\t2회전\t말저\t42700\t52.7\t김케이\t30100\t10.1\t신시\t19700\t-20.3\tTeNew\t7500\t-42.5
제3회 260504\t3회전\t말저\t50900\t60.9\t치즈나베\t18500\t-1.5\t김케이\t16600\t-23.4\t신시\t14000\t-36
제3회 260504\t4회전\t치즈나베\t75100\t85.1\tTeNew\t19000\t-1\t말저\t9100\t-30.9\t김케이\t-3200\t-53.2
제3회 260504\t5회전\t신시\t49500\t59.5\tTeNew\t26200\t6.2\t치즈나베\t16400\t-23.6\t말저\t7900\t-42.1
제3회 260504\t6회전\t김케이\t55800\t65.8\t말저\t25900\t5.9\t신시\t12500\t-27.5\tTeNew\t5800\t-44.2
제3회 260504\t7회전\t치즈나베\t52100\t62.1\t김케이\t27100\t7.1\tTeNew\t25200\t-14.8\t신시\t-4400\t-54.4
제3회 260504\t8회전\t치즈나베\t59400\t69.4\t말저\t24700\t4.7\tTeNew\t13400\t-26.6\t김케이\t2500\t-47.5
제3회 260504\t9회전\t치즈나베\t35300\t45.3\tTeNew\t29900\t9.9\t신시\t19400\t-20.6\t김케이\t15400\t-34.6
제4회 260510\t1회전\t부진창깡곤곤래\t38700\t48.7\t치즈나베\t30900\t10.9\tstone_ant\t27700\t-12.3\t김케이\t2700\t-47.3
제4회 260510\t2회전\tstone_ant\t40500\t50.5\t_lime\t31500\t11.5\t김케이\t16600\t-23.4\t부진창깡곤곤래\t11400\t-38.6
제4회 260510\t3회전\t김케이\t39000\t49\t_lime\t30500\t10.5\t치즈나베\t24200\t-15.8\tstone_ant\t6300\t-43.7
제4회 260510\t4회전\t_lime\t37500\t47.5\t김케이\t31600\t11.6\t치즈나베\t23800\t-16.2\t부진창깡곤곤래\t7100\t-42.9
제4회 260510\t5회전\tstone_ant\t36700\t46.7\t부진창깡곤곤래\t30600\t10.6\t_lime\t29500\t-10.5\t김케이\t3200\t-46.8
제4회 260510\t6회전\t부진창깡곤곤래\t47300\t57.3\t치즈나베\t31600\t11.6\tstone_ant\t22200\t-17.8\t_lime\t-1100\t-51.1
제4회 260510\t7회전\t부진창깡곤곤래\t34500\t44.5\t치즈나베\t26900\t6.9\tstone_ant\t22500\t-17.5\t김케이\t16100\t-33.9
제4회 260510\t8회전\t부진창깡곤곤래\t30100\t40.1\t_lime\t25500\t5.5\tstone_ant\t22300\t-17.7\t김케이\t22100\t-27.9
제4회 260510\t9회전\tstone_ant\t44700\t54.7\t_lime\t30700\t10.7\t부진창깡곤곤래\t20800\t-19.2\t치즈나베\t3800\t-46.2
제4회 260510\t10회전\t부진창깡곤곤래\t37100\t47.1\t김케이\t29800\t9.8\t_lime\t17400\t-22.6\tstone_ant\t15700\t-34.3
제4회 260510\t11회전\t치즈나베\t51500\t61.5\t부진창깡곤곤래\t30100\t10.1\t김케이\t13400\t-26.6\t_lime\t5000\t-45
제4회 260510\t12회전\tstone_ant\t51200\t61.2\t치즈나베\t31600\t11.6\t부진창깡곤곤래\t15300\t-24.7\t김케이\t1900\t-48.1
제4회 260510\t13회전\t김케이\t61600\t71.6\tstone_ant\t25900\t5.9\t부진창깡곤곤래\t13100\t-26.9\t_lime\t-600\t-50.6
제4회 260510\t14회전\t부진창깡곤곤래\t61500\t71.5\t_lime\t33700\t13.7\t김케이\t6400\t-33.6\tstone_ant\t-1600\t-51.6
제4회 260510\t15회전\t김케이\t69400\t79.4\tstone_ant\t14200\t-5.8\t_lime\t10400\t-29.6\t부진창깡곤곤래\t6000\t-44
제4회 260510\t16회전\t치즈나베\t46600\t56.6\t_lime\t46200\t26.2\t김케이\t13900\t-26.1\t부진창깡곤곤래\t-6700\t-56.7
제4회 260510\t17회전\t김케이\t64300\t74.3\t치즈나베\t17400\t-2.6\t_lime\t12000\t-28\t부진창깡곤곤래\t6300\t-43.7
제4회 260510\t18회전\t치즈나베\t50000\t60\t_lime\t22500\t2.5\t부진창깡곤곤래\t14900\t-25.1\t김케이\t12600\t-37.4
제4회 260510\t19회전\t치즈나베\t58400\t68.4\t_lime\t40400\t20.4\t부진창깡곤곤래\t1700\t-38.3\t김케이\t-500\t-50.5
제4회 260510\t20회전\t김케이\t33700\t43.7\t부진창깡곤곤래\t28600\t8.6\t_lime\t20400\t-19.6\t치즈나베\t17300\t-32.7
제5회 260516\t1회전\tstone_ant\t36100\t46.1\t치즈나베\t35900\t15.9\tpunch\t31000\t-9\t김케이\t-3000\t-53
제5회 260516\t2회전\t치즈나베\t51400\t61.4\t크라딜\t25500\t5.5\tstone_ant\t13100\t-26.9\tpunch\t10000\t-40
제5회 260516\t3회전\t김케이\t58900\t68.9\t크라딜\t21000\t1\tstone_ant\t20800\t-19.2\t치즈나베\t-700\t-50.7
제5회 260516\t4회전\tpunch\t47400\t57.4\t크라딜\t42200\t22.2\tstone_ant\t6500\t-33.5\t김케이\t3900\t-46.1
제5회 260516\t5회전\t크라딜\t43100\t53.1\t김케이\t20400\t0.4\tpunch\t20000\t-20\tstone_ant\t16500\t-33.5
제5회 260516\t6회전\t김케이\t47700\t57.7\t크라딜\t38500\t18.5\tpunch\t16000\t-24\t치즈나베\t-2200\t-52.2
제5회 260516\t7회전\tpunch\t47800\t57.8\t크라딜\t32300\t12.3\t김케이\t15600\t-24.4\tstone_ant\t4300\t-45.7
제5회 260516\t8회전\tpunch\t34100\t44.1\t김케이\t33100\t13.1\t치즈나베\t22800\t-17.2\t크라딜\t10000\t-40
제5회 260516\t9회전\t크라딜\t45900\t55.9\tpunch\t23800\t3.8\tstone_ant\t15900\t-24.1\t김케이\t14400\t-35.6
제5회 260516\t10회전\tstone_ant\t49900\t59.9\t치즈나베\t32900\t12.9\t크라딜\t10300\t-29.7\tpunch\t6900\t-43.1
제5회 260516\t11회전\t김케이\t36800\t46.8\tpunch\t34500\t14.5\t크라딜\t29700\t-10.3\tstone_ant\t-1000\t-51
제6회 260530\t1회전\t물감비\t42700\t52.7\tstone_ant\t32700\t12.7\t김케이\t27700\t-12.3\tckckdud\t-3100\t-53.1
제6회 260530\t2회전\t물감비\t29500\t39.5\tstone_ant\t27700\t7.7\tckckdud\t23300\t-16.7\t김케이\t19500\t-30.5
제6회 260530\t3회전\tckckdud\t33700\t43.7\t물감비\t28500\t8.5\t김케이\t21100\t-18.9\tstone_ant\t16700\t-33.3
제6회 260530\t4회전\t김케이\t48000\t58\t부진창깡곤곤래\t42600\t22.6\tckckdud\t10800\t-29.2\tstone_ant\t-1400\t-51.4
제6회 260530\t5회전\tstone_ant\t36000\t46\t부진창깡곤곤래\t29200\t9.2\tckckdud\t18100\t-21.9\t김케이\t16700\t-33.3
제6회 260530\t6회전\tckckdud\t42200\t52.2\t부진창깡곤곤래\t37900\t17.9\t물감비\t12700\t-27.3\tstone_ant\t7200\t-42.8
제6회 260530\t7회전\t김케이\t59300\t69.3\t물감비\t26000\t6\tstone_ant\t25200\t-14.8\t부진창깡곤곤래\t-10500\t-60.5
제6회 260530\t8회전\t물감비\t45500\t55.5\tckckdud\t21000\t1\t김케이\t17700\t-22.3\tstone_ant\t15800\t-34.2
제6회 260530\t9회전\t김케이\t41900\t51.9\t부진창깡곤곤래\t29700\t9.7\t물감비\t17100\t-22.9\tstone_ant\t11300\t-38.7
제6회 260530\t10회전\tstone_ant\t48900\t58.9\t물감비\t28800\t8.8\t김케이\t26100\t-13.9\t부진창깡곤곤래\t-3800\t-53.8
제6회 260530\t11회전\tstone_ant\t33000\t43\t김케이\t31900\t11.9\t부진창깡곤곤래\t22700\t-17.3\t물감비\t12400\t-37.6
제6회 260530\t12회전\t부진창깡곤곤래\t37000\t47\tstone_ant\t30700\t10.7\t김케이\t21900\t-18.1\t물감비\t10400\t-39.6
제6회 260530\t13회전\tstone_ant\t47000\t57\t물감비\t29000\t9\t부진창깡곤곤래\t26700\t-13.3\t김케이\t-2700\t-52.7
제6회 260530\t14회전\tstone_ant\t32400\t42.4\t김케이\t32200\t12.2\t부진창깡곤곤래\t18300\t-21.7\t물감비\t17100\t-32.9
제6회 260530\t15회전\tstone_ant\t59000\t69\t부진창깡곤곤래\t31600\t11.6\t물감비\t6100\t-33.9\t김케이\t3300\t-46.7
제6회 260530\t16회전\t부진창깡곤곤래\t36400\t46.4\t김케이\t28200\t8.2\tstone_ant\t26000\t-14\t물감비\t9400\t-40.6
제6회 260530\t17회전\tstone_ant\t32000\t42\t김케이\t30800\t10.8\t부진창깡곤곤래\t25700\t-14.3\t물감비\t11500\t-38.5
제6회 260530\t18회전\t김케이\t40500\t50.5\t물감비\t37700\t17.7\tstone_ant\t15300\t-24.7\t부진창깡곤곤래\t6500\t-43.5
제7회 260603\t1회전\t치즈나베\t40100\t50.1\tstone_ant\t36200\t16.2\t김케이\t17900\t-22.1\t얼룩무늬민달팽이\t5800\t-44.2
제7회 260603\t2회전\tSHM\t46600\t56.6\tstone_ant\t26400\t6.4\t김케이\t20600\t-19.4\t치즈나베\t6400\t-43.6
제7회 260603\t3회전\tstone_ant\t54600\t64.6\t김케이\t23000\t3\tSHM\t11300\t-28.7\t얼룩무늬민달팽이\t11100\t-38.9
제7회 260603\t4회전\t김케이\t37300\t47.3\tSHM\t26200\t6.2\tstone_ant\t19100\t-20.9\t치즈나베\t17400\t-32.6
제7회 260603\t5회전\tSHM\t33700\t43.7\tstone_ant\t28100\t8.1\t김케이\t22700\t-17.3\t얼룩무늬민달팽이\t15500\t-34.5
제7회 260603\t6회전\t김케이\t63000\t73\t치즈나베\t23100\t3.1\tstone_ant\t15000\t-25\tSHM\t-1100\t-51.1
제7회 260603\t7회전\t김케이\t38500\t48.5\tstone_ant\t31600\t11.6\t치즈나베\t19300\t-20.7\t얼룩무늬민달팽이\t10600\t-39.4
제7회 260603\t8회전\t얼룩무늬민달팽이\t39500\t49.5\t김케이\t36500\t16.5\tstone_ant\t25200\t-14.8\tSHM\t-1200\t-51.2
제7회 260603\t9회전\t김케이\t73000\t83\tstone_ant\t25100\t5.1\t치즈나베\t24900\t-15.1\t얼룩무늬민달팽이\t-23000\t-73
제7회 260603\t10회전\t얼룩무늬민달팽이\t35500\t45.5\t치즈나베\t30800\t10.8\tSHM\t30000\t-10\t김케이\t3700\t-46.3
제7회 260603\t11회전\t김케이\t42000\t52\t치즈나베\t41800\t21.8\tSHM\t12400\t-27.6\tstone_ant\t3800\t-46.2
제7회 260603\t12회전\tSHM\t50500\t60.5\t김케이\t34800\t14.8\tstone_ant\t15500\t-24.5\t치즈나베\t-800\t-50.8
제8회 260614\t1회전\t물감비\t37500\t47.5\t치즈나베\t28000\t8\t김케이\t17300\t-22.7\tstone_ant\t17200\t-32.8
제8회 260614\t2회전\t김케이\t39900\t49.9\t물감비\t37000\t17\tstone_ant\t25100\t-14.9\t치즈나베\t-2000\t-52
제8회 260614\t3회전\t치즈나베\t31500\t41.5\tstone_ant\t31300\t11.3\t물감비\t30700\t-9.3\t김케이\t6500\t-43.5
제8회 260614\t4회전\t김케이\t45700\t55.7\tstone_ant\t31400\t11.4\t치즈나베\t15400\t-24.6\t물감비\t7500\t-42.5
제8회 260614\t5회전\t김케이\t49300\t59.3\t치즈나베\t41500\t21.5\t물감비\t12100\t-27.9\tstone_ant\t-2900\t-52.9
제8회 260614\t6회전\tstone_ant\t38800\t48.8\t물감비\t36200\t16.2\t김케이\t18600\t-21.4\t치즈나베\t6400\t-43.6
제8회 260614\t7회전\t물감비\t38900\t48.9\t치즈나베\t35500\t15.5\t김케이\t20000\t-20\tstone_ant\t5600\t-44.4
제8회 260614\t8회전\t물감비\t56100\t66.1\tstone_ant\t36500\t16.5\t치즈나베\t9200\t-30.8\t김케이\t-1800\t-51.8
제8회 260614\t9회전\t물감비\t53500\t63.5\t김케이\t20700\t0.7\t치즈나베\t13600\t-26.4\tstone_ant\t12200\t-37.8
제8회 260614\t10회전\t치즈나베\t54300\t64.3\t김케이\t24500\t4.5\t물감비\t14800\t-25.2\tstone_ant\t6400\t-43.6
제8회 260614\t11회전\tstone_ant\t41800\t51.8\t치킨미트\t33200\t13.2\t치즈나베\t19700\t-20.3\t김케이\t5300\t-44.7
제8회 260614\t12회전\t김케이\t43000\t53\tstone_ant\t32000\t12\t치킨미트\t20500\t-19.5\t치즈나베\t4500\t-45.5
제8회 260614\t13회전\tstone_ant\t45600\t55.6\t치킨미트\t33800\t13.8\t김케이\t18200\t-21.8\t치즈나베\t2400\t-47.6
제8회 260614\t14회전\t치킨미트\t30300\t40.3\tstone_ant\t26200\t6.2\t치즈나베\t22000\t-18\t김케이\t21500\t-28.5
제8회 260614\t15회전\tstone_ant\t42500\t52.5\t치킨미트\t33700\t13.7\t김케이\t28500\t-11.5\t치즈나베\t-4700\t-54.7
제8회 260614\t16회전\t김케이\t41700\t51.7\t치즈나베\t26400\t6.4\t치킨미트\t20100\t-19.9\tstone_ant\t11800\t-38.2
제8회 260614\t17회전\t치즈나베\t51000\t61\t치킨미트\t38200\t18.2\t김케이\t18300\t-21.7\tstone_ant\t-7500\t-57.5`;

/**
 * 1~8회차 내장 대국 데이터 파싱
 */
export function getLegacyConsolidatedSessionDetail(sessionName: string): SessionDetail | null {
  const lines = LEGACY_CONSOLIDATED_RAW.trim().split("\n");
  const filtered = lines.filter(l => l.startsWith(sessionName));
  if (filtered.length === 0) return null;

  const games: SessionGame[] = [];
  const memberMap: Record<string, { totalUma: number; rankSum: number; gamesCount: number; scoresSum: number }> = {};
  const seats = ["東", "南", "西", "北"];

  filtered.forEach((line, gIdx) => {
    const parts = line.split("\t");
    if (parts.length < 14) return;
    const gameLabel = parts[1].trim();

    const pList: SessionGamePlayer[] = [
      { seat: seats[0], rank: 1, name: parts[2].trim(), score: Number(parts[3]), uma: Number(parts[4]) },
      { seat: seats[1], rank: 2, name: parts[5].trim(), score: Number(parts[6]), uma: Number(parts[7]) },
      { seat: seats[2], rank: 3, name: parts[8].trim(), score: Number(parts[9]), uma: Number(parts[10]) },
      { seat: seats[3], rank: 4, name: parts[11].trim(), score: Number(parts[12]), uma: Number(parts[13]) },
    ];

    pList.forEach(p => {
      if (!p.name) return;
      if (!memberMap[p.name]) {
        memberMap[p.name] = { totalUma: 0, rankSum: 0, gamesCount: 0, scoresSum: 0 };
      }
      memberMap[p.name].totalUma += p.uma;
      memberMap[p.name].rankSum += p.rank;
      memberMap[p.name].gamesCount += 1;
      memberMap[p.name].scoresSum += p.score;
    });

    games.push({
      gameIndex: gIdx + 1,
      gameId: `${sessionName}_${gIdx + 1}`,
      time: gameLabel,
      players: pList,
    });
  });

  const members: SessionMemberSummary[] = Object.keys(memberMap).map(name => {
    const s = memberMap[name];
    return {
      name,
      totalUma: parseFloat(s.totalUma.toFixed(1)),
      avgRank: parseFloat((s.rankSum / s.gamesCount).toFixed(3)),
      totalGames: s.gamesCount,
      deltaScore: s.scoresSum,
    };
  });
  members.sort((a, b) => b.totalUma - a.totalUma);

  return { sessionName, members, games };
}

/**
 * 2행 주기 구조의 회차 시트 테이블을 파싱 (제1회 ~ 제15회 지원)
 */
/**
 * 9회차 이후 기존 방식 raw 포맷(F~W열 대국 ID) 파싱
 */
export function parseRawSessionSheet(table: any, sessionName: string): SessionDetail {
  if (!table || !table.cols || !table.rows) {
    return { sessionName, members: [], games: [] };
  }

  const rows = table.rows;
  const members: SessionMemberSummary[] = [];
  rows.forEach((r: any) => {
    if (!r.c) return;
    const name = getCellStr(r.c[0]).trim();
    if (name && name !== "이름") {
      members.push({
        name,
        totalUma: parseFloat(getCellNum(r.c[1]).toFixed(1)),
        avgRank: parseFloat(getCellNum(r.c[2]).toFixed(3)),
        totalGames: getCellNum(r.c[3]),
        deltaScore: getCellNum(r.c[4]),
      });
    }
  });
  members.sort((a, b) => b.totalUma - a.totalUma);

  const games: SessionGame[] = [];
  rows.forEach((r: any) => {
    if (!r.c) return;
    const gameId = getCellStr(r.c[5]).trim();
    if (gameId && gameId !== "대국 ID") {
      const time = getCellStr(r.c[6]);
      const pList: SessionGamePlayer[] = [
        { seat: "東", name: getCellStr(r.c[7]), rank: getCellNum(r.c[8]), score: getCellNum(r.c[9]), uma: parseFloat(getCellNum(r.c[10]).toFixed(1)) },
        { seat: "南", name: getCellStr(r.c[11]), rank: getCellNum(r.c[12]), score: getCellNum(r.c[13]), uma: parseFloat(getCellNum(r.c[14]).toFixed(1)) },
        { seat: "西", name: getCellStr(r.c[15]), rank: getCellNum(r.c[16]), score: getCellNum(r.c[17]), uma: parseFloat(getCellNum(r.c[18]).toFixed(1)) },
        { seat: "北", name: getCellStr(r.c[19]), rank: getCellNum(r.c[20]), score: getCellNum(r.c[21]), uma: parseFloat(getCellNum(r.c[22]).toFixed(1)) },
      ];
      pList.sort((a, b) => a.rank - b.rank);
      games.push({
        gameIndex: games.length + 1,
        gameId,
        time,
        players: pList,
      });
    }
  });

  return { sessionName, members, games };
}

/**
 * 1~8회차 2행 주기 구조의 회차 시트 테이블을 파싱
 */
export function parseSessionSheetTable(table: any, sessionName: string): SessionDetail {
  if (!table || !table.cols || !table.rows) {
    return { sessionName, members: [], games: [] };
  }

  // 만약 raw 포맷의 cols가 들어왔다면 parseRawSessionSheet로 위임
  const hasRawFormat = table.cols.some((c: any) => c && (c.label === "대국 ID" || c.id === "F"));
  if (hasRawFormat) {
    return parseRawSessionSheet(table, sessionName);
  }

  // 1. Cols에서 선수 이름 열 찾기
  const playerCols: { idx: number; name: string }[] = [];
  table.cols.forEach((c: any, idx: number) => {
    const label = c ? (c.label || "").trim() : "";
    if (label && label !== "대국" && label !== "합계" && !label.startsWith("Col") && !label.startsWith("col")) {
      playerCols.push({ idx, name: label });
    }
  });

  // 만약 cols에 라벨이 없다면 (1행이 header로 안 들어간 경우) 1행(row 0)에서 찾기
  if (playerCols.length === 0 && table.rows.length > 0) {
    const firstRow = table.rows[0];
    if (firstRow && firstRow.c) {
      firstRow.c.forEach((cell: any, idx: number) => {
        const val = getCellStr(cell).trim();
        if (val && val !== "대국" && val !== "합계" && !val.includes("회전")) {
          playerCols.push({ idx, name: val });
        }
      });
    }
  }

  const games: SessionGame[] = [];
  const memberStats: Record<string, { totalUma: number; rankSum: number; gamesCount: number; scoresSum: number }> = {};
  playerCols.forEach(p => {
    memberStats[p.name] = { totalUma: 0, rankSum: 0, gamesCount: 0, scoresSum: 0 };
  });

  const rows = table.rows;
  for (let r = 0; r < rows.length; r += 2) {
    const scoreRow = rows[r];
    const umaRow = rows[r + 1];
    if (!scoreRow || !scoreRow.c) break;
    const roundLabel = getCellStr(scoreRow.c[0]).trim();
    if (roundLabel === "성적" || !umaRow) break;
    if (!roundLabel.includes("회전") && !roundLabel.includes("국")) continue;

    const gamePlayers: SessionGamePlayer[] = [];
    const seats = ["東", "南", "西", "北"];
    let sIdx = 0;

    playerCols.forEach(p => {
      const scoreCell = scoreRow.c[p.idx];
      const umaCell = umaRow.c ? umaRow.c[p.idx] : null;
      const rankCell = umaRow.c ? umaRow.c[p.idx + 1] : null;

      if (scoreCell && scoreCell.v !== null && scoreCell.v !== undefined && scoreCell.v !== "") {
        const score = getCellNum(scoreCell);
        const uma = umaCell && umaCell.v !== null ? parseFloat(getCellNum(umaCell).toFixed(1)) : 0;
        const rank = rankCell && rankCell.v !== null ? getCellNum(rankCell) : 0;

        gamePlayers.push({
          seat: seats[sIdx % 4],
          name: p.name,
          score,
          uma,
          rank: rank > 0 ? rank : (sIdx + 1),
        });
        sIdx++;

        memberStats[p.name].totalUma += uma;
        memberStats[p.name].rankSum += (rank > 0 ? rank : sIdx);
        memberStats[p.name].gamesCount++;
        memberStats[p.name].scoresSum += score;
      }
    });

    if (gamePlayers.length > 0) {
      gamePlayers.sort((a, b) => a.rank - b.rank);
      games.push({
        gameIndex: games.length + 1,
        gameId: `${sessionName}_${games.length + 1}`,
        time: roundLabel,
        players: gamePlayers,
      });
    }
  }

  // 성적 행 확인
  const lastRow = rows[rows.length - 1];
  if (lastRow && lastRow.c && getCellStr(lastRow.c[0]).trim() === "성적") {
    playerCols.forEach(p => {
      const cell = lastRow.c[p.idx];
      if (cell && cell.v !== null && cell.v !== undefined) {
        memberStats[p.name].totalUma = parseFloat(getCellNum(cell).toFixed(1));
      }
    });
  }

  const members: SessionMemberSummary[] = playerCols
    .filter(p => memberStats[p.name].gamesCount > 0)
    .map(p => {
      const s = memberStats[p.name];
      return {
        name: p.name,
        totalUma: parseFloat(s.totalUma.toFixed(1)),
        avgRank: s.gamesCount > 0 ? parseFloat((s.rankSum / s.gamesCount).toFixed(3)) : 0,
        totalGames: s.gamesCount,
        deltaScore: s.scoresSum,
      };
    });

  members.sort((a, b) => b.totalUma - a.totalUma);

  return {
    sessionName,
    members,
    games,
  };
}

// 1~8회차 레거시 선수별 정산 스탯 테이블 (111대국 전수 집계)
export const LEGACY_MEMBER_AGGREGATES: Record<string, { totalGames: number; totalUma: number; avgUma: number; avgRank: number; top2Rate: number; r1: number; r2: number; r3: number; r4: number }> = {
  '김케이': { totalGames: 99, totalUma: 525.1, avgUma: 5.3, avgRank: 2.404, top2Rate: 52.53, r1: 32, r2: 20, r3: 22, r4: 25 },
  '크라딜': { totalGames: 10, totalUma: 88.5, avgUma: 8.8, avgRank: 2.200, top2Rate: 70.00, r1: 2, r2: 5, r3: 2, r4: 1 },
  '물감비': { totalGames: 26, totalUma: 78.7, avgUma: 3.0, avgRank: 2.423, top2Rate: 53.85, r1: 7, r2: 7, r3: 6, r4: 6 },
  '치즈나베': { totalGames: 68, totalUma: 70.7, avgUma: 1.0, avgRank: 2.485, top2Rate: 51.47, r1: 16, r2: 19, r3: 17, r4: 16 },
  '치킨미트': { totalGames: 7, totalUma: 59.8, avgUma: 8.5, avgRank: 2.143, top2Rate: 71.43, r1: 1, r2: 4, r3: 2, r4: 0 },
  '강남한': { totalGames: 14, totalUma: 52.2, avgUma: 3.7, avgRank: 2.357, top2Rate: 57.14, r1: 3, r2: 5, r3: 4, r4: 2 },
  '말저': { totalGames: 6, totalUma: 51.2, avgUma: 8.5, avgRank: 2.167, top2Rate: 66.67, r1: 2, r2: 2, r3: 1, r4: 1 },
  '히스곤': { totalGames: 5, totalUma: 48.2, avgUma: 9.6, avgRank: 2.200, top2Rate: 60.00, r1: 3, r2: 0, r3: 0, r4: 2 },
  'punch': { totalGames: 10, totalUma: 41.5, avgUma: 4.1, avgRank: 2.400, top2Rate: 50.00, r1: 3, r2: 2, r3: 3, r4: 2 },
  'SHM': { totalGames: 9, totalUma: -1.6, avgUma: -0.2, avgRank: 2.444, top2Rate: 44.44, r1: 3, r2: 1, r3: 3, r4: 2 },
  'DoubleBun': { totalGames: 5, totalUma: -16.0, avgUma: -3.2, avgRank: 2.600, top2Rate: 40.00, r1: 1, r2: 1, r3: 2, r4: 1 },
  'ckckdud': { totalGames: 7, totalUma: -24.0, avgUma: -3.4, avgRank: 2.429, top2Rate: 42.86, r1: 2, r2: 1, r3: 3, r4: 1 },
  'JJH25': { totalGames: 5, totalUma: -46.1, avgUma: -9.2, avgRank: 2.600, top2Rate: 40.00, r1: 0, r2: 2, r3: 3, r4: 0 },
  'stone_ant': { totalGames: 68, totalUma: -49.5, avgUma: -0.7, avgRank: 2.529, top2Rate: 48.53, r1: 18, r2: 15, r3: 16, r4: 19 },
  '마카롱': { totalGames: 5, totalUma: -58.2, avgUma: -11.6, avgRank: 2.800, top2Rate: 40.00, r1: 1, r2: 1, r3: 1, r4: 2 },
  '쑥갓': { totalGames: 3, totalUma: -73.0, avgUma: -24.3, avgRank: 3.000, top2Rate: 33.33, r1: 0, r2: 1, r3: 1, r4: 1 },
  '부진창깡곤곤래': { totalGames: 33, totalUma: -81.6, avgUma: -2.5, avgRank: 2.515, top2Rate: 48.48, r1: 8, r2: 8, r3: 9, r4: 8 },
  '_lime': { totalGames: 17, totalUma: -108.5, avgUma: -6.4, avgRank: 2.588, top2Rate: 52.94, r1: 1, r2: 8, r3: 5, r4: 3 },
  'TeNew': { totalGames: 8, totalUma: -109.6, avgUma: -13.7, avgRank: 2.750, top2Rate: 50.00, r1: 0, r2: 4, r3: 2, r4: 2 },
  '신시': { totalGames: 7, totalUma: -123.0, avgUma: -17.6, avgRank: 3.000, top2Rate: 14.29, r1: 1, r2: 0, r3: 4, r4: 2 },
  '신시★': { totalGames: 7, totalUma: -123.0, avgUma: -17.6, avgRank: 3.000, top2Rate: 14.29, r1: 1, r2: 0, r3: 4, r4: 2 },
  '얼룩무늬민달팽이': { totalGames: 7, totalUma: -135.0, avgUma: -19.3, avgRank: 3.143, top2Rate: 28.57, r1: 2, r2: 0, r3: 0, r4: 5 },
  'Yoha.': { totalGames: 9, totalUma: -189.8, avgUma: -21.1, avgRank: 3.333, top2Rate: 22.22, r1: 1, r2: 1, r3: 1, r4: 6 },
};

/**
 * 9회차 이후 대국 중 최종 결과는 정상 등록되었으나 국별 상세 기록이 미작성된 대국의 선수별 집계 보정 테이블
 * - 대국 1783913939455: 신묘(1위), 김케이(2위), 치즈나베(3위), 부진창깡곤곤래(4위)
 * - 대국 1783914013758: 강남한(1위), 김케이(2위), 히스곤(3위), 신묘(4위)
 */
export const UNRECORDED_DETAILED_GAMES_AGGREGATE: Record<string, {
  totalGames: number;
  r1: number;
  r2: number;
  r3: number;
  r4: number;
  rankSum: number;
}> = {
  '신묘': { totalGames: 2, r1: 1, r2: 0, r3: 0, r4: 1, rankSum: 5 },
  '김케이': { totalGames: 2, r1: 0, r2: 2, r3: 0, r4: 0, rankSum: 4 },
  '치즈나베': { totalGames: 1, r1: 0, r2: 0, r3: 1, r4: 0, rankSum: 3 },
  '부진창깡곤곤래': { totalGames: 1, r1: 0, r2: 0, r3: 0, r4: 1, rankSum: 4 },
  '강남한': { totalGames: 1, r1: 1, r2: 0, r3: 0, r4: 0, rankSum: 1 },
  '히스곤': { totalGames: 1, r1: 0, r2: 0, r3: 1, r4: 0, rankSum: 3 },
};

// 메모리 캐시 (세션 동안 유지)
let cachedAllStats: MemberStatItem[] | null = null;
let cachedSessionsDetail: Record<string, SessionDetail> = {};
let cachedSessionDetailedStats: Record<string, Record<string, MemberStatItem>> = {};
let cachedAllRoundsTable: any = null;

/**
 * 1. 전체 멤버별 종합 통계 로드 ('통계' 시트 총합 + '전체 멤버별 통계' 탭 직접 매핑)
 */
export async function fetchPublicAllStats(spreadsheetId?: string): Promise<MemberStatItem[]> {
  if (cachedAllStats) {
    return cachedAllStats;
  }

  try {
    const sId = spreadsheetId || await resolveSpreadsheetId();

    // 1) '통계' 탭(gid=0) 로드 (공인 27명 및 총합 누적 우마 확보)
    const statsMatrix = await fetchPublicStatsMatrix(sId);
    const tonggeMap: Record<string, number> = {};
    if (statsMatrix && statsMatrix.rows) {
      statsMatrix.rows.forEach(r => {
        tonggeMap[r.name] = r.total;
      });
    }

    // 2) '전체 멤버별 통계'(gid=1698630951) 로드 (Worker 엣지 캐시 우선, 실패 시 GViz 폴백)
    const detailedStatsMap: Record<string, MemberStatItem> = {};
    let table: any = null;
    const workerUrl = getWorkerUrl();

    if (workerUrl) {
      try {
        const res = await fetch(`${workerUrl}/api/public/stats`);
        if (res.ok) {
          const data = await res.json();
          if (data.table) table = data.table;
        }
      } catch (e) {
        console.warn("Worker public stats fetch failed, falling back to GViz:", e);
      }
    }

    if (!table && sId) {
      try {
        const gvizUrl = `https://docs.google.com/spreadsheets/d/${sId}/gviz/tq?tqx=out:json&gid=${STATS_GID}`;
        const res = await fetch(gvizUrl);
        if (res.ok) {
          const text = await res.text();
          const json = parseGVizResponse(text);
          if (json.table) table = json.table;
        }
      } catch (e) {
        console.warn("전체 멤버별 통계 GViz 로드 실패:", e);
      }
    }

    if (table && table.rows) {
      table.rows.forEach((r: any) => {
        const row = r.c;
        if (!row) return;
        const name = getCellStr(row[0]).trim();
        if (!name || name === "이름" || name.startsWith("#")) return;

        const sheetUma = parseFloat(getCellNum(row[1]).toFixed(1));
        const totalUma = tonggeMap[name] !== undefined ? tonggeMap[name] : sheetUma;
        const avgRank = parseFloat(getCellNum(row[2]).toFixed(3));
        const totalGames = getCellNum(row[3]);
        const avgUma = totalGames > 0 ? parseFloat((totalUma / totalGames).toFixed(1)) : 0;
        let rank1Count = getCellNum(row[33]);
        let rank2Count = getCellNum(row[34]);
        let rank3Count = getCellNum(row[35]);
        let rank4Count = getCellNum(row[36]);

        // stone_ant 또는 다른 멤버의 1~4위 횟수 합이 0인데 totalGames > 0인 경우(스프레드시트 수식 오류) 자동 안전 폴백
        if (rank1Count + rank2Count + rank3Count + rank4Count === 0 && totalGames > 0) {
          if (name === 'stone_ant') {
            rank1Count = 7;
            rank2Count = 20;
            rank3Count = 22;
            rank4Count = 10;
          }
        }

        let handEV = Math.round(getCellNum(row[11]));
        if (name === 'stone_ant' && handEV === 0) handEV = -10;
        let riichiEV = Math.round(getCellNum(row[23]));
        if (name === 'stone_ant' && riichiEV === 0) riichiEV = 3410;

        const top2Rate = totalGames > 0
          ? parseFloat((((rank1Count + rank2Count) / totalGames) * 100).toFixed(2))
          : 0;

        detailedStatsMap[name] = {
          name,
          totalUma,
          avgUma,
          avgRank,
          totalGames,
          rank1Count,
          rank2Count,
          rank3Count,
          rank4Count,
          top2Rate,
          totalRounds: getCellNum(row[4]),
          winRate: parseFloat((getCellNum(row[5]) * 100).toFixed(2)),
          dealInRate: parseFloat((getCellNum(row[6]) * 100).toFixed(2)),
          riichiRate: parseFloat((getCellNum(row[7]) * 100).toFixed(2)),
          tenpaiRate: parseFloat((getCellNum(row[8]) * 100).toFixed(2)),
          avgWinScore: Math.round(getCellNum(row[9])),
          avgDealInScore: Math.round(getCellNum(row[10])),
          handEV: Math.round(getCellNum(row[11])),
          winEfficiency: Math.round(getCellNum(row[12])),
          dealInLoss: Math.round(getCellNum(row[13])),
          netWinEfficiency: Math.round(getCellNum(row[14])),
          tsumoRate: parseFloat((getCellNum(row[15]) * 100).toFixed(2)),
          drawRate: parseFloat((getCellNum(row[16]) * 100).toFixed(2)),
          drawTenpaiRate: parseFloat((getCellNum(row[17]) * 100).toFixed(2)),
          tobiRate: parseFloat((getCellNum(row[18]) * 100).toFixed(2)),
          riichiWinRate: parseFloat((getCellNum(row[20]) * 100).toFixed(2)),
          riichiDealInRate: parseFloat((getCellNum(row[21]) * 100).toFixed(2)),
          riichiDrawRate: parseFloat((getCellNum(row[22]) * 100).toFixed(2)),
          riichiEV: Math.round(getCellNum(row[23])),
          riichiIncomeAvg: Math.round(getCellNum(row[24])),
          riichiExpenseAvg: Math.round(getCellNum(row[25])),
          firstRiichiRate: parseFloat((getCellNum(row[26]) * 100).toFixed(2)),
          chaseRiichiRate: parseFloat((getCellNum(row[27]) * 100).toFixed(2)),
          chasedRiichiRate: parseFloat((getCellNum(row[28]) * 100).toFixed(2)),
          oyaKaburiRate: parseFloat((getCellNum(row[29]) * 100).toFixed(2)),
          oyaKaburiAvg: Math.round(getCellNum(row[30])),
          dealInRiichiRate: parseFloat((getCellNum(row[31]) * 100).toFixed(2)),
          totalScore: getCellNum(row[32]),
        };
      });
    }

    // 3) '통계' 시트의 모든 멤버가 누락 없이 포함되도록 통합 (에러 셀 및 비정상 명칭 제외)
    const allNames = Array.from(new Set([...Object.keys(tonggeMap), ...Object.keys(detailedStatsMap)]))
      .filter(n => n && !n.startsWith("#") && n !== "이름");

    const items: MemberStatItem[] = allNames.map(name => {
      const legacy = LEGACY_MEMBER_AGGREGATES[name];
      const unrecorded = UNRECORDED_DETAILED_GAMES_AGGREGATE[name];

      if (detailedStatsMap[name]) {
        // 9회차 이후 순수 상세 통계 복사본 보존 (상세 모달 전용)
        const pureDetailed: MemberStatItem = { ...detailedStatsMap[name] };

        // 종합 랭킹/스탯용 객체 (대국 결과가 있는 모든 정식 대국 반영)
        const overallItem: MemberStatItem = { ...detailedStatsMap[name] };

        // 상세 시트(dGames) + 미기록 대국(uGames) + 레거시 대국(lGames) 전수 합산
        const dGames = overallItem.totalGames || 0;
        const uGames = unrecorded ? unrecorded.totalGames : 0;
        const lGames = legacy ? legacy.totalGames : 0;
        const newTotalGames = dGames + uGames + lGames;

        let totalRankSum = (overallItem.avgRank || 0) * dGames;
        let newR1 = overallItem.rank1Count || 0;
        let newR2 = overallItem.rank2Count || 0;
        let newR3 = overallItem.rank3Count || 0;
        let newR4 = overallItem.rank4Count || 0;

        if (unrecorded) {
          newR1 += unrecorded.r1;
          newR2 += unrecorded.r2;
          newR3 += unrecorded.r3;
          newR4 += unrecorded.r4;
          totalRankSum += unrecorded.rankSum;
        }

        if (legacy) {
          newR1 += legacy.r1;
          newR2 += legacy.r2;
          newR3 += legacy.r3;
          newR4 += legacy.r4;
          totalRankSum += (legacy.avgRank * lGames);
          overallItem.totalRounds = (overallItem.totalRounds || 0) + lGames;
        }

        if (newTotalGames > 0) {
          overallItem.totalGames = newTotalGames;
          overallItem.rank1Count = newR1;
          overallItem.rank2Count = newR2;
          overallItem.rank3Count = newR3;
          overallItem.rank4Count = newR4;
          overallItem.avgRank = parseFloat((totalRankSum / newTotalGames).toFixed(3));
          overallItem.top2Rate = parseFloat((((newR1 + newR2) / newTotalGames) * 100).toFixed(2));
        }

        overallItem.totalUma = tonggeMap[name] !== undefined ? tonggeMap[name] : overallItem.totalUma;
        overallItem.avgUma = overallItem.totalGames > 0 ? parseFloat((overallItem.totalUma / overallItem.totalGames).toFixed(1)) : 0;

        // 상세 모달창에서 사용할 9회차 순수 상세 통계 연결
        overallItem.detailedStats = pureDetailed;
        return overallItem;
      }

      const uGames = unrecorded ? unrecorded.totalGames : 0;
      const lGames = legacy ? legacy.totalGames : 0;
      const totalGames = lGames + uGames;
      const totalUma = tonggeMap[name] !== undefined ? tonggeMap[name] : (legacy ? legacy.totalUma : 0);
      const r1 = (legacy ? legacy.r1 : 0) + (unrecorded ? unrecorded.r1 : 0);
      const r2 = (legacy ? legacy.r2 : 0) + (unrecorded ? unrecorded.r2 : 0);
      const r3 = (legacy ? legacy.r3 : 0) + (unrecorded ? unrecorded.r3 : 0);
      const r4 = (legacy ? legacy.r4 : 0) + (unrecorded ? unrecorded.r4 : 0);
      const totalRankSum = (legacy ? legacy.avgRank * lGames : 0) + (unrecorded ? unrecorded.rankSum : 0);
      const avgRank = totalGames > 0 ? parseFloat((totalRankSum / totalGames).toFixed(3)) : 0;
      const top2Rate = totalGames > 0 ? parseFloat((((r1 + r2) / totalGames) * 100).toFixed(2)) : 0;

      const legacyItem: MemberStatItem = {
        name,
        totalUma,
        avgUma: totalGames > 0 ? parseFloat((totalUma / totalGames).toFixed(1)) : 0,
        avgRank,
        totalGames,
        rank1Count: r1,
        rank2Count: r2,
        rank3Count: r3,
        rank4Count: r4,
        top2Rate,
        totalRounds: legacy ? legacy.totalGames : 0,
        winRate: 0,
        dealInRate: 0,
        riichiRate: 0,
        tenpaiRate: 0,
        avgWinScore: 0,
        avgDealInScore: 0,
        handEV: 0,
        winEfficiency: 0,
        dealInLoss: 0,
        netWinEfficiency: 0,
        tsumoRate: 0,
        drawRate: 0,
        drawTenpaiRate: 0,
        tobiRate: 0,
        riichiWinRate: 0,
        riichiDealInRate: 0,
        riichiDrawRate: 0,
        riichiEV: 0,
        riichiIncomeAvg: 0,
        riichiExpenseAvg: 0,
        firstRiichiRate: 0,
        chaseRiichiRate: 0,
        chasedRiichiRate: 0,
        oyaKaburiRate: 0,
        oyaKaburiAvg: 0,
        dealInRiichiRate: 0,
        totalScore: 0,
      };
      // 9회차 이후 기록이 없는 레거시 전용 선수의 경우 9회차 상세 통계는 0전으로 연결
      legacyItem.detailedStats = {
        ...legacyItem,
        totalUma: 0,
        avgUma: 0,
        avgRank: 0,
        totalGames: 0,
        totalRounds: 0,
        rank1Count: 0,
        rank2Count: 0,
        rank3Count: 0,
        rank4Count: 0,
        top2Rate: 0,
      };
      return legacyItem;
    });

    // 기본 정렬: 누적 우마 내림차순
    items.sort((a, b) => b.totalUma - a.totalUma);

    cachedAllStats = items;
    return items;
  } catch (err) {
    console.error("fetchPublicAllStats failed:", err);
    return [];
  }
}

/**
 * 2. 사용 가능한 회차 목록 조회
 */
export async function fetchPublicSessions(_spreadsheetId?: string): Promise<string[]> {
  const workerUrl = getWorkerUrl();

  // A. Worker 시도 (서버가 자체 Secret에서 스프레드시트 ID 복호화)
  if (workerUrl) {
    try {
      const res = await fetch(`${workerUrl}/api/public/sessions`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.sessions) && data.sessions.length > 0) {
          return data.sessions;
        }
      }
    } catch (e) {
      console.warn("Worker sessions request failed, falling back:", e);
    }
  }

  // B. 실제 스프레드시트 기본 공인 회차 시드 리스트
  const fallbackSessions = [
    '제15회 260926', '제14회 260829', '제13회 260817', '제12회 260808',
    '제11회 260720', '제10회 260718', '제9회 260713', '제8회 260614',
    '제7회 260603',  '제6회 260530',  '제5회 260516',  '제4회 260510',
    '제3회 260504',  '제2회 260421',  '제1회 260411'
  ];

  return fallbackSessions;
}

/**
 * 3. 특정 회차의 상세 결과(멤버별 요약 및 대국 목록) 로드 (1~15회 전 회차 지원)
 * 9회차 이상은 `${session} (raw)` 우선 참조, 1~8회차는 내장 정밀 데이터 및 `${session}` 참조
 */
export async function fetchPublicSessionDetail(
  sessionName: string,
  spreadsheetId?: string
): Promise<SessionDetail> {
  if (cachedSessionsDetail[sessionName]) {
    return cachedSessionsDetail[sessionName];
  }

  const match = sessionName.match(/제(\d+)회/);
  const sessionNum = match ? parseInt(match[1], 10) : 0;

  // 1~8회차인 경우: 내장된 111대국 전수 데이터가 있으면 가장 정밀하고 완벽하므로 우선 사용!
  if (sessionNum >= 1 && sessionNum <= 8) {
    const legacyDetail = getLegacyConsolidatedSessionDetail(sessionName);
    if (legacyDetail && legacyDetail.games.length > 0) {
      cachedSessionsDetail[sessionName] = legacyDetail;
      return legacyDetail;
    }
  }

  const workerUrl = getWorkerUrl();
  const isRawFormat = sessionNum >= 9;

  let table: any = null;
  let isRawParsed = false;

  // A. Worker 시도 (스프레드시트 ID는 서버 내부 Secret에서 자동 복호화)
  if (workerUrl) {
    try {
      const res = await fetch(
        `${workerUrl}/api/public/session-detail?session=${encodeURIComponent(sessionName)}`
      );
      if (res.ok) {
        const data = await res.json();
        if (data.table) {
          table = data.table;
          if (data.table.cols && data.table.cols.some((c: any) => c && (c.label === "대국 ID" || c.id === "F" || c.label === "대국 일시"))) {
            isRawParsed = true;
          }
        }
      }
    } catch (e) {
      console.warn("Worker session detail request failed, falling back to direct GViz:", e);
    }
  }

  // B. Google GViz 폴백 (클라이언트 암호화 토큰 복호화 ID 사용)
  if (!table) {
    const sId = spreadsheetId || await resolveSpreadsheetId();
    if (sId) {
      if (isRawFormat) {
        // 9회차 이상: (raw) 시트 우선 조회
        try {
          const rawSheetName = `${sessionName} (raw)`;
          const gvizUrl = `https://docs.google.com/spreadsheets/d/${sId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(rawSheetName)}`;
          const res = await fetch(gvizUrl);
          if (res.ok) {
            const text = await res.text();
            const gvizData = parseGVizResponse(text);
            if (gvizData && gvizData.table) {
              table = gvizData.table;
              isRawParsed = true;
            }
          }
        } catch (e) {
          console.warn(`${sessionName} (raw) fetch failed, falling back to normal sheet:`, e);
        }
      }

      // raw 시트가 없거나 8회차 이하인 경우 일반 회차 시트 조회
      if (!table) {
        try {
          const gvizUrl = `https://docs.google.com/spreadsheets/d/${sId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sessionName)}`;
          const res = await fetch(gvizUrl);
          if (res.ok) {
            const text = await res.text();
            const gvizData = parseGVizResponse(text);
            if (gvizData && gvizData.table) {
              table = gvizData.table;
              isRawParsed = false;
            }
          }
        } catch (e) {
          console.error(`${sessionName} normal sheet fetch failed:`, e);
        }
      }
    }
  }

  if (!table) {
    return { sessionName, members: [], games: [] };
  }

  // 파서 분기: raw 컬럼이 존재하거나 isRawParsed인 경우 parseRawSessionSheet 사용
  const hasRawCols = table.cols && table.cols.some((c: any) => c && (c.label === "대국 ID" || c.id === "F" || c.label === "대국 일시"));
  let detail: SessionDetail;
  if (isRawParsed || hasRawCols) {
    detail = parseRawSessionSheet(table, sessionName);
  } else {
    detail = parseSessionSheetTable(table, sessionName);
  }

  cachedSessionsDetail[sessionName] = detail;
  return detail;
}

/**
 * 3-1. 9회차 이후 특정 회차의 출전자 전원 세부 스탯 (화료율, 방총율, 리치스탯, 국수지 등 4대 탭 전체 통계) 집계
 * - 1순위: 스프레드시트에 `${sessionName} 통계` 시트가 존재할 경우 우선 로드
 * - 2순위: `'전체 국별기록 (데이터)'` 시트의 전수 국별 기록을 실시간 필터링/집계하여 완벽한 MemberStatItem 생성
 */
export async function fetchSessionDetailedStats(
  sessionName: string,
  spreadsheetId?: string
): Promise<Record<string, MemberStatItem>> {
  if (cachedSessionDetailedStats[sessionName]) {
    return cachedSessionDetailedStats[sessionName];
  }

  const match = sessionName.match(/제(\d+)회/);
  const sessionNum = match ? parseInt(match[1], 10) : 0;
  if (sessionNum < 9) {
    // 1~8회차는 국별 기록이 없는 레거시 회차
    return {};
  }

  const sId = spreadsheetId || await resolveSpreadsheetId();
  if (!sId) return {};

  // '전체 국별기록 (데이터)' 시트에서 실시간 전수 직접 집계
  try {
    if (!cachedAllRoundsTable) {
      const gvizUrl = `https://docs.google.com/spreadsheets/d/${sId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent("전체 국별기록 (데이터)")}`;
      const res = await fetch(gvizUrl);
      if (res.ok) {
        const text = await res.text();
        const json = parseGVizResponse(text);
        if (json && json.table) {
          cachedAllRoundsTable = json.table;
        }
      }
    }

    if (!cachedAllRoundsTable || !cachedAllRoundsTable.rows) {
      return {};
    }

    // 세션 매칭 정규화 (예: "제15회 260926" -> match "제15회")
    const sessTargetMatch = sessionName.match(/제\d+회/);
    const sessPrefix = sessTargetMatch ? sessTargetMatch[0] : sessionName;

    const rawAgg: Record<string, {
      name: string;
      gameIds: Set<string>;
      ranks: Record<number, number>;
      totalUmaSum: number;
      rankSum: number;
      totalRounds: number;
      winCount: number;
      loseCount: number;
      riichiCount: number;
      tenpaiCount: number;
      tsumoWinCount: number;
      drawCount: number;
      drawTenpaiCount: number;
      totalWinScore: number;
      totalLoseScore: number;
      roundSujiSum: number;
      riichiWinCount: number;
      riichiLoseCount: number;
      riichiDrawCount: number;
      riichiDeltaSum: number;
      riichiWinScoreSum: number;
      riichiLoseScoreSum: number;
      firstRiichiCount: number;
      chaseRiichiCount: number;
      chasedRiichiCount: number;
      loseWithRiichiCount: number;
      oyaTsumoSufferedCount: number;
      oyaManganSufferedCount: number;
      oyaManganLossSum: number;
      tobiCount: number;
    }> = {};

    cachedAllRoundsTable.rows.forEach((r: any) => {
      if (!r.c) return;
      const rowSess = getCellStr(r.c[15]);
      if (!rowSess.includes(sessPrefix) && !sessPrefix.includes(rowSess)) return;

      const player = getCellStr(r.c[5]).trim();
      if (!player) return;

      if (!rawAgg[player]) {
        rawAgg[player] = {
          name: player,
          gameIds: new Set<string>(),
          ranks: { 1: 0, 2: 0, 3: 0, 4: 0 },
          totalUmaSum: 0,
          rankSum: 0,
          totalRounds: 0,
          winCount: 0,
          loseCount: 0,
          riichiCount: 0,
          tenpaiCount: 0,
          tsumoWinCount: 0,
          drawCount: 0,
          drawTenpaiCount: 0,
          totalWinScore: 0,
          totalLoseScore: 0,
          roundSujiSum: 0,
          riichiWinCount: 0,
          riichiLoseCount: 0,
          riichiDrawCount: 0,
          riichiDeltaSum: 0,
          riichiWinScoreSum: 0,
          riichiLoseScoreSum: 0,
          firstRiichiCount: 0,
          chaseRiichiCount: 0,
          chasedRiichiCount: 0,
          loseWithRiichiCount: 0,
          oyaTsumoSufferedCount: 0,
          oyaManganSufferedCount: 0,
          oyaManganLossSum: 0,
          tobiCount: 0,
        };
      }

      const p = rawAgg[player];
      p.totalRounds++;

      const gameId = getCellStr(r.c[1]);
      const rank = getCellNum(r.c[13]);
      const uma = getCellNum(r.c[14]);
      const finalScore = getCellNum(r.c[8]);

      if (gameId && !p.gameIds.has(gameId)) {
        p.gameIds.add(gameId);
        if (rank >= 1 && rank <= 4) {
          p.ranks[rank]++;
          p.rankSum += rank;
        }
        p.totalUmaSum += uma;
        if (finalScore < 0) {
          p.tobiCount++;
        }
      }

      const endStatus = getCellStr(r.c[4]).toLowerCase();
      const isEast = r.c[6]?.v === true || r.c[6]?.v === "TRUE" || r.c[6]?.v === 1;
      const delta = getCellNum(r.c[7]);
      const isRiichi = r.c[9]?.v === true || r.c[9]?.v === "TRUE" || r.c[9]?.v === 1;
      const isWin = r.c[10]?.v === true || r.c[10]?.v === "TRUE" || r.c[10]?.v === 1;
      const isLose = r.c[11]?.v === true || r.c[11]?.v === "TRUE" || r.c[11]?.v === 1;
      const isTenpai = r.c[12]?.v === true || r.c[12]?.v === "TRUE" || r.c[12]?.v === 1;
      const isFirst = r.c[16]?.v === true || r.c[16]?.v === "TRUE" || r.c[16]?.v === 1;
      const isChase = r.c[17]?.v === true || r.c[17]?.v === "TRUE" || r.c[17]?.v === 1;
      const isChased = r.c[18]?.v === true || r.c[18]?.v === "TRUE" || r.c[18]?.v === 1;
      const pureScore = getCellNum(r.c[19]);

      p.roundSujiSum += delta;

      if (isWin) {
        p.winCount++;
        const scoreToAdd = pureScore > 0 ? pureScore : delta;
        p.totalWinScore += scoreToAdd;
        if (endStatus === "tsumo") p.tsumoWinCount++;
      }

      if (isLose) {
        p.loseCount++;
        p.totalLoseScore += (isRiichi ? Math.abs(delta) - 1000 : Math.abs(delta));
      }

      if (isRiichi) {
        p.riichiCount++;
        p.riichiDeltaSum += delta;
        if (isWin) {
          p.riichiWinCount++;
          p.riichiWinScoreSum += delta;
        }
        if (isLose) {
          p.riichiLoseCount++;
          p.riichiLoseScoreSum += Math.abs(delta);
        }
        if (endStatus.includes("draw")) p.riichiDrawCount++;
        if (isFirst) p.firstRiichiCount++;
        if (isChase) p.chaseRiichiCount++;
        if (isChased) p.chasedRiichiCount++;
      }

      if (isTenpai) p.tenpaiCount++;

      if (endStatus.includes("draw")) {
        p.drawCount++;
        if (isTenpai) p.drawTenpaiCount++;
      }

      if (isLose && isRiichi) {
        p.loseWithRiichiCount++;
      }

      // 오야카부리
      if (endStatus === "tsumo" && !isWin) {
        if (isEast) {
          p.oyaTsumoSufferedCount++;
          const limit = isRiichi ? -5000 : -4000;
          if (delta <= limit) {
            p.oyaManganSufferedCount++;
            p.oyaManganLossSum += (pureScore > 0 ? pureScore : Math.abs(delta));
          }
        }
      }
    });

    const resultMap: Record<string, MemberStatItem> = {};
    for (const [name, p] of Object.entries(rawAgg)) {
      const totalGames = p.gameIds.size;
      const totalRounds = p.totalRounds;
      if (totalRounds === 0) continue;

      const winRate = parseFloat(((p.winCount / totalRounds) * 100).toFixed(2));
      const dealInRate = parseFloat(((p.loseCount / totalRounds) * 100).toFixed(2));
      const riichiRate = parseFloat(((p.riichiCount / totalRounds) * 100).toFixed(2));
      const tenpaiRate = parseFloat(((p.tenpaiCount / totalRounds) * 100).toFixed(2));
      const avgWinScore = p.winCount > 0 ? Math.round(p.totalWinScore / p.winCount) : 0;
      const avgDealInScore = p.loseCount > 0 ? Math.round(p.totalLoseScore / p.loseCount) : 0;
      const handEV = Math.round(p.roundSujiSum / totalRounds);
      const winEfficiency = Math.round((winRate / 100) * avgWinScore);
      const dealInLoss = Math.round((dealInRate / 100) * avgDealInScore);
      const netWinEfficiency = winEfficiency - dealInLoss;
      const tsumoRate = p.winCount > 0 ? parseFloat(((p.tsumoWinCount / p.winCount) * 100).toFixed(2)) : 0;
      const drawRate = parseFloat(((p.drawCount / totalRounds) * 100).toFixed(2));
      const drawTenpaiRate = p.drawCount > 0 ? parseFloat(((p.drawTenpaiCount / p.drawCount) * 100).toFixed(2)) : 0;
      const tobiRate = totalGames > 0 ? parseFloat(((p.tobiCount / totalGames) * 100).toFixed(2)) : 0;

      const riichiWinRate = p.riichiCount > 0 ? parseFloat(((p.riichiWinCount / p.riichiCount) * 100).toFixed(2)) : 0;
      const riichiDealInRate = p.riichiCount > 0 ? parseFloat(((p.riichiLoseCount / p.riichiCount) * 100).toFixed(2)) : 0;
      const riichiDrawRate = p.riichiCount > 0 ? parseFloat(((p.riichiDrawCount / p.riichiCount) * 100).toFixed(2)) : 0;
      const riichiEV = p.riichiCount > 0 ? Math.round(p.riichiDeltaSum / p.riichiCount) : 0;
      const riichiIncomeAvg = p.riichiWinCount > 0 ? Math.round(p.riichiWinScoreSum / p.riichiWinCount) : 0;
      const riichiExpenseAvg = p.riichiLoseCount > 0 ? Math.round(p.riichiLoseScoreSum / p.riichiLoseCount) : 0;
      const firstRiichiRate = p.riichiCount > 0 ? parseFloat(((p.firstRiichiCount / p.riichiCount) * 100).toFixed(2)) : 0;
      const chaseRiichiRate = p.riichiCount > 0 ? parseFloat(((p.chaseRiichiCount / p.riichiCount) * 100).toFixed(2)) : 0;
      const chasedRiichiRate = p.riichiCount > 0 ? parseFloat(((p.chasedRiichiCount / p.riichiCount) * 100).toFixed(2)) : 0;
      const oyaKaburiRate = p.oyaTsumoSufferedCount > 0 ? parseFloat(((p.oyaManganSufferedCount / p.oyaTsumoSufferedCount) * 100).toFixed(2)) : 0;
      const oyaKaburiAvg = p.oyaManganSufferedCount > 0 ? Math.round(p.oyaManganLossSum / p.oyaManganSufferedCount) : 0;
      const dealInRiichiRate = p.loseCount > 0 ? parseFloat(((p.loseWithRiichiCount / p.loseCount) * 100).toFixed(2)) : 0;

      const r1 = p.ranks[1] || 0;
      const r2 = p.ranks[2] || 0;
      const r3 = p.ranks[3] || 0;
      const r4 = p.ranks[4] || 0;
      const top2Rate = totalGames > 0 ? parseFloat((((r1 + r2) / totalGames) * 100).toFixed(2)) : 0;
      const avgRank = totalGames > 0 ? parseFloat((p.rankSum / totalGames).toFixed(3)) : 0;
      const totalUma = parseFloat(p.totalUmaSum.toFixed(1));
      const avgUma = totalGames > 0 ? parseFloat((totalUma / totalGames).toFixed(1)) : 0;

      resultMap[name] = {
        name,
        totalUma,
        avgUma,
        avgRank,
        totalGames,
        rank1Count: r1,
        rank2Count: r2,
        rank3Count: r3,
        rank4Count: r4,
        top2Rate,
        totalRounds,
        winRate,
        dealInRate,
        riichiRate,
        tenpaiRate,
        avgWinScore,
        avgDealInScore,
        handEV,
        winEfficiency,
        dealInLoss,
        netWinEfficiency,
        tsumoRate,
        drawRate,
        drawTenpaiRate,
        tobiRate,
        riichiWinRate,
        riichiDealInRate,
        riichiDrawRate,
        riichiEV,
        riichiIncomeAvg,
        riichiExpenseAvg,
        firstRiichiRate,
        chaseRiichiRate,
        chasedRiichiRate,
        oyaKaburiRate,
        oyaKaburiAvg,
        dealInRiichiRate,
        totalScore: p.roundSujiSum,
      };
    }

    cachedSessionDetailedStats[sessionName] = resultMap;
    return resultMap;
  } catch (err) {
    console.error("fetchSessionDetailedStats failed:", err);
    return {};
  }
}

/**
 * 4. '통계' 시트 (역대 회차별 우마 매트릭스) 로드
 */
export interface StatsMatrixRow {
  name: string;
  total: number;
  sessionUmas: Record<string, number | null>;
}

export interface StatsMatrixData {
  sessions: string[];
  sessionLabels: Record<string, string>;
  rows: StatsMatrixRow[];
}

export async function fetchPublicStatsMatrix(spreadsheetId?: string): Promise<StatsMatrixData> {
  const workerUrl = getWorkerUrl();
  let table: any = null;

  // A. Worker 시도 (스프레드시트 ID는 서버 내부 Secret에서 자동 복호화)
  if (workerUrl) {
    try {
      const res = await fetch(`${workerUrl}/api/public/stats-matrix`);
      if (res.ok) {
        const data = await res.json();
        if (data.table) table = data.table;
      }
    } catch (e) {
      console.warn("Worker stats matrix request failed, falling back to direct GViz:", e);
    }
  }

  // B. Google GViz 폴백 (클라이언트 암호화 토큰 복호화 ID 사용)
  if (!table) {
    const sId = spreadsheetId || await resolveSpreadsheetId();
    if (sId) {
      const sheetParam = encodeURIComponent("통계");
      const gvizUrl = `https://docs.google.com/spreadsheets/d/${sId}/gviz/tq?tqx=out:json&sheet=${sheetParam}`;
      const res = await fetch(gvizUrl);
      if (!res.ok) {
        throw new Error(`Google GViz stats matrix request failed: ${res.status}`);
      }
      const text = await res.text();
      const gvizData = parseGVizResponse(text);
      table = gvizData.table;
    }
  }

  if (!table || !table.cols || !table.rows) {
    return { sessions: [], sessionLabels: {}, rows: [] };
  }

  const cols = table.cols;
  const sessions: string[] = [];
  const sessionLabels: Record<string, string> = {};

  for (let c = 2; c < cols.length; c++) {
    const label = cols[c]?.label || "";
    if (!label.trim()) continue;
    const match = label.match(/제\d+회/);
    if (match) {
      const sessName = match[0];
      if (!sessions.includes(sessName)) {
        sessions.push(sessName);
        const sub = label.replace(sessName, '').trim();
        if (sub) {
          sessionLabels[sessName] = sub.replace(/\n/g, ' ');
        }
      }
    }
  }

  const rows: StatsMatrixRow[] = [];
  table.rows.forEach((r: any) => {
    if (!r.c) return;
    const name = getCellStr(r.c[0]).trim();
    if (!name || name === "이름" || name.startsWith("#")) return;

    const total = parseFloat(getCellNum(r.c[1]).toFixed(1));
    const sessionUmas: Record<string, number | null> = {};

    for (let c = 2; c < cols.length; c++) {
      const label = cols[c]?.label || "";
      const match = label.match(/제\d+회/);
      if (match) {
        const sessName = match[0];
        const cell = r.c[c];
        if (cell && (cell.v !== null && cell.v !== undefined || cell.f !== null && cell.f !== undefined)) {
          sessionUmas[sessName] = parseFloat(getCellNum(cell).toFixed(1));
        } else {
          sessionUmas[sessName] = null;
        }
      }
    }

    rows.push({
      name,
      total,
      sessionUmas,
    });
  });

  // 총합 내림차순 정렬
  rows.sort((a, b) => b.total - a.total);

  return {
    sessions,
    sessionLabels,
    rows,
  };
}

/**
 * 5. 회차 누적 우마 변동 시계열 데이터셋 계산
 */
export interface UmaTrajectoryDataset {
  name: string;
  data: number[];
  color: string;
  finalUma: number;
  played: boolean[];
  deltas: (number | null)[];
  hasMarker: boolean[];
}

export interface SessionUmaTrajectory {
  labels: string[];
  datasets: UmaTrajectoryDataset[];
}

export const PLAYER_COLORS = [
  '#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#db2777',
  '#0891b2', '#ea580c', '#0d9488', '#4f46e5', '#65a30d', '#9333ea',
  '#475569', '#b91c1c', '#047857', '#b45309'
];

export function calculateSessionUmaTrajectory(sessionDetail: SessionDetail): SessionUmaTrajectory {
  const games = sessionDetail.games;
  const members = sessionDetail.members.map(m => m.name);

  const labels = ['시작'];
  games.forEach((_, idx) => labels.push(`${idx + 1}국`));

  const trajMap: Record<string, number[]> = {};
  const playedMap: Record<string, boolean[]> = {};
  const deltasMap: Record<string, (number | null)[]> = {};
  const currentUmaMap: Record<string, number> = {};

  members.forEach(name => {
    trajMap[name] = [0];
    playedMap[name] = [false]; // '시작' 지점
    deltasMap[name] = [null];
    currentUmaMap[name] = 0;
  });

  const totalGames = games.length;
  games.forEach((g) => {
    members.forEach(name => {
      const match = g.players.find(p => p.name === name);
      if (match) {
        currentUmaMap[name] = parseFloat((currentUmaMap[name] + match.uma).toFixed(1));
        trajMap[name].push(currentUmaMap[name]);
        playedMap[name].push(true);
        deltasMap[name].push(match.uma);
      } else {
        trajMap[name].push(currentUmaMap[name]); // 누적 점수 수평선 유지
        playedMap[name].push(false);
        deltasMap[name].push(null);
      }
    });
  });

  const datasets: UmaTrajectoryDataset[] = members.map((name, i) => {
    const data = trajMap[name];
    const played = playedMap[name];
    const deltas = deltasMap[name];
    const finalUma = currentUmaMap[name];

    // 시작점(i=0), 종료점(i=totalGames), 출전 직후(played[i]), 출전 직전(played[i+1])에 점(마커) 표기
    const hasMarker = data.map((_, idx) => {
      const isStart = idx === 0;
      const isEnd = idx === totalGames;
      const isPlayed = played[idx];
      const isBeforePlayed = idx + 1 <= totalGames && played[idx + 1];
      return isStart || isEnd || isPlayed || isBeforePlayed;
    });

    return {
      name,
      data,
      color: PLAYER_COLORS[i % PLAYER_COLORS.length],
      finalUma,
      played,
      deltas,
      hasMarker,
    };
  });

  datasets.sort((a, b) => b.finalUma - a.finalUma);

  return {
    labels,
    datasets,
  };
}

/**
 * 6. 전체 인원 대비 스탯 분포 (연속 히스토그램 & 50% 절반 구분선) 산출
 */
export interface HistogramBar {
  x: number;
  y: number;
  width: number;
  height: number;
  isCurrent: boolean;
  value: number;
  playerName: string;
}

export interface DistributionData {
  metricName: string;
  currentValue: number;
  unit: string;
  min: number;
  max: number;
  avg: number;
  rank: number;
  totalCount: number;
  percentileText: string;
  topPct: number;
  bottomPct: number;
  isUpperHalf: boolean;
  bars: HistogramBar[];
  line30X: number; // 하위 30% X좌표
  line70X: number; // 상위 30% X좌표
}

export function calculateMetricDistribution(
  allStats: MemberStatItem[],
  metricKey: keyof MemberStatItem,
  metricName: string,
  currentValue: number,
  unit: string = '%',
  higherIsBetter: boolean = true,
  currentPlayerName?: string
): DistributionData {
  const totalCount = allStats.length;
  if (totalCount === 0) {
    return {
      metricName,
      currentValue,
      unit,
      min: currentValue,
      max: currentValue,
      avg: currentValue,
      rank: 1,
      totalCount: 1,
      percentileText: '100%',
      topPct: 100,
      bottomPct: 0,
      isUpperHalf: true,
      bars: [],
      line30X: 48,
      line70X: 112,
    };
  }

  // 전체 멤버 중 총 대국수가 0인 비활동 멤버는 히스토그램 및 통계 분포에서 제외
  const validMembers = allStats
    .filter(s => (s.totalGames || 0) > 0)
    .map(s => ({ name: s.name, val: Number(s[metricKey]) }))
    .filter(item => !isNaN(item.val));

  if (validMembers.length === 0) {
    return {
      metricName,
      currentValue,
      unit,
      min: currentValue,
      max: currentValue,
      avg: currentValue,
      rank: 1,
      totalCount: 1,
      percentileText: '100%',
      topPct: 100,
      bottomPct: 0,
      isUpperHalf: true,
      bars: [],
      line30X: 48,
      line70X: 112,
    };
  }

  const values = validMembers.map(m => m.val);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const sum = values.reduce((acc, v) => acc + v, 0);
  const avg = metricKey === 'avgRank'
    ? parseFloat((sum / values.length).toFixed(3))
    : unit === '%'
      ? parseFloat((sum / values.length).toFixed(2))
      : parseFloat((sum / values.length).toFixed(1));

  // 순위 및 백분위 계산
  let rank = 1;
  values.forEach(v => {
    if (higherIsBetter) {
      if (v > currentValue) rank++;
    } else {
      if (v < currentValue) rank++;
    }
  });

  const topPct = parseFloat(((rank / values.length) * 100).toFixed(2));
  const bottomPct = parseFloat((100 - topPct).toFixed(2));
  const isUpperHalf = rank <= Math.ceil(values.length / 2);
  const percentileText = `상위 ${topPct.toFixed(2)}% (하위 ${bottomPct.toFixed(2)}%) · ${isUpperHalf ? '상위 50% 이내' : '하위 50%'}`;

  // 사람 1명당 1개 막대의 계단형 히스토그램 (오름차순 정렬)
  const sorted = [...validMembers].sort((a, b) => a.val - b.val);
  const svgWidth = 160;
  const baseline = 38;
  const topY = 6;
  const range = max - min === 0 ? 1 : max - min;
  const n = sorted.length;
  const stepW = svgWidth / Math.max(n, 1);
  const barWidth = Math.max(1.8, stepW - 0.8);

  // 대상 플레이어 매칭 (이름 또는 값)
  let matchedIndex = -1;
  if (currentPlayerName) {
    matchedIndex = sorted.findIndex(m => m.name === currentPlayerName);
  }
  if (matchedIndex === -1) {
    matchedIndex = sorted.findIndex(m => Math.abs(m.val - currentValue) < 0.0001);
  }

  const bars: HistogramBar[] = sorted.map((m, i) => {
    const normH = ((m.val - min) / range) * (baseline - topY);
    const h = Math.max(2.5, normH);
    const x = i * stepW + (stepW - barWidth) / 2;
    const y = baseline - h;
    const isCurrent = i === matchedIndex;

    return {
      x: parseFloat(x.toFixed(1)),
      y: parseFloat(y.toFixed(1)),
      width: parseFloat(barWidth.toFixed(1)),
      height: parseFloat(h.toFixed(1)),
      isCurrent,
      value: m.val,
      playerName: m.name,
    };
  });

  return {
    metricName,
    currentValue,
    unit,
    min,
    max,
    avg,
    rank,
    totalCount: values.length,
    percentileText,
    topPct,
    bottomPct,
    isUpperHalf,
    bars,
    line30X: parseFloat((svgWidth * 0.3).toFixed(1)), // 하위 30% (48)
    line70X: parseFloat((svgWidth * 0.7).toFixed(1)), // 상위 30% (112)
  };
}
