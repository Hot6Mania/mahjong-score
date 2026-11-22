<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import {
  computeFrequentOpponentsStats,
  type MemberStatItem,
  type GameRatingHistoryRecord,
  type OpponentHeadToHeadStat,
} from '@/services/publicStatsService';
import { getRatingColor, normalizeRatingPlayerName, computeStableRating } from '@/utils/ratingEngine';

const props = withDefaults(
  defineProps<{
    players: MemberStatItem[];
    initialPlayerA?: string;
    initialPlayerB?: string;
    ratingHistory?: GameRatingHistoryRecord[];
    scopeLabel?: string;
    isDark?: boolean;
  }>(),
  {
    initialPlayerA: '',
    initialPlayerB: '',
    ratingHistory: () => [],
    scopeLabel: '전체 기간',
    isDark: false,
  }
);

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'open-player', name: string): void;
}>();

const sortedPlayers = computed<MemberStatItem[]>(() => {
  return [...(props.players || [])].sort((a, b) => {
    if (b.totalUma !== a.totalUma) return b.totalUma - a.totalUma;
    return b.totalGames - a.totalGames;
  });
});

const selectedNameA = ref<string>('');
const selectedNameB = ref<string>('');
const activeCategory = ref<'all' | 'core' | 'offense' | 'riichi' | 'other'>('all');

const findPlayer = (name: string): MemberStatItem | null => {
  const clean = (name || '').trim();
  if (!clean) return null;
  const exact = sortedPlayers.value.find((p) => p.name === clean);
  if (exact) return exact;
  const norm = normalizeRatingPlayerName(clean);
  return sortedPlayers.value.find((p) => normalizeRatingPlayerName(p.name) === norm) || null;
};

const initSelections = () => {
  const list = sortedPlayers.value;
  if (list.length === 0) {
    selectedNameA.value = '';
    selectedNameB.value = '';
    return;
  }

  const foundA = findPlayer(props.initialPlayerA);
  selectedNameA.value = foundA ? foundA.name : list[0].name;

  const foundB = findPlayer(props.initialPlayerB);
  if (foundB && foundB.name !== selectedNameA.value) {
    selectedNameB.value = foundB.name;
  } else {
    // Player A와 자주 만난 상대 1순위가 현재 목록에 있으면 기본 B로 선택
    const freq = computeFrequentOpponentsStats(selectedNameA.value, props.ratingHistory || []);
    const freqCandidate = freq.opponents
      .map((o) => findPlayer(o.opponentName))
      .find((m) => m && m.name !== selectedNameA.value);
    if (freqCandidate) {
      selectedNameB.value = freqCandidate.name;
    } else {
      const other = list.find((p) => p.name !== selectedNameA.value);
      selectedNameB.value = other ? other.name : list[0].name;
    }
  }
};

watch(
  () => [props.initialPlayerA, props.initialPlayerB, props.players.length],
  () => {
    initSelections();
  },
  { immediate: true }
);

const playerA = computed<MemberStatItem | null>(() => findPlayer(selectedNameA.value));
const playerB = computed<MemberStatItem | null>(() => findPlayer(selectedNameB.value));

const detailA = computed<MemberStatItem | null>(() => {
  if (!playerA.value) return null;
  return playerA.value.detailedStats || playerA.value;
});
const detailB = computed<MemberStatItem | null>(() => {
  if (!playerB.value) return null;
  return playerB.value.detailedStats || playerB.value;
});

const hasDetailA = computed(() => (detailA.value?.totalRounds || 0) > 0);
const hasDetailB = computed(() => (detailB.value?.totalRounds || 0) > 0);

const swapPlayers = () => {
  const tmp = selectedNameA.value;
  selectedNameA.value = selectedNameB.value;
  selectedNameB.value = tmp;
};

// Player A 기준 자주 만난 상대 목록 (빠른 선택 칩 + 직접 맞대결 조회)
const frequentOpponentsForA = computed<OpponentHeadToHeadStat[]>(() => {
  if (!playerA.value || !props.ratingHistory || props.ratingHistory.length === 0) return [];
  const res = computeFrequentOpponentsStats(playerA.value.name, props.ratingHistory);
  return res.opponents.filter((o) => !!findPlayer(o.opponentName));
});

const quickOpponentChips = computed(() => frequentOpponentsForA.value.slice(0, 6));

const headToHead = computed<OpponentHeadToHeadStat | null>(() => {
  if (!playerA.value || !playerB.value || playerA.value.name === playerB.value.name) return null;
  const normB = normalizeRatingPlayerName(playerB.value.name);
  return (
    frequentOpponentsForA.value.find(
      (o) => o.opponentName === playerB.value!.name || normalizeRatingPlayerName(o.opponentName) === normB
    ) || null
  );
});

const h2hWinRateA = computed(() => (headToHead.value ? headToHead.value.winRate : 50));
const h2hWinRateB = computed(() => (headToHead.value ? Math.max(0, 100 - headToHead.value.winRate) : 50));

// 순위 분포 비율 계산
const getRankDist = (p: MemberStatItem | null) => {
  if (!p) return { p1: 0, p2: 0, p3: 0, p4: 0, r1: 0, r2: 0, r3: 0, r4: 0, total: 0 };
  const r1 = p.rank1Count || 0;
  const r2 = p.rank2Count || 0;
  const r3 = p.rank3Count || 0;
  const r4 = p.rank4Count || 0;
  const total = r1 + r2 + r3 + r4;
  if (total === 0) return { p1: 0, p2: 0, p3: 0, p4: 0, r1, r2, r3, r4, total: 0 };
  return {
    p1: (r1 / total) * 100,
    p2: (r2 / total) * 100,
    p3: (r3 / total) * 100,
    p4: (r4 / total) * 100,
    r1,
    r2,
    r3,
    r4,
    total,
  };
};

const rankDistA = computed(() => getRankDist(playerA.value));
const rankDistB = computed(() => getRankDist(playerB.value));

