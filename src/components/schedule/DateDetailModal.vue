<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import type { ScheduleDayItem, SessionType, ScheduleAttendee } from '@/types/schedule';
import {
  computeEffectiveOverlapRange,
  getAttendeeInterval,
  computeSessionTimeFromAttendees,
  timeStringToMinutes
} from '@/utils/timelineEngine';
import { getSavedPins, hashPin } from '@/services/scheduleService';
import {
  checkPinLockout,
  recordPinFailure,
  recordPinSuccess,
  applyDelayIfRepeated
} from '@/utils/pinRateLimiter';
import { createSessionSheetIfNotExist, saveSessionMembers, isGoogleAuthError, deleteSessionSheetByName } from '@/utils/googleSheets';

const props = defineProps<{
  isOpen: boolean;
  dayItem: ScheduleDayItem | null;
  sessionNumber: number | null;
  myAttendeeName?: string;
  isAdmin?: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'openAttend', attendeeName?: string): void;
  (e: 'toggleSessionType', dateStr: string): void;
  (e: 'updateSessionType', payload: {
    dateStr: string;
    sessionType?: SessionType;
    adminSessionType?: 'day' | 'overnight';
    customStartTime?: string;
    customEndTime?: string;
    customIsOvernight?: boolean;
    sessionNumber?: number;
    sheetTitle?: string;
  }): void;
  (e: 'deleteDate', dateStr: string, pin?: string): void;
  (e: 'removeAttendee', dateStr: string, attendeeName: string, pin?: string): void;
  (e: 'clearAttendees', dateStr: string): void;
  (e: 'toggleConfirm', dateStr: string): void;
  (e: 'toast', message: string, type?: 'success' | 'error'): void;
}>();

const isManager = computed(() => {
  if (props.isAdmin) return true;
  if (props.myAttendeeName && props.dayItem?.creator === props.myAttendeeName) return true;
  return false;
});

// 회차 상세 창 서브 탭 ('info': 회차 상세 및 참가자 명단, 'timetable': 가로/세로 타임테이블)
const activeDetailTab = ref<'info' | 'timetable'>('info');

// 모달이 열릴 때 항상 'info' 탭으로 기본 초기화
watch(() => props.isOpen, (open) => {
  if (open) {
    activeDetailTab.value = 'info';
  }
});

const isEditingCustomSession = ref(false);
const customStartInput = ref('10:00');
const customEndInput = ref('22:00');
const customOvernightInput = ref(false);

// 타임테이블 가로(horizontal)/세로(vertical) 토글 모드
const timetableOrientation = ref<'horizontal' | 'vertical'>('horizontal');

// --- 타임테이블 상단 스크롤바 동기화 및 마우스 휠/중앙 클릭 제어 ---
const verticalMainScrollRef = ref<HTMLElement | null>(null);
const verticalTopScrollRef = ref<HTMLElement | null>(null);
const verticalScrollWidth = ref(0);
const isVerticalScrollable = ref(false);

const horizontalMainScrollRef = ref<HTMLElement | null>(null);
const horizontalTopScrollRef = ref<HTMLElement | null>(null);
const horizontalScrollWidth = ref(0);
const isHorizontalScrollable = ref(false);

let isSyncingVertical = false;
let isSyncingHorizontal = false;

const onVerticalMainScroll = () => {
  if (isSyncingVertical) return;
  if (!verticalMainScrollRef.value || !verticalTopScrollRef.value) return;
  isSyncingVertical = true;
  verticalTopScrollRef.value.scrollLeft = verticalMainScrollRef.value.scrollLeft;
  requestAnimationFrame(() => { isSyncingVertical = false; });
};

const onVerticalTopScroll = () => {
  if (isSyncingVertical) return;
  if (!verticalMainScrollRef.value || !verticalTopScrollRef.value) return;
  isSyncingVertical = true;
  verticalMainScrollRef.value.scrollLeft = verticalTopScrollRef.value.scrollLeft;
  requestAnimationFrame(() => { isSyncingVertical = false; });
};

const onHorizontalMainScroll = () => {
  if (isSyncingHorizontal) return;
  if (!horizontalMainScrollRef.value || !horizontalTopScrollRef.value) return;
  isSyncingHorizontal = true;
  horizontalTopScrollRef.value.scrollLeft = horizontalMainScrollRef.value.scrollLeft;
  requestAnimationFrame(() => { isSyncingHorizontal = false; });
};

const onHorizontalTopScroll = () => {
  if (isSyncingHorizontal) return;
  if (!horizontalMainScrollRef.value || !horizontalTopScrollRef.value) return;
  isSyncingHorizontal = true;
  horizontalMainScrollRef.value.scrollLeft = horizontalTopScrollRef.value.scrollLeft;
  requestAnimationFrame(() => { isSyncingHorizontal = false; });
};

const updateScrollDimensions = () => {
  nextTick(() => {
    if (verticalMainScrollRef.value) {
      const sw = verticalMainScrollRef.value.scrollWidth;
      const cw = verticalMainScrollRef.value.clientWidth;
      verticalScrollWidth.value = sw;
      isVerticalScrollable.value = sw > cw + 2;
    }
    if (horizontalMainScrollRef.value) {
      const sw = horizontalMainScrollRef.value.scrollWidth;
      const cw = horizontalMainScrollRef.value.clientWidth;
      horizontalScrollWidth.value = sw;
      isHorizontalScrollable.value = sw > cw + 2;
    }
  });
};

watch([() => props.isOpen, () => activeDetailTab.value, () => timetableOrientation.value, () => props.dayItem?.attendees], () => {
  updateScrollDimensions();
}, { deep: true });

onMounted(() => {
  updateScrollDimensions();
  window.addEventListener('resize', updateScrollDimensions);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateScrollDimensions);
});

// 마우스 세로 휠을 부드러운 가로 스크롤로 자동 변환
const onHorizontalWheel = (e: WheelEvent) => {
  const container = e.currentTarget as HTMLElement;
  if (!container) return;
  if (container.scrollWidth > container.clientWidth) {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      container.scrollLeft += e.deltaY;
    }
  }
};

// 마우스 중앙 휠 클릭(button === 1) 시 드래그로 좌우 이동
const onMiddleMouseDown = (e: MouseEvent) => {
  if (e.button !== 1) return; // 중앙 휠 클릭만 동작
  const container = e.currentTarget as HTMLElement;
  if (!container) return;

  e.preventDefault();
  const startX = e.clientX;
  const startScrollLeft = container.scrollLeft;
  const prevCursor = document.body.style.cursor;
  document.body.style.cursor = 'grabbing';

  const onMouseMove = (moveEvt: MouseEvent) => {
    moveEvt.preventDefault();
    const dx = moveEvt.clientX - startX;
    container.scrollLeft = startScrollLeft - dx;
  };

  const onMouseUp = () => {
    document.body.style.cursor = prevCursor;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  };

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
};

// 오전/오후 판별 및 토글
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

watch(() => props.dayItem, (newDay) => {
  if (newDay) {
    customStartInput.value = newDay.customStartTime || '10:00';
    customEndInput.value = newDay.customEndTime || '22:00';
    customOvernightInput.value = !!newDay.customIsOvernight;
    isEditingCustomSession.value = false;
  }
}, { immediate: true });

const attendeeCount = computed(() => props.dayItem?.attendees?.length || 0);

const isDayOnly = computed(() => {
  if (!props.dayItem) return false;
  return props.dayItem.adminSessionType === 'day';
});

const overlapTimeRange = computed(() => {
  if (!props.dayItem?.attendees) return null;
  return computeEffectiveOverlapRange(props.dayItem.attendees, isDayOnly.value);
});

const isUserAttending = computed(() => {
  if (!props.dayItem?.attendees || !props.myAttendeeName) return false;
  return props.dayItem.attendees.some(a => a.name === props.myAttendeeName);
});

const getDayOfWeek = (dateStr: string) => {
  const d = new Date(dateStr);
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return days[d.getDay()] || '';
};

// 타임테이블 전체 윈도우 계산 (시작분, 종료분, 전체분)
const timetableWindow = computed(() => {
  if (!props.dayItem || !props.dayItem.attendees || props.dayItem.attendees.length === 0) {
    return { startMin: 600, endMin: 1380, totalMin: 780, isOvernight: false };
  }
  const attendees = props.dayItem.attendees;
  const isOvernight = !isDayOnly.value && (
    props.dayItem.sessionType === 'overnight' ||
    props.dayItem.customIsOvernight ||
    props.dayItem.adminSessionType === 'overnight' ||
    attendees.some(a => a.isOvernight)
  );

  let minStart = 600; // 10:00
  let maxEnd = isOvernight ? 1800 : 1380; // 익일 06:00 (1800분) 또는 23:00 (1380분)

  for (const a of attendees) {
    const [s, e] = getAttendeeInterval(a, isDayOnly.value);
    if (s < minStart) minStart = Math.max(360, s);
    if (e > maxEnd) maxEnd = Math.min(2160, e);
  }

  const windowStart = Math.floor(minStart / 60) * 60;
  const safeEndMin = maxEnd + 60;
  const windowEnd = Math.ceil(safeEndMin / 60) * 60;

  return {
    startMin: windowStart,
    endMin: windowEnd,
    totalMin: Math.max(60, windowEnd - windowStart),
    isOvernight
  };
});

// 가로 시간표 눈금 (슬림 '시' 및 '+H시' 단위, 당일 2시간/밤샘 3시간 동적 간격)
const timeTicks = computed(() => {
  const { startMin, endMin, totalMin } = timetableWindow.value;
  const ticks: { min: number; label: string; shortLabel: string }[] = [];
  const step = totalMin > 900 ? 180 : 120;

  for (let m = startMin; m <= endMin; m += step) {
    const isNextDay = m >= 1440;
    const h = Math.floor((m % 1440) / 60);
    let label = '';
    let shortLabel = '';
    if (m === 1440) {
      label = '24시';
      shortLabel = '24';
    } else if (isNextDay) {
      label = `+${h}시`;
      shortLabel = `+${h}`;
    } else {
      label = `${h}시`;
      shortLabel = `${h}`;
    }
    ticks.push({ min: m, label, shortLabel });
  }
  return ticks;
});

// 세로 시간표 눈금 (1시간 간격)
const verticalTimeTicks = computed(() => {
  const { startMin, endMin } = timetableWindow.value;
  const ticks: { min: number; label: string; shortLabel: string; hour: number }[] = [];
  for (let m = startMin; m <= endMin; m += 60) {
    const isNextDay = m >= 1440;
    const h = Math.floor((m % 1440) / 60);
    let label = '';
    let shortLabel = '';
    if (m === 1440) {
      label = '24시';
      shortLabel = '24';
    } else if (isNextDay) {
      label = `익일 ${h}시`;
      shortLabel = `+${h}`;
    } else {
      label = `${h}시`;
      shortLabel = `${h}`;
    }
    ticks.push({ min: m, label, shortLabel, hour: h });
  }
  return ticks;
});

// 개별 참가자 바/블록 위치 및 시간 레이블
const getAttendeeBar = (att: ScheduleAttendee) => {
  const [sMin, eMin] = getAttendeeInterval(att);
  const { startMin, totalMin } = timetableWindow.value;

  const leftPercent = Math.max(0, Math.min(100, ((sMin - startMin) / totalMin) * 100));
  const widthPercent = Math.max(3, Math.min(100 - leftPercent, ((eMin - sMin) / totalMin) * 100));

  const topPercent = Math.max(0, Math.min(100, ((sMin - startMin) / totalMin) * 100));
  const heightPercent = Math.max(4, Math.min(100 - topPercent, ((eMin - sMin) / totalMin) * 100));

  const startFormatted = att.startTime || '10:00';
  const endFormatted = att.isOvernight ? '익일' : (att.endTime || '22:00');

  return {
    left: `${leftPercent}%`,
    width: `${widthPercent}%`,
    top: `${topPercent}%`,
    height: `${heightPercent}%`,
    timeLabel: `${startFormatted} ~ ${endFormatted}`,
    isOvernight: att.isOvernight
  };
};

