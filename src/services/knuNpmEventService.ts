import {
  DEFAULT_EVENT_CONFIG,
  getMatchKey,
  getMatchSlot,
  type EventRoundTimer,
  type EventScoringConfig,
} from '@/data/knuNpm2026';
import {
  generateEdgeCaseEventResults,
  generateSampleEventResults,
  generateSampleLiveGames,
  normalizeConfig,
  type CompactRoundRecords,
  type EventAuditEntry,
  type EventStatePayload,
  type LiveStatePayload,
  type LiveTableState,
  type ResultSource,
  type StoredTableResult,
  type TableScoreEntryInput,
} from '@/utils/knuNpmScoring';

const DEFAULT_WORKER_URL =
  import.meta.env.VITE_GOOGLE_AUTH_WORKER_URL || 'https://mahjong-score.cnabe.workers.dev';
const LIVE_API_PREFIX = '/api/event/knu-npm-2026';
const SANDBOX_API_PREFIX = '/api/event/knu-npm-2026-sandbox';

const STAFF_PIN_SESSION_KEY = 'knu_npm_2026_staff_pin';
const SANDBOX_STATE_STORAGE_KEY = 'knu_npm_2026_sandbox_state_v1';
const SANDBOX_LIVE_STORAGE_KEY = 'knu_npm_2026_sandbox_live_v1';
const SANDBOX_PIN_STORAGE_KEY = 'knu_npm_2026_sandbox_pin_v1';
const STATE_SYNC_STORAGE_KEY = 'knu_npm_2026_state_sync_signal_v1';
const LIVE_SYNC_STORAGE_KEY = 'knu_npm_2026_live_sync_signal_v1';
const DEFAULT_SANDBOX_PIN = '20261128';
const SYNC_CHANNEL_NAME = 'knu-npm-2026-sync';
const SYNC_WINDOW_EVENT = 'knu-npm-2026-state-updated';
const LIVE_WINDOW_EVENT = 'knu-npm-2026-live-updated';

let serverClockOffsetMs = 0;

function recordServerTime(serverTime?: number | null): void {
  if (serverTime && Number.isFinite(Number(serverTime))) {
    serverClockOffsetMs = Number(serverTime) - Date.now();
  }
}

export function getSyncedNowMs(_sandbox = false): number {
  return Date.now() + serverClockOffsetMs;
}

function getApiBase(sandbox = false): string {
  const prefix = sandbox ? SANDBOX_API_PREFIX : LIVE_API_PREFIX;
  return `${DEFAULT_WORKER_URL.replace(/\/$/, '')}${prefix}`;
}

export function broadcastLiveStateUpdate(liveState: LiveStatePayload, sandbox: boolean): void {
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(LIVE_WINDOW_EVENT, { detail: { liveState, sandbox } }));
    }
  } catch {}
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const ch = new BroadcastChannel(SYNC_CHANNEL_NAME);
      ch.postMessage({ type: 'live', liveState, sandbox });
      ch.close();
    }
  } catch {}
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(
        LIVE_SYNC_STORAGE_KEY,
        JSON.stringify({ liveState, sandbox, ts: Date.now() })
      );
    }
  } catch {}
}

