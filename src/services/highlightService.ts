import { getWorkerUrl, getAdminPasscode } from '@/services/scheduleService';

export interface YakumanDef {
  key: string;
  label: string;
  hanja: string;
  isDouble?: boolean;
}

/**
 * 클럽 공식 집계 대상 역만 18종
 */
export const YAKUMAN_DEFINITIONS: YakumanDef[] = [
  { key: '천화', label: '천화', hanja: '天和' },
  { key: '지화', label: '지화', hanja: '地和' },
  { key: '인화', label: '인화', hanja: '人和' },
  { key: '대삼원', label: '대삼원', hanja: '大三元' },
  { key: '스안커', label: '스안커', hanja: '四暗刻' },
  { key: '자일색', label: '자일색', hanja: '字一色' },
  { key: '녹일색', label: '녹일색', hanja: '緑一色' },
  { key: '청노두', label: '청노두', hanja: '清老頭' },
  { key: '국사무쌍', label: '국사무쌍', hanja: '国士無双' },
  { key: '소사희', label: '소사희', hanja: '小四喜' },
  { key: '스깡즈', label: '스깡즈', hanja: '四槓子' },
  { key: '구련보등', label: '구련보등', hanja: '九蓮宝燈' },
  { key: '순정구련보등', label: '순정구련보등', hanja: '純正九蓮宝燈', isDouble: true },
  { key: '스안커 단기', label: '스안커 단기', hanja: '四暗刻単騎', isDouble: true },
  { key: '국사무쌍 13면 대기', label: '국사무쌍 13면 대기', hanja: '国士無双十三面', isDouble: true },
  { key: '대사희', label: '대사희', hanja: '大四喜', isDouble: true },
  { key: '헤아림 역만', label: '헤아림 역만', hanja: '数え役満' },
  { key: '오픈리치(리치 이외의 방총)', label: '오픈리치(리치 이외의 방총)', hanja: 'オープン立直' },
];

export type HighlightCategory = 'yakuman' | 'fun' | 'nanikiru' | 'session';

export interface HighlightComment {
  id: string;
  authorName: string;
  isLoggedInUser?: boolean;
  content: string;
  hasPin?: boolean;
  createdAt: number;
  updatedAt?: number;
}

export interface HighlightRecord {
  id: string;
  category: HighlightCategory;
  sessionName: string;
  gameId?: string;
  gameIndex?: number;
  roundName?: string;
  winnerName: string;
  loserName?: string;
  winType?: 'tsumo' | 'ron';
  yakumanTypes: string[];
  caption?: string;
  uploaderName?: string;
  hasImage: boolean;
  imageId?: string;
  imageSize?: number;
  comments?: HighlightComment[];
  createdAt: number;
}

export interface HighlightStorageInfo {
  usedBytes: number;
  imageBytes?: number;
  otherKvBytes?: number;
  maxBytes: number;
  remainingBytes: number;
  usedPercent: number;
  imageCount: number;
  totalKeyCount?: number;
  isExactServerKv?: boolean;
  isProbing?: boolean;
  maxSingleImageBytes: number;
}

const DEFAULT_KV_MAX_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB (Cloudflare R2 Free Tier)
const DEFAULT_MAX_SINGLE_IMAGE_BYTES = 50 * 1024 * 1024; // 50 MB
const IMAGE_SIZE_CACHE_KEY = 'mahjong_highlight_img_sizes_v1';

const SESSION_PIN_STORAGE_KEY = 'mahjong_highlight_upload_pin';
let cachedHighlights: HighlightRecord[] | null = null;
let cachedStorageInfo: HighlightStorageInfo | null = null;
const probingImageIds = new Set<string>();

