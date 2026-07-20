<script setup lang="ts">
import type { SeatTile, GoogleInfo, Player } from "@/types/types.d"
import { ref, computed, onMounted, watch } from "vue"
import { secureShuffle } from "@/utils/random"

/**props 정의*/
interface Props {
  seatTile: SeatTile,
  googleInfo: GoogleInfo,
  players?: Player[],
  todayGamesHistory?: any[],
  newlyAddedLocalMembers?: string[],
  showConfirm: (message: string) => Promise<boolean>
}
const props = defineProps<Props>()

/**emits 정의*/
type Emits = {
  (e: 'start-game-with-seats', assignment: Record<string, string>): void,
  (e: 'add-new-member', name: string): void,
  (e: 'delete-member', name: string): void,
  (e: 'save-today-members', names: string[]): void,
  (e: 'google-login'): void,
  (e: 'google-logout'): void
}
const emit = defineEmits<Emits>()

const currentStep = ref<'setup_today_pool' | 'select_match_4' | 'draw_seats'>('setup_today_pool')

const handleToggleConnection = async () => {
  if (props.googleInfo.isLoggedIn) {
    if (await props.showConfirm("구글 계정 로그아웃을 진행하시겠습니까? (로컬 모드로 전환됩니다)")) {
      emit('google-logout')
    }
  } else {
    emit('google-login')
  }
}

// 1단계: 오늘의 멤버 풀
const tempTodayMembers = ref<string[]>([])
const newMemberName = ref('') 

// 로컬 모드용 빈 멤버 풀 (새로운 날 시작 시 직접 수동 등록)
const offlineMemberList = ref<string[]>([])

// 2단계: 이번 게임 4인 선택
const selected4Names = ref<string[]>([])

// 3단계: 자리 뽑기 상태
const activePlayerIndex = ref<number | null>(null) 
const assignment = ref<Record<string, string>>({}) 
const playerAssignedWind = ref<Record<string, string>>({}) 
const openedTiles = ref<boolean[]>([false, false, false, false]) 
const randomizedTiles = ref<string[]>([])
const animateLayout = ref(false) 

const displayMemberList = computed(() => {
  if (props.googleInfo.isLoggedIn) {
    return props.googleInfo.memberList || []
  }
  return offlineMemberList.value
})

const isManualPlacement = ref(false)

watch(isManualPlacement, (newVal) => {
  if (newVal) {
    openedTiles.value = [true, true, true, true]
  } else {
    // 배정된 타일만 뒤집힌 상태 유지, 미배정 타일은 덮기
    const nextOpened = [false, false, false, false]
    for (let i = 0; i < 4; i++) {
      const wind = randomizedTiles.value[i]
      if (assignment.value[wind]) {
        nextOpened[i] = true
      }
    }
    openedTiles.value = nextOpened
  }
})

onMounted(() => {
  shuffleTiles()
  
  // 모바일 브라우저 주소창 자동 숨김을 위해 로드 후 1회 강제 1px 스크롤
  setTimeout(() => {
    window.scrollTo(0, 1)
  }, 300)
  
  if (props.googleInfo.todayMembers && props.googleInfo.todayMembers.length > 0) {
    tempTodayMembers.value = [...props.googleInfo.todayMembers]
    // 만약 오프라인 로컬 목록이 비어있다면, 로드한 todayMembers를 offlineMemberList에 넣어 보존함
    if (!props.googleInfo.isLoggedIn && offlineMemberList.value.length === 0) {
      offlineMemberList.value = [...props.googleInfo.todayMembers]
    }
    currentStep.value = 'select_match_4'
  }

  // 이전 게임에 참여했던 4명의 이름으로 체크 초기화
  if (props.players && props.players.length === 4) {
    const prevNames = props.players.map(p => p.name);
    const defaultNames = ['▼', '▶', '▲', '◀'];
    const hasRealPlayers = prevNames.some(name => !defaultNames.includes(name));
    if (hasRealPlayers) {
      selected4Names.value = prevNames.filter(name => 
        !defaultNames.includes(name) && tempTodayMembers.value.includes(name)
      );
    }
  }
})

watch(() => props.googleInfo.todayMembers, (newVal) => {
  if (newVal && newVal.length > 0) {
    tempTodayMembers.value = [...newVal]
    if (!props.googleInfo.isLoggedIn) {
      offlineMemberList.value = [...newVal]
    }
    // 복원 데이터 유입 시, 멤버 선택 2단계로 즉시 분기 스위칭!
    currentStep.value = 'select_match_4'
  }
}, { deep: true })

