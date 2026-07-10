<script setup lang="ts">
import { ModalChooseDraw, ModalCheckPlayer, ModalScoreSelect, ModalScoreResult } from "@/components/modals/scoring";
import { ModalDice, ModalTile } from "@/components/modals/setup";
import { ModalChooseMenu } from "@/components/modals/system";
import { ModalRecordList, ModalRollback, ModalTotalUma } from "@/components/modals/stats";
import type { Player, ScoringState, PanelInfo, Dice, SeatTile, Records, Option, ModalInfo, GoogleInfo } from "@/types/types.d"
import { computed } from "vue"
import { useI18n } from "vue-i18n"
import { Line as LineChart } from "vue-chartjs"
import { Chart as ChartJS, Title, Tooltip, Legend, LineElement, CategoryScale, LinearScale, PointElement, type ChartOptions } from "chart.js"

/**i18n 속성 가져오기*/
const { t } = useI18n()

/**차트 컴포넌트 등록*/
ChartJS.register(Title, Tooltip, Legend, LineElement, CategoryScale, LinearScale, PointElement)
ChartJS.defaults.font.family = "'Noto Serif KR', 'Noto Serif JP', 'Noto Serif', serif" // 폰트 설정

/**props 정의*/
interface Props {
  players: Player[],
  scoringState: ScoringState,
  panelInfo: PanelInfo,
  dice: Dice,
  seatTile: SeatTile,
  records: Records,
  option: Option,
  modalInfo: ModalInfo,
  googleInfo: GoogleInfo,
  todayGamesHistory: any[],
  isGameSaved: boolean
}
const props = defineProps<Props>()

/**emits 정의*/
type Emits = {
  (e: 'show-modal', type: string, status?: string): void,
  (e: 'hide-modal'): void,
  (e: 'set-arrow-button', status: string, idx: number): void,
  (e: 'set-toggle-button', status: string): void,
  (e: 'set-fanbu-button', status: string, idx: number): void,
  (e: 'set-seat-tile', idx: number): void,
  (e: 'check-invalid-status', status: string): void,
  (e: 'calculate-win'): void,
  (e: 'calculate-draw'): void,
  (e: 'save-round'): void,
  (e: 'roll-dice'): void,
  (e: 'copy-record'): void,
  (e: 'rollback-record', time: number): void,
  (e: 'start-game-with-seats', assignment: Record<string, string>): void,
  (e: 'save-google-settings'): void,
  (e: 'google-login'): void,
  (e: 'google-logout'): void,
  (e: 'save-game-to-sheet'): void,
  (e: 'add-new-member', name: string): void,
  (e: 'save-today-members', names: string[]): void,
  (e: 'start-new-game', skipConfirm?: boolean): void,
  (e: 'sync-local-to-google'): void,
  (e: 'start-new-day'): void,
  (e: 'invalidate-game', index: number): void,
}
const emit = defineEmits<Emits>()

/**data 정의*/
const arr_wind = ['東', '南', '西', '北']
const arr_seat = ['option.east', 'option.south', 'option.west', 'option.north',]
const arr_resultsheet = ['resultSheet.wind', 'resultSheet.name', 'resultSheet.score', 'resultSheet.riichi', 'resultSheet.win', 'resultSheet.lose']
const class_resultsheet = ['wind', 'name', 'score', 'riichi', 'win', 'lose']

/**순위표 정보 계산*/
const scoreSheetInfo = computed(() => {
  return props.players.map((_, idx) => {
    let myScore=props.players[idx].displayScore;
    let point=0 // 점수기반
    let oka=(props.option.returnScore*4-props.option.startingScore*4)/1000; // 오카
    let uma=0; // 우마
    let rank = props.players.filter((x, j) => {
      if (x.displayScore > myScore) return true;
      if (props.option.sekiOrder && x.displayScore === myScore && j < idx) return true;
      return false;
    }).length + 1; // 순위
    let cnt = props.option.sekiOrder ? 1 : props.players.filter(x => x.displayScore === myScore).length; // 동점자 수
    for (let i=0;i<cnt;i++) // 동점자의 모든 우마 더하기
      uma+=Number(props.option.rankUma[rank+i-1]);
    if (rank===1){ // 1위라면 오카도 더하기
      uma+=oka;
      if (props.option.riichiPayout) // 1위에게 공탁금을 몰아주는 경우 (100점단위)
        myScore+=Math.floor(((props.panelInfo.riichi*1000)/cnt)/100)*100;
    }
    uma/=cnt; // 동점자 수만큼 우마 나누기
    point=(myScore-props.option.returnScore)/1000+uma;
    let cntRiichi=0, cntWin=0, cntLose=0;
    for (let i=0;i<props.records.riichi.length;i++){
      if (props.records.riichi[i][idx]===true)
        cntRiichi++;
      if (props.records.win[i][idx]===true)
        cntWin++;
      if (props.records.lose[i][idx]===true)
        cntLose++;
    }
    return {
      score: myScore,
      point: point.toFixed(1),
      cntRiichi,
      cntWin,
      cntLose
    };
  });
})

