export type SessionType = 'day' | 'overnight' | 'custom';

export interface ScheduleAttendee {
  id: string;
  name: string;
  isOvernight: boolean; // 밤샘 여부 (true: 익일까지, false: 당일 22시까지)
  startTime: string; // 기본 "10:00"
  endTime: string; // 기본 "22:00" 또는 "익일"
  isCustomTime?: boolean; // 사용자가 직접 시간을 커스텀했는지 여부
  memo?: string; // 늦참 메모 등
  pinHash?: string; // SHA-256 (PIN + Salt)
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
  creatorPinHash?: string; // 개설자 PIN 해시
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
