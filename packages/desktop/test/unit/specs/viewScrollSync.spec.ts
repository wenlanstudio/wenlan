// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  contentBlocks,
  findBlockIndex,
  findLineByText,
  scrollViewToAnchor,
  sourceAnchorOf,
  stripMarkdownSyntax,
  viewAnchorOf
} from '@/util/viewScrollSync'

// 视图间滚动同步（TODO1 #4）的纯 DOM 逻辑。三个视图（document/page、document/columns、
// code/source 源码）是同一份文档的不同排版，切换时应当停在同一个文档区域；锚点用
// 「内容块序号 / 源码行号 / 纯文本」三种坐标表达，这里锁定它们之间的换算。

const el = (html: string): HTMLElement => {
  const wrapper = document.createElement('div')
  wrapper.innerHTML = html
  return wrapper
}

/** 块级分栏标记块（htmlPreview 渲染的徽标载体，独立成块）。 */
const markerFigure = (kind: string): string =>
  `<figure class="mu-html-block"><div class="mu-html-preview">`
  + `<div class="mu-mdcols-marker" data-kind="${kind}" style="display:none"></div>`
  + `</div></figure>`

const para = (text: string): string => `<p>${text}</p>`

/**
 * 分栏组：块树里的 `columns` 节点，DOM 上是 `.mu-columns` > `.mu-column`。
 * 两个视图的 DOM 结构相同，只有 CSS 不同。
 */
const group = (...cols: string[]): string =>
  `<div class="mu-columns">${cols.map(c => `<div class="mu-column">${c}</div>`).join('')}</div>`

/** mock 各块的垂直位置：`tops[i]` 为第 i 个块的 top，高度固定 100。 */
const mockRects = (container: HTMLElement, tops: number[]): void => {
  container.getBoundingClientRect = () =>
    ({ top: 0, bottom: 600, height: 600 }) as DOMRect
  contentBlocks(container).forEach((block, i) => {
    block.getBoundingClientRect = () =>
      ({ top: tops[i], bottom: tops[i] + 100, height: 100 }) as DOMRect
  })
}

let container: HTMLElement

beforeEach(() => {
  document.body.innerHTML = ''
  container = document.createElement('div')
  document.body.appendChild(container)
})

describe('contentBlocks — the anchor sequence', () => {
  it('drops block-level marker carriers from the page view sequence', () => {
    container.innerHTML
      = para('p0') + markerFigure('begin') + para('p1') + markerFigure('split')
        + para('p2') + markerFigure('end') + para('p3')

    expect(contentBlocks(container).map(b => b.textContent)).toEqual(['p0', 'p1', 'p2', 'p3'])
  })

  it('flattens column groups and drops the marker blocks inside them', () => {
    container.innerHTML
      = para('p0')
        + group(para('p1'), markerFigure('split') + para('p2'))
        + para('p3')

    expect(contentBlocks(container).map(b => b.textContent)).toEqual(['p0', 'p1', 'p2', 'p3'])
  })

  it('keeps paragraphs that carry an inline badge in the sequence', () => {
    // 行内徽标是段落内的 span，不是 .mu-html-preview 里的载体，不得误判为标记块。
    container.innerHTML
      = `<p>p0<span class="mu-mdcols-marker mu-mdcols-inline" data-kind="begin"></span></p>` + para('p1')

    expect(contentBlocks(container).map(b => b.textContent)).toEqual(['p0', 'p1'])
  })

  it('yields the SAME sequence for the two views of one document', () => {
    // 两个视图的块树相同，DOM 结构也相同——只有 CSS 不同。
    const page = el(para('p0') + group(para('p1'), para('p2')) + para('p3'))
    const columns = el(para('p0') + group(para('p1'), para('p2')) + para('p3'))

    expect(contentBlocks(page).map(b => b.textContent))
      .toEqual(contentBlocks(columns).map(b => b.textContent))
  })

  it('reads the blocks from the engine content column, not from the scroll container', () => {
    // 引擎的 DOM 是 `.mu-editor`（滚动容器）→ `.mu-container`（文本列）→ 块。
    // 滚动与视口几何属于外层，块序列属于内层——混淆两者会得到「整篇文档」
    // 这一个「块」，锚点永远指向顶部。
    container.innerHTML = `<div class="mu-container">${para('p0')}${para('p1')}</div>`
    mockRects(container, [0, 100])

    expect(contentBlocks(container).map(b => b.textContent)).toEqual(['p0', 'p1'])
    expect(viewAnchorOf(container)?.blockIndex).toBe(0)
    expect(viewAnchorOf(container)?.text).toBe('p0')
  })
})