/**점수차트 정보 계산*/
const scoreChartInfo = computed(() => {
  const isDarkTheme = document.documentElement.classList.contains('dark');
  const textColor = isDarkTheme ? '#e5e5e5' : '#1a1a1a';
  const gridColor = isDarkTheme ? '#444444' : '#e8e8e8';

  let datasets=props.players.map((_, idx) => ({
    label: props.players[idx].name, // 이름 가져오기
    data: props.records.score[idx].filter((_, i) => i%2===0), // 점수기록 가져오기)
    borderColor: ['#ff6384', '#4bc0c0', '#36a2eb', '#ffce56'][idx], // 선 색상
    backgroundColor: ['#ff6384', '#4bc0c0', '#36a2eb', '#ffce56'][idx], // 점 색상
    pointRadius: 3, // 점 크기
  }));
  let times=['', ...props.records.time.filter((_, i) => i%2===1)]; // 시간 가져오기
  let tmp='';
  for (let i=1;i<times.length;i++){
    if (tmp==='' || tmp!==times[i][0]+times[i][1]){ // 이전국이랑 다르면
      tmp=times[i][0]+times[i][1]; // 앞 두 글자 저장
      times[i]=tmp;
    }
    else
      times[i]=''; // 같으면 빈 문자열로 변경
  }
  let data={
    labels: times,
    datasets: datasets
  };
  let options: ChartOptions<'line'> = {
    responsive: true, // 반응형
    maintainAspectRatio: false, // 크기조절
    animations: {
      y: {
        from: (ctx) => {
          const yScale = ctx.chart.scales.y;
          return yScale.getPixelForValue(25000); // 애니메이션 시작점 25000
        }
      },
    },
    scales: {
      x: {
        ticks: {
          autoSkip: false, // 모든 라벨 표시
          color: textColor,
        },
        grid: {
          color: gridColor,
        }
      },
      y: {
        ticks: {
          color: textColor,
        },
        grid: {
          color: gridColor,
        }
      }
    },
    plugins: {
      legend: {
        position: 'top',
        labels: {
          usePointStyle: true, // 범례 모양 변경
          pointStyle: 'rectRounded',
          color: textColor,
        }
      },
    },
  };
  return {
    data: data,
    options: options
  };
})

/**토글 버튼 색상*/
const toggleButtonStyle = (status: string) => {
  if (status==='isfao') // 점수창 책임지불 OX
    return {color: props.scoringState.isFao===true ? 'var(--color-toggle-on)' : 'var(--color-toggle-off)'};
  else if (status==='roundmangan') // 유국만관 옵션
    return {color: props.option.roundMangan===true ? 'var(--color-toggle-on)' : 'var(--color-toggle-off)'};
  else if (status==='tobi') // 토비 옵션
    return {color: props.option.tobi===true ? 'var(--color-toggle-on)' : 'var(--color-toggle-off)'};
  else if (status==='cheatscore') // 촌보점수 옵션
    return {color: props.option.cheatScore===true ? 'var(--color-toggle-on)' : 'var(--color-toggle-off)'};
  else if (status==='endriichi') // 공탁처리 옵션
    return {color: props.option.riichiPayout===true ? 'var(--color-toggle-on)' : 'var(--color-toggle-off)'};
  else if (status==='alwaysshowrank') // 등수 상시 표시 옵션
    return {color: props.option.alwaysShowRank===true ? 'var(--color-toggle-on)' : 'var(--color-toggle-off)'};
  else if (status==='sekiorder') // 동점 석순 옵션
    return {color: props.option.sekiOrder===true ? 'var(--color-toggle-on)' : 'var(--color-toggle-off)'};
  else if (status==='isonline') // 싱크 온/오프라인
    return {color: props.googleInfo.isLoggedIn===true ? 'var(--color-online)' : 'var(--color-offline)'};
}