// 오늘의 멤버 풀이 변경되면 이번 판 4인 선택 중 풀에서 탈락한 멤버만 제거
watch(tempTodayMembers, (newPool) => {
  selected4Names.value = selected4Names.value.filter(name => newPool.includes(name))
}, { deep: true })

const shuffleTiles = () => {
  const tiles = ['東', '南', '西', '北']
  randomizedTiles.value = secureShuffle(tiles)
}

const hasPlayedGame = (name: string) => {
  if (!props.todayGamesHistory) return false
  return props.todayGamesHistory.some((game: any) => 
    game.results && game.results.some((r: any) => r.name === name)
  )
}

const toggleTodayMember = (name: string) => {
  const index = tempTodayMembers.value.indexOf(name)
  if (index > -1) {
    if (hasPlayedGame(name)) {
      alert(`'${name}'님은 오늘 플레이한 기록이 있어 풀에서 제외할 수 없습니다. (우선 '총 우마' 페이지에서 해당 플레이어가 포함된 회전을 무효 처리해야 합니다.)`)
      return
    }
    tempTodayMembers.value.splice(index, 1)
  } else {
    tempTodayMembers.value.push(name)
  }
}

// 멤버 추가 (온라인: 시트 추가, 오프라인: 로컬 풀 추가)
const handleAddNewMember = () => {
  const name = newMemberName.value.trim()
  if (!name) return
  
  // 기존 멤버인 경우: 오늘의 멤버(tempTodayMembers)에 즉시 추가(클릭된 효과)
  if (displayMemberList.value.includes(name)) {
    if (!tempTodayMembers.value.includes(name)) {
      tempTodayMembers.value.push(name)
    }
    newMemberName.value = ''
    return
  }
  // 신규 멤버인 경우: 신규 등록 진행 (로그인 상태 여부와 관계없이 이벤트를 송출하여 로컬 스토리지에 보존)
  emit('add-new-member', name)
  if (!props.googleInfo.isLoggedIn) {
    offlineMemberList.value.push(name)
  }
  
  if (!tempTodayMembers.value.includes(name)) {
    tempTodayMembers.value.push(name)
  }
  newMemberName.value = ''
}

// 전체 명단에서 멤버 제거 기능
const removeLocalMember = async (name: string) => {
  if (hasPlayedGame(name)) {
    alert(`'${name}'님은 오늘 플레이한 기록이 있어 전체 명단에서 삭제할 수 없습니다. (우선 '총 우마' 페이지에서 해당 플레이어가 포함된 회전을 무효 처리해야 합니다.)`)
    return
  }
  
  if (!await props.showConfirm(`'${name}'님을 전체 명단에서 완전히 삭제하시겠습니까?`)) {
    return
  }

  // 1. 오늘의 참가 풀에서 우선 제거
  const tIdx = tempTodayMembers.value.indexOf(name)
  if (tIdx > -1) {
    tempTodayMembers.value.splice(tIdx, 1)
  }

  // 2. 부모 컴포넌트에 이벤트를 전송하여 명단 데이터(스토리지/구글 시트) 동기화
  emit('delete-member', name)
  if (!props.googleInfo.isLoggedIn) {
    // 오프라인 로컬 전체 명단에서 삭제
    const idx = offlineMemberList.value.indexOf(name)
    if (idx > -1) {
      offlineMemberList.value.splice(idx, 1)
    }
  }
}

const handleSaveTodayPool = () => {
  if (tempTodayMembers.value.length < 4) {
    alert("멤버를 최소 4명 이상 선택해 주세요.")
    return
  }
  emit('save-today-members', tempTodayMembers.value)
  currentStep.value = 'select_match_4'
}

const toggleMatchPlayer = (name: string) => {
  const index = selected4Names.value.indexOf(name)
  if (index > -1) {
    selected4Names.value.splice(index, 1)
  } else {
    if (selected4Names.value.length < 4) {
      selected4Names.value.push(name)
    }
  }
}

