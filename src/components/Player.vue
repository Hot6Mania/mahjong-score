<script setup lang="ts">
import Graphics from "@/components/Graphics.vue"
import type { Player, Option, ModalInfo } from "@/types/types.d"
import { computed } from "vue"

/**props 정의*/
interface Props {
  player: Player,
  option: Option,
  modalInfo: ModalInfo,
  animateRank: boolean,
}
const props = defineProps<Props>()

type Emits = {
  (e: 'toggle-active-riichi', seat: string): void,
  (e: 'start-show-gap', seat: string): void,
  (e: 'end-show-gap', seat: string): void
}
const emit = defineEmits<Emits>()

/**100 자리 이상 점수*/
const displayScoreHigh = computed(() => {
  return Math.floor(props.player.displayScore/100);
})

/**100 자리 이하 점수*/
const displayScoreLow = computed(() => {
  return Math.abs(props.player.displayScore%100);
})

/**100 자리 이상 점수 차이*/
const gapScoreHigh = computed(() => {
  return Math.floor(props.player.gapScore/100);
})

/**점수 입력/정산 단계 진행 여부*/
const isScoringActive = computed(() => {
  return props.modalInfo.isOpen && [
    'check_player_win',
    'check_player_lose',
    'choose_score',
    'check_player_fao',
    'choose_score_fao',
    'choose_draw_kind',
    'check_player_tenpai',
    'check_player_nagashi',
    'check_player_cheat',
    'show_score'
  ].includes(props.modalInfo.type);
})

/**대형 등수 표시 조건*/
const shouldShowRank = computed(() => {
  if (props.player.rank === -1) return false;
  if (props.player.rank !== 0) return true;
  return props.option.alwaysShowRank || isScoringActive.value;
})

/**등수별 색상 계산*/
const rankColor = computed(() => {
  const r = props.player.rank > 0 ? props.player.rank : props.player.realRank;
  if (r === 1) return '#28A745';
  if (r === 2) return '#17A2B8';
  if (r === 4) return '#DC3545';
  return 'var(--text-color)';
})

/**자풍이 東이라면 붉은색 표시*/
const windStyle = () => {
  return {color: props.player.wind==='東' ? 'var(--color-east)' : 'var(--text-color)'}
}

/**리치가 불가능하면 회색 표시*/
const displayScoreStyle = () => {
  return {color: props.player.displayScore<1000 && props.option.tobi===true ? 'var(--color-disabled)' : 'var(--text-color)'}
}

/**리치봉 스타일 계산 (랜덤 비틀기 및 낙하 물리 효과용 CSS 변수 주입)*/
const riichiStickStyle = computed(() => {
  if (props.player.isRiichi !== true) {
    return { visibility: 'hidden' };
  }
  const angle = (props.player as any).riichiAngle || 0;
  const offsetX = (props.player as any).riichiOffsetX || 0;
  const offsetY = (props.player as any).riichiOffsetY || 0;
  return {
    visibility: 'visible',
    '--riichi-angle': `${angle}deg`,
    '--riichi-offset-x': `${offsetX}px`,
    '--riichi-offset-y': `${offsetY}px`
  };
})

/**점수 부호에 따른 색상*/
const getSignColor = (sign: number, x: boolean) => {
  if (sign>0)
    return {color: 'var(--color-positive)'};
  else if (sign<0)
    return {color: 'var(--color-negative)'};
  else if (x===true)
    return {color: 'var(--text-color)'};
  else
    return {color: 'var(--text-color)'};
}
</script>

