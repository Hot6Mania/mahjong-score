<script setup lang="ts">
import type { SeatTile, GoogleInfo } from "@/types/types.d"
import { ref, computed, onMounted, watch } from "vue"

/**props 정의*/
interface Props {
  seatTile: SeatTile,
  googleInfo: GoogleInfo
}
const props = defineProps<Props>()

/**emits 정의*/
type Emits = {
  (e: 'start-game-with-seats', assignment: Record<string, string>): void,
  (e: 'add-new-member', name: string): void,
  (e: 'save-today-members', names: string[]): void
}
const emit = defineEmits<Emits>()

const currentStep = ref<'setup_today_pool' | 'select_match_4' | 'draw_seats'>('setup_today_pool')

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

const displayMemberList = computed(() => {
  if (props.googleInfo.isLoggedIn && props.googleInfo.memberList.length > 0) {
    return props.googleInfo.memberList
  }
  return offlineMemberList.value
})

onMounted(() => {
  shuffleTiles()
  
  if (props.googleInfo.todayMembers && props.googleInfo.todayMembers.length > 0) {
    tempTodayMembers.value = [...props.googleInfo.todayMembers]
    // 만약 오프라인 로컬 목록이 비어있다면, 로드한 todayMembers를 offlineMemberList에 넣어 보존함
    if (!props.googleInfo.isLoggedIn && offlineMemberList.value.length === 0) {
      offlineMemberList.value = [...props.googleInfo.todayMembers]
    }
    currentStep.value = 'select_match_4'
  }
})

watch(() => props.googleInfo.todayMembers, (newVal) => {
  if (newVal && newVal.length > 0) {
    tempTodayMembers.value = [...newVal]
    if (!props.googleInfo.isLoggedIn) {
      offlineMemberList.value = [...newVal]
    }
  }
}, { deep: true })

