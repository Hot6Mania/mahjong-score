/**
 * 마작 레이팅 기본 상수
 */
export const DEFAULT_MU = 1500;
export const DEFAULT_SIGMA = 120; // 초기 불확실도
export const BETA = 60; // 마작의 운(패산/배패) 변동성 완충 계수

/**
 * 레이팅 구간별 색상 정의 (등급 명칭 텍스트 미사용, 색상만 적용)
 * - 1700 이상: #38BEDA (혼천색)
 * - 1600대: #CD4A62 (작성색)
 * - 1500대: #E88640 (작호색)
 * - 1400대: #FDD221 (작걸색)
 * - 1300대: #21A73C (작사색)
 * - 1200대 이하: #98B324 (초심색)
 */
export const RATING_COLORS = {
  choncheon: '#38BEDA',
  jakseong: '#CD4A62',
  jakho: '#E88640',
  jakgeol: '#CA8A04',
  jaksa: '#21A73C',
  chosim: '#98B324'
} as const;

export function getRatingColor(rating: number | undefined | null): string {
  if (!rating || isNaN(rating)) return '#64748b';
  if (rating >= 1700) return RATING_COLORS.choncheon;
  if (rating >= 1600) return RATING_COLORS.jakseong;
  if (rating >= 1500) return RATING_COLORS.jakho;
  if (rating >= 1400) return RATING_COLORS.jakgeol;
  if (rating >= 1300) return RATING_COLORS.jaksa;
  return RATING_COLORS.chosim;
}

export function hexToRgba(color: string, alpha: number): string {
  if (!color) return `rgba(100, 116, 139, ${alpha})`;
  if (color.startsWith('rgba')) {
    return color.replace(/[\d\.]+\)$/, `${alpha})`);
  }
  if (color.startsWith('rgb')) {
    return color.replace('rgb', 'rgba').replace(')', `, ${alpha})`);
  }
  let c = color.replace('#', '');
  if (c.length === 3) {
    c = c.split('').map(x => x + x).join('');
  }
  const num = parseInt(c, 16);
  if (isNaN(num)) return `rgba(100, 116, 139, ${alpha})`;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export interface PlayerRating {
  name: string;
  mu: number;
  sigma: number;
  ordinal: number; // Math.round(mu - 1.5 * sigma)
  games: number;
  peakOrdinal: number;
  lowestOrdinal: number;
  recentDelta: number; // 가장 최근 대국 변동치 (Δ)
  recentDeltas?: number[]; // 최근 N대국 변동치 목록
  lastUpdated?: string; // 마지막 반영 대국/일시
  history?: {
    gameIndex: number;
    gameId?: string;
    ordinal: number;
    delta: number;
    sessionLabel?: string;
    date?: string;
    rank?: number;
  }[];
}

export interface MatchPlayerInput {
  name: string;
  rank: number; // 1, 2, 3, 4 (동점 시 동일 rank)
  score?: number;
  uma?: number;
}

export interface MatchDeltaResult {
  delta: number;
  oldOrdinal: number;
  newOrdinal: number;
  oldMu: number;
  newMu: number;
  oldSigma: number;
  newSigma: number;
}

export interface GameRatingHistoryRecord {
  gameIndex: number;
  sessionLabel: string;
  date: string;
  players: {
    name: string;
    rank: number;
    score: number;
    uma: number;
    ordinal: number;
    delta: number;
  }[];
}

/**
 * 표시 레이팅 계산: μ - 1.5σ (정수 반올림)
 * 초기값(mu=1500, sigma=120)일 때 약 1320점
 */
export function computeOrdinal(mu: number, sigma: number): number {
  return Math.round(mu - 1.5 * sigma);
}

/**
 * 신규 플레이어 초기 레이팅 객체 생성
 */
export function createInitialRating(name: string): PlayerRating {
  const ord = computeOrdinal(DEFAULT_MU, DEFAULT_SIGMA);
  return {
    name,
    mu: DEFAULT_MU,
    sigma: DEFAULT_SIGMA,
    ordinal: ord,
    games: 0,
    peakOrdinal: ord,
    lowestOrdinal: ord,
    recentDelta: 0,
    recentDeltas: [],
    history: [
      {
        gameIndex: 0,
        ordinal: ord,
        delta: 0,
        sessionLabel: '초기값',
        date: ''
      }
    ]
  };
}

/**
 * 단일 대국 결과(4인)를 바탕으로 순수 우마(Uma) 직접 반영 및 베이지안 불확실도 감쇄 레이팅 계산
 */
