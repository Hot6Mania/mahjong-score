import type { ScheduleDayItem, ScheduleMonthData, ScheduleHistoryItem, ScheduleCommitsResponse } from '@/types/schedule';
import { computeSessionTimeFromAttendees } from '@/utils/timelineEngine';

export function getWorkerUrl(): string {
  const custom = localStorage.getItem('google_auth_worker_url');
  if (custom && custom.trim()) {
    return custom.trim().replace(/\/+$/, '');
  }
  const envUrl = (import.meta as any).env?.VITE_GOOGLE_AUTH_WORKER_URL;
  if (envUrl && envUrl.trim()) {
    return envUrl.trim().replace(/\/+$/, '');
  }
  return 'https://mahjong-score.cnabe.workers.dev';
}

// 로컬 스토리지 키 정의
const STORAGE_SCHEDULE_PREFIX = 'mahjong_schedule_';
const STORAGE_HISTORY_PREFIX = 'mahjong_schedule_history_';
const STORAGE_PIN_MAP = 'mahjong_schedule_pins';
const STORAGE_LAST_NAME = 'mahjong_schedule_last_name';

/**
 * SHA-256 해시 생성 (브라우저 SubtleCrypto API 활용)
 */
export async function hashPin(pin: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(`salt_mahjong_2026_${pin}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 서버에 PIN 일치 여부 확인 요청 (보안 강화: 클라이언트에 해시 노출 없음)
 */
export async function verifyUserPin(params: {
  month: string;
  date?: string;
  name?: string;
  pin: string;
  isCreator?: boolean;
}): Promise<{ success: boolean; valid: boolean; isNew?: boolean }> {
  try {
    const res = await fetch(`${getWorkerUrl()}/api/schedule/auth/verify-pin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(params)
    });
    if (res.ok) {
      const data = await res.json();
      return {
        success: data.success ?? false,
        valid: data.valid ?? false,
        isNew: data.isNew
      };
    }
  } catch (err) {
    console.warn('PIN 검증 API 실패:', err);
  }
  return { success: false, valid: false };
}

/**
 * 로컬에 저장된 사용자 PIN 맵 조회
 */
export function getSavedPins(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_PIN_MAP);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * 사용자 이름에 매핑된 PIN 저장
 */
export function saveUserPin(name: string, pin: string, updateLastName = true): void {
  if (!name || !pin) return;
  const pins = getSavedPins();
  pins[name.trim()] = pin.trim();
  localStorage.setItem(STORAGE_PIN_MAP, JSON.stringify(pins));
  if (updateLastName) {
    localStorage.setItem(STORAGE_LAST_NAME, name.trim());
  }
}

/**
 * 사용자 본인 참가자 이름 저장
 */
export function setLastAttendeeName(name: string): void {
  if (name) {
    localStorage.setItem(STORAGE_LAST_NAME, name.trim());
  }
}

/**
 * 마지막으로 사용한 참가자 이름 조회
 */
export function getLastAttendeeName(): string {
  return localStorage.getItem(STORAGE_LAST_NAME) || '';
}

/**
 * 로컬 스토리지 기반 오프라인/폴백 스케줄 조회
 */
export function getLocalMonthSchedule(month: string): ScheduleMonthData {
  try {
    const raw = localStorage.getItem(`${STORAGE_SCHEDULE_PREFIX}${month}`);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    console.warn('로컬 스케줄 파싱 오류:', e);
  }

  // 기본 빈 스케줄 반환
  return {
    month,
    updatedAt: Date.now(),
    dates: []
  };
}

/**
 * 로컬 스토리지에 스케줄 저장
 */
function saveLocalMonthSchedule(data: ScheduleMonthData): void {
  try {
    localStorage.setItem(`${STORAGE_SCHEDULE_PREFIX}${data.month}`, JSON.stringify(data));
  } catch (e) {
    console.warn('로컬 스케줄 저장 오류:', e);
  }
}

/**
 * 로컬 스토리지 감사 로그 조회
 */
export function getLocalScheduleHistory(month: string): ScheduleHistoryItem[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_HISTORY_PREFIX}${month}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * 로컬 스토리지 감사 로그 저장
 */
export function saveLocalScheduleHistory(month: string, history: ScheduleHistoryItem[]): void {
  try {
    localStorage.setItem(`${STORAGE_HISTORY_PREFIX}${month}`, JSON.stringify(history.slice(0, 100)));
  } catch (e) {
    console.warn('로컬 감사 로그 저장 실패:', e);
  }
}

/**
 * 일정 변동 감사 로그 기록 (로컬 및 Worker 동시 전송)
 */
