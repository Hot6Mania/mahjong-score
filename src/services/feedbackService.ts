import { getWorkerUrl, getAdminPasscode } from '@/services/scheduleService';

export type FeedbackCategory = 'feature' | 'bug' | 'rule' | 'other';
export type FeedbackStatus = 'open' | 'reviewing' | 'done' | 'declined';

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
  createdAt: number;
  updatedAt?: number;
}

const LOCAL_FALLBACK_KEY = 'mahjong_feedback_fallback_v1';
const LIKED_IDS_KEY = 'mahjong_feedback_liked_ids_v1';

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
}): Promise<{
  success: boolean;
  items?: FeedbackItem[];
  isLocalFallback?: boolean;
  error?: string;
}> {
  const workerUrl = getWorkerUrl();
  if (workerUrl) {
    try {
      const res = await fetch(`${workerUrl}/api/public/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          category: params.category,
          title: params.title.trim(),
          content: params.content.trim(),
          authorName: params.authorName.trim() || '익명',
          pin: params.pin?.trim() || '',
          ...getAuthFields(),
        }),
      });
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
