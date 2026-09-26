<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  Chart as ChartJS,
  Title,
  Tooltip as ChartTooltip,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  CategoryScale,
  type ChartOptions
} from 'chart.js';
import { Line as LineChart } from 'vue-chartjs';
import {
  fetchPublicAllStats,
  fetchPublicSessions,
  fetchPublicSessionDetail,
  fetchPublicStatsMatrix,
  calculateSessionUmaTrajectory,
  calculateMetricDistribution,
  type MemberStatItem,
  type SessionDetail,
  type StatsMatrixData,
  type DistributionData
} from '@/services/publicStatsService';

ChartJS.register(Title, ChartTooltip, Legend, LineElement, LinearScale, PointElement, CategoryScale);

const emit = defineEmits<{
  (e: 'go-to-scorer'): void;
}>();

const router = useRouter();

// 테마 상태
const isDark = ref(false);
onMounted(() => {
  isDark.value = document.documentElement.classList.contains('dark');
});

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

// 탭 상태 ('ranking' | 'matrix' | 'sessions')
const activeTab = ref<'ranking' | 'matrix' | 'sessions'>('ranking');

// 로딩 및 에러 상태
const isLoading = ref(true);
const errorMessage = ref('');

// 토스트 메시지
const toastMessage = ref('');
const showToast = (msg: string) => {
  toastMessage.value = msg;
  setTimeout(() => {
    toastMessage.value = '';
  }, 2500);
};

// ==========================================
// 1. 종합 랭킹 & 스탯 데이터
// ==========================================
const allStats = ref<MemberStatItem[]>([]);
const searchQuery = ref('');
type SortKey = 'totalUma' | 'avgUma' | 'avgRank' | 'totalGames' | 'top2Rate';
const sortKey = ref<SortKey>('totalUma');
const sortOrder = ref<'asc' | 'desc'>('desc');

// 선택된 플레이어 상세 모달 상태
const selectedPlayer = ref<MemberStatItem | null>(null);
const displayPlayerStats = computed<MemberStatItem>(() => {
  if (!selectedPlayer.value) {
    return {} as MemberStatItem;
  }
  return selectedPlayer.value.detailedStats || selectedPlayer.value;
});
const modalActiveTab = ref<'basic' | 'riichi' | 'other' | 'rank'>('basic');
const hoveredRank = ref<number | null>(null);

const filteredStats = computed(() => {
  // 1) 전체 리스트를 현재 정렬 기준에 따라 정렬
  const sorted = [...allStats.value].sort((a, b) => {
    let valA = a[sortKey.value];
    let valB = b[sortKey.value];

    if (sortOrder.value === 'asc') {
      return valA > valB ? 1 : -1;
    } else {
      return valA < valB ? 1 : -1;
    }
  });

  // 2) 정렬 순서대로 전체 순위(overallRank) 부여
  const withRank = sorted.map((item, idx) => ({
    ...item,
    overallRank: idx + 1
  }));

  // 3) 검색어가 있다면 필터링 (전체 순위 overallRank는 유지)
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase();
    return withRank.filter(m => m.name.toLowerCase().includes(q));
  }

  return withRank;
});

const podiumTop3 = computed(() => {
  return allStats.value.slice(0, 3);
});

const handleSort = (key: SortKey) => {
  if (sortKey.value === key) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortKey.value = key;
    sortOrder.value = (key === 'avgRank') ? 'asc' : 'desc';
  }
};

const getDistPct = (count: number, total: number): string => {
  if (total <= 0) return '0.0';
  return ((count / total) * 100).toFixed(1);
};

const formatDualMetric = (
  overallVal: number | undefined,
  detailedVal: number | undefined,
  decimals: number = 0,
  sign: boolean = false
): string => {
  const oNum = overallVal || 0;
  const dNum = detailedVal || 0;
  const oStr = (sign && oNum > 0 ? '+' : '') + oNum.toFixed(decimals);
  const dStr = (sign && dNum > 0 ? '+' : '') + dNum.toFixed(decimals);
  if (oStr !== dStr && selectedPlayer.value?.detailedStats) {
    return `${oStr}(${dStr})`;
  }
  return oStr;
};

// 모달 내 순위 비율 도넛 차트 계산 (9회차 이후 순수 통계 기준)
const modalRankStats = computed(() => {
  if (!selectedPlayer.value) {
    return { r1: 0, r2: 0, r3: 0, r4: 0, p1: 0, p2: 0, p3: 0, p4: 0, totalGames: 0, top2Rate: '0.0%', lastAvoidRate: '0.0%' };
  }
  const m = displayPlayerStats.value;
  const tot = m.totalGames;
  const p1 = tot > 0 ? (m.rank1Count / tot) * 100 : 0;
  const p2 = tot > 0 ? (m.rank2Count / tot) * 100 : 0;
  const p3 = tot > 0 ? (m.rank3Count / tot) * 100 : 0;
  const p4 = tot > 0 ? (m.rank4Count / tot) * 100 : 0;
  const top2Rate = tot > 0 ? (((m.rank1Count + m.rank2Count) / tot) * 100).toFixed(1) + '%' : '0.0%';
  const lastAvoidRate = tot > 0 ? (((m.rank1Count + m.rank2Count + m.rank3Count) / tot) * 100).toFixed(1) + '%' : '0.0%';

  return {
    r1: m.rank1Count,
    r2: m.rank2Count,
    r3: m.rank3Count,
    r4: m.rank4Count,
    p1,
    p2,
    p3,
    p4,
    totalGames: tot,
    top2Rate,
    lastAvoidRate,
  };
});

// ==========================================
// 2. 역대 회차 전적 ('통계' 시트) 데이터
// ==========================================
const statsMatrix = ref<StatsMatrixData | null>(null);
const matrixSearchQuery = ref('');

const filteredMatrixRows = computed(() => {
  if (!statsMatrix.value) return [];
  if (!matrixSearchQuery.value.trim()) return statsMatrix.value.rows;
  const q = matrixSearchQuery.value.trim().toLowerCase();
  return statsMatrix.value.rows.filter(p => p.name.toLowerCase().includes(q));
});

const navigateToSession = (sessionColName: string) => {
  const cleaned = sessionColName.split('\n')[0].trim();
  const match = availableSessions.value.find(s => s.includes(cleaned) || cleaned.includes(s));
  if (match) {
    selectedSession.value = match;
  }
  activeTab.value = 'sessions';
};

const formatMatrixScore = (score: number | null | undefined): string => {
  if (score === null || score === undefined) return '-';
  return `${score > 0 ? '+' : ''}${score.toFixed(1)}`;
};

const getMatrixScoreClass = (score: number | null | undefined): string => {
  if (score === null || score === undefined) return 'score-empty';
  return score >= 0 ? 'pos' : 'neg';
};

const openPlayerByName = (name: string) => {
  const match = allStats.value.find(m => m.name === name);
  if (match) {
    selectedPlayer.value = match;
  }
};

// ==========================================
// 3. 회차별 경기 상세 데이터 & 꺾은선 차트
// ==========================================
const availableSessions = ref<string[]>([]);
const selectedSession = ref('');
const currentSessionDetail = ref<SessionDetail | null>(null);
const isLoadingSession = ref(false);

const loadSessionsList = async () => {
  try {
    const sessions = await fetchPublicSessions();
    availableSessions.value = sessions;
    if (sessions.length > 0 && !selectedSession.value) {
      selectedSession.value = sessions[0];
    }
  } catch (err: any) {
    console.error("회차 목록 로드 실패:", err);
  }
};

const loadSessionDetail = async (sessionName: string) => {
  if (!sessionName) return;
  isLoadingSession.value = true;
  try {
    const detail = await fetchPublicSessionDetail(sessionName);
    currentSessionDetail.value = detail;
  } catch (err: any) {
    console.error("회차 상세 로드 실패:", err);
  } finally {
    isLoadingSession.value = false;
  }
};

watch(selectedSession, (newVal) => {
  if (newVal) {
    loadSessionDetail(newVal);
  }
});

// 회차 누적 우마 변동 추이 차트 데이터
const sessionChartData = computed(() => {
  if (!currentSessionDetail.value) {
    return { labels: [], datasets: [] };
  }
  const traj = calculateSessionUmaTrajectory(currentSessionDetail.value);
  const datasets = traj.datasets.map(d => ({
    label: d.name,
    data: d.data,
    borderColor: d.color,
    backgroundColor: d.color,
    borderWidth: 2.2,
    pointRadius: 4,
    pointHoverRadius: 6,
    tension: 0.15,
    fill: false,
  }));

  return {
    labels: traj.labels,
    datasets,
  };
});

const sessionChartOptions = computed<ChartOptions<'line'>>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'top',
      labels: {
        font: { family: "'Noto Serif KR', serif", size: 12 },
        usePointStyle: true,
        boxWidth: 8,
      },
    },
    tooltip: {
      mode: 'index',
      intersect: false,
      callbacks: {
        label: (context) => {
          const val = context.parsed.y;
          return `${context.dataset.label}: ${val > 0 ? '+' : ''}${val}pt`;
        }
      }
    }
  },
  scales: {
    x: {
      grid: { color: isDark.value ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)' },
      ticks: { color: isDark.value ? '#94a3b8' : '#64748b' }
    },
    y: {
      grid: { color: isDark.value ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)' },
      ticks: {
        color: isDark.value ? '#94a3b8' : '#64748b',
        callback: (value) => `${Number(value) > 0 ? '+' : ''}${value}`,
      }
    }
  }
}));

// ==========================================
// 4. 개인 스탯 연속 히스토그램 팝오버 상태
// ==========================================
const activeDist = ref<DistributionData | null>(null);
const activeDistName = ref('');
const activeDistUnit = ref('');
const tooltipPos = ref({ x: 0, y: 0, visible: false });
const isTooltipBelow = ref(false);

const onHoverMetric = (
  e: MouseEvent,
  key: keyof MemberStatItem,
  name: string,
  val: number,
  higherIsBetter = true,
  unit = ''
) => {
  if (!allStats.value || allStats.value.length === 0) return;
  const detailedList = allStats.value.map(m => m.detailedStats || m);
  const dist = calculateMetricDistribution(detailedList, key, name, val, unit, higherIsBetter, displayPlayerStats.value?.name);
  activeDist.value = dist;
  activeDistName.value = name;
  activeDistUnit.value = unit;

  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const screenW = typeof window !== 'undefined' ? window.innerWidth : 360;
  const rawX = rect.left + rect.width / 2;
  const clampedX = Math.max(115, Math.min(screenW - 115, rawX));

  if (rect.top < 180) {
    isTooltipBelow.value = true;
    tooltipPos.value = {
      x: clampedX,
      y: rect.bottom + 10,
      visible: true,
    };
  } else {
    isTooltipBelow.value = false;
    tooltipPos.value = {
      x: clampedX,
      y: rect.top - 10,
      visible: true,
    };
  }
};

