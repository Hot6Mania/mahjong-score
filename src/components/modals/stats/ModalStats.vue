<script setup lang="ts">
import { ref, computed, watch } from "vue"
import type { Player, Option } from "@/types/types.d"

interface Props {
  todayMembers: string[]
  players: Player[]
  history: any[]
  option: Option
}
const props = defineProps<Props>()

// 탭 종류
type TabType = 'basic' | 'riichi' | 'other'
const activeTab = ref<TabType>('basic')

// 오늘 참가한 모든 플레이어 목록 추출
const allPlayers = computed(() => {
  const set = new Set<string>()
  if (props.todayMembers && props.todayMembers.length > 0) {
    props.todayMembers.forEach(name => set.add(name))
  }
  if (props.players && props.players.length > 0) {
    props.players.forEach(p => {
      const defaultNames = ['▼', '▶', '▲', '◀']
      if (p.name && !defaultNames.includes(p.name)) set.add(p.name)
    })
  }
  if (props.history) {
    props.history.forEach(game => {
      if (game.results) {
        game.results.forEach((r: any) => {
          if (r.name) set.add(r.name)
        })
      }
    })
  }
  return Array.from(set)
})

// 선택된 플레이어
const selectedPlayer = ref<string>('')

// 리액티브하게 초기 플레이어 및 선택값 갱신
watch(allPlayers, (newVal) => {
  if (newVal.length > 0 && (!selectedPlayer.value || !newVal.includes(selectedPlayer.value))) {
    selectedPlayer.value = newVal[0]
  }
}, { immediate: true })

