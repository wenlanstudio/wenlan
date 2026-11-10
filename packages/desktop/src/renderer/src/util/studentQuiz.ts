/**
 * 学生端课堂题状态（E5 步 4）。
 *
 * 讲义里的题目卡是 muya 只读引用块，点不了；交互放在独立答题浮层，
 * 这里只放纯判定，便于单测锁住「显示序」口径：
 * `revealed` 的 options / answer / distribution 已由服务端按本班
 * option_order 投影到学生当时看到的顺序，客户端直接按字母下标取文本即可，
 * 绝不能再按讲义原始序换算。
 */

export type StudentQuizPhase = 'idle' | 'answering' | 'submitted' | 'revealed' | 'voided'

export interface StudentQuizPhaseInput {
  hasQuestion: boolean
  submitted: number | null
  hasReveal: boolean
  voided: boolean
}

/** 优先级：作废 > 揭晓 > 已提交 > 答题中 > 空闲。 */
export const studentQuizPhase = (input: StudentQuizPhaseInput): StudentQuizPhase => {
  if (input.voided) return 'voided'
  if (input.hasReveal) return 'revealed'
  if (input.submitted != null) return 'submitted'
  if (input.hasQuestion) return 'answering'
  return 'idle'
}

export interface StudentQuizReveal {
  options: string[]
  answer: string
  distribution: number[]
  leaderboard: Array<{ studentNo: string; score: number; correct: number }>
}

export interface StudentQuizResult {
  /** 正确答案在【显示序】里的下标，非法答案时为 -1 */
  answerIndex: number
  correctOptionText: string
  myOptionText: string | null
  correct: boolean
  /** 榜单里按学号找到自己；不在榜单（观战/名单外）时为 null */
  score: number | null
  rank: number | null
}

export const studentQuizResult = (
  reveal: StudentQuizReveal | null,
  myChoice: number | null,
  studentNo: string
): StudentQuizResult | null => {
  if (!reveal) return null
  const options = Array.isArray(reveal.options) ? reveal.options : []
  const raw = reveal.answer ? reveal.answer.charCodeAt(0) - 65 : -1
  const answerIndex = raw >= 0 && raw < options.length ? raw : -1
  const myOptionText =
    myChoice != null && myChoice >= 0 && myChoice < options.length ? options[myChoice] : null
  const rows = Array.isArray(reveal.leaderboard) ? reveal.leaderboard : []
  const idx = rows.findIndex((row) => row.studentNo === studentNo)
  const row = idx >= 0 ? rows[idx] : null
  return {
    answerIndex,
    correctOptionText: answerIndex >= 0 ? options[answerIndex] : '',
    myOptionText,
    correct: answerIndex >= 0 && myChoice === answerIndex,
    score: row ? row.score : null,
    rank: idx >= 0 ? idx + 1 : null
  }
}

/** 本地推算剩余秒数（不解析服务端无时区的时间串）。 */
export const studentQuizRemainingSec = (
  openedAt: number,
  limitSec: number,
  now: number
): number => Math.max(0, Math.ceil((openedAt + limitSec * 1000 - now) / 1000))
