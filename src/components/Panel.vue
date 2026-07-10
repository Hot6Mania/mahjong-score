<script setup lang="ts">
import Graphics from "@/components/Graphics.vue"
import type { PanelInfo } from "@/types/types.d"
import { useI18n } from "vue-i18n"

/**i18n 속성 가져오기*/
const { t } = useI18n()

/**props 정의*/
interface Props {
  panelInfo: PanelInfo,
  isMenuOpen: boolean
}
defineProps<Props>()

/**emits 정의*/
type Emits = {
  (e: 'show-modal', modal: string): void,
  (e: 'toggle-menu'): void,
  (e: 'close-menu'): void
}
const emit = defineEmits<Emits>()
</script>

<template>
<!-- 박스 바깥 어두워지는 백드롭 (클릭 시 닫기/취소) -->
<Transition name="panel-fade">
  <div v-if="isMenuOpen" class="menu_backdrop" @click="emit('close-menu')"></div>
</Transition>

<div class="panel_container" id="Mid">
  <!-- 일반 모드 (현재 국, 리치봉 개수, 연장봉 개수) -->
  <Transition name="panel-fade" mode="out-in">
    <div v-if="!isMenuOpen" class="normal_layout" @click.stop="emit('toggle-menu')">
      <!-- 봉 개수 컨테이너 (now의 좌측에 위치) -->
      <div class="sticks_container">
        <!-- 현재 총 리치봉 -->
        <div class="riichi">
          <Graphics kind="riichiStickMini"/>
          <span>x {{ panelInfo.riichi }}</span>
        </div>
        <!-- 현재 연장봉 -->
        <div class="renchan">
          <Graphics kind="renchanStickMini"/>
          <span>x {{ panelInfo.renchan }}</span>
        </div>
      </div>
      <!-- 현재 라운드 -->
      <div class="now">
        {{ panelInfo.wind }} {{ panelInfo.round }} 局
      </div>
    </div>

    <!-- 메뉴 팝업 모드 (화료, 유국, 촌보 버튼들 가로 배열, 완벽한 직사각형 불투명 박스) -->
    <div v-else class="menu_layout" @click.stop>
      <!-- 화료 버튼 -->
      <button class="btn_action win" @click="emit('show-modal', 'check_player_win')">
        {{ t('panel.win') }}
      </button>
      <!-- 구분선 -->
      <div class="menu_separator"></div>
      <!-- 유국 버튼 -->
      <button class="btn_action draw" @click="emit('show-modal', 'choose_draw_kind')">
        {{ t('panel.draw') }}
      </button>
      <!-- 구분선 -->
      <div class="menu_separator"></div>
      <!-- 촌보 버튼 -->
      <button class="btn_action cheat" @click="emit('show-modal', 'check_player_cheat')">
        {{ t('panel.cheat') }}
      </button>
    </div>
  </Transition>
</div>
<!-- 옵션 버튼 -->
<div id="Menu" @click="emit('show-modal', 'choose_menu_kind')">
  <Graphics kind="gear"/>
</div>
</template>

<style scoped>
/* 박스 바깥 어두워지는 백드롭 */
.menu_backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background-color: rgba(0, 0, 0, 0.45); /* 박스 켜지면 바깥이 어두워짐 */
  z-index: 4; /* Mid(z-index: 5) 바로 아래 */
  pointer-events: auto;
}

/* 정보창 위치 */
#Mid{
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  position: fixed;
  z-index: 5;
  pointer-events: none;
}

/* 메뉴창 위치 */
#Menu{
  position: fixed;
  transform: scale(0.75);
  top: 5px;
  left: 5px;
  z-index: 10;
}

/* 일반 모드 컴팩트 카드 레이아웃 (배경/보더 제거, 크기 고정, 크기 전반적 확대) */
.normal_layout {
  pointer-events: auto;
  cursor: pointer;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  width: 280px;
  height: 90px;
  gap: 15px;
  transition: transform 0.05s ease;
}

.normal_layout:hover {
  transform: scale(1.02);
}

.normal_layout:active {
  transform: scale(0.98);
}

/* sticks_container를 now의 좌측에 세로로 배치 */
.sticks_container {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 8px;
  width: 95px; /* 두자리 수까지 여유롭게 표현하도록 너비 확보 */
}

