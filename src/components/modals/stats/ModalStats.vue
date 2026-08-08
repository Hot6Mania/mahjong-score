<script setup lang="ts">
import { ref, computed, watch } from "vue"
import type { Player, Option } from "@/types/types.d"

interface Props {
  todayMembers: string[]
  players: Player[]
  history: any[]
  option: Option
  googleMemberStats?: any[] // 구글 스프레드시트에서 실시간 갱신된 전체 기간 스탯
}
const props = defineProps<Props>()

// 스탯 계산 스코프 탭 ('session' = 이번 회차, 'all' = 전체 기간)
const scopeTab = ref<'session' | 'backup' | 'all'>('session')

// 로컬 영구 백업 대국 불러오기
const activeHistory = computed(() => {
  if (scopeTab.value === 'backup') {
    try {
      const raw = localStorage.getItem("permanent_games_history") || "[]"
      return JSON.parse(raw)
    } catch (e) {
      return []
    }
  } else if (scopeTab.value === 'all') {
    const list = [...(props.history || [])]
    try {
      const raw = localStorage.getItem("permanent_games_history") || "[]"
      const perm = JSON.parse(raw)
      perm.forEach((g: any) => {
        if (!list.some(existing => existing.timestamp && existing.timestamp === g.timestamp)) {
          list.push(g)
        }
      })
    } catch (e) {}
    return list
  }
  return props.history || []
})

// 탭 종류
type TabType = 'basic' | 'riichi' | 'other' | 'rank'
const activeTab = ref<TabType>('basic')

// 호버 중인 순위 카드/차트 세그먼트 (1, 2, 3, 4)
const hoveredRank = ref<number | null>(null)

/** 게임 결과에서 특정 플레이어의 결과 정보({ name, score, uma, rank }) 안전하게 추출 */
const extractGameResult = (game: any, name: string): { name: string, score: number, uma: number, rank: number } | null => {
  if (!game || !game.results) return null
  let pResult: any = null

  if (Array.isArray(game.results)) {
    pResult = game.results.find((r: any) => r && (r.name === name || r.playerName === name))
  } else if (typeof game.results === 'object') {
    if (game.results[name]) {
      pResult = game.results[name]
    } else {
      pResult = Object.values(game.results).find((r: any) => r && (r.name === name || r.playerName === name))
    }
  }

  if (pResult) {
    const rankNum = Number(pResult.rank)
    const scoreNum = Number(pResult.score)
    const umaNum = Number(pResult.uma)
    return {
      name: pResult.name || name,
      rank: !isNaN(rankNum) ? rankNum : 0,
      score: !isNaN(scoreNum) ? scoreNum : 0,
      uma: !isNaN(umaNum) ? umaNum : 0
    }
  }
  return null
}

// 1위, 2위, 3위, 4위 순위 분포 계산
const rankStats = computed(() => {
  const name = selectedPlayer.value
  if (!name) {
    return {
      totalGames: 0,
      r1: 0, r2: 0, r3: 0, r4: 0,
      p1: 0, p2: 0, p3: 0, p4: 0,
      top2Rate: '-',
      lastAvoidRate: '-',
      avgRank: '-'
    }
  }

  let r1 = 0, r2 = 0, r3 = 0, r4 = 0
  let totalGames = 0

  // 1. 전체 기간('all') 스코프일 경우, 구글 시트에서 불러온 통계(props.googleMemberStats)를 최우선 참조
  if (scopeTab.value === 'all' && props.googleMemberStats) {
    const item = props.googleMemberStats.find(s => s.name === name)
    if (item && item.games > 0) {
      if ((item.r1 || 0) + (item.r2 || 0) + (item.r3 || 0) + (item.r4 || 0) > 0) {
        // 구글 시트 (AH~AK열)에서 읽어온 실제 1~4위 횟수 적용
        r1 = item.r1 || 0
        r2 = item.r2 || 0
        r3 = item.r3 || 0
        r4 = item.r4 || 0
        totalGames = r1 + r2 + r3 + r4
      } else {
        // AH~AK열 수식이 시트에 미적용된 경우: 평균 순위 및 대국수 기반 추정 수치 적용
        totalGames = item.games
        const avgR = item.rank || 2.5

        let estR1 = Math.round(totalGames * Math.max(0, (4 - avgR) / 3))
        let estR4 = Math.round(totalGames * Math.max(0, (avgR - 1) / 3))
        let rem = totalGames - (estR1 + estR4)
        if (rem < 0) {
          estR1 = Math.floor(totalGames / 4)
          estR4 = Math.floor(totalGames / 4)
          rem = totalGames - estR1 - estR4
        }
        let estR2 = Math.floor(rem / 2)
        let estR3 = rem - estR2

        r1 = Math.max(0, estR1)
        r2 = Math.max(0, estR2)
        r3 = Math.max(0, estR3)
        r4 = Math.max(0, estR4)
      }
    }
  }

  // 2. 'session'/'backup' 스코프이거나, 구글 시트에 해당 멤버 기록이 없는 경우: 로컬 대국 기록 기반 집계
  if (totalGames === 0) {
    const historyList = activeHistory.value || []
    const allGames: any[] = [...historyList]

    if (scopeTab.value === 'all') {
      try {
        const rawBackup = localStorage.getItem("permanent_games_history") || "[]"
        const backupGames = JSON.parse(rawBackup)
        backupGames.forEach((bg: any) => {
          if (!allGames.some(g => (g.timestamp && bg.timestamp && g.timestamp === bg.timestamp) || (g.id && bg.id && g.id === bg.id))) {
            allGames.push(bg)
          }
        })
      } catch (e) {}

      try {
        const rawToday = localStorage.getItem("today_games_history") || "[]"
        const todayGames = JSON.parse(rawToday)
        todayGames.forEach((tg: any) => {
          if (!allGames.some(g => (g.timestamp && tg.timestamp && g.timestamp === tg.timestamp) || (g.id && tg.id && g.id === tg.id))) {
            allGames.push(tg)
          }
        })
      } catch (e) {}
    }

    allGames.forEach((game: any) => {
      const res = extractGameResult(game, name)
      if (!res) return

      if (res.rank === 1) r1++
      else if (res.rank === 2) r2++
      else if (res.rank === 3) r3++
      else if (res.rank === 4) r4++
    })

    totalGames = r1 + r2 + r3 + r4
  }

  const p1 = totalGames > 0 ? (r1 / totalGames) * 100 : 0
  const p2 = totalGames > 0 ? (r2 / totalGames) * 100 : 0
  const p3 = totalGames > 0 ? (r3 / totalGames) * 100 : 0
  const p4 = totalGames > 0 ? (r4 / totalGames) * 100 : 0

  const top2Rate = totalGames > 0 ? ((r1 + r2) / totalGames * 100).toFixed(2) + '%' : '-'
  const lastAvoidRate = totalGames > 0 ? ((r1 + r2 + r3) / totalGames * 100).toFixed(2) + '%' : '-'
  const avgRankVal = totalGames > 0 ? ((r1 * 1 + r2 * 2 + r3 * 3 + r4 * 4) / totalGames).toFixed(2) + '위' : '-'

  return {
    totalGames,
    r1, r2, r3, r4,
    p1, p2, p3, p4,
    top2Rate,
    lastAvoidRate,
    avgRank: avgRankVal
  }
})

