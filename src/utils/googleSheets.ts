let tokenClient: any = null;
let accessToken: string | null = null;

/**
 * GAPI 라이브러리를 로드하고 초기화합니다.
 */
export const initGapi = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    let retryCount = 0;
    const maxRetries = 50; // 최대 5초간 대기
    
    const checkAndInit = () => {
      if (typeof window.gapi !== 'undefined') {
        window.gapi.load('client', async () => {
          try {
            await window.gapi.client.init({});
            await window.gapi.client.load('https://sheets.googleapis.com/$discovery/rest?version=v4');
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      } else {
        retryCount++;
        if (retryCount >= maxRetries) {
          reject(new Error('GAPI SDK not loaded yet. (Timeout 5s)'));
        } else {
          setTimeout(checkAndInit, 100); // 100ms 대기 후 재검증
        }
      }
    };
    
    checkAndInit();
  });
};

/**
 * Google Identity Services (GIS) Token Client를 초기화합니다.
 */
export const initGis = (clientId: string, onTokenCallback: (token: string) => void): void => {
  if (typeof window.google === 'undefined') {
    console.error('Google Identity SDK not loaded yet.');
    return;
  }
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    callback: (tokenResponse: any) => {
      if (tokenResponse.error !== undefined) {
        console.error('Token Client Error:', tokenResponse);
        return;
      }
      accessToken = tokenResponse.access_token;
      window.gapi.client.setToken({ access_token: accessToken });
      localStorage.setItem("google_is_logged_in", "true");
      onTokenCallback(tokenResponse.access_token);
    },
  });
};

/**
 * 로그인 팝업을 띄우고 Access Token을 취득합니다.
 */
export const loginGoogle = (): void => {
  if (!tokenClient) {
    alert('구글 로그인 클라이언트가 초기화되지 않았습니다. Client ID 설정을 확인해 주세요.');
    return;
  }
  tokenClient.requestAccessToken({ prompt: 'consent' });
};

/**
 * 구글 로그아웃 처리
 */
export const logoutGoogle = (): void => {
  if (accessToken) {
    window.google.accounts.oauth2.revoke(accessToken, () => {
      console.log('Access token revoked');
    });
    accessToken = null;
    window.gapi.client.setToken(null);
    localStorage.removeItem("google_is_logged_in");
  }
};

/**
 * 자동 로그인을 시도합니다.
 */
export const tryAutoLogin = async (onTokenCallback: (token: string) => void): Promise<void> => {
  const token = window.gapi?.client?.getToken();
  if (token && token.access_token) {
    onTokenCallback(token.access_token);
    return;
  }
  const wasLoggedIn = localStorage.getItem("google_is_logged_in") === "true";
  if (wasLoggedIn && tokenClient) {
    tokenClient.requestAccessToken({ prompt: '' });
  }
};

/**
 * 지정된 구글 스프레드시트의 '전체 멤버별 통계' 시트에서 멤버들의 이름을 가져옵니다.
 */
export const fetchMemberList = async (spreadsheetId: string): Promise<string[]> => {
  if (!spreadsheetId) return [];
  const range = "'전체 멤버별 통계'!A:A";
  const response = await window.gapi.client.sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId,
    range: range,
  });
  const values = response.result.values;
  if (values && values.length > 1) {
    return values.slice(1).map((row: any) => row[0]).filter((name: string) => name && name.trim() !== '');
  }
  return [];
};

/**
 * 특정 회차 멤버 목록 및 누적 점수를 raw 시트의 A열(이름)과 B열(최종 우마 수식 결과)로부터 로드합니다.
 */
