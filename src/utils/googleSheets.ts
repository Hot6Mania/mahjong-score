let tokenClient: any = null;
let accessToken: string | null = null;

/**
 * GAPI 라이브러리를 로드하고 초기화합니다.
 */
export const initGapi = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (typeof window.gapi === 'undefined') {
      reject(new Error('GAPI SDK not loaded yet.'));
      return;
    }
    window.gapi.load('client', async () => {
      try {
        await window.gapi.client.init({});
        // Google Sheets API 클라이언트를 로드합니다.
        await window.gapi.client.load('https://sheets.googleapis.com/$discovery/rest?version=v4');
        resolve();
      } catch (err) {
        reject(err);
      }
    });
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
      // GAPI 클라이언트에 Access Token 설정
      window.gapi.client.setToken({ access_token: accessToken });
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
  }
};

/**
 * 지정된 구글 스프레드시트의 '멤버목록' 시트에서 멤버들의 이름을 가져옵니다.
 * '멤버목록' 시트가 존재하지 않으면 자동으로 생성합니다.
 */
export const fetchMemberList = async (spreadsheetId: string): Promise<string[]> => {
  if (!spreadsheetId) return [];
  try {
    const range = '멤버목록!A:A';
    const response = await window.gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: range,
    });
    const values = response.result.values;
    if (values) {
      // 2차원 배열을 1차원 문자열 배열로 평탄화 (빈 값 제외)
      return values.map((row: any) => row[0]).filter((name: string) => name && name.trim() !== '');
    }
    return [];
  } catch (err: any) {
    // 400 에러: 시트가 존재하지 않는 경우 자동으로 생성 시도
    if (err.status === 400 || (err.result && err.result.error && err.result.error.message.includes('멤버목록'))) {
      try {
        console.log("'멤버목록' 시트가 없어 새로 생성합니다.");
        await window.gapi.client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: spreadsheetId,
          resource: {
            requests: [
              {
                addSheet: {
                  properties: {
                    title: '멤버목록',
                  },
                },
              },
            ],
          },
        });
        // 기본 더미 데이터 입력
        await window.gapi.client.sheets.spreadsheets.values.update({
          spreadsheetId: spreadsheetId,
          range: '멤버목록!A1:A5',
          valueInputOption: 'USER_ENTERED',
          resource: {
            values: [['김철수'], ['이영희'], ['박민수'], ['최지우'], ['정우성']],
          },
        });
        return ['김철수', '이영희', '박민수', '최지우', '정우성'];
      } catch (createErr) {
        console.error('멤버목록 시트 생성 실패:', createErr);
        throw createErr;
      }
    }
    console.error('멤버 목록 조회 실패:', err);
    throw err;
  }
};

/**
 * 최종 경기 결과를 '대국기록' 시트에 추가합니다.
 * 시트가 존재하지 않으면 자동으로 생성하고 헤더를 작성합니다.
 */
export const appendGameResult = async (spreadsheetId: string, resultData: any[]): Promise<void> => {
  if (!spreadsheetId) return;
  const range = '대국기록!A:A';

  const checkAndCreateResultSheet = async () => {
    try {
      await window.gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: spreadsheetId,
        range: '대국기록!A1:A1',
      });
    } catch (err: any) {
      // 400 에러: '대국기록' 시트가 존재하지 않으면 추가
      if (err.status === 400 || (err.result && err.result.error && err.result.error.message.includes('대국기록'))) {
        try {
          console.log("'대국기록' 시트가 없어 새로 생성하고 헤더를 작성합니다.");
          await window.gapi.client.sheets.spreadsheets.batchUpdate({
            spreadsheetId: spreadsheetId,
            resource: {
              requests: [
                {
                  addSheet: {
                    properties: {
                      title: '대국기록',
                    },
                  },
                },
              ],
            },
          });
          // 헤더 작성
          const headers = [
            '기록 일시',
            '1위 이름', '1위 점수', '1위 포인트',
            '2위 이름', '2위 점수', '2위 포인트',
            '3위 이름', '3위 점수', '3위 포인트',
            '4위 이름', '4위 점수', '4위 포인트'
          ];
          await window.gapi.client.sheets.spreadsheets.values.update({
            spreadsheetId: spreadsheetId,
            range: '대국기록!A1:L1',
            valueInputOption: 'USER_ENTERED',
            resource: {
              values: [headers],
            },
          });
        } catch (createErr) {
          console.error('대국기록 시트 생성 실패:', createErr);
        }
      }
    }
  };

  await checkAndCreateResultSheet();

  // 결과 삽입
  await window.gapi.client.sheets.spreadsheets.values.append({
    spreadsheetId: spreadsheetId,
    range: range,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    resource: {
      values: [resultData],
    },
  });
};

/**
 * '멤버목록' 시트에 새로운 멤버 이름을 즉시 추가합니다.
 */