export async function logScheduleHistory(
  month: string,
  entry: Omit<ScheduleHistoryItem, 'id' | 'timestamp'> & { id?: string; timestamp?: number }
): Promise<void> {
  const item: ScheduleHistoryItem = {
    id: entry.id || `hist_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: entry.timestamp || Date.now(),
    action: entry.action,
    targetDate: entry.targetDate,
    actorName: entry.actorName,
    details: entry.details,
    clientIp: entry.clientIp
  };

  // 1. 로컬 스토리지 즉시 반영
  const current = getLocalScheduleHistory(month);
  current.unshift(item);
  saveLocalScheduleHistory(month, current);

  // 2. Worker 비동기 전송
  try {
    await fetch(`${getWorkerUrl()}/api/schedule/admin/history/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month, entry: item })
    });
  } catch (e) {
    console.warn('Worker 감사 로그 전송 실패:', e);
  }
}

/**
 * 일정 변동 감사 로그 조회 (Worker API 우선, 로컬 폴백)
 */
export async function fetchScheduleHistory(month: string, adminToken?: string): Promise<ScheduleHistoryItem[]> {
  const localList = getLocalScheduleHistory(month);
  const passcode = getAdminPasscode();
  const token = adminToken || localStorage.getItem('google_access_token') || '';

  try {
    const res = await fetch(`${getWorkerUrl()}/api/schedule/admin/history?month=${encodeURIComponent(month)}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': token ? `Bearer ${token}` : '',
        'X-Admin-Passcode': passcode || ''
      }
    });

    if (res.ok) {
      const json = await res.json();
      if (json && json.success && Array.isArray(json.data)) {
        // 서버 로그와 로컬 로그 병합 (id 기준 중복 제거)
        const map = new Map<string, ScheduleHistoryItem>();
        for (const item of json.data) map.set(item.id, item);
        for (const item of localList) {
          if (!map.has(item.id)) map.set(item.id, item);
        }
        const merged = Array.from(map.values()).sort((a, b) => b.timestamp - a.timestamp).slice(0, 100);
        saveLocalScheduleHistory(month, merged);
        return merged;
      }
    }
  } catch (err) {
    console.warn('Worker 감사 로그 조회 실패, 로컬 캐시 사용:', err);
  }

  return localList;
}

/**
 * 세션 스토리지에 저장된 관리자 인증 코드 조회
 */
export function getAdminPasscode(): string {
  return sessionStorage.getItem('schedule_admin_passcode') || '';
}

/**
 * 월별 일정 데이터 조회 (Worker API 우선, 장애 또는 미설정 시 로컬 폴백)
 */
export async function fetchMonthSchedule(month: string): Promise<ScheduleMonthData> {
  const local = getLocalMonthSchedule(month);

  try {
    const res = await fetch(`${getWorkerUrl()}/api/schedule?month=${encodeURIComponent(month)}&_t=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (res.ok) {
      const json = await res.json();
      if (json && json.success && json.data) {
        // 만약 서버에서 반환된 dates가 비어있고, 로컬에 저장된 일정이 이미 있다면 (KV 미연결 등) 로컬 일정을 우선 보존 및 서버 KV 자동 복구
        if ((!json.data.dates || json.data.dates.length === 0) && local.dates && local.dates.length > 0) {
          console.info('서버 일정이 비어 있어 로컬에 저장된 일정을 우선 유지하며, 서버 KV로 자동 복원 동기화를 시도합니다.');
          // 백그라운드 서버 KV 자동 복원 시도
          setTimeout(async () => {
            try {
              const cipher = localStorage.getItem('google_refresh_cipher');
              const accessToken = localStorage.getItem('google_access_token');
              const passcode = getAdminPasscode();
              await fetch(`${getWorkerUrl()}/api/schedule/admin/dates`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  month,
                  dates: local.dates,
                  refresh_cipher: cipher,
                  access_token: accessToken,
                  admin_passcode: passcode
                })
              });
            } catch (syncErr) {
              console.warn('서버 KV 자동 복원 동기화 실패:', syncErr);
            }
          }, 300);
          return local;
        }

        saveLocalMonthSchedule(json.data); // 로컬 캐시 갱신
        return json.data;
      }
    }
  } catch (err) {
    console.warn('Worker 스케줄 API 호출 실패, 로컬 캐시 사용:', err);
  }

  return local;
}

/**
 * 관리자 권한 확인 (Google 로그인 access_token / refresh_cipher 검증 및 관리자 인증 코드)
 * 관리자 이메일은 절대 클라이언트로 전송되지 않고 서버에서만 검증됩니다.
 */
