<script setup lang="ts">
import { ref, onMounted } from "vue"

const props = defineProps<{
  googleInfo?: {
    syncMode: string;
    isLoggedIn: boolean;
    spreadsheetId: string;
    todayMembers?: string[];
  }
}>()

type Emits = {
  (e: 'show-modal', type: string, status?: string): void
  (e: 'add-backup-game-to-current', game: any): void
  (e: 'restore-session-backup', backup: any): void
  (e: 'manual-backup-session'): void
}
const emit = defineEmits<Emits>()

const activeArchiveTab = ref<'games' | 'migration'>('games')
const backupHistory = ref<any[]>([])
const migrationBackups = ref<any[]>([])

const loadBackup = () => {
  try {
    const raw = localStorage.getItem("permanent_games_history") || "[]"
    // 최신 대국이 위에 오도록 정렬
    backupHistory.value = JSON.parse(raw).reverse()
  } catch (e) {
    console.error("대국 백업 로드 실패:", e)
  }
}

const loadMigrationBackups = () => {
  try {
    const raw = localStorage.getItem("session_migration_backups") || "[]"
    migrationBackups.value = JSON.parse(raw)
  } catch (e) {
    console.error("마이그레이션 백업 로드 실패:", e)
  }
}

onMounted(() => {
  loadBackup()
  loadMigrationBackups()
})