export function subscribeLiveStateUpdates(
  onUpdate: (payload: { liveState: LiveStatePayload; sandbox: boolean }) => void
): () => void {
  const winHandler = (e: Event) => {
    const detail = (e as CustomEvent)?.detail;
    if (detail && detail.liveState) onUpdate(detail);
  };
  const storageHandler = (e: StorageEvent) => {
    if (e.key !== LIVE_SYNC_STORAGE_KEY || !e.newValue) return;
    try {
      const parsed = JSON.parse(e.newValue);
      if (parsed && parsed.liveState) {
        onUpdate({ liveState: parsed.liveState, sandbox: Boolean(parsed.sandbox) });
      }
    } catch {}
  };
  if (typeof window !== 'undefined') {
    window.addEventListener(LIVE_WINDOW_EVENT, winHandler);
    window.addEventListener('storage', storageHandler);
  }
  let ch: BroadcastChannel | null = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      ch = new BroadcastChannel(SYNC_CHANNEL_NAME);
      ch.onmessage = (ev) => {
        if (ev.data && ev.data.type === 'live' && ev.data.liveState) onUpdate(ev.data);
      };
    }
  } catch {}
  return () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener(LIVE_WINDOW_EVENT, winHandler);
      window.removeEventListener('storage', storageHandler);
    }
    if (ch) ch.close();
  };
}

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
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(
        STATE_SYNC_STORAGE_KEY,
        JSON.stringify({ state, sandbox, ts: Date.now() })
      );
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
  const storageHandler = (e: StorageEvent) => {
    if (e.key !== STATE_SYNC_STORAGE_KEY || !e.newValue) return;
    try {
      const parsed = JSON.parse(e.newValue);
      if (parsed && parsed.state) {
        onUpdate({ state: parsed.state, sandbox: Boolean(parsed.sandbox) });
      }
    } catch {}
  };
  if (typeof window !== 'undefined') {
    window.addEventListener(SYNC_WINDOW_EVENT, winHandler);
    window.addEventListener('storage', storageHandler);
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
      window.removeEventListener('storage', storageHandler);
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

function normalizeServerEventState(raw: any, serverTime?: number | null): EventStatePayload {
  recordServerTime(serverTime ?? raw?.serverTime);
  return {
    updatedAt: Number(raw?.updatedAt || 0),
    config: normalizeConfig(raw?.config),
    results: raw?.results && typeof raw.results === 'object' ? raw.results : {},
    auditLog: Array.isArray(raw?.auditLog) ? raw.auditLog : [],
    serverTime: Number(serverTime ?? raw?.serverTime ?? Date.now()),
  };
}

function normalizeServerLiveState(raw: any, serverTime?: number | null): LiveStatePayload {
  recordServerTime(serverTime ?? raw?.serverTime);
  return {
    updatedAt: Number(raw?.updatedAt || 0),
    liveGames: raw?.liveGames && typeof raw.liveGames === 'object' ? raw.liveGames : {},
    serverTime: Number(serverTime ?? raw?.serverTime ?? Date.now()),
  };
}

// ================================
// Local Sandbox Cache & Offline Fallback Engine
// ================================
function loadSandboxStateLocal(): EventStatePayload {
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

function mirrorSandboxStateLocal(state: EventStatePayload, shouldBroadcast = true): EventStatePayload {
  try {
    localStorage.setItem(SANDBOX_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch {}
  if (shouldBroadcast) {
    broadcastEventStateUpdate(state, true);
  }
  return state;
}

function saveSandboxStateLocal(state: EventStatePayload): EventStatePayload {
  const next: EventStatePayload = {
    ...state,
    updatedAt: Math.max(Date.now(), Number(state.updatedAt || 0) + 1),
    serverTime: Date.now(),
  };
  return mirrorSandboxStateLocal(next, true);
}

function getSandboxPinLocal(): string {
  try {
    return localStorage.getItem(SANDBOX_PIN_STORAGE_KEY) || DEFAULT_SANDBOX_PIN;
  } catch {
    return DEFAULT_SANDBOX_PIN;
  }
}

function loadSandboxLiveStateLocal(): LiveStatePayload {
  try {
    const raw = localStorage.getItem(SANDBOX_LIVE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        updatedAt: Number(parsed.updatedAt || 0),
        liveGames: parsed.liveGames && typeof parsed.liveGames === 'object' ? parsed.liveGames : {},
        serverTime: Date.now(),
      };
    }
  } catch {}
  return { updatedAt: 0, liveGames: {}, serverTime: Date.now() };
}

function mirrorSandboxLiveStateLocal(liveState: LiveStatePayload, shouldBroadcast = true): LiveStatePayload {
  try {
    localStorage.setItem(SANDBOX_LIVE_STORAGE_KEY, JSON.stringify(liveState));
  } catch {}
  if (shouldBroadcast) {
    broadcastLiveStateUpdate(liveState, true);
  }
  return liveState;
}

function saveSandboxLiveStateLocal(liveState: LiveStatePayload): LiveStatePayload {
  const next: LiveStatePayload = {
    updatedAt: Math.max(Date.now(), Number(liveState.updatedAt || 0) + 1),
    liveGames: liveState.liveGames && typeof liveState.liveGames === 'object' ? liveState.liveGames : {},
    serverTime: Date.now(),
  };
  return mirrorSandboxLiveStateLocal(next, true);
}

async function syncSandboxReplaceState(
  body: {
    config?: EventScoringConfig;
    results?: Record<string, StoredTableResult>;
    auditLog?: EventAuditEntry[];
    clearLive?: boolean;
  },
  fallbackLocal: EventStatePayload
): Promise<EventStatePayload> {
  try {
    const res = await fetch(`${getApiBase(true)}/sandbox/replace-state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return fallbackLocal;
    const data = await res.json().catch(() => null);
    if (!data?.state) return fallbackLocal;
    const next = normalizeServerEventState(data.state, data.serverTime);
    mirrorSandboxStateLocal(next, true);
    if (body.clearLive) {
      mirrorSandboxLiveStateLocal({ updatedAt: next.updatedAt, liveGames: {}, serverTime: next.serverTime }, true);
    }
    return next;
  } catch {
    return fallbackLocal;
  }
}

async function syncSandboxReplaceLive(
  liveGames: Record<string, LiveTableState>,
  fallbackLocal: LiveStatePayload
): Promise<LiveStatePayload> {
  try {
    const res = await fetch(`${getApiBase(true)}/sandbox/replace-live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ liveGames }),
    });
    if (!res.ok) return fallbackLocal;
    const data = await res.json().catch(() => null);
    if (!data?.liveState) return fallbackLocal;
    const next = normalizeServerLiveState(data.liveState, data.serverTime);
    mirrorSandboxLiveStateLocal(next, true);
    return next;
  } catch {
    return fallbackLocal;
  }
}

