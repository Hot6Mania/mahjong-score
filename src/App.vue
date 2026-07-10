<script setup lang="ts">
import Player from "@/components/Player.vue"
import Panel from "@/components/Panel.vue"
import Modal from "@/components/modals/Modal.vue"
import { reactive, onMounted, watch, ref } from "vue"
import { useRouter } from "vue-router"
import { useI18n } from "vue-i18n"
import { getShortNames } from "@/utils/nameAbbreviation"
import { initGapi, initGis, loginGoogle, logoutGoogle, fetchMemberList, appendGameResult, addNewMemberToDb, fetchTodayMembers, saveTodayMembers, updateTodayMemberPoints } from "@/utils/googleSheets"
import type { GoogleInfo, Player as PlayerInterface, Option as OptionType, Records as RecordsType, PanelInfo as PanelInfoType } from "@/types/types.d"

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
const records = reactive<RecordsType>(savedRecords ? JSON.parse(savedRecords) : {
  time: ["ㅤ"], // 시간
  score: [[25000],[25000],[25000],[25000]], // 점수
  riichi: [[false, false, false, false]], // 리치 횟수
  win: [[false, false, false, false]], // 화료 횟수
  lose: [[false, false, false, false]], // 방총 횟수
})

const defaultOption: OptionType = {
  startingScore: 25000, // 시작 점수
  returnScore: 30000, // 반환 점수
  rankUma: [35, 5, -15, -25], // 순위 우마
  roundMangan: false, // 절상만관
  tobi: true, // 들통
  cheatScore: false, // 촌보 지불 점수
  riichiPayout: true, // 남은 공탁금 처리
  alwaysShowRank: false, // 등수 상시 표시
  sekiOrder: false, // 동점 석순 기준
};
const savedOption = localStorage.getItem("mahjong_option");
const option = reactive<OptionType>(savedOption ? { ...defaultOption, ...JSON.parse(savedOption) } : defaultOption);
const modalInfo = reactive({ // 모달창
  isOpen: false, // on/off
  type: "", // 종류
  status: "", // 라운드 형태 - 론 쯔모 일반유국 특수유국
})
const googleInfo = reactive<GoogleInfo>({ // 구글 연동 정보
  clientId: localStorage.getItem("google_client_id") || "", // 구글 클라이언트 ID
  spreadsheetId: localStorage.getItem("google_spreadsheet_id") || "", // 구글 스프레드시트 ID
  isLoggedIn: false, // 로그인 여부
  syncMode: (localStorage.getItem("sync_mode") as 'local' | 'google') || 'local', // 연동 모드 (기본값 로컬)
  memberList: [], // 멤버 전체 목록
  todayMembers: JSON.parse(localStorage.getItem("today_members") || "[]"), // 오늘 참가할 멤버 풀 (쿠키/스토리지 보존)
  selectedMembers: [] // 선택된 멤버 4명
})

// 로컬 모드용 오늘 누적 포인트 맵
const localPoints = reactive<Record<string, number>>(
  JSON.parse(localStorage.getItem("today_members_points") || "{}")
)

const animateRank = ref(false);
const activeGapSeat = ref<string | null>(null);
const isPanelMenuOpen = ref(false);

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
  await router.isReady();
  changeLocale();
  for (let i=3;i>0;i--){ // 자리 섞기
    let j=Math.floor(Math.random()*(i+1));
    [seatTile.value[i], seatTile.value[j]]=[seatTile.value[j], seatTile.value[i]];
  }
  
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
  router.push({params: {locale: targetLanguage}}); // 라우팅 경로 설정
  locale.value=targetLanguage; // 언어 변경
  document.title=t('pageTitle') // 페이지 이름 설정
  document.documentElement.setAttribute('lang', targetLanguage); // lang 속성 변경
  localStorage.setItem("language", locale.value); // 로컬 스토리지에 저장
}