function loadLocalImageSizeCache(): Record<string, number> {
  try {
    const raw = localStorage.getItem(IMAGE_SIZE_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {}
  return {};
}

function saveLocalImageSizeCache(map: Record<string, number>): void {
  try {
    localStorage.setItem(IMAGE_SIZE_CACHE_KEY, JSON.stringify(map));
  } catch {}
}

export async function probeActualHighlightImageSizes(records: HighlightRecord[]): Promise<boolean> {
  if (!Array.isArray(records) || records.length === 0) return false;
  const sizeCache = loadLocalImageSizeCache();
  let updated = false;

  const needFetch: HighlightRecord[] = [];
  for (const r of records) {
    if (!r || !r.hasImage || !r.imageId) continue;
    if (typeof r.imageSize === 'number' && r.imageSize > 0) {
      if (sizeCache[r.imageId] !== r.imageSize) {
        sizeCache[r.imageId] = r.imageSize;
        updated = true;
      }
      continue;
    }
    const cachedVal = sizeCache[r.imageId];
    if (typeof cachedVal === 'number' && cachedVal > 0) {
      r.imageSize = cachedVal;
      updated = true;
    } else if (!probingImageIds.has(r.imageId)) {
      needFetch.push(r);
    }
  }

  if (updated) {
    saveLocalImageSizeCache(sizeCache);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('mahjong_highlight_storage_updated'));
    }
  }

  if (needFetch.length === 0) return updated;

  for (const r of needFetch) {
    if (r.imageId) probingImageIds.add(r.imageId);
  }

  await Promise.all(
    needFetch.map(async (r) => {
      const imgId = r.imageId;
      if (!imgId) return;
      try {
        const imgUrl = getHighlightImageUrl(imgId);
        const res = await fetch(imgUrl, { method: 'GET', cache: 'force-cache' });
        if (res.ok) {
          const clHeader = Number(res.headers.get('content-length') || 0);
          let byteSize = clHeader > 0 ? clHeader : 0;
          if (!byteSize) {
            const blob = await res.blob();
            byteSize = blob.size;
          }
          if (byteSize > 0) {
            r.imageSize = byteSize;
            sizeCache[imgId] = byteSize;
            updated = true;
          }
        }
      } catch {
        // ignore network error
      } finally {
        probingImageIds.delete(imgId);
      }
    })
  );

  if (updated) {
    saveLocalImageSizeCache(sizeCache);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('mahjong_highlight_storage_updated'));
    }
  }
  return updated;
}

function estimateFallbackOtherKvBytes(indexBytes: number): number {
  let localCacheBytes = 0;
  try {
    const encoder = new TextEncoder();
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (
        k.startsWith('mahjong_') &&
        k !== 'mahjong_highlights_fallback_v1' &&
        k !== IMAGE_SIZE_CACHE_KEY &&
        k !== SESSION_PIN_STORAGE_KEY
      ) {
        const v = localStorage.getItem(k);
        if (v) {
          localCacheBytes += encoder.encode(k).byteLength + encoder.encode(v).byteLength;
        }
      }
    }
  } catch {
    // ignore storage access error
  }
  return Math.max(indexBytes, localCacheBytes);
}

export function getHighlightStorageInfo(records?: HighlightRecord[]): HighlightStorageInfo {
  const list = records ?? cachedHighlights ?? [];
  const sizeCache = loadLocalImageSizeCache();
  const imageRecords = list.filter((r) => r && r.hasImage && r.imageId);
  const imageCount = imageRecords.length;

  let localImageBytes = 0;
  let unprobedCount = 0;
  for (const r of imageRecords) {
    const knownSize =
      typeof r.imageSize === 'number' && r.imageSize > 0
        ? r.imageSize
        : r.imageId && typeof sizeCache[r.imageId] === 'number' && sizeCache[r.imageId] > 0
          ? sizeCache[r.imageId]
          : 0;
    if (knownSize > 0) {
      r.imageSize = knownSize;
      localImageBytes += knownSize;
    } else {
      unprobedCount++;
    }
  }

  if (unprobedCount > 0) {
    probeActualHighlightImageSizes(list).catch(() => {});
  }

  let indexBytes = 0;
  try {
    indexBytes = new TextEncoder().encode(JSON.stringify(list)).byteLength;
  } catch {
    indexBytes = list.length * 320;
  }

  if (cachedStorageInfo && cachedStorageInfo.maxBytes > 0) {
    if (cachedStorageInfo.imageCount === imageCount && cachedStorageInfo.usedBytes >= localImageBytes) {
      return {
        ...cachedStorageInfo,
        isProbing: unprobedCount > 0 && !cachedStorageInfo.isExactServerKv,
      };
    }
  }

  const maxBytes = cachedStorageInfo?.maxBytes || DEFAULT_KV_MAX_BYTES;
  const fallbackOtherBytes = estimateFallbackOtherKvBytes(indexBytes);
  const otherKvBytes = Math.max(cachedStorageInfo?.otherKvBytes || 0, fallbackOtherBytes);
  const usedBytes = localImageBytes + otherKvBytes;
  const remainingBytes = Math.max(0, maxBytes - usedBytes);
  const usedPercent = Number(((usedBytes / maxBytes) * 100).toFixed(2));

  return {
    usedBytes,
    imageBytes: localImageBytes,
    otherKvBytes,
    maxBytes,
    remainingBytes,
    usedPercent,
    imageCount,
    isExactServerKv: !!cachedStorageInfo?.isExactServerKv,
    isProbing: unprobedCount > 0,
    maxSingleImageBytes: cachedStorageInfo?.maxSingleImageBytes || DEFAULT_MAX_SINGLE_IMAGE_BYTES,
  };
}

