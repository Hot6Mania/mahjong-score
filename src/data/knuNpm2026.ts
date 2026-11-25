/**
 * 2026 KNU X NPM MAHJONG TEAM LEAGUE 공식 마스터 데이터
 * - 2026년 11월 28일 개최
 * - 4팀 (Team A / B / C / D), 확정 인원 28명 (NPM 프로 5명 + 참가자 23명)
 * - 6라운드 × 7탁 = 총 42반장
 * - Table 4: JP-C (점표탁) / Tables 1, 2, 3, 5, 6, 7: JP-2 등 비점표탁 (Scorer 주력)
 */

export type TeamId = 'A' | 'B' | 'C' | 'D';

export interface EventTeam {
  id: TeamId;
  name: string;
  color: string;
  bgTint: string;
  borderColor: string;
}

export interface EventPlayer {
  id: number;
  name: string;
  compactName: string;
  teamId: TeamId;
  isPro: boolean;
}

export interface EventMatchSlot {
  key: string; // e.g. "R1-T1"
  round: number; // 1..6
  table: number; // 1..7
  playerIds: [number, number, number, number];
  isJpC: boolean; // Table 4 is JP-C digital score table
  proPlayerId: number | null; // Tables 1..5 have fixed NPM Pro
}

export interface EventRoundTimer {
  round: number; // 1..6
  durationMinutes: number; // default 50
  extraHands: 0 | 1; // 0 = 50+0 (current hand ends), 1 = 50+1 (current + 1 hand)
  status: 'idle' | 'running' | 'paused';
  endsAt: number | null; // epoch ms when countdown hits 0 (server-synced)
  pausedRemainingMs: number | null; // remaining ms when paused
  updatedAt: number;
}

export const DEFAULT_ROUND_TIMER: EventRoundTimer = {
  round: 1,
  durationMinutes: 50,
  extraHands: 0,
  status: 'idle',
  endsAt: null,
  pausedRemainingMs: null,
  updatedAt: 0,
};

export interface EventScoringConfig {
  startingScore: number;
  returnScore: number;
  uma: [number, number, number, number];
  tieBreak: 'split' | 'seat';
  roundMangan: boolean;
  tobi: boolean;
  riichiPayout: boolean;
  chomboPenalty: number;
  allowParticipantInput: boolean;
  lockedRounds: number[];
  lockedTables: string[];
  roundTimer: EventRoundTimer;
}

export const EVENT_META = {
  id: 'knu-npm-2026',
  title: '2026 KNU X NPM MAHJONG TEAM LEAGUE',
  date: '2026-11-28',
  totalRounds: 6,
  totalTables: 7,
  totalGames: 42,
  jpCTables: [4] as number[],
} as const;

export const DEFAULT_EVENT_CONFIG: EventScoringConfig = {
  startingScore: 25000,
  returnScore: 30000,
  uma: [30, 10, -10, -30],
  tieBreak: 'split',
  roundMangan: true,
  tobi: false,
  riichiPayout: true,
  chomboPenalty: 20,
  allowParticipantInput: true,
  lockedRounds: [],
  lockedTables: [],
  roundTimer: { ...DEFAULT_ROUND_TIMER },
};

export const EVENT_TEAMS: EventTeam[] = [
  {
    id: 'A',
    name: 'Team A',
    color: '#3b82f6',
    bgTint: 'rgba(59, 130, 246, 0.14)',
    borderColor: 'rgba(59, 130, 246, 0.45)',
  },
  {
    id: 'B',
    name: 'Team B',
    color: '#f43f5e',
    bgTint: 'rgba(244, 63, 94, 0.14)',
    borderColor: 'rgba(244, 63, 94, 0.45)',
  },
  {
    id: 'C',
    name: 'Team C',
    color: '#f59e0b',
    bgTint: 'rgba(245, 158, 11, 0.14)',
    borderColor: 'rgba(245, 158, 11, 0.45)',
  },
  {
    id: 'D',
    name: 'Team D',
    color: '#22c55e',
    bgTint: 'rgba(34, 197, 94, 0.14)',
    borderColor: 'rgba(34, 197, 94, 0.45)',
  },
];

