<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import {
  DEFAULT_EVENT_CONFIG,
  EVENT_PLAYER_MAP,
  EVENT_TEAMS,
  EVENT_TEAM_MAP,
  getRoundMatches,
  type EventMatchSlot,
  type TeamId,
} from '@/data/knuNpm2026';
import {
  calculateTableScoring,
  computeLeagueStandings,
  computeRoundTimerDisplay,
  formatSignedPoint,
  normalizeConfig,
  round1,
  type EventStatePayload,
  type LiveStatePayload,
  type LiveTableState,
} from '@/utils/knuNpmScoring';
import {
  EVENT_LOCALES,
  createEventTranslator,
  type EventLocale,
} from '@/locales/knuNpmEvent';
import {
  fetchEventState,
  fetchEventStateIfChanged,
  fetchLiveState,
  fetchLiveStateIfChanged,
  getSyncedNowMs,
  seedSandboxLiveGames,
  subscribeEventStateUpdates,
  subscribeLiveStateUpdates,
  updateSandboxQuickTimer,
  upsertLiveTableState,
} from '@/services/knuNpmEventService';
import { getKnuNpmBasePath } from '@/utils/eventMode';

interface Props {
  isSandbox?: boolean;
  eventLocale: EventLocale;
}
const props = withDefaults(defineProps<Props>(), {
  isSandbox: false,
});

const emit = defineEmits<{
  (e: 'change-locale', loc: EventLocale): void;
}>();

const router = useRouter();
const route = useRoute();
const tr = createEventTranslator(() => props.eventLocale);

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

const parseInitialRoundMode = (): 'auto' | number => {
  const r = Number(route.query.round);
  return Number.isInteger(r) && r >= 1 && r <= 6 ? r : 'auto';
};

const selectedRoundMode = ref<'auto' | number>(parseInitialRoundMode());
const showProjectedPoints = ref(true);
const isFullscreen = ref(false);
const lastSyncAt = ref(Date.now());
const nowTick = ref(Date.now());

const selectRoundMode = (mode: 'auto' | number) => {
  selectedRoundMode.value = mode;
  const nextQuery: Record<string, string> = {};
  for (const [k, v] of Object.entries(route.query)) {
    if (typeof v === 'string' && v) nextQuery[k] = v;
  }
  if (mode === 'auto') delete nextQuery.round;
  else nextQuery.round = String(mode);
  router.replace({ path: route.path, query: nextQuery }).catch(() => {});
};

const monitorTimerDisplay = computed(() => {
  void nowTick.value;
  const tmr = state.value.config.roundTimer;
  if (!tmr || tmr.status === 'idle') return null;
  return computeRoundTimerDisplay(tmr, getSyncedNowMs(props.isSandbox));
});

const handleToggleSandboxTimer = () => {
  if (!props.isSandbox) return;
  const cur = state.value.config.roundTimer;
  const now = Date.now();
  if (cur && cur.status === 'running') {
    state.value = updateSandboxQuickTimer({
      ...cur,
      status: 'idle',
      endsAt: null,
      pausedRemainingMs: null,
      updatedAt: now,
    });
  } else {
    state.value = updateSandboxQuickTimer({
      round: activeRound.value,
      durationMinutes: 50,
      extraHands: 0,
      status: 'running',
      endsAt: now + 50 * 60_000,
      pausedRemainingMs: null,
      updatedAt: now,
    });
  }
};

const loadInitial = async (force = false) => {
  try {
    const [st, lv] = await Promise.all([
      fetchEventState(props.isSandbox, force),
      fetchLiveState(props.isSandbox, force),
    ]);
    state.value = st;
    liveState.value = lv;
    lastSyncAt.value = Date.now();
  } catch (err) {
    console.warn('Live monitor sync failed:', err);
  }
};

const pollLive = async () => {
  if (typeof document !== 'undefined' && document.hidden) return;
  try {
    const res = await fetchLiveStateIfChanged(props.isSandbox, liveState.value.updatedAt);
    lastSyncAt.value = Date.now();
    if (!res.unchanged) {
      liveState.value = res.liveState;
    }
  } catch {}
};

const pollState = async () => {
  if (typeof document !== 'undefined' && document.hidden) return;
  try {
    const res = await fetchEventStateIfChanged(props.isSandbox, state.value.updatedAt);
    lastSyncAt.value = Date.now();
    if (!res.unchanged) {
      state.value = res.state;
    }
  } catch {}
};

let liveTimer: ReturnType<typeof setInterval> | null = null;
let stateTimer: ReturnType<typeof setInterval> | null = null;
let clockTimer: ReturnType<typeof setInterval> | null = null;
let unsubState: (() => void) | null = null;
let unsubLive: (() => void) | null = null;

const onFullscreenChange = () => {
  if (typeof document !== 'undefined') {
    isFullscreen.value = Boolean(document.fullscreenElement);
  }
};

