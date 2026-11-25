<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { Line as LineChart } from 'vue-chartjs';
import {
  Chart as ChartJS,
  Title,
  Tooltip,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  CategoryScale,
  type ChartOptions,
} from 'chart.js';
import {
  DEFAULT_EVENT_CONFIG,
  EVENT_MATCH_MAP,
  EVENT_PLAYERS,
  EVENT_PLAYER_MAP,
  EVENT_TEAMS,
  EVENT_TEAM_MAP,
  formatEventPlayerName,
  getMatchKey,
  getRoundMatches,
  matchesEventPlayerQuery,
  shouldShowNameParentheses,
  type EventMatchSlot,
  type EventScoringConfig,
  type TeamId,
} from '@/data/knuNpm2026';
import {
  buildCustomSandboxLiveSnapshot,
  buildEventCsv,
  computeLeagueStandings,
  computeRoundTimerDisplay,
  formatDualMetric,
  formatSignedPoint,
  normalizeConfig,
  runEventQaSelfTest,
  type EventStatePayload,
  type LiveStatePayload,
  type LiveTableState,
  type PlayerStanding,
  type QaSelfTestReport,
  type StoredTableResult,
  type TableScoreEntryInput,
} from '@/utils/knuNpmScoring';
import {
  EVENT_LOCALES,
  createEventTranslator,
  type EventLocale,
} from '@/locales/knuNpmEvent';
import {
  clearStaffPin,
  deleteTableResult,
  fetchEventState,
  fetchEventStateIfChanged,
  fetchLiveState,
  fetchLiveStateIfChanged,
  getSavedStaffPin,
  getSyncedNowMs,
  resetSandboxData,
  rollbackAuditEntry,
  saveStaffPin,
  seedSandboxData,
  seedSandboxEdgeCases,
  seedSandboxLiveGames,
  submitTableResult,
  subscribeEventStateUpdates,
  subscribeLiveStateUpdates,
  updateEventConfig,
  updateSandboxQuickTimer,
  upsertLiveTableState,
  verifyStaffPin,
} from '@/services/knuNpmEventService';
import { getKnuNpmBasePath, getKnuNpmLiveMonitorPath } from '@/utils/eventMode';
import EventSeatPickerModal from '@/components/event/EventSeatPickerModal.vue';
import EventScoreModal from '@/components/event/EventScoreModal.vue';
import EventPlayerModal from '@/components/event/EventPlayerModal.vue';
import EventMatchDetailModal from '@/components/event/EventMatchDetailModal.vue';
import EventStaffModal from '@/components/event/EventStaffModal.vue';

ChartJS.register(Title, Tooltip, Legend, LineElement, LinearScale, PointElement, CategoryScale);

interface Props {
  isSandbox?: boolean;
  eventLocale: EventLocale;
  activeScorerKey?: string | null;
}
const props = withDefaults(defineProps<Props>(), {
  isSandbox: false,
  activeScorerKey: null,
});

const emit = defineEmits<{
  (e: 'change-locale', loc: EventLocale): void;
  (
    e: 'launch-scorer',
    payload: {
      round: number;
      table: number;
      seatPlayerIds: [number, number, number, number];
      config: EventScoringConfig;
      sandbox: boolean;
      priorPoints: [number, number, number, number];
    }
  ): void;
  (
    e: 'continue-live-scorer',
    payload: {
      liveGame: LiveTableState;
      config: EventScoringConfig;
      sandbox: boolean;
      priorPoints: [number, number, number, number];
    }
  ): void;
  (e: 'resume-scorer'): void;
}>();

const router = useRouter();
const route = useRoute();
const tr = createEventTranslator(() => props.eventLocale);

type EventTab = 'standings' | 'stats' | 'schedule' | 'rosters' | 'rules';
const activeTab = ref<EventTab>('standings');
const selectedRound = ref<number>(1);
const scheduleViewMode = ref<'cards' | 'matrix'>('cards');
const highlightPlayerId = ref<number | ''>('');

// Filters for Standings / Detailed Stats
const searchQuery = ref('');
const teamFilter = ref<'ALL' | TeamId>('ALL');
const roleFilter = ref<'ALL' | 'PRO' | 'PLAYER'>('ALL');
const standingsSortKey = ref<'rank' | 'totalPoints' | 'avgRank' | 'bestScore' | 'topRate'>('rank');
const standingsSortAsc = ref<boolean>(true);
const statsSortKey = ref<'trackedGames' | 'winRate' | 'dealInRate' | 'riichiRate' | 'avgWinScore' | 'roundSuji'>('winRate');
const statsSortAsc = ref<boolean>(false);

// State
const isLoading = ref(false);
const isSyncing = ref(false);
const isBusy = ref(false);
const loadError = ref('');
const toastMsg = ref('');
let toastTimer: ReturnType<typeof setTimeout> | null = null;

const state = ref<EventStatePayload>({
  updatedAt: 0,
  config: normalizeConfig(DEFAULT_EVENT_CONFIG),
  results: {},
  auditLog: [],
});

const liveState = ref<LiveStatePayload>({
  updatedAt: 0,
  liveGames: {},
});

// Staff Auth
const isStaff = ref(false);
const isStaffModalOpen = ref(false);

// Modals
const seatPickerSlot = ref<EventMatchSlot | null>(null);
const scoreModalSlot = ref<EventMatchSlot | null>(null);
const scoreModalPreset = ref<{
  scores: [number, number, number, number];
  riichiSticks: number;
  note?: string;
} | null>(null);
const selectedPlayerId = ref<number | null>(null);
const matchLogKey = ref<string | null>(null);

// Theme
const isDark = ref(
  typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : false
);

const toggleTheme = () => {
  isDark.value = !isDark.value;
  if (isDark.value) {
    document.documentElement.classList.add('dark');
    localStorage.setItem('theme', 'dark');
  } else {
    document.documentElement.classList.remove('dark');
    localStorage.setItem('theme', 'light');
  }
};

const showToast = (msg: string) => {
  toastMsg.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastMsg.value = '';
  }, 3000);
};

const lastCheckedAt = ref<number>(0);
const timerNowTick = ref<number>(Date.now());
let timerTickHandle: ReturnType<typeof setInterval> | null = null;

const dashboardTimerDisplay = computed(() => {
  void timerNowTick.value;
  const tmr = state.value.config.roundTimer;
  if (!tmr || tmr.status === 'idle') return null;
  return computeRoundTimerDisplay(tmr, getSyncedNowMs(props.isSandbox));
});

const handleStartSandboxTimer = async (durationMinutes: number) => {
  if (!props.isSandbox) return;
  const now = getSyncedNowMs(true);
  state.value = await updateSandboxQuickTimer({
    round: selectedRound.value,
    durationMinutes,
    extraHands: state.value.config.roundTimer?.extraHands ?? 0,
    status: 'running',
    endsAt: now + durationMinutes * 60_000,
    pausedRemainingMs: null,
    updatedAt: now,
  });
  showToast(`⏱ R${selectedRound.value} 타이머 시작 (${durationMinutes}+${state.value.config.roundTimer.extraHands}) — 전 기기 동기화됨!`);
};

// URL query parameter synchronization (tab, round, view, player, match)
const isApplyingRouteQuery = ref(false);

const applyQueryToDashboard = () => {
  isApplyingRouteQuery.value = true;
  try {
    const qTab = String(route.query.tab || '').trim();
    if (['standings', 'stats', 'schedule', 'rosters', 'rules'].includes(qTab)) {
      activeTab.value = qTab as EventTab;
    }
    const qRound = Number(route.query.round);
    if (Number.isInteger(qRound) && qRound >= 1 && qRound <= 6) {
      selectedRound.value = qRound;
    }
    const qView = String(route.query.view || '').trim();
    if (qView === 'cards' || qView === 'matrix') {
      scheduleViewMode.value = qView;
    }
    const qPlayer = Number(route.query.player);
    if (Number.isInteger(qPlayer) && EVENT_PLAYER_MAP[qPlayer]) {
      selectedPlayerId.value = qPlayer;
    } else if (!route.query.player && selectedPlayerId.value !== null) {
      selectedPlayerId.value = null;
    }
    const qMatch = String(route.query.match || '').trim();
    if (qMatch && qView !== 'scorer' && state.value.results[qMatch]) {
      matchLogKey.value = qMatch;
    }
  } finally {
    isApplyingRouteQuery.value = false;
  }
};

const syncDashboardUrlQuery = () => {
  if (isApplyingRouteQuery.value) return;
  if (route.query.view === 'scorer') return;
  const nextQuery: Record<string, string> = {};
  for (const [k, v] of Object.entries(route.query)) {
    if (typeof v === 'string' && v && !['tab', 'round', 'view', 'player', 'match', 'lang'].includes(k)) {
      nextQuery[k] = v;
    }
  }
  nextQuery.lang = props.eventLocale;
  nextQuery.tab = activeTab.value;
  if (activeTab.value === 'schedule') {
    nextQuery.round = String(selectedRound.value);
    if (scheduleViewMode.value === 'matrix') {
      nextQuery.view = 'matrix';
    }
  }
  if (selectedPlayerId.value !== null) {
    nextQuery.player = String(selectedPlayerId.value);
  }
  if (matchLogKey.value) {
    nextQuery.match = matchLogKey.value;
  }
  const curKeys = Object.keys(route.query).sort();
  const nextKeys = Object.keys(nextQuery).sort();
  const same =
    curKeys.length === nextKeys.length &&
    curKeys.every((k, i) => k === nextKeys[i] && String(route.query[k] ?? '') === nextQuery[k]);
  if (!same) {
    router.replace({ path: route.path, query: nextQuery }).catch(() => {});
  }
};

watch([activeTab, selectedRound, scheduleViewMode, selectedPlayerId, matchLogKey, () => props.eventLocale], () => {
  syncDashboardUrlQuery();
});

watch(
  () => route.query,
  () => {
    if (route.query.view !== 'scorer') {
      applyQueryToDashboard();
    }
  }
);

const lastCheckedText = computed(() => {
  const ts = lastCheckedAt.value || state.value.updatedAt;
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
});

const loadState = async (silent = false, force = false) => {
  if (!silent) isLoading.value = true;
  else isSyncing.value = true;
  loadError.value = '';
  try {
    if (silent && !force) {
      const shouldPollLive = props.isSandbox || activeTab.value === 'schedule';
      const [res, liveRes] = await Promise.all([
        fetchEventStateIfChanged(props.isSandbox, state.value.updatedAt),
        shouldPollLive
          ? fetchLiveStateIfChanged(props.isSandbox, liveState.value.updatedAt).catch(() => null)
          : Promise.resolve(null),
      ]);
      lastCheckedAt.value = Date.now();
      if (!res.unchanged) {
        state.value = res.state;
      }
      if (liveRes && !liveRes.unchanged) {
        liveState.value = liveRes.liveState;
      }
    } else {
      const [next, nextLive] = await Promise.all([
        fetchEventState(props.isSandbox, force),
        fetchLiveState(props.isSandbox, force).catch(() => ({ updatedAt: 0, liveGames: {} })),
      ]);
      state.value = next;
      liveState.value = nextLive;
      lastCheckedAt.value = Date.now();
    }
  } catch (err: any) {
    if (!silent) {
      loadError.value = err?.message || 'Failed to sync league data.';
    }
  } finally {
    isLoading.value = false;
    isSyncing.value = false;
  }
};

