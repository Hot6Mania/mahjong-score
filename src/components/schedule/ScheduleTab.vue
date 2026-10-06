<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import type { ScheduleDayItem, ScheduleMonthData, SessionType } from '@/types/schedule';
import type { MemberStatItem } from '@/services/publicStatsService';
import {
  fetchMonthSchedule,
  saveAdminScheduleDates,
  submitAttendance,
  submitBatchAttendance,
  cancelAttendance,
  checkAdminStatus,
  getLastAttendeeName,
  setLastAttendeeName,
  saveUserPin,
  hashPin,
  logScheduleHistory
} from '@/services/scheduleService';
import { computeScheduleSessionNumbers, getMaxCompletedSessionNumber } from '@/utils/sessionNumbering';
import { timeStringToMinutes } from '@/utils/timelineEngine';
import ScheduleCalendarView from './ScheduleCalendarView.vue';
import ScheduleListView from './ScheduleListView.vue';
import DateDetailModal from './DateDetailModal.vue';
import AttendModal from './AttendModal.vue';
import AdminScheduleModal from './AdminScheduleModal.vue';
import UserPinLoginModal from './UserPinLoginModal.vue';

const props = defineProps<{
  members: MemberStatItem[];
  availableSessions: string[];
}>();

// 현재 연월 ("YYYY-MM") - 세션 목록 및 URL 파라미터를 우선 분석하여 텅 빈 월이 열리지 않도록 보정
const getInitialMonth = (): string => {
  // 1. URL 쿼리 파라미터 우선 확인 (?month=YYYY-MM)
  if (typeof window !== 'undefined') {
    const urlParams = new URLSearchParams(window.location.search);
    const mParam = urlParams.get('month');
    if (mParam && /^\d{4}-\d{2}$/.test(mParam)) {
      return mParam;
    }
  }
  // 2. availableSessions 중 최신 회차 날짜 분석 (예: "제16회 261009" -> "2026-10")
  if (props.availableSessions && props.availableSessions.length > 0) {
    for (const s of props.availableSessions) {
      const match = s.match(/(\d{2})(\d{2})\d{2}/);
      if (match) {
        const year = `20${match[1]}`;
        const month = match[2];
        return `${year}-${month}`;
      }
    }
  }
  // 3. 로컬 시스템 시간 폴백
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
};

const currentMonth = ref<string>(getInitialMonth());
const viewMode = ref<'calendar' | 'list'>('calendar');
const isLoading = ref<boolean>(false);
const isRefreshing = ref<boolean>(false);
const toastMessage = ref<string>('');
const toastType = ref<'success' | 'error' | 'info'>('success');

// props.availableSessions 가 비동기로 뒤늦게 로드될 때 최신 회차 월로 자동 보정
watch(() => props.availableSessions, (sessions) => {
  if (sessions && sessions.length > 0 && (!monthSchedule.value.dates || monthSchedule.value.dates.length === 0)) {
    for (const s of sessions) {
      const match = s.match(/(\d{2})(\d{2})\d{2}/);
      if (match) {
        const target = `20${match[1]}-${match[2]}`;
        if (target !== currentMonth.value) {
          currentMonth.value = target;
        }
        break;
      }
    }
  }
});

// 관리자 상태
const isAdmin = ref<boolean>(false);
const adminToken = ref<string | undefined>(undefined);

// 일정 데이터
const monthSchedule = ref<ScheduleMonthData>({
  month: currentMonth.value,
  updatedAt: Date.now(),
  dates: []
});

// 내 참가자 이름
const myAttendeeName = ref<string>(getLastAttendeeName());

// 모달 상태
const selectedDayItem = ref<ScheduleDayItem | null>(null);
const isDetailModalOpen = ref<boolean>(false);
const isAttendModalOpen = ref<boolean>(false);
const isAdminModalOpen = ref<boolean>(false);
const isAdminAuthModalOpen = ref<boolean>(false);
const adminPasscodeInput = ref<string>('');
const isUserLoginModalOpen = ref<boolean>(false);

const onUserLoginSuccess = (name: string, pin: string) => {
  myAttendeeName.value = name;
  setLastAttendeeName(name);
  saveUserPin(name, pin, true);
  showToast(`'${name}' 님으로 로그인되었습니다.`);
};

const onUserLogout = () => {
  if (isAdmin.value) {
    showToast('관리자 계정으로 로그인되어 있을 때는 로그아웃할 수 없습니다.', 'error');
    return;
  }
  const prevName = myAttendeeName.value;
  myAttendeeName.value = '';
  localStorage.removeItem('mahjong_schedule_last_name');
  showToast(prevName ? `'${prevName}' 님 계정에서 로그아웃되었습니다.` : '로그아웃되었습니다.');
};

// 일정 개설 모달 상태
const isCreateScheduleModalOpen = ref<boolean>(false);
const createDate = ref<string>('');
const createCreatorName = ref<string>('');
const createCreatorPin = ref<string>('');
const createSessionType = ref<SessionType>('day');
const createAdminSessionType = ref<'day' | 'overnight' | undefined>(undefined);
const isDayOnlyDate = computed(() => createAdminSessionType.value === 'day');
const createStartTime = ref<string>('10:00');
const createEndTime = ref<string>('22:00');
const createIsOvernight = ref<boolean>(false);
const createMemo = ref<string>('');
const isCreateDropdownOpen = ref<boolean>(false);
const createHighlightedIndex = ref<number>(-1);
const createDropdownListRef = ref<HTMLElement | null>(null);
const createErrorMessage = ref<string>('');

const filteredCreateMembers = computed(() => {
  const q = createCreatorName.value.trim().toLowerCase();
  if (!q) return props.members;
  return props.members.filter(m => m.name.toLowerCase().includes(q));
});

let lastCreateMouseX = -1;
let lastCreateMouseY = -1;

const onCreateItemMouseMove = (e: MouseEvent, idx: number) => {
  if (e.clientX === lastCreateMouseX && e.clientY === lastCreateMouseY) return;
  lastCreateMouseX = e.clientX;
  lastCreateMouseY = e.clientY;
  createHighlightedIndex.value = idx;
};

const scrollToCreateHighlighted = () => {
  nextTick(() => {
    const container = createDropdownListRef.value;
    if (!container) return;
    const items = container.querySelectorAll('.dropdown-item');
    const target = items[createHighlightedIndex.value] as HTMLElement;
    if (target) {
      const targetTop = target.offsetTop;
      const targetBottom = targetTop + target.offsetHeight;
      const containerTop = container.scrollTop;
      const containerBottom = containerTop + container.clientHeight;

      if (targetTop < containerTop) {
        container.scrollTop = targetTop;
      } else if (targetBottom > containerBottom) {
        container.scrollTop = targetBottom - container.clientHeight;
      }
    }
  });
};

const openCreateDropdown = () => {
  isCreateDropdownOpen.value = true;
  const list = filteredCreateMembers.value;
  const currentIdx = list.findIndex(m => m.name === createCreatorName.value);
  createHighlightedIndex.value = currentIdx >= 0 ? currentIdx : 0;
  scrollToCreateHighlighted();
};

const onCreateKeyDown = (e: KeyboardEvent) => {
  const list = filteredCreateMembers.value;
  if (!list.length) return;

  if (!isCreateDropdownOpen.value) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      openCreateDropdown();
      e.preventDefault();
    }
    return;
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (createHighlightedIndex.value < 0) {
      createHighlightedIndex.value = 0;
    } else {
      createHighlightedIndex.value = Math.min(createHighlightedIndex.value + 1, list.length - 1);
    }
    scrollToCreateHighlighted();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (createHighlightedIndex.value < 0) {
      createHighlightedIndex.value = 0;
    } else {
      createHighlightedIndex.value = Math.max(createHighlightedIndex.value - 1, 0);
    }
    scrollToCreateHighlighted();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (createHighlightedIndex.value >= 0 && createHighlightedIndex.value < list.length) {
      createCreatorName.value = list[createHighlightedIndex.value].name;
      isCreateDropdownOpen.value = false;
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    isCreateDropdownOpen.value = false;
  }
};

// 이번 달 스케줄 날짜와 일치하지 않는 순수 과거 완료 회차의 최대 번호
const currentBaseSessionNumber = computed(() => {
  const sorted = monthSchedule.value.dates || [];
  const currentYymmdd = sorted.map(d => d.date.replace(/-/g, '').slice(2));
  const pastSessions = (props.availableSessions || []).filter(s => !currentYymmdd.some(y => s && s.includes(y)));
  return getMaxCompletedSessionNumber(pastSessions);
});

// 역대 회차 기반 이번 달 확정 일정의 자동 회차(제N회) 맵
const sessionMap = computed<Map<string, number>>(() => {
  return computeScheduleSessionNumbers(props.availableSessions, monthSchedule.value.dates);
});

// 통계 요약 칩 (확정 m개, 내 참석 k개)
const confirmedSessionsCount = computed(() => {
  return monthSchedule.value.dates.filter(d => !!d.isConfirmed).length;
});

// 확정된 회차/일정 목록 (예: 16회 23일)
const confirmedSessionsList = computed(() => {
  return monthSchedule.value.dates
    .filter(d => !!d.isConfirmed)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => {
      const sessNum = sessionMap.value.get(d.date);
      const dayNum = parseInt(d.date.split('-')[2], 10);
      const label = sessNum ? `${sessNum}회 ${dayNum}일` : `${dayNum}일`;
      return { date: d.date, label, dayItem: d };
    });
});

