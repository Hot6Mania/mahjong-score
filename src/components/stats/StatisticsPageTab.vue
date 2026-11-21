<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import {
  calculateMetricDistribution,
  computeFrequentOpponentsStats,
  fetchSeatRankStats,
  fetchHighScoreDealIns,
  queryMemberStatsByFilter,
  parseSessionNumber,
  extractIsoDateFromRecord,
  type MemberStatItem,
  type GameRatingHistoryRecord,
  type DistributionData,
  type HistogramBar,
  type SeatRankStatsResult,
  type HighScoreDealInRecord,
  type StatsQueryMode,
  type StatsQueryResult,
} from '@/services/publicStatsService';
import { getRatingColor, normalizeRatingPlayerName, computeStableRating } from '@/utils/ratingEngine';

type StatsSubTab = 'player' | 'by-rating' | 'by-seat' | 'deal-ins' | 'games' | 'players-count';

const props = withDefaults(
  defineProps<{
    allStats: MemberStatItem[];
    availableSessions: string[];
    ratingHistory: GameRatingHistoryRecord[];
    initialPlayerName?: string;
    initialSubTab?: StatsSubTab;
    isDark?: boolean;
  }>(),
  {
    initialPlayerName: '',
    initialSubTab: 'player',
    isDark: false,
  }
);

const emit = defineEmits<{
  (e: 'open-compare', playerA: string, playerB?: string): void;
  (e: 'open-popup', playerName: string): void;
}>();

const activeSubTab = ref<StatsSubTab>(props.initialSubTab || 'player');

// ==========================================
// 0. 회차 번호 -> 전체 회차명 / ISO 일자 매핑 (제9회~최신회차 일자 누락 해결)
// ==========================================
const sortedSessionsDesc = computed<string[]>(() =>
  [...(props.availableSessions || [])].sort((a, b) => parseSessionNumber(b) - parseSessionNumber(a))
);

const sortedSessionsAsc = computed<string[]>(() => [...sortedSessionsDesc.value].reverse());

const maxSessionNumber = computed<number>(() => {
  const nums = sortedSessionsDesc.value.map((s) => parseSessionNumber(s)).filter((n) => n > 0);
  return nums.length > 0 ? Math.max(...nums) : 1;
});

const resolveSessionLabelByNum = (num: number): string => {
  const clamped = Math.max(1, Math.min(maxSessionNumber.value, Math.floor(Number(num) || 1)));
  const found = sortedSessionsAsc.value.find((s) => parseSessionNumber(s) === clamped);
  return found || `제${clamped}회`;
};

const sessionInfoByNum = computed(() => {
  const map = new Map<number, { fullLabel: string; isoDate: string }>();
  for (const s of sortedSessionsDesc.value) {
    const num = parseSessionNumber(s);
    if (num > 0 && !map.has(num)) {
      map.set(num, {
        fullLabel: s,
        isoDate: extractIsoDateFromRecord(s),
      });
    }
  }
  return map;
});

const resolveGameSessionLabel = (g: { sessionLabel?: string }): string => {
  const raw = String(g.sessionLabel || '').trim();
  const num = parseSessionNumber(raw);
  if (num > 0) {
    const info = sessionInfoByNum.value.get(num);
    if (info?.fullLabel) return info.fullLabel;
    return `제${num}회`;
  }
  return raw || '기타';
};

const resolveGameIsoDate = (g: { sessionLabel?: string; date?: string }): string => {
  const direct = extractIsoDateFromRecord(g.sessionLabel, g.date);
  if (direct) return direct;
  const num = parseSessionNumber(g.sessionLabel);
  if (num > 0) {
    return sessionInfoByNum.value.get(num)?.isoDate || '';
  }
  return '';
};

const availableIsoDates = computed<string[]>(() => {
  const dateSet = new Set<string>();
  for (const s of sortedSessionsDesc.value) {
    const iso = extractIsoDateFromRecord(s);
    if (iso) dateSet.add(iso);
  }
  for (const g of props.ratingHistory || []) {
    const iso = resolveGameIsoDate(g);
    if (iso) dateSet.add(iso);
  }
  return Array.from(dateSet).sort((a, b) => b.localeCompare(a));
});

const getMemberRounds = (m: MemberStatItem): number => {
  return (m.detailedStats?.totalRounds ?? m.totalRounds ?? 0) || 0;
};

// ==========================================
// 1. 플레이어 검색 (페이지형 개인 스탯 + N국 이상 필터)
// ==========================================
const searchInput = ref('');
const isDropdownOpen = ref(false);
const highlightedIdx = ref(0);
const selectedPlayerName = ref('');
const showAllPlayerGames = ref(false);

// 통계 스탯 분포(상위 %) 기준 최소 총 대국수 (기본 20회 이상) + 별도 최소 국 수 옵션
const playerTabMinGames = ref<number>(20);
const playerTabMinRounds = ref<number>(0);

const sortedAllMembers = computed<MemberStatItem[]>(() => {
  return [...(props.allStats || [])].sort((a, b) => {
    if (b.totalUma !== a.totalUma) return b.totalUma - a.totalUma;
    return b.totalGames - a.totalGames;
  });
});

const qualifiedMembersForSearch = computed<MemberStatItem[]>(() => {
  const minR = Math.max(0, Math.floor(Number(playerTabMinRounds.value) || 0));
  if (minR <= 0) return sortedAllMembers.value;
  return sortedAllMembers.value.filter((m) => getMemberRounds(m) >= minR);
});

const qualifiedMembersForDistCount = computed(() => activePlayerScopeMembers.value.length);

const findMemberByName = (name: string): MemberStatItem | null => {
  const clean = (name || '').trim();
  if (!clean) return null;
  const exact = sortedAllMembers.value.find((m) => m.name === clean);
  if (exact) return exact;
  const norm = normalizeRatingPlayerName(clean);
  return sortedAllMembers.value.find((m) => normalizeRatingPlayerName(m.name) === norm) || null;
};

watch(
  () => props.initialPlayerName,
  (val) => {
    if (val && val.trim()) {
      const m = findMemberByName(val);
      if (m) {
        selectedPlayerName.value = m.name;
        searchInput.value = m.name;
        activeSubTab.value = 'player';
        showAllPlayerGames.value = false;
      }
    }
  },
  { immediate: true }
);

watch(
  () => props.initialSubTab,
  (val) => {
    if (val) activeSubTab.value = val;
  }
);

const autocompleteCandidates = computed<MemberStatItem[]>(() => {
  const q = searchInput.value.trim().toLowerCase();
  const pool = qualifiedMembersForSearch.value;
  if (!q) return pool.slice(0, 14);
  return pool.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 16);
});

const selectPlayer = (name: string) => {
  const m = findMemberByName(name);
  if (!m) return;
  selectedPlayerName.value = m.name;
  searchInput.value = m.name;
  isDropdownOpen.value = false;
  showAllPlayerGames.value = false;
  inspectedMetricKey.value = null;
  activeSubTab.value = 'player';
};

const clearSelectedPlayer = () => {
  selectedPlayerName.value = '';
  searchInput.value = '';
  inspectedMetricKey.value = null;
};

const onSearchBlur = () => {
  window.setTimeout(() => {
    isDropdownOpen.value = false;
  }, 150);
};

const onSearchKeydown = (e: KeyboardEvent) => {
  if (!isDropdownOpen.value && (e.key === 'ArrowDown' || e.key === 'Enter')) {
    isDropdownOpen.value = true;
  }
  const list = autocompleteCandidates.value;
  if (list.length === 0) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    highlightedIdx.value = (highlightedIdx.value + 1) % list.length;
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    highlightedIdx.value = (highlightedIdx.value - 1 + list.length) % list.length;
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const picked = list[highlightedIdx.value] || list[0];
    if (picked) selectPlayer(picked.name);
  } else if (e.key === 'Escape') {
    isDropdownOpen.value = false;
  }
};

// ==========================================
// 1-1. 개인별 기간 / 구간 스탯 필터
// ==========================================
type PlayerScopeMode = 'all' | 'recent_games' | 'recent_sessions' | 'date_range' | 'session_range';
const playerScopeMode = ref<PlayerScopeMode>('all');
const playerScopeRecentGames = ref<number>(10);
const playerScopeRecentSessions = ref<number>(3);
const playerScopeStartDate = ref<string>('');
const playerScopeEndDate = ref<string>('');
const playerScopeStartSession = ref<string>('');
const playerScopeEndSession = ref<string>('');
const playerScopeStartNum = ref<number>(1);
const playerScopeEndNum = ref<number>(1);
const playerScopeResult = ref<StatsQueryResult | null>(null);
const isLoadingPlayerScope = ref(false);
let playerScopeReqSeq = 0;

const initPlayerScopeDefaults = () => {
  const dates = availableIsoDates.value;
  if (!playerScopeEndDate.value && dates.length > 0) {
    playerScopeEndDate.value = dates[0];
  }
  if (!playerScopeStartDate.value && dates.length > 0) {
    playerScopeStartDate.value = dates[Math.min(4, dates.length - 1)];
  }
  const sessions = sortedSessionsDesc.value;
  if (!playerScopeEndSession.value && sessions.length > 0) {
    playerScopeEndSession.value = sessions[0];
    playerScopeEndNum.value = parseSessionNumber(sessions[0]) || maxSessionNumber.value;
  }
  if (!playerScopeStartSession.value && sessions.length > 0) {
    const startS = sessions[Math.min(4, sessions.length - 1)];
    playerScopeStartSession.value = startS;
    playerScopeStartNum.value = parseSessionNumber(startS) || 1;
  }
};

const syncPlayerSessionNumsFromLabels = () => {
  const s = parseSessionNumber(playerScopeStartSession.value);
  const e = parseSessionNumber(playerScopeEndSession.value);
  if (s > 0) playerScopeStartNum.value = s;
  if (e > 0) playerScopeEndNum.value = e;
};

const applyPlayerSessionNums = () => {
  const a = Math.max(1, Math.min(maxSessionNumber.value, Math.floor(Number(playerScopeStartNum.value) || 1)));
  const b = Math.max(1, Math.min(maxSessionNumber.value, Math.floor(Number(playerScopeEndNum.value) || maxSessionNumber.value)));
  playerScopeStartNum.value = Math.min(a, b);
  playerScopeEndNum.value = Math.max(a, b);
  playerScopeStartSession.value = resolveSessionLabelByNum(playerScopeStartNum.value);
  playerScopeEndSession.value = resolveSessionLabelByNum(playerScopeEndNum.value);
  runPlayerScopeQuery();
};

const runPlayerScopeQuery = async () => {
  if (playerScopeMode.value === 'all') {
    playerScopeResult.value = null;
    isLoadingPlayerScope.value = false;
    return;
  }
  initPlayerScopeDefaults();
  const seq = ++playerScopeReqSeq;
  isLoadingPlayerScope.value = true;
  try {
    const mode: StatsQueryMode = playerScopeMode.value;
    const res = await queryMemberStatsByFilter(
      {
        mode,
        recentGames: playerScopeRecentGames.value,
        recentSessions: playerScopeRecentSessions.value,
        startDate: playerScopeStartDate.value,
        endDate: playerScopeEndDate.value,
        startSession: playerScopeStartSession.value,
        endSession: playerScopeEndSession.value,
        minGames: 0,
      },
      {
        allStats: props.allStats,
        availableSessions: props.availableSessions,
      }
    );
    if (seq === playerScopeReqSeq) {
      playerScopeResult.value = res;
      inspectedMetricKey.value = null;
    }
  } catch (e) {
    console.warn('runPlayerScopeQuery failed:', e);
  } finally {
    if (seq === playerScopeReqSeq) {
      isLoadingPlayerScope.value = false;
    }
  }
};

const setPlayerScopeMode = (mode: PlayerScopeMode) => {
  playerScopeMode.value = mode;
  initPlayerScopeDefaults();
  runPlayerScopeQuery();
};

const setPlayerScopeDatePresetDays = (days: number) => {
  const anchor = availableIsoDates.value[0] || new Date().toISOString().slice(0, 10);
  const endD = new Date(anchor + 'T00:00:00');
  const startD = new Date(endD.getTime() - days * 86400000);
  playerScopeEndDate.value = anchor;
  playerScopeStartDate.value = startD.toISOString().slice(0, 10);
  playerScopeMode.value = 'date_range';
  runPlayerScopeQuery();
};

const resetPlayerScope = () => {
  playerScopeMode.value = 'all';
  playerScopeResult.value = null;
};

const isPlayerScopeActive = computed(() => playerScopeMode.value !== 'all' && playerScopeResult.value !== null);

const activePlayerScopeMembers = computed<MemberStatItem[]>(() => {
  const raw = isPlayerScopeActive.value && playerScopeResult.value
    ? playerScopeResult.value.members
    : (props.allStats || []);
  const minG = !isPlayerScopeActive.value
    ? Math.max(0, Math.floor(Number(playerTabMinGames.value) || 0))
    : 0;
  const minR = Math.max(0, Math.floor(Number(playerTabMinRounds.value) || 0));
  const filtered = raw.filter(
    (m) => (m.totalGames || 0) >= minG && getMemberRounds(m) >= minR
  );
  return filtered.length > 0 ? filtered : raw;
});

const baseSelectedPlayer = computed<MemberStatItem | null>(() => findMemberByName(selectedPlayerName.value));

const selectedPlayer = computed<MemberStatItem | null>(() => {
  const base = baseSelectedPlayer.value;
  if (!base) return null;
  if (!isPlayerScopeActive.value || !playerScopeResult.value) return base;
  const norm = normalizeRatingPlayerName(base.name);
  const found = playerScopeResult.value.members.find(
    (m) => m.name === base.name || normalizeRatingPlayerName(m.name) === norm
  );
  return found || null;
});

const isSelectedPlayerEmptyInScope = computed(
  () => Boolean(baseSelectedPlayer.value) && isPlayerScopeActive.value && !selectedPlayer.value
);

const selectedDetail = computed<MemberStatItem | null>(() => {
  if (!selectedPlayer.value) return null;
  return selectedPlayer.value.detailedStats || selectedPlayer.value;
});
const hasSelectedDetail = computed(() => (selectedDetail.value?.totalRounds || 0) > 0);

const selectedOverallRank = computed(() => {
  if (!selectedPlayer.value) return 0;
  const pool = [...activePlayerScopeMembers.value];
  const norm = normalizeRatingPlayerName(selectedPlayer.value.name);
  if (!pool.some((m) => normalizeRatingPlayerName(m.name) === norm)) {
    pool.push(selectedPlayer.value);
  }
  pool.sort((a, b) => {
    if (b.totalUma !== a.totalUma) return b.totalUma - a.totalUma;
    return b.totalGames - a.totalGames;
  });
  return pool.findIndex((m) => normalizeRatingPlayerName(m.name) === norm) + 1;
});

const selectedRankDist = computed(() => {
  const p = selectedPlayer.value;
  if (!p) return { r1: 0, r2: 0, r3: 0, r4: 0, p1: 0, p2: 0, p3: 0, p4: 0, total: 0 };
  const r1 = p.rank1Count || 0;
  const r2 = p.rank2Count || 0;
  const r3 = p.rank3Count || 0;
  const r4 = p.rank4Count || 0;
  const total = r1 + r2 + r3 + r4;
  if (total === 0) return { r1, r2, r3, r4, p1: 0, p2: 0, p3: 0, p4: 0, total: 0 };
  return {
    r1,
    r2,
    r3,
    r4,
    p1: (r1 / total) * 100,
    p2: (r2 / total) * 100,
    p3: (r3 / total) * 100,
    p4: (r4 / total) * 100,
    total,
  };
});

// 개인 페이지 인라인 지표 분포 인스펙터
const inspectedMetricKey = ref<keyof MemberStatItem | null>(null);
const inspectedMetricMeta = ref<{ label: string; higherIsBetter: boolean; unit: string; value: number } | null>(null);
const hoveredInlineBar = ref<HistogramBar | null>(null);
const drawerSelectedBandKey = ref<string>('all');

const toggleDrawerBand = (bandKey: string) => {
  drawerSelectedBandKey.value = drawerSelectedBandKey.value === bandKey ? 'all' : bandKey;
};

// 선택된 플레이어의 안정 레이팅 (현재 조회 기간/성적 비율 기준 무한 대국 수렴치)
const selectedPlayerStableRating = computed(() => {
  const p = selectedPlayer.value;
  if (!p || (p.totalGames || 0) <= 0) return null;
  const rated = (props.allStats || []).filter((m) => typeof m.rating === 'number' && m.totalGames > 0);
  const leagueAvgR = rated.length > 0
    ? rated.reduce((sum, m) => sum + (m.rating || 0), 0) / rated.length
    : 1500;
  return computeStableRating({
    playerName: p.name,
    avgUma: p.avgUma,
    totalGames: p.totalGames,
    historyRecords: scopedPlayerHistoryGames.value,
    fallbackAvgOpponentRating: leagueAvgR,
  });
});

const formatPenaltyText = (rate: number, totalRounds: number, explicitCount?: number): string => {
  const safeRate = Number.isFinite(rate) ? rate : 0;
  const cnt =
    explicitCount !== undefined && explicitCount !== null
      ? Math.max(0, Math.round(explicitCount))
      : totalRounds > 0 && safeRate > 0
        ? Math.round((safeRate / 100) * totalRounds)
        : 0;
  return `${safeRate.toFixed(4)}% (${cnt}회)`;
};

const formatMetricVal = (val: number, label: string, unit: string): string => {
  if (!Number.isFinite(val)) return '-';
  if (label === '평균 순위') return `${val.toFixed(3)}${unit}`;
  if (label === '촌보율' || label === '벌부율') return `${val.toFixed(4)}${unit}`;
  if (unit === '%') return `${val.toFixed(2)}${unit}`;
  if (unit === 'pt') return `${val > 0 ? '+' : ''}${val.toFixed(1)}pt`;
  return `${Math.round(val).toLocaleString()}${unit}`;
};

const getMetricDistForSelected = (
  key: keyof MemberStatItem,
  label: string,
  val: number,
  higherIsBetter: boolean,
  unit: string
): DistributionData | null => {
  if (!selectedPlayer.value || activePlayerScopeMembers.value.length === 0) return null;
  const overallKeys: (keyof MemberStatItem)[] = ['totalGames', 'totalUma', 'avgUma', 'avgRank', 'top2Rate'];
  const isOverall = overallKeys.includes(key);
  const targetList = isOverall
    ? activePlayerScopeMembers.value
    : activePlayerScopeMembers.value.map((m) => (m.detailedStats ? { ...m.detailedStats, rating: m.rating } : m));
  const isUnrecorded = !isOverall && !hasSelectedDetail.value;
  return calculateMetricDistribution(
    targetList,
    key,
    label,
    val,
    unit,
    higherIsBetter,
    selectedPlayer.value.name,
    isUnrecorded
  );
};

const toggleInspectMetric = (
  key: keyof MemberStatItem,
  label: string,
  val: number,
  higherIsBetter: boolean,
  unit: string
) => {
  if (inspectedMetricKey.value === key) {
    inspectedMetricKey.value = null;
    inspectedMetricMeta.value = null;
    hoveredInlineBar.value = null;
    return;
  }
  inspectedMetricKey.value = key;
  inspectedMetricMeta.value = { label, higherIsBetter, unit, value: val };
  hoveredInlineBar.value = null;
};

const inspectedDistribution = computed<DistributionData | null>(() => {
  if (!inspectedMetricKey.value || !inspectedMetricMeta.value) return null;
  return getMetricDistForSelected(
    inspectedMetricKey.value,
    inspectedMetricMeta.value.label,
    inspectedMetricMeta.value.value,
    inspectedMetricMeta.value.higherIsBetter,
    inspectedMetricMeta.value.unit
  );
});

interface PageStatCell {
  key: keyof MemberStatItem;
  label: string;
  value: number;
  displayText: string;
  higherIsBetter: boolean;
  unit: string;
  topPctText: string;
  isUpperHalf: boolean;
  isUnrecorded: boolean;
}

const buildStatCells = (
  specs: Array<{
    key: keyof MemberStatItem;
    label: string;
    value: number;
    higherIsBetter: boolean;
    unit: string;
    customText?: string;
    isOverall?: boolean;
  }>
): PageStatCell[] => {
  return specs.map((s) => {
    const unrec = !s.isOverall && !hasSelectedDetail.value;
    const dist = getMetricDistForSelected(s.key, s.label, s.value, s.higherIsBetter, s.unit);
    return {
      key: s.key,
      label: s.label,
      value: s.value,
      displayText: unrec ? '-' : (s.customText ?? formatMetricVal(s.value, s.label, s.unit)),
      higherIsBetter: s.higherIsBetter,
      unit: s.unit,
      topPctText: dist && !dist.isUnrecorded ? `상위 ${dist.topPct.toFixed(1)}%` : '-',
      isUpperHalf: dist ? dist.isUpperHalf : true,
      isUnrecorded: unrec,
    };
  });
};

const basicStatCells = computed<PageStatCell[]>(() => {
  const p = selectedPlayer.value;
  const d = selectedDetail.value;
  if (!p || !d) return [];
  return buildStatCells([
    { key: 'winRate', label: '화료율', value: d.winRate, higherIsBetter: true, unit: '%' },
    { key: 'dealInRate', label: '방총률', value: d.dealInRate, higherIsBetter: false, unit: '%' },
    { key: 'tsumoRate', label: '쯔모율', value: d.tsumoRate, higherIsBetter: true, unit: '%' },
    { key: 'avgWinScore', label: '평균 화료 점수', value: d.avgWinScore, higherIsBetter: true, unit: '점' },
    { key: 'avgDealInScore', label: '평균 방총 점수', value: d.avgDealInScore, higherIsBetter: false, unit: '점' },
    { key: 'drawRate', label: '유국률', value: d.drawRate, higherIsBetter: false, unit: '%' },
    { key: 'drawTenpaiRate', label: '유국 텐파이율', value: d.drawTenpaiRate, higherIsBetter: true, unit: '%' },
    { key: 'tobiRate', label: '토비율 (들통)', value: d.tobiRate, higherIsBetter: false, unit: '%' },
    { key: 'winEfficiency', label: '화료 효율', value: d.winEfficiency, higherIsBetter: true, unit: '' },
    { key: 'dealInLoss', label: '방총 손실', value: d.dealInLoss, higherIsBetter: false, unit: '' },
    { key: 'netWinEfficiency', label: '알짜 화료 효율', value: d.netWinEfficiency, higherIsBetter: true, unit: '' },
    { key: 'handEV', label: '국수지', value: d.handEV, higherIsBetter: true, unit: '점', customText: `${d.handEV > 0 ? '+' : ''}${Math.round(d.handEV).toLocaleString()}점` },
  ]);
});

const riichiStatCells = computed<PageStatCell[]>(() => {
  const d = selectedDetail.value;
  if (!d) return [];
  return buildStatCells([
    { key: 'riichiRate', label: '리치율', value: d.riichiRate, higherIsBetter: true, unit: '%' },
    { key: 'riichiWinRate', label: '리치 화료율', value: d.riichiWinRate, higherIsBetter: true, unit: '%' },
    { key: 'riichiDealInRate', label: '리치 방총률', value: d.riichiDealInRate, higherIsBetter: false, unit: '%' },
    { key: 'riichiDrawRate', label: '리치 유국률', value: d.riichiDrawRate, higherIsBetter: false, unit: '%' },
    { key: 'riichiEV', label: '리치 수지', value: d.riichiEV, higherIsBetter: true, unit: '점', customText: `${d.riichiEV > 0 ? '+' : ''}${Math.round(d.riichiEV).toLocaleString()}점` },
    { key: 'riichiIncomeAvg', label: '리치 수입 평균', value: d.riichiIncomeAvg, higherIsBetter: true, unit: '점' },
    { key: 'riichiExpenseAvg', label: '리치 지출 평균', value: d.riichiExpenseAvg, higherIsBetter: false, unit: '점' },
    { key: 'firstRiichiRate', label: '선제율', value: d.firstRiichiRate, higherIsBetter: true, unit: '%' },
    { key: 'chaseRiichiRate', label: '추격률', value: d.chaseRiichiRate, higherIsBetter: true, unit: '%' },
    { key: 'chasedRiichiRate', label: '피추격률', value: d.chasedRiichiRate, higherIsBetter: false, unit: '%' },
  ]);
});