let pollTimer: ReturnType<typeof setInterval> | null = null;
let unsubscribeBroadcast: (() => void) | null = null;
let unsubscribeLiveBroadcast: (() => void) | null = null;
let lastWakeSyncAt = 0;

const handleVisibilityOrFocus = () => {
  if (typeof document !== 'undefined' && document.hidden) return;
  const now = Date.now();
  if (now - lastWakeSyncAt < 5000) return;
  lastWakeSyncAt = now;
  loadState(true, false);
};

onMounted(async () => {
  const savedPin = getSavedStaffPin();
  if (savedPin) {
    isStaff.value = await verifyStaffPin(savedPin, props.isSandbox).catch(() => false);
    if (!isStaff.value) clearStaffPin();
  }
  await loadState(false, false);

  // Check initial tab / round / player / scorer deep-link from query
  applyQueryToDashboard();
  if (!props.activeScorerKey && route.query.view === 'scorer' && typeof route.query.match === 'string') {
    const targetKey = route.query.match.trim().toUpperCase();
    const slot = EVENT_MATCH_MAP[targetKey];
    if (slot) {
      activeTab.value = 'schedule';
      selectedRound.value = slot.round;
      if (liveState.value.liveGames?.[slot.key]) {
        handleContinueLiveTable(slot);
      } else if (!isSlotLocked(slot)) {
        openSeatPicker(slot);
      }
    }
  } else {
    syncDashboardUrlQuery();
  }

  timerTickHandle = setInterval(() => {
    if (state.value.config.roundTimer?.status !== 'idle') {
      timerNowTick.value = Date.now();
    }
  }, 1000);

  // 동일 기기/브라우저 내 다른 탭·점수판 제출 시 0ms 즉시 반영
  unsubscribeBroadcast = subscribeEventStateUpdates(({ state: incoming, sandbox }) => {
    if (Boolean(sandbox) !== Boolean(props.isSandbox)) return;
    if (Number(incoming.updatedAt || 0) >= Number(state.value.updatedAt || 0)) {
      state.value = incoming;
      lastCheckedAt.value = Date.now();
    }
  });

  unsubscribeLiveBroadcast = subscribeLiveStateUpdates(({ liveState: incoming, sandbox }) => {
    if (Boolean(sandbox) !== Boolean(props.isSandbox)) return;
    if (Number(incoming.updatedAt || 0) >= Number(liveState.value.updatedAt || 0)) {
      liveState.value = incoming;
      lastCheckedAt.value = Date.now();
    }
  });

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', handleVisibilityOrFocus);
  }

  // 초경량 조건부 폴링(?since=updatedAt — 변경 없을 시 ~60B 응답, Edge Cache 우선으로 무료 티어 한도 절감)
  pollTimer = setInterval(() => {
    if (!document.hidden && !isSyncing.value && !isBusy.value) {
      loadState(true, false);
    }
  }, props.isSandbox ? 6000 : 25000);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
  if (timerTickHandle) clearInterval(timerTickHandle);
  if (toastTimer) clearTimeout(toastTimer);
  if (unsubscribeBroadcast) unsubscribeBroadcast();
  if (unsubscribeLiveBroadcast) unsubscribeLiveBroadcast();
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('focus', handleVisibilityOrFocus);
  }
});

watch(
  () => props.isSandbox,
  async () => {
    const savedPin = getSavedStaffPin();
    isStaff.value = savedPin ? await verifyStaffPin(savedPin, props.isSandbox).catch(() => false) : false;
    await loadState(false);
  }
);

// Standings calculation
const standings = computed(() => computeLeagueStandings(state.value.results, state.value.config));
const showNameParens = computed(() =>
  shouldShowNameParentheses(state.value.config, props.eventLocale)
);

const filteredPlayers = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  const list = standings.value.players.filter((p) => {
    if (teamFilter.value !== 'ALL' && p.player.teamId !== teamFilter.value) return false;
    if (roleFilter.value === 'PRO' && !p.player.isPro) return false;
    if (roleFilter.value === 'PLAYER' && p.player.isPro) return false;
    if (q && !matchesEventPlayerQuery(p.player, q)) return false;
    return true;
  });

  const dir = standingsSortAsc.value ? 1 : -1;
  return [...list].sort((a, b) => {
    if (standingsSortKey.value === 'rank') return (a.rank - b.rank) * dir;
    if (standingsSortKey.value === 'totalPoints') return (a.totalPoints - b.totalPoints) * dir;
    if (standingsSortKey.value === 'avgRank') {
      const av = a.gamesPlayed > 0 ? a.avgRank : 99;
      const bv = b.gamesPlayed > 0 ? b.avgRank : 99;
      return (av - bv) * dir;
    }
    if (standingsSortKey.value === 'bestScore') return ((a.bestScore ?? -999999) - (b.bestScore ?? -999999)) * dir;
    if (standingsSortKey.value === 'topRate') return (a.topRate - b.topRate) * dir;
    return 0;
  });
});

const toggleStandingsSort = (key: typeof standingsSortKey.value) => {
  if (standingsSortKey.value === key) {
    standingsSortAsc.value = !standingsSortAsc.value;
  } else {
    standingsSortKey.value = key;
    standingsSortAsc.value = key === 'rank' || key === 'avgRank';
  }
};

const filteredDetailedPlayers = computed(() => {
  const dir = statsSortAsc.value ? 1 : -1;
  return [...filteredPlayers.value].sort((a, b) => {
    const getVal = (p: PlayerStanding): number => {
      const d = p.detailed;
      switch (statsSortKey.value) {
        case 'trackedGames':
          return d.trackedGames;
        case 'winRate':
          return d.winRate ?? -999;
        case 'dealInRate':
          return d.dealInRate ?? 999;
        case 'riichiRate':
          return d.riichiRate ?? -999;
        case 'avgWinScore':
          return d.avgWinScore ?? -999;
        case 'roundSuji':
          return d.roundSuji ?? -999999;
      }
    };
    return (getVal(a) - getVal(b)) * dir;
  });
});

const toggleStatsSort = (key: typeof statsSortKey.value) => {
  if (statsSortKey.value === key) {
    statsSortAsc.value = !statsSortAsc.value;
  } else {
    statsSortKey.value = key;
    statsSortAsc.value = key === 'dealInRate';
  }
};

const selectedPlayerStanding = computed(() => {
  if (selectedPlayerId.value === null) return null;
  return standings.value.players.find((p) => p.player.id === selectedPlayerId.value) || null;
});

const activeMatchLogResult = computed<StoredTableResult | null>(() => {
  if (!matchLogKey.value) return null;
  return state.value.results[matchLogKey.value] || null;
});

// Team Cumulative Line Chart
const teamChartData = computed(() => {
  const labels = ['Start', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6'];
  // Show points up to latest round that has at least 1 game (minimum R1)
  let maxActiveRound = 0;
  standings.value.roundCompletedCounts.forEach((cnt, idx) => {
    if (cnt > 0) maxActiveRound = idx + 1;
  });
  const sliceLen = Math.max(2, maxActiveRound + 1);
  return {
    labels: labels.slice(0, sliceLen),
    datasets: EVENT_TEAMS.map((team) => {
      const ts = standings.value.teams.find((x) => x.team.id === team.id);
      return {
        label: team.name,
        data: (ts ? ts.cumulativePoints : [0, 0, 0, 0, 0, 0, 0]).slice(0, sliceLen),
        borderColor: team.color,
        backgroundColor: team.color,
        borderWidth: 2.6,
        pointRadius: 4,
        pointHoverRadius: 6,
        tension: 0.15,
      };
    }),
  };
});

const teamChartOptions = computed<ChartOptions<'line'>>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'bottom',
      labels: {
        color: isDark.value ? '#e2e8f0' : '#1e293b',
        boxWidth: 12,
        font: { size: 12, weight: 'bold' },
      },
    },
  },
  scales: {
    x: {
      ticks: { color: isDark.value ? '#94a3b8' : '#64748b' },
      grid: { color: isDark.value ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' },
    },
    y: {
      ticks: { color: isDark.value ? '#94a3b8' : '#64748b' },
      grid: { color: isDark.value ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' },
    },
  },
}));

// Schedule Helpers
const currentRoundMatches = computed(() => getRoundMatches(selectedRound.value));

const isSlotLocked = (slot: EventMatchSlot): boolean => {
  if (isStaff.value) return false;
  if (!state.value.config.allowParticipantInput) return true;
  if (state.value.config.lockedRounds.includes(slot.round)) return true;
  if (state.value.config.lockedTables.includes(slot.key)) return true;
  return false;
};

const isRoundLockedByConfig = (round: number) => state.value.config.lockedRounds.includes(round);

const handleQuickToggleRoundLock = async (round: number) => {
  if (!isStaff.value) return;
  isBusy.value = true;
  try {
    const curLocked = new Set(state.value.config.lockedRounds);
    const willLock = !curLocked.has(round);
    if (willLock) curLocked.add(round);
    else curLocked.delete(round);
    state.value = await updateEventConfig(
      { lockedRounds: Array.from(curLocked).sort((a, b) => a - b) },
      props.isSandbox
    );
    showToast(tr(willLock ? 'roundLockedToast' : 'roundUnlockedToast', { n: round }));
  } catch (err: any) {
    showToast(err?.message || 'Error');
  } finally {
    isBusy.value = false;
  }
};

// Actions
const openSeatPicker = (slot: EventMatchSlot) => {
  if (isSlotLocked(slot)) {
    showToast(tr('inputLockedNotice'));
    return;
  }
  seatPickerSlot.value = slot;
};

const openScoreModal = (
  slot: EventMatchSlot,
  preset: { scores: [number, number, number, number]; riichiSticks: number; note?: string } | null = null
) => {
  if (isSlotLocked(slot)) {
    showToast(tr('inputLockedNotice'));
    return;
  }
  scoreModalPreset.value = preset;
  scoreModalSlot.value = slot;
};

const handleLaunchScorer = (seatPlayerIds: [number, number, number, number]) => {
  if (!seatPickerSlot.value) return;
  const { round, table, key } = seatPickerSlot.value;
  seatPickerSlot.value = null;

  // 현재 매치(key) 이전까지의 각 선수 누적 포인트 계산 (재기록 시 중복 합산 방지)
  const existingMatch = standings.value.calculatedMatches[key];
  const priorPoints = seatPlayerIds.map((pid) => {
    const ps = standings.value.players.find((p) => p.player.id === pid);
    const curTotal = ps ? ps.totalPoints : 0;
    const prevEntry = existingMatch?.entries.find((e) => e.playerId === pid);
    return prevEntry ? Number((curTotal - prevEntry.finalPoint).toFixed(1)) : curTotal;
  }) as [number, number, number, number];

  emit('launch-scorer', {
    round,
    table,
    seatPlayerIds,
    config: state.value.config,
    sandbox: props.isSandbox,
    priorPoints,
  });
};

