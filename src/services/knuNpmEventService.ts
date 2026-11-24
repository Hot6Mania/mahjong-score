import {
  DEFAULT_EVENT_CONFIG,
  getMatchKey,
  getMatchSlot,
  type EventScoringConfig,
} from '@/data/knuNpm2026';
import {
  generateSampleEventResults,
  normalizeConfig,
  type CompactRoundRecords,
  type EventAuditEntry,
  type EventStatePayload,
  type ResultSource,
  type StoredTableResult,
  type TableScoreEntryInput,
} from '@/utils/knuNpmScoring';

const DEFAULT_WORKER_URL =
  import.meta.env.VITE_GOOGLE_AUTH_WORKER_URL || 'https://mahjong-score.cnabe.workers.dev';
const API_PREFIX = '/api/event/knu-npm-2026';

const STAFF_PIN_SESSION_KEY = 'knu_npm_2026_staff_pin';
const SANDBOX_STATE_STORAGE_KEY = 'knu_npm_2026_sandbox_state_v1';
const SANDBOX_PIN_STORAGE_KEY = 'knu_npm_2026_sandbox_pin_v1';
const DEFAULT_SANDBOX_PIN = '20261128';
const SYNC_CHANNEL_NAME = 'knu-npm-2026-sync';
const SYNC_WINDOW_EVENT = 'knu-npm-2026-state-updated';

export function broadcastEventStateUpdate(state: EventStatePayload, sandbox: boolean): void {
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(SYNC_WINDOW_EVENT, { detail: { state, sandbox } }));
    }
  } catch {}
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const ch = new BroadcastChannel(SYNC_CHANNEL_NAME);
      ch.postMessage({ state, sandbox });
      ch.close();
    }
  } catch {}
}

export function subscribeEventStateUpdates(
  onUpdate: (payload: { state: EventStatePayload; sandbox: boolean }) => void
): () => void {
  const winHandler = (e: Event) => {
    const detail = (e as CustomEvent)?.detail;
    if (detail && detail.state) onUpdate(detail);
  };
  if (typeof window !== 'undefined') {
    window.addEventListener(SYNC_WINDOW_EVENT, winHandler);
  }
  let ch: BroadcastChannel | null = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      ch = new BroadcastChannel(SYNC_CHANNEL_NAME);
      ch.onmessage = (ev) => {
        if (ev.data && ev.data.state) onUpdate(ev.data);
      };
    }
  } catch {}
  return () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener(SYNC_WINDOW_EVENT, winHandler);
    }
    if (ch) ch.close();
  };
}

export function getSavedStaffPin(): string {
  try {
    return sessionStorage.getItem(STAFF_PIN_SESSION_KEY) || '';
  } catch {
    return '';
  }
}

export function saveStaffPin(pin: string): void {
  try {
    if (pin) sessionStorage.setItem(STAFF_PIN_SESSION_KEY, pin);
    else sessionStorage.removeItem(STAFF_PIN_SESSION_KEY);
  } catch {}
}

export function clearStaffPin(): void {
  saveStaffPin('');
}

function getApiBase(): string {
  return `${DEFAULT_WORKER_URL.replace(/\/$/, '')}${API_PREFIX}`;
}

function buildAuthHeaders(staffPin?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const pin = staffPin ?? getSavedStaffPin();
  if (pin) {
    headers['X-Event-Staff-Pin'] = pin;
  }
  return headers;
}

// ================================
// Local Sandbox Engine (Isolated from Live KV)
// ================================
function loadSandboxState(): EventStatePayload {
  try {
    const raw = localStorage.getItem(SANDBOX_STATE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        updatedAt: Number(parsed.updatedAt || Date.now()),
        config: normalizeConfig(parsed.config),
        results: parsed.results && typeof parsed.results === 'object' ? parsed.results : {},
        auditLog: Array.isArray(parsed.auditLog) ? parsed.auditLog : [],
        serverTime: Date.now(),
      };
    }
  } catch {}
  return {
    updatedAt: Date.now(),
    config: normalizeConfig(DEFAULT_EVENT_CONFIG),
    results: {},
    auditLog: [],
    serverTime: Date.now(),
  };
}

function saveSandboxState(state: EventStatePayload): EventStatePayload {
  const next: EventStatePayload = {
    ...state,
    updatedAt: Math.max(Date.now(), Number(state.updatedAt || 0) + 1),
    serverTime: Date.now(),
  };
  try {
    localStorage.setItem(SANDBOX_STATE_STORAGE_KEY, JSON.stringify(next));
  } catch {}
  broadcastEventStateUpdate(next, true);
  return next;
}

