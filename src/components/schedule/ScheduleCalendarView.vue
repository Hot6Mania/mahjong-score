<script setup lang="ts">
import { computed } from 'vue';
import type { ScheduleDayItem } from '@/types/schedule';

const props = defineProps<{
  currentMonth: string; // "YYYY-MM"
  dates: ScheduleDayItem[];
  sessionMap: Map<string, number>; // date -> sessionNumber
  myAttendeeName?: string;
  isAdmin?: boolean;
}>();



interface CalendarCell {
  dayNumber: number;
  dateStr: string;
  isCurrentMonth: boolean;
  dayOfWeek: number; // 0 (Sun) ~ 6 (Sat)
  scheduleItem?: ScheduleDayItem;
  sessionNumber?: number;
}

const calendarGrid = computed<CalendarCell[]>(() => {
  const [yearStr, monthStr] = props.currentMonth.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10); // 1-indexed

  const firstDayOfWeek = new Date(year, month - 1, 1).getDay(); // 0 ~ 6
  const daysInMonth = new Date(year, month, 0).getDate();
  const daysInPrevMonth = new Date(year, month - 1, 0).getDate();

  // 날짜 매핑 딕셔너리
  const dateMap = new Map<string, ScheduleDayItem>();
  for (const d of props.dates) {
    dateMap.set(d.date, d);
  }

  const cells: CalendarCell[] = [];

  // 1. 이전 달 날짜 패딩
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    const day = daysInPrevMonth - i;
    const prevMonthNum = month === 1 ? 12 : month - 1;
    const prevYearNum = month === 1 ? year - 1 : year;
    const dateStr = `${prevYearNum}-${String(prevMonthNum).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    cells.push({
      dayNumber: day,
      dateStr,
      isCurrentMonth: false,
      dayOfWeek: new Date(prevYearNum, prevMonthNum - 1, day).getDay()
    });
  }

  // 2. 이번 달 날짜
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${yearStr}-${monthStr.padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const scheduleItem = dateMap.get(dateStr);
    const sessionNumber = props.sessionMap.get(dateStr);
    cells.push({
      dayNumber: d,
      dateStr,
      isCurrentMonth: true,
      dayOfWeek: new Date(year, month - 1, d).getDay(),
      scheduleItem,
      sessionNumber
    });
  }

  // 3. 다음 달 날짜 패딩 (7의 배수 맞춤)
  const remaining = (7 - (cells.length % 7)) % 7;
  for (let d = 1; d <= remaining; d++) {
    const nextMonthNum = month === 12 ? 1 : month + 1;
    const nextYearNum = month === 12 ? year + 1 : year;
    const dateStr = `${nextYearNum}-${String(nextMonthNum).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({
      dayNumber: d,
      dateStr,
      isCurrentMonth: false,
      dayOfWeek: new Date(nextYearNum, nextMonthNum - 1, d).getDay()
    });
  }

  return cells;
});

const emit = defineEmits<{
  (e: 'selectDay', dayItem: ScheduleDayItem): void;
  (e: 'clickEmptyDay', dateStr: string): void;
}>();

const isUserAttending = (item?: ScheduleDayItem) => {
  if (!item?.attendees || !props.myAttendeeName) return false;
  return item.attendees.some(a => a.name === props.myAttendeeName);
};

const handleCellClick = (cell: CalendarCell) => {
  if (!cell.isCurrentMonth) return;
  if (cell.scheduleItem) {
    emit('selectDay', cell.scheduleItem);
  } else {
    emit('clickEmptyDay', cell.dateStr);
  }
};

const daysHeader = ['일', '월', '화', '수', '목', '금', '토'];

const todayStr = (() => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
})();
</script>

