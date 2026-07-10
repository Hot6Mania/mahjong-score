<script setup lang="ts">
import type { Player, Records } from "@/types/types.d"

/**props 정의*/
interface Props {
  players: Player[],
  records: Records
}
defineProps<Props>()

/**emits 정의*/
type Emits = {
  (e: 'show-modal', type: string, status?: string): void
}
const emit = defineEmits<Emits>()

/**data 정의*/
const class_name = ['down_name', 'right_name', 'up_name', 'left_name']
const class_record = ['down_record', 'right_record', 'up_record', 'left_record']

/**점수 부호에 따른 색상*/
const getSignColor = (sign: number, x: number) => {
  if (sign>0)
    return {color: 'var(--color-positive)'};
  else if (sign<0)
    return {color: 'var(--color-negative)'};
  else if (x%4<2)
    return {color: 'var(--text-color)'};
  else
    return {color: 'var(--text-color)'};
}
</script>

<template>
<!-- 점수 기록창 -->
<div class="container_record">
  <div class="header_time">
    <!-- 복사 기능 제거 -->
  </div>
  <div v-for="(_, i) in class_name"
    :key="i"
    :class="class_name[i]"
  >
    {{ players[i].name.length > 5 ? players[i].name.substring(0, 4) : players[i].name }}<span v-if="players[i].name.length > 5" style="vertical-align: bottom; line-height: 0.8; display: inline-block; transform: translateY(0.1em);">…</span>
  </div>
  <div class="container_record_scroll">
    <div class="when">
      <div v-for="(_, i) in records.time"
        :key="i"
        :class="(i%4<2) ? 'row-light' : 'row-dark'"
        @click.stop="i%2===1 ? emit('show-modal', 'rollback_record', String(i)) : {}"
      >
        {{ records.time[i] }}
      </div>
    </div>
    <div v-for="(_, i) in class_record"
      :key="i"
      :class="class_record[i]"
    >
      <div v-for="(_, j) in records.score[i]"
        :key="j"
        :style="j%2===1 ? getSignColor(records.score[i][j], j) : {}"
        :class="(j%4<2) ? 'row-light' : 'row-dark'"
      >
        <template v-if="j%2===1">
          <span v-show="records.score[i][j]>0">+</span>{{ records.score[i][j] }}
        </template>
        <template v-else>
          {{ records.score[i][j] }}
        </template>
      </div>
    </div>
  </div>
</div>
</template>

<style scoped>
/* 점수 기록창 */
.container_record{
  display: grid;
  grid-template-rows: 35px 200px; /* 원래대로 200px 롤백 */
  grid-template-columns: 120px repeat(4, minmax(100px, max-content)); /* 원래대로 100px 롤백 */
  grid-template-areas: 
  'header_time down_name right_name up_name left_name'
  'scroll scroll scroll scroll scroll';
  text-align: center;
  font-size: 25px; /* 원래 폰트 크기 롤백 */
  margin: 5px;
}
.container_record div {
  white-space: nowrap;
}
.header_time{
  grid-area: header_time;
}
.container_record_scroll{
  grid-area: scroll;
  display: grid;
  grid-template-rows: auto;
  grid-template-columns: 120px repeat(4, minmax(100px, max-content)); /* 원래대로 롤백 */
  grid-template-areas: 
  'when down_record right_record up_record left_record';
  text-align: center;
  font-size: 20px; /* 원래 폰트 크기 롤백 */
  overflow-y: auto;
}
.when{
  grid-area: when;
}

/* 데이터 및 헤더 셀 자체의 정렬만 flex로 보정 (scroll 부모 컨테이너 침범 방지) */
.header_time,
.down_name,
.right_name,
.up_name,
.left_name {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 35px;
  box-sizing: border-box;
  font-size: 15px; /* 닉네임 글꼴 크기 대폭 축소하여 겹침 방지 */
  font-weight: bold;
  border-bottom: 2px solid var(--border-color); /* 헤더 경계선 */
}

.when > div,
.down_record > div,
.right_record > div,
.up_record > div,
.left_record > div {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 38px; /* 각 데이터 행의 일정한 세로 두께 */
  box-sizing: border-box;
  font-size: 15px; /* 데이터 값 글자 크기 축소 */
}

/* 행(Row) 기준 회색조 번갈아 표기 스타일 */
.row-light {
  background-color: var(--bg-stripe-light) !important;
}
.row-dark {
  background-color: var(--bg-stripe-dark) !important;
}

.when > div {
  cursor: pointer;
  transition: opacity 0.15s;
}
.when > div:hover {
  opacity: 0.8;
}
</style>