const formatDate = (isoString: string) => {
  try {
    return new Date(isoString).toLocaleString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch (e) {
    return isoString
  }
}

const getPlayerClass = (rank: number) => {
  if (rank === 1) return 'rank_first'
  if (rank === 4) return 'rank_fourth'
  return ''
}

const restoreGame = (game: any) => {
  if (confirm("이 대국 기록을 현재 세션(오늘 회차)의 맨 뒤에 추가하시겠습니까?")) {
    emit('add-backup-game-to-current', game)
  }
}

const deleteGame = (indexInBackup: number) => {
  if (confirm("이 대국을 영구 백업 보관소에서 삭제하시겠습니까?\n(로컬 저장소에서 지워집니다.)")) {
    try {
      const raw = localStorage.getItem("permanent_games_history") || "[]"
      const list = JSON.parse(raw)
      const originalIdx = list.length - 1 - indexInBackup
      if (originalIdx >= 0 && originalIdx < list.length) {
        list.splice(originalIdx, 1)
        localStorage.setItem("permanent_games_history", JSON.stringify(list))
        loadBackup()
      }
    } catch (e) {
      console.error("백업 삭제 실패:", e)
    }
  }
}

const handleRestoreMigration = (backup: any) => {
  emit('restore-session-backup', backup)
}

const handleDeleteMigration = (index: number) => {
  if (confirm("이 마이그레이션 백업 기록을 로컬 목록에서 삭제하시겠습니까?\n(구글 시트에 생성된 백업 시트는 유지됩니다.)")) {
    migrationBackups.value.splice(index, 1)
    localStorage.setItem("session_migration_backups", JSON.stringify(migrationBackups.value))
  }
}

const handleManualBackup = () => {
  emit('manual-backup-session')
  setTimeout(loadMigrationBackups, 1200)
}
</script>

<template>
<div class="container_backup_archive">
  <h3 class="title">백업 & 복원 보관소</h3>

  <!-- 탭 전환기 -->
  <div class="archive_tabs">
    <button 
      class="archive_tab_btn" 
      :class="{ active: activeArchiveTab === 'games' }" 
      @click="activeArchiveTab = 'games'"
    >
      대국별 백업 (최근 50판)
    </button>
    <button 
      class="archive_tab_btn" 
      :class="{ active: activeArchiveTab === 'migration' }" 
      @click="activeArchiveTab = 'migration'; loadMigrationBackups()"
    >
      시트 마이그레이션 & 백업
    </button>
  </div>
  
  <!-- TAB 1: 대국별 백업 -->
  <div v-if="activeArchiveTab === 'games'" class="archive_tab_content">
    <p class="description">
      최근 대국 결과가 최대 50판까지 로컬에 자동 보관됩니다.<br>
      기록 유실 시 원하는 대국을 <strong>[현재 회차에 추가]</strong>하여 복구할 수 있습니다.
    </p>

    <div class="backup_list">
      <div v-for="(game, idx) in backupHistory" :key="idx" class="backup_card">
        <div class="card_header">
          <span class="card_date">{{ formatDate(game.timestamp) }}</span>
          <span class="card_type" :class="{ manual_tag: game.isManual }">
            {{ game.isManual ? '수동 입력' : '일반 기록' }}
          </span>
        </div>

        <div class="card_results">
          <div 
            v-for="r in [...game.results].sort((a, b) => a.rank - b.rank)" 
            :key="r.name" 
            class="result_row"
            :class="getPlayerClass(r.rank)"
          >
            <span class="result_rank">{{ r.rank }}위</span>
            <span class="result_name">{{ r.name }}</span>
            <span class="result_score">{{ r.score.toLocaleString() }}점</span>
            <span class="result_uma" :class="{ positive: r.uma > 0, negative: r.uma < 0 }">
              {{ r.uma > 0 ? '+' : '' }}{{ r.uma }}
            </span>
          </div>
        </div>

        <div class="card_actions">
          <button class="btn_restore" @click="restoreGame(game)">현재 회차에 추가</button>
          <button class="btn_delete" @click="deleteGame(idx)">삭제</button>
        </div>
      </div>

      <div v-if="backupHistory.length === 0" class="empty_message">
        백업 보관소에 저장된 대국 기록이 없습니다.
      </div>
    </div>
  </div>

  <!-- TAB 2: 시트 마이그레이션 백업 & 복원 -->
  <div v-else class="archive_tab_content">
    <div class="migration_toolbar">
      <p class="description" style="margin-bottom: 0; flex: 1;">
        멤버 추가/삭제 시 자동 생성된 시트 백업 목록입니다.<br>
        실수 시 언제든지 원하는 시점으로 <strong>[이 시트 복원]</strong>할 수 있습니다.
      </p>
      <button 
        v-if="props.googleInfo?.isLoggedIn && props.googleInfo?.spreadsheetId" 
        class="btn_manual_backup" 
        @click="handleManualBackup"
        title="현재 세션 시트 수동 백업 생성"
      >
        현재 시트 수동 백업
      </button>
    </div>

    <div class="backup_list">
      <div v-for="(bak, idx) in migrationBackups" :key="bak.id || idx" class="backup_card migration_card">
        <div class="card_header">
          <span class="card_date">{{ bak.timeStr }}</span>
          <span class="card_type migration_tag">{{ bak.backupSheetTitle }}</span>
        </div>

        <div class="migration_body">
          <div class="migration_row">
            <span class="migration_label">멤버 변경:</span>
            <span class="migration_val">
              {{ bak.oldMembers.length }}명 ({{ bak.oldMembers.join(', ') }})
              ➔ {{ bak.newMembers.length }}명 ({{ bak.newMembers.join(', ') }})
            </span>
          </div>
          <div class="migration_row">
            <span class="migration_label">진행 대국:</span>
            <span class="migration_val">{{ bak.gamesCount }}전 완료 시점</span>
          </div>
        </div>

        <div class="card_actions">
          <button 
            v-if="props.googleInfo?.isLoggedIn" 
            class="btn_restore" 
            @click="handleRestoreMigration(bak)"
          >
            이 시트 복원
          </button>
          <button class="btn_delete" @click="handleDeleteMigration(idx)">삭제</button>
        </div>
      </div>

      <div v-if="migrationBackups.length === 0" class="empty_message">
        저장된 시트 마이그레이션 백업 이력이 없습니다.
      </div>
    </div>
  </div>

  <div class="footer_actions">
    <button class="btn_close" @click="emit('show-modal', 'total_uma')">닫기 (총 우마로)</button>
  </div>
</div>
</template>

<style scoped>
.container_backup_archive {
  width: 100%;
  max-width: 600px;
  display: flex;
  flex-direction: column;
  color: var(--text-color);
  font-family: inherit;
  box-sizing: border-box;
}

.title {
  font-size: 18px;
  margin-top: 0;
  margin-bottom: 10px;
  text-align: center;
  font-weight: bold;
}

.description {
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--text-dimmed);
  margin-bottom: 15px;
  background: rgba(255, 255, 255, 0.02);
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
}

.backup_list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 380px;
  overflow-y: auto;
  margin-bottom: 20px;
  padding-right: 4px;
}

.backup_card {
  background-color: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.05);
}

