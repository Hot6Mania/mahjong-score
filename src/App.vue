<script setup lang="ts">
import Player from "@/components/Player.vue"
import Panel from "@/components/Panel.vue"
import Modal from "@/components/modals/Modal.vue"
import { reactive, onMounted, watch, ref, computed } from "vue"
import { useRouter } from "vue-router"
import { useI18n } from "vue-i18n"
import { getShortNames } from "@/utils/nameAbbreviation"
import { initGapi, initGis, loginGoogle, logoutGoogle, fetchMemberList, fetchSessionMembers, saveSessionMembers, updateSessionMemberPoints, createSessionSheetIfNotExist, appendRoundRecords, appendSessionSummaryRecords, upsertSessionUmaHistory, getNextSessionSheetName, addNewMembersToDb, deleteMemberFromDb, fetchMemberStats, verifySpreadsheetStructures, tryAutoLogin } from "@/utils/googleSheets"
import type { GoogleInfo, Player as PlayerInterface, Option as OptionType, Records as RecordsType, PanelInfo as PanelInfoType } from "@/types/types.d"
import { secureShuffle, getSecureRandomInt } from "@/utils/random"

/**라우터 가져오기*/
const router = useRouter()

/**i18n 속성 가져오기*/
const { t, locale } = useI18n()

/**data 정의*/
// 로컬 스토리지에 백업된 대국 데이터가 있는지 확인하고 복원
const savedPlayers = localStorage.getItem("mahjong_players");
let initialPlayers = [
  {seat: "Down",  name: "▼", wind: "東", rank: 0, realRank: 1,
    displayScore: 25000, effectScore: NaN, gapScore: NaN, deltaScore: 0,
    isRiichi: false, isWin: false, isLose: false, isTenpai: false, isNagashi: false, shortName: ""},
  {seat: "Right", name: "▶", wind: "南", rank: 0, realRank: 1,
    displayScore: 25000, effectScore: NaN, gapScore: NaN, deltaScore: 0,
    isRiichi: false, isWin: false, isLose: false, isTenpai: false, isNagashi: false, shortName: ""},
  {seat: "Up",    name: "▲", wind: "西", rank: 0, realRank: 1,
    displayScore: 25000, effectScore: NaN, gapScore: NaN, deltaScore: 0,
    isRiichi: false, isWin: false, isLose: false, isTenpai: false, isNagashi: false, shortName: ""},
  {seat: "Left",  name: "◀", wind: "北", rank: 0, realRank: 1,
    displayScore: 25000, effectScore: NaN, gapScore: NaN, deltaScore: 0,
    isRiichi: false, isWin: false, isLose: false, isTenpai: false, isNagashi: false, shortName: ""}
];
if (savedPlayers) {
  try {
    const parsed = JSON.parse(savedPlayers);
    if (Array.isArray(parsed) && parsed.length === 4) {
      initialPlayers = parsed.map(p => ({
        ...p,
        effectScore: (p.effectScore === null || p.effectScore === undefined) ? NaN : Number(p.effectScore),
        gapScore: (p.gapScore === null || p.gapScore === undefined) ? NaN : Number(p.gapScore)
      }));
    }
  } catch (e) {
    console.error("Failed to parse saved players", e);
  }
}
const players = reactive(initialPlayers);

const scoringState = reactive({ // 점수계산 요소
  whoWin: -1, // 현재 점수 입력하는 플레이어
  whoLose: -1, // 현재 방총 플레이어
  whoCheat: -1, // 현재 촌보 플레이어
  isFao: false, // 책임지불 유무
  whoFao: -1, // 현재 책임지불하는 플레이어
  inputFan: 0, // 현재 점수 (판)
  inputBu: 2, // 현재 점수 (부)
  inputFao: -1, // 현재 책임지불 점수 (판)
})

const savedPanelInfo = localStorage.getItem("mahjong_panelInfo");
const panelInfo = reactive<PanelInfoType>(savedPanelInfo ? JSON.parse(savedPanelInfo) : {
  wind: "東", // 현재 장풍
  round: 1, // 현재 국
  riichi: 0, // 현재 누적 리치봉
  renchan: 0, // 현재 누적 연장봉
})

const dice = reactive({ // 주사위
  value: [1, 6], // 값
  wallDirection: [false, false, false, false], // 주사위 값에 따른 패산방향
})

const seatTile = reactive({ // 자리정하기 타일
  value: ["東", "南", "西", "北"], // 랜덤 타일값
  isOpened: [false, false, false, false], // 타일이 공개되었는지
})

const savedRecords = localStorage.getItem("mahjong_records");
const loadedRecords = savedRecords ? JSON.parse(savedRecords) : {};
const records = reactive<RecordsType>({
  time: loadedRecords.time || ["ㅤ"], // 시간
  score: loadedRecords.score || [[25000],[25000],[25000],[25000]], // 점수
  riichi: loadedRecords.riichi || [[false, false, false, false]], // 리치 횟수
  win: loadedRecords.win || [[false, false, false, false]], // 화료 횟수
  lose: loadedRecords.lose || [[false, false, false, false]], // 방총 횟수
  tenpai: loadedRecords.tenpai || [[false, false, false, false]], // 텐파이 여부
  status: loadedRecords.status || ["initial"], // 국 상태
  riichiOrder: loadedRecords.riichiOrder || [[]], // 리치 순서
  dealer: loadedRecords.dealer || [0], // 오야/동가 플레이어 인덱스
})

const defaultOption: OptionType = {
  startingScore: 25000, // 시작 점수
  returnScore: 30000, // 반환 점수
  rankUma: [20, 10, -10, -20], // 순위 우마 기본값 변경
  roundMangan: false, // 절상만관
  tobi: true, // 들통
  cheatScore: false, // 촌보 지불 점수
  riichiPayout: true, // 남은 공탁금 처리
  alwaysShowRank: false, // 등수 상시 표시
  sekiOrder: true, // 동점 석순 기준
};
const savedOption = localStorage.getItem("mahjong_option");
const option = reactive<OptionType>(savedOption ? { ...defaultOption, ...JSON.parse(savedOption) } : defaultOption);
const modalInfo = reactive({ // 모달창
  isOpen: false, // on/off
  type: "", // 종류
  status: "", // 라운드 형태 - 론 쯔모 일반유국 특수유국
})
const googleInfo = reactive<GoogleInfo>({ // 구글 연동 정보
  clientId: localStorage.getItem("google_client_id") || "1089115695270-dui47hsqvfa9pmb5la64d5g6cinccitj.apps.googleusercontent.com", // 구글 클라이언트 ID
  spreadsheetId: localStorage.getItem("google_spreadsheet_id") || "", // 구글 스프레드시트 ID
  isLoggedIn: false, // 로그인 여부
  syncMode: (localStorage.getItem("sync_mode") as 'local' | 'google') || 'local', // 연동 모드 (기본값 로컬)
  memberList: [], // 멤버 전체 목록
  todayMembers: JSON.parse(localStorage.getItem("today_members") || "[]"), // 오늘 참가할 멤버 풀 (쿠키/스토리지 보존)
  selectedMembers: [] // 선택된 멤버 4명
})

// 회차 수집 및 팝업 제어 변수들
const isShowChooseSessionPopup = ref(false)  // 설정에서 '기존 회차'를 클릭했을 때의 팝업
const isShowSessionChoosePopup = ref(false)  // 로그인 성공 직후 뜨는 기존/신규 분기 선택 팝업
const validGoogleSessions = ref<string[]>([])
const isLoadingSessions = ref(false)
const selectedSessionToLoad = ref("")

// 차트 시각화 전용 데이터 소스 상태
const chartPlayers = ref<any[]>([])
const chartRecords = ref<any>({ score: [], time: [] })

// 구글 스프레드시트로부터 회차 목록(기본/raw/데이터 탭이 모두 완비된 리스트) 수집
const loadGoogleSessions = async () => {
  if (!googleInfo.isLoggedIn || !googleInfo.spreadsheetId) {
    validGoogleSessions.value = [];
    return;
  }
  isLoadingSessions.value = true;
  try {
    const res = await window.gapi.client.sheets.spreadsheets.get({
      spreadsheetId: googleInfo.spreadsheetId
    });
    const sheetTitles: string[] = res.result.sheets.map((s: any) => s.properties.title);
    
    // 1. '제n회 YYMMDD' 패턴의 기본 탭 이름들 필터링
    const candidates = sheetTitles.filter(t => /^제\d+회\s+\d{6}$/.test(t));
    
    // 2. (raw)와 (데이터) 탭이 둘 다 완비된 탭만 활성화
    const validList: string[] = [];
    candidates.forEach(cleanTitle => {
      const rawTitle = `${cleanTitle} (raw)`;
      const detailTitle = `${cleanTitle} (데이터)`;
      if (sheetTitles.includes(rawTitle) && sheetTitles.includes(detailTitle)) {
        validList.push(cleanTitle);
      }
    });
    
    // 최신 회차가 위로 오도록 정렬
    validList.sort((a, b) => b.localeCompare(a));
    validGoogleSessions.value = validList;
    if (validList.length > 0) {
      selectedSessionToLoad.value = validList[0];
    } else {
      selectedSessionToLoad.value = "";
    }
  } catch (err) {
    console.error("구글 시트 회차 수집 실패:", err);
    validGoogleSessions.value = [];
  } finally {
    isLoadingSessions.value = false;
  }
};

// 로컬 모드용 오늘 누적 포인트 맵
const localPoints = reactive<Record<string, number>>(
  JSON.parse(localStorage.getItem("today_members_points") || "{}")
)

// 오늘 개별 회전 기록 이력
const todayGamesHistory = reactive<any[]>(
  JSON.parse(localStorage.getItem("today_games_history") || "[]")
)

// 대국 종료 여부
const isGameFinished = computed(() => {
  return records.time.length > 0 && records.time[records.time.length - 1] === '결과';
});

// 현재 대국 결과 기록 여부
const isGameSaved = ref(localStorage.getItem("is_game_saved") === "true");

const animateRank = ref(false);
const activeGapSeat = ref<string | null>(null);
const isPanelMenuOpen = ref(false);

const isSaving = ref(false);
const syncProgress = ref(0);
const syncLoaderTitle = ref("구글 스프레드시트 일괄 동기화 중...");
const googleMemberStats = ref<any[]>([]);
const currentSessionSheetName = ref(localStorage.getItem("current_session_sheet_name") || "");

const isShowSpreadsheetIdPrompt = ref(false);
const tempPromptSpreadsheetUrl = ref("");
const isSyncAfterPrompt = ref(false);

const toast = reactive({
  show: false,
  message: "",
  type: "success"
});

const triggerToast = (msg: string, type = "success") => {
  toast.message = msg;
  toast.type = type;
  toast.show = true;
  setTimeout(() => {
    toast.show = false;
  }, 3000);
};

const getOrInitSessionSheetName = async (): Promise<string> => {
  if (!googleInfo.spreadsheetId || !googleInfo.isLoggedIn) {
    const now = new Date();
    const yy = now.getFullYear().toString().slice(-2);
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');
    const dd = now.getDate().toString().padStart(2, '0');
    const yymmdd = `${yy}${mm}${dd}`;
    return `제1회 ${yymmdd}`;
  }
  if (currentSessionSheetName.value) {
    return currentSessionSheetName.value;
  }
  const name = await getNextSessionSheetName(googleInfo.spreadsheetId);
  currentSessionSheetName.value = name;
  localStorage.setItem("current_session_sheet_name", name);
  return name;
};

// 이름이 바뀔 때마다 앞 글자 겹치지 않는 유니크 축약명을 설정하는 감시자
watch(() => players.map(p => p.name), (newNames) => {
  const shorts = getShortNames(newNames);
  players.forEach((p, idx) => {
    p.shortName = shorts[idx];
  });
}, { immediate: true, deep: true });

watch([() => players.map(p => p.displayScore), () => option.sekiOrder], () => {
  players.forEach((p, i) => {
    if (option.sekiOrder) {
      p.realRank = players.filter((x, idx) => x.displayScore > p.displayScore || (x.displayScore === p.displayScore && idx < i)).length + 1;
    } else {
      p.realRank = players.filter(x => x.displayScore > p.displayScore).length + 1;
    }
  });
}, { immediate: true, deep: true });