export const fetchSessionMembers = async (spreadsheetId: string, memberSheetTitle: string): Promise<Record<string, number>> => {
  if (!spreadsheetId || !memberSheetTitle) return {};
  
  // memberSheetTitle에서 수식어들을 정제하여 순수 회차명 획득
  const cleanTitle = memberSheetTitle.replace(/\s*\((?:raw|데이터|멤버|상세기록)\)/g, '').trim();
  const rawTitle = `${cleanTitle} (raw)`;

  try {
    // raw 시트의 A2:B20 범위를 조회합니다.
    const response = await window.gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: `'${rawTitle}'!A2:B20`,
    });
    const values = response.result.values;
    const memberPoints: Record<string, number> = {};
    if (values && values.length > 0) {
      values.forEach((row: any) => {
        if (row[0] && row[0].toString().trim() !== '') {
          memberPoints[row[0].toString().trim()] = parseFloat(row[1]) || 0;
        }
      });
    }
    return memberPoints;
  } catch (e) {
    console.warn(`세션 멤버 로드 실패: raw 시트(${rawTitle})가 없거나 아직 생성되지 않았습니다.`, e);
    return {};
  }
};

/**
 * 특정 회차의 참석 멤버 명단을 raw 시트의 A2:A20 영역에 기록하여 갱신합니다.
 */
export const saveSessionMembers = async (spreadsheetId: string, memberSheetTitle: string, activeNames: string[]): Promise<void> => {
  if (!spreadsheetId || !memberSheetTitle) return;

  const cleanTitle = memberSheetTitle.replace(/\s*\((?:raw|데이터|멤버|상세기록)\)/g, '').trim();
  const rawTitle = `${cleanTitle} (raw)`;

  try {
    // 19개 행에 맞추어 이름 명단 조립 (나머지는 빈 문자열)
    const namesColumn: any[][] = [];
    for (let i = 0; i < 19; i++) {
      namesColumn.push([activeNames[i] || ""]);
    }

    await window.gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${rawTitle}'!A2:A20`,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: namesColumn,
      },
    });
    console.log(`raw 시트(${rawTitle})의 A열에 참석 멤버 기입 완료.`);
  } catch (err) {
    console.error(`raw 시트(${rawTitle}) 멤버 기입 실패:`, err);
  }
};

/**
 * raw 시트 B열에 SUMIFS 수식이 이미 등록되어 실시간 합산되므로 코드 레벨에서의 값 덮어쓰기 업데이트는 무시합니다.
 */
export const updateSessionMemberPoints = async (_spreadsheetId: string, _memberSheetTitle: string, _pointsDelta: Record<string, number>): Promise<void> => {
  // raw 시트의 수식이 연산을 대리 처리하므로 동작 생략
  return;
};

/**
 * 알파벳 열 문자 인덱스 변환 함수 (0 -> A, 1 -> B, ...)
 */
const getColumnLetter = (colIndex: number): string => {
  let letter = '';
  let temp = colIndex;
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
};

/**
 * 회차 시트 복사 및 상세/raw 시트 개설 (멤버 시트 생성 생략)
 */
