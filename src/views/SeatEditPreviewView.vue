<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import Modal from '@/components/modals/Modal.vue';
import {
  EVENT_PLAYER_MAP,
  EVENT_TEAM_MAP,
  formatEventPlayerName,
  type EventNameLocale,
} from '@/data/knuNpm2026';
import type {
  Dice,
  GoogleInfo,
  ModalInfo,
  Option,
  PanelInfo,
  Player,
  Records,
  ScoringState,
  SeatTile,
} from '@/types/types.d';

const { locale } = useI18n();

const previewLocale = ref<EventNameLocale>('ko');
locale.value = 'ko';

const setPreviewLocale = (loc: EventNameLocale) => {
  previewLocale.value = loc;
  locale.value = loc;
  seatPlayerIds.value.forEach((pid, idx) => {
    players[idx].name = formatEventPlayerName(EVENT_PLAYER_MAP[pid] ?? pid, loc, 'compact');
  });
};

// 샘플 탁: R2-T3 ([3, 25, 22, 8]) — 완전 메모리 전용 (DB/로컬스토리지 접근 0건)
const INITIAL_SEAT_IDS: [number, number, number, number] = [3, 25, 22, 8];
const INITIAL_PRIOR_POINTS: [number, number, number, number] = [42.5, -11.0, 8.3, -29.8];
const INITIAL_SCORES = [34200, 26800, 21500, 17500];
const INITIAL_WINDS = ['北', '東', '南', '西']; // 南2局 진행 중 (현재 자풍 ≠ 시작 자리)
const SEAT_LABELS = ['東 ▼', '南 ▶', '西 ▲', '北 ◀'];

const seatPlayerIds = ref<[number, number, number, number]>([...INITIAL_SEAT_IDS]);
const priorPoints = ref<[number, number, number, number]>([...INITIAL_PRIOR_POINTS]);
const isSubmitted = ref(false);
const changeLogs = ref<string[]>([
  '샘플 대국 초기화 완료 (R2 · T3 · 南2局 1本場, 서버 전송 없음)',
]);

const makeInitialPlayers = (): Player[] =>
  INITIAL_SEAT_IDS.map((pid, idx) => {
    const nm = formatEventPlayerName(EVENT_PLAYER_MAP[pid] ?? pid, previewLocale.value, 'compact');
    return {
      seat: ['Down', 'Right', 'Up', 'Left'][idx],
      name: nm,
      shortName: nm,
      wind: INITIAL_WINDS[idx],
      displayScore: INITIAL_SCORES[idx],
      effectScore: NaN,
      gapScore: NaN,
      deltaScore: 0,
      rank: idx + 1,
      realRank: idx + 1,
      isRiichi: false,
      isWin: false,
      isLose: false,
      isTenpai: false,
      isNagashi: false,
      isCheat: false,
      beolbuCount: 0,
    };
  });

const players = reactive<Player[]>(makeInitialPlayers());

const panelInfo = reactive<PanelInfo>({
  wind: '南',
  round: 2,
  renchan: 1,
  riichi: 1,
});

const option = reactive<Option>({
  startingScore: 25000,
  returnScore: 30000,
  roundMangan: true,
  alwaysShowRank: true,
  sekiOrder: false,
  tobi: false,
  rankUma: [30, 10, -10, -30],
  cheatScore: true,
  riichiPayout: true,
  powerSaving: false,
  ratingDisplayMode: 'top',
});

