<template>
  <el-dialog
    v-model="visible"
    :title="t('teaching.studentQuizTitle')"
    width="520px"
    :close-on-click-modal="false"
    class="student-quiz-dialog"
  >
    <!-- 作废：记录保留但得分清零，退回等待下一题 -->
    <div
      v-if="phase === 'voided'"
      class="quiz-state voided"
    >
      {{ t('teaching.studentQuizVoided') }}
    </div>

    <!-- 揭晓：答案只在此时下发，且已是本班显示序 -->
    <template v-else-if="phase === 'revealed' && result">
      <p class="quiz-state revealed">
        {{ t('teaching.studentQuizRevealed') }}
      </p>
      <div class="quiz-stem">
        {{ race.reveal?.stem || classroom.question?.stem }}
      </div>
      <div class="quiz-options">
        <div
          v-for="(option, index) in options"
          :key="index"
          class="quiz-option"
          :class="{ correct: index === result.answerIndex, mine: index === myChoice }"
        >
          <span class="quiz-letter">{{ letter(index) }}</span>
          <span class="quiz-text">{{ option }}</span>
          <span
            v-if="index === result.answerIndex"
            class="quiz-tag"
          >
            {{ t('teaching.studentQuizCorrectAnswer') }}
          </span>
          <span
            v-if="index === myChoice"
            class="quiz-tag mine"
          >
            {{ t('teaching.studentQuizMyAnswer') }}
          </span>
          <span class="quiz-count">{{ race.reveal?.distribution?.[index] || 0 }}</span>
        </div>
      </div>
      <div class="quiz-verdict">
        <b :class="result.correct ? 'is-correct' : 'is-wrong'">
          {{ result.correct ? t('teaching.studentQuizCorrect') : t('teaching.studentQuizWrong') }}
        </b>
        <span v-if="result.answerIndex >= 0">
          {{ t('teaching.studentQuizCorrectAnswer') }} {{ letter(result.answerIndex) }} · {{ result.correctOptionText }}
        </span>
      </div>
      <div
        v-if="result.score !== null"
        class="quiz-metrics"
      >
        <span>{{ t('teaching.studentQuizScore') }} {{ result.score }}</span>
        <span v-if="result.rank !== null">{{ t('teaching.studentQuizRank') }} #{{ result.rank }}</span>
      </div>
    </template>

    <!-- 答题中 / 已提交等待揭晓 -->
    <template v-else>
      <div class="quiz-stem">
        {{ classroom.question?.stem }}
      </div>
      <div
        v-if="phase === 'answering'"
        class="quiz-timer"
      >
        {{ remaining > 0 ? t('teaching.studentQuizTimeLeft', { seconds: remaining }) : t('teaching.studentQuizExpired') }}
      </div>
      <div class="quiz-options">
        <button
          v-for="(option, index) in options"
          :key="index"
          class="quiz-option"
          :class="{ selected: studentQuiz.selected === index, mine: myChoice === index }"
          :disabled="phase !== 'answering' || remaining === 0"
          @click="teachingStore.selectStudentOption(index)"
        >
          <span class="quiz-letter">{{ letter(index) }}</span>
          <span class="quiz-text">{{ option }}</span>
          <span
            v-if="myChoice === index"
            class="quiz-tag mine"
          >
            {{ t('teaching.studentQuizMyAnswer') }}
          </span>
        </button>
      </div>
      <p
        v-if="phase === 'submitted'"
        class="quiz-state submitted"
      >
        {{ t('teaching.studentQuizSubmitted') }} · {{ t('teaching.studentQuizWaitingReveal') }}
      </p>
      <p
        v-if="studentQuiz.error"
        class="quiz-error"
      >
        {{ studentQuiz.error }}
      </p>
    </template>

    <template #footer>
      <el-button
        v-if="phase === 'answering'"
        type="primary"
        :disabled="studentQuiz.selected === null || remaining === 0"
        @click="teachingStore.submitStudentAnswer()"
      >
        {{ t('teaching.studentQuizSubmit') }}
      </el-button>
      <el-button @click="teachingStore.closeStudentQuiz()">
        {{ t('teaching.studentQuizClose') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useTeachingStore } from '@/store/teaching'
import { useAuthStore } from '@/store/auth'
import { t } from '@/i18n'
import {
  studentQuizPhase,
  studentQuizRemainingSec,
  studentQuizResult
} from '@/util/studentQuiz'

const teachingStore = useTeachingStore()
const { classroom, race, studentQuiz } = storeToRefs(teachingStore)
const authStore = useAuthStore()

const now = ref(Date.now())
let ticker: number | undefined
onMounted(() => {
  ticker = window.setInterval(() => {
    now.value = Date.now()
  }, 500)
})
onBeforeUnmount(() => window.clearInterval(ticker))

const phase = computed(() =>
  studentQuizPhase({
    hasQuestion: !!classroom.value.question,
    submitted: studentQuiz.value.submitted,
    hasReveal: !!race.value.reveal,
    voided: studentQuiz.value.voided
  })
)

const myChoice = computed(() => studentQuiz.value.submitted ?? studentQuiz.value.selected)
const options = computed(() =>
  phase.value === 'revealed'
    ? (race.value.reveal?.options ?? [])
    : (classroom.value.question?.options ?? [])
)
const remaining = computed(() =>
  studentQuizRemainingSec(race.value.openedAt, race.value.limitSec, now.value)
)
const result = computed(() =>
  studentQuizResult(
    race.value.reveal,
    myChoice.value,
    authStore.state.user?.username ?? ''
  )
)

const letter = (index: number): string => String.fromCharCode(65 + index)
const visible = computed({
  get: () => studentQuiz.value.visible,
  set: (value: boolean) => {
    if (value) teachingStore.openStudentQuiz()
    else teachingStore.closeStudentQuiz()
  }
})
</script>

<style scoped>
.quiz-stem {
  font-size: 14px;
  line-height: 1.6;
  margin: 0 0 12px;
}
.quiz-timer {
  font-size: 13px;
  opacity: 0.75;
  margin-bottom: 10px;
}
.quiz-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.quiz-option {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.quiz-option:disabled {
  cursor: default;
  opacity: 0.8;
}
.quiz-option.selected,
.quiz-option.mine {
  border-color: var(--el-color-primary);
}
.quiz-option.correct {
  border-color: var(--el-color-success);
  background: var(--el-color-success-light-9);
}
.quiz-letter {
  flex: none;
  width: 22px;
  font-weight: 500;
}
.quiz-text {
  flex: 1;
}
.quiz-tag {
  flex: none;
  font-size: 12px;
  opacity: 0.7;
}
.quiz-count {
  flex: none;
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
}
.quiz-state {
  font-size: 13px;
  margin: 0 0 12px;
}
.quiz-state.revealed,
.quiz-state.submitted {
  opacity: 0.8;
}
.quiz-verdict {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: baseline;
  margin-top: 14px;
  font-size: 13px;
}
.is-correct {
  color: var(--el-color-success);
}
.is-wrong {
  color: var(--el-color-danger);
}
.quiz-metrics {
  display: flex;
  gap: 18px;
  margin-top: 8px;
  font-size: 13px;
  opacity: 0.85;
}
.quiz-error {
  color: var(--el-color-danger);
  font-size: 12px;
  margin: 10px 0 0;
}
</style>
