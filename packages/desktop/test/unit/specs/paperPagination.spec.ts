import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  paginateBlocks,
  paginateBlocksV2,
  computePagePushes,
  PAPER_PAGE_GAP_MM,
  parsePaperGeometry,
  parseDeclaredPaperSize,
  type PaperBlockBox,
  type PaperBlockBoxV2
} from '@/util/paperPagination'

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

// —— 卡网格推挤级联（纸姿态，M3.5 切片 B）。 ——
describe('paginateBlocks pageStarts (push targets)', () => {
  it('every seam opens a page whose first block is recorded', () => {
    // H=1000；块2 越页被推（缝 505）→ 页 1 首块 = 块 1。
    const r = paginateBlocks([block('p', 0, 500), block('p', 510, 1200)], 1000)
    expect(r.pageStarts).toEqual([0, 1])
    expect(r.pageStarts).toHaveLength(r.pageCount)
  })

  it('crossed pages start mid-block (-1, no block boundary to push)', () => {
    // H=100；超整页块 80..330 穿出缝 100/200/300 → 页 1..3 均记 -1。
    const r = paginateBlocks([block('p', 0, 60), block('pre', 80, 330)], 100)
    expect(r.pageStarts).toEqual([0, -1, -1, -1])
    expect(r.pageStarts).toHaveLength(r.pageCount)
  })

  it('forced break and heading-avoid record their opening block', () => {
    const marker = { tag: 'figure', top: 100, bottom: 120, isPagebreak: true } as PaperBlockBox
    const r1 = paginateBlocks([block('p', 0, 90), marker, block('p', 130, 500)], 1000)
    expect(r1.pageStarts).toEqual([0, 2])

    // 标题回避：缝开在 h2（块 1）。
    const r2 = paginateBlocks(
      [block('p', 0, 500), block('h2', 510, 900), block('p', 920, 1420)],
      1000
    )
    expect(r2.pageStarts).toEqual([0, 1])
  })

  it('exact-fill oversized end keeps the pinned model (next block joins the crossed page)', () => {
    // H=100；超整页块恰好填满窗口（端点整除）：现行模型不给缝（spec 钉死），
    // 后块留在穿缝开的页里 → 该页首块记 -1。
    const r = paginateBlocks([block('table', 0, 200), block('p', 210, 230)], 100)
    expect(r.seams).toEqual([{ y: 100, crossed: true }])
    expect(r.pageStarts).toEqual([0, -1])
  })
})

describe('computePagePushes (card-grid cascade)', () => {
  it('single page needs no push', () => {
    expect(computePagePushes([0], [0], 1000)).toEqual([0])
  })

  it('pushes each page start onto the grid pitch with cascade', () => {
    // 页 1 首块自然位 500 → 推 500 到 1000；页 2 首块自然位 1100 已含
    // 前页推挤 → 再推 400 到 2000。
    expect(computePagePushes([0, 1, 2], [0, 500, 1100], 1000)).toEqual([0, 500, 400])
  })

  it('page 0 pulls its first block to the origin (negative allowed)', () => {
    // 首块自然顶 24（如 h1 的 margin-top）→ Δ0 = −24，镜像打印侧块顶截断。
    expect(computePagePushes([0], [24], 1000)).toEqual([-24])
  })

  it('clamps to zero after a crossed page (never pulls back, no overlap)', () => {
    // 页 2 首块自然位 2600 已落后于网格 2000（穿缝欠账）→ 不拉回。
    expect(computePagePushes([0, -1, 2], [0, 100, 2600], 1000)).toEqual([0, 0, 0])
  })

  it('grid pitch carries the inter-page gap (page height + gap, zoom applied by caller)', () => {
    // A4：pageStep = (297 + 8)mm；内容高 257mm——格距含 40mm 边距 + 8mm 隙，
    // 恒大于页内容高，不动点稳定（推挤不改块高，缝判定不动）。
    const pageStepMm = 297 + PAPER_PAGE_GAP_MM
    expect(pageStepMm).toBeGreaterThan(257)
  })
})