const otherStatCells = computed<PageStatCell[]>(() => {
  const d = selectedDetail.value;
  if (!d) return [];
  return buildStatCells([
    { key: 'oyaKaburiRate', label: '아픈 오야카부리율', value: d.oyaKaburiRate, higherIsBetter: false, unit: '%' },
    { key: 'oyaKaburiAvg', label: '아픈 오야카부리 평균', value: d.oyaKaburiAvg, higherIsBetter: false, unit: '점' },
    { key: 'dealInRiichiRate', label: '방총 시 리치율', value: d.dealInRiichiRate, higherIsBetter: false, unit: '%' },
    {
      key: 'cheatRate',
      label: '촌보율',
      value: d.cheatRate,
      higherIsBetter: false,
      unit: '%',
      customText: formatPenaltyText(d.cheatRate, d.totalRounds, d.cheatCount),
    },
    {
      key: 'beolbuRate',
      label: '벌부율',
      value: d.beolbuRate,
      higherIsBetter: false,
      unit: '%',
      customText: formatPenaltyText(d.beolbuRate, d.totalRounds, d.beolbuCount),
    },
    { key: 'totalRounds', label: '총합 국 수', value: d.totalRounds, higherIsBetter: true, unit: '국' },
  ]);
});

const inspectedSection = computed<'basic' | 'riichi' | 'other' | null>(() => {
  const key = inspectedMetricKey.value;
  if (!key) return null;
  if (basicStatCells.value.some((c) => c.key === key)) return 'basic';
  if (riichiStatCells.value.some((c) => c.key === key)) return 'riichi';
  if (otherStatCells.value.some((c) => c.key === key)) return 'other';
  return null;
});

const scopedPlayerHistoryGames = computed<GameRatingHistoryRecord[]>(() => {
  if (!baseSelectedPlayer.value || !props.ratingHistory.length) return [];
  const normTarget = normalizeRatingPlayerName(baseSelectedPlayer.value.name);
  const playerGames = props.ratingHistory.filter((g) =>
    g.players.some((p) => normalizeRatingPlayerName(p.name) === normTarget)
  );

  if (playerScopeMode.value === 'all') return playerGames;

  if (playerScopeMode.value === 'recent_games') {
    const n = Math.max(1, Math.floor(Number(playerScopeRecentGames.value) || 10));
    return playerGames.slice(-n);
  }

  if (playerScopeMode.value === 'recent_sessions') {
    const n = Math.max(1, Math.floor(Number(playerScopeRecentSessions.value) || 3));
    const pickedNums = new Set(
      sortedSessionsDesc.value.slice(0, n).map((s) => parseSessionNumber(s)).filter((num) => num > 0)
    );
    return playerGames.filter((g) => pickedNums.has(parseSessionNumber(g.sessionLabel)));
  }

  if (playerScopeMode.value === 'session_range') {
    const sNum = parseSessionNumber(playerScopeStartSession.value);
    const eNum = parseSessionNumber(playerScopeEndSession.value);
    const minN = sNum > 0 && eNum > 0 ? Math.min(sNum, eNum) : Math.max(sNum, eNum);
    const maxN = sNum > 0 && eNum > 0 ? Math.max(sNum, eNum) : Math.max(sNum, eNum);
    return playerGames.filter((g) => {
      const num = parseSessionNumber(g.sessionLabel);
      return num >= minN && num <= maxN;
    });
  }

  if (playerScopeMode.value === 'date_range') {
    const sd = (playerScopeStartDate.value || '').trim();
    const ed = (playerScopeEndDate.value || '').trim();
    return playerGames.filter((g) => {
      const iso = resolveGameIsoDate(g);
      if (!iso) return false;
      if (sd && iso < sd) return false;
      if (ed && iso > ed) return false;
      return true;
    });
  }

  return playerGames;
});

const selectedPlayerOpponents = computed(() => {
  if (!selectedPlayer.value || scopedPlayerHistoryGames.value.length === 0) return [];
  return computeFrequentOpponentsStats(selectedPlayer.value.name, scopedPlayerHistoryGames.value).opponents.slice(0, 8);
});

const selectedPlayerGames = computed(() => {
  if (!selectedPlayer.value || scopedPlayerHistoryGames.value.length === 0) return [];
  const normTarget = normalizeRatingPlayerName(selectedPlayer.value.name);
  const matched = scopedPlayerHistoryGames.value
    .map((g) => {
      const me = g.players.find((p) => normalizeRatingPlayerName(p.name) === normTarget)!;
      return {
        gameIndex: g.gameIndex,
        sessionLabel: resolveGameSessionLabel(g),
        rawSessionLabel: g.sessionLabel,
        date: resolveGameIsoDate(g),
        myRank: me.rank,
        myScore: me.score,
        myUma: me.uma,
        myOrdinal: me.ordinal,
        myDelta: me.delta,
        players: g.players,
      };
    })
    .reverse();
  return showAllPlayerGames.value ? matched : matched.slice(0, 15);
});

const selectedPlayerTotalGamesCount = computed(() => scopedPlayerHistoryGames.value.length);

// 홈 화면 최근 대국 기록 미리보기 (항상 최신 회차 기준 12판)
const latestHomeGames = computed(() =>
  (props.ratingHistory || [])
    .slice(-12)
    .reverse()
    .map((g) => ({
      ...g,
      displaySession: resolveGameSessionLabel(g),
      displayDate: resolveGameIsoDate(g),
    }))
);

// ==========================================
// 2. 레이팅 구간별 데이터 (최근 N회 지정 / 회차 구간 / 일자 지정 + 최소 대국 / 최소 국 수)
// ==========================================
type RatingScopeMode = 'overall' | 'recent_sessions' | 'session_range' | 'date_range';
const ratingScopeMode = ref<RatingScopeMode>('overall');
const ratingRecentSessionsCount = ref<number>(5);
const ratingStartSession = ref<string>('');
const ratingEndSession = ref<string>('');
const ratingStartNum = ref<number>(1);
const ratingEndNum = ref<number>(1);
const ratingDateStart = ref<string>('');
const ratingDateEnd = ref<string>('');
const ratingMinGames = ref<number>(20);
const ratingMinRounds = ref<number>(0);
const ratingScopedMembers = ref<MemberStatItem[] | null>(null);
const isLoadingRatingScope = ref(false);
const expandedBandKey = ref<string | null>(null);

const initRatingScopeDefaults = () => {
  if (!ratingDateEnd.value && availableIsoDates.value.length > 0) {
    ratingDateEnd.value = availableIsoDates.value[0];
  }
  if (!ratingDateStart.value && availableIsoDates.value.length > 0) {
    ratingDateStart.value = availableIsoDates.value[Math.min(5, availableIsoDates.value.length - 1)];
  }
  if (!ratingEndSession.value && sortedSessionsDesc.value.length > 0) {
    ratingEndSession.value = sortedSessionsDesc.value[0];
    ratingEndNum.value = parseSessionNumber(sortedSessionsDesc.value[0]) || maxSessionNumber.value;
  }
  if (!ratingStartSession.value && sortedSessionsDesc.value.length > 0) {
    const startS = sortedSessionsDesc.value[Math.min(5, sortedSessionsDesc.value.length - 1)];
    ratingStartSession.value = startS;
    ratingStartNum.value = parseSessionNumber(startS) || 1;
  }
};

const syncRatingSessionNumsFromLabels = () => {
  const s = parseSessionNumber(ratingStartSession.value);
  const e = parseSessionNumber(ratingEndSession.value);
  if (s > 0) ratingStartNum.value = s;
  if (e > 0) ratingEndNum.value = e;
};

const applyRatingSessionNums = () => {
  const a = Math.max(1, Math.min(maxSessionNumber.value, Math.floor(Number(ratingStartNum.value) || 1)));
  const b = Math.max(1, Math.min(maxSessionNumber.value, Math.floor(Number(ratingEndNum.value) || maxSessionNumber.value)));
  ratingStartNum.value = Math.min(a, b);
  ratingEndNum.value = Math.max(a, b);
  ratingStartSession.value = resolveSessionLabelByNum(ratingStartNum.value);
  ratingEndSession.value = resolveSessionLabelByNum(ratingEndNum.value);
  loadRatingScopedData();
};

const loadRatingScopedData = async () => {
  if (ratingScopeMode.value === 'overall') {
    ratingScopedMembers.value = null;
    return;
  }
  initRatingScopeDefaults();
  isLoadingRatingScope.value = true;
  try {
    const res = await queryMemberStatsByFilter(
      ratingScopeMode.value === 'recent_sessions'
        ? { mode: 'recent_sessions', recentSessions: Math.max(1, Math.floor(Number(ratingRecentSessionsCount.value) || 5)), minGames: 0 }
        : ratingScopeMode.value === 'session_range'
          ? { mode: 'session_range', startSession: ratingStartSession.value, endSession: ratingEndSession.value, minGames: 0 }
          : { mode: 'date_range', startDate: ratingDateStart.value, endDate: ratingDateEnd.value, minGames: 0 },
      {
        allStats: props.allStats,
        availableSessions: props.availableSessions,
      }
    );
    ratingScopedMembers.value = res.members;
  } catch (e) {
    console.warn('loadRatingScopedData failed:', e);
    ratingScopedMembers.value = null;
  } finally {
    isLoadingRatingScope.value = false;
  }
};

const setRatingScopeMode = (mode: RatingScopeMode) => {
  ratingScopeMode.value = mode;
  // 단기 기간/회차 구간 조회 전환 시 20전 필터로 비어 보이지 않도록 자동 완화, 전체 기간 복귀 시 기본 20회
  if (mode === 'overall') {
    if (ratingMinGames.value === 0) ratingMinGames.value = 20;
  } else if (ratingMinGames.value >= 20) {
    ratingMinGames.value = 0;
  }
  initRatingScopeDefaults();
  loadRatingScopedData();
};

interface RatingBandRow {
  key: string;
  label: string;
  color: string;
  minR: number;
  maxR: number;
  playerCount: number;
  players: MemberStatItem[];
  totalGames: number;
  totalRounds: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  tobiRate: number;
  avgRank: number;
  winRate: number;
  dealInRate: number;
  riichiRate: number;
  tsumoRate: number;
  drawRate: number;
  drawTenpaiRate: number;
  avgWinScore: number;
  avgDealInScore: number;
  winEfficiency: number;
  dealInLoss: number;
  netWinEfficiency: number;
  handEV: number;
  riichiWinRate: number;
  riichiDealInRate: number;
  riichiEV: number;
  firstRiichiRate: number;
}

const RATING_BANDS = [
  { key: '1800+', label: '1800+', minR: 1800, maxR: 99999, sampleR: 1850 },
  { key: '1700', label: '1700 ~ 1799', minR: 1700, maxR: 1799, sampleR: 1750 },
  { key: '1600', label: '1600 ~ 1699', minR: 1600, maxR: 1699, sampleR: 1650 },
  { key: '1500', label: '1500 ~ 1599', minR: 1500, maxR: 1599, sampleR: 1550 },
  { key: '1400', label: '1400 ~ 1499', minR: 1400, maxR: 1499, sampleR: 1450 },
  { key: '1300', label: '1300 ~ 1399', minR: 1300, maxR: 1399, sampleR: 1350 },
  { key: '1200', label: '1200 ~ 1299', minR: 1200, maxR: 1299, sampleR: 1250 },
  { key: 'below1200', label: '1200 미만', minR: -99999, maxR: 1199, sampleR: 1150 },
];

const aggregateBand = (
  key: string,
  label: string,
  color: string,
  minR: number,
  maxR: number,
  members: MemberStatItem[]
): RatingBandRow => {
  let totalGames = 0;
  let r1 = 0, r2 = 0, r3 = 0, r4 = 0;
  let rankWeightedSum = 0;

  let totalRounds = 0;
  let detGames = 0;
  let tobiWeighted = 0;
  let winWeighted = 0;
  let dealInWeighted = 0;
  let riichiWeighted = 0;
  let tsumoWeighted = 0;
  let drawWeighted = 0;
  let drawTenpaiWeighted = 0;
  let avgWinScoreW = 0;
  let avgDealInScoreW = 0;
  let winEffW = 0;
  let dealInLossW = 0;
  let netWinEffW = 0;
  let handEVW = 0;
  let riichiWinW = 0;
  let riichiDealInW = 0;
  let riichiEVW = 0;
  let firstRiichiW = 0;

  for (const m of members) {
    const g = m.totalGames || 0;
    totalGames += g;
    r1 += m.rank1Count || 0;
    r2 += m.rank2Count || 0;
    r3 += m.rank3Count || 0;
    r4 += m.rank4Count || 0;
    rankWeightedSum += (m.avgRank || 0) * g;

    const d = m.detailedStats || m;
    const rnd = d.totalRounds || 0;
    const dg = d.totalGames || 0;
    if (rnd > 0) {
      totalRounds += rnd;
      detGames += dg;
      tobiWeighted += (d.tobiRate || 0) * dg;
      winWeighted += (d.winRate || 0) * rnd;
      dealInWeighted += (d.dealInRate || 0) * rnd;
      riichiWeighted += (d.riichiRate || 0) * rnd;
      tsumoWeighted += (d.tsumoRate || 0) * rnd;
      drawWeighted += (d.drawRate || 0) * rnd;
      drawTenpaiWeighted += (d.drawTenpaiRate || 0) * rnd;
      avgWinScoreW += (d.avgWinScore || 0) * rnd;
      avgDealInScoreW += (d.avgDealInScore || 0) * rnd;
      winEffW += (d.winEfficiency || 0) * rnd;
      dealInLossW += (d.dealInLoss || 0) * rnd;
      netWinEffW += (d.netWinEfficiency || 0) * rnd;
      handEVW += (d.handEV || 0) * rnd;
      riichiWinW += (d.riichiWinRate || 0) * rnd;
      riichiDealInW += (d.riichiDealInRate || 0) * rnd;
      riichiEVW += (d.riichiEV || 0) * rnd;
      firstRiichiW += (d.firstRiichiRate || 0) * rnd;
    }
  }

  const rankTot = r1 + r2 + r3 + r4;
  return {
    key,
    label,
    color,
    minR,
    maxR,
    playerCount: members.length,
    players: [...members].sort((a, b) => (b.rating || 0) - (a.rating || 0)),
    totalGames,
    totalRounds,
    p1: rankTot > 0 ? (r1 / rankTot) * 100 : 0,
    p2: rankTot > 0 ? (r2 / rankTot) * 100 : 0,
    p3: rankTot > 0 ? (r3 / rankTot) * 100 : 0,
    p4: rankTot > 0 ? (r4 / rankTot) * 100 : 0,
    tobiRate: detGames > 0 ? tobiWeighted / detGames : 0,
    avgRank: totalGames > 0 ? rankWeightedSum / totalGames : 0,
    winRate: totalRounds > 0 ? winWeighted / totalRounds : 0,
    dealInRate: totalRounds > 0 ? dealInWeighted / totalRounds : 0,
    riichiRate: totalRounds > 0 ? riichiWeighted / totalRounds : 0,
    tsumoRate: totalRounds > 0 ? tsumoWeighted / totalRounds : 0,
    drawRate: totalRounds > 0 ? drawWeighted / totalRounds : 0,
    drawTenpaiRate: totalRounds > 0 ? drawTenpaiWeighted / totalRounds : 0,
    avgWinScore: totalRounds > 0 ? avgWinScoreW / totalRounds : 0,
    avgDealInScore: totalRounds > 0 ? avgDealInScoreW / totalRounds : 0,
    winEfficiency: totalRounds > 0 ? winEffW / totalRounds : 0,
    dealInLoss: totalRounds > 0 ? dealInLossW / totalRounds : 0,
    netWinEfficiency: totalRounds > 0 ? netWinEffW / totalRounds : 0,
    handEV: totalRounds > 0 ? handEVW / totalRounds : 0,
    riichiWinRate: totalRounds > 0 ? riichiWinW / totalRounds : 0,
    riichiDealInRate: totalRounds > 0 ? riichiDealInW / totalRounds : 0,
    riichiEV: totalRounds > 0 ? riichiEVW / totalRounds : 0,
    firstRiichiRate: totalRounds > 0 ? firstRiichiW / totalRounds : 0,
  };
};

// 선택한 기간/회차 종료 시점의 각 플레이어 최후 레이팅 맵 계산
const ratingAtEndOfScopeMap = computed<Map<string, number> | null>(() => {
  if (ratingScopeMode.value === 'overall') return null;
  const hist = props.ratingHistory || [];
  if (hist.length === 0) return null;

  let cutoffSessionNum: number | null = null;
  let cutoffDate: string | null = null;

  if (ratingScopeMode.value === 'date_range') {
    cutoffDate = (ratingDateEnd.value || '').trim() || null;
  } else if (ratingScopeMode.value === 'session_range') {
    const sNum = parseSessionNumber(ratingStartSession.value);
    const eNum = parseSessionNumber(ratingEndSession.value);
    const maxN = Math.max(sNum, eNum);
    if (maxN > 0) cutoffSessionNum = maxN;
  } else if (ratingScopeMode.value === 'recent_sessions') {
    const latestSess = sortedSessionsDesc.value[0];
    const latestNum = parseSessionNumber(latestSess);
    if (latestNum > 0) cutoffSessionNum = latestNum;
  }

  const lastOrdByNorm = new Map<string, number>();
  for (const g of hist) {
    if (cutoffDate) {
      const iso = resolveGameIsoDate(g);
      if (iso && iso > cutoffDate) continue;
    }
    if (cutoffSessionNum !== null) {
      const gSess = parseSessionNumber(g.sessionLabel);
      if (gSess > 0 && gSess > cutoffSessionNum) continue;
    }
    for (const p of g.players || []) {
      const norm = normalizeRatingPlayerName(p.name);
      if (!norm) continue;
      if (typeof p.ordinal === 'number' && !isNaN(p.ordinal) && p.ordinal > 0) {
        lastOrdByNorm.set(norm, p.ordinal);
      }
    }
  }
  return lastOrdByNorm;
});

const ratingBasisDescription = computed<string>(() => {
  if (ratingScopeMode.value === 'overall') return '현재 최신 레이팅 기준';
  if (ratingScopeMode.value === 'date_range' && ratingDateEnd.value) {
    return `${ratingDateEnd.value} 종료 시점 최후 레이팅 기준`;
  }
  if (ratingScopeMode.value === 'session_range' && ratingEndSession.value) {
    return `${ratingEndSession.value} 종료 시점 최후 레이팅 기준`;
  }
  return '조회 기간 종료 시점 최후 레이팅 기준';
});

const ratingSourceMembers = computed<MemberStatItem[]>(() => {
  const base = ratingScopedMembers.value !== null ? ratingScopedMembers.value : props.allStats;
  const minG = Math.max(0, Math.floor(Number(ratingMinGames.value) || 0));
  const minR = Math.max(0, Math.floor(Number(ratingMinRounds.value) || 0));
  const cutoffMap = ratingAtEndOfScopeMap.value;

  return (base || [])
    .map((m) => {
      if (!cutoffMap) return m;
      const histR = cutoffMap.get(normalizeRatingPlayerName(m.name));
      return histR !== undefined ? { ...m, rating: histR } : m;
    })
    .filter(
      (m) =>
        typeof m.rating === 'number' &&
        (m.totalGames || 0) >= minG &&
        getMemberRounds(m) >= minR
    );
});

const ratingBandRows = computed<RatingBandRow[]>(() => {
  const rows: RatingBandRow[] = [];
  for (const b of RATING_BANDS) {
    const matched = ratingSourceMembers.value.filter((m) => {
      const r = Math.round(m.rating || 0);
      return r >= b.minR && r <= b.maxR;
    });
    if (matched.length > 0) {
      rows.push(aggregateBand(b.key, b.label, getRatingColor(b.sampleR), b.minR, b.maxR, matched));
    }
  }
  return rows;
});

const ratingOverallSummaryRow = computed<RatingBandRow>(() =>
  aggregateBand('all', '전체 평균', '#64748b', -99999, 99999, ratingSourceMembers.value)
);

const totalBandRecordedGames = computed(() =>
  Math.round(ratingSourceMembers.value.reduce((s, m) => s + (m.totalGames || 0), 0) / 4)
);

// ==========================================
// 3. 자리별 순위 (東 / 南 / 西 / 北 - 최근 N회 지정 / 회차 구간 / 일자 지정)
// ==========================================
type SeatScopeMode = 'all' | 'recent_sessions' | 'session_range' | 'date_range';
const seatScopeMode = ref<SeatScopeMode>('all');
const seatRecentSessionsCount = ref<number>(5);
const seatStartSession = ref<string>('');
const seatEndSession = ref<string>('');
const seatStartNum = ref<number>(9);
const seatEndNum = ref<number>(1);
const seatStartDate = ref<string>('');
const seatEndDate = ref<string>('');
const seatPlayerFilter = ref<string>('');
const seatStatsResult = ref<SeatRankStatsResult | null>(null);
const isLoadingSeatStats = ref(false);

// 개인 페이지 내 해당 플레이어의 시작 자리별 순위 통계
const playerSeatStatsResult = ref<SeatRankStatsResult | null>(null);
const isLoadingPlayerSeatStats = ref(false);

const initSeatScopeDefaults = () => {
  if (!seatEndDate.value && availableIsoDates.value.length > 0) {
    seatEndDate.value = availableIsoDates.value[0];
  }
  if (!seatStartDate.value && availableIsoDates.value.length > 0) {
    seatStartDate.value = availableIsoDates.value[Math.min(5, availableIsoDates.value.length - 1)];
  }
  if (!seatEndSession.value && sortedSessionsDesc.value.length > 0) {
    seatEndSession.value = sortedSessionsDesc.value[0];
    seatEndNum.value = parseSessionNumber(sortedSessionsDesc.value[0]) || maxSessionNumber.value;
  }
  if (!seatStartSession.value && sortedSessionsDesc.value.length > 0) {
    const startS = sortedSessionsDesc.value[Math.min(5, sortedSessionsDesc.value.length - 1)];
    seatStartSession.value = startS;
    seatStartNum.value = Math.max(9, parseSessionNumber(startS) || 9);
  }
};

const syncSeatSessionNumsFromLabels = () => {
  const s = parseSessionNumber(seatStartSession.value);
  const e = parseSessionNumber(seatEndSession.value);
  if (s > 0) seatStartNum.value = s;
  if (e > 0) seatEndNum.value = e;
};

const applySeatSessionNums = () => {
  const a = Math.max(1, Math.min(maxSessionNumber.value, Math.floor(Number(seatStartNum.value) || 9)));
  const b = Math.max(1, Math.min(maxSessionNumber.value, Math.floor(Number(seatEndNum.value) || maxSessionNumber.value)));
  seatStartNum.value = Math.min(a, b);
  seatEndNum.value = Math.max(a, b);
  seatStartSession.value = resolveSessionLabelByNum(seatStartNum.value);
  seatEndSession.value = resolveSessionLabelByNum(seatEndNum.value);
  loadSeatStats();
};

const loadSeatStats = async () => {
  initSeatScopeDefaults();
  isLoadingSeatStats.value = true;
  try {
    seatStatsResult.value = await fetchSeatRankStats({
      recentSessions:
        seatScopeMode.value === 'recent_sessions'
          ? Math.max(1, Math.floor(Number(seatRecentSessionsCount.value) || 5))
          : undefined,
      startSession: seatScopeMode.value === 'session_range' ? seatStartSession.value : undefined,
      endSession: seatScopeMode.value === 'session_range' ? seatEndSession.value : undefined,
      startDate: seatScopeMode.value === 'date_range' ? seatStartDate.value : undefined,
      endDate: seatScopeMode.value === 'date_range' ? seatEndDate.value : undefined,
      playerName: seatPlayerFilter.value || undefined,
      availableSessions: props.availableSessions,
    });
  } catch (e) {
    console.warn('loadSeatStats failed:', e);
  } finally {
    isLoadingSeatStats.value = false;
  }
};

