<script setup lang="ts">
import { computed } from "vue"
import type { Player } from "@/types/types.d"

interface Props {
  todayMembers: string[]
  players: Player[]
  history: any[]
}
const props = defineProps<Props>()

/**emits 정의*/
type Emits = {
  (e: 'invalidate-game', index: number): void
  (e: 'click-game', index: number): void
}
const emit = defineEmits<Emits>()

// 오늘 게임에 참여한 적이 있거나 멤버 풀에 포함된 모든 플레이어 목록 추출 (컬럼으로 사용됨)
const allPlayers = computed(() => {
  const list: string[] = []
  const seen = new Set<string>()

  // 1. 현재 플레이 중인 플레이어들 추가
  if (props.players && props.players.length > 0) {
    props.players.forEach(p => {
      const defaultNames = ['▼', '▶', '▲', '◀']
      if (p.name && !defaultNames.includes(p.name) && !seen.has(p.name)) {
        list.push(p.name)
        seen.add(p.name)
      }
    })
  }

  // 2. 기록 이력에 존재하는 플레이어들 추가
  if (props.history) {
    props.history.forEach(game => {
      if (game.results) {
        game.results.forEach((r: any) => {
          if (r.name && !seen.has(r.name)) {
            list.push(r.name)
            seen.add(r.name)
          }
        })
      }
    })
  }

  // 3. 오늘 멤버 풀이 존재하면 추가
  if (props.todayMembers && props.todayMembers.length > 0) {
    props.todayMembers.forEach(name => {
      if (name && !seen.has(name)) {
        list.push(name)
        seen.add(name)
      }
    })
  }

  const hasPlayed = (name: string) => {
    if (!props.history) return false
    return props.history.some(game => 
      game.results && game.results.some((r: any) => r.name === name)
    )
  }

  // 게임에 참가한 사람들이 앞으로 오도록 안정적으로 정렬 (Stable Sort)
  return list.map((name, idx) => ({ name, idx }))
    .sort((a, b) => {
      const aPlayed = hasPlayed(a.name) ? 1 : 0
      const bPlayed = hasPlayed(b.name) ? 1 : 0
      if (aPlayed !== bPlayed) {
        return bPlayed - aPlayed
      }
      return a.idx - b.idx
    })
    .map(item => item.name)
})

// 특정 플레이어의 특정 회차 경기 결과 조회
const getPlayerResult = (playerName: string, gameIndex: number) => {
  if (!props.history) return null
  const game = props.history[gameIndex]
  if (!game || !game.results) return null
  return game.results.find((r: any) => r.name === playerName) || null
}

// 특정 플레이어의 오늘 누적 우마 합산 계산
const getPlayerTotalUma = (playerName: string) => {
  let sum = 0
  let played = false
  if (props.history) {
    props.history.forEach(game => {
      const result = game.results.find((r: any) => r.name === playerName)
      if (result) {
        sum += result.uma
        played = true
      }
    });
  }
  return played ? parseFloat(sum.toFixed(1)) : 0
}

// 점수/우마 색상 지정
const getUmaColor = (uma: number) => {
  if (uma > 0) return { color: '#4caf50' } // 초록
  if (uma < 0) return { color: '#f44336' } // 빨강
  return { color: 'var(--text-color)' }
}

// 점수 단위 포맷
const formatScore = (score: number) => {
  return String(score)
}
</script>

