let tokenClient: any = null;
let codeClient: any = null;
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
 * Google Identity Services (GIS) Token Client를 초기화합니다 (클라이언트 단독 모드).
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
 * Google Identity Services (GIS) Code Client를 초기화합니다 (Cloudflare Worker 프록시 모드).
 * 오프라인 접근(Refresh Token)을 지원하여 백그라운드 무인 갱신을 가능하게 합니다.
 */
export const initGisCodeClient = (
  clientId: string,
  workerUrl: string,
  onTokensReceived: (data: { access_token: string; expires_in?: number; refresh_cipher?: string }) => void,
  onError?: (err: any) => void
): void => {
  if (typeof window.google === 'undefined') {
    console.error('Google Identity SDK not loaded yet.');
    return;
  }
  codeClient = window.google.accounts.oauth2.initCodeClient({
    client_id: clientId,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    ux_mode: 'popup',
    callback: async (response: any) => {
      if (response.error !== undefined) {
        console.error('Code Client Error:', response);
        if (onError) onError(response);
        return;
      }
      const code = response.code;
      try {
        const cleanWorkerUrl = workerUrl.replace(/\/$/, '');
        const res = await fetch(`${cleanWorkerUrl}/api/auth/exchange`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        const data = await res.json();
        if (!res.ok || data.error) {
          throw new Error(data.error || 'Worker token exchange failed');
        }
        accessToken = data.access_token;
        if (typeof window.gapi !== 'undefined' && window.gapi.client) {
          window.gapi.client.setToken({ access_token: accessToken });
        }
        localStorage.setItem("google_is_logged_in", "true");
        if (data.refresh_cipher) {
          localStorage.setItem("google_refresh_cipher", data.refresh_cipher);
        }
        onTokensReceived(data);
      } catch (err) {
        console.error("Worker 토큰 교환 오류:", err);
        if (onError) onError(err);
      }
    },
  });
};

/**
 * 로그인 팝업을 띄우고 Access Token을 취득합니다 (Token Client 방식).
 */
export const loginGoogle = (): void => {
  if (!tokenClient) {
    alert('구글 로그인 클라이언트가 초기화되지 않았습니다. Client ID 설정을 확인해 주세요.');
    return;
  }
  tokenClient.requestAccessToken({ prompt: '' });
};

/**
 * 로그인 팝업을 띄우고 Authorization Code를 취득합니다 (Code Client 방식).
 */
export const loginGoogleWithCode = (): void => {
  if (!codeClient) {
    alert('구글 로그인 클라이언트가 초기화되지 않았습니다. Client ID 및 Worker 설정을 확인해 주세요.');
    return;
  }
  codeClient.requestCode();
};

/**
 * Cloudflare Worker를 통해 암호화된 Refresh Token으로 새 Access Token을 발급받습니다.
 */
export const refreshAccessTokenViaWorker = async (
  workerUrl: string,
  cipher: string
): Promise<{ access_token: string; expires_in: number } | null> => {
  if (!workerUrl || !cipher) return null;
  try {
    const cleanWorkerUrl = workerUrl.replace(/\/$/, '');
    const res = await fetch(`${cleanWorkerUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_cipher: cipher }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error || 'Worker refresh failed');
    }
    if (data.access_token) {
      accessToken = data.access_token;
      if (typeof window.gapi !== 'undefined' && window.gapi.client) {
        window.gapi.client.setToken({ access_token: data.access_token });
      }
      return data;
    }
  } catch (err) {
    console.error("Worker 백그라운드 토큰 갱신 에러:", err);
  }
  return null;
};

/**
 * GAPI 메모리에 Access Token을 수동으로 주입합니다.
 */
export const setGapiAccessToken = (token: string): void => {
  accessToken = token;
  if (typeof window.gapi !== 'undefined' && window.gapi.client) {
    window.gapi.client.setToken({ access_token: token });
  }
};

/**
 * 구글 로그아웃 처리
 */
export const logoutGoogle = (): void => {
  if (accessToken) {
    try {
      window.google?.accounts?.oauth2?.revoke(accessToken, () => {
        console.log('Access token revoked');
      });
    } catch (e) {
      console.warn("Revoke token error:", e);
    }
    accessToken = null;
    if (typeof window.gapi !== 'undefined' && window.gapi.client) {
      window.gapi.client.setToken(null);
    }
    localStorage.removeItem("google_is_logged_in");
    localStorage.removeItem("google_refresh_cipher");
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
  try {
    const range = "'전체 멤버별 통계'!A:A";
    const response = await window.gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: range,
    });
    const values = response.result.values;
    if (values && values.length > 1) {
      const list = values
        .slice(1)
        .map((row: any) => row[0]?.toString().trim())
        .filter((name: string) => name && name !== '' && !name.startsWith('#') && name !== '이름');
      if (list.length > 0) {
        return Array.from(new Set(list));
      }
    }
  } catch (e) {
    console.warn("fetchMemberList '전체 멤버별 통계' 조회 실패, 폴백 시도:", e);
  }

  // 1차 폴백: '전체 멤버목록 (데이터)'!A:A
  try {
    const fb1Res = await window.gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "'전체 멤버목록 (데이터)'!A:A",
    });
    const fb1Values = fb1Res.result.values;
    if (fb1Values && fb1Values.length > 1) {
      const list = fb1Values
        .slice(1)
        .map((row: any) => row[0]?.toString().trim())
        .filter((name: string) => name && name !== '' && !name.startsWith('#') && name !== '이름');
      if (list.length > 0) {
        return Array.from(new Set(list));
      }
    }
  } catch (e1) {
    console.warn("fetchMemberList '전체 멤버목록 (데이터)' 폴백 실패:", e1);
  }

  // 2차 폴백: '통계'!A2:A
  try {
    const fb2Res = await window.gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "'통계'!A2:A",
    });
    const fb2Values = fb2Res.result.values;
    if (fb2Values && fb2Values.length > 0) {
      const list = fb2Values
        .map((row: any) => row[0]?.toString().trim())
        .filter((name: string) => name && name !== '' && !name.startsWith('#') && name !== '이름');
      if (list.length > 0) {
        return Array.from(new Set(list));
      }
    }
  } catch (e2) {
    console.warn("fetchMemberList '통계' 폴백 실패:", e2);
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

      // '통계' 시트(gid=0)에 해당 회차 열 개설 및 raw 시트 기반 VLOOKUP 최종 우마 수식 연결
      await syncSessionUmaToStatsSheet(spreadsheetId, cleanTitle, todayMembers);
    } catch (dupErr) {
      console.error(`'${cleanTitle}' 공개용 시트 복제 개설 실패:`, dupErr);
    }
  }
};

/**
 * '통계' 시트(gid=0)에 해당 회차의 열을 확인/연동하고, 각 선수 행에 raw 시트 VLOOKUP 수식을 연결합니다.
 * raw 시트($A$2:$B$30)를 이름 기반 VLOOKUP으로 참조하므로,
 * 인원 변동 마이그레이션이나 10회전 단위 시트 확장(행 이동)에도 참조 무결성이 100% 안전하게 유지됩니다.
 */
export const syncSessionUmaToStatsSheet = async (
  spreadsheetId: string,
  sessionTitle: string,
  todayMembers: string[] = [],
  gameCount?: number
): Promise<void> => {
  if (!spreadsheetId || !sessionTitle) return;

  const cleanTitle = sessionTitle.replace(/\s*\((?:raw|데이터|멤버|상세기록)\)/g, '').trim();
  const rawTitle = `${cleanTitle} (raw)`;

  try {
    const resMetadata = await window.gapi.client.sheets.spreadsheets.get({ spreadsheetId });
    const sheets = resMetadata.result.sheets || [];
    const statsSheet = sheets.find((s: any) => s.properties.title === '통계');
    if (!statsSheet) {
      console.log("'통계' 시트가 존재하지 않아 최종우마 연동을 건너뜁니다.");
      return;
    }

    // 1. '통계' 시트 1행 헤더 조회 (어느 열이 해당 회차인지 판별)
    const headerRes = await window.gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "'통계'!1:1",
    });
    const headerRow: string[] = headerRes.result.values?.[0] || [];

    // 회차 키워드 및 회차 번호 정밀 추출 (예: '제15회 260926' -> roundNum=15, roundKeyword='제15회')
    const matchRound = cleanTitle.match(/제\s*(\d+)\s*(?:회차|회)/);
    const roundNum = matchRound ? parseInt(matchRound[1], 10) : null;
    const roundKeyword = roundNum !== null ? `제${roundNum}회` : cleanTitle;

    // 회차 번호에 따른 표준 열 인덱스 공식:
    // Col A(0: 이름), Col B(1: 총합), Col C(2: 제1회 = 1+1), ..., Col Q(16: 제15회 = 15+1)
    const canonicalColIdx = roundNum !== null && roundNum >= 1 ? (roundNum + 1) : -1;

    let targetColIdx = -1;

    // 1-1. 1행 헤더에서 해당 회차 열 탐색
    // ★ 주의: Col A(0)과 Col B(1)은 이름 및 총합 열이므로 절대 탐색/매칭하지 않음 (c = 2부터 시작)
    for (let c = 2; c < headerRow.length; c++) {
      const colText = (headerRow[c] || '').toString().trim();
      if (!colText) continue; // 빈칸은 절대 매칭하지 않음! ("".includes("") 버그 원천 차단)

      // 회차 번호가 일치하는지 정규식 검사
      const colMatch = colText.match(/제\s*(\d+)\s*(?:회차|회)/);
      if (colMatch && roundNum !== null && parseInt(colMatch[1], 10) === roundNum) {
        targetColIdx = c;
        break;
      }
      if (colText.includes(roundKeyword) || (cleanTitle && colText.includes(cleanTitle))) {
        targetColIdx = c;
        break;
      }
    }

    // 1-2. 헤더 탐색에서 찾지 못한 경우:
    // 회차 번호가 있으면 표준 열(제15회 -> 16 = Q열)을 최우선 배정
    if (targetColIdx === -1) {
      if (canonicalColIdx >= 2) {
        targetColIdx = canonicalColIdx;
      } else {
        targetColIdx = Math.max(2, headerRow.length);
      }
    }

    // ★ 절대적 안전 가드레일: targetColIdx는 어떠한 경우에도 0(A열)이나 1(B열)이 될 수 없음!
    if (targetColIdx < 2) {
      console.error(`[CRITICAL] 잘못된 대상 열 인덱스(${targetColIdx}) 감지. C열(2) 이상으로 강제 조정합니다.`);
      targetColIdx = canonicalColIdx >= 2 ? canonicalColIdx : 2;
    }

    // 1.5. 통계 시트의 열 개수 확인 및 26회차 이상 시 우측 열 자동 확장
    const gridCols = statsSheet.properties?.gridProperties?.columnCount || 26;
    if (targetColIdx >= gridCols) {
      const colsToAdd = Math.max(10, targetColIdx - gridCols + 1);
      await window.gapi.client.sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [
            {
              appendDimension: {
                sheetId: statsSheet.properties.sheetId,
                dimension: 'COLUMNS',
                length: colsToAdd,
              },
            },
          ],
        },
      });
      console.log(`'통계' 시트 우측 열 자동 확장 완료: ${gridCols}열 -> ${gridCols + colsToAdd}열 (신규 회차 수용)`);
    }

    const sessionColLetter = getColumnLetter(targetColIdx);

    // 1.6. 회차에서 진행된 회전 수(대국수)에 따라 '제x회\ny국' 형식의 raw 텍스트로 1행 헤더 자동 갱신
    const headerTitle = (gameCount !== undefined && gameCount > 0)
      ? `${roundKeyword}\n${gameCount}국`
      : (headerRow[targetColIdx] || roundKeyword);

    await window.gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'통계'!${sessionColLetter}1`,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[headerTitle]],
      },
    });
    console.log(`'통계' 시트 ${sessionColLetter}1 헤더를 '${headerTitle.replace('\n', ' ')}'으로 갱신 완료`);

    // 2. '통계' 시트 선수 명단(A열) 및 총합(B열) 조회
    const playersRes = await window.gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "'통계'!A1:B100",
    });
    const playerRows: string[][] = playersRes.result.values || [];
    const existingPlayers = new Map<string, number>(); // name -> 1-based row index

    for (let r = 1; r < playerRows.length; r++) { // 0행은 헤더
      const name = (playerRows[r]?.[0] || '').toString().trim();
      if (name && !name.startsWith('=') && !name.startsWith('#') && name !== '이름') {
        existingPlayers.set(name, r + 1);
      }
    }

    // 3. 오늘 참석자 중 '통계' 시트에 없는 신규 멤버가 있으면 행 추가 (총합 수식은 ZZ열까지 여유있게 합산)
    const newMembersToAdd = todayMembers.filter(m => m && m.trim() && !existingPlayers.has(m.trim()));
    if (newMembersToAdd.length > 0) {
      let nextRow = playerRows.length + 1;
      const appendRows: any[][] = [];
      newMembersToAdd.forEach(name => {
        appendRows.push([name, `=SUM(C${nextRow}:ZZ${nextRow})`]);
        existingPlayers.set(name, nextRow);
        nextRow++;
      });

      const startRow = playerRows.length + 1;
      const endRow = startRow + appendRows.length - 1;
      await window.gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'통계'!A${startRow}:B${endRow}`,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: appendRows
        }
      });
      console.log(`'통계' 시트에 신규 선수 [${newMembersToAdd.join(', ')}] 행 추가 완료 (A${startRow}:B${endRow})`);
    }

    // 4. 각 선수 행에 raw 시트 VLOOKUP 연동 수식 설정
    const totalPlayerCount = existingPlayers.size;
    if (totalPlayerCount > 0) {
      const maxRow = Math.max(...Array.from(existingPlayers.values()));
      const formulaRows: any[][] = [];
      for (let r = 2; r <= maxRow; r++) {
        formulaRows.push([
          `=IFERROR(VLOOKUP(A${r}, '${rawTitle}'!$A$2:$B$30, 2, FALSE), "")`
        ]);
      }

      await window.gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'통계'!${sessionColLetter}2:${sessionColLetter}${maxRow}`,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: formulaRows
        }
      });
      console.log(`'통계' 시트 ${sessionColLetter}2:${sessionColLetter}${maxRow}에 '${rawTitle}' 최종우마 VLOOKUP 연동 완료`);
    }
  } catch (err) {
    console.warn("'통계' 시트 최종우마 자동 연동 중 오류 (무시 가능):", err);
  }
};

