<script setup lang="ts">
import { computed } from 'vue';
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
  EVENT_PLAYER_MAP,
  EVENT_TEAM_MAP,
  formatEventPlayerName,
  type EventNameLocale,
  type EventScoringConfig,
} from '@/data/knuNpm2026';
import {
  parseGameRoundMovements,
  type StoredTableResult,
} from '@/utils/knuNpmScoring';

ChartJS.register(Title, Tooltip, Legend, LineElement, LinearScale, PointElement, CategoryScale);

interface Props {
  result: StoredTableResult;
  config: EventScoringConfig;
  isDark: boolean;
  eventLocale: EventNameLocale;
  tr: (key: string, params?: Record<string, string | number>) => string;
}
const props = defineProps<Props>();
const emit = defineEmits<{ (e: 'close'): void }>();

const seatPlayerIds = computed(() => {
  if (props.result.rounds?.seatPlayerIds?.length === 4) {
    return props.result.rounds.seatPlayerIds;
  }
  return props.result.entries.map((e) => e.playerId);
});

const movements = computed(() =>
  parseGameRoundMovements(props.result.rounds, props.config.startingScore)
);

const tLoc = (ko: string, en: string, ja: string) =>
  props.eventLocale === 'ja' ? ja : props.eventLocale === 'ko' ? ko : en;

const formatStatusLabel = (status: string): string => {
  if (status === 'ron') return tLoc('론', 'Ron', 'ロン');
  if (status === 'tsumo') return tLoc('쯔모', 'Tsumo', 'ツモ');
  if (status === 'normal_draw') return tLoc('유국', 'Draw', '流局');
  if (status === 'special_draw') return tLoc('도중유국', 'Abortive', '途中流局');
  if (status === 'nagashi') return tLoc('유국만관', 'Nagashi', '流し満貫');
  if (status === 'cheat') return tLoc('촌보', 'Chombo', 'チョンボ');
  if (status === 'beolbu') return tLoc('벌부', 'Penalty', '罰符');
  return status;
};

const chartData = computed(() => {
  const labels = ['Start', ...movements.value.map((row) => row.label)];
  const datasets = seatPlayerIds.value.map((pid, idx) => {
    const pl = EVENT_PLAYER_MAP[pid];
    const teamColor = pl ? EVENT_TEAM_MAP[pl.teamId].color : '#64748b';
    return {
      label: pl ? `${formatEventPlayerName(pl, props.eventLocale, 'primary')} (${pl.teamId})` : `#${pid}`,
      data: [props.config.startingScore, ...movements.value.map((row) => row.players[idx]?.scoreAfter ?? props.config.startingScore)],
      borderColor: teamColor,
      backgroundColor: teamColor,
      borderWidth: 2.3,
      pointRadius: 3,
      tension: 0.12,
    };
  });
  return { labels, datasets };
});

const chartOptions = computed<ChartOptions<'line'>>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'bottom',
      labels: { color: props.isDark ? '#e2e8f0' : '#1e293b', boxWidth: 12, font: { size: 11 } },
    },
  },
  scales: {
    x: {
      ticks: { color: props.isDark ? '#94a3b8' : '#64748b', font: { size: 10 } },
      grid: { color: props.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' },
    },
    y: {
      ticks: { color: props.isDark ? '#94a3b8' : '#64748b', font: { size: 10 } },
      grid: { color: props.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' },
    },
  },
}));
</script>