const handleContinueLiveTable = (slot: EventMatchSlot) => {
  if (isSlotLocked(slot)) {
    showToast(tr('inputLockedNotice'));
    return;
  }
  const liveGame = liveState.value.liveGames?.[slot.key];
  if (!liveGame) return;
  const existingMatch = standings.value.calculatedMatches[slot.key];
  const priorPoints = liveGame.seatPlayerIds.map((pid) => {
    const ps = standings.value.players.find((p) => p.player.id === pid);
    const curTotal = ps ? ps.totalPoints : 0;
    const prevEntry = existingMatch?.entries.find((e) => e.playerId === pid);
    return prevEntry ? Number((curTotal - prevEntry.finalPoint).toFixed(1)) : curTotal;
  }) as [number, number, number, number];

  emit('continue-live-scorer', {
    liveGame,
    config: state.value.config,
    sandbox: props.isSandbox,
    priorPoints,
  });
};

const openLiveMonitor = () => {
  router.push({ path: getKnuNpmLiveMonitorPath(props.isSandbox), query: { lang: props.eventLocale } });
};

const handleSimulateSandboxLive = async () => {
  if (!props.isSandbox) return;
  liveState.value = await seedSandboxLiveGames(selectedRound.value);
  showToast(`Simulated 6 live tables for Round ${selectedRound.value}!`);
};

const handleManualSubmit = async (payload: {
  entries: TableScoreEntryInput[];
  riichiSticks: number;
  submittedBy: string;
  note: string;
  allowScoreSumMismatch: boolean;
}) => {
  if (!scoreModalSlot.value) return;
  isBusy.value = true;
  try {
    const { round, table } = scoreModalSlot.value;
    state.value = await submitTableResult(
      {
        round,
        table,
        source: 'manual',
        entries: payload.entries,
        riichiSticks: payload.riichiSticks,
        rounds: null,
        submittedBy: payload.submittedBy,
        note: payload.note,
        allowScoreSumMismatch: payload.allowScoreSumMismatch,
      },
      props.isSandbox
    );
    scoreModalSlot.value = null;
    scoreModalPreset.value = null;
    showToast(tr('scoreSavedToast', { r: round, t: table }));
  } catch (err: any) {
    showToast(err?.message || 'Save failed');
  } finally {
    isBusy.value = false;
  }
};

const handleDeleteResult = async () => {
  if (!scoreModalSlot.value) return;
  isBusy.value = true;
  try {
    const { round, table } = scoreModalSlot.value;
    state.value = await deleteTableResult(round, table, props.isSandbox);
    scoreModalSlot.value = null;
    scoreModalPreset.value = null;
    showToast(tr('scoreDeletedToast', { r: round, t: table }));
  } catch (err: any) {
    showToast(err?.message || 'Delete failed');
  } finally {
    isBusy.value = false;
  }
};

// Staff Handlers
const handleStaffLogin = async (pin: string) => {
  isBusy.value = true;
  try {
    const ok = await verifyStaffPin(pin, props.isSandbox);
    if (ok) {
      saveStaffPin(pin);
      isStaff.value = true;
    } else {
      showToast(tr('staffPinError'));
    }
  } finally {
    isBusy.value = false;
  }
};

const handleStaffLogout = () => {
  clearStaffPin();
  isStaff.value = false;
};

const handleSaveConfig = async (patch: Partial<EventScoringConfig> & { newStaffPin?: string }) => {
  isBusy.value = true;
  try {
    state.value = await updateEventConfig(patch, props.isSandbox);
    if (patch.newStaffPin) {
      showToast(tr('staffPinUpdated'));
    } else if (patch.roundTimer) {
      const t = state.value.config.roundTimer;
      const statusLabel =
        t.status === 'running'
          ? tr('timerStatusRunning')
          : t.status === 'paused'
            ? tr('timerStatusPaused')
            : tr('timerStatusIdle');
      showToast(`⏱ R${t.round} (${t.durationMinutes}+${t.extraHands}) · ${statusLabel}`);
    } else {
      showToast(tr('staffConfigSaved'));
    }
  } catch (err: any) {
    showToast(err?.message || 'Update failed');
  } finally {
    isBusy.value = false;
  }
};

const handleRollback = async (auditId: string) => {
  isBusy.value = true;
  try {
    const entry = state.value.auditLog.find((a) => a.id === auditId);
    state.value = await rollbackAuditEntry(auditId, props.isSandbox);
    showToast(tr('staffRollbackDone', { key: entry?.key || '' }));
  } catch (err: any) {
    showToast(err?.message || 'Rollback failed');
  } finally {
    isBusy.value = false;
  }
};