const myAttendingDaysCount = computed(() => {
  if (!myAttendeeName.value) return 0;
  return monthSchedule.value.dates.filter(d => 
    d.attendees?.some(a => a.name === myAttendeeName.value)
  ).length;
});


// 회차 개설 모달 오픈 (관리자가 등록한 가능한 날짜 대상)
const openCreateScheduleModal = (dateStr: string, existingItem?: ScheduleDayItem) => {
  createDate.value = dateStr;
  createCreatorName.value = myAttendeeName.value || '';
  createCreatorPin.value = '';

  const isDayOnly = existingItem?.adminSessionType === 'day' || (existingItem && !existingItem.adminSessionType && existingItem.sessionType === 'day');
  createAdminSessionType.value = isDayOnly ? 'day' : (existingItem?.adminSessionType || (existingItem?.sessionType === 'overnight' ? 'overnight' : undefined));

  const targetType = isDayOnly ? 'day' : (existingItem?.sessionType || 'day');
  createSessionType.value = targetType;
  createStartTime.value = existingItem?.customStartTime || '10:00';
  createEndTime.value = isDayOnly
    ? (existingItem?.customEndTime && existingItem.customEndTime !== '익일' ? existingItem.customEndTime : '22:00')
    : (existingItem?.customEndTime || (existingItem?.sessionType === 'overnight' ? '익일' : '22:00'));
  createIsOvernight.value = isDayOnly ? false : (!!existingItem?.customIsOvernight || existingItem?.sessionType === 'overnight');
  createMemo.value = '';
  createErrorMessage.value = '';
  isCreateDropdownOpen.value = false;
  isCreateScheduleModalOpen.value = true;
};

// 모임 시간 세그먼트 전환 핸들러 (밤샘 날짜에서 당일 클릭 시 오후 10:00 즉시 반영)
const handleSelectCreateSessionType = (type: SessionType) => {
  if (isDayOnlyDate.value && type === 'overnight') {
    return;
  }
  createSessionType.value = type;
  if (type === 'day') {
    createEndTime.value = '22:00';
    createIsOvernight.value = false;
  } else if (type === 'overnight') {
    createEndTime.value = '익일';
    createIsOvernight.value = true;
  }
};

// 미등록(빈) 날짜 클릭 핸들러 (관리자만 관리 모달 연계, 일반 유저는 안내)
const onEmptyDayClick = (_dateStr: string) => {
  if (isAdmin.value) {
    isAdminModalOpen.value = true;
  } else {
    showToast('관리자가 지정한 가능한 날짜에만 일정을 개설할 수 있습니다.', 'info');
  }
};

// 일정 개설 제출 핸들러 (개설자 + 김케이 자동 등록 및 '나' 고정)
const handleCreateScheduleSubmit = async () => {
  createErrorMessage.value = '';
  const creatorName = createCreatorName.value.trim();
  const creatorPin = createCreatorPin.value.trim();

  if (!creatorName) {
    createErrorMessage.value = '개설자 이름을 입력해주세요.';
    return;
  }

  if (!isAdmin.value && (!creatorPin || creatorPin.length < 4 || creatorPin.length > 8)) {
    createErrorMessage.value = '확인 PIN(4~8자리)을 입력해주세요.';
    return;
  }

  // 사칭 방지: 개설자 이름이 이번 달 스케줄에 이미 등록되어 PIN 해시가 존재하는 경우, 본인 PIN 일치 필수 검증
  if (!isAdmin.value) {
    let existingCreatorPinHash: string | undefined;
    for (const d of monthSchedule.value.dates) {
      const att = d.attendees?.find(a => a.name === creatorName);
      if (att?.pinHash && att.pinHash !== 'admin_bypass') {
        existingCreatorPinHash = att.pinHash;
        break;
      }
      if (d.creator === creatorName && d.creatorPinHash && d.creatorPinHash !== 'admin_bypass') {
        existingCreatorPinHash = d.creatorPinHash;
        break;
      }
    }

    if (existingCreatorPinHash) {
      const inputHash = await hashPin(creatorPin);
      if (inputHash !== existingCreatorPinHash) {
        createErrorMessage.value = `'${creatorName}' 이름으로 이미 등록된 일정이 있습니다. 본인의 기존 PIN을 입력해주세요. (사칭 방지)`;
        return;
      }
    }
  }

  let isOvernight = false;
  let startTime = '10:00';
  let endTime = '22:00';
  let isCustomTime = false;

  if (createSessionType.value === 'overnight') {
    isOvernight = true;
    startTime = createStartTime.value || '10:00';
    endTime = '익일';
    isCustomTime = (startTime !== '10:00');
  } else if (createSessionType.value === 'custom') {
    isCustomTime = true;
    startTime = createStartTime.value;
    endTime = createEndTime.value;
    isOvernight = isDayOnlyDate.value ? false : createIsOvernight.value;
  } else {
    // '당일 (10~22)' - 시작 및 종료 시간 미세 조정 반영
    isOvernight = false;
    startTime = createStartTime.value || '10:00';
    endTime = createEndTime.value || '22:00';
    isCustomTime = (startTime !== '10:00' || endTime !== '22:00');
  }

  // 당일로 지정된 날짜에는 밤샘 회차 개설 금지
  if (isDayOnlyDate.value && isOvernight) {
    createErrorMessage.value = '당일로 설정된 날짜에는 밤샘 회차를 개설할 수 없습니다.';
    return;
  }

  // 당일 날짜에서 커스텀 시간인 경우 종료 시간이 시작 시간보다 늦어야 함 (밤샘 방지)
  if (isDayOnlyDate.value) {
    const startMins = timeStringToMinutes(startTime);
    const endMins = timeStringToMinutes(endTime);
    if (endMins <= startMins) {
      createErrorMessage.value = '당일 날짜는 종료 시간이 시작 시간보다 늦어야 합니다 (밤샘 불가).';
      return;
    }
  }

  const creatorPinHash = creatorPin && creatorPin.length >= 4
    ? await hashPin(creatorPin)
    : 'admin_bypass';

  // 1. 개설자 본인 참석자
  const creatorAttendee = {
    id: `att_${Date.now()}_cr`,
    name: creatorName,
    isOvernight,
    startTime,
    endTime,
    isCustomTime,
    memo: createMemo.value.trim() || undefined,
    pinHash: creatorPinHash,
    updatedAt: Date.now()
  };

  // 2. '김케이' 참석자 (기본 모든 일정 참가, 개설자와 동일 시간으로 자동 추가)
  const kimkayAttendee = {
    id: `att_${Date.now() + 1}_kk`,
    name: '김케이',
    isOvernight,
    startTime,
    endTime,
    isCustomTime,
    pinHash: 'admin_bypass',
    updatedAt: Date.now()
  };

  const initialAttendees = creatorName === '김케이'
    ? [creatorAttendee]
    : [creatorAttendee, kimkayAttendee];

  // 기존 날짜 중복 검사
  const existingIdx = monthSchedule.value.dates.findIndex(d => d.date === createDate.value);
  const existing = existingIdx !== -1 ? monthSchedule.value.dates[existingIdx] : undefined;

  const preservedAdminSessionType = existing?.adminSessionType
    || createAdminSessionType.value
    || (existing?.sessionType === 'overnight' ? 'overnight' : (existing?.sessionType === 'day' ? 'day' : undefined))
    || (createSessionType.value === 'overnight' ? 'overnight' : 'day');

  const newDayItem: ScheduleDayItem = {
    date: createDate.value,
    sessionType: createSessionType.value,
    adminSessionType: preservedAdminSessionType,
    customStartTime: startTime,
    customEndTime: endTime,
    customIsOvernight: isOvernight,
    creator: creatorName,
    creatorPinHash,
    attendees: initialAttendees
  };

  let updatedDates: ScheduleDayItem[];
  if (existingIdx !== -1) {
    updatedDates = [...monthSchedule.value.dates];
    updatedDates[existingIdx] = newDayItem;
  } else {
    updatedDates = [...monthSchedule.value.dates, newDayItem].sort((a, b) => a.date.localeCompare(b.date));
  }

  const res = await saveAdminScheduleDates(currentMonth.value, updatedDates, adminToken.value, undefined, {
    baseSessionNumber: currentBaseSessionNumber.value
  });
  if (res.success) {
    monthSchedule.value = res.data;
    const created = res.data.dates.find(d => d.date === createDate.value) || newDayItem;
    selectedDayItem.value = created;

    logScheduleHistory(currentMonth.value, {
      action: 'CREATE_SESSION',
      targetDate: createDate.value,
      actorName: creatorName,
      details: `${createDate.value} 회차 개설 (${createSessionType.value === 'overnight' ? '밤샘' : (createSessionType.value === 'custom' ? '커스텀' : '당일')}, 개설자: ${creatorName})`
    });

    // 관리자가 다른 사람을 개설자로 대신 설정해준 경우, 관리자의 본인 로그인을 유지!
    const isProxyCreate = !!(isAdmin.value && myAttendeeName.value && myAttendeeName.value !== creatorName);
    if (!isProxyCreate) {
      myAttendeeName.value = creatorName;
      setLastAttendeeName(creatorName);
      if (creatorPin && creatorPin.length >= 4) {
        saveUserPin(creatorName, creatorPin, true);
      }
    } else {
      if (creatorPin && creatorPin.length >= 4) {
        saveUserPin(creatorName, creatorPin, false);
      }
    }

    isCreateScheduleModalOpen.value = false;
    isDetailModalOpen.value = true;
    showToast(`${createDate.value} 회차가 개설되었습니다. (개설자 및 김케이 등록 완료)`);
  } else {
    createErrorMessage.value = res.error || '일정 개설에 실패했습니다.';
  }
};

