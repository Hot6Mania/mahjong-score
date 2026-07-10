<script setup lang="ts">
import Graphics from "@/components/Graphics.vue"
import type { Player, Option } from "@/types/types.d"
import { computed } from "vue"

/**props 정의*/
interface Props {
  player: Player,
  option: Option,
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



/**등수별 색상 계산*/
const rankColor = computed(() => {
  const r = props.player.rank !== 0 ? props.player.rank : props.player.realRank;
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

/**리치봉 표시*/
const riichiStickVisibility = () => {
  return {visibility: props.player.isRiichi===true ? 'visible' : 'hidden'}
}

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
  <Graphics kind="riichiStick" class="stick" :style="riichiStickVisibility()"/>
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
    <div v-show="player.rank !== 0 || option.alwaysShowRank" class="large_rank_overlay" :style="{ color: rankColor }">
      {{ player.rank !== 0 ? player.rank : player.realRank }}
    </div>
  </div>
  <!-- 현재 점수 -->
  <div class="score">
    <div v-if="isNaN(player.gapScore)" :style="displayScoreStyle()" @click="emit('toggle-active-riichi', player.seat)" style="display: inline-block;">
      {{ displayScoreHigh }}<span style="font-size: 50px; position: relative; display: inline-block;">
        <div class="player_name_badge">
          {{ (player as any).shortName || player.name }}
        </div>
        <span v-show="displayScoreLow<10">0</span>{{ displayScoreLow }}
      </span>
    </div>
    <div v-else :style="getSignColor(player.gapScore, false)" style="display: inline-block;">
      <span v-show="gapScoreHigh>0">+</span>{{ gapScoreHigh }}<span style="font-size: 50px; position: relative; display: inline-block;">
        <div class="player_name_badge">
          {{ (player as any).shortName || player.name }}
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
  font-size: 50px;
  font-weight: 900;
  user-select: none;
  font-family: inherit;
  line-height: 1;
  z-index: 10;
}
</style>