// 대국 상태 로컬 스토리지 저장 감시자들
watch(players, (newVal) => {
  localStorage.setItem("mahjong_players", JSON.stringify(newVal));
}, { deep: true });

watch(panelInfo, (newVal) => {
  localStorage.setItem("mahjong_panelInfo", JSON.stringify(newVal));
}, { deep: true });

watch(records, (newVal) => {
  localStorage.setItem("mahjong_records", JSON.stringify(newVal));
}, { deep: true });

watch(option, (newVal) => {
  localStorage.setItem("mahjong_option", JSON.stringify(newVal));
}, { deep: true });

/**시작시 언어 변경 및 자리선택 타일창 띄우기*/
onMounted(async () => {
  // 버전 체크를 통한 모바일/데스크톱 브라우저 캐시 강제 갱신 (마이그레이션 적용)
  const CURRENT_VERSION = "20260710_2335";
  const savedVersion = localStorage.getItem("app_version");
  if (savedVersion !== CURRENT_VERSION) {
    localStorage.setItem("app_version", CURRENT_VERSION);
    window.location.reload();
    return;
  }

  await router.isReady();
  changeLocale();
  seatTile.value = secureShuffle(seatTile.value);
  
  // 테마 설정 초기화
  const savedTheme = localStorage.getItem("theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (savedTheme === "dark" || (!savedTheme && prefersDark)) {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }

  // 구글 API 및 GIS 초기화
  try {
    await initGapi();
    if (googleInfo.clientId) {
      initGis(googleInfo.clientId, onGoogleTokenReceived);
      await tryAutoLogin(onGoogleTokenReceived);
    }
  } catch (err) {
    console.warn("Google API Client 로드 실패:", err);
  }

  // 로컬 스토리지에 유효한 진행 대국이 있는지 확인하여 있을 경우 자리뽑기 창을 띄우지 않음
  let hasActiveGame = false;
  const savedPlayersRaw = localStorage.getItem("mahjong_players");
  if (savedPlayersRaw) {
    try {
      const parsed = JSON.parse(savedPlayersRaw);
      const defaultNames = ['▼', '▶', '▲', '◀'];
      hasActiveGame = Array.isArray(parsed) && parsed.length === 4 && parsed.some(p => !defaultNames.includes(p.name));
    } catch (e) {
      // 무시
    }
  }

  if (!hasActiveGame) {
    showModal('choose_seat');
  }

  // iOS/Android 가로모드 주소창 숨김을 위한 꼼수 (스크롤 자동 트리거)
  const triggerHideAddressBar = () => {
    setTimeout(() => {
      window.scrollTo(0, 1);
    }, 200);
  };
  triggerHideAddressBar();
  window.addEventListener('touchstart', triggerHideAddressBar, { once: true });
  window.addEventListener('click', triggerHideAddressBar, { once: true });
  window.addEventListener('resize', triggerHideAddressBar);
})



/**전체화면 활성화/비활성화*/
const toggleFullScreen = () => {
  const element=document.documentElement;
  if (!document.fullscreenElement) {
    if (element.requestFullscreen)
      return element.requestFullscreen();
  } 
  else {
    if (document.exitFullscreen)
      return document.exitFullscreen();
  }
}

/**언어 변경*/
const changeLocale = () => {
  const targetLanguage = 'ko'; // 한국어로 고정
  locale.value=targetLanguage; // 언어 변경
  document.title=t('pageTitle') // 페이지 이름 설정
  document.documentElement.setAttribute('lang', targetLanguage); // lang 속성 변경
  localStorage.setItem("language", locale.value); // 로컬 스토리지에 저장
}

// 현재 국(Round)의 리치 선언자 순서 추적용
const riichiOrder = ref<number[]>([]);

/**리치 활성화/비활성화*/
const toggleActiveRiichi = (seat: string) => {
  // 이미 대국이 종료된 상태(결과 화면 표시 중 등)면 리치 지불 금지
  if (records.time.length > 0 && records.time[records.time.length - 1] === '결과') {
    return;
  }
  let idx=players.findIndex(x => x['seat']===seat); // 위치 기준 인덱스 반환
  if (!isNaN(players[idx].effectScore)) // 점수변동 이펙트 도중이면 실행 x
    return;
  if (players[idx].isRiichi===false){ // 리치 활성화
    if (players[idx].displayScore<1000 && option.tobi===true) // 리치를 걸수 없을 때
      return;
    else{ // 1000점 이상 있거나 음수리치가 가능하다면
      players[idx].displayScore-=1000;
      players[idx].isRiichi=true;
      panelInfo.riichi++;
      riichiOrder.value.push(idx); // 리치 선언 순서 기록
      
      // 랜덤한 각도 및 위치 오프셋 추가 (물리 효과용)
      (players[idx] as any).riichiAngle = Number((Math.random() * 12 - 6).toFixed(2));
      (players[idx] as any).riichiOffsetX = Number((Math.random() * 16 - 8).toFixed(2));
      (players[idx] as any).riichiOffsetY = Number((Math.random() * 12 - 6).toFixed(2));
    }
  }
  else{ // 리치 비활성화
    players[idx].displayScore+=1000;
    players[idx].isRiichi=false;
    panelInfo.riichi--;
    
    // 리치 선언 순서에서 삭제
    const rIdx = riichiOrder.value.indexOf(idx);
    if (rIdx > -1) {
      riichiOrder.value.splice(rIdx, 1);
    }
    
    // 초기화
    (players[idx] as any).riichiAngle = 0;
    (players[idx] as any).riichiOffsetX = 0;
    (players[idx] as any).riichiOffsetY = 0;
  }
}

let gapTimer: ReturnType<typeof setTimeout> | null = null;
let gapPressStartTime = 0;
let isHoldingGap = false;

/**모든 플레이어의 점수 차이 및 순위 표시 초기화*/
const clearGapScores = () => {
  activeGapSeat.value = null;
  if (gapTimer) {
    clearTimeout(gapTimer);
    gapTimer = null;
  }
  isHoldingGap = false;
  for (let i=0;i<players.length;i++){
    players[i].gapScore=NaN; // 점수 차 표시 끄기
    players[i].rank=0; // 순위 표시 끄기
  }
}

/**바탕화면(빈 공간) 클릭 시 점수 차이 해제*/
const onBackgroundClick = () => {
  clearGapScores();
  isPanelMenuOpen.value = false;
}

/**점수 차이 활성화 (마우스/터치 다운)*/
const startShowGap = (seat: string) => {
  let idx=players.findIndex(x => x['seat']===seat); // 위치 기준 인덱스 반환
  if (!isNaN(players[idx].effectScore)) // 점수변동 이펙트 도중이면 실행 x
    return;

  // 이미 켜져있는 상태에서 다시 짧게 클릭(mousedown)한 것이라면 토글 오프 처리
  if (activeGapSeat.value === seat && !isHoldingGap) {
    clearGapScores();
    return;
  }

  if (gapTimer) {
    clearTimeout(gapTimer);
    gapTimer = null;
  }
  
  activeGapSeat.value = seat;
  isHoldingGap = true;
  gapPressStartTime = Date.now();

  for (let i=0;i<players.length;i++){
    if (i!==idx) // 본인이 아니면 점수 차 표시 켜기
      players[i].gapScore=players[idx].displayScore-players[i].displayScore;
    else
      players[i].gapScore=NaN;
    
    // 순위 표시 켜기 (동점 시 석순 옵션 반영!)
    players[i].rank=players.filter((x) => {
      if (x.displayScore > players[i].displayScore) return true;
      if (x.displayScore === players[i].displayScore && option.sekiOrder) {
        return players.indexOf(x) < i;
      }
      return false;
    }).length + 1;
  }

  // 1초 후 자동 꺼짐 타이머 설정
  gapTimer = setTimeout(() => {
    // 1초가 도래했을 때 사용자가 더 이상 꾹 누르고 있지 않은 경우만 초기화 (단순 탭인 경우)
    if (!isHoldingGap) {
      clearGapScores();
    }
  }, 1000);
}

/**점수 차이 비활성화 시도 (마우스/터치 업)*/
const endShowGap = (_seat: string) => {
  isHoldingGap = false;
  const elapsed = Date.now() - gapPressStartTime;
  // 1초 이상 누르고 있던 경우 뗄 때 바로 초기화
  if (elapsed >= 1000) {
    clearGapScores();
  }
}

/**바람 및 라운드 변경*/
const changeWindsAndRounds = () => {
  let allWinds=["東", "南", "西", "北"];
  let cnt=0;
  let playerWinds=players.map(x => x.wind); // 개인 바람 복사
  playerWinds.unshift(playerWinds.pop()!); // 개인 바람 변경
  players.forEach((x, idx) => {x.wind=playerWinds[idx];}); // 개인 바람 덮어씌우기
  for (let i=0;i<allWinds.length;i++){
    if (panelInfo.wind===allWinds[i]) // 현재 라운드 계산
      cnt+=i*4;
  }
  cnt+=panelInfo.round; // 국 증가
  panelInfo.wind=allWinds[Math.floor((cnt%16)/4)]; // 현재 바람 수정
  panelInfo.round=cnt%4+1; // 현재 라운드 수정
}

/**점수 변동 효과*/
const changeScores = (targetRiichi: number, onComplete?: () => void) => {
  animateRank.value = true;
  let currentScore=players.map(x => x.displayScore); // 현재 점수 저장
  let arrCut: number[][]=[[],[],[],[]];
  
  // 1. 이전 점수 기준 순위 계산 (동점 석순 옵션 반영)
  let oldRanks = players.map((_, i) => {
    if (option.sekiOrder) {
      return players.filter((x, idx) => x.displayScore > players[i].displayScore || (x.displayScore === players[i].displayScore && idx < i)).length + 1;
    } else {
      return players.filter(s => s.displayScore > players[i].displayScore).length + 1;
    }
  });

  // 2. 최종 점수를 기준으로 순위 미리 계산 (동점 석순 옵션 반영)
  let finalScores = players.map(x => x.displayScore + x.deltaScore);
  let finalRanks = players.map((_, i) => {
    if (option.sekiOrder) {
      return finalScores.filter((s, idx) => s > finalScores[i] || (s === finalScores[i] && idx < i)).length + 1;
    } else {
      return finalScores.filter(s => s > finalScores[i]).length + 1;
    }
  });

  for (let i=0;i<players.length;i++){
    for (let j=0;j<50;j++) // 변경될 점수 사이를 50등분해서 저장
      arrCut[i].push(currentScore[i]+(players[i].deltaScore/50)*(j+1));
    players[i].effectScore=NaN; // 변동 수치 완전히 안 보이고 즉시 숨김 처리!
    players[i].rank=oldRanks[i]; // 등수 연출 시작 시점에는 이전 등수 노출
  }

  let startRiichi = panelInfo.riichi;

  // 지연 시간 없이 즉각적인 점수 롤링 시작!
  let timecnt=0;
  let effect=setInterval(() => { // 시간에 따라 반복
    for (let i=0;i<players.length;i++)
      players[i].displayScore=arrCut[i][timecnt]; // 이펙트 점수 변경

    // 리치봉 개수 역동적 감소 연출 (매우 빠르게: 첫 10단계, 약 200ms 만에 0으로 수렴)
    if (startRiichi > targetRiichi) {
      panelInfo.riichi = Math.max(targetRiichi, Math.ceil(startRiichi - (startRiichi - targetRiichi) * (timecnt + 1) / 10));
    }

    timecnt++;
    if (timecnt>=50){
      clearInterval(effect);
      timecnt=0;
      
      // 연출 종료 2.2초 후에 애니메이션 해제 (모든 슬라이드아웃/슬라이드인/팝업 완료 후)
      setTimeout(() => {
        animateRank.value = false;
      }, 2200);

      // 1. 모든 이전 등수를 동시에 페이드아웃 및 슬라이드 아웃시킴 (-1로 설정하여 상시 표시 상태여도 강제 퇴장)
      for (let i=0;i<players.length;i++){
        players[i].rank=-1; // 등수 감추기 (동시에 Slide Out & Fade Out 트리거)
      }
      
      // 2. 기존 등수가 완전히 사라진 후(150ms 대기 - 더 빠른 트랜지션 적용), 4등부터 1등까지 차례대로 슬라이드 인
      setTimeout(() => {
        for (let i=0;i<players.length;i++){
          let delay = (4 - finalRanks[i]) * 200;
          setTimeout(() => {
            players[i].rank=finalRanks[i]; // 순차적으로 새로운 등수 켜기 (Slide In 트리거)
          }, delay);
        }
        
        // 모든 등수 출현이 끝난 후(최대 600ms) 일정 시간(1250ms) 동안 대기한 후 모든 등수를 동시에 끄기 (총 1850ms)
        setTimeout(() => {
          for (let i=0;i<players.length;i++){
            players[i].rank=0;
          }
        }, 1850);
      }, 150);

        // 3. 모든 등수의 페이드인/슬라이드가 완료되고 1등의 팝업 줌아웃까지 마무리된 시점(150ms 대기 + 1등 연출 600ms + 팝업완료 650ms = 1400ms)에 바람 변경
        setTimeout(() => {
          if (onComplete) onComplete();
        }, 1400);
    }
  }, 20); // 0.02초 * 50번 = 1초동안 실행
}

/**실제 점수계산후 반환*/
const calculateScore = (who: number) => {
  let arrFan=[1, 2, 3, 4, 5, 6, 8, 11, 13, 13, 14, 15, 16, 17, 18];
  let arrBu=[20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 110];
  let arrMangan=[2000,3000,3000,4000,4000,4000,6000,6000,8000,16000,24000,32000,40000,48000]; // 만관 이상 인당 점수
  let fan=arrFan[scoringState.inputFan], bu=arrBu[scoringState.inputBu];
  let baseScore=0;
  if ((fan===3 && bu>=70) || (fan===4 && bu>=40)) // 3판 70부, 4판 40부 이상이면 만관
    fan=5;
  if (((fan===3 && bu>=60) || (fan===4 && bu>=30)) && option.roundMangan) // 절상만관시 3판 60부, 4판 30부 인정
    fan=5;
  if (5<=fan)
    baseScore=arrMangan[fan-5]; // 만관 이상이면 배열 참조
  else
    baseScore=bu*Math.pow(2,fan+2); // 아니면 점수 계산식으로 계산
  if (modalInfo.status==='ron'){ // 론일 때
    if (players[scoringState.whoWin].wind==='東') // 친이라면 6배
      return Math.ceil(baseScore*6/100)*100;
    else // 자라면 4배
      return Math.ceil(baseScore*4/100)*100;
  }
  else if (modalInfo.status==='tsumo'){ // 쯔모일 때
    if (players[scoringState.whoWin].wind==='東'){ // 이긴사람이 친이라면
      if (who===scoringState.whoWin) // 이겼다면 3배
        return Math.ceil(baseScore*2/100)*100*3;
      else // 졌다면 그대로
        return Math.ceil(baseScore*2/100)*100;
    }
    else{ // 이긴사람이 자라면
      if (who===scoringState.whoWin) // 내가 이겼다면
        return Math.ceil(baseScore*2/100)*100+Math.ceil(baseScore/100)*100*2;
      else if (players[who].wind==='東') // 내가 친이라면 
        return Math.ceil(baseScore*2/100)*100;
      else
        return Math.ceil(baseScore/100)*100;
    }
  }
  return NaN; // 잘못된 경우
}

/**동1국 처음으로 리셋*/
const resetAll = () => {
  let allWinds=["東", "南", "西", "北"];
  while (1<records.time.length){ // 점수기록 지우기
    records.time.pop();
    for (let i=0;i<records.score.length;i++)
      records.score[i].pop();
  }
  records.time[0] = 'ㅤ'; // 첫 번째 열의 종료 구분 문자 원상복구
  while (1<records.riichi.length){ // 리치, 화료, 방총기록 지우기
    records.riichi.pop();
    records.win.pop();
    records.lose.pop();
    if (records.tenpai) records.tenpai.pop();
    if (records.status) records.status.pop();
    if (records.riichiOrder) records.riichiOrder.pop();
    if (records.dealer) records.dealer.pop();
  }
  for (let i=0;i<records.score.length;i++)
    records.score[i][0]=option.startingScore;
  players.forEach((x) => {x.isRiichi=false;}); // 리치봉 제거
  players.forEach((x) => {x.displayScore=option.startingScore;}); // 점수 설정
  panelInfo.wind="東"; // 장풍 설정
  panelInfo.round=1; // 국 설정
  panelInfo.renchan=0; // 연장 설정
  players.forEach((x, idx) => {x.wind=allWinds[idx];}); // 개인 바람 설정
  panelInfo.riichi=0; // 리치봉 설정

  // 리치 선언자 순서 초기화
  riichiOrder.value = [];

  // 기록 여부 초기화
  isGameSaved.value = false;
  localStorage.removeItem("is_game_saved");
}

/**모달 창 켜기*/
const showModal = (type: string, status?: string) => {
  isPanelMenuOpen.value = false;
  
  if (type === 'result_chart') {
    chartPlayers.value = players.map(p => ({ name: p.name }));
    chartRecords.value = JSON.parse(JSON.stringify(records));
  }
  
  Object.assign(modalInfo, {
    isOpen: true,
    type: type,
    status: status,
  });
  // 대국 종료 라벨(결과) 세팅은 showModal이 아닌 실제 게임 종료 국 정산 조건문 내부에서 직접 진행하므로 제거합니다.
}

/**모달 창 끄기*/
const hideModal = () => {
  if (modalInfo.type==='set_options'){ // 옵션 설정창이라면 확인
    let arrows=["▼", "▶", "▲", "◀"];
    let cntScore=players.reduce((acc, x) => acc+x.displayScore, panelInfo.riichi*1000); // 현재 총점
    let cntUma=option.rankUma.reduce((acc, x) => acc+x, 0); // 현재 총우마
    for (let i=0;i<players.length;i++){
      if (players[i].name==='') // 이름이 없는 경우
        players[i].name=arrows[i]; // 기본이름으로 추가
    }
    if (option.startingScore*4!==cntScore){ // 시작점수가 변경되었다면
      if (option.startingScore%100!==0 || String(option.startingScore)==='') // 이상한 값이면 롤백
        option.startingScore=cntScore/4;
      else // 아니라면 동1국으로 롤백
        resetAll();
    }
    if (option.startingScore>option.returnScore) // 시작점수가 반환점수보다 큰 경우
      option.returnScore=option.startingScore;
    if (cntUma!==0) // 우마 합계가 0이 아니라면 초기화
      option.rankUma=[20, 10, -10, -20];
  }
  Object.assign(modalInfo, { // 모달창 끄기
    isOpen: false,
    type: "",
    status: "",
  });
  Object.assign(scoringState, { // 점수계산 관련 변수 초기화
    whoWin: -1,
    whoLose: -1,
    whoCheat: -1,
    isFao: false,
    whoFao: -1,
    inputFan: 0,
    inputBu: 2,
    inputFao: -1,
  });
  players.forEach((x) => { // 승자/패자 및 변동점수 초기화
    x.deltaScore=0;
    x.isWin=false;
    x.isLose=false;
    x.isTenpai=false;
    x.isNagashi=false;
  });
}

/**화살표 버튼 동작 설정*/
const setArrowButton = (status: string, idx: number) => {
  if (status==='win') // 화료 버튼
    players[idx].isWin=!players[idx].isWin;
  else if (status==='lose'){ // 방총 버튼
    if (players[idx].isWin) // 화료한 사람이랑 겹치는 경우 비활성화
      return;
    if (players[idx].isLose===false){ // 방총당한 사람을 바꾸는 경우
      for (let i=0;i<players.length;i++){
        if (i!==idx) // 자신이 아닌 사람들의 체크를 해제
          players[i].isLose=false;
      }
    }
    players[idx].isLose=!players[idx].isLose;
  }
  else if (status==='cheat'){ // 촌보 버튼
    if (scoringState.whoCheat===idx)
      scoringState.whoCheat=-1;
    else
      scoringState.whoCheat=idx;
  }
  else if (status==='fao'){ // 책임지불 버튼
    if (scoringState.whoWin===idx || scoringState.whoLose===idx) // 현재 승자 또는 패자와 같을때 비활성화
      return;
    if (scoringState.whoFao===idx)
      scoringState.whoFao=-1;
    else
      scoringState.whoFao=idx;
  }
  else if (status==='tenpai') // 텐파이 버튼
    players[idx].isTenpai=!players[idx].isTenpai;
  else if (status==='nagashi'){ // 유국만관 버튼
    if (players[idx].isNagashi===true)
      players[idx].isNagashi=false;
    else {
      let cntNagashi=players.filter(x => x.isNagashi===true).length;
      if (cntNagashi < 2)
        players[idx].isNagashi=true;
    }
  }
}

/**토글 버튼 동작 설정*/
const setToggleButton = (status: string) => {
  if (status==='isfao') // 점수창 책임지불 OX 토글
    scoringState.isFao=!scoringState.isFao;
  else if (status==='roundmangan') // 절상만관 토글
    option.roundMangan=!option.roundMangan;
  else if (status==='tobi') // 토비 토글
    option.tobi=!option.tobi;
  else if (status==='cheatscore') // 촌보점수 토글
    option.cheatScore=!option.cheatScore;
  else if (status==='endriichi') // 공탁처리 토글
    option.riichiPayout=!option.riichiPayout;
  else if (status==='alwaysshowrank') // 등수 상시 표시 토글
    option.alwaysShowRank=!option.alwaysShowRank;
  else if (status==='sekiorder') // 동점 석순 토글
    option.sekiOrder=!option.sekiOrder;
}

/**판/부 버튼 동작 설정*/
const setFanBuButton = (status: string, idx: number) => {
  if (status==='fan'){ // 판 체크
    if (idx>=9 && scoringState.inputFan===idx) // 역만일경우 처리
      scoringState.inputFan<14 ? scoringState.inputFan++ : scoringState.inputFan=9;
    else{
      scoringState.isFao=false; // 책임지불 초기화
      scoringState.inputFan=idx;
    }
    scoringState.inputBu=2; // 30부로 초기화
  }
  else if (status==='bu'){ // 부 체크
    if (modalInfo.status==='ron' && idx===0) // 론일때 20부 이하 비활성화
      return;
    else if (scoringState.inputFan===0 && idx<=1) // 1판 25부 이하 비활성화
      return;
    else if (scoringState.inputFan>=4) // 만관 이상일때 부수 비활성화
      return;
    scoringState.inputBu=idx;
  }
  else if (status=='inputfao'){ // 책임지불 점수창
    if (scoringState.inputFan-9<idx) // 입력 판수보다 크면 불가능
      return;
    scoringState.inputFao=idx;
  }
}



/**화료 및 방총 불가능한 경우 반환*/
const checkInvalidStatus = (status: string) => {
  let cntWin=players.filter(x => x.isWin===true).length; // 화료 인원 세기
  let cntLose=players.filter(x => x.isLose===true).length; // 방총 인원 세기
  if (status==='win'){ // 화료일때
    if (cntWin===0 || cntWin===4) // 화료한 사람이 없거나 4명임 (불가능한 경우)
      return;
    showModal('check_player_lose');
  }
  else if (status==='lose'){ // 방총일때
    if (cntWin!==1 && cntLose===0) // 2명 이상 화료했는데 쯔모임 (불가능한 경우)
      return;
    if (!cntLose){ // 쯔모
      scoringState.whoWin=players.findIndex(x => x['isWin']===true); // 승자 찾아서 저장
      showModal('choose_score', 'tsumo');
    }
    else{ // 론
      scoringState.whoLose=players.findIndex(x => x['isLose']===true); // 패자 찾아서 저장
      for (let i=0;i<players.length;i++){
        if (players[(scoringState.whoLose+i)%4].isWin===true){ // 승자 찾아서 저장 (선하네 순서로 탐색)
          scoringState.whoWin=(scoringState.whoLose+i)%4;
          break;
        }
      }
      showModal('choose_score', 'ron');
    }
  }
  else if (status==='fao'){ // 책임지불일때
    scoringState.inputFao=scoringState.inputFan-9;
    if (scoringState.whoFao===-1) // 책임지불할 사람이 없음 (불가능한 경우)
      return;
    if (scoringState.inputFan>=10) // 2배역만 이상이면 점수 선택
      showModal('choose_score_fao', modalInfo.status);
    else
      calculateWin();
  }
  else if (status==='cheat'){ // 촌보일때
    if (scoringState.whoCheat===-1) // 촌보한 사람이 없음 (불가능한 경우)
      return;
    calculateCheat();
  }
  else if (status==='tenpai') // 유국일때
    calculateDraw();
  else if (status==='nagashi') // 유국만관일때
    calculateNagashi();
}

/**화료 점수계산*/
const calculateWin = () => {
  if (modalInfo.status==='tsumo'){ // 쯔모
    if (scoringState.isFao===false){
      for (let i=0;i<players.length;i++){
        if (i===scoringState.whoWin) // 승자
          players[i].deltaScore+=calculateScore(i)+panelInfo.riichi*1000+panelInfo.renchan*300;
        else // 패자
          players[i].deltaScore-=calculateScore(i)+panelInfo.renchan*100;
      }
    }
    else{ // 책임지불시
      let tmp=scoringState.inputFan;
      scoringState.inputFan=scoringState.inputFao+9; // 책임지불할 점수
      players[scoringState.whoWin].deltaScore+=calculateScore(scoringState.whoWin)+panelInfo.riichi*1000+panelInfo.renchan*300;
      players[scoringState.whoFao].deltaScore-=calculateScore(scoringState.whoWin)+panelInfo.renchan*300;
      scoringState.inputFan=tmp-scoringState.inputFao-1; // 롤백
      if (scoringState.inputFan>=9){ // 다른사람도 여전히 지불해야 하는 경우
        for (let i=0;i<players.length;i++){
          if (i===scoringState.whoWin) // 승자
            players[i].deltaScore+=calculateScore(i);
          else // 패자
            players[i].deltaScore-=calculateScore(i);
        }
      }
    }
    showModal('show_score', 'tsumo');
  }
  else if (modalInfo.status==='ron'){ // 론
    let firstWinner=-1, chkFinish=false;
    for (let i=1;i<players.length;i++){
      if (players[(scoringState.whoLose+i)%4].isWin===true){
        firstWinner=(scoringState.whoLose+i)%4; // 선하네 판별
        break;
      }
    }
    if (firstWinner===scoringState.whoWin) { // 승자+선하네
      players[scoringState.whoWin].deltaScore+=calculateScore(scoringState.whoWin)+panelInfo.riichi*1000+panelInfo.renchan*300;
      players[scoringState.whoLose].deltaScore-=calculateScore(scoringState.whoLose)+panelInfo.renchan*300;
    }
    else{ // 나머지 승자
      players[scoringState.whoWin].deltaScore+=calculateScore(scoringState.whoWin);
      players[scoringState.whoLose].deltaScore-=calculateScore(scoringState.whoLose);
    }
    if (scoringState.isFao===true){ // 책임지불시 절반 지불
      scoringState.inputFan=scoringState.inputFao+9; // 책임지불할 점수
      players[scoringState.whoLose].deltaScore+=Math.floor(calculateScore(scoringState.whoLose)/2);
      players[scoringState.whoFao].deltaScore-=Math.floor(calculateScore(scoringState.whoLose)/2);
    }
    for (let i=1;i<players.length;i++){
      if ((scoringState.whoWin+i)%4===scoringState.whoLose){ // 1바퀴를 모두 돌았을때
        chkFinish=true;
        break;
      }
      else if (players[(scoringState.whoWin+i)%4].isWin===true){ // 다음 승자가 남아있을때
        scoringState.whoWin=(scoringState.whoWin+i)%4; // 현재 승자 변경
        scoringState.isFao=false;
        scoringState.whoFao=-1;
        scoringState.inputFan=0;
        scoringState.inputBu=2;
        showModal('choose_score', 'ron'); // 다음 승자 점수 입력
        break;
      }
    }
    if (chkFinish) // 모든 승자의 점수를 체크했다면
      showModal('show_score', 'ron');
  }
}

/**유국 점수계산*/
const calculateDraw = () => {
  players.forEach((x) => {x.isTenpai||=x.isRiichi;}); // 리치자 텐파이로 변경
  let cntTenpai=players.filter(x => x.isTenpai===true).length; // 총 텐파이 인원
  if (0<cntTenpai && cntTenpai<4){ //올텐파이나 올노텐이 아니라면
    for (let i=0;i<players.length;i++){
      if (players[i].isTenpai===true) // 텐파이라면
        players[i].deltaScore=3000/cntTenpai; // 3000 나눠서 획득
      else
        players[i].deltaScore=-3000/(players.length-cntTenpai); 
    }
  }
  showModal('show_score', 'normal_draw');
}

/**유국만관 점수계산*/
const calculateNagashi = () => {
  players.forEach((x) => {x.isTenpai||=x.isRiichi;}); // 리치자 텐파이로 변경

  // 1. 변동점수 초기화
  players.forEach((x) => {
    x.deltaScore=0;
  });

  // 2. 동가부터 반시계 방향(동->남->서->북) 순으로 유국만관 달성자 정렬
  const windOrder = ["東", "南", "西", "北"];
  const nagashiPlayers: PlayerInterface[] = [];
  windOrder.forEach(w => {
    const p = players.find(x => x.wind === w);
    if (p && p.isNagashi === true) {
      nagashiPlayers.push(p as PlayerInterface);
    }
  });

  // 3. 만관쯔모 차례대로 한 것으로 점수 합산
  nagashiPlayers.forEach(winner => {
    if (winner.wind === "東") {
      // 오야 유국만관: 4000 All
      players.forEach(p => {
        if (p === winner) {
          p.deltaScore += 12000;
        } else {
          p.deltaScore -= 4000;
        }
      });
    } else {
      // 자 유국만관: 오야(동가)한테 4000, 다른 자한테 2000
      players.forEach(p => {
        if (p === winner) {
          p.deltaScore += 8000;
        } else if (p.wind === "東") {
          p.deltaScore -= 4000;
        } else {
          p.deltaScore -= 2000;
        }
      });
    }
  });

  showModal('show_score', 'normal_draw');
}

/**촌보 점수계산*/
const calculateCheat = () => {
  if (option.cheatScore===true){ // 만관 지불
    for (let i=0;i<players.length;i++){
      if (scoringState.whoCheat===i){
        if (players[i].wind==='東') // 친일경우
          players[i].deltaScore=-12000;
        else
          players[i].deltaScore=-8000;
      }
      else{
        if (players[i].wind==='東' || players[scoringState.whoCheat].wind==='東') //촌보자가 친이거나 내가 친일때
          players[i].deltaScore=4000;
        else
          players[i].deltaScore=2000;
      }
    }
  }
  else{ // 3000점씩 지불 
    for (let i=0;i<players.length;i++){
      if (scoringState.whoCheat===i)
        players[i].deltaScore=-9000;
      else
        players[i].deltaScore=3000;
    }
  }
  showModal('show_score', 'cheat');
}

/**국 결과값 처리*/
const saveRound = () => {
  // 1. 필요한 상태들을 동기적으로 먼저 안전하게 캡처 (hideModal이 동기적으로 상태를 초기화하기 때문)
  let status = modalInfo.status;
  
  let chinIdx = players.findIndex(x => x['wind']==='東');
  let isChinWin = players[chinIdx].isWin;
  let isChinTenpai = players[chinIdx].isTenpai;

  // 1.5. 친의 연장(Renchan) 여부 미리 계산
  let isRenchan = false;
  if (status === 'tsumo' || status === 'ron') {
    if (isChinWin) {
      isRenchan = true;
    }
  } else if (status === 'normal_draw') {
    if (isChinTenpai) {
      isRenchan = true;
    }
  } else if (status === 'special_draw') {
    isRenchan = true;
  }

  // 1.6. 리치봉 타겟 값 계산 (수거 여부에 따른 동적 카운트다운용)
  let targetRiichi = panelInfo.riichi;

  if (status === 'tsumo' || status === 'ron') {
    targetRiichi = 0;
  }

  if (status==='cheat'){ // 촌보의 경우 리치봉 반환
    for (let i=0;i<players.length;i++){
      if (players[i].isRiichi===true){
        players[i].displayScore+=1000;
        players[i].isRiichi=false;
        panelInfo.riichi--;
      }
    }
  }

  // 점수 기록창에 기록 남기기 (동기적 기록)
  for (let i=0;i<players.length;i++){ // 점수 기록창에 점수 기록
    records.score[i].push(players[i].deltaScore);
    records.score[i].push(players[i].displayScore+players[i].deltaScore);
  }
  records.time.push(panelInfo.wind+panelInfo.round+'局 '+panelInfo.renchan+'本場'); // 점수 기록창에 국+본장 기록
  records.time.push('ㅤ');
  records.riichi.push(players.map(x => x.isRiichi)); // 리치 기록에 추가
  records.win.push(players.map(x => x.isWin)); // 화료 기록에 추가
  records.lose.push(players.map(x => x.isLose)); // 방총 기록에 추가

  // 통계 전용 데이터 기록
  if (!records.tenpai) records.tenpai = [[false, false, false, false]];
  if (!records.status) records.status = ["initial"];
  if (!records.riichiOrder) records.riichiOrder = [[]];
  if (!records.dealer) records.dealer = [0];

  records.tenpai.push(players.map(x => x.isTenpai));
  records.status.push(status);
  records.riichiOrder.push([...riichiOrder.value]);
  records.dealer.push(chinIdx);

  // 리치 선언 순서 초기화
  riichiOrder.value = [];

  // 점수 변동 이펙트 애니메이션 실행 (완료 후 연장/서입/게임 종료 분기 수행)
  changeScores(targetRiichi, () => {
    // 1) 들통(tobi) 여부 검증
    let hasTobi = option.tobi && players.some(p => p.displayScore < 0);
    if (hasTobi) {
      if (records.time.length > 0 && records.time[records.time.length - 1] === 'ㅤ') {
        records.time[records.time.length - 1] = '결과';
      }
      showModal('result_sheet');
      return;
    }

    let curWind = panelInfo.wind;
    let curRound = panelInfo.round;

    // 3) 남4국 / 서풍전 연장 및 종료 조건 분기
    if (curWind === '南' && curRound === 4) {
      if (isRenchan) {
        // 친 연장 시에는 남4국 유지 및 연장봉 추가
        panelInfo.renchan++;
        if (status === 'tsumo' || status === 'ron') {
          panelInfo.riichi = 0;
        }
      } else {
        // 친 연장 실패 시: 반환점수를 넘은 사람이 있는지 검증
        let hasPlayerAboveReturn = players.some(p => p.displayScore >= option.returnScore);
        if (hasPlayerAboveReturn) {
          // 반환점수를 넘은 사람이 있으면 서입 없이 게임 종료
          if (records.time.length > 0 && records.time[records.time.length - 1] === 'ㅤ') {
            records.time[records.time.length - 1] = '결과';
          }
          showModal('result_sheet');
        } else {
          // 반환점수를 넘은 사람이 없으면 서입 (서1국 진입)
          changeWindsAndRounds();
          panelInfo.renchan = 0;
          panelInfo.riichi = 0;
        }
      }
    } else if (curWind === '西') {
      if (isRenchan) {
        // 서풍전 친 연장 시 서입 국 유지 및 연장봉 추가
        panelInfo.renchan++;
        if (status === 'tsumo' || status === 'ron') {
          panelInfo.riichi = 0;
        }
      } else {
        // 친 연장 실패 시: 반환점수를 넘은 사람이 있는지 검증
        let hasPlayerAboveReturn = players.some(p => p.displayScore >= option.returnScore);
        if (hasPlayerAboveReturn || curRound === 4) {
          // 반환점수를 넘은 사람이 있거나 서4국이 끝나면 게임 종료
          if (records.time.length > 0 && records.time[records.time.length - 1] === 'ㅤ') {
            records.time[records.time.length - 1] = '결과';
          }
          showModal('result_sheet');
        } else {
          // 다음 서국으로 진행
          changeWindsAndRounds();
          panelInfo.renchan = 0;
          panelInfo.riichi = 0;
        }
      }
    } else {
      // 일반적인 국 (동풍전 및 남1~남3국)
      if (isRenchan) {
        panelInfo.renchan++;
      } else {
        changeWindsAndRounds();
        panelInfo.renchan = 0;
      }
      if (status === 'tsumo' || status === 'ron') {
        panelInfo.riichi = 0;
      }
    }
  });

  players.forEach((x) => {x.isRiichi=false;}); // 리치봉 수거
  hideModal(); // 모달 창 끄기
}

/**주사위 굴리기*/
const rollDice = () => {
  let timecnt=0;
  dice.wallDirection=[false, false, false, false]; // 패산 떼는 방향 초기화
  let roll=setInterval(() => { // 시간에 따라 반복
    dice.value[0]=getSecureRandomInt(6)+1;
    dice.value[1]=getSecureRandomInt(6)+1;
    timecnt++;
    if (timecnt>=10){
        clearInterval(roll);
        dice.wallDirection[(dice.value[0]+dice.value[1]-1)%4]=true; // 패산 떼는 방향 표시
    }
  }, 50); // 0.05초 * 10번 = 0.5초동안 실행
}

/**점수 기록 복사*/
const copyRecord = () => {
  let str=t('resultSheet.name')+'\t';
  for (let i=0;i<players.length;i++)
    str+=players[i].name+'\t'; // 이름 복사
  str+='\n';
  for (let i=0;i<records.time.length;i++){
    if (records.time[i]!=="ㅤ") // 공백 제거
      str+=records.time[i]; // 라운드 복사
    str+='\t';
    for (let j=0;j<records.score.length;j++){
      if (records.score[j][i]!==0 || i%2===0) // 0점 이동 제거
        str+=String(records.score[j][i]); // 점수 복사
      str+='\t';
    }
    str+='\n';
  }
  navigator.clipboard.writeText(str); // 클립보드로 복사
  showModal(t('comments.copyRecord'));
}

/**해당 국으로 롤백하기*/
const rollbackRecord = (idx: number) => {
  let allWinds=["東", "南", "西", "北"];
  let arr=records.time[idx].match(/[\u4e00-\u9fff]|\d+|\S/g)!; // 시간 값 분리
  let sumScore=0;
  while (idx<records.time.length){ // 점수기록 지우기
    records.time.pop();
    for (let i=0;i<records.score.length;i++)
      records.score[i].pop();
  }
  while (Math.floor(idx/2)+1<records.riichi.length){ // 리치, 화료, 방총기록 지우기
    records.riichi.pop();
    records.win.pop();
    records.lose.pop();
    if (records.tenpai) records.tenpai.pop();
    if (records.status) records.status.pop();
    if (records.riichiOrder) records.riichiOrder.pop();
    if (records.dealer) records.dealer.pop();
  }
  players.forEach((x) => {x.isRiichi=false;}); // 리치봉 제거
  for (let i=0;i<records.score.length;i++){
    players[i].displayScore=Number(records.score[i][records.score[i].length-1]); // 점수 설정
    sumScore+=players[i].displayScore;
  }
  panelInfo.wind=arr[0]; // 장풍 설정
  panelInfo.round=Number(arr[1]); // 국 설정
  panelInfo.renchan=Number(arr[3]); // 연장 설정
  for (let i=1;i<panelInfo.round;i++)
    allWinds.unshift(allWinds.pop()!); // 현재 바람 세기
  players.forEach((x, idx) => {x.wind=allWinds[idx];}); // 개인 바람 설정
  panelInfo.riichi=Math.floor((option.startingScore*4-sumScore)/1000); // 리치봉 설정
  hideModal(); // 모달 창 끄기
}

const isManualLogin = ref(false);

// 구글 토큰 수령 시 콜백
const onGoogleTokenReceived = async (_token: string) => {
  googleInfo.isLoggedIn = true;
  googleInfo.syncMode = "google";
  localStorage.setItem("sync_mode", "google");

  if (isManualLogin.value) {
    isManualLogin.value = false;
    
    // 스프레드시트 ID가 없으면, 데이터 로드를 생략하고 주소 입력 모달을 즉시 띄움 (모바일 제스처 체인 유지)
    if (!googleInfo.spreadsheetId) {
      triggerToast("로그인 완료! 스프레드시트 주소를 입력해 주세요.");
      tempPromptSpreadsheetUrl.value = "";
      isShowSpreadsheetIdPrompt.value = true;
      return;
    }
    
    // 로딩 진행바 팝업 켜기
    isSaving.value = true;
    syncLoaderTitle.value = "구글 스프레드시트 데이터 불러오는 중...";
    syncProgress.value = 10;

    try {
      // 1. 스프레드시트 필수 구조 검증 (35%)
      syncProgress.value = 35;
      if (googleInfo.spreadsheetId) {
        const isValid = await verifySpreadsheetStructures(googleInfo.spreadsheetId);
        if (!isValid) {
          googleInfo.memberList = [];
          googleInfo.todayMembers = [];
          isSaving.value = false;
          return;
        }
      }

      // 2. 전체 멤버 목록 로드 (70%)
      syncProgress.value = 70;
      await loadMemberList();

      // 3. 전체 멤버별 통계 로드 (95%)
      syncProgress.value = 95;
      try {
        const stats = await fetchMemberStats(googleInfo.spreadsheetId);
        googleMemberStats.value = stats;
      } catch (statsErr) {
        console.warn("로그인 시 통계 로드 실패:", statsErr);
      }

      // 4. 로드 완수 (100%)
      syncProgress.value = 100;

      // 0.5초 대기 후 로더를 닫고 토스트 및 회차 선택 분기 팝업 기동
      setTimeout(async () => {
        isSaving.value = false;
        triggerToast("로그인 완료!");
        await loadGoogleSessions();
        isShowSessionChoosePopup.value = true;
      }, 500);

    } catch (err) {
      console.error("로그인 후 스프레드시트 정보 로드 중 에러:", err);
      isSaving.value = false;
      alert("스프레드시트 정보 로드 중 오류가 발생했습니다.");
    }
    return;
  }

  if (googleInfo.spreadsheetId) {
    const isValid = await verifySpreadsheetStructures(googleInfo.spreadsheetId);
    if (!isValid) {
      googleInfo.memberList = [];
      googleInfo.todayMembers = [];
      return;
    }
  }

  await loadMemberList();
  await loadTodayMembers();

  // 자동 로그인 완료 직후에도 전체 기간 통계 동기화
  if (googleInfo.spreadsheetId) {
    try {
      const stats = await fetchMemberStats(googleInfo.spreadsheetId);
      googleMemberStats.value = stats;
    } catch (e) {
      console.warn("자동 로그인 후 통계 로드 실패:", e);
    }
  }
};

// 멤버 목록 로드
const loadMemberList = async () => {
  if (googleInfo.syncMode !== 'google' || !googleInfo.isLoggedIn || !googleInfo.spreadsheetId) return;
  try {
    const list = await fetchMemberList(googleInfo.spreadsheetId);
    googleInfo.memberList = list;
  } catch (err) {
    console.error("멤버 목록 로드 실패:", err);
  }
};

// 오늘의 대국 참여 멤버 로드
const loadTodayMembers = async () => {
  if (googleInfo.syncMode !== 'google' || !googleInfo.isLoggedIn || !googleInfo.spreadsheetId) return;
  try {
    const sessionSheetName = await getOrInitSessionSheetName();
    const pointsMap = await fetchSessionMembers(googleInfo.spreadsheetId, sessionSheetName);
    googleInfo.todayMembers = Object.keys(pointsMap);
  } catch (err) {
    console.error("오늘의 멤버 로드 실패:", err);
  }
};

// 전체 명단에 신규 멤버 등록
const addNewMember = async (name: string) => {
  // 구글 연동 모드인 경우 구글 시트에 멤버 추가
  if (googleInfo.syncMode === 'google' && googleInfo.isLoggedIn && googleInfo.spreadsheetId) {
    try {
      await addNewMembersToDb(googleInfo.spreadsheetId, [name]);
      await loadMemberList();
    } catch (err) {
      console.error("신규 멤버 구글 시트 등록 실패:", err);
    }
    return;
  }

  // 로컬 모드인 경우 오프라인 리스트 갱신
  try {
    const offlineListRaw = localStorage.getItem("offline_member_list") || "[]";
    const offlineList: string[] = JSON.parse(offlineListRaw);
    if (!offlineList.includes(name)) {
      offlineList.push(name);
      localStorage.setItem("offline_member_list", JSON.stringify(offlineList));
    }
  } catch (e) {
    console.warn("오프라인 멤버 추가 실패:", e);
  }
};

// 전체 명단에서 멤버 영구 삭제
const deleteMember = async (name: string) => {
  const hasPlayed = todayGamesHistory.some(game => game.results.some((r: any) => r.name === name));
  if (hasPlayed) {
    alert("오늘 대국을 진행한 플레이어는 삭제할 수 없습니다.");
    return;
  }
  
  const offlineListRaw = localStorage.getItem("offline_member_list") || "[]";
  try {
    const offlineList: string[] = JSON.parse(offlineListRaw);
    const filtered = offlineList.filter(n => n !== name);
    localStorage.setItem("offline_member_list", JSON.stringify(filtered));
  } catch (e) {
    console.warn("오프라인 멤버 삭제 실패:", e);
  }

  if (googleInfo.isLoggedIn && googleInfo.spreadsheetId) {
    try {
      await deleteMemberFromDb(googleInfo.spreadsheetId, name);
      await loadMemberList();
    } catch (err) {
      console.error("구글 시트 멤버 삭제 실패:", err);
    }
  }
  
  googleInfo.todayMembers = googleInfo.todayMembers.filter(n => n !== name);
  localStorage.setItem("today_members", JSON.stringify(googleInfo.todayMembers));
};

// 오늘의 멤버 풀 저장 및 구글 시트 동기화
const saveTodayMembersPool = async (names: string[]) => {
  googleInfo.todayMembers = [...names];
  localStorage.setItem("today_members", JSON.stringify(names));
  if (!googleInfo.spreadsheetId) return;
  try {
    const sessionSheetName = await getOrInitSessionSheetName();
    await createSessionSheetIfNotExist(googleInfo.spreadsheetId, sessionSheetName, names);
    await saveSessionMembers(googleInfo.spreadsheetId, sessionSheetName, names);
  } catch (err) {
    console.error("오늘의 멤버 풀 저장 실패:", err);
  }
};

// 구글 로그인 트리거 (제스처 유실로 인한 모바일 팝업 차단 방지)
const googleLogin = () => {
  // 고정 클라이언트 ID 자동 바인딩 가드 (1089115695270 클라이언트 ID로 통일)
  if (!googleInfo.clientId) {
    googleInfo.clientId = "1089115695270-dui47hsqvfa9pmb5la64d5g6cinccitj.apps.googleusercontent.com";
    localStorage.setItem("google_client_id", googleInfo.clientId);
  }

  isManualLogin.value = true;
  initGis(googleInfo.clientId, onGoogleTokenReceived);
  loginGoogle();
};

// 커스텀 스프레드시트 주소 입력 팝업 확인 버튼 클릭 핸들러
const handlePromptConfirm = async () => {
  const val = tempPromptSpreadsheetUrl.value.trim();
  if (!val) {
    triggerToast("스프레드시트 주소가 입력되지 않았습니다.", "error");
    return;
  }

  // 입력값에서 ID 추출 정규식 적용
  const matches = val.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const extractedId = (matches && matches[1]) ? matches[1] : val;

  googleInfo.spreadsheetId = extractedId;
  localStorage.setItem("google_spreadsheet_id", extractedId);
  isShowSpreadsheetIdPrompt.value = false;

  // 동기화 시도 중 주소가 유실되어 입력 창을 띄웠던 경우 바로 동기화 재시도
  if (isSyncAfterPrompt.value) {
    isSyncAfterPrompt.value = false;
    syncLocalDataToGoogle();
    return;
  }

  // 로그인 완료 후 스프레드시트 주소를 늦게 입력한 경우 ➔ 연동 데이터(멤버/성적) 수집 및 회차 선택 팝업 오픈!
  if (googleInfo.isLoggedIn) {
    isSaving.value = true;
    syncLoaderTitle.value = "구글 스프레드시트 데이터 불러오는 중...";
    syncProgress.value = 20;
    
    try {
      syncProgress.value = 50;
      const isValid = await verifySpreadsheetStructures(googleInfo.spreadsheetId);
      if (!isValid) {
        googleInfo.memberList = [];
        googleInfo.todayMembers = [];
        isSaving.value = false;
        return;
      }
      
      syncProgress.value = 75;
      await loadMemberList();
      try {
        const stats = await fetchMemberStats(googleInfo.spreadsheetId);
        googleMemberStats.value = stats;
      } catch (statsErr) {
        console.warn("통계 로드 실패:", statsErr);
      }
      
      syncProgress.value = 100;
      setTimeout(async () => {
        isSaving.value = false;
        await loadGoogleSessions();
        isShowSessionChoosePopup.value = true;
      }, 500);
    } catch (err) {
      console.error("로그인 후 스프레드시트 로드 중 에러:", err);
      isSaving.value = false;
      alert("스프레드시트 정보 로드 중 오류가 발생했습니다.");
    }
  }
};

// 커스텀 스프레드시트 주소 입력 팝업 취소 버튼 클릭 핸들러
const handlePromptCancel = () => {
  isShowSpreadsheetIdPrompt.value = false;
  isManualLogin.value = false;
  isSyncAfterPrompt.value = false;
  triggerToast("스프레드시트 주소 등록이 취소되었습니다.");
};

// 구글 로그아웃 트리거
const googleLogout = () => {
  logoutGoogle();
  googleInfo.isLoggedIn = false;
  googleInfo.memberList = [];
  googleInfo.todayMembers = [];
  localStorage.removeItem("today_members");
  
  // 동기화 모드를 강제로 로컬 모드로 리셋
  googleInfo.syncMode = "local";
  localStorage.setItem("sync_mode", "local");
};

// 설정 값 로컬 스토리지에 동기화
const saveGoogleSettings = () => {
  localStorage.setItem("google_client_id", googleInfo.clientId);
  localStorage.setItem("google_spreadsheet_id", googleInfo.spreadsheetId);
  localStorage.setItem("sync_mode", googleInfo.syncMode);
  if (googleInfo.clientId) {
    try {
      initGis(googleInfo.clientId, onGoogleTokenReceived);
    } catch (e) {
      console.warn("GIS 초기화 실패:", e);
    }
  }
};

// 자리 배정 결과를 바탕으로 players 자리를 결정하고 게임을 동1국으로 리셋합니다.
const startGameWithSeats = (assignment: Record<string, string>) => {
  // players의 자풍은 동(Down), 남(Right), 서(Up), 북(Left) 순서로 고정
  players[0].name = assignment['東'] || '▼';
  players[1].name = assignment['南'] || '▶';
  players[2].name = assignment['西'] || '▲';
  players[3].name = assignment['北'] || '◀';

  // 게임 초기화
  resetAll();
  hideModal();
};

// 대국 완전 초기화 후 자리 설정 모달 켜기
const startNewGame = (skipConfirm = false) => {
  if (isGameFinished.value && !isGameSaved.value) {
    if (!confirm("대국 결과가 아직 기록되지 않았습니다. 정말 새 게임을 시작하시겠습니까?")) {
      return;
    }
    skipConfirm = true;
  }

  if (skipConfirm || confirm("현재 진행 중인 게임이 초기화됩니다. 새 게임을 시작하시겠습니까?")) {
    resetAll();
    showModal('choose_seat');
  }
};

// 현재 게임 결과 정산 데이터를 구글 스프레드시트 및 로컬 스토리지에 기록합니다.
const saveGameToSheet = async () => {
  // 이미 기록된 게임이면 추가 기록 차단
  if (isGameSaved.value) {
    alert("이미 기록된 대국입니다.");
    return;
  }


  try {
    const pointsDelta: Record<string, number> = {};

    // 1~4위 랭크 정산 데이터 추출
    const scoreSheet = players.map((p, idx) => {
      let myScore = p.displayScore;
      let oka = (option.returnScore * 4 - option.startingScore * 4) / 1000; // 오카
      let uma = 0; // 우마
      let rank = players.filter((x, j) => {
        if (x.displayScore > myScore) return true;
        if (option.sekiOrder && x.displayScore === myScore && j < idx) return true;
        return false;
      }).length + 1; // 순위
      let cnt = option.sekiOrder ? 1 : players.filter(x => x.displayScore === myScore).length; // 동점자 수
      
      for (let i = 0; i < cnt; i++) {
        uma += Number(option.rankUma[rank + i - 1]);
      }
      if (rank === 1) {
        uma += oka;
        if (option.riichiPayout) {
          myScore += Math.floor(((panelInfo.riichi * 1000) / cnt) / 100) * 100;
        }
      }
      uma /= cnt;
      let point = (myScore - option.returnScore) / 1000 + uma;

      // 이번 판 획득 포인트를 기록
      pointsDelta[p.name] = parseFloat(point.toFixed(1));

      return {
        name: p.name,
        score: myScore,
        point: point.toFixed(1)
      };
    });



    // 로컬 스토리지 누적 포인트 갱신
    Object.keys(pointsDelta).forEach(name => {
      const prev = localPoints[name] || 0;
      localPoints[name] = parseFloat((prev + pointsDelta[name]).toFixed(1));
    });
    localStorage.setItem("today_members_points", JSON.stringify(localPoints));

    // 오늘 개별 회전 기록 이력(today_games_history) 저장
    const historyResults = scoreSheet.map(item => {
      const pIndex = players.findIndex(x => x.name === item.name);
      const myScore = players[pIndex].displayScore;
      const rank = players.filter((x, j) => {
        if (x.displayScore > myScore) return true;
        if (option.sekiOrder && x.displayScore === myScore && j < pIndex) return true;
        return false;
      }).length + 1;
      return {
        name: item.name,
        score: item.score, // 오카/공탁금 반영된 최종 스코어 보존
        uma: parseFloat(item.point),
        rank: rank
      };
    });
    todayGamesHistory.push({
      timestamp: new Date().toISOString(),
      results: historyResults,
      records: JSON.parse(JSON.stringify(records)),
      playerNames: players.map(p => p.name)
    });
    localStorage.setItem("today_games_history", JSON.stringify(todayGamesHistory));

    // 기록 성공 플래그 셋팅 및 복구 보장
    isGameSaved.value = true;
    localStorage.setItem("is_game_saved", "true");

    // 로컬에만 누적 보관하며, 일괄 동기화 버튼을 통해 구글 전송 처리
    triggerToast("게임 결과 로컬 기록 완료!");
  } catch (err) {
    console.error("결과 기록 실패:", err);
    alert("결과 기록 중 오류가 발생했습니다.");
  }
};

// 로컬에서 플레이하던 대국 기록들을 구글 스프레드시트에 일괄 업로드
const syncLocalDataToGoogle = async () => {
  if (!googleInfo.isLoggedIn) {
    alert("구글 연동 모드에서만 동기화가 가능합니다.");
    return;
  }

  // 동기화 요청 시 스프레드시트 주소가 유실되어 있는 경우 커스텀 팝업 기동
  if (!googleInfo.spreadsheetId) {
    isSyncAfterPrompt.value = true;
    tempPromptSpreadsheetUrl.value = "";
    isShowSpreadsheetIdPrompt.value = true;
    return;
  }
  try {
    const isValid = await verifySpreadsheetStructures(googleInfo.spreadsheetId);
    if (!isValid) return;

    if (todayGamesHistory.length === 0) {
      alert("오늘 기록된 로컬 대국 이력이 없습니다.");
      return;
    }

    const isConfirmed = confirm(`오늘 로컬에 기록된 총 ${todayGamesHistory.length}개의 대국 기록을 구글 스프레드시트에 일괄 업로드하시겠습니까?`);
    if (!isConfirmed) {
      isSaving.value = false;
      return;
    }

    isSaving.value = true;
    syncLoaderTitle.value = "구글 스프레드시트 일괄 동기화 중...";
    syncProgress.value = 5;

    // 1. 이미 업로드된 대국 ID 목록 조회 (중복 방지)
    const sessionSheetName = await getOrInitSessionSheetName();
    const uploadedGameIds = new Set<string>();
    
    // A. '전체 국별기록 (데이터)'의 B열 조회
    try {
      const res = await window.gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: googleInfo.spreadsheetId,
        range: "'전체 국별기록 (데이터)'!B2:B",
      });
      if (res.result.values) {
        res.result.values.forEach((row: any) => {
          if (row[0]) {
            uploadedGameIds.add(row[0].toString().trim());
          }
        });
      }
    } catch (e) {
      console.warn("기존 전체 국별기록 (데이터) ID 조회 실패:", e);
    }
    syncProgress.value = 15;

    // B. 신규 대국 필터링 및 Tidy 국별 데이터 조립
    const allRoundRows: any[][] = [];
    let skipCount = 0;

    todayGamesHistory.forEach(game => {
      const gameId = new Date(game.timestamp).getTime().toString();
      if (uploadedGameIds.has(gameId)) {
        skipCount++;
        return;
      }

      const timestamp = new Date(game.timestamp).toLocaleString('ko-KR');
      const records = game.records;
      const results = game.results;

      // 대국 당시의 플레이어 순서 명단(0~3 인덱스 매칭) 복원 (현재 판의 플레이어 배치와 꼬임 방지!)
      const orderedNames = (game as any).playerNames || (() => {
        const rowRanks = [0, 1, 2, 3].map(i => {
          const score = records.score[i][records.score[i].length - 1];
          let rank = 1;
          for (let j = 0; j < 4; j++) {
            const otherScore = records.score[j][records.score[j].length - 1];
            if (otherScore > score) rank++;
            else if (otherScore === score && j < i) rank++;
          }
          return { idx: i, rank };
        });
        const list: string[] = new Array(4);
        rowRanks.forEach(item => {
          const match = results.find((rObj: any) => rObj.rank === item.rank) || results[item.idx];
          list[item.idx] = match.name;
        });
        return list;
      })();

      const totalRounds = records.riichi.length - 1;
      for (let r = 1; r <= totalRounds; r++) {
        const roundName = records.time[2 * r - 1] || `${r}국`;
        const roundStatus = records.status && records.status[r] ? records.status[r] : '';
        const dealerIdx = records.dealer && records.dealer[r] !== undefined ? records.dealer[r] : -1;
        
        for (let p = 0; p < results.length; p++) {
          const playerName = results[p].name;
          const isDealer = (p === dealerIdx) ? 'TRUE' : 'FALSE';
          const pIdx = orderedNames.indexOf(playerName);
          if (pIdx === -1) continue;
          
          const deltaScore = records.score[pIdx][2 * r - 1];
          const finalScore = records.score[pIdx][2 * r];
          const isRiichi = records.riichi[r][pIdx] ? 'TRUE' : 'FALSE';
          const isWin = records.win[r][pIdx] ? 'TRUE' : 'FALSE';
          const isLose = records.lose[r][pIdx] ? 'TRUE' : 'FALSE';
          const isTenpai = records.tenpai && records.tenpai[r] && records.tenpai[r][pIdx] ? 'TRUE' : 'FALSE';
          
          const historyItem = results.find((h: any) => h.name === playerName);
          const finalRank = historyItem ? historyItem.rank : 4;
          const finalUma = historyItem ? historyItem.uma : 0;
          
          const rowData = [
            timestamp,
            gameId,
            roundName,
            r,
            roundStatus,
            playerName,
            isDealer,
            deltaScore,
            finalScore,
            isRiichi,
            isWin,
            isLose,
            isTenpai,
            finalRank,
            finalUma,
            sessionSheetName
          ];
          
          allRoundRows.push(rowData);
        }
      }
    });

    if (allRoundRows.length > 0) {
      syncProgress.value = 40;
      // 신규 등록된 임시 멤버가 있다면 구글 시트에 일괄 동기화 (fetchMemberList에 추가)
      const offlineMembers = todayGamesHistory.reduce((acc: string[], game) => {
        game.results.forEach((r: any) => {
          if (!acc.includes(r.name)) acc.push(r.name);
        });
        return acc;
      }, []);
      await addNewMembersToDb(googleInfo.spreadsheetId, offlineMembers);
      syncProgress.value = 55;

      // 오늘의 멤버 누적 포인트 가산 업데이트
      const deltaMap: Record<string, number> = {};
      todayGamesHistory.forEach(game => {
        const gameId = new Date(game.timestamp).getTime().toString();
        if (uploadedGameIds.has(gameId)) return;
        game.results.forEach((r: any) => {
          deltaMap[r.name] = parseFloat(((deltaMap[r.name] || 0) + r.uma).toFixed(1));
        });
      });
      await updateSessionMemberPoints(googleInfo.spreadsheetId, sessionSheetName, deltaMap);
      syncProgress.value = 65;

      // [1] '전체 국별기록 (데이터)' 일괄 업데이트
      await appendRoundRecords(googleInfo.spreadsheetId, '전체 국별기록 (데이터)', allRoundRows, googleInfo.todayMembers);
      syncProgress.value = 75;
      
      // [2] 회차별 상세 시트에 국별기록 일괄 업데이트
      await appendRoundRecords(googleInfo.spreadsheetId, sessionSheetName + " (데이터)", allRoundRows, googleInfo.todayMembers);
      syncProgress.value = 85;
      
      // [3] 회차별 가로 대국 요약 데이터 일괄 적재
      try {
        const summaryRows: any[][] = [];
        todayGamesHistory.forEach(game => {
          const gameId = new Date(game.timestamp).getTime().toString();
          const timestamp = new Date(game.timestamp).toLocaleString('ko-KR');
          
          if (uploadedGameIds.has(gameId)) return;
          
          const rawResults = [...game.results];
          summaryRows.push([
            gameId,
            timestamp,
            rawResults[0]?.name || "", rawResults[0]?.rank || 4, rawResults[0]?.score || 0, rawResults[0]?.uma || 0,
            rawResults[1]?.name || "", rawResults[1]?.rank || 4, rawResults[1]?.score || 0, rawResults[1]?.uma || 0,
            rawResults[2]?.name || "", rawResults[2]?.rank || 4, rawResults[2]?.score || 0, rawResults[2]?.uma || 0,
            rawResults[3]?.name || "", rawResults[3]?.rank || 4, rawResults[3]?.score || 0, rawResults[3]?.uma || 0
          ]);
        });
        if (summaryRows.length > 0) {
          await appendSessionSummaryRecords(googleInfo.spreadsheetId, sessionSheetName + " (raw)", summaryRows);
        }
      } catch (sumErr) {
        console.warn("일괄 대국 요약 적재 실패:", sumErr);
      }
      syncProgress.value = 92;
      
      // [4] 회차별 변동추이 Upsert 일괄 적재
      try {
        const nowTime = new Date().toLocaleString('ko-KR');
        await upsertSessionUmaHistory(googleInfo.spreadsheetId, sessionSheetName, todayGamesHistory, nowTime);
      } catch (umaErr) {
        console.warn("일괄 변동추이 적재 실패:", umaErr);
      }
      syncProgress.value = 97;
      
      // 일괄 동기화 완료 후 구글 전체 통계 바로 새로고침
      try {
        const stats = await fetchMemberStats(googleInfo.spreadsheetId);
        googleMemberStats.value = stats;
      } catch (e) {
        console.warn("일괄 동기화 후 통계 로드 실패:", e);
      }
      
      syncProgress.value = 100;
      triggerToast("동기화 성공!");
    } else {
      if (skipCount > 0) {
        alert(`동기화할 새로운 대국이 없습니다. (오늘 로컬의 ${skipCount}개 대국은 이미 스프레드시트에 존재합니다.)`);
      } else {
        alert("동기화할 세부 기록이 없습니다.");
      }
    }
  } catch (err) {
    console.error("일괄 동기화 실패:", err);
    alert("일괄 동기화 중 오류가 발생했습니다.");
  } finally {
    isSaving.value = false;
    setTimeout(() => {
      syncProgress.value = 0;
    }, 1000);
  }
};

