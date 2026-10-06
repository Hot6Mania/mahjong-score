<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { ScheduleDayItem, SessionType, ScheduleAttendee } from '@/types/schedule';
import { computeEffectiveOverlapRange, getAttendeeInterval } from '@/utils/timelineEngine';
import { getSavedPins, hashPin } from '@/services/scheduleService';

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
    sessionType: SessionType;
    adminSessionType?: 'day' | 'overnight';
    customStartTime?: string;
    customEndTime?: string;
    customIsOvernight?: boolean;
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

const isEditingCustomSession = ref(false);
const customStartInput = ref('10:00');
const customEndInput = ref('22:00');
const customOvernightInput = ref(false);

// 타임테이블 가로(horizontal)/세로(vertical) 토글 모드
const timetableOrientation = ref<'horizontal' | 'vertical'>('horizontal');

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

const overlapTimeRange = computed(() => {
  if (!props.dayItem?.attendees) return null;
  return computeEffectiveOverlapRange(props.dayItem.attendees);
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
  const isOvernight = props.dayItem.sessionType === 'overnight' ||
    props.dayItem.customIsOvernight ||
    props.dayItem.adminSessionType === 'overnight' ||
    attendees.some(a => a.isOvernight);

  let minStart = 600; // 10:00
  let maxEnd = isOvernight ? 1800 : 1380; // 익일 06:00 (1800분) 또는 23:00 (1380분)

  for (const a of attendees) {
    const [s, e] = getAttendeeInterval(a);
    if (s < minStart) minStart = Math.max(360, s);
    if (e > maxEnd) maxEnd = Math.min(2160, e);
  }

  const windowStart = Math.floor(minStart / 60) * 60;
  const windowEnd = Math.ceil(maxEnd / 60) * 60;

  return {
    startMin: windowStart,
    endMin: windowEnd,
    totalMin: Math.max(60, windowEnd - windowStart),
    isOvernight
  };
});

// 가로 시간표 눈금 (2시간 간격)
const timeTicks = computed(() => {
  const { startMin, endMin } = timetableWindow.value;
  const ticks: { min: number; label: string }[] = [];
  const step = 120;
  for (let m = startMin; m <= endMin; m += step) {
    const isNextDay = m >= 1440;
    const h = Math.floor((m % 1440) / 60);
    const label = isNextDay ? `+${String(h).padStart(2, '0')}:00` : `${String(h).padStart(2, '0')}:00`;
    ticks.push({ min: m, label });
  }
  return ticks;
});