const downloadFile = (content: string, filename: string, mime: string) => {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const handleExportCsv = () => {
  const csv = buildEventCsv(state.value.results, standings.value);
  const tag = props.isSandbox ? 'sandbox' : '20261128';
  downloadFile(csv, `knu-npm-2026-${tag}.csv`, 'text/csv;charset=utf-8;');
};

const handleExportJson = () => {
  const tag = props.isSandbox ? 'sandbox' : '20261128';
  downloadFile(JSON.stringify(state.value, null, 2), `knu-npm-2026-${tag}.json`, 'application/json');
};

const copyEventLink = () => {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return;
  const u = new URL(window.location.href);
  u.searchParams.set('lang', props.eventLocale);
  navigator.clipboard.writeText(u.toString()).then(() => showToast(tr('linkCopied')));
};

// Sandbox Helpers
const qaReport = ref<QaSelfTestReport | null>(null);

const handleSeedSandbox = async (rounds: number) => {
  if (!props.isSandbox) return;
  isBusy.value = true;
  try {
    state.value = await seedSandboxData(rounds);
    showToast(`Seeded R1–R${rounds} (${rounds * 7} games: ${rounds * 6} Scorer + ${rounds} JP-C)`);
  } finally {
    isBusy.value = false;
  }
};

const handleSeedEdgeCases = async () => {
  if (!props.isSandbox) return;
  isBusy.value = true;
  try {
    state.value = await seedSandboxEdgeCases();
    showToast('Seeded 4 edge cases: 2-way tie, 4-way 25k tie, negative+chombo, JP-C!');
  } finally {
    isBusy.value = false;
  }
};

const handleResetSandbox = async () => {
  if (!props.isSandbox) return;
  isBusy.value = true;
  try {
    state.value = await resetSandboxData();
    liveState.value = { updatedAt: Date.now(), liveGames: {} };
    qaReport.value = null;
    showToast('Sandbox reset to 0 / 42 games.');
  } finally {
    isBusy.value = false;
  }
};

const handleSandboxAutoStaffLogin = async () => {
  if (!props.isSandbox) return;
  const ok = await verifyStaffPin('20261128', true);
  if (ok) {
    saveStaffPin('20261128');
    isStaff.value = true;
    showToast('🔓 Sandbox Staff Mode unlocked! (PIN 20261128)');
  }
};

const handleRunQaSelfTest = () => {
  if (!props.isSandbox) return;
  qaReport.value = runEventQaSelfTest(state.value);
  showToast(
    qaReport.value.failed === 0
      ? `✅ QA Self-Test: ${qaReport.value.passed}/${qaReport.value.checks.length} PASSED`
      : `⚠️ QA Self-Test: ${qaReport.value.failed} FAILED`
  );
};

const launchSandboxScenario = async (scenario: 'orasu25k' | 'timer500' | 'timer501' | 'handoff') => {
  if (!props.isSandbox) return;
  const r = selectedRound.value;
  if (scenario === 'orasu25k') {
    const snap = buildCustomSandboxLiveSnapshot(
      r,
      2,
      {
        wind: '南',
        roundNum: 4,
        renchan: 0,
        riichiSticks: 2,
        scores: [25000, 25000, 25000, 23000],
      },
      state.value.config
    );
    if (!snap) return;
    liveState.value = await upsertLiveTableState(snap, true);
    const slot = EVENT_MATCH_MAP[snap.key];
    if (slot) handleContinueLiveTable(slot);
    return;
  }
  if (scenario === 'timer500' || scenario === 'timer501') {
    const now = getSyncedNowMs(true);
    const extraHands: 0 | 1 = scenario === 'timer501' ? 1 : 0;
    state.value = await updateSandboxQuickTimer({
      round: r,
      durationMinutes: 50,
      extraHands,
      status: 'running',
      endsAt: now + 10_000, // 10 seconds left so user can watch expiry immediately!
      pausedRemainingMs: null,
      updatedAt: now,
    });
    const tableNum = scenario === 'timer501' ? 5 : 3;
    const snap = buildCustomSandboxLiveSnapshot(
      r,
      tableNum,
      {
        wind: '東',
        roundNum: 3,
        renchan: 0,
        riichiSticks: 0,
        scores: [29000, 26000, 24000, 21000],
      },
      state.value.config
    );
    if (!snap) return;
    liveState.value = await upsertLiveTableState(snap, true);
    const slot = EVENT_MATCH_MAP[snap.key];
    if (slot) handleContinueLiveTable(slot);
    return;
  }
  if (scenario === 'handoff') {
    const snap = buildCustomSandboxLiveSnapshot(
      r,
      6,
      {
        wind: '南',
        roundNum: 2,
        renchan: 1,
        riichiSticks: 1,
        scores: [33200, 26800, 22000, 17000],
        riichiActive: [false, true, false, false],
        chomboCounts: [0, 0, 1, 0],
      },
      state.value.config
    );
    if (!snap) return;
    liveState.value = await upsertLiveTableState(snap, true);
    activeTab.value = 'schedule';
    showToast(`Seeded live handoff checkpoint on ${snap.key} (South 2, 1 Riichi, 1 Chombo) — click "Continue Here"!`);
  }
};

const switchSandboxRoute = (toSandbox: boolean) => {
  const dest = getKnuNpmBasePath(toSandbox) || '/';
  router.push({ path: dest, query: { lang: props.eventLocale } });
};

const quickTestScorerR1T1 = () => {
  const slot = EVENT_MATCH_MAP['R1-T1'];
  if (slot) openSeatPicker(slot);
};

const quickTestJpCR1T4 = () => {
  const slot = EVENT_MATCH_MAP['R1-T4'];
  if (slot) openScoreModal(slot, null);
};

const quickTestJpC3WayTieRiichi2 = () => {
  const slot = EVENT_MATCH_MAP['R1-T4'];
  if (!slot) return;
  openScoreModal(slot, {
    scores: [25000, 25000, 25000, 23000],
    riichiSticks: 2,
    note: 'QA: 3인 공동 1위 + 공탁 2개 (800/600/600 → +12.6/+12.2/+12.2/-37.0)',
  });
};

const formatOka = computed(() => {
  const oka = ((state.value.config.returnScore - state.value.config.startingScore) * 4) / 1000;
  return `${oka >= 0 ? '+' : ''}${oka.toFixed(1)} pt`;
});

const fmtPct = (v: number | null) => (v !== null ? `${v.toFixed(1)}%` : '-');
</script>

<template>
  <div class="knu-event-page">
    <!-- Toast -->
    <Transition name="ev-toast-fade">
      <div v-if="toastMsg" class="ev-toast">{{ toastMsg }}</div>
    </Transition>

    <!-- Test Sandbox Banner -->
    <div v-if="isSandbox" class="sandbox-banner">
      <div class="sb-top">
        <div class="sb-title-wrap">
          <span class="sb-pill">🧪 {{ tr('sandboxBadge') }}</span>
          <strong>{{ tr('sandboxTitle') }}</strong>
        </div>
        <button type="button" class="sb-btn-live" @click="switchSandboxRoute(false)">
          ↗ {{ tr('sandboxGoLive') }}
        </button>
      </div>
      <p class="sb-desc">{{ tr('sandboxDesc') }}</p>
      <div class="sb-groups">
        <div class="sb-group">
          <span class="sb-group-lbl">📊 Seed</span>
          <div class="sb-actions">
            <button type="button" class="sb-btn" @click="handleSeedSandbox(1)">⚡ {{ tr('sandboxSeed1R') }}</button>
            <button type="button" class="sb-btn" @click="handleSeedSandbox(3)">⚡ {{ tr('sandboxSeed3R') }}</button>
            <button type="button" class="sb-btn" @click="handleSeedSandbox(6)">⚡ {{ tr('sandboxSeedAll') }}</button>
            <button type="button" class="sb-btn" @click="handleSeedEdgeCases">⚖️ 동점·촌보·음수 엣지 시드</button>
            <button type="button" class="sb-btn danger" @click="handleResetSandbox">🗑 {{ tr('sandboxReset') }}</button>
          </div>
        </div>
        <div class="sb-group">
          <span class="sb-group-lbl">🀄 Scenario</span>
          <div class="sb-actions">
            <button type="button" class="sb-btn accent" @click="quickTestScorerR1T1">🀄 {{ tr('sandboxTestScorer') }}</button>
            <button type="button" class="sb-btn accent" @click="launchSandboxScenario('orasu25k')">🔥 오라스(남4국) 직행</button>
            <button type="button" class="sb-btn accent" @click="launchSandboxScenario('timer500')">⏰ 50+0 (10초 테스트)</button>
            <button type="button" class="sb-btn accent" @click="launchSandboxScenario('timer501')">⏰ 50+1 (10초 테스트)</button>
            <button type="button" class="sb-btn" @click="launchSandboxScenario('handoff')">💥 이어하기·촌보 시드</button>
            <button type="button" class="sb-btn accent" @click="quickTestJpCR1T4">📝 {{ tr('sandboxTestJpC') }}</button>
            <button type="button" class="sb-btn accent" @click="quickTestJpC3WayTieRiichi2">⚖️ 3인동점+공탁2 (JP-C 테스트)</button>
          </div>
        </div>
        <div class="sb-group">
          <span class="sb-group-lbl">📺 Live &amp; QA</span>
          <div class="sb-actions">
            <button type="button" class="sb-btn" @click="handleSimulateSandboxLive">📡 {{ tr('sandboxSimLive') }}</button>
            <button type="button" class="sb-btn accent" @click="openLiveMonitor">📺 {{ tr('sandboxOpenMonitor') }}</button>
            <button type="button" class="sb-btn" @click="handleStartSandboxTimer(50)">⏱ {{ tr('sandboxStartTimerBtn') }}</button>
            <button type="button" class="sb-btn" @click="handleStartSandboxTimer(1)">⏱ {{ tr('sandboxStartShortTimerBtn') }}</button>
            <button v-if="!isStaff" type="button" class="sb-btn" @click="handleSandboxAutoStaffLogin">🔓 스태프 원클릭 인증</button>
            <button type="button" class="sb-btn qa-btn" @click="handleRunQaSelfTest">🤖 자동 규칙 자가진단</button>
          </div>
        </div>
      </div>

      <!-- Automated QA Self-Test Report -->
      <div v-if="qaReport" class="qa-report-box">
        <div class="qa-report-head">
          <strong>
            {{ qaReport.failed === 0 ? '✅ ALL CHECKS PASSED' : '⚠️ SOME CHECKS FAILED' }}
            ({{ qaReport.passed }} / {{ qaReport.checks.length }})
          </strong>
          <button type="button" class="qa-close-btn" @click="qaReport = null">✕</button>
        </div>
        <div class="qa-checks-grid">
          <div v-for="(chk, idx) in qaReport.checks" :key="idx" class="qa-check-item" :class="chk.ok ? 'ok' : 'fail'">
            <span class="qac-icon">{{ chk.ok ? '✅' : '❌' }}</span>
            <div class="qac-body">
              <div class="qac-name">{{ chk.name }}</div>
              <div class="qac-detail">{{ chk.detail }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Header -->
    <header class="ev-header">
      <div class="ev-header-inner">
        <div class="ev-brand">
          <div class="ev-title-row">
            <h1 class="ev-title">{{ tr('eventTitle') }}</h1>
            <span v-if="isSandbox" class="header-sb-tag">{{ tr('sandboxBadge') }}</span>
          </div>
          <div class="ev-meta-row">
            <span>{{ tr('eventSubtitle') }}</span>
            <span class="progress-chip">
              {{ tr('completedLabel') }}: <strong>{{ standings.completedGames }} / {{ standings.totalGames }}</strong>
              <span class="sub-split">
                ({{ tr('trackedLabel') }} {{ standings.trackedGames }} · {{ tr('manualLabel') }} {{ standings.manualGames }})
              </span>
            </span>
            <span class="live-auto-pill" :title="lastCheckedText">
              <span class="live-dot" :class="{ syncing: isSyncing }"></span>
              <span>{{ tr('liveAutoSyncLabel') }}</span>
              <span v-if="lastCheckedText" class="live-ts">{{ lastCheckedText }}</span>
            </span>
            <span
              v-if="dashboardTimerDisplay"
              class="hdr-timer-pill"
              :class="`sev-${dashboardTimerDisplay.severity}`"
            >
              {{
                dashboardTimerDisplay.isExpired
                  ? '⏰ 00:00'
                  : (dashboardTimerDisplay.status === 'paused' ? '⏸ ' : '⏱ ') + dashboardTimerDisplay.formatted
              }}
              <small>R{{ dashboardTimerDisplay.round }} · {{ dashboardTimerDisplay.ruleTag }}</small>
            </span>
          </div>
        </div>

        <div class="ev-header-actions">
          <!-- Language Switcher -->
          <div class="lang-switch" role="group" aria-label="Language">
            <button
              v-for="loc in EVENT_LOCALES"
              :key="loc.code"
              type="button"
              class="lang-btn"
              :class="{ active: eventLocale === loc.code }"
              @click="emit('change-locale', loc.code)"
            >
              {{ loc.short }}
            </button>
          </div>

          <button
            v-if="activeScorerKey"
            type="button"
            class="hdr-btn resume-btn"
            @click="emit('resume-scorer')"
          >
            🀄 {{ tr('resumeScorer') }} ({{ activeScorerKey }})
          </button>

          <button
            type="button"
            class="hdr-btn monitor-btn"
            @click="openLiveMonitor"
          >
            📺 {{ tr('liveMonitorBtn') }}
          </button>

          <button
            v-if="!isSandbox"
            type="button"
            class="hdr-btn"
            @click="switchSandboxRoute(true)"
            :title="tr('liveGoSandbox')"
          >
            🧪 {{ tr('liveGoSandbox') }}
          </button>

          <button type="button" class="hdr-btn" @click="copyEventLink">
            🔗 {{ tr('copyLink') }}
          </button>

          <button type="button" class="hdr-btn" :disabled="isSyncing" @click="loadState(false, true)">
            ↻ {{ isSyncing ? tr('refreshing') : tr('refresh') }}
          </button>

          <button type="button" class="hdr-btn icon-only" @click="toggleTheme" title="Theme">
            {{ isDark ? '☀️' : '🌙' }}
          </button>

          <button
            type="button"
            class="hdr-btn staff-btn"
            :class="{ active: isStaff }"
            @click="isStaffModalOpen = true"
          >
            {{ isStaff ? '🔓 ' + tr('staffActive') : '🔐 ' + tr('staffBtn') }}
          </button>
        </div>
      </div>
    </header>

    <!-- Main Navigation Tabs -->
    <nav class="ev-tabs">
      <div class="ev-tabs-inner">
        <button :class="{ active: activeTab === 'standings' }" @click="activeTab = 'standings'">
          🏆 {{ tr('tabStandings') }}
        </button>
        <button :class="{ active: activeTab === 'stats' }" @click="activeTab = 'stats'">
          📊 {{ tr('tabDetailedStats') }}
        </button>
        <button :class="{ active: activeTab === 'schedule' }" @click="activeTab = 'schedule'">
          🀄 {{ tr('tabSchedule') }}
        </button>
        <button :class="{ active: activeTab === 'rosters' }" @click="activeTab = 'rosters'">
          👥 {{ tr('tabRosters') }}
        </button>
        <button :class="{ active: activeTab === 'rules' }" @click="activeTab = 'rules'">
          📜 {{ tr('tabRules') }}
        </button>
      </div>
    </nav>

    <main class="ev-main">
      <div v-if="loadError" class="ev-error-banner">
        ⚠️ {{ loadError }}
        <button type="button" @click="loadState(false)">{{ tr('refresh') }}</button>
      </div>

      <!-- ============================ TAB 1: STANDINGS ============================ -->
      <section v-if="activeTab === 'standings'" class="tab-section">
        <!-- Team Standings Cards -->
        <div class="section-header">
          <h2>{{ tr('teamStandingsTitle') }}</h2>
        </div>

        <div class="team-cards-grid">
          <div
            v-for="ts in standings.teams"
            :key="ts.team.id"
            class="team-card"
            :style="{ borderTopColor: ts.team.color }"
          >
            <div class="tc-top">
              <div class="tc-rank-name">
                <span class="tc-rank" :class="`tr-${ts.rank}`">#{{ ts.rank }}</span>
                <span class="tc-name" :style="{ color: ts.team.color }">{{ ts.team.name }}</span>
              </div>
              <span class="tc-games">{{ ts.gamesPlayed }} / 42</span>
            </div>

            <div
              class="tc-points"
              :class="ts.totalPoints > 0 ? 'pos' : ts.totalPoints < 0 ? 'neg' : ''"
            >
              {{ formatSignedPoint(ts.totalPoints) }} <small>pt</small>
            </div>

            <div class="tc-sub-metrics">
              <span>{{ tr('gap') }}: <strong>{{ ts.rank === 1 ? 'Lead' : formatSignedPoint(ts.gapToFirst) }}</strong></span>
              <span>{{ tr('avgRank') }}: <strong>{{ ts.gamesPlayed > 0 ? ts.avgRank.toFixed(3) : '-' }}</strong></span>
            </div>

            <div class="tc-ranks-bar">
              <span>1st: <b>{{ ts.rankCounts[0] }}</b></span>
              <span>2nd: <b>{{ ts.rankCounts[1] }}</b></span>
              <span>3rd: <b>{{ ts.rankCounts[2] }}</b></span>
              <span>4th: <b>{{ ts.rankCounts[3] }}</b></span>
            </div>

            <div class="tc-contrib">
              <span>{{ tr('proPoints') }}: <b>{{ formatSignedPoint(ts.proPoints) }}</b></span>
              <span>{{ tr('playerPoints') }}: <b>{{ formatSignedPoint(ts.playerPoints) }}</b></span>
            </div>
          </div>
        </div>

        <!-- Team Trend Chart -->
        <div class="card-panel">
          <h3 class="panel-title">{{ tr('teamTrendTitle') }}</h3>
          <div class="team-chart-wrap">
            <LineChart :data="teamChartData" :options="teamChartOptions" />
          </div>
        </div>

        <!-- Individual Standings -->
        <div class="card-panel">
          <div class="panel-head-row">
            <h3 class="panel-title">{{ tr('individualStandingsTitle') }}</h3>
            <div class="filter-bar">
              <input
                type="text"
                v-model="searchQuery"
                :placeholder="tr('searchPlayerPlaceholder')"
                class="search-input"
              />
              <div class="chip-group">
                <button
                  v-for="tf in (['ALL', 'A', 'B', 'C', 'D'] as const)"
                  :key="tf"
                  type="button"
                  class="filter-chip"
                  :class="{ active: teamFilter === tf }"
                  @click="teamFilter = tf"
                >
                  {{ tf === 'ALL' ? tr('filterAll') : `Team ${tf}` }}
                </button>
              </div>
              <div class="chip-group">
                <button
                  type="button"
                  class="filter-chip"
                  :class="{ active: roleFilter === 'ALL' }"
                  @click="roleFilter = 'ALL'"
                >
                  {{ tr('filterAll') }}
                </button>
                <button
                  type="button"
                  class="filter-chip"
                  :class="{ active: roleFilter === 'PRO' }"
                  @click="roleFilter = 'PRO'"
                >
                  {{ tr('filterPros') }}
                </button>
                <button
                  type="button"
                  class="filter-chip"
                  :class="{ active: roleFilter === 'PLAYER' }"
                  @click="roleFilter = 'PLAYER'"
                >
                  {{ tr('filterPlayers') }}
                </button>
              </div>
            </div>
          </div>

          <div class="table-scroll">
            <table class="data-table">
              <thead>
                <tr>
                  <th class="sortable" @click="toggleStandingsSort('rank')">{{ tr('rank') }}</th>
                  <th class="left">{{ tr('player') }}</th>
                  <th>{{ tr('team') }}</th>
                  <th class="sortable" @click="toggleStandingsSort('totalPoints')">{{ tr('totalPt') }}</th>
                  <th>{{ tr('games') }}</th>
                  <th class="sortable" @click="toggleStandingsSort('avgRank')">{{ tr('avgRank') }}</th>
                  <th>1-2-3-4</th>
                  <th class="sortable" @click="toggleStandingsSort('bestScore')">{{ tr('bestScore') }}</th>
                  <th class="sortable" @click="toggleStandingsSort('topRate')">{{ tr('topRate') }}</th>
                  <th>R1</th>
                  <th>R2</th>
                  <th>R3</th>
                  <th>R4</th>
                  <th>R5</th>
                  <th>R6</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="ps in filteredPlayers"
                  :key="ps.player.id"
                  class="clickable-row"
                  @click="selectedPlayerId = ps.player.id"
                >
                  <td class="num bold">{{ ps.rank }}</td>
                  <td class="left">
                    <div class="tbl-player">
                      <span class="tbl-id">#{{ ps.player.id }}</span>
                      <span class="tbl-name">{{ formatEventPlayerName(ps.player, eventLocale, 'full', showNameParens) }}</span>
                      <span v-if="ps.player.isPro" class="pro-mini">{{ tr('proBadge') }}</span>
                    </div>
                  </td>
                  <td>
                    <span
                      class="team-badge-sm"
                      :style="{
                        color: EVENT_TEAM_MAP[ps.player.teamId].color,
                        backgroundColor: EVENT_TEAM_MAP[ps.player.teamId].bgTint,
                      }"
                    >
                      {{ ps.player.teamId }}
                    </span>
                  </td>
                  <td class="num bold" :class="ps.totalPoints > 0 ? 'pos' : ps.totalPoints < 0 ? 'neg' : ''">
                    {{ formatSignedPoint(ps.totalPoints) }}
                  </td>
                  <td class="num">
                    {{
                      formatDualMetric(
                        ps.gamesPlayed,
                        ps.trackedGames,
                        ps.gamesPlayed > 0 && ps.trackedGames !== ps.gamesPlayed,
                        0,
                        false
                      )
                    }}
                  </td>
                  <td class="num">{{ ps.gamesPlayed > 0 ? ps.avgRank.toFixed(3) : '-' }}</td>
                  <td class="num dim">{{ ps.rankCounts.join('-') }}</td>
                  <td class="num">{{ ps.bestScore !== null ? ps.bestScore.toLocaleString() : '-' }}</td>
                  <td class="num">{{ ps.gamesPlayed > 0 ? `${ps.topRate}%` : '-' }}</td>
                  <td v-for="r in ps.rounds" :key="r.key" class="num round-cell">
                    <span
                      v-if="r.played && r.finalPoint !== undefined"
                      :class="r.finalPoint > 0 ? 'pos' : r.finalPoint < 0 ? 'neg' : ''"
                    >
                      {{ formatSignedPoint(r.finalPoint) }}
                    </span>
                    <span v-else class="dim">-</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- ============================ TAB 2: DETAILED STATS ============================ -->
      <section v-else-if="activeTab === 'stats'" class="tab-section">
        <div class="notice-card">
          {{ tr('detailedNotice') }}
        </div>

        <div class="card-panel">
          <div class="panel-head-row">
            <div>
              <h3 class="panel-title">{{ tr('detailedStatsTitle') }}</h3>
              <span class="dual-legend">{{ tr('dualMetricLegend') }}</span>
            </div>
            <div class="filter-bar">
              <input
                type="text"
                v-model="searchQuery"
                :placeholder="tr('searchPlayerPlaceholder')"
                class="search-input"
              />
              <div class="chip-group">
                <button
                  v-for="tf in (['ALL', 'A', 'B', 'C', 'D'] as const)"
                  :key="tf"
                  type="button"
                  class="filter-chip"
                  :class="{ active: teamFilter === tf }"
                  @click="teamFilter = tf"
                >
                  {{ tf === 'ALL' ? tr('filterAll') : `Team ${tf}` }}
                </button>
              </div>
            </div>
          </div>

          <div class="table-scroll">
            <table class="data-table">
              <thead>
                <tr>
                  <th class="left">{{ tr('player') }}</th>
                  <th>{{ tr('team') }}</th>
                  <th class="sortable" @click="toggleStatsSort('trackedGames')">{{ tr('statGames') }}</th>
                  <th>{{ tr('statTotalPt') }}</th>
                  <th>{{ tr('statTrackedRounds') }}</th>
                  <th class="sortable" @click="toggleStatsSort('winRate')">{{ tr('statWinRate') }}</th>
                  <th class="sortable" @click="toggleStatsSort('dealInRate')">{{ tr('statDealInRate') }}</th>
                  <th class="sortable" @click="toggleStatsSort('riichiRate')">{{ tr('statRiichiRate') }}</th>
                  <th class="sortable" @click="toggleStatsSort('avgWinScore')">{{ tr('statAvgWinScore') }}</th>
                  <th>{{ tr('statAvgDealInScore') }}</th>
                  <th>{{ tr('statTsumoRate') }}</th>
                  <th>{{ tr('statDrawTenpaiRate') }}</th>
                  <th>{{ tr('statYakitoriRate') }}</th>
                  <th>{{ tr('statWinEfficiency') }}</th>
                  <th>{{ tr('statDealInLoss') }}</th>
                  <th>{{ tr('statNetWinEfficiency') }}</th>
                  <th class="sortable" @click="toggleStatsSort('roundSuji')">{{ tr('statRoundSuji') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="ps in filteredDetailedPlayers"
                  :key="ps.player.id"
                  class="clickable-row"
                  @click="selectedPlayerId = ps.player.id"
                >
                  <td class="left">
                    <div class="tbl-player">
                      <span class="tbl-id">#{{ ps.player.id }}</span>
                      <span class="tbl-name">{{ formatEventPlayerName(ps.player, eventLocale, 'full', showNameParens) }}</span>
                      <span v-if="ps.player.isPro" class="pro-mini">{{ tr('proBadge') }}</span>
                    </div>
                  </td>
                  <td>
                    <span
                      class="team-badge-sm"
                      :style="{
                        color: EVENT_TEAM_MAP[ps.player.teamId].color,
                        backgroundColor: EVENT_TEAM_MAP[ps.player.teamId].bgTint,
                      }"
                    >
                      {{ ps.player.teamId }}
                    </span>
                  </td>
                  <td class="num bold">
                    {{
                      formatDualMetric(
                        ps.gamesPlayed,
                        ps.detailed.trackedGames,
                        ps.gamesPlayed > 0 && ps.detailed.trackedGames !== ps.gamesPlayed,
                        0,
                        false
                      )
                    }}
                  </td>
                  <td class="num" :class="ps.totalPoints > 0 ? 'pos' : ps.totalPoints < 0 ? 'neg' : ''">
                    {{
                      formatDualMetric(
                        ps.totalPoints,
                        ps.detailed.trackedTotalPoints,
                        ps.gamesPlayed > 0 && ps.detailed.trackedGames !== ps.gamesPlayed,
                        1,
                        true
                      )
                    }}
                  </td>
                  <td class="num">{{ ps.detailed.trackedRounds || '-' }}</td>
                  <td class="num bold">{{ fmtPct(ps.detailed.winRate) }}</td>
                  <td class="num">{{ fmtPct(ps.detailed.dealInRate) }}</td>
                  <td class="num">{{ fmtPct(ps.detailed.riichiRate) }}</td>
                  <td class="num">{{ ps.detailed.avgWinScore !== null ? ps.detailed.avgWinScore.toLocaleString() : '-' }}</td>
                  <td class="num">{{ ps.detailed.avgDealInScore !== null ? ps.detailed.avgDealInScore.toLocaleString() : '-' }}</td>
                  <td class="num">{{ fmtPct(ps.detailed.tsumoRate) }}</td>
                  <td class="num">{{ fmtPct(ps.detailed.drawTenpaiRate) }}</td>
                  <td class="num">{{ fmtPct(ps.detailed.yakitoriRate) }}</td>
                  <td class="num pos">{{ ps.detailed.winEfficiency !== null ? `+${ps.detailed.winEfficiency.toLocaleString()}` : '-' }}</td>
                  <td class="num neg">{{ ps.detailed.dealInLoss !== null ? `-${ps.detailed.dealInLoss.toLocaleString()}` : '-' }}</td>
                  <td
                    class="num"
                    :class="(ps.detailed.netWinEfficiency ?? 0) > 0 ? 'pos' : (ps.detailed.netWinEfficiency ?? 0) < 0 ? 'neg' : ''"
                  >
                    {{
                      ps.detailed.netWinEfficiency !== null
                        ? `${ps.detailed.netWinEfficiency > 0 ? '+' : ''}${ps.detailed.netWinEfficiency.toLocaleString()}`
                        : '-'
                    }}
                  </td>
                  <td
                    class="num"
                    :class="(ps.detailed.roundSuji ?? 0) > 0 ? 'pos' : (ps.detailed.roundSuji ?? 0) < 0 ? 'neg' : ''"
                  >
                    {{
                      ps.detailed.roundSuji !== null
                        ? `${ps.detailed.roundSuji > 0 ? '+' : ''}${ps.detailed.roundSuji.toLocaleString()}`
                        : '-'
                    }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- ============================ TAB 3: SCHEDULE & RECORD ============================ -->
      <section v-else-if="activeTab === 'schedule'" class="tab-section">
        <div class="schedule-controls">
          <div class="round-pills">
            <button
              v-for="r in [1, 2, 3, 4, 5, 6]"
              :key="r"
              type="button"
              class="round-pill"
              :class="{ active: selectedRound === r && scheduleViewMode === 'cards' }"
              @click="selectedRound = r; scheduleViewMode = 'cards'"
            >
              <span>{{ tr('roundShort', { n: r }) }}</span>
              <span class="rp-count">{{ standings.roundCompletedCounts[r - 1] }}/7</span>
              <span v-if="isRoundLockedByConfig(r)" class="rp-lock">🔒</span>
            </button>
          </div>

          <div class="schedule-right-tools">
            <select v-model="highlightPlayerId" class="find-player-select" :aria-label="tr('findMyTable')">
              <option value="">🔍 {{ tr('findMyTable') }} — {{ tr('allPlayersOption') }}</option>
              <option v-for="p in EVENT_PLAYERS" :key="p.id" :value="p.id">
                #{{ p.id }} {{ formatEventPlayerName(p, eventLocale, 'full', showNameParens) }} (Team {{ p.teamId }}{{ p.isPro ? ' · PRO' : '' }})
              </option>
            </select>

            <div class="view-toggle">
              <button
                type="button"
                :class="{ active: scheduleViewMode === 'cards' }"
                @click="scheduleViewMode = 'cards'"
              >
                {{ tr('viewRoundCards') }}
              </button>
              <button
                type="button"
                :class="{ active: scheduleViewMode === 'matrix' }"
                @click="scheduleViewMode = 'matrix'"
              >
                {{ tr('viewFullMatrix') }}
              </button>
            </div>

            <button
              v-if="isStaff && scheduleViewMode === 'cards'"
              type="button"
              class="btn-lock-round"
              :class="{ locked: isRoundLockedByConfig(selectedRound) }"
              :disabled="isBusy"
              @click="handleQuickToggleRoundLock(selectedRound)"
            >
              {{ isRoundLockedByConfig(selectedRound) ? '🔓 ' + tr('unlockRound') : '🔒 ' + tr('lockRound') }}
            </button>
          </div>
        </div>

        <!-- Round Cards View -->
        <div v-if="scheduleViewMode === 'cards'" class="tables-grid">
          <div
            v-for="slot in currentRoundMatches"
            :key="slot.key"
            class="table-card"
            :class="{
              done: Boolean(state.results[slot.key]),
              highlighted: highlightPlayerId !== '' && slot.playerIds.includes(Number(highlightPlayerId)),
              'is-jpc': slot.isJpC,
            }"
          >
            <div class="table-card-head">
              <div class="tch-left">
                <span class="table-num">{{ tr('tableLabel', { n: slot.table }) }}</span>
                <span v-if="slot.isJpC" class="hw-badge jpc">{{ tr('jpCBadge') }}</span>
                <span v-else class="hw-badge scorer">{{ tr('scorerTableBadge') }}</span>
              </div>
              <div class="tch-right">
                <span v-if="state.results[slot.key]" class="status-pill done">
                  ✓ {{ state.results[slot.key].source === 'scorer' ? tr('sourceScorer') : tr('sourceManual') }}
                </span>
                <span v-else-if="liveState.liveGames[slot.key]" class="status-pill live-now">
                  ● {{ tr('liveInProgressTag') }} ({{ liveState.liveGames[slot.key].wind }}{{ liveState.liveGames[slot.key].roundNum }}局 {{ liveState.liveGames[slot.key].renchan }}本)
                </span>
                <span v-else-if="isSlotLocked(slot)" class="status-pill locked">🔒 {{ tr('statusLocked') }}</span>
                <span v-else class="status-pill pending">{{ tr('statusPending') }}</span>
              </div>
            </div>

            <div class="table-players-list">
              <div
                v-for="pid in slot.playerIds"
                :key="pid"
                class="tp-row"
                :class="{ me: highlightPlayerId !== '' && Number(highlightPlayerId) === pid }"
                @click="selectedPlayerId = pid"
              >
                <div class="tp-left">
                  <span
                    class="team-badge-sm"
                    :style="{
                      color: EVENT_TEAM_MAP[EVENT_PLAYER_MAP[pid].teamId].color,
                      backgroundColor: EVENT_TEAM_MAP[EVENT_PLAYER_MAP[pid].teamId].bgTint,
                    }"
                  >
                    {{ EVENT_PLAYER_MAP[pid].teamId }}
                  </span>
                  <span class="tp-id">#{{ pid }}</span>
                  <span class="tp-name">{{ formatEventPlayerName(EVENT_PLAYER_MAP[pid], eventLocale, 'full', showNameParens) }}</span>
                  <span v-if="EVENT_PLAYER_MAP[pid].isPro" class="pro-mini">{{ tr('proBadge') }}</span>
                </div>

                <div v-if="standings.calculatedMatches[slot.key]" class="tp-score">
                  <template
                    v-for="ce in [standings.calculatedMatches[slot.key].entries.find((e) => e.playerId === pid)]"
                    :key="pid"
                  >
                    <template v-if="ce">
                      <span class="tp-rank">#{{ ce.rank }}</span>
                      <span
                        class="tp-raw"
                        :title="ce.riichiBonus > 0 ? `${ce.rawScore.toLocaleString()} + ${ce.riichiBonus.toLocaleString()}` : ''"
                      >
                        {{ ce.finalScore.toLocaleString() }}
                      </span>
                      <strong class="tp-pt" :class="ce.finalPoint > 0 ? 'pos' : ce.finalPoint < 0 ? 'neg' : ''">
                        {{ formatSignedPoint(ce.finalPoint) }}
                      </strong>
                    </template>
                  </template>
                </div>
                <div v-else-if="liveState.liveGames[slot.key]" class="tp-score">
                  <template
                    v-for="lIdx in [liveState.liveGames[slot.key].seatPlayerIds.indexOf(pid)]"
                    :key="pid"
                  >
                    <template v-if="lIdx >= 0">
                      <span class="tp-wind-mini">{{ liveState.liveGames[slot.key].winds[lIdx] }}</span>
                      <strong class="tp-live-score">{{ liveState.liveGames[slot.key].scores[lIdx].toLocaleString() }}</strong>
                    </template>
                  </template>
                </div>
              </div>
            </div>

            <div class="table-card-actions">
              <button
                v-if="!state.results[slot.key] && liveState.liveGames[slot.key]"
                type="button"
                class="act-btn continue-btn"
                :disabled="isSlotLocked(slot)"
                @click="handleContinueLiveTable(slot)"
              >
                🔄 {{ tr('continueOnDevice') }}
              </button>
              <!-- Table 4 (JP-C): emphasize Result Only first, still allow Scorer -->
              <template v-if="slot.isJpC">
                <button
                  type="button"
                  class="act-btn primary jpc-primary"
                  :disabled="isSlotLocked(slot)"
                  @click="openScoreModal(slot)"
                >
                  📝 {{ state.results[slot.key] ? tr('editResult') : tr('recordResultOnly') }}
                </button>
                <button
                  type="button"
                  class="act-btn secondary"
                  :disabled="isSlotLocked(slot)"
                  @click="openSeatPicker(slot)"
                >
                  🀄 {{ tr('startScorer') }}
                </button>
              </template>
              <!-- Tables 1,2,3,5,6,7: emphasize Live Scorer first, also allow Result Only -->
              <template v-else>
                <button
                  type="button"
                  class="act-btn primary"
                  :disabled="isSlotLocked(slot)"
                  @click="openSeatPicker(slot)"
                >
                  🀄 {{ tr('startScorer') }}
                </button>
                <button
                  type="button"
                  class="act-btn secondary"
                  :disabled="isSlotLocked(slot)"
                  @click="openScoreModal(slot)"
                >
                  📝 {{ state.results[slot.key] ? tr('editResult') : tr('recordResultOnly') }}
                </button>
              </template>

              <button
                v-if="state.results[slot.key]?.rounds"
                type="button"
                class="act-btn log-btn"
                @click="matchLogKey = slot.key"
              >
                📈 {{ tr('viewRoundLog') }}
              </button>
            </div>
          </div>
        </div>

        <!-- 6-Round Full Matrix View -->
        <div v-else class="card-panel">
          <div class="table-scroll">
            <table class="matrix-table">
              <thead>
                <tr>
                  <th>Table</th>
                  <th v-for="r in [1, 2, 3, 4, 5, 6]" :key="r">{{ tr('roundLabel', { n: r }) }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="t in [1, 2, 3, 4, 5, 6, 7]" :key="t">
                  <td class="matrix-table-col">
                    <strong>{{ tr('tableLabel', { n: t }) }}</strong>
                    <span v-if="t === 4" class="jpc-inline">JP-C</span>
                  </td>
                  <td
                    v-for="r in [1, 2, 3, 4, 5, 6]"
                    :key="`${r}-${t}`"
                    class="matrix-cell"
                    :class="{
                      done: Boolean(state.results[getMatchKey(r, t)]),
                      highlighted:
                        highlightPlayerId !== '' &&
                        EVENT_MATCH_MAP[getMatchKey(r, t)].playerIds.includes(Number(highlightPlayerId)),
                    }"
                    @click="selectedRound = r; scheduleViewMode = 'cards'"
                  >
                    <div
                      v-for="pid in EVENT_MATCH_MAP[getMatchKey(r, t)].playerIds"
                      :key="pid"
                      class="mc-player"
                      :class="{
                        bold: EVENT_PLAYER_MAP[pid].isPro,
                        me: highlightPlayerId !== '' && Number(highlightPlayerId) === pid,
                      }"
                    >
                      <span class="mc-id">{{ pid }}</span>
                      <span>{{ formatEventPlayerName(EVENT_PLAYER_MAP[pid], eventLocale, 'compact') }}</span>
                      <span
                        class="mc-team"
                        :style="{ color: EVENT_TEAM_MAP[EVENT_PLAYER_MAP[pid].teamId].color }"
                      >
                        ({{ EVENT_PLAYER_MAP[pid].teamId }})
                      </span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- ============================ TAB 4: ROSTERS ============================ -->
      <section v-else-if="activeTab === 'rosters'" class="tab-section">
        <div class="rosters-grid">
          <div
            v-for="ts in standings.teams"
            :key="ts.team.id"
            class="roster-card"
            :style="{ borderTopColor: ts.team.color }"
          >
            <div class="rc-head">
              <h3 :style="{ color: ts.team.color }">{{ ts.team.name }}</h3>
              <strong :class="ts.totalPoints > 0 ? 'pos' : ts.totalPoints < 0 ? 'neg' : ''">
                {{ formatSignedPoint(ts.totalPoints) }} pt
              </strong>
            </div>

            <div class="rc-group-title">{{ tr('rostersProHeader') }}</div>
            <div class="rc-list">
              <div
                v-for="m in ts.members.filter((x) => x.player.isPro)"
                :key="m.player.id"
                class="rc-member pro-row"
                @click="selectedPlayerId = m.player.id"
              >
                <div class="rc-m-left">
                  <span class="tbl-id">#{{ m.player.id }}</span>
                  <strong>{{ formatEventPlayerName(m.player, eventLocale, 'full', showNameParens) }}</strong>
                  <span class="pro-mini">{{ tr('proBadge') }}</span>
                </div>
                <div class="rc-m-right">
                  <span class="dim">{{ m.gamesPlayed }}/6</span>
                  <strong :class="m.totalPoints > 0 ? 'pos' : m.totalPoints < 0 ? 'neg' : ''">
                    {{ formatSignedPoint(m.totalPoints) }}
                  </strong>
                </div>
              </div>
            </div>

            <div class="rc-group-title">{{ tr('rostersPlayersHeader') }}</div>
            <div class="rc-list">
              <div
                v-for="m in ts.members.filter((x) => !x.player.isPro)"
                :key="m.player.id"
                class="rc-member"
                @click="selectedPlayerId = m.player.id"
              >
                <div class="rc-m-left">
                  <span class="tbl-id">#{{ m.player.id }}</span>
                  <span>{{ formatEventPlayerName(m.player, eventLocale, 'full', showNameParens) }}</span>
                </div>
                <div class="rc-m-right">
                  <span class="dim">{{ m.gamesPlayed }}/6</span>
                  <strong :class="m.totalPoints > 0 ? 'pos' : m.totalPoints < 0 ? 'neg' : ''">
                    {{ formatSignedPoint(m.totalPoints) }}
                  </strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- ============================ TAB 5: RULES ============================ -->
      <section v-else class="tab-section">
        <div class="card-panel rules-panel">
          <h2 class="panel-title">{{ tr('rulesHeader') }}</h2>
          <div class="rules-grid">
            <div class="rule-item">
              <span>{{ tr('rulesStarting') }}</span>
              <strong>{{ state.config.startingScore.toLocaleString() }}</strong>
            </div>
            <div class="rule-item">
              <span>{{ tr('rulesReturn') }}</span>
              <strong>{{ state.config.returnScore.toLocaleString() }}</strong>
            </div>
            <div class="rule-item">
              <span>{{ tr('rulesOka') }}</span>
              <strong>{{ formatOka }}</strong>
            </div>
            <div class="rule-item">
              <span>{{ tr('rulesUma') }}</span>
              <strong>
                {{ state.config.uma.map((u) => (u > 0 ? `+${u}` : `${u}`)).join(' / ') }}
              </strong>
            </div>
            <div class="rule-item">
              <span>{{ tr('rulesTieBreak') }}</span>
              <strong>
                {{ state.config.tieBreak === 'split' ? tr('rulesTieSplit') : tr('rulesTieSeat') }}
              </strong>
            </div>
            <div class="rule-item">
              <span>{{ tr('rulesKiriage') }}</span>
              <strong>{{ state.config.roundMangan ? 'ON' : 'OFF' }}</strong>
            </div>
            <div class="rule-item">
              <span>{{ tr('rulesTobi') }}</span>
              <strong>{{ state.config.tobi ? 'ON' : 'OFF' }}</strong>
            </div>
            <div class="rule-item">
              <span>{{ tr('rulesRiichiPayout') }}</span>
              <strong>
                {{ state.config.riichiPayout ? tr('rulesRiichiFirst') : tr('rulesRiichiNone') }}
              </strong>
            </div>
            <div class="rule-item">
              <span>{{ tr('rulesChombo') }}</span>
              <strong>-{{ state.config.chomboPenalty }} pt</strong>
            </div>
            <div class="rule-item">
              <span>{{ tr('rulesAllLast') }}</span>
              <strong>{{ tr('rulesAllLastVal') }}</strong>
            </div>
          </div>

          <div class="rule-note-box">
            <h4>{{ tr('rulesExampleTitle') }}</h4>
            <p>{{ tr('rulesExampleBody') }}</p>
          </div>

          <div class="rule-note-box hybrid">
            <h4>{{ tr('rulesHybridTitle') }}</h4>
            <p>{{ tr('rulesHybridBody') }}</p>
          </div>
        </div>
      </section>
    </main>

    <!-- Modals -->
    <EventSeatPickerModal
      v-if="seatPickerSlot"
      :slot="seatPickerSlot"
      :event-locale="eventLocale"
      :show-name-parentheses="showNameParens"
      :tr="tr"
      @close="seatPickerSlot = null"
      @launch="handleLaunchScorer"
    />

    <EventScoreModal
      v-if="scoreModalSlot"
      :slot="scoreModalSlot"
      :config="state.config"
      :existing-result="state.results[scoreModalSlot.key] || null"
      :preset="scoreModalPreset"
      :is-staff="isStaff"
      :is-submitting="isBusy"
      :event-locale="eventLocale"
      :show-name-parentheses="showNameParens"
      :tr="tr"
      @close="scoreModalSlot = null; scoreModalPreset = null"
      @submit="handleManualSubmit"
      @delete="handleDeleteResult"
    />

    <EventPlayerModal
      v-if="selectedPlayerStanding"
      :standing="selectedPlayerStanding"
      :all-players="standings.players"
      :event-locale="eventLocale"
      :show-name-parentheses="showNameParens"
      :tr="tr"
      @close="selectedPlayerId = null"
      @open-match-log="(key) => (matchLogKey = key)"
      @select-player="(id) => (selectedPlayerId = id)"
    />

    <EventMatchDetailModal
      v-if="activeMatchLogResult"
      :result="activeMatchLogResult"
      :config="state.config"
      :is-dark="isDark"
      :event-locale="eventLocale"
      :tr="tr"
      @close="matchLogKey = null"
    />

    <EventStaffModal
      v-if="isStaffModalOpen"
      :is-staff="isStaff"
      :config="state.config"
      :audit-log="state.auditLog"
      :is-busy="isBusy"
      :is-sandbox="isSandbox"
      :tr="tr"
      @close="isStaffModalOpen = false"
      @login="handleStaffLogin"
      @logout="handleStaffLogout"
      @save-config="handleSaveConfig"
      @rollback="handleRollback"
      @export-csv="handleExportCsv"
      @export-json="handleExportJson"
    />
  </div>