export const EVENT_TEAM_MAP: Record<TeamId, EventTeam> = {
  A: EVENT_TEAMS[0],
  B: EVENT_TEAMS[1],
  C: EVENT_TEAMS[2],
  D: EVENT_TEAMS[3],
};

/**
 * 확정 참가자 28명 로스터 (ID 1~28)
 * - compactName은 점수판 좁은 좌석 뱃지용으로 28명 전원 100% 고유하며 최대 11자 이내
 */
export const EVENT_PLAYERS: EventPlayer[] = [
  // Professionals (1..5)
  { id: 1, name: 'Gotanji Seiichiro', compactName: 'Gotanji S.', teamId: 'A', isPro: true },
  { id: 2, name: 'Saito Shun', compactName: 'Saito Shun', teamId: 'B', isPro: true },
  { id: 3, name: 'Yanagita Noriaki', compactName: 'Yanagita N.', teamId: 'C', isPro: true },
  { id: 4, name: 'Minase Chihiro', compactName: 'Minase C.', teamId: 'D', isPro: true },
  { id: 5, name: 'Osaka Sora', compactName: 'Osaka Sora', teamId: 'A', isPro: true },

  // Players (6..28)
  { id: 6, name: 'Kim Jiyu', compactName: 'K. Jiyu', teamId: 'B', isPro: false },
  { id: 7, name: 'Kim Minwoo', compactName: 'K. Minwoo', teamId: 'C', isPro: false },
  { id: 8, name: 'Park Jihwan', compactName: 'P. Jihwan', teamId: 'D', isPro: false },
  { id: 9, name: 'Lee Sangcheol', compactName: 'L. Sangch.', teamId: 'A', isPro: false },
  { id: 10, name: 'Song Youngwook', compactName: 'S. Youngw.', teamId: 'B', isPro: false },
  { id: 11, name: 'Choi Mingyu', compactName: 'C. Mingyu', teamId: 'C', isPro: false },
  { id: 12, name: 'Shin Sangjae', compactName: 'S. Sangjae', teamId: 'D', isPro: false },
  { id: 13, name: 'Kim Minseo', compactName: 'K. Minseo', teamId: 'A', isPro: false },
  { id: 14, name: 'Kim Gyumin', compactName: 'K. Gyumin', teamId: 'B', isPro: false },
  { id: 15, name: 'Song Gwanwoo', compactName: 'S. Gwanwoo', teamId: 'C', isPro: false },
  { id: 16, name: 'Kim Doyoon', compactName: 'K. Doyoon', teamId: 'D', isPro: false },
  { id: 17, name: 'Kwon Minsoo', compactName: 'Kw. Minsoo', teamId: 'A', isPro: false },
  { id: 18, name: 'Kwon Minyoung', compactName: 'Kw. Miny.', teamId: 'B', isPro: false },
  { id: 19, name: 'Lee Gyutae', compactName: 'L. Gyutae', teamId: 'C', isPro: false },
  { id: 20, name: 'Lee Gyuho', compactName: 'L. Gyuho', teamId: 'D', isPro: false },
  { id: 21, name: 'Kim Gyeonghun', compactName: 'K. Gyeongh.', teamId: 'A', isPro: false },
  { id: 22, name: 'Kang Bogwon', compactName: 'K. Bogwon', teamId: 'B', isPro: false },
  { id: 23, name: 'Hong Youngmin', compactName: 'H. Youngm.', teamId: 'C', isPro: false },
  { id: 24, name: 'Lee Junhyeok', compactName: 'L. Junhy.', teamId: 'D', isPro: false },
  { id: 25, name: 'Ryoo Younggyo', compactName: 'R. Youngg.', teamId: 'A', isPro: false },
  { id: 26, name: 'Yoon Junseok', compactName: 'Y. Junseok', teamId: 'B', isPro: false },
  { id: 27, name: 'Jun Hyunho', compactName: 'J. Hyunho', teamId: 'C', isPro: false },
  { id: 28, name: 'Lee Jeonghun', compactName: 'L. Jeongh.', teamId: 'D', isPro: false },
];

