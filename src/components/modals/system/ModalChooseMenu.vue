<script setup lang="ts">
import { useI18n } from "vue-i18n"
import { ref, computed, onMounted } from "vue"

/**i18n 속성 가져오기*/
const { t } = useI18n()

/**Props 정의*/
type Props = {
  googleInfo: {
    isLoggedIn: boolean
    spreadsheetId: string
    syncMode: string
  },
  currentSessionSheetName?: string,
  isSessionClosed?: boolean,
  eventMatchLabel?: string,
  eventLocale?: 'en' | 'ja' | 'ko',
  isCloudSaving?: boolean,
  liveSyncStatus?: 'idle' | 'syncing' | 'synced' | 'error',
  liveLastSyncedAt?: number
}
const props = defineProps<Props>()

const formattedSyncTime = computed(() => {
  const ts = Number(props.liveLastSyncedAt || 0)
  if (!ts) return ''
  try {
    const d = new Date(ts)
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${hh}:${mm}`
  } catch {
    return ''
  }
})

/**emits 정의*/
type Emits = {
  (e: 'show-modal', type: string, status?: string): void,
  (e: 'start-new-game'): void,
  (e: 'sync-local-to-google'): void,
  (e: 'back-to-event-dashboard'): void,
  (e: 'change-event-locale', loc: 'en' | 'ja' | 'ko'): void,
  (e: 'cloud-save-event'): void,
  (e: 'finish-event-early'): void
}
const emit = defineEmits<Emits>()

/**테마 설정*/
const isDark = ref(false)

onMounted(() => {
  isDark.value = document.documentElement.classList.contains('dark')
})

const toggleTheme = () => {
  isDark.value = !isDark.value
  if (isDark.value) {
    document.documentElement.classList.add('dark')
    localStorage.setItem('theme', 'dark')
  } else {
    document.documentElement.classList.remove('dark')
    localStorage.setItem('theme', 'light')
  }
}

const handleSyncClick = () => {
  if (!props.googleInfo.isLoggedIn) return; // 로컬 모드일 때는 클릭 무반응
  emit('sync-local-to-google')
}
</script>

<template>
<div v-if="eventMatchLabel" class="menu_wrapper event_menu_wrapper">
  <div class="session_status_bar event_status_bar">
    <div class="session_badge_left">
      <span class="session_dot" :class="{ online: liveSyncStatus !== 'error', error: liveSyncStatus === 'error' }"></span>
      <span class="session_name">{{ eventMatchLabel }}</span>
      <span v-if="liveSyncStatus === 'error'" class="event_sync_pill is-error">⚠️ SYNC</span>
      <span v-else-if="formattedSyncTime" class="event_sync_pill">☁️ {{ formattedSyncTime }}</span>
    </div>
    <div class="event_hdr_controls">
      <button
        type="button"
        class="event_theme_icon_btn"
        :title="isDark ? 'Light Mode' : 'Dark Mode'"
        @click.stop="toggleTheme()"
      >
        <svg v-if="isDark" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="5"></circle>
          <line x1="12" y1="1" x2="12" y2="3"></line>
          <line x1="12" y1="21" x2="12" y2="23"></line>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
          <line x1="1" y1="12" x2="3" y2="12"></line>
          <line x1="21" y1="12" x2="23" y2="12"></line>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
        </svg>
        <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
        </svg>
      </button>
      <div class="event_lang_inline">
        <button type="button" :class="{ active: eventLocale === 'en' }" @click.stop="emit('change-event-locale', 'en')">EN</button>
        <button type="button" :class="{ active: eventLocale === 'ja' }" @click.stop="emit('change-event-locale', 'ja')">JA</button>
        <button type="button" :class="{ active: eventLocale === 'ko' }" @click.stop="emit('change-event-locale', 'ko')">KO</button>
      </div>
    </div>
  </div>

  <div class="container_choose_menu event_choose_menu">
    <div @click.stop="emit('show-modal', 'result_sheet')">
      {{ t('menu.resultSheet') }}
    </div>
    <div @click.stop="emit('show-modal', 'show_record')">
      {{ t('menu.record') }}
    </div>
    <div @click.stop="emit('show-modal', 'set_options')">
      {{ t('menu.option') }}
    </div>
    <div @click.stop="emit('finish-event-early')" class="btn_early_finish_cell">
      {{ t('option.earlyFinish') }}
    </div>
    <div @click.stop="emit('start-new-game')" style="color: var(--color-negative); font-weight: bold;">
      {{ t('menu.newGame') }}
    </div>
    <div @click.stop="emit('back-to-event-dashboard')" style="color: var(--color-toggle-on); font-weight: bold;">
      {{ t('menu.backToLeague') }}
    </div>
  </div>
  <div class="event_menu_footer_actions">
    <button
      type="button"
      class="btn_change_seats_event"
      @click.stop="emit('show-modal', 'edit_event_seats')"
    >
      🔄 {{ t('menu.changeSeats') }}
    </button>
    <button
      type="button"
      class="btn_cloud_save_event"
      :class="{ 'is-error': liveSyncStatus === 'error' }"
      :disabled="isCloudSaving"
      @click.stop="emit('cloud-save-event')"
    >
      {{ liveSyncStatus === 'error' ? '⚠️' : '☁️' }} {{ isCloudSaving ? t('menu.cloudSaving') : t('menu.cloudSave') }}
    </button>
  </div>
</div>

<div v-else class="menu_wrapper">
  <!-- 상단 현재 회차 연동 정보 및 마감 상태 뱃지 -->
  <div class="session_status_bar">
    <div class="session_badge_left">
      <span class="session_dot" :class="{ online: googleInfo.isLoggedIn && googleInfo.syncMode === 'google' }"></span>
      <span class="session_title">연동 회차:</span>
      <span class="session_name">{{ currentSessionSheetName || '회차 미연동' }}</span>
    </div>
    <span v-if="isSessionClosed" class="session_closed_badge">🔒 종료됨</span>
  </div>

  <!-- 메뉴 선택창 (3x3 그리드로 배치) -->
  <div class="container_choose_menu">
    <div @click.stop="emit('show-modal', 'result_sheet')">
      {{ t('menu.resultSheet') }}
    </div>
    <div @click.stop="emit('show-modal', 'show_record')">
      {{ t('menu.record') }}
    </div>
    <div @click.stop="emit('show-modal', 'set_options')">
      {{ t('menu.option') }}
    </div>
    <div @click.stop="emit('show-modal', 'total_uma')">
      총 우마
    </div>
    <!-- 화면모드 토글 (SVG 달/해 아이콘 적용) -->
    <div @click.stop="toggleTheme()" class="theme_toggle" :title="isDark ? '라이트 모드로 전환' : '다크 모드로 전환'">
      <span>{{ t('menu.theme') }}</span>
      <svg v-if="isDark" class="theme_svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="5"></circle>
        <line x1="12" y1="1" x2="12" y2="3"></line>
        <line x1="12" y1="21" x2="12" y2="23"></line>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
        <line x1="1" y1="12" x2="3" y2="12"></line>
        <line x1="21" y1="12" x2="23" y2="12"></line>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
      </svg>
      <svg v-else class="theme_svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
      </svg>
    </div>
    <div @click.stop="emit('start-new-game')" class="btn_new_game" style="color: var(--color-negative); font-weight: bold;">
      새 게임
    </div>
    <!-- 3번째 row, 1번째 column에 동기화 다이렉트 버튼 배치 -->
    <div 
      class="btn_direct_sync" 
      :class="{ disabled: !googleInfo.isLoggedIn, closed: isSessionClosed }" 
      @click.stop="handleSyncClick"
    >
      {{ isSessionClosed ? '🔒 동기화' : '동기화' }}
    </div>
    <!-- 3번째 row, 2번째 column에 동기화 설정, 3번째 column에 스탯 배치 -->
    <div class="btn_sync" @click.stop="emit('show-modal', 'sync')">
      동기화 설정
    </div>
    <div class="btn_stats" @click.stop="emit('show-modal', 'stats')">
      스탯
    </div>
  </div>
</div>
</template>

<style scoped>
.menu_wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

/* 상단 연동 회차 뱃지 바 */
.session_status_bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 290px;
  box-sizing: border-box;
  padding: 7px 10px;
  margin-top: 2px;
  margin-bottom: 2px;
  background-color: var(--color-input-bg, rgba(125, 125, 125, 0.08));
  border: 1px solid var(--color-border, rgba(125, 125, 125, 0.2));
  border-radius: 6px;
  font-size: 12px;
}
.session_badge_left {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session_dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background-color: var(--color-offline, #999);
  flex-shrink: 0;
}
.session_dot.online {
  background-color: var(--color-positive, #4caf50);
  box-shadow: 0 0 5px var(--color-positive, #4caf50);
}
.session_dot.error {
  background-color: var(--color-negative, #ef4444);
  box-shadow: 0 0 5px var(--color-negative, #ef4444);
}
.event_sync_pill {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-dimmed, #64748b);
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(125, 125, 125, 0.12);
  white-space: nowrap;
}
.event_sync_pill.is-error {
  color: var(--color-negative, #ef4444);
  background: rgba(239, 68, 68, 0.16);
}
.session_title {
  color: var(--text-color-muted, #777);
  font-weight: normal;
  flex-shrink: 0;
}
.session_name {
  font-weight: bold;
  color: var(--text-color, #222);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session_closed_badge {
  font-size: 11px;
  font-weight: bold;
  padding: 1px 5px;
  background-color: rgba(244, 67, 54, 0.15);
  color: var(--color-negative, #f44336);
  border: 1px solid rgba(244, 67, 54, 0.3);
  border-radius: 4px;
  flex-shrink: 0;
  margin-left: 6px;
}

/* 메뉴 선택창 - 모바일 375SE 화면 최적화 (3x3 그리드 구조) */
.container_choose_menu {
  display: grid;
  grid-template-rows: repeat(3, 50px);
  grid-template-columns: repeat(3, 1fr);
  width: 290px;
  font-size: 18px;
  font-weight: bold;
  gap: 12px;
  margin: 10px;
  place-items: center;
}
.container_choose_menu > div {
  cursor: pointer;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background-color: transparent;
  transition: opacity 0.2s;
  text-align: center;
  padding: 2px;
  box-sizing: border-box;
}
.container_choose_menu > div:hover {
  opacity: 0.6;
}
.btn_direct_sync {
  grid-row: 3;
  grid-column: 1;
  font-weight: bold;
  color: var(--color-positive, #4caf50); /* 연두색 기본 */
}
.btn_direct_sync.disabled {
  color: #888888 !important; /* 로컬 모드일 때 회색 비활성 */
  cursor: not-allowed !important;
  opacity: 0.5 !important;
}
.btn_direct_sync.closed {
  color: var(--color-warning, #ff9800) !important; /* 종료 회차일 때 주황색 */
}
.btn_sync {
  grid-row: 3;
  grid-column: 2;
  font-weight: bold;
}
.btn_stats {
  grid-row: 3;
  grid-column: 3;
  font-weight: bold;
}
.theme_toggle {
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
}
.theme_svg {
  flex-shrink: 0;
}
.event_hdr_controls {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.event_theme_icon_btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-color);
  cursor: pointer;
}
.event_theme_icon_btn:hover {
  opacity: 0.75;
}
.btn_early_finish_cell {
  color: var(--color-warning, #d97706);
  font-weight: bold;
}
.event_lang_inline {
  display: inline-flex;
  gap: 3px;
}
.event_lang_inline button {
  padding: 2px 6px;
  font-size: 11px;
  font-weight: 800;
  border-radius: 4px;
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-dimmed);
  cursor: pointer;
}
.event_lang_inline button.active {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}
.event_menu_wrapper {
  width: 100%;
  max-width: 100%;
  padding: 2px 4px;
  box-sizing: border-box;
  white-space: normal;
}
.event_status_bar {
  width: 100%;
  font-size: 14.5px;
  padding: 9px 12px;
}
.event_status_bar .event_lang_inline button {
  padding: 4px 9px;
  font-size: 13px;
}
.event_choose_menu {
  width: 100%;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-template-rows: repeat(2, minmax(66px, auto));
  gap: 10px;
  margin: 12px 0;
  font-size: 19px;
  line-height: 1.25;
}
.event_choose_menu > div {
  padding: 10px 8px;
  border-radius: 9px;
  background: var(--color-input-bg, rgba(125, 125, 125, 0.08));
  border: 1px solid var(--color-border, rgba(125, 125, 125, 0.22));
  white-space: normal;
  word-break: keep-all;
  overflow-wrap: break-word;
  line-height: 1.25;
}
.event_menu_footer_actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  width: 100%;
  margin-top: 2px;
}
.btn_change_seats_event {
  width: 100%;
  padding: 12px 10px;
  border-radius: 9px;
  border: 1px solid rgba(59, 130, 246, 0.45);
  background: rgba(59, 130, 246, 0.14);
  color: var(--color-toggle-on, #2563eb);
  font-size: 15.5px;
  font-weight: 800;
  cursor: pointer;
  white-space: normal;
  word-break: keep-all;
  line-height: 1.25;
}
.btn_change_seats_event:hover {
  background: rgba(59, 130, 246, 0.22);
}
.btn_cloud_save_event {
  width: 100%;
  padding: 12px 10px;
  border-radius: 9px;
  border: 1px solid rgba(16, 185, 129, 0.45);
  background: rgba(16, 185, 129, 0.14);
  color: var(--color-positive, #16a34a);
  font-size: 15.5px;
  font-weight: 800;
  cursor: pointer;
  white-space: normal;
  word-break: keep-all;
  line-height: 1.25;
}
.btn_cloud_save_event:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.btn_cloud_save_event.is-error {
  border-color: rgba(239, 68, 68, 0.55);
  background: rgba(239, 68, 68, 0.16);
  color: var(--color-negative, #dc2626);
}
@media (orientation: portrait) {
  .event_menu_wrapper {
    width: 100%;
  }
}
</style>