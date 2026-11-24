<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue';
import type { EventRoundTimer, EventScoringConfig } from '@/data/knuNpm2026';
import { computeRoundTimerDisplay, normalizeRoundTimer, type EventAuditEntry } from '@/utils/knuNpmScoring';
import { getSyncedNowMs } from '@/services/knuNpmEventService';

interface Props {
  isStaff: boolean;
  config: EventScoringConfig;
  auditLog: EventAuditEntry[];
  isBusy?: boolean;
  isSandbox?: boolean;
  tr: (key: string, params?: Record<string, string | number>) => string;
}
const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'login', pin: string): void;
  (e: 'logout'): void;
  (e: 'save-config', patch: Partial<EventScoringConfig> & { newStaffPin?: string }): void;
  (e: 'rollback', auditId: string): void;
  (e: 'export-csv'): void;
  (e: 'export-json'): void;
}>();

const pinInput = ref('');
const loginError = ref('');
const activeTab = ref<'timer' | 'locks' | 'rules' | 'audit' | 'export'>('timer');
const newPinInput = ref('');
const nowTick = ref(Date.now());
let tickHandle: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  tickHandle = setInterval(() => {
    nowTick.value = Date.now();
  }, 500);
});
onUnmounted(() => {
  if (tickHandle) clearInterval(tickHandle);
});

const timerForm = reactive({
  round: props.config.roundTimer?.round ?? 1,
  durationMinutes: props.config.roundTimer?.durationMinutes ?? 50,
  extraHands: (props.config.roundTimer?.extraHands ?? 0) as 0 | 1,
});

const liveTimer = computed(() => normalizeRoundTimer(props.config.roundTimer));
const timerDisplay = computed(() => {
  void nowTick.value;
  return computeRoundTimerDisplay(liveTimer.value, getSyncedNowMs(Boolean(props.isSandbox)));
});

const emitTimerUpdate = (nextTimer: EventRoundTimer) => {
  emit('save-config', { roundTimer: nextTimer });
};

const handleStartTimer = () => {
  const now = getSyncedNowMs(Boolean(props.isSandbox));
  const mins = Math.min(180, Math.max(1, Math.floor(Number(timerForm.durationMinutes) || 50)));
  emitTimerUpdate({
    round: timerForm.round,
    durationMinutes: mins,
    extraHands: timerForm.extraHands,
    status: 'running',
    endsAt: now + mins * 60_000,
    pausedRemainingMs: null,
    updatedAt: now,
  });
};

const handlePauseOrResumeTimer = () => {
  const now = getSyncedNowMs(Boolean(props.isSandbox));
  const cur = liveTimer.value;
  if (cur.status === 'running') {
    const rem = cur.endsAt !== null ? Math.max(0, cur.endsAt - now) : 0;
    emitTimerUpdate({
      ...cur,
      extraHands: timerForm.extraHands,
      status: 'paused',
      endsAt: null,
      pausedRemainingMs: rem,
      updatedAt: now,
    });
  } else if (cur.status === 'paused') {
    const rem = Math.max(0, cur.pausedRemainingMs ?? cur.durationMinutes * 60_000);
    emitTimerUpdate({
      ...cur,
      extraHands: timerForm.extraHands,
      status: 'running',
      endsAt: now + rem,
      pausedRemainingMs: null,
      updatedAt: now,
    });
  }
};

const handleAdjustTimer = (deltaMinutes: number) => {
  const now = getSyncedNowMs(Boolean(props.isSandbox));
  const cur = liveTimer.value;
  const deltaMs = deltaMinutes * 60_000;
  if (cur.status === 'running' && cur.endsAt !== null) {
    emitTimerUpdate({
      ...cur,
      extraHands: timerForm.extraHands,
      endsAt: Math.max(now, cur.endsAt + deltaMs),
      updatedAt: now,
    });
  } else if (cur.status === 'paused') {
    emitTimerUpdate({
      ...cur,
      extraHands: timerForm.extraHands,
      pausedRemainingMs: Math.max(0, (cur.pausedRemainingMs ?? 0) + deltaMs),
      updatedAt: now,
    });
  }
};