export const EVENT_PLAYER_MAP: Record<number, EventPlayer> = Object.fromEntries(
  EVENT_PLAYERS.map((p) => [p.id, p])
);

export function getEventPlayer(id: number): EventPlayer | undefined {
  return EVENT_PLAYER_MAP[id];
}

export function getMatchKey(round: number, table: number): string {
  return `R${round}-T${table}`;
}

const RAW_SCHEDULE: Record<number, Record<number, [number, number, number, number]>> = {
  1: {
    1: [1, 6, 7, 8],
    2: [2, 9, 11, 12],
    3: [3, 13, 10, 16],
    4: [4, 17, 14, 15],
    5: [5, 18, 19, 20],
    6: [21, 22, 23, 24],
    7: [25, 26, 27, 28],
  },
  2: {
    1: [1, 10, 23, 28],
    2: [2, 13, 15, 24],
    3: [3, 25, 22, 8],
    4: [4, 9, 26, 19],
    5: [5, 6, 27, 16],
    6: [17, 18, 7, 12],
    7: [21, 14, 11, 20],
  },
  3: {
    1: [1, 18, 11, 16],
    2: [2, 25, 7, 20],
    3: [3, 21, 26, 12],
    4: [4, 13, 22, 27],
    5: [5, 14, 23, 8],
    6: [17, 10, 19, 24],
    7: [9, 6, 15, 28],
  },
  4: {
    1: [1, 22, 19, 12],
    2: [2, 17, 23, 16],
    3: [3, 13, 14, 28],
    4: [4, 25, 6, 11],
    5: [5, 26, 7, 24],
    6: [21, 18, 15, 8],
    7: [9, 10, 27, 20],
  },
  5: {
    1: [1, 14, 27, 24],
    2: [2, 21, 19, 28],
    3: [3, 17, 6, 20],
    4: [4, 25, 18, 23],
    5: [5, 10, 15, 12],
    6: [13, 26, 11, 8],
    7: [9, 22, 7, 16],
  },
  6: {
    1: [1, 26, 15, 20],
    2: [2, 17, 27, 8],
    3: [3, 9, 18, 24],
    4: [4, 21, 10, 7],
    5: [5, 22, 11, 28],
    6: [25, 14, 19, 16],
    7: [13, 6, 23, 12],
  },
};

export const EVENT_MATCH_SCHEDULE: EventMatchSlot[] = [];

for (let round = 1; round <= 6; round++) {
  for (let table = 1; table <= 7; table++) {
    const playerIds = RAW_SCHEDULE[round][table];
    const proPlayerId = playerIds.find((id) => EVENT_PLAYER_MAP[id]?.isPro) ?? null;
    EVENT_MATCH_SCHEDULE.push({
      key: getMatchKey(round, table),
      round,
      table,
      playerIds,
      isJpC: table === 4,
      proPlayerId,
    });
  }
}

export const EVENT_MATCH_MAP: Record<string, EventMatchSlot> = Object.fromEntries(
  EVENT_MATCH_SCHEDULE.map((m) => [m.key, m])
);

export function getMatchSlot(round: number, table: number): EventMatchSlot | undefined {
  return EVENT_MATCH_MAP[getMatchKey(round, table)];
}

export function getRoundMatches(round: number): EventMatchSlot[] {
  return EVENT_MATCH_SCHEDULE.filter((m) => m.round === round);
}

export function getPlayerMatches(playerId: number): EventMatchSlot[] {
  return EVENT_MATCH_SCHEDULE.filter((m) => m.playerIds.includes(playerId));
}
