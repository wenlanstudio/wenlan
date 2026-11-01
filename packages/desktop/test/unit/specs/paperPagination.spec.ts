import { describe, it, expect, beforeEach, vi } from 'vitest'
import { paginateBlocks, parsePaperGeometry, type PaperBlockBox } from '@/util/paperPagination'

// `@/util/pdf` 在加载时读 `window.path`（preload 桥），vitest 环境需先补桩。
vi.hoisted(() => {
  const w = globalThis as unknown as { window?: { path?: { sep: string; join: (...p: string[]) => string } } }
  w.window ??= {}
  w.window.path ??= { sep: '/', join: (...p: string[]) => p.join('/') }
})

// keep-together 贪心分页（视图模型 §5 / M2）。y 坐标以内容盒顶为 0。
const block = (tag: string, top: number, bottom: number): PaperBlockBox => ({ tag, top, bottom })

describe('paginateBlocks (keep-together greedy)', () => {
  it('empty document → one page, no seams', () => {
    const r = paginateBlocks([], 1000)
    expect(r.seams).toEqual([])
    expect(r.pageCount).toBe(1)
  })

  it('blocks fitting one page → no seams', () => {
    const r = paginateBlocks([block('p', 0, 400), block('p', 410, 800)], 1000)
    expect(r.seams).toEqual([])
    expect(r.pageCount).toBe(1)
    expect(r.lastBadgeY).toBe(828)
  })

  it('a block crossing the boundary is pushed whole (seam at gap middle)', () => {
    // H=1000；块2 底 1200 越页 → 推下页，缝落 500..510 间隙中点。
    const r = paginateBlocks([block('p', 0, 500), block('p', 510, 1200)], 1000)
    expect(r.seams).toEqual([{ y: 505, crossed: false }])
    expect(r.pageCount).toBe(2)
  })

  it('exact fill does not create a seam', () => {
    // 块2 底恰好 = 页内容高。
    const r = paginateBlocks([block('p', 0, 500), block('p', 510, 1000)], 1000)
    expect(r.seams).toEqual([])
    expect(r.pageCount).toBe(1)
  })

  it('a heading stranded at page bottom moves with its next block (break-after:avoid)', () => {
    // h2 放得下（底 900 ≤ 1000）但下一块放不下（底 1420 > 1000）且下一块
    // 单独能随标题成页（500 + 20 + 500 = 1020？——推下后标题页内 0..390、
    // 下一块 410..910 ≤ 1000 放得下）→ 标题一并推下页，此后无二缝。
    const r = paginateBlocks(
      [block('p', 0, 500), block('h2', 510, 900), block('p', 920, 1420)],
      1000
    )
    expect(r.seams).toEqual([{ y: 505, crossed: false }])
    expect(r.pageCount).toBe(2)
  })

  it('heading + next that fits both stay (no seam)', () => {
    // h2 与下一块都在页内（nextEnd = 700 + 20 + 260 = 980 ≤ 1000）。
    const r = paginateBlocks(
      [block('p', 0, 500), block('h2', 510, 700), block('p', 720, 980)],
      1000
    )
    expect(r.seams).toEqual([])
    expect(r.pageCount).toBe(1)
  })

  it('an oversized block is crossed by window-boundary seams (dashed through)', () => {
    // H=100；首块 0..60；超整页块 80..330（高 250）：页内起点 60+20=80，
    // 端点 330 → 缝在 100、200、300（相对内容顶）。
    const r = paginateBlocks([block('p', 0, 60), block('pre', 80, 330)], 100)
    expect(r.seams).toEqual([
      { y: 100, crossed: true },
      { y: 200, crossed: true },
      { y: 300, crossed: true }
    ])
    expect(r.pageCount).toBe(4)
  })

  it('an oversized block exactly filling windows leaves a fresh page (gap truncated)', () => {
    // H=100；首块即超整页 0..200：缝 100；端点 200 整除 → 下一页全新，
    // 后续块作为页首块缝上间隙截断（top 210 的 10px 间隙不计）。
    const r = paginateBlocks([block('table', 0, 200), block('p', 210, 230)], 100)
    expect(r.seams).toEqual([{ y: 100, crossed: true }])
    expect(r.pageCount).toBe(2)
  })

  it('a gap that reaches past the boundary pushes before crossing', () => {
    // H=100；前块底 90、超整页块顶 100（间隙 10 到达页界）→ 先推（缝 95），
    // 再从新页 0 起穿缝：100..450 内缝 100/200/300/400？——注意推下后块
    // 高 350，缝在 100、200、300。
    const r = paginateBlocks(
      [block('p', 0, 60), block('p', 70, 90), block('pre', 100, 450)],
      100
    )
    expect(r.seams).toEqual([
      { y: 95, crossed: false },
      { y: 200, crossed: true },
      { y: 300, crossed: true },
      { y: 400, crossed: true }
    ])
    expect(r.pageCount).toBe(5)
  })

  it('pushed block starts its page with truncated gap (fit = height only)', () => {
    // H=100；块2 被推（顶 90+高 15 → 底 105 越页）；块3 顶 125：新页内
    // 起点 = 15（块2 高），+10 间隙 = 25，底 45 ≤ 100 → 同页。
    const r = paginateBlocks(
      [block('p', 0, 80), block('p', 90, 105), block('p', 125, 145)],
      100
    )
    expect(r.seams).toEqual([{ y: 85, crossed: false }])
    expect(r.pageCount).toBe(2)
  })
})