// 스탯 계산기
const stats = computed(() => {
  const name = selectedPlayer.value
  if (!name) return null

  // 집계 변수들
  let totalGames = 0
  let totalRounds = 0
  let winCount = 0
  let loseCount = 0
  let tsumoWinCount = 0
  let drawCount = 0
  let drawTenpaiCount = 0
  let totalWinScore = 0
  let totalLoseScore = 0
  let totalRanks = 0
  let tobiCount = 0
  let totalFinalScore = 0
  let totalUma = 0

  let riichiCount = 0
  let riichiWinCount = 0
  let riichiLoseCount = 0
  let riichiDeltaSum = 0
  let riichiWinScoreSum = 0
  let riichiLoseScoreSum = 0
  let firstRiichiCount = 0
  let chaseRiichiCount = 0
  let chasedRiichiCount = 0
  let riichiDrawCount = 0

  let tsumoSufferedCount = 0
  let manganOyaKaburiCount = 0
  let manganOyaKaburiScoreSum = 0
  let loseWithRiichiCount = 0

  if (props.history) {
    props.history.forEach(game => {
      if (!game.results) return

      // 이 대국에서의 플레이어 인덱스 찾기
      const pIdx = game.results.findIndex((r: any) => r.name === name)
      if (pIdx === -1) return // 해당 게임 미참가

      totalGames++

      // 최종 등수 및 최종 점수
      const resultEntry = game.results[pIdx]
      totalRanks += resultEntry.rank
      totalFinalScore += resultEntry.score
      totalUma += resultEntry.uma || 0
      if (resultEntry.score < 0) {
        tobiCount++
      }

      // 세부 라운드 기록(records)이 누락된 구버전 기록이면 세부 통계 계산만 건너뜀
      if (!game.records) return

      // 각 국(Round)별 집계
      const rec = game.records
      const roundsLen = rec.riichi ? rec.riichi.length : 0

      // 국 인덱스는 1부터 시작 (0은 시작 상태)
      for (let r = 1; r < roundsLen; r++) {
        totalRounds++

        const isWin = (rec.win && rec.win[r]) ? rec.win[r][pIdx] : false
        const isLose = (rec.lose && rec.lose[r]) ? rec.lose[r][pIdx] : false
        const status = (rec.status && rec.status[r]) ? rec.status[r] : 'draw'
        const isDraw = (status === 'normal_draw' || status === 'special_draw')
        const isTenpai = (rec.tenpai && rec.tenpai[r]) ? rec.tenpai[r][pIdx] : false
        
        // 델타 점수 (각 국 점수 변화량은 score[pIdx][2*r - 1] 에 들어있음)
        const delta = (rec.score && rec.score[pIdx] && rec.score[pIdx][2 * r - 1] !== undefined) ? rec.score[pIdx][2 * r - 1] : 0

        // 화료 및 방총
        if (isWin) {
          winCount++
          totalWinScore += delta
          if (status === 'tsumo') {
            tsumoWinCount++
          }
        }
        if (isLose) {
          loseCount++
          totalLoseScore += delta // 음수 값
        }

        // 유국
        if (isDraw) {
          drawCount++
          if (isTenpai) {
            drawTenpaiCount++
          }
        }

        // 리치 관련
        const riichiList = (rec.riichiOrder && rec.riichiOrder[r]) ? rec.riichiOrder[r] : []
        const hasRiichi = riichiList.includes(pIdx)

        if (hasRiichi) {
          riichiCount++
          riichiDeltaSum += delta

          if (isWin) {
            riichiWinCount++
            riichiWinScoreSum += delta
          }
          if (isLose) {
            riichiLoseCount++
            riichiLoseScoreSum += delta // 음수
          }
          if (isDraw) {
            riichiDrawCount++
          }

          // 선제, 추격, 피추격
          const orderIdx = riichiList.indexOf(pIdx)
          if (orderIdx === 0) {
            firstRiichiCount++
            if (riichiList.length > 1) {
              chasedRiichiCount++
            }
          } else if (orderIdx > 0) {
            chaseRiichiCount++
          }
        }

        // 오야카부리 & 쯔모당함
        const dealerIdx = (rec.dealer && rec.dealer[r] !== undefined) ? rec.dealer[r] : 0
        const isEast = (dealerIdx === pIdx)

        if (status === 'tsumo' && !isWin) {
          tsumoSufferedCount++
          if (isEast && delta <= -4000) {
            manganOyaKaburiCount++
            manganOyaKaburiScoreSum += Math.abs(delta)
          }
        }

        // 방총 시 리치 여부
        if (isLose && hasRiichi) {
          loseWithRiichiCount++
        }
      }
    })
  }

  // 기본 스탯 연산
  const formatRate = (num: number, den: number) => {
    return den > 0 ? ((num / den) * 100).toFixed(1) + '%' : '-'
  }

  const formatVal = (num: number, den: number, showSign = false) => {
    if (den === 0) return '-'
    const avg = num / den
    const rounded = Math.round(avg)
    if (showSign && rounded > 0) return '+' + rounded
    return String(rounded)
  }

  const winRate = formatRate(winCount, totalRounds)
  const loseRate = formatRate(loseCount, totalRounds)
  const tsumoRate = formatRate(tsumoWinCount, winCount)
  const drawRate = formatRate(drawCount, totalRounds)
  const drawTenpaiRate = formatRate(drawTenpaiCount, drawCount)
  
  const avgWinScore = formatVal(totalWinScore, winCount)
  const avgLoseScore = formatVal(Math.abs(totalLoseScore), loseCount)
  const avgRank = totalGames > 0 ? (totalRanks / totalGames).toFixed(2) + '위' : '-'
  const tobiRate = formatRate(tobiCount, totalGames)

  const expectedScoreVal = totalGames > 0 ? totalUma / totalGames : 0
  const expectedScore = totalGames > 0
    ? (expectedScoreVal > 0 ? '+' : '') + expectedScoreVal.toFixed(1)
    : '-'

  // 리치 스탯 연산
  const riichiWinRate = formatRate(riichiWinCount, riichiCount)
  const riichiLoseRate = formatRate(riichiLoseCount, riichiCount)
  const riichiRate = formatRate(riichiCount, totalRounds)
  const riichiSuji = formatVal(riichiDeltaSum, riichiCount, true)
  const riichiIncome = formatVal(riichiWinScoreSum, riichiWinCount)
  const riichiExpense = formatVal(Math.abs(riichiLoseScoreSum), riichiLoseCount)
  const firstRiichiRate = formatRate(firstRiichiCount, riichiCount)
  const chaseRiichiRate = formatRate(chaseRiichiCount, riichiCount)
  const chasedRiichiRate = formatRate(chasedRiichiCount, riichiCount)
  const riichiDrawRate = formatRate(riichiDrawCount, riichiCount)

  // 그 외 스탯 연산
  const oyaKaburiRate = formatRate(manganOyaKaburiCount, tsumoSufferedCount)
  const oyaKaburiAvg = formatVal(manganOyaKaburiScoreSum, manganOyaKaburiCount)
  const loseRiichiRate = formatRate(loseWithRiichiCount, loseCount)

  // 화료 효율, 방총 손실, 알짜 화료 효율
  const winRateNum = totalRounds > 0 ? winCount / totalRounds : 0
  const avgWinNum = winCount > 0 ? totalWinScore / winCount : 0
  const loseRateNum = totalRounds > 0 ? loseCount / totalRounds : 0
  const avgLoseNum = loseCount > 0 ? Math.abs(totalLoseScore) / loseCount : 0

  const winEfficiency = Math.round(winRateNum * avgWinNum)
  const loseLoss = Math.round(loseRateNum * avgLoseNum)
  const netWinEfficiency = winEfficiency - loseLoss

  // 국수지
  const avgFinalScoreNum = totalGames > 0 ? totalFinalScore / totalGames : 0
  const roundSuji = totalRounds > 0 
    ? Math.round((avgFinalScoreNum - props.option.startingScore) * totalGames / totalRounds) 
    : 0

  return {
    totalGames,
    totalRounds,
    winRate,
    loseRate,
    tsumoRate,
    drawRate,
    drawTenpaiRate,
    avgWinScore,
    avgLoseScore,
    avgRank,
    tobiRate,
    expectedScore,

    riichiWinRate,
    riichiLoseRate,
    riichiRate,
    riichiSuji,
    riichiIncome,
    riichiExpense,
    firstRiichiRate,
    chaseRiichiRate,
    chasedRiichiRate,
    riichiDrawRate,

    oyaKaburiRate,
    oyaKaburiAvg,
    loseRiichiRate,
    winEfficiency,
    loseLoss,
    netWinEfficiency,
    roundSuji
  }
})
</script>

