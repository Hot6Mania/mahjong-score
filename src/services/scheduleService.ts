import type { ScheduleDayItem, ScheduleMonthData } from '@/types/schedule';
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
function getLocalMonthSchedule(month: string): ScheduleMonthData {
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
    const res = await fetch(`${getWorkerUrl()}/api/schedule?month=${encodeURIComponent(month)}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    if (res.ok) {
      const json = await res.json();
      if (json && json.success && json.data) {
        // 만약 서버에서 반환된 dates가 비어있고, 로컬에 저장된 일정이 이미 있다면 (KV 미연결 등) 로컬 일정을 우선 보존
        if ((!json.data.dates || json.data.dates.length === 0) && local.dates && local.dates.length > 0) {
          console.info('서버 일정이 비어 있어 로컬에 저장된 일정을 우선 유지합니다.');
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
export async function checkAdminStatus(): Promise<{ isAdmin: boolean; adminToken?: string }> {
  if (sessionStorage.getItem('schedule_admin_verified') === 'true') {
    return { isAdmin: true };
  }

  const cipher = localStorage.getItem('google_refresh_cipher');
  const accessToken = localStorage.getItem('google_access_token');
  const passcode = getAdminPasscode();
  if (!cipher && !accessToken && !passcode) {
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
        if (data.access_token) {
          localStorage.setItem('google_access_token', data.access_token);
          localStorage.setItem('google_token_expires_at', String(Date.now() + 3600 * 1000));
        }
        return { isAdmin: true, adminToken: data.adminToken };
      }
    }
  } catch (err) {
    console.warn('관리자 권한 확인 API 호출 실패:', err);
  }

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
  creatorPin?: string
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

  const pinHash = trimmedPin && trimmedPin.length >= 4 ? await hashPin(trimmedPin) : 'admin_bypass';
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
        if (trimmedPin && trimmedPin.length >= 4) {
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
    targetDay.attendees[existingIdx] = {
      ...existing,
      isOvernight: attendeeInput.isOvernight,
      startTime: attendeeInput.startTime,
      endTime: attendeeInput.endTime,
      isCustomTime: attendeeInput.isCustomTime,
      memo: attendeeInput.memo,
      pinHash: (pinHash && pinHash !== 'admin_bypass') ? pinHash : (existing.pinHash || targetDay.creatorPinHash || 'admin_bypass'),
      updatedAt: Date.now()
    };
  } else {
    // 신규 참가자 추가 (인원수 제한 없이 무제한 추가)
    targetDay.attendees.push({
      id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: trimmedName,
      isOvernight: attendeeInput.isOvernight,
      startTime: attendeeInput.startTime,
      endTime: attendeeInput.endTime,
      isCustomTime: attendeeInput.isCustomTime,
      memo: attendeeInput.memo,
      pinHash: (pinHash && pinHash !== 'admin_bypass') ? pinHash : (targetDay.creatorPinHash || 'admin_bypass'),
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

  const pinHash = trimmedPin && trimmedPin.length >= 4 ? await hashPin(trimmedPin) : 'admin_bypass';
  const cipher = localStorage.getItem('google_refresh_cipher');
  const lastName = getLastAttendeeName();

  const formattedAttendees = attendeesInput.map(a => ({
    ...a,
    name: a.name.trim(),
    pinHash
  }));

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
      targetDay.attendees[existingIdx] = {
        ...existing,
        isOvernight: attendeeInput.isOvernight,
        startTime: attendeeInput.startTime,
        endTime: attendeeInput.endTime,
        isCustomTime: attendeeInput.isCustomTime,
        memo: attendeeInput.memo,
        pinHash: (pinHash && pinHash !== 'admin_bypass') ? pinHash : (existing.pinHash || targetDay.creatorPinHash || 'admin_bypass'),
        updatedAt: Date.now()
      };
    } else {
      targetDay.attendees.push({
        id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: trimmedName,
        isOvernight: attendeeInput.isOvernight,
        startTime: attendeeInput.startTime,
        endTime: attendeeInput.endTime,
        isCustomTime: attendeeInput.isCustomTime,
        memo: attendeeInput.memo,
        pinHash: (pinHash && pinHash !== 'admin_bypass') ? pinHash : (targetDay.creatorPinHash || 'admin_bypass'),
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

  const isLocalCreator = isCreator || !!(targetDay.creator && targetDay.creator === lastName);
  const canManage = !!(isAdmin || isLocalCreator);

  const isPinMatch = (existing.pinHash === pinHash) ||
    (targetDay.creatorPinHash && targetDay.creatorPinHash === pinHash) ||
    (existing.pinHash === 'admin_bypass');

  if (!canManage && !isPinMatch) {
    return { success: false, data: currentData, error: 'PIN 비밀번호가 일치하지 않습니다.' };
  }

  targetDay.attendees = targetDay.attendees.filter(a => a.name !== trimmedName);

  // 참가자 취소 후 모임 시간 유동적 동기화
  const updatedSession = computeSessionTimeFromAttendees(targetDay.attendees, targetDay.adminSessionType || targetDay.sessionType);
  targetDay.customStartTime = updatedSession.customStartTime;
  targetDay.customEndTime = updatedSession.customEndTime;
  targetDay.customIsOvernight = updatedSession.customIsOvernight;
  targetDay.sessionType = updatedSession.sessionType;

  currentData.updatedAt = Date.now();
  saveLocalMonthSchedule(currentData);

  return { success: true, data: currentData };
}
