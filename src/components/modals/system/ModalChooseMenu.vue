<script setup lang="ts">
import { useI18n } from "vue-i18n"
import { ref, onMounted } from "vue"

/**i18n 속성 가져오기*/
const { t } = useI18n()

/**emits 정의*/
type Emits = {
  (e: 'show-modal', type: string, status?: string): void,
  (e: 'start-new-game'): void
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
</script>

<template>
<!-- 메뉴 선택창 -->
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
  <div @click.stop="emit('show-modal', 'sync')">
    동기화 모드
  </div>
  <div @click.stop="toggleTheme()" class="theme_toggle">
    {{ t('menu.theme') }} {{ isDark ? '☾︎' : '☀︎' }}
  </div>
  <div @click.stop="emit('start-new-game')" class="btn_new_game" style="color: var(--color-negative); font-weight: bold;">
    새 게임
  </div>
</div>
</template>

<style scoped>
/* 메뉴 선택창 - 모바일 375SE 화면 최적화 (테두리 및 배경 제거) */
.container_choose_menu{
  display: grid;
  grid-template-rows: repeat(2, 50px);
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
.theme_toggle {
  user-select: none;
}
</style>