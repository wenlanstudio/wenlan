/**
 * 资料查阅派生的课堂题插槽（TEACHING-SPEC §七 / engine/src/derive.js）。
 *
 * 引擎把整题换成独占一行的 `<!--quiz-slot id="q1"-->`，题干与选项都不进学生版
 * md。客户端按本班发题状态渲染：未发题是占位引用块；`teaching.race.opened` 到来
 * 后按 `questionKey === slot id` 把对应槽位换成题干 + 选项（答案仍不下发）。
 * slot id 一直保留在块内，是替换的唯一锚点。
 *
 * 纯函数，零渲染层依赖，便于单测。
 */

const QUIZ_SLOT_RE = /^([ \t]*)<!--quiz-slot\s+id=["']([^"']+)["']\s*-->[ \t]*$/gm

export interface QuizSlotResult {
  md: string
  slotCount: number
}

/** 当前发题（M2b `teaching.race.opened` / joined 里的 race 快照）。 */
export interface ActiveQuiz {
  questionKey: string
  stem: string
  options: string[]
  limitSec: number
}

export interface QuizSlotView {
  waiting: string
  hint: string
  activeLabel: string
  question: ActiveQuiz | null
}

export const renderQuizSlots = (md: string, view: QuizSlotView): QuizSlotResult => {
  let slotCount = 0
  const next = md.replace(QUIZ_SLOT_RE, (_match, indent: string, id: string) => {
    slotCount++
    const active = view.question?.questionKey === id ? view.question : null
    const lines = active
      ? [
        `${indent}> **${view.activeLabel}**`,
        `${indent}>`,
        `${indent}> ${active.stem}`,
        `${indent}>`,
        ...active.options.map(
          (option, index) => `${indent}> - ${String.fromCharCode(65 + index)}. ${option}`
        ),
        `${indent}>`,
        `${indent}> \`${id}\``
      ]
      : [
        `${indent}> **${view.waiting}**`,
        `${indent}>`,
        `${indent}> ${view.hint} \`${id}\``
      ]
    return lines.join('\n')
  })
  return { md: next, slotCount }
}

/** 静态占位（无课堂事件时的默认视图，保留给单测与离线回退）。 */
export const renderQuizSlotPlaceholders = (
  md: string,
  waiting: string,
  hint: string
): QuizSlotResult =>
  renderQuizSlots(md, { waiting, hint, activeLabel: waiting, question: null })
