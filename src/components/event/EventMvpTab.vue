<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  EVENT_PLAYER_MAP,
  EVENT_TEAM_MAP,
  formatEventPlayerName,
  type EventNameLocale,
} from '@/data/knuNpm2026';
import {
  formatSignedPoint,
  formatWinTierLabel,
  type EventMvpReport,
  type MvpReasonBadge,
} from '@/utils/knuNpmScoring';

interface Props {
  mvpReport: EventMvpReport;
  eventLocale: EventNameLocale;
  showNameParens: boolean;
}
const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'open-game-log', matchKey: string): void;
  (e: 'select-player', playerId: number): void;
}>();

const mvpScope = ref<'overall' | number>('overall');
const roleFilter = ref<'ALL' | 'PRO' | 'PLAYER'>('ALL');

const tLoc = (ko: string, en: string, ja: string) =>
  props.eventLocale === 'ja' ? ja : props.eventLocale === 'ko' ? ko : en;

const pName = (pid: number, style: 'full' | 'compact' = 'full') =>
  formatEventPlayerName(EVENT_PLAYER_MAP[pid] ?? pid, props.eventLocale, style, props.showNameParens);

const matchRole = (pid: number) => {
  const ep = EVENT_PLAYER_MAP[pid];
  if (!ep) return true;
  if (roleFilter.value === 'PRO') return ep.isPro;
  if (roleFilter.value === 'PLAYER') return !ep.isPro;
  return true;
};

const reasonText = (r: MvpReasonBadge) =>
  props.eventLocale === 'ja' ? r.ja : props.eventLocale === 'ko' ? r.ko : r.en;

const filteredOverallCandidates = computed(() =>
  props.mvpReport.overall.candidates.filter((c) => matchRole(c.playerId)).slice(0, 10)
);

const filteredOverallBigWins = computed(() =>
  props.mvpReport.overall.bigWins.filter((bw) => matchRole(bw.winnerId)).slice(0, 12)
);

const filteredOverallComebacks = computed(() =>
  props.mvpReport.overall.comebacks.filter((cb) => matchRole(cb.playerId)).slice(0, 12)
);

const activeRoundBucket = computed(() => {
  if (mvpScope.value === 'overall') return null;
  return props.mvpReport.byRound[mvpScope.value] || null;
});

const filteredRoundCandidates = computed(() => {
  if (!activeRoundBucket.value) return [];
  return activeRoundBucket.value.candidates.filter((c) => matchRole(c.playerId)).slice(0, 8);
});

const filteredRoundBigWins = computed(() => {
  if (!activeRoundBucket.value) return [];
  return activeRoundBucket.value.bigWins.filter((bw) => matchRole(bw.winnerId)).slice(0, 10);
});

const filteredRoundComebacks = computed(() => {
  if (!activeRoundBucket.value) return [];
  return activeRoundBucket.value.comebacks.filter((cb) => matchRole(cb.playerId)).slice(0, 10);
});

