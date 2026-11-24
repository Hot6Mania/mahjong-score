<script setup lang="ts">
import { ref, computed } from 'vue';
import {
  EVENT_MATCH_MAP,
  EVENT_PLAYER_MAP,
  EVENT_TEAM_MAP,
} from '@/data/knuNpm2026';
import {
  calculateEventMetricDistribution,
  formatDualMetric,
  formatSignedPoint,
  type EventHistogramBar,
  type EventMetricDistribution,
  type PlayerStanding,
} from '@/utils/knuNpmScoring';

interface Props {
  standing: PlayerStanding;
  allPlayers: PlayerStanding[];
  tr: (key: string, params?: Record<string, string | number>) => string;
}
const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'open-match-log', matchKey: string): void;
  (e: 'select-player', playerId: number): void;
}>();

type ModalTab = 'basic' | 'riichi' | 'other' | 'rank' | 'matches';
const activeTab = ref<ModalTab>('basic');

const team = computed(() => EVENT_TEAM_MAP[props.standing.player.teamId]);
const d = computed(() => props.standing.detailed);
const hasTrackedDiff = computed(
  () => props.standing.gamesPlayed > 0 && props.standing.trackedGames !== props.standing.gamesPlayed
);

const isDark = computed(() =>
  typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : false
);

const fmtPct = (v: number | null) => (v !== null ? `${v.toFixed(2)}%` : '-');
const fmtNum = (v: number | null, signed = false) => {
  if (v === null) return '-';
  return `${signed && v > 0 ? '+' : ''}${v.toLocaleString()}`;
};

const rankPcts = computed(() => {
  const g = props.standing.gamesPlayed;
  if (g === 0) return [0, 0, 0, 0];
  return props.standing.rankCounts.map((c) => Number(((c / g) * 100).toFixed(1)));
});

const getOpponents = (matchKey: string): number[] => {
  const slot = EVENT_MATCH_MAP[matchKey];
  if (!slot) return [];
  return slot.playerIds.filter((id) => id !== props.standing.player.id);
};

// ============================
// Interactive Hover/Tap Histogram Popover
// ============================
const activeDist = ref<EventMetricDistribution | null>(null);
const isDistPinned = ref(false);
const hoveredBar = ref<EventHistogramBar | null>(null);
const popoverPos = ref<{ x: number; y: number; below: boolean }>({ x: 0, y: 0, below: false });
let closeHoverTimer: ReturnType<typeof setTimeout> | null = null;

const cancelCloseTimer = () => {
  if (closeHoverTimer) {
    clearTimeout(closeHoverTimer);
    closeHoverTimer = null;
  }
};

const positionPopover = (targetEl: HTMLElement | null) => {
  if (!targetEl || typeof window === 'undefined') return;
  const rect = targetEl.getBoundingClientRect();
  const popW = 264;
  const margin = 12;
  const centerX = rect.left + rect.width / 2;
  const clampedX = Math.max(popW / 2 + margin, Math.min(window.innerWidth - popW / 2 - margin, centerX));
  const showBelow = rect.top < 220;
  popoverPos.value = {
    x: clampedX,
    y: showBelow ? rect.bottom + 8 : rect.top - 8,
    below: showBelow,
  };
};

const openDist = (
  ev: MouseEvent,
  extractor: (p: PlayerStanding) => number | null | undefined,
  labelKey: string,
  unit: string,
  higherIsBetter: boolean,
  requireTracked: boolean,
  pin = false
) => {
  cancelCloseTimer();
  const el = ev.currentTarget as HTMLElement | null;
  positionPopover(el);
  hoveredBar.value = null;
  activeDist.value = calculateEventMetricDistribution(
    props.allPlayers,
    extractor,
    props.standing.player.id,
    props.tr(labelKey),
    unit,
    higherIsBetter,
    requireTracked
  );
  if (pin) {
    isDistPinned.value = true;
  }
};

const onHoverMetric = (
  ev: MouseEvent,
  extractor: (p: PlayerStanding) => number | null | undefined,
  labelKey: string,
  unit: string,
  higherIsBetter: boolean,
  requireTracked = true
) => {
  if (isDistPinned.value) return;
  openDist(ev, extractor, labelKey, unit, higherIsBetter, requireTracked, false);
};

const onClickMetric = (
  ev: MouseEvent,
  extractor: (p: PlayerStanding) => number | null | undefined,
  labelKey: string,
  unit: string,
  higherIsBetter: boolean,
  requireTracked = true
) => {
  openDist(ev, extractor, labelKey, unit, higherIsBetter, requireTracked, true);
};

const onLeaveMetric = () => {
  if (isDistPinned.value) return;
  cancelCloseTimer();
  closeHoverTimer = setTimeout(() => {
    if (!isDistPinned.value) {
      activeDist.value = null;
      hoveredBar.value = null;
    }
  }, 140);
};

const closePopover = () => {
  cancelCloseTimer();
  isDistPinned.value = false;
  activeDist.value = null;
  hoveredBar.value = null;
};

const formatDistVal = (val: number | null, unit: string): string => {
  if (val === null) return '-';
  if (unit === '%') return `${val.toFixed(2)}%`;
  if (unit === 'pt') return `${val > 0 ? '+' : ''}${val.toFixed(1)} pt`;
  if (unit === 'rank') return val.toFixed(3);
  if (unit === 'signed') return `${val > 0 ? '+' : ''}${Math.round(val).toLocaleString()}`;
  return Math.round(val).toLocaleString();
};

const onBarClick = (bar: EventHistogramBar) => {
  if (bar.playerId === props.standing.player.id) return;
  closePopover();
  emit('select-player', bar.playerId);
};
</script>