<template>
  <div class="calendar-container">
    <!-- 요일 헤더 -->
    <div class="calendar-week-header">
      <div 
        v-for="(day, idx) in daysHeader" 
        :key="day"
        class="week-day-name"
        :class="{ 'day-sun': idx === 0, 'day-sat': idx === 6 }"
      >
        {{ day }}
      </div>
    </div>

    <!-- 캘린더 일자 그리드 -->
    <div class="calendar-days-grid">
      <div
        v-for="cell in calendarGrid"
        :key="cell.dateStr"
        class="calendar-cell"
        :class="{
          'other-month': !cell.isCurrentMonth,
          'has-schedule': !!cell.scheduleItem,
          'session-day': cell.scheduleItem && (!cell.scheduleItem.sessionType || cell.scheduleItem.sessionType === 'day'),
          'session-overnight': cell.scheduleItem && cell.scheduleItem.sessionType === 'overnight',
          'session-custom': cell.scheduleItem && cell.scheduleItem.sessionType === 'custom',
          'empty-schedule': cell.isCurrentMonth && !cell.scheduleItem,
          'day-sun': cell.dayOfWeek === 0,
          'day-sat': cell.dayOfWeek === 6,
          'clickable': cell.isCurrentMonth && (!!cell.scheduleItem || !!props.isAdmin),
          'is-today': cell.dateStr === todayStr
        }"
        @click="handleCellClick(cell)"
      >
        <div class="cell-top">
          <div class="day-num-wrap">
            <span class="day-num">{{ cell.dayNumber }}</span>
            <span 
              v-if="cell.scheduleItem"
              class="type-pill"
              :class="{
                'pill-overnight': cell.scheduleItem.sessionType === 'overnight',
                'pill-custom': cell.scheduleItem.sessionType === 'custom',
                'pill-day': !cell.scheduleItem.sessionType || cell.scheduleItem.sessionType === 'day'
              }"
            >
              {{ cell.scheduleItem.sessionType === 'overnight' ? '밤샘' : (cell.scheduleItem.sessionType === 'custom' ? '커스텀' : '당일') }}
            </span>
          </div>
          <div class="cell-top-right">
            <span v-if="isUserAttending(cell.scheduleItem)" class="my-attend-dot" title="내 참석"></span>
            <span v-if="cell.dateStr === todayStr" class="today-badge">오늘</span>
          </div>
        </div>

        <!-- 후보 일정 정보 -->
        <div v-if="cell.scheduleItem" class="cell-content">
          <!-- 1. 아직 회차가 개설되지 않은 가능한 날짜 -->
          <div v-if="!cell.scheduleItem.creator || !cell.scheduleItem.attendees?.length" class="cell-uncreated-box">
            <span class="pill-create-action">+ 회차 개설</span>
          </div>

          <!-- 2. 이미 회차가 개설된 날짜 -->
          <div v-else class="cell-created-box">
            <!-- 회차 & 인원수 뱃지 (수식어 없이 깔끔) -->
            <div 
              class="status-pill"
              :class="{
                'pill-confirmed': cell.scheduleItem.isConfirmed && cell.sessionNumber,
                'pill-pending': !cell.scheduleItem.isConfirmed && (cell.scheduleItem.attendees?.length || 0) >= 4,
                'pill-recruiting': !cell.scheduleItem.isConfirmed && (cell.scheduleItem.attendees?.length || 0) < 4
              }"
            >
              <span v-if="cell.scheduleItem.isConfirmed && cell.sessionNumber" class="session-label">제{{ cell.sessionNumber }}회</span>
              <span v-else class="status-label">{{ (cell.scheduleItem.attendees?.length || 0) >= 4 ? '확정 대기' : '모집중' }}</span>
              <span class="count-label">{{ cell.scheduleItem.attendees?.length || 0 }}명</span>
            </div>

            <!-- 참가 인원 이름 노출 (최대 6인까지 달력에서 모두 표시, 호버 시 메모 툴팁) -->
            <div v-if="cell.scheduleItem.attendees?.length" class="cell-attendees-list">
              <span
                v-for="att in cell.scheduleItem.attendees.slice(0, 6)"
                :key="att.id"
                class="cell-att-name"
                :class="{ 'is-me': att.name === myAttendeeName }"
                :title="att.memo ? `${att.name} (${att.memo})` : att.name"
              >
                {{ att.name }}
              </span>
              <span v-if="cell.scheduleItem.attendees.length > 6" class="cell-att-more">
                +{{ cell.scheduleItem.attendees.length - 6 }}
              </span>
            </div>
          </div>
        </div>
        <div v-else-if="cell.isCurrentMonth && isAdmin" class="cell-empty-action">
          <span class="empty-add-icon" title="관리자 일정 등록">+</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.calendar-container,
