import type { ScheduleDayItem } from '@/types/schedule';

/**
 * 역대 완료 회차 목록(availableSessions)에서 최대 회차 번호를 추출합니다.
 * 예: ["제15회 260927", "제14회 260913"] -> 15
 */
export function getMaxCompletedSessionNumber(sessions: string[] = []): number {
  let max = 0;
  const regex = /제\s*(\d+)\s*회/i;

  for (const s of sessions) {
    if (!s) continue;
    const match = s.match(regex);
    if (match) {
      const n = parseInt(match[1], 10);
      if (!isNaN(n) && n > max) {
        max = n;
      }
    }
  }

  return max;
}

/**
 * 역대 완료 회차와 일정 데이터를 대조하여,
 * 4인 이상 모인 날짜에 날짜 오름차순으로 순차적인 '제N회' 회차 번호를 매깁니다.
 * - 1순위: DB에 영구 기록된 item.sessionNumber 사용 (기기 간 불일치 원천 차단)
 * - 2순위: 연동된 시트 타이틀(sheetTitle) 또는 이번 달 날짜와 일치하는 시트 탭의 회차 번호 사용
 * - 3순위: 미할당 확정 일정에 과거 완료 회차 이후의 고유 번호 순차 부여
 */
export function computeScheduleSessionNumbers(
  availableSessions: string[] = [],
  scheduleDates: ScheduleDayItem[] = []
): Map<string, number> {
  const sessionMap = new Map<string, number>();
  const sorted = [...scheduleDates].sort((a, b) => a.date.localeCompare(b.date));

  // 현재 일정들의 YYMMDD 패턴 목록 생성 (예: "2026-04-23" -> "260423")
  const currentScheduleYymmddList = sorted.map(item => {
    const raw = item.date.replace(/-/g, '');
    return raw.length === 8 ? raw.slice(2) : raw;
  });

  // 이번 달 일정과 연동된 시트 탭(예: "제16회 260423")은 과거 완료 회차 목록에서 제외
  const pastSessions = availableSessions.filter(s => {
    if (!s) return false;
    return !currentScheduleYymmddList.some(yymmdd => s.includes(yymmdd));
  });

  const maxCompleted = getMaxCompletedSessionNumber(pastSessions);
  const usedNumbers = new Set<number>();

  // 1차 패스: 이미 고정된 회차 번호(DB의 sessionNumber 또는 sheetTitle) 우선 등록
  for (const item of sorted) {
    const count = item.attendees ? item.attendees.length : 0;
    if (count >= 4 && item.isConfirmed) {
      if (typeof item.sessionNumber === 'number' && item.sessionNumber > 0) {
        sessionMap.set(item.date, item.sessionNumber);
        usedNumbers.add(item.sessionNumber);
        continue;
      }

      // 시트 타이틀에서 회차 번호 추출 시도
      let matchedNum: number | null = null;
      if (item.sheetTitle) {
        const m = item.sheetTitle.match(/제\s*(\d+)\s*회/i);
        if (m) matchedNum = parseInt(m[1], 10);
      }

      if (!matchedNum) {
        const yymmdd = item.date.replace(/-/g, '').slice(2);
        const matchedSheet = availableSessions.find(s => s && s.includes(yymmdd));
        if (matchedSheet) {
          const m = matchedSheet.match(/제\s*(\d+)\s*회/i);
          if (m) matchedNum = parseInt(m[1], 10);
        }
      }

      if (matchedNum && !isNaN(matchedNum)) {
        sessionMap.set(item.date, matchedNum);
        usedNumbers.add(matchedNum);
      }
    }
  }

  // 2차 패스: 아직 회차 번호가 없는 확정 일정에 순차 번호 부여
  let candidateNum = maxCompleted + 1;
  for (const item of sorted) {
    const count = item.attendees ? item.attendees.length : 0;
    if (count >= 4 && item.isConfirmed && !sessionMap.has(item.date)) {
      while (usedNumbers.has(candidateNum)) {
        candidateNum++;
      }
      sessionMap.set(item.date, candidateNum);
      usedNumbers.add(candidateNum);
      candidateNum++;
    }
  }

  return sessionMap;
}

/**
 * 회차 번호와 참석 인원수를 바탕으로 깔끔한 Apple 스타일 뱃지 텍스트를 반환합니다.
 * 수식어 (성립)은 일절 포함하지 않습니다.
 * 예:
 * - 4인 이상 & 회차 있음: "제16회 6명"
 * - 4인 미만: "3명"
 */
export function formatMinimalBadgeText(sessionNum: number | null | undefined, attendeeCount: number): string {
  if (attendeeCount >= 4 && sessionNum) {
    return `제${sessionNum}회 ${attendeeCount}명`;
  }
  return `${attendeeCount}명`;
}
