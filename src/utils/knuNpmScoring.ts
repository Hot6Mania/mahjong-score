import {
  DEFAULT_EVENT_CONFIG,
  EVENT_MATCH_SCHEDULE,
  EVENT_PLAYERS,
  EVENT_PLAYER_MAP,
  EVENT_TEAMS,
  getMatchKey,
  type EventPlayer,
  type EventScoringConfig,
  type EventTeam,
  type TeamId,
} from '@/data/knuNpm2026';

export type ResultSource = 'scorer' | 'manual';

export interface TableScoreEntryInput {
  playerId: number;
  rawScore: number;
  penalty?: number; // negative points e.g. -20
  seatIndex?: number; // 0=East, 1=South, 2=West, 3=North
}

export interface CompactRoundRecords {
  seatPlayerIds: [number, number, number, number];
  time: string[];
  score: number[][];
  riichi: boolean[][];
  win: boolean[][];
  lose: boolean[][];
  tenpai: boolean[][];
  cheat: boolean[][];
  beolbu: number[][];
  status: string[];
  riichiOrder: number[][];
  dealer: number[];
}

export interface StoredTableResult {
  key: string; // "R1-T1"
  round: number;
  table: number;
  source: ResultSource;
  entries: TableScoreEntryInput[];
  rounds?: CompactRoundRecords | null;
  submittedAt: number;
  submittedBy?: string;
  note?: string;
}

export interface EventAuditEntry {
  id: string;
  timestamp: number;
  action: 'submit' | 'update' | 'delete' | 'config' | 'rollback';
  key?: string;
  round?: number;
  table?: number;
  actor: 'staff' | 'participant';
  actorLabel?: string;
  summary: string;
  before?: StoredTableResult | null;
  after?: StoredTableResult | null;
}

export interface EventStatePayload {
  updatedAt: number;
  config: EventScoringConfig;
  results: Record<string, StoredTableResult>;
  auditLog: EventAuditEntry[];
  serverTime?: number;
}

export interface CalculatedPlayerEntry {
  playerId: number;
  teamId: TeamId;
  seatIndex: number;
  rawScore: number;
  penalty: number;
  rank: number; // display rank (1..4, tied players share top rank in split mode)
  effectiveRank: number; // e.g. 1.5 for 2-way tie at 1st
  basePoint: number;
  umaAndOka: number;
  finalPoint: number;
}

export interface TableCalculationResult {
  entries: CalculatedPlayerEntry[];
  scoreSum: number;
  expectedSum: number;
  scoreDiff: number;
  oka: number;
}

export interface DetailedRoundStats {
  trackedGames: number;
  trackedRounds: number;
  trackedTotalPoints: number;
  trackedAvgRank: number;
  trackedRankCounts: [number, number, number, number];
  winCount: number;
  ronCount: number;
  tsumoCount: number;
  dealInCount: number;
  riichiCount: number;
  riichiWinCount: number;
  riichiDealInCount: number;
  riichiDrawCount: number;
  firstRiichiCount: number;
  chaseRiichiCount: number;
  chasedRiichiCount: number;
  drawCount: number;
  drawTenpaiCount: number;
  oyaKaburiCount: number;
  dealInVsRiichiCount: number;
  cheatCount: number;
  beolbuCount: number;
  winRate: number | null; // %
  dealInRate: number | null; // %
  tsumoRate: number | null; // % of wins
  drawRate: number | null; // %
  drawTenpaiRate: number | null; // % of draws
  avgWinScore: number | null;
  avgDealInScore: number | null;
  roundSuji: number | null;
  riichiRate: number | null; // %
  riichiWinRate: number | null; // %
  riichiDealInRate: number | null; // %
  riichiDrawRate: number | null; // %
  firstRiichiRate: number | null; // % of riichis
  chaseRiichiRate: number | null; // % of riichis
  chasedRiichiRate: number | null; // % of first riichis
  riichiIncome: number | null;
  riichiExpense: number | null;
  riichiSuji: number | null;
  oyaKaburiRate: number | null; // %
  oyaKaburiAvg: number | null;
  dealInVsRiichiRate: number | null; // %
}

export interface PlayerRoundPerformance {
  round: number;
  table: number;
  key: string;
  played: boolean;
  source?: ResultSource;
  rank?: number;
  rawScore?: number;
  penalty?: number;
  finalPoint?: number;
  hasRounds?: boolean;
}

export interface PlayerStanding {
  player: EventPlayer;
  rank: number;
  gamesPlayed: number;
  trackedGames: number;
  totalPoints: number;
  avgPoint: number;
  avgRank: number;
  rankCounts: [number, number, number, number]; // 1st, 2nd, 3rd, 4th
  topRate: number; // %
  top2Rate: number; // %
  lastAvoidRate: number; // %
  bestScore: number | null;
  worstScore: number | null;
  avgRawScore: number | null;
  totalPenalty: number;
  rounds: PlayerRoundPerformance[];
  detailed: DetailedRoundStats;
}

export interface TeamStanding {
  team: EventTeam;
  rank: number;
  gamesPlayed: number;
  trackedGames: number;
  totalPoints: number;
  gapToFirst: number;
  avgRank: number;
  rankCounts: [number, number, number, number];
  roundPoints: number[]; // length 6 (R1..R6)
  cumulativePoints: number[]; // length 7 ([0, after R1, ..., after R6])
  proPoints: number;
  playerPoints: number;
  members: PlayerStanding[];
}