function getSandboxPin(): string {
  try {
    return localStorage.getItem(SANDBOX_PIN_STORAGE_KEY) || DEFAULT_SANDBOX_PIN;
  } catch {
    return DEFAULT_SANDBOX_PIN;
  }
}

export function seedSandboxData(roundCount: number): EventStatePayload {
  const cur = loadSandboxState();
  const sampleResults = generateSampleEventResults(roundCount, cur.config);
  const auditEntry: EventAuditEntry = {
    id: `sb-seed-${Date.now()}`,
    timestamp: Date.now(),
    action: 'config',
    actor: 'staff',
    actorLabel: 'Sandbox',
    summary: `Seeded ${Object.keys(sampleResults).length} sample games (R1–R${roundCount})`,
  };
  return saveSandboxState({
    ...cur,
    results: sampleResults,
    auditLog: [auditEntry, ...cur.auditLog].slice(0, 80),
  });
}

export function resetSandboxData(): EventStatePayload {
  try {
    localStorage.removeItem(SANDBOX_STATE_STORAGE_KEY);
  } catch {}
  return saveSandboxState({
    updatedAt: Date.now(),
    config: normalizeConfig(DEFAULT_EVENT_CONFIG),
    results: {},
    auditLog: [],
    serverTime: Date.now(),
  });
}

// ================================
// Unified Public / Staff API Functions
// ================================

export async function fetchEventState(sandbox = false, force = false): Promise<EventStatePayload> {
  if (sandbox) {
    return loadSandboxState();
  }
  const qs = force ? `?force=1&t=${Date.now()}` : `?t=${Date.now()}`;
  const res = await fetch(`${getApiBase()}/state${qs}`, {
    method: 'GET',
    cache: 'no-store',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to fetch event state (HTTP ${res.status})`);
  }
  const data = await res.json();
  return {
    updatedAt: Number(data.updatedAt || 0),
    config: normalizeConfig(data.config),
    results: data.results && typeof data.results === 'object' ? data.results : {},
    auditLog: Array.isArray(data.auditLog) ? data.auditLog : [],
    serverTime: Number(data.serverTime || Date.now()),
  };
}

/**
 * 초경량 조건부 폴링: 서버에 변경이 없으면 { unchanged: true }만 수신해 트래픽·렌더링 부하 최소화
 */
export async function fetchEventStateIfChanged(
  sandbox: boolean,
  sinceUpdatedAt: number
): Promise<{ unchanged: true; updatedAt: number } | { unchanged: false; state: EventStatePayload }> {
  if (sandbox) {
    const cur = loadSandboxState();
    if (sinceUpdatedAt > 0 && cur.updatedAt <= sinceUpdatedAt) {
      return { unchanged: true, updatedAt: cur.updatedAt };
    }
    return { unchanged: false, state: cur };
  }
  const qs = sinceUpdatedAt > 0 ? `?since=${sinceUpdatedAt}` : '';
  const res = await fetch(`${getApiBase()}/state${qs}`, {
    method: 'GET',
    cache: 'no-store',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to sync event state (HTTP ${res.status})`);
  }
  const data = await res.json();
  if (data.unchanged === true) {
    return { unchanged: true, updatedAt: Number(data.updatedAt || sinceUpdatedAt) };
  }
  return {
    unchanged: false,
    state: {
      updatedAt: Number(data.updatedAt || 0),
      config: normalizeConfig(data.config),
      results: data.results && typeof data.results === 'object' ? data.results : {},
      auditLog: Array.isArray(data.auditLog) ? data.auditLog : [],
      serverTime: Number(data.serverTime || Date.now()),
    },
  };
}

export interface SubmitTableResultPayload {
  round: number;
  table: number;
  source: ResultSource;
  entries: TableScoreEntryInput[];
  rounds?: CompactRoundRecords | null;
  submittedBy?: string;
  note?: string;
  allowScoreSumMismatch?: boolean;
}