<template>
  <div class="ev-modal-backdrop" @click.self="emit('close')" @click="isDistPinned && closePopover()">
    <!-- Floating Staircase Histogram Popover -->
    <div
      v-if="activeDist"
      class="dist-popover"
      :class="{ below: popoverPos.below, pinned: isDistPinned }"
      :style="{ left: `${popoverPos.x}px`, top: `${popoverPos.y}px` }"
      @mouseenter="cancelCloseTimer"
      @mouseleave="onLeaveMetric"
      @click.stop
    >
      <div class="dp-head">
        <span class="dp-title">
          {{ tr('distTitle', { name: activeDist.metricName }) }}
          <span v-if="isDistPinned" class="dp-pin">{{ tr('distPinned') }}</span>
        </span>
        <div class="dp-head-r">
          <span v-if="activeDist.isUnrecorded" class="dp-chip muted">{{ tr('distUnrecorded') }}</span>
          <span v-else class="dp-chip" :class="activeDist.isUpperHalf ? 'pos' : 'neg'">
            {{ tr('distTopPct', { pct: activeDist.topPct.toFixed(1) }) }}
          </span>
          <button v-if="isDistPinned" type="button" class="dp-close" @click.stop="closePopover">✕</button>
        </div>
      </div>

      <div class="dp-meta">
        <span>
          {{ tr('distMyVal') }}:
          <strong>{{ formatDistVal(activeDist.currentValue, activeDist.unit) }}</strong>
        </span>
        <span v-if="!activeDist.isUnrecorded">
          #{{ activeDist.rank }} / {{ activeDist.totalCount }}
        </span>
        <span>{{ tr('distAvg') }}: {{ formatDistVal(activeDist.avg, activeDist.unit) }}</span>
      </div>

      <div class="dp-chart-box">
        <svg viewBox="0 0 160 44" class="dp-svg" preserveAspectRatio="none">
          <rect
            v-for="bar in activeDist.bars"
            :key="bar.playerId"
            :x="bar.x"
            :y="bar.y"
            :width="bar.width"
            :height="bar.height"
            rx="1"
            class="dp-bar"
            :fill="
              hoveredBar && hoveredBar.playerId === bar.playerId
                ? '#f59e0b'
                : bar.isCurrent
                  ? '#3b82f6'
                  : isDark
                    ? 'rgba(148, 163, 184, 0.45)'
                    : 'rgba(100, 116, 139, 0.35)'
            "
            @mouseenter="hoveredBar = bar"
            @mouseleave="hoveredBar = null"
            @click.stop="onBarClick(bar)"
          />
          <polygon
            v-for="bar in activeDist.bars"
            :key="`pin-${bar.playerId}`"
            v-show="bar.isCurrent"
            :points="`${bar.x + bar.width / 2},${Math.max(2, bar.y - 1)} ${bar.x + bar.width / 2 - 2.4},${Math.max(0, bar.y - 5)} ${bar.x + bar.width / 2 + 2.4},${Math.max(0, bar.y - 5)}`"
            fill="#3b82f6"
            pointer-events="none"
          />
          <line :x1="activeDist.line30X" y1="0" :x2="activeDist.line30X" y2="44" stroke="rgba(148,163,184,0.55)" stroke-width="1" stroke-dasharray="2,2" pointer-events="none" />
          <line x1="80" y1="0" x2="80" y2="44" :stroke="isDark ? 'rgba(255,255,255,0.65)' : 'rgba(15,23,42,0.5)'" stroke-width="1.6" stroke-dasharray="3,2" pointer-events="none" />
          <line :x1="activeDist.line70X" y1="0" :x2="activeDist.line70X" y2="44" stroke="rgba(148,163,184,0.55)" stroke-width="1" stroke-dasharray="2,2" pointer-events="none" />
        </svg>
      </div>

      <div class="dp-foot" @click.stop="hoveredBar && onBarClick(hoveredBar)">
        <template v-if="hoveredBar">
          <span class="dp-h-name">{{ hoveredBar.playerName }} ({{ hoveredBar.teamId }})</span>
          <strong class="dp-h-val">{{ formatDistVal(hoveredBar.value, activeDist.unit) }}</strong>
          <span class="dp-h-go">{{ tr('distTapAgain') }}</span>
        </template>
        <span v-else class="dp-hint">{{ tr('distHint') }}</span>
      </div>
    </div>

    <div class="ev-modal-card player-modal-card" @click.stop>
      <div class="ev-modal-header">
        <div class="player-head">
          <div class="head-badges">
            <span
              class="team-badge"
              :style="{
                color: team.color,
                backgroundColor: team.bgTint,
                borderColor: team.borderColor,
              }"
            >
              {{ team.name }}
            </span>
            <span class="pid-badge">#{{ standing.player.id }}</span>
            <span v-if="standing.player.isPro" class="pro-badge">{{ tr('proBadge') }}</span>
          </div>
          <h3 class="player-title">{{ standing.player.name }}</h3>
        </div>
        <button class="ev-icon-close" @click="emit('close')" aria-label="Close">✕</button>
      </div>

      <div class="dual-notice-bar">
        {{ tr('detailedNotice') }}
      </div>

      <!-- Summary KPI Strip -->
      <div class="kpi-strip">
        <div
          class="kpi-box hoverable"
          @mouseenter="onHoverMetric($event, (p) => p.gamesPlayed, 'statGames', 'num', true, false)"
          @mouseleave="onLeaveMetric"
          @click.stop="onClickMetric($event, (p) => p.gamesPlayed, 'statGames', 'num', true, false)"
        >
          <span class="kpi-label">{{ tr('statGames') }}</span>
          <strong class="kpi-val">
            {{ formatDualMetric(standing.gamesPlayed, d.trackedGames, hasTrackedDiff, 0, false) }}
          </strong>
        </div>
        <div
          class="kpi-box hoverable"
          @mouseenter="onHoverMetric($event, (p) => p.totalPoints, 'statTotalPt', 'pt', true, false)"
          @mouseleave="onLeaveMetric"
          @click.stop="onClickMetric($event, (p) => p.totalPoints, 'statTotalPt', 'pt', true, false)"
        >
          <span class="kpi-label">{{ tr('statTotalPt') }}</span>
          <strong
            class="kpi-val"
            :class="standing.totalPoints > 0 ? 'pos' : standing.totalPoints < 0 ? 'neg' : ''"
          >
            {{ formatDualMetric(standing.totalPoints, d.trackedTotalPoints, hasTrackedDiff, 1, true) }} pt
          </strong>
        </div>
        <div
          class="kpi-box hoverable"
          @mouseenter="onHoverMetric($event, (p) => p.gamesPlayed > 0 ? p.avgRank : null, 'statAvgRank', 'rank', false, false)"
          @mouseleave="onLeaveMetric"
          @click.stop="onClickMetric($event, (p) => p.gamesPlayed > 0 ? p.avgRank : null, 'statAvgRank', 'rank', false, false)"
        >
          <span class="kpi-label">{{ tr('statAvgRank') }}</span>
          <strong class="kpi-val">
            {{
              standing.gamesPlayed > 0
                ? formatDualMetric(standing.avgRank, d.trackedAvgRank, hasTrackedDiff && d.trackedGames > 0, 3, false)
                : '-'
            }}
          </strong>
        </div>
        <div
          class="kpi-box hoverable"
          @mouseenter="onHoverMetric($event, (p) => p.detailed.trackedRounds, 'statTrackedRounds', 'num', true, true)"
          @mouseleave="onLeaveMetric"
          @click.stop="onClickMetric($event, (p) => p.detailed.trackedRounds, 'statTrackedRounds', 'num', true, true)"
        >
          <span class="kpi-label">{{ tr('statTrackedRounds') }}</span>
          <strong class="kpi-val">{{ d.trackedRounds }}</strong>
        </div>
      </div>

      <div class="modal-tabs">
        <button :class="{ active: activeTab === 'basic' }" @click="activeTab = 'basic'; closePopover()">
          {{ tr('modalTabBasic') }}
        </button>
        <button :class="{ active: activeTab === 'riichi' }" @click="activeTab = 'riichi'; closePopover()">
          {{ tr('modalTabRiichi') }}
        </button>
        <button :class="{ active: activeTab === 'other' }" @click="activeTab = 'other'; closePopover()">
          {{ tr('modalTabOther') }}
        </button>
        <button :class="{ active: activeTab === 'rank' }" @click="activeTab = 'rank'; closePopover()">
          {{ tr('modalTabRank') }}
        </button>
        <button :class="{ active: activeTab === 'matches' }" @click="activeTab = 'matches'; closePopover()">
          {{ tr('modalTabMatches') }}
        </button>
      </div>

      <div class="modal-body" @scroll="isDistPinned && closePopover()">
        <!-- 1. Basic Tab (14 metrics matching KimK House) -->
        <div v-if="activeTab === 'basic'">
          <div v-if="d.trackedRounds === 0" class="empty-tracked">{{ tr('noTrackedDataYet') }}</div>
          <div class="stat-grid">
            <div
              class="stat-cell hoverable"
              @mouseenter="onHoverMetric($event, (p) => p.gamesPlayed > 0 ? p.avgPoint : null, 'statAvgPt', 'pt', true, false)"
              @mouseleave="onLeaveMetric"
              @click.stop="onClickMetric($event, (p) => p.gamesPlayed > 0 ? p.avgPoint : null, 'statAvgPt', 'pt', true, false)"
            >
              <span class="st-label">{{ tr('statAvgPt') }}</span>
              <strong class="st-val" :class="standing.avgPoint > 0 ? 'pos' : standing.avgPoint < 0 ? 'neg' : ''">
                {{
                  standing.gamesPlayed > 0
                    ? `${formatDualMetric(standing.avgPoint, d.trackedAvgPoint, hasTrackedDiff && d.trackedGames > 0, 1, true)} pt`
                    : '-'
                }}
              </strong>
            </div>

            <div
              class="stat-cell hoverable"
              @mouseenter="onHoverMetric($event, (p) => p.gamesPlayed > 0 ? p.top2Rate : null, 'statTop2Rate', '%', true, false)"
              @mouseleave="onLeaveMetric"
              @click.stop="onClickMetric($event, (p) => p.gamesPlayed > 0 ? p.top2Rate : null, 'statTop2Rate', '%', true, false)"
            >
              <span class="st-label">{{ tr('statTop2Rate') }}</span>
              <strong class="st-val">
                {{
                  standing.gamesPlayed > 0
                    ? `${formatDualMetric(standing.top2Rate, d.trackedTop2Rate, hasTrackedDiff && d.trackedGames > 0, 2, false)}%`
                    : '-'
                }}
              </strong>
            </div>

            <div
              class="stat-cell hoverable"
              @mouseenter="onHoverMetric($event, (p) => p.detailed.winRate, 'statWinRate', '%', true, true)"
              @mouseleave="onLeaveMetric"
              @click.stop="onClickMetric($event, (p) => p.detailed.winRate, 'statWinRate', '%', true, true)"
            >
              <span class="st-label">{{ tr('statWinRate') }}</span>
              <strong class="st-val">{{ fmtPct(d.winRate) }}</strong>
            </div>

            <div
              class="stat-cell hoverable"
              @mouseenter="onHoverMetric($event, (p) => p.detailed.dealInRate, 'statDealInRate', '%', false, true)"
              @mouseleave="onLeaveMetric"
              @click.stop="onClickMetric($event, (p) => p.detailed.dealInRate, 'statDealInRate', '%', false, true)"
            >
              <span class="st-label">{{ tr('statDealInRate') }}</span>
              <strong class="st-val neg">{{ fmtPct(d.dealInRate) }}</strong>
            </div>

            <div
              class="stat-cell hoverable"
              @mouseenter="onHoverMetric($event, (p) => p.detailed.tsumoRate, 'statTsumoRate', '%', true, true)"
              @mouseleave="onLeaveMetric"
              @click.stop="onClickMetric($event, (p) => p.detailed.tsumoRate, 'statTsumoRate', '%', true, true)"
            >
              <span class="st-label">{{ tr('statTsumoRate') }}</span>
              <strong class="st-val">{{ fmtPct(d.tsumoRate) }}</strong>
            </div>

            <div
              class="stat-cell hoverable"
              @mouseenter="onHoverMetric($event, (p) => p.detailed.riichiRate, 'statRiichiRate', '%', true, true)"
              @mouseleave="onLeaveMetric"
              @click.stop="onClickMetric($event, (p) => p.detailed.riichiRate, 'statRiichiRate', '%', true, true)"
            >
              <span class="st-label">{{ tr('statRiichiRate') }}</span>
              <strong class="st-val">{{ fmtPct(d.riichiRate) }}</strong>
            </div>

            <div
              class="stat-cell hoverable"
              @mouseenter="onHoverMetric($event, (p) => p.detailed.drawRate, 'statDrawRate', '%', false, true)"
              @mouseleave="onLeaveMetric"
              @click.stop="onClickMetric($event, (p) => p.detailed.drawRate, 'statDrawRate', '%', false, true)"
            >
              <span class="st-label">{{ tr('statDrawRate') }}</span>
              <strong class="st-val">{{ fmtPct(d.drawRate) }}</strong>
            </div>

            <div
              class="stat-cell hoverable"
              @mouseenter="onHoverMetric($event, (p) => p.detailed.drawTenpaiRate, 'statDrawTenpaiRate', '%', true, true)"
              @mouseleave="onLeaveMetric"
              @click.stop="onClickMetric($event, (p) => p.detailed.drawTenpaiRate, 'statDrawTenpaiRate', '%', true, true)"
            >
              <span class="st-label">{{ tr('statDrawTenpaiRate') }}</span>
              <strong class="st-val">{{ fmtPct(d.drawTenpaiRate) }}</strong>
            </div>

            <div
              class="stat-cell hoverable"
              @mouseenter="onHoverMetric($event, (p) => p.detailed.avgWinScore, 'statAvgWinScore', 'num', true, true)"
              @mouseleave="onLeaveMetric"
              @click.stop="onClickMetric($event, (p) => p.detailed.avgWinScore, 'statAvgWinScore', 'num', true, true)"
            >
              <span class="st-label">{{ tr('statAvgWinScore') }}</span>
              <strong class="st-val pos">{{ fmtNum(d.avgWinScore) }}</strong>
            </div>

            <div
              class="stat-cell hoverable"
              @mouseenter="onHoverMetric($event, (p) => p.detailed.avgDealInScore, 'statAvgDealInScore', 'num', false, true)"
              @mouseleave="onLeaveMetric"
              @click.stop="onClickMetric($event, (p) => p.detailed.avgDealInScore, 'statAvgDealInScore', 'num', false, true)"
            >
              <span class="st-label">{{ tr('statAvgDealInScore') }}</span>
              <strong class="st-val neg">{{ fmtNum(d.avgDealInScore) }}</strong>
            </div>

            <div
              class="stat-cell hoverable"
              @mouseenter="onHoverMetric($event, (p) => p.gamesPlayed > 0 ? p.tobiRate : null, 'statTobiRate', '%', false, false)"
              @mouseleave="onLeaveMetric"
              @click.stop="onClickMetric($event, (p) => p.gamesPlayed > 0 ? p.tobiRate : null, 'statTobiRate', '%', false, false)"
            >
              <span class="st-label">{{ tr('statTobiRate') }}</span>
              <strong class="st-val neg">{{ standing.gamesPlayed > 0 ? `${standing.tobiRate.toFixed(2)}%` : '-' }}</strong>
            </div>

            <div
              class="stat-cell hoverable"
              @mouseenter="onHoverMetric($event, (p) => p.bestScore, 'bestScore', 'num', true, false)"
              @mouseleave="onLeaveMetric"
              @click.stop="onClickMetric($event, (p) => p.bestScore, 'bestScore', 'num', true, false)"
            >
              <span class="st-label">{{ tr('bestScore') }}</span>
              <strong class="st-val">{{ fmtNum(standing.bestScore) }}</strong>
            </div>
          </div>
        </div>

        <!-- 2. Riichi Tab (11 metrics matching KimK House) -->
        <div v-else-if="activeTab === 'riichi'">
          <div v-if="d.trackedRounds === 0" class="empty-tracked">{{ tr('noTrackedDataYet') }}</div>
          <div class="stat-grid">
            <div
              class="stat-cell hoverable"
              @mouseenter="onHoverMetric($event, (p) => p.detailed.riichiRate, 'statRiichiRate', '%', true, true)"
              @mouseleave="onLeaveMetric"
              @click.stop="onClickMetric($event, (p) => p.detailed.riichiRate, 'statRiichiRate', '%', true, true)"
            >
              <span class="st-label">{{ tr('statRiichiRate') }}</span>
              <strong class="st-val">{{ fmtPct(d.riichiRate) }}</strong>
            </div>

            <div
              class="stat-cell hoverable"
              @mouseenter="onHoverMetric($event, (p) => p.detailed.riichiWinRate, 'statRiichiWinRate', '%', true, true)"
              @mouseleave="onLeaveMetric"
              @click.stop="onClickMetric($event, (p) => p.detailed.riichiWinRate, 'statRiichiWinRate', '%', true, true)"
            >
              <span class="st-label">{{ tr('statRiichiWinRate') }}</span>
              <strong class="st-val pos">{{ fmtPct(d.riichiWinRate) }}</strong>
            </div>

            <div
              class="stat-cell hoverable"
              @mouseenter="onHoverMetric($event, (p) => p.detailed.riichiDealInRate, 'statRiichiDealInRate', '%', false, true)"
              @mouseleave="onLeaveMetric"
              @click.stop="onClickMetric($event, (p) => p.detailed.riichiDealInRate, 'statRiichiDealInRate', '%', false, true)"
            >
              <span class="st-label">{{ tr('statRiichiDealInRate') }}</span>
              <strong class="st-val neg">{{ fmtPct(d.riichiDealInRate) }}</strong>
            </div>

            <div
              class="stat-cell hoverable"
              @mouseenter="onHoverMetric($event, (p) => p.detailed.riichiDrawRate, 'statRiichiDrawRate', '%', false, true)"
              @mouseleave="onLeaveMetric"
              @click.stop="onClickMetric($event, (p) => p.detailed.riichiDrawRate, 'statRiichiDrawRate', '%', false, true)"
            >
              <span class="st-label">{{ tr('statRiichiDrawRate') }}</span>
              <strong class="st-val">{{ fmtPct(d.riichiDrawRate) }}</strong>
            </div>

            <div
              class="stat-cell hoverable"
              @mouseenter="onHoverMetric($event, (p) => p.detailed.riichiSuji, 'statRiichiSuji', 'signed', true, true)"
              @mouseleave="onLeaveMetric"
              @click.stop="onClickMetric($event, (p) => p.detailed.riichiSuji, 'statRiichiSuji', 'signed', true, true)"
            >
              <span class="st-label">{{ tr('statRiichiSuji') }}</span>
              <strong class="st-val" :class="(d.riichiSuji ?? 0) > 0 ? 'pos' : (d.riichiSuji ?? 0) < 0 ? 'neg' : ''">
                {{ fmtNum(d.riichiSuji, true) }}
              </strong>
            </div>

            <div
              class="stat-cell hoverable"
              @mouseenter="onHoverMetric($event, (p) => p.detailed.riichiIncome, 'statRiichiIncome', 'num', true, true)"
              @mouseleave="onLeaveMetric"
              @click.stop="onClickMetric($event, (p) => p.detailed.riichiIncome, 'statRiichiIncome', 'num', true, true)"
            >
              <span class="st-label">{{ tr('statRiichiIncome') }}</span>
              <strong class="st-val pos">{{ fmtNum(d.riichiIncome) }}</strong>
            </div>

            <div
              class="stat-cell hoverable"
              @mouseenter="onHoverMetric($event, (p) => p.detailed.riichiExpense, 'statRiichiExpense', 'num', false, true)"
              @mouseleave="onLeaveMetric"
              @click.stop="onClickMetric($event, (p) => p.detailed.riichiExpense, 'statRiichiExpense', 'num', false, true)"
            >
              <span class="st-label">{{ tr('statRiichiExpense') }}</span>
              <strong class="st-val neg">{{ fmtNum(d.riichiExpense) }}</strong>
            </div>

            <div
              class="stat-cell hoverable"
              @mouseenter="onHoverMetric($event, (p) => p.detailed.firstRiichiRate, 'statFirstRiichiRate', '%', true, true)"
              @mouseleave="onLeaveMetric"
              @click.stop="onClickMetric($event, (p) => p.detailed.firstRiichiRate, 'statFirstRiichiRate', '%', true, true)"
            >
              <span class="st-label">{{ tr('statFirstRiichiRate') }}</span>
              <strong class="st-val pos">{{ fmtPct(d.firstRiichiRate) }}</strong>
            </div>

            <div
              class="stat-cell hoverable"
              @mouseenter="onHoverMetric($event, (p) => p.detailed.chaseRiichiRate, 'statChaseRiichiRate', '%', true, true)"
              @mouseleave="onLeaveMetric"
              @click.stop="onClickMetric($event, (p) => p.detailed.chaseRiichiRate, 'statChaseRiichiRate', '%', true, true)"
            >
              <span class="st-label">{{ tr('statChaseRiichiRate') }}</span>
              <strong class="st-val">{{ fmtPct(d.chaseRiichiRate) }}</strong>
            </div>

            <div
              class="stat-cell hoverable"
              @mouseenter="onHoverMetric($event, (p) => p.detailed.chaseRiichiWinRate, 'statChaseRiichiWinRate', '%', true, true)"
              @mouseleave="onLeaveMetric"
              @click.stop="onClickMetric($event, (p) => p.detailed.chaseRiichiWinRate, 'statChaseRiichiWinRate', '%', true, true)"
            >
              <span class="st-label">{{ tr('statChaseRiichiWinRate') }}</span>
              <strong class="st-val pos">{{ fmtPct(d.chaseRiichiWinRate) }}</strong>
            </div>

            <div
              class="stat-cell hoverable"
              @mouseenter="onHoverMetric($event, (p) => p.detailed.chasedRiichiRate, 'statChasedRiichiRate', '%', false, true)"
              @mouseleave="onLeaveMetric"
              @click.stop="onClickMetric($event, (p) => p.detailed.chasedRiichiRate, 'statChasedRiichiRate', '%', false, true)"
            >
              <span class="st-label">{{ tr('statChasedRiichiRate') }}</span>
              <strong class="st-val neg">{{ fmtPct(d.chasedRiichiRate) }}</strong>
            </div>
          </div>
        </div>

        <!-- 3. Other Tab (9 metrics — excluding 촌보율 / 벌부율) -->
        <div v-else-if="activeTab === 'other'">
          <div v-if="d.trackedRounds === 0" class="empty-tracked">{{ tr('noTrackedDataYet') }}</div>
          <div class="stat-grid">
            <div
              class="stat-cell hoverable"
              @mouseenter="onHoverMetric($event, (p) => p.detailed.oyaKaburiRate, 'statOyaKaburiRate', '%', false, true)"
              @mouseleave="onLeaveMetric"
              @click.stop="onClickMetric($event, (p) => p.detailed.oyaKaburiRate, 'statOyaKaburiRate', '%', false, true)"
            >
              <span class="st-label">{{ tr('statOyaKaburiRate') }}</span>
              <strong class="st-val neg">{{ fmtPct(d.oyaKaburiRate) }}</strong>
            </div>

            <div
              class="stat-cell hoverable"
              @mouseenter="onHoverMetric($event, (p) => p.detailed.oyaKaburiAvg, 'statOyaKaburiAvg', 'num', false, true)"
              @mouseleave="onLeaveMetric"
              @click.stop="onClickMetric($event, (p) => p.detailed.oyaKaburiAvg, 'statOyaKaburiAvg', 'num', false, true)"
            >
              <span class="st-label">{{ tr('statOyaKaburiAvg') }}</span>
              <strong class="st-val neg">{{ fmtNum(d.oyaKaburiAvg) }}</strong>
            </div>

            <div
              class="stat-cell hoverable"
              @mouseenter="onHoverMetric($event, (p) => p.detailed.dealInRiichiRate, 'statDealInRiichiRate', '%', false, true)"
              @mouseleave="onLeaveMetric"
              @click.stop="onClickMetric($event, (p) => p.detailed.dealInRiichiRate, 'statDealInRiichiRate', '%', false, true)"
            >
              <span class="st-label">{{ tr('statDealInRiichiRate') }}</span>
              <strong class="st-val">{{ fmtPct(d.dealInRiichiRate) }}</strong>
            </div>

            <div
              class="stat-cell hoverable"
              @mouseenter="onHoverMetric($event, (p) => p.detailed.yakitoriRate, 'statYakitoriRate', '%', false, true)"
              @mouseleave="onLeaveMetric"
              @click.stop="onClickMetric($event, (p) => p.detailed.yakitoriRate, 'statYakitoriRate', '%', false, true)"
            >
              <span class="st-label">{{ tr('statYakitoriRate') }}</span>
              <strong class="st-val neg">{{ fmtPct(d.yakitoriRate) }}</strong>
            </div>

            <div
              class="stat-cell hoverable"
              @mouseenter="onHoverMetric($event, (p) => p.detailed.winEfficiency, 'statWinEfficiency', 'signed', true, true)"
              @mouseleave="onLeaveMetric"
              @click.stop="onClickMetric($event, (p) => p.detailed.winEfficiency, 'statWinEfficiency', 'signed', true, true)"
            >
              <span class="st-label">{{ tr('statWinEfficiency') }}</span>
              <strong class="st-val pos">{{ d.winEfficiency !== null ? `+${d.winEfficiency.toLocaleString()}` : '-' }}</strong>
            </div>

            <div
              class="stat-cell hoverable"
              @mouseenter="onHoverMetric($event, (p) => p.detailed.dealInLoss, 'statDealInLoss', 'num', false, true)"
              @mouseleave="onLeaveMetric"
              @click.stop="onClickMetric($event, (p) => p.detailed.dealInLoss, 'statDealInLoss', 'num', false, true)"
            >
              <span class="st-label">{{ tr('statDealInLoss') }}</span>
              <strong class="st-val neg">{{ d.dealInLoss !== null ? `-${d.dealInLoss.toLocaleString()}` : '-' }}</strong>
            </div>

            <div
              class="stat-cell hoverable"
              @mouseenter="onHoverMetric($event, (p) => p.detailed.netWinEfficiency, 'statNetWinEfficiency', 'signed', true, true)"
              @mouseleave="onLeaveMetric"
              @click.stop="onClickMetric($event, (p) => p.detailed.netWinEfficiency, 'statNetWinEfficiency', 'signed', true, true)"
            >
              <span class="st-label">{{ tr('statNetWinEfficiency') }}</span>
              <strong
                class="st-val"
                :class="(d.netWinEfficiency ?? 0) > 0 ? 'pos' : (d.netWinEfficiency ?? 0) < 0 ? 'neg' : ''"
              >
                {{ fmtNum(d.netWinEfficiency, true) }}
              </strong>
            </div>

            <div
              class="stat-cell hoverable"
              @mouseenter="onHoverMetric($event, (p) => p.detailed.roundSuji, 'statRoundSuji', 'signed', true, true)"
              @mouseleave="onLeaveMetric"
              @click.stop="onClickMetric($event, (p) => p.detailed.roundSuji, 'statRoundSuji', 'signed', true, true)"
            >
              <span class="st-label">{{ tr('statRoundSuji') }}</span>
              <strong
                class="st-val"
                :class="(d.roundSuji ?? 0) > 0 ? 'pos' : (d.roundSuji ?? 0) < 0 ? 'neg' : ''"
              >
                {{ fmtNum(d.roundSuji, true) }}
              </strong>
            </div>

            <div
              class="stat-cell hoverable"
              @mouseenter="onHoverMetric($event, (p) => p.detailed.trackedRounds, 'statTrackedRounds', 'num', true, true)"
              @mouseleave="onLeaveMetric"
              @click.stop="onClickMetric($event, (p) => p.detailed.trackedRounds, 'statTrackedRounds', 'num', true, true)"
            >
              <span class="st-label">{{ tr('statTrackedRounds') }}</span>
              <strong class="st-val">{{ d.trackedRounds }}</strong>
            </div>
          </div>
        </div>

        <!-- 4. Rank Distribution Tab -->
        <div v-else-if="activeTab === 'rank'" class="rank-dist-section">
          <div class="rank-bars">
            <div v-for="r in [1, 2, 3, 4]" :key="r" class="rank-bar-row">
              <span class="rb-label">#{{ r }}</span>
              <div class="rb-track">
                <div
                  class="rb-fill"
                  :class="`rf-${r}`"
                  :style="{ width: `${rankPcts[r - 1]}%` }"
                ></div>
              </div>
              <span class="rb-val">{{ standing.rankCounts[r - 1] }} ({{ rankPcts[r - 1] }}%)</span>
            </div>
          </div>
          <div class="stat-grid" style="margin-top: 14px">
            <div
              class="stat-cell hoverable"
              @mouseenter="onHoverMetric($event, (p) => p.gamesPlayed > 0 ? p.topRate : null, 'topRate', '%', true, false)"
              @mouseleave="onLeaveMetric"
              @click.stop="onClickMetric($event, (p) => p.gamesPlayed > 0 ? p.topRate : null, 'topRate', '%', true, false)"
            >
              <span class="st-label">{{ tr('topRate') }}</span>
              <strong class="st-val">{{ standing.gamesPlayed > 0 ? `${standing.topRate.toFixed(1)}%` : '-' }}</strong>
            </div>
            <div
              class="stat-cell hoverable"
              @mouseenter="onHoverMetric($event, (p) => p.gamesPlayed > 0 ? p.top2Rate : null, 'top2Rate', '%', true, false)"
              @mouseleave="onLeaveMetric"
              @click.stop="onClickMetric($event, (p) => p.gamesPlayed > 0 ? p.top2Rate : null, 'top2Rate', '%', true, false)"
            >
              <span class="st-label">{{ tr('top2Rate') }}</span>
              <strong class="st-val">{{ standing.gamesPlayed > 0 ? `${standing.top2Rate.toFixed(1)}%` : '-' }}</strong>
            </div>
            <div
              class="stat-cell hoverable"
              @mouseenter="onHoverMetric($event, (p) => p.gamesPlayed > 0 ? p.lastAvoidRate : null, 'lastAvoidRate', '%', true, false)"
              @mouseleave="onLeaveMetric"
              @click.stop="onClickMetric($event, (p) => p.gamesPlayed > 0 ? p.lastAvoidRate : null, 'lastAvoidRate', '%', true, false)"
            >
              <span class="st-label">{{ tr('lastAvoidRate') }}</span>
              <strong class="st-val">{{ standing.gamesPlayed > 0 ? `${standing.lastAvoidRate.toFixed(1)}%` : '-' }}</strong>
            </div>
            <div
              class="stat-cell hoverable"
              @mouseenter="onHoverMetric($event, (p) => p.gamesPlayed > 0 ? p.avgPoint : null, 'avgPt', 'pt', true, false)"
              @mouseleave="onLeaveMetric"
              @click.stop="onClickMetric($event, (p) => p.gamesPlayed > 0 ? p.avgPoint : null, 'avgPt', 'pt', true, false)"
            >
              <span class="st-label">{{ tr('avgPt') }}</span>
              <strong class="st-val">
                {{ standing.gamesPlayed > 0 ? `${formatSignedPoint(standing.avgPoint)} pt` : '-' }}
              </strong>
            </div>
          </div>
        </div>

        <!-- 5. 6R Matches Tab -->
        <div v-else class="matches-list">
          <div v-for="m in standing.rounds" :key="m.key" class="match-item">
            <div class="mi-top">
              <span class="mi-slot">{{ tr('roundShort', { n: m.round }) }} · {{ tr('tableLabel', { n: m.table }) }}</span>
              <div class="mi-badges">
                <span v-if="m.table === 4" class="jpc-mini">JP-C</span>
                <span v-if="m.played" class="src-mini" :class="m.source">
                  {{ m.source === 'scorer' ? tr('sourceScorer') : tr('sourceManual') }}
                </span>
                <span v-else class="pending-mini">{{ tr('statusPending') }}</span>
              </div>
            </div>
            <div class="mi-opponents">
              vs
              <span v-for="(oid, idx) in getOpponents(m.key)" :key="oid" class="opp-chip">
                {{ EVENT_PLAYER_MAP[oid].name }} ({{ EVENT_PLAYER_MAP[oid].teamId }})<span v-if="idx < 2">,</span>
              </span>
            </div>
            <div v-if="m.played" class="mi-result">
              <span>#{{ m.rank }}</span>
              <span>{{ m.rawScore?.toLocaleString() }}</span>
              <span v-if="m.penalty && m.penalty < 0" class="pen-mini">{{ m.penalty }}pt</span>
              <strong :class="(m.finalPoint ?? 0) > 0 ? 'pos' : (m.finalPoint ?? 0) < 0 ? 'neg' : ''">
                {{ formatSignedPoint(m.finalPoint ?? 0) }} pt
              </strong>
              <button
                v-if="m.hasRounds"
                type="button"
                class="btn-log-mini"
                @click="emit('open-match-log', m.key)"
              >
                📈 {{ tr('viewRoundLog') }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="ev-modal-footer">
        <span class="footer-hint">📊 {{ tr('distHint') }}</span>
        <button type="button" class="btn-close-footer" @click="emit('close')">
          {{ tr('close') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ev-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.68);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1200;
  padding: 12px;
}

/* Floating Staircase Histogram Popover */
.dist-popover {
  position: fixed;
  transform: translate(-50%, -100%);
  width: 264px;
  background: var(--modal-bg-color);
  color: var(--text-color);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.35);
  padding: 10px 12px;
  z-index: 1500;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans KR', 'Noto Sans JP', sans-serif;
}
.dist-popover.below {
  transform: translate(-50%, 0);
}
.dist-popover.pinned {
  border-color: #3b82f6;
}
.dp-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  margin-bottom: 5px;
}
.dp-title {
  font-size: 12px;
  font-weight: 800;
  display: flex;
  align-items: center;
  gap: 4px;
}
.dp-pin {
  font-size: 9.5px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(59, 130, 246, 0.16);
  color: #3b82f6;
}
.dp-head-r {
  display: flex;
  align-items: center;
  gap: 4px;
}
.dp-chip {
  font-size: 10.5px;
  font-weight: 800;
  padding: 1px 6px;
  border-radius: 999px;
}
.dp-chip.pos { background: rgba(22, 163, 74, 0.15); color: var(--color-positive); }
.dp-chip.neg { background: rgba(239, 68, 68, 0.15); color: var(--color-negative); }
.dp-chip.muted { background: var(--bg-card); color: var(--text-dimmed); }
.dp-close {
  border: none;
  background: transparent;
  color: var(--text-dimmed);
  font-size: 13px;
  cursor: pointer;
  padding: 0 3px;
}
.dp-meta {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-dimmed);
  margin-bottom: 6px;
  font-variant-numeric: tabular-nums;
}
.dp-meta strong { color: var(--text-color); }
.dp-chart-box {
  height: 52px;
  width: 100%;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 7px;
  padding: 3px 4px;
  box-sizing: border-box;
}
.dp-svg {
  width: 100%;
  height: 100%;
  display: block;
}
.dp-bar {
  cursor: pointer;
  transition: fill 0.12s ease;
}
.dp-foot {
  margin-top: 6px;
  font-size: 11px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  min-height: 16px;
  cursor: pointer;
}
.dp-h-name { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dp-h-val { font-variant-numeric: tabular-nums; }
.dp-h-go { color: #3b82f6; font-weight: 700; white-space: nowrap; }
.dp-hint { color: var(--text-dimmed); font-size: 10.5px; }

.player-modal-card {
  width: 100%;
  max-width: 680px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  background: var(--card-bg-color);
  color: var(--text-color);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  box-shadow: 0 22px 50px rgba(0, 0, 0, 0.35);
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans KR', 'Noto Sans JP', sans-serif;
}
.ev-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 15px 18px 11px;
  border-bottom: 1px solid var(--border-color);
}
.head-badges {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.team-badge {
  font-size: 11px;
  font-weight: 800;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid transparent;
}
.pid-badge {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--text-dimmed);
}
.pro-badge {
  font-size: 10px;
  font-weight: 800;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(245, 158, 11, 0.18);
  color: #d97706;
  border: 1px solid rgba(245, 158, 11, 0.45);
}
.player-title {
  margin: 0;
  font-size: 19px;
  font-weight: 800;
}
.ev-icon-close {
  border: none;
  background: transparent;
  color: var(--text-dimmed);
  font-size: 18px;
  cursor: pointer;
}

.dual-notice-bar {
  padding: 7px 16px;
  font-size: 11.5px;
  line-height: 1.4;
  color: var(--text-dimmed);
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-color);
}

