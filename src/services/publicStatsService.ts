/**
 * Public Stats Service: 비로그인 외부 관전자/모임원용 통계 및 회차 결과 조회 서비스
 * Cloudflare Worker 엣지 캐시(3분)를 우선 호출하고, 미설정 또는 장애 시 Google GViz 공용 API로 자동 폴백합니다.
 * 스프레드시트 접근 주소(ID)는 하드코딩하지 않고, 서버 Secret 및 .env 암호화 토큰을 통해 복호화하여 사용합니다.
 */
import {
  type PlayerRating,
  type GameRatingHistoryRecord,
  calculateMatchRatings,
  replayAllHistoricalGames,
  normalizeRatingPlayerName,
  getRatingColor,
  DEFAULT_MU,
  DEFAULT_SIGMA,
  computeOrdinal
} from '@/utils/ratingEngine';
export type { GameRatingHistoryRecord };

// 클라이언트 캐시된 스프레드시트 ID
let resolvedClientSpreadsheetId: string | null = null;

/**
 * 환경 변수(VITE_SPREADSHEET_ID)에서 스프레드시트 ID를 해석합니다.
 * (로컬 개발 시 .env에 설정된 경우에만 사용되며, 배포 환경에서는 Cloudflare Worker가 전담합니다)
 */
export async function resolveSpreadsheetId(): Promise<string> {
  if (resolvedClientSpreadsheetId) return resolvedClientSpreadsheetId;

  // 1. .env에 평문 VITE_SPREADSHEET_ID가 설정되어 있는 경우 (로컬 개발용)
  const plain = (import.meta as any).env?.VITE_SPREADSHEET_ID;
  if (plain && String(plain).trim()) {
    resolvedClientSpreadsheetId = String(plain).trim();
    return resolvedClientSpreadsheetId;
  }

  // 2. 로컬 .env에 암호화 토큰 및 키가 명시적으로 설정된 경우만 복호화 지원
  const encToken = (import.meta as any).env?.VITE_ENCRYPTED_SPREADSHEET_ID;
  const encKey = (import.meta as any).env?.VITE_ENCRYPTION_KEY;

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
  chaseRiichiWinRate: number; // 추격리치 성공률 (추격리치 중 화료 비율)
  chaseRiichiCount?: number; // 추격리치 횟수
  chaseRiichiWinCount?: number; // 추격리치 화료 횟수
  chasedRiichiRate: number; // 피추격률
  oyaKaburiRate: number;
  oyaKaburiAvg: number;
  dealInRiichiRate: number;
  cheatRate: number; // 촌보율 (0 ~ 100 %, 소수점 5자리)
  beolbuRate: number; // 벌부율 (0 ~ 100 %, 소수점 5자리)
  cheatCount?: number;
  beolbuCount?: number;
  totalScore: number;
  rank1Count: number;
  rank2Count: number;
  rank3Count: number;
  rank4Count: number;
  top2Rate: number; // 연대율 (%)
  detailedStats?: MemberStatItem; // 9회차 이후 순수 상세 통계 (레거시 제외)
  // 레이팅 (OpenSkill) 필드
  rating?: number; // Ordinal = round(μ - 1.5σ)
  ratingMu?: number;
  ratingSigma?: number;
  ratingPeak?: number;
  ratingLowest?: number;
  ratingDelta?: number;
  ratingLastUpdated?: string;
  ratingHistory?: {
    gameIndex: number;
    gameId?: string;
    ordinal: number;
    delta: number;
    sessionLabel?: string;
    date?: string;
    rank?: number;
  }[];
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
  ratingBefore?: number;
  ratingAfter?: number;
  ratingDelta?: number;
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

const DEFAULT_WORKER_URL = "https://mahjong-score.cnabe.workers.dev";

// 헬퍼: Worker 주소 가져오기 (비정상 localStorage 값 오염 방어)
function getWorkerUrl(): string {
  const envWorkerUrl = import.meta.env.VITE_GOOGLE_AUTH_WORKER_URL;
  if (envWorkerUrl) return envWorkerUrl.trim().replace(/\/+$/, '');
  try {
    const saved = localStorage.getItem("google_auth_worker_url");
    if (saved) {
      const trimmed = saved.trim().replace(/\/+$/, '');
      const isLocalHostPage =
        typeof window !== 'undefined' &&
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
      if (
        /^https:\/\/[a-z0-9.-]+\.workers\.dev$/i.test(trimmed) ||
        (isLocalHostPage && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(trimmed))
      ) {
        return trimmed;
      }
      localStorage.removeItem("google_auth_worker_url");
    }
  } catch {
    // ignore storage access errors
  }
  return DEFAULT_WORKER_URL;
}

// 헬퍼: 엑셀/구글시트 일련번호 날짜(예: "46326")를 "YYYY. M. D." 문자열로 변환
function formatSheetDateValue(rawDate: string): string {
  const trimmed = String(rawDate || '').trim();
  if (!trimmed) return '';
  if (/^\d{5}(\.\d+)?$/.test(trimmed)) {
    const serial = parseFloat(trimmed);
    if (serial > 40000 && serial < 80000) {
      const utcMs = Math.round((serial - 25569) * 86400 * 1000);
      const d = new Date(utcMs);
      if (!isNaN(d.getTime())) {
        return `${d.getUTCFullYear()}. ${d.getUTCMonth() + 1}. ${d.getUTCDate()}.`;
      }
    }
  }
  return trimmed;
}

// 헬퍼: 테이블이 9회차 이후 (raw) 시트 구조인지 검증 (Google GViz의 첫 번째 시트 폴백 오인 방지)
function isRawSessionSheetTable(table: any): boolean {
  if (!table) return false;
  if (Array.isArray(table.cols)) {
    const hasRawCol = table.cols.some((c: any) => {
      const label = c && c.label ? String(c.label).trim() : '';
      return label === '대국 ID' || label === '대국 일시' || label === '최종 우마' || label === '누적 점수변동';
    });
    if (hasRawCol) return true;
  }
  if (Array.isArray(table.rows) && table.rows.length > 0) {
    const firstRowCells = table.rows[0]?.c;
    if (Array.isArray(firstRowCells)) {
      const hasRawHeaderCell = firstRowCells.some((cell: any) => {
        const val = getCellStr(cell).trim();
        return val === '대국 ID' || val === '대국 일시' || val === '최종 우마';
      });
      if (hasRawHeaderCell) return true;
    }
  }
  return false;
}

// 헬퍼: 타임아웃(AbortController) 및 503/네트워크 오류 시 캐시 폴백 자동 재시도 지원 fetch
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 8000
): Promise<Response> {
  const attempt = async (targetUrl: string, ms: number): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      return await fetch(targetUrl, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    const res = await attempt(url, timeoutMs);
    if (res.status >= 500) {
      const fallbackUrl = url.replace(/([?&])refresh=1(&?)/, (_m, p1, p2) => (p2 ? p1 : ''));
      await new Promise(r => setTimeout(r, 250));
      return await attempt(fallbackUrl, timeoutMs);
    }
    return res;
  } catch (err) {
    const fallbackUrl = url.replace(/([?&])refresh=1(&?)/, (_m, p1, p2) => (p2 ? p1 : ''));
    await new Promise(r => setTimeout(r, 250));
    return await attempt(fallbackUrl, timeoutMs);
  }
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
  if (isRawSessionSheetTable(table)) {
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
let cachedSessionRoundsMap: Record<string, any[]> = {};
let pendingSessionRoundsPromises: Record<string, Promise<any[]> | undefined> = {};
let cachedStatsMatrix: StatsMatrixData | null = null;
let pendingStatsMatrixPromise: Promise<StatsMatrixData> | null = null;

const PAST_SESSION_CACHE_PREFIX = 'mahjong_past_sess_v3_';
let knownMaxSessionNumber = 0;

// 구버전(v1/v2) 로컬스토리지 회차 캐시 자동 정리 (과거 오염된 더미/폴백 캐시 영구 고착 방지)
try {
  if (typeof localStorage !== 'undefined') {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('mahjong_past_sess_v2_') || k.startsWith('mahjong_past_session_v1_'))) {
        localStorage.removeItem(k);
      }
    }
  }
} catch {
  // ignore storage access errors
}

function isValidSessionDetailObject(detail: SessionDetail | null | undefined, sessionName: string): detail is SessionDetail {
  if (!detail || !Array.isArray(detail.games) || !Array.isArray(detail.members)) return false;
  if (detail.games.length === 0) return false;
  // 비정상 파싱(표시용 시트가 raw 파서로 오인된 경우: '1회전', '성적' 등이 이름으로 들어감) 차단
  const hasCorruptMember = detail.members.some(
    m => !m?.name || /^\d+\s*(회전|국)$/.test(m.name.trim()) || m.name.trim() === '성적' || m.name.trim() === '대국'
  );
  if (hasCorruptMember) return false;

  const sessMatch = String(sessionName || '').match(/제\s*(\d+)\s*회/);
  const sessionNum = sessMatch ? parseInt(sessMatch[1], 10) : 0;
  if (sessionNum >= 9) {
    // 9회차 이상에서 레이팅 이력 기반 임시 조립 객체(gameId가 `${sessionName}_1` 형태이거나 일련번호 시간)는 정식 캐시로 인정하지 않음
    const firstGame = detail.games[0];
    if (
      firstGame &&
      (firstGame.gameId === `${sessionName}_1` || /^\d{5}(\.\d+)?$/.test(String(firstGame.time || '').trim()))
    ) {
      return false;
    }
  }
  return true;
}

function updateKnownMaxSessionNumber(sessionList: string[]): void {
  for (const s of sessionList) {
    const m = String(s || '').match(/제\s*(\d+)\s*회/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > knownMaxSessionNumber) knownMaxSessionNumber = n;
    }
  }
}

function isPastImmutableSessionClient(sessionName: string): boolean {
  const numMatch = String(sessionName || '').match(/제\s*(\d+)\s*회/);
  const num = numMatch ? parseInt(numMatch[1], 10) : 0;
  if (knownMaxSessionNumber > 0 && num >= knownMaxSessionNumber) {
    return false;
  }
  const m = String(sessionName || '').match(/(\d{2})(\d{2})(\d{2})/);
  if (!m) return false;
  const year = 2000 + parseInt(m[1], 10);
  const month = parseInt(m[2], 10) - 1;
  const day = parseInt(m[3], 10);
  const sessionDateMs = Date.UTC(year, month, day) - 9 * 60 * 60 * 1000;
  // 자정(00:00 KST)을 넘기는 심야 대국이나 익일 동기화 시 구버전 캐시 고착을 방지하기 위해 최소 3일(72시간) 경과 후에만 불변 캐시 허용
  return Date.now() - sessionDateMs > 3 * 24 * 60 * 60 * 1000;
}

/**
 * '레이팅 이력' 시트 및 '통계' 시트(N국 헤더)에 기록된 특정 회차의 알려진 대국 수를 반환합니다.
 * 로컬 캐시(13국 등)가 실제 진행된 대국 수(15국 등)보다 적을 때 구버전 캐시를 즉시 폐기하는 데 사용됩니다.
 */
export function getExpectedSessionGameCount(
  sessionName: string,
  historyRecords?: GameRatingHistoryRecord[]
): number {
  const sessMatch = String(sessionName || '').match(/제\s*(\d+)\s*회/);
  const sessionNum = sessMatch ? parseInt(sessMatch[1], 10) : 0;
  if (!sessionNum) return 0;

  const records = historyRecords && historyRecords.length > 0 ? historyRecords : cachedRatingHistoryRecords;
  if (records && records.length > 0) {
    const matchedCount = records.filter(r => {
      const m = r.sessionLabel?.match(/제\s*(\d+)\s*회/);
      return m && parseInt(m[1], 10) === sessionNum;
    }).length;
    if (matchedCount > 0) {
      return matchedCount;
    }
  }

  if (cachedStatsMatrix && cachedStatsMatrix.sessionLabels) {
    const label = cachedStatsMatrix.sessionLabels[`제${sessionNum}회`] || '';
    const countMatch = label.match(/(\d+)\s*국/);
    if (countMatch) {
      const matrixCount = parseInt(countMatch[1], 10);
      if (matrixCount > 0) return matrixCount;
    }
  }

  return 0;
}

function removePastSessionLocalCache(subKey: string): void {
  try {
    localStorage.removeItem(`${PAST_SESSION_CACHE_PREFIX}${subKey}`);
  } catch {
    // ignore
  }
}

/**
 * 대국 저장/동기화/삭제 직후 또는 [새로고침] 버튼 클릭 시 클라이언트 메모리 캐시를 초기화합니다.
 * keepPastSessions=false 인 경우 localStorage의 과거 회차 캐시까지 모두 초기화하여 최신 대국 수 반영을 보장합니다.
 */
export function clearPublicStatsCache(options?: { keepPastSessions?: boolean; sessionName?: string }): void {
  const keepPast = options?.keepPastSessions ?? false;
  cachedAllStats = null;
  cachedStatsMatrix = null;
  pendingStatsMatrixPromise = null;
  cachedRatings = null;
  cachedRatingTrajectory = null;
  cachedRatingHistoryRecords = null;
  pendingRatingTimelinePromise = null;
  cachedAllRoundsTable = null;

  const targetMatch = options?.sessionName?.match(/제\s*(\d+)\s*회/);
  const targetPrefix = targetMatch ? `제${targetMatch[1]}회` : '';

  if (!keepPast) {
    cachedSessionsDetail = {};
    cachedSessionDetailedStats = {};
    cachedSessionRoundsMap = {};
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (
          key &&
          (key.startsWith(PAST_SESSION_CACHE_PREFIX) ||
            key.startsWith('mahjong_past_sess_v2_') ||
            key.startsWith('mahjong_past_session_v1_'))
        ) {
          localStorage.removeItem(key);
        }
      }
    } catch {
      // ignore localStorage access error
    }
  } else {
    for (const k of Object.keys(cachedSessionsDetail)) {
      if (!isPastImmutableSessionClient(k) || (targetPrefix && k.includes(targetPrefix))) {
        delete cachedSessionsDetail[k];
      }
    }
    for (const k of Object.keys(cachedSessionDetailedStats)) {
      if (!isPastImmutableSessionClient(k) || (targetPrefix && k.includes(targetPrefix))) {
        delete cachedSessionDetailedStats[k];
      }
    }
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key.startsWith(PAST_SESSION_CACHE_PREFIX)) {
          const sessPart = key.replace(/^mahjong_past_sess_v3_(detail_|stats_)/, '');
          if (!isPastImmutableSessionClient(sessPart) || (targetPrefix && key.includes(targetPrefix))) {
            localStorage.removeItem(key);
          }
        }
      }
    } catch {
      // ignore
    }
    // cachedSessionRoundsMap은 key가 '제19회' 형태이므로 최신 회차 번호 이상이거나 targetPrefix와 일치하면 제거
    let maxRoundSessNum = 0;
    for (const k of Object.keys(cachedSessionRoundsMap)) {
      const m = k.match(/제(\d+)회/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxRoundSessNum) maxRoundSessNum = n;
      }
    }
    for (const k of Object.keys(cachedSessionRoundsMap)) {
      const m = k.match(/제(\d+)회/);
      const n = m ? parseInt(m[1], 10) : 0;
      if (n === maxRoundSessNum || (targetPrefix && k === targetPrefix)) {
        delete cachedSessionRoundsMap[k];
      }
    }
  }
}

/**
 * 이미 검증되어 메모리/로컬스토리지 또는 1~8회차 내장 데이터에 존재하는 정식 SessionDetail만 0ms에 반환합니다.
 * (가짜 좌석/시간이 들어가는 레이팅 이력 조립본은 반환하지 않음)
 */
export function getCachedSessionDetailImmediate(sessionName: string): SessionDetail | null {
  const expectedCount = getExpectedSessionGameCount(sessionName);

  if (cachedSessionsDetail[sessionName]) {
    const cached = cachedSessionsDetail[sessionName];
    if (!isValidSessionDetailObject(cached, sessionName) || (expectedCount > 0 && cached.games.length < expectedCount)) {
      delete cachedSessionsDetail[sessionName];
    } else {
      return cached;
    }
  }

  const isPastSession = isPastImmutableSessionClient(sessionName);
  if (isPastSession) {
    const localCached = readPastSessionLocalCache<SessionDetail>(`detail_${sessionName}`);
    if (localCached) {
      if (
        !isValidSessionDetailObject(localCached, sessionName) ||
        (expectedCount > 0 && localCached.games.length < expectedCount)
      ) {
        removePastSessionLocalCache(`detail_${sessionName}`);
      } else {
        cachedSessionsDetail[sessionName] = localCached;
        return localCached;
      }
    }
  }

  const sessMatch = sessionName.match(/제\s*(\d+)\s*회/);
  const sessionNum = sessMatch ? parseInt(sessMatch[1], 10) : 0;
  if (sessionNum >= 1 && sessionNum <= 8) {
    const legacy = getLegacyConsolidatedSessionDetail(sessionName);
    if (legacy && legacy.games.length > 0) {
      cachedSessionsDetail[sessionName] = legacy;
      return legacy;
    }
  }

  return null;
}

/**
 * '레이팅 이력'(cachedRatingHistoryRecords)에서 특정 회차의 SessionDetail을 조립합니다.
 * 정식 (raw) 시트 조회가 완전히 실패한 경우의 최후 폴백 용도로만 사용됩니다.
 */
export function buildSessionDetailFromRatingHistory(
  sessionName: string,
  historyRecords?: GameRatingHistoryRecord[]
): SessionDetail | null {
  const immediate = getCachedSessionDetailImmediate(sessionName);
  if (immediate) {
    return immediate;
  }

  const sessMatch = sessionName.match(/제\s*(\d+)\s*회/);
  const sessionNum = sessMatch ? parseInt(sessMatch[1], 10) : 0;

  const records = historyRecords && historyRecords.length > 0 ? historyRecords : cachedRatingHistoryRecords;
  if (!records || records.length === 0 || !sessionNum) return null;

  const matched = records.filter(r => {
    const m = r.sessionLabel?.match(/제\s*(\d+)\s*회/);
    return m && parseInt(m[1], 10) === sessionNum;
  });

  if (matched.length === 0) return null;

  const seats = ["東", "南", "西", "北"];
  const memberMap: Record<string, { totalUma: number; rankSum: number; gamesCount: number; scoresSum: number }> = {};

  const games: SessionGame[] = matched.map((r, idx) => {
    const players: SessionGamePlayer[] = r.players.map((p, pIdx) => {
      const uma = p.uma !== undefined ? parseFloat(Number(p.uma).toFixed(1)) : 0;
      if (!memberMap[p.name]) {
        memberMap[p.name] = { totalUma: 0, rankSum: 0, gamesCount: 0, scoresSum: 0 };
      }
      memberMap[p.name].totalUma += uma;
      memberMap[p.name].rankSum += p.rank;
      memberMap[p.name].gamesCount += 1;
      memberMap[p.name].scoresSum += p.score;

      return {
        seat: seats[pIdx % 4],
        name: p.name,
        rank: p.rank,
        score: p.score,
        uma,
        ratingAfter: p.ordinal,
        ratingDelta: p.delta,
        ratingBefore: p.ordinal - p.delta,
      };
    });

    players.sort((a, b) => a.rank - b.rank);

    const formattedDate = formatSheetDateValue(r.date || '');
    return {
      gameIndex: idx + 1,
      gameId: `${sessionName}_${idx + 1}`,
      time: formattedDate ? `${formattedDate} (${idx + 1}회전)` : `${idx + 1}회전`,
      players,
    };
  });

  const members: SessionMemberSummary[] = Object.keys(memberMap).map(name => {
    const s = memberMap[name];
    return {
      name,
      totalUma: parseFloat(s.totalUma.toFixed(1)),
      avgRank: s.gamesCount > 0 ? parseFloat((s.rankSum / s.gamesCount).toFixed(3)) : 0,
      totalGames: s.gamesCount,
      deltaScore: s.scoresSum - 25000 * s.gamesCount,
    };
  });
  members.sort((a, b) => b.totalUma - a.totalUma);

  return {
    sessionName,
    members,
    games,
  };
}

