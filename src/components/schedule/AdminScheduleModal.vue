<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import type { ScheduleDayItem, SessionType, ScheduleHistoryItem, ScheduleActionType, ScheduleCommitItem } from '@/types/schedule';
import { parseScheduleNoticeText } from '@/utils/scheduleParser';
import {
  fetchAdminPasscodes,
  addAdminPasscode,
  deleteAdminPasscodeById,
  clearAllAdminPasscodes,
  adminForceResetUserPin,
  fetchScheduleHistory,
  fetchScheduleCommits,
  rollbackSchedule,
  type AdminPasscodeInfo
} from '@/services/scheduleService';
import { logoutGoogle } from '@/utils/googleSheets';

const props = defineProps<{
  isOpen: boolean;
  currentMonth: string; // "YYYY-MM"
  existingDates: ScheduleDayItem[];
  sessionMap?: Map<string, number>;
  adminToken?: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'save', dates: ScheduleDayItem[]): void;
  (e: 'adminLogout'): void;
}>();

type PrimaryTab = 'schedule' | 'tools';
type SubTab = 'visual' | 'text' | 'passcode' | 'pin' | 'history' | 'rollback';

const primaryTab = ref<PrimaryTab>('schedule');
const editMode = ref<SubTab>('visual');

const switchPrimaryTab = (tab: PrimaryTab) => {
  primaryTab.value = tab;
  if (tab === 'schedule') {
    if (editMode.value !== 'visual' && editMode.value !== 'text') {
      editMode.value = 'visual';
    }
  } else {
    if (editMode.value === 'visual' || editMode.value === 'text') {
      editMode.value = 'passcode';
    }
  }
};

const isGoogleAdmin = computed(() => {
  return typeof window !== 'undefined' && localStorage.getItem('google_is_logged_in') === 'true';
});

const handleAdminLogout = () => {
  if (!confirm('관리자 세션에서 로그아웃하시겠습니까?')) {
    return;
  }
  try {
    logoutGoogle();
  } catch (e) {}

  localStorage.removeItem('google_is_logged_in');
  localStorage.removeItem('google_access_token');
  localStorage.removeItem('google_refresh_cipher');
  localStorage.removeItem('google_token_expires_at');
  sessionStorage.removeItem('schedule_admin_passcode');
  sessionStorage.removeItem('schedule_admin_verified');
  sessionStorage.removeItem('schedule_admin_attendee_name');

  window.dispatchEvent(new CustomEvent('mahjong_admin_auth_changed'));
  emit('adminLogout');
  emit('close');
};
const rawText = ref('');
const errorMessage = ref('');
const registeredPasscodes = ref<AdminPasscodeInfo[]>([]);
const isLoadingPasscodes = ref(false);
const newPasscodeLabel = ref('');
const newPasscode = ref('');
const showNewPasscode = ref(false);
const passcodeSuccessMsg = ref('');
const isUpdatingPasscode = ref(false);
const isDeletingPasscode = ref(false);

