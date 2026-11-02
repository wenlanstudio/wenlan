import { describe, expect, it } from 'vitest'
import {
  STRATEGY,
  cutLinesFitting,
  countFittingPrefix,
  bisectMaxFit,
  cutIndexByBottom
} from '@/vendor/md2slides/layout-core'

// vendored md2slides 分页决策内核（M4.2，view-model §5 双端共用合同）：
// sync-md2slides.mjs 把 md2slides 产包里的 lib/layout-core.js 转 ESM 后落进
// renderer 源树（CJS→ESM——dev 下 vite 不做源码 CJS 互操，见 sync 脚本）。
// 本 spec 直接具名导入，验证 vendor 产物在 ESM 形态下可用。

describe('vendored md2slides layout-core (M4.2 dual-end contract)', () => {
  it('策略封闭集与单源仓一致（改内核必带两端回归）', () => {
    expect(STRATEGY.widowFill).toBe(0.35)
    expect(STRATEGY.coreBreakFill).toBe(0.25)
    expect(STRATEGY.tocRoomSlack).toBe(12)
    // v2 段落切行策略：widow/orphan ≥ 2（view-model §5）。
    expect(STRATEGY.orphanLines).toBe(2)
    expect(STRATEGY.widowLines).toBe(2)
  })

  it('段落切行策略可用（v2 合同件冒烟）', () => {
    const lines = Array.from({ length: 9 }, () => 20)
    // 容量 8 行被 widows 收口到 7（续页带 2 行）。
    expect(cutLinesFitting(lines, 160, 400)).toEqual({ kind: 'at', keep: 7 })
    // 3 行段内切必违约 → 整段推下页。
    expect(cutLinesFitting([20, 20, 20], 50, 400)).toEqual({ kind: 'before' })
  })

  it('切点算术可用', () => {
    expect(countFittingPrefix([100, 100, 100], 250)).toBe(2)
    expect(bisectMaxFit(10, (k: number) => k <= 7)).toBe(7)
    expect(cutIndexByBottom([10, 20, 30], 25)).toBe(2)
  })
})