function readPastSessionLocalCache<T>(subKey: string): T | null {
  try {
    const raw = localStorage.getItem(`${PAST_SESSION_CACHE_PREFIX}${subKey}`);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writePastSessionLocalCache<T>(subKey: string, value: T): void {
  try {
    localStorage.setItem(`${PAST_SESSION_CACHE_PREFIX}${subKey}`, JSON.stringify(value));
  } catch {
    // ignore storage quota errors
  }
}

/**
 * 전체 국별기록 행 배열을 1회 순회하여 모든 회차(제9회~)별로 사전 인덱싱합니다.
 */
function indexAllRoundsBySession(rows: any[]): void {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const grouped: Record<string, any[]> = {};
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r?.c) continue;
    const rowSess = getCellStr(r.c[15]);
    const m = rowSess.match(/제\s*(\d+)\s*회/);
    if (m) {
      const key = `제${m[1]}회`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(r);
    }
  }
  for (const [k, list] of Object.entries(grouped)) {
    cachedSessionRoundsMap[k] = list;
  }
}

async function fetchSessionRoundsRows(sessionName: string, spreadsheetId?: string, forceRefresh: boolean = false): Promise<any[]> {
  const sessTargetMatch = sessionName.match(/제\d+회/);
  const sessPrefix = sessTargetMatch ? sessTargetMatch[0] : sessionName.trim();
  if (!sessPrefix) return [];

  if (!forceRefresh && cachedSessionRoundsMap[sessPrefix] && cachedSessionRoundsMap[sessPrefix].length > 0) {
    return cachedSessionRoundsMap[sessPrefix];
  }

  if (!forceRefresh && cachedAllRoundsTable && Array.isArray(cachedAllRoundsTable.rows)) {
    indexAllRoundsBySession(cachedAllRoundsTable.rows);
    if (cachedSessionRoundsMap[sessPrefix] && cachedSessionRoundsMap[sessPrefix].length > 0) {
      return cachedSessionRoundsMap[sessPrefix];
    }
  }

  const existingPromise = !forceRefresh ? pendingSessionRoundsPromises[sessPrefix] : undefined;
  if (existingPromise !== undefined) {
    return existingPromise;
  }

  const promise = (async () => {
    try {
      const workerUrl = getWorkerUrl();
      if (workerUrl) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        try {
          const refreshParam = forceRefresh ? `&refresh=1&_t=${Date.now()}` : '';
          const querySession = sessionName.trim() || sessPrefix;
          const res = await fetch(
            `${workerUrl}/api/public/rounds?session=${encodeURIComponent(querySession)}${refreshParam}`,
            { signal: controller.signal, cache: 'no-store' }
          );
          if (res.ok) {
            const data = await res.json();
            if (data.table && Array.isArray(data.table.rows)) {
              const rows = data.table.rows;
              // 만약 구버전 Worker여서 전체 회차 행이 한꺼번에 내려온 경우 전 회차를 한 번에 인덱싱
              if (!data.session && rows.length > 400) {
                cachedAllRoundsTable = data.table;
                indexAllRoundsBySession(rows);
                return cachedSessionRoundsMap[sessPrefix] || [];
              }
              if (rows.length > 0) {
                cachedSessionRoundsMap[sessPrefix] = rows;
              }
              return rows;
            }
          }
        } catch (e) {
          console.warn(`Worker per-session rounds fetch failed (${sessPrefix}):`, e);
        } finally {
          clearTimeout(timeoutId);
        }
      }

      const sId = spreadsheetId || await resolveSpreadsheetId();
      if ((forceRefresh || !cachedAllRoundsTable) && sId) {
        const sheetParam = encodeURIComponent("전체 국별기록 (데이터)");
        const numMatch = sessPrefix.match(/(\d+)/);
        const safeToken = numMatch ? `${numMatch[1]}회` : sessPrefix;
        const tqParam = encodeURIComponent(`SELECT * WHERE P CONTAINS '${safeToken}'`);
        const gvizUrl = `https://docs.google.com/spreadsheets/d/${sId}/gviz/tq?tqx=out:json&sheet=${sheetParam}&tq=${tqParam}`;
        const res = await fetch(gvizUrl);
        if (res.ok) {
          const text = await res.text();
          const json = parseGVizResponse(text);
          if (json && json.table && Array.isArray(json.table.rows)) {
            const rows = json.table.rows;
            if (rows.length > 0) {
              cachedSessionRoundsMap[sessPrefix] = rows;
            }
            return rows;
          }
        }
      }

      if (cachedAllRoundsTable && Array.isArray(cachedAllRoundsTable.rows)) {
        indexAllRoundsBySession(cachedAllRoundsTable.rows);
        return cachedSessionRoundsMap[sessPrefix] || [];
      }

      return [];
    } finally {
      delete pendingSessionRoundsPromises[sessPrefix];
    }
  })();

  pendingSessionRoundsPromises[sessPrefix] = promise;
  return promise;
}

/**
 * 1. 전체 멤버별 종합 통계 로드 ('통계' 시트 총합 + '전체 멤버별 통계' 탭 직접 매핑)
 */