const handleSwitchExtraHands = (mode: 0 | 1) => {
  timerForm.extraHands = mode;
  const cur = liveTimer.value;
  if (cur.status !== 'idle') {
    emitTimerUpdate({
      ...cur,
      extraHands: mode,
      updatedAt: getSyncedNowMs(Boolean(props.isSandbox)),
    });
  }
};

const handleResetTimer = () => {
  const now = getSyncedNowMs(Boolean(props.isSandbox));
  emitTimerUpdate({
    round: timerForm.round,
    durationMinutes: Math.min(180, Math.max(1, Math.floor(Number(timerForm.durationMinutes) || 50))),
    extraHands: timerForm.extraHands,
    status: 'idle',
    endsAt: null,
    pausedRemainingMs: null,
    updatedAt: now,
  });
};

const form = reactive({
  startingScore: props.config.startingScore,
  returnScore: props.config.returnScore,
  uma0: props.config.uma[0],
  uma1: props.config.uma[1],
  uma2: props.config.uma[2],
  uma3: props.config.uma[3],
  tieBreak: props.config.tieBreak,
  roundMangan: props.config.roundMangan,
  tobi: props.config.tobi,
  riichiPayout: props.config.riichiPayout,
  chomboPenalty: props.config.chomboPenalty,
  allowParticipantInput: props.config.allowParticipantInput,
  lockedRounds: [...props.config.lockedRounds],
});

watch(
  () => props.config,
  (c) => {
    form.startingScore = c.startingScore;
    form.returnScore = c.returnScore;
    form.uma0 = c.uma[0];
    form.uma1 = c.uma[1];
    form.uma2 = c.uma[2];
    form.uma3 = c.uma[3];
    form.tieBreak = c.tieBreak;
    form.roundMangan = c.roundMangan;
    form.tobi = c.tobi;
    form.riichiPayout = c.riichiPayout;
    form.chomboPenalty = c.chomboPenalty;
    form.allowParticipantInput = c.allowParticipantInput;
    form.lockedRounds = [...c.lockedRounds];
    if (c.roundTimer) {
      timerForm.round = c.roundTimer.round;
      timerForm.durationMinutes = c.roundTimer.durationMinutes;
      timerForm.extraHands = c.roundTimer.extraHands;
    }
  },
  { deep: true }
);

const toggleRoundLock = (r: number) => {
  const idx = form.lockedRounds.indexOf(r);
  if (idx >= 0) form.lockedRounds.splice(idx, 1);
  else form.lockedRounds.push(r);
  form.lockedRounds.sort((a, b) => a - b);
};

const submitLogin = () => {
  loginError.value = '';
  if (!pinInput.value.trim()) return;
  emit('login', pinInput.value.trim());
};

const saveConfig = () => {
  emit('save-config', {
    startingScore: Number(form.startingScore),
    returnScore: Number(form.returnScore),
    uma: [Number(form.uma0), Number(form.uma1), Number(form.uma2), Number(form.uma3)],
    tieBreak: form.tieBreak,
    roundMangan: form.roundMangan,
    tobi: form.tobi,
    riichiPayout: form.riichiPayout,
    chomboPenalty: Math.abs(Number(form.chomboPenalty)),
    allowParticipantInput: form.allowParticipantInput,
    lockedRounds: [...form.lockedRounds],
  });
};

const updatePin = () => {
  if (newPinInput.value.trim().length < 4) return;
  emit('save-config', { newStaffPin: newPinInput.value.trim() });
  newPinInput.value = '';
};

const handleRollback = (entry: EventAuditEntry) => {
  if (!entry.key) return;
  if (confirm(props.tr('staffRollbackConfirm', { key: entry.key }))) {
    emit('rollback', entry.id);
  }
};

const formatTime = (ts: number) => {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
};
</script>