export const createSessionSheetIfNotExist = async (spreadsheetId: string, sheetTitle: string, todayMembers: string[]): Promise<void> => {
  if (!spreadsheetId || !sheetTitle) return;

  // cleanTitle을 확보하여 중복 수식어 생성 방지
  const cleanTitle = sheetTitle.replace(/\s*\((?:raw|데이터|멤버|상세기록)\)/g, '').trim();

  const rawTitle = `${cleanTitle} (raw)`;
  const detailTitle = `${cleanTitle} (데이터)`;

  let existingSheets: string[] = [];
  let resMetadata: any = null;
  try {
    resMetadata = await window.gapi.client.sheets.spreadsheets.get({ spreadsheetId });
    existingSheets = resMetadata.result.sheets.map((s: any) => s.properties.title);
  } catch (e) {
    console.error("회차 시트 생성 전 메타데이터 로드 실패:", e);
    return;
  }

  // 1. 상세 기록용 시트 개설 (데이터 덤프용 숨김 시트)
  if (!existingSheets.includes(detailTitle)) {
    try {
      console.log(`'${detailTitle}' 상세 시트가 없어 명시적으로 개설합니다.`);
      await window.gapi.client.sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: detailTitle,
                  hidden: true
                },
              },
            },
          ],
        },
      });

      const headers = [
        '대국 일시', '대국 ID', '국 구분', '국 인덱스', '종료 상태',
        '플레이어 이름', '친 여부(딜러)', '점수 변동', '최종 점수',
        '리치 여부', '화료 여부', '방총 여부', '텐파이 여부', '최종 순위', '최종 우마(포인트)', '소속 회차',
        '선제 여부', '추격 여부', '피추격 여부', '순수 화료 점수'
      ];
      await window.gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: spreadsheetId,
        range: `'${detailTitle}'!A1:T1`,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [headers],
        },
      });
    } catch (e) {
      console.error(`'${detailTitle}' 개설 및 헤더 입력 실패:`, e);
    }
  }

  // 2. raw 데이터 기록용 시트 개설 (수식 포함 숨김 시트)
  if (!existingSheets.includes(rawTitle)) {
    try {
      console.log(`'${rawTitle}' raw 데이터 시트가 없어 명시적으로 개설합니다.`);
      await window.gapi.client.sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: rawTitle,
                  hidden: true
                },
              },
            },
          ],
        },
      });

      // A1:E1: 멤버 성적표 헤더 기입
      await window.gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${rawTitle}'!A1:E1`,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [['이름', '최종 우마', '평균 순위', '총 대국수', '누적 점수변동']]
        }
      });

      // A2:A20 에 오늘 참가한 멤버 이름 명단 목록 기입 (이름 밀림 및 누락 방지!)
      const namesColumn: any[][] = [];
      for (let i = 0; i < 19; i++) {
        namesColumn.push([todayMembers[i] || ""]);
      }
      await window.gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${rawTitle}'!A2:A20`,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: namesColumn
        }
      });

      // B2:E20: 성적 연산 수식 대량 채우기 (상세 시트인 '${detailTitle}'의 데이터를 조회)
      const memberFormulas: any[][] = [];
      for (let r = 2; r <= 20; r++) {
        memberFormulas.push([
          `=IF(ISBLANK(A${r}), "", SUMIFS('${detailTitle}'!O:O, '${detailTitle}'!F:F, A${r}, '${detailTitle}'!D:D, 1))`,
          `=IF(ISBLANK(A${r}), "", IFERROR(AVERAGEIFS('${detailTitle}'!N:N, '${detailTitle}'!F:F, A${r}, '${detailTitle}'!D:D, 1), ""))`,
          `=IF(ISBLANK(A${r}), "", COUNTIFS('${detailTitle}'!F:F, A${r}, '${detailTitle}'!D:D, 1))`,
          `=IF(ISBLANK(A${r}), "", SUMIFS('${detailTitle}'!H:H, '${detailTitle}'!F:F, A${r}))`
        ]);
      }
      await window.gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${rawTitle}'!B2:E20`,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: memberFormulas
        }
      });

      // F1:W1: 대국 결과 요약 18개 헤더 기입 (E열이 누적 점수변동이므로 F부터 시작)
      const summaryHeaders = [
        '대국 ID', '대국 일시', 
        '동가 이름', '동가 등수', '동가 점수', '동가 우마', 
        '남가 이름', '남가 등수', '남가 점수', '남가 우마', 
        '서가 이름', '서가 등수', '서가 점수', '서가 우마', 
        '북가 이름', '북가 등수', '북가 점수', '북가 우마'
      ];
      await window.gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${rawTitle}'!F1:W1`,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [summaryHeaders]
        }
      });

      console.log(`'${rawTitle}' 데이터 시트 개설 및 수식 적용 완료!`);
    } catch (createErr) {
      console.error(`'${rawTitle}' 개설 실패:`, createErr);
    }
  }

  // 3. '샘플(n인)' 복사를 통한 공개용 종합 리포트 시트 개설
  if (!existingSheets.includes(cleanTitle)) {
    const numMembers = todayMembers.length;
    // 5 이하면 무조건 샘플(5인), 5 초과면 샘플(n인) 선택
    const sampleTitle = numMembers <= 5 ? '샘플(5인)' : `샘플(${numMembers}인)`;

    const sampleSheet = resMetadata.result.sheets.find((s: any) => s.properties.title === sampleTitle);
    if (!sampleSheet) {
      alert(`${numMembers}인 샘플 페이지가 없습니다! 직접 생성해 주세요`);
      throw new Error(`Template sheet '${sampleTitle}' not found.`);
    }

    const sourceSheetId = sampleSheet.properties.sheetId;

    try {
      console.log(`'${sampleTitle}' 탭을 복제하여 '${cleanTitle}' 공개용 종합 시트를 개설합니다.`);
      const resDup: any = await window.gapi.client.sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [
            {
              duplicateSheet: {
                sourceSheetId: sourceSheetId,
                newSheetName: cleanTitle,
                insertSheetIndex: 0
              }
            }
          ]
        }
      });

      // 복제된 시트가 원본 템플릿(숨김 처리 상태)의 hidden 속성을 그대로 물려받으므로, 활성화 상태(보임)로 강제 업데이트
      const newSheetId = resDup.result?.replies?.[0]?.duplicateSheet?.properties?.sheetId;
      if (newSheetId !== undefined) {
        await window.gapi.client.sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          resource: {
            requests: [
              {
                updateSheetProperties: {
                  properties: {
                    sheetId: newSheetId,
                    hidden: false
                  },
                  fields: 'hidden'
                }
              }
            ]
          }
        });
      }

      // 복제된 시트 1행의 가로 셀에 오늘 대국 멤버들의 이름을 2열 단위로 차례로 입력 (B1, D1, F1, ...)
      const row1Values: string[] = [];
      for (let i = 0; i < todayMembers.length; i++) {
        row1Values.push(todayMembers[i]);
        row1Values.push(""); // 병합 셀 자투리 공간 확보용
      }
      
      const colLimitLetter = getColumnLetter(1 + row1Values.length);
      await window.gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${cleanTitle}'!B1:${colLimitLetter}1`,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [row1Values]
        }
      });

      // '시트명' 셀 탐색 및 연동 주소 기입
      let searchRow = -1;
      let searchCol = -1;
      try {
        const scanRes = await window.gapi.client.sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `'${sampleTitle}'!A1:Z100`
        });
        const rows = scanRes.result.values || [];
        for (let r = 0; r < rows.length; r++) {
          for (let c = 0; c < rows[r].length; c++) {
            if (rows[r][c] && rows[r][c].toString().trim() === '시트명') {
              searchRow = r;
              searchCol = c;
              break;
            }
          }
          if (searchRow !== -1) break;
        }
      } catch (scanErr) {
        console.warn("시트명 탐색용 템플릿 스캔 실패:", scanErr);
      }

      const targetR = searchRow !== -1 ? searchRow + 1 : 2;
      const targetC = searchCol !== -1 ? searchCol + 1 : 2;
      const targetCell = `'${cleanTitle}'!${getColumnLetter(targetC)}${targetR}`;

      await window.gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId,
        range: targetCell,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [[rawTitle]]
        }
      });
      console.log(`복제 시트의 '${targetCell}' 셀에 '${rawTitle}' 데이터 연결 완료`);
    } catch (dupErr) {
      console.error(`'${cleanTitle}' 공개용 시트 복제 개설 실패:`, dupErr);
    }
  }
};