export interface LeagueStandingsSummary {
  completedGames: number;
  trackedGames: number;
  manualGames: number;
  totalGames: number;
  roundCompletedCounts: number[]; // length 6
  teams: TeamStanding[];
  players: PlayerStanding[];
  calculatedMatches: Record<string, TableCalculationResult>;
}

export function round1(val: number): number {
  return Math.round((val + Number.EPSILON) * 10) / 10;
}

export function normalizeConfig(partial?: Partial<EventScoringConfig> | null): EventScoringConfig {
  const c = partial || {};
  const umaArr = Array.isArray(c.uma) && c.uma.length === 4
    ? ([Number(c.uma[0]), Number(c.uma[1]), Number(c.uma[2]), Number(c.uma[3])] as [number, number, number, number])
    : [...DEFAULT_EVENT_CONFIG.uma] as [number, number, number, number];
  return {
    startingScore: Number.isFinite(Number(c.startingScore)) ? Number(c.startingScore) : DEFAULT_EVENT_CONFIG.startingScore,
    returnScore: Number.isFinite(Number(c.returnScore)) ? Number(c.returnScore) : DEFAULT_EVENT_CONFIG.returnScore,
    uma: umaArr,
    tieBreak: c.tieBreak === 'seat' ? 'seat' : 'split',
    roundMangan: c.roundMangan !== undefined ? Boolean(c.roundMangan) : DEFAULT_EVENT_CONFIG.roundMangan,
    tobi: c.tobi !== undefined ? Boolean(c.tobi) : DEFAULT_EVENT_CONFIG.tobi,
    riichiPayout: c.riichiPayout !== undefined ? Boolean(c.riichiPayout) : DEFAULT_EVENT_CONFIG.riichiPayout,
    chomboPenalty: Number.isFinite(Number(c.chomboPenalty)) ? Math.abs(Number(c.chomboPenalty)) : DEFAULT_EVENT_CONFIG.chomboPenalty,
    allowParticipantInput: c.allowParticipantInput !== undefined ? Boolean(c.allowParticipantInput) : DEFAULT_EVENT_CONFIG.allowParticipantInput,
    lockedRounds: Array.isArray(c.lockedRounds) ? c.lockedRounds.map(Number).filter((n) => n >= 1 && n <= 6) : [],
    lockedTables: Array.isArray(c.lockedTables) ? c.lockedTables.map(String) : [],
  };
}

/**
 * 4인 최종 소점 + 패널티 → M리그/설정 규칙 기준 순위·오카·우마·최종 포인트 계산
 */
export function calculateTableScoring(
  entries: TableScoreEntryInput[],
  rawConfig?: Partial<EventScoringConfig>
): TableCalculationResult {
  const config = normalizeConfig(rawConfig);
  const expectedSum = config.startingScore * 4;
  const oka = ((config.returnScore - config.startingScore) * 4) / 1000;

  const indexed = entries.map((e, idx) => ({
    playerId: Number(e.playerId),
    rawScore: Number(e.rawScore) || 0,
    penalty: Number(e.penalty) || 0,
    seatIndex: e.seatIndex !== undefined && e.seatIndex !== null ? Number(e.seatIndex) : idx,
  }));

  const scoreSum = indexed.reduce((acc, e) => acc + e.rawScore, 0);
  const scoreDiff = scoreSum - expectedSum;

  const calculated: CalculatedPlayerEntry[] = indexed.map((item) => {
    const player = EVENT_PLAYER_MAP[item.playerId];
    const teamId: TeamId = player ? player.teamId : 'A';

    const higherCount = indexed.filter((other) => {
      if (other.rawScore > item.rawScore) return true;
      if (config.tieBreak === 'seat' && other.rawScore === item.rawScore && other.seatIndex < item.seatIndex) {
        return true;
      }
      return false;
    }).length;

    const rank = higherCount + 1;
    const tiedCount =
      config.tieBreak === 'seat'
        ? 1
        : indexed.filter((other) => other.rawScore === item.rawScore).length;

    let umaSum = 0;
    let rankSum = 0;
    for (let k = 0; k < tiedCount; k++) {
      const slotRank = rank + k;
      umaSum += Number(config.uma[slotRank - 1] ?? 0);
      rankSum += slotRank;
    }
    if (rank === 1) {
      umaSum += oka;
    }

    const umaAndOka = umaSum / tiedCount;
    const effectiveRank = rankSum / tiedCount;
    const basePoint = (item.rawScore - config.returnScore) / 1000;
    const finalPoint = round1(basePoint + umaAndOka + item.penalty);

    return {
      playerId: item.playerId,
      teamId,
      seatIndex: item.seatIndex,
      rawScore: item.rawScore,
      penalty: item.penalty,
      rank,
      effectiveRank,
      basePoint: round1(basePoint),
      umaAndOka: round1(umaAndOka),
      finalPoint,
    };
  });

  return {
    entries: calculated,
    scoreSum,
    expectedSum,
    scoreDiff,
    oka: round1(oka),
  };
}

/**
 * 김케이 하우스 대시보드와 동일한 괄호 듀얼 표기 헬퍼
 * - overallVal과 trackedVal이 다르고 세부 스탯 집계 대국이 존재할 때: `overall(tracked)` 형식 반환
 */
export function formatDualMetric(
  overallVal: number | undefined | null,
  trackedVal: number | undefined | null,
  hasTrackedDiff: boolean,
  decimals = 0,
  sign = false
): string {
  const oNum = Number(overallVal || 0);
  const tNum = Number(trackedVal || 0);
  const fmt = (n: number) => (sign && n > 0 ? '+' : '') + n.toFixed(decimals);
  const oStr = fmt(oNum);
  const tStr = fmt(tNum);
  if (hasTrackedDiff && oStr !== tStr) {
    return `${oStr} (${tStr})`;
  }
  return oStr;
}