const records = reactive<Records>({
  time: ['ㅤ', '東1局 0本場', 'ㅤ', '東2局 0本場', 'ㅤ'],
  score: [
    [25000, 9200, 34200, 0, 34200],
    [25000, 0, 25000, 1800, 26800],
    [25000, -3500, 21500, 0, 21500],
    [25000, -5700, 19300, -1800, 17500],
  ],
  riichi: [
    [false, false, false, false],
    [true, false, false, false],
    [false, true, false, false],
  ],
  win: [
    [false, false, false, false],
    [true, false, false, false],
    [false, true, false, false],
  ],
  lose: [
    [false, false, false, false],
    [false, false, false, true],
    [false, false, false, true],
  ],
  tenpai: [
    [false, false, false, false],
    [false, false, false, false],
    [false, false, false, false],
  ],
  cheat: [
    [false, false, false, false],
    [false, false, false, false],
    [false, false, false, false],
  ],
  beolbu: [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  status: ['initial', 'ron', 'ron'],
  riichiOrder: [[], [0], [1]],
  dealer: [0, 0, 1],
});

const scoringState = reactive<ScoringState>({
  whoWin: 0,
  whoLose: 0,
  whoCheat: 0,
  whoBeolbu: 0,
  isFao: false,
  whoFao: 0,
  inputFan: 0,
  inputBu: 0,
  inputFao: 0,
});

const dice = reactive<Dice>({ value: [1, 1], wallDirection: [false, false, false, false] });
const seatTile = reactive<SeatTile>({ value: ['東', '南', '西', '北'], isOpened: [false, false, false, false] });
const googleInfo = reactive<GoogleInfo>({
  clientId: '',
  isLoggedIn: false,
  spreadsheetId: '',
  syncMode: 'local',
  memberList: [],
  todayMembers: [],
  selectedMembers: [],
});

const modalInfo = reactive<ModalInfo>({
  isOpen: false,
  type: '',
  status: '',
});

const toastMsg = ref('');
let toastTimer: ReturnType<typeof setTimeout> | null = null;
const pushToast = (msg: string) => {
  toastMsg.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastMsg.value = '';
  }, 2600);
};

const showModal = (type: string, status?: string) => {
  modalInfo.isOpen = true;
  modalInfo.type = type;
  modalInfo.status = status || '';
};

const hideModal = () => {
  modalInfo.isOpen = false;
  modalInfo.type = '';
  modalInfo.status = '';
};

const showConfirm = async (msg: string) => window.confirm(msg);

const formatTimeNow = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
};

const handleUpdateEventSeats = (
  nextSeatPlayerIds: [number, number, number, number],
  returnToModal?: string
) => {
  const oldIds = seatPlayerIds.value;
  const changed = nextSeatPlayerIds.some((pid, i) => pid !== oldIds[i]);
  if (changed) {
    const nextPrior = nextSeatPlayerIds.map((pid) => {
      const oldIdx = oldIds.indexOf(pid);
      return oldIdx >= 0 ? priorPoints.value[oldIdx] : 0;
    }) as [number, number, number, number];

    seatPlayerIds.value = [...nextSeatPlayerIds] as [number, number, number, number];
    priorPoints.value = nextPrior;
    nextSeatPlayerIds.forEach((pid, idx) => {
      players[idx].name = formatEventPlayerName(EVENT_PLAYER_MAP[pid] ?? pid, previewLocale.value, 'compact');
    });
    if (isSubmitted.value) {
      isSubmitted.value = false;
    }

    const summary = nextSeatPlayerIds
      .map((pid, idx) => `${['東', '南', '西', '北'][idx]}:${formatEventPlayerName(EVENT_PLAYER_MAP[pid] ?? pid, previewLocale.value, 'compact')}`)
      .join(' / ');
    changeLogs.value.unshift(`[${formatTimeNow()}] 자리 변경 적용 → ${summary} (프리뷰 전용 · 서버 전송 없음)`);
    pushToast('동남서북 자리/이름이 변경되었습니다 (프리뷰)');
  }

  if (returnToModal === 'stay') return;
  if (returnToModal) {
    showModal(returnToModal);
  } else {
    hideModal();
  }
};

