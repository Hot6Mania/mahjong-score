<script setup lang="ts">
import { computed, ref, watch } from 'vue';
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
  EVENT_MATCH_SCHEDULE,
  EVENT_PLAYERS,
  EVENT_PLAYER_MAP,
  EVENT_TEAM_MAP,
  formatEventPlayerName,
  type EventNameLocale,
  type EventScoringConfig,
} from '@/data/knuNpm2026';
import {
  formatSignedPoint,
  parseGameRoundMovements,
  type EventMvpReport,
  type LeagueStandingsSummary,
  type LiveTableState,
  type ParsedRoundMovement,
  type StoredTableResult,
} from '@/utils/knuNpmScoring';

ChartJS.register(Title, Tooltip, Legend, LineElement, LinearScale, PointElement, CategoryScale);

interface Props {
  results: Record<string, StoredTableResult>;
  liveGames: Record<string, LiveTableState>;
  standings: LeagueStandingsSummary;
  mvpReport: EventMvpReport;
  config: EventScoringConfig;
  isDark: boolean;
  eventLocale: EventNameLocale;
  showNameParens: boolean;
  focusMatchKey?: string | null;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  (e: 'select-player', playerId: number): void;
  (e: 'clear-focus-match'): void;
}>();

const selectedRoundFilter = ref<'ALL' | number>('ALL');
const selectedPlayerFilter = ref<number | ''>('');
const includeLive = ref(true);
const selectedMatchKey = ref<string>('');
const detailViewMode = ref<'rounds' | 'chart' | 'sheet'>('rounds');
const selectedHandFilter = ref<string>('__all__');

interface GameListEntry {
  key: string;
  round: number;
  table: number;
  isLive: boolean;
  source: 'scorer' | 'manual' | 'live';
  result: StoredTableResult | null;
  live: LiveTableState | null;
  seatPlayerIds: number[];
  hasRounds: boolean;
  handCount: number;
  summary: EventMvpReport['matchSummaries'][string] | null;
  sortedFinal: {
    playerId: number;
    rank: number;
    score: number;
    point: number | null;
  }[];
}

const allAvailableGames = computed<GameListEntry[]>(() => {
  const list: GameListEntry[] = [];
  for (const slot of EVENT_MATCH_SCHEDULE) {
    const res = props.results[slot.key];
    const calc = props.standings.calculatedMatches[slot.key];
    const live = !res && includeLive.value ? props.liveGames[slot.key] : undefined;
    if (!res && !live) continue;

    if (res && calc) {
      const seatIds =
        res.rounds?.seatPlayerIds?.length === 4
          ? res.rounds.seatPlayerIds
          : res.entries.map((e) => e.playerId);
      const summary = props.mvpReport.matchSummaries[slot.key] || null;
      const sortedFinal = [...calc.entries]
        .sort((a, b) => a.rank - b.rank || b.finalScore - a.finalScore)
        .map((e) => ({
          playerId: e.playerId,
          rank: e.rank,
          score: e.finalScore,
          point: e.finalPoint,
        }));
      list.push({
        key: slot.key,
        round: slot.round,
        table: slot.table,
        isLive: false,
        source: res.source,
        result: res,
        live: null,
        seatPlayerIds: seatIds,
        hasRounds: Boolean(summary && summary.handCount > 0),
        handCount: summary?.handCount || 0,
        summary,
        sortedFinal,
      });
    } else if (live) {
      const mvs = parseGameRoundMovements(live.records, props.config.startingScore);
      const sortedFinal = live.seatPlayerIds
        .map((pid, idx) => ({
          playerId: pid,
          score: Number(live.scores[idx] ?? props.config.startingScore),
          seatIdx: idx,
        }))
        .sort((a, b) => b.score - a.score || a.seatIdx - b.seatIdx)
        .map((e, idx) => ({
          playerId: e.playerId,
          rank: idx + 1,
          score: e.score,
          point: null,
        }));
      list.push({
        key: slot.key,
        round: slot.round,
        table: slot.table,
        isLive: true,
        source: 'live',
        result: null,
        live,
        seatPlayerIds: [...live.seatPlayerIds],
        hasRounds: mvs.length > 0,
        handCount: mvs.length,
        summary: null,
        sortedFinal,
      });
    }
  }
  return list;
});