export async function submitTableResult(
  payload: SubmitTableResultPayload,
  sandbox = false,
  staffPin?: string
): Promise<EventStatePayload> {
  const slot = getMatchSlot(payload.round, payload.table);
  if (!slot) {
    throw new Error(`Invalid match slot R${payload.round}-T${payload.table}`);
  }
  const expectedIds = [...slot.playerIds].sort((a, b) => a - b);
  const actualIds = payload.entries.map((e) => Number(e.playerId)).sort((a, b) => a - b);
  if (expectedIds.length !== actualIds.length || expectedIds.some((id, idx) => id !== actualIds[idx])) {
    throw new Error('Submitted players do not match the confirmed roster for this table.');
  }

  if (sandbox) {
    const cur = loadSandboxState();
    const pin = staffPin ?? getSavedStaffPin();
    const isStaff = Boolean(pin && pin === getSandboxPin());
    const key = getMatchKey(payload.round, payload.table);
    if (!isStaff) {
      if (!cur.config.allowParticipantInput) {
        throw new Error('Participant input is currently disabled by Staff.');
      }
      if (cur.config.lockedRounds.includes(payload.round) || cur.config.lockedTables.includes(key)) {
        throw new Error(`Round ${payload.round} / Table ${payload.table} is locked by Staff.`);
      }
    }
    const prev = cur.results[key] || null;
    const stored: StoredTableResult = {
      key,
      round: payload.round,
      table: payload.table,
      source: payload.source,
      entries: payload.entries.map((e, idx) => ({
        playerId: Number(e.playerId),
        rawScore: Number(e.rawScore),
        penalty: Number(e.penalty || 0),
        seatIndex: e.seatIndex !== undefined ? Number(e.seatIndex) : idx,
      })),
      rounds: payload.source === 'scorer' ? payload.rounds || null : null,
      submittedAt: Date.now(),
      submittedBy: payload.submittedBy?.trim() || (isStaff ? 'Staff' : 'Table'),
      note: payload.note?.trim() || '',
    };
    const audit: EventAuditEntry = {
      id: `sb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      action: prev ? 'update' : 'submit',
      key,
      round: payload.round,
      table: payload.table,
      actor: isStaff ? 'staff' : 'participant',
      actorLabel: stored.submittedBy,
      summary: `${key} ${prev ? 'updated' : 'submitted'} (${payload.source})`,
      before: prev,
      after: stored,
    };
    return saveSandboxState({
      ...cur,
      results: { ...cur.results, [key]: stored },
      auditLog: [audit, ...cur.auditLog].slice(0, 80),
    });
  }

  const res = await fetch(`${getApiBase()}/result`, {
    method: 'POST',
    headers: buildAuthHeaders(staffPin),
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Failed to submit result (HTTP ${res.status})`);
  }
  const nextState: EventStatePayload = {
    updatedAt: Number(data.state?.updatedAt || Date.now()),
    config: normalizeConfig(data.state?.config),
    results: data.state?.results || {},
    auditLog: Array.isArray(data.state?.auditLog) ? data.state.auditLog : [],
    serverTime: Date.now(),
  };
  broadcastEventStateUpdate(nextState, false);
  return nextState;
}

export async function deleteTableResult(
  round: number,
  table: number,
  sandbox = false,
  staffPin?: string
): Promise<EventStatePayload> {
  const key = getMatchKey(round, table);
  if (sandbox) {
    const pin = staffPin ?? getSavedStaffPin();
    if (!pin || pin !== getSandboxPin()) {
      throw new Error('Staff authentication required.');
    }
    const cur = loadSandboxState();
    const prev = cur.results[key] || null;
    const nextResults = { ...cur.results };
    delete nextResults[key];
    const audit: EventAuditEntry = {
      id: `sb-del-${Date.now()}`,
      timestamp: Date.now(),
      action: 'delete',
      key,
      round,
      table,
      actor: 'staff',
      actorLabel: 'Staff',
      summary: `${key} deleted`,
      before: prev,
      after: null,
    };
    return saveSandboxState({
      ...cur,
      results: nextResults,
      auditLog: [audit, ...cur.auditLog].slice(0, 80),
    });
  }

  const res = await fetch(`${getApiBase()}/result?round=${round}&table=${table}`, {
    method: 'DELETE',
    headers: buildAuthHeaders(staffPin),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Failed to delete result (HTTP ${res.status})`);
  }
  const nextState: EventStatePayload = {
    updatedAt: Number(data.state?.updatedAt || Date.now()),
    config: normalizeConfig(data.state?.config),
    results: data.state?.results || {},
    auditLog: Array.isArray(data.state?.auditLog) ? data.state.auditLog : [],
    serverTime: Date.now(),
  };
  broadcastEventStateUpdate(nextState, false);
  return nextState;
}

export async function verifyStaffPin(pin: string, sandbox = false): Promise<boolean> {
  const cleanPin = String(pin || '').trim();
  if (!cleanPin) return false;
  if (sandbox) {
    return cleanPin === getSandboxPin();
  }
  const res = await fetch(`${getApiBase()}/staff/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Event-Staff-Pin': cleanPin,
    },
    body: JSON.stringify({ pin: cleanPin }),
  });
  if (!res.ok) return false;
  const data = await res.json().catch(() => ({}));
  return Boolean(data.ok);
}

