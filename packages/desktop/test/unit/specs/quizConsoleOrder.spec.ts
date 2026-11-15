import { describe, expect, it } from 'vitest'
import { orderRaceQuestions, type OrderedRaceQuestion } from '../../../src/renderer/src/util/quizConsoleOrder'
import type { RaceQuestion } from '../../../src/renderer/src/store/teaching'

/**
 * 缺口 B（2026-11-15 发题对齐）：发题面板把放映当前页的题置顶，
 * 其余保持服务端返回顺序（稳定排序不乱序）。
 */
const q = (id: number, questionKey: string): RaceQuestion => ({
  id,
  questionKey,
  stem: `题${id}`,
  point: 5,
  type: 'single'
})

describe('orderRaceQuestions · 本页题置顶（缺口 B）', () => {
  it('当前页的题排到最前，onPage 标记正确', () => {
    const questions = [q(1, 'q1'), q(2, 'q2'), q(3, 'q3')]
    const ordered: OrderedRaceQuestion[] = orderRaceQuestions(questions, ['q3'])
    expect(ordered.map((r) => r.id)).toEqual([3, 1, 2])
    expect(ordered.map((r) => r.onPage)).toEqual([true, false, false])
  })

  it('多个本页题保持服务端相对顺序（稳定排序）', () => {
    const questions = [q(1, 'a'), q(2, 'b'), q(3, 'c'), q(4, 'd')]
    const ordered = orderRaceQuestions(questions, ['d', 'b'])
    expect(ordered.map((r) => r.id)).toEqual([2, 4, 1, 3])
  })

  it('pageQuizKeys 为空 / 无匹配时完全保持原序', () => {
    const questions = [q(1, 'q1'), q(2, 'q2')]
    expect(orderRaceQuestions(questions, []).map((r) => r.id)).toEqual([1, 2])
    expect(orderRaceQuestions(questions, ['zzz']).map((r) => r.id)).toEqual([1, 2])
    expect(orderRaceQuestions(questions, []).every((r) => !r.onPage)).toBe(true)
  })

  it('questionKey 缺失的老题按非本页处理，不抛错', () => {
    const questions: RaceQuestion[] = [{ id: 9, questionKey: '', stem: '老题', point: 5, type: 'single' }]
    const ordered = orderRaceQuestions(questions, [''])
    expect(ordered[0].onPage).toBe(false)
  })
})
