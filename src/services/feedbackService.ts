import { getWorkerUrl, getAdminPasscode } from '@/services/scheduleService';
import {
  convertToOriginalQualityWebP,
  generateHighlightThumbnailWebP,
} from '@/services/highlightService';

export type FeedbackCategory = 'feature' | 'bug' | 'rule' | 'other';
export type FeedbackStatus = 'open' | 'reviewing' | 'done' | 'declined';

export const MAX_FEEDBACK_IMAGES_PER_POST = 10;

export interface FeedbackImageItem {
  imageId: string;
  imageSize?: number;
  hasThumb?: boolean;
  thumbSize?: number;
}

export interface FeedbackItem {
  id: string;
  category: FeedbackCategory;
  title: string;
  content: string;
  authorName: string;
  hasPin?: boolean;
  status: FeedbackStatus;
  likes: number;
  adminReply?: string;
  hasImage?: boolean;
  imageId?: string;
  imageIds?: string[];
  images?: FeedbackImageItem[];
  localImageDataUrls?: string[];
  createdAt: number;
  updatedAt?: number;
}

export interface FeedbackDisplayImage {
  key: string;
  thumbUrl: string;
  fullUrl: string;
}

const LOCAL_FALLBACK_KEY = 'mahjong_feedback_fallback_v1';
const LIKED_IDS_KEY = 'mahjong_feedback_liked_ids_v1';

export function getFeedbackImageIds(item?: FeedbackItem | null): string[] {
  if (!item) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  if (Array.isArray(item.imageIds) && item.imageIds.length > 0) {
    for (const id of item.imageIds) {
      const clean = String(id || '').trim();
      if (clean && !seen.has(clean)) {
        seen.add(clean);
        result.push(clean);
      }
    }
  }
  if (result.length === 0 && Array.isArray(item.images) && item.images.length > 0) {
    for (const img of item.images) {
      const clean = String(img?.imageId || '').trim();
      if (clean && !seen.has(clean)) {
        seen.add(clean);
        result.push(clean);
      }
    }
  }
  if (result.length === 0 && item.imageId) {
    const clean = String(item.imageId).trim();
    if (clean) result.push(clean);
  }
  return result;
}

export function getFeedbackImageUrl(imageId?: string): string {
  if (!imageId) return '';
  return `${getWorkerUrl()}/api/public/feedback/image/${encodeURIComponent(imageId)}`;
}

export function getFeedbackThumbnailUrl(imageId?: string): string {
  if (!imageId) return '';
  return `${getWorkerUrl()}/api/public/feedback/image/${encodeURIComponent(imageId)}?thumb=1`;
}

export function getFeedbackDisplayImages(item?: FeedbackItem | null): FeedbackDisplayImage[] {
  if (!item) return [];
  const ids = getFeedbackImageIds(item);
  if (ids.length > 0) {
    return ids.map((id) => ({
      key: id,
      thumbUrl: getFeedbackThumbnailUrl(id),
      fullUrl: getFeedbackImageUrl(id),
    }));
  }
  if (Array.isArray(item.localImageDataUrls) && item.localImageDataUrls.length > 0) {
    return item.localImageDataUrls
      .filter((u) => typeof u === 'string' && u.length > 0)
      .map((url, idx) => ({
        key: `local_${item.id}_${idx}`,
        thumbUrl: url,
        fullUrl: url,
      }));
  }
  return [];
}

