/**
 * kstTime.ts
 * 
 * 대한민국 표준시(KST, Asia/Seoul, UTC+9) 전용 날짜 및 시간 유틸리티.
 * 해외(미국, 유럽 등)나 다양한 타임존의 브라우저에서 접속하더라도
 * 일정 달력, 오늘 날짜, 요일 계산, 마감 시각, 로그 타임스탬프가 일관되게
 * 한국 표준시(KST)를 기준으로 작동하도록 보장합니다.
 */

export interface KSTDateTimeParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;  // 0-23
  minute: number;
  second: number;
  yearStr: string;
  monthStr: string;
  dayStr: string;
  hourStr: string;
  minuteStr: string;
  secondStr: string;
}

const KST_TIMEZONE = 'Asia/Seoul';
export const KST_DAYS_HEADER = ['일', '월', '화', '수', '목', '금', '토'];

/**
 * 주어진 시각(기본값: 현재)의 KST 기준 연, 월, 일, 시, 분, 초 분해
 */
export function getKSTNowParts(d: Date | number | string = new Date()): KSTDateTimeParts {
  const date = typeof d === 'number' || typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) {
    // 유효하지 않은 날짜인 경우 현재 시각 기준
    return getKSTNowParts(new Date());
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: KST_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }

  const rawHour = map.hour || '00';
  const hour = parseInt(rawHour === '24' ? '00' : rawHour, 10);

  return {
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10),
    day: parseInt(map.day, 10),
    hour,
    minute: parseInt(map.minute, 10),
    second: parseInt(map.second, 10),
    yearStr: map.year,
    monthStr: map.month,
    dayStr: map.day,
    hourStr: String(hour).padStart(2, '0'),
    minuteStr: map.minute,
    secondStr: map.second,
  };
}

/**
 * KST 기준 오늘 날짜 문자열 반환 (예: "2026-10-06")
 */
export function getKSTTodayString(): string {
  const p = getKSTNowParts();
  return `${p.yearStr}-${p.monthStr}-${p.dayStr}`;
}

/**
 * KST 기준 현재 연-월 문자열 반환 (예: "2026-10")
 */
export function getKSTCurrentMonth(): string {
  const p = getKSTNowParts();
  return `${p.yearStr}-${p.monthStr}`;
}

/**
 * 특정 날짜 문자열("YYYY-MM-DD")이 KST 기준 오늘인지 여부
 */
export function isKSTToday(dateStr: string): boolean {
  return dateStr === getKSTTodayString();
}

/**
 * 특정 날짜("YYYY-MM-DD")의 요일 인덱스 반환 (0: 일요일, 1: 월요일, ..., 6: 토요일)
 * 브라우저 로컬 타임존의 영향을 받지 않고 UTC 정오 기준으로 결정론적 계산
 */
export function getKSTDayOfWeek(dateStr: string): number {
  if (!dateStr) return 0;
  const parts = dateStr.split('-').map(Number);
  if (parts.length < 3) return 0;
  const [y, m, d] = parts;
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * 특정 날짜("YYYY-MM-DD")의 요일 한글 이름 반환 (예: '화')
 */
export function getKSTDayOfWeekName(dateStr: string): string {
  const dow = getKSTDayOfWeek(dateStr);
  return KST_DAYS_HEADER[dow] || '';
}

/**
 * 특정 연/월의 총 일수 계산 (예: 2026, 10 -> 31)
 */
export function getKSTDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * 특정 연/월 1일의 시작 요일 인덱스 (0: 일, ..., 6: 토)
 */
export function getKSTFirstDayOfWeek(year: number, month: number): number {
  return new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
}

/**
 * 타임스탬프를 KST 기준 포맷팅 (예: "10/06 23:45:12" 또는 "YYYY-MM-DD HH:mm:ss")
 */
export function formatKSTTimestamp(timestamp: number | string | Date, includeYear = false): string {
  if (!timestamp) return '';
  const p = getKSTNowParts(timestamp);
  if (includeYear) {
    return `${p.yearStr}-${p.monthStr}-${p.dayStr} ${p.hourStr}:${p.minuteStr}:${p.secondStr}`;
  }
  return `${p.monthStr}/${p.dayStr} ${p.hourStr}:${p.minuteStr}:${p.secondStr}`;
}

/**
 * 타임스탬프를 KST 기준 날짜만 포맷팅 (예: "2026. 10. 6.")
 */
export function formatKSTDateOnly(timestamp: number | string | Date): string {
  if (!timestamp) return '';
  const p = getKSTNowParts(timestamp);
  return `${p.year}. ${p.month}. ${p.day}.`;
}

/**
 * 현재 KST 시각의 당일 경과 분(Minute of Day, 0 ~ 1439) 반환
 * 타임테이블 마감 시각(예: 24:00 = 1440분) 비교 시 사용
 */
export function getKSTNowMinutesOfDay(): number {
  const p = getKSTNowParts();
  return p.hour * 60 + p.minute;
}