// 골든타임(4인 이상 겹치는 시간) 영역 하이라이트
const overlapHighlightRegion = computed(() => {
  if (!props.dayItem?.attendees || props.dayItem.attendees.length < 4) return null;
  const intervals = props.dayItem.attendees.map(a => getAttendeeInterval(a));
  const { startMin, endMin, totalMin } = timetableWindow.value;

  let firstMin: number | null = null;
  let lastMin: number | null = null;
  for (let m = startMin; m <= endMin; m += 15) {
    const active = intervals.filter(([s, e]) => s <= m && m < e).length;
    if (active >= 4) {
      if (firstMin === null) firstMin = m;
      lastMin = m + 15;
    }
  }

  if (firstMin === null || lastMin === null) return null;

  const leftPercent = Math.max(0, Math.min(100, ((firstMin - startMin) / totalMin) * 100));
  const widthPercent = Math.max(0, Math.min(100 - leftPercent, ((lastMin - firstMin) / totalMin) * 100));

  const topPercent = Math.max(0, Math.min(100, ((firstMin - startMin) / totalMin) * 100));
  const heightPercent = Math.max(0, Math.min(100 - topPercent, ((lastMin - firstMin) / totalMin) * 100));

  return {
    left: `${leftPercent}%`,
    width: `${widthPercent}%`,
    top: `${topPercent}%`,
    height: `${heightPercent}%`
  };
});

const changeSession = (type: 'day' | 'overnight') => {
  if (!props.dayItem) return;
  if (type === 'overnight' && isDayOnly.value) {
    emit('toast', '당일로 개설된 회차는 밤샘으로 변경할 수 없습니다.', 'error');
    return;
  }
  isEditingCustomSession.value = false;
  emit('updateSessionType', {
    dateStr: props.dayItem.date,
    sessionType: type,
    adminSessionType: props.dayItem.adminSessionType
  });
};

const saveCustomSession = () => {
  if (!props.dayItem) return;
  if (isDayOnly.value) {
    const sM = timeStringToMinutes(customStartInput.value);
    const eM = timeStringToMinutes(customEndInput.value);
    if (eM <= sM) {
      alert('당일 날짜는 종료 시간이 시작 시간보다 늦어야 합니다 (밤샘 불가).');
      return;
    }
  }
  emit('updateSessionType', {
    dateStr: props.dayItem.date,
    sessionType: 'custom',
    adminSessionType: props.dayItem.adminSessionType,
    customStartTime: customStartInput.value,
    customEndTime: customEndInput.value,
    customIsOvernight: isDayOnly.value ? false : customOvernightInput.value
  });
  isEditingCustomSession.value = false;
};

// 날짜(회차) 삭제 PIN 확인 모달 상태
const isDeleteDatePinModalOpen = ref(false);
const deleteDatePinInput = ref('');
const deleteDatePinErrorMessage = ref('');

// 회차 정보 초기화 (날짜는 가능한 일정 목록으로 유지)
const onDeleteDateClick = async () => {
  if (!props.dayItem) return;

  const count = props.dayItem.attendees?.length || 0;
  const countMsg = count > 0 ? `\n(등록된 참가자 ${count}명의 신청 내역도 함께 초기화됩니다)` : '';

  // 1) 관리자 로그인 상태인 경우: PIN 없이 즉시 회차 취소 가능
  if (props.isAdmin) {
    if (confirm(`정말 이 회차(${props.dayItem.date})를 취소하시겠습니까?${countMsg}\n(날짜는 가능한 일정 목록에 그대로 유지됩니다)`)) {
      emit('clearAttendees', props.dayItem.date);
    }
    return;
  }

  // 2) 비관리자이지만 캐시된 개설자 PIN이 있는 경우 자동 확인
  const creatorName = props.dayItem.creator?.trim();
  if (creatorName && props.dayItem.creatorPinHash) {
    const savedPins = getSavedPins();
    const cachedPin = savedPins[creatorName];
    if (cachedPin && cachedPin.length >= 4) {
      const hashedCached = await hashPin(cachedPin);
      if (hashedCached === props.dayItem.creatorPinHash) {
        if (confirm(`개설자('${creatorName}') 인증이 확인되었습니다.\n정말 이 회차(${props.dayItem.date})를 취소하시겠습니까?${countMsg}\n(날짜는 가능한 일정으로 유지됩니다)`)) {
          emit('clearAttendees', props.dayItem.date);
          return;
        }
        return;
      }
    }
  }

  // 3) 개설자 PIN 입력 모달 오픈
  deleteDatePinInput.value = '';
  deleteDatePinErrorMessage.value = '';
  isDeleteDatePinModalOpen.value = true;
};

const confirmDeleteDateWithPin = async () => {
  if (!props.dayItem) return;
  const targetKey = props.dayItem.creator || props.dayItem.date;
  const lockStatus = checkPinLockout(targetKey);
  if (lockStatus.isLocked) {
    deleteDatePinErrorMessage.value = `보안을 위해 ${lockStatus.remainingSeconds}초 동안 시도가 제한됩니다.`;
    return;
  }

  const trimmed = deleteDatePinInput.value.trim();
  if (!trimmed || trimmed.length < 4) {
    deleteDatePinErrorMessage.value = '확인 PIN(4~8자리)을 입력해주세요.';
    return;
  }

  await applyDelayIfRepeated(targetKey);

  // 개설자 PIN 해시 비교 (클라이언트단 사전 검증)
  if (props.dayItem.creatorPinHash && props.dayItem.creatorPinHash !== 'admin_bypass') {
    const clientHash = await hashPin(trimmed);
    if (clientHash !== props.dayItem.creatorPinHash) {
      const fail = recordPinFailure(targetKey);
      if (fail.isLocked) {
        deleteDatePinErrorMessage.value = `연속 5회 실패로 ${fail.remainingSeconds}초 동안 입력이 차단됩니다.`;
      } else {
        const remaining = 5 - (fail.failCount % 5);
        deleteDatePinErrorMessage.value = `개설자 PIN 비밀번호가 일치하지 않습니다. (연속 ${remaining}회 더 실패 시 30초 잠금)`;
      }
      return;
    }
  }

  recordPinSuccess(targetKey);
  emit('clearAttendees', props.dayItem.date);
  isDeleteDatePinModalOpen.value = false;
};

// 해당 회차 참가인원 전체 비우기 (날짜는 가능한 일정으로 유지)
const onClearAttendeesClick = () => {
  if (!props.dayItem) return;
  const count = props.dayItem.attendees?.length || 0;
  if (confirm(`정말 이 회차의 참가 인원을 전부 비우시겠습니까?\n(등록된 참가자 ${count}명이 모두 취소되며, 날짜는 가능한 일정으로 유지됩니다)`)) {
    emit('clearAttendees', props.dayItem.date);
  }
};

// 참석 취소 모달 상태
const isRemovePinModalOpen = ref(false);
const isAdminRemoveModalOpen = ref(false);
const removeTargetName = ref('');
const removePinInput = ref('');
const removePinErrorMessage = ref('');

const onRemoveAttendeeClick = (event: Event, name: string) => {
  event.stopPropagation();
  if (!props.dayItem) return;
  removeTargetName.value = name;

  // 1) 개설자 또는 관리자인 경우: PIN 없는 내부 확인 모달 기동 (브라우저 confirm 배제)
  if (isManager.value) {
    isAdminRemoveModalOpen.value = true;
    return;
  }

  // 2) 일반 사용자의 경우: 내부 PIN 입력 모달 창 띄우기 (브라우저 confirm 배제)
  removePinInput.value = '';
  removePinErrorMessage.value = '';
  isRemovePinModalOpen.value = true;
};

const confirmAdminRemove = () => {
  if (!props.dayItem || !removeTargetName.value) return;
  emit('removeAttendee', props.dayItem.date, removeTargetName.value, 'admin_bypass');
  isAdminRemoveModalOpen.value = false;
};

const confirmRemoveWithPin = async () => {
  if (!props.dayItem || !removeTargetName.value) return;
  const targetKey = removeTargetName.value;
  const lockStatus = checkPinLockout(targetKey);
  if (lockStatus.isLocked) {
    removePinErrorMessage.value = `보안을 위해 ${lockStatus.remainingSeconds}초 동안 시도가 제한됩니다.`;
    return;
  }

  const trimmed = removePinInput.value.trim();
  if (!trimmed || trimmed.length < 4) {
    removePinErrorMessage.value = '확인 PIN(4~8자리)을 입력해주세요.';
    return;
  }

  await applyDelayIfRepeated(targetKey);

  // 클라이언트 사전 검증: 대상 참가자의 PIN 또는 개설자의 PIN 둘 중 하나라도 맞으면 통과
  const targetAttendee = props.dayItem.attendees?.find(a => a.name === removeTargetName.value);
  if (targetAttendee) {
    const inputHash = await hashPin(trimmed);
    const matchesTarget = targetAttendee.pinHash && (targetAttendee.pinHash === inputHash || targetAttendee.pinHash === 'admin_bypass');
    const matchesCreator = props.dayItem.creatorPinHash && (props.dayItem.creatorPinHash === inputHash);

    if (targetAttendee.pinHash && !matchesTarget && !matchesCreator) {
      const fail = recordPinFailure(targetKey);
      if (fail.isLocked) {
        removePinErrorMessage.value = `연속 5회 실패로 ${fail.remainingSeconds}초 동안 입력이 차단됩니다.`;
      } else {
        const remaining = 5 - (fail.failCount % 5);
        removePinErrorMessage.value = `등록 PIN 또는 개설자 PIN이 일치하지 않습니다. (연속 ${remaining}회 더 실패 시 30초 잠금)`;
      }
      return;
    }
  }

  recordPinSuccess(targetKey);
  emit('removeAttendee', props.dayItem.date, removeTargetName.value, trimmed);
  isRemovePinModalOpen.value = false;
};

// --- 관리자 구글 계정 연동 및 회차 생성 상태 ---
const isGoogleAdminLoggedIn = computed(() => {
  return props.isAdmin && localStorage.getItem('google_is_logged_in') === 'true' && !!localStorage.getItem('google_spreadsheet_id');
});
const currentSessionSheetName = ref(localStorage.getItem('current_session_sheet_name') || '');

const isCreateSessionSheetModalOpen = ref(false);
const newSessionSheetTitle = ref('');
const includeAttendeesInNewSession = ref(true);
const isCreatingSessionSheet = ref(false);
const sheetCreateProgress = ref(0);
const sheetCreateStatusText = ref('');

const openCreateSessionSheetModal = async () => {
  if (!props.dayItem) return;
  // YYMMDD 계산: "2026-04-18" -> "260418"
  const rawDate = props.dayItem.date.replace(/-/g, '');
  const yymmdd = rawDate.length === 8 ? rawDate.slice(2) : rawDate;

  let sessNum = props.sessionNumber;
  if (!sessNum) {
    const spreadsheetId = localStorage.getItem('google_spreadsheet_id') || '';
    if (spreadsheetId && typeof window.gapi !== 'undefined' && window.gapi.client?.sheets) {
      try {
        const res = await window.gapi.client.sheets.spreadsheets.get({ spreadsheetId });
        const sheets: string[] = res.result.sheets.map((s: any) => s.properties.title);
        let maxN = 0;
        sheets.forEach(t => {
          const m = t.match(/^제\s*(\d+)\s*회/i);
          if (m) {
            const n = parseInt(m[1], 10);
            if (n > maxN) maxN = n;
          }
        });
        sessNum = maxN + 1;
      } catch (e) {
        console.warn('스프레드시트 회차 번호 산출 실패:', e);
      }
    }
  }
  newSessionSheetTitle.value = `제${sessNum || 1}회 ${yymmdd}`;
  includeAttendeesInNewSession.value = true;
  isCreateSessionSheetModalOpen.value = true;
};