<template>
<div class="container_player" :id=player.seat>
  <!-- 리치봉 -->
  <Graphics kind="riichiStick" class="stick" :class="{ 'riichi-active': player.isRiichi }" :style="riichiStickStyle"/>
  <!-- 현재 바람 -->
  <div class="wind" :style="windStyle()"
    @mousedown.stop="emit('start-show-gap', player.seat)"
    @mouseup.stop="emit('end-show-gap', player.seat)"
    @mouseleave.stop="emit('end-show-gap', player.seat)"
    @touchstart.stop.prevent="emit('start-show-gap', player.seat)"
    @touchend.stop="emit('end-show-gap', player.seat)"
    @touchcancel.stop="emit('end-show-gap', player.seat)"
  >
    {{ player.wind }}
    <!-- 대형 등수 표시 (자리 표시의 왼쪽에 정렬) -->
    <div class="large_rank_overlay">
      <Transition :name="animateRank ? 'rank-slide' : ''" mode="out-in">
        <div v-if="shouldShowRank" :key="player.rank > 0 ? player.rank : player.realRank" class="rank_number" :class="{ 'is-first': (player.rank > 0 ? player.rank : player.realRank) === 1 }" :style="{ color: rankColor }">
          {{ player.rank > 0 ? player.rank : player.realRank }}
        </div>
      </Transition>
    </div>
  </div>
  <!-- 현재 점수 -->
  <div class="score">
    <div v-if="isNaN(player.gapScore)" :style="displayScoreStyle()" @click="emit('toggle-active-riichi', player.seat)" style="display: inline-block;">
      {{ displayScoreHigh }}<span style="font-size: 50px; position: relative; display: inline-block;">
        <div class="player_name_badge">
          {{ player.name.length > 8 ? player.name.substring(0, 8) + '...' : player.name }}
        </div>
        <span v-show="displayScoreLow<10">0</span>{{ displayScoreLow }}
      </span>
    </div>
    <div v-else :style="getSignColor(player.gapScore, false)" style="display: inline-block;">
      <span v-show="gapScoreHigh>0">+</span>{{ gapScoreHigh }}<span style="font-size: 50px; position: relative; display: inline-block;">
        <div class="player_name_badge">
          {{ player.name.length > 8 ? player.name.substring(0, 8) + '...' : player.name }}
        </div>
        00
      </span>
    </div>
  </div>
  <!-- 변경되는 점수 -->
  <div v-show="!isNaN(player.effectScore)" class="change" :style="getSignColor(player.effectScore, true)">
    <span v-show="player.effectScore>0">+</span>{{ player.effectScore }}
  </div>
</div>
</template>

<style scoped>
/* 플레이어창 위치 */
#Down{
  bottom: 0;
  right: 50%;
  transform: translate(50%, 0%) translateY(5px);
}
#Right{
  top: 50%;
  right: 0;
  -ms-transform: rotate(270deg);
  -webkit-transform: rotate(270deg);
  transform: rotate(270deg) translate(25%, 50%) translateY(5px);
}
#Up{
  top: 0;
  right: 50%;
  -ms-transform: rotate(180deg);
  -webkit-transform: rotate(180deg);
  transform: rotate(180deg) translate(-50%, 0%) translateY(5px);
}
#Left{
  top: 50%;
  left: 0;
  -ms-transform: rotate(90deg);
  -webkit-transform: rotate(90deg);
  transform: rotate(90deg) translate(-25%, 50%) translateY(5px);
}
/* 플레이어창 */
.container_player{
  display: grid;
  grid-template-rows: repeat(2, auto);
  grid-template-columns: repeat(4, auto);
  grid-template-areas: 
    '. stick stick .'
    'rank wind score change';
  position: fixed;
  text-align: center;
  font-size: 80px;
}
.stick{
  grid-area: stick;
  transform: translate(var(--riichi-offset-x, 0px), var(--riichi-offset-y, 0px)) rotate(var(--riichi-angle, 0deg));
  transform-origin: center center;
  --riichi-bounce-y: -8px;
}
@media (max-height: 600px) {
  .stick {
    /* 세로가 좁은 화면에서는 글자를 가리지 않도록 상하 오프셋을 30% 수준으로 크게 감쇄하고, 위아래 튀어오르는 높이도 감축 */
    --riichi-offset-y: calc(var(--riichi-offset-y, 0px) * 0.3) !important;
    --riichi-bounce-y: -3px !important;
  }
}
.stick.riichi-active {
  animation: riichiThrow 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
}