const loadPlayerSeatStats = async () => {
  const player = baseSelectedPlayer.value;
  if (!player) {
    playerSeatStatsResult.value = null;
    return;
  }
  isLoadingPlayerSeatStats.value = true;
  try {
    playerSeatStatsResult.value = await fetchSeatRankStats({
      playerName: player.name,
      recentGames:
        playerScopeMode.value === 'recent_games'
          ? Math.max(1, Math.floor(Number(playerScopeRecentGames.value) || 10))
          : undefined,
      recentSessions:
        playerScopeMode.value === 'recent_sessions'
          ? Math.max(1, Math.floor(Number(playerScopeRecentSessions.value) || 3))
          : undefined,
      startSession: playerScopeMode.value === 'session_range' ? playerScopeStartSession.value : undefined,
      endSession: playerScopeMode.value === 'session_range' ? playerScopeEndSession.value : undefined,
      startDate: playerScopeMode.value === 'date_range' ? playerScopeStartDate.value : undefined,
      endDate: playerScopeMode.value === 'date_range' ? playerScopeEndDate.value : undefined,
      availableSessions: props.availableSessions,
    });
  } catch (e) {
    console.warn('loadPlayerSeatStats failed:', e);
  } finally {
    isLoadingPlayerSeatStats.value = false;
  }
};

const openSeatTabForPlayer = (playerName: string) => {
  seatPlayerFilter.value = playerName;
  activeSubTab.value = 'by-seat';
  loadSeatStats();
};

const setSeatScopeMode = (mode: SeatScopeMode) => {
  seatScopeMode.value = mode;
  loadSeatStats();
};

watch(activeSubTab, (tab) => {
  if (tab === 'by-seat') {
    loadSeatStats();
  }
});

watch(
  [
    () => baseSelectedPlayer.value?.name,
    playerScopeMode,
    playerScopeRecentGames,
    playerScopeRecentSessions,
    playerScopeStartSession,
    playerScopeEndSession,
    playerScopeStartDate,
    playerScopeEndDate,
  ],
  () => {
    if (baseSelectedPlayer.value) {
      loadPlayerSeatStats();
    } else {
      playerSeatStatsResult.value = null;
    }
  },
  { immediate: true }
);

// ==========================================
// 4. 대국 기록 (최신 / 일자 선택 / 일자 기간 / 최근 N회차 / 회차 구간 / 특정 회차)
// ==========================================
type GamesLogFilterMode = 'latest' | 'date' | 'date_range' | 'recent_sessions' | 'session_range' | 'session';
const gamesLogMode = ref<GamesLogFilterMode>('latest');
const selectedLogDate = ref<string>('');
const logStartDate = ref<string>('');
const logEndDate = ref<string>('');
const logRecentSessionsCount = ref<number>(3);
const logStartSession = ref<string>('');
const logEndSession = ref<string>('');
const logStartNum = ref<number>(1);
const logEndNum = ref<number>(1);
const selectedLogSession = ref<string>('');

const syncLogSessionNumsFromLabels = () => {
  const s = parseSessionNumber(logStartSession.value);
  const e = parseSessionNumber(logEndSession.value);
  if (s > 0) logStartNum.value = s;
  if (e > 0) logEndNum.value = e;
};

const applyLogSessionNums = () => {
  const a = Math.max(1, Math.min(maxSessionNumber.value, Math.floor(Number(logStartNum.value) || 1)));
  const b = Math.max(1, Math.min(maxSessionNumber.value, Math.floor(Number(logEndNum.value) || maxSessionNumber.value)));
  logStartNum.value = Math.min(a, b);
  logEndNum.value = Math.max(a, b);
  logStartSession.value = resolveSessionLabelByNum(logStartNum.value);
  logEndSession.value = resolveSessionLabelByNum(logEndNum.value);
};

watch(
  availableIsoDates,
  (dates) => {
    if (dates.length > 0) {
      if (!selectedLogDate.value) selectedLogDate.value = dates[0];
      if (!logEndDate.value) logEndDate.value = dates[0];
      if (!logStartDate.value) logStartDate.value = dates[Math.min(4, dates.length - 1)];
    }
  },
  { immediate: true }
);

watch(
  sortedSessionsDesc,
  (sessions) => {
    if (sessions.length > 0) {
      if (!selectedLogSession.value) selectedLogSession.value = sessions[0];
      if (!logEndSession.value) {
        logEndSession.value = sessions[0];
        logEndNum.value = parseSessionNumber(sessions[0]) || maxSessionNumber.value;
      }
      if (!logStartSession.value) {
        const startS = sessions[Math.min(4, sessions.length - 1)];
        logStartSession.value = startS;
        logStartNum.value = parseSessionNumber(startS) || 1;
      }
    }
  },
  { immediate: true }
);

const filteredLogGames = computed(() => {
  const list = (props.ratingHistory || []).map((g) => ({
    ...g,
    displaySession: resolveGameSessionLabel(g),
    displayDate: resolveGameIsoDate(g),
    sessNum: parseSessionNumber(g.sessionLabel),
  }));

  if (gamesLogMode.value === 'latest') {
    return list.slice(-40).reverse();
  }

  if (gamesLogMode.value === 'date') {
    if (!selectedLogDate.value) return list.slice(-40).reverse();
    return list.filter((g) => g.displayDate === selectedLogDate.value).reverse();
  }

  if (gamesLogMode.value === 'date_range') {
    const sd = (logStartDate.value || '').trim();
    const ed = (logEndDate.value || '').trim();
    return list
      .filter((g) => {
        if (!g.displayDate) return false;
        if (sd && g.displayDate < sd) return false;
        if (ed && g.displayDate > ed) return false;
        return true;
      })
      .reverse();
  }

  if (gamesLogMode.value === 'recent_sessions') {
    const n = Math.max(1, Math.floor(Number(logRecentSessionsCount.value) || 3));
    const pickedNums = new Set(
      sortedSessionsDesc.value.slice(0, n).map((s) => parseSessionNumber(s)).filter((num) => num > 0)
    );
    return list.filter((g) => pickedNums.has(g.sessNum)).reverse();
  }

  if (gamesLogMode.value === 'session_range') {
    const sNum = parseSessionNumber(logStartSession.value);
    const eNum = parseSessionNumber(logEndSession.value);
    const minN = sNum > 0 && eNum > 0 ? Math.min(sNum, eNum) : Math.max(sNum, eNum);
    const maxN = sNum > 0 && eNum > 0 ? Math.max(sNum, eNum) : Math.max(sNum, eNum);
    return list.filter((g) => g.sessNum >= minN && g.sessNum <= maxN).reverse();
  }

  if (gamesLogMode.value === 'session') {
    const targetNum = parseSessionNumber(selectedLogSession.value);
    return list
      .filter((g) => (targetNum > 0 ? g.sessNum === targetNum : g.displaySession === selectedLogSession.value))
      .reverse();
  }

  return list.slice(-40).reverse();
});

const openSessionInGamesLog = (sessionLabel: string) => {
  selectedLogSession.value = sessionLabel;
  gamesLogMode.value = 'session';
  activeSubTab.value = 'games';
};

// ==========================================
// 5. 기록 플레이어 수 (회차 단위로 정확히 묶어서 표기 + 최소 국 수 옵션)
// ==========================================
const playersCountMinRounds = ref<number>(0);

const playersCountFilteredMembers = computed<MemberStatItem[]>(() => {
  const minR = Math.max(0, Math.floor(Number(playersCountMinRounds.value) || 0));
  if (minR <= 0) return props.allStats || [];
  return (props.allStats || []).filter((m) => getMemberRounds(m) >= minR);
});

const playersCountBandRows = computed<RatingBandRow[]>(() => {
  const rated = playersCountFilteredMembers.value.filter((m) => typeof m.rating === 'number');
  const rows: RatingBandRow[] = [];
  for (const b of RATING_BANDS) {
    const matched = rated.filter((m) => {
      const r = Math.round(m.rating || 0);
      return r >= b.minR && r <= b.maxR;
    });
    if (matched.length > 0) {
      rows.push(aggregateBand(b.key, b.label, getRatingColor(b.sampleR), b.minR, b.maxR, matched));
    }
  }
  return rows;
});

const maxPlayersCountBand = computed(() =>
  Math.max(1, ...playersCountBandRows.value.map((b) => b.playerCount))
);

// 회차 번호(sessNum) 단위로 그룹화 ("제26회 1회전"~"제26회 8회전" -> "제26회 261121" 1행으로 통합!)
const sessionParticipationRows = computed(() => {
  const map = new Map<
    string,
    { sessionLabel: string; sessNum: number; date: string; gameCount: number; players: Set<string> }
  >();
  for (const g of props.ratingHistory || []) {
    const sessNum = parseSessionNumber(g.sessionLabel);
    const key = sessNum > 0 ? `sess_${sessNum}` : resolveGameSessionLabel(g);
    let entry = map.get(key);
    if (!entry) {
      entry = {
        sessionLabel: resolveGameSessionLabel(g),
        sessNum,
        date: resolveGameIsoDate(g),
        gameCount: 0,
        players: new Set<string>(),
      };
      map.set(key, entry);
    }
    entry.gameCount++;
    for (const p of g.players || []) {
      if (p.name) entry.players.add(normalizeRatingPlayerName(p.name));
    }
  }
  return Array.from(map.values())
    .map((e) => ({
      sessionLabel: e.sessionLabel,
      sessNum: e.sessNum,
      date: e.date,
      gameCount: e.gameCount,
      playerCount: e.players.size,
    }))
    .sort((a, b) => b.sessNum - a.sessNum);
});

const averageLeagueRating = computed(() => {
  const rated = playersCountFilteredMembers.value.filter(
    (m) => typeof m.rating === 'number' && m.totalGames > 0
  );
  if (rated.length === 0) return 0;
  return Math.round(rated.reduce((s, m) => s + (m.rating || 0), 0) / rated.length);
});

const totalDetailedRoundsAll = computed(() =>
  Math.round(playersCountFilteredMembers.value.reduce((s, m) => s + getMemberRounds(m), 0) / 4)
);

// ==========================================
// 6. 최근 고타점 방총 (사람마다 누가 누구에게 쏘였는지)
// ==========================================
const allHighScoreDealIns = ref<HighScoreDealInRecord[]>([]);
const isLoadingDealIns = ref(false);
const hasLoadedDealIns = ref(false);

const playerDealInTab = ref<'lost' | 'won'>('lost');
const playerDealInMinScore = ref<number>(8000);

const dealInMinScore = ref<number>(8000);
const dealInRoleFilter = ref<'all' | 'loser' | 'winner'>('all');
const dealInPlayerFilter = ref<string>('');
const dealInScopeMode = ref<'all' | 'recent_sessions' | 'session_range' | 'date_range'>('all');
const dealInRecentSessions = ref<number>(5);
const dealInStartNum = ref<number>(9);
const dealInEndNum = ref<number>(1);
const dealInStartDate = ref<string>('');
const dealInEndDate = ref<string>('');

const loadHighScoreDealIns = async (force = false) => {
  if (hasLoadedDealIns.value && !force) return;
  isLoadingDealIns.value = true;
  try {
    allHighScoreDealIns.value = await fetchHighScoreDealIns({
      minScore: 8000,
      availableSessions: props.availableSessions,
      allStats: props.allStats,
    });
    hasLoadedDealIns.value = true;
  } catch (e) {
    console.warn('loadHighScoreDealIns failed:', e);
  } finally {
    isLoadingDealIns.value = false;
  }
};

watch(
  [activeSubTab, selectedPlayerName],
  ([tab, pName]) => {
    if (tab === 'deal-ins' || (tab === 'player' && pName)) {
      loadHighScoreDealIns();
    }
  },
  { immediate: true }
);

watch(
  [sortedSessionsDesc, availableIsoDates],
  () => {
    if (dealInEndNum.value <= 1 && maxSessionNumber.value > 1) {
      dealInEndNum.value = maxSessionNumber.value;
      dealInStartNum.value = Math.max(9, maxSessionNumber.value - 5);
    }
    if (!dealInEndDate.value && availableIsoDates.value.length > 0) {
      dealInEndDate.value = availableIsoDates.value[0];
      dealInStartDate.value = availableIsoDates.value[Math.min(5, availableIsoDates.value.length - 1)];
    }
  },
  { immediate: true }
);

const getDealInTierBadge = (score: number): { text: string; cls: string } => {
  if (score >= 32000) return { text: '32000+', cls: 'tier-yakuman' };
  if (score >= 24000) return { text: '24000+', cls: 'tier-sanbaiman' };
  if (score >= 16000) return { text: '16000+', cls: 'tier-baiman' };
  if (score >= 12000) return { text: '12000+', cls: 'tier-haneman' };
  return { text: '8000+', cls: 'tier-mangan' };
};

// 개인 페이지 내 해당 플레이어 고타점 방총 필터링
const scopedPlayerDealInsBase = computed<HighScoreDealInRecord[]>(() => {
  if (!baseSelectedPlayer.value) return [];
  const normMe = normalizeRatingPlayerName(baseSelectedPlayer.value.name);
  const minS = playerDealInMinScore.value;
  let list = allHighScoreDealIns.value.filter(
    (d) =>
      d.score >= minS &&
      (normalizeRatingPlayerName(d.loserName) === normMe || normalizeRatingPlayerName(d.winnerName) === normMe)
  );

  if (playerScopeMode.value === 'recent_sessions') {
    const n = Math.max(1, Math.floor(Number(playerScopeRecentSessions.value) || 3));
    const picked = new Set(sortedSessionsDesc.value.slice(0, n).map((s) => parseSessionNumber(s)));
    list = list.filter((d) => picked.has(d.sessNum));
  } else if (playerScopeMode.value === 'session_range') {
    const minN = Math.min(playerScopeStartNum.value, playerScopeEndNum.value);
    const maxN = Math.max(playerScopeStartNum.value, playerScopeEndNum.value);
    list = list.filter((d) => d.sessNum >= minN && d.sessNum <= maxN);
  } else if (playerScopeMode.value === 'date_range') {
    const sd = (playerScopeStartDate.value || '').trim();
    const ed = (playerScopeEndDate.value || '').trim();
    list = list.filter((d) => {
      if (!d.date) return false;
      if (sd && d.date < sd) return false;
      if (ed && d.date > ed) return false;
      return true;
    });
  }
  return list;
});

const selectedPlayerLostDealIns = computed(() => {
  if (!baseSelectedPlayer.value) return [];
  const normMe = normalizeRatingPlayerName(baseSelectedPlayer.value.name);
  return scopedPlayerDealInsBase.value.filter((d) => normalizeRatingPlayerName(d.loserName) === normMe);
});

const selectedPlayerWonDealIns = computed(() => {
  if (!baseSelectedPlayer.value) return [];
  const normMe = normalizeRatingPlayerName(baseSelectedPlayer.value.name);
  return scopedPlayerDealInsBase.value.filter((d) => normalizeRatingPlayerName(d.winnerName) === normMe);
});

const selectedPlayerDealInSummaryChips = computed(() => {
  const list = playerDealInTab.value === 'lost' ? selectedPlayerLostDealIns.value : selectedPlayerWonDealIns.value;
  const counts = new Map<string, { name: string; count: number; totalScore: number }>();
  for (const d of list) {
    const other = playerDealInTab.value === 'lost' ? d.winnerName : d.loserName;
    const prev = counts.get(other) || { name: other, count: 0, totalScore: 0 };
    prev.count++;
    prev.totalScore += d.score;
    counts.set(other, prev);
  }
  return Array.from(counts.values())
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : b.totalScore - a.totalScore))
    .slice(0, 6);
});

// 전체 고타점 방총 서브탭 필터링
const filteredGlobalDealIns = computed<HighScoreDealInRecord[]>(() => {
  let list = allHighScoreDealIns.value.filter((d) => d.score >= dealInMinScore.value);

  if (dealInScopeMode.value === 'recent_sessions') {
    const n = Math.max(1, Math.floor(Number(dealInRecentSessions.value) || 5));
    const picked = new Set(sortedSessionsDesc.value.slice(0, n).map((s) => parseSessionNumber(s)));
    list = list.filter((d) => picked.has(d.sessNum));
  } else if (dealInScopeMode.value === 'session_range') {
    const minN = Math.min(dealInStartNum.value, dealInEndNum.value);
    const maxN = Math.max(dealInStartNum.value, dealInEndNum.value);
    list = list.filter((d) => d.sessNum >= minN && d.sessNum <= maxN);
  } else if (dealInScopeMode.value === 'date_range') {
    const sd = (dealInStartDate.value || '').trim();
    const ed = (dealInEndDate.value || '').trim();
    list = list.filter((d) => {
      if (!d.date) return false;
      if (sd && d.date < sd) return false;
      if (ed && d.date > ed) return false;
      return true;
    });
  }

  const pFilter = dealInPlayerFilter.value.trim();
  if (pFilter) {
    const normP = normalizeRatingPlayerName(pFilter);
    list = list.filter((d) => {
      const isLoser = normalizeRatingPlayerName(d.loserName) === normP;
      const isWinner = normalizeRatingPlayerName(d.winnerName) === normP;
      if (dealInRoleFilter.value === 'loser') return isLoser;
      if (dealInRoleFilter.value === 'winner') return isWinner;
      return isLoser || isWinner;
    });
  }
  return list;
});

const highScoreDealInPlayerSummary = computed(() => {
  const map = new Map<
    string,
    {
      name: string;
      lostCount: number;
      lostSum: number;
      maxLost: number;
      wonCount: number;
      wonSum: number;
      attackers: Map<string, number>;
    }
  >();
  const ensure = (name: string) => {
    let e = map.get(name);
    if (!e) {
      e = { name, lostCount: 0, lostSum: 0, maxLost: 0, wonCount: 0, wonSum: 0, attackers: new Map() };
      map.set(name, e);
    }
    return e;
  };
  for (const d of filteredGlobalDealIns.value) {
    const l = ensure(d.loserName);
    l.lostCount++;
    l.lostSum += d.score;
    if (d.score > l.maxLost) l.maxLost = d.score;
    l.attackers.set(d.winnerName, (l.attackers.get(d.winnerName) || 0) + 1);

    const w = ensure(d.winnerName);
    w.wonCount++;
    w.wonSum += d.score;
  }
  return Array.from(map.values())
    .map((e) => {
      let topAttacker = '-';
      let topAttackerCnt = 0;
      for (const [att, cnt] of e.attackers.entries()) {
        if (cnt > topAttackerCnt) {
          topAttacker = att;
          topAttackerCnt = cnt;
        }
      }
      return {
        name: e.name,
        lostCount: e.lostCount,
        lostAvg: e.lostCount > 0 ? Math.round(e.lostSum / e.lostCount) : 0,
        maxLost: e.maxLost,
        wonCount: e.wonCount,
        topAttacker,
        topAttackerCnt,
      };
    })
    .sort((a, b) => (b.lostCount !== a.lostCount ? b.lostCount - a.lostCount : b.maxLost - a.maxLost));
});

onMounted(() => {
  if (activeSubTab.value === 'by-seat') {
    loadSeatStats();
  } else if (activeSubTab.value === 'deal-ins') {
    loadHighScoreDealIns();
  }
});
</script>