export function getSavedHighlightPin(): string {
  try {
    const localVal = localStorage.getItem(SESSION_PIN_STORAGE_KEY);
    if (localVal && localVal.trim()) {
      return localVal.trim();
    }
    const sessionVal = sessionStorage.getItem(SESSION_PIN_STORAGE_KEY);
    if (sessionVal && sessionVal.trim()) {
      localStorage.setItem(SESSION_PIN_STORAGE_KEY, sessionVal.trim());
      return sessionVal.trim();
    }
    return '';
  } catch {
    return '';
  }
}

export function saveHighlightPin(pin: string): void {
  try {
    if (pin && pin.trim()) {
      const clean = pin.trim();
      localStorage.setItem(SESSION_PIN_STORAGE_KEY, clean);
      sessionStorage.setItem(SESSION_PIN_STORAGE_KEY, clean);
    }
  } catch {}
}

export function clearHighlightPin(): void {
  try {
    localStorage.removeItem(SESSION_PIN_STORAGE_KEY);
    sessionStorage.removeItem(SESSION_PIN_STORAGE_KEY);
  } catch {}
}

export function getHighlightImageUrl(imageId?: string): string {
  if (!imageId) return '';
  return `${getWorkerUrl()}/api/public/highlights/image/${encodeURIComponent(imageId)}`;
}

/**
 * 원본 해상도를 1px도 축소하지 않고 WebP(quality = 1.0, 열화 없음)로 변환
 * - 이미 WebP 파일인 경우 재인코딩 없이 원본 파일 그대로 반환
 */
export async function convertToOriginalQualityWebP(file: File): Promise<File> {
  if (!file || !file.type.startsWith('image/')) {
    return file;
  }
  if (file.type === 'image/webp') {
    return file;
  }

  return new Promise<File>((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      try {
        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;
        if (!width || !height) {
          resolve(file);
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(file);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(file);
              return;
            }
            const baseName = file.name.replace(/\.[^/.]+$/, '');
            const webpFile = new File([blob], `${baseName}.webp`, {
              type: 'image/webp',
              lastModified: Date.now(),
            });
            resolve(webpFile);
          },
          'image/webp',
          1.0
        );
      } catch {
        resolve(file);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };
    img.src = objectUrl;
  });
}

function getClientAuthPayload(explicitPin?: string) {
  const uploadPin = explicitPin && explicitPin.trim() ? explicitPin.trim() : getSavedHighlightPin();
  const accessToken = localStorage.getItem('google_access_token') || '';
  const refreshCipher = localStorage.getItem('google_refresh_cipher') || '';
  const adminPasscode = getAdminPasscode() || '';
  return {
    upload_pin: uploadPin,
    access_token: accessToken,
    refresh_cipher: refreshCipher,
    admin_passcode: adminPasscode,
  };
}

export async function verifyHighlightUploadPin(pin?: string): Promise<{
  valid: boolean;
  isAdmin: boolean;
  mode?: string | null;
}> {
  try {
    const payload = getClientAuthPayload(pin);
    const res = await fetch(`${getWorkerUrl()}/api/public/highlights/verify-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.valid && payload.upload_pin) {
        saveHighlightPin(payload.upload_pin);
      } else if (!data.valid && !data.isAdmin) {
        clearHighlightPin();
      }
      return {
        valid: !!data.valid,
        isAdmin: !!data.isAdmin,
        mode: data.mode || null,
      };
    }
  } catch (e) {
    console.warn('Highlight PIN verify failed:', e);
  }
  return { valid: false, isAdmin: false };
}

export async function fetchHighlightUploadPinAsAdmin(): Promise<{
  success: boolean;
  uploadPin?: string;
  error?: string;
}> {
  try {
    const payload = {
      ...getClientAuthPayload(),
      action: 'get',
    };
    const res = await fetch(`${getWorkerUrl()}/api/public/highlights/admin-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.success) {
      return { success: true, uploadPin: data.uploadPin || '' };
    }
    return { success: false, error: data?.error || '관리자 권한이 필요합니다.' };
  } catch (e: any) {
    return { success: false, error: e.message || '네트워크 오류가 발생했습니다.' };
  }
}

