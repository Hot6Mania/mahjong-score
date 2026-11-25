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
import { type StoredTableResult } from '@/utils/knuNpmScoring';

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

const roundRows = computed(() => {
  const r = props.result.rounds;
  if (!r || !Array.isArray(r.time)) return [];
  const list: { label: string; deltas: number[]; totals: number[] }[] = [];
  const stepCount = Math.floor((r.time.length - 1) / 2);
  for (let s = 0; s < stepCount; s++) {
    const deltaIdx = s * 2 + 1;
    const snapIdx = s * 2 + 2;
    const label = String(r.time[deltaIdx] || '');
    const st = String(r.status?.[deltaIdx] || '');
    if (st === 'end' || label === '결과' || label === 'Result') continue;
    list.push({
      label: label || `#${s + 1}`,
      deltas: [0, 1, 2, 3].map((i) => Number(r.score?.[i]?.[deltaIdx] ?? 0)),
      totals: [0, 1, 2, 3].map((i) => Number(r.score?.[i]?.[snapIdx] ?? props.config.startingScore)),
    });
  }
  return list;
});

const chartData = computed(() => {
  const labels = ['Start', ...roundRows.value.map((row) => row.label)];
  const datasets = seatPlayerIds.value.map((pid, idx) => {
    const pl = EVENT_PLAYER_MAP[pid];
    const teamColor = pl ? EVENT_TEAM_MAP[pl.teamId].color : '#64748b';
    return {
      label: pl ? `${formatEventPlayerName(pl, props.eventLocale, 'primary')} (${pl.teamId})` : `#${pid}`,
      data: [props.config.startingScore, ...roundRows.value.map((row) => row.totals[idx])],
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

        <div class="table-wrap">
          <table class="log-table">
            <thead>
              <tr>
                <th>{{ tr('roundCol') }}</th>
                <th v-for="pid in seatPlayerIds" :key="pid">
                  <span
                    class="th-dot"
                    :style="{ backgroundColor: EVENT_TEAM_MAP[EVENT_PLAYER_MAP[pid].teamId].color }"
                  ></span>
                  {{ formatEventPlayerName(EVENT_PLAYER_MAP[pid], eventLocale, 'compact') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, idx) in roundRows" :key="idx">
                <td class="round-col">{{ row.label }}</td>
                <td v-for="i in [0, 1, 2, 3]" :key="i" class="num-col">
                  <div
                    class="delta-line"
                    :class="row.deltas[i] > 0 ? 'pos' : row.deltas[i] < 0 ? 'neg' : 'zero'"
                  >
                    {{ row.deltas[i] > 0 ? '+' : '' }}{{ row.deltas[i].toLocaleString() }}
                  </div>
                  <div class="total-line">{{ row.totals[i].toLocaleString() }}</div>
                </td>
              </tr>
            </tbody>
          </table>
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
.total-line { font-size: 11px; color: var(--text-dimmed); font-variant-numeric: tabular-nums; }
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