export function formatSignedPoint(val: number, decimals = 1): string {
  const num = Number(val || 0);
  const fixed = Math.abs(num) < 0.0001 ? (0).toFixed(decimals) : num.toFixed(decimals);
  if (num > 0.0001) return `+${fixed}`;
  return fixed;
}

function createEmptyDetailedStats(): DetailedRoundStats {
  return {
    trackedGames: 0,
    trackedRounds: 0,
    trackedTotalPoints: 0,
    trackedAvgRank: 0,
    trackedRankCounts: [0, 0, 0, 0],
    winCount: 0,
    ronCount: 0,
    tsumoCount: 0,
    dealInCount: 0,
    riichiCount: 0,
    riichiWinCount: 0,
    riichiDealInCount: 0,
    riichiDrawCount: 0,
    firstRiichiCount: 0,
    chaseRiichiCount: 0,
    chasedRiichiCount: 0,
    drawCount: 0,
    drawTenpaiCount: 0,
    oyaKaburiCount: 0,
    dealInVsRiichiCount: 0,
    cheatCount: 0,
    beolbuCount: 0,
    winRate: null,
    dealInRate: null,
    tsumoRate: null,
    drawRate: null,
    drawTenpaiRate: null,
    avgWinScore: null,
    avgDealInScore: null,
    roundSuji: null,
    riichiRate: null,
    riichiWinRate: null,
    riichiDealInRate: null,
    riichiDrawRate: null,
    firstRiichiRate: null,
    chaseRiichiRate: null,
    chasedRiichiRate: null,
    riichiIncome: null,
    riichiExpense: null,
    riichiSuji: null,
    oyaKaburiRate: null,
    oyaKaburiAvg: null,
    dealInVsRiichiRate: null,
  };
}

interface DetailedAccumulator {
  trackedGames: number;
  trackedRounds: number;
  trackedTotalPoints: number;
  trackedRankSum: number;
  trackedRankCounts: [number, number, number, number];
  winCount: number;
  ronCount: number;
  tsumoCount: number;
  dealInCount: number;
  winScoreSum: number;
  dealInScoreSum: number;
  roundNetDeltaSum: number;
  riichiCount: number;
  riichiWinCount: number;
  riichiDealInCount: number;
  riichiDrawCount: number;
  firstRiichiCount: number;
  chaseRiichiCount: number;
  chasedRiichiCount: number;
  riichiIncomeSum: number;
  riichiExpenseSum: number;
  riichiNetSum: number;
  drawCount: number;
  drawTenpaiCount: number;
  oyaRounds: number;
  oyaKaburiCount: number;
  oyaKaburiLossSum: number;
  dealInVsRiichiCount: number;
  cheatCount: number;
  beolbuCount: number;
}

function createAccumulator(): DetailedAccumulator {
  return {
    trackedGames: 0,
    trackedRounds: 0,
    trackedTotalPoints: 0,
    trackedRankSum: 0,
    trackedRankCounts: [0, 0, 0, 0],
    winCount: 0,
    ronCount: 0,
    tsumoCount: 0,
    dealInCount: 0,
    winScoreSum: 0,
    dealInScoreSum: 0,
    roundNetDeltaSum: 0,
    riichiCount: 0,
    riichiWinCount: 0,
    riichiDealInCount: 0,
    riichiDrawCount: 0,
    firstRiichiCount: 0,
    chaseRiichiCount: 0,
    chasedRiichiCount: 0,
    riichiIncomeSum: 0,
    riichiExpenseSum: 0,
    riichiNetSum: 0,
    drawCount: 0,
    drawTenpaiCount: 0,
    oyaRounds: 0,
    oyaKaburiCount: 0,
    oyaKaburiLossSum: 0,
    dealInVsRiichiCount: 0,
    cheatCount: 0,
    beolbuCount: 0,
  };
}

