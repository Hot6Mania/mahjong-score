<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import {
  EVENT_PLAYER_MAP,
  EVENT_TEAM_MAP,
  formatEventPlayerName,
  type EventMatchSlot,
  type EventNameLocale,
  type EventScoringConfig,
} from '@/data/knuNpm2026';
import {
  calculateTableScoring,
  formatSignedPoint,
  type StoredTableResult,
  type TableScoreEntryInput,
} from '@/utils/knuNpmScoring';

interface Props {
  slot: EventMatchSlot;
  config: EventScoringConfig;
  existingResult?: StoredTableResult | null;
  isStaff: boolean;
  isSubmitting?: boolean;
  eventLocale: EventNameLocale;
  tr: (key: string, params?: Record<string, string | number>) => string;
}
const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'close'): void;
  (
    e: 'submit',
    payload: {
      entries: TableScoreEntryInput[];
      riichiSticks: number;
      submittedBy: string;
      note: string;
      allowScoreSumMismatch: boolean;
    }
  ): void;
  (e: 'delete'): void;
}>();

interface EditableRow {
  playerId: number;
  scoreInput: number | null;
  penalty: number;
  seatIndex: number;
}

const shortInputMode = ref(false); // true => ×100 mode (e.g. 324 -> 32400)
const rows = ref<EditableRow[]>([]);
const riichiSticks = ref<number>(0);
const submittedBy = ref('');
const note = ref('');
const allowSumMismatch = ref(false);
const validationError = ref('');

const winds = ['東', '南', '西', '北'];

const initForm = () => {
  validationError.value = '';
  allowSumMismatch.value = false;
  if (props.existingResult && props.existingResult.entries.length === 4) {
    const ordered = [...props.existingResult.entries].sort(
      (a, b) => (a.seatIndex ?? 0) - (b.seatIndex ?? 0)
    );
    rows.value = ordered.map((e, idx) => ({
      playerId: e.playerId,
      scoreInput: shortInputMode.value ? Math.round(e.rawScore / 100) : e.rawScore,
      penalty: Number(e.penalty || 0),
      seatIndex: e.seatIndex !== undefined ? e.seatIndex : idx,
    }));
    riichiSticks.value = Math.max(0, Math.floor(Number(props.existingResult.riichiSticks || 0)));
    submittedBy.value = props.existingResult.submittedBy || '';
    note.value = props.existingResult.note || '';
  } else {
    rows.value = props.slot.playerIds.map((pid, idx) => ({
      playerId: pid,
      scoreInput: null,
      penalty: 0,
      seatIndex: idx,
    }));
    riichiSticks.value = 0;
    submittedBy.value = '';
    note.value = '';
  }
};

watch(
  () => [props.slot.key, props.existingResult?.submittedAt],
  () => initForm(),
  { immediate: true }
);

const toggleInputMode = (toShort: boolean) => {
  if (shortInputMode.value === toShort) return;
  rows.value.forEach((r) => {
    if (r.scoreInput !== null && !Number.isNaN(Number(r.scoreInput))) {
      r.scoreInput = toShort
        ? Math.round(Number(r.scoreInput) / 100)
        : Math.round(Number(r.scoreInput) * 100);
    }
  });
  shortInputMode.value = toShort;
};

const toRawScore = (val: number | null): number => {
  if (val === null || val === undefined || Number.isNaN(Number(val))) return 0;
  return shortInputMode.value ? Math.round(Number(val) * 100) : Math.round(Number(val));
};

const previewEntries = computed<TableScoreEntryInput[]>(() =>
  rows.value.map((r, idx) => ({
    playerId: r.playerId,
    rawScore: toRawScore(r.scoreInput),
    penalty: Number(r.penalty || 0),
    seatIndex: idx,
  }))
);

const normalizedRiichiSticks = computed(() =>
  Math.max(0, Math.floor(Number(riichiSticks.value) || 0))
);

const previewCalc = computed(() =>
  calculateTableScoring(previewEntries.value, props.config, normalizedRiichiSticks.value)
);

const suggestedRiichiSticks = computed(() => {
  if (filledCount.value !== 4) return 0;
  const deficit = previewCalc.value.expectedSum - previewCalc.value.scoreSum;
  if (deficit > 0 && deficit % 1000 === 0 && deficit / 1000 !== normalizedRiichiSticks.value) {
    return deficit / 1000;
  }
  return 0;
});

