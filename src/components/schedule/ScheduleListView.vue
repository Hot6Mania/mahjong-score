<script setup lang="ts">
import { computed } from 'vue';
import type { ScheduleDayItem } from '@/types/schedule';
import { computeEffectiveOverlapRange } from '@/utils/timelineEngine';

const props = defineProps<{
  dates: ScheduleDayItem[];
  sessionMap: Map<string, number>;
  myAttendeeName?: string;
}>();

const emit = defineEmits<{
  (e: 'selectDay', dayItem: ScheduleDayItem): void;
  (e: 'openAttend', dayItem: ScheduleDayItem): void;
  (e: 'openAdmin'): void;
}>();

// 날짜순 오름차순 정렬된 일정 목록
const sortedDates = computed(() => {
  return [...props.dates].sort((a, b) => a.date.localeCompare(b.date));
});

const getDayOfWeek = (dateStr: string) => {
  const d = new Date(dateStr);
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return days[d.getDay()] || '';
};

const formatDateLabel = (dateStr: string) => {
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    return `${m}월 ${d}일`;
  }
  return dateStr;
};

const isUserAttending = (day: ScheduleDayItem) => {
  if (!day.attendees || !props.myAttendeeName) return false;
  return day.attendees.some(a => a.name === props.myAttendeeName);
};

const getOverlapRange = (day: ScheduleDayItem) => {
  return computeEffectiveOverlapRange(day.attendees);
};
</script>

