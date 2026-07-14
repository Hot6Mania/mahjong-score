<script setup lang="ts">
import { reactive, watch, computed } from "vue"

interface Props {
  todayMembers: string[]
  option: any
  history: any[]
}
const props = defineProps<Props>()

type Emits = {
  (e: 'add-manual-game', results: any[]): void
  (e: 'show-modal', type: string, status?: string): void
}
const emit = defineEmits<Emits>()

const winds = ["東", "南", "西", "北"]

const seatPlayers = reactive([
  { name: "", score: 25000, uma: 0.0, rank: 1 },
  { name: "", score: 25000, uma: 0.0, rank: 2 },
  { name: "", score: 25000, uma: 0.0, rank: 3 },
  { name: "", score: 25000, uma: 0.0, rank: 4 }
])



// Dynamic Auto Calculation
const autoCalculate = () => {
  const scores = seatPlayers.map(p => p.score || 0)
  
  // Calculate Rank
  const ranks = [0, 1, 2, 3].map(idx => {
    const myScore = scores[idx]
    const rank = [0, 1, 2, 3].filter(j => {
      if (scores[j] > myScore) return true
      if (props.option.sekiOrder && scores[j] === myScore && j < idx) return true
      return false
    }).length + 1
    return rank
  })

  // Calculate Uma
  const oka = (props.option.returnScore * 4 - props.option.startingScore * 4) / 1000
  const umas = [0, 1, 2, 3].map(idx => {
    const myScore = scores[idx]
    const rank = ranks[idx]
    const cnt = props.option.sekiOrder ? 1 : [0, 1, 2, 3].filter(j => scores[j] === myScore).length
    
    let umaSum = 0
    for (let i = 0; i < cnt; i++) {
      umaSum += Number(props.option.rankUma[rank + i - 1] || 0)
    }
    if (rank === 1) {
      umaSum += oka
    }
    
    const umaVal = umaSum / cnt
    const point = (myScore - props.option.returnScore) / 1000 + umaVal
    return parseFloat(point.toFixed(1))
  })

  // Apply to reactive state
  seatPlayers.forEach((p, idx) => {
    p.rank = ranks[idx]
    p.uma = umas[idx]
  })
}

// Watch scores to auto-update (with manual overrides possible)
watch(() => seatPlayers.map(p => p.score), () => {
  autoCalculate()
}, { deep: true })

const scoreSum = computed(() => {
  return seatPlayers.reduce((acc, p) => acc + (p.score || 0), 0)
})

const expectedSum = computed(() => {
  return props.option.startingScore * 4
})

const submit = () => {
  // Validate
  if (seatPlayers.some(p => !p.name.trim())) {
    alert("모든 플레이어의 닉네임을 입력해주세요.")
    return
  }

  // Duplicate names check
  const names = seatPlayers.map(p => p.name.trim())
  if (new Set(names).size !== 4) {
    alert("동일한 닉네임이 여러 번 입력되었습니다. 중복 입력을 피해주세요.")
    return
  }

  const results = seatPlayers.map((p) => ({
    name: p.name.trim(),
    score: Number(p.score),
    uma: Number(p.uma),
    rank: Number(p.rank)
  }))

  emit('add-manual-game', results)
  emit('show-modal', 'total_uma')
}
</script>

