import { rating, rate } from 'openskill';

/**
 * OpenSkill 마작 레이팅 기본 상수
 */
export const DEFAULT_MU = 1500;
export const DEFAULT_SIGMA = 120; // 초기 불확실도
export const BETA = 60; // 마작의 운(패산/배패) 변동성 완충 계수

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
    ordinal: number;
    delta: number;
  }[];
}

/**
 * 표시 레이팅(보수적 랭킹 지표) 계산: μ - 1.5σ (정수 반올림)
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
 * 단일 대국 결과(4인)를 바탕으로 OpenSkill 레이팅 계산
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

  // 1. 4명의 기존 레이팅 객체 확보 (없으면 초기값 생성)
  const teams = matchPlayers.map(p => {
    const existing = currentRatings[p.name] || createInitialRating(p.name);
    return [rating({ mu: existing.mu, sigma: existing.sigma })];
  });

  const ranks = matchPlayers.map(p => p.rank);

  // 2. OpenSkill Plackett-Luce 모델 레이팅 산출
  const newTeams = rate(teams, {
    rank: ranks,
    beta: BETA
  });

  // 3. 선수별 레이팅 및 델타 업데이트
  matchPlayers.forEach((p, idx) => {
    const prev = currentRatings[p.name] || createInitialRating(p.name);
    const newMu = newTeams[idx][0].mu;
    const newSigma = newTeams[idx][0].sigma;
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
    const sessName = session.sessionName;
    for (const g of session.games) {
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

      const fullSessionLabel = `${sessName} ${g.gameId || ''}`.trim();
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