// ================================
// Sandbox Helper Actions (Synced Across Devices via Isolated Sandbox Server)
// ================================
export async function updateSandboxQuickTimer(timer: EventRoundTimer): Promise<EventStatePayload> {
  const cur = loadSandboxStateLocal();
  const nextConfig = normalizeConfig({ ...cur.config, roundTimer: timer });
  const localNext = saveSandboxStateLocal({
    ...cur,
    config: nextConfig,
  });
  return await syncSandboxReplaceState({ config: nextConfig }, localNext);
}

export async function seedSandboxData(roundCount: number): Promise<EventStatePayload> {
  const cur = loadSandboxStateLocal();
  const sampleResults = generateSampleEventResults(roundCount, cur.config);
  const auditEntry: EventAuditEntry = {
    id: `sb-seed-${Date.now()}`,
    timestamp: Date.now(),
    action: 'config',
    actor: 'staff',
    actorLabel: 'Sandbox',
    summary: `Seeded ${Object.keys(sampleResults).length} sample games (R1–R${roundCount})`,
  };
  const nextAudit = [auditEntry, ...cur.auditLog].slice(0, 80);
  const localNext = saveSandboxStateLocal({
    ...cur,
    results: sampleResults,
    auditLog: nextAudit,
  });
  return await syncSandboxReplaceState(
    { results: sampleResults, auditLog: nextAudit },
    localNext
  );
}

export async function seedSandboxEdgeCases(): Promise<EventStatePayload> {
  const cur = loadSandboxStateLocal();
  const edgeResults = generateEdgeCaseEventResults(cur.config);
  const nextResults = { ...cur.results, ...edgeResults };
  const auditEntry: EventAuditEntry = {
    id: `sb-edge-${Date.now()}`,
    timestamp: Date.now(),
    action: 'config',
    actor: 'staff',
    actorLabel: 'Sandbox QA',
    summary: 'Seeded 4 edge-case matches (2-way tie, 4-way 25k tie, negative+chombo, JP-C)',
  };
  const nextAudit = [auditEntry, ...cur.auditLog].slice(0, 80);
  const localNext = saveSandboxStateLocal({
    ...cur,
    results: nextResults,
    auditLog: nextAudit,
  });
  return await syncSandboxReplaceState(
    { results: nextResults, auditLog: nextAudit },
    localNext
  );
}

export async function resetSandboxData(): Promise<EventStatePayload> {
  try {
    localStorage.removeItem(SANDBOX_STATE_STORAGE_KEY);
    localStorage.removeItem(SANDBOX_LIVE_STORAGE_KEY);
  } catch {}
  const emptyLive: LiveStatePayload = { updatedAt: Date.now(), liveGames: {}, serverTime: Date.now() };
  broadcastLiveStateUpdate(emptyLive, true);
  const defaultConfig = normalizeConfig(DEFAULT_EVENT_CONFIG);
  const localNext = saveSandboxStateLocal({
    updatedAt: Date.now(),
    config: defaultConfig,
    results: {},
    auditLog: [],
    serverTime: Date.now(),
  });
  return await syncSandboxReplaceState(
    { config: defaultConfig, results: {}, auditLog: [], clearLive: true },
    localNext
  );
}

export async function seedSandboxLiveGames(round = 1): Promise<LiveStatePayload> {
  const curState = loadSandboxStateLocal();
  const sampleLive = generateSampleLiveGames(round, curState.config);
  const localNext = saveSandboxLiveStateLocal({
    updatedAt: Date.now(),
    liveGames: sampleLive,
    serverTime: Date.now(),
  });
  return await syncSandboxReplaceLive(sampleLive, localNext);
}