// 일정 변동 기록 (감사 로그) 상태
const historyList = ref<ScheduleHistoryItem[]>([]);
const isLoadingHistory = ref(false);
const historyFilter = ref<string>('all');

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
  primaryTab.value = 'schedule';
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
        isConfirmed: prev?.isConfirmed || false,
        sessionNumber: prev?.sessionNumber,
        sheetTitle: prev?.sheetTitle,
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
  } else if (mode === 'pin') {
    pinSuccessMsg.value = '';
    pinErrorMessage.value = '';
    errorMessage.value = '';
  } else if (mode === 'history') {
    errorMessage.value = '';
    loadHistory();
  } else if (mode === 'rollback') {
    errorMessage.value = '';
    rollbackSuccessMsg.value = '';
    rollbackErrorMsg.value = '';
    loadCommits();
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

// ==========================================
// 참가자 PIN 관리 로직
// ==========================================
const targetAttendeeName = ref('');
const selectedAttendeeSelect = ref('');
const targetPinResetDate = ref('');
const targetNewPin = ref('');
const targetNewPinConfirm = ref('');
const isResettingPin = ref(false);
const pinSuccessMsg = ref('');
const pinErrorMessage = ref('');

// 현재 월의 모든 참석자 및 개설자 고유 이름 목록 추출
const attendeesWithPins = computed(() => {
  const set = new Set<string>();
  for (const item of props.existingDates) {
    if (item.creator && item.creator.trim()) {
      set.add(item.creator.trim());
    }
    if (item.attendees) {
      for (const att of item.attendees) {
        if (att.name && att.name.trim()) {
          set.add(att.name.trim());
        }
      }
    }
  }
  return Array.from(set).sort();
});

const onSelectAttendee = () => {
  if (selectedAttendeeSelect.value) {
    targetAttendeeName.value = selectedAttendeeSelect.value;
  }
};

// 대상 참가자가 바뀌면 적용 대상 회차를 항상 전체 일괄 변경('')으로 자동 초기화
watch(targetAttendeeName, () => {
  targetPinResetDate.value = '';
});

// 선택된 참가자가 실제로 참석 신청했거나 개설한 회차 목록만 필터링
const targetAttendeeExistingDates = computed(() => {
  const name = targetAttendeeName.value.trim();
  if (!name) return [];
  return props.existingDates
    .filter(d => (d.creator && d.creator.trim() === name) || d.attendees?.some(a => a.name?.trim() === name))
    .sort((a, b) => a.date.localeCompare(b.date));
});

// 회차 번호 조회 헬퍼
const getSessionNumber = (dateStr: string): number | null => {
  return props.sessionMap?.get(dateStr) || null;
};

// 칩용 날짜 포맷 (예: 23일(금))
const formatChipDate = (dateStr: string): string => {
  const parts = dateStr.split('-');
  if (parts.length < 3) return dateStr;
  const [y, m, d] = parts.map(Number);
  const dayOfWeekNames = ['일', '월', '화', '수', '목', '금', '토'];
  const dow = dayOfWeekNames[new Date(y, m - 1, d).getDay()];
  return `${d}일(${dow})`;
};

// 관리자 권한으로 참가자 PIN 강제 재설정
const handleForceResetPin = async () => {
  pinErrorMessage.value = '';
  pinSuccessMsg.value = '';

  const name = targetAttendeeName.value.trim();
  const pin = targetNewPin.value.trim();
  const confirmPin = targetNewPinConfirm.value.trim();

  if (!name) {
    pinErrorMessage.value = '대상 참가자 이름을 입력하거나 선택해주세요.';
    return;
  }
  if (!pin || pin.length < 4 || pin.length > 8) {
    pinErrorMessage.value = '새 PIN은 4~8자리 숫자여야 합니다.';
    return;
  }
  if (!/^\d+$/.test(pin)) {
    pinErrorMessage.value = 'PIN은 숫자만 입력 가능합니다.';
    return;
  }
  if (pin !== confirmPin) {
    pinErrorMessage.value = '새 PIN과 확인 입력이 일치하지 않습니다.';
    return;
  }

  isResettingPin.value = true;
  try {
    const res = await adminForceResetUserPin(
      props.currentMonth,
      name,
      pin,
      props.adminToken,
      targetPinResetDate.value || undefined
    );
    if (res.success) {
      const scopeMsg = targetPinResetDate.value ? `${targetPinResetDate.value} 회차` : '이번 달 전체 회차';
      pinSuccessMsg.value = `'${name}' 님의 ${scopeMsg} PIN이 성공적으로 변경되었습니다.`;
      targetNewPin.value = '';
      targetNewPinConfirm.value = '';
      if (res.data?.dates) {
        emit('save', res.data.dates);
      }
    } else {
      pinErrorMessage.value = res.error || 'PIN 변경에 실패했습니다.';
    }
  } catch (err: any) {
    pinErrorMessage.value = err.message || 'PIN 변경 중 오류가 발생했습니다.';
  } finally {
    isResettingPin.value = false;
  }
};

// --- 감사 로그 (일정 변동 기록) 로직 ---
const loadHistory = async () => {
  isLoadingHistory.value = true;
  errorMessage.value = '';
  try {
    const list = await fetchScheduleHistory(props.currentMonth, props.adminToken);
    historyList.value = list;
  } catch (e: any) {
    console.error('일정 변동 기록 로드 실패:', e);
    errorMessage.value = e.message || '일정 변동 기록을 불러오는데 실패했습니다.';
  } finally {
    isLoadingHistory.value = false;
  }
};

const filteredHistory = computed(() => {
  if (historyFilter.value === 'all') {
    return historyList.value;
  }
  return historyList.value.filter(item => item.action === historyFilter.value);
});

const getActionLabel = (action: ScheduleActionType | string): string => {
  switch (action) {
    case 'ATTEND': return '참석 신청';
    case 'CANCEL_ATTEND': return '참석 취소';
    case 'CLEAR_ATTENDEES': return '전체 비우기';
    case 'DELETE_SESSION': return '일정 삭제';
    case 'UPDATE_SESSION_TYPE': return '시간/속성 변경';
    case 'TOGGLE_CONFIRM': return '확정 / 해제';
    case 'CREATE_SESSION': return '일정 생성';
    case 'UPDATE_DATES': return '후보 일정 수정';
    default: return action;
  }
};

const getActionColor = (action: ScheduleActionType | string): string => {
  switch (action) {
    case 'ATTEND': return '#10b981'; // Green
    case 'CANCEL_ATTEND': return '#f59e0b'; // Amber
    case 'CLEAR_ATTENDEES': return '#ef4444'; // Red
    case 'DELETE_SESSION': return '#b91c1c'; // Dark Red
    case 'UPDATE_SESSION_TYPE': return '#3b82f6'; // Blue
    case 'TOGGLE_CONFIRM': return '#8b5cf6'; // Purple
    case 'CREATE_SESSION': return '#06b6d4'; // Cyan
    case 'UPDATE_DATES': return '#6366f1'; // Indigo
    default: return '#64748b';
  }
};

const formatHistoryTime = (timestamp: number | string): string => {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return String(timestamp);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const sec = String(d.getSeconds()).padStart(2, '0');
  return `${m}-${day} ${h}:${min}:${sec}`;
};

const copySuccessMsg = ref('');

const copyHistoryToClipboard = async () => {
  if (filteredHistory.value.length === 0) return;

  const lines = [
    `[${props.currentMonth} 마작 모임 일정 변동 기록] (총 ${filteredHistory.value.length}건)`,
    '--------------------------------------------------'
  ];

  for (const item of filteredHistory.value) {
    const timeStr = formatHistoryTime(item.timestamp);
    const actionLabel = getActionLabel(item.action);
    const dateLabel = item.targetDate ? ` (${item.targetDate})` : '';
    const actor = item.actorName || '익명';
    const detail = item.details || '';
    lines.push(`• [${timeStr}] ${actionLabel}${dateLabel} | 실행: ${actor} | ${detail}`);
  }

  const textToCopy = lines.join('\n');

  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(textToCopy);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = textToCopy;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    copySuccessMsg.value = '변동 기록이 클립보드에 복사되었습니다.';
    setTimeout(() => {
      copySuccessMsg.value = '';
    }, 2500);
  } catch (err) {
    console.error('클립보드 복사 실패:', err);
    alert('클립보드 복사에 실패했습니다.');
  }
};

// ==========================================
// 타임머신 / Git 델타 커밋 롤백 로직
// ==========================================
const commitsList = ref<ScheduleCommitItem[]>([]);
const checkpointInfo = ref<{ timestamp: number; commitId?: string } | null>(null);
const isLoadingCommits = ref(false);
const isRollingBack = ref(false);
const rollbackSuccessMsg = ref('');
const rollbackErrorMsg = ref('');
const expandedCommitIds = ref<Set<string>>(new Set());

const toggleCommitDiff = (commitId: string) => {
  if (expandedCommitIds.value.has(commitId)) {
    expandedCommitIds.value.delete(commitId);
  } else {
    expandedCommitIds.value.add(commitId);
  }
};

const loadCommits = async () => {
  isLoadingCommits.value = true;
  rollbackErrorMsg.value = '';
  try {
    const res = await fetchScheduleCommits(props.currentMonth);
    if (res.success) {
      commitsList.value = res.commits;
      checkpointInfo.value = res.checkpoint || null;
    }
  } catch (err: any) {
    rollbackErrorMsg.value = err.message || '커밋 목록을 불러오지 못했습니다.';
  } finally {
    isLoadingCommits.value = false;
  }
};