export async function updateEventConfig(
  patch: Partial<EventScoringConfig> & { newStaffPin?: string },
  sandbox = false,
  staffPin?: string
): Promise<EventStatePayload> {
  if (sandbox) {
    const pin = staffPin ?? getSavedStaffPin();
    if (!pin || pin !== getSandboxPin()) {
      throw new Error('Staff authentication required.');
    }
    const cur = loadSandboxState();
    const { newStaffPin, ...configPatch } = patch;
    if (newStaffPin && newStaffPin.trim().length >= 4) {
      localStorage.setItem(SANDBOX_PIN_STORAGE_KEY, newStaffPin.trim());
      saveStaffPin(newStaffPin.trim());
    }
    const nextConfig = normalizeConfig({ ...cur.config, ...configPatch });
    const audit: EventAuditEntry = {
      id: `sb-cfg-${Date.now()}`,
      timestamp: Date.now(),
      action: 'config',
      actor: 'staff',
      actorLabel: 'Staff',
      summary: newStaffPin ? 'Updated Staff PIN & settings' : 'Updated league rules / locks',
    };
    return saveSandboxState({
      ...cur,
      config: nextConfig,
      auditLog: [audit, ...cur.auditLog].slice(0, 80),
    });
  }

  const res = await fetch(`${getApiBase()}/staff/config`, {
    method: 'POST',
    headers: buildAuthHeaders(staffPin),
    body: JSON.stringify(patch),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Failed to update settings (HTTP ${res.status})`);
  }
  if (patch.newStaffPin && patch.newStaffPin.trim().length >= 4) {
    saveStaffPin(patch.newStaffPin.trim());
  }
  const nextState: EventStatePayload = {
    updatedAt: Number(data.state?.updatedAt || Date.now()),
    config: normalizeConfig(data.state?.config),
    results: data.state?.results || {},
    auditLog: Array.isArray(data.state?.auditLog) ? data.state.auditLog : [],
    serverTime: Date.now(),
  };
  broadcastEventStateUpdate(nextState, false);
  return nextState;
}

export async function rollbackAuditEntry(
  auditId: string,
  sandbox = false,
  staffPin?: string
): Promise<EventStatePayload> {
  if (sandbox) {
    const pin = staffPin ?? getSavedStaffPin();
    if (!pin || pin !== getSandboxPin()) {
      throw new Error('Staff authentication required.');
    }
    const cur = loadSandboxState();
    const target = cur.auditLog.find((a) => a.id === auditId);
    if (!target || !target.key) {
      throw new Error('Audit entry cannot be rolled back.');
    }
    const prevCurrent = cur.results[target.key] || null;
    const nextResults = { ...cur.results };
    if (target.before) {
      nextResults[target.key] = target.before;
    } else {
      delete nextResults[target.key];
    }
    const audit: EventAuditEntry = {
      id: `sb-rb-${Date.now()}`,
      timestamp: Date.now(),
      action: 'rollback',
      key: target.key,
      round: target.round,
      table: target.table,
      actor: 'staff',
      actorLabel: 'Staff',
      summary: `${target.key} rolled back`,
      before: prevCurrent,
      after: target.before || null,
    };
    return saveSandboxState({
      ...cur,
      results: nextResults,
      auditLog: [audit, ...cur.auditLog].slice(0, 80),
    });
  }

  const res = await fetch(`${getApiBase()}/staff/rollback`, {
    method: 'POST',
    headers: buildAuthHeaders(staffPin),
    body: JSON.stringify({ auditId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Failed to rollback entry (HTTP ${res.status})`);
  }
  const nextState: EventStatePayload = {
    updatedAt: Number(data.state?.updatedAt || Date.now()),
    config: normalizeConfig(data.state?.config),
    results: data.state?.results || {},
    auditLog: Array.isArray(data.state?.auditLog) ? data.state.auditLog : [],
    serverTime: Date.now(),
  };
  broadcastEventStateUpdate(nextState, false);
  return nextState;
}
