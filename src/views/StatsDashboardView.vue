<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import ScheduleTab from '@/components/schedule/ScheduleTab.vue';
import RulesTab from '@/components/rules/RulesTab.vue';
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
  fetchSessionDetailedStats,
  fetchPublicStatsMatrix,
  fetchSessionGameDetail,
  calculateSessionUmaTrajectory,
  calculateMetricDistribution,
  fetchPublicRatingTimeline,
  fetchPublicRatingHistoryRecords,
  attachRatingToSessionGames,
  clearPublicStatsCache,
  buildSessionDetailFromRatingHistory,
  computeFrequentOpponentsStats,
  type AllPlayersRatingTrajectory,
  type GameRatingHistoryRecord,
  type OpponentHeadToHeadStat,
  type MemberStatItem,
  type SessionDetail,
  type SessionMemberSummary,
  type SessionGame,
  type GameDetailRecord,
  type GameRoundMovement,
  type StatsMatrixData,
  type StatsMatrixRow,
  type DistributionData
} from '@/services/publicStatsService';
import {
  YAKUMAN_DEFINITIONS,
  NANIKIRU_TAG_DEFINITIONS,
  MAHJONG_TILE_EMOTES,
  MAHJONG_ACTION_EMOTES,
  getMahjongTileImageUrl,
  preloadMahjongTileImages,
  parseRichMahjongText,
  parseMahjongMeldBlocks,
  buildDraggedMeldNotation,
  getEffectiveHighlightComments,
  addHighlightComment,
  updateHighlightComment,
  deleteHighlightComment,
  fetchHighlights,
  createHighlight,
  deleteHighlight,
  updateHighlightMemo,
  updateHighlightRecord,
  getHighlightImageUrl,
  getHighlightThumbnailUrl,
  getHighlightStorageInfo,
  getSavedHighlightPin,
  saveHighlightPin,
  clearHighlightPin,
  verifyHighlightUploadPin,
  fetchHighlightUploadPinAsAdmin,
  updateHighlightUploadPinAsAdmin,
  getMemberAliases,
  resolveMemberCanonicalName,
  isSameOrAliasedMember,
  fetchMemberAliasesFromServer,
  addMemberAliasAsAdmin,
  removeMemberAliasAsAdmin,
  matchHighlightSession,
  computePlayerYakumanStats,
  type HighlightRecord,
  type HighlightCategory,
  type HighlightComment,
  type MahjongTileEmoteDef,
  type MahjongMeldBlock,
  type MemberAliasesMap
} from '@/services/highlightService';
import {
  checkAdminStatus,
  getLastAttendeeName,
  getSavedPins
} from '@/services/scheduleService';
import zoomPlugin from 'chartjs-plugin-zoom';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { getRatingColor, hexToRgba } from '@/utils/ratingEngine';

ChartJS.register(Title, ChartTooltip, Legend, LineElement, LinearScale, PointElement, CategoryScale, zoomPlugin);

const emit = defineEmits<{
  (e: 'go-to-scorer'): void;
}>();

const router = useRouter();
const route = useRoute();

// 탭 상태 타입 및 유효 탭 목록
type DashboardTab = 'ranking' | 'rating' | 'matrix' | 'sessions' | 'gallery' | 'schedule' | 'rules';
const VALID_TABS: DashboardTab[] = ['ranking', 'rating', 'matrix', 'sessions', 'gallery', 'schedule', 'rules'];

// URL 쿼리(?photo=), 경로(/dashboard/gallery/:photoId) 및 해시에서 사진 ID 추출
const parsePhotoIdFromLocation = (): string => {
  if (typeof window !== 'undefined') {
    const searchParams = new URLSearchParams(window.location.search);
    const qPhoto = (searchParams.get('photo') || '').trim();
    if (qPhoto) return qPhoto;

    const pathMatch = window.location.pathname.match(/\/dashboard\/(?:gallery|photo)\/([^/?#]+)/);
    if (pathMatch && pathMatch[1]) {
      return decodeURIComponent(pathMatch[1]).trim();
    }

    const rawHash = window.location.hash.replace(/^#/, '').trim();
    if (rawHash.startsWith('photo=')) {
      return decodeURIComponent(rawHash.slice(6)).trim();
    }
  }
  const routePhoto = (route.query.photo as string) || (route.params.photoId as string) || '';
  return String(routePhoto).trim();
};

// URL 쿼리(?tab=), 경로(/dashboard/:tab) 및 해시(#tab)에서 현재 탭 추출 (사진 ID가 있으면 'gallery', date가 있으면 'schedule')
const parseTabFromLocation = (): DashboardTab => {
  if (typeof window !== 'undefined') {
    const searchParams = new URLSearchParams(window.location.search);
    const qTab = (searchParams.get('tab') || '').trim();
    if (qTab && VALID_TABS.includes(qTab as DashboardTab)) {
      return qTab as DashboardTab;
    }
    const qDate = (searchParams.get('date') || '').trim();
    if (qDate) {
      return 'schedule';
    }

    const pathMatch = window.location.pathname.match(/\/dashboard\/([^/?#]+)/);
    if (pathMatch && pathMatch[1]) {
      const seg = decodeURIComponent(pathMatch[1]).trim();
      if (seg === 'photo') return 'gallery';
      if (VALID_TABS.includes(seg as DashboardTab)) {
        return seg as DashboardTab;
      }
    }

    const rawHash = window.location.hash.replace(/^#/, '').trim();
    if (rawHash && VALID_TABS.includes(rawHash as DashboardTab)) {
      return rawHash as DashboardTab;
    }
  }
  const queryTab = (route.query.tab as string) || (route.params.tab as string);
  if (queryTab && VALID_TABS.includes(queryTab as DashboardTab)) {
    return queryTab as DashboardTab;
  }
  if (route.query.date) {
    return 'schedule';
  }
  if (parsePhotoIdFromLocation()) {
    return 'gallery';
  }
  return 'ranking';
};

// 탭 상태 ('ranking' | 'rating' | 'matrix' | 'sessions' | 'schedule' | 'rules' | 'gallery')
const activeTab = ref<DashboardTab>(parseTabFromLocation());
const pendingUrlPhotoId = ref<string>(parsePhotoIdFromLocation());
const tabsNavRef = ref<HTMLElement | null>(null);
const isDraggingTabsNav = ref(false);
const hasDraggedTabsNav = ref(false);
let tabsNavDragStartX = 0;
let tabsNavStartScrollLeft = 0;
let tabsNavVelocitySamples: { x: number; t: number }[] = [];
let tabsNavInertiaRaf = 0;
let tabsNavResizeObserver: ResizeObserver | null = null;

const tabsNavScrollIndicator = ref({
  visible: false,
  widthPct: 100,
  leftPct: 0,
});

const cancelTabsNavInertia = () => {
  if (tabsNavInertiaRaf) {
    cancelAnimationFrame(tabsNavInertiaRaf);
    tabsNavInertiaRaf = 0;
  }
};

const setScrollIndicatorIfChanged = (
  targetRef: { value: { visible: boolean; widthPct: number; leftPct: number } },
  next: { visible: boolean; widthPct: number; leftPct: number }
) => {
  const prev = targetRef.value;
  if (
    prev.visible === next.visible &&
    Math.abs(prev.widthPct - next.widthPct) < 0.05 &&
    Math.abs(prev.leftPct - next.leftPct) < 0.05
  ) {
    return;
  }
  targetRef.value = next;
};

const updateTabsNavScrollIndicator = () => {
  const el = tabsNavRef.value;
  if (!el) return;
  const sw = el.scrollWidth;
  const cw = el.clientWidth;
  if (cw <= 0 || sw <= cw + 2) {
    setScrollIndicatorIfChanged(tabsNavScrollIndicator, { visible: false, widthPct: 100, leftPct: 0 });
    return;
  }
  const widthPct = Math.max(16, Math.min(100, (cw / sw) * 100));
  const maxScroll = Math.max(1, sw - cw);
  const ratio = Math.max(0, Math.min(1, el.scrollLeft / maxScroll));
  const leftPct = ratio * (100 - widthPct);
  setScrollIndicatorIfChanged(tabsNavScrollIndicator, {
    visible: true,
    widthPct,
    leftPct,
  });
};

const onTabsNavTrackClick = (e: MouseEvent) => {
  const el = tabsNavRef.value;
  const track = e.currentTarget as HTMLElement | null;
  if (!el || !track) return;
  cancelTabsNavInertia();
  const rect = track.getBoundingClientRect();
  if (rect.width <= 0) return;
  const clickRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
  el.scrollTo({
    left: clickRatio * maxScroll,
    behavior: 'smooth',
  });
};

const onTabsNavWindowMouseMove = (e: MouseEvent) => {
  if (!isDraggingTabsNav.value || !tabsNavRef.value) return;
  const now = performance.now();
  const dx = e.clientX - tabsNavDragStartX;
  if (Math.abs(dx) > 4) {
    hasDraggedTabsNav.value = true;
  }
  if (hasDraggedTabsNav.value) {
    tabsNavRef.value.scrollLeft = tabsNavStartScrollLeft - dx;
    updateTabsNavScrollIndicator();
    tabsNavVelocitySamples.push({ x: e.clientX, t: now });
    while (tabsNavVelocitySamples.length > 0 && now - tabsNavVelocitySamples[0].t > 110) {
      tabsNavVelocitySamples.shift();
    }
  }
};

const startTabsNavInertia = (initialVelocityPxPerFrame: number) => {
  cancelTabsNavInertia();
  let velocity = initialVelocityPxPerFrame;
  let lastTime = performance.now();

  const step = (now: number) => {
    const el = tabsNavRef.value;
    if (!el) {
      tabsNavInertiaRaf = 0;
      return;
    }
    const dt = Math.min(34, Math.max(1, now - lastTime));
    lastTime = now;
    const frameScale = dt / 16;

    const prevScroll = el.scrollLeft;
    el.scrollLeft = prevScroll + velocity * frameScale;
    updateTabsNavScrollIndicator();

    // 가속도(관성) 마찰 감속 계수
    velocity *= Math.pow(0.935, frameScale);

    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
    const hitBound =
      (el.scrollLeft <= 0 && velocity < 0) ||
      (el.scrollLeft >= maxScroll && velocity > 0);

    if (Math.abs(velocity) > 0.35 && !hitBound) {
      tabsNavInertiaRaf = requestAnimationFrame(step);
    } else {
      tabsNavInertiaRaf = 0;
    }
  };

  tabsNavInertiaRaf = requestAnimationFrame(step);
};

const onTabsNavWindowMouseUp = (e: MouseEvent) => {
  if (!isDraggingTabsNav.value) return;
  isDraggingTabsNav.value = false;
  window.removeEventListener('mousemove', onTabsNavWindowMouseMove);
  window.removeEventListener('mouseup', onTabsNavWindowMouseUp);

  if (hasDraggedTabsNav.value && tabsNavVelocitySamples.length >= 2) {
    const now = performance.now();
    tabsNavVelocitySamples.push({ x: e.clientX, t: now });
    while (tabsNavVelocitySamples.length > 2 && now - tabsNavVelocitySamples[0].t > 110) {
      tabsNavVelocitySamples.shift();
    }
    const first = tabsNavVelocitySamples[0];
    const last = tabsNavVelocitySamples[tabsNavVelocitySamples.length - 1];
    const dt = last.t - first.t;
    if (dt >= 8 && dt <= 160) {
      const vxPxPerMs = (last.x - first.x) / dt;
      // 마우스 이동 반대 방향으로 scrollLeft가 증가하므로 부호 반전
      const scrollVelocityPerFrame = -vxPxPerMs * 16;
      if (Math.abs(scrollVelocityPerFrame) > 1.8) {
        startTabsNavInertia(scrollVelocityPerFrame);
      }
    }
  }
  tabsNavVelocitySamples = [];

  setTimeout(() => {
    hasDraggedTabsNav.value = false;
  }, 60);
};

const onTabsNavMouseDown = (e: MouseEvent) => {
  // 좌클릭(0) 또는 마우스 중간 휠 버튼(1) 드래그 이동 지원
  if (e.button !== 0 && e.button !== 1) return;
  if (!tabsNavRef.value) return;
  if (tabsNavRef.value.scrollWidth <= tabsNavRef.value.clientWidth + 2) return;
  if (e.button === 1) {
    e.preventDefault();
  }
  cancelTabsNavInertia();
  isDraggingTabsNav.value = true;
  hasDraggedTabsNav.value = false;
  tabsNavDragStartX = e.clientX;
  tabsNavStartScrollLeft = tabsNavRef.value.scrollLeft;
  tabsNavVelocitySamples = [{ x: e.clientX, t: performance.now() }];
  window.addEventListener('mousemove', onTabsNavWindowMouseMove);
  window.addEventListener('mouseup', onTabsNavWindowMouseUp);
};

const onTabsNavClickCapture = (e: MouseEvent) => {
  if (hasDraggedTabsNav.value) {
    e.stopPropagation();
    e.preventDefault();
    hasDraggedTabsNav.value = false;
  }
};

const onTabsNavWheel = (e: WheelEvent) => {
  if (!tabsNavRef.value) return;
  if (tabsNavRef.value.scrollWidth > tabsNavRef.value.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
    e.preventDefault();
    cancelTabsNavInertia();
    tabsNavRef.value.scrollLeft += e.deltaY;
    updateTabsNavScrollIndicator();
  }
};

// 모바일/좁은 화면에서 선택된 탭이 잘리지 않도록 화면 중앙으로 자동 스크롤
const scrollActiveTabIntoView = (smooth = true) => {
  nextTick(() => {
    if (!tabsNavRef.value) return;
    const activeEl = tabsNavRef.value.querySelector('.tab-btn.active') as HTMLElement;
    if (activeEl) {
      activeEl.scrollIntoView({
        behavior: smooth ? 'smooth' : 'auto',
        inline: 'center',
        block: 'nearest'
      });
    }
    setTimeout(() => {
      updateTabsNavScrollIndicator();
    }, smooth ? 260 : 30);
  });
};

watch(activeTab, () => {
  scrollActiveTabIntoView(true);
});

// 대시보드 상대 URL 생성 헬퍼 (?tab= 및 ?photo= 쿼리 방식 사용하여 커뮤니티 # 잘림 방지)
const buildDashboardRelativeUrl = (tab: DashboardTab, photoId?: string | null): string => {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
  const cleanPhotoId = (photoId || '').trim();
  if (cleanPhotoId) {
    return `${base}/dashboard?photo=${encodeURIComponent(cleanPhotoId)}`;
  }
  if (tab === 'ranking') {
    return `${base}/dashboard`;
  }
  return `${base}/dashboard?tab=${encodeURIComponent(tab)}`;
};

// 탭 전환 및 URL 동기화
const switchTab = (tab: DashboardTab, updateUrl = true) => {
  activeTab.value = tab;
  scrollActiveTabIntoView(true);
  if (updateUrl && typeof window !== 'undefined') {
    const activePhotoId = lightboxHighlight.value?.id || pendingUrlPhotoId.value || '';
    const nextUrl = buildDashboardRelativeUrl(tab, activePhotoId || null);
    window.history.replaceState(null, '', nextUrl);
  }
};

const handleLocationChange = () => {
  const current = parseTabFromLocation();
  if (activeTab.value !== current) {
    activeTab.value = current;
    scrollActiveTabIntoView(true);
  }
  const urlPhotoId = parsePhotoIdFromLocation();
  if (!urlPhotoId && lightboxHighlight.value) {
    lightboxHighlight.value = null;
  } else if (urlPhotoId && lightboxHighlight.value?.id !== urlPhotoId) {
    const matched = highlightsList.value.find(h => h.id === urlPhotoId);
    if (matched) {
      openHighlightLightbox(matched, false);
    } else {
      pendingUrlPhotoId.value = urlPhotoId;
    }
  }
};

// 테마 상태 실시간 감지
const isDark = ref(typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : false);
let themeObserver: MutationObserver | null = null;

// 모바일 브라우저 주소창 표시/숨김 전환 시 실제 가시 뷰포트 높이(--vvh) 실시간 동기화
const updateVisualViewportHeight = () => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const vv = window.visualViewport;
  // 핀치 줌 상태(scale > 1.01)에서는 전체 레이아웃 뷰포트 높이를 왜곡하지 않도록 window.innerHeight 사용
  const rawHeight = vv && (!vv.scale || vv.scale <= 1.01) ? vv.height : window.innerHeight;
  if (rawHeight > 0) {
    document.documentElement.style.setProperty('--vvh', `${Math.round(rawHeight)}px`);
  }
};
updateVisualViewportHeight();

onMounted(() => {
  updateVisualViewportHeight();
  if (typeof document !== 'undefined') {
    isDark.value = document.documentElement.classList.contains('dark');
    themeObserver = new MutationObserver(() => {
      isDark.value = document.documentElement.classList.contains('dark');
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  }

  // 브라우저 뒤로가기 / 앞으로가기 및 URL 변경 동기화
  window.addEventListener('hashchange', handleLocationChange);
  window.addEventListener('popstate', handleLocationChange);
  window.addEventListener('resize', updateTabsNavScrollIndicator);
  window.addEventListener('resize', updateVisualViewportHeight);
  window.addEventListener('orientationchange', updateVisualViewportHeight);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateVisualViewportHeight);
    window.visualViewport.addEventListener('scroll', updateVisualViewportHeight);
  }

  if (typeof ResizeObserver !== 'undefined') {
    tabsNavResizeObserver = new ResizeObserver(() => {
      updateTabsNavScrollIndicator();
    });
    if (tabsNavRef.value) {
      tabsNavResizeObserver.observe(tabsNavRef.value);
    }
  }

  // 초기 URL 동기화
  const initial = parseTabFromLocation();
  const initialPhoto = parsePhotoIdFromLocation();
  if (initialPhoto) {
    pendingUrlPhotoId.value = initialPhoto;
  }
  switchTab(initial, initial !== 'ranking' || Boolean(initialPhoto));
  // 마운트 후 초기 활성 탭 스크롤 및 인디케이터 계산
  setTimeout(() => {
    scrollActiveTabIntoView(false);
    updateTabsNavScrollIndicator();
  }, 100);
});

onUnmounted(() => {
  cancelTabsNavInertia();
  if (tabsNavResizeObserver) {
    tabsNavResizeObserver.disconnect();
    tabsNavResizeObserver = null;
  }
  if (themeObserver) {
    themeObserver.disconnect();
    themeObserver = null;
  }
  window.removeEventListener('hashchange', handleLocationChange);
  window.removeEventListener('popstate', handleLocationChange);
  window.removeEventListener('resize', updateTabsNavScrollIndicator);
  window.removeEventListener('resize', updateVisualViewportHeight);
  window.removeEventListener('orientationchange', updateVisualViewportHeight);
  if (window.visualViewport) {
    window.visualViewport.removeEventListener('resize', updateVisualViewportHeight);
    window.visualViewport.removeEventListener('scroll', updateVisualViewportHeight);
  }
  window.removeEventListener('mousemove', onTabsNavWindowMouseMove);
  window.removeEventListener('mouseup', onTabsNavWindowMouseUp);
});

// Vue 라우트 변화 감시
watch(() => [route.hash, route.query.tab, route.query.photo, route.params.tab, route.params.photoId], () => {
  handleLocationChange();
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
type SortKey =
  | 'rating'
  | 'totalUma'
  | 'avgUma'
  | 'avgRank'
  | 'totalGames'
  | 'top2Rate'
  | 'rankDist'
  | 'rank1Rate'
  | 'rank2Rate'
  | 'rank3Rate'
  | 'rank4Rate';
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
const modalActiveTab = ref<'basic' | 'riichi' | 'other' | 'yakuman' | 'rank' | 'rating' | 'opponents'>('basic');
const hoveredRank = ref<number | null>(null);

// 모달 상단 안내 배너 가시성 상태 (새로고침 시 다시 표시)
const isNoticeVisible = ref(true);
const dismissNotice = () => {
  isNoticeVisible.value = false;
};

const getRankRate = (item: MemberStatItem, rank: 1 | 2 | 3 | 4): number => {
  if (!item.totalGames || item.totalGames <= 0) return 0;
  if (rank === 1) return (item.rank1Count || 0) / item.totalGames;
  if (rank === 2) return (item.rank2Count || 0) / item.totalGames;
  if (rank === 3) return (item.rank3Count || 0) / item.totalGames;
  return (item.rank4Count || 0) / item.totalGames;
};

// 1>2>3>4 다단계 순위비율 정렬 비교기 (primaryRank를 우선 비교 후 나머지 순차 비교)
const compareRankDist = (a: MemberStatItem, b: MemberStatItem, primaryRank: 1 | 2 | 3 | 4 = 1): number => {
  const ranksOrder = [primaryRank, 1, 2, 3, 4].filter((v, i, self) => self.indexOf(v) === i) as (1 | 2 | 3 | 4)[];
  for (const r of ranksOrder) {
    const rateA = getRankRate(a, r);
    const rateB = getRankRate(b, r);
    if (Math.abs(rateA - rateB) > 1e-6) {
      return rateA > rateB ? 1 : -1;
    }
  }
  // 비율 모두 동률 시 누적 우마 및 대국수 비교
  if (Math.abs(a.totalUma - b.totalUma) > 1e-4) {
    return a.totalUma > b.totalUma ? 1 : -1;
  }
  return a.totalGames > b.totalGames ? 1 : -1;
};

const filteredStats = computed(() => {
  // 1) 전체 리스트를 현재 정렬 기준에 따라 정렬
  const sorted = [...allStats.value].sort((a, b) => {
    if (sortKey.value === 'rating') {
      const rA = a.rating ?? 0;
      const rB = b.rating ?? 0;
      if (rA !== rB) {
        return sortOrder.value === 'asc' ? rA - rB : rB - rA;
      }
      return sortOrder.value === 'asc' ? a.totalUma - b.totalUma : b.totalUma - a.totalUma;
    }
    if (sortKey.value === 'rankDist' || sortKey.value === 'rank1Rate') {
      const diff = compareRankDist(a, b, 1);
      return sortOrder.value === 'desc' ? -diff : diff;
    }
    if (sortKey.value === 'rank2Rate') {
      const diff = compareRankDist(a, b, 2);
      return sortOrder.value === 'desc' ? -diff : diff;
    }
    if (sortKey.value === 'rank3Rate') {
      const diff = compareRankDist(a, b, 3);
      return sortOrder.value === 'desc' ? -diff : diff;
    }
    if (sortKey.value === 'rank4Rate') {
      const diff = compareRankDist(a, b, 4);
      return sortOrder.value === 'desc' ? -diff : diff;
    }

    const valA = a[sortKey.value] as number;
    const valB = b[sortKey.value] as number;

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

const formatPct = (val: number | undefined): string => {
  if (val === undefined || val === null || isNaN(val)) return '0.00%';
  return Number(val).toFixed(2) + '%';
};

const formatPct5 = (val: number | undefined): string => {
  if (val === undefined || val === null || isNaN(val)) return '0.0000%';
  return Number(val).toFixed(4) + '%';
};

const getDistPct = (count: number, total: number): string => {
  if (total <= 0) return '0.00';
  return ((count / total) * 100).toFixed(2);
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

// 모달 내 순위 비율 도넛 차트 계산 (종합 대국 통계 기준)
const modalRankStats = computed(() => {
  if (!selectedPlayer.value) {
    return { r1: 0, r2: 0, r3: 0, r4: 0, p1: 0, p2: 0, p3: 0, p4: 0, totalGames: 0, top2Rate: '0.00%', lastAvoidRate: '0.00%' };
  }
  // 세부 스탯 집계 대국만이 아닌 종합 대국 통계(종합 랭킹 & 스탯)의 순위 분포 비율 사용
  const m = selectedPlayer.value;
  const tot = m.totalGames;
  const p1 = tot > 0 ? (m.rank1Count / tot) * 100 : 0;
  const p2 = tot > 0 ? (m.rank2Count / tot) * 100 : 0;
  const p3 = tot > 0 ? (m.rank3Count / tot) * 100 : 0;
  const p4 = tot > 0 ? (m.rank4Count / tot) * 100 : 0;
  const top2Rate = tot > 0 ? (((m.rank1Count + m.rank2Count) / tot) * 100).toFixed(2) + '%' : '0.00%';
  const lastAvoidRate = tot > 0 ? (((m.rank1Count + m.rank2Count + m.rank3Count) / tot) * 100).toFixed(2) + '%' : '0.00%';

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

// 도넛 차트 순위별 % 텍스트 위치 계산 헬퍼
function getRankLabelPos(stats: { p1: number; p2: number; p3: number; p4: number }, rank: 1 | 2 | 3 | 4) {
  let midPct = 0;
  if (rank === 1) midPct = stats.p1 / 2;
  else if (rank === 2) midPct = stats.p1 + stats.p2 / 2;
  else if (rank === 3) midPct = stats.p1 + stats.p2 + stats.p3 / 2;
  else if (rank === 4) midPct = stats.p1 + stats.p2 + stats.p3 + stats.p4 / 2;

  const rad = ((midPct / 100) * 360 - 90) * (Math.PI / 180);
  return {
    x: Number((100 + 73 * Math.cos(rad)).toFixed(2)),
    y: Number((100 + 73 * Math.sin(rad)).toFixed(2))
  };
}

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
  const match = displayedAvailableSessions.value.find(s => s.includes(cleaned) || cleaned.includes(s));
  if (match) {
    selectedSession.value = match;
  }
  switchTab('sessions');
};

const formatMatrixScore = (score: number | null | undefined): string => {
  if (score === null || score === undefined) return '-';
  return `${score > 0 ? '+' : ''}${score.toFixed(1)}`;
};

const getMatrixScoreClass = (score: number | null | undefined): string => {
  if (score === null || score === undefined) return 'score-empty';
  return score >= 0 ? 'pos' : 'neg';
};

// 회차별 경기 상세 뷰 스코프 탭 ('session' = 이번 회차, 'all' = 전체 기간)
const sessionScopeTab = ref<'session' | 'all'>('session');

// 모달 진입 맥락 (회차 상세에서 열렸는지 여부)
const isModalFromSession = ref(false);
// 스탯 모달 내부(역만 탭 등)에서 화료 사진 라이트박스를 열었을 때 라이트박스가 스탯 모달 앞에 오도록 제어
const isPlayerModalBehindLightbox = ref(false);

// 모달 스코프 탭 ('session' = 이번 회차, 'all' = 전체 기간)
const modalScopeTab = ref<'session' | 'all'>('all');

const openPlayerModal = (
  player: MemberStatItem,
  fromSession: boolean = false,
  keepScopeTab: boolean = false,
  keepActiveTab: boolean = false
) => {
  isPlayerModalBehindLightbox.value = false;
  selectedPlayer.value = player;
  isModalFromSession.value = fromSession;
  if (!keepScopeTab) {
    modalScopeTab.value = fromSession ? 'session' : 'all';
  }
  if (!keepActiveTab) {
    sessionModalActiveTab.value = 'basic';
    modalActiveTab.value = 'basic';
  }
};

const memberAliasesMap = ref<MemberAliasesMap>(getMemberAliases());

const findMemberStatByName = (name?: string): MemberStatItem | undefined => {
  const clean = (name || '').trim();
  if (!clean) return undefined;
  const exact = allStats.value.find(m => m.name.trim() === clean);
  if (exact) return exact;
  const norm = clean.replace(/★/g, '').trim();
  const normMatch = allStats.value.find(m => m.name.replace(/★/g, '').trim() === norm);
  if (normMatch) return normMatch;

  // 등록된 멤버 동의어(별칭) 기반 공식 멤버 매칭 (예: '따마모크로스' -> '따마모')
  const canonical = resolveMemberCanonicalName(clean, memberAliasesMap.value);
  if (canonical && canonical !== clean) {
    const canonExact = allStats.value.find(m => m.name.trim() === canonical);
    if (canonExact) return canonExact;
    const canonNorm = canonical.replace(/★/g, '').trim();
    return allStats.value.find(m => m.name.replace(/★/g, '').trim() === canonNorm);
  }
  return undefined;
};

const isKnownPlayerName = (name?: string): boolean => {
  void memberAliasesMap.value;
  return Boolean(findMemberStatByName(name));
};

const availableSessions = ref<string[]>([]);

const resolveMatchedSessionName = (rawSessionName?: string): string => {
  const raw = (rawSessionName || '').trim();
  if (!raw) return '';
  const found = availableSessions.value.find(s => matchHighlightSession(s, raw));
  return found || raw;
};

const openPlayerByName = async (
  name: string,
  fromSession: boolean = false,
  keepScopeTab: boolean = false,
  keepActiveTab: boolean = false,
  targetSessionName?: string
) => {
  const clean = (name || '').trim();
  if (!clean) return;

  const rawSess = (targetSessionName || (fromSession && lightboxHighlight.value?.sessionName) || '').trim();
  if (fromSession && rawSess) {
    const matchedSess = resolveMatchedSessionName(rawSess);
    if (matchedSess) {
      if (selectedSession.value !== matchedSess) {
        selectedSession.value = matchedSess;
      }
      if (!currentSessionDetail.value || !matchHighlightSession(currentSessionDetail.value.sessionName, matchedSess)) {
        loadSessionDetail(matchedSess);
      }
    }
  }

  let match = findMemberStatByName(clean);
  if (!match && allStats.value.length === 0) {
    try {
      const loaded = await fetchPublicAllStats();
      if (loaded.length > 0) {
        allStats.value = loaded;
      }
      match = findMemberStatByName(clean);
    } catch {}
  }
  if (match) {
    openPlayerModal(match, fromSession, keepScopeTab, keepActiveTab);
  }
};

// ==========================================
// 3. 회차별 경기 상세 데이터 & 꺾은선 차트
// ==========================================

// 미진행 회차(16~25회) 배제된 실제 노출용 회차 목록
const displayedAvailableSessions = computed(() => {
  if (statsMatrix.value?.sessions && statsMatrix.value.sessions.length > 0) {
    const validSessionNums = new Set(
      statsMatrix.value.sessions.map(s => {
        const m = s.match(/제\d+회/);
        return m ? m[0] : s;
      })
    );
    return availableSessions.value.filter(s => {
      const m = s.match(/제\d+회/);
      return m ? validSessionNums.has(m[0]) : true;
    });
  }
  return availableSessions.value;
});

const selectedSession = ref('');
const currentSessionDetail = ref<SessionDetail | null>(null);
const isLoadingSession = ref(false);

// 유효 회차가 결정되면 selectedSession 자동 동기화 (라이트박스 등에서 이미 선택된 회차가 있으면 매칭 유지)
watch(displayedAvailableSessions, (newSessions) => {
  if (newSessions.length === 0) return;
  if (selectedSession.value) {
    const matched = newSessions.find(s => matchHighlightSession(s, selectedSession.value));
    if (matched) {
      if (selectedSession.value !== matched) {
        selectedSession.value = matched;
      }
      return;
    }
  }
  if (!newSessions.includes(selectedSession.value)) {
    selectedSession.value = newSessions[0];
  }
}, { immediate: true });

const currentSessionDetailedStatsMap = ref<Record<string, MemberStatItem>>({});
const sessionModalActiveTab = ref<'basic' | 'riichi' | 'other' | 'yakuman' | 'rank' | 'rating' | 'opponents'>('basic');
const allRatingHistoryRecords = ref<GameRatingHistoryRecord[]>([]);

watch(modalScopeTab, (newScope) => {
  if (newScope === 'session') {
    sessionModalActiveTab.value = modalActiveTab.value;
  } else {
    modalActiveTab.value = sessionModalActiveTab.value;
  }
});

const loadSessionDetail = async (sessionName: string, forceRefresh: boolean = false) => {
  if (!sessionName) return;

  if (!currentSessionDetail.value || !matchHighlightSession(currentSessionDetail.value.sessionName, sessionName)) {
    currentSessionDetailedStatsMap.value = {};
  }

  // 1) 이미 로드된 캐시 또는 '레이팅 이력'에서 0ms 즉시 렌더링하여 로딩 스피너 대기 제거
  if (!forceRefresh) {
    const optimistic = buildSessionDetailFromRatingHistory(sessionName);
    if (optimistic && optimistic.games.length > 0) {
      currentSessionDetail.value = optimistic;
      isLoadingSession.value = false;
    } else {
      isLoadingSession.value = true;
    }
  } else {
    isLoadingSession.value = !currentSessionDetail.value || !matchHighlightSession(currentSessionDetail.value.sessionName, sessionName);
  }

  // 2) 개인 모달용 국별 상세 통계는 화면 렌더링을 블로킹하지 않고 병렬 백그라운드로 로드
  fetchSessionDetailedStats(sessionName, undefined, forceRefresh)
    .then(detailedMap => {
      if (matchHighlightSession(selectedSession.value, sessionName)) {
        currentSessionDetailedStatsMap.value = detailedMap;
      }
    })
    .catch(err => {
      console.warn("회차 국별 세부 통계 백그라운드 로드 실패:", err);
    });

  try {
    const [detail, historyRecords] = await Promise.all([
      fetchPublicSessionDetail(sessionName, undefined, forceRefresh),
      fetchPublicRatingHistoryRecords(undefined, forceRefresh)
    ]);
    if (historyRecords.length > 0) {
      allRatingHistoryRecords.value = historyRecords;
    }
    if (!matchHighlightSession(selectedSession.value, sessionName)) return;
    if (detail && detail.games && historyRecords.length > 0) {
      attachRatingToSessionGames(sessionName, detail.games, historyRecords);
    }
    if (detail && (detail.games.length > 0 || detail.members.length > 0 || !currentSessionDetail.value)) {
      currentSessionDetail.value = detail;
      // 만약 사용자가 이미 대국 상세 모달을 열어둔 상태에서 세부 국별 데이터가 아직 로드되지 않았다면 실제 대국 객체로 재조회
      if (selectedGameDetail.value && !selectedGameDetail.value.hasRoundDetails && !isLoadingGameDetail.value) {
        const matchedGame = detail.games.find(g => g.gameIndex === selectedGameDetail.value?.gameIndex);
        if (matchedGame) {
          openGameDetailModal(matchedGame, true);
        }
      }
    }
  } catch (err: any) {
    console.error("회차 상세 로드 실패:", err);
  } finally {
    if (matchHighlightSession(selectedSession.value, sessionName)) {
      isLoadingSession.value = false;
    }
  }
};

watch(selectedSession, (newVal) => {
  if (newVal) {
    loadSessionDetail(newVal);
  }
});

// 이번 회차 참가자들의 전체 기간 통산 통계 목록
const sessionMembersAllStats = computed(() => {
  if (!currentSessionDetail.value || !currentSessionDetail.value.members) return [];
  const memberNames = new Set(currentSessionDetail.value.members.map(m => m.name));
  return allStats.value
    .map((m, idx) => ({ ...m, overallRank: idx + 1 }))
    .filter(m => memberNames.has(m.name));
});

// 이번 회차 참가자들의 1~4위 횟수 포함 순위 목록
interface SessionMemberWithRanks extends SessionMemberSummary {
  r1: number;
  r2: number;
  r3: number;
  r4: number;
  top2Rate: number;
  avgUma: number;
  startRating?: number;
  endRating?: number;
  sessionRatingDelta?: number;
}
const sessionMembersWithRanks = computed<SessionMemberWithRanks[]>(() => {
  if (!currentSessionDetail.value) return [];
  const members = currentSessionDetail.value.members;
  const games = currentSessionDetail.value.games;

  return members.map(m => {
    let r1 = 0, r2 = 0, r3 = 0, r4 = 0;
    const playerMatchedGames: { ratingBefore?: number; ratingAfter?: number; ratingDelta?: number }[] = [];
    games.forEach(g => {
      const p = g.players.find(player => player.name === m.name);
      if (p) {
        if (p.rank === 1) r1++;
        else if (p.rank === 2) r2++;
        else if (p.rank === 3) r3++;
        else if (p.rank === 4) r4++;
        playerMatchedGames.push({
          ratingBefore: p.ratingBefore,
          ratingAfter: p.ratingAfter,
          ratingDelta: p.ratingDelta
        });
      }
    });
    const top2Rate = m.totalGames > 0 ? parseFloat((((r1 + r2) / m.totalGames) * 100).toFixed(2)) : 0;
    const avgUma = m.totalGames > 0 ? parseFloat((m.totalUma / m.totalGames).toFixed(1)) : 0;

    let startRating: number | undefined = undefined;
    let endRating: number | undefined = undefined;
    let sessionRatingDelta: number | undefined = undefined;

    if (playerMatchedGames.length > 0) {
      const firstG = playerMatchedGames[0];
      const lastG = playerMatchedGames[playerMatchedGames.length - 1];
      if (firstG.ratingBefore !== undefined && lastG.ratingAfter !== undefined) {
        startRating = firstG.ratingBefore;
        endRating = lastG.ratingAfter;
        sessionRatingDelta = endRating - startRating;
      }
    }

    return {
      ...m,
      r1,
      r2,
      r3,
      r4,
      top2Rate,
      avgUma,
      startRating,
      endRating,
      sessionRatingDelta
    };
  });
});

// 모달에서 선택된 선수의 이번 회차 기본 멤버 정보
const sessionMember = computed(() => {
  if (!selectedPlayer.value) return null;
  return sessionMembersWithRanks.value.find(m => m.name === selectedPlayer.value!.name) || null;
});

// 모달에서 선택된 선수의 이번 회차 성적 (9회차 이후는 전체 세부스탯 객체 반환)
const currentSessionPlayerStats = computed<MemberStatItem | null>(() => {
  if (!selectedPlayer.value || !currentSessionDetail.value) return null;
  const name = selectedPlayer.value.name;

  if (currentSessionDetailedStatsMap.value && currentSessionDetailedStatsMap.value[name]) {
    return currentSessionDetailedStatsMap.value[name];
  }

  const member = currentSessionDetail.value.members.find(m => m.name === name);
  const games = currentSessionDetail.value.games;

  const totalGames = member ? member.totalGames : 0;
  const totalUma = member ? member.totalUma : 0;
  const avgRank = member ? member.avgRank : 0;
  const avgUma = totalGames > 0 ? parseFloat((totalUma / totalGames).toFixed(1)) : 0;

  let r1 = 0, r2 = 0, r3 = 0, r4 = 0;
  games.forEach(g => {
    const p = g.players.find(player => player.name === name);
    if (p) {
      if (p.rank === 1) r1++;
      else if (p.rank === 2) r2++;
      else if (p.rank === 3) r3++;
      else if (p.rank === 4) r4++;
    }
  });

  const top2Rate = totalGames > 0 ? parseFloat((((r1 + r2) / totalGames) * 100).toFixed(2)) : 0;

  return {
    name,
    totalGames,
    totalUma,
    avgUma,
    avgRank,
    top2Rate,
    rank1Count: r1,
    rank2Count: r2,
    rank3Count: r3,
    rank4Count: r4,
    totalRounds: 0,
    winRate: 0,
    dealInRate: 0,
    riichiRate: 0,
    tenpaiRate: 0,
    avgWinScore: 0,
    avgDealInScore: 0,
    handEV: 0,
    winEfficiency: 0,
    dealInLoss: 0,
    netWinEfficiency: 0,
    tsumoRate: 0,
    drawRate: 0,
    drawTenpaiRate: 0,
    tobiRate: 0,
    riichiWinRate: 0,
    riichiDealInRate: 0,
    riichiDrawRate: 0,
    riichiEV: 0,
    riichiIncomeAvg: 0,
    riichiExpenseAvg: 0,
    firstRiichiRate: 0,
    chaseRiichiRate: 0,
    chasedRiichiRate: 0,
    oyaKaburiRate: 0,
    oyaKaburiAvg: 0,
    dealInRiichiRate: 0,
    cheatRate: 0,
    beolbuRate: 0,
    cheatCount: 0,
    beolbuCount: 0,
    totalScore: 0,
  };
});

// 회차 모달 내 순위 비율 도넛 차트 계산
const currentSessionRankStats = computed(() => {
  if (!currentSessionPlayerStats.value) {
    return { r1: 0, r2: 0, r3: 0, r4: 0, p1: 0, p2: 0, p3: 0, p4: 0, totalGames: 0, top2Rate: '0.00%', lastAvoidRate: '0.00%' };
  }
  const s = currentSessionPlayerStats.value;
  const tot = s.totalGames;
  const p1 = tot > 0 ? (s.rank1Count / tot) * 100 : 0;
  const p2 = tot > 0 ? (s.rank2Count / tot) * 100 : 0;
  const p3 = tot > 0 ? (s.rank3Count / tot) * 100 : 0;
  const p4 = tot > 0 ? (s.rank4Count / tot) * 100 : 0;
  return {
    r1: s.rank1Count,
    r2: s.rank2Count,
    r3: s.rank3Count,
    r4: s.rank4Count,
    p1,
    p2,
    p3,
    p4,
    totalGames: tot,
    top2Rate: (p1 + p2).toFixed(2) + '%',
    lastAvoidRate: (100 - p4).toFixed(2) + '%',
  };
});

// 회차 세부 스탯 호버 툴팁 백분위 카드
const onHoverSessionMetric = (
  event: MouseEvent,
  metricKey: keyof MemberStatItem,
  metricName: string,
  currentValue: number,
  higherIsBetter: boolean = true,
  unit: string = ''
) => {
  if (!currentSessionPlayerStats.value) return;
  const sessionMembers = Object.values(currentSessionDetailedStatsMap.value);
  if (sessionMembers.length === 0) return;

  const dist = calculateMetricDistribution(
    sessionMembers,
    metricKey,
    metricName,
    currentValue,
    unit,
    higherIsBetter,
    currentSessionPlayerStats.value.name
  );
  activeDist.value = dist;
  activeDistName.value = metricName;
  activeDistUnit.value = unit;

  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
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
    pointRadius: d.hasMarker ? d.hasMarker.map(m => (m ? 4 : 0)) : 4,
    pointHoverRadius: d.hasMarker ? d.hasMarker.map(m => (m ? 6 : 0)) : 6,
    played: d.played,
    deltas: d.deltas,
    hasMarker: d.hasMarker,
    tension: 0,
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
        color: isDark.value ? '#cbd5e1' : '#334155',
      },
    },
    tooltip: {
      mode: 'index',
      intersect: false,
      callbacks: {
        label: (context) => {
          const val = context.parsed.y;
          if (val === null || val === undefined || isNaN(val)) return '';
          const dataset = context.dataset as any;
          const isPlayed = dataset.played?.[context.dataIndex];
          const delta = dataset.deltas?.[context.dataIndex];

          if (context.dataIndex === 0) {
            return `${dataset.label}: 0.0pt (시작)`;
          }

          if (isPlayed && delta !== null && delta !== undefined) {
            const deltaStr = `${delta > 0 ? '+' : ''}${Number(delta).toFixed(1)}pt`;
            return `${dataset.label}: ${val > 0 ? '+' : ''}${Number(val).toFixed(1)}pt (${deltaStr})`;
          }
          return `${dataset.label}: ${val > 0 ? '+' : ''}${Number(val).toFixed(1)}pt (미참가)`;
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
// 3-1. 회차 대국별 상세 모달 (결과 표 & 점수 변동 차트 & 국별 점수 이동)
// ==========================================
const selectedGameDetail = ref<GameDetailRecord | null>(null);
const gameModalSessionName = ref<string>('');
const gameModalMode = ref<'sheet' | 'chart' | 'rounds'>('sheet');
const gameModalSelectedRound = ref<string>('__all__');
const isLoadingGameDetail = ref(false);
let gameDetailRequestId = 0;

const openGameDetailModal = async (
  game: SessionGame,
  preserveViewState = false,
  overrideSessionName?: string
) => {
  if (!game) return;
  const reqId = ++gameDetailRequestId;
  const targetSession = overrideSessionName || currentSessionDetail.value?.sessionName || selectedSession.value;
  gameModalSessionName.value = targetSession;
  isLoadingGameDetail.value = true;
  if (!preserveViewState) {
    gameModalMode.value = 'sheet';
    gameModalSelectedRound.value = '__all__';
  }

  const seatOrder = ["東", "南", "西", "北"];
  const sortedPlayers = [...game.players].sort((a, b) => {
    return seatOrder.indexOf(a.seat) - seatOrder.indexOf(b.seat);
  });

  // 초기 점수 정보로 즉시 모달 표시 (지연 없는 빠른 인터랙션 제공)
  selectedGameDetail.value = {
    gameId: game.gameId,
    gameIndex: game.gameIndex,
    time: game.time,
    hasRoundDetails: false,
    playerStats: sortedPlayers.map((p, idx) => ({
      seat: p.seat || seatOrder[idx],
      name: p.name,
      rank: p.rank,
      score: p.score,
      uma: p.uma,
      ratingBefore: p.ratingBefore,
      ratingAfter: p.ratingAfter,
      ratingDelta: p.ratingDelta,
      cntRiichi: 0,
      cntRon: 0,
      cntTsumo: 0,
      cntLose: 0,
    })),
    chartData: { labels: [], datasets: [] },
    roundDetailsList: []
  };

  try {
    const detail = await fetchSessionGameDetail(targetSession, game);
    if (reqId === gameDetailRequestId &&
        selectedGameDetail.value &&
        selectedGameDetail.value.gameIndex === game.gameIndex) {
      detail.playerStats.forEach(dp => {
        if (dp.ratingBefore === undefined) {
          const orig = game.players.find(gp => gp.name === dp.name);
          if (orig) {
            dp.ratingBefore = orig.ratingBefore;
            dp.ratingAfter = orig.ratingAfter;
            dp.ratingDelta = orig.ratingDelta;
          }
        }
      });
      selectedGameDetail.value = detail;
    }
  } catch (e) {
    console.warn("fetchSessionGameDetail failed:", e);
  } finally {
    if (reqId === gameDetailRequestId) {
      isLoadingGameDetail.value = false;
    }
  }
};

const gameChartOptions = computed<ChartOptions<'line'>>(() => {
  const textColor = isDark.value ? '#f1f5f9' : '#1e293b';
  const tickColor = isDark.value ? '#94a3b8' : '#64748b';
  const gridColor = isDark.value ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';

  const datasets = selectedGameDetail.value?.chartData?.datasets || [];
  const allScores = datasets.flatMap(d => d.data);
  const minScore = allScores.length > 0 ? Math.min(...allScores, 25000) : 20000;
  const maxScore = allScores.length > 0 ? Math.max(...allScores, 25000) : 30000;
  const pad = Math.max(3000, Math.round((maxScore - minScore) * 0.1));

  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 650,
      easing: 'easeOutQuart',
    },
    animations: {
      y: {
        type: 'number',
        duration: 650,
        easing: 'easeOutQuart',
        from: (ctx: any) => {
          if (ctx.type === 'data') {
            const yScale = ctx.chart?.scales?.y;
            return yScale ? yScale.getPixelForValue(25000) : undefined;
          }
          return undefined;
        }
      }
    },
    interaction: {
      mode: 'index',
      intersect: false,
    },
    scales: {
      x: {
        ticks: {
          autoSkip: false,
          color: tickColor,
          font: { family: "'Noto Serif KR', serif" },
        },
        grid: {
          color: gridColor,
        }
      },
      y: {
        suggestedMin: Math.floor((minScore - pad) / 1000) * 1000,
        suggestedMax: Math.ceil((maxScore + pad) / 1000) * 1000,
        ticks: {
          color: tickColor,
          font: { family: "'Noto Serif KR', serif" },
          callback: (value) => Number(value).toLocaleString() + '점',
        },
        grid: {
          color: gridColor,
        }
      }
    },
    plugins: {
      legend: {
        position: 'top',
        labels: {
          usePointStyle: true,
          pointStyle: 'rectRounded',
          color: textColor,
          font: { family: "'Noto Serif KR', serif", size: 12 },
        }
      },
      tooltip: {
        backgroundColor: isDark.value ? '#1e293b' : '#ffffff',
        titleColor: isDark.value ? '#f8fafc' : '#0f172a',
        bodyColor: isDark.value ? '#e2e8f0' : '#334155',
        borderColor: isDark.value ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)',
        borderWidth: 1,
        callbacks: {
          label: (context) => {
            const val = context.parsed.y;
            return `${context.dataset.label}: ${Number(val).toLocaleString()}점`;
          }
        }
      }
    }
  };
});

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
  const overallKeys: (keyof MemberStatItem)[] = ['totalGames', 'totalUma', 'avgUma', 'avgRank', 'top2Rate'];
  const hasDetailed = (displayPlayerStats.value?.totalRounds || 0) > 0 && (displayPlayerStats.value?.totalGames || 0) > 0;
  const isOverallKey = overallKeys.includes(key);

  let targetList: MemberStatItem[];
  let targetVal = val;
  let isUnrecorded = false;

  if (!hasDetailed && isOverallKey && selectedPlayer.value) {
    targetList = allStats.value;
    targetVal = Number(selectedPlayer.value[key]) || 0;
  } else {
    targetList = allStats.value.map(m => m.detailedStats || m);
    if (!hasDetailed) {
      isUnrecorded = true;
    }
  }

  const dist = calculateMetricDistribution(
    targetList,
    key,
    name,
    targetVal,
    unit,
    higherIsBetter,
    displayPlayerStats.value?.name || selectedPlayer.value?.name,
    isUnrecorded
  );
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

// 딥링크(?photo=...) 진입 시 라이트박스 메인 사진이 로드될 때까지 배경 갤러리 썸네일 및 무거운 통계 요청을 지연
const isInitialLightboxImagePending = ref<boolean>(false);
let resolveInitialLightboxImageWait: (() => void) | null = null;
const clearInitialLightboxImagePending = () => {
  if (isInitialLightboxImagePending.value) {
    isInitialLightboxImagePending.value = false;
  }
  if (resolveInitialLightboxImageWait) {
    const fn = resolveInitialLightboxImageWait;
    resolveInitialLightboxImageWait = null;
    fn();
  }
};

// 전체 초기 데이터 로드 (forceRefresh=true 시 메모리 캐시 초기화 및 서버 최신 강제 조회)
const loadAllData = async (forceRefresh: boolean = false) => {
  if (forceRefresh) {
    clearPublicStatsCache({ keepPastSessions: true });
  }
  isLoading.value = true;
  errorMessage.value = '';
  try {
    const initialTargetPhotoId = pendingUrlPhotoId.value || parsePhotoIdFromLocation();
    const isGalleryPriority = Boolean(initialTargetPhotoId || activeTab.value === 'gallery');

    let preloadedHighlights: HighlightRecord[] | null = null;

    // 1) ?photo=... 공유 링크나 갤러리 탭으로 진입한 경우:
    // 무거운 구글 시트 통계 API 4종보다 갤러리 목록(KV)만 단독으로 먼저 조회하여 게시글/사진을 0순위로 즉시 오픈
    if (isGalleryPriority) {
      try {
        const hlList = await fetchHighlights(forceRefresh);
        preloadedHighlights = hlList;
        highlightsList.value = hlList;

        const targetPhotoId = pendingUrlPhotoId.value || parsePhotoIdFromLocation();
        if (targetPhotoId && !lightboxHighlight.value) {
          const found = hlList.find(h => h.id === targetPhotoId);
          if (found) {
            pendingUrlPhotoId.value = '';
            if (found.hasImage && found.imageId) {
              isInitialLightboxImagePending.value = true;
            }
            openHighlightLightbox(found, false);
            isLoading.value = false;

            if (found.hasImage && found.imageId) {
              await new Promise<void>(resolve => {
                resolveInitialLightboxImageWait = resolve;
                setTimeout(() => {
                  clearInitialLightboxImagePending();
                }, 1500);
              });
            }
          }
        } else {
          isLoading.value = false;
        }
      } catch (e) {
        console.warn("역만/화료 갤러리 우선 로드 실패:", e);
        clearInitialLightboxImagePending();
      }
    }

    const highlightsPromise = preloadedHighlights !== null
      ? Promise.resolve(preloadedHighlights)
      : fetchHighlights(forceRefresh)
          .then(hlList => {
            highlightsList.value = hlList;
            const targetPhotoId = pendingUrlPhotoId.value || parsePhotoIdFromLocation();
            if (targetPhotoId && !lightboxHighlight.value) {
              const found = hlList.find(h => h.id === targetPhotoId);
              if (found) {
                pendingUrlPhotoId.value = '';
                openHighlightLightbox(found, false);
              }
            }
            return hlList;
          })
          .catch(e => {
            console.warn("역만/화료 갤러리 로드 실패:", e);
            return [] as HighlightRecord[];
          });

    const [stats, matrix, timeline, sessions, highlights] = await Promise.all([
      fetchPublicAllStats(undefined, forceRefresh).then(res => {
        if (res && res.length > 0) {
          allStats.value = res;
        }
        return res;
      }),
      fetchPublicStatsMatrix(undefined, forceRefresh)
        .then(res => {
          if (res) {
            statsMatrix.value = res;
          }
          return res;
        })
        .catch(e => {
          console.warn("통계 매트릭스 로드 실패:", e);
          return null;
        }),
      fetchPublicRatingTimeline(undefined, forceRefresh)
        .then(res => {
          if (res) {
            ratingTimeline.value = res;
            filterRatingTopN(5);
          }
          return res;
        })
        .catch(e => {
          console.warn("레이팅 타임라인 로드 실패:", e);
          return null;
        }),
      fetchPublicSessions(undefined, forceRefresh)
        .then(res => {
          if (res && res.length > 0) {
            availableSessions.value = res;
          }
          return res;
        })
        .catch(e => {
          console.error("회차 목록 로드 실패:", e);
          return [] as string[];
        }),
      highlightsPromise
    ]);
    allStats.value = stats;
    statsMatrix.value = matrix;
    highlightsList.value = highlights;
    if (timeline) {
      ratingTimeline.value = timeline;
      filterRatingTopN(5);
    }
    fetchPublicRatingHistoryRecords(undefined, false)
      .then(recs => {
        if (recs.length > 0) {
          allRatingHistoryRecords.value = recs;
        }
      })
      .catch(() => {});
    if (sessions.length > 0) {
      availableSessions.value = sessions;
      const valid = displayedAvailableSessions.value;
      if (valid.length > 0) {
        const matchedCurrent = selectedSession.value
          ? valid.find(s => matchHighlightSession(s, selectedSession.value))
          : undefined;
        if (matchedCurrent) {
          selectedSession.value = matchedCurrent;
        } else if (!selectedSession.value || !valid.includes(selectedSession.value)) {
          selectedSession.value = valid[0];
        }
      }
    }
    if (
      selectedSession.value &&
      (forceRefresh ||
        (!isLoadingSession.value &&
          (!currentSessionDetail.value ||
            !matchHighlightSession(currentSessionDetail.value.sessionName, selectedSession.value))))
    ) {
      await loadSessionDetail(selectedSession.value, forceRefresh);
    }
    if (forceRefresh) {
      showToast('최신 데이터로 새로고침되었습니다.');
    }
  } catch (err: any) {
    console.error("데이터 로드 실패:", err);
    errorMessage.value = err.message || "스프레드시트 데이터를 불러오는 데 실패했습니다.";
  } finally {
    isLoading.value = false;
    clearInitialLightboxImagePending();
  }
};

// ==========================================
// 레이팅 타임라인 및 인터랙티브 차트 상태
// ==========================================
const ratingTimeline = ref<AllPlayersRatingTrajectory | null>(null);
const ratingEmbeddedChartRef = ref<any>(null);
const ratingModalChartRef = ref<any>(null);
const isRatingTimelineModalOpen = ref(false);
const selectedRatingSessionFilter = ref('');
const hiddenRatingPlayerNames = ref<Set<string>>(new Set());
const activeRatingPreset = ref<'top5' | 'top10' | 'all' | 'none' | 'session'>('top5');

// 모달 확대 시 Chart.js 캔버스 리사이즈 동기화
watch(isRatingTimelineModalOpen, (isOpen) => {
  if (isOpen) {
    nextTick(() => {
      setTimeout(() => {
        ratingModalChartRef.value?.chart?.resize();
      }, 60);
    });
  }
});

// 수식 KaTeX 렌더러
const renderKatex = (latex: string, displayMode = true) => {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false
    });
  } catch (e) {
    return latex;
  }
};

// 줌 배율 초기화
const resetRatingChartZoom = () => {
  if (ratingEmbeddedChartRef.value?.chart) {
    ratingEmbeddedChartRef.value.chart.resetZoom();
  }
  if (ratingModalChartRef.value?.chart) {
    ratingModalChartRef.value.chart.resetZoom();
  }
};

// 상위 N명 필터
const filterRatingTopN = (n: number) => {
  activeRatingPreset.value = n === 5 ? 'top5' : (n === 10 ? 'top10' : 'none');
  selectedRatingSessionFilter.value = '';
  const newSet = new Set<string>();
  const datasets = ratingTimeline.value?.datasets || [];
  datasets.forEach((ds, idx) => {
    if (idx >= n) {
      newSet.add(ds.name);
    }
  });
  hiddenRatingPlayerNames.value = newSet;
};

// 전체 선택 / 전체 해제
const filterRatingAll = (showAll: boolean) => {
  activeRatingPreset.value = showAll ? 'all' : 'none';
  selectedRatingSessionFilter.value = '';
  if (showAll) {
    hiddenRatingPlayerNames.value = new Set();
  } else {
    hiddenRatingPlayerNames.value = new Set(ratingTimeline.value?.datasets.map(d => d.name) || []);
  }
};

const availableRatingSessions = computed(() => {
  if (statsMatrix.value?.sessions && statsMatrix.value.sessions.length > 0) {
    return statsMatrix.value.sessions;
  }
  return displayedAvailableSessions.value.map(s => {
    const m = s.match(/제\d+회/);
    return m ? m[0] : s;
  });
});

// 회차 필터 드롭다운 직접 변경 시 처리 핸들러
const handleSessionFilterChange = () => {
  const sessName = selectedRatingSessionFilter.value;
  if (!sessName) {
    filterRatingTopN(5);
    return;
  }
  activeRatingPreset.value = 'session';
  const rows = statsMatrix.value?.rows || [];
  const participantNames = new Set(
    rows
      .filter((r: StatsMatrixRow) => r.sessionUmas[sessName] !== null && r.sessionUmas[sessName] !== undefined)
      .map((r: StatsMatrixRow) => r.name)
  );

  const newSet = new Set<string>();
  ratingTimeline.value?.datasets.forEach(ds => {
    if (!participantNames.has(ds.name)) {
      newSet.add(ds.name);
    }
  });
  hiddenRatingPlayerNames.value = newSet;
};

const ratingChartData = computed(() => {
  if (!ratingTimeline.value) {
    return { labels: [], datasets: [] };
  }

  const isDarkTheme = isDark.value;
  const datasets = ratingTimeline.value.datasets.map((d) => {
    // 1. 색상 사전 계산 (매 선분마다 정규식 파싱하는 오버헤드 제거)
    // 원색(출전 대국 구간)과 반투명 색상(미출전 유지 구간)을 미리 준비
    const matchColor = d.color;
    const idleColor = hexToRgba(d.color, isDarkTheme ? 0.35 : 0.40);

    // 2. 포인트 반경 사전 계산 (매 프레임 함수 동적 평가 제거)
    // 시작(인덱스 0)과 끝 지점, 그리고 실제 출전한 대국 지점만 점을 표시하고 평상시 미출전 구간은 0
    const pointRadii = d.data.map((_, idx) => {
      if (idx === 0) return 2.0;
      if (idx === d.data.length - 1) return 2.2;
      return d.played?.[idx] ? 1.4 : 0;
    });

    return {
      label: d.name,
      data: d.data,
      borderColor: matchColor,
      backgroundColor: matchColor,
      borderWidth: 1.6,
      // 3. 선분별 스타일: 동일 색상 문자열을 반환하여 Chart.js의 Path 일괄 배칭(단일 stroke) 보장
      // (기존의 매 프레임 수천 개 createLinearGradient 생성 및 CanvasGradient 할당을 완전히 제거)
      segment: {
        borderColor: (ctx: any) => {
          return d.played?.[ctx.p1DataIndex] ? matchColor : idleColor;
        }
      },
      pointRadius: pointRadii,
      pointHoverRadius: 5,
      pointHitRadius: 8,
      played: d.played,
      deltas: d.deltas,
      umas: d.umas,
      ranks: d.ranks,
      hasMarker: d.hasMarker,
      tension: 0, // 3차 베지에 스플라인 연산 부하 제거 및 표준 레이팅 그래프 스타일 적용
      fill: false,
      spanGaps: true,
      hidden: hiddenRatingPlayerNames.value.has(d.name)
    };
  });

  return {
    labels: ratingTimeline.value.labels,
    datasets
  };
});

// 차트가 현재 초기 배율(제일 펼쳐진 상태)인지 판별하는 헬퍼
const isChartFullyUnzoomed = (chart: any) => {
  if (!chart) return true;
  if (typeof chart.isZoomedOrPanned === 'function' && !chart.isZoomedOrPanned()) {
    return true;
  }
  if (typeof chart.getZoomLevel === 'function' && chart.getZoomLevel() <= 1.02) {
    return true;
  }
  const xScale = chart.scales?.x;
  const initialBounds = typeof chart.getInitialScaleBounds === 'function' ? chart.getInitialScaleBounds() : null;
  if (xScale && initialBounds?.x) {
    const isAtMin = Math.abs(xScale.min - initialBounds.x.min) < 0.5 || xScale.min <= initialBounds.x.min;
    const isAtMax = Math.abs(xScale.max - initialBounds.x.max) < 0.5 || xScale.max >= initialBounds.x.max;
    if (isAtMin && isAtMax) return true;
  }
  return false;
};

const toggleRatingPlayerLegend = (name: string) => {
  if (!name) return;
  const newSet = new Set(hiddenRatingPlayerNames.value);
  if (newSet.has(name)) {
    newSet.delete(name);
  } else {
    newSet.add(name);
  }
  hiddenRatingPlayerNames.value = newSet;
  activeRatingPreset.value = 'none';
};

const ratingChartOptions = computed<ChartOptions<'line'>>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: false, // 줌/팬 및 필터 전환 시 프레임 딜레이 없는 즉각 렌더링
  normalized: true, // 이미 X축 순차 인덱스 데이터이므로 Chart.js 내부 정렬/파싱 생략
  plugins: {
    legend: {
      display: false
    },
    tooltip: {
      mode: 'index',
      intersect: false,
      // 툴팁 최적화: 출전하지 않은 26명의 (미참가) 줄 도배를 방지하고 실제 출전 4인 위주로 컴팩트하게 노출
      filter: (item, index, items) => {
        if (item.dataIndex === 0) {
          return index < 6;
        }
        const ds = item.dataset as any;
        if (ds.played?.[item.dataIndex]) {
          return true;
        }
        // 만약 선택된 표시 선수 중 아무도 해당 대국에 출전하지 않은 경우, 첫 번째 항목이라도 보여줌
        const anyPlayed = items.some(it => (it.dataset as any).played?.[item.dataIndex]);
        if (!anyPlayed && index === 0) {
          return true;
        }
        return false;
      },
      itemSort: (a, b) => {
        // 출전 4인 중 1위 -> 4위 순서로 보기 쉽게 정렬
        const rankA = (a.dataset as any).ranks?.[a.dataIndex] ?? 99;
        const rankB = (b.dataset as any).ranks?.[b.dataIndex] ?? 99;
        return rankA - rankB;
      },
      callbacks: {
        label: (context) => {
          const val = context.parsed.y;
          if (val === null || val === undefined || isNaN(val)) return '';
          const dataset = context.dataset as any;
          const isPlayed = dataset.played?.[context.dataIndex];
          const delta = dataset.deltas?.[context.dataIndex];
          const rank = dataset.ranks?.[context.dataIndex];
          const uma = dataset.umas?.[context.dataIndex];

          if (context.dataIndex === 0) {
            return `${dataset.label}: R${val} (시작)`;
          }

          if (isPlayed && delta !== null && delta !== undefined) {
            const dStr = delta >= 0 ? `+${delta}` : `${delta}`;
            const rStr = rank ? ` [${rank}위]` : '';
            const umaStr = (uma !== null && uma !== undefined) ? ` (우마: ${uma > 0 ? '+' : ''}${uma})` : '';
            return `${dataset.label}: R${val} (${dStr}pt)${rStr}${umaStr}`;
          }
          return `${dataset.label}: R${val} (미참가)`;
        }
      }
    },
    zoom: {
      limits: {
        x: {
          min: 'original',
          max: 'original',
          minRange: 5
        }
      },
      pan: {
        enabled: true,
        mode: 'x',
        threshold: 8,
      },
      zoom: {
        wheel: {
          enabled: true,
          speed: 0.08,
        },
        pinch: {
          enabled: true,
        },
        mode: 'x',
        onZoomStart: ({ chart, event }: any) => {
          // 데스크톱 마우스 휠 이벤트 처리
          if (event && event.deltaY !== undefined) {
            const isZoomingOut = event.deltaY > 0;
            // 줌이 제일 펼쳐져 있는 상태(초기 배율)에서 아래로 스크롤(줌아웃 시도)할 경우:
            // false를 반환하여 preventDefault()를 막고, 브라우저 기본 페이지 스크롤이 정상 작동하도록 허용
            if (isZoomingOut && isChartFullyUnzoomed(chart)) {
              return false;
            }
          }
          return true;
        }
      }
    }
  },
  scales: {
    x: {
      grid: { color: isDark.value ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)' },
      ticks: {
        font: { family: "'Noto Serif KR', serif", size: 11 },
        color: isDark.value ? '#94a3b8' : '#64748b',
        maxRotation: 45
      }
    },
    y: {
      suggestedMin: 1200,
      suggestedMax: 1700,
      grid: { color: isDark.value ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)' },
      ticks: {
        font: { family: "'Noto Serif KR', serif", size: 11 },
        color: isDark.value ? '#94a3b8' : '#64748b',
        callback: (value) => `R${value}`,
        stepSize: 50
      }
    }
  }
}));

const ratingLeaderboard = computed(() => {
  return [...allStats.value]
    .filter(s => s.name && s.name.trim() !== '')
    .sort((a, b) => (b.rating ?? 1320) - (a.rating ?? 1320));
});

const modalPlayerRatingHistory = computed(() => {
  if (!selectedPlayer.value) return [];
  if (selectedPlayer.value.ratingHistory && selectedPlayer.value.ratingHistory.length > 0) {
    return selectedPlayer.value.ratingHistory.filter(
      h => h.sessionLabel !== '초기값' && h.gameIndex !== 0
    );
  }
  const pName = selectedPlayer.value.name;
  if (pName && ratingTimeline.value) {
    const cleanPName = pName.replace(/★/g, '').trim();
    const ds = ratingTimeline.value.datasets.find(d => d.name === pName || d.name === cleanPName);
    if (ds && ds.data) {
      const records: any[] = [];
      const labels = ratingTimeline.value.labels;
      ds.data.forEach((ord, idx) => {
        if (idx === 0) return;
        if (ds.played && ds.played[idx]) {
          records.push({
            gameIndex: records.length + 1,
            ordinal: ord,
            delta: ds.deltas?.[idx] ?? 0,
            sessionLabel: labels[idx] || `${records.length + 1}국`,
            rank: ds.ranks?.[idx]
          });
        }
      });
      return records;
    }
  }
  return [];
});

const modalPlayerRatingSummary = computed(() => {
  const hist = modalPlayerRatingHistory.value;
  const current = selectedPlayer.value?.rating ?? 1320;
  if (!hist || hist.length === 0) {
    return { current, peak: current, totalGames: 0 };
  }
  const ordinals = hist.map(h => h.ordinal);
  return {
    current: ordinals[ordinals.length - 1],
    peak: Math.max(...ordinals),
    totalGames: hist.length
  };
});

const codeforcesTierBandsPlugin = {
  id: 'codeforcesTierBands',
  beforeDraw(chart: any) {
    const { ctx, chartArea, scales } = chart;
    if (!chartArea || !scales.y) return;

    const yScale = scales.y;
    const { left, right, top, bottom } = chartArea;

    /**
     * 레이팅 100단위 배경 밴드 정의
     * [중요 원칙] 등급/티어 명칭(작걸, 작사, 작호, 작성, 혼천, 초심 등)은 클럽 정책상 어떤 경우에도
     * UI 텍스트로 노출하지 않으며, 오직 100단위 고유 색상 밴드와 경계선만 적용합니다.
     */
    const ratingBands = [
      { min: 1700, max: 2400, color: '#38BEDA' }, // 1700 이상
      { min: 1600, max: 1700, color: '#CD4A62' }, // 1600대
      { min: 1500, max: 1600, color: '#E88640' }, // 1500대
      { min: 1400, max: 1500, color: '#E5B800', alphaBoost: 0.02 }, // 1400대 (골드 고명도 보정)
      { min: 1300, max: 1400, color: '#21A73C' }, // 1300대
      { min: 1200, max: 1300, color: '#98B324' }, // 1200대
      { min: 1100, max: 1200, color: '#7E941E' }, // 1100대
      { min: 800,  max: 1100, color: '#687B16' }  // 1100 미만
    ];

    const dark = isDark.value;
    // 저대비 디스플레이에서도 100단위 구역이 확실히 분간되도록 불투명도 대폭 상향 (기존 3.8% -> 12.5%)
    const baseBandAlpha = dark ? 0.11 : 0.125;
    const lineAlpha = dark ? 0.46 : 0.40;

    ctx.save();
    for (const band of ratingBands) {
      const yMaxPixel = yScale.getPixelForValue(band.max);
      const yMinPixel = yScale.getPixelForValue(band.min);

      const yTop = Math.max(top, Math.min(bottom, yMaxPixel));
      const yBottom = Math.min(bottom, Math.max(top, yMinPixel));

      if (yBottom > yTop) {
        // 부드럽고 확연한 100단위 가로 배경 밴드
        const effectiveAlpha = baseBandAlpha + (band.alphaBoost || 0);
        ctx.fillStyle = hexToRgba(band.color, effectiveAlpha);
        ctx.fillRect(left, yTop, right - left, yBottom - yTop);
      }

      // 100단위 경계선 (점선: 1200, 1300, 1400, 1500, 1600, 1700 등)
      if (band.min >= 1100) {
        const boundaryY = yScale.getPixelForValue(band.min);
        if (boundaryY >= top && boundaryY <= bottom) {
          ctx.beginPath();
          ctx.setLineDash([5, 4]);
          ctx.lineWidth = 1.2;
          ctx.strokeStyle = hexToRgba(band.color, lineAlpha);
          ctx.moveTo(left, boundaryY);
          ctx.lineTo(right, boundaryY);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }
};

const modalSessionRegionsAndCrosshairPlugin = {
  id: 'modalSessionRegionsAndCrosshair',
  beforeDraw(chart: any) {
    const { ctx, chartArea, scales } = chart;
    if (!chartArea || !scales.x) return;

    const xScale = scales.x;
    const { top, bottom, right } = chartArea;
    const hist = modalPlayerRatingHistory.value;
    if (!hist || hist.length === 0) return;

    // 회차별 세로 영역 그룹핑
    interface Region {
      name: string;
      start: number;
      end: number;
    }
    const regions: Region[] = [];

    for (let i = 0; i < hist.length; i++) {
      const raw = hist[i].sessionLabel || '';
      const m = raw.match(/제\s*(\d+)\s*회/);
      const sName = m ? `제${m[1]}회` : (raw.split(' ')[0] || '대국');
      const chartIdx = i + 1;

      if (!regions.length || regions[regions.length - 1].name !== sName) {
        regions.push({ name: sName, start: chartIdx, end: chartIdx });
      } else {
        regions[regions.length - 1].end = chartIdx;
      }
    }

    const dark = isDark.value;
    ctx.save();

    regions.forEach((reg, rIdx) => {
      let xLeft: number;
      if (reg.start === 1) {
        xLeft = (xScale.getPixelForValue(0) + xScale.getPixelForValue(1)) / 2;
      } else {
        xLeft = (xScale.getPixelForValue(reg.start - 1) + xScale.getPixelForValue(reg.start)) / 2;
      }

      let xRight: number;
      if (reg.end >= hist.length) {
        xRight = right;
      } else {
        xRight = (xScale.getPixelForValue(reg.end) + xScale.getPixelForValue(reg.end + 1)) / 2;
      }

      // 회차별 교차 세로 배경 밴드
      if (rIdx % 2 === 1) {
        ctx.fillStyle = dark ? 'rgba(255, 255, 255, 0.025)' : 'rgba(0, 0, 0, 0.02)';
        ctx.fillRect(xLeft, top, xRight - xLeft, bottom - top);
      }

      // 회차 시작 세로 구분선 (점선)
      ctx.beginPath();
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = dark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.12)';
      ctx.moveTo(xLeft, top);
      ctx.lineTo(xLeft, bottom);
      ctx.stroke();
    });

    ctx.restore();
  },
  afterDraw(chart: any) {
    const { ctx, chartArea, scales } = chart;
    if (!chartArea || !scales.x) return;

    const xScale = scales.x;
    const { top, bottom, right } = chartArea;
    const hist = modalPlayerRatingHistory.value;
    if (!hist || hist.length === 0) return;

    // 1. 회차 헤더 텍스트 렌더링 (차트 상단)
    interface Region {
      name: string;
      start: number;
      end: number;
    }
    const regions: Region[] = [];
    for (let i = 0; i < hist.length; i++) {
      const raw = hist[i].sessionLabel || '';
      const m = raw.match(/제\s*(\d+)\s*회/);
      const sName = m ? `제${m[1]}회` : (raw.split(' ')[0] || '대국');
      const chartIdx = i + 1;

      if (!regions.length || regions[regions.length - 1].name !== sName) {
        regions.push({ name: sName, start: chartIdx, end: chartIdx });
      } else {
        regions[regions.length - 1].end = chartIdx;
      }
    }

    const dark = isDark.value;
    ctx.save();

    regions.forEach((reg) => {
      let xLeft: number;
      if (reg.start === 1) {
        xLeft = (xScale.getPixelForValue(0) + xScale.getPixelForValue(1)) / 2;
      } else {
        xLeft = (xScale.getPixelForValue(reg.start - 1) + xScale.getPixelForValue(reg.start)) / 2;
      }
      let xRight: number;
      if (reg.end >= hist.length) {
        xRight = right;
      } else {
        xRight = (xScale.getPixelForValue(reg.end) + xScale.getPixelForValue(reg.end + 1)) / 2;
      }

      const colWidth = xRight - xLeft;
      const midX = (xLeft + xRight) / 2;

      if (colWidth >= 24) {
        ctx.font = "700 10.5px 'Noto Serif KR', serif";
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        const textMetrics = ctx.measureText(reg.name);
        const badgeW = textMetrics.width + 10;
        const badgeH = 15;
        const badgeX = midX - badgeW / 2;
        const badgeY = top - 18;

        if (badgeY >= 0) {
          ctx.fillStyle = dark ? 'rgba(39, 39, 42, 0.9)' : 'rgba(241, 245, 249, 0.92)';
          ctx.beginPath();
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
          } else {
            ctx.rect(badgeX, badgeY, badgeW, badgeH);
          }
          ctx.fill();

          ctx.strokeStyle = dark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)';
          ctx.lineWidth = 1;
          ctx.stroke();

          ctx.fillStyle = dark ? '#93c5fd' : '#2563eb';
          ctx.fillText(reg.name, midX, badgeY + 2);
        }
      }
    });

    // 2. 활성 마우스 호버 세로 트래킹 크로스헤어 라인
    const active = chart.tooltip?.getActiveElements?.();
    if (active && active.length > 0) {
      const activeX = active[0].element.x;
      ctx.beginPath();
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = dark ? 'rgba(255, 255, 255, 0.45)' : 'rgba(15, 23, 42, 0.4)';
      ctx.moveTo(activeX, top);
      ctx.lineTo(activeX, bottom);
      ctx.stroke();
    }

    ctx.restore();
  }
};

const ratingChartPlugins = computed(() => [codeforcesTierBandsPlugin]);
const modalRatingChartPlugins = computed(() => [codeforcesTierBandsPlugin, modalSessionRegionsAndCrosshairPlugin]);

const modalPlayerRatingChartData = computed(() => {
  const hist = modalPlayerRatingHistory.value;
  if (!hist || hist.length === 0) {
    return { labels: [], datasets: [] };
  }
  const ratingValues = [1320, ...hist.map(h => h.ordinal)];
  const pointColors = ratingValues.map(r => hexToRgba(getRatingColor(r), isDark.value ? 0.65 : 0.58));
  const pointHoverColors = ratingValues.map(r => getRatingColor(r));

  return {
    labels: ['시작', ...hist.map((_, i) => `${i + 1}국`)],
    datasets: [{
      label: selectedPlayer.value?.name || '',
      data: ratingValues,
      deltas: [null, ...hist.map(h => h.delta)],
      historyRecords: [null, ...hist],
      borderColor: isDark.value ? '#60a5fa' : '#2563eb',
      backgroundColor: 'transparent',
      borderWidth: 2.2,
      pointRadius: 4,
      pointHoverRadius: 7,
      pointBackgroundColor: pointColors,
      pointBorderColor: isDark.value ? 'rgba(24, 24, 27, 0.7)' : 'rgba(255, 255, 255, 0.85)',
      pointBorderWidth: 1.5,
      pointHoverBackgroundColor: pointHoverColors,
      pointHoverBorderColor: isDark.value ? '#18181b' : '#ffffff',
      pointHoverBorderWidth: 2,
      tension: 0.15,
      fill: false
    }]
  };
});

const modalPlayerRatingChartOptions = computed<ChartOptions<'line'>>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  layout: {
    padding: {
      top: 22,
      right: 12,
      left: 6,
      bottom: 6
    }
  },
  interaction: {
    mode: 'index',
    intersect: false,
    axis: 'x'
  },
  plugins: {
    legend: { display: false },
    tooltip: {
      mode: 'index',
      intersect: false,
      callbacks: {
        title: (items) => {
          if (!items.length) return '';
          const idx = items[0].dataIndex;
          if (idx === 0) return '초기 레이팅 (시작)';
          const hist = modalPlayerRatingHistory.value;
          const rec = hist[idx - 1];
          const sess = rec?.sessionLabel || '';
          return `${sess} (통산 ${idx}국)`;
        },
        label: (context) => {
          const val = context.parsed.y;
          const dataset = context.dataset as any;
          const idx = context.dataIndex;
          if (idx === 0) return `시작: R${val}`;
          const delta = dataset.deltas?.[idx];
          const dStr = delta !== null && delta !== undefined ? ` (${delta >= 0 ? '+' : ''}${delta})` : '';
          const rec = dataset.historyRecords?.[idx];
          const rStr = rec?.rank ? ` · ${rec.rank}위` : '';
          return `레이팅: R${val}${dStr}${rStr}`;
        }
      }
    }
  },
  scales: {
    x: {
      grid: { color: isDark.value ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)' },
      ticks: {
        color: isDark.value ? '#94a3b8' : '#64748b',
        font: { family: "'Noto Serif KR', serif", size: 10.5 },
        maxRotation: 0,
        autoSkip: true,
        maxTicksLimit: 14
      }
    },
    y: {
      suggestedMin: 1250,
      suggestedMax: 1650,
      grid: { color: isDark.value ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)' },
      ticks: {
        font: { family: "'Noto Serif KR', serif", size: 11 },
        color: isDark.value ? '#94a3b8' : '#64748b',
        callback: (value) => `R${value}`,
        stepSize: 50
      }
    }
  }
}));

// 개인 통계 모달 - '이번 회차' 전용 레이팅 추이 이력 및 차트
interface SessionPlayerRatingStep {
  gameIndex?: number;
  ordinal: number;
  delta: number;
  ratingBefore: number;
  sessionLabel: string;
  rank?: number;
  score?: number;
  uma?: number;
}

const sessionModalPlayerRatingHistory = computed<SessionPlayerRatingStep[]>(() => {
  if (!selectedPlayer.value) return [];
  const pName = selectedPlayer.value.name.trim();
  const cleanPName = pName.replace(/★/g, '').trim();
  const sessName = (currentSessionDetail.value?.sessionName || selectedSession.value || '').trim();
  if (!sessName) return [];

  // 1) currentSessionDetail.games 에 대국별 레이팅 정보가 주입되어 있는 경우 우선 활용
  const sessionGames = currentSessionDetail.value?.games || [];
  const stepsFromGames: SessionPlayerRatingStep[] = [];
  const sortedGames = [...sessionGames].sort((a, b) => Number(a.gameIndex) - Number(b.gameIndex));
  for (const g of sortedGames) {
    const p = g.players.find(
      pl => pl.name.trim() === pName || pl.name.replace(/★/g, '').trim() === cleanPName
    );
    if (p && p.ratingAfter !== undefined) {
      const delta = p.ratingDelta ?? (p.ratingBefore !== undefined ? p.ratingAfter - p.ratingBefore : 0);
      const before = p.ratingBefore ?? (p.ratingAfter - delta);
      stepsFromGames.push({
        gameIndex: g.gameIndex,
        ordinal: p.ratingAfter,
        delta,
        ratingBefore: before,
        sessionLabel: `${sessName} ${g.gameIndex}경기`,
        rank: p.rank,
        score: p.score,
        uma: p.uma,
      });
    }
  }
  if (stepsFromGames.length > 0) {
    return stepsFromGames;
  }

  // 2) 폴백: 전체 레이팅 히스토리(modalPlayerRatingHistory)에서 해당 회차 기록 필터링
  const allHist = modalPlayerRatingHistory.value;
  const matched = allHist.filter(h => h.sessionLabel && matchHighlightSession(h.sessionLabel, sessName));
  return matched.map((h, idx) => {
    const gMatch = (h.sessionLabel || '').match(/(\d+)\s*(?:경기|게임|국)/);
    const gIdx = gMatch ? Number(gMatch[1]) : idx + 1;
    const delta = h.delta ?? 0;
    const ordinal = h.ordinal;
    return {
      gameIndex: gIdx,
      ordinal,
      delta,
      ratingBefore: ordinal - delta,
      sessionLabel: h.sessionLabel || `${sessName} ${gIdx}경기`,
      rank: h.rank,
    };
  });
});

const sessionModalPlayerRatingSummary = computed(() => {
  const hist = sessionModalPlayerRatingHistory.value;
  const fallbackRating = selectedPlayer.value?.rating ?? 1320;
  if (!hist || hist.length === 0) {
    return {
      startRating: fallbackRating,
      endRating: fallbackRating,
      netDelta: 0,
      peak: fallbackRating,
      totalGames: 0,
    };
  }
  const startRating = hist[0].ratingBefore;
  const endRating = hist[hist.length - 1].ordinal;
  const netDelta = endRating - startRating;
  const allRatings = [startRating, ...hist.map(h => h.ordinal)];
  return {
    startRating,
    endRating,
    netDelta,
    peak: Math.max(...allRatings),
    totalGames: hist.length,
  };
});

const sessionModalCrosshairPlugin = {
  id: 'sessionModalCrosshair',
  afterDraw(chart: any) {
    const { ctx, chartArea } = chart;
    if (!chartArea) return;
    const active = chart.tooltip?.getActiveElements?.();
    if (active && active.length > 0) {
      const activeX = active[0].element.x;
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = isDark.value ? 'rgba(255, 255, 255, 0.45)' : 'rgba(15, 23, 42, 0.4)';
      ctx.moveTo(activeX, chartArea.top);
      ctx.lineTo(activeX, chartArea.bottom);
      ctx.stroke();
      ctx.restore();
    }
  }
};

const sessionModalRatingChartPlugins = computed(() => [codeforcesTierBandsPlugin, sessionModalCrosshairPlugin]);

const sessionModalPlayerRatingChartData = computed(() => {
  const hist = sessionModalPlayerRatingHistory.value;
  if (!hist || hist.length === 0) {
    return { labels: [], datasets: [] };
  }
  const startRating = hist[0].ratingBefore;
  const ratingValues = [startRating, ...hist.map(h => h.ordinal)];
  const pointColors = ratingValues.map(r => hexToRgba(getRatingColor(r), isDark.value ? 0.72 : 0.65));
  const pointHoverColors = ratingValues.map(r => getRatingColor(r));

  return {
    labels: ['회차 시작', ...hist.map((h, i) => (h.gameIndex ? `${h.gameIndex}경기` : `${i + 1}전`))],
    datasets: [{
      label: selectedPlayer.value?.name || '',
      data: ratingValues,
      deltas: [null, ...hist.map(h => h.delta)],
      historyRecords: [null, ...hist],
      borderColor: isDark.value ? '#60a5fa' : '#2563eb',
      backgroundColor: 'transparent',
      borderWidth: 2.4,
      pointRadius: 4.5,
      pointHoverRadius: 7,
      pointBackgroundColor: pointColors,
      pointBorderColor: isDark.value ? 'rgba(24, 24, 27, 0.75)' : 'rgba(255, 255, 255, 0.9)',
      pointBorderWidth: 1.5,
      pointHoverBackgroundColor: pointHoverColors,
      pointHoverBorderColor: isDark.value ? '#18181b' : '#ffffff',
      pointHoverBorderWidth: 2,
      tension: 0.15,
      fill: false,
    }],
  };
});

const sessionModalPlayerRatingChartOptions = computed<ChartOptions<'line'>>(() => {
  const hist = sessionModalPlayerRatingHistory.value;
  const startRating = hist.length > 0 ? hist[0].ratingBefore : 1320;
  const allVals = hist.length > 0 ? [startRating, ...hist.map(h => h.ordinal)] : [1320, 1500];
  const minVal = Math.min(...allVals);
  const maxVal = Math.max(...allVals);
  const suggestedMin = Math.floor((minVal - 35) / 50) * 50;
  const suggestedMax = Math.ceil((maxVal + 35) / 50) * 50;
  const sessName = currentSessionDetail.value?.sessionName || selectedSession.value || '이번 회차';

  return {
    responsive: true,
    maintainAspectRatio: false,
    layout: {
      padding: {
        top: 14,
        right: 12,
        left: 6,
        bottom: 6,
      },
    },
    interaction: {
      mode: 'index',
      intersect: false,
      axis: 'x',
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        mode: 'index',
        intersect: false,
        callbacks: {
          title: (items) => {
            if (!items.length) return '';
            const idx = items[0].dataIndex;
            if (idx === 0) return `${sessName} 시작 (대국 전)`;
            const rec = hist[idx - 1];
            return `${rec?.sessionLabel || `${sessName} ${idx}전`} (회차 ${idx}번째 대국)`;
          },
          label: (context) => {
            const val = context.parsed.y;
            const dataset = context.dataset as any;
            const idx = context.dataIndex;
            if (idx === 0) return `회차 시작: R${val}`;
            const delta = dataset.deltas?.[idx];
            const dStr = delta !== null && delta !== undefined ? ` (${delta >= 0 ? '+' : ''}${delta})` : '';
            const rec = dataset.historyRecords?.[idx];
            const rStr = rec?.rank ? ` · ${rec.rank}위` : '';
            return `레이팅: R${val}${dStr}${rStr}`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { color: isDark.value ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)' },
        ticks: {
          color: isDark.value ? '#94a3b8' : '#64748b',
          font: { family: "'Noto Serif KR', serif", size: 11 },
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 12,
        },
      },
      y: {
        suggestedMin,
        suggestedMax,
        grid: { color: isDark.value ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)' },
        ticks: {
          font: { family: "'Noto Serif KR', serif", size: 11 },
          color: isDark.value ? '#94a3b8' : '#64748b',
          callback: (value) => `R${value}`,
          stepSize: 50,
        },
      },
    },
  };
});

const formatDonutPct = (pct: number): string => {
  if (pct >= 9) return pct.toFixed(1) + '%';
  return Math.round(pct) + '%';
};

onMounted(() => {
  preloadMahjongTileImages();
  loadAllData();
  refreshGalleryAuthState();
});

const copyTextToClipboard = async (text: string) => {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
  } else {
    const input = document.createElement('textarea');
    input.value = text;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
  }
};

// 대시보드 링크 복사 (# 대신 ?tab= / ?photo= 쿼리 사용으로 커뮤니티 링크 잘림 방지)
const copyDashboardLink = async () => {
  try {
    const relUrl = buildDashboardRelativeUrl(activeTab.value, lightboxHighlight.value?.id || null);
    const url = `${window.location.origin}${relUrl}`;
    await copyTextToClipboard(url);
    showToast(lightboxHighlight.value ? '현재 사진 공유 링크가 복사되었습니다!' : '대시보드 링크가 복사되었습니다!');
  } catch (e) {
    showToast('링크 복사에 실패했습니다.');
  }
};

// 개별 갤러리 사진/기록 고유 링크 공유(복사)
const copyHighlightShareLink = async (rec?: HighlightRecord | null) => {
  const target = rec || lightboxHighlight.value;
  if (!target?.id) return;
  try {
    const relUrl = buildDashboardRelativeUrl('gallery', target.id);
    const url = `${window.location.origin}${relUrl}`;
    await copyTextToClipboard(url);
    showToast('사진 공유 링크가 복사되었습니다!');
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

// ==========================================
// 6. 역만 기록 & 회차/화료 사진 갤러리 (원본 화질 WebP & 공통 PIN 관리)
// ==========================================
const highlightsList = ref<HighlightRecord[]>([]);
const galleryCategoryFilter = ref<'all' | HighlightCategory>('all');
const gallerySessionFilter = ref<string>('');
const galleryPlayerFilter = ref<string>('');

// 관리자 로그인 여부 및 기존에 저장된 유효 PIN 보유 여부
const isGalleryAdmin = ref(false);
const hasSavedValidPin = ref(!!getSavedHighlightPin());
const needsPinInput = computed(() => !isGalleryAdmin.value && !hasSavedValidPin.value);

const refreshGalleryAuthState = async () => {
  try {
    const adminRes = await checkAdminStatus();
    isGalleryAdmin.value = !!adminRes.isAdmin;
    const savedPin = getSavedHighlightPin();
    if (savedPin) {
      const verifyRes = await verifyHighlightUploadPin(savedPin);
      hasSavedValidPin.value = !!verifyRes.valid;
      if (verifyRes.isAdmin) {
        isGalleryAdmin.value = true;
      }
    } else {
      hasSavedValidPin.value = false;
    }
  } catch {
    // 네트워크 일시 오류 시 로컬 저장 여부 유지
    hasSavedValidPin.value = !!getSavedHighlightPin();
  }
};

// 선택된 회차에 해당하는 역만/화료/기타 사진 목록
const currentSessionHighlights = computed(() => {
  if (!selectedSession.value) return [];
  return highlightsList.value.filter(r => matchHighlightSession(r.sessionName, selectedSession.value));
});

// 현재 열려 있는 대국 상세 모달에 해당하는 역만/화료/기타 사진 목록
const currentGameHighlights = computed(() => {
  const activeSess = gameModalSessionName.value || selectedSession.value;
  if (!selectedGameDetail.value || !activeSess) return [];
  const gIdx = selectedGameDetail.value.gameIndex;
  const gId = selectedGameDetail.value.gameId;
  return highlightsList.value.filter(r => {
    if (!matchHighlightSession(r.sessionName, activeSess)) return false;
    if (gId && r.gameId && r.gameId === gId) return true;
    if (gIdx && r.gameIndex && Number(r.gameIndex) === Number(gIdx)) return true;
    return false;
  });
});

// 개인 통계 모달 - 선택된 선수의 18종 역만 화료 통계 (이번 회차 / 전체 기간 연동)
const modalPlayerYakumanStats = computed(() => {
  if (!selectedPlayer.value) {
    return computePlayerYakumanStats([], '');
  }
  const sessFilter = (isModalFromSession.value && modalScopeTab.value === 'session')
    ? selectedSession.value
    : undefined;
  return computePlayerYakumanStats(highlightsList.value, selectedPlayer.value.name, sessFilter);
});

// ==========================================
// 6-1. 개인 통계 모달 - 자주 만나는 상대 & 상대별 맞대결 승률 팝오버
// ==========================================
const opponentsGameLimit = ref<number>(0); // 0 = 전체 대국, 100 = 최근 100대국, 50 = 최근 50대국
const activeOpponentStat = ref<OpponentHeadToHeadStat | null>(null);
const oppTooltipPos = ref({ x: 0, y: 0, visible: false });
const isOppTooltipBelow = ref(false);

const allTimeFrequentOpponents = computed(() => {
  if (!selectedPlayer.value) return { totalPlayerGames: 0, opponents: [] as OpponentHeadToHeadStat[] };
  return computeFrequentOpponentsStats(
    selectedPlayer.value.name,
    allRatingHistoryRecords.value,
    opponentsGameLimit.value > 0 ? opponentsGameLimit.value : undefined
  );
});

const sessionFrequentOpponents = computed(() => {
  if (!selectedPlayer.value || !currentSessionDetail.value?.games) {
    return { totalPlayerGames: 0, opponents: [] as OpponentHeadToHeadStat[] };
  }
  return computeFrequentOpponentsStats(
    selectedPlayer.value.name,
    currentSessionDetail.value.games
  );
});

const formatOpponentPct = (pct: number | undefined): string => {
  if (!pct || pct === 0) return '0%';
  return `${Number(pct).toFixed(2)}%`;
};

const formatSignedUma = (uma: number | undefined): string => {
  const v = Number(uma || 0);
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
};

const onHoverOpponent = (e: MouseEvent, opp: OpponentHeadToHeadStat) => {
  activeOpponentStat.value = opp;
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const screenW = typeof window !== 'undefined' ? window.innerWidth : 360;
  const rawX = rect.left + rect.width / 2;
  const clampedX = Math.max(150, Math.min(screenW - 150, rawX));

  if (rect.top < 290) {
    isOppTooltipBelow.value = true;
    oppTooltipPos.value = {
      x: clampedX,
      y: rect.bottom + 10,
      visible: true,
    };
  } else {
    isOppTooltipBelow.value = false;
    oppTooltipPos.value = {
      x: clampedX,
      y: rect.top - 10,
      visible: true,
    };
  }
};

const onLeaveOpponent = () => {
  oppTooltipPos.value.visible = false;
  activeOpponentStat.value = null;
};

const onToggleOpponent = (e: MouseEvent, opp: OpponentHeadToHeadStat) => {
  if (oppTooltipPos.value.visible && activeOpponentStat.value?.opponentName === opp.opponentName) {
    onLeaveOpponent();
  } else {
    onHoverOpponent(e, opp);
  }
};

watch([selectedPlayer, modalActiveTab, sessionModalActiveTab, modalScopeTab], () => {
  onLeaveOpponent();
});

// 갤러리 수동 새로고침
const isRefreshingGallery = ref(false);
const refreshGalleryData = async () => {
  if (isRefreshingGallery.value) return;
  isRefreshingGallery.value = true;
  try {
    const fresh = await fetchHighlights(true);
    highlightsList.value = fresh;
    highlightStorageTick.value++;
    showToast('갤러리 목록이 새로고침되었습니다.');
  } catch {
    showToast('갤러리 새로고침에 실패했습니다.');
  } finally {
    isRefreshingGallery.value = false;
  }
};

// 갤러리 탭 필터링된 목록
const filteredGalleryHighlights = computed(() => {
  const aliases = memberAliasesMap.value;
  return highlightsList.value.filter(rec => {
    if (galleryCategoryFilter.value !== 'all' && rec.category !== galleryCategoryFilter.value) {
      return false;
    }
    if (gallerySessionFilter.value && !matchHighlightSession(rec.sessionName, gallerySessionFilter.value)) {
      return false;
    }
    if (galleryPlayerFilter.value) {
      const target = galleryPlayerFilter.value.trim();
      const matched =
        isSameOrAliasedMember(rec.winnerName, target, aliases) ||
        isSameOrAliasedMember(rec.loserName, target, aliases) ||
        isSameOrAliasedMember(rec.uploaderName, target, aliases);
      if (!matched) {
        return false;
      }
    }
    return true;
  });
});

// 갤러리 상단 요약 지표
const gallerySummaryStats = computed(() => {
  const yakumanRecs = highlightsList.value.filter(r => r.category === 'yakuman');
  const funRecs = highlightsList.value.filter(r => r.category === 'fun');
  const nanikiruRecs = highlightsList.value.filter(r => r.category === 'nanikiru');
  const sessionRecs = highlightsList.value.filter(r => r.category === 'session');
  return {
    totalCount: highlightsList.value.length,
    yakumanCount: yakumanRecs.length,
    funPhotoCount: funRecs.length,
    nanikiruCount: nanikiruRecs.length,
    sessionPhotoCount: sessionRecs.length,
  };
});

const formatStorageBytes = (bytes: number): string => {
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const highlightStorageTick = ref(0);
const handleHighlightStorageUpdated = () => {
  highlightStorageTick.value++;
};
const handleMemberAliasesUpdated = () => {
  memberAliasesMap.value = { ...getMemberAliases() };
  highlightStorageTick.value++;
};
onMounted(() => {
  if (typeof window !== 'undefined') {
    window.addEventListener('mahjong_highlight_storage_updated', handleHighlightStorageUpdated);
    window.addEventListener('mahjong_member_aliases_updated', handleMemberAliasesUpdated);
  }
});
onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('mahjong_highlight_storage_updated', handleHighlightStorageUpdated);
    window.removeEventListener('mahjong_member_aliases_updated', handleMemberAliasesUpdated);
  }
});

const galleryStorageStats = computed(() => {
  void highlightStorageTick.value;
  const info = getHighlightStorageInfo(highlightsList.value);
  const externalBytes = info.externalR2Bytes ?? 0;
  const externalUsedPercent =
    info.externalUsedPercent ?? Number(((externalBytes / info.maxBytes) * 100).toFixed(2));
  const totalAccountUsedPercent = Number((info.usedPercent + externalUsedPercent).toFixed(2));
  const maxMB = (info.maxBytes / (1024 * 1024)).toFixed(0);
  const maxGB = (info.maxBytes / (1024 * 1024 * 1024)).toFixed(1);
  const remainingMB = (info.remainingBytes / (1024 * 1024)).toFixed(1);
  const remainingPercent = Number(Math.max(0, 100 - totalAccountUsedPercent).toFixed(2));
  const barWidthPct = info.usedBytes > 0 ? Math.min(100, Math.max(0.8, info.usedPercent)) : 0;
  const externalBarWidthPct =
    externalBytes > 0
      ? Math.min(Math.max(0, 100 - barWidthPct), Math.max(0.8, externalUsedPercent))
      : 0;
  return {
    ...info,
    externalR2Bytes: externalBytes,
    externalUsedText: formatStorageBytes(externalBytes),
    externalUsedPercent,
    totalAccountUsedPercent,
    usedText: formatStorageBytes(info.usedBytes),
    imageBytesText: formatStorageBytes(info.imageBytes ?? 0),
    otherKvBytesText: formatStorageBytes(info.otherKvBytes ?? 0),
    maxText: `${Number(maxMB).toLocaleString()} MB (${maxGB} GB)`,
    remainingText: `${Number(remainingMB).toLocaleString()} MB`,
    remainingPercent,
    barWidthPct,
    externalBarWidthPct,
  };
});

// 특정 경기에 역만/화료/기타 기록이 있는지 뱃지 표시용 헬퍼
const getGameHighlights = (game: SessionGame): HighlightRecord[] => {
  if (!selectedSession.value) return [];
  return currentSessionHighlights.value.filter(r => {
    if (game.gameId && r.gameId && r.gameId === game.gameId) return true;
    if (game.gameIndex && r.gameIndex && Number(r.gameIndex) === Number(game.gameIndex)) return true;
    return false;
  });
};

// 현재 선택된 회차에서 역만 화료 추정(오야 48,000점 / 자 32,000점 이상)이 감지된 경기 번호 집합
const sessionEstimatedYakumanGameIndices = ref<Set<number>>(new Set());
let sessionYakumanScanReqId = 0;

// 업로드 모달 상태 및 기본 선택 인원 고정 (localStorage)
const DEFAULT_UPLOAD_PLAYER_KEY = 'mahjong_default_upload_player';
const getSavedDefaultUploadPlayer = (): string => {
  try {
    return localStorage.getItem(DEFAULT_UPLOAD_PLAYER_KEY)?.trim() || '';
  } catch {
    return '';
  }
};
const saveDefaultUploadPlayer = (playerName: string): void => {
  const clean = playerName.trim();
  if (!clean) return;
  try {
    localStorage.setItem(DEFAULT_UPLOAD_PLAYER_KEY, clean);
  } catch {
    // ignore storage errors
  }
};

const isHighlightUploadModalOpen = ref(false);
const isSubmittingHighlight = ref(false);
const highlightUploadError = ref('');
const uploadModalSessionDetail = ref<SessionDetail | null>(null);
const uploadModalGameDetail = ref<GameDetailRecord | null>(null);
const uploadModalGameViewMode = ref<'sheet' | 'chart'>('sheet');
const isLoadingUploadGameDetail = ref(false);
let uploadModalSessionReqId = 0;
let uploadModalGameReqId = 0;

const uploadModalChartOptions = computed<ChartOptions<'line'>>(() => {
  const textColor = isDark.value ? '#f1f5f9' : '#1e293b';
  const tickColor = isDark.value ? '#94a3b8' : '#64748b';
  const gridColor = isDark.value ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';

  const datasets = uploadModalGameDetail.value?.chartData?.datasets || [];
  const allScores = datasets.flatMap(d => d.data);
  const minScore = allScores.length > 0 ? Math.min(...allScores, 25000) : 20000;
  const maxScore = allScores.length > 0 ? Math.max(...allScores, 25000) : 30000;
  const pad = Math.max(3000, Math.round((maxScore - minScore) * 0.1));

  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 400, easing: 'easeOutQuart' },
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: {
        ticks: { autoSkip: false, color: tickColor, font: { family: "'Noto Serif KR', serif" } },
        grid: { color: gridColor }
      },
      y: {
        suggestedMin: Math.floor((minScore - pad) / 1000) * 1000,
        suggestedMax: Math.ceil((maxScore + pad) / 1000) * 1000,
        ticks: {
          color: tickColor,
          font: { family: "'Noto Serif KR', serif" },
          callback: (value) => Number(value).toLocaleString() + '점',
        },
        grid: { color: gridColor }
      }
    },
    plugins: {
      legend: {
        position: 'top',
        labels: {
          usePointStyle: true,
          pointStyle: 'rectRounded',
          color: textColor,
          font: { family: "'Noto Serif KR', serif", size: 12 },
        }
      },
      tooltip: {
        backgroundColor: isDark.value ? '#1e293b' : '#ffffff',
        titleColor: isDark.value ? '#f8fafc' : '#0f172a',
        bodyColor: isDark.value ? '#e2e8f0' : '#334155',
        borderColor: isDark.value ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)',
        borderWidth: 1,
        callbacks: {
          label: (context) => `${context.dataset.label}: ${Number(context.parsed.y).toLocaleString()}점`
        }
      }
    }
  };
});

const formatRoundStatusLabel = (status: string): string => {
  const s = (status || '').toLowerCase();
  if (s.includes('tsumo')) return '쯔모';
  if (s.includes('ron')) return '론';
  if (s.includes('draw') || s.includes('ryuu')) return '유국';
  if (s.includes('chonbo') || s.includes('cheat')) return '촌보';
  return '';
};

const computeRoundWindSeat = (initialSeat: string, fallbackIdx: number, roundLabel: string): string => {
  const winds = ['東', '南', '西', '北'];
  const baseIdx = winds.indexOf(initialSeat) !== -1 ? winds.indexOf(initialSeat) : (fallbackIdx % 4);
  const kyokuMatch =
    (roundLabel || '').match(/(?:[동남서북東南西北]\s*)?(\d+)\s*(?:국|局)/) ||
    (roundLabel || '').match(/[동남서북東南西北]\s*(\d+)/);
  if (!kyokuMatch) return winds[baseIdx];
  const kyokuNum = Number(kyokuMatch[1]);
  const shift = (((kyokuNum - 1) % 4) + 4) % 4;
  return winds[(baseIdx - shift + 4) % 4];
};

const buildRoundMovementsFromGameDetail = (gDetail: GameDetailRecord | null): GameRoundMovement[] => {
  if (!gDetail || !gDetail.hasRoundDetails) return [];
  if (Array.isArray(gDetail.roundDetailsList) && gDetail.roundDetailsList.length > 0) {
    return gDetail.roundDetailsList;
  }

  const labels = gDetail.chartData?.labels || [];
  const datasets = gDetail.chartData?.datasets || [];
  const results: GameRoundMovement[] = [];
  const seatOrder = ['東', '南', '西', '北'];

  for (let k = 1; k < labels.length; k++) {
    const labelStr = labels[k] || `${k}국`;
    results.push({
      roundIndex: k,
      roundName: labelStr,
      roundStatus: '',
      players: gDetail.playerStats.map((ps, idx) => {
        const ds = datasets.find(d => d.label === ps.name) || datasets[idx];
        const scoreBefore = ds?.data[k - 1] ?? 25000;
        const scoreAfter = ds?.data[k] ?? scoreBefore;
        const startSeat = ps.seat || seatOrder[idx] || '';
        return {
          seat: computeRoundWindSeat(startSeat, idx, labelStr),
          name: ps.name,
          scoreBefore,
          deltaScore: scoreAfter - scoreBefore,
          scoreAfter,
          isRiichi: false,
          isWin: scoreAfter - scoreBefore > 0,
          isLose: scoreAfter - scoreBefore < -1000,
        };
      }),
    });
  }
  return results;
};

// 유국만관(Nagashi Mangan) 추정 판별:
// 유국(draw/ryuu) 상태에서 일반 텐파이 벌부(최대 +3,000점)를 넘어 단일 인원이 +6,000점 이상 획득하고
// 최소 2명 이상이 점수를 지불(2,000/4,000 또는 4,000 올 이동, 리치봉 공탁/본장 편차 포함)한 경우
const isEstimatedNagashiManganRound = (rm: GameRoundMovement): boolean => {
  const stLabel = formatRoundStatusLabel(rm.roundStatus);
  if (stLabel !== '유국') return false;
  const maxDelta = Math.max(...rm.players.map(p => p.deltaScore));
  const payersCount = rm.players.filter(p => p.deltaScore <= -1000).length;
  return maxDelta >= 6000 && payersCount >= 2;
};

// 국 선택 드롭다운 요약 포맷 (유국/유국만관 여부 / 화료자 +점수 / 방총자 -점수)
const formatRoundOptionSummary = (rm: GameRoundMovement | undefined): string => {
  if (!rm) return '';
  const stLabel = formatRoundStatusLabel(rm.roundStatus);
  if (stLabel === '유국') {
    if (isEstimatedNagashiManganRound(rm)) {
      const nagashiWinners = rm.players
        .filter(p => p.deltaScore >= 6000)
        .sort((a, b) => b.deltaScore - a.deltaScore);
      if (nagashiWinners.length > 0) {
        return ` — 유국만관 | ${nagashiWinners.map(w => `${w.name} +${w.deltaScore.toLocaleString()}`).join(', ')}`;
      }
      return ' — 유국만관';
    }
    return ' — 유국';
  }
  if (stLabel === '촌보') {
    const chonboPlayers = rm.players.filter(p => p.deltaScore < 0).sort((a, b) => a.deltaScore - b.deltaScore);
    if (chonboPlayers.length > 0) {
      return ` — 촌보 | ${chonboPlayers.map(p => `${p.name} ${p.deltaScore.toLocaleString()}`).join(', ')}`;
    }
    return ' — 촌보';
  }

  const explicitWinners = rm.players.filter(p => p.isWin);
  const winners = (explicitWinners.length > 0 ? explicitWinners : rm.players.filter(p => p.deltaScore > 0))
    .slice()
    .sort((a, b) => b.deltaScore - a.deltaScore);
  const losers = rm.players
    .filter(p => p.isLose)
    .slice()
    .sort((a, b) => a.deltaScore - b.deltaScore);

  if (winners.length === 0) {
    if (rm.players.every(p => p.deltaScore === 0)) {
      return stLabel ? ` — ${stLabel}` : ' — 유국';
    }
    const pos = rm.players.filter(p => p.deltaScore > 0).sort((a, b) => b.deltaScore - a.deltaScore);
    if (pos.length === 0) return stLabel ? ` — ${stLabel}` : '';
    return ` — ${stLabel || '유국'} | ${pos.map(p => `${p.name} +${p.deltaScore.toLocaleString()}`).join(', ')}`;
  }

  const winText = winners
    .map(w => `${w.name} ${w.deltaScore >= 0 ? '+' : ''}${w.deltaScore.toLocaleString()}`)
    .join(', ');
  const loseText = losers
    .map(l => `${l.name} ${l.deltaScore.toLocaleString()}`)
    .join(', ');
  const typePrefix = stLabel ? `${stLabel} | ` : '';

  if (loseText) {
    return ` — ${typePrefix}${winText} / ${loseText}`;
  }
  return ` — ${typePrefix}${winText}`;
};

// 회차 상세 -> 경기 상세 모달 내 국별 점수 이동 목록
const gameModalAllRoundMovements = computed<GameRoundMovement[]>(() => {
  return buildRoundMovementsFromGameDetail(selectedGameDetail.value);
});

const gameModalDisplayedRoundMovements = computed<GameRoundMovement[]>(() => {
  const all = gameModalAllRoundMovements.value;
  const sel = gameModalSelectedRound.value?.trim();
  if (!sel || sel === '__all__') return all;
  return all.filter(rm => rm.roundName.trim() === sel);
});

// 역만 화료 추정 판별 (해당 국 자풍 기준 오야 東: 48,000점 이상 / 자 南·西·北: 32,000점 이상)
const isEstimatedYakumanPlayer = (pm: { seat: string; deltaScore: number; isWin: boolean }): boolean => {
  if (!pm.isWin && pm.deltaScore < 32000) return false;
  const threshold = pm.seat === '東' ? 48000 : 32000;
  return pm.deltaScore >= threshold;
};

const isEstimatedYakumanRound = (rm: GameRoundMovement): boolean => {
  return rm.players.some(pm => isEstimatedYakumanPlayer(pm));
};

// 특정 국에서 특정 플레이어가 역만을 화료했는지 판별 (점수 기반 추정 또는 갤러리 등록 역만 기록 연동)
const isRoundPlayerYakuman = (
  rm: GameRoundMovement,
  pm: { seat: string; name: string; deltaScore: number; isWin: boolean },
  gDetail: GameDetailRecord | null,
  sessName?: string
): boolean => {
  if (isEstimatedYakumanPlayer(pm)) return true;
  const cleanPlayer = pm.name?.trim();
  const cleanSess = (sessName || selectedSession.value || '').trim();
  if (!cleanPlayer || !cleanSess || !gDetail) return false;
  const normRound = rm.roundName.replace(/\s*\(\d+차[^)]*\)\s*$/, '').trim();

  return highlightsList.value.some(hl => {
    if (hl.category !== 'yakuman') return false;
    if (!matchHighlightSession(hl.sessionName, cleanSess)) return false;
    const sameGame =
      (gDetail.gameId && hl.gameId && hl.gameId === gDetail.gameId) ||
      (gDetail.gameIndex !== undefined && hl.gameIndex !== undefined && Number(hl.gameIndex) === Number(gDetail.gameIndex));
    if (!sameGame) return false;
    if (hl.winnerName?.trim() !== cleanPlayer) return false;
    if (!hl.roundName) return false;
    const hlNormRound = hl.roundName.replace(/\s*\(\d+차[^)]*\)\s*$/, '').trim();
    return hl.roundName.trim() === rm.roundName.trim() || hlNormRound === normRound;
  });
};

// 특정 국에서 역만이 달성되었는지 판별 (점수 기반 추정 또는 갤러리 등록 역만 기록 연동)
const isRoundYakuman = (
  rm: GameRoundMovement,
  gDetail: GameDetailRecord | null,
  sessName?: string
): boolean => {
  if (isEstimatedYakumanRound(rm)) return true;
  const cleanSess = (sessName || selectedSession.value || '').trim();
  if (!cleanSess || !gDetail) return false;
  const normRound = rm.roundName.replace(/\s*\(\d+차[^)]*\)\s*$/, '').trim();

  return highlightsList.value.some(hl => {
    if (hl.category !== 'yakuman') return false;
    if (!matchHighlightSession(hl.sessionName, cleanSess)) return false;
    const sameGame =
      (gDetail.gameId && hl.gameId && hl.gameId === gDetail.gameId) ||
      (gDetail.gameIndex !== undefined && hl.gameIndex !== undefined && Number(hl.gameIndex) === Number(gDetail.gameIndex));
    if (!sameGame) return false;
    if (!hl.roundName) return false;
    const hlNormRound = hl.roundName.replace(/\s*\(\d+차[^)]*\)\s*$/, '').trim();
    return hl.roundName.trim() === rm.roundName.trim() || hlNormRound === normRound;
  });
};

// 특정 경기(결과 표)에서 특정 플레이어가 역만을 화료했는지 판별
const isPlayerYakumanInGame = (
  gDetail: GameDetailRecord | null,
  playerName: string,
  sessName?: string
): boolean => {
  const cleanPlayer = playerName?.trim();
  if (!gDetail || !cleanPlayer) return false;

  const allRounds = buildRoundMovementsFromGameDetail(gDetail);
  if (allRounds.some(rm => rm.players.some(pm => pm.name.trim() === cleanPlayer && isEstimatedYakumanPlayer(pm)))) {
    return true;
  }

  const cleanSess = (sessName || selectedSession.value || '').trim();
  if (!cleanSess) return false;

  return highlightsList.value.some(hl => {
    if (hl.category !== 'yakuman') return false;
    if (!matchHighlightSession(hl.sessionName, cleanSess)) return false;
    const sameGame =
      (gDetail.gameId && hl.gameId && hl.gameId === gDetail.gameId) ||
      (gDetail.gameIndex !== undefined && hl.gameIndex !== undefined && Number(hl.gameIndex) === Number(gDetail.gameIndex));
    if (!sameGame) return false;
    return hl.winnerName?.trim() === cleanPlayer;
  });
};

// 현재 선택된 회차의 경기별 역만 달성(추정 포함) 여부 백그라운드 스캔
const syncSessionEstimatedYakumanGames = async (sessName: string, games: SessionGame[]) => {
  const reqId = ++sessionYakumanScanReqId;
  if (!sessName || !Array.isArray(games) || games.length === 0) {
    sessionEstimatedYakumanGameIndices.value = new Set();
    return;
  }
  const detected = new Set<number>();
  try {
    await Promise.all(
      games.map(async (g) => {
        try {
          const detail = await fetchSessionGameDetail(sessName, g);
          const rounds = buildRoundMovementsFromGameDetail(detail);
          if (rounds.some(rm => isEstimatedYakumanRound(rm))) {
            detected.add(Number(g.gameIndex));
          }
        } catch {
          // ignore per-game error
        }
      })
    );
    if (reqId === sessionYakumanScanReqId) {
      sessionEstimatedYakumanGameIndices.value = detected;
    }
  } catch {
    // ignore scan error
  }
};

watch(
  () => [currentSessionDetail.value?.sessionName, currentSessionDetail.value?.games?.length] as const,
  () => {
    if (currentSessionDetail.value && Array.isArray(currentSessionDetail.value.games)) {
      syncSessionEstimatedYakumanGames(currentSessionDetail.value.sessionName, currentSessionDetail.value.games);
    } else {
      sessionEstimatedYakumanGameIndices.value = new Set();
    }
  },
  { immediate: true }
);

// 회차 상세 경기 카드에 '역만' 뱃지를 표시할지 여부 (등록된 역만 기록 또는 국별 기록상 역만 타점 존재 시)
const hasGameYakumanBadge = (game: SessionGame): boolean => {
  if (getGameHighlights(game).some(hl => hl.category === 'yakuman')) {
    return true;
  }
  return sessionEstimatedYakumanGameIndices.value.has(Number(game.gameIndex));
};

const findUploadRoundMovementByLabel = (roundLabel: string): GameRoundMovement | undefined => {
  const all = buildRoundMovementsFromGameDetail(uploadModalGameDetail.value);
  const rName = roundLabel.trim();
  return all.find(
    rm => rm.roundName.trim() === rName || rm.roundName.replace(/\s*\(\d+차[^)]*\)\s*$/, '').trim() === rName
  );
};

const getUploadRoundOptionLabel = (roundLabel: string): string => {
  const matched = findUploadRoundMovementByLabel(roundLabel);
  const summary = formatRoundOptionSummary(matched);
  const yakumanTag =
    uploadForm.value.category === 'yakuman' && matched && isEstimatedYakumanRound(matched)
      ? ' [역만 추정]'
      : '';
  return `${formatCardRoundKorean(roundLabel)}${summary}${yakumanTag}`;
};

const selectedUploadRoundMovements = computed<GameRoundMovement[]>(() => {
  const rName = uploadForm.value.roundName?.trim();
  const all = buildRoundMovementsFromGameDetail(uploadModalGameDetail.value);
  if (!rName || all.length === 0) return [];

  const exactMatched = all.filter(rm => rm.roundName.trim() === rName);
  if (exactMatched.length > 0) return exactMatched;
  const baseMatched = all.filter(
    rm => rm.roundName.replace(/\s*\(\d+차[^)]*\)\s*$/, '').trim() === rName
  );
  return baseMatched;
});

// 선택한 국의 화료자(복수 시 최고 득점자 우선), 화료 방식(쯔모/론), 방총자를 기본값으로 자동 반영
const applyUploadRoundWinnerDefaults = (rm: GameRoundMovement | undefined) => {
  if (!rm || uploadForm.value.category === 'session' || uploadForm.value.category === 'nanikiru') return;
  const explicitWinners = rm.players.filter(pm => pm.isWin);
  const positiveDeltaPlayers = rm.players.filter(pm => pm.deltaScore > 0);
  const winners = explicitWinners.length > 0 ? explicitWinners : positiveDeltaPlayers;

  if (winners.length > 0) {
    const sortedWinners = [...winners].sort((a, b) => b.deltaScore - a.deltaScore);
    const topWinner = sortedWinners[0];
    if (topWinner && topWinner.deltaScore > 0) {
      uploadForm.value.winnerName = topWinner.name;
    }
  }

  if (isEstimatedNagashiManganRound(rm)) {
    uploadForm.value.winType = 'tsumo';
    uploadForm.value.loserName = '';
    return;
  }

  const st = (rm.roundStatus || '').toLowerCase();
  const losers = rm.players.filter(pm => pm.isLose);
  if (st.includes('tsumo')) {
    uploadForm.value.winType = 'tsumo';
    uploadForm.value.loserName = '';
  } else if (st.includes('ron') || losers.length > 0) {
    uploadForm.value.winType = 'ron';
    if (losers.length > 0) {
      const sortedLosers = [...losers].sort((a, b) => a.deltaScore - b.deltaScore);
      uploadForm.value.loserName = sortedLosers[0].name;
    }
  }
};

// 특정 경기의 특정 국 역만이 이미 highlightsList에 등록되어 있는지 확인
const isYakumanRoundAlreadyRegistered = (
  sessName: string,
  gameIndex: number | undefined,
  gameId: string | undefined,
  roundName: string
): boolean => {
  const normRound = roundName.replace(/\s*\(\d+차[^)]*\)\s*$/, '').trim();
  return highlightsList.value.some(hl => {
    if (hl.category !== 'yakuman') return false;
    if (!matchHighlightSession(hl.sessionName, sessName)) return false;
    const sameGame =
      (gameId && hl.gameId && hl.gameId === gameId) ||
      (gameIndex !== undefined && hl.gameIndex !== undefined && Number(hl.gameIndex) === Number(gameIndex));
    if (!sameGame) return false;
    if (!hl.roundName) return true;
    const hlNormRound = hl.roundName.replace(/\s*\(\d+차[^)]*\)\s*$/, '').trim();
    return hl.roundName.trim() === roundName.trim() || hlNormRound === normRound;
  });
};

// 경기 내 '그 외 화료' 최적 포커싱 국 탐색:
// 1순위: 유국만관 추정 국 (isEstimatedNagashiManganRound)
// 2순위: 단일 플레이어 획득 점수(deltaScore)가 가장 높은 국
const findBestFunRoundInGame = (allRounds: GameRoundMovement[]): GameRoundMovement | undefined => {
  if (!Array.isArray(allRounds) || allRounds.length === 0) return undefined;

  const nagashiRounds = allRounds.filter(rm => isEstimatedNagashiManganRound(rm));
  if (nagashiRounds.length > 0) {
    return [...nagashiRounds].sort((a, b) => {
      const maxA = Math.max(...a.players.map(p => p.deltaScore));
      const maxB = Math.max(...b.players.map(p => p.deltaScore));
      return maxB - maxA;
    })[0];
  }

  const positiveRounds = allRounds.filter(rm => Math.max(...rm.players.map(p => p.deltaScore)) > 0);
  if (positiveRounds.length > 0) {
    return [...positiveRounds].sort((a, b) => {
      const maxA = Math.max(...a.players.map(p => p.deltaScore));
      const maxB = Math.max(...b.players.map(p => p.deltaScore));
      return maxB - maxA;
    })[0];
  }

  return allRounds[0];
};

// '그 외 화료' 모드에서 유국만관(1순위) 또는 최고 획득 점수 국(2순위)에 자동 포커싱
const tryAutoFocusFunRound = (): boolean => {
  const allRounds = buildRoundMovementsFromGameDetail(uploadModalGameDetail.value);
  if (allRounds.length === 0) return false;
  const bestFunRound = findBestFunRoundInGame(allRounds);
  if (bestFunRound) {
    uploadForm.value.roundName = bestFunRound.roundName;
    applyUploadRoundWinnerDefaults(bestFunRound);
    return true;
  }
  return false;
};

// 역만 등록 시 오야 48,000점 / 자 32,000점 이상 역만 화료 추정 국에 자동 포커싱 (미등록 국 우선)
const tryAutoFocusYakumanRound = (): boolean => {
  if (uploadForm.value.category !== 'yakuman') return false;
  const allRounds = buildRoundMovementsFromGameDetail(uploadModalGameDetail.value);
  if (allRounds.length === 0) return false;

  const yakumanRounds = allRounds.filter(rm => isEstimatedYakumanRound(rm));
  if (yakumanRounds.length === 0) return false;

  const sessName = uploadForm.value.sessionName;
  const gIdx = uploadForm.value.gameIndex;
  const gId = uploadForm.value.gameId;

  const unregisteredYakumanRounds = yakumanRounds.filter(
    rm => !isYakumanRoundAlreadyRegistered(sessName, gIdx, gId, rm.roundName)
  );
  const candidatePool = unregisteredYakumanRounds.length > 0 ? unregisteredYakumanRounds : yakumanRounds;

  const bestYakumanRound = [...candidatePool].sort((a, b) => {
    const maxA = Math.max(...a.players.map(p => p.deltaScore));
    const maxB = Math.max(...b.players.map(p => p.deltaScore));
    return maxB - maxA;
  })[0];

  if (bestYakumanRound) {
    uploadForm.value.roundName = bestYakumanRound.roundName;
    applyUploadRoundWinnerDefaults(bestYakumanRound);
    return true;
  }
  return false;
};

// 회차 단위 스마트 타겟 탐색:
// 1순위: 아직 역만 등록이 안 된 역만 추정 경기 및 국 -> category: 'yakuman'
// 2순위: 역만 추정 국이 없으면 '그 외 화료'(category: 'fun')로 전환하고, 유국만관 국(우선) 또는 최고 획득 점수 국 포커싱
const findTargetGameAndRoundForSession = async (
  sessName: string,
  games: SessionGame[],
  allowSwitchToFun = true
): Promise<{ category: HighlightCategory; gameIndex: number; roundName: string } | undefined> => {
  if (!sessName || !Array.isArray(games) || games.length === 0) return undefined;
  const sortedGames = [...games].sort((a, b) => Number(a.gameIndex) - Number(b.gameIndex));
  const fallbackFirstGameIndex = Number(sortedGames[0].gameIndex);

  let bestNagashiCandidate: { gameIndex: number; roundName: string; maxDelta: number } | null = null;
  let bestHighScoreCandidate: { gameIndex: number; roundName: string; maxDelta: number } | null = null;

  for (const g of sortedGames) {
    try {
      const detail = await fetchSessionGameDetail(sessName, g);
      const rounds = buildRoundMovementsFromGameDetail(detail);
      if (rounds.length === 0) continue;

      const yakumanRounds = rounds.filter(rm => isEstimatedYakumanRound(rm));
      if (yakumanRounds.length > 0) {
        const unregisteredYakuman = yakumanRounds.filter(
          rm => !isYakumanRoundAlreadyRegistered(sessName, g.gameIndex, g.gameId, rm.roundName)
        );
        if (unregisteredYakuman.length > 0) {
          const bestYm = [...unregisteredYakuman].sort((a, b) => {
            const maxA = Math.max(...a.players.map(p => p.deltaScore));
            const maxB = Math.max(...b.players.map(p => p.deltaScore));
            return maxB - maxA;
          })[0];
          return {
            category: 'yakuman',
            gameIndex: Number(g.gameIndex),
            roundName: bestYm.roundName,
          };
        }
      }

      for (const rm of rounds) {
        const maxDelta = Math.max(...rm.players.map(p => p.deltaScore));
        if (isEstimatedNagashiManganRound(rm)) {
          if (!bestNagashiCandidate || maxDelta > bestNagashiCandidate.maxDelta) {
            bestNagashiCandidate = {
              gameIndex: Number(g.gameIndex),
              roundName: rm.roundName,
              maxDelta,
            };
          }
        }
        if (maxDelta > 0) {
          if (!bestHighScoreCandidate || maxDelta > bestHighScoreCandidate.maxDelta) {
            bestHighScoreCandidate = {
              gameIndex: Number(g.gameIndex),
              roundName: rm.roundName,
              maxDelta,
            };
          }
        }
      }
    } catch {
      // ignore per-game lookup error
    }
  }

  if (allowSwitchToFun) {
    if (bestNagashiCandidate) {
      return {
        category: 'fun',
        gameIndex: bestNagashiCandidate.gameIndex,
        roundName: bestNagashiCandidate.roundName,
      };
    }
    if (bestHighScoreCandidate) {
      return {
        category: 'fun',
        gameIndex: bestHighScoreCandidate.gameIndex,
        roundName: bestHighScoreCandidate.roundName,
      };
    }
  }

  return {
    category: allowSwitchToFun ? 'fun' : 'yakuman',
    gameIndex: fallbackFirstGameIndex,
    roundName: '',
  };
};

let isInitializingUploadModal = false;
let hasUserInteractedWithUploadForm = false;
const markUploadFormUserInteracted = () => {
  hasUserInteractedWithUploadForm = true;
};

const uploadForm = ref<{
  category: HighlightCategory;
  sessionName: string;
  gameId: string;
  gameIndex: number | undefined;
  roundName: string;
  winnerName: string;
  loserName: string;
  winType: 'tsumo' | 'ron';
  yakumanTypes: string[];
  caption: string;
  uploaderName: string;
  uploadPin: string;
}>({
  category: 'yakuman',
  sessionName: '',
  gameId: '',
  gameIndex: undefined,
  roundName: '',
  winnerName: '',
  loserName: '',
  winType: 'tsumo',
  yakumanTypes: [],
  caption: '',
  uploaderName: '',
  uploadPin: '',
});

const selectedUploadFile = ref<File | null>(null);
const selectedUploadPreviewUrl = ref<string>('');
const selectedUploadDimensions = ref<string>('');
const highlightFileInputRef = ref<HTMLInputElement | null>(null);
const editingHighlightRecord = ref<HighlightRecord | null>(null);
const removeExistingHighlightImage = ref<boolean>(false);

// 선택된 회차의 실제 진행 경기 목록
const uploadModalGames = computed<SessionGame[]>(() => {
  const detail = uploadModalSessionDetail.value;
  if (!detail || !Array.isArray(detail.games)) return [];
  return [...detail.games].sort((a, b) => Number(a.gameIndex) - Number(b.gameIndex));
});

// 업로드 모달 내 인원 선택 후보 목록 (해당 회차에 참여한 인원만 표시)
const uploadCandidatePlayers = computed<string[]>(() => {
  const names = new Set<string>();
  const detail = uploadModalSessionDetail.value;
  const gIdx = uploadForm.value.gameIndex;

  // 1) 선택된 경기가 있으면 해당 경기 대국자 4명을 최상단에 우선 배치
  if (detail && gIdx !== undefined) {
    const matchedGame = detail.games.find(g => Number(g.gameIndex) === Number(gIdx));
    if (matchedGame && Array.isArray(matchedGame.players)) {
      matchedGame.players.forEach(p => {
        if (p.name?.trim()) names.add(p.name.trim());
      });
    }
  } else if (selectedGameDetail.value && gIdx !== undefined && Number(gIdx) === Number(selectedGameDetail.value.gameIndex)) {
    selectedGameDetail.value.playerStats.forEach(p => {
      if (p.name?.trim()) names.add(p.name.trim());
    });
  }

  // 2) 해당 회차에 참여한 전체 인원 추가
  if (detail) {
    if (Array.isArray(detail.members)) {
      detail.members.forEach(m => {
        if (m.name?.trim()) names.add(m.name.trim());
      });
    }
    if (Array.isArray(detail.games)) {
      detail.games.forEach(g => {
        g.players?.forEach(p => {
          if (p.name?.trim()) names.add(p.name.trim());
        });
      });
    }
  } else if (currentSessionDetail.value && matchHighlightSession(currentSessionDetail.value.sessionName, uploadForm.value.sessionName)) {
    currentSessionDetail.value.members.forEach(m => {
      if (m.name?.trim()) names.add(m.name.trim());
    });
    currentSessionDetail.value.games.forEach(g => {
      g.players?.forEach(p => {
        if (p.name?.trim()) names.add(p.name.trim());
      });
    });
  } else if (!uploadForm.value.sessionName) {
    allStats.value.forEach(m => {
      if (m.name?.trim()) names.add(m.name.trim());
    });
  }

  if (editingHighlightRecord.value) {
    if (editingHighlightRecord.value.winnerName?.trim()) {
      names.add(editingHighlightRecord.value.winnerName.trim());
    }
    if (editingHighlightRecord.value.loserName?.trim()) {
      names.add(editingHighlightRecord.value.loserName.trim());
    }
  }

  return Array.from(names);
});

// 업로드 모달 내 국 선택 후보 목록 (점수 변동 그래프 라벨 연동)
const uploadCandidateRounds = computed<string[]>(() => {
  if (uploadModalGameDetail.value && uploadModalGameDetail.value.hasRoundDetails && uploadModalGameDetail.value.chartData?.labels?.length) {
    const rounds = uploadModalGameDetail.value.chartData.labels.filter(l => l && l !== '시작');
    if (rounds.length > 0) return rounds;
  }
  if (
    selectedGameDetail.value &&
    selectedGameDetail.value.hasRoundDetails &&
    uploadForm.value.gameIndex !== undefined &&
    Number(uploadForm.value.gameIndex) === Number(selectedGameDetail.value.gameIndex)
  ) {
    const rounds = selectedGameDetail.value.chartData.labels.filter(l => l && l !== '시작');
    if (rounds.length > 0) return rounds;
  }
  return [
    '동1국 0본장',
    '동2국 0본장',
    '동3국 0본장',
    '동4국 0본장',
    '남1국 0본장',
    '남2국 0본장',
    '남3국 0본장',
    '남4국 0본장',
  ];
});

// 회차 참여 인원이 갱신될 때 저장된 기본 인원을 자동 적용
const syncDefaultUploadPlayerForCandidates = () => {
  if (editingHighlightRecord.value) return;
  const candidates = uploadCandidatePlayers.value;
  if (candidates.length === 0) return;

  const currentWinner = uploadForm.value.winnerName.trim();
  if (currentWinner && candidates.includes(currentWinner)) {
    return;
  }

  const savedDefault = getSavedDefaultUploadPlayer();
  if (savedDefault && candidates.includes(savedDefault)) {
    uploadForm.value.winnerName = savedDefault;
  } else if (currentWinner && !candidates.includes(currentWinner)) {
    uploadForm.value.winnerName = '';
  }

  if (uploadForm.value.loserName && !candidates.includes(uploadForm.value.loserName)) {
    uploadForm.value.loserName = '';
  }
};

// 업로드 모달 내 국 이름이 후보 리스트와 일치하도록 정규화하고 미지정 시 스마트 포커싱 수행
const resolveAndApplyUploadRoundSelection = (preserveRound: boolean, allowSwitchToFunWhenNoYakuman = false) => {
  const candidates = uploadCandidateRounds.value;
  const currentRound = (uploadForm.value.roundName || '').trim();

  if (currentRound) {
    const exact = candidates.find(c => c.trim() === currentRound);
    const baseMatch =
      exact ||
      candidates.find(
        c => c.replace(/\s*\(\d+차[^)]*\)\s*$/, '').trim() === currentRound.replace(/\s*\(\d+차[^)]*\)\s*$/, '').trim()
      );
    if (baseMatch) {
      uploadForm.value.roundName = baseMatch;
      if (selectedUploadRoundMovements.value.length > 0) {
        applyUploadRoundWinnerDefaults(selectedUploadRoundMovements.value[0]);
      }
      return;
    }
    if (!preserveRound) {
      uploadForm.value.roundName = '';
    } else {
      return;
    }
  }

  if (!uploadForm.value.roundName) {
    if (uploadForm.value.category === 'yakuman') {
      const focusedYakuman = tryAutoFocusYakumanRound();
      if (!focusedYakuman) {
        if (allowSwitchToFunWhenNoYakuman) {
          isInitializingUploadModal = true;
          uploadForm.value.category = 'fun';
          nextTick(() => {
            isInitializingUploadModal = false;
          });
        }
        tryAutoFocusFunRound();
      }
    } else if (uploadForm.value.category === 'fun') {
      tryAutoFocusFunRound();
    }
  }
};

// 특정 경기 선택 시 해당 경기의 결과표, 점수 변동 그래프, 국별 기록 로드
const syncUploadModalGameRounds = async (
  gameIdx: number | undefined,
  preserveRound = false,
  allowSwitchToFunWhenNoYakuman = false
) => {
  const reqId = ++uploadModalGameReqId;
  const sessName = uploadForm.value.sessionName;
  if (!sessName || gameIdx === undefined) {
    uploadModalGameDetail.value = null;
    isLoadingUploadGameDetail.value = false;
    uploadForm.value.gameId = '';
    if (!preserveRound) uploadForm.value.roundName = '';
    return;
  }

  const matchedGame = uploadModalGames.value.find(g => Number(g.gameIndex) === Number(gameIdx));
  if (!matchedGame) {
    uploadModalGameDetail.value = null;
    isLoadingUploadGameDetail.value = false;
    uploadForm.value.gameId = '';
    return;
  }

  uploadForm.value.gameId = matchedGame.gameId || '';

  // 1) 이미 업로드 모달에 동일 경기의 세부 국별 데이터가 로드되어 있으면 옵션 리스트 리셋 없이 즉시 재사용
  if (
    uploadModalGameDetail.value &&
    uploadModalGameDetail.value.hasRoundDetails &&
    Number(uploadModalGameDetail.value.gameIndex) === Number(gameIdx)
  ) {
    isLoadingUploadGameDetail.value = false;
    if (!hasUserInteractedWithUploadForm || !preserveRound) {
      resolveAndApplyUploadRoundSelection(preserveRound, allowSwitchToFunWhenNoYakuman);
    }
    return;
  }

  // 2) 이미 열려 있는 대국 상세 모달과 동일 경기이고 상세 데이터가 있으면 즉시 재사용
  if (
    selectedGameDetail.value &&
    selectedGameDetail.value.hasRoundDetails &&
    Number(selectedGameDetail.value.gameIndex) === Number(gameIdx) &&
    matchHighlightSession(selectedSession.value, sessName)
  ) {
    uploadModalGameDetail.value = selectedGameDetail.value;
    isLoadingUploadGameDetail.value = false;
    resolveAndApplyUploadRoundSelection(preserveRound, allowSwitchToFunWhenNoYakuman);
    return;
  }

  uploadModalGameViewMode.value = 'sheet';

  // 초기 기본 결과표 즉시 렌더링 (단, 기존 동일 경기 객체가 없을 때만 스켈레톤 세팅)
  if (!uploadModalGameDetail.value || Number(uploadModalGameDetail.value.gameIndex) !== Number(gameIdx)) {
    const seatOrder = ['東', '南', '西', '北'];
    const sortedPlayers = [...matchedGame.players].sort((a, b) => seatOrder.indexOf(a.seat) - seatOrder.indexOf(b.seat));
    uploadModalGameDetail.value = {
      gameId: matchedGame.gameId,
      gameIndex: matchedGame.gameIndex,
      time: matchedGame.time,
      hasRoundDetails: false,
      playerStats: sortedPlayers.map((p, idx) => ({
        seat: p.seat || seatOrder[idx],
        name: p.name,
        rank: p.rank,
        score: p.score,
        uma: p.uma,
        ratingBefore: p.ratingBefore,
        ratingAfter: p.ratingAfter,
        ratingDelta: p.ratingDelta,
        cntRiichi: 0,
        cntRon: 0,
        cntTsumo: 0,
        cntLose: 0,
      })),
      chartData: { labels: [], datasets: [] },
      roundDetailsList: [],
    };
  }

  isLoadingUploadGameDetail.value = true;
  try {
    const detail = await fetchSessionGameDetail(sessName, matchedGame);
    if (reqId !== uploadModalGameReqId) return;
    detail.playerStats.forEach(dp => {
      if (dp.ratingBefore === undefined) {
        const orig = matchedGame.players.find(gp => gp.name === dp.name);
        if (orig) {
          dp.ratingBefore = orig.ratingBefore;
          dp.ratingAfter = orig.ratingAfter;
          dp.ratingDelta = orig.ratingDelta;
        }
      }
    });
    uploadModalGameDetail.value = detail;
    if (!hasUserInteractedWithUploadForm || !preserveRound) {
      resolveAndApplyUploadRoundSelection(preserveRound, allowSwitchToFunWhenNoYakuman);
    }
  } catch (err) {
    console.warn('업로드 모달 경기 국별 정보 조회 실패:', err);
  } finally {
    if (reqId === uploadModalGameReqId) {
      isLoadingUploadGameDetail.value = false;
    }
  }
};

// 모달에서 선택된 회차의 실제 경기 목록 및 참여 인원 로드
const syncUploadModalSessionData = async (sessName: string, isInitialOpen = false) => {
  const reqId = ++uploadModalSessionReqId;
  if (!sessName) {
    uploadModalSessionDetail.value = null;
    uploadModalGameDetail.value = null;
    return;
  }

  // 1) 현재 로드된 회차 상세 또는 레이팅 히스토리 캐시에서 즉시 반영
  const hasFullCurrentSession = Boolean(
    currentSessionDetail.value &&
    matchHighlightSession(currentSessionDetail.value.sessionName, sessName) &&
    currentSessionDetail.value.games.length > 0
  );

  if (hasFullCurrentSession && currentSessionDetail.value) {
    uploadModalSessionDetail.value = currentSessionDetail.value;
  } else {
    const optimistic = buildSessionDetailFromRatingHistory(sessName);
    if (optimistic && (optimistic.games.length > 0 || optimistic.members.length > 0)) {
      uploadModalSessionDetail.value = optimistic;
    } else {
      uploadModalSessionDetail.value = null;
    }
  }

  syncDefaultUploadPlayerForCandidates();
  if (uploadForm.value.gameIndex !== undefined) {
    await syncUploadModalGameRounds(uploadForm.value.gameIndex, isInitialOpen, isInitialOpen && !uploadForm.value.roundName && uploadForm.value.category === 'yakuman');
  } else if (
    (uploadForm.value.category === 'yakuman' || uploadForm.value.category === 'fun') &&
    uploadModalSessionDetail.value &&
    uploadModalSessionDetail.value.games.length > 0
  ) {
    const target = await findTargetGameAndRoundForSession(
      sessName,
      uploadModalSessionDetail.value.games,
      isInitialOpen
    );
    if (reqId !== uploadModalSessionReqId) return;
    if (target && uploadForm.value.gameIndex === undefined && !hasUserInteractedWithUploadForm) {
      isInitializingUploadModal = true;
      uploadForm.value.category = target.category;
      uploadForm.value.gameIndex = target.gameIndex;
      if (target.roundName) {
        uploadForm.value.roundName = target.roundName;
      }
      await syncUploadModalGameRounds(target.gameIndex, true, false);
      await nextTick();
      isInitializingUploadModal = false;
    }
  }

  // 이미 현재 회차의 전체 대국 데이터가 메모리에 로드되어 있다면,
  // 불필요한 백그라운드 재할당으로 인해 열려 있는 <select> 드롭다운이 닫히는 현상을 방지
  if (hasFullCurrentSession) {
    return;
  }

  // 2) 서버/시트에서 실제 회차 상세 및 레이팅 기록 비동기 조회하여 최신 반영
  try {
    const [detail, historyRecords] = await Promise.all([
      fetchPublicSessionDetail(sessName),
      fetchPublicRatingHistoryRecords()
    ]);
    if (reqId !== uploadModalSessionReqId) return;
    if (detail && detail.games && historyRecords.length > 0) {
      attachRatingToSessionGames(sessName, detail.games, historyRecords);
    }
    if (detail && (detail.games.length > 0 || detail.members.length > 0)) {
      const hadNoGamesBefore = !uploadModalSessionDetail.value || uploadModalSessionDetail.value.games.length === 0;
      uploadModalSessionDetail.value = detail;
      if (!hasUserInteractedWithUploadForm) {
        syncDefaultUploadPlayerForCandidates();
      }
      if (uploadForm.value.gameIndex !== undefined) {
        const exists = detail.games.some(g => Number(g.gameIndex) === Number(uploadForm.value.gameIndex));
        if (!exists && !hasUserInteractedWithUploadForm) {
          uploadForm.value.gameIndex = undefined;
          uploadForm.value.gameId = '';
          uploadForm.value.roundName = '';
          uploadModalGameDetail.value = null;
        } else if (
          exists &&
          (!uploadModalGameDetail.value ||
            !uploadModalGameDetail.value.hasRoundDetails ||
            Number(uploadModalGameDetail.value.gameIndex) !== Number(uploadForm.value.gameIndex)) &&
          !isLoadingUploadGameDetail.value
        ) {
          await syncUploadModalGameRounds(uploadForm.value.gameIndex, true, false);
        }
      } else if (
        hadNoGamesBefore &&
        !hasUserInteractedWithUploadForm &&
        (uploadForm.value.category === 'yakuman' || uploadForm.value.category === 'fun') &&
        detail.games.length > 0
      ) {
        const target = await findTargetGameAndRoundForSession(sessName, detail.games, isInitialOpen);
        if (reqId !== uploadModalSessionReqId) return;
        if (target && uploadForm.value.gameIndex === undefined && !hasUserInteractedWithUploadForm) {
          isInitializingUploadModal = true;
          uploadForm.value.category = target.category;
          uploadForm.value.gameIndex = target.gameIndex;
          if (target.roundName) {
            uploadForm.value.roundName = target.roundName;
          }
          await syncUploadModalGameRounds(target.gameIndex, true, false);
          await nextTick();
          isInitializingUploadModal = false;
        }
      }
    }
  } catch (err) {
    console.warn('업로드 모달 회차 상세 조회 실패:', err);
  }
};

watch(() => uploadForm.value.sessionName, (newSess, oldSess) => {
  if (!isHighlightUploadModalOpen.value || isInitializingUploadModal) return;
  if (newSess !== oldSess) {
    hasUserInteractedWithUploadForm = false;
    uploadForm.value.gameIndex = undefined;
    uploadForm.value.gameId = '';
    uploadForm.value.roundName = '';
    uploadModalGameDetail.value = null;
    syncUploadModalSessionData(newSess, false);
  }
});

watch(() => uploadForm.value.gameIndex, (newGameIdx, oldGameIdx) => {
  if (!isHighlightUploadModalOpen.value || isInitializingUploadModal) return;
  if (newGameIdx !== oldGameIdx) {
    uploadForm.value.roundName = '';
    syncUploadModalGameRounds(newGameIdx, false, false);
    syncDefaultUploadPlayerForCandidates();
  }
});

// 국 선택 시 해당 국의 화료자(복수 시 최고 득점자), 화료 방식(쯔모/론), 방총자를 자동으로 기본 선택
watch(() => uploadForm.value.roundName, (newRound) => {
  if (!isHighlightUploadModalOpen.value || isInitializingUploadModal || !newRound) return;
  if (selectedUploadRoundMovements.value.length > 0) {
    applyUploadRoundWinnerDefaults(selectedUploadRoundMovements.value[0]);
  }
});

// 분류 전환 시 역만 추정 경기/국 또는 그 외 화료(유국만관/최고 득점 국)에 자동 포커싱
watch(() => uploadForm.value.category, async (newCat, oldCat) => {
  if (newCat !== oldCat) {
    if (newCat === 'yakuman') {
      uploadForm.value.yakumanTypes = uploadForm.value.yakumanTypes.filter(t =>
        YAKUMAN_DEFINITIONS.some(y => y.key === t)
      );
    } else if (newCat === 'nanikiru') {
      uploadForm.value.yakumanTypes = uploadForm.value.yakumanTypes.filter(t =>
        NANIKIRU_TAG_DEFINITIONS.includes(t)
      );
      uploadForm.value.loserName = '';
    } else {
      uploadForm.value.yakumanTypes = [];
    }
    if (newCat !== 'session' && !uploadForm.value.sessionName) {
      const rawSess = selectedSession.value || displayedAvailableSessions.value[0] || '';
      const matchedOpt = displayedAvailableSessions.value.find(s => matchHighlightSession(s, rawSess));
      uploadForm.value.sessionName = matchedOpt || rawSess;
    }
  }
  if (!isHighlightUploadModalOpen.value || isInitializingUploadModal) return;
  if (newCat === 'yakuman') {
    if (uploadForm.value.gameIndex === undefined && uploadModalGames.value.length > 0) {
      const target = await findTargetGameAndRoundForSession(
        uploadForm.value.sessionName,
        uploadModalGames.value,
        false
      );
      if (target && uploadForm.value.gameIndex === undefined) {
        isInitializingUploadModal = true;
        uploadForm.value.gameIndex = target.gameIndex;
        if (target.roundName) uploadForm.value.roundName = target.roundName;
        await syncUploadModalGameRounds(target.gameIndex, !!target.roundName, false);
        await nextTick();
        isInitializingUploadModal = false;
      }
    } else {
      tryAutoFocusYakumanRound();
    }
  } else if (newCat === 'fun') {
    if (uploadForm.value.gameIndex === undefined && uploadModalGames.value.length > 0) {
      isInitializingUploadModal = true;
      uploadForm.value.gameIndex = Number(uploadModalGames.value[0].gameIndex);
      await syncUploadModalGameRounds(uploadForm.value.gameIndex, false, false);
      await nextTick();
      isInitializingUploadModal = false;
    } else if (
      !uploadForm.value.roundName ||
      (selectedUploadRoundMovements.value.length > 0 && isEstimatedYakumanRound(selectedUploadRoundMovements.value[0]))
    ) {
      tryAutoFocusFunRound();
    }
  }
});

// 인원을 한 번 선택하면 기본 인원으로 고정 저장
watch(() => uploadForm.value.winnerName, (newWinner) => {
  if (newWinner && newWinner.trim()) {
    saveDefaultUploadPlayer(newWinner);
  }
});

// 대국 상세 모달에서 '역만 / 사진 등록' 클릭 시 현재 보고 있는 탭/국 및 역만 타점 여부에 따라 분류 및 국 스마트 포커싱
const handleOpenUploadFromGameModal = () => {
  const gDetail = selectedGameDetail.value;
  if (!gDetail) return;
  const targetSession = gameModalSessionName.value || selectedSession.value;

  let activeRoundName = '';
  if (gameModalMode.value === 'rounds') {
    if (gameModalSelectedRound.value && gameModalSelectedRound.value !== '__all__') {
      activeRoundName = gameModalSelectedRound.value.trim();
    } else if (gameModalAllRoundMovements.value.length === 1) {
      activeRoundName = gameModalAllRoundMovements.value[0].roundName.trim();
    }
  }

  // 1) '국별 점수 이동' 탭에서 특정 국을 선택해 보고 있는 경우: 해당 국으로 바로 포커싱
  if (activeRoundName) {
    const matchedRm = gameModalAllRoundMovements.value.find(
      rm => rm.roundName.trim() === activeRoundName
    );
    const isYakuman = matchedRm ? isEstimatedYakumanRound(matchedRm) : false;
    openHighlightUploadModal({
      category: isYakuman ? 'yakuman' : 'fun',
      sessionName: targetSession,
      gameId: gDetail.gameId,
      gameIndex: gDetail.gameIndex,
      roundName: activeRoundName,
    });
    return;
  }

  // 2) 전체 국 / 결과 표 / 점수 변동 그래프를 보고 있는 경우:
  // 역만 추정 국이 있으면 '역만' + 해당 국 포커싱, 없으면 '그 외 화료' + 유국만관(1순위) / 최고 획득 점수 국(2순위) 포커싱
  if (gameModalAllRoundMovements.value.length > 0) {
    const yakumanRounds = gameModalAllRoundMovements.value.filter(rm => isEstimatedYakumanRound(rm));
    if (yakumanRounds.length > 0) {
      const unregisteredYm = yakumanRounds.filter(
        rm => !isYakumanRoundAlreadyRegistered(targetSession, gDetail.gameIndex, gDetail.gameId, rm.roundName)
      );
      const ymPool = unregisteredYm.length > 0 ? unregisteredYm : yakumanRounds;
      const bestYm = [...ymPool].sort((a, b) => {
        const maxA = Math.max(...a.players.map(p => p.deltaScore));
        const maxB = Math.max(...b.players.map(p => p.deltaScore));
        return maxB - maxA;
      })[0];
      openHighlightUploadModal({
        category: 'yakuman',
        sessionName: targetSession,
        gameId: gDetail.gameId,
        gameIndex: gDetail.gameIndex,
        roundName: bestYm?.roundName || '',
      });
    } else {
      const bestFunRound = findBestFunRoundInGame(gameModalAllRoundMovements.value);
      openHighlightUploadModal({
        category: 'fun',
        sessionName: targetSession,
        gameId: gDetail.gameId,
        gameIndex: gDetail.gameIndex,
        roundName: bestFunRound?.roundName || gameModalAllRoundMovements.value[0].roundName,
      });
    }
    return;
  }

  openHighlightUploadModal({
    category: 'yakuman',
    sessionName: targetSession,
    gameId: gDetail.gameId,
    gameIndex: gDetail.gameIndex,
  });
};

const openHighlightUploadModal = (preset?: {
  category?: HighlightCategory;
  sessionName?: string;
  gameId?: string;
  gameIndex?: number;
  roundName?: string;
  winnerName?: string;
}) => {
  refreshGalleryAuthState();
  editingHighlightRecord.value = null;
  removeExistingHighlightImage.value = false;
  const rawSession = preset?.sessionName || selectedSession.value || displayedAvailableSessions.value[0] || '';
  const matchedOption = displayedAvailableSessions.value.find(s => matchHighlightSession(s, rawSession));
  const defaultSession = matchedOption || rawSession;
  const initialWinner = preset?.winnerName || getSavedDefaultUploadPlayer() || '';

  hasUserInteractedWithUploadForm = false;
  isInitializingUploadModal = true;
  uploadModalGameViewMode.value = 'sheet';
  uploadForm.value = {
    category: preset?.category || 'yakuman',
    sessionName: defaultSession,
    gameId: preset?.gameId || '',
    gameIndex: preset?.gameIndex,
    roundName: preset?.roundName || '',
    winnerName: initialWinner,
    loserName: '',
    winType: 'tsumo',
    yakumanTypes: [],
    caption: '',
    uploaderName: '',
    uploadPin: getSavedHighlightPin(),
  };
  if (selectedUploadPreviewUrl.value && selectedUploadPreviewUrl.value.startsWith('blob:')) {
    URL.revokeObjectURL(selectedUploadPreviewUrl.value);
  }
  selectedUploadFile.value = null;
  selectedUploadPreviewUrl.value = '';
  selectedUploadDimensions.value = '';
  highlightUploadError.value = '';
  isHighlightUploadModalOpen.value = true;

  nextTick(() => {
    isInitializingUploadModal = false;
  });
  syncUploadModalSessionData(defaultSession, true);
};

const openEditHighlightModal = (rec: HighlightRecord) => {
  refreshGalleryAuthState();
  editingHighlightRecord.value = rec;
  removeExistingHighlightImage.value = false;
  const matchedOption = displayedAvailableSessions.value.find(s => matchHighlightSession(s, rec.sessionName));
  const targetSession = matchedOption || rec.sessionName;

  hasUserInteractedWithUploadForm = true;
  isInitializingUploadModal = true;
  uploadModalGameViewMode.value = 'sheet';
  uploadForm.value = {
    category: rec.category || 'yakuman',
    sessionName: targetSession,
    gameId: rec.gameId || '',
    gameIndex: rec.gameIndex,
    roundName: rec.roundName || '',
    winnerName: rec.winnerName || '',
    loserName: rec.loserName || '',
    winType: rec.winType === 'ron' ? 'ron' : 'tsumo',
    yakumanTypes: Array.isArray(rec.yakumanTypes) ? [...rec.yakumanTypes] : [],
    caption: rec.caption || '',
    uploaderName: rec.uploaderName || '',
    uploadPin: getSavedHighlightPin(),
  };
  if (selectedUploadPreviewUrl.value && selectedUploadPreviewUrl.value.startsWith('blob:')) {
    URL.revokeObjectURL(selectedUploadPreviewUrl.value);
  }
  selectedUploadFile.value = null;
  selectedUploadPreviewUrl.value = (rec.hasImage && rec.imageId) ? getHighlightImageUrl(rec.imageId) : '';
  selectedUploadDimensions.value = '';
  highlightUploadError.value = '';
  isHighlightUploadModalOpen.value = true;

  nextTick(() => {
    isInitializingUploadModal = false;
  });
  syncUploadModalSessionData(targetSession, true);
};

const closeHighlightUploadModal = () => {
  if (selectedUploadPreviewUrl.value && selectedUploadPreviewUrl.value.startsWith('blob:')) {
    URL.revokeObjectURL(selectedUploadPreviewUrl.value);
  }
  selectedUploadPreviewUrl.value = '';
  selectedUploadFile.value = null;
  editingHighlightRecord.value = null;
  removeExistingHighlightImage.value = false;
  isHighlightUploadModalOpen.value = false;
};

const handleHighlightFileSelect = (e: Event) => {
  if (editingHighlightRecord.value && !isGalleryAdmin.value) return;
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (selectedUploadPreviewUrl.value && selectedUploadPreviewUrl.value.startsWith('blob:')) {
    URL.revokeObjectURL(selectedUploadPreviewUrl.value);
  }
  selectedUploadFile.value = file;
  removeExistingHighlightImage.value = false;
  const url = URL.createObjectURL(file);
  selectedUploadPreviewUrl.value = url;
};

const handleRemoveUploadPreview = () => {
  if (editingHighlightRecord.value && !isGalleryAdmin.value) return;
  if (selectedUploadPreviewUrl.value && selectedUploadPreviewUrl.value.startsWith('blob:')) {
    URL.revokeObjectURL(selectedUploadPreviewUrl.value);
  }
  if (editingHighlightRecord.value && editingHighlightRecord.value.hasImage && !selectedUploadFile.value) {
    removeExistingHighlightImage.value = true;
  }
  selectedUploadFile.value = null;
  selectedUploadPreviewUrl.value = '';
  selectedUploadDimensions.value = '';
  if (highlightFileInputRef.value) {
    highlightFileInputRef.value.value = '';
  }
};

const toggleYakumanTypeInForm = (key: string) => {
  const list = uploadForm.value.yakumanTypes;
  const idx = list.indexOf(key);
  if (idx >= 0) {
    list.splice(idx, 1);
  } else {
    list.push(key);
  }
};

const submitHighlightUpload = async () => {
  highlightUploadError.value = '';
  const f = uploadForm.value;
  const editingRec = editingHighlightRecord.value;
  const canModifyImage = !editingRec || isGalleryAdmin.value;
  const effectiveUploadFile = canModifyImage ? selectedUploadFile.value : null;
  const effectiveRemoveImage = canModifyImage ? removeExistingHighlightImage.value : false;
  const hasFinalImage = Boolean(
    effectiveUploadFile ||
    (editingRec && editingRec.hasImage && !effectiveRemoveImage)
  );

  if (f.category !== 'session' && !f.sessionName) {
    highlightUploadError.value = '회차를 선택해 주세요.';
    return;
  }
  if (f.category === 'yakuman') {
    if (!f.gameIndex) {
      highlightUploadError.value = '역만 등록 시 경기를 반드시 선택해 주세요.';
      return;
    }
    if (f.yakumanTypes.length === 0 && !hasFinalImage) {
      highlightUploadError.value = '달성한 역만 종류를 선택하거나 사진을 첨부해 주세요.';
      return;
    }
  } else if (f.category === 'nanikiru') {
    if (!hasFinalImage) {
      highlightUploadError.value = '나니키루(무엇을 버릴까) 등록 시 손패 사진 파일을 첨부해 주세요.';
      return;
    }
  } else if (f.category === 'session') {
    if (!hasFinalImage) {
      highlightUploadError.value = '기타 사진 등록 시 업로드할 사진 파일을 선택해 주세요.';
      return;
    }
  }

  if (f.winnerName && f.winnerName.trim()) {
    saveDefaultUploadPlayer(f.winnerName);
  }

  isSubmittingHighlight.value = true;
  try {
    if (editingRec) {
      const res = await updateHighlightRecord({
        id: editingRec.id,
        category: f.category,
        sessionName: f.sessionName,
        gameId: f.gameId || '',
        gameIndex: f.gameIndex || undefined,
        roundName: f.roundName || '',
        winnerName: f.winnerName.trim() || '',
        loserName: (f.category === 'yakuman' || f.category === 'fun') && f.winType === 'ron' && f.loserName.trim() ? f.loserName.trim() : '',
        winType: (f.category === 'session' || f.category === 'nanikiru' || !f.winnerName.trim()) ? null : f.winType,
        yakumanTypes: (f.category === 'yakuman' || f.category === 'nanikiru') ? f.yakumanTypes : [],
        caption: f.caption,
        imageFile: effectiveUploadFile,
        removeImage: effectiveRemoveImage,
        uploadPin: f.uploadPin,
      });

      if (res.success) {
        if (getSavedHighlightPin()) {
          hasSavedValidPin.value = true;
        }
        if (res.records) {
          highlightsList.value = res.records;
        } else {
          highlightsList.value = await fetchHighlights(true);
        }
        const updatedItem = highlightsList.value.find(item => item.id === editingRec.id) || res.record;
        if (updatedItem && lightboxHighlight.value && lightboxHighlight.value.id === editingRec.id) {
          lightboxHighlight.value = updatedItem;
        }
        closeHighlightUploadModal();
        showToast('기록이 수정되었습니다!');
      } else {
        if (res.pinInvalidated) {
          hasSavedValidPin.value = false;
          uploadForm.value.uploadPin = '';
        }
        highlightUploadError.value = res.error || '수정에 실패했습니다. 공통 PIN을 확인해 주세요.';
      }
      return;
    }

    const res = await createHighlight({
      category: f.category,
      sessionName: f.sessionName,
      gameId: f.gameId || undefined,
      gameIndex: f.gameIndex || undefined,
      roundName: f.roundName || undefined,
      winnerName: f.winnerName.trim() || undefined,
      loserName: (f.category === 'yakuman' || f.category === 'fun') && f.winType === 'ron' && f.loserName.trim() ? f.loserName.trim() : undefined,
      winType: (f.category === 'session' || f.category === 'nanikiru' || !f.winnerName.trim()) ? undefined : f.winType,
      yakumanTypes: (f.category === 'yakuman' || f.category === 'nanikiru') ? f.yakumanTypes : [],
      caption: f.caption,
      uploaderName: f.uploaderName,
      imageFile: selectedUploadFile.value,
      uploadPin: f.uploadPin,
    });

    if (res.success) {
      if (getSavedHighlightPin()) {
        hasSavedValidPin.value = true;
      }
      if (res.records) {
        highlightsList.value = res.records;
      } else {
        highlightsList.value = await fetchHighlights(true);
      }
      closeHighlightUploadModal();
      showToast('성공적으로 등록되었습니다!');
    } else {
      if (res.pinInvalidated) {
        hasSavedValidPin.value = false;
        uploadForm.value.uploadPin = '';
      }
      highlightUploadError.value = res.error || '등록에 실패했습니다. 공통 PIN을 확인해 주세요.';
    }
  } finally {
    isSubmittingHighlight.value = false;
  }
};

// 원본 화질 사진 확대 라이트박스, 메모 수정 & 삭제 모달
const lightboxHighlight = ref<HighlightRecord | null>(null);
const lightboxScrollAreaRef = ref<HTMLElement | null>(null);
const lightboxCommentsSectionRef = ref<HTMLElement | null>(null);
const showLightboxCommentFab = ref<boolean>(false);
const isFullImageZoomOpen = ref<boolean>(false);
type FullImageFitMode = 'contain' | 'width' | 'height' | 'original';
const fullImageFitMode = ref<FullImageFitMode>('contain');
const deletePinPromptInput = ref('');
const isDeletingHighlight = ref(false);
const showDeletePinInput = ref(false);
const deleteHighlightError = ref('');

// 라이트박스 내 메모 추가/수정 상태
const isEditingLightboxMemo = ref(false);
const editingMemoText = ref('');
const editingMemoPin = ref('');
const isSavingLightboxMemo = ref(false);
const memoEditError = ref('');

// ==========================================
// 6-2. 사진 댓글 & 대댓글 시스템 (일정 로그인 연동 + 디시인사이드 유동 스타일 + 마작패/액션 디시콘)
// ==========================================
interface ThreadedHighlightComment extends HighlightComment {
  isReply: boolean;
  isOrphanReply?: boolean;
}

const scheduleLoggedInName = ref<string>('');
const scheduleLoggedInPin = ref<string>('');
const useGuestCommentMode = ref<boolean>(false);

const commentNicknameInput = ref<string>('');
const commentPinInput = ref<string>('');
const commentContentInput = ref<string>('');
const commentTextareaRef = ref<HTMLTextAreaElement | null>(null);
const isSubmittingComment = ref<boolean>(false);
const commentFormError = ref<string>('');

// 마작패 / 액션 버튼 디시콘 팔레트 상태
const isCommentEmotePickerOpen = ref<boolean>(false);
const activeEmoteTab = ref<'man' | 'pin' | 'sou' | 'honor' | 'action'>('man');
const isContinuousEmoteMode = ref<boolean>(false);
const isFuroEmoteMode = ref<boolean>(false);
const selectedPaletteTileCode = ref<string>('5m');
const isBaseTilePopping = ref<boolean>(false);
const showEmoteNotationHelp = ref<boolean>(false);
let baseTilePopTimer: ReturnType<typeof setTimeout> | null = null;

// 직전에 팔레트에서 단일 패를 클릭한 기록 (바로 이어서 치/퐁/깡 레버를 당기면 해당 단일 패를 후로 블록으로 교체)
const lastInsertedSingleTileState = ref<{
  target: 'new' | 'edit' | 'reply';
  previousText: string;
  tileCode: string;
} | null>(null);

const selectedPaletteTileDef = computed<MahjongTileEmoteDef>(() => {
  return (
    MAHJONG_TILE_EMOTES.find((t) => t.code === selectedPaletteTileCode.value) ||
    MAHJONG_TILE_EMOTES.find((t) => t.code === '5m') ||
    MAHJONG_TILE_EMOTES[0]
  );
});

// 모던 후로 레버(조이스틱) 드래그 상태
const furoDragState = ref<{
  active: boolean;
  closing: boolean;
  action: 'chi' | 'pon' | 'kan';
  target: 'new' | 'edit' | 'reply';
  tileCode: string;
  originX: number;
  originY: number;
  hudX: number;
  hudY: number;
  knobX: number;
  knobY: number;
  pullRatio: number;
  angleDeg: number;
  activeDir: 'center' | 'left' | 'right' | 'up' | 'down';
  confirmedDir: 'center' | 'left' | 'right' | 'up' | 'down' | null;
}>({
  active: false,
  closing: false,
  action: 'pon',
  target: 'new',
  tileCode: '5m',
  originX: 0,
  originY: 0,
  hudX: 0,
  hudY: 0,
  knobX: 0,
  knobY: 0,
  pullRatio: 0,
  angleDeg: 0,
  activeDir: 'center',
  confirmedDir: null,
});

interface FuroHudSlotInfo {
  dir: 'up' | 'left' | 'right' | 'down';
  label: string;
  notation: string;
  subCode: string;
  blocks: MahjongMeldBlock[];
}

const furoHudSlots = computed<Record<'up' | 'left' | 'right' | 'down', FuroHudSlotInfo>>(() => {
  const tile = furoDragState.value.tileCode || '5m';
  const action = furoDragState.value.action;
  const isHonor = tile.endsWith('z');
  const effectiveAction = action === 'chi' && isHonor ? 'pon' : action;

  const labelsByAction: Record<'pon' | 'chi' | 'kan', Record<'up' | 'left' | 'right' | 'down', string>> = {
    pon: {
      left: '상가 퐁 (좌측)',
      up: '대면 퐁 (중앙)',
      down: '대면 퐁 (중앙)',
      right: '하가 퐁 (우측)',
    },
    chi: {
      left: '좌측 눕힘 치',
      up: '중앙 눕힘 치',
      down: '중앙 눕힘 치',
      right: '우측 눕힘 치',
    },
    kan: {
      left: '좌측 가깡',
      up: '중앙 가깡',
      right: '우측 가깡',
      down: '안깡 (암깡)',
    },
  };

  const dirs: Array<'up' | 'left' | 'right' | 'down'> = ['up', 'left', 'right', 'down'];
  const out = {} as Record<'up' | 'left' | 'right' | 'down', FuroHudSlotInfo>;
  for (const d of dirs) {
    const notation = buildDraggedMeldNotation(tile, action, d);
    out[d] = {
      dir: d,
      label: labelsByAction[effectiveAction][d],
      notation,
      subCode: `[${notation}]`,
      blocks: parseMahjongMeldBlocks(notation),
    };
  }
  return out;
});

const TILE_EMOTE_GROUPS = [
  { key: 'man' as const, label: '만수', tiles: MAHJONG_TILE_EMOTES.filter(t => t.group === 'man') },
  { key: 'pin' as const, label: '통수', tiles: MAHJONG_TILE_EMOTES.filter(t => t.group === 'pin') },
  { key: 'sou' as const, label: '삭수', tiles: MAHJONG_TILE_EMOTES.filter(t => t.group === 'sou') },
  { key: 'honor' as const, label: '자패', tiles: MAHJONG_TILE_EMOTES.filter(t => t.group === 'honor') },
];

// 개별 댓글 수정 / 삭제 / 답글(대댓글) 상태
const editingCommentId = ref<string | null>(null);
const editingCommentContent = ref<string>('');
const editingCommentPin = ref<string>('');
const isEditingCommentPickerOpen = ref<boolean>(false);
const deletingCommentId = ref<string | null>(null);
const deletingCommentPin = ref<string>('');
const commentActionError = ref<string>('');
const isProcessingCommentAction = ref<boolean>(false);

const replyingToComment = ref<HighlightComment | null>(null);
const replyContentInput = ref<string>('');
const isReplyEmotePickerOpen = ref<boolean>(false);
const isSubmittingReply = ref<boolean>(false);
const replyFormError = ref<string>('');

const closeEmotePickers = () => {
  isCommentEmotePickerOpen.value = false;
  isEditingCommentPickerOpen.value = false;
  isReplyEmotePickerOpen.value = false;
  showEmoteNotationHelp.value = false;
};

const syncScheduleLoginForComment = () => {
  const lastAttendee = (getLastAttendeeName() || '').trim();
  const savedPins = getSavedPins();
  scheduleLoggedInName.value = lastAttendee;
  scheduleLoggedInPin.value = lastAttendee ? (savedPins[lastAttendee] || 'schedule_user') : '';
  if (lastAttendee && !useGuestCommentMode.value) {
    commentNicknameInput.value = lastAttendee;
    commentPinInput.value = scheduleLoggedInPin.value;
  } else {
    commentNicknameInput.value = '';
    commentPinInput.value = '';
  }
};

const isUsingScheduleIdentity = computed(() => {
  return Boolean(scheduleLoggedInName.value && !useGuestCommentMode.value);
});

const toggleGuestCommentMode = () => {
  useGuestCommentMode.value = !useGuestCommentMode.value;
  commentFormError.value = '';
  replyFormError.value = '';
  if (isUsingScheduleIdentity.value) {
    commentNicknameInput.value = scheduleLoggedInName.value;
    commentPinInput.value = scheduleLoggedInPin.value;
  } else {
    commentNicknameInput.value = '';
    commentPinInput.value = '';
  }
};

const lightboxComments = computed<HighlightComment[]>(() => {
  void highlightStorageTick.value;
  return getEffectiveHighlightComments(lightboxHighlight.value);
});

const threadedLightboxComments = computed<ThreadedHighlightComment[]>(() => {
  const all = lightboxComments.value;
  if (all.length === 0) return [];
  const byId = new Map<string, HighlightComment>();
  for (const c of all) {
    byId.set(c.id, c);
  }
  const roots: HighlightComment[] = [];
  const repliesByParent = new Map<string, HighlightComment[]>();
  const orphans: HighlightComment[] = [];

  for (const c of all) {
    if (!c.parentId) {
      roots.push(c);
    } else if (byId.has(c.parentId)) {
      const parentObj = byId.get(c.parentId);
      const rootId = parentObj?.parentId && byId.has(parentObj.parentId) ? parentObj.parentId : c.parentId;
      const arr = repliesByParent.get(rootId) || [];
      arr.push(c);
      repliesByParent.set(rootId, arr);
    } else {
      orphans.push(c);
    }
  }

  const result: ThreadedHighlightComment[] = [];
  for (const root of roots) {
    result.push({ ...root, isReply: false });
    const replies = repliesByParent.get(root.id);
    if (replies && replies.length > 0) {
      for (const r of replies) {
        result.push({ ...r, isReply: true });
      }
    }
  }
  for (const orp of orphans) {
    result.push({ ...orp, isReply: true, isOrphanReply: true });
  }
  return result;
});

const getRecordCommentCount = (rec: HighlightRecord): number => {
  void highlightStorageTick.value;
  return getEffectiveHighlightComments(rec).length;
};

const getCommentTargetValue = (target: 'new' | 'edit' | 'reply'): string => {
  if (target === 'edit') return editingCommentContent.value;
  if (target === 'reply') return replyContentInput.value;
  return commentContentInput.value;
};

const setCommentTargetValue = (target: 'new' | 'edit' | 'reply', nextVal: string) => {
  if (target === 'edit') {
    editingCommentContent.value = nextVal;
  } else if (target === 'reply') {
    replyContentInput.value = nextVal;
  } else {
    commentContentInput.value = nextVal;
  }
};

/**
 * 기존 텍스트 끝에 `[...]` 마작패 블록이 열려 있으면 그 안에 연속 병합(예: `[234m]` + `5m` -> `[2345m]`)합니다.
 */
const appendTileCodeSmart = (baseText: string, tileCode: string, isMeldBlock = false): string => {
  const trailingBracketMatch = baseText.match(/^(.*)\[([^\[\]\n]+)\]$/s);
  if (trailingBracketMatch) {
    const prefix = trailingBracketMatch[1];
    const inner = trailingBracketMatch[2];
    const trimmedInner = inner.trim();
    if (parseMahjongMeldBlocks(trimmedInner).length > 0) {
      if (isMeldBlock) {
        const sep = inner.endsWith(' ') ? '' : ' ';
        return `${prefix}[${inner}${sep}${tileCode}]`;
      }
      const d = tileCode[0];
      const suit = tileCode[1]?.toLowerCase() || 'm';
      // 직전 토큰이 같은 수트(m/p/s/z)로 끝나고 공백이나 뒷면(0z), 안깡(#)이 아니면 숫자를 이어 붙임 (예: [23m] + 4m -> [234m])
      const lastToken = inner.split(/\s+/).pop() || '';
      if (
        !inner.endsWith(' ') &&
        lastToken &&
        !lastToken.startsWith('#') &&
        !lastToken.endsWith('0z') &&
        tileCode !== '0z' &&
        lastToken.slice(-1).toLowerCase() === suit
      ) {
        return `${prefix}[${inner.slice(0, -1)}${d}${suit}]`;
      }
      return `${prefix}[${inner}${tileCode}]`;
    }
  }
  return `${baseText}[${tileCode}]`;
};

const triggerBaseTilePop = (tileCode: string) => {
  if (tileCode !== '0z') {
    selectedPaletteTileCode.value = tileCode;
  }
  isBaseTilePopping.value = false;
  if (baseTilePopTimer) clearTimeout(baseTilePopTimer);
  nextTick(() => {
    isBaseTilePopping.value = true;
    baseTilePopTimer = setTimeout(() => {
      isBaseTilePopping.value = false;
    }, 260);
  });
};

const insertTileFromPalette = (tl: MahjongTileEmoteDef, target: 'new' | 'edit' | 'reply' = 'new') => {
  triggerBaseTilePop(tl.code);
  // 1) 연속 입력 OFF & 후로 입력 OFF (기본 상태): 기존처럼 단일 패 즉시 삽입 후 팝업 닫기
  if (!isContinuousEmoteMode.value && !isFuroEmoteMode.value) {
    insertEmoteTokenToComment(tl.label, target);
    return;
  }
  // 2) 후로 입력 ON & 연속 입력 OFF: 패 클릭 시 하단 기준 패만 선택하고 댓글 본문에는 아직 입력하지 않음
  if (isFuroEmoteMode.value && !isContinuousEmoteMode.value) {
    lastInsertedSingleTileState.value = null;
    return;
  }
  // 3) 연속 입력 ON: 대괄호 안에 패를 연속 병합하고 팝업 유지
  const prevText = getCommentTargetValue(target);
  const nextText = appendTileCodeSmart(prevText, tl.code, false);
  setCommentTargetValue(target, nextText);
  lastInsertedSingleTileState.value = {
    target,
    previousText: prevText,
    tileCode: tl.code,
  };
};

const insertBlockSpaceFromPalette = (target: 'new' | 'edit' | 'reply' = 'new') => {
  lastInsertedSingleTileState.value = null;
  const cur = getCommentTargetValue(target);
  const trailingBracketMatch = cur.match(/^(.*)\[([^\[\]\n]+)\]$/s);
  if (trailingBracketMatch) {
    const prefix = trailingBracketMatch[1];
    const inner = trailingBracketMatch[2];
    if (parseMahjongMeldBlocks(inner.trim()).length > 0) {
      if (!inner.endsWith(' ')) {
        setCommentTargetValue(target, `${prefix}[${inner} ]`);
      }
      return;
    }
  }
  if (!cur.endsWith(' ')) {
    setCommentTargetValue(target, `${cur} `);
  }
};

const deleteLastCommentToken = (target: 'new' | 'edit' | 'reply' = 'new') => {
  lastInsertedSingleTileState.value = null;
  const cur = getCommentTargetValue(target);
  if (!cur) return;

  const trailingBracketMatch = cur.match(/^(.*)\[([^\[\]\n]*)\]$/s);
  if (trailingBracketMatch) {
    const prefix = trailingBracketMatch[1];
    const inner = trailingBracketMatch[2];
    if (!inner.trim()) {
      setCommentTargetValue(target, prefix);
      return;
    }
    if (inner.endsWith(' ')) {
      const trimmedEnd = inner.replace(/\s+$/, '');
      setCommentTargetValue(target, trimmedEnd ? `${prefix}[${trimmedEnd}]` : prefix);
      return;
    }
    if (parseMahjongMeldBlocks(inner.trim()).length > 0) {
      const lastSpaceIdx = inner.search(/\s+\S+$/);
      const beforeLastToken = lastSpaceIdx >= 0 ? inner.slice(0, lastSpaceIdx) : '';
      const lastToken = lastSpaceIdx >= 0 ? inner.slice(lastSpaceIdx).trim() : inner.trim();

      // 후로(치/퐁/가깡/안깡) 블록이면 블록 통째로 제거
      if (lastToken.startsWith('#') || lastToken.includes('-') || lastToken.includes('=')) {
        setCommentTargetValue(target, beforeLastToken ? `${prefix}[${beforeLastToken}]` : prefix);
        return;
      }

      // 일반 패 연쇄(예: 234m5p 또는 234m)면 마지막 패 1매만 제거
      const suitGroupMatch = lastToken.match(/^(.*?)([0-9xbXB]+)([mpszMPSZ])$/);
      if (suitGroupMatch) {
        const tokenHead = suitGroupMatch[1];
        const digits = suitGroupMatch[2];
        const suit = suitGroupMatch[3];
        const nextToken = digits.length > 1 ? `${tokenHead}${digits.slice(0, -1)}${suit}` : tokenHead;
        const nextInner = beforeLastToken
          ? nextToken
            ? `${beforeLastToken} ${nextToken}`
            : beforeLastToken
          : nextToken;
        setCommentTargetValue(target, nextInner ? `${prefix}[${nextInner}]` : prefix);
        return;
      }
    }
    // 액션 버튼([리치] 등)은 대괄호 토큰 통째로 삭제
    setCommentTargetValue(target, prefix);
    return;
  }

  setCommentTargetValue(target, cur.slice(0, -1));
};

const insertEmoteTokenToComment = (tokenLabel: string, target: 'new' | 'edit' | 'reply' = 'new') => {
  lastInsertedSingleTileState.value = null;
  const token = `[${tokenLabel}]`;
  if (target === 'edit') {
    editingCommentContent.value = `${editingCommentContent.value}${token}`;
    if (!isContinuousEmoteMode.value) {
      closeEmotePickers();
    }
    return;
  }
  if (target === 'reply') {
    replyContentInput.value = `${replyContentInput.value}${token}`;
    if (!isContinuousEmoteMode.value) {
      closeEmotePickers();
    }
    return;
  }
  const el = commentTextareaRef.value;
  if (!el) {
    commentContentInput.value = `${commentContentInput.value}${token}`;
    if (!isContinuousEmoteMode.value) {
      closeEmotePickers();
    }
    return;
  }
  const start = el.selectionStart ?? commentContentInput.value.length;
  const end = el.selectionEnd ?? commentContentInput.value.length;
  const before = commentContentInput.value.slice(0, start);
  const after = commentContentInput.value.slice(end);
  commentContentInput.value = `${before}${token}${after}`;
  if (!isContinuousEmoteMode.value) {
    closeEmotePickers();
  }
  nextTick(() => {
    el.focus();
    const nextPos = start + token.length;
    el.setSelectionRange(nextPos, nextPos);
  });
};

// 후로(치/퐁/깡) 조이스틱 레버 드래그 핸들러 (60~120fps 연속 물리 추적)
const startFuroLeverDrag = (
  downEv: PointerEvent,
  action: 'chi' | 'pon' | 'kan',
  target: 'new' | 'edit' | 'reply' = 'new'
) => {
  downEv.preventDefault();
  downEv.stopPropagation();

  const originX = downEv.clientX;
  const originY = downEv.clientY;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 800;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 600;
  const hudHalfW = Math.min(108, Math.floor(vw / 2) - 6);
  const hudHalfH = Math.min(66, Math.floor(vh / 2) - 6);
  const hudX = Math.max(hudHalfW, Math.min(vw - hudHalfW, originX));
  const hudY = Math.max(hudHalfH, Math.min(vh - hudHalfH, originY));

  furoDragState.value = {
    active: true,
    closing: false,
    action,
    target,
    tileCode: selectedPaletteTileCode.value || '5m',
    originX,
    originY,
    hudX,
    hudY,
    knobX: 0,
    knobY: 0,
    pullRatio: 0,
    angleDeg: 0,
    activeDir: 'center',
    confirmedDir: null,
  };

  const maxRadius = 20;
  const deadzone = 3.5;

  const onPointerMove = (moveEv: PointerEvent) => {
    const rawDx = moveEv.clientX - originX;
    const rawDy = moveEv.clientY - originY;
    const dist = Math.hypot(rawDx, rawDy);
    const dampedDist = maxRadius * Math.tanh(dist / 16);

    const knobX = dist > 0.1 ? (rawDx / dist) * dampedDist : 0;
    const knobY = dist > 0.1 ? (rawDy / dist) * dampedDist : 0;
    const pullRatio = Math.min(1, dist / 10);
    const angleDeg = Math.atan2(rawDy, rawDx) * (180 / Math.PI);

    let nextDir: 'center' | 'left' | 'right' | 'up' | 'down' = 'center';
    if (dist > deadzone) {
      const prevDir = furoDragState.value.activeDir;
      const absX = Math.abs(rawDx);
      const absY = Math.abs(rawDy);
      // 대각선 경계 떨림 방지 히스테리시스
      if ((prevDir === 'left' || prevDir === 'right') && absX + 2 >= absY) {
        nextDir = rawDx >= 0 ? 'right' : 'left';
      } else if ((prevDir === 'up' || prevDir === 'down') && absY + 2 >= absX) {
        nextDir = rawDy >= 0 ? 'down' : 'up';
      } else if (absX >= absY) {
        nextDir = rawDx >= 0 ? 'right' : 'left';
      } else {
        nextDir = rawDy >= 0 ? 'down' : 'up';
      }
    }

    furoDragState.value.knobX = knobX;
    furoDragState.value.knobY = knobY;
    furoDragState.value.pullRatio = pullRatio;
    furoDragState.value.angleDeg = angleDeg;
    furoDragState.value.activeDir = nextDir;
  };

  const onPointerUp = () => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);

    const finalDir = furoDragState.value.activeDir;
    const tileCode = furoDragState.value.tileCode;
    const act = furoDragState.value.action;
    const tgt = furoDragState.value.target;

    // 레버 핸들을 중앙으로 스프링 복귀시키며 선택 슬롯 펄스 연출
    furoDragState.value.knobX = 0;
    furoDragState.value.knobY = 0;
    furoDragState.value.pullRatio = 0;
    furoDragState.value.confirmedDir = finalDir !== 'center' ? finalDir : null;
    furoDragState.value.closing = true;

    if (finalDir && finalDir !== 'center') {
      const meldNotation = buildDraggedMeldNotation(tileCode, act, finalDir);
      if (meldNotation) {
        const lastSingle = lastInsertedSingleTileState.value;
        const baseText =
          lastSingle && lastSingle.target === tgt && lastSingle.tileCode === tileCode
            ? lastSingle.previousText
            : getCommentTargetValue(tgt);
        lastInsertedSingleTileState.value = null;
        const nextText = appendTileCodeSmart(baseText, meldNotation, true);
        setCommentTargetValue(tgt, nextText);
        if (!isContinuousEmoteMode.value) {
          closeEmotePickers();
        }
      }
    }

    setTimeout(() => {
      furoDragState.value.active = false;
      furoDragState.value.closing = false;
      furoDragState.value.confirmedDir = null;
    }, 170);
  };

  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
};

const formatCommentTime = (ts?: number): string => {
  if (!ts) return '';
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${mm}.${dd} ${hh}:${min}`;
};

const canAutoAuthComment = (cmt: HighlightComment): boolean => {
  if (isGalleryAdmin.value) return true;
  if (scheduleLoggedInName.value && cmt.authorName === scheduleLoggedInName.value && scheduleLoggedInPin.value) {
    return true;
  }
  return false;
};

const submitNewHighlightComment = async () => {
  if (!lightboxHighlight.value || isSubmittingComment.value) return;
  commentFormError.value = '';

  const author = isUsingScheduleIdentity.value
    ? scheduleLoggedInName.value.trim()
    : commentNicknameInput.value.trim();
  const pin = isUsingScheduleIdentity.value
    ? (scheduleLoggedInPin.value || 'schedule_user')
    : commentPinInput.value.trim();
  const content = commentContentInput.value.trim();

  if (!author) {
    commentFormError.value = '닉네임을 입력해 주세요.';
    return;
  }
  if (!isUsingScheduleIdentity.value && (!pin || pin.length < 2)) {
    commentFormError.value = '댓글 수정/삭제에 사용할 비밀번호(PIN 2자리 이상)를 입력해 주세요.';
    return;
  }
  if (!content) {
    commentFormError.value = '댓글 내용을 입력해 주세요.';
    return;
  }

  isSubmittingComment.value = true;
  try {
    const res = await addHighlightComment({
      highlightId: lightboxHighlight.value.id,
      authorName: author,
      content,
      pin,
      isLoggedInUser: isUsingScheduleIdentity.value,
    });
    if (res.success) {
      if (res.records) {
        highlightsList.value = res.records;
      }
      if (res.record) {
        lightboxHighlight.value = res.record;
      }
      highlightStorageTick.value++;
      commentContentInput.value = '';
      isCommentEmotePickerOpen.value = false;
      showToast('댓글이 등록되었습니다.');
    } else {
      commentFormError.value = res.error || '댓글 등록에 실패했습니다.';
    }
  } finally {
    isSubmittingComment.value = false;
  }
};

const updateLightboxFloatingBtnState = () => {
  const scrollEl =
    lightboxScrollAreaRef.value ||
    (typeof document !== 'undefined'
      ? (document.querySelector('.lightbox-scroll-area') as HTMLElement | null)
      : null);
  if (!scrollEl) {
    showLightboxCommentFab.value = false;
    return;
  }
  const remainingScroll = scrollEl.scrollHeight - scrollEl.clientHeight - scrollEl.scrollTop;
  if (remainingScroll <= 36) {
    showLightboxCommentFab.value = false;
    return;
  }
  const formEl = scrollEl.querySelector('.lb-comment-form-card') as HTMLElement | null;
  if (formEl) {
    const scrollRect = scrollEl.getBoundingClientRect();
    const formRect = formEl.getBoundingClientRect();
    const formVisibleHeight = scrollRect.bottom - formRect.top;
    showLightboxCommentFab.value = formVisibleHeight < 120;
  } else {
    showLightboxCommentFab.value = true;
  }
};

const scrollToLightboxComments = () => {
  const scrollEl =
    lightboxScrollAreaRef.value ||
    (typeof document !== 'undefined'
      ? (document.querySelector('.lightbox-scroll-area') as HTMLElement | null)
      : null);
  const commentsEl = lightboxCommentsSectionRef.value;
  if (!scrollEl) return;
  if (commentsEl) {
    const scrollRect = scrollEl.getBoundingClientRect();
    const commentsRect = commentsEl.getBoundingClientRect();
    const targetDelta = commentsRect.top - scrollRect.top - 12;
    if (targetDelta > 40) {
      scrollEl.scrollBy({ top: targetDelta, behavior: 'smooth' });
      return;
    }
  }
  scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: 'smooth' });
};

const loadedHighResImageIds = ref<Set<string>>(new Set());
const isZoomHighResLoaded = ref<boolean>(false);
const loadedThumbIds = ref<Set<string>>(new Set());
const isLightboxImageLoaded = ref<boolean>(false);

const THUMB_ASPECT_RATIO_STORAGE_KEY = 'mahjong_hl_thumb_ratios_v1';
const loadSavedThumbAspectRatios = (): Record<string, number> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.sessionStorage.getItem(THUMB_ASPECT_RATIO_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, number>;
  } catch {
    // ignore storage errors
  }
  return {};
};
const thumbAspectRatios = ref<Record<string, number>>(loadSavedThumbAspectRatios());
let thumbRatioSaveTimer: ReturnType<typeof setTimeout> | null = null;

const recordThumbAspectRatio = (imageId: string, naturalWidth: number, naturalHeight: number) => {
  if (!imageId || !naturalWidth || !naturalHeight) return;
  const ratio = Math.round((naturalWidth / naturalHeight) * 1000) / 1000;
  if (ratio <= 0.1 || ratio >= 10) return;
  if (thumbAspectRatios.value[imageId] === ratio) return;
  thumbAspectRatios.value[imageId] = ratio;
  if (typeof window !== 'undefined') {
    if (thumbRatioSaveTimer) clearTimeout(thumbRatioSaveTimer);
    thumbRatioSaveTimer = setTimeout(() => {
      try {
        window.sessionStorage.setItem(
          THUMB_ASPECT_RATIO_STORAGE_KEY,
          JSON.stringify(thumbAspectRatios.value)
        );
      } catch {
        // ignore quota errors
      }
    }, 300);
  }
};

const getThumbWrapStyle = (imageId?: string): Record<string, string> | undefined => {
  if (!imageId) return undefined;
  const ratio = thumbAspectRatios.value[imageId];
  if (ratio && ratio > 0) {
    return { aspectRatio: String(ratio) };
  }
  return undefined;
};

const handleThumbImageLoad = (imageId?: string, ev?: Event) => {
  if (!imageId) return;
  loadedThumbIds.value.add(imageId);
  const imgEl = ev?.target as HTMLImageElement | null;
  if (imgEl && imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0) {
    recordThumbAspectRatio(imageId, imgEl.naturalWidth, imgEl.naturalHeight);
  }
};

const prewarmedThumbUrlSet = new Set<string>();
const prewarmGalleryThumbnails = (records: HighlightRecord[], maxCount = 24) => {
  if (typeof window === 'undefined' || !Array.isArray(records) || records.length === 0) return;
  let count = 0;
  for (const rec of records) {
    if (count >= maxCount) break;
    if (!rec.hasImage || !rec.imageId) continue;
    count++;
    const imageId = rec.imageId;
    if (loadedThumbIds.value.has(imageId)) continue;
    const url = getHighlightThumbnailUrl(imageId);
    if (!url || prewarmedThumbUrlSet.has(url)) continue;
    prewarmedThumbUrlSet.add(url);

    const img = new Image();
    img.decoding = 'async';
    const finalize = () => {
      loadedThumbIds.value.add(imageId);
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        recordThumbAspectRatio(imageId, img.naturalWidth, img.naturalHeight);
      }
    };
    img.onload = () => {
      if (typeof img.decode === 'function') {
        img.decode().then(finalize).catch(finalize);
      } else {
        finalize();
      }
    };
    img.src = url;
    if (img.complete && img.naturalWidth > 0) {
      finalize();
    }
  }
};

watch(
  highlightsList,
  (list) => {
    if (!Array.isArray(list) || list.length === 0) return;
    if (isInitialLightboxImagePending.value) return;
    prewarmGalleryThumbnails(list, 24);
  },
  { immediate: true }
);

watch(activeTab, (tab) => {
  if ((tab === 'gallery' || tab === 'sessions') && highlightsList.value.length > 0) {
    prewarmGalleryThumbnails(highlightsList.value, 32);
  }
});

const getDisplayHighlightImageSrc = (imageId?: string): string => {
  if (!imageId) return '';
  if (loadedHighResImageIds.value.has(imageId)) {
    return getHighlightImageUrl(imageId);
  }
  return getHighlightThumbnailUrl(imageId);
};

const handleZoomHighResLoad = (imageId?: string) => {
  isZoomHighResLoaded.value = true;
  if (imageId) {
    loadedHighResImageIds.value.add(imageId);
  }
};

const handleLightboxImageLoad = (ev?: Event) => {
  isLightboxImageLoaded.value = true;
  const imgId = lightboxHighlight.value?.imageId;
  if (imgId) {
    loadedThumbIds.value.add(imgId);
    const imgEl = ev?.target as HTMLImageElement | null;
    if (imgEl && imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0) {
      recordThumbAspectRatio(imgId, imgEl.naturalWidth, imgEl.naturalHeight);
    }
  }
  const wasPendingInitial = isInitialLightboxImagePending.value;
  clearInitialLightboxImagePending();
  if (wasPendingInitial && highlightsList.value.length > 0) {
    prewarmGalleryThumbnails(highlightsList.value, 24);
  }
  if (lightboxScrollAreaRef.value && lightboxScrollAreaRef.value.scrollTop < 10) {
    lightboxScrollAreaRef.value.scrollTop = 0;
  }
  requestAnimationFrame(() => {
    updateLightboxFloatingBtnState();
  });
  setTimeout(() => {
    updateLightboxFloatingBtnState();
  }, 80);
};

const openFullImageZoom = () => {
  const imgId = lightboxHighlight.value?.imageId;
  if (!lightboxHighlight.value?.hasImage || !imgId) return;
  fullImageFitMode.value = 'contain';
  isZoomHighResLoaded.value = loadedHighResImageIds.value.has(imgId);
  isFullImageZoomOpen.value = true;
};

const closeFullImageZoom = () => {
  isFullImageZoomOpen.value = false;
  fullImageFitMode.value = 'contain';
};

const cycleFullImageFitMode = () => {
  fullImageFitMode.value = fullImageFitMode.value === 'contain' ? 'original' : 'contain';
};

watch(lightboxHighlight, (val, oldVal) => {
  if (val) {
    isLightboxImageLoaded.value = Boolean(
      val.imageId &&
        (loadedThumbIds.value.has(val.imageId) || loadedHighResImageIds.value.has(val.imageId))
    );
    updateVisualViewportHeight();
  } else {
    clearInitialLightboxImagePending();
    isLightboxImageLoaded.value = false;
    isFullImageZoomOpen.value = false;
    isZoomHighResLoaded.value = false;
    fullImageFitMode.value = 'contain';
    showLightboxCommentFab.value = false;
    pendingUrlPhotoId.value = '';
    if (oldVal && typeof window !== 'undefined') {
      const nextUrl = buildDashboardRelativeUrl(activeTab.value, null);
      window.history.replaceState(null, '', nextUrl);
    }
  }
});

const scrollCommentActionBoxIntoView = (boxSelector: string, focusSelector?: string) => {
  nextTick(() => {
    requestAnimationFrame(() => {
      const modalEl =
        lightboxScrollAreaRef.value ||
        (document.querySelector('.lightbox-scroll-area') as HTMLElement | null) ||
        (document.querySelector('.lightbox-modal-card') as HTMLElement | null);
      if (!modalEl) return;
      const boxEl = modalEl.querySelector(boxSelector) as HTMLElement | null;
      if (!boxEl) return;

      if (focusSelector) {
        const inputEl = boxEl.querySelector(focusSelector) as HTMLElement | null;
        if (inputEl && typeof inputEl.focus === 'function') {
          inputEl.focus({ preventScroll: true });
        }
      }

      const boxRect = boxEl.getBoundingClientRect();
      let actualListScroll = 0;

      const listEl = boxEl.closest('.lb-comments-list') as HTMLElement | null;
      if (listEl && listEl.scrollHeight > listEl.clientHeight + 2) {
        const listRect = listEl.getBoundingClientRect();
        const bottomPadding = 14;
        const topPadding = 8;
        if (boxRect.bottom + bottomPadding > listRect.bottom) {
          const desiredDelta = (boxRect.bottom + bottomPadding) - listRect.bottom;
          const maxScrollLeft = Math.max(0, listEl.scrollHeight - listEl.clientHeight - listEl.scrollTop);
          actualListScroll = Math.min(desiredDelta, maxScrollLeft);
          listEl.scrollBy({ top: desiredDelta, behavior: 'smooth' });
        } else if (boxRect.top - topPadding < listRect.top) {
          const desiredDelta = (boxRect.top - topPadding) - listRect.top;
          actualListScroll = Math.max(desiredDelta, -listEl.scrollTop);
          listEl.scrollBy({ top: desiredDelta, behavior: 'smooth' });
        }
      }

      const modalRect = modalEl.getBoundingClientRect();
      const projectedBoxBottom = boxRect.bottom - actualListScroll;
      const modalBottomPadding = 24;
      if (projectedBoxBottom + modalBottomPadding > modalRect.bottom) {
        const modalDelta = (projectedBoxBottom + modalBottomPadding) - modalRect.bottom;
        modalEl.scrollBy({ top: modalDelta, behavior: 'smooth' });
      }
    });
  });
};

watch(
  [
    () => Boolean(replyContentInput.value.includes('[') && replyContentInput.value.includes(']')),
    replyFormError,
    useGuestCommentMode,
  ],
  () => {
    if (replyingToComment.value) {
      scrollCommentActionBoxIntoView('.lb-reply-form-box');
    }
  }
);

watch(commentActionError, (err) => {
  if (!err) return;
  if (editingCommentId.value) {
    scrollCommentActionBoxIntoView('.lb-comment-edit-box');
  } else if (deletingCommentId.value) {
    scrollCommentActionBoxIntoView('.lb-comment-delete-box');
  }
});

const startReplyComment = (cmt: HighlightComment) => {
  if (replyingToComment.value?.id === cmt.id) {
    cancelReplyComment();
    return;
  }
  cancelEditComment();
  deletingCommentId.value = null;
  commentActionError.value = '';
  replyFormError.value = '';
  replyingToComment.value = cmt;
  replyContentInput.value = '';
  isReplyEmotePickerOpen.value = false;
  isCommentEmotePickerOpen.value = false;
  scrollCommentActionBoxIntoView('.lb-reply-form-box', 'textarea');
};

const cancelReplyComment = () => {
  replyingToComment.value = null;
  replyContentInput.value = '';
  isReplyEmotePickerOpen.value = false;
  replyFormError.value = '';
};

const submitReplyHighlightComment = async (targetCmt: HighlightComment) => {
  if (!lightboxHighlight.value || isSubmittingReply.value) return;
  replyFormError.value = '';

  const author = isUsingScheduleIdentity.value
    ? scheduleLoggedInName.value.trim()
    : commentNicknameInput.value.trim();
  const pin = isUsingScheduleIdentity.value
    ? (scheduleLoggedInPin.value || 'schedule_user')
    : commentPinInput.value.trim();
  const content = replyContentInput.value.trim();

  if (!author) {
    replyFormError.value = '닉네임을 입력해 주세요.';
    return;
  }
  if (!isUsingScheduleIdentity.value && (!pin || pin.length < 2)) {
    replyFormError.value = '답글 수정/삭제에 사용할 비밀번호(PIN 2자리 이상)를 입력해 주세요.';
    return;
  }
  if (!content) {
    replyFormError.value = '답글 내용을 입력해 주세요.';
    return;
  }

  const rootParentId = targetCmt.parentId || targetCmt.id;
  const replyToAuthor = targetCmt.parentId ? targetCmt.authorName : undefined;

  isSubmittingReply.value = true;
  try {
    const res = await addHighlightComment({
      highlightId: lightboxHighlight.value.id,
      parentId: rootParentId,
      replyToAuthor,
      authorName: author,
      content,
      pin,
      isLoggedInUser: isUsingScheduleIdentity.value,
    });
    if (res.success) {
      if (res.records) {
        highlightsList.value = res.records;
      }
      if (res.record) {
        lightboxHighlight.value = res.record;
      }
      highlightStorageTick.value++;
      cancelReplyComment();
      showToast('답글이 등록되었습니다.');
    } else {
      replyFormError.value = res.error || '답글 등록에 실패했습니다.';
    }
  } finally {
    isSubmittingReply.value = false;
  }
};

const startEditComment = (cmt: HighlightComment) => {
  cancelReplyComment();
  deletingCommentId.value = null;
  commentActionError.value = '';
  editingCommentId.value = cmt.id;
  editingCommentContent.value = cmt.content;
  isEditingCommentPickerOpen.value = false;
  if (scheduleLoggedInName.value && cmt.authorName === scheduleLoggedInName.value && scheduleLoggedInPin.value) {
    editingCommentPin.value = scheduleLoggedInPin.value;
  } else {
    editingCommentPin.value = '';
  }
  scrollCommentActionBoxIntoView('.lb-comment-edit-box', 'textarea');
};

const cancelEditComment = () => {
  editingCommentId.value = null;
  editingCommentContent.value = '';
  editingCommentPin.value = '';
  isEditingCommentPickerOpen.value = false;
  commentActionError.value = '';
};

const confirmUpdateComment = async (cmt: HighlightComment) => {
  if (!lightboxHighlight.value || isProcessingCommentAction.value) return;
  commentActionError.value = '';
  const autoAuth = canAutoAuthComment(cmt);
  const pinToUse = autoAuth
    ? (scheduleLoggedInPin.value || '')
    : editingCommentPin.value.trim();

  if (!autoAuth && !pinToUse) {
    commentActionError.value = '댓글 작성 시 설정한 비밀번호(PIN)를 입력해 주세요.';
    return;
  }

  isProcessingCommentAction.value = true;
  try {
    const res = await updateHighlightComment({
      highlightId: lightboxHighlight.value.id,
      commentId: cmt.id,
      content: editingCommentContent.value,
      pin: pinToUse,
    });
    if (res.success) {
      if (res.records) {
        highlightsList.value = res.records;
      }
      if (res.record) {
        lightboxHighlight.value = res.record;
      }
      highlightStorageTick.value++;
      cancelEditComment();
      showToast('댓글이 수정되었습니다.');
    } else {
      commentActionError.value = res.error || '비밀번호(PIN)가 일치하지 않습니다.';
    }
  } finally {
    isProcessingCommentAction.value = false;
  }
};

const startDeleteComment = async (cmt: HighlightComment) => {
  cancelReplyComment();
  editingCommentId.value = null;
  commentActionError.value = '';
  if (canAutoAuthComment(cmt)) {
    if (!window.confirm('이 댓글을 삭제하시겠습니까?')) return;
    await confirmDeleteComment(cmt, scheduleLoggedInPin.value || '');
    return;
  }
  deletingCommentId.value = cmt.id;
  deletingCommentPin.value = '';
  scrollCommentActionBoxIntoView('.lb-comment-delete-box', 'input');
};

const confirmDeleteComment = async (cmt: HighlightComment, explicitPin?: string) => {
  if (!lightboxHighlight.value || isProcessingCommentAction.value) return;
  commentActionError.value = '';
  const autoAuth = canAutoAuthComment(cmt);
  const pinToUse = explicitPin !== undefined
    ? explicitPin
    : (autoAuth ? (scheduleLoggedInPin.value || '') : deletingCommentPin.value.trim());

  if (!autoAuth && !pinToUse) {
    commentActionError.value = '댓글 작성 시 입력한 비밀번호(PIN)를 입력해 주세요.';
    return;
  }

  isProcessingCommentAction.value = true;
  try {
    const res = await deleteHighlightComment({
      highlightId: lightboxHighlight.value.id,
      commentId: cmt.id,
      pin: pinToUse,
    });
    if (res.success) {
      if (res.records) {
        highlightsList.value = res.records;
      }
      if (res.record) {
        lightboxHighlight.value = res.record;
      }
      highlightStorageTick.value++;
      deletingCommentId.value = null;
      deletingCommentPin.value = '';
      showToast('댓글이 삭제되었습니다.');
    } else {
      commentActionError.value = res.error || '비밀번호(PIN)가 일치하지 않습니다.';
    }
  } finally {
    isProcessingCommentAction.value = false;
  }
};

let latestLightboxSyncSeq = 0;

const syncLatestHighlightOnOpen = async (targetHighlightId: string) => {
  if (!targetHighlightId) return;
  const syncSeq = ++latestLightboxSyncSeq;
  try {
    const freshRecords = await fetchHighlights(true);
    memberAliasesMap.value = getMemberAliases();
    if (syncSeq !== latestLightboxSyncSeq) return;
    if (Array.isArray(freshRecords) && freshRecords.length > 0) {
      highlightsList.value = freshRecords;
      if (lightboxHighlight.value && lightboxHighlight.value.id === targetHighlightId) {
        const latestRec = freshRecords.find(item => item.id === targetHighlightId);
        if (latestRec) {
          const prevCommentCount = lightboxHighlight.value.comments?.length || 0;
          const nextCommentCount = latestRec.comments?.length || 0;
          lightboxHighlight.value = {
            ...latestRec,
            caption: isEditingLightboxMemo.value ? lightboxHighlight.value.caption : latestRec.caption,
          };
          if (nextCommentCount !== prevCommentCount) {
            nextTick(() => {
              updateLightboxFloatingBtnState();
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn('[Gallery] Failed to background-sync highlight on open:', err);
  }
};

const openHighlightLightbox = (rec: HighlightRecord, updateUrl = true) => {
  isPlayerModalBehindLightbox.value = true;
  preloadMahjongTileImages();
  refreshGalleryAuthState();
  useGuestCommentMode.value = false;
  syncScheduleLoginForComment();
  selectedGameDetail.value = null;
  lightboxSessionPopupDetail.value = null;
  isFullImageZoomOpen.value = false;
  fullImageFitMode.value = 'contain';
  showLightboxCommentFab.value = true;
  isLightboxImageLoaded.value = Boolean(
    rec.imageId &&
      (loadedThumbIds.value.has(rec.imageId) || loadedHighResImageIds.value.has(rec.imageId))
  );
  lightboxHighlight.value = rec;
  if (rec.id) {
    void syncLatestHighlightOnOpen(rec.id);
  }
  if (rec.sessionName) {
    const matchedSess = resolveMatchedSessionName(rec.sessionName);
    if (matchedSess) {
      if (selectedSession.value !== matchedSess) {
        selectedSession.value = matchedSess;
      }
      if (!currentSessionDetail.value || !matchHighlightSession(currentSessionDetail.value.sessionName, matchedSess)) {
        loadSessionDetail(matchedSess);
      }
    }
  }
  if (updateUrl && typeof window !== 'undefined' && rec.id) {
    const nextUrl = buildDashboardRelativeUrl(activeTab.value, rec.id);
    window.history.replaceState(null, '', nextUrl);
  }
  showDeletePinInput.value = false;
  deletePinPromptInput.value = getSavedHighlightPin();
  deleteHighlightError.value = '';
  isEditingLightboxMemo.value = false;
  editingMemoText.value = rec.caption || '';
  editingMemoPin.value = getSavedHighlightPin();
  memoEditError.value = '';
  commentContentInput.value = '';
  commentFormError.value = '';
  isCommentEmotePickerOpen.value = false;
  cancelEditComment();
  cancelReplyComment();
  deletingCommentId.value = null;
  nextTick(() => {
    if (lightboxScrollAreaRef.value) {
      lightboxScrollAreaRef.value.scrollTop = 0;
    }
    requestAnimationFrame(() => {
      updateLightboxFloatingBtnState();
    });
    setTimeout(() => {
      updateLightboxFloatingBtnState();
    }, 80);
    setTimeout(() => {
      updateLightboxFloatingBtnState();
    }, 240);
  });
};

const startEditLightboxMemo = () => {
  if (!lightboxHighlight.value) return;
  editingMemoText.value = lightboxHighlight.value.caption || '';
  editingMemoPin.value = getSavedHighlightPin();
  memoEditError.value = '';
  isEditingLightboxMemo.value = true;
};

const saveLightboxMemo = async () => {
  if (!lightboxHighlight.value) return;
  memoEditError.value = '';
  isSavingLightboxMemo.value = true;
  try {
    const res = await updateHighlightMemo(
      lightboxHighlight.value.id,
      editingMemoText.value,
      editingMemoPin.value
    );
    if (res.success) {
      if (getSavedHighlightPin()) {
        hasSavedValidPin.value = true;
      }
      if (res.records) {
        highlightsList.value = res.records;
      } else if (res.record) {
        highlightsList.value = highlightsList.value.map(item =>
          item.id === res.record!.id ? res.record! : item
        );
      }
      if (res.record) {
        lightboxHighlight.value = res.record;
      } else if (lightboxHighlight.value) {
        lightboxHighlight.value = {
          ...lightboxHighlight.value,
          caption: editingMemoText.value.trim(),
        };
      }
      isEditingLightboxMemo.value = false;
      showToast('메모가 저장되었습니다.');
    } else {
      if (res.pinInvalidated) {
        hasSavedValidPin.value = false;
        editingMemoPin.value = '';
      }
      memoEditError.value = res.error || '공통 PIN이 일치하지 않거나 수정 권한이 없습니다.';
    }
  } finally {
    isSavingLightboxMemo.value = false;
  }
};

const confirmDeleteHighlight = async (rec: HighlightRecord) => {
  deleteHighlightError.value = '';
  if (!isGalleryAdmin.value) {
    deleteHighlightError.value = '기록 및 사진 삭제는 관리자만 가능합니다.';
    return;
  }
  if (!window.confirm('이 기록을 정말 삭제하시겠습니까?')) {
    return;
  }
  isDeletingHighlight.value = true;
  try {
    const res = await deleteHighlight(rec.id, deletePinPromptInput.value);
    if (res.success) {
      if (res.records) {
        highlightsList.value = res.records;
      } else {
        highlightsList.value = highlightsList.value.filter(item => item.id !== rec.id);
      }
      lightboxHighlight.value = null;
      showDeletePinInput.value = false;
      showToast('기록이 삭제되었습니다.');
    } else {
      deleteHighlightError.value = res.error || '기록 및 사진 삭제는 관리자만 가능합니다.';
    }
  } finally {
    isDeletingHighlight.value = false;
  }
};

// 관리자 전용 갤러리 관리 모달 (멤버 동의어 관리 + 공통 PIN 관리)
const isPinAdminModalOpen = ref(false);
const galleryAdminTab = ref<'aliases' | 'pin'>('aliases');
const isPinAdminVerified = ref(false);
const adminPasscodeInputForPin = ref('');
const currentServerUploadPin = ref('');
const newServerUploadPin = ref('');
const pinAdminMessage = ref('');
const pinAdminError = ref('');
const isPinAdminLoading = ref(false);

// 멤버 동의어 관리 상태
const aliasCanonicalSearch = ref('');
const isAliasCanonicalDropdownOpen = ref(false);
const selectedAliasCanonicalName = ref('');
const newAliasNameInput = ref('');
const aliasAdminMessage = ref('');
const aliasAdminError = ref('');
const isAliasSubmitting = ref(false);

const officialSheetMemberNames = computed<string[]>(() => {
  const names = new Set<string>();
  for (const m of allStats.value) {
    const clean = (m.name || '').trim();
    if (clean) names.add(clean);
  }
  for (const canonical of Object.keys(memberAliasesMap.value || {})) {
    const clean = canonical.trim();
    if (clean) names.add(clean);
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b, 'ko'));
});

const filteredCanonicalNamesForAlias = computed<string[]>(() => {
  const q = aliasCanonicalSearch.value.trim().toLowerCase();
  if (!q) return officialSheetMemberNames.value;
  return officialSheetMemberNames.value.filter(name => name.toLowerCase().includes(q));
});

const memberAliasEntries = computed(() => {
  const map = memberAliasesMap.value || {};
  return Object.entries(map)
    .filter(([, aliases]) => Array.isArray(aliases) && aliases.length > 0)
    .sort(([a], [b]) => a.localeCompare(b, 'ko'));
});

// 갤러리/댓글에 등장했지만 아직 시트 본캐에 연결되지 않은 미연동 닉네임 추천 목록
const unlinkedGalleryNames = computed<string[]>(() => {
  const sheetSet = new Set(allStats.value.map(m => (m.name || '').trim()).filter(Boolean));
  const candidates = new Set<string>();
  for (const rec of highlightsList.value) {
    const pName = (rec.winnerName || '').trim();
    if (pName && pName !== '미상') candidates.add(pName);
    const lName = (rec.loserName || '').trim();
    if (lName) candidates.add(lName);
    if (Array.isArray(rec.comments)) {
      for (const c of rec.comments) {
        const aName = (c.authorName || '').trim();
        if (aName) candidates.add(aName);
      }
    }
  }
  return Array.from(candidates)
    .filter(name => {
      if (sheetSet.has(name)) return false;
      const resolved = resolveMemberCanonicalName(name, memberAliasesMap.value);
      return !sheetSet.has(resolved);
    })
    .sort((a, b) => a.localeCompare(b, 'ko'));
});

const selectCanonicalMemberForAlias = (name: string) => {
  selectedAliasCanonicalName.value = name;
  aliasCanonicalSearch.value = name;
  isAliasCanonicalDropdownOpen.value = false;
  aliasAdminError.value = '';
};

const handleAliasCanonicalFocus = () => {
  isAliasCanonicalDropdownOpen.value = true;
};

const handleAliasCanonicalBlur = () => {
  setTimeout(() => {
    isAliasCanonicalDropdownOpen.value = false;
  }, 160);
};

const prefillUnlinkedNameAsAlias = (aliasName: string) => {
  newAliasNameInput.value = aliasName;
  aliasAdminError.value = '';
  aliasAdminMessage.value = '';
};

const handleAddMemberAlias = async () => {
  aliasAdminError.value = '';
  aliasAdminMessage.value = '';
  const canonical = (selectedAliasCanonicalName.value || aliasCanonicalSearch.value).trim();
  const alias = newAliasNameInput.value.trim();
  if (!canonical) {
    aliasAdminError.value = '연결할 시트 멤버(본캐 이름)를 선택하거나 입력해 주세요.';
    return;
  }
  if (!alias) {
    aliasAdminError.value = '추가할 동의어(갤러리/일정 닉네임)를 입력해 주세요.';
    return;
  }
  if (canonical === alias) {
    aliasAdminError.value = '본캐 이름과 동의어가 동일합니다.';
    return;
  }
  isAliasSubmitting.value = true;
  try {
    const res = await addMemberAliasAsAdmin(canonical, alias);
    if (res.success) {
      if (res.memberAliases) {
        memberAliasesMap.value = res.memberAliases;
      } else {
        memberAliasesMap.value = getMemberAliases();
      }
      selectedAliasCanonicalName.value = canonical;
      aliasCanonicalSearch.value = canonical;
      newAliasNameInput.value = '';
      aliasAdminMessage.value = `'${alias}' 닉네임이 '${canonical}' 멤버로 연결되었습니다.`;
      showToast(`'${alias}' → '${canonical}' 연결 완료`);
    } else {
      aliasAdminError.value = res.error || '동의어 추가에 실패했습니다.';
    }
  } finally {
    isAliasSubmitting.value = false;
  }
};

const handleRemoveMemberAlias = async (canonical: string, alias: string) => {
  aliasAdminError.value = '';
  aliasAdminMessage.value = '';
  isAliasSubmitting.value = true;
  try {
    const res = await removeMemberAliasAsAdmin(canonical, alias);
    if (res.success) {
      if (res.memberAliases) {
        memberAliasesMap.value = res.memberAliases;
      } else {
        memberAliasesMap.value = getMemberAliases();
      }
      aliasAdminMessage.value = `'${alias}' 동의어 연결이 해제되었습니다.`;
      showToast(`'${alias}' 연결 해제됨`);
    } else {
      aliasAdminError.value = res.error || '동의어 삭제에 실패했습니다.';
    }
  } finally {
    isAliasSubmitting.value = false;
  }
};

const openPinAdminModal = async (initialTab: 'aliases' | 'pin' = 'aliases') => {
  isPinAdminModalOpen.value = true;
  galleryAdminTab.value = initialTab;
  pinAdminMessage.value = '';
  pinAdminError.value = '';
  aliasAdminMessage.value = '';
  aliasAdminError.value = '';
  isPinAdminLoading.value = true;
  try {
    void fetchMemberAliasesFromServer().then(res => {
      if (res.memberAliases) {
        memberAliasesMap.value = res.memberAliases;
      }
    });
    const status = await checkAdminStatus();
    if (status.isAdmin) {
      isGalleryAdmin.value = true;
      isPinAdminVerified.value = true;
      const pinRes = await fetchHighlightUploadPinAsAdmin();
      if (pinRes.success) {
        currentServerUploadPin.value = pinRes.uploadPin || '';
        newServerUploadPin.value = pinRes.uploadPin || '';
      }
    } else {
      isGalleryAdmin.value = false;
      isPinAdminVerified.value = false;
    }
  } finally {
    isPinAdminLoading.value = false;
  }
};

const verifyAdminForPinModal = async () => {
  pinAdminError.value = '';
  aliasAdminError.value = '';
  if (!adminPasscodeInputForPin.value.trim()) {
    pinAdminError.value = '관리자 인증 코드를 입력해 주세요.';
    return;
  }
  isPinAdminLoading.value = true;
  try {
    sessionStorage.setItem('schedule_admin_passcode', adminPasscodeInputForPin.value.trim());
    const status = await checkAdminStatus();
    if (status.isAdmin) {
      isGalleryAdmin.value = true;
      isPinAdminVerified.value = true;
      const [pinRes, aliasRes] = await Promise.all([
        fetchHighlightUploadPinAsAdmin(),
        fetchMemberAliasesFromServer(),
      ]);
      if (aliasRes.memberAliases) {
        memberAliasesMap.value = aliasRes.memberAliases;
      }
      if (pinRes.success) {
        currentServerUploadPin.value = pinRes.uploadPin || '';
        newServerUploadPin.value = pinRes.uploadPin || '';
      }
    } else {
      pinAdminError.value = '관리자 코드가 일치하지 않습니다.';
    }
  } finally {
    isPinAdminLoading.value = false;
  }
};

const saveNewServerUploadPin = async () => {
  pinAdminError.value = '';
  pinAdminMessage.value = '';
  if (!newServerUploadPin.value.trim() || newServerUploadPin.value.trim().length < 4) {
    pinAdminError.value = '새 공통 PIN은 4자리 이상이어야 합니다.';
    return;
  }
  isPinAdminLoading.value = true;
  try {
    const res = await updateHighlightUploadPinAsAdmin(newServerUploadPin.value.trim());
    if (res.success) {
      currentServerUploadPin.value = res.uploadPin || newServerUploadPin.value.trim();
      pinAdminMessage.value = res.message || '공통 업로드 PIN이 변경되었습니다.';
      saveHighlightPin(currentServerUploadPin.value);
      hasSavedValidPin.value = true;
    } else {
      pinAdminError.value = res.error || '변경에 실패했습니다.';
    }
  } finally {
    isPinAdminLoading.value = false;
  }
};


// 갤러리 핀 카드(.hl-card-body) 내부 전용 국 이름 한글 표기 변환 헬퍼
const formatCardRoundKorean = (roundName?: string): string => {
  if (!roundName) return '';
  return roundName
    .replace(/東/g, '동')
    .replace(/南/g, '남')
    .replace(/西/g, '서')
    .replace(/北/g, '북')
    .replace(/局/g, '국')
    .replace(/本場/g, '본장');
};

const formatHighlightCategoryLabel = (cat?: HighlightCategory, isCard = false): string => {
  if (cat === 'yakuman') return '역만';
  if (cat === 'fun') return '그 외 화료';
  if (cat === 'nanikiru') return '나니키루';
  return isCard ? '기타 사진' : '기타 사진';
};

// ==========================================
// 7. 개인 통계 모달 내부 탭(.tab_menu) 가로 스크롤 & 인디케이터
// ==========================================
const modalTabMenuRef = ref<HTMLElement | null>(null);
const isDraggingModalTab = ref(false);
const hasDraggedModalTab = ref(false);
let modalTabDragStartX = 0;
let modalTabStartScrollLeft = 0;
let modalTabResizeObserver: ResizeObserver | null = null;

const modalTabScrollIndicator = ref({
  visible: false,
  widthPct: 100,
  leftPct: 0,
});

const getActiveModalTabMenuEl = (): HTMLElement | null => {
  if (modalTabMenuRef.value && modalTabMenuRef.value.isConnected) {
    return modalTabMenuRef.value;
  }
  if (typeof document !== 'undefined') {
    const queried = document.querySelector('.player-modal-card .tab_menu') as HTMLElement | null;
    if (queried) {
      modalTabMenuRef.value = queried;
      return queried;
    }
  }
  return modalTabMenuRef.value;
};

const updateModalTabScrollIndicator = () => {
  const el = getActiveModalTabMenuEl();
  if (!el) {
    setScrollIndicatorIfChanged(modalTabScrollIndicator, { visible: false, widthPct: 100, leftPct: 0 });
    return;
  }
  const sw = el.scrollWidth;
  const cw = el.clientWidth;
  if (cw <= 0 || sw <= cw + 2) {
    setScrollIndicatorIfChanged(modalTabScrollIndicator, { visible: false, widthPct: 100, leftPct: 0 });
    return;
  }
  const widthPct = Math.max(16, Math.min(100, (cw / sw) * 100));
  const maxScroll = Math.max(1, sw - cw);
  const ratio = Math.max(0, Math.min(1, el.scrollLeft / maxScroll));
  const leftPct = ratio * (100 - widthPct);
  setScrollIndicatorIfChanged(modalTabScrollIndicator, {
    visible: true,
    widthPct,
    leftPct,
  });
};

const setModalTabMenuRef = (el: unknown) => {
  const htmlEl = el as HTMLElement | null;
  if (!htmlEl) {
    // v-if 분기 전환 시 이전 엘리먼트의 null 콜백이 새로 마운트된 엘리먼트 참조를 덮어쓰지 않도록 보호
    if (modalTabMenuRef.value && modalTabMenuRef.value.isConnected) {
      return;
    }
    if (modalTabResizeObserver && modalTabMenuRef.value) {
      modalTabResizeObserver.unobserve(modalTabMenuRef.value);
    }
    modalTabMenuRef.value = null;
    setScrollIndicatorIfChanged(modalTabScrollIndicator, { visible: false, widthPct: 100, leftPct: 0 });
    return;
  }

  if (modalTabMenuRef.value === htmlEl) {
    return;
  }
  if (modalTabResizeObserver && modalTabMenuRef.value) {
    modalTabResizeObserver.unobserve(modalTabMenuRef.value);
  }
  modalTabMenuRef.value = htmlEl;
  if (typeof ResizeObserver !== 'undefined') {
    if (!modalTabResizeObserver) {
      modalTabResizeObserver = new ResizeObserver(() => {
        updateModalTabScrollIndicator();
      });
    }
    modalTabResizeObserver.observe(htmlEl);
  }
  nextTick(() => {
    updateModalTabScrollIndicator();
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() => updateModalTabScrollIndicator());
    }
    setTimeout(() => updateModalTabScrollIndicator(), 80);
  });
};

const onModalTabTrackClick = (e: MouseEvent) => {
  const el = getActiveModalTabMenuEl();
  const track = e.currentTarget as HTMLElement | null;
  if (!el || !track) return;
  const rect = track.getBoundingClientRect();
  if (rect.width <= 0) return;
  const clickRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
  el.scrollTo({
    left: clickRatio * maxScroll,
    behavior: 'smooth',
  });
};

const onModalTabWindowMouseMove = (e: MouseEvent) => {
  const el = getActiveModalTabMenuEl();
  if (!isDraggingModalTab.value || !el) return;
  const dx = e.clientX - modalTabDragStartX;
  if (Math.abs(dx) > 4) {
    hasDraggedModalTab.value = true;
  }
  if (hasDraggedModalTab.value) {
    el.scrollLeft = modalTabStartScrollLeft - dx;
    updateModalTabScrollIndicator();
  }
};

const onModalTabWindowMouseUp = () => {
  if (!isDraggingModalTab.value) return;
  isDraggingModalTab.value = false;
  window.removeEventListener('mousemove', onModalTabWindowMouseMove);
  window.removeEventListener('mouseup', onModalTabWindowMouseUp);
  setTimeout(() => {
    hasDraggedModalTab.value = false;
  }, 60);
};

const onModalTabMouseDown = (e: MouseEvent) => {
  if (e.button !== 0 && e.button !== 1) return;
  const el = getActiveModalTabMenuEl();
  if (!el) return;
  if (el.scrollWidth <= el.clientWidth + 2) return;
  if (e.button === 1) e.preventDefault();
  isDraggingModalTab.value = true;
  hasDraggedModalTab.value = false;
  modalTabDragStartX = e.clientX;
  modalTabStartScrollLeft = el.scrollLeft;
  window.addEventListener('mousemove', onModalTabWindowMouseMove);
  window.addEventListener('mouseup', onModalTabWindowMouseUp);
};

const onModalTabClickCapture = (e: MouseEvent) => {
  if (hasDraggedModalTab.value) {
    e.stopPropagation();
    e.preventDefault();
    hasDraggedModalTab.value = false;
  }
};

const onModalTabWheel = (e: WheelEvent) => {
  const el = getActiveModalTabMenuEl();
  if (!el) return;
  if (el.scrollWidth > el.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
    e.preventDefault();
    el.scrollLeft += e.deltaY;
    updateModalTabScrollIndicator();
  }
};

const scrollActiveModalTabIntoView = (smooth = true) => {
  nextTick(() => {
    const el = getActiveModalTabMenuEl();
    if (!el) return;
    const activeBtn = el.querySelector('.tab_btn.active') as HTMLElement | null;
    if (activeBtn) {
      activeBtn.scrollIntoView({
        behavior: smooth ? 'smooth' : 'auto',
        inline: 'center',
        block: 'nearest',
      });
    }
    updateModalTabScrollIndicator();
    setTimeout(() => {
      updateModalTabScrollIndicator();
    }, smooth ? 240 : 60);
  });
};

watch([selectedPlayer, modalScopeTab, modalActiveTab, sessionModalActiveTab], () => {
  scrollActiveModalTabIntoView(true);
});

onMounted(() => {
  window.addEventListener('resize', updateModalTabScrollIndicator);
});
onUnmounted(() => {
  if (modalTabResizeObserver) {
    modalTabResizeObserver.disconnect();
    modalTabResizeObserver = null;
  }
  window.removeEventListener('resize', updateModalTabScrollIndicator);
  window.removeEventListener('mousemove', onModalTabWindowMouseMove);
  window.removeEventListener('mouseup', onModalTabWindowMouseUp);
});

// ==========================================
// 8. 라이트박스 헤더 배지(회차 / 경기 / 국) 클릭 시 상세 팝업 모달 연동
// ==========================================
const lightboxSessionPopupDetail = ref<SessionDetail | null>(null);
const isLoadingLightboxSessionPopup = ref(false);

const lightboxSessionPopupMembersWithRanks = computed(() => {
  const detail = lightboxSessionPopupDetail.value;
  if (!detail) return [];
  return detail.members.map(m => {
    let r1 = 0, r2 = 0, r3 = 0, r4 = 0;
    detail.games.forEach(g => {
      const p = g.players.find(pl => pl.name === m.name);
      if (p) {
        if (p.rank === 1) r1++;
        else if (p.rank === 2) r2++;
        else if (p.rank === 3) r3++;
        else if (p.rank === 4) r4++;
      }
    });
    const top2Rate = m.totalGames > 0 ? parseFloat((((r1 + r2) / m.totalGames) * 100).toFixed(2)) : 0;
    const avgUma = m.totalGames > 0 ? parseFloat((m.totalUma / m.totalGames).toFixed(1)) : 0;
    return {
      ...m,
      r1,
      r2,
      r3,
      r4,
      top2Rate,
      avgUma,
    };
  });
});

const openSessionPopupFromLightbox = async (rec: HighlightRecord) => {
  const sessName = resolveMatchedSessionName(rec.sessionName);
  if (!sessName) return;

  if (
    currentSessionDetail.value &&
    matchHighlightSession(currentSessionDetail.value.sessionName, sessName) &&
    currentSessionDetail.value.games.length > 0
  ) {
    lightboxSessionPopupDetail.value = currentSessionDetail.value;
    return;
  }

  isLoadingLightboxSessionPopup.value = true;
  lightboxSessionPopupDetail.value = {
    sessionName: sessName,
    members: [],
    games: [],
  };
  try {
    const detail = await fetchPublicSessionDetail(sessName);
    if (allRatingHistoryRecords.value.length > 0 && detail.games.length > 0) {
      attachRatingToSessionGames(sessName, detail.games, allRatingHistoryRecords.value);
    }
    lightboxSessionPopupDetail.value = detail;
  } catch (err) {
    console.warn('라이트박스 회차 팝업 로드 실패:', err);
    showToast('회차 정보를 불러오지 못했습니다.');
  } finally {
    isLoadingLightboxSessionPopup.value = false;
  }
};

const openGameFromSessionPopup = (game: SessionGame) => {
  const sessName = lightboxSessionPopupDetail.value?.sessionName || '';
  openGameDetailModal(game, false, sessName);
};

const goToSessionTabFromPopup = () => {
  const sessName = lightboxSessionPopupDetail.value?.sessionName;
  if (!sessName) return;
  selectedSession.value = sessName;
  lightboxSessionPopupDetail.value = null;
  lightboxHighlight.value = null;
  switchTab('sessions');
};

const openGamePopupFromLightbox = async (
  rec: HighlightRecord,
  targetMode: 'sheet' | 'rounds'
) => {
  const sessName = resolveMatchedSessionName(rec.sessionName);
  if (!sessName) return;

  let sessDetail: SessionDetail | null = null;
  if (
    currentSessionDetail.value &&
    matchHighlightSession(currentSessionDetail.value.sessionName, sessName) &&
    currentSessionDetail.value.games.length > 0
  ) {
    sessDetail = currentSessionDetail.value;
  } else if (
    lightboxSessionPopupDetail.value &&
    matchHighlightSession(lightboxSessionPopupDetail.value.sessionName, sessName) &&
    lightboxSessionPopupDetail.value.games.length > 0
  ) {
    sessDetail = lightboxSessionPopupDetail.value;
  } else {
    try {
      sessDetail = await fetchPublicSessionDetail(sessName);
      if (allRatingHistoryRecords.value.length > 0 && sessDetail.games.length > 0) {
        attachRatingToSessionGames(sessName, sessDetail.games, allRatingHistoryRecords.value);
      }
    } catch (err) {
      console.warn('라이트박스 경기 팝업용 회차 조회 실패:', err);
      showToast('해당 경기 정보를 불러오지 못했습니다.');
      return;
    }
  }

  if (!sessDetail || !Array.isArray(sessDetail.games) || sessDetail.games.length === 0) {
    showToast('해당 회차의 경기 기록이 없습니다.');
    return;
  }

  let matchedGame = sessDetail.games.find(
    g =>
      (rec.gameId && g.gameId && g.gameId === rec.gameId) ||
      (rec.gameIndex !== undefined && Number(g.gameIndex) === Number(rec.gameIndex))
  );

  if (!matchedGame && rec.winnerName) {
    matchedGame = sessDetail.games.find(g => g.players.some(p => p.name.trim() === rec.winnerName.trim()));
  }
  if (!matchedGame) {
    matchedGame = sessDetail.games[0];
  }

  gameModalMode.value = targetMode === 'rounds' ? 'rounds' : 'sheet';
  gameModalSelectedRound.value = '__all__';
  await openGameDetailModal(matchedGame, targetMode === 'rounds', sessName);

  if (targetMode === 'rounds') {
    gameModalMode.value = 'rounds';
    const allMovements = buildRoundMovementsFromGameDetail(selectedGameDetail.value);
    if (rec.roundName && allMovements.length > 0) {
      const normTarget = formatCardRoundKorean(rec.roundName).replace(/\s+/g, ' ').trim();
      const baseTarget = normTarget.replace(/\s*\(\d+차[^)]*\)\s*$/, '').trim();
      const matchedRm = allMovements.find(rm => {
        const normRm = formatCardRoundKorean(rm.roundName).replace(/\s+/g, ' ').trim();
        const baseRm = normRm.replace(/\s*\(\d+차[^)]*\)\s*$/, '').trim();
        return (
          rm.roundName.trim() === rec.roundName!.trim() ||
          normRm === normTarget ||
          baseRm === baseTarget
        );
      });
      gameModalSelectedRound.value = matchedRm ? matchedRm.roundName : '__all__';
    } else {
      gameModalSelectedRound.value = '__all__';
    }
  } else {
    gameModalMode.value = 'sheet';
  }
};
</script>

<template>
  <div class="stats-dashboard-container">
    <!-- 토스트 알림 -->
    <Transition name="dashboard-toast-fade">
      <div v-if="toastMessage" class="dashboard-toast">
        {{ toastMessage }}
      </div>
    </Transition>

    <!-- 상대 맞대결 승률/전적 비교 다크 팝오버 툴팁 -->
    <div
      v-if="oppTooltipPos.visible && activeOpponentStat"
      class="opponent-h2h-popover"
      :class="{ below: isOppTooltipBelow }"
      :style="{ left: oppTooltipPos.x + 'px', top: oppTooltipPos.y + 'px' }"
    >
      <div class="opp-h2h-winrate">
        승률: {{ formatOpponentPct(activeOpponentStat.winRate) }}
      </div>
      <table class="opp-h2h-table">
        <thead>
          <tr>
            <th></th>
            <th>플레이어</th>
            <th>상대</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="opp-h2h-label">평균 순위</td>
            <td>{{ activeOpponentStat.playerStats.avgRank.toFixed(3) }}</td>
            <td>{{ activeOpponentStat.opponentStats.avgRank.toFixed(3) }}</td>
          </tr>
          <tr>
            <td class="opp-h2h-label">평균 우마</td>
            <td>{{ formatSignedUma(activeOpponentStat.playerStats.avgUma) }}</td>
            <td>{{ formatSignedUma(activeOpponentStat.opponentStats.avgUma) }}</td>
          </tr>
          <tr>
            <td class="opp-h2h-label">평균 득점</td>
            <td>{{ activeOpponentStat.playerStats.avgScore.toLocaleString() }}</td>
            <td>{{ activeOpponentStat.opponentStats.avgScore.toLocaleString() }}</td>
          </tr>
          <tr>
            <td class="opp-h2h-label">1위</td>
            <td>{{ formatOpponentPct(activeOpponentStat.playerStats.p1) }} ({{ activeOpponentStat.playerStats.r1 }})</td>
            <td>{{ formatOpponentPct(activeOpponentStat.opponentStats.p1) }} ({{ activeOpponentStat.opponentStats.r1 }})</td>
          </tr>
          <tr>
            <td class="opp-h2h-label">2위</td>
            <td>{{ formatOpponentPct(activeOpponentStat.playerStats.p2) }} ({{ activeOpponentStat.playerStats.r2 }})</td>
            <td>{{ formatOpponentPct(activeOpponentStat.opponentStats.p2) }} ({{ activeOpponentStat.opponentStats.r2 }})</td>
          </tr>
          <tr>
            <td class="opp-h2h-label">3위</td>
            <td>{{ formatOpponentPct(activeOpponentStat.playerStats.p3) }} ({{ activeOpponentStat.playerStats.r3 }})</td>
            <td>{{ formatOpponentPct(activeOpponentStat.opponentStats.p3) }} ({{ activeOpponentStat.opponentStats.r3 }})</td>
          </tr>
          <tr>
            <td class="opp-h2h-label">4위</td>
            <td>{{ formatOpponentPct(activeOpponentStat.playerStats.p4) }} ({{ activeOpponentStat.playerStats.r4 }})</td>
            <td>{{ formatOpponentPct(activeOpponentStat.opponentStats.p4) }} ({{ activeOpponentStat.opponentStats.r4 }})</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 인터랙티브 연속 히스토그램 팝오버 툴팁 (폭 축소 및 50% 절반 구분선 적용) -->
    <div 
      v-if="tooltipPos.visible && activeDist" 
      class="dist-tooltip-popup"
      :class="{ below: isTooltipBelow }"
      :style="{ left: tooltipPos.x + 'px', top: tooltipPos.y + 'px' }"
    >
      <div class="dist-tooltip-header">
        <span class="dist-title">{{ activeDistName }} 전체 분포</span>
        <span v-if="activeDist.isUnrecorded" class="dist-rank-chip unrecorded">
          집계 기록 없음
        </span>
        <span v-else class="dist-rank-chip" :class="activeDist.isUpperHalf ? 'pos' : 'neg'">
          상위 {{ activeDist.topPct.toFixed(2) }}%
        </span>
      </div>
      <div class="dist-sub-rank">
        <template v-if="activeDist.isUnrecorded">
          {{ activeDist.percentileText }}
        </template>
        <template v-else>
          {{ activeDist.percentileText }} ({{ activeDist.rank }}위 / {{ activeDist.totalCount }}명)
        </template>
      </div>
      <div class="dist-my-val">
        내 수치: <strong>
          <template v-if="activeDist.isUnrecorded">- (집계 외)</template>
          <template v-else-if="activeDistName === '평균 순위'">{{ activeDist.currentValue.toFixed(3) }}{{ activeDistUnit }}</template>
          <template v-else-if="activeDistName === '촌보율' || activeDistName === '벌부율'">{{ activeDist.currentValue.toFixed(4) }}{{ activeDistUnit }}</template>
          <template v-else-if="activeDistUnit === '%'">{{ activeDist.currentValue.toFixed(2) }}{{ activeDistUnit }}</template>
          <template v-else>{{ activeDist.currentValue.toLocaleString() }}{{ activeDistUnit }}</template>
        </strong>
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
            :stroke="isDark ? 'rgba(156, 163, 175, 0.65)' : 'rgba(100, 116, 139, 0.45)'" 
            stroke-width="1.2" 
            stroke-dasharray="2,2" 
          />

          <!-- 중앙 50% 구분선 (더 두꺼운 구분 점선) -->
          <line 
            x1="80" 
            y1="0" 
            x2="80" 
            y2="44" 
            :stroke="isDark ? 'rgba(255, 255, 255, 0.65)' : 'rgba(15, 23, 42, 0.5)'" 
            stroke-width="2.0" 
            stroke-dasharray="3,2" 
          />

          <!-- 상위 30% 구분선 (연한 회색 점선) -->
          <line 
            :x1="activeDist.line70X" 
            y1="0" 
            :x2="activeDist.line70X" 
            y2="44" 
            :stroke="isDark ? 'rgba(156, 163, 175, 0.65)' : 'rgba(100, 116, 139, 0.45)'" 
            stroke-width="1.2" 
            stroke-dasharray="2,2" 
          />
        </svg>

        <!-- 폰트 왜곡 방지용 HTML 레이블 오버레이 (비율 찌그러짐 원천 차단) -->
        <div class="dist-chart-labels-overlay">
          <span class="dist-line-tag" :style="{ left: (activeDist.line30X / 160 * 100) + '%' }">{{ activeDist.higherIsBetter === false ? '상위 30%' : '하위 30%' }}</span>
          <span class="dist-line-tag tag-50" style="left: 50%;">50%</span>
          <span class="dist-line-tag" :style="{ left: (activeDist.line70X / 160 * 100) + '%' }">{{ activeDist.higherIsBetter === false ? '하위 30%' : '상위 30%' }}</span>
        </div>
      </div>

      <div class="dist-labels-row">
        <span>최소 
          <template v-if="activeDistName === '평균 순위'">{{ activeDist.min.toFixed(3) }}{{ activeDistUnit }}</template>
          <template v-else-if="activeDistName === '촌보율' || activeDistName === '벌부율'">{{ activeDist.min.toFixed(4) }}{{ activeDistUnit }}</template>
          <template v-else-if="activeDistUnit === '%'">{{ activeDist.min.toFixed(2) }}{{ activeDistUnit }}</template>
          <template v-else>{{ activeDist.min.toLocaleString() }}{{ activeDistUnit }}</template>
        </span>
        <span class="dist-avg-val">평균 
          <template v-if="activeDistName === '평균 순위'">{{ activeDist.avg.toFixed(3) }}{{ activeDistUnit }}</template>
          <template v-else-if="activeDistName === '촌보율' || activeDistName === '벌부율'">{{ activeDist.avg.toFixed(4) }}{{ activeDistUnit }}</template>
          <template v-else-if="activeDistUnit === '%'">{{ activeDist.avg.toFixed(2) }}{{ activeDistUnit }}</template>
          <template v-else>{{ activeDist.avg.toLocaleString() }}{{ activeDistUnit }}</template>
        </span>
        <span>최대 
          <template v-if="activeDistName === '평균 순위'">{{ activeDist.max.toFixed(3) }}{{ activeDistUnit }}</template>
          <template v-else-if="activeDistName === '촌보율' || activeDistName === '벌부율'">{{ activeDist.max.toFixed(4) }}{{ activeDistUnit }}</template>
          <template v-else-if="activeDistUnit === '%'">{{ activeDist.max.toFixed(2) }}{{ activeDistUnit }}</template>
          <template v-else>{{ activeDist.max.toLocaleString() }}{{ activeDistUnit }}</template>
        </span>
      </div>
    </div>

    <!-- 네비게이션 헤더 (KH 마크 제거) -->
    <header class="dashboard-header">
      <div class="header-left">
        <h1 class="header-title">김케이 하우스 대시보드</h1>
      </div>

      <div class="header-actions">
        <button class="btn-action" @click="copyDashboardLink" title="대시보드 링크 복사">
          <span>링크 복사</span>
        </button>
        <button class="btn-action" @click="loadAllData(true)" title="데이터 새로고침">
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
    <div class="tabs-nav-wrap" :class="{ 'has-scroll-indicator': tabsNavScrollIndicator.visible }">
      <nav
        ref="tabsNavRef"
        class="tabs-nav"
        :class="{ 'is-dragging': isDraggingTabsNav }"
        @mousedown="onTabsNavMouseDown"
        @click.capture="onTabsNavClickCapture"
        @auxclick.prevent
        @wheel="onTabsNavWheel"
        @scroll.passive="updateTabsNavScrollIndicator"
      >
        <button 
          class="tab-btn" 
          :class="{ active: activeTab === 'ranking' }" 
          @click="switchTab('ranking')"
        >
          종합 랭킹
        </button>
        <button 
          class="tab-btn" 
          :class="{ active: activeTab === 'rating' }" 
          @click="switchTab('rating')"
        >
          레이팅
        </button>
        <button 
          class="tab-btn" 
          :class="{ active: activeTab === 'matrix' }" 
          @click="switchTab('matrix')"
        >
          역대 전적
        </button>
        <button 
          class="tab-btn" 
          :class="{ active: activeTab === 'sessions' }" 
          @click="switchTab('sessions')"
        >
          회차 상세
        </button>
        <button 
          class="tab-btn" 
          :class="{ active: activeTab === 'schedule' }" 
          @click="switchTab('schedule')"
        >
          일정
        </button>
        <button 
          class="tab-btn" 
          :class="{ active: activeTab === 'rules' }" 
          @click="switchTab('rules')"
        >
          룰
        </button>
        <button 
          class="tab-btn" 
          :class="{ active: activeTab === 'gallery' }" 
          @click="switchTab('gallery'); refreshGalleryAuthState()"
        >
          갤러리
        </button>
      </nav>
      <div
        v-show="tabsNavScrollIndicator.visible"
        class="tabs-nav-scroll-track"
        @click="onTabsNavTrackClick"
        title="좌우 스크롤 위치 표시"
      >
        <div
          class="tabs-nav-scroll-thumb"
          :style="{
            width: tabsNavScrollIndicator.widthPct + '%',
            left: tabsNavScrollIndicator.leftPct + '%'
          }"
        ></div>
      </div>
    </div>

    <!-- 로딩 상태 -->
    <div
      v-if="isLoading && activeTab !== 'rules' && activeTab !== 'schedule' && !(activeTab === 'gallery' && highlightsList.length > 0)"
      class="loading-state"
    >
      <div class="spinner"></div>
      <p>데이터를 불러오는 중입니다...</p>
    </div>

    <!-- 에러 상태 -->
    <div v-else-if="errorMessage && activeTab !== 'rules' && activeTab !== 'schedule'" class="error-state">
      <p class="error-title">데이터를 불러오지 못했습니다</p>
      <p class="error-detail">{{ errorMessage }}</p>
      <button class="btn-retry" @click="loadAllData(true)">다시 시도</button>
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
          <div class="podium-card silver" @click="openPlayerModal(podiumTop3[1], false)">
            <div class="podium-badge">2위</div>
            <div class="podium-name">{{ podiumTop3[1].name }}</div>
            <div 
              v-if="podiumTop3[1].rating" 
              class="podium-rating-tag"
              :style="{
                color: getRatingColor(podiumTop3[1].rating),
                backgroundColor: hexToRgba(getRatingColor(podiumTop3[1].rating), isDark ? 0.18 : 0.12),
                borderColor: hexToRgba(getRatingColor(podiumTop3[1].rating), isDark ? 0.35 : 0.25)
              }"
            >
              R{{ podiumTop3[1].rating }}
            </div>
            <div class="podium-uma" :class="podiumTop3[1].totalUma >= 0 ? 'pos' : 'neg'">
              {{ podiumTop3[1].totalUma > 0 ? '+' : '' }}{{ podiumTop3[1].totalUma }}pt
            </div>
            <div class="podium-sub">
              <span>평균우마 {{ podiumTop3[1].avgUma > 0 ? '+' : '' }}{{ podiumTop3[1].avgUma }}pt</span>
              <span>평균 {{ podiumTop3[1].avgRank.toFixed(3) }}위 · {{ podiumTop3[1].totalGames }}전 (연대율 {{ formatPct(podiumTop3[1].top2Rate) }})</span>
            </div>
          </div>

          <!-- 1위 (금) -->
          <div class="podium-card gold" @click="openPlayerModal(podiumTop3[0], false)">
            <div class="podium-badge gold-badge">1위</div>
            <div class="podium-name">{{ podiumTop3[0].name }}</div>
            <div 
              v-if="podiumTop3[0].rating" 
              class="podium-rating-tag"
              :style="{
                color: getRatingColor(podiumTop3[0].rating),
                backgroundColor: hexToRgba(getRatingColor(podiumTop3[0].rating), isDark ? 0.18 : 0.12),
                borderColor: hexToRgba(getRatingColor(podiumTop3[0].rating), isDark ? 0.35 : 0.25)
              }"
            >
              R{{ podiumTop3[0].rating }}
            </div>
            <div class="podium-uma" :class="podiumTop3[0].totalUma >= 0 ? 'pos' : 'neg'">
              {{ podiumTop3[0].totalUma > 0 ? '+' : '' }}{{ podiumTop3[0].totalUma }}pt
            </div>
            <div class="podium-sub">
              <span>평균우마 {{ podiumTop3[0].avgUma > 0 ? '+' : '' }}{{ podiumTop3[0].avgUma }}pt</span>
              <span>평균 {{ podiumTop3[0].avgRank.toFixed(3) }}위 · {{ podiumTop3[0].totalGames }}전 (연대율 {{ formatPct(podiumTop3[0].top2Rate) }})</span>
            </div>
          </div>

          <!-- 3위 (동) -->
          <div class="podium-card bronze" @click="openPlayerModal(podiumTop3[2], false)">
            <div class="podium-badge">3위</div>
            <div class="podium-name">{{ podiumTop3[2].name }}</div>
            <div 
              v-if="podiumTop3[2].rating" 
              class="podium-rating-tag"
              :style="{
                color: getRatingColor(podiumTop3[2].rating),
                backgroundColor: hexToRgba(getRatingColor(podiumTop3[2].rating), isDark ? 0.18 : 0.12),
                borderColor: hexToRgba(getRatingColor(podiumTop3[2].rating), isDark ? 0.35 : 0.25)
              }"
            >
              R{{ podiumTop3[2].rating }}
            </div>
            <div class="podium-uma" :class="podiumTop3[2].totalUma >= 0 ? 'pos' : 'neg'">
              {{ podiumTop3[2].totalUma > 0 ? '+' : '' }}{{ podiumTop3[2].totalUma }}pt
            </div>
            <div class="podium-sub">
              <span>평균우마 {{ podiumTop3[2].avgUma > 0 ? '+' : '' }}{{ podiumTop3[2].avgUma }}pt</span>
              <span>평균 {{ podiumTop3[2].avgRank.toFixed(3) }}위 · {{ podiumTop3[2].totalGames }}전 (연대율 {{ formatPct(podiumTop3[2].top2Rate) }})</span>
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
              <option value="rating">레이팅순</option>
              <option value="avgUma">평균 우마순</option>
              <option value="avgRank">평균 순위순</option>
              <option value="totalGames">대국수순</option>
              <option value="top2Rate">연대율순</option>
              <option value="rankDist">순위 비율순 (1>2>3>4)</option>
            </select>
          </div>
        </div>

        <!-- 랭킹 테이블 (화료율/방총율 등 삭제, 평균우마 추가, 순위분포 1~4등 독립 열 구성) -->
        <div class="table-container">
          <table class="stats-table">
            <thead>
              <tr>
                <th rowspan="2" class="col-rank">순위</th>
                <th rowspan="2" class="col-name">이름</th>
                <th rowspan="2" class="col-sortable col-rating" @click="handleSort('rating')">
                  레이팅
                  <span class="sort-mark" v-if="sortKey === 'rating'">{{ sortOrder === 'desc' ? '▼' : '▲' }}</span>
                </th>
                <th rowspan="2" class="col-sortable col-total-uma" @click="handleSort('totalUma')">
                  누적 우마
                  <span class="sort-mark" v-if="sortKey === 'totalUma'">{{ sortOrder === 'desc' ? '▼' : '▲' }}</span>
                </th>
                <th rowspan="2" class="col-sortable col-avg-uma" @click="handleSort('avgUma')">
                  평균 우마
                  <span class="sort-mark" v-if="sortKey === 'avgUma'">{{ sortOrder === 'desc' ? '▼' : '▲' }}</span>
                </th>
                <th rowspan="2" class="col-sortable col-games" @click="handleSort('totalGames')">대국수</th>
                <th rowspan="2" class="col-sortable col-top2" @click="handleSort('top2Rate')">연대율</th>
                <th rowspan="2" class="col-sortable col-avg-rank" @click="handleSort('avgRank')">
                  평균 순위
                  <span class="sort-mark" v-if="sortKey === 'avgRank'">{{ sortOrder === 'asc' ? '▲' : '▼' }}</span>
                </th>
                <th colspan="4" class="col-ranks-dist-group-th col-sortable" @click="handleSort('rankDist')" title="1>2>3>4 순위비율 우선순위 정렬">
                  순위 분포 &amp; 비율
                  <span class="sort-mark" v-if="sortKey === 'rankDist'">{{ sortOrder === 'desc' ? '▼' : '▲' }}</span>
                </th>
              </tr>
              <tr class="header-sub-row">
                <th class="col-sortable col-rank-item-th col-rank-1" @click="handleSort('rankDist')" title="1위 비율순 정렬 (동률 시 2>3>4위)">
                  <div class="dist-badge r1 dist-header-badge">1등</div>
                  <span class="sort-mark" v-if="sortKey === 'rankDist' || sortKey === 'rank1Rate'">{{ sortOrder === 'desc' ? '▼' : '▲' }}</span>
                </th>
                <th class="col-sortable col-rank-item-th col-rank-2" @click="handleSort('rank2Rate')" title="2위 비율순 정렬">
                  <div class="dist-badge r2 dist-header-badge">2등</div>
                  <span class="sort-mark" v-if="sortKey === 'rank2Rate'">{{ sortOrder === 'desc' ? '▼' : '▲' }}</span>
                </th>
                <th class="col-sortable col-rank-item-th col-rank-3" @click="handleSort('rank3Rate')" title="3위 비율순 정렬">
                  <div class="dist-badge r3 dist-header-badge">3등</div>
                  <span class="sort-mark" v-if="sortKey === 'rank3Rate'">{{ sortOrder === 'desc' ? '▼' : '▲' }}</span>
                </th>
                <th class="col-sortable col-rank-item-th col-rank-4" @click="handleSort('rank4Rate')" title="4위 비율순 정렬">
                  <div class="dist-badge r4 dist-header-badge">4등</div>
                  <span class="sort-mark" v-if="sortKey === 'rank4Rate'">{{ sortOrder === 'desc' ? '▼' : '▲' }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr 
                v-for="member in filteredStats" 
                :key="member.name"
                class="member-row"
                @click="openPlayerModal(member, false)"
                title="클릭 시 상세 스탯 & 연속 히스토그램 조회"
              >
                <td class="col-rank">
                  <span class="rank-badge" :class="getRankClass(member.overallRank)">{{ member.overallRank }}</span>
                </td>
                <td class="col-name" :title="member.name">
                  <strong>{{ member.name }}</strong>
                </td>
                <td class="col-rating">
                  <span 
                    class="rating-badge"
                    :style="{
                      color: getRatingColor(member.rating),
                      backgroundColor: hexToRgba(getRatingColor(member.rating), isDark ? 0.18 : 0.12),
                      borderColor: hexToRgba(getRatingColor(member.rating), isDark ? 0.45 : 0.35)
                    }"
                  >R{{ member.rating ?? 1167 }}</span>
                </td>
                <td class="col-total-uma col-uma" :class="member.totalUma >= 0 ? 'pos' : 'neg'">
                  {{ member.totalUma > 0 ? '+' : '' }}{{ member.totalUma.toFixed(1) }}
                </td>
                <td class="col-avg-uma" :class="member.avgUma >= 0 ? 'pos' : 'neg'">
                  {{ member.avgUma > 0 ? '+' : '' }}{{ member.avgUma.toFixed(1) }}
                </td>
                <td class="col-games">{{ member.totalGames }}전</td>
                <td class="col-top2">{{ formatPct(member.top2Rate) }}</td>
                <td class="col-avg-rank">{{ member.avgRank.toFixed(3) }}위</td>
                <!-- 1등, 2등, 3등, 4등 독립 열 -->
                <td class="col-rank-item col-rank-1">
                  <div class="dist-badge r1" :title="'1위 ' + member.rank1Count + '회'">
                    <span class="dist-cnt">{{ member.rank1Count }}</span>
                    <span class="dist-pct">({{ getDistPct(member.rank1Count, member.totalGames) }}%)</span>
                  </div>
                </td>
                <td class="col-rank-item col-rank-2">
                  <div class="dist-badge r2" :title="'2위 ' + member.rank2Count + '회'">
                    <span class="dist-cnt">{{ member.rank2Count }}</span>
                    <span class="dist-pct">({{ getDistPct(member.rank2Count, member.totalGames) }}%)</span>
                  </div>
                </td>
                <td class="col-rank-item col-rank-3">
                  <div class="dist-badge r3" :title="'3위 ' + member.rank3Count + '회'">
                    <span class="dist-cnt">{{ member.rank3Count }}</span>
                    <span class="dist-pct">({{ getDistPct(member.rank3Count, member.totalGames) }}%)</span>
                  </div>
                </td>
                <td class="col-rank-item col-rank-4">
                  <div class="dist-badge r4" :title="'4위 ' + member.rank4Count + '회'">
                    <span class="dist-cnt">{{ member.rank4Count }}</span>
                    <span class="dist-pct">({{ getDistPct(member.rank4Count, member.totalGames) }}%)</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- ============================================== -->
      <!-- TAB 2: 레이팅 & 추이                            -->
      <!-- ============================================== -->
      <section v-else-if="activeTab === 'rating'" class="tab-rating">
        <!-- 1. 전체 플레이어 레이팅 변동 추이 인라인 차트 카드 -->
        <div class="rating-chart-card">
          <div class="rating-chart-header">
            <div class="rating-chart-title-group">
              <h2 class="rating-section-title">전체 플레이어 레이팅 변동 추이</h2>
              <span class="rating-section-desc">마우스 휠 스크롤 / 핀치 줌으로 확대하고 좌우 드래그로 타임라인을 탐색할 수 있습니다.</span>
            </div>
            <button type="button" class="btn-open-rating-modal" @click="isRatingTimelineModalOpen = true" title="전체화면 큰 화면으로 확대합니다">
              <svg class="dashboard-icon-svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 3 21 3 21 9"></polyline>
                <polyline points="9 21 3 21 3 15"></polyline>
                <line x1="21" y1="3" x2="14" y2="10"></line>
                <line x1="3" y1="21" x2="10" y2="14"></line>
              </svg>
              전체화면 확대
            </button>
          </div>

          <!-- 툴바: 퀵 필터 버튼 + 회차별 필터 + 줌 리셋 -->
          <div class="rating-chart-toolbar">
            <div class="toolbar-left">
              <span class="toolbar-label">선택:</span>
              <button 
                type="button" 
                class="btn-rating-filter" 
                :class="{ active: activeRatingPreset === 'top5' }" 
                @click="filterRatingTopN(5)"
              >
                상위 5명
              </button>
              <button 
                type="button" 
                class="btn-rating-filter" 
                :class="{ active: activeRatingPreset === 'top10' }" 
                @click="filterRatingTopN(10)"
              >
                상위 10명
              </button>
              <button 
                type="button" 
                class="btn-rating-filter" 
                :class="{ active: activeRatingPreset === 'all' }" 
                @click="filterRatingAll(true)"
              >
                전체 선택
              </button>
              <button 
                type="button" 
                class="btn-rating-filter" 
                :class="{ active: activeRatingPreset === 'none' }" 
                @click="filterRatingAll(false)"
              >
                전체 해제
              </button>
            </div>

            <div class="toolbar-right">
              <div class="session-filter-group">
                <span class="toolbar-label">회차 필터:</span>
                <select v-model="selectedRatingSessionFilter" @change="handleSessionFilterChange" class="session-filter-select">
                  <option value="">전체 회차</option>
                  <option v-for="s in availableRatingSessions" :key="s" :value="s">
                    {{ s }}
                  </option>
                </select>
              </div>

              <button type="button" class="btn-zoom-reset" @click="resetRatingChartZoom" title="확대/축소 배율을 초기화합니다">
                줌 리셋
              </button>
            </div>
          </div>

          <!-- 선수 범례 (캔버스 외부 HTML 렌더링으로 좁은 화면에서 그래프 영역 침범 원천 방지) -->
          <div v-if="ratingChartData.datasets.length > 0" class="rating-player-legend">
            <button
              v-for="ds in ratingChartData.datasets"
              :key="`inline-leg-${ds.label}`"
              type="button"
              class="rating-legend-item"
              :class="{ 'is-hidden': hiddenRatingPlayerNames.has(ds.label) }"
              @click="toggleRatingPlayerLegend(ds.label)"
            >
              <span class="rating-legend-dot" :style="{ backgroundColor: String(ds.borderColor) }"></span>
              <span class="rating-legend-label">{{ ds.label }}</span>
            </button>
          </div>

          <!-- 차트 캔버스 영역 -->
          <div class="rating-inline-chart-wrapper">
            <div v-if="ratingChartData.datasets.length > 0" v-show="!isRatingTimelineModalOpen" class="rating-inline-chart-inner">
              <LineChart 
                id="rating-inline-chart-canvas"
                ref="ratingEmbeddedChartRef" 
                :data="ratingChartData" 
                :options="ratingChartOptions" 
                :plugins="ratingChartPlugins"
              />
            </div>
            <div v-else class="rating-chart-empty">
              레이팅 변동 이력 데이터를 불러오는 중이거나 기록이 없습니다.
            </div>
          </div>
        </div>

        <!-- 2. 레이팅 순위표 -->
        <div class="rating-leaderboard-card">
          <div class="leaderboard-header">
            <h2 class="rating-section-title">레이팅 순위 및 현황</h2>
            <span class="rating-section-desc"></span>
          </div>

          <div class="table-container">
            <table class="rating-table">
              <thead>
                <tr>
                  <th style="width: 50px; text-align: center;">순위</th>
                  <th style="min-width: 100px;">이름</th>
                  <th style="min-width: 90px; text-align: center;">레이팅(R)</th>
                  <th style="min-width: 80px; text-align: center;">역대 최고</th>
                  <th style="min-width: 70px; text-align: center;">대국 수</th>
                  <th style="min-width: 70px; text-align: center;">평균 (μ)</th>
                  <th style="min-width: 70px; text-align: center;">불확실도 (σ)</th>
                </tr>
              </thead>
              <tbody>
                <tr 
                  v-for="(player, idx) in ratingLeaderboard" 
                  :key="player.name"
                  @click="openPlayerModal(player, false)"
                  class="clickable-row"
                >
                  <td style="text-align: center; font-weight: bold;">
                    <span 
                      class="rank-chip" 
                      :class="{
                        'gold': idx === 0,
                        'silver': idx === 1,
                        'bronze': idx === 2
                      }"
                    >
                      {{ idx + 1 }}
                    </span>
                  </td>
                  <td class="player-name-cell">
                    <strong>{{ player.name }}</strong>
                  </td>
                  <td style="text-align: center;">
                    <span 
                      class="rating-badge-pill"
                      :style="{
                        color: getRatingColor(player.rating),
                        backgroundColor: hexToRgba(getRatingColor(player.rating), isDark ? 0.18 : 0.12),
                        borderColor: hexToRgba(getRatingColor(player.rating), isDark ? 0.45 : 0.35)
                      }"
                    >R{{ player.rating ?? 1320 }}</span>
                  </td>
                  <td style="text-align: center; font-weight: 600;" :style="{ color: getRatingColor(player.ratingPeak ?? (player.ratingHistory && player.ratingHistory.length > 0 ? Math.max(...player.ratingHistory.map(h => h.ordinal)) : (player.rating ?? 1320))) }">
                    R{{ player.ratingPeak ?? (player.ratingHistory && player.ratingHistory.length > 0 ? Math.max(...player.ratingHistory.map(h => h.ordinal)) : (player.rating ?? 1320)) }}
                  </td>
                  <td style="text-align: center;">
                    {{ player.totalGames }}전
                  </td>
                  <td style="text-align: center; color: #64748b;">
                    {{ (player.ratingMu ?? 1500).toFixed(1) }}
                  </td>
                  <td style="text-align: center; color: #64748b;">
                    {{ (player.ratingSigma ?? 120).toFixed(1) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 3. 레이팅 시스템 산출 원리 및 공식 안내 -->
        <div class="rating-guide-card">
          <div class="guide-header">
            <h2 class="rating-section-title">레이팅 산출 원리 및 상세 계산식</h2>
            <span class="rating-section-desc">대국 결과(우마), 상대 테이블과의 레이팅 격차, 판수 스케일을 반영한 공식 산출식입니다.</span>
          </div>

          <div class="formula-cards-grid">
            <div class="formula-box">
              <div class="formula-tag">1. 표시 레이팅 산출 공식</div>
              <div class="formula-latex" v-html="renderKatex('R = \\mathrm{round}(\\mu - 1.5 \\times \\sigma)')"></div>
              <p class="formula-explanation">기본 실력(μ=1500)과 불확실도(σ=120)로 시작해 초기값은 1320이 되며, 판수가 쌓여 σ가 감소할수록 실제 레이팅에 근접합니다.</p>
            </div>

            <div class="formula-box">
              <div class="formula-tag">2. 경기 실력 갱신 공식 (Δμ)</div>
              <div class="formula-latex" v-html="renderKatex('\\Delta \\mu = \\left(\\frac{\\sigma}{120}\\right) \\times \\left( \\text{Uma} + \\frac{\\bar{R}_{\\text{table}} - R}{30} \\right)')"></div>
              <p class="formula-explanation">우마(Uma)와 상대 테이블 평균 격차 보정값을 합산한 뒤, 판수 스케일(σ/120)을 곱하여 최종 변동치를 계산합니다.</p>
            </div>

            <div class="formula-box">
              <div class="formula-tag">3. 약 40판 이후 안정화 공식</div>
              <div class="formula-latex" v-html="renderKatex('\\Delta R_{N \\ge 40} \\approx \\frac{1}{3} \\times \\left( \\text{Uma} + \\frac{\\bar{R}_{\\text{table}} - R}{30} \\right)')"></div>
              <p class="formula-explanation">약 40판 이후 불확실도(σ)가 최소치(40)에 도달하면, 스케일이 1/3로 고정되어 모든 대국에서 일정한 변동폭 기준을 유지합니다.</p>
            </div>
          </div>

          <!-- 레이팅 핵심 원리 요약 안내 카드 -->
          <div class="rating-buffer-callout">
            <div class="rbc-header">
              <span class="rbc-icon">💡</span>
              <h3 class="rbc-title">레이팅 산출 핵심 요약</h3>
            </div>
            <div class="rbc-body">
              <div class="rbc-step">
                <div class="rbc-step-header">
                  <span class="rbc-step-badge">원리 1</span>
                  <span class="rbc-step-title">시작 레이팅(1320)과 실제 기준 실력(1500)</span>
                </div>
                <p>
                  시스템 내부의 실제 기준 실력치는 <strong>1500</strong>입니다.
                  신규 플레이어의 시작 레이팅은 <strong>1320</strong>으로 표기되지만, 이는 판수가 적은 상태의 초기값(허상)일 뿐입니다.
                  본전 성적(우마 0pt)만 유지하더라도 대국을 거듭할수록 불확실성(σ)이 줄어들며 본래 실력 기준치인 1500을 향해 자연스럽게 근접합니다.
                </p>
              </div>
              <div class="rbc-step">
                <div class="rbc-step-header">
                  <span class="rbc-step-badge">원리 2</span>
                  <span class="rbc-step-title">상대 레이팅에 따른 변동폭 가감 (상대 실력차 보정)</span>
                </div>
                <p>
                  나보다 레이팅이 높은 상대들과 대국해서 이기면 보너스를 받아 더 많은 레이팅을 얻고, 나보다 레이팅이 낮은 상대들에게 패배하면 페널티로 더 많은 레이팅을 잃습니다.
                  대국 테이블 4인의 평균 레이팅과 내 레이팅의 격차가 <code>(평균 레이팅 - 내 레이팅) / 30</code> 보정치로 대국 결과(우마)에 직접 더해집니다.
                </p>
              </div>
              <div class="rbc-step">
                <div class="rbc-step-header">
                  <span class="rbc-step-badge">원리 3</span>
                  <span class="rbc-step-title">판수 누적에 따른 변화량 안정화 (약 40판 기준)</span>
                </div>
                <p>
                  대국 초반(1~40판가량)에는 빠른 실력 측정을 위해 판당 레이팅 변화량(등락폭)이 큽니다.
                  판수를 거듭할수록 불확실성(σ)이 줄어들어 변화량이 점차 작아지며, <strong>약 40판 이후</strong>부터는 최소치(σ=40)에 도달해 <strong>스케일이 1/3로 고정</strong>되어 이후 대국부터는 변화량 기준이 동일하게 유지됩니다.
                </p>
              </div>
            </div>
          </div>

          <div class="param-table-container">
            <table class="param-table">
              <thead>
                <tr>
                  <th>파라미터</th>
                  <th>설정값</th>
                  <th>설명</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>기준 실력치 (μ)</strong></td>
                  <td><strong>1500</strong></td>
                  <td>모든 참가자의 시스템 실제 기준 실력 (판수 누적 시 수렴하는 목표점)</td>
                </tr>
                <tr>
                  <td><strong>시작 레이팅 (R₀)</strong></td>
                  <td><strong>1320</strong></td>
                  <td>신규 참가자의 초기 표기값 (대국 수가 적을 때의 임시 표기값: 1500 - 1.5×120)</td>
                </tr>
                <tr>
                  <td><strong>불확실도 (σ)</strong></td>
                  <td><strong>120 → 최소 40</strong></td>
                  <td>대국을 치를수록 감소하며, 약 40판 이후에는 최소치인 40으로 고정</td>
                </tr>
                <tr>
                  <td><strong>판수 스케일</strong></td>
                  <td><strong>σ / 120</strong></td>
                  <td>초반 1.0에서 시작해 약 40판 후 최소치인 1/3 (약 0.33)로 안정화</td>
                </tr>
                <tr>
                  <td><strong>대국 결과 (우마)</strong></td>
                  <td><strong>경기 우마</strong></td>
                  <td>대국 순위 및 최종 점수에 따라 획득한 우마(Uma)가 기본 변동값으로 반영</td>
                </tr>
                <tr>
                  <td><strong>상대 실력차 보정</strong></td>
                  <td><strong>(R̄_table - R) / 30</strong></td>
                  <td>나보다 높은 테이블에서 승리 시 가산점, 낮은 테이블에서 패배 시 추가 감점</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- ============================================== -->
      <!-- TAB 3: 역대 회차 전적 ('통계' 시트)            -->
      <!-- ============================================== -->
      <section v-else-if="activeTab === 'matrix'" class="tab-matrix">
        <div class="matrix-controls-bar">
          <div class="matrix-info-text">
            김케이 하우스 전 회차 우마 기록입니다. 상단 회차명을 누르면 경기 상세로, 멤버명을 누르면 개인 상세 스탯으로 이동합니다.
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
            <option v-for="s in displayedAvailableSessions" :key="s" :value="s">
              {{ s }} {{ s === displayedAvailableSessions[0] ? '(최신)' : '' }}
            </option>
          </select>
        </div>

        <!-- 회차 스코프 탭 (이번 회차 / 전체 기간) -->
        <div class="session-scope-tabs">
          <button 
            class="session-scope-tab" 
            :class="{ active: sessionScopeTab === 'session' }" 
            @click="sessionScopeTab = 'session'"
          >
            이번 회차
          </button>
          <button 
            class="session-scope-tab" 
            :class="{ active: sessionScopeTab === 'all' }" 
            @click="sessionScopeTab = 'all'"
          >
            전체 기간
          </button>
        </div>

        <div v-if="isLoadingSession" class="loading-session">
          <div class="spinner-small"></div>
          <span>{{ selectedSession }} 데이터를 조회하는 중...</span>
        </div>

        <div v-else-if="currentSessionDetail" class="session-content">
          <!-- 1) 이번 회차 탭 내용 -->
          <template v-if="sessionScopeTab === 'session'">
            <!-- 회차 최종 순위표 -->
            <div class="section-card">
              <h3 class="card-title">{{ currentSessionDetail.sessionName }} 최종 순위</h3>
              <div class="session-members-grid">
                <div 
                  v-for="(m, idx) in sessionMembersWithRanks" 
                  :key="m.name" 
                  class="session-member-card"
                  @click="openPlayerByName(m.name, true)"
                  title="상세 스탯 보기"
                >
                  <div class="sm-rank-badge" :class="getRankClass(idx + 1)">{{ idx + 1 }}위</div>
                  <div class="sm-info">
                    <div class="sm-name">{{ m.name }}</div>
                    <div class="sm-sub">{{ m.totalGames }}경기 / 평균 {{ m.avgRank.toFixed(3) }}위 (연대 {{ formatPct(m.top2Rate) }})</div>
                    <div class="sm-dist-badges">
                      <span class="sm-badge r1" title="1위">1등 {{ m.r1 }}</span>
                      <span class="sm-badge r2" title="2위">2등 {{ m.r2 }}</span>
                      <span class="sm-badge r3" title="3위">3등 {{ m.r3 }}</span>
                      <span class="sm-badge r4" title="4위">4등 {{ m.r4 }}</span>
                    </div>
                  </div>
                  <div class="sm-points-col">
                    <div class="sm-uma" :class="m.totalUma >= 0 ? 'pos' : 'neg'">
                      {{ m.totalUma > 0 ? '+' : '' }}{{ m.totalUma }}pt
                    </div>
                    <div 
                      v-if="m.sessionRatingDelta !== undefined" 
                      class="sm-rating-delta"
                      :title="m.startRating !== undefined && m.endRating !== undefined ? `회차 시작 R${m.startRating} → 종료 R${m.endRating} (${m.sessionRatingDelta >= 0 ? '+' : ''}${m.sessionRatingDelta})` : undefined"
                    >
                      <span class="sm-rating-val" v-if="m.endRating !== undefined" :style="{ color: getRatingColor(m.endRating) }">
                        R{{ m.endRating }}
                      </span>
                      <span class="sm-rdelta" :class="m.sessionRatingDelta >= 0 ? 'pos' : 'neg'">
                        ({{ m.sessionRatingDelta >= 0 ? '+' : '' }}{{ m.sessionRatingDelta }})
                      </span>
                    </div>
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
                  :key="`session-chart-${selectedSession}-${isDark ? 'dark' : 'light'}`"
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
                  :key="game.gameId || game.gameIndex" 
                  class="game-card clickable-game-card"
                  @click="openGameDetailModal(game)"
                  title="클릭하여 대국 결과 표 및 점수 변동 그래프 보기"
                >
                  <div class="game-card-header">
                    <div class="game-card-title-group">
                      <span class="game-index">{{ game.gameIndex }}경기</span>
                      <span v-if="hasGameYakumanBadge(game)" class="game-yakuman-badge">역만</span>
                      <span
                        v-for="hl in getGameHighlights(game)"
                        :key="hl.id"
                        class="game-hl-chip"
                        :class="hl.category === 'yakuman' ? 'chip-yakuman' : hl.category === 'nanikiru' ? 'chip-nanikiru' : 'chip-fun'"
                      >
                        <template v-if="hl.category === 'yakuman'">
                          {{ hl.winnerName }} {{ hl.yakumanTypes.join('·') }}
                        </template>
                        <template v-else-if="hl.category === 'nanikiru'">
                          나니키루{{ hl.yakumanTypes && hl.yakumanTypes.length > 0 ? ' · ' + hl.yakumanTypes.join('·') : '' }}
                        </template>
                        <template v-else>
                          그 외 화료
                        </template>
                      </span>
                    </div>
                    <span class="game-card-action-hint">상세 결과 / 차트 보기 &gt;</span>
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
                      <div 
                        v-if="p.ratingBefore !== undefined" 
                        class="gp-rating"
                        :title="`대국 전 R${p.ratingBefore} → 대국 후 R${p.ratingAfter} (${p.ratingDelta !== undefined && p.ratingDelta >= 0 ? '+' : ''}${p.ratingDelta})`"
                      >
                        <span class="gp-rating-val" :style="{ color: getRatingColor(p.ratingBefore) }">
                          R{{ p.ratingBefore }}
                        </span>
                        <span class="gp-rating-delta" :class="(p.ratingDelta || 0) >= 0 ? 'pos' : 'neg'">
                          ({{ (p.ratingDelta || 0) >= 0 ? '+' : '' }}{{ p.ratingDelta }})
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 해당 회차 사진 & 역만 갤러리 카드 -->
            <div class="section-card session-gallery-card">
              <div class="sg-header-row">
                <div>
                  <h3 class="card-title">{{ currentSessionDetail.sessionName }} 사진 &amp; 역만 갤러리 ({{ currentSessionHighlights.length }})</h3>
                  <p class="sg-sub-desc">이 회차에서 달성된 역만, 그 외 화료, 나니키루, 기타 사진을 보관합니다.</p>
                </div>
                <div class="sg-btn-group">
                  <button
                    class="btn-hl-upload primary"
                    @click="openHighlightUploadModal({ category: 'yakuman', sessionName: currentSessionDetail.sessionName })"
                  >
                    역만 / 화료 등록
                  </button>
                  <button
                    class="btn-hl-upload nanikiru"
                    @click="openHighlightUploadModal({ category: 'nanikiru', sessionName: currentSessionDetail.sessionName })"
                  >
                    나니키루 등록
                  </button>
                  <button
                    class="btn-hl-upload secondary"
                    @click="openHighlightUploadModal({ category: 'session', sessionName: currentSessionDetail.sessionName })"
                  >
                    기타 사진 등록
                  </button>
                </div>
              </div>

              <div v-if="currentSessionHighlights.length === 0" class="sg-empty-box">
                아직 이 회차에 등록된 역만 기록이나 사진이 없습니다. 우측 상단 버튼으로 첫 사진을 등록해 보세요.
              </div>
              <div v-else class="pinterest-masonry-grid session-masonry-grid">
                <div
                  v-for="rec in currentSessionHighlights"
                  :key="rec.id"
                  class="pinterest-pin-card"
                  :class="'hl-cat-' + rec.category"
                  @click="openHighlightLightbox(rec)"
                >
                  <div
                    v-if="rec.hasImage && rec.imageId"
                    class="pinterest-img-wrap"
                    :class="{ 'is-loaded': loadedThumbIds.has(rec.imageId) }"
                    :style="getThumbWrapStyle(rec.imageId)"
                  >
                    <img
                      :src="getHighlightThumbnailUrl(rec.imageId)"
                      :alt="rec.caption || rec.winnerName"
                      loading="lazy"
                      decoding="async"
                      class="pinterest-img"
                      :class="{ 'is-loaded': loadedThumbIds.has(rec.imageId) }"
                      @load="handleThumbImageLoad(rec.imageId, $event)"
                      @error="handleThumbImageLoad(rec.imageId)"
                    />
                  </div>
                  <div v-else class="hl-no-img-banner" :class="{ 'is-fun-banner': rec.category === 'fun', 'is-nanikiru-banner': rec.category === 'nanikiru' }">
                    <span class="hl-yakuman-kanji">{{ rec.category === 'yakuman' ? '役満' : rec.category === 'nanikiru' ? '何切る' : '和了' }}</span>
                    <span class="hl-yakuman-main-txt">
                      {{ rec.category === 'yakuman' ? rec.yakumanTypes.join(' · ') : rec.category === 'nanikiru' ? '무엇을 버릴까' : (rec.winnerName || '그 외 화료') }}
                    </span>
                  </div>
                  <div class="hl-card-body">
                    <div class="hl-meta-top">
                      <span class="hl-type-tag" :class="rec.category">
                        {{ formatHighlightCategoryLabel(rec.category, true) }}
                      </span>
                      <span v-if="rec.gameIndex" class="hl-round-tag">{{ rec.gameIndex }}경기 {{ formatCardRoundKorean(rec.roundName) }}</span>
                      <span v-else-if="rec.roundName" class="hl-round-tag">{{ formatCardRoundKorean(rec.roundName) }}</span>
                      <span
                        v-if="getRecordCommentCount(rec) > 0 && (!rec.yakumanTypes || rec.yakumanTypes.length === 0) && !rec.winnerName"
                        class="hl-comment-cnt-badge"
                        title="댓글 수"
                      >
                        <svg class="hl-comment-svg" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                        </svg>
                        <span>{{ getRecordCommentCount(rec) }}</span>
                      </span>
                    </div>
                    <div v-if="rec.yakumanTypes && rec.yakumanTypes.length > 0" class="hl-yakuman-badges">
                      <span
                        v-for="yt in rec.yakumanTypes"
                        :key="yt"
                        class="hl-y-badge"
                        :class="{ 'is-nanikiru-tag': rec.category === 'nanikiru' }"
                      >{{ yt }}</span>
                      <span v-if="getRecordCommentCount(rec) > 0" class="hl-comment-cnt-badge" title="댓글 수">
                        <svg class="hl-comment-svg" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                        </svg>
                        <span>{{ getRecordCommentCount(rec) }}</span>
                      </span>
                    </div>
                    <div v-if="rec.winnerName" class="hl-winner-line">
                      <strong
                        class="hl-player-link"
                        title="클릭하여 스탯 보기"
                        @click.stop="openPlayerByName(rec.winnerName, true, false, false, rec.sessionName || selectedSession)"
                      >{{ rec.winnerName }}</strong>
                      <span v-if="rec.winType && rec.category !== 'nanikiru' && rec.category !== 'session'" class="hl-wintype">
                        ({{ rec.winType === 'tsumo' ? '쯔모' : '론' }}<template v-if="rec.winType === 'ron' && rec.loserName"> ← <span class="hl-player-link" title="클릭하여 스탯 보기" @click.stop="openPlayerByName(rec.loserName, true, false, false, rec.sessionName || selectedSession)">{{ rec.loserName }}</span></template>)
                      </span>
                      <span
                        v-if="getRecordCommentCount(rec) > 0 && (!rec.yakumanTypes || rec.yakumanTypes.length === 0)"
                        class="hl-comment-cnt-badge"
                        title="댓글 수"
                      >
                        <svg class="hl-comment-svg" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                        </svg>
                        <span>{{ getRecordCommentCount(rec) }}</span>
                      </span>
                    </div>
                    <div v-if="rec.caption" class="hl-caption rich-mahjong-content">
                      <template v-for="(seg, sIdx) in parseRichMahjongText(rec.caption)" :key="`s-cap-${rec.id}-${sIdx}`">
                        <span v-if="seg.type === 'text'">{{ seg.text }}</span>
                        <span v-else-if="seg.type === 'meld-group'" class="mj-hand" :title="seg.rawNotation">
                          <span
                            v-for="(blk, bIdx) in seg.blocks"
                            :key="`s-cap-blk-${rec.id}-${sIdx}-${bIdx}`"
                            class="mj-meld-block"
                            :class="{ 'is-draw-block': blk.isDraw }"
                          >
                            <template v-for="(item, iIdx) in blk.items" :key="`s-cap-it-${rec.id}-${sIdx}-${bIdx}-${iIdx}`">
                              <span v-if="item.mode === 'side'" class="mj-side-wrap" :title="item.tile.label">
                                <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" loading="lazy" />
                              </span>
                              <span v-else-if="item.mode === 'kakan'" class="mj-kakan-wrap" :title="`${item.tile.label} 가깡`">
                                <span class="mj-side-wrap">
                                  <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" loading="lazy" />
                                </span>
                                <span class="mj-side-wrap">
                                  <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" loading="lazy" />
                                </span>
                              </span>
                              <span v-else class="mj-upright-wrap" :title="item.tile.label">
                                <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" loading="lazy" />
                              </span>
                            </template>
                          </span>
                        </span>
                        <span
                          v-else-if="seg.type === 'tile'"
                          class="inline-mahjong-tile"
                          :title="seg.tile.label"
                        >
                          <img :src="getMahjongTileImageUrl(seg.tile.fileName)" :alt="seg.tile.label" loading="lazy" />
                        </span>
                        <span v-else-if="seg.type === 'action'" class="inline-mahjong-action" :class="seg.action.colorClass">
                          {{ seg.action.label }}
                        </span>
                      </template>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </template>

          <!-- 2) 전체 기간 탭 내용: 출전자 통산 전체 통계 -->
          <template v-else>
            <div class="section-card">
              <h3 class="card-title">{{ currentSessionDetail.sessionName }} 출전자 통산 전체 통계</h3>
              <div class="table-container">
                <table class="stats-table">
                  <thead>
                    <tr>
                      <th rowspan="2" class="col-rank">전체순위</th>
                      <th rowspan="2" class="col-name">이름</th>
                      <th rowspan="2" class="col-total-uma">누적 우마</th>
                      <th rowspan="2" class="col-avg-uma">평균 우마</th>
                      <th rowspan="2" class="col-games">대국수</th>
                      <th rowspan="2" class="col-top2">연대율</th>
                      <th rowspan="2" class="col-avg-rank">평균 순위</th>
                      <th colspan="4" class="col-ranks-dist-group-th">순위 분포 &amp; 비율</th>
                    </tr>
                    <tr class="header-sub-row">
                      <th class="col-rank-item-th col-rank-1"><div class="dist-badge r1 dist-header-badge">1등</div></th>
                      <th class="col-rank-item-th col-rank-2"><div class="dist-badge r2 dist-header-badge">2등</div></th>
                      <th class="col-rank-item-th col-rank-3"><div class="dist-badge r3 dist-header-badge">3등</div></th>
                      <th class="col-rank-item-th col-rank-4"><div class="dist-badge r4 dist-header-badge">4등</div></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr 
                      v-for="member in sessionMembersAllStats" 
                      :key="member.name"
                      class="member-row"
                      @click="openPlayerByName(member.name, true)"
                      title="클릭 시 상세 스탯 & 연속 히스토그램 조회"
                    >
                      <td class="col-rank">
                        <span class="rank-badge" :class="getRankClass(member.overallRank)">{{ member.overallRank }}</span>
                      </td>
                      <td class="col-name" :title="member.name">
                        <strong>{{ member.name }}</strong>
                      </td>
                      <td class="col-total-uma col-uma" :class="member.totalUma >= 0 ? 'pos' : 'neg'">
                        {{ member.totalUma > 0 ? '+' : '' }}{{ member.totalUma.toFixed(1) }}
                      </td>
                      <td class="col-avg-uma" :class="member.avgUma >= 0 ? 'pos' : 'neg'">
                        {{ member.avgUma > 0 ? '+' : '' }}{{ member.avgUma.toFixed(1) }}
                      </td>
                      <td class="col-games">{{ member.totalGames }}전</td>
                      <td class="col-top2">{{ formatPct(member.top2Rate) }}</td>
                      <td class="col-avg-rank">{{ member.avgRank.toFixed(3) }}위</td>
                      <td class="col-rank-item col-rank-1">
                        <div class="dist-badge r1"><span class="dist-cnt">{{ member.rank1Count }}</span><span class="dist-pct">({{ getDistPct(member.rank1Count, member.totalGames) }}%)</span></div>
                      </td>
                      <td class="col-rank-item col-rank-2">
                        <div class="dist-badge r2"><span class="dist-cnt">{{ member.rank2Count }}</span><span class="dist-pct">({{ getDistPct(member.rank2Count, member.totalGames) }}%)</span></div>
                      </td>
                      <td class="col-rank-item col-rank-3">
                        <div class="dist-badge r3"><span class="dist-cnt">{{ member.rank3Count }}</span><span class="dist-pct">({{ getDistPct(member.rank3Count, member.totalGames) }}%)</span></div>
                      </td>
                      <td class="col-rank-item col-rank-4">
                        <div class="dist-badge r4"><span class="dist-cnt">{{ member.rank4Count }}</span><span class="dist-pct">({{ getDistPct(member.rank4Count, member.totalGames) }}%)</span></div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </template>
        </div>
      </section>

      <!-- ============================================== -->
      <!-- TAB: 갤러리 (Pinterest 스타일 원본 화질 WebP 아카이브) -->
      <!-- ============================================== -->
      <section v-else-if="activeTab === 'gallery'" class="tab-gallery">
        <div class="section-card gallery-toolbar-card">
          <div class="gh-toolbar-row">
            <div class="gh-filter-bar-compact">
              <div class="gh-cat-tabs">
                <button class="gh-cat-btn" :class="{ active: galleryCategoryFilter === 'all' }" @click="galleryCategoryFilter = 'all'">
                  전체 ({{ gallerySummaryStats.totalCount }})
                </button>
                <button class="gh-cat-btn" :class="{ active: galleryCategoryFilter === 'yakuman' }" @click="galleryCategoryFilter = 'yakuman'">
                  역만 ({{ gallerySummaryStats.yakumanCount }})
                </button>
                <button class="gh-cat-btn" :class="{ active: galleryCategoryFilter === 'fun' }" @click="galleryCategoryFilter = 'fun'">
                  그 외 화료 ({{ gallerySummaryStats.funPhotoCount }})
                </button>
                <button class="gh-cat-btn nanikiru-tab" :class="{ active: galleryCategoryFilter === 'nanikiru' }" @click="galleryCategoryFilter = 'nanikiru'">
                  나니키루 ({{ gallerySummaryStats.nanikiruCount }})
                </button>
                <button class="gh-cat-btn" :class="{ active: galleryCategoryFilter === 'session' }" @click="galleryCategoryFilter = 'session'">
                  기타 사진 ({{ gallerySummaryStats.sessionPhotoCount }})
                </button>
              </div>

              <div class="gh-select-group">
                <select v-model="gallerySessionFilter" class="gh-filter-select">
                  <option value="">전체 회차</option>
                  <option v-for="s in displayedAvailableSessions" :key="s" :value="s">{{ s }}</option>
                </select>
                <select v-model="galleryPlayerFilter" class="gh-filter-select">
                  <option value="">전체 플레이어</option>
                  <option v-for="m in allStats" :key="m.name" :value="m.name">{{ m.name }}</option>
                </select>
              </div>
            </div>

            <div class="gh-actions">
              <button
                type="button"
                class="btn-hl-upload refresh-gallery-btn"
                :disabled="isRefreshingGallery"
                @click="refreshGalleryData"
                title="갤러리 목록 및 서버 저장소 용량 새로고침"
              >
                <svg :class="{ 'spin-icon': isRefreshingGallery }" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
                  <path d="M21 3v5h-5"/>
                </svg>
                <span>{{ isRefreshingGallery ? '새로고침 중...' : '새로고침' }}</span>
              </button>
              <button
                v-if="isGalleryAdmin"
                type="button"
                class="btn-hl-upload admin-pin-btn"
                @click="openPinAdminModal('aliases')"
                title="관리자 전용 갤러리 관리 (멤버 동의어 · 공통 PIN)"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="13.5" height="13.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="3"></circle>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                </svg>
                <span>갤러리 관리</span>
              </button>
              <button class="btn-hl-upload primary" @click="openHighlightUploadModal({ category: 'yakuman' })">
                역만 / 화료 등록
              </button>
              <button class="btn-hl-upload nanikiru" @click="openHighlightUploadModal({ category: 'nanikiru' })">
                나니키루 등록
              </button>
              <button class="btn-hl-upload secondary" @click="openHighlightUploadModal({ category: 'session' })">
                기타 사진 등록
              </button>
            </div>
          </div>

          <!-- 서버 저장 용량 및 남은 용량 표시 바 (R2 10GB 무료 한도 합산 · 비활성 차감 반영) -->
          <div class="gh-storage-status-bar">
            <div class="gh-storage-info">
              <span class="gh-storage-title">서버 저장소 용량</span>
              <span class="gh-storage-metrics">
                남은 용량 <strong class="gh-storage-remain">{{ galleryStorageStats.remainingText }}</strong>
                <span class="gh-storage-sub">
                  (사용 {{ galleryStorageStats.usedText }}<template v-if="galleryStorageStats.externalR2Bytes > 0"> · <span class="gh-storage-ext-badge" title="비활성 처리된 저장소 용량">비활성 {{ galleryStorageStats.externalUsedText }}</span></template> / 전체 {{ galleryStorageStats.maxText }} · 사진 {{ galleryStorageStats.imageCount }}장)
                </span>
              </span>
              <span
                class="gh-storage-pct-badge"
                :class="{
                  warn: galleryStorageStats.totalAccountUsedPercent >= 75 && galleryStorageStats.totalAccountUsedPercent < 90,
                  danger: galleryStorageStats.totalAccountUsedPercent >= 90
                }"
              >
                {{ galleryStorageStats.remainingPercent.toFixed(1) }}% 여유
              </span>
            </div>
            <div
              class="gh-storage-track"
              :title="`하이라이트 사용: ${galleryStorageStats.usedText} (${galleryStorageStats.usedPercent.toFixed(2)}%)${galleryStorageStats.externalR2Bytes > 0 ? ` / 비활성: ${galleryStorageStats.externalUsedText} (${galleryStorageStats.externalUsedPercent.toFixed(2)}%)` : ''} / 남은 용량: ${galleryStorageStats.remainingText}`"
            >
              <div
                class="gh-storage-fill"
                :class="{
                  warn: galleryStorageStats.totalAccountUsedPercent >= 75 && galleryStorageStats.totalAccountUsedPercent < 90,
                  danger: galleryStorageStats.totalAccountUsedPercent >= 90
                }"
                :style="{ width: Math.max(galleryStorageStats.usedPercent > 0 ? 1.5 : 0, galleryStorageStats.usedPercent) + '%' }"
              ></div>
              <div
                v-if="galleryStorageStats.externalR2Bytes > 0"
                class="gh-storage-fill-external"
                :style="{ width: Math.max(1.5, galleryStorageStats.externalBarWidthPct) + '%' }"
                :title="`비활성 용량: ${galleryStorageStats.externalUsedText} (${galleryStorageStats.externalUsedPercent.toFixed(2)}%)`"
              ></div>
            </div>
          </div>
        </div>

        <!-- Pinterest 스타일 Masonry 사진 그리드 -->
        <div v-if="filteredGalleryHighlights.length === 0" class="section-card sg-empty-box">
          조건에 해당하는 기록이나 사진이 없습니다. 우측 상단 <strong>[역만 / 화료 등록]</strong>, <strong>[나니키루 등록]</strong> 또는 <strong>[기타 사진 등록]</strong> 버튼으로 첫 기록을 남겨보세요.
        </div>
        <div v-else class="pinterest-masonry-grid">
          <div
            v-for="rec in filteredGalleryHighlights"
            :key="rec.id"
            class="pinterest-pin-card"
            :class="'hl-cat-' + rec.category"
            @click="openHighlightLightbox(rec)"
          >
            <div
              v-if="rec.hasImage && rec.imageId"
              class="pinterest-img-wrap"
              :class="{ 'is-loaded': loadedThumbIds.has(rec.imageId) }"
              :style="getThumbWrapStyle(rec.imageId)"
            >
              <img
                :src="getHighlightThumbnailUrl(rec.imageId)"
                :alt="rec.caption || rec.winnerName"
                loading="lazy"
                decoding="async"
                class="pinterest-img"
                :class="{ 'is-loaded': loadedThumbIds.has(rec.imageId) }"
                @load="handleThumbImageLoad(rec.imageId, $event)"
                @error="handleThumbImageLoad(rec.imageId)"
              />
            </div>
            <div v-else class="hl-no-img-banner" :class="{ 'is-fun-banner': rec.category === 'fun', 'is-nanikiru-banner': rec.category === 'nanikiru' }">
              <span class="hl-yakuman-kanji">{{ rec.category === 'yakuman' ? '役満' : rec.category === 'nanikiru' ? '何切る' : '和了' }}</span>
              <span class="hl-yakuman-main-txt">
                {{ rec.category === 'yakuman' ? rec.yakumanTypes.join(' · ') : rec.category === 'nanikiru' ? '무엇을 버릴까' : (rec.winnerName || '그 외 화료') }}
              </span>
            </div>
            <div class="hl-card-body">
              <div class="hl-meta-top">
                <span class="hl-type-tag" :class="rec.category">
                  {{ formatHighlightCategoryLabel(rec.category, true) }}
                </span>
                <span v-if="rec.sessionName" class="hl-session-tag">{{ rec.sessionName }}</span>
                <span v-if="rec.gameIndex" class="hl-round-tag">{{ rec.gameIndex }}경기 {{ formatCardRoundKorean(rec.roundName) }}</span>
                <span v-else-if="rec.roundName" class="hl-round-tag">{{ formatCardRoundKorean(rec.roundName) }}</span>
                <span
                  v-if="getRecordCommentCount(rec) > 0 && (!rec.yakumanTypes || rec.yakumanTypes.length === 0) && !rec.winnerName"
                  class="hl-comment-cnt-badge"
                  title="댓글 수"
                >
                  <svg class="hl-comment-svg" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                  </svg>
                  <span>{{ getRecordCommentCount(rec) }}</span>
                </span>
              </div>
              <div v-if="rec.yakumanTypes && rec.yakumanTypes.length > 0" class="hl-yakuman-badges">
                <span
                  v-for="yt in rec.yakumanTypes"
                  :key="yt"
                  class="hl-y-badge"
                  :class="{ 'is-nanikiru-tag': rec.category === 'nanikiru' }"
                >{{ yt }}</span>
                <span v-if="getRecordCommentCount(rec) > 0" class="hl-comment-cnt-badge" title="댓글 수">
                  <svg class="hl-comment-svg" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                  </svg>
                  <span>{{ getRecordCommentCount(rec) }}</span>
                </span>
              </div>
              <div v-if="rec.winnerName" class="hl-winner-line">
                <strong
                  class="hl-player-link"
                  title="클릭하여 스탯 보기"
                  @click.stop="openPlayerByName(rec.winnerName, Boolean(rec.sessionName), false, false, rec.sessionName)"
                >{{ rec.winnerName }}</strong>
                <span v-if="rec.winType && rec.category !== 'nanikiru' && rec.category !== 'session'" class="hl-wintype">
                  ({{ rec.winType === 'tsumo' ? '쯔모 화료' : '론 화료' }}<template v-if="rec.winType === 'ron' && rec.loserName"> ← <span class="hl-player-link" title="클릭하여 스탯 보기" @click.stop="openPlayerByName(rec.loserName, Boolean(rec.sessionName), false, false, rec.sessionName)">{{ rec.loserName }}</span></template>)
                </span>
                <span
                  v-if="getRecordCommentCount(rec) > 0 && (!rec.yakumanTypes || rec.yakumanTypes.length === 0)"
                  class="hl-comment-cnt-badge"
                  title="댓글 수"
                >
                  <svg class="hl-comment-svg" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                  </svg>
                  <span>{{ getRecordCommentCount(rec) }}</span>
                </span>
              </div>
              <div v-if="rec.caption" class="hl-caption rich-mahjong-content">
                <template v-for="(seg, sIdx) in parseRichMahjongText(rec.caption)" :key="`g-cap-${rec.id}-${sIdx}`">
                  <span v-if="seg.type === 'text'">{{ seg.text }}</span>
                  <span v-else-if="seg.type === 'meld-group'" class="mj-hand" :title="seg.rawNotation">
                    <span
                      v-for="(blk, bIdx) in seg.blocks"
                      :key="`g-cap-blk-${rec.id}-${sIdx}-${bIdx}`"
                      class="mj-meld-block"
                      :class="{ 'is-draw-block': blk.isDraw }"
                    >
                      <template v-for="(item, iIdx) in blk.items" :key="`g-cap-it-${rec.id}-${sIdx}-${bIdx}-${iIdx}`">
                        <span v-if="item.mode === 'side'" class="mj-side-wrap" :title="item.tile.label">
                          <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" loading="lazy" />
                        </span>
                        <span v-else-if="item.mode === 'kakan'" class="mj-kakan-wrap" :title="`${item.tile.label} 가깡`">
                          <span class="mj-side-wrap">
                            <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" loading="lazy" />
                          </span>
                          <span class="mj-side-wrap">
                            <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" loading="lazy" />
                          </span>
                        </span>
                        <span v-else class="mj-upright-wrap" :title="item.tile.label">
                          <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" loading="lazy" />
                        </span>
                      </template>
                    </span>
                  </span>
                  <span
                    v-else-if="seg.type === 'tile'"
                    class="inline-mahjong-tile"
                    :title="seg.tile.label"
                  >
                    <img :src="getMahjongTileImageUrl(seg.tile.fileName)" :alt="seg.tile.label" loading="lazy" />
                  </span>
                  <span v-else-if="seg.type === 'action'" class="inline-mahjong-action" :class="seg.action.colorClass">
                    {{ seg.action.label }}
                  </span>
                </template>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 일정 탭 -->
      <section v-else-if="activeTab === 'schedule'" class="tab-schedule">
        <ScheduleTab
          :members="allStats"
          :availableSessions="availableSessions"
        />
      </section>

      <!-- 룰 탭 -->
      <section v-else-if="activeTab === 'rules'" class="tab-rules">
        <RulesTab />
      </section>
    </main>

    <!-- ============================================== -->
    <!-- 플레이어 상세 정보 모달 (ModalStats.vue UI 완벽 일치) -->
    <!-- ============================================== -->
    <Transition name="modal-fade">
      <div
        v-if="selectedPlayer"
        class="player-modal-overlay"
        :class="{ 'is-behind-lightbox': isPlayerModalBehindLightbox && Boolean(lightboxHighlight) }"
        v-backdrop-dismiss="() => selectedPlayer = null"
      >
        <div class="player-modal-card modal_content">
          <div class="container_stats_modal">
            <!-- 모달 헤더: 플레이어 셀렉터 및 닫기 버튼 -->
            <div class="modal-header">
              <div class="player_selector_container">
                <label for="modalPlayerSelect" class="selector_label">대상 플레이어:</label>
                <select 
                  id="modalPlayerSelect" 
                  :value="selectedPlayer.name" 
                  @change="openPlayerByName(($event.target as HTMLSelectElement).value, isModalFromSession, true)"
                  class="player_select"
                >
                  <option v-for="m in allStats" :key="m.name" :value="m.name">
                    {{ m.name }} ({{ m.totalUma > 0 ? '+' : '' }}{{ m.totalUma }}pt)
                  </option>
                </select>
              </div>
              <button class="btn-close" @click="selectedPlayer = null" title="닫기">✕</button>
            </div>

            <!-- 모달 스코프 탭 (회차 상세에서 진입했을 때만 노출) -->
            <div class="modal_scope_tabs" v-if="isModalFromSession && (currentSessionDetail || selectedSession)">
              <button 
                class="modal_scope_tab" 
                :class="{ active: modalScopeTab === 'session' }" 
                @click="modalScopeTab = 'session'"
              >
                이번 회차
              </button>
              <button 
                class="modal_scope_tab" 
                :class="{ active: modalScopeTab === 'all' }" 
                @click="modalScopeTab = 'all'"
              >
                전체 기간
              </button>
            </div>

            <!-- 세부 스탯 안내 문구 -->
            <div v-if="isNoticeVisible" class="modal_notice_text">
              <div class="notice_text_content">
                ※ 제9회부터의 기록이 반영되어 있으며, 초기 오류로 세부 스탯이 기록되지 못한 일부 경기는 제외되어 있습니다.<br />
                ※ 일부 스탯들은 '종합 대국 통계(세부 스탯이 집계된 대국 통계)' 형식으로 표기됩니다.
              </div>
              <button class="notice_close_btn" @click="dismissNotice" title="닫기">✕</button>
            </div>

            <!-- 1) 이번 회차 스탯 뷰 -->
            <div v-if="isModalFromSession && modalScopeTab === 'session'" class="session_modal_content">
              <div v-if="isLoadingSession && (!currentSessionPlayerStats || currentSessionPlayerStats.totalGames === 0)" class="no_data_modal">
                {{ selectedSession || currentSessionDetail?.sessionName }} 데이터를 불러오는 중입니다...
              </div>
              <div v-else-if="!currentSessionPlayerStats || currentSessionPlayerStats.totalGames === 0" class="no_data_modal">
                {{ currentSessionDetail?.sessionName || selectedSession }}에 '{{ selectedPlayer.name }}'님이 플레이한 대국 기록이 없습니다.
              </div>
              <div v-else class="session_modal_body">
                <template v-if="currentSessionPlayerStats.totalRounds > 0">
                  <!-- 7개 탭 메뉴: 기본 / 리치 스탯 / 그 외 / 순위 비율 / 레이팅 추이 / 역만 / 상대 전적 -->
                  <div class="tab-menu-wrap" :class="{ 'has-scroll-indicator': modalTabScrollIndicator.visible }">
                    <div
                      :ref="setModalTabMenuRef"
                      class="tab_menu"
                      :class="{ 'is-dragging': isDraggingModalTab }"
                      @mousedown="onModalTabMouseDown"
                      @click.capture="onModalTabClickCapture"
                      @auxclick.prevent
                      @wheel="onModalTabWheel"
                      @scroll.passive="updateModalTabScrollIndicator"
                    >
                      <button 
                        class="tab_btn" 
                        :class="{ active: sessionModalActiveTab === 'basic' }" 
                        @click="sessionModalActiveTab = 'basic'"
                      >
                        기본
                      </button>
                      <button 
                        class="tab_btn" 
                        :class="{ active: sessionModalActiveTab === 'riichi' }" 
                        @click="sessionModalActiveTab = 'riichi'"
                      >
                        리치 스탯
                      </button>
                      <button 
                        class="tab_btn" 
                        :class="{ active: sessionModalActiveTab === 'other' }" 
                        @click="sessionModalActiveTab = 'other'"
                      >
                        그 외
                      </button>
                      <button 
                        class="tab_btn" 
                        :class="{ active: sessionModalActiveTab === 'rank' }" 
                        @click="sessionModalActiveTab = 'rank'"
                      >
                        순위 비율
                      </button>
                      <button 
                        class="tab_btn" 
                        :class="{ active: sessionModalActiveTab === 'rating' }" 
                        @click="sessionModalActiveTab = 'rating'"
                      >
                        레이팅 추이
                      </button>
                      <button 
                        class="tab_btn" 
                        :class="{ active: sessionModalActiveTab === 'yakuman' }" 
                        @click="sessionModalActiveTab = 'yakuman'"
                      >
                        역만
                      </button>
                      <button 
                        class="tab_btn" 
                        :class="{ active: sessionModalActiveTab === 'opponents' }" 
                        @click="sessionModalActiveTab = 'opponents'"
                      >
                        상대 전적
                      </button>
                    </div>
                    <div
                      v-show="modalTabScrollIndicator.visible"
                      class="tabs-nav-scroll-track"
                      @click="onModalTabTrackClick"
                      title="좌우 스크롤 위치 표시"
                    >
                      <div
                        class="tabs-nav-scroll-thumb"
                        :style="{
                          width: modalTabScrollIndicator.widthPct + '%',
                          left: modalTabScrollIndicator.leftPct + '%'
                        }"
                      ></div>
                    </div>
                  </div>

                  <!-- 스탯 데이터 테이블 -->
                  <div class="stats_content">
                    <div class="stats_list">
                      <!-- 1. 기본 탭 (4열 그리드) -->
                      <div v-if="sessionModalActiveTab === 'basic'" class="stats_group">
                        <div 
                          class="stat_row hoverable" 
                          @mouseenter="onHoverSessionMetric($event, 'totalGames', '기록 대국 수', currentSessionPlayerStats.totalGames, true, '전')" 
                          @mouseleave="onLeaveMetric"
                        >
                          <span class="stat_label">기록 대국 수</span>
                          <span class="stat_value">{{ formatDualMetric(sessionMember?.totalGames, currentSessionPlayerStats.totalGames) }}전</span>
                        </div>
                        <div 
                          class="stat_row hoverable" 
                          @mouseenter="onHoverSessionMetric($event, 'totalUma', '누적 우마', currentSessionPlayerStats.totalUma, true, 'pt')" 
                          @mouseleave="onLeaveMetric"
                        >
                          <span class="stat_label">누적 우마</span>
                          <span class="stat_value" :class="currentSessionPlayerStats.totalUma >= 0 ? 'text_positive' : 'text_negative'">
                            {{ formatDualMetric(sessionMember?.totalUma, currentSessionPlayerStats.totalUma, 1, true) }}pt
                          </span>
                        </div>
                        <div 
                          class="stat_row hoverable" 
                          @mouseenter="onHoverSessionMetric($event, 'avgUma', '평균 우마', currentSessionPlayerStats.avgUma, true, 'pt')" 
                          @mouseleave="onLeaveMetric"
                        >
                          <span class="stat_label">평균 우마</span>
                          <span class="stat_value" :class="currentSessionPlayerStats.avgUma >= 0 ? 'text_positive' : 'text_negative'">
                            {{ formatDualMetric(sessionMember?.avgUma, currentSessionPlayerStats.avgUma, 1, true) }}pt
                          </span>
                        </div>
                        <div 
                          class="stat_row hoverable" 
                          @mouseenter="onHoverSessionMetric($event, 'avgRank', '평균 순위', currentSessionPlayerStats.avgRank, false, '위')" 
                          @mouseleave="onLeaveMetric"
                        >
                          <span class="stat_label">평균 순위</span>
                          <span class="stat_value highlight">{{ formatDualMetric(sessionMember?.avgRank, currentSessionPlayerStats.avgRank, 3) }}위</span>
                        </div>
                        <div 
                          class="stat_row hoverable" 
                          @mouseenter="onHoverSessionMetric($event, 'top2Rate', '연대율', currentSessionPlayerStats.top2Rate, true, '%')" 
                          @mouseleave="onLeaveMetric"
                        >
                          <span class="stat_label">연대율 (1·2위)</span>
                          <span class="stat_value">{{ formatDualMetric(sessionMember?.top2Rate, currentSessionPlayerStats.top2Rate, 2) }}%</span>
                        </div>
                        <div 
                          class="stat_row hoverable" 
                          @mouseenter="onHoverSessionMetric($event, 'winRate', '화료율', currentSessionPlayerStats.winRate, true, '%')" 
                          @mouseleave="onLeaveMetric"
                        >
                          <span class="stat_label">화료율</span>
                          <span class="stat_value">{{ formatPct(currentSessionPlayerStats.winRate) }}</span>
                        </div>
                        <div 
                          class="stat_row hoverable" 
                          @mouseenter="onHoverSessionMetric($event, 'dealInRate', '방총률', currentSessionPlayerStats.dealInRate, false, '%')" 
                          @mouseleave="onLeaveMetric"
                        >
                          <span class="stat_label">방총률</span>
                          <span class="stat_value text_negative">{{ formatPct(currentSessionPlayerStats.dealInRate) }}</span>
                        </div>
                        <div 
                          class="stat_row hoverable" 
                          @mouseenter="onHoverSessionMetric($event, 'tsumoRate', '쯔모율', currentSessionPlayerStats.tsumoRate, true, '%')" 
                          @mouseleave="onLeaveMetric"
                        >
                          <span class="stat_label">쯔모율</span>
                          <span class="stat_value">{{ formatPct(currentSessionPlayerStats.tsumoRate) }}</span>
                        </div>
                        <div 
                          class="stat_row hoverable" 
                          @mouseenter="onHoverSessionMetric($event, 'riichiRate', '리치율', currentSessionPlayerStats.riichiRate, true, '%')" 
                          @mouseleave="onLeaveMetric"
                        >
                          <span class="stat_label">리치율</span>
                          <span class="stat_value">{{ formatPct(currentSessionPlayerStats.riichiRate) }}</span>
                        </div>
                        <div 
                          class="stat_row hoverable" 
                          @mouseenter="onHoverSessionMetric($event, 'drawRate', '유국률', currentSessionPlayerStats.drawRate, false, '%')" 
                          @mouseleave="onLeaveMetric"
                          @click.stop="onHoverSessionMetric($event, 'drawRate', '유국률', currentSessionPlayerStats.drawRate, false, '%')"
                        >
                          <span class="stat_label">유국률</span>
                          <span class="stat_value">{{ formatPct(currentSessionPlayerStats.drawRate) }}</span>
                        </div>
                        <div 
                          class="stat_row hoverable" 
                          @mouseenter="onHoverSessionMetric($event, 'drawTenpaiRate', '유국 텐파이율', currentSessionPlayerStats.drawTenpaiRate, true, '%')" 
                          @mouseleave="onLeaveMetric"
                          @click.stop="onHoverSessionMetric($event, 'drawTenpaiRate', '유국 텐파이율', currentSessionPlayerStats.drawTenpaiRate, true, '%')"
                        >
                          <span class="stat_label">유국 텐파이율</span>
                          <span class="stat_value">{{ formatPct(currentSessionPlayerStats.drawTenpaiRate) }}</span>
                        </div>
                        <div 
                          class="stat_row hoverable" 
                          @mouseenter="onHoverSessionMetric($event, 'avgWinScore', '평균 화료 점수', currentSessionPlayerStats.avgWinScore, true, '점')" 
                          @mouseleave="onLeaveMetric"
                        >
                          <span class="stat_label">평균 화료 점수</span>
                          <span class="stat_value text_positive">{{ currentSessionPlayerStats.avgWinScore.toLocaleString() }}점</span>
                        </div>
                        <div 
                          class="stat_row hoverable" 
                          @mouseenter="onHoverSessionMetric($event, 'avgDealInScore', '평균 방총 점수', currentSessionPlayerStats.avgDealInScore, false, '점')" 
                          @mouseleave="onLeaveMetric"
                        >
                          <span class="stat_label">평균 방총 점수</span>
                          <span class="stat_value text_negative">{{ currentSessionPlayerStats.avgDealInScore.toLocaleString() }}점</span>
                        </div>
                        <div 
                          class="stat_row hoverable" 
                          @mouseenter="onHoverSessionMetric($event, 'tobiRate', '토비율', currentSessionPlayerStats.tobiRate, false, '%')" 
                          @mouseleave="onLeaveMetric"
                        >
                          <span class="stat_label">토비율 (들통)</span>
                          <span class="stat_value text_negative">{{ formatPct(currentSessionPlayerStats.tobiRate) }}</span>
                        </div>
                      </div>

                      <!-- 2. 리치 스탯 탭 -->
                      <div v-else-if="sessionModalActiveTab === 'riichi'" class="stats_group">
                        <div 
                          class="stat_row hoverable" 
                          @mouseenter="onHoverSessionMetric($event, 'riichiRate', '리치율', currentSessionPlayerStats.riichiRate, true, '%')" 
                          @mouseleave="onLeaveMetric"
                          @click.stop="onHoverSessionMetric($event, 'riichiRate', '리치율', currentSessionPlayerStats.riichiRate, true, '%')"
                        >
                          <span class="stat_label">리치율</span>
                          <span class="stat_value">{{ formatPct(currentSessionPlayerStats.riichiRate) }}</span>
                        </div>
                        <div 
                          class="stat_row hoverable" 
                          @mouseenter="onHoverSessionMetric($event, 'riichiWinRate', '리치 화료율', currentSessionPlayerStats.riichiWinRate, true, '%')" 
                          @mouseleave="onLeaveMetric"
                          @click.stop="onHoverSessionMetric($event, 'riichiWinRate', '리치 화료율', currentSessionPlayerStats.riichiWinRate, true, '%')"
                        >
                          <span class="stat_label">리치 화료율</span>
                          <span class="stat_value text_positive">{{ formatPct(currentSessionPlayerStats.riichiWinRate) }}</span>
                        </div>
                        <div 
                          class="stat_row hoverable" 
                          @mouseenter="onHoverSessionMetric($event, 'riichiDealInRate', '리치 방총율', currentSessionPlayerStats.riichiDealInRate, false, '%')" 
                          @mouseleave="onLeaveMetric"
                          @click.stop="onHoverSessionMetric($event, 'riichiDealInRate', '리치 방총율', currentSessionPlayerStats.riichiDealInRate, false, '%')"
                        >
                          <span class="stat_label">리치 방총율</span>
                          <span class="stat_value text_negative">{{ formatPct(currentSessionPlayerStats.riichiDealInRate) }}</span>
                        </div>
                        <div 
                          class="stat_row hoverable" 
                          @mouseenter="onHoverSessionMetric($event, 'riichiDrawRate', '리치 유국율', currentSessionPlayerStats.riichiDrawRate, false, '%')" 
                          @mouseleave="onLeaveMetric"
                          @click.stop="onHoverSessionMetric($event, 'riichiDrawRate', '리치 유국율', currentSessionPlayerStats.riichiDrawRate, false, '%')"
                        >
                          <span class="stat_label">리치 유국율</span>
                          <span class="stat_value">{{ formatPct(currentSessionPlayerStats.riichiDrawRate) }}</span>
                        </div>
                        <div 
                          class="stat_row hoverable" 
                          @mouseenter="onHoverSessionMetric($event, 'riichiEV', '리치 수지', currentSessionPlayerStats.riichiEV, true, '점')" 
                          @mouseleave="onLeaveMetric"
                          @click.stop="onHoverSessionMetric($event, 'riichiEV', '리치 수지', currentSessionPlayerStats.riichiEV, true, '점')"
                        >
                          <span class="stat_label">리치 수지</span>
                          <span class="stat_value" :class="currentSessionPlayerStats.riichiEV >= 0 ? 'text_positive' : 'text_negative'">
                            {{ currentSessionPlayerStats.riichiEV > 0 ? '+' : '' }}{{ currentSessionPlayerStats.riichiEV.toLocaleString() }}점
                          </span>
                        </div>
                        <div 
                          class="stat_row hoverable" 
                          @mouseenter="onHoverSessionMetric($event, 'riichiIncomeAvg', '리치 시 평균 수입', currentSessionPlayerStats.riichiIncomeAvg, true, '점')" 
                          @mouseleave="onLeaveMetric"
                          @click.stop="onHoverSessionMetric($event, 'riichiIncomeAvg', '리치 시 평균 수입', currentSessionPlayerStats.riichiIncomeAvg, true, '점')"
                        >
                          <span class="stat_label">리치 시 평균 수입</span>
                          <span class="stat_value text_positive">{{ currentSessionPlayerStats.riichiIncomeAvg.toLocaleString() }}점</span>
                        </div>
                        <div 
                          class="stat_row hoverable" 
                          @mouseenter="onHoverSessionMetric($event, 'riichiExpenseAvg', '리치 방총 시 평균 지출', currentSessionPlayerStats.riichiExpenseAvg, false, '점')" 
                          @mouseleave="onLeaveMetric"
                          @click.stop="onHoverSessionMetric($event, 'riichiExpenseAvg', '리치 방총 시 평균 지출', currentSessionPlayerStats.riichiExpenseAvg, false, '점')"
                        >
                          <span class="stat_label">리치 방총 시 평균 지출</span>
                          <span class="stat_value text_negative">{{ currentSessionPlayerStats.riichiExpenseAvg.toLocaleString() }}점</span>
                        </div>
                        <div 
                          class="stat_row hoverable" 
                          @mouseenter="onHoverSessionMetric($event, 'firstRiichiRate', '선제 리치율', currentSessionPlayerStats.firstRiichiRate, true, '%')" 
                          @mouseleave="onLeaveMetric"
                          @click.stop="onHoverSessionMetric($event, 'firstRiichiRate', '선제 리치율', currentSessionPlayerStats.firstRiichiRate, true, '%')"
                        >
                          <span class="stat_label">선제 리치율</span>
                          <span class="stat_value text_positive">{{ formatPct(currentSessionPlayerStats.firstRiichiRate) }}</span>
                        </div>
                        <div 
                          class="stat_row hoverable" 
                          @mouseenter="onHoverSessionMetric($event, 'chaseRiichiRate', '추격 리치율', currentSessionPlayerStats.chaseRiichiRate, true, '%')" 
                          @mouseleave="onLeaveMetric"
                          @click.stop="onHoverSessionMetric($event, 'chaseRiichiRate', '추격 리치율', currentSessionPlayerStats.chaseRiichiRate, true, '%')"
                        >
                          <span class="stat_label">추격 리치율</span>
                          <span class="stat_value">{{ formatPct(currentSessionPlayerStats.chaseRiichiRate) }}</span>
                        </div>
                        <div 
                          class="stat_row hoverable" 
                          @mouseenter="onHoverSessionMetric($event, 'chasedRiichiRate', '피추격 리치율', currentSessionPlayerStats.chasedRiichiRate, false, '%')" 
                          @mouseleave="onLeaveMetric"
                          @click.stop="onHoverSessionMetric($event, 'chasedRiichiRate', '피추격 리치율', currentSessionPlayerStats.chasedRiichiRate, false, '%')"
                        >
                          <span class="stat_label">피추격 리치율</span>
                          <span class="stat_value text_negative">{{ formatPct(currentSessionPlayerStats.chasedRiichiRate) }}</span>
                        </div>
                      </div>

                      <!-- 3. 그 외 탭 -->
                      <div v-else-if="sessionModalActiveTab === 'other'" class="stats_group">
                        <div 
                          class="stat_row hoverable" 
                          @mouseenter="onHoverSessionMetric($event, 'oyaKaburiRate', '아픈 오야카부리율', currentSessionPlayerStats.oyaKaburiRate, false, '%')" 
                          @mouseleave="onLeaveMetric"
                          @click.stop="onHoverSessionMetric($event, 'oyaKaburiRate', '아픈 오야카부리율', currentSessionPlayerStats.oyaKaburiRate, false, '%')"
                        >
                          <span class="stat_label">아픈 오야카부리율</span>
                          <span class="stat_value text_negative">{{ formatPct(currentSessionPlayerStats.oyaKaburiRate) }}</span>
                        </div>
                        <div 
                          class="stat_row hoverable" 
                          @mouseenter="onHoverSessionMetric($event, 'oyaKaburiAvg', '아픈 오야카부리 평균', currentSessionPlayerStats.oyaKaburiAvg, false, '점')" 
                          @mouseleave="onLeaveMetric"
                          @click.stop="onHoverSessionMetric($event, 'oyaKaburiAvg', '아픈 오야카부리 평균', currentSessionPlayerStats.oyaKaburiAvg, false, '점')"
                        >
                          <span class="stat_label">아픈 오야카부리 평균</span>
                          <span class="stat_value text_negative">{{ currentSessionPlayerStats.oyaKaburiAvg.toLocaleString() }}점</span>
                        </div>
                        <div 
                          class="stat_row hoverable" 
                          @mouseenter="onHoverSessionMetric($event, 'dealInRiichiRate', '방총 시 리치율', currentSessionPlayerStats.dealInRiichiRate, false, '%')" 
                          @mouseleave="onLeaveMetric"
                          @click.stop="onHoverSessionMetric($event, 'dealInRiichiRate', '방총 시 리치율', currentSessionPlayerStats.dealInRiichiRate, false, '%')"
                        >
                          <span class="stat_label">방총 시 리치율</span>
                          <span class="stat_value">{{ formatPct(currentSessionPlayerStats.dealInRiichiRate) }}</span>
                        </div>
                        <div 
                          class="stat_row hoverable" 
                          @mouseenter="onHoverSessionMetric($event, 'cheatRate', '촌보율', currentSessionPlayerStats.cheatRate, false, '%')" 
                          @mouseleave="onLeaveMetric"
                          @click.stop="onHoverSessionMetric($event, 'cheatRate', '촌보율', currentSessionPlayerStats.cheatRate, false, '%')"
                        >
                          <span class="stat_label">촌보율</span>
                          <span class="stat_value text_negative">{{ formatPct5(currentSessionPlayerStats.cheatRate) }}</span>
                        </div>
                        <div 
                          class="stat_row hoverable" 
                          @mouseenter="onHoverSessionMetric($event, 'beolbuRate', '벌부율', currentSessionPlayerStats.beolbuRate, false, '%')" 
                          @mouseleave="onLeaveMetric"
                          @click.stop="onHoverSessionMetric($event, 'beolbuRate', '벌부율', currentSessionPlayerStats.beolbuRate, false, '%')"
                        >
                          <span class="stat_label">벌부율</span>
                          <span class="stat_value text_negative">{{ formatPct5(currentSessionPlayerStats.beolbuRate) }}</span>
                        </div>
                        <div 
                          class="stat_row hoverable" 
                          @mouseenter="onHoverSessionMetric($event, 'winEfficiency', '화료 효율', currentSessionPlayerStats.winEfficiency, true, '')" 
                          @mouseleave="onLeaveMetric"
                          @click.stop="onHoverSessionMetric($event, 'winEfficiency', '화료 효율', currentSessionPlayerStats.winEfficiency, true, '')"
                        >
                          <span class="stat_label">화료 효율</span>
                          <span class="stat_value text_positive">+{{ currentSessionPlayerStats.winEfficiency }}</span>
                        </div>
                        <div 
                          class="stat_row hoverable" 
                          @mouseenter="onHoverSessionMetric($event, 'dealInLoss', '방총 손실', currentSessionPlayerStats.dealInLoss, false, '')" 
                          @mouseleave="onLeaveMetric"
                          @click.stop="onHoverSessionMetric($event, 'dealInLoss', '방총 손실', currentSessionPlayerStats.dealInLoss, false, '')"
                        >
                          <span class="stat_label">방총 손실</span>
                          <span class="stat_value text_negative">-{{ currentSessionPlayerStats.dealInLoss }}</span>
                        </div>
                        <div 
                          class="stat_row hoverable" 
                          @mouseenter="onHoverSessionMetric($event, 'netWinEfficiency', '알짜 화료 효율', currentSessionPlayerStats.netWinEfficiency, true, '')" 
                          @mouseleave="onLeaveMetric"
                          @click.stop="onHoverSessionMetric($event, 'netWinEfficiency', '알짜 화료 효율', currentSessionPlayerStats.netWinEfficiency, true, '')"
                        >
                          <span class="stat_label">알짜 화료 효율</span>
                          <span class="stat_value" :class="currentSessionPlayerStats.netWinEfficiency >= 0 ? 'text_positive' : 'text_negative'">
                            {{ currentSessionPlayerStats.netWinEfficiency > 0 ? '+' : '' }}{{ currentSessionPlayerStats.netWinEfficiency }}
                          </span>
                        </div>
                        <div 
                          class="stat_row hoverable" 
                          @mouseenter="onHoverSessionMetric($event, 'handEV', '국수지', currentSessionPlayerStats.handEV, true, '점')" 
                          @mouseleave="onLeaveMetric"
                          @click.stop="onHoverSessionMetric($event, 'handEV', '국수지', currentSessionPlayerStats.handEV, true, '점')"
                        >
                          <span class="stat_label">국수지</span>
                          <span class="stat_value" :class="currentSessionPlayerStats.handEV >= 0 ? 'text_positive' : 'text_negative'">
                            {{ currentSessionPlayerStats.handEV > 0 ? '+' : '' }}{{ currentSessionPlayerStats.handEV }}점
                          </span>
                        </div>
                        <div 
                          class="stat_row hoverable" 
                          @mouseenter="onHoverSessionMetric($event, 'totalRounds', '총합 국 수', currentSessionPlayerStats.totalRounds, true, '국')" 
                          @mouseleave="onLeaveMetric"
                          @click.stop="onHoverSessionMetric($event, 'totalRounds', '총합 국 수', currentSessionPlayerStats.totalRounds, true, '국')"
                        >
                          <span class="stat_label">총합 국 수</span>
                          <span class="stat_value">{{ currentSessionPlayerStats.totalRounds }}국</span>
                        </div>
                      </div>

                      <!-- 3-1. 역만 탭 (이번 회차 17종 역만 화료 기록) -->
                      <div v-else-if="sessionModalActiveTab === 'yakuman'" class="yakuman_tab_wrapper">
                        <div class="yakuman_summary_bar">
                          <span class="ym_summary_title">{{ currentSessionDetail?.sessionName }} 역만 화료 기록</span>
                          <span class="ym_summary_badge" :class="{ achieved: modalPlayerYakumanStats.totalYakumanCount > 0 }">
                            {{ modalPlayerYakumanStats.totalYakumanCount }}회
                          </span>
                        </div>
                        <div class="yakuman_counts_grid">
                          <div
                            v-for="ym in modalPlayerYakumanStats.items"
                            :key="ym.key"
                            class="yakuman_count_row"
                            :class="{ achieved: ym.count > 0, double: ym.isDouble }"
                          >
                            <span class="ym_name">{{ ym.label }}</span>
                            <span class="ym_leader_line" aria-hidden="true"></span>
                            <span class="ym_val">{{ ym.count }}</span>
                          </div>
                        </div>
                        <div v-if="modalPlayerYakumanStats.achievedRecords.length > 0" class="yakuman_achieved_list">
                          <div class="ym_achieved_header">달성 상세 및 화료 사진</div>
                          <div class="ym_achieved_cards">
                            <div
                              v-for="rec in modalPlayerYakumanStats.achievedRecords"
                              :key="rec.id"
                              class="ym_achieved_card"
                              @click="openHighlightLightbox(rec)"
                            >
                              <img v-if="rec.hasImage && rec.imageId" :src="getHighlightThumbnailUrl(rec.imageId)" class="ym_thumb" loading="lazy" decoding="async" />
                              <div class="ym_achieved_info">
                                <div class="ym_achieved_tags">
                                  <span v-for="t in rec.yakumanTypes" :key="t" class="hl-y-badge">{{ t }}</span>
                                </div>
                                <div class="ym_achieved_meta">
                                  {{ rec.sessionName }}
                                  <template v-if="rec.gameIndex"> · {{ rec.gameIndex }}경기</template>
                                  <template v-if="rec.roundName"> · {{ formatCardRoundKorean(rec.roundName) }}</template>
                                </div>
                                <div v-if="rec.caption" class="ym_achieved_caption">{{ rec.caption }}</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <!-- 4. 순위 비율 탭 -->
                      <div v-else-if="sessionModalActiveTab === 'rank'" class="rank_tab_wrapper">
                        <div class="rank_chart_section">
                          <!-- SVG 도넛 차트 -->
                          <div class="chart_box">
                            <svg viewBox="0 0 200 200" class="donut_svg">
                              <circle 
                                cx="100" 
                                cy="100" 
                                r="73" 
                                fill="none" 
                                stroke="var(--border-color, rgba(0,0,0,0.08))" 
                                stroke-width="38" 
                              />
                              <g transform="rotate(-90 100 100)">
                                <!-- 4위 (빨강) -->
                                <circle 
                                  v-if="currentSessionRankStats.p4 > 0"
                                  cx="100" cy="100" r="73" 
                                  fill="none" 
                                  stroke="#ef4444" 
                                  stroke-width="38" 
                                  :stroke-dasharray="`${(currentSessionRankStats.p4 / 100) * 458.672} 458.672`"
                                  :stroke-dashoffset="`-${((currentSessionRankStats.p1 + currentSessionRankStats.p2 + currentSessionRankStats.p3) / 100) * 458.672}`"
                                  class="donut_segment"
                                  :class="{ active: hoveredRank === 4 }"
                                  @mouseenter="hoveredRank = 4"
                                  @mouseleave="hoveredRank = null"
                                />
                                <!-- 3위 (노랑/앰버) -->
                                <circle 
                                  v-if="currentSessionRankStats.p3 > 0"
                                  cx="100" cy="100" r="73" 
                                  fill="none" 
                                  stroke="#f59e0b" 
                                  stroke-width="38" 
                                  :stroke-dasharray="`${(currentSessionRankStats.p3 / 100) * 458.672} 458.672`"
                                  :stroke-dashoffset="`-${((currentSessionRankStats.p1 + currentSessionRankStats.p2) / 100) * 458.672}`"
                                  class="donut_segment"
                                  :class="{ active: hoveredRank === 3 }"
                                  @mouseenter="hoveredRank = 3"
                                  @mouseleave="hoveredRank = null"
                                />
                                <!-- 2위 (청록) -->
                                <circle 
                                  v-if="currentSessionRankStats.p2 > 0"
                                  cx="100" cy="100" r="73" 
                                  fill="none" 
                                  stroke="#06b6d4" 
                                  stroke-width="38" 
                                  :stroke-dasharray="`${(currentSessionRankStats.p2 / 100) * 458.672} 458.672`"
                                  :stroke-dashoffset="`-${(currentSessionRankStats.p1 / 100) * 458.672}`"
                                  class="donut_segment"
                                  :class="{ active: hoveredRank === 2 }"
                                  @mouseenter="hoveredRank = 2"
                                  @mouseleave="hoveredRank = null"
                                />
                                <!-- 1위 (초록) -->
                                <circle 
                                  v-if="currentSessionRankStats.p1 > 0"
                                  cx="100" cy="100" r="73" 
                                  fill="none" 
                                  stroke="#10b981" 
                                  stroke-width="38" 
                                  :stroke-dasharray="`${(currentSessionRankStats.p1 / 100) * 458.672} 458.672`"
                                  stroke-dashoffset="0"
                                  class="donut_segment"
                                  :class="{ active: hoveredRank === 1 }"
                                  @mouseenter="hoveredRank = 1"
                                  @mouseleave="hoveredRank = null"
                                />
                              </g>
                              <!-- 각 순위 영역 내 % 레이블 -->
                              <g class="donut_labels" pointer-events="none">
                                <text 
                                  v-if="currentSessionRankStats.p1 >= 6"
                                  :x="getRankLabelPos(currentSessionRankStats, 1).x" 
                                  :y="getRankLabelPos(currentSessionRankStats, 1).y" 
                                  text-anchor="middle" 
                                  dominant-baseline="central" 
                                  class="donut_segment_text"
                                >
                                  {{ formatDonutPct(currentSessionRankStats.p1) }}
                                </text>
                                <text 
                                  v-if="currentSessionRankStats.p2 >= 6"
                                  :x="getRankLabelPos(currentSessionRankStats, 2).x" 
                                  :y="getRankLabelPos(currentSessionRankStats, 2).y" 
                                  text-anchor="middle" 
                                  dominant-baseline="central" 
                                  class="donut_segment_text"
                                >
                                  {{ formatDonutPct(currentSessionRankStats.p2) }}
                                </text>
                                <text 
                                  v-if="currentSessionRankStats.p3 >= 6"
                                  :x="getRankLabelPos(currentSessionRankStats, 3).x" 
                                  :y="getRankLabelPos(currentSessionRankStats, 3).y" 
                                  text-anchor="middle" 
                                  dominant-baseline="central" 
                                  class="donut_segment_text"
                                >
                                  {{ formatDonutPct(currentSessionRankStats.p3) }}
                                </text>
                                <text 
                                  v-if="currentSessionRankStats.p4 >= 6"
                                  :x="getRankLabelPos(currentSessionRankStats, 4).x" 
                                  :y="getRankLabelPos(currentSessionRankStats, 4).y" 
                                  text-anchor="middle" 
                                  dominant-baseline="central" 
                                  class="donut_segment_text"
                                >
                                  {{ formatDonutPct(currentSessionRankStats.p4) }}
                                </text>
                              </g>
                              <!-- 중앙 텍스트 -->
                              <text x="100" y="87" text-anchor="middle" class="chart_center_label">총 대국</text>
                              <text x="100" y="105" text-anchor="middle" class="chart_center_value">{{ currentSessionRankStats.totalGames }}전</text>
                              <text x="100" y="123" text-anchor="middle" class="chart_center_sub">평균 {{ (currentSessionPlayerStats.avgRank ?? 0).toFixed(3) }}위</text>
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
                                <span class="rank_count_val">{{ currentSessionRankStats.r1 }}회</span>
                                <span class="rank_percent_val text_rank_1">{{ currentSessionRankStats.p1.toFixed(2) }}%</span>
                              </div>
                              <div class="rank_bar_track">
                                <div class="rank_bar_fill bar_1" :style="{ width: currentSessionRankStats.p1 + '%' }"></div>
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
                                <span class="rank_count_val">{{ currentSessionRankStats.r2 }}회</span>
                                <span class="rank_percent_val text_rank_2">{{ currentSessionRankStats.p2.toFixed(2) }}%</span>
                              </div>
                              <div class="rank_bar_track">
                                <div class="rank_bar_fill bar_2" :style="{ width: currentSessionRankStats.p2 + '%' }"></div>
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
                                <span class="rank_count_val">{{ currentSessionRankStats.r3 }}회</span>
                                <span class="rank_percent_val text_rank_3">{{ currentSessionRankStats.p3.toFixed(2) }}%</span>
                              </div>
                              <div class="rank_bar_track">
                                <div class="rank_bar_fill bar_3" :style="{ width: currentSessionRankStats.p3 + '%' }"></div>
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
                                <span class="rank_count_val">{{ currentSessionRankStats.r4 }}회</span>
                                <span class="rank_percent_val text_rank_4">{{ currentSessionRankStats.p4.toFixed(2) }}%</span>
                              </div>
                              <div class="rank_bar_track">
                                <div class="rank_bar_fill bar_4" :style="{ width: currentSessionRankStats.p4 + '%' }"></div>
                              </div>
                            </div>
                          </div>
                        </div>

                        <!-- 연대율 & 라스 회피율 요약 바 -->
                        <div class="rank_summary_metrics">
                          <div class="summary_metric_box">
                            <span class="metric_label">연대율 (1·2위)</span>
                            <span class="metric_val text_positive">{{ currentSessionRankStats.top2Rate }}</span>
                          </div>
                          <div class="summary_metric_box">
                            <span class="metric_label">라스 회피율</span>
                            <span class="metric_val text_positive">{{ currentSessionRankStats.lastAvoidRate }}</span>
                          </div>
                        </div>
                      </div>

                      <!-- 5. 이번 회차 레이팅 추이 탭 -->
                      <div v-else-if="sessionModalActiveTab === 'rating'" class="rating_tab_wrapper">
                        <div class="rating_summary_grid">
                          <div class="summary_stat_box">
                            <span class="summary_label">회차 레이팅(R)</span>
                            <span class="summary_value highlight" :style="{ color: getRatingColor(sessionModalPlayerRatingSummary.endRating) }">
                              R{{ sessionModalPlayerRatingSummary.endRating }}
                              <small
                                class="session_rating_delta_inline"
                                :class="sessionModalPlayerRatingSummary.netDelta > 0 ? 'text_positive' : sessionModalPlayerRatingSummary.netDelta < 0 ? 'text_negative' : ''"
                              >
                                ({{ sessionModalPlayerRatingSummary.netDelta > 0 ? '+' : '' }}{{ sessionModalPlayerRatingSummary.netDelta }})
                              </small>
                            </span>
                          </div>
                          <div class="summary_stat_box">
                            <span class="summary_label">회차 최고</span>
                            <span class="summary_value" :style="{ color: getRatingColor(sessionModalPlayerRatingSummary.peak) }">R{{ sessionModalPlayerRatingSummary.peak }}</span>
                          </div>
                          <div class="summary_stat_box">
                            <span class="summary_label">회차 대국 수</span>
                            <span class="summary_value">{{ sessionModalPlayerRatingSummary.totalGames }}전</span>
                          </div>
                        </div>

                        <div class="rating_chart_container">
                          <div v-if="sessionModalPlayerRatingChartData.labels.length > 1" style="height: 280px; position: relative;">
                            <LineChart
                              :data="sessionModalPlayerRatingChartData"
                              :options="sessionModalPlayerRatingChartOptions"
                              :plugins="sessionModalRatingChartPlugins"
                            />
                          </div>
                          <div v-else class="no_rating_data">
                            이번 회차에 기록된 레이팅 변동 이력이 없습니다.
                          </div>
                        </div>
                      </div>

                      <!-- 6. 이번 회차 자주 만나는 상대 탭 -->
                      <div v-else-if="sessionModalActiveTab === 'opponents'" class="opponents_tab_wrapper">
                        <div class="opponents_filter_bar">
                          <span class="opponents_scope_info">
                            {{ currentSessionDetail?.sessionName }} 동탁 상대 (총 {{ sessionFrequentOpponents.totalPlayerGames }}전 기준)
                          </span>
                        </div>
                        <div v-if="sessionFrequentOpponents.opponents.length > 0" class="opponents_grid">
                          <div
                            v-for="opp in sessionFrequentOpponents.opponents"
                            :key="`sess-opp-${opp.opponentName}`"
                            class="opponent_item_row"
                            @mouseenter="onHoverOpponent($event, opp)"
                            @mouseleave="onLeaveOpponent"
                            @click.stop="onToggleOpponent($event, opp)"
                          >
                            <div class="opp_left">
                              <button
                                type="button"
                                class="opp_name_link"
                                @click.stop="openPlayerByName(opp.opponentName, true, true, true); onLeaveOpponent()"
                                title="클릭하여 상대 스탯 보기"
                              >
                                {{ opp.opponentName }}
                              </button>
                              <span class="opp_detail_icon" title="맞대결 상세 전적 보기">☰</span>
                            </div>
                            <div class="opp_right">
                              {{ formatOpponentPct(opp.encounterRate) }} ({{ opp.encounterCount }})
                            </div>
                          </div>
                        </div>
                        <div v-else class="no_rating_data">
                          이번 회차에 함께 대국한 상대 기록이 없습니다.
                        </div>
                      </div>
                    </div>
                  </div>
                </template>

                <!-- 레거시 회차 (국별 세부 데이터 없음) -->
                <div v-else class="session_legacy_view">
                  <div class="tab-menu-wrap" :class="{ 'has-scroll-indicator': modalTabScrollIndicator.visible }" style="margin-bottom: 12px;">
                    <div
                      :ref="setModalTabMenuRef"
                      class="tab_menu"
                      :class="{ 'is-dragging': isDraggingModalTab }"
                      @mousedown="onModalTabMouseDown"
                      @click.capture="onModalTabClickCapture"
                      @auxclick.prevent
                      @wheel="onModalTabWheel"
                      @scroll.passive="updateModalTabScrollIndicator"
                    >
                      <button
                        class="tab_btn"
                        :class="{ active: sessionModalActiveTab !== 'rating' && sessionModalActiveTab !== 'opponents' }"
                        @click="sessionModalActiveTab = 'basic'"
                      >
                        기본 및 순위
                      </button>
                      <button
                        class="tab_btn"
                        :class="{ active: sessionModalActiveTab === 'rating' }"
                        @click="sessionModalActiveTab = 'rating'"
                      >
                        레이팅 추이
                      </button>
                      <button
                        class="tab_btn"
                        :class="{ active: sessionModalActiveTab === 'opponents' }"
                        @click="sessionModalActiveTab = 'opponents'"
                      >
                        상대 전적
                      </button>
                    </div>
                    <div
                      v-show="modalTabScrollIndicator.visible"
                      class="tabs-nav-scroll-track"
                      @click="onModalTabTrackClick"
                      title="좌우 스크롤 위치 표시"
                    >
                      <div
                        class="tabs-nav-scroll-thumb"
                        :style="{
                          width: modalTabScrollIndicator.widthPct + '%',
                          left: modalTabScrollIndicator.leftPct + '%'
                        }"
                      ></div>
                    </div>
                  </div>
                  <template v-if="sessionModalActiveTab === 'rating'">
                    <div class="rating_tab_wrapper">
                      <div class="rating_summary_grid">
                        <div class="summary_stat_box">
                          <span class="summary_label">회차 레이팅(R)</span>
                          <span class="summary_value highlight" :style="{ color: getRatingColor(sessionModalPlayerRatingSummary.endRating) }">
                            R{{ sessionModalPlayerRatingSummary.endRating }}
                            <small
                              class="session_rating_delta_inline"
                              :class="sessionModalPlayerRatingSummary.netDelta > 0 ? 'text_positive' : sessionModalPlayerRatingSummary.netDelta < 0 ? 'text_negative' : ''"
                            >
                              ({{ sessionModalPlayerRatingSummary.netDelta > 0 ? '+' : '' }}{{ sessionModalPlayerRatingSummary.netDelta }})
                            </small>
                          </span>
                        </div>
                        <div class="summary_stat_box">
                          <span class="summary_label">회차 최고</span>
                          <span class="summary_value" :style="{ color: getRatingColor(sessionModalPlayerRatingSummary.peak) }">R{{ sessionModalPlayerRatingSummary.peak }}</span>
                        </div>
                        <div class="summary_stat_box">
                          <span class="summary_label">회차 대국 수</span>
                          <span class="summary_value">{{ sessionModalPlayerRatingSummary.totalGames }}전</span>
                        </div>
                      </div>
                      <div class="rating_chart_container">
                        <div v-if="sessionModalPlayerRatingChartData.labels.length > 1" style="height: 280px; position: relative;">
                          <LineChart
                            :data="sessionModalPlayerRatingChartData"
                            :options="sessionModalPlayerRatingChartOptions"
                            :plugins="sessionModalRatingChartPlugins"
                          />
                        </div>
                        <div v-else class="no_rating_data">
                          이번 회차에 기록된 레이팅 변동 이력이 없습니다.
                        </div>
                      </div>
                    </div>
                  </template>
                  <template v-else-if="sessionModalActiveTab === 'opponents'">
                    <div class="opponents_tab_wrapper">
                      <div class="opponents_filter_bar">
                        <span class="opponents_scope_info">
                          {{ currentSessionDetail?.sessionName }} 동탁 상대 (총 {{ sessionFrequentOpponents.totalPlayerGames }}전 기준)
                        </span>
                      </div>
                      <div v-if="sessionFrequentOpponents.opponents.length > 0" class="opponents_grid">
                        <div
                          v-for="opp in sessionFrequentOpponents.opponents"
                          :key="`leg-opp-${opp.opponentName}`"
                          class="opponent_item_row"
                          @mouseenter="onHoverOpponent($event, opp)"
                          @mouseleave="onLeaveOpponent"
                          @click.stop="onToggleOpponent($event, opp)"
                        >
                          <div class="opp_left">
                            <button
                              type="button"
                              class="opp_name_link"
                              @click.stop="openPlayerByName(opp.opponentName, true, true, true); onLeaveOpponent()"
                              title="클릭하여 상대 스탯 보기"
                            >
                              {{ opp.opponentName }}
                            </button>
                            <span class="opp_detail_icon" title="맞대결 상세 전적 보기">☰</span>
                          </div>
                          <div class="opp_right">
                            {{ formatOpponentPct(opp.encounterRate) }} ({{ opp.encounterCount }})
                          </div>
                        </div>
                      </div>
                      <div v-else class="no_rating_data">
                        이번 회차에 함께 대국한 상대 기록이 없습니다.
                      </div>
                    </div>
                  </template>
                  <template v-else>
                    <div class="legacy_session_banner">
                      ※ 해당 회차(제1~8회)는 국별 세부 데이터가 기록되지 않은 레거시 회차로, 기본 성적과 순위 분포만 표시됩니다.
                    </div>
                    <div class="stats_group">
                      <div class="stat_row">
                        <span class="stat_label">기록 대국 수</span>
                        <span class="stat_value">{{ formatDualMetric(sessionMember?.totalGames, currentSessionPlayerStats.totalGames) }}전</span>
                      </div>
                      <div class="stat_row">
                        <span class="stat_label">누적 우마</span>
                        <span class="stat_value" :class="currentSessionPlayerStats.totalUma >= 0 ? 'text_positive' : 'text_negative'">
                          {{ formatDualMetric(sessionMember?.totalUma, currentSessionPlayerStats.totalUma, 1, true) }}pt
                        </span>
                      </div>
                      <div class="stat_row">
                        <span class="stat_label">평균 우마</span>
                        <span class="stat_value" :class="currentSessionPlayerStats.avgUma >= 0 ? 'text_positive' : 'text_negative'">
                          {{ formatDualMetric(sessionMember?.avgUma, currentSessionPlayerStats.avgUma, 1, true) }}pt
                        </span>
                      </div>
                      <div class="stat_row">
                        <span class="stat_label">평균 순위</span>
                        <span class="stat_value highlight">{{ formatDualMetric(sessionMember?.avgRank, currentSessionPlayerStats.avgRank, 3) }}위</span>
                      </div>
                      <div class="stat_row">
                        <span class="stat_label">연대율 (1·2위)</span>
                        <span class="stat_value text_positive">{{ formatDualMetric(sessionMember?.top2Rate, currentSessionPlayerStats.top2Rate, 2) }}%</span>
                      </div>
                    </div>
                    <!-- 레거시 순위 분포 -->
                    <div class="session_modal_rank_section">
                      <div class="session_rank_title">이번 회차 순위 분포</div>
                      <div class="session_rank_badges_row">
                        <div class="dist-badge r1"><span class="dist-label">1등</span> <span class="dist-cnt">{{ currentSessionPlayerStats.rank1Count }}</span><span class="dist-pct">({{ getDistPct(currentSessionPlayerStats.rank1Count, currentSessionPlayerStats.totalGames) }}%)</span></div>
                        <div class="dist-badge r2"><span class="dist-label">2등</span> <span class="dist-cnt">{{ currentSessionPlayerStats.rank2Count }}</span><span class="dist-pct">({{ getDistPct(currentSessionPlayerStats.rank2Count, currentSessionPlayerStats.totalGames) }}%)</span></div>
                        <div class="dist-badge r3"><span class="dist-label">3등</span> <span class="dist-cnt">{{ currentSessionPlayerStats.rank3Count }}</span><span class="dist-pct">({{ getDistPct(currentSessionPlayerStats.rank3Count, currentSessionPlayerStats.totalGames) }}%)</span></div>
                        <div class="dist-badge r4"><span class="dist-label">4등</span> <span class="dist-cnt">{{ currentSessionPlayerStats.rank4Count }}</span><span class="dist-pct">({{ getDistPct(currentSessionPlayerStats.rank4Count, currentSessionPlayerStats.totalGames) }}%)</span></div>
                      </div>
                    </div>
                  </template>
                </div>
              </div>
            </div>

            <!-- 2) 전체 기간 스탯 뷰 -->
            <template v-else>

            <!-- 탭 메뉴: 기본 / 리치 스탯 / 그 외 / 순위 비율 / 레이팅 추이 / 역만 / 상대 전적 -->
            <div class="tab-menu-wrap" :class="{ 'has-scroll-indicator': modalTabScrollIndicator.visible }">
              <div
                :ref="setModalTabMenuRef"
                class="tab_menu"
                :class="{ 'is-dragging': isDraggingModalTab }"
                @mousedown="onModalTabMouseDown"
                @click.capture="onModalTabClickCapture"
                @auxclick.prevent
                @wheel="onModalTabWheel"
                @scroll.passive="updateModalTabScrollIndicator"
              >
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
                <button 
                  class="tab_btn" 
                  :class="{ active: modalActiveTab === 'rating' }" 
                  @click="modalActiveTab = 'rating'"
                >
                  레이팅 추이
                </button>
                <button 
                  class="tab_btn" 
                  :class="{ active: modalActiveTab === 'yakuman' }" 
                  @click="modalActiveTab = 'yakuman'"
                >
                  역만
                </button>
                <button 
                  class="tab_btn" 
                  :class="{ active: modalActiveTab === 'opponents' }" 
                  @click="modalActiveTab = 'opponents'"
                >
                  상대 전적
                </button>
              </div>
              <div
                v-show="modalTabScrollIndicator.visible"
                class="tabs-nav-scroll-track"
                @click="onModalTabTrackClick"
                title="좌우 스크롤 위치 표시"
              >
                <div
                  class="tabs-nav-scroll-thumb"
                  :style="{
                    width: modalTabScrollIndicator.widthPct + '%',
                    left: modalTabScrollIndicator.leftPct + '%'
                  }"
                ></div>
              </div>
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
              <div v-if="selectedPlayer?.rating" class="stat_row">
                <span class="stat_label">레이팅(R)</span>
                <span class="stat_value highlight" :style="{ color: getRatingColor(selectedPlayer.rating) }">
                  R{{ selectedPlayer.rating }}
                </span>
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
                <span class="stat_value highlight">{{ formatDualMetric(selectedPlayer?.avgRank, displayPlayerStats.avgRank, 3) }}위</span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'winRate', '화료율', displayPlayerStats.winRate, true, '%')" 
                @mouseleave="onLeaveMetric"
              >
                <span class="stat_label">화료율</span>
                <span class="stat_value">{{ formatPct(displayPlayerStats.winRate) }}</span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'dealInRate', '방총률', displayPlayerStats.dealInRate, false, '%')" 
                @mouseleave="onLeaveMetric"
              >
                <span class="stat_label">방총률</span>
                <span class="stat_value text_negative">{{ formatPct(displayPlayerStats.dealInRate) }}</span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'tsumoRate', '쯔모율', displayPlayerStats.tsumoRate, true, '%')" 
                @mouseleave="onLeaveMetric"
              >
                <span class="stat_label">쯔모율</span>
                <span class="stat_value">{{ formatPct(displayPlayerStats.tsumoRate) }}</span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'riichiRate', '리치율', displayPlayerStats.riichiRate, true, '%')" 
                @mouseleave="onLeaveMetric"
              >
                <span class="stat_label">리치율</span>
                <span class="stat_value">{{ formatPct(displayPlayerStats.riichiRate) }}</span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'drawRate', '유국률', displayPlayerStats.drawRate, false, '%')" 
                @mouseleave="onLeaveMetric"
                @click.stop="onHoverMetric($event, 'drawRate', '유국률', displayPlayerStats.drawRate, false, '%')"
              >
                <span class="stat_label">유국률</span>
                <span class="stat_value">{{ formatPct(displayPlayerStats.drawRate) }}</span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'drawTenpaiRate', '유국 텐파이율', displayPlayerStats.drawTenpaiRate, true, '%')" 
                @mouseleave="onLeaveMetric"
                @click.stop="onHoverMetric($event, 'drawTenpaiRate', '유국 텐파이율', displayPlayerStats.drawTenpaiRate, true, '%')"
              >
                <span class="stat_label">유국 텐파이율</span>
                <span class="stat_value">{{ formatPct(displayPlayerStats.drawTenpaiRate) }}</span>
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
                <span class="stat_value text_negative">{{ formatPct(displayPlayerStats.tobiRate) }}</span>
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
                <span class="stat_value">{{ formatPct(displayPlayerStats.riichiRate) }}</span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'riichiWinRate', '리치 화료율', displayPlayerStats.riichiWinRate, true, '%')" 
                @mouseleave="onLeaveMetric"
                @click.stop="onHoverMetric($event, 'riichiWinRate', '리치 화료율', displayPlayerStats.riichiWinRate, true, '%')"
              >
                <span class="stat_label">리치 화료율</span>
                <span class="stat_value text_positive">{{ formatPct(displayPlayerStats.riichiWinRate) }}</span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'riichiDealInRate', '리치 방총율', displayPlayerStats.riichiDealInRate, false, '%')" 
                @mouseleave="onLeaveMetric"
                @click.stop="onHoverMetric($event, 'riichiDealInRate', '리치 방총율', displayPlayerStats.riichiDealInRate, false, '%')"
              >
                <span class="stat_label">리치 방총율</span>
                <span class="stat_value text_negative">{{ formatPct(displayPlayerStats.riichiDealInRate) }}</span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'riichiDrawRate', '리치 유국률', displayPlayerStats.riichiDrawRate, false, '%')" 
                @mouseleave="onLeaveMetric"
                @click.stop="onHoverMetric($event, 'riichiDrawRate', '리치 유국률', displayPlayerStats.riichiDrawRate, false, '%')"
              >
                <span class="stat_label">리치 유국률</span>
                <span class="stat_value">{{ formatPct(displayPlayerStats.riichiDrawRate) }}</span>
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
                <span class="stat_value">{{ formatPct(displayPlayerStats.firstRiichiRate) }}</span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'chaseRiichiRate', '추격률', displayPlayerStats.chaseRiichiRate, true, '%')" 
                @mouseleave="onLeaveMetric"
                @click.stop="onHoverMetric($event, 'chaseRiichiRate', '추격률', displayPlayerStats.chaseRiichiRate, true, '%')"
              >
                <span class="stat_label">추격률</span>
                <span class="stat_value">{{ formatPct(displayPlayerStats.chaseRiichiRate) }}</span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'chasedRiichiRate', '피추격률', displayPlayerStats.chasedRiichiRate, false, '%')" 
                @mouseleave="onLeaveMetric"
                @click.stop="onHoverMetric($event, 'chasedRiichiRate', '피추격률', displayPlayerStats.chasedRiichiRate, false, '%')"
              >
                <span class="stat_label">피추격률</span>
                <span class="stat_value text_negative">{{ formatPct(displayPlayerStats.chasedRiichiRate) }}</span>
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
                <span class="stat_value text_negative">{{ formatPct(displayPlayerStats.oyaKaburiRate) }}</span>
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
                <span class="stat_value">{{ formatPct(displayPlayerStats.dealInRiichiRate) }}</span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'cheatRate', '촌보율', displayPlayerStats.cheatRate, false, '%')" 
                @mouseleave="onLeaveMetric"
                @click.stop="onHoverMetric($event, 'cheatRate', '촌보율', displayPlayerStats.cheatRate, false, '%')"
              >
                <span class="stat_label">촌보율</span>
                <span class="stat_value text_negative">{{ formatPct5(displayPlayerStats.cheatRate) }}</span>
              </div>
              <div 
                class="stat_row hoverable" 
                @mouseenter="onHoverMetric($event, 'beolbuRate', '벌부율', displayPlayerStats.beolbuRate, false, '%')" 
                @mouseleave="onLeaveMetric"
                @click.stop="onHoverMetric($event, 'beolbuRate', '벌부율', displayPlayerStats.beolbuRate, false, '%')"
              >
                <span class="stat_label">벌부율</span>
                <span class="stat_value text_negative">{{ formatPct5(displayPlayerStats.beolbuRate) }}</span>
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

            <!-- 3-2. 역만 탭 (개인별 17종 역만 화료 카운트 및 달성 사진) -->
            <div v-else-if="modalActiveTab === 'yakuman'" class="yakuman_tab_wrapper">
              <div class="yakuman_summary_bar">
                <span class="ym_summary_title">통산 역만 화료 기록</span>
                <span class="ym_summary_badge" :class="{ achieved: modalPlayerYakumanStats.totalYakumanCount > 0 }">
                  {{ modalPlayerYakumanStats.totalYakumanCount }}회
                </span>
              </div>
              <div class="yakuman_counts_grid">
                <div
                  v-for="ym in modalPlayerYakumanStats.items"
                  :key="`all-ym-${ym.key}`"
                  class="yakuman_count_row"
                  :class="{ achieved: ym.count > 0, double: ym.isDouble }"
                >
                  <span class="ym_name">{{ ym.label }}</span>
                  <span class="ym_leader_line" aria-hidden="true"></span>
                  <span class="ym_val">{{ ym.count }}</span>
                </div>
              </div>
              <div v-if="modalPlayerYakumanStats.achievedRecords.length > 0" class="yakuman_achieved_list">
                <div class="ym_achieved_header">달성 상세 및 화료 사진 ({{ modalPlayerYakumanStats.achievedRecords.length }}건)</div>
                <div class="ym_achieved_cards">
                  <div
                    v-for="rec in modalPlayerYakumanStats.achievedRecords"
                    :key="rec.id"
                    class="ym_achieved_card"
                    @click="openHighlightLightbox(rec)"
                  >
                    <img v-if="rec.hasImage && rec.imageId" :src="getHighlightThumbnailUrl(rec.imageId)" class="ym_thumb" loading="lazy" decoding="async" alt="역만" />
                    <div class="ym_achieved_info">
                      <div class="ym_achieved_tags">
                        <span v-for="t in rec.yakumanTypes" :key="t" class="hl-y-badge">{{ t }}</span>
                      </div>
                      <div class="ym_achieved_meta">
                        {{ rec.sessionName }}
                        <template v-if="rec.gameIndex"> · {{ rec.gameIndex }}경기</template>
                        <template v-if="rec.roundName"> · {{ formatCardRoundKorean(rec.roundName) }}</template>
                      </div>
                      <div v-if="rec.caption" class="ym_achieved_caption">{{ rec.caption }}</div>
                    </div>
                  </div>
                </div>
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
                      r="73" 
                      fill="none" 
                      stroke="var(--border-color, rgba(0,0,0,0.08))" 
                      stroke-width="38"
                    />
                    <!-- 조각 링 -->
                    <g transform="rotate(-90 100 100)">
                      <!-- 4위 (빨강) -->
                      <circle 
                        v-if="modalRankStats.p4 > 0"
                        cx="100" cy="100" r="73" 
                        fill="none" 
                        stroke="#ef4444" 
                        stroke-width="38" 
                        :stroke-dasharray="`${(modalRankStats.p4 / 100) * 458.672} 458.672`"
                        :stroke-dashoffset="`-${((modalRankStats.p1 + modalRankStats.p2 + modalRankStats.p3) / 100) * 458.672}`"
                        class="donut_segment"
                        :class="{ active: hoveredRank === 4 }"
                        @mouseenter="hoveredRank = 4"
                        @mouseleave="hoveredRank = null"
                      />
                      <!-- 3위 (노랑/앰버) -->
                      <circle 
                        v-if="modalRankStats.p3 > 0"
                        cx="100" cy="100" r="73" 
                        fill="none" 
                        stroke="#f59e0b" 
                        stroke-width="38" 
                        :stroke-dasharray="`${(modalRankStats.p3 / 100) * 458.672} 458.672`"
                        :stroke-dashoffset="`-${((modalRankStats.p1 + modalRankStats.p2) / 100) * 458.672}`"
                        class="donut_segment"
                        :class="{ active: hoveredRank === 3 }"
                        @mouseenter="hoveredRank = 3"
                        @mouseleave="hoveredRank = null"
                      />
                      <!-- 2위 (청록) -->
                      <circle 
                        v-if="modalRankStats.p2 > 0"
                        cx="100" cy="100" r="73" 
                        fill="none" 
                        stroke="#06b6d4" 
                        stroke-width="38" 
                        :stroke-dasharray="`${(modalRankStats.p2 / 100) * 458.672} 458.672`"
                        :stroke-dashoffset="`-${(modalRankStats.p1 / 100) * 458.672}`"
                        class="donut_segment"
                        :class="{ active: hoveredRank === 2 }"
                        @mouseenter="hoveredRank = 2"
                        @mouseleave="hoveredRank = null"
                      />
                      <!-- 1위 (초록) -->
                      <circle 
                        v-if="modalRankStats.p1 > 0"
                        cx="100" cy="100" r="73" 
                        fill="none" 
                        stroke="#10b981" 
                        stroke-width="38" 
                        :stroke-dasharray="`${(modalRankStats.p1 / 100) * 458.672} 458.672`"
                        stroke-dashoffset="0"
                        class="donut_segment"
                        :class="{ active: hoveredRank === 1 }"
                        @mouseenter="hoveredRank = 1"
                        @mouseleave="hoveredRank = null"
                      />
                    </g>
                    <!-- 각 순위 영역 내 % 레이블 -->
                    <g class="donut_labels" pointer-events="none">
                      <text 
                        v-if="modalRankStats.p1 >= 6"
                        :x="getRankLabelPos(modalRankStats, 1).x" 
                        :y="getRankLabelPos(modalRankStats, 1).y" 
                        text-anchor="middle" 
                        dominant-baseline="central" 
                        class="donut_segment_text"
                      >
                        {{ formatDonutPct(modalRankStats.p1) }}
                      </text>
                      <text 
                        v-if="modalRankStats.p2 >= 6"
                        :x="getRankLabelPos(modalRankStats, 2).x" 
                        :y="getRankLabelPos(modalRankStats, 2).y" 
                        text-anchor="middle" 
                        dominant-baseline="central" 
                        class="donut_segment_text"
                      >
                        {{ formatDonutPct(modalRankStats.p2) }}
                      </text>
                      <text 
                        v-if="modalRankStats.p3 >= 6"
                        :x="getRankLabelPos(modalRankStats, 3).x" 
                        :y="getRankLabelPos(modalRankStats, 3).y" 
                        text-anchor="middle" 
                        dominant-baseline="central" 
                        class="donut_segment_text"
                      >
                        {{ formatDonutPct(modalRankStats.p3) }}
                      </text>
                      <text 
                        v-if="modalRankStats.p4 >= 6"
                        :x="getRankLabelPos(modalRankStats, 4).x" 
                        :y="getRankLabelPos(modalRankStats, 4).y" 
                        text-anchor="middle" 
                        dominant-baseline="central" 
                        class="donut_segment_text"
                      >
                        {{ formatDonutPct(modalRankStats.p4) }}
                      </text>
                    </g>
                    <!-- 중앙 텍스트 -->
                    <text x="100" y="87" text-anchor="middle" class="chart_center_label">총 대국</text>
                    <text x="100" y="105" text-anchor="middle" class="chart_center_value">{{ modalRankStats.totalGames }}전</text>
                    <text x="100" y="123" text-anchor="middle" class="chart_center_sub">평균 {{ (selectedPlayer?.avgRank ?? 0).toFixed(3) }}위</text>
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
                      <span class="rank_percent_val text_rank_1">{{ modalRankStats.p1.toFixed(2) }}%</span>
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
                      <span class="rank_percent_val text_rank_2">{{ modalRankStats.p2.toFixed(2) }}%</span>
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
                      <span class="rank_percent_val text_rank_3">{{ modalRankStats.p3.toFixed(2) }}%</span>
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
                      <span class="rank_percent_val text_rank_4">{{ modalRankStats.p4.toFixed(2) }}%</span>
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

            <!-- 5. 레이팅 추이 탭 -->
            <div v-else-if="modalActiveTab === 'rating'" class="rating_tab_wrapper">
              <div class="rating_summary_grid">
                <div class="summary_stat_box">
                  <span class="summary_label">레이팅(R)</span>
                  <span class="summary_value highlight" :style="{ color: getRatingColor(modalPlayerRatingSummary.current) }">R{{ modalPlayerRatingSummary.current }}</span>
                </div>
                <div class="summary_stat_box">
                  <span class="summary_label">역대 최고</span>
                  <span class="summary_value" :style="{ color: getRatingColor(modalPlayerRatingSummary.peak) }">R{{ modalPlayerRatingSummary.peak }}</span>
                </div>
                <div class="summary_stat_box">
                  <span class="summary_label">기록 대국 수</span>
                  <span class="summary_value">{{ modalPlayerRatingSummary.totalGames }}전</span>
                </div>
              </div>

              <div class="rating_chart_container">
                <div v-if="modalPlayerRatingChartData.labels.length > 1" style="height: 280px; position: relative;">
                  <LineChart 
                    :data="modalPlayerRatingChartData" 
                    :options="modalPlayerRatingChartOptions" 
                    :plugins="modalRatingChartPlugins"
                  />
                </div>
                <div v-else class="no_rating_data">
                  기록된 레이팅 변동 이력이 없습니다. (기본 R1320)
                </div>
              </div>
            </div>

            <!-- 6. 자주 만나는 상대 탭 -->
            <div v-else-if="modalActiveTab === 'opponents'" class="opponents_tab_wrapper">
              <div class="opponents_filter_bar">
                <div class="opp_limit_pills">
                  <button
                    type="button"
                    class="opp_limit_btn"
                    :class="{ active: opponentsGameLimit === 0 }"
                    @click="opponentsGameLimit = 0"
                  >
                    전체 대국
                  </button>
                  <button
                    type="button"
                    class="opp_limit_btn"
                    :class="{ active: opponentsGameLimit === 100 }"
                    @click="opponentsGameLimit = 100"
                  >
                    100 대국
                  </button>
                  <button
                    type="button"
                    class="opp_limit_btn"
                    :class="{ active: opponentsGameLimit === 50 }"
                    @click="opponentsGameLimit = 50"
                  >
                    50 대국
                  </button>
                </div>
              </div>
              <div v-if="allTimeFrequentOpponents.opponents.length > 0" class="opponents_grid">
                <div
                  v-for="opp in allTimeFrequentOpponents.opponents"
                  :key="`all-opp-${opp.opponentName}`"
                  class="opponent_item_row"
                  @mouseenter="onHoverOpponent($event, opp)"
                  @mouseleave="onLeaveOpponent"
                  @click.stop="onToggleOpponent($event, opp)"
                >
                  <div class="opp_left">
                    <button
                      type="button"
                      class="opp_name_link"
                      @click.stop="openPlayerByName(opp.opponentName, isModalFromSession, true, true); onLeaveOpponent()"
                      title="클릭하여 상대 스탯 보기"
                    >
                      {{ opp.opponentName }}
                    </button>
                    <span class="opp_detail_icon" title="맞대결 상세 전적 보기">☰</span>
                  </div>
                  <div class="opp_right">
                    {{ formatOpponentPct(opp.encounterRate) }} ({{ opp.encounterCount }})
                  </div>
                </div>
              </div>
              <div v-else class="no_rating_data">
                함께 대국한 상대 기록이 없습니다.
              </div>
            </div>
          </div>
        </div>
      </template>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ============================================== -->
    <!-- 회차 대국 상세 모달 (결과 표 & 점수 변동 그래프)   -->
    <!-- ============================================== -->
    <Transition name="modal-fade">
      <div 
        v-if="selectedGameDetail" 
        class="game-detail-modal-overlay" 
        v-backdrop-dismiss="() => selectedGameDetail = null"
      >
        <div class="game-detail-modal-card">
          <!-- 모달 헤더 -->
          <div class="gdm-header">
            <div class="gdm-title-box">
              <span class="gdm-session-badge">{{ gameModalSessionName || currentSessionDetail?.sessionName || selectedSession }}</span>
              <h3 class="gdm-title">{{ selectedGameDetail.gameIndex }}경기 결과</h3>
              <span class="gdm-time" v-if="selectedGameDetail.time">({{ selectedGameDetail.time }})</span>
            </div>
            <div class="gdm-actions">
              <div class="gdm-tabs" v-if="selectedGameDetail.hasRoundDetails">
                <button 
                  class="gdm-tab-btn" 
                  :class="{ active: gameModalMode === 'sheet' }"
                  @click="gameModalMode = 'sheet'"
                >
                  결과 표
                </button>
                <button 
                  class="gdm-tab-btn" 
                  :class="{ active: gameModalMode === 'chart' }"
                  @click="gameModalMode = 'chart'"
                >
                  점수 변동 그래프
                </button>
                <button 
                  class="gdm-tab-btn" 
                  :class="{ active: gameModalMode === 'rounds' }"
                  @click="gameModalMode = 'rounds'"
                >
                  국별 점수 이동
                </button>
              </div>
              <button class="gdm-close-btn" @click="selectedGameDetail = null" title="닫기">✕</button>
            </div>
          </div>

          <!-- 로딩 표시 (상세 데이터 백그라운드 수집 중) -->
          <div v-if="isLoadingGameDetail" class="gdm-loading-badge">
            <span class="gdm-spinner"></span> 국별 세부 데이터 조회 중...
          </div>

          <!-- 1) 결과 표 (Sheet) 뷰 -->
          <div v-show="gameModalMode === 'sheet'">
            <div 
              class="gdm-resultsheet" 
              :class="{ 'clickable-view': selectedGameDetail.hasRoundDetails }"
              @click="selectedGameDetail.hasRoundDetails ? (gameModalMode = 'chart') : null"
              :title="selectedGameDetail.hasRoundDetails ? '클릭 시 점수 변동 그래프로 전환' : undefined"
            >
              <div class="gdm-header-cell wind">바람</div>
              <div class="gdm-header-cell name">이름</div>
              <div class="gdm-header-cell rating">레이팅 (변동)</div>
              <div class="gdm-header-cell score">점수 (우마)</div>
              <div class="gdm-header-cell riichi">리치</div>
              <div class="gdm-header-cell ron">론</div>
              <div class="gdm-header-cell tsumo">쯔모</div>
              <div class="gdm-header-cell lose">방총</div>

              <div class="gdm-content-col wind_contents">
                <div 
                  v-for="p in selectedGameDetail.playerStats" 
                  :key="'wind-' + p.seat + p.name"
                  :class="{ 'is-east': p.seat === '東' }"
                >
                  {{ p.seat }}
                </div>
              </div>
              <div class="gdm-content-col name_contents">
                <div
                  v-for="p in selectedGameDetail.playerStats"
                  :key="'name-' + p.seat + p.name"
                  class="gdm-name-cell-inner"
                >
                  <span class="gdm-player-name-txt">{{ p.name }}</span>
                  <span
                    v-if="isPlayerYakumanInGame(selectedGameDetail, p.name, gameModalSessionName || currentSessionDetail?.sessionName || selectedSession)"
                    class="gdm-inline-yakuman-badge"
                  >역만</span>
                </div>
              </div>
              <div class="gdm-content-col rating_contents">
                <div v-for="p in selectedGameDetail.playerStats" :key="'rating-' + p.seat + p.name">
                  <template v-if="p.ratingBefore !== undefined">
                    <span class="gdm-rating-val" :style="{ color: getRatingColor(p.ratingBefore) }">R{{ p.ratingBefore }}</span>
                    <span class="gdm-rating-delta" :class="(p.ratingDelta || 0) >= 0 ? 'text_pos' : 'text_neg'">
                      ({{ (p.ratingDelta || 0) >= 0 ? '+' : '' }}{{ p.ratingDelta }})
                    </span>
                  </template>
                  <template v-else>-</template>
                </div>
              </div>
              <div class="gdm-content-col score_contents">
                <div v-for="p in selectedGameDetail.playerStats" :key="'score-' + p.seat + p.name">
                  <span class="gdm-score-val">{{ p.score.toLocaleString() }}</span>
                  <span class="gdm-score-uma">(<span :class="p.uma >= 0 ? 'text_pos' : 'text_neg'"><span v-if="p.uma > 0">+</span>{{ p.uma }}</span>)</span>
                </div>
              </div>
              <div class="gdm-content-col riichi_contents">
                <div v-for="p in selectedGameDetail.playerStats" :key="'riichi-' + p.seat + p.name">
                  {{ selectedGameDetail.hasRoundDetails ? p.cntRiichi : '-' }}
                </div>
              </div>
              <div class="gdm-content-col ron_contents">
                <div v-for="p in selectedGameDetail.playerStats" :key="'ron-' + p.seat + p.name">
                  {{ selectedGameDetail.hasRoundDetails ? p.cntRon : '-' }}
                </div>
              </div>
              <div class="gdm-content-col tsumo_contents">
                <div v-for="p in selectedGameDetail.playerStats" :key="'tsumo-' + p.seat + p.name">
                  {{ selectedGameDetail.hasRoundDetails ? p.cntTsumo : '-' }}
                </div>
              </div>
              <div class="gdm-content-col lose_contents">
                <div v-for="p in selectedGameDetail.playerStats" :key="'lose-' + p.seat + p.name">
                  {{ selectedGameDetail.hasRoundDetails ? p.cntLose : '-' }}
                </div>
              </div>
            </div>

            <div 
              v-if="selectedGameDetail.hasRoundDetails" 
              class="gdm-hint" 
              @click="gameModalMode = 'chart'"
            >
              표를 클릭하면 국별 점수 변동 그래프를 볼 수 있습니다.
            </div>
            <div v-else-if="!isLoadingGameDetail" class="gdm-legacy-notice">
              해당 대국은 국별 상세 기록(리치/론/쯔모/방총 및 국별 점수 변동)이 제공되지 않아 최종 점수와 우마만 표시됩니다.
            </div>
          </div>

          <!-- 2) 점수 변동 그래프 (Chart) 뷰 -->
          <div v-show="gameModalMode === 'chart'">
            <div 
              class="gdm-chart-box clickable-view"
              @click="gameModalMode = 'sheet'"
              title="클릭 시 결과 표로 전환"
            >
              <LineChart
                v-if="selectedGameDetail.chartData && selectedGameDetail.chartData.datasets.length > 0"
                :key="`gdm-line-chart-${selectedGameDetail.gameId}-${selectedGameDetail.gameIndex}-${isDark ? 'dark' : 'light'}`"
                :data="selectedGameDetail.chartData"
                :options="gameChartOptions"
              />
              <div v-else class="gdm-empty-chart">
                점수 변동 그래프 데이터가 없습니다.
              </div>
            </div>

            <div class="gdm-hint" @click="gameModalMode = 'sheet'">
              차트를 클릭하면 국별 결과 표로 돌아갑니다.
            </div>
          </div>

          <!-- 3) 국별 점수 이동 (Rounds) 뷰 -->
          <div v-show="gameModalMode === 'rounds'" class="gdm-rounds-view">
            <div class="gdm-rounds-filter-bar">
              <label class="gdm-rounds-filter-label">국 선택</label>
              <select v-model="gameModalSelectedRound" class="form-select gdm-rounds-select">
                <option value="__all__">전체 국 모두 보기 ({{ gameModalAllRoundMovements.length }}국)</option>
                <option
                  v-for="(rm, idx) in gameModalAllRoundMovements"
                  :key="`gdm-r-opt-${rm.roundIndex}-${idx}`"
                  :value="rm.roundName"
                >
                  {{ formatCardRoundKorean(rm.roundName) }}{{ formatRoundOptionSummary(rm) }}{{ isRoundYakuman(rm, selectedGameDetail, gameModalSessionName || currentSessionDetail?.sessionName || selectedSession) ? ' [역만]' : '' }}
                </option>
              </select>
            </div>
            <div v-if="gameModalDisplayedRoundMovements.length > 0" class="gdm-rounds-scroll-list">
              <div
                v-for="(rm, rmIdx) in gameModalDisplayedRoundMovements"
                :key="`gdm-rm-${rm.roundIndex}-${rmIdx}`"
                class="upload-round-movement-card"
              >
                <div class="urm-header">
                  <div class="urm-title-group">
                    <span class="urm-title">{{ formatCardRoundKorean(rm.roundName) }} 점수 이동 내역</span>
                    <span
                      v-if="isRoundYakuman(rm, selectedGameDetail, gameModalSessionName || currentSessionDetail?.sessionName || selectedSession)"
                      class="urm-yakuman-badge"
                    >역만</span>
                  </div>
                  <span v-if="formatRoundStatusLabel(rm.roundStatus)" class="urm-status-badge">
                    {{ formatRoundStatusLabel(rm.roundStatus) }}
                  </span>
                </div>
                <div class="urm-players-grid">
                  <div
                    v-for="pm in rm.players"
                    :key="`gdm-rm-p-${rm.roundIndex}-${pm.name}`"
                    class="urm-player-row"
                    :class="{ 'is-win': pm.isWin, 'is-lose': pm.isLose }"
                  >
                    <div class="urm-player-left">
                      <span class="urm-seat" :class="{ 'is-east': pm.seat === '東' }">{{ pm.seat }}</span>
                      <span class="urm-name">{{ pm.name }}</span>
                      <span
                        v-if="isRoundPlayerYakuman(rm, pm, selectedGameDetail, gameModalSessionName || currentSessionDetail?.sessionName || selectedSession)"
                        class="urm-tag yakuman"
                      >역만</span>
                      <span v-if="pm.isRiichi" class="urm-tag riichi">리치</span>
                      <span v-if="pm.isWin" class="urm-tag win">
                        {{ formatRoundStatusLabel(rm.roundStatus) === '쯔모' ? '쯔모' : '론' }}
                      </span>
                      <span v-if="pm.isLose" class="urm-tag lose">방총</span>
                    </div>
                    <div class="urm-player-right">
                      <span class="urm-score-flow">{{ pm.scoreBefore.toLocaleString() }} → {{ pm.scoreAfter.toLocaleString() }}</span>
                      <span
                        class="urm-score-delta"
                        :class="pm.deltaScore > 0 ? 'pos' : pm.deltaScore < 0 ? 'neg' : 'zero'"
                      >
                        ({{ pm.deltaScore > 0 ? '+' : '' }}{{ pm.deltaScore.toLocaleString() }})
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div v-else-if="!isLoadingGameDetail" class="gdm-empty-chart">
              국별 점수 이동 내역이 없습니다.
            </div>
          </div>

          <!-- 이 경기의 역만/화료 기록 및 등록 버튼 (기록이 있을 때만 제목/목록 표기) -->
          <div class="gdm-highlights-box">
            <div class="gdm-highlights-header" :class="{ 'only-btn': currentGameHighlights.length === 0 }">
              <span v-if="currentGameHighlights.length > 0" class="gdm-highlights-title">
                이 경기의 역만/화료 기록 ({{ currentGameHighlights.length }})
              </span>
              <button 
                class="btn-add-highlight-sm" 
                @click="handleOpenUploadFromGameModal"
              >
                역만 / 사진 등록
              </button>
            </div>
            <div v-if="currentGameHighlights.length > 0" class="gdm-highlights-list">
              <div 
                v-for="item in currentGameHighlights" 
                :key="item.id" 
                class="gdm-highlight-item"
                @click="openHighlightLightbox(item)"
              >
                <img v-if="item.hasImage && item.imageId" :src="getHighlightThumbnailUrl(item.imageId)" class="gdm-highlight-thumb" loading="lazy" decoding="async" alt="사진" />
                <div class="gdm-highlight-info">
                  <div class="gdm-highlight-badges">
                    <span v-if="item.roundName" class="badge-round-sm">{{ formatCardRoundKorean(item.roundName) }}</span>
                    <template v-if="item.category === 'yakuman'">
                      <span v-for="yk in item.yakumanTypes" :key="yk" class="badge-yakuman-sm">{{ yk }}</span>
                    </template>
                    <span v-else-if="item.category === 'fun'" class="badge-fun-sm">그 외 화료</span>
                    <template v-else-if="item.category === 'nanikiru'">
                      <span class="badge-nanikiru-sm">나니키루</span>
                      <span v-for="ntag in item.yakumanTypes" :key="`gdm-nt-${ntag}`" class="badge-nanikiru-tag-sm">{{ ntag }}</span>
                    </template>
                    <span v-else class="badge-session-sm">기타 사진</span>
                  </div>
                  <div v-if="item.winnerName" class="gdm-highlight-players">
                    {{ item.category === 'session' || item.category === 'nanikiru' ? '인원:' : '화료:' }}
                    <button
                      type="button"
                      class="hl-player-link strong"
                      @click.stop="openPlayerByName(item.winnerName, true, false, true, item.sessionName || gameModalSessionName)"
                      title="클릭하여 대국자 스탯 보기"
                    >{{ item.winnerName }}</button>
                    <span v-if="item.winType && item.category !== 'nanikiru' && item.category !== 'session'">
                      ({{ item.winType === 'tsumo' ? '쯔모' : '론' }}<template v-if="item.winType === 'ron' && item.loserName"> ← <button
                        type="button"
                        class="hl-player-link"
                        @click.stop="openPlayerByName(item.loserName, true, false, true, item.sessionName || gameModalSessionName)"
                        title="클릭하여 방총자 스탯 보기"
                      >{{ item.loserName }}</button></template>)
                    </span>
                  </div>
                  <div v-if="item.caption" class="gdm-highlight-note">{{ item.caption }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ============================================== -->
    <!-- 역만 / 화료 / 나니키루 / 기타 사진 등록 대형 모달 -->
    <!-- ============================================== -->
    <Transition name="modal-fade">
      <div 
        v-if="isHighlightUploadModalOpen" 
        class="modal-overlay" 
        v-backdrop-dismiss="closeHighlightUploadModal"
      >
        <div class="highlight-upload-modal-card large-upload-modal">
          <div class="highlight-modal-header">
            <div>
              <h3>{{ editingHighlightRecord ? (isGalleryAdmin ? '등록 기록 / 사진 수정' : '등록 기록 정보 수정') : '역만 / 화료 / 나니키루 / 기타 사진 등록' }}</h3>
              <p class="upload-modal-subdesc">
                {{ editingHighlightRecord ? (isGalleryAdmin ? '등록된 기록의 분류, 회차, 경기, 국, 인원, 역만, 사진 및 메모를 수정합니다.' : '등록된 기록의 분류, 회차, 경기, 국, 인원, 역만 및 메모를 수정합니다. (사진 변경/삭제는 관리자 전용)') : '역만, 그 외 화료, 나니키루(무엇을 버릴까), 기타 사진을 등록합니다.' }}
              </p>
            </div>
            <button class="btn-close" @click="closeHighlightUploadModal" title="닫기">✕</button>
          </div>
          <div
            class="highlight-modal-body"
            @mousedown="markUploadFormUserInteracted"
            @touchstart.passive="markUploadFormUserInteracted"
            @keydown="markUploadFormUserInteracted"
          >
            <!-- 현재 아카이브 요약 현황 -->
            <div class="gh-stats-row upload-modal-stats-row">
              <div class="gh-stat-pill">
                <span class="gh-stat-label">전체 아카이브</span>
                <span class="gh-stat-val">{{ highlightsList.length }}건</span>
              </div>
              <div class="gh-stat-pill yakuman">
                <span class="gh-stat-label">역만</span>
                <span class="gh-stat-val text_gold">{{ highlightsList.filter(h => h.category === 'yakuman').length }}건</span>
              </div>
              <div class="gh-stat-pill fun">
                <span class="gh-stat-label">그 외 화료</span>
                <span class="gh-stat-val">{{ highlightsList.filter(h => h.category === 'fun').length }}건</span>
              </div>
              <div class="gh-stat-pill nanikiru">
                <span class="gh-stat-label">나니키루</span>
                <span class="gh-stat-val">{{ highlightsList.filter(h => h.category === 'nanikiru').length }}건</span>
              </div>
              <div class="gh-stat-pill session">
                <span class="gh-stat-label">기타 사진</span>
                <span class="gh-stat-val">{{ highlightsList.filter(h => h.category === 'session').length }}건</span>
              </div>
            </div>

            <!-- 업로드 모달 내 서버 남은 용량 안내 -->
            <div class="gh-storage-status-bar in-upload-modal">
              <div class="gh-storage-info">
                <span class="gh-storage-title">서버 남은 용량</span>
                <span class="gh-storage-metrics">
                  <strong class="gh-storage-remain">{{ galleryStorageStats.remainingText }}</strong> 사용 가능
                  <span class="gh-storage-sub">
                    (현재 {{ galleryStorageStats.usedText }}<template v-if="galleryStorageStats.externalR2Bytes > 0"> · <span class="gh-storage-ext-badge" title="비활성 처리된 저장소 용량">비활성 {{ galleryStorageStats.externalUsedText }}</span></template> / {{ galleryStorageStats.maxText }} 사용 중)
                  </span>
                </span>
                <span
                  class="gh-storage-pct-badge"
                  :class="{
                    warn: galleryStorageStats.totalAccountUsedPercent >= 75 && galleryStorageStats.totalAccountUsedPercent < 90,
                    danger: galleryStorageStats.totalAccountUsedPercent >= 90
                  }"
                >
                  {{ galleryStorageStats.remainingPercent.toFixed(1) }}% 여유
                </span>
              </div>
              <div class="gh-storage-track">
                <div
                  class="gh-storage-fill"
                  :class="{
                    warn: galleryStorageStats.totalAccountUsedPercent >= 75 && galleryStorageStats.totalAccountUsedPercent < 90,
                    danger: galleryStorageStats.totalAccountUsedPercent >= 90
                  }"
                  :style="{ width: Math.max(galleryStorageStats.usedPercent > 0 ? 1.5 : 0, galleryStorageStats.usedPercent) + '%' }"
                ></div>
                <div
                  v-if="galleryStorageStats.externalR2Bytes > 0"
                  class="gh-storage-fill-external"
                  :style="{ width: Math.max(1.5, galleryStorageStats.externalBarWidthPct) + '%' }"
                  :title="`비활성 용량: ${galleryStorageStats.externalUsedText} (${galleryStorageStats.externalUsedPercent.toFixed(2)}%)`"
                ></div>
              </div>
            </div>

            <!-- 분류 선택 -->
            <div class="form-group">
              <label class="form-label">등록 분류</label>
              <div class="category-radio-group">
                <button 
                  type="button"
                  class="cat-radio-btn" 
                  :class="{ active: uploadForm.category === 'yakuman' }"
                  @click="uploadForm.category = 'yakuman'"
                >
                  역만
                </button>
                <button 
                  type="button"
                  class="cat-radio-btn" 
                  :class="{ active: uploadForm.category === 'fun' }"
                  @click="uploadForm.category = 'fun'"
                >
                  그 외 화료
                </button>
                <button 
                  type="button"
                  class="cat-radio-btn nanikiru" 
                  :class="{ active: uploadForm.category === 'nanikiru' }"
                  :disabled="Boolean(editingHighlightRecord && !isGalleryAdmin && !editingHighlightRecord.hasImage)"
                  @click="uploadForm.category = 'nanikiru'"
                >
                  나니키루 (무엇을 버릴까)
                </button>
                <button 
                  type="button"
                  class="cat-radio-btn" 
                  :class="{ active: uploadForm.category === 'session' }"
                  :disabled="Boolean(editingHighlightRecord && !isGalleryAdmin && !editingHighlightRecord.hasImage)"
                  @click="uploadForm.category = 'session'"
                >
                  기타 사진 등록
                </button>
              </div>
            </div>

            <!-- 회차 및 경기 번호 (실제 회차 경기 정보 기반 선택) -->
            <div class="form-row-2">
              <div class="form-group">
                <label class="form-label">회차 선택 {{ uploadForm.category === 'session' ? '(선택)' : '*' }}</label>
                <select v-model="uploadForm.sessionName" class="form-select">
                  <option v-if="uploadForm.category === 'session'" value="">선택 안 함 (회차 무관)</option>
                  <option v-for="sName in displayedAvailableSessions" :key="`up-s-${sName}`" :value="sName">
                    {{ sName }}
                  </option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">경기 선택 {{ uploadForm.category === 'yakuman' ? '*' : '(선택)' }}</label>
                <select v-model="uploadForm.gameIndex" class="form-select" :disabled="!uploadForm.sessionName">
                  <option :value="undefined">{{ uploadForm.category === 'yakuman' ? '경기를 선택하세요 (필수)' : '선택 안 함' }}</option>
                  <option
                    v-for="g in uploadModalGames"
                    :key="`up-g-${g.gameIndex}`"
                    :value="g.gameIndex"
                  >
                    {{ g.gameIndex }}경기 ({{ g.players.map(p => p.name).join(', ') }})
                  </option>
                </select>
              </div>
            </div>

            <!-- 선택한 경기의 결과 표 및 점수 변동 그래프 미리보기 -->
            <div v-if="uploadModalGameDetail" class="upload-game-preview-box">
              <div class="upload-game-preview-header">
                <div class="upload-game-preview-title">
                  <strong>{{ uploadModalGameDetail.gameIndex }}경기 결과</strong>
                  <span v-if="uploadModalGameDetail.time" class="upload-game-preview-time">({{ uploadModalGameDetail.time }})</span>
                  <span v-if="isLoadingUploadGameDetail" class="upload-game-loading-txt">세부 국별 데이터 조회 중...</span>
                </div>
                <div v-if="uploadModalGameDetail.hasRoundDetails" class="gdm-tabs">
                  <button
                    type="button"
                    class="gdm-tab-btn"
                    :class="{ active: uploadModalGameViewMode === 'sheet' }"
                    @click="uploadModalGameViewMode = 'sheet'"
                  >
                    결과 표
                  </button>
                  <button
                    type="button"
                    class="gdm-tab-btn"
                    :class="{ active: uploadModalGameViewMode === 'chart' }"
                    @click="uploadModalGameViewMode = 'chart'"
                  >
                    점수 변동 그래프
                  </button>
                </div>
              </div>

              <!-- 1) 결과 표 뷰 -->
              <div v-show="uploadModalGameViewMode === 'sheet'">
                <div
                  class="gdm-resultsheet"
                  :class="{ 'clickable-view': uploadModalGameDetail.hasRoundDetails }"
                  @click="uploadModalGameDetail.hasRoundDetails ? (uploadModalGameViewMode = 'chart') : null"
                  :title="uploadModalGameDetail.hasRoundDetails ? '클릭 시 점수 변동 그래프로 전환' : undefined"
                >
                  <div class="gdm-header-cell wind">바람</div>
                  <div class="gdm-header-cell name">이름</div>
                  <div class="gdm-header-cell rating">레이팅 (변동)</div>
                  <div class="gdm-header-cell score">점수 (우마)</div>
                  <div class="gdm-header-cell riichi">리치</div>
                  <div class="gdm-header-cell ron">론</div>
                  <div class="gdm-header-cell tsumo">쯔모</div>
                  <div class="gdm-header-cell lose">방총</div>

                  <div class="gdm-content-col wind_contents">
                    <div
                      v-for="p in uploadModalGameDetail.playerStats"
                      :key="'up-wind-' + p.seat + p.name"
                      :class="{ 'is-east': p.seat === '東' }"
                    >
                      {{ p.seat }}
                    </div>
                  </div>
                  <div class="gdm-content-col name_contents">
                    <div
                      v-for="p in uploadModalGameDetail.playerStats"
                      :key="'up-name-' + p.seat + p.name"
                      class="gdm-name-cell-inner"
                    >
                      <span class="gdm-player-name-txt">{{ p.name }}</span>
                      <span
                        v-if="isPlayerYakumanInGame(uploadModalGameDetail, p.name, uploadForm.sessionName)"
                        class="gdm-inline-yakuman-badge"
                      >역만</span>
                    </div>
                  </div>
                  <div class="gdm-content-col rating_contents">
                    <div v-for="p in uploadModalGameDetail.playerStats" :key="'up-rating-' + p.seat + p.name">
                      <template v-if="p.ratingBefore !== undefined">
                        <span class="gdm-rating-val" :style="{ color: getRatingColor(p.ratingBefore) }">R{{ p.ratingBefore }}</span>
                        <span class="gdm-rating-delta" :class="(p.ratingDelta || 0) >= 0 ? 'text_pos' : 'text_neg'">
                          ({{ (p.ratingDelta || 0) >= 0 ? '+' : '' }}{{ p.ratingDelta }})
                        </span>
                      </template>
                      <template v-else>-</template>
                    </div>
                  </div>
                  <div class="gdm-content-col score_contents">
                    <div v-for="p in uploadModalGameDetail.playerStats" :key="'up-score-' + p.seat + p.name">
                      <span class="gdm-score-val">{{ p.score.toLocaleString() }}</span>
                      <span class="gdm-score-uma">(<span :class="p.uma >= 0 ? 'text_pos' : 'text_neg'"><span v-if="p.uma > 0">+</span>{{ p.uma }}</span>)</span>
                    </div>
                  </div>
                  <div class="gdm-content-col riichi_contents">
                    <div v-for="p in uploadModalGameDetail.playerStats" :key="'up-riichi-' + p.seat + p.name">
                      {{ uploadModalGameDetail.hasRoundDetails ? p.cntRiichi : '-' }}
                    </div>
                  </div>
                  <div class="gdm-content-col ron_contents">
                    <div v-for="p in uploadModalGameDetail.playerStats" :key="'up-ron-' + p.seat + p.name">
                      {{ uploadModalGameDetail.hasRoundDetails ? p.cntRon : '-' }}
                    </div>
                  </div>
                  <div class="gdm-content-col tsumo_contents">
                    <div v-for="p in uploadModalGameDetail.playerStats" :key="'up-tsumo-' + p.seat + p.name">
                      {{ uploadModalGameDetail.hasRoundDetails ? p.cntTsumo : '-' }}
                    </div>
                  </div>
                  <div class="gdm-content-col lose_contents">
                    <div v-for="p in uploadModalGameDetail.playerStats" :key="'up-lose-' + p.seat + p.name">
                      {{ uploadModalGameDetail.hasRoundDetails ? p.cntLose : '-' }}
                    </div>
                  </div>
                </div>
              </div>

              <!-- 2) 점수 변동 그래프 뷰 -->
              <div v-show="uploadModalGameViewMode === 'chart'">
                <div
                  class="gdm-chart-box clickable-view upload-modal-chart-box"
                  @click="uploadModalGameViewMode = 'sheet'"
                  title="클릭 시 결과 표로 전환"
                >
                  <LineChart
                    v-if="uploadModalGameDetail.chartData && uploadModalGameDetail.chartData.datasets.length > 0"
                    :key="`up-line-chart-${uploadModalGameDetail.gameId}-${uploadModalGameDetail.gameIndex}-${isDark ? 'dark' : 'light'}`"
                    :data="uploadModalGameDetail.chartData"
                    :options="uploadModalChartOptions"
                  />
                  <div v-else class="gdm-empty-chart">
                    점수 변동 그래프 데이터가 없습니다.
                  </div>
                </div>
              </div>
            </div>

            <!-- 국 선택 (점수 변동 그래프 기반 실제 진행 국/본장 선택) -->
            <div class="form-group">
              <label class="form-label">국 (선택)</label>
              <select v-model="uploadForm.roundName" class="form-select" :disabled="!uploadForm.sessionName || uploadForm.gameIndex === undefined">
                <option value="">선택 안 함</option>
                <option v-for="rl in uploadCandidateRounds" :key="`up-r-${rl}`" :value="rl">
                  {{ getUploadRoundOptionLabel(rl) }}
                </option>
              </select>

              <!-- 선택한 국의 4인 점수 이동 내역 표시 -->
              <div v-if="uploadForm.roundName && selectedUploadRoundMovements.length > 0" class="upload-round-movements-box">
                <div
                  v-for="(rm, rmIdx) in selectedUploadRoundMovements"
                  :key="`urm-${rm.roundIndex}-${rmIdx}`"
                  class="upload-round-movement-card"
                >
                  <div class="urm-header">
                    <div class="urm-title-group">
                      <span class="urm-title">{{ formatCardRoundKorean(rm.roundName) }} 점수 이동 내역</span>
                      <span
                        v-if="isRoundYakuman(rm, uploadModalGameDetail, uploadForm.sessionName)"
                        class="urm-yakuman-badge"
                      >역만</span>
                    </div>
                    <span v-if="formatRoundStatusLabel(rm.roundStatus)" class="urm-status-badge">
                      {{ formatRoundStatusLabel(rm.roundStatus) }}
                    </span>
                  </div>
                  <div class="urm-players-grid">
                    <div
                      v-for="pm in rm.players"
                      :key="`urm-p-${rm.roundIndex}-${pm.name}`"
                      class="urm-player-row"
                      :class="{ 'is-win': pm.isWin, 'is-lose': pm.isLose }"
                    >
                      <div class="urm-player-left">
                        <span class="urm-seat" :class="{ 'is-east': pm.seat === '東' }">{{ pm.seat }}</span>
                        <span class="urm-name">{{ pm.name }}</span>
                        <span
                          v-if="isRoundPlayerYakuman(rm, pm, uploadModalGameDetail, uploadForm.sessionName)"
                          class="urm-tag yakuman"
                        >역만</span>
                        <span v-if="pm.isRiichi" class="urm-tag riichi">리치</span>
                        <span v-if="pm.isWin" class="urm-tag win">
                          {{ formatRoundStatusLabel(rm.roundStatus) === '쯔모' ? '쯔모' : '론' }}
                        </span>
                        <span v-if="pm.isLose" class="urm-tag lose">방총</span>
                      </div>
                      <div class="urm-player-right">
                        <span class="urm-score-flow">{{ pm.scoreBefore.toLocaleString() }} → {{ pm.scoreAfter.toLocaleString() }}</span>
                        <span
                          class="urm-score-delta"
                          :class="pm.deltaScore > 0 ? 'pos' : pm.deltaScore < 0 ? 'neg' : 'zero'"
                        >
                          ({{ pm.deltaScore > 0 ? '+' : '' }}{{ pm.deltaScore.toLocaleString() }})
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 해당 회차 참여 인원 중에서 선택 (인원 미선택 업로드도 가능) -->
            <div v-if="uploadForm.category === 'yakuman' || uploadForm.category === 'fun'" class="form-row-2">
              <div class="form-group">
                <label class="form-label">화료자 / 인원 (선택)</label>
                <select v-model="uploadForm.winnerName" class="form-select">
                  <option value="">선택 안 함</option>
                  <option v-for="pName in uploadCandidatePlayers" :key="`up-w-${pName}`" :value="pName">
                    {{ pName }}
                  </option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">화료 방식</label>
                <select v-model="uploadForm.winType" class="form-select">
                  <option value="tsumo">쯔모 화료</option>
                  <option value="ron">론 화료 (방총자 지정)</option>
                </select>
              </div>
            </div>
            <div v-else class="form-group">
              <label class="form-label">인원 (선택)</label>
              <select v-model="uploadForm.winnerName" class="form-select">
                <option value="">선택 안 함</option>
                <option v-for="pName in uploadCandidatePlayers" :key="`up-ws-${pName}`" :value="pName">
                  {{ pName }}
                </option>
              </select>
            </div>

            <div v-if="(uploadForm.category === 'yakuman' || uploadForm.category === 'fun') && uploadForm.winType === 'ron'" class="form-group">
              <label class="form-label">방총자 (선택)</label>
              <select v-model="uploadForm.loserName" class="form-select">
                <option value="">선택 안 함</option>
                <option v-for="pName in uploadCandidatePlayers" :key="`up-l-${pName}`" :value="pName">
                  {{ pName }}
                </option>
              </select>
            </div>

            <!-- 역만 종류 17종 다중 선택 -->
            <div v-if="uploadForm.category === 'yakuman'" class="form-group">
              <label class="form-label">달성 역만 선택 (복수 선택 가능)</label>
              <div class="yakuman-chips-selector">
                <button
                  v-for="yDef in YAKUMAN_DEFINITIONS"
                  :key="`sel-yk-${yDef.key}`"
                  type="button"
                  class="yakuman-select-chip"
                  :class="{ selected: uploadForm.yakumanTypes.includes(yDef.key) }"
                  @click="toggleYakumanTypeInForm(yDef.key)"
                >
                  {{ yDef.label }}
                </button>
              </div>
            </div>

            <!-- 나니키루 판단 주제 뱃지 태그 선택 (9종, 복수 선택 가능) -->
            <div v-if="uploadForm.category === 'nanikiru'" class="form-group">
              <label class="form-label">나니키루 뱃지 태그 (선택, 복수 선택 가능)</label>
              <div class="yakuman-chips-selector">
                <button
                  v-for="nTag in NANIKIRU_TAG_DEFINITIONS"
                  :key="`sel-nt-${nTag}`"
                  type="button"
                  class="yakuman-select-chip nanikiru-chip"
                  :class="{ selected: uploadForm.yakumanTypes.includes(nTag) }"
                  @click="toggleYakumanTypeInForm(nTag)"
                >
                  {{ nTag }}
                </button>
              </div>
            </div>

            <!-- 사진 업로드 -->
            <div class="form-group">
              <label class="form-label">
                {{ editingHighlightRecord ? (isGalleryAdmin ? '사진 교체 / 첨부' : '등록된 사진') : '사진 첨부' }}
                {{ !editingHighlightRecord && (uploadForm.category === 'session' || uploadForm.category === 'nanikiru') ? '*' : (!editingHighlightRecord ? '(선택)' : '') }}
              </label>
              <template v-if="!editingHighlightRecord || isGalleryAdmin">
                <input 
                  ref="highlightFileInputRef"
                  type="file" 
                  accept="image/*" 
                  class="form-file-input"
                  @change="handleHighlightFileSelect"
                />
                <div v-if="selectedUploadPreviewUrl" class="upload-preview-box">
                  <img :src="selectedUploadPreviewUrl" alt="미리보기" class="upload-preview-img" />
                  <button 
                    type="button" 
                    class="btn-remove-preview" 
                    @click="handleRemoveUploadPreview"
                  >
                    사진 제거
                  </button>
                </div>
              </template>
              <template v-else>
                <div class="photo-edit-locked-notice">
                  등록된 사진의 변경 및 삭제는 관리자만 가능합니다.
                </div>
                <div v-if="selectedUploadPreviewUrl" class="upload-preview-box">
                  <img :src="selectedUploadPreviewUrl" alt="미리보기" class="upload-preview-img" />
                </div>
              </template>
            </div>

            <!-- 멀티라인 메모 -->
            <div class="form-group">
              <label class="form-label">메모 / 설명 (선택, 최대 500자)</label>
              <textarea 
                v-model="uploadForm.caption" 
                rows="3"
                class="form-textarea" 
                placeholder=""
                maxlength="500"
              ></textarea>
            </div>

            <!-- 공통 PIN 입력 (관리자가 아니고 저장된 PIN도 없을 때만 노출) -->
            <div v-if="needsPinInput" class="form-group">
              <label class="form-label">공통 업로드 PIN * <span class="sub-hint">(한 번 입력하면 이 기기에 자동 저장됩니다)</span></label>
              <input 
                v-model="uploadForm.uploadPin" 
                type="password" 
                class="form-input" 
                placeholder="공통 PIN 번호를 입력하세요"
                autocomplete="off"
              />
            </div>
            <div v-else class="pin-auto-status-bar">
              <span v-if="isGalleryAdmin" class="pin-auto-badge">관리자 권한으로 PIN 입력 없이 즉시 처리됩니다</span>
              <template v-else>
                <span class="pin-auto-badge">이전에 입력한 공통 PIN이 자동 적용됩니다</span>
                <button type="button" class="btn-reset-saved-pin" @click="clearHighlightPin(); hasSavedValidPin = false; uploadForm.uploadPin = ''">PIN 다시 입력</button>
              </template>
            </div>

            <div v-if="highlightUploadError" class="upload-error-msg">{{ highlightUploadError }}</div>
          </div>
          <div class="highlight-modal-footer">
            <button type="button" class="btn-cancel-modal" @click="closeHighlightUploadModal">취소</button>
            <button 
              type="button" 
              class="btn-submit-modal" 
              :disabled="isSubmittingHighlight"
              @click="submitHighlightUpload"
            >
              {{ isSubmittingHighlight ? (editingHighlightRecord ? '수정 중...' : '업로드 중...') : (editingHighlightRecord ? '수정 저장' : '등록하기') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ============================================== -->
    <!-- 사진 원본 라이트박스, 메모 수정, 댓글 및 삭제 모달 -->
    <!-- ============================================== -->
    <Transition name="modal-fade">
      <div 
        v-if="lightboxHighlight" 
        class="modal-overlay lightbox-overlay" 
        v-backdrop-dismiss="() => { lightboxHighlight = null }"
      >
        <div class="lightbox-modal-card" @click="closeEmotePickers">
          <div class="lightbox-header">
            <div class="lightbox-title-meta">
              <span
                v-if="lightboxHighlight.sessionName"
                class="badge-session clickable-lb-badge"
                title="클릭하여 해당 회차 정보 보기"
                @click="openSessionPopupFromLightbox(lightboxHighlight)"
              >{{ lightboxHighlight.sessionName }}</span>
              <span
                v-if="lightboxHighlight.gameIndex"
                class="badge-game clickable-lb-badge"
                title="클릭하여 해당 경기 결과 보기"
                @click="openGamePopupFromLightbox(lightboxHighlight, 'sheet')"
              >{{ lightboxHighlight.gameIndex }}경기</span>
              <span
                v-if="lightboxHighlight.roundName"
                class="badge-round clickable-lb-badge"
                title="클릭하여 해당 국 점수 이동 내역 보기"
                @click="openGamePopupFromLightbox(lightboxHighlight, 'rounds')"
              >{{ formatCardRoundKorean(lightboxHighlight.roundName) }}</span>
              <template v-if="lightboxHighlight.category === 'yakuman'">
                <span v-for="yk in lightboxHighlight.yakumanTypes" :key="yk" class="badge-yakuman">
                  {{ yk }}
                </span>
              </template>
              <span v-else-if="lightboxHighlight.category === 'fun'" class="badge-fun">그 외 화료</span>
              <template v-else-if="lightboxHighlight.category === 'nanikiru'">
                <span class="badge-nanikiru">나니키루</span>
                <span v-for="ntag in lightboxHighlight.yakumanTypes" :key="`lb-nt-${ntag}`" class="badge-nanikiru-tag">
                  {{ ntag }}
                </span>
              </template>
              <span v-else class="badge-session-photo">기타 사진</span>
            </div>
            <div class="lightbox-header-right">
              <button
                type="button"
                class="btn-share-highlight-header"
                title="이 사진의 공유 링크 복사"
                @click.stop="copyHighlightShareLink(lightboxHighlight)"
              >
                <svg class="share-link-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                </svg>
                <span>공유</span>
              </button>
              <button class="btn-close" @click="lightboxHighlight = null" title="닫기">✕</button>
            </div>
          </div>

          <div
            ref="lightboxScrollAreaRef"
            class="lightbox-scroll-area"
            @scroll.passive="updateLightboxFloatingBtnState"
          >
            <div
              v-if="lightboxHighlight.hasImage && lightboxHighlight.imageId"
              class="lightbox-img-container"
              :class="{ 'is-loaded': isLightboxImageLoaded }"
              title="클릭하여 고화질 원본 크게 보기"
              @click.stop="openFullImageZoom"
            >
              <img
                :src="getDisplayHighlightImageSrc(lightboxHighlight.imageId)"
                class="lightbox-full-img"
                :class="{ 'is-loaded': isLightboxImageLoaded }"
                alt="사진"
                loading="eager"
                fetchpriority="high"
                decoding="sync"
                @load="handleLightboxImageLoad"
                @error="handleLightboxImageLoad"
              />
            </div>

            <div class="lightbox-info-footer">
              <div class="lightbox-details">
                <!-- 상단 대국자 정보 및 수정/삭제 컨트롤 바 (100% 폭 고정) -->
                <div class="lightbox-meta-action-row">
                  <div v-if="lightboxHighlight.winnerName" class="lightbox-players">
                    {{ lightboxHighlight.category === 'session' || lightboxHighlight.category === 'nanikiru' ? '인원:' : '화료:' }}
                    <button
                      type="button"
                      class="hl-player-link strong"
                      @click.stop="openPlayerByName(lightboxHighlight.winnerName, Boolean(lightboxHighlight.sessionName), false, true, lightboxHighlight.sessionName)"
                      title="클릭하여 대국자 스탯 보기"
                    >{{ lightboxHighlight.winnerName }}</button>
                    <span v-if="lightboxHighlight.winType && lightboxHighlight.category !== 'session' && lightboxHighlight.category !== 'nanikiru'">
                      ({{ lightboxHighlight.winType === 'tsumo' ? '쯔모' : '론' }}<template v-if="lightboxHighlight.winType === 'ron' && lightboxHighlight.loserName"> ← <button
                        type="button"
                        class="hl-player-link"
                        @click.stop="openPlayerByName(lightboxHighlight.loserName, Boolean(lightboxHighlight.sessionName), false, true, lightboxHighlight.sessionName)"
                        title="클릭하여 방총자 스탯 보기"
                      >{{ lightboxHighlight.loserName }}</button></template>)
                    </span>
                  </div>
                  <div v-else class="lightbox-players-spacer"></div>

                  <div class="lightbox-delete-zone">
                    <button
                      type="button"
                      class="btn-share-highlight"
                      title="이 사진의 공유 링크 복사"
                      @click="copyHighlightShareLink(lightboxHighlight)"
                    >
                      <svg class="share-link-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                      </svg>
                      <span>링크 공유</span>
                    </button>
                    <button
                      type="button"
                      class="btn-edit-highlight"
                      @click="openEditHighlightModal(lightboxHighlight)"
                    >
                      {{ isGalleryAdmin ? '기록 / 사진 수정' : '기록 정보 수정' }}
                    </button>
                    <button 
                      v-if="isGalleryAdmin"
                      class="btn-delete-highlight" 
                      :disabled="isDeletingHighlight"
                      @click="confirmDeleteHighlight(lightboxHighlight)"
                    >
                      {{ isDeletingHighlight ? '삭제 중...' : '기록 삭제' }}
                    </button>
                  </div>
                </div>
                <div v-if="deleteHighlightError" class="upload-error-msg">{{ deleteHighlightError }}</div>

                <!-- 메모 표시 및 수정 영역 -->
                <div class="lightbox-memo-section">
                  <template v-if="!isEditingLightboxMemo">
                    <div class="lightbox-memo-header">
                      <span class="lightbox-memo-label">메모</span>
                      <button type="button" class="btn-edit-memo" @click="startEditLightboxMemo">
                        {{ lightboxHighlight.caption ? '메모 수정' : '+ 메모 추가' }}
                      </button>
                    </div>
                    <div v-if="lightboxHighlight.caption" class="lightbox-note rich-mahjong-content">
                      <template v-for="(seg, sIdx) in parseRichMahjongText(lightboxHighlight.caption)" :key="`lb-memo-seg-${sIdx}`">
                        <span v-if="seg.type === 'text'">{{ seg.text }}</span>
                        <span v-else-if="seg.type === 'meld-group'" class="mj-hand" :title="seg.rawNotation">
                          <span
                            v-for="(blk, bIdx) in seg.blocks"
                            :key="`lb-memo-blk-${sIdx}-${bIdx}`"
                            class="mj-meld-block"
                            :class="{ 'is-draw-block': blk.isDraw }"
                          >
                            <template v-for="(item, iIdx) in blk.items" :key="`lb-memo-it-${sIdx}-${bIdx}-${iIdx}`">
                              <span v-if="item.mode === 'side'" class="mj-side-wrap" :title="item.tile.label">
                                <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" loading="eager" decoding="sync" />
                              </span>
                              <span v-else-if="item.mode === 'kakan'" class="mj-kakan-wrap" :title="`${item.tile.label} 가깡`">
                                <span class="mj-side-wrap">
                                  <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" loading="eager" decoding="sync" />
                                </span>
                                <span class="mj-side-wrap">
                                  <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" loading="eager" decoding="sync" />
                                </span>
                              </span>
                              <span v-else class="mj-upright-wrap" :title="item.tile.label">
                                <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" loading="eager" decoding="sync" />
                              </span>
                            </template>
                          </span>
                        </span>
                        <span v-else-if="seg.type === 'tile'" class="inline-mahjong-tile" :title="seg.tile.label">
                          <img :src="getMahjongTileImageUrl(seg.tile.fileName)" :alt="seg.tile.label" loading="eager" decoding="sync" />
                        </span>
                        <span v-else-if="seg.type === 'action'" class="inline-mahjong-action" :class="seg.action.colorClass">
                          {{ seg.action.label }}
                        </span>
                      </template>
                    </div>
                    <div v-else class="lightbox-note-empty">등록된 메모가 없습니다.</div>
                  </template>

                  <div v-else class="lightbox-memo-editor">
                    <textarea
                      v-model="editingMemoText"
                      rows="3"
                      maxlength="500"
                      class="form-textarea"
                      placeholder=""
                    ></textarea>
                    <div class="lightbox-memo-editor-actions">
                      <input
                        v-if="needsPinInput"
                        v-model="editingMemoPin"
                        type="password"
                        class="delete-pin-input"
                        placeholder="공통 PIN 입력"
                      />
                      <button
                        type="button"
                        class="btn-cancel-modal"
                        @click="isEditingLightboxMemo = false"
                      >
                        취소
                      </button>
                      <button
                        type="button"
                        class="btn-submit-modal"
                        :disabled="isSavingLightboxMemo"
                        @click="saveLightboxMemo"
                      >
                        {{ isSavingLightboxMemo ? '저장 중...' : '메모 저장' }}
                      </button>
                    </div>
                    <div v-if="memoEditError" class="upload-error-msg">{{ memoEditError }}</div>
                  </div>
                </div>

                <!-- ============================================== -->
                <!-- 사진 댓글 영역 -->
                <!-- ============================================== -->
                <div ref="lightboxCommentsSectionRef" class="lightbox-comments-section">
                  <div class="lb-comments-header">
                    <div class="lb-comments-title-wrap">
                      <span class="lb-comments-title">댓글</span>
                      <span class="lb-comments-count">{{ lightboxComments.length }}</span>
                    </div>
                  </div>

                <!-- 댓글 목록 (대댓글 트리 정렬) -->
                <div
                  v-if="threadedLightboxComments.length > 0"
                  class="lb-comments-list"
                  :class="{ 'has-active-form': Boolean(replyingToComment || editingCommentId || deletingCommentId) }"
                >
                  <div
                    v-for="cmt in threadedLightboxComments"
                    :key="cmt.id"
                    :class="{ 'is-reply': cmt.isReply }"
                    class="lb-comment-item"
                  >
                    <div class="lb-comment-top">
                      <div class="lb-comment-author-box">
                        <span v-if="cmt.isReply" class="lb-reply-prefix" title="답글">↳</span>
                        <button
                          v-if="isKnownPlayerName(cmt.authorName)"
                          type="button"
                          class="lb-comment-author is-clickable"
                          @click.stop="openPlayerByName(cmt.authorName, false, false, true)"
                          title="클릭하여 대국자 스탯 보기"
                        >{{ cmt.authorName }}</button>
                        <strong v-else class="lb-comment-author">{{ cmt.authorName }}</strong>
                        <span v-if="!cmt.isLoggedInUser" class="lb-comment-guest-badge" title="유동 닉네임">유동</span>
                        <span v-if="cmt.replyToAuthor" class="lb-reply-target-badge">
                          @{{ cmt.replyToAuthor }}
                        </span>
                        <span v-if="cmt.isOrphanReply" class="lb-orphan-reply-badge">
                          삭제된 댓글의 답글
                        </span>
                        <span class="lb-comment-time">
                          {{ formatCommentTime(cmt.createdAt) }}
                          <template v-if="cmt.updatedAt"> (수정됨)</template>
                        </span>
                      </div>
                      <div class="lb-comment-actions">
                        <button
                          type="button"
                          class="btn-cmt-act reply"
                          :class="{ active: replyingToComment?.id === cmt.id }"
                          @click="startReplyComment(cmt)"
                        >답글</button>
                        <button
                          type="button"
                          class="btn-cmt-act"
                          @click="startEditComment(cmt)"
                        >수정</button>
                        <button
                          type="button"
                          class="btn-cmt-act del"
                          @click="startDeleteComment(cmt)"
                        >삭제</button>
                      </div>
                    </div>

                    <!-- 일반 댓글 본문 -->
                    <div v-if="editingCommentId !== cmt.id" class="lb-comment-body rich-mahjong-content">
                      <template v-for="(seg, sIdx) in parseRichMahjongText(cmt.content)" :key="`cmt-${cmt.id}-seg-${sIdx}`">
                        <span v-if="seg.type === 'text'">{{ seg.text }}</span>
                        <span v-else-if="seg.type === 'meld-group'" class="mj-hand" :title="seg.rawNotation">
                          <span
                            v-for="(blk, bIdx) in seg.blocks"
                            :key="`cmt-${cmt.id}-blk-${sIdx}-${bIdx}`"
                            class="mj-meld-block"
                            :class="{ 'is-draw-block': blk.isDraw }"
                          >
                            <template v-for="(item, iIdx) in blk.items" :key="`cmt-${cmt.id}-it-${sIdx}-${bIdx}-${iIdx}`">
                              <span v-if="item.mode === 'side'" class="mj-side-wrap" :title="item.tile.label">
                                <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" loading="eager" decoding="sync" />
                              </span>
                              <span v-else-if="item.mode === 'kakan'" class="mj-kakan-wrap" :title="`${item.tile.label} 가깡`">
                                <span class="mj-side-wrap">
                                  <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" loading="eager" decoding="sync" />
                                </span>
                                <span class="mj-side-wrap">
                                  <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" loading="eager" decoding="sync" />
                                </span>
                              </span>
                              <span v-else class="mj-upright-wrap" :title="item.tile.label">
                                <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" loading="eager" decoding="sync" />
                              </span>
                            </template>
                          </span>
                        </span>
                        <span v-else-if="seg.type === 'tile'" class="inline-mahjong-tile" :title="seg.tile.label">
                          <img :src="getMahjongTileImageUrl(seg.tile.fileName)" :alt="seg.tile.label" loading="eager" decoding="sync" />
                        </span>
                        <span v-else-if="seg.type === 'action'" class="inline-mahjong-action" :class="seg.action.colorClass">
                          {{ seg.action.label }}
                        </span>
                      </template>
                    </div>

                    <!-- 댓글 수정 인라인 폼 -->
                    <div v-else class="lb-comment-edit-box" @click.stop>
                      <textarea
                        v-model="editingCommentContent"
                        rows="2"
                        maxlength="400"
                        class="form-textarea lb-cmt-edit-textarea"
                        placeholder=""
                      ></textarea>
                      <div class="lb-cmt-edit-toolbar">
                        <div class="emote-picker-anchor">
                          <button
                            type="button"
                            class="btn-toggle-emote-picker sm"
                            :class="{ active: isEditingCommentPickerOpen }"
                            @click.stop="isEditingCommentPickerOpen = !isEditingCommentPickerOpen; isCommentEmotePickerOpen = false; isReplyEmotePickerOpen = false"
                          >
                            <img :src="getMahjongTileImageUrl('7z.png')" alt="중" class="btn-emote-chun-icon" />
                            <span>나니키루콘</span>
                          </button>

                          <!-- 댓글 수정용 플로팅 팝업 팔레트 -->
                          <div v-show="isEditingCommentPickerOpen" class="mahjong-emote-picker compact" @click.stop>
                            <div class="mep-header-bar">
                              <div class="mep-tabs">
                                <button type="button" class="mep-tab" :class="{ active: activeEmoteTab === 'man' }" @click="activeEmoteTab = 'man'">만수</button>
                                <button type="button" class="mep-tab" :class="{ active: activeEmoteTab === 'pin' }" @click="activeEmoteTab = 'pin'">통수</button>
                                <button type="button" class="mep-tab" :class="{ active: activeEmoteTab === 'sou' }" @click="activeEmoteTab = 'sou'">삭수</button>
                                <button type="button" class="mep-tab" :class="{ active: activeEmoteTab === 'honor' }" @click="activeEmoteTab = 'honor'">자패</button>
                                <button type="button" class="mep-tab" :class="{ active: activeEmoteTab === 'action' }" @click="activeEmoteTab = 'action'">액션 버튼</button>
                              </div>
                              <div class="mep-util-btns">
                                <button v-if="isContinuousEmoteMode" type="button" class="mep-util-btn space-btn" title="블록 띄우기 (공백)" @click="insertBlockSpaceFromPalette('edit')">␣</button>
                                <button type="button" class="mep-mode-toggle continuous" :class="{ active: isContinuousEmoteMode }" title="연속 입력 모드 (클릭해도 팝업이 닫히지 않고 패가 이어짐)" @click="isContinuousEmoteMode = !isContinuousEmoteMode">연속</button>
                                <button type="button" class="mep-mode-toggle furo" :class="{ active: isFuroEmoteMode }" title="후로(치/퐁/깡) 레버 입력 모드" @click="isFuroEmoteMode = !isFuroEmoteMode">후로</button>
                                <button type="button" class="mep-util-btn help" :class="{ active: showEmoteNotationHelp }" title="직접 입력 표기법 안내" @click="showEmoteNotationHelp = !showEmoteNotationHelp">?</button>
                                <button type="button" class="mep-util-btn close" title="닫기" @click="closeEmotePickers">✕</button>
                              </div>
                            </div>

                            <!-- 연속/후로 모드 시 현재 입력 상황 실시간 미니 프리뷰 바 -->
                            <div v-if="isContinuousEmoteMode || isFuroEmoteMode" class="mep-mini-preview">
                              <div class="mep-mini-preview-body rich-mahjong-content">
                                <template v-if="editingCommentContent.trim()">
                                  <template v-for="(seg, sIdx) in parseRichMahjongText(editingCommentContent)" :key="`ed-mp-seg-${sIdx}`">
                                    <span v-if="seg.type === 'text'" class="mep-mp-text">{{ seg.text }}</span>
                                    <span v-else-if="seg.type === 'meld-group'" class="mj-hand" :title="seg.rawNotation">
                                      <span
                                        v-for="(blk, bIdx) in seg.blocks"
                                        :key="`ed-mp-blk-${sIdx}-${bIdx}`"
                                        class="mj-meld-block"
                                        :class="{ 'is-draw-block': blk.isDraw }"
                                      >
                                        <template v-for="(item, iIdx) in blk.items" :key="`ed-mp-it-${sIdx}-${bIdx}-${iIdx}`">
                                          <span v-if="item.mode === 'side'" class="mj-side-wrap">
                                            <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" />
                                          </span>
                                          <span v-else-if="item.mode === 'kakan'" class="mj-kakan-wrap">
                                            <span class="mj-side-wrap">
                                              <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" />
                                            </span>
                                            <span class="mj-side-wrap">
                                              <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" />
                                            </span>
                                          </span>
                                          <span v-else class="mj-upright-wrap">
                                            <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" />
                                          </span>
                                        </template>
                                      </span>
                                    </span>
                                    <span v-else-if="seg.type === 'tile'" class="inline-mahjong-tile">
                                      <img :src="getMahjongTileImageUrl(seg.tile.fileName)" :alt="seg.tile.label" />
                                    </span>
                                    <span v-else-if="seg.type === 'action'" class="inline-mahjong-action" :class="seg.action.colorClass">
                                      {{ seg.action.label }}
                                    </span>
                                  </template>
                                </template>
                                <span v-else class="mep-mp-placeholder">패를 선택하면 현재 입력 상황이 표시됩니다</span>
                              </div>
                              <button
                                v-if="editingCommentContent.length > 0"
                                type="button"
                                class="mep-mini-backspace-btn"
                                title="마지막 입력 패/글자 지우기"
                                @click="deleteLastCommentToken('edit')"
                              >⌫</button>
                            </div>

                            <Transition name="mep-guide-slide">
                              <div v-if="showEmoteNotationHelp" class="mep-notation-guide">
                                <div class="mng-row"><span class="mng-badge">연속/복합</span> <code>[234m5m7m9m]</code> <code>[123m 456p]</code> <span class="mng-sub">(공백=블록 분리, 0=적5)</span></div>
                                <div class="mng-row"><span class="mng-badge">치 / 퐁</span> <code>[-456m]</code> <code>[-435m]</code> <code>[5-55p]</code> <span class="mng-sub">(- 붙인 패 눕힘)</span></div>
                                <div class="mng-row"><span class="mng-badge">가깡 / 안깡</span> <code>[7=77p]</code> <span class="mng-sub">(가깡 =)</span> · <code>[#8888m]</code> <span class="mng-sub">(안깡 #)</span></div>
                              </div>
                            </Transition>

                            <div v-show="activeEmoteTab === 'action'" class="mep-actions-grid">
                              <button
                                v-for="act in MAHJONG_ACTION_EMOTES"
                                :key="`ed-act-${act.key}`"
                                type="button"
                                class="mep-action-btn"
                                :class="act.colorClass"
                                @click="insertEmoteTokenToComment(act.label, 'edit')"
                              >
                                {{ act.label }}
                              </button>
                            </div>
                            <div
                              v-for="grp in TILE_EMOTE_GROUPS"
                              :key="`ed-grp-${grp.key}`"
                              v-show="activeEmoteTab === grp.key"
                              class="mep-tiles-grid"
                            >
                              <button
                                v-for="tl in grp.tiles"
                                :key="`ed-tl-${tl.code}`"
                                type="button"
                                class="mep-tile-btn"
                                :class="{ 'is-selected-base': isFuroEmoteMode && selectedPaletteTileCode === tl.code }"
                                :title="`${tl.label} (${tl.code})`"
                                @click="insertTileFromPalette(tl, 'edit')"
                              >
                                <img :src="getMahjongTileImageUrl(tl.fileName)" :alt="tl.label" loading="eager" decoding="sync" />
                                <span class="mep-tile-sub">{{ tl.label }}</span>
                              </button>
                            </div>

                            <!-- 모던 후로 레버 독 (Furo Lever Dock) -->
                            <div v-show="isFuroEmoteMode && activeEmoteTab !== 'action'" class="mep-furo-dock">
                              <div class="mep-base-tile-chip" :class="{ 'is-popping': isBaseTilePopping }" title="아래 패를 클릭하면 기준 패가 변경됩니다">
                                <img :src="getMahjongTileImageUrl(selectedPaletteTileDef.fileName)" :alt="selectedPaletteTileDef.label" class="mep-base-tile-img" />
                                <div class="mep-base-tile-meta">
                                  <span class="mep-base-sub">기준 패</span>
                                  <strong class="mep-base-name">{{ selectedPaletteTileDef.label }}</strong>
                                </div>
                              </div>
                              <div class="mep-lever-group">
                                <span class="mep-lever-hint">레버를 누른 채 4방향 드래그</span>
                                <div class="mep-lever-pills">
                                  <button
                                    type="button"
                                    class="mep-lever-btn lever-chi"
                                    title="누른 채 좌/상/우로 드래그하여 치 입력"
                                    @pointerdown="startFuroLeverDrag($event, 'chi', 'edit')"
                                  >
                                    <span class="lever-joy-icon"><span class="lever-joy-dot"></span></span>
                                    <span>치</span>
                                  </button>
                                  <button
                                    type="button"
                                    class="mep-lever-btn lever-pon"
                                    title="누른 채 좌/상/우로 드래그하여 퐁 입력"
                                    @pointerdown="startFuroLeverDrag($event, 'pon', 'edit')"
                                  >
                                    <span class="lever-joy-icon"><span class="lever-joy-dot"></span></span>
                                    <span>퐁</span>
                                  </button>
                                  <button
                                    type="button"
                                    class="mep-lever-btn lever-kan"
                                    title="누른 채 좌/상/우(가깡) 또는 아래(안깡)로 드래그"
                                    @pointerdown="startFuroLeverDrag($event, 'kan', 'edit')"
                                  >
                                    <span class="lever-joy-icon"><span class="lever-joy-dot"></span></span>
                                    <span>깡</span>
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div class="lb-cmt-edit-right">
                          <input
                            v-if="!canAutoAuthComment(cmt)"
                            v-model="editingCommentPin"
                            type="password"
                            class="lb-cmt-pin-input"
                            placeholder="비밀번호"
                            autocomplete="off"
                          />
                          <button type="button" class="btn-cancel-modal sm" @click="cancelEditComment">취소</button>
                          <button
                            type="button"
                            class="btn-submit-modal sm"
                            :disabled="isProcessingCommentAction"
                            @click="confirmUpdateComment(cmt)"
                          >저장</button>
                        </div>
                      </div>

                      <div
                        v-if="editingCommentContent.includes('[') && editingCommentContent.includes(']')"
                        class="lb-cf-live-preview"
                      >
                        <span class="lb-cf-preview-label">미리보기</span>
                        <div class="lb-cf-preview-body rich-mahjong-content">
                          <template v-for="(seg, sIdx) in parseRichMahjongText(editingCommentContent)" :key="`ed-prev-seg-${sIdx}`">
                            <span v-if="seg.type === 'text'">{{ seg.text }}</span>
                            <span v-else-if="seg.type === 'meld-group'" class="mj-hand" :title="seg.rawNotation">
                              <span
                                v-for="(blk, bIdx) in seg.blocks"
                                :key="`ed-prev-blk-${sIdx}-${bIdx}`"
                                class="mj-meld-block"
                                :class="{ 'is-draw-block': blk.isDraw }"
                              >
                                <template v-for="(item, iIdx) in blk.items" :key="`ed-prev-it-${sIdx}-${bIdx}-${iIdx}`">
                                  <span v-if="item.mode === 'side'" class="mj-side-wrap" :title="item.tile.label">
                                    <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" loading="eager" decoding="sync" />
                                  </span>
                                  <span v-else-if="item.mode === 'kakan'" class="mj-kakan-wrap" :title="`${item.tile.label} 가깡`">
                                    <span class="mj-side-wrap">
                                      <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" loading="eager" decoding="sync" />
                                    </span>
                                    <span class="mj-side-wrap">
                                      <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" loading="eager" decoding="sync" />
                                    </span>
                                  </span>
                                  <span v-else class="mj-upright-wrap" :title="item.tile.label">
                                    <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" loading="eager" decoding="sync" />
                                  </span>
                                </template>
                              </span>
                            </span>
                            <span v-else-if="seg.type === 'tile'" class="inline-mahjong-tile" :title="seg.tile.label">
                              <img :src="getMahjongTileImageUrl(seg.tile.fileName)" :alt="seg.tile.label" loading="eager" decoding="sync" />
                            </span>
                            <span v-else-if="seg.type === 'action'" class="inline-mahjong-action" :class="seg.action.colorClass">
                              {{ seg.action.label }}
                            </span>
                          </template>
                        </div>
                      </div>

                      <div v-if="commentActionError && editingCommentId === cmt.id" class="upload-error-msg">{{ commentActionError }}</div>
                    </div>

                    <!-- 댓글 삭제 비밀번호 확인 인라인 폼 (유동 댓글 등) -->
                    <div v-if="deletingCommentId === cmt.id" class="lb-comment-delete-box">
                      <span class="lb-del-prompt">비밀번호:</span>
                      <input
                        v-model="deletingCommentPin"
                        type="password"
                        class="lb-cmt-pin-input"
                        placeholder="비밀번호"
                        autocomplete="off"
                        @keyup.enter="confirmDeleteComment(cmt)"
                      />
                      <button
                        class="btn-delete-highlight sm"
                        :disabled="isProcessingCommentAction"
                        @click="confirmDeleteComment(cmt)"
                      >삭제 확인</button>
                      <button
                        type="button"
                        class="btn-cancel-modal sm"
                        @click="deletingCommentId = null; commentActionError = ''"
                      >취소</button>
                      <div v-if="commentActionError && deletingCommentId === cmt.id" class="upload-error-msg">{{ commentActionError }}</div>
                    </div>

                    <!-- 대댓글(답글) 작성 인라인 폼 -->
                    <div v-if="replyingToComment?.id === cmt.id" class="lb-reply-form-box" @click.stop>
                      <div class="lb-reply-form-header">
                        <span class="lb-reply-form-target">
                          <strong>↳ {{ cmt.authorName }}</strong>님에게 답글 작성
                        </span>
                        <div class="lb-cf-author-row compact">
                          <template v-if="isUsingScheduleIdentity">
                            <div class="lb-cf-logged-in">
                              <span class="lb-cf-logged-badge">로그인</span>
                              <strong class="lb-cf-logged-name">{{ scheduleLoggedInName }}</strong>
                            </div>
                            <button type="button" class="btn-switch-guest-mode" @click="toggleGuestCommentMode">
                              유동 전환
                            </button>
                          </template>
                          <template v-else>
                            <div class="lb-cf-guest-inputs">
                              <input
                                v-model="commentNicknameInput"
                                type="text"
                                maxlength="24"
                                class="lb-cf-input nick"
                                placeholder="닉네임"
                              />
                              <input
                                v-model="commentPinInput"
                                type="password"
                                maxlength="20"
                                class="lb-cf-input pin"
                                placeholder="비밀번호"
                                autocomplete="off"
                              />
                            </div>
                            <button
                              v-if="scheduleLoggedInName"
                              type="button"
                              class="btn-switch-guest-mode"
                              @click="toggleGuestCommentMode"
                            >
                              로그인 전환
                            </button>
                          </template>
                        </div>
                      </div>

                      <textarea
                        v-model="replyContentInput"
                        rows="2"
                        maxlength="400"
                        class="form-textarea lb-cmt-edit-textarea"
                        placeholder=""
                        @keydown.ctrl.enter.prevent="submitReplyHighlightComment(cmt)"
                      ></textarea>

                      <div class="lb-cmt-edit-toolbar">
                        <div class="emote-picker-anchor">
                          <button
                            type="button"
                            class="btn-toggle-emote-picker sm"
                            :class="{ active: isReplyEmotePickerOpen }"
                            @click.stop="isReplyEmotePickerOpen = !isReplyEmotePickerOpen; isCommentEmotePickerOpen = false; isEditingCommentPickerOpen = false"
                          >
                            <img :src="getMahjongTileImageUrl('7z.png')" alt="중" class="btn-emote-chun-icon" />
                            <span>나니키루콘</span>
                          </button>

                          <div v-show="isReplyEmotePickerOpen" class="mahjong-emote-picker compact" @click.stop>
                            <div class="mep-header-bar">
                              <div class="mep-tabs">
                                <button type="button" class="mep-tab" :class="{ active: activeEmoteTab === 'man' }" @click="activeEmoteTab = 'man'">만수</button>
                                <button type="button" class="mep-tab" :class="{ active: activeEmoteTab === 'pin' }" @click="activeEmoteTab = 'pin'">통수</button>
                                <button type="button" class="mep-tab" :class="{ active: activeEmoteTab === 'sou' }" @click="activeEmoteTab = 'sou'">삭수</button>
                                <button type="button" class="mep-tab" :class="{ active: activeEmoteTab === 'honor' }" @click="activeEmoteTab = 'honor'">자패</button>
                                <button type="button" class="mep-tab" :class="{ active: activeEmoteTab === 'action' }" @click="activeEmoteTab = 'action'">액션 버튼</button>
                              </div>
                              <div class="mep-util-btns">
                                <button v-if="isContinuousEmoteMode" type="button" class="mep-util-btn space-btn" title="블록 띄우기 (공백)" @click="insertBlockSpaceFromPalette('reply')">␣</button>
                                <button type="button" class="mep-mode-toggle continuous" :class="{ active: isContinuousEmoteMode }" title="연속 입력 모드 (클릭해도 팝업이 닫히지 않고 패가 이어짐)" @click="isContinuousEmoteMode = !isContinuousEmoteMode">연속</button>
                                <button type="button" class="mep-mode-toggle furo" :class="{ active: isFuroEmoteMode }" title="후로(치/퐁/깡) 레버 입력 모드" @click="isFuroEmoteMode = !isFuroEmoteMode">후로</button>
                                <button type="button" class="mep-util-btn help" :class="{ active: showEmoteNotationHelp }" title="직접 입력 표기법 안내" @click="showEmoteNotationHelp = !showEmoteNotationHelp">?</button>
                                <button type="button" class="mep-util-btn close" title="닫기" @click="closeEmotePickers">✕</button>
                              </div>
                            </div>

                            <!-- 연속/후로 모드 시 현재 입력 상황 실시간 미니 프리뷰 바 -->
                            <div v-if="isContinuousEmoteMode || isFuroEmoteMode" class="mep-mini-preview">
                              <div class="mep-mini-preview-body rich-mahjong-content">
                                <template v-if="replyContentInput.trim()">
                                  <template v-for="(seg, sIdx) in parseRichMahjongText(replyContentInput)" :key="`rep-mp-seg-${sIdx}`">
                                    <span v-if="seg.type === 'text'" class="mep-mp-text">{{ seg.text }}</span>
                                    <span v-else-if="seg.type === 'meld-group'" class="mj-hand" :title="seg.rawNotation">
                                      <span
                                        v-for="(blk, bIdx) in seg.blocks"
                                        :key="`rep-mp-blk-${sIdx}-${bIdx}`"
                                        class="mj-meld-block"
                                        :class="{ 'is-draw-block': blk.isDraw }"
                                      >
                                        <template v-for="(item, iIdx) in blk.items" :key="`rep-mp-it-${sIdx}-${bIdx}-${iIdx}`">
                                          <span v-if="item.mode === 'side'" class="mj-side-wrap">
                                            <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" />
                                          </span>
                                          <span v-else-if="item.mode === 'kakan'" class="mj-kakan-wrap">
                                            <span class="mj-side-wrap">
                                              <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" />
                                            </span>
                                            <span class="mj-side-wrap">
                                              <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" />
                                            </span>
                                          </span>
                                          <span v-else class="mj-upright-wrap">
                                            <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" />
                                          </span>
                                        </template>
                                      </span>
                                    </span>
                                    <span v-else-if="seg.type === 'tile'" class="inline-mahjong-tile">
                                      <img :src="getMahjongTileImageUrl(seg.tile.fileName)" :alt="seg.tile.label" />
                                    </span>
                                    <span v-else-if="seg.type === 'action'" class="inline-mahjong-action" :class="seg.action.colorClass">
                                      {{ seg.action.label }}
                                    </span>
                                  </template>
                                </template>
                                <span v-else class="mep-mp-placeholder">패를 선택하면 현재 입력 상황이 표시됩니다</span>
                              </div>
                              <button
                                v-if="replyContentInput.length > 0"
                                type="button"
                                class="mep-mini-backspace-btn"
                                title="마지막 입력 패/글자 지우기"
                                @click="deleteLastCommentToken('reply')"
                              >⌫</button>
                            </div>

                            <Transition name="mep-guide-slide">
                              <div v-if="showEmoteNotationHelp" class="mep-notation-guide">
                                <div class="mng-row"><span class="mng-badge">연속/복합</span> <code>[234m5m7m9m]</code> <code>[123m 456p]</code> <span class="mng-sub">(공백=블록 분리, 0=적5)</span></div>
                                <div class="mng-row"><span class="mng-badge">치 / 퐁</span> <code>[-456m]</code> <code>[-435m]</code> <code>[5-55p]</code> <span class="mng-sub">(- 붙인 패 눕힘)</span></div>
                                <div class="mng-row"><span class="mng-badge">가깡 / 안깡</span> <code>[7=77p]</code> <span class="mng-sub">(가깡 =)</span> · <code>[#8888m]</code> <span class="mng-sub">(안깡 #)</span></div>
                              </div>
                            </Transition>

                            <div v-show="activeEmoteTab === 'action'" class="mep-actions-grid">
                              <button
                                v-for="act in MAHJONG_ACTION_EMOTES"
                                :key="`rep-act-${act.key}`"
                                type="button"
                                class="mep-action-btn"
                                :class="act.colorClass"
                                @click="insertEmoteTokenToComment(act.label, 'reply')"
                              >
                                {{ act.label }}
                              </button>
                            </div>
                            <div
                              v-for="grp in TILE_EMOTE_GROUPS"
                              :key="`rep-grp-${grp.key}`"
                              v-show="activeEmoteTab === grp.key"
                              class="mep-tiles-grid"
                            >
                              <button
                                v-for="tl in grp.tiles"
                                :key="`rep-tl-${tl.code}`"
                                type="button"
                                class="mep-tile-btn"
                                :class="{ 'is-selected-base': isFuroEmoteMode && selectedPaletteTileCode === tl.code }"
                                :title="`${tl.label} (${tl.code})`"
                                @click="insertTileFromPalette(tl, 'reply')"
                              >
                                <img :src="getMahjongTileImageUrl(tl.fileName)" :alt="tl.label" loading="eager" decoding="sync" />
                                <span class="mep-tile-sub">{{ tl.label }}</span>
                              </button>
                            </div>

                            <!-- 모던 후로 레버 독 (Furo Lever Dock) -->
                            <div v-show="isFuroEmoteMode && activeEmoteTab !== 'action'" class="mep-furo-dock">
                              <div class="mep-base-tile-chip" :class="{ 'is-popping': isBaseTilePopping }" title="아래 패를 클릭하면 기준 패가 변경됩니다">
                                <img :src="getMahjongTileImageUrl(selectedPaletteTileDef.fileName)" :alt="selectedPaletteTileDef.label" class="mep-base-tile-img" />
                                <div class="mep-base-tile-meta">
                                  <span class="mep-base-sub">기준 패</span>
                                  <strong class="mep-base-name">{{ selectedPaletteTileDef.label }}</strong>
                                </div>
                              </div>
                              <div class="mep-lever-group">
                                <span class="mep-lever-hint">레버를 누른 채 4방향 드래그</span>
                                <div class="mep-lever-pills">
                                  <button
                                    type="button"
                                    class="mep-lever-btn lever-chi"
                                    title="누른 채 좌/상/우로 드래그하여 치 입력"
                                    @pointerdown="startFuroLeverDrag($event, 'chi', 'reply')"
                                  >
                                    <span class="lever-joy-icon"><span class="lever-joy-dot"></span></span>
                                    <span>치</span>
                                  </button>
                                  <button
                                    type="button"
                                    class="mep-lever-btn lever-pon"
                                    title="누른 채 좌/상/우로 드래그하여 퐁 입력"
                                    @pointerdown="startFuroLeverDrag($event, 'pon', 'reply')"
                                  >
                                    <span class="lever-joy-icon"><span class="lever-joy-dot"></span></span>
                                    <span>퐁</span>
                                  </button>
                                  <button
                                    type="button"
                                    class="mep-lever-btn lever-kan"
                                    title="누른 채 좌/상/우(가깡) 또는 아래(안깡)로 드래그"
                                    @pointerdown="startFuroLeverDrag($event, 'kan', 'reply')"
                                  >
                                    <span class="lever-joy-icon"><span class="lever-joy-dot"></span></span>
                                    <span>깡</span>
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div class="lb-cmt-edit-right">
                          <button type="button" class="btn-cancel-modal sm" @click="cancelReplyComment">취소</button>
                          <button
                            type="button"
                            class="btn-submit-modal sm"
                            :disabled="isSubmittingReply"
                            @click="submitReplyHighlightComment(cmt)"
                          >{{ isSubmittingReply ? '등록 중...' : '답글 등록' }}</button>
                        </div>
                      </div>

                      <div
                        v-if="replyContentInput.includes('[') && replyContentInput.includes(']')"
                        class="lb-cf-live-preview"
                      >
                        <span class="lb-cf-preview-label">미리보기</span>
                        <div class="lb-cf-preview-body rich-mahjong-content">
                          <template v-for="(seg, sIdx) in parseRichMahjongText(replyContentInput)" :key="`rep-prev-seg-${sIdx}`">
                            <span v-if="seg.type === 'text'">{{ seg.text }}</span>
                            <span v-else-if="seg.type === 'meld-group'" class="mj-hand" :title="seg.rawNotation">
                              <span
                                v-for="(blk, bIdx) in seg.blocks"
                                :key="`rep-prev-blk-${sIdx}-${bIdx}`"
                                class="mj-meld-block"
                                :class="{ 'is-draw-block': blk.isDraw }"
                              >
                                <template v-for="(item, iIdx) in blk.items" :key="`rep-prev-it-${sIdx}-${bIdx}-${iIdx}`">
                                  <span v-if="item.mode === 'side'" class="mj-side-wrap" :title="item.tile.label">
                                    <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" loading="eager" decoding="sync" />
                                  </span>
                                  <span v-else-if="item.mode === 'kakan'" class="mj-kakan-wrap" :title="`${item.tile.label} 가깡`">
                                    <span class="mj-side-wrap">
                                      <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" loading="eager" decoding="sync" />
                                    </span>
                                    <span class="mj-side-wrap">
                                      <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" loading="eager" decoding="sync" />
                                    </span>
                                  </span>
                                  <span v-else class="mj-upright-wrap" :title="item.tile.label">
                                    <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" loading="eager" decoding="sync" />
                                  </span>
                                </template>
                              </span>
                            </span>
                            <span v-else-if="seg.type === 'tile'" class="inline-mahjong-tile" :title="seg.tile.label">
                              <img :src="getMahjongTileImageUrl(seg.tile.fileName)" :alt="seg.tile.label" loading="eager" decoding="sync" />
                            </span>
                            <span v-else-if="seg.type === 'action'" class="inline-mahjong-action" :class="seg.action.colorClass">
                              {{ seg.action.label }}
                            </span>
                          </template>
                        </div>
                      </div>

                      <div v-if="replyFormError && replyingToComment?.id === cmt.id" class="upload-error-msg">{{ replyFormError }}</div>
                    </div>
                  </div>
                </div>

                <!-- 새 댓글 작성 폼 -->
                <div class="lb-comment-form-card">
                  <!-- 작성자 정보 헤더 -->
                  <div class="lb-cf-author-row">
                    <template v-if="isUsingScheduleIdentity">
                      <div class="lb-cf-logged-in">
                        <span class="lb-cf-logged-badge">로그인</span>
                        <strong class="lb-cf-logged-name">{{ scheduleLoggedInName }}</strong>
                      </div>
                      <button type="button" class="btn-switch-guest-mode" @click="toggleGuestCommentMode">
                        유동 전환
                      </button>
                    </template>
                    <template v-else>
                      <div class="lb-cf-guest-inputs">
                        <input
                          v-model="commentNicknameInput"
                          type="text"
                          maxlength="24"
                          class="lb-cf-input nick"
                          placeholder="닉네임"
                        />
                        <input
                          v-model="commentPinInput"
                          type="password"
                          maxlength="20"
                          class="lb-cf-input pin"
                          placeholder="비밀번호"
                          autocomplete="off"
                        />
                      </div>
                      <button
                        v-if="scheduleLoggedInName"
                        type="button"
                        class="btn-switch-guest-mode"
                        @click="toggleGuestCommentMode"
                      >
                        로그인 전환
                      </button>
                    </template>
                  </div>

                  <!-- 댓글 입력창 -->
                  <div class="lb-cf-input-wrap">
                    <textarea
                      ref="commentTextareaRef"
                      v-model="commentContentInput"
                      rows="2"
                      maxlength="400"
                      class="form-textarea lb-cf-textarea"
                      placeholder=""
                      @keydown.ctrl.enter.prevent="submitNewHighlightComment"
                    ></textarea>
                  </div>

                  <!-- 하단 툴바: 나니키루콘 플로팅 팝업 토글 + 등록 버튼 -->
                  <div class="lb-cf-bottom-bar">
                    <div class="emote-picker-anchor">
                      <button
                        type="button"
                        class="btn-toggle-emote-picker"
                        :class="{ active: isCommentEmotePickerOpen }"
                        @click.stop="isCommentEmotePickerOpen = !isCommentEmotePickerOpen; isEditingCommentPickerOpen = false; isReplyEmotePickerOpen = false"
                      >
                        <img :src="getMahjongTileImageUrl('7z.png')" alt="중" class="btn-emote-chun-icon" />
                        <span>나니키루콘</span>
                      </button>

                      <!-- 마작패(38종) & 후로 조이스틱 레버 & 액션 버튼(8종) 플로팅 팝업 팔레트 -->
                      <div v-show="isCommentEmotePickerOpen" class="mahjong-emote-picker" @click.stop>
                        <div class="mep-header-bar">
                          <div class="mep-tabs">
                            <button
                              type="button"
                              class="mep-tab"
                              :class="{ active: activeEmoteTab === 'man' }"
                              @click="activeEmoteTab = 'man'"
                            >
                              만수
                            </button>
                            <button
                              type="button"
                              class="mep-tab"
                              :class="{ active: activeEmoteTab === 'pin' }"
                              @click="activeEmoteTab = 'pin'"
                            >
                              통수
                            </button>
                            <button
                              type="button"
                              class="mep-tab"
                              :class="{ active: activeEmoteTab === 'sou' }"
                              @click="activeEmoteTab = 'sou'"
                            >
                              삭수
                            </button>
                            <button
                              type="button"
                              class="mep-tab"
                              :class="{ active: activeEmoteTab === 'honor' }"
                              @click="activeEmoteTab = 'honor'"
                            >
                              자패
                            </button>
                            <button
                              type="button"
                              class="mep-tab"
                              :class="{ active: activeEmoteTab === 'action' }"
                              @click="activeEmoteTab = 'action'"
                            >
                              액션 버튼
                            </button>
                          </div>
                          <div class="mep-util-btns">
                            <button v-if="isContinuousEmoteMode" type="button" class="mep-util-btn space-btn" title="블록 띄우기 (공백)" @click="insertBlockSpaceFromPalette('new')">␣</button>
                            <button type="button" class="mep-mode-toggle continuous" :class="{ active: isContinuousEmoteMode }" title="연속 입력 모드 (클릭해도 팝업이 닫히지 않고 패가 이어짐)" @click="isContinuousEmoteMode = !isContinuousEmoteMode">연속</button>
                            <button type="button" class="mep-mode-toggle furo" :class="{ active: isFuroEmoteMode }" title="후로(치/퐁/깡) 레버 입력 모드" @click="isFuroEmoteMode = !isFuroEmoteMode">후로</button>
                            <button type="button" class="mep-util-btn help" :class="{ active: showEmoteNotationHelp }" title="직접 입력 표기법 안내" @click="showEmoteNotationHelp = !showEmoteNotationHelp">?</button>
                            <button type="button" class="mep-util-btn close" title="닫기" @click="closeEmotePickers">✕</button>
                          </div>
                        </div>

                        <!-- 연속/후로 모드 시 현재 입력 상황 실시간 미니 프리뷰 바 -->
                        <div v-if="isContinuousEmoteMode || isFuroEmoteMode" class="mep-mini-preview">
                          <div class="mep-mini-preview-body rich-mahjong-content">
                            <template v-if="commentContentInput.trim()">
                              <template v-for="(seg, sIdx) in parseRichMahjongText(commentContentInput)" :key="`new-mp-seg-${sIdx}`">
                                <span v-if="seg.type === 'text'" class="mep-mp-text">{{ seg.text }}</span>
                                <span v-else-if="seg.type === 'meld-group'" class="mj-hand" :title="seg.rawNotation">
                                  <span
                                    v-for="(blk, bIdx) in seg.blocks"
                                    :key="`new-mp-blk-${sIdx}-${bIdx}`"
                                    class="mj-meld-block"
                                    :class="{ 'is-draw-block': blk.isDraw }"
                                  >
                                    <template v-for="(item, iIdx) in blk.items" :key="`new-mp-it-${sIdx}-${bIdx}-${iIdx}`">
                                      <span v-if="item.mode === 'side'" class="mj-side-wrap">
                                        <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" />
                                      </span>
                                      <span v-else-if="item.mode === 'kakan'" class="mj-kakan-wrap">
                                        <span class="mj-side-wrap">
                                          <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" />
                                        </span>
                                        <span class="mj-side-wrap">
                                          <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" />
                                        </span>
                                      </span>
                                      <span v-else class="mj-upright-wrap">
                                        <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" />
                                      </span>
                                    </template>
                                  </span>
                                </span>
                                <span v-else-if="seg.type === 'tile'" class="inline-mahjong-tile">
                                  <img :src="getMahjongTileImageUrl(seg.tile.fileName)" :alt="seg.tile.label" />
                                </span>
                                <span v-else-if="seg.type === 'action'" class="inline-mahjong-action" :class="seg.action.colorClass">
                                  {{ seg.action.label }}
                                </span>
                              </template>
                            </template>
                            <span v-else class="mep-mp-placeholder">패를 선택하면 현재 입력 상황이 표시됩니다</span>
                          </div>
                          <button
                            v-if="commentContentInput.length > 0"
                            type="button"
                            class="mep-mini-backspace-btn"
                            title="마지막 입력 패/글자 지우기"
                            @click="deleteLastCommentToken('new')"
                          >⌫</button>
                        </div>

                        <Transition name="mep-guide-slide">
                          <div v-if="showEmoteNotationHelp" class="mep-notation-guide">
                            <div class="mng-row"><span class="mng-badge">연속/복합</span> <code>[234m5m7m9m]</code> <code>[123m 456p]</code> <span class="mng-sub">(공백=블록 분리, 0=적5)</span></div>
                            <div class="mng-row"><span class="mng-badge">치 / 퐁</span> <code>[-456m]</code> <code>[-435m]</code> <code>[5-55p]</code> <span class="mng-sub">(- 붙인 패 눕힘)</span></div>
                            <div class="mng-row"><span class="mng-badge">가깡 / 안깡</span> <code>[7=77p]</code> <span class="mng-sub">(가깡 =)</span> · <code>[#8888m]</code> <span class="mng-sub">(안깡 #)</span></div>
                          </div>
                        </Transition>

                        <!-- 액션 버튼 8종 (리치/다마/치/퐁/깡/론/쯔모/스킵) -->
                        <div v-show="activeEmoteTab === 'action'" class="mep-actions-grid">
                          <button
                            v-for="act in MAHJONG_ACTION_EMOTES"
                            :key="`new-act-${act.key}`"
                            type="button"
                            class="mep-action-btn"
                            :class="act.colorClass"
                            @click="insertEmoteTokenToComment(act.label, 'new')"
                          >
                            {{ act.label }}
                          </button>
                        </div>

                        <!-- 마작패 이미지 그리드 (만수/통수/삭수/자패, DOM 상시 마운트로 0ms 전환) -->
                        <div
                          v-for="grp in TILE_EMOTE_GROUPS"
                          :key="`new-grp-${grp.key}`"
                          v-show="activeEmoteTab === grp.key"
                          class="mep-tiles-grid"
                        >
                          <button
                            v-for="tl in grp.tiles"
                            :key="`new-tl-${tl.code}`"
                            type="button"
                            class="mep-tile-btn"
                            :class="{ 'is-selected-base': isFuroEmoteMode && selectedPaletteTileCode === tl.code }"
                            :title="`${tl.label} (${tl.code})`"
                            @click="insertTileFromPalette(tl, 'new')"
                          >
                            <img :src="getMahjongTileImageUrl(tl.fileName)" :alt="tl.label" loading="eager" decoding="sync" />
                            <span class="mep-tile-sub">{{ tl.label }}</span>
                          </button>
                        </div>

                        <!-- 모던 후로 레버 독 (Furo Lever Dock) -->
                        <div v-show="isFuroEmoteMode && activeEmoteTab !== 'action'" class="mep-furo-dock">
                          <div class="mep-base-tile-chip" :class="{ 'is-popping': isBaseTilePopping }" title="패를 클릭하면 기준 패가 변경됩니다">
                            <img :src="getMahjongTileImageUrl(selectedPaletteTileDef.fileName)" :alt="selectedPaletteTileDef.label" class="mep-base-tile-img" />
                            <div class="mep-base-tile-meta">
                              <span class="mep-base-sub">기준 패</span>
                              <strong class="mep-base-name">{{ selectedPaletteTileDef.label }}</strong>
                            </div>
                          </div>
                          <div class="mep-lever-group">
                            <span class="mep-lever-hint">레버를 누른 채 4방향 드래그</span>
                            <div class="mep-lever-pills">
                              <button
                                type="button"
                                class="mep-lever-btn lever-chi"
                                title="누른 채 좌/상/우로 드래그하여 치 입력"
                                @pointerdown="startFuroLeverDrag($event, 'chi', 'new')"
                              >
                                <span class="lever-joy-icon"><span class="lever-joy-dot"></span></span>
                                <span>치</span>
                              </button>
                              <button
                                type="button"
                                class="mep-lever-btn lever-pon"
                                title="누른 채 좌/상/우로 드래그하여 퐁 입력"
                                @pointerdown="startFuroLeverDrag($event, 'pon', 'new')"
                              >
                                <span class="lever-joy-icon"><span class="lever-joy-dot"></span></span>
                                <span>퐁</span>
                              </button>
                              <button
                                type="button"
                                class="mep-lever-btn lever-kan"
                                title="누른 채 좌/상/우(가깡) 또는 아래(안깡)로 드래그"
                                @pointerdown="startFuroLeverDrag($event, 'kan', 'new')"
                              >
                                <span class="lever-joy-icon"><span class="lever-joy-dot"></span></span>
                                <span>깡</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      class="btn-submit-comment"
                      :disabled="isSubmittingComment"
                      @click="submitNewHighlightComment"
                    >
                      {{ isSubmittingComment ? '등록 중...' : '댓글 등록' }}
                    </button>
                  </div>

                  <!-- 입력창에 포함된 마작패/액션 실시간 미리보기 (하단 툴바 아래에 배치하여 팝업 위치 고정) -->
                  <div
                    v-if="commentContentInput.includes('[') && commentContentInput.includes(']')"
                    class="lb-cf-live-preview"
                  >
                    <span class="lb-cf-preview-label">미리보기</span>
                    <div class="lb-cf-preview-body rich-mahjong-content">
                      <template v-for="(seg, sIdx) in parseRichMahjongText(commentContentInput)" :key="`prev-seg-${sIdx}`">
                        <span v-if="seg.type === 'text'">{{ seg.text }}</span>
                        <span v-else-if="seg.type === 'meld-group'" class="mj-hand" :title="seg.rawNotation">
                          <span
                            v-for="(blk, bIdx) in seg.blocks"
                            :key="`prev-blk-${sIdx}-${bIdx}`"
                            class="mj-meld-block"
                            :class="{ 'is-draw-block': blk.isDraw }"
                          >
                            <template v-for="(item, iIdx) in blk.items" :key="`prev-it-${sIdx}-${bIdx}-${iIdx}`">
                              <span v-if="item.mode === 'side'" class="mj-side-wrap" :title="item.tile.label">
                                <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" loading="eager" decoding="sync" />
                              </span>
                              <span v-else-if="item.mode === 'kakan'" class="mj-kakan-wrap" :title="`${item.tile.label} 가깡`">
                                <span class="mj-side-wrap">
                                  <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" loading="eager" decoding="sync" />
                                </span>
                                <span class="mj-side-wrap">
                                  <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" loading="eager" decoding="sync" />
                                </span>
                              </span>
                              <span v-else class="mj-upright-wrap" :title="item.tile.label">
                                <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" loading="eager" decoding="sync" />
                              </span>
                            </template>
                          </span>
                        </span>
                        <span v-else-if="seg.type === 'tile'" class="inline-mahjong-tile" :title="seg.tile.label">
                          <img :src="getMahjongTileImageUrl(seg.tile.fileName)" :alt="seg.tile.label" loading="eager" decoding="sync" />
                        </span>
                        <span v-else-if="seg.type === 'action'" class="inline-mahjong-action" :class="seg.action.colorClass">
                          {{ seg.action.label }}
                        </span>
                      </template>
                    </div>
                  </div>

                  <div v-if="commentFormError" class="upload-error-msg">{{ commentFormError }}</div>
                </div>
              </div>
            </div>
          </div>
          </div>

          <!-- 우하단 플로팅 댓글/스크롤 이동 버튼 (댓글 영역이 화면에 보이면 자동 숨김) -->
          <Transition name="lb-fab-fade">
            <button
              v-if="showLightboxCommentFab"
              type="button"
              class="lightbox-comment-fab"
              title="댓글 및 상세 정보로 아래 스크롤"
              @click.stop="scrollToLightboxComments"
            >
              <span class="lb-fab-icon-wrap">
                <svg class="lb-fab-comment-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
                <span v-if="lightboxComments.length > 0" class="lb-fab-badge">{{ lightboxComments.length }}</span>
              </span>
              <span class="lb-fab-arrow">↓</span>
            </button>
          </Transition>
        </div>
      </div>
    </Transition>

    <!-- ============================================== -->
    <!-- 모던 글래스모피즘 후로 조이스틱 4방향 HUD 오버레이 -->
    <!-- ============================================== -->
    <Teleport to="body">
      <Transition name="furo-hud-pop">
        <div
          v-if="furoDragState.active"
          class="furo-joystick-hud"
          :class="[`action-${furoDragState.action}`, { 'is-closing': furoDragState.closing }]"
          :style="{ left: `${furoDragState.hudX}px`, top: `${furoDragState.hudY}px` }"
        >
          <!-- 4방향 프리뷰 슬롯 (상/좌/우/하 - 패만 표시) -->
          <div
            v-for="dirKey in (['up', 'left', 'right', 'down'] as const)"
            :key="`furo-slot-${dirKey}`"
            class="furo-hud-card"
            :class="[
              `dir-${dirKey}`,
              {
                'is-active': furoDragState.activeDir === dirKey,
                'is-confirmed': furoDragState.confirmedDir === dirKey,
              }
            ]"
          >
            <div class="furo-hud-tiles-stage">
              <span
                v-for="(blk, bIdx) in furoHudSlots[dirKey].blocks"
                :key="`hud-blk-${dirKey}-${bIdx}`"
                class="mj-meld-block"
              >
                <template v-for="(item, iIdx) in blk.items" :key="`hud-it-${dirKey}-${bIdx}-${iIdx}`">
                  <span v-if="item.mode === 'side'" class="mj-side-wrap">
                    <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" />
                  </span>
                  <span v-else-if="item.mode === 'kakan'" class="mj-kakan-wrap">
                    <span class="mj-side-wrap">
                      <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" />
                    </span>
                    <span class="mj-side-wrap">
                      <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" />
                    </span>
                  </span>
                  <span v-else class="mj-upright-wrap">
                    <img class="mj-tile" :src="getMahjongTileImageUrl(item.tile.fileName)" :alt="item.tile.label" />
                  </span>
                </template>
              </span>
            </div>
            <span class="furo-hud-notation">{{ furoHudSlots[dirKey].notation }}</span>
          </div>

          <!-- 중앙 아날로그 조이스틱 소켓 & 연속 물리 노브 (텍스트 없음) -->
          <div class="furo-joystick-socket" :class="{ 'is-engaged': furoDragState.activeDir !== 'center' }">
            <div class="furo-socket-ring">
              <span class="furo-socket-tick tick-up" :class="{ active: furoDragState.activeDir === 'up' }">▲</span>
              <span class="furo-socket-tick tick-down" :class="{ active: furoDragState.activeDir === 'down' }">▼</span>
              <span class="furo-socket-tick tick-left" :class="{ active: furoDragState.activeDir === 'left' }">◀</span>
              <span class="furo-socket-tick tick-right" :class="{ active: furoDragState.activeDir === 'right' }">▶</span>
            </div>

            <!-- 레버 당김 광선 스템 -->
            <div
              class="furo-joystick-stem"
              :style="{
                width: `${Math.hypot(furoDragState.knobX, furoDragState.knobY).toFixed(1)}px`,
                transform: `rotate(${furoDragState.angleDeg.toFixed(1)}deg)`,
                opacity: furoDragState.pullRatio.toFixed(2),
              }"
            ></div>

            <!-- 손끝을 따라 움직이는 3D 조이스틱 노브 -->
            <div
              class="furo-joystick-knob"
              :class="{
                'is-spring-back': furoDragState.closing,
                'is-engaged': furoDragState.activeDir !== 'center',
              }"
              :style="{
                transform: `translate3d(${furoDragState.knobX.toFixed(1)}px, ${furoDragState.knobY.toFixed(1)}px, 0)`,
              }"
            ></div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- ============================================== -->
    <!-- 라이트박스 내 사진 클릭 시 전체화면 크게 보기 모달 -->
    <!-- ============================================== -->
    <Transition name="modal-fade">
      <div
        v-if="isFullImageZoomOpen && lightboxHighlight?.hasImage && lightboxHighlight?.imageId"
        class="modal-overlay full-image-zoom-overlay"
        @click="closeFullImageZoom"
      >
        <div class="full-image-zoom-topbar" @click.stop>
          <button
            type="button"
            class="btn-zoom-scale-toggle"
            :class="{ active: fullImageFitMode === 'contain' }"
            @click="fullImageFitMode = 'contain'"
          >
            화면 맞춤
          </button>
          <button
            type="button"
            class="btn-zoom-scale-toggle"
            :class="{ active: fullImageFitMode === 'width' }"
            @click="fullImageFitMode = 'width'"
          >
            가로 맞춤
          </button>
          <button
            type="button"
            class="btn-zoom-scale-toggle"
            :class="{ active: fullImageFitMode === 'height' }"
            @click="fullImageFitMode = 'height'"
          >
            세로 맞춤
          </button>
          <button
            type="button"
            class="btn-zoom-scale-toggle"
            :class="{ active: fullImageFitMode === 'original' }"
            @click="fullImageFitMode = 'original'"
          >
            원본 크기
          </button>
          <button
            type="button"
            class="btn-zoom-close"
            title="닫기"
            @click="closeFullImageZoom"
          >
            ✕ 닫기
          </button>
        </div>
        <div
          class="full-image-zoom-stage"
          :class="`fit-${fullImageFitMode}`"
        >
          <div v-if="!isZoomHighResLoaded" class="zoom-highres-loading-pill" @click.stop>
            <span class="gdm-spinner"></span>
            <span>고화질 원본 불러오는 중...</span>
          </div>
          <img
            v-if="!isZoomHighResLoaded"
            :src="getHighlightThumbnailUrl(lightboxHighlight.imageId)"
            alt="미리보기"
            class="full-image-zoom-img is-thumb-preview"
            :class="`fit-${fullImageFitMode}`"
            @click.stop="cycleFullImageFitMode"
          />
          <img
            :src="getHighlightImageUrl(lightboxHighlight.imageId)"
            alt="원본 크게 보기"
            class="full-image-zoom-img"
            :class="[`fit-${fullImageFitMode}`, { 'is-highres-pending': !isZoomHighResLoaded }]"
            @load="handleZoomHighResLoad(lightboxHighlight.imageId)"
            @error="isZoomHighResLoaded = true"
            @click.stop="cycleFullImageFitMode"
          />
        </div>
      </div>
    </Transition>

    <!-- ============================================== -->
    <!-- 라이트박스 연동: 회차 요약 정보 팝업 모달        -->
    <!-- ============================================== -->
    <Transition name="modal-fade">
      <div
        v-if="lightboxSessionPopupDetail"
        class="modal-overlay session-popup-modal-overlay"
        v-backdrop-dismiss="() => lightboxSessionPopupDetail = null"
      >
        <div class="session-popup-modal-card">
          <div class="spm-header">
            <div class="spm-title-box">
              <span class="badge-session">{{ lightboxSessionPopupDetail.sessionName }}</span>
              <h3 class="spm-title">회차 요약 정보</h3>
              <span class="spm-sub">
                (참가 {{ lightboxSessionPopupDetail.members.length }}명 · 총 {{ lightboxSessionPopupDetail.games.length }}경기)
              </span>
            </div>
            <div class="spm-header-actions">
              <button
                type="button"
                class="btn-goto-session-tab"
                @click="goToSessionTabFromPopup()"
              >
                회차 상세 탭으로 이동 ↗
              </button>
              <button
                type="button"
                class="gdm-close-btn"
                @click="lightboxSessionPopupDetail = null"
                title="닫기"
              >✕</button>
            </div>
          </div>

          <div v-if="isLoadingLightboxSessionPopup" class="gdm-loading-badge">
            <span class="gdm-spinner"></span> 회차 상세 데이터를 불러오는 중...
          </div>

          <div class="spm-body">
            <!-- 1) 회차 참가 인원 순위 요약 표 -->
            <div class="spm-section" v-if="lightboxSessionPopupMembersWithRanks.length > 0">
              <h4 class="spm-section-title">회차 종합 순위 ({{ lightboxSessionPopupMembersWithRanks.length }}명)</h4>
              <div class="spm-table-wrap">
                <table class="spm-table">
                  <thead>
                    <tr>
                      <th>순위</th>
                      <th>이름</th>
                      <th>대국 수</th>
                      <th>합계 우마</th>
                      <th>평균 우마</th>
                      <th>1 / 2 / 3 / 4위</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(m, idx) in lightboxSessionPopupMembersWithRanks" :key="`spm-m-${m.name}`">
                      <td>
                        <span class="rank-badge" :class="`rank-${idx + 1}`">{{ idx + 1 }}</span>
                      </td>
                      <td class="font-bold">{{ m.name }}</td>
                      <td>{{ m.totalGames }}전</td>
                      <td class="font-bold" :class="m.totalUma >= 0 ? 'text_pos' : 'text_neg'">
                        <span v-if="m.totalUma > 0">+</span>{{ m.totalUma.toFixed(1) }}
                      </td>
                      <td :class="m.avgUma >= 0 ? 'text_pos' : 'text_neg'">
                        <span v-if="m.avgUma > 0">+</span>{{ m.avgUma.toFixed(1) }}
                      </td>
                      <td class="spm-ranks-cell">{{ m.r1 }} / {{ m.r2 }} / {{ m.r3 }} / {{ m.r4 }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- 2) 회차 경기 목록 (클릭 시 경기 상세 모달 오픈) -->
            <div class="spm-section" v-if="lightboxSessionPopupDetail.games.length > 0">
              <h4 class="spm-section-title">
                진행 대국 목록 ({{ lightboxSessionPopupDetail.games.length }}경기)
                <span class="spm-hint-txt">경기를 클릭하면 상세 결과 및 국별 점수 이동을 볼 수 있습니다</span>
              </h4>
              <div class="spm-games-grid">
                <div
                  v-for="g in lightboxSessionPopupDetail.games"
                  :key="`spm-g-${g.gameIndex}`"
                  class="spm-game-card"
                  @click="openGameFromSessionPopup(g)"
                >
                  <div class="spm-game-head">
                    <strong>{{ g.gameIndex }}경기</strong>
                    <span v-if="g.time" class="spm-game-time">{{ g.time }}</span>
                  </div>
                  <div class="spm-game-players">
                    <div
                      v-for="p in g.players"
                      :key="`spm-gp-${g.gameIndex}-${p.seat}-${p.name}`"
                      class="spm-game-player-row"
                      :class="{ 'is-winner': p.rank === 1 }"
                    >
                      <span class="spm-gp-left">
                        <span class="spm-gp-rank">{{ p.rank }}위</span>
                        <span class="spm-gp-name">{{ p.name }}</span>
                      </span>
                      <span class="spm-gp-right">
                        <span class="spm-gp-score">{{ p.score.toLocaleString() }}</span>
                        <span class="spm-gp-uma" :class="p.uma >= 0 ? 'text_pos' : 'text_neg'">
                          ({{ p.uma > 0 ? '+' : '' }}{{ p.uma }})
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ============================================== -->
    <!-- 관리자 전용: 갤러리 관리 모달 (멤버 동의어 관리 · 공통 PIN 관리) -->
    <!-- ============================================== -->
    <Transition name="modal-fade">
      <div 
        v-if="isPinAdminModalOpen" 
        class="modal-overlay" 
        v-backdrop-dismiss="() => { isPinAdminModalOpen = false }"
      >
        <div class="pin-admin-modal-card gallery-admin-modal-card">
          <div class="highlight-modal-header">
            <div class="gallery-admin-header-left">
              <h3>갤러리 관리 (관리자)</h3>
              <span class="gallery-admin-sub">멤버 동의어(스탯 연동) 및 공통 업로드 PIN을 설정합니다.</span>
            </div>
            <button class="btn-close" @click="isPinAdminModalOpen = false" title="닫기">✕</button>
          </div>

          <div class="highlight-modal-body">
            <template v-if="!isPinAdminVerified">
              <p class="pin-admin-desc">
                관리자 인증 후 멤버 동의어 관리 및 공통 업로드 PIN 설정을 변경할 수 있습니다.
              </p>
              <div class="form-group">
                <label class="form-label">관리자 인증 코드 입력</label>
                <input 
                  v-model="adminPasscodeInputForPin" 
                  type="password" 
                  class="form-input" 
                  placeholder="관리자 패스코드를 입력하세요"
                  @keyup.enter="verifyAdminForPinModal"
                />
              </div>
              <button 
                type="button" 
                class="btn-submit-modal" 
                :disabled="isPinAdminLoading"
                @click="verifyAdminForPinModal"
              >
                {{ isPinAdminLoading ? '인증 중...' : '관리자 인증하기' }}
              </button>
              <div v-if="pinAdminError" class="upload-error-msg">{{ pinAdminError }}</div>
            </template>

            <template v-else>
              <!-- 상단 세그먼트 탭 -->
              <div class="gallery-admin-tabs">
                <button
                  type="button"
                  class="gallery-admin-tab-btn"
                  :class="{ active: galleryAdminTab === 'aliases' }"
                  @click="galleryAdminTab = 'aliases'"
                >
                  <span>멤버 동의어 관리</span>
                  <span class="ga-tab-badge">{{ memberAliasEntries.length }}</span>
                </button>
                <button
                  type="button"
                  class="gallery-admin-tab-btn"
                  :class="{ active: galleryAdminTab === 'pin' }"
                  @click="galleryAdminTab = 'pin'"
                >
                  <span>공통 PIN 관리</span>
                </button>
              </div>

              <!-- 탭 1: 멤버 동의어 관리 -->
              <div v-if="galleryAdminTab === 'aliases'" class="gallery-admin-section">
                <p class="pin-admin-desc">
                  시트에 등록된 본캐 이름(예: <strong>따마모</strong>)과 갤러리·댓글·일정에서 사용하는 다른 닉네임(예: <strong>따마모크로스</strong>)을 연결합니다. 연결된 닉네임을 클릭하면 해당 멤버의 스탯 창이 바로 열리고 역만/갤러리 필터도 함께 연동됩니다.
                </p>

                <!-- 미연동 갤러리/댓글 닉네임 빠른 선택 추천 -->
                <div v-if="unlinkedGalleryNames.length > 0" class="ga-unlinked-box">
                  <div class="ga-unlinked-title">갤러리/댓글 미연동 닉네임 (클릭 시 동의어 입력란에 자동 입력)</div>
                  <div class="ga-unlinked-chips">
                    <button
                      v-for="uName in unlinkedGalleryNames"
                      :key="`unlinked-${uName}`"
                      type="button"
                      class="ga-unlinked-chip"
                      :class="{ selected: newAliasNameInput.trim() === uName }"
                      @click="prefillUnlinkedNameAsAlias(uName)"
                    >
                      + {{ uName }}
                    </button>
                  </div>
                </div>

                <!-- 동의어 추가 폼 -->
                <div class="ga-alias-add-card">
                  <div class="ga-alias-form-grid">
                    <div class="ga-alias-field">
                      <label class="form-label">시트 본캐 멤버 (스탯 기준)</label>
                      <div class="ga-canonical-combo">
                        <input
                          v-model="aliasCanonicalSearch"
                          type="text"
                          class="form-input"
                          placeholder="멤버 검색 또는 선택 (예: 따마모)"
                          autocomplete="off"
                          @focus="handleAliasCanonicalFocus"
                          @blur="handleAliasCanonicalBlur"
                          @input="selectedAliasCanonicalName = aliasCanonicalSearch.trim(); isAliasCanonicalDropdownOpen = true"
                        />
                        <div
                          v-if="isAliasCanonicalDropdownOpen && filteredCanonicalNamesForAlias.length > 0"
                          class="ga-canonical-dropdown"
                        >
                          <button
                            v-for="cName in filteredCanonicalNamesForAlias"
                            :key="`canon-opt-${cName}`"
                            type="button"
                            class="ga-canonical-opt"
                            :class="{ active: selectedAliasCanonicalName === cName }"
                            @mousedown.prevent="selectCanonicalMemberForAlias(cName)"
                          >
                            <span>{{ cName }}</span>
                            <span v-if="memberAliasesMap[cName]?.length" class="ga-opt-sub">
                              ({{ memberAliasesMap[cName].join(', ') }})
                            </span>
                          </button>
                        </div>
                      </div>
                    </div>

                    <div class="ga-alias-arrow">←</div>

                    <div class="ga-alias-field">
                      <label class="form-label">연결할 동의어 / 부캐 닉네임</label>
                      <input
                        v-model="newAliasNameInput"
                        type="text"
                        class="form-input"
                        placeholder="예: 따마모크로스"
                        autocomplete="off"
                        @keyup.enter="handleAddMemberAlias"
                      />
                    </div>
                  </div>

                  <div class="ga-alias-add-actions">
                    <button
                      type="button"
                      class="btn-submit-modal sm"
                      :disabled="isAliasSubmitting"
                      @click="handleAddMemberAlias"
                    >
                      {{ isAliasSubmitting ? '저장 중...' : '+ 동의어 연결 추가' }}
                    </button>
                  </div>
                </div>

                <div v-if="aliasAdminError" class="upload-error-msg">{{ aliasAdminError }}</div>
                <div v-if="aliasAdminMessage" class="pin-admin-status">{{ aliasAdminMessage }}</div>

                <!-- 현재 등록된 동의어 목록 -->
                <div class="ga-alias-list-wrap">
                  <div class="ga-alias-list-header">
                    <span>등록된 멤버 동의어 목록 ({{ memberAliasEntries.length }}명)</span>
                    <span class="ga-alias-list-hint">닉네임 클릭 시 스탯 창 연동 테스트 가능</span>
                  </div>
                  <div v-if="memberAliasEntries.length === 0" class="ga-alias-empty">
                    등록된 멤버 동의어가 없습니다.
                  </div>
                  <div v-else class="ga-alias-rows">
                    <div
                      v-for="[canonical, aliases] in memberAliasEntries"
                      :key="`alias-row-${canonical}`"
                      class="ga-alias-row"
                    >
                      <div class="ga-alias-canonical">
                        <button
                          type="button"
                          class="hl-player-link strong"
                          title="클릭하여 스탯 창 열기"
                          @click="openPlayerByName(canonical, false, false, true)"
                        >{{ canonical }}</button>
                        <span class="ga-canonical-tag">본캐</span>
                      </div>
                      <div class="ga-alias-chips">
                        <span
                          v-for="al in aliases"
                          :key="`alias-chip-${canonical}-${al}`"
                          class="ga-alias-chip"
                        >
                          <button
                            type="button"
                            class="ga-alias-chip-name"
                            title="클릭하여 동의어로 스탯 창 열기 테스트"
                            @click="openPlayerByName(al, false, false, true)"
                          >{{ al }}</button>
                          <button
                            type="button"
                            class="ga-alias-chip-del"
                            title="연결 해제"
                            :disabled="isAliasSubmitting"
                            @click="handleRemoveMemberAlias(canonical, al)"
                          >×</button>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 탭 2: 공통 PIN 관리 -->
              <div v-else class="gallery-admin-section">
                <p class="pin-admin-desc">
                  이 PIN 번호를 알고 있는 모든 부원은 화료 기록 및 사진을 등록하거나, 기존 기록의 사진 외 정보(회차·대국·승자·설명 등)를 수정할 수 있습니다.
                  (사진 교체/삭제 및 기록 전체 삭제는 관리자만 가능합니다.)
                </p>
                <div class="form-group">
                  <label class="form-label">현재 설정된 공통 PIN</label>
                  <div class="current-pin-box">{{ currentServerUploadPin || '조회 중...' }}</div>
                </div>
                <div class="form-group">
                  <label class="form-label">새 공통 PIN 번호 설정</label>
                  <input 
                    v-model="newServerUploadPin" 
                    type="text" 
                    class="form-input" 
                    placeholder="새로운 공통 PIN 입력 (4자리 이상)"
                    @keyup.enter="saveNewServerUploadPin"
                  />
                </div>
                <div v-if="pinAdminError" class="upload-error-msg">{{ pinAdminError }}</div>
                <div v-if="pinAdminMessage" class="pin-admin-status">{{ pinAdminMessage }}</div>
              </div>
            </template>
          </div>

          <div class="highlight-modal-footer">
            <button type="button" class="btn-cancel-modal" @click="isPinAdminModalOpen = false">닫기</button>
            <button 
              v-if="isPinAdminVerified && galleryAdminTab === 'pin'"
              type="button" 
              class="btn-submit-modal" 
              :disabled="isPinAdminLoading"
              @click="saveNewServerUploadPin"
            >
              {{ isPinAdminLoading ? '저장 중...' : 'PIN 변경 저장' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ============================================== -->
    <!-- 레이팅 변동 추이 전용 모달 (줌/팬 및 회차 필터 탑재) -->
    <!-- ============================================== -->
    <Transition name="modal-fade">
      <div 
        v-if="isRatingTimelineModalOpen" 
        class="rating-modal-overlay" 
        v-backdrop-dismiss="() => isRatingTimelineModalOpen = false"
      >
        <div class="rating-modal-card">
          <!-- 모달 헤더 -->
          <div class="rating-modal-header">
            <div class="rating-modal-title-group">
              <h3 class="rating-modal-title">전체 플레이어 레이팅 변동 추이</h3>
              <span class="rating-modal-subtitle">마우스 휠 스크롤 / 핀치 줌으로 확대하고 좌우 드래그로 타임라인을 탐색할 수 있습니다.</span>
            </div>
            <button class="gdm-close-btn" @click="isRatingTimelineModalOpen = false" title="닫기">✕</button>
          </div>

          <!-- 모달 툴바: 퀵 필터 버튼 + 회차별 필터 + 줌 리셋 -->
          <div class="rating-modal-toolbar">
            <div class="toolbar-left">
              <span class="toolbar-label">선택:</span>
              <button 
                type="button" 
                class="btn-rating-filter" 
                :class="{ active: activeRatingPreset === 'top5' }" 
                @click="filterRatingTopN(5)"
              >
                상위 5명
              </button>
              <button 
                type="button" 
                class="btn-rating-filter" 
                :class="{ active: activeRatingPreset === 'top10' }" 
                @click="filterRatingTopN(10)"
              >
                상위 10명
              </button>
              <button 
                type="button" 
                class="btn-rating-filter" 
                :class="{ active: activeRatingPreset === 'all' }" 
                @click="filterRatingAll(true)"
              >
                전체 선택
              </button>
              <button 
                type="button" 
                class="btn-rating-filter" 
                :class="{ active: activeRatingPreset === 'none' }" 
                @click="filterRatingAll(false)"
              >
                전체 해제
              </button>
            </div>

            <div class="toolbar-right">
              <div class="session-filter-group">
                <span class="toolbar-label">회차 필터:</span>
                <select v-model="selectedRatingSessionFilter" @change="handleSessionFilterChange" class="session-filter-select">
                  <option value="">전체 회차</option>
                  <option v-for="s in availableRatingSessions" :key="s" :value="s">
                    {{ s }}
                  </option>
                </select>
              </div>

              <button type="button" class="btn-zoom-reset" @click="resetRatingChartZoom" title="확대/축소 배율을 초기화합니다">
                줌 리셋
              </button>
            </div>
          </div>

          <!-- 선수 범례 -->
          <div v-if="ratingChartData.datasets.length > 0" class="rating-player-legend modal-legend">
            <button
              v-for="ds in ratingChartData.datasets"
              :key="`modal-leg-${ds.label}`"
              type="button"
              class="rating-legend-item"
              :class="{ 'is-hidden': hiddenRatingPlayerNames.has(ds.label) }"
              @click="toggleRatingPlayerLegend(ds.label)"
            >
              <span class="rating-legend-dot" :style="{ backgroundColor: String(ds.borderColor) }"></span>
              <span class="rating-legend-label">{{ ds.label }}</span>
            </button>
          </div>

          <!-- 차트 캔버스 영역 -->
          <div class="rating-modal-chart-wrapper">
            <div v-if="ratingChartData.datasets.length > 0" class="rating-modal-chart-inner">
              <LineChart 
                id="rating-modal-chart-canvas"
                ref="ratingModalChartRef" 
                :data="ratingChartData" 
                :options="ratingChartOptions" 
                :plugins="ratingChartPlugins"
              />
            </div>
            <div v-else class="rating-chart-empty">
              레이팅 변동 이력 데이터를 불러오는 중이거나 기록이 없습니다.
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
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  box-sizing: border-box;
}

.dashboard-content,
.tab-schedule,
.tab-rules {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

@media (max-width: 480px) {
  .stats-dashboard-container {
    padding: 12px 8px 32px;
  }
}

.stats-dashboard-container button,
.stats-dashboard-container input,
.stats-dashboard-container select,
.tab-btn,
.btn-action,
.search-input,
.session-select,
.gdm-tab-btn,
.btn-rating-filter {
  font-family: inherit !important;
}

/* 토스트 */
.dashboard-toast {
  position: fixed;
  top: auto !important;
  bottom: 24px;
  left: 50%;
  height: auto;
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
.dashboard-toast-fade-enter-active, .dashboard-toast-fade-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.dashboard-toast-fade-enter-from, .dashboard-toast-fade-leave-to {
  opacity: 0;
  transform: translate(-50%, 10px);
}

/* 연속 히스토그램 팝오버 툴팁 (폭 215px 축소 및 50% 절반 구분선 적용) */
.dist-tooltip-popup {
  position: fixed;
  transform: translate(-50%, -100%);
  pointer-events: none;
  z-index: 2880;
  width: 215px;
  background: rgba(255, 255, 255, 0.98);
  color: #0f172a;
  backdrop-filter: blur(8px);
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  padding: 10px 12px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.12);
  font-family: inherit;
  transition: opacity 0.15s ease;
}
html.dark .dist-tooltip-popup {
  background: rgba(15, 23, 42, 0.97);
  color: #f8fafc;
  border-color: rgba(255, 255, 255, 0.15);
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.45);
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
  color: #334155;
}
html.dark .dist-title {
  color: #cbd5e1;
}
.dist-rank-chip {
  font-size: 10px;
  font-weight: bold;
  padding: 1px 5px;
  border-radius: 4px;
}
.dist-rank-chip.pos {
  color: #16a34a;
  background: rgba(22, 163, 74, 0.12);
}
html.dark .dist-rank-chip.pos {
  color: #34d399;
  background: rgba(52, 211, 153, 0.15);
}
.dist-rank-chip.neg {
  color: #dc2626;
  background: rgba(220, 38, 38, 0.12);
}
html.dark .dist-rank-chip.neg {
  color: #f87171;
  background: rgba(248, 113, 113, 0.15);
}
.dist-rank-chip.unrecorded {
  color: #64748b;
  background: rgba(100, 116, 139, 0.14);
}
html.dark .dist-rank-chip.unrecorded {
  color: #94a3b8;
  background: rgba(148, 163, 184, 0.18);
}
.dist-sub-rank {
  font-size: 10px;
  color: #64748b;
  margin-bottom: 4px;
}
html.dark .dist-sub-rank {
  color: #94a3b8;
}
.dist-my-val {
  font-size: 11px;
  color: #64748b;
  margin-bottom: 5px;
}
html.dark .dist-my-val {
  color: #94a3b8;
}
.dist-my-val strong {
  color: #0f172a;
  font-size: 12px;
}
html.dark .dist-my-val strong {
  color: #ffffff;
}
.dist-chart-box {
  position: relative;
  width: 100%;
  height: 44px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 5px;
}
html.dark .dist-chart-box {
  background: rgba(0, 0, 0, 0.25);
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
  color: #64748b;
  white-space: nowrap;
  line-height: 1;
}
html.dark .dist-line-tag {
  color: #cbd5e1;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
}
.dist-line-tag.tag-50 {
  color: #0f172a;
  font-weight: 700;
}
html.dark .dist-line-tag.tag-50 {
  color: #ffffff;
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
  color: #64748b;
}
html.dark .dist-labels-row {
  color: #94a3b8;
}
.dist-avg-val {
  color: #2563eb;
  font-weight: bold;
}
html.dark .dist-avg-val {
  color: #38bdf8;
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

/* 탭 네비게이션 (PC/모바일 드래그/관성 스크롤 및 하단 위치 표시 바) */
.tabs-nav-wrap {
  margin: 18px 0 22px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.tabs-nav {
  display: flex;
  gap: 8px;
  margin: 0;
  border-bottom: 1px solid var(--border-color, #eaeaea);
  padding-bottom: 6px;
  overflow-x: auto;
  scroll-behavior: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  -ms-overflow-style: none;
  user-select: none;
  -webkit-user-select: none;
  cursor: default;
}
.tabs-nav-wrap.has-scroll-indicator .tabs-nav {
  cursor: grab;
}
.tabs-nav::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}
.tabs-nav.is-dragging {
  cursor: grabbing;
  scroll-behavior: auto;
}
.tabs-nav.is-dragging .tab-btn {
  cursor: grabbing;
}
.tabs-nav-scroll-track {
  position: relative;
  width: 100%;
  height: 4px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.22);
  overflow: hidden;
  cursor: pointer;
}
html.dark .tabs-nav-scroll-track {
  background: rgba(148, 163, 184, 0.16);
}
.tabs-nav-scroll-thumb {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: 999px;
  background: var(--color-toggle-on, #3b82f6);
  opacity: 0.82;
  transition: width 0.08s ease-out;
  will-change: left, width;
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
  flex-shrink: 0;
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
  padding: 10px 6px;
  font-weight: bold;
  border-bottom: 2px solid var(--border-color, #eee);
  box-sizing: border-box;
}
.col-sortable {
  cursor: pointer;
  user-select: none;
}
.col-sortable:hover {
  background: rgba(0, 0, 0, 0.06);
}
.sort-mark {
  display: inline-block;
  width: 11px;
  font-size: 10px;
  margin-left: 2px;
  text-align: center;
}
.stats-table td {
  padding: 10px 6px;
  border-bottom: 1px solid var(--border-color, #eee);
  vertical-align: middle;
  box-sizing: border-box;
}

/* 종합 랭킹 고정 컬럼 너비 (정렬 시 열 흔들림 방지) */
.col-rank {
  width: 48px;
  min-width: 48px;
  max-width: 48px;
}
.col-name {
  width: 96px;
  min-width: 96px;
  max-width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.col-rating {
  width: 80px;
  min-width: 80px;
  max-width: 80px;
}
.rating-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 7px;
  border-radius: 9999px;
  background-color: rgba(99, 102, 241, 0.12);
  color: #4f46e5;
  font-weight: 700;
  font-size: 12px;
  font-family: inherit;
  border: 1px solid rgba(99, 102, 241, 0.25);
}
html.dark .rating-badge {
  background-color: rgba(129, 140, 248, 0.18);
  color: #a5b4fc;
  border-color: rgba(129, 140, 248, 0.35);
}
.podium-rating-tag {
  display: inline-block;
  margin-top: 4px;
  padding: 1px 8px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 800;
  border: 1px solid transparent;
  transition: all 0.2s ease;
}
.rating-delta {
  font-size: 11px;
  margin-left: 4px;
  font-weight: 600;
}
.col-total-uma {
  width: 82px;
  min-width: 82px;
  max-width: 82px;
}
.col-avg-uma {
  width: 78px;
  min-width: 78px;
  max-width: 78px;
}
.col-games {
  width: 62px;
  min-width: 62px;
  max-width: 62px;
}
.col-top2 {
  width: 78px;
  min-width: 78px;
  max-width: 78px;
}
.col-avg-rank {
  width: 82px;
  min-width: 82px;
  max-width: 82px;
}
.col-ranks-dist-group-th {
  width: 304px;
  min-width: 304px;
  max-width: 304px;
  vertical-align: middle;
  padding: 6px 8px;
  font-size: 12px;
  font-weight: bold;
  border-bottom: 1px solid var(--border-color, #eee) !important;
}
.header-sub-row th {
  padding: 4px 4px;
  border-bottom: 2px solid var(--border-color, #eee);
  font-size: 11px;
}
.col-rank-item-th,
.col-rank-item {
  width: 76px;
  min-width: 76px;
  max-width: 76px;
  text-align: center;
  vertical-align: middle;
  padding: 6px 4px;
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
html.dark .dist-badge.r1 { color: #34d399; }
html.dark .dist-badge.r2 { color: #38bdf8; }
html.dark .dist-badge.r3 { color: #fbbf24; }
html.dark .dist-badge.r4 { color: #f87171; }
.dist-header-badge {
  padding: 2px 7px;
  font-size: 11px;
  font-weight: bold;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
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
html.dark .rank-badge { background: rgba(255, 255, 255, 0.08); }
html.dark .rank-badge.rank-1 { background: rgba(245, 158, 11, 0.25); color: #fbbf24; }
html.dark .rank-badge.rank-2 { background: rgba(148, 163, 184, 0.25); color: #cbd5e1; }
html.dark .rank-badge.rank-3 { background: rgba(217, 119, 6, 0.25); color: #fdba74; }
.col-uma {
  font-weight: bold;
}
.pos { color: var(--color-positive, #16a34a); }
.neg { color: var(--color-negative, #dc2626); }

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
  width: 100px;
  min-width: 100px;
  max-width: 100px;
  box-sizing: border-box;
  background-color: var(--card-bg-color, #fff);
  opacity: 1;
  z-index: 12;
  border-right: 1px solid var(--border-color, #eee);
  text-align: center;
  cursor: pointer;
  padding: 8px 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.matrix-col-sticky-total {
  position: sticky;
  left: 100px;
  width: 75px;
  min-width: 75px;
  max-width: 75px;
  box-sizing: border-box;
  background-color: var(--card-bg-color, #fff);
  opacity: 1;
  z-index: 11;
  border-right: 2px solid var(--border-color, #cbd5e1);
  font-weight: bold;
  padding: 8px 6px;
  text-align: center;
}
.matrix-col-sticky-name-right {
  position: sticky;
  right: 0;
  width: 100px;
  min-width: 100px;
  max-width: 100px;
  box-sizing: border-box;
  background-color: var(--card-bg-color, #fff);
  opacity: 1;
  z-index: 11;
  border-left: 2px solid var(--border-color, #cbd5e1);
  text-align: center;
  cursor: pointer;
  padding: 8px 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.matrix-table thead th.matrix-col-sticky-name {
  z-index: 27;
}
.matrix-table thead th.matrix-col-sticky-total,
.matrix-table thead th.matrix-col-sticky-name-right {
  z-index: 26;
}
.matrix-player-row:hover td {
  background-color: #f1f5f9;
}
.matrix-player-row:hover .matrix-col-sticky-name,
.matrix-player-row:hover .matrix-col-sticky-total,
.matrix-player-row:hover .matrix-col-sticky-name-right {
  background-color: #f1f5f9 !important;
  opacity: 1 !important;
}
html.dark .matrix-player-row:hover td {
  background-color: #1e293b;
}
html.dark .matrix-player-row:hover .matrix-col-sticky-name,
html.dark .matrix-player-row:hover .matrix-col-sticky-total,
html.dark .matrix-player-row:hover .matrix-col-sticky-name-right {
  background-color: #1e293b !important;
  opacity: 1 !important;
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
.matrix-table tfoot th.matrix-col-sticky-name {
  z-index: 27;
}
.matrix-table tfoot th.matrix-col-sticky-total,
.matrix-table tfoot th.matrix-col-sticky-name-right {
  z-index: 26;
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

/* 화면 너비가 좁을 때 (Shallow Screen Width): 우측 고정 이름 열 제거 */
@media (max-width: 768px) {
  .matrix-col-sticky-name-right {
    display: none !important;
  }
}

/* 화면 높이가 낮을 때 (Shallow Screen Height): 하단 고정 푸터(tfoot) 제거 */
@media (max-height: 700px) {
  .matrix-table tfoot {
    display: none !important;
  }
}

/* ============================================== */
/* TAB 3: 회차별 경기 상세 & 차트 스타일          */
/* ============================================== */
/* 회차 스코프 탭 (이번 회차 / 전체 기간) */
.session-scope-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 18px;
  background: #f1f5f9;
  padding: 4px;
  border-radius: 8px;
  width: fit-content;
}
.session-scope-tab {
  padding: 7px 18px;
  font-size: 13px;
  font-weight: 700;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--text-dimmed, #64748b);
  cursor: pointer;
  transition: all 0.2s ease;
}
.session-scope-tab:hover {
  color: var(--text-color, #0f172a);
}
.session-scope-tab.active {
  background: #ffffff;
  color: var(--color-toggle-on, #2563eb);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
}

/* 회차 최종 순위 카드 내 순위분포 뱃지 */
.sm-dist-badges {
  display: flex;
  gap: 4px;
  margin-top: 4px;
  flex-wrap: wrap;
}
.sm-badge {
  font-size: 9.5px;
  font-weight: bold;
  padding: 1px 4px;
  border-radius: 3px;
}
.sm-badge.r1 { background: rgba(16, 185, 129, 0.15); color: #059669; }
.sm-badge.r2 { background: rgba(6, 182, 212, 0.15); color: #0891b2; }
.sm-badge.r3 { background: rgba(245, 158, 11, 0.15); color: #d97706; }
.sm-badge.r4 { background: rgba(239, 68, 68, 0.15); color: #dc2626; }
html.dark .sm-badge.r1 { color: #34d399; }
html.dark .sm-badge.r2 { color: #38bdf8; }
html.dark .sm-badge.r3 { color: #fbbf24; }
html.dark .sm-badge.r4 { color: #f87171; }

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
  border: 1px solid var(--border-color, #cbd5e1);
  background: var(--card-bg-color, #fff);
  color: var(--text-color, #0f172a);
  font-family: inherit;
  cursor: pointer;
}
.session-select option {
  background: #ffffff;
  color: #0f172a;
}
html.dark .session-select option {
  background: #1e1e1e;
  color: #e5e5e5;
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
.gp-rating {
  font-size: 11px;
  font-weight: 700;
  margin-top: 4px;
  padding: 1.5px 4px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.04);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
}
html.dark .gp-rating {
  background: rgba(255, 255, 255, 0.06);
}
.gp-rating-val {
  font-weight: 800;
}
.gp-rating-delta.pos {
  color: #16a34a;
}
html.dark .gp-rating-delta.pos {
  color: #4ade80;
}
.gp-rating-delta.neg {
  color: #dc2626;
}
html.dark .gp-rating-delta.neg {
  color: #f87171;
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
  z-index: 2850;
  padding: 16px;
}
.player-modal-overlay.is-behind-lightbox {
  z-index: 2650;
}
.player-modal-card {
  background: var(--bg-modal, #ffffff);
  color: var(--text-color, #0f172a);
  border-radius: 12px;
  width: 100%;
  max-width: 740px;
  max-height: 90vh;
  overflow-y: auto;
  padding: 16px 20px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.15);
  border: 1px solid var(--border-color, #e2e8f0);
}
html.dark .player-modal-card {
  background: var(--bg-modal, #1e1e1e);
  color: var(--text-color, #e5e5e5);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);
  border-color: var(--border-color, #334155);
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
  background-color: var(--bg-card, #f8fafc);
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid var(--border-color, #e2e8f0);
}
html.dark .modal-header {
  background-color: var(--bg-card, #2a2a2a);
  border-color: var(--border-color, #334155);
}
.modal_notice_text {
  position: relative;
  font-size: 10px;
  color: var(--text-dimmed, #64748b);
  background: rgba(0, 0, 0, 0.025);
  border: 1px dashed var(--border-color, #cbd5e1);
  padding: 5px 22px 5px 8px;
  border-radius: 5px;
  margin-bottom: 8px;
  line-height: 1.35;
}
html.dark .modal_notice_text {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.15);
  color: #94a3b8;
}
.notice_text_content {
  word-break: keep-all;
}
.notice_close_btn {
  position: absolute;
  top: 3px;
  right: 5px;
  background: none;
  border: none;
  font-size: 10px;
  color: var(--text-dimmed, #64748b);
  cursor: pointer;
  padding: 2px 4px;
  line-height: 1;
  border-radius: 3px;
  transition: color 0.15s, background 0.15s;
}
.notice_close_btn:hover {
  color: var(--text-color, #0f172a);
  background: rgba(0, 0, 0, 0.06);
}
html.dark .notice_close_btn {
  color: var(--text-dimmed, #94a3b8);
}
html.dark .notice_close_btn:hover {
  color: var(--text-color, #ffffff);
  background: rgba(255, 255, 255, 0.1);
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
  border: 1px solid var(--border-color, #cbd5e1);
  background: var(--card-bg-color, #ffffff);
  color: var(--text-color, #0f172a);
  font-family: inherit;
  cursor: pointer;
}
.player_select option {
  background: #ffffff !important;
  color: #0f172a !important;
}
html.dark .player_select {
  border-color: var(--border-color, #444);
  background: var(--card-bg-color, #1e1e1e);
  color: var(--text-color, #e5e5e5);
}
html.dark .player_select option {
  background: #1e1e1e !important;
  color: #e5e5e5 !important;
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

/* 탭 메뉴 (모바일/좁은 화면 1줄 유지 + 좌우 스크롤 인디케이터 + 버튼 간 은은한 구분선) */
.tab-menu-wrap {
  position: relative;
  width: 100%;
  margin-bottom: 8px;
}
.tab-menu-wrap.has-scroll-indicator .tab_menu {
  margin-bottom: 3px;
}
.tab_menu {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  border-bottom: 1px solid var(--border-color, #e2e8f0);
  margin-bottom: 0;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  user-select: none;
}
.tab_menu::-webkit-scrollbar {
  display: none;
}
.tab_menu.is-dragging {
  cursor: grabbing;
}
html.dark .tab_menu {
  border-bottom-color: var(--border-color, #334155);
}
.tab_btn {
  position: relative;
  flex: 1 0 auto;
  padding: 8px 12px;
  background: none;
  border: none;
  font-size: 14px;
  font-weight: bold;
  cursor: pointer;
  color: var(--text-dimmed, #64748b);
  border-bottom: 2px solid transparent;
  transition: all 0.2s;
  text-align: center;
  font-family: inherit;
  white-space: nowrap;
  word-break: keep-all;
  flex-shrink: 0;
}
.tab_btn:not(:last-child)::after {
  content: '';
  position: absolute;
  right: 0;
  top: 26%;
  height: 48%;
  width: 1px;
  border-radius: 1px;
  background-color: rgba(148, 163, 184, 0.3);
  pointer-events: none;
}
html.dark .tab_btn:not(:last-child)::after {
  background-color: rgba(148, 163, 184, 0.2);
}
.tab_btn:hover {
  color: var(--text-color, #0f172a);
}
.tab_btn.active {
  color: var(--color-toggle-on, #2563eb);
  border-bottom-color: var(--color-toggle-on, #2563eb);
}
html.dark .tab_btn {
  color: var(--text-dimmed, #94a3b8);
}
html.dark .tab_btn:hover {
  color: var(--text-color, #e5e5e5);
}
html.dark .tab_btn.active {
  color: var(--color-toggle-on, #38bdf8);
  border-bottom-color: var(--color-toggle-on, #38bdf8);
}
@media (max-width: 640px) {
  .tab_btn {
    padding: 8px 10px;
    font-size: 13px;
  }
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
  background-color: var(--bg-card, #f8fafc);
  border: 1px solid var(--border-color, #e2e8f0);
  border-left: 3px solid var(--color-toggle-on, #2563eb);
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
  background: rgba(37, 99, 235, 0.05);
  border-color: var(--color-toggle-on, #2563eb);
  transform: translateY(-1px);
}

html.dark .stat_row {
  background-color: var(--bg-card, #2a2a2a);
  border-color: var(--border-color, #334155);
  border-left-color: var(--color-toggle-on, #38bdf8);
}
html.dark .stat_row.hoverable:hover {
  background: rgba(56, 189, 248, 0.08);
  border-color: var(--color-toggle-on, #38bdf8);
}

.stat_label {
  font-size: 11px;
  color: var(--text-dimmed, #64748b);
  margin-bottom: 2px;
  font-weight: 500;
  width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
}
html.dark .stat_label {
  color: #94a3b8;
}

.stat_value {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-color, #0f172a);
  width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
}
html.dark .stat_value {
  color: var(--text-color, #f8fafc);
}

.stat_value.highlight {
  color: var(--color-toggle-on, #2563eb);
}
html.dark .stat_value.highlight {
  color: #38bdf8;
}
.text_positive {
  color: #16a34a;
}
html.dark .text_positive {
  color: #4ade80;
}
.text_negative {
  color: #dc2626;
}
html.dark .text_negative {
  color: #f87171;
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
    grid-template-columns: repeat(2, minmax(0, 1fr));
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
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 5px;
  }
  .stat_row {
    padding: 5px 6px;
    min-height: 42px;
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
  background-color: var(--bg-card, #f8fafc);
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 8px;
  padding: 16px;
  box-sizing: border-box;
}
html.dark .rank_chart_section {
  background-color: var(--bg-modal, #1e1e1e);
  border-color: var(--border-color, #334155);
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
  stroke-width: 28;
  filter: brightness(1.1);
}
.donut_segment_text {
  font-size: 10px;
  font-weight: 700;
  fill: #ffffff;
  pointer-events: none;
  user-select: none;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.7));
}
.chart_center_label {
  font-size: 11px;
  fill: #64748b;
  font-weight: 500;
}
.chart_center_value {
  font-size: 16px;
  fill: #0f172a;
  font-weight: bold;
}
.chart_center_sub {
  font-size: 11px;
  fill: #2563eb;
  font-weight: bold;
}
html.dark .chart_center_label {
  fill: #94a3b8;
}
html.dark .chart_center_value {
  fill: #f8fafc;
}
html.dark .chart_center_sub {
  fill: #38bdf8;
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
  background: var(--card-bg-color, #ffffff);
  border: 1px solid var(--border-color, #e2e8f0);
  transition: all 0.2s;
}
.rank_detail_card.highlighted {
  border-color: var(--color-toggle-on, #2563eb);
  background: rgba(37, 99, 235, 0.05);
}
html.dark .rank_detail_card {
  background: rgba(255, 255, 255, 0.03);
  border-color: var(--border-color, #334155);
}
html.dark .rank_detail_card.highlighted {
  border-color: #38bdf8;
  background: rgba(56, 189, 248, 0.1);
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
  color: var(--text-color, #0f172a);
}
html.dark .rank_count_val {
  color: var(--text-color, #f8fafc);
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
html.dark .rank_bar_track {
  background: rgba(255, 255, 255, 0.1);
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
  background: var(--bg-card, #f8fafc);
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 6px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
}
html.dark .summary_metric_box {
  background: rgba(255, 255, 255, 0.03);
  border-color: var(--border-color, #334155);
}
.metric_label {
  color: var(--text-dimmed, #64748b);
}
html.dark .metric_label {
  color: #94a3b8;
}
.metric_val {
  font-weight: bold;
  color: var(--text-color, #0f172a);
}
html.dark .metric_val {
  color: var(--text-color, #f8fafc);
}

/* 모달 스코프 탭 (이번 회차 / 전체 기간) */
.modal_scope_tabs {
  display: flex;
  gap: 6px;
  background: #f1f5f9;
  padding: 3px;
  border-radius: 8px;
  margin-bottom: 12px;
}
.modal_scope_tab {
  flex: 1;
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 700;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--text-dimmed, #64748b);
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: center;
}
.modal_scope_tab:hover {
  color: var(--text-color, #0f172a);
}
.modal_scope_tab.active {
  background: #ffffff;
  color: var(--color-toggle-on, #2563eb);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
}
.session_modal_content {
  padding: 10px 0;
}
.no_data_modal {
  text-align: center;
  padding: 30px 10px;
  color: var(--text-dimmed, #888);
  font-size: 13px;
}
.legacy_session_banner {
  background: #f8fafc;
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 13px;
  color: var(--text-dimmed, #64748b);
  line-height: 1.5;
  margin-bottom: 16px;
  text-align: center;
}
html.dark .legacy_session_banner {
  background: rgba(255, 255, 255, 0.03);
  border-color: rgba(255, 255, 255, 0.1);
  color: #94a3b8;
}
.session_modal_rank_section {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--border-color, #e2e8f0);
}
html.dark .session_modal_rank_section {
  border-top-color: var(--border-color, #334155);
}
.session_rank_title {
  font-size: 12px;
  font-weight: bold;
  margin-bottom: 8px;
  color: var(--text-dimmed, #64748b);
}
html.dark .session_rank_title {
  color: #94a3b8;
}
.session_rank_badges_row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

html.dark .session-scope-tabs,
html.dark .modal_scope_tabs {
  background: rgba(255, 255, 255, 0.06);
}
html.dark .session-scope-tab {
  color: #94a3b8;
}
html.dark .session-scope-tab:hover {
  color: #f8fafc;
}
html.dark .modal_scope_tab {
  color: #94a3b8;
}
html.dark .modal_scope_tab:hover {
  color: #f8fafc;
}
html.dark .session-scope-tab.active,
html.dark .modal_scope_tab.active {
  background: #1e293b;
  color: #38bdf8;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
}

.modal-fade-enter-active, .modal-fade-leave-active {
  transition: opacity 0.2s ease;
}
.modal-fade-enter-from, .modal-fade-leave-to {
  opacity: 0;
}

/* ============================================== */
/* 회차 대국 상세 모달 (결과 표 & 점수 변동 차트)    */
/* ============================================== */
.clickable-game-card {
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
}
.clickable-game-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08);
  border-color: var(--color-toggle-on, #3b82f6);
}
.game-card-action-hint {
  font-size: 11px;
  color: var(--color-toggle-on, #3b82f6);
  font-weight: 600;
  margin-left: auto;
  margin-right: 10px;
  opacity: 0.9;
}
.clickable-game-card:hover .game-card-action-hint {
  text-decoration: underline;
  opacity: 1;
}

.game-detail-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2100;
  padding: 16px;
}
.game-detail-modal-card {
  background: var(--bg-modal, #ffffff);
  color: var(--text-color, #0f172a);
  border-radius: 12px;
  width: 100%;
  max-width: 580px;
  max-height: 90vh;
  overflow-y: auto;
  padding: 16px 20px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.15);
  border: 1px solid var(--border-color, #e2e8f0);
}
html.dark .game-detail-modal-card {
  background: var(--bg-modal, #1e1e1e);
  color: var(--text-color, #e5e5e5);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);
  border-color: var(--border-color, #334155);
}

.gdm-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  gap: 8px;
}
.gdm-title-box {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.gdm-session-badge {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 4px;
  font-weight: 600;
  background: #e0f2fe;
  color: #0369a1;
}
html.dark .gdm-session-badge {
  background: #0c4a6e;
  color: #7dd3fc;
}
.gdm-title {
  font-size: 16px;
  font-weight: 700;
  margin: 0;
}
.gdm-time {
  font-size: 12px;
  color: var(--text-dimmed, #64748b);
}
.gdm-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.gdm-tabs {
  display: inline-flex;
  align-items: center;
  flex-wrap: nowrap;
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: none;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 6px;
  padding: 2px;
}
.gdm-tabs::-webkit-scrollbar {
  display: none;
}
html.dark .gdm-tabs {
  background: rgba(255, 255, 255, 0.08);
}
.gdm-tab-btn {
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  background: transparent;
  color: var(--text-dimmed, #64748b);
  transition: all 0.15s ease;
  white-space: nowrap;
  flex-shrink: 0;
  line-height: 1.25;
}
html.dark .gdm-tab-btn {
  color: #94a3b8;
}
.gdm-tab-btn.active {
  background: #ffffff;
  color: #0f172a;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}
html.dark .gdm-tab-btn.active {
  background: #334155;
  color: #f8fafc;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}
.gdm-close-btn {
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: var(--text-dimmed, #64748b);
  padding: 4px 8px;
  border-radius: 4px;
  transition: color 0.15s;
}
.gdm-close-btn:hover {
  color: var(--text-color, #0f172a);
}
html.dark .gdm-close-btn:hover {
  color: #ffffff;
}

.gdm-loading-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 11.5px;
  color: #0284c7;
  background: rgba(2, 132, 199, 0.08);
  padding: 4px 8px;
  border-radius: 4px;
  margin-bottom: 8px;
}
html.dark .gdm-loading-badge {
  color: #38bdf8;
  background: rgba(56, 189, 248, 0.1);
}
.gdm-spinner {
  width: 11px;
  height: 11px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: gdmSpin 0.7s linear infinite;
  display: inline-block;
}
@keyframes gdmSpin {
  to { transform: rotate(360deg); }
}

.gdm-resultsheet {
  display: grid;
  grid-template-rows: auto auto;
  grid-template-columns: 44px minmax(65px, 1.1fr) minmax(105px, 1.3fr) minmax(115px, 1.5fr) repeat(4, 40px);
  grid-template-areas:
    'wind name rating score riichi ron tsumo lose'
    'wind_contents name_contents rating_contents score_contents riichi_contents ron_contents tsumo_contents lose_contents';
  text-align: center;
  font-size: 15px;
  margin: 6px 0;
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 8px;
  overflow-x: auto;
  background: var(--bg-card, #f8fafc);
  user-select: none;
}
html.dark .gdm-resultsheet {
  background: #18181b;
  border-color: #334155;
}
.gdm-resultsheet.clickable-view {
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
}
.gdm-resultsheet.clickable-view:hover {
  border-color: var(--color-toggle-on, #3b82f6);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}
.gdm-header-cell {
  font-weight: 700;
  padding: 8px 2px;
  font-size: 12.5px;
  color: var(--text-dimmed, #64748b);
  background: rgba(0, 0, 0, 0.03);
  border-bottom: 1px solid var(--border-color, #e2e8f0);
  box-sizing: border-box;
}
html.dark .gdm-header-cell {
  background: rgba(255, 255, 255, 0.04);
  border-color: #334155;
  color: #94a3b8;
}
.gdm-content-col > div {
  height: 38px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  border-bottom: 1px solid var(--border-color, #e2e8f0);
  font-size: 14px;
  white-space: nowrap;
}
html.dark .gdm-content-col > div {
  border-color: #27272a;
}
.gdm-content-col > div:last-child {
  border-bottom: none;
}
.gdm-content-col.wind_contents > div.is-east {
  color: #ef4444;
  font-weight: 700;
}
.gdm-content-col.name_contents > div {
  font-weight: 600;
  padding: 0 4px;
}
.gdm-content-col.score_contents > div {
  font-size: 13px;
  font-weight: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
}
.gdm-content-col.rating_contents > div {
  font-size: 13px;
  font-weight: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
}
.gdm-rating-val {
  font-weight: 800;
  font-size: 13px;
}
.gdm-rating-delta {
  font-size: 11.5px;
  font-weight: 700;
}
.text_pos {
  color: #16a34a;
  font-weight: 600;
}
html.dark .text_pos {
  color: #4ade80;
}
.text_neg {
  color: #dc2626;
  font-weight: 600;
}
html.dark .text_neg {
  color: #f87171;
}

.gdm-chart-box {
  width: 100%;
  max-width: 520px;
  height: 270px;
  margin: 6px auto;
  position: relative;
  box-sizing: border-box;
  background: var(--bg-card, #f8fafc);
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 8px;
  padding: 8px;
}
html.dark .gdm-chart-box {
  background: #18181b;
  border-color: #334155;
}
.gdm-chart-box.clickable-view {
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
}
.gdm-chart-box.clickable-view:hover {
  border-color: var(--color-toggle-on, #3b82f6);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}
.gdm-empty-chart {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-dimmed, #64748b);
  font-size: 13px;
}
html.dark .gdm-empty-chart {
  color: #94a3b8;
}

.gdm-hint {
  font-size: 12px;
  color: var(--color-toggle-on, #3b82f6);
  text-align: center;
  margin-top: 8px;
  cursor: pointer;
  user-select: none;
  font-weight: 500;
}
.gdm-hint:hover {
  text-decoration: underline;
}
html.dark .gdm-hint {
  color: #60a5fa;
}
.gdm-legacy-notice {
  font-size: 11.5px;
  color: var(--text-dimmed, #64748b);
  text-align: center;
  margin-top: 8px;
  line-height: 1.4;
  padding: 6px 10px;
  background: rgba(0, 0, 0, 0.02);
  border-radius: 6px;
}
html.dark .gdm-legacy-notice {
  background: rgba(255, 255, 255, 0.03);
  color: #94a3b8;
}

@media (max-width: 600px) {
  .game-detail-modal-overlay {
    padding: 8px;
  }
  .game-detail-modal-card {
    padding: 12px 8px;
    max-width: 98vw;
  }
  .gdm-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
  .gdm-actions {
    width: 100%;
    justify-content: space-between;
    gap: 6px;
  }
  .gdm-tabs {
    flex: 1;
    min-width: 0;
  }
  .gdm-tab-btn {
    flex: 1;
    padding: 5px 6px;
    font-size: 11px;
    text-align: center;
    white-space: nowrap;
  }
  .gdm-close-btn {
    flex-shrink: 0;
  }
  .gdm-resultsheet {
    grid-template-columns: 24px minmax(42px, 0.8fr) minmax(68px, 1.25fr) minmax(78px, 1.4fr) repeat(4, 22px);
    font-size: 11px;
  }
  .gdm-header-cell {
    height: 30px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    padding: 0 1px;
    white-space: nowrap;
    letter-spacing: -0.4px;
  }
  .gdm-content-col > div {
    height: 36px;
    box-sizing: border-box;
    padding: 0 1px;
    font-size: 11px;
    overflow: hidden;
  }
  .gdm-content-col.name_contents > div {
    font-size: 10.5px;
    padding: 0 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .gdm-content-col.rating_contents > div,
  .gdm-content-col.score_contents > div {
    flex-direction: row;
    gap: 1.5px;
    padding: 0 1px;
    letter-spacing: -0.3px;
    white-space: nowrap;
  }
  .gdm-rating-val {
    font-size: 10.5px;
    font-weight: 800;
  }
  .gdm-rating-delta {
    font-size: 9.5px;
  }
  .gdm-score-val {
    font-size: 10.5px;
    font-weight: 600;
  }
  .gdm-score-uma {
    font-size: 9.5px;
  }
  .gdm-chart-box {
    height: 220px;
  }
}

/* ========================================== */
/* 레이팅 탭 및 시스템 안내 스타일               */
/* ========================================== */
.tab-rating {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.rating-chart-card,
.rating-leaderboard-card,
.rating-guide-card {
  background-color: var(--card-bg-color, #ffffff);
  border: 1px solid var(--border-color, #eaeaea);
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.rating-chart-header,
.leaderboard-header,
.guide-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 12px;
}

.rating-chart-title-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.rating-section-title {
  font-size: 17px;
  font-weight: 800;
  margin: 0;
  color: var(--text-color, #1a1a1a);
}

.rating-section-desc {
  font-size: 12px;
  color: #64748b;
}

.rating-filter-buttons {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.btn-rating-filter {
  padding: 5px 10px;
  font-size: 11.5px;
  font-weight: 600;
  border-radius: 5px;
  border: 1px solid var(--border-color, #cbd5e1);
  background: var(--bg-color, #f8fafc);
  color: var(--text-color, #334155);
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-rating-filter:hover {
  background: #3b82f6;
  color: #ffffff;
  border-color: #3b82f6;
}

.btn-rating-filter.active {
  background: #3b82f6 !important;
  color: #ffffff !important;
  border-color: #2563eb !important;
  font-weight: 700;
  box-shadow: 0 1px 3px rgba(59, 130, 246, 0.35);
}

html.dark .btn-rating-filter {
  background: #27272a;
  color: #e4e4e7;
  border-color: #3f3f46;
}
html.dark .btn-rating-filter:hover {
  background: #3b82f6;
  color: #ffffff;
  border-color: #60a5fa;
}
html.dark .btn-rating-filter.active {
  background: #3b82f6 !important;
  color: #ffffff !important;
  border-color: #60a5fa !important;
}

.rating-chart-wrapper {
  position: relative;
  width: 100%;
}

.rating-chart-empty {
  text-align: center;
  color: #94a3b8;
  padding: 50px 0;
  font-size: 13px;
}

/* 레이팅 테이블 */
.rating-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.rating-table th {
  padding: 10px 12px;
  background-color: var(--table-header-bg, #f8fafc);
  color: #475569;
  font-weight: 700;
  border-bottom: 1px solid var(--border-color, #e2e8f0);
}

.rating-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-color, #e2e8f0);
}

.rating-table tr:hover {
  background-color: var(--bg-hover, rgba(59, 130, 246, 0.05));
}

.rating-badge-pill {
  display: inline-block;
  font-size: 12px;
  font-weight: 800;
  color: #2563eb;
  background-color: rgba(37, 99, 235, 0.12);
  padding: 2px 7px;
  border-radius: 4px;
}

html.dark .rating-badge-pill {
  color: #60a5fa;
  background-color: rgba(96, 165, 250, 0.18);
}

/* 수식 안내 카드 */
.formula-cards-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 20px;
  width: 100%;
  box-sizing: border-box;
}

@media (max-width: 1024px) {
  .formula-cards-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.formula-box {
  background: var(--bg-color, #f8fafc);
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 8px;
  padding: 14px;
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
  overflow: hidden;
}

.formula-tag {
  font-size: 11px;
  font-weight: 700;
  color: #3b82f6;
  margin-bottom: 8px;
}

.formula-latex {
  font-family: 'Cambria Math', 'KaTeX_Math', 'Times New Roman', serif;
  font-size: clamp(12px, 1.3vw, 14.5px);
  font-weight: bold;
  background: rgba(0, 0, 0, 0.03);
  padding: 8px 10px;
  border-radius: 6px;
  text-align: center;
  margin-bottom: 8px;
  color: var(--text-color, #0f172a);
  max-width: 100%;
  overflow-x: auto;
  box-sizing: border-box;
}

.formula-latex :deep(.katex-display) {
  margin: 0.25em 0;
  overflow-x: auto;
  overflow-y: hidden;
  max-width: 100%;
}

html.dark .formula-latex {
  background: rgba(255, 255, 255, 0.06);
}

.formula-explanation {
  font-size: 12px;
  color: #64748b;
  margin: 0;
  line-height: 1.5;
}

/* 파라미터 테이블 */
.param-table-container {
  overflow-x: auto;
}

.param-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}

.param-table th,
.param-table td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color, #e2e8f0);
  text-align: left;
}

.param-table th {
  background-color: var(--table-header-bg, #f8fafc);
  color: #475569;
  font-weight: 700;
}

.param-table code {
  font-family: Consolas, monospace;
  font-weight: bold;
  color: #2563eb;
  background: rgba(37, 99, 235, 0.08);
  padding: 1px 5px;
  border-radius: 3px;
}

.param-math {
  display: inline-flex;
  align-items: center;
  font-weight: bold;
}

/* 레이팅 완충 및 수렴 안내 콜아웃 */
.rating-buffer-callout {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.05) 0%, rgba(37, 99, 235, 0.08) 100%);
  border: 1px solid rgba(59, 130, 246, 0.2);
  border-radius: 10px;
  padding: 16px;
  margin-bottom: 20px;
}
html.dark .rating-buffer-callout {
  background: linear-gradient(135deg, rgba(30, 58, 138, 0.25) 0%, rgba(30, 41, 59, 0.4) 100%);
  border-color: rgba(96, 165, 250, 0.25);
}
.rbc-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.rbc-icon {
  font-size: 18px;
}
.rbc-title {
  font-size: 14.5px;
  font-weight: 800;
  color: var(--text-color, #0f172a);
  margin: 0;
}
.rbc-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.rbc-step {
  background: var(--card-bg-color, #ffffff);
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 8px;
  padding: 12px 14px;
}
html.dark .rbc-step {
  background: rgba(255, 255, 255, 0.03);
  border-color: rgba(255, 255, 255, 0.08);
}
.rbc-step-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.rbc-step-badge {
  font-size: 10.5px;
  font-weight: 800;
  padding: 2px 7px;
  border-radius: 4px;
  background: rgba(37, 99, 235, 0.12);
  color: #2563eb;
}
html.dark .rbc-step-badge {
  background: rgba(96, 165, 250, 0.2);
  color: #93c5fd;
}
.rbc-step-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-color, #0f172a);
}
.rbc-step p {
  font-size: 12.5px;
  color: var(--text-dimmed, #475569);
  line-height: 1.6;
  margin: 0 0 6px 0;
}
.rbc-step p:last-child {
  margin-bottom: 0;
}
html.dark .rbc-step p {
  color: #cbd5e1;
}
.rbc-highlight {
  font-weight: 600;
  color: #1e40af !important;
}
html.dark .rbc-highlight {
  color: #93c5fd !important;
}

/* 플레이어 모달 레이팅 탭 스타일 */
.rating_tab_wrapper {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
}

.rating_summary_grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 14px;
}

@media (max-width: 600px) {
  .rating_summary_grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

.summary_stat_box {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: var(--card-bg-color, #ffffff);
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 8px;
  padding: 10px 8px;
  text-align: center;
  gap: 4px;
}
html.dark .summary_stat_box {
  background-color: #27272a;
  border-color: #3f3f46;
}
.summary_label {
  font-size: 11.5px;
  color: var(--text-dimmed, #64748b);
  font-weight: 600;
  white-space: nowrap;
}
html.dark .summary_label {
  color: #94a3b8;
}
.summary_value {
  font-size: 16px;
  font-weight: 800;
  color: var(--text-color, #0f172a);
  font-family: inherit;
  line-height: 1.2;
}
html.dark .summary_value {
  color: #f4f4f5;
}

.sm-points-col {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: center;
  gap: 2px;
  text-align: right;
}
.sm-rating-delta {
  font-size: 11px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.sm-rating-val {
  font-weight: 800;
}
.sm-rdelta {
  font-size: 10.5px;
  font-weight: 600;
}
.sm-rdelta.pos {
  color: #16a34a;
}
html.dark .sm-rdelta.pos {
  color: #4ade80;
}
.sm-rdelta.neg {
  color: #dc2626;
}
html.dark .sm-rdelta.neg {
  color: #f87171;
}

.rating_chart_container {
  background-color: var(--card-bg-color, #ffffff);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 12px;
  box-sizing: border-box;
}

.no_rating_data {
  text-align: center;
  color: #94a3b8;
  padding: 40px 0;
  font-size: 13px;
}

/* 레이팅 인라인 차트 카드 */
.rating-chart-card {
  background-color: var(--card-bg-color, #ffffff);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}
.rating-chart-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 14px;
  gap: 12px;
}
.rating-chart-title-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.rating-chart-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border-color, #e2e8f0);
}
.rating-inline-chart-wrapper {
  width: 100%;
  height: 440px;
  position: relative;
  overflow: hidden;
}
@media (max-width: 640px) {
  .rating-inline-chart-wrapper {
    height: 340px;
  }
}
.rating-inline-chart-inner {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  height: 100%;
}

.btn-open-rating-modal {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  font-size: 12.5px;
  font-weight: 700;
  color: #ffffff !important;
  background-color: #4f46e5;
  border: 1px solid #4338ca;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
  font-family: inherit;
  box-shadow: 0 1px 3px rgba(79, 70, 229, 0.25);
}
.btn-open-rating-modal:hover {
  background-color: #4338ca;
  transform: translateY(-1px);
  box-shadow: 0 3px 6px rgba(79, 70, 229, 0.35);
}
html.dark .btn-open-rating-modal {
  background-color: #6366f1;
  border-color: #818cf8;
}
html.dark .btn-open-rating-modal:hover {
  background-color: #4f46e5;
}

/* 레이팅 변동 추이 전용 모달 */
.rating-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2200;
  padding: 16px;
  backdrop-filter: blur(4px);
}
.rating-modal-card {
  background: var(--card-bg-color, #ffffff);
  color: var(--text-color, #0f172a);
  border-radius: 12px;
  width: 95vw;
  max-width: 860px;
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  padding: 18px 22px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.25);
  border: 1px solid var(--border-color, #e2e8f0);
  box-sizing: border-box;
  overflow: hidden;
}
html.dark .rating-modal-card {
  background: var(--bg-modal, #18181b);
  color: var(--text-color, #f4f4f5);
  border-color: var(--border-color, #27272a);
}

.rating-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
  gap: 12px;
}
.rating-modal-title-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.rating-modal-title {
  margin: 0;
  font-size: 17px;
  font-weight: 800;
  letter-spacing: -0.02em;
}
.rating-modal-subtitle {
  font-size: 11.5px;
  color: var(--text-dimmed, #64748b);
}

/* 툴바 */
.rating-modal-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border-color, #e2e8f0);
}
.toolbar-left, .toolbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.toolbar-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-dimmed, #64748b);
  margin-right: 2px;
}
.session-filter-group {
  display: flex;
  align-items: center;
  gap: 4px;
}
.session-filter-select {
  padding: 4px 8px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 4px;
  border: 1px solid var(--border-color, #cbd5e1);
  background: var(--card-bg-color, #ffffff);
  color: var(--text-color, #0f172a);
  font-family: inherit;
  cursor: pointer;
}
html.dark .session-filter-select {
  background: #27272a;
  color: #f4f4f5;
  border-color: #3f3f46;
}
.btn-zoom-reset {
  padding: 4px 9px;
  font-size: 11.5px;
  font-weight: 700;
  border-radius: 4px;
  border: 1px solid var(--border-color, #cbd5e1);
  background: var(--card-bg-color, #ffffff);
  color: var(--text-color, #0f172a);
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-zoom-reset:hover {
  background: rgba(0, 0, 0, 0.05);
}
html.dark .btn-zoom-reset {
  background: #27272a;
  color: #f4f4f5;
  border-color: #3f3f46;
}
html.dark .btn-zoom-reset:hover {
  background: #3f3f46;
}

/* 차트 래퍼 */
.rating-modal-chart-wrapper {
  width: 100%;
  height: 540px;
  min-height: 460px;
  position: relative;
  overflow: hidden;
}
@media (max-width: 640px) {
  .rating-modal-chart-wrapper {
    height: 400px;
    min-height: 350px;
  }
}
.rating-modal-chart-inner {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  height: 100%;
}

/* 모바일 환경에서 차트 터치 시 세로 스크롤 허용 (Hammer.js touch-action: none 무력화) */
.rating-inline-chart-inner :deep(canvas),
.rating-modal-chart-inner :deep(canvas),
#rating-inline-chart-canvas,
#rating-modal-chart-canvas {
  touch-action: pan-y !important;
}

/* ===================================================== */
/* 역만 / 화료 / 회차 사진 갤러리 & 개인 역만 탭 스타일 */
/* ===================================================== */
.session-gallery-card {
  margin-bottom: 1.5rem;
}
.session-gallery-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 1rem;
}
.session-gallery-header h3 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 800;
}
.session-gallery-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.btn-upload-highlight,
.btn-upload-yakuman {
  padding: 0.45rem 0.85rem;
  border-radius: 8px;
  font-size: 0.82rem;
  font-weight: 700;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.2s ease;
}
.btn-upload-highlight {
  background: var(--accent, #2563eb);
  color: #fff;
}
.btn-upload-highlight:hover {
  opacity: 0.92;
}
.btn-upload-yakuman {
  background: linear-gradient(135deg, #d97706, #b45309);
  color: #fff;
}
.btn-upload-yakuman:hover {
  opacity: 0.92;
}
.btn-pin-admin {
  padding: 0.45rem 0.85rem;
  border-radius: 8px;
  font-size: 0.82rem;
  font-weight: 700;
  cursor: pointer;
  background: var(--bg-soft, #f1f5f9);
  color: var(--text-primary, #1e293b);
  border: 1px solid var(--border-color, #cbd5e1);
}
html.dark .btn-pin-admin {
  background: #27272a;
  color: #f4f4f5;
  border-color: #3f3f46;
}
.session-gallery-empty {
  text-align: center;
  padding: 1.5rem 1rem;
  color: var(--text-muted, #64748b);
  font-size: 0.88rem;
  background: var(--bg-soft, rgba(148, 163, 184, 0.08));
  border-radius: 10px;
}

.highlight-gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 1rem;
}
.session-gallery-grid {
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
}
.highlight-card {
  background: var(--card-bg, #ffffff);
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
  display: flex;
  flex-direction: column;
}
html.dark .highlight-card {
  background: #18181b;
  border-color: #27272a;
}
.highlight-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.12);
}
.highlight-thumb-wrap {
  width: 100%;
  aspect-ratio: 16 / 10;
  background: var(--bg-soft, #f1f5f9);
  overflow: hidden;
  position: relative;
}
html.dark .highlight-thumb-wrap {
  background: #1e293b;
}
.highlight-thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.highlight-no-img {
  width: 100%;
  aspect-ratio: 16 / 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, rgba(217, 119, 6, 0.15), rgba(180, 83, 9, 0.25));
  gap: 0.35rem;
}
.no-img-icon {
  font-size: 2rem;
}
.no-img-label {
  font-size: 0.82rem;
  font-weight: 700;
  color: #d97706;
}
.highlight-card-body {
  padding: 0.75rem 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.highlight-badges-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  align-items: center;
}
.badge-session,
.badge-game,
.badge-round,
.badge-yakuman,
.badge-fun,
.badge-session-photo,
.badge-round-sm,
.badge-yakuman-sm,
.badge-fun-sm,
.badge-session-sm {
  display: inline-flex;
  align-items: center;
  padding: 0.18rem 0.48rem;
  border-radius: 6px;
  font-size: 0.74rem;
  font-weight: 700;
}
.badge-session {
  background: rgba(37, 99, 235, 0.12);
  color: #2563eb;
}
html.dark .badge-session {
  background: rgba(59, 130, 246, 0.2);
  color: #60a5fa;
}
.badge-game,
.badge-round,
.badge-round-sm {
  background: rgba(100, 116, 139, 0.14);
  color: var(--text-secondary, #475569);
}
html.dark .badge-game,
html.dark .badge-round,
html.dark .badge-round-sm {
  background: rgba(148, 163, 184, 0.18);
  color: #cbd5e1;
}
.badge-yakuman,
.badge-yakuman-sm {
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: #fff;
}
.badge-fun,
.badge-fun-sm {
  background: rgba(16, 185, 129, 0.15);
  color: #047857;
  border: 1px solid rgba(16, 185, 129, 0.35);
}
html.dark .badge-fun,
html.dark .badge-fun-sm {
  background: rgba(16, 185, 129, 0.22);
  color: #34d399;
  border-color: rgba(52, 211, 153, 0.4);
}
.badge-session-photo,
.badge-session-sm {
  background: rgba(139, 92, 246, 0.15);
  color: #7c3aed;
}
html.dark .badge-session-photo,
html.dark .badge-session-sm {
  background: rgba(139, 92, 246, 0.22);
  color: #a78bfa;
}
.highlight-players-line {
  font-size: 0.82rem;
  color: var(--text-primary, #1e293b);
}
html.dark .highlight-players-line {
  color: #e4e4e7;
}
.highlight-loser {
  color: var(--text-muted, #64748b);
  margin-left: 0.25rem;
}
.highlight-note-text {
  margin: 0;
  font-size: 0.8rem;
  color: var(--text-muted, #64748b);
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 갤러리 탭 상단 & 역만 보드 */
.gallery-top-card {
  margin-bottom: 1.5rem;
}
.gallery-top-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 1rem;
  margin-bottom: 1rem;
}
.gallery-top-header h2 {
  margin: 0 0 0.3rem 0;
  font-size: 1.25rem;
}
.gallery-sub-desc {
  margin: 0;
  font-size: 0.85rem;
  color: var(--text-muted, #64748b);
}
.gallery-top-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.gallery-filters-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--border-color, #e2e8f0);
}
.gallery-cat-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.gallery-cat-btn {
  padding: 0.4rem 0.8rem;
  border-radius: 8px;
  font-size: 0.82rem;
  font-weight: 700;
  border: 1px solid var(--border-color, #cbd5e1);
  background: transparent;
  color: var(--text-secondary, #475569);
  cursor: pointer;
}
.gallery-cat-btn.active {
  background: var(--accent, #2563eb);
  color: #fff;
  border-color: var(--accent, #2563eb);
}
.gallery-selects {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.gallery-filter-select {
  padding: 0.4rem 0.65rem;
  border-radius: 8px;
  font-size: 0.82rem;
  border: 1px solid var(--border-color, #cbd5e1);
  background: var(--card-bg, #fff);
  color: var(--text-primary, #1e293b);
}
html.dark .gallery-filter-select {
  background: #18181b;
  color: #f4f4f5;
  border-color: #3f3f46;
}

.yakuman-summary-board-card {
  margin-bottom: 1.5rem;
}
.yakuman-board-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 1rem;
}
.yakuman-board-header h3 {
  margin: 0;
  font-size: 1.05rem;
}
.yakuman-board-controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
}
.yakuman-grid-17 {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 0.55rem;
}
.yakuman-type-box {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.55rem 0.75rem;
  border-radius: 8px;
  background: var(--bg-soft, #f8fafc);
  border: 1px solid var(--border-color, #e2e8f0);
  font-size: 0.83rem;
}
html.dark .yakuman-type-box {
  background: #27272a;
  border-color: #3f3f46;
}
.yakuman-type-box.has-achieved {
  border-color: #f59e0b;
  background: rgba(245, 158, 11, 0.1);
}
.yakuman-type-name {
  font-weight: 600;
}
.yakuman-type-count {
  font-weight: 800;
  color: var(--text-muted, #64748b);
}
.yakuman-type-box.has-achieved .yakuman-type-count {
  color: #d97706;
}

/* 개인 상세 모달 내 역만 탭 */
.yakuman_tab_wrapper {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.yakuman_summary_bar {
  padding: 0.65rem 0.9rem;
  border-radius: 8px;
  background: rgba(245, 158, 11, 0.12);
  border: 1px solid rgba(245, 158, 11, 0.35);
  font-size: 0.88rem;
  color: var(--text-primary, #1e293b);
}
html.dark .yakuman_summary_bar {
  color: #fde68a;
}
.yakuman-achieved-row {
  background: rgba(245, 158, 11, 0.08);
}
.yakuman_records_section {
  margin-top: 0.5rem;
}
.yakuman_records_title {
  font-size: 0.85rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
}
.yakuman_records_list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.yakuman_record_item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.55rem 0.75rem;
  border-radius: 8px;
  border: 1px solid var(--border-color, #e2e8f0);
  cursor: pointer;
}
html.dark .yakuman_record_item {
  border-color: #3f3f46;
}
.yakuman_record_thumb {
  width: 56px;
  height: 42px;
  object-fit: cover;
  border-radius: 6px;
  flex-shrink: 0;
}
.yakuman_record_info {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.yakuman_record_badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}
.yakuman_record_meta {
  font-size: 0.76rem;
  color: var(--text-muted, #64748b);
}
.yakuman_record_note {
  font-size: 0.78rem;
}

/* 경기 상세 모달 내 하이라이트 박스 */
.gdm-highlights-box {
  margin-top: 1rem;
  padding-top: 0.85rem;
  border-top: 1px solid var(--border-color, #e2e8f0);
}
html.dark .gdm-highlights-box {
  border-top-color: #27272a;
}
.gdm-highlights-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.6rem;
}
.gdm-highlights-title {
  font-size: 0.86rem;
  font-weight: 700;
}
.btn-add-highlight-sm {
  padding: 0.32rem 0.68rem;
  border-radius: 6px;
  font-size: 0.76rem;
  font-weight: 700;
  background: linear-gradient(135deg, #d97706, #b45309);
  color: #fff;
  border: none;
  cursor: pointer;
}
.gdm-highlights-list {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.gdm-highlight-item {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.45rem 0.65rem;
  border-radius: 8px;
  background: var(--bg-soft, #f8fafc);
  border: 1px solid var(--border-color, #e2e8f0);
  cursor: pointer;
}
html.dark .gdm-highlight-item {
  background: #27272a;
  border-color: #3f3f46;
}
.gdm-highlight-thumb {
  width: 52px;
  height: 38px;
  object-fit: cover;
  border-radius: 5px;
  flex-shrink: 0;
}
.gdm-highlight-info {
  display: flex;
  flex-direction: column;
  gap: 0.18rem;
  font-size: 0.78rem;
}
.gdm-highlight-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

/* 업로드 모달 / 라이트박스 모달 / PIN 관리 모달 */
.highlight-upload-modal-card,
.pin-admin-modal-card {
  width: min(580px, 95vw);
  max-height: 90vh;
  overflow-y: auto;
  background: var(--card-bg, #ffffff);
  color: var(--text-primary, #1e293b);
  border-radius: 16px;
  border: 1px solid var(--border-color, #e2e8f0);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
}
html.dark .highlight-upload-modal-card,
html.dark .pin-admin-modal-card {
  background: #18181b;
  color: #f4f4f5;
  border-color: #27272a;
}
.highlight-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--border-color, #e2e8f0);
}
html.dark .highlight-modal-header {
  border-bottom-color: #27272a;
}
.highlight-modal-header h3 {
  margin: 0;
  font-size: 1.05rem;
}
.highlight-modal-body {
  padding: 1.15rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}
.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.form-row-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}
@media (max-width: 540px) {
  .form-row-2 {
    grid-template-columns: 1fr;
  }
}
.form-label {
  font-size: 0.82rem;
  font-weight: 700;
}
.sub-hint {
  font-weight: 400;
  font-size: 0.75rem;
  color: var(--text-muted, #64748b);
}
.form-select,
.form-input {
  padding: 0.5rem 0.7rem;
  border-radius: 8px;
  border: 1px solid var(--border-color, #cbd5e1);
  background: var(--card-bg, #fff);
  color: var(--text-primary, #1e293b);
  font-size: 0.85rem;
}
html.dark .form-select,
html.dark .form-input {
  background: #27272a;
  color: #f4f4f5;
  border-color: #3f3f46;
}
.round-input-group {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.category-radio-group {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.45rem;
}
@media (max-width: 520px) {
  .category-radio-group {
    grid-template-columns: 1fr;
  }
}
.cat-radio-btn {
  padding: 0.55rem 0.6rem;
  border-radius: 8px;
  border: 1px solid var(--border-color, #cbd5e1);
  background: transparent;
  color: var(--text-primary, #1e293b);
  font-size: 0.82rem;
  font-weight: 700;
  cursor: pointer;
}
html.dark .cat-radio-btn {
  color: #e4e4e7;
  border-color: #3f3f46;
}
.cat-radio-btn.active {
  background: var(--accent, #2563eb);
  color: #fff;
  border-color: var(--accent, #2563eb);
}
.yakuman-chips-selector {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.yakuman-select-chip {
  padding: 0.38rem 0.68rem;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 600;
  border: 1px solid var(--border-color, #cbd5e1);
  background: transparent;
  color: var(--text-primary, #1e293b);
  cursor: pointer;
}
html.dark .yakuman-select-chip {
  color: #e4e4e7;
  border-color: #3f3f46;
}
.yakuman-select-chip.selected {
  background: #d97706;
  color: #fff;
  border-color: #d97706;
}
.upload-preview-box {
  margin-top: 0.5rem;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.4rem;
}
.upload-preview-img {
  max-width: 100%;
  max-height: 220px;
  border-radius: 8px;
  border: 1px solid var(--border-color, #cbd5e1);
}
.btn-remove-preview {
  padding: 0.25rem 0.6rem;
  font-size: 0.76rem;
  border-radius: 6px;
  border: 1px solid #ef4444;
  color: #ef4444;
  background: transparent;
  cursor: pointer;
}
.upload-error-msg {
  color: #ef4444;
  font-size: 0.83rem;
  font-weight: 600;
}
.highlight-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  padding: 0.9rem 1.25rem;
  border-top: 1px solid var(--border-color, #e2e8f0);
}
html.dark .highlight-modal-footer {
  border-top-color: #27272a;
}
.btn-cancel-modal {
  padding: 0.5rem 1rem;
  border-radius: 8px;
  border: 1px solid var(--border-color, #cbd5e1);
  background: transparent;
  color: var(--text-primary, #1e293b);
  font-weight: 600;
  cursor: pointer;
}
html.dark .btn-cancel-modal {
  color: #e4e4e7;
  border-color: #3f3f46;
}
.btn-submit-modal {
  padding: 0.5rem 1.15rem;
  border-radius: 8px;
  border: none;
  background: var(--accent, #2563eb);
  color: #fff;
  font-weight: 700;
  cursor: pointer;
}
.btn-submit-modal:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* 라이트박스 모달 */
.lightbox-modal-card {
  position: relative;
  width: min(960px, 96vw);
  max-height: 92vh;
  max-height: min(92dvh, calc(var(--vvh, 100dvh) - 24px));
  overflow: hidden;
  background: var(--card-bg, #ffffff);
  color: var(--text-primary, #1e293b);
  border-radius: 16px;
  border: 1px solid var(--border-color, #e2e8f0);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
  display: flex;
  flex-direction: column;
}
html.dark .lightbox-modal-card {
  background: #18181b;
  color: #f4f4f5;
  border-color: #27272a;
}
.lightbox-header {
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.9rem 1.2rem;
  border-bottom: 1px solid var(--border-color, #e2e8f0);
}
html.dark .lightbox-header {
  border-bottom-color: #27272a;
}
.lightbox-title-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  align-items: center;
}
.lightbox-header-right {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}
.btn-share-highlight-header {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0.35rem 0.7rem;
  border-radius: 999px;
  border: 1px solid rgba(37, 99, 235, 0.38);
  background: rgba(37, 99, 235, 0.09);
  color: #2563eb;
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-share-highlight-header:hover {
  background: rgba(37, 99, 235, 0.18);
  border-color: #2563eb;
}
html.dark .btn-share-highlight-header {
  color: #60a5fa;
  border-color: rgba(96, 165, 250, 0.4);
  background: rgba(59, 130, 246, 0.14);
}
html.dark .btn-share-highlight-header:hover {
  background: rgba(59, 130, 246, 0.24);
}
.share-link-svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.lightbox-scroll-area {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
  scroll-behavior: smooth;
  -webkit-overflow-scrolling: touch;
}
.lightbox-img-container {
  flex-shrink: 0;
  position: relative;
  width: 100%;
  min-height: min(64vh, 540px);
  min-height: min(64dvh, 540px);
  min-height: min(calc(var(--vvh, 100dvh) * 0.64), 540px);
  background: linear-gradient(180deg, #141720 0%, #0f1219 100%);
  display: flex;
  justify-content: center;
  align-items: center;
  overflow: hidden;
  cursor: zoom-in;
}
.lightbox-img-container:not(.is-loaded)::before {
  content: '';
  position: absolute;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 2.5px solid rgba(148, 163, 184, 0.22);
  border-top-color: rgba(226, 232, 240, 0.85);
  animation: lightboxImgSpin 0.75s linear infinite;
  pointer-events: none;
}
@keyframes lightboxImgSpin {
  to {
    transform: rotate(360deg);
  }
}
.lightbox-full-img {
  max-width: 100%;
  max-height: min(74vh, 720px);
  max-height: min(74dvh, 720px);
  max-height: min(calc(var(--vvh, 100dvh) * 0.74), 720px);
  width: auto;
  height: auto;
  object-fit: contain;
  display: block;
  opacity: 0;
  transition: opacity 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.lightbox-full-img.is-loaded {
  opacity: 1;
}
@media (max-width: 640px) {
  .lightbox-modal-card {
    width: calc(100vw - 20px);
    max-height: calc(100vh - 20px);
    max-height: calc(100dvh - 20px);
    max-height: calc(var(--vvh, 100dvh) - 20px);
  }
  .lightbox-img-container {
    min-height: min(44vh, 380px);
    min-height: min(44dvh, 380px);
    min-height: min(calc(var(--vvh, 100dvh) * 0.44), 380px);
  }
  .lightbox-full-img {
    max-height: 62vh;
    max-height: 62dvh;
    max-height: calc(var(--vvh, 100dvh) * 0.62);
  }
}
.lightbox-info-footer {
  flex-shrink: 0;
  padding: 1rem 1.25rem 1.25rem;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  width: 100%;
  box-sizing: border-box;
  gap: 0.75rem;
}

/* 라이트박스 우하단 플로팅 댓글/아래 스크롤 이동 버튼 */
.lightbox-comment-fab {
  position: absolute;
  right: 16px;
  bottom: 16px;
  z-index: 35;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 48px;
  height: 46px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.26);
  background: linear-gradient(135deg, rgba(37, 99, 235, 0.94), rgba(29, 78, 216, 0.96));
  color: #ffffff;
  font-size: 13px;
  font-weight: 800;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.42);
  backdrop-filter: blur(6px);
  cursor: pointer;
  transition: transform 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
}
.lightbox-comment-fab:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 26px rgba(37, 99, 235, 0.45);
}
.lightbox-comment-fab:active {
  transform: translateY(0);
}
.lb-fab-icon-wrap {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.lb-fab-comment-svg {
  width: 17px;
  height: 17px;
  flex-shrink: 0;
}
.lb-fab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.22);
  color: #ffffff;
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
}
.lb-fab-arrow {
  font-size: 14px;
  font-weight: 900;
  line-height: 1;
}
.lb-fab-fade-enter-active,
.lb-fab-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.lb-fab-fade-enter-from,
.lb-fab-fade-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.92);
}

/* 라이트박스 사진 클릭 시 전체화면 크게 보기 모달 */
.modal-overlay.full-image-zoom-overlay {
  z-index: 2980;
  background: rgba(5, 5, 8, 0.94);
  padding: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.full-image-zoom-topbar {
  position: fixed;
  top: 14px;
  right: 16px;
  left: 16px;
  z-index: 2990;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 6px;
  pointer-events: none;
}
.btn-zoom-scale-toggle,
.btn-zoom-close {
  pointer-events: auto;
  padding: 7px 12px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(24, 24, 27, 0.85);
  color: #f8fafc;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  backdrop-filter: blur(6px);
  transition: background 0.15s ease, border-color 0.15s ease;
}
.btn-zoom-scale-toggle:hover,
.btn-zoom-close:hover {
  background: rgba(59, 130, 246, 0.72);
  border-color: rgba(147, 197, 253, 0.6);
}
.btn-zoom-scale-toggle.active {
  background: rgba(37, 99, 235, 0.95);
  border-color: rgba(147, 197, 253, 0.9);
  color: #ffffff;
}
.full-image-zoom-stage {
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  height: var(--vvh, 100dvh);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 56px 16px 16px;
  box-sizing: border-box;
  -webkit-overflow-scrolling: touch;
}
.full-image-zoom-stage.fit-width {
  align-items: flex-start;
  justify-content: center;
}
.full-image-zoom-stage.fit-height {
  align-items: center;
  justify-content: flex-start;
}
.full-image-zoom-stage.fit-original {
  align-items: flex-start;
  justify-content: flex-start;
}
.full-image-zoom-img {
  display: block;
  margin: auto;
  cursor: zoom-in;
  user-select: none;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.65);
}
.full-image-zoom-img.fit-contain {
  max-width: 96vw;
  max-height: 90vh;
  max-height: 90dvh;
  max-height: calc(var(--vvh, 100dvh) * 0.9);
  width: auto;
  height: auto;
  object-fit: contain;
}
.full-image-zoom-img.fit-width {
  width: 96vw;
  height: auto;
  max-width: none;
  max-height: none;
  cursor: zoom-out;
}
.full-image-zoom-img.fit-height {
  height: 90vh;
  height: 90dvh;
  height: calc(var(--vvh, 100dvh) * 0.9);
  width: auto;
  max-width: none;
  max-height: none;
  cursor: zoom-out;
}
.full-image-zoom-img.fit-original {
  width: auto;
  height: auto;
  max-width: none;
  max-height: none;
  cursor: zoom-out;
}
.lightbox-details {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  gap: 0.65rem;
}
.lightbox-meta-action-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.6rem;
  width: 100%;
  padding-bottom: 0.35rem;
}
.lightbox-players-spacer {
  flex: 1;
}
.lightbox-players {
  font-size: 0.92rem;
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.25rem;
}
.lightbox-note {
  font-size: 0.88rem;
}
.lightbox-date {
  font-size: 0.76rem;
  color: var(--text-muted, #64748b);
}
.lightbox-delete-zone {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin-left: auto;
}
.btn-share-highlight {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0.42rem 0.78rem;
  border-radius: 6px;
  border: 1px solid rgba(16, 185, 129, 0.45);
  background: rgba(16, 185, 129, 0.1);
  color: #059669;
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-share-highlight:hover {
  background: rgba(16, 185, 129, 0.18);
  border-color: #059669;
}
html.dark .btn-share-highlight {
  color: #34d399;
  border-color: rgba(52, 211, 153, 0.4);
  background: rgba(16, 185, 129, 0.14);
}
html.dark .btn-share-highlight:hover {
  background: rgba(16, 185, 129, 0.24);
}
.btn-edit-highlight {
  padding: 0.42rem 0.78rem;
  border-radius: 6px;
  border: 1px solid rgba(37, 99, 235, 0.45);
  background: rgba(37, 99, 235, 0.1);
  color: #2563eb;
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-edit-highlight:hover {
  background: rgba(37, 99, 235, 0.18);
  border-color: #2563eb;
}
html.dark .btn-edit-highlight {
  border-color: rgba(96, 165, 250, 0.45);
  background: rgba(59, 130, 246, 0.16);
  color: #60a5fa;
}
html.dark .btn-edit-highlight:hover {
  background: rgba(59, 130, 246, 0.26);
  border-color: #60a5fa;
}
.delete-pin-input {
  padding: 0.4rem 0.65rem;
  border-radius: 6px;
  border: 1px solid var(--border-color, #cbd5e1);
  font-size: 0.8rem;
  width: 150px;
}
html.dark .delete-pin-input {
  background: #27272a;
  color: #f4f4f5;
  border-color: #3f3f46;
}
.btn-delete-highlight {
  padding: 0.42rem 0.75rem;
  border-radius: 6px;
  border: 1px solid #ef4444;
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
}
.current-pin-box {
  padding: 0.6rem 0.85rem;
  border-radius: 8px;
  background: var(--bg-soft, #f1f5f9);
  font-family: monospace;
  font-size: 1rem;
  font-weight: 700;
}
html.dark .current-pin-box {
  background: #27272a;
}
.pin-admin-desc {
  margin: 0;
  font-size: 0.82rem;
  color: var(--text-muted, #64748b);
  line-height: 1.45;
}
.pin-admin-status {
  font-size: 0.83rem;
  font-weight: 600;
  color: #10b981;
}

/* 회차 갤러리 카드 & 메인 갤러리 탭 카드 (sg-*, gh-*, hl-*, ym_*) */
.sg-header-row,
.gh-top-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 0.85rem;
  margin-bottom: 1rem;
}
.sg-sub-desc,
.gh-desc {
  margin: 0.25rem 0 0 0;
  font-size: 0.84rem;
  color: var(--text-muted, #64748b);
}
.gh-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 800;
}
.sg-btn-group,
.gh-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.btn-hl-upload {
  padding: 0.45rem 0.9rem;
  border-radius: 8px;
  font-size: 0.82rem;
  font-weight: 700;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.18s ease;
}
.btn-hl-upload.primary {
  background: linear-gradient(135deg, #d97706, #b45309);
  color: #fff;
}
.btn-hl-upload.nanikiru {
  background: #2563eb;
  border-color: #1d4ed8;
  color: #ffffff;
}
.btn-hl-upload.nanikiru:hover {
  background: #1d4ed8;
  border-color: #1e40af;
}
html.dark .btn-hl-upload.nanikiru {
  background: #2563eb;
  border-color: #60a5fa;
  color: #ffffff;
}
html.dark .btn-hl-upload.nanikiru:hover {
  background: #1d4ed8;
  border-color: #93c5fd;
}
.btn-hl-upload.secondary {
  background: #7c3aed;
  border-color: #6d28d9;
  color: #fff;
}
.btn-hl-upload.secondary:hover {
  background: #6d28d9;
}
.btn-hl-upload.admin-pin-btn {
  background: var(--bg-soft, #f1f5f9);
  color: var(--text-primary, #1e293b);
  border-color: var(--border-color, #cbd5e1);
}
html.dark .btn-hl-upload.admin-pin-btn {
  background: #27272a;
  color: #f4f4f5;
  border-color: #3f3f46;
}
.sg-empty-box {
  text-align: center;
  padding: 1.75rem 1rem;
  color: var(--text-muted, #64748b);
  font-size: 0.88rem;
  background: var(--bg-soft, rgba(148, 163, 184, 0.08));
  border-radius: 10px;
}
.gh-stats-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 0.65rem;
  margin-bottom: 1rem;
}
.gh-stat-pill {
  padding: 0.65rem 0.85rem;
  border-radius: 10px;
  background: var(--bg-soft, #f8fafc);
  border: 1px solid var(--border-color, #e2e8f0);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
html.dark .gh-stat-pill {
  background: #27272a;
  border-color: #3f3f46;
}
.gh-stat-label {
  font-size: 0.8rem;
  color: var(--text-muted, #64748b);
}
.gh-stat-val {
  font-size: 0.95rem;
  font-weight: 800;
}
.gh-filter-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--border-color, #e2e8f0);
}
html.dark .gh-filter-bar {
  border-top-color: #27272a;
}
.gh-cat-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.gh-cat-btn {
  padding: 0.4rem 0.8rem;
  border-radius: 8px;
  font-size: 0.8rem;
  font-weight: 700;
  border: 1px solid var(--border-color, #cbd5e1);
  background: transparent;
  color: var(--text-secondary, #475569);
  cursor: pointer;
}
html.dark .gh-cat-btn {
  color: #cbd5e1;
  border-color: #3f3f46;
}
.gh-cat-btn.active {
  background: var(--accent, #2563eb);
  color: #fff;
  border-color: var(--accent, #2563eb);
}
.gh-select-group {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.gh-filter-select {
  padding: 0.4rem 0.65rem;
  border-radius: 8px;
  font-size: 0.82rem;
  border: 1px solid var(--border-color, #cbd5e1);
  background: var(--card-bg, #fff);
  color: var(--text-primary, #1e293b);
}
html.dark .gh-filter-select {
  background: #18181b;
  color: #f4f4f5;
  border-color: #3f3f46;
}
.hl-gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 1rem;
}
.hl-card {
  background: var(--card-bg, #ffffff);
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
  display: flex;
  flex-direction: column;
}
html.dark .hl-card {
  background: #18181b;
  border-color: #27272a;
}
.hl-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.14);
}
.hl-img-wrap {
  width: 100%;
  aspect-ratio: 16 / 10;
  background: var(--bg-soft, #f1f5f9);
  position: relative;
  overflow: hidden;
}
html.dark .hl-img-wrap {
  background: #1e293b;
}
.hl-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.hl-quality-badge {
  position: absolute;
  bottom: 6px;
  right: 6px;
  padding: 0.15rem 0.45rem;
  border-radius: 5px;
  font-size: 0.68rem;
  font-weight: 700;
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
}
.hl-no-img-banner {
  width: 100%;
  aspect-ratio: 16 / 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, rgba(217, 119, 6, 0.16), rgba(180, 83, 9, 0.28));
  gap: 0.35rem;
  padding: 0.75rem;
  text-align: center;
}
.hl-no-img-banner.is-fun-banner {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.14), rgba(5, 150, 105, 0.25));
}
.hl-no-img-banner.is-nanikiru-banner {
  background: linear-gradient(135deg, rgba(37, 99, 235, 0.14), rgba(29, 78, 216, 0.26));
}
.hl-yakuman-kanji {
  font-size: 1.7rem;
  font-weight: 900;
  color: #d97706;
  letter-spacing: 0.12em;
}
.hl-no-img-banner.is-fun-banner .hl-yakuman-kanji {
  color: #059669;
}
html.dark .hl-no-img-banner.is-fun-banner .hl-yakuman-kanji {
  color: #34d399;
}
.hl-no-img-banner.is-nanikiru-banner .hl-yakuman-kanji {
  color: #2563eb;
}
html.dark .hl-no-img-banner.is-nanikiru-banner .hl-yakuman-kanji {
  color: #60a5fa;
}
.hl-yakuman-main-txt {
  font-size: 0.85rem;
  font-weight: 700;
}
.hl-card-body {
  padding: 0.75rem 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.38rem;
}
.hl-meta-top {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  align-items: center;
}
.hl-yakuman-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  align-items: center;
}
.hl-type-tag,
.hl-session-tag,
.hl-round-tag,
.hl-y-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.16rem 0.45rem;
  border-radius: 6px;
  font-size: 0.72rem;
  font-weight: 700;
}
.hl-type-tag.yakuman,
.hl-y-badge {
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: #fff;
}
.hl-type-tag.fun {
  background: rgba(16, 185, 129, 0.16);
  color: #047857;
  border: 1px solid rgba(16, 185, 129, 0.35);
}
html.dark .hl-type-tag.fun {
  background: rgba(16, 185, 129, 0.22);
  color: #34d399;
  border-color: rgba(52, 211, 153, 0.4);
}
.hl-type-tag.session {
  background: rgba(139, 92, 246, 0.16);
  color: #7c3aed;
  border: 1px solid rgba(139, 92, 246, 0.32);
}
html.dark .hl-type-tag.session {
  background: rgba(139, 92, 246, 0.22);
  color: #a78bfa;
  border-color: rgba(167, 139, 250, 0.38);
}
.hl-session-tag,
.hl-round-tag {
  background: rgba(100, 116, 139, 0.14);
  color: var(--text-secondary, #475569);
}
html.dark .hl-session-tag,
html.dark .hl-round-tag {
  background: rgba(148, 163, 184, 0.18);
  color: #cbd5e1;
}
.hl-winner-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.25rem;
  font-size: 0.83rem;
}
.hl-wintype {
  font-size: 0.76rem;
  color: var(--text-muted, #64748b);
}
.hl-caption {
  font-size: 0.78rem;
  color: var(--text-muted, #64748b);
}

/* 개인 상세 모달 내 17종 역만 카운트 그리드 */
.yakuman_tab_wrapper {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.yakuman_summary_bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 0.25rem;
}
.ym_summary_title {
  font-size: 0.88rem;
  font-weight: 700;
  color: var(--text-primary, #1e293b);
}
html.dark .ym_summary_title {
  color: #f1f5f9;
}
.yakuman_counts_grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.45rem;
}
@media (max-width: 520px) {
  .yakuman_counts_grid {
    grid-template-columns: 1fr;
  }
}
.yakuman_count_row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0.5rem 0.75rem;
  border-radius: 8px;
  background: var(--bg-soft, #f8fafc);
  border: 1px solid var(--border-color, #e2e8f0);
  font-size: 0.83rem;
}
html.dark .yakuman_count_row {
  background: #27272a;
  border-color: #3f3f46;
}
.yakuman_count_row.achieved {
  border-color: #f59e0b;
  background: rgba(245, 158, 11, 0.12);
}
.ym_name {
  flex-shrink: 0;
  font-weight: 700;
}
.ym_leader_line {
  flex: 1;
  height: 1px;
  min-width: 14px;
  background: rgba(148, 163, 184, 0.38);
}
html.dark .ym_leader_line {
  background: rgba(148, 163, 184, 0.25);
}
.yakuman_count_row.achieved .ym_leader_line {
  background: rgba(245, 158, 11, 0.55);
}
.ym_val {
  flex-shrink: 0;
  min-width: 16px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 800;
  color: #d97706;
}
html.dark .ym_val {
  color: #f59e0b;
}
.yakuman_count_row.achieved .ym_val {
  color: #b45309;
}
html.dark .yakuman_count_row.achieved .ym_val {
  color: #fbbf24;
}
.ym_summary_badge {
  display: inline-flex;
  align-items: center;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  font-size: 0.76rem;
  font-weight: 700;
  background: rgba(100, 116, 139, 0.15);
}
.ym_summary_badge.achieved {
  background: #d97706;
  color: #fff;
}
.yakuman_achieved_list {
  margin-top: 0.5rem;
}
.ym_achieved_header {
  font-size: 0.84rem;
  font-weight: 700;
  margin-bottom: 0.45rem;
}
.ym_achieved_cards {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.ym_achieved_card {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.5rem 0.7rem;
  border-radius: 8px;
  border: 1px solid var(--border-color, #e2e8f0);
  cursor: pointer;
}
html.dark .ym_achieved_card {
  border-color: #3f3f46;
}
.ym_thumb {
  width: 56px;
  height: 40px;
  object-fit: cover;
  border-radius: 6px;
  flex-shrink: 0;
}
.ym_achieved_info {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.ym_achieved_tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}
.ym_achieved_meta {
  font-size: 0.75rem;
  color: var(--text-muted, #64748b);
}
.ym_achieved_caption {
  font-size: 0.78rem;
  white-space: pre-line;
}

/* 멀티라인 메모 입력창 & 라이트박스 메모 편집 스타일 */
.form-textarea {
  padding: 0.55rem 0.75rem;
  border-radius: 8px;
  border: 1px solid var(--border-color, #cbd5e1);
  background: var(--card-bg, #fff);
  color: var(--text-primary, #1e293b);
  font-size: 0.85rem;
  font-family: inherit;
  line-height: 1.45;
  resize: vertical;
  width: 100%;
  box-sizing: border-box;
}
html.dark .form-textarea {
  background: #27272a;
  color: #f4f4f5;
  border-color: #3f3f46;
}
.lightbox-memo-section {
  margin-top: 0.1rem;
  padding: 0.7rem 0.9rem;
  border-radius: 10px;
  background: var(--bg-soft, #f8fafc);
  border: 1px solid var(--border-color, #e2e8f0);
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  width: 100%;
  box-sizing: border-box;
}
html.dark .lightbox-memo-section {
  background: #27272a;
  border-color: #3f3f46;
}
.lightbox-memo-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}
.lightbox-memo-label {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--text-secondary, #475569);
}
html.dark .lightbox-memo-label {
  color: #cbd5e1;
}
.btn-edit-memo {
  padding: 0.22rem 0.55rem;
  border-radius: 6px;
  font-size: 0.74rem;
  font-weight: 700;
  border: 1px solid var(--border-color, #cbd5e1);
  background: var(--card-bg, #fff);
  color: var(--text-primary, #1e293b);
  cursor: pointer;
}
html.dark .btn-edit-memo {
  background: #18181b;
  color: #e4e4e7;
  border-color: #3f3f46;
}
.lightbox-note {
  font-size: 0.88rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
.lightbox-note-empty {
  font-size: 0.8rem;
  color: var(--text-muted, #64748b);
  font-style: italic;
}
.lightbox-memo-editor {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.lightbox-memo-editor-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.45rem;
}
.hl-caption,
.gdm-highlight-note {
  white-space: pre-line;
  word-break: break-word;
}

/* 갤러리 탭 상단 툴바 & 대형 등록 팝업 모달 & Pinterest Masonry 그리드 */
.gallery-toolbar-card {
  padding: 1.15rem 1.35rem;
}
.gh-toolbar-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.85rem;
  margin-bottom: 0.9rem;
}
.gh-toolbar-title-area {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.gh-filter-bar-compact {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
  padding-top: 0.85rem;
  border-top: 1px solid var(--border-color, #e2e8f0);
}
html.dark .gh-filter-bar-compact {
  border-top-color: #27272a;
}

.highlight-upload-modal-card.large-upload-modal {
  width: min(860px, 95vw);
  max-height: 92vh;
}
.upload-modal-subdesc {
  margin: 0.25rem 0 0 0;
  font-size: 0.82rem;
  color: var(--text-muted, #64748b);
}
.upload-modal-stats-row {
  margin-bottom: 0.25rem;
}

/* Pinterest 스타일 다단 Masonry 레이아웃 */
.pinterest-masonry-grid {
  column-count: 4;
  column-gap: 1rem;
  width: 100%;
}
@media (max-width: 1200px) {
  .pinterest-masonry-grid {
    column-count: 3;
  }
}
@media (max-width: 820px) {
  .pinterest-masonry-grid {
    column-count: 2;
    column-gap: 0.8rem;
  }
}
@media (max-width: 480px) {
  .pinterest-masonry-grid {
    column-count: 1;
  }
}
.pinterest-pin-card {
  break-inside: avoid;
  page-break-inside: avoid;
  margin-bottom: 1rem;
  border-radius: 14px;
  overflow: hidden;
  background: var(--card-bg, #ffffff);
  border: 1px solid var(--border-color, #e2e8f0);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  display: inline-block;
  width: 100%;
}
html.dark .pinterest-pin-card {
  background: #18181b;
  border-color: #27272a;
}
.pinterest-pin-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 12px 26px rgba(0, 0, 0, 0.16);
}
.pinterest-img-wrap {
  width: 100%;
  min-height: 140px;
  background: linear-gradient(110deg, #f1f5f9 25%, #e2e8f0 37%, #f1f5f9 63%);
  background-size: 200% 100%;
  animation: pinterestThumbShimmer 1.4s ease infinite;
  position: relative;
  overflow: hidden;
  line-height: 0;
  transition: background-color 0.2s ease;
}
html.dark .pinterest-img-wrap {
  background: linear-gradient(110deg, #1e293b 25%, #27272a 37%, #1e293b 63%);
  background-size: 200% 100%;
}
.pinterest-img-wrap.is-loaded {
  min-height: 0;
  animation: none;
  background: var(--bg-soft, #f8fafc);
}
html.dark .pinterest-img-wrap.is-loaded {
  background: #141418;
}
@keyframes pinterestThumbShimmer {
  0% {
    background-position: 100% 50%;
  }
  100% {
    background-position: 0% 50%;
  }
}
.pinterest-img {
  width: 100%;
  height: auto;
  display: block;
  object-fit: contain;
  opacity: 0;
  transition: opacity 0.24s cubic-bezier(0.22, 1, 0.36, 1);
  will-change: opacity;
}
.pinterest-img.is-loaded {
  opacity: 1;
}
.pinterest-no-img {
  aspect-ratio: auto;
  min-height: 150px;
  padding: 1.5rem 1rem;
}

/* PIN 자동 인증 / 관리자 PIN 면제 안내 바 */
.pin-auto-status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0.6rem 0.85rem;
  border-radius: 8px;
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.3);
}
.pin-auto-badge {
  font-size: 0.82rem;
  font-weight: 700;
  color: #059669;
}
html.dark .pin-auto-badge {
  color: #34d399;
}
.btn-reset-saved-pin {
  padding: 0.24rem 0.6rem;
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 700;
  border: 1px solid var(--border-color, #cbd5e1);
  background: var(--card-bg, #fff);
  color: var(--text-secondary, #475569);
  cursor: pointer;
}
html.dark .btn-reset-saved-pin {
  background: #27272a;
  color: #e4e4e7;
  border-color: #3f3f46;
}

/* 대국 상세 모달 하단 기록이 0건일 때 버튼 우측 정렬 */
.gdm-highlights-header.only-btn {
  justify-content: flex-end;
  margin-bottom: 0;
}

/* 사진/역만 등록 모달 내 선택 경기 결과 표 & 점수 변동 그래프 박스 */
.upload-game-preview-box {
  padding: 0.85rem 1rem;
  border-radius: 12px;
  background: var(--bg-soft, #f8fafc);
  border: 1px solid var(--border-color, #e2e8f0);
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}
html.dark .upload-game-preview-box {
  background: #27272a;
  border-color: #3f3f46;
}
.upload-game-preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.upload-game-preview-title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.45rem;
  font-size: 0.88rem;
}
.upload-game-preview-time {
  font-size: 0.76rem;
  color: var(--text-muted, #64748b);
}
.upload-game-loading-txt {
  font-size: 0.75rem;
  color: var(--accent, #2563eb);
  font-weight: 600;
}
.upload-modal-chart-box {
  height: 220px;
}

/* 선택한 국의 4인 점수 이동 내역 카드 */
.upload-round-movements-box {
  margin-top: 0.4rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.upload-round-movement-card {
  padding: 0.75rem 0.9rem;
  border-radius: 10px;
  background: var(--bg-soft, #f8fafc);
  border: 1px solid var(--border-color, #e2e8f0);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
html.dark .upload-round-movement-card {
  background: #27272a;
  border-color: #3f3f46;
}
.urm-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  padding-bottom: 0.4rem;
  border-bottom: 1px solid var(--border-color, #e2e8f0);
}
html.dark .urm-header {
  border-bottom-color: #3f3f46;
}
.urm-title {
  font-size: 0.82rem;
  font-weight: 800;
}
.urm-status-badge {
  padding: 0.14rem 0.5rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 700;
  background: rgba(37, 99, 235, 0.14);
  color: #2563eb;
}
html.dark .urm-status-badge {
  background: rgba(96, 165, 250, 0.2);
  color: #60a5fa;
}
.urm-players-grid {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.urm-player-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0.38rem 0.55rem;
  border-radius: 7px;
  font-size: 0.82rem;
  background: var(--card-bg, #ffffff);
  border: 1px solid transparent;
}
html.dark .urm-player-row {
  background: #18181b;
}
.urm-player-row.is-win {
  border-color: rgba(16, 185, 129, 0.45);
  background: rgba(16, 185, 129, 0.08);
}
.urm-player-row.is-lose {
  border-color: rgba(239, 68, 68, 0.4);
  background: rgba(239, 68, 68, 0.07);
}
.urm-player-left {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.urm-seat {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 5px;
  font-size: 0.76rem;
  font-weight: 800;
  background: rgba(100, 116, 139, 0.15);
  color: var(--text-primary, #1e293b);
}
html.dark .urm-seat {
  color: #f4f4f5;
}
.urm-seat.is-east {
  background: rgba(239, 68, 68, 0.18);
  color: #ef4444;
}
.urm-name {
  font-weight: 700;
}
.urm-tag {
  padding: 0.1rem 0.4rem;
  border-radius: 5px;
  font-size: 0.68rem;
  font-weight: 700;
}
.urm-tag.riichi {
  background: rgba(245, 158, 11, 0.18);
  color: #d97706;
}
.urm-tag.win {
  background: rgba(16, 185, 129, 0.2);
  color: #059669;
}
html.dark .urm-tag.win {
  color: #34d399;
}
.urm-tag.lose {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}
.urm-player-right {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-family: inherit;
}
.urm-score-flow {
  font-size: 0.8rem;
  font-family: inherit;
  color: var(--text-secondary, #475569);
}
html.dark .urm-score-flow {
  color: #cbd5e1;
}
.urm-score-delta {
  font-weight: 800;
  font-size: 0.82rem;
}
.urm-score-delta.pos {
  color: #10b981;
}
.urm-score-delta.neg {
  color: #ef4444;
}
.urm-score-delta.zero {
  color: var(--text-muted, #64748b);
}

/* 업로드 / 라이트박스 / PIN 관리 모달 오버레이 (회차 상세 및 경기 상세 모달 위에서도 최상위로 표시) */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  height: 100vh;
  height: 100dvh;
  height: var(--vvh, 100dvh);
  box-sizing: border-box;
  overscroll-behavior: contain;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2600;
  padding: 16px;
  backdrop-filter: blur(4px);
}
.modal-overlay.lightbox-overlay {
  z-index: 2700;
}
@media (max-width: 640px) {
  .modal-overlay.lightbox-overlay {
    padding: 10px;
  }
}

/* 레이팅 차트 캔버스 외부 반응형 HTML 선수 범례 */
.rating-player-legend {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 4px 10px;
  padding: 2px 4px 10px;
  width: 100%;
  box-sizing: border-box;
}
.rating-player-legend.modal-legend {
  max-height: 110px;
  overflow-y: auto;
  flex-shrink: 0;
}
.rating-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 5px;
  border: none;
  background: transparent;
  color: var(--text-color, #334155);
  font-family: 'Noto Serif KR', serif;
  font-size: 12px;
  line-height: 1.3;
  cursor: pointer;
  border-radius: 4px;
  transition: opacity 0.15s ease, background 0.15s ease;
}
html.dark .rating-legend-item {
  color: #cbd5e1;
}
.rating-legend-item:hover {
  background: rgba(100, 116, 139, 0.12);
}
.rating-legend-item.is-hidden {
  opacity: 0.42;
}
.rating-legend-item.is-hidden .rating-legend-label {
  text-decoration: line-through;
}
.rating-legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  display: inline-block;
}

/* 회차 대국 상세 모달 - 국별 점수 이동 뷰 및 하단 빠른 국 조회 */
.gdm-rounds-view {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-top: 0.25rem;
}
.gdm-rounds-filter-bar {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  flex-wrap: wrap;
}
.gdm-rounds-filter-label {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--text-secondary, #475569);
  white-space: nowrap;
}
html.dark .gdm-rounds-filter-label {
  color: #cbd5e1;
}
.gdm-rounds-select {
  flex: 1;
  min-width: 180px;
}
.gdm-rounds-scroll-list {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  max-height: 420px;
  overflow-y: auto;
  padding-right: 4px;
}
/* 회차 상세 대국 카드 내 제목 그룹 및 역만 뱃지 */
.game-card-title-group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.game-yakuman-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: #ffffff;
  box-shadow: 0 1px 3px rgba(217, 119, 6, 0.35);
  letter-spacing: -0.2px;
}

/* 갤러리 및 업로드 모달 서버 저장 용량 상태 바 */
.gh-storage-status-bar {
  margin-top: 0.75rem;
  padding-top: 0.65rem;
  border-top: 1px dashed var(--border-color, #e2e8f0);
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
html.dark .gh-storage-status-bar {
  border-top-color: #334155;
}
.gh-storage-status-bar.in-upload-modal {
  margin-top: 0.1rem;
  margin-bottom: 0.85rem;
  padding: 0.65rem 0.85rem;
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 10px;
  background: var(--bg-secondary, #f8fafc);
}
html.dark .gh-storage-status-bar.in-upload-modal {
  background: #1e293b;
  border-color: #334155;
}
.gh-storage-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.45rem 0.75rem;
  font-size: 0.8rem;
}
.gh-storage-title {
  font-weight: 700;
  color: var(--text-secondary, #475569);
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}
html.dark .gh-storage-title {
  color: #cbd5e1;
}
.gh-storage-metrics {
  color: var(--text-primary, #1e293b);
  flex: 1;
  min-width: 180px;
}
html.dark .gh-storage-metrics {
  color: #f1f5f9;
}
.gh-storage-remain {
  font-weight: 800;
  color: #10b981;
}
html.dark .gh-storage-remain {
  color: #34d399;
}
.gh-storage-sub {
  font-size: 0.75rem;
  color: var(--text-muted, #64748b);
  margin-left: 0.25rem;
}
html.dark .gh-storage-sub {
  color: #94a3b8;
}
.gh-storage-pct-badge {
  font-size: 0.73rem;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(16, 185, 129, 0.12);
  color: #059669;
  white-space: nowrap;
}
html.dark .gh-storage-pct-badge {
  background: rgba(16, 185, 129, 0.2);
  color: #34d399;
}
.gh-storage-pct-badge.warn {
  background: rgba(245, 158, 11, 0.15);
  color: #d97706;
}
html.dark .gh-storage-pct-badge.warn {
  background: rgba(245, 158, 11, 0.22);
  color: #fbbf24;
}
.gh-storage-pct-badge.danger {
  background: rgba(239, 68, 68, 0.15);
  color: #dc2626;
}
html.dark .gh-storage-pct-badge.danger {
  background: rgba(239, 68, 68, 0.22);
  color: #f87171;
}
.gh-storage-ext-badge {
  display: inline-flex;
  align-items: center;
  padding: 0 5px;
  border-radius: 4px;
  font-size: 0.71rem;
  font-weight: 700;
  background: rgba(100, 116, 139, 0.14);
  color: var(--text-dimmed, #64748b);
}
html.dark .gh-storage-ext-badge {
  background: rgba(148, 163, 184, 0.16);
  color: #94a3b8;
}
.gh-storage-track {
  display: flex;
  align-items: center;
  width: 100%;
  height: 6px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.22);
  overflow: hidden;
}
html.dark .gh-storage-track {
  background: rgba(148, 163, 184, 0.18);
}
.gh-storage-fill {
  height: 100%;
  background: linear-gradient(90deg, #10b981, #3b82f6);
  transition: width 0.3s ease;
  flex-shrink: 0;
}
.gh-storage-fill.warn {
  background: linear-gradient(90deg, #f59e0b, #ea580c);
}
.gh-storage-fill.danger {
  background: linear-gradient(90deg, #ef4444, #b91c1c);
}
.gh-storage-fill-external {
  height: 100%;
  flex-shrink: 0;
  background: repeating-linear-gradient(
    -45deg,
    rgba(100, 116, 139, 0.55),
    rgba(100, 116, 139, 0.55) 4px,
    rgba(148, 163, 184, 0.32) 4px,
    rgba(148, 163, 184, 0.32) 8px
  );
  border-left: 1px solid rgba(255, 255, 255, 0.45);
  transition: width 0.3s ease;
}
html.dark .gh-storage-fill-external {
  background: repeating-linear-gradient(
    -45deg,
    rgba(148, 163, 184, 0.52),
    rgba(148, 163, 184, 0.52) 4px,
    rgba(71, 85, 105, 0.45) 4px,
    rgba(71, 85, 105, 0.45) 8px
  );
  border-left-color: rgba(15, 23, 42, 0.65);
}

/* 이번 회차 레이팅 추이 탭 증감 인라인 표시 */
.session_rating_delta_inline {
  font-size: 0.78em;
  font-weight: 700;
  margin-left: 2px;
}

/* 결과 표 화료자 이름 옆 및 국별 점수 이동 내역 역만 뱃지 */
.gdm-name-cell-inner {
  gap: 5px;
}
.gdm-player-name-txt {
  overflow: hidden;
  text-overflow: ellipsis;
}
.gdm-inline-yakuman-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 800;
  line-height: 1.25;
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: #ffffff;
  box-shadow: 0 1px 3px rgba(217, 119, 6, 0.35);
  flex-shrink: 0;
  letter-spacing: -0.2px;
}
.urm-title-group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.urm-yakuman-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  line-height: 1.3;
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: #ffffff;
  box-shadow: 0 1px 3px rgba(217, 119, 6, 0.35);
  letter-spacing: -0.2px;
}
.urm-tag.yakuman {
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: #ffffff;
  font-weight: 800;
  box-shadow: 0 1px 2px rgba(217, 119, 6, 0.3);
}
@media (max-width: 600px) {
  .gdm-name-cell-inner {
    gap: 3px;
  }
  .gdm-inline-yakuman-badge {
    padding: 1px 4px;
    font-size: 9px;
  }
}

/* 탭 메뉴 다중 탭 대응 (한 줄 유지 + 좌우 스크롤 인디케이터 연동) */
.tab-menu-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
}
.tab_menu {
  display: flex;
  flex-wrap: nowrap;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  -ms-overflow-style: none;
  user-select: none;
  -webkit-user-select: none;
  margin-bottom: 0;
  cursor: default;
}
.tab-menu-wrap.has-scroll-indicator .tab_menu {
  cursor: grab;
}
.tab_menu::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}
.tab_menu.is-dragging {
  cursor: grabbing;
  scroll-behavior: auto;
}
.tab_menu.is-dragging .tab_btn {
  cursor: grabbing;
}
.tab_btn {
  flex: 1 0 auto;
  flex-shrink: 0;
  white-space: nowrap;
  word-break: keep-all;
  padding: 8px 11px;
  font-size: 13px;
}

/* 갤러리 새로고침 버튼 */
.refresh-gallery-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: var(--bg-card, #f8fafc);
  color: var(--text-color, #334155);
  border: 1px solid var(--border-color, #cbd5e1);
}
.refresh-gallery-btn:hover:not(:disabled) {
  background: #f1f5f9;
  border-color: #94a3b8;
}
.refresh-gallery-btn:disabled {
  opacity: 0.65;
  cursor: wait;
}
html.dark .refresh-gallery-btn {
  background: #27272a;
  color: #e4e4e7;
  border-color: #3f3f46;
}
html.dark .refresh-gallery-btn:hover:not(:disabled) {
  background: #3f3f46;
}
@keyframes gallery-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.spin-icon {
  animation: gallery-spin 0.8s linear infinite;
}

/* 자주 만나는 상대 탭 (패보옥/코로모 스타일) */
.opponents_tab_wrapper {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 6px 2px 10px;
}
.opponents_filter_bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}
.opponents_scope_info {
  font-size: 12px;
  color: var(--text-dimmed, #64748b);
  font-weight: 600;
}
html.dark .opponents_scope_info {
  color: #94a3b8;
}
.opp_limit_pills {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--border-color, #cbd5e1);
  border-radius: 6px;
  overflow: hidden;
  background: var(--bg-card, #ffffff);
}
html.dark .opp_limit_pills {
  border-color: #3f3f46;
  background: #18181b;
}
.opp_limit_btn {
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 600;
  border: none;
  border-right: 1px solid var(--border-color, #cbd5e1);
  background: transparent;
  color: var(--text-dimmed, #64748b);
  cursor: pointer;
  transition: all 0.15s ease;
}
.opp_limit_btn:last-child {
  border-right: none;
}
html.dark .opp_limit_btn {
  border-right-color: #3f3f46;
  color: #94a3b8;
}
.opp_limit_btn:hover {
  color: var(--text-color, #0f172a);
  background: rgba(37, 99, 235, 0.05);
}
html.dark .opp_limit_btn:hover {
  color: #f8fafc;
  background: rgba(56, 189, 248, 0.08);
}
.opp_limit_btn.active {
  color: #2563eb;
  background: rgba(37, 99, 235, 0.1);
  box-shadow: inset 0 0 0 1px #2563eb;
}
html.dark .opp_limit_btn.active {
  color: #38bdf8;
  background: rgba(56, 189, 248, 0.14);
  box-shadow: inset 0 0 0 1px #38bdf8;
}

.opponents_grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 28px;
  row-gap: 6px;
}
@media (max-width: 520px) {
  .opponents_grid {
    grid-template-columns: 1fr;
    column-gap: 12px;
  }
}
.opponent_item_row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border-radius: 6px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.16);
  cursor: pointer;
  transition: background-color 0.15s ease;
}
.opponent_item_row:hover {
  background-color: rgba(37, 99, 235, 0.06);
}
html.dark .opponent_item_row {
  border-bottom-color: rgba(255, 255, 255, 0.07);
}
html.dark .opponent_item_row:hover {
  background-color: rgba(56, 189, 248, 0.1);
}
.opp_left {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.opp_name_link {
  background: none;
  border: none;
  padding: 0;
  font-size: 13.5px;
  font-weight: 600;
  color: #2563eb;
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.opp_name_link:hover {
  text-decoration: underline;
}
html.dark .opp_name_link {
  color: #60a5fa;
}
.opp_detail_icon {
  font-size: 12px;
  color: var(--text-dimmed, #64748b);
  line-height: 1;
  user-select: none;
}
html.dark .opp_detail_icon {
  color: #94a3b8;
}
.opp_right {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-color, #0f172a);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
html.dark .opp_right {
  color: #f1f5f9;
}

/* 상대 맞대결 승률/전적 비교 다크 팝오버 툴팁 */
.opponent-h2h-popover {
  position: fixed;
  transform: translate(-50%, -100%);
  pointer-events: none;
  z-index: 2890;
  min-width: 260px;
  background: rgba(28, 28, 30, 0.97);
  color: #ffffff;
  border-radius: 6px;
  padding: 10px 14px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.38);
  font-size: 12.5px;
  line-height: 1.45;
}
.opponent-h2h-popover::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border-width: 7px;
  border-style: solid;
  border-color: rgba(28, 28, 30, 0.97) transparent transparent transparent;
}
.opponent-h2h-popover.below {
  transform: translate(-50%, 0);
}
.opponent-h2h-popover.below::after {
  top: auto;
  bottom: 100%;
  border-color: transparent transparent rgba(28, 28, 30, 0.97) transparent;
}
.opp-h2h-winrate {
  font-size: 13px;
  font-weight: 700;
  text-align: center;
  margin-bottom: 6px;
  color: #ffffff;
}
.opp-h2h-table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}
.opp-h2h-table th,
.opp-h2h-table td {
  padding: 2px 8px;
  white-space: nowrap;
}
.opp-h2h-table th {
  font-weight: 700;
  color: #ffffff;
  text-align: center;
  padding-bottom: 4px;
}
.opp-h2h-table th:nth-child(2),
.opp-h2h-table th:nth-child(3),
.opp-h2h-table td:nth-child(2),
.opp-h2h-table td:nth-child(3) {
  border-left: 1px solid rgba(255, 255, 255, 0.35);
  text-align: right;
}
.opp-h2h-label {
  font-weight: 700;
  color: #f1f5f9;
  text-align: left;
  padding-left: 2px !important;
  padding-right: 10px !important;
}

/* 라이트박스 헤더 뱃지 클릭 인터랙션 & 모달 z-index 계층 */
.modal-overlay {
  z-index: 2900;
}
.modal-overlay.lightbox-overlay {
  z-index: 2700;
}
.modal-overlay.session-popup-modal-overlay {
  z-index: 2760;
}
.game-detail-modal-overlay {
  z-index: 2800;
}

.clickable-lb-badge {
  cursor: pointer;
  transition: transform 0.14s ease, box-shadow 0.14s ease, filter 0.14s ease;
  border: 1px solid rgba(59, 130, 246, 0.28);
}
.clickable-lb-badge:hover {
  transform: translateY(-1px);
  filter: brightness(1.06);
  box-shadow: 0 2px 6px rgba(37, 99, 235, 0.22);
  text-decoration: underline;
}
.clickable-lb-badge:active {
  transform: translateY(0);
}
html.dark .clickable-lb-badge {
  border-color: rgba(96, 165, 250, 0.35);
}

/* 라이트박스 연동 회차 요약 정보 팝업 모달 */
.session-popup-modal-card {
  width: min(740px, 95vw);
  max-height: 90vh;
  overflow-y: auto;
  background: var(--bg-modal, #ffffff);
  color: var(--text-color, #0f172a);
  border-radius: 14px;
  border: 1px solid var(--border-color, #e2e8f0);
  box-shadow: 0 20px 52px rgba(0, 0, 0, 0.35);
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
html.dark .session-popup-modal-card {
  background: var(--bg-modal, #18181b);
  color: var(--text-color, #f4f4f5);
  border-color: #27272a;
  box-shadow: 0 20px 52px rgba(0, 0, 0, 0.65);
}
.spm-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border-color, #e2e8f0);
}
html.dark .spm-header {
  border-bottom-color: #27272a;
}
.spm-title-box {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.spm-title {
  margin: 0;
  font-size: 15.5px;
  font-weight: 800;
}
.spm-sub {
  font-size: 12px;
  color: var(--text-dimmed, #64748b);
}
.spm-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.btn-goto-session-tab {
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 700;
  border: 1px solid rgba(37, 99, 235, 0.35);
  background: rgba(37, 99, 235, 0.08);
  color: #2563eb;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-goto-session-tab:hover {
  background: #2563eb;
  color: #ffffff;
}
html.dark .btn-goto-session-tab {
  border-color: rgba(96, 165, 250, 0.4);
  background: rgba(59, 130, 246, 0.16);
  color: #60a5fa;
}
html.dark .btn-goto-session-tab:hover {
  background: #3b82f6;
  color: #ffffff;
}
.spm-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.spm-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.spm-section-title {
  margin: 0;
  font-size: 13.5px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px;
}
.spm-hint-txt {
  font-size: 11.5px;
  font-weight: 500;
  color: var(--text-dimmed, #64748b);
}
.spm-table-wrap {
  overflow-x: auto;
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 8px;
}
html.dark .spm-table-wrap {
  border-color: #27272a;
}
.spm-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
  text-align: center;
  white-space: nowrap;
}
.spm-table th {
  background: rgba(0, 0, 0, 0.03);
  padding: 7px 8px;
  font-weight: 700;
  border-bottom: 1px solid var(--border-color, #e2e8f0);
}
html.dark .spm-table th {
  background: rgba(255, 255, 255, 0.04);
  border-bottom-color: #27272a;
}
.spm-table td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--border-color, #f1f5f9);
}
html.dark .spm-table td {
  border-bottom-color: #27272a;
}
.spm-table tr:last-child td {
  border-bottom: none;
}
.spm-ranks-cell {
  font-variant-numeric: tabular-nums;
  color: var(--text-dimmed, #64748b);
}
.spm-games-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 10px;
}
.spm-game-card {
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 9px;
  padding: 9px 11px;
  background: var(--bg-card, #f8fafc);
  cursor: pointer;
  transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
}
html.dark .spm-game-card {
  background: #27272a;
  border-color: #3f3f46;
}
.spm-game-card:hover {
  transform: translateY(-2px);
  border-color: var(--color-toggle-on, #3b82f6);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}
.spm-game-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12.5px;
  margin-bottom: 6px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border-color, #e2e8f0);
  color: var(--color-toggle-on, #2563eb);
}
html.dark .spm-game-head {
  border-bottom-color: #3f3f46;
  color: #60a5fa;
}
.spm-game-time {
  font-size: 11px;
  color: var(--text-dimmed, #64748b);
  font-weight: 500;
}
.spm-game-players {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.spm-game-player-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  padding: 1.5px 2px;
}
.spm-game-player-row.is-winner .spm-gp-name {
  font-weight: 800;
  color: #d97706;
}
html.dark .spm-game-player-row.is-winner .spm-gp-name {
  color: #fbbf24;
}
.spm-gp-left {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.spm-gp-rank {
  font-size: 10.5px;
  color: var(--text-dimmed, #64748b);
  font-weight: 700;
}
.spm-gp-name {
  font-weight: 600;
}
.spm-gp-right {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-variant-numeric: tabular-nums;
}
.spm-gp-score {
  font-size: 11.5px;
}
.spm-gp-uma {
  font-size: 11px;
  font-weight: 700;
}

/* =====================================================================
   나니키루 (무엇을 버릴까) 카테고리 뱃지 / 칩 / 버튼 스타일 (Blue 계열)
   ===================================================================== */
.gh-stat-pill.nanikiru {
  border-color: rgba(37, 99, 235, 0.35);
  background: rgba(37, 99, 235, 0.06);
}
.gh-stat-pill.nanikiru .gh-stat-val {
  color: #2563eb;
}
html.dark .gh-stat-pill.nanikiru {
  border-color: rgba(96, 165, 250, 0.35);
  background: rgba(59, 130, 246, 0.12);
}
html.dark .gh-stat-pill.nanikiru .gh-stat-val {
  color: #60a5fa;
}

.gf-tab.nanikiru.active,
.gh-cat-btn.nanikiru-tab.active,
.sg-filter-btn.nanikiru.active,
.cat-radio-btn.nanikiru.active {
  background: #2563eb !important;
  border-color: #1d4ed8 !important;
  color: #ffffff !important;
}
html.dark .gf-tab.nanikiru.active,
html.dark .gh-cat-btn.nanikiru-tab.active,
html.dark .sg-filter-btn.nanikiru.active,
html.dark .cat-radio-btn.nanikiru.active {
  background: #2563eb !important;
  border-color: #60a5fa !important;
  color: #ffffff !important;
}

.hl-type-tag.nanikiru,
.chip-nanikiru,
.badge-nanikiru,
.badge-nanikiru-sm {
  background: rgba(37, 99, 235, 0.14);
  color: #1d4ed8;
  border: 1px solid rgba(37, 99, 235, 0.35);
  font-weight: 700;
}
.badge-nanikiru {
  font-size: 11.5px;
  padding: 3px 8px;
  border-radius: 6px;
}
.badge-nanikiru-sm {
  font-size: 10.5px;
  padding: 1.5px 6px;
  border-radius: 4px;
}
html.dark .hl-type-tag.nanikiru,
html.dark .chip-nanikiru,
html.dark .badge-nanikiru,
html.dark .badge-nanikiru-sm {
  background: rgba(59, 130, 246, 0.22);
  color: #60a5fa;
  border-color: rgba(96, 165, 250, 0.42);
}

/* 나니키루 판단 뱃지 태그 (리치 판단 / 공수 판단 / 안전패 선택 / 패효율 / 후로 판단 등) */
.yakuman-select-chip.nanikiru-chip.selected {
  background: #2563eb;
  color: #ffffff;
  border-color: #2563eb;
}
.hl-y-badge.is-nanikiru-tag,
.sg-yk-chip.is-nanikiru-tag,
.badge-nanikiru-tag,
.badge-nanikiru-tag-sm {
  display: inline-flex;
  align-items: center;
  background: rgba(37, 99, 235, 0.11);
  color: #2563eb;
  border: 1px solid rgba(37, 99, 235, 0.3);
  font-weight: 700;
  border-radius: 6px;
}
.badge-nanikiru-tag {
  font-size: 11.5px;
  padding: 2.5px 8px;
}
.badge-nanikiru-tag-sm {
  font-size: 10.5px;
  padding: 1.5px 6px;
  border-radius: 4px;
}
html.dark .hl-y-badge.is-nanikiru-tag,
html.dark .sg-yk-chip.is-nanikiru-tag,
html.dark .badge-nanikiru-tag,
html.dark .badge-nanikiru-tag-sm {
  background: rgba(59, 130, 246, 0.18);
  color: #93c5fd;
  border-color: rgba(96, 165, 250, 0.36);
}

/* 카드 내 댓글 개수 SVG 뱃지 (다크/라이트모드 대응) */
.hl-comment-cnt-badge,
.hl-comment-count-badge,
.sg-comment-chip {
  display: inline-flex;
  align-items: center;
  gap: 3.5px;
  font-size: 11px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.12);
  color: #2563eb;
  margin-left: auto;
  line-height: 1.2;
}
.hl-comment-svg {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  display: block;
}
.sg-comment-chip {
  background: rgba(15, 23, 42, 0.72);
  color: #93c5fd;
  border: 1px solid rgba(147, 197, 253, 0.35);
}
html.dark .hl-comment-cnt-badge,
html.dark .hl-comment-count-badge {
  background: rgba(59, 130, 246, 0.22);
  color: #60a5fa;
}

/* 갤러리/라이트박스 대국자 닉네임 스탯 모달 오픈 링크 */
.hl-player-link {
  background: none;
  border: none;
  padding: 0 1px;
  margin: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
  border-radius: 3px;
  transition: color 0.15s ease, background-color 0.15s ease;
  text-decoration: underline;
  text-decoration-color: rgba(37, 99, 235, 0.35);
  text-underline-offset: 2px;
}
.hl-player-link.strong {
  font-weight: 800;
}
.hl-player-link:hover {
  color: var(--color-toggle-on, #2563eb);
  background-color: rgba(59, 130, 246, 0.1);
  text-decoration-color: currentColor;
}
html.dark .hl-player-link {
  text-decoration-color: rgba(96, 165, 250, 0.4);
}
html.dark .hl-player-link:hover {
  color: #60a5fa;
  background-color: rgba(96, 165, 250, 0.15);
}

/* =====================================================================
   인라인 마작패 이미지 & 마작 액션 버튼 (투명 배경 & 확대 적용)
   ===================================================================== */
.rich-mahjong-content {
  line-height: 1.75;
  word-break: break-word;
}
.inline-mahjong-tile {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  vertical-align: middle;
  width: 30px;
  height: 44px;
  margin: 2px 0;
  padding: 0;
  background: transparent;
  border: none;
  box-shadow: none;
  box-sizing: border-box;
}
.inline-mahjong-tile img {
  width: 34px;
  height: 49px;
  object-fit: contain;
  display: block;
  flex-shrink: 0;
  background: transparent;
  filter: drop-shadow(0 1px 1.5px rgba(0, 0, 0, 0.24));
}
html.dark .inline-mahjong-tile {
  background: transparent;
  border: none;
  box-shadow: none;
}
html.dark .inline-mahjong-tile img {
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.58));
}

/* 연속 마작패 & 후로(치/퐁/가깡/안깡) 블록 (빈틈없이 쭉 붙여서 나열 + 컨테이너 우측 초과 시 자동 개행) */
.mj-hand {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: flex-end;
  vertical-align: middle;
  gap: 3px 7px;
  margin: 2px 3px;
  max-width: 100%;
}
.mj-meld-block {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 2px 0;
  vertical-align: bottom;
  max-width: 100%;
}
.mj-meld-block.is-draw-block {
  margin-left: 3px;
}
.mj-upright-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 29.5px;
  height: 43.5px;
  vertical-align: bottom;
  flex-shrink: 0;
}
.mj-tile {
  width: 34px;
  height: 49px;
  object-fit: contain;
  display: block;
  flex-shrink: 0;
  background: transparent;
  pointer-events: none;
  user-select: none;
  filter: drop-shadow(0 1px 1.5px rgba(0, 0, 0, 0.24));
}
html.dark .mj-tile {
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.58));
}
.mj-side-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42.5px;
  height: 29.5px;
  vertical-align: bottom;
  flex-shrink: 0;
}
.mj-side-wrap .mj-tile {
  width: 34px;
  height: 49px;
  transform: rotate(-90deg) translateX(0.5px);
}
.mj-kakan-wrap {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  width: 42.5px;
  height: 59px;
  vertical-align: bottom;
  flex-shrink: 0;
}
.mj-kakan-wrap .mj-side-wrap + .mj-side-wrap {
  margin-top: -0.5px;
}

/* 핀터레스트 카드(.pinterest-pin-card) 내 캡션에서는 글씨 크기(0.78rem)와 조화되도록 나니키루콘 소형화 */
.pinterest-pin-card .rich-mahjong-content {
  line-height: 1.55;
}
.pinterest-pin-card .inline-mahjong-tile {
  width: 15.5px;
  height: 22.8px;
  margin: 1px 0;
}
.pinterest-pin-card .inline-mahjong-tile img {
  width: 18px;
  height: 25.8px;
  filter: drop-shadow(0 0.5px 1px rgba(0, 0, 0, 0.22));
}
.pinterest-pin-card .mj-hand {
  gap: 2px 4px;
  margin: 1px 1.5px;
  max-width: 100%;
}
.pinterest-pin-card .mj-meld-block {
  gap: 1.5px 0;
  max-width: 100%;
}
.pinterest-pin-card .mj-meld-block.is-draw-block {
  margin-left: 1.5px;
}
.pinterest-pin-card .mj-upright-wrap {
  width: 15.5px;
  height: 22.8px;
}
.pinterest-pin-card .mj-tile {
  width: 18px;
  height: 25.8px;
  filter: drop-shadow(0 0.5px 1px rgba(0, 0, 0, 0.22));
}
.pinterest-pin-card .mj-side-wrap {
  width: 22.4px;
  height: 15.5px;
}
.pinterest-pin-card .mj-side-wrap .mj-tile {
  width: 18px;
  height: 25.8px;
  transform: rotate(-90deg) translateX(0.3px);
}
.pinterest-pin-card .mj-kakan-wrap {
  width: 22.4px;
  height: 31px;
}
.pinterest-pin-card .mj-kakan-wrap .mj-side-wrap + .mj-side-wrap {
  margin-top: -0.3px;
}
.pinterest-pin-card .inline-mahjong-action {
  padding: 1.5px 6px;
  margin: 1px 1.5px;
  border-radius: 4px;
  font-size: 10.5px;
  line-height: 1.25;
}

/* 마작 선언/액션 버튼 (리치/다마/치/퐁/깡/론/쯔모/스킵 - 세련된 톤다운 컬러) */
.inline-mahjong-action,
.mep-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  vertical-align: middle;
  padding: 3.5px 11px;
  margin: 2px 2.5px;
  border-radius: 6px;
  font-size: 13.5px;
  font-weight: 800;
  letter-spacing: 0.02em;
  color: #ffffff;
  border: 1px solid rgba(255, 255, 255, 0.22);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25), 0 1.5px 3px rgba(0, 0, 0, 0.2);
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.28);
  line-height: 1.35;
  user-select: none;
}

/* 리치: 주황색 (Warm Amber-Orange) */
.act-riichi {
  background: linear-gradient(180deg, #ea8a2a 0%, #cf6711 100%);
  border-color: #b45309;
}
/* 쯔모: 다홍색 (Refined Coral-Vermilion) */
.act-tsumo {
  background: linear-gradient(180deg, #eb5747 0%, #c93b2b 100%);
  border-color: #b02e20;
}
/* 론: 붉은색 (Deep Ruby-Crimson) */
.act-ron {
  background: linear-gradient(180deg, #cf3448 0%, #a61c30 100%);
  border-color: #881327;
}
/* 깡: 보라색 (Muted Royal Violet) */
.act-kan {
  background: linear-gradient(180deg, #845ef7 0%, #6741d9 100%);
  border-color: #5530c2;
}
/* 퐁: 파란색 (Clean Cobalt-Ocean Blue) */
.act-pon {
  background: linear-gradient(180deg, #3b82f6 0%, #2563eb 100%);
  border-color: #1d4ed8;
}
/* 치: 초록색 (Calm Emerald-Jade Green) */
.act-chii {
  background: linear-gradient(180deg, #20a478 0%, #13825c 100%);
  border-color: #0e6b4b;
}
/* 다마: 차분한 슬레이트 네이비 */
.act-dama {
  background: linear-gradient(180deg, #52637a 0%, #3b495c 100%);
  border-color: #2d3848;
}
/* 스킵: 회색 (Neutral Cool Gray) */
.act-skip {
  background: linear-gradient(180deg, #7c8594 0%, #5e6673 100%);
  border-color: #4b525e;
}

/* =====================================================================
   라이트박스 사진 댓글 영역 스타일 (100% 너비 고정)
   ===================================================================== */
.lightbox-comments-section {
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid var(--border-color, #e2e8f0);
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  box-sizing: border-box;
}
html.dark .lightbox-comments-section {
  border-top-color: #27272a;
}

.lb-comments-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px;
}
.lb-comments-title-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.lb-comments-title {
  font-size: 13.5px;
  font-weight: 800;
  color: var(--text-color, #0f172a);
}
html.dark .lb-comments-title {
  color: #f4f4f5;
}
.lb-comments-count {
  font-size: 11.5px;
  font-weight: 800;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(37, 99, 235, 0.12);
  color: #2563eb;
}
html.dark .lb-comments-count {
  background: rgba(59, 130, 246, 0.22);
  color: #60a5fa;
}
.lb-comments-hint {
  font-size: 11px;
  color: var(--text-dimmed, #64748b);
}

.lb-comments-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding-bottom: 4px;
  width: 100%;
  box-sizing: border-box;
}
.lb-comments-list.has-active-form {
  padding-bottom: 10px;
}
.lb-comment-item {
  padding: 8px 11px;
  border-radius: 8px;
  background: var(--bg-card, #f8fafc);
  border: 1px solid var(--border-color, #e2e8f0);
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: 100%;
  box-sizing: border-box;
}
html.dark .lb-comment-item {
  background: #222226;
  border-color: #323238;
}
.lb-comment-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.lb-comment-author-box {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}
.lb-comment-author {
  font-size: 12.5px;
  font-weight: 800;
  color: var(--text-color, #0f172a);
}
.lb-comment-author.is-clickable {
  background: none;
  border: none;
  padding: 0 2px;
  margin: 0;
  font-family: inherit;
  cursor: pointer;
  border-radius: 3px;
  text-decoration: underline;
  text-decoration-color: rgba(37, 99, 235, 0.35);
  text-underline-offset: 2px;
  transition: color 0.15s ease, background-color 0.15s ease;
}
.lb-comment-author.is-clickable:hover {
  color: var(--color-toggle-on, #2563eb);
  background-color: rgba(59, 130, 246, 0.1);
  text-decoration-color: currentColor;
}
html.dark .lb-comment-author {
  color: #f4f4f5;
}
html.dark .lb-comment-author.is-clickable:hover {
  color: #60a5fa;
  background-color: rgba(96, 165, 250, 0.15);
}
.lb-comment-guest-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(148, 163, 184, 0.18);
  color: var(--text-dimmed, #64748b);
}
.lb-comment-time {
  font-size: 11px;
  color: var(--text-dimmed, #64748b);
}
.lb-comment-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.btn-cmt-act {
  background: transparent;
  border: none;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-dimmed, #64748b);
  cursor: pointer;
  padding: 2px 5px;
  border-radius: 4px;
  transition: all 0.15s;
}
.btn-cmt-act:hover {
  color: var(--color-toggle-on, #2563eb);
  background: rgba(59, 130, 246, 0.08);
}
.btn-cmt-act.del:hover {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.1);
}
.lb-comment-body {
  font-size: 13px;
  color: var(--text-color, #1e293b);
  white-space: pre-wrap;
}
html.dark .lb-comment-body {
  color: #e4e4e7;
}

/* 댓글 수정 / 삭제 인라인 박스 */
.lb-comment-edit-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
}
.lb-cmt-edit-textarea {
  font-size: 12.5px;
  padding: 6px 8px;
}
.lb-cmt-edit-toolbar {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  flex-wrap: wrap;
}
.lb-cmt-edit-right {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  margin-left: auto;
}
.lb-cmt-pin-input {
  width: 118px;
  padding: 4px 8px;
  font-size: 12px;
  border-radius: 5px;
  border: 1px solid var(--border-color, #cbd5e1);
  background: var(--bg-modal, #ffffff);
  color: var(--text-color, #0f172a);
  text-align: center;
}
html.dark .lb-cmt-pin-input {
  background: #18181b;
  border-color: #3f3f46;
  color: #f4f4f5;
}
.lb-comment-delete-box {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 4px;
  padding-top: 6px;
  border-top: 1px dashed var(--border-color, #cbd5e1);
}
html.dark .lb-comment-delete-box {
  border-top-color: #3f3f46;
}
.lb-del-prompt {
  font-size: 11.5px;
  font-weight: 700;
  color: #ef4444;
}

/* 새 댓글 작성 카드 */
.lb-comment-form-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--bg-card, #f8fafc);
  border: 1px solid var(--border-color, #cbd5e1);
  width: 100%;
  box-sizing: border-box;
}
html.dark .lb-comment-form-card {
  background: #1e1e22;
  border-color: #323238;
}
.lb-cf-author-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.lb-cf-logged-in {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 12px;
}
.lb-cf-logged-badge {
  font-size: 10.5px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(22, 163, 74, 0.14);
  color: #15803d;
}
html.dark .lb-cf-logged-badge {
  background: rgba(34, 197, 94, 0.2);
  color: #4ade80;
}
.lb-cf-logged-name {
  font-weight: 800;
  color: var(--text-color, #0f172a);
}
html.dark .lb-cf-logged-name {
  color: #f4f4f5;
}
.lb-cf-logged-sub {
  font-size: 11px;
  color: var(--text-dimmed, #64748b);
}
.lb-cf-guest-inputs {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 210px;
}
.lb-cf-input {
  padding: 5px 9px;
  font-size: 12px;
  border-radius: 6px;
  border: 1px solid var(--border-color, #cbd5e1);
  background: var(--bg-modal, #ffffff);
  color: var(--text-color, #0f172a);
  box-sizing: border-box;
  text-align: center;
}
.lb-cf-input.nick {
  width: 120px;
  flex-shrink: 0;
}
.lb-cf-input.pin {
  width: 145px;
  flex-shrink: 0;
}
html.dark .lb-cf-input {
  background: #141417;
  border-color: #3f3f46;
  color: #f4f4f5;
}
.btn-switch-guest-mode {
  background: transparent;
  border: 1px solid var(--border-color, #cbd5e1);
  color: var(--text-dimmed, #64748b);
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.15s;
}
.btn-switch-guest-mode:hover {
  border-color: var(--color-toggle-on, #3b82f6);
  color: var(--color-toggle-on, #2563eb);
}
html.dark .btn-switch-guest-mode {
  border-color: #3f3f46;
  color: #a1a1aa;
}

.lb-cf-textarea {
  font-size: 12.5px;
  padding: 7px 9px;
  min-height: 52px;
  resize: vertical;
}

.lb-cf-live-preview {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 6px;
  background: rgba(59, 130, 246, 0.06);
  border: 1px dashed rgba(59, 130, 246, 0.28);
  flex-wrap: wrap;
  overflow-anchor: none;
}
.lb-cf-preview-label {
  font-size: 10.5px;
  font-weight: 700;
  color: #2563eb;
  flex-shrink: 0;
}
html.dark .lb-cf-preview-label {
  color: #60a5fa;
}
.lb-cf-preview-body {
  font-size: 12.5px;
}

.lb-cf-bottom-bar {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.emote-picker-anchor {
  position: static;
  display: inline-flex;
  align-items: center;
}
.btn-toggle-emote-picker {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 700;
  border: 1px solid var(--border-color, #cbd5e1);
  background: var(--bg-modal, #ffffff);
  color: var(--text-color, #1e293b);
  cursor: pointer;
  transition: all 0.15s;
}
.btn-emote-chun-icon {
  width: 16px;
  height: 22px;
  object-fit: contain;
  display: block;
  flex-shrink: 0;
  background: transparent;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.2));
}
.btn-toggle-emote-picker.sm {
  padding: 3px 8px;
  font-size: 11px;
}
.btn-toggle-emote-picker.sm .btn-emote-chun-icon {
  width: 14px;
  height: 19px;
}
.btn-toggle-emote-picker:hover,
.btn-toggle-emote-picker.active {
  border-color: var(--color-toggle-on, #3b82f6);
  background: rgba(59, 130, 246, 0.08);
  color: var(--color-toggle-on, #2563eb);
}
html.dark .btn-toggle-emote-picker {
  background: #141417;
  border-color: #3f3f46;
  color: #e4e4e7;
}
html.dark .btn-toggle-emote-picker:hover,
html.dark .btn-toggle-emote-picker.active {
  border-color: #60a5fa;
  color: #60a5fa;
}

.btn-submit-comment {
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 12.5px;
  font-weight: 800;
  border: none;
  background: var(--color-toggle-on, #2563eb);
  color: #ffffff;
  cursor: pointer;
  transition: filter 0.15s;
}
.btn-submit-comment:hover:not(:disabled) {
  filter: brightness(1.08);
}
.btn-submit-comment:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-cancel-modal.sm,
.btn-submit-modal.sm,
.btn-delete-highlight.sm {
  padding: 4px 9px;
  font-size: 11.5px;
  border-radius: 5px;
}

/* 나니키루콘 플로팅 팝업(Popover) 팔레트 - 모던 & 깔끔한 UI */
.mahjong-emote-picker {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  z-index: 250;
  width: min(530px, 100%);
  max-width: 100%;
  border: 1px solid var(--border-color, #cbd5e1);
  border-radius: 14px;
  padding: 12px;
  background: var(--bg-modal, #ffffff);
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.22), 0 2px 8px rgba(15, 23, 42, 0.08);
  display: flex;
  flex-direction: column;
  gap: 9px;
  box-sizing: border-box;
}
.mahjong-emote-picker.compact {
  width: min(500px, 100%);
  max-width: 100%;
}
html.dark .mahjong-emote-picker {
  background: #18181d;
  border-color: #32323d;
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.72), inset 0 1px 0 rgba(255, 255, 255, 0.05);
}
.mep-header-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border-color, #e2e8f0);
}
html.dark .mep-header-bar {
  border-bottom-color: #272730;
}
.mep-tabs {
  display: flex;
  align-items: center;
  gap: 3px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.mep-tabs::-webkit-scrollbar {
  display: none;
}
.mep-tab {
  padding: 4.5px 9.5px;
  border-radius: 7px;
  font-size: 11.5px;
  font-weight: 700;
  border: none;
  background: transparent;
  color: var(--text-dimmed, #64748b);
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: all 0.16s cubic-bezier(0.22, 1, 0.36, 1);
}
.mep-tab:hover:not(.active) {
  color: var(--text-color, #0f172a);
  background: rgba(148, 163, 184, 0.12);
}
html.dark .mep-tab:hover:not(.active) {
  color: #f4f4f5;
  background: rgba(255, 255, 255, 0.06);
}
.mep-tab.active {
  background: var(--color-toggle-on, #2563eb);
  color: #ffffff;
  box-shadow: 0 2px 6px rgba(37, 99, 235, 0.32);
}
.mep-util-btns {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.mep-mode-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 25px;
  padding: 0 8.5px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  border: 1px solid var(--border-color, #cbd5e1);
  background: var(--bg-card, #f8fafc);
  color: var(--text-dimmed, #475569);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  transition: all 0.16s cubic-bezier(0.22, 1, 0.36, 1);
}
.mep-mode-toggle::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(148, 163, 184, 0.55);
  transition: all 0.16s ease;
}
.mep-mode-toggle:hover:not(.active) {
  border-color: rgba(59, 130, 246, 0.45);
  color: var(--text-color, #0f172a);
}
.mep-mode-toggle.continuous.active {
  border-color: #2563eb;
  background: rgba(37, 99, 235, 0.1);
  color: #2563eb;
  font-weight: 800;
}
.mep-mode-toggle.continuous.active::before {
  background: #2563eb;
  box-shadow: 0 0 6px rgba(37, 99, 235, 0.65);
}
.mep-mode-toggle.furo.active {
  border-color: #0d9488;
  background: rgba(13, 148, 136, 0.11);
  color: #0f766e;
  font-weight: 800;
}
.mep-mode-toggle.furo.active::before {
  background: #10b981;
  box-shadow: 0 0 6px rgba(16, 185, 129, 0.7);
}
html.dark .mep-mode-toggle {
  background: #22222a;
  border-color: #353542;
  color: #a1a1aa;
}
html.dark .mep-mode-toggle:hover:not(.active) {
  border-color: rgba(96, 165, 250, 0.45);
  color: #f4f4f5;
}
html.dark .mep-mode-toggle.continuous.active {
  border-color: #60a5fa;
  background: rgba(59, 130, 246, 0.18);
  color: #93c5fd;
}
html.dark .mep-mode-toggle.continuous.active::before {
  background: #60a5fa;
  box-shadow: 0 0 6px rgba(96, 165, 250, 0.8);
}
html.dark .mep-mode-toggle.furo.active {
  border-color: #34d399;
  background: rgba(16, 185, 129, 0.18);
  color: #6ee7b7;
}
html.dark .mep-mode-toggle.furo.active::before {
  background: #34d399;
  box-shadow: 0 0 6px rgba(52, 211, 153, 0.8);
}
.mep-util-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 25px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  border: 1px solid var(--border-color, #cbd5e1);
  background: var(--bg-card, #f8fafc);
  color: var(--text-dimmed, #475569);
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
  white-space: nowrap;
}
.mep-util-btn.space-btn {
  width: 26px;
  padding: 0;
  font-size: 13px;
  font-weight: 800;
  border-color: rgba(37, 99, 235, 0.38);
  color: #2563eb;
  background: rgba(37, 99, 235, 0.06);
}
html.dark .mep-util-btn.space-btn {
  border-color: rgba(96, 165, 250, 0.42);
  color: #93c5fd;
  background: rgba(59, 130, 246, 0.14);
}
.mep-util-btn.help,
.mep-util-btn.close {
  width: 25px;
  padding: 0;
  font-weight: 800;
}
.mep-util-btn:hover,
.mep-util-btn.active {
  border-color: var(--color-toggle-on, #3b82f6);
  color: var(--color-toggle-on, #2563eb);
  background: rgba(59, 130, 246, 0.08);
}
.mep-util-btn.close:hover {
  border-color: rgba(239, 68, 68, 0.45);
  color: #ef4444;
  background: rgba(239, 68, 68, 0.08);
}
html.dark .mep-util-btn {
  background: #22222a;
  border-color: #353542;
  color: #a1a1aa;
}
html.dark .mep-util-btn:hover,
html.dark .mep-util-btn.active {
  border-color: #60a5fa;
  color: #60a5fa;
  background: rgba(96, 165, 250, 0.14);
}
html.dark .mep-util-btn.close:hover {
  border-color: rgba(248, 113, 113, 0.5);
  color: #f87171;
  background: rgba(248, 113, 113, 0.12);
}

/* 나니키루콘 팝업 내부 실시간 입력 상황 미니 프리뷰 바 */
.mep-mini-preview {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 5px 8px;
  min-height: 42px;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.04);
  border: 1px solid var(--border-color, #cbd5e1);
  box-sizing: border-box;
}
html.dark .mep-mini-preview {
  background: rgba(255, 255, 255, 0.04);
  border-color: #2f2f3b;
}
.mep-mini-preview-body {
  flex: 1;
  min-width: 0;
  max-height: 98px;
  overflow-y: auto;
  padding: 4px 2px 2px;
  display: flex;
  align-items: baseline;
  align-content: flex-start;
  flex-wrap: wrap;
  gap: 4px 4px;
  font-size: 12px;
  line-height: 1.35;
  color: var(--text-color, #1e293b);
}
html.dark .mep-mini-preview-body {
  color: #e4e4e7;
}
.mep-mp-placeholder {
  font-size: 11px;
  color: var(--text-dimmed, #94a3b8);
  user-select: none;
}
.mep-mini-preview-body .mj-hand {
  gap: 4px 5px;
  margin: 0 1px;
}
.mep-mini-preview-body .mj-meld-block {
  gap: 1.5px 0;
}
.mep-mini-preview-body .mj-upright-wrap {
  width: 17px;
  height: 25px;
}
.mep-mini-preview-body .mj-tile {
  width: 19.6px;
  height: 28.2px;
}
.mep-mini-preview-body .mj-side-wrap {
  width: 24.5px;
  height: 18px;
}
.mep-mini-preview-body .mj-side-wrap .mj-tile {
  width: 19.6px;
  height: 28.2px;
  transform: rotate(-90deg) translateX(0.3px);
}
.mep-mini-preview-body .mj-kakan-wrap {
  width: 24.5px;
  height: 36px;
}
.mep-mini-preview-body .inline-mahjong-tile {
  width: 17px;
  height: 25px;
  margin: 0;
}
.mep-mini-preview-body .inline-mahjong-tile img {
  width: 19.6px;
  height: 28.2px;
}
.mep-mini-preview-body .inline-mahjong-action {
  padding: 1.5px 6px;
  margin: 0 1px;
  font-size: 10.5px;
  border-radius: 4px;
}
@media (max-width: 580px) {
  .mep-mini-preview-body {
    max-height: 94px;
    padding: 3px 1px 2px;
    gap: 3px 3px;
  }
  .mep-mini-preview-body .mj-hand {
    gap: 3px 4px;
  }
  .mep-mini-preview-body .mj-upright-wrap,
  .mep-mini-preview-body .inline-mahjong-tile {
    width: 14.5px;
    height: 21.5px;
  }
  .mep-mini-preview-body .mj-tile,
  .mep-mini-preview-body .inline-mahjong-tile img {
    width: 17px;
    height: 24.4px;
  }
  .mep-mini-preview-body .mj-side-wrap {
    width: 21px;
    height: 15.5px;
  }
  .mep-mini-preview-body .mj-side-wrap .mj-tile {
    width: 17px;
    height: 24.4px;
    transform: rotate(-90deg) translateX(0.25px);
  }
  .mep-mini-preview-body .mj-kakan-wrap {
    width: 21px;
    height: 31px;
  }
}
.mep-mini-backspace-btn {
  flex-shrink: 0;
  width: 26px;
  height: 24px;
  padding: 0;
  border-radius: 6px;
  border: 1px solid var(--border-color, #cbd5e1);
  background: var(--bg-modal, #ffffff);
  color: var(--text-dimmed, #475569);
  font-size: 12px;
  font-weight: 800;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.14s ease;
}
.mep-mini-backspace-btn:hover {
  border-color: rgba(239, 68, 68, 0.45);
  color: #ef4444;
  background: rgba(239, 68, 68, 0.08);
}
html.dark .mep-mini-backspace-btn {
  background: #22222a;
  border-color: #353542;
  color: #a1a1aa;
}
html.dark .mep-mini-backspace-btn:hover {
  border-color: rgba(248, 113, 113, 0.5);
  color: #f87171;
  background: rgba(248, 113, 113, 0.12);
}

/* 직접 입력 표기법 미니 가이드 배너 */
.mep-notation-guide {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border-radius: 9px;
  background: rgba(37, 99, 235, 0.05);
  border: 1px solid rgba(37, 99, 235, 0.2);
  font-size: 11px;
  line-height: 1.45;
}
html.dark .mep-notation-guide {
  background: rgba(59, 130, 246, 0.09);
  border-color: rgba(96, 165, 250, 0.24);
}
.mng-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
}
.mng-badge {
  font-size: 10px;
  font-weight: 800;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(37, 99, 235, 0.14);
  color: #2563eb;
  min-width: 54px;
  text-align: center;
}
html.dark .mng-badge {
  background: rgba(96, 165, 250, 0.2);
  color: #93c5fd;
}
.mep-notation-guide code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(15, 23, 42, 0.07);
  color: var(--text-color, #0f172a);
}
html.dark .mep-notation-guide code {
  background: rgba(255, 255, 255, 0.1);
  color: #5eead4;
}
.mng-sub {
  color: var(--text-dimmed, #64748b);
  font-size: 10.5px;
}
.mep-guide-slide-enter-active,
.mep-guide-slide-leave-active {
  transition: opacity 0.18s ease, transform 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.mep-guide-slide-enter-from,
.mep-guide-slide-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.mep-actions-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 0 2px;
}
.mep-action-btn {
  cursor: pointer;
  padding: 6px 14px;
  font-size: 13.5px;
  transition: transform 0.12s ease, filter 0.12s ease;
}
.mep-action-btn:hover {
  transform: translateY(-1px);
  filter: brightness(1.08);
}
.mep-action-btn:active {
  transform: translateY(0);
}
.mep-tiles-grid {
  display: grid;
  grid-template-columns: repeat(10, minmax(0, 1fr));
  gap: 3px;
}
@media (max-width: 580px) {
  .mahjong-emote-picker,
  .mahjong-emote-picker.compact {
    left: 0;
    right: 0;
    width: 100%;
    max-width: 100%;
    padding: 10px;
    gap: 7px;
  }
  .mep-header-bar {
    flex-wrap: wrap;
    row-gap: 5px;
  }
  .mep-tabs {
    flex: 1 1 auto;
  }
  .mep-util-btns {
    margin-left: auto;
  }
  .mep-tab {
    padding: 4px 7.5px;
    font-size: 11px;
  }
  .mep-mode-toggle {
    height: 23px;
    padding: 0 6.5px;
    font-size: 10.5px;
    gap: 3.5px;
  }
  .mep-util-btn {
    height: 23px;
    padding: 0 6px;
    font-size: 10.5px;
  }
  .mep-util-btn.space-btn,
  .mep-util-btn.help,
  .mep-util-btn.close {
    width: 23px;
    padding: 0;
  }
  .mep-tiles-grid {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
  .mep-furo-dock {
    padding: 6px 8px;
    gap: 6px;
  }
  .mep-lever-pills {
    gap: 4px;
  }
  .mep-lever-btn {
    padding: 4.5px 9px 4.5px 7px;
    font-size: 11.5px;
    gap: 4px;
  }
  .lb-cf-guest-inputs {
    width: 100%;
  }
  .lb-cf-input.nick,
  .lb-cf-input.pin {
    flex: 1;
    width: auto;
    min-width: 0;
  }
}
.mep-tile-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2.5px;
  padding: 4px 1px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  transition: transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1), border-color 0.14s ease, background-color 0.14s ease, box-shadow 0.14s ease;
}
.mep-tile-btn:hover {
  transform: translateY(-2px) scale(1.04);
  border-color: rgba(59, 130, 246, 0.35);
  background: rgba(59, 130, 246, 0.08);
}
.mep-tile-btn:active {
  transform: translateY(0) scale(0.96);
}
.mep-tile-btn.is-selected-base {
  border-color: rgba(37, 99, 235, 0.65);
  background: rgba(37, 99, 235, 0.1);
  box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.25);
}
html.dark .mep-tile-btn {
  background: transparent;
  border-color: transparent;
}
html.dark .mep-tile-btn:hover {
  border-color: rgba(96, 165, 250, 0.4);
  background: rgba(96, 165, 250, 0.12);
}
html.dark .mep-tile-btn.is-selected-base {
  border-color: rgba(96, 165, 250, 0.72);
  background: rgba(59, 130, 246, 0.18);
  box-shadow: inset 0 0 0 1px rgba(96, 165, 250, 0.3);
}
.mep-tile-btn img {
  width: 34px;
  height: 48px;
  object-fit: contain;
  display: block;
  background: transparent;
  padding: 0;
  border: none;
  box-shadow: none;
  filter: drop-shadow(0 1px 1.5px rgba(0, 0, 0, 0.24));
}
html.dark .mep-tile-btn img {
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6));
}
.mep-tile-sub {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-dimmed, #64748b);
  white-space: nowrap;
}
.mep-tile-btn.is-selected-base .mep-tile-sub {
  color: var(--color-toggle-on, #2563eb);
  font-weight: 800;
}
html.dark .mep-tile-sub {
  color: #a1a1aa;
}
html.dark .mep-tile-btn.is-selected-base .mep-tile-sub {
  color: #93c5fd;
}

/* =====================================================================
   모던 후로 레버 독 (Furo Lever Dock) & 4방향 조이스틱 HUD
   ===================================================================== */
.mep-furo-dock {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 10px;
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(241, 245, 249, 0.85) 0%, rgba(226, 232, 240, 0.55) 100%);
  border: 1px solid rgba(148, 163, 184, 0.32);
  flex-wrap: wrap;
}
html.dark .mep-furo-dock {
  background: linear-gradient(180deg, rgba(34, 34, 43, 0.92) 0%, rgba(24, 24, 31, 0.92) 100%);
  border-color: rgba(255, 255, 255, 0.09);
}
.mep-base-tile-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 3px 9px 3px 6px;
  border-radius: 8px;
  background: var(--bg-modal, #ffffff);
  border: 1px solid rgba(59, 130, 246, 0.32);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
  transition: transform 0.24s cubic-bezier(0.34, 1.56, 0.64, 1), border-color 0.2s ease;
}
html.dark .mep-base-tile-chip {
  background: #141419;
  border-color: rgba(96, 165, 250, 0.36);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
}
.mep-base-tile-chip.is-popping {
  transform: scale(1.09);
  border-color: #3b82f6;
}
.mep-base-tile-img {
  width: 24px;
  height: 34px;
  object-fit: contain;
  display: block;
  filter: drop-shadow(0 1px 1.5px rgba(0, 0, 0, 0.25));
}
.mep-base-tile-meta {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
}
.mep-base-sub {
  font-size: 9.5px;
  font-weight: 700;
  color: var(--text-dimmed, #64748b);
}
.mep-base-name {
  font-size: 12px;
  font-weight: 800;
  color: var(--color-toggle-on, #2563eb);
}
html.dark .mep-base-name {
  color: #60a5fa;
}
.mep-lever-group {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  flex-wrap: wrap;
}
.mep-lever-hint {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--text-dimmed, #64748b);
  white-space: nowrap;
}
@media (max-width: 480px) {
  .mep-lever-hint {
    display: none;
  }
}
.mep-lever-pills {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.mep-lever-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 5.5px 12px 5.5px 9px;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 800;
  color: #ffffff;
  border: 1px solid rgba(255, 255, 255, 0.25);
  cursor: grab;
  user-select: none;
  touch-action: none;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28), 0 2px 5px rgba(15, 23, 42, 0.22);
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.28);
  transition: transform 0.16s cubic-bezier(0.34, 1.56, 0.64, 1), filter 0.15s ease, box-shadow 0.15s ease;
}
.mep-lever-btn:hover {
  transform: translateY(-1.5px) scale(1.03);
  filter: brightness(1.07);
}
.mep-lever-btn:active {
  cursor: grabbing;
  transform: scale(0.95);
}
.mep-lever-btn.lever-chi {
  background: linear-gradient(180deg, #20a478 0%, #13825c 100%);
  border-color: #0e6b4b;
}
.mep-lever-btn.lever-pon {
  background: linear-gradient(180deg, #3b82f6 0%, #2563eb 100%);
  border-color: #1d4ed8;
}
.mep-lever-btn.lever-kan {
  background: linear-gradient(180deg, #845ef7 0%, #6741d9 100%);
  border-color: #5530c2;
}
.lever-joy-icon {
  position: relative;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.22);
  border: 1px solid rgba(255, 255, 255, 0.45);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.lever-joy-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 0 4px rgba(255, 255, 255, 0.9);
  transition: transform 0.15s ease;
}
.mep-lever-btn:hover .lever-joy-dot {
  transform: scale(1.2);
}

/* =====================================================================
   글래스모피즘 후로 조이스틱 4방향 초소형 HUD 오버레이 (패 & 표기 코드 & 레버)
   ===================================================================== */
.furo-joystick-hud {
  --hud-accent: #3b82f6;
  --hud-accent-glow: rgba(59, 130, 246, 0.48);
  --hud-accent-soft: rgba(59, 130, 246, 0.22);
  position: fixed;
  z-index: 9999;
  pointer-events: none;
  user-select: none;
  transform: translate(-50%, -50%);
  display: grid;
  grid-template-areas:
    "up up up"
    "left center right"
    "down down down";
  grid-template-columns: 82px 46px 82px;
  grid-template-rows: auto 46px auto;
  gap: 5px;
  align-items: center;
  justify-items: center;
  padding: 8px;
  border-radius: 16px;
  max-width: calc(100vw - 8px);
  box-sizing: border-box;
  background: rgba(15, 23, 42, 0.82);
  backdrop-filter: blur(14px) saturate(160%);
  -webkit-backdrop-filter: blur(14px) saturate(160%);
  border: 1px solid rgba(255, 255, 255, 0.16);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.15);
}
.furo-joystick-hud.action-chi {
  --hud-accent: #10b981;
  --hud-accent-glow: rgba(16, 185, 129, 0.52);
  --hud-accent-soft: rgba(16, 185, 129, 0.24);
}
.furo-joystick-hud.action-pon {
  --hud-accent: #3b82f6;
  --hud-accent-glow: rgba(59, 130, 246, 0.52);
  --hud-accent-soft: rgba(59, 130, 246, 0.24);
}
.furo-joystick-hud.action-kan {
  --hud-accent: #8b5cf6;
  --hud-accent-glow: rgba(139, 92, 246, 0.52);
  --hud-accent-soft: rgba(139, 92, 246, 0.24);
}

.furo-hud-pop-enter-active {
  transition: opacity 0.14s ease-out, transform 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.furo-hud-pop-leave-active {
  transition: opacity 0.12s ease-in, transform 0.14s ease-in;
}
.furo-hud-pop-enter-from,
.furo-hud-pop-leave-to {
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.86);
}

.furo-hud-card {
  width: max-content;
  min-width: 78px;
  min-height: 44px;
  padding: 5px 8px 4px;
  border-radius: 10px;
  background: rgba(30, 41, 59, 0.78);
  border: 1px solid rgba(255, 255, 255, 0.14);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  box-sizing: border-box;
  transition:
    transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1),
    background-color 0.14s ease,
    border-color 0.14s ease,
    box-shadow 0.16s ease;
}
.furo-hud-card.dir-up {
  grid-area: up;
}
.furo-hud-card.dir-down {
  grid-area: down;
}
.furo-hud-card.dir-left {
  grid-area: left;
}
.furo-hud-card.dir-right {
  grid-area: right;
}
.furo-hud-card.is-active {
  background: var(--hud-accent-soft);
  border-color: var(--hud-accent);
  box-shadow: 0 0 18px var(--hud-accent-glow), inset 0 0 10px rgba(255, 255, 255, 0.12);
}
.furo-hud-card.dir-up.is-active {
  transform: translateY(-3px) scale(1.08);
}
.furo-hud-card.dir-down.is-active {
  transform: translateY(3px) scale(1.08);
}
.furo-hud-card.dir-left.is-active {
  transform: translateX(-3px) scale(1.08);
}
.furo-hud-card.dir-right.is-active {
  transform: translateX(3px) scale(1.08);
}
.furo-hud-card.is-confirmed {
  animation: furoSlotConfirmPulse 0.16s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}
@keyframes furoSlotConfirmPulse {
  0% {
    transform: scale(1.08);
  }
  50% {
    transform: scale(1.16);
    filter: brightness(1.22);
  }
  100% {
    transform: scale(1.04);
  }
}

.furo-hud-tiles-stage {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  min-height: 24px;
  white-space: nowrap;
}
.furo-hud-notation {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0.02em;
  color: rgba(203, 213, 225, 0.85);
  white-space: nowrap;
}
.furo-hud-card.is-active .furo-hud-notation {
  color: #ffffff;
  text-shadow: 0 0 6px var(--hud-accent-glow);
}
/* HUD 내부에서는 패 블록이 절대 개행되지 않도록 강제 & 타일 소형화 */
.furo-joystick-hud .mj-meld-block {
  display: inline-flex;
  flex-wrap: nowrap !important;
  white-space: nowrap !important;
  max-width: none !important;
  align-items: flex-end;
  gap: 0;
  margin: 0;
}
.furo-joystick-hud .mj-upright-wrap {
  width: 15px;
  height: 22px;
}
.furo-joystick-hud .mj-tile {
  width: 17.5px;
  height: 25px;
  filter: drop-shadow(0 1px 1.2px rgba(0, 0, 0, 0.38));
}
.furo-joystick-hud .mj-side-wrap {
  width: 21.6px;
  height: 15.5px;
}
.furo-joystick-hud .mj-side-wrap .mj-tile {
  width: 17.5px;
  height: 25px;
  transform: rotate(-90deg) translateX(0.3px);
}
.furo-joystick-hud .mj-kakan-wrap {
  width: 21.6px;
  height: 31px;
}
.furo-joystick-hud .mj-kakan-wrap .mj-side-wrap + .mj-side-wrap {
  margin-top: -0.3px;
}

/* 중앙 초소형 아날로그 조이스틱 소켓 & 물리 레버 노브 (글씨 없음) */
.furo-joystick-socket {
  grid-area: center;
  position: relative;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(15, 23, 42, 0.94) 0%, rgba(30, 41, 59, 0.8) 100%);
  border: 1.5px solid rgba(255, 255, 255, 0.18);
  box-shadow: inset 0 3px 8px rgba(0, 0, 0, 0.65), 0 0 0 2px rgba(255, 255, 255, 0.04);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.16s ease, box-shadow 0.16s ease;
}
.furo-joystick-socket.is-engaged {
  border-color: var(--hud-accent);
  box-shadow: inset 0 3px 8px rgba(0, 0, 0, 0.65), 0 0 14px var(--hud-accent-glow);
}
.furo-socket-ring {
  position: absolute;
  inset: 2px;
  border-radius: 50%;
  border: 1px dashed rgba(255, 255, 255, 0.15);
  pointer-events: none;
}
.furo-socket-tick {
  position: absolute;
  font-size: 6px;
  line-height: 1;
  color: rgba(148, 163, 184, 0.45);
  transition: color 0.15s ease;
}
.furo-socket-tick.active {
  color: var(--hud-accent);
  text-shadow: 0 0 5px var(--hud-accent);
}
.furo-socket-tick.tick-up {
  top: 1px;
  left: 50%;
  transform: translateX(-50%);
}
.furo-socket-tick.tick-down {
  bottom: 1px;
  left: 50%;
  transform: translateX(-50%);
}
.furo-socket-tick.tick-left {
  left: 1.5px;
  top: 50%;
  transform: translateY(-50%);
}
.furo-socket-tick.tick-right {
  right: 1.5px;
  top: 50%;
  transform: translateY(-50%);
}

.furo-joystick-stem {
  position: absolute;
  left: 50%;
  top: 50%;
  height: 4px;
  margin-top: -2px;
  transform-origin: 0 50%;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.15) 0%, var(--hud-accent) 100%);
  box-shadow: 0 0 8px var(--hud-accent-glow);
  pointer-events: none;
}

.furo-joystick-knob {
  position: relative;
  z-index: 2;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #64748b 0%, #1e293b 72%, #0f172a 100%);
  border: 1.5px solid rgba(255, 255, 255, 0.55);
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.55), inset 0 1.5px 2px rgba(255, 255, 255, 0.4);
  will-change: transform;
  transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
}
.furo-joystick-knob.is-engaged {
  background: radial-gradient(circle at 35% 30%, #ffffff 0%, var(--hud-accent) 48%, #0f172a 100%);
  border-color: #ffffff;
  box-shadow: 0 5px 14px rgba(0, 0, 0, 0.6), 0 0 14px var(--hud-accent-glow), inset 0 1.5px 3px rgba(255, 255, 255, 0.7);
}
.furo-joystick-knob.is-spring-back {
  transition:
    transform 0.24s cubic-bezier(0.34, 1.56, 0.64, 1),
    background 0.15s ease,
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

/* =====================================================================
   사진 수정 잠금 안내 & 대댓글(답글) 스타일
   ===================================================================== */
.photo-edit-locked-notice {
  margin-top: 8px;
  padding: 8px 11px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.45;
  background: rgba(59, 130, 246, 0.08);
  border: 1px dashed rgba(59, 130, 246, 0.35);
  color: var(--text-dimmed, #475569);
}
html.dark .photo-edit-locked-notice {
  background: rgba(59, 130, 246, 0.14);
  border-color: rgba(96, 165, 250, 0.38);
  color: #cbd5e1;
}

/* 대댓글(답글) 아이템 들여쓰기 */
.lb-comment-item.is-reply {
  margin-left: 20px;
  width: calc(100% - 20px);
  background: rgba(59, 130, 246, 0.035);
  border-left: 3px solid rgba(59, 130, 246, 0.45);
}
html.dark .lb-comment-item.is-reply {
  background: rgba(39, 39, 46, 0.85);
  border-left: 3px solid rgba(96, 165, 250, 0.5);
}
.lb-reply-prefix {
  font-size: 12px;
  font-weight: 800;
  color: var(--color-toggle-on, #2563eb);
  margin-right: 1px;
  user-select: none;
}
html.dark .lb-reply-prefix {
  color: #60a5fa;
}
.lb-reply-target-badge {
  font-size: 11px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(37, 99, 235, 0.12);
  color: #2563eb;
}
html.dark .lb-reply-target-badge {
  background: rgba(59, 130, 246, 0.22);
  color: #93c5fd;
}
.lb-orphan-reply-badge {
  font-size: 10.5px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(148, 163, 184, 0.18);
  color: var(--text-dimmed, #64748b);
}
.btn-cmt-act.reply.active {
  color: var(--color-toggle-on, #2563eb);
  background: rgba(59, 130, 246, 0.12);
  font-weight: 700;
}
html.dark .btn-cmt-act.reply.active {
  color: #60a5fa;
  background: rgba(96, 165, 250, 0.18);
}

/* 대댓글 인라인 작성 박스 */
.lb-reply-form-box {
  margin-top: 6px;
  padding: 9px 10px;
  border-radius: 8px;
  background: var(--bg-modal, #ffffff);
  border: 1px dashed rgba(59, 130, 246, 0.45);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
html.dark .lb-reply-form-box {
  background: #18181c;
  border-color: rgba(96, 165, 250, 0.45);
}
.lb-reply-form-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.lb-reply-form-target {
  font-size: 11.5px;
  color: var(--color-toggle-on, #2563eb);
}
html.dark .lb-reply-form-target {
  color: #93c5fd;
}
.lb-cf-author-row.compact {
  gap: 6px;
}

/* =====================================================================
   2단계 사진 로딩 (썸네일 우선 → 클릭 시 고화질 원본) & 갤러리 관리 모달
   ===================================================================== */
.zoom-highres-loading-pill {
  position: fixed;
  top: 64px;
  right: 20px;
  z-index: 20;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 6px 13px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  background: rgba(15, 23, 42, 0.82);
  color: #e2e8f0;
  border: 1px solid rgba(148, 163, 184, 0.35);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
  pointer-events: none;
}
.full-image-zoom-img.is-highres-pending {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
.full-image-zoom-img.is-thumb-preview {
  filter: contrast(1.01);
}

.btn-hl-upload.admin-pin-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.gallery-admin-modal-card {
  width: min(580px, 95vw);
  max-width: 580px;
}
.gallery-admin-header-left {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.gallery-admin-sub {
  font-size: 12px;
  color: var(--text-dimmed, #64748b);
}
html.dark .gallery-admin-sub {
  color: #a1a1aa;
}

.gallery-admin-tabs {
  display: flex;
  gap: 6px;
  padding: 4px;
  border-radius: 10px;
  background: var(--bg-card, #f1f5f9);
  border: 1px solid var(--border-color, #e2e8f0);
  margin-bottom: 14px;
}
html.dark .gallery-admin-tabs {
  background: #18181b;
  border-color: #27272a;
}
.gallery-admin-tab-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 7px;
  border: none;
  background: transparent;
  color: var(--text-dimmed, #64748b);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s ease;
}
.gallery-admin-tab-btn:hover {
  color: var(--text-color, #0f172a);
}
html.dark .gallery-admin-tab-btn:hover {
  color: #f4f4f5;
}
.gallery-admin-tab-btn.active {
  background: var(--bg-modal, #ffffff);
  color: var(--color-toggle-on, #2563eb);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}
html.dark .gallery-admin-tab-btn.active {
  background: #27272a;
  color: #60a5fa;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
}
.ga-tab-badge {
  font-size: 11px;
  font-weight: 800;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(37, 99, 235, 0.12);
  color: #2563eb;
}
html.dark .ga-tab-badge {
  background: rgba(96, 165, 250, 0.2);
  color: #93c5fd;
}

.gallery-admin-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ga-unlinked-box {
  padding: 9px 11px;
  border-radius: 8px;
  background: rgba(245, 158, 11, 0.08);
  border: 1px dashed rgba(245, 158, 11, 0.4);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
html.dark .ga-unlinked-box {
  background: rgba(245, 158, 11, 0.12);
  border-color: rgba(251, 191, 36, 0.35);
}
.ga-unlinked-title {
  font-size: 11.5px;
  font-weight: 700;
  color: #b45309;
}
html.dark .ga-unlinked-title {
  color: #fbbf24;
}
.ga-unlinked-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.ga-unlinked-chip {
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  border: 1px solid rgba(245, 158, 11, 0.45);
  background: var(--bg-modal, #ffffff);
  color: var(--text-color, #1e293b);
  cursor: pointer;
  transition: all 0.15s ease;
}
.ga-unlinked-chip:hover,
.ga-unlinked-chip.selected {
  background: #f59e0b;
  border-color: #d97706;
  color: #ffffff;
}
html.dark .ga-unlinked-chip {
  background: #1f1f23;
  color: #f4f4f5;
}

.ga-alias-add-card {
  padding: 12px;
  border-radius: 10px;
  background: var(--bg-card, #f8fafc);
  border: 1px solid var(--border-color, #e2e8f0);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
html.dark .ga-alias-add-card {
  background: #18181c;
  border-color: #2e2e36;
}
.ga-alias-form-grid {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: end;
  gap: 8px;
}
@media (max-width: 520px) {
  .ga-alias-form-grid {
    grid-template-columns: 1fr;
  }
  .ga-alias-arrow {
    display: none;
  }
}
.ga-alias-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ga-alias-arrow {
  padding-bottom: 8px;
  font-size: 15px;
  font-weight: 800;
  color: var(--text-dimmed, #64748b);
  user-select: none;
}
.ga-canonical-combo {
  position: relative;
}
.ga-canonical-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 60;
  max-height: 190px;
  overflow-y: auto;
  border-radius: 8px;
  background: var(--bg-modal, #ffffff);
  border: 1px solid var(--border-color, #cbd5e1);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.16);
  display: flex;
  flex-direction: column;
  padding: 4px;
}
html.dark .ga-canonical-dropdown {
  background: #202026;
  border-color: #3f3f46;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
}
.ga-canonical-opt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 6px 9px;
  border-radius: 5px;
  border: none;
  background: transparent;
  color: var(--text-color, #0f172a);
  font-size: 12.5px;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
}
.ga-canonical-opt:hover,
.ga-canonical-opt.active {
  background: rgba(59, 130, 246, 0.12);
  color: var(--color-toggle-on, #2563eb);
}
html.dark .ga-canonical-opt {
  color: #f4f4f5;
}
html.dark .ga-canonical-opt:hover,
html.dark .ga-canonical-opt.active {
  background: rgba(96, 165, 250, 0.18);
  color: #60a5fa;
}
.ga-opt-sub {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-dimmed, #64748b);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ga-alias-add-actions {
  display: flex;
  justify-content: flex-end;
}

.ga-alias-list-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ga-alias-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12.5px;
  font-weight: 800;
  color: var(--text-color, #0f172a);
}
html.dark .ga-alias-list-header {
  color: #f4f4f5;
}
.ga-alias-list-hint {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-dimmed, #64748b);
}
.ga-alias-empty {
  padding: 16px;
  text-align: center;
  font-size: 12.5px;
  color: var(--text-dimmed, #64748b);
  border-radius: 8px;
  border: 1px dashed var(--border-color, #cbd5e1);
}
.ga-alias-rows {
  display: flex;
  flex-direction: column;
  gap: 7px;
  max-height: 230px;
  overflow-y: auto;
}
.ga-alias-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 8px 11px;
  border-radius: 8px;
  background: var(--bg-card, #f8fafc);
  border: 1px solid var(--border-color, #e2e8f0);
}
html.dark .ga-alias-row {
  background: #1c1c21;
  border-color: #2e2e36;
}
.ga-alias-canonical {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}
.ga-canonical-tag {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(16, 185, 129, 0.14);
  color: #059669;
}
html.dark .ga-canonical-tag {
  background: rgba(16, 185, 129, 0.22);
  color: #34d399;
}
.ga-alias-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ga-alias-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.3);
  font-size: 12px;
}
html.dark .ga-alias-chip {
  background: rgba(59, 130, 246, 0.18);
  border-color: rgba(96, 165, 250, 0.35);
}
.ga-alias-chip-name {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  font-weight: 700;
  color: #2563eb;
  cursor: pointer;
}
.ga-alias-chip-name:hover {
  text-decoration: underline;
}
html.dark .ga-alias-chip-name {
  color: #93c5fd;
}
.ga-alias-chip-del {
  background: none;
  border: none;
  padding: 0 2px;
  font-size: 13px;
  font-weight: 800;
  line-height: 1;
  color: var(--text-dimmed, #64748b);
  cursor: pointer;
  border-radius: 50%;
}
.ga-alias-chip-del:hover:not(:disabled) {
  color: #ef4444;
}
</style>