export async function checkAdminStatus(): Promise<{ isAdmin: boolean; adminToken?: string; attendeeName?: string }> {
  const isGoogleLoggedIn = localStorage.getItem('google_is_logged_in') === 'true';
  const cipher = localStorage.getItem('google_refresh_cipher');
  const accessToken = localStorage.getItem('google_access_token');
  const passcode = getAdminPasscode();

  // 구글 로그인이 명시적으로 풀려있고 관리자 패스코드도 없는 경우 즉시 관리자 해제
  if (!isGoogleLoggedIn && !cipher && !accessToken && !passcode) {
    sessionStorage.removeItem('schedule_admin_verified');
    sessionStorage.removeItem('schedule_admin_attendee_name');
    return { isAdmin: false };
  }

  try {
    const res = await fetch(`${getWorkerUrl()}/api/schedule/auth/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refresh_cipher: cipher,
        access_token: accessToken,
        admin_passcode: passcode
      })
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.success && data.isAdmin) {
        sessionStorage.setItem('schedule_admin_verified', 'true');
        if (data.attendeeName) {
          sessionStorage.setItem('schedule_admin_attendee_name', data.attendeeName);
        }
        if (data.access_token) {
          localStorage.setItem('google_access_token', data.access_token);
          localStorage.setItem('google_token_expires_at', String(Date.now() + 3600 * 1000));
        }
        return {
          isAdmin: true,
          adminToken: data.adminToken,
          attendeeName: data.attendeeName
        };
      } else {
        // 서버에서 관리자 아님 판정: 세션 스토리지 파기
        sessionStorage.removeItem('schedule_admin_verified');
        sessionStorage.removeItem('schedule_admin_attendee_name');
        return { isAdmin: false };
      }
    }
  } catch (err) {
    console.warn('관리자 권한 확인 API 호출 실패:', err);
  }

  // API 호출이 일시적 네트워크 장애로 실패했을 때, 구글 로그인이 실제로 유지되어 있고 캐시가 있을 때만 한정 폴백
  const cachedAdmin = sessionStorage.getItem('schedule_admin_verified') === 'true';
  const cachedAttendeeName = sessionStorage.getItem('schedule_admin_attendee_name') || undefined;
  if ((isGoogleLoggedIn || passcode) && cachedAdmin) {
    return { isAdmin: true, attendeeName: cachedAttendeeName };
  }

  sessionStorage.removeItem('schedule_admin_verified');
  sessionStorage.removeItem('schedule_admin_attendee_name');
  return { isAdmin: false };
}

export interface AdminPasscodeInfo {
  id: string;
  label: string;
  createdAt: number;
  hasCode?: boolean;
}

/**
 * 등록된 관리자 인증 코드 목록 조회
 */
export async function fetchAdminPasscodes(): Promise<{
  success: boolean;
  passcodes: AdminPasscodeInfo[];
  error?: string;
}> {
  const cipher = localStorage.getItem('google_refresh_cipher');
  const accessToken = localStorage.getItem('google_access_token');
  const passcode = getAdminPasscode();

  try {
    const res = await fetch(`${getWorkerUrl()}/api/schedule/admin/passcodes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refresh_cipher: cipher,
        access_token: accessToken,
        admin_passcode: passcode
      })
    });

    const json = await res.json().catch(() => null);
    if (res.ok && json && json.success) {
      return { success: true, passcodes: json.passcodes || [] };
    } else {
      return { success: false, passcodes: [], error: json?.error || '관리자 코드 목록을 불러오지 못했습니다.' };
    }
  } catch (err: any) {
    return { success: false, passcodes: [], error: err.message || '네트워크 오류가 발생했습니다.' };
  }
}

/**
 * 신규 관리자 인증 코드 추가
 */
export async function addAdminPasscode(
  label: string,
  newPasscode: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  const trimmedLabel = label.trim() || '운영진';
  const trimmedCode = newPasscode.trim();
  if (!trimmedCode || trimmedCode.length < 4) {
    return { success: false, error: '인증 코드는 4자리 이상이어야 합니다.' };
  }

  const cipher = localStorage.getItem('google_refresh_cipher');
  const accessToken = localStorage.getItem('google_access_token');
  const currentPasscode = getAdminPasscode();

  try {
    const res = await fetch(`${getWorkerUrl()}/api/schedule/admin/passcode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'add',
        label: trimmedLabel,
        new_passcode: trimmedCode,
        refresh_cipher: cipher,
        access_token: accessToken,
        admin_passcode: currentPasscode
      })
    });

    const json = await res.json().catch(() => null);
    if (res.ok && json && json.success) {
      return { success: true, message: json.message || '관리자 코드가 성공적으로 등록되었습니다.' };
    } else {
      return { success: false, error: json?.error || '관리자 코드 등록에 실패했습니다.' };
    }
  } catch (err: any) {
    return { success: false, error: err.message || '네트워크 오류가 발생했습니다.' };
  }
}

/**
 * 특정 관리자 인증 코드 개별 삭제
 */
export async function deleteAdminPasscodeById(
  id: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  const cipher = localStorage.getItem('google_refresh_cipher');
  const accessToken = localStorage.getItem('google_access_token');
  const currentPasscode = getAdminPasscode();

  try {
    const res = await fetch(`${getWorkerUrl()}/api/schedule/admin/passcode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'delete',
        id,
        refresh_cipher: cipher,
        access_token: accessToken,
        admin_passcode: currentPasscode
      })
    });

    const json = await res.json().catch(() => null);
    if (res.ok && json && json.success) {
      return { success: true, message: json.message || '관리자 코드가 삭제되었습니다.' };
    } else {
      return { success: false, error: json?.error || '관리자 코드 삭제에 실패했습니다.' };
    }
  } catch (err: any) {
    return { success: false, error: err.message || '네트워크 오류가 발생했습니다.' };
  }
}

