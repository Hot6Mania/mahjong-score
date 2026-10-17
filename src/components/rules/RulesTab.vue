<script setup lang="ts">
// 김케이 하우스 공식 룰북 탭 컴포넌트
</script>

<template>
  <div class="rules-tab-container">
    <!-- 상단 기본 규칙 & 점수 요약 카드 -->
    <div class="rules-hero-card">
      <div class="rules-hero-header">
        <div class="rules-hero-title-group">
          <h2 class="rules-main-title">기본 규칙</h2>
          <span class="rules-main-subtitle">김케이 하우스 대국 기본 수칙 및 점수 기준</span>
        </div>
      </div>

      <!-- 1등 / 4등 하우스 규칙 -->
      <div class="house-etiquette-grid">
        <div class="etiquette-box rank-first">
          <span class="etiquette-rank-badge r1">1등</span>
          <div class="etiquette-content">
            <span class="etiquette-title">노래 선곡</span>
          </div>
        </div>
        <div class="etiquette-box rank-fourth">
          <span class="etiquette-rank-badge r4">4등</span>
          <div class="etiquette-content">
            <span class="etiquette-title">휴식</span>
            <span class="etiquette-sub">(희망자 있으면 대체 가능)</span>
          </div>
        </div>
      </div>

      <!-- 핵심 점수 세팅 요약 바 -->
      <div class="score-summary-strip">
        <div class="score-summary-item">
          <span class="score-summary-label">시작점 / 반환점</span>
          <span class="score-summary-value">25,000 / 30,000</span>
        </div>
        <div class="score-summary-item">
          <span class="score-summary-label">우마</span>
          <span class="score-summary-value">10 - 20</span>
        </div>
        <div class="score-summary-item">
          <span class="score-summary-label">오카</span>
          <span class="score-summary-value">20,000</span>
        </div>
        <div class="score-summary-item">
          <span class="score-summary-label">본장</span>
          <span class="score-summary-value">300</span>
        </div>
      </div>
    </div>

    <!-- 세부 규정 카드 그리드 (1 ~ 9) -->
    <div class="rules-grid">
      <!-- 1) 점수 관련 -->
      <div class="rule-card">
        <div class="rule-card-header">
          <span class="rule-num-badge">1</span>
          <h3 class="rule-card-title">점수 관련</h3>
        </div>
        <div class="rule-list">
          <div class="rule-row">
            <span class="rule-label">시작점 / 반환점</span>
            <span class="rule-badge val">25,000 / 30,000</span>
          </div>
          <div class="rule-row">
            <span class="rule-label">우마 / 오카 / 본장</span>
            <span class="rule-badge val">10-20 / 20,000 / 300</span>
          </div>
          <div class="rule-row">
            <span class="rule-label">절상만관</span>
            <span class="rule-badge off">미적용</span>
          </div>
          <div class="rule-row">
            <span class="rule-label">연풍패 머리 부수</span>
            <span class="rule-badge val">4부</span>
          </div>
        </div>
      </div>

      <!-- 2) 리치 관련 -->
      <div class="rule-card">
        <div class="rule-card-header">
          <span class="rule-num-badge">2</span>
          <h3 class="rule-card-title">리치 관련</h3>
        </div>
        <div class="rule-list">
          <div class="rule-row">
            <span class="rule-label">쯔모 순 없는 리치</span>
            <span class="rule-badge off">없음</span>
          </div>
          <div class="rule-row">
            <span class="rule-label">오픈리치</span>
            <span class="rule-badge warn">시작 전 협의</span>
          </div>
        </div>
      </div>

      <!-- 3) 후로 관련 -->
      <div class="rule-card">
        <div class="rule-card-header">
          <span class="rule-num-badge">3</span>
          <h3 class="rule-card-title">후로 관련</h3>
        </div>
        <div class="rule-list">
          <div class="rule-row">
            <span class="rule-label">쿠이탕</span>
            <span class="rule-badge on">있음</span>
          </div>
          <div class="rule-row">
            <span class="rule-label">아토즈케</span>
            <span class="rule-badge on">있음</span>
          </div>
        </div>
      </div>

      <!-- 4) 도라 관련 -->
      <div class="rule-card">
        <div class="rule-card-header">
          <span class="rule-num-badge">4</span>
          <h3 class="rule-card-title">도라 관련</h3>
        </div>
        <div class="rule-list">
          <div class="rule-row rule-row-multiline">
            <div class="rule-row-top">
              <span class="rule-label">적도라</span>
              <span class="rule-badge on">사용</span>
            </div>
            <div class="rule-subnote">구성(종류/매수): 5만, 5통, 5삭 각 1매</div>
          </div>
          <div class="rule-row">
            <span class="rule-label">깡도라 공개 순서 (안깡, 가깡, 대명깡)</span>
            <span class="rule-badge val">깡 직후</span>
          </div>
        </div>
      </div>

      <!-- 5) 종료 조건(반장/장 종료 세부) -->
      <div class="rule-card">
        <div class="rule-card-header">
          <span class="rule-num-badge">5</span>
          <h3 class="rule-card-title">종료 조건 (반장/장 종료 세부)</h3>
        </div>
        <div class="rule-list">
          <div class="rule-row">
            <span class="rule-label">토비</span>
            <span class="rule-badge on">있음</span>
          </div>
          <div class="rule-row">
            <span class="rule-label">서입</span>
            <span class="rule-badge on">있음</span>
          </div>
          <div class="rule-row">
            <span class="rule-label">서입 후 종료 조건</span>
            <span class="rule-badge val">반환점 달성 즉시 종료</span>
          </div>
          <div class="rule-row">
            <span class="rule-label">아가리야메</span>
            <span class="rule-badge on">있음</span>
          </div>
          <div class="rule-row">
            <span class="rule-label">텐파이야메</span>
            <span class="rule-badge on">있음</span>
          </div>
        </div>
      </div>

      <!-- 6) 유국 관련 -->
      <div class="rule-card">
        <div class="rule-card-header">
          <span class="rule-num-badge">6</span>
          <h3 class="rule-card-title">유국 관련</h3>
        </div>
        <div class="rule-list">
          <div class="rule-row rule-row-multiline">
            <div class="rule-row-top">
              <span class="rule-label">도중 유국</span>
              <span class="rule-badge on">적용</span>
            </div>
            <div class="rule-subnote">구종구패, 사풍연타, 사깡유국, 사가리치 있음</div>
          </div>
          <div class="rule-row">
            <span class="rule-label">도중 유국 시 연장</span>
            <span class="rule-badge val">연장</span>
          </div>
          <div class="rule-row">
            <span class="rule-label">유국만관</span>
            <span class="rule-badge on">있음</span>
          </div>
          <div class="rule-row">
            <span class="rule-label">유국만관 시 화료</span>
            <span class="rule-badge val">축의</span>
          </div>
        </div>
      </div>

      <!-- 7) 복수 론 -->
      <div class="rule-card">
        <div class="rule-card-header">
          <span class="rule-num-badge">7</span>
          <h3 class="rule-card-title">복수 론</h3>
        </div>
        <div class="rule-list">
          <div class="rule-row">
            <span class="rule-label">아타마하네</span>
            <span class="rule-badge off">미적용</span>
          </div>
          <div class="rule-row">
            <span class="rule-label">더블론 · 트리플론</span>
            <span class="rule-badge on">허용</span>
          </div>
        </div>
      </div>

      <!-- 8) 역만 -->
      <div class="rule-card rule-card-yakuman">
        <div class="rule-card-header">
          <span class="rule-num-badge">8</span>
          <h3 class="rule-card-title">역만</h3>
        </div>
        <div class="rule-list rule-list-two-col">
          <div class="rule-row">
            <span class="rule-label">복합 역만</span>
            <span class="rule-badge on">있음</span>
          </div>
          <div class="rule-row">
            <span class="rule-label">책임지불</span>
            <span class="rule-badge on">있음</span>
          </div>
          <div class="rule-row rule-row-multiline rule-col-span-full">
            <div class="rule-row-top">
              <span class="rule-label">더블 역만</span>
              <span class="rule-badge on">있음</span>
            </div>
            <div class="rule-subnote">* 대기형태(국사무쌍13면, 스안커 단기, 순정구련보등)에 따른 더블역만 있음</div>
          </div>
          <div class="rule-row">
            <span class="rule-label">헤아림 역만</span>
            <span class="rule-badge on">있음</span>
          </div>
          <div class="rule-row">
            <span class="rule-label">국사무쌍 안깡 창깡</span>
            <span class="rule-badge on">가능</span>
          </div>
          <div class="rule-row">
            <span class="rule-label">녹일색</span>
            <span class="rule-badge val">발(発) 불필요</span>
          </div>
          <div class="rule-row">
            <span class="rule-label">구련보등 수패</span>
            <span class="rule-badge val">제한없음</span>
          </div>
          <div class="rule-row">
            <span class="rule-label">인화</span>
            <span class="rule-badge on">역만 인정</span>
          </div>
          <div class="rule-row">
            <span class="rule-label">8연장</span>
            <span class="rule-badge off">없음</span>
          </div>
          <div class="rule-row rule-col-span-full">
            <span class="rule-label">기타 인정 역만</span>
            <span class="rule-badge off">없음</span>
          </div>
        </div>
      </div>

      <!-- 9) 동점 처리 -->
      <div class="rule-card">
        <div class="rule-card-header">
          <span class="rule-num-badge">9</span>
          <h3 class="rule-card-title">동점 처리</h3>
        </div>
        <div class="rule-list">
          <div class="rule-row">
            <span class="rule-label">동점자 순위 결정 기준</span>
            <span class="rule-badge val">석순</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 10) 제재(촌보 · 화료불가 · 벌점 · 경고) 관련사항 -->
    <div class="rule-card rule-penalty-section">
      <div class="rule-card-header">
        <span class="rule-num-badge penalty-num">10</span>
        <h3 class="rule-card-title">제재 (촌보 · 화료불가 · 벌점 · 경고) 관련사항</h3>
      </div>

      <div class="penalty-cards-grid">
        <!-- 촌보 사항 -->
        <div class="penalty-box penalty-chombo">
          <div class="penalty-box-header">
            <span class="penalty-title">촌보 사항</span>
            <span class="penalty-tag tag-danger">3000 ALL</span>
          </div>
          <ul class="penalty-items">
            <li>쯔모, 론 오발성 후 손패 공개</li>
            <li>노텐 리치 후 유국</li>
            <li>리치 후 부정한 안깡 (발각 시)</li>
            <li>쿠이카에 발각 시</li>
            <li>벌부 2회 누적</li>
            <li>기타 경기 속행 불가능 수준 반칙</li>
          </ul>
        </div>

        <!-- 화료불가 사항 -->
        <div class="penalty-box penalty-deadhand">
          <div class="penalty-box-header">
            <span class="penalty-title">화료불가 사항</span>
            <span class="penalty-tag tag-warning">이후 리치/후로 금지 · 유국 시 노텐</span>
          </div>
          <ul class="penalty-items">
            <li>다패, 소패</li>
            <li>쯔모, 론 오발성 후 손패 미공개</li>
          </ul>
        </div>

        <!-- 벌부 -->
        <div class="penalty-box penalty-fine">
          <div class="penalty-box-header">
            <span class="penalty-title">벌부</span>
            <span class="penalty-tag tag-info">1000점</span>
          </div>
          <ul class="penalty-items">
            <li>오발성 1회 벌부 (치, 퐁, 깡, 리치)</li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rules-tab-container {
  display: flex;
  flex-direction: column;
  gap: 18px;
  width: 100%;
  box-sizing: border-box;
}

