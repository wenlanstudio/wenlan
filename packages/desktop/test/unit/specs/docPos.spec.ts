// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  locateSpan,
  pixelForRealLine,
  realLineForPixel,
  spanProgress,
  spanRealLine,
  spansFromStarts,
  type LineSpan
} from '@/util/docPos'

// 公共坐标的纯组合换算层（view-model §6.0）：一个量纲（源码行），实数行位
// ℓ* 是归一化后的量。行覆盖是 σᵢ 的实现，pixel/realLine 互逆对是 ρᵢ/Rᵢ 的
// 单元内部分——性质测试盯住模型的不变量：ρᵢ ∘ Rᵢ = id。

describe('spansFromStarts — 覆盖构造', () => {
  it('相邻单元封接、末块吞到文档尾', () => {
    expect(spansFromStarts([1, 3, 8], 12)).toEqual([
      { start: 1, end: 2 },
      { start: 3, end: 7 },
      { start: 8, end: 12 }
    ])
  })

  it('零行块（行内标记被吸收）退化为单点区间', () => {
    const spans = spansFromStarts([1, 3, 3, 5], 6)
    expect(spans[1]).toEqual({ start: 3, end: 3 })
    expect(spans[2]).toEqual({ start: 3, end: 4 })
  })

  it('空表出空覆盖', () => {
    expect(spansFromStarts([], 5)).toEqual([])
  })
})

describe('locateSpan — σ⁻¹ 总映射', () => {
  const spans = spansFromStarts([1, 3, 8], 12)

  it('行落单元内取该单元', () => {
    expect(locateSpan(spans, 1)).toBe(0)
    expect(locateSpan(spans, 5)).toBe(1)
    expect(locateSpan(spans, 12)).toBe(2)
  })

  it('块界取后者（前块末行的下一行开新块）', () => {
    expect(locateSpan(spans, 3)).toBe(1)
    expect(locateSpan(spans, 8)).toBe(2)
  })

  it('首单元之前返回 null（frontmatter 等行表外头部）', () => {
    expect(locateSpan(spans, 0)).toBeNull()
  })

  it('零行块同行开始取最后一个 start ≤ line 的单元', () => {
    expect(locateSpan(spansFromStarts([1, 3, 3, 5], 6), 3)).toBe(2)
  })

  it('空覆盖返回 null', () => {
    expect(locateSpan([], 1)).toBeNull()
  })
})

describe('spanProgress / spanRealLine — 块内行进度与其逆', () => {
  const span: LineSpan = { start: 10, end: 19 } // d = 10

  it('起点 0、末行下一行开边界 1、中点成比例', () => {
    expect(spanProgress(span, 10)).toBe(0)
    expect(spanProgress(span, 20)).toBe(1)
    expect(spanProgress(span, 15)).toBeCloseTo(0.5)
  })

  it('越界夹取到 [0, 1]', () => {
    expect(spanProgress(span, 0)).toBe(0)
    expect(spanProgress(span, 100)).toBe(1)
  })

  it('零行块恒 0（不除零）', () => {
    expect(spanProgress({ start: 5, end: 4 }, 100)).toBe(0)
  })

  it('spanRealLine ∘ spanProgress = id', () => {
    for (let x = 0; x <= 1.001; x += 0.125) {
      expect(spanProgress(span, spanRealLine(span, Math.min(x, 1)))).toBeCloseTo(Math.min(x, 1))
    }
  })
})

describe('ρᵢ ∘ Rᵢ = id — 实现/读出互逆性（§6.0 不变量）', () => {
  const spans = spansFromStarts([1, 4, 9, 15], 20)
  const tops = [0, 50, 130, 210]
  const heights = [50, 80, 80, 90]

  it('单元边界精确、单元内部按比例精确还原', () => {
    spans.forEach((span, i) => {
      for (let l = span.start; l <= span.end + 1; l += 0.25) {
        const pixel = pixelForRealLine(tops[i]!, heights[i]!, span, l)
        expect(realLineForPixel(tops[i]!, heights[i]!, span, pixel)).toBeCloseTo(l, 9)
      }
    })
  })

  it('两侧块高不同（换行宽窄）时：行位一致、像素各自成立', () => {
    const span = spans[1]! // [4, 8]
    // 文：块高 100；栏投影更窄、换行更多 → 块高 160。同一 ℓ*=6 在两边
    // 各自落在自己几何的同一内容进度上——同步的是文档位置，不是像素位置。
    const flow = pixelForRealLine(0, 100, span, 6)
    const column = pixelForRealLine(0, 160, span, 6)
    expect(flow).not.toBe(column)
    expect(realLineForPixel(0, 100, span, flow)).toBeCloseTo(6, 9)
    expect(realLineForPixel(0, 160, span, column)).toBeCloseTo(6, 9)
  })

  it('读出夹取：视口顶越过单元两端不越界，零高单元取块首', () => {
    const span = spans[2]!
    expect(realLineForPixel(130, 80, span, 0)).toBe(span.start)
    expect(realLineForPixel(130, 80, span, 10_000)).toBe(span.end + 1)
    expect(realLineForPixel(130, 0, span, 25)).toBe(span.start)
  })
})