export async function fetchPublicAllStats(spreadsheetId?: string, forceRefresh: boolean = false): Promise<MemberStatItem[]> {
  if (!forceRefresh && cachedAllStats) {
    return cachedAllStats;
  }

  try {
    const sId = spreadsheetId || await resolveSpreadsheetId();

    // 1) '통계' 탭(gid=0) 로드 (공인 27명 및 총합 누적 우마 확보)
    const statsMatrix = await fetchPublicStatsMatrix(sId, forceRefresh);
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
        const refreshQuery = forceRefresh ? `?refresh=1&_t=${Date.now()}` : '';
        const res = await fetchWithTimeout(`${workerUrl}/api/public/stats${refreshQuery}`, { cache: 'no-store' });
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
        const res = await fetchWithTimeout(gvizUrl);
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
        const avgRank = parseFloat(getCellNum(row[2]).toFixed(3));
        const totalGames = getCellNum(row[3]);
        const avgUma = totalGames > 0 ? parseFloat((sheetUma / totalGames).toFixed(1)) : 0;
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

        const totalRounds = getCellNum(row[4]);
        const sheetCheatRate = row[37] !== undefined ? parseFloat((getCellNum(row[37]) * 100).toFixed(4)) : 0;
        const sheetBeolbuRate = row[38] !== undefined ? parseFloat((getCellNum(row[38]) * 100).toFixed(4)) : 0;

        detailedStatsMap[name] = {
          name,
          totalUma: sheetUma,
          avgUma,
          avgRank,
          totalGames,
          rank1Count,
          rank2Count,
          rank3Count,
          rank4Count,
          top2Rate,
          totalRounds,
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
          chaseRiichiWinRate: 0,
          chasedRiichiRate: parseFloat((getCellNum(row[28]) * 100).toFixed(2)),
          oyaKaburiRate: parseFloat((getCellNum(row[29]) * 100).toFixed(2)),
          oyaKaburiAvg: Math.round(getCellNum(row[30])),
          dealInRiichiRate: parseFloat((getCellNum(row[31]) * 100).toFixed(2)),
          cheatRate: sheetCheatRate,
          beolbuRate: sheetBeolbuRate,
          cheatCount: Math.round((sheetCheatRate / 100) * totalRounds),
          beolbuCount: Math.round((sheetBeolbuRate / 100) * totalRounds),
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
        chaseRiichiWinRate: 0,
        chasedRiichiRate: 0,
        oyaKaburiRate: 0,
        oyaKaburiAvg: 0,
        dealInRiichiRate: 0,
        cheatRate: 0,
        beolbuRate: 0,
        cheatCount: 0,
        beolbuCount: 0,
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

    // OpenSkill 레이팅 데이터 주입
    try {
      const ratingsMap = await fetchPublicRatings(sId, forceRefresh);
      const ratingsByNorm = new Map<string, PlayerRating>();
      Object.entries(ratingsMap).forEach(([k, val]) => {
        const norm = normalizeRatingPlayerName(k);
        if (!norm || !val) return;
        const prev = ratingsByNorm.get(norm);
        if (!prev || (val.games || 0) >= (prev.games || 0)) {
          ratingsByNorm.set(norm, val);
        }
      });
      items.forEach(item => {
        const cleanName = normalizeRatingPlayerName(item.name);
        const r = ratingsMap[item.name] || ratingsMap[cleanName] || (cleanName ? ratingsByNorm.get(cleanName) : undefined);
        if (r) {
          item.rating = r.ordinal;
          item.ratingMu = r.mu;
          item.ratingSigma = r.sigma;
          item.ratingPeak = r.peakOrdinal;
          item.ratingLowest = r.lowestOrdinal;
          item.ratingDelta = r.recentDelta;
          item.ratingLastUpdated = r.lastUpdated;
          item.ratingHistory = r.history || [];
        } else {
          item.rating = 1320;
          item.ratingMu = 1500;
          item.ratingSigma = 120;
          item.ratingHistory = [];
        }
      });
    } catch (rErr) {
      console.warn("레이팅 데이터 주입 실패:", rErr);
    }

    // '국별 기록' 원본 데이터에서 추격리치 성공률(추격리치 국 중 화료 비율) 자동 가공 주입
    try {
      const roundRows = await fetchAllPublicRoundsRows(sId, forceRefresh);
      const chaseMap = new Map<string, { chase: number; chaseWin: number }>();
      for (let i = 0; i < roundRows.length; i++) {
        const r = roundRows[i];
        if (!r?.c) continue;
        const rawName = getCellStr(r.c[5]).trim();
        if (!rawName) continue;
        const isRiichi = r.c[9]?.v === true || r.c[9]?.v === "TRUE" || r.c[9]?.v === 1;
        if (!isRiichi) continue;
        const isChase = r.c[17]?.v === true || r.c[17]?.v === "TRUE" || r.c[17]?.v === 1;
        if (!isChase) continue;
        const isWin = r.c[10]?.v === true || r.c[10]?.v === "TRUE" || r.c[10]?.v === 1;
        const norm = normalizeRatingPlayerName(rawName);
        if (!norm) continue;
        const cur = chaseMap.get(norm) || { chase: 0, chaseWin: 0 };
        cur.chase++;
        if (isWin) cur.chaseWin++;
        chaseMap.set(norm, cur);
      }
      items.forEach((item) => {
        const norm = normalizeRatingPlayerName(item.name);
        const c = norm ? chaseMap.get(norm) : undefined;
        const rate = c && c.chase > 0 ? parseFloat(((c.chaseWin / c.chase) * 100).toFixed(2)) : 0;
        item.chaseRiichiWinRate = rate;
        item.chaseRiichiCount = c ? c.chase : 0;
        item.chaseRiichiWinCount = c ? c.chaseWin : 0;
        if (item.detailedStats) {
          item.detailedStats.chaseRiichiWinRate = rate;
          item.detailedStats.chaseRiichiCount = c ? c.chase : 0;
          item.detailedStats.chaseRiichiWinCount = c ? c.chaseWin : 0;
        }
      });
    } catch (cErr) {
      console.warn("추격리치 성공률 가공 주입 실패:", cErr);
    }

    cachedAllStats = items;
    return items;
  } catch (err) {
    console.error("fetchPublicAllStats failed:", err);
    return [];
  }
}

let cachedRatings: Record<string, PlayerRating> | null = null;

/**
 * '레이팅' 시트에서 현재 전체 선수 레이팅을 조회하고 타임라인 이력과 병합합니다.
 */
export async function fetchPublicRatings(spreadsheetId?: string, forceRefresh: boolean = false): Promise<Record<string, PlayerRating>> {
  if (!forceRefresh && cachedRatings && Object.keys(cachedRatings).length >= 15) {
    return cachedRatings;
  }

  const workerUrl = getWorkerUrl();
  let table: any = null;

  // A. Worker 시도 (서버가 자체 Secret에서 스프레드시트 ID 복호화)
  if (workerUrl) {
    try {
      const refreshQuery = forceRefresh ? `?refresh=1&_t=${Date.now()}` : '';
      const res = await fetchWithTimeout(`${workerUrl}/api/public/ratings${refreshQuery}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data.table) table = data.table;
      }
    } catch (e) {
      console.warn("Worker ratings request failed, falling back to direct GViz:", e);
    }
  }

  // B. Google GViz 폴백 (클라이언트 암호화 토큰 복호화 ID 사용)
  if (!table) {
    const sId = spreadsheetId || await resolveSpreadsheetId();
    if (sId) {
      try {
        const gvizUrl = `https://docs.google.com/spreadsheets/d/${sId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent('레이팅')}`;
        const res = await fetchWithTimeout(gvizUrl);
        if (res.ok) {
          const text = await res.text();
          const data = parseGVizResponse(text);
          if (data && data.table) table = data.table;
        }
      } catch (e) {
        console.warn("'레이팅' 시트 GViz 조회 실패:", e);
      }
    }
  }

  const sheetMap: Record<string, PlayerRating> = {};

  // C. 조회된 '레이팅' 테이블 파싱
  if (table && table.rows && table.rows.length > 0) {
    const isRatingSheet = table.cols && table.cols.some((c: any) => c && (c.label === '순위' || c.label === '레이팅'));
    const isRatingRow0 = table.rows[0] && table.rows[0].c && table.rows[0].c.some((c: any) => {
      const s = getCellStr(c).trim();
      return s === '순위' || s === '레이팅' || s === 'μ (실력)';
    });

    if (isRatingSheet || isRatingRow0) {
      const hasLowestCol = table.cols?.some((c: any) => c && c.label === '최저 레이팅') ||
                           (table.rows[0]?.c && table.rows[0].c.some((c: any) => getCellStr(c).trim() === '최저 레이팅'));

      table.rows.forEach((r: any) => {
        if (!r.c) return;
        const name = getCellStr(r.c[1]).trim();
        if (!name || name === '이름') return;

        const ordinal = Number(getCellNum(r.c[2])) || 1320;
        const mu = Number(getCellNum(r.c[3])) || 1500;
        const sigma = Number(getCellNum(r.c[4])) || 120;
        const games = Number(getCellNum(r.c[5])) || 0;
        const peak = Number(getCellNum(r.c[6])) || ordinal;
        let lowest = ordinal;
        let recentDelta = 0;
        let lastUpdated = '';

        if (hasLowestCol) {
          lowest = Number(getCellNum(r.c[7])) || ordinal;
          recentDelta = Number(String(getCellStr(r.c[8]) || '').replace('+', '')) || 0;
          lastUpdated = getCellStr(r.c[9]).trim();
        } else {
          recentDelta = Number(String(getCellStr(r.c[7]) || '').replace('+', '')) || 0;
          lastUpdated = getCellStr(r.c[8]).trim();
        }

        sheetMap[name] = {
          name,
          ordinal,
          mu,
          sigma,
          games,
          peakOrdinal: peak,
          lowestOrdinal: lowest,
          recentDelta,
          lastUpdated
        };
      });
    }
  }

  // '레이팅 이력' 시트 타임라인 조회 및 이력(history) 병합
  try {
    await fetchPublicRatingTimeline(spreadsheetId, forceRefresh);
  } catch (e) {
    console.warn("Timeline replay in fetchPublicRatings failed:", e);
  }

  if (Object.keys(sheetMap).length > 0) {
    // 1) 시트 행 중 별표(★) 변형으로 동일 인물이 2명 이상 분리된 경우(예: '신시' + '신시★') 감지
    const sheetNormCount = new Map<string, number>();
    Object.keys(sheetMap).forEach((name) => {
      const norm = normalizeRatingPlayerName(name);
      if (norm) sheetNormCount.set(norm, (sheetNormCount.get(norm) || 0) + 1);
    });

    const replayedMap = cachedRatings || {};
    const replayedByNorm = new Map<string, { key: string; rating: PlayerRating }>();
    Object.entries(replayedMap).forEach(([k, r]) => {
      const norm = normalizeRatingPlayerName(k);
      if (!norm || !r) return;
      const prev = replayedByNorm.get(norm);
      if (!prev || (r.games || 0) >= (prev.rating.games || 0)) {
        replayedByNorm.set(norm, { key: k, rating: r });
      }
    });

    const merged: Record<string, PlayerRating> = {};
    // 타임라인 리플레이 결과(별표 통합 완료)를 우선 적재
    for (const entry of replayedByNorm.values()) {
      merged[entry.key] = { ...entry.rating };
    }

    // 시트에만 존재하거나, 분리 오염이 없고 대국수가 더 최신인 항목만 보완 병합
    Object.entries(sheetMap).forEach(([name, sheetRating]) => {
      const norm = normalizeRatingPlayerName(name);
      const isDuplicateSplitInSheet = norm ? (sheetNormCount.get(norm) || 0) > 1 : false;
      const replayedEntry = norm ? replayedByNorm.get(norm) : undefined;

      if (replayedEntry) {
        // 시트에 별표 분리 중복이 있거나 리플레이 대국수가 크거나 같으면 통합 리플레이 결과를 유지
        if (isDuplicateSplitInSheet || (replayedEntry.rating.games || 0) >= (sheetRating.games || 0)) {
          return;
        }
        // 시트가 더 최신 대국을 포함한 단일 정상 항목인 경우에만 시트 값 반영 (기존 별표 키 정리)
        if (replayedEntry.key !== name) {
          delete merged[replayedEntry.key];
        }
        merged[name] = {
          ...sheetRating,
          lowestOrdinal: replayedEntry.rating.lowestOrdinal ?? sheetRating.lowestOrdinal,
          history: replayedEntry.rating.history || sheetRating.history || []
        };
      } else {
        merged[name] = { ...sheetRating, history: sheetRating.history || [] };
      }
    });

    cachedRatings = merged;
    return merged;
  }

  if (cachedRatings && Object.keys(cachedRatings).length > 0) {
    return cachedRatings;
  }

  // D. 만약 '레이팅' 시트가 아직 생성되지 않았거나 비어있는 경우:
  // 내장된 1~8회차 레거시 데이터를 바탕으로 안전 폴백 레이팅 생성
  const { finalRatings } = replayAllHistoricalGames(LEGACY_CONSOLIDATED_RAW, []);
  cachedRatings = finalRatings;
  return finalRatings;
}

/**
 * 2. 사용 가능한 회차 목록 조회
 */
export async function fetchPublicSessions(_spreadsheetId?: string, forceRefresh: boolean = false): Promise<string[]> {
  const workerUrl = getWorkerUrl();

  // A. Worker 시도 (서버가 자체 Secret에서 스프레드시트 ID 복호화)
  if (workerUrl) {
    try {
      const refreshQuery = forceRefresh ? `?refresh=1&_t=${Date.now()}` : `?_t=${Date.now()}`;
      const res = await fetchWithTimeout(`${workerUrl}/api/public/sessions${refreshQuery}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.sessions) && data.sessions.length > 0) {
          updateKnownMaxSessionNumber(data.sessions);
          try {
            localStorage.setItem('mahjong_public_sessions_v2', JSON.stringify(data.sessions));
          } catch (_) {}
          return data.sessions;
        }
      }
    } catch (e) {
      console.warn("Worker sessions request failed, falling back:", e);
    }
  }

  try {
    const rawSaved = localStorage.getItem('mahjong_public_sessions_v2');
    if (rawSaved) {
      const parsed = JSON.parse(rawSaved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        updateKnownMaxSessionNumber(parsed);
        return parsed;
      }
    }
  } catch (_) {}

  // B. 실제 스프레드시트 기본 공인 회차 시드 리스트
  const fallbackSessions = [
    '제22회 261031', '제21회 261028', '제20회 261026', '제19회 261017',
    '제18회 261016', '제17회 261010', '제16회 261009', '제15회 260926',
    '제14회 260829', '제13회 260817', '제12회 260808', '제11회 260720',
    '제10회 260718', '제9회 260713',  '제8회 260614',  '제7회 260603',
    '제6회 260530',  '제5회 260516',  '제4회 260510',  '제3회 260504',
    '제2회 260421',  '제1회 260411'
  ];

  updateKnownMaxSessionNumber(fallbackSessions);
  return fallbackSessions;
}

/**
 * 3. 특정 회차의 상세 결과(멤버별 요약 및 대국 목록) 로드 (1~15회 전 회차 지원)
 * 9회차 이상은 `${session} (raw)` 우선 참조, 1~8회차는 내장 정밀 데이터 및 `${session}` 참조
 */
export async function fetchPublicSessionDetail(
  sessionName: string,
  spreadsheetId?: string,
  forceRefresh: boolean = false
): Promise<SessionDetail> {
  const expectedCount = getExpectedSessionGameCount(sessionName);

  if (!forceRefresh && cachedSessionsDetail[sessionName]) {
    const cached = cachedSessionsDetail[sessionName];
    if (!isValidSessionDetailObject(cached, sessionName) || (expectedCount > 0 && cached.games.length < expectedCount)) {
      delete cachedSessionsDetail[sessionName];
    } else {
      return cached;
    }
  }

  const isPastSession = isPastImmutableSessionClient(sessionName);
  if (!forceRefresh && isPastSession) {
    const localCached = readPastSessionLocalCache<SessionDetail>(`detail_${sessionName}`);
    if (localCached) {
      if (
        !isValidSessionDetailObject(localCached, sessionName) ||
        (expectedCount > 0 && localCached.games.length < expectedCount)
      ) {
        removePastSessionLocalCache(`detail_${sessionName}`);
      } else {
        cachedSessionsDetail[sessionName] = localCached;
        return localCached;
      }
    }
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
      const refreshParam = forceRefresh ? `&refresh=1&_t=${Date.now()}` : `&_t=${Date.now()}`;
      const res = await fetchWithTimeout(
        `${workerUrl}/api/public/session-detail?session=${encodeURIComponent(sessionName)}${refreshParam}`,
        { cache: 'no-store' }
      );
      if (res.ok) {
        const data = await res.json();
        if (data.table) {
          const rawCheck = isRawSessionSheetTable(data.table);
          if (!isRawFormat || rawCheck) {
            table = data.table;
            isRawParsed = rawCheck;
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
        // 9회차 이상: (raw) 시트 우선 조회 (미존재 시 GViz가 첫 번째 탭을 반환하므로 헤더 검증 필수)
        try {
          const rawSheetName = `${sessionName} (raw)`;
          const gvizUrl = `https://docs.google.com/spreadsheets/d/${sId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(rawSheetName)}&_t=${Date.now()}`;
          const res = await fetchWithTimeout(gvizUrl, { cache: 'no-store' });
          if (res.ok) {
            const text = await res.text();
            const gvizData = parseGVizResponse(text);
            if (gvizData && gvizData.table && isRawSessionSheetTable(gvizData.table)) {
              table = gvizData.table;
              isRawParsed = true;
            }
          }
        } catch (e) {
          console.warn(`${sessionName} (raw) fetch failed:`, e);
        }
      } else {
        // 8회차 이하인 경우 일반 회차 시트 조회
        try {
          const gvizUrl = `https://docs.google.com/spreadsheets/d/${sId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sessionName)}&_t=${Date.now()}`;
          const res = await fetchWithTimeout(gvizUrl, { cache: 'no-store' });
          if (res.ok) {
            const text = await res.text();
            const gvizData = parseGVizResponse(text);
            if (gvizData && gvizData.table) {
              table = gvizData.table;
              isRawParsed = isRawSessionSheetTable(gvizData.table);
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
  const hasRawCols = isRawSessionSheetTable(table);
  let detail: SessionDetail;
  if (isRawParsed || hasRawCols) {
    detail = parseRawSessionSheet(table, sessionName);
  } else {
    detail = parseSessionSheetTable(table, sessionName);
  }

  // 만약 알려진 대국 수(예: 15국)보다 적은 구버전 캐시(예: 13국)가 반환되었다면 즉시 강제 새로고침 재시도
  if (!forceRefresh && expectedCount > 0 && detail.games.length < expectedCount) {
    removePastSessionLocalCache(`detail_${sessionName}`);
    delete cachedSessionsDetail[sessionName];
    return fetchPublicSessionDetail(sessionName, spreadsheetId, true);
  }

  if (isValidSessionDetailObject(detail, sessionName)) {
    cachedSessionsDetail[sessionName] = detail;
    if (isPastSession && detail.games.length > 0) {
      writePastSessionLocalCache(`detail_${sessionName}`, detail);
    }
  }
  return detail;
}

/**
 * 3-1. 9회차 이후 특정 회차의 출전자 전원 세부 스탯 (화료율, 방총율, 리치스탯, 국수지 등 4대 탭 전체 통계) 집계
 * - 1순위: 과거 완료 회차인 경우 localStorage 캐시 우선 반환
 * - 2순위: Worker 회차별 국별 기록(`/api/public/rounds?session=...`)을 조회하여 실시간 집계
 */
export async function fetchSessionDetailedStats(
  sessionName: string,
  spreadsheetId?: string,
  forceRefresh: boolean = false
): Promise<Record<string, MemberStatItem>> {
  const expectedCount = getExpectedSessionGameCount(sessionName);

  if (!forceRefresh && cachedSessionDetailedStats[sessionName]) {
    const cachedMap = cachedSessionDetailedStats[sessionName];
    const cachedGamesCount = Math.round(
      Object.values(cachedMap).reduce((sum, item) => sum + (item.totalGames || 0), 0) / 4
    );
    if (expectedCount > 0 && cachedGamesCount < expectedCount) {
      delete cachedSessionDetailedStats[sessionName];
    } else {
      return cachedMap;
    }
  }

  const match = sessionName.match(/제(\d+)회/);
  const sessionNum = match ? parseInt(match[1], 10) : 0;
  if (sessionNum < 9) {
    // 1~8회차는 국별 기록이 없는 레거시 회차
    return {};
  }

  const isPastSession = isPastImmutableSessionClient(sessionName);
  if (!forceRefresh && isPastSession) {
    const localCached = readPastSessionLocalCache<Record<string, MemberStatItem>>(`stats_${sessionName}`);
    if (localCached && Object.keys(localCached).length > 0) {
      const cachedGamesCount = Math.round(
        Object.values(localCached).reduce((sum, item) => sum + (item.totalGames || 0), 0) / 4
      );
      if (expectedCount > 0 && cachedGamesCount < expectedCount) {
        removePastSessionLocalCache(`stats_${sessionName}`);
      } else {
        cachedSessionDetailedStats[sessionName] = localCached;
        return localCached;
      }
    }
  }

  // 회차별 국별 기록에서 직접 집계
  try {
    const sessionRows = await fetchSessionRoundsRows(sessionName, spreadsheetId, forceRefresh);
    if (!sessionRows || sessionRows.length === 0) {
      return {};
    }

    // 세션 매칭 정규화 (예: "제15회 260926" -> match "제15회")
    const sessTargetMatch = sessionName.match(/제\d+회/);
    const sessPrefix = sessTargetMatch ? sessTargetMatch[0] : sessionName;

    const rawAgg: Record<string, {
      name: string;
      gameIds: Set<string>;
      gameUmaById: Map<string, { maxSeq: number; uma: number }>;
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
      chaseRiichiWinCount: number;
      chasedRiichiCount: number;
      loseWithRiichiCount: number;
      oyaTsumoSufferedCount: number;
      oyaManganSufferedCount: number;
      oyaManganLossSum: number;
      tobiGameIds: Set<string>;
      tobiCount: number;
      cheatCount: number;
      beolbuCount: number;
    }> = {};

    sessionRows.forEach((r: any) => {
      if (!r.c) return;
      const rowSess = getCellStr(r.c[15]);
      if (!rowSess.includes(sessPrefix) && !sessPrefix.includes(rowSess)) return;

      const player = getCellStr(r.c[5]).trim();
      if (!player) return;

      if (!rawAgg[player]) {
        rawAgg[player] = {
          name: player,
          gameIds: new Set<string>(),
          gameUmaById: new Map<string, { maxSeq: number; uma: number }>(),
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
          chaseRiichiWinCount: 0,
          chasedRiichiCount: 0,
          loseWithRiichiCount: 0,
          oyaTsumoSufferedCount: 0,
          oyaManganSufferedCount: 0,
          oyaManganLossSum: 0,
          tobiGameIds: new Set<string>(),
          tobiCount: 0,
          cheatCount: 0,
          beolbuCount: 0,
        };
      }

      const p = rawAgg[player];
      p.totalRounds++;

      const gameId = getCellStr(r.c[1]).trim();
      const roundSeq = getCellNum(r.c[3], 0);
      const rank = getCellNum(r.c[13]);
      const uma = getCellNum(r.c[14]);
      const finalScore = getCellNum(r.c[8]);

      if (gameId) {
        if (!p.gameIds.has(gameId)) {
          p.gameIds.add(gameId);
          if (rank >= 1 && rank <= 4) {
            p.ranks[rank]++;
            p.rankSum += rank;
          }
          p.gameUmaById.set(gameId, { maxSeq: roundSeq, uma });
          p.totalUmaSum += uma;
        } else {
          const prev = p.gameUmaById.get(gameId);
          if (prev && roundSeq >= prev.maxSeq) {
            p.totalUmaSum += uma - prev.uma;
            prev.maxSeq = roundSeq;
            prev.uma = uma;
          }
        }
      }

      if (gameId && finalScore < 0 && !p.tobiGameIds.has(gameId)) {
        p.tobiGameIds.add(gameId);
        p.tobiCount++;
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
      const uVal = r.c[20]?.v;
      const isCheat = uVal === true || uVal === "TRUE" || uVal === 1 || (uVal === undefined && endStatus === "cheat" && delta < 0);
      const beolbuCnt = getCellNum(r.c[21], 0);

      if (isCheat) p.cheatCount++;
      if (beolbuCnt > 0) p.beolbuCount += beolbuCnt;

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
        if (isChase) {
          p.chaseRiichiCount++;
          if (isWin) p.chaseRiichiWinCount++;
        }
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
      const chaseRiichiWinRate = p.chaseRiichiCount > 0 ? parseFloat(((p.chaseRiichiWinCount / p.chaseRiichiCount) * 100).toFixed(2)) : 0;
      const chasedRiichiRate = p.riichiCount > 0 ? parseFloat(((p.chasedRiichiCount / p.riichiCount) * 100).toFixed(2)) : 0;
      const oyaKaburiRate = p.oyaTsumoSufferedCount > 0 ? parseFloat(((p.oyaManganSufferedCount / p.oyaTsumoSufferedCount) * 100).toFixed(2)) : 0;
      const oyaKaburiAvg = p.oyaManganSufferedCount > 0 ? Math.round(p.oyaManganLossSum / p.oyaManganSufferedCount) : 0;
      const dealInRiichiRate = p.loseCount > 0 ? parseFloat(((p.loseWithRiichiCount / p.loseCount) * 100).toFixed(2)) : 0;
      const cheatRate = parseFloat(((p.cheatCount / totalRounds) * 100).toFixed(4));
      const beolbuRate = parseFloat(((p.beolbuCount / totalRounds) * 100).toFixed(4));

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
        chaseRiichiWinRate,
        chaseRiichiCount: p.chaseRiichiCount,
        chaseRiichiWinCount: p.chaseRiichiWinCount,
        chasedRiichiRate,
        oyaKaburiRate,
        oyaKaburiAvg,
        dealInRiichiRate,
        cheatRate,
        beolbuRate,
        cheatCount: p.cheatCount,
        beolbuCount: p.beolbuCount,
        totalScore: p.roundSujiSum,
      };
    }

    cachedSessionDetailedStats[sessionName] = resultMap;
    if (isPastSession && Object.keys(resultMap).length > 0) {
      writePastSessionLocalCache(`stats_${sessionName}`, resultMap);
    }
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

export async function fetchPublicStatsMatrix(spreadsheetId?: string, forceRefresh: boolean = false): Promise<StatsMatrixData> {
  if (!forceRefresh && cachedStatsMatrix && cachedStatsMatrix.rows.length > 0) {
    return cachedStatsMatrix;
  }
  if (!forceRefresh && pendingStatsMatrixPromise) {
    return pendingStatsMatrixPromise;
  }

  pendingStatsMatrixPromise = (async () => {
    try {
      const workerUrl = getWorkerUrl();
      let table: any = null;

      // A. Worker 시도 (스프레드시트 ID는 서버 내부 Secret에서 자동 복호화)
      if (workerUrl) {
        try {
          const refreshQuery = forceRefresh ? `?refresh=1&_t=${Date.now()}` : '';
          const res = await fetchWithTimeout(`${workerUrl}/api/public/stats-matrix${refreshQuery}`, { cache: 'no-store' });
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
          const res = await fetchWithTimeout(gvizUrl);
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

          // 해당 열에 실측 데이터가 1건이라도 존재하는지 검증
          let hasValidValue = false;
          for (let r = 0; r < table.rows.length; r++) {
            const cell = table.rows[r]?.c?.[c];
            if (cell && cell.v !== null && cell.v !== undefined && cell.v !== '') {
              hasValidValue = true;
              break;
            }
          }

          const hasGameCountHeader = /\d+\s*국/.test(label);

          // 데이터가 아예 없거나, 헤더에 '국' 표기가 없는 미개최 회차는 제외
          if (!hasValidValue && !hasGameCountHeader) {
            continue;
          }
          if (!hasValidValue) {
            continue;
          }

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

        const sheetTotal = parseFloat(getCellNum(r.c[1]).toFixed(1));
        const sessionUmas: Record<string, number | null> = {};
        let computedSessionSum = 0;
        let hasAnySessionVal = false;

        for (let c = 2; c < cols.length; c++) {
          const label = cols[c]?.label || "";
          const match = label.match(/제\d+회/);
          if (match) {
            const sessName = match[0];
            if (!sessions.includes(sessName)) continue; // 미개최 회차 스킵
            const cell = r.c[c];
            if (cell && (cell.v !== null && cell.v !== undefined || cell.f !== null && cell.f !== undefined)) {
              const val = parseFloat(getCellNum(cell).toFixed(1));
              sessionUmas[sessName] = val;
              computedSessionSum += val;
              hasAnySessionVal = true;
            } else {
              sessionUmas[sessName] = null;
            }
          }
        }

        // 시트 B열 수식이 과거 열(예: AA)까지만 합산되어 있는 경우에도 전체 회차 열 합계로 정확한 누적 우마 산출
        const total = hasAnySessionVal ? parseFloat(computedSessionSum.toFixed(1)) : sheetTotal;

        rows.push({
          name,
          total,
          sessionUmas,
        });
      });

      // 총합 내림차순 정렬
      rows.sort((a, b) => b.total - a.total);

      const matrixResult = {
        sessions,
        sessionLabels,
        rows,
      };
      if (rows.length > 0) {
        cachedStatsMatrix = matrixResult;
      }
      return matrixResult;
    } finally {
      pendingStatsMatrixPromise = null;
    }
  })();

  return pendingStatsMatrixPromise;
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
  '#0891b2', '#ea580c', '#059669', '#4f46e5', '#65a30d', '#9333ea',
  '#e11d48', '#0284c7', '#ca8a04', '#475569', '#84cc16', '#a855f7',
  '#f43f5e', '#06b6d4', '#10b981', '#f97316', '#6366f1', '#ec4899',
  '#14b8a6', '#8b5cf6', '#f59e0b', '#3b82f6', '#15803d', '#be185d',
  '#0369a1', '#b91c1c', '#6d28d9', '#c2410c', '#047857', '#4338ca',
  '#4d7c0f', '#701a75', '#0e7490', '#9f1239'
];

export function getPlayerColor(index: number): string {
  if (index < PLAYER_COLORS.length) {
    return PLAYER_COLORS[index];
  }
  const hue = Math.round((index * 137.508) % 360);
  const lightness = 42 + ((index % 3) * 6);
  const saturation = 75 + ((index % 2) * 15);
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

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
      color: getPlayerColor(i),
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

export interface RatingTrajectoryDataset {
  name: string;
  color: string;
  data: number[];
  deltas: (number | null)[];
  umas?: (number | null)[];
  ranks: (number | null)[];
  played: boolean[];
  hasMarker: boolean[];
  finalRating: number;
}

export interface AllPlayersRatingTrajectory {
  labels: string[];
  datasets: RatingTrajectoryDataset[];
}

/**
 * 5-1. 역대 경기별 전체 플레이어 레이팅 궤적 산출
 */
export function calculateAllPlayersRatingTrajectory(
  history: GameRatingHistoryRecord[],
  playerList?: string[]
): AllPlayersRatingTrajectory {
  const initialRating = computeOrdinal(DEFAULT_MU, DEFAULT_SIGMA); // 1320
  const sessionGameCounters: Record<string, number> = {};
  const labels = ['시작'];
  history.forEach(g => {
    const raw = g.sessionLabel || '';
    const sessMatch = raw.match(/제\s*(\d+)\s*회/);
    if (sessMatch) {
      const sessName = `제${sessMatch[1]}회`;
      sessionGameCounters[sessName] = (sessionGameCounters[sessName] || 0) + 1;
      const roundNum = sessionGameCounters[sessName];
      const normalized = `${sessName} ${roundNum}회전`;
      g.sessionLabel = normalized;
      labels.push(normalized);
    } else {
      labels.push(raw || `${g.gameIndex}국`);
    }
  });

  const playerSet = new Set<string>(playerList || []);
  history.forEach(g => {
    g.players.forEach(p => playerSet.add(p.name));
  });
  const members = Array.from(playerSet);

  const trajMap: Record<string, number[]> = {};
  const playedMap: Record<string, boolean[]> = {};
  const deltasMap: Record<string, (number | null)[]> = {};
  const umasMap: Record<string, (number | null)[]> = {};
  const ranksMap: Record<string, (number | null)[]> = {};
  const currentRatingMap: Record<string, number> = {};

  members.forEach(name => {
    trajMap[name] = [initialRating];
    playedMap[name] = [false];
    deltasMap[name] = [null];
    umasMap[name] = [null];
    ranksMap[name] = [null];
    currentRatingMap[name] = initialRating;
  });

  const totalGames = history.length;
  history.forEach(g => {
    members.forEach(name => {
      const match = g.players.find(p => p.name === name);
      if (match) {
        currentRatingMap[name] = match.ordinal;
        trajMap[name].push(match.ordinal);
        playedMap[name].push(true);
        deltasMap[name].push(match.delta);
        umasMap[name].push(match.uma ?? null);
        ranksMap[name].push(match.rank);
      } else {
        trajMap[name].push(currentRatingMap[name]); // 이전 점수 유지
        playedMap[name].push(false);
        deltasMap[name].push(null);
        umasMap[name].push(null);
        ranksMap[name].push(null);
      }
    });
  });

  const datasets: RatingTrajectoryDataset[] = members.map((name, i) => {
    const data = trajMap[name];
    const played = playedMap[name];
    const deltas = deltasMap[name];
    const umas = umasMap[name];
    const ranks = ranksMap[name];
    const finalRating = currentRatingMap[name];

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
      color: getPlayerColor(i),
      finalRating,
      played,
      deltas,
      umas,
      ranks,
      hasMarker
    };
  });

  datasets.sort((a, b) => b.finalRating - a.finalRating);

  return {
    labels,
    datasets
  };
}

let cachedRatingTrajectory: AllPlayersRatingTrajectory | null = null;
let cachedRatingHistoryRecords: GameRatingHistoryRecord[] | null = null;
let pendingRatingTimelinePromise: Promise<AllPlayersRatingTrajectory> | null = null;

/**
 * 경기별 레이팅 변화 이력 전체 조회 (캐시 활용)
 */
export async function fetchPublicRatingHistoryRecords(spreadsheetId?: string, forceRefresh: boolean = false): Promise<GameRatingHistoryRecord[]> {
  if (!forceRefresh && cachedRatingHistoryRecords && cachedRatingHistoryRecords.length > 0) {
    return cachedRatingHistoryRecords;
  }
  await fetchPublicRatingTimeline(spreadsheetId, forceRefresh);
  return cachedRatingHistoryRecords || [];
}

/**
 * 5-2. '레이팅 이력' 시트 또는 온디맨드 리플레이를 통해 전체 플레이어 레이팅 타임라인 조회
 */
export async function fetchPublicRatingTimeline(spreadsheetId?: string, forceRefresh: boolean = false): Promise<AllPlayersRatingTrajectory> {
  if (!forceRefresh && cachedRatingTrajectory) return cachedRatingTrajectory;
  if (!forceRefresh && pendingRatingTimelinePromise) return pendingRatingTimelinePromise;

  pendingRatingTimelinePromise = (async () => {
    try {
      const workerUrl = getWorkerUrl();
      let table: any = null;

      // A. Worker 시도 (서버가 자체 Secret에서 스프레드시트 ID 복호화)
      if (workerUrl) {
        try {
          const refreshQuery = forceRefresh ? `?refresh=1&_t=${Date.now()}` : '';
          const res = await fetchWithTimeout(`${workerUrl}/api/public/rating-history${refreshQuery}`, { cache: 'no-store' });
          if (res.ok) {
            const data = await res.json();
            if (data.table) table = data.table;
          }
        } catch (e) {
          console.warn("Worker rating history request failed, falling back to direct GViz:", e);
        }
      }

      // B. Google GViz 폴백 (클라이언트 암호화 토큰 복호화 ID 사용)
      if (!table) {
        const sId = spreadsheetId || await resolveSpreadsheetId();
        if (sId) {
          try {
            const gvizUrl = `https://docs.google.com/spreadsheets/d/${sId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent('레이팅 이력')}`;
            const res = await fetchWithTimeout(gvizUrl);
            if (res.ok) {
              const text = await res.text();
              const data = parseGVizResponse(text);
              if (data && data.table) table = data.table;
            }
          } catch (e) {
            console.warn("'레이팅 이력' 시트 조회 실패, 온디맨드 리플레이 폴백 사용:", e);
          }
        }
      }

      // C. 조회된 '레이팅 이력' 테이블 파싱 및 최신(/30) 엔진 실시간 리플레이
      if (table && table.rows && table.rows.length > 0) {
        // '레이팅 이력' 시트가 없을 경우 GViz가 첫 번째 시트를 반환하므로 헤더를 검증
        const isHistorySheet = table.cols && table.cols.some((c: any) => c && (c.label === '대국 번호' || c.label === '1위 이름' || c.label === '1위 점수' || c.label === '1위'));
        const isHistoryRow0 = table.rows[0] && table.rows[0].c && table.rows[0].c.some((c: any) => {
          const s = getCellStr(c).trim();
          return s === '대국 번호' || s === '1위 이름' || s === '1위 점수' || s === '1위';
        });

        if (isHistorySheet || isHistoryRow0) {
          // 0) 별표(★) 변형 표기(예: 제3회 '신시' + 제25회 '신시★')를 최신 표기명으로 사전 통합
          const canonicalNameByNorm = new Map<string, string>();
          table.rows.forEach((r: any) => {
            if (!r.c) return;
            const sessLabel = getCellStr(r.c[1]).trim();
            if (!sessLabel || sessLabel === '회차') return;
            const is5Col = r.c.length >= 23 || (r.c[5] && typeof r.c[5].v === 'number' && Math.abs(Number(r.c[5].v)) <= 150 && r.c[6] && Number(r.c[6].v) > 800);
            const stride = is5Col ? 5 : 4;
            for (let i = 0; i < 4; i++) {
              const pName = getCellStr(r.c[3 + i * stride]).trim();
              const norm = normalizeRatingPlayerName(pName);
              if (pName && norm) {
                canonicalNameByNorm.set(norm, pName);
              }
            }
          });

          let runningRatings: Record<string, PlayerRating> = {};
          const historyRecords: GameRatingHistoryRecord[] = [];

          table.rows.forEach((r: any) => {
            if (!r.c) return;
            const gameIdx = Number(getCellNum(r.c[0])) || 0;
            const sessLabel = getCellStr(r.c[1]).trim();
            const dateStr = formatSheetDateValue(getCellStr(r.c[2]).trim());
            if (!sessLabel || sessLabel === '회차') return;

            // 5열(우마 포함) 또는 4열(점수만) 규격 자동 판별
            const is5Col = r.c.length >= 23 || (r.c[5] && typeof r.c[5].v === 'number' && Math.abs(Number(r.c[5].v)) <= 150 && r.c[6] && Number(r.c[6].v) > 800);
            const stride = is5Col ? 5 : 4;

            const matchPlayers: { name: string; rank: number; score: number; uma?: number }[] = [];
            for (let i = 0; i < 4; i++) {
              const baseCol = 3 + i * stride;
              const rawName = getCellStr(r.c[baseCol]).trim();
              if (rawName) {
                const norm = normalizeRatingPlayerName(rawName);
                const pName = (norm && canonicalNameByNorm.get(norm)) || rawName;
                const pScore = Number(getCellNum(r.c[baseCol + 1])) || 0;
                let pUma: number | undefined = undefined;
                if (is5Col) {
                  const umaCell = r.c[baseCol + 2];
                  if (umaCell && umaCell.v !== null && umaCell.v !== undefined && umaCell.v !== '') {
                    pUma = Number(getCellNum(umaCell));
                  }
                }
                matchPlayers.push({
                  name: pName,
                  rank: i + 1,
                  score: pScore,
                  uma: pUma
                });
              }
            }

            if (matchPlayers.length === 4) {
              const curGameIdx = gameIdx || (historyRecords.length + 1);
              const { updatedRatings, matchDeltas } = calculateMatchRatings(matchPlayers, runningRatings, {
                gameIndex: curGameIdx,
                sessionLabel: sessLabel,
                date: dateStr
              });
              Object.assign(runningRatings, updatedRatings);

              const pList = matchPlayers.map(mp => {
                const d = matchDeltas[mp.name];
                const calcUma = mp.uma !== undefined && !isNaN(mp.uma)
                  ? mp.uma
                  : parseFloat((((mp.score - 30000) / 1000) + (mp.rank === 1 ? 40 : (mp.rank === 2 ? 10 : (mp.rank === 3 ? -10 : -20)))).toFixed(1));
                return {
                  name: mp.name,
                  rank: mp.rank,
                  score: mp.score,
                  uma: calcUma,
                  ordinal: d ? d.newOrdinal : 1320,
                  delta: d ? d.delta : 0
                };
              });

              historyRecords.push({
                gameIndex: curGameIdx,
                sessionLabel: sessLabel,
                date: dateStr,
                players: pList
              });
            }
          });

          if (historyRecords.length >= 107) {
            cachedRatingHistoryRecords = historyRecords;
            cachedRatings = runningRatings;
            const traj = calculateAllPlayersRatingTrajectory(historyRecords);
            cachedRatingTrajectory = traj;
            return traj;
          }
        }
      }

      // D. 폴백: 내장 레거시 데이터 리플레이 (기존 '레이팅' 시트 데이터가 있으면 덮어쓰지 않고 보존)
      const { finalRatings, matchHistory } = replayAllHistoricalGames(LEGACY_CONSOLIDATED_RAW, []);
      cachedRatings = { ...finalRatings, ...(cachedRatings || {}) };
      cachedRatingHistoryRecords = matchHistory;
      const traj = calculateAllPlayersRatingTrajectory(matchHistory);
      cachedRatingTrajectory = traj;
      return traj;
    } finally {
      pendingRatingTimelinePromise = null;
    }
  })();

  return pendingRatingTimelinePromise;
}

/**
 * 특정 회차의 대국 목록에 대국 전/후 레이팅 및 변동치를 주입
 */
export function attachRatingToSessionGames(
  sessionName: string,
  games: SessionGame[],
  historyRecords: GameRatingHistoryRecord[]
): void {
  if (!games || games.length === 0 || !historyRecords || historyRecords.length === 0) return;

  const sessTargetMatch = sessionName.match(/제\s*(\d+)\s*회/);
  const sessionNum = sessTargetMatch ? parseInt(sessTargetMatch[1], 10) : 0;
  const sessionPrefix = sessTargetMatch ? sessTargetMatch[0] : sessionName;

  const sessionRecords = historyRecords.filter(r => {
    const rMatch = r.sessionLabel.match(/제\s*(\d+)\s*회/);
    if (rMatch) {
      return parseInt(rMatch[1], 10) === sessionNum;
    }
    return r.sessionLabel.includes(sessionPrefix);
  });

  games.forEach((game, gameIdx) => {
    const gamePlayerNorms = new Set(game.players.map(p => normalizeRatingPlayerName(p.name)));
    let matchedRecord = sessionRecords.find(r => {
      return r.players.length === 4 && r.players.filter(p => gamePlayerNorms.has(normalizeRatingPlayerName(p.name))).length === 4;
    });

    if (!matchedRecord && sessionRecords[gameIdx]) {
      matchedRecord = sessionRecords[gameIdx];
    } else if (matchedRecord) {
      const candidateRecords = sessionRecords.filter(r => {
        return r.players.length === 4 && r.players.filter(p => gamePlayerNorms.has(normalizeRatingPlayerName(p.name))).length === 4;
      });
      if (candidateRecords.length > 1) {
        const scoreMatched = candidateRecords.find(r => {
          return r.players.every(hp => {
            const hpNorm = normalizeRatingPlayerName(hp.name);
            const gp = game.players.find(p => normalizeRatingPlayerName(p.name) === hpNorm);
            return gp && gp.score === hp.score;
          });
        });
        if (scoreMatched) matchedRecord = scoreMatched;
      }
    }

    if (matchedRecord) {
      game.players.forEach(p => {
        const pNorm = normalizeRatingPlayerName(p.name);
        const hp = matchedRecord!.players.find(hp => hp.name === p.name || normalizeRatingPlayerName(hp.name) === pNorm);
        if (hp) {
          p.ratingAfter = hp.ordinal;
          p.ratingDelta = hp.delta;
          p.ratingBefore = hp.ordinal - hp.delta;
        }
      });
    }
  });
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

export interface RatingBandAverageMarker {
  key: string;
  label: string;
  color: string;
  avg: number;
  count: number;
  x: number; // SVG 0..160 X좌표
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
  ratingBandAverages: RatingBandAverageMarker[];
  line30X: number; // 하위 30% X좌표
  line70X: number; // 상위 30% X좌표
  higherIsBetter?: boolean;
  isUnrecorded?: boolean;
}

export function calculateMetricDistribution(
  allStats: MemberStatItem[],
  metricKey: keyof MemberStatItem,
  metricName: string,
  currentValue: number,
  unit: string = '%',
  higherIsBetter: boolean = true,
  currentPlayerName?: string,
  isUnrecorded: boolean = false
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
      ratingBandAverages: [],
      line30X: 48,
      line70X: 112,
      isUnrecorded,
    };
  }

  // 전체 멤버 중 총 대국수가 0인 비활동 멤버는 히스토그램 및 통계 분포에서 제외
  const validMembers = allStats
    .filter(s => (s.totalGames || 0) > 0)
    .map(s => ({
      name: s.name,
      val: Number(s[metricKey]),
      rating: typeof s.rating === 'number' && !isNaN(s.rating) ? s.rating : undefined,
    }))
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
      ratingBandAverages: [],
      line30X: 48,
      line70X: 112,
      isUnrecorded,
    };
  }

  const values = validMembers.map(m => m.val);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const sum = values.reduce((acc, v) => acc + v, 0);
  const avg = metricKey === 'avgRank'
    ? parseFloat((sum / values.length).toFixed(3))
    : (metricKey === 'cheatRate' || metricKey === 'beolbuRate')
      ? parseFloat((sum / values.length).toFixed(4))
      : unit === '%'
        ? parseFloat((sum / values.length).toFixed(2))
        : parseFloat((sum / values.length).toFixed(1));

  // 순위 및 백분위 계산 (모수 인원수를 초과하지 않도록 클램핑)
  let rawRank = 1;
  values.forEach(v => {
    if (higherIsBetter) {
      if (v > currentValue) rawRank++;
    } else {
      if (v < currentValue) rawRank++;
    }
  });
  const rank = Math.min(rawRank, values.length);

  const topPct = Math.min(100, parseFloat(((rank / values.length) * 100).toFixed(2)));
  const bottomPct = Math.max(0, parseFloat((100 - topPct).toFixed(2)));
  const isUpperHalf = rank <= Math.ceil(values.length / 2);
  const percentileText = isUnrecorded
    ? `세부 스탯 집계 기록 없음 · 전체 ${values.length}명 분포`
    : `상위 ${topPct.toFixed(2)}% (하위 ${bottomPct.toFixed(2)}%) · ${isUpperHalf ? '상위 50% 이내' : '하위 50%'}`;

  // 사람 1명당 1개 막대의 계단형 히스토그램 (오름차순 정렬)
  const sorted = [...validMembers].sort((a, b) => a.val - b.val);
  const svgWidth = 160;
  const baseline = 38;
  const topY = 6;
  const range = max - min === 0 ? 1 : max - min;
  const n = sorted.length;
  const stepW = svgWidth / Math.max(n, 1);
  const barWidth = Math.max(1.8, stepW - 0.8);

  // 대상 플레이어 매칭 (미집계 대상이 아닌 경우에만 이름 매칭; 이름 미지정 시 값 매칭)
  let matchedIndex = -1;
  if (!isUnrecorded) {
    if (currentPlayerName) {
      matchedIndex = sorted.findIndex(m => m.name === currentPlayerName);
    } else {
      matchedIndex = sorted.findIndex(m => Math.abs(m.val - currentValue) < 0.0001);
    }
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

  // 레이팅 구간별 평균치 및 SVG X좌표 보간 계산 (100단위 숫자 + 색상만 사용)
  const bandDefs = [
    { key: '1700+', label: '1700+', minR: 1700, maxR: 99999, sampleR: 1750 },
    { key: '1600', label: '1600대', minR: 1600, maxR: 1699, sampleR: 1650 },
    { key: '1500', label: '1500대', minR: 1500, maxR: 1599, sampleR: 1550 },
    { key: '1400', label: '1400대', minR: 1400, maxR: 1499, sampleR: 1450 },
    { key: '1300', label: '1300대', minR: 1300, maxR: 1399, sampleR: 1350 },
    { key: '1200', label: '1200대', minR: 1200, maxR: 1299, sampleR: 1250 },
    { key: 'below1200', label: '1200미만', minR: -99999, maxR: 1199, sampleR: 1150 },
  ];

  const valueToSvgX = (targetVal: number): number => {
    if (n <= 1) return svgWidth / 2;
    const centerX = (idx: number) => idx * stepW + stepW / 2;
    if (targetVal <= sorted[0].val) return parseFloat(centerX(0).toFixed(1));
    if (targetVal >= sorted[n - 1].val) return parseFloat(centerX(n - 1).toFixed(1));
    for (let i = 0; i < n - 1; i++) {
      const v0 = sorted[i].val;
      const v1 = sorted[i + 1].val;
      if (targetVal >= v0 && targetVal <= v1) {
        const t = v1 === v0 ? 0.5 : (targetVal - v0) / (v1 - v0);
        return parseFloat((centerX(i) + t * (centerX(i + 1) - centerX(i))).toFixed(1));
      }
    }
    return svgWidth / 2;
  };

  const formatBandAvg = (rawAvg: number): number => {
    if (metricKey === 'avgRank') return parseFloat(rawAvg.toFixed(3));
    if (metricKey === 'cheatRate' || metricKey === 'beolbuRate') return parseFloat(rawAvg.toFixed(4));
    if (unit === '%') return parseFloat(rawAvg.toFixed(2));
    return parseFloat(rawAvg.toFixed(1));
  };

  const ratingBandAverages: RatingBandAverageMarker[] = [];
  for (const bd of bandDefs) {
    const membersInBand = validMembers.filter(
      (m) => m.rating !== undefined && Math.round(m.rating) >= bd.minR && Math.round(m.rating) <= bd.maxR
    );
    if (membersInBand.length === 0) continue;
    const bandRawAvg = membersInBand.reduce((acc, cur) => acc + cur.val, 0) / membersInBand.length;
    const bandAvg = formatBandAvg(bandRawAvg);
    ratingBandAverages.push({
      key: bd.key,
      label: bd.label,
      color: getRatingColor(bd.sampleR),
      avg: bandAvg,
      count: membersInBand.length,
      x: valueToSvgX(bandRawAvg),
    });
  }

  // 두 개 이상의 레이팅 구간 평균 실선이 겹쳐 하나만 보이지 않도록 최소 간격 확보
  if (ratingBandAverages.length > 1) {
    const MIN_GAP = 1.75;
    const MIN_X = 1.5;
    const MAX_X = svgWidth - 1.5;
    const byX = [...ratingBandAverages].sort((a, b) => a.x - b.x);

    let i = 0;
    while (i < byX.length) {
      let j = i;
      while (j + 1 < byX.length && byX[j + 1].x - byX[j].x < MIN_GAP) {
        j++;
      }
      if (j > i) {
        const count = j - i + 1;
        const avgX = byX.slice(i, j + 1).reduce((s, item) => s + item.x, 0) / count;
        const span = (count - 1) * MIN_GAP;
        let startX = avgX - span / 2;
        if (startX < MIN_X) startX = MIN_X;
        if (startX + span > MAX_X) startX = Math.max(MIN_X, MAX_X - span);
        for (let k = 0; k < count; k++) {
          byX[i + k].x = parseFloat((startX + k * MIN_GAP).toFixed(2));
        }
      }
      i = j + 1;
    }

    for (let k = 1; k < byX.length; k++) {
      if (byX[k].x - byX[k - 1].x < MIN_GAP) {
        byX[k].x = parseFloat(Math.min(MAX_X, byX[k - 1].x + MIN_GAP).toFixed(2));
      }
    }
    for (let k = byX.length - 2; k >= 0; k--) {
      if (byX[k + 1].x - byX[k].x < MIN_GAP) {
        byX[k].x = parseFloat(Math.max(MIN_X, byX[k + 1].x - MIN_GAP).toFixed(2));
      }
    }
  }

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
    higherIsBetter,
    isUnrecorded,
    bars,
    ratingBandAverages,
    line30X: parseFloat((svgWidth * 0.3).toFixed(1)), // 하위 30% (48)
    line70X: parseFloat((svgWidth * 0.7).toFixed(1)), // 상위 30% (112)
  };
}

// ==========================================
// 회차 대국 상세 결과 및 국별 점수변동/스탯 집계
// ==========================================
export interface GamePlayerResultStat {
  seat: string; // 東, 南, 西, 北
  name: string;
  rank: number;
  score: number;
  uma: number;
  ratingBefore?: number;
  ratingAfter?: number;
  ratingDelta?: number;
  cntRiichi: number;
  cntRon: number;
  cntTsumo: number;
  cntLose: number;
}

export interface GameScoreChartData {
  labels: string[];
  datasets: {
    label: string;
    data: number[];
    borderColor: string;
    backgroundColor: string;
    pointRadius: number;
  }[];
}

export interface GameRoundPlayerMovement {
  seat: string;
  name: string;
  scoreBefore: number;
  deltaScore: number;
  scoreAfter: number;
  isRiichi: boolean;
  isWin: boolean;
  isLose: boolean;
}

export interface GameRoundMovement {
  roundIndex: number;
  roundName: string;
  roundStatus: string;
  players: GameRoundPlayerMovement[];
}

export interface GameDetailRecord {
  gameId: string;
  gameIndex: number;
  time: string;
  hasRoundDetails: boolean;
  playerStats: GamePlayerResultStat[];
  chartData: GameScoreChartData;
  roundDetailsList?: GameRoundMovement[];
}

function buildGameDetailFromLocalRecords(game: SessionGame, records: any, playerNames?: string[]): GameDetailRecord {
  const pNames = playerNames && playerNames.length === 4 ? playerNames : game.players.map(p => p.name);
  const seatOrder = ["東", "南", "西", "北"];
  const sortedGamePlayers = [...game.players].sort((a, b) => {
    return seatOrder.indexOf(a.seat) - seatOrder.indexOf(b.seat);
  });

  const playerStats: GamePlayerResultStat[] = sortedGamePlayers.map((p, idx) => {
    const pIdx = pNames.indexOf(p.name) !== -1 ? pNames.indexOf(p.name) : idx;
    let cntRiichi = 0, cntRon = 0, cntTsumo = 0, cntLose = 0;
    if (records.riichi && Array.isArray(records.riichi)) {
      for (let r = 0; r < records.riichi.length; r++) {
        if (records.riichi[r]?.[pIdx]) cntRiichi++;
        if (records.win?.[r]?.[pIdx]) {
          const status = records.status?.[r];
          if (status === 'tsumo') cntTsumo++;
          else cntRon++;
        }
        if (records.lose?.[r]?.[pIdx]) cntLose++;
      }
    }
    return {
      seat: p.seat || seatOrder[idx],
      name: p.name,
      rank: p.rank,
      score: p.score,
      uma: p.uma,
      ratingBefore: p.ratingBefore,
      ratingAfter: p.ratingAfter,
      ratingDelta: p.ratingDelta,
      cntRiichi,
      cntRon,
      cntTsumo,
      cntLose
    };
  });

  const rawTimes = records.time || [];
  const labels: string[] = ['시작'];
  for (let i = 1; i < rawTimes.length; i += 2) {
    labels.push(rawTimes[i] || `${Math.floor(i / 2) + 1}국`);
  }

  const colors = ['#ff6384', '#4bc0c0', '#36a2eb', '#ffce56'];
  const datasets = sortedGamePlayers.map((p, idx) => {
    const pIdx = pNames.indexOf(p.name) !== -1 ? pNames.indexOf(p.name) : idx;
    const rawScores = records.score?.[pIdx] || [];
    const restoredData: number[] = [25000];
    let curScore = 25000;
    for (let i = 1; i < rawScores.length; i += 2) {
      curScore += Number(rawScores[i] || 0);
      restoredData.push(curScore);
    }
    return {
      label: p.name,
      data: restoredData,
      borderColor: colors[idx % 4],
      backgroundColor: colors[idx % 4],
      pointRadius: 3,
    };
  });

  const computeRoundWindForSeat = (initialSeat: string, fallbackIdx: number, roundLabel: string): string => {
    const winds = ['東', '南', '西', '北'];
    const baseIdx = winds.indexOf(initialSeat) !== -1 ? winds.indexOf(initialSeat) : (fallbackIdx % 4);
    const kyokuMatch =
      (roundLabel || '').match(/(?:[동남서북東南西北]\s*)?(\d+)\s*(?:국|局)/) ||
      (roundLabel || '').match(/[동남서북東南西北]\s*(\d+)/);
    if (!kyokuMatch) return winds[baseIdx];
    const kyokuNum = Number(kyokuMatch[1]);
    const shift = (((kyokuNum - 1) % 4) + 4) % 4;
    return winds[(baseIdx - shift + 4) % 4];
  };

  const roundDetailsList: GameRoundMovement[] = [];
  for (let k = 1; k < labels.length; k++) {
    const rIdx = k - 1;
    const rStatus = String(records.status?.[rIdx] || '').toLowerCase();
    const labelStr = labels[k];
    roundDetailsList.push({
      roundIndex: k,
      roundName: labelStr,
      roundStatus: rStatus,
      players: sortedGamePlayers.map((p, idx) => {
        const pIdx = pNames.indexOf(p.name) !== -1 ? pNames.indexOf(p.name) : idx;
        const ds = datasets[idx];
        const scoreBefore = ds?.data[k - 1] ?? 25000;
        const scoreAfter = ds?.data[k] ?? scoreBefore;
        const startSeat = p.seat || seatOrder[idx];
        return {
          seat: computeRoundWindForSeat(startSeat, idx, labelStr),
          name: p.name,
          scoreBefore,
          deltaScore: scoreAfter - scoreBefore,
          scoreAfter,
          isRiichi: !!records.riichi?.[rIdx]?.[pIdx],
          isWin: !!records.win?.[rIdx]?.[pIdx],
          isLose: !!records.lose?.[rIdx]?.[pIdx],
        };
      }),
    });
  }

  return {
    gameId: game.gameId,
    gameIndex: game.gameIndex,
    time: game.time,
    hasRoundDetails: true,
    playerStats,
    chartData: { labels, datasets },
    roundDetailsList,
  };
}

/**
 * 특정 대국의 리치/론/쯔모/방총 횟수 및 국별 점수변동 궤적 로드
 */
export async function fetchSessionGameDetail(
  sessionName: string,
  game: SessionGame,
  spreadsheetId?: string
): Promise<GameDetailRecord> {
  const seatOrder = ["東", "南", "西", "北"];
  const sortedGamePlayers = [...game.players].sort((a, b) => {
    return seatOrder.indexOf(a.seat) - seatOrder.indexOf(b.seat);
  });

  // 1. 로컬 스토리지 확인 (다른 회차의 동일 경기 번호 오매칭 방지를 위해 gameId 우선 검증 및 참가자 4인 전원 일치 검증)
  try {
    const rawHistory = localStorage.getItem("today_games_history");
    if (rawHistory) {
      const historyList = JSON.parse(rawHistory);
      const cleanTargetGameId = game.gameId ? String(game.gameId).trim() : '';
      const targetPlayerNames = new Set((game.players || []).map(p => p.name.trim()));
      const found = historyList.find((g: any) => {
        if (!g) return false;
        const gIdCandidates = [g.timestamp, g.id, g.gameId]
          .filter(v => v !== undefined && v !== null && String(v).trim() !== '')
          .map(v => String(v).trim());
        if (cleanTargetGameId) {
          return gIdCandidates.includes(cleanTargetGameId);
        }
        if (g.gameIndex && g.gameIndex === game.gameIndex && g.results?.length === 4) {
          const histPlayers: string[] = g.playerNames || g.results.map((r: any) => String(r?.name || '').trim());
          return histPlayers.length === 4 && histPlayers.every(name => targetPlayerNames.has(name.trim()));
        }
        return false;
      });
      if (found && found.records && Array.isArray(found.records.score) && found.records.score.length >= 4) {
        return buildGameDetailFromLocalRecords(game, found.records, found.playerNames || found.results?.map((r: any) => r.name));
      }
    }
  } catch (e) {
    console.warn("localStorage check for gameDetail failed:", e);
  }

  // 2. 9회차 이상인 경우 회차별 국별기록에서 실시간 조회
  const match = sessionName.match(/제(\d+)회/);
  const sessionNum = match ? parseInt(match[1], 10) : 0;

  if (sessionNum >= 9) {
    const sessionRows = await fetchSessionRoundsRows(sessionName, spreadsheetId);

    if (sessionRows && sessionRows.length > 0) {
      const cleanGId = game.gameId ? game.gameId.trim() : "";
      let gameRows: any[] = [];

      // gameId 일치 행 검색
      if (cleanGId) {
        gameRows = sessionRows.filter((r: any) => {
          if (!r.c) return false;
          const rowGId = getCellStr(r.c[1]).trim();
          return rowGId === cleanGId || rowGId.includes(cleanGId) || cleanGId.includes(rowGId);
        });
      }

      // gameId가 완전 일치하지 않을 경우 (낙관적 렌더링 임시 ID 등) 세션명 + 선수 4인 + 우마/순번 일치 행 검색
      if (gameRows.length === 0 && game.players && game.players.length === 4) {
        const sessTargetMatch = sessionName.match(/제\d+회/);
        const sessPrefix = sessTargetMatch ? sessTargetMatch[0] : sessionName;
        const gamePlayerNames = new Set(game.players.map(p => p.name.trim()));

        const orderedGameIds: string[] = [];
        const sessionRowsByGame: Record<string, any[]> = {};
        sessionRows.forEach((r: any) => {
          if (!r.c) return;
          const rowSess = getCellStr(r.c[15]).replace(/\s+/g, "");
          if (rowSess && !rowSess.includes(sessPrefix) && !sessPrefix.includes(rowSess)) return;
          const gid = getCellStr(r.c[1]).trim();
          if (!gid) return;
          if (!sessionRowsByGame[gid]) {
            sessionRowsByGame[gid] = [];
            orderedGameIds.push(gid);
          }
          sessionRowsByGame[gid].push(r);
        });

        const candidateGids: string[] = [];
        for (const gid of orderedGameIds) {
          const rows = sessionRowsByGame[gid];
          const pSet = new Set(rows.map(r => getCellStr(r.c[5]).trim()));
          let allMatched = true;
          for (const name of gamePlayerNames) {
            if (!pSet.has(name)) { allMatched = false; break; }
          }
          if (allMatched && rows.length >= 4) {
            candidateGids.push(gid);
          }
        }

        if (candidateGids.length === 1) {
          gameRows = sessionRowsByGame[candidateGids[0]];
        } else if (candidateGids.length > 1) {
          // 1순위: 최종 우마(r.c[14]) 및 순위(r.c[13])가 모두 일치하는 경기
          let matchedByUmaGid = "";
          for (const gid of candidateGids) {
            const rows = sessionRowsByGame[gid];
            const firstFour = rows.slice(0, 4);
            const umaMatched = game.players.every(gp => {
              const pRow = firstFour.find(r => getCellStr(r.c[5]).trim() === gp.name.trim()) ||
                           rows.find(r => getCellStr(r.c[5]).trim() === gp.name.trim());
              if (!pRow) return false;
              const rowUma = getCellNum(pRow.c[14], NaN);
              return !isNaN(rowUma) && Math.abs(rowUma - gp.uma) < 0.5;
            });
            if (umaMatched) {
              matchedByUmaGid = gid;
              break;
            }
          }

          if (matchedByUmaGid) {
            gameRows = sessionRowsByGame[matchedByUmaGid];
          } else if (
            game.gameIndex >= 1 &&
            orderedGameIds[game.gameIndex - 1] &&
            candidateGids.includes(orderedGameIds[game.gameIndex - 1])
          ) {
            // 2순위: 회차 내 대국 순번(gameIndex) 일치 경기
            gameRows = sessionRowsByGame[orderedGameIds[game.gameIndex - 1]];
          } else {
            gameRows = sessionRowsByGame[candidateGids[0]];
          }
        }
      }

      if (gameRows.length > 0) {
        // 국별 행 매핑
        const roundsMap: Record<number, {
          roundName: string;
          roundStatus: string;
          playerOrder: string[];
          players: Record<string, { deltaScore: number; isRiichi: boolean; isWin: boolean; isLose: boolean }>;
        }> = {};

        gameRows.forEach((row: any) => {
          const r = getCellNum(row.c[3], 0);
          if (!roundsMap[r]) {
            roundsMap[r] = {
              roundName: getCellStr(row.c[2]),
              roundStatus: getCellStr(row.c[4]).toLowerCase(),
              playerOrder: [],
              players: {}
            };
          }
          const pName = getCellStr(row.c[5]).trim();
          if (pName && !roundsMap[r].playerOrder.includes(pName)) {
            roundsMap[r].playerOrder.push(pName);
          }
          roundsMap[r].players[pName] = {
            deltaScore: getCellNum(row.c[7]),
            isRiichi: row.c[9]?.v === true || row.c[9]?.v === "TRUE" || row.c[9]?.v === 1,
            isWin: row.c[10]?.v === true || row.c[10]?.v === "TRUE" || row.c[10]?.v === 1,
            isLose: row.c[11]?.v === true || row.c[11]?.v === "TRUE" || row.c[11]?.v === 1,
          };
        });

        const roundNums = Object.keys(roundsMap).map(Number).sort((a, b) => a - b);

        // 1국 행 순서(東, 南, 西, 北)로 시작 좌석 순서를 항상 정확히 보장
        const firstRoundOrder = roundNums.length > 0 ? roundsMap[roundNums[0]].playerOrder : [];
        let effectivePlayers = sortedGamePlayers;
        if (firstRoundOrder.length === 4) {
          effectivePlayers = [...game.players]
            .sort((a, b) => {
              const ia = firstRoundOrder.indexOf(a.name.trim());
              const ib = firstRoundOrder.indexOf(b.name.trim());
              return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
            })
            .map((p, idx) => ({
              ...p,
              seat: seatOrder[idx] || p.seat
            }));
        }

        const playerStats: GamePlayerResultStat[] = effectivePlayers.map((p, idx) => {
          let cntRiichi = 0, cntRon = 0, cntTsumo = 0, cntLose = 0;
          roundNums.forEach(r => {
            const rd = roundsMap[r];
            const pData = rd.players[p.name];
            if (pData) {
              if (pData.isRiichi) cntRiichi++;
              if (pData.isWin) {
                if (rd.roundStatus.includes("tsumo")) cntTsumo++;
                else cntRon++;
              }
              if (pData.isLose) cntLose++;
            }
          });
          return {
            seat: p.seat || seatOrder[idx],
            name: p.name,
            rank: p.rank,
            score: p.score,
            uma: p.uma,
            ratingBefore: p.ratingBefore,
            ratingAfter: p.ratingAfter,
            ratingDelta: p.ratingDelta,
            cntRiichi,
            cntRon,
            cntTsumo,
            cntLose,
          };
        });

        // 촌보 등으로 인해 동일한 국/본장 이름이 한 경기 내 여러 번 등장하는 경우 구분용 카운트 집계
        const rawRoundNames = roundNums.map(r => (roundsMap[r].roundName || `${r}국`).trim());
        const roundNameTotals: Record<string, number> = {};
        rawRoundNames.forEach(rn => {
          roundNameTotals[rn] = (roundNameTotals[rn] || 0) + 1;
        });
        const roundNameOccurrences: Record<string, number> = {};
        const disambiguatedRoundNames = roundNums.map((r, rIdx) => {
          const rawName = rawRoundNames[rIdx];
          if ((roundNameTotals[rawName] || 0) <= 1) {
            return rawName;
          }
          roundNameOccurrences[rawName] = (roundNameOccurrences[rawName] || 0) + 1;
          const occ = roundNameOccurrences[rawName];
          const st = (roundsMap[r].roundStatus || '').toLowerCase();
          const isChonbo = st.includes('chonbo') || st.includes('cheat') || st.includes('촌보');
          return isChonbo ? `${rawName} (${occ}차·촌보)` : `${rawName} (${occ}차)`;
        });

        // 시작 좌석(1국 기준 東/南/西/北)으로부터 각 국의 자풍(東/南/西/北) 계산
        // 1국은 그대로, 2국은 東→北, 南→東, 西→南, 北→西 (본장은 자풍 이동에 영향 없음, 한자 局 및 한글 국 모두 지원)
        const getRoundWindForSeat = (initialSeat: string, fallbackIdx: number, roundLabel: string): string => {
          const winds = ["東", "南", "西", "北"];
          const baseIdx = winds.indexOf(initialSeat) !== -1 ? winds.indexOf(initialSeat) : (fallbackIdx % 4);
          const kyokuMatch =
            (roundLabel || "").match(/(?:[동남서북東南西北]\s*)?(\d+)\s*(?:국|局)/) ||
            (roundLabel || "").match(/[동남서북東南西北]\s*(\d+)/);
          if (!kyokuMatch) return winds[baseIdx];
          const kyokuNum = Number(kyokuMatch[1]);
          const shift = (((kyokuNum - 1) % 4) + 4) % 4;
          return winds[(baseIdx - shift + 4) % 4];
        };

        const labels: string[] = ["시작", ...disambiguatedRoundNames];

        const colors = ["#ff6384", "#4bc0c0", "#36a2eb", "#ffce56"];
        const datasets = effectivePlayers.map((p, idx) => {
          let curScore = 25000;
          const dataPoints: number[] = [curScore];
          roundNums.forEach(r => {
            const pData = roundsMap[r].players[p.name];
            const delta = pData ? pData.deltaScore : 0;
            curScore += delta;
            dataPoints.push(curScore);
          });
          return {
            label: p.name,
            data: dataPoints,
            borderColor: colors[idx % 4],
            backgroundColor: colors[idx % 4],
            pointRadius: 3,
          };
        });

        const resolvedGameId = getCellStr(gameRows[0]?.c?.[1]).trim() || game.gameId;
        const resolvedTime = game.time || getCellStr(gameRows[0]?.c?.[0]).trim();

        const roundDetailsList: GameRoundMovement[] = roundNums.map((r, rIdx) => {
          const rd = roundsMap[r];
          const k = rIdx + 1;
          const displayRoundName = disambiguatedRoundNames[rIdx] || rd.roundName || `${r}국`;
          return {
            roundIndex: k,
            roundName: displayRoundName,
            roundStatus: rd.roundStatus || '',
            players: effectivePlayers.map((p, idx) => {
              const pData = rd.players[p.name];
              const ds = datasets[idx];
              const scoreBefore = ds?.data[k - 1] ?? 25000;
              const scoreAfter = ds?.data[k] ?? scoreBefore;
              const startSeat = p.seat || seatOrder[idx];
              return {
                seat: getRoundWindForSeat(startSeat, idx, displayRoundName),
                name: p.name,
                scoreBefore,
                deltaScore: pData ? pData.deltaScore : scoreAfter - scoreBefore,
                scoreAfter,
                isRiichi: !!pData?.isRiichi,
                isWin: !!pData?.isWin,
                isLose: !!pData?.isLose,
              };
            }),
          };
        });

        return {
          gameId: resolvedGameId,
          gameIndex: game.gameIndex,
          time: resolvedTime,
          hasRoundDetails: true,
          playerStats,
          chartData: { labels, datasets },
          roundDetailsList,
        };
      }
    }
  }

  // 3. 레거시(1~8회차)이거나 세부 국별 기록이 없는 경우
  return {
    gameId: game.gameId,
    gameIndex: game.gameIndex,
    time: game.time,
    hasRoundDetails: false,
    playerStats: sortedGamePlayers.map((p, idx) => ({
      seat: p.seat || seatOrder[idx],
      name: p.name,
      rank: p.rank,
      score: p.score,
      uma: p.uma,
      cntRiichi: 0,
      cntRon: 0,
      cntTsumo: 0,
      cntLose: 0,
    })),
    chartData: { labels: [], datasets: [] }
  };
}

export interface OpponentSideSummary {
  avgRank: number;
  avgUma: number;
  avgScore: number;
  r1: number;
  r2: number;
  r3: number;
  r4: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
}

export interface OpponentHeadToHeadStat {
  opponentName: string;
  encounterCount: number;
  encounterRate: number;
  winCount: number;
  winRate: number;
  playerStats: OpponentSideSummary;
  opponentStats: OpponentSideSummary;
}

export interface FrequentOpponentsResult {
  totalPlayerGames: number;
  opponents: OpponentHeadToHeadStat[];
}

/**
 * 특정 플레이어의 대국 기록 목록으로부터 자주 만나는 상대(동탁 비율/횟수) 및 상대별 맞대결 승률/비교 스탯을 계산합니다.
 */
export function computeFrequentOpponentsStats(
  playerName: string,
  games: Array<{ players: Array<{ name: string; rank: number; score: number; uma?: number }> }>,
  limitGames?: number
): FrequentOpponentsResult {
  const targetClean = (playerName || '').trim();
  if (!targetClean || !Array.isArray(games) || games.length === 0) {
    return { totalPlayerGames: 0, opponents: [] };
  }

  const allPlayerGames = games.filter(
    g => Array.isArray(g.players) && g.players.some(p => (p.name || '').trim() === targetClean)
  );

  const scopedGames =
    limitGames && limitGames > 0 && allPlayerGames.length > limitGames
      ? allPlayerGames.slice(-limitGames)
      : allPlayerGames;

  const totalPlayerGames = scopedGames.length;
  if (totalPlayerGames === 0) {
    return { totalPlayerGames: 0, opponents: [] };
  }

  interface Accumulator {
    encounterCount: number;
    winCount: number;
    pSumRank: number;
    pSumUma: number;
    pSumScore: number;
    pR1: number;
    pR2: number;
    pR3: number;
    pR4: number;
    oSumRank: number;
    oSumUma: number;
    oSumScore: number;
    oR1: number;
    oR2: number;
    oR3: number;
    oR4: number;
  }

  const map = new Map<string, Accumulator>();

  const resolveUma = (p: { rank: number; score: number; uma?: number }): number => {
    if (p.uma !== undefined && p.uma !== null && !isNaN(Number(p.uma))) {
      return Number(p.uma);
    }
    const baseBonus = p.rank === 1 ? 40 : p.rank === 2 ? 10 : p.rank === 3 ? -10 : -20;
    return parseFloat((((Number(p.score || 0) - 30000) / 1000) + baseBonus).toFixed(1));
  };

  for (const g of scopedGames) {
    const me = g.players.find(p => (p.name || '').trim() === targetClean);
    if (!me) continue;

    const myRank = Number(me.rank) || 4;
    const myScore = Number(me.score) || 0;
    const myUma = resolveUma(me);

    for (const opp of g.players) {
      const oppName = (opp.name || '').trim();
      if (!oppName || oppName === targetClean) continue;

      const oppRank = Number(opp.rank) || 4;
      const oppScore = Number(opp.score) || 0;
      const oppUma = resolveUma(opp);

      let acc = map.get(oppName);
      if (!acc) {
        acc = {
          encounterCount: 0,
          winCount: 0,
          pSumRank: 0,
          pSumUma: 0,
          pSumScore: 0,
          pR1: 0,
          pR2: 0,
          pR3: 0,
          pR4: 0,
          oSumRank: 0,
          oSumUma: 0,
          oSumScore: 0,
          oR1: 0,
          oR2: 0,
          oR3: 0,
          oR4: 0,
        };
        map.set(oppName, acc);
      }

      acc.encounterCount += 1;
      if (myRank < oppRank) {
        acc.winCount += 1;
      }

      acc.pSumRank += myRank;
      acc.pSumUma += myUma;
      acc.pSumScore += myScore;
      if (myRank === 1) acc.pR1++;
      else if (myRank === 2) acc.pR2++;
      else if (myRank === 3) acc.pR3++;
      else acc.pR4++;

      acc.oSumRank += oppRank;
      acc.oSumUma += oppUma;
      acc.oSumScore += oppScore;
      if (oppRank === 1) acc.oR1++;
      else if (oppRank === 2) acc.oR2++;
      else if (oppRank === 3) acc.oR3++;
      else acc.oR4++;
    }
  }

  const opponents: OpponentHeadToHeadStat[] = [];
  for (const [opponentName, acc] of map.entries()) {
    const n = acc.encounterCount;
    if (n <= 0) continue;

    opponents.push({
      opponentName,
      encounterCount: n,
      encounterRate: Number(((n / totalPlayerGames) * 100).toFixed(2)),
      winCount: acc.winCount,
      winRate: Number(((acc.winCount / n) * 100).toFixed(2)),
      playerStats: {
        avgRank: Number((acc.pSumRank / n).toFixed(3)),
        avgUma: Number((acc.pSumUma / n).toFixed(1)),
        avgScore: Math.round(acc.pSumScore / n),
        r1: acc.pR1,
        r2: acc.pR2,
        r3: acc.pR3,
        r4: acc.pR4,
        p1: Number(((acc.pR1 / n) * 100).toFixed(2)),
        p2: Number(((acc.pR2 / n) * 100).toFixed(2)),
        p3: Number(((acc.pR3 / n) * 100).toFixed(2)),
        p4: Number(((acc.pR4 / n) * 100).toFixed(2)),
      },
      opponentStats: {
        avgRank: Number((acc.oSumRank / n).toFixed(3)),
        avgUma: Number((acc.oSumUma / n).toFixed(1)),
        avgScore: Math.round(acc.oSumScore / n),
        r1: acc.oR1,
        r2: acc.oR2,
        r3: acc.oR3,
        r4: acc.oR4,
        p1: Number(((acc.oR1 / n) * 100).toFixed(2)),
        p2: Number(((acc.oR2 / n) * 100).toFixed(2)),
        p3: Number(((acc.oR3 / n) * 100).toFixed(2)),
        p4: Number(((acc.oR4 / n) * 100).toFixed(2)),
      },
    });
  }

  opponents.sort((a, b) => {
    if (b.encounterCount !== a.encounterCount) return b.encounterCount - a.encounterCount;
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    if (b.playerStats.avgUma !== a.playerStats.avgUma) return b.playerStats.avgUma - a.playerStats.avgUma;
    return a.opponentName.localeCompare(b.opponentName, 'ko');
  });

  return {
    totalPlayerGames,
    opponents,
  };
}

// ==========================================
// 조건별 성적 DB 조회 엔진 (최근 N국 / 최근 N회차 / 기간 지정 / 회차 구간)
// ==========================================

export type StatsQueryMode = 'all' | 'recent_games' | 'recent_rounds' | 'recent_sessions' | 'date_range' | 'session_range';

export interface StatsQueryFilter {
  mode: StatsQueryMode;
  recentGames?: number;
  recentRounds?: number;
  recentSessions?: number;
  startDate?: string; // 'YYYY-MM-DD'
  endDate?: string;   // 'YYYY-MM-DD'
  startSession?: string;
  endSession?: string;
  minGames?: number;
}

export interface StatsQueryResult {
  members: MemberStatItem[];
  matchedSessions: string[];
  totalMatchedGames: number;
  totalMatchedRounds: number;
  hasLegacyOnlyGames: boolean;
  queryElapsedMs: number;
  summaryLabel: string;
}

let pendingAllRoundsRowsPromise: Promise<any[]> | null = null;

export function parseSessionNumber(sessionLabel?: string): number {
  if (!sessionLabel) return 0;
  const m = String(sessionLabel).match(/제\s*(\d+)\s*회/);
  return m ? parseInt(m[1], 10) : 0;
}

export function extractIsoDateFromRecord(
  sessionLabel?: string,
  rawDate?: string,
  gameId?: string
): string {
  // 1) 회차명 내 YYMMDD 토큰 우선 (예: "제15회 260926" -> "2026-09-26")
  const sLabel = String(sessionLabel || '');
  const yymmdd = sLabel.match(/(?:^|\D)(\d{2})(\d{2})(\d{2})(?:\D|$)/);
  if (yymmdd) {
    const yy = parseInt(yymmdd[1], 10);
    const mm = parseInt(yymmdd[2], 10);
    const dd = parseInt(yymmdd[3], 10);
    if (yy >= 20 && yy <= 40 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `20${String(yy).padStart(2, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    }
  }

  // 2) rawDate 문자열 파싱 (엑셀 일련번호, YYYY-MM-DD, YYYY. M. D., YYMMDD 등)
  const formatted = formatSheetDateValue(String(rawDate || ''));
  if (formatted) {
    const isoMatch = formatted.match(/(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})/);
    if (isoMatch) {
      return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
    }
    const shortMatch = formatted.match(/^(\d{2})(\d{2})(\d{2})$/);
    if (shortMatch) {
      return `20${shortMatch[1]}-${shortMatch[2]}-${shortMatch[3]}`;
    }
  }

  // 3) gameId (13자리 Unix ms 타임스탬프 -> KST 날짜 변환)
  const cleanGameId = String(gameId || '').trim();
  if (/^\d{13}$/.test(cleanGameId)) {
    const ms = Number(cleanGameId);
    if (!isNaN(ms) && ms > 1500000000000) {
      const kstDate = new Date(ms + 9 * 3600 * 1000);
      if (!isNaN(kstDate.getTime())) {
        const y = kstDate.getUTCFullYear();
        const m = String(kstDate.getUTCMonth() + 1).padStart(2, '0');
        const d = String(kstDate.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
      }
    }
  }

  return '';
}

/**
 * 전체 국별기록 (데이터) 전체 행을 1회 로드 및 메모리 캐싱합니다.
 */
export async function fetchAllPublicRoundsRows(
  spreadsheetId?: string,
  forceRefresh: boolean = false
): Promise<any[]> {
  if (!forceRefresh && cachedAllRoundsTable && Array.isArray(cachedAllRoundsTable.rows) && cachedAllRoundsTable.rows.length > 0) {
    return cachedAllRoundsTable.rows;
  }

  if (!forceRefresh && pendingAllRoundsRowsPromise) {
    return pendingAllRoundsRowsPromise;
  }

  const promise = (async () => {
    try {
      const workerUrl = getWorkerUrl();
      if (workerUrl) {
        try {
          const refreshParam = forceRefresh ? `?refresh=1&_t=${Date.now()}` : '';
          const res = await fetchWithTimeout(`${workerUrl}/api/public/rounds${refreshParam}`, { cache: 'no-store' }, 15000);
          if (res.ok) {
            const data = await res.json();
            if (data.table && Array.isArray(data.table.rows)) {
              cachedAllRoundsTable = data.table;
              indexAllRoundsBySession(data.table.rows);
              return data.table.rows;
            }
          }
        } catch (e) {
          console.warn('Worker all-rounds fetch failed:', e);
        }
      }

      const sId = spreadsheetId || await resolveSpreadsheetId();
      if (sId) {
        const sheetParam = encodeURIComponent('전체 국별기록 (데이터)');
        const gvizUrl = `https://docs.google.com/spreadsheets/d/${sId}/gviz/tq?tqx=out:json&sheet=${sheetParam}`;
        const res = await fetchWithTimeout(gvizUrl, {}, 15000);
        if (res.ok) {
          const text = await res.text();
          const json = parseGVizResponse(text);
          if (json && json.table && Array.isArray(json.table.rows)) {
            cachedAllRoundsTable = json.table;
            indexAllRoundsBySession(json.table.rows);
            return json.table.rows;
          }
        }
      }

      return cachedAllRoundsTable?.rows || [];
    } finally {
      pendingAllRoundsRowsPromise = null;
    }
  })();

  pendingAllRoundsRowsPromise = promise;
  return promise;
}

/**
 * 임의의 국별 기록 행 배열을 선수별 MemberStatItem 맵으로 집계합니다.
 */
function aggregateRoundsRowsToMemberStats(rows: any[]): Record<string, MemberStatItem> {
  const rawAgg: Record<string, {
    name: string;
    gameIds: Set<string>;
    gameUmaById: Map<string, { maxSeq: number; uma: number }>;
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
    chaseRiichiWinCount: number;
    chasedRiichiCount: number;
    loseWithRiichiCount: number;
    oyaTsumoSufferedCount: number;
    oyaManganSufferedCount: number;
    oyaManganLossSum: number;
    tobiGameIds: Set<string>;
    tobiCount: number;
    cheatCount: number;
    beolbuCount: number;
  }> = {};

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r?.c) continue;
    const player = getCellStr(r.c[5]).trim();
    if (!player) continue;

    if (!rawAgg[player]) {
      rawAgg[player] = {
        name: player,
        gameIds: new Set<string>(),
        gameUmaById: new Map<string, { maxSeq: number; uma: number }>(),
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
        chaseRiichiWinCount: 0,
        chasedRiichiCount: 0,
        loseWithRiichiCount: 0,
        oyaTsumoSufferedCount: 0,
        oyaManganSufferedCount: 0,
        oyaManganLossSum: 0,
        tobiGameIds: new Set<string>(),
        tobiCount: 0,
        cheatCount: 0,
        beolbuCount: 0,
      };
    }

    const p = rawAgg[player];
    p.totalRounds++;

    const gameId = getCellStr(r.c[1]).trim();
    const roundSeq = getCellNum(r.c[3], 0);
    const rank = getCellNum(r.c[13]);
    const uma = getCellNum(r.c[14]);
    const finalScore = getCellNum(r.c[8]);

    if (gameId) {
      if (!p.gameIds.has(gameId)) {
        p.gameIds.add(gameId);
        if (rank >= 1 && rank <= 4) {
          p.ranks[rank]++;
          p.rankSum += rank;
        }
        p.gameUmaById.set(gameId, { maxSeq: roundSeq, uma });
        p.totalUmaSum += uma;
      } else {
        const prev = p.gameUmaById.get(gameId);
        if (prev && roundSeq >= prev.maxSeq) {
          p.totalUmaSum += uma - prev.uma;
          prev.maxSeq = roundSeq;
          prev.uma = uma;
        }
      }
    }

    if (gameId && finalScore < 0 && !p.tobiGameIds.has(gameId)) {
      p.tobiGameIds.add(gameId);
      p.tobiCount++;
    }

    const endStatus = getCellStr(r.c[4]).toLowerCase();
    const isEast = r.c[6]?.v === true || r.c[6]?.v === 'TRUE' || r.c[6]?.v === 1;
    const delta = getCellNum(r.c[7]);
    const isRiichi = r.c[9]?.v === true || r.c[9]?.v === 'TRUE' || r.c[9]?.v === 1;
    const isWin = r.c[10]?.v === true || r.c[10]?.v === 'TRUE' || r.c[10]?.v === 1;
    const isLose = r.c[11]?.v === true || r.c[11]?.v === 'TRUE' || r.c[11]?.v === 1;
    const isTenpai = r.c[12]?.v === true || r.c[12]?.v === 'TRUE' || r.c[12]?.v === 1;
    const isFirst = r.c[16]?.v === true || r.c[16]?.v === 'TRUE' || r.c[16]?.v === 1;
    const isChase = r.c[17]?.v === true || r.c[17]?.v === 'TRUE' || r.c[17]?.v === 1;
    const isChased = r.c[18]?.v === true || r.c[18]?.v === 'TRUE' || r.c[18]?.v === 1;
    const pureScore = getCellNum(r.c[19]);
    const uVal = r.c[20]?.v;
    const isCheat = uVal === true || uVal === 'TRUE' || uVal === 1 || (uVal === undefined && endStatus === 'cheat' && delta < 0);
    const beolbuCnt = getCellNum(r.c[21], 0);

    if (isCheat) p.cheatCount++;
    if (beolbuCnt > 0) p.beolbuCount += beolbuCnt;

    p.roundSujiSum += delta;

    if (isWin) {
      p.winCount++;
      const scoreToAdd = pureScore > 0 ? pureScore : delta;
      p.totalWinScore += scoreToAdd;
      if (endStatus === 'tsumo') p.tsumoWinCount++;
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
      if (endStatus.includes('draw')) p.riichiDrawCount++;
      if (isFirst) p.firstRiichiCount++;
      if (isChase) {
        p.chaseRiichiCount++;
        if (isWin) p.chaseRiichiWinCount++;
      }
      if (isChased) p.chasedRiichiCount++;
    }

    if (isTenpai) p.tenpaiCount++;

    if (endStatus.includes('draw')) {
      p.drawCount++;
      if (isTenpai) p.drawTenpaiCount++;
    }

    if (isLose && isRiichi) {
      p.loseWithRiichiCount++;
    }

    if (endStatus === 'tsumo' && !isWin) {
      if (isEast) {
        p.oyaTsumoSufferedCount++;
        const limit = isRiichi ? -5000 : -4000;
        if (delta <= limit) {
          p.oyaManganSufferedCount++;
          p.oyaManganLossSum += (pureScore > 0 ? pureScore : Math.abs(delta));
        }
      }
    }
  }

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
    const chaseRiichiWinRate = p.chaseRiichiCount > 0 ? parseFloat(((p.chaseRiichiWinCount / p.chaseRiichiCount) * 100).toFixed(2)) : 0;
    const chasedRiichiRate = p.riichiCount > 0 ? parseFloat(((p.chasedRiichiCount / p.riichiCount) * 100).toFixed(2)) : 0;
    const oyaKaburiRate = p.oyaTsumoSufferedCount > 0 ? parseFloat(((p.oyaManganSufferedCount / p.oyaTsumoSufferedCount) * 100).toFixed(2)) : 0;
    const oyaKaburiAvg = p.oyaManganSufferedCount > 0 ? Math.round(p.oyaManganLossSum / p.oyaManganSufferedCount) : 0;
    const dealInRiichiRate = p.loseCount > 0 ? parseFloat(((p.loseWithRiichiCount / p.loseCount) * 100).toFixed(2)) : 0;
    const cheatRate = parseFloat(((p.cheatCount / totalRounds) * 100).toFixed(4));
    const beolbuRate = parseFloat(((p.beolbuCount / totalRounds) * 100).toFixed(4));

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
      chaseRiichiWinRate,
      chaseRiichiCount: p.chaseRiichiCount,
      chaseRiichiWinCount: p.chaseRiichiWinCount,
      chasedRiichiRate,
      oyaKaburiRate,
      oyaKaburiAvg,
      dealInRiichiRate,
      cheatRate,
      beolbuRate,
      cheatCount: p.cheatCount,
      beolbuCount: p.beolbuCount,
      totalScore: p.roundSujiSum,
    };
  }

  return resultMap;
}