onMounted(async () => {
  await loadInitial(false);

  unsubState = subscribeEventStateUpdates(({ state: incoming, sandbox }) => {
    if (Boolean(sandbox) !== Boolean(props.isSandbox)) return;
    state.value = incoming;
    lastSyncAt.value = Date.now();
  });
  unsubLive = subscribeLiveStateUpdates(({ liveState: incoming, sandbox }) => {
    if (Boolean(sandbox) !== Boolean(props.isSandbox)) return;
    liveState.value = incoming;
    lastSyncAt.value = Date.now();
  });

  liveTimer = setInterval(pollLive, 4000);
  stateTimer = setInterval(pollState, 15000);
  clockTimer = setInterval(() => {
    nowTick.value = Date.now();
  }, 1000);

  if (typeof document !== 'undefined') {
    document.addEventListener('fullscreenchange', onFullscreenChange);
  }
});

onUnmounted(() => {
  if (liveTimer) clearInterval(liveTimer);
  if (stateTimer) clearInterval(stateTimer);
  if (clockTimer) clearInterval(clockTimer);
  if (demoInterval) clearInterval(demoInterval);
  Object.values(scoreAnimHandles).forEach((id) => cancelAnimationFrame(id));
  if (unsubState) unsubState();
  if (unsubLive) unsubLive();
  if (typeof document !== 'undefined') {
    document.removeEventListener('fullscreenchange', onFullscreenChange);
  }
});

watch(
  () => props.isSandbox,
  () => loadInitial(false)
);

const standings = computed(() => computeLeagueStandings(state.value.results, state.value.config));

// Auto-detect active round: prefer round with most active live games, else first incomplete round, else R6
const activeRound = computed<number>(() => {
  if (selectedRoundMode.value !== 'auto') return selectedRoundMode.value;
  const liveCounts = [0, 0, 0, 0, 0, 0];
  for (const lg of Object.values(liveState.value.liveGames || {})) {
    if (lg && lg.round >= 1 && lg.round <= 6) {
      liveCounts[lg.round - 1]++;
    }
  }
  let bestLiveRound = 0;
  let maxLive = 0;
  for (let i = 0; i < 6; i++) {
    if (liveCounts[i] > maxLive) {
      maxLive = liveCounts[i];
      bestLiveRound = i + 1;
    }
  }
  if (bestLiveRound > 0) return bestLiveRound;
  const firstIncomplete = standings.value.roundCompletedCounts.findIndex((cnt) => cnt < 7);
  return firstIncomplete >= 0 ? firstIncomplete + 1 : 6;
});

const roundSlots = computed(() => getRoundMatches(activeRound.value));

interface TableDisplayPlayer {
  playerId: number;
  name: string;
  teamId: TeamId;
  isPro: boolean;
  wind: string;
  isDealer: boolean;
  rank: number;
  score: number;
  projectedPt: number;
  isRiichi: boolean;
  chomboPen: number;
}

interface TableMonitorCard {
  slot: EventMatchSlot;
  status: 'final' | 'live' | 'waiting';
  roundBadge: string;
  riichiSticks: number;
  updatedAt: number | null;
  players: TableDisplayPlayer[];
}

const tableCards = computed<TableMonitorCard[]>(() => {
  const cfg = state.value.config;
  const penUnit = Math.abs(cfg.chomboPenalty ?? 20);
  const windsDefault = ['東', '南', '西', '北'];

  return roundSlots.value.map((slot) => {
    const finalRes = state.value.results[slot.key];
    const finalCalc = standings.value.calculatedMatches[slot.key];
    const liveGame: LiveTableState | undefined = liveState.value.liveGames?.[slot.key];

    if (finalRes && finalCalc) {
      const players: TableDisplayPlayer[] = finalCalc.entries
        .map((e) => {
          const ep = EVENT_PLAYER_MAP[e.playerId];
          return {
            playerId: e.playerId,
            name: ep?.name || `#${e.playerId}`,
            teamId: ep?.teamId || 'A',
            isPro: Boolean(ep?.isPro),
            wind: windsDefault[e.seatIndex] || '',
            isDealer: false,
            rank: e.rank,
            score: e.rawScore,
            projectedPt: e.finalPoint,
            isRiichi: false,
            chomboPen: e.penalty,
          };
        })
        .sort((a, b) => a.rank - b.rank || b.score - a.score);

      return {
        slot,
        status: 'final',
        roundBadge: finalRes.source === 'manual' ? 'FINAL (JP-C)' : 'FINAL ✓',
        riichiSticks: 0,
        updatedAt: finalRes.submittedAt,
        players,
      };
    }

    if (liveGame) {
      const calcInput = liveGame.seatPlayerIds.map((pid, idx) => ({
        playerId: pid,
        rawScore: Number(liveGame.scores[idx] ?? cfg.startingScore),
        penalty: -(Number(liveGame.chomboCounts?.[idx] || 0) * penUnit),
        seatIndex: idx,
      }));
      const liveCalc = calculateTableScoring(calcInput, cfg);

      const players: TableDisplayPlayer[] = liveCalc.entries
        .map((e, idx) => {
          const ep = EVENT_PLAYER_MAP[e.playerId];
          const w = liveGame.winds?.[idx] || windsDefault[idx];
          return {
            playerId: e.playerId,
            name: ep?.name || `#${e.playerId}`,
            teamId: ep?.teamId || 'A',
            isPro: Boolean(ep?.isPro),
            wind: w,
            isDealer: w === '東',
            rank: e.rank,
            score: e.rawScore,
            projectedPt: e.finalPoint,
            isRiichi: Boolean(liveGame.riichiActive?.[idx]),
            chomboPen: e.penalty,
          };
        })
        .sort((a, b) => a.rank - b.rank || b.score - a.score);

      return {
        slot,
        status: 'live',
        roundBadge: `${liveGame.wind} ${liveGame.roundNum}局 ${liveGame.renchan}本場`,
        riichiSticks: liveGame.riichiSticks || 0,
        updatedAt: liveGame.updatedAt,
        players,
      };
    }

    // Waiting
    const players: TableDisplayPlayer[] = slot.playerIds.map((pid, idx) => {
      const ep = EVENT_PLAYER_MAP[pid];
      return {
        playerId: pid,
        name: ep?.name || `#${pid}`,
        teamId: ep?.teamId || 'A',
        isPro: Boolean(ep?.isPro),
        wind: windsDefault[idx],
        isDealer: idx === 0,
        rank: idx + 1,
        score: cfg.startingScore,
        projectedPt: 0,
        isRiichi: false,
        chomboPen: 0,
      };
    });

    return {
      slot,
      status: 'waiting',
      roundBadge: slot.isJpC ? 'JP-C' : tr('monitorWaiting'),
      riichiSticks: 0,
      updatedAt: null,
      players,
    };
  });
});