// 오늘 참가한 모든 플레이어 목록 추출 (스코프에 따라 전체 명단 반환)
const allPlayers = computed(() => {
  if (scopeTab.value === 'all') {
    if (props.googleMemberStats && props.googleMemberStats.length > 0) {
      return props.googleMemberStats
        .map(s => s.name)
        .filter(name => name && name.trim() !== '');
    }
  }

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
  if (activeHistory.value) {
    activeHistory.value.forEach((game: any) => {
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
watch([allPlayers, scopeTab], ([newVal]) => {
  if (newVal.length > 0) {
    if (!selectedPlayer.value || !newVal.includes(selectedPlayer.value)) {
      selectedPlayer.value = newVal[0]
    }
  } else {
    selectedPlayer.value = ''
  }
}, { immediate: true })

// 기본 빈 스탯 객체 틀
const emptyStats = {
  totalGames: 0,
  totalRounds: 0,
  winRate: '-',
  loseRate: '-',
  tsumoRate: '-',
  drawRate: '-',
  drawTenpaiRate: '-',
  avgWinScore: '-',
  avgLoseScore: '-',
  avgRank: '-',
  tobiRate: '-',
  expectedScore: '-',
  riichiWinRate: '-',
  riichiLoseRate: '-',
  riichiRate: '-',
  riichiSuji: '-',
  riichiIncome: '-',
  riichiExpense: '-',
  firstRiichiRate: '-',
  chaseRiichiRate: '-',
  chasedRiichiRate: '-',
  riichiDrawRate: '-',
  oyaKaburiRate: '-',
  oyaKaburiAvg: '-',
  loseRiichiRate: '-',
  winEfficiency: 0,
  loseLoss: 0,
  netWinEfficiency: 0,
  roundSuji: 0
}

// 스탯 계산기
const stats = computed(() => {
  const name = selectedPlayer.value
  if (!name) return emptyStats

  if (scopeTab.value === 'all') {
    const item = props.googleMemberStats?.find(s => s.name === name);
    if (!item || !item.games || item.games === 0) {
      return emptyStats;
    }
    
    const winRate = item.rounds > 0 ? (item.winRate * 100).toFixed(2) + '%' : '-';
    const loseRate = item.rounds > 0 ? (item.loseRate * 100).toFixed(2) + '%' : '-';
    const riichiRate = item.rounds > 0 ? (item.riichiRate * 100).toFixed(2) + '%' : '-';
    const tsumoRate = (item.rounds > 0 && item.winRate > 0) ? (item.tsumoRate * 100).toFixed(2) + '%' : '-';
    const drawRate = item.rounds > 0 ? (item.drawRate * 100).toFixed(2) + '%' : '-';
    const drawTenpaiRate = (item.rounds > 0 && item.drawRate > 0) ? (item.drawTenpaiRate * 100).toFixed(2) + '%' : '-';
    const tobiRate = item.games > 0 ? (item.tobiRate * 100).toFixed(2) + '%' : '-';
    
    const hasRiichi = item.riichiRate > 0 && item.rounds > 0;
    const riichiWinRate = hasRiichi ? (item.riichiWinRate * 100).toFixed(2) + '%' : '-';
    const riichiLoseRate = hasRiichi ? (item.riichiLoseRate * 100).toFixed(2) + '%' : '-';
    const riichiDrawRate = hasRiichi ? (item.riichiDrawRate * 100).toFixed(2) + '%' : '-';

    const avgRank = item.games > 0 ? item.rank.toFixed(2) + '위' : '-';
    const expectedScoreVal = item.games > 0 ? (item.uma / item.games) : 0;
    const expectedScore = item.games > 0
      ? (expectedScoreVal > 0 ? '+' : '') + expectedScoreVal.toFixed(1)
      : '-';
    
    // 천의 자리 구분 쉼표가 있을 수 있으므로 방어 처리
    const parseCleanScore = (val: any) => {
      if (val === undefined || val === null) return 0;
      const cleanStr = val.toString().replace(/,/g, '');
      const num = parseFloat(cleanStr);
      return isNaN(num) ? 0 : num;
    };

    const cleanWinScore = parseCleanScore(item.avgWinScore);
    const cleanLoseScore = parseCleanScore(item.avgLoseScore);

    const cleanRiichiSuji = parseCleanScore(item.riichiSuji);
    const riichiSuji = hasRiichi && cleanRiichiSuji !== 0 ? (cleanRiichiSuji > 0 ? '+' : '') + Math.round(cleanRiichiSuji).toString() : '-';

    const cleanRiichiIncome = parseCleanScore(item.riichiIncome);
    const riichiIncome = hasRiichi && cleanRiichiIncome > 0 ? Math.round(cleanRiichiIncome).toString() : '-';

    const cleanRiichiExpense = parseCleanScore(item.riichiExpense);
    const riichiExpense = hasRiichi && cleanRiichiExpense > 0 ? Math.round(cleanRiichiExpense).toString() : '-';

    const firstRiichiRate = hasRiichi ? (parseCleanScore(item.firstRiichiRate) * 100).toFixed(2) + '%' : '-';
    const chaseRiichiRate = hasRiichi ? (parseCleanScore(item.chaseRiichiRate) * 100).toFixed(2) + '%' : '-';
    const chasedRiichiRate = hasRiichi ? (parseCleanScore(item.chasedRiichiRate) * 100).toFixed(2) + '%' : '-';

    const oyaKaburiRate = item.rounds > 0 && parseCleanScore(item.oyaKaburiRate) > 0 ? (parseCleanScore(item.oyaKaburiRate) * 100).toFixed(2) + '%' : '-';
    const cleanOyaKaburiAvg = parseCleanScore(item.oyaKaburiAvg);
    const oyaKaburiAvg = cleanOyaKaburiAvg > 0 ? Math.round(cleanOyaKaburiAvg).toString() : '-';

    const cleanLoseRiichiRate = parseCleanScore(item.loseRiichiRate);
    const loseRiichiRate = cleanLoseRiichiRate > 0 ? (cleanLoseRiichiRate * 100).toFixed(2) + '%' : '-';

    return {
      totalGames: item.games,
      totalRounds: item.rounds,
      winRate,
      loseRate,
      tsumoRate,
      drawRate,
      drawTenpaiRate,
      avgWinScore: cleanWinScore > 0 ? Math.round(cleanWinScore).toString() : '-',
      avgLoseScore: cleanLoseScore > 0 ? Math.round(cleanLoseScore).toString() : '-',
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
      winEfficiency: Math.round(parseCleanScore(item.winEfficiency)),
      loseLoss: Math.round(parseCleanScore(item.loseLoss)),
      netWinEfficiency: Math.round(parseCleanScore(item.netEfficiency)),
      roundSuji: item.rounds > 0 ? Math.round(parseCleanScore(item.roundSuji)) : '-'
    };
  }

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
  let totalNetScore = 0

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
  let oyaKaburiSufferedCount = 0
  let manganOyaKaburiCount = 0
  let manganOyaKaburiScoreSum = 0
  let loseWithRiichiCount = 0

  if (activeHistory.value) {
    activeHistory.value.forEach((game: any) => {
      const resultEntry = extractGameResult(game, name)
      if (!resultEntry) return

      totalGames++

      // 최종 등수 및 최종 점수
      totalRanks += resultEntry.rank
      totalFinalScore += resultEntry.score
      totalUma += resultEntry.uma || 0
      if (resultEntry.score < 0) {
        tobiCount++
      }

      const startingScore = props.option.startingScore || 25000;
      totalNetScore += (resultEntry.score - startingScore);

      // 국별 상세 정보 분석을 위해 pIdx 추출
      let pIdx = -1
      if (Array.isArray(game.results)) {
        pIdx = game.results.findIndex((r: any) => r && (r.name === name || r.playerName === name))
      } else if (game.playerNames && Array.isArray(game.playerNames)) {
        pIdx = game.playerNames.indexOf(name)
      }
      if (pIdx === -1 && typeof game.results === 'object') {
        pIdx = Object.keys(game.results).indexOf(name)
      }

      // 국별 상세 정보 분석
      if (game.records && !Array.isArray(game.records) && game.records.riichi) {
        const rec = game.records;
        const roundsLen = rec.riichi.length;
        for (let r = 1; r < roundsLen; r++) {
          totalRounds++

          const hasRiichi = !!(rec.riichi && rec.riichi[r] && rec.riichi[r][pIdx]);
          const isWin = !!(rec.win && rec.win[r] && rec.win[r][pIdx]);
          const isLose = !!(rec.lose && rec.lose[r] && rec.lose[r][pIdx]);
          
          const roundStatusVal = rec.status && rec.status[r] ? rec.status[r] : '';
          const isDraw = (roundStatusVal.includes('draw') || roundStatusVal === 'noten' || roundStatusVal === 'tenpai' || roundStatusVal.includes('유국'));
          
          const delta = (rec.score && rec.score[pIdx]) ? (rec.score[pIdx][2 * r - 1] || 0) : 0;

          // 선제 리치 여부 분석을 위한 국 내부 리치 리스트 수집
          const riichiList: number[] = [];
          if (rec.riichiOrder && rec.riichiOrder[r]) {
            rec.riichiOrder[r].forEach((val: any) => riichiList.push(Number(val)));
          }
          if (riichiList.length === 0 && rec.riichi && rec.riichi[r]) {
            rec.riichi[r].forEach((val: boolean, idx: number) => {
              if (val) riichiList.push(idx);
            });
          }

          if (isWin) {
            winCount++
            totalWinScore += delta
            if (roundStatusVal === 'tsumo') {
              tsumoWinCount++
            }
          }
          if (isLose) {
            loseCount++
            totalLoseScore += delta // 음수
          }
          if (isDraw) {
            drawCount++
            const isTenpai = !!(rec.tenpai && rec.tenpai[r] && rec.tenpai[r][pIdx]);
            if (isTenpai) {
              drawTenpaiCount++
            }
          }

          if (hasRiichi) {
            riichiCount++
            riichiDeltaSum += delta

            if (isWin) {
              riichiWinCount++
              riichiWinScoreSum += delta
            }
            if (isLose) {
              riichiLoseCount++
              riichiLoseScoreSum += delta
            }
            if (isDraw) {
              riichiDrawCount++
            }

            // 선제, 추격, 피추격
            const orderIdx = riichiList.indexOf(pIdx)
            if (orderIdx === 0) {
              firstRiichiCount++
            } else if (orderIdx > 0) {
              chaseRiichiCount++
            }
            if (orderIdx !== -1 && orderIdx < riichiList.length - 1) {
              chasedRiichiCount++
            }
          }

          // 오야카부리 & 쯔모당함
          const dealerIdx = (rec.dealer && rec.dealer[r] !== undefined) ? rec.dealer[r] : 0
          const isEast = (dealerIdx === pIdx)

          if (roundStatusVal === 'tsumo' && !isWin) {
            tsumoSufferedCount++
            const limit = hasRiichi ? -5000 : -4000
            if (isEast) {
              oyaKaburiSufferedCount++
              if (delta <= limit) {
                manganOyaKaburiCount++
                // 화료한 사람(Winner)을 제외한 나머지 3명의 음수 득실 절대값 합산
                let pureWinScore = 0
                if (rec.pureWinScore && rec.pureWinScore[r] !== undefined) {
                  pureWinScore = rec.pureWinScore[r]
                } else {
                  let winnerIdx = -1
                  for (let w = 0; w < 4; w++) {
                    if (rec.win && rec.win[r] && rec.win[r][w]) {
                      winnerIdx = w
                      break
                    }
                  }
                  for (let w = 0; w < 4; w++) {
                    if (w !== winnerIdx) {
                      const wPrev = (r === 1) ? (props.option.startingScore || 25000) : (rec.score && rec.score[w] ? (rec.score[w][2 * (r - 1)] || 0) : 0)
                      const wCurr = rec.score && rec.score[w] ? (rec.score[w][2 * r] || 0) : 0
                      const wDelta = wCurr - wPrev
                      if (wDelta < 0) {
                        pureWinScore += Math.abs(wDelta)
                      }
                    }
                  }
                }
                manganOyaKaburiScoreSum += pureWinScore
              }
          }
        }

          // 방총 시 리치 여부
          if (isLose && hasRiichi) {
            loseWithRiichiCount++
          }
        }
      } else if (game.records && Array.isArray(game.records)) {
        game.records.forEach((rec: any, rIdx: number) => {
          if (!rec.results) return
          const myResult = rec.results[pIdx]
          if (!myResult) return

          totalRounds++

          const status = myResult.status // 'win', 'lose', 'draw', 'none'
          const isWin = (status === 'win')
          const isLose = (status === 'lose')
          const isDraw = !!(status && status.includes('draw'))
          const delta = myResult.delta || 0
          const hasRiichi = !!myResult.riichi

          const currScore = myResult.finalScore !== undefined ? myResult.finalScore : null
          let actualRoundDelta = delta
          if (currScore !== null) {
            const prevRec = game.records[rIdx - 1]
            const prevScore = (prevRec && prevRec.results && prevRec.results[pIdx] && prevRec.results[pIdx].finalScore !== undefined)
              ? prevRec.results[pIdx].finalScore 
              : (props.option.startingScore || 25000)
            actualRoundDelta = currScore - prevScore
          }

          // 선제 리치 여부 분석을 위한 국 내부 리치 리스트 수집
          const riichiList: number[] = []
          rec.results.forEach((res: any, idx: number) => {
            if (res && res.riichi) riichiList.push(idx)
          })

          if (isWin) {
            winCount++
            totalWinScore += actualRoundDelta
            if (myResult.type === 'tsumo') {
              tsumoWinCount++
            }
          }
          if (isLose) {
            loseCount++
            totalLoseScore += actualRoundDelta // 음수
          }
          if (isDraw) {
            drawCount++
            if (myResult.tenpai) {
              drawTenpaiCount++
            }
          }

          if (hasRiichi) {
            riichiCount++
            riichiDeltaSum += delta

            if (isWin) {
              riichiWinCount++
              riichiWinScoreSum += delta
            }
            if (isLose) {
              riichiLoseCount++
              riichiLoseScoreSum += delta
            }
            if (isDraw) {
              riichiDrawCount++
            }

            // 선제, 추격, 피추격
            const orderIdx = riichiList.indexOf(pIdx)
            if (orderIdx === 0) {
              firstRiichiCount++
            } else if (orderIdx > 0) {
              chaseRiichiCount++
            }
            if (orderIdx !== -1 && orderIdx < riichiList.length - 1) {
              chasedRiichiCount++
            }
          }

          // 오야카부리 & 쯔모당함
          const dealerIdx = (rec.dealer && rec.dealer[pIdx] !== undefined) ? rec.dealer[pIdx] : 0
          const isEast = (dealerIdx === pIdx)

          if (status === 'tsumo' && !isWin) {
            tsumoSufferedCount++
            const limit = hasRiichi ? -5000 : -4000
            if (isEast) {
              oyaKaburiSufferedCount++
              if (delta <= limit) {
                manganOyaKaburiCount++
                // 화료한 사람(Winner)을 제외한 나머지 3명의 음수 득실 절대값 합산
                let pureWinScore = 0
                if (rec.pureWinScore !== undefined) {
                  pureWinScore = rec.pureWinScore || 0
                } else if (rec.results) {
                  const winner = rec.results.find((res: any) => res && res.status === 'win')
                  const winnerName = winner ? winner.name : ''
                  rec.results.forEach((res: any, idx: number) => {
                    if (res && res.name !== winnerName) {
                      const wPrev = (rIdx === 0) ? (props.option.startingScore || 25000) : (game.records[rIdx - 1]?.results[idx]?.finalScore || 0)
                      const wCurr = res.finalScore || 0
                      const wDelta = wCurr - wPrev
                      if (wDelta < 0) {
                        pureWinScore += Math.abs(wDelta)
                      }
                    }
                  })
                }
                manganOyaKaburiScoreSum += pureWinScore
              }
          }
        }

          // 방총 시 리치 여부
          if (isLose && hasRiichi) {
            loseWithRiichiCount++
          }
        })
      }
    })
  }

  // 기본 스탯 연산
  const formatRate = (num: number, den: number) => {
    return den > 0 ? ((num / den) * 100).toFixed(2) + '%' : '-'
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
  const oyaKaburiRate = oyaKaburiSufferedCount > 0 ? formatRate(manganOyaKaburiCount, tsumoSufferedCount) : '-'
  const oyaKaburiAvg = formatVal(manganOyaKaburiScoreSum, manganOyaKaburiCount)
  const loseRiichiRate = loseWithRiichiCount > 0 ? formatRate(loseWithRiichiCount, loseCount) : '-'

  // 화료 효율, 방총 손실, 알짜 화료 효율
  const winRateNum = totalRounds > 0 ? winCount / totalRounds : 0
  const avgWinNum = winCount > 0 ? totalWinScore / winCount : 0
  const loseRateNum = totalRounds > 0 ? loseCount / totalRounds : 0
  const avgLoseNum = loseCount > 0 ? Math.abs(totalLoseScore) / loseCount : 0

  const winEfficiency = Number((winRateNum * avgWinNum).toFixed(0))
  const loseLoss = Number((loseRateNum * avgLoseNum).toFixed(0))
  const netWinEfficiency = winEfficiency - loseLoss
  const roundSuji = totalRounds > 0 ? Math.round(totalNetScore / totalRounds) : '-'

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
  <!-- 스코프 탭바 (브라우저 탭 스타일) -->
  <div class="scope_tab_bar">
    <button 
      class="scope_tab" 
      :class="{ active: scopeTab === 'session' }" 
      @click="scopeTab = 'session'"
    >
      이번 회차
    </button>
    <button 
      class="scope_tab" 
      :class="{ active: scopeTab === 'backup' }" 
      @click="scopeTab = 'backup'"
    >
      로컬 백업
    </button>
    <button 
      class="scope_tab" 
      :class="{ active: scopeTab === 'all' }" 
      @click="scopeTab = 'all'"
    >
      전체 기간
    </button>
  </div>

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
    <button 
      class="tab_btn" 
      :class="{ active: activeTab === 'rank' }" 
      @click="activeTab = 'rank'"
    >
      순위 비율
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
          <span class="stat_label">리치율</span>
          <span class="stat_value">{{ stats.riichiRate }}</span>
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
      <div v-else-if="activeTab === 'riichi'" class="stats_group">
        <div class="stat_row">
          <span class="stat_label">리치율</span>
          <span class="stat_value">{{ stats.riichiRate }}</span>
        </div>
        <div class="stat_row">
          <span class="stat_label">리치 화료율</span>
          <span class="stat_value text_positive">{{ stats.riichiWinRate }}</span>
        </div>
        <div class="stat_row">
          <span class="stat_label">리치 방총율</span>
          <span class="stat_value text_negative">{{ stats.riichiLoseRate }}</span>
        </div>
        <div class="stat_row">
          <span class="stat_label">리치 유국률</span>
          <span class="stat_value">{{ stats.riichiDrawRate }}</span>
        </div>
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
      <div v-else-if="activeTab === 'other'" class="stats_group">
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
        <div class="stat_row">
          <span class="stat_label">화료 효율</span>
          <span class="stat_value text_positive">+{{ stats.winEfficiency }}</span>
        </div>
        <div class="stat_row">
          <span class="stat_label">방총 손실</span>
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
          <span class="stat_value" :class="{ text_positive: typeof stats.roundSuji === 'number' && stats.roundSuji > 0, text_negative: typeof stats.roundSuji === 'number' && stats.roundSuji < 0 }">
            {{ typeof stats.roundSuji === 'number' && stats.roundSuji > 0 ? '+' : '' }}{{ stats.roundSuji }}
          </span>
        </div>
        <div class="stat_row">
          <span class="stat_label">총합 국 수</span>
          <span class="stat_value">{{ stats.totalRounds }}국</span>
        </div>
      </div>

      <!-- 순위 비율 탭 (원형 그래프 및 1위/2위/3위/4위 상세 분포) -->
      <div v-else-if="activeTab === 'rank'" class="rank_tab_wrapper">
        <div class="rank_chart_section">
          <!-- SVG 원형 그래프 (도넛 차트) -->
          <div class="chart_box">
            <svg viewBox="0 0 200 200" class="donut_svg">
              <!-- 베이스 링 (배경) -->
              <circle 
                cx="100" 
                cy="100" 
                r="60" 
                fill="none" 
                stroke="var(--border-color, rgba(255,255,255,0.1))" 
                stroke-width="20"
              />
              
              <!-- 원형 조각들 (12시 방향 시작 회전) -->
              <g transform="rotate(-90 100 100)">
                <!-- 4위 (빨강: Player.vue 등수 색상) -->
                <circle 
                  v-if="rankStats.p4 > 0"
                  cx="100" cy="100" r="60" 
                  fill="none" 
                  stroke="var(--color-rank-4)" 
                  stroke-width="20" 
                  :stroke-dasharray="`${(rankStats.p4 / 100) * 376.9911} 376.9911`"
                  :stroke-dashoffset="`-${((rankStats.p1 + rankStats.p2 + rankStats.p3) / 100) * 376.9911}`"
                  class="donut_segment"
                  :class="{ active: hoveredRank === 4 }"
                  @mouseenter="hoveredRank = 4"
                  @mouseleave="hoveredRank = null"
                />
                <!-- 3위 (노랑/앰버: Player.vue 등수 색상) -->
                <circle 
                  v-if="rankStats.p3 > 0"
                  cx="100" cy="100" r="60" 
                  fill="none" 
                  stroke="var(--color-rank-3)" 
                  stroke-width="20" 
                  :stroke-dasharray="`${(rankStats.p3 / 100) * 376.9911} 376.9911`"
                  :stroke-dashoffset="`-${((rankStats.p1 + rankStats.p2) / 100) * 376.9911}`"
                  class="donut_segment"
                  :class="{ active: hoveredRank === 3 }"
                  @mouseenter="hoveredRank = 3"
                  @mouseleave="hoveredRank = null"
                />
                <!-- 2위 (청록: Player.vue 등수 색상) -->
                <circle 
                  v-if="rankStats.p2 > 0"
                  cx="100" cy="100" r="60" 
                  fill="none" 
                  stroke="var(--color-rank-2)" 
                  stroke-width="20" 
                  :stroke-dasharray="`${(rankStats.p2 / 100) * 376.9911} 376.9911`"
                  :stroke-dashoffset="`-${(rankStats.p1 / 100) * 376.9911}`"
                  class="donut_segment"
                  :class="{ active: hoveredRank === 2 }"
                  @mouseenter="hoveredRank = 2"
                  @mouseleave="hoveredRank = null"
                />
                <!-- 1위 (초록: Player.vue 등수 색상) -->
                <circle 
                  v-if="rankStats.p1 > 0"
                  cx="100" cy="100" r="60" 
                  fill="none" 
                  stroke="var(--color-rank-1)" 
                  stroke-width="20" 
                  :stroke-dasharray="`${(rankStats.p1 / 100) * 376.9911} 376.9911`"
                  stroke-dashoffset="0"
                  class="donut_segment"
                  :class="{ active: hoveredRank === 1 }"
                  @mouseenter="hoveredRank = 1"
                  @mouseleave="hoveredRank = null"
                />
              </g>

              <!-- 차트 중앙 레이블 -->
              <text x="100" y="90" text-anchor="middle" class="chart_center_label">총 대국</text>
              <text x="100" y="114" text-anchor="middle" class="chart_center_value">{{ rankStats.totalGames }}전</text>
              <text x="100" y="132" text-anchor="middle" class="chart_center_sub">평균 {{ rankStats.avgRank }}</text>
            </svg>
          </div>

          <!-- 순위별 상세 수치 카드 목록 -->
          <div class="rank_details_list">
            <div 
              class="rank_detail_card" 
              :class="{ highlighted: hoveredRank === 1 }"
              @mouseenter="hoveredRank = 1"
              @mouseleave="hoveredRank = null"
            >
              <div class="rank_card_header">
                <span class="rank_badge badge_1">🥇 1위</span>
                <span class="rank_count_val">{{ rankStats.r1 }}회</span>
                <span class="rank_percent_val text_rank_1">{{ rankStats.p1.toFixed(1) }}%</span>
              </div>
              <div class="rank_bar_track">
                <div class="rank_bar_fill bar_1" :style="{ width: rankStats.p1 + '%' }"></div>
              </div>
            </div>

            <div 
              class="rank_detail_card" 
              :class="{ highlighted: hoveredRank === 2 }"
              @mouseenter="hoveredRank = 2"
              @mouseleave="hoveredRank = null"
            >
              <div class="rank_card_header">
                <span class="rank_badge badge_2">🥈 2위</span>
                <span class="rank_count_val">{{ rankStats.r2 }}회</span>
                <span class="rank_percent_val text_rank_2">{{ rankStats.p2.toFixed(1) }}%</span>
              </div>
              <div class="rank_bar_track">
                <div class="rank_bar_fill bar_2" :style="{ width: rankStats.p2 + '%' }"></div>
              </div>
            </div>

            <div 
              class="rank_detail_card" 
              :class="{ highlighted: hoveredRank === 3 }"
              @mouseenter="hoveredRank = 3"
              @mouseleave="hoveredRank = null"
            >
              <div class="rank_card_header">
                <span class="rank_badge badge_3">🥉 3위</span>
                <span class="rank_count_val">{{ rankStats.r3 }}회</span>
                <span class="rank_percent_val text_rank_3">{{ rankStats.p3.toFixed(1) }}%</span>
              </div>
              <div class="rank_bar_track">
                <div class="rank_bar_fill bar_3" :style="{ width: rankStats.p3 + '%' }"></div>
              </div>
            </div>

            <div 
              class="rank_detail_card" 
              :class="{ highlighted: hoveredRank === 4 }"
              @mouseenter="hoveredRank = 4"
              @mouseleave="hoveredRank = null"
            >
              <div class="rank_card_header">
                <span class="rank_badge badge_4">4위</span>
                <span class="rank_count_val">{{ rankStats.r4 }}회</span>
                <span class="rank_percent_val text_rank_4">{{ rankStats.p4.toFixed(1) }}%</span>
              </div>
              <div class="rank_bar_track">
                <div class="rank_bar_fill bar_4" :style="{ width: rankStats.p4 + '%' }"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- 핵심 요약 지표 카드 -->
        <div class="rank_summary_grid">
          <div class="summary_stat_box">
            <span class="summary_label">연대율 (1~2위)</span>
            <span class="summary_value highlight">{{ rankStats.top2Rate }}</span>
          </div>
          <div class="summary_stat_box">
            <span class="summary_label">라스 회피율 (1~3위)</span>
            <span class="summary_value text_positive">{{ rankStats.lastAvoidRate }}</span>
          </div>
          <div class="summary_stat_box">
            <span class="summary_label">평균 순위</span>
            <span class="summary_value">{{ rankStats.avgRank }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
</template>

<style scoped>
/* 스코프 탭바 (브라우저 탭 스타일) */
.scope_tab_bar {
  display: flex;
  background-color: var(--bg-card, #2a2a2a);
  padding: 5px;
  border-radius: 10px;
  margin-bottom: 10px; /* 여백 축소 */
  border: 1px solid var(--border-color, #333);
  box-shadow: inset 0 2px 4px rgba(0,0,0,0.2);
}

.scope_tab {
  flex: 1;
  padding: 10px 16px;
  font-size: 15px;
  font-weight: 800;
  letter-spacing: 0.5px;
  font-family: 'Outfit', 'Inter', 'Noto Sans KR', sans-serif;
  border: none;
  background: transparent;
  color: var(--text-color, #fff);
  opacity: 0.55;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  text-align: center;
}

.scope_tab:hover {
  opacity: 0.9;
}

.scope_tab.active {
  opacity: 1;
  background-color: var(--bg-modal, #1e1e1e);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  color: var(--color-toggle-on, #4caf50);
}

.container_stats_modal {
  --color-rank-1: #28a745; /* 1위: 초록 (Player.vue 등수 색상 통일) */
  --color-rank-2: #17a2b8; /* 2위: 청록 (Player.vue 등수 색상 통일) */
  --color-rank-3: #d97706; /* 3위: 앰버/노랑 */
  --color-rank-4: #dc3545; /* 4위: 빨강 (Player.vue 등수 색상 통일) */
  width: 100%;
  max-width: 720px; /* 옆으로 펼쳐지도록 넓은 너비 설정 */
  display: flex;
  flex-direction: column;
  color: var(--text-color);
  font-family: inherit;
  box-sizing: border-box;
}

html.dark .container_stats_modal {
  --color-rank-1: #4ade80; /* 다크모드 선명한 초록 */
  --color-rank-2: #38bdf8; /* 다크모드 선명한 청록 */
  --color-rank-3: #fbbf24; /* 다크모드 선명한 노랑 */
  --color-rank-4: #f87171; /* 다크모드 선명한 빨강 */
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
  margin-bottom: 8px; /* 여백 축소 */
  background-color: var(--bg-card);
  padding: 4px 8px; /* 패딩 축소로 더욱 납작하게 만듦 */
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
  color-scheme: dark light;
}

/* 드롭다운 옵션의 배경색과 글자색을 명시적으로 강제하여 안보이는 현상 방지 */
.player_select option {
  background-color: var(--bg-modal, #1e1e1e) !important;
  color: var(--text-color, #ffffff) !important;
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

/* 스탯 목록 - 스크롤 없이 넓게 렌더링 */
.stats_content {
  width: 100%;
  max-height: 60vh;
  overflow-y: auto; /* 만약의 화면 잘림을 위한 최소한의 가이드 */
  padding: 4px 2px;
  box-sizing: border-box;
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

/* 4열 그리드 레이아웃 설정 (Mui 컴포넌트 느낌의 촘촘한 배치) */
.stats_group {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  width: 100%;
}

/* 개별 Mui 스타일의 깔끔한 박스형 스탯 표시 */
.stat_row {
  display: flex;
  flex-direction: column;
  align-items: flex-start; /* 좌측 정렬 */
  justify-content: center;
  background-color: var(--bg-modal); /* 살짝 더 어두운 모달 기본 배경 사용 */
  border: 1px solid var(--border-color);
  border-left: 3px solid var(--color-toggle-on); /* 왼쪽 포인트 테두리 추가 */
  border-radius: 4px;
  padding: 6px 10px;
  min-height: 48px;
  box-sizing: border-box;
  width: 100%;
}

.stat_label {
  font-size: 11px;
  opacity: 0.65;
  margin-bottom: 2px;
  font-weight: 500;
  width: 100%;
  white-space: nowrap; /* MuiTypography-noWrap 모방 */
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
}

.stat_value {
  font-size: 14px;
  font-weight: 700;
  width: 100%;
  white-space: nowrap; /* MuiTypography-noWrap 모방 */
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
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

/* 모바일 등 좁은 가로 폭에서 2열 그리드로 유연하게 폴백 */
@media (max-width: 580px) {
  .stats_group {
    grid-template-columns: repeat(3, 1fr);
  }
}
@media (max-width: 440px) {
  .stats_group {
    grid-template-columns: repeat(2, 1fr);
  }
}

/* 라이트 모드(화이트 모드) 가독성 오버라이드 */
html:not(.dark) .scope_tab_bar {
  background-color: #f1f5f9 !important;
  border: 1px solid #cbd5e1 !important;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.05) !important;
}
html:not(.dark) .scope_tab {
  color: #475569 !important;
}
html:not(.dark) .scope_tab.active {
  background-color: #ffffff !important;
  color: var(--color-toggle-on, #4caf50) !important;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08) !important;
}
html:not(.dark) .player_selector_container {
  background-color: #f8fafc !important;
  border: 1px solid #cbd5e1 !important;
}
html:not(.dark) .player_select {
  background-color: #ffffff !important;
  color: #1e293b !important;
  border: 1px solid #cbd5e1 !important;
}
html:not(.dark) .player_select option {
  background-color: #ffffff !important;
  color: #1e293b !important;
}
html:not(.dark) .stat_row {
  background-color: #f8fafc !important;
  border: 1px solid #cbd5e1 !important;
  border-left: 3px solid var(--color-toggle-on, #4caf50) !important;
}
html:not(.dark) .tab_btn {
  color: #475569 !important;
}
html:not(.dark) .tab_btn.active {
  color: var(--color-toggle-on, #4caf50) !important;
  border-bottom-color: var(--color-toggle-on, #4caf50) !important;
}

/* 순위 비율 탭 래퍼 */
.rank_tab_wrapper {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
}

.rank_chart_section {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  background-color: var(--bg-modal);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 16px;
  box-sizing: border-box;
}

.chart_box {
  width: 190px;
  height: 190px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.donut_svg {
  width: 100%;
  height: 100%;
  overflow: visible;
}

.donut_segment {
  transition: stroke-width 0.25s ease, opacity 0.25s ease, filter 0.25s ease;
  transform-origin: center;
  cursor: pointer;
}

.donut_segment.active {
  stroke-width: 24;
  filter: drop-shadow(0 0 6px rgba(255, 255, 255, 0.4));
}

.chart_center_label {
  font-size: 11px;
  fill: var(--text-color);
  opacity: 0.65;
  font-weight: 600;
}

.chart_center_value {
  font-size: 19px;
  fill: var(--text-color);
  font-weight: 800;
}

.chart_center_sub {
  font-size: 12px;
  fill: var(--color-toggle-on, #4caf50);
  font-weight: 700;
}

.rank_details_list {
  flex: 1;
  min-width: 220px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rank_detail_card {
  background-color: var(--bg-card, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 8px 12px;
  transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
  cursor: pointer;
}

.rank_detail_card.highlighted {
  transform: translateX(4px);
  border-color: var(--color-toggle-on, #4caf50);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.rank_card_header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 5px;
  font-size: 13px;
}

.rank_badge {
  font-weight: 800;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.badge_1 {
  background: rgba(40, 167, 69, 0.15);
  color: var(--color-rank-1);
  border: 1px solid var(--color-rank-1);
}

.badge_2 {
  background: rgba(23, 162, 184, 0.15);
  color: var(--color-rank-2);
  border: 1px solid var(--color-rank-2);
}

.badge_3 {
  background: rgba(234, 179, 8, 0.15);
  color: var(--color-rank-3);
  border: 1px solid var(--color-rank-3);
}

.badge_4 {
  background: rgba(220, 53, 69, 0.15);
  color: var(--color-rank-4);
  border: 1px solid var(--color-rank-4);
}

.rank_count_val {
  font-weight: 700;
  color: var(--text-color);
  margin-left: auto;
  margin-right: 10px;
  font-size: 13px;
}

.rank_percent_val {
  font-weight: 800;
  font-size: 14px;
  min-width: 50px;
  text-align: right;
}

.text_rank_1 { color: var(--color-rank-1); }
.text_rank_2 { color: var(--color-rank-2); }
.text_rank_3 { color: var(--color-rank-3); }
.text_rank_4 { color: var(--color-rank-4); }

.rank_bar_track {
  width: 100%;
  height: 6px;
  background-color: rgba(255, 255, 255, 0.08);
  border-radius: 3px;
  overflow: hidden;
}

.rank_bar_fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.4s ease;
}

.bar_1 { background: var(--color-rank-1); }
.bar_2 { background: var(--color-rank-2); }
.bar_3 { background: var(--color-rank-3); }
.bar_4 { background: var(--color-rank-4); }

.rank_summary_grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  width: 100%;
}

.summary_stat_box {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: var(--bg-modal);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 8px 6px;
  text-align: center;
}

.summary_label {
  font-size: 11px;
  opacity: 0.7;
  margin-bottom: 3px;
  font-weight: 600;
}

.summary_value {
  font-size: 15px;
  font-weight: 800;
}

@media (max-width: 520px) {
  .rank_chart_section {
    flex-direction: column;
    gap: 14px;
  }
  .rank_details_list {
    width: 100%;
  }
}

/* 라이트 모드 오버라이드 */
html:not(.dark) .rank_chart_section,
html:not(.dark) .summary_stat_box {
  background-color: #f8fafc !important;
  border-color: #cbd5e1 !important;
}

html:not(.dark) .rank_detail_card {
  background-color: #ffffff !important;
  border-color: #cbd5e1 !important;
}

html:not(.dark) .chart_center_label,
html:not(.dark) .chart_center_value {
  fill: #1e293b !important;
}

html:not(.dark) .rank_bar_track {
  background-color: rgba(0, 0, 0, 0.08) !important;
}
</style>
