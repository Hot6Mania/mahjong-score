<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import {
  fetchFeedbackItems,
  createFeedbackItem,
  toggleFeedbackLike,
  adminUpdateFeedback,
  deleteFeedbackItem,
  getLikedFeedbackIds,
  saveLikedFeedbackIds,
  type FeedbackCategory,
  type FeedbackStatus,
  type FeedbackItem
} from '@/services/feedbackService';
import { checkAdminStatus, getLastAttendeeName } from '@/services/scheduleService';

const items = ref<FeedbackItem[]>([]);
const isLoading = ref(false);
const isLocalFallback = ref(false);
const isAdmin = ref(false);
const likedIds = ref<Set<string>>(getLikedFeedbackIds());

const activeCategoryFilter = ref<'all' | FeedbackCategory>('all');
const activeStatusFilter = ref<'all' | FeedbackStatus>('all');
const isFormOpen = ref(false);
const isSubmitting = ref(false);
const formError = ref('');
const statusMessage = ref('');

const form = ref<{
  category: FeedbackCategory;
  title: string;
  content: string;
  authorName: string;
  pin: string;
}>({
  category: 'feature',
  title: '',
  content: '',
  authorName: getLastAttendeeName() || '',
  pin: '',
});

// 관리자 편집 상태
const adminEditingId = ref<string>('');
const adminEditStatus = ref<FeedbackStatus>('open');
const adminEditReply = ref<string>('');
const isAdminSaving = ref(false);

const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  feature: '기능 제안',
  bug: '버그 제보',
  rule: '룰·운영 건의',
  other: '기타 의견',
};

const STATUS_LABELS: Record<FeedbackStatus, string> = {
  open: '접수됨',
  reviewing: '검토 중',
  done: '반영 완료',
  declined: '보류',
};

const summaryCounts = computed(() => {
  const list = items.value;
  return {
    total: list.length,
    open: list.filter((it) => it.status === 'open').length,
    reviewing: list.filter((it) => it.status === 'reviewing').length,
    done: list.filter((it) => it.status === 'done').length,
  };
});

const filteredItems = computed(() => {
  return items.value.filter((it) => {
    if (activeCategoryFilter.value !== 'all' && it.category !== activeCategoryFilter.value) return false;
    if (activeStatusFilter.value !== 'all' && it.status !== activeStatusFilter.value) return false;
    return true;
  });
});