// 4-Team Live Standings (Confirmed + Live Projected from active tables)
const liveTeamStandings = computed(() => {
  const liveDeltaByTeam: Record<TeamId, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const card of tableCards.value) {
    if (card.status !== 'live') continue;
    for (const p of card.players) {
      liveDeltaByTeam[p.teamId] = round1(liveDeltaByTeam[p.teamId] + p.projectedPt);
    }
  }
  const list = EVENT_TEAMS.map((team) => {
    const confirmed = standings.value.teams.find((t) => t.team.id === team.id);
    const confirmedPt = confirmed ? confirmed.totalPoints : 0;
    const liveDelta = liveDeltaByTeam[team.id];
    const projectedTotal = round1(confirmedPt + liveDelta);
    return {
      team,
      confirmedPt,
      liveDelta,
      projectedTotal,
      displayPt: showProjectedPoints.value ? projectedTotal : confirmedPt,
      rank: 1,
    };
  });
  list.sort((a, b) => b.displayPt - a.displayPt || a.team.id.localeCompare(b.team.id));
  list.forEach((item, idx) => {
    item.rank = idx > 0 && item.displayPt === list[idx - 1].displayPt ? list[idx - 1].rank : idx + 1;
  });
  return list;
});

const liveTableCount = computed(() => tableCards.value.filter((c) => c.status === 'live').length);
const finalTableCount = computed(() => tableCards.value.filter((c) => c.status === 'final').length);

const toggleFullscreen = async () => {
  if (typeof document === 'undefined') return;
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch {}
};

const goBackToDashboard = () => {
  const dest = getKnuNpmBasePath(props.isSandbox) || '/';
  router.push({ path: dest, query: { lang: props.eventLocale } });
};

const handleSimulateLive = () => {
  if (!props.isSandbox) return;
  liveState.value = seedSandboxLiveGames(activeRound.value);
  lastSyncAt.value = Date.now();
};

// Real-time Score Rolling + Delta Popups + Riichi Flash Detection
const animatedScores = ref<Record<string, number>>({});
const deltaFlashes = ref<Record<string, { delta: number; ts: number }>>({});
const riichiFlashes = ref<Record<string, number>>({});
const prevScoreSnapshot: Record<string, number> = {};
const prevRiichiSnapshot: Record<string, boolean> = {};
const scoreAnimHandles: Record<string, number> = {};

const animateScoreValue = (cellKey: string, from: number, to: number) => {
  if (scoreAnimHandles[cellKey]) {
    cancelAnimationFrame(scoreAnimHandles[cellKey]);
  }
  const start = performance.now();
  const duration = 650;
  const step = (now: number) => {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    const cur = Math.round((from + (to - from) * eased) / 100) * 100;
    animatedScores.value = { ...animatedScores.value, [cellKey]: p >= 1 ? to : cur };
    if (p < 1) {
      scoreAnimHandles[cellKey] = requestAnimationFrame(step);
    } else {
      delete scoreAnimHandles[cellKey];
    }
  };
  scoreAnimHandles[cellKey] = requestAnimationFrame(step);
};

watch(
  tableCards,
  (cards) => {
    const now = Date.now();
    const nextDeltas = { ...deltaFlashes.value };
    const nextRiichi = { ...riichiFlashes.value };
    let deltaChanged = false;
    let riichiChanged = false;

    for (const card of cards) {
      if (card.status === 'waiting') continue;
      for (const p of card.players) {
        const ck = `${card.slot.key}:${p.playerId}`;
        const prevScore = prevScoreSnapshot[ck];
        if (prevScore !== undefined && prevScore !== p.score) {
          const diff = p.score - prevScore;
          nextDeltas[ck] = { delta: diff, ts: now };
          deltaChanged = true;
          animateScoreValue(ck, prevScore, p.score);
        } else if (animatedScores.value[ck] === undefined) {
          animatedScores.value = { ...animatedScores.value, [ck]: p.score };
        }
        prevScoreSnapshot[ck] = p.score;

        const prevR = prevRiichiSnapshot[ck];
        if (p.isRiichi && prevR === false) {
          nextRiichi[ck] = now;
          riichiChanged = true;
        }
        prevRiichiSnapshot[ck] = p.isRiichi;
      }
    }

    if (deltaChanged) deltaFlashes.value = nextDeltas;
    if (riichiChanged) riichiFlashes.value = nextRiichi;
  },
  { immediate: true }
);