/**
 * 대국 로그(Tidy Data)를 시트에 추가합니다.
 */
export const appendRoundRecords = async (spreadsheetId: string, sheetTitle: string, roundDataRows: any[][], todayMembers?: string[]): Promise<void> => {
  if (!spreadsheetId || roundDataRows.length === 0) return;

  const isGlobalLog = sheetTitle === '전체 국별기록 (데이터)';
  const range = `'${sheetTitle}'!A:T`;

  if (!isGlobalLog) {
    const baseTitle = sheetTitle.replace(/\s*\((?:raw|데이터|멤버|상세기록)\)/g, '').trim();
    const resMetadata = await window.gapi.client.sheets.spreadsheets.get({ spreadsheetId });
    const existing = resMetadata.result.sheets.map((s: any) => s.properties.title);
    if (!existing.includes(sheetTitle)) {
      const membersToUse = todayMembers && todayMembers.length > 0
        ? todayMembers
        : Array.from(new Set(roundDataRows.map(row => row[5])));
      await createSessionSheetIfNotExist(spreadsheetId, baseTitle, membersToUse);
    }
  }

  try {
    await window.gapi.client.sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      resource: {
        values: roundDataRows
      }
    });
    console.log(`${sheetTitle} 시트에 ${roundDataRows.length}개의 국별 행 적재 완료`);
  } catch (err) {
    console.error(`${sheetTitle} 적재 실패:`, err);
    throw err;
  }
};