interface CompareRow {
  id: string;
  label: string;
  valA: number | null;
  valB: number | null;
  textA: string;
  textB: string;
  diffText: string;
  winner: 'A' | 'B' | 'tie' | 'none';
  pctA: number;
  pctB: number;
}

interface CompareSection {
  key: 'core' | 'offense' | 'riichi' | 'other';
  title: string;
  rows: CompareRow[];
}

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

const buildRow = (
  id: string,
  label: string,
  valA: number | null,
  valB: number | null,
  higherIsBetter: boolean,
  formatVal: (v: number) => string,
  formatDiff: (d: number) => string,
  customTextA?: string,
  customTextB?: string
): CompareRow => {
  const validA = valA !== null && Number.isFinite(valA);
  const validB = valB !== null && Number.isFinite(valB);
  const textA = validA ? (customTextA ?? formatVal(valA!)) : '-';
  const textB = validB ? (customTextB ?? formatVal(valB!)) : '-';

  if (!validA || !validB) {
    return {
      id,
      label,
      valA,
      valB,
      textA,
      textB,
      diffText: '-',
      winner: 'none',
      pctA: validA ? 50 : 0,
      pctB: validB ? 50 : 0,
    };
  }

  const a = valA!;
  const b = valB!;
  const diff = a - b;
  const eps = 1e-6;
  let winner: 'A' | 'B' | 'tie' = 'tie';
  if (Math.abs(diff) > eps) {
    winner = higherIsBetter ? (a > b ? 'A' : 'B') : a < b ? 'A' : 'B';
  }

  // 막대 비율 계산 (음수 포함 가능 지표 대응)
  let pctA = 50;
  let pctB = 50;
  if (a >= 0 && b >= 0) {
    const sum = a + b;
    if (sum > 0) {
      pctA = Math.max(8, Math.min(92, (a / sum) * 100));
      pctB = 100 - pctA;
    }
  } else {
    const minVal = Math.min(a, b);
    const shiftA = a - minVal + 1;
    const shiftB = b - minVal + 1;
    const sum = shiftA + shiftB;
    pctA = Math.max(12, Math.min(88, (shiftA / sum) * 100));
    pctB = 100 - pctA;
  }

  const diffSign = diff > eps ? '+' : '';
  const diffText = Math.abs(diff) <= eps ? '동률' : `${diffSign}${formatDiff(diff)}`;

  return {
    id,
    label,
    valA: a,
    valB: b,
    textA,
    textB,
    diffText,
    winner,
    pctA,
    pctB,
  };
};

const fmtSigned = (v: number, digits = 1, unit = '') => `${v > 0 ? '+' : ''}${v.toFixed(digits)}${unit}`;
const fmtPct = (v: number) => `${v.toFixed(2)}%`;
const fmtScore = (v: number) => `${Math.round(v).toLocaleString()}점`;