/**주사위 모달창 회전*/
const diceModalTransform = () => {
  return {transform: `translate(-50%, -50%) rotate(${360-props.players.findIndex(player => player.wind==='東')*90}deg)`};
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
    return {color: ''};
}
</script>

<template>
<div class="modal" @click="emit('hide-modal')">
  <!-- 화료 인원 선택창 -->
  <div v-if="modalInfo.type==='check_player_win'" class="modal_content" @click.stop>
    <ModalCheckPlayer
      :players
      :scoringState
      actionType="win"
      @set-arrow-button="(status, idx) => emit('set-arrow-button', status, idx)"
      @check-invalid-status="(status) => emit('check-invalid-status', status)"
    />
  </div>
  <!--방총 인원 선택창 -->
  <div v-else-if="modalInfo.type==='check_player_lose'" class="modal_content" @click.stop>
    <ModalCheckPlayer
      :players
      :scoringState
      actionType="lose"
      @set-arrow-button="(status, idx) => emit('set-arrow-button', status, idx)"
      @check-invalid-status="(status) => emit('check-invalid-status', status)"
    />
  </div>
  <!-- 부/판 선택창 -->
  <div v-else-if="modalInfo.type==='choose_score'" class="modal_content" @click.stop>
    <ModalScoreSelect
      :players
      :scoringState
      :modalInfo
      actionType="fanbu"
      @show-modal="(type, status?) => emit('show-modal', type, status)"
      @set-toggle-button="(status) => emit('set-toggle-button', status)"
      @set-fanbu-button="(status, idx) => emit('set-fanbu-button', status, idx)"
      @calculate-win="emit('calculate-win')"
    />
  </div>
  <!--책임지불 인원 선택창 -->
  <div v-else-if="modalInfo.type==='check_player_fao'" class="modal_content" @click.stop>
    <ModalCheckPlayer
      :players
      :scoringState
      actionType="fao"
      @set-arrow-button="(status, idx) => emit('set-arrow-button', status, idx)"
      @check-invalid-status="(status) => emit('check-invalid-status', status)"
    />
  </div>
  <!-- 책임지불 점수 선택창 -->
  <div v-else-if="modalInfo.type==='choose_score_fao'" class="modal_content" @click.stop>
    <ModalScoreSelect
      :players
      :scoringState
      :modalInfo
      actionType="fao"
      @show-modal="(type, status?) => emit('show-modal', type, status)"
      @set-toggle-button="(status) => emit('set-toggle-button', status)"
      @set-fanbu-button="(status, idx) => emit('set-fanbu-button', status, idx)"
      @calculate-win="emit('calculate-win')"
    />
  </div>
  <!-- 유국 종류 선택창 -->
  <div v-else-if="modalInfo.type==='choose_draw_kind'" class="modal_content" @click.stop>
    <ModalChooseDraw
      @show-modal="(type, status?) => emit('show-modal', type, status)"
    />
  </div>
  <!-- 텐파이 인원 선택창 -->
  <div v-else-if="modalInfo.type==='check_player_tenpai'" class="modal_content" @click.stop>
    <ModalCheckPlayer
      :players
      :scoringState
      actionType="tenpai"
      @set-arrow-button="(status, idx) => emit('set-arrow-button', status, idx)"
      @check-invalid-status="(status) => emit('check-invalid-status', status)"
      @go-to-nagashi="emit('show-modal', 'check_player_nagashi')"
    />
  </div>
  <!-- 유국만관 인원 선택창 -->
  <div v-else-if="modalInfo.type==='check_player_nagashi'" class="modal_content" @click.stop>
    <ModalCheckPlayer
      :players
      :scoringState
      actionType="nagashi"
      @set-arrow-button="(status, idx) => emit('set-arrow-button', status, idx)"
      @check-invalid-status="(status) => emit('check-invalid-status', status)"
      @go-back-to-tenpai="emit('show-modal', 'check_player_tenpai')"
    />
  </div>
  <!-- 촌보 인원 선택창 -->
  <div v-else-if="modalInfo.type==='check_player_cheat'" class="modal_content" @click.stop>
    <ModalCheckPlayer
      :players
      :scoringState
      actionType="cheat"
      @set-arrow-button="(status, idx) => emit('set-arrow-button', status, idx)"
      @check-invalid-status="(status) => emit('check-invalid-status', status)"
    />
  </div>
  <!-- 점수 확인창 -->
  <div v-else-if="modalInfo.type==='show_score'" class="modal_content" style="border-radius:50%;" @click.stop>
    <ModalScoreResult
      :players
      @save-round="emit('save-round')"
    />
  </div>
  <!-- 주사위 굴림창 -->
  <div v-else-if="modalInfo.type==='roll_dice'" class="modal_content" :style="diceModalTransform()" @click.stop>
    <ModalDice
      :dice
      @roll-dice="emit('roll-dice')"
    />
  </div>
  <!-- 동남서북 선택창 -->
  <div v-else-if="modalInfo.type==='choose_seat'" class="modal_content" @click.stop>
    <ModalTile
      :seatTile
      :googleInfo
      :players
      :todayGamesHistory="todayGamesHistory"
      @start-game-with-seats="(assignment) => emit('start-game-with-seats', assignment)"
      @add-new-member="(name) => emit('add-new-member', name)"
      @save-today-members="(names) => emit('save-today-members', names)"
    />
  </div>
  <!-- 메뉴 선택창 -->
  <div v-else-if="modalInfo.type==='choose_menu_kind'" class="modal_content" @click.stop>
    <ModalChooseMenu
      @show-modal="(type, status) => emit('show-modal', type, status)"
      @start-new-game="emit('start-new-game')"
    />
  </div>
  <!-- 게임 결과창(표) -->
  <div v-else-if="modalInfo.type==='result_sheet'" class="modal_content" @click.stop>
    <div style="display: flex; flex-direction: column; align-items: stretch; gap: 10px;">
      <div class="container_resultsheet" @click.stop="emit('show-modal', 'result_chart')">
        <div v-for="(_, i) in class_resultsheet" 
          :key="i"
          :class="class_resultsheet[i]"
          style="font-weight: bold;"
        >
          {{ t(arr_resultsheet[i]) }}
        </div>
        <div style="grid-area: wind_contents;">
          <div v-for="(_, i) in arr_wind" :key="i">{{ arr_wind[i] }}</div>
        </div>
        <div style="grid-area: name_contents;">
          <div v-for="(_, i) in players" :key="i">{{ players[i].name.length > 5 ? players[i].name.substring(0, 4) : players[i].name }}<span v-if="players[i].name.length > 5" style="vertical-align: bottom; line-height: 0.8; display: inline-block; transform: translateY(0.1em);">…</span></div>
        </div>
        <div style="grid-area: score_contents;">
          <div v-for="(_, i) in scoreSheetInfo" :key="i">
          {{ scoreSheetInfo[i].score }}(<span :style="getSignColor(Number(scoreSheetInfo[i].point), false)"><span v-show="Number(scoreSheetInfo[i].point)>0">+</span>{{ scoreSheetInfo[i].point }}</span>)
          </div>
        </div>
        <div style="grid-area: riichi_contents;">
          <div v-for="(_, i) in scoreSheetInfo" :key="i">{{ scoreSheetInfo[i].cntRiichi }}</div>
        </div>
        <div style="grid-area: win_contents;">
          <div v-for="(_, i) in scoreSheetInfo" :key="i">{{ scoreSheetInfo[i].cntWin }}</div>
        </div>
        <div style="grid-area: lose_contents;">
          <div v-for="(_, i) in scoreSheetInfo" :key="i">{{ scoreSheetInfo[i].cntLose }}</div>
        </div>
      </div>
      <button 
        @click.stop="isGameSaved ? null : emit('save-game-to-sheet')"
        :disabled="isGameSaved"
        :style="{
          margin: '0 5px',
          padding: '8px',
          fontSize: '16px',
          fontWeight: 'bold',
          backgroundColor: isGameSaved ? 'var(--border-color)' : '#4285f4',
          color: isGameSaved ? 'var(--text-color)' : 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: isGameSaved ? 'default' : 'pointer',
          opacity: isGameSaved ? '0.6' : '1.0',
          transition: 'opacity 0.2s, background-color 0.2s'
        }"
        onmouseover="if(!this.disabled) this.style.opacity='0.9'"
        onmouseout="if(!this.disabled) this.style.opacity='1.0'"
      >
        {{ isGameSaved ? '기록 완료됨' : (googleInfo.syncMode === 'google' ? '구글 스프레드시트에 결과 기록하기' : '결과 기록하기') }}
      </button>
      <button 
        @click.stop="emit('start-new-game', true)"
        style="margin: 0 5px; padding: 8px; font-size: 16px; font-weight: bold; background-color: var(--color-toggle-on); color: white; border: none; border-radius: 4px; cursor: pointer; transition: opacity 0.2s;"
        onmouseover="this.style.opacity='0.9'"
        onmouseout="this.style.opacity='1.0'"
      >
        새 게임 시작하기
      </button>
    </div>
  </div>
  <!-- 게임 결과창(차트) -->
  <div v-else-if="modalInfo.type==='result_chart'" class="modal_content" @click.stop>
    <div class="container_resultchart" @click.stop="emit('show-modal', 'result_sheet')">
      <LineChart :data="scoreChartInfo.data" :options="scoreChartInfo.options"/>
    </div>
  </div>
  <!-- 점수 기록창 -->
  <div v-else-if="modalInfo.type==='show_record'" class="modal_content" @click.stop>
    <ModalRecordList
      :players
      :records
      @show-modal="(type, status?) => emit('show-modal', type, status)"
      @copy-record="emit('copy-record')"
    />
  </div>
  <!-- 총 우마 & 성적 모아보기창 -->
  <div v-else-if="modalInfo.type==='total_uma'" class="modal_content" @click.stop>
    <ModalTotalUma
      :todayMembers="googleInfo.todayMembers"
      :players="players"
      :history="todayGamesHistory"
      @invalidate-game="(idx) => emit('invalidate-game', idx)"
    />
  </div>
  <!-- 점수 롤백창 -->
  <div v-else-if="modalInfo.type==='rollback_record'" class="modal_content" @click.stop>
    <ModalRollback
      :records
      :modalInfo
      @rollback-record="(time) => emit('rollback-record', time)"
    />
  </div>
  <!-- 설정 창 -->
  <div v-else-if="modalInfo.type==='set_options'" class="modal_content" @click.stop>
    <div style="display: flex; flex-direction: column; align-items: center; gap: 12px; width: 100%;">
      <div class="container_option">
        <div
          v-for="(_, i) in arr_seat"
          :key="i"
          :style="`grid-area: input_name${i};`"
        >
          {{ arr_wind[i] }}({{ t(arr_seat[i]) }})<br>
          <input
            type="text"
            maxlength="4"
            v-model="players[i].name"
            :placeholder="t('option.name', {idx:i+1})"
            :name="`name${i+1}`"
          >
        </div>
        <div style="grid-area: option0;">
          {{ t('option.startingScore') }}<br>
          <input 
            type="number"
            v-model="option.startingScore"
            :placeholder="String(25000)"
            :name="'startingScore'"
          >
        </div>
        <div style="grid-area: option1;">
          {{ t('option.returnScore') }}<br>
          <input 
            type="number"
            v-model="option.returnScore"
            :placeholder="String(30000)"
            :name="'returnScore'"
          >
        </div>
        <div style="grid-area: option2;" @click.stop="emit('set-toggle-button', 'roundmangan')">
          {{ t('option.roundMangan') }}<br>
          <span :style="toggleButtonStyle('roundmangan')">
            <span v-show="option.roundMangan===true">O</span>
            <span v-show="option.roundMangan===false">X</span>
          </span>
        </div>
        <div style="grid-area: option3;" @click.stop="emit('set-toggle-button', 'tobi')">
          {{ t('option.tobi') }}<br>
          <span :style="toggleButtonStyle('tobi')">
            <span v-show="option.tobi===true">O</span>
            <span v-show="option.tobi===false">X</span>
          </span>
        </div>
        <div style="grid-area: option4;">
          {{ t('option.rankUma') }} (1-2-3-4)<br>
          <input
            v-for="(_, i) in option.rankUma"
            :key="i"
            style="width: 51px;"
            type="number"
            v-model="option.rankUma[i]"
            :placeholder="t('option.rank', {idx:i+1})"
            :name="`uma${i+1}`"
            :style="{ marginRight: i===option.rankUma.length-1 ? '0px' : '10px' }"
          >
        </div>  
        <div style="grid-area: option5;" @click.stop="emit('set-toggle-button', 'cheatscore')">
          {{ t('option.cheatScore') }}<br>
          <span :style="toggleButtonStyle('cheatscore')">
            <span v-show="option.cheatScore===true">{{ t('option.mangan') }}</span>
            <span v-show="option.cheatScore===false">3000 All</span>
          </span>
        </div>
        <div style="grid-area: option6;" @click.stop="emit('set-toggle-button', 'endriichi')">
          {{ t('option.riichiPayout') }}<br>
          <span :style="toggleButtonStyle('endriichi')">
            <span v-show="option.riichiPayout===true">{{ t('option.firstPlace') }}</span>
            <span v-show="option.riichiPayout===false">X</span>
          </span>
        </div>
        <div style="grid-area: option7;" @click.stop="emit('set-toggle-button', 'alwaysshowrank')">
          {{ t('option.alwaysShowRank') }}<br>
          <span :style="toggleButtonStyle('alwaysshowrank')">
            <span v-show="option.alwaysShowRank===true">O</span>
            <span v-show="option.alwaysShowRank===false">X</span>
          </span>
        </div>
        <div style="grid-area: option8;" @click.stop="emit('set-toggle-button', 'sekiorder')">
          {{ t('option.sekiOrder') }}<br>
          <span :style="toggleButtonStyle('sekiorder')">
            <span v-show="option.sekiOrder===true">O</span>
            <span v-show="option.sekiOrder===false">X</span>
          </span>
        </div>
      </div>
      <button 
        @click.stop="emit('start-new-day')"
        style="width: calc(100% - 10px); padding: 8px; margin-bottom: 5px; font-size: 15px; font-weight: bold; background-color: transparent; color: var(--color-negative); border: 2px solid var(--color-negative); border-radius: 4px; cursor: pointer; transition: background-color 0.2s, color 0.2s;"
        onmouseover="this.style.backgroundColor='var(--color-negative)'; this.style.color='white';"
        onmouseout="this.style.backgroundColor='transparent'; this.style.color='var(--color-negative)';"
      >
        새로운 날 시작 (이전 기록 초기화)
      </button>
      <button 
        @click.stop="emit('start-new-game')"
        style="width: calc(100% - 10px); padding: 8px; margin-bottom: 5px; font-size: 15px; font-weight: bold; background-color: var(--color-negative); color: white; border: none; border-radius: 4px; cursor: pointer; transition: opacity 0.2s;"
        onmouseover="this.style.opacity='0.9'"
        onmouseout="this.style.opacity='1.0'"
      >
        새 게임 시작하기 (초기화)
      </button>
    </div>
  </div>
  <!-- 동기화 창 -->
  <div v-else-if="modalInfo.type==='sync'" class="modal_content" @click.stop>
    <div class="container_google_sync">
      <h3 style="font-size: 18px; margin-bottom: 10px;">대국 동기화 설정</h3>
      
      <!-- 연동 모드 선택기 -->
      <div class="sync_mode_selector" style="display: flex; gap: 15px; justify-content: center; margin-bottom: 15px;">
        <label style="font-size: 14px; font-weight: bold; cursor: pointer;">
          <input type="radio" value="local" v-model="googleInfo.syncMode" @change="emit('save-google-settings')" /> 로컬 모드
        </label>
        <label style="font-size: 14px; font-weight: bold; cursor: pointer;">
          <input type="radio" value="google" v-model="googleInfo.syncMode" @change="emit('save-google-settings')" /> 구글 연동
        </label>
      </div>

      <div class="login_status">
        <span class="status_indicator" :style="{ backgroundColor: googleInfo.isLoggedIn ? 'var(--color-online)' : 'var(--color-offline)' }"></span>
        <span style="font-size: 15px;">{{ googleInfo.isLoggedIn ? '구글 로그인 완료' : '구글 오프라인' }}</span>
      </div>
      
      <div class="sync_fields">
        <div class="input_group">
          <label>Google OAuth Client ID</label>
          <input 
            type="text" 
            v-model="googleInfo.clientId" 
            placeholder="Client ID 입력"
            @change="emit('save-google-settings')"
            style="width: 250px; font-size: 14px;"
          />
        </div>
        <div class="input_group">
          <label>Spreadsheet ID</label>
          <input 
            type="text" 
            v-model="googleInfo.spreadsheetId" 
            placeholder="스프레드시트 ID 입력"
            @change="emit('save-google-settings')"
            style="width: 250px; font-size: 14px;"
          />
        </div>
      </div>

      <div class="action_buttons" style="margin-top: 15px; display: flex; flex-direction: column; gap: 8px;">
        <button 
          v-if="googleInfo.isLoggedIn && googleInfo.spreadsheetId" 
          @click.stop="emit('sync-local-to-google')" 
          style="width: 100%; padding: 8px; font-size: 14px; font-weight: bold; background-color: var(--color-toggle-on); color: white; border: none; border-radius: 4px; cursor: pointer; transition: opacity 0.2s;"
          onmouseover="this.style.opacity='0.9'"
          onmouseout="this.style.opacity='1.0'"
        >
          로컬 점수 구글 시트에 일괄 동기화
        </button>
        <button v-if="!googleInfo.isLoggedIn" @click.stop="emit('google-login')" class="btn_g_login">
          구글 로그인
        </button>
        <button v-else @click.stop="emit('google-logout')" class="btn_g_logout">
          로그아웃
        </button>
      </div>
    </div>
  </div>
  <!-- 메시지 팝업창 -->
  <div v-else class="modal_content" @click.stop>
    <div class="modal_text">{{ modalInfo.type }}</div>
  </div>