/**
 * 표시용 회차 시트의 가로 대국 요약 데이터(F:W)를 추가 적재합니다. (F2부터 정밀 기입!)
 */
export const appendSessionSummaryRecords = async (spreadsheetId: string, sheetTitle: string, summaryRows: any[][]): Promise<void> => {
  if (!spreadsheetId || summaryRows.length === 0) return;
  try {
    const response = await window.gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetTitle}'!F2:F100`
    });
    const values = response.result.values || [];
    const existingCount = values.filter((row: any) => row[0] && row[0].toString().trim() !== '').length;
    
    const targetRow = 2 + existingCount;
    const endRow = targetRow + summaryRows.length - 1;
    const range = `'${sheetTitle}'!F${targetRow}:W${endRow}`;
    
    await window.gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: summaryRows
      }
    });
    console.log(`${sheetTitle} 표시 시트 F${targetRow} 행부터 대국 요약 정보 ${summaryRows.length}개 적재 완료`);
  } catch (err) {
    console.error(`${sheetTitle} 요약 정보 적재 실패:`, err);
  }
};

/**
 * '전체 누적우마 변동추이 (데이터)' 시트에 회차 누적 성적(Upsert)을 기록합니다. (기능 비활성화됨)
 */
export const upsertSessionUmaHistory = async (_spreadsheetId: string, _sessionLabel: string, _history: any[], _timestamp: string): Promise<void> => {
  return;
};

/**
 * 스프레드시트에서 특정 대국 ID를 가진 행들을 모두 삭제합니다.
 */
export const deleteGameFromSheets = async (spreadsheetId: string, gameId: string, timestamp: string): Promise<void> => {
  if (!spreadsheetId || !gameId) return;

  let existingSheets: string[] = [];
  let res: any = null;
  try {
    res = await window.gapi.client.sheets.spreadsheets.get({ spreadsheetId });
    existingSheets = res.result.sheets.map((s: any) => s.properties.title);
  } catch (e) {
    console.error("삭제 전 시트 목록 조회 실패:", e);
    return;
  }

  const yy = new Date(timestamp).getFullYear().toString().slice(-2);
  const mm = (new Date(timestamp).getMonth() + 1).toString().padStart(2, '0');
  const dd = new Date(timestamp).getDate().toString().padStart(2, '0');
  const yymmdd = `${yy}${mm}${dd}`;

  const targets = [
    { title: '전체 국별기록 (데이터)', col: 'B' }
  ];

  existingSheets.forEach(sheetTitle => {
    if (sheetTitle.includes(yymmdd)) {
      if (sheetTitle.includes('(raw)')) {
        targets.push({ title: sheetTitle, col: 'E' });
      } else if (sheetTitle.includes('(데이터)')) {
        targets.push({ title: sheetTitle, col: 'B' });
      }
    }
  });

  const requests: any[] = [];

  for (const target of targets) {
    if (!existingSheets.includes(target.title)) continue;

    try {
      const range = `'${target.title}'!${target.col}:${target.col}`;
      const response = await window.gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId,
        range,
      });
      const values = response.result.values;
      if (!values) continue;

      let startIndex = -1;
      let count = 0;

      for (let i = 0; i < values.length; i++) {
        if (values[i][0] && values[i][0].toString().trim() === gameId.trim()) {
          if (startIndex === -1) {
            startIndex = i;
          }
          count++;
        }
      }

      if (startIndex !== -1 && count > 0) {
        const sheetObj = res.result.sheets.find((s: any) => s.properties.title === target.title);
        if (sheetObj) {
          const sheetId = sheetObj.properties.sheetId;
          requests.push({
            deleteDimension: {
              range: {
                sheetId: sheetId,
                dimension: 'ROWS',
                startIndex: startIndex,
                endIndex: startIndex + count
              }
            }
          });
        }
      }
    } catch (err) {
      console.warn(`${target.title}에서 대국 ID(${gameId}) 삭제 준비 중 에러:`, err);
    }
  }

  if (requests.length > 0) {
    try {
      await window.gapi.client.sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: { requests }
      });
      console.log(`구글 시트 대국 ID(${gameId}) 삭제 완료!`);
    } catch (err) {
      console.error("구글 시트 행 삭제 batchUpdate 실패:", err);
      throw err;
    }
  }
};