const windColors: Record<string, { bg: string, border: string, text: string, rgb: string }> = {
  '東': { bg: '#ff1744', border: '#b2002d', text: '#ffffff', rgb: '255, 23, 68' },   // 빨강
  '南': { bg: '#ffd600', border: '#c7a700', text: '#111827', rgb: '255, 214, 0' },   // 노랑
  '西': { bg: '#00e676', border: '#00b248', text: '#111827', rgb: '0, 230, 118' },   // 초록
  '北': { bg: '#2979ff', border: '#004ecb', text: '#ffffff', rgb: '41, 121, 255' }    // 파랑
}

const getPlayerCardStyle = (idx: number, name: string) => {
  const wind = playerAssignedWind.value[name]
  
  // 1. 포커싱된 상태
  if (activePlayerIndex.value === idx) {
    if (wind) {
      // 이미 방위가 결정된 상태로 포커싱됨 (자동 선택 혹은 뒤집힌 후) -> 해당 방위의 솔리드 원색 적용
      const color = windColors[wind]
      return {
        backgroundColor: color.bg,
        borderColor: color.border,
        color: color.text,
        boxShadow: `0 0 12px rgba(${color.rgb}, 0.8)`
      }
    } else {
      // 방위 선택 전 대기 포커싱 -> 중립적인 강한 하이라이트 (연두색 테두리 광원)
      return {
        backgroundColor: 'var(--input-bg-color)',
        borderColor: 'var(--color-toggle-on)',
        color: 'var(--text-color)',
        boxShadow: '0 0 12px var(--color-toggle-on)'
      }
    }
  }
  
  // 2. 배정 완료된 상태
  if (wind) {
    const color = windColors[wind]
    const hasGlow = animateLayout.value // 전체 배치 완료 시에만 은은한 광원 효과 점등
    return {
      backgroundColor: color.bg,
      borderColor: color.border,
      color: color.text,
      opacity: 1, // 비활성화 된 것처럼 옅어지는 현상 차단
      boxShadow: hasGlow ? `0 0 12px 2px rgba(${color.rgb}, 0.7)` : 'none'
    }
  }
  return {}
}

const getTileBackStyle = (tileIdx: number) => {
  const wind = randomizedTiles.value[tileIdx]
  const playerName = assignment.value[wind]
  if (!playerName) return {}
  
  const pIdx = selected4Names.value.indexOf(playerName)
  if (pIdx === -1) return {}
  
  const color = windColors[wind]
  return {
    backgroundColor: color.bg,
    borderColor: color.border,
    color: color.text,
    boxShadow: `0 2px 6px rgba(${color.rgb}, 0.4)`
  }
}

// 자리 뽑기 화면 진입 시 초기화 로직

const proceedToDrawSeats = () => {
  if (selected4Names.value.length !== 4) return
  
  activePlayerIndex.value = null // 시작 시 아무도 포커싱되지 않은 상태로 설정
  assignment.value = {}
  playerAssignedWind.value = {}
  openedTiles.value = [false, false, false, false]
  animateLayout.value = false // 레이아웃 정렬 애니메이션 상태 초기화
  isManualPlacement.value = false // 수동 배치 체크 리셋
  shuffleTiles()
  
  currentStep.value = 'draw_seats'
}

const selectPlayer = (idx: number) => {
  const name = selected4Names.value[idx]
  if (playerAssignedWind.value[name]) return
  activePlayerIndex.value = idx
}

const isAutoDrawing = ref(false)

const flipTile = (tileIdx: number) => {
  if (activePlayerIndex.value === null || isAutoDrawing.value) return 
  
  const wind = randomizedTiles.value[tileIdx]
  
  // 일반 모드일 때 이미 뒤집힌 타일이면 무시
  if (!isManualPlacement.value && openedTiles.value[tileIdx]) return
  
  // 수동 직접배치 모드일 때 이미 배정된 방위면 무시
  if (isManualPlacement.value && assignment.value[wind]) return

  const playerName = selected4Names.value[activePlayerIndex.value]

  openedTiles.value[tileIdx] = true
  assignment.value[wind] = playerName
  playerAssignedWind.value[playerName] = wind

  // 수동 선택 시에는 다음 닉네임으로 자동 포커싱을 하지 않고 포커스를 해제(null)합니다.
  activePlayerIndex.value = null

  // 4인이 모두 수동 선택 완료되면 0.8초의 정지 시간(Gap)을 가진 뒤, 레이아웃 정렬 기동
  if (Object.keys(playerAssignedWind.value).length === 4) {
    setTimeout(() => {
      animateLayout.value = true
    }, 800)
  }
}

