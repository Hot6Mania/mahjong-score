<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue';
import type { ScheduleDayItem } from '@/types/schedule';
import type { MemberStatItem } from '@/services/publicStatsService';
import { hashPin, fetchMonthSchedule } from '@/services/scheduleService';
import {
  checkPinLockout,
  recordPinFailure,
  recordPinSuccess,
  applyDelayIfRepeated
} from '@/utils/pinRateLimiter';

const props = defineProps<{
  isOpen: boolean;
  currentMonth: string;
  currentAttendeeName?: string;
  dates: ScheduleDayItem[];
  members?: MemberStatItem[];
  isAdmin?: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'loginSuccess', name: string, pin: string): void;
  (e: 'logout'): void;
}>();

const inputName = ref('');
const inputPin = ref('');
const errorMessage = ref('');
const isVerifying = ref(false);

// 현재 로그인 사용자의 이번 달 참석 일정 수
const myAttendanceCount = computed(() => {
  if (!props.currentAttendeeName || !props.dates) return 0;
  return props.dates.filter(d => d.attendees?.some(a => a.name === props.currentAttendeeName)).length;
});

// 락아웃 타이머 상태
const isLocked = ref(false);
const remainingSeconds = ref(0);
let timerId: number | null = null;

const updateLockoutStatus = () => {
  const status = checkPinLockout(inputName.value);
  isLocked.value = status.isLocked;
  remainingSeconds.value = status.remainingSeconds;

  if (status.isLocked && remainingSeconds.value > 0) {
    if (!timerId) {
      timerId = window.setInterval(() => {
        if (remainingSeconds.value > 1) {
          remainingSeconds.value -= 1;
        } else {
          isLocked.value = false;
          remainingSeconds.value = 0;
          if (timerId) {
            clearInterval(timerId);
            timerId = null;
          }
        }
      }, 1000);
    }
  } else {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }
};

watch(() => props.isOpen, (open) => {
  if (open) {
    inputName.value = props.currentAttendeeName || '';
    inputPin.value = '';
    errorMessage.value = '';
    updateLockoutStatus();
  } else {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }
});

watch(inputName, () => {
  errorMessage.value = '';
  updateLockoutStatus();
});

onUnmounted(() => {
  if (timerId) {
    clearInterval(timerId);
  }
});

// 빠른 선택용 추천 이름 (현재 월 참석자 우선, 중복 제거)
const recentAttendeeNames = computed(() => {
  const set = new Set<string>();
  if (props.dates) {
    for (const d of props.dates) {
      if (d.creator) set.add(d.creator);
      if (d.attendees) {
        for (const a of d.attendees) {
          if (a.name) set.add(a.name);
        }
      }
    }
  }
  return Array.from(set).slice(0, 8);
});