</template>

<style scoped>
.knu-event-page {
  min-height: 100vh;
  background: var(--bg-color);
  color: var(--text-color);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans KR', 'Noto Sans JP', sans-serif;
  padding-bottom: 48px;
}

.hdr-timer-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 132px;
  padding: 2px 9px;
  border-radius: 999px;
  font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, 'Noto Sans KR', monospace;
  font-size: 12px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  background: rgba(16, 185, 129, 0.14);
  border: 1px solid rgba(16, 185, 129, 0.45);
  color: #16a34a;
}
.hdr-timer-pill small {
  font-size: 10.5px;
  opacity: 0.85;
}
.hdr-timer-pill.sev-warn {
  background: rgba(245, 158, 11, 0.16);
  border-color: rgba(245, 158, 11, 0.5);
  color: #d97706;
}
.hdr-timer-pill.sev-critical,
.hdr-timer-pill.sev-expired {
  background: rgba(239, 68, 68, 0.16);
  border-color: rgba(239, 68, 68, 0.55);
  color: #ef4444;
}
.sb-groups {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sb-group {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  flex-wrap: wrap;
}
.sb-group-lbl {
  font-size: 11px;
  font-weight: 900;
  color: #f59e0b;
  min-width: 78px;
  padding-top: 6px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.sb-btn.qa-btn {
  border-color: rgba(16, 185, 129, 0.55);
  background: rgba(16, 185, 129, 0.16);
  color: #10b981;
}
.qa-report-box {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.72);
  border: 1px solid rgba(148, 163, 184, 0.3);
  color: #f1f5f9;
}
.qa-report-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 12.5px;
}
.qa-close-btn {
  border: none;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  font-size: 14px;
}
.qa-checks-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 6px;
}
.qa-check-item {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  padding: 6px 8px;
  border-radius: 7px;
  font-size: 11.5px;
  background: rgba(30, 41, 59, 0.7);
  border: 1px solid rgba(16, 185, 129, 0.35);
}
.qa-check-item.fail {
  border-color: rgba(239, 68, 68, 0.6);
  background: rgba(127, 29, 29, 0.35);
}
.qac-name { font-weight: 800; color: #f8fafc; }
.qac-detail { font-size: 10.5px; color: #cbd5e1; margin-top: 1px; }
.ev-toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: #0f172a;
  color: #f8fafc;
  padding: 10px 18px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
  z-index: 2000;
}
.ev-toast-fade-enter-active,
.ev-toast-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.ev-toast-fade-enter-from,
.ev-toast-fade-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}