/**
 * 모든 관리자 인증 코드 일괄 삭제 (구글 로그인 전용 모드 전환)
 */
export async function clearAllAdminPasscodes(): Promise<{ success: boolean; message?: string; error?: string }> {
  const cipher = localStorage.getItem('google_refresh_cipher');
  const accessToken = localStorage.getItem('google_access_token');
  const currentPasscode = getAdminPasscode();

  try {
    const res = await fetch(`${getWorkerUrl()}/api/schedule/admin/passcode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'clear_all',
        refresh_cipher: cipher,
        access_token: accessToken,
        admin_passcode: currentPasscode
      })
    });

    const json = await res.json().catch(() => null);
    if (res.ok && json && json.success) {
      sessionStorage.removeItem('schedule_admin_passcode');
      return { success: true, message: json.message || '모든 관리자 코드가 삭제되었습니다.' };
    } else {
      return { success: false, error: json?.error || '관리자 코드 삭제에 실패했습니다.' };
    }
  } catch (err: any) {
    return { success: false, error: err.message || '네트워크 오류가 발생했습니다.' };
  }
}

// 레거시 호환용 단일 함수
export async function updateAdminPasscode(newPasscode: string) {
  return addAdminPasscode('기본 관리자', newPasscode);
}
export async function deleteAdminPasscode() {
  return clearAllAdminPasscodes();
}

/**
 * 관리자 후보 날짜 일괄 등록/수정 (Worker API -> 로컬 폴백)
 */
export async function saveAdminScheduleDates(
  month: string,
  dates: ScheduleDayItem[],
  adminToken?: string,
  creatorPin?: string,
  options?: { baseSessionNumber?: number; isClearAttendees?: boolean; isToggleConfirm?: boolean; isCreateSession?: boolean; targetDate?: string }
): Promise<{ success: boolean; data: ScheduleMonthData; error?: string }> {
  const payload: ScheduleMonthData = {
    month,
    updatedAt: Date.now(),
    dates
  };

  // 1. 항상 로컬 스토리지에 먼저 확실하게 저장하여 유실 방지
  saveLocalMonthSchedule(payload);

  const cipher = localStorage.getItem('google_refresh_cipher');
  const accessToken = localStorage.getItem('google_access_token');
  const passcode = getAdminPasscode();
  const lastName = getLastAttendeeName();

  try {
    const res = await fetch(`${getWorkerUrl()}/api/schedule/admin/dates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        month,
        dates,
        base_session_number: options?.baseSessionNumber,
        is_clear_attendees: options?.isClearAttendees,
        is_toggle_confirm: options?.isToggleConfirm,
        is_create_session: options?.isCreateSession,
        target_date: options?.targetDate,
        creator_name: lastName,
        creator_pin: creatorPin,
        pin: creatorPin,
        my_name: lastName,
        refresh_cipher: cipher,
        access_token: accessToken,
        admin_token: adminToken,
        admin_passcode: passcode
      })
    });

    if (res.ok) {
      const json = await res.json();
      if (json && json.success && json.data) {
        saveLocalMonthSchedule(json.data);
        return { success: true, data: json.data };
      }
    } else {
      const errJson = await res.json().catch(() => null);
      if (errJson && errJson.error) {
        console.warn('Worker 날짜 저장 거부:', errJson.error);
      }
    }
  } catch (err) {
    console.warn('Worker 날짜 저장 실패, 로컬에 저장 완료:', err);
  }

  // 폴백: 로컬 스토리지에 저장된 데이터 반환
  return { success: true, data: payload };
}

/**
 * 참석 등록 또는 수정 (관리자는 PIN 생략 가능)
 */