const handleRollback = async (targetId: string, label: string) => {
  if (!confirm(`정말 [${label}] 시점으로 일정을 복원(롤백)하시겠습니까?\n\n현재 상태도 새로운 백업 커밋으로 자동 저장되므로 언제든 다시 되돌릴 수 있습니다.`)) {
    return;
  }

  isRollingBack.value = true;
  rollbackSuccessMsg.value = '';
  rollbackErrorMsg.value = '';

  try {
    const res = await rollbackSchedule(props.currentMonth, targetId, props.adminToken);
    if (res.success && res.data) {
      rollbackSuccessMsg.value = res.message || '일정이 성공적으로 복원되었습니다.';
      if (res.data.dates) {
        emit('save', res.data.dates);
        // 달력 칩 상태 동기화
        const map: Record<number, 'none' | SessionType> = {};
        for (let d = 1; d <= daysInCurrentMonth.value; d++) map[d] = 'none';
        for (const item of res.data.dates) {
          const parts = item.date.split('-');
          if (parts.length === 3) {
            const d = parseInt(parts[2], 10);
            if (d >= 1 && d <= daysInCurrentMonth.value) {
              map[d] = item.adminSessionType || item.sessionType;
            }
          }
        }
        dayStatusMap.value = map;
      }
      await loadCommits();
      setTimeout(() => {
        rollbackSuccessMsg.value = '';
      }, 3500);
    } else {
      rollbackErrorMsg.value = res.error || '복원 처리에 실패했습니다.';
    }
  } catch (err: any) {
    rollbackErrorMsg.value = err.message || '복원 중 오류가 발생했습니다.';
  } finally {
    isRollingBack.value = false;
  }
};
</script>