// 관리자 버튼 클릭 핸들러
const onOpenAdminOrAuth = async () => {
  await loadSchedule(true);
  if (isAdmin.value) {
    isAdminModalOpen.value = true;
    return;
  }

  // Google 로그인 또는 기존 인증 코드로 백그라운드 재확인
  const res = await checkAdminStatus();
  if (res.isAdmin) {
    isAdmin.value = true;
    adminToken.value = res.adminToken;
    if (res.attendeeName) {
      myAttendeeName.value = res.attendeeName;
      setLastAttendeeName(res.attendeeName);
    }
    showToast('관리자 권한이 확인되었습니다.');
    isAdminModalOpen.value = true;
  } else {
    isAdminAuthModalOpen.value = true;
  }
};

// 관리자 암호 인증
const verifyAdminPasscode = async () => {
  const code = adminPasscodeInput.value.trim();
  if (!code) {
    showToast('인증 코드를 입력해주세요.', 'error');
    return;
  }

  sessionStorage.setItem('schedule_admin_passcode', code);

  // Worker API를 통한 다중 관리자 코드 및 Google 인증 검증
  const res = await checkAdminStatus();
  if (res.isAdmin) {
    isAdmin.value = true;
    sessionStorage.setItem('schedule_admin_verified', 'true');
    adminToken.value = res.adminToken;
    if (res.attendeeName) {
      myAttendeeName.value = res.attendeeName;
      setLastAttendeeName(res.attendeeName);
    }
    isAdminAuthModalOpen.value = false;
    showToast('관리자 권한이 활성화되었습니다.');
    isAdminModalOpen.value = true;
  } else {
    sessionStorage.removeItem('schedule_admin_passcode');
    showToast('관리자 인증 정보가 일치하지 않습니다. (등록된 코드가 없으면 구글 계정으로 로그인해주세요)', 'error');
  }
};

// 일정 데이터 로드 (silent: true일 경우 로딩 스피너 및 화면 깜빡임 없이 조용히 동기화)
const loadSchedule = async (silent = false) => {
  if (silent) {
    try {
      const data = await fetchMonthSchedule(currentMonth.value);
      // 데이터 변동 여부 대조 (변동 없을 시 리렌더링 원천 차단)
      const isUnchanged = JSON.stringify(monthSchedule.value.dates) === JSON.stringify(data.dates)
        && monthSchedule.value.month === data.month;
      if (!isUnchanged) {
        monthSchedule.value = data;
      }
    } catch (e) {
      console.warn('백그라운드 일정 동기화 실패:', e);
    }
    return;
  }

  // 사용자가 직접 새로고침을 눌렀거나 초기 로딩일 때
  isRefreshing.value = true;
  if (!monthSchedule.value.dates || monthSchedule.value.dates.length === 0) {
    isLoading.value = true;
  }
  try {
    const data = await fetchMonthSchedule(currentMonth.value);
    monthSchedule.value = data;
  } catch (e) {
    console.error('일정 로드 실패:', e);
  } finally {
    isLoading.value = false;
    isRefreshing.value = false;
  }
};

// 월 이동
const prevMonth = () => {
  const [y, m] = currentMonth.value.split('-').map(Number);
  const prevDate = new Date(y, m - 2, 1);
  const nextY = prevDate.getFullYear();
  const nextM = String(prevDate.getMonth() + 1).padStart(2, '0');
  currentMonth.value = `${nextY}-${nextM}`;
};

const nextMonth = () => {
  const [y, m] = currentMonth.value.split('-').map(Number);
  const nextDate = new Date(y, m, 1);
  const nextY = nextDate.getFullYear();
  const nextM = String(nextDate.getMonth() + 1).padStart(2, '0');
  currentMonth.value = `${nextY}-${nextM}`;
};

watch(currentMonth, () => {
  loadSchedule();
});

// 토스트 트리거
const showToast = (msg: string, type: 'success' | 'error' | 'info' = 'success') => {
  toastMessage.value = msg;
  toastType.value = type;
  setTimeout(() => {
    toastMessage.value = '';
  }, 2600);
};

// 날짜 선택 시 상세 모달 또는 회차 개설 모달 열기
const onSelectDay = (dayItem: ScheduleDayItem) => {
  // 관리자가 등록한 가능한 날짜이지만 아직 회차가 개설되지 않은 경우 -> 회차 개설 모달 오픈!
  const hasCreatedSession = !!(dayItem.creator && (dayItem.attendees?.length || 0) > 0);
  if (!hasCreatedSession) {
    openCreateScheduleModal(dayItem.date, dayItem);
    return;
  }
  selectedDayItem.value = dayItem;
  isDetailModalOpen.value = true;
};

const attendTargetName = ref<string>('');

// 참석 신청 모달 열기
const onOpenAttendModal = (dayItem?: ScheduleDayItem, targetName?: string) => {
  if (dayItem) {
    selectedDayItem.value = dayItem;
  }
  attendTargetName.value = targetName || '';
  isDetailModalOpen.value = false;
  isAttendModalOpen.value = true;
};

// 관리자/개설자: 날짜 세션 타입 및 커스텀 시간 변경
const onUpdateDateSessionType = async (payload: {
  dateStr: string;
  sessionType?: SessionType;
  adminSessionType?: 'day' | 'overnight';
  customStartTime?: string;
  customEndTime?: string;
  customIsOvernight?: boolean;
  sessionNumber?: number;
  sheetTitle?: string;
}) => {
  const currentDates = [...monthSchedule.value.dates];
  const targetIdx = currentDates.findIndex(d => d.date === payload.dateStr);
  if (targetIdx === -1) return;

  const existing = currentDates[targetIdx];
  const isDayOnly = existing.adminSessionType === 'day';
  if (isDayOnly && payload.sessionType === 'overnight') {
    showToast('당일로 설정된 날짜는 밤샘으로 변경할 수 없습니다.', 'error');
    return;
  }
  if (isDayOnly && payload.customIsOvernight) {
    showToast('당일로 설정된 날짜는 익일(밤샘)을 포함할 수 없습니다.', 'error');
    return;
  }

  currentDates[targetIdx] = {
    ...currentDates[targetIdx],
    sessionType: payload.sessionType || currentDates[targetIdx].sessionType,
    adminSessionType: currentDates[targetIdx].adminSessionType || payload.adminSessionType,
    customStartTime: payload.customStartTime !== undefined ? payload.customStartTime : currentDates[targetIdx].customStartTime,
    customEndTime: payload.customEndTime !== undefined ? payload.customEndTime : currentDates[targetIdx].customEndTime,
    customIsOvernight: payload.customIsOvernight !== undefined ? payload.customIsOvernight : currentDates[targetIdx].customIsOvernight,
    sessionNumber: payload.sessionNumber !== undefined ? payload.sessionNumber : currentDates[targetIdx].sessionNumber,
    sheetTitle: payload.sheetTitle !== undefined ? (payload.sheetTitle || undefined) : currentDates[targetIdx].sheetTitle
  };

  const res = await saveAdminScheduleDates(currentMonth.value, currentDates, adminToken.value, undefined, {
    baseSessionNumber: currentBaseSessionNumber.value
  });
  if (res.success) {
    monthSchedule.value = res.data;
    const updated = res.data.dates.find(d => d.date === payload.dateStr);
    if (updated) selectedDayItem.value = updated;
    const label = payload.sessionType === 'overnight'
      ? '밤샘 (10:00 ~ 익일)'
      : (payload.sessionType === 'custom' ? `커스텀 (${payload.customStartTime || '10:00'} ~ ${payload.customEndTime || '22:00'})` : '당일 (10:00 ~ 22:00)');
    
    logScheduleHistory(currentMonth.value, {
      action: 'UPDATE_SESSION_TYPE',
      targetDate: payload.dateStr,
      actorName: myAttendeeName.value || (isAdmin.value ? '관리자' : '개설자'),
      details: `${payload.dateStr} 모임 시간 변경 (${label})`
    });

    showToast(`${payload.dateStr}: ${label}(으)로 변경되었습니다.`);
  } else {
    showToast(res.error || '모임 시간 변경에 실패했습니다.', 'error');
  }
};

// 관리자: 날짜 세션 타입(당일 ↔ 밤샘) 즉시 전환
const onToggleDateSessionType = async (dateStr: string) => {
  const currentDates = [...monthSchedule.value.dates];
  const targetIdx = currentDates.findIndex(d => d.date === dateStr);
  if (targetIdx === -1) return;

  const currentType = currentDates[targetIdx].sessionType;
  const newType = currentType === 'overnight' ? 'day' : 'overnight';
  await onUpdateDateSessionType({
    dateStr,
    sessionType: newType,
    adminSessionType: newType
  });
};