const filteredGames = computed(() =>
  allAvailableGames.value.filter((g) => {
    if (selectedRoundFilter.value !== 'ALL' && g.round !== selectedRoundFilter.value) return false;
    if (selectedPlayerFilter.value !== '' && !g.seatPlayerIds.includes(Number(selectedPlayerFilter.value))) {
      return false;
    }
    return true;
  })
);

watch(
  () => props.focusMatchKey,
  (mk) => {
    if (!mk) return;
    const found = allAvailableGames.value.find((g) => g.key === mk);
    if (found) {
      selectedRoundFilter.value = 'ALL';
      selectedPlayerFilter.value = '';
      selectedMatchKey.value = found.key;
      detailViewMode.value = 'rounds';
      selectedHandFilter.value = '__all__';
      emit('clear-focus-match');
    }
  },
  { immediate: true }
);

watch(
  filteredGames,
  (list) => {
    if (list.length === 0) {
      selectedMatchKey.value = '';
      return;
    }
    if (!list.some((g) => g.key === selectedMatchKey.value)) {
      const preferTracked = list.find((g) => g.hasRounds) || list[0];
      selectedMatchKey.value = preferTracked.key;
    }
  },
  { immediate: true }
);

watch(selectedMatchKey, () => {
  selectedHandFilter.value = '__all__';
});

const activeGame = computed<GameListEntry | null>(
  () => filteredGames.value.find((g) => g.key === selectedMatchKey.value) || null
);

const activeMovements = computed<ParsedRoundMovement[]>(() => {
  const g = activeGame.value;
  if (!g) return [];
  const rounds = g.result?.rounds || g.live?.records || null;
  return parseGameRoundMovements(rounds, props.config.startingScore);
});

const displayedMovements = computed<ParsedRoundMovement[]>(() => {
  if (selectedHandFilter.value === '__all__') return activeMovements.value;
  const idx = Number(selectedHandFilter.value);
  return activeMovements.value.filter((m) => m.stepIndex === idx);
});

const activePlayerSummaryRows = computed(() => {
  const g = activeGame.value;
  if (!g) return [];
  const seatIds = g.seatPlayerIds;
  const startWinds = ['東', '南', '西', '北'];
  const mvs = activeMovements.value;
  return seatIds.map((pid, sIdx) => {
    let riichi = 0;
    let ron = 0;
    let tsumo = 0;
    let lose = 0;
    for (const mv of mvs) {
      const pm = mv.players[sIdx];
      if (!pm) continue;
      if (pm.isRiichi) riichi++;
      if (pm.isWin) {
        if (mv.status === 'tsumo' || mv.loserIds.length === 0) tsumo++;
        else ron++;
      }
      if (pm.isLose) lose++;
    }
    const fin = g.sortedFinal.find((f) => f.playerId === pid);
    return {
      seatIdx: sIdx,
      startWind: startWinds[sIdx],
      playerId: pid,
      rank: fin?.rank ?? sIdx + 1,
      score: fin?.score ?? props.config.startingScore,
      point: fin?.point ?? null,
      riichi,
      ron,
      tsumo,
      lose,
    };
  });
});

const chartData = computed(() => {
  const g = activeGame.value;
  if (!g || activeMovements.value.length === 0) return { labels: [], datasets: [] };
  const labels = ['Start', ...activeMovements.value.map((m) => m.label)];
  const datasets = g.seatPlayerIds.map((pid, idx) => {
    const pl = EVENT_PLAYER_MAP[pid];
    const teamColor = pl ? EVENT_TEAM_MAP[pl.teamId].color : '#64748b';
    return {
      label: pl ? `${formatEventPlayerName(pl, props.eventLocale, 'primary')} (${pl.teamId})` : `#${pid}`,
      data: [props.config.startingScore, ...activeMovements.value.map((m) => m.players[idx]?.scoreAfter ?? props.config.startingScore)],
      borderColor: teamColor,
      backgroundColor: teamColor,
      borderWidth: 2.5,
      pointRadius: 3.5,
      tension: 0.14,
    };
  });
  return { labels, datasets };
});