</div>
</template>

<style scoped>
/* 기본 모달창 */
.modal {
  position: fixed;
  z-index: 5;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  overflow: auto;
  background-color: var(--modal-overlay);
  transition: background-color 0.3s ease;
}
.modal_content {
  background-color: var(--modal-bg-color);
  color: var(--text-color);
  border: 1px solid var(--border-color);
  position: fixed;
  text-align: center;
  white-space: nowrap;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: auto;
  height: auto;
  padding: 5px;
  z-index: 10;
  transition: background-color 0.3s ease, color 0.3s ease, border-color 0.3s ease;
}

/* 메시지 팝업창 */
.modal_text{
  font-size: 20px;
  margin: 20px;
}

.container_option{
  display: grid;
  grid-template-rows: repeat(4, 60px);
  grid-template-columns: repeat(4, 120px);
  grid-template-areas:
  'input_name0 input_name1 input_name2 input_name3'
  'option0 option1 option2 option3'
  'option4 option4 option5 option6'
  'option7 option7 option8 option8';
  text-align: center;
  font-size: 20px;
  gap: 10px;
  margin: 5px;
  
  max-height: 200px;
  overflow-y: scroll !important;
  padding-right: 8px;
  box-sizing: border-box;
}

/* 설정 창 스크롤바 스타일 */
.container_option::-webkit-scrollbar {
  width: 8px;
  display: block !important;
}
.container_option::-webkit-scrollbar-track {
  background: var(--bg-stripe-dark);
  border-radius: 4px;
}
.container_option::-webkit-scrollbar-thumb {
  background: #888888;
  border: 2px solid var(--bg-stripe-dark);
  border-radius: 4px;
}
.container_option::-webkit-scrollbar-thumb:hover {
  background: var(--color-toggle-on);
}
.container_option {
  scrollbar-width: thin;
  scrollbar-color: #888888 var(--bg-stripe-dark);
}