// 개설자 / 관리자: 모임 확정 토글
const onToggleConfirmSession = async (dateStr: string) => {
  const currentDates = [...monthSchedule.value.dates];
  const targetIdx = currentDates.findIndex(d => d.date === dateStr);
  if (targetIdx === -1) return;

  const item = currentDates[targetIdx];
  const willConfirm = !item.isConfirmed;

  // 4인 미만인데 확정하려 할 경우 방어
  if (willConfirm && (item.attendees?.length || 0) < 4) {
    showToast('참석 인원이 4인 이상 모여야 확정할 수 있습니다.', 'info');
    return;
  }

  let allocatedSessionNum: number | undefined = undefined;
  if (willConfirm) {
    if (item.sessionNumber && item.sessionNumber > 0) {
      allocatedSessionNum = item.sessionNumber;
    } else {
      allocatedSessionNum = sessionMap.value.get(dateStr) || undefined;
    }
  }

  currentDates[targetIdx] = {
    ...item,
    isConfirmed: willConfirm,
    sessionNumber: willConfirm ? allocatedSessionNum : undefined
  };

  const res = await saveAdminScheduleDates(currentMonth.value, currentDates, adminToken.value, undefined, {
    baseSessionNumber: currentBaseSessionNumber.value,
    isToggleConfirm: true,
    targetDate: dateStr
  });
  if (res.success) {
    monthSchedule.value = res.data;
    const updated = res.data.dates.find(d => d.date === dateStr);
    if (updated) selectedDayItem.value = updated;

    logScheduleHistory(currentMonth.value, {
      action: 'TOGGLE_CONFIRM',
      targetDate: dateStr,
      actorName: myAttendeeName.value || (isAdmin.value ? '관리자' : '개설자'),
      details: `${dateStr} 모임 ${willConfirm ? '출발 확정' : '확정 해제 (대기 전환)'}`
    });

    showToast(willConfirm ? '모임이 성공적으로 확정되었습니다!' : '확정이 해제되었습니다.');
  } else {
    showToast(res.error || '상태 변경에 실패했습니다.', 'error');
  }
};

// 오전/오후 판별 및 원클릭 토글 헬퍼
const isPm = (timeStr: string): boolean => {
  if (!timeStr) return false;
  const h = parseInt(timeStr.split(':')[0], 10);
  return !isNaN(h) && h >= 12;
};

const toggleAmPm = (timeStr: string): string => {
  if (!timeStr) return '10:00';
  const [hStr, mStr] = timeStr.split(':');
  let h = parseInt(hStr, 10);
  if (isNaN(h)) h = 10;
  const m = mStr || '00';
  if (h < 12) {
    h += 12;
  } else {
    h -= 12;
  }
  return `${String(h).padStart(2, '0')}:${m}`;
};

// 해당 회차 참가 인원 전체 비우기 (날짜는 가능한 일정으로 유지 및 원래 관리자 속성으로 복원)
const onClearAttendees = async (dateStr: string) => {
  const currentDates = [...monthSchedule.value.dates];
  const targetIdx = currentDates.findIndex(d => d.date === dateStr);
  if (targetIdx === -1) return;

  const existing = currentDates[targetIdx];
  // 원래 관리자가 지정했던 기본 세션 타입 (adminSessionType이 있으면 그것, 없으면 기존 sessionType 또는 'day')
  const defaultSessionType = existing.adminSessionType || (existing.sessionType === 'overnight' ? 'overnight' : 'day');
  const isOvernight = defaultSessionType === 'overnight';

  currentDates[targetIdx] = {
    ...existing,
    attendees: [],
    creator: undefined,
    creatorPinHash: undefined,
    isConfirmed: false,
    sessionType: defaultSessionType,
    adminSessionType: existing.adminSessionType || defaultSessionType,
    customStartTime: '10:00',
    customEndTime: isOvernight ? '익일' : '22:00',
    customIsOvernight: isOvernight
  };

  const res = await saveAdminScheduleDates(currentMonth.value, currentDates, adminToken.value, undefined, {
    isClearAttendees: true,
    targetDate: dateStr,
    baseSessionNumber: currentBaseSessionNumber.value
  });
  if (res.success) {
    monthSchedule.value = res.data;
    isDetailModalOpen.value = false;
    selectedDayItem.value = null;

    logScheduleHistory(currentMonth.value, {
      action: 'CLEAR_ATTENDEES',
      targetDate: dateStr,
      actorName: myAttendeeName.value || (isAdmin.value ? '관리자' : '개설자'),
      details: `${dateStr} 참가자 전체 비우기 및 회차 취소 (가능한 날짜로 유지)`
    });

    showToast(`${dateStr} 회차가 취소되고 참가자 명단이 초기화되었습니다. (가능한 날짜로 유지)`);
  } else {
    showToast(res.error || '회차 취소에 실패했습니다.', 'error');
  }
};

// 관리자 또는 개설자 PIN: 후보 일정 삭제 핸들러 (가능한 날짜에서 완전 삭제)
const onDeleteCandidateDate = async (dateStr: string, pin?: string) => {
  const currentDates = monthSchedule.value.dates.filter(d => d.date !== dateStr);
  const res = await saveAdminScheduleDates(currentMonth.value, currentDates, adminToken.value, pin, {
    baseSessionNumber: currentBaseSessionNumber.value
  });
  if (res.success) {
    monthSchedule.value = res.data;
    isDetailModalOpen.value = false;
    selectedDayItem.value = null;

    logScheduleHistory(currentMonth.value, {
      action: 'DELETE_SESSION',
      targetDate: dateStr,
      actorName: myAttendeeName.value || (isAdmin.value ? '관리자' : '개설자'),
      details: `${dateStr} 일정 완전 삭제`
    });

    showToast(`${dateStr} 일정이 성공적으로 삭제되었습니다.`);
  } else {
    showToast(res.error || '일정 삭제에 실패했습니다.', 'error');
  }
};

// 관리자 / 개설자 / 본인: 특정 참석자 제외 핸들러
const onRemoveAttendee = async (dateStr: string, attendeeName: string, pin?: string) => {
  const isCreator = !!(selectedDayItem.value?.creator && (selectedDayItem.value.creator === myAttendeeName.value));
  const res = await cancelAttendance(
    currentMonth.value,
    dateStr,
    attendeeName,
    pin || '',
    isAdmin.value,
    isCreator
  );

  if (res.success) {
    monthSchedule.value = res.data;
    if (selectedDayItem.value && selectedDayItem.value.date === dateStr) {
      const updated = res.data.dates.find(d => d.date === dateStr);
      if (updated) selectedDayItem.value = updated;
    }
    showToast(`'${attendeeName}' 참석자가 제외되었습니다.`);
  } else {
    showToast(res.error || '참석자 제외에 실패했습니다.', 'error');
  }
};

// 참석 제출 핸들러
const onAttendSubmit = async (payload: {
  name: string;
  isOvernight: boolean;
  startTime: string;
  endTime: string;
  isCustomTime: boolean;
  memo?: string;
  pin: string;
}) => {
  if (!selectedDayItem.value) return;

  // 대리 등록 여부 판정:
  // 1) 관리자이거나
  // 2) 현재 사용자가 회차 개설자인데 다른 사람을 추가하는 경우이거나
  // 3) 이미 내 이름(myAttendeeName)이 설정되어 있고 등록 대상이 내가 아닌 경우
  const isCreator = !!(myAttendeeName.value && selectedDayItem.value?.creator === myAttendeeName.value);
  const isCreatorAddingOther = isCreator && (payload.name !== myAttendeeName.value);
  const isProxyAdd = !!(isAdmin.value || isCreatorAddingOther || (myAttendeeName.value && myAttendeeName.value !== payload.name));

  const res = await submitAttendance(
    currentMonth.value,
    selectedDayItem.value.date,
    {
      name: payload.name,
      isOvernight: payload.isOvernight,
      startTime: payload.startTime,
      endTime: payload.endTime,
      isCustomTime: payload.isCustomTime,
      memo: payload.memo
    },
    payload.pin,
    isAdmin.value,
    isProxyAdd
  );

  if (res.success) {
    monthSchedule.value = res.data;
    // 본인이 직접 등록하거나 내 정보를 수정할 때만 myAttendeeName을 변경!
    // 개설자/관리자가 다른 사람을 추가하는 대리 등록 시에는 '나'의 위치를 절대 변경하지 않음!
    if (!isProxyAdd) {
      myAttendeeName.value = payload.name;
      setLastAttendeeName(payload.name);
    }
    // 선택된 dayItem도 갱신
    const updated = res.data.dates.find(d => d.date === selectedDayItem.value?.date);
    if (updated) selectedDayItem.value = updated;

    isAttendModalOpen.value = false;
    if (selectedDayItem.value) {
      isDetailModalOpen.value = true;
    }
    showToast(isProxyAdd ? `${payload.name} 님이 추가되었습니다.` : '참석 등록이 완료되었습니다.');
  } else {
    showToast(res.error || '참석 등록에 실패했습니다.', 'error');
  }
};

// 다중 참가자 일괄 등록 핸들러
const onAttendBatchSubmit = async (payload: {
  attendees: Array<{
    name: string;
    isOvernight: boolean;
    startTime: string;
    endTime: string;
    isCustomTime: boolean;
    memo?: string;
  }>;
  pin: string;
}) => {
  if (!selectedDayItem.value) return;

  const res = await submitBatchAttendance(
    currentMonth.value,
    selectedDayItem.value.date,
    payload.attendees,
    payload.pin,
    isAdmin.value,
    true
  );

  if (res.success) {
    monthSchedule.value = res.data;
    const updated = res.data.dates.find(d => d.date === selectedDayItem.value?.date);
    if (updated) selectedDayItem.value = updated;

    isAttendModalOpen.value = false;
    if (selectedDayItem.value) {
      isDetailModalOpen.value = true;
    }
    showToast(`${payload.attendees.length}명의 참석자가 등록되었습니다.`);
  } else {
    showToast(res.error || '일괄 참석 등록에 실패했습니다.', 'error');
  }
};