<template>
<div class="container_stats_modal">
  <h3 class="title">오늘의 스탯</h3>

  <!-- 플레이어 선택기 -->
  <div class="player_selector_container">
    <label for="playerSelect" class="selector_label">대상 플레이어:</label>
    <select id="playerSelect" v-model="selectedPlayer" class="player_select">
      <option v-for="name in allPlayers" :key="name" :value="name">
        {{ name }}
      </option>
      <option v-if="allPlayers.length === 0" value="">
        선택할 플레이어가 없습니다
      </option>
    </select>
  </div>

  <!-- 탭 메뉴 -->
  <div class="tab_menu">
    <button 
      class="tab_btn" 
      :class="{ active: activeTab === 'basic' }" 
      @click="activeTab = 'basic'"
    >
      기본
    </button>
    <button 
      class="tab_btn" 
      :class="{ active: activeTab === 'riichi' }" 
      @click="activeTab = 'riichi'"
    >
      리치 스탯
    </button>
    <button 
      class="tab_btn" 
      :class="{ active: activeTab === 'other' }" 
      @click="activeTab = 'other'"
    >
      그 외
    </button>
  </div>

  <!-- 스탯 데이터 테이블 -->
  <div class="stats_content">
    <div v-if="!selectedPlayer" class="no_data">
      스탯을 계산할 플레이어가 지정되지 않았습니다.
    </div>
    <div v-else-if="stats && stats.totalGames === 0" class="no_data">
      오늘 '{{ selectedPlayer }}'님이 플레이한 대국 기록이 없습니다.
    </div>
    <div v-else-if="stats" class="stats_list">
      <!-- 기본 탭 -->
      <div v-if="activeTab === 'basic'" class="stats_group">
        <div class="stat_row">
          <span class="stat_label">기록 대국 수</span>
          <span class="stat_value">{{ stats.totalGames }}전</span>
        </div>
        <div class="stat_row">
          <span class="stat_label">총합 국 수</span>
          <span class="stat_value">{{ stats.totalRounds }}국</span>
        </div>
        <div class="stat_divider"></div>
        <div class="stat_row">
          <span class="stat_label">화료율</span>
          <span class="stat_value">{{ stats.winRate }}</span>
        </div>
        <div class="stat_row">
          <span class="stat_label">방총률</span>
          <span class="stat_value text_negative">{{ stats.loseRate }}</span>
        </div>
        <div class="stat_row">
          <span class="stat_label">쯔모율</span>
          <span class="stat_value">{{ stats.tsumoRate }}</span>
        </div>
        <div class="stat_row">
          <span class="stat_label">유국률</span>
          <span class="stat_value">{{ stats.drawRate }}</span>
        </div>
        <div class="stat_row">
          <span class="stat_label">유국 텐파이율</span>
          <span class="stat_value">{{ stats.drawTenpaiRate }}</span>
        </div>
        <div class="stat_row">
          <span class="stat_label">평균 화료 점수</span>
          <span class="stat_value text_positive">{{ stats.avgWinScore }}점</span>
        </div>
        <div class="stat_row">
          <span class="stat_label">평균 방총 점수</span>
          <span class="stat_value text_negative">{{ stats.avgLoseScore }}점</span>
        </div>
        <div class="stat_row">
          <span class="stat_label">평균 순위</span>
          <span class="stat_value highlight">{{ stats.avgRank }}</span>
        </div>
        <div class="stat_row">
          <span class="stat_label">토비율</span>
          <span class="stat_value text_negative">{{ stats.tobiRate }}</span>
        </div>
        <div class="stat_row">
          <span class="stat_label">기대 점수</span>
          <span class="stat_value">{{ stats.expectedScore }}점</span>
        </div>
      </div>

      <!-- 리치 스탯 탭 -->
      <div v-if="activeTab === 'riichi'" class="stats_group">
        <div class="stat_row">
          <span class="stat_label">리치율</span>
          <span class="stat_value">{{ stats.riichiRate }}</span>
        </div>
        <div class="stat_row">
          <span class="stat_label">리치 화료율</span>
          <span class="stat_value text_positive">{{ stats.riichiWinRate }}</span>
        </div>
        <div class="stat_row">
          <span class="stat_label">리치 방총률</span>
          <span class="stat_value text_negative">{{ stats.riichiLoseRate }}</span>
        </div>
        <div class="stat_row">
          <span class="stat_label">리치 유국률</span>
          <span class="stat_value">{{ stats.riichiDrawRate }}</span>
        </div>
        <div class="stat_divider"></div>
        <div class="stat_row">
          <span class="stat_label">리치 수지</span>
          <span class="stat_value" :class="{ text_positive: parseInt(stats.riichiSuji) > 0, text_negative: parseInt(stats.riichiSuji) < 0 }">
            {{ stats.riichiSuji !== '-' ? stats.riichiSuji + '점' : '-' }}
          </span>
        </div>
        <div class="stat_row">
          <span class="stat_label">리치 수입 평균</span>
          <span class="stat_value text_positive">{{ stats.riichiIncome !== '-' ? stats.riichiIncome + '점' : '-' }}</span>
        </div>
        <div class="stat_row">
          <span class="stat_label">리치 지출 평균</span>
          <span class="stat_value text_negative">{{ stats.riichiExpense !== '-' ? stats.riichiExpense + '점' : '-' }}</span>
        </div>
        <div class="stat_divider"></div>
        <div class="stat_row">
          <span class="stat_label">선제율</span>
          <span class="stat_value">{{ stats.firstRiichiRate }}</span>
        </div>
        <div class="stat_row">
          <span class="stat_label">추격률</span>
          <span class="stat_value">{{ stats.chaseRiichiRate }}</span>
        </div>
        <div class="stat_row">
          <span class="stat_label">피추격률</span>
          <span class="stat_value text_negative">{{ stats.chasedRiichiRate }}</span>
        </div>
      </div>

      <!-- 그 외 탭 -->
      <div v-if="activeTab === 'other'" class="stats_group">
        <div class="stat_row">
          <span class="stat_label">아픈 오야카부리율</span>
          <span class="stat_value text_negative">{{ stats.oyaKaburiRate }}</span>
        </div>
        <div class="stat_row">
          <span class="stat_label">아픈 오야카부리 평균</span>
          <span class="stat_value text_negative">{{ stats.oyaKaburiAvg !== '-' ? stats.oyaKaburiAvg + '점' : '-' }}</span>
        </div>
        <div class="stat_row">
          <span class="stat_label">방총 시 리치율</span>
          <span class="stat_value">{{ stats.loseRiichiRate }}</span>
        </div>
        <div class="stat_divider"></div>
        <div class="stat_row">
          <span class="stat_label">화료 효율 (화료율 * 평균화료)</span>
          <span class="stat_value text_positive">+{{ stats.winEfficiency }}</span>
        </div>
        <div class="stat_row">
          <span class="stat_label">방총 손실 (방총률 * 평균방총)</span>
          <span class="stat_value text_negative">-{{ stats.loseLoss }}</span>
        </div>
        <div class="stat_row">
          <span class="stat_label">알짜 화료 효율</span>
          <span class="stat_value" :class="{ text_positive: stats.netWinEfficiency > 0, text_negative: stats.netWinEfficiency < 0 }">
            {{ stats.netWinEfficiency > 0 ? '+' : '' }}{{ stats.netWinEfficiency }}
          </span>
        </div>
        <div class="stat_row">
          <span class="stat_label">국수지</span>
          <span class="stat_value" :class="{ text_positive: stats.roundSuji > 0, text_negative: stats.roundSuji < 0 }">
            {{ stats.roundSuji > 0 ? '+' : '' }}{{ stats.roundSuji }}
          </span>
        </div>
        <div class="stat_row">
          <span class="stat_label">총합 국 수</span>
          <span class="stat_value">{{ stats.totalRounds }}국</span>
        </div>
      </div>
    </div>
  </div>