function accumulateGameRounds(
  accMap: Record<number, DetailedAccumulator>,
  rounds: CompactRoundRecords,
  calc: TableCalculationResult
) {
  if (!rounds || !Array.isArray(rounds.seatPlayerIds) || rounds.seatPlayerIds.length !== 4) return;
  const times = Array.isArray(rounds.time) ? rounds.time : [];
  if (times.length < 2) return;

  // Record tracked game-level summary for each of the 4 seated players
  for (let seat = 0; seat < 4; seat++) {
    const pid = rounds.seatPlayerIds[seat];
    const acc = accMap[pid];
    if (!acc) continue;
    const entry = calc.entries.find((e) => e.playerId === pid);
    acc.trackedGames += 1;
    if (entry) {
      acc.trackedTotalPoints = round1(acc.trackedTotalPoints + entry.finalPoint);
      acc.trackedRankSum += entry.effectiveRank;
      const rIdx = Math.min(4, Math.max(1, Math.round(entry.rank))) - 1;
      acc.trackedRankCounts[rIdx] += 1;
    }
  }

  // In mahjong-score's Records format:
  // index 0 = initial state (25000),
  // odd index (1, 3, 5, ...) = delta for each round,
  // even index (2, 4, 6, ...) = score snapshot after round,
  // final odd/even with time === '결과' or 'Result' is end-of-game marker (skip if status === 'end')
  const roundStepCount = Math.floor((times.length - 1) / 2);
  for (let step = 0; step < roundStepCount; step++) {
    const deltaIdx = step * 2 + 1;
    const label = String(times[deltaIdx] || '');
    const status = String(rounds.status?.[deltaIdx] || rounds.status?.[step + 1] || '');
    if (status === 'end' || status === 'initial' || label === '결과' || label === 'Result') {
      continue;
    }

    const riichiRow = rounds.riichi?.[deltaIdx] || rounds.riichi?.[step + 1] || [false, false, false, false];
    const winRow = rounds.win?.[deltaIdx] || rounds.win?.[step + 1] || [false, false, false, false];
    const loseRow = rounds.lose?.[deltaIdx] || rounds.lose?.[step + 1] || [false, false, false, false];
    const tenpaiRow = rounds.tenpai?.[deltaIdx] || rounds.tenpai?.[step + 1] || [false, false, false, false];
    const cheatRow = rounds.cheat?.[deltaIdx] || rounds.cheat?.[step + 1] || [false, false, false, false];
    const beolbuRow = rounds.beolbu?.[deltaIdx] || rounds.beolbu?.[step + 1] || [0, 0, 0, 0];
    const riichiOrderRow = rounds.riichiOrder?.[deltaIdx] || rounds.riichiOrder?.[step + 1] || [];
    const dealerIdx = rounds.dealer?.[deltaIdx] ?? rounds.dealer?.[step + 1] ?? -1;

    const isDraw =
      status === 'normal_draw' ||
      status === 'special_draw' ||
      status === 'nagashi' ||
      (!winRow.some(Boolean) && !cheatRow.some(Boolean) && !beolbuRow.some((b) => b > 0));
    const hasAnyLose = loseRow.some(Boolean);
    const isTsumoRound = status === 'tsumo' || (winRow.some(Boolean) && !hasAnyLose);
    const isRonRound = status === 'ron' || (winRow.some(Boolean) && hasAnyLose);
    const isPureSpecialDraw = status === 'special_draw';

    for (let seat = 0; seat < 4; seat++) {
      const pid = rounds.seatPlayerIds[seat];
      const acc = accMap[pid];
      if (!acc) continue;

      const delta = Number(rounds.score?.[seat]?.[deltaIdx] ?? 0);
      const didRiichi = Boolean(riichiRow[seat]);
      const didWin = Boolean(winRow[seat]);
      const didLose = Boolean(loseRow[seat]);
      const didTenpai = Boolean(tenpaiRow[seat]);
      const didCheat = Boolean(cheatRow[seat]);
      const beolbuCnt = Number(beolbuRow[seat] || 0);

      acc.trackedRounds += 1;
      acc.roundNetDeltaSum += delta;

      if (seat === dealerIdx) {
        acc.oyaRounds += 1;
      }

      if (didCheat) acc.cheatCount += 1;
      if (beolbuCnt > 0) acc.beolbuCount += beolbuCnt;

      if (didWin) {
        acc.winCount += 1;
        if (isTsumoRound) acc.tsumoCount += 1;
        else if (isRonRound) acc.ronCount += 1;
        // Include riichi stick refund for pure hand value approximation if delta > 0
        if (delta > 0) {
          acc.winScoreSum += delta + (didRiichi ? 1000 : 0);
        }
      }

      if (didLose) {
        acc.dealInCount += 1;
        if (delta < 0) {
          acc.dealInScoreSum += Math.abs(delta) - (didRiichi ? 1000 : 0);
        }
        // Check if winner had riichi
        const winnerHadRiichi = [0, 1, 2, 3].some((j) => j !== seat && winRow[j] && riichiRow[j]);
        if (winnerHadRiichi) {
          acc.dealInVsRiichiCount += 1;
        }
      }

      if (isTsumoRound && seat === dealerIdx && !didWin && delta < 0) {
        acc.oyaKaburiCount += 1;
        acc.oyaKaburiLossSum += Math.abs(delta) - (didRiichi ? 1000 : 0);
      }

      if (isDraw && !isPureSpecialDraw) {
        acc.drawCount += 1;
        if (didTenpai) acc.drawTenpaiCount += 1;
      }

      if (didRiichi) {
        acc.riichiCount += 1;
        acc.riichiNetSum += delta;
        if (didWin) {
          acc.riichiWinCount += 1;
          if (delta > 0) acc.riichiIncomeSum += delta + 1000;
        } else if (didLose) {
          acc.riichiDealInCount += 1;
          if (delta < 0) acc.riichiExpenseSum += Math.abs(delta);
        } else if (isDraw) {
          acc.riichiDrawCount += 1;
        }

        const orderPos = Array.isArray(riichiOrderRow) ? riichiOrderRow.indexOf(seat) : -1;
        if (orderPos === 0) {
          acc.firstRiichiCount += 1;
          if (riichiOrderRow.length >= 2) {
            acc.chasedRiichiCount += 1;
          }
        } else if (orderPos > 0) {
          acc.chaseRiichiCount += 1;
        } else {
          // Fallback if riichiOrder wasn't recorded
          const riichiTotal = riichiRow.filter(Boolean).length;
          if (riichiTotal === 1) acc.firstRiichiCount += 1;
        }
      }
    }
  }
}

