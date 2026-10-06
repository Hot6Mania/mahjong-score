import type { ScheduleAttendee, SessionType } from '@/types/schedule';

/**
 * 시간 문자열("HH:mm")을 기준 분(Minute)으로 변환합니다.
 * 익일 플래그가 참이거나 시간이 자정 이후인 경우 1440분을 더합니다.
 */
export function timeStringToMinutes(timeStr: string, isNextDay: boolean = false): number {
  if (!timeStr) return 600; // 기본 10:00 (600분)

  if (timeStr.includes('익일')) {
    isNextDay = true;
    timeStr = timeStr.replace('익일', '').trim();
  }

  const parts = timeStr.split(':').map(p => parseInt(p, 10));
  let hours = isNaN(parts[0]) ? 10 : parts[0];
  const minutes = isNaN(parts[1]) ? 0 : parts[1];

  if (isNextDay && hours < 24) {
    hours += 24;
  }

  return hours * 60 + minutes;
}

/**
 * 분(Minute)을 시간 문자열("10:00", "익일 04:00")로 변환합니다.
 */
export function minutesToTimeString(totalMinutes: number): string {
  const isNextDay = totalMinutes >= 1440;
  const normalized = isNextDay ? totalMinutes - 1440 : totalMinutes;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  const formatted = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

  return isNextDay ? `익일 ${formatted}` : formatted;
}

/**
 * 참석자의 시작/종료 시각을 [시작분, 종료분] 범위로 변환합니다.
 */
export function getAttendeeInterval(attendee: ScheduleAttendee, isDayOnly: boolean = false): [number, number] {
  // 기본값 처리
  let startMinutes = 600; // 10:00
  let endMinutes = (!isDayOnly && attendee.isOvernight) ? 1800 : 1320; // 22:00(1320분)

  if (attendee.startTime) {
    startMinutes = timeStringToMinutes(attendee.startTime, false);
  }

  if (attendee.endTime) {
    if (!isDayOnly && (attendee.endTime === '익일' || attendee.endTime.includes('밤샘'))) {
      endMinutes = 1800; // 익일 06:00
    } else {
      const isNextDay = !isDayOnly && (attendee.isOvernight || attendee.endTime.startsWith('익일'));
      endMinutes = timeStringToMinutes(attendee.endTime, isNextDay);
    }
  }

  // 시작이 종료보다 늦으면 다음날로 보정 (단, 당일 모드가 아닐 때만)
  if (!isDayOnly && endMinutes <= startMinutes) {
    endMinutes += 1440;
  }

  return [startMinutes, endMinutes];
}

/**
 * 해당 날짜의 참석자들을 바탕으로 4인 이상 겹치는 시간대 구간을 계산합니다.
 * 반환값: 예 "14:00 ~ 22:00" 또는 "10:00 ~ 익일" 또는 null
 */
export function computeEffectiveOverlapRange(attendees: ScheduleAttendee[] = [], isDayOnly: boolean = false): string | null {
  if (!attendees || attendees.length < 4) {
    return null;
  }

  // 모든 시작/종료 분 포인트 수집
  const intervals = attendees.map(a => getAttendeeInterval(a, isDayOnly));
  
  // 10분 단위로 카운트 샘플링 (10:00 ~ 익일 12:00)
  const startCheck = 600; // 10:00
  const endCheck = 2160;  // 익일 12:00
  const step = 30; // 30분 단위

  let firstValidMin: number | null = null;
  let lastValidMin: number | null = null;

  for (let m = startCheck; m <= endCheck; m += step) {
    const activeCount = intervals.filter(([s, e]) => s <= m && m < e).length;
    if (activeCount >= 4) {
      if (firstValidMin === null) firstValidMin = m;
      lastValidMin = m + step;
    }
  }

  if (firstValidMin === null || lastValidMin === null) {
    return null;
  }

  const startStr = minutesToTimeString(firstValidMin);
  const endStr = minutesToTimeString(lastValidMin);

  return `${startStr} ~ ${endStr}`;
}

/**
 * 참석자들의 시간을 기반으로 모임 전체 시간 범위(가장 이른 출발 ~ 가장 늦은 종료)를 유동적으로 계산합니다.
 */
export function computeSessionTimeFromAttendees(
  attendees: ScheduleAttendee[] = [],
  baseSessionType?: 'day' | 'overnight' | SessionType
): {
  customStartTime: string;
  customEndTime: string;
  customIsOvernight: boolean;
  startTime: string;
  endTime: string;
  isOvernight: boolean;
  sessionType: SessionType;
} {
  if (!attendees || attendees.length === 0) {
    const isOvernight = baseSessionType === 'overnight';
    return {
      customStartTime: '10:00',
      customEndTime: isOvernight ? '익일' : '22:00',
      customIsOvernight: isOvernight,
      startTime: '10:00',
      endTime: isOvernight ? '익일' : '22:00',
      isOvernight: isOvernight,
      sessionType: isOvernight ? 'overnight' : 'day'
    };
  }

  const isDayOnly = baseSessionType === 'day';
  const intervals = attendees.map(a => getAttendeeInterval(a, isDayOnly));
  const earliestMin = Math.min(...intervals.map(([s]) => s));
  const latestMin = Math.max(...intervals.map(([, e]) => e));

  const customStartTime = minutesToTimeString(earliestMin);
  const customEndTime = minutesToTimeString(latestMin);
  const customIsOvernight = isDayOnly ? false : (latestMin > 1440 || attendees.some(a => a.isOvernight));

  // 당일로 지정된 날짜는 무조건 'day', 그 외에는 익일 포함 여부에 따라 'overnight' 결정
  const sessionType: SessionType = isDayOnly ? 'day' : (customIsOvernight ? 'overnight' : 'day');

  return {
    customStartTime,
    customEndTime,
    customIsOvernight,
    startTime: customStartTime,
    endTime: customEndTime,
    isOvernight: customIsOvernight,
    sessionType
  };
}