const getDisplayScore = (matchKey: string, playerId: number, actualScore: number) => {
  const ck = `${matchKey}:${playerId}`;
  return animatedScores.value[ck] ?? actualScore;
};

const getActiveDelta = (matchKey: string, playerId: number): number | null => {
  void nowTick.value;
  const ck = `${matchKey}:${playerId}`;
  const entry = deltaFlashes.value[ck];
  if (!entry) return null;
  if (Date.now() - entry.ts > 4500) return null;
  return entry.delta;
};

const isRiichiFresh = (matchKey: string, playerId: number): boolean => {
  void nowTick.value;
  const ck = `${matchKey}:${playerId}`;
  const ts = riichiFlashes.value[ck];
  return Boolean(ts && Date.now() - ts <= 3500);
};

// Sandbox Interactive Live Broadcast Demo (simulates Riichi, Ron/Tsumo, Rank Sliding, Round Progression!)
const isDemoRunning = ref(false);
const demoSpeed = ref<'normal' | 'fast' | 'turbo'>('fast');
let demoInterval: ReturnType<typeof setInterval> | null = null;
let demoStepCursor = 0;

const DEMO_SPEED_MS: Record<'normal' | 'fast' | 'turbo', number> = {
  normal: 2200,
  fast: 850,
  turbo: 320,
};

const runSandboxDemoStep = async () => {
  if (!props.isSandbox) return;
  const existingKeys = Object.keys(liveState.value.liveGames || {}).filter((k) =>
    k.startsWith(`R${activeRound.value}-`)
  );
  if (existingKeys.length === 0) {
    liveState.value = seedSandboxLiveGames(activeRound.value);
    lastSyncAt.value = Date.now();
    return;
  }

  // Turbo mode updates 2 tables at once for blazing-fast broadcast stress test!
  const batchCount = demoSpeed.value === 'turbo' ? 2 : 1;
  for (let b = 0; b < batchCount; b++) {
    const pickKey = existingKeys[demoStepCursor % existingKeys.length];
    demoStepCursor++;
    const lg = liveState.value.liveGames[pickKey];
    if (!lg) continue;

    const scores = [...lg.scores] as [number, number, number, number];
    const winds = [...lg.winds] as [string, string, string, string];
    const riichiActive = [...lg.riichiActive] as [boolean, boolean, boolean, boolean];
    let riichiSticks = Number(lg.riichiSticks || 0);
    let wind = lg.wind || '東';
    let roundNum = Number(lg.roundNum || 1);
    let renchan = Number(lg.renchan || 0);

    const activeRiichiCount = riichiActive.filter(Boolean).length;

    // Alternate between Riichi declaration and Big Hand Resolution so user sees BOTH animations!
    if (activeRiichiCount < 2 && demoStepCursor % 2 === 1) {
      const candidates = [0, 1, 2, 3].filter((i) => !riichiActive[i]);
      const rIdx = candidates[Math.floor(Math.random() * candidates.length)] ?? 0;
      riichiActive[rIdx] = true;
      scores[rIdx] -= 1000;
      riichiSticks += 1;
    } else {
      const winnerIdx = riichiActive.findIndex(Boolean) >= 0 ? riichiActive.findIndex(Boolean) : (demoStepCursor % 4);
      const dealerIdx = winds.indexOf('東');
      const isTsumo = demoStepCursor % 3 === 0;
      const isOyaWin = winnerIdx === dealerIdx;
      const potBonus = riichiSticks * 1000 + renchan * 300;

      if (isTsumo) {
        const eachPay = isOyaWin ? 4000 : 2000;
        const oyaPay = 4000;
        let gain = potBonus;
        for (let i = 0; i < 4; i++) {
          if (i === winnerIdx) continue;
          const pay = (i === dealerIdx ? oyaPay : eachPay) + renchan * 100;
          scores[i] -= pay;
          gain += pay;
        }
        scores[winnerIdx] += gain - renchan * 300;
      } else {
        const loserCandidates = [0, 1, 2, 3].filter((i) => i !== winnerIdx);
        const loserIdx = loserCandidates[demoStepCursor % loserCandidates.length];
        const basePts = [5200, 8000, 12000][demoStepCursor % 3];
        scores[loserIdx] -= basePts + renchan * 300;
        scores[winnerIdx] += basePts + potBonus;
      }

      for (let i = 0; i < 4; i++) riichiActive[i] = false;
      riichiSticks = 0;

      if (isOyaWin && renchan < 2) {
        renchan += 1;
      } else {
        renchan = 0;
        const rotated = [winds[3], winds[0], winds[1], winds[2]] as [string, string, string, string];
        winds.splice(0, 4, ...rotated);
        if (roundNum < 4) {
          roundNum += 1;
        } else if (wind === '東') {
          wind = '南';
          roundNum = 1;
        } else {
          wind = '東';
          roundNum = 1;
        }
      }
    }

    liveState.value = await upsertLiveTableState(
      {
        round: lg.round,
        table: lg.table,
        seatPlayerIds: [...lg.seatPlayerIds] as [number, number, number, number],
        scores,
        winds,
        riichiActive,
        chomboCounts: [...(lg.chomboCounts || [0, 0, 0, 0])] as [number, number, number, number],
        wind,
        roundNum,
        renchan,
        riichiSticks,
        isFinished: false,
        records: lg.records,
      },
      true
    );
  }
  lastSyncAt.value = Date.now();
};