export async function submitAttendance(
  month: string,
  date: string,
  attendeeInput: {
    name: string;
    isOvernight: boolean;
    startTime: string;
    endTime: string;
    isCustomTime?: boolean;
    memo?: string;
  },
  pin: string,
  isAdmin?: boolean,
  isProxy?: boolean
): Promise<{ success: boolean; data: ScheduleMonthData; error?: string }> {
  const trimmedName = attendeeInput.name.trim();
  const trimmedPin = pin.trim();

  if (!trimmedName) {
    return { success: false, data: getLocalMonthSchedule(month), error: '이름을 입력해주세요.' };
  }
  if (!isAdmin && (!trimmedPin || trimmedPin.length < 4)) {
    return { success: false, data: getLocalMonthSchedule(month), error: '4자리 확인 PIN을 입력해주세요.' };
  }

  const pinHash = (trimmedPin && trimmedPin.length >= 4 && trimmedPin !== 'admin_bypass') ? await hashPin(trimmedPin) : '';

  // 사칭 방지: 해당 참가자 이름이 이번 달에 이미 등록되어 PIN 해시가 존재하면 일치 여부 필수 확인
  if (!isAdmin && !isProxy) {
    const currentLocal = getLocalMonthSchedule(month);
    let existingUserPinHash: string | undefined;
    for (const d of currentLocal.dates) {
      const match = d.attendees?.find(a => a.name === trimmedName);
      if (match?.pinHash && match.pinHash !== 'admin_bypass') {
        existingUserPinHash = match.pinHash;
        break;
      }
      if (d.creator === trimmedName && d.creatorPinHash && d.creatorPinHash !== 'admin_bypass') {
        existingUserPinHash = d.creatorPinHash;
        break;
      }
    }
    if (existingUserPinHash && pinHash !== existingUserPinHash) {
      return {
        success: false,
        data: currentLocal,
        error: `'${trimmedName}' 이름으로 이미 등록된 일정이 있습니다. 본인의 기존 PIN을 입력해주세요. (사칭 방지)`
      };
    }
  }

  const cipher = localStorage.getItem('google_refresh_cipher');
  const lastName = getLastAttendeeName();

  try {
    const res = await fetch(`${getWorkerUrl()}/api/schedule/attend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        month,
        date,
        attendee: {
          ...attendeeInput,
          name: trimmedName,
          pinHash
        },
        pin: trimmedPin,
        creator_name: lastName,
        my_name: lastName,
        refresh_cipher: cipher,
        access_token: localStorage.getItem('google_access_token'),
        admin_passcode: getAdminPasscode()
      })
    });

    if (res.ok) {
      const json = await res.json();
      if (json && json.success && json.data) {
        if (trimmedPin && trimmedPin.length >= 4 && trimmedPin !== 'admin_bypass') {
          saveUserPin(trimmedName, trimmedPin, !isProxy);
        }
        saveLocalMonthSchedule(json.data);
        return { success: true, data: json.data };
      } else if (json && json.error) {
        return { success: false, data: getLocalMonthSchedule(month), error: json.error };
      }
    }
  } catch (err) {
    console.warn('Worker 참석 등록 실패, 로컬 처리 진행:', err);
  }

  // 로컬 폴백 처리
  const currentData = getLocalMonthSchedule(month);
  const targetDay = currentData.dates.find(d => d.date === date);

  if (!targetDay) {
    return { success: false, data: currentData, error: '해당 날짜의 일정을 찾을 수 없습니다.' };
  }

  if (!targetDay.attendees) {
    targetDay.attendees = [];
  }

  const isCreator = !!(targetDay.creator && targetDay.creator === lastName);
  const canManage = !!(isAdmin || isCreator);

  const existingIdx = targetDay.attendees.findIndex(a => a.name === trimmedName);
  if (existingIdx !== -1) {
    // 기존 참가자 수정 시 PIN 대조 (관리자/개설자는 무조건 통과)
    const existing = targetDay.attendees[existingIdx];
    if (!canManage && existing.pinHash && existing.pinHash !== 'admin_bypass' && existing.pinHash !== pinHash) {
      return { success: false, data: currentData, error: 'PIN 비밀번호가 일치하지 않습니다.' };
    }
    // 기존 참가자의 본인 고유 유효 PIN (과거 버그로 인한 개설자 핀 복사값 배제)
    const existingValidPin = (existing.pinHash && existing.pinHash !== 'admin_bypass' && (existing.name === targetDay.creator || existing.pinHash !== targetDay.creatorPinHash)) ? existing.pinHash : '';
    const finalPin = pinHash || existingValidPin || '';

    targetDay.attendees[existingIdx] = {
      ...existing,
      isOvernight: attendeeInput.isOvernight,
      startTime: attendeeInput.startTime,
      endTime: attendeeInput.endTime,
      isCustomTime: attendeeInput.isCustomTime,
      memo: attendeeInput.memo,
      pinHash: finalPin,
      updatedAt: Date.now()
    };
  } else {
    // 신규 참가자 추가: 본인이 직접 유효 PIN을 입력하지 않은 경우(대리 등록 등)에는 빈 문자열('')로 격리 (기본 PIN이나 개설자 PIN 절대 상속 금지)
    targetDay.attendees.push({
      id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: trimmedName,
      isOvernight: attendeeInput.isOvernight,
      startTime: attendeeInput.startTime,
      endTime: attendeeInput.endTime,
      isCustomTime: attendeeInput.isCustomTime,
      memo: attendeeInput.memo,
      pinHash: pinHash || '',
      updatedAt: Date.now()
    });
  }

  // 참가자 시간 기준 모임 시간 유동적 자동 동기화
  const updatedSession = computeSessionTimeFromAttendees(targetDay.attendees, targetDay.adminSessionType || targetDay.sessionType);
  targetDay.customStartTime = updatedSession.customStartTime;
  targetDay.customEndTime = updatedSession.customEndTime;
  targetDay.customIsOvernight = updatedSession.customIsOvernight;
  targetDay.sessionType = updatedSession.sessionType;

  currentData.updatedAt = Date.now();
  if (trimmedPin && trimmedPin.length >= 4) {
    saveUserPin(trimmedName, trimmedPin, !isProxy);
  }
  saveLocalMonthSchedule(currentData);

  logScheduleHistory(month, {
    action: 'ATTEND',
    targetDate: date,
    actorName: isProxy ? (lastName || '관리자/개설자') : trimmedName,
    details: `'${trimmedName}' 참석 등록/수정 (${attendeeInput.startTime}~${attendeeInput.endTime}${attendeeInput.isOvernight ? ' 익일' : ''})`
  });

  return { success: true, data: currentData };
}

/**
 * 다중 참석자 일괄 등록 (관리자 및 개설자 모드)
 */
export async function submitBatchAttendance(
  month: string,
  date: string,
  attendeesInput: Array<{
    name: string;
    isOvernight: boolean;
    startTime: string;
    endTime: string;
    isCustomTime?: boolean;
    memo?: string;
  }>,
  pin: string,
  isAdmin?: boolean,
  _isProxy?: boolean
): Promise<{ success: boolean; data: ScheduleMonthData; error?: string }> {
  if (!attendeesInput || attendeesInput.length === 0) {
    return { success: false, data: getLocalMonthSchedule(month), error: '추가할 참석자를 선택해주세요.' };
  }

  const trimmedPin = pin.trim();
  if (!isAdmin && (!trimmedPin || trimmedPin.length < 4)) {
    return { success: false, data: getLocalMonthSchedule(month), error: '4자리 확인 PIN을 입력해주세요.' };
  }

  const pinHash = (trimmedPin && trimmedPin.length >= 4 && trimmedPin !== 'admin_bypass') ? await hashPin(trimmedPin) : '';
  const cipher = localStorage.getItem('google_refresh_cipher');
  const lastName = getLastAttendeeName();

  const formattedAttendees = attendeesInput.map(a => {
    const trimmed = a.name.trim();
    // 일괄 등록 시 작성자 본인에게만 입력된 PIN 해시를 적용하고, 타인은 PIN 미설정('') 상태로 등록
    const attPin = (trimmed === lastName && pinHash) ? pinHash : '';
    return {
      ...a,
      name: trimmed,
      pinHash: attPin
    };
  });

  try {
    const res = await fetch(`${getWorkerUrl()}/api/schedule/attend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        month,
        date,
        attendees: formattedAttendees,
        pin: trimmedPin,
        creator_name: lastName,
        my_name: lastName,
        refresh_cipher: cipher,
        access_token: localStorage.getItem('google_access_token'),
        admin_passcode: getAdminPasscode()
      })
    });

    if (res.ok) {
      const json = await res.json();
      if (json && json.success && json.data) {
        saveLocalMonthSchedule(json.data);
        return { success: true, data: json.data };
      } else if (json && json.error) {
        return { success: false, data: getLocalMonthSchedule(month), error: json.error };
      }
    }
  } catch (err) {
    console.warn('Worker 다중 참석 등록 실패, 로컬 처리 진행:', err);
  }

  // 로컬 폴백 처리
  const currentData = getLocalMonthSchedule(month);
  const targetDay = currentData.dates.find(d => d.date === date);

  if (!targetDay) {
    return { success: false, data: currentData, error: '해당 날짜의 일정을 찾을 수 없습니다.' };
  }

  if (!targetDay.attendees) {
    targetDay.attendees = [];
  }

  const isCreator = !!(targetDay.creator && targetDay.creator === lastName);
  const canManage = !!(isAdmin || isCreator);

  for (const attendeeInput of attendeesInput) {
    const trimmedName = attendeeInput.name.trim();
    if (!trimmedName) continue;

    const existingIdx = targetDay.attendees.findIndex(a => a.name === trimmedName);
    if (existingIdx !== -1) {
      const existing = targetDay.attendees[existingIdx];
      if (!canManage && existing.pinHash && existing.pinHash !== 'admin_bypass' && existing.pinHash !== pinHash) {
        continue;
      }
      const existingValidPin = (existing.pinHash && existing.pinHash !== 'admin_bypass' && (existing.name === targetDay.creator || existing.pinHash !== targetDay.creatorPinHash)) ? existing.pinHash : '';
      const finalPin = (trimmedName === lastName && pinHash) ? pinHash : (existingValidPin || '');

      targetDay.attendees[existingIdx] = {
        ...existing,
        isOvernight: attendeeInput.isOvernight,
        startTime: attendeeInput.startTime,
        endTime: attendeeInput.endTime,
        isCustomTime: attendeeInput.isCustomTime,
        memo: attendeeInput.memo,
        pinHash: finalPin,
        updatedAt: Date.now()
      };
    } else {
      const finalPin = (trimmedName === lastName && pinHash) ? pinHash : '';
      targetDay.attendees.push({
        id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: trimmedName,
        isOvernight: attendeeInput.isOvernight,
        startTime: attendeeInput.startTime,
        endTime: attendeeInput.endTime,
        isCustomTime: attendeeInput.isCustomTime,
        memo: attendeeInput.memo,
        pinHash: finalPin,
        updatedAt: Date.now()
      });
    }
  }

  // 참가자 기준 모임 시간 유동적 동기화
  const updatedSession = computeSessionTimeFromAttendees(targetDay.attendees, targetDay.adminSessionType || targetDay.sessionType);
  targetDay.customStartTime = updatedSession.customStartTime;
  targetDay.customEndTime = updatedSession.customEndTime;
  targetDay.customIsOvernight = updatedSession.customIsOvernight;
  targetDay.sessionType = updatedSession.sessionType;

  currentData.updatedAt = Date.now();
  saveLocalMonthSchedule(currentData);

  logScheduleHistory(month, {
    action: 'ATTEND',
    targetDate: date,
    actorName: lastName || '관리자/개설자',
    details: `${attendeesInput.map(a => a.name).join(', ')} (${attendeesInput.length}명) 일괄 참석 등록`
  });

  return { success: true, data: currentData };
}

