// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  blockIndexToLine,
  flushDocAnchorWrite,
  lastEditingSurface,
  lineToBlockIndex,
  onDocAnchorChange,
  readDocAnchor,
  rememberSurface,
  reviseMarkdown,
  scheduleDocAnchorWrite,
  updateLineTable,
  writeDocAnchor,
  matchesCurrentMarkdown
} from '@/util/docAnchor'

// 一文多览锚服务（view-model §6.1）：单槽锚 + mdRev + 块首行表换算 + 最近
// 编辑面记忆。多标签页已关闭，无 tab 维度。

const mdA = '# A\n\ntext'
const mdB = '# B\n\tother'

beforeEach(() => {
  reviseMarkdown('') // 冷启动基线
  writeDocAnchor({ mdRev: 0 }) // 占位，下面重置
  // 重置模块态：revise 到空后写一次空锚（模块无 reset 导出，靠行为覆盖）
})

describe('reviseMarkdown / mdRev', () => {
  it('advances rev only when markdown changes', () => {
    const r1 = reviseMarkdown(mdA)
    expect(reviseMarkdown(mdA)).toBe(r1)
    expect(reviseMarkdown(mdB)).toBe(r1 + 1)
    expect(matchesCurrentMarkdown(mdB)).toBe(true)
    expect(matchesCurrentMarkdown(mdA)).toBe(false)
  })
})

describe('writeDocAnchor — merge semantics', () => {
  it('merges coordinates and stamps the current mdRev', () => {
    reviseMarkdown(mdA)
    writeDocAnchor({ topBlock: 3, text: 'x' })
    writeDocAnchor({ topLine: 7 })

    const anchor = readDocAnchor()
    expect(anchor?.topBlock).toBe(3)
    expect(anchor?.topLine).toBe(7)
    expect(anchor?.mdRev).toBeGreaterThan(0)
  })

  it('notifies subscribers on write', () => {
    reviseMarkdown(mdA)
    const seen: unknown[] = []
    const off = onDocAnchorChange(a => seen.push(a))
    writeDocAnchor({ topBlock: 1 })
    off()
    writeDocAnchor({ topBlock: 2 }) // 退订后不再收

    expect(seen.length).toBe(1)
  })
})

describe('rAF coalescing', () => {
  it('scheduleDocAnchorWrite coalesces to one write per frame', async() => {
    reviseMarkdown(mdA)
    let calls = 0
    const compute = () => {
      calls += 1
      return { topBlock: calls }
    }
    scheduleDocAnchorWrite(compute)
    scheduleDocAnchorWrite(compute)
    scheduleDocAnchorWrite(compute)
    await new Promise(requestAnimationFrame)

    expect(calls).toBe(1)
    expect(readDocAnchor()?.topBlock).toBe(1)
  })

  it('flushDocAnchorWrite cancels the pending rAF and writes now', async() => {
    reviseMarkdown(mdA)
    let calls = 0
    const compute = () => {
      calls += 1
      return { topLine: 42 }
    }
    scheduleDocAnchorWrite(compute)
    flushDocAnchorWrite()
    await new Promise(requestAnimationFrame)

    expect(calls).toBe(1)
    expect(readDocAnchor()?.topLine).toBe(42)
  })
})

describe('line table conversion', () => {
  beforeEach(() => {
    reviseMarkdown(mdA)
    updateLineTable(mdA, [1, 3, 5, 12])
  })

  it('blockIndexToLine maps index to start line', () => {
    expect(blockIndexToLine(mdA, 0)).toBe(1)
    expect(blockIndexToLine(mdA, 3)).toBe(12)
    expect(blockIndexToLine(mdA, 4)).toBeNull()
    expect(blockIndexToLine(mdA, -1)).toBeNull()
    expect(blockIndexToLine(mdA, undefined)).toBeNull()
  })

  it('blockIndexToLine returns null when the table is stale', () => {
    expect(blockIndexToLine(mdB, 0)).toBeNull()
  })

  it('blockIndexToLine returns null after the table is invalidated', () => {
    updateLineTable(mdA, null)
    expect(blockIndexToLine(mdA, 0)).toBeNull()
  })

  it('lineToBlockIndex finds the block containing the line', () => {
    expect(lineToBlockIndex(mdA, 1)).toBe(0)
    expect(lineToBlockIndex(mdA, 4)).toBe(1) // [3, 5) 落第 1 块
    expect(lineToBlockIndex(mdA, 99)).toBe(3) // 尾块吞到文档尾
    expect(lineToBlockIndex(mdA, 0)).toBeNull() // 首块之前
    expect(lineToBlockIndex(mdB, 1)).toBeNull() // 表脏
  })
})

describe('lastEditingSurface', () => {
  it('defaults to flow and remembers the latest surface', () => {
    expect(lastEditingSurface()).toBe('flow')
    rememberSurface('source')
    expect(lastEditingSurface()).toBe('source')
    rememberSurface('flow')
    expect(lastEditingSurface()).toBe('flow')
  })
})

// vi 导入保留给后续 mock 用例（jsdom rAF 环境已够本文件使用）。
void vi