function attachRatingMetadata(
  member: MemberStatItem,
  allStatsMap: Map<string, MemberStatItem>,
  normalizedAllStatsMap?: Map<string, MemberStatItem>
): MemberStatItem {
  const base =
    allStatsMap.get(member.name) ||
    normalizedAllStatsMap?.get(normalizeRatingPlayerName(member.name));
  if (!base) return member;
  return {
    ...member,
    rating: base.rating,
    ratingMu: base.ratingMu,
    ratingSigma: base.ratingSigma,
    ratingPeak: base.ratingPeak,
    ratingLowest: base.ratingLowest,
    ratingDelta: base.ratingDelta,
    ratingHistory: base.ratingHistory,
  };
}

function createZeroDetailedStatItem(
  name: string,
  gamesStats: {
    totalUma: number;
    totalGames: number;
    rank1Count: number;
    rank2Count: number;
    rank3Count: number;
    rank4Count: number;
    rankSum: number;
    totalScore: number;
  }
): MemberStatItem {
  const totalGames = gamesStats.totalGames;
  const totalUma = parseFloat(gamesStats.totalUma.toFixed(1));
  const avgUma = totalGames > 0 ? parseFloat((totalUma / totalGames).toFixed(1)) : 0;
  const avgRank = totalGames > 0 ? parseFloat((gamesStats.rankSum / totalGames).toFixed(3)) : 0;
  const top2Rate = totalGames > 0
    ? parseFloat((((gamesStats.rank1Count + gamesStats.rank2Count) / totalGames) * 100).toFixed(2))
    : 0;

  return {
    name,
    totalUma,
    avgUma,
    avgRank,
    totalGames,
    totalRounds: 0,
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
    chaseRiichiWinRate: 0,
    chasedRiichiRate: 0,
    oyaKaburiRate: 0,
    oyaKaburiAvg: 0,
    dealInRiichiRate: 0,
    cheatRate: 0,
    beolbuRate: 0,
    cheatCount: 0,
    beolbuCount: 0,
    totalScore: gamesStats.totalScore,
    rank1Count: gamesStats.rank1Count,
    rank2Count: gamesStats.rank2Count,
    rank3Count: gamesStats.rank3Count,
    rank4Count: gamesStats.rank4Count,
    top2Rate,
  };
}

