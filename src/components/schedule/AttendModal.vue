<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import type { ScheduleDayItem, ScheduleAttendee } from '@/types/schedule';
import type { MemberStatItem } from '@/services/publicStatsService';
import { timeStringToMinutes } from '@/utils/timelineEngine';

const props = defineProps<{
  isOpen: boolean;
  dayItem: ScheduleDayItem | null;
  sessionNumber: number | null;
  members: MemberStatItem[];
  currentUserId?: string;
  targetAttendeeName?: string;
  isAdmin?: boolean;
  isManager?: boolean;
  creatorName?: string;
  myAttendeeName?: string;
}>();

const isCreatorAddMode = computed(() => {
  if (props.isAdmin) return true;
  if (props.isManager) return true;
  if (props.myAttendeeName && props.dayItem?.creator && props.dayItem.creator === props.myAttendeeName) return true;
  return false;
});

const isMultiSelectMode = computed(() => {
  return isCreatorAddMode.value && !props.targetAttendeeName;
});

const isOvernightAllowed = computed(() => {
  if (!props.dayItem) return true;
  if (props.dayItem.adminSessionType === 'day') return false;
  return (
    props.dayItem.adminSessionType === 'overnight' ||
    props.dayItem.sessionType === 'overnight' ||
    props.dayItem.sessionType === 'custom' ||
    props.isAdmin ||
    props.isManager
  );
});

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'submit', payload: {
    name: string;
    isOvernight: boolean;
    startTime: string;
    endTime: string;
    isCustomTime: boolean;
    memo?: string;
    pin: string;
  }): void;
  (e: 'submitBatch', payload: {
    attendees: Array<{
      name: string;
      isOvernight: boolean;
      startTime: string;
      endTime: string;
      isCustomTime: boolean;
      memo?: string;
    }>;
    pin: string;
  }): void;
  (e: 'cancel', payload: { name: string; pin: string }): void;
}>();

// 폼 입력 상태
const selectedName = ref('');
const selectedNames = ref<string[]>([]);
const isCustomName = ref(false);
const nameSearchQuery = ref('');
const isDropdownOpen = ref(false);

const toggleMemberSelection = (name: string) => {
  const trimmed = name.trim();
  if (!trimmed) return;
  const idx = selectedNames.value.indexOf(trimmed);
  if (idx !== -1) {
    selectedNames.value.splice(idx, 1);
  } else {
    selectedNames.value.push(trimmed);
  }
};

const removeSelectedName = (name: string) => {
  selectedNames.value = selectedNames.value.filter(n => n !== name);
};

const addCustomName = () => {
  const val = nameSearchQuery.value.trim();
  if (!val) return;
  if (!selectedNames.value.includes(val)) {
    selectedNames.value.push(val);
  }
  nameSearchQuery.value = '';
};

// 시간대 선택: 'day' (10~22시) | 'overnight' (10시~익일) | 'custom' (직접 입력)
const timeMode = ref<'day' | 'overnight' | 'custom'>('day');
const customStartTime = ref('10:00');
const customEndTime = ref('22:00');
const customIsOvernight = ref(false);

const pin = ref('');
const memo = ref('');
const errorMessage = ref('');

// 오전/오후 판별 및 원클릭 토글
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

// 역대 대국/참석 횟수(totalGames) 내림차순 정렬된 멤버 목록
const sortedMembers = computed(() => {
  return [...props.members].sort((a, b) => (b.totalGames || 0) - (a.totalGames || 0));
});

// 검색 필터링된 멤버 목록
const filteredMembers = computed(() => {
  const q = nameSearchQuery.value.trim().toLowerCase();
  if (!q) return sortedMembers.value;
  return sortedMembers.value.filter(m => m.name.toLowerCase().includes(q));
});

// 현재 선택된 날짜에 이미 등록된 본인 정보가 있는지 확인
const existingAttendee = computed<ScheduleAttendee | null>(() => {
  if (!props.dayItem || !selectedName.value) return null;
  return props.dayItem.attendees?.find(a => a.name === selectedName.value.trim()) || null;
});

