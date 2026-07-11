<script setup lang="ts">
import { useI18n } from "vue-i18n"
import { ref, onMounted } from "vue"

/**i18n 속성 가져오기*/
const { t } = useI18n()

/**Props 정의*/
type Props = {
  googleInfo: {
    isLoggedIn: boolean
    spreadsheetId: string
    syncMode: string
  }
}
const props = defineProps<Props>()

/**emits 정의*/
type Emits = {
  (e: 'show-modal', type: string, status?: string): void,
  (e: 'start-new-game'): void,
  (e: 'sync-local-to-google'): void
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
  <div @click.stop="toggleTheme()" class="theme_toggle">
    {{ t('menu.theme') }} {{ isDark ? '☾︎' : '☀︎' }}
  </div>
  <div @click.stop="emit('start-new-game')" class="btn_new_game" style="color: var(--color-negative); font-weight: bold;">
    새 게임
  </div>
  <!-- 3번째 row, 1번째 column에 동기화 다이렉트 버튼 배치 -->
  <div 
    class="btn_direct_sync" 
    :class="{ disabled: !googleInfo.isLoggedIn }" 
    @click.stop="handleSyncClick"
  >
    동기화
  </div>
  <!-- 3번째 row, 2번째 column에 동기화 설정, 3번째 column에 스탯 배치 -->
  <div class="btn_sync" @click.stop="emit('show-modal', 'sync')">
    동기화 설정
  </div>
  <div class="btn_stats" @click.stop="emit('show-modal', 'stats')">
    스탯
  </div>
</div>
</template>

<style scoped>
/* 메뉴 선택창 - 모바일 375SE 화면 최적화 (3x3 그리드 구조) */
.container_choose_menu{
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
}
</style>