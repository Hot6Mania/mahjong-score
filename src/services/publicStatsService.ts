/**
 * Public Stats Service: 비로그인 외부 관전자/모임원용 통계 및 회차 결과 조회 서비스
 * Cloudflare Worker 엣지 캐시(3분)를 우선 호출하고, 미설정 또는 장애 시 Google GViz 공용 API로 자동 폴백합니다.
 * 스프레드시트 접근 주소(ID)는 하드코딩하지 않고, 서버 Secret 및 .env 암호화 토큰을 통해 복호화하여 사용합니다.
 */

// 클라이언트 캐시된 스프레드시트 ID (복호화 결과)
let resolvedClientSpreadsheetId: string | null = null;

/**
 * 환경 변수(VITE_ENCRYPTED_SPREADSHEET_ID + VITE_ENCRYPTION_KEY 또는 VITE_SPREADSHEET_ID)에서
 * 스프레드시트 ID를 안전하게 복호화/해석합니다. (하드코딩 방지)
 */
export async function resolveSpreadsheetId(): Promise<string> {
  if (resolvedClientSpreadsheetId) return resolvedClientSpreadsheetId;

  // 1. .env에 평문 VITE_SPREADSHEET_ID가 설정되어 있는 경우
  const plain = (import.meta as any).env?.VITE_SPREADSHEET_ID;
  if (plain && String(plain).trim()) {
    resolvedClientSpreadsheetId = String(plain).trim();
    return resolvedClientSpreadsheetId;
  }

  // 2. .env에 암호화된 토큰(VITE_ENCRYPTED_SPREADSHEET_ID)과 키(VITE_ENCRYPTION_KEY)가 있는 경우 복호화
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
        avgRank: parseFloat(getCellNum(r.c[2]).toFixed(2)),
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
        avgRank: s.gamesCount > 0 ? parseFloat((s.rankSum / s.gamesCount).toFixed(2)) : 0,
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

// 메모리 캐시 (세션 동안 유지)
let cachedAllStats: MemberStatItem[] | null = null;
let cachedSessionsDetail: Record<string, SessionDetail> = {};

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
        if (!name || name === "이름") return;

        const sheetUma = parseFloat(getCellNum(row[1]).toFixed(1));
        const totalUma = tonggeMap[name] !== undefined ? tonggeMap[name] : sheetUma;
        const avgRank = parseFloat(getCellNum(row[2]).toFixed(2));
        const totalGames = getCellNum(row[3]);
        const avgUma = totalGames > 0 ? parseFloat((totalUma / totalGames).toFixed(1)) : 0;
        const rank1Count = getCellNum(row[33]);
        const rank2Count = getCellNum(row[34]);
        const rank3Count = getCellNum(row[35]);
        const rank4Count = getCellNum(row[36]);
        const top2Rate = totalGames > 0
          ? parseFloat((((rank1Count + rank2Count) / totalGames) * 100).toFixed(1))
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
          winRate: parseFloat((getCellNum(row[5]) * 100).toFixed(1)),
          dealInRate: parseFloat((getCellNum(row[6]) * 100).toFixed(1)),
          riichiRate: parseFloat((getCellNum(row[7]) * 100).toFixed(1)),
          tenpaiRate: parseFloat((getCellNum(row[8]) * 100).toFixed(1)),
          avgWinScore: Math.round(getCellNum(row[9])),
          avgDealInScore: Math.round(getCellNum(row[10])),
          handEV: Math.round(getCellNum(row[11])),
          winEfficiency: Math.round(getCellNum(row[12])),
          dealInLoss: Math.round(getCellNum(row[13])),
          netWinEfficiency: Math.round(getCellNum(row[14])),
          tsumoRate: parseFloat((getCellNum(row[15]) * 100).toFixed(1)),
          drawRate: parseFloat((getCellNum(row[16]) * 100).toFixed(1)),
          drawTenpaiRate: parseFloat((getCellNum(row[17]) * 100).toFixed(1)),
          tobiRate: parseFloat((getCellNum(row[18]) * 100).toFixed(1)),
          riichiWinRate: parseFloat((getCellNum(row[20]) * 100).toFixed(1)),
          riichiDealInRate: parseFloat((getCellNum(row[21]) * 100).toFixed(1)),
          riichiDrawRate: parseFloat((getCellNum(row[22]) * 100).toFixed(1)),
          riichiEV: Math.round(getCellNum(row[23])),
          riichiIncomeAvg: Math.round(getCellNum(row[24])),
          riichiExpenseAvg: Math.round(getCellNum(row[25])),
          firstRiichiRate: parseFloat((getCellNum(row[26]) * 100).toFixed(1)),
          chaseRiichiRate: parseFloat((getCellNum(row[27]) * 100).toFixed(1)),
          chasedRiichiRate: parseFloat((getCellNum(row[28]) * 100).toFixed(1)),
          oyaKaburiRate: parseFloat((getCellNum(row[29]) * 100).toFixed(1)),
          oyaKaburiAvg: Math.round(getCellNum(row[30])),
          dealInRiichiRate: parseFloat((getCellNum(row[31]) * 100).toFixed(1)),
          totalScore: getCellNum(row[32]),
        };
      });
    }

    // 3) '통계' 시트의 모든 멤버가 누락 없이 포함되도록 통합
    const allNames = Array.from(new Set([...Object.keys(tonggeMap), ...Object.keys(detailedStatsMap)]));

    const items: MemberStatItem[] = allNames.map(name => {
      if (detailedStatsMap[name]) {
        return detailedStatsMap[name];
      }
      const totalUma = tonggeMap[name] || 0;
      return {
        name,
        totalUma,
        avgUma: 0,
        avgRank: 0,
        totalGames: 0,
        rank1Count: 0,
        rank2Count: 0,
        rank3Count: 0,
        rank4Count: 0,
        top2Rate: 0,
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
        chasedRiichiRate: 0,
        oyaKaburiRate: 0,
        oyaKaburiAvg: 0,
        dealInRiichiRate: 0,
        totalScore: 0,
      };
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
 * 9회차 이상은 `${session} (raw)` 우선 참조, 1~8회차는 `${session}` 참조
 */
export async function fetchPublicSessionDetail(
  sessionName: string,
  spreadsheetId?: string
): Promise<SessionDetail> {
  if (cachedSessionsDetail[sessionName]) {
    return cachedSessionsDetail[sessionName];
  }

  const workerUrl = getWorkerUrl();
  const match = sessionName.match(/제(\d+)회/);
  const sessionNum = match ? parseInt(match[1], 10) : 0;
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
    if (!name || name === "이름") return;

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
  members.forEach(name => {
    trajMap[name] = [0];
  });

  games.forEach((g, gIdx) => {
    members.forEach(name => {
      const prev = trajMap[name][gIdx];
      const match = g.players.find(p => p.name === name);
      const delta = match ? match.uma : 0;
      trajMap[name].push(parseFloat((prev + delta).toFixed(1)));
    });
  });

  const datasets: UmaTrajectoryDataset[] = members.map((name, i) => {
    const data = trajMap[name];
    const finalUma = data[data.length - 1];
    return {
      name,
      data,
      color: PLAYER_COLORS[i % PLAYER_COLORS.length],
      finalUma,
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
  svgPath: string;
  svgAreaPath: string;
  currentMarkerX: number; // 0 ~ 100 (%)
  currentMarkerY: number; // 0 ~ 44 (SVG Y)
}

export function calculateMetricDistribution(
  allStats: MemberStatItem[],
  metricKey: keyof MemberStatItem,
  metricName: string,
  currentValue: number,
  unit: string = '%',
  higherIsBetter: boolean = true
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
      svgPath: '',
      svgAreaPath: '',
      currentMarkerX: 50,
      currentMarkerY: 22,
    };
  }

  const values: number[] = allStats
    .map(s => Number(s[metricKey]))
    .filter(v => !isNaN(v));

  const min = Math.min(...values);
  const max = Math.max(...values);
  const sum = values.reduce((acc, v) => acc + v, 0);
  const avg = parseFloat((sum / values.length).toFixed(1));

  // 순위 및 백분위 계산
  let rank = 1;
  values.forEach(v => {
    if (higherIsBetter) {
      if (v > currentValue) rank++;
    } else {
      if (v < currentValue) rank++;
    }
  });

  const topPct = parseFloat(((rank / values.length) * 100).toFixed(1));
  const bottomPct = parseFloat((100 - topPct).toFixed(1));
  const isUpperHalf = rank <= Math.ceil(values.length / 2);
  const percentileText = `상위 ${topPct}% (하위 ${bottomPct}%) · ${isUpperHalf ? '상위 50% 이내' : '하위 50%'}`;

  // 컴팩트한 히스토그램 빈 생성 (7구간)
  const numBins = 7;
  const range = max - min === 0 ? 1 : max - min;
  const binWidth = range / numBins;
  const binCounts = new Array(numBins).fill(0);

  values.forEach(v => {
    let b = Math.floor((v - min) / binWidth);
    if (b >= numBins) b = numBins - 1;
    if (b < 0) b = 0;
    binCounts[b]++;
  });

  const maxBinCount = Math.max(...binCounts, 1);
  const svgWidth = 160; // 좁혀진 차트 폭
  const baseline = 38;
  const topY = 6;

  // 빈 중심점 좌표 생성
  const points: { x: number; y: number }[] = [];
  // 시작점
  points.push({ x: 0, y: baseline });

  for (let i = 0; i < numBins; i++) {
    const x = ((i + 0.5) / numBins) * svgWidth;
    const h = (binCounts[i] / maxBinCount) * (baseline - topY);
    const y = baseline - h;
    points.push({ x, y });
  }
  // 끝점
  points.push({ x: svgWidth, y: baseline });

  // 부드러운 Bezier SVG 패스 생성
  let svgPath = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const cpX = (prev.x + curr.x) / 2;
    svgPath += ` Q ${prev.x} ${prev.y}, ${cpX} ${(prev.y + curr.y) / 2}`;
  }
  svgPath += ` T ${points[points.length - 1].x} ${points[points.length - 1].y}`;

  // 폐곡선 영역 패스 (아래 채우기용)
  const svgAreaPath = `${svgPath} L ${svgWidth} ${baseline} L 0 ${baseline} Z`;

  // 현재 플레이어의 X 위치 (0 ~ 100%)
  const clampedX = Math.max(3, Math.min(97, ((currentValue - min) / range) * 100));

  // 현재 위치에서의 Y 높이 추정
  const playerBin = Math.min(numBins - 1, Math.max(0, Math.floor(((currentValue - min) / range) * numBins)));
  const playerH = (binCounts[playerBin] / maxBinCount) * (baseline - topY);
  const currentMarkerY = baseline - playerH;

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
    svgPath,
    svgAreaPath,
    currentMarkerX: clampedX,
    currentMarkerY,
  };
}
