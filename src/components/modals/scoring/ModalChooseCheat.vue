<script setup lang="ts">
import { useI18n } from "vue-i18n"

const { t } = useI18n()

type Emits = {
  (e: 'show-modal', type: string, status?: string): void
}
const emit = defineEmits<Emits>()
</script>

<template>
<!-- 촌보/벌부 선택창 -->
<div class="modal_choose_cheat_container">
  <div class="option_item cheat_option" @click.stop="emit('show-modal', 'check_player_cheat')">
    {{ t('panel.cheat') }}
  </div>
  <div class="separator_line"></div>
  <div class="option_item beolbu_option" @click.stop="emit('show-modal', 'check_player_beolbu')">
    {{ t('panel.beolbu') }}
  </div>
</div>
</template>

<style scoped>
.modal_choose_cheat_container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.option_item {
  font-size: 40px;
  margin: 15px 20px;
  cursor: pointer;
  font-weight: bold;
  transition: opacity 0.2s, transform 0.2s, color 0.2s;
  user-select: none;
}
.option_item:active {
  transform: scale(0.96);
}
.cheat_option {
  color: #888888; /* 촌보 회색 */
}
.cheat_option:hover {
  color: #aaaaaa;
}
.beolbu_option {
  color: var(--text-color); /* 다크모드 흰색, 라이트모드 검은색 자동 대응 */
}
.beolbu_option:hover {
  opacity: 0.8;
}
.separator_line {
  width: 120px;
  height: 1px;
  background-color: var(--border-color, rgba(255, 255, 255, 0.15));
  margin: 8px 0;
}
</style>