.card_header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px dashed var(--border-color);
  padding-bottom: 6px;
}

.card_date {
  font-size: 11.5px;
  font-weight: bold;
  color: var(--text-dimmed);
}

.card_type {
  font-size: 9.5px;
  font-weight: bold;
  padding: 2px 6px;
  border-radius: 4px;
  background-color: rgba(255,255,255,0.05);
  border: 1px solid var(--border-color);
}

.manual_tag {
  background-color: rgba(255, 152, 0, 0.1) !important;
  color: #ff9800;
  border-color: rgba(255, 152, 0, 0.3) !important;
}

.card_results {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
}

.result_row {
  display: flex;
  align-items: center;
  font-size: 11px;
  padding: 4px 6px;
  background-color: rgba(255,255,255,0.01);
  border-radius: 4px;
  border: 1px solid transparent;
}

.rank_first {
  background-color: rgba(239, 68, 68, 0.04);
  border-color: rgba(239, 68, 68, 0.1);
}

.rank_fourth {
  background-color: rgba(255, 255, 255, 0.02);
}

.result_rank {
  font-weight: bold;
  margin-right: 6px;
  min-width: 24px;
}

.result_name {
  flex: 1;
  font-weight: bold;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result_score {
  margin-right: 8px;
  opacity: 0.8;
}

.result_uma {
  font-weight: bold;
  min-width: 32px;
  text-align: right;
}

.positive { color: var(--color-positive); }
.negative { color: var(--color-negative); }

.card_actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  border-top: 1px dashed var(--border-color);
  padding-top: 6px;
}

.card_actions button {
  padding: 4px 10px;
  font-size: 10.5px;
  font-weight: bold;
  border-radius: 4px;
  border: none;
  cursor: pointer;
}

.btn_restore {
  background-color: var(--color-toggle-on);
  color: #fff;
}

.btn_delete {
  background-color: transparent;
  color: var(--color-negative);
  border: 1px solid var(--color-negative) !important;
}

.empty_message {
  text-align: center;
  color: var(--text-dimmed);
  padding: 30px 10px;
  font-size: 13px;
}

.footer_actions {
  display: flex;
  justify-content: center;
}

.btn_close {
  background-color: var(--color-disabled);
  color: #fff;
  padding: 8px 24px;
  font-size: 13px;
  font-weight: bold;
  border-radius: 4px;
  border: none;
  cursor: pointer;
}

/* 탭 전환 버튼 */
.archive_tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 4px;
}

.archive_tab_btn {
  flex: 1;
  padding: 7px 12px;
  font-size: 12px;
  font-weight: bold;
  background: transparent;
  color: var(--text-dimmed);
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: all 0.2s;
}

.archive_tab_btn.active {
  color: var(--color-toggle-on, #10b981);
  border-bottom-color: var(--color-toggle-on, #10b981);
}

.migration_toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.btn_manual_backup {
  background: var(--color-btn, #3b82f6);
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 11.5px;
  font-weight: bold;
  cursor: pointer;
  white-space: nowrap;
  transition: opacity 0.2s;
}

.btn_manual_backup:hover {
  opacity: 0.9;
}

.migration_card {
  border-left: 3px solid #3b82f6;
}

.migration_tag {
  background: rgba(59, 130, 246, 0.1) !important;
  color: #3b82f6 !important;
  border-color: rgba(59, 130, 246, 0.3) !important;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.migration_body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11.5px;
  padding: 4px 2px;
}

.migration_row {
  display: flex;
  gap: 6px;
  align-items: baseline;
}

.migration_label {
  font-weight: bold;
  color: var(--text-dimmed);
  min-width: 55px;
  font-size: 11px;
}

.migration_val {
  font-weight: 500;
  word-break: break-all;
}

@media (max-height: 500px) {
  .backup_list {
    max-height: 140px;
    margin-bottom: 10px;
  }
  .description {
    margin-bottom: 8px;
    padding: 6px 10px;
    font-size: 10.5px;
  }
  .backup_card {
    padding: 6px 10px;
    gap: 4px;
  }
  .card_results {
    gap: 4px;
  }
  .title {
    margin-bottom: 6px;
    font-size: 16px;
  }
  .btn_close {
    padding: 6px 20px;
    font-size: 11.5px;
  }
}
</style>