/**
 * 조건(최근 N국 / 최근 N회차 / 날짜 기간 / 회차 구간)에 따라 성적을 실시간 집계합니다.
 */
export async function queryMemberStatsByFilter(
  filter: StatsQueryFilter,
  options: {
    allStats: MemberStatItem[];
    availableSessions: string[];
    spreadsheetId?: string;
    forceRefresh?: boolean;
  }
): Promise<StatsQueryResult> {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const allStatsMap = new Map<string, MemberStatItem>();
  const normalizedAllStatsMap = new Map<string, MemberStatItem>();
  const canonicalNameByNorm = new Map<string, string>();
  for (const s of options.allStats || []) {
    if (s?.name) {
      allStatsMap.set(s.name, s);
      const norm = normalizeRatingPlayerName(s.name);
      if (norm) {
        const existing = normalizedAllStatsMap.get(norm);
        if (!existing || (s.totalGames || 0) >= (existing.totalGames || 0)) {
          normalizedAllStatsMap.set(norm, s);
        }
        // '★' 표기가 있는 최신 닉네임을 우선 대표명으로 사용
        const prevCanon = canonicalNameByNorm.get(norm);
        if (!prevCanon || s.name.includes('★')) {
          canonicalNameByNorm.set(norm, s.name);
        }
      }
    }
  }
  const resolveCanonicalName = (rawName: string): string => {
    const trimmed = String(rawName || '').trim();
    if (!trimmed) return '';
    const norm = normalizeRatingPlayerName(trimmed);
    return canonicalNameByNorm.get(norm) || trimmed;
  };

  const minGames = Math.max(0, Number(filter.minGames || 0));

  if (filter.mode === 'all') {
    const members = (options.allStats || []).filter((m) => m.totalGames >= minGames);
    const totalGames = Math.round(members.reduce((sum, m) => sum + (m.totalGames || 0), 0) / 4);
    const totalRounds = Math.round(members.reduce((sum, m) => sum + (m.totalRounds || 0), 0) / 4);
    const elapsed = Math.max(1, Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0));
    return {
      members,
      matchedSessions: options.availableSessions || [],
      totalMatchedGames: totalGames,
      totalMatchedRounds: totalRounds,
      hasLegacyOnlyGames: true,
      queryElapsedMs: elapsed,
      summaryLabel: '전체 기간',
    };
  }

  // 1) 최근 N국 (플레이어별 최신 N국 기준)
  if (filter.mode === 'recent_rounds') {
    const limitN = Math.max(1, Math.min(10000, Math.floor(Number(filter.recentRounds) || 100)));
    const allRows = await fetchAllPublicRoundsRows(options.spreadsheetId, options.forceRefresh);

    const byPlayer = new Map<string, { row: any; sessNum: number; gameNum: number; roundSeq: number; idx: number }[]>();
    for (let i = 0; i < allRows.length; i++) {
      const r = allRows[i];
      if (!r?.c) continue;
      const rawPlayer = getCellStr(r.c[5]).trim();
      const player = resolveCanonicalName(rawPlayer);
      if (!player) continue;
      const sessNum = parseSessionNumber(getCellStr(r.c[15]));
      const gameNum = Number(getCellStr(r.c[1]).trim()) || 0;
      const roundSeq = getCellNum(r.c[3], i);
      let list = byPlayer.get(player);
      if (!list) {
        list = [];
        byPlayer.set(player, list);
      }
      list.push({ row: r, sessNum, gameNum, roundSeq, idx: i });
    }

    const selectedRows: any[] = [];
    const matchedSessionSet = new Set<string>();
    const uniqueGameSet = new Set<string>();

    for (const entries of byPlayer.values()) {
      entries.sort((a, b) => {
        if (a.sessNum !== b.sessNum) return a.sessNum - b.sessNum;
        if (a.gameNum !== b.gameNum) return a.gameNum - b.gameNum;
        if (a.roundSeq !== b.roundSeq) return a.roundSeq - b.roundSeq;
        return a.idx - b.idx;
      });
      const sliced = entries.slice(-limitN);
      for (const e of sliced) {
        selectedRows.push(e.row);
        const sName = getCellStr(e.row.c[15]).trim();
        if (sName) matchedSessionSet.add(sName);
        const gId = getCellStr(e.row.c[1]).trim();
        if (gId) uniqueGameSet.add(gId);
      }
    }

    const statsMap = aggregateRoundsRowsToMemberStats(selectedRows);
    const members = Object.values(statsMap)
      .filter((m) => m.totalGames >= minGames)
      .map((m) => attachRatingMetadata(m, allStatsMap, normalizedAllStatsMap))
      .sort((a, b) => b.totalUma - a.totalUma);

    const elapsed = Math.max(1, Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0));
    return {
      members,
      matchedSessions: Array.from(matchedSessionSet).sort((a, b) => parseSessionNumber(b) - parseSessionNumber(a)),
      totalMatchedGames: uniqueGameSet.size,
      totalMatchedRounds: selectedRows.length,
      hasLegacyOnlyGames: false,
      queryElapsedMs: elapsed,
      summaryLabel: `플레이어별 최근 ${limitN}국`,
    };
  }

  // 1-2) 최근 N전 (플레이어별 최신 N대국 기준: 전체 우마/순위 + 국별 상세 스탯 동시 집계)
  if (filter.mode === 'recent_games') {
    const limitN = Math.max(1, Math.min(2000, Math.floor(Number(filter.recentGames) || 10)));
    const [allRows, allGames] = await Promise.all([
      fetchAllPublicRoundsRows(options.spreadsheetId, options.forceRefresh),
      fetchPublicRatingHistoryRecords(options.spreadsheetId, options.forceRefresh),
    ]);

    // A) 역대 전체 대국 이력에서 플레이어별 최신 N전 추출
    const gamesByPlayer = new Map<
      string,
      Array<{ sessionLabel: string; sessNum: number; rank: number; uma: number; score: number }>
    >();
    for (const g of allGames) {
      const sessNum = parseSessionNumber(g.sessionLabel);
      for (const p of g.players || []) {
        const canon = resolveCanonicalName(p.name);
        if (!canon) continue;
        let list = gamesByPlayer.get(canon);
        if (!list) {
          list = [];
          gamesByPlayer.set(canon, list);
        }
        list.push({
          sessionLabel: g.sessionLabel,
          sessNum,
          rank: Number(p.rank || 0),
          uma: Number(p.uma || 0),
          score: Number(p.score || 0),
        });
      }
    }

    const gameAggMap: Record<
      string,
      {
        totalUma: number;
        totalGames: number;
        rank1Count: number;
        rank2Count: number;
        rank3Count: number;
        rank4Count: number;
        rankSum: number;
        totalScore: number;
        nonLegacyCount: number;
      }
    > = {};
    const matchedSessionSet = new Set<string>();
    let hasLegacyOnlyGames = false;

    for (const [canon, entries] of gamesByPlayer.entries()) {
      const sliced = entries.slice(-limitN);
      const acc = {
        totalUma: 0,
        totalGames: 0,
        rank1Count: 0,
        rank2Count: 0,
        rank3Count: 0,
        rank4Count: 0,
        rankSum: 0,
        totalScore: 0,
        nonLegacyCount: 0,
      };
      for (const e of sliced) {
        acc.totalGames++;
        acc.totalUma += e.uma;
        acc.rankSum += e.rank;
        acc.totalScore += e.score;
        if (e.rank === 1) acc.rank1Count++;
        else if (e.rank === 2) acc.rank2Count++;
        else if (e.rank === 3) acc.rank3Count++;
        else if (e.rank === 4) acc.rank4Count++;
        if (e.sessionLabel) matchedSessionSet.add(e.sessionLabel);
        if (e.sessNum > 0 && e.sessNum < 9) {
          hasLegacyOnlyGames = true;
        } else {
          acc.nonLegacyCount++;
        }
      }
      gameAggMap[canon] = acc;
    }

    // B) 국별 상세 기록에서 플레이어별 최신 대국(gameId 단위) 행 추출
    const rowGamesByPlayer = new Map<
      string,
      Map<string, { sessNum: number; gameNum: number; firstIdx: number; rows: any[] }>
    >();
    for (let i = 0; i < allRows.length; i++) {
      const r = allRows[i];
      if (!r?.c) continue;
      const canon = resolveCanonicalName(getCellStr(r.c[5]).trim());
      const gId = getCellStr(r.c[1]).trim();
      if (!canon || !gId) continue;
      let pMap = rowGamesByPlayer.get(canon);
      if (!pMap) {
        pMap = new Map();
        rowGamesByPlayer.set(canon, pMap);
      }
      let gEntry = pMap.get(gId);
      if (!gEntry) {
        gEntry = {
          sessNum: parseSessionNumber(getCellStr(r.c[15])),
          gameNum: Number(gId) || 0,
          firstIdx: i,
          rows: [],
        };
        pMap.set(gId, gEntry);
      }
      gEntry.rows.push(r);
    }

    const selectedRoundRows: any[] = [];
    for (const [canon, pMap] of rowGamesByPlayer.entries()) {
      const gAgg = gameAggMap[canon];
      const takeDetGames = gAgg ? Math.min(limitN, gAgg.nonLegacyCount) : limitN;
      if (takeDetGames <= 0) continue;
      const orderedGames = Array.from(pMap.values()).sort((a, b) => {
        if (a.sessNum !== b.sessNum) return a.sessNum - b.sessNum;
        if (a.gameNum !== b.gameNum) return a.gameNum - b.gameNum;
        return a.firstIdx - b.firstIdx;
      });
      const slicedGames = orderedGames.slice(-takeDetGames);
      for (const ge of slicedGames) {
        for (const r of ge.rows) {
          selectedRoundRows.push(r);
        }
      }
    }

    const rawDetailedMap = aggregateRoundsRowsToMemberStats(selectedRoundRows);
    const normalizedDetailedMap: Record<string, MemberStatItem> = {};
    for (const [rawKey, item] of Object.entries(rawDetailedMap)) {
      const canon = resolveCanonicalName(rawKey);
      if (!normalizedDetailedMap[canon] || item.totalRounds > normalizedDetailedMap[canon].totalRounds) {
        normalizedDetailedMap[canon] = { ...item, name: canon };
      }
    }

    const allNames = new Set<string>([...Object.keys(gameAggMap), ...Object.keys(normalizedDetailedMap)]);
    const members: MemberStatItem[] = [];
    for (const name of allNames) {
      const gAgg = gameAggMap[name];
      const det = normalizedDetailedMap[name];
      let merged: MemberStatItem;
      if (gAgg) {
        const overallBase = createZeroDetailedStatItem(name, gAgg);
        if (det) {
          merged = {
            ...det,
            totalUma: overallBase.totalUma,
            avgUma: overallBase.avgUma,
            avgRank: overallBase.avgRank,
            totalGames: overallBase.totalGames,
            rank1Count: overallBase.rank1Count,
            rank2Count: overallBase.rank2Count,
            rank3Count: overallBase.rank3Count,
            rank4Count: overallBase.rank4Count,
            top2Rate: overallBase.top2Rate,
          };
        } else {
          merged = overallBase;
        }
      } else if (det) {
        merged = det;
      } else {
        continue;
      }

      if (merged.totalGames >= minGames) {
        members.push(attachRatingMetadata(merged, allStatsMap, normalizedAllStatsMap));
      }
    }

    members.sort((a, b) => b.totalUma - a.totalUma);
    const elapsed = Math.max(1, Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0));
    return {
      members,
      matchedSessions: Array.from(matchedSessionSet).sort((a, b) => parseSessionNumber(b) - parseSessionNumber(a)),
      totalMatchedGames: Math.round(members.reduce((s, m) => s + m.totalGames, 0) / 4),
      totalMatchedRounds: selectedRoundRows.length,
      hasLegacyOnlyGames,
      queryElapsedMs: elapsed,
      summaryLabel: `플레이어별 최근 ${limitN}전`,
    };
  }

  // 2) 최근 N회차 / 기간 지정 / 회차 구간 공통: 전체 국별기록 + 역대 전체 대국 이력 병렬 확보
  const [allRows, allGames] = await Promise.all([
    fetchAllPublicRoundsRows(options.spreadsheetId, options.forceRefresh),
    fetchPublicRatingHistoryRecords(options.spreadsheetId, options.forceRefresh),
  ]);

  const sortedSessionsDesc = [...(options.availableSessions || [])].sort(
    (a, b) => parseSessionNumber(b) - parseSessionNumber(a)
  );
  const sessionDateByNum = new Map<number, string>();
  for (const s of sortedSessionsDesc) {
    const num = parseSessionNumber(s);
    const iso = extractIsoDateFromRecord(s);
    if (num > 0 && iso && !sessionDateByNum.has(num)) {
      sessionDateByNum.set(num, iso);
    }
  }

  let targetSessionNums: Set<number> | null = null;
  let matchedSessionNames: string[] = [];
  let summaryLabel = '';
  const startDate = (filter.startDate || '').trim();
  const endDate = (filter.endDate || '').trim();

  if (filter.mode === 'recent_sessions') {
    const n = Math.max(1, Math.floor(Number(filter.recentSessions) || 3));
    const picked = sortedSessionsDesc.slice(0, n);
    targetSessionNums = new Set(picked.map((s) => parseSessionNumber(s)).filter((num) => num > 0));
    matchedSessionNames = picked;
    const oldest = picked[picked.length - 1];
    const newest = picked[0];
    summaryLabel = picked.length > 1
      ? `최근 ${picked.length}회차 (${oldest} ~ ${newest})`
      : picked.length === 1
        ? `최근 1회차 (${newest})`
        : `최근 ${n}회차`;
  } else if (filter.mode === 'session_range') {
    const sNum = parseSessionNumber(filter.startSession);
    const eNum = parseSessionNumber(filter.endSession);
    const minNum = sNum > 0 && eNum > 0 ? Math.min(sNum, eNum) : Math.max(sNum, eNum);
    const maxNum = sNum > 0 && eNum > 0 ? Math.max(sNum, eNum) : Math.max(sNum, eNum);
    const picked = sortedSessionsDesc.filter((s) => {
      const num = parseSessionNumber(s);
      return num >= minNum && num <= maxNum;
    });
    targetSessionNums = new Set(picked.map((s) => parseSessionNumber(s)).filter((num) => num > 0));
    matchedSessionNames = picked;
    const oldest = picked[picked.length - 1] || filter.startSession || '';
    const newest = picked[0] || filter.endSession || '';
    summaryLabel = oldest && newest && oldest !== newest ? `${oldest} ~ ${newest}` : (oldest || newest || '회차 구간');
  } else if (filter.mode === 'date_range') {
    matchedSessionNames = sortedSessionsDesc.filter((s) => {
      const iso = extractIsoDateFromRecord(s);
      if (!iso) return false;
      if (startDate && iso < startDate) return false;
      if (endDate && iso > endDate) return false;
      return true;
    });
    summaryLabel = startDate && endDate
      ? `${startDate} ~ ${endDate}`
      : startDate
        ? `${startDate} 이후`
        : endDate
          ? `${endDate} 이전`
          : '기간 지정';
  }

  // 국별 상세 행 필터링 (제9회~)
  const filteredRoundRows: any[] = [];
  const roundGameIdSet = new Set<string>();
  const roundSessionNumSet = new Set<number>();

  for (let i = 0; i < allRows.length; i++) {
    const r = allRows[i];
    if (!r?.c) continue;
    const rowSess = getCellStr(r.c[15]).trim();
    const sessNum = parseSessionNumber(rowSess);
    if (filter.mode === 'date_range') {
      const iso =
        extractIsoDateFromRecord(rowSess, getCellStr(r.c[0]), getCellStr(r.c[1])) ||
        (sessNum > 0 ? sessionDateByNum.get(sessNum) || '' : '');
      if (!iso) continue;
      if (startDate && iso < startDate) continue;
      if (endDate && iso > endDate) continue;
    } else if (targetSessionNums) {
      if (!targetSessionNums.has(sessNum)) continue;
    }
    filteredRoundRows.push(r);
    const gId = getCellStr(r.c[1]).trim();
    if (gId) roundGameIdSet.add(gId);
    if (sessNum > 0) roundSessionNumSet.add(sessNum);
  }

  const detailedMap = aggregateRoundsRowsToMemberStats(filteredRoundRows);

  // 역대 전체 대국 이력 필터링 (제1~8회 레거시 포함 전체 회차 대국/우마/순위 집계)
  const matchedGames = allGames.filter((g) => {
    const sessNum = parseSessionNumber(g.sessionLabel);
    if (filter.mode === 'date_range') {
      const iso =
        extractIsoDateFromRecord(g.sessionLabel, g.date) ||
        (sessNum > 0 ? sessionDateByNum.get(sessNum) || '' : '');
      if (!iso) return false;
      if (startDate && iso < startDate) return false;
      if (endDate && iso > endDate) return false;
      return true;
    }
    if (targetSessionNums) {
      return targetSessionNums.has(sessNum);
    }
    return false;
  });

  const hasLegacyOnlyGames = matchedGames.some((g) => {
    const num = parseSessionNumber(g.sessionLabel);
    return num > 0 && num < 9;
  });

  // 게임 단위 전체 우마/순위 집계 (제1~8회 레거시가 포함된 경우 전체 합산용)
  const gameAggMap: Record<string, {
    totalUma: number;
    totalGames: number;
    rank1Count: number;
    rank2Count: number;
    rank3Count: number;
    rank4Count: number;
    rankSum: number;
    totalScore: number;
  }> = {};

  for (const g of matchedGames) {
    for (const p of g.players || []) {
      const canonName = resolveCanonicalName(p.name);
      if (!canonName) continue;
      if (!gameAggMap[canonName]) {
        gameAggMap[canonName] = {
          totalUma: 0,
          totalGames: 0,
          rank1Count: 0,
          rank2Count: 0,
          rank3Count: 0,
          rank4Count: 0,
          rankSum: 0,
          totalScore: 0,
        };
      }
      const acc = gameAggMap[canonName];
      acc.totalGames++;
      acc.totalUma += Number(p.uma || 0);
      acc.rankSum += Number(p.rank || 0);
      acc.totalScore += Number(p.score || 0);
      if (p.rank === 1) acc.rank1Count++;
      else if (p.rank === 2) acc.rank2Count++;
      else if (p.rank === 3) acc.rank3Count++;
      else if (p.rank === 4) acc.rank4Count++;
    }
  }

  // detailedMap 키도 대표명(신시 / 신시★ 통합)으로 정규화
  const normalizedDetailedMap: Record<string, MemberStatItem> = {};
  for (const [rawKey, item] of Object.entries(detailedMap)) {
    const canon = resolveCanonicalName(rawKey);
    if (!normalizedDetailedMap[canon] || item.totalRounds > normalizedDetailedMap[canon].totalRounds) {
      normalizedDetailedMap[canon] = { ...item, name: canon };
    }
  }

  // 최종 멤버 목록 병합
  const allPlayerNames = new Set<string>([
    ...Object.keys(normalizedDetailedMap),
    ...Object.keys(gameAggMap),
  ]);

  const members: MemberStatItem[] = [];
  for (const name of allPlayerNames) {
    const det = normalizedDetailedMap[name];
    const gAgg = gameAggMap[name];

    let merged: MemberStatItem;
    if (hasLegacyOnlyGames && gAgg) {
      // 레거시(제1~8회)가 포함된 구간: 게임/우마/순위는 전체 구간 합산, 상세 국별 스탯은 제9회~ 상세 집계 유지
      const overallBase = createZeroDetailedStatItem(name, gAgg);
      if (det) {
        merged = {
          ...det,
          totalUma: overallBase.totalUma,
          avgUma: overallBase.avgUma,
          avgRank: overallBase.avgRank,
          totalGames: overallBase.totalGames,
          rank1Count: overallBase.rank1Count,
          rank2Count: overallBase.rank2Count,
          rank3Count: overallBase.rank3Count,
          rank4Count: overallBase.rank4Count,
          top2Rate: overallBase.top2Rate,
        };
      } else {
        merged = overallBase;
      }
    } else if (det) {
      merged = det;
    } else if (gAgg) {
      merged = createZeroDetailedStatItem(name, gAgg);
    } else {
      continue;
    }

    if (merged.totalGames >= minGames) {
      members.push(attachRatingMetadata(merged, allStatsMap, normalizedAllStatsMap));
    }
  }

  members.sort((a, b) => b.totalUma - a.totalUma);

  const totalMatchedGames = hasLegacyOnlyGames
    ? matchedGames.length
    : (roundGameIdSet.size || matchedGames.length);
  const totalMatchedRounds = Math.round(filteredRoundRows.length / 4);
  const elapsed = Math.max(1, Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0));

  return {
    members,
    matchedSessions: matchedSessionNames,
    totalMatchedGames,
    totalMatchedRounds,
    hasLegacyOnlyGames,
    queryElapsedMs: elapsed,
    summaryLabel,
  };
}