// 직전 월 계산 (YYYY-MM)
const getPreviousMonthStr = (monthStr: string): string => {
  const [yStr, mStr] = monthStr.split('-');
  let y = parseInt(yStr, 10);
  let m = parseInt(mStr, 10);
  m -= 1;
  if (m < 1) {
    m = 12;
    y -= 1;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
};

// 대상 참가자의 유효한 개인 PIN 해시 여부 검증 (64자리 hex SHA-256 검사 & 과거 개설자 PIN 복제 오염 배제)
const isValidPersonalPinHash = (targetName: string, pinHash?: string, creatorName?: string, creatorPinHash?: string): boolean => {
  if (!pinHash || pinHash === 'admin_bypass') return false;
  if (!/^[a-f0-9]{64}$/i.test(pinHash)) return false;
  // 타인인데 과거 버그로 인해 개설자 핀이 그대로 복제된 경우 배제
  if (creatorName && creatorPinHash && creatorName !== targetName && pinHash === creatorPinHash) {
    return false;
  }
  return true;
};

// 현재 입력된 참가자의 PIN 등록 상태 실시간 분석
const selectedUserPinState = computed(() => {
  const name = inputName.value.trim();
  if (!name || props.isAdmin) return { exists: false, hasPin: false };

  let exists = false;
  let hasPin = false;

  for (const d of props.dates) {
    if (d.creator === name) {
      exists = true;
      if (isValidPersonalPinHash(name, d.creatorPinHash, d.creator, d.creatorPinHash)) {
        hasPin = true;
        break;
      }
    }
    const match = d.attendees?.find(a => a.name === name);
    if (match) {
      exists = true;
      if (isValidPersonalPinHash(name, match.pinHash, d.creator, d.creatorPinHash)) {
        hasPin = true;
        break;
      }
    }
  }

  return { exists, hasPin };
});

const handleLogin = async () => {
  errorMessage.value = '';
  const trimmedName = inputName.value.trim();
  const trimmedPin = inputPin.value.trim();

  if (!trimmedName) {
    errorMessage.value = '참가자 이름을 입력해주세요.';
    return;
  }

  // 관리자는 PIN 불필요, 즉시 지정
  if (props.isAdmin) {
    emit('loginSuccess', trimmedName, 'admin_bypass');
    emit('close');
    return;
  }

  // 락아웃 확인
  const lockStatus = checkPinLockout(trimmedName);
  if (lockStatus.isLocked) {
    errorMessage.value = `보안을 위해 ${lockStatus.remainingSeconds}초 동안 시도가 제한됩니다.`;
    return;
  }

  // 개인 PIN 미설정 상태인 경우 로그인 원천 차단
  if (selectedUserPinState.value.exists && !selectedUserPinState.value.hasPin) {
    errorMessage.value = `'${trimmedName}' 님은 개인 PIN이 설정되지 않아 로그인할 수 없습니다. PIN 설정을 위해 관리자에게 문의해주세요.`;
    return;
  }

  if (!trimmedPin || trimmedPin.length < 4) {
    errorMessage.value = '확인 PIN(4~8자리)을 입력해주세요.';
    return;
  }

  isVerifying.value = true;
  await applyDelayIfRepeated(trimmedName);

  try {
    const inputHash = await hashPin(trimmedPin);

    // 1. 현재 월 스케줄에서 대상 참가자의 유효 pinHash 조회
    let foundPinHash: string | undefined;
    let userExistsInSchedule = false;

    for (const d of props.dates) {
      if (d.creator === trimmedName) {
        userExistsInSchedule = true;
        if (isValidPersonalPinHash(trimmedName, d.creatorPinHash, d.creator, d.creatorPinHash)) {
          foundPinHash = d.creatorPinHash;
          break;
        }
      }
      const match = d.attendees?.find(a => a.name === trimmedName);
      if (match) {
        userExistsInSchedule = true;
        if (isValidPersonalPinHash(trimmedName, match.pinHash, d.creator, d.creatorPinHash)) {
          foundPinHash = match.pinHash;
          break;
        }
      }
    }

    // 2. 현재 월에 등록 기록이 없거나 PIN이 없는 경우 직전 월 데이터에서 추가 조회
    if (!foundPinHash) {
      try {
        const prevMonth = getPreviousMonthStr(props.currentMonth);
        const prevData = await fetchMonthSchedule(prevMonth);
        if (prevData && prevData.dates) {
          for (const d of prevData.dates) {
            if (d.creator === trimmedName) {
              userExistsInSchedule = true;
              if (isValidPersonalPinHash(trimmedName, d.creatorPinHash, d.creator, d.creatorPinHash)) {
                foundPinHash = d.creatorPinHash;
                break;
              }
            }
            const match = d.attendees?.find(a => a.name === trimmedName);
            if (match) {
              userExistsInSchedule = true;
              if (isValidPersonalPinHash(trimmedName, match.pinHash, d.creator, d.creatorPinHash)) {
                foundPinHash = match.pinHash;
                break;
              }
            }
          }
        }
      } catch (err) {
        console.warn('과거 월 PIN 조회 실패:', err);
      }
    }

    // 3. 해시 대조 및 판정 (PIN 미설정 사용자 로그인 원천 차단)
    if (!foundPinHash) {
      if (userExistsInSchedule) {
        errorMessage.value = `'${trimmedName}' 님은 개인 PIN이 설정되지 않은 상태입니다. PIN 설정을 위해 관리자에게 문의해주세요.`;
      } else {
        errorMessage.value = `'${trimmedName}' 이름으로 등록된 참석 일정이 없습니다. 본인 이름을 확인하거나 관리자에게 문의해주세요.`;
      }
      isVerifying.value = false;
      return;
    }

    // 4. 엄격한 1:1 해시 대조 (우회/기본 PIN 일체 차단)
    const isMatch = (foundPinHash === inputHash);

    if (isMatch) {
      recordPinSuccess(trimmedName);
      emit('loginSuccess', trimmedName, trimmedPin);
      emit('close');
    } else {
      const failResult = recordPinFailure(trimmedName);
      if (failResult.isLocked) {
        updateLockoutStatus();
        errorMessage.value = `연속 5회 실패로 보안을 위해 ${failResult.remainingSeconds}초 동안 입력이 차단됩니다.`;
      } else {
        const remainingTries = 5 - (failResult.failCount % 5);
        errorMessage.value = `PIN 번호가 일치하지 않습니다. (연속 ${remainingTries}회 더 실패 시 30초간 잠금)`;
      }
    }
  } catch (err) {
    console.error('로그인 인증 처리 중 오류:', err);
    errorMessage.value = '인증 처리 중 오류가 발생했습니다. 다시 시도해주세요.';
  } finally {
    isVerifying.value = false;
  }
};

const handleLogoutClick = () => {
  if (props.isAdmin) {
    errorMessage.value = '관리자 계정으로 로그인되어 있을 때는 로그아웃할 수 없습니다.';
    return;
  }
  if (confirm(`'${props.currentAttendeeName}' 님 계정에서 로그아웃하시겠습니까?`)) {
    emit('logout');
    emit('close');
  }
};
</script>

<template>
  <Transition name="apple-modal-fade">
    <div v-if="isOpen" class="apple-modal-backdrop" v-backdrop-dismiss="() => emit('close')">
      <div class="apple-modal-sheet login-modal-sheet">
        <!-- 헤더 -->
        <div class="sheet-header">
          <div class="header-titles">
            <span class="sheet-sub">
              {{ currentAttendeeName ? '참석 프로필' : '참석 관리 인증' }}
            </span>
            <h3 class="sheet-title">
              {{ currentAttendeeName ? '내 참석 계정 관리' : '내 참석자 로그인' }}
            </h3>
          </div>
          <button type="button" class="btn-close" @click="emit('close')" aria-label="닫기">✕</button>
        </div>

        <!-- 에러 배너 -->
        <div v-if="errorMessage" class="error-banner">
          {{ errorMessage }}
        </div>

        <!-- 락아웃 카운트다운 배너 -->
        <div v-if="isLocked" class="lockout-banner">
          <span class="lockout-title">보안 차단 모드</span>
          <span class="lockout-text">
            연속된 인증 실패로 인하여 일시 차단되었습니다.
            <strong>{{ remainingSeconds }}초</strong> 후 다시 시도할 수 있습니다.
          </span>
        </div>

        <div class="sheet-body">
          <!-- 1. 이미 로그인된 상태인 경우: 프로필 카드 모드 (로그아웃 버튼만 제공) -->
          <div v-if="currentAttendeeName" class="logged-in-profile-view">
            <div class="profile-card">
              <div class="profile-top-line">
                <span class="profile-status-pill">접속 계정</span>
                <span v-if="isAdmin" class="admin-badge-lock">관리자 연동</span>
              </div>
              <div class="profile-main-name">
                {{ currentAttendeeName }}
              </div>
              <div class="profile-meta-row">
                <span class="meta-label">이번 달 등록된 내 일정:</span>
                <span class="meta-value">{{ myAttendanceCount }}개</span>
              </div>
              <p class="profile-help-text">
                현재 본인 계정으로 인증되어 있습니다. 일정 상세 창에서 내 참석 일정을 직접 신청, 변경하거나 취소할 수 있습니다.
              </p>
            </div>

            <div class="profile-action-buttons">
              <button
                v-if="!isAdmin"
                type="button"
                class="btn-account-logout"
                @click="handleLogoutClick"
              >
                로그아웃
              </button>
            </div>
          </div>

          <!-- 2. 로그인되지 않은 경우: 입력 폼 모드 -->
          <div v-else class="login-form-view">
            <div class="login-instruction">
              <template v-if="isAdmin">
                관리자 권한은 PIN 입력 없이 참가자 이름을 선택하여 내 참석자 계정으로 즉시 지정하거나 변경할 수 있습니다.
              </template>
              <template v-else>
                참석 등록 시 설정했던 <strong>이름</strong>과 <strong>확인 PIN</strong>을 입력하면 본인 인증이 완료되어 내 참석 일정을 직접 관리할 수 있습니다.
              </template>
            </div>

            <!-- 참가자 이름 입력 -->
            <div class="form-group">
              <label class="form-label">참가자 이름</label>
              <input
                type="text"
                class="apple-input"
                v-model="inputName"
                placeholder="본인 이름을 입력하세요"
                maxlength="20"
                :disabled="(!isAdmin && isLocked) || isVerifying"
                @keyup.enter="handleLogin"
              />

              <!-- 최근 등록자 빠른 선택 칩 -->
              <div v-if="recentAttendeeNames.length > 0" class="recent-chips-box">
                <span class="recent-label">빠른 선택:</span>
                <div class="chips-list">
                  <button
                    v-for="name in recentAttendeeNames"
                    :key="name"
                    type="button"
                    class="recent-name-chip"
                    :class="{ active: inputName === name }"
                    @click="inputName = name"
                    :disabled="(!isAdmin && isLocked) || isVerifying"
                  >
                    {{ name }}
                  </button>
                </div>
              </div>
            </div>

            <!-- 개인 PIN 미등록 사용자 안내 배너 -->
            <div v-if="!isAdmin && selectedUserPinState.exists && !selectedUserPinState.hasPin" class="user-no-pin-notice">
              <span class="no-pin-title">개인 PIN 미설정 참가자</span>
              <span class="no-pin-desc">
                해당 참가자는 아직 개인 PIN이 설정되지 않았습니다.<br />
                PIN 로그인 및 비밀번호 설정을 위해 관리자에게 문의해주세요.
              </span>
            </div>

            <!-- 확인 PIN 입력 (일반 사용자) / 관리자 안내 -->
            <div v-if="!isAdmin" class="form-group">
              <label class="form-label">확인 PIN (4~8자리)</label>
              <input
                type="password"
                maxlength="8"
                inputmode="numeric"
                pattern="[0-9]*"
                class="apple-input pin-input"
                v-model="inputPin"
                placeholder="••••"
                :disabled="isLocked || isVerifying || (selectedUserPinState.exists && !selectedUserPinState.hasPin)"
                @keyup.enter="handleLogin"
              />
              <span class="pin-hint-text">
                ※ 무차별 대입 방지를 위해 5회 연속 불일치 시 30초간 입력이 차단됩니다.
              </span>
            </div>
            <div v-else class="admin-info-box">
              <span class="admin-no-pin-badge">관리자 (PIN 불필요)</span>
            </div>
          </div>
        </div>

        <!-- 푸터 버튼 -->
        <div class="sheet-footer">
          <template v-if="currentAttendeeName">
            <button type="button" class="btn-cancel btn-full-width" @click="emit('close')">
              닫기
            </button>
          </template>
          <template v-else>
            <button
              type="button"
              class="btn-cancel"
              @click="emit('close')"
            >
              닫기
            </button>
            <button
              type="button"
              class="btn-submit"
              :disabled="(!isAdmin && isLocked) || isVerifying || !inputName.trim() || (!isAdmin && !inputPin.trim()) || (!isAdmin && selectedUserPinState.exists && !selectedUserPinState.hasPin)"
              @click="handleLogin"
            >
              {{ isVerifying ? '확인 중...' : (isAdmin ? '참석자로 설정' : '인증 및 로그인') }}
            </button>
          </template>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.login-modal-sheet {
  max-width: 420px;
  width: 100%;
}

.logged-in-profile-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 4px 0 8px 0;
}