// 설정창에서 '기존 회차'를 클릭했을 때 팝업 기동
const openChooseSessionPopup = async () => {
  await loadGoogleSessions();
  isShowChooseSessionPopup.value = true;
};

// 기존 회차 이어하기 팝업 확인 처리
const confirmLoadSession = async () => {
  if (!selectedSessionToLoad.value) return;
  isShowChooseSessionPopup.value = false;
  isShowSessionChoosePopup.value = false;
  modalInfo.isOpen = false; // 설정 창도 닫아주기
  await loadExistingSession(selectedSessionToLoad.value);
};

// 신규 회차 시작 팝업 확인 처리
const confirmStartNewDay = async () => {
  isShowSessionChoosePopup.value = false;
  modalInfo.isOpen = false; // 설정 창도 닫아주기
  await startNewDay();
};

// 총 우마 창에서 특정 대국 행을 클릭했을 때의 차트 팝업 기동
const handleHistoryGameClick = (index: number) => {
  if (index < 0 || index >= todayGamesHistory.length) return;
  const game = todayGamesHistory[index];
  if (!game || !game.records || !Array.isArray(game.records.score) || game.records.score.length === 0) {
    triggerToast("국별 상세 성적이 존재하지 않아 그래프를 표시할 수 없습니다.");
    return;
  }
  
  // 플레이어 이름 목록 셋업
  const names = game.playerNames || game.results.map((r: any) => r.name);
  chartPlayers.value = names.map((n: string) => ({ name: n }));
  chartRecords.value = JSON.parse(JSON.stringify(game.records));
  
  // 과거 대국 전용 차트 모달 기동
  showModal('history_chart');
};