function finalizeDetailedStats(acc: DetailedAccumulator): DetailedRoundStats {
  if (acc.trackedGames === 0 || acc.trackedRounds === 0) {
    return createEmptyDetailedStats();
  }
  const r = acc.trackedRounds;
  const pct = (num: number, den: number) => (den > 0 ? Number(((num / den) * 100).toFixed(2)) : null);

  return {
    trackedGames: acc.trackedGames,
    trackedRounds: r,
    trackedTotalPoints: round1(acc.trackedTotalPoints),
    trackedAvgRank: Number((acc.trackedRankSum / acc.trackedGames).toFixed(3)),
    trackedRankCounts: [...acc.trackedRankCounts] as [number, number, number, number],
    winCount: acc.winCount,
    ronCount: acc.ronCount,
    tsumoCount: acc.tsumoCount,
    dealInCount: acc.dealInCount,
    riichiCount: acc.riichiCount,
    riichiWinCount: acc.riichiWinCount,
    riichiDealInCount: acc.riichiDealInCount,
    riichiDrawCount: acc.riichiDrawCount,
    firstRiichiCount: acc.firstRiichiCount,
    chaseRiichiCount: acc.chaseRiichiCount,
    chasedRiichiCount: acc.chasedRiichiCount,
    drawCount: acc.drawCount,
    drawTenpaiCount: acc.drawTenpaiCount,
    oyaKaburiCount: acc.oyaKaburiCount,
    dealInVsRiichiCount: acc.dealInVsRiichiCount,
    cheatCount: acc.cheatCount,
    beolbuCount: acc.beolbuCount,
    winRate: pct(acc.winCount, r),
    dealInRate: pct(acc.dealInCount, r),
    tsumoRate: pct(acc.tsumoCount, acc.winCount),
    drawRate: pct(acc.drawCount, r),
    drawTenpaiRate: pct(acc.drawTenpaiCount, acc.drawCount),
    avgWinScore: acc.winCount > 0 ? Math.round(acc.winScoreSum / acc.winCount) : null,
    avgDealInScore: acc.dealInCount > 0 ? Math.round(acc.dealInScoreSum / acc.dealInCount) : null,
    roundSuji: Math.round(acc.roundNetDeltaSum / r),
    riichiRate: pct(acc.riichiCount, r),
    riichiWinRate: pct(acc.riichiWinCount, acc.riichiCount),
    riichiDealInRate: pct(acc.riichiDealInCount, acc.riichiCount),
    riichiDrawRate: pct(acc.riichiDrawCount, acc.riichiCount),
    firstRiichiRate: pct(acc.firstRiichiCount, acc.riichiCount),
    chaseRiichiRate: pct(acc.chaseRiichiCount, acc.riichiCount),
    chasedRiichiRate: pct(acc.chasedRiichiCount, acc.firstRiichiCount),
    riichiIncome: acc.riichiWinCount > 0 ? Math.round(acc.riichiIncomeSum / acc.riichiWinCount) : null,
    riichiExpense: acc.riichiDealInCount > 0 ? Math.round(acc.riichiExpenseSum / acc.riichiDealInCount) : null,
    riichiSuji: acc.riichiCount > 0 ? Math.round(acc.riichiNetSum / acc.riichiCount) : null,
    oyaKaburiRate: pct(acc.oyaKaburiCount, acc.oyaRounds),
    oyaKaburiAvg: acc.oyaKaburiCount > 0 ? Math.round(acc.oyaKaburiLossSum / acc.oyaKaburiCount) : null,
    dealInVsRiichiRate: pct(acc.dealInVsRiichiCount, acc.dealInCount),
  };
}

/**
 * 전체 리그 팀 순위 + 개인 순위 + 국별 세부 스탯 일괄 계산
 */