const startDemoLoop = () => {
  if (demoInterval) clearInterval(demoInterval);
  demoInterval = setInterval(runSandboxDemoStep, DEMO_SPEED_MS[demoSpeed.value]);
};

const cycleDemoSpeed = () => {
  demoSpeed.value =
    demoSpeed.value === 'normal' ? 'fast' : demoSpeed.value === 'fast' ? 'turbo' : 'normal';
  if (isDemoRunning.value) startDemoLoop();
};

const toggleSandboxDemo = () => {
  if (!props.isSandbox) return;
  if (isDemoRunning.value) {
    isDemoRunning.value = false;
    if (demoInterval) {
      clearInterval(demoInterval);
      demoInterval = null;
    }
  } else {
    isDemoRunning.value = true;
    runSandboxDemoStep();
    startDemoLoop();
  }
};

const formatAgo = (ts: number | null) => {
  if (!ts) return '';
  const diffSec = Math.max(0, Math.floor((nowTick.value - ts) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  return `${Math.floor(diffSec / 60)}m`;
};

const lastSyncText = computed(() => {
  try {
    return new Date(lastSyncAt.value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
});
</script>

<template>
  <div class="live-monitor-page">
    <!-- Top Broadcast Header -->
    <header class="lm-header">
      <div class="lm-brand">
        <span class="lm-live-badge">
          <span class="lm-pulse"></span>
          LIVE MONITOR
        </span>
        <h1 class="lm-title">{{ tr('eventTitle') }}</h1>
        <span v-if="isSandbox" class="lm-sb-chip">TEST</span>
        <span class="lm-round-summary">
          {{ tr('roundLabel', { n: activeRound }) }} ·
          {{ tr('monitorLiveCount', { live: liveTableCount, done: finalTableCount }) }}
        </span>
        <div
          v-if="monitorTimerDisplay"
          class="lm-timer-pill"
          :class="[`sev-${monitorTimerDisplay.severity}`, { paused: monitorTimerDisplay.status === 'paused' }]"
        >
          <span class="lmt-clock">
            {{ monitorTimerDisplay.isExpired ? '⏰ 00:00' : (monitorTimerDisplay.status === 'paused' ? '⏸ ' : '⏱ ') + monitorTimerDisplay.formatted }}
          </span>
          <span class="lmt-meta">
            R{{ monitorTimerDisplay.round }} ·
            {{
              monitorTimerDisplay.isExpired
                ? (monitorTimerDisplay.extraHands === 1 ? tr('timerPlusOneLabel') : tr('timerLastHandLabel'))
                : monitorTimerDisplay.ruleTag
            }}
          </span>
        </div>
      </div>

      <div class="lm-controls">
        <div class="lm-round-select">
          <button :class="{ active: selectedRoundMode === 'auto' }" @click="selectRoundMode('auto')">
            AUTO
          </button>
          <button
            v-for="r in [1, 2, 3, 4, 5, 6]"
            :key="r"
            :class="{ active: selectedRoundMode === r }"
            @click="selectRoundMode(r)"
          >
            R{{ r }}
          </button>
        </div>

        <button
          type="button"
          class="lm-btn"
          :class="{ active: showProjectedPoints }"
          @click="showProjectedPoints = !showProjectedPoints"
        >
          {{ showProjectedPoints ? '⚡ Live Pt ON' : 'Confirmed Pt' }}
        </button>

        <button v-if="isSandbox" type="button" class="lm-btn accent" @click="handleSimulateLive">
          🧪 {{ tr('sandboxSimLive') }}
        </button>
        <button
          v-if="isSandbox"
          type="button"
          class="lm-btn"
          :class="{ 'demo-active': isDemoRunning }"
          @click="toggleSandboxDemo"
        >
          {{ isDemoRunning ? '⏹ Stop Demo' : '▶ Live Demo' }}
        </button>
        <button v-if="isSandbox" type="button" class="lm-btn" @click="cycleDemoSpeed">
          {{ demoSpeed === 'turbo' ? '🚀 6x Turbo' : demoSpeed === 'fast' ? '⚡ 3x Fast' : '▶ 1x' }}
        </button>
        <button v-if="isSandbox" type="button" class="lm-btn" @click="runSandboxDemoStep">
          +1 Step
        </button>
        <button v-if="isSandbox" type="button" class="lm-btn" @click="handleToggleSandboxTimer">
          ⏱ {{ monitorTimerDisplay ? tr('timerResetBtn') : '50+0' }}
        </button>

        <div class="lm-lang">
          <button
            v-for="loc in EVENT_LOCALES"
            :key="loc.code"
            :class="{ active: eventLocale === loc.code }"
            @click="emit('change-locale', loc.code)"
          >
            {{ loc.short }}
          </button>
        </div>

        <button type="button" class="lm-btn" @click="loadInitial(true)">↻ {{ lastSyncText }}</button>
        <button type="button" class="lm-btn" @click="toggleFullscreen">
          {{ isFullscreen ? '⤢ Exit' : '⛶ Fullscreen' }}
        </button>
        <button type="button" class="lm-btn" @click="goBackToDashboard">
          ← {{ tr('monitorBackDashboard') }}
        </button>
      </div>
    </header>

    <!-- 4-Team Live Standings Strip -->
    <TransitionGroup name="lm-team-move" tag="section" class="lm-team-strip">
      <div
        v-for="ts in liveTeamStandings"
        :key="ts.team.id"
        class="lm-team-box"
        :style="{ borderLeftColor: ts.team.color }"
      >
        <div class="lmt-left">
          <span class="lmt-rank" :class="`r-${ts.rank}`">#{{ ts.rank }}</span>
          <span class="lmt-name" :style="{ color: ts.team.color }">{{ ts.team.name }}</span>
        </div>
        <div class="lmt-right">
          <strong class="lmt-total" :class="ts.displayPt > 0 ? 'pos' : ts.displayPt < 0 ? 'neg' : ''">
            {{ formatSignedPoint(ts.displayPt) }} <small>pt</small>
          </strong>
          <span v-if="showProjectedPoints && ts.liveDelta !== 0" class="lmt-delta" :class="ts.liveDelta > 0 ? 'pos' : 'neg'">
            ({{ formatSignedPoint(ts.liveDelta) }} live)
          </span>
        </div>
      </div>
    </TransitionGroup>

    <!-- 7-Table Broadcast Grid (Fits 16:9 Projector in 1 View!) -->
    <main class="lm-grid">
      <article
        v-for="card in tableCards"
        :key="card.slot.key"
        class="lm-table-card"
        :class="[`st-${card.status}`, { 'is-jpc': card.slot.isJpC }]"
      >
        <div class="lmc-head">
          <div class="lmc-h-left">
            <span class="lmc-tnum">TABLE {{ card.slot.table }}</span>
            <span v-if="card.slot.isJpC" class="lmc-tag jpc">JP-C</span>
            <span v-else-if="card.slot.proPlayerId" class="lmc-tag pro">PRO</span>
          </div>
          <div class="lmc-h-right">
            <span v-if="card.riichiSticks > 0" class="lmc-riichi-sticks" title="Riichi Sticks">
              <span class="riichi-dot"></span>×{{ card.riichiSticks }}
            </span>
            <span class="lmc-round-pill" :class="`st-${card.status}`">
              {{ card.roundBadge }}
            </span>
            <span v-if="card.status === 'live' && card.updatedAt" class="lmc-ago">
              {{ formatAgo(card.updatedAt) }}
            </span>
          </div>
        </div>

        <TransitionGroup name="lm-row-move" tag="div" class="lmc-players">
          <div
            v-for="p in card.players"
            :key="p.playerId"
            class="lmc-row"
            :class="{
              'is-riichi': p.isRiichi,
              'is-riichi-fresh': isRiichiFresh(card.slot.key, p.playerId),
              'is-first': card.status !== 'waiting' && p.rank === 1,
              'row-gain': (getActiveDelta(card.slot.key, p.playerId) ?? 0) > 0,
              'row-loss': (getActiveDelta(card.slot.key, p.playerId) ?? 0) < 0,
            }"
          >
            <div class="lmc-team-bar" :style="{ backgroundColor: EVENT_TEAM_MAP[p.teamId].color }"></div>
            <span class="lmc-rank" :class="card.status !== 'waiting' ? `rk-${p.rank}` : 'rk-wait'">
              {{ card.status === 'waiting' ? '·' : p.rank }}
            </span>
            <span class="lmc-wind" :class="{ dealer: p.isDealer }">{{ p.wind }}</span>

            <div class="lmc-name-wrap">
              <span class="lmc-name">{{ p.name }}</span>
              <span v-if="p.isPro" class="lmc-pro-mini">PRO</span>
              <span v-if="p.isRiichi" class="lmc-riichi-badge">RIICHI</span>
              <span v-if="p.chomboPen < 0" class="lmc-chombo-badge">{{ p.chomboPen }}</span>
            </div>

            <div class="lmc-score-wrap">
              <span
                v-if="getActiveDelta(card.slot.key, p.playerId) !== null"
                class="lmc-delta-pop"
                :class="(getActiveDelta(card.slot.key, p.playerId) ?? 0) > 0 ? 'pos' : 'neg'"
              >
                {{ (getActiveDelta(card.slot.key, p.playerId) ?? 0) > 0 ? '+' : '' }}{{ getActiveDelta(card.slot.key, p.playerId)?.toLocaleString() }}
              </span>
              <span class="lmc-score">{{ getDisplayScore(card.slot.key, p.playerId, p.score).toLocaleString() }}</span>
              <span
                v-if="card.status !== 'waiting'"
                class="lmc-pt"
                :class="p.projectedPt > 0 ? 'pos' : p.projectedPt < 0 ? 'neg' : ''"
              >
                {{ formatSignedPoint(p.projectedPt) }}
              </span>
            </div>
          </div>
        </TransitionGroup>
      </article>
    </main>
  </div>
</template>

<style scoped>
.live-monitor-page {
  min-height: 100vh;
  background: #090d16;
  color: #f1f5f9;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans KR', 'Noto Sans JP', sans-serif;
  display: flex;
  flex-direction: column;
  padding: 12px 18px 16px;
  box-sizing: border-box;
  gap: 12px;
}

.lm-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.2);
}

.lm-brand {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.lm-timer-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 14px;
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.9);
  border: 1.5px solid rgba(16, 185, 129, 0.55);
  color: #ecfdf5;
  font-variant-numeric: tabular-nums;
}
.lm-timer-pill.sev-warn {
  background: rgba(180, 83, 9, 0.35);
  border-color: rgba(251, 191, 36, 0.7);
  color: #fde68a;
}
.lm-timer-pill.sev-critical,
.lm-timer-pill.sev-expired {
  background: rgba(220, 38, 38, 0.35);
  border-color: rgba(248, 113, 113, 0.85);
  color: #fee2e2;
  animation: lmPulse 1.1s ease-in-out infinite;
}
.lm-timer-pill.paused {
  opacity: 0.75;
  animation: none;
}
.lmt-clock {
  font-size: 20px;
  font-weight: 900;
  letter-spacing: 0.5px;
}
.lmt-meta {
  font-size: 11px;
  font-weight: 800;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
}
.lm-live-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(239, 68, 68, 0.2);
  border: 1px solid rgba(239, 68, 68, 0.55);
  color: #f87171;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.04em;
}
.lm-pulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ef4444;
  animation: lmPulse 1.4s ease-in-out infinite;
}
@keyframes lmPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.35; transform: scale(0.8); }
}
.lm-title {
  margin: 0;
  font-size: 20px;
  font-weight: 900;
  letter-spacing: -0.01em;
}
.lm-sb-chip {
  padding: 2px 7px;
  border-radius: 5px;
  background: #d97706;
  color: #fff;
  font-size: 11px;
  font-weight: 900;
}
.lm-round-summary {
  font-size: 13px;
  color: #94a3b8;
  font-weight: 700;
}