<template>
  <div class="stat-page-root" :class="{ dark: isDark }">
    <!-- 상단 서브 내비게이션 -->
    <div class="sp-subnav">
      <button
        type="button"
        class="sp-subnav-btn"
        :class="{ active: activeSubTab === 'player' }"
        @click="activeSubTab = 'player'"
      >
        플레이어 검색
      </button>
      <button
        type="button"
        class="sp-subnav-btn"
        :class="{ active: activeSubTab === 'by-rating' }"
        @click="activeSubTab = 'by-rating'"
      >
        레이팅 구간별 데이터
      </button>
      <button
        type="button"
        class="sp-subnav-btn"
        :class="{ active: activeSubTab === 'by-seat' }"
        @click="activeSubTab = 'by-seat'"
      >
        자리별 순위
      </button>
      <button
        type="button"
        class="sp-subnav-btn"
        :class="{ active: activeSubTab === 'deal-ins' }"
        @click="activeSubTab = 'deal-ins'"
      >
        고타점 방총
      </button>
      <button
        type="button"
        class="sp-subnav-btn"
        :class="{ active: activeSubTab === 'games' }"
        @click="activeSubTab = 'games'"
      >
        대국 기록
      </button>
      <button
        type="button"
        class="sp-subnav-btn"
        :class="{ active: activeSubTab === 'players-count' }"
        @click="activeSubTab = 'players-count'"
      >
        기록 플레이어 수
      </button>
    </div>

    <!-- ===================================================== -->
    <!-- SUB-TAB 1: 플레이어 검색 (페이지 형식 개인 스탯)       -->
    <!-- ===================================================== -->
    <div v-if="activeSubTab === 'player'" class="sp-section">
      <div class="sp-search-card">
        <div class="sp-search-header">
          <h3 class="sp-heading">플레이어 검색</h3>
          <span class="sp-sub-hint">닉네임을 입력하거나 선택하면 페이지 형식으로 전체 스탯을 바로 확인할 수 있습니다.</span>
        </div>

        <div class="sp-autocomplete-wrap">
          <div class="sp-input-box">
            <svg class="sp-search-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              v-model="searchInput"
              type="text"
              class="sp-search-input"
              placeholder="플레이어 이름 입력..."
              autocomplete="off"
              @focus="isDropdownOpen = true; highlightedIdx = 0"
              @input="isDropdownOpen = true; highlightedIdx = 0"
              @keydown="onSearchKeydown"
              @blur="onSearchBlur"
            />
            <button
              v-if="searchInput"
              type="button"
              class="sp-clear-btn"
              title="지우기"
              @click="clearSelectedPlayer"
            >
              ✕
            </button>
          </div>

          <div v-if="isDropdownOpen && autocompleteCandidates.length > 0" class="sp-dropdown">
            <button
              v-for="(m, idx) in autocompleteCandidates"
              :key="m.name"
              type="button"
              class="sp-dropdown-item"
              :class="{ highlighted: idx === highlightedIdx, selected: selectedPlayerName === m.name }"
              @mousedown.prevent="selectPlayer(m.name)"
            >
              <span class="sp-dd-name">{{ m.name }}</span>
              <span class="sp-dd-meta">
                <span v-if="m.rating" class="sp-dd-rating" :style="{ color: getRatingColor(m.rating) }">
                  R{{ Math.round(m.rating) }}
                </span>
                <span :class="m.totalUma >= 0 ? 'pos' : 'neg'">
                  {{ m.totalUma > 0 ? '+' : '' }}{{ m.totalUma.toFixed(1) }}pt
                </span>
                <span>{{ m.totalGames }}전 · {{ getMemberRounds(m) }}국</span>
              </span>
            </button>
          </div>
        </div>

        <!-- 분포 기준 총 대국수 N회 이상 (기본 20회) -->
        <div class="sp-min-rounds-row">
          <span class="sp-quick-lbl">분포 기준 (총 대국수):</span>
          <button
            v-for="mg in [0, 10, 20, 30, 50]"
            :key="'pmg-' + mg"
            type="button"
            class="sp-chip-filter"
            :class="{ active: playerTabMinGames === mg }"
            @click="playerTabMinGames = mg"
          >
            {{ mg === 0 ? '전체' : `${mg}회 이상` }}
          </button>
          <div class="sp-inline-num-wrap">
            <input
              v-model.number="playerTabMinGames"
              type="number"
              min="0"
              max="500"
              class="sp-num-input compact"
              aria-label="분포 기준 최소 총 대국수 직접 입력"
            />
            <span class="sp-unit-lbl">회 이상 (비교 대상 {{ qualifiedMembersForDistCount }}명)</span>
          </div>
        </div>

        <!-- N국 이상 필터 옵션 (별도 옵션) -->
        <div class="sp-min-rounds-row">
          <span class="sp-quick-lbl">최소 국 수 필터:</span>
          <button
            v-for="mr in [0, 50, 100, 200, 300]"
            :key="'pmr-' + mr"
            type="button"
            class="sp-chip-filter"
            :class="{ active: playerTabMinRounds === mr }"
            @click="playerTabMinRounds = mr"
          >
            {{ mr === 0 ? '전체' : `${mr}국 이상` }}
          </button>
          <div class="sp-inline-num-wrap">
            <input
              v-model.number="playerTabMinRounds"
              type="number"
              min="0"
              step="10"
              class="sp-num-input compact"
              aria-label="최소 국 수 직접 입력"
            />
            <span class="sp-unit-lbl">국 이상 ({{ qualifiedMembersForSearch.length }}명)</span>
          </div>
        </div>

        <!-- 빠른 선택 칩 -->
        <div class="sp-quick-players">
          <span class="sp-quick-lbl">빠른 선택:</span>
          <button
            v-for="m in qualifiedMembersForSearch.slice(0, 12)"
            :key="'q-' + m.name"
            type="button"
            class="sp-quick-chip"
            :class="{ active: selectedPlayerName === m.name }"
            @click="selectPlayer(m.name)"
          >
            {{ m.name }}
            <span v-if="m.rating" class="sp-chip-r" :style="{ color: selectedPlayerName === m.name ? '#fff' : getRatingColor(m.rating) }">
              R{{ Math.round(m.rating) }}
            </span>
          </button>
        </div>
      </div>

      <!-- 선택된 플레이어 풀페이지 스탯 뷰 -->
      <div v-if="baseSelectedPlayer" class="sp-player-page">
        <!-- 개인별 기간 / 구간 필터 카드 -->
        <div class="sp-player-scope-card">
          <div class="sp-scope-top-row">
            <div class="sp-scope-title-wrap">
              <span class="sp-scope-badge">개인 스탯 조회 조건</span>
              <span v-if="isPlayerScopeActive && playerScopeResult" class="sp-scope-active-label">
                {{ playerScopeResult.summaryLabel }}
                <template v-if="selectedPlayer">
                  ({{ selectedPlayer.totalGames }}전<template v-if="selectedDetail && selectedDetail.totalRounds > 0"> · {{ selectedDetail.totalRounds.toLocaleString() }}국</template>)
                </template>
              </span>
              <span v-if="!isPlayerScopeActive && playerTabMinGames > 0" class="sp-scope-sub-pill">
                분포 비교 기준: 총 {{ playerTabMinGames }}회 이상 ({{ activePlayerScopeMembers.length }}명)
              </span>
              <span v-if="playerTabMinRounds > 0" class="sp-scope-sub-pill">
                {{ playerTabMinRounds }}국 이상 ({{ activePlayerScopeMembers.length }}명)
              </span>
            </div>
            <button
              v-if="playerScopeMode !== 'all'"
              type="button"
              class="sp-mini-toggle"
              @click="resetPlayerScope"
            >
              전체 기간으로 초기화
            </button>
          </div>

          <div class="sp-scope-modes">
            <button type="button" class="sp-chip-filter" :class="{ active: playerScopeMode === 'all' }" @click="setPlayerScopeMode('all')">
              전체 기간
            </button>
            <button type="button" class="sp-chip-filter" :class="{ active: playerScopeMode === 'recent_games' }" @click="setPlayerScopeMode('recent_games')">
              최근 N전
            </button>
            <button type="button" class="sp-chip-filter" :class="{ active: playerScopeMode === 'recent_sessions' }" @click="setPlayerScopeMode('recent_sessions')">
              최근 N회차
            </button>
            <button type="button" class="sp-chip-filter" :class="{ active: playerScopeMode === 'date_range' }" @click="setPlayerScopeMode('date_range')">
              일자 기간
            </button>
            <button type="button" class="sp-chip-filter" :class="{ active: playerScopeMode === 'session_range' }" @click="setPlayerScopeMode('session_range')">
              회차 구간
            </button>
          </div>

          <div v-if="playerScopeMode === 'recent_games'" class="sp-scope-controls">
            <div class="sp-scope-presets">
              <button
                v-for="n in [5, 10, 20, 30, 50]"
                :key="'rg-' + n"
                type="button"
                class="sp-quick-chip"
                :class="{ active: playerScopeRecentGames === n }"
                @click="playerScopeRecentGames = n; runPlayerScopeQuery()"
              >
                최근 {{ n }}전
              </button>
            </div>
            <div class="sp-scope-inline-input">
              <span>직접 입력:</span>
              <input v-model.number="playerScopeRecentGames" type="number" min="1" max="500" class="sp-num-input" @keyup.enter="runPlayerScopeQuery" />
              <span>전</span>
              <button type="button" class="sp-action-btn primary" @click="runPlayerScopeQuery">조회</button>
            </div>
          </div>

          <div v-else-if="playerScopeMode === 'recent_sessions'" class="sp-scope-controls">
            <div class="sp-scope-presets">
              <button
                v-for="n in [1, 3, 5, 10]"
                :key="'rs-' + n"
                type="button"
                class="sp-quick-chip"
                :class="{ active: playerScopeRecentSessions === n }"
                @click="playerScopeRecentSessions = n; runPlayerScopeQuery()"
              >
                최근 {{ n }}회차
              </button>
            </div>
            <div class="sp-scope-inline-input">
              <span>직접 입력:</span>
              <input v-model.number="playerScopeRecentSessions" type="number" min="1" :max="Math.max(1, sortedSessionsDesc.length)" class="sp-num-input" @keyup.enter="runPlayerScopeQuery" />
              <span>회차</span>
              <button type="button" class="sp-action-btn primary" @click="runPlayerScopeQuery">조회</button>
            </div>
          </div>

          <div v-else-if="playerScopeMode === 'date_range'" class="sp-scope-controls">
            <div class="sp-scope-presets">
              <button type="button" class="sp-quick-chip" @click="setPlayerScopeDatePresetDays(30)">최근 30일</button>
              <button type="button" class="sp-quick-chip" @click="setPlayerScopeDatePresetDays(90)">최근 90일</button>
              <button type="button" class="sp-quick-chip" @click="setPlayerScopeDatePresetDays(180)">최근 180일</button>
            </div>
            <div class="sp-scope-inline-input">
              <input v-model="playerScopeStartDate" type="date" class="sp-date-input" />
              <span>~</span>
              <input v-model="playerScopeEndDate" type="date" class="sp-date-input" />
              <button type="button" class="sp-action-btn primary" @click="runPlayerScopeQuery">조회</button>
            </div>
          </div>

          <div v-else-if="playerScopeMode === 'session_range'" class="sp-scope-controls">
            <div class="sp-scope-inline-input">
              <input v-model.number="playerScopeStartNum" type="number" min="1" :max="maxSessionNumber" class="sp-num-input compact" @keyup.enter="applyPlayerSessionNums" />
              <span>회차 ~</span>
              <input v-model.number="playerScopeEndNum" type="number" min="1" :max="maxSessionNumber" class="sp-num-input compact" @keyup.enter="applyPlayerSessionNums" />
              <span>회차</span>
              <button type="button" class="sp-action-btn primary" @click="applyPlayerSessionNums">조회</button>
            </div>
            <div class="sp-scope-inline-input">
              <select v-model="playerScopeStartSession" class="sp-select-box" @change="syncPlayerSessionNumsFromLabels(); runPlayerScopeQuery()">
                <option v-for="s in sortedSessionsAsc" :key="'ps-' + s" :value="s">{{ s }}</option>
              </select>
              <span>~</span>
              <select v-model="playerScopeEndSession" class="sp-select-box" @change="syncPlayerSessionNumsFromLabels(); runPlayerScopeQuery()">
                <option v-for="s in sortedSessionsDesc" :key="'pe-' + s" :value="s">{{ s }}</option>
              </select>
            </div>
          </div>
        </div>

        <div v-if="isLoadingPlayerScope" class="sp-loading-box">
          {{ baseSelectedPlayer.name }}님의 조건별 스탯을 집계하는 중입니다...
        </div>

        <div v-else-if="isSelectedPlayerEmptyInScope" class="sp-card sp-empty-scope-box">
          <p>
            <strong>{{ baseSelectedPlayer.name }}</strong>님은 선택한 조회 조건(<strong>{{ playerScopeResult?.summaryLabel }}</strong>)에 출전한 대국 기록이 없습니다.
          </p>
          <button type="button" class="sp-action-btn primary" @click="resetPlayerScope">
            전체 기간 스탯 보기
          </button>
        </div>

        <template v-else-if="selectedPlayer && selectedDetail">
          <!-- 프로필 요약 배너 -->
          <div class="sp-profile-banner">
            <div class="sp-profile-left">
              <div class="sp-profile-title-row">
                <span class="sp-rank-pill">#{{ selectedOverallRank }}</span>
                <h2 class="sp-player-name">{{ selectedPlayer.name }}</h2>
                <span
                  v-if="selectedPlayer.rating"
                  class="sp-rating-pill"
                  :style="{ color: getRatingColor(selectedPlayer.rating), borderColor: getRatingColor(selectedPlayer.rating) }"
                >
                  R{{ Math.round(selectedPlayer.rating) }}
                </span>
                <span
                  v-if="selectedPlayerStableRating"
                  class="sp-stable-pill"
                  :style="{ color: getRatingColor(selectedPlayerStableRating.stableRating), borderColor: getRatingColor(selectedPlayerStableRating.stableRating) }"
                  :title="`평균 상대 R${selectedPlayerStableRating.avgOpponentRating} + 40 × 평균우마(${selectedPlayerStableRating.avgUma > 0 ? '+' : ''}${selectedPlayerStableRating.avgUma.toFixed(1)}pt) 기준 무한 대국 수렴치`"
                >
                  안정 R{{ selectedPlayerStableRating.stableRating }}
                </span>
                <span v-if="selectedPlayer.ratingPeak" class="sp-peak-note">
                  최고 R{{ Math.round(selectedPlayer.ratingPeak) }}
                </span>
              </div>
              <div class="sp-profile-kpi-row">
                <div
                  class="sp-kpi"
                  v-if="selectedPlayerStableRating"
                  :title="`현재 조회 성적 비율(평균우마 ${selectedPlayerStableRating.avgUma > 0 ? '+' : ''}${selectedPlayerStableRating.avgUma.toFixed(1)}pt, 평균 상대 R${selectedPlayerStableRating.avgOpponentRating})로 무한히 대국 시 수렴하는 안정 레이팅`"
                >
                  <span class="kpi-lbl">안정 레이팅</span>
                  <strong class="kpi-val" :style="{ color: getRatingColor(selectedPlayerStableRating.stableRating) }">
                    R{{ selectedPlayerStableRating.stableRating }}
                    <span
                      v-if="selectedPlayer.rating"
                      class="delta-mini"
                      :class="(selectedPlayerStableRating.stableRating - selectedPlayer.rating) >= 0 ? 'pos' : 'neg'"
                    >
                      ({{ (selectedPlayerStableRating.stableRating - selectedPlayer.rating) >= 0 ? '+' : '' }}{{ selectedPlayerStableRating.stableRating - Math.round(selectedPlayer.rating) }})
                    </span>
                  </strong>
                </div>
                <div class="sp-kpi">
                  <span class="kpi-lbl">누적 우마</span>
                  <strong class="kpi-val" :class="selectedPlayer.totalUma >= 0 ? 'pos' : 'neg'">
                    {{ selectedPlayer.totalUma > 0 ? '+' : '' }}{{ selectedPlayer.totalUma.toFixed(1) }}pt
                  </strong>
                </div>
                <div class="sp-kpi">
                  <span class="kpi-lbl">평균 우마</span>
                  <strong class="kpi-val" :class="selectedPlayer.avgUma >= 0 ? 'pos' : 'neg'">
                    {{ selectedPlayer.avgUma > 0 ? '+' : '' }}{{ selectedPlayer.avgUma.toFixed(1) }}pt
                  </strong>
                </div>
                <div class="sp-kpi">
                  <span class="kpi-lbl">평균 순위</span>
                  <strong class="kpi-val">{{ selectedPlayer.avgRank.toFixed(3) }}위</strong>
                </div>
                <div class="sp-kpi">
                  <span class="kpi-lbl">대국 수</span>
                  <strong class="kpi-val">{{ selectedPlayer.totalGames }}전</strong>
                </div>
                <div class="sp-kpi">
                  <span class="kpi-lbl">연대율</span>
                  <strong class="kpi-val">{{ selectedPlayer.top2Rate.toFixed(2) }}%</strong>
                </div>
                <div class="sp-kpi" v-if="selectedRankDist.total > 0">
                  <span class="kpi-lbl">라스 회피율</span>
                  <strong class="kpi-val">{{ (100 - selectedRankDist.p4).toFixed(2) }}%</strong>
                </div>
              </div>
            </div>

            <div class="sp-profile-actions">
              <button type="button" class="sp-action-btn primary" @click="emit('open-compare', selectedPlayer.name)">
                VS 비교
              </button>
              <button type="button" class="sp-action-btn" @click="emit('open-popup', selectedPlayer.name)">
                팝업으로 보기
              </button>
            </div>
          </div>

          <!-- 1~4위 순위 분포 바 -->
          <div class="sp-card" v-if="selectedRankDist.total > 0">
            <div class="sp-card-header">
              <h4>순위 분포 ({{ selectedRankDist.total }}전)</h4>
            </div>
            <div class="sp-rank-stacked-bar">
              <div class="seg s1" :style="{ width: selectedRankDist.p1 + '%' }" v-if="selectedRankDist.p1 > 0">
                <span v-if="selectedRankDist.p1 >= 10">1위 {{ selectedRankDist.p1.toFixed(1) }}%</span>
              </div>
              <div class="seg s2" :style="{ width: selectedRankDist.p2 + '%' }" v-if="selectedRankDist.p2 > 0">
                <span v-if="selectedRankDist.p2 >= 10">2위 {{ selectedRankDist.p2.toFixed(1) }}%</span>
              </div>
              <div class="seg s3" :style="{ width: selectedRankDist.p3 + '%' }" v-if="selectedRankDist.p3 > 0">
                <span v-if="selectedRankDist.p3 >= 10">3위 {{ selectedRankDist.p3.toFixed(1) }}%</span>
              </div>
              <div class="seg s4" :style="{ width: selectedRankDist.p4 + '%' }" v-if="selectedRankDist.p4 > 0">
                <span v-if="selectedRankDist.p4 >= 10">4위 {{ selectedRankDist.p4.toFixed(1) }}%</span>
              </div>
            </div>
            <div class="sp-rank-legend">
              <span><i class="dot s1"></i> 1위 {{ selectedRankDist.p1.toFixed(2) }}% ({{ selectedRankDist.r1 }}회)</span>
              <span><i class="dot s2"></i> 2위 {{ selectedRankDist.p2.toFixed(2) }}% ({{ selectedRankDist.r2 }}회)</span>
              <span><i class="dot s3"></i> 3위 {{ selectedRankDist.p3.toFixed(2) }}% ({{ selectedRankDist.r3 }}회)</span>
              <span><i class="dot s4"></i> 4위 {{ selectedRankDist.p4.toFixed(2) }}% ({{ selectedRankDist.r4 }}회)</span>
            </div>
          </div>

          <div class="sp-stat-notice" v-if="!hasSelectedDetail">
            ※ 제9회 이후 국별 세부 기록이 없는 플레이어(또는 구간)입니다. 종합 대국 기록(우마·순위·레이팅)만 집계됩니다.
          </div>

          <!-- 1. 기본 스탯 -->
          <div class="sp-stat-section-card">
            <div class="sp-card-header">
              <h4>기본 · 공격 / 수비 스탯</h4>
              <span class="sp-card-sub">각 스탯 클릭 시 이 박스 아래에 분포 히스토그램이 펼쳐집니다</span>
            </div>
            <div class="sp-metrics-grid">
              <button
                v-for="cell in basicStatCells"
                :key="cell.key"
                type="button"
                class="sp-metric-tile"
                :class="{ inspected: inspectedMetricKey === cell.key }"
                @click="toggleInspectMetric(cell.key, cell.label, cell.value, cell.higherIsBetter, cell.unit)"
              >
                <div class="tile-top">
                  <span class="tile-label">{{ cell.label }}</span>
                  <span v-if="!cell.isUnrecorded && cell.topPctText !== '-'" class="tile-pct" :class="cell.isUpperHalf ? 'pos' : 'neg'">
                    {{ cell.topPctText }}
                  </span>
                </div>
                <div class="tile-bottom">
                  <span class="tile-value">{{ cell.displayText }}</span>
                  <span class="tile-chevron">{{ inspectedMetricKey === cell.key ? '▴' : '▾' }}</span>
                </div>
              </button>
            </div>
          </div>
          <div
            v-if="inspectedSection === 'basic' && inspectedDistribution && inspectedMetricMeta"
            class="sp-tile-hist-drawer"
          >
            <div class="sp-drawer-header">
              <div class="sp-dist-title-group">
                <strong>{{ inspectedMetricMeta.label }} 분포</strong>
                <span
                  v-if="!inspectedDistribution.isUnrecorded"
                  class="sp-pct-badge"
                  :class="inspectedDistribution.isUpperHalf ? 'pos' : 'neg'"
                >
                  상위 {{ inspectedDistribution.topPct.toFixed(2) }}% ({{ inspectedDistribution.rank }}위 / {{ inspectedDistribution.totalCount }}명)
                </span>
                <span v-if="!isPlayerScopeActive && playerTabMinGames > 0" class="sp-drawer-scope">
                  총 {{ playerTabMinGames }}회 이상 기준
                </span>
              </div>
              <button type="button" class="sp-mini-close" @click.stop="inspectedMetricKey = null">닫기 ✕</button>
            </div>
            <div class="sp-inline-hist-wrap">
              <svg viewBox="0 0 160 46" class="sp-inline-svg" preserveAspectRatio="none">
                <rect
                  v-for="(bar, idx) in inspectedDistribution.bars"
                  :key="'b-ib-' + idx"
                  :x="bar.x"
                  :y="bar.y"
                  :width="bar.width"
                  :height="bar.height"
                  :fill="
                    hoveredInlineBar && hoveredInlineBar.playerName === bar.playerName
                      ? '#f59e0b'
                      : bar.isCurrent
                        ? '#3b82f6'
                        : 'rgba(160,160,160,0.45)'
                  "
                  rx="1"
                />
                <polygon
                  v-for="(bar, idx) in inspectedDistribution.bars"
                  :key="'b-pin-' + idx"
                  v-show="bar.isCurrent"
                  :points="`${bar.x + bar.width/2},${Math.max(2, bar.y - 1)} ${bar.x + bar.width/2 - 2.2},${Math.max(0, bar.y - 5)} ${bar.x + bar.width/2 + 2.2},${Math.max(0, bar.y - 5)}`"
                  fill="#3b82f6"
                />
                <line :x1="inspectedDistribution.line30X" y1="0" :x2="inspectedDistribution.line30X" y2="46" stroke="rgba(160,160,160,0.4)" stroke-width="1" stroke-dasharray="2,2" />
                <line x1="80" y1="0" x2="80" y2="46" stroke="rgba(200,200,200,0.65)" stroke-width="1.3" stroke-dasharray="3,2" />
                <line :x1="inspectedDistribution.line70X" y1="0" :x2="inspectedDistribution.line70X" y2="46" stroke="rgba(160,160,160,0.4)" stroke-width="1" stroke-dasharray="2,2" />
                <!-- 레이팅 구간별 평균치 실선 -->
                <line
                  v-for="band in inspectedDistribution.ratingBandAverages"
                  :key="'dr-rband-' + band.key"
                  v-show="drawerSelectedBandKey === 'all' || drawerSelectedBandKey === band.key"
                  :x1="band.x"
                  y1="1"
                  :x2="band.x"
                  y2="45"
                  :stroke="band.color"
                  :stroke-width="drawerSelectedBandKey === band.key ? 2.2 : 1.35"
                  :stroke-opacity="drawerSelectedBandKey === band.key ? 1 : 0.85"
                  pointer-events="none"
                />
                <rect
                  v-for="(bar, idx) in inspectedDistribution.bars"
                  :key="'b-ihit-' + idx"
                  class="sp-bar-hit"
                  :x="bar.x"
                  y="0"
                  :width="Math.max(bar.width, 2.5)"
                  height="46"
                  fill="transparent"
                  @mouseenter="hoveredInlineBar = bar"
                  @mouseleave="hoveredInlineBar = null"
                  @click.stop="selectPlayer(bar.playerName)"
                >
                  <title>{{ bar.playerName }}: {{ formatMetricVal(bar.value, inspectedMetricMeta.label, inspectedMetricMeta.unit) }}</title>
                </rect>
              </svg>
            </div>
            <div class="sp-inline-hist-footer">
              <span>최소 {{ formatMetricVal(inspectedDistribution.min, inspectedMetricMeta.label, inspectedMetricMeta.unit) }}</span>
              <span class="sp-inline-hover-mid">
                <template v-if="hoveredInlineBar">
                  <strong>{{ hoveredInlineBar.playerName }}</strong> ·
                  {{ formatMetricVal(hoveredInlineBar.value, inspectedMetricMeta.label, inspectedMetricMeta.unit) }} (클릭하여 이동 ↗)
                </template>
                <template v-else>
                  평균 {{ formatMetricVal(inspectedDistribution.avg, inspectedMetricMeta.label, inspectedMetricMeta.unit) }} · 막대 클릭 시 해당 플레이어로 이동
                </template>
              </span>
              <span>최대 {{ formatMetricVal(inspectedDistribution.max, inspectedMetricMeta.label, inspectedMetricMeta.unit) }}</span>
            </div>
            <!-- 레이팅 구간별 평균치 실선 선택 칩 -->
            <div v-if="inspectedDistribution.ratingBandAverages && inspectedDistribution.ratingBandAverages.length > 0" class="sp-drawer-rbands">
              <span class="sp-rband-lbl">구간별 평균 실선:</span>
              <button
                type="button"
                class="sp-rband-chip"
                :class="{ active: drawerSelectedBandKey === 'all' }"
                @click.stop="drawerSelectedBandKey = 'all'"
              >
                전체 구간
              </button>
              <button
                v-for="band in inspectedDistribution.ratingBandAverages"
                :key="'dr-chip-' + band.key"
                type="button"
                class="sp-rband-chip"
                :class="{ active: drawerSelectedBandKey === band.key }"
                :style="{ '--rb-color': band.color }"
                @click.stop="toggleDrawerBand(band.key)"
                :title="`${band.label} 평균 (${band.count}명)`"
              >
                <span class="sp-rb-dash" :style="{ borderColor: band.color }"></span>
                <strong :style="{ color: band.color }">{{ band.label }}</strong>
                <span>{{ formatMetricVal(band.avg, inspectedMetricMeta.label, inspectedMetricMeta.unit) }}</span>
                <span class="muted-mini">({{ band.count }})</span>
              </button>
            </div>
          </div>

          <!-- 2. 리치 스탯 -->
          <div class="sp-stat-section-card">
            <div class="sp-card-header">
              <h4>리치 스탯</h4>
              <span class="sp-card-sub">스탯 클릭 시 이 박스 아래에 분포 히스토그램이 펼쳐집니다</span>
            </div>
            <div class="sp-metrics-grid">
              <button
                v-for="cell in riichiStatCells"
                :key="cell.key"
                type="button"
                class="sp-metric-tile"
                :class="{ inspected: inspectedMetricKey === cell.key }"
                @click="toggleInspectMetric(cell.key, cell.label, cell.value, cell.higherIsBetter, cell.unit)"
              >
                <div class="tile-top">
                  <span class="tile-label">{{ cell.label }}</span>
                  <span v-if="!cell.isUnrecorded && cell.topPctText !== '-'" class="tile-pct" :class="cell.isUpperHalf ? 'pos' : 'neg'">
                    {{ cell.topPctText }}
                  </span>
                </div>
                <div class="tile-bottom">
                  <span class="tile-value">{{ cell.displayText }}</span>
                  <span class="tile-chevron">{{ inspectedMetricKey === cell.key ? '▴' : '▾' }}</span>
                </div>
              </button>
            </div>
          </div>
          <div
            v-if="inspectedSection === 'riichi' && inspectedDistribution && inspectedMetricMeta"
            class="sp-tile-hist-drawer"
          >
            <div class="sp-drawer-header">
              <div class="sp-dist-title-group">
                <strong>{{ inspectedMetricMeta.label }} 분포</strong>
                <span
                  v-if="!inspectedDistribution.isUnrecorded"
                  class="sp-pct-badge"
                  :class="inspectedDistribution.isUpperHalf ? 'pos' : 'neg'"
                >
                  상위 {{ inspectedDistribution.topPct.toFixed(2) }}% ({{ inspectedDistribution.rank }}위 / {{ inspectedDistribution.totalCount }}명)
                </span>
                <span v-if="!isPlayerScopeActive && playerTabMinGames > 0" class="sp-drawer-scope">
                  총 {{ playerTabMinGames }}회 이상 기준
                </span>
              </div>
              <button type="button" class="sp-mini-close" @click.stop="inspectedMetricKey = null">닫기 ✕</button>
            </div>
            <div class="sp-inline-hist-wrap">
              <svg viewBox="0 0 160 46" class="sp-inline-svg" preserveAspectRatio="none">
                <rect
                  v-for="(bar, idx) in inspectedDistribution.bars"
                  :key="'r-ib-' + idx"
                  :x="bar.x"
                  :y="bar.y"
                  :width="bar.width"
                  :height="bar.height"
                  :fill="
                    hoveredInlineBar && hoveredInlineBar.playerName === bar.playerName
                      ? '#f59e0b'
                      : bar.isCurrent
                        ? '#3b82f6'
                        : 'rgba(160,160,160,0.45)'
                  "
                  rx="1"
                />
                <polygon
                  v-for="(bar, idx) in inspectedDistribution.bars"
                  :key="'r-pin-' + idx"
                  v-show="bar.isCurrent"
                  :points="`${bar.x + bar.width/2},${Math.max(2, bar.y - 1)} ${bar.x + bar.width/2 - 2.2},${Math.max(0, bar.y - 5)} ${bar.x + bar.width/2 + 2.2},${Math.max(0, bar.y - 5)}`"
                  fill="#3b82f6"
                />
                <line :x1="inspectedDistribution.line30X" y1="0" :x2="inspectedDistribution.line30X" y2="46" stroke="rgba(160,160,160,0.4)" stroke-width="1" stroke-dasharray="2,2" />
                <line x1="80" y1="0" x2="80" y2="46" stroke="rgba(200,200,200,0.65)" stroke-width="1.3" stroke-dasharray="3,2" />
                <line :x1="inspectedDistribution.line70X" y1="0" :x2="inspectedDistribution.line70X" y2="46" stroke="rgba(160,160,160,0.4)" stroke-width="1" stroke-dasharray="2,2" />
                <!-- 레이팅 구간별 평균치 실선 -->
                <line
                  v-for="band in inspectedDistribution.ratingBandAverages"
                  :key="'dr-rband-' + band.key"
                  v-show="drawerSelectedBandKey === 'all' || drawerSelectedBandKey === band.key"
                  :x1="band.x"
                  y1="1"
                  :x2="band.x"
                  y2="45"
                  :stroke="band.color"
                  :stroke-width="drawerSelectedBandKey === band.key ? 2.2 : 1.35"
                  :stroke-opacity="drawerSelectedBandKey === band.key ? 1 : 0.85"
                  pointer-events="none"
                />
                <rect
                  v-for="(bar, idx) in inspectedDistribution.bars"
                  :key="'r-ihit-' + idx"
                  class="sp-bar-hit"
                  :x="bar.x"
                  y="0"
                  :width="Math.max(bar.width, 2.5)"
                  height="46"
                  fill="transparent"
                  @mouseenter="hoveredInlineBar = bar"
                  @mouseleave="hoveredInlineBar = null"
                  @click.stop="selectPlayer(bar.playerName)"
                >
                  <title>{{ bar.playerName }}: {{ formatMetricVal(bar.value, inspectedMetricMeta.label, inspectedMetricMeta.unit) }}</title>
                </rect>
              </svg>
            </div>
            <div class="sp-inline-hist-footer">
              <span>최소 {{ formatMetricVal(inspectedDistribution.min, inspectedMetricMeta.label, inspectedMetricMeta.unit) }}</span>
              <span class="sp-inline-hover-mid">
                <template v-if="hoveredInlineBar">
                  <strong>{{ hoveredInlineBar.playerName }}</strong> ·
                  {{ formatMetricVal(hoveredInlineBar.value, inspectedMetricMeta.label, inspectedMetricMeta.unit) }} (클릭하여 이동 ↗)
                </template>
                <template v-else>
                  평균 {{ formatMetricVal(inspectedDistribution.avg, inspectedMetricMeta.label, inspectedMetricMeta.unit) }} · 막대 클릭 시 해당 플레이어로 이동
                </template>
              </span>
              <span>최대 {{ formatMetricVal(inspectedDistribution.max, inspectedMetricMeta.label, inspectedMetricMeta.unit) }}</span>
            </div>
            <!-- 레이팅 구간별 평균치 실선 선택 칩 -->
            <div v-if="inspectedDistribution.ratingBandAverages && inspectedDistribution.ratingBandAverages.length > 0" class="sp-drawer-rbands">
              <span class="sp-rband-lbl">구간별 평균 실선:</span>
              <button
                type="button"
                class="sp-rband-chip"
                :class="{ active: drawerSelectedBandKey === 'all' }"
                @click.stop="drawerSelectedBandKey = 'all'"
              >
                전체 구간
              </button>
              <button
                v-for="band in inspectedDistribution.ratingBandAverages"
                :key="'dr-chip-' + band.key"
                type="button"
                class="sp-rband-chip"
                :class="{ active: drawerSelectedBandKey === band.key }"
                :style="{ '--rb-color': band.color }"
                @click.stop="toggleDrawerBand(band.key)"
                :title="`${band.label} 평균 (${band.count}명)`"
              >
                <span class="sp-rb-dash" :style="{ borderColor: band.color }"></span>
                <strong :style="{ color: band.color }">{{ band.label }}</strong>
                <span>{{ formatMetricVal(band.avg, inspectedMetricMeta.label, inspectedMetricMeta.unit) }}</span>
                <span class="muted-mini">({{ band.count }})</span>
              </button>
            </div>
          </div>

          <!-- 3. 기타 스탯 -->
          <div class="sp-stat-section-card">
            <div class="sp-card-header">
              <h4>기타 스탯</h4>
              <span class="sp-card-sub">스탯 클릭 시 이 박스 아래에 분포 히스토그램이 펼쳐집니다</span>
            </div>
            <div class="sp-metrics-grid">
              <button
                v-for="cell in otherStatCells"
                :key="cell.key"
                type="button"
                class="sp-metric-tile"
                :class="{ inspected: inspectedMetricKey === cell.key }"
                @click="toggleInspectMetric(cell.key, cell.label, cell.value, cell.higherIsBetter, cell.unit)"
              >
                <div class="tile-top">
                  <span class="tile-label">{{ cell.label }}</span>
                  <span v-if="!cell.isUnrecorded && cell.topPctText !== '-'" class="tile-pct" :class="cell.isUpperHalf ? 'pos' : 'neg'">
                    {{ cell.topPctText }}
                  </span>
                </div>
                <div class="tile-bottom">
                  <span class="tile-value">{{ cell.displayText }}</span>
                  <span class="tile-chevron">{{ inspectedMetricKey === cell.key ? '▴' : '▾' }}</span>
                </div>
              </button>
            </div>
          </div>
          <div
            v-if="inspectedSection === 'other' && inspectedDistribution && inspectedMetricMeta"
            class="sp-tile-hist-drawer"
          >
            <div class="sp-drawer-header">
              <div class="sp-dist-title-group">
                <strong>{{ inspectedMetricMeta.label }} 분포</strong>
                <span
                  v-if="!inspectedDistribution.isUnrecorded"
                  class="sp-pct-badge"
                  :class="inspectedDistribution.isUpperHalf ? 'pos' : 'neg'"
                >
                  상위 {{ inspectedDistribution.topPct.toFixed(2) }}% ({{ inspectedDistribution.rank }}위 / {{ inspectedDistribution.totalCount }}명)
                </span>
                <span v-if="!isPlayerScopeActive && playerTabMinGames > 0" class="sp-drawer-scope">
                  총 {{ playerTabMinGames }}회 이상 기준
                </span>
              </div>
              <button type="button" class="sp-mini-close" @click.stop="inspectedMetricKey = null">닫기 ✕</button>
            </div>
            <div class="sp-inline-hist-wrap">
              <svg viewBox="0 0 160 46" class="sp-inline-svg" preserveAspectRatio="none">
                <rect
                  v-for="(bar, idx) in inspectedDistribution.bars"
                  :key="'o-ib-' + idx"
                  :x="bar.x"
                  :y="bar.y"
                  :width="bar.width"
                  :height="bar.height"
                  :fill="
                    hoveredInlineBar && hoveredInlineBar.playerName === bar.playerName
                      ? '#f59e0b'
                      : bar.isCurrent
                        ? '#3b82f6'
                        : 'rgba(160,160,160,0.45)'
                  "
                  rx="1"
                />
                <polygon
                  v-for="(bar, idx) in inspectedDistribution.bars"
                  :key="'o-pin-' + idx"
                  v-show="bar.isCurrent"
                  :points="`${bar.x + bar.width/2},${Math.max(2, bar.y - 1)} ${bar.x + bar.width/2 - 2.2},${Math.max(0, bar.y - 5)} ${bar.x + bar.width/2 + 2.2},${Math.max(0, bar.y - 5)}`"
                  fill="#3b82f6"
                />
                <line :x1="inspectedDistribution.line30X" y1="0" :x2="inspectedDistribution.line30X" y2="46" stroke="rgba(160,160,160,0.4)" stroke-width="1" stroke-dasharray="2,2" />
                <line x1="80" y1="0" x2="80" y2="46" stroke="rgba(200,200,200,0.65)" stroke-width="1.3" stroke-dasharray="3,2" />
                <line :x1="inspectedDistribution.line70X" y1="0" :x2="inspectedDistribution.line70X" y2="46" stroke="rgba(160,160,160,0.4)" stroke-width="1" stroke-dasharray="2,2" />
                <!-- 레이팅 구간별 평균치 실선 -->
                <line
                  v-for="band in inspectedDistribution.ratingBandAverages"
                  :key="'dr-rband-' + band.key"
                  v-show="drawerSelectedBandKey === 'all' || drawerSelectedBandKey === band.key"
                  :x1="band.x"
                  y1="1"
                  :x2="band.x"
                  y2="45"
                  :stroke="band.color"
                  :stroke-width="drawerSelectedBandKey === band.key ? 2.2 : 1.35"
                  :stroke-opacity="drawerSelectedBandKey === band.key ? 1 : 0.85"
                  pointer-events="none"
                />
                <rect
                  v-for="(bar, idx) in inspectedDistribution.bars"
                  :key="'o-ihit-' + idx"
                  class="sp-bar-hit"
                  :x="bar.x"
                  y="0"
                  :width="Math.max(bar.width, 2.5)"
                  height="46"
                  fill="transparent"
                  @mouseenter="hoveredInlineBar = bar"
                  @mouseleave="hoveredInlineBar = null"
                  @click.stop="selectPlayer(bar.playerName)"
                >
                  <title>{{ bar.playerName }}: {{ formatMetricVal(bar.value, inspectedMetricMeta.label, inspectedMetricMeta.unit) }}</title>
                </rect>
              </svg>
            </div>
            <div class="sp-inline-hist-footer">
              <span>최소 {{ formatMetricVal(inspectedDistribution.min, inspectedMetricMeta.label, inspectedMetricMeta.unit) }}</span>
              <span class="sp-inline-hover-mid">
                <template v-if="hoveredInlineBar">
                  <strong>{{ hoveredInlineBar.playerName }}</strong> ·
                  {{ formatMetricVal(hoveredInlineBar.value, inspectedMetricMeta.label, inspectedMetricMeta.unit) }} (클릭하여 이동 ↗)
                </template>
                <template v-else>
                  평균 {{ formatMetricVal(inspectedDistribution.avg, inspectedMetricMeta.label, inspectedMetricMeta.unit) }} · 막대 클릭 시 해당 플레이어로 이동
                </template>
              </span>
              <span>최대 {{ formatMetricVal(inspectedDistribution.max, inspectedMetricMeta.label, inspectedMetricMeta.unit) }}</span>
            </div>
            <!-- 레이팅 구간별 평균치 실선 선택 칩 -->
            <div v-if="inspectedDistribution.ratingBandAverages && inspectedDistribution.ratingBandAverages.length > 0" class="sp-drawer-rbands">
              <span class="sp-rband-lbl">구간별 평균 실선:</span>
              <button
                type="button"
                class="sp-rband-chip"
                :class="{ active: drawerSelectedBandKey === 'all' }"
                @click.stop="drawerSelectedBandKey = 'all'"
              >
                전체 구간
              </button>
              <button
                v-for="band in inspectedDistribution.ratingBandAverages"
                :key="'dr-chip-' + band.key"
                type="button"
                class="sp-rband-chip"
                :class="{ active: drawerSelectedBandKey === band.key }"
                :style="{ '--rb-color': band.color }"
                @click.stop="toggleDrawerBand(band.key)"
                :title="`${band.label} 평균 (${band.count}명)`"
              >
                <span class="sp-rb-dash" :style="{ borderColor: band.color }"></span>
                <strong :style="{ color: band.color }">{{ band.label }}</strong>
                <span>{{ formatMetricVal(band.avg, inspectedMetricMeta.label, inspectedMetricMeta.unit) }}</span>
                <span class="muted-mini">({{ band.count }})</span>
              </button>
            </div>
          </div>

          <!-- 개인 시작 자리별 순위 (東 · 南 · 西 · 北) -->
          <div class="sp-card">
            <div class="sp-card-header">
              <h4>{{ selectedPlayer.name }}님의 시작 자리별 순위 (東 · 南 · 西 · 北)</h4>
              <button
                type="button"
                class="sp-mini-toggle"
                @click="openSeatTabForPlayer(selectedPlayer.name)"
              >
                자리별 순위 탭에서 기간별 보기 →
              </button>
            </div>

            <div v-if="isLoadingPlayerSeatStats" class="sp-loading-box" style="padding: 14px;">
              시작 자리별 순위를 집계하는 중입니다...
            </div>
            <template v-else-if="playerSeatStatsResult && playerSeatStatsResult.totalGames > 0">
              <div class="sp-table-scroll">
                <table class="sp-table sp-data-table">
                  <thead>
                    <tr>
                      <th>시작 자리</th>
                      <th>1위율</th>
                      <th>2위율</th>
                      <th>3위율</th>
                      <th>4위율</th>
                      <th>연대율</th>
                      <th>토비율</th>
                      <th>평균 순위</th>
                      <th>평균 우마</th>
                      <th>대국 수</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="s in playerSeatStatsResult.seats" :key="'ps-' + s.seat">
                      <td class="nowrap"><strong>{{ s.seatLabel }}</strong></td>
                      <td>
                        <template v-if="s.totalGames > 0">{{ s.p1.toFixed(1) }}% <span class="muted-mini">({{ s.r1 }})</span></template>
                        <template v-else>-</template>
                      </td>
                      <td>
                        <template v-if="s.totalGames > 0">{{ s.p2.toFixed(1) }}% <span class="muted-mini">({{ s.r2 }})</span></template>
                        <template v-else>-</template>
                      </td>
                      <td>
                        <template v-if="s.totalGames > 0">{{ s.p3.toFixed(1) }}% <span class="muted-mini">({{ s.r3 }})</span></template>
                        <template v-else>-</template>
                      </td>
                      <td>
                        <template v-if="s.totalGames > 0">{{ s.p4.toFixed(1) }}% <span class="muted-mini">({{ s.r4 }})</span></template>
                        <template v-else>-</template>
                      </td>
                      <td><strong>{{ s.totalGames > 0 ? s.top2Rate.toFixed(1) + '%' : '-' }}</strong></td>
                      <td>{{ s.totalGames > 0 ? s.tobiRate.toFixed(1) + '%' : '-' }}</td>
                      <td><strong>{{ s.totalGames > 0 ? s.avgRank.toFixed(3) : '-' }}</strong></td>
                      <td :class="s.totalGames > 0 ? (s.avgUma >= 0 ? 'pos' : 'neg') : ''">
                        {{ s.totalGames > 0 ? (s.avgUma > 0 ? '+' : '') + s.avgUma.toFixed(2) + 'pt' : '-' }}
                      </td>
                      <td>{{ s.totalGames.toLocaleString() }}전</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="sp-seat-bars" style="margin-top: 10px;">
                <div v-for="s in playerSeatStatsResult.seats" :key="'pbar-' + s.seat" class="sp-seat-bar-row">
                  <div class="seat-bar-label">{{ s.seat }}</div>
                  <div v-if="s.totalGames > 0" class="sp-rank-stacked-bar">
                    <div v-if="s.p1 > 0" class="seg s1" :style="{ width: s.p1 + '%' }"><span>{{ s.p1.toFixed(1) }}%</span></div>
                    <div v-if="s.p2 > 0" class="seg s2" :style="{ width: s.p2 + '%' }"><span>{{ s.p2.toFixed(1) }}%</span></div>
                    <div v-if="s.p3 > 0" class="seg s3" :style="{ width: s.p3 + '%' }"><span>{{ s.p3.toFixed(1) }}%</span></div>
                    <div v-if="s.p4 > 0" class="seg s4" :style="{ width: s.p4 + '%' }"><span>{{ s.p4.toFixed(1) }}%</span></div>
                  </div>
                  <div v-else class="sp-rank-stacked-bar empty-seat-bar">
                    <span class="muted-mini">기록 없음</span>
                  </div>
                  <div class="seat-bar-avg">{{ s.totalGames > 0 ? s.avgRank.toFixed(3) + '위' : '-' }}</div>
                </div>
              </div>
            </template>
            <div v-else class="sp-loading-box" style="padding: 14px;">
              선택한 기간 내 제9회 이후 시작 자리별 기록이 없습니다.
            </div>
          </div>

          <!-- 자주 만난 상대 -->
          <div class="sp-card" v-if="selectedPlayerOpponents.length > 0">
            <div class="sp-card-header">
              <h4>자주 만난 상대 (동탁 전적 TOP {{ selectedPlayerOpponents.length }})</h4>
            </div>
            <div class="sp-opponents-grid">
              <div v-for="opp in selectedPlayerOpponents" :key="opp.opponentName" class="sp-opp-card">
                <div class="opp-top">
                  <button type="button" class="opp-name-btn" @click="selectPlayer(opp.opponentName)">
                    {{ opp.opponentName }} ↗
                  </button>
                  <button
                    type="button"
                    class="opp-vs-mini"
                    @click="emit('open-compare', selectedPlayer.name, opp.opponentName)"
                    title="1:1 상세 비교"
                  >
                    VS
                  </button>
                </div>
                <div class="opp-sub">
                  동탁 <strong>{{ opp.encounterCount }}전</strong> ({{ opp.encounterRate.toFixed(1) }}%)
                </div>
                <div class="opp-winrate">
                  맞대결 승률 <strong :class="opp.winRate >= 50 ? 'pos' : 'neg'">{{ opp.winRate.toFixed(1) }}%</strong>
                  ({{ opp.winCount }}승 {{ opp.encounterCount - opp.winCount }}패)
                </div>
              </div>
            </div>
          </div>

          <!-- 개인 최근 고타점 방총 기록 (누가 누구에게 쏘였는지) -->
          <div class="sp-card">
            <div class="sp-card-header">
              <h4>최근 고타점 방총 기록 (8,000점+)</h4>
              <div class="sp-dealin-header-controls">
                <div class="sp-toggle-group">
                  <button
                    type="button"
                    class="sp-toggle-btn"
                    :class="{ active: playerDealInTab === 'lost' }"
                    @click="playerDealInTab = 'lost'"
                  >
                    내가 쏘인 방총 ({{ selectedPlayerLostDealIns.length }})
                  </button>
                  <button
                    type="button"
                    class="sp-toggle-btn"
                    :class="{ active: playerDealInTab === 'won' }"
                    @click="playerDealInTab = 'won'"
                  >
                    내가 론 화료 ({{ selectedPlayerWonDealIns.length }})
                  </button>
                </div>
                <select v-model.number="playerDealInMinScore" class="sp-select-box compact-sel">
                  <option :value="8000">8000+</option>
                  <option :value="12000">12000+</option>
                  <option :value="16000">16000+</option>
                  <option :value="24000">24000+</option>
                  <option :value="32000">32000+</option>
                </select>
              </div>
            </div>

            <div v-if="isLoadingDealIns" class="sp-loading-box">고타점 방총 기록을 불러오는 중입니다...</div>
            <template v-else>
              <div v-if="selectedPlayerDealInSummaryChips.length > 0" class="sp-dealin-summary-chips">
                <span class="sp-quick-lbl">
                  {{ playerDealInTab === 'lost' ? '가장 많이 쏘인 상대:' : '가장 많이 론 딴 상대:' }}
                </span>
                <button
                  v-for="chip in selectedPlayerDealInSummaryChips"
                  :key="'pdc-' + chip.name"
                  type="button"
                  class="sp-quick-chip"
                  @click="selectPlayer(chip.name)"
                >
                  {{ chip.name }}
                  <span class="neg" v-if="playerDealInTab === 'lost'">{{ chip.count }}회</span>
                  <span class="pos" v-else>{{ chip.count }}회</span>
                </button>
              </div>

              <div
                v-if="(playerDealInTab === 'lost' ? selectedPlayerLostDealIns : selectedPlayerWonDealIns).length > 0"
                class="sp-table-scroll"
                style="margin-top: 8px;"
              >
                <table class="sp-table">
                  <thead>
                    <tr>
                      <th>회차</th>
                      <th>국</th>
                      <th>화료자 (론 화료)</th>
                      <th>→</th>
                      <th>방총자 (쏘인 사람)</th>
                      <th>타점</th>
                      <th>비고</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="d in (playerDealInTab === 'lost' ? selectedPlayerLostDealIns : selectedPlayerWonDealIns).slice(0, 20)"
                      :key="d.id"
                    >
                      <td class="nowrap">{{ d.sessionName }}</td>
                      <td class="nowrap muted">{{ d.roundName || '-' }}</td>
                      <td class="nowrap">
                        <button type="button" class="table-player-link" @click="selectPlayer(d.winnerName)">
                          {{ d.winnerName }}
                        </button>
                      </td>
                      <td class="muted">→</td>
                      <td class="nowrap">
                        <button type="button" class="table-player-link neg-link" @click="selectPlayer(d.loserName)">
                          {{ d.loserName }}
                        </button>
                      </td>
                      <td class="nowrap">
                        <strong :class="playerDealInTab === 'lost' ? 'neg' : 'pos'">
                          {{ d.score.toLocaleString() }}점
                        </strong>
                        <span class="dealin-tier-badge" :class="getDealInTierBadge(d.score).cls">
                          {{ getDealInTierBadge(d.score).text }}
                        </span>
                      </td>
                      <td class="nowrap muted-mini">
                        <span v-if="d.isLoserRiichi" class="dealin-meta-tag">리치 중 방총</span>
                        <span v-if="d.isDoubleRon" class="dealin-meta-tag">더블론</span>
                        <span v-if="!d.isLoserRiichi && !d.isDoubleRon">-</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div v-else class="sp-loading-box" style="padding: 14px;">
                조건에 해당하는 고타점 {{ playerDealInTab === 'lost' ? '방총' : '론 화료' }} 기록이 없습니다.
              </div>
            </template>
          </div>

          <!-- 개인 최근 대국 기록 -->
          <div class="sp-card" v-if="selectedPlayerGames.length > 0">
            <div class="sp-card-header">
              <h4>대국 기록 ({{ selectedPlayerGames.length }} / {{ selectedPlayerTotalGamesCount }}전)</h4>
              <button
                v-if="selectedPlayerTotalGamesCount > 15"
                type="button"
                class="sp-mini-toggle"
                @click="showAllPlayerGames = !showAllPlayerGames"
              >
                {{ showAllPlayerGames ? '최근 15전만 보기' : `전체 ${selectedPlayerTotalGamesCount}전 보기` }}
              </button>
            </div>
            <div class="sp-table-scroll">
              <table class="sp-table">
                <thead>
                  <tr>
                    <th>회차</th>
                    <th>일자</th>
                    <th>순위</th>
                    <th>점수</th>
                    <th>우마</th>
                    <th>R 변동</th>
                    <th>동탁 결과 (1~4위)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="g in selectedPlayerGames" :key="'pg-' + g.gameIndex">
                    <td class="nowrap">{{ g.sessionLabel }}</td>
                    <td class="nowrap muted">{{ g.date || '-' }}</td>
                    <td>
                      <span class="rank-chip" :class="'r' + g.myRank">{{ g.myRank }}위</span>
                    </td>
                    <td class="nowrap">{{ g.myScore.toLocaleString() }}</td>
                    <td class="nowrap" :class="g.myUma >= 0 ? 'pos' : 'neg'">
                      {{ g.myUma > 0 ? '+' : '' }}{{ g.myUma.toFixed(1) }}
                    </td>
                    <td class="nowrap">
                      <span :style="{ color: getRatingColor(g.myOrdinal) }">R{{ Math.round(g.myOrdinal) }}</span>
                      <span class="delta-mini" :class="g.myDelta >= 0 ? 'pos' : 'neg'">
                        ({{ g.myDelta >= 0 ? '+' : '' }}{{ Math.round(g.myDelta) }})
                      </span>
                    </td>
                    <td class="players-inline-cell">
                      <button
                        v-for="pl in g.players"
                        :key="pl.name + pl.rank"
                        type="button"
                        class="inline-pl-chip"
                        :class="{ isme: normalizeRatingPlayerName(pl.name) === normalizeRatingPlayerName(selectedPlayer.name) }"
                        @click="selectPlayer(pl.name)"
                      >
                        {{ pl.rank }}.{{ pl.name }}
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>
      </div>

      <!-- 플레이어 미선택 시: 홈 미리보기 (항상 최신 회차 대국 기록 노출) -->
      <div v-else class="sp-empty-home">
        <div class="sp-card">
          <div class="sp-card-header">
            <h4>최근 대국 기록 (최신 {{ latestHomeGames.length }}전)</h4>
            <button type="button" class="sp-mini-toggle" @click="activeSubTab = 'games'">
              일자·회차별 전체 대국 기록 →
            </button>
          </div>
          <div class="sp-table-scroll" v-if="latestHomeGames.length > 0">
            <table class="sp-table">
              <thead>
                <tr>
                  <th>회차</th>
                  <th>일자</th>
                  <th>1위</th>
                  <th>2위</th>
                  <th>3위</th>
                  <th>4위</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="g in latestHomeGames" :key="'home-g-' + g.gameIndex">
                  <td class="nowrap">{{ g.displaySession }}</td>
                  <td class="nowrap muted">{{ g.displayDate || '-' }}</td>
                  <td v-for="pl in g.players" :key="pl.rank + pl.name" class="nowrap">
                    <button type="button" class="table-player-link" @click="selectPlayer(pl.name)">
                      {{ pl.name }}
                    </button>
                    <span class="muted-mini"> ({{ pl.score.toLocaleString() }})</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- ===================================================== -->
    <!-- SUB-TAB 2: 레이팅 구간별 데이터                        -->
    <!-- ===================================================== -->
    <div v-else-if="activeSubTab === 'by-rating'" class="sp-section">
      <div class="sp-card sp-filter-panel">
        <div class="sp-filter-row">
          <span class="sp-filter-lbl">조회 기간:</span>
          <div class="sp-toggle-group">
            <button type="button" class="sp-toggle-btn" :class="{ active: ratingScopeMode === 'overall' }" @click="setRatingScopeMode('overall')">
              전체
            </button>
            <button type="button" class="sp-toggle-btn" :class="{ active: ratingScopeMode === 'recent_sessions' }" @click="setRatingScopeMode('recent_sessions')">
              최근 N회차
            </button>
            <button type="button" class="sp-toggle-btn" :class="{ active: ratingScopeMode === 'session_range' }" @click="setRatingScopeMode('session_range')">
              회차 구간
            </button>
            <button type="button" class="sp-toggle-btn" :class="{ active: ratingScopeMode === 'date_range' }" @click="setRatingScopeMode('date_range')">
              일자 지정
            </button>
          </div>
        </div>

        <div v-if="ratingScopeMode === 'recent_sessions'" class="sp-scope-controls">
          <div class="sp-scope-presets">
            <button
              v-for="n in [1, 3, 5, 10, 15]"
              :key="'rrs-' + n"
              type="button"
              class="sp-quick-chip"
              :class="{ active: ratingRecentSessionsCount === n }"
              @click="ratingRecentSessionsCount = n; loadRatingScopedData()"
            >
              최근 {{ n }}회차
            </button>
          </div>
          <div class="sp-scope-inline-input">
            <span>직접 입력:</span>
            <input v-model.number="ratingRecentSessionsCount" type="number" min="1" :max="Math.max(1, sortedSessionsDesc.length)" class="sp-num-input" @keyup.enter="loadRatingScopedData" />
            <span>회차</span>
            <button type="button" class="sp-action-btn primary" @click="loadRatingScopedData">조회</button>
          </div>
        </div>

        <div v-else-if="ratingScopeMode === 'session_range'" class="sp-scope-controls">
          <div class="sp-scope-inline-input">
            <input v-model.number="ratingStartNum" type="number" min="1" :max="maxSessionNumber" class="sp-num-input compact" @keyup.enter="applyRatingSessionNums" />
            <span>회차 ~</span>
            <input v-model.number="ratingEndNum" type="number" min="1" :max="maxSessionNumber" class="sp-num-input compact" @keyup.enter="applyRatingSessionNums" />
            <span>회차</span>
            <button type="button" class="sp-action-btn primary" @click="applyRatingSessionNums">조회</button>
          </div>
          <div class="sp-scope-inline-input">
            <select v-model="ratingStartSession" class="sp-select-box" @change="syncRatingSessionNumsFromLabels(); loadRatingScopedData()">
              <option v-for="s in sortedSessionsAsc" :key="'r-ss-' + s" :value="s">{{ s }}</option>
            </select>
            <span>~</span>
            <select v-model="ratingEndSession" class="sp-select-box" @change="syncRatingSessionNumsFromLabels(); loadRatingScopedData()">
              <option v-for="s in sortedSessionsDesc" :key="'r-se-' + s" :value="s">{{ s }}</option>
            </select>
          </div>
        </div>

        <div v-else-if="ratingScopeMode === 'date_range'" class="sp-scope-controls">
          <div class="sp-scope-inline-input">
            <input v-model="ratingDateStart" type="date" class="sp-date-input" />
            <span>~</span>
            <input v-model="ratingDateEnd" type="date" class="sp-date-input" />
            <button type="button" class="sp-action-btn primary" @click="loadRatingScopedData">조회</button>
          </div>
        </div>

        <div class="sp-filter-row">
          <span class="sp-filter-lbl">최소 대국 수:</span>
          <button
            v-for="mg in [0, 5, 10, 20, 30]"
            :key="'mg-' + mg"
            type="button"
            class="sp-chip-filter"
            :class="{ active: ratingMinGames === mg }"
            @click="ratingMinGames = mg"
          >
            {{ mg === 0 ? '전체' : `${mg}전+` }}
          </button>
          <div class="sp-inline-num-wrap">
            <input v-model.number="ratingMinGames" type="number" min="0" class="sp-num-input compact" />
            <span class="sp-unit-lbl">전 이상</span>
          </div>
        </div>

        <div class="sp-filter-row">
          <span class="sp-filter-lbl">최소 국 수:</span>
          <button
            v-for="mr in [0, 50, 100, 200, 300]"
            :key="'mr-' + mr"
            type="button"
            class="sp-chip-filter"
            :class="{ active: ratingMinRounds === mr }"
            @click="ratingMinRounds = mr"
          >
            {{ mr === 0 ? '전체' : `${mr}국+` }}
          </button>
          <div class="sp-inline-num-wrap">
            <input v-model.number="ratingMinRounds" type="number" min="0" step="10" class="sp-num-input compact" />
            <span class="sp-unit-lbl">국 이상</span>
          </div>
        </div>
      </div>

      <div v-if="isLoadingRatingScope" class="sp-loading-box">레이팅 구간별 데이터를 집계하는 중입니다...</div>

      <template v-else>
        <!-- Table 1 -->
        <div class="sp-card">
          <div class="sp-card-header">
            <h4>레이팅 구간별 순위 · 기본 스탯</h4>
            <span class="sp-card-sub">{{ ratingBasisDescription }} · 구간 행 클릭 시 소속 플레이어 표시</span>
          </div>
          <div class="sp-table-scroll">
            <table class="sp-table sp-data-table">
              <thead>
                <tr>
                  <th>레이팅 구간</th>
                  <th>1위율</th>
                  <th>2위율</th>
                  <th>3위율</th>
                  <th>4위율</th>
                  <th>토비율</th>
                  <th>평균 순위</th>
                  <th>화료율</th>
                  <th>방총률</th>
                  <th>리치율</th>
                  <th>쯔모율</th>
                  <th>유국률</th>
                  <th>유국 텐파이율</th>
                  <th>대국 수</th>
                  <th>기록 플레이어 수</th>
                </tr>
              </thead>
              <tbody>
                <template v-for="band in ratingBandRows" :key="band.key">
                  <tr
                    class="clickable-row"
                    :class="{ expanded: expandedBandKey === band.key }"
                    @click="expandedBandKey = expandedBandKey === band.key ? null : band.key"
                  >
                    <td class="nowrap">
                      <span class="band-color-dot" :style="{ backgroundColor: band.color }"></span>
                      <strong :style="{ color: band.color }">{{ band.label }}</strong>
                    </td>
                    <td>{{ band.p1.toFixed(2) }}%</td>
                    <td>{{ band.p2.toFixed(2) }}%</td>
                    <td>{{ band.p3.toFixed(2) }}%</td>
                    <td>{{ band.p4.toFixed(2) }}%</td>
                    <td>{{ band.totalRounds > 0 ? band.tobiRate.toFixed(2) + '%' : '-' }}</td>
                    <td><strong>{{ band.avgRank.toFixed(3) }}</strong></td>
                    <td>{{ band.totalRounds > 0 ? band.winRate.toFixed(2) + '%' : '-' }}</td>
                    <td>{{ band.totalRounds > 0 ? band.dealInRate.toFixed(2) + '%' : '-' }}</td>
                    <td>{{ band.totalRounds > 0 ? band.riichiRate.toFixed(2) + '%' : '-' }}</td>
                    <td>{{ band.totalRounds > 0 ? band.tsumoRate.toFixed(2) + '%' : '-' }}</td>
                    <td>{{ band.totalRounds > 0 ? band.drawRate.toFixed(2) + '%' : '-' }}</td>
                    <td>{{ band.totalRounds > 0 ? band.drawTenpaiRate.toFixed(2) + '%' : '-' }}</td>
                    <td>{{ band.totalGames.toLocaleString() }}</td>
                    <td>{{ band.playerCount }}명</td>
                  </tr>
                  <tr v-if="expandedBandKey === band.key" class="band-expand-row">
                    <td colspan="15">
                      <div class="band-players-list">
                        <button
                          v-for="pl in band.players"
                          :key="pl.name"
                          type="button"
                          class="band-player-chip"
                          @click.stop="selectPlayer(pl.name)"
                        >
                          {{ pl.name }}
                          <span :style="{ color: band.color }">R{{ Math.round(pl.rating || 0) }}</span>
                          <span class="muted-mini">({{ pl.totalGames }}전 · {{ getMemberRounds(pl) }}국)</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                </template>
                <tr v-if="ratingBandRows.length > 0" class="summary-row">
                  <td class="nowrap"><strong>전체 평균</strong></td>
                  <td>{{ ratingOverallSummaryRow.p1.toFixed(2) }}%</td>
                  <td>{{ ratingOverallSummaryRow.p2.toFixed(2) }}%</td>
                  <td>{{ ratingOverallSummaryRow.p3.toFixed(2) }}%</td>
                  <td>{{ ratingOverallSummaryRow.p4.toFixed(2) }}%</td>
                  <td>{{ ratingOverallSummaryRow.totalRounds > 0 ? ratingOverallSummaryRow.tobiRate.toFixed(2) + '%' : '-' }}</td>
                  <td><strong>{{ ratingOverallSummaryRow.avgRank.toFixed(3) }}</strong></td>
                  <td>{{ ratingOverallSummaryRow.totalRounds > 0 ? ratingOverallSummaryRow.winRate.toFixed(2) + '%' : '-' }}</td>
                  <td>{{ ratingOverallSummaryRow.totalRounds > 0 ? ratingOverallSummaryRow.dealInRate.toFixed(2) + '%' : '-' }}</td>
                  <td>{{ ratingOverallSummaryRow.totalRounds > 0 ? ratingOverallSummaryRow.riichiRate.toFixed(2) + '%' : '-' }}</td>
                  <td>{{ ratingOverallSummaryRow.totalRounds > 0 ? ratingOverallSummaryRow.tsumoRate.toFixed(2) + '%' : '-' }}</td>
                  <td>{{ ratingOverallSummaryRow.totalRounds > 0 ? ratingOverallSummaryRow.drawRate.toFixed(2) + '%' : '-' }}</td>
                  <td>{{ ratingOverallSummaryRow.totalRounds > 0 ? ratingOverallSummaryRow.drawTenpaiRate.toFixed(2) + '%' : '-' }}</td>
                  <td>{{ ratingOverallSummaryRow.totalGames.toLocaleString() }}</td>
                  <td>{{ ratingOverallSummaryRow.playerCount }}명</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Table 2 -->
        <div class="sp-card">
          <div class="sp-card-header">
            <h4>레이팅 구간별 점수 · 효율 · 리치 스탯</h4>
          </div>
          <div class="sp-table-scroll">
            <table class="sp-table sp-data-table">
              <thead>
                <tr>
                  <th>레이팅 구간</th>
                  <th>평균 화료</th>
                  <th>평균 방총</th>
                  <th>화료 효율</th>
                  <th>방총 손실</th>
                  <th>알짜 화료 효율</th>
                  <th>국수지</th>
                  <th>리치 화료율</th>
                  <th>리치 방총률</th>
                  <th>리치 수지</th>
                  <th>선제율</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="band in ratingBandRows" :key="'eff-' + band.key">
                  <td class="nowrap">
                    <span class="band-color-dot" :style="{ backgroundColor: band.color }"></span>
                    <strong :style="{ color: band.color }">{{ band.label }}</strong>
                  </td>
                  <td>{{ band.totalRounds > 0 ? Math.round(band.avgWinScore).toLocaleString() : '-' }}</td>
                  <td>{{ band.totalRounds > 0 ? Math.round(band.avgDealInScore).toLocaleString() : '-' }}</td>
                  <td>{{ band.totalRounds > 0 ? Math.round(band.winEfficiency).toLocaleString() : '-' }}</td>
                  <td>{{ band.totalRounds > 0 ? Math.round(band.dealInLoss).toLocaleString() : '-' }}</td>
                  <td><strong>{{ band.totalRounds > 0 ? Math.round(band.netWinEfficiency).toLocaleString() : '-' }}</strong></td>
                  <td :class="band.handEV >= 0 ? 'pos' : 'neg'">
                    {{ band.totalRounds > 0 ? (band.handEV > 0 ? '+' : '') + Math.round(band.handEV).toLocaleString() : '-' }}
                  </td>
                  <td>{{ band.totalRounds > 0 ? band.riichiWinRate.toFixed(2) + '%' : '-' }}</td>
                  <td>{{ band.totalRounds > 0 ? band.riichiDealInRate.toFixed(2) + '%' : '-' }}</td>
                  <td :class="band.riichiEV >= 0 ? 'pos' : 'neg'">
                    {{ band.totalRounds > 0 ? (band.riichiEV > 0 ? '+' : '') + Math.round(band.riichiEV).toLocaleString() : '-' }}
                  </td>
                  <td>{{ band.totalRounds > 0 ? band.firstRiichiRate.toFixed(2) + '%' : '-' }}</td>
                </tr>
                <tr v-if="ratingBandRows.length > 0" class="summary-row">
                  <td class="nowrap"><strong>전체 평균</strong></td>
                  <td>{{ ratingOverallSummaryRow.totalRounds > 0 ? Math.round(ratingOverallSummaryRow.avgWinScore).toLocaleString() : '-' }}</td>
                  <td>{{ ratingOverallSummaryRow.totalRounds > 0 ? Math.round(ratingOverallSummaryRow.avgDealInScore).toLocaleString() : '-' }}</td>
                  <td>{{ ratingOverallSummaryRow.totalRounds > 0 ? Math.round(ratingOverallSummaryRow.winEfficiency).toLocaleString() : '-' }}</td>
                  <td>{{ ratingOverallSummaryRow.totalRounds > 0 ? Math.round(ratingOverallSummaryRow.dealInLoss).toLocaleString() : '-' }}</td>
                  <td><strong>{{ ratingOverallSummaryRow.totalRounds > 0 ? Math.round(ratingOverallSummaryRow.netWinEfficiency).toLocaleString() : '-' }}</strong></td>
                  <td>{{ ratingOverallSummaryRow.totalRounds > 0 ? (ratingOverallSummaryRow.handEV > 0 ? '+' : '') + Math.round(ratingOverallSummaryRow.handEV).toLocaleString() : '-' }}</td>
                  <td>{{ ratingOverallSummaryRow.totalRounds > 0 ? ratingOverallSummaryRow.riichiWinRate.toFixed(2) + '%' : '-' }}</td>
                  <td>{{ ratingOverallSummaryRow.totalRounds > 0 ? ratingOverallSummaryRow.riichiDealInRate.toFixed(2) + '%' : '-' }}</td>
                  <td>{{ ratingOverallSummaryRow.totalRounds > 0 ? (ratingOverallSummaryRow.riichiEV > 0 ? '+' : '') + Math.round(ratingOverallSummaryRow.riichiEV).toLocaleString() : '-' }}</td>
                  <td>{{ ratingOverallSummaryRow.totalRounds > 0 ? ratingOverallSummaryRow.firstRiichiRate.toFixed(2) + '%' : '-' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <p class="sp-footer-count">
          집계된 대전 수: <strong>{{ totalBandRecordedGames.toLocaleString() }}</strong>전 · 기록 플레이어 수: <strong>{{ ratingSourceMembers.length }}</strong>명
        </p>
      </template>
    </div>

    <!-- ===================================================== -->
    <!-- SUB-TAB 3: 자리별 순위 (東 / 南 / 西 / 北)              -->
    <!-- ===================================================== -->
    <div v-else-if="activeSubTab === 'by-seat'" class="sp-section">
      <div class="sp-card sp-filter-panel">
        <div class="sp-filter-row">
          <span class="sp-filter-lbl">조회 기간:</span>
          <div class="sp-toggle-group">
            <button type="button" class="sp-toggle-btn" :class="{ active: seatScopeMode === 'all' }" @click="setSeatScopeMode('all')">
              전체 (제9회~)
            </button>
            <button type="button" class="sp-toggle-btn" :class="{ active: seatScopeMode === 'recent_sessions' }" @click="setSeatScopeMode('recent_sessions')">
              최근 N회차
            </button>
            <button type="button" class="sp-toggle-btn" :class="{ active: seatScopeMode === 'session_range' }" @click="setSeatScopeMode('session_range')">
              회차 구간
            </button>
            <button type="button" class="sp-toggle-btn" :class="{ active: seatScopeMode === 'date_range' }" @click="setSeatScopeMode('date_range')">
              일자 지정
            </button>
          </div>
        </div>

        <div v-if="seatScopeMode === 'recent_sessions'" class="sp-scope-controls">
          <div class="sp-scope-presets">
            <button
              v-for="n in [1, 3, 5, 10, 15]"
              :key="'srs-' + n"
              type="button"
              class="sp-quick-chip"
              :class="{ active: seatRecentSessionsCount === n }"
              @click="seatRecentSessionsCount = n; loadSeatStats()"
            >
              최근 {{ n }}회차
            </button>
          </div>
          <div class="sp-scope-inline-input">
            <span>직접 입력:</span>
            <input v-model.number="seatRecentSessionsCount" type="number" min="1" :max="Math.max(1, sortedSessionsDesc.length)" class="sp-num-input" @keyup.enter="loadSeatStats" />
            <span>회차</span>
            <button type="button" class="sp-action-btn primary" @click="loadSeatStats">조회</button>
          </div>
        </div>

        <div v-else-if="seatScopeMode === 'session_range'" class="sp-scope-controls">
          <div class="sp-scope-inline-input">
            <input v-model.number="seatStartNum" type="number" min="1" :max="maxSessionNumber" class="sp-num-input compact" @keyup.enter="applySeatSessionNums" />
            <span>회차 ~</span>
            <input v-model.number="seatEndNum" type="number" min="1" :max="maxSessionNumber" class="sp-num-input compact" @keyup.enter="applySeatSessionNums" />
            <span>회차</span>
            <button type="button" class="sp-action-btn primary" @click="applySeatSessionNums">조회</button>
          </div>
          <div class="sp-scope-inline-input">
            <select v-model="seatStartSession" class="sp-select-box" @change="syncSeatSessionNumsFromLabels(); loadSeatStats()">
              <option v-for="s in sortedSessionsAsc" :key="'s-ss-' + s" :value="s">{{ s }}</option>
            </select>
            <span>~</span>
            <select v-model="seatEndSession" class="sp-select-box" @change="syncSeatSessionNumsFromLabels(); loadSeatStats()">
              <option v-for="s in sortedSessionsDesc" :key="'s-se-' + s" :value="s">{{ s }}</option>
            </select>
          </div>
        </div>

        <div v-else-if="seatScopeMode === 'date_range'" class="sp-scope-controls">
          <div class="sp-scope-inline-input">
            <input v-model="seatStartDate" type="date" class="sp-date-input" />
            <span>~</span>
            <input v-model="seatEndDate" type="date" class="sp-date-input" />
            <button type="button" class="sp-action-btn primary" @click="loadSeatStats">조회</button>
          </div>
        </div>

        <div class="sp-filter-row">
          <span class="sp-filter-lbl">대상 플레이어:</span>
          <select v-model="seatPlayerFilter" class="sp-select-box compact-sel" @change="loadSeatStats">
            <option value="">전체 플레이어 (클럽 종합)</option>
            <option v-for="m in sortedAllMembers" :key="'spf-' + m.name" :value="m.name">{{ m.name }}</option>
          </select>
          <button
            v-if="baseSelectedPlayer && seatPlayerFilter !== baseSelectedPlayer.name"
            type="button"
            class="sp-quick-chip"
            @click="seatPlayerFilter = baseSelectedPlayer.name; loadSeatStats()"
          >
            {{ baseSelectedPlayer.name }} 보기
          </button>
          <button
            v-if="seatPlayerFilter"
            type="button"
            class="sp-mini-toggle"
            @click="seatPlayerFilter = ''; loadSeatStats()"
          >
            전체 플레이어로 보기
          </button>
        </div>
      </div>

      <div v-if="isLoadingSeatStats" class="sp-loading-box">시작 자리별 순위 통계를 집계하는 중입니다...</div>

      <template v-else-if="seatStatsResult && seatStatsResult.totalGames > 0">
        <div class="sp-card">
          <div class="sp-card-header">
            <h4>
              {{
                seatPlayerFilter
                  ? `${seatPlayerFilter}님의 시작 자리별 순위 통계 (東 · 南 · 西 · 北)`
                  : '시작 자리별 순위 통계 (東 · 南 · 西 · 北)'
              }}
            </h4>
            <span class="sp-card-sub">제9회 이후 국별 상세 기록 기준</span>
          </div>
          <div class="sp-table-scroll">
            <table class="sp-table sp-data-table">
              <thead>
                <tr>
                  <th>시작 자리</th>
                  <th>1위율</th>
                  <th>2위율</th>
                  <th>3위율</th>
                  <th>4위율</th>
                  <th>연대율 (1·2위)</th>
                  <th>토비율</th>
                  <th>평균 순위</th>
                  <th>평균 우마</th>
                  <th>집계 대국 수</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="s in seatStatsResult.seats" :key="s.seat">
                  <td class="nowrap"><strong>{{ s.seatLabel }}</strong></td>
                  <td>
                    <template v-if="s.totalGames > 0">{{ s.p1.toFixed(2) }}% <span class="muted-mini">({{ s.r1 }})</span></template>
                    <template v-else>-</template>
                  </td>
                  <td>
                    <template v-if="s.totalGames > 0">{{ s.p2.toFixed(2) }}% <span class="muted-mini">({{ s.r2 }})</span></template>
                    <template v-else>-</template>
                  </td>
                  <td>
                    <template v-if="s.totalGames > 0">{{ s.p3.toFixed(2) }}% <span class="muted-mini">({{ s.r3 }})</span></template>
                    <template v-else>-</template>
                  </td>
                  <td>
                    <template v-if="s.totalGames > 0">{{ s.p4.toFixed(2) }}% <span class="muted-mini">({{ s.r4 }})</span></template>
                    <template v-else>-</template>
                  </td>
                  <td><strong>{{ s.totalGames > 0 ? s.top2Rate.toFixed(2) + '%' : '-' }}</strong></td>
                  <td>{{ s.totalGames > 0 ? s.tobiRate.toFixed(2) + '%' : '-' }}</td>
                  <td><strong>{{ s.totalGames > 0 ? s.avgRank.toFixed(3) : '-' }}</strong></td>
                  <td :class="s.totalGames > 0 ? (s.avgUma >= 0 ? 'pos' : 'neg') : ''">
                    {{ s.totalGames > 0 ? (s.avgUma > 0 ? '+' : '') + s.avgUma.toFixed(2) + 'pt' : '-' }}
                  </td>
                  <td>{{ s.totalGames.toLocaleString() }}전</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="sp-card">
          <div class="sp-card-header">
            <h4>{{ seatPlayerFilter ? `${seatPlayerFilter}님의 자리별 1~4위 분포 시각화` : '자리별 1~4위 분포 시각화' }}</h4>
          </div>
          <div class="sp-seat-bars">
            <div v-for="s in seatStatsResult.seats" :key="'bar-' + s.seat" class="sp-seat-bar-row">
              <div class="seat-bar-label">{{ s.seat }}</div>
              <div v-if="s.totalGames > 0" class="sp-rank-stacked-bar">
                <div v-if="s.p1 > 0" class="seg s1" :style="{ width: s.p1 + '%' }"><span>{{ s.p1.toFixed(1) }}%</span></div>
                <div v-if="s.p2 > 0" class="seg s2" :style="{ width: s.p2 + '%' }"><span>{{ s.p2.toFixed(1) }}%</span></div>
                <div v-if="s.p3 > 0" class="seg s3" :style="{ width: s.p3 + '%' }"><span>{{ s.p3.toFixed(1) }}%</span></div>
                <div v-if="s.p4 > 0" class="seg s4" :style="{ width: s.p4 + '%' }"><span>{{ s.p4.toFixed(1) }}%</span></div>
              </div>
              <div v-else class="sp-rank-stacked-bar empty-seat-bar">
                <span class="muted-mini">기록 없음</span>
              </div>
              <div class="seat-bar-avg">{{ s.totalGames > 0 ? s.avgRank.toFixed(3) + '위' : '-' }}</div>
            </div>
          </div>
        </div>

        <p class="sp-footer-count">
          집계된 대전 수: <strong>{{ seatStatsResult.totalGames.toLocaleString() }}</strong>전
        </p>
      </template>

      <div v-else class="sp-loading-box">선택한 조건에 해당하는 자리별 대국 데이터가 없습니다.</div>
    </div>

    <!-- ===================================================== -->
    <!-- SUB-TAB 3-5: 고타점 방총 (사람마다 누가 누구에게 쏘였는지) -->
    <!-- ===================================================== -->
    <div v-else-if="activeSubTab === 'deal-ins'" class="sp-section">
      <div class="sp-card sp-filter-panel">
        <div class="sp-filter-row">
          <span class="sp-filter-lbl">최소 타점:</span>
          <button
            v-for="ms in [8000, 12000, 16000, 24000, 32000]"
            :key="'dms-' + ms"
            type="button"
            class="sp-chip-filter"
            :class="{ active: dealInMinScore === ms }"
            @click="dealInMinScore = ms"
          >
            {{ ms }}+
          </button>
        </div>

        <div class="sp-filter-row">
          <span class="sp-filter-lbl">조회 기간:</span>
          <div class="sp-toggle-group">
            <button type="button" class="sp-toggle-btn" :class="{ active: dealInScopeMode === 'all' }" @click="dealInScopeMode = 'all'">
              전체 (제9회~)
            </button>
            <button type="button" class="sp-toggle-btn" :class="{ active: dealInScopeMode === 'recent_sessions' }" @click="dealInScopeMode = 'recent_sessions'">
              최근 N회차
            </button>
            <button type="button" class="sp-toggle-btn" :class="{ active: dealInScopeMode === 'session_range' }" @click="dealInScopeMode = 'session_range'">
              회차 구간
            </button>
            <button type="button" class="sp-toggle-btn" :class="{ active: dealInScopeMode === 'date_range' }" @click="dealInScopeMode = 'date_range'">
              일자 지정
            </button>
          </div>
        </div>

        <div v-if="dealInScopeMode === 'recent_sessions'" class="sp-scope-controls">
          <div class="sp-scope-presets">
            <button
              v-for="n in [1, 3, 5, 10]"
              :key="'drs-' + n"
              type="button"
              class="sp-quick-chip"
              :class="{ active: dealInRecentSessions === n }"
              @click="dealInRecentSessions = n"
            >
              최근 {{ n }}회차
            </button>
          </div>
          <div class="sp-scope-inline-input">
            <span>직접 입력:</span>
            <input v-model.number="dealInRecentSessions" type="number" min="1" :max="maxSessionNumber" class="sp-num-input compact" />
            <span>회차</span>
          </div>
        </div>

        <div v-else-if="dealInScopeMode === 'session_range'" class="sp-scope-controls">
          <div class="sp-scope-inline-input">
            <input v-model.number="dealInStartNum" type="number" min="1" :max="maxSessionNumber" class="sp-num-input compact" />
            <span>회차 ~</span>
            <input v-model.number="dealInEndNum" type="number" min="1" :max="maxSessionNumber" class="sp-num-input compact" />
            <span>회차</span>
          </div>
        </div>

        <div v-else-if="dealInScopeMode === 'date_range'" class="sp-scope-controls">
          <div class="sp-scope-inline-input">
            <input v-model="dealInStartDate" type="date" class="sp-date-input" />
            <span>~</span>
            <input v-model="dealInEndDate" type="date" class="sp-date-input" />
          </div>
        </div>

        <div class="sp-filter-row">
          <span class="sp-filter-lbl">플레이어 필터:</span>
          <select v-model="dealInPlayerFilter" class="sp-select-box compact-sel">
            <option value="">전체 플레이어</option>
            <option v-for="m in sortedAllMembers" :key="'dpf-' + m.name" :value="m.name">{{ m.name }}</option>
          </select>
          <div v-if="dealInPlayerFilter" class="sp-toggle-group">
            <button type="button" class="sp-toggle-btn" :class="{ active: dealInRoleFilter === 'all' }" @click="dealInRoleFilter = 'all'">전체</button>
            <button type="button" class="sp-toggle-btn" :class="{ active: dealInRoleFilter === 'loser' }" @click="dealInRoleFilter = 'loser'">쏘인 기록</button>
            <button type="button" class="sp-toggle-btn" :class="{ active: dealInRoleFilter === 'winner' }" @click="dealInRoleFilter = 'winner'">론 화료</button>
          </div>
        </div>
      </div>

      <div v-if="isLoadingDealIns" class="sp-loading-box">고타점 방총 기록을 집계하는 중입니다...</div>

      <template v-else>
        <!-- 최근 고타점 방총 타임라인 -->
        <div class="sp-card">
          <div class="sp-card-header">
            <h4>최근 고타점 방총 내역 ({{ filteredGlobalDealIns.length }}건)</h4>
            <span class="sp-card-sub">누가 누구에게 몇 점 쏘였는지 최신순으로 표시 · 이름 클릭 시 개인 스탯 이동</span>
          </div>
          <div class="sp-table-scroll" v-if="filteredGlobalDealIns.length > 0">
            <table class="sp-table">
              <thead>
                <tr>
                  <th>회차</th>
                  <th>일자</th>
                  <th>국</th>
                  <th>화료자 (론 화료)</th>
                  <th>→</th>
                  <th>방총자 (쏘인 사람)</th>
                  <th>방총 타점</th>
                  <th>비고</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="d in filteredGlobalDealIns.slice(0, 80)" :key="d.id">
                  <td class="nowrap">{{ d.sessionName }}</td>
                  <td class="nowrap muted">{{ d.date || '-' }}</td>
                  <td class="nowrap muted">{{ d.roundName || '-' }}</td>
                  <td class="nowrap">
                    <button type="button" class="table-player-link" @click="selectPlayer(d.winnerName)">
                      {{ d.winnerName }}
                    </button>
                  </td>
                  <td class="muted">→</td>
                  <td class="nowrap">
                    <button type="button" class="table-player-link neg-link" @click="selectPlayer(d.loserName)">
                      {{ d.loserName }}
                    </button>
                  </td>
                  <td class="nowrap">
                    <strong class="neg">{{ d.score.toLocaleString() }}점</strong>
                    <span class="dealin-tier-badge" :class="getDealInTierBadge(d.score).cls">
                      {{ getDealInTierBadge(d.score).text }}
                    </span>
                  </td>
                  <td class="nowrap muted-mini">
                    <span v-if="d.isLoserRiichi" class="dealin-meta-tag">리치 중</span>
                    <span v-if="d.isDoubleRon" class="dealin-meta-tag">더블론</span>
                    <span v-if="!d.isLoserRiichi && !d.isDoubleRon">-</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="sp-loading-box">선택한 조건에 해당하는 고타점 방총 기록이 없습니다.</div>
        </div>

        <!-- 플레이어별 고타점 방총 요약 -->
        <div class="sp-card" v-if="highScoreDealInPlayerSummary.length > 0">
          <div class="sp-card-header">
            <h4>플레이어별 고타점 방총 요약</h4>
            <span class="sp-card-sub">행 클릭 시 해당 플레이어 필터링</span>
          </div>
          <div class="sp-table-scroll">
            <table class="sp-table sp-data-table">
              <thead>
                <tr>
                  <th>플레이어</th>
                  <th>고타점 방총(피격)</th>
                  <th>평균 방총 타점</th>
                  <th>최대 방총 타점</th>
                  <th>가장 많이 쏘인 상대</th>
                  <th>고타점 론 화료</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in highScoreDealInPlayerSummary"
                  :key="'dsum-' + row.name"
                  class="clickable-row"
                  @click="dealInPlayerFilter = row.name; dealInRoleFilter = 'loser'"
                >
                  <td class="nowrap">
                    <button type="button" class="table-player-link" @click.stop="selectPlayer(row.name)">
                      {{ row.name }}
                    </button>
                  </td>
                  <td class="neg">{{ row.lostCount }}회</td>
                  <td>{{ row.lostAvg > 0 ? row.lostAvg.toLocaleString() + '점' : '-' }}</td>
                  <td><strong>{{ row.maxLost > 0 ? row.maxLost.toLocaleString() + '점' : '-' }}</strong></td>
                  <td class="nowrap">
                    <template v-if="row.topAttackerCnt > 0">
                      {{ row.topAttacker }} <span class="muted-mini">({{ row.topAttackerCnt }}회)</span>
                    </template>
                    <template v-else>-</template>
                  </td>
                  <td class="pos">{{ row.wonCount }}회</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>
    </div>

    <!-- ===================================================== -->
    <!-- SUB-TAB 4: 대국 기록 (최신 / 일자 / 기간 / 최근N회 / 회차구간) -->
    <!-- ===================================================== -->
    <div v-else-if="activeSubTab === 'games'" class="sp-section">
      <div class="sp-card">
        <div class="sp-card-header">
          <h4>대국 기록 조회 ({{ filteredLogGames.length }}전)</h4>
          <span class="sp-card-sub">플레이어 클릭 시 개인 스탯 페이지로 바로 이동합니다</span>
        </div>

        <div class="sp-filter-row" style="margin-bottom: 10px;">
          <div class="sp-toggle-group">
            <button type="button" class="sp-toggle-btn" :class="{ active: gamesLogMode === 'latest' }" @click="gamesLogMode = 'latest'">
              최신 40전
            </button>
            <button type="button" class="sp-toggle-btn" :class="{ active: gamesLogMode === 'date' }" @click="gamesLogMode = 'date'">
              일자 선택
            </button>
            <button type="button" class="sp-toggle-btn" :class="{ active: gamesLogMode === 'date_range' }" @click="gamesLogMode = 'date_range'">
              일자 기간
            </button>
            <button type="button" class="sp-toggle-btn" :class="{ active: gamesLogMode === 'recent_sessions' }" @click="gamesLogMode = 'recent_sessions'">
              최근 N회차
            </button>
            <button type="button" class="sp-toggle-btn" :class="{ active: gamesLogMode === 'session_range' }" @click="gamesLogMode = 'session_range'">
              회차 구간
            </button>
            <button type="button" class="sp-toggle-btn" :class="{ active: gamesLogMode === 'session' }" @click="gamesLogMode = 'session'">
              특정 회차
            </button>
          </div>
        </div>

        <!-- 일자 선택 -->
        <div v-if="gamesLogMode === 'date'" class="sp-log-subpanel">
          <div class="sp-scope-inline-input">
            <label class="sp-field-label">일자:</label>
            <input v-model="selectedLogDate" type="date" class="sp-date-input" />
          </div>
          <div class="sp-date-chips" v-if="availableIsoDates.length > 0">
            <span class="sp-quick-lbl">최근 모임 일자:</span>
            <button
              v-for="d in availableIsoDates.slice(0, 12)"
              :key="d"
              type="button"
              class="sp-quick-chip"
              :class="{ active: selectedLogDate === d }"
              @click="selectedLogDate = d"
            >
              {{ d }}
            </button>
          </div>
        </div>

        <!-- 일자 기간 -->
        <div v-else-if="gamesLogMode === 'date_range'" class="sp-log-subpanel">
          <div class="sp-scope-inline-input">
            <input v-model="logStartDate" type="date" class="sp-date-input" />
            <span>~</span>
            <input v-model="logEndDate" type="date" class="sp-date-input" />
          </div>
        </div>

        <!-- 최근 N회차 -->
        <div v-else-if="gamesLogMode === 'recent_sessions'" class="sp-log-subpanel">
          <div class="sp-scope-controls" style="border-top: none; padding-top: 0;">
            <div class="sp-scope-presets">
              <button
                v-for="n in [1, 3, 5, 10, 15]"
                :key="'lrs-' + n"
                type="button"
                class="sp-quick-chip"
                :class="{ active: logRecentSessionsCount === n }"
                @click="logRecentSessionsCount = n"
              >
                최근 {{ n }}회차
              </button>
            </div>
            <div class="sp-scope-inline-input">
              <span>직접 입력:</span>
              <input v-model.number="logRecentSessionsCount" type="number" min="1" :max="Math.max(1, sortedSessionsDesc.length)" class="sp-num-input" />
              <span>회차</span>
            </div>
          </div>
        </div>

        <!-- 회차 구간 -->
        <div v-else-if="gamesLogMode === 'session_range'" class="sp-log-subpanel">
          <div class="sp-scope-controls" style="border-top: none; padding-top: 0;">
            <div class="sp-scope-inline-input">
              <input v-model.number="logStartNum" type="number" min="1" :max="maxSessionNumber" class="sp-num-input compact" @change="applyLogSessionNums" @keyup.enter="applyLogSessionNums" />
              <span>회차 ~</span>
              <input v-model.number="logEndNum" type="number" min="1" :max="maxSessionNumber" class="sp-num-input compact" @change="applyLogSessionNums" @keyup.enter="applyLogSessionNums" />
              <span>회차</span>
              <button type="button" class="sp-action-btn primary" @click="applyLogSessionNums">적용</button>
            </div>
            <div class="sp-scope-inline-input">
              <select v-model="logStartSession" class="sp-select-box" @change="syncLogSessionNumsFromLabels">
                <option v-for="s in sortedSessionsAsc" :key="'l-ss-' + s" :value="s">{{ s }}</option>
              </select>
              <span>~</span>
              <select v-model="logEndSession" class="sp-select-box" @change="syncLogSessionNumsFromLabels">
                <option v-for="s in sortedSessionsDesc" :key="'l-se-' + s" :value="s">{{ s }}</option>
              </select>
            </div>
          </div>
        </div>

        <!-- 특정 회차 -->
        <div v-else-if="gamesLogMode === 'session'" class="sp-log-subpanel">
          <div class="sp-scope-inline-input">
            <label class="sp-field-label">회차 선택:</label>
            <select v-model="selectedLogSession" class="sp-select-box">
              <option v-for="s in sortedSessionsDesc" :key="'l-s-' + s" :value="s">{{ s }}</option>
            </select>
          </div>
        </div>

        <div class="sp-table-scroll" style="margin-top: 10px;" v-if="filteredLogGames.length > 0">
          <table class="sp-table">
            <thead>
              <tr>
                <th>#</th>
                <th>회차</th>
                <th>일자</th>
                <th>1위</th>
                <th>2위</th>
                <th>3위</th>
                <th>4위</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(g, idx) in filteredLogGames" :key="'log-' + g.gameIndex + '-' + idx">
                <td class="muted nowrap">{{ filteredLogGames.length - idx }}</td>
                <td class="nowrap">{{ g.displaySession }}</td>
                <td class="nowrap muted">{{ g.displayDate || '-' }}</td>
                <td v-for="pl in g.players" :key="pl.rank + pl.name" class="nowrap">
                  <button type="button" class="table-player-link" @click="selectPlayer(pl.name)">
                    {{ pl.name }}
                  </button>
                  <div class="log-cell-sub">
                    <span>{{ pl.score.toLocaleString() }}</span>
                    <span :class="pl.uma >= 0 ? 'pos' : 'neg'">
                      ({{ pl.uma > 0 ? '+' : '' }}{{ pl.uma.toFixed(1) }})
                    </span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="sp-loading-box">선택한 조건에 해당하는 대국 기록이 없습니다.</div>
      </div>
    </div>

    <!-- ===================================================== -->
    <!-- SUB-TAB 5: 기록 플레이어 수 (회차별 통합 + N국 이상)     -->
    <!-- ===================================================== -->
    <div v-else-if="activeSubTab === 'players-count'" class="sp-section">
      <div class="sp-card sp-filter-panel">
        <div class="sp-filter-row">
          <span class="sp-filter-lbl">최소 국 수 필터:</span>
          <button
            v-for="mr in [0, 50, 100, 200, 300]"
            :key="'pcmr-' + mr"
            type="button"
            class="sp-chip-filter"
            :class="{ active: playersCountMinRounds === mr }"
            @click="playersCountMinRounds = mr"
          >
            {{ mr === 0 ? '전체' : `${mr}국 이상` }}
          </button>
          <div class="sp-inline-num-wrap">
            <input v-model.number="playersCountMinRounds" type="number" min="0" step="10" class="sp-num-input compact" />
            <span class="sp-unit-lbl">국 이상</span>
          </div>
        </div>
      </div>

      <div class="sp-kpi-cards-grid">
        <div class="sp-summary-kpi-card">
          <span class="sk-label">기록 플레이어 수</span>
          <strong class="sk-value">{{ playersCountFilteredMembers.length }}명</strong>
        </div>
        <div class="sp-summary-kpi-card">
          <span class="sk-label">누적 총 대국 수</span>
          <strong class="sk-value">{{ ratingHistory.length.toLocaleString() }}전</strong>
        </div>
        <div class="sp-summary-kpi-card">
          <span class="sk-label">세부 집계 국 수 (제9회~)</span>
          <strong class="sk-value">{{ totalDetailedRoundsAll.toLocaleString() }}국</strong>
        </div>
        <div class="sp-summary-kpi-card">
          <span class="sk-label">평균 레이팅</span>
          <strong class="sk-value" :style="{ color: getRatingColor(averageLeagueRating) }">
            R{{ averageLeagueRating }}
          </strong>
        </div>
      </div>

      <div class="sp-card">
        <div class="sp-card-header">
          <h4>레이팅 구간별 기록 플레이어 분포</h4>
        </div>
        <div class="sp-dist-bars">
          <div v-for="band in playersCountBandRows" :key="'pc-' + band.key" class="sp-dist-bar-row">
            <span class="db-label" :style="{ color: band.color }">{{ band.label }}</span>
            <div class="db-track">
              <div
                class="db-fill"
                :style="{
                  width: (band.playerCount / maxPlayersCountBand) * 100 + '%',
                  backgroundColor: band.color,
                }"
              ></div>
            </div>
            <span class="db-count">{{ band.playerCount }}명</span>
          </div>
        </div>
      </div>

      <div class="sp-card">
        <div class="sp-card-header">
          <h4>회차별 참여 인원 및 대국 수 (총 {{ sessionParticipationRows.length }}회차)</h4>
          <span class="sp-card-sub">회차 행 클릭 시 해당 회차의 대국 기록으로 이동합니다</span>
        </div>
        <div class="sp-table-scroll">
          <table class="sp-table sp-data-table">
            <thead>
              <tr>
                <th>회차</th>
                <th>일자</th>
                <th>참여 플레이어 수</th>
                <th>진행 대국 수</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in sessionParticipationRows"
                :key="row.sessionLabel"
                class="clickable-row"
                @click="openSessionInGamesLog(row.sessionLabel)"
              >
                <td class="nowrap"><strong>{{ row.sessionLabel }}</strong></td>
                <td class="nowrap muted">{{ row.date || '-' }}</td>
                <td>{{ row.playerCount }}명</td>
                <td>{{ row.gameCount }}전</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 라이트 / 다크 테마 CSS 변수 통합 정의 (props.isDark + html.dark 동시 지원) */
.stat-page-root {
  --sp-root-bg: transparent;
  --sp-card-bg: #ffffff;
  --sp-sub-bg: #f8fafc;
  --sp-nav-bg: #f1f5f9;
  --sp-input-bg: #ffffff;
  --sp-th-bg: #f8fafc;
  --sp-border: #e2e8f0;
  --sp-border-strong: #cbd5e1;
  --sp-text: #0f172a;
  --sp-text-secondary: #334155;
  --sp-text-muted: #64748b;
  --sp-accent: #0284c7;
  --sp-hover-bg: rgba(2, 132, 199, 0.08);
  --sp-summary-bg: rgba(15, 23, 42, 0.04);
  --sp-row-divider: rgba(226, 232, 240, 0.8);
  --sp-pos: #16a34a;
  --sp-neg: #dc2626;
  --sp-banner-bg: #f8fafc;
  --sp-banner-border: #cbd5e1;
  --sp-rating-pill-bg: #ffffff;
  --sp-rank-pill-bg: #0f172a;
  --sp-rank-pill-text: #ffffff;
  --sp-chip-active-bg: #0f172a;
  --sp-chip-active-text: #ffffff;

  display: flex;
  flex-direction: column;
  gap: 14px;
  color: var(--sp-text);
  background: var(--sp-root-bg);
}

/* 다크모드: 보라/남색 기운 완전 제거, 순수 블랙 & 뉴트럴 다크 그레이 팔레트 */
.stat-page-root.dark {
  --sp-root-bg: #0b0b0b;
  --sp-card-bg: #141414;
  --sp-sub-bg: #1d1d1d;
  --sp-nav-bg: #121212;
  --sp-input-bg: #0a0a0a;
  --sp-th-bg: #1c1c1c;
  --sp-border: #2c2c2c;
  --sp-border-strong: #404040;
  --sp-text: #f5f5f5;
  --sp-text-secondary: #e5e5e5;
  --sp-text-muted: #a8a8a8;
  --sp-accent: #60a5fa;
  --sp-hover-bg: rgba(255, 255, 255, 0.08);
  --sp-summary-bg: #1f1f1f;
  --sp-row-divider: #262626;
  --sp-pos: #4ade80;
  --sp-neg: #f87171;
  --sp-banner-bg: #151515;
  --sp-banner-border: #333333;
  --sp-rating-pill-bg: #0a0a0a;
  --sp-rank-pill-bg: #2563eb;
  --sp-rank-pill-text: #ffffff;
  --sp-chip-active-bg: #2563eb;
  --sp-chip-active-text: #ffffff;
  color-scheme: dark;
  background-color: #0b0b0b !important;
  padding: 10px;
  border-radius: 12px;
}
.stat-page-root.dark .sp-card,
.stat-page-root.dark .sp-search-card,
.stat-page-root.dark .sp-stat-section-card,
.stat-page-root.dark .sp-player-scope-card,
.stat-page-root.dark .sp-summary-kpi-card {
  background-color: #141414 !important;
  border-color: #2c2c2c !important;
  color: #f5f5f5 !important;
  box-shadow: none !important;
}
.stat-page-root.dark .sp-subnav {
  background-color: #121212 !important;
  border-color: #2c2c2c !important;
}
.stat-page-root.dark .sp-profile-banner {
  background: #151515 !important;
  border-color: #333333 !important;
}
.stat-page-root.dark .sp-metric-tile,
.stat-page-root.dark .sp-opp-card,
.stat-page-root.dark .sp-log-subpanel,
.stat-page-root.dark .sp-toggle-group,
.stat-page-root.dark .sp-tile-hist-drawer {
  background-color: #1b1b1b !important;
  border-color: #323232 !important;
  color: #f5f5f5 !important;
}
.stat-page-root.dark .sp-input-box,
.stat-page-root.dark .sp-num-input,
.stat-page-root.dark .sp-date-input,
.stat-page-root.dark .sp-select-box,
.stat-page-root.dark .sp-dropdown {
  background-color: #0a0a0a !important;
  border-color: #3d3d3d !important;
  color: #f5f5f5 !important;
}
.stat-page-root.dark .sp-table,
.stat-page-root.dark .sp-table td {
  background-color: #141414 !important;
  color: #f5f5f5 !important;
}
.stat-page-root.dark .sp-table th {
  background-color: #1e1e1e !important;
  color: #e5e5e5 !important;
}
.stat-page-root.dark .sp-table tbody tr.summary-row td {
  background-color: #1f1f1f !important;
}
.stat-page-root.dark .sp-table tbody tr.clickable-row:hover td {
  background-color: #222222 !important;
}

/* 상단 서브탭 */
.sp-subnav {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px;
  border-radius: 10px;
  background: var(--sp-nav-bg);
  border: 1px solid var(--sp-border);
}
.sp-subnav-btn {
  padding: 7px 14px;
  border-radius: 7px;
  border: none;
  background: transparent;
  color: var(--sp-text-secondary);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s ease, color 0.15s ease;
}
.sp-subnav-btn:hover {
  background: var(--sp-hover-bg);
  color: var(--sp-accent);
}
.sp-subnav-btn.active {
  background: #0284c7;
  color: #ffffff;
  box-shadow: 0 2px 6px rgba(2, 132, 199, 0.3);
}

.sp-section {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* 카드 공통 */
.sp-card,
.sp-search-card,
.sp-stat-section-card,
.sp-player-scope-card {
  background: var(--sp-card-bg);
  border: 1px solid var(--sp-border);
  border-radius: 12px;
  padding: 16px;
  color: var(--sp-text);
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06);
}

.sp-filter-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 13px 15px;
}
.sp-filter-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
}