const adjustRiichiSticks = (delta: number) => {
  riichiSticks.value = Math.max(0, normalizedRiichiSticks.value + delta);
};

const applySuggestedRiichi = () => {
  if (suggestedRiichiSticks.value > 0) {
    riichiSticks.value = suggestedRiichiSticks.value;
  }
};

const filledCount = computed(
  () => rows.value.filter((r) => r.scoreInput !== null && r.scoreInput !== ('' as any) && !Number.isNaN(Number(r.scoreInput))).length
);

const canAutoFill = computed(() => filledCount.value === 3);

const autoFillFourth = () => {
  const emptyIdx = rows.value.findIndex(
    (r) => r.scoreInput === null || r.scoreInput === ('' as any) || Number.isNaN(Number(r.scoreInput))
  );
  if (emptyIdx === -1) return;
  const expected = props.config.startingScore * 4 - normalizedRiichiSticks.value * 1000;
  let othersSum = 0;
  rows.value.forEach((r, idx) => {
    if (idx !== emptyIdx) othersSum += toRawScore(r.scoreInput);
  });
  const rem = expected - othersSum;
  rows.value[emptyIdx].scoreInput = shortInputMode.value ? Math.round(rem / 100) : rem;
};

const moveRow = (idx: number, delta: number) => {
  const target = idx + delta;
  if (target < 0 || target >= 4) return;
  const arr = [...rows.value];
  const tmp = arr[idx];
  arr[idx] = arr[target];
  arr[target] = tmp;
  arr.forEach((r, i) => (r.seatIndex = i));
  rows.value = arr;
};

const toggleChombo = (idx: number) => {
  const pen = Math.abs(props.config.chomboPenalty || 20);
  rows.value[idx].penalty = rows.value[idx].penalty === 0 ? -pen : 0;
};

const handleSubmit = () => {
  validationError.value = '';
  if (filledCount.value < 4) {
    validationError.value = 'Please enter scores for all 4 players.';
    return;
  }
  if (previewCalc.value.scoreDiff !== 0 && !allowSumMismatch.value) {
    validationError.value = props.tr('scoreSumDiff', {
      diff: (previewCalc.value.scoreDiff > 0 ? '+' : '') + previewCalc.value.scoreDiff.toLocaleString(),
      expected: previewCalc.value.expectedSum.toLocaleString(),
    });
    return;
  }
  emit('submit', {
    entries: previewEntries.value,
    riichiSticks: normalizedRiichiSticks.value,
    submittedBy: submittedBy.value.trim(),
    note: note.value.trim(),
    allowScoreSumMismatch: allowSumMismatch.value,
  });
};

const handleDelete = () => {
  if (confirm(props.tr('confirmDeleteResult', { r: props.slot.round, t: props.slot.table }))) {
    emit('delete');
  }
};
</script>