const handleCreateSessionSheetConfirm = async () => {
  const spreadsheetId = localStorage.getItem('google_spreadsheet_id') || '';
  const title = newSessionSheetTitle.value.trim();
  if (!spreadsheetId || !title) return;

  const token = (window as any).gapi?.client?.getToken();
  if (!token || !token.access_token) {
    emit('toast', '회차 시트 생성 실패: 로그인 문제일 수 있습니다. 상단 메뉴에서 재로그인 해주세요.', 'error');
    return;
  }

  // 입력 모달은 닫고, 전체 화면 로딩 진행 모달 활성화
  isCreateSessionSheetModalOpen.value = false;
  isCreatingSessionSheet.value = true;
  sheetCreateProgress.value = 15;
  sheetCreateStatusText.value = '구글 스프레드시트 연결 확인 중...';

  try {
    const attendeeNames = (includeAttendeesInNewSession.value && props.dayItem?.attendees)
      ? props.dayItem.attendees.map(a => a.name)
      : [];

    sheetCreateProgress.value = 35;
    sheetCreateStatusText.value = `'${title}' 시트 탭 생성 중...`;
    await createSessionSheetIfNotExist(spreadsheetId, title, attendeeNames);

    if (attendeeNames.length > 0) {
      sheetCreateProgress.value = 70;
      sheetCreateStatusText.value = `오늘의 멤버 풀(${attendeeNames.length}명) 등록 중...`;
      await saveSessionMembers(spreadsheetId, title, attendeeNames);
    }

    sheetCreateProgress.value = 90;
    sheetCreateStatusText.value = '연동 회차로 설정 중...';
    currentSessionSheetName.value = title;
    localStorage.setItem('current_session_sheet_name', title);
    if (attendeeNames.length > 0) {
      localStorage.setItem('today_members', JSON.stringify(attendeeNames));
    }

    window.dispatchEvent(new CustomEvent('mahjong_session_sheet_changed', { detail: { sheetName: title } }));

    if (props.dayItem) {
      props.dayItem.sheetTitle = title;
      const m = title.match(/제\s*(\d+)\s*회/i);
      const parsedNum = m ? parseInt(m[1], 10) : undefined;
      if (parsedNum && !isNaN(parsedNum)) {
        props.dayItem.sessionNumber = parsedNum;
      }
      emit('updateSessionType', {
        dateStr: props.dayItem.date,
        sessionType: props.dayItem.sessionType,
        sessionNumber: parsedNum,
        sheetTitle: title
      });
    }

    sheetCreateProgress.value = 100;
    sheetCreateStatusText.value = '회차 생성 및 연동 완료!';
    await new Promise(resolve => setTimeout(resolve, 350));

    emit('toast', `'${title}' 회차가 생성되고 연동 회차로 설정되었습니다.`, 'success');
  } catch (err: any) {
    console.error('회차 시트 생성 실패:', err);
    if (isGoogleAuthError(err)) {
      emit('toast', '회차 시트 생성 실패: 로그인 문제일 수 있습니다. 상단 메뉴에서 재로그인 해주세요.', 'error');
    } else {
      emit('toast', `회차 시트 생성 실패: ${err?.message || err}`, 'error');
    }
  } finally {
    isCreatingSessionSheet.value = false;
    sheetCreateProgress.value = 0;
    sheetCreateStatusText.value = '';
  }
};

// 공유용 한국어 일시 포맷 (예: 9월 26일 토요일)
const getFormattedDateKorean = (dateStr: string): string => {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  const dayName = getDayOfWeek(dateStr);
  return `${m}월 ${d}일 ${dayName}요일`;
};

// 24시 HH:mm -> '오전/오후 H시 (M분)' 변환
const formatTimeKorean = (timeStr: string): string => {
  if (!timeStr) return '';
  const [hStr, mStr] = timeStr.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10) || 0;
  const ampm = h < 12 ? '오전' : '오후';
  const displayH = h === 0 ? 12 : (h > 12 ? h - 12 : h);
  const minPart = m > 0 ? ` ${m}분` : '';
  return `${ampm} ${displayH}시${minPart}`;
};

// 유동적 모임 시간 실시간 계산 (가장 이른 참가자 출발 ~ 가장 늦은 참가자 종료 기준)
const computedSessionInfo = computed(() => {
  if (!props.dayItem) return { fullText: '당일 (10:00 ~ 22:00)', typeLabel: '당일', startStr: '10:00', endStr: '22:00' };

  if (props.dayItem.attendees && props.dayItem.attendees.length > 0) {
    const timeData = computeSessionTimeFromAttendees(
      props.dayItem.attendees,
      props.dayItem.adminSessionType || props.dayItem.sessionType
    );

    const typeLabel = timeData.customIsOvernight ? '밤샘' : '당일';

    const endStr = timeData.customIsOvernight && !timeData.customEndTime.includes('익일')
      ? `${timeData.customEndTime} (익일)`
      : timeData.customEndTime;

    return {
      typeLabel,
      startStr: timeData.customStartTime,
      endStr,
      fullText: `${typeLabel} (${timeData.customStartTime} ~ ${endStr})`
    };
  }

  if (props.dayItem.sessionType === 'overnight') {
    const start = props.dayItem.customStartTime || '10:00';
    return {
      typeLabel: '밤샘',
      startStr: start,
      endStr: '익일',
      fullText: `밤샘 (${start} ~ 익일)`
    };
  } else if (props.dayItem.sessionType === 'custom') {
    const start = props.dayItem.customStartTime || '10:00';
    const end = props.dayItem.customEndTime || '22:00';
    const overnight = props.dayItem.customIsOvernight ? ' (익일)' : '';
    return {
      typeLabel: '커스텀',
      startStr: start,
      endStr: `${end}${overnight}`,
      fullText: `커스텀 (${start} ~ ${end}${overnight})`
    };
  }

  const start = props.dayItem.customStartTime || '10:00';
  const end = props.dayItem.customEndTime || '22:00';
  return {
    typeLabel: '당일',
    startStr: start,
    endStr: end,
    fullText: `당일 (${start} ~ ${end})`
  };
});

// 단톡방 공유용 회차 시간 표기 (유동 계산 연동)
const getSessionTimeLabel = (): string => {
  if (!props.dayItem) return '';
  const info = computedSessionInfo.value;
  const startKorean = formatTimeKorean(info.startStr);
  const endKorean = info.endStr.includes('익일')
    ? '익일'
    : formatTimeKorean(info.endStr.replace(' (익일)', ''));
  return `${startKorean} ~ ${endKorean} (${info.typeLabel})`;
};

// 참가인원 포맷: 이름(메모) 공백 구분
const getAttendeesShareText = (): string => {
  if (!props.dayItem?.attendees || props.dayItem.attendees.length === 0) {
    return '아직 참가 신청 없음';
  }
  return props.dayItem.attendees
    .map(att => att.memo ? `${att.name}(${att.memo})` : att.name)
    .join(' ');
};

// 단톡방 공유 텍스트 복사 핸들러
const copySessionShareText = async () => {
  if (!props.dayItem) return;

  const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
  const text = `[장소]

학동역 1번출구 김케이 하우스



[일시]

${getFormattedDateKorean(props.dayItem.date)}

${getSessionTimeLabel()}



[참가인원]

${getAttendeesShareText()}



대시보드에서 확인 및 등록: ${window.location.origin}${base}/dashboard#schedule`;

  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
    }
    emit('toast', '공유용 회차 일정이 클립보드에 복사되었습니다.', 'success');
  } catch (err) {
    emit('toast', '클립보드 복사에 실패했습니다.', 'error');
  }
};

const isUnconfirmSheetModalOpen = ref(false);
const linkedSheetToDelete = ref<string>('');
const isDeletingSheetOnUnconfirm = ref(false);

const onConfirmSessionClick = async () => {
  if (!props.dayItem) return;
  if (props.dayItem.isConfirmed) {
    let foundSheetTitle = props.dayItem.sheetTitle || '';
    const spreadsheetId = localStorage.getItem('google_spreadsheet_id') || '';

    // sheetTitle이 없더라도 현재 스프레드시트에서 날짜 패턴(YYMMDD) 회차 탭 검색
    if (!foundSheetTitle && spreadsheetId && isGoogleAdminLoggedIn.value && typeof window.gapi !== 'undefined' && window.gapi.client?.sheets) {
      try {
        const rawDate = props.dayItem.date.replace(/-/g, '');
        const yymmdd = rawDate.length === 8 ? rawDate.slice(2) : rawDate;
        const res = await window.gapi.client.sheets.spreadsheets.get({ spreadsheetId });
        const sheets: string[] = res.result.sheets.map((s: any) => s.properties.title);
        const matched = sheets.find(t => t.includes(yymmdd));
        if (matched) {
          foundSheetTitle = matched;
        }
      } catch (e) {
        console.warn('스프레드시트 탭 검색 실패:', e);
      }
    }

    if (foundSheetTitle && isGoogleAdminLoggedIn.value) {
      linkedSheetToDelete.value = foundSheetTitle;
      isUnconfirmSheetModalOpen.value = true;
      return;
    }

    if (confirm('모임 확정을 해제하시겠습니까? (다시 미확정 상태로 전환됩니다)')) {
      emit('toggleConfirm', props.dayItem.date);
    }
  } else {
    if ((props.dayItem.attendees?.length || 0) < 4) {
      emit('toast', '참석 인원이 4인 이상 모여야 확정할 수 있습니다.', 'error');
      return;
    }
    emit('toggleConfirm', props.dayItem.date);
  }
};

const handleUnconfirmAndDeleteSheet = async () => {
  if (!props.dayItem) return;
  const spreadsheetId = localStorage.getItem('google_spreadsheet_id') || '';
  const sheetTitle = linkedSheetToDelete.value;
  isDeletingSheetOnUnconfirm.value = true;
  try {
    if (spreadsheetId && sheetTitle) {
      await deleteSessionSheetByName(spreadsheetId, sheetTitle);
      emit('toast', `'${sheetTitle}' 시트 탭이 삭제되었습니다.`, 'success');
      if (localStorage.getItem('current_session_sheet_name') === sheetTitle) {
        localStorage.removeItem('current_session_sheet_name');
        currentSessionSheetName.value = '';
      }
    }
    props.dayItem.sheetTitle = undefined;
    emit('updateSessionType', {
      dateStr: props.dayItem.date,
      sessionType: props.dayItem.sessionType,
      sheetTitle: ''
    });
    emit('toggleConfirm', props.dayItem.date);
    isUnconfirmSheetModalOpen.value = false;
  } catch (err: any) {
    console.error('시트 삭제 실패:', err);
    emit('toast', `시트 삭제 중 오류가 발생했습니다: ${err?.message || err}`, 'error');
  } finally {
    isDeletingSheetOnUnconfirm.value = false;
  }
};

const handleUnconfirmKeepSheet = () => {
  if (!props.dayItem) return;
  emit('toggleConfirm', props.dayItem.date);
  isUnconfirmSheetModalOpen.value = false;
};
</script>