.sp-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.sp-card-header h4 {
  margin: 0;
  font-size: 14.5px;
  font-weight: 800;
  color: var(--sp-text);
}
.sp-card-sub {
  font-size: 11.5px;
  color: var(--sp-text-muted);
}

/* 검색 카드 */
.sp-search-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}
.sp-heading {
  margin: 0;
  font-size: 17px;
  font-weight: 800;
  color: var(--sp-text);
}
.sp-sub-hint {
  font-size: 12px;
  color: var(--sp-text-muted);
}

.sp-autocomplete-wrap {
  position: relative;
}
.sp-input-box {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1.5px solid var(--sp-border-strong);
  border-radius: 10px;
  padding: 9px 12px;
  background: var(--sp-input-bg);
  transition: border-color 0.15s ease;
}
.sp-input-box:focus-within {
  border-color: var(--sp-accent);
  box-shadow: 0 0 0 3px rgba(2, 132, 199, 0.16);
}
.sp-search-svg {
  color: var(--sp-text-muted);
  flex-shrink: 0;
}
.sp-search-input {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--sp-text);
  font-size: 14.5px;
  font-family: inherit;
  outline: none;
}
.sp-search-input::placeholder {
  color: var(--sp-text-muted);
}
.sp-clear-btn {
  border: none;
  background: rgba(148, 163, 184, 0.22);
  color: var(--sp-text);
  width: 22px;
  height: 22px;
  border-radius: 50%;
  font-size: 11px;
  cursor: pointer;
}

