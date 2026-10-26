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
  parentId?: string;
  replyToAuthor?: string;
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
  hasThumb?: boolean;
  thumbSize?: number;
  comments?: HighlightComment[];
  createdAt: number;
}

export type MemberAliasesMap = Record<string, string[]>;

const MEMBER_ALIASES_STORAGE_KEY = 'mahjong_member_aliases_v1';
const DEFAULT_MEMBER_ALIASES: MemberAliasesMap = {
  따마모: ['따마모크로스'],
};

let cachedMemberAliases: MemberAliasesMap | null = null;

function sanitizeMemberAliasesMap(raw: unknown): MemberAliasesMap {
  const result: MemberAliasesMap = {};
  if (!raw || typeof raw !== 'object') return result;
  for (const [k, arr] of Object.entries(raw as Record<string, unknown>)) {
    const canonical = String(k || '').trim();
    if (!canonical || !Array.isArray(arr)) continue;
    const cleanList: string[] = [];
    for (const item of arr) {
      const alias = String(item || '').trim();
      if (alias && alias !== canonical && !cleanList.includes(alias)) {
        cleanList.push(alias);
      }
    }
    if (cleanList.length > 0) {
      result[canonical] = cleanList;
    }
  }
  return result;
}

function loadLocalMemberAliases(): MemberAliasesMap {
  if (cachedMemberAliases) return cachedMemberAliases;
  try {
    const raw = localStorage.getItem(MEMBER_ALIASES_STORAGE_KEY);
    if (raw) {
      const parsed = sanitizeMemberAliasesMap(JSON.parse(raw));
      if (Object.keys(parsed).length > 0) {
        cachedMemberAliases = parsed;
        return parsed;
      }
    }
  } catch {}
  cachedMemberAliases = { ...DEFAULT_MEMBER_ALIASES };
  return cachedMemberAliases;
}

function saveLocalMemberAliases(map: MemberAliasesMap): MemberAliasesMap {
  const sanitized = sanitizeMemberAliasesMap(map);
  cachedMemberAliases = sanitized;
  try {
    localStorage.setItem(MEMBER_ALIASES_STORAGE_KEY, JSON.stringify(sanitized));
  } catch {}
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('mahjong_member_aliases_updated'));
  }
  return sanitized;
}

export function getMemberAliases(): MemberAliasesMap {
  return loadLocalMemberAliases();
}

export function resolveMemberCanonicalName(rawName?: string, customMap?: MemberAliasesMap): string {
  const clean = (rawName || '').trim();
  if (!clean) return '';
  const cleanNorm = clean.replace(/★/g, '').trim();
  const map = customMap || loadLocalMemberAliases();
  for (const [canonical, aliases] of Object.entries(map)) {
    const canonNorm = canonical.replace(/★/g, '').trim();
    if (clean === canonical || cleanNorm === canonNorm) {
      return canonical;
    }
    if (Array.isArray(aliases)) {
      for (const al of aliases) {
        const alTrim = (al || '').trim();
        const alNorm = alTrim.replace(/★/g, '').trim();
        if (clean === alTrim || (alNorm && cleanNorm === alNorm)) {
          return canonical;
        }
      }
    }
  }
  return clean;
}

