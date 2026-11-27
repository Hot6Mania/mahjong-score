<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import {
  fetchFeedbackItems,
  createFeedbackItem,
  toggleFeedbackLike,
  adminUpdateFeedback,
  deleteFeedbackItem,
  getLikedFeedbackIds,
  saveLikedFeedbackIds,
  getFeedbackDisplayImages,
  MAX_FEEDBACK_IMAGES_PER_POST,
  type FeedbackCategory,
  type FeedbackStatus,
  type FeedbackItem,
  type FeedbackDisplayImage,
} from '@/services/feedbackService';
import { checkAdminStatus, getLastAttendeeName } from '@/services/scheduleService';

interface PendingFeedbackImage {
  key: string;
  previewUrl: string;
  file: File;
}

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
const isDragOverPhotos = ref(false);

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

const pendingImages = ref<PendingFeedbackImage[]>([]);
const feedbackFileInputRef = ref<HTMLInputElement | null>(null);

// 사진 크게 보기 라이트박스 상태
const lightboxImages = ref<FeedbackDisplayImage[]>([]);
const lightboxIndex = ref(0);
const lightboxTitle = ref('');

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

const currentLightboxImage = computed<FeedbackDisplayImage | null>(() => {
  if (lightboxImages.value.length === 0) return null;
  return lightboxImages.value[lightboxIndex.value] || lightboxImages.value[0] || null;
});

const isImageFile = (file: File): boolean => {
  if (!file) return false;
  if (file.type && file.type.startsWith('image/')) return true;
  return /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i.test(file.name || '');
};

const clearPendingImages = () => {
  for (const img of pendingImages.value) {
    if (img.previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(img.previewUrl);
    }
  }
  pendingImages.value = [];
  if (feedbackFileInputRef.value) {
    feedbackFileInputRef.value.value = '';
  }
};