function readLocalFeedback(): FeedbackItem[] {
  try {
    const raw = localStorage.getItem(LOCAL_FALLBACK_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

function writeLocalFeedback(items: FeedbackItem[]): void {
  try {
    localStorage.setItem(LOCAL_FALLBACK_KEY, JSON.stringify(items));
  } catch {}
}

export function getLikedFeedbackIds(): Set<string> {
  try {
    const raw = localStorage.getItem(LIKED_IDS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return new Set(parsed.map(String));
    }
  } catch {}
  return new Set();
}

export function saveLikedFeedbackIds(set: Set<string>): void {
  try {
    localStorage.setItem(LIKED_IDS_KEY, JSON.stringify(Array.from(set)));
  } catch {}
}

function getAuthFields() {
  return {
    access_token: localStorage.getItem('google_access_token') || '',
    refresh_cipher: localStorage.getItem('google_refresh_cipher') || '',
    admin_passcode: getAdminPasscode() || '',
  };
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

export async function fetchFeedbackItems(forceRefresh: boolean = false): Promise<{
  items: FeedbackItem[];
  isLocalFallback: boolean;
}> {
  const workerUrl = getWorkerUrl();
  if (workerUrl) {
    try {
      const query = forceRefresh ? `?refresh=1&_t=${Date.now()}` : '';
      const res = await fetch(`${workerUrl}/api/public/feedback${query}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data?.success && Array.isArray(data.items)) {
          writeLocalFeedback(data.items);
          return { items: data.items, isLocalFallback: false };
        }
      }
    } catch (err) {
      console.warn('Feedback fetch failed, using local fallback:', err);
    }
  }
  return { items: readLocalFeedback(), isLocalFallback: true };
}

export async function createFeedbackItem(params: {
  category: FeedbackCategory;
  title: string;
  content: string;
  authorName: string;
  pin?: string;
  imageFiles?: File[];
}): Promise<{
  success: boolean;
  items?: FeedbackItem[];
  isLocalFallback?: boolean;
  error?: string;
}> {
  const filesToUpload = Array.isArray(params.imageFiles)
    ? params.imageFiles.filter(Boolean).slice(0, MAX_FEEDBACK_IMAGES_PER_POST)
    : [];

  const workerUrl = getWorkerUrl();
  if (workerUrl) {
    try {
      const auth = getAuthFields();
      const metadata = {
        action: 'create',
        category: params.category,
        title: params.title.trim(),
        content: params.content.trim(),
        authorName: params.authorName.trim() || '익명',
        pin: params.pin?.trim() || '',
      };

      let res: Response;
      if (filesToUpload.length > 0) {
        const formData = new FormData();
        formData.append('metadata', JSON.stringify(metadata));
        formData.append('access_token', auth.access_token);
        formData.append('refresh_cipher', auth.refresh_cipher);
        formData.append('admin_passcode', auth.admin_passcode);

        for (let i = 0; i < filesToUpload.length; i++) {
          const file = filesToUpload[i];
          const [optimizedMain, thumbFile] = await Promise.all([
            convertToOriginalQualityWebP(file),
            generateHighlightThumbnailWebP(file),
          ]);
          formData.append(`image_${i}`, optimizedMain, optimizedMain.name);
          if (thumbFile) {
            formData.append(`thumbnail_${i}`, thumbFile, thumbFile.name);
          }
        }

        res = await fetch(`${workerUrl}/api/public/feedback`, {
          method: 'POST',
          body: formData,
        });
      } else {
        res = await fetch(`${workerUrl}/api/public/feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...metadata,
            ...auth,
          }),
        });
      }

      const data = await res.json().catch(() => null);
      if (res.ok && data?.success && Array.isArray(data.items)) {
        writeLocalFeedback(data.items);
        return { success: true, items: data.items, isLocalFallback: false };
      }
      if (res.status !== 404) {
        return { success: false, error: data?.error || '피드백 등록에 실패했습니다.' };
      }
    } catch (err) {
      console.warn('Feedback create failed, falling back to local:', err);
    }
  }

  // Worker 미배포 시 로컬 폴백 저장
  const localImageDataUrls: string[] = [];
  for (const file of filesToUpload) {
    const thumb = await generateHighlightThumbnailWebP(file);
    const dataUrl = await fileToDataUrl(thumb || file);
    if (dataUrl) localImageDataUrls.push(dataUrl);
  }

  const prev = readLocalFeedback();
  const newItem: FeedbackItem = {
    id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    category: params.category,
    title: params.title.trim(),
    content: params.content.trim(),
    authorName: params.authorName.trim() || '익명',
    hasPin: Boolean(params.pin?.trim()),
    status: 'open',
    likes: 0,
    adminReply: '',
    hasImage: localImageDataUrls.length > 0,
    localImageDataUrls: localImageDataUrls.length > 0 ? localImageDataUrls : undefined,
    createdAt: Date.now(),
  };
  const next = [newItem, ...prev];
  writeLocalFeedback(next);
  return { success: true, items: next, isLocalFallback: true };
}

export async function toggleFeedbackLike(
  id: string,
  delta: 1 | -1
): Promise<{ success: boolean; items?: FeedbackItem[] }> {
  const workerUrl = getWorkerUrl();
  if (workerUrl) {
    try {
      const res = await fetch(`${workerUrl}/api/public/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'like', id, delta }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success && Array.isArray(data.items)) {
        writeLocalFeedback(data.items);
        return { success: true, items: data.items };
      }
    } catch {}
  }

  const prev = readLocalFeedback();
  const next = prev.map((it) =>
    it.id === id ? { ...it, likes: Math.max(0, (it.likes || 0) + delta) } : it
  );
  writeLocalFeedback(next);
  return { success: true, items: next };
}

export async function adminUpdateFeedback(params: {
  id: string;
  status: FeedbackStatus;
  adminReply: string;
}): Promise<{ success: boolean; items?: FeedbackItem[]; error?: string }> {
  const workerUrl = getWorkerUrl();
  if (workerUrl) {
    try {
      const res = await fetch(`${workerUrl}/api/public/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'admin_update',
          id: params.id,
          status: params.status,
          adminReply: params.adminReply.trim(),
          ...getAuthFields(),
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success && Array.isArray(data.items)) {
        writeLocalFeedback(data.items);
        return { success: true, items: data.items };
      }
      if (res.status !== 404) {
        return { success: false, error: data?.error || '관리자 상태 업데이트에 실패했습니다.' };
      }
    } catch {}
  }

  const prev = readLocalFeedback();
  const next = prev.map((it) =>
    it.id === params.id
      ? { ...it, status: params.status, adminReply: params.adminReply.trim(), updatedAt: Date.now() }
      : it
  );
  writeLocalFeedback(next);
  return { success: true, items: next };
}

export async function deleteFeedbackItem(params: {
  id: string;
  pin?: string;
}): Promise<{ success: boolean; items?: FeedbackItem[]; error?: string }> {
  const workerUrl = getWorkerUrl();
  if (workerUrl) {
    try {
      const res = await fetch(`${workerUrl}/api/public/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete',
          id: params.id,
          pin: params.pin?.trim() || '',
          ...getAuthFields(),
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success && Array.isArray(data.items)) {
        writeLocalFeedback(data.items);
        return { success: true, items: data.items };
      }
      if (res.status !== 404) {
        return { success: false, error: data?.error || '삭제에 실패했습니다.' };
      }
    } catch {}
  }

  const prev = readLocalFeedback();
  const next = prev.filter((it) => it.id !== params.id);
  writeLocalFeedback(next);
  return { success: true, items: next };
}