export async function updateHighlightUploadPinAsAdmin(newPin: string): Promise<{
  success: boolean;
  uploadPin?: string;
  message?: string;
  error?: string;
}> {
  try {
    const payload = {
      ...getClientAuthPayload(),
      action: 'set',
      new_pin: newPin.trim(),
    };
    const res = await fetch(`${getWorkerUrl()}/api/public/highlights/admin-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.success) {
      saveHighlightPin(newPin.trim());
      return {
        success: true,
        uploadPin: data.uploadPin,
        message: data.message || '공통 업로드 PIN이 변경되었습니다.',
      };
    }
    return { success: false, error: data?.error || '공통 PIN 변경에 실패했습니다.' };
  } catch (e: any) {
    return { success: false, error: e.message || '네트워크 오류가 발생했습니다.' };
  }
}

export async function fetchHighlights(forceRefresh: boolean = false): Promise<HighlightRecord[]> {
  if (!forceRefresh && cachedHighlights !== null) {
    return cachedHighlights;
  }
  try {
    const refreshQuery = forceRefresh ? '?refresh=1' : '';
    const res = await fetch(`${getWorkerUrl()}/api/public/highlights${refreshQuery}`);
    if (res.ok) {
      const data = await res.json();
      if (data?.storage && typeof data.storage.usedBytes === 'number') {
        cachedStorageInfo = data.storage;
      }
      if (Array.isArray(data.records)) {
        cachedHighlights = data.records;
        return data.records;
      }
    }
  } catch (e) {
    console.warn('Failed to fetch highlights:', e);
  }
  return cachedHighlights || [];
}

export async function createHighlight(params: {
  category: HighlightCategory;
  sessionName: string;
  gameId?: string;
  gameIndex?: number;
  roundName?: string;
  winnerName?: string;
  loserName?: string;
  winType?: 'tsumo' | 'ron';
  yakumanTypes?: string[];
  caption?: string;
  uploaderName?: string;
  imageFile?: File | null;
  uploadPin?: string;
}): Promise<{
  success: boolean;
  record?: HighlightRecord;
  records?: HighlightRecord[];
  storage?: HighlightStorageInfo;
  pinInvalidated?: boolean;
  error?: string;
}> {
  try {
    const auth = getClientAuthPayload(params.uploadPin);
    const formData = new FormData();
    const metadata = {
      category: params.category,
      sessionName: params.sessionName,
      gameId: params.gameId || '',
      gameIndex: params.gameIndex,
      roundName: params.roundName || '',
      winnerName: params.winnerName || '',
      loserName: params.loserName || '',
      winType: params.winType,
      yakumanTypes: params.yakumanTypes || [],
      caption: params.caption || '',
      uploaderName: params.uploaderName || '',
    };

    formData.append('metadata', JSON.stringify(metadata));
    formData.append('upload_pin', auth.upload_pin);
    formData.append('access_token', auth.access_token);
    formData.append('refresh_cipher', auth.refresh_cipher);
    formData.append('admin_passcode', auth.admin_passcode);

    let uploadedSize = 0;
    if (params.imageFile) {
      uploadedSize = params.imageFile.size;
      formData.append('image', params.imageFile, params.imageFile.name);
    }

    const res = await fetch(`${getWorkerUrl()}/api/public/highlights`, {
      method: 'POST',
      body: formData,
    });

    const data = await res.json().catch(() => null);
    if (res.ok && data?.success) {
      if (auth.upload_pin) {
        saveHighlightPin(auth.upload_pin);
      }
      if (data.storage && typeof data.storage.usedBytes === 'number') {
        cachedStorageInfo = data.storage;
      }
      if (Array.isArray(data.records)) {
        if (uploadedSize > 0 && data.records[0] && !data.records[0].imageSize) {
          data.records[0].imageSize = uploadedSize;
        }
        cachedHighlights = data.records;
      }
      return {
        success: true,
        record: data.record,
        records: data.records || [],
        storage: data.storage,
      };
    }
    if (res.status === 403) {
      clearHighlightPin();
      return {
        success: false,
        pinInvalidated: true,
        error: data?.error || '공통 업로드 PIN이 일치하지 않습니다.',
      };
    }
    return {
      success: false,
      error: data?.error || '역만/사진 등록에 실패했습니다.',
    };
  } catch (e: any) {
    return {
      success: false,
      error: e.message || '서버 통신 중 오류가 발생했습니다.',
    };
  }
}

export async function deleteHighlight(
  id: string,
  uploadPin?: string
): Promise<{
  success: boolean;
  records?: HighlightRecord[];
  storage?: HighlightStorageInfo;
  pinInvalidated?: boolean;
  error?: string;
}> {
  try {
    const auth = getClientAuthPayload(uploadPin);
    const res = await fetch(`${getWorkerUrl()}/api/public/highlights`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        ...auth,
      }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.success) {
      if (auth.upload_pin) {
        saveHighlightPin(auth.upload_pin);
      }
      if (data.storage && typeof data.storage.usedBytes === 'number') {
        cachedStorageInfo = data.storage;
      }
      if (Array.isArray(data.records)) {
        cachedHighlights = data.records;
      }
      return {
        success: true,
        records: data.records || [],
        storage: data.storage,
      };
    }
    if (res.status === 403) {
      clearHighlightPin();
      return {
        success: false,
        pinInvalidated: true,
        error: data?.error || '삭제 권한이 없거나 공통 PIN이 일치하지 않습니다.',
      };
    }
    return {
      success: false,
      error: data?.error || '삭제 권한이 없거나 PIN이 일치하지 않습니다.',
    };
  } catch (e: any) {
    return {
      success: false,
      error: e.message || '삭제 중 네트워크 오류가 발생했습니다.',
    };
  }
}

export async function updateHighlightMemo(
  id: string,
  caption: string,
  uploadPin?: string
): Promise<{
  success: boolean;
  record?: HighlightRecord;
  records?: HighlightRecord[];
  storage?: HighlightStorageInfo;
  pinInvalidated?: boolean;
  error?: string;
}> {
  try {
    const auth = getClientAuthPayload(uploadPin);
    const res = await fetch(`${getWorkerUrl()}/api/public/highlights`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        caption: caption.trim(),
        ...auth,
      }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.success) {
      if (auth.upload_pin) {
        saveHighlightPin(auth.upload_pin);
      }
      if (data.storage && typeof data.storage.usedBytes === 'number') {
        cachedStorageInfo = data.storage;
      }
      if (Array.isArray(data.records)) {
        cachedHighlights = data.records;
      }
      return {
        success: true,
        record: data.record,
        records: data.records || [],
        storage: data.storage,
      };
    }
    if (res.status === 403) {
      clearHighlightPin();
      return {
        success: false,
        pinInvalidated: true,
        error: data?.error || '메모 수정 권한이 없거나 공통 PIN이 일치하지 않습니다.',
      };
    }
    return {
      success: false,
      error: data?.error || '메모 수정 권한이 없거나 공통 PIN이 일치하지 않습니다.',
    };
  } catch (e: any) {
    return {
      success: false,
      error: e.message || '메모 저장 중 네트워크 오류가 발생했습니다.',
    };
  }
}

export function matchHighlightSession(recordSession: string, targetSession: string): boolean {
  if (!targetSession) return true;
  const m1 = recordSession.match(/제\s*(\d+)\s*회/);
  const m2 = targetSession.match(/제\s*(\d+)\s*회/);
  if (m1 && m2) {
    return m1[1] === m2[1];
  }
  return recordSession.replace(/\s+/g, '') === targetSession.replace(/\s+/g, '');
}

/**
 * 특정 선수의 17종 역만별 달성 횟수(기본 0) 및 달성 기록 계산
 */
export function computePlayerYakumanStats(
  records: HighlightRecord[],
  playerName: string,
  sessionFilter?: string
) {
  const cleanPlayer = (playerName || '').trim();
  const countMap: Record<string, number> = {};
  YAKUMAN_DEFINITIONS.forEach((def) => {
    countMap[def.key] = 0;
  });

  const achievedRecords: HighlightRecord[] = [];
  let totalYakumanCount = 0;

  for (const rec of records) {
    if (rec.category !== 'yakuman') continue;
    if (rec.winnerName.trim() !== cleanPlayer) continue;
    if (sessionFilter && !matchHighlightSession(rec.sessionName, sessionFilter)) continue;

    achievedRecords.push(rec);
    for (const yType of rec.yakumanTypes || []) {
      const normalized = yType === '오픈리치' ? '오픈리치(리치 이외의 방총)' : yType;
      if (countMap[normalized] !== undefined) {
        countMap[normalized]++;
        totalYakumanCount++;
      } else {
        countMap[normalized] = (countMap[normalized] || 0) + 1;
        totalYakumanCount++;
      }
    }
  }

  const items = YAKUMAN_DEFINITIONS.map((def) => ({
    ...def,
    count: countMap[def.key] || 0,
  }));

  return {
    totalYakumanCount,
    totalYakumanHands: achievedRecords.length,
    items,
    achievedRecords,
  };
}

// ==========================================
// 마작패 (34종) & 액션 버튼 (8종) 디시콘/아이콘 정의 및 파서
// ==========================================
export interface MahjongTileEmoteDef {
  code: string; // e.g. '1m', '1z'
  label: string; // e.g. '1만', '동'
  group: 'man' | 'pin' | 'sou' | 'honor';
  fileName: string; // e.g. '1m.png'
}

export interface MahjongActionEmoteDef {
  key: string; // e.g. '리치', '다마', '퐁', '치', '깡', '론', '쯔모', '스킵'
  label: string;
  colorClass: string; // CSS class for refined button badge
}

export const MAHJONG_ACTION_EMOTES: MahjongActionEmoteDef[] = [
  { key: '리치', label: '리치', colorClass: 'act-riichi' },
  { key: '다마', label: '다마', colorClass: 'act-dama' },
  { key: '퐁', label: '퐁', colorClass: 'act-pon' },
  { key: '치', label: '치', colorClass: 'act-chii' },
  { key: '깡', label: '깡', colorClass: 'act-kan' },
  { key: '론', label: '론', colorClass: 'act-ron' },
  { key: '쯔모', label: '쯔모', colorClass: 'act-tsumo' },
  { key: '스킵', label: '스킵', colorClass: 'act-skip' },
];

export const MAHJONG_TILE_EMOTES: MahjongTileEmoteDef[] = [
  // 1~9만
  { code: '1m', label: '1만', group: 'man', fileName: '1m.png' },
  { code: '2m', label: '2만', group: 'man', fileName: '2m.png' },
  { code: '3m', label: '3만', group: 'man', fileName: '3m.png' },
  { code: '4m', label: '4만', group: 'man', fileName: '4m.png' },
  { code: '5m', label: '5만', group: 'man', fileName: '5m.png' },
  { code: '6m', label: '6만', group: 'man', fileName: '6m.png' },
  { code: '7m', label: '7만', group: 'man', fileName: '7m.png' },
  { code: '8m', label: '8만', group: 'man', fileName: '8m.png' },
  { code: '9m', label: '9만', group: 'man', fileName: '9m.png' },
  // 1~9통
  { code: '1p', label: '1통', group: 'pin', fileName: '1p.png' },
  { code: '2p', label: '2통', group: 'pin', fileName: '2p.png' },
  { code: '3p', label: '3통', group: 'pin', fileName: '3p.png' },
  { code: '4p', label: '4통', group: 'pin', fileName: '4p.png' },
  { code: '5p', label: '5통', group: 'pin', fileName: '5p.png' },
  { code: '6p', label: '6통', group: 'pin', fileName: '6p.png' },
  { code: '7p', label: '7통', group: 'pin', fileName: '7p.png' },
  { code: '8p', label: '8통', group: 'pin', fileName: '8p.png' },
  { code: '9p', label: '9통', group: 'pin', fileName: '9p.png' },
  // 1~9삭
  { code: '1s', label: '1삭', group: 'sou', fileName: '1s.png' },
  { code: '2s', label: '2삭', group: 'sou', fileName: '2s.png' },
  { code: '3s', label: '3삭', group: 'sou', fileName: '3s.png' },
  { code: '4s', label: '4삭', group: 'sou', fileName: '4s.png' },
  { code: '5s', label: '5삭', group: 'sou', fileName: '5s.png' },
  { code: '6s', label: '6삭', group: 'sou', fileName: '6s.png' },
  { code: '7s', label: '7삭', group: 'sou', fileName: '7s.png' },
  { code: '8s', label: '8삭', group: 'sou', fileName: '8s.png' },
  { code: '9s', label: '9삭', group: 'sou', fileName: '9s.png' },
  // 동남서북백발중 (1z~7z)
  { code: '1z', label: '동', group: 'honor', fileName: '1z.png' },
  { code: '2z', label: '남', group: 'honor', fileName: '2z.png' },
  { code: '3z', label: '서', group: 'honor', fileName: '3z.png' },
  { code: '4z', label: '북', group: 'honor', fileName: '4z.png' },
  { code: '5z', label: '백', group: 'honor', fileName: '5z.png' },
  { code: '6z', label: '발', group: 'honor', fileName: '6z.png' },
  { code: '7z', label: '중', group: 'honor', fileName: '7z.png' },
];

const TILE_BY_TOKEN_MAP: Record<string, MahjongTileEmoteDef> = {};
MAHJONG_TILE_EMOTES.forEach((t) => {
  TILE_BY_TOKEN_MAP[t.code] = t;
  TILE_BY_TOKEN_MAP[t.label] = t;
});

const ACTION_BY_TOKEN_MAP: Record<string, MahjongActionEmoteDef> = {};
MAHJONG_ACTION_EMOTES.forEach((a) => {
  ACTION_BY_TOKEN_MAP[a.key] = a;
});

export function getMahjongTileImageUrl(fileName: string): string {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
  return `${base}/assets/tiles/${fileName}`;
}

export type CommentSegment =
  | { type: 'text'; text: string }
  | { type: 'tile'; tile: MahjongTileEmoteDef }
  | { type: 'action'; action: MahjongActionEmoteDef };

/**
 * 댓글/메모 내 `[1만]`, `[1m]`, `[동]`, `[리치]` 등의 토큰을 파싱하여
 * 텍스트/마작패/액션버튼 세그먼트로 분리합니다.
 */
export function parseRichMahjongText(raw?: string): CommentSegment[] {
  if (!raw) return [];
  const segments: CommentSegment[] = [];
  const regex = /\[([1-9][mps]|[1-7]z|[1-9][만통삭]|동|남|서|북|백|발|중|리치|다마|퐁|치|깡|론|쯔모|스킵)\]/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(raw)) !== null) {
    if (match.index > lastIdx) {
      segments.push({ type: 'text', text: raw.slice(lastIdx, match.index) });
    }
    const tokenKey = match[1];
    if (TILE_BY_TOKEN_MAP[tokenKey]) {
      segments.push({ type: 'tile', tile: TILE_BY_TOKEN_MAP[tokenKey] });
    } else if (ACTION_BY_TOKEN_MAP[tokenKey]) {
      segments.push({ type: 'action', action: ACTION_BY_TOKEN_MAP[tokenKey] });
    } else {
      segments.push({ type: 'text', text: match[0] });
    }
    lastIdx = regex.lastIndex;
  }

  if (lastIdx < raw.length) {
    segments.push({ type: 'text', text: raw.slice(lastIdx) });
  }
  return segments;
}

// ==========================================
// 사진 댓글 CRUD API + 로컬 폴백 동기화
// ==========================================
const LOCAL_COMMENTS_FALLBACK_KEY = 'mahjong_highlight_comments_fallback_v1';

interface LocalCommentStored extends HighlightComment {
  pin?: string;
}

function loadLocalCommentsFallbackMap(): Record<string, LocalCommentStored[]> {
  try {
    const raw = localStorage.getItem(LOCAL_COMMENTS_FALLBACK_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {}
  return {};
}

function saveLocalCommentsFallbackMap(map: Record<string, LocalCommentStored[]>): void {
  try {
    localStorage.setItem(LOCAL_COMMENTS_FALLBACK_KEY, JSON.stringify(map));
  } catch {}
}

export function getEffectiveHighlightComments(rec?: HighlightRecord | null): HighlightComment[] {
  if (!rec) return [];
  const serverComments = Array.isArray(rec.comments) ? rec.comments : [];
  const localMap = loadLocalCommentsFallbackMap();
  const localList = Array.isArray(localMap[rec.id]) ? localMap[rec.id] : [];
  if (localList.length === 0) return serverComments;

  const merged = [...serverComments];
  const existingIds = new Set(serverComments.map((c) => c.id));
  for (const lc of localList) {
    if (!existingIds.has(lc.id)) {
      const { pin: _p, ...safe } = lc;
      merged.push(safe);
    }
  }
  return merged.sort((a, b) => a.createdAt - b.createdAt);
}

export async function addHighlightComment(params: {
  highlightId: string;
  authorName: string;
  content: string;
  pin: string;
  isLoggedInUser?: boolean;
}): Promise<{
  success: boolean;
  record?: HighlightRecord;
  records?: HighlightRecord[];
  error?: string;
}> {
  const cleanAuthor = params.authorName.trim();
  const cleanContent = params.content.trim();
  const cleanPin = params.pin.trim();

  if (!cleanAuthor) return { success: false, error: '닉네임을 입력해 주세요.' };
  if (!cleanContent) return { success: false, error: '댓글 내용을 입력해 주세요.' };
  if (!cleanPin || cleanPin.length < 2) {
    return { success: false, error: '수정/삭제용 비밀번호(PIN)를 입력해 주세요.' };
  }

  try {
    const auth = getClientAuthPayload();
    const res = await fetch(`${getWorkerUrl()}/api/public/highlights/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        highlightId: params.highlightId,
        authorName: cleanAuthor,
        content: cleanContent,
        pin: cleanPin,
        isLoggedInUser: !!params.isLoggedInUser,
        ...auth,
      }),
    });

    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data?.success) {
        if (Array.isArray(data.records)) {
          cachedHighlights = data.records;
        }
        return {
          success: true,
          record: data.record,
          records: data.records,
        };
      }
    }

    if (res.status === 400 || res.status === 403) {
      const errData = await res.json().catch(() => null);
      return { success: false, error: errData?.error || '댓글 등록에 실패했습니다.' };
    }
  } catch (e) {
    console.warn('Server comment create failed, using local fallback:', e);
  }

  // 워커 미배포(404) 또는 오프라인 환경 폴백
  const localMap = loadLocalCommentsFallbackMap();
  const list = Array.isArray(localMap[params.highlightId]) ? localMap[params.highlightId] : [];
  const newComment: LocalCommentStored = {
    id: `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    authorName: cleanAuthor,
    isLoggedInUser: !!params.isLoggedInUser,
    content: cleanContent,
    hasPin: true,
    pin: cleanPin,
    createdAt: Date.now(),
  };
  list.push(newComment);
  localMap[params.highlightId] = list;
  saveLocalCommentsFallbackMap(localMap);

  if (cachedHighlights) {
    cachedHighlights = cachedHighlights.map((r) => {
      if (r.id !== params.highlightId) return r;
      return {
        ...r,
        comments: getEffectiveHighlightComments(r),
      };
    });
  }

  const updatedRec = cachedHighlights?.find((r) => r.id === params.highlightId);
  return {
    success: true,
    record: updatedRec,
    records: cachedHighlights || undefined,
  };
}

export async function updateHighlightComment(params: {
  highlightId: string;
  commentId: string;
  content: string;
  pin?: string;
}): Promise<{
  success: boolean;
  record?: HighlightRecord;
  records?: HighlightRecord[];
  error?: string;
}> {
  const cleanContent = params.content.trim();
  const cleanPin = (params.pin || '').trim();
  if (!cleanContent) return { success: false, error: '수정할 댓글 내용을 입력해 주세요.' };

  try {
    const auth = getClientAuthPayload();
    const res = await fetch(`${getWorkerUrl()}/api/public/highlights/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update',
        highlightId: params.highlightId,
        commentId: params.commentId,
        content: cleanContent,
        pin: cleanPin,
        ...auth,
      }),
    });

    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data?.success) {
        if (Array.isArray(data.records)) {
          cachedHighlights = data.records;
        }
        return {
          success: true,
          record: data.record,
          records: data.records,
        };
      }
    }

    if (res.status === 403 || res.status === 400) {
      const errData = await res.json().catch(() => null);
      return { success: false, error: errData?.error || '비밀번호(PIN)가 일치하지 않습니다.' };
    }
  } catch (e) {
    console.warn('Server comment update failed, checking local fallback:', e);
  }

  // 로컬 폴백 수정 처리
  const localMap = loadLocalCommentsFallbackMap();
  const list = Array.isArray(localMap[params.highlightId]) ? localMap[params.highlightId] : [];
  const cIdx = list.findIndex((c) => c.id === params.commentId);
  if (cIdx === -1) {
    return { success: false, error: '해당 댓글을 찾을 수 없거나 권한이 없습니다.' };
  }
  if (list[cIdx].pin && list[cIdx].pin !== cleanPin) {
    return { success: false, error: '비밀번호(PIN)가 일치하지 않습니다.' };
  }
  list[cIdx] = {
    ...list[cIdx],
    content: cleanContent,
    updatedAt: Date.now(),
  };
  localMap[params.highlightId] = list;
  saveLocalCommentsFallbackMap(localMap);

  if (cachedHighlights) {
    cachedHighlights = cachedHighlights.map((r) => {
      if (r.id !== params.highlightId) return r;
      return {
        ...r,
        comments: getEffectiveHighlightComments(r),
      };
    });
  }
  const updatedRec = cachedHighlights?.find((r) => r.id === params.highlightId);
  return {
    success: true,
    record: updatedRec,
    records: cachedHighlights || undefined,
  };
}

