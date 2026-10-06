/**
 * PIN 브루트포스(무차별 대입) 공격 방어를 위한 Rate Limiter 및 락아웃 관리 유틸리티
 */

const STORAGE_KEY = 'mahjong_pin_rate_limit';

interface AttemptRecord {
  failCount: number;
  lockedUntil: number;
  lastAttempt: number;
}

function getAttemptStore(): Record<string, AttemptRecord> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveAttemptStore(store: Record<string, AttemptRecord>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (e) {
    console.warn('Rate limit store save failed:', e);
  }
}

/**
 * 특정 키(이름 또는 식별자)에 대한 현재 락아웃 상태 조회
 */
export function checkPinLockout(key: string): {
  isLocked: boolean;
  remainingSeconds: number;
  failCount: number;
} {
  const normKey = (key || 'global').trim().toLowerCase();
  const store = getAttemptStore();
  const record = store[normKey];

  if (!record) {
    return { isLocked: false, remainingSeconds: 0, failCount: 0 };
  }

  const now = Date.now();
  if (record.lockedUntil > now) {
    const remainingSeconds = Math.ceil((record.lockedUntil - now) / 1000);
    return {
      isLocked: true,
      remainingSeconds,
      failCount: record.failCount
    };
  }

  // 잠금 시간이 지났고 15분 이상 경과 시 레코드 정리
  if (record.lockedUntil > 0 && now - record.lockedUntil > 15 * 60 * 1000) {
    delete store[normKey];
    saveAttemptStore(store);
    return { isLocked: false, remainingSeconds: 0, failCount: 0 };
  }

  return { isLocked: false, remainingSeconds: 0, failCount: record.failCount };
}

/**
 * PIN 실패 기록 및 락아웃 계산
 * - 5회 실패: 30초 잠금
 * - 10회 실패: 5분(300초) 잠금
 * - 15회 이상 실패: 15분(900초) 잠금
 */
export function recordPinFailure(key: string): {
  isLocked: boolean;
  remainingSeconds: number;
  failCount: number;
} {
  const normKey = (key || 'global').trim().toLowerCase();
  const store = getAttemptStore();
  const record = store[normKey] || { failCount: 0, lockedUntil: 0, lastAttempt: 0 };

  record.failCount += 1;
  record.lastAttempt = Date.now();

  let lockDurationMs = 0;
  if (record.failCount >= 15) {
    lockDurationMs = 15 * 60 * 1000; // 15분
  } else if (record.failCount >= 10) {
    lockDurationMs = 5 * 60 * 1000; // 5분
  } else if (record.failCount >= 5) {
    lockDurationMs = 30 * 1000; // 30초
  }

  if (lockDurationMs > 0) {
    record.lockedUntil = Date.now() + lockDurationMs;
  }

  store[normKey] = record;
  saveAttemptStore(store);

  const remainingSeconds = lockDurationMs > 0 ? Math.ceil(lockDurationMs / 1000) : 0;
  return {
    isLocked: lockDurationMs > 0,
    remainingSeconds,
    failCount: record.failCount
  };
}

/**
 * PIN 인증 성공 시 실패 기록 초기화
 */
export function recordPinSuccess(key: string): void {
  const normKey = (key || 'global').trim().toLowerCase();
  const store = getAttemptStore();
  if (store[normKey]) {
    delete store[normKey];
    saveAttemptStore(store);
  }
}

/**
 * 반복 실패 시 인위적 지연 적용 (고속 스크립트 대입 방지)
 */
export async function applyDelayIfRepeated(key: string): Promise<void> {
  const normKey = (key || 'global').trim().toLowerCase();
  const store = getAttemptStore();
  const record = store[normKey];

  if (!record || record.failCount < 3) {
    return;
  }

  // 3회 이상 실패 시 1.2초 지연
  const delayMs = Math.min(record.failCount * 400, 2000);
  await new Promise(resolve => setTimeout(resolve, delayMs));
}
