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
 * 역대 완료 회차와 직전 월 확정 회차, 현재 일정 데이터를 대조하여,
 * 4인 이상 모인 확정 날짜에 날짜 오름차순으로 순차적인 '제N회' 회차 번호를 매깁니다.
 * - 1순위: 연동된 시트 타이틀(sheetTitle) 또는 이번 달 날짜와 일치하는 시트 탭의 회차 번호 영구 고정
 * - 2순위: 직전 월 확정 회차 및 과거 완료 회차 최대값(effectiveBase) 이후의 고유 번호 순차 부여
 * - 폴백: 초기 로딩 전(effectiveBase === 0)일 때만 DB의 item.sessionNumber 임시 표시
 */
export function computeScheduleSessionNumbers(
  availableSessions: string[] = [],
  scheduleDates: ScheduleDayItem[] = [],
  baseSessionNumberOverride?: number
): Map<string, number> {
  const sessionMap = new Map<string, number>();
  const sorted = [...scheduleDates].sort((a, b) => a.date.localeCompare(b.date));

  // 현재 확정된 일정들의 YYMMDD 패턴 목록 생성 (예: "2026-04-23" -> "260423")
  const confirmedScheduleYymmddList = sorted
    .filter(item => item.isConfirmed && (item.attendees ? item.attendees.length : 0) >= 4)
    .map(item => {
      const raw = item.date.replace(/-/g, '');
      return raw.length === 8 ? raw.slice(2) : raw;
    });

  // 현재 일정이 속한 월의 YYMM 접두사 추출 (예: "2026-11-15" -> "2611")
  const targetYymm = sorted.length > 0
    ? sorted[0].date.replace(/-/g, '').slice(2, 6)
    : '';

  // 모든 유효 시트 탭의 (회차번호, YYMMDD) 메타데이터 추출
  const parsedSessions: { num: number; yymmdd: string }[] = [];
  for (const s of availableSessions) {
    if (!s) continue;
    const numMatch = s.match(/제\s*(\d+)\s*회/i);
    if (!numMatch) continue;
    const num = parseInt(numMatch[1], 10);
    if (isNaN(num) || num <= 0) continue;
    const dateMatch = s.match(/(\d{6})/);
    const yymmdd = dateMatch ? dateMatch[1] : '';
    if (targetYymm.length === 4 && yymmdd && yymmdd.slice(0, 4) > targetYymm) {
      continue;
    }
    parsedSessions.push({ num, yymmdd });
  }

  // 이번 달 확정 일정과 연동된 시트 탭 및 현재 조회 월보다 미래 월의 시트 탭은 과거 완료 회차 목록에서 제외
  const pastSessions = availableSessions.filter(s => {
    if (!s) return false;
    if (confirmedScheduleYymmddList.some(yymmdd => s.includes(yymmdd))) return false;
    if (targetYymm.length === 4) {
      const m = s.match(/(\d{6})/);
      if (m && m[1].slice(0, 4) >= targetYymm) {
        return false;
      }
    }
    return true;
  });

  const maxCompleted = getMaxCompletedSessionNumber(pastSessions);
  const effectiveBase = Math.max(maxCompleted, baseSessionNumberOverride || 0);
  const usedNumbers = new Set<number>();

  // 이번 달 이하의 모든 실제 시트 회차 번호는 중복 할당되지 않도록 선점 등록
  for (const ps of parsedSessions) {
    usedNumbers.add(ps.num);
  }

  // 1차 패스: 실제 시트 탭이 연동된 회차(sheetTitle 또는 availableSessions 매칭) 우선 고정
  for (const item of sorted) {
    const count = item.attendees ? item.attendees.length : 0;
    if (count >= 4 && item.isConfirmed) {
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

      // 초기 마운트 시 아직 완료 회차나 이전 달 기준점(effectiveBase)이 로드되지 않은 경우에만 DB sessionNumber 폴백
      if (!matchedNum && effectiveBase === 0 && typeof item.sessionNumber === 'number' && item.sessionNumber > 0) {
        matchedNum = item.sessionNumber;
      }

      if (matchedNum && !isNaN(matchedNum)) {
        sessionMap.set(item.date, matchedNum);
        usedNumbers.add(matchedNum);
      }
    }
  }

  // 2차 패스: 시트 미생성 확정 일정에 날짜 순으로 번호 부여 (이전 날짜의 시트/확정 회차 번호 이후로 단조 증가 보장)
  let candidateNum = effectiveBase + 1;
  for (const item of sorted) {
    const itemYymmdd = item.date.replace(/-/g, '').slice(2);

    // 해당 날짜 이전에 이미 완료된 구글 시트 회차가 있다면 그 번호 이후로 기준점 전진
    for (const ps of parsedSessions) {
      if (ps.yymmdd && ps.yymmdd <= itemYymmdd && ps.num >= candidateNum) {
        candidateNum = ps.num + 1;
      }
    }

    if (sessionMap.has(item.date)) {
      const lockedNum = sessionMap.get(item.date)!;
      if (lockedNum >= candidateNum) {
        candidateNum = lockedNum + 1;
      }
      continue;
    }

    const count = item.attendees ? item.attendees.length : 0;
    if (count >= 4 && item.isConfirmed) {
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