const onLeaveMetric = () => {
  tooltipPos.value.visible = false;
  activeDist.value = null;
};

// 전체 초기 데이터 로드
const loadAllData = async () => {
  isLoading.value = true;
  errorMessage.value = '';
  try {
    const [stats, matrix] = await Promise.all([
      fetchPublicAllStats(),
      fetchPublicStatsMatrix().catch(e => {
        console.warn("통계 매트릭스 로드 실패:", e);
        return null;
      }),
      loadSessionsList()
    ]);
    allStats.value = stats;
    statsMatrix.value = matrix;
    if (selectedSession.value) {
      await loadSessionDetail(selectedSession.value);
    }
  } catch (err: any) {
    console.error("데이터 로드 실패:", err);
    errorMessage.value = err.message || "스프레드시트 데이터를 불러오는 데 실패했습니다.";
  } finally {
    isLoading.value = false;
  }
};

onMounted(() => {
  loadAllData();
});

// 링크 복사
const copyDashboardLink = async () => {
  try {
    const url = window.location.origin + '/mahjong-score/stats';
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(url);
    } else {
      const input = document.createElement('textarea');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
    }
    showToast('대시보드 링크가 복사되었습니다!');
  } catch (e) {
    showToast('링크 복사에 실패했습니다.');
  }
};

const handleGoToScorer = () => {
  emit('go-to-scorer');
  router.push('/');
};

const getRankClass = (rank: number) => {
  if (rank === 1) return 'rank-1';
  if (rank === 2) return 'rank-2';
  if (rank === 3) return 'rank-3';
  return 'rank-4';
};
</script>