const medalFor = (idx: number) => (idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`);
</script>

<template>
  <div class="mvp-root">
    <!-- Scope & Role Filter Bar -->
    <div class="card-panel mvp-head-panel">
      <div class="mvp-head-top">
        <div>
          <h3 class="mvp-title">🏅 {{ tLoc('라운드별 · 전체 대회 MVP 후보', 'Round & Overall MVP Candidates', '回戦別・大会総合 MVP候補') }}</h3>
          <p class="mvp-sub">
            {{
              tLoc(
                '최종 성적(포인트·1위), 만관~역만급 큰 화료, 하위권/남장 대역전극, 무방총 완승을 종합해 MVP 후보를 자동 선정합니다.',
                'Auto-ranks MVP candidates combining match points, Mangan–Yakuman big wins, dramatic comebacks, and clean wins.',
                '最終ポイント・トップに加え、満貫〜役満級の高打点和了・大逆転劇・無放銃トップを総合評価してMVP候補を自動選出します。'
              )
            }}
          </p>
        </div>

        <div class="mvp-role-chips">
          <button type="button" class="mvp-chip" :class="{ active: roleFilter === 'ALL' }" @click="roleFilter = 'ALL'">
            {{ tLoc('전체', 'All', '全員') }}
          </button>
          <button type="button" class="mvp-chip" :class="{ active: roleFilter === 'PRO' }" @click="roleFilter = 'PRO'">
            {{ tLoc('프로만', 'Pros Only', 'プロのみ') }}
          </button>
          <button type="button" class="mvp-chip" :class="{ active: roleFilter === 'PLAYER' }" @click="roleFilter = 'PLAYER'">
            {{ tLoc('일반만', 'Players Only', '一般のみ') }}
          </button>
        </div>
      </div>

      <div class="mvp-scope-bar">
        <button
          type="button"
          class="mvp-scope-btn"
          :class="{ active: mvpScope === 'overall' }"
          @click="mvpScope = 'overall'"
        >
          🌟 {{ tLoc('전체 대회 MVP', 'Overall Tournament MVP', '大会総合 MVP') }}
        </button>
        <button
          v-for="r in [1, 2, 3, 4, 5, 6]"
          :key="r"
          type="button"
          class="mvp-scope-btn"
          :class="{ active: mvpScope === r }"
          @click="mvpScope = r"
        >
          <span>R{{ r }}</span>
          <span class="scope-cnt">{{ mvpReport.byRound[r]?.completedTables || 0 }}/7</span>
        </button>
      </div>
    </div>

    <!-- ========================= OVERALL TOURNAMENT MVP ========================= -->
    <template v-if="mvpScope === 'overall'">
      <!-- 4 Spotlight Award Cards -->
      <div class="spotlight-grid">
        <div
          class="spotlight-card gold"
          @click="mvpReport.overall.topPointsLeader && emit('select-player', mvpReport.overall.topPointsLeader.player.id)"
        >
          <span class="sp-label">👑 {{ tLoc('종합 포인트 1위', 'Points Leader', '総合ポイント1位') }}</span>
          <template v-if="mvpReport.overall.topPointsLeader">
            <strong class="sp-name">{{ pName(mvpReport.overall.topPointsLeader.player.id, 'full') }}</strong>
            <div class="sp-metric pos">{{ formatSignedPoint(mvpReport.overall.topPointsLeader.totalPoints) }} pt</div>
            <span class="sp-sub">
              {{ mvpReport.overall.topPointsLeader.gamesPlayed }}{{ tLoc('전', 'G', '戦') }} ·
              {{ tLoc('1위', '1st', 'トップ') }} {{ mvpReport.overall.topPointsLeader.rankCounts[0] }}{{ tLoc('회', 'x', '回') }}
            </span>
          </template>
          <span v-else class="sp-empty">-</span>
        </div>

        <div
          class="spotlight-card fire"
          @click="mvpReport.overall.biggestWin && emit('open-game-log', mvpReport.overall.biggestWin.matchKey)"
        >
          <span class="sp-label">🔥 {{ tLoc('대회 최대 화료 한방', 'Biggest Single Win', '大会最大和了') }}</span>
          <template v-if="mvpReport.overall.biggestWin">
            <strong class="sp-name">{{ pName(mvpReport.overall.biggestWin.winnerId, 'full') }}</strong>
            <div class="sp-metric fire-txt">
              +{{ mvpReport.overall.biggestWin.gain.toLocaleString() }}
              ({{ formatWinTierLabel(mvpReport.overall.biggestWin.tier, eventLocale) }})
            </div>
            <span class="sp-sub">
              {{ mvpReport.overall.biggestWin.matchKey }} · {{ mvpReport.overall.biggestWin.handLabel }}
              ({{ mvpReport.overall.biggestWin.isTsumo ? tLoc('쯔모', 'Tsumo', 'ツモ') : tLoc('론', 'Ron', 'ロン') }}) ↗
            </span>
          </template>
          <span v-else class="sp-empty">{{ tLoc('만관 이상 기록 없음', 'No Mangan+ yet', '満貫以上なし') }}</span>
        </div>

        <div
          class="spotlight-card bolt"
          @click="mvpReport.overall.greatestComeback && emit('open-game-log', mvpReport.overall.greatestComeback.matchKey)"
        >
          <span class="sp-label">⚡ {{ tLoc('최고의 대역전극', 'Greatest Comeback', '最高の大逆転劇') }}</span>
          <template v-if="mvpReport.overall.greatestComeback">
            <strong class="sp-name">{{ pName(mvpReport.overall.greatestComeback.playerId, 'full') }}</strong>
            <div class="sp-metric bolt-txt">
              {{ mvpReport.overall.greatestComeback.worstRank }}{{ tLoc('위', 'th', '着') }} → {{ mvpReport.overall.greatestComeback.finalRank }}{{ tLoc('위', 'st', '着') }}
              (+{{ mvpReport.overall.greatestComeback.swing.toLocaleString() }})
            </div>
            <span class="sp-sub">
              {{ mvpReport.overall.greatestComeback.matchKey }} ·
              {{ mvpReport.overall.greatestComeback.minScore.toLocaleString() }} → {{ mvpReport.overall.greatestComeback.finalScore.toLocaleString() }} ↗
            </span>
          </template>
          <span v-else class="sp-empty">{{ tLoc('역전 기록 집계 중', 'No comebacks yet', '逆転記録なし') }}</span>
        </div>

        <div
          class="spotlight-card blue"
          @click="mvpReport.overall.highestGameScore && emit('open-game-log', mvpReport.overall.highestGameScore.matchKey)"
        >
          <span class="sp-label">💯 {{ tLoc('최고 단판 점수', 'Best Single Game', '最高半荘スコア') }}</span>
          <template v-if="mvpReport.overall.highestGameScore">
            <strong class="sp-name">{{ pName(mvpReport.overall.highestGameScore.playerId, 'full') }}</strong>
            <div class="sp-metric">{{ mvpReport.overall.highestGameScore.score.toLocaleString() }}</div>
            <span class="sp-sub">
              {{ mvpReport.overall.highestGameScore.matchKey }} ({{ formatSignedPoint(mvpReport.overall.highestGameScore.finalPoint) }} pt) ↗
            </span>
          </template>
          <span v-else class="sp-empty">-</span>
        </div>
      </div>

      <!-- Overall MVP Candidates Ranking -->
      <section class="card-panel">
        <div class="sec-head">
          <h3>🏆 {{ tLoc('전체 대회 MVP 후보 TOP 10', 'Overall Tournament MVP Candidates (Top 10)', '大会総合 MVP候補 TOP 10') }}</h3>
          <span class="sec-hint">{{ tLoc('종합 포인트 + 1위 횟수 + 큰 화료 + 대역전극 종합 지수 순', 'Ranked by composite MVP index (Points + Wins + Big Wins + Comebacks)', '総合Pt・トップ数・高打点・大逆転の総合指数順') }}</span>
        </div>

        <div v-if="filteredOverallCandidates.length === 0" class="empty-box">
          {{ tLoc('아직 완료된 경기가 없습니다.', 'No completed games yet.', 'まだ完了した対局がありません。') }}
        </div>
        <div v-else class="cand-list">
          <div
            v-for="(cand, idx) in filteredOverallCandidates"
            :key="cand.playerId"
            class="cand-card"
            :class="`rank-${idx + 1}`"
          >
            <div class="cand-left">
              <span class="cand-medal">{{ medalFor(idx) }}</span>
              <span
                class="team-dot-lg"
                :style="{ backgroundColor: EVENT_TEAM_MAP[EVENT_PLAYER_MAP[cand.playerId]?.teamId || 'A'].color }"
              ></span>
              <div class="cand-info">
                <div class="cand-name-row">
                  <button type="button" class="cand-name-btn" @click="emit('select-player', cand.playerId)">
                    {{ pName(cand.playerId, 'full') }}
                  </button>
                  <span v-if="EVENT_PLAYER_MAP[cand.playerId]?.isPro" class="pro-mini">PRO</span>
                  <span class="mvp-score-pill">MVP {{ cand.mvpScore.toFixed(1) }}</span>
                </div>
                <div class="cand-reasons">
                  <span v-for="(r, rIdx) in cand.reasons" :key="rIdx" class="reason-pill" :class="r.kind">
                    {{ reasonText(r) }}
                  </span>
                </div>
              </div>
            </div>

            <div class="cand-right">
              <div class="cand-pt" :class="cand.totalPoints >= 0 ? 'pos' : 'neg'">
                {{ formatSignedPoint(cand.totalPoints) }} pt
              </div>
              <div class="cand-actions">
                <button
                  v-if="cand.maxSingleWin"
                  type="button"
                  class="mini-link-btn"
                  @click="emit('open-game-log', cand.maxSingleWin.matchKey)"
                >
                  🔥 {{ cand.maxSingleWin.matchKey }}
                </button>
                <button
                  v-else-if="cand.bestComeback"
                  type="button"
                  class="mini-link-btn"
                  @click="emit('open-game-log', cand.bestComeback.matchKey)"
                >
                  ⚡ {{ cand.bestComeback.matchKey }}
                </button>
                <button
                  v-else-if="cand.bestMatchKey"
                  type="button"
                  class="mini-link-btn"
                  @click="emit('open-game-log', cand.bestMatchKey)"
                >
                  📜 {{ cand.bestMatchKey }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Two-column Highlights: Big Wins & Comebacks -->
      <div class="hl-two-col">
        <section class="card-panel">
          <div class="sec-head">
            <h3>🔥 {{ tLoc('전체 큰 화료 하이라이트 (만관~역만)', 'Tournament Big Wins (Mangan–Yakuman)', '大会 高打点ハイライト（満貫〜役満）') }}</h3>
          </div>
          <div v-if="filteredOverallBigWins.length === 0" class="empty-box">
            {{ tLoc('아직 만관 이상 화료 기록이 없습니다.', 'No Mangan+ wins recorded yet.', 'まだ満貫以上の和了記録がありません。') }}
          </div>
          <div v-else class="hl-list">
            <button
              v-for="(bw, idx) in filteredOverallBigWins"
              :key="bw.id"
              type="button"
              class="hl-row-btn"
              @click="emit('open-game-log', bw.matchKey)"
            >
              <div class="hl-row-top">
                <span class="hl-idx">#{{ idx + 1 }}</span>
                <span class="hl-tier-pill" :class="bw.tier">{{ formatWinTierLabel(bw.tier, eventLocale) }}</span>
                <strong>{{ pName(bw.winnerId, 'compact') }}</strong>
                <span class="hl-gain pos">+{{ bw.gain.toLocaleString() }}</span>
              </div>
              <div class="hl-row-sub">
                <span>{{ bw.matchKey }} · {{ bw.handLabel }}</span>
                <span>
                  {{ bw.isDealer ? tLoc('오야', 'Dealer', '親') : tLoc('자', 'Child', '子') }}
                  {{ bw.isTsumo ? tLoc('쯔모', 'Tsumo', 'ツモ') : `${tLoc('론', 'Ron', 'ロン')} ← ${bw.loserIds.map((id) => pName(id, 'compact')).join(', ')}` }}
                </span>
              </div>
            </button>
          </div>
        </section>

        <section class="card-panel">
          <div class="sec-head">
            <h3>⚡ {{ tLoc('전체 대역전극 하이라이트', 'Tournament Greatest Comebacks', '大会 大逆転ハイライト') }}</h3>
          </div>
          <div v-if="filteredOverallComebacks.length === 0" class="empty-box">
            {{ tLoc('아직 조건을 충족한 대역전 기록이 없습니다.', 'No major comebacks recorded yet.', 'まだ該当する大逆転記録がありません。') }}
          </div>
          <div v-else class="hl-list">
            <button
              v-for="(cb, idx) in filteredOverallComebacks"
              :key="cb.id"
              type="button"
              class="hl-row-btn"
              @click="emit('open-game-log', cb.matchKey)"
            >
              <div class="hl-row-top">
                <span class="hl-idx">#{{ idx + 1 }}</span>
                <span class="hl-cb-pill">
                  {{ cb.worstRank }}{{ tLoc('위', 'th', '着') }} → {{ cb.finalRank }}{{ tLoc('위', 'st', '着') }}
                </span>
                <strong>{{ pName(cb.playerId, 'compact') }}</strong>
                <span class="hl-gain bolt-txt">+{{ cb.swing.toLocaleString() }}</span>
              </div>
              <div class="hl-row-sub">
                <span>{{ cb.matchKey }} · {{ cb.minScoreHandLabel }} {{ cb.minScore.toLocaleString() }} → {{ cb.finalScore.toLocaleString() }}</span>
                <span v-if="cb.wasSouthComeback" class="south-tag">{{ tLoc('남장 역전', 'South Comeback', '南場逆転') }}</span>
              </div>
            </button>
          </div>
        </section>
      </div>
    </template>

    <!-- ========================= PER-ROUND MVP ========================= -->
    <template v-else>
      <section class="card-panel">
        <div class="sec-head">
          <h3>
            🏆 R{{ mvpScope }} {{ tLoc('라운드 MVP 후보', 'Round MVP Candidates', '回戦 MVP候補') }}
          </h3>
          <span class="sec-hint">
            {{ tLoc(`완료 ${activeRoundBucket?.completedTables || 0}/7탁 (국별 집계 ${activeRoundBucket?.trackedTables || 0}탁)`, `Completed ${activeRoundBucket?.completedTables || 0}/7 tables (${activeRoundBucket?.trackedTables || 0} tracked)`, `完了 ${activeRoundBucket?.completedTables || 0}/7卓 (局別集計 ${activeRoundBucket?.trackedTables || 0}卓)`) }}
          </span>
        </div>

        <div v-if="filteredRoundCandidates.length === 0" class="empty-box">
          {{ tLoc(`R${mvpScope} 라운드의 완료된 경기 기록이 아직 없습니다.`, `No completed games for Round ${mvpScope} yet.`, `第${mvpScope}回戦の完了対局がまだありません。`) }}
        </div>
        <div v-else class="cand-list">
          <div
            v-for="(cand, idx) in filteredRoundCandidates"
            :key="`${cand.matchKey}-${cand.playerId}`"
            class="cand-card"
            :class="`rank-${idx + 1}`"
          >
            <div class="cand-left">
              <span class="cand-medal">{{ medalFor(idx) }}</span>
              <span
                class="team-dot-lg"
                :style="{ backgroundColor: EVENT_TEAM_MAP[EVENT_PLAYER_MAP[cand.playerId]?.teamId || 'A'].color }"
              ></span>
              <div class="cand-info">
                <div class="cand-name-row">
                  <button type="button" class="cand-name-btn" @click="emit('select-player', cand.playerId)">
                    {{ pName(cand.playerId, 'full') }}
                  </button>
                  <span v-if="EVENT_PLAYER_MAP[cand.playerId]?.isPro" class="pro-mini">PRO</span>
                  <span class="match-tag">{{ cand.matchKey }}</span>
                  <span class="mvp-score-pill">MVP {{ cand.mvpScore.toFixed(1) }}</span>
                </div>
                <div class="cand-reasons">
                  <span v-for="(r, rIdx) in cand.reasons" :key="rIdx" class="reason-pill" :class="r.kind">
                    {{ reasonText(r) }}
                  </span>
                </div>
              </div>
            </div>

            <div class="cand-right">
              <div class="cand-pt" :class="cand.finalPoint >= 0 ? 'pos' : 'neg'">
                {{ formatSignedPoint(cand.finalPoint) }} pt
              </div>
              <div class="cand-actions">
                <button
                  type="button"
                  class="mini-link-btn"
                  @click="emit('open-game-log', cand.matchKey)"
                >
                  📜 {{ tLoc('국별 기록', 'Round Log', '局別ログ') }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div class="hl-two-col">
        <section class="card-panel">
          <div class="sec-head">
            <h3>🔥 R{{ mvpScope }} {{ tLoc('큰 화료 목록', 'Big Wins', '高打点和了') }}</h3>
          </div>
          <div v-if="filteredRoundBigWins.length === 0" class="empty-box">
            {{ tLoc('이 라운드의 만관 이상 화료 기록이 없습니다.', 'No Mangan+ wins in this round.', 'この回戦の満貫以上和了はありません。') }}
          </div>
          <div v-else class="hl-list">
            <button
              v-for="(bw, idx) in filteredRoundBigWins"
              :key="bw.id"
              type="button"
              class="hl-row-btn"
              @click="emit('open-game-log', bw.matchKey)"
            >
              <div class="hl-row-top">
                <span class="hl-idx">#{{ idx + 1 }}</span>
                <span class="hl-tier-pill" :class="bw.tier">{{ formatWinTierLabel(bw.tier, eventLocale) }}</span>
                <strong>{{ pName(bw.winnerId, 'compact') }}</strong>
                <span class="hl-gain pos">+{{ bw.gain.toLocaleString() }}</span>
              </div>
              <div class="hl-row-sub">
                <span>{{ bw.matchKey }} · {{ bw.handLabel }}</span>
                <span>
                  {{ bw.isDealer ? tLoc('오야', 'Dealer', '親') : tLoc('자', 'Child', '子') }}
                  {{ bw.isTsumo ? tLoc('쯔모', 'Tsumo', 'ツモ') : `${tLoc('론', 'Ron', 'ロン')} ← ${bw.loserIds.map((id) => pName(id, 'compact')).join(', ')}` }}
                </span>
              </div>
            </button>
          </div>
        </section>

        <section class="card-panel">
          <div class="sec-head">
            <h3>⚡ R{{ mvpScope }} {{ tLoc('대역전극 목록', 'Comebacks', '大逆転劇') }}</h3>
          </div>
          <div v-if="filteredRoundComebacks.length === 0" class="empty-box">
            {{ tLoc('이 라운드의 대역전 기록이 없습니다.', 'No major comebacks in this round.', 'この回戦の大逆転記録はありません。') }}
          </div>
          <div v-else class="hl-list">
            <button
              v-for="(cb, idx) in filteredRoundComebacks"
              :key="cb.id"
              type="button"
              class="hl-row-btn"
              @click="emit('open-game-log', cb.matchKey)"
            >
              <div class="hl-row-top">
                <span class="hl-idx">#{{ idx + 1 }}</span>
                <span class="hl-cb-pill">
                  {{ cb.worstRank }}{{ tLoc('위', 'th', '着') }} → {{ cb.finalRank }}{{ tLoc('위', 'st', '着') }}
                </span>
                <strong>{{ pName(cb.playerId, 'compact') }}</strong>
                <span class="hl-gain bolt-txt">+{{ cb.swing.toLocaleString() }}</span>
              </div>
              <div class="hl-row-sub">
                <span>{{ cb.matchKey }} · {{ cb.minScoreHandLabel }} {{ cb.minScore.toLocaleString() }} → {{ cb.finalScore.toLocaleString() }}</span>
                <span v-if="cb.wasSouthComeback" class="south-tag">{{ tLoc('남장 역전', 'South Comeback', '南場逆転') }}</span>
              </div>
            </button>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.mvp-root {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.card-panel {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  padding: 16px;
}
.mvp-head-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.mvp-head-top {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}
.mvp-title {
  margin: 0 0 4px;
  font-size: 16.5px;
  font-weight: 900;
}
.mvp-sub {
  margin: 0;
  font-size: 12.5px;
  color: var(--text-dimmed);
}
.mvp-role-chips {
  display: inline-flex;
  gap: 5px;
}
.mvp-chip {
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 800;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-dimmed);
  cursor: pointer;
}
.mvp-chip.active {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}
.mvp-scope-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.mvp-scope-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 13px;
  border-radius: 9px;
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-color);
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
}
.mvp-scope-btn.active {
  background: linear-gradient(135deg, #2563eb, #4f46e5);
  color: #ffffff;
  border-color: #2563eb;
}
.scope-cnt {
  font-size: 11px;
  opacity: 0.78;
}

.spotlight-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 12px;
}
.spotlight-card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  cursor: pointer;
  transition: transform 0.15s, border-color 0.15s;
}
.spotlight-card:hover {
  transform: translateY(-2px);
}
.spotlight-card.gold { border-color: rgba(245, 158, 11, 0.55); background: linear-gradient(135deg, rgba(245, 158, 11, 0.12), transparent); }
.spotlight-card.fire { border-color: rgba(239, 68, 68, 0.5); background: linear-gradient(135deg, rgba(239, 68, 68, 0.1), transparent); }
.spotlight-card.bolt { border-color: rgba(168, 85, 247, 0.5); background: linear-gradient(135deg, rgba(168, 85, 247, 0.1), transparent); }
.spotlight-card.blue { border-color: rgba(59, 130, 246, 0.5); background: linear-gradient(135deg, rgba(59, 130, 246, 0.1), transparent); }
.sp-label {
  font-size: 12px;
  font-weight: 800;
  color: var(--text-dimmed);
}
.sp-name {
  font-size: 15.5px;
  font-weight: 900;
}
.sp-metric {
  font-size: 17px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
}
.sp-sub {
  font-size: 11.5px;
  color: var(--text-dimmed);
  font-weight: 700;
}
.sp-empty {
  font-size: 13px;
  color: var(--text-dimmed);
  padding: 6px 0;
}

.sec-head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 12px;
}
.sec-head h3 {
  margin: 0;
  font-size: 15.5px;
  font-weight: 900;
}
.sec-hint {
  font-size: 12px;
  color: var(--text-dimmed);
}
.empty-box {
  padding: 24px 12px;
  text-align: center;
  color: var(--text-dimmed);
  font-size: 13px;
}

.cand-list {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.cand-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  background: rgba(125, 125, 125, 0.04);
}
.cand-card.rank-1 {
  border-color: rgba(245, 158, 11, 0.65);
  background: rgba(245, 158, 11, 0.1);
}
.cand-card.rank-2 {
  border-color: rgba(148, 163, 184, 0.55);
  background: rgba(148, 163, 184, 0.08);
}
.cand-card.rank-3 {
  border-color: rgba(217, 119, 6, 0.45);
  background: rgba(217, 119, 6, 0.07);
}
.cand-left {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
  flex: 1;
}
.cand-medal {
  font-size: 18px;
  font-weight: 900;
  min-width: 28px;
  text-align: center;
  line-height: 1.2;
}
.team-dot-lg {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-top: 6px;
  flex-shrink: 0;
}
.cand-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.cand-name-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.cand-name-btn {
  border: none;
  background: transparent;
  color: var(--text-color);
  font-size: 15px;
  font-weight: 900;
  padding: 0;
  cursor: pointer;
}
.cand-name-btn:hover {
  text-decoration: underline;
  color: #3b82f6;
}
.pro-mini {
  font-size: 10px;
  font-weight: 900;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(245, 158, 11, 0.22);
  color: #d97706;
}
.match-tag {
  font-size: 11px;
  font-weight: 800;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.16);
  color: #3b82f6;
}
.mvp-score-pill {
  font-size: 11px;
  font-weight: 900;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(99, 102, 241, 0.18);
  color: #6366f1;
}
.cand-reasons {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.reason-pill {
  font-size: 11.5px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(125, 125, 125, 0.12);
  color: var(--text-color);
}
.reason-pill.bigwin {
  background: rgba(245, 158, 11, 0.2);
  color: #d97706;
}
.reason-pill.comeback {
  background: rgba(168, 85, 247, 0.18);
  color: #9333ea;
}
.reason-pill.clean {
  background: rgba(16, 185, 129, 0.18);
  color: #10b981;
}
.cand-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}
.cand-pt {
  font-size: 16px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
}
.mini-link-btn {
  padding: 4px 9px;
  border-radius: 7px;
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  color: var(--text-color);
  font-size: 11.5px;
  font-weight: 800;
  cursor: pointer;
}
.mini-link-btn:hover {
  border-color: #3b82f6;
  color: #3b82f6;
}

.hl-two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
@media (max-width: 860px) {
  .hl-two-col {
    grid-template-columns: 1fr;
  }
}
.hl-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.hl-row-btn {
  width: 100%;
  text-align: left;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: rgba(125, 125, 125, 0.04);
  color: var(--text-color);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.hl-row-btn:hover {
  border-color: rgba(59, 130, 246, 0.55);
  background: var(--bg-hover-color);
}
.hl-row-top {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13.5px;
}
.hl-idx {
  font-size: 11.5px;
  font-weight: 900;
  color: var(--text-dimmed);
  min-width: 22px;
}
.hl-tier-pill {
  font-size: 11px;
  font-weight: 900;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(245, 158, 11, 0.22);
  color: #d97706;
}
.hl-tier-pill.baiman,
.hl-tier-pill.sanbaiman,
.hl-tier-pill.yakuman {
  background: rgba(239, 68, 68, 0.22);
  color: #ef4444;
}
.hl-cb-pill {
  font-size: 11px;
  font-weight: 900;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(168, 85, 247, 0.2);
  color: #9333ea;
}
.hl-gain {
  margin-left: auto;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
}
.hl-row-sub {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 11.5px;
  color: var(--text-dimmed);
}
.south-tag {
  font-size: 10.5px;
  font-weight: 800;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(239, 68, 68, 0.16);
  color: #ef4444;
}
.pos { color: var(--color-positive, #16a34a); }
.neg { color: var(--color-negative, #dc2626); }
.fire-txt { color: #ea580c; }
.bolt-txt { color: #9333ea; }
</style>