/* Sandbox Banner */
.sandbox-banner {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.18), rgba(217, 119, 6, 0.1));
  border-bottom: 2px solid rgba(245, 158, 11, 0.55);
  padding: 12px 16px;
}
.sb-top {
  max-width: 1220px;
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.sb-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;
}
.sb-pill {
  background: #d97706;
  color: #fff;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
}
.sb-desc {
  max-width: 1220px;
  margin: 4px auto 8px;
  font-size: 12px;
  color: var(--text-dimmed);
}
.sb-actions {
  max-width: 1220px;
  margin: 0 auto;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.sb-btn,
.sb-btn-live {
  padding: 6px 11px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  border: 1px solid rgba(217, 119, 6, 0.45);
  background: var(--card-bg-color);
  color: var(--text-color);
}
.sb-btn.accent {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}
.sb-btn.danger {
  border-color: rgba(239, 68, 68, 0.45);
  color: #ef4444;
}
.sb-btn-live {
  background: #0f172a;
  color: #fff;
  border-color: #334155;
}

/* Header */
.ev-header {
  background: var(--card-bg-color);
  border-bottom: 1px solid var(--border-color);
  padding: 16px 16px 14px;
}
.ev-header-inner {
  max-width: 1220px;
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.ev-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.ev-title {
  margin: 0;
  font-size: 20px;
  font-weight: 900;
  letter-spacing: -0.02em;
}
.header-sb-tag {
  font-size: 11px;
  font-weight: 800;
  padding: 2px 7px;
  border-radius: 6px;
  background: rgba(245, 158, 11, 0.18);
  color: #d97706;
}
.ev-meta-row {
  margin-top: 5px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 12.5px;
  color: var(--text-dimmed);
}
.progress-chip {
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  color: var(--text-color);
  font-size: 12px;
}
.sub-split {
  color: var(--text-dimmed);
  margin-left: 3px;
}
.live-auto-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  color: #16a34a;
  background: rgba(22, 163, 74, 0.12);
  border: 1px solid rgba(22, 163, 74, 0.35);
}
.live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #16a34a;
  animation: livePulse 2s ease-in-out infinite;
}
.live-dot.syncing {
  background: #3b82f6;
}
.live-ts {
  font-weight: 600;
  color: var(--text-dimmed);
  font-variant-numeric: tabular-nums;
}
@keyframes livePulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.85); }
}