// —— v2 行级拟合（M4.3a：段落切行 widow/orphan、表格行切+续表表头）——
describe('paginateBlocksV2 (line-level fragmentation)', () => {
  const v2 = (tag: string, top: number, bottom: number, extra: Partial<PaperBlockBoxV2> = {}): PaperBlockBoxV2 => ({
    tag, top, bottom, ...extra
  })

  it('无子结构块照 v1 keep-together', () => {
    const r = paginateBlocksV2([v2('p', 0, 500), v2('p', 510, 1200)], 1000)
    expect(r.seams).toEqual([{ y: 505, crossed: false, split: undefined }])
    expect(r.pageCount).toBe(2)
  })

  it('段落放得下不切；容量切受 widows 收口（缝落行界，split.keep 记行数）', () => {
    // H=200；段 9 行×20（top 70..250），room = 130 → maxFit 6、maxKeep 7 → keep 6。
    const r = paginateBlocksV2(
      [v2('p', 0, 60), v2('p', 70, 250, { lines: Array.from({ length: 9 }, () => 20) })],
      200
    )
    expect(r.seams).toEqual([
      { y: 190, crossed: false, split: { block: 1, kind: 'lines', keep: 6 } }
    ])
    expect(r.pageCount).toBe(2)
    // 后续块从续行的余量起（tail 高 3 行 = 60，+10 间隙）。
    const r2 = paginateBlocksV2(
      [
        v2('p', 0, 60),
        v2('p', 70, 250, { lines: Array.from({ length: 9 }, () => 20) }),
        v2('p', 260, 300)
      ],
      200
    )
    expect(r2.seams).toEqual([
      { y: 190, crossed: false, split: { block: 1, kind: 'lines', keep: 6 } }
    ])
    expect(r2.pageCount).toBe(2)
  })

  it('3 行段内切必违约 → 整段推下页（缝落块间）', () => {
    const r = paginateBlocksV2(
      [v2('p', 0, 150), v2('p', 160, 220, { lines: [20, 20, 20] })],
      200
    )
    expect(r.seams).toEqual([{ y: 155, crossed: false, split: undefined }])
    expect(r.pageCount).toBe(2)
  })

  it('超整页段在页顶容量切（widows 可满足 → at，非穿缝）', () => {
    // H=200；15 行×20 = 300：首页留 10 行（容量 200 = 恰 10 行），余 5 行进次页。
    const r = paginateBlocksV2(
      [v2('p', 0, 300, { lines: Array.from({ length: 15 }, () => 20) }), v2('p', 310, 350)],
      200
    )
    expect(r.seams).toEqual([
      { y: 200, crossed: false, split: { block: 0, kind: 'lines', keep: 10 } }
    ])
    expect(r.pageCount).toBe(2)
  })

  it('表格行切 + 续表表头每页占一份（缝落行界）', () => {
    // H=200；表头 20 + 5 行×30 = 170。room = 130 → availBody 110 → keep 3；
    // 余 2 行在次页（headH + 60 = 80 账目）。
    const r = paginateBlocksV2(
      [
        v2('p', 0, 60),
        v2('table', 70, 240, { table: { headH: 20, rowHeights: [30, 30, 30, 30, 30] } }),
        v2('p', 250, 290)
      ],
      200
    )
    expect(r.seams).toEqual([
      { y: 180, crossed: false, split: { block: 1, kind: 'table-rows', keep: 3 } }
    ])
    expect(r.pageCount).toBe(2)
  })

  it('超页表跨多页（每道续缝记累计行数）', () => {
    // H=200；表头 20 + 5 行×60 = 320 > 200（超页），行容忍（60 ≤ 180）。
    // 首页 3 行（180 = availBody 恰满）→ 次页 2 行。缝 y = 20+180 = 200。
    const r = paginateBlocksV2(
      [v2('table', 0, 320, { table: { headH: 20, rowHeights: [60, 60, 60, 60, 60] } })],
      200
    )
    expect(r.seams).toEqual([
      { y: 200, crossed: false, split: { block: 0, kind: 'table-rows', keep: 3 } }
    ])
    expect(r.pageCount).toBe(2)
  })

  it('本页容不下表头+一行（表非超页）→ 整表推下页', () => {
    const r = paginateBlocksV2(
      [
        v2('p', 0, 160),
        v2('table', 170, 340, { table: { headH: 20, rowHeights: [50, 50, 50] } })
      ],
      200
    )
    expect(r.seams).toEqual([{ y: 165, crossed: false, split: undefined }])
    expect(r.pageCount).toBe(2)
  })

  it('单行高过页内容高 − 表头 → 整表降级穿缝（v1 语义）', () => {
    const r = paginateBlocksV2(
      [v2('table', 0, 290, { table: { headH: 10, rowHeights: [250, 30] } })],
      200
    )
    expect(r.seams).toEqual([{ y: 200, crossed: true, split: undefined }])
    expect(r.pageCount).toBe(2)
  })
})

// —— 打印侧同策略契约（硬验收的另一半）：printable 分支输出块级
//    break-inside:avoid，与屏测（paginateBlocks）同款 keep-together。 ——
describe('print chain keeps blocks together (view-model §5 hard acceptance)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  // 重 import 链（@/util/pdf → @muyajs/core 构建产物），vitest 下数秒级。
  it('getCssForOptions printable branch emits block-level break-inside:avoid', async() => {
    const { getCssForOptions } = await import('@/util/pdf')
    const css = await getCssForOptions({ type: 'pdf', pageMarginTop: 20, pageMarginRight: 15, pageMarginBottom: 20, pageMarginLeft: 15 })
    expect(css).toContain('.markdown-body>*{break-inside:avoid;}')
  }, 30_000)

  it('printable branch styles the pagebreak marker as a forced page break', async() => {
    const { getCssForOptions } = await import('@/util/pdf')
    const css = await getCssForOptions({ type: 'pdf', pageMarginTop: 20, pageMarginRight: 15, pageMarginBottom: 20, pageMarginLeft: 15 })
    expect(css).toContain('.markdown-body .mt-pagebreak{height:0;margin:0;padding:0;border:0;break-after:page;}')
  }, 30_000)

  it('styledHtml branch does not paginate', async() => {
    const { getCssForOptions } = await import('@/util/pdf')
    const css = await getCssForOptions({ type: 'styledHtml' })
    expect(css).not.toContain('break-inside')
    expect(css).not.toContain('mt-pagebreak')
  }, 30_000)
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
  it('reports the declared paper size, null when silent or unknown', () => {
    expect(parseDeclaredPaperSize('')).toBeNull()
    expect(parseDeclaredPaperSize('---\ntitle: x\n---\nbody')).toBeNull()
    expect(parseDeclaredPaperSize('---\npaper: a3\n---\nbody')).toBeNull()
    expect(parseDeclaredPaperSize('---\npaper: letter\n---\nbody')).toBe('letter')
    expect(parseDeclaredPaperSize('---\npaper: "Letter"\n---\nbody')).toBe('letter')
    expect(parseDeclaredPaperSize('---\npaper: A4\n---\nbody')).toBe('a4')
  })

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
  }, 30_000)
})