<template>
  <Transition name="apple-modal-fade">
    <div v-if="isOpen" class="apple-modal-backdrop" v-backdrop-dismiss="() => emit('close')">
      <div class="apple-modal-sheet">
        <!-- 모달 헤더 -->
        <div class="sheet-header">
          <div class="sheet-title-group">
            <div class="sheet-sub-row">
              <span class="sheet-sub">{{ currentMonth }} 관리자 모드</span>
              <span v-if="isGoogleAdmin" class="badge-google-admin">Google 관리자</span>
            </div>
            <h3 class="sheet-title">{{ primaryTab === 'schedule' ? '가능한 날짜 풀 수정' : '운영 및 보안 도구' }}</h3>
          </div>
          <div class="header-actions-group">
            <button
              type="button"
              class="btn-admin-logout"
              @click="handleAdminLogout"
              title="관리자 권한 로그아웃"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                <polyline points="16 17 21 12 16 7"></polyline>
                <line x1="21" y1="12" x2="9" y2="12"></line>
              </svg>
              <span>관리자 로그아웃</span>
            </button>
            <button class="btn-close" @click="emit('close')" aria-label="닫기">✕</button>
          </div>
        </div>

        <!-- 에러 배너 -->
        <div v-if="errorMessage" class="error-banner">
          {{ errorMessage }}
        </div>

        <!-- 1차 상위 탭 네비게이션 (이모지 없음) -->
        <div class="primary-tabs-wrapper">
          <div class="apple-segmented-control primary-control">
            <button
              type="button"
              class="segment-btn primary-btn"
              :class="{ active: primaryTab === 'schedule' }"
              @click="switchPrimaryTab('schedule')"
            >
              일정 관리
            </button>
            <button
              type="button"
              class="segment-btn primary-btn"
              :class="{ active: primaryTab === 'tools' }"
              @click="switchPrimaryTab('tools')"
            >
              운영 및 보안
            </button>
          </div>
        </div>

        <!-- 2차 하위 탭: 전체 너비 균등 분할 -->
        <div class="sub-tabs-wrapper">
          <!-- 1) 일정 관리 하위 탭 -->
          <div v-if="primaryTab === 'schedule'" class="apple-segmented-control sub-control schedule-sub-control">
            <button
              type="button"
              class="segment-btn sub-btn"
              :class="{ active: editMode === 'visual' }"
              @click="editMode = 'visual'"
            >
              달력 칩
            </button>
            <button
              type="button"
              class="segment-btn sub-btn"
              :class="{ active: editMode === 'text' }"
              @click="editMode = 'text'"
            >
              텍스트로 입력
            </button>
          </div>

          <!-- 2) 운영 및 보안 하위 탭 -->
          <div v-else class="apple-segmented-control sub-control security-sub-control">
            <button
              type="button"
              class="segment-btn sub-btn"
              :class="{ active: editMode === 'passcode' }"
              @click="editMode = 'passcode'"
            >
              인증 코드
            </button>
            <button
              type="button"
              class="segment-btn sub-btn"
              :class="{ active: editMode === 'pin' }"
              @click="editMode = 'pin'"
            >
              참가자 PIN
            </button>
            <button
              type="button"
              class="segment-btn sub-btn"
              :class="{ active: editMode === 'history' }"
              @click="editMode = 'history'"
            >
              변동 기록
            </button>
            <button
              type="button"
              class="segment-btn sub-btn"
              :class="{ active: editMode === 'rollback' }"
              @click="editMode = 'rollback'"
            >
              타임머신 복원
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
          <div v-else-if="editMode === 'passcode'" class="passcode-editor-container">
            <p class="text-guide">
              관리자마다 개별 인증 코드를 발급할 수 있습니다. 등록된 코드가 하나도 없으면 <strong>구글 계정 로그인으로만</strong> 관리자 인증이 가능한 보안 모드가 됩니다.
            </p>

            <div v-if="passcodeSuccessMsg" class="success-banner">
              {{ passcodeSuccessMsg }}
            </div>

            <!-- 신규 관리자 코드 등록 폼 -->
            <div class="passcode-add-box">
              <span class="sub-section-title">새 관리자 코드 발급</span>
              <div class="passcode-form-inputs">
                <input
                  type="text"
                  v-model="newPasscodeLabel"
                  class="apple-input input-label"
                  placeholder="관리자 이름"
                  maxlength="20"
                />
                <div class="passcode-input-wrap">
                  <input
                    :type="showNewPasscode ? 'text' : 'password'"
                    v-model="newPasscode"
                    class="apple-input input-code"
                    placeholder="인증 코드 (4자리 이상)"
                    maxlength="24"
                    @keyup.enter="handleAddPasscode"
                  />
                  <button
                    type="button"
                    class="btn-toggle-mask"
                    @click="showNewPasscode = !showNewPasscode"
                    :title="showNewPasscode ? '코드 숨기기' : '코드 보기'"
                    tabindex="-1"
                  >
                    <svg v-if="showNewPasscode" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                      <line x1="1" y1="1" x2="23" y2="23"></line>
                    </svg>
                    <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                      <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                  </button>
                </div>
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

          <!-- 4. 참가자 PIN 관리 모드 -->
          <div v-else-if="editMode === 'pin'" class="pin-management-container">
            <p class="text-guide">
              관리자 권한으로 특정 참가자의 PIN을 강제로 변경할 수 있습니다. 변경된 PIN은 해당 참가자의 이번 달 모든 개설 및 참석 내역에 즉시 반영됩니다.
            </p>

            <div v-if="pinSuccessMsg" class="success-banner">
              {{ pinSuccessMsg }}
            </div>
            <div v-if="pinErrorMessage" class="error-banner">
              {{ pinErrorMessage }}
            </div>

            <div class="pin-form-card">
              <div class="pin-field-row">
                <label class="pin-field-label">대상 참가자</label>
                <div class="pin-field-control">
                  <select
                    v-if="attendeesWithPins.length > 0"
                    v-model="selectedAttendeeSelect"
                    class="apple-input attendee-select"
                    @change="onSelectAttendee"
                  >
                    <option value="">참가자 목록에서 선택 (또는 직접 입력)</option>
                    <option v-for="name in attendeesWithPins" :key="name" :value="name">
                      {{ name }}
                    </option>
                  </select>
                  <input
                    type="text"
                    v-model="targetAttendeeName"
                    class="apple-input attendee-name-input"
                    placeholder="참가자 이름 직접 입력"
                    maxlength="20"
                  />
                </div>
              </div>

              <div class="pin-field-row">
                <label class="pin-field-label">적용 대상 회차</label>
                <div class="pin-field-control">
                  <div class="scope-chips-group">
                    <!-- 전체 일괄 변경 칩 버튼 (기본 선택) -->
                    <button
                      type="button"
                      class="btn-scope-chip"
                      :class="{ active: targetPinResetDate === '' }"
                      @click="targetPinResetDate = ''"
                    >
                      전체 일괄 변경
                    </button>

                    <!-- 해당 참가자가 실제로 참가한 회차 칩 버튼 목록 -->
                    <button
                      v-for="d in targetAttendeeExistingDates"
                      :key="d.date"
                      type="button"
                      class="btn-scope-chip"
                      :class="{
                        active: targetPinResetDate === d.date,
                        'is-confirmed': d.isConfirmed
                      }"
                      @click="targetPinResetDate = d.date"
                    >
                      <span v-if="d.isConfirmed && getSessionNumber(d.date)" class="chip-session-badge">
                        제{{ getSessionNumber(d.date) }}회
                      </span>
                      <span class="chip-date-label">{{ formatChipDate(d.date) }}</span>
                    </button>
                  </div>

                  <!-- 안내 문구 (참가 일정이 없는 경우) -->
                  <p v-if="targetAttendeeName.trim() && targetAttendeeExistingDates.length === 0" class="empty-dates-hint">
                    ※ 해당 참가자가 참석 신청한 특정 일정이 없습니다. (전체 일괄 변경만 가능)
                  </p>
                </div>
              </div>

              <div class="pin-field-row">
                <label class="pin-field-label">새 PIN (4~8자리)</label>
                <div class="pin-field-control">
                  <input
                    type="password"
                    v-model="targetNewPin"
                    class="apple-input pin-box-input"
                    placeholder="••••"
                    maxlength="8"
                    inputmode="numeric"
                  />
                </div>
              </div>

              <div class="pin-field-row">
                <label class="pin-field-label">새 PIN 확인</label>
                <div class="pin-field-control">
                  <input
                    type="password"
                    v-model="targetNewPinConfirm"
                    class="apple-input pin-box-input"
                    placeholder="••••"
                    maxlength="8"
                    inputmode="numeric"
                    @keyup.enter="handleForceResetPin"
                  />
                </div>
              </div>

              <div class="pin-actions-row">
                <button
                  type="button"
                  class="btn-pin-submit"
                  :disabled="isResettingPin || !targetAttendeeName.trim() || !targetNewPin"
                  @click="handleForceResetPin"
                >
                  {{ isResettingPin ? '변경 중...' : 'PIN 강제 변경 적용' }}
                </button>
              </div>
            </div>
          </div>

          <!-- 5. 변동 기록 (감사 로그) 모드 -->
          <div v-if="editMode === 'history'" class="history-view-container">
            <div class="history-toolbar">
              <div class="history-filter-group">
                <select v-model="historyFilter" class="apple-select history-filter-select">
                  <option value="all">전체 내역 ({{ historyList.length }}건)</option>
                  <option value="ATTEND">참석 신청</option>
                  <option value="CANCEL_ATTEND">참석 취소</option>
                  <option value="CLEAR_ATTENDEES">전체 비우기</option>
                  <option value="DELETE_SESSION">일정 삭제</option>
                  <option value="TOGGLE_CONFIRM">확정 / 해제</option>
                  <option value="UPDATE_SESSION_TYPE">시간/속성 변경</option>
                  <option value="CREATE_SESSION">일정 생성</option>
                  <option value="UPDATE_DATES">후보 일정 수정</option>
                </select>
              </div>
              <div class="history-actions-group">
                <button
                  type="button"
                  class="btn-copy-history"
                  :disabled="filteredHistory.length === 0"
                  @click="copyHistoryToClipboard"
                  title="현재 조회된 변동 기록을 클립보드에 복사"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                  <span>기록 복사</span>
                </button>
                <button
                  type="button"
                  class="btn-refresh-history"
                  :disabled="isLoadingHistory"
                  @click="loadHistory"
                  title="변동 기록 새로고침"
                >
                  {{ isLoadingHistory ? '조회 중...' : '🔄 새로고침' }}
                </button>
              </div>
            </div>

            <!-- 복사 완료 토스트 배너 -->
            <div v-if="copySuccessMsg" class="copy-success-toast">
              {{ copySuccessMsg }}
            </div>

            <div v-if="isLoadingHistory && historyList.length === 0" class="history-loading">
              <div class="history-spinner"></div>
              <span>변동 기록을 불러오는 중...</span>
            </div>

            <div v-else-if="filteredHistory.length === 0" class="history-empty">
              <span class="empty-icon">📋</span>
              <p class="empty-text">해당 조건의 변동 기록이 없습니다.</p>
            </div>

            <div v-else class="history-list">
              <div
                v-for="item in filteredHistory"
                :key="item.id"
                class="history-card"
              >
                <div class="history-card-header">
                  <span
                    class="history-action-badge"
                    :style="{ backgroundColor: getActionColor(item.action) }"
                  >
                    {{ getActionLabel(item.action) }}
                  </span>
                  <span v-if="item.targetDate" class="history-date-tag">{{ item.targetDate }}</span>
                  <span class="history-time">{{ formatHistoryTime(item.timestamp) }}</span>
                </div>
                <div class="history-card-body">
                  <p class="history-detail">{{ item.details }}</p>
                </div>
                <div class="history-card-footer">
                  <span class="history-user-info">
                    <span class="user-label">실행:</span> <strong>{{ item.actorName || '익명' }}</strong>
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- 6. 타임머신 복원 (Git 델타 커밋 & 체크포인트 롤백) 모드 -->
          <div v-if="editMode === 'rollback'" class="rollback-view-container">
            <div class="rollback-intro-card">
              <div class="intro-content">
                <div class="intro-title">타임머신 복원</div>
                <div class="intro-desc">
                  특정 지점으로 일정을 복구할 수 있습니다.
                </div>
              </div>
            </div>

            <div class="rollback-toolbar">
              <div class="rollback-toolbar-left">
                <span class="commits-count-badge">기록된 커밋 {{ commitsList.length }}건</span>
              </div>
              <div class="rollback-toolbar-right">
                <button
                  type="button"
                  class="btn-refresh-history"
                  :disabled="isLoadingCommits || isRollingBack"
                  @click="loadCommits"
                >
                  {{ isLoadingCommits ? '조회 중...' : '🔄 새로고침' }}
                </button>
              </div>
            </div>

            <!-- 성공 / 에러 배너 -->
            <div v-if="rollbackSuccessMsg" class="rollback-success-banner">
              ✅ {{ rollbackSuccessMsg }}
            </div>
            <div v-if="rollbackErrorMsg" class="error-banner">
              ⚠️ {{ rollbackErrorMsg }}
            </div>

            <!-- 안전 체크포인트 배너 카드 (존재할 경우) -->
            <div v-if="checkpointInfo" class="checkpoint-banner-card">
              <div class="checkpoint-info">
                <div class="checkpoint-header-row">
                  <span class="checkpoint-badge">안전 체크포인트</span>
                  <span class="checkpoint-time">{{ formatHistoryTime(checkpointInfo.timestamp) }} 생성</span>
                </div>
                <p class="checkpoint-desc">주요 일정 변경 시 KV에 안전하게 동결 보관된 풀 스냅샷입니다.</p>
              </div>
              <button
                type="button"
                class="btn-rollback-action highlight"
                :disabled="isRollingBack"
                @click="handleRollback('checkpoint', '안전 체크포인트')"
              >
                {{ isRollingBack ? '복원 중...' : '이 체크포인트로 복원' }}
              </button>
            </div>

            <!-- 로딩 상태 -->
            <div v-if="isLoadingCommits && commitsList.length === 0" class="history-loading">
              <div class="history-spinner"></div>
              <span>커밋 히스토리를 불러오는 중...</span>
            </div>

            <!-- 커밋 없음 -->
            <div v-else-if="commitsList.length === 0" class="history-empty">
              <p class="empty-text">아직 기록된 커밋 내역이 없습니다. (일정 변경 시 자동 생성됩니다)</p>
            </div>

            <!-- 커밋 리스트 -->
            <div v-else class="commits-list">
              <div
                v-for="commit in commitsList"
                :key="commit.id"
                class="commit-card"
              >
                <div class="commit-card-header">
                  <span class="commit-id-badge">{{ commit.id.slice(0, 10) }}</span>
                  <span
                    class="history-action-badge"
                    :style="{ backgroundColor: getActionColor(commit.action) }"
                  >
                    {{ getActionLabel(commit.action) }}
                  </span>
                  <span class="commit-time">{{ formatHistoryTime(commit.timestamp) }}</span>
                </div>

                <div class="commit-card-body">
                  <p class="commit-summary">{{ commit.summary }}</p>

                  <!-- 변경 세부 내역 (Diff) 토글 -->
                  <button
                    type="button"
                    class="btn-toggle-diff"
                    @click="toggleCommitDiff(commit.id)"
                  >
                    <span class="diff-arrow">{{ expandedCommitIds.has(commit.id) ? '▼' : '▶' }}</span>
                    <span>{{ expandedCommitIds.has(commit.id) ? '변경 내역 접기' : '변화량(Diff) 상세 보기' }}</span>
                  </button>

                  <div v-if="expandedCommitIds.has(commit.id)" class="diff-details-panel">
                    <!-- 추가된 날짜 -->
                    <div v-if="commit.delta?.addedDates?.length" class="diff-row added">
                      <span class="diff-tag plus">+ 날짜 추가</span>
                      <span class="diff-content">
                        <span v-for="d in commit.delta.addedDates" :key="d.date" class="diff-chip add">
                          {{ d.date }} ({{ d.sessionType === 'overnight' ? '밤샘' : '당일' }})
                        </span>
                      </span>
                    </div>

                    <!-- 삭제된 날짜 -->
                    <div v-if="commit.delta?.removedDates?.length" class="diff-row removed">
                      <span class="diff-tag minus">- 날짜 삭제</span>
                      <span class="diff-content">
                        <span v-for="d in commit.delta.removedDates" :key="d.date" class="diff-chip del">
                          {{ d.date }}
                        </span>
                      </span>
                    </div>

                    <!-- 수정된 날짜 -->
                    <div v-if="commit.delta?.modifiedDates?.length" class="diff-row modified">
                      <span class="diff-tag mod">~ 세부 변경</span>
                      <div class="diff-mod-list">
                        <div v-for="m in commit.delta.modifiedDates" :key="m.date" class="diff-mod-item">
                          <span class="mod-date">{{ m.date }}</span>
                          <span v-if="m.fieldDiff.sessionType" class="mod-field">
                            유형: {{ m.fieldDiff.sessionType.before }} → <strong>{{ m.fieldDiff.sessionType.after }}</strong>
                          </span>
                          <span v-if="m.fieldDiff.isConfirmed" class="mod-field">
                            확정: <strong>{{ m.fieldDiff.isConfirmed.after ? '출발 확정' : '대기중' }}</strong>
                          </span>
                          <span v-if="m.fieldDiff.attendees" class="mod-field">
                            <span v-if="m.fieldDiff.attendees.added?.length" class="text-green">+{{ m.fieldDiff.attendees.added.join(', ') }}</span>
                            <span v-if="m.fieldDiff.attendees.removed?.length" class="text-red"> -{{ m.fieldDiff.attendees.removed.join(', ') }}</span>
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="commit-card-footer">
                  <span class="commit-author">작성자: <strong>{{ commit.actorName }}</strong></span>
                  <button
                    type="button"
                    class="btn-rollback-action"
                    :disabled="isRollingBack"
                    @click="handleRollback(commit.id, `${commit.summary}`)"
                  >
                    {{ isRollingBack ? '처리 중...' : '⏱️ 이 시점으로 롤백' }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 푸터 버튼 -->
        <div class="sheet-footer">
          <button type="button" class="btn-cancel" @click="emit('close')">
            닫기
          </button>
          <button v-if="primaryTab === 'schedule'" type="button" class="btn-primary" @click="handleApply">
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
  max-height: calc(100dvh - 32px);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: sheetPop 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  font-family: 'Noto Serif KR', 'Noto Serif JP', 'Noto Serif', serif;
}