export async function clearSandboxLiveGames(): Promise<LiveStatePayload> {
  const localNext = saveSandboxLiveStateLocal({
    updatedAt: Date.now(),
    liveGames: {},
    serverTime: Date.now(),
  });
  return await syncSandboxReplaceLive({}, localNext);
}

// ================================
// Live Table Checkpoint API (Live + Server-Synced Sandbox)
// ================================
export async function fetchLiveState(sandbox = false, force = false): Promise<LiveStatePayload> {
  const qs = force ? `?force=1&t=${Date.now()}` : `?t=${Date.now()}`;
  try {
    const res = await fetch(`${getApiBase(sandbox)}/live${qs}`, { method: 'GET', cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to fetch live state (HTTP ${res.status})`);
    const data = await res.json();
    const next = normalizeServerLiveState(data, data.serverTime);
    if (sandbox) mirrorSandboxLiveStateLocal(next, false);
    return next;
  } catch (err) {
    if (sandbox) return loadSandboxLiveStateLocal();
    throw err;
  }
}

export async function fetchLiveStateIfChanged(
  sandbox: boolean,
  sinceUpdatedAt: number
): Promise<{ unchanged: true; updatedAt: number } | { unchanged: false; liveState: LiveStatePayload }> {
  const qs = sinceUpdatedAt > 0 ? `?since=${sinceUpdatedAt}&t=${Date.now()}` : `?t=${Date.now()}`;
  try {
    const res = await fetch(`${getApiBase(sandbox)}/live${qs}`, { method: 'GET', cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to sync live state (HTTP ${res.status})`);
    const data = await res.json();
    recordServerTime(data.serverTime);
    if (data.unchanged === true) {
      return { unchanged: true, updatedAt: Number(data.updatedAt || sinceUpdatedAt) };
    }
    const next = normalizeServerLiveState(data, data.serverTime);
    if (sandbox) mirrorSandboxLiveStateLocal(next, false);
    return { unchanged: false, liveState: next };
  } catch (err) {
    if (sandbox) {
      const cur = loadSandboxLiveStateLocal();
      if (sinceUpdatedAt > 0 && cur.updatedAt <= sinceUpdatedAt) {
        return { unchanged: true, updatedAt: cur.updatedAt };
      }
      return { unchanged: false, liveState: cur };
    }
    throw err;
  }
}

export async function upsertLiveTableState(
  snapshot: Omit<LiveTableState, 'key' | 'updatedAt'>,
  sandbox = false,
  localOnly = false
): Promise<LiveStatePayload> {
  const key = getMatchKey(snapshot.round, snapshot.table);
  if (sandbox && localOnly) {
    const cur = loadSandboxLiveStateLocal();
    const full: LiveTableState = {
      ...snapshot,
      key,
      updatedAt: Date.now(),
    };
    return saveSandboxLiveStateLocal({
      updatedAt: Date.now(),
      liveGames: { ...cur.liveGames, [key]: full },
    });
  }
  try {
    const res = await fetch(`${getApiBase(sandbox)}/live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Failed to save live checkpoint (HTTP ${res.status})`);
    }
    const nextLive = normalizeServerLiveState(data.liveState, data.serverTime);
    if (sandbox) mirrorSandboxLiveStateLocal(nextLive, true);
    else broadcastLiveStateUpdate(nextLive, false);
    return nextLive;
  } catch (err) {
    if (sandbox) {
      const cur = loadSandboxLiveStateLocal();
      const full: LiveTableState = {
        ...snapshot,
        key,
        updatedAt: Date.now(),
      };
      return saveSandboxLiveStateLocal({
        updatedAt: Date.now(),
        liveGames: { ...cur.liveGames, [key]: full },
      });
    }
    throw err;
  }
}