<template>
<div class="container_total_uma">
  <h3 class="title">총 우마</h3>

  <!-- 대국 기록 테이블 영역 (한 판도 안 했어도 표는 상시 표시됨!) -->
  <div class="table_wrapper">
    <table class="uma_table">
      <thead>
        <tr>
          <!-- 첫 번째 열은 회차 인덱스 표시 -->
          <th class="sticky_col header_round">대국</th>
          <!-- 플레이어 이름들이 컬럼(Column)으로 배치됨 (풀에 있는 전원!) -->
          <th v-for="name in allPlayers" :key="name" class="header_name">
            {{ name.length > 5 ? name.substring(0, 4) : name }}<span v-if="name.length > 5" style="vertical-align: bottom; line-height: 0.8; display: inline-block; transform: translateY(0.1em);">…</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <!-- 각 행(Row)은 회차(1회전, 2회전...)를 의미함 -->
        <tr v-for="(_, gameIdx) in history" :key="gameIdx" @click="emit('click-game', gameIdx)" class="game_row" style="cursor: pointer;">
          <td class="sticky_col cell_round_header">
            <div class="round_title_wrapper" style="display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%;">
              <span class="round_text">{{ gameIdx + 1 }}회전</span>
              <button class="btn_invalidate" @click.stop="emit('invalidate-game', gameIdx)" title="기록 무효화">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="width: 12px; height: 12px; display: block;">
                  <circle cx="12" cy="12" r="10" fill="#f44336" />
                  <path d="M15.5 8.5L8.5 15.5M8.5 8.5L15.5 15.5" stroke="var(--text-color)" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
          </td>
          <!-- 각 플레이어 컬럼별 결과 셀 -->
          <td v-for="name in allPlayers" :key="name" class="cell_result">
            <div v-if="getPlayerResult(name, gameIdx)" class="uma_cell_block">
              <div class="uma_cell_score">
                {{ formatScore(getPlayerResult(name, gameIdx)!.score) }}
              </div>
              <div class="uma_cell_bottom">
                <span class="uma_cell_uma" :style="getUmaColor(getPlayerResult(name, gameIdx)!.uma)">
                  {{ getPlayerResult(name, gameIdx)!.uma > 0 ? '+' : '' }}{{ getPlayerResult(name, gameIdx)!.uma }}
                </span>
                <span class="uma_cell_rank">
                  {{ getPlayerResult(name, gameIdx)!.rank }}위
                </span>
              </div>
            </div>
            <div v-else class="uma_cell_empty">-</div>
          </td>
        </tr>
        
        <!-- 대국 기록이 없을 때 빈 행 표시 (구조 보존용) -->
        <tr v-if="!history || history.length === 0">
          <td class="sticky_col cell_round_header">
            -
          </td>
          <td v-for="name in allPlayers" :key="name" class="cell_result">
            <div class="uma_cell_empty">-</div>
          </td>
        </tr>
        
        <!-- 가장 마지막 행에 각 플레이어의 오늘 누적 우마 합산 성적 표기 (제일 밑에 성적) -->
        <tr class="row_total">
          <td class="sticky_col cell_total_label">
            성적
          </td>
          <td v-for="name in allPlayers" :key="name" class="cell_total_val" :style="getUmaColor(getPlayerTotalUma(name))">
            {{ getPlayerTotalUma(name) > 0 ? '+' : '' }}{{ getPlayerTotalUma(name) }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
</template>

<style scoped>
.container_total_uma {
  width: 100%;
  max-width: 600px;
  display: flex;
  flex-direction: column;
  color: var(--text-color);
  font-family: inherit;
}

.title {
  font-size: 20px;
  margin-top: 0;
  margin-bottom: 15px;
  text-align: center;
  font-weight: bold;
}

/* 가로 스크롤 테이블 래퍼 */
.table_wrapper {
  width: 100%;
  overflow-x: auto;
  margin-bottom: 5px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background-color: var(--bg-card);
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
  -webkit-overflow-scrolling: touch;
}

.uma_table {
  width: 100%;
  border-collapse: collapse;
  text-align: center;
}

.uma_table th, .uma_table td {
  padding: 8px;
  border-bottom: 1px solid var(--border-color);
  font-size: 13px;
  vertical-align: middle;
}

/* 첫 번째 회차 컬럼 좌측 고정 (Sticky Column) */
.sticky_col {
  position: sticky;
  left: 0;
  background-color: var(--bg-card);
  z-index: 10;
  border-right: 2px solid var(--border-color);
  text-align: center;
  min-width: 80px;
  font-weight: bold;
}

tr:hover .sticky_col {
  background-color: var(--hover-color, rgba(255, 255, 255, 0.05)) !important;
}

.header_round {
  background-color: var(--bg-card);
  border-bottom: 2px solid var(--border-color);
}

.header_name {
  min-width: 76px;
  font-weight: bold;
  font-size: 13px;
  border-bottom: 2px solid var(--border-color);
}

.cell_round_header {
  font-size: 11px;
}

.round_title_wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
}

.round_text {
  font-weight: bold;
}

/* 무효 처리 버튼 스타일 (둥글고 작은 X) */
.btn_invalidate {
  width: 12px;
  height: 12px;
  background-color: transparent;
  border: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding: 0;
  transition: opacity 0.2s;
}

.btn_invalidate:hover {
  opacity: 0.8;
}

.cell_result {
  padding: 3px !important;
}

/* 회전별 셀 결과 블록 */
.uma_cell_block {
  display: inline-flex;
  flex-direction: column;
  width: 68px;
  border: 1px solid var(--border-color);
  border-radius: 5px;
  background-color: var(--bg-modal);
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.uma_cell_score {
  font-weight: bold;
  padding: 2px 0;
  font-size: 10px;
  border-bottom: 1px dashed var(--border-color);
  background-color: rgba(255, 255, 255, 0.03);
}

.uma_cell_bottom {
  display: flex;
  font-size: 9.5px;
  padding: 2px 0;
}

.uma_cell_uma {
  flex: 1;
  text-align: center;
  font-weight: bold;
  border-right: 1px dashed var(--border-color);
}

.uma_cell_rank {
  flex: 1;
  text-align: center;
  color: var(--text-color);
  opacity: 0.8;
}

.uma_cell_empty {
  color: var(--text-color);
  opacity: 0.3;
  font-size: 14px;
}

/* 합계 행 (제일 밑에 성적) */
.row_total {
  background-color: rgba(255, 255, 255, 0.02);
  font-weight: bold;
}

.cell_total_label {
  background-color: var(--bg-card);
  border-top: 2px solid var(--border-color);
  border-bottom: none !important;
  font-size: 13px;
}

.cell_total_val {
  border-top: 2px solid var(--border-color);
  border-bottom: none !important;
  font-size: 13px;
  font-weight: bold;
}

.game_row:hover {
  background-color: rgba(255, 255, 255, 0.05);
}
.game_row:hover .sticky_col {
  background-color: rgba(255, 255, 255, 0.05);
}
</style>
