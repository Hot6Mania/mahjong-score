export type SessionType = 'day' | 'overnight' | 'custom';

export interface ScheduleAttendee {
  id: string;
  name: string;
  isOvernight: boolean; // 밤샘 여부 (true: 익일까지, false: 당일 22시까지)
  startTime: string; // 기본 "10:00"
  endTime: string; // 기본 "22:00" 또는 "익일"
  isCustomTime?: boolean; // 사용자가 직접 시간을 커스텀했는지 여부
  memo?: string; // 늦참 메모 등
  pinHash?: string; // SHA-256 (PIN + Salt) - 보안을 위해 서버 응답 시 마스킹될 수 있음
  hasPin?: boolean; // 서버에서 마스킹된 경우 PIN 존재 여부 플래그
  isAdminBypass?: boolean; // 관리자 프리패스로 등록된 경우
  clientToken?: string; // 로컬 기기 인증 토큰
  updatedAt: number;
}

export interface ScheduleDayItem {
  date: string; // "YYYY-MM-DD"
  sessionType: SessionType; // 'day' | 'overnight' | 'custom'
  adminSessionType?: 'day' | 'overnight'; // 관리자가 지정한 원래 후보 일정 속성 (당일 vs 밤샘)
  customStartTime?: string;
  customEndTime?: string;
  customIsOvernight?: boolean;
  creator?: string; // 일정을 개설한 사용자 이름
  creatorPinHash?: string; // 개설자 PIN 해시 - 보안을 위해 서버 응답 시 마스킹될 수 있음
  hasCreatorPin?: boolean; // 서버에서 마스킹된 경우 개설자 PIN 존재 여부 플래그
  isCreatorAdminBypass?: boolean; // 관리자 권한으로 개설된 경우
  note?: string; // 관리자/개설자 메모
  isClosed?: boolean; // 마감 여부
  isConfirmed?: boolean; // 개설자/관리자의 출발 확정 여부
  sessionNumber?: number; // DB에 영구 기록된 확정 회차 번호 (예: 16)
  sheetTitle?: string; // 연동된 구글 스프레드시트 탭 이름
  attendees: ScheduleAttendee[];
}

export type ScheduleActionType =
  | 'CREATE_SESSION'
  | 'CLEAR_ATTENDEES'
  | 'DELETE_SESSION'
  | 'ATTEND'
  | 'CANCEL_ATTEND'
  | 'TOGGLE_CONFIRM'
  | 'UPDATE_SESSION_TYPE'
  | 'UPDATE_DATES';

export interface ScheduleHistoryItem {
  id: string;
  timestamp: number;
  action: ScheduleActionType;
  targetDate?: string;
  actorName: string;
  details: string;
  clientIp?: string;
}

export interface ScheduleMonthData {
  month: string; // "YYYY-MM"
  updatedAt: number;
  dates: ScheduleDayItem[];
}

export interface ParsedNoticeDates {
  dayDates: number[]; // [1, 6, 21, 23, 26, 31]
  overnightDates: number[]; // [3, 8, 9, 10, 13, 16, 17, 18, 28]
}

export interface OverlapInterval {
  startMinutes: number;
  endMinutes: number;
  startTimeStr: string;
  endTimeStr: string;
  count: number;
  attendees: string[];
}

export interface ScheduleDeltaAttendeeDiff {
  countBefore: number;
  countAfter: number;
  added: string[];
  removed: string[];
}

export interface ScheduleDeltaModifiedDate {
  date: string;
  fieldDiff: {
    sessionType?: { before: string; after: string };
    isConfirmed?: { before: boolean; after: boolean };
    sessionNumber?: { before?: number; after?: number };
    time?: { before: string; after: string };
    attendees?: ScheduleDeltaAttendeeDiff;
    [key: string]: any;
  };
}

export interface ScheduleDeltaData {
  addedDates: Array<{ date: string; sessionType: string; customStartTime?: string; customEndTime?: string }>;
  removedDates: Array<{ date: string; sessionType: string; attendeesCount?: number }>;
  modifiedDates: ScheduleDeltaModifiedDate[];
}

export interface ScheduleCommitItem {
  id: string;
  timestamp: number;
  action: string;
  actorName: string;
  summary: string;
  delta: ScheduleDeltaData;
  snapshotBefore?: ScheduleDayItem[] | null;
  clientIp?: string | null;
}

export interface ScheduleCommitsResponse {
  success: boolean;
  commits: ScheduleCommitItem[];
  checkpoint?: { timestamp: number; commitId?: string } | null;
}

