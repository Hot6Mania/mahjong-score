import type { ParsedNoticeDates, ScheduleDayItem, SessionType } from '@/types/schedule';

/**
 * "1일 6일 8~10일 13일 16-18일" 같은 문자열에서 일자 숫자 목록을 추출합니다.
 */
export function extractDayNumbers(text: string): number[] {
  const result: number[] = [];
  if (!text) return result;

  // 1) 쉼표, 슬래시, 공백 등으로 분리하거나 정규식으로 토큰화
  // 예: "8~10일", "16-18", "1일", "6", "21일"
  const tokens = text.match(/\d+\s*[~-]\s*\d+|\d+/g) || [];

  for (const token of tokens) {
    if (token.includes('~') || token.includes('-')) {
      const parts = token.split(/[~-]/).map(p => parseInt(p.replace(/\D/g, ''), 10));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        const start = Math.min(parts[0], parts[1]);
        const end = Math.max(parts[0], parts[1]);
        for (let d = start; d <= end; d++) {
          if (d >= 1 && d <= 31 && !result.includes(d)) {
            result.push(d);
          }
        }
      }
    } else {
      const num = parseInt(token.replace(/\D/g, ''), 10);
      if (!isNaN(num) && num >= 1 && num <= 31 && !result.includes(num)) {
        result.push(num);
      }
    }
  }

  return result.sort((a, b) => a - b);
}

/**
 * 사용자 공지 텍스트를 파싱하여 당일 일정과 밤샘 일정으로 분리 추출합니다.
 * 예:
 * 당일만 가능 : 1일 6일 21일 23일 26일 31일
 * 밤샘도 가능 : 3일 8~10일 13일 16~18일 28일
 */
export function parseScheduleNoticeText(inputText: string): ParsedNoticeDates {
  const lines = inputText.split(/\r?\n/);
  let dayText = '';
  let overnightText = '';

  let currentCategory: 'day' | 'overnight' | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 밤샘 키워드 감지
    if (/밤샘/i.test(trimmed)) {
      currentCategory = 'overnight';
      const afterColon = trimmed.split(/[:：]/)[1] ?? trimmed.replace(/.*밤샘[^\d]*/i, '');
      overnightText += ' ' + afterColon;
    } 
    // 당일 키워드 감지
    else if (/당일/i.test(trimmed)) {
      currentCategory = 'day';
      const afterColon = trimmed.split(/[:：]/)[1] ?? trimmed.replace(/.*당일[^\d]*/i, '');
      dayText += ' ' + afterColon;
    } 
    // 줄바꿈 후 이어진 숫자들
    else if (currentCategory === 'overnight') {
      overnightText += ' ' + trimmed;
    } else if (currentCategory === 'day') {
      dayText += ' ' + trimmed;
    }
  }

  // 만약 키워드가 없는 단순 텍스트라면 전체를 당일로 간주
  if (!dayText && !overnightText && inputText.trim()) {
    dayText = inputText;
  }

  const dayDates = extractDayNumbers(dayText);
  const overnightDates = extractDayNumbers(overnightText);

  // 밤샘에 포함된 날짜는 당일에서 제거 (밤샘 우선)
  const filteredDayDates = dayDates.filter(d => !overnightDates.includes(d));

  return {
    dayDates: filteredDayDates,
    overnightDates
  };
}

/**
 * 파싱된 날짜 목록을 YYYY-MM 형식의 ScheduleDayItem[] 구조로 변환합니다.
 * 기존에 이미 등록된 날짜의 attendees(참석자 명단)는 보존합니다.
 */
export function mergeParsedIntoMonthDays(
  yearMonth: string, // "2026-10"
  parsed: ParsedNoticeDates,
  existingDays: ScheduleDayItem[] = []
): ScheduleDayItem[] {
  const [yearStr, monthStr] = yearMonth.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);

  // 기존 날짜 맵 생성 (참석자 보존용)
  const existingMap = new Map<string, ScheduleDayItem>();
  for (const item of existingDays) {
    existingMap.set(item.date, item);
  }

  // 이번 달 일수 확인
  const lastDay = new Date(year, month, 0).getDate();
  const allParsedDayNumbers = [
    ...parsed.dayDates.map(d => ({ day: d, type: 'day' as SessionType })),
    ...parsed.overnightDates.map(d => ({ day: d, type: 'overnight' as SessionType }))
  ].filter(item => item.day >= 1 && item.day <= lastDay);

  // 날짜 오름차순 정렬
  allParsedDayNumbers.sort((a, b) => a.day - b.day);

  const result: ScheduleDayItem[] = [];

  for (const entry of allParsedDayNumbers) {
    const dateStr = `${yearStr}-${monthStr.padStart(2, '0')}-${String(entry.day).padStart(2, '0')}`;
    const prevItem = existingMap.get(dateStr);

    result.push({
      date: dateStr,
      sessionType: entry.type,
      note: prevItem?.note || '',
      isClosed: prevItem?.isClosed || false,
      attendees: prevItem ? [...prevItem.attendees] : []
    });
  }

  return result;
}