export interface SeatRankStatItem {
  seat: '東' | '南' | '西' | '北';
  seatLabel: string;
  totalGames: number;
  r1: number;
  r2: number;
  r3: number;
  r4: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  top2Rate: number;
  tobiRate: number;
  avgRank: number;
  avgUma: number;
}

export interface SeatRankStatsResult {
  seats: SeatRankStatItem[];
  totalGames: number;
}

/**
 * 시작 자리(東·南·西·北)별 1~4위율, 평균 순위, 평균 우마, 토비율을 국별 기록(제9회~)에서 집계합니다.
 */
export async function fetchSeatRankStats(options?: {
  recentSessions?: number;
  recentGames?: number;
  startSession?: string;
  endSession?: string;
  startDate?: string;
  endDate?: string;
  playerName?: string;
  availableSessions?: string[];
  spreadsheetId?: string;
  forceRefresh?: boolean;
}): Promise<SeatRankStatsResult> {
  const allRows = await fetchAllPublicRoundsRows(options?.spreadsheetId, options?.forceRefresh);
  const seatOrder: Array<'東' | '南' | '西' | '北'> = ['東', '南', '西', '北'];
  const seatLabels: Record<'東' | '南' | '西' | '北', string> = {
    '東': '東 (동가 · 기가)',
    '南': '南 (남가)',
    '西': '西 (서가)',
    '北': '北 (북가)',
  };
  const normTargetPlayer = options?.playerName ? normalizeRatingPlayerName(options.playerName) : '';

  const sortedSessions = [...(options?.availableSessions || [])].sort(
    (a, b) => parseSessionNumber(b) - parseSessionNumber(a)
  );
  const sessionDateByNum = new Map<number, string>();
  for (const s of sortedSessions) {
    const num = parseSessionNumber(s);
    const iso = extractIsoDateFromRecord(s);
    if (num > 0 && iso && !sessionDateByNum.has(num)) {
      sessionDateByNum.set(num, iso);
    }
  }

  let targetSessionNums: Set<number> | null = null;
  if (options?.recentSessions && options.recentSessions > 0 && sortedSessions.length > 0) {
    const picked = sortedSessions.slice(0, Math.floor(options.recentSessions));
    targetSessionNums = new Set(picked.map((s) => parseSessionNumber(s)).filter((n) => n > 0));
  } else if (options?.startSession || options?.endSession) {
    const sNum = parseSessionNumber(options.startSession);
    const eNum = parseSessionNumber(options.endSession);
    const minN = sNum > 0 && eNum > 0 ? Math.min(sNum, eNum) : Math.max(sNum, eNum);
    const maxN = sNum > 0 && eNum > 0 ? Math.max(sNum, eNum) : Math.max(sNum, eNum);
    if (minN > 0 && maxN > 0) {
      const picked = sortedSessions.filter((s) => {
        const n = parseSessionNumber(s);
        return n >= minN && n <= maxN;
      });
      targetSessionNums = new Set(picked.map((s) => parseSessionNumber(s)).filter((n) => n > 0));
    }
  }

  const startDate = (options?.startDate || '').trim();
  const endDate = (options?.endDate || '').trim();
  const hasDateFilter = Boolean(startDate || endDate);

  // gameId별 첫 국(최소 roundSeq) 4인 순서 및 토비 여부 수집
  const gameMap = new Map<
    string,
    {
      orderIdx: number;
      sessNum: number;
      minRound: number;
      firstRoundEntries: { name: string; isEast: boolean; rank: number; uma: number }[];
      tobiPlayers: Set<string>;
    }
  >();

  let gameOrderCounter = 0;
  for (let i = 0; i < allRows.length; i++) {
    const r = allRows[i];
    if (!r?.c) continue;
    const gameId = getCellStr(r.c[1]).trim();
    const player = getCellStr(r.c[5]).trim();
    if (!gameId || !player) continue;

    const rowSess = getCellStr(r.c[15]).trim();
    const sessNum = parseSessionNumber(rowSess);
    if (targetSessionNums && !targetSessionNums.has(sessNum)) continue;
    if (hasDateFilter) {
      const iso =
        extractIsoDateFromRecord(rowSess, getCellStr(r.c[0]), gameId) ||
        (sessNum > 0 ? sessionDateByNum.get(sessNum) || '' : '');
      if (!iso) continue;
      if (startDate && iso < startDate) continue;
      if (endDate && iso > endDate) continue;
    }

    const roundSeq = getCellNum(r.c[3], 999);
    const isEast = r.c[6]?.v === true || r.c[6]?.v === 'TRUE' || r.c[6]?.v === 1;
    const finalScore = getCellNum(r.c[8], 0);
    const rank = getCellNum(r.c[13], 0);
    const uma = getCellNum(r.c[14], 0);

    let g = gameMap.get(gameId);
    if (!g) {
      g = {
        orderIdx: gameOrderCounter++,
        sessNum,
        minRound: roundSeq,
        firstRoundEntries: [],
        tobiPlayers: new Set<string>(),
      };
      gameMap.set(gameId, g);
    }

    if (finalScore < 0) {
      g.tobiPlayers.add(player);
    }

    if (roundSeq < g.minRound) {
      g.minRound = roundSeq;
      g.firstRoundEntries = [{ name: player, isEast, rank, uma }];
    } else if (roundSeq === g.minRound) {
      if (!g.firstRoundEntries.some((e) => e.name === player)) {
        g.firstRoundEntries.push({ name: player, isEast, rank, uma });
      }
    }
  }

  const acc: Record<
    '東' | '南' | '西' | '北',
    { total: number; r1: number; r2: number; r3: number; r4: number; rankSum: number; umaSum: number; tobi: number }
  > = {
    '東': { total: 0, r1: 0, r2: 0, r3: 0, r4: 0, rankSum: 0, umaSum: 0, tobi: 0 },
    '南': { total: 0, r1: 0, r2: 0, r3: 0, r4: 0, rankSum: 0, umaSum: 0, tobi: 0 },
    '西': { total: 0, r1: 0, r2: 0, r3: 0, r4: 0, rankSum: 0, umaSum: 0, tobi: 0 },
    '北': { total: 0, r1: 0, r2: 0, r3: 0, r4: 0, rankSum: 0, umaSum: 0, tobi: 0 },
  };

  const orderedGames = Array.from(gameMap.values()).sort(
    (a, b) => a.sessNum - b.sessNum || a.orderIdx - b.orderIdx
  );

  let validGames = 0;

  if (normTargetPlayer) {
    // 특정 플레이어의 시작 자리별 기록만 추출 (recentGames 옵션 지원)
    const playerGames: Array<{
      seat: '東' | '南' | '西' | '北';
      rank: number;
      uma: number;
      isTobi: boolean;
    }> = [];

    for (const g of orderedGames) {
      if (g.firstRoundEntries.length !== 4) continue;
      const ordered = [...g.firstRoundEntries];
      const eastIdx = ordered.findIndex((e) => e.isEast);
      const rotated =
        eastIdx > 0 ? [...ordered.slice(eastIdx), ...ordered.slice(0, eastIdx)] : ordered;

      const allValidRanks = rotated.every((e) => e.rank >= 1 && e.rank <= 4);
      if (!allValidRanks) continue;

      const myIdx = rotated.findIndex((e) => normalizeRatingPlayerName(e.name) === normTargetPlayer);
      if (myIdx === -1) continue;
      const entry = rotated[myIdx];
      playerGames.push({
        seat: seatOrder[myIdx],
        rank: entry.rank,
        uma: entry.uma,
        isTobi: g.tobiPlayers.has(entry.name),
      });
    }

    const sliced =
      options?.recentGames && options.recentGames > 0
        ? playerGames.slice(-Math.floor(options.recentGames))
        : playerGames;

    validGames = sliced.length;
    for (const pg of sliced) {
      const bucket = acc[pg.seat];
      bucket.total++;
      bucket.rankSum += pg.rank;
      bucket.umaSum += pg.uma;
      if (pg.rank === 1) bucket.r1++;
      else if (pg.rank === 2) bucket.r2++;
      else if (pg.rank === 3) bucket.r3++;
      else if (pg.rank === 4) bucket.r4++;
      if (pg.isTobi) bucket.tobi++;
    }
  } else {
    for (const g of orderedGames) {
      if (g.firstRoundEntries.length !== 4) continue;
      const ordered = [...g.firstRoundEntries];
      const eastIdx = ordered.findIndex((e) => e.isEast);
      const rotated =
        eastIdx > 0 ? [...ordered.slice(eastIdx), ...ordered.slice(0, eastIdx)] : ordered;

      const allValidRanks = rotated.every((e) => e.rank >= 1 && e.rank <= 4);
      if (!allValidRanks) continue;

      validGames++;
      for (let idx = 0; idx < 4; idx++) {
        const seat = seatOrder[idx];
        const entry = rotated[idx];
        const bucket = acc[seat];
        bucket.total++;
        bucket.rankSum += entry.rank;
        bucket.umaSum += entry.uma;
        if (entry.rank === 1) bucket.r1++;
        else if (entry.rank === 2) bucket.r2++;
        else if (entry.rank === 3) bucket.r3++;
        else if (entry.rank === 4) bucket.r4++;
        if (g.tobiPlayers.has(entry.name)) bucket.tobi++;
      }
    }
  }

  const seats: SeatRankStatItem[] = seatOrder.map((seat) => {
    const b = acc[seat];
    const tot = b.total;
    return {
      seat,
      seatLabel: seatLabels[seat],
      totalGames: tot,
      r1: b.r1,
      r2: b.r2,
      r3: b.r3,
      r4: b.r4,
      p1: tot > 0 ? parseFloat(((b.r1 / tot) * 100).toFixed(2)) : 0,
      p2: tot > 0 ? parseFloat(((b.r2 / tot) * 100).toFixed(2)) : 0,
      p3: tot > 0 ? parseFloat(((b.r3 / tot) * 100).toFixed(2)) : 0,
      p4: tot > 0 ? parseFloat(((b.r4 / tot) * 100).toFixed(2)) : 0,
      top2Rate: tot > 0 ? parseFloat((((b.r1 + b.r2) / tot) * 100).toFixed(2)) : 0,
      tobiRate: tot > 0 ? parseFloat(((b.tobi / tot) * 100).toFixed(2)) : 0,
      avgRank: tot > 0 ? parseFloat((b.rankSum / tot).toFixed(3)) : 0,
      avgUma: tot > 0 ? parseFloat((b.umaSum / tot).toFixed(2)) : 0,
    };
  });

  return {
    seats,
    totalGames: validGames,
  };
}