const resetPreview = () => {
  seatPlayerIds.value = [...INITIAL_SEAT_IDS];
  priorPoints.value = [...INITIAL_PRIOR_POINTS];
  isSubmitted.value = false;
  INITIAL_SEAT_IDS.forEach((pid, idx) => {
    players[idx].name = formatEventPlayerName(EVENT_PLAYER_MAP[pid] ?? pid, previewLocale.value, 'compact');
    players[idx].displayScore = INITIAL_SCORES[idx];
    players[idx].wind = INITIAL_WINDS[idx];
  });
  changeLogs.value.unshift(`[${formatTimeNow()}] 샘플 상태 초기화 완료`);
  pushToast('샘플 상태를 초기화했습니다');
};

const seatCards = computed(() =>
  seatPlayerIds.value.map((pid, idx) => {
    const ep = EVENT_PLAYER_MAP[pid];
    const team = ep ? EVENT_TEAM_MAP[ep.teamId] : null;
    return {
      seatLabel: SEAT_LABELS[idx],
      isStartEast: idx === 0,
      pid,
      name: players[idx].name,
      fullName: formatEventPlayerName(ep ?? pid, previewLocale.value, 'full'),
      teamId: ep?.teamId || 'A',
      teamColor: team?.color || '#3b82f6',
      score: players[idx].displayScore,
      currentWind: players[idx].wind,
      priorPt: priorPoints.value[idx],
    };
  })
);
</script>