/**
 * 참석 취소 (관리자 및 개설자는 PIN 생략 가능)
 */
export async function cancelAttendance(
  month: string,
  date: string,
  name: string,
  pin: string,
  isAdmin?: boolean,
  isCreator?: boolean
): Promise<{ success: boolean; data: ScheduleMonthData; error?: string }> {
  const trimmedName = name.trim();
  const trimmedPin = pin.trim();
  const canBypassPin = !!(isAdmin || isCreator);

  if (!canBypassPin && (!trimmedPin || trimmedPin.length < 4)) {
    return { success: false, data: getLocalMonthSchedule(month), error: '4자리 확인 PIN을 입력해주세요.' };
  }

  const pinHash = trimmedPin && trimmedPin.length >= 4 ? await hashPin(trimmedPin) : 'admin_bypass';
  const cipher = localStorage.getItem('google_refresh_cipher');
  const lastName = getLastAttendeeName();

  try {
    const res = await fetch(`${getWorkerUrl()}/api/schedule/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        month,
        date,
        name: trimmedName,
        pin: trimmedPin,
        creator_name: lastName,
        my_name: lastName,
        refresh_cipher: cipher,
        access_token: localStorage.getItem('google_access_token'),
        admin_passcode: getAdminPasscode()
      })
    });

    if (res.ok) {
      const json = await res.json();
      if (json && json.success && json.data) {
        saveLocalMonthSchedule(json.data);
        return { success: true, data: json.data };
      } else if (json && json.error) {
        return { success: false, data: getLocalMonthSchedule(month), error: json.error };
      }
    }
  } catch (err) {
    console.warn('Worker 참석 취소 실패, 로컬 처리 진행:', err);
  }

  // 로컬 폴백 처리
  const currentData = getLocalMonthSchedule(month);
  const targetDay = currentData.dates.find(d => d.date === date);

  if (!targetDay) {
    return { success: false, data: currentData, error: '해당 날짜의 일정을 찾을 수 없습니다.' };
  }

  const existing = targetDay.attendees?.find(a => a.name === trimmedName);
  if (!existing) {
    return { success: false, data: currentData, error: '등록된 참석 정보를 찾을 수 없습니다.' };
  }

  // 개설자 권한 검증: 개설자 이름뿐 아니라 개설자 PIN 해시가 일치해야 진정한 개설자 권한으로 인정
  const isCreatorAuthorized = isCreator && targetDay.creatorPinHash && (targetDay.creatorPinHash === pinHash || pin === 'admin_bypass');
  const canManage = !!(isAdmin || isCreatorAuthorized);

  const isPinMatch = !!(existing.pinHash && existing.pinHash !== 'admin_bypass' && existing.pinHash === pinHash);

  if (!canManage && !isPinMatch) {
    return { success: false, data: currentData, error: 'PIN 비밀번호가 일치하지 않습니다.' };
  }

  targetDay.attendees = targetDay.attendees.filter(a => a.name !== trimmedName);

  if (!targetDay.attendees || targetDay.attendees.length === 0) {
    targetDay.creator = undefined;
    targetDay.creatorPinHash = undefined;
    targetDay.isConfirmed = false;
  }

  // 참가자 취소 후 모임 시간 유동적 동기화
  const updatedSession = computeSessionTimeFromAttendees(targetDay.attendees, targetDay.adminSessionType || targetDay.sessionType);
  targetDay.customStartTime = updatedSession.customStartTime;
  targetDay.customEndTime = updatedSession.customEndTime;
  targetDay.customIsOvernight = updatedSession.customIsOvernight;
  targetDay.sessionType = updatedSession.sessionType;

  currentData.updatedAt = Date.now();
  saveLocalMonthSchedule(currentData);

  logScheduleHistory(month, {
    action: 'CANCEL_ATTEND',
    targetDate: date,
    actorName: lastName || trimmedName,
    details: `'${trimmedName}' 참석 취소`
  });

  return { success: true, data: currentData };
}

/**
 * 관리자 권한으로 특정 인원의 PIN을 강제 변경합니다.
 * targetDate가 주어지면 해당 날짜(회차)만 변경하고, 생략되면 해당 월의 모든 참석 및 개설 PIN 해시를 일괄 갱신합니다.
 */
export async function adminForceResetUserPin(
  month: string,
  targetName: string,
  newPin: string,
  adminToken?: string,
  targetDate?: string
): Promise<{ success: boolean; data: ScheduleMonthData; error?: string }> {
  const trimmedName = targetName.trim();
  const trimmedPin = newPin.trim();

  if (!trimmedName) {
    const currentData = getLocalMonthSchedule(month);
    return { success: false, data: currentData, error: '대상 참가자 이름이 올바르지 않습니다.' };
  }

  if (!trimmedPin || trimmedPin.length < 4 || trimmedPin.length > 8) {
    const currentData = getLocalMonthSchedule(month);
    return { success: false, data: currentData, error: '새 PIN은 4~8자리 숫자여야 합니다.' };
  }

  const newPinHash = await hashPin(trimmedPin);

  // 로컬 스토리지 PIN 캐시도 갱신
  saveUserPin(trimmedName, trimmedPin, false);

  // 1. Worker API 시도
  const workerUrl = getWorkerUrl();
  const passcode = getAdminPasscode();
  if (workerUrl && (adminToken || passcode)) {
    try {
      // 최신 스케줄 조회
      const currentRes = await fetchMonthSchedule(month);
      const dates = currentRes.dates;

      let changed = false;
      dates.forEach(d => {
        if (targetDate && d.date !== targetDate) return;
        if (d.attendees) {
          d.attendees.forEach(a => {
            if (a.name === trimmedName) {
              a.pinHash = newPinHash;
              changed = true;
            }
          });
        }
        if (d.creator === trimmedName) {
          d.creatorPinHash = newPinHash;
          changed = true;
        }
      });

      if (changed) {
        const saveRes = await saveAdminScheduleDates(month, dates, adminToken);
        if (saveRes.success) {
          return { success: true, data: saveRes.data };
        }
      } else {
        return { success: true, data: currentRes };
      }
    } catch (e: any) {
      console.warn('Worker PIN 재설정 실패, 로컬 처리 진행:', e);
    }
  }

  // 2. 로컬 스케줄 갱신
  const localData = getLocalMonthSchedule(month);
  localData.dates.forEach(d => {
    if (targetDate && d.date !== targetDate) return;
    if (d.attendees) {
      d.attendees.forEach(a => {
        if (a.name === trimmedName) {
          a.pinHash = newPinHash;
        }
      });
    }
    if (d.creator === trimmedName) {
      d.creatorPinHash = newPinHash;
    }
  });

  localData.updatedAt = Date.now();
  saveLocalMonthSchedule(localData);

  return { success: true, data: localData };
}

/**
 * Git 스타일 커밋 및 체크포인트 목록 조회
 */
export async function fetchScheduleCommits(month: string): Promise<ScheduleCommitsResponse> {
  const workerUrl = getWorkerUrl();
  try {
    const res = await fetch(`${workerUrl}/api/schedule/admin/commits?month=${encodeURIComponent(month)}&_t=${Date.now()}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });
    if (res.ok) {
      const json = await res.json();
      if (json && json.success) {
        return {
          success: true,
          commits: json.commits || [],
          checkpoint: json.checkpoint || null
        };
      }
    }
  } catch (e) {
    console.warn('커밋 히스토리 조회 실패:', e);
  }
  return { success: false, commits: [], checkpoint: null };
}