/**
 * 20회전 초과 시 회차 시트를 10회전(20행) 단위로 자동 확장합니다.
 * 20행 삽입 후 '성적' 및 '시트명' 셀의 위치 이동에 맞추어 수식 내 $B$45 -> $B$65 등으로 자동 일괄 업데이트합니다.
 */
export const expandSessionSheetRowsIfNeeded = async (
  spreadsheetId: string,
  sheetTitle: string,
  gameCount: number
): Promise<void> => {
  if (!spreadsheetId || !sheetTitle || gameCount <= 20) return;

  const cleanTitle = sheetTitle.replace(/\s*\((?:raw|데이터|멤버|상세기록)\)/g, '').trim();

  try {
    const resMetadata = await window.gapi.client.sheets.spreadsheets.get({ spreadsheetId });
    const sheets = resMetadata.result.sheets || [];
    const sessionSheet = sheets.find((s: any) => s.properties.title === cleanTitle);
    if (!sessionSheet) return;

    const sheetId = sessionSheet.properties.sheetId;

    // A열 1~120행을 스캔하여 '성적' 및 '시트명'의 현재 행 위치 탐색
    const colARes = await window.gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${cleanTitle}'!A1:B120`,
    });
    const colAValues: any[][] = colARes.result.values || [];

    let scoreRowIdx = -1; // 1-based row index for '성적'
    let sheetNameRowIdx = -1; // 1-based row index for '시트명'

    for (let r = 0; r < colAValues.length; r++) {
      const textA = (colAValues[r]?.[0] || '').toString().trim();
      const textB = (colAValues[r]?.[1] || '').toString().trim();
      if (textA === '성적') {
        scoreRowIdx = r + 1;
      }
      if (textA === '시트명' || textB.includes('(raw)')) {
        sheetNameRowIdx = r + 1;
      }
    }

    if (scoreRowIdx === -1) {
      scoreRowIdx = 43;
    }
    if (sheetNameRowIdx === -1) {
      sheetNameRowIdx = scoreRowIdx + 2;
    }

    // 현재 수용 가능한 회전 수: 1회전이 row 2, 20회전이 row 40 -> (scoreRowIdx - 3) / 2
    const currentMaxRounds = Math.floor((scoreRowIdx - 3) / 2);
    if (gameCount <= currentMaxRounds) {
      return;
    }

    // 필요한 확장 횟수 계산 (10회전 = 20행 단위)
    const neededRounds = gameCount - currentMaxRounds;
    const expansionSteps = Math.ceil(neededRounds / 10);
    const rowsToInsert = expansionSteps * 20;
    const newMaxRounds = currentMaxRounds + (expansionSteps * 10);

    console.log(`'${cleanTitle}' 시트 대국 수(${gameCount}) 초과 감지: ${rowsToInsert}행(10회전 단위 ${expansionSteps}회)을 자동 확장합니다.`);

    // 1. '성적' 행 윗 줄(scoreRowIdx - 2 행 다음)에 rowsToInsert개 행 삽입
    const insertStartIndex = scoreRowIdx - 2; // 0-based index

    await window.gapi.client.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [
          {
            insertDimension: {
              range: {
                sheetId,
                dimension: 'ROWS',
                startIndex: insertStartIndex,
                endIndex: insertStartIndex + rowsToInsert,
              },
              inheritFromBefore: true,
            },
          },
        ],
      },
    });

    const newScoreRowIdx = scoreRowIdx + rowsToInsert;
    const newSheetNameRowIdx = sheetNameRowIdx + rowsToInsert;

    // 2. 직전 회전(2개 행)의 수식을 읽어와 새로 삽입된 모든 회전 행에 복제
    const sampleRowStart = insertStartIndex - 1; // 1-based (직전 회전의 첫 행)
    const sampleRowEnd = insertStartIndex;     // 1-based (직전 회전의 둘째 행)
    let formulaTemplates: any[][] = [];

    try {
      const sampleRes = await window.gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${cleanTitle}'!B${sampleRowStart}:Z${sampleRowEnd}`,
        valueRenderOption: 'FORMULA',
      });
      formulaTemplates = sampleRes.result.values || [];
    } catch (e) {
      console.warn("회전 수식 템플릿 읽기 실패:", e);
    }

    // 새로 삽입된 행 데이터 조립 (A열 라벨 + B~Z열 수식)
    const newRowsValues: any[][] = [];
    for (let rnd = currentMaxRounds + 1; rnd <= newMaxRounds; rnd++) {
      const row1 = [`${rnd}회전`, ...(formulaTemplates[0] || [])];
      const row2 = ['', ...(formulaTemplates[1] || [])];
      newRowsValues.push(row1);
      newRowsValues.push(row2);
    }

    const startInsertRow = insertStartIndex + 1;
    const endInsertRow = startInsertRow + rowsToInsert - 1;
    const maxColsLetter = getColumnLetter(Math.max(25, (formulaTemplates[0]?.length || 0) + 1));

    await window.gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${cleanTitle}'!A${startInsertRow}:${maxColsLetter}${endInsertRow}`,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: newRowsValues,
      },
    });

    // 3. 기존 및 신규 행의 수식들 내 raw 시트명 셀 주소($B$45 -> $B${newSheetNameRowIdx}) 일괄 치환
    const oldSheetCellRef = `$B$${sheetNameRowIdx}`;
    const newSheetCellRef = `$B$${newSheetNameRowIdx}`;

    if (oldSheetCellRef !== newSheetCellRef) {
      await window.gapi.client.sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [
            {
              findReplace: {
                find: oldSheetCellRef,
                replacement: newSheetCellRef,
                sheetId,
                allSheets: false,
                matchCase: false,
                includeFormulas: true,
              },
            },
          ],
        },
      });
      console.log(`'${cleanTitle}' 시트 내 수식 참조 주소 일괄 업데이트 완료: ${oldSheetCellRef} -> ${newSheetCellRef}`);
    }

    // 4. '성적' 행의 SUM 수식 범위 갱신: =SUM(C2:C{lastGameRow})
    const lastGameRow = newScoreRowIdx - 2;
    const headerColsRes = await window.gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${cleanTitle}'!1:1`,
    });
    const headerCols: any[] = headerColsRes.result.values?.[0] || [];
    const sumRowValues: string[] = ['성적'];

    for (let c = 1; c < headerCols.length; c++) {
      const colLetter = getColumnLetter(c);
      if (c % 2 === 0) {
        // 짝수 인덱스 열(C, E, G... 우마 열)
        sumRowValues.push(`=SUM(${colLetter}2:${colLetter}${lastGameRow})`);
      } else {
        sumRowValues.push('');
      }
    }

    const lastColLetter = getColumnLetter(sumRowValues.length - 1);
    await window.gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${cleanTitle}'!A${newScoreRowIdx}:${lastColLetter}${newScoreRowIdx}`,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [sumRowValues],
      },
    });

    console.log(`'${cleanTitle}' 시트 10회전 단위 확장 완료! 총 ${newMaxRounds}회전 수용 가능 (성적 행: A${newScoreRowIdx})`);
  } catch (err) {
    console.error(`'${cleanTitle}' 시트 10회전 단위 확장 중 오류:`, err);
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
      endColumnIndex: 37 // A~AK열
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
    console.log(`교차 색상 규칙 범위 갱신 완료: A2:AK${totalMembers + 1}`);
  } catch (err) {
    console.warn("교차 색상 범위 업데이트 중 오류 발생 (무시 가능):", err);
  }
};