// 구글 스프레드시트로부터 기존 회차 정보를 읽어와 로컬 상태(멤버 풀, 누적 점수, 대국 이력)를 역으로 완벽하게 복원합니다.
const loadExistingSession = async (cleanTitle: string) => {
  if (!cleanTitle) return;
  const isConfirmed = confirm(`'${cleanTitle}' 회차의 기존 데이터를 불러와서 기록을 이어 나가시겠습니까?\n(로컬에 진행 중이던 오늘 데이터는 덮어씌워집니다.)`);
  if (!isConfirmed) return;

  isSaving.value = true;
  syncProgress.value = 15;
  syncLoaderTitle.value = `'${cleanTitle}' 회차 데이터 복원 중...`;

  try {
    // 1. 활성 회차 시트 이름 스위칭
    currentSessionSheetName.value = cleanTitle;
    localStorage.setItem("current_session_sheet_name", cleanTitle);

    // 2. 오늘의 멤버 목록 & 누적 포인트 복원 (cleanTitle (raw) 시트의 A2:D20 긁어오기)
    syncProgress.value = 40;
    const rawRes = await window.gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: googleInfo.spreadsheetId,
      range: `'${cleanTitle} (raw)'!A2:D20`
    });
    
    const rawRows = rawRes.result.values || [];
    const restoredMembers: string[] = [];
    const restoredPoints: Record<string, number> = {};

    rawRows.forEach((row: any) => {
      const name = row[0]; // A열: 이름
      const pts = parseFloat(row[2]) || 0; // C열: 누적 우마
      if (name && name.trim()) {
        const cleanName = name.trim();
        restoredMembers.push(cleanName);
        restoredPoints[cleanName] = pts;
      }
    });

    // 멤버 풀 및 누적 포인트 상태 갱신
    googleInfo.todayMembers = restoredMembers;
    localStorage.setItem("today_members", JSON.stringify(restoredMembers));
    
    Object.keys(localPoints).forEach(key => delete localPoints[key]);
    Object.assign(localPoints, restoredPoints);
    localStorage.setItem("today_members_points", JSON.stringify(restoredPoints));

    // 3. 대국 이력(todayGamesHistory) 복원 (cleanTitle (데이터) 시트의 A2:P500 긁어오기)
    syncProgress.value = 70;
    const dataRes = await window.gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: googleInfo.spreadsheetId,
      range: `'${cleanTitle} (데이터)'!A2:P500`
    });

    const dataRows = dataRes.result.values || [];
    const gamesMap: Record<string, { timestamp: string, results: Record<string, { name: string, score: number, uma: number, rank: number }> }> = {};

    dataRows.forEach((row: any) => {
      const timestamp = row[0]; // A열: 대국 일시
      const gameId = row[1];    // B열: 대국 ID
      const name = row[5];      // F열: 플레이어 이름
      const score = parseInt(row[8]) || 0; // I열: 최종 점수
      const rank = parseInt(row[13]) || 1;  // N열: 최종 순위
      const uma = parseFloat(row[14]) || 0;  // O열: 최종 우마

      if (!gameId || !name) return;

      if (!gamesMap[gameId]) {
        let parsedTime = new Date().toISOString();
        if (timestamp) {
          // '2026. 7. 12. 오전 12:45:00' 형태 파싱 호환성 처리
          const cleanTimeStr = timestamp.replace("오전", "AM").replace("오후", "PM").replace(/\./g, '/');
          const d = new Date(cleanTimeStr);
          if (!isNaN(d.getTime())) {
            parsedTime = d.toISOString();
          }
        }
        gamesMap[gameId] = {
          timestamp: parsedTime,
          results: {}
        };
      }

      // 국별로 계속 루프가 돌면서 덮어씌워지므로, 결국 해당 대국ID의 최종 국 결과(최종점수/순위/우마)가 남음
      gamesMap[gameId].results[name] = {
        name,
        score,
        uma,
        rank
      };
    });

    // Map을 배열로 환원
    const restoredHistory = Object.keys(gamesMap).map(gameId => {
      const g = gamesMap[gameId];
      const resultsArr = Object.values(g.results);
      return {
        timestamp: g.timestamp,
        results: resultsArr,
        records: [], // 롤백용 세부 국 기록은 생략
        playerNames: resultsArr.map(r => r.name)
      };
    });

    // 시간 오름차순(오래된 순) 정렬
    restoredHistory.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // 대국 이력 상태 갱신
    todayGamesHistory.length = 0;
    restoredHistory.forEach(h => todayGamesHistory.push(h));
    localStorage.setItem("today_games_history", JSON.stringify(restoredHistory));

    // 4. 게임 상태 리셋 가드
    resetAll();
    isGameSaved.value = true;
    localStorage.setItem("is_game_saved", "true");

    syncProgress.value = 100;
    triggerToast("기존 회차 데이터 복원이 완벽하게 처리되었습니다!");
  } catch (err) {
    console.error("기존 회차 세션 복원 중 실패:", err);
    alert("회차 복원에 실패했습니다. 시트 주소 및 네트워크 권한을 점검해 주세요.");
  } finally {
    isSaving.value = false;
    setTimeout(() => {
      syncProgress.value = 0;
    }, 800);
  }
};

