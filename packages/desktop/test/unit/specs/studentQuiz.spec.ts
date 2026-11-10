import { describe, expect, it } from 'vitest'
import {
  studentQuizPhase,
  studentQuizRemainingSec,
  studentQuizResult,
  type StudentQuizReveal
} from '@/util/studentQuiz'

// 本班 option_order 已把讲义原始选项投影成学生看到的显示序。
// 正确答案在显示位置 2（C），文本「20 世纪」。
const reveal: StudentQuizReveal = {
  options: ['19 世纪', '10 世纪', '20 世纪', '14 世纪'],
  answer: 'C',
  distribution: [1, 0, 3, 0],
  leaderboard: [
    { studentNo: '2026002', score: 5, correct: 1 },
    { studentNo: '2026001', score: 3, correct: 0 }
  ]
}

describe('studentQuizPhase', () => {
  it('空闲与答题中', () => {
    expect(studentQuizPhase({ hasQuestion: false, submitted: null, hasReveal: false, voided: false })).toBe('idle')
    expect(studentQuizPhase({ hasQuestion: true, submitted: null, hasReveal: false, voided: false })).toBe('answering')
  })

  it('已提交等待揭晓', () => {
    expect(studentQuizPhase({ hasQuestion: true, submitted: 1, hasReveal: false, voided: false })).toBe('submitted')
  })

  it('揭晓优先于已提交', () => {
    expect(studentQuizPhase({ hasQuestion: false, submitted: 1, hasReveal: true, voided: false })).toBe('revealed')
  })

  it('作废优先级最高', () => {
    expect(studentQuizPhase({ hasQuestion: true, submitted: 1, hasReveal: true, voided: true })).toBe('voided')
  })
})

describe('studentQuizResult', () => {
  it('按显示序取正确答案文本，答对时给出名次与得分', () => {
    const r = studentQuizResult(reveal, 2, '2026002')
    expect(r).not.toBeNull()
    expect(r!.answerIndex).toBe(2)
    expect(r!.correctOptionText).toBe('20 世纪')
    expect(r!.myOptionText).toBe('20 世纪')
    expect(r!.correct).toBe(true)
    expect(r!.score).toBe(5)
    expect(r!.rank).toBe(1)
  })

  it('答错时也给出自己的名次与得分', () => {
    const r = studentQuizResult(reveal, 1, '2026001')
    expect(r!.correct).toBe(false)
    expect(r!.myOptionText).toBe('10 世纪')
    expect(r!.score).toBe(3)
    expect(r!.rank).toBe(2)
  })

  it('未作答 / 越界选项不算对', () => {
    expect(studentQuizResult(reveal, null, '2026001')!.correct).toBe(false)
    expect(studentQuizResult(reveal, 9, '2026001')!.myOptionText).toBeNull()
    expect(studentQuizResult(reveal, 9, '2026001')!.correct).toBe(false)
  })

  it('不在榜单里（观战/名单外）不给得分与名次', () => {
    const r = studentQuizResult(reveal, 2, '9999999')
    expect(r!.score).toBeNull()
    expect(r!.rank).toBeNull()
    expect(r!.correct).toBe(true)
  })

  it('没有揭晓载荷或答案非法时安全退化', () => {
    expect(studentQuizResult(null, 0, '2026001')).toBeNull()
    const broken = studentQuizResult({ ...reveal, answer: '?' }, 0, '2026001')
    expect(broken!.answerIndex).toBe(-1)
    expect(broken!.correctOptionText).toBe('')
    expect(broken!.correct).toBe(false)
  })
})

describe('studentQuizRemainingSec', () => {
  it('按本地时间推算并钳到 0', () => {
    expect(studentQuizRemainingSec(1000, 30, 1000)).toBe(30)
    expect(studentQuizRemainingSec(1000, 30, 15500)).toBe(16)
    expect(studentQuizRemainingSec(1000, 30, 99999)).toBe(0)
  })
})