<template>
  <div class="ev-modal-backdrop" @click.self="emit('close')">
    <div class="ev-modal-card score-modal-card">
      <div class="ev-modal-header">
        <div>
          <div class="title-row">
            <h3 class="ev-modal-title">{{ tr('scoreModalTitle', { r: slot.round, t: slot.table }) }}</h3>
            <span v-if="slot.isJpC" class="jpc-badge">JP-C</span>
          </div>
          <p class="ev-modal-sub">
            {{ slot.isJpC ? tr('scoreModalJpCHint') : tr('scoreModalGeneralHint') }}
          </p>
        </div>
        <button class="ev-icon-close" @click="emit('close')" aria-label="Close">✕</button>
      </div>

      <div class="score-modal-body">
        <div v-if="existingResult" class="overwrite-banner">
          ⚠️ {{ tr('scoreModalOverwriteWarn', { source: existingResult.source === 'scorer' ? tr('sourceScorer') : tr('sourceManual') }) }}
        </div>

        <div class="toolbar-row">
          <div class="mode-toggle">
            <button
              type="button"
              class="mode-btn"
              :class="{ active: !shortInputMode }"
              @click="toggleInputMode(false)"
            >
              {{ tr('scoreInputModeFull') }}
            </button>
            <button
              type="button"
              class="mode-btn"
              :class="{ active: shortInputMode }"
              @click="toggleInputMode(true)"
            >
              {{ tr('scoreInputModeShort') }}
            </button>
          </div>
          <button
            type="button"
            class="btn-autofill"
            :disabled="!canAutoFill"
            @click="autoFillFourth"
          >
            ✨ {{ tr('autoFillRemaining') }}
          </button>
        </div>

        <div class="score-table-wrap">
          <table class="score-entry-table">
            <thead>
              <tr>
                <th>{{ tr('resultSheet.wind') === 'resultSheet.wind' ? 'Seat' : '東南' }}</th>
                <th>{{ tr('player') }}</th>
                <th>{{ tr('rawScoreCol') }}</th>
                <th>{{ tr('penaltyCol') }}</th>
                <th>{{ tr('previewRankCol') }}</th>
                <th>{{ tr('previewPtCol') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, idx) in rows" :key="row.playerId">
                <td class="col-seat">
                  <div class="seat-ctrl">
                    <span class="wind-badge" :class="`w-${idx}`">{{ winds[idx] }}</span>
                    <div class="mini-arrows">
                      <button type="button" :disabled="idx === 0" @click="moveRow(idx, -1)">▲</button>
                      <button type="button" :disabled="idx === 3" @click="moveRow(idx, 1)">▼</button>
                    </div>
                  </div>
                </td>
                <td class="col-player">
                  <div class="player-cell">
                    <span
                      class="team-pill"
                      :style="{
                        color: EVENT_TEAM_MAP[EVENT_PLAYER_MAP[row.playerId].teamId].color,
                        backgroundColor: EVENT_TEAM_MAP[EVENT_PLAYER_MAP[row.playerId].teamId].bgTint,
                      }"
                    >
                      {{ EVENT_PLAYER_MAP[row.playerId].teamId }}
                    </span>
                    <span class="p-id">#{{ row.playerId }}</span>
                    <span class="p-name">{{ formatEventPlayerName(EVENT_PLAYER_MAP[row.playerId], eventLocale, 'full') }}</span>
                    <span v-if="EVENT_PLAYER_MAP[row.playerId].isPro" class="pro-tag">{{ tr('proBadge') }}</span>
                  </div>
                </td>
                <td class="col-input">
                  <div class="score-input-wrap">
                    <input
                      type="number"
                      inputmode="numeric"
                      v-model.number="row.scoreInput"
                      :step="shortInputMode ? 1 : 100"
                      :placeholder="shortInputMode ? '250' : '25000'"
                      class="score-num-input"
                    />
                    <span v-if="shortInputMode" class="unit-suffix">00</span>
                  </div>
                  <div v-if="filledCount > 0 && previewCalc.entries[idx].riichiBonus > 0" class="riichi-bonus-chip">
                    {{ tr('riichiBonusBadge', { pts: previewCalc.entries[idx].riichiBonus.toLocaleString() }) }}
                    → {{ previewCalc.entries[idx].finalScore.toLocaleString() }}
                  </div>
                </td>
                <td class="col-penalty">
                  <div class="penalty-wrap">
                    <button
                      type="button"
                      class="btn-chombo-chip"
                      :class="{ active: row.penalty !== 0 }"
                      @click="toggleChombo(idx)"
                      :title="`-${config.chomboPenalty} pt`"
                    >
                      -{{ config.chomboPenalty }}
                    </button>
                    <input
                      type="number"
                      v-model.number="row.penalty"
                      step="1"
                      max="0"
                      class="penalty-input"
                    />
                  </div>
                </td>
                <td class="col-rank">
                  <span v-if="filledCount > 0" class="rank-pill" :class="`r-${previewCalc.entries[idx].rank}`">
                    {{ previewCalc.entries[idx].rank }}
                  </span>
                  <span v-else>-</span>
                </td>
                <td class="col-pt">
                  <span
                    v-if="filledCount > 0"
                    class="pt-val"
                    :class="previewCalc.entries[idx].finalPoint > 0 ? 'pos' : previewCalc.entries[idx].finalPoint < 0 ? 'neg' : ''"
                  >
                    {{ formatSignedPoint(previewCalc.entries[idx].finalPoint) }}
                  </span>
                  <span v-else>-</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Leftover Riichi Sticks (Kyotaku) Bar -->
        <div class="riichi-bar">
          <div class="riichi-bar-top">
            <div class="riichi-label-group">
              <span class="riichi-stick-icon" aria-hidden="true"></span>
              <strong>{{ tr('leftoverRiichiLabel') }}</strong>
              <span class="seat-tie-hint">{{ tr('seatOrderTieHint') }}</span>
            </div>
            <div class="riichi-stepper">
              <button type="button" class="step-btn" :disabled="normalizedRiichiSticks <= 0" @click="adjustRiichiSticks(-1)">−</button>
              <input
                type="number"
                min="0"
                max="20"
                step="1"
                v-model.number="riichiSticks"
                class="riichi-num-input"
              />
              <button type="button" class="step-btn" @click="adjustRiichiSticks(1)">+</button>
              <span class="riichi-unit">{{ tr('leftoverRiichiUnit') }} ({{ (normalizedRiichiSticks * 1000).toLocaleString() }})</span>
            </div>
          </div>
          <div class="riichi-bar-sub">
            <span>{{ tr('leftoverRiichiHint') }}</span>
            <button
              v-if="suggestedRiichiSticks > 0"
              type="button"
              class="btn-suggest-riichi"
              @click="applySuggestedRiichi"
            >
              ⚡ {{ tr('autoFillRiichiBtn', { count: suggestedRiichiSticks, pts: (suggestedRiichiSticks * 1000).toLocaleString() }) }}
            </button>
          </div>
        </div>

        <div class="sum-bar" :class="{ ok: previewCalc.scoreDiff === 0 && filledCount === 4, warn: previewCalc.scoreDiff !== 0 }">
          <div class="sum-left">
            <span>{{ tr('scoreSumLabel') }}:</span>
            <strong>{{ (previewCalc.scoreSum + previewCalc.riichiTotal).toLocaleString() }}</strong>
            <span v-if="previewCalc.riichiTotal > 0" class="sum-expected">
              ({{ previewCalc.scoreSum.toLocaleString() }} + {{ previewCalc.riichiTotal.toLocaleString() }})
            </span>
            <span class="sum-expected">/ {{ previewCalc.expectedSum.toLocaleString() }}</span>
          </div>
          <div class="sum-right">
            <span v-if="previewCalc.scoreDiff === 0 && filledCount === 4" class="sum-ok-badge">
              {{ tr('scoreSumOk') }}
            </span>
            <span v-else class="sum-diff-badge">
              {{
                tr('scoreSumDiff', {
                  diff: (previewCalc.scoreDiff > 0 ? '+' : '') + previewCalc.scoreDiff.toLocaleString(),
                  expected: previewCalc.expectedSum.toLocaleString(),
                })
              }}
            </span>
          </div>
        </div>

        <label v-if="previewCalc.scoreDiff !== 0" class="mismatch-check">
          <input type="checkbox" v-model="allowSumMismatch" />
          <span>{{ tr('allowSumMismatchLabel') }}</span>
        </label>

        <div class="meta-inputs">
          <input
            type="text"
            v-model="submittedBy"
            :placeholder="tr('submittedByPlaceholder')"
            class="meta-text-input"
          />
          <input
            type="text"
            v-model="note"
            :placeholder="tr('notePlaceholder')"
            class="meta-text-input"
          />
        </div>

        <div v-if="validationError" class="error-box">{{ validationError }}</div>
      </div>

      <div class="ev-modal-footer">
        <button
          v-if="isStaff && existingResult"
          type="button"
          class="btn-danger"
          :disabled="isSubmitting"
          @click="handleDelete"
        >
          🗑 {{ tr('clearResultBtn') }}
        </button>
        <div v-else></div>
        <div class="footer-right">
          <button type="button" class="btn-ghost" @click="emit('close')">
            {{ tr('cancel') }}
          </button>
          <button
            type="button"
            class="btn-primary"
            :disabled="isSubmitting"
            @click="handleSubmit"
          >
            {{ isSubmitting ? tr('submittingBtn') : tr('submitScoreBtn') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ev-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.68);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1200;
  padding: 12px;
  overflow-y: auto;
}

