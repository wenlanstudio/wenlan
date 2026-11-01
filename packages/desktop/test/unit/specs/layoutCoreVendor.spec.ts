import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

// vendored md2slides 分页决策内核（M4.2，view-model §5 双端共用合同）：
// sync-md2slides.mjs 把 md2slides 产包里的 lib/layout-core.js 落进 renderer
// 源树。这里用 createRequire 直载 vendor 源文件——顺带验证 vendor 产物就是
// 能跑的 JS；静态消费（纸叶 v2 块内切分）走 layout-core.d.ts。
const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const layoutCore = require('../../../src/renderer/src/vendor/md2slides/layout-core.js') as any

describe('vendored md2slides layout-core (M4.2 dual-end contract)', () => {
  it('策略封闭集与单源仓一致（改内核必带两端回归）', () => {
    expect(layoutCore.STRATEGY.widowFill).toBe(0.35)
    expect(layoutCore.STRATEGY.coreBreakFill).toBe(0.25)
    expect(layoutCore.STRATEGY.tocRoomSlack).toBe(12)
    // v2 段落切行策略：widow/orphan ≥ 2（view-model §5）。
    expect(layoutCore.STRATEGY.orphanLines).toBe(2)
    expect(layoutCore.STRATEGY.widowLines).toBe(2)
  })

  it('段落切行策略可用（v2 合同件冒烟）', () => {
    const lines = Array.from({ length: 9 }, () => 20)
    // 容量 8 行被 widows 收口到 7（续页带 2 行）。
    expect(layoutCore.cutLinesFitting(lines, 160, 400)).toEqual({ kind: 'at', keep: 7 })
    // 3 行段内切必违约 → 整段推下页。
    expect(layoutCore.cutLinesFitting([20, 20, 20], 50, 400)).toEqual({ kind: 'before' })
  })

  it('切点算术可用', () => {
    expect(layoutCore.countFittingPrefix([100, 100, 100], 250)).toBe(2)
    expect(layoutCore.bisectMaxFit(10, (k: number) => k <= 7)).toBe(7)
    expect(layoutCore.cutIndexByBottom([10, 20, 30], 25)).toBe(2)
  })
})