<template>
  <div class="schedule-list-container">
    <div v-if="sortedDates.length === 0" class="empty-list-card">
      <p class="empty-text">이번 달에 등록된 일정이 없습니다.</p>
      <button type="button" class="btn-empty-action" @click="emit('openAdmin')">
        후보 일정 관리
      </button>
    </div>

    <div v-else class="cards-grid">
      <div 
        v-for="item in sortedDates" 
        :key="item.date"
        class="agenda-card"
        :class="{ 'my-session': isUserAttending(item) }"
      >
        <!-- 카드 상단: 날짜, 회차, 세션 유형, 인원수 -->
        <div class="card-header">
          <div class="header-left">
            <span v-if="sessionMap.get(item.date)" class="session-badge badge-confirmed">
              제{{ sessionMap.get(item.date) }}회
            </span>
            <span v-else class="session-badge badge-recruiting">
              {{ (item.attendees?.length || 0) >= 4 ? '확정 대기' : '모집중' }}
            </span>
            <h4 class="card-date">
              {{ formatDateLabel(item.date) }} ({{ getDayOfWeek(item.date) }})
            </h4>
            <span 
              class="type-pill"
              :class="{
                'pill-overnight': item.sessionType === 'overnight',
                'pill-custom': item.sessionType === 'custom',
                'pill-day': !item.sessionType || item.sessionType === 'day'
              }"
            >
              {{ item.sessionType === 'overnight' ? `밤샘 (${item.customStartTime || '10:00'} ~ 익일)` : (item.sessionType === 'custom' ? `커스텀 (${item.customStartTime || '10:00'} ~ ${item.customEndTime || '22:00'}${item.customIsOvernight ? ' 익일' : ''})` : `당일 (${item.customStartTime || '10:00'} ~ ${item.customEndTime || '22:00'})`) }}
            </span>
          </div>

          <div class="header-right">
            <!-- 수식어 (성립) 일절 없이 숫자만 깔끔하게 -->
            <span 
              class="count-badge"
              :class="{
                'badge-full': (item.attendees?.length || 0) >= 5,
                'badge-min': (item.attendees?.length || 0) === 4,
                'badge-wait': (item.attendees?.length || 0) < 4
              }"
            >
              {{ item.attendees?.length || 0 }}명
            </span>
          </div>
        </div>

        <!-- 카드 중단: 겹치는 유효 시간 및 참가자 칩 -->
        <div class="card-body">
          <div v-if="getOverlapRange(item)" class="overlap-notice">
            <span class="overlap-dot"></span>
            <span class="overlap-text">대국 가능 시간: {{ getOverlapRange(item) }}</span>
          </div>

          <div class="attendee-chips-wrapper">
            <span class="chips-label">참가자:</span>
            <div v-if="!item.attendees || item.attendees.length === 0" class="no-attendees-text">
              아직 신청 없음
            </div>
            <div v-else class="chips-row">
              <span 
                v-for="att in item.attendees" 
                :key="att.id"
                class="attendee-chip"
                :class="{ 'is-me': att.name === myAttendeeName }"
                :title="att.memo || (att.isCustomTime ? `${att.startTime}~${att.endTime}` : (att.isOvernight ? '밤샘' : '당일'))"
              >
                {{ att.name }}
                <span v-if="att.name === myAttendeeName" class="me-indicator">나</span>
                <span v-if="att.isCustomTime" class="custom-time-tag">{{ att.startTime }}~{{ att.endTime }}</span>
                <span v-else-if="att.isOvernight" class="overnight-tag">밤샘</span>
              </span>
            </div>
          </div>
        </div>

        <!-- 카드 하단 버튼 -->
        <div class="card-footer">
          <button 
            type="button" 
            class="btn-detail"
            @click="emit('selectDay', item)"
          >
            상세 보기
          </button>
          <button 
            type="button" 
            class="btn-attend"
            :class="{ 'btn-attend-edit': isUserAttending(item) }"
            @click="emit('openAttend', item)"
          >
            {{ isUserAttending(item) ? '내 참석 수정' : '참석 신청' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.schedule-list-container,
.schedule-list-container * {
  font-family: 'Noto Sans KR', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.schedule-list-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.empty-list-card {
  padding: 40px 20px;
  text-align: center;
  background: var(--card-bg-color, #ffffff);
  border: 1px dashed var(--border-color, #cbd5e1);
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.empty-text {
  font-size: 14px;
  color: var(--text-dimmed, #64748b);
  margin: 0;
}

.btn-empty-action {
  background: #2563eb;
  color: #ffffff;
  border: none;
  padding: 8px 16px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}
.btn-empty-action:hover {
  opacity: 0.9;
}

.cards-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.agenda-card {
  background: var(--card-bg-color, #ffffff);
  border: 1px solid var(--border-color, rgba(0, 0, 0, 0.08));
  border-radius: 16px;
  padding: 16px 18px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.02);
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition: all 0.15s ease;
}
.agenda-card:hover {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
  border-color: rgba(59, 130, 246, 0.25);
}

.agenda-card.my-session {
  border-left: 4px solid #3b82f6;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.card-date {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--text-color, #0f172a);
}

.session-badge {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 6px;
  background: rgba(59, 130, 246, 0.15);
  color: #2563eb;
}
.session-badge.badge-confirmed {
  background: rgba(37, 99, 235, 0.15);
  color: #2563eb;
  border: 1px solid rgba(37, 99, 235, 0.25);
}
:global(html.dark) .session-badge.badge-confirmed {
  background: rgba(59, 130, 246, 0.22);
  color: #60a5fa;
  border-color: rgba(59, 130, 246, 0.4);
}
.session-badge.badge-recruiting {
  background: rgba(245, 158, 11, 0.15);
  color: #d97706;
}
:global(html.dark) .session-badge.badge-recruiting {
  background: rgba(245, 158, 11, 0.22);
  color: #fbbf24;
}

.type-pill {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 6px;
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
  background: rgba(16, 185, 129, 0.14);
  color: #059669;
}

.count-badge {
  font-size: 12px;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 8px;
}
.badge-full {
  background: rgba(16, 185, 129, 0.15);
  color: #059669;
}
.badge-min {
  background: rgba(245, 158, 11, 0.15);
  color: #d97706;
}
.badge-wait {
  background: rgba(148, 163, 184, 0.15);
  color: #64748b;
}

.card-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.overlap-notice {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: #059669;
  background: rgba(16, 185, 129, 0.08);
  padding: 4px 10px;
  border-radius: 6px;
  width: fit-content;
}

.overlap-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #10b981;
}

.attendee-chips-wrapper {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
}

.chips-label {
  color: var(--text-dimmed, #64748b);
  font-size: 12px;
  font-weight: 600;
  margin-top: 3px;
  white-space: nowrap;
}

.no-attendees-text {
  font-size: 12px;
  color: var(--text-dimmed, #64748b);
  margin-top: 3px;
}

.chips-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.attendee-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 8px;
  background: var(--input-bg-color, #f8fafc);
  border: 1px solid var(--border-color, #e2e8f0);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-color, #0f172a);
}

.attendee-chip.is-me {
  background: rgba(59, 130, 246, 0.08);
  border-color: rgba(59, 130, 246, 0.3);
  color: #2563eb;
  font-weight: 600;
}

.me-indicator {
  font-size: 9px;
  background: #3b82f6;
  color: #ffffff;
  padding: 0 4px;
  border-radius: 3px;
  font-weight: 700;
}

.overnight-tag {
  font-size: 10px;
  color: #7c3aed;
  font-weight: 600;
}

.custom-time-tag {
  font-size: 10px;
  color: var(--text-dimmed, #64748b);
}

.card-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  border-top: 1px solid var(--border-color, rgba(0, 0, 0, 0.05));
  padding-top: 10px;
}

.btn-detail {
  background: transparent;
  border: 1px solid var(--border-color, #cbd5e1);
  color: var(--text-color, #0f172a);
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}
.btn-detail:hover {
  background: var(--input-bg-color, #f8fafc);
}

.btn-attend {
  background: #2563eb;
  color: #ffffff;
  border: none;
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}
.btn-attend:hover {
  opacity: 0.9;
}

.btn-attend.btn-attend-edit {
  background: #059669;
}
</style>