// 참석 취소 핸들러
const onAttendCancel = async (payload: { name: string; pin: string }) => {
  if (!selectedDayItem.value) return;

  const res = await cancelAttendance(
    currentMonth.value,
    selectedDayItem.value.date,
    payload.name,
    payload.pin,
    isAdmin.value
  );

  if (res.success) {
    monthSchedule.value = res.data;
    const updated = res.data.dates.find(d => d.date === selectedDayItem.value?.date);
    if (updated) selectedDayItem.value = updated;

    isAttendModalOpen.value = false;
    if (selectedDayItem.value) {
      isDetailModalOpen.value = true;
    }
    showToast('참석이 취소되었습니다.');
  } else {
    showToast(res.error || '참석 취소에 실패했습니다.', 'error');
  }
};

// 참석 신청 모달 닫기 시 회차 상세 창 복원
const onAttendModalClose = () => {
  isAttendModalOpen.value = false;
  if (selectedDayItem.value) {
    isDetailModalOpen.value = true;
  }
};

// 관리자 후보 일정 일괄 등록/수정
const onAdminSaveDates = async (newDates: ScheduleDayItem[]) => {
  const res = await saveAdminScheduleDates(currentMonth.value, newDates, adminToken.value, undefined, {
    baseSessionNumber: currentBaseSessionNumber.value
  });
  if (res.success) {
    monthSchedule.value = res.data;
    isAdminModalOpen.value = false;
    showToast(`${currentMonth.value} 후보 일정이 등록되었습니다.`);
  } else {
    showToast(res.error || '후보 일정 저장에 실패했습니다.', 'error');
  }
};


onMounted(async () => {
  // 로컬 뷰 모드 복원
  const savedView = localStorage.getItem('mahjong_schedule_view_mode');
  if (savedView === 'calendar' || savedView === 'list') {
    viewMode.value = savedView;
  }

  // 보안: localStorage 영구 관리자 키 완전 정리 및 세션 스토리지 기반 확인
  localStorage.removeItem('schedule_admin_verified');
  localStorage.removeItem('schedule_admin_passcode');

  const isGoogleLoggedIn = localStorage.getItem('google_is_logged_in') === 'true';
  const hasAdminPasscode = !!sessionStorage.getItem('schedule_admin_passcode');
  if (!isGoogleLoggedIn && !hasAdminPasscode) {
    sessionStorage.removeItem('schedule_admin_verified');
    sessionStorage.removeItem('schedule_admin_attendee_name');
    isAdmin.value = false;
  } else if (sessionStorage.getItem('schedule_admin_verified') === 'true') {
    isAdmin.value = true;
  }

  const syncAdminAuth = async () => {
    const googleLoggedIn = localStorage.getItem('google_is_logged_in') === 'true';
    const passcodePresent = !!sessionStorage.getItem('schedule_admin_passcode');

    if (!googleLoggedIn && !passcodePresent) {
      isAdmin.value = false;
      adminToken.value = undefined;
      sessionStorage.removeItem('schedule_admin_verified');
      sessionStorage.removeItem('schedule_admin_attendee_name');
      return;
    }

    const adminRes = await checkAdminStatus();
    if (adminRes.isAdmin) {
      isAdmin.value = true;
      adminToken.value = adminRes.adminToken;
      sessionStorage.setItem('schedule_admin_verified', 'true');
      if (adminRes.attendeeName) {
        myAttendeeName.value = adminRes.attendeeName;
        setLastAttendeeName(adminRes.attendeeName);
      }
    } else {
      isAdmin.value = false;
      adminToken.value = undefined;
      sessionStorage.removeItem('schedule_admin_verified');
      sessionStorage.removeItem('schedule_admin_attendee_name');
    }
  };

  await syncAdminAuth();

  let pollingTimer: any = null;

  const handleVisibilityOrStorage = () => {
    syncAdminAuth();
    if (typeof document !== 'undefined' && !document.hidden) {
      loadSchedule(true);
    }
  };

  window.addEventListener('mahjong_admin_auth_changed', syncAdminAuth);
  window.addEventListener('storage', handleVisibilityOrStorage);
  document.addEventListener('visibilitychange', handleVisibilityOrStorage);

  // 다른 기기 변경 사항을 조용히 반영하기 위한 45초 백그라운드 폴링 (무깜빡임 Silent Refresh)
  pollingTimer = setInterval(() => {
    if (typeof document !== 'undefined' && !document.hidden && !isLoading.value && !isRefreshing.value) {
      loadSchedule(true);
    }
  }, 45000);

  onUnmounted(() => {
    if (pollingTimer) clearInterval(pollingTimer);
    window.removeEventListener('mahjong_admin_auth_changed', syncAdminAuth);
    window.removeEventListener('storage', handleVisibilityOrStorage);
    document.removeEventListener('visibilitychange', handleVisibilityOrStorage);
  });

  await loadSchedule();
});

const setViewMode = (mode: 'calendar' | 'list') => {
  viewMode.value = mode;
  localStorage.setItem('mahjong_schedule_view_mode', mode);
};
</script>

