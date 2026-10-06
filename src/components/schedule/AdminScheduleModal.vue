<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import type { ScheduleDayItem, SessionType } from '@/types/schedule';
import { parseScheduleNoticeText } from '@/utils/scheduleParser';
import {
  fetchAdminPasscodes,
  addAdminPasscode,
  deleteAdminPasscodeById,
  clearAllAdminPasscodes,
  type AdminPasscodeInfo
} from '@/services/scheduleService';

const props = defineProps<{
  isOpen: boolean;
  currentMonth: string; // "YYYY-MM"
  existingDates: ScheduleDayItem[];
  adminToken?: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'save', dates: ScheduleDayItem[]): void;
}>();

const editMode = ref<'visual' | 'text' | 'passcode'>('visual');
const rawText = ref('');
const errorMessage = ref('');
const registeredPasscodes = ref<AdminPasscodeInfo[]>([]);
const isLoadingPasscodes = ref(false);
const newPasscodeLabel = ref('');
const newPasscode = ref('');
const passcodeSuccessMsg = ref('');
const isUpdatingPasscode = ref(false);
const isDeletingPasscode = ref(false);

// 이번 달 일수 계산
const daysInCurrentMonth = computed(() => {
  const [y, m] = props.currentMonth.split('-').map(Number);
  return new Date(y, m, 0).getDate();
});

// 이번 달 1일의 시작 요일 (0: 일, 1: 월, ..., 6: 토)
const firstDayOfWeek = computed(() => {
  const [y, m] = props.currentMonth.split('-').map(Number);
  return new Date(y, m - 1, 1).getDay();
});

// 특정 일자 d의 요일 인덱스
const getDayOfWeek = (d: number) => {
  const [y, m] = props.currentMonth.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
};

// 오늘 날짜 여부 확인
const isToday = (d: number) => {
  const now = new Date();
  const [y, m] = props.currentMonth.split('-').map(Number);
  return (
    now.getFullYear() === y &&
    now.getMonth() + 1 === m &&
    now.getDate() === d
  );
};

// 날짜별 상태 맵 (1 ~ 31): 'none' | SessionType
const dayStatusMap = ref<Record<number, 'none' | SessionType>>({});

// 모달 열릴 때 기존 날짜들로 상태 초기화
watch(() => props.isOpen, (open) => {
  if (!open) return;
  errorMessage.value = '';
  rawText.value = '';
  editMode.value = 'visual';

  const map: Record<number, 'none' | SessionType> = {};
  for (let d = 1; d <= daysInCurrentMonth.value; d++) {
    map[d] = 'none';
  }

  // 기존 등록된 날짜 반영 (관리자 지정 속성 우선 복원)
  for (const item of props.existingDates) {
    const parts = item.date.split('-');
    if (parts.length === 3) {
      const d = parseInt(parts[2], 10);
      if (d >= 1 && d <= daysInCurrentMonth.value) {
        map[d] = item.adminSessionType || item.sessionType;
      }
    }
  }

  dayStatusMap.value = map;
}, { immediate: true });

// 날짜 칩 클릭 시 상태 순환: 미등록 -> 당일 -> 밤샘 -> 미등록
const toggleDayStatus = (day: number) => {
  const current = dayStatusMap.value[day] || 'none';
  if (current === 'none') {
    dayStatusMap.value[day] = 'day';
  } else if (current === 'day') {
    dayStatusMap.value[day] = 'overnight';
  } else {
    dayStatusMap.value[day] = 'none';
  }
};

// 텍스트 파싱 결과를 비주얼 맵에 즉시 반영
const applyParsedText = () => {
  if (!rawText.value.trim()) {
    errorMessage.value = '텍스트를 입력해주세요.';
    return;
  }

  const parsed = parseScheduleNoticeText(rawText.value);
  const newMap: Record<number, 'none' | 'day' | 'overnight'> = {};
  for (let d = 1; d <= daysInCurrentMonth.value; d++) {
    newMap[d] = 'none';
  }

  for (const d of parsed.dayDates) {
    if (d >= 1 && d <= daysInCurrentMonth.value) {
      newMap[d] = 'day';
    }
  }
  for (const d of parsed.overnightDates) {
    if (d >= 1 && d <= daysInCurrentMonth.value) {
      newMap[d] = 'overnight';
    }
  }

  dayStatusMap.value = newMap;
  editMode.value = 'visual';
  errorMessage.value = '';
};