/**
 * '전체 멤버별 통계' 시트의 A2 셀에 걸려있는 동적 배열 수식(=UNIQUE(FILTER(...)))이
 * 하위 셀(A3:A500)의 하드코딩된 값으로 인해 #REF! Spill Error(확장 충돌)를 일으키지 않도록
 * A3:A500 범위를 자동으로 클리어하여 수식을 즉각 복구합니다.
 */
export const repairStatsSheetSpillError = async (spreadsheetId: string): Promise<boolean> => {
  if (!spreadsheetId) return false;
  try {
    await window.gapi.client.sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: "'전체 멤버별 통계'!A3:A500",
    });
    console.log("'전체 멤버별 통계' 시트 A3:A500 클리어 완료 (Spill 에러 자동 복구)");
    return true;
  } catch (err) {
    console.warn("'전체 멤버별 통계' 시트 Spill 복구 중 오류 (무시 가능):", err);
    return false;
  }
};

/**
 * '전체 멤버별 통계' 시트에 신규 임시 멤버를 영구 추가하고 교차 색상 범위를 갱신합니다.
 * A2에 동적 배열 수식이 걸려있는 경우 직접 값을 입력하면 #REF! Spill Error가 발생하므로,
 * A3:A500을 클리어하여 수식 확장을 보장하고 교차 색상만 갱신합니다.
 */