.apple-modal-sheet button,
.apple-modal-sheet input,
.apple-modal-sheet select,
.apple-modal-sheet textarea {
  font-family: 'Noto Serif KR', 'Noto Serif JP', 'Noto Serif', serif;
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
  padding: 16px 20px 12px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-color, rgba(0, 0, 0, 0.06));
  gap: 12px;
}

.sheet-title-group {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.sheet-sub-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
  flex-wrap: wrap;
}

.sheet-sub {
  font-size: 13px;
  color: #2563eb;
  font-weight: 600;
  display: block;
}

.badge-google-admin {
  font-size: 11px;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 6px;
  background: rgba(37, 99, 235, 0.12);
  color: #2563eb;
  border: 1px solid rgba(37, 99, 235, 0.25);
  letter-spacing: -0.01em;
  white-space: nowrap;
}

.sheet-title {
  margin: 0;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.header-actions-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.btn-admin-logout {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 9px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  color: #ef4444;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.2);
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.btn-admin-logout:hover {
  background: rgba(239, 68, 68, 0.16);
  border-color: rgba(239, 68, 68, 0.35);
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

/* 1차 상위 탭 (일정 관리 vs 운영 및 보안) */
.primary-tabs-wrapper {
  padding: 12px 20px 0;
}

.apple-segmented-control.primary-control {
  display: flex;
  background: rgba(0, 0, 0, 0.04);
  padding: 4px;
  border-radius: 12px;
  gap: 4px;
  border: 1px solid var(--border-color, rgba(0, 0, 0, 0.08));
}

.segment-btn.primary-btn {
  flex: 1;
  border: none;
  background: transparent;
  min-height: 52px;
  padding: 12px 14px;
  font-size: 15px;
  font-weight: 700;
  border-radius: 9px;
  color: var(--text-dimmed, #64748b);
  cursor: pointer;
  transition: all 0.18s ease;
  white-space: nowrap;
  text-align: center;
}

.segment-btn.primary-btn.active {
  background: #2563eb;
  color: #ffffff;
  font-weight: 700;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

/* 상위 탭과 너비를 맞추되, 낮고 각진 형태로 구분하는 하위 탭 */
.sub-tabs-wrapper {
  margin: 10px 20px 0;
}

.apple-segmented-control.sub-control {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  background: var(--input-bg-color, #f1f5f9);
  padding: 3px;
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 6px;
  gap: 3px;
}

.segment-btn.sub-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 40px;
  padding: 7px 6px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--text-dimmed, #64748b);
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1.4;
  white-space: normal;
  word-break: keep-all;
  text-align: center;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.segment-btn.sub-btn:hover {
  background: var(--card-bg-color, #ffffff);
  color: var(--text-color, #0f172a);
}

.segment-btn.sub-btn.active {
  background: var(--card-bg-color, #ffffff);
  color: var(--text-color, #0f172a);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}

.segment-btn.sub-btn.active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 25%;
  right: 25%;
  height: 2px;
  border-radius: 1px;
  background: #2563eb;
}

.segment-btn.sub-btn:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: -2px;
}

.mode-tabs-wrapper {
  padding: 12px 20px 0;
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}
.mode-tabs-wrapper::-webkit-scrollbar {
  display: none;
}

.apple-segmented-control {
  display: flex;
  background: var(--input-bg-color, #f1f5f9);
  padding: 3px;
  border-radius: 12px;
  gap: 2px;
  border: 1px solid var(--border-color, #e2e8f0);
  min-width: max-content;
}

.segment-btn {
  flex: 1;
  border: none;
  background: transparent;
  padding: 7px 12px;
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

.sheet-body {
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  flex: 1 1 auto;
  min-height: 0;
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
  font-family: 'Noto Serif KR', 'Noto Serif JP', 'Noto Serif', serif !important;
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
  font-family: 'Noto Serif KR', 'Noto Serif JP', 'Noto Serif', serif !important;
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

.passcode-input-wrap {
  flex: 1;
  min-width: 140px;
  position: relative;
  display: flex;
  align-items: center;
}

.passcode-input-wrap .input-code {
  width: 100%;
  padding-right: 34px;
}

.btn-toggle-mask {
  position: absolute;
  right: 6px;
  background: transparent;
  border: none;
  padding: 4px;
  cursor: pointer;
  color: var(--text-dimmed, #94a3b8);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  transition: color 0.15s ease;
}

.btn-toggle-mask:hover {
  color: var(--text-color, #0f172a);
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

/* 참가자 PIN 관리 모드 */
.pin-management-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pin-form-card {
  background: var(--input-bg-color, #f8fafc);
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.pin-field-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pin-field-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color, #0f172a);
}

.pin-field-control {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.attendee-select {
  flex: 1.2;
  min-width: 160px;
  font-size: 13px;
}

.attendee-name-input {
  flex: 1;
  min-width: 120px;
  font-size: 13px;
}

.pin-box-input {
  width: 140px;
  font-size: 14px;
  letter-spacing: 0.25em;
  text-align: center;
}

.pin-actions-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 4px;
}

.btn-pin-submit {
  background: #0071e3;
  color: #ffffff;
  border: none;
  padding: 8px 16px;
  border-radius: 9px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-pin-submit:hover:not(:disabled) {
  background: #0077ed;
  transform: translateY(-1px);
}

.btn-pin-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.scope-chips-group {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  width: 100%;
}

.btn-scope-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  background: var(--card-bg-color, #ffffff);
  border: 1px solid var(--border-color, #cbd5e1);
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-color, #334155);
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: inherit;
}

.btn-scope-chip:hover {
  border-color: #3b82f6;
  color: #2563eb;
}

.btn-scope-chip.active {
  background: rgba(37, 99, 235, 0.1);
  border-color: #2563eb;
  color: #2563eb;
  font-weight: 700;
  box-shadow: 0 1px 3px rgba(37, 99, 235, 0.15);
}

html.dark .btn-scope-chip {
  background: #1e293b;
  border-color: rgba(255, 255, 255, 0.12);
  color: #cbd5e1;
}

html.dark .btn-scope-chip.active {
  background: rgba(59, 130, 246, 0.2);
  border-color: #3b82f6;
  color: #93c5fd;
}

.chip-session-badge {
  font-size: 10px;
  font-weight: 700;
  color: #16a34a;
  background: rgba(22, 163, 74, 0.12);
  padding: 1px 5px;
  border-radius: 4px;
}

html.dark .chip-session-badge {
  color: #4ade80;
  background: rgba(74, 222, 128, 0.18);
}

.chip-date-label {
  line-height: 1.3;
}

.empty-dates-hint {
  font-size: 11.5px;
  color: var(--text-dimmed, #64748b);
  margin: 4px 0 0 0;
  line-height: 1.4;
}

/* 감사 로그 (일정 변동 기록) 스타일 */
.history-view-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.history-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.history-filter-select {
  padding: 6px 12px;
  font-size: 13px;
  border-radius: 8px;
  border: 1px solid var(--border-color, #cbd5e1);
  background: var(--card-bg-color, #ffffff);
  color: var(--text-color, #1e293b);
}

.btn-refresh-history {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  background: var(--input-bg-color, #f1f5f9);
  border: 1px solid var(--border-color, #cbd5e1);
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-color, #334155);
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-refresh-history:hover:not(:disabled) {
  background: var(--card-bg-color, #ffffff);
  border-color: #3b82f6;
  color: #2563eb;
}

.history-actions-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.btn-copy-history {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  background: var(--input-bg-color, #f1f5f9);
  border: 1px solid var(--border-color, #cbd5e1);
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-color, #334155);
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-copy-history:hover:not(:disabled) {
  background: var(--card-bg-color, #ffffff);
  border-color: #3b82f6;
  color: #2563eb;
}

.btn-copy-history:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.copy-success-toast {
  background: rgba(16, 185, 129, 0.12);
  border: 1px solid rgba(16, 185, 129, 0.3);
  color: #059669;
  font-size: 12px;
  font-weight: 600;
  padding: 8px 12px;
  border-radius: 8px;
  text-align: center;
  animation: fadeIn 0.2s ease;
}

html.dark .copy-success-toast {
  background: rgba(16, 185, 129, 0.2);
  color: #34d399;
}

.history-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  gap: 12px;
  color: var(--text-dimmed, #64748b);
  font-size: 13px;
}

.history-spinner {
  width: 24px;
  height: 24px;
  border: 3px solid rgba(59, 130, 246, 0.2);
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.history-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  gap: 8px;
  color: var(--text-dimmed, #64748b);
}

.history-empty .empty-icon {
  font-size: 28px;
}

.history-empty .empty-text {
  font-size: 13px;
  margin: 0;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 480px;
  overflow-y: auto;
  padding-right: 2px;
}

.history-card {
  background: var(--card-bg-color, #ffffff);
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 10px;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
  transition: border-color 0.15s ease;
}

.history-card:hover {
  border-color: #cbd5e1;
}

html.dark .history-card {
  background: #1e293b;
  border-color: rgba(255, 255, 255, 0.08);
}

.history-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.history-action-badge {
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 6px;
  letter-spacing: -0.01em;
}

.history-date-tag {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-color, #1e293b);
}

html.dark .history-date-tag {
  color: #f1f5f9;
}

.history-time {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-dimmed, #94a3b8);
  font-variant-numeric: tabular-nums;
}

.history-card-body {
  margin: 0;
}

.history-detail {
  font-size: 12.5px;
  color: var(--text-color, #334155);
  margin: 0;
  line-height: 1.45;
  word-break: break-all;
}

html.dark .history-detail {
  color: #cbd5e1;
}

.history-card-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  font-size: 11px;
  color: var(--text-dimmed, #64748b);
  border-top: 1px dashed var(--border-color, #f1f5f9);
  padding-top: 4px;
  margin-top: 2px;
}

html.dark .history-card-footer {
  border-top-color: rgba(255, 255, 255, 0.06);
}

.history-user-info {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* ==========================================
   타임머신 복원 (Git 델타 커밋) 스타일
   ========================================== */
.rollback-view-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.rollback-intro-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  background: rgba(59, 130, 246, 0.08);
  border: 1px solid rgba(59, 130, 246, 0.2);
  border-radius: 12px;
  padding: 12px 14px;
}

html.dark .rollback-intro-card {
  background: rgba(59, 130, 246, 0.12);
  border-color: rgba(59, 130, 246, 0.3);
}

.intro-icon {
  font-size: 20px;
  line-height: 1;
}

.intro-content {
  flex: 1;
}

.intro-title {
  font-size: 13px;
  font-weight: 700;
  color: #2563eb;
  margin-bottom: 2px;
}

html.dark .intro-title {
  color: #60a5fa;
}

.intro-desc {
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-color, #334155);
}

html.dark .intro-desc {
  color: #cbd5e1;
}

.rollback-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 0;
}

.commits-count-badge {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dimmed, #64748b);
  background: var(--input-bg-color, #f1f5f9);
  padding: 4px 10px;
  border-radius: 20px;
  border: 1px solid var(--border-color, #e2e8f0);
}

html.dark .commits-count-badge {
  background: #1e293b;
  border-color: rgba(255, 255, 255, 0.08);
}

.rollback-success-banner {
  background: rgba(16, 185, 129, 0.12);
  color: #059669;
  border: 1px solid rgba(16, 185, 129, 0.3);
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
  animation: fadeIn 0.2s ease;
}

html.dark .rollback-success-banner {
  background: rgba(16, 185, 129, 0.2);
  color: #34d399;
}

.checkpoint-banner-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(6, 182, 212, 0.08) 100%);
  border: 1px solid rgba(16, 185, 129, 0.3);
  border-radius: 12px;
  padding: 12px 14px;
}

html.dark .checkpoint-banner-card {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(6, 182, 212, 0.12) 100%);
  border-color: rgba(16, 185, 129, 0.4);
}

.checkpoint-info {
  flex: 1;
}

.checkpoint-header-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 3px;
}

.checkpoint-badge {
  font-size: 11px;
  font-weight: 700;
  color: #059669;
  background: rgba(16, 185, 129, 0.2);
  padding: 2px 7px;
  border-radius: 6px;
}

html.dark .checkpoint-badge {
  color: #34d399;
  background: rgba(16, 185, 129, 0.3);
}

.checkpoint-time {
  font-size: 11px;
  color: var(--text-dimmed, #64748b);
  font-variant-numeric: tabular-nums;
}

.checkpoint-desc {
  font-size: 12px;
  color: var(--text-color, #334155);
  margin: 0;
  line-height: 1.4;
}

html.dark .checkpoint-desc {
  color: #cbd5e1;
}

.commits-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 480px;
  overflow-y: auto;
  padding-right: 2px;
}

.commit-card {
  background: var(--card-bg-color, #ffffff);
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 12px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
  transition: all 0.15s ease;
}

.commit-card:hover {
  border-color: #cbd5e1;
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.05);
}

html.dark .commit-card {
  background: #1e293b;
  border-color: rgba(255, 255, 255, 0.08);
}

.commit-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.commit-id-badge {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  font-weight: 700;
  color: #475569;
  background: var(--input-bg-color, #f1f5f9);
  padding: 2px 6px;
  border-radius: 5px;
  border: 1px solid var(--border-color, #e2e8f0);
}

html.dark .commit-id-badge {
  color: #94a3b8;
  background: #0f172a;
  border-color: rgba(255, 255, 255, 0.1);
}

.commit-time {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-dimmed, #94a3b8);
  font-variant-numeric: tabular-nums;
}

.commit-summary {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color, #0f172a);
  margin: 0 0 6px 0;
  line-height: 1.4;
}

html.dark .commit-summary {
  color: #f8fafc;
}

.btn-toggle-diff {
  background: transparent;
  border: none;
  color: #3b82f6;
  font-size: 11.5px;
  font-weight: 600;
  padding: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}

html.dark .btn-toggle-diff {
  color: #60a5fa;
}

.diff-arrow {
  font-size: 9px;
  display: inline-block;
  transition: transform 0.15s ease;
}

.diff-details-panel {
  background: var(--input-bg-color, #f8fafc);
  border: 1px dashed var(--border-color, #e2e8f0);
  border-radius: 8px;
  padding: 8px 10px;
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
}

html.dark .diff-details-panel {
  background: #0f172a;
  border-color: rgba(255, 255, 255, 0.1);
}

.diff-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.diff-tag {
  font-size: 11px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
  white-space: nowrap;
}

.diff-tag.plus {
  background: rgba(16, 185, 129, 0.15);
  color: #059669;
}

.diff-tag.minus {
  background: rgba(239, 68, 68, 0.15);
  color: #dc2626;
}

.diff-tag.mod {
  background: rgba(59, 130, 246, 0.15);
  color: #2563eb;
}

.diff-content {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.diff-chip {
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
}

.diff-chip.add {
  background: rgba(16, 185, 129, 0.1);
  color: #047857;
  border: 1px solid rgba(16, 185, 129, 0.2);
}

.diff-chip.del {
  background: rgba(239, 68, 68, 0.1);
  color: #b91c1c;
  border: 1px solid rgba(239, 68, 68, 0.2);
}

.diff-mod-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
}

.diff-mod-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
}

.mod-date {
  font-weight: 700;
  color: var(--text-color, #1e293b);
}

html.dark .mod-date {
  color: #f1f5f9;
}

.mod-field {
  color: var(--text-dimmed, #64748b);
}

.text-green {
  color: #10b981;
  font-weight: 600;
}

.text-red {
  color: #ef4444;
  font-weight: 600;
}

.commit-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px dashed var(--border-color, #f1f5f9);
  padding-top: 6px;
  margin-top: 2px;
}

html.dark .commit-card-footer {
  border-top-color: rgba(255, 255, 255, 0.06);
}

.commit-author {
  font-size: 11px;
  color: var(--text-dimmed, #64748b);
}

.btn-rollback-action {
  background: var(--input-bg-color, #f1f5f9);
  color: var(--text-color, #1e293b);
  border: 1px solid var(--border-color, #cbd5e1);
  padding: 5px 12px;
  border-radius: 8px;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.btn-rollback-action:hover:not(:disabled) {
  background: #e2e8f0;
  border-color: #94a3b8;
  transform: translateY(-1px);
}

.btn-rollback-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

html.dark .btn-rollback-action {
  background: #334155;
  color: #f1f5f9;
  border-color: rgba(255, 255, 255, 0.15);
}

html.dark .btn-rollback-action:hover:not(:disabled) {
  background: #475569;
}

.btn-rollback-action.highlight {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: #ffffff;
  border: none;
  box-shadow: 0 2px 6px rgba(16, 185, 129, 0.3);
}

html.dark .primary-control {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.1);
}
html.dark .primary-btn.active {
  background: #1e293b;
  color: #60a5fa;
}
html.dark .apple-segmented-control.sub-control {
  background: #1e293b;
  border-color: #334155;
}
html.dark .segment-btn.sub-btn {
  color: #94a3b8;
}
html.dark .segment-btn.sub-btn:hover {
  color: #f1f5f9;
}
html.dark .segment-btn.sub-btn.active {
  background: #0f172a;
  color: #f8fafc;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}
html.dark .segment-btn.sub-btn.active::after {
  background: #60a5fa;
}
html.dark .badge-google-admin {
  background: rgba(59, 130, 246, 0.2);
  color: #93c5fd;
  border-color: rgba(59, 130, 246, 0.35);
}
html.dark .btn-admin-logout {
  background: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.3);
  color: #f87171;
}

/* 375x667(iPhone SE) 등 소형/세로가 짧은 모바일 화면 대응 컴팩트 모드 */
@media (max-height: 720px), (max-width: 480px) {
  .apple-modal-backdrop {
    padding: 8px;
  }
  .apple-modal-sheet {
    max-height: calc(100dvh - 16px);
    border-radius: 16px;
  }
  .sheet-header {
    padding: 10px 14px 8px;
    gap: 8px;
  }
  .sheet-title {
    font-size: 16px;
  }
  .sheet-sub {
    font-size: 11px;
  }
  .btn-admin-logout {
    padding: 3px 6px;
    font-size: 11px;
    gap: 3px;
  }
  .btn-close {
    font-size: 14px;
    padding: 2px;
  }
  .primary-tabs-wrapper {
    padding: 8px 14px 0;
  }
  .apple-segmented-control.primary-control {
    padding: 3px;
    gap: 3px;
    border-radius: 10px;
  }
  .segment-btn.primary-btn {
    min-height: 38px;
    padding: 8px 10px;
    font-size: 13.5px;
    border-radius: 8px;
  }
  .sub-tabs-wrapper {
    margin: 8px 14px 0;
  }
  .segment-btn.sub-btn {
    min-height: 36px;
    padding: 5px 4px;
    font-size: 12px;
  }
  .sheet-body {
    padding: 8px 14px;
    gap: 8px;
  }
  .guide-bar {
    margin-bottom: 4px;
    font-size: 11px;
    gap: 4px;
  }
  .calendar-chips-week-header {
    margin-bottom: 4px;
    gap: 4px;
  }
  .week-chip-title {
    font-size: 11px;
  }
  .day-chips-grid {
    gap: 4px;
  }
  .day-chip-btn, .day-chip-empty {
    min-height: 40px;
    padding: 3px 2px;
    border-radius: 8px;
    gap: 2px;
  }
  .chip-day-number {
    font-size: 12px;
  }
  .chip-badge {
    font-size: 10px;
    padding: 1px 3px;
  }
  .sheet-footer {
    padding: 10px 14px 12px;
    gap: 8px;
  }
  .btn-primary, .btn-cancel {
    padding: 8px 14px;
    font-size: 13px;
    border-radius: 10px;
  }
}
</style>