// 현재 선택된 총 날짜 통계
const selectedCounts = computed(() => {
  let dayCount = 0;
  let overnightCount = 0;
  for (let d = 1; d <= daysInCurrentMonth.value; d++) {
    const st = dayStatusMap.value[d];
    if (st === 'day') dayCount++;
    if (st === 'overnight') overnightCount++;
  }
  return {
    dayCount,
    overnightCount,
    total: dayCount + overnightCount
  };
});

// 저장 적용
const handleApply = () => {
  const [yStr, mStr] = props.currentMonth.split('-');
  const existingMap = new Map<string, ScheduleDayItem>();
  for (const item of props.existingDates) {
    existingMap.set(item.date, item);
  }

  const result: ScheduleDayItem[] = [];

  for (let d = 1; d <= daysInCurrentMonth.value; d++) {
    const status = dayStatusMap.value[d];
    if (status && status !== 'none') {
      const dateStr = `${yStr}-${mStr.padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const prev = existingMap.get(dateStr);

      result.push({
        date: dateStr,
        sessionType: prev?.sessionType || status,
        adminSessionType: status === 'overnight' ? 'overnight' : 'day',
        customStartTime: prev?.customStartTime,
        customEndTime: prev?.customEndTime,
        customIsOvernight: prev?.customIsOvernight,
        creator: prev?.creator,
        creatorPinHash: prev?.creatorPinHash,
        note: prev?.note || '',
        isClosed: prev?.isClosed || false,
        attendees: prev ? [...prev.attendees] : []
      });
    }
  }

  emit('save', result);
};

const clearAll = () => {
  const map: Record<number, 'none' | SessionType> = {};
  for (let d = 1; d <= daysInCurrentMonth.value; d++) {
    map[d] = 'none';
  }
  dayStatusMap.value = map;
};

// 관리자 코드 목록 로드
const loadPasscodes = async () => {
  isLoadingPasscodes.value = true;
  try {
    const res = await fetchAdminPasscodes();
    if (res.success) {
      registeredPasscodes.value = res.passcodes;
    }
  } catch (e) {
    console.error('관리자 코드 목록 로드 실패:', e);
  } finally {
    isLoadingPasscodes.value = false;
  }
};

watch(() => editMode.value, (mode) => {
  if (mode === 'passcode') {
    passcodeSuccessMsg.value = '';
    errorMessage.value = '';
    loadPasscodes();
  }
});

// 신규 관리자 인증 코드 등록
const handleAddPasscode = async () => {
  errorMessage.value = '';
  passcodeSuccessMsg.value = '';
  const label = newPasscodeLabel.value.trim() || '운영진';
  const code = newPasscode.value.trim();

  if (!code || code.length < 4) {
    errorMessage.value = '인증 코드는 4자리 이상이어야 합니다.';
    return;
  }

  isUpdatingPasscode.value = true;
  try {
    const res = await addAdminPasscode(label, code);
    if (res.success) {
      passcodeSuccessMsg.value = res.message || `'${label}' 관리자 코드가 등록되었습니다.`;
      newPasscodeLabel.value = '';
      newPasscode.value = '';
      await loadPasscodes();
    } else {
      errorMessage.value = res.error || '인증 코드 등록에 실패했습니다.';
    }
  } catch (e: any) {
    errorMessage.value = e.message || '인증 코드 등록 중 오류가 발생했습니다.';
  } finally {
    isUpdatingPasscode.value = false;
  }
};

// 특정 관리자 인증 코드 삭제
const handleDeleteSpecificPasscode = async (id: string, label: string) => {
  if (!confirm(`'${label}' 관리자 인증 코드를 삭제하시겠습니까?`)) {
    return;
  }
  errorMessage.value = '';
  passcodeSuccessMsg.value = '';
  isDeletingPasscode.value = true;
  try {
    const res = await deleteAdminPasscodeById(id);
    if (res.success) {
      passcodeSuccessMsg.value = res.message || '선택한 인증 코드가 삭제되었습니다.';
      await loadPasscodes();
    } else {
      errorMessage.value = res.error || '인증 코드 삭제에 실패했습니다.';
    }
  } catch (e: any) {
    errorMessage.value = e.message || '인증 코드 삭제 중 오류가 발생했습니다.';
  } finally {
    isDeletingPasscode.value = false;
  }
};

// 모든 관리자 인증 코드 일괄 삭제 (구글 로그인 전용 모드 전환)
const handleClearAllPasscodes = async () => {
  if (!confirm('정말 모든 관리자 인증 코드를 삭제하시겠습니까?\n\n삭제 시 모든 암호 인증이 차단되며, 오직 구글 관리자 계정(스프레드시트 소유자/편집자) 로그인으로만 관리 기능을 사용할 수 있는 "구글 로그인 전용 보안 모드"로 전환됩니다.')) {
    return;
  }
  errorMessage.value = '';
  passcodeSuccessMsg.value = '';
  isDeletingPasscode.value = true;
  try {
    const res = await clearAllAdminPasscodes();
    if (res.success) {
      passcodeSuccessMsg.value = res.message || '모든 관리자 인증 코드가 삭제되었습니다.';
      await loadPasscodes();
    } else {
      errorMessage.value = res.error || '인증 코드 삭제에 실패했습니다.';
    }
  } catch (e: any) {
    errorMessage.value = e.message || '인증 코드 삭제 중 오류가 발생했습니다.';
  } finally {
    isDeletingPasscode.value = false;
  }
};
</script>

<template>
  <Transition name="apple-modal-fade">
    <div v-if="isOpen" class="apple-modal-backdrop" @click.self="emit('close')">
      <div class="apple-modal-sheet">
        <!-- 모달 헤더 -->
        <div class="sheet-header">
          <div>
            <span class="sheet-sub">{{ currentMonth }} 관리자 모드</span>
            <h3 class="sheet-title">가능한 날짜 풀 수정</h3>
          </div>
          <button class="btn-close" @click="emit('close')" aria-label="닫기">✕</button>
        </div>

        <!-- 에러 배너 -->
        <div v-if="errorMessage" class="error-banner">
          {{ errorMessage }}
        </div>

        <!-- 모드 전환 세그먼트 -->
        <div class="mode-tabs-wrapper">
          <div class="apple-segmented-control">
            <button
              type="button"
              class="segment-btn"
              :class="{ active: editMode === 'visual' }"
              @click="editMode = 'visual'"
            >
              달력 칩
            </button>
            <button
              type="button"
              class="segment-btn"
              :class="{ active: editMode === 'text' }"
              @click="editMode = 'text'"
            >
              텍스트로 입력
            </button>
            <button
              type="button"
              class="segment-btn"
              :class="{ active: editMode === 'passcode' }"
              @click="editMode = 'passcode'"
            >
              🔑 인증 코드 관리
            </button>
          </div>
        </div>

        <div class="sheet-body">
          <!-- 1. 비주얼 칩 모드 -->
          <div v-if="editMode === 'visual'" class="visual-editor-container">
            <div class="guide-bar">
              <span class="guide-text">날짜를 클릭하여 상태를 변경하세요:</span>
              <div class="guide-legend">
                <span class="legend-item"><span class="dot dot-none"></span> 미등록</span>
                <span class="legend-item"><span class="dot dot-day"></span> 당일</span>
                <span class="legend-item"><span class="dot dot-overnight"></span> 밤샘</span>
              </div>
            </div>

            <!-- 실제 달력 요일 헤더 -->
            <div class="calendar-chips-week-header">
              <span class="week-chip-title sun">일</span>
              <span class="week-chip-title">월</span>
              <span class="week-chip-title">화</span>
              <span class="week-chip-title">수</span>
              <span class="week-chip-title">목</span>
              <span class="week-chip-title">금</span>
              <span class="week-chip-title sat">토</span>
            </div>

            <!-- 실제 달력 요일 위치 기반 칩 그리드 -->
            <div class="day-chips-grid">
              <!-- 1일 시작 전 빈 요일 칸 -->
              <div
                v-for="emptyIdx in firstDayOfWeek"
                :key="'empty-' + emptyIdx"
                class="day-chip-empty"
              ></div>

              <!-- 1일 ~ 말일 칩 -->
              <button
                v-for="d in daysInCurrentMonth"
                :key="d"
                type="button"
                class="day-chip-btn"
                :class="{
                  'is-day': dayStatusMap[d] === 'day',
                  'is-overnight': dayStatusMap[d] === 'overnight',
                  'is-none': dayStatusMap[d] === 'none' || !dayStatusMap[d],
                  'is-sun': getDayOfWeek(d) === 0,
                  'is-sat': getDayOfWeek(d) === 6,
                  'is-today': isToday(d)
                }"
                @click="toggleDayStatus(d)"
                :title="`${d}일: 클릭하여 상태 변경 (미등록 → 당일 → 밤샘)`"
              >
                <div class="chip-top-row">
                  <span class="chip-number">{{ d }}</span>
                  <span v-if="isToday(d)" class="chip-today-dot" title="오늘"></span>
                </div>
                <span class="chip-status-text">
                  {{ dayStatusMap[d] === 'day' ? '당일' : (dayStatusMap[d] === 'overnight' ? '밤샘' : '-') }}
                </span>
              </button>
            </div>

            <div class="visual-toolbar">
              <span class="summary-text">
                선택됨: 당일 {{ selectedCounts.dayCount }}개, 밤샘 {{ selectedCounts.overnightCount }}개 (총 {{ selectedCounts.total }}개)
              </span>
              <button type="button" class="btn-text-danger" @click="clearAll">전체 해제</button>
            </div>
          </div>

          <!-- 2. 텍스트로 입력 모드 -->
          <div v-else-if="editMode === 'text'" class="text-editor-container">
            <p class="text-guide">
              가능한 날짜 텍스트를 그대로 붙여넣으면 날짜를 자동 추출합니다:
            </p>
            <textarea
              class="apple-textarea"
              v-model="rawText"
              rows="5"
              placeholder="예:&#10;당일만 가능 : 1일 6일 21일 23일 26일 31일&#10;밤샘도 가능 : 3일 8~10일 13일 16~18일 28일"
            ></textarea>
            <button type="button" class="btn-parse-apply" @click="applyParsedText">
              텍스트 파싱하여 칩에 반영
            </button>
          </div>

          <!-- 3. 관리자 인증 코드 설정 모드 -->
          <div v-else class="passcode-editor-container">
            <p class="text-guide">
              관리자마다 개별 인증 코드를 발급할 수 있습니다. 등록된 코드가 하나도 없으면 <strong>구글 계정 로그인으로만</strong> 관리자 인증이 가능한 보안 모드가 됩니다.
            </p>

            <div v-if="passcodeSuccessMsg" class="success-banner">
              {{ passcodeSuccessMsg }}
            </div>

            <!-- 신규 관리자 코드 등록 폼 -->
            <div class="passcode-add-box">
              <span class="sub-section-title">➕ 새 관리자 코드 발급</span>
              <div class="passcode-form-inputs">
                <input
                  type="text"
                  v-model="newPasscodeLabel"
                  class="apple-input input-label"
                  placeholder="관리자 이름"
                  maxlength="20"
                />
                <input
                  type="text"
                  v-model="newPasscode"
                  class="apple-input input-code"
                  placeholder="인증 코드 (4자리 이상)"
                  maxlength="24"
                  @keyup.enter="handleAddPasscode"
                />
                <button
                  type="button"
                  class="btn-passcode-save"
                  :disabled="isUpdatingPasscode || isDeletingPasscode"
                  @click="handleAddPasscode"
                >
                  {{ isUpdatingPasscode ? '등록 중...' : '코드 추가' }}
                </button>
              </div>
            </div>

            <!-- 등록된 관리자 목록 -->
            <div class="registered-passcodes-section">
              <div class="section-title-row">
                <span class="sub-section-title">등록된 관리자 코드 ({{ registeredPasscodes.length }}개)</span>
                <button
                  type="button"
                  class="btn-refresh-sm"
                  :disabled="isLoadingPasscodes"
                  @click="loadPasscodes"
                  title="새로고침"
                >
                  ↻
                </button>
              </div>

              <div v-if="isLoadingPasscodes" class="passcode-loading">
                목록을 불러오는 중...
              </div>

              <div v-else-if="registeredPasscodes.length === 0" class="passcode-empty-box">
                <p class="empty-text">등록된 인증 코드가 없습니다.</p>
                <span class="empty-sub">구글 스프레드시트 관리자 계정 로그인으로만 관리 기능을 사용할 수 있습니다.</span>
              </div>

              <div v-else class="passcode-cards-list">
                <div
                  v-for="item in registeredPasscodes"
                  :key="item.id"
                  class="passcode-item-card"
                >
                  <div class="item-info">
                    <div class="item-label-row">
                      <span class="badge-admin">관리자</span>
                      <strong class="item-name">{{ item.label }}</strong>
                    </div>
                    <span class="item-date">
                      등록일: {{ new Date(item.createdAt).toLocaleDateString('ko-KR') }}
                    </span>
                  </div>
                  <button
                    type="button"
                    class="btn-delete-item"
                    :disabled="isDeletingPasscode"
                    @click="handleDeleteSpecificPasscode(item.id, item.label)"
                    title="이 코드 삭제"
                  >
                    삭제
                  </button>
                </div>
              </div>
            </div>

            <!-- 위험 구역: 모든 코드 일괄 삭제 -->
            <div v-if="registeredPasscodes.length > 0" class="passcode-danger-box">
              <span class="danger-tip">모든 코드를 삭제하면 비밀번호를 통한 로그인이 차단되며 구글 로그인만 허용됩니다.</span>
              <button
                type="button"
                class="btn-passcode-delete"
                :disabled="isDeletingPasscode || isUpdatingPasscode"
                @click="handleClearAllPasscodes"
              >
                {{ isDeletingPasscode ? '삭제 중...' : '모든 인증 코드 일괄 삭제 (구글 로그인 전용 전환)' }}
              </button>
            </div>

            <p class="passcode-security-note">
              보안 안내: 인증 코드는 Cloudflare KV에 안전하게 보관되며, 브라우저 로컬 저장소에는 기록되지 않습니다.
            </p>
          </div>
        </div>

        <!-- 푸터 버튼 -->
        <div class="sheet-footer">
          <button type="button" class="btn-cancel" @click="emit('close')">
            닫기
          </button>
          <button v-if="editMode !== 'passcode'" type="button" class="btn-primary" @click="handleApply">
            {{ selectedCounts.total }}개 일정으로 적용
          </button>
          <button v-else type="button" class="btn-primary" @click="emit('close')">
            완료
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
  max-width: 520px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: sheetPop 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  font-family: 'Noto Sans KR', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.apple-modal-sheet button,
.apple-modal-sheet input,
.apple-modal-sheet select,
.apple-modal-sheet textarea {
  font-family: 'Noto Sans KR', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
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
  color: #2563eb;
  font-weight: 600;
  display: block;
  margin-bottom: 2px;
}

.sheet-title {
  margin: 0;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.02em;
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

.error-banner {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
  padding: 10px 20px;
  font-size: 13px;
  font-weight: 500;
}

.mode-tabs-wrapper {
  padding: 12px 20px 0;
}

.apple-segmented-control {
  display: flex;
  background: var(--input-bg-color, #f1f5f9);
  padding: 3px;
  border-radius: 12px;
  gap: 2px;
  border: 1px solid var(--border-color, #e2e8f0);
}

.segment-btn {
  flex: 1;
  border: none;
  background: transparent;
  padding: 7px 10px;
  font-size: 13px;
  font-weight: 500;
  border-radius: 9px;
  color: var(--text-dimmed, #64748b);
  cursor: pointer;
  transition: all 0.15s ease;
}
.segment-btn.active {
  background: var(--card-bg-color, #ffffff);
  color: var(--text-color, #0f172a);
  font-weight: 600;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
}

.sheet-body {
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-height: 65vh;
  overflow-y: auto;
}

.guide-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  margin-bottom: 10px;
  flex-wrap: wrap;
  gap: 6px;
}

.guide-text {
  color: var(--text-dimmed, #64748b);
  font-weight: 500;
}

.guide-legend {
  display: flex;
  gap: 8px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.dot-none { background: #cbd5e1; }
.dot-day { background: #2563eb; }
.dot-overnight { background: #7c3aed; }

/* 요일 헤더 */
.calendar-chips-week-header {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 6px;
  margin-bottom: 6px;
  padding: 0 2px;
}

.week-chip-title {
  text-align: center;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-dimmed, #64748b);
  font-family: 'Noto Sans KR', sans-serif !important;
}
.week-chip-title.sun {
  color: #ef4444;
}
.week-chip-title.sat {
  color: #3b82f6;
}

/* 1일~31일 칩 그리드 (실제 달력 위치) */
.day-chips-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 6px;
}

.day-chip-empty {
  min-height: 52px;
  border-radius: 10px;
  background: transparent;
  pointer-events: none;
}

.day-chip-btn {
  border: 1px solid var(--border-color, #e2e8f0);
  background: var(--input-bg-color, #f8fafc);
  color: var(--text-color, #0f172a);
  border-radius: 10px;
  padding: 6px 3px;
  min-height: 52px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: 'Noto Sans KR', sans-serif !important;
}
.day-chip-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06);
}

.chip-top-row {
  display: flex;
  align-items: center;
  gap: 3px;
}

.chip-today-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #2563eb;
}

.day-chip-btn.is-sun .chip-number {
  color: #ef4444;
}
.day-chip-btn.is-sat .chip-number {
  color: #3b82f6;
}

.day-chip-btn.is-day {
  background: rgba(59, 130, 246, 0.12);
  border-color: #3b82f6;
  color: #2563eb;
  font-weight: 700;
}
.day-chip-btn.is-day .chip-number {
  color: #2563eb;
}

.day-chip-btn.is-overnight {
  background: rgba(139, 92, 246, 0.14);
  border-color: #8b5cf6;
  color: #7c3aed;
  font-weight: 700;
}
.day-chip-btn.is-overnight .chip-number {
  color: #7c3aed;
}

.day-chip-btn.is-none {
  opacity: 0.75;
}

.day-chip-btn.is-today {
  box-shadow: inset 0 0 0 1.5px rgba(59, 130, 246, 0.6);
}

.chip-number {
  font-size: 13px;
  font-weight: 700;
  line-height: 1.2;
}

.chip-status-text {
  font-size: 10px;
  line-height: 1.2;
}

.visual-toolbar {
  margin-top: 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
}

.summary-text {
  color: var(--text-dimmed, #64748b);
  font-weight: 600;
}

.btn-text-danger {
  background: transparent;
  border: none;
  color: #ef4444;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.btn-text-danger:hover {
  text-decoration: underline;
}

/* 텍스트 모드 */
.text-editor-container {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.text-guide {
  font-size: 13px;
  color: var(--text-dimmed, #64748b);
  margin: 0;
}

.apple-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid var(--border-color, #cbd5e1);
  background: var(--input-bg-color, #f8fafc);
  color: var(--text-color, #0f172a);
  font-size: 13px;
  line-height: 1.5;
  outline: none;
  resize: vertical;
  transition: all 0.15s ease;
}
.apple-textarea:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
}

.btn-parse-apply {
  background: var(--input-bg-color, #f1f5f9);
  border: 1px solid var(--border-color, #cbd5e1);
  color: var(--text-color, #0f172a);
  padding: 10px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.btn-parse-apply:hover {
  background: var(--card-bg-color, #ffffff);
}

.sheet-footer {
  padding: 14px 20px 18px;
  border-top: 1px solid var(--border-color, rgba(0, 0, 0, 0.06));
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.btn-primary {
  background: #2563eb;
  color: #ffffff;
  border: none;
  padding: 11px 18px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s ease;
}
.btn-primary:hover {
  opacity: 0.9;
}

.btn-cancel {
  background: transparent;
  color: var(--text-dimmed, #64748b);
  border: 1px solid var(--border-color, #cbd5e1);
  padding: 11px 16px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

/* 관리자 인증 코드 설정 모드 */
.passcode-editor-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.success-banner {
  background: rgba(34, 197, 94, 0.12);
  color: #16a34a;
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
}

.sub-section-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-color, #0f172a);
}

.passcode-add-box {
  background: var(--input-bg-color, #f8fafc);
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 12px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.passcode-form-inputs {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}

.input-label {
  flex: 1.2;
  min-width: 130px;
}

.input-code {
  flex: 1;
  min-width: 110px;
}

.apple-input {
  padding: 9px 12px;
  border-radius: 9px;
  border: 1px solid var(--border-color, #cbd5e1);
  background: var(--card-bg-color, #ffffff);
  color: var(--text-color, #0f172a);
  font-size: 13px;
  outline: none;
  transition: all 0.15s ease;
}
.apple-input:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
}

.btn-passcode-save {
  background: #2563eb;
  color: #ffffff;
  border: none;
  padding: 9px 14px;
  border-radius: 9px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: opacity 0.15s ease;
}
.btn-passcode-save:hover:not(:disabled) {
  opacity: 0.9;
}
.btn-passcode-save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.registered-passcodes-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
}

.section-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.btn-refresh-sm {
  background: transparent;
  border: none;
  color: var(--text-dimmed, #64748b);
  cursor: pointer;
  font-size: 15px;
  padding: 2px 6px;
  border-radius: 4px;
}
.btn-refresh-sm:hover {
  color: var(--text-color, #0f172a);
}

.passcode-loading {
  font-size: 12px;
  color: var(--text-dimmed, #64748b);
  text-align: center;
  padding: 12px;
}

.passcode-empty-box {
  background: rgba(59, 130, 246, 0.05);
  border: 1px dashed rgba(59, 130, 246, 0.25);
  border-radius: 12px;
  padding: 16px 12px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.empty-icon {
  font-size: 20px;
}
.empty-text {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color, #0f172a);
}
.empty-sub {
  font-size: 11px;
  color: var(--text-dimmed, #64748b);
  line-height: 1.4;
}

.passcode-cards-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 150px;
  overflow-y: auto;
}

.passcode-item-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--input-bg-color, #f8fafc);
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 10px;
}

.item-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.item-label-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.badge-admin {
  background: #3b82f6;
  color: #ffffff;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
}

.item-name {
  font-size: 13px;
  color: var(--text-color, #0f172a);
}

.item-date {
  font-size: 11px;
  color: var(--text-dimmed, #64748b);
}

.btn-delete-item {
  background: transparent;
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.3);
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-delete-item:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.1);
}

.passcode-danger-box {
  margin-top: 6px;
  padding: 10px 12px;
  background: rgba(239, 68, 68, 0.06);
  border: 1px dashed rgba(239, 68, 68, 0.25);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.danger-tip {
  font-size: 11px;
  color: var(--text-dimmed, #64748b);
  line-height: 1.4;
}

.btn-passcode-delete {
  align-self: flex-start;
  background: transparent;
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.4);
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-passcode-delete:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.1);
}

.btn-passcode-delete:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.passcode-security-note {
  font-size: 12px;
  color: var(--text-dimmed, #64748b);
  line-height: 1.5;
  margin: 4px 0 0;
}
</style>