<template>
  <div class="stats-dashboard-container">
    <!-- 토스트 알림 -->
    <Transition name="toast-fade">
      <div v-if="toastMessage" class="dashboard-toast">
        {{ toastMessage }}
      </div>
    </Transition>

    <!-- 인터랙티브 연속 히스토그램 팝오버 툴팁 (폭 축소 및 50% 절반 구분선 적용) -->
    <div 
      v-if="tooltipPos.visible && activeDist" 
      class="dist-tooltip-popup"
      :class="{ below: isTooltipBelow }"
      :style="{ left: tooltipPos.x + 'px', top: tooltipPos.y + 'px' }"
    >
      <div class="dist-tooltip-header">
        <span class="dist-title">{{ activeDistName }} 전체 분포</span>
        <span class="dist-rank-chip" :class="activeDist.isUpperHalf ? 'pos' : 'neg'">
          {{ activeDist.isUpperHalf ? '상위' : '하위' }} {{ activeDist.topPct }}%
        </span>
      </div>
      <div class="dist-sub-rank">
        {{ activeDist.percentileText }} ({{ activeDist.rank }}위 / {{ activeDist.totalCount }}명)
      </div>
      <div class="dist-my-val">
        내 수치: <strong>{{ activeDist.currentValue.toLocaleString() }}{{ activeDistUnit }}</strong>
      </div>

      <!-- SVG 1인 1막대 계단형 히스토그램 & 하위 30%/50%/상위 30% 구분선 -->
      <div class="dist-chart-box">
        <svg viewBox="0 0 160 44" class="dist-svg" preserveAspectRatio="none">
          <!-- 1인 1막대 계단형 바 (대국수 > 0인 실활동 멤버만 렌더링) -->
          <rect
            v-for="(bar, idx) in activeDist.bars"
            :key="idx"
            :x="bar.x"
            :y="bar.y"
            :width="bar.width"
            :height="bar.height"
            :fill="bar.isCurrent ? '#3b82f6' : (isDark ? 'rgba(148, 163, 184, 0.45)' : 'rgba(100, 116, 139, 0.35)')"
            :stroke="bar.isCurrent ? '#60a5fa' : 'none'"
            :stroke-width="bar.isCurrent ? 1 : 0"
            rx="1"
          />
          <!-- 현재 플레이어 위치 상단 하이라이트 핀/삼각형 마커 -->
          <polygon
            v-for="(bar, idx) in activeDist.bars"
            :key="'pin-' + idx"
            v-show="bar.isCurrent"
            :points="`${bar.x + bar.width/2},${Math.max(2, bar.y - 1)} ${bar.x + bar.width/2 - 2.5},${Math.max(0, bar.y - 5)} ${bar.x + bar.width/2 + 2.5},${Math.max(0, bar.y - 5)}`"
            fill="#3b82f6"
          />

          <!-- 하위 30% 구분선 (연한 회색 점선) -->
          <line 
            :x1="activeDist.line30X" 
            y1="0" 
            :x2="activeDist.line30X" 
            y2="44" 
            stroke="rgba(156, 163, 175, 0.65)" 
            stroke-width="1.2" 
            stroke-dasharray="2,2" 
          />

          <!-- 중앙 50% 구분선 (더 두꺼운 흰색/밝은 점선) -->
          <line 
            x1="80" 
            y1="0" 
            x2="80" 
            y2="44" 
            stroke="rgba(255, 255, 255, 0.55)" 
            stroke-width="2.0" 
            stroke-dasharray="3,2" 
          />

          <!-- 상위 30% 구분선 (연한 회색 점선) -->
          <line 
            :x1="activeDist.line70X" 
            y1="0" 
            :x2="activeDist.line70X" 
            y2="44" 
            stroke="rgba(156, 163, 175, 0.65)" 
            stroke-width="1.2" 
            stroke-dasharray="2,2" 
          />
        </svg>

        <!-- 폰트 왜곡 방지용 HTML 레이블 오버레이 (비율 찌그러짐 원천 차단) -->
        <div class="dist-chart-labels-overlay">
          <span class="dist-line-tag" :style="{ left: (activeDist.line30X / 160 * 100) + '%' }">하위 30%</span>
          <span class="dist-line-tag tag-50" style="left: 50%;">50%</span>
          <span class="dist-line-tag" :style="{ left: (activeDist.line70X / 160 * 100) + '%' }">상위 30%</span>
        </div>
      </div>

      <div class="dist-labels-row">
        <span>최소 {{ activeDist.min.toLocaleString() }}{{ activeDistUnit }}</span>
        <span class="dist-avg-val">평균 {{ activeDist.avg.toLocaleString() }}{{ activeDistUnit }}</span>
        <span>최대 {{ activeDist.max.toLocaleString() }}{{ activeDistUnit }}</span>
      </div>
    </div>

    <!-- 네비게이션 헤더 (KH 마크 제거) -->
    <header class="dashboard-header">
      <div class="header-left">
        <h1 class="header-title">김케이 하우스 대시보드</h1>
        <p class="header-desc">공개 총순위 · 역대 전적 · 경기별 결과</p>
      </div>

      <div class="header-actions">
        <button class="btn-action" @click="copyDashboardLink" title="대시보드 링크 복사">
          <span>링크 복사</span>
        </button>
        <button class="btn-action" @click="loadAllData" title="데이터 새로고침">
          <span>새로고침</span>
        </button>
        <button class="btn-action btn-theme" @click="toggleTheme" :title="isDark ? '라이트 모드로 전환' : '다크 모드로 전환'">
          <svg v-if="isDark" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="5"></circle>
            <line x1="12" y1="1" x2="12" y2="3"></line>
            <line x1="12" y1="21" x2="12" y2="23"></line>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
            <line x1="1" y1="12" x2="3" y2="12"></line>
            <line x1="21" y1="12" x2="23" y2="12"></line>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
          </svg>
          <svg v-else width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
          </svg>
        </button>
        <button class="btn-action btn-scorer" @click="handleGoToScorer" title="점수 기록기로 이동">
          <span>점수 기록기</span>
        </button>
        <!-- 우상단 닫기 x 버튼 -->
        <button class="btn-action btn-close-dashboard" @click="handleGoToScorer" title="닫기 (점수 기록기로 돌아가기)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    </header>

    <!-- 탭 네비게이션 (종합 랭킹 & 스탯) -->
    <nav class="tabs-nav">
      <button 
        class="tab-btn" 
        :class="{ active: activeTab === 'ranking' }" 
        @click="activeTab = 'ranking'"
      >
        종합 랭킹 & 스탯
      </button>
      <button 
        class="tab-btn" 
        :class="{ active: activeTab === 'matrix' }" 
        @click="activeTab = 'matrix'"
      >
        역대 회차별 전적
      </button>
      <button 
        class="tab-btn" 
        :class="{ active: activeTab === 'sessions' }" 
        @click="activeTab = 'sessions'"
      >
        회차별 경기 상세
      </button>
    </nav>

    <!-- 로딩 상태 -->
    <div v-if="isLoading" class="loading-state">
      <div class="spinner"></div>
      <p>통계 데이터를 불러오는 중입니다...</p>
    </div>

    <!-- 에러 상태 -->
    <div v-else-if="errorMessage" class="error-state">
      <p class="error-title">데이터를 불러오지 못했습니다</p>
      <p class="error-detail">{{ errorMessage }}</p>
      <button class="btn-retry" @click="loadAllData">다시 시도</button>
    </div>

    <!-- 메인 콘텐츠 영역 -->
    <main v-else class="dashboard-content">
      <!-- ============================================== -->
      <!-- TAB 1: 종합 랭킹 & 스탯                        -->
      <!-- ============================================== -->
      <section v-if="activeTab === 'ranking'" class="tab-ranking">
        <!-- 포디움 (Top 3 하이라이트) -->
        <div v-if="podiumTop3.length >= 3 && !searchQuery" class="podium-section">
          <!-- 2위 (은) -->
          <div class="podium-card silver" @click="selectedPlayer = podiumTop3[1]">
            <div class="podium-badge">2위</div>
            <div class="podium-name">{{ podiumTop3[1].name }}</div>
            <div class="podium-uma" :class="podiumTop3[1].totalUma >= 0 ? 'pos' : 'neg'">
              {{ podiumTop3[1].totalUma > 0 ? '+' : '' }}{{ podiumTop3[1].totalUma }}pt
            </div>
            <div class="podium-sub">
              <span>평균우마 {{ podiumTop3[1].avgUma > 0 ? '+' : '' }}{{ podiumTop3[1].avgUma }}pt</span>
              <span>평균 {{ podiumTop3[1].avgRank }}위 · {{ podiumTop3[1].totalGames }}전 ({{ podiumTop3[1].top2Rate }}%)</span>
            </div>
          </div>

          <!-- 1위 (금) -->
          <div class="podium-card gold" @click="selectedPlayer = podiumTop3[0]">
            <div class="podium-badge gold-badge">1위</div>
            <div class="podium-name">{{ podiumTop3[0].name }}</div>
            <div class="podium-uma" :class="podiumTop3[0].totalUma >= 0 ? 'pos' : 'neg'">
              {{ podiumTop3[0].totalUma > 0 ? '+' : '' }}{{ podiumTop3[0].totalUma }}pt
            </div>
            <div class="podium-sub">
              <span>평균우마 {{ podiumTop3[0].avgUma > 0 ? '+' : '' }}{{ podiumTop3[0].avgUma }}pt</span>
              <span>평균 {{ podiumTop3[0].avgRank }}위 · {{ podiumTop3[0].totalGames }}전 ({{ podiumTop3[0].top2Rate }}%)</span>
            </div>
          </div>

          <!-- 3위 (동) -->
          <div class="podium-card bronze" @click="selectedPlayer = podiumTop3[2]">
            <div class="podium-badge">3위</div>
            <div class="podium-name">{{ podiumTop3[2].name }}</div>
            <div class="podium-uma" :class="podiumTop3[2].totalUma >= 0 ? 'pos' : 'neg'">
              {{ podiumTop3[2].totalUma > 0 ? '+' : '' }}{{ podiumTop3[2].totalUma }}pt
            </div>
            <div class="podium-sub">
              <span>평균우마 {{ podiumTop3[2].avgUma > 0 ? '+' : '' }}{{ podiumTop3[2].avgUma }}pt</span>
              <span>평균 {{ podiumTop3[2].avgRank }}위 · {{ podiumTop3[2].totalGames }}전 ({{ podiumTop3[2].top2Rate }}%)</span>
            </div>
          </div>
        </div>

        <!-- 검색 & 컨트롤 바 -->
        <div class="table-controls">
          <div class="search-box">
            <svg class="search-icon-svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input 
              type="text" 
              v-model="searchQuery" 
              placeholder="플레이어 이름 검색..." 
              class="search-input"
            />
          </div>
          <div class="sort-selector">
            <label>정렬:</label>
            <select v-model="sortKey" @change="sortOrder = (sortKey === 'avgRank') ? 'asc' : 'desc'" class="sort-dropdown">
              <option value="totalUma">누적 우마순</option>
              <option value="avgUma">평균 우마순</option>
              <option value="avgRank">평균 순위순</option>
              <option value="totalGames">대국수순</option>
              <option value="top2Rate">연대율순</option>
            </select>
          </div>
        </div>

        <!-- 랭킹 테이블 (화료율/방총율 등 삭제, 평균우마 추가, 순위분포 옆 비율 표시) -->
        <div class="table-container">
          <table class="stats-table">
            <thead>
              <tr>
                <th class="col-rank">순위</th>
                <th class="col-name">이름</th>
                <th class="col-sortable" @click="handleSort('totalUma')">
                  누적 우마
                  <span class="sort-mark" v-if="sortKey === 'totalUma'">{{ sortOrder === 'desc' ? '▼' : '▲' }}</span>
                </th>
                <th class="col-sortable" @click="handleSort('avgUma')">
                  평균 우마
                  <span class="sort-mark" v-if="sortKey === 'avgUma'">{{ sortOrder === 'desc' ? '▼' : '▲' }}</span>
                </th>
                <th class="col-sortable" @click="handleSort('totalGames')">대국수</th>
                <th class="col-sortable" @click="handleSort('top2Rate')">연대율</th>
                <th class="col-sortable" @click="handleSort('avgRank')">
                  평균 순위
                  <span class="sort-mark" v-if="sortKey === 'avgRank'">{{ sortOrder === 'asc' ? '▲' : '▼' }}</span>
                </th>
                <th class="col-ranks-dist-th">
                  <div class="dist-th-wrapper">
                    <span class="dist-th-title">순위 분포 &amp; 비율</span>
                    <div class="dist-badge-wrapper dist-th-badges">
                      <div class="dist-badge r1 dist-header-badge" title="1위 분포">1등</div>
                      <div class="dist-badge r2 dist-header-badge" title="2위 분포">2등</div>
                      <div class="dist-badge r3 dist-header-badge" title="3위 분포">3등</div>
                      <div class="dist-badge r4 dist-header-badge" title="4위 분포">4등</div>
                    </div>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr 
                v-for="member in filteredStats" 
                :key="member.name"
                class="member-row"
                @click="selectedPlayer = member"
                title="클릭 시 상세 스탯 & 연속 히스토그램 조회"
              >
                <td class="col-rank">
                  <span class="rank-badge" :class="getRankClass(member.overallRank)">{{ member.overallRank }}</span>
                </td>
                <td class="col-name">
                  <strong>{{ member.name }}</strong>
                </td>
                <td class="col-uma" :class="member.totalUma >= 0 ? 'pos' : 'neg'">
                  {{ member.totalUma > 0 ? '+' : '' }}{{ member.totalUma.toFixed(1) }}
                </td>
                <td :class="member.avgUma >= 0 ? 'pos' : 'neg'">
                  {{ member.avgUma > 0 ? '+' : '' }}{{ member.avgUma.toFixed(1) }}
                </td>
                <td>{{ member.totalGames }}전</td>
                <td>{{ member.top2Rate.toFixed(1) }}%</td>
                <td>{{ member.avgRank.toFixed(2) }}위</td>
                <!-- 순위 분포 뱃지 및 비율 작게 표시 -->
                <td class="col-ranks-dist">
                  <div class="dist-badge-wrapper">
                    <div class="dist-badge r1" :title="'1위 ' + member.rank1Count + '회'">
                      <span class="dist-cnt">{{ member.rank1Count }}</span>
                      <span class="dist-pct">({{ getDistPct(member.rank1Count, member.totalGames) }}%)</span>
                    </div>
                    <div class="dist-badge r2" :title="'2위 ' + member.rank2Count + '회'">
                      <span class="dist-cnt">{{ member.rank2Count }}</span>
                      <span class="dist-pct">({{ getDistPct(member.rank2Count, member.totalGames) }}%)</span>
                    </div>
                    <div class="dist-badge r3" :title="'3위 ' + member.rank3Count + '회'">
                      <span class="dist-cnt">{{ member.rank3Count }}</span>
                      <span class="dist-pct">({{ getDistPct(member.rank3Count, member.totalGames) }}%)</span>
                    </div>
                    <div class="dist-badge r4" :title="'4위 ' + member.rank4Count + '회'">
                      <span class="dist-cnt">{{ member.rank4Count }}</span>
                      <span class="dist-pct">({{ getDistPct(member.rank4Count, member.totalGames) }}%)</span>
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- ============================================== -->
      <!-- TAB 2: 역대 회차 전적 ('통계' 시트)            -->
      <!-- ============================================== -->
      <section v-else-if="activeTab === 'matrix'" class="tab-matrix">
        <div class="matrix-controls-bar">
          <div class="matrix-info-text">
            구글 스프레드시트 <strong>'통계'</strong> 탭의 전 회차 우마 기록입니다. 상단 회차명을 누르면 경기 상세로, 선수명을 누르면 개인 상세 스탯으로 이동합니다.
          </div>
          <div class="search-box">
            <svg class="search-icon-svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input 
              type="text" 
              v-model="matrixSearchQuery" 
              placeholder="플레이어 검색..." 
              class="search-input"
            />
          </div>
        </div>

        <div v-if="!statsMatrix" class="matrix-empty">
          통계 시트 데이터를 불러올 수 없습니다.
        </div>
        <div v-else class="matrix-table-container">
          <table class="matrix-table">
            <thead>
              <tr>
                <th class="matrix-col-sticky-name">이름</th>
                <th class="matrix-col-sticky-total">총합</th>
                <th 
                  v-for="sess in statsMatrix.sessions" 
                  :key="sess"
                  class="matrix-session-col-header"
                  @click="navigateToSession(sess)"
                  title="해당 회차 경기 상세 보기"
                >
                  <div class="session-col-name">{{ sess }}</div>
                  <div v-if="statsMatrix.sessionLabels[sess]" class="session-col-games">{{ statsMatrix.sessionLabels[sess] }}</div>
                </th>
                <th class="matrix-col-sticky-name-right">이름</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="player in filteredMatrixRows" :key="player.name" class="matrix-player-row">
                <td class="matrix-col-sticky-name" @click="openPlayerByName(player.name)" title="상세 스탯 보기">
                  <strong>{{ player.name }}</strong>
                </td>
                <td class="matrix-col-sticky-total" :class="player.total >= 0 ? 'pos' : 'neg'">
                  {{ player.total > 0 ? '+' : '' }}{{ player.total.toFixed(1) }}
                </td>
                <td 
                  v-for="sess in statsMatrix.sessions" 
                  :key="sess"
                  class="matrix-cell-score"
                  :class="getMatrixScoreClass(player.sessionUmas[sess])"
                >
                  {{ formatMatrixScore(player.sessionUmas[sess]) }}
                </td>
                <td class="matrix-col-sticky-name-right" @click="openPlayerByName(player.name)" title="상세 스탯 보기">
                  <strong>{{ player.name }}</strong>
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <th class="matrix-col-sticky-name">이름</th>
                <th class="matrix-col-sticky-total">총합</th>
                <th 
                  v-for="sess in statsMatrix.sessions" 
                  :key="'foot-' + sess"
                  class="matrix-session-col-header"
                  @click="navigateToSession(sess)"
                  title="해당 회차 경기 상세 보기"
                >
                  <div class="session-col-name">{{ sess }}</div>
                  <div v-if="statsMatrix.sessionLabels[sess]" class="session-col-games">{{ statsMatrix.sessionLabels[sess] }}</div>
                </th>
                <th class="matrix-col-sticky-name-right">이름</th>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <!-- ============================================== -->
      <!-- TAB 3: 회차별 경기 상세 (1~15회 지원)          -->
      <!-- ============================================== -->
      <section v-else-if="activeTab === 'sessions'" class="tab-sessions">
        <!-- 회차 선택 셀렉터 -->
        <div class="session-picker-bar">
          <label class="session-label">회차 선택:</label>
          <select v-model="selectedSession" class="session-select">
            <option v-for="s in availableSessions" :key="s" :value="s">
              {{ s }} {{ s === availableSessions[0] ? '(최신)' : '' }}
            </option>
          </select>
        </div>

        <div v-if="isLoadingSession" class="loading-session">
          <div class="spinner-small"></div>
          <span>{{ selectedSession }} 데이터를 조회하는 중...</span>
        </div>

        <div v-else-if="currentSessionDetail" class="session-content">
          <!-- 회차 최종 순위표 -->
          <div class="section-card">
            <h3 class="card-title">{{ currentSessionDetail.sessionName }} 최종 순위</h3>
            <div class="session-members-grid">
              <div 
                v-for="(m, idx) in currentSessionDetail.members" 
                :key="m.name" 
                class="session-member-card"
                @click="openPlayerByName(m.name)"
                title="상세 스탯 보기"
              >
                <div class="sm-rank-badge" :class="getRankClass(idx + 1)">{{ idx + 1 }}위</div>
                <div class="sm-info">
                  <div class="sm-name">{{ m.name }}</div>
                  <div class="sm-sub">{{ m.totalGames }}경기 / 평균 {{ m.avgRank }}위</div>
                </div>
                <div class="sm-uma" :class="m.totalUma >= 0 ? 'pos' : 'neg'">
                  {{ m.totalUma > 0 ? '+' : '' }}{{ m.totalUma }}pt
                </div>
              </div>
            </div>
          </div>

          <!-- 회차 누적 우마 변동 추이 꺾은선 차트 -->
          <div class="section-card chart-card">
            <div class="chart-header-row">
              <h3 class="card-title">{{ currentSessionDetail.sessionName }} 누적 우마 변동 추이</h3>
              <span class="chart-sub-info">0국부터 각 경기 종료 시점까지의 누적 성적</span>
            </div>
            <div class="session-chart-wrapper">
              <LineChart 
                v-if="sessionChartData.datasets.length > 0" 
                :data="sessionChartData" 
                :options="sessionChartOptions" 
              />
              <div v-else class="empty-chart-text">
                대국 기록이 없어 차트를 표시할 수 없습니다.
              </div>
            </div>
          </div>

          <!-- 국별/경기별 상세 카드 리스트 -->
          <div class="section-card">
            <h3 class="card-title">진행 경기 상세 (총 {{ currentSessionDetail.games.length }}경기)</h3>
            <div class="games-list">
              <div 
                v-for="game in currentSessionDetail.games" 
                :key="game.gameId" 
                class="game-card"
              >
                <div class="game-card-header">
                  <span class="game-index">{{ game.gameIndex }}경기</span>
                  <span class="game-time">{{ game.time }}</span>
                </div>
                <div class="game-players-grid">
                  <div 
                    v-for="p in game.players" 
                    :key="p.seat + p.name" 
                    class="game-player-item"
                    :class="'item-rank-' + p.rank"
                  >
                    <div class="gp-rank">{{ p.rank }}위</div>
                    <div class="gp-seat" :class="{ 'is-east': p.seat === '東' }">{{ p.seat }}</div>
                    <div class="gp-name">{{ p.name }}</div>
                    <div class="gp-score">{{ p.score.toLocaleString() }}점</div>
                    <div class="gp-uma" :class="p.uma >= 0 ? 'pos' : 'neg'">
                      {{ p.uma > 0 ? '+' : '' }}{{ p.uma }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>

    <!-- ============================================== -->
    <!-- 플레이어 상세 정보 모달 (ModalStats.vue UI 완벽 일치) -->
    <!-- ============================================== -->
    <Transition name="modal-fade">
      <div v-if="selectedPlayer" class="player-modal-overlay" @click.self="selectedPlayer = null">
        <div class="player-modal-card modal_content">
          <div class="container_stats_modal">
            <!-- 모달 헤더: 플레이어 셀렉터 및 닫기 버튼 -->
            <div class="modal-header">
              <div class="player_selector_container">
                <label for="modalPlayerSelect" class="selector_label">대상 플레이어:</label>
                <select 
                  id="modalPlayerSelect" 
                  :value="selectedPlayer.name" 
                  @change="openPlayerByName(($event.target as HTMLSelectElement).value)"
                  class="player_select"
                >
                  <option v-for="m in allStats" :key="m.name" :value="m.name">
                    {{ m.name }} ({{ m.totalUma > 0 ? '+' : '' }}{{ m.totalUma }}pt)
                  </option>
                </select>
              </div>
              <button class="btn-close" @click="selectedPlayer = null" title="닫기">✕</button>
            </div>

            <!-- 세부 스탯 안내 문구 -->
            <div class="modal_notice_text">
              ※ 제9회부터의 기록이 반영되어 있으며, 초기 오류로 세부 스탯이 기록되지 못한 일부 경기는 제외되어 있습니다.<br />
              ※ 종합 대국 수(세부 스탯 집계 대국 수) 형식으로 표기됩니다.
            </div>

            <!-- 4개 탭 메뉴: 기본 / 리치 스탯 / 그 외 / 순위 비율 -->
            <div class="tab_menu">
              <button 
                class="tab_btn" 
                :class="{ active: modalActiveTab === 'basic' }" 
                @click="modalActiveTab = 'basic'"
              >
                기본
              </button>
              <button 
                class="tab_btn" 
                :class="{ active: modalActiveTab === 'riichi' }" 
                @click="modalActiveTab = 'riichi'"
              >
                리치 스탯
              </button>
              <button 
                class="tab_btn" 
                :class="{ active: modalActiveTab === 'other' }" 
                @click="modalActiveTab = 'other'"
              >
                그 외
              </button>
              <button 
                class="tab_btn" 
                :class="{ active: modalActiveTab === 'rank' }" 
                @click="modalActiveTab = 'rank'"
              >
                순위 비율
              </button>
            </div>

            <!-- 스탯 데이터 테이블 -->
            <div class="stats_content">
              <div class="stats_list">
                <!-- 1. 기본 탭 (4열 그리드) -->
                <div v-if="modalActiveTab === 'basic'" class="stats_group">
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'totalGames', '기록 대국 수', displayPlayerStats.totalGames, true, '전')" 
                @mouseleave="onLeaveMetric"
              >
                <span class="stat_label">기록 대국 수</span>
                <span class="stat_value">{{ formatDualMetric(selectedPlayer?.totalGames, displayPlayerStats.totalGames) }}전</span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'totalUma', '누적 우마', displayPlayerStats.totalUma, true, 'pt')" 
                @mouseleave="onLeaveMetric"
              >
                <span class="stat_label">누적 우마</span>
                <span class="stat_value" :class="(selectedPlayer?.totalUma || 0) >= 0 ? 'text_positive' : 'text_negative'">
                  {{ formatDualMetric(selectedPlayer?.totalUma, displayPlayerStats.totalUma, 1, true) }}pt
                </span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'avgUma', '평균 우마', displayPlayerStats.avgUma, true, 'pt')" 
                @mouseleave="onLeaveMetric"
              >
                <span class="stat_label">평균 우마</span>
                <span class="stat_value" :class="(selectedPlayer?.avgUma || 0) >= 0 ? 'text_positive' : 'text_negative'">
                  {{ formatDualMetric(selectedPlayer?.avgUma, displayPlayerStats.avgUma, 1, true) }}pt
                </span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'avgRank', '평균 순위', displayPlayerStats.avgRank, false, '위')" 
                @mouseleave="onLeaveMetric"
              >
                <span class="stat_label">평균 순위</span>
                <span class="stat_value highlight">{{ formatDualMetric(selectedPlayer?.avgRank, displayPlayerStats.avgRank, 2) }}위</span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'top2Rate', '연대율', displayPlayerStats.top2Rate, true, '%')" 
                @mouseleave="onLeaveMetric"
              >
                <span class="stat_label">연대율 (1·2위)</span>
                <span class="stat_value">{{ formatDualMetric(selectedPlayer?.top2Rate, displayPlayerStats.top2Rate, 1) }}%</span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'winRate', '화료율', displayPlayerStats.winRate, true, '%')" 
                @mouseleave="onLeaveMetric"
              >
                <span class="stat_label">화료율</span>
                <span class="stat_value">{{ displayPlayerStats.winRate }}%</span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'dealInRate', '방총률', displayPlayerStats.dealInRate, false, '%')" 
                @mouseleave="onLeaveMetric"
              >
                <span class="stat_label">방총률</span>
                <span class="stat_value text_negative">{{ displayPlayerStats.dealInRate }}%</span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'tsumoRate', '쯔모율', displayPlayerStats.tsumoRate, true, '%')" 
                @mouseleave="onLeaveMetric"
              >
                <span class="stat_label">쯔모율</span>
                <span class="stat_value">{{ displayPlayerStats.tsumoRate }}%</span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'riichiRate', '리치율', displayPlayerStats.riichiRate, true, '%')" 
                @mouseleave="onLeaveMetric"
              >
                <span class="stat_label">리치율</span>
                <span class="stat_value">{{ displayPlayerStats.riichiRate }}%</span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'drawRate', '유국률', displayPlayerStats.drawRate, false, '%')" 
                @mouseleave="onLeaveMetric"
                @click.stop="onHoverMetric($event, 'drawRate', '유국률', displayPlayerStats.drawRate, false, '%')"
              >
                <span class="stat_label">유국률</span>
                <span class="stat_value">{{ displayPlayerStats.drawRate }}%</span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'drawTenpaiRate', '유국 텐파이율', displayPlayerStats.drawTenpaiRate, true, '%')" 
                @mouseleave="onLeaveMetric"
                @click.stop="onHoverMetric($event, 'drawTenpaiRate', '유국 텐파이율', displayPlayerStats.drawTenpaiRate, true, '%')"
              >
                <span class="stat_label">유국 텐파이율</span>
                <span class="stat_value">{{ displayPlayerStats.drawTenpaiRate }}%</span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'avgWinScore', '평균 화료 점수', displayPlayerStats.avgWinScore, true, '점')" 
                @mouseleave="onLeaveMetric"
              >
                <span class="stat_label">평균 화료 점수</span>
                <span class="stat_value text_positive">{{ displayPlayerStats.avgWinScore.toLocaleString() }}점</span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'avgDealInScore', '평균 방총 점수', displayPlayerStats.avgDealInScore, false, '점')" 
                @mouseleave="onLeaveMetric"
              >
                <span class="stat_label">평균 방총 점수</span>
                <span class="stat_value text_negative">{{ displayPlayerStats.avgDealInScore.toLocaleString() }}점</span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'tobiRate', '토비율', displayPlayerStats.tobiRate, false, '%')" 
                @mouseleave="onLeaveMetric"
              >
                <span class="stat_label">토비율 (들통)</span>
                <span class="stat_value text_negative">{{ displayPlayerStats.tobiRate }}%</span>
              </div>
            </div>

            <!-- 2. 리치 스탯 탭 -->
            <div v-else-if="modalActiveTab === 'riichi'" class="stats_group">
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'riichiRate', '리치율', displayPlayerStats.riichiRate, true, '%')" 
                @mouseleave="onLeaveMetric"
                @click.stop="onHoverMetric($event, 'riichiRate', '리치율', displayPlayerStats.riichiRate, true, '%')"
              >
                <span class="stat_label">리치율</span>
                <span class="stat_value">{{ displayPlayerStats.riichiRate }}%</span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'riichiWinRate', '리치 화료율', displayPlayerStats.riichiWinRate, true, '%')" 
                @mouseleave="onLeaveMetric"
                @click.stop="onHoverMetric($event, 'riichiWinRate', '리치 화료율', displayPlayerStats.riichiWinRate, true, '%')"
              >
                <span class="stat_label">리치 화료율</span>
                <span class="stat_value text_positive">{{ displayPlayerStats.riichiWinRate }}%</span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'riichiDealInRate', '리치 방총율', displayPlayerStats.riichiDealInRate, false, '%')" 
                @mouseleave="onLeaveMetric"
                @click.stop="onHoverMetric($event, 'riichiDealInRate', '리치 방총율', displayPlayerStats.riichiDealInRate, false, '%')"
              >
                <span class="stat_label">리치 방총율</span>
                <span class="stat_value text_negative">{{ displayPlayerStats.riichiDealInRate }}%</span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'riichiDrawRate', '리치 유국률', displayPlayerStats.riichiDrawRate, false, '%')" 
                @mouseleave="onLeaveMetric"
                @click.stop="onHoverMetric($event, 'riichiDrawRate', '리치 유국률', displayPlayerStats.riichiDrawRate, false, '%')"
              >
                <span class="stat_label">리치 유국률</span>
                <span class="stat_value">{{ displayPlayerStats.riichiDrawRate }}%</span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'riichiEV', '리치 수지', displayPlayerStats.riichiEV, true, '점')" 
                @mouseleave="onLeaveMetric"
                @click.stop="onHoverMetric($event, 'riichiEV', '리치 수지', displayPlayerStats.riichiEV, true, '점')"
              >
                <span class="stat_label">리치 수지</span>
                <span class="stat_value" :class="displayPlayerStats.riichiEV >= 0 ? 'text_positive' : 'text_negative'">
                  {{ displayPlayerStats.riichiEV > 0 ? '+' : '' }}{{ displayPlayerStats.riichiEV }}점
                </span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'riichiIncomeAvg', '리치 수입 평균', displayPlayerStats.riichiIncomeAvg, true, '점')" 
                @mouseleave="onLeaveMetric"
                @click.stop="onHoverMetric($event, 'riichiIncomeAvg', '리치 수입 평균', displayPlayerStats.riichiIncomeAvg, true, '점')"
              >
                <span class="stat_label">리치 수입 평균</span>
                <span class="stat_value text_positive">+{{ displayPlayerStats.riichiIncomeAvg.toLocaleString() }}점</span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'riichiExpenseAvg', '리치 지출 평균', displayPlayerStats.riichiExpenseAvg, false, '점')" 
                @mouseleave="onLeaveMetric"
                @click.stop="onHoverMetric($event, 'riichiExpenseAvg', '리치 지출 평균', displayPlayerStats.riichiExpenseAvg, false, '점')"
              >
                <span class="stat_label">리치 지출 평균</span>
                <span class="stat_value text_negative">-{{ displayPlayerStats.riichiExpenseAvg.toLocaleString() }}점</span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'firstRiichiRate', '선제율', displayPlayerStats.firstRiichiRate, true, '%')" 
                @mouseleave="onLeaveMetric"
                @click.stop="onHoverMetric($event, 'firstRiichiRate', '선제율', displayPlayerStats.firstRiichiRate, true, '%')"
              >
                <span class="stat_label">선제율</span>
                <span class="stat_value">{{ displayPlayerStats.firstRiichiRate }}%</span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'chaseRiichiRate', '추격률', displayPlayerStats.chaseRiichiRate, true, '%')" 
                @mouseleave="onLeaveMetric"
                @click.stop="onHoverMetric($event, 'chaseRiichiRate', '추격률', displayPlayerStats.chaseRiichiRate, true, '%')"
              >
                <span class="stat_label">추격률</span>
                <span class="stat_value">{{ displayPlayerStats.chaseRiichiRate }}%</span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'chasedRiichiRate', '피추격률', displayPlayerStats.chasedRiichiRate, false, '%')" 
                @mouseleave="onLeaveMetric"
                @click.stop="onHoverMetric($event, 'chasedRiichiRate', '피추격률', displayPlayerStats.chasedRiichiRate, false, '%')"
              >
                <span class="stat_label">피추격률</span>
                <span class="stat_value text_negative">{{ displayPlayerStats.chasedRiichiRate }}%</span>
              </div>
            </div>

            <!-- 3. 그 외 탭 -->
            <div v-else-if="modalActiveTab === 'other'" class="stats_group">
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'oyaKaburiRate', '아픈 오야카부리율', displayPlayerStats.oyaKaburiRate, false, '%')" 
                @mouseleave="onLeaveMetric"
                @click.stop="onHoverMetric($event, 'oyaKaburiRate', '아픈 오야카부리율', displayPlayerStats.oyaKaburiRate, false, '%')"
              >
                <span class="stat_label">아픈 오야카부리율</span>
                <span class="stat_value text_negative">{{ displayPlayerStats.oyaKaburiRate }}%</span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'oyaKaburiAvg', '아픈 오야카부리 평균', displayPlayerStats.oyaKaburiAvg, false, '점')" 
                @mouseleave="onLeaveMetric"
                @click.stop="onHoverMetric($event, 'oyaKaburiAvg', '아픈 오야카부리 평균', displayPlayerStats.oyaKaburiAvg, false, '점')"
              >
                <span class="stat_label">아픈 오야카부리 평균</span>
                <span class="stat_value text_negative">{{ displayPlayerStats.oyaKaburiAvg.toLocaleString() }}점</span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'dealInRiichiRate', '방총 시 리치율', displayPlayerStats.dealInRiichiRate, false, '%')" 
                @mouseleave="onLeaveMetric"
                @click.stop="onHoverMetric($event, 'dealInRiichiRate', '방총 시 리치율', displayPlayerStats.dealInRiichiRate, false, '%')"
              >
                <span class="stat_label">방총 시 리치율</span>
                <span class="stat_value">{{ displayPlayerStats.dealInRiichiRate }}%</span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'winEfficiency', '화료 효율', displayPlayerStats.winEfficiency, true, '')" 
                @mouseleave="onLeaveMetric"
                @click.stop="onHoverMetric($event, 'winEfficiency', '화료 효율', displayPlayerStats.winEfficiency, true, '')"
              >
                <span class="stat_label">화료 효율</span>
                <span class="stat_value text_positive">+{{ displayPlayerStats.winEfficiency }}</span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'dealInLoss', '방총 손실', displayPlayerStats.dealInLoss, false, '')" 
                @mouseleave="onLeaveMetric"
                @click.stop="onHoverMetric($event, 'dealInLoss', '방총 손실', displayPlayerStats.dealInLoss, false, '')"
              >
                <span class="stat_label">방총 손실</span>
                <span class="stat_value text_negative">-{{ displayPlayerStats.dealInLoss }}</span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'netWinEfficiency', '알짜 화료 효율', displayPlayerStats.netWinEfficiency, true, '')" 
                @mouseleave="onLeaveMetric"
                @click.stop="onHoverMetric($event, 'netWinEfficiency', '알짜 화료 효율', displayPlayerStats.netWinEfficiency, true, '')"
              >
                <span class="stat_label">알짜 화료 효율</span>
                <span class="stat_value" :class="displayPlayerStats.netWinEfficiency >= 0 ? 'text_positive' : 'text_negative'">
                  {{ displayPlayerStats.netWinEfficiency > 0 ? '+' : '' }}{{ displayPlayerStats.netWinEfficiency }}
                </span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'handEV', '국수지', displayPlayerStats.handEV, true, '점')" 
                @mouseleave="onLeaveMetric"
                @click.stop="onHoverMetric($event, 'handEV', '국수지', displayPlayerStats.handEV, true, '점')"
              >
                <span class="stat_label">국수지</span>
                <span class="stat_value" :class="displayPlayerStats.handEV >= 0 ? 'text_positive' : 'text_negative'">
                  {{ displayPlayerStats.handEV > 0 ? '+' : '' }}{{ displayPlayerStats.handEV }}점
                </span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'totalRounds', '총합 국 수', displayPlayerStats.totalRounds, true, '국')" 
                @mouseleave="onLeaveMetric"
                @click.stop="onHoverMetric($event, 'totalRounds', '총합 국 수', displayPlayerStats.totalRounds, true, '국')"
              >
                <span class="stat_label">총합 국 수</span>
                <span class="stat_value">{{ displayPlayerStats.totalRounds }}국</span>
              </div>
            </div>

            <!-- 4. 순위 비율 탭 (ModalStats.vue와 완벽 일치하는 SVG 도넛 차트 및 상세 카드) -->
            <div v-else-if="modalActiveTab === 'rank'" class="rank_tab_wrapper">
              <div class="rank_chart_section">
                <!-- SVG 도넛 차트 -->
                <div class="chart_box">
                  <svg viewBox="0 0 200 200" class="donut_svg">
                    <!-- 배경 베이스 링 -->
                    <circle 
                      cx="100" 
                      cy="100" 
                      r="60" 
                      fill="none" 
                      stroke="var(--border-color, rgba(0,0,0,0.08))" 
                      stroke-width="20"
                    />
                    <!-- 조각 링 -->
                    <g transform="rotate(-90 100 100)">
                      <!-- 4위 (빨강) -->
                      <circle 
                        v-if="modalRankStats.p4 > 0"
                        cx="100" cy="100" r="60" 
                        fill="none" 
                        stroke="#ef4444" 
                        stroke-width="20" 
                        :stroke-dasharray="`${(modalRankStats.p4 / 100) * 376.9911} 376.9911`"
                        :stroke-dashoffset="`-${((modalRankStats.p1 + modalRankStats.p2 + modalRankStats.p3) / 100) * 376.9911}`"
                        class="donut_segment"
                        :class="{ active: hoveredRank === 4 }"
                        @mouseenter="hoveredRank = 4"
                        @mouseleave="hoveredRank = null"
                      />
                      <!-- 3위 (노랑/앰버) -->
                      <circle 
                        v-if="modalRankStats.p3 > 0"
                        cx="100" cy="100" r="60" 
                        fill="none" 
                        stroke="#f59e0b" 
                        stroke-width="20" 
                        :stroke-dasharray="`${(modalRankStats.p3 / 100) * 376.9911} 376.9911`"
                        :stroke-dashoffset="`-${((modalRankStats.p1 + modalRankStats.p2) / 100) * 376.9911}`"
                        class="donut_segment"
                        :class="{ active: hoveredRank === 3 }"
                        @mouseenter="hoveredRank = 3"
                        @mouseleave="hoveredRank = null"
                      />
                      <!-- 2위 (청록) -->
                      <circle 
                        v-if="modalRankStats.p2 > 0"
                        cx="100" cy="100" r="60" 
                        fill="none" 
                        stroke="#06b6d4" 
                        stroke-width="20" 
                        :stroke-dasharray="`${(modalRankStats.p2 / 100) * 376.9911} 376.9911`"
                        :stroke-dashoffset="`-${(modalRankStats.p1 / 100) * 376.9911}`"
                        class="donut_segment"
                        :class="{ active: hoveredRank === 2 }"
                        @mouseenter="hoveredRank = 2"
                        @mouseleave="hoveredRank = null"
                      />
                      <!-- 1위 (초록) -->
                      <circle 
                        v-if="modalRankStats.p1 > 0"
                        cx="100" cy="100" r="60" 
                        fill="none" 
                        stroke="#10b981" 
                        stroke-width="20" 
                        :stroke-dasharray="`${(modalRankStats.p1 / 100) * 376.9911} 376.9911`"
                        stroke-dashoffset="0"
                        class="donut_segment"
                        :class="{ active: hoveredRank === 1 }"
                        @mouseenter="hoveredRank = 1"
                        @mouseleave="hoveredRank = null"
                      />
                    </g>
                    <!-- 중앙 텍스트 -->
                    <text x="100" y="90" text-anchor="middle" class="chart_center_label">총 대국</text>
                    <text x="100" y="114" text-anchor="middle" class="chart_center_value">{{ modalRankStats.totalGames }}전</text>
                    <text x="100" y="132" text-anchor="middle" class="chart_center_sub">평균 {{ displayPlayerStats.avgRank }}위</text>
                  </svg>
                </div>

                <!-- 순위별 상세 수치 카드 목록 -->
                <div class="rank_details_list">
                  <div 
                    class="rank_detail_card" 
                    :class="{ highlighted: hoveredRank === 1 }"
                    @mouseenter="hoveredRank = 1"
                    @mouseleave="hoveredRank = null"
                  >
                    <div class="rank_card_header">
                      <span class="rank_badge badge_1">1위</span>
                      <span class="rank_count_val">{{ modalRankStats.r1 }}회</span>
                      <span class="rank_percent_val text_rank_1">{{ modalRankStats.p1.toFixed(1) }}%</span>
                    </div>
                    <div class="rank_bar_track">
                      <div class="rank_bar_fill bar_1" :style="{ width: modalRankStats.p1 + '%' }"></div>
                    </div>
                  </div>

                  <div 
                    class="rank_detail_card" 
                    :class="{ highlighted: hoveredRank === 2 }"
                    @mouseenter="hoveredRank = 2"
                    @mouseleave="hoveredRank = null"
                  >
                    <div class="rank_card_header">
                      <span class="rank_badge badge_2">2위</span>
                      <span class="rank_count_val">{{ modalRankStats.r2 }}회</span>
                      <span class="rank_percent_val text_rank_2">{{ modalRankStats.p2.toFixed(1) }}%</span>
                    </div>
                    <div class="rank_bar_track">
                      <div class="rank_bar_fill bar_2" :style="{ width: modalRankStats.p2 + '%' }"></div>
                    </div>
                  </div>

                  <div 
                    class="rank_detail_card" 
                    :class="{ highlighted: hoveredRank === 3 }"
                    @mouseenter="hoveredRank = 3"
                    @mouseleave="hoveredRank = null"
                  >
                    <div class="rank_card_header">
                      <span class="rank_badge badge_3">3위</span>
                      <span class="rank_count_val">{{ modalRankStats.r3 }}회</span>
                      <span class="rank_percent_val text_rank_3">{{ modalRankStats.p3.toFixed(1) }}%</span>
                    </div>
                    <div class="rank_bar_track">
                      <div class="rank_bar_fill bar_3" :style="{ width: modalRankStats.p3 + '%' }"></div>
                    </div>
                  </div>

                  <div 
                    class="rank_detail_card" 
                    :class="{ highlighted: hoveredRank === 4 }"
                    @mouseenter="hoveredRank = 4"
                    @mouseleave="hoveredRank = null"
                  >
                    <div class="rank_card_header">
                      <span class="rank_badge badge_4">4위</span>
                      <span class="rank_count_val">{{ modalRankStats.r4 }}회</span>
                      <span class="rank_percent_val text_rank_4">{{ modalRankStats.p4.toFixed(1) }}%</span>
                    </div>
                    <div class="rank_bar_track">
                      <div class="rank_bar_fill bar_4" :style="{ width: modalRankStats.p4 + '%' }"></div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 연대율 & 라스 회피율 요약 바 -->
              <div class="rank_summary_metrics">
                <div class="summary_metric_box">
                  <span class="metric_label">연대율 (1·2위)</span>
                  <span class="metric_val text_positive">{{ modalRankStats.top2Rate }}</span>
                </div>
                <div class="summary_metric_box">
                  <span class="metric_label">라스 회피율</span>
                  <span class="metric_val text_positive">{{ modalRankStats.lastAvoidRate }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</Transition>
</div>
</template>

<style scoped>
.stats-dashboard-container {
  min-height: 100vh;
  background-color: var(--bg-color, #fcfcfc);
  color: var(--text-color, #1a1a1a);
  font-family: 'Noto Serif KR', 'Noto Serif JP', serif, sans-serif;
  padding: 16px 20px 40px;
  max-width: 1200px;
  margin: 0 auto;
  box-sizing: border-box;
}

/* 토스트 */
.dashboard-toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background-color: rgba(16, 185, 129, 0.95);
  color: #ffffff;
  padding: 10px 20px;
  border-radius: 20px;
  font-size: 14px;
  font-weight: bold;
  z-index: 3000;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}
.toast-fade-enter-active, .toast-fade-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.toast-fade-enter-from, .toast-fade-leave-to {
  opacity: 0;
  transform: translate(-50%, 10px);
}

/* 연속 히스토그램 팝오버 툴팁 (폭 215px 축소 및 50% 절반 구분선 적용) */
.dist-tooltip-popup {
  position: fixed;
  transform: translate(-50%, -100%);
  pointer-events: none;
  z-index: 2500;
  width: 215px;
  background: rgba(15, 23, 42, 0.97);
  color: #f8fafc;
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 10px;
  padding: 10px 12px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.45);
  font-family: inherit;
  transition: opacity 0.15s ease;
}
.dist-tooltip-popup.below {
  transform: translate(-50%, 0);
}
.dist-tooltip-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  margin-bottom: 2px;
}
.dist-title {
  font-weight: bold;
  color: #cbd5e1;
}
.dist-rank-chip {
  font-size: 10px;
  font-weight: bold;
  padding: 1px 5px;
  border-radius: 4px;
}
.dist-rank-chip.pos {
  color: #34d399;
  background: rgba(52, 211, 153, 0.15);
}
.dist-rank-chip.neg {
  color: #f87171;
  background: rgba(248, 113, 113, 0.15);
}
.dist-sub-rank {
  font-size: 10px;
  color: #94a3b8;
  margin-bottom: 4px;
}
.dist-my-val {
  font-size: 11px;
  color: #94a3b8;
  margin-bottom: 5px;
}
.dist-my-val strong {
  color: #ffffff;
  font-size: 12px;
}
.dist-chart-box {
  position: relative;
  width: 100%;
  height: 44px;
  background: rgba(0, 0, 0, 0.25);
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 5px;
}
.dist-chart-labels-overlay {
  position: absolute;
  top: 2px;
  left: 0;
  width: 100%;
  height: 14px;
  pointer-events: none;
}
.dist-line-tag {
  position: absolute;
  transform: translateX(-50%);
  font-size: 8px;
  font-weight: 600;
  color: #cbd5e1;
  white-space: nowrap;
  line-height: 1;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
}
.dist-line-tag.tag-50 {
  color: #ffffff;
  font-weight: 700;
}
.dist-svg {
  width: 100%;
  height: 100%;
  display: block;
}
.dist-labels-row {
  display: flex;
  justify-content: space-between;
  font-size: 9px;
  color: #94a3b8;
}
.dist-avg-val {
  color: #38bdf8;
  font-weight: bold;
}