// 새로운 날 시작 (로컬 성적 및 명단 초기화)
const startNewDay = async () => {
  const isConfirmed = confirm("로컬에 기록된 오늘 하루의 점수 및 명단 세션이 완전히 초기화됩니다. 새로운 날을 시작하시겠습니까?");
  if (!isConfirmed) return;

  // 로컬 초기화
  localStorage.removeItem("today_members");
  localStorage.removeItem("today_members_points");
  localStorage.removeItem("today_games_history");
  googleInfo.todayMembers = [];
  todayGamesHistory.length = 0; // 반응형 배열 비우기
  Object.keys(localPoints).forEach(key => delete localPoints[key]);

  // 경기기록 스코어 리셋
  resetAll();

  // 구글 연동 중인 경우 시트 데이터 클리어
  if (googleInfo.isLoggedIn && googleInfo.spreadsheetId) {
    try {
      await window.gapi.client.sheets.spreadsheets.values.clear({
        spreadsheetId: googleInfo.spreadsheetId,
        range: '오늘의멤버!A2:B100', // 헤더 제외하고 오늘의 멤버 점수 기록 초기화
      });
    } catch (err) {
      console.warn("구글 오늘의멤버 초기화 에러:", err);
    }
  }

  alert("모든 기록이 초기화되었습니다. 새로운 날의 대국 멤버를 지정해주세요.");
  hideModal();
  showModal('choose_seat');
};