const shuffleTiles = () => {
  const tiles = ['東', '南', '西', '北']
  const array = new Uint32Array(4)
  window.crypto.getRandomValues(array)
  for (let i = 3; i > 0; i--) {
    const j = array[i] % (i + 1);
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  randomizedTiles.value = tiles
}

const toggleTodayMember = (name: string) => {
  const index = tempTodayMembers.value.indexOf(name)
  if (index > -1) {
    tempTodayMembers.value.splice(index, 1)
  } else {
    tempTodayMembers.value.push(name)
  }
}

// 멤버 추가 (온라인: 시트 추가, 오프라인: 로컬 풀 추가)
const handleAddNewMember = () => {
  const name = newMemberName.value.trim()
  if (!name) return
  if (displayMemberList.value.includes(name)) {
    alert("이미 등록된 멤버 이름입니다.")
    return
  }
  
  if (props.googleInfo.isLoggedIn) {
    emit('add-new-member', name)
  } else {
    offlineMemberList.value.push(name)
  }
  
  if (!tempTodayMembers.value.includes(name)) {
    tempTodayMembers.value.push(name)
  }
  newMemberName.value = ''
}

// 오프라인 로컬 멤버 제거 기능
const removeLocalMember = (name: string) => {
  // 1. 로컬 전체 명단에서 삭제
  const idx = offlineMemberList.value.indexOf(name)
  if (idx > -1) {
    offlineMemberList.value.splice(idx, 1)
  }
  // 2. 오늘의 참가 풀에서 삭제
  const tIdx = tempTodayMembers.value.indexOf(name)
  if (tIdx > -1) {
    tempTodayMembers.value.splice(tIdx, 1)
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

const proceedToDrawSeats = () => {
  if (selected4Names.value.length !== 4) return
  
  activePlayerIndex.value = null
  assignment.value = {}
  playerAssignedWind.value = {}
  openedTiles.value = [false, false, false, false]
  shuffleTiles()
  
  currentStep.value = 'draw_seats'
}

const selectPlayer = (idx: number) => {
  const name = selected4Names.value[idx]
  if (playerAssignedWind.value[name]) return
  activePlayerIndex.value = idx
}

const flipTile = (tileIdx: number) => {
  if (activePlayerIndex.value === null) return 
  if (openedTiles.value[tileIdx]) return 

  const playerName = selected4Names.value[activePlayerIndex.value]
  const wind = randomizedTiles.value[tileIdx]

  openedTiles.value[tileIdx] = true
  assignment.value[wind] = playerName
  playerAssignedWind.value[playerName] = wind

  activePlayerIndex.value = null
}

const isAssignmentComplete = computed(() => {
  return Object.keys(playerAssignedWind.value).length === 4
})

const startGame = () => {
  if (!isAssignmentComplete.value) return
  emit('start-game-with-seats', assignment.value)
}

const tileStyle = (tileIdx: number) => {
  const isOpened = openedTiles.value[tileIdx]
  const wind = randomizedTiles.value[tileIdx]
  return {
    color: isOpened ? (wind === '東' ? 'var(--color-east)' : 'var(--text-color)') : 'var(--bg-stripe-dark)',
    backgroundColor: isOpened ? 'var(--input-bg-color)' : 'var(--color-toggle-on)',
    border: '1px solid var(--border-color)',
    cursor: isOpened ? 'default' : 'pointer'
  }
}
</script>

<template>
<div class="modal_tile_wrapper">
  <!-- 1단계: 오늘의 멤버 설정 -->
  <div v-if="currentStep === 'setup_today_pool'" class="step_section">
    <div class="step_header">
      <span class="step_indicator">1 / 3 단계</span>
      <h3 class="step_title">오늘의 멤버 설정 (4인 이상)</h3>
    </div>

    <div v-if="!googleInfo.isLoggedIn" class="offline_banner">
      ⚠️ 로컬 모드 (이름을 직접 등록하세요)
    </div>

    <div class="add_member_bar">
      <input 
        type="text" 
        v-model="newMemberName" 
        placeholder="새 멤버 등록" 
        @keyup.enter="handleAddNewMember"
        maxlength="8"
      />
      <button @click="handleAddNewMember" class="btn_add">추가</button>
    </div>

    <!-- 통합 멤버 명단 체크박스 -->
    <div class="member_checklist">
      <div v-if="displayMemberList.length === 0" class="empty_checklist_msg" style="padding: 15px; text-align: center; color: var(--text-dimmed); font-size: 13px;">
        등록된 멤버가 없습니다.<br>새 이름을 입력하고 추가 버튼을 누르세요.
      </div>
      <div 
        v-else
        v-for="(name, i) in displayMemberList" 
        :key="i"
        class="member_item"
        :class="{ active: tempTodayMembers.includes(name) }"
        @click="toggleTodayMember(name)"
        style="position: relative;"
      >
        <span class="checkbox">{{ tempTodayMembers.includes(name) ? '✓' : '' }}</span>
        <span class="name">{{ name }}</span>
        
        <!-- 로컬 오프라인 상태일 때 개별 삭제할 수 있는 버튼 -->
        <span 
          v-if="!googleInfo.isLoggedIn"
          @click.stop="removeLocalMember(name)" 
          style="position: absolute; right: 10px; color: var(--color-negative); font-weight: bold; font-size: 15px; cursor: pointer; padding: 2px 6px; z-index: 3;"
        >
          ✕
        </span>
      </div>
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

    <div class="member_checklist scrollable_picker">
      <div 
        v-for="(name, i) in tempTodayMembers" 
        :key="i"
        class="member_item"
        :class="{ active: selected4Names.includes(name) }"
        @click="toggleMatchPlayer(name)"
      >
        <span class="checkbox">{{ selected4Names.includes(name) ? '✓' : '' }}</span>
        <span class="name">{{ name }}</span>
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
      <h3 class="step_title">이름과 타일 번갈아 클릭</h3>
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
          @click="selectPlayer(i)"
        >
          <span class="player_name_text">{{ name }}</span>
          <span v-if="playerAssignedWind[name]" class="assigned_wind">
            {{ playerAssignedWind[name] }}
          </span>
        </div>
      </div>

      <div class="tiles_grid" :class="{ disabled: activePlayerIndex === null }">
        <div 
          v-for="(_, i) in 4" 
          :key="i"
          class="draw_tile"
          :style="tileStyle(i)"
          @click="flipTile(i)"
        >
          <span v-if="openedTiles[i]" class="tile_wind">{{ randomizedTiles[i] }}</span>
          <span v-else class="tile_back">🀫</span>
        </div>
      </div>
    </div>

    <div class="button_group_row">
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
.offline_banner {
  font-size: 11px;
  color: var(--color-negative);
  background-color: var(--bg-stripe-dark);
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px dashed var(--border-color);
  margin-bottom: 8px;
  text-align: center;
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
.member_checklist {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 140px;
  overflow-y: scroll !important;
  padding: 4px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background-color: var(--bg-stripe-dark);
}

/* 스크롤바 강제 노출 스타일 */
.member_checklist::-webkit-scrollbar {
  width: 6px;
  display: block;
}
.member_checklist::-webkit-scrollbar-track {
  background: var(--bg-stripe-dark);
}
.member_checklist::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 3px;
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
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
}
.draw_player_item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background-color: var(--bg-stripe-light);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: bold;
}
.draw_player_item.selected {
  border-color: var(--color-toggle-on);
  background-color: var(--input-bg-color);
  box-shadow: 0 0 3px rgba(59, 130, 246, 0.4);
}
.draw_player_item.assigned {
  opacity: 0.4;
  cursor: default;
  background-color: var(--bg-stripe-dark);
}
.assigned_wind {
  font-size: 11px;
  color: var(--color-toggle-on);
  background: var(--bg-color);
  padding: 1px 4px;
  border-radius: 4px;
  border: 1px solid var(--border-color);
}
.tiles_grid {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(4, 62px);
  grid-template-rows: 80px;
  gap: 8px;
  justify-content: center;
}
.tiles_grid.disabled {
  opacity: 0.4;
  pointer-events: none;
}
.draw_tile {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  font-size: 30px;
  font-weight: bold;
  box-shadow: 1px 1px 3px rgba(0,0,0,0.15);
}
.tile_back {
  font-size: 40px;
  color: #fff;
}
</style>