/* 헤더 */
.dashboard-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding-bottom: 16px;
  border-bottom: 2px solid var(--border-color, #eaeaea);
}
.header-left {
  display: flex;
  flex-direction: column;
}
.header-title {
  font-size: 20px;
  font-weight: bold;
  margin: 0;
  letter-spacing: -0.3px;
}
.header-desc {
  font-size: 12px;
  color: var(--text-dimmed, #666);
  margin-top: 4px;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.btn-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid var(--border-color, #ccc);
  border-radius: 6px;
  background-color: var(--card-bg-color, #fff);
  color: var(--text-color, #1a1a1a);
  cursor: pointer;
  transition: all 0.2s ease;
  height: 32px;
  box-sizing: border-box;
}
.btn-action:hover {
  filter: brightness(0.95);
}
.btn-scorer {
  background-color: var(--color-toggle-on, #3b82f6);
  color: #fff;
  border: none;
}
.btn-scorer:hover {
  filter: brightness(1.1);
}
.btn-theme {
  padding: 0 10px;
}
.btn-close-dashboard {
  background-color: transparent;
  border: 1px solid var(--border-color, #ccc);
  padding: 0 8px;
  color: var(--text-color, #1a1a1a);
  cursor: pointer;
}
.btn-close-dashboard:hover {
  background-color: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  border-color: #ef4444;
}

/* 탭 네비게이션 */
.tabs-nav {
  display: flex;
  gap: 8px;
  margin: 18px 0 22px;
  border-bottom: 1px solid var(--border-color, #eaeaea);
  padding-bottom: 6px;
  overflow-x: auto;
}
.tab-btn {
  padding: 8px 16px;
  font-size: 14px;
  font-weight: bold;
  background: transparent;
  border: none;
  border-bottom: 3px solid transparent;
  color: var(--text-dimmed, #777);
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}
.tab-btn.active {
  color: var(--color-toggle-on, #3b82f6);
  border-bottom-color: var(--color-toggle-on, #3b82f6);
}

/* 로딩 / 에러 */
.loading-state, .error-state {
  text-align: center;
  padding: 60px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}
.spinner {
  width: 40px;
  height: 40px;
  border: 4px solid rgba(0, 0, 0, 0.1);
  border-top-color: var(--color-toggle-on, #3b82f6);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
.spinner-small {
  width: 20px;
  height: 20px;
  border: 3px solid rgba(0, 0, 0, 0.1);
  border-top-color: var(--color-toggle-on, #3b82f6);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  display: inline-block;
  vertical-align: middle;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.btn-retry {
  padding: 8px 16px;
  background-color: var(--color-toggle-on, #3b82f6);
  color: white;
  border: none;
  border-radius: 6px;
  font-weight: bold;
  cursor: pointer;
}

/* 포디움 섹션 */
.podium-section {
  display: flex;
  justify-content: center;
  align-items: flex-end;
  gap: 16px;
  margin-bottom: 24px;
}
.podium-card {
  flex: 1;
  max-width: 210px;
  background: var(--card-bg-color, #ffffff);
  border: 1px solid var(--border-color, #eee);
  border-radius: 12px;
  padding: 16px 12px;
  text-align: center;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
}
.podium-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.1);
}
.podium-card.gold {
  border-top: 4px solid #f59e0b;
  transform: scale(1.05);
}
.podium-card.silver {
  border-top: 4px solid #94a3b8;
}
.podium-card.bronze {
  border-top: 4px solid #b45309;
}
.podium-badge {
  font-size: 11px;
  font-weight: 800;
  margin-bottom: 4px;
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.04);
}
.gold .podium-badge { color: #f59e0b; background: rgba(245, 158, 11, 0.12); }
.silver .podium-badge { color: #64748b; background: rgba(100, 116, 139, 0.12); }
.bronze .podium-badge { color: #b45309; background: rgba(180, 83, 9, 0.12); }

.podium-name {
  font-size: 16px;
  font-weight: bold;
  margin-bottom: 4px;
}
.podium-uma {
  font-size: 18px;
  font-weight: 900;
  margin-bottom: 6px;
}
.podium-sub {
  font-size: 11px;
  color: var(--text-dimmed, #777);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* 컨트롤 바 */
.table-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 12px;
}
.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--card-bg-color, #fff);
  border: 1px solid var(--border-color, #ccc);
  border-radius: 6px;
  padding: 6px 10px;
}
.search-icon-svg {
  color: var(--text-dimmed, #888);
  flex-shrink: 0;
}
.search-input {
  border: none;
  background: transparent;
  color: var(--text-color, #1a1a1a);
  font-size: 13px;
  outline: none;
  font-family: inherit;
}
.sort-selector {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}
.sort-dropdown {
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--border-color, #ccc);
  background: var(--card-bg-color, #fff);
  color: var(--text-color, #1a1a1a);
  font-size: 13px;
  font-family: inherit;
}

/* 테이블 */
.table-container {
  overflow-x: auto;
  border-radius: 8px;
  border: 1px solid var(--border-color, #eee);
  background: var(--card-bg-color, #fff);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}
.stats-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  text-align: center;
  white-space: nowrap;
}
.stats-table th {
  background: rgba(0, 0, 0, 0.03);
  padding: 10px 8px;
  font-weight: bold;
  border-bottom: 2px solid var(--border-color, #eee);
}
.col-sortable {
  cursor: pointer;
  user-select: none;
}
.col-sortable:hover {
  background: rgba(0, 0, 0, 0.06);
}
.sort-mark {
  font-size: 10px;
  margin-left: 2px;
}
.stats-table td {
  padding: 10px 8px;
  border-bottom: 1px solid var(--border-color, #eee);
  vertical-align: middle;
}
.member-row {
  cursor: pointer;
  transition: background 0.15s;
}
.member-row:hover {
  background: rgba(59, 130, 246, 0.05);
}
.rank-badge {
  display: inline-block;
  width: 22px;
  height: 22px;
  line-height: 22px;
  border-radius: 50%;
  font-size: 11px;
  font-weight: bold;
  background: rgba(0, 0, 0, 0.06);
}
.rank-badge.rank-1 { background: #fef3c7; color: #b45309; }
.rank-badge.rank-2 { background: #e2e8f0; color: #475569; }
.rank-badge.rank-3 { background: #ffedd5; color: #9a3412; }

.col-uma {
  font-weight: bold;
}
.pos { color: var(--color-positive, #10b981); }
.neg { color: var(--color-negative, #ef4444); }

.col-ranks-dist {
  text-align: center;
  vertical-align: middle;
}
.dist-badge-wrapper {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
}
.dist-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: bold;
  white-space: nowrap;
}
.dist-badge .dist-label {
  font-size: 10px;
  font-weight: 600;
  opacity: 0.9;
}
.dist-badge .dist-cnt {
  font-weight: bold;
}
.dist-badge .dist-pct {
  font-size: 9.5px;
  opacity: 0.85;
  font-weight: normal;
}
.dist-badge.r1 { background: rgba(16, 185, 129, 0.15); color: #059669; }
.dist-badge.r2 { background: rgba(6, 182, 212, 0.15); color: #0891b2; }
.dist-badge.r3 { background: rgba(245, 158, 11, 0.15); color: #d97706; }
.dist-badge.r4 { background: rgba(239, 68, 68, 0.15); color: #dc2626; }

.col-ranks-dist-th {
  vertical-align: middle;
  padding: 6px 8px;
}
.dist-th-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.dist-th-title {
  font-size: 12px;
  font-weight: bold;
}
.dist-th-badges {
  display: inline-flex;
  gap: 5px;
}
.dist-header-badge {
  padding: 2px 7px;
  font-size: 11px;
  font-weight: bold;
  border-radius: 4px;
}

/* ============================================== */
/* TAB 2: 역대 회차 전적 매트릭스 스타일            */
/* ============================================== */
.matrix-controls-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 14px;
}
.matrix-info-text {
  font-size: 13px;
  color: var(--text-dimmed, #666);
}
.matrix-empty {
  padding: 40px;
  text-align: center;
  color: var(--text-dimmed, #888);
}
.matrix-table-container {
  max-height: 70vh;
  overflow: auto;
  border-radius: 8px;
  border: 1px solid var(--border-color, #eee);
  background: var(--card-bg-color, #fff);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
  scrollbar-color: rgba(100, 116, 139, 0.5) rgba(0, 0, 0, 0.03);
}
.matrix-table-container::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
.matrix-table-container::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.03);
  border-radius: 4px;
}
.matrix-table-container::-webkit-scrollbar-thumb {
  background: rgba(100, 116, 139, 0.4);
  border-radius: 4px;
}
.matrix-table-container::-webkit-scrollbar-thumb:hover {
  background: rgba(100, 116, 139, 0.6);
}
.matrix-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12px;
  text-align: center;
  white-space: nowrap;
}
.matrix-table thead th {
  position: sticky;
  top: 0;
  background: var(--card-bg-color, #fff);
  padding: 8px 10px;
  font-weight: bold;
  border-bottom: 2px solid var(--border-color, #eee);
  border-right: 1px solid var(--border-color, #eee);
  z-index: 15;
}
.matrix-col-sticky-name {
  position: sticky;
  left: 0;
  background-color: var(--card-bg-color, #fff);
  z-index: 10;
  border-right: 2px solid var(--border-color, #eee);
  min-width: 90px;
  text-align: center;
  cursor: pointer;
  padding: 8px 10px;
}
.matrix-col-sticky-total {
  position: sticky;
  left: 90px;
  background-color: var(--card-bg-color, #fff);
  z-index: 10;
  border-right: 2px solid var(--border-color, #eee);
  min-width: 75px;
  font-weight: bold;
  padding: 8px 10px;
}
.matrix-col-sticky-name-right {
  position: sticky;
  right: 0;
  background-color: var(--card-bg-color, #fff);
  z-index: 10;
  border-left: 2px solid var(--border-color, #eee);
  min-width: 90px;
  text-align: center;
  cursor: pointer;
  padding: 8px 10px;
}
.matrix-table thead th.matrix-col-sticky-name,
.matrix-table thead th.matrix-col-sticky-total,
.matrix-table thead th.matrix-col-sticky-name-right {
  z-index: 25;
}
.matrix-player-row:hover .matrix-col-sticky-name,
.matrix-player-row:hover .matrix-col-sticky-total,
.matrix-player-row:hover .matrix-col-sticky-name-right {
  background-color: rgba(59, 130, 246, 0.05);
}
.matrix-table tfoot th {
  position: sticky;
  bottom: 0;
  background: var(--card-bg-color, #fff);
  padding: 8px 10px;
  font-weight: bold;
  border-top: 2px solid var(--border-color, #eee);
  border-right: 1px solid var(--border-color, #eee);
  z-index: 15;
}
.matrix-table tfoot th.matrix-col-sticky-name,
.matrix-table tfoot th.matrix-col-sticky-total,
.matrix-table tfoot th.matrix-col-sticky-name-right {
  z-index: 25;
}
.matrix-session-col-header {
  cursor: pointer;
  transition: background 0.15s;
  min-width: 70px;
}
.matrix-session-col-header:hover {
  background-color: rgba(59, 130, 246, 0.1);
  color: var(--color-toggle-on, #3b82f6);
}
.session-col-name {
  font-weight: bold;
}
.session-col-games {
  font-size: 10px;
  color: var(--text-dimmed, #888);
  font-weight: normal;
}
.matrix-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-color, #eee);
  border-right: 1px solid var(--border-color, #eee);
}
.matrix-player-row:hover {
  background: rgba(59, 130, 246, 0.05);
}
.matrix-cell-score.pos {
  font-weight: bold;
}
.matrix-cell-score.neg {
  font-weight: bold;
}
.score-empty {
  color: var(--text-dimmed, #aaa);
}

/* ============================================== */
/* TAB 3: 회차별 경기 상세 & 차트 스타일          */
/* ============================================== */
.session-picker-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
}
.session-label {
  font-weight: bold;
  font-size: 14px;
}
.session-select {
  padding: 8px 14px;
  font-size: 14px;
  font-weight: bold;
  border-radius: 6px;
  border: 1px solid var(--border-color, #ccc);
  background: var(--card-bg-color, #fff);
  color: var(--text-color, #1a1a1a);
  font-family: inherit;
}
.loading-session {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 40px 0;
  color: var(--text-dimmed, #777);
  font-size: 14px;
}
.section-card {
  background: var(--card-bg-color, #fff);
  border: 1px solid var(--border-color, #eee);
  border-radius: 10px;
  padding: 16px;
  margin-bottom: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}
.card-title {
  font-size: 15px;
  font-weight: bold;
  margin-bottom: 14px;
  margin-top: 0;
}
.chart-card {
  padding: 18px;
}
.chart-header-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.chart-sub-info {
  font-size: 11px;
  color: var(--text-dimmed, #888);
}
.session-chart-wrapper {
  width: 100%;
  height: 320px;
  position: relative;
}
.empty-chart-text {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-dimmed, #888);
  font-size: 13px;
}
.session-members-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
}
.session-member-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: rgba(0, 0, 0, 0.02);
  border-radius: 8px;
  cursor: pointer;
  transition: transform 0.15s, background 0.15s;
}
.session-member-card:hover {
  background: rgba(59, 130, 246, 0.06);
  transform: translateY(-2px);
}
.sm-rank-badge {
  font-size: 12px;
  font-weight: bold;
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.06);
}
.sm-info {
  flex: 1;
}
.sm-name {
  font-weight: bold;
  font-size: 14px;
}
.sm-sub {
  font-size: 11px;
  color: var(--text-dimmed, #777);
}
.sm-uma {
  font-size: 15px;
  font-weight: bold;
}

/* 경기 목록 */
.games-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.game-card {
  border: 1px solid var(--border-color, #eee);
  border-radius: 8px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.01);
}
.game-card-header {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-dimmed, #777);
  margin-bottom: 8px;
}
.game-index {
  font-weight: bold;
  color: var(--color-toggle-on, #3b82f6);
}
.game-players-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
@media (max-width: 640px) {
  .game-players-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
.game-player-item {
  display: flex;
  flex-direction: column;
  padding: 8px;
  border-radius: 6px;
  background: var(--card-bg-color, #fff);
  border: 1px solid var(--border-color, #eee);
  text-align: center;
  position: relative;
}
.game-player-item.item-rank-1 {
  border-color: #f59e0b;
  background: rgba(245, 158, 11, 0.04);
}
.gp-rank {
  font-size: 10px;
  font-weight: bold;
  color: var(--text-dimmed, #888);
}
.gp-seat {
  font-size: 11px;
  font-weight: bold;
  color: var(--text-dimmed, #64748b);
}
.gp-seat.is-east {
  color: #ef4444;
}
.gp-name {
  font-weight: bold;
  font-size: 14px;
  margin: 2px 0;
}
.gp-score {
  font-size: 12px;
}
.gp-uma {
  font-size: 13px;
  font-weight: bold;
  margin-top: 2px;
}

/* ============================================== */
/* 플레이어 상세 모달 (ModalStats.vue 구조 일치)   */
/* ============================================== */
.player-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  padding: 16px;
}
.player-modal-card {
  background: var(--bg-modal, #1e1e1e);
  color: var(--text-color, #ffffff);
  border-radius: 12px;
  width: 100%;
  max-width: 740px;
  max-height: 90vh;
  overflow-y: auto;
  padding: 16px 20px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  border: 1px solid var(--border-color, #333);
}

.container_stats_modal {
  --color-rank-1: #28a745;
  --color-rank-2: #17a2b8;
  --color-rank-3: #d97706;
  --color-rank-4: #dc3545;
  width: 100%;
  display: flex;
  flex-direction: column;
  color: var(--text-color);
  font-family: inherit;
  box-sizing: border-box;
}

html.dark .container_stats_modal {
  --color-rank-1: #4ade80;
  --color-rank-2: #38bdf8;
  --color-rank-3: #fbbf24;
  --color-rank-4: #f87171;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  background-color: var(--bg-card, rgba(255, 255, 255, 0.05));
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid var(--border-color, #333);
}
.modal_notice_text {
  font-size: 11.5px;
  color: var(--text-dimmed, #64748b);
  background: rgba(0, 0, 0, 0.03);
  border: 1px dashed var(--border-color, #cbd5e1);
  padding: 7px 12px;
  border-radius: 6px;
  margin-bottom: 12px;
  line-height: 1.45;
}
.player_selector_container {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}
.selector_label {
  font-size: 13px;
  font-weight: bold;
  opacity: 0.85;
}
.player_select {
  padding: 4px 10px;
  font-size: 13px;
  font-weight: bold;
  border-radius: 4px;
  border: 1px solid var(--border-color, #444);
  background: var(--bg-modal, #1e1e1e);
  color: var(--text-color, #fff);
  font-family: inherit;
  cursor: pointer;
}
.player_select option {
  background: var(--bg-modal, #1e1e1e) !important;
  color: var(--text-color, #fff) !important;
}

.btn-close {
  background: transparent;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: var(--text-dimmed, #888);
  padding: 4px 8px;
  transition: color 0.15s;
}
.btn-close:hover {
  color: #ef4444;
}

/* 탭 메뉴 */
.tab_menu {
  display: flex;
  border-bottom: 1px solid var(--border-color, #333);
  margin-bottom: 8px;
}
.tab_btn {
  flex: 1;
  padding: 8px 0;
  background: none;
  border: none;
  font-size: 14px;
  font-weight: bold;
  cursor: pointer;
  color: var(--text-color, #fff);
  opacity: 0.6;
  border-bottom: 2px solid transparent;
  transition: all 0.2s;
  text-align: center;
  font-family: inherit;
}
.tab_btn:hover {
  opacity: 0.85;
}
.tab_btn.active {
  opacity: 1;
  color: var(--color-toggle-on, #4caf50);
  border-bottom-color: var(--color-toggle-on, #4caf50);
}

/* 스탯 목록 4열 그리드 레이아웃 (ModalStats.vue 일치) */
.stats_content {
  width: 100%;
  max-height: 65vh;
  overflow-y: auto;
  padding: 4px 2px;
  box-sizing: border-box;
}

.stats_list {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.stats_group {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  width: 100%;
}

.stat_row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  background-color: var(--bg-modal, #1e1e1e);
  border: 1px solid var(--border-color, #333);
  border-left: 3px solid var(--color-toggle-on, #4caf50);
  border-radius: 4px;
  padding: 6px 10px;
  min-height: 48px;
  box-sizing: border-box;
  width: 100%;
  transition: all 0.15s ease;
}

.stat_row.hoverable {
  cursor: pointer;
}

.stat_row.hoverable:hover {
  background: rgba(76, 175, 80, 0.08);
  border-color: var(--color-toggle-on, #4caf50);
  transform: translateY(-1px);
}

.stat_label {
  font-size: 11px;
  opacity: 0.65;
  margin-bottom: 2px;
  font-weight: 500;
  width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
}

.stat_value {
  font-size: 14px;
  font-weight: 700;
  width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
}

.stat_value.highlight {
  color: var(--color-toggle-on, #4caf50);
}
.text_positive {
  color: #4caf50;
}
.text_negative {
  color: #f44336;
}

@media (max-width: 600px) {
  .player-modal-overlay {
    padding: 6px;
    align-items: center;
  }
  .player-modal-card {
    padding: 12px 8px;
    max-height: 94vh;
    max-height: 94dvh;
    border-radius: 10px;
    width: 100%;
    box-sizing: border-box;
  }
  .stats_content {
    max-height: 72vh;
    max-height: 72dvh;
  }
  .stats_group {
    grid-template-columns: repeat(2, 1fr);
    gap: 6px;
  }
  .stat_row {
    padding: 6px 8px;
    min-height: 44px;
  }
  .stat_label {
    font-size: 10px;
  }
  .stat_value {
    font-size: 13px;
  }
}
@media (max-width: 360px) {
  .stats_group {
    grid-template-columns: 1fr;
  }
}

/* 순위 비율 탭 스타일 */
.rank_tab_wrapper {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 10px 0;
}
.rank_chart_section {
  display: flex;
  align-items: center;
  gap: 20px;
}
@media (max-width: 500px) {
  .rank_chart_section {
    flex-direction: column;
  }
}
.chart_box {
  width: 150px;
  height: 150px;
  flex-shrink: 0;
  margin: 0 auto;
}
.donut_svg {
  width: 100%;
  height: 100%;
}
.donut_segment {
  transition: stroke-width 0.2s, filter 0.2s;
  cursor: pointer;
}
.donut_segment.active {
  stroke-width: 24;
  filter: brightness(1.1);
}
.chart_center_label {
  font-size: 11px;
  fill: var(--text-dimmed, #777);
  font-weight: 500;
}
.chart_center_value {
  font-size: 16px;
  fill: var(--text-color, #1a1a1a);
  font-weight: bold;
}
.chart_center_sub {
  font-size: 11px;
  fill: var(--color-toggle-on, #3b82f6);
  font-weight: bold;
}

.rank_details_list {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}
.rank_detail_card {
  padding: 6px 10px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.02);
  border: 1px solid var(--border-color, #eee);
  transition: all 0.2s;
}
.rank_detail_card.highlighted {
  border-color: var(--color-toggle-on, #3b82f6);
  background: rgba(59, 130, 246, 0.05);
}
.rank_card_header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  margin-bottom: 4px;
}
.rank_badge {
  font-size: 10px;
  font-weight: bold;
  padding: 1px 6px;
  border-radius: 4px;
  color: #fff;
}
.badge_1 { background: #10b981; }
.badge_2 { background: #06b6d4; }
.badge_3 { background: #f59e0b; }
.badge_4 { background: #ef4444; }

.rank_count_val {
  font-weight: bold;
  font-size: 12px;
}
.rank_percent_val {
  font-weight: bold;
  font-size: 12px;
}
.text_rank_1 { color: #10b981; }
.text_rank_2 { color: #06b6d4; }
.text_rank_3 { color: #f59e0b; }
.text_rank_4 { color: #ef4444; }

.rank_bar_track {
  width: 100%;
  height: 6px;
  background: rgba(0, 0, 0, 0.06);
  border-radius: 3px;
  overflow: hidden;
}
.rank_bar_fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease;
}
.bar_1 { background: #10b981; }
.bar_2 { background: #06b6d4; }
.bar_3 { background: #f59e0b; }
.bar_4 { background: #ef4444; }

.rank_summary_metrics {
  display: flex;
  gap: 12px;
}
.summary_metric_box {
  flex: 1;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.02);
  border-radius: 6px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
}
.metric_label {
  color: var(--text-dimmed, #777);
}
.metric_val {
  font-weight: bold;
}

.modal-fade-enter-active, .modal-fade-leave-active {
  transition: opacity 0.2s ease;
}
.modal-fade-enter-from, .modal-fade-leave-to {
  opacity: 0;
}
</style>