const compareSections = computed<CompareSection[]>(() => {
  const a = playerA.value;
  const b = playerB.value;
  const dA = detailA.value;
  const dB = detailB.value;
  if (!a || !b) return [];

  const detValA = (fn: (d: MemberStatItem) => number): number | null => (hasDetailA.value && dA ? fn(dA) : null);
  const detValB = (fn: (d: MemberStatItem) => number): number | null => (hasDetailB.value && dB ? fn(dB) : null);

  const stableA = computeStableRating({
    playerName: a.name,
    avgUma: a.avgUma,
    totalGames: a.totalGames,
    historyRecords: props.ratingHistory,
  });
  const stableB = computeStableRating({
    playerName: b.name,
    avgUma: b.avgUma,
    totalGames: b.totalGames,
    historyRecords: props.ratingHistory,
  });

  const coreRows: CompareRow[] = [
    buildRow(
      'rating',
      '레이팅(R)',
      a.rating ?? null,
      b.rating ?? null,
      true,
      (v) => `R${Math.round(v)}`,
      (d) => `${Math.round(d)}`
    ),
    buildRow(
      'stableRating',
      '안정 레이팅 (수렴)',
      a.totalGames > 0 ? stableA.stableRating : null,
      b.totalGames > 0 ? stableB.stableRating : null,
      true,
      (v) => `R${Math.round(v)}`,
      (d) => `${Math.round(d)}`
    ),
    buildRow(
      'totalUma',
      '누적 우마',
      a.totalUma,
      b.totalUma,
      true,
      (v) => fmtSigned(v, 1, 'pt'),
      (d) => `${d.toFixed(1)}pt`
    ),
    buildRow(
      'avgUma',
      '평균 우마',
      a.avgUma,
      b.avgUma,
      true,
      (v) => fmtSigned(v, 1, 'pt'),
      (d) => `${d.toFixed(1)}pt`
    ),
    buildRow(
      'avgRank',
      '평균 순위',
      a.avgRank,
      b.avgRank,
      false,
      (v) => `${v.toFixed(3)}위`,
      (d) => `${d.toFixed(3)}위`
    ),
    buildRow(
      'top2Rate',
      '연대율 (1·2위)',
      a.top2Rate,
      b.top2Rate,
      true,
      fmtPct,
      (d) => `${d.toFixed(2)}%p`
    ),
    buildRow(
      'lastAvoid',
      '라스 회피율',
      rankDistA.value.total > 0 ? 100 - rankDistA.value.p4 : null,
      rankDistB.value.total > 0 ? 100 - rankDistB.value.p4 : null,
      true,
      fmtPct,
      (d) => `${d.toFixed(2)}%p`
    ),
    buildRow(
      'totalGames',
      '기록 대국 수',
      a.totalGames,
      b.totalGames,
      true,
      (v) => `${v}전`,
      (d) => `${d}전`
    ),
  ];

  const offenseRows: CompareRow[] = [
    buildRow('winRate', '화료율', detValA((d) => d.winRate), detValB((d) => d.winRate), true, fmtPct, (d) => `${d.toFixed(2)}%p`),
    buildRow('dealInRate', '방총률', detValA((d) => d.dealInRate), detValB((d) => d.dealInRate), false, fmtPct, (d) => `${d.toFixed(2)}%p`),
    buildRow('tsumoRate', '쯔모율', detValA((d) => d.tsumoRate), detValB((d) => d.tsumoRate), true, fmtPct, (d) => `${d.toFixed(2)}%p`),
    buildRow('avgWinScore', '평균 화료 점수', detValA((d) => d.avgWinScore), detValB((d) => d.avgWinScore), true, fmtScore, (d) => `${Math.round(d).toLocaleString()}점`),
    buildRow('avgDealInScore', '평균 방총 점수', detValA((d) => d.avgDealInScore), detValB((d) => d.avgDealInScore), false, fmtScore, (d) => `${Math.round(d).toLocaleString()}점`),
    buildRow('drawRate', '유국률', detValA((d) => d.drawRate), detValB((d) => d.drawRate), false, fmtPct, (d) => `${d.toFixed(2)}%p`),
    buildRow('drawTenpaiRate', '유국 텐파이율', detValA((d) => d.drawTenpaiRate), detValB((d) => d.drawTenpaiRate), true, fmtPct, (d) => `${d.toFixed(2)}%p`),
    buildRow('tobiRate', '토비율 (들통)', detValA((d) => d.tobiRate), detValB((d) => d.tobiRate), false, fmtPct, (d) => `${d.toFixed(2)}%p`),
    buildRow('handEV', '국수지', detValA((d) => d.handEV), detValB((d) => d.handEV), true, (v) => fmtSigned(v, 0, '점'), (d) => `${Math.round(d).toLocaleString()}점`),
    buildRow('netWinEfficiency', '알짜 화료 효율', detValA((d) => d.netWinEfficiency), detValB((d) => d.netWinEfficiency), true, (v) => v.toLocaleString(), (d) => Math.round(d).toLocaleString()),
  ];

  const riichiRows: CompareRow[] = [
    buildRow('riichiRate', '리치율', detValA((d) => d.riichiRate), detValB((d) => d.riichiRate), true, fmtPct, (d) => `${d.toFixed(2)}%p`),
    buildRow('riichiWinRate', '리치 화료율', detValA((d) => d.riichiWinRate), detValB((d) => d.riichiWinRate), true, fmtPct, (d) => `${d.toFixed(2)}%p`),
    buildRow('riichiDealInRate', '리치 방총률', detValA((d) => d.riichiDealInRate), detValB((d) => d.riichiDealInRate), false, fmtPct, (d) => `${d.toFixed(2)}%p`),
    buildRow('riichiDrawRate', '리치 유국률', detValA((d) => d.riichiDrawRate), detValB((d) => d.riichiDrawRate), false, fmtPct, (d) => `${d.toFixed(2)}%p`),
    buildRow('riichiEV', '리치 수지', detValA((d) => d.riichiEV), detValB((d) => d.riichiEV), true, (v) => fmtSigned(v, 0, '점'), (d) => `${Math.round(d).toLocaleString()}점`),
    buildRow('riichiIncomeAvg', '리치 수입 평균', detValA((d) => d.riichiIncomeAvg), detValB((d) => d.riichiIncomeAvg), true, fmtScore, (d) => `${Math.round(d).toLocaleString()}점`),
    buildRow('riichiExpenseAvg', '리치 지출 평균', detValA((d) => d.riichiExpenseAvg), detValB((d) => d.riichiExpenseAvg), false, fmtScore, (d) => `${Math.round(d).toLocaleString()}점`),
    buildRow('firstRiichiRate', '선제율', detValA((d) => d.firstRiichiRate), detValB((d) => d.firstRiichiRate), true, fmtPct, (d) => `${d.toFixed(2)}%p`),
    buildRow('chaseRiichiRate', '추격률', detValA((d) => d.chaseRiichiRate), detValB((d) => d.chaseRiichiRate), true, fmtPct, (d) => `${d.toFixed(2)}%p`),
    buildRow('chaseRiichiWinRate', '추격리치 성공률', detValA((d) => d.chaseRiichiWinRate ?? 0), detValB((d) => d.chaseRiichiWinRate ?? 0), true, fmtPct, (d) => `${d.toFixed(2)}%p`),
    buildRow('chasedRiichiRate', '피추격률', detValA((d) => d.chasedRiichiRate), detValB((d) => d.chasedRiichiRate), false, fmtPct, (d) => `${d.toFixed(2)}%p`),
  ];

  const otherRows: CompareRow[] = [
    buildRow('oyaKaburiRate', '아픈 오야카부리율', detValA((d) => d.oyaKaburiRate), detValB((d) => d.oyaKaburiRate), false, fmtPct, (d) => `${d.toFixed(2)}%p`),
    buildRow('oyaKaburiAvg', '아픈 오야카부리 평균', detValA((d) => d.oyaKaburiAvg), detValB((d) => d.oyaKaburiAvg), false, fmtScore, (d) => `${Math.round(d).toLocaleString()}점`),
    buildRow('dealInRiichiRate', '방총 시 리치율', detValA((d) => d.dealInRiichiRate), detValB((d) => d.dealInRiichiRate), false, fmtPct, (d) => `${d.toFixed(2)}%p`),
    buildRow('winEfficiency', '화료 효율', detValA((d) => d.winEfficiency), detValB((d) => d.winEfficiency), true, (v) => v.toLocaleString(), (d) => Math.round(d).toLocaleString()),
    buildRow('dealInLoss', '방총 손실', detValA((d) => d.dealInLoss), detValB((d) => d.dealInLoss), false, (v) => v.toLocaleString(), (d) => Math.round(d).toLocaleString()),
    buildRow(
      'cheatRate',
      '촌보율',
      detValA((d) => d.cheatRate),
      detValB((d) => d.cheatRate),
      false,
      (v) => `${v.toFixed(4)}%`,
      (d) => `${d.toFixed(4)}%p`,
      hasDetailA.value && dA ? formatPenaltyText(dA.cheatRate, dA.totalRounds, dA.cheatCount) : undefined,
      hasDetailB.value && dB ? formatPenaltyText(dB.cheatRate, dB.totalRounds, dB.cheatCount) : undefined
    ),
    buildRow(
      'beolbuRate',
      '벌부율',
      detValA((d) => d.beolbuRate),
      detValB((d) => d.beolbuRate),
      false,
      (v) => `${v.toFixed(4)}%`,
      (d) => `${d.toFixed(4)}%p`,
      hasDetailA.value && dA ? formatPenaltyText(dA.beolbuRate, dA.totalRounds, dA.beolbuCount) : undefined,
      hasDetailB.value && dB ? formatPenaltyText(dB.beolbuRate, dB.totalRounds, dB.beolbuCount) : undefined
    ),
    buildRow('totalRounds', '총합 국 수', detValA((d) => d.totalRounds), detValB((d) => d.totalRounds), true, (v) => `${v.toLocaleString()}국`, (d) => `${Math.round(d).toLocaleString()}국`),
  ];

  return [
    { key: 'core', title: '핵심 종합 지표', rows: coreRows },
    { key: 'offense', title: '공격 · 수비 스탯', rows: offenseRows },
    { key: 'riichi', title: '리치 스탯', rows: riichiRows },
    { key: 'other', title: '기타 스탯', rows: otherRows },
  ];
});