/* 미니 리치봉/연장봉의 하드코딩된 위치 치우침(translate) 강제 리셋, 기울기 각도 유지 및 세로/가로 정밀 중앙 정렬 */
:deep(.stick_mini) {
  transform: rotate(-50deg) !important; /* 약간 기울어진 기존 각도 유지 */
  display: inline-flex !important; /* 가로 및 세로 중심 정렬을 위해 플렉스 컨테이너화 */
  align-items: center !important; /* 수직 중앙 정렬로 빨간 점 쏠림 전격 예방 */
  justify-content: center !important; /* 수평 중앙 정렬 */
  vertical-align: middle;
  width: 44px !important;
  height: 9px !important;
  border-radius: 2px !important;
  margin: 0 !important;
  padding: 0 !important;
  box-sizing: border-box;
  gap: 0.5px !important; /* 점들 사이의 밀도 높은 밀착을 위해 간격 축소 */
}
:deep(.riichi_circle_mini) {
  width: 3.5px !important; /* 리치봉 중앙 빨간 점 크기 적절히 확보 */
  height: 3.5px !important;
  border-radius: 50% !important;
  margin: 0 !important; /* 마진 초기화로 center에 완벽 안착 */
  background-color: var(--color-negative) !important;
  transform: none !important;
}
:deep(.renchan_circle_mini) {
  display: inline-block !important;
  width: 1.5px !important; /* 연장봉의 작은 원통 점 비율 축소 */
  height: 1.5px !important;
  border-radius: 50% !important;
  margin: 0 !important;
  padding: 0 !important;
  background-color: var(--text-color) !important;
}
/* 교대로 위아래로 나누어 번갈아가는 지그재그(staggered) 배치 효과 유지하면서 정중앙 정렬 유지 */
:deep(.stick_mini > .renchan_circle_mini:nth-child(even)) {
  transform: translateY(-1.5px) !important; /* 세로 중앙 정렬 기준 위로 1.5px 시프트 */
}
:deep(.stick_mini > .renchan_circle_mini:nth-child(odd)) {
  transform: translateY(1.5px) !important; /* 세로 중앙 정렬 기준 아래로 1.5px 시프트 */
}

.riichi, .renchan {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 24px; /* x N 폰트 크기 대폭 증대 */
  color: var(--text-color);
  line-height: 1;
}

.riichi span, .renchan span {
  font-weight: bold;
  white-space: nowrap;
}

.now {
  font-size: 72px; /* 크기 72px로 대폭 키움 */
  font-weight: 900;
  line-height: 1;
  color: var(--text-color);
  white-space: nowrap;
  letter-spacing: -2px;
}

/* 액션 메뉴 팝업 레이아웃 (불투명한 완벽한 직사각형 박스, 가로 배열, 판정 영역 대폭 확대) */
.menu_layout {
  pointer-events: auto;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  width: 420px; /* 훨씬 큰 가로 너비 */
  height: 115px; /* 훨씬 큰 세로 높이 */
  background-color: var(--modal-bg-color); /* 불투명 완벽한 박스 */
  border: 2px solid var(--border-color);
  border-radius: 0px !important; /* 완벽한 직사각형 */
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
  padding: 0;
  box-sizing: border-box;
  overflow: hidden;
}

.btn_action {
  font-family: inherit;
  font-size: 48px; /* 42px -> 48px 초대형 텍스트로 시각성 및 판정 영역 확대 */
  font-weight: 900;
  flex: 1;
  height: 100%; /* 높이를 100% 채워서 위아래로 거대한 터치 영역 형성 */
  border: none;
  background: transparent;
  color: var(--text-color);
  cursor: pointer;
  box-shadow: none;
  white-space: nowrap;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.05s ease, background-color 0.2s, color 0.2s;
}

.btn_action:hover {
  background-color: var(--bg-stripe-light);
}

.btn_action:active {
  transform: scale(0.96);
}

/* 각 버튼별 개별 테마 컬러포인트 */
.btn_action.win {
  color: var(--color-negative); /* 화료: 빨간색 강조 */
}

.btn_action.draw {
  color: var(--text-color);
}

.btn_action.cheat {
  color: var(--color-disabled);
}

.menu_separator {
  width: 2px;
  height: 75px; /* 늘어난 높이에 맞춰 구분선 길이 상향 */
  background-color: var(--border-color);
  opacity: 0.15;
}

/* 극도로 빠른 페이드 아웃/인 애니메이션 (40ms) */
.panel-fade-enter-active,
.panel-fade-leave-active {
  transition: opacity 0.04s ease, transform 0.04s ease;
}
.panel-fade-enter-from,
.panel-fade-leave-to {
  opacity: 0;
  transform: scale(0.97);
}
</style>