// 회차 대국 기록 무효 처리 (삭제 및 누적 점수 재계산)
const invalidateGame = (index: number) => {
  const confirmInvalidate = confirm(`${index + 1}회전 대국 기록을 무효(삭제) 처리하시겠습니까?`);
  if (!confirmInvalidate) return;

  if (index < 0 || index >= todayGamesHistory.length) return;

  // 1. 반응형 배열 및 로컬스토리지에서 삭제
  todayGamesHistory.splice(index, 1);
  localStorage.setItem("today_games_history", JSON.stringify(todayGamesHistory));

  // 2. localPoints 누적 점수 전체 재계산
  Object.keys(localPoints).forEach(key => {
    localPoints[key] = 0;
  });

  todayGamesHistory.forEach((game) => {
    if (game.results) {
      game.results.forEach((r: any) => {
        const prev = localPoints[r.name] || 0;
        localPoints[r.name] = parseFloat((prev + r.uma).toFixed(1));
      });
    }
  });
  localStorage.setItem("today_members_points", JSON.stringify(localPoints));

  alert(`${index + 1}회전 대국 기록이 무효 처리되었습니다.`);
};
</script>

<template>
<div class="background" @dblclick.self="toggleFullScreen()" @click="onBackgroundClick">
  <!-- 커스텀 토스트 알림 연출 -->
  <Transition name="toast-fade">
    <div v-if="toast.show" class="custom-toast" :class="toast.type">
      {{ toast.message }}
    </div>
  </Transition>
  <!-- 각 방향별 player 컴포넌트 생성 -->
  <main role="main">
    <Player v-for="(_, i) in players"
      :key="i"
      :player="players[i]"
      :option
      :modalInfo
      :animateRank="animateRank"
      :isGameFinished="isGameFinished"
      @toggle-active-riichi="toggleActiveRiichi"
      @start-show-gap="startShowGap"
      @end-show-gap="endShowGap"
    />
    <!-- 중앙 panel 컴포넌트 생성 -->
    <Panel
      :panelInfo
      :isMenuOpen="isPanelMenuOpen"
      :isGameFinished="isGameFinished"
      @show-modal="showModal"
      @roll-dice="rollDice"
      @toggle-menu="isPanelMenuOpen = !isPanelMenuOpen"
      @close-menu="isPanelMenuOpen = false"
    />
  </main>
  <!-- modal 컴포넌트 생성 (자연스러운 페이드인 효과를 위해 Transition 적용) -->
  <Transition name="modal-fade">
    <Modal v-if="modalInfo.isOpen"
      :players
      :scoringState
      :panelInfo
      :dice
      :seatTile
      :records
      :option
      :modalInfo
      :googleInfo
      :todayGamesHistory="todayGamesHistory"
      :isGameSaved="isGameSaved"
      :googleMemberStats="googleMemberStats"
      :isSaving="isSaving"
      :syncProgress="syncProgress"
      :chart-players="chartPlayers"
      :chart-records="chartRecords"
      @show-modal="showModal"
      @hide-modal="hideModal"
      @set-arrow-button="setArrowButton"
      @set-toggle-button="setToggleButton"
      @set-fanbu-button="setFanBuButton"
      @check-invalid-status="checkInvalidStatus"
      @calculate-win="calculateWin"
      @calculate-draw="calculateDraw"
      @save-round="saveRound"
      @roll-dice="rollDice"
      @copy-record="copyRecord"
      @rollback-record="rollbackRecord"
      @start-game-with-seats="startGameWithSeats"
      @save-google-settings="saveGoogleSettings"
      @google-login="googleLogin"
      @google-logout="googleLogout"
      @save-game-to-sheet="saveGameToSheet"
      @add-new-member="addNewMember"
      @delete-member="deleteMember"
      @save-today-members="saveTodayMembersPool"
      @start-new-game="startNewGame"
      @sync-local-to-google="syncLocalDataToGoogle"
      @start-new-day="startNewDay"
      @invalidate-game="invalidateGame"
      @load-existing-session="loadExistingSession"
      @open-choose-session-popup="openChooseSessionPopup"
      @click-game="handleHistoryGameClick"
    />
  </Transition>

  <!-- 동기화 진행 상태 바 (isSaving이 true일 때 팝업 노출) -->
  <div v-if="isSaving" class="sync-loader-overlay">
    <div class="sync-loader-card">
      <div class="sync-loader-title">{{ syncLoaderTitle }}</div>
      <div class="sync-progress-container">
        <div class="sync-progress-bar" :style="{ width: syncProgress + '%' }"></div>
      </div>
      <div class="sync-progress-text">{{ syncProgress }}%</div>
    </div>
  </div>

  <!-- 스프레드시트 주소 입력을 위한 커스텀 모달 팝업 -->
  <Transition name="modal-fade">
    <div v-if="isShowSpreadsheetIdPrompt" class="custom-prompt-overlay" @click.self="handlePromptCancel">
      <div class="custom-prompt-card">
        <div class="custom-prompt-header">
          <h3>구글 스프레드시트 주소 입력</h3>
        </div>
        <div class="custom-prompt-body">
          <input 
            type="text" 
            v-model="tempPromptSpreadsheetUrl" 
            placeholder="https://docs.google.com/spreadsheets/d/... 또는 ID 직접 입력"
            class="custom-prompt-input"
            @keyup.enter="handlePromptConfirm"
          />
        </div>
        <div class="custom-prompt-actions">
          <button class="btn-prompt-cancel" @click="handlePromptCancel">취소</button>
          <button class="btn-prompt-confirm" @click="handlePromptConfirm">확인</button>
        </div>
      </div>
    </div>
  </Transition>

  <!-- [팝업 1] 설정창에서 기존 회차를 누를 때 띄워주는 이어하기 전용 팝업 -->
  <Transition name="modal-fade">
    <div v-if="isShowChooseSessionPopup" class="custom-prompt-overlay" @click.self="isShowChooseSessionPopup = false">
      <div class="custom-prompt-card">
        <div class="custom-prompt-header">
          <h3>기존 회차 이어하기</h3>
        </div>
        <div class="custom-prompt-body" style="display: flex; flex-direction: column; gap: 8px;">
          <label style="font-size: 13px; font-weight: bold; align-self: flex-start;">이어할 회차를 선택해 주세요:</label>
          <select v-model="selectedSessionToLoad" class="custom-prompt-input" style="height: 38px; font-weight: bold; background-color: var(--color-input-bg, #fff); color: var(--color-text, #333); border: 1px solid var(--color-border, #ccc); border-radius: 4px; padding: 0 8px; width: 100%;">
            <option v-for="sess in validGoogleSessions" :key="sess" :value="sess">
              {{ sess }}
            </option>
            <option v-if="validGoogleSessions.length === 0" value="">
              {{ isLoadingSessions ? '회차 수집 중...' : '유효한 기존 회차가 없습니다' }}
            </option>
          </select>
        </div>
        <div class="custom-prompt-actions">
          <button class="btn-prompt-cancel" @click="isShowChooseSessionPopup = false">취소</button>
          <button class="btn-prompt-confirm" :disabled="!selectedSessionToLoad" @click="confirmLoadSession">확인</button>
        </div>
      </div>
    </div>
  </Transition>

  <!-- [팝업 2] 로그인 완료 직후 뜨는 기존 회차 이어하기 vs 신규 회차 시작 양자택일 분기 팝업 -->
  <Transition name="modal-fade">
    <div v-if="isShowSessionChoosePopup" class="custom-prompt-overlay" @click.self="isShowSessionChoosePopup = false">
      <div class="custom-prompt-card" style="max-width: 340px;">
        <div class="custom-prompt-header">
          <h3>회차 시작 방식 선택</h3>
        </div>
        <div class="custom-prompt-body" style="display: flex; flex-direction: column; gap: 12px; padding: 10px 0;">
          <div style="display: flex; flex-direction: column; gap: 6px; width: 100%;">
            <label style="font-size: 13px; font-weight: bold; align-self: flex-start;">이어할 기존 회차 선택:</label>
            <select v-model="selectedSessionToLoad" class="custom-prompt-input" style="height: 38px; font-weight: bold; background-color: var(--color-input-bg, #fff); color: var(--color-text, #333); border: 1px solid var(--color-border, #ccc); border-radius: 4px; padding: 0 8px; width: 100%;">
              <option v-for="sess in validGoogleSessions" :key="sess" :value="sess">
                {{ sess }}
              </option>
              <option v-if="validGoogleSessions.length === 0" value="">
                {{ isLoadingSessions ? '회차 수집 중...' : '유효한 기존 회차가 없습니다' }}
              </option>
            </select>
          </div>
        </div>
        <div class="custom-prompt-actions" style="display: flex; flex-direction: column; gap: 8px; width: 100%; margin-top: 10px;">
          <!-- 기존 회차 이어하기 (위) -->
          <button 
            class="btn-prompt-confirm" 
            :disabled="!selectedSessionToLoad" 
            @click="confirmLoadSession"
            style="width: 100%; margin: 0; padding: 10px; font-size: 14px;"
          >
            기존 회차 이어하기
          </button>
          <!-- 신규 회차 시작 (아래, 빨간색) -->
          <button 
            class="btn-prompt-cancel" 
            @click="confirmStartNewDay"
            style="width: 100%; margin: 0; padding: 10px; font-size: 14px; background-color: var(--color-negative); color: white; border: none;"
          >
            신규 회차 시작
          </button>
        </div>
      </div>
    </div>
  </Transition>