const visibleSections = computed(() => {
  if (activeCategory.value === 'all') return compareSections.value;
  return compareSections.value.filter((s) => s.key === activeCategory.value);
});

const scoreSummary = computed(() => {
  let winsA = 0;
  let winsB = 0;
  let ties = 0;
  for (const sec of compareSections.value) {
    for (const row of sec.rows) {
      if (row.id === 'totalGames' || row.id === 'totalRounds') continue;
      if (row.winner === 'A') winsA++;
      else if (row.winner === 'B') winsB++;
      else if (row.winner === 'tie') ties++;
    }
  }
  return { winsA, winsB, ties };
});

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    emit('close');
  }
};

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
});
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <Teleport to="body">
  <div class="vs-modal-overlay" @click.self="emit('close')">
    <div class="vs-modal-card" :class="{ dark: isDark }">
      <!-- 헤더 -->
      <div class="vs-modal-header">
        <div class="vs-header-title-wrap">
          <span class="vs-badge-icon">VS</span>
          <div>
            <h3 class="vs-modal-title">플레이어 1:1 스탯 비교</h3>
            <span class="vs-scope-pill">{{ scopeLabel }}</span>
          </div>
        </div>
        <button class="vs-close-btn" @click="emit('close')" title="닫기">✕</button>
      </div>

      <!-- 플레이어 선택 바 -->
      <div class="vs-selector-bar">
        <div class="vs-select-col side-a">
          <label class="vs-select-label">기준 플레이어 (A)</label>
          <select v-model="selectedNameA" class="vs-select-input">
            <option v-for="m in sortedPlayers" :key="'a-' + m.name" :value="m.name">
              {{ m.name }} ({{ m.totalUma > 0 ? '+' : '' }}{{ m.totalUma.toFixed(1) }}pt · {{ m.totalGames }}전)
            </option>
          </select>
        </div>

        <button class="vs-swap-btn" @click="swapPlayers" title="좌우 플레이어 교체">
          ⇄
        </button>

        <div class="vs-select-col side-b">
          <label class="vs-select-label">비교 상대 (B)</label>
          <select v-model="selectedNameB" class="vs-select-input">
            <option v-for="m in sortedPlayers" :key="'b-' + m.name" :value="m.name">
              {{ m.name }} ({{ m.totalUma > 0 ? '+' : '' }}{{ m.totalUma.toFixed(1) }}pt · {{ m.totalGames }}전)
            </option>
          </select>
        </div>
      </div>

      <!-- 자주 만난 상대 빠른 선택 -->
      <div v-if="quickOpponentChips.length > 0 && playerA" class="vs-quick-opps">
        <span class="vs-quick-label">{{ playerA.name }}님 자주 만난 상대:</span>
        <div class="vs-quick-chips">
          <button
            v-for="opp in quickOpponentChips"
            :key="opp.opponentName"
            type="button"
            class="vs-quick-chip"
            :class="{ active: selectedNameB === opp.opponentName }"
            @click="selectedNameB = opp.opponentName"
          >
            {{ opp.opponentName }}
            <span class="vs-chip-cnt">{{ opp.encounterCount }}전</span>
          </button>
        </div>
      </div>

      <!-- 본문 스크롤 영역 -->
      <div class="vs-modal-body" v-if="playerA && playerB">
        <!-- 상단 플레이어 카드 요약 -->
        <div class="vs-hero-grid">
          <div class="vs-hero-card side-a">
            <div class="vs-hero-top">
              <button type="button" class="vs-hero-name" @click="emit('open-player', playerA.name)" title="클릭하여 개인 스탯창 열기">
                {{ playerA.name }} ↗
              </button>
              <span
                v-if="playerA.rating"
                class="vs-rating-badge"
                :style="{ color: getRatingColor(playerA.rating), borderColor: getRatingColor(playerA.rating) }"
              >
                R{{ Math.round(playerA.rating) }}
              </span>
            </div>
            <div class="vs-hero-meta">
              <strong :class="playerA.totalUma >= 0 ? 'pos' : 'neg'">
                {{ playerA.totalUma > 0 ? '+' : '' }}{{ playerA.totalUma.toFixed(1) }}pt
              </strong>
              <span>· 평균 {{ playerA.avgRank.toFixed(3) }}위 · {{ playerA.totalGames }}전</span>
            </div>
            <div class="vs-rank-bar-wrap" v-if="rankDistA.total > 0">
              <div class="vs-rank-bar">
                <div class="rb-1" :style="{ width: rankDistA.p1 + '%' }" :title="`1위 ${rankDistA.p1.toFixed(1)}% (${rankDistA.r1}회)`"></div>
                <div class="rb-2" :style="{ width: rankDistA.p2 + '%' }" :title="`2위 ${rankDistA.p2.toFixed(1)}% (${rankDistA.r2}회)`"></div>
                <div class="rb-3" :style="{ width: rankDistA.p3 + '%' }" :title="`3위 ${rankDistA.p3.toFixed(1)}% (${rankDistA.r3}회)`"></div>
                <div class="rb-4" :style="{ width: rankDistA.p4 + '%' }" :title="`4위 ${rankDistA.p4.toFixed(1)}% (${rankDistA.r4}회)`"></div>
              </div>
              <div class="vs-rank-mini-labels">
                <span>1위 {{ rankDistA.p1.toFixed(1) }}%</span>
                <span>2위 {{ rankDistA.p2.toFixed(1) }}%</span>
                <span>3위 {{ rankDistA.p3.toFixed(1) }}%</span>
                <span>4위 {{ rankDistA.p4.toFixed(1) }}%</span>
              </div>
            </div>
          </div>

          <div class="vs-hero-center">
            <div class="vs-tally-box">
              <span class="tally-a">{{ scoreSummary.winsA }}</span>
              <span class="tally-sep">:</span>
              <span class="tally-b">{{ scoreSummary.winsB }}</span>
            </div>
            <span class="vs-tally-caption">우세 지표 수</span>
          </div>

          <div class="vs-hero-card side-b">
            <div class="vs-hero-top">
              <button type="button" class="vs-hero-name" @click="emit('open-player', playerB.name)" title="클릭하여 개인 스탯창 열기">
                {{ playerB.name }} ↗
              </button>
              <span
                v-if="playerB.rating"
                class="vs-rating-badge"
                :style="{ color: getRatingColor(playerB.rating), borderColor: getRatingColor(playerB.rating) }"
              >
                R{{ Math.round(playerB.rating) }}
              </span>
            </div>
            <div class="vs-hero-meta">
              <strong :class="playerB.totalUma >= 0 ? 'pos' : 'neg'">
                {{ playerB.totalUma > 0 ? '+' : '' }}{{ playerB.totalUma.toFixed(1) }}pt
              </strong>
              <span>· 평균 {{ playerB.avgRank.toFixed(3) }}위 · {{ playerB.totalGames }}전</span>
            </div>
            <div class="vs-rank-bar-wrap" v-if="rankDistB.total > 0">
              <div class="vs-rank-bar">
                <div class="rb-1" :style="{ width: rankDistB.p1 + '%' }" :title="`1위 ${rankDistB.p1.toFixed(1)}% (${rankDistB.r1}회)`"></div>
                <div class="rb-2" :style="{ width: rankDistB.p2 + '%' }" :title="`2위 ${rankDistB.p2.toFixed(1)}% (${rankDistB.r2}회)`"></div>
                <div class="rb-3" :style="{ width: rankDistB.p3 + '%' }" :title="`3위 ${rankDistB.p3.toFixed(1)}% (${rankDistB.r3}회)`"></div>
                <div class="rb-4" :style="{ width: rankDistB.p4 + '%' }" :title="`4위 ${rankDistB.p4.toFixed(1)}% (${rankDistB.r4}회)`"></div>
              </div>
              <div class="vs-rank-mini-labels">
                <span>1위 {{ rankDistB.p1.toFixed(1) }}%</span>
                <span>2위 {{ rankDistB.p2.toFixed(1) }}%</span>
                <span>3위 {{ rankDistB.p3.toFixed(1) }}%</span>
                <span>4위 {{ rankDistB.p4.toFixed(1) }}%</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 직접 맞대결(동탁) 전적 카드 -->
        <div v-if="headToHead" class="vs-h2h-card">
          <div class="vs-h2h-header">
            <span class="vs-h2h-title">직접 맞대결 전적 (전체 동탁 기준)</span>
            <span class="vs-h2h-count">총 {{ headToHead.encounterCount }}전 동탁</span>
          </div>
          <div class="vs-h2h-tug">
            <div class="tug-labels">
              <span class="tug-a">
                {{ playerA.name }} <strong>{{ headToHead.winCount }}승</strong> ({{ h2hWinRateA.toFixed(1) }}%)
              </span>
              <span class="tug-b">
                ({{ h2hWinRateB.toFixed(1) }}%) <strong>{{ headToHead.encounterCount - headToHead.winCount }}승</strong> {{ playerB.name }}
              </span>
            </div>
            <div class="tug-bar">
              <div class="tug-fill-a" :style="{ width: h2hWinRateA + '%' }"></div>
              <div class="tug-fill-b" :style="{ width: h2hWinRateB + '%' }"></div>
            </div>
          </div>
          <div class="vs-h2h-mini-grid">
            <div class="h2h-mini-item">
              <span class="mini-val" :class="{ better: headToHead.playerStats.avgRank < headToHead.opponentStats.avgRank }">
                {{ headToHead.playerStats.avgRank.toFixed(3) }}위
              </span>
              <span class="mini-lbl">동탁 평균 순위</span>
              <span class="mini-val" :class="{ better: headToHead.opponentStats.avgRank < headToHead.playerStats.avgRank }">
                {{ headToHead.opponentStats.avgRank.toFixed(3) }}위
              </span>
            </div>
            <div class="h2h-mini-item">
              <span class="mini-val" :class="{ better: headToHead.playerStats.avgUma > headToHead.opponentStats.avgUma }">
                {{ headToHead.playerStats.avgUma > 0 ? '+' : '' }}{{ headToHead.playerStats.avgUma.toFixed(1) }}pt
              </span>
              <span class="mini-lbl">동탁 평균 우마</span>
              <span class="mini-val" :class="{ better: headToHead.opponentStats.avgUma > headToHead.playerStats.avgUma }">
                {{ headToHead.opponentStats.avgUma > 0 ? '+' : '' }}{{ headToHead.opponentStats.avgUma.toFixed(1) }}pt
              </span>
            </div>
            <div class="h2h-mini-item">
              <span class="mini-val" :class="{ better: headToHead.playerStats.avgScore > headToHead.opponentStats.avgScore }">
                {{ Math.round(headToHead.playerStats.avgScore).toLocaleString() }}점
              </span>
              <span class="mini-lbl">동탁 평균 점수</span>
              <span class="mini-val" :class="{ better: headToHead.opponentStats.avgScore > headToHead.playerStats.avgScore }">
                {{ Math.round(headToHead.opponentStats.avgScore).toLocaleString() }}점
              </span>
            </div>
          </div>
        </div>
        <div v-else-if="playerA.name !== playerB.name" class="vs-h2h-empty">
          두 플레이어의 직접 동탁 대국 기록이 아직 없습니다.
        </div>

        <!-- 카테고리 필터 탭 -->
        <div class="vs-cat-tabs">
          <button type="button" class="vs-cat-btn" :class="{ active: activeCategory === 'all' }" @click="activeCategory = 'all'">전체</button>
          <button type="button" class="vs-cat-btn" :class="{ active: activeCategory === 'core' }" @click="activeCategory = 'core'">핵심 종합</button>
          <button type="button" class="vs-cat-btn" :class="{ active: activeCategory === 'offense' }" @click="activeCategory = 'offense'">공격·수비</button>
          <button type="button" class="vs-cat-btn" :class="{ active: activeCategory === 'riichi' }" @click="activeCategory = 'riichi'">리치</button>
          <button type="button" class="vs-cat-btn" :class="{ active: activeCategory === 'other' }" @click="activeCategory = 'other'">기타 스탯</button>
        </div>

        <!-- 세부 스탯 미집계 안내 -->
        <div v-if="!hasDetailA || !hasDetailB" class="vs-detail-notice">
          ※ 제9회 이후 국별 상세 기록이 없는 플레이어는 세부 스탯이 <code>-</code>로 표시됩니다.
        </div>

        <!-- 지표별 비교 테이블 -->
        <div class="vs-sections-list">
          <div v-for="sec in visibleSections" :key="sec.key" class="vs-section-block">
            <h4 class="vs-section-title">{{ sec.title }}</h4>
            <div class="vs-rows-wrap">
              <div v-for="row in sec.rows" :key="row.id" class="vs-compare-row">
                <div class="vs-row-top">
                  <div class="vs-val-cell side-a" :class="{ 'is-winner': row.winner === 'A' }">
                    <span class="vs-win-dot" v-if="row.winner === 'A'">●</span>
                    {{ row.textA }}
                  </div>
                  <div class="vs-metric-center">
                    <span class="vs-metric-label">{{ row.label }}</span>
                    <span class="vs-metric-diff" :class="row.winner === 'A' ? 'win-a' : row.winner === 'B' ? 'win-b' : ''">
                      {{ row.diffText }}
                    </span>
                  </div>
                  <div class="vs-val-cell side-b" :class="{ 'is-winner': row.winner === 'B' }">
                    {{ row.textB }}
                    <span class="vs-win-dot" v-if="row.winner === 'B'">●</span>
                  </div>
                </div>
                <div class="vs-dual-bar" v-if="row.valA !== null && row.valB !== null">
                  <div class="vs-bar-a" :class="{ dim: row.winner === 'B' }" :style="{ width: row.pctA + '%' }"></div>
                  <div class="vs-bar-b" :class="{ dim: row.winner === 'A' }" :style="{ width: row.pctB + '%' }"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  </Teleport>