.calendar-container * {
  font-family: inherit;
}

.calendar-container {
  background: var(--card-bg-color, #ffffff);
  border: 1px solid var(--border-color, rgba(0, 0, 0, 0.08));
  border-radius: 18px;
  overflow: hidden;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.03);
}

.cell-uncreated-box {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pill-create-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  padding: 3px 6px;
  border-radius: 6px;
  background: rgba(37, 99, 235, 0.12);
  color: #2563eb;
  border: 1px dashed rgba(37, 99, 235, 0.4);
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transform: translateY(2px);
  transition: opacity 0.15s ease, transform 0.15s ease, background 0.15s ease, color 0.15s ease;
  font-family: inherit;
}
.calendar-cell:hover .pill-create-action {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
  background: #2563eb;
  color: #ffffff;
  border-style: solid;
}

.calendar-week-header {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  background: var(--input-bg-color, #f8fafc);
  border-bottom: 1px solid var(--border-color, #e2e8f0);
}

.week-day-name {
  padding: 10px 4px;
  text-align: center;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-dimmed, #64748b);
  font-family: inherit;
}
.week-day-name.day-sun {
  color: #ef4444;
}
.week-day-name.day-sat {
  color: #3b82f6;
}

.calendar-days-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  grid-auto-rows: minmax(96px, 1fr);
}

.calendar-cell {
  border-right: 1px solid var(--border-color, rgba(0, 0, 0, 0.05));
  border-bottom: 1px solid var(--border-color, rgba(0, 0, 0, 0.05));
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: 4px;
  position: relative;
  transition: background 0.15s ease, box-shadow 0.15s ease;
  background: transparent;
  font-family: inherit;
}

.calendar-cell:nth-child(7n) {
  border-right: none;
}

.calendar-cell.other-month {
  opacity: 0.25;
  background: rgba(0, 0, 0, 0.01);
}

/* 당일만 되는 날: 옅은 스카이블루 블럭 */
.calendar-cell.session-day {
  background: rgba(59, 130, 246, 0.04);
}
.calendar-cell.session-day:hover {
  background: rgba(59, 130, 246, 0.09);
}

/* 밤샘만 되는 날: 옅은 퍼플 블럭 */
.calendar-cell.session-overnight {
  background: rgba(139, 92, 246, 0.05);
}
.calendar-cell.session-overnight:hover {
  background: rgba(139, 92, 246, 0.11);
}

/* 커스텀 일정인 날: 옅은 에메랄드 블럭 */
.calendar-cell.session-custom {
  background: rgba(16, 185, 129, 0.04);
}
.calendar-cell.session-custom:hover {
  background: rgba(16, 185, 129, 0.09);
}

:global(html.dark) .calendar-cell.session-day {
  background: rgba(59, 130, 246, 0.08);
}
:global(html.dark) .calendar-cell.session-day:hover {
  background: rgba(59, 130, 246, 0.14);
}
:global(html.dark) .calendar-cell.session-overnight {
  background: rgba(139, 92, 246, 0.09);
}
:global(html.dark) .calendar-cell.session-overnight:hover {
  background: rgba(139, 92, 246, 0.16);
}
:global(html.dark) .calendar-cell.session-custom {
  background: rgba(16, 185, 129, 0.08);
}
:global(html.dark) .calendar-cell.session-custom:hover {
  background: rgba(16, 185, 129, 0.14);
}

.calendar-cell.clickable {
  cursor: pointer;
}
.calendar-cell.clickable:hover {
  box-shadow: inset 0 0 0 1px rgba(59, 130, 246, 0.25);
}

.calendar-cell.is-today {
  background: rgba(59, 130, 246, 0.07);
  box-shadow: inset 0 0 0 2px rgba(59, 130, 246, 0.55);
}

.cell-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.cell-top-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.day-num-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
}