export async function clearLiveTableState(
  round: number,
  table: number,
  sandbox = false
): Promise<LiveStatePayload> {
  const key = getMatchKey(round, table);
  try {
    const res = await fetch(`${getApiBase(sandbox)}/live?round=${round}&table=${table}`, {
      method: 'DELETE',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Failed to clear live checkpoint (HTTP ${res.status})`);
    }
    const nextLive = normalizeServerLiveState(data.liveState, data.serverTime);
    if (sandbox) mirrorSandboxLiveStateLocal(nextLive, true);
    else broadcastLiveStateUpdate(nextLive, false);
    return nextLive;
  } catch (err) {
    if (sandbox) {
      const cur = loadSandboxLiveStateLocal();
      const nextGames = { ...cur.liveGames };
      delete nextGames[key];
      return saveSandboxLiveStateLocal({ updatedAt: Date.now(), liveGames: nextGames });
    }
    throw err;
  }
}

// ================================
// Unified Public / Staff API Functions (Live + Server-Synced Sandbox)
// ================================

export async function fetchEventState(sandbox = false, force = false): Promise<EventStatePayload> {
  const qs = force ? `?force=1&t=${Date.now()}` : `?t=${Date.now()}`;
  try {
    const res = await fetch(`${getApiBase(sandbox)}/state${qs}`, {
      method: 'GET',
      cache: 'no-store',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Failed to fetch event state (HTTP ${res.status})`);
    }
    const data = await res.json();
    const next = normalizeServerEventState(data, data.serverTime);
    if (sandbox) mirrorSandboxStateLocal(next, false);
    return next;
  } catch (err) {
    if (sandbox) return loadSandboxStateLocal();
    throw err;
  }
}

/**
 * 초경량 조건부 폴링: 서버에 변경이 없으면 { unchanged: true }만 수신해 트래픽·렌더링 부하 최소화
 */
export async function fetchEventStateIfChanged(
  sandbox: boolean,
  sinceUpdatedAt: number
): Promise<{ unchanged: true; updatedAt: number } | { unchanged: false; state: EventStatePayload }> {
  const qs = sinceUpdatedAt > 0 ? `?since=${sinceUpdatedAt}&t=${Date.now()}` : `?t=${Date.now()}`;
  try {
    const res = await fetch(`${getApiBase(sandbox)}/state${qs}`, {
      method: 'GET',
      cache: 'no-store',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Failed to sync event state (HTTP ${res.status})`);
    }
    const data = await res.json();
    recordServerTime(data.serverTime);
    if (data.unchanged === true) {
      return { unchanged: true, updatedAt: Number(data.updatedAt || sinceUpdatedAt) };
    }
    const next = normalizeServerEventState(data, data.serverTime);
    if (sandbox) mirrorSandboxStateLocal(next, false);
    return { unchanged: false, state: next };
  } catch (err) {
    if (sandbox) {
      const cur = loadSandboxStateLocal();
      if (sinceUpdatedAt > 0 && cur.updatedAt <= sinceUpdatedAt) {
        return { unchanged: true, updatedAt: cur.updatedAt };
      }
      return { unchanged: false, state: cur };
    }
    throw err;
  }
}

export interface SubmitTableResultPayload {
  round: number;
  table: number;
  source: ResultSource;
  entries: TableScoreEntryInput[];
  riichiSticks?: number;
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

  try {
    const res = await fetch(`${getApiBase(sandbox)}/result`, {
      method: 'POST',
      headers: buildAuthHeaders(staffPin),
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (sandbox && res.status === 404) {
        throw new Error('__SANDBOX_FALLBACK__');
      }
      throw new Error(data.error || `Failed to submit result (HTTP ${res.status})`);
    }
    const nextState = normalizeServerEventState(data.state, data.serverTime);
    if (sandbox) mirrorSandboxStateLocal(nextState, true);
    else broadcastEventStateUpdate(nextState, false);
    return nextState;
  } catch (err: any) {
    const isNetworkOrMissingRoute =
      sandbox && (err?.message === '__SANDBOX_FALLBACK__' || err instanceof TypeError);
    if (!isNetworkOrMissingRoute) throw err;

    const cur = loadSandboxStateLocal();
    const pin = staffPin ?? getSavedStaffPin();
    const isStaff = Boolean(pin && pin === getSandboxPinLocal());
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
      riichiSticks: Math.max(0, Math.floor(Number(payload.riichiSticks) || 0)),
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
    return saveSandboxStateLocal({
      ...cur,
      results: { ...cur.results, [key]: stored },
      auditLog: [audit, ...cur.auditLog].slice(0, 80),
    });
  }
}

export async function deleteTableResult(
  round: number,
  table: number,
  sandbox = false,
  staffPin?: string
): Promise<EventStatePayload> {
  const key = getMatchKey(round, table);
  try {
    const res = await fetch(`${getApiBase(sandbox)}/result?round=${round}&table=${table}`, {
      method: 'DELETE',
      headers: buildAuthHeaders(staffPin),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (sandbox && res.status === 404) throw new Error('__SANDBOX_FALLBACK__');
      throw new Error(data.error || `Failed to delete result (HTTP ${res.status})`);
    }
    const nextState = normalizeServerEventState(data.state, data.serverTime);
    if (sandbox) mirrorSandboxStateLocal(nextState, true);
    else broadcastEventStateUpdate(nextState, false);
    return nextState;
  } catch (err: any) {
    const isNetworkOrMissingRoute =
      sandbox && (err?.message === '__SANDBOX_FALLBACK__' || err instanceof TypeError);
    if (!isNetworkOrMissingRoute) throw err;

    const pin = staffPin ?? getSavedStaffPin();
    if (!pin || pin !== getSandboxPinLocal()) {
      throw new Error('Staff authentication required.');
    }
    const cur = loadSandboxStateLocal();
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
    return saveSandboxStateLocal({
      ...cur,
      results: nextResults,
      auditLog: [audit, ...cur.auditLog].slice(0, 80),
    });
  }
}

export async function verifyStaffPin(pin: string, sandbox = false): Promise<boolean> {
  const cleanPin = String(pin || '').trim();
  if (!cleanPin) return false;
  try {
    const res = await fetch(`${getApiBase(sandbox)}/staff/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Event-Staff-Pin': cleanPin,
      },
      body: JSON.stringify({ pin: cleanPin }),
    });
    if (sandbox && res.status === 404) {
      return cleanPin === getSandboxPinLocal();
    }
    if (!res.ok) return false;
    const data = await res.json().catch(() => ({}));
    return Boolean(data.ok);
  } catch {
    if (sandbox) return cleanPin === getSandboxPinLocal();
    return false;
  }
}