<template>
<div class="container_manual_input">
  <h3 class="title">오류 대국 결과 입력 (수동)</h3>
  
  <p class="description">
    누락되거나 오류로 기록되지 못한 대국의 최종 점수/우마/등수를 <strong>기장(동/남/서/북 스타트)</strong> 기준으로 닉네임과 함께 입력합니다.<br>
    <span class="warning-text">* 이 기록은 전체 통계(화료율, 방총률 등)에는 반영되지 않으며, 누적 점수(우마) 및 게임 결과 이력에만 기록됩니다.</span>
  </p>



  <div class="form_grid">
    <div class="grid_header">
      <div class="cell">기장 (스타트)</div>
      <div class="cell">닉네임</div>
      <div class="cell">최종 점수</div>
      <div class="cell">순위 (등수)</div>
      <div class="cell">우마 (포인트)</div>
    </div>

    <div v-for="(p, idx) in seatPlayers" :key="idx" class="grid_row">
      <div class="cell seat_cell">
        <span class="wind_badge" :class="'wind_' + winds[idx]">{{ winds[idx] }}</span>
        <span class="seat_name">{{ idx === 0 ? '동가' : idx === 1 ? '남가' : idx === 2 ? '서가' : '북가' }}</span>
      </div>
      <div class="cell">
        <input 
          type="text" 
          v-model="p.name" 
          placeholder="닉네임 입력" 
          class="input_name"
          autocomplete="off"
        />
      </div>
      <div class="cell">
        <input 
          type="number" 
          v-model.number="p.score" 
          placeholder="25000" 
          class="input_score"
        />
      </div>
      <div class="cell">
        <input 
          type="number" 
          min="1" 
          max="4" 
          v-model.number="p.rank" 
          placeholder="등수" 
          class="input_rank"
        />
      </div>
      <div class="cell">
        <input 
          type="number" 
          step="0.1" 
          v-model.number="p.uma" 
          placeholder="우마" 
          class="input_uma"
        />
      </div>
    </div>
  </div>

  <div class="info_summary" :class="{ 'warning_border': scoreSum !== expectedSum }">
    <span>점수 합계: <strong>{{ scoreSum.toLocaleString() }}</strong> 점</span>
    <span v-if="scoreSum !== expectedSum" class="score_warning">
      (기본 총합 {{ expectedSum.toLocaleString() }}점과 다름)
    </span>
  </div>

  <div class="button_group">
    <button class="btn_cancel" @click="emit('show-modal', 'total_uma')">취소</button>
    <button class="btn_calc" @click="autoCalculate">우마 자동 계산</button>
    <button class="btn_submit" @click="submit">기록하기</button>
  </div>
</div>
</template>

<style scoped>
.container_manual_input {
  width: 100%;
  max-width: 600px;
  display: flex;
  flex-direction: column;
  color: var(--text-color);
  font-family: inherit;
  box-sizing: border-box;
}

.title {
  font-size: 18px;
  margin-top: 0;
  margin-bottom: 10px;
  text-align: center;
  font-weight: bold;
}

.description {
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--text-dimmed);
  margin-bottom: 15px;
  background: rgba(255, 255, 255, 0.02);
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
}

.warning-text {
  color: var(--color-negative);
  font-weight: bold;
  margin-top: 4px;
  display: inline-block;
}

.form_grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 15px;
}

.grid_header, .grid_row {
  display: grid;
  grid-template-columns: 1.2fr 1.8fr 1.3fr 1fr 1fr;
  gap: 8px;
  align-items: center;
}

.grid_header {
  font-weight: bold;
  font-size: 12px;
  border-bottom: 2px solid var(--border-color);
  padding-bottom: 6px;
  text-align: center;
}

.cell {
  display: flex;
  align-items: center;
  justify-content: center;
}

.seat_cell {
  justify-content: flex-start;
  gap: 6px;
}

.wind_badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  font-size: 11px;
  font-weight: bold;
  color: #fff;
}

.wind_東 { background-color: var(--color-east); }
.wind_南 { background-color: #2196f3; }
.wind_西 { background-color: #ff9800; }
.wind_北 { background-color: #9c27b0; }

.seat_name {
  font-size: 12px;
  font-weight: bold;
}

input {
  width: 100%;
  padding: 6px 8px;
  box-sizing: border-box;
  border: 1px solid var(--input-border-color);
  background-color: var(--input-bg-color);
  color: var(--text-color);
  border-radius: 4px;
  font-size: 12px;
  text-align: center;
}

input.input_name {
  text-align: left;
}

.info_summary {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 10px;
  padding: 8px;
  background-color: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 12px;
  margin-bottom: 20px;
}

.warning_border {
  border-color: var(--color-negative);
  background-color: rgba(239, 68, 68, 0.05);
}

.score_warning {
  color: var(--color-negative);
  font-weight: bold;
}

.button_group {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

button {
  padding: 8px 16px;
  font-size: 13px;
  font-weight: bold;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  transition: opacity 0.2s, transform 0.1s;
}

button:active {
  transform: scale(0.98);
}

.btn_cancel {
  background-color: var(--color-disabled);
  color: #fff;
}

.btn_calc {
  background-color: transparent;
  color: var(--text-color);
  border: 1px solid var(--border-color);
}

.btn_submit {
  background-color: var(--color-toggle-on);
  color: #fff;
}
</style>