/**
 * Git 스타일 타임머신 롤백 (특정 커밋 또는 안전 체크포인트로 복원)
 */
export async function rollbackSchedule(
  month: string,
  commitId: string,
  adminToken?: string
): Promise<{ success: boolean; data?: ScheduleMonthData; message?: string; error?: string }> {
  const workerUrl = getWorkerUrl();
  const passcode = getAdminPasscode();
  const token = adminToken || localStorage.getItem('google_access_token') || '';
  const cipher = localStorage.getItem('google_refresh_cipher') || '';

  try {
    const res = await fetch(`${workerUrl}/api/schedule/admin/rollback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': token ? `Bearer ${token}` : '',
        'X-Admin-Passcode': passcode || ''
      },
      body: JSON.stringify({
        month,
        commitId,
        admin_passcode: passcode || undefined,
        access_token: token || undefined,
        refresh_cipher: cipher || undefined
      })
    });

    const json = await res.json().catch(() => ({}));
    if (res.ok && json.success) {
      if (json.data) {
        saveLocalMonthSchedule(json.data);
      }
      return {
        success: true,
        data: json.data,
        message: json.message || '성공적으로 복원되었습니다.'
      };
    } else {
      return {
        success: false,
        error: json.error || '롤백 처리에 실패했습니다.'
      };
    }
  } catch (e: any) {
    console.error('롤백 요청 에러:', e);
    return {
      success: false,
      error: e.message || '서버와의 통신에 실패했습니다.'
    };
  }
}