export function isSameOrAliasedMember(nameA?: string, nameB?: string, customMap?: MemberAliasesMap): boolean {
  const a = (nameA || '').replace(/★/g, '').trim();
  const b = (nameB || '').replace(/★/g, '').trim();
  if (!a || !b) return false;
  if (a === b) return true;
  const canonA = resolveMemberCanonicalName(a, customMap).replace(/★/g, '').trim();
  const canonB = resolveMemberCanonicalName(b, customMap).replace(/★/g, '').trim();
  return Boolean(canonA && canonA === canonB);
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
const backfillingThumbIds = new Set<string>();

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

  // 초기 화면 및 라이트박스 이미지 로딩을 전혀 방해하지 않도록 지연 후 순차 HEAD 조회만 수행
  await new Promise((resolve) => setTimeout(resolve, 2500));

  for (const r of needFetch) {
    const imgId = r.imageId;
    if (!imgId) continue;
    try {
      const imgUrl = getHighlightImageUrl(imgId);
      const res = await fetch(imgUrl, { method: 'HEAD', cache: 'force-cache' });
      if (res.ok) {
        const clHeader = Number(res.headers.get('content-length') || 0);
        if (clHeader > 0) {
          r.imageSize = clHeader;
          sizeCache[imgId] = clHeader;
          updated = true;
        }
      }
    } catch {
      // ignore network error
    } finally {
      probingImageIds.delete(imgId);
    }
  }

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

  if (cachedStorageInfo && cachedStorageInfo.maxBytes > 0) {
    if (cachedStorageInfo.imageCount === imageCount && cachedStorageInfo.usedBytes >= localImageBytes) {
      return {
        ...cachedStorageInfo,
        isProbing: false,
      };
    }
  }

  if (unprobedCount > 0 && (!cachedStorageInfo || !cachedStorageInfo.usedBytes)) {
    probeActualHighlightImageSizes(list).catch(() => {});
  }

  let indexBytes = 0;
  try {
    indexBytes = new TextEncoder().encode(JSON.stringify(list)).byteLength;
  } catch {
    indexBytes = list.length * 320;
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
 * 갤러리 그리드·미니 썸네일·라이트박스 프리뷰용 경량 WebP 썸네일 URL (?thumb=1)
 */
export function getHighlightThumbnailUrl(imageId?: string): string {
  if (!imageId) return '';
  return `${getWorkerUrl()}/api/public/highlights/image/${encodeURIComponent(imageId)}?thumb=1`;
}

/**
 * 이미지 리사이즈 & WebP 변환 공통 헬퍼
 */
async function resizeAndEncodeWebP(
  file: File,
  maxDimension: number,
  quality: number,
  suffix = ''
): Promise<File | null> {
  if (!file || !file.type.startsWith('image/')) return null;

  return new Promise<File | null>((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      try {
        const origW = img.naturalWidth || img.width;
        const origH = img.naturalHeight || img.height;
        if (!origW || !origH) {
          resolve(null);
          return;
        }
        let targetW = origW;
        let targetH = origH;
        const maxSide = Math.max(origW, origH);
        if (maxDimension > 0 && maxSide > maxDimension) {
          const ratio = maxDimension / maxSide;
          targetW = Math.max(1, Math.round(origW * ratio));
          targetH = Math.max(1, Math.round(origH * ratio));
        }

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, targetW, targetH);
        canvas.toBlob(
          (blob) => {
            if (!blob || blob.size <= 0) {
              resolve(null);
              return;
            }
            const baseName = file.name.replace(/\.[^/.]+$/, '');
            const webpFile = new File([blob], `${baseName}${suffix}.webp`, {
              type: 'image/webp',
              lastModified: Date.now(),
            });
            resolve(webpFile);
          },
          'image/webp',
          quality
        );
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };
    img.src = objectUrl;
  });
}

/**
 * 고화질 본본 이미지 스마트 최적화 (최대 변 2560px, WebP quality 0.88)
 * - 스마트폰 4000x3000 카메라 원본이나 16MB+ 대용량 파일이 수십 MB로 팽창하는 현상 방지
 * - 이미 작은 파일인데 변환본이 더 커진 경우 원본 유지
 */
export async function convertToOriginalQualityWebP(file: File): Promise<File> {
  if (!file || !file.type.startsWith('image/')) {
    return file;
  }
  const optimized = await resizeAndEncodeWebP(file, 2560, 0.88);
  if (!optimized) {
    return file;
  }
  // 원본이 이미 1.2MB 이하이고 변환본이 원본보다 크다면 원본 유지
  if (file.size <= 1.2 * 1024 * 1024 && optimized.size >= file.size) {
    return file;
  }
  return optimized;
}

/**
 * 갤러리 카드 및 라이트박스 즉시 표시용 경량 WebP 썸네일 생성 (최대 변 800px, quality 0.80, ~40-80KB)
 */
export async function generateHighlightThumbnailWebP(file: File): Promise<File | null> {
  return resizeAndEncodeWebP(file, 800, 0.80, '_thumb');
}

/**
 * 기존 업로드된 사진 중 서버에 썸네일(hasThumb)이 없는 레코드에 대해
 * 브라우저 유휴 시간에 800px WebP 썸네일을 생성하여 서버 R2에 1회 자동 백필
 */
export async function backfillMissingHighlightThumbnails(records: HighlightRecord[]): Promise<void> {
  if (typeof window === 'undefined' || !Array.isArray(records)) return;
  const targets = records.filter(
    (r) => r && r.hasImage && r.imageId && !r.hasThumb && !backfillingThumbIds.has(r.imageId)
  );
  if (targets.length === 0) return;

  for (const r of targets) {
    if (r.imageId) backfillingThumbIds.add(r.imageId);
  }

  // 초기 화면 렌더링에 영향을 주지 않도록 잠시 대기 후 순차 처리
  await new Promise((resolve) => setTimeout(resolve, 1800));

  for (const rec of targets) {
    const imageId = rec.imageId;
    if (!imageId) continue;
    try {
      const imgUrl = getHighlightImageUrl(imageId);
      const thumbBlob = await new Promise<Blob | null>((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            const origW = img.naturalWidth || img.width;
            const origH = img.naturalHeight || img.height;
            if (!origW || !origH) {
              resolve(null);
              return;
            }
            const maxDim = 800;
            const maxSide = Math.max(origW, origH);
            const ratio = maxSide > maxDim ? maxDim / maxSide : 1;
            const targetW = Math.max(1, Math.round(origW * ratio));
            const targetH = Math.max(1, Math.round(origH * ratio));
            const canvas = document.createElement('canvas');
            canvas.width = targetW;
            canvas.height = targetH;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              resolve(null);
              return;
            }
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, targetW, targetH);
            canvas.toBlob((b) => resolve(b), 'image/webp', 0.80);
          } catch {
            resolve(null);
          }
        };
        img.onerror = () => resolve(null);
        img.src = imgUrl;
      });

      if (thumbBlob && thumbBlob.size > 0) {
        const formData = new FormData();
        formData.append('imageId', imageId);
        formData.append(
          'thumbnail',
          new File([thumbBlob], `${imageId}_thumb.webp`, { type: 'image/webp' })
        );
        const res = await fetch(`${getWorkerUrl()}/api/public/highlights/backfill-thumb`, {
          method: 'POST',
          body: formData,
        });
        if (res.ok) {
          rec.hasThumb = true;
          rec.thumbSize = thumbBlob.size;
        }
      }
    } catch {
      // ignore background backfill error
    } finally {
      backfillingThumbIds.delete(imageId);
    }
  }
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