<template>
  <Transition name="apple-modal-fade">
    <div v-if="isOpen && dayItem" class="apple-modal-backdrop" v-backdrop-dismiss="() => emit('close')">
      <div class="apple-modal-sheet">
        <!-- 헤더 (1행 인라인 타이틀+뱃지 & 우측 액션 툴바) -->
        <div class="sheet-header">
          <div class="header-main-row">
            <div class="header-title-box">
              <h3 class="sheet-title">{{ dayItem.date }} ({{ getDayOfWeek(dayItem.date) }})</h3>
              <div class="title-badge-row">
                <span v-if="dayItem.isConfirmed && sessionNumber" class="session-badge badge-confirmed">
                  제{{ sessionNumber }}회
                </span>
                <span v-else class="session-badge badge-recruiting">
                  <span v-if="attendeeCount >= 4">
                    <span class="txt-long">확정 대기</span>
                    <span class="txt-short">대기</span>
                  </span>
                  <span v-else>모집중</span>
                </span>
                <span class="count-badge" :class="{ 'count-full': attendeeCount >= 5, 'count-min': attendeeCount === 4 }">
                  {{ attendeeCount }}명
                </span>
                <span v-if="dayItem.sessionType === 'overnight'" class="tag-overnight">밤샘</span>
                <span v-else-if="dayItem.sessionType === 'custom'" class="tag-custom">커스텀</span>
                <span v-else class="tag-day">당일</span>
              </div>
            </div>
            <div class="header-actions">
              <!-- 4인 이상 충족 시 노출되는 확정 토글 버튼 -->
              <button
                v-if="isManager && (attendeeCount >= 4 || dayItem.isConfirmed)"
                type="button"
                class="btn-confirm-session"
                :class="{
                  'is-confirmed': dayItem.isConfirmed,
                  'is-ready': !dayItem.isConfirmed && attendeeCount >= 4
                }"
                @click="onConfirmSessionClick"
                :title="dayItem.isConfirmed ? '확정 해제' : '4인 충족: 모임 확정'"
              >
                {{ dayItem.isConfirmed ? '확정됨' : '확정' }}
              </button>
              <button
                v-if="isGoogleAdminLoggedIn && dayItem.isConfirmed"
                type="button"
                class="btn-create-sheet"
                @click="openCreateSessionSheetModal"
                title="이 일정으로 구글 스프레드시트 회차 생성 및 연동"
              >
                <span class="txt-long">시트 생성</span>
                <span class="txt-short">+시트</span>
              </button>
              <button
                type="button"
                class="btn-share-session"
                @click="copySessionShareText"
                title="이 회차 일정 공유 텍스트 복사"
              >
                <span class="txt-long">공유</span>
                <span class="txt-short icon-share">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="18" cy="5" r="3"></circle>
                    <circle cx="6" cy="12" r="3"></circle>
                    <circle cx="18" cy="19" r="3"></circle>
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                  </svg>
                </span>
              </button>
              <!-- 회차 정보 초기화 휴지통 아이콘 버튼 (날짜는 가능한 일정으로 유지) -->
              <button
                v-if="isAdmin || !!dayItem.creator"
                type="button"
                class="btn-icon-delete-date"
                @click="onDeleteDateClick"
                title="이 회차 정보 및 참가자 명단 초기화 (날짜는 가능한 일정으로 유지)"
                aria-label="회차 초기화"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  <line x1="10" y1="11" x2="10" y2="17"></line>
                  <line x1="14" y1="11" x2="14" y2="17"></line>
                </svg>
              </button>
              <button class="btn-close" @click="emit('close')" aria-label="닫기">✕</button>
            </div>
          </div>
        </div>

        <!-- 서브 탭 네비게이션 (회차 상세 | 타임테이블) -->
        <div class="detail-tabs-nav">
          <button
            type="button"
            class="detail-tab-btn"
            :class="{ active: activeDetailTab === 'info' }"
            @click="activeDetailTab = 'info'"
          >
            회차 상세
          </button>
          <button
            type="button"
            class="detail-tab-btn"
            :class="{ active: activeDetailTab === 'timetable' }"
            @click="activeDetailTab = 'timetable'"
          >
            타임테이블
          </button>
        </div>

        <div class="sheet-body">
          <!-- 탭 1: 회차 상세 (모임 시간 카드 + 참가자 목록) -->
          <div v-show="activeDetailTab === 'info'" class="tab-pane-info">
            <!-- 모임 시간 및 개설자 안내 (컴팩트 슬림 2행 카드) -->
            <div class="info-card info-card-compact">
              <!-- 1행: 메타 정보 (개설자 & 대국 가능 시간) -->
              <div v-if="dayItem.creator || overlapTimeRange" class="info-compact-meta-row">
                <div v-if="dayItem.creator" class="info-meta-item">
                  <span class="info-label">개설자</span>
                  <span class="info-value creator-name">{{ dayItem.creator }}</span>
                </div>
                <div v-if="overlapTimeRange" class="info-meta-item highlight-item">
                  <span class="info-label">대국 가능</span>
                  <span class="info-value highlight-text">{{ overlapTimeRange }}</span>
                </div>
              </div>

              <!-- 2행: 모임 시간 및 세션 전환 버튼군 -->
              <div class="info-compact-session-row">
                <div class="session-label-group">
                  <span class="info-label">모임 시간</span>
                  <span class="info-value session-time-text">{{ computedSessionInfo.fullText }}</span>
                </div>

                <!-- 관리자/개설자용 모임 시간 변경 버튼군 (이모지 없음) -->
                <div v-if="isManager" class="session-chips-inline">
                  <button
                    type="button"
                    class="btn-session-chip-slim"
                    :class="{ active: dayItem.sessionType === 'day' && !isEditingCustomSession }"
                    @click="changeSession('day')"
                    title="당일 세션 (10:00~22:00)"
                  >
                    당일
                  </button>
                  <button
                    type="button"
                    class="btn-session-chip-slim"
                    :class="{
                      active: dayItem.sessionType === 'overnight' && !isEditingCustomSession,
                      disabled: isDayOnly
                    }"
                    :disabled="isDayOnly"
                    @click="changeSession('overnight')"
                    :title="isDayOnly ? '당일로 개설된 회차는 밤샘으로 변경할 수 없습니다.' : '밤샘 세션 (10:00~익일)'"
                  >
                    밤샘
                  </button>
                  <button
                    type="button"
                    class="btn-session-chip-slim"
                    :class="{ active: dayItem.sessionType === 'custom' || isEditingCustomSession }"
                    @click="isEditingCustomSession = !isEditingCustomSession"
                    title="커스텀 시간 직접 지정"
                  >
                    커스텀
                  </button>
                </div>
              </div>

              <!-- 커스텀 시간 인라인 입력 박스 (오전/오후 원클릭 토글 지원) -->
              <div v-if="isEditingCustomSession" class="custom-edit-box">
                <div class="custom-time-inputs">
                  <div class="mini-time-unit">
                    <button
                      type="button"
                      class="btn-ampm-mini"
                      :class="{ 'is-pm': isPm(customStartInput) }"
                      @click="customStartInput = toggleAmPm(customStartInput)"
                    >
                      {{ isPm(customStartInput) ? '오후' : '오전' }}
                    </button>
                    <input type="time" v-model="customStartInput" class="time-input-mini" />
                  </div>
                  <span class="dash">~</span>
                  <div class="mini-time-unit">
                    <button
                      type="button"
                      class="btn-ampm-mini"
                      :class="{ 'is-pm': isPm(customEndInput) }"
                      @click="customEndInput = toggleAmPm(customEndInput)"
                    >
                      {{ isPm(customEndInput) ? '오후' : '오전' }}
                    </button>
                    <input type="time" v-model="customEndInput" class="time-input-mini" />
                  </div>
                  <label class="check-overnight-mini" :class="{ 'disabled-label': isDayOnly }">
                    <input type="checkbox" v-model="customOvernightInput" :disabled="isDayOnly" />
                    <span>익일</span>
                    <span v-if="isDayOnly" class="day-only-hint">(불가)</span>
                  </label>
                </div>
                <button type="button" class="btn-save-custom" @click="saveCustomSession">적용</button>
              </div>
            </div>

            <!-- 참가자 목록 (무제한) -->
            <div class="attendees-section">
              <div class="section-header">
                <span class="section-title">참가자 목록 ({{ attendeeCount }}명)</span>
                <div class="section-header-actions">
                  <button
                    v-if="isManager && attendeeCount > 0"
                    type="button"
                    class="btn-clear-attendees"
                    @click="onClearAttendeesClick"
                    title="참가자 명단 비우기 및 회차 리셋"
                  >
                    전체 비우기
                  </button>
                  <button
                    type="button"
                    class="btn-add-attendee"
                    @click="emit('openAttend')"
                  >
                    + 참석자 추가
                  </button>
                </div>
              </div>

              <div v-if="attendeeCount === 0" class="empty-attendees">
                아직 신청한 참가자가 없습니다. 첫 번째로 신청해보세요!
              </div>

              <div v-else class="attendees-list">
                <div 
                  v-for="att in dayItem.attendees" 
                  :key="att.id"
                  class="attendee-card clickable-attendee"
                  :class="{ 'is-me': att.name === myAttendeeName }"
                  @click="emit('openAttend', att.name)"
                  title="클릭하여 참석 시간/정보 수정"
                >
                  <div class="attendee-main">
                    <span class="attendee-name">
                      {{ att.name }}
                      <span v-if="att.name === myAttendeeName" class="me-chip">나</span>
                    </span>
                    <div class="attendee-right">
                      <span class="attendee-time">
                        <template v-if="att.isCustomTime">
                          {{ att.startTime }} ~ {{ att.endTime }}
                        </template>
                        <template v-else-if="att.isOvernight">
                          10:00 ~ 익일 (밤샘)
                        </template>
                        <template v-else>
                          10:00 ~ 22:00
                        </template>
                      </span>
                      <div class="card-action-btns">
                        <button
                          type="button"
                          class="btn-card-action edit-btn"
                          @click.stop="emit('openAttend', att.name)"
                          title="수정"
                        >
                          수정
                        </button>
                        <button
                          v-if="isManager || att.name === myAttendeeName"
                          type="button"
                          class="btn-card-action delete-btn"
                          @click.stop="onRemoveAttendeeClick($event, att.name)"
                          title="제외/취소"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  </div>
                  <div v-if="att.memo" class="attendee-memo">
                    {{ att.memo }}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 탭 2: 타임테이블 인터랙티브 뷰 -->
          <div v-show="activeDetailTab === 'timetable'" class="tab-pane-timetable">
            <div v-if="attendeeCount > 0" class="timetable-section">
              <div class="timetable-header">
                <div class="timetable-title-group">
                  <span class="timetable-title">회차 타임테이블</span>
                </div>
                <!-- 가로 / 세로 토글 스위치 -->
                <div class="orientation-toggle-group">
                  <button
                    type="button"
                    class="btn-orientation"
                    :class="{ active: timetableOrientation === 'horizontal' }"
                    @click="timetableOrientation = 'horizontal'"
                    title="가로 타임라인 보기"
                  >
                    가로형
                  </button>
                  <button
                    type="button"
                    class="btn-orientation"
                    :class="{ active: timetableOrientation === 'vertical' }"
                    @click="timetableOrientation = 'vertical'"
                    title="세로 시간표 보기"
                  >
                    세로형
                  </button>
                </div>
              </div>

              <!-- 1) 가로 타임라인 뷰 (Gantt) -->
              <div v-if="timetableOrientation === 'horizontal'" class="horizontal-timetable-card">
                <!-- 상단 동기화 스크롤바 -->
                <div
                  v-show="isHorizontalScrollable"
                  ref="horizontalTopScrollRef"
                  class="top-scrollbar-container"
                  @scroll="onHorizontalTopScroll"
                >
                  <div class="top-scrollbar-dummy" :style="{ width: `${horizontalScrollWidth}px` }"></div>
                </div>

                <div
                  ref="horizontalMainScrollRef"
                  class="horizontal-timetable-scroll"
                  @scroll="onHorizontalMainScroll"
                  @wheel="onHorizontalWheel"
                  @mousedown="onMiddleMouseDown"
                >
                  <div class="horizontal-grid-inner">
                    <!-- 상단 시간 눈금 헤더 -->
                    <div class="time-axis-header">
                      <div class="axis-spacer"></div>
                      <div class="axis-ticks">
                        <span
                          v-for="(tick, idx) in timeTicks"
                          :key="tick.min"
                          class="axis-tick-label"
                          :class="{
                            'is-first-tick': idx === 0,
                            'is-last-tick': idx === timeTicks.length - 1
                          }"
                          :style="{ left: `${((tick.min - timetableWindow.startMin) / timetableWindow.totalMin) * 100}%` }"
                        >
                          <span class="txt-long">{{ tick.label }}</span>
                          <span class="txt-short">{{ tick.shortLabel }}</span>
                        </span>
                      </div>
                    </div>

                    <!-- 참가자 행들 -->
                    <div class="horizontal-rows-wrapper">
                      <!-- 4인 이상 겹침 골든타임 배경 하이라이트 (트랙 영역과 1:1 일치) -->
                      <div class="horizontal-tracks-backdrop">
                        <!-- 수직 시간 눈금 가이드 라인 (시간축과 1:1 정렬) -->
                        <div
                          v-for="tick in timeTicks"
                          :key="`line-${tick.min}`"
                          class="horizontal-grid-line"
                          :style="{ left: `${((tick.min - timetableWindow.startMin) / timetableWindow.totalMin) * 100}%` }"
                        ></div>

                        <div
                          v-if="overlapHighlightRegion"
                          class="horizontal-golden-range"
                          :style="{ left: overlapHighlightRegion.left, width: overlapHighlightRegion.width }"
                          title="4인 이상 대국 가능 시간대"
                        ></div>
                      </div>

                      <div
                        v-for="att in dayItem.attendees"
                        :key="att.id"
                        class="horizontal-row"
                        :class="{ 'is-me': att.name === myAttendeeName }"
                      >
                        <div class="row-user-label" :title="att.name">
                          <span class="user-name">{{ att.name }}</span>
                          <span v-if="att.name === myAttendeeName" class="badge-me-dot">나</span>
                        </div>
                        <div class="row-track">
                          <!-- 시간 바 (직사각형 막대) -->
                          <div
                            class="time-bar"
                            :class="{
                              'is-me-bar': att.name === myAttendeeName,
                              'is-overnight-bar': att.isOvernight
                            }"
                            :style="{ left: getAttendeeBar(att).left, width: getAttendeeBar(att).width }"
                            :title="`${att.name}: ${getAttendeeBar(att).timeLabel}${att.memo ? ' (' + att.memo + ')' : ''}`"
                          >
                            <span class="bar-label">{{ getAttendeeBar(att).timeLabel }}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 2) 세로 시간표 뷰 (Vertical Timetable) -->
              <div v-else class="vertical-timetable-card">
                <!-- 상단 동기화 스크롤바 -->
                <div
                  v-show="isVerticalScrollable"
                  ref="verticalTopScrollRef"
                  class="top-scrollbar-container"
                  @scroll="onVerticalTopScroll"
                >
                  <div class="top-scrollbar-dummy" :style="{ width: `${verticalScrollWidth}px` }"></div>
                </div>

                <div
                  ref="verticalMainScrollRef"
                  class="vertical-timetable-scroll"
                  @scroll="onVerticalMainScroll"
                  @wheel="onHorizontalWheel"
                  @mousedown="onMiddleMouseDown"
                >
                  <div class="vertical-grid-inner">
                    <!-- 상단 고정 헤더 행 (좌측 시간 라벨 + 우측 참가자 이름들) -->
                    <div class="vertical-header-row">
                      <div class="vertical-axis-header">
                        <span class="axis-title-text">시간</span>
                      </div>
                      <div class="vertical-col-headers">
                        <div
                          v-for="att in dayItem.attendees"
                          :key="att.id"
                          class="col-header"
                          :class="{ 'is-me': att.name === myAttendeeName }"
                          :title="att.name"
                        >
                          <span class="col-name">{{ att.name }}</span>
                          <span v-if="att.name === myAttendeeName" class="col-me-badge">나</span>
                        </div>
                      </div>
                    </div>

                    <!-- 하단 시간표 바디 (좌측 시간 눈금축 + 우측 트랙들) -->
                    <div class="vertical-body-row">
                      <!-- 좌측 세로 시간축 -->
                      <div class="vertical-time-axis">
                        <div
                          v-for="tick in verticalTimeTicks"
                          :key="tick.min"
                          class="vertical-axis-tick"
                          :style="{ top: `${((tick.min - timetableWindow.startMin) / timetableWindow.totalMin) * 100}%` }"
                        >
                          <span class="tick-text">
                            <span class="txt-long">{{ tick.label }}</span>
                            <span class="txt-short">{{ tick.shortLabel }}</span>
                          </span>
                          <div class="tick-line"></div>
                        </div>
                      </div>

                      <!-- 우측 참가자 열 트랙들 (Columns) -->
                      <div class="vertical-tracks-container">
                        <!-- 4인 이상 골든타임 수평 하이라이트 -->
                        <div
                          v-if="overlapHighlightRegion"
                          class="vertical-golden-range"
                          :style="{ top: overlapHighlightRegion.top, height: overlapHighlightRegion.height }"
                          title="4인 이상 대국 가능 시간대"
                        ></div>

                        <div
                          v-for="att in dayItem.attendees"
                          :key="att.id"
                          class="vertical-track-col"
                          :class="{ 'is-me': att.name === myAttendeeName }"
                        >
                          <!-- 세로 트랙 및 직사각형 블록 -->
                          <div class="col-track">
                            <div
                              class="vertical-time-block"
                              :class="{
                                'is-me-block': att.name === myAttendeeName,
                                'is-overnight-block': att.isOvernight
                              }"
                              :style="{ top: getAttendeeBar(att).top, height: getAttendeeBar(att).height }"
                              :title="`${att.name}: ${getAttendeeBar(att).timeLabel}${att.memo ? ' (' + att.memo + ')' : ''}`"
                            >
                              <span class="block-time">
                                <span class="time-part-start">{{ att.startTime || '10:00' }}</span>
                                <span class="time-part-end">~ {{ att.isOvernight ? '익일' : (att.endTime || '22:00') }}</span>
                              </span>
                              <span v-if="att.memo" class="block-memo">{{ att.memo }}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 참가자가 아직 없는 경우의 타임테이블 Empty State -->
            <div v-else class="empty-timetable-card">
              <p class="empty-timetable-text">아직 참가 신청한 인원이 없어 타임테이블이 생성되지 않았습니다.</p>
              <button type="button" class="btn-empty-attend" @click="emit('openAttend')">
                첫 번째로 참석 신청하기
              </button>
            </div>
          </div>
        </div>

        <!-- 푸터 -->
        <div class="sheet-footer">
          <button type="button" class="btn-primary" @click="emit('openAttend', isUserAttending ? myAttendeeName : undefined)">
            {{ isUserAttending ? '내 참석 정보 수정' : '참석 신청하기' }}
          </button>
        </div>
      </div>
    </div>
  </Transition>

  <!-- 참석 취소 PIN 입력 모달 (내부 모달화) -->
  <Transition name="apple-modal-fade">
    <div v-if="isRemovePinModalOpen" class="pin-modal-backdrop" v-backdrop-dismiss="() => isRemovePinModalOpen = false">
      <div class="pin-modal-sheet">
        <div class="pin-modal-header">
          <h4 class="pin-modal-title">참석 취소</h4>
          <button type="button" class="btn-close" @click="isRemovePinModalOpen = false">✕</button>
        </div>
        <div class="pin-modal-body">
          <p class="pin-modal-desc">
            <strong>'{{ removeTargetName }}'</strong> 님의 참석을 취소하시겠습니까?<br>등록 시 설정한 PIN(4~8자리)을 입력해 주세요.
          </p>
          <div v-if="removePinErrorMessage" class="pin-error-banner">
            {{ removePinErrorMessage }}
          </div>
          <div class="pin-input-wrap">
            <input
              type="password"
              maxlength="8"
              inputmode="numeric"
              pattern="[0-9]*"
              class="apple-input pin-input"
              v-model="removePinInput"
              placeholder="••••"
              @keyup.enter="confirmRemoveWithPin"
              autofocus
            />
          </div>
        </div>
        <div class="pin-modal-footer">
          <button type="button" class="btn-modal-cancel" @click="isRemovePinModalOpen = false">취소</button>
          <button type="button" class="btn-modal-confirm btn-danger" @click="confirmRemoveWithPin">참석 취소</button>
        </div>
      </div>
    </div>
  </Transition>

  <!-- 관리자 참석자 제외 확인 모달 (PIN 불필요) -->
  <Transition name="apple-modal-fade">
    <div v-if="isAdminRemoveModalOpen" class="pin-modal-backdrop" v-backdrop-dismiss="() => isAdminRemoveModalOpen = false">
      <div class="pin-modal-sheet">
        <div class="pin-modal-header">
          <h4 class="pin-modal-title">참석자 제외</h4>
          <button type="button" class="btn-close" @click="isAdminRemoveModalOpen = false">✕</button>
        </div>
        <div class="pin-modal-body">
          <p class="pin-modal-desc">
            <strong>'{{ removeTargetName }}'</strong> 님을 이 날짜 참석자 명단에서 제외하시겠습니까?
          </p>
        </div>
        <div class="pin-modal-footer">
          <button type="button" class="btn-modal-cancel" @click="isAdminRemoveModalOpen = false">취소</button>
          <button type="button" class="btn-modal-confirm btn-danger" @click="confirmAdminRemove">제외</button>
        </div>
      </div>
    </div>
  </Transition>



  <!-- 구글 시트 회차 생성 및 연동 모달 -->
  <Transition name="apple-modal-fade">
    <div v-if="isCreateSessionSheetModalOpen && dayItem" class="pin-modal-backdrop" v-backdrop-dismiss="() => isCreateSessionSheetModalOpen = false">
      <div class="pin-modal-sheet">
        <div class="pin-modal-header">
          <h4 class="pin-modal-title">구글 시트 회차 생성</h4>
          <button type="button" class="btn-close" @click="isCreateSessionSheetModalOpen = false">✕</button>
        </div>
        <div class="pin-modal-body">
          <p class="pin-modal-desc">
            <strong>{{ dayItem.date }}</strong> 일정을 위한 구글 시트 회차를 생성하고 현재 연동 회차로 즉시 설정합니다.
          </p>
          <div class="sheet-create-form" style="display: flex; flex-direction: column; gap: 10px; margin-top: 12px;">
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <label style="font-size: 12px; font-weight: 600; color: var(--text-dimmed, #64748b);">생성할 회차명</label>
              <input
                type="text"
                class="apple-input"
                v-model="newSessionSheetTitle"
                placeholder="예: 제16회 260423"
                style="height: 38px; font-weight: 700;"
              />
            </div>
            <label v-if="(dayItem.attendees?.length || 0) > 0" style="display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer;">
              <input type="checkbox" v-model="includeAttendeesInNewSession" />
              <span>현재 참석자({{ dayItem.attendees.length }}명)를 오늘 멤버 풀로 자동 등록</span>
            </label>
          </div>
        </div>
        <div class="pin-modal-footer">
          <button type="button" class="btn-modal-cancel" @click="isCreateSessionSheetModalOpen = false">취소</button>
          <button
            type="button"
            class="btn-modal-confirm"
            :disabled="!newSessionSheetTitle.trim() || isCreatingSessionSheet"
            @click="handleCreateSessionSheetConfirm"
          >
            {{ isCreatingSessionSheet ? '생성 중...' : '생성 및 연동' }}
          </button>
        </div>
      </div>
    </div>
  </Transition>

  <!-- 구글 시트 회차 생성 진행률 모달 (동기화 중 로딩 바 스타일) -->
  <Transition name="apple-modal-fade">
    <div v-if="isCreatingSessionSheet" class="sync-loader-overlay">
      <div class="sync-loader-card">
        <div class="sync-loader-title">구글 스프레드시트 회차 생성 중...</div>
        <div class="sync-progress-container">
          <div class="sync-progress-bar" :style="{ width: sheetCreateProgress + '%' }"></div>
        </div>
        <div class="sync-progress-text">
          <span class="step-text">{{ sheetCreateStatusText }}</span>
          <span class="percent-text"> ({{ sheetCreateProgress }}%)</span>
        </div>
      </div>
    </div>
  </Transition>

  <!-- 회차 취소 4자리 PIN 입력 모달 (날짜는 가능한 일정으로 유지) -->
  <Transition name="apple-modal-fade">
    <div v-if="isDeleteDatePinModalOpen && dayItem" class="pin-modal-backdrop" v-backdrop-dismiss="() => isDeleteDatePinModalOpen = false">
      <div class="pin-modal-sheet">
        <div class="pin-modal-header">
          <h4 class="pin-modal-title">회차 취소 PIN 확인</h4>
          <button type="button" class="btn-close" @click="isDeleteDatePinModalOpen = false">✕</button>
        </div>
        <div class="pin-modal-body">
          <p class="pin-modal-desc">
            <strong>{{ dayItem.date }}</strong> 회차를 취소하고 참가자 명단을 초기화하려면 개설자<strong v-if="dayItem.creator"> '{{ dayItem.creator }}'</strong> 님이 설정한 4자리 확인 PIN을 입력해주세요. (날짜는 가능한 일정으로 유지됩니다)
          </p>
          <p v-if="(dayItem.attendees?.length || 0) > 0" class="pin-modal-subdesc">
            ※ 등록된 참가자 {{ dayItem.attendees.length }}명의 신청 내역도 함께 초기화됩니다.
          </p>
          <div v-if="deleteDatePinErrorMessage" class="pin-error-banner">
            {{ deleteDatePinErrorMessage }}
          </div>
          <div class="pin-input-wrap">
            <input
              type="password"
              maxlength="8"
              inputmode="numeric"
              pattern="[0-9]*"
              class="apple-input pin-input"
              v-model="deleteDatePinInput"
              placeholder="••••"
              @keyup.enter="confirmDeleteDateWithPin"
              autofocus
            />
          </div>
        </div>
        <div class="pin-modal-footer">
          <button type="button" class="btn-modal-cancel" @click="isDeleteDatePinModalOpen = false">취소</button>
          <button type="button" class="btn-modal-confirm btn-danger" @click="confirmDeleteDateWithPin">회차 취소 확인</button>
        </div>
      </div>
    </div>
  </Transition>

  <!-- 확정 해제 시 연동 시트 삭제 여부 확인 모달 -->
  <Transition name="apple-modal-fade">
    <div v-if="isUnconfirmSheetModalOpen && dayItem" class="pin-modal-backdrop" v-backdrop-dismiss="() => !isDeletingSheetOnUnconfirm && (isUnconfirmSheetModalOpen = false)">
      <div class="pin-modal-sheet">
        <div class="pin-modal-header">
          <h4 class="pin-modal-title">확정 해제 및 연동 시트 관리</h4>
          <button type="button" class="btn-close" :disabled="isDeletingSheetOnUnconfirm" @click="isUnconfirmSheetModalOpen = false">✕</button>
        </div>
        <div class="pin-modal-body">
          <p class="pin-modal-desc">
            <strong>{{ dayItem.date }}</strong> 일정의 모임 확정을 해제합니다.<br>
            현재 이 일정과 연동된 구글 시트 탭 <strong>'{{ linkedSheetToDelete }}'</strong>이(가) 존재합니다.
          </p>
          <p class="pin-modal-subdesc" style="color: #ef4444; font-size: 13px; margin-top: 8px;">
            ※ 확정을 취소할 때 해당 구글 스프레드시트 탭을 함께 삭제하시겠습니까?
          </p>
        </div>
        <div class="pin-modal-footer" style="display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap;">
          <button type="button" class="btn-modal-cancel" :disabled="isDeletingSheetOnUnconfirm" @click="isUnconfirmSheetModalOpen = false">
            취소
          </button>
          <button type="button" class="btn-modal-confirm" :disabled="isDeletingSheetOnUnconfirm" @click="handleUnconfirmKeepSheet">
            시트 유지하고 확정만 해제
          </button>
          <button type="button" class="btn-modal-confirm btn-danger" :disabled="isDeletingSheetOnUnconfirm" @click="handleUnconfirmAndDeleteSheet">
            {{ isDeletingSheetOnUnconfirm ? '시트 삭제 중...' : '🗑️ 시트 삭제하고 확정 해제' }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
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
  max-width: 480px;
  max-height: min(85vh, calc(100dvh - 32px));
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: sheetPop 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  font-family: inherit;
}