export async function deleteHighlightComment(params: {
  highlightId: string;
  commentId: string;
  pin?: string;
}): Promise<{
  success: boolean;
  record?: HighlightRecord;
  records?: HighlightRecord[];
  error?: string;
}> {
  const cleanPin = (params.pin || '').trim();

  try {
    const auth = getClientAuthPayload();
    const res = await fetch(`${getWorkerUrl()}/api/public/highlights/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'delete',
        highlightId: params.highlightId,
        commentId: params.commentId,
        pin: cleanPin,
        ...auth,
      }),
    });

    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data?.success) {
        // 로컬에도 혹시 있으면 정리
        const localMap = loadLocalCommentsFallbackMap();
        if (Array.isArray(localMap[params.highlightId])) {
          localMap[params.highlightId] = localMap[params.highlightId].filter((c) => c.id !== params.commentId);
          saveLocalCommentsFallbackMap(localMap);
        }
        if (Array.isArray(data.records)) {
          cachedHighlights = data.records;
        }
        return {
          success: true,
          record: data.record,
          records: data.records,
        };
      }
    }

    if (res.status === 403 || res.status === 400) {
      const errData = await res.json().catch(() => null);
      return { success: false, error: errData?.error || '비밀번호(PIN)가 일치하지 않습니다.' };
    }
  } catch (e) {
    console.warn('Server comment delete failed, checking local fallback:', e);
  }

  // 로컬 폴백 삭제 처리
  const localMap = loadLocalCommentsFallbackMap();
  const list = Array.isArray(localMap[params.highlightId]) ? localMap[params.highlightId] : [];
  const cIdx = list.findIndex((c) => c.id === params.commentId);
  if (cIdx === -1) {
    return { success: false, error: '해당 댓글을 찾을 수 없거나 비밀번호가 일치하지 않습니다.' };
  }
  if (list[cIdx].pin && list[cIdx].pin !== cleanPin) {
    return { success: false, error: '비밀번호(PIN)가 일치하지 않습니다.' };
  }
  localMap[params.highlightId] = list.filter((c) => c.id !== params.commentId);
  saveLocalCommentsFallbackMap(localMap);

  if (cachedHighlights) {
    cachedHighlights = cachedHighlights.map((r) => {
      if (r.id !== params.highlightId) return r;
      return {
        ...r,
        comments: getEffectiveHighlightComments(r),
      };
    });
  }
  const updatedRec = cachedHighlights?.find((r) => r.id === params.highlightId);
  return {
    success: true,
    record: updatedRec,
    records: cachedHighlights || undefined,
  };
}