const isAssignmentComplete = computed(() => {
  return Object.keys(playerAssignedWind.value).length === 4
})

const getTileTranslation = (tileIdx: number) => {
  if (!animateLayout.value) return 'translateX(0px)'
  
  const wind = randomizedTiles.value[tileIdx]
  const playerName = assignment.value[wind]
  if (!playerName) return 'translateX(0px)'
  
  const pIdx = selected4Names.value.indexOf(playerName)
  if (pIdx === -1) return 'translateX(0px)'
  
  // 4열 매칭 가로 활공 거리 계산: (대상 플레이어열 - 원래 타일열) * (100% 열너비 + 8px grid gap)
  return `translateX(calc(${pIdx - tileIdx} * (100% + 8px)))`
}

const drawAllAtOnce = () => {
  if (isAutoDrawing.value) return
  isAutoDrawing.value = true

  // 1. 초기 셔플 및 상태 리셋 (아무도 하이라이트 되지 않음)
  shuffleTiles()
  assignment.value = {}
  playerAssignedWind.value = {}
  openedTiles.value = [false, false, false, false]
  activePlayerIndex.value = null
  animateLayout.value = false // 레이아웃 슬라이드 상태 리셋

  // 4개 타일을 임의 순서로 뒤집어 가속 교차 슬라이드 연출
  const drawOrder = secureShuffle([0, 1, 2, 3])

  // 2. 0.5초 간격으로 4명 순차적 배정 시작
  let step = 0
  const nextStep = () => {
    if (step < 4) {
      setTimeout(() => {
        const tileIdx = drawOrder[step]
        const playerName = selected4Names.value[step]
        const wind = randomizedTiles.value[tileIdx]

        // 닉네임 하이라이트 불 들어오는 것과 동시에 자리 패가 뒤집힘
        activePlayerIndex.value = step
        openedTiles.value[tileIdx] = true
        assignment.value[wind] = playerName
        playerAssignedWind.value[playerName] = wind

        step++
        if (step === 4) {
          // 마지막 주자까지 뽑힌 후 0.5초 대기했다가 하이라이트 정리
          setTimeout(() => {
            activePlayerIndex.value = null
            isAutoDrawing.value = false
            
            // 모든 뒤집기 및 하이라이트 해제 후, 뽑는 간격(500ms~600ms)만큼의 여유를 둔 뒤 레이아웃 슬라이드 기동
            setTimeout(() => {
              animateLayout.value = true
            }, 600)
          }, 500)
        } else {
          nextStep()
        }
      }, 500)
    }
  }

  nextStep()
}

const startGame = () => {
  if (!isAssignmentComplete.value) return
  emit('start-game-with-seats', assignment.value)
}
</script>