.apple-modal-sheet button,
.apple-modal-sheet input,
.apple-modal-sheet select {
  font-family: inherit;
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

.sheet-header {
  padding: 12px 18px 10px;
  display: flex;
  flex-direction: column;
  gap: 0;
  border-bottom: 1px solid var(--border-color, rgba(0, 0, 0, 0.06));
  flex-shrink: 0;
}

.header-main-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: nowrap;
}

.header-title-box {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.title-badge-row {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: nowrap;
  white-space: nowrap;
}

.sheet-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.02em;
  white-space: nowrap;
  flex-shrink: 0;
}

/* 서브 탭 네비게이션 */
.detail-tabs-nav {
  display: flex;
  background: var(--input-bg-color, #f1f5f9);
  border-radius: 12px;
  padding: 3px;
  margin: 10px 20px 0;
  gap: 4px;
  border: 1px solid var(--border-color, rgba(0, 0, 0, 0.06));
  flex-shrink: 0;
}
html.dark .detail-tabs-nav {
  background: rgba(30, 41, 59, 0.7);
  border-color: rgba(255, 255, 255, 0.08);
}

.detail-tab-btn {
  flex: 1;
  border: none;
  background: transparent;
  padding: 8px 12px;
  border-radius: 9px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-dimmed, #64748b);
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-family: inherit;
}
.detail-tab-btn.active {
  background: var(--card-bg-color, #ffffff);
  color: var(--text-color, #0f172a);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
  font-weight: 700;
}
html.dark .detail-tab-btn {
  color: #94a3b8;
}
html.dark .detail-tab-btn.active {
  background: #334155;
  color: #f8fafc;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
}

.tab-pill-success {
  font-size: 10px;
  font-weight: 700;
  color: #16a34a;
  background: rgba(22, 163, 74, 0.12);
  padding: 1px 5px;
  border-radius: 4px;
}
html.dark .tab-pill-success {
  color: #4ade80;
  background: rgba(74, 222, 128, 0.18);
}

.tab-pane-info,
.tab-pane-timetable {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 타임테이블 빈 상태 (Empty State) */
.empty-timetable-card {
  padding: 32px 16px;
  text-align: center;
  background: var(--bg-hover-color, #f8fafc);
  border: 1px dashed var(--border-color, rgba(0, 0, 0, 0.1));
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
html.dark .empty-timetable-card {
  background: rgba(30, 41, 59, 0.4);
  border-color: rgba(255, 255, 255, 0.1);
}

.empty-timetable-text {
  margin: 0;
  font-size: 13px;
  color: var(--text-dimmed, #64748b);
  line-height: 1.5;
}
html.dark .empty-timetable-text {
  color: #94a3b8;
}

.btn-empty-attend {
  background: #2563eb;
  color: #ffffff;
  border: none;
  padding: 8px 16px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s ease;
  font-family: inherit;
}
.btn-empty-attend:hover {
  opacity: 0.9;
}

/* 타임테이블 섹션 스타일 */
.timetable-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--bg-hover-color, #f8fafc);
  border: 1px solid var(--border-color, rgba(0, 0, 0, 0.08));
  border-radius: 14px;
  padding: 12px 14px;
}
html.dark .timetable-section {
  background: #1e293b;
  border-color: rgba(255, 255, 255, 0.08);
}

.timetable-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.timetable-title-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.timetable-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-color, #0f172a);
}
html.dark .timetable-title {
  color: #f8fafc;
}

.timetable-sub-badge {
  font-size: 10px;
  font-weight: 700;
  color: #16a34a;
  background: rgba(22, 163, 74, 0.12);
  padding: 1px 6px;
  border-radius: 6px;
}
html.dark .timetable-sub-badge {
  color: #4ade80;
  background: rgba(74, 222, 128, 0.18);
}

.orientation-toggle-group {
  display: inline-flex;
  background: rgba(0, 0, 0, 0.06);
  padding: 2px;
  border-radius: 8px;
  gap: 2px;
}
html.dark .orientation-toggle-group {
  background: rgba(255, 255, 255, 0.08);
}

.btn-orientation {
  border: none;
  background: transparent;
  color: var(--text-dimmed, #64748b);
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-orientation.active {
  background: var(--card-bg-color, #ffffff);
  color: #2563eb;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}
html.dark .btn-orientation.active {
  background: #334155;
  color: #60a5fa;
}

/* 1) 가로 타임라인 (Gantt) */
.horizontal-timetable-card {
  display: flex;
  flex-direction: column;
  background: var(--card-bg-color, #ffffff);
  border: 1px solid var(--border-color, rgba(0, 0, 0, 0.06));
  border-radius: 10px;
  overflow: hidden;
  padding: 8px 10px 10px;
}
html.dark .horizontal-timetable-card {
  background: #1e293b;
  border-color: rgba(255, 255, 255, 0.08);
}

/* 상단 동기화 스크롤바 */
.top-scrollbar-container {
  overflow-x: auto;
  overflow-y: hidden;
  height: 8px;
  margin: 2px 4px 6px;
  scrollbar-width: thin;
  scrollbar-color: #60a5fa rgba(0, 0, 0, 0.05);
  -webkit-overflow-scrolling: touch;
}

.top-scrollbar-container::-webkit-scrollbar {
  height: 8px;
}

.top-scrollbar-container::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.05);
  border-radius: 9999px;
}

.top-scrollbar-container::-webkit-scrollbar-thumb {
  background: #60a5fa;
  border-radius: 9999px;
  cursor: grab;
}

.top-scrollbar-container::-webkit-scrollbar-thumb:hover {
  background: #2563eb;
}

html.dark .top-scrollbar-container {
  scrollbar-color: #3b82f6 rgba(255, 255, 255, 0.06);
}

html.dark .top-scrollbar-container::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.06);
}

html.dark .top-scrollbar-container::-webkit-scrollbar-thumb {
  background: #3b82f6;
}

.top-scrollbar-dummy {
  height: 1px;
}

.horizontal-timetable-scroll {
  display: flex;
  flex-direction: column;
  position: relative;
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 4px;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
  scrollbar-color: #60a5fa rgba(0, 0, 0, 0.05);
}

.horizontal-timetable-scroll::-webkit-scrollbar {
  height: 8px;
}

.horizontal-timetable-scroll::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.05);
  border-radius: 9999px;
  margin: 0 8px;
}

.horizontal-timetable-scroll::-webkit-scrollbar-thumb {
  background: #60a5fa;
  border-radius: 9999px;
  cursor: grab;
}

.horizontal-timetable-scroll::-webkit-scrollbar-thumb:hover {
  background: #2563eb;
}

html.dark .horizontal-timetable-scroll {
  scrollbar-color: #3b82f6 rgba(255, 255, 255, 0.06);
}

html.dark .horizontal-timetable-scroll::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.06);
}

html.dark .horizontal-timetable-scroll::-webkit-scrollbar-thumb {
  background: #3b82f6;
}

.horizontal-grid-inner {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: max-content;
  min-width: 100%;
  box-sizing: border-box;
}

.time-axis-header {
  display: flex;
  align-items: center;
  position: relative;
  height: 20px;
}

.axis-spacer {
  width: 88px;
  flex-shrink: 0;
  box-sizing: border-box;
  position: sticky;
  left: 0;
  background: var(--bg-card, #ffffff);
  z-index: 4;
}
html.dark .axis-spacer {
  background: var(--bg-card, #1e293b);
}

.axis-ticks {
  position: relative;
  flex: 1;
  height: 100%;
}

.axis-tick-label {
  position: absolute;
  transform: translateX(-50%);
  font-size: 10px;
  font-weight: 500;
  color: var(--text-dimmed, #94a3b8);
  white-space: nowrap;
}

.axis-tick-label.is-first-tick {
  transform: translateX(0);
}

.axis-tick-label.is-last-tick {
  transform: translateX(-100%);
}

.horizontal-rows-wrapper {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.horizontal-tracks-backdrop {
  position: absolute;
  left: 88px;
  right: 0;
  top: 0;
  bottom: 0;
  pointer-events: none;
  z-index: 1;
}

.horizontal-grid-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: rgba(0, 0, 0, 0.05);
}
html.dark .horizontal-grid-line {
  background: rgba(255, 255, 255, 0.06);
}

.horizontal-golden-range {
  position: absolute;
  top: 0;
  bottom: 0;
  background: rgba(234, 179, 8, 0.15);
  border-left: 1px dashed rgba(202, 138, 4, 0.4);
  border-right: 1px dashed rgba(202, 138, 4, 0.4);
  pointer-events: none;
  border-radius: 4px;
}

.horizontal-row {
  display: flex;
  align-items: center;
  position: relative;
  height: 26px;
  z-index: 2;
}

.row-user-label {
  position: sticky;
  left: 0;
  width: 88px;
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-color, #334155);
  display: flex;
  align-items: center;
  gap: 4px;
  padding-right: 8px;
  box-sizing: border-box;
  overflow: hidden;
  background: var(--bg-card, #ffffff);
  z-index: 3;
}
html.dark .row-user-label {
  color: #cbd5e1;
  background: var(--bg-card, #1e293b);
}

.user-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.horizontal-row.is-me .row-user-label {
  color: #2563eb;
  font-weight: 700;
}
html.dark .horizontal-row.is-me .row-user-label {
  color: #60a5fa;
}

.badge-me-dot {
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 4px;
  background: #2563eb;
  color: #ffffff;
  line-height: 1.2;
  font-weight: 700;
  flex-shrink: 0;
}

.row-track {
  position: relative;
  flex: 1;
  height: 100%;
  background: rgba(0, 0, 0, 0.03);
  border-radius: 6px;
  box-sizing: border-box;
  overflow: hidden;
}
html.dark .row-track {
  background: rgba(255, 255, 255, 0.05);
}

.time-bar {
  position: absolute;
  top: 2px;
  bottom: 2px;
  background: rgba(59, 130, 246, 0.2);
  border: 1px solid #3b82f6;
  color: #1e40af;
  border-radius: 6px;
  display: flex;
  align-items: center;
  padding: 0 6px;
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  transition: all 0.15s ease;
  box-sizing: border-box;
}
html.dark .time-bar {
  color: #93c5fd;
}

.time-bar.is-me-bar {
  background: rgba(37, 99, 235, 0.3);
  border-color: #2563eb;
  border-width: 2px;
  font-weight: 700;
  color: #1d4ed8;
  box-shadow: 0 2px 5px rgba(59, 130, 246, 0.15);
}
html.dark .time-bar.is-me-bar {
  color: #bfdbfe;
}

.time-bar.is-overnight-bar {
  background: rgba(168, 85, 247, 0.25);
  border-color: #a855f7;
  color: #7e22ce;
}
html.dark .time-bar.is-overnight-bar {
  color: #d8b4fe;
}

.time-bar.is-me-bar.is-overnight-bar {
  border-color: #9333ea;
  border-width: 2px;
  background: rgba(168, 85, 247, 0.35);
  color: #6b21a8;
}
html.dark .time-bar.is-me-bar.is-overnight-bar {
  color: #e9d5ff;
}

/* 2) 세로 시간표 (Vertical Timetable) */
.vertical-timetable-card {
  position: relative;
  background: var(--card-bg-color, #ffffff);
  border: 1px solid var(--border-color, rgba(0, 0, 0, 0.06));
  border-radius: 10px;
  overflow: hidden;
}
html.dark .vertical-timetable-card {
  background: #1e293b;
  border-color: rgba(255, 255, 255, 0.08);
}

.vertical-timetable-scroll {
  display: flex;
  flex-direction: column;
  position: relative;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 8px 10px 14px;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
  scrollbar-color: #60a5fa rgba(0, 0, 0, 0.05);
}

.vertical-timetable-scroll::-webkit-scrollbar {
  height: 8px;
}

.vertical-timetable-scroll::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.05);
  border-radius: 9999px;
  margin: 0 8px;
}

.vertical-timetable-scroll::-webkit-scrollbar-thumb {
  background: #60a5fa;
  border-radius: 9999px;
  cursor: grab;
}

.vertical-timetable-scroll::-webkit-scrollbar-thumb:hover {
  background: #2563eb;
}

html.dark .vertical-timetable-scroll {
  scrollbar-color: #3b82f6 rgba(255, 255, 255, 0.06);
}

html.dark .vertical-timetable-scroll::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.06);
}

html.dark .vertical-timetable-scroll::-webkit-scrollbar-thumb {
  background: #3b82f6;
}



.vertical-grid-inner {
  display: flex;
  flex-direction: column;
  width: max-content;
  min-width: 100%;
  padding-right: 16px;
  box-sizing: border-box;
}

/* 상단 고정 헤더 행 */
.vertical-header-row {
  display: flex;
  align-items: center;
  height: 26px;
  border-bottom: 1px solid var(--border-color, rgba(0, 0, 0, 0.08));
  padding-bottom: 4px;
  width: 100%;
}

.vertical-axis-header {
  width: 52px;
  box-sizing: border-box;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: 6px;
  border-right: 1px solid transparent;
}

.axis-title-text {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-dimmed, #94a3b8);
}

.vertical-col-headers {
  display: flex;
  box-sizing: border-box;
  gap: 8px;
  padding-left: 8px;
  padding-right: 8px;
  flex: 1;
}

.col-header {
  width: 60px;
  flex-shrink: 0;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-color, #334155);
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.02);
  padding: 0 2px;
  box-sizing: border-box;
}
html.dark .col-header {
  color: #cbd5e1;
  background: rgba(255, 255, 255, 0.03);
}

.col-header.is-me {
  color: #2563eb;
  background: rgba(37, 99, 235, 0.08);
}
html.dark .col-header.is-me {
  color: #60a5fa;
  background: rgba(59, 130, 246, 0.15);
}

.col-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
}

.col-me-badge {
  font-size: 8px;
  padding: 1px 3px;
  border-radius: 4px;
  background: #2563eb;
  color: #ffffff;
  flex-shrink: 0;
  line-height: 1;
}

/* 하단 바디 행 */
.vertical-body-row {
  display: flex;
  position: relative;
  height: 320px;
  margin-top: 4px;
  width: 100%;
}

.vertical-time-axis {
  position: relative;
  width: 52px;
  box-sizing: border-box;
  flex-shrink: 0;
  height: 100%;
  border-right: 1px solid var(--border-color, rgba(0, 0, 0, 0.08));
}

.vertical-axis-tick {
  position: absolute;
  left: 0;
  right: 0;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: 4px;
}

.tick-text {
  font-size: 10px;
  color: var(--text-dimmed, #94a3b8);
  font-weight: 500;
  white-space: nowrap;
}

.tick-line {
  position: absolute;
  right: -1px;
  width: 4px;
  height: 1px;
  background: var(--border-color, rgba(0, 0, 0, 0.2));
}
html.dark .tick-line {
  background: rgba(255, 255, 255, 0.2);
}

.vertical-tracks-container {
  display: flex;
  box-sizing: border-box;
  position: relative;
  flex: 1;
  height: 100%;
  gap: 8px;
  padding-left: 8px;
  padding-right: 8px;
}

.vertical-golden-range {
  position: absolute;
  left: 0;
  right: 0;
  background: rgba(234, 179, 8, 0.15);
  border-top: 1px dashed rgba(202, 138, 4, 0.4);
  border-bottom: 1px dashed rgba(202, 138, 4, 0.4);
  pointer-events: none;
  z-index: 1;
}

.vertical-track-col {
  display: flex;
  flex-direction: column;
  width: 60px;
  box-sizing: border-box;
  flex-shrink: 0;
  height: 100%;
  position: relative;
  z-index: 2;
}

.btn-create-sheet {
  background: rgba(37, 99, 235, 0.08);
  border: 1px solid rgba(37, 99, 235, 0.3);
  color: #2563eb;
  font-size: 12px;
  font-weight: 700;
  padding: 4px 9px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  flex-shrink: 0;
}
.btn-create-sheet:hover {
  background: rgba(37, 99, 235, 0.16);
}
html.dark .btn-create-sheet {
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
  border-color: rgba(59, 130, 246, 0.4);
}


.col-track {
  position: relative;
  flex: 1;
  height: 100%;
  background: rgba(0, 0, 0, 0.02);
  border-radius: 6px;
  box-sizing: border-box;
  overflow: hidden;
}
html.dark .col-track {
  background: rgba(255, 255, 255, 0.04);
}

.vertical-time-block {
  position: absolute;
  left: 2px;
  right: 2px;
  background: rgba(59, 130, 246, 0.2);
  border: 1px solid #3b82f6;
  color: #1e40af;
  border-radius: 6px;
  padding: 3px 1px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  transition: all 0.15s ease;
  box-sizing: border-box;
  max-height: 100%;
}
html.dark .vertical-time-block {
  color: #93c5fd;
}

.vertical-time-block.is-me-block {
  background: rgba(37, 99, 235, 0.3);
  border-color: #2563eb;
  border-width: 2px;
  font-weight: 700;
}

.vertical-time-block.is-overnight-block {
  background: rgba(168, 85, 247, 0.25);
  border-color: #a855f7;
  color: #7e22ce;
}
html.dark .vertical-time-block.is-overnight-block {
  color: #d8b4fe;
}

.block-time {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  font-size: 9.5px;
  font-weight: 700;
  line-height: 1.15;
  white-space: nowrap;
  text-align: center;
  letter-spacing: -0.02em;
  width: 100%;
}

.time-part-start,
.time-part-end {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.block-memo {
  font-size: 8px;
  opacity: 0.9;
  margin-top: 1px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
  max-width: 100%;
}

.session-badge {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 6px;
  background: rgba(59, 130, 246, 0.15);
  color: #2563eb;
}
.session-badge.badge-confirmed {
  background: rgba(37, 99, 235, 0.15);
  color: #2563eb;
  border: 1px solid rgba(37, 99, 235, 0.25);
}
html.dark .session-badge.badge-confirmed {
  background: rgba(59, 130, 246, 0.22);
  color: #60a5fa;
  border-color: rgba(59, 130, 246, 0.4);
}
.session-badge.badge-recruiting {
  background: rgba(245, 158, 11, 0.15);
  color: #d97706;
}
html.dark .session-badge.badge-recruiting {
  background: rgba(245, 158, 11, 0.22);
  color: #fbbf24;
}

.count-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 6px;
  background: rgba(148, 163, 184, 0.15);
  color: #64748b;
}
.count-badge.count-min {
  background: rgba(245, 158, 11, 0.15);
  color: #d97706;
}
.count-badge.count-full {
  background: rgba(16, 185, 129, 0.15);
  color: #059669;
}

.tag-day, .tag-overnight, .tag-custom {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 6px;
}
.tag-day {
  background: rgba(59, 130, 246, 0.12);
  color: #2563eb;
}
.tag-overnight {
  background: rgba(139, 92, 246, 0.14);
  color: #7c3aed;
}
.tag-custom {
  background: rgba(16, 185, 129, 0.14);
  color: #059669;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
  flex-shrink: 0;
}

.btn-confirm-session {
  background: rgba(37, 99, 235, 0.08);
  color: #2563eb;
  border: 1px solid rgba(37, 99, 235, 0.3);
  padding: 4px 8px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s ease;
  white-space: nowrap;
  flex-shrink: 0;
}
.btn-confirm-session.is-ready {
  background: #2563eb;
  color: #ffffff;
  border-color: #2563eb;
  box-shadow: 0 2px 6px rgba(37, 99, 235, 0.3);
}
.btn-confirm-session.is-ready:hover {
  background: #1d4ed8;
}
.btn-confirm-session.is-confirmed {
  background: rgba(16, 185, 129, 0.15);
  color: #059669;
  border-color: rgba(16, 185, 129, 0.35);
}
.btn-confirm-session.is-confirmed:hover {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.35);
}
.btn-confirm-session.is-disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: var(--input-bg-color, #f1f5f9);
  color: var(--text-dimmed, #94a3b8);
  border-color: var(--border-color, #cbd5e1);
}

.btn-share-session {
  background: rgba(59, 130, 246, 0.08);
  color: #2563eb;
  border: 1px solid rgba(59, 130, 246, 0.25);
  padding: 4px 8px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s ease;
  white-space: nowrap;
  flex-shrink: 0;
}
.btn-share-session:hover {
  background: rgba(59, 130, 246, 0.15);
  border-color: #2563eb;
}
html.dark .btn-share-session {
  background: rgba(59, 130, 246, 0.18);
  color: #60a5fa;
  border-color: rgba(96, 165, 250, 0.35);
}
html.dark .btn-share-session:hover {
  background: rgba(59, 130, 246, 0.28);
}

.btn-icon-delete-date {
  background: transparent;
  border: 1px solid rgba(239, 68, 68, 0.25);
  color: #ef4444;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  transition: all 0.15s ease;
  flex-shrink: 0;
}
.btn-icon-delete-date:hover {
  background: rgba(239, 68, 68, 0.1);
  border-color: #ef4444;
}
html.dark .btn-icon-delete-date {
  border-color: rgba(239, 68, 68, 0.4);
}
html.dark .btn-icon-delete-date:hover {
  background: rgba(239, 68, 68, 0.2);
}

.btn-close {
  background: transparent;
  border: none;
  font-size: 16px;
  color: var(--text-dimmed, #64748b);
  cursor: pointer;
  padding: 4px;
  line-height: 1;
  flex-shrink: 0;
}

.txt-short {
  display: none;
}
@media (max-width: 640px) {
  .txt-long {
    display: none;
  }
  .txt-short {
    display: inline;
  }
  .axis-tick-label {
    font-size: 9.5px;
    font-weight: 600;
  }
  .tick-text {
    font-size: 9.5px;
    font-weight: 600;
  }
}

@media (max-width: 480px) {
  .sheet-header {
    padding: 10px 12px 8px;
    gap: 4px;
  }
  .header-main-row {
    gap: 4px;
  }
  .sheet-title {
    font-size: 14px;
  }
  .header-actions {
    gap: 3px;
  }
  .btn-confirm-session {
    padding: 3px 5px;
    font-size: 11px;
  }
  .btn-create-sheet {
    padding: 3px 5px;
    font-size: 11px;
  }
  .btn-share-session {
    padding: 3px 5px;
    min-width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .icon-share {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .btn-icon-delete-date {
    width: 24px;
    height: 24px;
  }
  .btn-close {
    padding: 2px 4px;
    font-size: 15px;
  }
}

.sheet-body {
  padding: 14px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.info-card.info-card-compact {
  background: var(--input-bg-color, #f8fafc);
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 10px;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
html.dark .info-card.info-card-compact {
  background: rgba(30, 41, 59, 0.45);
  border-color: rgba(255, 255, 255, 0.08);
}

.info-compact-meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11.5px;
  flex-wrap: wrap;
}

.info-meta-item {
  display: flex;
  align-items: center;
  gap: 5px;
}

.creator-name {
  font-weight: 700;
  color: var(--text-color, #0f172a);
}
html.dark .creator-name {
  color: #f1f5f9;
}

.info-compact-session-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  padding-top: 4px;
  border-top: 1px dashed var(--border-color, rgba(0, 0, 0, 0.06));
}
html.dark .info-compact-session-row {
  border-top-color: rgba(255, 255, 255, 0.06);
}

.session-label-group {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
}

.session-time-text {
  font-weight: 600;
  color: var(--text-color, #0f172a);
}
html.dark .session-time-text {
  color: #f1f5f9;
}

.session-chips-inline {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.btn-session-chip-slim {
  display: inline-flex;
  align-items: center;
  background: var(--card-bg-color, #ffffff);
  border: 1px solid var(--border-color, #cbd5e1);
  color: var(--text-color, #334155);
  padding: 2px 7px;
  border-radius: 5px;
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s ease;
  line-height: 1.4;
}
.btn-session-chip-slim:hover {
  border-color: #3b82f6;
  color: #2563eb;
}
.btn-session-chip-slim.active {
  background: rgba(59, 130, 246, 0.12);
  border-color: #3b82f6;
  color: #2563eb;
  font-weight: 700;
}
.btn-session-chip-slim.disabled,
.btn-session-chip-slim:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  pointer-events: none;
  background: var(--input-bg-color, #f1f5f9);
  border-color: var(--border-color, #cbd5e1);
  color: var(--text-dimmed, #94a3b8);
}
html.dark .btn-session-chip-slim {
  background: #1e293b;
  border-color: rgba(255, 255, 255, 0.12);
  color: #cbd5e1;
}
html.dark .btn-session-chip-slim.active {
  background: rgba(59, 130, 246, 0.25);
  color: #93c5fd;
  border-color: #3b82f6;
}

.info-label {
  color: var(--text-dimmed, #64748b);
  font-size: 11px;
}

.highlight-item .highlight-text {
  color: #16a34a;
  font-weight: 700;
}
html.dark .highlight-item .highlight-text {
  color: #4ade80;
}

.custom-edit-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: var(--card-bg-color, #ffffff);
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--border-color, #e2e8f0);
}

.custom-time-inputs {
  display: flex;
  align-items: center;
  gap: 6px;
}

.time-input-mini {
  border: 1px solid var(--border-color, #cbd5e1);
  border-radius: 6px;
  padding: 3px 6px;
  font-size: 12px;
  font-weight: 600;
  background: var(--card-bg-color, #ffffff);
  color: var(--text-color, #0f172a);
  font-family: inherit;
}

.dash {
  color: var(--text-dimmed, #64748b);
  font-weight: 600;
}

.check-overnight-mini {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  cursor: pointer;
  color: var(--text-dimmed, #64748b);
  font-family: inherit;
}
.check-overnight-mini.disabled-label {
  opacity: 0.5;
  cursor: not-allowed;
}
.check-overnight-mini.disabled-label input {
  cursor: not-allowed;
}
.day-only-hint {
  font-size: 10px;
  color: #ef4444;
  margin-left: 2px;
}

.btn-save-custom {
  background: #2563eb;
  color: #ffffff;
  border: none;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
}

.info-value {
  font-weight: 600;
  color: var(--text-color, #0f172a);
}

.highlight-row {
  border-top: 1px dashed var(--border-color, #cbd5e1);
  padding-top: 8px;
  margin-top: 2px;
}

.highlight-text {
  color: #059669;
}

.attendees-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.section-header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.btn-clear-attendees {
  background: rgba(239, 68, 68, 0.08);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.2);
  padding: 4px 8px;
  border-radius: 7px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: inherit;
}
.btn-clear-attendees:hover {
  background: rgba(239, 68, 68, 0.16);
  border-color: #ef4444;
}

.mini-time-unit {
  display: flex;
  align-items: center;
  gap: 4px;
}

.btn-ampm-mini {
  padding: 3px 6px;
  border-radius: 5px;
  border: 1px solid var(--border-color, #cbd5e1);
  background: var(--input-bg-color, #f1f5f9);
  color: var(--text-color, #334155);
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s ease;
}
.btn-ampm-mini.is-pm {
  background: rgba(139, 92, 246, 0.12);
  color: #7c3aed;
  border-color: rgba(139, 92, 246, 0.3);
}

.btn-add-attendee {
  background: rgba(37, 99, 235, 0.08);
  color: #2563eb;
  border: 1px solid rgba(37, 99, 235, 0.2);
  padding: 4px 10px;
  border-radius: 7px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: inherit;
}
.btn-add-attendee:hover {
  background: rgba(37, 99, 235, 0.15);
}

.section-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-dimmed, #64748b);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.empty-attendees {
  padding: 24px 16px;
  text-align: center;
  font-size: 13px;
  color: var(--text-dimmed, #64748b);
  background: var(--input-bg-color, #f8fafc);
  border-radius: 12px;
  border: 1px dashed var(--border-color, #cbd5e1);
}

.attendees-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.attendee-card {
  padding: 10px 14px;
  border-radius: 12px;
  background: var(--input-bg-color, #f8fafc);
  border: 1px solid var(--border-color, #e2e8f0);
  display: flex;
  flex-direction: column;
  gap: 4px;
  transition: all 0.15s;
}

.attendee-card.clickable-attendee {
  cursor: pointer;
}
.attendee-card.clickable-attendee:hover {
  border-color: #3b82f6;
  background: rgba(59, 130, 246, 0.05);
}

.edit-hint {
  font-size: 11px;
  opacity: 0.5;
  margin-left: 4px;
}
.clickable-attendee:hover .edit-hint {
  opacity: 1;
}

.attendee-card.is-me {
  background: rgba(59, 130, 246, 0.06);
  border-color: rgba(59, 130, 246, 0.3);
}

.attendee-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.attendee-name {
  font-size: 14px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
}

.me-chip {
  font-size: 10px;
  background: #3b82f6;
  color: #ffffff;
  padding: 1px 5px;
  border-radius: 4px;
  font-weight: 700;
}

.attendee-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.attendee-time {
  font-size: 12px;
  color: var(--text-dimmed, #64748b);
  font-weight: 500;
}

.card-action-btns {
  display: flex;
  align-items: center;
  gap: 4px;
}

.btn-card-action {
  background: transparent;
  border: 1px solid var(--border-color, #cbd5e1);
  border-radius: 6px;
  padding: 2px 6px;
  font-size: 11px;
  cursor: pointer;
  line-height: 1;
  color: var(--text-dimmed, #64748b);
  transition: all 0.15s ease;
}
.btn-card-action:hover {
  background: var(--card-bg-color, #ffffff);
  color: var(--text-color, #0f172a);
}
.btn-card-action.delete-btn {
  font-weight: 700;
  color: var(--text-dimmed, #94a3b8);
}
.btn-card-action.delete-btn:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.4);
}

.attendee-memo {
  font-size: 12px;
  color: var(--text-dimmed, #64748b);
  background: rgba(0, 0, 0, 0.04);
  padding: 4px 8px;
  border-radius: 6px;
  margin-top: 4px;
  word-break: break-word;
  display: inline-block;
  max-width: fit-content;
}
html.dark .attendee-memo {
  background: rgba(255, 255, 255, 0.08);
  color: #cbd5e1;
}

.sheet-footer {
  padding: 12px 20px 16px;
  border-top: 1px solid var(--border-color, rgba(0, 0, 0, 0.06));
  flex-shrink: 0;
  background: var(--card-bg-color, #ffffff);
}

.btn-primary {
  width: 100%;
  background: #2563eb;
  color: #ffffff;
  border: none;
  padding: 12px 18px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s ease;
}
.btn-primary:hover {
  opacity: 0.9;
}

/* 참석 취소 PIN 입력 미니 모달 */
.pin-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10005;
  padding: 16px;
}

.pin-modal-sheet {
  background: var(--card-bg-color, #ffffff);
  color: var(--text-color, #0f172a);
  border: 1px solid var(--border-color, rgba(0, 0, 0, 0.08));
  border-radius: 18px;
  width: 100%;
  max-width: 360px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.25);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: inherit;
}

.pin-modal-header {
  padding: 16px 20px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-color, rgba(0, 0, 0, 0.06));
}

.pin-modal-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
}

.pin-modal-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pin-modal-desc {
  margin: 0;
  font-size: 13px;
  color: var(--text-dimmed, #64748b);
  line-height: 1.5;
}

.pin-modal-desc strong {
  color: var(--text-color, #0f172a);
}

.pin-modal-subdesc {
  margin: -4px 0 0;
  font-size: 12px;
  color: #ef4444;
  line-height: 1.4;
}

.pin-error-banner {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
}


.pin-input-wrap {
  display: flex;
  justify-content: center;
  margin-top: 4px;
}

.pin-modal-sheet .pin-input {
  letter-spacing: 0.25em;
  font-weight: 700;
  max-width: 120px;
  text-align: center;
  font-size: 18px;
  padding: 10px 14px;
  border-radius: 12px;
  border: 1px solid var(--border-color, #cbd5e1);
  background: var(--input-bg-color, #f8fafc);
  color: var(--text-color, #0f172a);
  outline: none;
  font-family: inherit;
}
.pin-modal-sheet .pin-input:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
}

.pin-modal-footer {
  padding: 12px 20px 16px;
  border-top: 1px solid var(--border-color, rgba(0, 0, 0, 0.06));
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.btn-modal-cancel {
  background: transparent;
  color: var(--text-dimmed, #64748b);
  border: 1px solid var(--border-color, #cbd5e1);
  padding: 8px 14px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
}

.btn-modal-confirm {
  background: #ef4444;
  color: #ffffff;
  border: none;
  padding: 8px 16px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition: opacity 0.15s ease;
}
.btn-modal-confirm:hover {
  opacity: 0.9;
}

/* 구글 시트 회차 생성 진행률 모달 (동기화 중 스타일) */
.sync-loader-overlay {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 99999;
}

.sync-loader-card {
  background: var(--card-bg-color, #ffffff);
  border: 1px solid var(--border-color, rgba(0, 0, 0, 0.12));
  padding: 26px 28px;
  border-radius: 18px;
  width: 320px;
  max-width: calc(100vw - 40px);
  text-align: center;
  box-shadow: 0 20px 45px rgba(0, 0, 0, 0.35);
  color: var(--text-color, #0f172a);
  animation: sheetPop 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
html.dark .sync-loader-card {
  background: #1e293b;
  border-color: rgba(255, 255, 255, 0.12);
  color: #f8fafc;
}

.sync-loader-title {
  font-size: 15.5px;
  font-weight: 700;
  margin-bottom: 16px;
  color: var(--text-color, #0f172a);
  letter-spacing: -0.01em;
}
html.dark .sync-loader-title {
  color: #f8fafc;
}

.sync-progress-container {
  width: 100%;
  height: 10px;
  background: var(--input-bg-color, #e2e8f0);
  border-radius: 5px;
  overflow: hidden;
  margin-bottom: 12px;
}
html.dark .sync-progress-container {
  background: rgba(255, 255, 255, 0.1);
}

.sync-progress-bar {
  height: 100%;
  background: linear-gradient(90deg, #3b82f6, #10b981);
  transition: width 0.35s ease;
  border-radius: 5px;
}

.sync-progress-text {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dimmed, #64748b);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
html.dark .sync-progress-text {
  color: #94a3b8;
}

.step-text {
  font-weight: 600;
}

.percent-text {
  font-weight: 700;
  color: #2563eb;
}
html.dark .percent-text {
  color: #60a5fa;
}
</style>