export function calculateMatchRatings(
  matchPlayers: MatchPlayerInput[],
  currentRatings: Record<string, PlayerRating>,
  metadata?: { gameId?: string; sessionLabel?: string; date?: string; gameIndex?: number }
): {
  updatedRatings: Record<string, PlayerRating>;
  matchDeltas: Record<string, MatchDeltaResult>;
} {
  const updatedRatings: Record<string, PlayerRating> = {};
  const matchDeltas: Record<string, MatchDeltaResult> = {};

  // 1. 4명의 기존 레이팅 객체 확보 및 테이블 평균 레이팅 계산
  const playerStates = matchPlayers.map(p => {
    const prev = currentRatings[p.name] || createInitialRating(p.name);
    return { input: p, prev };
  });

  const avgTableRating = playerStates.reduce((sum, p) => sum + p.prev.ordinal, 0) / (playerStates.length || 1);
  const totalVariance = playerStates.reduce((acc, p) => acc + (p.prev.sigma ** 2) + (BETA ** 2), 0);
  const c = Math.sqrt(totalVariance);

  // 2. 각 플레이어별 순수 우마(Uma) 직접 반영 갱신
  playerStates.forEach(({ input: p, prev }) => {
    // 순수 우마 (기록된 우마 직접 사용, 미기재 시 표준 마작 반환점/오카/우마 규칙 기반 폴백)
    let rawUma = p.uma;
    if (rawUma === undefined || isNaN(rawUma)) {
      if (p.score !== undefined && !isNaN(p.score)) {
        const rankUma = p.rank === 1 ? 20 : (p.rank === 2 ? 10 : (p.rank === 3 ? -10 : -20));
        const oka = p.rank === 1 ? 20 : 0;
        rawUma = parseFloat((((p.score - 30000) / 1000) + rankUma + oka).toFixed(1));
      } else {
        rawUma = p.rank === 1 ? 50 : (p.rank === 2 ? 10 : (p.rank === 3 ? -15 : -45));
      }
    }

    // 상대방과의 실력차 보정 (자신보다 높은 레이팅의 테이블에서 플레이할 경우 가산점)
    const oppDiff = (avgTableRating - prev.ordinal) / 40;

    // 불확실도(sigma) 기반 학습률 스케일 (초기 플레이어는 빠른 궤도 진입, 베테랑은 안정화)
    const scale = prev.sigma / DEFAULT_SIGMA;
    const dMu = scale * (rawUma + oppDiff * 2.0);

    // 베이지안 불확실도 점진적 감쇄 (대국 수가 쌓일수록 신뢰도 증가)
    const deltaDecay = Math.min(0.06, (prev.sigma / c) ** 2 * 0.4);
    const newSigma = Math.max(40, prev.sigma * Math.sqrt(Math.max(1 - deltaDecay, 0.001)));

    const newMu = prev.mu + dMu;
    const newOrdinal = computeOrdinal(newMu, newSigma);
    const oldOrdinal = prev.ordinal;
    const delta = newOrdinal - oldOrdinal;

    matchDeltas[p.name] = {
      delta,
      oldOrdinal,
      newOrdinal,
      oldMu: parseFloat(prev.mu.toFixed(1)),
      newMu: parseFloat(newMu.toFixed(1)),
      oldSigma: parseFloat(prev.sigma.toFixed(1)),
      newSigma: parseFloat(newSigma.toFixed(1))
    };

    const newGames = prev.games + 1;
    const peak = Math.max(prev.peakOrdinal, newOrdinal);
    const lowest = Math.min(prev.lowestOrdinal, newOrdinal);
    const deltas = [...(prev.recentDeltas || []), delta].slice(-5); // 최근 5개 유지

    const nextHistory = prev.history ? [...prev.history] : [];
    if (metadata) {
      nextHistory.push({
        gameIndex: metadata.gameIndex || newGames,
        gameId: metadata.gameId,
        ordinal: newOrdinal,
        delta,
        sessionLabel: metadata.sessionLabel,
        date: metadata.date
      });
    }

    updatedRatings[p.name] = {
      ...prev,
      mu: newMu,
      sigma: newSigma,
      ordinal: newOrdinal,
      games: newGames,
      peakOrdinal: peak,
      lowestOrdinal: lowest,
      recentDelta: delta,
      recentDeltas: deltas,
      lastUpdated: metadata?.sessionLabel || prev.lastUpdated,
      history: nextHistory
    };
  });

  return { updatedRatings, matchDeltas };
}

/**
 * 1~8회차(레거시 107대국) 및 9~15회차 raw 대국 전체를 시간순으로 리플레이하여
 * 최종 선수별 레이팅 맵 및 대국별 타임라인을 도출합니다.
 */