/**
 * 스프레드시트의 기존 시트 목록을 파악하여 다음 회차 시트 이름(예: '제10회 260711')을 생성합니다.
 */
export const getNextSessionSheetName = async (spreadsheetId: string): Promise<string> => {
  if (!spreadsheetId) {
    const now = new Date();
    const yy = now.getFullYear().toString().slice(-2);
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');
    const dd = now.getDate().toString().padStart(2, '0');
    const yymmdd = `${yy}${mm}${dd}`;
    return `제1회 ${yymmdd}`;
  }

  try {
    const res = await window.gapi.client.sheets.spreadsheets.get({ spreadsheetId });
    const sheets = res.result.sheets.map((s: any) => s.properties.title);
    
    let maxN = 0;
    const regex = /^제\s*(\d+)\s*회\s*(\d{6})/i;

    sheets.forEach((title: string) => {
      const match = title.match(regex);
      if (match) {
        const n = parseInt(match[1], 10);
        if (n > maxN) {
          maxN = n;
        }
      }
    });

    const nextN = maxN + 1;
    const now = new Date();
    const yy = now.getFullYear().toString().slice(-2);
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');
    const dd = now.getDate().toString().padStart(2, '0');
    const yymmdd = `${yy}${mm}${dd}`;

    return `제${nextN}회 ${yymmdd}`;
  } catch (err) {
    console.error("다음 회차 시트 이름 결정 실패:", err);
    const now = new Date();
    const yy = now.getFullYear().toString().slice(-2);
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');
    const dd = now.getDate().toString().padStart(2, '0');
    const yymmdd = `${yy}${mm}${dd}`;
    return `제1회 ${yymmdd}`;
  }
};

/**
 * '전체 멤버별 통계' 시트의 교차 색상(Alternating Colors) 규칙 범위를 멤버 수에 딱 맞추어 갱신합니다.
 */
export const updateAlternatingColorsRange = async (spreadsheetId: string, totalMembers: number): Promise<void> => {
  if (!spreadsheetId) return;
  try {
    const metadata = await window.gapi.client.sheets.spreadsheets.get({
      spreadsheetId,
      includeGridData: false
    });
    
    const sheet = metadata.result.sheets.find(
      (s: any) => s.properties.title === '전체 멤버별 통계'
    );
    if (!sheet) return;
    
    const sheetId = sheet.properties.sheetId;
    const rules = sheet.alternatingColorRules;
    if (!rules || rules.length === 0) {
      console.log("통계 시트에 정의된 교차 색상 규칙이 없습니다.");
      return;
    }

    const rule = rules[0];
    const ruleId = rule.alternatingColorRuleId;
    
    const newRange = {
      sheetId: sheetId,
      startRowIndex: 1,
      endRowIndex: totalMembers + 1,
      startColumnIndex: 0,
      endColumnIndex: 23 // A~W열
    };

    await window.gapi.client.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [
          {
            updateAlternatingColorRule: {
              alternatingColorRule: {
                alternatingColorRuleId: ruleId,
                range: newRange
              },
              fields: "range"
            }
          }
        ]
      }
    });
    console.log(`교차 색상 규칙 범위 갱신 완료: A2:W${totalMembers + 1}`);
  } catch (err) {
    console.warn("교차 색상 범위 업데이트 중 오류 발생 (무시 가능):", err);
  }
};