export const addNewMemberToDb = async (spreadsheetId: string, name: string): Promise<void> => {
  if (!spreadsheetId || !name || !name.trim()) return;
  const range = '멤버목록!A:A';
  await window.gapi.client.sheets.spreadsheets.values.append({
    spreadsheetId: spreadsheetId,
    range: range,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    resource: {
      values: [[name.trim()]],
    },
  });
};

/**
 * '오늘의멤버' 시트에서 오늘 대국 멤버 명단과 각 누적 포인트를 가져옵니다.
 * 시트가 존재하지 않으면 새로 생성합니다.
 * 반환값 형식: { [이름: string]: number } (누적포인트 맵)
 */
export const fetchTodayMembers = async (spreadsheetId: string): Promise<Record<string, number>> => {
  if (!spreadsheetId) return {};
  try {
    const range = '오늘의멤버!A:B';
    const response = await window.gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: range,
    });
    const values = response.result.values;
    const pointsMap: Record<string, number> = {};
    if (values) {
      // 첫 행(헤더) 제외
      for (let i = 1; i < values.length; i++) {
        const name = values[i][0];
        const point = parseFloat(values[i][1]) || 0;
        if (name) {
          pointsMap[name] = point;
        }
      }
    }
    return pointsMap;
  } catch (err: any) {
    if (err.status === 400 || (err.result && err.result.error && err.result.error.message.includes('오늘의멤버'))) {
      try {
        console.log("'오늘의멤버' 시트가 없어 새로 생성합니다.");
        await window.gapi.client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: spreadsheetId,
          resource: {
            requests: [
              {
                addSheet: {
                  properties: {
                    title: '오늘의멤버',
                  },
                },
              },
            ],
          },
        });
        // 헤더 작성
        await window.gapi.client.sheets.spreadsheets.values.update({
          spreadsheetId: spreadsheetId,
          range: '오늘의멤버!A1:B1',
          valueInputOption: 'USER_ENTERED',
          resource: {
            values: [['이름', '누적포인트']],
          },
        });
        return {};
      } catch (createErr) {
        console.error('오늘의멤버 시트 생성 실패:', createErr);
        throw createErr;
      }
    }
    console.error('오늘의멤버 목록 조회 실패:', err);
    throw err;
  }
};

/**
 * '오늘의멤버' 시트 데이터를 덮어써서 오늘의 멤버 풀을 동기화합니다.
 * 기존 멤버의 누적 포인트는 보존하고, 신규 멤버는 0으로 추가하고, 풀에서 탈퇴한 멤버는 삭제합니다.
 */
export const saveTodayMembers = async (spreadsheetId: string, activeNames: string[]): Promise<void> => {
  if (!spreadsheetId) return;
  
  // 1. 기존 포인트 맵 불러오기
  const existingMap = await fetchTodayMembers(spreadsheetId);
  
  // 2. 새로운 멤버 리스트를 기준으로 행(Row) 조립
  const rows: any[][] = [['이름', '누적포인트']];
  activeNames.forEach(name => {
    const point = existingMap[name] !== undefined ? existingMap[name] : 0;
    rows.push([name, point]);
  });
  
  // 3. '오늘의멤버' 시트 클리어 및 업데이트
  await window.gapi.client.sheets.spreadsheets.values.clear({
    spreadsheetId: spreadsheetId,
    range: '오늘의멤버!A:B',
  });
  
  await window.gapi.client.sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId,
    range: `오늘의멤버!A1:B${rows.length}`,
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: rows,
    },
  });
};

/**
 * 게임 종료 시 참가한 플레이어들의 게임 포인트를 '오늘의멤버' 시트 누적 포인트에 가산 업데이트합니다.
 * pointsDelta: { [이름: string]: number } (이번 판 획득 포인트 맵)
 */
export const updateTodayMemberPoints = async (spreadsheetId: string, pointsDelta: Record<string, number>): Promise<void> => {
  if (!spreadsheetId) return;
  
  // 1. 기존 리스트와 누적 포인트 로드
  const existingMap = await fetchTodayMembers(spreadsheetId);
  
  // 2. 가산 계산
  const rows: any[][] = [['이름', '누적포인트']];
  const names = Object.keys(existingMap);
  
  names.forEach(name => {
    let currentPoint = existingMap[name];
    if (pointsDelta[name] !== undefined) {
      currentPoint = parseFloat((currentPoint + pointsDelta[name]).toFixed(1));
    }
    rows.push([name, currentPoint]);
  });

  // 혹시 pointsDelta에 있는 사람이 기존 시트에 없었다면 추가 (포백 조치)
  Object.keys(pointsDelta).forEach(name => {
    if (!existingMap[name]) {
      rows.push([name, pointsDelta[name]]);
    }
  });

  // 3. 업데이트
  await window.gapi.client.sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId,
    range: `오늘의멤버!A1:B${rows.length}`,
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: rows,
    },
  });
};