export function replayAllHistoricalGames(
  legacyRawText: string,
  sessionRawGamesList: { sessionName: string; games: { gameId: string; time?: string; players: { name: string; rank: number; score?: number; uma?: number }[] }[] }[]
): {
  finalRatings: Record<string, PlayerRating>;
  totalReplayedGames: number;
  matchHistory: GameRatingHistoryRecord[];
} {
  const ratings: Record<string, PlayerRating> = {};
  const matchHistory: GameRatingHistoryRecord[] = [];
  let totalReplayedGames = 0;

  function ensurePlayer(name: string): PlayerRating {
    if (!ratings[name]) {
      ratings[name] = createInitialRating(name);
    }
    return ratings[name];
  }

  // A. 1~8회차 레거시 대국 순차 스트리밍
  if (legacyRawText) {
    const rawLines = legacyRawText
      .replace(/\\t/g, '\t')
      .replace(/\\\\t/g, '\t')
      .trim()
      .split('\n');

    for (const line of rawLines) {
      const parts = line.split('\t');
      if (parts.length < 14) continue;
      const sessLabel = parts[0].trim();
      const roundLabel = parts[1].trim();

      const p1Name = parts[2].trim();
      const p2Name = parts[5].trim();
      const p3Name = parts[8].trim();
      const p4Name = parts[11].trim();
      if (!p1Name || !p2Name || !p3Name || !p4Name) continue;

      [p1Name, p2Name, p3Name, p4Name].forEach(ensurePlayer);

      totalReplayedGames++;
      const matchPlayers: MatchPlayerInput[] = [
        { name: p1Name, rank: 1, score: Number(parts[3]) || 0, uma: Number(parts[4]) || 0 },
        { name: p2Name, rank: 2, score: Number(parts[6]) || 0, uma: Number(parts[7]) || 0 },
        { name: p3Name, rank: 3, score: Number(parts[9]) || 0, uma: Number(parts[10]) || 0 },
        { name: p4Name, rank: 4, score: Number(parts[12]) || 0, uma: Number(parts[13]) || 0 }
      ];

      const fullSessionLabel = `${sessLabel} ${roundLabel}`;
      const dateStr = sessLabel.split(' ')[1] || '';

      const { updatedRatings, matchDeltas } = calculateMatchRatings(matchPlayers, ratings, {
        gameIndex: totalReplayedGames,
        sessionLabel: fullSessionLabel,
        date: dateStr
      });

      matchHistory.push({
        gameIndex: totalReplayedGames,
        sessionLabel: fullSessionLabel,
        date: dateStr,
        players: matchPlayers.map(p => ({
          name: p.name,
          rank: p.rank,
          score: p.score || 0,
          uma: p.uma ?? 0,
          ordinal: updatedRatings[p.name]?.ordinal ?? computeOrdinal(DEFAULT_MU, DEFAULT_SIGMA),
          delta: matchDeltas[p.name]?.delta ?? 0
        }))
      });

      Object.assign(ratings, updatedRatings);
    }
  }

  // B. 9~15회차 raw 대국 순차 스트리밍 (회차 번호 오름차순: 제9회 -> 제15회)
  // 회차 목록을 숫자 오름차순으로 정렬
  const sortedSessions = [...sessionRawGamesList].sort((a, b) => {
    const numA = parseInt(a.sessionName.match(/제\s*(\d+)\s*회/)?.[1] || '0', 10);
    const numB = parseInt(b.sessionName.match(/제\s*(\d+)\s*회/)?.[1] || '0', 10);
    return numA - numB;
  });

  for (const session of sortedSessions) {
    const sessMatch = session.sessionName.match(/제\s*(\d+)\s*회/);
    const cleanSessionName = sessMatch ? `제${sessMatch[1]}회` : session.sessionName;
    for (let gIdx = 0; gIdx < session.games.length; gIdx++) {
      const g = session.games[gIdx];
      if (!g.players || g.players.length !== 4) continue;
      totalReplayedGames++;

      g.players.forEach(p => ensurePlayer(p.name));

      const matchPlayers: MatchPlayerInput[] = g.players.map(p => ({
        name: p.name,
        rank: p.rank || 1,
        score: p.score,
        uma: p.uma
      }));

      // rank 순 정렬 보장
      matchPlayers.sort((a, b) => a.rank - b.rank);

      const roundNum = gIdx + 1;
      const fullSessionLabel = `${cleanSessionName} ${roundNum}회전`;
      const dateStr = g.time || '';

      const { updatedRatings, matchDeltas } = calculateMatchRatings(matchPlayers, ratings, {
        gameIndex: totalReplayedGames,
        gameId: g.gameId,
        sessionLabel: fullSessionLabel,
        date: dateStr
      });

      matchHistory.push({
        gameIndex: totalReplayedGames,
        sessionLabel: fullSessionLabel,
        date: dateStr,
        players: matchPlayers.map(p => ({
          name: p.name,
          rank: p.rank,
          score: p.score || 0,
          uma: p.uma ?? 0,
          ordinal: updatedRatings[p.name]?.ordinal ?? computeOrdinal(DEFAULT_MU, DEFAULT_SIGMA),
          delta: matchDeltas[p.name]?.delta ?? 0
        }))
      });

      Object.assign(ratings, updatedRatings);
    }
  }

  return { finalRatings: ratings, totalReplayedGames, matchHistory };
}

/**
 * 레이팅 내림차순(1위 -> N위) 정렬 헬퍼
 */
export function sortRatingsDesc(ratingsMap: Record<string, PlayerRating>): PlayerRating[] {
  return Object.values(ratingsMap).sort((a, b) => {
    // 1. Ordinal(표시 레이팅) 내림차순
    if (b.ordinal !== a.ordinal) return b.ordinal - a.ordinal;
    // 2. mu 내림차순
    if (b.mu !== a.mu) return b.mu - a.mu;
    // 3. 판수 많은 순
    return b.games - a.games;
  });
}