export async function fetchMemberAliasesFromServer(): Promise<{
  success: boolean;
  memberAliases: MemberAliasesMap;
  error?: string;
}> {
  try {
    const res = await fetch(`${getWorkerUrl()}/api/public/highlights/member-aliases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get' }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.success && data.memberAliases) {
      const saved = saveLocalMemberAliases(data.memberAliases);
      return { success: true, memberAliases: saved };
    }
    return { success: false, memberAliases: loadLocalMemberAliases(), error: data?.error };
  } catch (e: any) {
    return {
      success: false,
      memberAliases: loadLocalMemberAliases(),
      error: e.message || '네트워크 오류가 발생했습니다.',
    };
  }
}

export async function addMemberAliasAsAdmin(
  canonicalName: string,
  alias: string
): Promise<{
  success: boolean;
  memberAliases?: MemberAliasesMap;
  message?: string;
  error?: string;
}> {
  try {
    const payload = {
      ...getClientAuthPayload(),
      action: 'add',
      canonicalName: canonicalName.trim(),
      alias: alias.trim(),
    };
    const res = await fetch(`${getWorkerUrl()}/api/public/highlights/member-aliases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.success && data.memberAliases) {
      const saved = saveLocalMemberAliases(data.memberAliases);
      return {
        success: true,
        memberAliases: saved,
        message: data.message || `'${alias.trim()}' 동의어가 등록되었습니다.`,
      };
    }
    return { success: false, error: data?.error || '동의어 등록에 실패했습니다.' };
  } catch (e: any) {
    return { success: false, error: e.message || '네트워크 오류가 발생했습니다.' };
  }
}