.ev-header-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.lang-switch {
  display: inline-flex;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-card);
}
.lang-btn {
  padding: 6px 9px;
  font-size: 12px;
  font-weight: 800;
  border: none;
  background: transparent;
  color: var(--text-dimmed);
  cursor: pointer;
}
.lang-btn.active {
  background: #2563eb;
  color: #fff;
}
.hdr-btn {
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  color: var(--text-color);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}
.hdr-btn.resume-btn {
  background: #16a34a;
  color: #fff;
  border-color: #16a34a;
}
.hdr-btn.monitor-btn {
  background: rgba(239, 68, 68, 0.14);
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.45);
}
.hdr-btn.staff-btn.active {
  background: rgba(37, 99, 235, 0.16);
  border-color: rgba(37, 99, 235, 0.5);
  color: #3b82f6;
}

/* Tabs */
.ev-tabs {
  background: var(--card-bg-color);
  border-bottom: 1px solid var(--border-color);
  position: sticky;
  top: 0;
  z-index: 30;
}
.ev-tabs-inner {
  max-width: 1220px;
  margin: 0 auto;
  display: flex;
  gap: 4px;
  padding: 8px 16px;
  overflow-x: auto;
}
.ev-tabs-inner button {
  padding: 8px 14px;
  border-radius: 9px;
  border: none;
  background: transparent;
  color: var(--text-dimmed);
  font-size: 13.5px;
  font-weight: 800;
  cursor: pointer;
  white-space: nowrap;
}
.ev-tabs-inner button.active {
  background: #2563eb;
  color: #fff;
}

