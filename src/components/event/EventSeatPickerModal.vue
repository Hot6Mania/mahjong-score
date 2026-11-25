<script setup lang="ts">
import { ref, watch } from 'vue';
import {
  EVENT_PLAYER_MAP,
  EVENT_TEAM_MAP,
  formatEventPlayerName,
  type EventMatchSlot,
  type EventNameLocale,
} from '@/data/knuNpm2026';
import { secureShuffle } from '@/utils/random';

interface Props {
  slot: EventMatchSlot;
  eventLocale: EventNameLocale;
  tr: (key: string, params?: Record<string, string | number>) => string;
}
const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'launch', seatPlayerIds: [number, number, number, number]): void;
}>();

const seats = ref<number[]>([...props.slot.playerIds]);

watch(
  () => props.slot.key,
  () => {
    seats.value = [...props.slot.playerIds];
  }
);

const seatKeys = ['seatEast', 'seatSouth', 'seatWest', 'seatNorth'] as const;
const winds = ['東', '南', '西', '北'] as const;

const moveSeat = (index: number, delta: number) => {
  const target = index + delta;
  if (target < 0 || target >= 4) return;
  const next = [...seats.value];
  const tmp = next[index];
  next[index] = next[target];
  next[target] = tmp;
  seats.value = next;
};

const shuffleSeats = () => {
  seats.value = secureShuffle([...seats.value]);
};

const launch = () => {
  emit('launch', [seats.value[0], seats.value[1], seats.value[2], seats.value[3]]);
};
</script>

<template>
  <div class="ev-modal-backdrop" @click.self="emit('close')">
    <div class="ev-modal-card seat-picker-card">
      <div class="ev-modal-header">
        <div>
          <h3 class="ev-modal-title">{{ tr('seatPickerTitle', { r: slot.round, t: slot.table }) }}</h3>
          <p class="ev-modal-sub">{{ tr('seatPickerDesc') }}</p>
        </div>
        <button class="ev-icon-close" @click="emit('close')" aria-label="Close">✕</button>
      </div>

      <div class="seat-list">
        <div v-for="(pid, idx) in seats" :key="pid" class="seat-row">
          <div class="seat-wind-pill" :class="`wind-${idx}`">
            <span class="wind-kanji">{{ winds[idx] }}</span>
            <span class="wind-label">{{ tr(seatKeys[idx]) }}</span>
          </div>

          <div class="seat-player-info">
            <span
              class="team-dot"
              :style="{ backgroundColor: EVENT_TEAM_MAP[EVENT_PLAYER_MAP[pid].teamId].color }"
            ></span>
            <span class="seat-pid">#{{ pid }}</span>
            <span class="seat-name">{{ formatEventPlayerName(EVENT_PLAYER_MAP[pid], eventLocale, 'full') }}</span>
            <span v-if="EVENT_PLAYER_MAP[pid].isPro" class="pro-chip">{{ tr('proBadge') }}</span>
            <span
              class="team-chip"
              :style="{
                color: EVENT_TEAM_MAP[EVENT_PLAYER_MAP[pid].teamId].color,
                backgroundColor: EVENT_TEAM_MAP[EVENT_PLAYER_MAP[pid].teamId].bgTint,
              }"
            >
              {{ EVENT_PLAYER_MAP[pid].teamId }}
            </span>
          </div>

          <div class="seat-order-btns">
            <button
              type="button"
              class="btn-order"
              :disabled="idx === 0"
              @click="moveSeat(idx, -1)"
              :title="tr('moveUp')"
            >
              ↑
            </button>
            <button
              type="button"
              class="btn-order"
              :disabled="idx === 3"
              @click="moveSeat(idx, 1)"
              :title="tr('moveDown')"
            >
              ↓
            </button>
          </div>
        </div>
      </div>

      <div class="ev-modal-footer">
        <button type="button" class="btn-secondary" @click="shuffleSeats">
          🎲 {{ tr('shuffleSeats') }}
        </button>
        <div class="footer-right">
          <button type="button" class="btn-ghost" @click="emit('close')">
            {{ tr('cancel') }}
          </button>
          <button type="button" class="btn-primary" @click="launch">
            ▶ {{ tr('launchScorerBtn') }}
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
  background: rgba(15, 23, 42, 0.65);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1200;
  padding: 12px;
  box-sizing: border-box;
}

.seat-picker-card {
  width: 100%;
  max-width: 520px;
  max-height: 92vh;
  max-height: 92dvh;
  display: flex;
  flex-direction: column;
  background: var(--card-bg-color);
  color: var(--text-color);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  box-shadow: 0 20px 45px rgba(0, 0, 0, 0.35);
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans KR', 'Noto Sans JP', sans-serif;
}

.ev-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding: 15px 18px 12px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.ev-modal-title {
  font-size: 17px;
  font-weight: 800;
  margin: 0;
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
.ev-icon-close:hover {
  background: var(--bg-hover-color);
  color: var(--text-color);
}

.seat-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  overflow-y: auto;
  flex: 1 1 auto;
  min-height: 0;
  -webkit-overflow-scrolling: touch;
}

.seat-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-card);
}

.seat-wind-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  min-width: 82px;
  justify-content: center;
  color: #fff;
  flex-shrink: 0;
}
.wind-0 { background: #dc2626; }
.wind-1 { background: #2563eb; }
.wind-2 { background: #d97706; }
.wind-3 { background: #7c3aed; }
.wind-kanji { font-size: 14px; }

.seat-player-info {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.team-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.seat-pid {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--text-dimmed);
}
.seat-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-color);
}
.pro-chip {
  font-size: 10px;
  font-weight: 800;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(245, 158, 11, 0.18);
  color: #d97706;
  border: 1px solid rgba(245, 158, 11, 0.45);
}
.team-chip {
  font-size: 11px;
  font-weight: 800;
  padding: 1px 6px;
  border-radius: 4px;
}

.seat-order-btns {
  display: flex;
  gap: 4px;
}

.btn-order {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  background: var(--card-bg-color);
  color: var(--text-color);
  cursor: pointer;
  font-weight: 700;
}
.btn-order:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.ev-modal-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 16px 14px;
  border-top: 1px solid var(--border-color);
  flex-shrink: 0;
}

@media (max-width: 520px) {
  .ev-modal-backdrop {
    padding: 8px;
  }
  .ev-modal-header {
    padding: 12px 14px 10px;
  }
  .ev-modal-title {
    font-size: 15.5px;
  }
  .ev-modal-sub {
    font-size: 11.5px;
  }
  .seat-list {
    padding: 10px 12px;
    gap: 7px;
  }
  .seat-row {
    padding: 8px 9px;
    gap: 7px;
  }
  .seat-wind-pill {
    min-width: 58px;
    padding: 3px 6px;
    font-size: 11px;
  }
  .seat-name {
    font-size: 13px;
  }
  .ev-modal-footer {
    padding: 10px 12px 12px;
  }
  .btn-primary,
  .btn-secondary,
  .btn-ghost {
    padding: 7px 10px;
    font-size: 12px;
  }
}

.footer-right {
  display: flex;
  gap: 8px;
}

.btn-primary,
.btn-secondary,
.btn-ghost {
  padding: 8px 14px;
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
.btn-primary:hover {
  background: #1d4ed8;
}
.btn-secondary {
  background: var(--bg-card);
  color: var(--text-color);
  border-color: var(--border-color);
}
.btn-ghost {
  background: transparent;
  color: var(--text-dimmed);
  border-color: var(--border-color);
}
</style>