export const addNewMembersToDb = async (spreadsheetId: string, names: string[]): Promise<void> => {
  if (!spreadsheetId || names.length === 0) return;
  const range = "'전체 멤버별 통계'!A1:A500";
  try {
    const response = await window.gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: 'FORMULA',
    });
    const values: string[][] = response.result.values || [];
    
    // 1. A2 셀이 수식인지 확인 (배열 수식이면 하위 행에 직접 입력 금지)
    const a2Val = (values[1]?.[0] || '').toString().trim();
    const isFormula = a2Val.startsWith('=');

    if (isFormula) {
      // 1-1. '전체 멤버목록 (데이터)' 시트에 신규 멤버 추가 (동적 배열 수식의 원본 데이터 소스)
      try {
        const masterRes = await window.gapi.client.sheets.spreadsheets.values.get({
          spreadsheetId,
          range: "'전체 멤버목록 (데이터)'!A:A",
        });
        const masterValues: string[][] = masterRes.result.values || [];
        const masterExisting = new Set<string>();
        for (let i = 0; i < masterValues.length; i++) {
          const val = masterValues[i]?.[0]?.toString().trim();
          if (val) masterExisting.add(val);
        }
        const toAddToMaster = names
          .map(n => n?.trim())
          .filter((n): n is string => !!n && !masterExisting.has(n));

        if (toAddToMaster.length > 0) {
          await window.gapi.client.sheets.spreadsheets.values.append({
            spreadsheetId,
            range: "'전체 멤버목록 (데이터)'!A:A",
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            resource: {
              values: toAddToMaster.map(n => [n]),
            },
          });
          console.log(`'전체 멤버목록 (데이터)'에 신규 멤버 [${toAddToMaster.join(', ')}] 추가 완료`);
        }
      } catch (masterErr) {
        console.warn("'전체 멤버목록 (데이터)' 갱신 중 오류 (무시 가능):", masterErr);
      }

      // 1-2. 배열 수식이 깨지지 않도록 A3:A500 클리어 수행하여 수식 확장 보장
      await repairStatsSheetSpillError(spreadsheetId);
      console.log("'전체 멤버별 통계' A2가 배열 수식이므로 직접 입력 대신 수식 자동 연동 및 Spill 복구 수행");
      return;
    }

    // 2. 기존에 등록된 멤버 이름 Set 구성 (1행 헤더 제외)
    const existing = new Set<string>();
    for (let i = 1; i < values.length; i++) {
      const val = values[i]?.[0]?.toString().trim();
      if (val) existing.add(val);
    }

    const toAdd = names
      .map(n => n?.trim())
      .filter((n): n is string => !!n && !existing.has(n));

    if (toAdd.length === 0) return;

    // 3. A열에서 이름이 비어있는 첫 번째 행(1-based row index) 탐색 (2행부터)
    let targetRowIndex = -1;
    for (let r = 2; r <= values.length; r++) {
      const cellVal = values[r - 1]?.[0]?.toString().trim();
      if (!cellVal) {
        targetRowIndex = r;
        break;
      }
    }
    if (targetRowIndex === -1) {
      targetRowIndex = values.length + 1;
    }

    // 4. values.append 대신 빈 위치에 values.update로 직접 입력
    const endRowIndex = targetRowIndex + toAdd.length - 1;
    await window.gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'전체 멤버별 통계'!A${targetRowIndex}:A${endRowIndex}`,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: toAdd.map(n => [n])
      }
    });

    console.log(`구글 시트 '전체 멤버별 통계' A${targetRowIndex}행부터 신규 멤버 [${toAdd.join(', ')}] 추가 완료`);

    // 5. 총 멤버 수에 맞게 교차 색상 범위 갱신
    const totalMembers = existing.size + toAdd.length;
    await updateAlternatingColorsRange(spreadsheetId, totalMembers);
  } catch (err) {
    console.error("신규 멤버 구글 시트 추가 실패:", err);
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
      valueRenderOption: 'FORMULA',
    });

    const values = checkResponse.result.values || [];
    const a2Val = (values[1]?.[0] || '').toString().trim();
    const isFormula = a2Val.startsWith('=');

    if (isFormula) {
      // 배열 수식이면 '전체 멤버별 통계'에서 행을 직접 삭제하면 수식이 파괴되므로,
      // 원본 데이터 시트인 '전체 멤버목록 (데이터)'에서 해당 멤버를 삭제하고 Spill 복구
      try {
        const masterRes = await window.gapi.client.sheets.spreadsheets.values.get({
          spreadsheetId,
          range: "'전체 멤버목록 (데이터)'!A:A",
        });
        const masterValues: string[][] = masterRes.result.values || [];
        const mRowIndex = masterValues.findIndex((r: any) => r[0] && r[0].toString().trim() === name.trim());
        if (mRowIndex !== -1) {
          const mSheet = spreadsheet.result.sheets.find((s: any) => s.properties.title === '전체 멤버목록 (데이터)');
          if (mSheet) {
            await window.gapi.client.sheets.spreadsheets.batchUpdate({
              spreadsheetId,
              resource: {
                requests: [
                  {
                    deleteDimension: {
                      range: {
                        sheetId: mSheet.properties.sheetId,
                        dimension: 'ROWS',
                        startIndex: mRowIndex,
                        endIndex: mRowIndex + 1,
                      },
                    },
                  },
                ],
              },
            });
            console.log(`'전체 멤버목록 (데이터)'에서 멤버 '${name}' 삭제 완료`);
          }
        }
      } catch (mErr) {
        console.warn("'전체 멤버목록 (데이터)' 멤버 삭제 중 오류:", mErr);
      }
      await repairStatsSheetSpillError(spreadsheetId);
      return;
    }

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
export const fetchMemberStats = async (spreadsheetId: string, silent = false): Promise<any[]> => {
  if (!spreadsheetId) return [];
  try {
    const range = "'전체 멤버별 통계'!A2:AK100";
    const response = await window.gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId,
      range
    });
    const values = response.result.values;
    if (values) {
      return values
        .filter((row: any) => row[0] && !row[0].toString().startsWith('#') && row[0].toString().trim() !== '' && row[0].toString().trim() !== '이름')
        .map((row: any) => {
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
          r1: cleanVal(33, true),
          r2: cleanVal(34, true),
          r3: cleanVal(35, true),
          r4: cleanVal(36, true),
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
    if (!silent) {
      const msg = err?.result?.error?.message || "";
      if (msg.includes("range") || err?.status === 400) {
        alert("구글 스프레드시트의 열(Column) 개수가 부족하여 전체 기간 통계를 불러오지 못했습니다.\n\n구글 스프레드시트의 '전체 멤버별 통계' 시트에서 W열 오른쪽으로 열을 AG열(33번째 열)까지 늘려주세요.\n(W열 머리글 우클릭 -> '오른쪽에 1개 열 삽입'을 10번 반복)");
      } else {
        alert("전체 통계를 불러오는 중 오류가 발생했습니다: " + msg);
      }
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

export interface SessionMigrationBackup {
  id: string;
  timestamp: number;
  timeStr: string;
  sessionSheetName: string;
  backupSheetTitle: string;
  oldMembers: string[];
  newMembers: string[];
  gamesCount: number;
}

/**
 * 회차 중간 멤버 변경 시: 기존 시트를 안전하게 백업하고 새 인원수 템플릿으로 시트를 마이그레이션합니다.
 */
export const migrateSessionSheetToNewMembers = async (
  spreadsheetId: string,
  sessionTitle: string,
  oldMembers: string[],
  newMembers: string[],
  todayGames: any[] = []
): Promise<string> => {
  if (!spreadsheetId || !sessionTitle) throw new Error("스프레드시트 ID 또는 세션 이름이 누락되었습니다.");

  const cleanTitle = sessionTitle.replace(/\s*\((?:raw|데이터|멤버|상세기록)\)/g, '').trim();
  const rawTitle = `${cleanTitle} (raw)`;

  const now = new Date();
  const HH = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const backupTitle = `${cleanTitle}_백업_${HH}${mm}_${ss}`;

  // 1. 현재 스프레드시트 메타데이터 조회
  const resMetadata = await window.gapi.client.sheets.spreadsheets.get({ spreadsheetId });
  const sheets = resMetadata.result.sheets || [];

  const currentCleanSheet = sheets.find((s: any) => s.properties.title === cleanTitle);

  // 2. 만약 기존 cleanTitle 시트가 존재한다면, backupTitle로 이름 변경(Rename)하여 100% 온전하게 백업 보존
  if (currentCleanSheet) {
    await window.gapi.client.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [
          {
            updateSheetProperties: {
              properties: {
                sheetId: currentCleanSheet.properties.sheetId,
                title: backupTitle
              },
              fields: 'title'
            }
          }
        ]
      }
    });
    console.log(`기존 시트 '${cleanTitle}'을 '${backupTitle}'로 안전하게 백업 전환 완료.`);
  }

  // 3. 새 멤버 수에 맞는 템플릿 탐색 (5인 이하는 샘플(5인), 5인 초과는 샘플(N인))
  const numMembers = newMembers.length;
  const sampleTitle = numMembers <= 5 ? '샘플(5인)' : `샘플(${numMembers}인)`;
  const sampleSheet = sheets.find((s: any) => s.properties.title === sampleTitle);

  if (!sampleSheet) {
    // 롤백: 템플릿이 없을 경우 백업 시트 이름을 다시 원래대로 복원
    if (currentCleanSheet) {
      await window.gapi.client.sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [
            {
              updateSheetProperties: {
                properties: {
                  sheetId: currentCleanSheet.properties.sheetId,
                  title: cleanTitle
                },
                fields: 'title'
              }
            }
          ]
        }
      });
    }
    throw new Error(`스프레드시트에 '${sampleTitle}' 템플릿 시트가 존재하지 않습니다. 구글 시트에서 템플릿을 생성해 주세요.`);
  }

  // 4. 새 템플릿 복제하여 cleanTitle 시트 개설
  const sourceSheetId = sampleSheet.properties.sheetId;
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

  // 5. 복제된 시트 1행에 새 멤버 이름 2열 간격 기입 (B1, D1, F1...)
  const row1Values: string[] = [];
  for (let i = 0; i < newMembers.length; i++) {
    row1Values.push(newMembers[i]);
    row1Values.push("");
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

  // 6. '시트명' 셀 탐색 및 rawTitle 연동 주소 기입
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

  // 7. raw 시트 A2:A20에 새 멤버 목록 반영
  await saveSessionMembers(spreadsheetId, cleanTitle, newMembers);

  // 7.5. '통계' 시트(gid=0)에 새 멤버 반영 및 VLOOKUP 최종 우마 수식 재연동
  await syncSessionUmaToStatsSheet(spreadsheetId, cleanTitle, newMembers);

  // 8. 로컬 스토리지에 백업 이력 저장
  const backupRecord: SessionMigrationBackup = {
    id: `migration_${Date.now()}`,
    timestamp: now.getTime(),
    timeStr: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${HH}:${mm}:${ss}`,
    sessionSheetName: cleanTitle,
    backupSheetTitle: backupTitle,
    oldMembers: [...oldMembers],
    newMembers: [...newMembers],
    gamesCount: todayGames.length
  };

  try {
    const rawBackups = localStorage.getItem("session_migration_backups") || "[]";
    const backups: SessionMigrationBackup[] = JSON.parse(rawBackups);
    backups.unshift(backupRecord);
    if (backups.length > 30) backups.length = 30;
    localStorage.setItem("session_migration_backups", JSON.stringify(backups));
  } catch (e) {
    console.warn("마이그레이션 백업 로컬 기록 실패:", e);
  }

  return backupTitle;
};