// 세로 시간표 눈금 (1시간 간격)
const verticalTimeTicks = computed(() => {
  const { startMin, endMin } = timetableWindow.value;
  const ticks: { min: number; label: string; hour: number }[] = [];
  for (let m = startMin; m <= endMin; m += 60) {
    const isNextDay = m >= 1440;
    const h = Math.floor((m % 1440) / 60);
    const label = isNextDay ? `익일 ${h}시` : `${h}시`;
    ticks.push({ min: m, label, hour: h });
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
  isEditingCustomSession.value = false;
  emit('updateSessionType', {
    dateStr: props.dayItem.date,
    sessionType: type,
    adminSessionType: props.dayItem.adminSessionType
  });
};

const saveCustomSession = () => {
  if (!props.dayItem) return;
  emit('updateSessionType', {
    dateStr: props.dayItem.date,
    sessionType: 'custom',
    adminSessionType: props.dayItem.adminSessionType,
    customStartTime: customStartInput.value,
    customEndTime: customEndInput.value,
    customIsOvernight: customOvernightInput.value
  });
  isEditingCustomSession.value = false;
};

// 날짜(회차) 삭제 PIN 확인 모달 상태
const isDeleteDatePinModalOpen = ref(false);
const deleteDatePinInput = ref('');
const deleteDatePinErrorMessage = ref('');

// 가능한 날짜 목록에서 완전 삭제
const onDeleteDateClick = async () => {
  if (!props.dayItem) return;

  const count = props.dayItem.attendees?.length || 0;
  const countMsg = count > 0 ? `\n(등록된 참석자 ${count}명의 신청 내역도 함께 삭제됩니다)` : '';

  // 1) 관리자 로그인 상태인 경우: PIN 없이 즉시 삭제 가능
  if (props.isAdmin) {
    if (confirm(`정말 이 날짜(${props.dayItem.date})를 가능한 일정 목록에서 완전히 삭제하시겠습니까?${countMsg}`)) {
      emit('deleteDate', props.dayItem.date);
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
        if (confirm(`개설자('${creatorName}') 인증이 확인되었습니다.\n정말 이 날짜(${props.dayItem.date})를 삭제하시겠습니까?${countMsg}`)) {
          emit('deleteDate', props.dayItem.date, cachedPin);
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
  const trimmed = deleteDatePinInput.value.trim();
  if (!trimmed || trimmed.length < 4) {
    deleteDatePinErrorMessage.value = '4자리 확인 PIN을 입력해주세요.';
    return;
  }

  // 개설자 PIN 해시 비교 (클라이언트단 사전 검증)
  if (props.dayItem.creatorPinHash && props.dayItem.creatorPinHash !== 'admin_bypass') {
    const clientHash = await hashPin(trimmed);
    if (clientHash !== props.dayItem.creatorPinHash) {
      deleteDatePinErrorMessage.value = '개설자 PIN 비밀번호가 일치하지 않습니다.';
      return;
    }
  }

  emit('deleteDate', props.dayItem.date, trimmed);
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

// 참석 취소 PIN 입력 모달 상태
const isRemovePinModalOpen = ref(false);
const removeTargetName = ref('');
const removePinInput = ref('');
const removePinErrorMessage = ref('');

const onRemoveAttendeeClick = async (event: Event, name: string) => {
  event.stopPropagation();
  if (!props.dayItem) return;

  // 1) 개설자 또는 관리자인 경우: PIN 없이 즉시 제외 가능
  if (isManager.value) {
    if (confirm(`'${name}' 님을 이 날짜 참석자 명단에서 제외하시겠습니까?`)) {
      emit('removeAttendee', props.dayItem.date, name, 'admin_bypass');
    }
    return;
  }

  // 2) 일반 사용자의 경우: 저장된 PIN 확인 (본인 PIN 또는 개설자 PIN)
  const savedPins = getSavedPins();
  const cachedPin = savedPins[name.trim()] || (props.dayItem.creator ? savedPins[props.dayItem.creator.trim()] : undefined);

  if (cachedPin && cachedPin.length >= 4) {
    if (confirm(`'${name}' 님의 참석을 취소하시겠습니까?`)) {
      emit('removeAttendee', props.dayItem.date, name, cachedPin);
    }
    return;
  }

  // 3) 저장된 PIN이 없는 경우: 4자리 PIN 입력 모달 창 띄우기
  removeTargetName.value = name;
  removePinInput.value = '';
  removePinErrorMessage.value = '';
  isRemovePinModalOpen.value = true;
};

const confirmRemoveWithPin = async () => {
  if (!props.dayItem || !removeTargetName.value) return;
  const trimmed = removePinInput.value.trim();
  if (!trimmed || trimmed.length < 4) {
    removePinErrorMessage.value = '4자리 확인 PIN을 입력해주세요.';
    return;
  }

  // 클라이언트 사전 검증: 대상 참가자의 PIN 또는 개설자의 PIN 둘 중 하나라도 맞으면 통과
  const targetAttendee = props.dayItem.attendees?.find(a => a.name === removeTargetName.value);
  if (targetAttendee) {
    const inputHash = await hashPin(trimmed);
    const matchesTarget = targetAttendee.pinHash && (targetAttendee.pinHash === inputHash || targetAttendee.pinHash === 'admin_bypass');
    const matchesCreator = props.dayItem.creatorPinHash && (props.dayItem.creatorPinHash === inputHash);

    if (targetAttendee.pinHash && !matchesTarget && !matchesCreator) {
      removePinErrorMessage.value = '등록 PIN 또는 개설자 PIN이 일치하지 않습니다.';
      return;
    }
  }

  emit('removeAttendee', props.dayItem.date, removeTargetName.value, trimmed);
  isRemovePinModalOpen.value = false;
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

// 회차 시간 표기 (예: 오전 10시 ~ 오후 10시)
const getSessionTimeLabel = (): string => {
  if (!props.dayItem) return '';
  const item = props.dayItem;
  if (item.sessionType === 'overnight') {
    const start = formatTimeKorean(item.customStartTime || '10:00');
    return `${start} ~ 익일 (밤샘)`;
  }
  if (item.sessionType === 'custom') {
    const start = formatTimeKorean(item.customStartTime || '10:00');
    const end = formatTimeKorean(item.customEndTime || '22:00');
    const overnight = item.customIsOvernight ? ' 익일' : '';
    return `${start} ~ ${end}${overnight}`;
  }
  // 기본 당일
  const start = formatTimeKorean(item.customStartTime || '10:00');
  const end = formatTimeKorean(item.customEndTime || '22:00');
  return `${start} ~ ${end}`;
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

const onConfirmSessionClick = () => {
  if (!props.dayItem) return;
  if (props.dayItem.isConfirmed) {
    if (confirm('모임 출발 확정을 해제하시겠습니까? (다시 미확정 상태로 전환됩니다)')) {
      emit('toggleConfirm', props.dayItem.date);
    }
  } else {
    if ((props.dayItem.attendees?.length || 0) < 4) {
      emit('toast', '참석 인원이 4인 이상 모여야 출발 확정할 수 있습니다.', 'error');
      return;
    }
    emit('toggleConfirm', props.dayItem.date);
  }
};
</script>

<template>
  <Transition name="apple-modal-fade">
    <div v-if="isOpen && dayItem" class="apple-modal-backdrop" @click.self="emit('close')">
      <div class="apple-modal-sheet">
        <!-- 헤더 (깔끔한 2행 구조) -->
        <div class="sheet-header">
          <!-- 1행: 날짜 타이틀 & 우측 회차 뱃지 & 우측 아이콘 툴바 -->
          <div class="header-main-row">
            <div class="title-with-badge">
              <h3 class="sheet-title">{{ dayItem.date }} ({{ getDayOfWeek(dayItem.date) }})</h3>
              <span v-if="dayItem.isConfirmed && sessionNumber" class="session-badge badge-confirmed">
                제{{ sessionNumber }}회
              </span>
              <span v-else class="session-badge badge-recruiting">
                {{ attendeeCount >= 4 ? '확정 대기' : '모집중' }}
              </span>
            </div>
            <div class="header-actions">
              <!-- 4인 이상 충족 시 노출되는 출발 확정 토글 버튼 -->
              <button
                v-if="isManager && (attendeeCount >= 4 || dayItem.isConfirmed)"
                type="button"
                class="btn-confirm-session"
                :class="{
                  'is-confirmed': dayItem.isConfirmed,
                  'is-ready': !dayItem.isConfirmed && attendeeCount >= 4
                }"
                @click="onConfirmSessionClick"
                :title="dayItem.isConfirmed ? '출발 확정 해제' : '4인 충족: 모임 출발 확정'"
              >
                {{ dayItem.isConfirmed ? '확정됨' : '출발 확정' }}
              </button>
              <button
                type="button"
                class="btn-share-session"
                @click="copySessionShareText"
                title="이 회차 일정 공유 텍스트 복사"
              >
                공유
              </button>
              <!-- 날짜 삭제 휴지통 아이콘 버튼 -->
              <button
                v-if="isAdmin || !!dayItem.creator"
                type="button"
                class="btn-icon-delete-date"
                @click="onDeleteDateClick"
                title="이 날짜를 가능한 일정 목록에서 완전히 삭제"
                aria-label="날짜 삭제"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  <line x1="10" y1="11" x2="10" y2="17"></line>
                  <line x1="14" y1="11" x2="14" y2="17"></line>
                </svg>
              </button>
              <button class="btn-close" @click="emit('close')" aria-label="닫기">✕</button>
            </div>
          </div>

          <!-- 2행: 상태 배지 서브 바 -->
          <div class="header-sub-row">
            <div class="title-badge-row">
              <span class="count-badge" :class="{ 'count-full': attendeeCount >= 5, 'count-min': attendeeCount === 4 }">
                {{ attendeeCount }}명 참가
              </span>
              <span v-if="dayItem.sessionType === 'overnight'" class="tag-overnight">밤샘</span>
              <span v-else-if="dayItem.sessionType === 'custom'" class="tag-custom">커스텀</span>
              <span v-else class="tag-day">당일</span>
            </div>
          </div>
        </div>

        <div class="sheet-body">
          <!-- 모임 시간 및 개설자 안내 -->
          <div class="info-card">
            <div v-if="dayItem.creator" class="info-row">
              <span class="info-label">개설자</span>
              <span class="info-value">{{ dayItem.creator }}</span>
            </div>

            <div class="info-row">
              <span class="info-label">모임 시간</span>
              <div class="info-value-wrap">
                <span class="info-value">
                  <template v-if="dayItem.sessionType === 'overnight'">
                    밤샘 ({{ dayItem.customStartTime || '10:00' }} ~ 익일)
                  </template>
                  <template v-else-if="dayItem.sessionType === 'custom'">
                    커스텀 ({{ dayItem.customStartTime || '10:00' }} ~ {{ dayItem.customEndTime || '22:00' }}{{ dayItem.customIsOvernight ? ' 익일' : '' }})
                  </template>
                  <template v-else>
                    당일 ({{ dayItem.customStartTime || '10:00' }} ~ {{ dayItem.customEndTime || '22:00' }})
                  </template>
                </span>
              </div>
            </div>

            <!-- 관리자/개설자용 모임 시간 변경 버튼군 (이모지 없음) -->
            <div v-if="isManager" class="session-switch-row">
              <button
                type="button"
                class="btn-session-chip"
                :class="{ active: dayItem.sessionType === 'day' && !isEditingCustomSession }"
                @click="changeSession('day')"
                title="당일 세션 (10:00~22:00)"
              >
                당일
              </button>
              <button
                type="button"
                class="btn-session-chip"
                :class="{ active: dayItem.sessionType === 'overnight' && !isEditingCustomSession }"
                @click="changeSession('overnight')"
                title="밤샘 세션 (10:00~익일)"
              >
                밤샘
              </button>
              <button
                type="button"
                class="btn-session-chip"
                :class="{ active: dayItem.sessionType === 'custom' || isEditingCustomSession }"
                @click="isEditingCustomSession = !isEditingCustomSession"
                title="커스텀 시간 직접 지정"
              >
                커스텀
              </button>
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
                <label class="check-overnight-mini">
                  <input type="checkbox" v-model="customOvernightInput" />
                  <span>익일</span>
                </label>
              </div>
              <button type="button" class="btn-save-custom" @click="saveCustomSession">적용</button>
            </div>

            <div v-if="overlapTimeRange" class="info-row highlight-row">
              <span class="info-label">대국 가능 시간</span>
              <span class="info-value highlight-text">{{ overlapTimeRange }}</span>
            </div>
          </div>

          <!-- 회차 타임테이블 인터랙티브 뷰 섹션 -->
          <div v-if="attendeeCount > 0" class="timetable-section">
            <div class="timetable-header">
              <div class="timetable-title-group">
                <span class="timetable-title">회차 타임테이블</span>
                <span v-if="overlapTimeRange" class="timetable-sub-badge">4인 성립</span>
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
              <!-- 상단 시간 눈금 헤더 -->
              <div class="time-axis-header">
                <div class="axis-spacer"></div>
                <div class="axis-ticks">
                  <span
                    v-for="tick in timeTicks"
                    :key="tick.min"
                    class="axis-tick-label"
                    :style="{ left: `${((tick.min - timetableWindow.startMin) / timetableWindow.totalMin) * 100}%` }"
                  >
                    {{ tick.label }}
                  </span>
                </div>
              </div>

              <!-- 참가자 행들 -->
              <div class="horizontal-rows-wrapper">
                <!-- 4인 이상 겹침 골든타임 배경 하이라이트 -->
                <div
                  v-if="overlapHighlightRegion"
                  class="horizontal-golden-range"
                  :style="{ left: overlapHighlightRegion.left, width: overlapHighlightRegion.width }"
                  title="4인 이상 대국 가능 시간대"
                ></div>

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

            <!-- 2) 세로 시간표 뷰 (Vertical Timetable) -->
            <div v-else class="vertical-timetable-card">
              <div class="vertical-timetable-scroll">
                <!-- 좌측 세로 시간축 -->
                <div class="vertical-time-axis">
                  <div
                    v-for="tick in verticalTimeTicks"
                    :key="tick.min"
                    class="vertical-axis-tick"
                    :style="{ top: `${((tick.min - timetableWindow.startMin) / timetableWindow.totalMin) * 100}%` }"
                  >
                    <span class="tick-text">{{ tick.label }}</span>
                    <div class="tick-line"></div>
                  </div>
                </div>

                <!-- 우측 참가자 열들 (Columns) -->
                <div class="vertical-columns-container">
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
                    class="vertical-attendee-col"
                    :class="{ 'is-me': att.name === myAttendeeName }"
                  >
                    <!-- 참가자 이름 컬럼 헤더 -->
                    <div class="col-header" :title="att.name">
                      <span class="col-name">{{ att.name }}</span>
                      <span v-if="att.name === myAttendeeName" class="col-me-badge">나</span>
                    </div>

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
                        <span class="block-time">{{ getAttendeeBar(att).timeLabel }}</span>
                        <span v-if="att.memo" class="block-memo">{{ att.memo }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
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

        <!-- 푸터 -->
        <div class="sheet-footer">
          <button type="button" class="btn-primary" @click="emit('openAttend', isUserAttending ? myAttendeeName : undefined)">
            {{ isUserAttending ? '내 참석 정보 수정' : '참석 신청하기' }}
          </button>
        </div>
      </div>
    </div>
  </Transition>

  <!-- 참석 취소 4자리 PIN 입력 모달 -->
  <Transition name="apple-modal-fade">
    <div v-if="isRemovePinModalOpen" class="pin-modal-backdrop" @click.self="isRemovePinModalOpen = false">
      <div class="pin-modal-sheet">
        <div class="pin-modal-header">
          <h4 class="pin-modal-title">참석 취소 PIN 확인</h4>
          <button type="button" class="btn-close" @click="isRemovePinModalOpen = false">✕</button>
        </div>
        <div class="pin-modal-body">
          <p class="pin-modal-desc">
            <strong>'{{ removeTargetName }}'</strong> 님의 참석을 취소하려면 등록 PIN 또는 개설자<template v-if="dayItem?.creator">('{{ dayItem.creator }}')</template>의 4자리 PIN을 입력해주세요.
          </p>
          <div v-if="removePinErrorMessage" class="pin-error-banner">
            {{ removePinErrorMessage }}
          </div>
          <div class="pin-input-wrap">
            <input
              type="password"
              maxlength="4"
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
          <button type="button" class="btn-modal-cancel" @click="isRemovePinModalOpen = false">닫기</button>
          <button type="button" class="btn-modal-confirm" @click="confirmRemoveWithPin">취소 확인</button>
        </div>
      </div>
    </div>
  </Transition>

  <!-- 날짜(회차) 삭제 4자리 PIN 입력 모달 -->
  <Transition name="apple-modal-fade">
    <div v-if="isDeleteDatePinModalOpen && dayItem" class="pin-modal-backdrop" @click.self="isDeleteDatePinModalOpen = false">
      <div class="pin-modal-sheet">
        <div class="pin-modal-header">
          <h4 class="pin-modal-title">일정 삭제 PIN 확인</h4>
          <button type="button" class="btn-close" @click="isDeleteDatePinModalOpen = false">✕</button>
        </div>
        <div class="pin-modal-body">
          <p class="pin-modal-desc">
            <strong>{{ dayItem.date }}</strong> 회차 일정을 완전히 삭제하려면 개설자<strong v-if="dayItem.creator"> '{{ dayItem.creator }}'</strong> 님이 설정한 4자리 확인 PIN을 입력해주세요.
          </p>
          <p v-if="(dayItem.attendees?.length || 0) > 0" class="pin-modal-subdesc">
            ※ 등록된 참석자 {{ dayItem.attendees.length }}명의 신청 내역도 함께 삭제됩니다.
          </p>
          <div v-if="deleteDatePinErrorMessage" class="pin-error-banner">
            {{ deleteDatePinErrorMessage }}
          </div>
          <div class="pin-input-wrap">
            <input
              type="password"
              maxlength="4"
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
          <button type="button" class="btn-modal-confirm btn-danger" @click="confirmDeleteDateWithPin">삭제 확인</button>
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
  padding: 16px 20px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-bottom: 1px solid var(--border-color, rgba(0, 0, 0, 0.06));
}

.header-main-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.title-with-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.header-sub-row {
  display: flex;
  align-items: center;
}

.title-badge-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.sheet-title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.02em;
  white-space: nowrap;
  flex-shrink: 0;
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
:global(html.dark) .timetable-section {
  background: rgba(30, 41, 59, 0.5);
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

.timetable-sub-badge {
  font-size: 10px;
  font-weight: 700;
  color: #16a34a;
  background: rgba(22, 163, 74, 0.12);
  padding: 1px 6px;
  border-radius: 6px;
}

.orientation-toggle-group {
  display: inline-flex;
  background: rgba(0, 0, 0, 0.06);
  padding: 2px;
  border-radius: 8px;
  gap: 2px;
}
:global(html.dark) .orientation-toggle-group {
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
:global(html.dark) .btn-orientation.active {
  background: #334155;
  color: #60a5fa;
}

/* 1) 가로 타임라인 (Gantt) */
.horizontal-timetable-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 4px;
}

.time-axis-header {
  display: flex;
  align-items: center;
  position: relative;
  height: 18px;
}

.axis-spacer {
  width: 58px;
  flex-shrink: 0;
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

.horizontal-rows-wrapper {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.horizontal-golden-range {
  position: absolute;
  top: 0;
  bottom: 0;
  background: rgba(234, 179, 8, 0.15);
  border-left: 1px dashed rgba(202, 138, 4, 0.4);
  border-right: 1px dashed rgba(202, 138, 4, 0.4);
  pointer-events: none;
  z-index: 1;
  border-radius: 4px;
}

.horizontal-row {
  display: flex;
  align-items: center;
  position: relative;
  height: 24px;
  z-index: 2;
}

.row-user-label {
  width: 58px;
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-color, #334155);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
  gap: 2px;
}

.horizontal-row.is-me .row-user-label {
  color: #2563eb;
  font-weight: 700;
}

.badge-me-dot {
  font-size: 9px;
  padding: 1px 3px;
  border-radius: 4px;
  background: #2563eb;
  color: #ffffff;
  line-height: 1;
}

.row-track {
  position: relative;
  flex: 1;
  height: 100%;
  background: rgba(0, 0, 0, 0.03);
  border-radius: 6px;
}
:global(html.dark) .row-track {
  background: rgba(255, 255, 255, 0.04);
}

.time-bar {
  position: absolute;
  top: 2px;
  bottom: 2px;
  background: #93c5fd;
  color: #1e3a8a;
  border-radius: 5px;
  display: flex;
  align-items: center;
  padding: 0 6px;
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  transition: all 0.15s ease;
}

.time-bar.is-me-bar {
  background: #3b82f6;
  color: #ffffff;
  font-weight: 700;
  box-shadow: 0 2px 5px rgba(59, 130, 246, 0.3);
}

.time-bar.is-overnight-bar {
  background: #a855f7;
  color: #ffffff;
}

/* 2) 세로 시간표 (Vertical Timetable) */
.vertical-timetable-card {
  position: relative;
  background: var(--card-bg-color, #ffffff);
  border: 1px solid var(--border-color, rgba(0, 0, 0, 0.06));
  border-radius: 10px;
  overflow: hidden;
}
:global(html.dark) .vertical-timetable-card {
  background: #0f172a;
}

.vertical-timetable-scroll {
  display: flex;
  position: relative;
  height: 320px;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 6px 8px 10px;
}

.vertical-time-axis {
  position: relative;
  width: 50px;
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

.vertical-columns-container {
  display: flex;
  position: relative;
  flex: 1;
  height: 100%;
  gap: 8px;
  padding-left: 8px;
  min-width: min-content;
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

.vertical-attendee-col {
  display: flex;
  flex-direction: column;
  width: 72px;
  flex-shrink: 0;
  height: 100%;
  position: relative;
  z-index: 2;
}

.col-header {
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-color, #334155);
  text-align: center;
  border-bottom: 1px solid var(--border-color, rgba(0, 0, 0, 0.06));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vertical-attendee-col.is-me .col-header {
  color: #2563eb;
}

.col-me-badge {
  font-size: 8px;
  padding: 1px 3px;
  border-radius: 4px;
  background: #2563eb;
  color: #ffffff;
}

.col-track {
  position: relative;
  flex: 1;
  background: rgba(0, 0, 0, 0.02);
  border-radius: 6px;
  margin-top: 4px;
}
:global(html.dark) .col-track {
  background: rgba(255, 255, 255, 0.03);
}

.vertical-time-block {
  position: absolute;
  left: 2px;
  right: 2px;
  background: rgba(59, 130, 246, 0.2);
  border: 1px solid #3b82f6;
  color: #1e40af;
  border-radius: 6px;
  padding: 4px 3px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  transition: all 0.15s ease;
}
:global(html.dark) .vertical-time-block {
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
:global(html.dark) .vertical-time-block.is-overnight-block {
  color: #d8b4fe;
}

.block-time {
  font-size: 9px;
  font-weight: 700;
  line-height: 1.1;
  word-break: break-all;
}

.block-memo {
  font-size: 8px;
  opacity: 0.85;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
:global(html.dark) .session-badge.badge-confirmed {
  background: rgba(59, 130, 246, 0.22);
  color: #60a5fa;
  border-color: rgba(59, 130, 246, 0.4);
}
.session-badge.badge-recruiting {
  background: rgba(245, 158, 11, 0.15);
  color: #d97706;
}
:global(html.dark) .session-badge.badge-recruiting {
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
  gap: 8px;
}

.btn-confirm-session {
  background: rgba(37, 99, 235, 0.08);
  color: #2563eb;
  border: 1px solid rgba(37, 99, 235, 0.3);
  padding: 4px 10px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s ease;
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
  padding: 4px 10px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s ease;
}
.btn-share-session:hover {
  background: rgba(59, 130, 246, 0.15);
  border-color: #2563eb;
}
:global(html.dark) .btn-share-session {
  background: rgba(59, 130, 246, 0.18);
  color: #60a5fa;
  border-color: rgba(96, 165, 250, 0.35);
}
:global(html.dark) .btn-share-session:hover {
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
}
.btn-icon-delete-date:hover {
  background: rgba(239, 68, 68, 0.1);
  border-color: #ef4444;
}
:global(html.dark) .btn-icon-delete-date {
  border-color: rgba(239, 68, 68, 0.4);
}
:global(html.dark) .btn-icon-delete-date:hover {
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
}

.sheet-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: 65vh;
  overflow-y: auto;
}

.info-card {
  background: var(--input-bg-color, #f8fafc);
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 12px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
}

.info-label {
  color: var(--text-dimmed, #64748b);
}

.info-value-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.session-switch-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-top: 4px;
  border-top: 1px dashed var(--border-color, #e2e8f0);
}

.btn-session-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--card-bg-color, #ffffff);
  border: 1px solid var(--border-color, #cbd5e1);
  color: var(--text-color, #334155);
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s ease;
}
.btn-session-chip:hover {
  border-color: #3b82f6;
  color: #2563eb;
}
.btn-session-chip.active {
  background: rgba(59, 130, 246, 0.1);
  border-color: #3b82f6;
  color: #2563eb;
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
:global(html.dark) .attendee-memo {
  background: rgba(255, 255, 255, 0.08);
  color: #cbd5e1;
}

.sheet-footer {
  padding: 14px 20px 18px;
  border-top: 1px solid var(--border-color, rgba(0, 0, 0, 0.06));
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
</style>