const chartOptions = computed<ChartOptions<'line'>>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: {
      position: 'bottom',
      labels: { color: props.isDark ? '#e2e8f0' : '#1e293b', boxWidth: 12, font: { size: 12 } },
    },
  },
  scales: {
    x: {
      ticks: { color: props.isDark ? '#94a3b8' : '#64748b', font: { size: 11 } },
      grid: { color: props.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' },
    },
    y: {
      ticks: {
        color: props.isDark ? '#94a3b8' : '#64748b',
        font: { size: 11 },
        callback: (v) => `${Number(v).toLocaleString()}`,
      },
      grid: { color: props.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' },
    },
  },
}));

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

const formatHandOptionSummary = (mv: ParsedRoundMovement): string => {
  const st = formatStatusLabel(mv.status);
  if (mv.winnerIds.length > 0) {
    const names = mv.winnerIds
      .map((id) => formatEventPlayerName(EVENT_PLAYER_MAP[id] ?? id, props.eventLocale, 'compact'))
      .join(', ');
    return ` — ${st} (${names} +${mv.maxWinGain.toLocaleString()})`;
  }
  return ` — ${st}`;
};

const pName = (pid: number, style: 'full' | 'compact' = 'compact') =>
  formatEventPlayerName(EVENT_PLAYER_MAP[pid] ?? pid, props.eventLocale, style, props.showNameParens);
</script>

