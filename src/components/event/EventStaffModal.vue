<script setup lang="ts">
import { ref, reactive, watch } from 'vue';
import type { EventScoringConfig } from '@/data/knuNpm2026';
import type { EventAuditEntry } from '@/utils/knuNpmScoring';

interface Props {
  isStaff: boolean;
  config: EventScoringConfig;
  auditLog: EventAuditEntry[];
  isBusy?: boolean;
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
const activeTab = ref<'locks' | 'rules' | 'audit' | 'export'>('locks');
const newPinInput = ref('');

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
          <!-- Locks Tab -->
          <div v-if="activeTab === 'locks'" class="panel-stack">
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
  max-height: 90vh;
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
  gap: 4px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border-color);
  overflow-x: auto;
}
.staff-tabs button {
  padding: 6px 11px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--text-dimmed);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}
.staff-tabs button.active { background: #2563eb; color: #fff; }

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
</style>