/**
 * '전체 멤버별 통계' 시트에 신규 임시 멤버를 영구 추가하고 교차 색상 범위를 갱신합니다.
 */
export const addNewMembersToDb = async (spreadsheetId: string, names: string[]): Promise<void> => {
  if (!spreadsheetId || names.length === 0) return;
  const range = "'전체 멤버별 통계'!A:A";
  try {
    const response = await window.gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });
    const values = response.result.values || [];
    const existing = new Set(values.map((row: any) => row[0]?.toString().trim()));
    const toAdd = names.filter(n => n && n.trim() !== '' && !existing.has(n.trim()));

    if (toAdd.length > 0) {
      const rows = toAdd.map(n => [n.trim()]);
      await window.gapi.client.sheets.spreadsheets.values.append({
        spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        resource: {
          values: rows
        }
      });
      console.log(`구글 시트 '전체 멤버별 통계'에 신규 임시 멤버 ${toAdd.join(', ')} 추가 완료`);
      
      const updatedTotal = values.length - 1 + toAdd.length;
      await updateAlternatingColorsRange(spreadsheetId, updatedTotal);
    }
  } catch (err) {
    console.error("신규 임시 멤버 구글 시트 추가 실패:", err);
  }
};

/**
 * '전체 멤버별 통계' 시트에서 특정 멤버 이름을 찾아 삭제 처리(행 삭제)하고 교차 색상 범위를 축소합니다.
 */
export const deleteMemberFromDb = async (spreadsheetId: string, name: string): Promise<void> => {
  if (!spreadsheetId || !name || !name.trim()) return;

  try {
    const spreadsheet = await window.gapi.client.sheets.spreadsheets.get({
      spreadsheetId,
    });
    const sheet = spreadsheet.result.sheets.find(
      (s: any) => s.properties.title === '전체 멤버별 통계'
    );
    if (!sheet) {
      console.warn("'전체 멤버별 통계' 시트가 존재하지 않아 삭제가 불가능합니다.");
      return;
    }
    const sheetId = sheet.properties.sheetId;

    const checkResponse = await window.gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "'전체 멤버별 통계'!A1:A500",
    });

    const values = checkResponse.result.values || [];
    const rowIndex = values.findIndex((row: any) => row[0] && row[0].toString().trim() === name.trim());

    if (rowIndex === -1) {
      console.log(`삭제하려는 멤버 '${name}'이 시트에 존재하지 않습니다.`);
      return;
    }

    await window.gapi.client.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId,
                dimension: 'ROWS',
                startIndex: rowIndex,
                endIndex: rowIndex + 1,
              },
            },
          },
        ],
      },
    });
    console.log(`구글 시트에서 멤버 '${name}' 삭제 완료 (행 번호: ${rowIndex + 1})`);
    
    const remainingMembers = values.length - 2;
    await updateAlternatingColorsRange(spreadsheetId, remainingMembers);
  } catch (err) {
    console.error("구글 시트에서 멤버 삭제 실패:", err);
    throw err;
  }
};

/**
 * '전체 멤버별 통계' 시트에서 스탯 목록을 가져옵니다.
 */
