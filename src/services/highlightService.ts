import { getWorkerUrl, getAdminPasscode } from '@/services/scheduleService';

export interface YakumanDef {
  key: string;
  label: string;
  hanja: string;
  isDouble?: boolean;
}

/**
 * 클럽 공식 집계 대상 역만 17종
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
  { key: '오픈리치(리치 이외의 방총)', label: '오픈리치(리치 이외의 방총)', hanja: 'オープン立直' },
];

export type HighlightCategory = 'yakuman' | 'fun' | 'session';

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

const DEFAULT_KV_MAX_BYTES = 1024 * 1024 * 1024; // 1 GB (1,024 MB)
const DEFAULT_MAX_SINGLE_IMAGE_BYTES = 24 * 1024 * 1024; // 24 MB
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
      const webpFile = await convertToOriginalQualityWebP(params.imageFile);
      uploadedSize = webpFile.size;
      formData.append('image', webpFile, webpFile.name);
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