/**리치 활성화/비활성화*/
const toggleActiveRiichi = (seat: string) => {
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
const changeScores = (onComplete?: () => void) => {
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
    players[i].effectScore=players[i].deltaScore; // 이펙트 켜기
    players[i].rank=oldRanks[i]; // 등수 연출 시작 시점에는 이전 등수 노출
  }
  let timecnt=0;
  let effect=setInterval(() => { // 시간에 따라 반복
    for (let i=0;i<players.length;i++)
      players[i].displayScore=arrCut[i][timecnt]; // 이펙트 점수 변경
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
        players[i].effectScore=NaN; // 이펙트 끄기
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
  while (1<records.riichi.length){ // 리치, 화료, 방총기록 지우기
    records.riichi.pop();
    records.win.pop();
    records.lose.pop();
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
}

/**모달 창 켜기*/
const showModal = (type: string, status?: string) => {
  isPanelMenuOpen.value = false;
  Object.assign(modalInfo, {
    isOpen: true,
    type: type,
    status: status,
  });
  if (type === 'result_sheet') {
    if (records.time.length > 0 && records.time[records.time.length - 1] === 'ㅤ') {
      records.time[records.time.length - 1] = '결과';
      localStorage.setItem("mahjong_records", JSON.stringify(records));
    }
  }
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
      option.rankUma=[35, 5, -15, -25];
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

  // 점수 변동 이펙트 애니메이션 실행 (완료 후 연장/서입/게임 종료 분기 수행)
  changeScores(() => {
    // 1) 들통(tobi) 여부 검증
    let hasTobi = option.tobi && players.some(p => p.displayScore < 0);
    if (hasTobi) {
      showModal('result_sheet');
      return;
    }

    let curWind = panelInfo.wind;
    let curRound = panelInfo.round;

    // 2) 친의 연장(Renchan) 여부 계산
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
    dice.value[0]=Math.floor(Math.random()*6)+1;
    dice.value[1]=Math.floor(Math.random()*6)+1;
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

// 구글 토큰 수령 시 콜백
const onGoogleTokenReceived = async (_token: string) => {
  googleInfo.isLoggedIn = true;
  await loadMemberList();
  await loadTodayMembers();
};

// 멤버 목록 로드
const loadMemberList = async () => {
  if (!googleInfo.spreadsheetId) return;
  try {
    const list = await fetchMemberList(googleInfo.spreadsheetId);
    googleInfo.memberList = list;
  } catch (err) {
    console.error("멤버 목록 로드 실패:", err);
  }
};

// 오늘의 대국 참여 멤버 로드
const loadTodayMembers = async () => {
  if (!googleInfo.spreadsheetId) return;
  try {
    const pointsMap = await fetchTodayMembers(googleInfo.spreadsheetId);
    googleInfo.todayMembers = Object.keys(pointsMap);
  } catch (err) {
    console.error("오늘의 멤버 로드 실패:", err);
  }
};

// 전체 명단에 신규 멤버 등록
const addNewMember = async (name: string) => {
  if (!googleInfo.spreadsheetId) return;
  try {
    await addNewMemberToDb(googleInfo.spreadsheetId, name);
    await loadMemberList();
  } catch (err) {
    console.error("신규 멤버 등록 실패:", err);
  }
};

// 오늘의 멤버 풀 저장 및 구글 시트 동기화
const saveTodayMembersPool = async (names: string[]) => {
  googleInfo.todayMembers = [...names];
  localStorage.setItem("today_members", JSON.stringify(names));
  if (!googleInfo.spreadsheetId) return;
  try {
    await saveTodayMembers(googleInfo.spreadsheetId, names);
  } catch (err) {
    console.error("오늘의 멤버 풀 저장 실패:", err);
  }
};

// 구글 로그인 트리거
const googleLogin = () => {
  if (!googleInfo.clientId) {
    alert("설정에서 Google Client ID를 먼저 입력해 주세요.");
    return;
  }
  initGis(googleInfo.clientId, onGoogleTokenReceived);
  loginGoogle();
};

// 구글 로그아웃 트리거
const googleLogout = () => {
  logoutGoogle();
  googleInfo.isLoggedIn = false;
  googleInfo.memberList = [];
  googleInfo.todayMembers = [];
  localStorage.removeItem("today_members");
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
  if (skipConfirm || confirm("현재 진행 중인 게임이 초기화됩니다. 새 게임을 시작하시겠습니까?")) {
    resetAll();
    showModal('choose_seat');
  }
};

// 현재 게임 결과 정산 데이터를 구글 스프레드시트 및 로컬 스토리지에 기록합니다.
const saveGameToSheet = async () => {
  // 구글 연동 모드일 때만 구글 세션 필수 체크
  if (googleInfo.syncMode === 'google' && (!googleInfo.spreadsheetId || !googleInfo.isLoggedIn)) {
    alert("구글 연동 모드입니다. 구글 로그인 및 스프레드시트 ID가 유효한지 확인해 주세요.");
    return;
  }

  try {
    const pointsDelta: Record<string, number> = {};

    // 1~4위 랭크 정산 데이터 추출
    const scoreSheet = players.map((p) => {
      let myScore = p.displayScore;
      let oka = (option.returnScore * 4 - option.startingScore * 4) / 1000; // 오카
      let uma = 0; // 우마
      let rank = players.filter(x => x.displayScore > myScore).length + 1; // 순위
      let cnt = players.filter(x => x.displayScore === myScore).length; // 동점자 수
      
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

    // 점수 순으로 정렬해서 1위부터 4위까지 나열
    const sortedResult = [...scoreSheet].sort((a, b) => b.score - a.score);

    // 구글 시트에 들어갈 행(Row) 생성
    const resultRow = [
      new Date().toLocaleString('ko-KR'),
      sortedResult[0].name, sortedResult[0].score, sortedResult[0].point,
      sortedResult[1].name, sortedResult[1].score, sortedResult[1].point,
      sortedResult[2].name, sortedResult[2].score, sortedResult[2].point,
      sortedResult[3].name, sortedResult[3].score, sortedResult[3].point,
    ];

    // 로컬 스토리지 누적 포인트 갱신
    Object.keys(pointsDelta).forEach(name => {
      const prev = localPoints[name] || 0;
      localPoints[name] = parseFloat((prev + pointsDelta[name]).toFixed(1));
    });
    localStorage.setItem("today_members_points", JSON.stringify(localPoints));

    // 구글 연동 모드 시 구글 시트 전송 진행
    if (googleInfo.syncMode === 'google') {
      // 1. 대국 로그 기록
      await appendGameResult(googleInfo.spreadsheetId, resultRow);
      // 2. 오늘의 멤버 누적 점수 합산 업데이트
      await updateTodayMemberPoints(googleInfo.spreadsheetId, pointsDelta);
      alert("대국 결과 및 누적 포인트가 구글 스프레드시트에 업데이트되었습니다!");
    } else {
      alert("게임 결과가 로컬 스코어판에 성공적으로 누적 기록되었습니다!");
    }
  } catch (err) {
    console.error("결과 기록 실패:", err);
    alert("결과 기록 중 오류가 발생했습니다.");
  }
};

// 로컬에서 플레이하던 대기 멤버들의 누적 포인트를 구글 스프레드시트에 일괄 업로드
const syncLocalDataToGoogle = async () => {
  if (!googleInfo.spreadsheetId || !googleInfo.isLoggedIn) {
    alert("구글 로그인 상태와 스프레드시트 ID가 유효한지 확인해 주세요.");
    return;
  }
  try {
    const activeNames = googleInfo.todayMembers;
    if (activeNames.length === 0) {
      alert("오늘 등록된 로컬 대국 멤버가 없습니다.");
      return;
    }

    // 로컬 데이터를 오늘의멤버 구글 시트에 행 단위로 동기화
    const rows: any[][] = [['이름', '누적포인트']];
    activeNames.forEach(name => {
      const point = localPoints[name] !== undefined ? localPoints[name] : 0;
      rows.push([name, point]);
    });
    
    // 시트 초기화 후 덮어쓰기
    await window.gapi.client.sheets.spreadsheets.values.clear({
      spreadsheetId: googleInfo.spreadsheetId,
      range: '오늘의멤버!A:B',
    });
    
    await window.gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId: googleInfo.spreadsheetId,
      range: `오늘의멤버!A1:B${rows.length}`,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: rows,
      },
    });
    alert("로컬의 하루 누적 점수 현황이 구글 스프레드시트에 성공적으로 일괄 동기화되었습니다!");
  } catch (err) {
    console.error("일괄 동기화 실패:", err);
    alert("동기화 중 오류가 발생했습니다. 구글 권한을 확인해 주세요.");
  }
};

// 새로운 날 시작 (로컬 점수 및 명단 초기화)
const startNewDay = async () => {
  const isConfirmed = confirm("로컬에 기록된 오늘 하루의 점수 및 명단 세션이 완전히 초기화됩니다. 새로운 날을 시작하시겠습니까?");
  if (!isConfirmed) return;

  // 로컬 초기화
  localStorage.removeItem("today_members");
  localStorage.removeItem("today_members_points");
  googleInfo.todayMembers = [];
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
</script>

<template>
<div class="background" @dblclick.self="toggleFullScreen()" @click="onBackgroundClick">
  <!-- 각 방향별 player 컴포넌트 생성 -->
  <main role="main">
    <Player v-for="(_, i) in players"
      :key="i"
      :player="players[i]"
      :option
      :modalInfo
      :animateRank="animateRank"
      @toggle-active-riichi="toggleActiveRiichi"
      @start-show-gap="startShowGap"
      @end-show-gap="endShowGap"
    />
    <!-- 중앙 panel 컴포넌트 생성 -->
    <Panel
      :panelInfo
      :isMenuOpen="isPanelMenuOpen"
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
      @save-today-members="saveTodayMembersPool"
      @start-new-game="startNewGame"
      @sync-local-to-google="syncLocalDataToGoogle"
      @start-new-day="startNewDay"
    />
  </Transition>
</div>
</template>

<style>
/* 모달 자연스러운 페이드인/아웃 */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.2s ease;
}
.modal-fade-leave-active {
  pointer-events: none !important;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
</style>