<template>
  <div class="schedule-tab-root">
    <!-- 토스트 알림 -->
    <Transition name="toast-fade">
      <div v-if="toastMessage" class="schedule-toast" :class="toastType">
        {{ toastMessage }}
      </div>
    </Transition>

    <!-- 상단 컨트롤 헤더 -->
    <div class="schedule-header-bar">
      <!-- 월 선택기 -->
      <div class="month-selector">
        <button type="button" class="btn-nav-month" @click="prevMonth" title="이전 달">‹</button>
        <span class="current-month-label">{{ currentMonth }}</span>
        <button type="button" class="btn-nav-month" @click="nextMonth" title="다음 달">›</button>
        <button
          type="button"
          class="btn-nav-refresh"
          :class="{ 'is-loading': isRefreshing }"
          :disabled="isRefreshing"
          @click="() => loadSchedule(false)"
          title="일정 최신 동기화"
          aria-label="일정 새로고침"
        >
          <svg class="refresh-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
            <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
            <path d="M16 21h5v-5" />
          </svg>
        </button>
      </div>

      <!-- 요약 칩들 (확정 m개, 내 참석 k개) -->
      <div class="stat-chips-group">
        <span class="stat-chip chip-confirmed">확정 {{ confirmedSessionsCount }}개</span>
        <span
          v-for="item in confirmedSessionsList"
          :key="item.date"
          class="stat-chip chip-confirmed-date"
          @click="onSelectDay(item.dayItem)"
          title="클릭하여 해당 회차 상세 보기"
        >
          {{ item.label }}
        </span>
        <span v-if="myAttendingDaysCount > 0" class="stat-chip chip-me">내 참석 {{ myAttendingDaysCount }}개</span>
      </div>

      <!-- 우측 컨트롤 (뷰 모드 세그먼트 + 액션) -->
      <div class="header-actions">
        <!-- 내 참석자 계정 로그인 / 프로필 버튼 (이모지 없음) -->
        <button
          v-if="myAttendeeName"
          type="button"
          class="btn-user-auth is-logged-in"
          @click="isUserLoginModalOpen = true"
          title="내 참석 계정 관리 및 전환"
        >
          <span class="auth-dot"></span>
          <span class="user-auth-name">{{ myAttendeeName }}</span>
        </button>
        <button
          v-else
          type="button"
          class="btn-user-auth"
          @click="isUserLoginModalOpen = true"
          title="내 참석자 PIN 로그인"
        >
          <span>로그인</span>
        </button>

        <!-- Apple 스타일 캡슐 세그먼트 컨트롤 -->
        <div class="apple-segmented-control">
          <button
            type="button"
            class="segment-btn"
            :class="{ active: viewMode === 'calendar' }"
            @click="setViewMode('calendar')"
          >
            달력
          </button>
          <button
            type="button"
            class="segment-btn"
            :class="{ active: viewMode === 'list' }"
            @click="setViewMode('list')"
          >
            목록
          </button>
        </div>

        <!-- 관리자 일정 관리 버튼 -->
        <button 
          v-if="isAdmin"
          type="button" 
          class="btn-action-admin" 
          @click="isAdminModalOpen = true"
          title="후보 일정 및 날짜 풀 관리"
        >
          <span class="admin-dot"></span>
          일정 관리
        </button>
        <button 
          v-else
          type="button" 
          class="btn-action-outline btn-auth-trigger" 
          @click="onOpenAdminOrAuth"
          title="관리자 인증"
        >
          관리자
        </button>
      </div>
    </div>

    <!-- 로딩 스피너 -->
    <div v-if="isLoading" class="schedule-loading">
      <div class="spinner"></div>
    </div>

    <!-- 메인 뷰 영역 -->
    <div v-else class="schedule-view-content">
      <!-- 달력 뷰 -->
      <ScheduleCalendarView
        v-if="viewMode === 'calendar'"
        :currentMonth="currentMonth"
        :dates="monthSchedule.dates"
        :sessionMap="sessionMap"
        :myAttendeeName="myAttendeeName"
        :isAdmin="isAdmin"
        @selectDay="onSelectDay"
        @clickEmptyDay="onEmptyDayClick"
      />

      <!-- 리스트(모아보기) 뷰 -->
      <ScheduleListView
        v-else
        :dates="monthSchedule.dates"
        :sessionMap="sessionMap"
        :myAttendeeName="myAttendeeName"
        @selectDay="onSelectDay"
        @openAttend="onOpenAttendModal"
        @openAdmin="onOpenAdminOrAuth"
      />
    </div>

    <!-- 모달들 -->
    <DateDetailModal
      :isOpen="isDetailModalOpen"
      :dayItem="selectedDayItem"
      :sessionNumber="selectedDayItem ? (sessionMap.get(selectedDayItem.date) || null) : null"
      :myAttendeeName="myAttendeeName"
      :isAdmin="isAdmin"
      @close="isDetailModalOpen = false"
      @openAttend="(name) => onOpenAttendModal(selectedDayItem!, name)"
      @toggleSessionType="onToggleDateSessionType"
      @updateSessionType="onUpdateDateSessionType"
      @deleteDate="onDeleteCandidateDate"
      @removeAttendee="onRemoveAttendee"
      @clearAttendees="onClearAttendees"
      @toggleConfirm="onToggleConfirmSession"
      @toast="showToast"
    />

    <AttendModal
      :isOpen="isAttendModalOpen"
      :dayItem="selectedDayItem"
      :sessionNumber="selectedDayItem ? (sessionMap.get(selectedDayItem.date) || null) : null"
      :members="props.members"
      :targetAttendeeName="attendTargetName"
      :isAdmin="isAdmin"
      :isManager="isAdmin || (!!myAttendeeName && selectedDayItem?.creator === myAttendeeName)"
      :creatorName="selectedDayItem?.creator || ''"
      @close="onAttendModalClose"
      @submit="onAttendSubmit"
      @submitBatch="onAttendBatchSubmit"
      @cancel="onAttendCancel"
    />

    <UserPinLoginModal
      :isOpen="isUserLoginModalOpen"
      :currentMonth="currentMonth"
      :currentAttendeeName="myAttendeeName"
      :dates="monthSchedule.dates"
      :members="props.members"
      :isAdmin="isAdmin"
      @close="isUserLoginModalOpen = false"
      @loginSuccess="onUserLoginSuccess"
      @logout="onUserLogout"
    />

    <AdminScheduleModal
      :isOpen="isAdminModalOpen"
      :currentMonth="currentMonth"
      :existingDates="monthSchedule.dates"
      :sessionMap="sessionMap"
      :adminToken="adminToken"
      @close="isAdminModalOpen = false"
      @save="onAdminSaveDates"
    />

    <!-- 일정 만들기 모달 (일정 먼저 생성 후 인원 추가 흐름) -->
    <Transition name="apple-modal-fade">
      <div v-if="isCreateScheduleModalOpen" class="apple-modal-backdrop" v-backdrop-dismiss="() => isCreateScheduleModalOpen = false">
        <div class="apple-modal-sheet">
          <div class="sheet-header">
            <div class="header-titles">
              <span class="sheet-sub">새 일정 만들기</span>
              <h3 class="sheet-title">{{ createDate }} 일정 만들기</h3>
            </div>
            <button class="btn-close" @click="isCreateScheduleModalOpen = false">✕</button>
          </div>

          <!-- 에러 알림 -->
          <div v-if="createErrorMessage" class="error-banner">
            {{ createErrorMessage }}
          </div>

          <div class="sheet-body">
            <!-- 1. 개설자 이름 -->
            <div class="form-group">
              <label class="form-label">개설자</label>
              <div class="autocomplete-wrapper">
                <input
                  type="text"
                  class="apple-input"
                  v-model="createCreatorName"
                  @input="openCreateDropdown"
                  @focus="openCreateDropdown"
                  @keydown="onCreateKeyDown"
                  placeholder="개설자 이름 검색 또는 직접 입력"
                />
                <button 
                  type="button" 
                  class="dropdown-toggle-btn"
                  @click="isCreateDropdownOpen ? (isCreateDropdownOpen = false) : openCreateDropdown()"
                >
                  ▾
                </button>

                <div 
                  v-if="isCreateDropdownOpen && filteredCreateMembers.length > 0" 
                  ref="createDropdownListRef"
                  class="autocomplete-dropdown"
                >
                  <div 
                    v-for="(member, idx) in filteredCreateMembers" 
                    :key="member.name"
                    class="dropdown-item"
                    :class="{ 
                      selected: createCreatorName === member.name,
                      highlighted: createHighlightedIndex === idx 
                    }"
                    @mousemove="onCreateItemMouseMove($event, idx)"
                    @click="createCreatorName = member.name; isCreateDropdownOpen = false;"
                  >
                    <span class="member-name">{{ member.name }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 2. 모임 시간 형태 (해/달 SVG 아이콘 적용) -->
            <div class="form-group">
              <label class="form-label">모임 시간</label>
              <div class="apple-segmented-control">
                <button
                  type="button"
                  class="segment-btn"
                  :class="{ active: createSessionType === 'day' }"
                  @click="handleSelectCreateSessionType('day')"
                >
                  <svg class="theme_svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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
                  당일
                </button>
                <button
                  type="button"
                  class="segment-btn"
                  :class="{ active: createSessionType === 'overnight', disabled: isDayOnlyDate }"
                  :disabled="isDayOnlyDate"
                  :title="isDayOnlyDate ? '관리자가 당일로 지정한 날짜에는 밤샘 회차를 개설할 수 없습니다.' : ''"
                  @click="handleSelectCreateSessionType('overnight')"
                >
                  <svg class="theme_svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
                  </svg>
                  밤샘
                </button>
                <button
                  type="button"
                  class="segment-btn"
                  :class="{ active: createSessionType === 'custom' }"
                  @click="handleSelectCreateSessionType('custom')"
                >
                  커스텀
                </button>
              </div>

              <!-- 당일 선택 시 시작/종료 시간 미세 조정 UI -->
              <div v-if="createSessionType === 'day'" class="custom-time-box">
                <div class="time-picker-row">
                  <div class="time-field">
                    <div class="time-label-row">
                      <span class="time-label">시작 시간</span>
                      <button
                        type="button"
                        class="btn-ampm-toggle"
                        :class="{ 'is-pm': isPm(createStartTime) }"
                        @click="createStartTime = toggleAmPm(createStartTime)"
                      >
                        {{ isPm(createStartTime) ? '오후' : '오전' }}
                      </button>
                    </div>
                    <input type="time" v-model="createStartTime" class="apple-time-input" />
                  </div>
                  <span class="time-separator">~</span>
                  <div class="time-field">
                    <div class="time-label-row">
                      <span class="time-label">종료 시간</span>
                      <button
                        type="button"
                        class="btn-ampm-toggle"
                        :class="{ 'is-pm': isPm(createEndTime) }"
                        @click="createEndTime = toggleAmPm(createEndTime)"
                      >
                        {{ isPm(createEndTime) ? '오후' : '오전' }}
                      </button>
                    </div>
                    <input type="time" v-model="createEndTime" class="apple-time-input" />
                  </div>
                </div>
              </div>

              <!-- 밤샘 선택 시 시작 시간 수정 UI -->
              <div v-if="createSessionType === 'overnight'" class="custom-time-box">
                <div class="time-picker-row">
                  <div class="time-field">
                    <div class="time-label-row">
                      <span class="time-label">시작 시간</span>
                      <button
                        type="button"
                        class="btn-ampm-toggle"
                        :class="{ 'is-pm': isPm(createStartTime) }"
                        @click="createStartTime = toggleAmPm(createStartTime)"
                      >
                        {{ isPm(createStartTime) ? '오후' : '오전' }}
                      </button>
                    </div>
                    <input type="time" v-model="createStartTime" class="apple-time-input" />
                  </div>
                  <span class="time-separator">~</span>
                  <div class="time-field">
                    <span class="time-label">종료 시간</span>
                    <div class="time-fixed-tag">익일 (밤샘)</div>
                  </div>
                </div>
              </div>

              <!-- 커스텀 시간 선택 시 -->
              <div v-if="createSessionType === 'custom'" class="custom-time-box">
                <div class="time-picker-row">
                  <div class="time-field">
                    <div class="time-label-row">
                      <span class="time-label">시작 시간</span>
                      <button
                        type="button"
                        class="btn-ampm-toggle"
                        :class="{ 'is-pm': isPm(createStartTime) }"
                        @click="createStartTime = toggleAmPm(createStartTime)"
                      >
                        {{ isPm(createStartTime) ? '오후' : '오전' }}
                      </button>
                    </div>
                    <input type="time" v-model="createStartTime" class="apple-time-input" />
                  </div>
                  <span class="time-separator">~</span>
                  <div class="time-field">
                    <div class="time-label-row">
                      <span class="time-label">종료 시간</span>
                      <button
                        type="button"
                        class="btn-ampm-toggle"
                        :class="{ 'is-pm': isPm(createEndTime) }"
                        @click="createEndTime = toggleAmPm(createEndTime)"
                      >
                        {{ isPm(createEndTime) ? '오후' : '오전' }}
                      </button>
                    </div>
                    <input type="time" v-model="createEndTime" class="apple-time-input" />
                  </div>
                </div>
                <label class="overnight-check-label" :class="{ 'disabled-label': isDayOnlyDate }">
                  <input type="checkbox" v-model="createIsOvernight" :disabled="isDayOnlyDate" />
                  <span>익일(자정 이후) 포함</span>
                  <span v-if="isDayOnlyDate" class="day-only-hint">(당일 날짜는 밤샘 불가)</span>
                </label>
              </div>
            </div>

            <!-- 3. 확인 PIN -->
            <div class="form-group">
              <div class="label-with-tip">
                <label class="form-label">
                  확인 PIN (4~8자리)
                  <span v-if="isAdmin" class="admin-no-pin-badge">관리자 (PIN 불필요)</span>
                </label>
              </div>
              <input
                type="password"
                maxlength="8"
                inputmode="numeric"
                pattern="[0-9]*"
                class="apple-input pin-input"
                :class="{ 'input-disabled-admin': isAdmin }"
                v-model="createCreatorPin"
                :disabled="isAdmin"
                :placeholder="isAdmin ? '관리자 권한 (PIN 불필요)' : '••••'"
              />
            </div>

            <!-- 4. 메모 (선택) -->
            <div class="form-group">
              <label class="form-label">메모 (선택)</label>
              <input
                type="text"
                class="apple-input memo-input"
                v-model="createMemo"
                placeholder="예시: 도착 1시간쯤 늦을수도 있음"
                maxlength="60"
              />
            </div>
          </div>

          <div class="sheet-footer">
            <button type="button" class="btn-cancel-modal" @click="isCreateScheduleModalOpen = false">
              취소
            </button>
            <button type="button" class="btn-primary" @click="handleCreateScheduleSubmit">
              일정 만들기
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 관리자 인증 모달 -->
    <Transition name="apple-modal-fade">
      <div v-if="isAdminAuthModalOpen" class="apple-modal-backdrop" v-backdrop-dismiss="() => isAdminAuthModalOpen = false">
        <div class="apple-modal-sheet mini-sheet">
          <div class="sheet-header">
            <h3 class="sheet-title">관리자 인증</h3>
            <button class="btn-close" @click="isAdminAuthModalOpen = false">✕</button>
          </div>
          <div class="sheet-body">
            <p class="auth-desc">
              구글 관리자 계정으로 로그인되어 있거나, 발급받은 관리자 인증 코드를 입력하여 일정을 관리할 수 있습니다.
            </p>
            <div class="auth-form">
              <input
                type="password"
                class="apple-input"
                v-model="adminPasscodeInput"
                placeholder="관리자 인증 코드 입력"
                @keyup.enter="verifyAdminPasscode"
              />
              <button type="button" class="btn-primary" @click="verifyAdminPasscode">
                인증 확인
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.schedule-tab-root {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  position: relative;
  font-family: inherit;
}

.schedule-tab-root button,
.schedule-tab-root input,
.schedule-tab-root select,
.schedule-tab-root textarea {
  font-family: inherit;
}

/* 상단 헤더 바 */
.schedule-header-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 10px 0;
}