</div>
</template>

<style scoped>
.container_stats_modal {
  width: 100%;
  max-width: 320px;
  display: flex;
  flex-direction: column;
  color: var(--text-color);
  font-family: inherit;
  box-sizing: border-box;
}

.title {
  font-size: 20px;
  margin-top: 0;
  margin-bottom: 12px;
  text-align: center;
  font-weight: bold;
}

/* 플레이어 선택기 */
.player_selector_container {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  margin-bottom: 12px;
  background-color: var(--bg-card);
  padding: 8px 10px;
  border-radius: 6px;
  box-sizing: border-box;
}

.selector_label {
  font-size: 13px;
  font-weight: bold;
  opacity: 0.8;
}

.player_select {
  flex: 1;
  max-width: 170px;
  font-size: 13px;
  padding: 4px 8px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background-color: var(--bg-modal);
  color: var(--text-color);
  font-weight: bold;
  cursor: pointer;
}

/* 탭 메뉴 */
.tab_menu {
  display: flex;
  width: 100%;
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 10px;
}

.tab_btn {
  flex: 1;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 8px 0;
  font-size: 14px;
  font-weight: bold;
  color: var(--text-color);
  opacity: 0.6;
  cursor: pointer;
  transition: border-color 0.2s, opacity 0.2s;
  text-align: center;
}

.tab_btn:hover {
  opacity: 0.8;
}

.tab_btn.active {
  opacity: 1;
  border-bottom-color: var(--color-toggle-on);
  color: var(--color-toggle-on);
}

/* 스탯 목록 */
.stats_content {
  width: 100%;
  max-height: 52vh;
  overflow-y: auto;
  padding-right: 4px;
}

.no_data {
  text-align: center;
  padding: 30px 10px;
  font-size: 13px;
  color: var(--text-color);
  opacity: 0.6;
  line-height: 1.5;
}

.stats_list {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.stats_group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.stat_row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  padding: 2px 0;
}

.stat_label {
  opacity: 0.85;
}

.stat_value {
  font-weight: bold;
}

.stat_divider {
  height: 1px;
  border-top: 1px dashed var(--border-color);
  margin: 4px 0;
}

/* 색상 유틸리티 */
.text_positive {
  color: #4caf50; /* 초록 */
}

.text_negative {
  color: #f44336; /* 빨강 */
}

.highlight {
  color: var(--color-toggle-on);
}
</style>