<template>
  <div class="ev-modal-backdrop" @click.self="emit('close')">
    <div class="ev-modal-card staff-modal-card">
      <div class="ev-modal-header">
        <h3 class="ev-modal-title">🔐 {{ tr('staffModalTitle') }}</h3>
        <button class="ev-icon-close" @click="emit('close')">✕</button>
      </div>

      <!-- Not Logged In -->
      <div v-if="!isStaff" class="login-box">
        <p class="login-desc">{{ tr('staffPinPrompt') }}</p>
        <div class="pin-row">
          <input
            type="password"
            v-model="pinInput"
            :placeholder="tr('staffPinPlaceholder')"
            class="pin-input"
            @keyup.enter="submitLogin"
          />
          <button type="button" class="btn-primary" :disabled="isBusy" @click="submitLogin">
            {{ tr('staffLoginBtn') }}
          </button>
        </div>
        <p class="pin-hint">Default initial PIN: <code>20261128</code></p>
      </div>

      <!-- Logged In -->
      <template v-else>
        <div class="staff-tabs">
          <button :class="{ active: activeTab === 'timer' }" @click="activeTab = 'timer'">
            {{ tr('staffTabTimer') }}
          </button>
          <button :class="{ active: activeTab === 'locks' }" @click="activeTab = 'locks'">
            {{ tr('staffTabLocks') }}
          </button>
          <button :class="{ active: activeTab === 'rules' }" @click="activeTab = 'rules'">
            {{ tr('staffTabRules') }}
          </button>
          <button :class="{ active: activeTab === 'audit' }" @click="activeTab = 'audit'">
            {{ tr('staffTabAudit') }} ({{ auditLog.length }})
          </button>
          <button :class="{ active: activeTab === 'export' }" @click="activeTab = 'export'">
            {{ tr('staffTabExport') }}
          </button>
        </div>

        <div class="staff-body">
          <!-- Round Timer Tab -->
          <div v-if="activeTab === 'timer'" class="panel-stack">
            <p class="login-desc">{{ tr('timerControlDesc') }}</p>

            <div class="timer-preview-box" :class="timerDisplay.severity">
              <div class="tp-top">
                <span class="tp-round-chip">R{{ liveTimer.round }} · {{ timerDisplay.ruleTag }}</span>
                <span class="tp-status-chip">
                  {{
                    timerDisplay.isExpired
                      ? tr('timerStatusExpired')
                      : liveTimer.status === 'running'
                        ? tr('timerStatusRunning')
                        : liveTimer.status === 'paused'
                          ? tr('timerStatusPaused')
                          : tr('timerStatusIdle')
                  }}
                </span>
              </div>
              <div class="tp-clock">{{ timerDisplay.formatted }}</div>
            </div>

            <div class="form-grid-2">
              <label class="field">
                <span>{{ tr('timerRoundLabel') }}</span>
                <select v-model.number="timerForm.round">
                  <option v-for="r in [1, 2, 3, 4, 5, 6]" :key="r" :value="r">
                    {{ tr('roundLabel', { n: r }) }}
                  </option>
                </select>
              </label>
              <label class="field">
                <span>{{ tr('timerDurationLabel') }}</span>
                <div class="duration-input-row">
                  <input type="number" min="1" max="180" v-model.number="timerForm.durationMinutes" />
                  <button type="button" class="mini-preset" @click="timerForm.durationMinutes = 50">50m</button>
                  <button type="button" class="mini-preset" @click="timerForm.durationMinutes = 1">1m</button>
                </div>
              </label>
            </div>

            <div class="section-label">{{ tr('timerRuleLabel') }}</div>
            <div class="rule-radio-row">
              <button
                type="button"
                class="rule-choice-btn"
                :class="{ active: timerForm.extraHands === 0 }"
                @click="handleSwitchExtraHands(0)"
              >
                <strong>{{ timerForm.durationMinutes }}+0</strong>
                <span>{{ tr('timerRule500') }}</span>
              </button>
              <button
                type="button"
                class="rule-choice-btn"
                :class="{ active: timerForm.extraHands === 1 }"
                @click="handleSwitchExtraHands(1)"
              >
                <strong>{{ timerForm.durationMinutes }}+1</strong>
                <span>{{ tr('timerRule501') }}</span>
              </button>
            </div>

            <div class="timer-action-grid">
              <button type="button" class="btn-timer-start" :disabled="isBusy" @click="handleStartTimer">
                ▶ {{ tr('timerStartBtn') }} (R{{ timerForm.round }})
              </button>
              <button
                v-if="liveTimer.status !== 'idle'"
                type="button"
                class="btn-timer-sec"
                :disabled="isBusy"
                @click="handlePauseOrResumeTimer"
              >
                {{ liveTimer.status === 'running' ? '⏸ ' + tr('timerPauseBtn') : '▶ ' + tr('timerResumeBtn') }}
              </button>
              <button
                v-if="liveTimer.status !== 'idle'"
                type="button"
                class="btn-timer-sec"
                :disabled="isBusy"
                @click="handleAdjustTimer(-1)"
              >
                -1m
              </button>
              <button
                v-if="liveTimer.status !== 'idle'"
                type="button"
                class="btn-timer-sec"
                :disabled="isBusy"
                @click="handleAdjustTimer(1)"
              >
                +1m
              </button>
              <button
                type="button"
                class="btn-danger-ghost"
                :disabled="isBusy"
                @click="handleResetTimer"
              >
                ↺ {{ tr('timerResetBtn') }}
              </button>
            </div>
          </div>

          <!-- Locks Tab -->
          <div v-else-if="activeTab === 'locks'" class="panel-stack">
            <label class="switch-card">
              <div>
                <strong>{{ tr('staffAllowParticipant') }}</strong>
                <p>{{ tr('staffAllowParticipantDesc') }}</p>
              </div>
              <input type="checkbox" v-model="form.allowParticipantInput" />
            </label>

            <div class="section-label">{{ tr('staffRoundLocks') }}</div>
            <div class="round-locks-grid">
              <button
                v-for="r in [1, 2, 3, 4, 5, 6]"
                :key="r"
                type="button"
                class="lock-pill"
                :class="{ locked: form.lockedRounds.includes(r) }"
                @click="toggleRoundLock(r)"
              >
                <span>{{ tr('roundShort', { n: r }) }}</span>
                <span>{{ form.lockedRounds.includes(r) ? '🔒' : '🔓' }}</span>
              </button>
            </div>

            <button type="button" class="btn-primary full-w" :disabled="isBusy" @click="saveConfig">
              {{ tr('staffSaveConfig') }}
            </button>
          </div>

          <!-- Rules Tab -->
          <div v-else-if="activeTab === 'rules'" class="panel-stack">
            <div class="form-grid-2">
              <label class="field">
                <span>{{ tr('rulesStarting') }}</span>
                <input type="number" step="1000" v-model.number="form.startingScore" />
              </label>
              <label class="field">
                <span>{{ tr('rulesReturn') }}</span>
                <input type="number" step="1000" v-model.number="form.returnScore" />
              </label>
            </div>

            <div class="section-label">{{ tr('rulesUma') }}</div>
            <div class="form-grid-4">
              <input type="number" v-model.number="form.uma0" />
              <input type="number" v-model.number="form.uma1" />
              <input type="number" v-model.number="form.uma2" />
              <input type="number" v-model.number="form.uma3" />
            </div>

            <div class="form-grid-2">
              <label class="field">
                <span>{{ tr('rulesTieBreak') }}</span>
                <select v-model="form.tieBreak">
                  <option value="split">{{ tr('rulesTieSplit') }}</option>
                  <option value="seat">{{ tr('rulesTieSeat') }}</option>
                </select>
              </label>
              <label class="field">
                <span>{{ tr('rulesChombo') }} (-pt)</span>
                <input type="number" min="0" v-model.number="form.chomboPenalty" />
              </label>
            </div>

            <div class="checks-row">
              <label><input type="checkbox" v-model="form.roundMangan" /> {{ tr('rulesKiriage') }}</label>
              <label><input type="checkbox" v-model="form.tobi" /> {{ tr('rulesTobi') }}</label>
              <label><input type="checkbox" v-model="form.riichiPayout" /> {{ tr('rulesRiichiPayout') }}</label>
            </div>

            <button type="button" class="btn-primary full-w" :disabled="isBusy" @click="saveConfig">
              {{ tr('staffSaveConfig') }}
            </button>
          </div>

          <!-- Audit Log Tab -->
          <div v-else-if="activeTab === 'audit'" class="panel-stack">
            <div v-if="auditLog.length === 0" class="empty-msg">{{ tr('staffAuditEmpty') }}</div>
            <div v-for="entry in auditLog" :key="entry.id" class="audit-row">
              <div class="audit-info">
                <div class="audit-top">
                  <span class="audit-time">{{ formatTime(entry.timestamp) }}</span>
                  <span class="audit-actor" :class="entry.actor">{{ entry.actorLabel || entry.actor }}</span>
                </div>
                <div class="audit-summary">{{ entry.summary }}</div>
              </div>
              <button
                v-if="entry.key && entry.action !== 'config'"
                type="button"
                class="btn-rollback"
                :disabled="isBusy"
                @click="handleRollback(entry)"
              >
                ↩ {{ tr('staffRollbackBtn') }}
              </button>
            </div>
          </div>

          <!-- Export & PIN Tab -->
          <div v-else class="panel-stack">
            <button type="button" class="btn-export" @click="emit('export-csv')">
              📊 {{ tr('staffExportCsv') }}
            </button>
            <button type="button" class="btn-export secondary" @click="emit('export-json')">
              💾 {{ tr('staffExportJson') }}
            </button>

            <div class="pin-change-box">
              <div class="section-label">{{ tr('staffChangePinTitle') }}</div>
              <div class="pin-row">
                <input
                  type="password"
                  v-model="newPinInput"
                  :placeholder="tr('staffNewPinPlaceholder')"
                  class="pin-input"
                />
                <button
                  type="button"
                  class="btn-primary"
                  :disabled="isBusy || newPinInput.trim().length < 4"
                  @click="updatePin"
                >
                  {{ tr('staffChangePinBtn') }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="ev-modal-footer">
          <button type="button" class="btn-danger-ghost" @click="emit('logout')">
            {{ tr('staffLogoutBtn') }}
          </button>
          <button type="button" class="btn-ghost" @click="emit('close')">
            {{ tr('close') }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.ev-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.7);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1200;
  padding: 12px;
}
.staff-modal-card {
  width: 100%;
  max-width: 580px;
  max-height: 92vh;
  max-height: 92dvh;
  display: flex;
  flex-direction: column;
  background: var(--card-bg-color);
  color: var(--text-color);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans KR', 'Noto Sans JP', sans-serif;
}
.ev-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px 18px;
  border-bottom: 1px solid var(--border-color);
}
.ev-modal-title { margin: 0; font-size: 16px; font-weight: 800; }
.ev-icon-close { border: none; background: transparent; color: var(--text-dimmed); font-size: 18px; cursor: pointer; }