.sp-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 50;
  max-height: 280px;
  overflow-y: auto;
  background: var(--sp-input-bg);
  border: 1px solid var(--sp-border-strong);
  border-radius: 10px;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.28);
  padding: 4px;
}
.sp-dropdown-item {
  width: 100%;
  border: none;
  background: transparent;
  color: var(--sp-text);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 7px;
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
}
.sp-dropdown-item.highlighted,
.sp-dropdown-item:hover {
  background: var(--sp-hover-bg);
}
.sp-dropdown-item.selected {
  font-weight: 800;
}
.sp-dd-name {
  font-weight: 700;
  color: var(--sp-text);
}
.sp-dd-meta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--sp-text-muted);
}
.sp-dd-rating {
  font-weight: 800;
}

.sp-min-rounds-row,
.sp-quick-players,
.sp-date-chips {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.sp-inline-num-wrap {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.sp-unit-lbl {
  font-size: 12px;
  color: var(--sp-text-muted);
}
.sp-quick-lbl,
.sp-filter-lbl,
.sp-field-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--sp-text-muted);
  white-space: nowrap;
}

.sp-quick-chip {
  border: 1px solid var(--sp-border-strong);
  background: var(--sp-sub-bg);
  color: var(--sp-text-secondary);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.sp-quick-chip:hover {
  border-color: var(--sp-accent);
  color: var(--sp-accent);
}
.sp-quick-chip.active {
  background: #0284c7;
  border-color: #0284c7;
  color: #ffffff;
}
.sp-chip-r {
  font-size: 10.5px;
  font-weight: 800;
}

/* 개인별 기간/구간 필터 카드 */
.sp-player-scope-card {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.sp-scope-top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}
.sp-scope-title-wrap {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.sp-scope-badge {
  font-size: 11.5px;
  font-weight: 800;
  color: var(--sp-accent);
  background: var(--sp-hover-bg);
  padding: 2px 8px;
  border-radius: 999px;
}
.sp-scope-active-label {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--sp-text);
}
.sp-scope-sub-pill {
  font-size: 11px;
  font-weight: 600;
  color: var(--sp-text-muted);
  background: var(--sp-sub-bg);
  border: 1px solid var(--sp-border);
  padding: 2px 7px;
  border-radius: 999px;
}
.sp-scope-modes {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.sp-scope-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--sp-border-strong);
}
.sp-scope-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.sp-scope-inline-input {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12.5px;
  color: var(--sp-text-secondary);
}
.sp-num-input {
  width: 68px;
  padding: 6px 8px;
  border-radius: 7px;
  border: 1px solid var(--sp-border-strong);
  background: var(--sp-input-bg);
  color: var(--sp-text);
  font-size: 13px;
  font-weight: 700;
  text-align: center;
  font-family: inherit;
}
.sp-num-input.compact {
  width: 62px;
  padding: 4px 6px;
  font-size: 12px;
}
.sp-empty-scope-box {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 22px 16px;
}
.sp-empty-scope-box p {
  margin: 0;
  font-size: 13.5px;
}

