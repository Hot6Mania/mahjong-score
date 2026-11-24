<script setup lang="ts">
import { ref, computed } from 'vue';
import {
  EVENT_MATCH_MAP,
  EVENT_PLAYER_MAP,
  EVENT_TEAM_MAP,
} from '@/data/knuNpm2026';
import {
  formatDualMetric,
  formatSignedPoint,
  type PlayerStanding,
} from '@/utils/knuNpmScoring';

interface Props {
  standing: PlayerStanding;
  tr: (key: string, params?: Record<string, string | number>) => string;
}
const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'open-match-log', matchKey: string): void;
}>();

type ModalTab = 'basic' | 'riichi' | 'other' | 'rank' | 'matches';
const activeTab = ref<ModalTab>('basic');

const team = computed(() => EVENT_TEAM_MAP[props.standing.player.teamId]);
const d = computed(() => props.standing.detailed);
const hasTrackedDiff = computed(
  () => props.standing.gamesPlayed > 0 && props.standing.trackedGames !== props.standing.gamesPlayed
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
</script>

<template>
  <div class="ev-modal-backdrop" @click.self="emit('close')">
    <div class="ev-modal-card player-modal-card">
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

      <!-- Summary KPI Strip (김케하 괄호 표기 채용) -->
      <div class="kpi-strip">
        <div class="kpi-box">
          <span class="kpi-label">{{ tr('statGames') }}</span>
          <strong class="kpi-val">
            {{ formatDualMetric(standing.gamesPlayed, d.trackedGames, hasTrackedDiff, 0, false) }}
          </strong>
        </div>
        <div class="kpi-box">
          <span class="kpi-label">{{ tr('statTotalPt') }}</span>
          <strong
            class="kpi-val"
            :class="standing.totalPoints > 0 ? 'pos' : standing.totalPoints < 0 ? 'neg' : ''"
          >
            {{ formatDualMetric(standing.totalPoints, d.trackedTotalPoints, hasTrackedDiff, 1, true) }} pt
          </strong>
        </div>
        <div class="kpi-box">
          <span class="kpi-label">{{ tr('statAvgRank') }}</span>
          <strong class="kpi-val">
            {{
              standing.gamesPlayed > 0
                ? formatDualMetric(standing.avgRank, d.trackedAvgRank, hasTrackedDiff && d.trackedGames > 0, 3, false)
                : '-'
            }}
          </strong>
        </div>
        <div class="kpi-box">
          <span class="kpi-label">{{ tr('statTrackedRounds') }}</span>
          <strong class="kpi-val">{{ d.trackedRounds }}</strong>
        </div>
      </div>

      <div class="modal-tabs">
        <button :class="{ active: activeTab === 'basic' }" @click="activeTab = 'basic'">
          {{ tr('modalTabBasic') }}
        </button>
        <button :class="{ active: activeTab === 'riichi' }" @click="activeTab = 'riichi'">
          {{ tr('modalTabRiichi') }}
        </button>
        <button :class="{ active: activeTab === 'other' }" @click="activeTab = 'other'">
          {{ tr('modalTabOther') }}
        </button>
        <button :class="{ active: activeTab === 'rank' }" @click="activeTab = 'rank'">
          {{ tr('modalTabRank') }}
        </button>
        <button :class="{ active: activeTab === 'matches' }" @click="activeTab = 'matches'">
          {{ tr('modalTabMatches') }}
        </button>
      </div>

      <div class="modal-body">
        <!-- Basic Tab -->
        <div v-if="activeTab === 'basic'">
          <div v-if="d.trackedRounds === 0" class="empty-tracked">{{ tr('noTrackedDataYet') }}</div>
          <div class="stat-grid">
            <div class="stat-cell">
              <span class="st-label">{{ tr('statWinRate') }}</span>
              <strong class="st-val">{{ fmtPct(d.winRate) }}</strong>
            </div>
            <div class="stat-cell">
              <span class="st-label">{{ tr('statDealInRate') }}</span>
              <strong class="st-val">{{ fmtPct(d.dealInRate) }}</strong>
            </div>
            <div class="stat-cell">
              <span class="st-label">{{ tr('statAvgWinScore') }}</span>
              <strong class="st-val">{{ fmtNum(d.avgWinScore) }}</strong>
            </div>
            <div class="stat-cell">
              <span class="st-label">{{ tr('statAvgDealInScore') }}</span>
              <strong class="st-val">{{ fmtNum(d.avgDealInScore) }}</strong>
            </div>
            <div class="stat-cell">
              <span class="st-label">{{ tr('statTsumoRate') }}</span>
              <strong class="st-val">{{ fmtPct(d.tsumoRate) }}</strong>
            </div>
            <div class="stat-cell">
              <span class="st-label">{{ tr('statDrawRate') }}</span>
              <strong class="st-val">{{ fmtPct(d.drawRate) }}</strong>
            </div>
            <div class="stat-cell">
              <span class="st-label">{{ tr('statDrawTenpaiRate') }}</span>
              <strong class="st-val">{{ fmtPct(d.drawTenpaiRate) }}</strong>
            </div>
            <div class="stat-cell">
              <span class="st-label">{{ tr('statRoundSuji') }}</span>
              <strong
                class="st-val"
                :class="(d.roundSuji ?? 0) > 0 ? 'pos' : (d.roundSuji ?? 0) < 0 ? 'neg' : ''"
              >
                {{ fmtNum(d.roundSuji, true) }}
              </strong>
            </div>
          </div>
        </div>

        <!-- Riichi Tab -->
        <div v-else-if="activeTab === 'riichi'">
          <div v-if="d.trackedRounds === 0" class="empty-tracked">{{ tr('noTrackedDataYet') }}</div>
          <div class="stat-grid">
            <div class="stat-cell">
              <span class="st-label">{{ tr('statRiichiRate') }}</span>
              <strong class="st-val">{{ fmtPct(d.riichiRate) }}</strong>
            </div>
            <div class="stat-cell">
              <span class="st-label">{{ tr('statRiichiWinRate') }}</span>
              <strong class="st-val">{{ fmtPct(d.riichiWinRate) }}</strong>
            </div>
            <div class="stat-cell">
              <span class="st-label">{{ tr('statRiichiDealInRate') }}</span>
              <strong class="st-val">{{ fmtPct(d.riichiDealInRate) }}</strong>
            </div>
            <div class="stat-cell">
              <span class="st-label">{{ tr('statRiichiDrawRate') }}</span>
              <strong class="st-val">{{ fmtPct(d.riichiDrawRate) }}</strong>
            </div>
            <div class="stat-cell">
              <span class="st-label">{{ tr('statFirstRiichiRate') }}</span>
              <strong class="st-val">{{ fmtPct(d.firstRiichiRate) }}</strong>
            </div>
            <div class="stat-cell">
              <span class="st-label">{{ tr('statChaseRiichiRate') }}</span>
              <strong class="st-val">{{ fmtPct(d.chaseRiichiRate) }}</strong>
            </div>
            <div class="stat-cell">
              <span class="st-label">{{ tr('statChasedRiichiRate') }}</span>
              <strong class="st-val">{{ fmtPct(d.chasedRiichiRate) }}</strong>
            </div>
            <div class="stat-cell">
              <span class="st-label">{{ tr('statRiichiSuji') }}</span>
              <strong
                class="st-val"
                :class="(d.riichiSuji ?? 0) > 0 ? 'pos' : (d.riichiSuji ?? 0) < 0 ? 'neg' : ''"
              >
                {{ fmtNum(d.riichiSuji, true) }}
              </strong>
            </div>
            <div class="stat-cell">
              <span class="st-label">{{ tr('statRiichiIncome') }}</span>
              <strong class="st-val">{{ fmtNum(d.riichiIncome) }}</strong>
            </div>
            <div class="stat-cell">
              <span class="st-label">{{ tr('statRiichiExpense') }}</span>
              <strong class="st-val">{{ fmtNum(d.riichiExpense) }}</strong>
            </div>
          </div>
        </div>

        <!-- Other Tab -->
        <div v-else-if="activeTab === 'other'">
          <div class="stat-grid">
            <div class="stat-cell">
              <span class="st-label">{{ tr('statOyaKaburiRate') }}</span>
              <strong class="st-val">{{ fmtPct(d.oyaKaburiRate) }}</strong>
            </div>
            <div class="stat-cell">
              <span class="st-label">{{ tr('statOyaKaburiAvg') }}</span>
              <strong class="st-val">{{ fmtNum(d.oyaKaburiAvg) }}</strong>
            </div>
            <div class="stat-cell">
              <span class="st-label">{{ tr('statDealInVsRiichiRate') }}</span>
              <strong class="st-val">{{ fmtPct(d.dealInVsRiichiRate) }}</strong>
            </div>
            <div class="stat-cell">
              <span class="st-label">{{ tr('bestScore') }}</span>
              <strong class="st-val">{{ fmtNum(standing.bestScore) }}</strong>
            </div>
            <div class="stat-cell">
              <span class="st-label">{{ tr('statCheatCount') }}</span>
              <strong class="st-val">{{ d.cheatCount }}</strong>
            </div>
            <div class="stat-cell">
              <span class="st-label">{{ tr('statBeolbuCount') }}</span>
              <strong class="st-val">{{ d.beolbuCount }}</strong>
            </div>
          </div>
        </div>

        <!-- Rank Distribution Tab -->
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
            <div class="stat-cell">
              <span class="st-label">{{ tr('topRate') }}</span>
              <strong class="st-val">{{ standing.gamesPlayed > 0 ? `${standing.topRate}%` : '-' }}</strong>
            </div>
            <div class="stat-cell">
              <span class="st-label">{{ tr('top2Rate') }}</span>
              <strong class="st-val">{{ standing.gamesPlayed > 0 ? `${standing.top2Rate}%` : '-' }}</strong>
            </div>
            <div class="stat-cell">
              <span class="st-label">{{ tr('lastAvoidRate') }}</span>
              <strong class="st-val">{{ standing.gamesPlayed > 0 ? `${standing.lastAvoidRate}%` : '-' }}</strong>
            </div>
            <div class="stat-cell">
              <span class="st-label">{{ tr('avgPt') }}</span>
              <strong class="st-val">
                {{ standing.gamesPlayed > 0 ? `${formatSignedPoint(standing.avgPoint)} pt` : '-' }}
              </strong>
            </div>
          </div>
        </div>

        <!-- 6R Matches Tab -->
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
.player-modal-card {
  width: 100%;
  max-width: 640px;
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
  padding: 16px 20px 12px;
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
  padding: 8px 16px;
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--text-dimmed);
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-color);
}

.kpi-strip {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  padding: 12px 16px;
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
  gap: 12px;
  font-size: 13px;
  font-weight: 700;
  padding-top: 4px;
  border-top: 1px dashed var(--border-color);
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
  padding: 12px 16px;
  border-top: 1px solid var(--border-color);
  display: flex;
  justify-content: flex-end;
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