.profile-card {
  background: var(--bg-hover-color, #f8fafc);
  border: 1px solid var(--border-color, rgba(0, 0, 0, 0.08));
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
html.dark .profile-card {
  background: rgba(255, 255, 255, 0.03);
  border-color: rgba(255, 255, 255, 0.08);
}

.profile-top-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.profile-status-pill {
  font-size: 11px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(16, 185, 129, 0.12);
  color: #059669;
  border: 1px solid rgba(16, 185, 129, 0.25);
}
html.dark .profile-status-pill {
  background: rgba(16, 185, 129, 0.2);
  color: #34d399;
}

.profile-main-name {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-color, #0f172a);
  letter-spacing: -0.02em;
}
html.dark .profile-main-name {
  color: #f8fafc;
}

.profile-meta-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.meta-label {
  color: var(--text-dimmed, #64748b);
}

.meta-value {
  font-weight: 700;
  color: #2563eb;
}
html.dark .meta-value {
  color: #60a5fa;
}

.profile-help-text {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--text-dimmed, #64748b);
  border-top: 1px dashed var(--border-color, rgba(0, 0, 0, 0.08));
  padding-top: 8px;
}
html.dark .profile-help-text {
  border-color: rgba(255, 255, 255, 0.08);
  color: #94a3b8;
}

.profile-action-buttons {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.btn-switch-account {
  background: var(--bg-hover-color, #f1f5f9);
  border: 1px solid var(--border-color, rgba(0, 0, 0, 0.12));
  color: var(--text-color, #334155);
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: inherit;
}
.btn-switch-account:hover {
  background: #e2e8f0;
  border-color: #cbd5e1;
}
html.dark .btn-switch-account {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.1);
  color: #cbd5e1;
}
html.dark .btn-switch-account:hover {
  background: rgba(255, 255, 255, 0.1);
}

.btn-account-logout {
  background: transparent;
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #ef4444;
  padding: 9px 14px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: inherit;
}
.btn-account-logout:hover {
  background: rgba(239, 68, 68, 0.08);
}

.switch-cancel-bar {
  margin-bottom: 12px;
}

.btn-back-to-profile {
  background: none;
  border: none;
  color: #2563eb;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
  display: inline-flex;
  align-items: center;
}
.btn-back-to-profile:hover {
  text-decoration: underline;
}
html.dark .btn-back-to-profile {
  color: #60a5fa;
}

.btn-full-width {
  width: 100%;
}

.current-session-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg-hover-color, #f1f5f9);
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid var(--border-color, rgba(0, 0, 0, 0.08));
  margin-bottom: 12px;
}
html.dark .current-session-box {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.08);
}

.current-user-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.info-label {
  font-size: 11px;
  color: var(--text-dimmed, #64748b);
  font-weight: 500;
}

.current-name-tag {
  font-size: 13px;
  font-weight: 700;
  color: #2563eb;
}
html.dark .current-name-tag {
  color: #60a5fa;
}

.btn-logout {
  background: transparent;
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #ef4444;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-logout:hover {
  background: rgba(239, 68, 68, 0.1);
}

.admin-badge-lock {
  font-size: 11px;
  font-weight: 700;
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(239, 68, 68, 0.1);
  color: #dc2626;
  border: 1px solid rgba(239, 68, 68, 0.2);
}

.admin-info-box {
  margin-top: 4px;
}

.admin-no-pin-badge {
  font-size: 11px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 6px;
  background: rgba(14, 165, 233, 0.1);
  color: #0284c7;
  border: 1px solid rgba(14, 165, 233, 0.2);
}

.login-instruction {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-dimmed, #64748b);
  margin-bottom: 14px;
}
html.dark .login-instruction {
  color: #94a3b8;
}

.recent-chips-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}

.recent-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-dimmed, #64748b);
}

.chips-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.recent-name-chip {
  background: var(--bg-hover-color, #f8fafc);
  border: 1px solid var(--border-color, rgba(0, 0, 0, 0.1));
  color: var(--text-color, #334155);
  font-size: 11px;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: inherit;
}
.recent-name-chip:hover {
  border-color: #3b82f6;
  color: #2563eb;
}
.recent-name-chip.active {
  background: #2563eb;
  border-color: #2563eb;
  color: #ffffff;
}
html.dark .recent-name-chip {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.1);
  color: #cbd5e1;
}
html.dark .recent-name-chip.active {
  background: #3b82f6;
  border-color: #3b82f6;
  color: #ffffff;
}

.pin-hint-text {
  display: block;
  font-size: 11px;
  color: var(--text-dimmed, #64748b);
  margin-top: 6px;
  line-height: 1.4;
}

.lockout-banner {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  padding: 10px 14px;
  border-radius: 10px;
  margin: 0 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.lockout-title {
  font-size: 12px;
  font-weight: 700;
  color: #ef4444;
}
.lockout-text {
  font-size: 11px;
  color: #dc2626;
  line-height: 1.4;
}
html.dark .lockout-text {
  color: #f87171;
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
  border-radius: 18px;
  box-shadow: 0 20px 45px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  max-height: 90vh;
}

.sheet-header {
  padding: 16px 18px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-color, rgba(0, 0, 0, 0.06));
}

.header-titles {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sheet-sub {
  font-size: 11px;
  color: var(--text-dimmed, #64748b);
  font-weight: 500;
}

.sheet-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--text-color, #0f172a);
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
  padding: 16px 18px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-color, #334155);
}

.apple-input {
  width: 100%;
  box-sizing: border-box;
  padding: 9px 12px;
  border-radius: 9px;
  border: 1px solid var(--border-color, rgba(0, 0, 0, 0.12));
  background: var(--input-bg-color, #f8fafc);
  color: var(--text-color, #0f172a);
  font-size: 13px;
  outline: none;
  transition: all 0.15s ease;
  font-family: inherit;
}
.apple-input:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
}
.apple-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.pin-input {
  letter-spacing: 0.25em;
  font-weight: 700;
  max-width: 140px;
  text-align: center;
  font-size: 15px;
}

.error-banner {
  background: rgba(239, 68, 68, 0.1);
  color: #dc2626;
  font-size: 11px;
  padding: 8px 14px;
  margin: 10px 18px 0;
  border-radius: 8px;
  border: 1px solid rgba(239, 68, 68, 0.25);
  font-weight: 600;
}

.user-no-pin-notice {
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 9px;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.no-pin-title {
  font-size: 12px;
  font-weight: 700;
  color: #b45309;
}
html.dark .no-pin-title {
  color: #fbbf24;
}
.no-pin-desc {
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--text-color, #475569);
}
html.dark .no-pin-desc {
  color: #cbd5e1;
}

.sheet-footer {
  padding: 12px 18px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  border-top: 1px solid var(--border-color, rgba(0, 0, 0, 0.06));
  background: var(--bg-hover-color, #f8fafc);
}
html.dark .sheet-footer {
  background: rgba(30, 41, 59, 0.4);
}

.btn-cancel {
  background: transparent;
  border: 1px solid var(--border-color, rgba(0, 0, 0, 0.12));
  color: var(--text-color, #334155);
  padding: 7px 14px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
}

.btn-submit {
  background: #2563eb;
  color: #ffffff;
  border: none;
  padding: 7px 16px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s ease;
  font-family: inherit;
}
.btn-submit:hover:not(:disabled) {
  opacity: 0.9;
}
.btn-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.apple-modal-fade-enter-active,
.apple-modal-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.apple-modal-fade-enter-from,
.apple-modal-fade-leave-to {
  opacity: 0;
  transform: scale(0.96);
}
</style>