<template>
  <div class="preview-page">
    <div v-if="toastMsg" class="preview-toast">{{ toastMsg }}</div>

    <div class="preview-shell">
      <div class="preview-banner">
        <div class="preview-banner-left">
          <span class="preview-chip">🧪 ISOLATED PREVIEW</span>
          <h1>동남서북 자리/이름 변경 기능 테스트 페이지</h1>
          <p>실제 대회 DB · Worker API · 로컬 세션에 전혀 접근하지 않는 완전 격리 프리뷰입니다.</p>
        </div>
        <div class="preview-banner-actions">
          <div class="preview-lang-group">
            <button type="button" :class="{ active: previewLocale === 'ko' }" @click="setPreviewLocale('ko')">KO</button>
            <button type="button" :class="{ active: previewLocale === 'en' }" @click="setPreviewLocale('en')">EN</button>
            <button type="button" :class="{ active: previewLocale === 'ja' }" @click="setPreviewLocale('ja')">JA</button>
          </div>
          <button type="button" class="preview-reset-btn" @click="resetPreview">↺ 초기화</button>
        </div>
      </div>

      <section class="preview-section">
        <div class="section-head">
          <h2>현재 가상 테이블 상태 (PREVIEW · R2-T3 · 南2局 1本場)</h2>
          <span class="section-sub">자리를 바꾸면 점수와 현재 자풍은 자리에 고정되고, 선수 이름과 누적 포인트만 이동합니다.</span>
        </div>

        <div class="seat-grid">
          <div v-for="card in seatCards" :key="card.seatLabel" class="seat-card">
            <div class="seat-card-top">
              <span class="seat-wind-tag" :class="{ 'is-east': card.isStartEast }">{{ card.seatLabel }}</span>
              <span class="seat-cur-wind">현재 자풍: <strong>{{ card.currentWind }}</strong></span>
            </div>
            <div class="seat-player-row">
              <span class="seat-team-pill" :style="{ backgroundColor: card.teamColor }">{{ card.teamId }}</span>
              <div class="seat-name-col">
                <div class="seat-compact-name">{{ card.name }}</div>
                <div class="seat-full-name">{{ card.fullName }}</div>
              </div>
            </div>
            <div class="seat-card-bottom">
              <span class="seat-score">{{ card.score.toLocaleString() }}점</span>
              <span class="seat-prior" :class="card.priorPt >= 0 ? 'pos' : 'neg'">
                누적 {{ card.priorPt > 0 ? '+' : '' }}{{ card.priorPt.toFixed(1) }}pt
              </span>
            </div>
          </div>
        </div>
      </section>

      <section class="preview-section">
        <div class="section-head">
          <h2>실제 모달 진입 경로 테스트 (4가지)</h2>
          <span class="section-sub">실제 점수판에서 사용하는 Modal 컴포넌트를 그대로 열어 테스트합니다.</span>
        </div>

        <div class="trigger-grid">
          <button type="button" class="trigger-btn primary" @click="showModal('edit_event_seats')">
            <strong>① 자리/이름 변경 모달 바로 열기</strong>
            <span>드롭다운 자동 맞교환 · ▲▼ 이동 · 1칸 순환 테스트</span>
          </button>
          <button type="button" class="trigger-btn" @click="showModal('choose_menu_kind')">
            <strong>② 이벤트 메뉴에서 진입</strong>
            <span>하단 [🔄 자리/이름 변경] 버튼 & 동기화 시각 표시 확인</span>
          </button>
          <button type="button" class="trigger-btn" @click="showModal('result_sheet')">
            <strong>③ 게임 결과창에서 진입</strong>
            <span>제출 직전 상단 [🔄 자리/이름 변경] → 적용 후 결과창 자동 복귀</span>
          </button>
          <button type="button" class="trigger-btn" @click="showModal('set_options')">
            <strong>④ 설정창에서 직접 변경</strong>
            <span>東/南/西/北 드롭다운 변경 시 즉시 맞교환 확인</span>
          </button>
        </div>
      </section>

      <section class="preview-section">
        <div class="section-head">
          <h2>변경 로그 (메모리 전용)</h2>
        </div>
        <ul class="log-list">
          <li v-for="(line, i) in changeLogs" :key="i">{{ line }}</li>
        </ul>
      </section>
    </div>

    <Modal
      v-if="modalInfo.isOpen"
      :players="players"
      :scoringState="scoringState"
      :panelInfo="panelInfo"
      :dice="dice"
      :seatTile="seatTile"
      :records="records"
      :option="option"
      :modalInfo="modalInfo"
      :googleInfo="googleInfo"
      :googleMemberStats="[]"
      :todayGamesHistory="[]"
      :isGameSaved="false"
      :showConfirm="showConfirm"
      eventMatchLabel="[PREVIEW] R2 · T3"
      :eventLocale="previewLocale"
      :isEventSubmitting="false"
      :isEventSubmitted="isSubmitted"
      :isEventCloudSaving="false"
      eventLiveSyncStatus="synced"
      :eventLiveLastSyncedAt="Date.now()"
      :eventPriorPoints="priorPoints"
      :eventChomboPenalty="20"
      :eventSeatPlayerIds="seatPlayerIds"
      :showEventTimer="true"
      @show-modal="showModal"
      @hide-modal="hideModal"
      @update-event-seats="handleUpdateEventSeats"
      @change-event-locale="setPreviewLocale"
      @cloud-save-event="pushToast('프리뷰 모드에서는 서버 전송을 수행하지 않습니다')"
      @submit-event-result="isSubmitted = true; pushToast('프리뷰 제출 시뮬레이션 완료 (서버 전송 없음)')"
      @back-to-event-dashboard="hideModal(); pushToast('프리뷰 모드: 대회 페이지 이동 생략')"
      @finish-event-early="showModal('result_sheet')"
      @start-new-game="resetPreview(); hideModal()"
    />
  </div>
</template>