@keyframes riichiThrow {
  0% {
    transform: translate(var(--riichi-offset-x, 0px), -60px) scale(1.4) rotate(calc(var(--riichi-angle, 0deg) - 15deg));
    opacity: 0;
  }
  40% {
    transform: translate(var(--riichi-offset-x, 0px), var(--riichi-offset-y, 0px)) scale(1.0) rotate(var(--riichi-angle, 0deg));
    opacity: 1;
  }
  65% {
    transform: translate(var(--riichi-offset-x, 0px), calc(var(--riichi-offset-y, 0px) + var(--riichi-bounce-y, -8px))) scale(1.06) rotate(calc(var(--riichi-angle, 0deg) + 2deg));
  }
  85% {
    transform: translate(var(--riichi-offset-x, 0px), var(--riichi-offset-y, 0px)) scale(0.98) rotate(calc(var(--riichi-angle, 0deg) - 1deg));
  }
  100% {
    transform: translate(var(--riichi-offset-x, 0px), var(--riichi-offset-y, 0px)) scale(1.0) rotate(var(--riichi-angle, 0deg));
  }
}
.wind{
  grid-area: wind;
  margin: auto;
  position: relative;
}
.score{
  grid-area: score;
  width: 200px;
  margin: auto;
  white-space: nowrap;
}
.change{
  grid-area: change;
  width: 0px;
  font-size: 30px;
  text-align: left;
  transform: translate(-100px, -10px);
}
.player_name_badge {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  bottom: 100%;
  margin-bottom: 2px;
  font-size: 13px;
  font-weight: bold;
  padding: 1px 4px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background-color: var(--modal-bg-color);
  color: var(--text-color);
  white-space: nowrap;
  box-shadow: 1px 1px 3px rgba(0,0,0,0.15);
  z-index: 2;
  transition: background-color 0.3s, color 0.3s, border-color 0.3s;
  line-height: normal;
}
.large_rank_overlay {
  position: absolute;
  left: -35px; /* 자리 표시의 왼쪽에 띄움 */
  top: 6px;    /* 상단 글씨선에 맞춰 정교하게 위측 정렬 */
  width: 30px;
  height: 50px;
  display: flex;
  justify-content: flex-end;
  align-items: flex-start;
  z-index: 10;
  perspective: 1000px; /* 3D 플립 효과를 위한 공간 제공 */
}
.rank_number {
  font-size: 50px;
  font-weight: 900;
  user-select: none;
  font-family: inherit;
  line-height: 1;
  transform-origin: center center;
}

/* 등수 슬라이드 & 페이드 애니메이션 */
.rank-slide-leave-active {
  /* 더 빠르게 퇴장 (0.25s -> 0.15s) */
  transition: transform 0.15s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.15s ease-in;
}
.rank-slide-leave-to {
  /* 미끄러지는 거리를 -45px로 늘려 퇴장 속도감 증폭 */
  transform: translateX(-45px); 
  opacity: 0;
}

.rank-slide-enter-active {
  /* 가속도 있고 자연스러운 슬라이드 진입 (ease-out cubic-bezier) */
  transition: transform 0.35s cubic-bezier(0.1, 0.9, 0.2, 1), opacity 0.35s ease-out;
}
.rank-slide-enter-from {
  transform: translateX(-30px); /* 왼쪽에서 오른쪽으로 슬라이드 진입 */
  opacity: 0;
}

/* 1등 전용 팝업 줌아웃 애니메이션 (동시에 들어와서 슬라이드하고 줌인/줌아웃) */
.rank-slide-enter-active.is-first {
  animation: firstPlacePop 0.65s forwards;
  transition: none !important;
}

@keyframes firstPlacePop {
  0% {
    transform: translateX(-35px) scale(1.0);
    opacity: 0;
    animation-timing-function: ease-out; /* 정위치까지 부드럽게 진입 */
  }
  40% {
    transform: translateX(0) scale(1.0);
    opacity: 0.9;
    animation-timing-function: cubic-bezier(0.25, 1, 0.5, 1); /* 정위치 도달 후 팝업(확대) */
  }
  70% {
    transform: translateX(0) scale(1.8);
    opacity: 1;
    animation-timing-function: cubic-bezier(0.895, 0.03, 0.685, 0.22); /* 쾅! 강력하게 꽂힘 */
  }
  100% {
    transform: translateX(0) scale(1.0);
    opacity: 1;
  }
}
</style>