.lm-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.lm-round-select,
.lm-lang {
  display: inline-flex;
  background: #111827;
  border: 1px solid #334155;
  border-radius: 8px;
  overflow: hidden;
}
.lm-round-select button,
.lm-lang button {
  padding: 5px 8px;
  font-size: 11.5px;
  font-weight: 800;
  border: none;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
}
.lm-round-select button.active,
.lm-lang button.active {
  background: #2563eb;
  color: #fff;
}
.lm-btn {
  padding: 5px 10px;
  border-radius: 8px;
  border: 1px solid #334155;
  background: #111827;
  color: #e2e8f0;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}
.lm-btn.active {
  border-color: rgba(16, 185, 129, 0.55);
  background: rgba(16, 185, 129, 0.16);
  color: #34d399;
}
.lm-btn.accent {
  background: #d97706;
  border-color: #d97706;
  color: #fff;
}

/* 4-Team Live Standings Strip */
.lm-team-strip {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.lm-team-box {
  background: #111827;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-left: 5px solid #3b82f6;
  border-radius: 10px;
  padding: 10px 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.lmt-left { display: flex; align-items: center; gap: 8px; }
.lmt-rank {
  font-size: 13px;
  font-weight: 900;
  padding: 2px 7px;
  border-radius: 6px;
  background: rgba(148, 163, 184, 0.15);
}
.lmt-rank.r-1 { background: rgba(245, 158, 11, 0.25); color: #fbbf24; }
.lmt-name { font-size: 17px; font-weight: 900; }
.lmt-right { text-align: right; display: flex; flex-direction: column; align-items: flex-end; }
.lmt-total { font-size: 22px; font-weight: 900; font-variant-numeric: tabular-nums; line-height: 1.05; }
.lmt-total small { font-size: 12px; color: #94a3b8; }
.lmt-delta { font-size: 11px; font-weight: 800; font-variant-numeric: tabular-nums; }

/* 7-Table Broadcast Grid */
.lm-grid {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  align-content: start;
}

.lm-table-card {
  background: #111827;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 12px;
  padding: 12px 13px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.lm-table-card.st-live {
  border-color: rgba(59, 130, 246, 0.6);
  box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.2), 0 8px 24px rgba(0, 0, 0, 0.35);
}
.lm-table-card.st-final {
  border-color: rgba(16, 185, 129, 0.5);
  background: linear-gradient(180deg, rgba(16, 185, 129, 0.08), #111827 45%);
}
.lm-table-card.is-jpc {
  border-top: 3px solid #a855f7;
}

.lmc-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  padding-bottom: 7px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.16);
}
.lmc-h-left { display: flex; align-items: center; gap: 6px; }
.lmc-tnum { font-size: 16px; font-weight: 900; letter-spacing: 0.02em; }
.lmc-tag {
  font-size: 10px;
  font-weight: 900;
  padding: 2px 6px;
  border-radius: 4px;
}
.lmc-tag.pro { background: rgba(245, 158, 11, 0.2); color: #fbbf24; }
.lmc-tag.jpc { background: rgba(168, 85, 247, 0.22); color: #c084fc; }

.lmc-h-right { display: flex; align-items: center; gap: 6px; }
.lmc-riichi-sticks {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 12px;
  font-weight: 800;
  padding: 2px 6px;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.08);
}
.riichi-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #ef4444;
  display: inline-block;
}
.lmc-round-pill {
  font-size: 12.5px;
  font-weight: 900;
  padding: 3px 9px;
  border-radius: 999px;
  white-space: nowrap;
}
.lmc-round-pill.st-live {
  background: rgba(59, 130, 246, 0.22);
  color: #60a5fa;
  border: 1px solid rgba(59, 130, 246, 0.5);
}
.lmc-round-pill.st-final {
  background: rgba(16, 185, 129, 0.2);
  color: #34d399;
}
.lmc-round-pill.st-waiting {
  background: rgba(148, 163, 184, 0.14);
  color: #94a3b8;
}
.lmc-ago {
  font-size: 10.5px;
  color: #64748b;
  font-variant-numeric: tabular-nums;
}

.lmc-players {
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: relative;
}
.lm-row-move-move {
  transition: transform 0.65s cubic-bezier(0.22, 1, 0.36, 1);
}
.lm-team-move-move {
  transition: transform 0.65s cubic-bezier(0.22, 1, 0.36, 1);
}
.lm-btn.demo-active {
  background: rgba(239, 68, 68, 0.25);
  border-color: rgba(248, 113, 113, 0.75);
  color: #fecaca;
}
.lmc-row {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 8px;
  border-radius: 8px;
  background: rgba(30, 41, 59, 0.55);
  transition: background-color 0.45s ease, box-shadow 0.45s ease;
}
.lmc-row.is-first {
  background: rgba(245, 158, 11, 0.1);
}
.lmc-row.row-gain {
  background: rgba(16, 185, 129, 0.22) !important;
  box-shadow: inset 0 0 0 1.5px rgba(52, 211, 153, 0.75);
}
.lmc-row.row-loss {
  background: rgba(239, 68, 68, 0.18) !important;
  box-shadow: inset 0 0 0 1.5px rgba(248, 113, 113, 0.6);
}
.lmc-row.is-riichi {
  box-shadow: inset 0 0 0 1.5px rgba(239, 68, 68, 0.75);
  background: rgba(239, 68, 68, 0.1);
}
.lmc-row.is-riichi-fresh {
  animation: lmRiichiFlash 0.85s ease-in-out 3;
}
.lmc-delta-pop {
  font-size: 12px;
  font-weight: 900;
  padding: 1px 6px;
  border-radius: 6px;
  font-variant-numeric: tabular-nums;
  animation: lmDeltaPop 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}
.lmc-delta-pop.pos {
  background: rgba(16, 185, 129, 0.26);
  color: #4ade80;
}
.lmc-delta-pop.neg {
  background: rgba(239, 68, 68, 0.26);
  color: #f87171;
}
@keyframes lmDeltaPop {
  0% { opacity: 0; transform: translateY(6px) scale(0.85); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes lmRiichiFlash {
  0%, 100% { box-shadow: inset 0 0 0 1.5px rgba(239, 68, 68, 0.75), 0 0 0 rgba(239, 68, 68, 0); }
  50% { box-shadow: inset 0 0 0 2px rgba(251, 191, 36, 0.95), 0 0 16px rgba(239, 68, 68, 0.65); }
}
.lmc-team-bar {
  width: 4px;
  height: 24px;
  border-radius: 3px;
  flex-shrink: 0;
}
.lmc-rank {
  width: 20px;
  text-align: center;
  font-size: 14px;
  font-weight: 900;
  flex-shrink: 0;
}
.rk-1 { color: #fbbf24; }
.rk-2 { color: #60a5fa; }
.rk-3 { color: #cbd5e1; }
.rk-4 { color: #f87171; }
.rk-wait { color: #475569; }

.lmc-wind {
  font-size: 12px;
  font-weight: 900;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(148, 163, 184, 0.15);
  color: #cbd5e1;
  flex-shrink: 0;
}
.lmc-wind.dealer {
  background: #dc2626;
  color: #fff;
}

.lmc-name-wrap {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 5px;
}
.lmc-name {
  font-size: 14px;
  font-weight: 800;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lmc-pro-mini {
  font-size: 9px;
  font-weight: 900;
  padding: 1px 4px;
  border-radius: 3px;
  background: rgba(245, 158, 11, 0.2);
  color: #fbbf24;
  flex-shrink: 0;
}
.lmc-riichi-badge {
  font-size: 9.5px;
  font-weight: 900;
  padding: 1px 5px;
  border-radius: 4px;
  background: #ef4444;
  color: #fff;
  letter-spacing: 0.03em;
  flex-shrink: 0;
}
.lmc-chombo-badge {
  font-size: 9.5px;
  font-weight: 900;
  padding: 1px 4px;
  border-radius: 4px;
  background: rgba(239, 68, 68, 0.25);
  color: #fca5a5;
  flex-shrink: 0;
}

.lmc-score-wrap {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
.lmc-score {
  font-size: 18px;
  font-weight: 900;
  line-height: 1.05;
}
.lmc-pt {
  font-size: 11.5px;
  font-weight: 800;
}

.pos { color: #4ade80; }
.neg { color: #f87171; }

@media (max-width: 1320px) {
  .lm-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 980px) {
  .lm-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .lm-team-strip { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 640px) {
  .lm-grid { grid-template-columns: 1fr; }
  .lm-team-strip { grid-template-columns: 1fr; }
}
</style>