// —— 打印侧同策略契约（硬验收的另一半）：printable 分支输出块级
//    break-inside:avoid，与屏测（paginateBlocks）同款 keep-together。 ——
describe('print chain keeps blocks together (view-model §5 hard acceptance)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('getCssForOptions printable branch emits block-level break-inside:avoid', async() => {
    const { getCssForOptions } = await import('@/util/pdf')
    const css = await getCssForOptions({ type: 'pdf', pageMarginTop: 20, pageMarginRight: 15, pageMarginBottom: 20, pageMarginLeft: 15 })
    expect(css).toContain('.markdown-body>*{break-inside:avoid;}')
  })

  it('printable branch styles the pagebreak marker as a forced page break', async() => {
    const { getCssForOptions } = await import('@/util/pdf')
    const css = await getCssForOptions({ type: 'pdf', pageMarginTop: 20, pageMarginRight: 15, pageMarginBottom: 20, pageMarginLeft: 15 })
    expect(css).toContain('.markdown-body .mt-pagebreak{height:0;margin:0;padding:0;border:0;break-after:page;}')
  })

  it('styledHtml branch does not paginate', async() => {
    const { getCssForOptions } = await import('@/util/pdf')
    const css = await getCssForOptions({ type: 'styledHtml' })
    expect(css).not.toContain('break-inside')
    expect(css).not.toContain('mt-pagebreak')
  })
})

// —— `<!-- pagebreak -->` 强制分页（M3a）与 frontmatter 纸型（M3b）。 ——
describe('forced pagebreak seams (view-model §5 / M3)', () => {
  const pb = (tag = 'figure'): PaperBlockBox => ({ tag, top: 0, bottom: 0, isPagebreak: true })

  it('a pagebreak marker forces a seam even when everything fits', () => {
    // 标记块 100..120，后块 130..500：容量全放得下，缝仍然落标记之后。
    const marker = pb()
    marker.top = 100
    marker.bottom = 120
    const r = paginateBlocks([block('p', 0, 90), marker, block('p', 130, 500)], 1000)
    expect(r.seams).toEqual([{ y: 125, crossed: false }])
    expect(r.pageCount).toBe(2)
  })

  it('a pagebreak at document start or with no content on the page is inert', () => {
    // 文档起始的分页符：fragmentainer 为空，forced break 无操作（镜像
    // Chromium）——后块仍在第 1 页。
    const marker = pb()
    marker.top = 0
    marker.bottom = 20
    const r = paginateBlocks([marker, block('p', 30, 300)], 1000)
    expect(r.seams).toEqual([])
    expect(r.pageCount).toBe(1)

    // 连续分页符同理：标记之间无正文，不产空白页。
    const m2 = pb()
    m2.top = 30
    m2.bottom = 50
    const r2 = paginateBlocks([marker, m2, block('p', 60, 300)], 1000)
    expect(r2.seams).toEqual([])
    expect(r2.pageCount).toBe(1)
  })

  it('a pagebreak resets page capacity (next page accounting restarts)', () => {
    // 页 1 内容到 900；标记强制缝后，后块在页 2 从 0 计——10..360 放得下。
    const marker = pb()
    marker.top = 910
    marker.bottom = 930
    const r = paginateBlocks([block('p', 0, 900), marker, block('p', 940, 1290)], 1000)
    expect(r.seams).toEqual([{ y: 935, crossed: false }])
    expect(r.pageCount).toBe(2)
  })
})

describe('paper geometry from frontmatter (view-model §5 / M3)', () => {
  it('defaults to A4 without/unknown paper declaration', () => {
    expect(parsePaperGeometry('')).toEqual({ pageWidthMm: 210, pageHeightMm: 297 })
    expect(parsePaperGeometry('---\ntitle: x\n---\nbody')).toEqual({ pageWidthMm: 210, pageHeightMm: 297 })
    expect(parsePaperGeometry('---\npaper: a3\n---\nbody')).toEqual({ pageWidthMm: 210, pageHeightMm: 297 })
  })

  it('parses paper: letter (case-insensitive) and keeps a4 explicit', () => {
    expect(parsePaperGeometry('---\npaper: letter\n---\nbody')).toEqual({ pageWidthMm: 215.9, pageHeightMm: 279.4 })
    expect(parsePaperGeometry('---\npaper: "Letter"\n---\nbody')).toEqual({ pageWidthMm: 215.9, pageHeightMm: 279.4 })
    expect(parsePaperGeometry('---\npaper: A4\n---\nbody')).toEqual({ pageWidthMm: 210, pageHeightMm: 297 })
  })

  it('insertPagebreakMarkers swaps standalone comment lines only', async() => {
    const { insertPagebreakMarkers } = await import('@/util/exportHtml')
    expect(insertPagebreakMarkers('A\n\n<!-- pagebreak -->\n\nB'))
      .toBe('A\n\n<div class="mt-pagebreak"></div>\n\nB')
    // 缩进与大小写宽容；行内注释保持惰性。
    expect(insertPagebreakMarkers('A\n\n   <!-- PageBreak -->\n\nB'))
      .toBe('A\n\n<div class="mt-pagebreak"></div>\n\nB')
    expect(insertPagebreakMarkers('text with <!-- pagebreak --> inside'))
      .toBe('text with <!-- pagebreak --> inside')
    // 多处标记全部替换（/g——漏掉会变成"只有第一个分页符生效"）。
    expect(insertPagebreakMarkers('A\n\n<!-- pagebreak -->\n\nB\n\n<!-- pagebreak -->\n\nC').match(/mt-pagebreak/g))
      .toHaveLength(2)
  })
})