/**
 * 현재 세션 시트를 수동으로 백업합니다.
 */
export const backupSessionSheet = async (
  spreadsheetId: string,
  sessionTitle: string,
  currentMembers: string[],
  todayGames: any[] = []
): Promise<string> => {
  if (!spreadsheetId || !sessionTitle) throw new Error("스프레드시트 ID 또는 세션 이름이 누락되었습니다.");

  const cleanTitle = sessionTitle.replace(/\s*\((?:raw|데이터|멤버|상세기록)\)/g, '').trim();

  const now = new Date();
  const HH = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const backupTitle = `${cleanTitle}_수동백업_${HH}${mm}_${ss}`;

  const resMetadata = await window.gapi.client.sheets.spreadsheets.get({ spreadsheetId });
  const sheets = resMetadata.result.sheets || [];
  const currentSheet = sheets.find((s: any) => s.properties.title === cleanTitle);
  if (!currentSheet) {
    throw new Error(`백업할 시트 '${cleanTitle}'가 존재하지 않습니다.`);
  }

  await window.gapi.client.sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    resource: {
      requests: [
        {
          duplicateSheet: {
            sourceSheetId: currentSheet.properties.sheetId,
            newSheetName: backupTitle,
            insertSheetIndex: currentSheet.properties.index + 1
          }
        }
      ]
    }
  });

  const backupRecord: SessionMigrationBackup = {
    id: `manual_${Date.now()}`,
    timestamp: now.getTime(),
    timeStr: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${HH}:${mm}:${ss}`,
    sessionSheetName: cleanTitle,
    backupSheetTitle: backupTitle,
    oldMembers: [...currentMembers],
    newMembers: [...currentMembers],
    gamesCount: todayGames.length
  };

  try {
    const rawBackups = localStorage.getItem("session_migration_backups") || "[]";
    const backups: SessionMigrationBackup[] = JSON.parse(rawBackups);
    backups.unshift(backupRecord);
    if (backups.length > 30) backups.length = 30;
    localStorage.setItem("session_migration_backups", JSON.stringify(backups));
  } catch (e) {
    console.warn("수동 백업 로컬 기록 실패:", e);
  }

  return backupTitle;
};

/**
 * 백업된 시트를 활성 세션 시트로 복원합니다.
 */
export const restoreSessionSheetFromBackup = async (
  spreadsheetId: string,
  backup: SessionMigrationBackup
): Promise<void> => {
  if (!spreadsheetId || !backup) throw new Error("스프레드시트 ID 또는 백업 정보가 없습니다.");

  const resMetadata = await window.gapi.client.sheets.spreadsheets.get({ spreadsheetId });
  const sheets = resMetadata.result.sheets || [];

  const backupSheet = sheets.find((s: any) => s.properties.title === backup.backupSheetTitle);
  if (!backupSheet) {
    throw new Error(`스프레드시트에서 백업 시트 '${backup.backupSheetTitle}'를 찾을 수 없습니다.`);
  }

  const currentSheet = sheets.find((s: any) => s.properties.title === backup.sessionSheetName);

  // 1. 현재 세션 시트가 있다면 삭제
  if (currentSheet) {
    await window.gapi.client.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [
          {
            deleteSheet: {
              sheetId: currentSheet.properties.sheetId
            }
          }
        ]
      }
    });
  }

  // 2. 백업 시트 이름을 원래 세션 시트명으로 복원하고 보임 상태로 전환
  await window.gapi.client.sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    resource: {
      requests: [
        {
          updateSheetProperties: {
            properties: {
              sheetId: backupSheet.properties.sheetId,
              title: backup.sessionSheetName,
              hidden: false
            },
            fields: 'title,hidden'
          }
        }
      ]
    }
  });

  // 3. raw 시트의 A열 멤버 명단도 백업 당시의 멤버로 복원
  await saveSessionMembers(spreadsheetId, backup.sessionSheetName, backup.oldMembers);
};