/* 개인 풀페이지 프로필 배너 */
.sp-player-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.sp-profile-banner {
  background: var(--sp-banner-bg);
  border: 1.5px solid var(--sp-banner-border);
  border-radius: 14px;
  padding: 16px 18px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}
.sp-profile-title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}
.sp-rank-pill {
  background: var(--sp-rank-pill-bg);
  color: var(--sp-rank-pill-text);
  font-size: 12px;
  font-weight: 800;
  padding: 2px 8px;
  border-radius: 999px;
}
.sp-player-name {
  margin: 0;
  font-size: 22px;
  font-weight: 900;
  color: var(--sp-text);
}
.sp-rating-pill {
  font-size: 13px;
  font-weight: 900;
  padding: 2px 9px;
  border-radius: 7px;
  border: 1.5px solid currentColor;
  background: var(--sp-rating-pill-bg);
}
.sp-peak-note {
  font-size: 11.5px;
  color: var(--sp-text-muted);
  font-weight: 600;
}

.sp-profile-kpi-row {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}
.sp-kpi {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sp-kpi .kpi-lbl {
  font-size: 11px;
  color: var(--sp-text-muted);
}
.sp-kpi .kpi-val {
  font-size: 15px;
  font-weight: 800;
  color: var(--sp-text);
}

.sp-profile-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.sp-action-btn {
  padding: 7px 12px;
  border-radius: 8px;
  border: 1px solid var(--sp-border-strong);
  background: var(--sp-sub-bg);
  color: var(--sp-text);
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  font-family: inherit;
}
.sp-action-btn:hover {
  border-color: var(--sp-accent);
}
.sp-action-btn.primary {
  background: #2563eb;
  border-color: #2563eb;
  color: #ffffff;
}
.sp-action-btn.primary:hover {
  background: #1d4ed8;
  border-color: #1d4ed8;
}

/* 순위 분포 스택 바 */
.sp-rank-stacked-bar {
  display: flex;
  height: 26px;
  border-radius: 8px;
  overflow: hidden;
  width: 100%;
  background: rgba(148, 163, 184, 0.2);
}
.sp-rank-stacked-bar .seg {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
}
.seg.s1, .dot.s1 { background: #16a34a; }
.seg.s2, .dot.s2 { background: #2563eb; }
.seg.s3, .dot.s3 { background: #d97706; }
.seg.s4, .dot.s4 { background: #dc2626; }

.sp-rank-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--sp-text-secondary);
}
.sp-rank-legend .dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  margin-right: 4px;
}

/* 인라인 히스토그램 */
.sp-dist-inline-card {
  border-color: var(--sp-accent);
}
.sp-dist-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.sp-pct-badge {
  font-size: 11px;
  font-weight: 800;
  padding: 2px 7px;
  border-radius: 999px;
}
.sp-pct-badge.pos {
  background: rgba(22, 163, 74, 0.16);
  color: var(--sp-pos);
}
.sp-pct-badge.neg {
  background: rgba(220, 38, 38, 0.16);
  color: var(--sp-neg);
}
.sp-mini-close,
.sp-mini-toggle {
  border: 1px solid var(--sp-border-strong);
  background: var(--sp-sub-bg);
  color: var(--sp-text);
  border-radius: 6px;
  padding: 4px 9px;
  font-size: 11.5px;
  font-weight: 700;
  cursor: pointer;
  font-family: inherit;
}
.sp-mini-toggle:hover,
.sp-mini-close:hover {
  border-color: var(--sp-accent);
  color: var(--sp-accent);
}
.sp-inline-hist-wrap {
  height: 76px;
  border-radius: 8px;
  background: var(--sp-sub-bg);
  overflow: hidden;
  padding: 4px;
}
.sp-inline-svg {
  width: 100%;
  height: 100%;
  display: block;
}
.sp-bar-hit {
  cursor: pointer;
}
.sp-inline-hist-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
  font-size: 11.5px;
  color: var(--sp-text-muted);
}
.sp-inline-hover-mid {
  color: var(--sp-accent);
  font-weight: 600;
}

/* 스탯 타일 그리드 */
.sp-stat-notice {
  font-size: 12px;
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.12);
  border: 1px solid rgba(245, 158, 11, 0.34);
  border-radius: 8px;
  padding: 8px 12px;
}
.sp-metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 9px;
}
.sp-metric-tile {
  text-align: left;
  border: 1px solid var(--sp-border);
  background: var(--sp-sub-bg);
  color: var(--sp-text);
  border-radius: 10px;
  padding: 10px 12px;
  cursor: pointer;
  font-family: inherit;
  transition: border-color 0.15s ease, transform 0.12s ease;
}
.sp-metric-tile:hover {
  border-color: var(--sp-accent);
  transform: translateY(-1px);
}
.sp-metric-tile.inspected {
  border-color: var(--sp-accent);
  box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.25);
}
.tile-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 4px;
  margin-bottom: 4px;
}
.tile-label {
  font-size: 11.5px;
  color: var(--sp-text-muted);
  font-weight: 600;
}
.tile-pct {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 4px;
}
.tile-pct.pos {
  background: rgba(22, 163, 74, 0.15);
  color: var(--sp-pos);
}
.tile-pct.neg {
  background: rgba(220, 38, 38, 0.15);
  color: var(--sp-neg);
}
.tile-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.tile-value {
  font-size: 15px;
  font-weight: 800;
  color: var(--sp-text);
}
.tile-chevron {
  font-size: 11px;
  color: var(--sp-text-muted);
}