<style scoped>
.preview-page {
  min-height: 100vh;
  background: #0f172a;
  color: #f8fafc;
  padding: 20px 16px 40px;
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, 'Pretendard', 'Noto Sans KR', sans-serif;
}
.preview-toast {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  background: #10b981;
  color: #ffffff;
  font-weight: 800;
  font-size: 14px;
  padding: 10px 18px;
  border-radius: 999px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
}
.preview-shell {
  max-width: 920px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.preview-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 18px 20px;
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(37, 99, 235, 0.22), rgba(16, 185, 129, 0.14));
  border: 1px solid rgba(96, 165, 250, 0.35);
}
.preview-chip {
  display: inline-block;
  font-size: 11.5px;
  font-weight: 900;
  letter-spacing: 0.04em;
  padding: 3px 9px;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.28);
  color: #93c5fd;
  margin-bottom: 6px;
}
.preview-banner h1 {
  margin: 0 0 4px;
  font-size: 21px;
  font-weight: 900;
}
.preview-banner p {
  margin: 0;
  font-size: 13.5px;
  color: #cbd5e1;
}
.preview-banner-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.preview-lang-group {
  display: inline-flex;
  gap: 4px;
  background: rgba(15, 23, 42, 0.55);
  padding: 4px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.25);
}
.preview-lang-group button {
  padding: 5px 10px;
  border-radius: 7px;
  border: none;
  background: transparent;
  color: #cbd5e1;
  font-size: 12.5px;
  font-weight: 800;
  cursor: pointer;
}
.preview-lang-group button.active {
  background: #2563eb;
  color: #ffffff;
}
.preview-reset-btn {
  padding: 8px 13px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: rgba(30, 41, 59, 0.9);
  color: #f8fafc;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
}
.preview-section {
  background: rgba(30, 41, 59, 0.72);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 16px;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.section-head {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.section-head h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 800;
  color: #f1f5f9;
}
.section-sub {
  font-size: 13px;
  color: #94a3b8;
}
.seat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(195px, 1fr));
  gap: 10px;
}
.seat-card {
  background: rgba(15, 23, 42, 0.75);
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 12px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.seat-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.seat-wind-tag {
  font-size: 13px;
  font-weight: 900;
  padding: 3px 8px;
  border-radius: 7px;
  background: rgba(148, 163, 184, 0.2);
  color: #e2e8f0;
}
.seat-wind-tag.is-east {
  background: rgba(239, 68, 68, 0.22);
  color: #fca5a5;
}
.seat-cur-wind {
  font-size: 12px;
  color: #94a3b8;
}
.seat-player-row {
  display: flex;
  align-items: center;
  gap: 9px;
}
.seat-team-pill {
  width: 24px;
  height: 24px;
  border-radius: 7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 900;
  color: #ffffff;
  flex-shrink: 0;
}
.seat-name-col {
  min-width: 0;
}
.seat-compact-name {
  font-size: 16px;
  font-weight: 800;
  color: #ffffff;
}
.seat-full-name {
  font-size: 12px;
  color: #94a3b8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.seat-card-bottom {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  border-top: 1px solid rgba(148, 163, 184, 0.16);
  padding-top: 8px;
}
.seat-score {
  font-size: 17px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  color: #f8fafc;
}
.seat-prior {
  font-size: 12.5px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.seat-prior.pos {
  color: #4ade80;
}
.seat-prior.neg {
  color: #f87171;
}
.trigger-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
}
.trigger-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 13px 14px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: rgba(15, 23, 42, 0.72);
  color: #f8fafc;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s, background 0.15s;
}
.trigger-btn:hover {
  border-color: #60a5fa;
  background: rgba(30, 58, 138, 0.32);
}
.trigger-btn.primary {
  border-color: rgba(59, 130, 246, 0.65);
  background: rgba(37, 99, 235, 0.24);
}
.trigger-btn strong {
  font-size: 14.5px;
  font-weight: 800;
}
.trigger-btn span {
  font-size: 12px;
  color: #cbd5e1;
  line-height: 1.35;
}
.log-list {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12.5px;
  color: #cbd5e1;
  max-height: 180px;
  overflow-y: auto;
}
/* 프리뷰 페이지는 세로 회전(.background)을 사용하지 않으므로 세로 화면에서도 정상 폭으로 표시 */
.preview-page :deep(.modal_content) {
  max-width: 94vw !important;
  max-height: 90dvh !important;
}
.preview-page :deep(.event_seat_edit_modal) {
  width: min(500px, 94vw) !important;
}
.preview-page :deep(.result_sheet_modal) {
  width: min(920px, 94vw) !important;
  min-height: auto !important;
}
</style>
