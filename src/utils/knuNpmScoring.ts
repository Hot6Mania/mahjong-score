import {
  DEFAULT_EVENT_CONFIG,
  DEFAULT_ROUND_TIMER,
  EVENT_MATCH_SCHEDULE,
  EVENT_PLAYERS,
  EVENT_PLAYER_MAP,
  EVENT_TEAMS,
  formatEventPlayerName,
  getMatchKey,
  type EventNameLocale,
  type EventPlayer,
  type EventRoundTimer,
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
  riichiSticks?: number; // leftover riichi sticks at game end (each 1,000 pts)
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

export interface LiveTableState {
  key: string; // "R1-T1"
  round: number;
  table: number;
  seatPlayerIds: [number, number, number, number];
  scores: [number, number, number, number];
  winds: [string, string, string, string];
  riichiActive: [boolean, boolean, boolean, boolean];
  chomboCounts: [number, number, number, number];
  wind: string; // '東' | '南'
  roundNum: number; // 1..4
  renchan: number;
  riichiSticks: number;
  isFinished: boolean;
  records: CompactRoundRecords | null;
  updatedAt: number;
}

export interface LiveStatePayload {
  updatedAt: number;
  liveGames: Record<string, LiveTableState>;
  serverTime?: number;
}

export interface CalculatedPlayerEntry {
  playerId: number;
  teamId: TeamId;
  seatIndex: number;
  rawScore: number; // pre-kyotaku score (used to determine rank & ties)
  riichiBonus: number; // leftover riichi stick points awarded (e.g. 800 / 600 / 600)
  finalScore: number; // rawScore + riichiBonus
  penalty: number;
  rank: number; // display rank (1..4, tied players share top rank in split mode)
  effectiveRank: number; // e.g. 1.5 for 2-way tie at 1st
  basePoint: number;
  umaAndOka: number;
  finalPoint: number;
}

export interface TableCalculationResult {
  entries: CalculatedPlayerEntry[];
  scoreSum: number; // sum of rawScores (before kyotaku)
  riichiSticks: number;
  riichiTotal: number; // riichiSticks * 1000
  expectedSum: number;
  scoreDiff: number; // (scoreSum + riichiTotal) - expectedSum
  oka: number;
}

export interface DetailedRoundStats {
  trackedGames: number;
  trackedRounds: number;
  trackedTotalPoints: number;
  trackedAvgPoint: number;
  trackedAvgRank: number;
  trackedTop2Rate: number;
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
  chaseRiichiWinCount: number;
  chasedRiichiCount: number;
  drawCount: number;
  drawTenpaiCount: number;
  oyaKaburiCount: number;
  dealInWhileRiichiCount: number;
  yakitoriCount: number;
  tobiCount: number;
  cheatCount: number;
  beolbuCount: number;
  winRate: number | null; // %
  dealInRate: number | null; // %
  tsumoRate: number | null; // % of wins
  drawRate: number | null; // %
  drawTenpaiRate: number | null; // % of draws
  tobiRate: number | null; // % of games
  yakitoriRate: number | null; // % of tracked games
  avgWinScore: number | null;
  avgDealInScore: number | null;
  winEfficiency: number | null;
  dealInLoss: number | null;
  netWinEfficiency: number | null;
  roundSuji: number | null;
  riichiRate: number | null; // %
  riichiWinRate: number | null; // %
  riichiDealInRate: number | null; // %
  riichiDrawRate: number | null; // %
  firstRiichiRate: number | null; // % of riichis
  chaseRiichiRate: number | null; // % of riichis
  chaseRiichiWinRate: number | null; // % of chase riichis
  chasedRiichiRate: number | null; // % of first riichis
  riichiIncome: number | null;
  riichiExpense: number | null;
  riichiSuji: number | null;
  oyaKaburiRate: number | null; // %
  oyaKaburiAvg: number | null;
  dealInRiichiRate: number | null; // % of deal-ins while in riichi
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
  tobiRate: number; // % overall (<0 rawScore)
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

export interface EventHistogramBar {
  playerId: number;
  playerName: string;
  teamId: TeamId;
  value: number;
  x: number;
  y: number;
  width: number;
  height: number;
  isCurrent: boolean;
}

export interface EventMetricDistribution {
  metricName: string;
  unit: string;
  currentValue: number | null;
  min: number;
  max: number;
  avg: number;
  rank: number;
  totalCount: number;
  topPct: number;
  bottomPct: number;
  isUpperHalf: boolean;
  isUnrecorded: boolean;
  line30X: number;
  line70X: number;
  bars: EventHistogramBar[];
}

export function round1(val: number): number {
  return Math.round((val + Number.EPSILON) * 10) / 10;
}

export function normalizeRoundTimer(raw?: Partial<EventRoundTimer> | null): EventRoundTimer {
  const t = raw || {};
  const round = Math.min(6, Math.max(1, Math.floor(Number(t.round) || DEFAULT_ROUND_TIMER.round)));
  const durationMinutes = Math.min(
    180,
    Math.max(1, Math.floor(Number(t.durationMinutes) || DEFAULT_ROUND_TIMER.durationMinutes))
  );
  const extraHands: 0 | 1 = Number(t.extraHands) === 1 ? 1 : 0;
  const status: EventRoundTimer['status'] =
    t.status === 'running' || t.status === 'paused' ? t.status : 'idle';
  const endsAt = status === 'running' && Number.isFinite(Number(t.endsAt)) ? Number(t.endsAt) : null;
  const pausedRemainingMs =
    status === 'paused' && Number.isFinite(Number(t.pausedRemainingMs))
      ? Math.max(0, Number(t.pausedRemainingMs))
      : null;
  const updatedAt = Number.isFinite(Number(t.updatedAt)) ? Number(t.updatedAt) : 0;
  return { round, durationMinutes, extraHands, status, endsAt, pausedRemainingMs, updatedAt };
}

export function formatCountdownMs(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export interface RoundTimerDisplayState {
  round: number;
  status: EventRoundTimer['status'];
  extraHands: 0 | 1;
  ruleTag: string; // e.g. "50+0" or "50+1"
  remainingMs: number;
  formatted: string; // "MM:SS"
  isExpired: boolean;
  severity: 'idle' | 'normal' | 'warn' | 'critical' | 'expired';
}

export function computeRoundTimerDisplay(
  timer: EventRoundTimer | null | undefined,
  nowMs: number
): RoundTimerDisplayState {
  const t = normalizeRoundTimer(timer);
  const ruleTag = `${t.durationMinutes}+${t.extraHands}`;
  let remainingMs = t.durationMinutes * 60_000;
  let isExpired = false;

  if (t.status === 'running' && t.endsAt !== null) {
    remainingMs = Math.max(0, t.endsAt - nowMs);
    isExpired = nowMs >= t.endsAt;
  } else if (t.status === 'paused') {
    remainingMs = Math.max(0, t.pausedRemainingMs ?? 0);
    isExpired = remainingMs <= 0;
  }

  let severity: RoundTimerDisplayState['severity'] = 'idle';
  if (t.status !== 'idle') {
    if (isExpired) severity = 'expired';
    else if (remainingMs <= 5 * 60_000) severity = 'critical';
    else if (remainingMs <= 10 * 60_000) severity = 'warn';
    else severity = 'normal';
  }

  return {
    round: t.round,
    status: t.status,
    extraHands: t.extraHands,
    ruleTag,
    remainingMs,
    formatted: formatCountdownMs(remainingMs),
    isExpired,
    severity,
  };
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
    nameParenthesesLocales: Array.isArray(c.nameParenthesesLocales)
      ? Array.from(
          new Set(
            c.nameParenthesesLocales.filter(
              (l): l is EventNameLocale => l === 'en' || l === 'ja' || l === 'ko'
            )
          )
        )
      : [...DEFAULT_EVENT_CONFIG.nameParenthesesLocales],
    lockedRounds: Array.isArray(c.lockedRounds) ? c.lockedRounds.map(Number).filter((n) => n >= 1 && n <= 6) : [],
    lockedTables: Array.isArray(c.lockedTables) ? c.lockedTables.map(String) : [],
    roundTimer: normalizeRoundTimer(c.roundTimer),
  };
}

/**
 * M리그 공식 규정 기반 잔여 공탁봉(리치봉) 동점 1위 분배 (기가 우선 순서로 배열 반환)
 * - 1명: 전액 (R × 1,000)
 * - 2명: 균등 (R × 500씩)
 * - 3명: 1,000점을 400 / 300 / 300으로 나누고 나누어떨어지지 않으면 등배 (예: 2,000점 → 800 / 600 / 600, 기가 우선)
 * - 4명: 100점 단위 균등 분배 후 잔여 100점씩 기가 우선
 */
export function distributeLeftoverRiichi(riichiSticks: number, tiedCount: number): number[] {
  const sticks = Math.max(0, Math.floor(Number(riichiSticks) || 0));
  if (sticks === 0 || tiedCount <= 0) {
    return Array(Math.max(0, tiedCount)).fill(0);
  }
  if (tiedCount === 1) return [sticks * 1000];
  if (tiedCount === 2) return [sticks * 500, sticks * 500];
  if (tiedCount === 3) {
    const fullSets = Math.floor(sticks / 3);
    const remSticks = sticks % 3;
    const base = fullSets * 1000;
    return [
      base + remSticks * 400,
      base + remSticks * 300,
      base + remSticks * 300,
    ];
  }
  const totalHundreds = sticks * 10;
  const baseH = Math.floor(totalHundreds / tiedCount);
  const remH = totalHundreds - baseH * tiedCount;
  return Array.from({ length: tiedCount }, (_, i) => (baseH + (i < remH ? 1 : 0)) * 100);
}

/**
 * M리그 공식 규정 기반 동점 순위점(우마+오카) 0.1pt 단위 정확 분할 (기가 우선 끝수 집중)
 * - 예: +50.0 / 3 → [+16.8, +16.6, +16.6] (합계 +50.0, 제로섬 유지)
 * - 예: -30.0 / 3 → [-10.0, -10.0, -10.0] (합계 -30.0)
 */
export function splitPointTenths(totalPoints: number, tiedCount: number): number[] {
  if (tiedCount <= 0) return [];
  if (tiedCount === 1) return [round1(totalPoints)];
  const totalTenths = Math.round(totalPoints * 10);
  const floorUnit = Math.floor(totalTenths / tiedCount);
  const rem = totalTenths - floorUnit * tiedCount;
  return Array.from({ length: tiedCount }, (_, i) => (floorUnit + (i === 0 ? rem : 0)) / 10);
}

/**
 * 4인 최종 소점(공탁 배분 전) + 잔여 공탁봉 + 패널티 → M리그/설정 규칙 기준 순위·공탁·오카·우마·최종 포인트 계산
 * - 반드시 공탁 배분 전 rawScore로 순위와 동점 그룹을 확정한 뒤 공탁금과 순위점을 배분함
 */
export function calculateTableScoring(
  entries: TableScoreEntryInput[],
  rawConfig?: Partial<EventScoringConfig>,
  rawRiichiSticks = 0
): TableCalculationResult {
  const config = normalizeConfig(rawConfig);
  const expectedSum = config.startingScore * 4;
  const oka = ((config.returnScore - config.startingScore) * 4) / 1000;
  const riichiSticks = Math.max(0, Math.floor(Number(rawRiichiSticks) || 0));
  const riichiTotal = riichiSticks * 1000;

  const indexed = entries.map((e, idx) => ({
    origIdx: idx,
    playerId: Number(e.playerId),
    rawScore: Number(e.rawScore) || 0,
    penalty: Number(e.penalty) || 0,
    seatIndex: e.seatIndex !== undefined && e.seatIndex !== null ? Number(e.seatIndex) : idx,
  }));

  const scoreSum = indexed.reduce((acc, e) => acc + e.rawScore, 0);
  const scoreDiff = scoreSum + riichiTotal - expectedSum;

  // Step 1: 공탁 배분 전 rawScore 기준으로 순위 확정
  const ranks = indexed.map((item) => {
    const higherCount = indexed.filter((other) => {
      if (other.rawScore > item.rawScore) return true;
      if (config.tieBreak === 'seat' && other.rawScore === item.rawScore && other.seatIndex < item.seatIndex) {
        return true;
      }
      return false;
    }).length;
    return higherCount + 1;
  });

  // Step 2: 동점 그룹별(seatIndex 오름차순 = 기가 우선) 순위점 & 잔여 공탁금 배분
  const groupMap = new Map<number, number[]>();
  indexed.forEach((_, idx) => {
    const r = ranks[idx];
    const list = groupMap.get(r) || [];
    list.push(idx);
    groupMap.set(r, list);
  });

  const umaAndOkaArr = new Array<number>(indexed.length).fill(0);
  const effectiveRankArr = new Array<number>(indexed.length).fill(1);
  const riichiBonusArr = new Array<number>(indexed.length).fill(0);

  for (const [rank, memberIndices] of groupMap.entries()) {
    // 기가(東=0) 우선 정렬
    const ordered = [...memberIndices].sort(
      (a, b) => indexed[a].seatIndex - indexed[b].seatIndex || a - b
    );
    const tiedCount = ordered.length;

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

    const umaShares = splitPointTenths(umaSum, tiedCount);
    const effRank = rankSum / tiedCount;
    const riichiShares =
      rank === 1 && config.riichiPayout && riichiSticks > 0
        ? distributeLeftoverRiichi(riichiSticks, tiedCount)
        : Array(tiedCount).fill(0);

    ordered.forEach((memberIdx, pos) => {
      umaAndOkaArr[memberIdx] = umaShares[pos];
      effectiveRankArr[memberIdx] = effRank;
      riichiBonusArr[memberIdx] = riichiShares[pos];
    });
  }

  const calculated: CalculatedPlayerEntry[] = indexed.map((item, idx) => {
    const player = EVENT_PLAYER_MAP[item.playerId];
    const teamId: TeamId = player ? player.teamId : 'A';
    const riichiBonus = riichiBonusArr[idx];
    const finalScore = item.rawScore + riichiBonus;
    const umaAndOka = umaAndOkaArr[idx];
    const basePoint = (finalScore - config.returnScore) / 1000;
    const finalPoint = round1(basePoint + umaAndOka + item.penalty);

    return {
      playerId: item.playerId,
      teamId,
      seatIndex: item.seatIndex,
      rawScore: item.rawScore,
      riichiBonus,
      finalScore,
      penalty: item.penalty,
      rank: ranks[idx],
      effectiveRank: effectiveRankArr[idx],
      basePoint: round1(basePoint),
      umaAndOka: round1(umaAndOka),
      finalPoint,
    };
  });

  return {
    entries: calculated,
    scoreSum,
    riichiSticks,
    riichiTotal,
    expectedSum,
    scoreDiff,
    oka: round1(oka),
  };
}

/**
 * 김케이 하우스 대시보드와 동일한 괄호 듀얼 표기 헬퍼
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
    trackedAvgPoint: 0,
    trackedAvgRank: 0,
    trackedTop2Rate: 0,
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
    chaseRiichiWinCount: 0,
    chasedRiichiCount: 0,
    drawCount: 0,
    drawTenpaiCount: 0,
    oyaKaburiCount: 0,
    dealInWhileRiichiCount: 0,
    yakitoriCount: 0,
    tobiCount: 0,
    cheatCount: 0,
    beolbuCount: 0,
    winRate: null,
    dealInRate: null,
    tsumoRate: null,
    drawRate: null,
    drawTenpaiRate: null,
    tobiRate: null,
    yakitoriRate: null,
    avgWinScore: null,
    avgDealInScore: null,
    winEfficiency: null,
    dealInLoss: null,
    netWinEfficiency: null,
    roundSuji: null,
    riichiRate: null,
    riichiWinRate: null,
    riichiDealInRate: null,
    riichiDrawRate: null,
    firstRiichiRate: null,
    chaseRiichiRate: null,
    chaseRiichiWinRate: null,
    chasedRiichiRate: null,
    riichiIncome: null,
    riichiExpense: null,
    riichiSuji: null,
    oyaKaburiRate: null,
    oyaKaburiAvg: null,
    dealInRiichiRate: null,
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
  chaseRiichiWinCount: number;
  chasedRiichiCount: number;
  riichiIncomeSum: number;
  riichiExpenseSum: number;
  riichiNetSum: number;
  drawCount: number;
  drawTenpaiCount: number;
  oyaRounds: number;
  oyaKaburiCount: number;
  oyaKaburiLossSum: number;
  dealInWhileRiichiCount: number;
  yakitoriCount: number;
  tobiCount: number;
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
    chaseRiichiWinCount: 0,
    chasedRiichiCount: 0,
    riichiIncomeSum: 0,
    riichiExpenseSum: 0,
    riichiNetSum: 0,
    drawCount: 0,
    drawTenpaiCount: 0,
    oyaRounds: 0,
    oyaKaburiCount: 0,
    oyaKaburiLossSum: 0,
    dealInWhileRiichiCount: 0,
    yakitoriCount: 0,
    tobiCount: 0,
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
      if (entry.rawScore < 0) {
        acc.tobiCount += 1;
      }
    }
  }

  // App.vue pushes 2 items per round into `time` and `score[seat]`,
  // and 1 item per round into `riichi`, `win`, `lose`, `tenpai`, `cheat`, `beolbu`, `status`, `riichiOrder`, `dealer`.
  // Detect whether event arrays are 1-per-round (App.vue standard) or 2-per-round (legacy).
  const roundStepCount = Math.floor((times.length - 1) / 2);
  const isDoubleEventArrays =
    Array.isArray(rounds.riichi) && rounds.riichi.length >= times.length && times.length > 3;

  const wonInThisGame = [false, false, false, false];

  for (let step = 0; step < roundStepCount; step++) {
    const deltaIdx = step * 2 + 1;
    const evIdx = isDoubleEventArrays ? deltaIdx : step + 1;
    const label = String(times[deltaIdx] || '');
    const status = String(rounds.status?.[evIdx] || '');
    if (status === 'end' || status === 'initial' || label === '결과' || label === 'Result') {
      continue;
    }

    const riichiRow = rounds.riichi?.[evIdx] || [false, false, false, false];
    const winRow = rounds.win?.[evIdx] || [false, false, false, false];
    const loseRow = rounds.lose?.[evIdx] || [false, false, false, false];
    const tenpaiRow = rounds.tenpai?.[evIdx] || [false, false, false, false];
    const cheatRow = rounds.cheat?.[evIdx] || [false, false, false, false];
    const beolbuRow = rounds.beolbu?.[evIdx] || [0, 0, 0, 0];
    const riichiOrderRow = rounds.riichiOrder?.[evIdx] || [];
    const dealerIdx = rounds.dealer?.[evIdx] ?? -1;

    // Chombo void hand: track cheatCount, do not distort normal round stats
    if (status === 'cheat') {
      for (let seat = 0; seat < 4; seat++) {
        const pid = rounds.seatPlayerIds[seat];
        const acc = accMap[pid];
        if (acc && cheatRow[seat]) acc.cheatCount += 1;
      }
      continue;
    }

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
        wonInThisGame[seat] = true;
        acc.winCount += 1;
        if (isTsumoRound) acc.tsumoCount += 1;
        else if (isRonRound) acc.ronCount += 1;
        if (delta > 0) {
          acc.winScoreSum += delta + (didRiichi ? 1000 : 0);
        }
      }

      if (didLose) {
        acc.dealInCount += 1;
        if (delta < 0) {
          acc.dealInScoreSum += Math.abs(delta) - (didRiichi ? 1000 : 0);
        }
        if (didRiichi) {
          acc.dealInWhileRiichiCount += 1;
        }
      }

      // 아픈 오야카부리 (친 상태에서 타가 쯔모로 4,000점 이상 실점)
      if (isTsumoRound && seat === dealerIdx && !didWin && delta < 0) {
        const netLoss = Math.abs(delta) - (didRiichi ? 1000 : 0);
        if (netLoss >= 4000) {
          acc.oyaKaburiCount += 1;
          acc.oyaKaburiLossSum += netLoss;
        }
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
          if (didWin) acc.chaseRiichiWinCount += 1;
        } else {
          const riichiTotal = riichiRow.filter(Boolean).length;
          if (riichiTotal === 1) acc.firstRiichiCount += 1;
        }
      }
    }
  }

  // 야키토리 (한 반장 동안 1회도 화료하지 못함)
  if (roundStepCount > 0) {
    for (let seat = 0; seat < 4; seat++) {
      const pid = rounds.seatPlayerIds[seat];
      const acc = accMap[pid];
      if (acc && !wonInThisGame[seat]) {
        acc.yakitoriCount += 1;
      }
    }
  }
}

function finalizeDetailedStats(acc: DetailedAccumulator): DetailedRoundStats {
  if (acc.trackedGames === 0 || acc.trackedRounds === 0) {
    return createEmptyDetailedStats();
  }
  const r = acc.trackedRounds;
  const g = acc.trackedGames;
  const pct = (num: number, den: number) => (den > 0 ? Number(((num / den) * 100).toFixed(2)) : null);

  const winRate = pct(acc.winCount, r);
  const dealInRate = pct(acc.dealInCount, r);
  const avgWinScore = acc.winCount > 0 ? Math.round(acc.winScoreSum / acc.winCount) : null;
  const avgDealInScore = acc.dealInCount > 0 ? Math.round(acc.dealInScoreSum / acc.dealInCount) : null;
  const winEfficiency =
    winRate !== null && avgWinScore !== null ? Math.round((winRate / 100) * avgWinScore) : 0;
  const dealInLoss =
    dealInRate !== null && avgDealInScore !== null ? Math.round((dealInRate / 100) * avgDealInScore) : 0;
  const netWinEfficiency = winEfficiency - dealInLoss;

  return {
    trackedGames: g,
    trackedRounds: r,
    trackedTotalPoints: round1(acc.trackedTotalPoints),
    trackedAvgPoint: round1(acc.trackedTotalPoints / g),
    trackedAvgRank: Number((acc.trackedRankSum / g).toFixed(3)),
    trackedTop2Rate: Number((((acc.trackedRankCounts[0] + acc.trackedRankCounts[1]) / g) * 100).toFixed(2)),
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
    chaseRiichiWinCount: acc.chaseRiichiWinCount,
    chasedRiichiCount: acc.chasedRiichiCount,
    drawCount: acc.drawCount,
    drawTenpaiCount: acc.drawTenpaiCount,
    oyaKaburiCount: acc.oyaKaburiCount,
    dealInWhileRiichiCount: acc.dealInWhileRiichiCount,
    yakitoriCount: acc.yakitoriCount,
    tobiCount: acc.tobiCount,
    cheatCount: acc.cheatCount,
    beolbuCount: acc.beolbuCount,
    winRate,
    dealInRate,
    tsumoRate: pct(acc.tsumoCount, acc.winCount),
    drawRate: pct(acc.drawCount, r),
    drawTenpaiRate: pct(acc.drawTenpaiCount, acc.drawCount),
    tobiRate: pct(acc.tobiCount, g),
    yakitoriRate: pct(acc.yakitoriCount, g),
    avgWinScore,
    avgDealInScore,
    winEfficiency,
    dealInLoss,
    netWinEfficiency,
    roundSuji: Math.round(acc.roundNetDeltaSum / r),
    riichiRate: pct(acc.riichiCount, r),
    riichiWinRate: pct(acc.riichiWinCount, acc.riichiCount),
    riichiDealInRate: pct(acc.riichiDealInCount, acc.riichiCount),
    riichiDrawRate: pct(acc.riichiDrawCount, acc.riichiCount),
    firstRiichiRate: pct(acc.firstRiichiCount, acc.riichiCount),
    chaseRiichiRate: pct(acc.chaseRiichiCount, acc.riichiCount),
    chaseRiichiWinRate: pct(acc.chaseRiichiWinCount, acc.chaseRiichiCount),
    chasedRiichiRate: pct(acc.chasedRiichiCount, acc.firstRiichiCount),
    riichiIncome: acc.riichiWinCount > 0 ? Math.round(acc.riichiIncomeSum / acc.riichiWinCount) : null,
    riichiExpense: acc.riichiDealInCount > 0 ? Math.round(acc.riichiExpenseSum / acc.riichiDealInCount) : null,
    riichiSuji: acc.riichiCount > 0 ? Math.round(acc.riichiNetSum / acc.riichiCount) : null,
    oyaKaburiRate: pct(acc.oyaKaburiCount, acc.oyaRounds),
    oyaKaburiAvg: acc.oyaKaburiCount > 0 ? Math.round(acc.oyaKaburiLossSum / acc.oyaKaburiCount) : null,
    dealInRiichiRate: pct(acc.dealInWhileRiichiCount, acc.dealInCount),
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
      tobiCount: number;
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
      tobiCount: 0,
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
      const calc = calculateTableScoring(stored.entries, config, stored.riichiSticks ?? 0);
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
        pt.rawScores.push(entry.finalScore);
        if (entry.rawScore < 0) pt.tobiCount += 1;
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
          rawScore: entry.finalScore,
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
    const topRate = g > 0 ? Number(((pt.rankCounts[0] / g) * 100).toFixed(2)) : 0;
    const top2Rate = g > 0 ? Number((((pt.rankCounts[0] + pt.rankCounts[1]) / g) * 100).toFixed(2)) : 0;
    const lastAvoidRate = g > 0 ? Number((((g - pt.rankCounts[3]) / g) * 100).toFixed(2)) : 0;
    const tobiRate = g > 0 ? Number(((pt.tobiCount / g) * 100).toFixed(2)) : 0;

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
      tobiRate,
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
 * 스탯 호버/탭 계단형 히스토그램 분포 계산기 (최소 대국/국수 제한 없음 — 1국 이상 전원 포함)
 */
export function calculateEventMetricDistribution(
  allPlayers: PlayerStanding[],
  extractor: (p: PlayerStanding) => number | null | undefined,
  currentPlayerId: number,
  metricName: string,
  unit: string,
  higherIsBetter: boolean,
  requireTracked = false,
  locale: EventNameLocale = 'en'
): EventMetricDistribution {
  const valid = allPlayers
    .filter((p) => (requireTracked ? p.detailed.trackedRounds > 0 : p.gamesPlayed > 0))
    .map((p) => ({
      playerId: p.player.id,
      playerName: formatEventPlayerName(p.player, locale, 'compact'),
      teamId: p.player.teamId,
      val: extractor(p),
    }))
    .filter((item): item is { playerId: number; playerName: string; teamId: TeamId; val: number } =>
      item.val !== null && item.val !== undefined && Number.isFinite(item.val)
    );

  const curItem = valid.find((v) => v.playerId === currentPlayerId);
  const currentValue = curItem ? curItem.val : null;
  const isUnrecorded = currentValue === null;

  if (valid.length === 0) {
    return {
      metricName,
      unit,
      currentValue,
      min: 0,
      max: 0,
      avg: 0,
      rank: 1,
      totalCount: 0,
      topPct: 100,
      bottomPct: 100,
      isUpperHalf: false,
      isUnrecorded: true,
      line30X: 48,
      line70X: 112,
      bars: [],
    };
  }

  // Always sort ascending by actual value so higher numeric values appear taller & further right
  const sorted = [...valid].sort((a, b) => a.val - b.val);
  const values = sorted.map((s) => s.val);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avgRaw = values.reduce((a, b) => a + b, 0) / values.length;
  const avg = unit === '%' ? Number(avgRaw.toFixed(2)) : Number(avgRaw.toFixed(1));

  let rank = 1;
  let reverseRank = 1;
  if (currentValue !== null) {
    for (const v of values) {
      if (higherIsBetter ? v > currentValue : v < currentValue) rank++;
      if (higherIsBetter ? v < currentValue : v > currentValue) reverseRank++;
    }
    rank = Math.min(rank, valid.length);
    reverseRank = Math.min(reverseRank, valid.length);
  }
  const topPct = currentValue !== null ? Math.min(100, Number(((rank / valid.length) * 100).toFixed(2))) : 100;
  const bottomPct =
    currentValue !== null ? Math.min(100, Number(((reverseRank / valid.length) * 100).toFixed(2))) : 100;
  const isUpperHalf = currentValue !== null && rank <= Math.ceil(valid.length / 2);

  const svgW = 160;
  const svgH = 44;
  const padX = 2;
  const usableW = svgW - padX * 2;
  const count = sorted.length;
  const stepW = usableW / count;
  const barW = Math.max(1.5, stepW - (count > 20 ? 0.9 : 1.4));
  const span = max - min;

  const bars: EventHistogramBar[] = sorted.map((item, idx) => {
    const norm = span > 0 ? (item.val - min) / span : 0.55;
    const h = Math.max(4, Math.min(svgH - 7, 4 + norm * (svgH - 12)));
    return {
      playerId: item.playerId,
      playerName: item.playerName,
      teamId: item.teamId,
      value: item.val,
      x: Number((padX + idx * stepW).toFixed(2)),
      y: Number((svgH - h).toFixed(2)),
      width: Number(barW.toFixed(2)),
      height: Number(h.toFixed(2)),
      isCurrent: item.playerId === currentPlayerId,
    };
  });

  return {
    metricName,
    unit,
    currentValue,
    min,
    max,
    avg,
    rank,
    totalCount: valid.length,
    topPct,
    bottomPct,
    isUpperHalf,
    isUnrecorded,
    line30X: Number((padX + usableW * 0.3).toFixed(2)),
    line70X: Number((padX + usableW * 0.7).toFixed(2)),
    bars,
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
      'Rank', 'ID', 'Player', 'Korean Name', 'Japanese Name', 'Team', 'Role', 'Total Pt', 'Games', 'Tracked Games',
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
        p.player.koName,
        p.player.jaName,
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
  lines.push(['Match', 'Round', 'Table', 'Source', 'Riichi Sticks', 'Seat', 'ID', 'Player', 'Korean Name', 'Team', 'Raw Score', 'Riichi Bonus', 'Final Score', 'Penalty', 'Rank', 'Final Pt', 'Submitted At'].join(','));
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
          calc.riichiSticks,
          winds[e.seatIndex] || e.seatIndex,
          e.playerId,
          pl?.name || `#${e.playerId}`,
          pl?.koName || '',
          `Team ${e.teamId}`,
          e.rawScore,
          e.riichiBonus,
          e.finalScore,
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
 * 테스트 샌드박스용 샘플 데이터 생성기 (App.vue의 정확한 1-per-round 이벤트 배열 규격 준수)
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
      const isManual = slot.isJpC;

      if (isManual) {
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
            if (rand() < 0.24) {
              rRow[s] = true;
              rOrd.push(s);
            }
          }

          const roll = rand();
          let st = 'ron';
          if (roll < 0.18) {
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
            st = 'tsumo';
            const winner = Math.floor(rand() * 4);
            wRow[winner] = true;
            const unit = [1000, 2000, 2000, 3000][Math.floor(rand() * 4)];
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

          // App.vue standard: 2 entries in time/score, 1 entry in event arrays
          time.push(roundLabels[h], 'ㅤ');
          for (let s = 0; s < 4; s++) {
            score[s].push(deltas[s], curScores[s]);
          }
          riichi.push(rRow);
          win.push(wRow);
          lose.push(lRow);
          tenpai.push(tRow);
          cheat.push(cRow);
          beolbu.push(bRow);
          status.push(st);
          riichiOrder.push(rOrd);
          dealer.push(dIdx);
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

/**
 * 테스트 샌드박스용 진행중 라이브 6탁(1,2,3,5,6,7) 시뮬레이션 스냅샷 생성기
 * - 빔프로젝터 라이브 모니터 화면 및 타 기기 이어서 기록(Continue on This Device) 기능 즉시 테스트용
 */
export function generateSampleLiveGames(
  round: number,
  config: EventScoringConfig = DEFAULT_EVENT_CONFIG
): Record<string, LiveTableState> {
  const out: Record<string, LiveTableState> = {};
  const r = Math.min(6, Math.max(1, round));
  const presetStates: {
    wind: string;
    roundNum: number;
    renchan: number;
    riichiSticks: number;
    scores: [number, number, number, number];
    riichiActive: [boolean, boolean, boolean, boolean];
  }[] = [
    { wind: '南', roundNum: 2, renchan: 1, riichiSticks: 1, scores: [36200, 27400, 21900, 13500], riichiActive: [false, true, false, false] },
    { wind: '南', roundNum: 3, renchan: 0, riichiSticks: 0, scores: [18400, 41200, 24100, 16300], riichiActive: [false, false, false, false] },
    { wind: '東', roundNum: 4, renchan: 2, riichiSticks: 2, scores: [29800, 25500, 24900, 17800], riichiActive: [true, false, true, false] },
    { wind: '南', roundNum: 1, renchan: 0, riichiSticks: 0, scores: [25000, 25000, 25000, 25000], riichiActive: [false, false, false, false] },
    { wind: '南', roundNum: 4, renchan: 1, riichiSticks: 1, scores: [31500, 30200, 22300, 15000], riichiActive: [false, false, false, true] },
    { wind: '南', roundNum: 2, renchan: 0, riichiSticks: 0, scores: [44600, 22100, 19800, 13500], riichiActive: [false, false, false, false] },
    { wind: '東', roundNum: 3, renchan: 0, riichiSticks: 1, scores: [28000, 26500, 25500, 19000], riichiActive: [false, true, false, false] },
  ];

  const baseWinds = ['東', '南', '西', '北'];
  for (let t = 1; t <= 7; t++) {
    if (t === 4) continue; // Table 4 is JP-C display table
    const key = getMatchKey(r, t);
    const slot = EVENT_MATCH_SCHEDULE.find((m) => m.key === key);
    if (!slot) continue;
    const preset = presetStates[t - 1];
    const rot = (preset.roundNum - 1) % 4;
    const winds = [0, 1, 2, 3].map((i) => baseWinds[(i - rot + 4) % 4]) as [string, string, string, string];
    const start = config.startingScore;
    const deltas = preset.scores.map((s) => s - start);

    out[key] = {
      key,
      round: r,
      table: t,
      seatPlayerIds: [...slot.playerIds] as [number, number, number, number],
      scores: [...preset.scores] as [number, number, number, number],
      winds,
      riichiActive: [...preset.riichiActive] as [boolean, boolean, boolean, boolean],
      chomboCounts: [0, 0, 0, 0],
      wind: preset.wind,
      roundNum: preset.roundNum,
      renchan: preset.renchan,
      riichiSticks: preset.riichiSticks,
      isFinished: false,
      records: {
        seatPlayerIds: [...slot.playerIds] as [number, number, number, number],
        time: ['ㅤ', '東 1局 0本場', 'ㅤ'],
        score: [
          [start, deltas[0], preset.scores[0]],
          [start, deltas[1], preset.scores[1]],
          [start, deltas[2], preset.scores[2]],
          [start, deltas[3], preset.scores[3]],
        ],
        riichi: [[false, false, false, false], [false, false, false, false]],
        win: [[false, false, false, false], [true, false, false, false]],
        lose: [[false, false, false, false], [false, false, false, true]],
        tenpai: [[false, false, false, false], [false, false, false, false]],
        cheat: [[false, false, false, false], [false, false, false, false]],
        beolbu: [[0, 0, 0, 0], [0, 0, 0, 0]],
        status: ['initial', 'ron'],
        riichiOrder: [[], []],
        dealer: [0, 0],
      },
      updatedAt: Date.now() - t * 12_000,
    };
  }
  return out;
}

/**
 * 테스트 QA 전용: 엣지케이스 검증용 시드 데이터
 * - R1-T1: 1위 2인 동점 (+20/+20 우마 분할)
 * - R1-T2: 4인 전원 25,000 동점 (0.0pt 분배)
 * - R1-T3: 음수 소점(토비 OFF) + 촌보 누적 포인트 -20pt 차감 (인게임 소점 무변동)
 * - R1-T4: JP-C(수동 입력) 하이브리드 세부 스탯 분기 검증
 */
export function generateEdgeCaseEventResults(
  config: EventScoringConfig = DEFAULT_EVENT_CONFIG
): Record<string, StoredTableResult> {
  const out: Record<string, StoredTableResult> = {};
  const start = config.startingScore;
  const buildSimpleRounds = (
    seatPlayerIds: [number, number, number, number],
    finalScores: [number, number, number, number],
    chomboSeatIdx: number | null = null
  ): CompactRoundRecords => {
    const deltas = finalScores.map((s) => s - start);
    const time = ['ㅤ', '東 1局 0本場', 'ㅤ'];
    const score = [0, 1, 2, 3].map((i) => [start, deltas[i], finalScores[i]]);
    const riichi: boolean[][] = [[false, false, false, false], [true, false, false, false]];
    const win: boolean[][] = [[false, false, false, false], [true, false, false, false]];
    const lose: boolean[][] = [[false, false, false, false], [false, false, false, true]];
    const tenpai: boolean[][] = [[false, false, false, false], [false, false, false, false]];
    const cheat: boolean[][] = [[false, false, false, false], [false, false, false, false]];
    const beolbu: number[][] = [[0, 0, 0, 0], [0, 0, 0, 0]];
    const status: string[] = ['initial', 'ron'];
    const riichiOrder: number[][] = [[], [0]];
    const dealer: number[] = [0, 0];

    if (chomboSeatIdx !== null) {
      time.push('南 2局 0本場', 'ㅤ');
      for (let i = 0; i < 4; i++) score[i].push(0, finalScores[i]);
      riichi.push([false, false, false, false]);
      win.push([false, false, false, false]);
      lose.push([false, false, false, false]);
      tenpai.push([false, false, false, false]);
      cheat.push([0, 1, 2, 3].map((i) => i === chomboSeatIdx));
      beolbu.push([0, 0, 0, 0]);
      status.push('cheat');
      riichiOrder.push([]);
      dealer.push(1);
    }
    time[time.length - 1] = '결과';

    return {
      seatPlayerIds,
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
    };
  };

  const specs: {
    key: string;
    table: number;
    source: ResultSource;
    scores: [number, number, number, number];
    riichiSticks?: number;
    penalties: [number, number, number, number];
    chomboIdx: number | null;
    note: string;
  }[] = [
    {
      key: 'R1-T1',
      table: 1,
      source: 'scorer',
      scores: [35000, 35000, 20000, 10000],
      penalties: [0, 0, 0, 0],
      chomboIdx: null,
      note: 'QA Edge: 1st place 2-way tie (Split Uma)',
    },
    {
      key: 'R1-T2',
      table: 2,
      source: 'scorer',
      scores: [25000, 25000, 25000, 25000],
      penalties: [0, 0, 0, 0],
      chomboIdx: null,
      note: 'QA Edge: 4-way exact 25,000 tie',
    },
    {
      key: 'R1-T3',
      table: 3,
      source: 'scorer',
      scores: [54200, 28000, 22000, -4200],
      penalties: [0, -Math.abs(config.chomboPenalty ?? 20), 0, 0],
      chomboIdx: 1,
      note: 'QA Edge: Negative score (Tobi OFF) + Chombo -20pt',
    },
    {
      key: 'R1-T4',
      table: 4,
      source: 'manual',
      scores: [25000, 25000, 25000, 23000],
      riichiSticks: 2,
      penalties: [0, 0, 0, 0],
      chomboIdx: null,
      note: 'QA Edge: Table 4 JP-C 3-way 1st tie + 2 leftover riichi sticks (800/600/600 → +12.6/+12.2/+12.2/-37.0)',
    },
  ];

  for (const s of specs) {
    const slot = EVENT_MATCH_SCHEDULE.find((m) => m.key === s.key);
    if (!slot) continue;
    const pids = [...slot.playerIds] as [number, number, number, number];
    out[s.key] = {
      key: s.key,
      round: 1,
      table: s.table,
      source: s.source,
      entries: pids.map((pid, idx) => ({
        playerId: pid,
        rawScore: s.scores[idx],
        penalty: s.penalties[idx],
        seatIndex: idx,
      })),
      riichiSticks: s.riichiSticks ?? 0,
      rounds: s.source === 'scorer' ? buildSimpleRounds(pids, s.scores, s.chomboIdx) : null,
      submittedAt: Date.now() - (5 - s.table) * 60_000,
      submittedBy: 'QA Edge Seed',
      note: s.note,
    };
  }

  return out;
}

export function buildCustomSandboxLiveSnapshot(
  round: number,
  table: number,
  preset: {
    wind: string;
    roundNum: number;
    renchan: number;
    riichiSticks: number;
    scores: [number, number, number, number];
    riichiActive?: [boolean, boolean, boolean, boolean];
    chomboCounts?: [number, number, number, number];
  },
  config: EventScoringConfig = DEFAULT_EVENT_CONFIG
): LiveTableState | null {
  const key = getMatchKey(round, table);
  const slot = EVENT_MATCH_SCHEDULE.find((m) => m.key === key);
  if (!slot) return null;
  const baseWinds = ['東', '南', '西', '北'];
  const rot = (preset.roundNum - 1) % 4;
  const winds = [0, 1, 2, 3].map((i) => baseWinds[(i - rot + 4) % 4]) as [string, string, string, string];
  const start = config.startingScore;
  const riichiActive: [boolean, boolean, boolean, boolean] = preset.riichiActive || [false, false, false, false];
  const chomboCounts: [number, number, number, number] = preset.chomboCounts || [0, 0, 0, 0];
  const scoreBeforeRiichi = preset.scores.map((s, idx) => s + (riichiActive[idx] ? 1000 : 0));
  const deltas = scoreBeforeRiichi.map((s) => s - start);

  const time = ['ㅤ', '東 1局 0本場', 'ㅤ'];
  const score = [0, 1, 2, 3].map((i) => [start, deltas[i], scoreBeforeRiichi[i]]);
  const riichi: boolean[][] = [[false, false, false, false], [false, false, false, false]];
  const win: boolean[][] = [[false, false, false, false], [true, false, false, false]];
  const lose: boolean[][] = [[false, false, false, false], [false, false, false, true]];
  const tenpai: boolean[][] = [[false, false, false, false], [false, false, false, false]];
  const cheat: boolean[][] = [[false, false, false, false], [false, false, false, false]];
  const beolbu: number[][] = [[0, 0, 0, 0], [0, 0, 0, 0]];
  const status: string[] = ['initial', 'ron'];
  const riichiOrder: number[][] = [[], []];
  const dealer: number[] = [0, 0];

  chomboCounts.forEach((cnt, seatIdx) => {
    for (let c = 0; c < cnt; c++) {
      time.push(`${preset.wind} ${preset.roundNum}局 0本場`, 'ㅤ');
      for (let i = 0; i < 4; i++) score[i].push(0, scoreBeforeRiichi[i]);
      riichi.push([false, false, false, false]);
      win.push([false, false, false, false]);
      lose.push([false, false, false, false]);
      tenpai.push([false, false, false, false]);
      cheat.push([0, 1, 2, 3].map((i) => i === seatIdx));
      beolbu.push([0, 0, 0, 0]);
      status.push('cheat');
      riichiOrder.push([]);
      dealer.push(rot);
    }
  });

  return {
    key,
    round,
    table,
    seatPlayerIds: [...slot.playerIds] as [number, number, number, number],
    scores: [...preset.scores] as [number, number, number, number],
    winds,
    riichiActive,
    chomboCounts,
    wind: preset.wind,
    roundNum: preset.roundNum,
    renchan: preset.renchan,
    riichiSticks: preset.riichiSticks,
    isFinished: false,
    records: {
      seatPlayerIds: [...slot.playerIds] as [number, number, number, number],
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
    updatedAt: Date.now(),
  };
}

export interface QaSelfTestCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface QaSelfTestReport {
  passed: number;
  failed: number;
  ranAt: number;
  checks: QaSelfTestCheck[];
}

export function runEventQaSelfTest(currentState: EventStatePayload): QaSelfTestReport {
  const checks: QaSelfTestCheck[] = [];

  // 1. Roster check
  const uniqueIds = new Set(EVENT_PLAYERS.map((p) => p.id));
  const proCount = EVENT_PLAYERS.filter((p) => p.isPro).length;
  const teamSizes = EVENT_TEAMS.map((t) => EVENT_PLAYERS.filter((p) => p.teamId === t.id).length);
  const rosterOk = EVENT_PLAYERS.length === 28 && uniqueIds.size === 28 && proCount === 5 && teamSizes.every((n) => n === 7);
  checks.push({
    name: 'Roster Integrity (28 Players / 4 Teams / 5 Pros)',
    ok: rosterOk,
    detail: `Players=${EVENT_PLAYERS.length}, Pros=${proCount}, Teams=[${teamSizes.join(',')}]`,
  });

  // 2. 42-Game schedule check
  const appearances: Record<number, number> = {};
  let validTables = 0;
  for (const m of EVENT_MATCH_SCHEDULE) {
    if (new Set(m.playerIds).size === 4) validTables++;
    m.playerIds.forEach((pid) => {
      appearances[pid] = (appearances[pid] || 0) + 1;
    });
  }
  const allSix = EVENT_PLAYERS.every((p) => appearances[p.id] === 6);
  checks.push({
    name: 'Schedule Integrity (6R × 7T = 42 Games)',
    ok: EVENT_MATCH_SCHEDULE.length === 42 && validTables === 42 && allSix,
    detail: `Matches=${EVENT_MATCH_SCHEDULE.length}, All play 6 games=${allSix}`,
  });

  // 3. Standard M-League scoring zero-sum check
  const stdCalc = calculateTableScoring([
    { playerId: 1, rawScore: 42000, seatIndex: 0 },
    { playerId: 6, rawScore: 28000, seatIndex: 1 },
    { playerId: 7, rawScore: 19000, seatIndex: 2 },
    { playerId: 8, rawScore: 11000, seatIndex: 3 },
  ]);
  const stdSum = round1(stdCalc.entries.reduce((a, b) => a + b.finalPoint, 0));
  const stdTop = stdCalc.entries.find((e) => e.playerId === 1)?.finalPoint;
  checks.push({
    name: 'M-League 25k/30k Uma +30/+10/-10/-30',
    ok: stdTop === 62 && stdSum === 0,
    detail: `42,000 → ${stdTop}pt (expected +62.0), Zero-sum=${stdSum}`,
  });

  // 4. Tie-break split check (2-way tie, 3-way tie + 2 riichi sticks, & 4-way 25,000 tie)
  const tie2 = calculateTableScoring([
    { playerId: 1, rawScore: 35000, seatIndex: 0 },
    { playerId: 6, rawScore: 35000, seatIndex: 1 },
    { playerId: 7, rawScore: 20000, seatIndex: 2 },
    { playerId: 8, rawScore: 10000, seatIndex: 3 },
  ]);
  const tie3Kyotaku = calculateTableScoring(
    [
      { playerId: 1, rawScore: 25000, seatIndex: 0 },
      { playerId: 6, rawScore: 25000, seatIndex: 1 },
      { playerId: 7, rawScore: 25000, seatIndex: 2 },
      { playerId: 8, rawScore: 23000, seatIndex: 3 },
    ],
    DEFAULT_EVENT_CONFIG,
    2
  );
  const tie4 = calculateTableScoring([
    { playerId: 1, rawScore: 25000, seatIndex: 0 },
    { playerId: 6, rawScore: 25000, seatIndex: 1 },
    { playerId: 7, rawScore: 25000, seatIndex: 2 },
    { playerId: 8, rawScore: 25000, seatIndex: 3 },
  ]);
  const tie2Pts = tie2.entries.map((e) => e.finalPoint);
  const tie3Pts = tie3Kyotaku.entries.map((e) => e.finalPoint);
  const tie3Ok =
    tie3Kyotaku.scoreDiff === 0 &&
    tie3Kyotaku.entries[0].rank === 1 &&
    tie3Kyotaku.entries[1].rank === 1 &&
    tie3Kyotaku.entries[2].rank === 1 &&
    tie3Pts[0] === 12.6 &&
    tie3Pts[1] === 12.2 &&
    tie3Pts[2] === 12.2 &&
    tie3Pts[3] === -37 &&
    round1(tie3Pts.reduce((a, b) => a + b, 0)) === 0;
  const tie4Ok = tie4.entries.every((e) => e.finalPoint === 0 && e.rank === 1);
  checks.push({
    name: 'Split Tie-Break (2-Way, 3-Way+2 Riichi, 4-Way 25k)',
    ok: tie2Pts[0] === 35 && tie2Pts[1] === 35 && tie3Ok && tie4Ok,
    detail: `2-way=[${tie2Pts.join(', ')}], 3-way+2R=[${tie3Pts.join(', ')}], 4-way=${tie4Ok}`,
  });

  // 5. Chombo -20pt off cumulative only
  const chomboCalc = calculateTableScoring([
    { playerId: 1, rawScore: 30000, penalty: -20, seatIndex: 0 },
    { playerId: 6, rawScore: 25000, penalty: 0, seatIndex: 1 },
    { playerId: 7, rawScore: 23000, penalty: 0, seatIndex: 2 },
    { playerId: 8, rawScore: 22000, penalty: 0, seatIndex: 3 },
  ]);
  const chomboP1 = chomboCalc.entries.find((e) => e.playerId === 1);
  checks.push({
    name: 'Chombo -20pt Cumulative Penalty Only',
    ok: Boolean(chomboP1 && chomboP1.rawScore === 30000 && chomboP1.finalPoint === 30),
    detail: `30,000 + Oka/Uma(+50) - Chombo(20) = ${chomboP1?.finalPoint}pt`,
  });

  // 6. Round Timer 50+0 / 50+1 countdown & expiry
  const now = 1_700_000_000_000;
  const tRun = computeRoundTimerDisplay(
    { round: 1, durationMinutes: 50, extraHands: 0, status: 'running', endsAt: now + 90_000, pausedRemainingMs: null, updatedAt: now },
    now
  );
  const tExp = computeRoundTimerDisplay(
    { round: 1, durationMinutes: 50, extraHands: 1, status: 'running', endsAt: now - 1000, pausedRemainingMs: null, updatedAt: now },
    now
  );
  checks.push({
    name: 'Round Timer Countdown & Time-Up (50+0 / 50+1)',
    ok: tRun.formatted === '01:30' && tRun.severity === 'critical' && tExp.isExpired && tExp.ruleTag === '50+1',
    detail: `Running=${tRun.formatted} (${tRun.severity}), Expired=${tExp.isExpired} (${tExp.ruleTag})`,
  });

  // 7. Histogram bar direction (higher actual value = taller bar) & Bottom% check
  const edgeRes = generateEdgeCaseEventResults(DEFAULT_EVENT_CONFIG);
  const edgeStandings = computeLeagueStandings(edgeRes, DEFAULT_EVENT_CONFIG);
  const dist = calculateEventMetricDistribution(
    edgeStandings.players,
    (p: PlayerStanding) => p.detailed.dealInRate,
    1,
    'Deal-in',
    '%',
    false,
    true
  );
  const barsMonotonic =
    dist.bars.length >= 2 &&
    dist.bars.every((b, i) => (i === 0 ? true : b.value >= dist.bars[i - 1].value && b.height >= dist.bars[i - 1].height - 0.01));
  checks.push({
    name: 'Histogram Scale (Higher Value = Taller Bar) & Top/Bottom%',
    ok: barsMonotonic && dist.topPct >= 0 && dist.bottomPct >= 0,
    detail: `Bars=${dist.bars.length}, MonotonicHeight=${barsMonotonic}, Top=${dist.topPct}% / Bottom=${dist.bottomPct}%`,
  });

  // 8. Current Sandbox State consistency
  const curStandings = computeLeagueStandings(currentState.results, currentState.config);
  const teamSum = round1(curStandings.teams.reduce((a, t) => a + t.totalPoints, 0));
  const playerSum = round1(curStandings.players.reduce((a, p) => a + p.totalPoints, 0));
  const sumMatches = Math.abs(teamSum - playerSum) < 0.15;
  checks.push({
    name: 'Current Sandbox State Consistency',
    ok: sumMatches,
    detail: `Games=${curStandings.completedGames}/42, TeamSum=${teamSum}pt, PlayerSum=${playerSum}pt`,
  });

  const passed = checks.filter((c) => c.ok).length;
  return {
    passed,
    failed: checks.length - passed,
    ranAt: Date.now(),
    checks,
  };
}