export function computeLeagueStandings(
  results: Record<string, StoredTableResult>,
  rawConfig?: Partial<EventScoringConfig>
): LeagueStandingsSummary {
  const config = normalizeConfig(rawConfig);
  const calculatedMatches: Record<string, TableCalculationResult> = {};
  const roundCompletedCounts = [0, 0, 0, 0, 0, 0];

  const detailedAccMap: Record<number, DetailedAccumulator> = {};
  const playerPerfMap: Record<number, PlayerRoundPerformance[]> = {};
  const playerTotals: Record<
    number,
    {
      games: number;
      points: number;
      rankSum: number;
      rankCounts: [number, number, number, number];
      rawScores: number[];
      penaltySum: number;
    }
  > = {};

  for (const p of EVENT_PLAYERS) {
    detailedAccMap[p.id] = createAccumulator();
    playerPerfMap[p.id] = [];
    playerTotals[p.id] = {
      games: 0,
      points: 0,
      rankSum: 0,
      rankCounts: [0, 0, 0, 0],
      rawScores: [],
      penaltySum: 0,
    };
  }

  let completedGames = 0;
  let trackedGames = 0;
  let manualGames = 0;

  const teamRoundPts: Record<TeamId, number[]> = {
    A: [0, 0, 0, 0, 0, 0],
    B: [0, 0, 0, 0, 0, 0],
    C: [0, 0, 0, 0, 0, 0],
    D: [0, 0, 0, 0, 0, 0],
  };

  for (const slot of EVENT_MATCH_SCHEDULE) {
    const stored = results[slot.key];
    if (stored && Array.isArray(stored.entries) && stored.entries.length === 4) {
      const calc = calculateTableScoring(stored.entries, config);
      calculatedMatches[slot.key] = calc;
      completedGames += 1;
      roundCompletedCounts[slot.round - 1] += 1;

      const hasRounds = Boolean(
        stored.source === 'scorer' &&
        stored.rounds &&
        Array.isArray(stored.rounds.time) &&
        stored.rounds.time.length >= 2
      );
      if (hasRounds && stored.rounds) {
        trackedGames += 1;
        accumulateGameRounds(detailedAccMap, stored.rounds, calc);
      } else {
        manualGames += 1;
      }

      for (const entry of calc.entries) {
        const pt = playerTotals[entry.playerId];
        if (!pt) continue;
        pt.games += 1;
        pt.points = round1(pt.points + entry.finalPoint);
        pt.rankSum += entry.effectiveRank;
        const rIdx = Math.min(4, Math.max(1, Math.round(entry.rank))) - 1;
        pt.rankCounts[rIdx] += 1;
        pt.rawScores.push(entry.rawScore);
        pt.penaltySum = round1(pt.penaltySum + entry.penalty);

        teamRoundPts[entry.teamId][slot.round - 1] = round1(
          teamRoundPts[entry.teamId][slot.round - 1] + entry.finalPoint
        );

        playerPerfMap[entry.playerId].push({
          round: slot.round,
          table: slot.table,
          key: slot.key,
          played: true,
          source: stored.source,
          rank: entry.rank,
          rawScore: entry.rawScore,
          penalty: entry.penalty,
          finalPoint: entry.finalPoint,
          hasRounds,
        });
      }
    } else {
      for (const pid of slot.playerIds) {
        playerPerfMap[pid].push({
          round: slot.round,
          table: slot.table,
          key: slot.key,
          played: false,
        });
      }
    }
  }

  // Build individual standings
  const players: PlayerStanding[] = EVENT_PLAYERS.map((player) => {
    const pt = playerTotals[player.id];
    const detailed = finalizeDetailedStats(detailedAccMap[player.id]);
    const g = pt.games;
    const avgRank = g > 0 ? Number((pt.rankSum / g).toFixed(3)) : 0;
    const avgPoint = g > 0 ? round1(pt.points / g) : 0;
    const bestScore = pt.rawScores.length > 0 ? Math.max(...pt.rawScores) : null;
    const worstScore = pt.rawScores.length > 0 ? Math.min(...pt.rawScores) : null;
    const avgRawScore =
      pt.rawScores.length > 0
        ? Math.round(pt.rawScores.reduce((a, b) => a + b, 0) / pt.rawScores.length)
        : null;
    const topRate = g > 0 ? Number(((pt.rankCounts[0] / g) * 100).toFixed(1)) : 0;
    const top2Rate = g > 0 ? Number((((pt.rankCounts[0] + pt.rankCounts[1]) / g) * 100).toFixed(1)) : 0;
    const lastAvoidRate = g > 0 ? Number((((g - pt.rankCounts[3]) / g) * 100).toFixed(1)) : 0;

    return {
      player,
      rank: 1,
      gamesPlayed: g,
      trackedGames: detailed.trackedGames,
      totalPoints: pt.points,
      avgPoint,
      avgRank,
      rankCounts: pt.rankCounts,
      topRate,
      top2Rate,
      lastAvoidRate,
      bestScore,
      worstScore,
      avgRawScore,
      totalPenalty: pt.penaltySum,
      rounds: playerPerfMap[player.id].sort((a, b) => a.round - b.round),
      detailed,
    };
  });

  players.sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    if (b.gamesPlayed !== a.gamesPlayed) return b.gamesPlayed - a.gamesPlayed;
    if (a.avgRank !== b.avgRank) return a.avgRank - b.avgRank;
    return a.player.id - b.player.id;
  });

  players.forEach((p, idx) => {
    if (idx > 0 && p.totalPoints === players[idx - 1].totalPoints && p.gamesPlayed === players[idx - 1].gamesPlayed) {
      p.rank = players[idx - 1].rank;
    } else {
      p.rank = idx + 1;
    }
  });

  // Build team standings
  const teams: TeamStanding[] = EVENT_TEAMS.map((team) => {
    const members = players.filter((p) => p.player.teamId === team.id);
    const gamesPlayed = members.reduce((sum, m) => sum + m.gamesPlayed, 0);
    const teamTracked = members.reduce((sum, m) => sum + m.trackedGames, 0);
    const totalPoints = round1(members.reduce((sum, m) => sum + m.totalPoints, 0));
    const proPoints = round1(members.filter((m) => m.player.isPro).reduce((sum, m) => sum + m.totalPoints, 0));
    const playerPoints = round1(members.filter((m) => !m.player.isPro).reduce((sum, m) => sum + m.totalPoints, 0));
    const rankCounts: [number, number, number, number] = [0, 0, 0, 0];
    let weightedRankSum = 0;
    for (const m of members) {
      for (let i = 0; i < 4; i++) rankCounts[i] += m.rankCounts[i];
      weightedRankSum += m.avgRank * m.gamesPlayed;
    }
    const avgRank = gamesPlayed > 0 ? Number((weightedRankSum / gamesPlayed).toFixed(3)) : 0;

    const rPts = teamRoundPts[team.id];
    const cumulative: number[] = [0];
    let acc = 0;
    for (let r = 0; r < 6; r++) {
      acc = round1(acc + rPts[r]);
      cumulative.push(acc);
    }

    return {
      team,
      rank: 1,
      gamesPlayed,
      trackedGames: teamTracked,
      totalPoints,
      gapToFirst: 0,
      avgRank,
      rankCounts,
      roundPoints: rPts,
      cumulativePoints: cumulative,
      proPoints,
      playerPoints,
      members,
    };
  });

  teams.sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    if (a.avgRank !== b.avgRank) return a.avgRank - b.avgRank;
    return a.team.id.localeCompare(b.team.id);
  });

  const leaderPts = teams[0]?.totalPoints ?? 0;
  teams.forEach((t, idx) => {
    if (idx > 0 && t.totalPoints === teams[idx - 1].totalPoints) {
      t.rank = teams[idx - 1].rank;
    } else {
      t.rank = idx + 1;
    }
    t.gapToFirst = round1(t.totalPoints - leaderPts);
  });

  return {
    completedGames,
    trackedGames,
    manualGames,
    totalGames: EVENT_MATCH_SCHEDULE.length,
    roundCompletedCounts,
    teams,
    players,
    calculatedMatches,
  };
}

