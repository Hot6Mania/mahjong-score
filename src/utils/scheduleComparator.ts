import type { ScheduleMonthData } from '@/types/schedule';

/**
 * 두 스케줄 월 데이터 간의 실질적 내용 변경 여부를 정밀하게 대조합니다.
 * 타임스탬프(updatedAt)나 JSON 직렬화 키 순서 차이로 인한 불필요한 리렌더링을 원천 방지합니다.
 */
export function isScheduleDataEqual(
  current: ScheduleMonthData | null | undefined,
  incoming: ScheduleMonthData | null | undefined
): boolean {
  if (!current && !incoming) return true;
  if (!current || !incoming) return false;
  if (current.month !== incoming.month) return false;

  const curDates = current.dates || [];
  const incDates = incoming.dates || [];

  if (curDates.length !== incDates.length) return false;

  const curMap = new Map(curDates.map(d => [d.date, d]));

  for (const incD of incDates) {
    const curD = curMap.get(incD.date);
    if (!curD) return false;

    // 1. 회차 및 날짜 기본 속성 비교
    if (curD.sessionType !== incD.sessionType) return false;
    if ((curD.adminSessionType || curD.sessionType) !== (incD.adminSessionType || incD.sessionType)) return false;
    if ((curD.customStartTime || '10:00') !== (incD.customStartTime || '10:00')) return false;
    if ((curD.customEndTime || '22:00') !== (incD.customEndTime || '22:00')) return false;
    if (Boolean(curD.customIsOvernight) !== Boolean(incD.customIsOvernight)) return false;
    if ((curD.creator || '') !== (incD.creator || '')) return false;
    if ((curD.note || '') !== (incD.note || '')) return false;
    if (Boolean(curD.isClosed) !== Boolean(incD.isClosed)) return false;
    if (Boolean(curD.isConfirmed) !== Boolean(incD.isConfirmed)) return false;
    if ((curD.sessionNumber || null) !== (incD.sessionNumber || null)) return false;
    if ((curD.sheetTitle || '') !== (incD.sheetTitle || '')) return false;

    // 2. 참석자 목록 비교
    const curAtt = curD.attendees || [];
    const incAtt = incD.attendees || [];
    if (curAtt.length !== incAtt.length) return false;

    for (let i = 0; i < curAtt.length; i++) {
      const ca = curAtt[i];
      const ia = incAtt[i];
      if (ca.name !== ia.name) return false;
      if (Boolean(ca.isOvernight) !== Boolean(ia.isOvernight)) return false;
      if ((ca.startTime || '10:00') !== (ia.startTime || '10:00')) return false;
      if ((ca.endTime || '22:00') !== (ia.endTime || '22:00')) return false;
      if (Boolean(ca.isCustomTime) !== Boolean(ia.isCustomTime)) return false;
      if ((ca.memo || '') !== (ia.memo || '')) return false;
    }
  }

  return true;
}