const formatDateTime = (ts: number): string => {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}.${m}.${day} ${hh}:${mm}`;
};

const showBriefMessage = (msg: string) => {
  statusMessage.value = msg;
  setTimeout(() => {
    if (statusMessage.value === msg) statusMessage.value = '';
  }, 3000);
};

const loadFeedback = async (forceRefresh = false) => {
  isLoading.value = true;
  try {
    const res = await fetchFeedbackItems(forceRefresh);
    items.value = res.items;
    isLocalFallback.value = res.isLocalFallback;
  } finally {
    isLoading.value = false;
  }
};

const handleSubmit = async () => {
  formError.value = '';
  if (!form.value.title.trim()) {
    formError.value = '제목을 입력해 주세요.';
    return;
  }
  if (!form.value.content.trim()) {
    formError.value = '내용을 입력해 주세요.';
    return;
  }

  isSubmitting.value = true;
  try {
    const res = await createFeedbackItem({
      category: form.value.category,
      title: form.value.title,
      content: form.value.content,
      authorName: form.value.authorName || '익명',
      pin: form.value.pin,
    });
    if (res.success && res.items) {
      items.value = res.items;
      isLocalFallback.value = Boolean(res.isLocalFallback);
      form.value.title = '';
      form.value.content = '';
      form.value.pin = '';
      isFormOpen.value = false;
      showBriefMessage('소중한 피드백이 등록되었습니다!');
    } else {
      formError.value = res.error || '등록에 실패했습니다.';
    }
  } finally {
    isSubmitting.value = false;
  }
};

const handleToggleLike = async (item: FeedbackItem) => {
  const alreadyLiked = likedIds.value.has(item.id);
  const delta: 1 | -1 = alreadyLiked ? -1 : 1;
  const nextSet = new Set(likedIds.value);
  if (alreadyLiked) {
    nextSet.delete(item.id);
  } else {
    nextSet.add(item.id);
  }
  likedIds.value = nextSet;
  saveLikedFeedbackIds(nextSet);

  // 낙관적 업데이트
  item.likes = Math.max(0, (item.likes || 0) + delta);
  const res = await toggleFeedbackLike(item.id, delta);
  if (res.success && res.items) {
    items.value = res.items;
  }
};

const openAdminEdit = (item: FeedbackItem) => {
  if (adminEditingId.value === item.id) {
    adminEditingId.value = '';
    return;
  }
  adminEditingId.value = item.id;
  adminEditStatus.value = item.status;
  adminEditReply.value = item.adminReply || '';
};

const handleAdminSave = async (item: FeedbackItem) => {
  isAdminSaving.value = true;
  try {
    const res = await adminUpdateFeedback({
      id: item.id,
      status: adminEditStatus.value,
      adminReply: adminEditReply.value,
    });
    if (res.success && res.items) {
      items.value = res.items;
      adminEditingId.value = '';
      showBriefMessage('상태 및 답변이 저장되었습니다.');
    } else {
      alert(res.error || '저장에 실패했습니다.');
    }
  } finally {
    isAdminSaving.value = false;
  }
};

const handleDelete = async (item: FeedbackItem) => {
  let pin = '';
  if (!isAdmin.value) {
    if (!item.hasPin) {
      alert('비밀번호(PIN)가 설정되지 않은 글은 관리자만 삭제할 수 있습니다.');
      return;
    }
    const input = window.prompt('삭제 비밀번호(PIN)를 입력해 주세요.');
    if (input === null || !input.trim()) return;
    pin = input.trim();
  } else {
    if (!window.confirm('이 피드백을 삭제하시겠습니까?')) return;
  }

  const res = await deleteFeedbackItem({ id: item.id, pin });
  if (res.success && res.items) {
    items.value = res.items;
    showBriefMessage('피드백이 삭제되었습니다.');
  } else {
    alert(res.error || '삭제에 실패했습니다.');
  }
};

onMounted(async () => {
  loadFeedback();
  try {
    const adminInfo = await checkAdminStatus();
    isAdmin.value = Boolean(adminInfo.isAdmin);
    if (!form.value.authorName && adminInfo.attendeeName) {
      form.value.authorName = adminInfo.attendeeName;
    }
  } catch {}
});
</script>

<template>
  <div class="feedback-tab-container">
    <!-- 상단 헤더 & 요약 카드 -->
    <div class="fb-hero-card">
      <div class="fb-hero-top">
        <div class="fb-title-group">
          <h2 class="fb-main-title">피드백 &amp; 건의함</h2>
          <span class="fb-main-subtitle">기능 개선 요청, 버그 제보, 룰·운영 의견을 자유롭게 남겨주세요.</span>
        </div>
        <div class="fb-hero-actions">
          <button type="button" class="fb-btn-refresh" @click="loadFeedback(true)" :disabled="isLoading" title="새로고침">
            새로고침
          </button>
          <button type="button" class="fb-btn-write" @click="isFormOpen = !isFormOpen">
            {{ isFormOpen ? '작성 닫기' : '+ 피드백 작성' }}
          </button>
        </div>
      </div>

      <!-- 상태 요약 바 -->
      <div class="fb-summary-strip">
        <button
          type="button"
          class="fb-summary-chip"
          :class="{ active: activeStatusFilter === 'all' }"
          @click="activeStatusFilter = 'all'"
        >
          <span class="fb-sum-label">전체</span>
          <span class="fb-sum-val">{{ summaryCounts.total }}</span>
        </button>
        <button
          type="button"
          class="fb-summary-chip status-open"
          :class="{ active: activeStatusFilter === 'open' }"
          @click="activeStatusFilter = activeStatusFilter === 'open' ? 'all' : 'open'"
        >
          <span class="fb-sum-label">접수됨</span>
          <span class="fb-sum-val">{{ summaryCounts.open }}</span>
        </button>
        <button
          type="button"
          class="fb-summary-chip status-reviewing"
          :class="{ active: activeStatusFilter === 'reviewing' }"
          @click="activeStatusFilter = activeStatusFilter === 'reviewing' ? 'all' : 'reviewing'"
        >
          <span class="fb-sum-label">검토 중</span>
          <span class="fb-sum-val">{{ summaryCounts.reviewing }}</span>
        </button>
        <button
          type="button"
          class="fb-summary-chip status-done"
          :class="{ active: activeStatusFilter === 'done' }"
          @click="activeStatusFilter = activeStatusFilter === 'done' ? 'all' : 'done'"
        >
          <span class="fb-sum-label">반영 완료</span>
          <span class="fb-sum-val">{{ summaryCounts.done }}</span>
        </button>
      </div>

      <div v-if="statusMessage" class="fb-toast-banner">{{ statusMessage }}</div>
      <div v-if="isLocalFallback" class="fb-fallback-notice">
        ※ 현재 로컬 미리보기 모드로 동작 중입니다. 서버(Worker) 배포 후 전체 모임원과 실시간 공유됩니다.
      </div>
    </div>

    <!-- 피드백 작성 폼 -->
    <div v-if="isFormOpen" class="fb-form-card">
      <div class="fb-form-row">
        <label class="fb-label">분류</label>
        <div class="fb-category-chips">
          <button
            v-for="(label, key) in CATEGORY_LABELS"
            :key="key"
            type="button"
            class="fb-cat-chip"
            :class="[`cat-${key}`, { selected: form.category === key }]"
            @click="form.category = key as FeedbackCategory"
          >
            {{ label }}
          </button>
        </div>
      </div>

      <div class="fb-form-grid-2">
        <div class="fb-form-row">
          <label class="fb-label">작성자 (선택)</label>
          <input
            v-model="form.authorName"
            type="text"
            class="fb-input"
            placeholder="닉네임 (미입력 시 익명)"
            maxlength="30"
          />
        </div>
        <div class="fb-form-row">
          <label class="fb-label">삭제 비밀번호 (선택)</label>
          <input
            v-model="form.pin"
            type="password"
            class="fb-input"
            placeholder="본인 삭제용 숫자/문자"
            maxlength="20"
            autocomplete="off"
          />
        </div>
      </div>

      <div class="fb-form-row">
        <label class="fb-label">제목 *</label>
        <input
          v-model="form.title"
          type="text"
          class="fb-input"
          placeholder="요청하거나 제보할 내용을 한 줄로 요약해 주세요"
          maxlength="120"
        />
      </div>

      <div class="fb-form-row">
        <label class="fb-label">상세 내용 *</label>
        <textarea
          v-model="form.content"
          rows="4"
          class="fb-textarea"
          placeholder="구체적인 상황, 원하는 동작 또는 개선 아이디어를 적어주세요 (최대 1,500자)"
          maxlength="1500"
        ></textarea>
      </div>

      <div v-if="formError" class="fb-error-text">{{ formError }}</div>

      <div class="fb-form-footer">
        <button type="button" class="fb-btn-cancel" @click="isFormOpen = false">취소</button>
        <button type="button" class="fb-btn-submit" :disabled="isSubmitting" @click="handleSubmit">
          {{ isSubmitting ? '등록 중...' : '피드백 등록' }}
        </button>
      </div>
    </div>

    <!-- 카테고리 필터 바 -->
    <div class="fb-filter-bar">
      <button
        type="button"
        class="fb-filter-pill"
        :class="{ active: activeCategoryFilter === 'all' }"
        @click="activeCategoryFilter = 'all'"
      >전체 분류</button>
      <button
        v-for="(label, key) in CATEGORY_LABELS"
        :key="`flt-${key}`"
        type="button"
        class="fb-filter-pill"
        :class="{ active: activeCategoryFilter === key }"
        @click="activeCategoryFilter = key as FeedbackCategory"
      >{{ label }}</button>
    </div>

    <!-- 목록 -->
    <div v-if="isLoading && items.length === 0" class="fb-empty-card">
      피드백 목록을 불러오는 중입니다...
    </div>
    <div v-else-if="filteredItems.length === 0" class="fb-empty-card">
      아직 등록된 피드백이 없습니다. 상단 <strong>[+ 피드백 작성]</strong> 버튼으로 첫 의견을 남겨보세요!
    </div>
    <div v-else class="fb-list">
      <article v-for="item in filteredItems" :key="item.id" class="fb-item-card">
        <div class="fb-item-header">
          <div class="fb-item-badges">
            <span class="fb-cat-badge" :class="`cat-${item.category}`">
              {{ CATEGORY_LABELS[item.category] || '기타' }}
            </span>
            <span class="fb-status-badge" :class="`status-${item.status}`">
              {{ STATUS_LABELS[item.status] || '접수됨' }}
            </span>
          </div>
          <div class="fb-item-meta">
            <span class="fb-author">{{ item.authorName || '익명' }}</span>
            <span class="fb-date">{{ formatDateTime(item.createdAt) }}</span>
          </div>
        </div>

        <h3 class="fb-item-title">{{ item.title }}</h3>
        <p class="fb-item-content">{{ item.content }}</p>

        <!-- 관리자 답변 박스 -->
        <div v-if="item.adminReply" class="fb-admin-reply-box">
          <span class="fb-admin-reply-tag">운영진 답변</span>
          <p class="fb-admin-reply-text">{{ item.adminReply }}</p>
        </div>

        <div class="fb-item-footer">
          <button
            type="button"
            class="fb-like-btn"
            :class="{ liked: likedIds.has(item.id) }"
            @click="handleToggleLike(item)"
          >
            <span>👍 공감</span>
            <span class="fb-like-count">{{ item.likes || 0 }}</span>
          </button>

          <div class="fb-item-right-actions">
            <button
              v-if="isAdmin"
              type="button"
              class="fb-action-link"
              @click="openAdminEdit(item)"
            >
              {{ adminEditingId === item.id ? '관리 닫기' : '상태/답변' }}
            </button>
            <button
              v-if="isAdmin || item.hasPin"
              type="button"
              class="fb-action-link danger"
              @click="handleDelete(item)"
            >
              삭제
            </button>
          </div>
        </div>

        <!-- 관리자 상태/답변 편집 패널 -->
        <div v-if="isAdmin && adminEditingId === item.id" class="fb-admin-panel">
          <div class="fb-admin-row">
            <label class="fb-label">진행 상태</label>
            <select v-model="adminEditStatus" class="fb-select">
              <option value="open">접수됨</option>
              <option value="reviewing">검토 중</option>
              <option value="done">반영 완료</option>
              <option value="declined">보류</option>
            </select>
          </div>
          <div class="fb-admin-row">
            <label class="fb-label">운영진 답변</label>
            <textarea
              v-model="adminEditReply"
              rows="2"
              class="fb-textarea"
              placeholder="반영 결과나 안내 사항을 입력하세요"
            ></textarea>
          </div>
          <div class="fb-admin-actions">
            <button type="button" class="fb-btn-cancel" @click="adminEditingId = ''">취소</button>
            <button type="button" class="fb-btn-submit" :disabled="isAdminSaving" @click="handleAdminSave(item)">
              {{ isAdminSaving ? '저장 중...' : '저장' }}
            </button>
          </div>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.feedback-tab-container {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  box-sizing: border-box;
}
.fb-hero-card,
.fb-form-card,
.fb-item-card,
.fb-empty-card {
  background: var(--card-bg-color, #ffffff);
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 12px;
  padding: 18px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}
html.dark .fb-hero-card,
html.dark .fb-form-card,
html.dark .fb-item-card,
html.dark .fb-empty-card {
  background: #18181b;
  border-color: #27272a;
}
.fb-hero-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.fb-title-group {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.fb-main-title {
  margin: 0;
  font-size: 17px;
  font-weight: 800;
  color: var(--text-color, #0f172a);
}
.fb-main-subtitle {
  font-size: 12.5px;
  color: var(--text-dimmed, #64748b);
}
.fb-hero-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.fb-btn-refresh {
  padding: 7px 12px;
  border-radius: 8px;
  border: 1px solid var(--border-color, #cbd5e1);
  background: transparent;
  color: var(--text-color, #334155);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
html.dark .fb-btn-refresh {
  border-color: #3f3f46;
  color: #e4e4e7;
}
.fb-btn-write {
  padding: 8px 14px;
  border-radius: 8px;
  border: none;
  background: #2563eb;
  color: #ffffff;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s ease;
}
.fb-btn-write:hover {
  background: #1d4ed8;
}
.fb-summary-strip {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.fb-summary-chip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 12px;
  border-radius: 8px;
  border: 1px solid var(--border-color, #e2e8f0);
  background: var(--bg-card, #f8fafc);
  color: var(--text-color, #0f172a);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}
html.dark .fb-summary-chip {
  background: #27272a;
  border-color: #3f3f46;
  color: #f4f4f5;
}
.fb-summary-chip.active {
  border-color: #2563eb;
  box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.25);
}
.fb-sum-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dimmed, #64748b);
}
.fb-sum-val {
  font-size: 15px;
  font-weight: 800;
}
.fb-summary-chip.status-open .fb-sum-val { color: #2563eb; }
.fb-summary-chip.status-reviewing .fb-sum-val { color: #d97706; }
.fb-summary-chip.status-done .fb-sum-val { color: #16a34a; }

.fb-toast-banner {
  margin-top: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(16, 185, 129, 0.12);
  color: #059669;
  font-size: 12.5px;
  font-weight: 700;
}
html.dark .fb-toast-banner {
  background: rgba(16, 185, 129, 0.2);
  color: #34d399;
}
.fb-fallback-notice {
  margin-top: 10px;
  font-size: 11.5px;
  color: var(--text-dimmed, #64748b);
}

.fb-form-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.fb-form-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.fb-form-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.fb-label {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--text-color, #1e293b);
}
.fb-category-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.fb-cat-chip {
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--border-color, #cbd5e1);
  background: transparent;
  color: var(--text-dimmed, #64748b);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.fb-cat-chip.selected {
  border-color: #2563eb;
  background: rgba(37, 99, 235, 0.12);
  color: #2563eb;
  font-weight: 700;
}
html.dark .fb-cat-chip.selected {
  background: rgba(59, 130, 246, 0.22);
  color: #93c5fd;
}
.fb-input,
.fb-textarea,
.fb-select {
  width: 100%;
  box-sizing: border-box;
  padding: 9px 11px;
  border-radius: 8px;
  border: 1px solid var(--border-color, #cbd5e1);
  background: var(--bg-card, #f8fafc);
  color: var(--text-color, #0f172a);
  font-size: 13.5px;
  font-family: inherit;
  outline: none;
}
html.dark .fb-input,
html.dark .fb-textarea,
html.dark .fb-select {
  background: #27272a;
  border-color: #3f3f46;
  color: #f4f4f5;
}
.fb-input:focus,
.fb-textarea:focus,
.fb-select:focus {
  border-color: #2563eb;
}
.fb-textarea {
  resize: vertical;
  line-height: 1.5;
}
.fb-error-text {
  color: #dc2626;
  font-size: 12.5px;
  font-weight: 600;
}
.fb-form-footer,
.fb-admin-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.fb-btn-cancel {
  padding: 8px 14px;
  border-radius: 8px;
  border: 1px solid var(--border-color, #cbd5e1);
  background: transparent;
  color: var(--text-dimmed, #64748b);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.fb-btn-submit {
  padding: 8px 16px;
  border-radius: 8px;
  border: none;
  background: #2563eb;
  color: #ffffff;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.fb-btn-submit:disabled {
  opacity: 0.6;
  cursor: default;
}

.fb-filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.fb-filter-pill {
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--border-color, #cbd5e1);
  background: var(--card-bg-color, #ffffff);
  color: var(--text-dimmed, #64748b);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
html.dark .fb-filter-pill {
  background: #18181b;
  border-color: #3f3f46;
}
.fb-filter-pill.active {
  background: #2563eb;
  border-color: #2563eb;
  color: #ffffff;
}

.fb-empty-card {
  text-align: center;
  padding: 36px 16px;
  color: var(--text-dimmed, #64748b);
  font-size: 13.5px;
}
.fb-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.fb-item-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.fb-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.fb-item-badges {
  display: flex;
  align-items: center;
  gap: 6px;
}
.fb-cat-badge,
.fb-status-badge {
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
}
.fb-cat-badge.cat-feature { background: rgba(37, 99, 235, 0.12); color: #2563eb; }
.fb-cat-badge.cat-bug { background: rgba(220, 38, 38, 0.12); color: #dc2626; }
.fb-cat-badge.cat-rule { background: rgba(217, 119, 6, 0.14); color: #b45309; }
.fb-cat-badge.cat-other { background: rgba(100, 116, 139, 0.14); color: #475569; }
html.dark .fb-cat-badge.cat-feature { color: #93c5fd; }
html.dark .fb-cat-badge.cat-bug { color: #fca5a5; }
html.dark .fb-cat-badge.cat-rule { color: #fcd34d; }
html.dark .fb-cat-badge.cat-other { color: #cbd5e1; }

.fb-status-badge.status-open { background: rgba(59, 130, 246, 0.12); color: #2563eb; }
.fb-status-badge.status-reviewing { background: rgba(245, 158, 11, 0.16); color: #d97706; }
.fb-status-badge.status-done { background: rgba(16, 185, 129, 0.16); color: #059669; }
.fb-status-badge.status-declined { background: rgba(100, 116, 139, 0.16); color: #64748b; }
html.dark .fb-status-badge.status-open { color: #93c5fd; }
html.dark .fb-status-badge.status-reviewing { color: #fbbf24; }
html.dark .fb-status-badge.status-done { color: #34d399; }
html.dark .fb-status-badge.status-declined { color: #94a3b8; }

.fb-item-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-dimmed, #64748b);
}
.fb-author {
  font-weight: 700;
  color: var(--text-color, #334155);
}
.fb-item-title {
  margin: 0;
  font-size: 15px;
  font-weight: 800;
  color: var(--text-color, #0f172a);
}
.fb-item-content {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--text-color, #334155);
  white-space: pre-wrap;
  word-break: break-word;
}
.fb-admin-reply-box {
  margin-top: 4px;
  padding: 10px 12px;
  border-radius: 8px;
  border-left: 3px solid #10b981;
  background: rgba(16, 185, 129, 0.08);
}
html.dark .fb-admin-reply-box {
  background: rgba(16, 185, 129, 0.14);
}
.fb-admin-reply-tag {
  display: inline-block;
  font-size: 11px;
  font-weight: 800;
  color: #059669;
  margin-bottom: 4px;
}
html.dark .fb-admin-reply-tag {
  color: #34d399;
}
.fb-admin-reply-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-color, #1e293b);
  white-space: pre-wrap;
}
.fb-item-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 6px;
  border-top: 1px solid var(--border-color, #f1f5f9);
}
html.dark .fb-item-footer {
  border-color: #27272a;
}
.fb-like-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid var(--border-color, #cbd5e1);
  background: transparent;
  color: var(--text-dimmed, #64748b);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.fb-like-btn.liked {
  border-color: #2563eb;
  background: rgba(37, 99, 235, 0.12);
  color: #2563eb;
}
html.dark .fb-like-btn.liked {
  color: #93c5fd;
}
.fb-like-count {
  font-weight: 800;
}
.fb-item-right-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.fb-action-link {
  border: none;
  background: none;
  padding: 2px 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dimmed, #64748b);
  cursor: pointer;
}
.fb-action-link:hover {
  color: #2563eb;
  text-decoration: underline;
}
.fb-action-link.danger:hover {
  color: #dc2626;
}
.fb-admin-panel {
  margin-top: 6px;
  padding: 12px;
  border-radius: 8px;
  background: var(--bg-card, #f8fafc);
  border: 1px solid var(--border-color, #e2e8f0);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
html.dark .fb-admin-panel {
  background: #27272a;
  border-color: #3f3f46;
}
.fb-admin-row {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

@media (max-width: 640px) {
  .fb-hero-card,
  .fb-form-card,
  .fb-item-card {
    padding: 14px 12px;
  }
  .fb-summary-strip {
    grid-template-columns: repeat(2, 1fr);
  }
  .fb-form-grid-2 {
    grid-template-columns: 1fr;
  }
}
</style>