<template>
<div class="modal_tile_wrapper">
  <!-- 1단계: 오늘의 멤버 설정 -->
  <div v-if="currentStep === 'setup_today_pool'" class="step_section">
    <div class="step_header">
      <span class="step_indicator">1 / 3 단계</span>
      <h3 class="step_title">오늘의 멤버 설정</h3>
      <div class="connection_status" @click="handleToggleConnection" title="클릭하여 로그인/로그아웃">
        <span v-if="googleInfo.isLoggedIn" class="status_text">
          <span class="status_dot green"></span> 연동 모드
        </span>
        <span v-else class="status_text">
          <span class="status_dot gray"></span> 로컬 모드
        </span>
      </div>
    </div>

    <div class="add_member_bar" style="position: relative;">
      <input 
        type="text" 
        v-model="newMemberName" 
        placeholder="멤버 등록" 
        @keyup.enter="handleAddNewMember"
        maxlength="20"
        autocomplete="off"
      />
      <button @click="handleAddNewMember" class="btn_add">추가</button>
    </div>

    <!-- 통합 멤버 명단 체크박스 -->
    <div v-if="displayMemberList.length > 0" class="member_grid horizontal-3row-scroll">
      <div 
        v-for="(name, i) in displayMemberList" 
        :key="i"
        class="grid_member_item"
        :class="{ active: tempTodayMembers.includes(name) }"
        @click="toggleTodayMember(name)"
        style="position: relative;"
      >
        <span v-show="tempTodayMembers.includes(name)" style="margin-right: 4px;">✓</span>
        <span>{{ name.length > 5 ? name.substring(0, 4) : name }}<span v-if="name.length > 5" style="vertical-align: bottom; line-height: 0.8; display: inline-block; transform: translateY(0.1em);">…</span></span>
        
        <!-- 개별 멤버 삭제 버튼 (오늘 참가 대국 기록이 없으며, 오프라인 모드이거나 새로 가입한 로컬 임시 멤버일 때만 노출) -->
        <span 
          v-if="!hasPlayedGame(name) && (!googleInfo.isLoggedIn || (newlyAddedLocalMembers && newlyAddedLocalMembers.includes(name)))"
          @click.stop="removeLocalMember(name)" 
          class="btn_delete_member"
        >
          ✕
        </span>
      </div>
    </div>
    
    <!-- 비어있을 때 정중앙 정렬 전용 안내창 -->
    <div v-else class="empty_checklist_container">
      등록된 멤버가 없습니다.<br>새 이름을 입력하고 추가 버튼을 누르세요.
    </div>

    <div class="helper_text">
      선택됨: {{ tempTodayMembers.length }}명
    </div>

    <button 
      class="btn_proceed" 
      :disabled="tempTodayMembers.length < 4"
      @click="handleSaveTodayPool"
    >
      멤버 풀 저장 ➔
    </button>
  </div>

  <!-- 2단계: 이번 판 4명 선택 -->
  <div v-else-if="currentStep === 'select_match_4'" class="step_section">
    <div class="step_header">
      <span class="step_indicator">2 / 3 단계</span>
      <h3 class="step_title">이번 판 4명 선택</h3>
    </div>

    <div class="member_grid scrollable_picker">
      <div 
        v-for="(name, i) in tempTodayMembers" 
        :key="i"
        class="grid_member_item"
        :class="{ active: selected4Names.includes(name) }"
        @click="toggleMatchPlayer(name)"
      >
        <span v-show="selected4Names.includes(name)" style="margin-right: 4px;">✓</span>
        <span>{{ name.length > 5 ? name.substring(0, 4) : name }}<span v-if="name.length > 5" style="vertical-align: bottom; line-height: 0.8; display: inline-block; transform: translateY(0.1em);">…</span></span>
      </div>
    </div>

    <div class="helper_text">
      선택 완료: {{ selected4Names.length }} / 4 명
    </div>

    <div class="button_group_row">
      <button class="btn_back" @click="currentStep = 'setup_today_pool'">
        ⇠ 풀 편집
      </button>
      <button 
        class="btn_proceed" 
        :disabled="selected4Names.length !== 4"
        @click="proceedToDrawSeats"
      >
        자리 뽑기 ➔
      </button>
    </div>
  </div>

  <!-- 3단계: 자리 뽑기 -->
  <div v-else class="step_section">
    <div class="step_header">
      <span class="step_indicator">3 / 3 단계</span>
      <h3 class="step_title">
        {{ isAutoDrawing ? '자리 지정 중...' : (isAssignmentComplete ? '자리 지정 완료!' : '이름과 타일 번갈아 클릭') }}
      </h3>
    </div>
    
    <!-- 직접 보고 배치 체크박스 추가 -->
    <div style="margin-top: -6px; margin-bottom: 10px; display: flex; align-items: center; justify-content: center; gap: 8px;">
      <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; font-size: 13px; font-weight: bold; color: var(--text-color);">
        <input 
          type="checkbox" 
          v-model="isManualPlacement" 
          :disabled="isAutoDrawing || isAssignmentComplete"
          style="width: 15px; height: 15px; cursor: pointer;"
        />
        직접 자리 정하기
      </label>
    </div>
    
    <div class="draw_container">
      <div class="players_list">
        <div 
          v-for="(name, i) in selected4Names" 
          :key="i"
          class="draw_player_item"
          :class="{ 
            selected: activePlayerIndex === i,
            assigned: playerAssignedWind[name] !== undefined
          }"
          :style="getPlayerCardStyle(i, name)"
          @click="isAutoDrawing ? null : selectPlayer(i)"
        >
          <span class="player_name_text">{{ name.length > 4 ? name.substring(0, 4) : name }}</span>
          <span v-if="playerAssignedWind[name]" class="assigned_wind" :style="{ color: windColors[playerAssignedWind[name]].border, borderColor: windColors[playerAssignedWind[name]].border }">
            {{ playerAssignedWind[name] }}
          </span>
        </div>
      </div>

      <div class="tiles_grid" :class="{ disabled: activePlayerIndex === null || isAutoDrawing }">
        <div 
          v-for="(_, i) in 4" 
          :key="i"
          class="draw_tile"
          :class="{ flipped: openedTiles[i], assigned_done: !!assignment[randomizedTiles[i]] }"
          :style="{ transform: getTileTranslation(i) }"
          @click="flipTile(i)"
        >
          <div class="draw_tile_inner">
            <div class="draw_tile_front"></div>
            <div class="draw_tile_back" :style="getTileBackStyle(i)">
              {{ randomizedTiles[i] }}
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- 한번에 버튼 -->
    <button 
      v-if="!isAssignmentComplete && !isManualPlacement" 
      class="btn_draw_all" 
      :disabled="isAutoDrawing"
      @click="drawAllAtOnce"
    >
      한번에
    </button>

    <div class="button_group_row" :class="{ disabled: isAutoDrawing }">
      <button class="btn_back" @click="currentStep = 'select_match_4'">
        ⇠ 멘쯔 변경
      </button>
      <button 
        class="btn_proceed" 
        :disabled="!isAssignmentComplete"
        @click="startGame"
      >
        게임 시작 ➔
      </button>
    </div>
  </div>