.kpi-strip {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  padding: 11px 16px;
  border-bottom: 1px solid var(--border-color);
}
.kpi-box {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 9px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.kpi-label {
  font-size: 11px;
  color: var(--text-dimmed);
}
.kpi-val {
  font-size: 14px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.modal-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border-color);
  overflow-x: auto;
}
.modal-tabs button {
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-dimmed);
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}
.modal-tabs button.active {
  background: #2563eb;
  color: #fff;
}

.modal-body {
  padding: 14px 16px;
  overflow-y: auto;
  flex: 1;
}
.empty-tracked {
  margin-bottom: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 12px;
  background: rgba(148, 163, 184, 0.14);
  color: var(--text-dimmed);
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
.stat-cell {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border-radius: 9px;
  border: 1px solid var(--border-color);
  background: var(--bg-card);
}
.hoverable {
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}
.hoverable:hover {
  border-color: rgba(59, 130, 246, 0.55);
  background: var(--bg-hover-color);
}
.st-label {
  font-size: 12px;
  color: var(--text-dimmed);
}
.st-val {
  font-size: 13.5px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.pos { color: var(--color-positive); }
.neg { color: var(--color-negative); }

.rank-bars {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.rank-bar-row {
  display: grid;
  grid-template-columns: 32px 1fr 96px;
  align-items: center;
  gap: 10px;
  font-size: 12.5px;
}
.rb-label { font-weight: 800; }
.rb-track {
  height: 12px;
  border-radius: 999px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  overflow: hidden;
}
.rb-fill { height: 100%; border-radius: 999px; }
.rf-1 { background: #f59e0b; }
.rf-2 { background: #3b82f6; }
.rf-3 { background: #94a3b8; }
.rf-4 { background: #ef4444; }
.rb-val { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }

.matches-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.match-item {
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 10px 12px;
  background: var(--bg-card);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mi-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.mi-slot { font-weight: 800; font-size: 13px; }
.mi-badges { display: flex; gap: 5px; }
.jpc-mini {
  font-size: 10px;
  font-weight: 800;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(168, 85, 247, 0.16);
  color: #a855f7;
}
.src-mini {
  font-size: 10.5px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
}
.src-mini.scorer {
  background: rgba(16, 185, 129, 0.16);
  color: #10b981;
}
.src-mini.manual {
  background: rgba(245, 158, 11, 0.16);
  color: #d97706;
}
.pending-mini {
  font-size: 10.5px;
  color: var(--text-dimmed);
}
.mi-opponents {
  font-size: 11.5px;
  color: var(--text-dimmed);
}
.opp-chip { margin-left: 4px; }
.mi-result {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  font-weight: 700;
  padding-top: 4px;
  border-top: 1px dashed var(--border-color);
}
.pen-mini {
  font-size: 11px;
  font-weight: 800;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}
.btn-log-mini {
  margin-left: auto;
  padding: 4px 8px;
  font-size: 11.5px;
  font-weight: 700;
  border-radius: 6px;
  border: 1px solid rgba(59, 130, 246, 0.4);
  background: rgba(59, 130, 246, 0.12);
  color: #3b82f6;
  cursor: pointer;
}

.ev-modal-footer {
  padding: 10px 16px;
  border-top: 1px solid var(--border-color);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}
.footer-hint {
  font-size: 11px;
  color: var(--text-dimmed);
}
.btn-close-footer {
  padding: 7px 16px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  color: var(--text-color);
  font-weight: 700;
  cursor: pointer;
}

@media (max-width: 560px) {
  .kpi-strip {
    grid-template-columns: repeat(2, 1fr);
  }
  .stat-grid {
    grid-template-columns: 1fr;
  }
}
</style>
