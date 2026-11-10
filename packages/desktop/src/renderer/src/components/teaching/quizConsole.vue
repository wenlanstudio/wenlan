<template>
  <el-dialog
    :model-value="race.visible"
    width="640px"
    append-to-body
    :title="t('teaching.quizTitle')"
    :close-on-click-modal="false"
    @update:model-value="onVisibleChange"
  >
    <div class="quiz-console">
      <div class="quiz-head">
        <span class="quiz-class">
          {{ classroom.className || t('teaching.classroomLive') }}
        </span>
        <span class="quiz-meta">
          {{ t('teaching.classroomLive') }} ·
          {{ t('teaching.quizOnline', { online: classroom.online || 0 }) }}
        </span>
      </div>

      <!-- 进行中 -->
      <div
        v-if="running"
        class="quiz-banner running"
      >
        <span class="quiz-banner-main">
          {{ t('teaching.quizRunning') }}
          <b>{{ t('teaching.quizAnswered', { answered: race.answered, online: classroom.online || 0 }) }}</b>
        </span>
        <span class="quiz-clock">{{ remainingLabel }}</span>
        <span class="quiz-banner-actions">
          <el-button
            size="small"
            type="primary"
            @click="teachingStore.closeRaceRound()"
          >
            {{ t('teaching.quizClose') }}
          </el-button>
          <el-button
            size="small"
            @click="teachingStore.voidRaceRound()"
          >
            {{ t('teaching.quizVoid') }}
          </el-button>
        </span>
      </div>

      <!-- 已揭晓 -->
      <div
        v-if="reveal"
        class="quiz-reveal"
      >
        <div class="reveal-head">
          <span class="reveal-answer">
            {{ t('teaching.quizAnswer') }}
            <b>{{ reveal.answer || '—' }}</b>
          </span>
          <span
            v-if="reveal.fastest && reveal.fastest.durationMs"
            class="reveal-fastest"
          >
            {{ t('teaching.quizFastest') }}
            {{ reveal.fastest.studentNo || '—' }} · {{ formatSeconds(reveal.fastest.durationMs) }}
          </span>
          <span class="reveal-rate">{{ t('teaching.quizCorrectRate', { rate: correctRate }) }}</span>
        </div>
        <div class="reveal-body">
          <div class="reveal-dist">
            <div
              v-for="(option, index) in reveal.options"
              :key="index"
              class="dist-row"
            >
              <span class="dist-letter">{{ letter(index) }}</span>
              <span class="dist-bar">
                <i
                  class="dist-fill"
                  :class="{ correct: letter(index) === reveal.answer }"
                  :style="{ width: barWidth(index) }"
                />
              </span>
              <span class="dist-count">{{ reveal.distribution[index] || 0 }}</span>
            </div>
          </div>
          <div class="reveal-board">
            <div class="board-title">
              {{ t('teaching.quizLeaderboard') }}
            </div>
            <ol class="board-list">
              <li
                v-for="(row, index) in reveal.leaderboard.slice(0, 8)"
                :key="index"
              >
                <span class="board-name">{{ row.studentNo || row.studentName }}</span>
                <span class="board-score">{{ row.score }}</span>
              </li>
            </ol>
          </div>
        </div>
      </div>

      <!-- 题目列表 -->
      <div class="quiz-body">
        <div
          v-if="race.loading"
          class="quiz-empty"
        >
          {{ t('teaching.quizLoading') }}
        </div>
        <div
          v-else-if="!race.questions.length"
          class="quiz-empty"
        >
          {{ t('teaching.quizEmpty') }}
          <div class="quiz-empty-hint">
            {{ t('teaching.quizEmptyHint') }}
          </div>
        </div>
        <ul
          v-else
          class="quiz-list"
        >
          <li
            v-for="question in race.questions"
            :key="question.id"
            class="quiz-item"
            :class="{ current: question.id === race.questionId }"
          >
            <span class="quiz-key">{{ question.questionKey || `#${question.id}` }}</span>
            <span class="quiz-stem">{{ question.stem }}</span>
            <span class="quiz-point">{{ t('teaching.quizPoint', { point: question.point }) }}</span>
            <el-button
              size="small"
              :disabled="running"
              @click="onOpen(question)"
            >
              {{ t('teaching.quizOpen') }}
            </el-button>
          </li>
        </ul>
      </div>

      <div class="quiz-foot">
        <span class="form-label">{{ t('teaching.quizLimit') }}</span>
        <el-input-number
          v-model="limitSec"
          :min="5"
          :max="300"
          :step="5"
          size="small"
          controls-position="right"
        />
        <span class="form-label">{{ t('teaching.quizSeconds') }}</span>
        <span
          v-if="race.error"
          class="quiz-error"
        >{{ race.error }}</span>
      </div>
    </div>

    <template #footer>
      <el-button @click="teachingStore.closeQuizConsole()">
        {{ t('teaching.quizDone') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
/**
 * 课堂发题控制台（E5 步骤 4 余下部分）。
 *
 * D10 约束：不做常驻面板，只有课堂进行中才从状态栏/菜单弹这个模态浮层。
 * 协议（wenshu-module-teaching RaceController / TeachingRace*Listener）：
 * - 上行 `teaching.race.{questions,open,close,void}` 全部由 main 代发；
 * - 下行 `question-list`（host 专用）/ `opened` / `answered` / `revealed` / `voided`；
 * - 答案只在 `revealed` 里出现，发题与作答过程中客户端拿不到答案。
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { t } from '@/i18n'
import { useTeachingStore, type RaceQuestion } from '@/store/teaching'

const teachingStore = useTeachingStore()
// 必须走 storeToRefs：直接从 store 上解构 state 会丢掉响应性，倒计时与按钮状态都不刷新。
const { race, classroom } = storeToRefs(teachingStore)
const limitSec = ref(30)

const running = computed(() => race.value.openId != null)
const reveal = computed(() => race.value.reveal)

const letter = (index: number): string => String.fromCharCode(65 + index)

const correctRate = computed(() => {
  const row = reveal.value
  if (!row) return 0
  const total = row.distribution.reduce((sum, n) => sum + n, 0)
  if (!total) return 0
  const answerIndex = row.answer ? row.answer.charCodeAt(0) - 65 : -1
  const correct = answerIndex >= 0 ? row.distribution[answerIndex] || 0 : 0
  return Math.round((correct / total) * 100)
})

const barWidth = (index: number): string => {
  const row = reveal.value
  if (!row) return '0%'
  const max = Math.max(1, ...row.distribution)
  return `${Math.round(((row.distribution[index] || 0) / max) * 100)}%`
}

const formatSeconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`

/** 倒计时用本地发题时刻推算，不解析服务端的无时区时间串。 */
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null

const remainingSec = computed(() => {
  if (!running.value || !race.value.openedAt) return 0
  const elapsed = Math.floor((now.value - race.value.openedAt) / 1000)
  return Math.max(0, race.value.limitSec - elapsed)
})

const remainingLabel = computed(() => {
  const sec = remainingSec.value
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`
})

const tick = (): void => {
  now.value = Date.now()
}

watch(
  () => race.value.visible,
  (visible) => {
    if (visible) {
      now.value = Date.now()
      if (!timer) timer = setInterval(tick, 1000)
      limitSec.value = race.value.limitSec || 30
    } else if (timer) {
      clearInterval(timer)
      timer = null
    }
  }
)

onUnmounted(() => {
  if (timer) clearInterval(timer)
  timer = null
})

const onVisibleChange = (visible: boolean): void => {
  if (!visible) teachingStore.closeQuizConsole()
}

const onOpen = (question: RaceQuestion): void => {
  const error = teachingStore.openRaceQuestion(question, limitSec.value)
  if (error) race.value.error = error
}
</script>

<style scoped>
.quiz-console {
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 13px;
}

.quiz-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  color: var(--editorColor60, #666);
  font-size: 12px;
}

.quiz-class {
  font-size: 14px;
  color: var(--editorColor, #333);
}

.quiz-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 6px;
  background: var(--editorColor10, #f5f5f5);
}

.quiz-banner.running {
  background: rgba(24, 95, 165, 0.08);
}

.quiz-banner-main {
  flex: 1;
}

.quiz-clock {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: #185fa5;
}

.quiz-banner-actions {
  display: flex;
  gap: 6px;
}

.quiz-reveal {
  border: 1px solid var(--editorColor10, #eee);
  border-radius: 6px;
  padding: 10px 12px;
}

.reveal-head {
  display: flex;
  gap: 16px;
  align-items: baseline;
  font-size: 12px;
  color: var(--editorColor60, #666);
}

.reveal-answer b {
  font-size: 16px;
  color: #0f6e56;
  margin-left: 4px;
}

.reveal-body {
  display: flex;
  gap: 16px;
  margin-top: 10px;
}

.reveal-dist {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dist-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.dist-letter {
  width: 14px;
  color: var(--editorColor60, #666);
}

.dist-bar {
  flex: 1;
  height: 8px;
  border-radius: 4px;
  background: var(--editorColor10, #f0f0f0);
  overflow: hidden;
}

.dist-fill {
  display: block;
  height: 100%;
  background: var(--editorColor50, #b9b9b9);
  border-radius: 4px;
}

.dist-fill.correct {
  background: #0f6e56;
}

.dist-count {
  width: 26px;
  text-align: right;
  color: var(--editorColor60, #666);
}

.reveal-board {
  width: 190px;
  flex: none;
}

.board-title {
  font-size: 12px;
  color: var(--editorColor60, #666);
  margin-bottom: 6px;
}

.board-list {
  margin: 0;
  padding-left: 16px;
  font-size: 12px;
  max-height: 140px;
  overflow: auto;
}

.board-list li {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  line-height: 18px;
}

.board-score {
  color: #185fa5;
  font-variant-numeric: tabular-nums;
}

.quiz-body {
  max-height: 260px;
  overflow: auto;
  border: 1px solid var(--editorColor10, #eee);
  border-radius: 6px;
}

.quiz-empty {
  padding: 28px 12px;
  text-align: center;
  color: var(--editorColor60, #666);
  font-size: 12px;
}

.quiz-empty-hint {
  margin-top: 6px;
  color: var(--editorColor40, #999);
}

.quiz-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.quiz-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--editorColor10, #f2f2f2);
}

.quiz-item:last-child {
  border-bottom: none;
}

.quiz-item.current {
  background: rgba(24, 95, 165, 0.06);
}

.quiz-key {
  flex: none;
  font-size: 11px;
  color: var(--editorColor40, #999);
  min-width: 42px;
}

.quiz-stem {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quiz-point {
  flex: none;
  font-size: 11px;
  color: var(--editorColor40, #999);
}

.quiz-foot {
  display: flex;
  align-items: center;
  gap: 8px;
}

.form-label {
  font-size: 12px;
  color: var(--editorColor60, #666);
}

.quiz-error {
  margin-left: auto;
  color: #a32d2d;
  font-size: 12px;
  word-break: break-all;
}
</style>