/* 게임 결과창(표)*/
.container_resultsheet{
  display: grid;
  grid-template-rows: repeat(2, auto);
  grid-template-columns: 60px minmax(100px, max-content) minmax(150px, max-content) repeat(3, 60px);
  grid-template-areas:
  'wind name score riichi win lose'
  'wind_contents name_contents score_contents riichi_contents win_contents lose_contents';
  text-align: center;
  font-size: 20px;
  margin: 5px;
}
.container_resultsheet div{
  border-top: 1px solid var(--border-color);
  border-bottom: 1px solid var(--border-color);
  transition: border-color 0.3s ease;
  white-space: nowrap;
}

/* 게임 결과창(차트)*/
.container_resultchart{
  width: 490px;
  height: 240px;
  margin: 5px;
}

/* 구글 연동창 */
.container_google_sync {
  padding: 10px;
  width: 280px;
  text-align: center;
}
.login_status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 5px;
  margin-bottom: 15px;
}
.status_indicator {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  display: inline-block;
}
.sync_fields {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.input_group {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}
.input_group label {
  font-size: 12px;
  color: var(--text-dimmed);
}
.btn_g_login, .btn_g_logout {
  width: 100%;
  padding: 8px;
  font-size: 16px;
  font-weight: bold;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  color: #fff;
  transition: opacity 0.2s;
}
.btn_g_login {
  background-color: #4285f4;
}
.btn_g_logout {
  background-color: var(--color-negative);
}
.btn_g_login:hover, .btn_g_logout:hover {
  opacity: 0.9;
}
</style>