.login-box {
  padding: 22px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.login-desc { font-size: 13px; color: var(--text-dimmed); margin: 0; }
.pin-row { display: flex; gap: 8px; }
.pin-input {
  flex: 1;
  width: auto !important;
  padding: 9px 12px !important;
  border-radius: 8px !important;
  border: 1px solid var(--input-border-color) !important;
  background: var(--input-bg-color) !important;
  color: var(--text-color) !important;
  text-align: left !important;
}
.pin-hint { font-size: 11.5px; color: var(--text-dimmed); margin: 0; }

.staff-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}
.staff-tabs button {
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  color: var(--text-dimmed);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}
.staff-tabs button.active {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}

.staff-body {
  padding: 16px 18px;
  overflow-y: auto;
  flex: 1;
}
.panel-stack { display: flex; flex-direction: column; gap: 12px; }
.switch-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-card);
  cursor: pointer;
}
.switch-card p { margin: 3px 0 0; font-size: 12px; color: var(--text-dimmed); }
.section-label { font-size: 12px; font-weight: 800; color: var(--text-dimmed); }

.round-locks-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.lock-pill {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border-radius: 9px;
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  color: var(--text-color);
  font-weight: 700;
  cursor: pointer;
}
.lock-pill.locked {
  border-color: rgba(239, 68, 68, 0.5);
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
}