// 기존 인원 시간이 있으면 제일 긴 시간 기준으로 시간 세팅
const applyLongestExistingTime = () => {
  const attendees = props.dayItem?.attendees || [];
  if (attendees.length > 0) {
    const startTimes = attendees.map(a => a.startTime || '10:00').sort();
    const earliestStart = startTimes[0] || '10:00';
    const hasOvernight = attendees.some(a => a.isOvernight) || props.dayItem?.sessionType === 'overnight';

    if (hasOvernight) {
      timeMode.value = 'overnight';
      customStartTime.value = earliestStart;
      customEndTime.value = '22:00';
      customIsOvernight.value = true;
    } else {
      const endTimes = attendees.map(a => a.endTime || '22:00').sort();
      const latestEnd = endTimes[endTimes.length - 1] || '22:00';
      if (earliestStart === '10:00' && latestEnd === '22:00') {
        timeMode.value = 'day';
        customStartTime.value = '10:00';
        customEndTime.value = '22:00';
        customIsOvernight.value = false;
      } else {
        timeMode.value = 'custom';
        customStartTime.value = earliestStart;
        customEndTime.value = latestEnd;
        customIsOvernight.value = false;
      }
    }
  } else {
    if (props.dayItem?.sessionType === 'overnight') {
      timeMode.value = 'overnight';
      customStartTime.value = '10:00';
      customEndTime.value = '22:00';
      customIsOvernight.value = true;
    } else if (props.dayItem?.sessionType === 'custom' && props.dayItem.customStartTime) {
      timeMode.value = 'custom';
      customStartTime.value = props.dayItem.customStartTime || '10:00';
      customEndTime.value = props.dayItem.customEndTime || '22:00';
      customIsOvernight.value = !!props.dayItem.customIsOvernight;
    } else {
      timeMode.value = 'day';
      customStartTime.value = '10:00';
      customEndTime.value = '22:00';
      customIsOvernight.value = false;
    }
  }
};

// 날짜나 모달 열릴 때 초기화
watch(() => [props.isOpen, props.dayItem, props.targetAttendeeName], () => {
  if (!props.isOpen || !props.dayItem) return;

  errorMessage.value = '';
  // PIN 자동 채움 방지: 항상 비워둠
  pin.value = '';

  // 대상 이름 결정: targetAttendeeName 우선 -> 없으면 빈 값으로 깨끗하게 초기화
  const nameToUse = (props.targetAttendeeName && props.targetAttendeeName.trim()) || '';
  selectedNames.value = [];

  if (nameToUse) {
    selectedName.value = nameToUse;
    nameSearchQuery.value = nameToUse;
    isCustomName.value = false;
  } else {
    selectedName.value = '';
    nameSearchQuery.value = '';
    isCustomName.value = false;
    memo.value = '';
  }

  // 기존 등록 데이터가 있으면 폼에 채우기
  const current = props.dayItem.attendees?.find(a => a.name === selectedName.value);
  if (current) {
    if (current.isCustomTime) {
      timeMode.value = 'custom';
      customStartTime.value = current.startTime || '10:00';
      customEndTime.value = current.endTime || '22:00';
      customIsOvernight.value = !!current.isOvernight;
    } else if (current.isOvernight) {
      timeMode.value = 'overnight';
      customStartTime.value = current.startTime || '10:00';
      customEndTime.value = '22:00';
      customIsOvernight.value = true;
    } else {
      timeMode.value = 'day';
      customStartTime.value = '10:00';
      customEndTime.value = '22:00';
      customIsOvernight.value = false;
    }
    memo.value = current.memo || '';
  } else {
    applyLongestExistingTime();
    memo.value = '';
  }
}, { immediate: true });

// 이름 선택 시: PIN은 자동 채우지 않으며 기존 참석 데이터 매핑
watch(selectedName, (newName) => {
  if (!newName) return;
  pin.value = '';
  const current = props.dayItem?.attendees?.find(a => a.name === newName.trim());
  if (current) {
    if (current.isCustomTime) {
      timeMode.value = 'custom';
      customStartTime.value = current.startTime || '10:00';
      customEndTime.value = current.endTime || '22:00';
      customIsOvernight.value = !!current.isOvernight;
    } else if (current.isOvernight) {
      timeMode.value = 'overnight';
      customStartTime.value = current.startTime || '10:00';
      customEndTime.value = '22:00';
      customIsOvernight.value = true;
    } else {
      timeMode.value = 'day';
      customStartTime.value = '10:00';
      customEndTime.value = '22:00';
      customIsOvernight.value = false;
    }
    memo.value = current.memo || '';
  } else {
    applyLongestExistingTime();
    // 신규 참가자 선택 시 이미 입력한 메모가 있다면 지우지 않고 유지
  }
});