/* 스탯 섹션 박스 바로 아래 펼쳐지는 풀-폭 히스토그램 드로어 */
.sp-tile-hist-drawer {
  border: 1.5px solid var(--sp-accent);
  background: var(--sp-card-bg);
  border-radius: 12px;
  padding: 14px 16px;
  margin-top: -6px;
  box-shadow: 0 2px 10px rgba(15, 23, 42, 0.08);
  animation: spDrawerOpen 0.16s ease-out;
}
@keyframes spDrawerOpen {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.sp-drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 13px;
}
.sp-drawer-scope {
  font-size: 11px;
  color: var(--sp-text-muted);
  font-weight: 600;
}
.sp-drawer-rbands {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 8px;
  padding-top: 7px;
  border-top: 1px dashed var(--sp-border-strong);
}
.sp-rband-lbl {
  font-size: 11px;
  font-weight: 700;
  color: var(--sp-text-muted);
  margin-right: 2px;
}
.sp-rband-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--sp-border-strong);
  background: var(--sp-card-bg);
  color: var(--sp-text-secondary);
  border-radius: 6px;
  padding: 2.5px 7px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
}
.sp-rband-chip.active {
  border-color: var(--rb-color, var(--sp-accent));
  box-shadow: 0 0 0 1px var(--rb-color, var(--sp-accent));
}
.sp-rb-dash {
  display: inline-block;
  width: 10px;
  height: 0;
  border-top: 2px solid currentColor;
}
.sp-stable-pill {
  font-size: 12px;
  font-weight: 800;
  padding: 2px 8px;
  border-radius: 7px;
  border: 1.5px dashed currentColor;
  background: var(--sp-rating-pill-bg);
}

/* 고타점 방총 배지 및 컨트롤 */
.sp-dealin-header-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.compact-sel {
  padding: 5px 8px;
  font-size: 12px;
}
.sp-dealin-summary-chips {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}
.dealin-tier-badge {
  display: inline-block;
  margin-left: 5px;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10.5px;
  font-weight: 800;
}
.dealin-tier-badge.tier-mangan {
  background: rgba(245, 158, 11, 0.16);
  color: #d97706;
}
.dealin-tier-badge.tier-haneman {
  background: rgba(249, 115, 22, 0.18);
  color: #ea580c;
}
.dealin-tier-badge.tier-baiman {
  background: rgba(239, 68, 68, 0.18);
  color: #dc2626;
}
.dealin-tier-badge.tier-sanbaiman {
  background: rgba(225, 29, 72, 0.22);
  color: #e11d48;
}
.dealin-tier-badge.tier-yakuman {
  background: rgba(234, 179, 8, 0.28);
  color: #eab308;
}
.stat-page-root.dark .dealin-tier-badge.tier-mangan { color: #fbbf24; }
.stat-page-root.dark .dealin-tier-badge.tier-haneman { color: #fb923c; }
.stat-page-root.dark .dealin-tier-badge.tier-baiman { color: #f87171; }
.stat-page-root.dark .dealin-tier-badge.tier-sanbaiman { color: #fb7185; }
.stat-page-root.dark .dealin-tier-badge.tier-yakuman { color: #fde047; }
.dealin-meta-tag {
  display: inline-block;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(148, 163, 184, 0.18);
  font-size: 10.5px;
  margin: 0 2px;
}
.neg-link {
  color: var(--sp-neg) !important;
}

/* 자주 만난 상대 */
.sp-opponents-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(175px, 1fr));
  gap: 9px;
}
.sp-opp-card {
  border: 1px solid var(--sp-border);
  background: var(--sp-sub-bg);
  color: var(--sp-text-secondary);
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}
.opp-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.opp-name-btn {
  border: none;
  background: transparent;
  padding: 0;
  color: var(--sp-text);
  font-size: 13.5px;
  font-weight: 800;
  cursor: pointer;
  font-family: inherit;
}
.opp-name-btn:hover {
  color: var(--sp-accent);
  text-decoration: underline;
}
.opp-vs-mini {
  border: none;
  border-radius: 5px;
  padding: 2px 6px;
  font-size: 10px;
  font-weight: 900;
  color: #ffffff;
  background: linear-gradient(135deg, #2563eb, #e11d48);
  cursor: pointer;
}

/* 토글 / 필터 컨트롤 */
.sp-toggle-group {
  display: inline-flex;
  flex-wrap: wrap;
  border: 1px solid var(--sp-border-strong);
  border-radius: 8px;
  overflow: hidden;
  background: var(--sp-sub-bg);
}
.sp-toggle-btn {
  border: none;
  border-right: 1px solid var(--sp-border);
  background: transparent;
  color: var(--sp-text-secondary);
  padding: 6px 12px;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  font-family: inherit;
}
.sp-toggle-btn:last-child {
  border-right: none;
}
.sp-toggle-btn.active {
  background: #0284c7;
  color: #ffffff;
}

.sp-chip-filter {
  border: 1px solid var(--sp-border-strong);
  background: var(--sp-sub-bg);
  color: var(--sp-text-secondary);
  border-radius: 6px;
  padding: 4px 9px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
}
.sp-chip-filter:hover {
  border-color: var(--sp-accent);
  color: var(--sp-accent);
}
.sp-chip-filter.active {
  background: var(--sp-chip-active-bg);
  border-color: var(--sp-chip-active-bg);
  color: var(--sp-chip-active-text);
}

.sp-log-subpanel {
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--sp-sub-bg);
  border: 1px solid var(--sp-border);
}

.sp-date-input,
.sp-select-box {
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--sp-border-strong);
  background: var(--sp-input-bg);
  color: var(--sp-text);
  font-size: 13px;
  font-family: inherit;
}

/* 테이블 공통 */
.sp-table-scroll {
  overflow-x: auto;
  border-radius: 8px;
  border: 1px solid var(--sp-border);
}
.sp-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
  text-align: center;
  color: var(--sp-text);
}
.sp-table th {
  background: var(--sp-th-bg);
  color: var(--sp-text-secondary);
  padding: 9px 10px;
  font-weight: 800;
  border-bottom: 1.5px solid var(--sp-border);
  white-space: nowrap;
}
.sp-table td {
  padding: 8px 10px;
  color: var(--sp-text);
  border-bottom: 1px solid var(--sp-row-divider);
}
.sp-table tbody tr:last-child td {
  border-bottom: none;
}
.sp-table tbody tr.clickable-row {
  cursor: pointer;
}
.sp-table tbody tr.clickable-row:hover {
  background: var(--sp-hover-bg);
}
.sp-table tbody tr.summary-row {
  background: var(--sp-summary-bg);
  border-top: 1.5px solid var(--sp-border-strong);
}

.band-color-dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  margin-right: 6px;
  vertical-align: middle;
}
.band-expand-row td {
  background: var(--sp-sub-bg);
  text-align: left;
  padding: 10px 12px;
}
.band-players-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.band-player-chip {
  border: 1px solid var(--sp-border-strong);
  background: var(--sp-card-bg);
  color: var(--sp-text);
  border-radius: 999px;
  padding: 3px 9px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.band-player-chip:hover {
  border-color: var(--sp-accent);
}

.table-player-link {
  border: none;
  background: transparent;
  padding: 0;
  color: var(--sp-accent);
  font-weight: 700;
  font-size: 12.5px;
  cursor: pointer;
  font-family: inherit;
}
.table-player-link:hover {
  text-decoration: underline;
}
.log-cell-sub {
  font-size: 11px;
  color: var(--sp-text-muted);
}

.rank-chip {
  display: inline-block;
  padding: 2px 7px;
  border-radius: 6px;
  font-weight: 800;
  font-size: 11.5px;
  color: #ffffff;
}
.rank-chip.r1 { background: #16a34a; }
.rank-chip.r2 { background: #2563eb; }
.rank-chip.r3 { background: #d97706; }
.rank-chip.r4 { background: #dc2626; }

.players-inline-cell {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  justify-content: center;
}
.inline-pl-chip {
  border: 1px solid var(--sp-border-strong);
  background: transparent;
  color: var(--sp-text-secondary);
  border-radius: 5px;
  padding: 1px 6px;
  font-size: 11px;
  cursor: pointer;
  font-family: inherit;
}
.inline-pl-chip.isme {
  background: var(--sp-hover-bg);
  border-color: var(--sp-accent);
  color: var(--sp-text);
  font-weight: 800;
}

/* 자리별 시각화 */
.sp-seat-bars {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.sp-seat-bar-row {
  display: grid;
  grid-template-columns: 32px 1fr 62px;
  align-items: center;
  gap: 10px;
}
.seat-bar-label {
  font-size: 15px;
  font-weight: 900;
  text-align: center;
  color: var(--sp-text);
}
.seat-bar-avg {
  font-size: 12.5px;
  font-weight: 800;
  text-align: right;
  color: var(--sp-text);
}
.sp-rank-stacked-bar.empty-seat-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--sp-sub-bg);
  border: 1px dashed var(--sp-border-strong);
}

/* 기록 플레이어 현황 */
.sp-kpi-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
}
.sp-summary-kpi-card {
  background: var(--sp-card-bg);
  border: 1px solid var(--sp-border);
  border-radius: 12px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sk-label {
  font-size: 11.5px;
  color: var(--sp-text-muted);
  font-weight: 600;
}
.sk-value {
  font-size: 20px;
  font-weight: 900;
  color: var(--sp-text);
}

.sp-dist-bars {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sp-dist-bar-row {
  display: grid;
  grid-template-columns: 98px 1fr 48px;
  align-items: center;
  gap: 10px;
  font-size: 12.5px;
}
.db-label {
  font-weight: 800;
  text-align: right;
}
.db-track {
  height: 14px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.2);
  overflow: hidden;
}
.db-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.3s ease;
}
.db-count {
  font-weight: 700;
  color: var(--sp-text);
}

.sp-footer-count {
  margin: 0;
  font-size: 12.5px;
  color: var(--sp-text-muted);
}
.sp-loading-box {
  text-align: center;
  padding: 28px 14px;
  font-size: 13px;
  color: var(--sp-text-muted);
}

.nowrap { white-space: nowrap; }
.muted { color: var(--sp-text-muted); }
.muted-mini { font-size: 11px; color: var(--sp-text-muted); }
.delta-mini { font-size: 11px; margin-left: 2px; }
.pos { color: var(--sp-pos); font-weight: 700; }
.neg { color: var(--sp-neg); font-weight: 700; }

@media (max-width: 640px) {
  .sp-card,
  .sp-search-card,
  .sp-stat-section-card {
    padding: 12px;
  }
  .sp-metrics-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 7px;
  }
  .sp-subnav-btn {
    padding: 6px 10px;
    font-size: 12px;
  }
  .sp-player-name {
    font-size: 19px;
  }
}
</style>