const appendImageFiles = (rawFiles: File[]) => {
  const files = rawFiles.filter(isImageFile);
  if (files.length === 0) {
    if (rawFiles.length > 0) {
      formError.value = '이미지 파일만 첨부할 수 있습니다.';
    }
    return;
  }

  const remaining = MAX_FEEDBACK_IMAGES_PER_POST - pendingImages.value.length;
  if (remaining <= 0) {
    showBriefMessage(`사진은 최대 ${MAX_FEEDBACK_IMAGES_PER_POST}장까지 첨부할 수 있습니다.`);
    return;
  }

  const filesToAdd = files.slice(0, remaining);
  if (files.length > remaining) {
    showBriefMessage(`최대 ${MAX_FEEDBACK_IMAGES_PER_POST}장까지 첨부되어 초과된 ${files.length - remaining}장은 제외되었습니다.`);
  }

  for (const file of filesToAdd) {
    const previewUrl = URL.createObjectURL(file);
    pendingImages.value.push({
      key: `fb_new_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      previewUrl,
      file,
    });
  }
  formError.value = '';
};

const handleFileSelect = (e: Event) => {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files || []);
  appendImageFiles(files);
  input.value = '';
};

const handlePhotoDrop = (e: DragEvent) => {
  isDragOverPhotos.value = false;
  const files = Array.from(e.dataTransfer?.files || []);
  appendImageFiles(files);
};

const triggerFilePicker = () => {
  if (pendingImages.value.length >= MAX_FEEDBACK_IMAGES_PER_POST) return;
  feedbackFileInputRef.value?.click();
};

const removePendingImage = (idx: number) => {
  const target = pendingImages.value[idx];
  if (!target) return;
  if (target.previewUrl.startsWith('blob:')) {
    URL.revokeObjectURL(target.previewUrl);
  }
  pendingImages.value.splice(idx, 1);
};

const movePendingImage = (idx: number, delta: number) => {
  const nextIdx = idx + delta;
  if (nextIdx < 0 || nextIdx >= pendingImages.value.length) return;
  const arr = [...pendingImages.value];
  const [moved] = arr.splice(idx, 1);
  arr.splice(nextIdx, 0, moved);
  pendingImages.value = arr;
};

const closeForm = () => {
  clearPendingImages();
  formError.value = '';
  isFormOpen.value = false;
};

const openLightbox = (item: FeedbackItem, index: number) => {
  const imgs = getFeedbackDisplayImages(item);
  if (imgs.length === 0) return;
  lightboxImages.value = imgs;
  lightboxIndex.value = Math.max(0, Math.min(index, imgs.length - 1));
  lightboxTitle.value = item.title || '';
};

const closeLightbox = () => {
  lightboxImages.value = [];
  lightboxIndex.value = 0;
  lightboxTitle.value = '';
};

const stepLightbox = (delta: number) => {
  const total = lightboxImages.value.length;
  if (total <= 1) return;
  lightboxIndex.value = (lightboxIndex.value + delta + total) % total;
};

const handleLightboxKeydown = (e: KeyboardEvent) => {
  if (lightboxImages.value.length === 0) return;
  if (e.key === 'Escape') {
    closeLightbox();
  } else if (e.key === 'ArrowLeft') {
    stepLightbox(-1);
  } else if (e.key === 'ArrowRight') {
    stepLightbox(1);
  }
};

const handleThumbError = (e: Event, fullUrl: string) => {
  const img = e.target as HTMLImageElement | null;
  if (img && fullUrl && img.src !== fullUrl) {
    img.src = fullUrl;
  }
};

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
      imageFiles: pendingImages.value.map((it) => it.file),
    });
    if (res.success && res.items) {
      items.value = res.items;
      isLocalFallback.value = Boolean(res.isLocalFallback);
      form.value.title = '';
      form.value.content = '';
      form.value.pin = '';
      clearPendingImages();
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
  window.addEventListener('keydown', handleLightboxKeydown);
  loadFeedback();
  try {
    const adminInfo = await checkAdminStatus();
    isAdmin.value = Boolean(adminInfo.isAdmin);
    if (!form.value.authorName && adminInfo.attendeeName) {
      form.value.authorName = adminInfo.attendeeName;
    }
  } catch {}
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleLightboxKeydown);
  clearPendingImages();
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
          <button type="button" class="fb-btn-write" @click="isFormOpen ? closeForm() : (isFormOpen = true)">
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

      <!-- 다중 사진 첨부 -->
      <div class="fb-form-row">
        <label class="fb-label">
          사진 첨부 (선택)
          <span class="fb-sub-hint">({{ pendingImages.length }}/{{ MAX_FEEDBACK_IMAGES_PER_POST }}장 · 여러 장 선택 가능)</span>
        </label>
        <div
          class="fb-photo-dropzone"
          :class="{
            'is-dragover': isDragOverPhotos,
            'is-disabled': pendingImages.length >= MAX_FEEDBACK_IMAGES_PER_POST
          }"
          @click="triggerFilePicker"
          @dragover.prevent="isDragOverPhotos = true"
          @dragleave.prevent="isDragOverPhotos = false"
          @drop.prevent="handlePhotoDrop"
        >
          <input
            ref="feedbackFileInputRef"
            type="file"
            accept="image/*"
            multiple
            class="fb-file-input-hidden"
            :disabled="pendingImages.length >= MAX_FEEDBACK_IMAGES_PER_POST"
            @change="handleFileSelect"
          />
          <svg class="fb-photo-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <circle cx="8.5" cy="8.5" r="1.5"></circle>
            <polyline points="21 15 16 10 5 21"></polyline>
          </svg>
          <span class="fb-photo-dropzone-text">
            {{
              pendingImages.length >= MAX_FEEDBACK_IMAGES_PER_POST
                ? `최대 ${MAX_FEEDBACK_IMAGES_PER_POST}장까지 첨부되었습니다`
                : '클릭하거나 이미지를 끌어다 놓아 사진 추가 (복수 첨부 가능)'
            }}
          </span>
        </div>

        <div v-if="pendingImages.length > 0" class="fb-upload-preview-grid">
          <div
            v-for="(img, idx) in pendingImages"
            :key="img.key"
            class="fb-upload-preview-item"
          >
            <img :src="img.previewUrl" :alt="`첨부 미리보기 ${idx + 1}`" class="fb-upload-preview-img" />
            <span class="fb-upload-order-badge" :class="{ 'is-cover': idx === 0 }">
              {{ idx === 0 ? '대표' : idx + 1 }}
            </span>
            <button
              type="button"
              class="fb-upload-remove-btn"
              title="사진 제거"
              @click.stop="removePendingImage(idx)"
            >✕</button>
            <div v-if="pendingImages.length > 1" class="fb-upload-move-bar">
              <button
                type="button"
                class="fb-upload-move-btn"
                :disabled="idx === 0"
                title="앞으로 이동"
                @click.stop="movePendingImage(idx, -1)"
              >◀</button>
              <button
                type="button"
                class="fb-upload-move-btn"
                :disabled="idx === pendingImages.length - 1"
                title="뒤로 이동"
                @click.stop="movePendingImage(idx, 1)"
              >▶</button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="formError" class="fb-error-text">{{ formError }}</div>

      <div class="fb-form-footer">
        <button type="button" class="fb-btn-cancel" @click="closeForm">취소</button>
        <button type="button" class="fb-btn-submit" :disabled="isSubmitting" @click="handleSubmit">
          {{ isSubmitting ? (pendingImages.length > 0 ? '사진 업로드 중...' : '등록 중...') : '피드백 등록' }}
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
            <span v-if="getFeedbackDisplayImages(item).length > 0" class="fb-photo-count-badge">
              사진 {{ getFeedbackDisplayImages(item).length }}장
            </span>
          </div>
          <div class="fb-item-meta">
            <span class="fb-author">{{ item.authorName || '익명' }}</span>
            <span class="fb-date">{{ formatDateTime(item.createdAt) }}</span>
          </div>
        </div>

        <h3 class="fb-item-title">{{ item.title }}</h3>
        <p class="fb-item-content">{{ item.content }}</p>

        <!-- 첨부 사진 썸네일 그리드 -->
        <div v-if="getFeedbackDisplayImages(item).length > 0" class="fb-item-images-grid">
          <button
            v-for="(img, imgIdx) in getFeedbackDisplayImages(item)"
            :key="img.key"
            type="button"
            class="fb-item-image-thumb-btn"
            :title="`첨부 사진 ${imgIdx + 1} 크게 보기`"
            @click="openLightbox(item, imgIdx)"
          >
            <img
              :src="img.thumbUrl"
              :alt="`${item.title} 첨부 사진 ${imgIdx + 1}`"
              loading="lazy"
              decoding="async"
              class="fb-item-image-thumb"
              @error="handleThumbError($event, img.fullUrl)"
            />
          </button>
        </div>

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

    <!-- 첨부 사진 라이트박스 -->
    <Transition name="modal-fade">
      <div
        v-if="currentLightboxImage"
        class="fb-lightbox-overlay"
        v-backdrop-dismiss="closeLightbox"
      >
        <div class="fb-lightbox-card">
          <div class="fb-lightbox-header">
            <div class="fb-lightbox-title-wrap">
              <span class="fb-lightbox-title">{{ lightboxTitle }}</span>
              <span v-if="lightboxImages.length > 1" class="fb-lightbox-counter">
                {{ lightboxIndex + 1 }} / {{ lightboxImages.length }}
              </span>
            </div>
            <button type="button" class="fb-lightbox-close" @click="closeLightbox" title="닫기">✕</button>
          </div>

          <div class="fb-lightbox-stage">
            <button
              v-if="lightboxImages.length > 1"
              type="button"
              class="fb-lightbox-nav prev"
              title="이전 사진"
              @click.stop="stepLightbox(-1)"
            >‹</button>
            <img
              :src="currentLightboxImage.fullUrl"
              :alt="`${lightboxTitle} 사진 ${lightboxIndex + 1}`"
              class="fb-lightbox-img"
            />
            <button
              v-if="lightboxImages.length > 1"
              type="button"
              class="fb-lightbox-nav next"
              title="다음 사진"
              @click.stop="stepLightbox(1)"
            >›</button>
          </div>

          <div v-if="lightboxImages.length > 1" class="fb-lightbox-strip">
            <button
              v-for="(img, idx) in lightboxImages"
              :key="`lb-${img.key}`"
              type="button"
              class="fb-lightbox-strip-btn"
              :class="{ active: idx === lightboxIndex }"
              @click="lightboxIndex = idx"
            >
              <img :src="img.thumbUrl" :alt="`미리보기 ${idx + 1}`" @error="handleThumbError($event, img.fullUrl)" />
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.feedback-tab-container {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  box-sizing: border-box;
  font-size: 13.5px;
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
.fb-sub-hint {
  font-weight: 500;
  font-size: 11.5px;
  color: var(--text-dimmed, #64748b);
  margin-left: 4px;
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
  text-align: left;
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

/* 다중 사진 첨부 드롭존 & 미리보기 */
.fb-file-input-hidden {
  display: none;
}
.fb-photo-dropzone {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 13px 14px;
  border-radius: 8px;
  border: 1.5px dashed var(--border-color, #cbd5e1);
  background: var(--bg-card, #f8fafc);
  color: var(--text-dimmed, #64748b);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}
.fb-photo-dropzone:hover:not(.is-disabled),
.fb-photo-dropzone.is-dragover {
  border-color: #2563eb;
  background: rgba(37, 99, 235, 0.06);
  color: #2563eb;
}
.fb-photo-dropzone.is-disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
html.dark .fb-photo-dropzone {
  background: #27272a;
  border-color: #3f3f46;
  color: #a1a1aa;
}
html.dark .fb-photo-dropzone:hover:not(.is-disabled),
html.dark .fb-photo-dropzone.is-dragover {
  border-color: #60a5fa;
  background: rgba(59, 130, 246, 0.14);
  color: #93c5fd;
}
.fb-photo-icon {
  flex-shrink: 0;
}
.fb-photo-dropzone-text {
  line-height: 1.35;
}
.fb-upload-preview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
  gap: 8px;
  margin-top: 6px;
}
.fb-upload-preview-item {
  position: relative;
  aspect-ratio: 1 / 1;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border-color, #e2e8f0);
  background: var(--bg-card, #f8fafc);
}
html.dark .fb-upload-preview-item {
  border-color: #334155;
  background: #18181b;
}
.fb-upload-preview-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.fb-upload-order-badge {
  position: absolute;
  top: 4px;
  left: 4px;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.72);
  color: #ffffff;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.2;
}
.fb-upload-order-badge.is-cover {
  background: #2563eb;
}
.fb-upload-remove-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: none;
  background: rgba(220, 38, 38, 0.88);
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.fb-upload-remove-btn:hover {
  background: #dc2626;
}
.fb-upload-move-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  justify-content: space-between;
  background: linear-gradient(transparent, rgba(15, 23, 42, 0.72));
  padding: 6px 4px 3px;
}
.fb-upload-move-btn {
  width: 24px;
  height: 20px;
  border: none;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.22);
  color: #ffffff;
  font-size: 10px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.fb-upload-move-btn:disabled {
  opacity: 0.3;
  cursor: default;
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
  flex-wrap: wrap;
  gap: 6px;
}
.fb-cat-badge,
.fb-status-badge,
.fb-photo-count-badge {
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
}
.fb-photo-count-badge {
  background: rgba(139, 92, 246, 0.12);
  color: #7c3aed;
}
html.dark .fb-photo-count-badge {
  background: rgba(139, 92, 246, 0.22);
  color: #c4b5fd;
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

/* 카드 내 첨부 사진 썸네일 그리드 */
.fb-item-images-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  gap: 8px;
  margin-top: 4px;
}
.fb-item-image-thumb-btn {
  padding: 0;
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-card, #f8fafc);
  aspect-ratio: 4 / 3;
  cursor: zoom-in;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.fb-item-image-thumb-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.12);
}
html.dark .fb-item-image-thumb-btn {
  border-color: #3f3f46;
  background: #27272a;
}
.fb-item-image-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
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

/* 첨부 사진 라이트박스 모달 */
.fb-lightbox-overlay {
  position: fixed;
  inset: 0;
  z-index: 2800;
  background: rgba(10, 12, 18, 0.8);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  box-sizing: border-box;
}
.fb-lightbox-card {
  width: min(900px, 96vw);
  max-height: 92vh;
  background: var(--card-bg-color, #ffffff);
  color: var(--text-color, #0f172a);
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 14px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
}
html.dark .fb-lightbox-card {
  background: #18181b;
  color: #f4f4f5;
  border-color: #27272a;
}
.fb-lightbox-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color, #e2e8f0);
}
html.dark .fb-lightbox-header {
  border-bottom-color: #27272a;
}
.fb-lightbox-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.fb-lightbox-title {
  font-size: 14px;
  font-weight: 800;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fb-lightbox-counter {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(37, 99, 235, 0.14);
  color: #2563eb;
  font-size: 11.5px;
  font-weight: 700;
}
html.dark .fb-lightbox-counter {
  background: rgba(59, 130, 246, 0.22);
  color: #93c5fd;
}
.fb-lightbox-close {
  border: none;
  background: transparent;
  color: var(--text-dimmed, #64748b);
  font-size: 18px;
  cursor: pointer;
  padding: 2px 6px;
  line-height: 1;
}
.fb-lightbox-stage {
  position: relative;
  background: #0f1219;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 260px;
  max-height: 70vh;
  overflow: hidden;
}
.fb-lightbox-img {
  max-width: 100%;
  max-height: 70vh;
  width: auto;
  height: auto;
  object-fit: contain;
  display: block;
}
.fb-lightbox-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(15, 23, 42, 0.65);
  color: #ffffff;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 0 2px;
}
.fb-lightbox-nav.prev { left: 10px; }
.fb-lightbox-nav.next { right: 10px; }
.fb-lightbox-strip {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  overflow-x: auto;
  border-top: 1px solid var(--border-color, #e2e8f0);
}
html.dark .fb-lightbox-strip {
  border-top-color: #27272a;
}
.fb-lightbox-strip-btn {
  flex: 0 0 auto;
  width: 46px;
  height: 46px;
  padding: 0;
  border-radius: 6px;
  overflow: hidden;
  border: 2px solid transparent;
  background: transparent;
  opacity: 0.6;
  cursor: pointer;
}
.fb-lightbox-strip-btn.active {
  opacity: 1;
  border-color: #2563eb;
}
.fb-lightbox-strip-btn img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
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
  .fb-upload-preview-grid {
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }
  .fb-item-images-grid {
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }
}
</style>