</div>
</template>

<style>
/* 동기화 진행률 모달 스타일 */
.sync-loader-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 9999;
}
.sync-loader-card {
  background: var(--bg-modal, #1e1e1e);
  border: 1px solid var(--border-color, #444);
  padding: 30px;
  border-radius: 12px;
  width: 320px;
  text-align: center;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
  color: var(--text-color, #fff);
}
.sync-loader-title {
  font-size: 18px;
  font-weight: bold;
  margin-bottom: 20px;
}
.sync-progress-container {
  width: 100%;
  height: 12px;
  background: #333;
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 10px;
}
.sync-progress-bar {
  height: 100%;
  background: linear-gradient(90deg, #4caf50, #8bc34a);
  transition: width 0.3s ease;
}
.sync-progress-text {
  font-size: 16px;
  font-weight: bold;
}

/* 모달 즉시 반응 (애니메이션 제거) */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: none !important;
}
.modal-fade-leave-active {
  pointer-events: none !important;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

/* 커스텀 토스트 알림 */
.custom-toast {
  position: fixed;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  padding: 14px 28px;
  border-radius: 8px;
  font-size: 16px;
  font-weight: bold;
  z-index: 10000;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  pointer-events: none;
  transition: all 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}
.custom-toast.success {
  background-color: #4caf50;
  color: #ffffff;
}
.toast-fade-enter-from,
.toast-fade-leave-to {
  opacity: 0;
  top: 0px;
}

/* 화이트/다크 테마별 동기화 팝업 배경 최적화 */
.sync-loader-card {
  background: #ffffff !important;
  border: 1px solid #e0e0e0 !important;
  color: #2c3e50 !important;
}
.dark .sync-loader-card {
  background: #1e1e1e !important;
  border: 1px solid #444 !important;
  color: #ffffff !important;
}

/* 커스텀 스프레드시트 주소 입력 프롬프트 모달 스타일 */
.custom-prompt-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background-color: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2100;
  backdrop-filter: blur(4px);
}
.custom-prompt-card {
  background-color: #ffffff;
  border: 1px solid #e0e0e0;
  border-radius: 12px;
  width: 460px;
  max-width: 90vw;
  padding: 24px;
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.15);
  box-sizing: border-box;
  display: flex !important;
  flex-direction: column !important;
  align-items: stretch !important;
}
.dark .custom-prompt-card {
  background-color: #1e1e1e;
  border: 1px solid #444;
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.5);
}
.custom-prompt-header h3 {
  margin: 0 0 10px 0;
  font-size: 16px;
  font-weight: bold;
  text-align: center;
  color: #2c3e50;
}
.dark .custom-prompt-header h3 {
  color: #ffffff;
}
.custom-prompt-input {
  width: 100% !important;
  max-width: 100% !important;
  display: block !important;
  padding: 10px 12px !important;
  font-size: 13px !important;
  background-color: #f8fafc !important;
  color: #1e293b !important;
  border: 1px solid #cbd5e1 !important;
  border-radius: 6px !important;
  box-sizing: border-box !important;
  margin: 12px 0 18px 0 !important;
  outline: none !important;
}
.dark .custom-prompt-input {
  background-color: #2a2a2a !important;
  color: #ffffff !important;
  border: 1px solid #444 !important;
}
.custom-prompt-input:focus {
  border-color: var(--color-toggle-on, #4caf50) !important;
}
.custom-prompt-actions {
  display: flex !important;
  flex-direction: row !important;
  justify-content: flex-end !important;
  gap: 10px !important;
  width: 100% !important;
}
.custom-prompt-actions button {
  padding: 8px 16px;
  font-size: 13px;
  font-weight: bold;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  transition: opacity 0.15s ease;
}
.custom-prompt-actions button:hover {
  opacity: 0.85;
}
.btn-prompt-cancel {
  background-color: #4b5563;
  color: #fff;
}
.btn-prompt-confirm {
  background-color: var(--color-toggle-on, #4caf50);
  color: #fff;
}
</style>