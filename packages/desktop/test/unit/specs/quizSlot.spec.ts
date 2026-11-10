import { describe, expect, it } from 'vitest'

import { renderQuizSlotPlaceholders, renderQuizSlots } from '@/util/quizSlot'

const WAITING = '课堂题待发放'
const HINT = '教师发题后此处显示题干与选项'

describe('renderQuizSlotPlaceholders', () => {
  it('renders a single derived slot into a visible quote block and keeps its id', () => {
    const source = [
      '# 第5章 MapReduce',
      '',
      '<!--quiz-slot id="dv_ch1_q01"-->',
      '',
      '后续正文'
    ].join('\n')
    const { md, slotCount } = renderQuizSlotPlaceholders(source, WAITING, HINT)

    expect(slotCount).toBe(1)
    expect(md).toContain(`> **${WAITING}**`)
    expect(md).toContain('`dv_ch1_q01`')
    expect(md).toContain('# 第5章 MapReduce')
    expect(md).toContain('后续正文')
    expect(md).not.toContain('<!--quiz-slot')
  })

  it('counts several slots, accepts single quotes and preserves indentation', () => {
    const source = [
      '<!--quiz-slot id="q1"-->',
      "  <!--quiz-slot id='q2'-->",
      '<!--quiz-slot id="q3"-->'
    ].join('\n')
    const { md, slotCount } = renderQuizSlotPlaceholders(source, WAITING, HINT)

    expect(slotCount).toBe(3)
    expect(md).toContain('  > **课堂题待发放**')
    expect(md).toContain('`q2`')
    expect(md).not.toContain('<!--quiz-slot')
  })

  it('leaves inline comments and ordinary content untouched', () => {
    const source = [
      '正文里手写 <!--quiz-slot id="q9"--> 不该被换',
      '<!--quiz id="q1" answer="A"-->',
      '普通段落'
    ].join('\n')
    const { md, slotCount } = renderQuizSlotPlaceholders(source, WAITING, HINT)

    expect(slotCount).toBe(0)
    expect(md).toBe(source)
  })

  it('is stable across repeated calls (global regex state does not leak)', () => {
    const source = '<!--quiz-slot id="q1"-->'
    const first = renderQuizSlotPlaceholders(source, WAITING, HINT)
    const second = renderQuizSlotPlaceholders(source, WAITING, HINT)

    expect(first).toEqual(second)
    expect(first.slotCount).toBe(1)
  })

  it('replaces only the slot matching questionKey with stem and options', () => {
    const source = [
      '<!--quiz-slot id="q1"-->',
      '<!--quiz-slot id="q2"-->'
    ].join('\n')
    const { md, slotCount } = renderQuizSlots(source, {
      waiting: WAITING,
      hint: HINT,
      activeLabel: '课堂题 · 作答中',
      question: {
        questionKey: 'q2',
        stem: 'Shuffle 发生在哪个阶段？',
        options: ['Map 之前', 'Map 与 Reduce 之间', 'Reduce 之后'],
        limitSec: 30
      }
    })

    expect(slotCount).toBe(2)
    expect(md).toContain('`q1`')
    expect(md).toContain('课堂题待发放')
    expect(md).toContain('Shuffle 发生在哪个阶段？')
    expect(md).toContain('> - A. Map 之前')
    expect(md).toContain('> - C. Reduce 之后')
    expect(md).not.toContain('<!--quiz-slot')
  })

  it('falls back to placeholders when the opened question matches no slot', () => {
    const source = '<!--quiz-slot id="q1"-->'
    const { md } = renderQuizSlots(source, {
      waiting: WAITING,
      hint: HINT,
      activeLabel: '课堂题 · 作答中',
      question: {
        questionKey: 'other',
        stem: '不会出现的题干',
        options: ['A'],
        limitSec: 10
      }
    })

    expect(md).toContain('> **课堂题待发放**')
    expect(md).not.toContain('不会出现的题干')
  })
})
