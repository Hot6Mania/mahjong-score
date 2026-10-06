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
 */
export function computeScheduleSessionNumbers(
  availableSessions: string[] = [],
  scheduleDates: ScheduleDayItem[] = []
): Map<string, number> {
  const maxCompleted = getMaxCompletedSessionNumber(availableSessions);
  const sessionMap = new Map<string, number>();

  // 날짜 오름차순 정렬
  const sorted = [...scheduleDates].sort((a, b) => a.date.localeCompare(b.date));

  let nextSessionNum = maxCompleted + 1;

  for (const item of sorted) {
    const count = item.attendees ? item.attendees.length : 0;
    // 4인 이상 충족 및 개설자/관리자 출발 확정(isConfirmed) 시에만 순차적인 회차 번호 부여
    if (count >= 4 && item.isConfirmed) {
      sessionMap.set(item.date, nextSessionNum);
      nextSessionNum++;
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