describe('viewAnchorOf / scrollViewToAnchor', () => {
  beforeEach(() => {
    container.innerHTML = para('b0') + para('b1') + para('b2') + para('b3')
  })

  it('reads the first block whose bottom enters the viewport', () => {
    // b0 完全在视口上方，b1 贴着视口顶 → 锚点 1。
    mockRects(container, [-100, 0, 100, 200])

    expect(viewAnchorOf(container)?.blockIndex).toBe(1)
  })

  it('falls back to the last block when everything is scrolled past', () => {
    mockRects(container, [-800, -700, -600, -500])

    expect(viewAnchorOf(container)?.blockIndex).toBe(3)
  })

  it('carries the visible block text so other views can convert the position', () => {
    mockRects(container, [-100, 0, 100, 200])

    expect(viewAnchorOf(container)?.text).toBe('b1')
  })

  it('returns null for an empty container', () => {
    container.innerHTML = ''
    expect(viewAnchorOf(container)).toBeNull()
    expect(viewAnchorOf(null)).toBeNull()
  })

  it('scrolls the target block to the viewport top', () => {
    mockRects(container, [0, 500, 1000, 1500])
    container.scrollTop = 0

    scrollViewToAnchor(container, { blockIndex: 2 })

    expect(container.scrollTop).toBe(1000)
  })

  it('clamps an out-of-range anchor to the first / last block', () => {
    mockRects(container, [0, 500, 1000, 1500])
    container.scrollTop = 0

    scrollViewToAnchor(container, { blockIndex: 99 })

    expect(container.scrollTop).toBe(1500)

    container.scrollTop = 0
    scrollViewToAnchor(container, { blockIndex: -5 })

    expect(container.scrollTop).toBe(0)
  })

  it('resolves a text-only anchor (from the source view) to its block', () => {
    mockRects(container, [0, 500, 1000, 1500])
    container.scrollTop = 0

    scrollViewToAnchor(container, { text: 'b2' })

    expect(container.scrollTop).toBe(1000)
  })

  it('leaves the scroll position alone when the text matches no block', () => {
    mockRects(container, [0, 500, 1000, 1500])
    container.scrollTop = 42

    scrollViewToAnchor(container, { text: 'nowhere in this document' })

    expect(container.scrollTop).toBe(42)
  })
})

// 锚存储已收口到 util/docAnchor.ts（多标签页关闭，per-tab Map 退役）——
// 本文件只锁定纯换算函数。

describe('text bridge between the views', () => {
  it('strips the markdown syntax of a source line', () => {
    expect(stripMarkdownSyntax('# 标题')).toBe('标题')
    expect(stripMarkdownSyntax('- 列表项')).toBe('列表项')
    expect(stripMarkdownSyntax('> 引用')).toBe('引用')
    expect(stripMarkdownSyntax('```js')).toBe('js')
  })

  it('matches a rendered block against its source line', () => {
    const blocks = contentBlocks(el(para('普通段落') + para('**粗体** 文本')))

    // 渲染后的块文本没有 markdown 标记，但两者指的是同一处内容。
    expect(findBlockIndex(blocks, '**粗体** 文本')).toBe(1)
    expect(findBlockIndex(blocks, '粗体 文本')).toBe(1)
  })

  it('prefers the exact match over a fuzzy one', () => {
    const blocks = contentBlocks(el(para('重复') + para('重复段落') + para('段落')))

    expect(findBlockIndex(blocks, '重复段落')).toBe(1)
  })

  it('returns -1 when nothing matches', () => {
    const blocks = contentBlocks(el(para('a') + para('b')))

    expect(findBlockIndex(blocks, 'zzz')).toBe(-1)
  })
})

describe('source anchor', () => {
  const markdown = ['# 标题', '', '正文段落', '- 列表项'].join('\n')

  it('records the line and its plain text', () => {
    expect(sourceAnchorOf(markdown, 3)).toEqual({ line: 3, text: '正文段落' })
  })

  it('clamps a line outside the document', () => {
    expect(sourceAnchorOf(markdown, 99).line).toBe(4)
    expect(sourceAnchorOf(markdown, 0).line).toBe(1)
  })

  it('findLineByText resolves a text anchor (from the page view) to its source line', () => {
    expect(findLineByText(markdown, '正文段落')).toBe(3)
    expect(findLineByText(markdown, '列表项')).toBe(4)
  })

  it('findLineByText returns null when the text matches nothing', () => {
    expect(findLineByText(markdown, '不在文档里')).toBeNull()
    expect(findLineByText(markdown, '')).toBeNull()
  })
})

// 跨视图共享一个锚点，但各视图只能算出自己的坐标（page/columns 有
// blockIndex、source 有 line）。合并写入让两套坐标常驻，跨视图直接命中本
// 坐标；编辑会让坐标漂移，读时校验文本不符就退回 text 桥——这是「切换视图
// 位置丢失 / 跳顶」根因（TODO1 #4）的修复覆盖。
describe('cross-view drift validation (pure functions)', () => {
  it('sourceAnchorOf walks up to a content-bearing line when the viewport top is blank', () => {
    // 视口顶部行常是空行 / 代码围栏，strip 后为空——空 text 会让 text 桥
    // 断链、切到 page/columns 时静默 return 跳顶。向上找最近的有内容行作桥
    // 证据；line 仍记真实视口顶部行号，保证源码视图内部恢复精度。
    const md = ['标题', '', '正文'].join('\n')

    expect(sourceAnchorOf(md, 2)).toEqual({ line: 2, text: '标题' })
  })

  it('scrollViewToAnchor falls back to the text bridge when blockIndex drifted', () => {
    // 编辑后块序号漂移：blockIndex 指向 b2，但该处的文本已是 b3——放弃精确
    // 坐标、按 text 找到 b3，避免滚到错误位置。
    container.innerHTML = para('b0') + para('b1') + para('b2') + para('b3')
    mockRects(container, [0, 500, 1000, 1500])
    container.scrollTop = 0

    scrollViewToAnchor(container, { blockIndex: 2, text: 'b3' })

    expect(container.scrollTop).toBe(1500)
  })

  it('keeps the clamped block when blockIndex is merely out of range (no text to contradict it)', () => {
    // 越界夹取（无 text 校验）仍滚到末块，与原 clamp 行为一致——这是「未漂移、
    // 只是序号越界」的正常路径，不得误判为漂移而跳顶。
    container.innerHTML = para('b0') + para('b1')
    mockRects(container, [0, 500])
    container.scrollTop = 0

    scrollViewToAnchor(container, { blockIndex: 99 })

    expect(container.scrollTop).toBe(500)
  })
})