/* Main */
.ev-main {
  max-width: 1220px;
  margin: 0 auto;
  padding: 18px 16px;
}
.tab-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.ev-error-banner {
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.45);
  color: #ef4444;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
  font-size: 13px;
  font-weight: 700;
}

.section-header h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 800;
}

/* Team Cards */
.team-cards-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
.team-card {
  background: var(--card-bg-color);
  border: 1px solid var(--border-color);
  border-top: 4px solid #3b82f6;
  border-radius: 12px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tc-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.tc-rank-name {
  display: flex;
  align-items: center;
  gap: 6px;
}
.tc-rank {
  font-size: 12px;
  font-weight: 900;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--bg-card);
}
.tc-rank.tr-1 { background: rgba(245, 158, 11, 0.2); color: #d97706; }
.tc-name { font-size: 16px; font-weight: 900; }
.tc-games { font-size: 11.5px; color: var(--text-dimmed); font-weight: 700; }
.tc-points {
  font-size: 28px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.tc-points small { font-size: 13px; font-weight: 700; color: var(--text-dimmed); }
.tc-sub-metrics,
.tc-ranks-bar,
.tc-contrib {
  display: flex;
  justify-content: space-between;
  font-size: 11.5px;
  color: var(--text-dimmed);
}
.tc-ranks-bar {
  padding-top: 6px;
  border-top: 1px dashed var(--border-color);
}

/* Card Panel */
.card-panel {
  background: var(--card-bg-color);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 16px;
}
.panel-title {
  margin: 0 0 12px;
  font-size: 15.5px;
  font-weight: 800;
}
.panel-head-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
}
.panel-head-row .panel-title { margin: 0; }
.dual-legend { font-size: 11.5px; color: var(--text-dimmed); }

.team-chart-wrap {
  height: 240px;
  width: 100%;
}

.filter-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.search-input {
  width: 190px !important;
  padding: 6px 10px !important;
  font-size: 12.5px !important;
  border-radius: 8px !important;
  border: 1px solid var(--input-border-color) !important;
  background: var(--input-bg-color) !important;
  color: var(--text-color) !important;
  text-align: left !important;
}
.chip-group {
  display: inline-flex;
  gap: 3px;
}
.filter-chip {
  padding: 5px 9px;
  font-size: 11.5px;
  font-weight: 700;
  border-radius: 7px;
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  color: var(--text-dimmed);
  cursor: pointer;
}
.filter-chip.active {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}

.table-scroll {
  overflow-x: auto;
}
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}
.data-table th {
  padding: 9px 8px;
  border-bottom: 2px solid var(--border-color);
  color: var(--text-dimmed);
  font-weight: 800;
  white-space: nowrap;
  text-align: center;
}
.data-table th.left,
.data-table td.left {
  text-align: left;
}
.data-table th.sortable {
  cursor: pointer;
}
.data-table th.sortable:hover {
  color: var(--text-color);
}
.data-table td {
  padding: 9px 8px;
  border-bottom: 1px solid var(--border-color);
  text-align: center;
  white-space: nowrap;
}
.clickable-row {
  cursor: pointer;
}
.clickable-row:hover {
  background: var(--bg-hover-color);
}
.tbl-player {
  display: flex;
  align-items: center;
  gap: 6px;
}
.tbl-id { font-size: 11px; color: var(--text-dimmed); font-weight: 700; }
.tbl-name { font-weight: 700; }
.pro-mini {
  font-size: 9.5px;
  font-weight: 800;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(245, 158, 11, 0.18);
  color: #d97706;
}
.team-badge-sm {
  display: inline-block;
  font-size: 11px;
  font-weight: 800;
  padding: 2px 7px;
  border-radius: 5px;
}
.num { font-variant-numeric: tabular-nums; }
.bold { font-weight: 800; }
.dim { color: var(--text-dimmed); }
.pos { color: var(--color-positive); }
.neg { color: var(--color-negative); }

.notice-card {
  padding: 11px 14px;
  border-radius: 10px;
  background: rgba(59, 130, 246, 0.09);
  border: 1px solid rgba(59, 130, 246, 0.3);
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text-color);
}

/* Schedule Tab */
.schedule-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.round-pills {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.round-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 12px;
  border-radius: 9px;
  border: 1px solid var(--border-color);
  background: var(--card-bg-color);
  color: var(--text-color);
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
}
.round-pill.active {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}
.rp-count { font-size: 11px; opacity: 0.8; }

.schedule-right-tools {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.find-player-select {
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--input-border-color);
  background: var(--card-bg-color);
  color: var(--text-color);
  font-size: 12.5px;
  font-weight: 600;
}
.view-toggle {
  display: inline-flex;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}
.view-toggle button {
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 700;
  border: none;
  background: var(--card-bg-color);
  color: var(--text-dimmed);
  cursor: pointer;
}
.view-toggle button.active {
  background: #2563eb;
  color: #fff;
}
.btn-lock-round {
  padding: 6px 11px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--card-bg-color);
  color: var(--text-color);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.btn-lock-round.locked {
  border-color: rgba(239, 68, 68, 0.5);
  color: #ef4444;
}

.tables-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 12px;
}
.table-card {
  background: var(--card-bg-color);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.table-card.done {
  border-color: rgba(16, 185, 129, 0.45);
}
.table-card.is-jpc {
  border-left: 4px solid #a855f7;
}
.table-card.highlighted {
  box-shadow: 0 0 0 2px #f59e0b;
}
.table-card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.tch-left { display: flex; align-items: center; gap: 6px; }
.table-num { font-size: 15px; font-weight: 900; }
.hw-badge {
  font-size: 10.5px;
  font-weight: 800;
  padding: 2px 7px;
  border-radius: 999px;
}
.hw-badge.jpc {
  background: rgba(168, 85, 247, 0.16);
  color: #a855f7;
  border: 1px solid rgba(168, 85, 247, 0.4);
}
.hw-badge.scorer {
  background: rgba(59, 130, 246, 0.12);
  color: #3b82f6;
}
.status-pill {
  font-size: 11px;
  font-weight: 800;
  padding: 2px 8px;
  border-radius: 999px;
}
.status-pill.done { background: rgba(16, 185, 129, 0.16); color: #10b981; }
.status-pill.live-now { background: rgba(239, 68, 68, 0.16); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.45); }
.status-pill.pending { background: var(--bg-card); color: var(--text-dimmed); }
.status-pill.locked { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
.tp-wind-mini { font-size: 11px; font-weight: 800; color: var(--color-east); }
.tp-live-score { font-size: 13px; color: var(--text-color); }
.act-btn.continue-btn { background: #16a34a; color: #fff; flex: 1 1 100%; }

.table-players-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.tp-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--bg-card);
  cursor: pointer;
}
.tp-row.me {
  background: rgba(245, 158, 11, 0.16);
  outline: 1px solid rgba(245, 158, 11, 0.55);
}
.tp-left { display: flex; align-items: center; gap: 6px; min-width: 0; }
.tp-id { font-size: 11px; color: var(--text-dimmed); font-weight: 700; }
.tp-name { font-size: 13px; font-weight: 700; }
.tp-score { display: flex; align-items: center; gap: 7px; font-size: 12px; font-variant-numeric: tabular-nums; }
.tp-rank { font-weight: 800; color: var(--text-dimmed); }
.tp-raw { color: var(--text-dimmed); }
.tp-pt { font-size: 13px; }

.table-card-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  padding-top: 4px;
}
.act-btn {
  flex: 1;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
  border: 1px solid transparent;
  white-space: nowrap;
}
.act-btn.primary { background: #2563eb; color: #fff; }
.act-btn.primary.jpc-primary { background: #9333ea; }
.act-btn.secondary { background: var(--bg-card); color: var(--text-color); border-color: var(--border-color); }
.act-btn.log-btn { flex: 0 0 auto; background: rgba(16, 185, 129, 0.14); color: #10b981; border-color: rgba(16, 185, 129, 0.35); }
.act-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* Matrix */
.matrix-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11.5px;
}
.matrix-table th, .matrix-table td {
  border: 1px solid var(--border-color);
  padding: 7px 6px;
  vertical-align: top;
}
.matrix-table th { background: var(--bg-card); text-align: center; font-weight: 800; }
.matrix-table-col { white-space: nowrap; text-align: center; background: var(--bg-card); }
.jpc-inline {
  display: block;
  margin-top: 3px;
  font-size: 10px;
  color: #a855f7;
  font-weight: 800;
}
.matrix-cell { cursor: pointer; min-width: 155px; }
.matrix-cell.done { background: rgba(16, 185, 129, 0.06); }
.matrix-cell.highlighted { background: rgba(245, 158, 11, 0.14); }
.mc-player { display: flex; gap: 4px; line-height: 1.45; white-space: nowrap; }
.mc-player.me { font-weight: 900; color: #d97706; }
.mc-id { color: var(--text-dimmed); width: 16px; display: inline-block; }

/* Rosters */
.rosters-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
}
.roster-card {
  background: var(--card-bg-color);
  border: 1px solid var(--border-color);
  border-top: 4px solid #3b82f6;
  border-radius: 12px;
  padding: 16px;
}
.rc-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.rc-head h3 { margin: 0; font-size: 17px; font-weight: 900; }
.rc-group-title {
  font-size: 11.5px;
  font-weight: 800;
  color: var(--text-dimmed);
  margin: 10px 0 6px;
  text-transform: uppercase;
}
.rc-list { display: flex; flex-direction: column; gap: 5px; }
.rc-member {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 7px 10px;
  border-radius: 8px;
  background: var(--bg-card);
  font-size: 13px;
  cursor: pointer;
}
.rc-member.pro-row {
  border: 1px solid rgba(245, 158, 11, 0.35);
}
.rc-m-left, .rc-m-right { display: flex; align-items: center; gap: 7px; }

/* Rules */
.rules-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 16px;
}
.rule-item {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.rule-item span { font-size: 12px; color: var(--text-dimmed); }
.rule-item strong { font-size: 14px; }
.rule-note-box {
  padding: 13px 15px;
  border-radius: 10px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  margin-top: 10px;
}
.rule-note-box.hybrid {
  border-color: rgba(168, 85, 247, 0.4);
  background: rgba(168, 85, 247, 0.07);
}
.rule-note-box h4 { margin: 0 0 5px; font-size: 13.5px; }
.rule-note-box p { margin: 0; font-size: 12.5px; line-height: 1.55; color: var(--text-dimmed); }

@media (max-width: 980px) {
  .team-cards-grid { grid-template-columns: repeat(2, 1fr); }
  .rules-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 680px) {
  .team-cards-grid { grid-template-columns: 1fr; }
  .rosters-grid { grid-template-columns: 1fr; }
  .rules-grid { grid-template-columns: 1fr; }
  .tables-grid { grid-template-columns: 1fr; }
  .ev-title { font-size: 17px; }
}
</style>