export async function updateEventConfig(
  patch: Partial<EventScoringConfig> & { newStaffPin?: string },
  sandbox = false,
  staffPin?: string
): Promise<EventStatePayload> {
  try {
    const res = await fetch(`${getApiBase(sandbox)}/staff/config`, {
      method: 'POST',
      headers: buildAuthHeaders(staffPin),
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (sandbox && res.status === 404) throw new Error('__SANDBOX_FALLBACK__');
      throw new Error(data.error || `Failed to update settings (HTTP ${res.status})`);
    }
    if (patch.newStaffPin && patch.newStaffPin.trim().length >= 4) {
      saveStaffPin(patch.newStaffPin.trim());
    }
    const nextState = normalizeServerEventState(data.state, data.serverTime);
    if (sandbox) mirrorSandboxStateLocal(nextState, true);
    else broadcastEventStateUpdate(nextState, false);
    return nextState;
  } catch (err: any) {
    const isNetworkOrMissingRoute =
      sandbox && (err?.message === '__SANDBOX_FALLBACK__' || err instanceof TypeError);
    if (!isNetworkOrMissingRoute) throw err;

    const pin = staffPin ?? getSavedStaffPin();
    if (!pin || pin !== getSandboxPinLocal()) {
      throw new Error('Staff authentication required.');
    }
    const cur = loadSandboxStateLocal();
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
    return saveSandboxStateLocal({
      ...cur,
      config: nextConfig,
      auditLog: [audit, ...cur.auditLog].slice(0, 80),
    });
  }
}

export async function rollbackAuditEntry(
  auditId: string,
  sandbox = false,
  staffPin?: string
): Promise<EventStatePayload> {
  try {
    const res = await fetch(`${getApiBase(sandbox)}/staff/rollback`, {
      method: 'POST',
      headers: buildAuthHeaders(staffPin),
      body: JSON.stringify({ auditId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (sandbox && res.status === 404) throw new Error('__SANDBOX_FALLBACK__');
      throw new Error(data.error || `Failed to rollback entry (HTTP ${res.status})`);
    }
    const nextState = normalizeServerEventState(data.state, data.serverTime);
    if (sandbox) mirrorSandboxStateLocal(nextState, true);
    else broadcastEventStateUpdate(nextState, false);
    return nextState;
  } catch (err: any) {
    const isNetworkOrMissingRoute =
      sandbox && (err?.message === '__SANDBOX_FALLBACK__' || err instanceof TypeError);
    if (!isNetworkOrMissingRoute) throw err;

    const pin = staffPin ?? getSavedStaffPin();
    if (!pin || pin !== getSandboxPinLocal()) {
      throw new Error('Staff authentication required.');
    }
    const cur = loadSandboxStateLocal();
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
    return saveSandboxStateLocal({
      ...cur,
      results: nextResults,
      auditLog: [audit, ...cur.auditLog].slice(0, 80),
    });
  }
}