</template>

<style scoped>
.vs-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 3200;
  background: rgba(15, 23, 42, 0.62);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 14px;
}

.vs-modal-card {
  width: min(94vw, 860px);
  max-height: 92dvh;
  background: #ffffff;
  color: #0f172a;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.vs-modal-card.dark {
  background: #141414;
  color: #f5f5f5;
  border-color: #333333;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.78);
}

.vs-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid #e2e8f0;
  background: #f8fafc;
}
.vs-modal-card.dark .vs-modal-header {
  background: #1c1c1c;
  border-bottom-color: #2f2f2f;
}

.vs-header-title-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
}
.vs-badge-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: linear-gradient(135deg, #2563eb, #e11d48);
  color: #ffffff;
  font-weight: 900;
  font-size: 13px;
  letter-spacing: 0.04em;
  flex-shrink: 0;
}
.vs-modal-title {
  margin: 0;
  font-size: 16px;
  font-weight: 800;
  line-height: 1.25;
}
.vs-scope-pill {
  display: inline-block;
  margin-top: 2px;
  font-size: 11px;
  font-weight: 600;
  color: #2563eb;
  background: rgba(37, 99, 235, 0.1);
  padding: 1px 7px;
  border-radius: 999px;
}
.vs-modal-card.dark .vs-scope-pill {
  color: #60a5fa;
  background: rgba(96, 165, 250, 0.15);
}