.score-modal-card {
  width: 100%;
  max-width: 720px;
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  background: var(--card-bg-color);
  color: var(--text-color);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  box-shadow: 0 22px 50px rgba(0, 0, 0, 0.35);
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans KR', 'Noto Sans JP', sans-serif;
}

.ev-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--border-color);
}
.title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ev-modal-title {
  font-size: 16.5px;
  font-weight: 800;
  margin: 0;
}
.jpc-badge {
  font-size: 11px;
  font-weight: 800;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(168, 85, 247, 0.16);
  color: #a855f7;
  border: 1px solid rgba(168, 85, 247, 0.4);
}
.ev-modal-sub {
  font-size: 12.5px;
  color: var(--text-dimmed);
  margin-top: 4px;
  line-height: 1.45;
}
.ev-icon-close {
  border: none;
  background: transparent;
  color: var(--text-dimmed);
  font-size: 18px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 6px;
}

.score-modal-body {
  padding: 14px 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.overwrite-banner {
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 600;
  background: rgba(245, 158, 11, 0.14);
  border: 1px solid rgba(245, 158, 11, 0.45);
  color: #d97706;
}

.toolbar-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.mode-toggle {
  display: inline-flex;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}
.mode-btn {
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 700;
  border: none;
  background: var(--bg-card);
  color: var(--text-dimmed);
  cursor: pointer;
}
.mode-btn.active {
  background: #2563eb;
  color: #fff;
}

.btn-autofill {
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 700;
  border-radius: 8px;
  border: 1px solid rgba(37, 99, 235, 0.4);
  background: rgba(37, 99, 235, 0.12);
  color: #3b82f6;
  cursor: pointer;
}
.btn-autofill:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.score-table-wrap {
  overflow-x: auto;
}
.score-entry-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.score-entry-table th {
  text-align: center;
  font-size: 11.5px;
  font-weight: 700;
  color: var(--text-dimmed);
  padding: 7px 6px;
  border-bottom: 1px solid var(--border-color);
}
.score-entry-table td {
  padding: 8px 6px;
  border-bottom: 1px solid var(--border-color);
  vertical-align: middle;
}

.seat-ctrl {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.wind-badge {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 800;
  color: #fff;
}
.w-0 { background: #dc2626; }
.w-1 { background: #2563eb; }
.w-2 { background: #d97706; }
.w-3 { background: #7c3aed; }
.mini-arrows {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.mini-arrows button {
  font-size: 8px;
  line-height: 1;
  padding: 1px 3px;
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  color: var(--text-color);
  border-radius: 3px;
  cursor: pointer;
}
.mini-arrows button:disabled {
  opacity: 0.3;
}

.player-cell {
  display: flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}
.team-pill {
  font-size: 10.5px;
  font-weight: 800;
  padding: 1px 5px;
  border-radius: 4px;
}
.p-id {
  font-size: 11px;
  color: var(--text-dimmed);
  font-weight: 700;
}
.p-name {
  font-weight: 700;
}
.pro-tag {
  font-size: 9.5px;
  font-weight: 800;
  padding: 1px 4px;
  border-radius: 4px;
  background: rgba(245, 158, 11, 0.18);
  color: #d97706;
}

.score-input-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
}
.score-num-input {
  width: 96px !important;
  padding: 7px 8px !important;
  font-size: 14px !important;
  font-weight: 700;
  border-radius: 7px !important;
  border: 1px solid var(--input-border-color) !important;
  background: var(--input-bg-color) !important;
  color: var(--text-color) !important;
  text-align: right !important;
}
.unit-suffix {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-dimmed);
}
.riichi-bonus-chip {
  margin-top: 3px;
  font-size: 10.5px;
  font-weight: 800;
  color: #d97706;
  text-align: center;
  white-space: nowrap;
}

.riichi-bar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-card);
}
.riichi-bar-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.riichi-label-group {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12.5px;
}
.riichi-stick-icon {
  display: inline-block;
  width: 18px;
  height: 6px;
  border-radius: 999px;
  background: #f8fafc;
  border: 1px solid #94a3b8;
  position: relative;
}
.riichi-stick-icon::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #ef4444;
}
.seat-tie-hint {
  font-size: 11px;
  color: var(--text-dimmed);
}
.riichi-stepper {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.step-btn {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  background: var(--card-bg-color);
  color: var(--text-color);
  font-weight: 800;
  font-size: 14px;
  cursor: pointer;
}
.step-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.riichi-num-input {
  width: 44px !important;
  padding: 4px 4px !important;
  font-size: 13px !important;
  font-weight: 800;
  text-align: center !important;
  border-radius: 6px !important;
  border: 1px solid var(--input-border-color) !important;
  background: var(--input-bg-color) !important;
  color: var(--text-color) !important;
}
.riichi-unit {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-dimmed);
  white-space: nowrap;
}
.riichi-bar-sub {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 11.5px;
  color: var(--text-dimmed);
  line-height: 1.4;
}
.btn-suggest-riichi {
  padding: 4px 10px;
  border-radius: 7px;
  border: 1px solid rgba(245, 158, 11, 0.55);
  background: rgba(245, 158, 11, 0.16);
  color: #d97706;
  font-size: 11.5px;
  font-weight: 800;
  cursor: pointer;
  white-space: nowrap;
}

.penalty-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.btn-chombo-chip {
  padding: 4px 6px;
  font-size: 11px;
  font-weight: 700;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  color: var(--text-dimmed);
  cursor: pointer;
}
.btn-chombo-chip.active {
  background: rgba(239, 68, 68, 0.16);
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.5);
}
.penalty-input {
  width: 52px !important;
  padding: 5px 4px !important;
  font-size: 12px !important;
  border-radius: 6px !important;
  border: 1px solid var(--input-border-color) !important;
  background: var(--input-bg-color) !important;
  color: var(--text-color) !important;
  text-align: center !important;
}

.col-rank,
.col-pt {
  text-align: center;
}
.rank-pill {
  display: inline-flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 800;
}
.r-1 { background: rgba(245, 158, 11, 0.2); color: #d97706; }
.r-2 { background: rgba(59, 130, 246, 0.18); color: #3b82f6; }
.r-3 { background: rgba(148, 163, 184, 0.2); color: var(--text-dimmed); }
.r-4 { background: rgba(239, 68, 68, 0.18); color: #ef4444; }

.pt-val {
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.pt-val.pos { color: var(--color-positive); }
.pt-val.neg { color: var(--color-negative); }

.sum-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  font-size: 13px;
}
.sum-bar.ok {
  border-color: rgba(22, 163, 74, 0.45);
  background: rgba(22, 163, 74, 0.08);
}
.sum-bar.warn {
  border-color: rgba(239, 68, 68, 0.45);
  background: rgba(239, 68, 68, 0.08);
}
.sum-left {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sum-expected {
  color: var(--text-dimmed);
  font-size: 12px;
}
.sum-ok-badge {
  color: var(--color-positive);
  font-weight: 800;
}
.sum-diff-badge {
  color: var(--color-negative);
  font-weight: 700;
  font-size: 12px;
}

.mismatch-check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--text-color);
  cursor: pointer;
}

.meta-inputs {
  display: grid;
  grid-template-columns: 1fr 1.4fr;
  gap: 8px;
}
.meta-text-input {
  width: 100% !important;
  box-sizing: border-box;
  padding: 8px 10px !important;
  font-size: 12.5px !important;
  border-radius: 8px !important;
  border: 1px solid var(--input-border-color) !important;
  background: var(--input-bg-color) !important;
  color: var(--text-color) !important;
  text-align: left !important;
}

.error-box {
  padding: 9px 12px;
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.14);
  border: 1px solid rgba(239, 68, 68, 0.45);
  color: #ef4444;
  font-size: 12.5px;
  font-weight: 700;
}

.ev-modal-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 13px 20px 16px;
  border-top: 1px solid var(--border-color);
}
.footer-right {
  display: flex;
  gap: 8px;
}
.btn-primary,
.btn-ghost,
.btn-danger {
  padding: 8px 15px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  border: 1px solid transparent;
}
.btn-primary {
  background: #2563eb;
  color: #fff;
}
.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-ghost {
  background: transparent;
  color: var(--text-dimmed);
  border-color: var(--border-color);
}
.btn-danger {
  background: rgba(239, 68, 68, 0.14);
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.4);
}

@media (max-width: 600px) {
  .meta-inputs {
    grid-template-columns: 1fr;
  }
  .score-num-input {
    width: 78px !important;
  }
}
</style>
