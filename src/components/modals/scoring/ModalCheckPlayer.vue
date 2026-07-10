<script setup lang="ts">
import type { Player, ScoringState } from "@/types/types.d"
import { useI18n } from "vue-i18n"

/**i18n 속성 가져오기*/
const { t } = useI18n()

/**props 정의*/
interface Props {
  players: Player[],
  scoringState: ScoringState,
  actionType: 'win' | 'lose' | 'cheat' | 'fao' | 'tenpai' | 'nagashi'
}
const props = defineProps<Props>()

/**emits 정의*/
type Emits = {
  (e: 'set-arrow-button', status: string, idx: number): void,
  (e: 'check-invalid-status', status: string): void,
  (e: 'go-to-nagashi'): void,
  (e: 'go-back-to-tenpai'): void
}
const emit = defineEmits<Emits>()

/**data 정의*/
const arr_arrow = ['▼', '▶', '▲', '◀']
const class_check = ['down_check', 'right_check', 'up_check', 'left_check']
const guideMessages: Record<string, string> = {
  win: 'comments.checkPlayerWin',
  lose: 'comments.checkPlayerLose',
  cheat: 'comments.checkPlayerCheat',
  fao: 'comments.checkPlayerFao',
  tenpai: 'comments.checkPlayerTenpai',
  nagashi: 'comments.checkPlayerNagashi'
}

/**화살표 버튼 색상*/
const arrowButtonStyle = (status: string, idx: number) => {
  if (status==='win') // 화료 화살표 버튼
    return {color: props.players[idx].isWin===true ? 'var(--color-negative)' : 'var(--text-color)'}; // 선택시 빨간색
  else if (status==='lose') // 방총 화살표 버튼
    return {color: props.players[idx].isWin!==true ? (props.players[idx].isLose===true ? 'var(--color-negative)' : 'var(--text-color)') : 'var(--color-disabled)'}; // 선택시 빨간색, 불가능시 회색
  else if (status==='cheat') // 촌보 화살표 버튼
    return {color: props.scoringState.whoCheat===idx ? 'var(--color-negative)' : 'var(--text-color)'}; // 선택시 빨간색
  else if (status==='fao') // 책임지불 화살표 버튼
    return {color: props.scoringState.whoWin!==idx && props.scoringState.whoLose!==idx ? (props.scoringState.whoFao===idx ? 'var(--color-negative)' : 'var(--text-color)') : 'var(--color-disabled)'}; // 선택시 빨간색, 불가능시 회색
  else if (status==='tenpai') // 텐파이 화살표 버튼
    return {color: (props.players[idx].isTenpai===true || props.players[idx].isRiichi===true) ? 'var(--color-negative)' : 'var(--text-color)'}; // 선택 또는 리치시 빨간색
  else if (status==='nagashi') // 유국만관 화살표 버튼
    return {color: props.players[idx].isNagashi===true ? 'var(--color-negative)' : 'var(--text-color)'}; // 선택시 빨간색
}

/**ok 버튼 색상*/
const okButtonStyle = (status: string) => {
  let cntWin=props.players.filter(x => x.isWin===true).length; // 화료 인원 세기
  let cntLose=props.players.filter(x => x.isLose===true).length; // 방총 인원 세기
  if (status==='win') // 화료 ok 버튼
    return {color: (cntWin===0 || cntWin===4) ? 'var(--color-disabled)' : 'var(--text-color)'}; // 화료한 사람이 없거나 4명임 (불가능한 경우)
  else if (status==='lose') // 방총 ok 버튼
    return {color: (cntWin!==1 && cntLose===0) ? 'var(--color-disabled)' : 'var(--text-color)'}; // 2명 이상 화료했는데 쯔모임 (불가능한 경우)
  else if (status==='cheat') // 촌보 ok 버튼
    return {color: props.scoringState.whoCheat===-1 ? 'var(--color-disabled)' : 'var(--text-color)'}; // 촌보한 사람이 없음 (불가능한 경우)
  else if (status==='fao') // 책임지불 ok 버튼
    return {color: props.scoringState.whoFao===-1 ? 'var(--color-disabled)' : 'var(--text-color)'}; // 책임지불할 사람이 없음 (불가능한 경우)
  else if (status==='tenpai') // 텐파이 ok 버튼
    return {color: 'var(--text-color)'} // 언제나 가능
  else if (status==='nagashi') // 유국만관 ok 버튼
    return {color: props.players.filter(x => x.isNagashi===true).length > 0 ? 'var(--text-color)' : 'var(--color-disabled)'};
}
</script>

<template>
<!-- 인원 선택창 -->
<div class="container_check">
  <div class="guide_message">
    {{ t(guideMessages[actionType]) }}
  </div>
  <div v-for="(_, i) in class_check"
    :key="i"
    :class="class_check[i]"
    :style="arrowButtonStyle(actionType, i)"
    @click.stop="emit('set-arrow-button', actionType, i)"
  >
    {{ arr_arrow[i] }}
  </div>
  <div class="ok" :style="okButtonStyle(actionType)" @click.stop="emit('check-invalid-status', actionType)">
    OK
  </div>
  <div v-if="actionType === 'tenpai'" class="nagashi" @click.stop="emit('go-to-nagashi')">
    {{ t('panel.nagashi') }}
  </div>
  <div v-else-if="actionType === 'nagashi'" class="nagashi" @click.stop="emit('go-back-to-tenpai')">
    뒤로
  </div>
</div>
</template>

<style scoped>
/* 인원 선택창 */
.container_check{
  display: grid;
  grid-template-rows: auto repeat(3, 100px);
  grid-template-columns: repeat(3, 100px);
  grid-template-areas: 
    'guide_message guide_message guide_message'
    '. up_check .'
    'left_check ok right_check'
    '. down_check nagashi';
  text-align: center;
  font-size: 70px;
  place-items: center;
}
.guide_message{
  grid-area: guide_message;
  font-size: 20px;
}
.down_check{
  grid-area: down_check;
}
.right_check{
  grid-area: right_check;
}
.up_check{
  grid-area: up_check;
}
.left_check{
  grid-area: left_check;
}
.ok{
  grid-area: ok;
  font-size: 60px;
}
.nagashi{
  grid-area: nagashi;
  font-size: 20px;
  cursor: pointer;
  border: 1px solid var(--border-color);
  border-radius: 5px;
  padding: 8px 12px;
  transition: color 0.3s ease, border-color 0.3s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  height: auto;
  width: auto;
  user-select: none;
}
.nagashi:hover{
  color: var(--color-negative);
  border-color: var(--color-negative);
}
</style>