.day-num {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color, #0f172a);
}
.calendar-cell.is-today .day-num {
  color: #2563eb;
  font-weight: 800;
}
.calendar-cell.day-sun .day-num {
  color: #ef4444;
}
.calendar-cell.day-sat .day-num {
  color: #3b82f6;
}

.today-badge {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 4px;
  background: #2563eb;
  color: #ffffff;
  line-height: 1.2;
}

.my-attend-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #3b82f6;
  box-shadow: 0 0 4px rgba(59, 130, 246, 0.6);
}

.cell-content {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 2px;
}

.type-pill {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 4px;
  width: fit-content;
  line-height: 1.3;
  font-family: inherit;
}
.pill-day {
  background: rgba(59, 130, 246, 0.12);
  color: #2563eb;
}
.pill-overnight {
  background: rgba(139, 92, 246, 0.14);
  color: #7c3aed;
}
.pill-custom {
  background: rgba(16, 185, 129, 0.12);
  color: #059669;
}

.cell-attendees-list {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  margin-top: 2px;
}

.cell-att-name {
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--input-bg-color, #f1f5f9);
  color: var(--text-color, #334155);
  line-height: 1.2;
  white-space: nowrap;
  max-width: 52px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: inherit;
}
.cell-att-name.is-me {
  background: rgba(59, 130, 246, 0.15);
  color: #2563eb;
  font-weight: 700;
}

.cell-att-more {
  font-size: 9px;
  font-weight: 700;
  color: var(--text-dimmed, #64748b);
  align-self: center;
  font-family: inherit;
}

.status-pill {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  line-height: 1.2;
  font-family: inherit;
}

.status-pill.pill-confirmed {
  background: rgba(37, 99, 235, 0.14);
  color: #2563eb;
  border: 1px solid rgba(37, 99, 235, 0.25);
}
:global(html.dark) .status-pill.pill-confirmed {
  background: rgba(59, 130, 246, 0.22);
  color: #60a5fa;
  border-color: rgba(59, 130, 246, 0.4);
}

.status-pill.pill-pending {
  background: rgba(245, 158, 11, 0.14);
  color: #d97706;
}
:global(html.dark) .status-pill.pill-pending {
  background: rgba(245, 158, 11, 0.2);
  color: #fbbf24;
}

.status-pill.pill-recruiting {
  background: rgba(148, 163, 184, 0.12);
  color: #64748b;
}
:global(html.dark) .status-pill.pill-recruiting {
  background: rgba(148, 163, 184, 0.18);
  color: #94a3b8;
}

.status-label {
  font-size: 10px;
  font-weight: 700;
  opacity: 0.95;
}

.session-label {
  font-size: 10px;
  font-weight: 700;
  opacity: 0.95;
}

.count-label {
  font-size: 11px;
}

.cell-empty-action {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  opacity: 0;
  transition: opacity 0.15s;
}
.calendar-cell.clickable:hover .cell-empty-action {
  opacity: 0.6;
}
.empty-add-icon {
  font-size: 18px;
  font-weight: 300;
  color: var(--text-dimmed, #64748b);
  line-height: 1;
}

@media (max-width: 640px) {
  .calendar-days-grid {
    grid-auto-rows: minmax(70px, 1fr);
  }
  .calendar-cell {
    padding: 4px;
    gap: 2px;
  }
  .type-pill {
    font-size: 9px;
  }
  .status-pill {
    font-size: 10px;
    padding: 1px 4px;
    flex-direction: column;
    align-items: flex-start;
  }
  .session-label {
    display: none;
  }
}
</style>