.month-selector {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
}

.current-month-label {
  font-size: 17px;
  font-weight: 700;
  color: var(--text-color, #0f172a);
  letter-spacing: -0.02em;
  min-width: 86px;
  text-align: center;
  height: 32px;
  line-height: 32px;
}

.btn-nav-month {
  background: var(--input-bg-color, #f1f5f9);
  border: 1px solid var(--border-color, #e2e8f0);
  color: var(--text-color, #0f172a);
  width: 32px;
  height: 32px;
  border-radius: 8px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  box-sizing: border-box;
}
.btn-nav-month:hover {
  background: var(--card-bg-color, #ffffff);
}

.btn-nav-refresh {
  background: var(--input-bg-color, #f1f5f9);
  border: 1px solid var(--border-color, #e2e8f0);
  color: var(--text-color, #0f172a);
  width: 32px;
  height: 32px;
  border-radius: 8px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  box-sizing: border-box;
  margin-left: 2px;
  padding: 0;
}
.btn-nav-refresh:hover:not(:disabled) {
  background: var(--card-bg-color, #ffffff);
  border-color: #3b82f6;
  color: #3b82f6;
}
.btn-nav-refresh svg {
  display: block;
  transition: transform 0.2s ease;
}
.btn-nav-refresh.is-loading svg {
  animation: spinRefresh 0.8s linear infinite;
}
.btn-nav-refresh:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
@keyframes spinRefresh {
  to { transform: rotate(360deg); }
}

.btn-today {
  background: transparent;
  border: 1px solid var(--border-color, #cbd5e1);
  color: var(--text-color, #0f172a);
  padding: 0 10px;
  height: 32px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  transition: all 0.15s;
}
.btn-today:hover {
  background: var(--input-bg-color, #f1f5f9);
}

.stat-chips-group {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
}

.stat-chip {
  font-size: 12px;
  font-weight: 600;
  height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  line-height: 1;
  white-space: nowrap;
  background: var(--input-bg-color, #f1f5f9);
  color: var(--text-dimmed, #64748b);
  border: 1px solid var(--border-color, #e2e8f0);
}
/* 1) 확정 통계 뱃지: 에메랄드 그린 */
.stat-chip.chip-confirmed {
  background: rgba(16, 185, 129, 0.12);
  color: #047857;
  border-color: rgba(16, 185, 129, 0.3);
  font-weight: 700;
}
html.dark .stat-chip.chip-confirmed {
  background: rgba(16, 185, 129, 0.18);
  color: #34d399;
  border-color: rgba(16, 185, 129, 0.4);
}
/* 2) 확정 회차 인터랙티브 칩: 인디고/퍼플 캡슐 (확정과 확연히 구별) */
.stat-chip.chip-confirmed-date {
  font-size: 11.5px;
  font-weight: 600;
  height: 30px;
  padding: 0 9px;
  border-radius: 8px;
  background: rgba(99, 102, 241, 0.1);
  color: #4f46e5;
  border: 1px solid rgba(99, 102, 241, 0.3);
  cursor: pointer;
  transition: all 0.15s ease;
  display: inline-flex;
  align-items: center;
  box-sizing: border-box;
}
.stat-chip.chip-confirmed-date:hover {
  background: rgba(99, 102, 241, 0.18);
  color: #4338ca;
  border-color: rgba(99, 102, 241, 0.5);
  transform: translateY(-1px);
  box-shadow: 0 2px 5px rgba(99, 102, 241, 0.15);
}
html.dark .stat-chip.chip-confirmed-date {
  background: rgba(99, 102, 241, 0.2);
  color: #a5b4fc;
  border-color: rgba(99, 102, 241, 0.45);
}
/* 3) 내 참석 통계 뱃지: 맑은 사파이어 블루 */
.stat-chip.chip-me {
  background: rgba(37, 99, 235, 0.1);
  color: #1d4ed8;
  border-color: rgba(37, 99, 235, 0.25);
  font-weight: 700;
}
html.dark .stat-chip.chip-me {
  background: rgba(37, 99, 235, 0.2);
  color: #60a5fa;
  border-color: rgba(37, 99, 235, 0.4);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
}

/* 캡슐형 세그먼트 컨트롤 */
.apple-segmented-control {
  display: inline-flex;
  align-items: center;
  background: var(--input-bg-color, #f1f5f9);
  padding: 2px;
  border-radius: 9px;
  gap: 2px;
  border: 1px solid var(--border-color, #e2e8f0);
  height: 32px;
  box-sizing: border-box;
}

.segment-btn {
  border: none;
  background: transparent;
  height: 26px;
  line-height: 26px;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 500;
  border-radius: 7px;
  color: var(--text-dimmed, #64748b);
  cursor: pointer;
  transition: all 0.15s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}
.segment-btn.active {
  background: var(--card-bg-color, #ffffff);
  color: var(--text-color, #0f172a);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}
.segment-btn:disabled,
.segment-btn.disabled {
  opacity: 0.38;
  cursor: not-allowed;
  pointer-events: none;
}

.btn-action-outline {
  background: transparent;
  border: 1px solid var(--border-color, #cbd5e1);
  color: var(--text-color, #0f172a);
  height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  box-sizing: border-box;
  transition: all 0.15s;
}
.btn-action-outline:hover {
  background: var(--input-bg-color, #f1f5f9);
}

.btn-action-admin {
  background: #0f172a;
  color: #ffffff;
  border: none;
  height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  transition: opacity 0.15s;
}
.btn-action-admin:hover {
  opacity: 0.88;
}
html.dark .btn-action-admin {
  background: #2563eb;
  color: #ffffff;
  box-shadow: 0 2px 6px rgba(37, 99, 235, 0.35);
}
.admin-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #10b981;
}

.btn-auth-trigger {
  font-size: 12px;
}

/* 팝업 모달 공통 */
.apple-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  padding: 16px;
}

.apple-modal-sheet {
  background: var(--card-bg-color, #ffffff);
  color: var(--text-color, #0f172a);
  border: 1px solid var(--border-color, rgba(0, 0, 0, 0.08));
  border-radius: 20px;
  width: 100%;
  max-width: 520px;
  max-height: 90vh;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: sheetPop 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  font-family: inherit;
}

.apple-modal-sheet.mini-sheet {
  max-width: 400px;
}

.autocomplete-wrapper {
  position: relative;
  width: 100%;
  display: block;
}
.autocomplete-wrapper .apple-input {
  width: 100%;
  box-sizing: border-box;
  padding-right: 36px;
}

.dropdown-toggle-btn {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  background: transparent;
  border: none;
  font-size: 13px;
  color: var(--text-dimmed, #64748b);
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
}

.autocomplete-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 180px;
  overflow-y: auto;
  background: var(--card-bg-color, #ffffff);
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 12px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  font-family: inherit;
}

.dropdown-item {
  padding: 9px 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
  color: var(--text-color, #0f172a);
  font-family: inherit;
}
.dropdown-item.selected {
  font-weight: 700;
  color: #2563eb;
  background: rgba(59, 130, 246, 0.05);
}
.dropdown-item:hover, .dropdown-item.highlighted {
  background: rgba(59, 130, 246, 0.12);
  color: #1d4ed8;
}
html.dark .dropdown-item.selected {
  color: #93c5fd;
  background: rgba(59, 130, 246, 0.1);
}
html.dark .dropdown-item:hover, html.dark .dropdown-item.highlighted {
  background: rgba(59, 130, 246, 0.22);
  color: #60a5fa;
}

.sheet-header {
  padding: 16px 20px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-color, rgba(0, 0, 0, 0.06));
  flex-shrink: 0;
}

.sheet-title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
}

.btn-close {
  background: transparent;
  border: none;
  font-size: 16px;
  color: var(--text-dimmed, #64748b);
  cursor: pointer;
  padding: 4px;
}

.sheet-body {
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  position: relative;
}

.form-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color, #0f172a);
  font-family: inherit;
}

.time-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.btn-ampm-toggle {
  background: var(--card-bg-color, #ffffff);
  border: 1px solid var(--border-color, #cbd5e1);
  color: #2563eb;
  padding: 2px 7px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s ease;
}
.btn-ampm-toggle.is-pm {
  background: rgba(139, 92, 246, 0.12);
  color: #7c3aed;
  border-color: rgba(139, 92, 246, 0.35);
}

.pin-input {
  max-width: 110px;
  text-align: center;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.25em;
}

.pin-input.input-disabled-admin {
  max-width: 220px;
  letter-spacing: normal;
  text-align: left;
  font-size: 12px;
  font-weight: 600;
  background: rgba(0, 0, 0, 0.04);
  color: var(--text-dimmed, #64748b);
  border-color: var(--border-color, rgba(0, 0, 0, 0.1));
  cursor: not-allowed;
  user-select: none;
}
html.dark .pin-input.input-disabled-admin {
  background: rgba(255, 255, 255, 0.05);
  color: #94a3b8;
  border-color: rgba(255, 255, 255, 0.1);
}

.label-with-tip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.admin-no-pin-badge {
  font-size: 10px;
  font-weight: 700;
  color: #2563eb;
  background: rgba(37, 99, 235, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
  margin-left: 6px;
}
html.dark .admin-no-pin-badge {
  color: #60a5fa;
  background: rgba(96, 165, 250, 0.15);
}

.input-tip.tip-admin {
  color: #2563eb;
  font-weight: 600;
  font-size: 11px;
}
html.dark .input-tip.tip-admin {
  color: #60a5fa;
}

.admin-field-hint {
  margin: 4px 0 0;
  font-size: 11px;
  color: #2563eb;
  font-weight: 500;
}
html.dark .admin-field-hint {
  color: #60a5fa;
}

.btn-user-auth {
  height: 32px;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 11px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: inherit;
  background: var(--input-bg-color, #f1f5f9);
  border: 1px solid var(--border-color, #cbd5e1);
  color: var(--text-dimmed, #475569);
}
.btn-user-auth:hover {
  background: var(--card-bg-color, #ffffff);
  border-color: #94a3b8;
  color: var(--text-color, #0f172a);
}
/* 4) 로그인 상태 프로필: 차콜/슬레이트 캡슐 + 초록 점 (블루 통계와 완벽 구별) */
.btn-user-auth.is-logged-in {
  background: var(--card-bg-color, #ffffff);
  border: 1px solid rgba(0, 0, 0, 0.15);
  color: var(--text-color, #0f172a);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}
.btn-user-auth.is-logged-in:hover {
  border-color: rgba(0, 0, 0, 0.28);
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.08);
}
html.dark .btn-user-auth.is-logged-in {
  background: #1e293b;
  border-color: rgba(255, 255, 255, 0.18);
  color: #f1f5f9;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}
html.dark .btn-user-auth.is-logged-in:hover {
  border-color: rgba(255, 255, 255, 0.32);
}
.auth-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #10b981;
  flex-shrink: 0;
}

.user-auth-badge {
  font-size: 9px;
  font-weight: 800;
  background: #2563eb;
  color: #ffffff;
  padding: 1px 4px;
  border-radius: 4px;
  letter-spacing: -0.02em;
}
html.dark .user-auth-badge {
  background: #3b82f6;
}

.user-auth-name {
  max-width: 90px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.memo-input {
  width: 100%;
  box-sizing: border-box;
  padding: 11px 14px;
  font-size: 14px;
}

.sheet-footer {
  padding: 16px 20px;
  border-top: 1px solid var(--border-color, rgba(0, 0, 0, 0.06));
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 10px;
  background: var(--card-bg-color, #ffffff);
  flex-shrink: 0;
}

@media (max-height: 640px) {
  .apple-modal-backdrop {
    padding: 8px;
  }
  .apple-modal-sheet {
    max-height: 95vh;
    border-radius: 14px;
  }
  .sheet-header {
    padding: 10px 16px 8px;
  }
  .sheet-body {
    padding: 12px 16px;
    gap: 10px;
  }
  .sheet-footer {
    padding: 10px 16px 12px;
  }
}

.quick-add-desc, .auth-desc {
  font-size: 13px;
  color: var(--text-dimmed, #64748b);
  margin: 0;
  line-height: 1.5;
}

.quick-action-buttons {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
}

.btn-quick-day {
  background: rgba(59, 130, 246, 0.12);
  color: #2563eb;
  border: 1px solid rgba(59, 130, 246, 0.3);
  padding: 11px 16px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s;
  text-align: center;
}
.btn-quick-day:hover {
  background: rgba(59, 130, 246, 0.2);
}

.btn-quick-overnight {
  background: rgba(139, 92, 246, 0.14);
  color: #7c3aed;
  border: 1px solid rgba(139, 92, 246, 0.3);
  padding: 11px 16px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s;
  text-align: center;
}
.btn-quick-overnight:hover {
  background: rgba(139, 92, 246, 0.22);
}

.auth-form {
  display: flex;
  gap: 8px;
}

.apple-input {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 14px;
  border-radius: 12px;
  border: 1px solid var(--border-color, #cbd5e1);
  background: var(--input-bg-color, #f8fafc);
  color: var(--text-color, #0f172a);
  font-size: 14px;
  outline: none;
  font-family: inherit;
}
.apple-input:focus {
  border-color: #3b82f6;
}
.auth-form .apple-input {
  flex: 1;
  width: auto;
}

.btn-primary {
  background: #2563eb;
  color: #ffffff;
  border: none;
  padding: 10px 18px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  font-family: inherit;
}

.btn-cancel-modal {
  background: var(--input-bg-color, #f1f5f9);
  color: var(--text-dimmed, #64748b);
  border: 1px solid var(--border-color, #cbd5e1);
  padding: 10px 16px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
  font-family: inherit;
}
.btn-cancel-modal:hover {
  background: #e2e8f0;
  color: var(--text-color, #0f172a);
}

.error-banner {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.25);
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  margin: 12px 20px 0;
}

.custom-time-box {
  margin-top: 10px;
  padding: 12px;
  background: var(--input-bg-color, #f8fafc);
  border-radius: 12px;
  border: 1px solid var(--border-color, #e2e8f0);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.time-picker-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.time-field {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.time-label {
  font-size: 11px;
  color: var(--text-dimmed, #64748b);
  font-family: inherit;
}

.time-separator {
  color: var(--text-dimmed, #64748b);
  font-weight: 700;
  margin-top: 16px;
}

.time-fixed-tag {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border-radius: 9px;
  border: 1px solid rgba(139, 92, 246, 0.25);
  background: rgba(139, 92, 246, 0.08);
  color: #7c3aed;
  font-size: 13px;
  font-weight: 700;
  text-align: center;
  font-family: inherit;
}

.apple-time-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border-radius: 9px;
  border: 1px solid var(--border-color, #cbd5e1);
  background: var(--card-bg-color, #ffffff);
  color: var(--text-color, #0f172a);
  font-size: 14px;
  font-weight: 600;
  text-align: center;
  outline: none;
  font-family: inherit;
  transition: all 0.15s ease;
}
.apple-time-input:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
}

.overnight-check-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  cursor: pointer;
  color: var(--text-color, #0f172a);
  font-family: inherit;
  margin-top: 2px;
}
.overnight-check-label.disabled-label {
  opacity: 0.45;
  cursor: not-allowed;
}
.day-only-hint {
  font-size: 11px;
  color: #ef4444;
  font-weight: 500;
}

@keyframes sheetPop {
  from {
    opacity: 0;
    transform: scale(0.96) translateY(8px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

/* 토스트 */
.schedule-toast {
  position: fixed;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 20px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
  z-index: 100000;
}
.schedule-toast.success {
  background: #0f172a;
  color: #ffffff;
}
.schedule-toast.error {
  background: #ef4444;
  color: #ffffff;
}
.schedule-toast.info {
  background: #1e293b;
  color: #ffffff;
  border: 1px solid #334155;
}

.toast-fade-enter-active, .toast-fade-leave-active {
  transition: all 0.2s ease;
}
.toast-fade-enter-from, .toast-fade-leave-to {
  opacity: 0;
  transform: translate(-50%, -10px);
}

.schedule-loading {
  padding: 60px;
  display: flex;
  justify-content: center;
}
.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(59, 130, 246, 0.2);
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 640px) {
  .schedule-header-bar {
    flex-direction: column;
    align-items: stretch;
  }
  .stat-chips-group {
    order: 3;
    overflow-x: auto;
    padding-bottom: 4px;
  }
  .header-actions {
    justify-content: space-between;
  }
}
</style>
