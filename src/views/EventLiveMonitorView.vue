<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRouter } from 'vue-router';
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
  seedSandboxLiveGames,
  subscribeEventStateUpdates,
  subscribeLiveStateUpdates,
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

const selectedRoundMode = ref<'auto' | number>('auto');
const showProjectedPoints = ref(true);
const isFullscreen = ref(false);
const lastSyncAt = ref(Date.now());
const nowTick = ref(Date.now());

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

  liveTimer = setInterval(pollLive, 8000);
  stateTimer = setInterval(pollState, 20000);
  clockTimer = setInterval(() => {
    nowTick.value = Date.now();
  }, 5000);

  if (typeof document !== 'undefined') {
    document.addEventListener('fullscreenchange', onFullscreenChange);
  }
});

onUnmounted(() => {
  if (liveTimer) clearInterval(liveTimer);
  if (stateTimer) clearInterval(stateTimer);
  if (clockTimer) clearInterval(clockTimer);
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
      </div>

      <div class="lm-controls">
        <div class="lm-round-select">
          <button :class="{ active: selectedRoundMode === 'auto' }" @click="selectedRoundMode = 'auto'">
            AUTO
          </button>
          <button
            v-for="r in [1, 2, 3, 4, 5, 6]"
            :key="r"
            :class="{ active: selectedRoundMode === r }"
            @click="selectedRoundMode = r"
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
    <section class="lm-team-strip">
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
    </section>

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

        <div class="lmc-players">
          <div
            v-for="p in card.players"
            :key="p.playerId"
            class="lmc-row"
            :class="{ 'is-riichi': p.isRiichi, 'is-first': card.status !== 'waiting' && p.rank === 1 }"
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
              <span class="lmc-score">{{ p.score.toLocaleString() }}</span>
              <span
                v-if="card.status !== 'waiting'"
                class="lmc-pt"
                :class="p.projectedPt > 0 ? 'pos' : p.projectedPt < 0 ? 'neg' : ''"
              >
                {{ formatSignedPoint(p.projectedPt) }}
              </span>
            </div>
          </div>
        </div>
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
}
.lmc-row {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 8px;
  border-radius: 8px;
  background: rgba(30, 41, 59, 0.55);
}
.lmc-row.is-first {
  background: rgba(245, 158, 11, 0.1);
}
.lmc-row.is-riichi {
  box-shadow: inset 0 0 0 1.5px rgba(239, 68, 68, 0.75);
  background: rgba(239, 68, 68, 0.1);
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