/* 상단 기본 규칙 카드 */
.rules-hero-card {
  background: var(--card-bg-color, #ffffff);
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.rules-hero-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}

.rules-hero-title-group {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.rules-main-title {
  margin: 0;
  font-size: 17px;
  font-weight: 800;
  color: var(--text-color, #0f172a);
  letter-spacing: -0.02em;
}

.rules-main-subtitle {
  font-size: 12px;
  color: var(--text-dimmed, #64748b);
}

/* 1등 / 4등 수칙 그리드 */
.house-etiquette-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  margin-bottom: 14px;
}

@media (max-width: 640px) {
  .house-etiquette-grid {
    grid-template-columns: 1fr;
  }
}

.etiquette-box {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px solid var(--border-color, #e2e8f0);
  background: var(--bg-color, #f8fafc);
}

html.dark .etiquette-box {
  background: rgba(255, 255, 255, 0.03);
  border-color: rgba(255, 255, 255, 0.1);
}

.etiquette-box.rank-first {
  border-left: 4px solid #10b981;
}

.etiquette-box.rank-fourth {
  border-left: 4px solid #ef4444;
}

.etiquette-rank-badge {
  font-size: 12px;
  font-weight: 800;
  padding: 4px 10px;
  border-radius: 6px;
  white-space: nowrap;
}

.etiquette-rank-badge.r1 {
  background: rgba(16, 185, 129, 0.14);
  color: #059669;
}

html.dark .etiquette-rank-badge.r1 {
  background: rgba(16, 185, 129, 0.22);
  color: #34d399;
}

.etiquette-rank-badge.r4 {
  background: rgba(239, 68, 68, 0.14);
  color: #dc2626;
}

html.dark .etiquette-rank-badge.r4 {
  background: rgba(239, 68, 68, 0.22);
  color: #f87171;
}

.etiquette-content {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
}

.etiquette-title {
  font-size: 14.5px;
  font-weight: 800;
  color: var(--text-color, #0f172a);
}

.etiquette-sub {
  font-size: 12px;
  color: var(--text-dimmed, #64748b);
  font-weight: 600;
}

/* 핵심 점수 요약 바 */
.score-summary-strip {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

@media (max-width: 640px) {
  .score-summary-strip {
    grid-template-columns: repeat(2, 1fr);
  }
}

.score-summary-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: var(--bg-color, #f8fafc);
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 8px;
  padding: 10px 8px;
  text-align: center;
  gap: 4px;
}

html.dark .score-summary-item {
  background-color: rgba(255, 255, 255, 0.025);
  border-color: rgba(255, 255, 255, 0.08);
}

.score-summary-label {
  font-size: 11.5px;
  color: var(--text-dimmed, #64748b);
  font-weight: 600;
}

.score-summary-value {
  font-size: 15px;
  font-weight: 800;
  color: var(--text-color, #0f172a);
}

/* 세부 규정 카드 그리드 */
.rules-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

@media (max-width: 768px) {
  .rules-grid {
    grid-template-columns: 1fr;
  }
}

.rule-card {
  background: var(--card-bg-color, #ffffff);
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 12px;
  padding: 18px 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  display: flex;
  flex-direction: column;
}

.rule-card-yakuman {
  grid-row: span 2;
}

@media (max-width: 768px) {
  .rule-card-yakuman {
    grid-row: auto;
  }
}

.rule-card-header {
  display: flex;
  align-items: center;
  gap: 9px;
  padding-bottom: 11px;
  margin-bottom: 10px;
  border-bottom: 1px solid var(--border-color, #e2e8f0);
}

.rule-num-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  font-size: 11.5px;
  font-weight: 800;
  border-radius: 6px;
  background: rgba(37, 99, 235, 0.12);
  color: #2563eb;
}

html.dark .rule-num-badge {
  background: rgba(96, 165, 250, 0.2);
  color: #93c5fd;
}

.rule-num-badge.penalty-num {
  background: rgba(220, 38, 38, 0.12);
  color: #dc2626;
}

html.dark .rule-num-badge.penalty-num {
  background: rgba(248, 113, 113, 0.2);
  color: #fca5a5;
}

.rule-card-title {
  margin: 0;
  font-size: 15px;
  font-weight: 800;
  color: var(--text-color, #0f172a);
}

.rule-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rule-list-two-col {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px 12px;
}

.rule-col-span-full {
  grid-column: 1 / -1;
}

@media (max-width: 640px) {
  .rule-list-two-col {
    grid-template-columns: 1fr;
  }
}

.rule-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 7px;
  background: var(--bg-color, #f8fafc);
  border: 1px solid var(--border-color, #e2e8f0);
  font-size: 13px;
}

html.dark .rule-row {
  background: rgba(255, 255, 255, 0.025);
  border-color: rgba(255, 255, 255, 0.07);
}

.rule-row-multiline {
  flex-direction: column;
  align-items: stretch;
  gap: 5px;
}

.rule-row-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.rule-label {
  font-weight: 700;
  color: var(--text-color, #1e293b);
  word-break: keep-all;
}

.rule-subnote {
  font-size: 11.5px;
  color: var(--text-dimmed, #64748b);
  line-height: 1.45;
  padding-top: 2px;
  border-top: 1px dashed var(--border-color, #e2e8f0);
}

html.dark .rule-subnote {
  border-top-color: rgba(255, 255, 255, 0.1);
  color: #94a3b8;
}

/* 상태 배지 */
.rule-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 800;
  padding: 3px 9px;
  border-radius: 5px;
  white-space: nowrap;
}

.rule-badge.on {
  background: rgba(16, 185, 129, 0.13);
  color: #059669;
}

html.dark .rule-badge.on {
  background: rgba(16, 185, 129, 0.2);
  color: #34d399;
}

.rule-badge.off {
  background: rgba(100, 116, 139, 0.13);
  color: #475569;
}

html.dark .rule-badge.off {
  background: rgba(148, 163, 184, 0.16);
  color: #94a3b8;
}

.rule-badge.val {
  background: rgba(37, 99, 235, 0.11);
  color: #2563eb;
}

html.dark .rule-badge.val {
  background: rgba(96, 165, 250, 0.18);
  color: #60a5fa;
}

.rule-badge.warn {
  background: rgba(245, 158, 11, 0.14);
  color: #d97706;
}

html.dark .rule-badge.warn {
  background: rgba(245, 158, 11, 0.22);
  color: #fbbf24;
}

/* 10) 제재 관련사항 섹션 */
.penalty-cards-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}

@media (max-width: 900px) {
  .penalty-cards-grid {
    grid-template-columns: 1fr;
  }
}

.penalty-box {
  background: var(--bg-color, #f8fafc);
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 10px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

html.dark .penalty-box {
  background: rgba(255, 255, 255, 0.025);
  border-color: rgba(255, 255, 255, 0.08);
}

.penalty-box.penalty-chombo {
  border-top: 3px solid #ef4444;
}

.penalty-box.penalty-deadhand {
  border-top: 3px solid #f59e0b;
}

.penalty-box.penalty-fine {
  border-top: 3px solid #3b82f6;
}

.penalty-box-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-color, #e2e8f0);
}

html.dark .penalty-box-header {
  border-bottom-color: rgba(255, 255, 255, 0.08);
}

.penalty-title {
  font-size: 14px;
  font-weight: 800;
  color: var(--text-color, #0f172a);
}

.penalty-tag {
  font-size: 11px;
  font-weight: 800;
  padding: 2.5px 8px;
  border-radius: 4px;
}

.penalty-tag.tag-danger {
  background: rgba(239, 68, 68, 0.13);
  color: #dc2626;
}

html.dark .penalty-tag.tag-danger {
  background: rgba(239, 68, 68, 0.22);
  color: #f87171;
}

.penalty-tag.tag-warning {
  background: rgba(245, 158, 11, 0.14);
  color: #d97706;
}

html.dark .penalty-tag.tag-warning {
  background: rgba(245, 158, 11, 0.22);
  color: #fbbf24;
}

.penalty-tag.tag-info {
  background: rgba(37, 99, 235, 0.12);
  color: #2563eb;
}

html.dark .penalty-tag.tag-info {
  background: rgba(96, 165, 250, 0.2);
  color: #60a5fa;
}

.penalty-items {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--text-color, #334155);
  line-height: 1.5;
}

.penalty-items li {
  word-break: keep-all;
}
</style>