/**
 * UTF-8 BOM 포함 CSV 내보내기 (Excel 영/일/한 완벽 호환)
 */
export function buildEventCsv(
  results: Record<string, StoredTableResult>,
  standings: LeagueStandingsSummary
): string {
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines: string[] = [];

  lines.push('=== TEAM STANDINGS ===');
  lines.push(['Rank', 'Team', 'Total Pt', 'Gap', 'Games', 'Tracked Games', 'Avg Rank', '1st', '2nd', '3rd', '4th', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6'].join(','));
  for (const t of standings.teams) {
    lines.push(
      [
        t.rank,
        t.team.name,
        t.totalPoints.toFixed(1),
        t.gapToFirst.toFixed(1),
        t.gamesPlayed,
        t.trackedGames,
        t.gamesPlayed > 0 ? t.avgRank.toFixed(3) : '-',
        ...t.rankCounts,
        ...t.roundPoints.map((x) => x.toFixed(1)),
      ]
        .map(esc)
        .join(',')
    );
  }

  lines.push('');
  lines.push('=== INDIVIDUAL STANDINGS ===');
  lines.push(
    [
      'Rank', 'ID', 'Player', 'Team', 'Role', 'Total Pt', 'Games', 'Tracked Games',
      'Avg Rank', '1st', '2nd', '3rd', '4th', 'Best Score', 'Win%', 'Deal-in%', 'Riichi%',
      'R1', 'R2', 'R3', 'R4', 'R5', 'R6',
    ].join(',')
  );
  for (const p of standings.players) {
    lines.push(
      [
        p.rank,
        p.player.id,
        p.player.name,
        `Team ${p.player.teamId}`,
        p.player.isPro ? 'PRO' : 'Player',
        p.totalPoints.toFixed(1),
        p.gamesPlayed,
        p.trackedGames,
        p.gamesPlayed > 0 ? p.avgRank.toFixed(3) : '-',
        ...p.rankCounts,
        p.bestScore ?? '-',
        p.detailed.winRate !== null ? `${p.detailed.winRate}%` : '-',
        p.detailed.dealInRate !== null ? `${p.detailed.dealInRate}%` : '-',
        p.detailed.riichiRate !== null ? `${p.detailed.riichiRate}%` : '-',
        ...p.rounds.map((r) => (r.played && r.finalPoint !== undefined ? formatSignedPoint(r.finalPoint) : '-')),
      ]
        .map(esc)
        .join(',')
    );
  }

  lines.push('');
  lines.push('=== MATCH RESULTS (42 GAMES) ===');
  lines.push(['Match', 'Round', 'Table', 'Source', 'Seat', 'ID', 'Player', 'Team', 'Raw Score', 'Penalty', 'Rank', 'Final Pt', 'Submitted At'].join(','));
  const winds = ['East', 'South', 'West', 'North'];
  for (const slot of EVENT_MATCH_SCHEDULE) {
    const stored = results[slot.key];
    const calc = standings.calculatedMatches[slot.key];
    if (!stored || !calc) continue;
    for (const e of calc.entries) {
      const pl = EVENT_PLAYER_MAP[e.playerId];
      lines.push(
        [
          slot.key,
          slot.round,
          slot.table,
          stored.source,
          winds[e.seatIndex] || e.seatIndex,
          e.playerId,
          pl?.name || `#${e.playerId}`,
          `Team ${e.teamId}`,
          e.rawScore,
          e.penalty,
          e.rank,
          e.finalPoint.toFixed(1),
          new Date(stored.submittedAt).toISOString(),
        ]
          .map(esc)
          .join(',')
      );
    }
  }

  return '\uFEFF' + lines.join('\r\n');
}

/**
 * 테스트 샌드박스용 샘플 데이터 생성기
 * - Tables 1,2,3,5,6,7: 현실적인 국별 로그(rounds)가 포함된 'scorer' 결과 생성
 * - Table 4 (JP-C): 최종 결과만 기록된 'manual' (rounds: null) 결과 생성 → 괄호 표기 테스트 가능!
 */
export function generateSampleEventResults(
  roundCount: number,
  config: EventScoringConfig = DEFAULT_EVENT_CONFIG
): Record<string, StoredTableResult> {
  const out: Record<string, StoredTableResult> = {};
  const maxRound = Math.min(6, Math.max(1, roundCount));
  let seed = 20261128;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let r = 1; r <= maxRound; r++) {
    for (let t = 1; t <= 7; t++) {
      const key = getMatchKey(r, t);
      const slot = EVENT_MATCH_SCHEDULE.find((m) => m.key === key);
      if (!slot) continue;
      const pids = [...slot.playerIds] as [number, number, number, number];
      const isManual = slot.isJpC; // Table 4 JP-C -> result-only

      if (isManual) {
        // Generate 4 realistic scores summing to startingScore * 4
        const total = config.startingScore * 4;
        const s0 = 15000 + Math.floor(rand() * 300) * 100;
        const s1 = 15000 + Math.floor(rand() * 220) * 100;
        const s2 = 12000 + Math.floor(rand() * 180) * 100;
        const s3 = total - (s0 + s1 + s2);
        const rawScores = [s0, s1, s2, s3];
        out[key] = {
          key,
          round: r,
          table: t,
          source: 'manual',
          entries: pids.map((pid, idx) => ({
            playerId: pid,
            rawScore: rawScores[idx],
            penalty: 0,
            seatIndex: idx,
          })),
          rounds: null,
          submittedAt: Date.now() - (maxRound - r) * 3600_000 - (7 - t) * 60_000,
          submittedBy: 'Sandbox (JP-C)',
        };
      } else {
        // Simulate 8 rounds (E1..E4, S1..S4) with realistic win/lose/riichi/draw logs
        const curScores = [config.startingScore, config.startingScore, config.startingScore, config.startingScore];
        const time: string[] = ['ㅤ'];
        const score: number[][] = [
          [curScores[0]],
          [curScores[1]],
          [curScores[2]],
          [curScores[3]],
        ];
        const riichi: boolean[][] = [[false, false, false, false]];
        const win: boolean[][] = [[false, false, false, false]];
        const lose: boolean[][] = [[false, false, false, false]];
        const tenpai: boolean[][] = [[false, false, false, false]];
        const cheat: boolean[][] = [[false, false, false, false]];
        const beolbu: number[][] = [[0, 0, 0, 0]];
        const status: string[] = ['initial'];
        const riichiOrder: number[][] = [[]];
        const dealer: number[] = [0];

        const roundLabels = ['東 1局', '東 2局', '東 3局', '東 4局', '南 1局', '南 2局', '南 3局', '南 4局'];
        for (let h = 0; h < 8; h++) {
          const dIdx = h % 4;
          const rRow = [false, false, false, false];
          const wRow = [false, false, false, false];
          const lRow = [false, false, false, false];
          const tRow = [false, false, false, false];
          const cRow = [false, false, false, false];
          const bRow = [0, 0, 0, 0];
          const rOrd: number[] = [];
          const deltas = [0, 0, 0, 0];

          for (let s = 0; s < 4; s++) {
            if (rand() < 0.22) {
              rRow[s] = true;
              rOrd.push(s);
            }
          }

          const roll = rand();
          let st = 'ron';
          if (roll < 0.18) {
            // Normal draw
            st = 'normal_draw';
            let tenpaiCnt = 0;
            for (let s = 0; s < 4; s++) {
              if (rRow[s] || rand() < 0.4) {
                tRow[s] = true;
                tenpaiCnt++;
              }
            }
            if (tenpaiCnt > 0 && tenpaiCnt < 4) {
              const gain = 3000 / tenpaiCnt;
              const loss = 3000 / (4 - tenpaiCnt);
              for (let s = 0; s < 4; s++) {
                deltas[s] += tRow[s] ? gain : -loss;
              }
            }
          } else if (roll < 0.50) {
            // Tsumo
            st = 'tsumo';
            const winner = Math.floor(rand() * 4);
            wRow[winner] = true;
            const unit = (1 + Math.floor(rand() * 3)) * 1000; // 1000..3000
            for (let s = 0; s < 4; s++) {
              if (s === winner) continue;
              const pay = winner === dIdx || s === dIdx ? unit * 2 : unit;
              deltas[s] -= pay;
              deltas[winner] += pay;
            }
            for (const rs of rOrd) {
              if (rs !== winner) {
                deltas[rs] -= 1000;
                deltas[winner] += 1000;
              }
            }
          } else {
            // Ron
            st = 'ron';
            const winner = Math.floor(rand() * 4);
            const loser = (winner + 1 + Math.floor(rand() * 3)) % 4;
            wRow[winner] = true;
            lRow[loser] = true;
            const pts = [2000, 3900, 5200, 7700, 8000, 12000][Math.floor(rand() * 6)];
            deltas[winner] += pts;
            deltas[loser] -= pts;
            for (const rs of rOrd) {
              if (rs !== winner) {
                deltas[rs] -= 1000;
                deltas[winner] += 1000;
              }
            }
          }

          for (let s = 0; s < 4; s++) curScores[s] += deltas[s];

          // Push odd (delta) + even (snapshot)
          time.push(roundLabels[h], 'ㅤ');
          for (let s = 0; s < 4; s++) {
            score[s].push(deltas[s], curScores[s]);
          }
          riichi.push(rRow, [false, false, false, false]);
          win.push(wRow, [false, false, false, false]);
          lose.push(lRow, [false, false, false, false]);
          tenpai.push(tRow, [false, false, false, false]);
          cheat.push(cRow, [false, false, false, false]);
          beolbu.push(bRow, [0, 0, 0, 0]);
          status.push(st, 'snapshot');
          riichiOrder.push(rOrd, []);
          dealer.push(dIdx, dIdx);
        }

        out[key] = {
          key,
          round: r,
          table: t,
          source: 'scorer',
          entries: pids.map((pid, idx) => ({
            playerId: pid,
            rawScore: curScores[idx],
            penalty: 0,
            seatIndex: idx,
          })),
          rounds: {
            seatPlayerIds: pids,
            time,
            score,
            riichi,
            win,
            lose,
            tenpai,
            cheat,
            beolbu,
            status,
            riichiOrder,
            dealer,
          },
          submittedAt: Date.now() - (maxRound - r) * 3600_000 - (7 - t) * 60_000,
          submittedBy: 'Sandbox (Scorer)',
        };
      }
    }
  }

  return out;
}