// 종료 시간이 새벽(00:00~07:00)이거나 시작 시간보다 앞서면 자동으로 익일 체크
watch(customEndTime, (newEnd) => {
  if (!newEnd) return;
  const [h] = newEnd.split(':').map(Number);
  if (h >= 0 && h <= 7) {
    customIsOvernight.value = true;
  }
});

const highlightedIndex = ref(-1);
const dropdownListRef = ref<HTMLElement | null>(null);
let lastMouseX = -1;
let lastMouseY = -1;

const onDropdownItemMouseMove = (e: MouseEvent, idx: number) => {
  if (e.clientX === lastMouseX && e.clientY === lastMouseY) return;
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
  highlightedIndex.value = idx;
};

const scrollToHighlighted = () => {
  nextTick(() => {
    const container = dropdownListRef.value;
    if (!container) return;
    const items = container.querySelectorAll('.dropdown-item');
    const target = items[highlightedIndex.value] as HTMLElement;
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

const selectMember = (name: string) => {
  selectedName.value = name;
  nameSearchQuery.value = name;
  isDropdownOpen.value = false;
  isCustomName.value = false;
};

const openDropdown = () => {
  isDropdownOpen.value = true;
  const list = filteredMembers.value;
  const currentIdx = list.findIndex(m => m.name === selectedName.value);
  highlightedIndex.value = currentIdx >= 0 ? currentIdx : 0;
  scrollToHighlighted();
};

const onSearchInput = (e: Event) => {
  const val = (e.target as HTMLInputElement).value;
  nameSearchQuery.value = val;
  selectedName.value = val;
  isDropdownOpen.value = true;
  highlightedIndex.value = 0;
};

const onKeyDown = (e: KeyboardEvent) => {
  const list = filteredMembers.value;
  if (!list.length) return;

  if (!isDropdownOpen.value) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      openDropdown();
      e.preventDefault();
    }
    return;
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (highlightedIndex.value < 0) {
      highlightedIndex.value = 0;
    } else {
      highlightedIndex.value = Math.min(highlightedIndex.value + 1, list.length - 1);
    }
    scrollToHighlighted();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (highlightedIndex.value < 0) {
      highlightedIndex.value = 0;
    } else {
      highlightedIndex.value = Math.max(highlightedIndex.value - 1, 0);
    }
    scrollToHighlighted();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (highlightedIndex.value >= 0 && highlightedIndex.value < list.length) {
      selectMember(list[highlightedIndex.value].name);
    } else if (nameSearchQuery.value.trim()) {
      selectMember(nameSearchQuery.value.trim());
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    isDropdownOpen.value = false;
  }
};

// 시간 프리셋 및 빠른 스텝퍼
const setStartTimePreset = (timeStr: string) => {
  customStartTime.value = timeStr;
};

const setEndTimePreset = (timeStr: string, isNextDay?: boolean) => {
  customEndTime.value = timeStr;
  if (isNextDay !== undefined) {
    customIsOvernight.value = isNextDay;
  }
};

const adjustEndTime = (deltaMinutes: number) => {
  const [hStr, mStr] = customEndTime.value.split(':');
  let totalMin = (parseInt(hStr, 10) || 0) * 60 + (parseInt(mStr, 10) || 0) + deltaMinutes;

  if (totalMin < 0) totalMin += 24 * 60;
  if (totalMin >= 24 * 60) {
    customIsOvernight.value = true;
    totalMin = totalMin % (24 * 60);
  }

  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  customEndTime.value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const handleSubmit = () => {
  errorMessage.value = '';
  const finalPin = pin.value.trim();
  const canBypassPin = !!(props.isAdmin || props.isManager || isCreatorAddMode.value);

  if (!canBypassPin && (!finalPin || finalPin.length < 4 || finalPin.length > 8)) {
    errorMessage.value = '확인 PIN(4~8자리)을 입력해주세요.';
    return;
  }

  let isOvernight = false;
  let startTime = '10:00';
  let endTime = '22:00';
  let isCustomTime = false;

  if (timeMode.value === 'overnight') {
    isOvernight = true;
    startTime = customStartTime.value || '10:00';
    endTime = '익일';
    isCustomTime = (startTime !== '10:00');
  } else if (timeMode.value === 'custom') {
    isCustomTime = true;
    startTime = customStartTime.value;
    endTime = customEndTime.value;
    isOvernight = customIsOvernight.value;
  } else {
    isOvernight = false;
    startTime = customStartTime.value || '10:00';
    endTime = customEndTime.value || '22:00';
    isCustomTime = (startTime !== '10:00' || endTime !== '22:00');
  }

  // 당일 지정 날짜인 경우 밤샘 불가 및 종료시간 > 시작시간 검증
  const isDayOnly = props.dayItem?.adminSessionType === 'day';
  if (isDayOnly) {
    const sMin = timeStringToMinutes(startTime);
    const eMin = timeStringToMinutes(endTime);
    if (eMin <= sMin) {
      errorMessage.value = '당일 날짜는 종료 시간이 시작 시간보다 늦어야 합니다 (밤샘 불가).';
      return;
    }
    isOvernight = false;
  }

  // 다중 참가자 일괄 추가 모드
  if (isMultiSelectMode.value) {
    const namesToSubmit = [...selectedNames.value];
    const singleName = selectedName.value.trim();
    if (singleName && !namesToSubmit.includes(singleName)) {
      namesToSubmit.push(singleName);
    }

    if (namesToSubmit.length === 0) {
      errorMessage.value = '추가할 참가자를 한 명 이상 선택하거나 입력해주세요.';
      return;
    }

    if (namesToSubmit.length > 1) {
      emit('submitBatch', {
        attendees: namesToSubmit.map(name => ({
          name,
          isOvernight,
          startTime,
          endTime,
          isCustomTime,
          memo: memo.value.trim() || undefined
        })),
        pin: finalPin || 'admin_bypass'
      });
      return;
    } else {
      emit('submit', {
        name: namesToSubmit[0],
        isOvernight,
        startTime,
        endTime,
        isCustomTime,
        memo: memo.value.trim() || undefined,
        pin: finalPin || (canBypassPin ? 'admin_bypass' : '')
      });
      return;
    }
  }

  const finalName = selectedName.value.trim();
  if (!finalName) {
    errorMessage.value = '참가자 이름을 선택하거나 입력해주세요.';
    return;
  }

  emit('submit', {
    name: finalName,
    isOvernight,
    startTime,
    endTime,
    isCustomTime,
    memo: memo.value.trim() || undefined,
    pin: finalPin || (canBypassPin ? 'admin_bypass' : '')
  });
};

const handleCancel = () => {
  const canBypassPin = !!(props.isAdmin || props.isManager);
  if (!selectedName.value.trim()) {
    errorMessage.value = '취소할 참가자 이름을 선택해주세요.';
    return;
  }
  if (!canBypassPin && (!pin.value.trim() || pin.value.trim().length < 4 || pin.value.trim().length > 8)) {
    errorMessage.value = '참석을 취소하려면 확인 PIN(4~8자리)이 필요합니다.';
    return;
  }
  if (confirm(`'${selectedName.value}' 님의 참석 신청을 취소하시겠습니까?`)) {
    emit('cancel', {
      name: selectedName.value.trim(),
      pin: pin.value.trim() || (canBypassPin ? 'admin_bypass' : '')
    });
  }
};
</script>

<template>
  <Transition name="apple-modal-fade">
    <div v-if="isOpen && dayItem" class="apple-modal-backdrop" v-backdrop-dismiss="() => emit('close')">
      <div class="apple-modal-sheet">
        <!-- 헤더 -->
        <div class="sheet-header">
          <div class="header-titles">
            <span class="sheet-sub">
              {{ dayItem.date }} 
              <span v-if="dayItem.sessionType === 'overnight'" class="tag-overnight">밤샘</span>
              <span v-else class="tag-day">당일</span>
            </span>
            <h3 class="sheet-title">참석 등록 및 수정</h3>
          </div>
          <button class="btn-close" @click="emit('close')" aria-label="닫기">✕</button>
        </div>

        <!-- 에러 알림 -->
        <div v-if="errorMessage" class="error-banner">
          {{ errorMessage }}
        </div>

        <div class="sheet-body">
          <!-- 개설자/관리자 권한 안내 배너 -->
          <div v-if="isCreatorAddMode" class="creator-proxy-banner">
            <span class="creator-proxy-pill">개설자 권한</span>
            <span class="creator-proxy-text">
              {{ creatorName ? `'${creatorName}' 개설자` : '개설자' }} 권한으로 참가자를 등록합니다.
            </span>
          </div>

          <!-- 1. 참가자 선택 (단일 또는 다중 선택) -->
          <div class="form-group">
            <div class="form-label-row">
              <label class="form-label">
                참가자 {{ isMultiSelectMode ? '(다중 선택 가능)' : '' }}
              </label>
              <span v-if="isMultiSelectMode && selectedNames.length > 0" class="multi-select-count">
                {{ selectedNames.length }}명 선택됨
              </span>
            </div>

            <!-- 다중 선택된 태그 목록 (다중 모드 시) -->
            <div v-if="isMultiSelectMode && selectedNames.length > 0" class="selected-tags-box">
              <span v-for="sName in selectedNames" :key="sName" class="selected-tag">
                {{ sName }}
                <button type="button" class="btn-remove-tag" @click="removeSelectedName(sName)" title="제거">✕</button>
              </span>
            </div>

            <!-- 빠른 멤버 추천 칩 (다중 모드 시) -->
            <div v-if="isMultiSelectMode" class="quick-members-section">
              <span class="quick-members-title">멤버 빠른 선택:</span>
              <div class="quick-members-chips">
                <button
                  v-for="member in sortedMembers.slice(0, 12)"
                  :key="member.name"
                  type="button"
                  class="quick-member-chip"
                  :class="{ 'is-selected': selectedNames.includes(member.name) }"
                  @click="toggleMemberSelection(member.name)"
                >
                  {{ member.name }}
                  <span v-if="selectedNames.includes(member.name)" class="check-icon">✓</span>
                </button>
              </div>
            </div>

            <div class="autocomplete-wrapper">
              <input
                type="text"
                class="apple-input"
                :value="nameSearchQuery"
                @input="onSearchInput"
                @focus="openDropdown"
                @keydown="onKeyDown"
                @keydown.enter.prevent="isMultiSelectMode ? addCustomName() : null"
                :placeholder="isMultiSelectMode ? '이름 검색 후 선택 또는 엔터로 추가' : '이름 검색 또는 직접 입력'"
              />
              <button 
                type="button" 
                class="dropdown-toggle-btn"
                @click="isDropdownOpen ? (isDropdownOpen = false) : openDropdown()"
              >
                ▾
              </button>

              <div 
                v-if="isDropdownOpen && filteredMembers.length > 0" 
                ref="dropdownListRef"
                class="autocomplete-dropdown"
              >
                <div 
                  v-for="(member, idx) in filteredMembers" 
                  :key="member.name"
                  class="dropdown-item"
                  :class="{ 
                    selected: isMultiSelectMode ? selectedNames.includes(member.name) : selectedName === member.name,
                    highlighted: highlightedIndex === idx 
                  }"
                  @mousemove="onDropdownItemMouseMove($event, idx)"
                  @click="isMultiSelectMode ? toggleMemberSelection(member.name) : selectMember(member.name)"
                >
                  <span class="member-name">{{ member.name }}</span>
                  <span v-if="isMultiSelectMode && selectedNames.includes(member.name)" class="item-check">✓</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 2. 시간대 선택 (Apple Style 캡슐 세그먼트) -->
          <div class="form-group">
            <label class="form-label">시간대</label>
            <div class="apple-segmented-control">
              <button
                type="button"
                class="segment-btn"
                :class="{ active: timeMode === 'day' }"
                @click="timeMode = 'day'"
              >
                당일
              </button>
              <button
                v-if="isOvernightAllowed"
                type="button"
                class="segment-btn"
                :class="{ active: timeMode === 'overnight' }"
                @click="timeMode = 'overnight'"
              >
                밤샘 (10:00~익일)
              </button>
              <button
                type="button"
                class="segment-btn"
                :class="{ active: timeMode === 'custom' }"
                @click="timeMode = 'custom'"
              >
                직접 입력
              </button>
            </div>

            <!-- 당일 선택 시 시작/종료 시간 미세 조정 인라인 확장 폼 -->
            <Transition name="fade-slide">
              <div v-if="timeMode === 'day'" class="custom-time-box">
                <div class="time-picker-row">
                  <div class="time-field">
                    <div class="time-label-row">
                      <span class="time-label">시작 시간</span>
                      <button
                        type="button"
                        class="btn-ampm-toggle"
                        :class="{ 'is-pm': isPm(customStartTime) }"
                        @click="customStartTime = toggleAmPm(customStartTime)"
                      >
                        {{ isPm(customStartTime) ? '오후' : '오전' }}
                      </button>
                    </div>
                    <input
                      type="time"
                      v-model="customStartTime"
                      class="apple-time-input"
                    />
                  </div>
                  <span class="time-separator">~</span>
                  <div class="time-field">
                    <div class="time-label-row">
                      <span class="time-label">종료 시간</span>
                      <button
                        type="button"
                        class="btn-ampm-toggle"
                        :class="{ 'is-pm': isPm(customEndTime) }"
                        @click="customEndTime = toggleAmPm(customEndTime)"
                      >
                        {{ isPm(customEndTime) ? '오후' : '오전' }}
                      </button>
                    </div>
                    <input
                      type="time"
                      v-model="customEndTime"
                      class="apple-time-input"
                    />
                  </div>
                </div>
              </div>
            </Transition>

            <!-- 밤샘 선택 시 시작 시간 수정 인라인 확장 폼 -->
            <Transition name="fade-slide">
              <div v-if="timeMode === 'overnight'" class="custom-time-box">
                <div class="time-picker-row">
                  <div class="time-field">
                    <div class="time-label-row">
                      <span class="time-label">시작 시간</span>
                      <button
                        type="button"
                        class="btn-ampm-toggle"
                        :class="{ 'is-pm': isPm(customStartTime) }"
                        @click="customStartTime = toggleAmPm(customStartTime)"
                      >
                        {{ isPm(customStartTime) ? '오후' : '오전' }}
                      </button>
                    </div>
                    <input
                      type="time"
                      v-model="customStartTime"
                      class="apple-time-input"
                    />
                  </div>
                  <span class="time-separator">~</span>
                  <div class="time-field">
                    <span class="time-label">종료 시간</span>
                    <div class="time-fixed-tag">익일 (밤샘)</div>
                  </div>
                </div>

                <div class="preset-chips-section">
                  <span class="preset-label">시작 추천:</span>
                  <div class="preset-chips">
                    <button type="button" class="preset-chip" @click="setStartTimePreset('10:00')">10:00</button>
                  </div>
                </div>
              </div>
            </Transition>

            <!-- 직접 입력 시 인라인 확장 폼 -->
            <Transition name="fade-slide">
              <div v-if="timeMode === 'custom'" class="custom-time-box">
                <!-- 네이티브 시간 입력기 -->
                <div class="time-picker-row">
                  <div class="time-field">
                    <div class="time-label-row">
                      <span class="time-label">시작 시간</span>
                      <button
                        type="button"
                        class="btn-ampm-toggle"
                        :class="{ 'is-pm': isPm(customStartTime) }"
                        @click="customStartTime = toggleAmPm(customStartTime)"
                      >
                        {{ isPm(customStartTime) ? '오후' : '오전' }}
                      </button>
                    </div>
                    <input
                      type="time"
                      v-model="customStartTime"
                      class="apple-time-input"
                    />
                  </div>
                  <span class="time-separator">~</span>
                  <div class="time-field">
                    <div class="time-label-row">
                      <span class="time-label">종료 시간</span>
                      <button
                        type="button"
                        class="btn-ampm-toggle"
                        :class="{ 'is-pm': isPm(customEndTime) }"
                        @click="customEndTime = toggleAmPm(customEndTime)"
                      >
                        {{ isPm(customEndTime) ? '오후' : '오전' }}
                      </button>
                    </div>
                    <input
                      type="time"
                      v-model="customEndTime"
                      class="apple-time-input"
                    />
                  </div>
                </div>

                <!-- 빠른 시작 시간 프리셋 칩 -->
                <div class="preset-chips-section">
                  <span class="preset-label">시작 추천:</span>
                  <div class="preset-chips">
                    <button type="button" class="preset-chip" @click="setStartTimePreset('10:00')">10:00</button>
                  </div>
                </div>

                <!-- 빠른 종료 시간 프리셋 칩 -->
                <div class="preset-chips-section">
                  <span class="preset-label">종료 추천:</span>
                  <div class="preset-chips">
                    <button type="button" class="preset-chip" @click="setEndTimePreset('18:00', false)">18:00</button>
                    <button type="button" class="preset-chip" @click="setEndTimePreset('22:00', false)">22:00</button>
                    <button type="button" class="preset-chip" @click="setEndTimePreset('06:00', true)">밤샘</button>
                  </div>
                </div>

                <!-- 간편 시간 증감 스텝퍼 -->
                <div class="stepper-row">
                  <span class="preset-label">종료 조정:</span>
                  <div class="stepper-btns">
                    <button type="button" class="stepper-btn" @click="adjustEndTime(-30)">-30분</button>
                    <button type="button" class="stepper-btn" @click="adjustEndTime(30)">+30분</button>
                    <button type="button" class="stepper-btn" @click="adjustEndTime(60)">+1시간</button>
                  </div>
                </div>

                <label class="overnight-check-label">
                  <input type="checkbox" v-model="customIsOvernight" />
                  <span>익일(자정 이후) 포함</span>
                </label>
              </div>
            </Transition>
          </div>

          <!-- 3. 본인 확인용 PIN -->
          <div class="form-group">
            <div class="label-with-tip">
              <label class="form-label">
                {{ isCreatorAddMode ? '참가자 확인 PIN (4~8자리)' : '확인 PIN (4~8자리)' }}
                <span v-if="isAdmin" class="admin-no-pin-badge">관리자 (PIN 불필요)</span>
              </label>
              <span v-if="!isAdmin && isCreatorAddMode" class="input-tip">
                참가자가 직접 수정/취소 시 사용
              </span>
            </div>
            <input
              type="password"
              maxlength="8"
              inputmode="numeric"
              pattern="[0-9]*"
              class="apple-input pin-input"
              :class="{ 'input-disabled-admin': isAdmin }"
              v-model="pin"
              :disabled="isAdmin"
              :placeholder="isAdmin ? '관리자 권한 (PIN 불필요)' : '••••'"
            />
          </div>

          <!-- 4. 메모 (선택사항) -->
          <div class="form-group">
            <label class="form-label">메모 (선택)</label>
            <input
              type="text"
              class="apple-input memo-input"
              v-model="memo"
              placeholder="예시: 도착 1시간쯤 늦을수도 있음 / 퇴근 후 참가 등"
              maxlength="60"
            />
          </div>
        </div>

        <!-- 푸터 버튼 -->
        <div class="sheet-footer">
          <button
            v-if="existingAttendee"
            type="button"
            class="btn-danger-outline"
            @click="handleCancel"
          >
            참석 취소
          </button>
          <button
            type="button"
            class="btn-primary"
            @click="handleSubmit"
          >
            {{ isMultiSelectMode && selectedNames.length > 1 ? `${selectedNames.length}명 일괄 등록` : (existingAttendee ? '수정 완료' : '등록') }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.form-label-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.multi-select-count {
  font-size: 12px;
  font-weight: 700;
  color: #2563eb;
}

.selected-tags-box {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.selected-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: rgba(37, 99, 235, 0.1);
  color: #2563eb;
  padding: 3px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}
html.dark .selected-tag {
  background: rgba(59, 130, 246, 0.2);
  color: #93c5fd;
}

.btn-remove-tag {
  border: none;
  background: transparent;
  color: #64748b;
  cursor: pointer;
  padding: 0 2px;
  font-size: 11px;
  line-height: 1;
}
.btn-remove-tag:hover {
  color: #ef4444;
}

.quick-members-section {
  margin-bottom: 10px;
}

.quick-members-title {
  display: block;
  font-size: 11px;
  color: var(--text-dimmed, #64748b);
  margin-bottom: 6px;
}

.quick-members-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 80px;
  overflow-y: auto;
  padding-bottom: 2px;
}

.quick-member-chip {
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid var(--border-color, #cbd5e1);
  background: var(--card-bg-color, #ffffff);
  color: var(--text-color, #334155);
  font-size: 12px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: all 0.15s ease;
}
.quick-member-chip:hover {
  border-color: #3b82f6;
  background: rgba(59, 130, 246, 0.05);
}
.quick-member-chip.is-selected {
  background: #2563eb;
  color: #ffffff;
  border-color: #2563eb;
  font-weight: 600;
}
html.dark .quick-member-chip {
  background: #1e293b;
  color: #cbd5e1;
  border-color: #334155;
}
html.dark .quick-member-chip.is-selected {
  background: #3b82f6;
  color: #ffffff;
  border-color: #3b82f6;
}

.item-check {
  margin-left: auto;
  font-size: 12px;
  font-weight: bold;
  color: #2563eb;
}

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
  max-width: 440px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: sheetPop 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  font-family: inherit;
}

.apple-modal-sheet button,
.apple-modal-sheet input,
.apple-modal-sheet select,
.apple-modal-sheet textarea {
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
  padding: 18px 20px 14px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-color, rgba(0, 0, 0, 0.06));
}

.sheet-sub {
  font-size: 13px;
  color: var(--text-dimmed, #64748b);
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}

.sheet-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.tag-day, .tag-overnight {
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

.btn-close {
  background: transparent;
  border: none;
  font-size: 16px;
  color: var(--text-dimmed, #64748b);
  cursor: pointer;
  padding: 4px;
  line-height: 1;
  border-radius: 50%;
  transition: opacity 0.15s;
}
.btn-close:hover {
  opacity: 0.7;
}

.error-banner {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
  padding: 10px 20px;
  font-size: 13px;
  font-weight: 500;
}

.sheet-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: 65vh;
  overflow-y: auto;
}

.creator-proxy-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(37, 99, 235, 0.08);
  border: 1px solid rgba(37, 99, 235, 0.2);
  padding: 8px 12px;
  border-radius: 10px;
}
html.dark .creator-proxy-banner {
  background: rgba(59, 130, 246, 0.15);
  border-color: rgba(59, 130, 246, 0.3);
}

.creator-proxy-pill {
  font-size: 11px;
  font-weight: 700;
  background: #2563eb;
  color: #ffffff;
  padding: 2px 7px;
  border-radius: 6px;
  white-space: nowrap;
}

.creator-proxy-text {
  font-size: 12px;
  font-weight: 500;
  color: #1e40af;
  line-height: 1.4;
}
html.dark .creator-proxy-text {
  color: #93c5fd;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: relative;
}

.form-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color, #0f172a);
}

.label-with-tip {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.input-tip {
  font-size: 11px;
  color: var(--text-dimmed, #64748b);
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
  transition: all 0.15s ease;
}
.apple-input:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
}

.pin-input {
  letter-spacing: 0.25em;
  font-weight: 700;
  max-width: 110px;
  text-align: center;
  font-size: 16px;
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

.autocomplete-wrapper {
  position: relative;
}
.autocomplete-wrapper .apple-input {
  padding-right: 36px;
}

.dropdown-toggle-btn {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  background: transparent;
  border: none;
  color: var(--text-dimmed, #64748b);
  cursor: pointer;
  font-size: 13px;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
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
  font-family: inherit !important;
  transition: all 0.15s ease;
}
.btn-ampm-toggle.is-pm {
  background: rgba(139, 92, 246, 0.12);
  color: #7c3aed;
  border-color: rgba(139, 92, 246, 0.35);
}

.autocomplete-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 200px;
  overflow-y: auto;
  background: var(--card-bg-color, #ffffff);
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 12px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
  z-index: 1000;
}

.dropdown-item {
  padding: 10px 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s;
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
.member-games {
  font-size: 12px;
  color: var(--text-dimmed, #64748b);
}
.dropdown-empty {
  padding: 12px 14px;
  font-size: 12px;
  color: var(--text-dimmed, #64748b);
  text-align: center;
}

/* 캡슐형 세그먼트 컨트롤 */
.apple-segmented-control {
  display: flex;
  background: var(--input-bg-color, #f1f5f9);
  padding: 3px;
  border-radius: 12px;
  gap: 3px;
  border: 1px solid var(--border-color, #e2e8f0);
}

.segment-btn {
  flex: 1;
  border: none;
  background: transparent;
  padding: 8px 10px;
  font-size: 13px;
  font-weight: 500;
  border-radius: 9px;
  color: var(--text-dimmed, #64748b);
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}
.segment-btn.active {
  background: var(--card-bg-color, #ffffff);
  color: var(--text-color, #0f172a);
  font-weight: 600;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
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

.preset-chips-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.preset-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-dimmed, #64748b);
  font-family: inherit;
}

.preset-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.preset-chip {
  background: var(--card-bg-color, #ffffff);
  border: 1px solid var(--border-color, #e2e8f0);
  color: var(--text-color, #334155);
  font-size: 11px;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s ease;
}
.preset-chip:hover {
  background: rgba(59, 130, 246, 0.08);
  border-color: #3b82f6;
  color: #2563eb;
}

.stepper-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.stepper-btns {
  display: flex;
  gap: 5px;
}

.stepper-btn {
  background: var(--card-bg-color, #ffffff);
  border: 1px solid var(--border-color, #cbd5e1);
  color: var(--text-color, #1e293b);
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s ease;
}
.stepper-btn:hover {
  background: rgba(59, 130, 246, 0.1);
  color: #2563eb;
  border-color: #2563eb;
}

.time-separator {
  color: var(--text-dimmed, #64748b);
  font-weight: 700;
  margin-top: 16px;
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

.sheet-footer {
  padding: 14px 20px 18px;
  border-top: 1px solid var(--border-color, rgba(0, 0, 0, 0.06));
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.btn-primary {
  flex: 1;
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

.btn-danger-outline {
  background: transparent;
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.3);
  padding: 12px 16px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease;
}
.btn-danger-outline:hover {
  background: rgba(239, 68, 68, 0.08);
}
</style>