.form-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.form-grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 700; }
.field input, .field select, .form-grid-4 input {
  width: 100% !important;
  box-sizing: border-box;
  padding: 8px !important;
  border-radius: 8px !important;
  border: 1px solid var(--input-border-color) !important;
  background: var(--input-bg-color) !important;
  color: var(--text-color) !important;
}
.checks-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 12.5px;
}
.checks-row label { display: flex; align-items: center; gap: 5px; cursor: pointer; }

.audit-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 9px;
  background: var(--bg-card);
}
.audit-top { display: flex; gap: 8px; font-size: 11px; color: var(--text-dimmed); }
.audit-actor.staff { color: #3b82f6; font-weight: 800; }
.audit-summary { font-size: 12.5px; font-weight: 700; margin-top: 2px; }
.btn-rollback {
  padding: 5px 10px;
  border-radius: 7px;
  border: 1px solid rgba(245, 158, 11, 0.45);
  background: rgba(245, 158, 11, 0.14);
  color: #d97706;
  font-size: 11.5px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}
.empty-msg { font-size: 13px; color: var(--text-dimmed); text-align: center; padding: 20px; }

.btn-export {
  padding: 11px 14px;
  border-radius: 10px;
  border: 1px solid rgba(37, 99, 235, 0.4);
  background: rgba(37, 99, 235, 0.12);
  color: #3b82f6;
  font-weight: 800;
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}
.btn-export.secondary {
  border-color: var(--border-color);
  background: var(--bg-card);
  color: var(--text-color);
}
.pin-change-box {
  margin-top: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.btn-primary {
  padding: 9px 15px;
  border-radius: 8px;
  border: none;
  background: #2563eb;
  color: #fff;
  font-weight: 700;
  cursor: pointer;
}
.btn-primary.full-w { width: 100%; }
.btn-primary:disabled { opacity: 0.45; cursor: not-allowed; }

.ev-modal-footer {
  display: flex;
  justify-content: space-between;
  padding: 12px 18px;
  border-top: 1px solid var(--border-color);
}
.btn-ghost {
  padding: 7px 14px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-dimmed);
  font-weight: 700;
  cursor: pointer;
}
.btn-danger-ghost {
  padding: 7px 12px;
  border-radius: 8px;
  border: 1px solid rgba(239, 68, 68, 0.4);
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  font-weight: 700;
  cursor: pointer;
}

/* Round Timer Panel */
.timer-preview-box {
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  text-align: center;
}
.timer-preview-box.normal {
  border-color: rgba(16, 185, 129, 0.45);
  background: rgba(16, 185, 129, 0.08);
}
.timer-preview-box.warn {
  border-color: rgba(245, 158, 11, 0.5);
  background: rgba(245, 158, 11, 0.1);
}
.timer-preview-box.critical,
.timer-preview-box.expired {
  border-color: rgba(239, 68, 68, 0.55);
  background: rgba(239, 68, 68, 0.12);
}
.tp-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11.5px;
  font-weight: 800;
  margin-bottom: 6px;
}
.tp-round-chip {
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(37, 99, 235, 0.15);
  color: #3b82f6;
}
.tp-status-chip {
  color: var(--text-dimmed);
}
.tp-clock {
  font-size: 40px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  line-height: 1.05;
  letter-spacing: 1px;
}
.duration-input-row {
  display: flex;
  gap: 5px;
  align-items: center;
}
.mini-preset {
  padding: 6px 8px;
  border-radius: 7px;
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  color: var(--text-color);
  font-size: 11.5px;
  font-weight: 800;
  cursor: pointer;
  white-space: nowrap;
}
.rule-radio-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.rule-choice-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  color: var(--text-color);
  cursor: pointer;
  text-align: left;
}
.rule-choice-btn strong { font-size: 14px; font-weight: 900; }
.rule-choice-btn span { font-size: 11px; color: var(--text-dimmed); line-height: 1.25; }
.rule-choice-btn.active {
  border-color: #2563eb;
  background: rgba(37, 99, 235, 0.14);
}
.rule-choice-btn.active strong { color: #3b82f6; }
.timer-action-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}
.btn-timer-start {
  flex: 1 1 180px;
  padding: 10px 14px;
  border-radius: 9px;
  border: none;
  background: #16a34a;
  color: #fff;
  font-size: 13.5px;
  font-weight: 800;
  cursor: pointer;
}
.btn-timer-start:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-timer-sec {
  padding: 9px 12px;
  border-radius: 9px;
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  color: var(--text-color);
  font-size: 12.5px;
  font-weight: 800;
  cursor: pointer;
}
</style>