<template>
  <div class="gamelogs-root">
    <!-- Top Filter Bar -->
    <div class="card-panel gl-filter-panel">
      <div class="gl-filter-top">
        <div>
          <h3 class="gl-heading">📜 {{ tLoc('게임별 국별 점수 이동 기록', 'Game-by-Game Round Logs', '半荘別・局別点数移動ログ') }}</h3>
          <p class="gl-sub">
            {{
              tLoc(
                '각 대국의 모든 국에서 누가 리치·화료(론/쯔모)·방총·텐파이 했는지와 점수 흐름을 확인할 수 있습니다.',
                'Inspect every hand in each game: who declared Riichi, won (Ron/Tsumo), dealt in, and exact score swings.',
                '各半荘の全巡について、立直・和了（ロン/ツモ）・放銃・聴牌と点数推移を確認できます。'
              )
            }}
          </p>
        </div>

        <div class="gl-controls">
          <div class="gl-round-chips">
            <button
              type="button"
              class="gl-chip"
              :class="{ active: selectedRoundFilter === 'ALL' }"
              @click="selectedRoundFilter = 'ALL'"
            >
              {{ tLoc('전체', 'All', '全て') }}
            </button>
            <button
              v-for="r in [1, 2, 3, 4, 5, 6]"
              :key="r"
              type="button"
              class="gl-chip"
              :class="{ active: selectedRoundFilter === r }"
              @click="selectedRoundFilter = r"
            >
              R{{ r }}
            </button>
          </div>

          <select v-model="selectedPlayerFilter" class="gl-select">
            <option value="">{{ tLoc('전체 선수', 'All Players', '全選手') }}</option>
            <option v-for="pl in EVENT_PLAYERS" :key="pl.id" :value="pl.id">
              #{{ pl.id }} {{ formatEventPlayerName(pl, eventLocale, 'primary') }} ({{ pl.teamId }})
            </option>
          </select>

          <label class="gl-live-toggle">
            <input type="checkbox" v-model="includeLive" />
            <span>{{ tLoc('진행중(LIVE) 포함', 'Include LIVE', '進行中(LIVE)含む') }}</span>
          </label>
        </div>
      </div>
    </div>

    <div v-if="filteredGames.length === 0" class="card-panel gl-empty">
      {{ tLoc('표시할 대국 기록이 아직 없습니다.', 'No recorded games match this filter yet.', '該当する対局記録がまだありません。') }}
    </div>

    <div v-else class="gl-layout">
      <!-- Left: Game Selector List -->
      <aside class="gl-sidebar">
        <div class="gl-list-header">
          <span>{{ tLoc(`대국 목록 (${filteredGames.length}경기)`, `Games (${filteredGames.length})`, `対局一覧 (${filteredGames.length}半荘)`) }}</span>
        </div>
        <div class="gl-game-list">
          <button
            v-for="g in filteredGames"
            :key="g.key"
            type="button"
            class="gl-game-item"
            :class="{ active: selectedMatchKey === g.key, 'is-live': g.isLive }"
            @click="selectedMatchKey = g.key"
          >
            <div class="gl-gi-top">
              <span class="gl-gi-key">{{ g.key }}</span>
              <div class="gl-gi-badges">
                <span v-if="g.isLive" class="gl-badge live">LIVE</span>
                <span v-else-if="g.source === 'manual'" class="gl-badge manual">JP-C</span>
                <span v-else class="gl-badge hands">{{ g.handCount }}{{ tLoc('국', 'H', '局') }}</span>
                <span
                  v-if="g.summary && g.summary.maxTier !== 'normal'"
                  class="gl-badge bigwin"
                  :class="g.summary.maxTier"
                >
                  🔥 +{{ g.summary.maxWinGain.toLocaleString() }}
                </span>
                <span v-if="g.summary?.hasComeback" class="gl-badge comeback">
                  ⚡ {{ tLoc('역전', 'CB', '逆転') }}
                </span>
              </div>
            </div>
            <div class="gl-gi-players">
              <div v-for="fp in g.sortedFinal" :key="fp.playerId" class="gl-gi-prow">
                <span class="gl-gi-rank" :class="`r${fp.rank}`">{{ fp.rank }}</span>
                <span
                  class="gl-team-dot"
                  :style="{ backgroundColor: EVENT_TEAM_MAP[EVENT_PLAYER_MAP[fp.playerId]?.teamId || 'A'].color }"
                ></span>
                <span class="gl-gi-pname">{{ pName(fp.playerId, 'compact') }}</span>
                <span class="gl-gi-pscore">{{ fp.score.toLocaleString() }}</span>
              </div>
            </div>
          </button>
        </div>
      </aside>

      <!-- Right: Selected Game Detail (KimK House Style) -->
      <main v-if="activeGame" class="gl-detail card-panel">
        <div class="gl-detail-head">
          <div class="gl-detail-title-wrap">
            <h3 class="gl-detail-title">
              {{ activeGame.key }}
              <span v-if="activeGame.isLive" class="gl-badge live">LIVE</span>
              <span v-else-if="activeGame.source === 'manual'" class="gl-badge manual">{{ tLoc('결과만 기록 (JP-C)', 'Result Only (JP-C)', '結果のみ (JP-C)') }}</span>
              <span v-else class="gl-badge hands">{{ activeMovements.length }}{{ tLoc('국 기록', ' hands', '局記録') }}</span>
            </h3>
            <div class="gl-detail-sub-tags" v-if="activeGame.summary">
              <span v-if="activeGame.summary.maxTier !== 'normal'" class="gl-badge bigwin" :class="activeGame.summary.maxTier">
                🔥 +{{ activeGame.summary.maxWinGain.toLocaleString() }}
              </span>
              <span v-if="activeGame.summary.hasComeback" class="gl-badge comeback">
                ⚡ {{ tLoc('대역전 스윙', 'Comeback Swing', '大逆転') }} +{{ activeGame.summary.bestComebackSwing.toLocaleString() }}
              </span>
            </div>
          </div>

          <div class="gl-mode-tabs">
            <button
              type="button"
              class="gl-mode-btn"
              :class="{ active: detailViewMode === 'rounds' }"
              @click="detailViewMode = 'rounds'"
            >
              {{ tLoc('국별 점수 이동', 'Round Movements', '局別点数移動') }}
            </button>
            <button
              type="button"
              class="gl-mode-btn"
              :class="{ active: detailViewMode === 'chart' }"
              @click="detailViewMode = 'chart'"
            >
              {{ tLoc('점수 변동 그래프', 'Score Chart', '点数推移グラフ') }}
            </button>
            <button
              type="button"
              class="gl-mode-btn"
              :class="{ active: detailViewMode === 'sheet' }"
              @click="detailViewMode = 'sheet'"
            >
              {{ tLoc('경기 요약 표', 'Match Summary', '対局サマリー') }}
            </button>
          </div>
        </div>

        <!-- Mode 1: KimK House Style Round-by-Round Movement Cards -->
        <div v-if="detailViewMode === 'rounds'" class="gl-rounds-pane">
          <div v-if="activeMovements.length === 0" class="gl-no-rounds">
            {{
              tLoc(
                '이 대국은 최종 점수만 입력되어(예: 4번탁 JP-C) 국별 점수 이동 기록이 없습니다. [경기 요약 표]에서 최종 점수를 확인하세요.',
                'This game was recorded with final scores only (e.g. Table 4 JP-C) and has no round-by-round log.',
                'この半荘は最終結果のみ記録されているため、局別ログがありません。'
              )
            }}
          </div>
          <template v-else>
            <div class="gl-hand-filter-bar">
              <label class="gl-hand-filter-label">{{ tLoc('국 선택', 'Select Hand', '局を選択') }}</label>
              <select v-model="selectedHandFilter" class="gl-select gl-hand-select">
                <option value="__all__">
                  {{ tLoc(`전체 국 모두 보기 (${activeMovements.length}국)`, `Show All Hands (${activeMovements.length})`, `全局を表示 (${activeMovements.length}局)`) }}
                </option>
                <option v-for="mv in activeMovements" :key="mv.stepIndex" :value="String(mv.stepIndex)">
                  {{ mv.label }}{{ formatHandOptionSummary(mv) }}
                </option>
              </select>
            </div>

            <div class="gl-rounds-list">
              <div
                v-for="mv in displayedMovements"
                :key="`${activeGame.key}-${mv.stepIndex}`"
                class="urm-card"
                :class="{ 'has-bigwin': mv.maxWinTier !== 'normal' }"
              >
                <div class="urm-header">
                  <div class="urm-title-group">
                    <span class="urm-title">{{ mv.label }} {{ tLoc('점수 이동 내역', 'Score Movement', '点数移動') }}</span>
                    <span
                      v-if="mv.maxWinTier !== 'normal'"
                      class="urm-bigwin-badge"
                      :class="mv.maxWinTier"
                    >
                      🔥 +{{ mv.maxWinGain.toLocaleString() }}
                    </span>
                  </div>
                  <span class="urm-status-badge" :class="mv.status">
                    {{ formatStatusLabel(mv.status) }}
                  </span>
                </div>

                <div class="urm-players-grid">
                  <div
                    v-for="pm in mv.players"
                    :key="`${mv.stepIndex}-${pm.playerId}`"
                    class="urm-player-row"
                    :class="{
                      'is-win': pm.isWin,
                      'is-lose': pm.isLose,
                      'is-cheat': pm.isCheat,
                    }"
                  >
                    <div class="urm-player-left">
                      <span class="urm-seat" :class="{ 'is-east': pm.handWind === '東' }">
                        {{ pm.handWind }}
                      </span>
                      <span
                        class="gl-team-dot"
                        :style="{ backgroundColor: EVENT_TEAM_MAP[EVENT_PLAYER_MAP[pm.playerId]?.teamId || 'A'].color }"
                      ></span>
                      <button
                        type="button"
                        class="urm-name-btn"
                        @click="emit('select-player', pm.playerId)"
                      >
                        {{ pName(pm.playerId, 'full') }}
                      </button>
                      <span v-if="pm.isDealer" class="urm-tag oya">{{ tLoc('오야', 'Dealer', '親') }}</span>
                      <span v-if="pm.isRiichi" class="urm-tag riichi">{{ tLoc('리치', 'Riichi', '立直') }}</span>
                      <span v-if="pm.isWin" class="urm-tag win">
                        {{ mv.status === 'tsumo' || mv.loserIds.length === 0 ? tLoc('쯔모', 'Tsumo', 'ツモ') : tLoc('론', 'Ron', 'ロン') }}
                      </span>
                      <span v-if="pm.isLose" class="urm-tag lose">{{ tLoc('방총', 'Deal-in', '放銃') }}</span>
                      <span v-if="!pm.isWin && pm.isTenpai" class="urm-tag tenpai">{{ tLoc('텐파이', 'Tenpai', '聴牌') }}</span>
                      <span v-if="pm.isCheat" class="urm-tag cheat">{{ tLoc('촌보', 'Chombo', 'チョンボ') }}</span>
                      <span v-if="pm.beolbuCount > 0" class="urm-tag cheat">{{ tLoc('벌부', 'Penalty', '罰符') }}×{{ pm.beolbuCount }}</span>
                    </div>

                    <div class="urm-player-right">
                      <span class="urm-score-flow">
                        {{ pm.scoreBefore.toLocaleString() }} → {{ pm.scoreAfter.toLocaleString() }}
                      </span>
                      <span
                        class="urm-score-delta"
                        :class="pm.delta > 0 ? 'pos' : pm.delta < 0 ? 'neg' : 'zero'"
                      >
                        ({{ pm.delta > 0 ? '+' : '' }}{{ pm.delta.toLocaleString() }})
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>

        <!-- Mode 2: Score Progression Chart -->
        <div v-else-if="detailViewMode === 'chart'" class="gl-chart-pane">
          <div v-if="activeMovements.length === 0" class="gl-no-rounds">
            {{ tLoc('국별 기록이 없어 차트를 표시할 수 없습니다.', 'No round-by-round data for chart.', '局別記録がないためグラフを表示できません。') }}
          </div>
          <div v-else class="gl-chart-box">
            <LineChart :key="`gl-chart-${activeGame.key}-${isDark}`" :data="chartData" :options="chartOptions" />
          </div>
        </div>

        <!-- Mode 3: Match Summary Sheet -->
        <div v-else class="gl-sheet-pane">
          <div class="table-scroll">
            <table class="gl-summary-table">
              <thead>
                <tr>
                  <th>{{ tLoc('순위', 'Rank', '順位') }}</th>
                  <th>{{ tLoc('자리', 'Seat', '席') }}</th>
                  <th class="left">{{ tLoc('선수', 'Player', '選手') }}</th>
                  <th>{{ tLoc('최종 점수', 'Score', '点数') }}</th>
                  <th>{{ tLoc('포인트', 'Pt', 'Pt') }}</th>
                  <th>{{ tLoc('리치', 'Riichi', '立直') }}</th>
                  <th>{{ tLoc('론', 'Ron', 'ロン') }}</th>
                  <th>{{ tLoc('쯔모', 'Tsumo', 'ツモ') }}</th>
                  <th>{{ tLoc('방총', 'Deal-in', '放銃') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in [...activePlayerSummaryRows].sort((a, b) => a.rank - b.rank)"
                  :key="row.playerId"
                  class="gl-sum-row"
                  @click="emit('select-player', row.playerId)"
                >
                  <td class="bold">{{ row.rank }}</td>
                  <td :class="{ 'east-txt': row.startWind === '東' }" class="bold">{{ row.startWind }}</td>
                  <td class="left">
                    <span
                      class="gl-team-dot"
                      :style="{ backgroundColor: EVENT_TEAM_MAP[EVENT_PLAYER_MAP[row.playerId]?.teamId || 'A'].color }"
                    ></span>
                    <strong>{{ pName(row.playerId, 'full') }}</strong>
                  </td>
                  <td class="num bold">{{ row.score.toLocaleString() }}</td>
                  <td
                    class="num bold"
                    :class="(row.point ?? 0) > 0 ? 'pos' : (row.point ?? 0) < 0 ? 'neg' : ''"
                  >
                    {{ row.point !== null ? `${formatSignedPoint(row.point)} pt` : '-' }}
                  </td>
                  <td class="num">{{ activeMovements.length > 0 ? row.riichi : '-' }}</td>
                  <td class="num">{{ activeMovements.length > 0 ? row.ron : '-' }}</td>
                  <td class="num">{{ activeMovements.length > 0 ? row.tsumo : '-' }}</td>
                  <td class="num">{{ activeMovements.length > 0 ? row.lose : '-' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.gamelogs-root {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.card-panel {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  padding: 16px;
}
.gl-filter-top {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.gl-heading {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 800;
}
.gl-sub {
  margin: 0;
  font-size: 12.5px;
  color: var(--text-dimmed);
}
.gl-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.gl-round-chips {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
}
.gl-chip {
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 800;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-dimmed);
  cursor: pointer;
}
.gl-chip.active {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}
.gl-select {
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--input-bg-color, var(--bg-card));
  color: var(--text-color);
  font-size: 12.5px;
  font-weight: 700;
}
.gl-live-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-dimmed);
  cursor: pointer;
}
.gl-empty {
  text-align: center;
  padding: 36px 16px;
  color: var(--text-dimmed);
  font-size: 14px;
}
.gl-layout {
  display: grid;
  grid-template-columns: 310px minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
@media (max-width: 900px) {
  .gl-layout {
    grid-template-columns: 1fr;
  }
}
.gl-sidebar {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.gl-list-header {
  font-size: 12.5px;
  font-weight: 800;
  color: var(--text-dimmed);
  padding: 0 2px;
}
.gl-game-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 72vh;
  overflow-y: auto;
  padding-right: 2px;
}
@media (max-width: 900px) {
  .gl-game-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
    max-height: 290px;
  }
}
.gl-game-item {
  width: 100%;
  text-align: left;
  padding: 10px 11px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-color);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 7px;
  transition: border-color 0.15s, background 0.15s;
}
.gl-game-item:hover {
  border-color: rgba(59, 130, 246, 0.5);
  background: var(--bg-hover-color);
}
.gl-game-item.active {
  border-color: #2563eb;
  background: rgba(37, 99, 235, 0.1);
}
.gl-gi-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.gl-gi-key {
  font-size: 13.5px;
  font-weight: 900;
}
.gl-gi-badges {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
  justify-content: flex-end;
}
.gl-badge {
  font-size: 10.5px;
  font-weight: 800;
  padding: 2px 6px;
  border-radius: 999px;
  white-space: nowrap;
}
.gl-badge.live {
  background: rgba(239, 68, 68, 0.18);
  color: #ef4444;
}
.gl-badge.manual {
  background: rgba(100, 116, 139, 0.18);
  color: var(--text-dimmed);
}
.gl-badge.hands {
  background: rgba(59, 130, 246, 0.14);
  color: #3b82f6;
}
.gl-badge.bigwin {
  background: rgba(245, 158, 11, 0.2);
  color: #d97706;
}
.gl-badge.bigwin.baiman,
.gl-badge.bigwin.sanbaiman,
.gl-badge.bigwin.yakuman {
  background: rgba(239, 68, 68, 0.2);
  color: #dc2626;
}
.gl-badge.comeback {
  background: rgba(168, 85, 247, 0.18);
  color: #9333ea;
}
.gl-gi-players {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.gl-gi-prow {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
}
.gl-gi-rank {
  width: 15px;
  font-weight: 900;
  text-align: center;
  color: var(--text-dimmed);
}
.gl-gi-rank.r1 { color: #16a34a; }
.gl-gi-rank.r4 { color: #dc2626; }
.gl-team-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.gl-gi-pname {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 700;
}
.gl-gi-pscore {
  font-variant-numeric: tabular-nums;
  color: var(--text-dimmed);
  font-weight: 700;
}

.gl-detail {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.gl-detail-head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-color);
}
.gl-detail-title-wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.gl-detail-title {
  margin: 0;
  font-size: 17px;
  font-weight: 900;
  display: flex;
  align-items: center;
  gap: 8px;
}
.gl-detail-sub-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.gl-mode-tabs {
  display: inline-flex;
  gap: 4px;
  padding: 3px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: rgba(125, 125, 125, 0.08);
}
.gl-mode-btn {
  padding: 6px 11px;
  border-radius: 7px;
  border: none;
  background: transparent;
  color: var(--text-dimmed);
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}
.gl-mode-btn.active {
  background: #2563eb;
  color: #ffffff;
}
.gl-hand-filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.gl-hand-filter-label {
  font-size: 12.5px;
  font-weight: 800;
  color: var(--text-dimmed);
  white-space: nowrap;
}
.gl-hand-select {
  flex: 1;
  max-width: 440px;
}
.gl-no-rounds {
  padding: 28px 16px;
  text-align: center;
  color: var(--text-dimmed);
  font-size: 13.5px;
}
.gl-rounds-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* 김케이 하우스 국별 점수 이동 카드 스타일 계승 */
.urm-card {
  padding: 12px 14px;
  border-radius: 11px;
  background: rgba(125, 125, 125, 0.06);
  border: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.urm-card.has-bigwin {
  border-color: rgba(245, 158, 11, 0.55);
  background: rgba(245, 158, 11, 0.06);
}
.urm-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border-color);
}
.urm-title-group {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
}
.urm-title {
  font-size: 13.5px;
  font-weight: 800;
}
.urm-bigwin-badge {
  font-size: 11px;
  font-weight: 900;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(245, 158, 11, 0.22);
  color: #d97706;
}
.urm-bigwin-badge.baiman,
.urm-bigwin-badge.sanbaiman,
.urm-bigwin-badge.yakuman {
  background: rgba(239, 68, 68, 0.22);
  color: #ef4444;
}
.urm-status-badge {
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 800;
  background: rgba(37, 99, 235, 0.14);
  color: #3b82f6;
  white-space: nowrap;
}
.urm-status-badge.tsumo,
.urm-status-badge.ron {
  background: rgba(16, 185, 129, 0.16);
  color: #10b981;
}
.urm-status-badge.cheat {
  background: rgba(239, 68, 68, 0.18);
  color: #ef4444;
}
.urm-players-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.urm-player-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 8px;
  font-size: 13px;
  background: var(--bg-card);
  border: 1px solid transparent;
}
.urm-player-row.is-win {
  border-color: rgba(16, 185, 129, 0.5);
  background: rgba(16, 185, 129, 0.1);
}
.urm-player-row.is-lose {
  border-color: rgba(239, 68, 68, 0.45);
  background: rgba(239, 68, 68, 0.08);
}
.urm-player-row.is-cheat {
  border-color: rgba(239, 68, 68, 0.55);
  background: rgba(239, 68, 68, 0.12);
}
.urm-player-left {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.urm-seat {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 5px;
  font-size: 12px;
  font-weight: 800;
  background: rgba(100, 116, 139, 0.16);
}
.urm-seat.is-east {
  background: rgba(239, 68, 68, 0.18);
  color: var(--color-east, #ef4444);
}
.urm-name-btn {
  border: none;
  background: transparent;
  color: var(--text-color);
  font-weight: 800;
  font-size: 13px;
  padding: 0;
  cursor: pointer;
}
.urm-name-btn:hover {
  text-decoration: underline;
  color: #3b82f6;
}
.urm-tag {
  font-size: 11px;
  font-weight: 800;
  padding: 1px 6px;
  border-radius: 5px;
}
.urm-tag.oya {
  background: rgba(239, 68, 68, 0.14);
  color: #ef4444;
}
.urm-tag.riichi {
  background: rgba(245, 158, 11, 0.2);
  color: #d97706;
}
.urm-tag.win {
  background: rgba(16, 185, 129, 0.22);
  color: #10b981;
}
.urm-tag.lose {
  background: rgba(239, 68, 68, 0.22);
  color: #ef4444;
}
.urm-tag.tenpai {
  background: rgba(59, 130, 246, 0.18);
  color: #3b82f6;
}
.urm-tag.cheat {
  background: rgba(220, 38, 38, 0.25);
  color: #dc2626;
}
.urm-player-right {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-variant-numeric: tabular-nums;
}
.urm-score-flow {
  font-size: 12.5px;
  color: var(--text-dimmed);
  font-weight: 700;
}
.urm-score-delta {
  font-size: 13px;
  font-weight: 900;
}
.urm-score-delta.pos,
.pos { color: var(--color-positive, #16a34a); }
.urm-score-delta.neg,
.neg { color: var(--color-negative, #dc2626); }
.urm-score-delta.zero { color: var(--text-dimmed); }

.gl-chart-box {
  height: 320px;
  width: 100%;
}
.table-scroll {
  overflow-x: auto;
}
.gl-summary-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.gl-summary-table th,
.gl-summary-table td {
  padding: 9px 8px;
  border-bottom: 1px solid var(--border-color);
  text-align: center;
  white-space: nowrap;
}
.gl-summary-table th.left,
.gl-summary-table td.left {
  text-align: left;
}
.gl-sum-row {
  cursor: pointer;
}
.gl-sum-row:hover {
  background: var(--bg-hover-color);
}
.bold { font-weight: 800; }
.num { font-variant-numeric: tabular-nums; }
.east-txt { color: var(--color-east, #ef4444); }
</style>
