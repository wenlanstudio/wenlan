import { describe, expect, it } from 'vitest'
import type { Md2rBlockInfo } from '@shared/types/mdcode2run'
import { codeSlice, findFenceByCode } from '@/util/fenceRun'

// Issue #4 — muya's run button only carries the code text; the host has to
// resolve it back to a 0-based fence line for mdcode2run.run().

const block = (over: Partial<Md2rBlockInfo> = {}): Md2rBlockInfo => ({
  index: 0,
  lang: 'python',
  family: 'python',
  supported: true,
  runnable: true,
  line: 1,
  end: 4,
  role: 'code',
  job: false,
  file: undefined,
  problems: [],
  ...over
})

const MD = [
  '# T',
  '```python',
  'print(1)',
  '```',
  '',
  '```bash',
  'echo hi',
  '```',
  ''
].join('\n')

describe('fenceRun — codeSlice', () => {
  it('returns the body without the opening / closing fence lines', () => {
    expect(codeSlice(MD, { line: 1, end: 4 })).toBe('print(1)')
    expect(codeSlice(MD, { line: 5, end: 8 })).toBe('echo hi')
  })

  it('handles an empty block', () => {
    expect(codeSlice(MD, { line: 1, end: 3 })).toBe('')
  })
})

describe('fenceRun — findFenceByCode', () => {
  const blocks = [
    block({ line: 1, end: 4, lang: 'python' }),
    block({ index: 1, line: 5, end: 8, lang: 'bash', family: 'shell' })
  ]

  it('finds the fence by its body text', () => {
    expect(findFenceByCode(MD, blocks, 'print(1)')?.line).toBe(1)
    expect(findFenceByCode(MD, blocks, 'echo hi')?.line).toBe(5)
  })

  it('prefers a runnable block when two fences share the same body', () => {
    const same = [
      block({ line: 0, end: 3, runnable: false, role: 'demo' }),
      block({ index: 1, line: 4, end: 7, runnable: true })
    ]
    const md = ['```python', 'print(1)', '```', '', '```bash', 'print(1)', '```', ''].join('\n')
    expect(findFenceByCode(md, same, 'print(1)')?.line).toBe(4)
  })

  it('still returns a non-runnable block (the caller decides not to run it)', () => {
    const demo = [block({ line: 1, end: 4, runnable: false, role: 'demo' })]
    expect(findFenceByCode(MD, demo, 'print(1)')?.runnable).toBe(false)
  })

  it('returns null for empty text, no match, or an empty block list', () => {
    expect(findFenceByCode(MD, blocks, '')).toBeNull()
    expect(findFenceByCode(MD, blocks, 'not in the document')).toBeNull()
    expect(findFenceByCode(MD, [], 'print(1)')).toBeNull()
  })
})