export async function removeMemberAliasAsAdmin(
  canonicalName: string,
  alias: string
): Promise<{
  success: boolean;
  memberAliases?: MemberAliasesMap;
  message?: string;
  error?: string;
}> {
  try {
    const payload = {
      ...getClientAuthPayload(),
      action: 'remove',
      canonicalName: canonicalName.trim(),
      alias: alias.trim(),
    };
    const res = await fetch(`${getWorkerUrl()}/api/public/highlights/member-aliases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.success && data.memberAliases) {
      const saved = saveLocalMemberAliases(data.memberAliases);
      return {
        success: true,
        memberAliases: saved,
        message: data.message || `'${alias.trim()}' 동의어가 삭제되었습니다.`,
      };
    }
    return { success: false, error: data?.error || '동의어 삭제에 실패했습니다.' };
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
    const res = await fetch(`${getWorkerUrl()}/api/public/highlights${refreshQuery}`, {
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.storage && typeof data.storage.usedBytes === 'number') {
        cachedStorageInfo = data.storage;
      }
      if (data?.memberAliases && typeof data.memberAliases === 'object') {
        saveLocalMemberAliases(data.memberAliases);
      }
      if (Array.isArray(data.records)) {
        cachedHighlights = data.records;
        backfillMissingHighlightThumbnails(data.records).catch(() => {});
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
      const [optimizedMain, thumbFile] = await Promise.all([
        convertToOriginalQualityWebP(params.imageFile),
        generateHighlightThumbnailWebP(params.imageFile),
      ]);
      uploadedSize = optimizedMain.size;
      formData.append('image', optimizedMain, optimizedMain.name);
      if (thumbFile) {
        formData.append('thumbnail', thumbFile, thumbFile.name);
      }
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
      return {
        success: false,
        pinInvalidated: false,
        error: data?.error || '기록 및 사진 삭제는 관리자만 가능합니다.',
      };
    }
    return {
      success: false,
      error: data?.error || '기록 및 사진 삭제는 관리자만 가능합니다.',
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

export async function updateHighlightRecord(params: {
  id: string;
  category: HighlightCategory;
  sessionName: string;
  gameId?: string;
  gameIndex?: number;
  roundName?: string;
  winnerName?: string;
  loserName?: string;
  winType?: 'tsumo' | 'ron' | null;
  yakumanTypes?: string[];
  caption?: string;
  imageFile?: File | null;
  removeImage?: boolean;
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
      id: params.id,
      category: params.category,
      sessionName: params.sessionName,
      gameId: params.gameId || '',
      gameIndex: params.gameIndex,
      roundName: params.roundName || '',
      winnerName: params.winnerName || '',
      loserName: params.loserName || '',
      winType: params.winType || null,
      yakumanTypes: params.yakumanTypes || [],
      caption: params.caption || '',
      removeImage: Boolean(params.removeImage),
    };

    formData.append('metadata', JSON.stringify(metadata));
    formData.append('upload_pin', auth.upload_pin);
    formData.append('access_token', auth.access_token);
    formData.append('refresh_cipher', auth.refresh_cipher);
    formData.append('admin_passcode', auth.admin_passcode);

    if (params.imageFile) {
      const [optimizedMain, thumbFile] = await Promise.all([
        convertToOriginalQualityWebP(params.imageFile),
        generateHighlightThumbnailWebP(params.imageFile),
      ]);
      formData.append('image', optimizedMain, optimizedMain.name);
      if (thumbFile) {
        formData.append('thumbnail', thumbFile, thumbFile.name);
      }
    }

    const res = await fetch(`${getWorkerUrl()}/api/public/highlights`, {
      method: 'PUT',
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
      if (!data?.permissionDenied) {
        clearHighlightPin();
      }
      return {
        success: false,
        pinInvalidated: !data?.permissionDenied,
        error: data?.error || '수정 권한이 없거나 공통 PIN이 일치하지 않습니다.',
      };
    }
    return {
      success: false,
      error: data?.error || '기록 수정에 실패했습니다.',
    };
  } catch (e: any) {
    return {
      success: false,
      error: e.message || '서버 통신 중 오류가 발생했습니다.',
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
    if (!isSameOrAliasedMember(rec.winnerName, cleanPlayer)) continue;
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

export const NANIKIRU_TAG_DEFINITIONS: string[] = [
  '리치 판단',
  '공수 판단',
  '안전패 선택',
  '패효율',
  '후로 판단',
  '서반',
  '오라스',
  '조건전',
  '유국 텐파이',
];

export const MAHJONG_ACTION_EMOTES: MahjongActionEmoteDef[] = [
  { key: '리치', label: '리치', colorClass: 'act-riichi' },
  { key: '다마', label: '다마', colorClass: 'act-dama' },
  { key: '치', label: '치', colorClass: 'act-chii' },
  { key: '퐁', label: '퐁', colorClass: 'act-pon' },
  { key: '깡', label: '깡', colorClass: 'act-kan' },
  { key: '론', label: '론', colorClass: 'act-ron' },
  { key: '쯔모', label: '쯔모', colorClass: 'act-tsumo' },
  { key: '스킵', label: '스킵', colorClass: 'act-skip' },
];

export const MAHJONG_TILE_EMOTES: MahjongTileEmoteDef[] = [
  // 1~9만 (적5만 포함)
  { code: '1m', label: '1만', group: 'man', fileName: '1m.png' },
  { code: '2m', label: '2만', group: 'man', fileName: '2m.png' },
  { code: '3m', label: '3만', group: 'man', fileName: '3m.png' },
  { code: '4m', label: '4만', group: 'man', fileName: '4m.png' },
  { code: '5m', label: '5만', group: 'man', fileName: '5m.png' },
  { code: '0m', label: '적5만', group: 'man', fileName: '0m.png' },
  { code: '6m', label: '6만', group: 'man', fileName: '6m.png' },
  { code: '7m', label: '7만', group: 'man', fileName: '7m.png' },
  { code: '8m', label: '8만', group: 'man', fileName: '8m.png' },
  { code: '9m', label: '9만', group: 'man', fileName: '9m.png' },
  // 1~9통 (적5통 포함)
  { code: '1p', label: '1통', group: 'pin', fileName: '1p.png' },
  { code: '2p', label: '2통', group: 'pin', fileName: '2p.png' },
  { code: '3p', label: '3통', group: 'pin', fileName: '3p.png' },
  { code: '4p', label: '4통', group: 'pin', fileName: '4p.png' },
  { code: '5p', label: '5통', group: 'pin', fileName: '5p.png' },
  { code: '0p', label: '적5통', group: 'pin', fileName: '0p.png' },
  { code: '6p', label: '6통', group: 'pin', fileName: '6p.png' },
  { code: '7p', label: '7통', group: 'pin', fileName: '7p.png' },
  { code: '8p', label: '8통', group: 'pin', fileName: '8p.png' },
  { code: '9p', label: '9통', group: 'pin', fileName: '9p.png' },
  // 1~9삭 (적5삭 포함)
  { code: '1s', label: '1삭', group: 'sou', fileName: '1s.png' },
  { code: '2s', label: '2삭', group: 'sou', fileName: '2s.png' },
  { code: '3s', label: '3삭', group: 'sou', fileName: '3s.png' },
  { code: '4s', label: '4삭', group: 'sou', fileName: '4s.png' },
  { code: '5s', label: '5삭', group: 'sou', fileName: '5s.png' },
  { code: '0s', label: '적5삭', group: 'sou', fileName: '0s.png' },
  { code: '6s', label: '6삭', group: 'sou', fileName: '6s.png' },
  { code: '7s', label: '7삭', group: 'sou', fileName: '7s.png' },
  { code: '8s', label: '8삭', group: 'sou', fileName: '8s.png' },
  { code: '9s', label: '9삭', group: 'sou', fileName: '9s.png' },
  // 동남서북백발중 (1z~7z) + 뒷면 (0z)
  { code: '1z', label: '동', group: 'honor', fileName: '1z.png' },
  { code: '2z', label: '남', group: 'honor', fileName: '2z.png' },
  { code: '3z', label: '서', group: 'honor', fileName: '3z.png' },
  { code: '4z', label: '북', group: 'honor', fileName: '4z.png' },
  { code: '5z', label: '백', group: 'honor', fileName: '5z.png' },
  { code: '6z', label: '발', group: 'honor', fileName: '6z.png' },
  { code: '7z', label: '중', group: 'honor', fileName: '7z.png' },
  { code: '0z', label: '뒷면', group: 'honor', fileName: '0z.png' },
];

const TILE_BY_TOKEN_MAP: Record<string, MahjongTileEmoteDef> = {};
MAHJONG_TILE_EMOTES.forEach((t) => {
  TILE_BY_TOKEN_MAP[t.code] = t;
  TILE_BY_TOKEN_MAP[t.label] = t;
});
if (TILE_BY_TOKEN_MAP['0m']) TILE_BY_TOKEN_MAP['0만'] = TILE_BY_TOKEN_MAP['0m'];
if (TILE_BY_TOKEN_MAP['0p']) TILE_BY_TOKEN_MAP['0통'] = TILE_BY_TOKEN_MAP['0p'];
if (TILE_BY_TOKEN_MAP['0s']) TILE_BY_TOKEN_MAP['0삭'] = TILE_BY_TOKEN_MAP['0s'];
if (TILE_BY_TOKEN_MAP['0z']) {
  TILE_BY_TOKEN_MAP['back'] = TILE_BY_TOKEN_MAP['0z'];
}

const ACTION_BY_TOKEN_MAP: Record<string, MahjongActionEmoteDef> = {};
MAHJONG_ACTION_EMOTES.forEach((a) => {
  ACTION_BY_TOKEN_MAP[a.key] = a;
});

export function getMahjongTileImageUrl(codeOrFileName: string): string {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
  const cleanName = (codeOrFileName || '').trim();
  const file = cleanName.endsWith('.png') ? cleanName : `${cleanName}.png`;
  return `${base}/assets/tiles/${file}`;
}

let tileImagesPreloaded = false;
const preloadedTileImageElements: HTMLImageElement[] = [];

export function preloadMahjongTileImages(): void {
  if (tileImagesPreloaded || typeof window === 'undefined' || typeof Image === 'undefined') return;
  tileImagesPreloaded = true;
  for (const tile of MAHJONG_TILE_EMOTES) {
    const img = new Image();
    img.decoding = 'async';
    img.src = getMahjongTileImageUrl(tile.fileName);
    if (typeof img.decode === 'function') {
      img.decode().catch(() => {});
    }
    preloadedTileImageElements.push(img);
  }
}

export type MahjongTileMode = 'upright' | 'side' | 'kakan';

export interface MahjongTileRenderItem {
  tile: MahjongTileEmoteDef;
  mode: MahjongTileMode;
}

export interface MahjongMeldBlock {
  isDraw: boolean;
  items: MahjongTileRenderItem[];
}

export type CommentSegment =
  | { type: 'text'; text: string }
  | { type: 'tile'; tile: MahjongTileEmoteDef }
  | { type: 'meld-group'; blocks: MahjongMeldBlock[]; rawNotation: string }
  | { type: 'action'; action: MahjongActionEmoteDef };

const KOREAN_HONOR_TO_DIGIT: Record<string, string> = {
  동: '1',
  남: '2',
  서: '3',
  북: '4',
  백: '5',
  발: '6',
  중: '7',
};

/**
 * 한글 마작패 표기(`234만5만`, `-동동동`, `적5통`, `뒷면` 등)를
 * 표준 영문 m/p/s/z 표기로 정규화합니다.
 */
export function normalizeMahjongBracketNotation(raw: string): string {
  let str = String(raw || '').trim();
  if (!str) return '';
  str = str
    .replace(/적5만/g, '0m')
    .replace(/적5통/g, '0p')
    .replace(/적5삭/g, '0s')
    .replace(/뒷면/g, '0z')
    .replace(/back/gi, '0z');

  // 한글 자패 그룹 (예: 동, 동동동, -동동동, 동-동동, #중중중중, 동남서북) -> 1z, -111z 등
  str = str.replace(/#?(?:[-=]?[동남서북백발중]'?)+/g, (match) => {
    let converted = '';
    for (const ch of match) {
      if (KOREAN_HONOR_TO_DIGIT[ch]) {
        converted += KOREAN_HONOR_TO_DIGIT[ch];
      } else {
        converted += ch;
      }
    }
    return `${converted}z`;
  });

  // 한글 수패 단위 변환 (만 -> m, 통 -> p, 삭 -> s)
  str = str
    .replace(/만/g, 'm')
    .replace(/통/g, 'p')
    .replace(/삭/g, 's');

  return str;
}

/**
 * `[234m5m7m9m]`, `[123m -456p 7=77s #1111z]`, `[234만5만]` 등의 마작패/후로 표기를
 * 블록 단위로 파싱합니다. 유효하지 않은 토큰이 섞여 있으면 빈 배열을 반환합니다.
 */
export function parseMahjongMeldBlocks(notation = ''): MahjongMeldBlock[] {
  const normalized = normalizeMahjongBracketNotation(notation);
  if (!normalized) return [];

  const tokens = normalized
    .replace(/\+/g, ' +')
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (tokens.length === 0) return [];

  const validTokenRegex = /^(?:(?:#?)(?:(?:[-=]?[0-9xbXB]'?)+)(?:[mpszMPSZ]))+$/;
  const groupRegex = /(#?)((?:[-=]?[0-9xbXB]'?)+)([mpszMPSZ])/g;

  const parseSingleBlock = (token: string): MahjongMeldBlock | null => {
    const isDraw = token.startsWith('+');
    const cleanToken = isDraw ? token.slice(1) : token;
    if (!cleanToken || !validTokenRegex.test(cleanToken)) return null;

    const items: MahjongTileRenderItem[] = [];
    groupRegex.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = groupRegex.exec(cleanToken)) !== null) {
      const isAnkanHash = match[1] === '#';
      const body = match[2];
      const suit = match[3].toLowerCase();

      if (isAnkanHash) {
        const digitMatch = body.match(/[0-9]/);
        if (!digitMatch) return null;
        const d = digitMatch[0];
        if (suit === 'z' && (d === '8' || d === '9')) return null;
        const faceTile = TILE_BY_TOKEN_MAP[`${d}${suit}`];
        const backTile = TILE_BY_TOKEN_MAP['0z'];
        if (!faceTile || !backTile) return null;
        items.push(
          { tile: backTile, mode: 'upright' },
          { tile: faceTile, mode: 'upright' },
          { tile: faceTile, mode: 'upright' },
          { tile: backTile, mode: 'upright' }
        );
        continue;
      }

      const groupItems: MahjongTileRenderItem[] = [];
      const itemRegex = /([-=]?)([0-9xbXB])('?)/g;
      let im: RegExpExecArray | null;
      while ((im = itemRegex.exec(body)) !== null) {
        const prefix = im[1];
        const ch = im[2].toLowerCase();
        const suffix = im[3];

        if (ch === 'x' || ch === 'b' || (suit === 'z' && ch === '0')) {
          const backTile = TILE_BY_TOKEN_MAP['0z'];
          if (backTile) groupItems.push({ tile: backTile, mode: 'upright' });
          continue;
        }
        if (suit === 'z' && (ch === '8' || ch === '9')) {
          return null;
        }

        const tileDef = TILE_BY_TOKEN_MAP[`${ch}${suit}`];
        if (!tileDef) return null;

        let mode: MahjongTileMode = 'upright';
        if (prefix === '=') {
          mode = 'kakan';
        } else if (prefix === '-' || suffix === "'") {
          mode = 'side';
        }
        groupItems.push({ tile: tileDef, mode });
      }

      const kakanCount = groupItems.filter((x) => x.mode === 'kakan').length;
      if (kakanCount === 1 && groupItems.length === 4) {
        const kakanItem = groupItems.find((x) => x.mode === 'kakan');
        if (kakanItem && groupItems.every((x) => x.tile.code === kakanItem.tile.code)) {
          const uprightIdx = groupItems.findIndex((x) => x.mode === 'upright');
          if (uprightIdx >= 0) groupItems.splice(uprightIdx, 1);
        }
      }

      items.push(...groupItems);
    }

    return items.length > 0 ? { isDraw, items } : null;
  };

  const blocks: MahjongMeldBlock[] = [];
  for (const tk of tokens) {
    const parsed = parseSingleBlock(tk);
    if (!parsed) return [];
    blocks.push(parsed);
  }
  return blocks;
}

/**
 * 기준 패(예: "5m", "0p", "7z")와 액션("pon" | "chi" | "kan") 및 드래그 방향("left" | "up" | "down" | "right" | "center")으로
 * 후로(치/퐁/가깡/안깡) 표기 문자열을 생성합니다.
 */
export function buildDraggedMeldNotation(
  tile = '5m',
  action: 'pon' | 'chi' | 'kan' = 'pon',
  dir: 'left' | 'up' | 'down' | 'right' | 'center' = 'left'
): string {
  if (!tile || tile === '0z' || tile === 'back' || !dir || dir === 'center') return '';
  const dRaw = tile[0];
  const suit = (tile[1] || 'm').toLowerCase();
  const n = dRaw === '0' ? 5 : Number(dRaw) || 5;
  const fmt = (val: number) => (val === 5 && dRaw === '0' ? '0' : String(val));
  const normalDigit = dRaw === '0' ? '5' : dRaw;

  if (action === 'pon' || (action === 'chi' && suit === 'z')) {
    if (dRaw === '0') {
      if (dir === 'left') return `-055${suit}`;
      if (dir === 'right') return `55-0${suit}`;
      return `5-05${suit}`;
    }
    if (dir === 'left') return `-${dRaw}${dRaw}${dRaw}${suit}`;
    if (dir === 'right') return `${dRaw}${dRaw}-${dRaw}${suit}`;
    return `${dRaw}-${dRaw}${dRaw}${suit}`;
  }

  if (action === 'chi') {
    if (dir === 'left') {
      const start = Math.min(7, Math.max(1, n));
      return `-${fmt(start)}${fmt(start + 1)}${fmt(start + 2)}${suit}`;
    }
    if (dir === 'right') {
      const end = Math.max(3, Math.min(9, n));
      return `${fmt(end - 2)}${fmt(end - 1)}-${fmt(end)}${suit}`;
    }
    const mid = Math.min(8, Math.max(2, n));
    return `${fmt(mid - 1)}-${fmt(mid)}${fmt(mid + 1)}${suit}`;
  }

  if (action === 'kan') {
    if (dir === 'down') {
      return dRaw === '0'
        ? `#0555${suit}`
        : `#${normalDigit}${normalDigit}${normalDigit}${normalDigit}${suit}`;
    }
    if (dRaw === '0') {
      if (dir === 'left') return `=055${suit}`;
      if (dir === 'right') return `55=0${suit}`;
      return `5=05${suit}`;
    }
    if (dir === 'left') return `=${dRaw}${dRaw}${dRaw}${suit}`;
    if (dir === 'right') return `${dRaw}${dRaw}=${dRaw}${suit}`;
    return `${dRaw}=${dRaw}${dRaw}${suit}`;
  }

  return `${dRaw}${suit}`;
}

/**
 * 댓글/메모 내 `[234m5m7m9m]`, `[-234m]`, `[5-55p]`, `[#8888m]`, `[1만]`, `[동]`, `[리치]` 등의 토큰을 파싱하여
 * 텍스트/마작패 블록(meld-group)/액션버튼 세그먼트로 분리합니다.
 */
export function parseRichMahjongText(raw?: string): CommentSegment[] {
  if (!raw) return [];
  const segments: CommentSegment[] = [];
  const regex = /\[([^\[\]\n]+)\]/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  const pushText = (txt: string) => {
    if (!txt) return;
    const prev = segments[segments.length - 1];
    if (prev && prev.type === 'text') {
      prev.text += txt;
    } else {
      segments.push({ type: 'text', text: txt });
    }
  };

  while ((match = regex.exec(raw)) !== null) {
    if (match.index > lastIdx) {
      pushText(raw.slice(lastIdx, match.index));
    }
    const inner = match[1].trim();
    if (ACTION_BY_TOKEN_MAP[inner]) {
      segments.push({ type: 'action', action: ACTION_BY_TOKEN_MAP[inner] });
    } else {
      const blocks = parseMahjongMeldBlocks(inner);
      if (blocks.length > 0) {
        const prev = segments[segments.length - 1];
        // 연속된 대괄호(예: [2m][3m][4m] 또는 [2만][3만][4만])가 공백 없이 붙어 있으면 직전 블록에 이어 붙여 렌더링
        if (prev && prev.type === 'meld-group' && prev.blocks.length > 0) {
          const firstNewBlock = blocks[0];
          const prevLastBlock = prev.blocks[prev.blocks.length - 1];
          if (!firstNewBlock.isDraw) {
            prevLastBlock.items.push(...firstNewBlock.items);
            if (blocks.length > 1) {
              prev.blocks.push(...blocks.slice(1));
            }
          } else {
            prev.blocks.push(...blocks);
          }
          prev.rawNotation = `${prev.rawNotation} ${inner}`;
        } else {
          segments.push({
            type: 'meld-group',
            blocks,
            rawNotation: inner,
          });
        }
      } else if (TILE_BY_TOKEN_MAP[inner]) {
        segments.push({
          type: 'meld-group',
          blocks: [{ isDraw: false, items: [{ tile: TILE_BY_TOKEN_MAP[inner], mode: 'upright' }] }],
          rawNotation: inner,
        });
      } else {
        pushText(match[0]);
      }
    }
    lastIdx = regex.lastIndex;
  }

  if (lastIdx < raw.length) {
    pushText(raw.slice(lastIdx));
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
  parentId?: string;
  replyToAuthor?: string;
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
  const cleanParentId = params.parentId ? params.parentId.trim() : undefined;
  const cleanReplyToAuthor = params.replyToAuthor ? params.replyToAuthor.trim() : undefined;

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
        ...(cleanParentId ? { parentId: cleanParentId } : {}),
        ...(cleanReplyToAuthor ? { replyToAuthor: cleanReplyToAuthor } : {}),
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
    ...(cleanParentId ? { parentId: cleanParentId } : {}),
    ...(cleanReplyToAuthor ? { replyToAuthor: cleanReplyToAuthor } : {}),
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