export interface HighScoreDealInRecord {
  id: string;
  sessionName: string;
  sessNum: number;
  date: string;
  gameId: string;
  roundName: string;
  roundSeq: number;
  loserName: string;  // 방총자 (쏘인 사람)
  winnerName: string; // 화료자 (쏜 사람 / 론 화료자)
  score: number;      // 방총 타점
  isOyaWin: boolean;
  isLoserRiichi: boolean;
  isDoubleRon: boolean;
}

/**
 * 전체 국별 기록(제9회~)에서 고타점 방총(기본 8,000점 이상) 이벤트 목록을 최신순으로 추출합니다.
 * 누가 누구에게 몇 점 쏘였는지(더블론 포함) 정확히 매핑합니다.
 */
export async function fetchHighScoreDealIns(options?: {
  minScore?: number;
  availableSessions?: string[];
  allStats?: MemberStatItem[];
  spreadsheetId?: string;
  forceRefresh?: boolean;
}): Promise<HighScoreDealInRecord[]> {
  const minScore = Math.max(1000, Number(options?.minScore ?? 8000));
  const allRows = await fetchAllPublicRoundsRows(options?.spreadsheetId, options?.forceRefresh);

  // 대표 닉네임(신시 -> 신시★ 등) 및 회차번호 -> 전체 회차명/일자 매핑
  const canonicalNameByNorm = new Map<string, string>();
  for (const s of options?.allStats || []) {
    if (!s?.name) continue;
    const norm = normalizeRatingPlayerName(s.name);
    if (!norm) continue;
    const prev = canonicalNameByNorm.get(norm);
    if (!prev || s.name.includes('★')) {
      canonicalNameByNorm.set(norm, s.name);
    }
  }
  const resolveCanon = (raw: string): string => {
    const clean = String(raw || '').trim();
    if (!clean) return '';
    return canonicalNameByNorm.get(normalizeRatingPlayerName(clean)) || clean;
  };

  const sessionInfoByNum = new Map<number, { fullLabel: string; isoDate: string }>();
  for (const s of options?.availableSessions || []) {
    const num = parseSessionNumber(s);
    if (num > 0 && !sessionInfoByNum.has(num)) {
      sessionInfoByNum.set(num, { fullLabel: s, isoDate: extractIsoDateFromRecord(s) });
    }
  }

  // (gameId + roundSeq) 단위로 4인 행 그룹화
  interface RoundRowEntry {
    player: string;
    isEast: boolean;
    delta: number;
    isRiichi: boolean;
    isWin: boolean;
    isLose: boolean;
    pureScore: number;
  }
  const roundMap = new Map<
    string,
    {
      firstIdx: number;
      gameId: string;
      gameNum: number;
      roundSeq: number;
      roundName: string;
      endStatus: string;
      sessionName: string;
      sessNum: number;
      date: string;
      entries: RoundRowEntry[];
    }
  >();

  for (let i = 0; i < allRows.length; i++) {
    const r = allRows[i];
    if (!r?.c) continue;
    const gameId = getCellStr(r.c[1]).trim();
    const rawPlayer = getCellStr(r.c[5]).trim();
    if (!gameId || !rawPlayer) continue;
    const roundSeq = getCellNum(r.c[3], 0);
    const key = `${gameId}__${roundSeq}`;

    let grp = roundMap.get(key);
    if (!grp) {
      const rawSess = getCellStr(r.c[15]).trim();
      const sessNum = parseSessionNumber(rawSess);
      const sessInfo = sessNum > 0 ? sessionInfoByNum.get(sessNum) : undefined;
      const isoDate =
        extractIsoDateFromRecord(rawSess, getCellStr(r.c[0]), gameId) ||
        sessInfo?.isoDate ||
        '';
      grp = {
        firstIdx: i,
        gameId,
        gameNum: Number(gameId) || 0,
        roundSeq,
        roundName: getCellStr(r.c[2]).trim(),
        endStatus: getCellStr(r.c[4]).toLowerCase(),
        sessionName: sessInfo?.fullLabel || rawSess || (sessNum > 0 ? `제${sessNum}회` : ''),
        sessNum,
        date: isoDate,
        entries: [],
      };
      roundMap.set(key, grp);
    }

    grp.entries.push({
      player: resolveCanon(rawPlayer),
      isEast: r.c[6]?.v === true || r.c[6]?.v === 'TRUE' || r.c[6]?.v === 1,
      delta: getCellNum(r.c[7], 0),
      isRiichi: r.c[9]?.v === true || r.c[9]?.v === 'TRUE' || r.c[9]?.v === 1,
      isWin: r.c[10]?.v === true || r.c[10]?.v === 'TRUE' || r.c[10]?.v === 1,
      isLose: r.c[11]?.v === true || r.c[11]?.v === 'TRUE' || r.c[11]?.v === 1,
      pureScore: getCellNum(r.c[19], 0),
    });
  }

  const results: Array<HighScoreDealInRecord & { _sortSess: number; _sortGame: number; _sortRound: number; _sortIdx: number }> = [];

  for (const grp of roundMap.values()) {
    const losers = grp.entries.filter((e) => e.isLose);
    const winners = grp.entries.filter((e) => e.isWin);
    if (losers.length === 0 || winners.length === 0) continue;

    const isDoubleRon = winners.length >= 2;
    for (const loser of losers) {
      for (const winner of winners) {
        if (loser.player === winner.player) continue;
        // 순수 타점(pureScore) 우선, 미기재 시 방총자 손실 또는 화료자 득점(단일 론)으로 보완
        let dealInScore = winner.pureScore > 0 ? winner.pureScore : 0;
        if (dealInScore <= 0) {
          if (!isDoubleRon) {
            const absLoserLoss = Math.abs(loser.delta) - (loser.isRiichi ? 1000 : 0);
            dealInScore = absLoserLoss > 0 ? absLoserLoss : Math.max(0, winner.delta);
          } else {
            dealInScore = Math.max(0, winner.delta);
          }
        }
        dealInScore = Math.round(dealInScore);
        if (dealInScore < minScore) continue;

        results.push({
          id: `${grp.gameId}_${grp.roundSeq}_${loser.player}_${winner.player}`,
          sessionName: grp.sessionName,
          sessNum: grp.sessNum,
          date: grp.date,
          gameId: grp.gameId,
          roundName: grp.roundName,
          roundSeq: grp.roundSeq,
          loserName: loser.player,
          winnerName: winner.player,
          score: dealInScore,
          isOyaWin: winner.isEast,
          isLoserRiichi: loser.isRiichi,
          isDoubleRon,
          _sortSess: grp.sessNum,
          _sortGame: grp.gameNum,
          _sortRound: grp.roundSeq,
          _sortIdx: grp.firstIdx,
        });
      }
    }
  }

  // 최신순 정렬 (회차 내림차순 -> 대국 내림차순 -> 국 내림차순)
  results.sort((a, b) => {
    if (b._sortSess !== a._sortSess) return b._sortSess - a._sortSess;
    if (b._sortGame !== a._sortGame) return b._sortGame - a._sortGame;
    if (b._sortRound !== a._sortRound) return b._sortRound - a._sortRound;
    return b._sortIdx - a._sortIdx;
  });

  return results.map(({ _sortSess, _sortGame, _sortRound, _sortIdx, ...rec }) => rec);
}