<template>
  <div class="ev-modal-backdrop" @click.self="emit('close')">
    <div class="ev-modal-card log-modal-card">
      <div class="ev-modal-header">
        <h3 class="ev-modal-title">
          {{ tr('matchDetailTitle', { r: result.round, t: result.table }) }}
        </h3>
        <button class="ev-icon-close" @click="emit('close')">✕</button>
      </div>

      <div class="log-body">
        <div class="chart-box">
          <LineChart :data="chartData" :options="chartOptions" />
        </div>

        <div class="urm-list">
          <div
            v-for="mv in movements"
            :key="mv.stepIndex"
            class="urm-card"
            :class="{ 'has-bigwin': mv.maxWinTier !== 'normal' }"
          >
            <div class="urm-header">
              <div class="urm-title-group">
                <span class="urm-title">{{ mv.label }}</span>
                <span v-if="mv.maxWinTier !== 'normal'" class="urm-bigwin-badge">
                  🔥 +{{ mv.maxWinGain.toLocaleString() }}
                </span>
              </div>
              <span class="urm-status-badge">{{ formatStatusLabel(mv.status) }}</span>
            </div>
            <div class="urm-players">
              <div
                v-for="pm in mv.players"
                :key="`${mv.stepIndex}-${pm.playerId}`"
                class="urm-row"
                :class="{ 'is-win': pm.isWin, 'is-lose': pm.isLose }"
              >
                <div class="urm-left">
                  <span class="urm-seat" :class="{ 'is-east': pm.handWind === '東' }">{{ pm.handWind }}</span>
                  <span
                    class="th-dot"
                    :style="{ backgroundColor: EVENT_TEAM_MAP[EVENT_PLAYER_MAP[pm.playerId]?.teamId || 'A'].color }"
                  ></span>
                  <span class="urm-name">{{ formatEventPlayerName(EVENT_PLAYER_MAP[pm.playerId] ?? pm.playerId, eventLocale, 'compact') }}</span>
                  <span v-if="pm.isRiichi" class="urm-tag riichi">{{ tLoc('리치', 'Riichi', '立直') }}</span>
                  <span v-if="pm.isWin" class="urm-tag win">
                    {{ mv.status === 'tsumo' || mv.loserIds.length === 0 ? tLoc('쯔모', 'Tsumo', 'ツモ') : tLoc('론', 'Ron', 'ロン') }}
                  </span>
                  <span v-if="pm.isLose" class="urm-tag lose">{{ tLoc('방총', 'Deal-in', '放銃') }}</span>
                  <span v-if="!pm.isWin && pm.isTenpai" class="urm-tag tenpai">{{ tLoc('텐파이', 'Tenpai', '聴牌') }}</span>
                  <span v-if="pm.isCheat" class="urm-tag lose">{{ tLoc('촌보', 'Chombo', 'チョンボ') }}</span>
                </div>
                <div class="urm-right">
                  <span class="total-line">{{ pm.scoreBefore.toLocaleString() }} → {{ pm.scoreAfter.toLocaleString() }}</span>
                  <span class="delta-line" :class="pm.delta > 0 ? 'pos' : pm.delta < 0 ? 'neg' : 'zero'">
                    ({{ pm.delta > 0 ? '+' : '' }}{{ pm.delta.toLocaleString() }})
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="ev-modal-footer">
        <button type="button" class="btn-close-footer" @click="emit('close')">{{ tr('close') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ev-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.72);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1250;
  padding: 12px;
}
.log-modal-card {
  width: 100%;
  max-width: 720px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  background: var(--card-bg-color);
  color: var(--text-color);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans KR', 'Noto Sans JP', sans-serif;
}
.ev-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-color);
}
.ev-modal-title { margin: 0; font-size: 16px; font-weight: 800; }
.ev-icon-close { border: none; background: transparent; color: var(--text-dimmed); font-size: 18px; cursor: pointer; }
.log-body {
  padding: 14px 18px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.chart-box {
  height: 230px;
  width: 100%;
}
.table-wrap { overflow-x: auto; }
.log-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}
.log-table th, .log-table td {
  padding: 7px 6px;
  border-bottom: 1px solid var(--border-color);
  text-align: center;
}
.th-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-right: 4px;
}
.round-col { font-weight: 800; white-space: nowrap; }
.delta-line { font-weight: 700; font-variant-numeric: tabular-nums; }
.delta-line.pos { color: var(--color-positive); }
.delta-line.neg { color: var(--color-negative); }
.delta-line.zero { color: var(--text-dimmed); }
.total-line { font-size: 11.5px; color: var(--text-dimmed); font-variant-numeric: tabular-nums; }
.urm-list { display: flex; flex-direction: column; gap: 8px; }
.urm-card {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: rgba(125, 125, 125, 0.06);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.urm-card.has-bigwin {
  border-color: rgba(245, 158, 11, 0.55);
  background: rgba(245, 158, 11, 0.07);
}
.urm-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding-bottom: 5px;
  border-bottom: 1px solid var(--border-color);
}
.urm-title-group { display: flex; align-items: center; gap: 6px; }
.urm-title { font-size: 13px; font-weight: 800; }
.urm-bigwin-badge {
  font-size: 10.5px;
  font-weight: 900;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(245, 158, 11, 0.22);
  color: #d97706;
}
.urm-status-badge {
  font-size: 11px;
  font-weight: 800;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.16);
  color: #3b82f6;
}
.urm-players { display: flex; flex-direction: column; gap: 5px; }
.urm-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 5px 8px;
  border-radius: 7px;
  background: var(--card-bg-color);
  border: 1px solid transparent;
  font-size: 12.5px;
}
.urm-row.is-win { border-color: rgba(16, 185, 129, 0.48); background: rgba(16, 185, 129, 0.09); }
.urm-row.is-lose { border-color: rgba(239, 68, 68, 0.42); background: rgba(239, 68, 68, 0.08); }
.urm-left { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; }
.urm-right { display: flex; align-items: center; gap: 5px; }
.urm-seat {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 800;
  background: rgba(100, 116, 139, 0.16);
}
.urm-seat.is-east { background: rgba(239, 68, 68, 0.16); color: var(--color-east, #ef4444); }
.urm-name { font-weight: 800; }
.urm-tag { font-size: 10.5px; font-weight: 800; padding: 1px 5px; border-radius: 4px; }
.urm-tag.riichi { background: rgba(245, 158, 11, 0.2); color: #d97706; }
.urm-tag.win { background: rgba(16, 185, 129, 0.2); color: #10b981; }
.urm-tag.lose { background: rgba(239, 68, 68, 0.2); color: #ef4444; }
.urm-tag.tenpai { background: rgba(59, 130, 246, 0.18); color: #3b82f6; }
.ev-modal-footer {
  padding: 12px 18px;
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
</style>