</div>
</template>

<style scoped>
.autocomplete_suggestions {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background-color: #ffffff;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  z-index: 100;
  max-height: 150px;
  overflow-y: auto;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}
.dark .autocomplete_suggestions {
  background-color: #1e1e1e;
  border: 1px solid #444;
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.4);
}

.suggestion_item {
  padding: 8px 12px;
  font-size: 13px;
  cursor: pointer;
  color: #1f2937;
  text-align: left;
  transition: background-color 0.15s ease;
}
.dark .suggestion_item {
  color: #f3f4f6;
}

.suggestion_item:hover {
  background-color: #f3f4f6;
  color: var(--color-toggle-on, #4caf50);
}
.dark .suggestion_item:hover {
  background-color: #2a2a2a;
  color: var(--color-toggle-on, #4caf50);
}

.modal_tile_wrapper {
  padding: 10px;
  width: 320px;
  max-width: 95vw;
  box-sizing: border-box;
  font-family: inherit;
  color: var(--text-color);
}
.step_section {
  display: flex;
  flex-direction: column;
}
.step_header {
  margin-bottom: 8px;
  position: relative;
}
.step_indicator {
  font-size: 11px;
  color: var(--color-toggle-on);
  font-weight: bold;
}
.step_title {
  font-size: 16px;
  margin: 2px 0 0 0;
  color: var(--text-color);
}
.helper_text {
  font-size: 12px;
  color: var(--text-dimmed);
  margin-top: 6px;
  margin-bottom: 8px;
  font-weight: bold;
}
.connection_status {
  position: absolute;
  left: 0px;
  top: 0px;
  display: flex;
  align-items: center;
  font-size: 12px;
  font-weight: bold;
  color: var(--text-dimmed, #888);
  cursor: pointer;
  user-select: none;
  transition: opacity 0.15s ease;
}
.connection_status:hover {
  opacity: 0.75;
}
.status_text {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.status_dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}
.status_dot.green {
  background-color: var(--color-positive, #4caf50);
  box-shadow: 0 0 8px var(--color-positive, #4caf50);
}
.status_dot.gray {
  background-color: #888888;
  box-shadow: 0 0 6px #888888;
}

/* 1단계 스타일 */
.add_member_bar {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}
.add_member_bar input {
  flex: 1;
  padding: 6px;
  font-size: 13px;
  background-color: var(--input-bg-color);
  color: var(--text-color);
  border: 1px solid var(--border-color);
  border-radius: 4px;
}
.btn_add {
  padding: 6px 12px;
  background-color: var(--color-toggle-on);
  color: #fff;
  border: none;
  border-radius: 4px;
  font-weight: bold;
  font-size: 13px;
  cursor: pointer;
}
.empty_checklist_container {
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  width: 100%;
  height: 130px;
  border: 1px dashed var(--border-color);
  border-radius: 6px;
  background-color: var(--bg-stripe-dark);
  color: var(--text-dimmed);
  font-size: 13px;
  line-height: 1.5;
  box-sizing: border-box;
  padding: 15px;
}
.member_checklist,
.member_grid {
  display: grid !important;
  grid-template-columns: repeat(3, 1fr) !important;
  gap: 6px !important;
  max-height: 120px !important;
  overflow-y: auto !important;
  overflow-x: hidden !important;
  padding: 6px 4px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background-color: var(--bg-stripe-dark);
  scrollbar-width: thin;
}

/* 좌우 가로 스크롤 모드 */
.horizontal-scroll {
  display: flex !important;
  flex-direction: row !important;
  flex-wrap: nowrap !important;
  overflow-x: auto !important;
  overflow-y: hidden !important;
  -webkit-overflow-scrolling: touch;
  height: 64px !important;
  max-height: 64px !important;
  padding: 8px 6px !important;
}
.horizontal-scroll .grid_member_item {
  flex: 0 0 auto !important;
  width: auto !important;
  min-width: 90px !important;
  height: 44px !important;
  padding: 10px 14px !important;
  font-size: 14px !important;
}
.horizontal-scroll .grid_member_item:has(.btn_delete_member) {
  padding-right: 26px !important;
}
.horizontal-scroll .btn_delete_member {
  width: 18px !important;
  height: 18px !important;
  font-size: 11px !important;
  right: 4px !important;
}

/* 좌우 3줄 가로 스크롤 모드 */
.horizontal-3row-scroll {
  display: grid !important;
  grid-template-rows: repeat(3, 36px) !important;
  grid-auto-flow: column !important;
  grid-auto-columns: 80px !important;
  gap: 6px !important;
  height: 130px !important;
  max-height: 130px !important;
  overflow-x: auto !important;
  overflow-y: hidden !important;
  padding: 6px 4px !important;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background-color: var(--bg-stripe-dark);
  scrollbar-width: thin;
  -webkit-overflow-scrolling: touch;
}
.horizontal-3row-scroll .grid_member_item {
  width: 80px !important;
  min-width: 80px !important;
  height: 36px !important;
  padding: 4px 6px !important;
  font-size: 11px !important;
  box-sizing: border-box;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.horizontal-3row-scroll .grid_member_item:has(.btn_delete_member) {
  padding-right: 18px !important;
}
.horizontal-3row-scroll .btn_delete_member {
  width: 14px !important;
  height: 14px !important;
  font-size: 9px !important;
  right: 2px !important;
}

/* 스크롤바 강제 노출 스타일 (세로 스크롤바) */
.member_checklist::-webkit-scrollbar,
.member_grid::-webkit-scrollbar {
  width: 6px;
  display: block !important;
}
.horizontal-3row-scroll::-webkit-scrollbar,
.horizontal-scroll::-webkit-scrollbar {
  height: 6px !important;
  width: auto !important;
}
.member_checklist::-webkit-scrollbar-track,
.member_grid::-webkit-scrollbar-track {
  background: var(--bg-stripe-dark);
  border-radius: 3px;
}
.member_checklist::-webkit-scrollbar-thumb,
.member_grid::-webkit-scrollbar-thumb {
  background: #888888;
  border-radius: 3px;
}
.member_checklist::-webkit-scrollbar-thumb:hover,
.member_grid::-webkit-scrollbar-thumb:hover {
  background: var(--color-toggle-on);
}

.grid_member_item {
  width: 100% !important;
  min-width: 0 !important;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px 4px !important;
  background-color: var(--bg-stripe-light);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px !important;
  font-weight: bold;
  text-align: center;
  user-select: none;
  height: 38px !important;
  box-sizing: border-box;
  position: relative;
  transition: background-color 0.2s, border-color 0.2s, color 0.2s;
  color: var(--text-color);
}
.grid_member_item:has(.btn_delete_member) {
  padding-right: 18px !important;
}
.grid_member_item.active {
  background-color: var(--color-toggle-on);
  border-color: var(--color-toggle-on);
  color: #fff;
}

.btn_delete_member {
  position: absolute;
  right: 2px;
  top: 50%;
  transform: translateY(-50%);
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(255, 0, 0, 0.15);
  color: var(--color-negative);
  border-radius: 50%;
  font-size: 9px;
  font-weight: bold;
  transition: background-color 0.2s, color 0.2s;
  z-index: 2;
}
.btn_delete_member:hover {
  background-color: var(--color-negative);
  color: white;
}
.grid_member_item.active .btn_delete_member {
  color: white;
  background-color: rgba(255, 255, 255, 0.25);
}
.grid_member_item.active .btn_delete_member:hover {
  background-color: white;
  color: var(--color-negative);
}

.member_item {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  background-color: var(--bg-stripe-light);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  user-select: none;
}
.checkbox {
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-color);
  margin-right: 8px;
  font-weight: bold;
  font-size: 10px;
  color: var(--color-toggle-on);
  background-color: var(--bg-color);
}

/* 버튼 배치 */
.button_group_row {
  display: flex;
  gap: 8px;
}
.button_group_row.disabled {
  opacity: 0.5;
  pointer-events: none;
}
.btn_back {
  flex: 1;
  padding: 8px;
  font-size: 14px;
  font-weight: bold;
  background-color: var(--bg-stripe-dark);
  color: var(--text-color);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  cursor: pointer;
}
.btn_proceed {
  flex: 2;
  padding: 8px;
  font-size: 14px;
  font-weight: bold;
  background-color: var(--color-toggle-on);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
.btn_proceed:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 3단계 자리뽑기 모바일 세로 배치 */
.draw_container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.players_list {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.draw_player_item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 6px 2px;
  background-color: var(--bg-stripe-light);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  cursor: pointer;
  font-weight: bold;
  text-align: center;
  min-height: 52px;
  transition: border-color 0.2s, background-color 0.2s, box-shadow 0.2s;
  word-break: break-all;
}
.player_name_text {
  font-size: 14px; /* 닉네임 글자 크기 확대 */
  line-height: 1.2;
}
.draw_player_item.selected {
  border-color: var(--color-toggle-on);
  background-color: var(--input-bg-color);
  box-shadow: 0 0 4px var(--color-toggle-on);
}
.draw_player_item.assigned {
  border-color: var(--color-toggle-on);
  background-color: rgba(76, 175, 80, 0.05);
}
.assigned_wind {
  font-size: 8.5px; /* 바람 뱃지는 아주 작게 유지 */
  line-height: 1;
  background: var(--bg-color);
  padding: 1px 3px;
  border-radius: 3px;
  border: 1px solid var(--border-color);
  margin-top: 3px;
  font-weight: bold;
}
.tiles_grid {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  justify-content: center;
  margin-top: 8px;
}
.tiles_grid.disabled {
  pointer-events: none;
}
.draw_tile {
  perspective: 1000px;
  cursor: pointer;
  height: 80px;
  width: 100%;
  transition: transform 0.9s cubic-bezier(0.34, 1.56, 0.64, 1); /* easeOutBack 가속 및 오버슛 연출 */
  will-change: transform;
}
.draw_tile_inner {
  position: relative;
  width: 100%;
  max-width: 62px;
  height: 100%;
  margin: 0 auto;
  text-align: center;
  transition: transform 0.4s ease;
  transform-style: preserve-3d;
  box-shadow: 1px 1px 3px rgba(0,0,0,0.15);
  border-radius: 6px;
}
.draw_tile.flipped .draw_tile_inner {
  transform: rotateY(180deg);
}
.draw_tile_front,
.draw_tile_back {
  position: absolute;
  width: 100%;
  height: 100%;
  -webkit-backface-visibility: hidden;
  backface-visibility: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  box-sizing: border-box;
}
.draw_tile_front {
  background-color: #ff9f43; /* 연주황색 베이스 */
  background-image: repeating-linear-gradient(
    90deg,
    transparent,
    transparent 4px,
    rgba(255, 255, 255, 0.18) 5px,
    rgba(255, 255, 255, 0.18) 6px
  ); /* 옅은 흰색 세로줄 */
  border: 1px solid rgba(255, 255, 255, 0.45) !important; /* 훨씬 옅고 자연스러운 테두리 */
  box-shadow: inset 0 0 5px rgba(0, 0, 0, 0.08), 1px 1px 3px rgba(0, 0, 0, 0.2);
  user-select: none;
}
.draw_tile_back {
  background-color: var(--input-bg-color);
  transform: rotateY(180deg);
  font-size: 30px;
  font-weight: bold;
}
.btn_draw_all {
  width: 100%;
  padding: 8px;
  font-size: 14px;
  font-weight: bold;
  background-color: var(--color-negative);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  margin-top: 4px;
  margin-bottom: 8px;
  transition: opacity 0.2s;
}
.btn_draw_all:hover:not(:disabled) {
  opacity: 0.9;
}
.btn_draw_all:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.draw_tile.assigned_done {
  opacity: 0.45;
  pointer-events: none;
  filter: grayscale(30%);
}
</style>