export const fetchMemberStats = async (spreadsheetId: string): Promise<any[]> => {
  if (!spreadsheetId) return [];
  try {
    const range = "'전체 멤버별 통계'!A2:AG100";
    const response = await window.gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId,
      range
    });
    const values = response.result.values;
    if (values) {
      return values.map((row: any) => {
        const cleanVal = (idx: number, isInt = false) => {
          if (row[idx] === undefined || row[idx] === null) return 0;
          const cleanStr = row[idx].toString().replace(/,/g, '');
          const parsed = isInt ? parseInt(cleanStr) : parseFloat(cleanStr);
          return isNaN(parsed) ? 0 : parsed;
        };

        return {
          name: row[0] || '',
          uma: cleanVal(1),
          rank: cleanVal(2),
          games: cleanVal(3, true),
          rounds: cleanVal(4, true),
          winRate: cleanVal(5),
          loseRate: cleanVal(6),
          riichiRate: cleanVal(7),
          tenpaiRate: cleanVal(8),
          avgWinScore: cleanVal(9),
          avgLoseScore: cleanVal(10),
          roundSuji: cleanVal(11),
          netScore: cleanVal(32),
          winEfficiency: cleanVal(12),
          loseLoss: cleanVal(13),
          netEfficiency: cleanVal(14),
          tsumoRate: cleanVal(15),
          drawRate: cleanVal(16),
          drawTenpaiRate: cleanVal(17),
          tobiRate: cleanVal(18),
          avgUma: cleanVal(19),
          riichiWinRate: cleanVal(20),
          riichiLoseRate: cleanVal(21),
          riichiDrawRate: cleanVal(22),
          riichiSuji: cleanVal(23),
          riichiIncome: cleanVal(24),
          riichiExpense: cleanVal(25),
          firstRiichiRate: cleanVal(26),
          chaseRiichiRate: cleanVal(27),
          chasedRiichiRate: cleanVal(28),
          oyaKaburiRate: cleanVal(29),
          oyaKaburiAvg: cleanVal(30),
          loseRiichiRate: cleanVal(31)
        };
      });
    }
    return [];
  } catch (err: any) {
    console.warn("구글 시트 전체 통계 로드 실패:", err);
    const msg = err?.result?.error?.message || "";
    if (msg.includes("range") || err?.status === 400) {
      alert("구글 스프레드시트의 열(Column) 개수가 부족하여 전체 기간 통계를 불러오지 못했습니다.\n\n구글 스프레드시트의 '전체 멤버별 통계' 시트에서 W열 오른쪽으로 열을 AG열(33번째 열)까지 늘려주세요.\n(W열 머리글 우클릭 -> '오른쪽에 1개 열 삽입'을 10번 반복)");
    } else {
      alert("전체 통계를 불러오는 중 오류가 발생했습니다: " + msg);
    }
    return [];
  }
};

/**
 * 스프레드시트 필수 구조 존재 여부 검증 (고정 5개 시트 확인)
 */
export const verifySpreadsheetStructures = async (spreadsheetId: string): Promise<boolean> => {
  if (!spreadsheetId) return false;
  try {
    const res = await window.gapi.client.sheets.spreadsheets.get({ spreadsheetId });
    const titles = res.result.sheets.map((s: any) => s.properties.title);
    const required = [
      '전체 국별기록 (데이터)',
      '전체 멤버목록 (데이터)',
      '전체 멤버별 통계'
    ];
    
    const missing = required.filter(t => !titles.includes(t));
    if (missing.length > 0) {
      alert(`스프레드시트에 다음 필수 탭이 누락되어 있습니다:\n- ${missing.join('\n- ')}\n\n해당 탭들을 먼저 생성한 뒤 동기화를 진행해 주세요.`);
      return false;
    }
    return true;
  } catch (e) {
    console.error("스프레드시트 구조 검증 실패:", e);
    alert("구글 스프레드시트 정보를 불러오는 데 실패했습니다. ID 및 로그인 권한을 확인해 주세요.");
    return false;
  }
};