.vs-close-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid #cbd5e1;
  background: transparent;
  color: inherit;
  font-size: 15px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.vs-close-btn:hover {
  background: rgba(100, 116, 139, 0.12);
}
.vs-modal-card.dark .vs-close-btn {
  border-color: rgba(148, 163, 184, 0.25);
}

.vs-selector-bar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 10px;
  align-items: end;
  padding: 12px 18px 10px;
  border-bottom: 1px solid #e2e8f0;
}
.vs-modal-card.dark .vs-selector-bar {
  border-bottom-color: rgba(148, 163, 184, 0.14);
}

.vs-select-col {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.vs-select-label {
  font-size: 11px;
  font-weight: 700;
}
.vs-select-col.side-a .vs-select-label {
  color: #2563eb;
}
.vs-select-col.side-b .vs-select-label {
  color: #e11d48;
}
.vs-modal-card.dark .vs-select-col.side-a .vs-select-label {
  color: #60a5fa;
}
.vs-modal-card.dark .vs-select-col.side-b .vs-select-label {
  color: #fb7185;
}

.vs-select-input {
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1.5px solid #cbd5e1;
  background: #ffffff;
  color: #0f172a;
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  outline: none;
}
.vs-select-col.side-a .vs-select-input:focus {
  border-color: #2563eb;
}
.vs-select-col.side-b .vs-select-input:focus {
  border-color: #e11d48;
}
.vs-modal-card.dark .vs-select-input {
  background: #0a0a0a;
  color: #f5f5f5;
  border-color: #3d3d3d;
}

.vs-swap-btn {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  border: 1px solid #cbd5e1;
  background: #f8fafc;
  color: #334155;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.15s ease, background 0.15s ease;
}
.vs-swap-btn:hover {
  background: #e2e8f0;
  transform: scale(1.05);
}
.vs-modal-card.dark .vs-swap-btn {
  background: #1e293b;
  color: #e2e8f0;
  border-color: rgba(148, 163, 184, 0.28);
}
.vs-modal-card.dark .vs-swap-btn:hover {
  background: #334155;
}

.vs-quick-opps {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 18px;
  background: rgba(148, 163, 184, 0.06);
  border-bottom: 1px solid #e2e8f0;
  font-size: 11.5px;
}
.vs-modal-card.dark .vs-quick-opps {
  background: rgba(255, 255, 255, 0.03);
  border-bottom-color: rgba(148, 163, 184, 0.14);
}
.vs-quick-label {
  color: #64748b;
  font-weight: 600;
  white-space: nowrap;
}
.vs-modal-card.dark .vs-quick-label {
  color: #94a3b8;
}
.vs-quick-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.vs-quick-chip {
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #334155;
  border-radius: 999px;
  padding: 3px 9px;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.vs-quick-chip:hover {
  border-color: #e11d48;
  color: #e11d48;
}
.vs-quick-chip.active {
  background: #e11d48;
  border-color: #e11d48;
  color: #ffffff;
}
.vs-quick-chip .vs-chip-cnt {
  font-size: 10px;
  opacity: 0.78;
}
.vs-modal-card.dark .vs-quick-chip {
  background: #1e293b;
  color: #cbd5e1;
  border-color: rgba(148, 163, 184, 0.25);
}
.vs-modal-card.dark .vs-quick-chip.active {
  background: #e11d48;
  border-color: #e11d48;
  color: #ffffff;
}

.vs-modal-body {
  padding: 14px 18px 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.vs-hero-grid {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 10px;
  align-items: stretch;
}

.vs-hero-card {
  border-radius: 12px;
  padding: 12px;
  border: 1.5px solid #e2e8f0;
  background: #f8fafc;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.vs-hero-card.side-a {
  border-top: 3px solid #2563eb;
}
.vs-hero-card.side-b {
  border-top: 3px solid #e11d48;
}
.vs-modal-card.dark .vs-hero-card {
  background: #1c1c1c;
  border-color: #333333;
}
.vs-modal-card.dark .vs-hero-card.side-a {
  border-top-color: #3b82f6;
}
.vs-modal-card.dark .vs-hero-card.side-b {
  border-top-color: #fb7185;
}

.vs-hero-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  flex-wrap: wrap;
}
.vs-hero-name {
  border: none;
  background: transparent;
  padding: 0;
  color: inherit;
  font-size: 16px;
  font-weight: 800;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
}
.vs-hero-name:hover {
  text-decoration: underline;
}
.vs-rating-badge {
  font-size: 12px;
  font-weight: 800;
  padding: 2px 7px;
  border-radius: 6px;
  border: 1.5px solid currentColor;
  background: rgba(255, 255, 255, 0.6);
}
.vs-modal-card.dark .vs-rating-badge {
  background: rgba(15, 23, 42, 0.5);
}

.vs-hero-meta {
  font-size: 12px;
  color: #475569;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.vs-modal-card.dark .vs-hero-meta {
  color: #cbd5e1;
}
.vs-hero-meta .pos {
  color: #16a34a;
}
.vs-hero-meta .neg {
  color: #dc2626;
}
.vs-modal-card.dark .vs-hero-meta .pos {
  color: #4ade80;
}
.vs-modal-card.dark .vs-hero-meta .neg {
  color: #f87171;
}

.vs-rank-bar-wrap {
  margin-top: 2px;
}
.vs-rank-bar {
  display: flex;
  height: 7px;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(148, 163, 184, 0.2);
}
.vs-rank-bar .rb-1 { background: #22c55e; }
.vs-rank-bar .rb-2 { background: #3b82f6; }
.vs-rank-bar .rb-3 { background: #f59e0b; }
.vs-rank-bar .rb-4 { background: #ef4444; }
.vs-rank-mini-labels {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: #64748b;
  margin-top: 3px;
}
.vs-modal-card.dark .vs-rank-mini-labels {
  color: #94a3b8;
}

.vs-hero-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
}
.vs-tally-box {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 18px;
  font-weight: 900;
  white-space: nowrap;
}
.tally-a { color: #2563eb; }
.tally-b { color: #e11d48; }
.tally-sep { color: #94a3b8; font-size: 14px; }
.vs-modal-card.dark .tally-a { color: #60a5fa; }
.vs-modal-card.dark .tally-b { color: #fb7185; }
.vs-tally-caption {
  font-size: 10px;
  color: #64748b;
  margin-top: 2px;
  white-space: nowrap;
}

/* 직접 맞대결 카드 */
.vs-h2h-card {
  border-radius: 12px;
  padding: 12px 14px;
  border: 1px solid #dbeafe;
  background: linear-gradient(135deg, rgba(37, 99, 235, 0.05), rgba(225, 29, 72, 0.05));
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.vs-modal-card.dark .vs-h2h-card {
  border-color: #333333;
  background: #1b1b1b;
}
.vs-h2h-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  font-weight: 700;
}
.vs-h2h-count {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.08);
}
.vs-modal-card.dark .vs-h2h-count {
  background: rgba(255, 255, 255, 0.1);
}
.vs-h2h-tug .tug-labels {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  margin-bottom: 5px;
}
.tug-a { color: #1d4ed8; }
.tug-b { color: #be123c; }
.vs-modal-card.dark .tug-a { color: #93c5fd; }
.vs-modal-card.dark .tug-b { color: #fda4af; }
.tug-bar {
  display: flex;
  height: 10px;
  border-radius: 999px;
  overflow: hidden;
  gap: 2px;
}
.tug-fill-a {
  background: linear-gradient(90deg, #3b82f6, #2563eb);
  transition: width 0.3s ease;
}
.tug-fill-b {
  background: linear-gradient(90deg, #f43f5e, #e11d48);
  transition: width 0.3s ease;
}
.vs-h2h-mini-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.h2h-mini-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  background: rgba(255, 255, 255, 0.72);
  border-radius: 8px;
  padding: 6px 8px;
  font-size: 11.5px;
}
.vs-modal-card.dark .h2h-mini-item {
  background: rgba(15, 23, 42, 0.55);
}
.h2h-mini-item .mini-lbl {
  font-size: 10.5px;
  color: #64748b;
  text-align: center;
}
.vs-modal-card.dark .h2h-mini-item .mini-lbl {
  color: #94a3b8;
}
.h2h-mini-item .mini-val {
  font-weight: 700;
  white-space: nowrap;
}
.h2h-mini-item .mini-val.better {
  color: #16a34a;
}
.vs-modal-card.dark .h2h-mini-item .mini-val.better {
  color: #4ade80;
}

.vs-h2h-empty {
  text-align: center;
  font-size: 12px;
  color: #64748b;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(148, 163, 184, 0.08);
}

/* 카테고리 탭 */
.vs-cat-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.vs-cat-btn {
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid #cbd5e1;
  background: #f8fafc;
  color: #475569;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  font-family: inherit;
}
.vs-cat-btn.active {
  background: #0f172a;
  border-color: #0f172a;
  color: #ffffff;
}
.vs-modal-card.dark .vs-cat-btn {
  background: #1e293b;
  border-color: rgba(148, 163, 184, 0.25);
  color: #cbd5e1;
}
.vs-modal-card.dark .vs-cat-btn.active {
  background: #3b82f6;
  border-color: #3b82f6;
  color: #ffffff;
}

.vs-detail-notice {
  font-size: 11.5px;
  color: #64748b;
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.25);
}

/* 비교 섹션 & 행 */
.vs-sections-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.vs-section-block {
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  overflow: hidden;
}
.vs-modal-card.dark .vs-section-block {
  border-color: rgba(148, 163, 184, 0.18);
}
.vs-section-title {
  margin: 0;
  padding: 9px 14px;
  font-size: 13px;
  font-weight: 800;
  background: #f1f5f9;
  color: #334155;
  border-bottom: 1px solid #e2e8f0;
}
.vs-modal-card.dark .vs-section-title {
  background: #1c1c1c;
  color: #f5f5f5;
  border-bottom-color: #333333;
}

.vs-rows-wrap {
  display: flex;
  flex-direction: column;
}
.vs-compare-row {
  padding: 9px 14px;
  border-bottom: 1px solid rgba(226, 232, 240, 0.7);
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.vs-compare-row:last-child {
  border-bottom: none;
}
.vs-modal-card.dark .vs-compare-row {
  border-bottom-color: rgba(148, 163, 184, 0.12);
}

.vs-row-top {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 8px;
}
.vs-val-cell {
  font-size: 13px;
  font-weight: 600;
  color: #334155;
  display: flex;
  align-items: center;
  gap: 4px;
}
.vs-modal-card.dark .vs-val-cell {
  color: #cbd5e1;
}
.vs-val-cell.side-a {
  justify-content: flex-start;
}
.vs-val-cell.side-b {
  justify-content: flex-end;
  text-align: right;
}
.vs-val-cell.is-winner {
  color: #15803d;
  font-weight: 800;
}
.vs-modal-card.dark .vs-val-cell.is-winner {
  color: #4ade80;
}
.vs-win-dot {
  font-size: 8px;
}

.vs-metric-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  min-width: 110px;
}
.vs-metric-label {
  font-size: 12px;
  font-weight: 700;
  color: #475569;
}
.vs-modal-card.dark .vs-metric-label {
  color: #e2e8f0;
}
.vs-metric-diff {
  font-size: 10.5px;
  font-weight: 600;
  color: #94a3b8;
}
.vs-metric-diff.win-a {
  color: #2563eb;
}
.vs-metric-diff.win-b {
  color: #e11d48;
}
.vs-modal-card.dark .vs-metric-diff.win-a {
  color: #60a5fa;
}
.vs-modal-card.dark .vs-metric-diff.win-b {
  color: #fb7185;
}

.vs-dual-bar {
  display: flex;
  height: 5px;
  border-radius: 999px;
  overflow: hidden;
  gap: 2px;
}
.vs-bar-a {
  background: #3b82f6;
  border-radius: 999px 0 0 999px;
  transition: width 0.25s ease;
}
.vs-bar-b {
  background: #f43f5e;
  border-radius: 0 999px 999px 0;
  transition: width 0.25s ease;
}
.vs-bar-a.dim,
.vs-bar-b.dim {
  opacity: 0.35;
}

/* 모바일 / iPhone SE 반응형 */
@media (max-width: 640px) {
  .vs-modal-overlay {
    padding: 6px;
  }
  .vs-modal-card {
    width: 97vw;
    max-height: 95dvh;
    border-radius: 12px;
  }
  .vs-modal-header {
    padding: 11px 12px;
  }
  .vs-selector-bar {
    grid-template-columns: 1fr auto 1fr;
    gap: 6px;
    padding: 10px 12px;
  }
  .vs-select-input {
    font-size: 12px;
    padding: 7px 6px;
  }
  .vs-swap-btn {
    width: 30px;
    height: 32px;
    font-size: 14px;
  }
  .vs-quick-opps {
    padding: 7px 12px;
  }
  .vs-modal-body {
    padding: 10px 12px 16px;
  }
  .vs-hero-grid {
    grid-template-columns: 1fr;
    gap: 8px;
  }
  .vs-hero-center {
    flex-direction: row;
    gap: 8px;
    padding: 4px 0;
  }
  .vs-h2h-mini-grid {
    grid-template-columns: 1fr;
    gap: 5px;
  }
  .vs-compare-row {
    padding: 8px 10px;
  }
  .vs-val-cell {
    font-size: 12px;
  }
  .vs-metric-center {
    min-width: 84px;
  }
  .vs-metric-label {
    font-size: 11px;
  }
}
</style>
