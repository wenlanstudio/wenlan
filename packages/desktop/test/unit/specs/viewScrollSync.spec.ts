// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  contentBlocks,
  readViewAnchor,
  scrollViewToAnchor,
  syncScrollAnchor,
  viewAnchorOf,
  writeViewAnchor
} from '@/util/viewScrollSync'

// 视图间滚动锚点同步（TODO1 #3）的纯 DOM 逻辑。两个视图块树一致但布局不同
// （columns 视图把分栏组 regroup 成栏），锚点是「内容块序列」的索引——这里
// 锁定两视图序列对齐这一核心不变量，以及锚点的读写与越界夹取。

const el = (html: string): HTMLElement => {
  const wrapper = document.createElement('div')
  wrapper.innerHTML = html
  return wrapper.firstElementChild as HTMLElement
}

/** page 视图的块级分栏载体（htmlPreview 渲染的 display:none 数据载体）。 */
const markerFigure = (kind: string): string =>
  `<figure class="mu-html-block"><div class="mu-html-preview">`
  + `<div class="mu-mdcols-marker" data-kind="${kind}" style="display:none"></div>`
  + `</div></figure>`

const para = (text: string): string => `<p>${text}</p>`

/** columns 视图的隐藏边界块（editorLayout 加 mu-mdcols-hidden）。 */
const hiddenMarker = (kind: string): string =>
  `<figure class="mu-html-block mu-mdcols-hidden">`
  + `<div class="mu-html-preview"><div class="mu-mdcols-marker" data-kind="${kind}"></div></div>`
  + `</figure>`

const group = (...cols: string[]): string =>
  `<div class="mu-mdcols-group">${cols.map(c => `<div class="mu-mdcols-col">${c}</div>`).join('')}</div>`

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

  it('flattens column groups and drops hidden boundary blocks (columns view)', () => {
    container.innerHTML
      = para('p0') + hiddenMarker('begin')
        + group(para('p1'), para('p2')) + hiddenMarker('end') + para('p3')

    expect(contentBlocks(container).map(b => b.textContent)).toEqual(['p0', 'p1', 'p2', 'p3'])
  })

  it('keeps paragraphs that carry an inline badge in the sequence', () => {
    // 行内徽标是段落内的 span，不是 .mu-html-preview 里的载体，不得误判为标记块。
    container.innerHTML
      = `<p>p0<span class="mu-mdcols-marker mu-mdcols-inline" data-kind="begin"></span></p>` + para('p1')

    expect(contentBlocks(container).map(b => b.textContent)).toEqual(['p0', 'p1'])
  })

  it('yields the SAME sequence for the two layouts of one document', () => {
    const page = el(para('p0') + markerFigure('begin') + para('p1') + markerFigure('split') + para('p2') + markerFigure('end') + para('p3'))
    const columns = el(para('p0') + hiddenMarker('begin') + group(para('p1'), para('p2')) + hiddenMarker('end') + para('p3'))

    expect(contentBlocks(page).map(b => b.textContent))
      .toEqual(contentBlocks(columns).map(b => b.textContent))
  })
})

describe('viewAnchorOf / scrollViewToAnchor', () => {
  beforeEach(() => {
    container.innerHTML = para('b0') + para('b1') + para('b2') + para('b3')
  })

  it('reads the first block whose bottom enters the viewport', () => {
    // b0 完全在视口上方，b1 贴着视口顶 → 锚点 1。
    mockRects(container, [-100, 0, 100, 200])

    expect(viewAnchorOf(container)).toBe(1)
  })

  it('falls back to the last block when everything is scrolled past', () => {
    mockRects(container, [-800, -700, -600, -500])

    expect(viewAnchorOf(container)).toBe(3)
  })

  it('returns null for an empty container', () => {
    container.innerHTML = ''

    expect(viewAnchorOf(container)).toBeNull()
    expect(viewAnchorOf(null)).toBeNull()
  })

  it('scrolls the target block to the viewport top', () => {
    mockRects(container, [0, 500, 1000, 1500])
    container.scrollTop = 0

    scrollViewToAnchor(container, 2)

    expect(container.scrollTop).toBe(1000)
  })

  it('clamps an out-of-range anchor to the first / last block', () => {
    mockRects(container, [0, 500, 1000, 1500])

    scrollViewToAnchor(container, 99)
    expect(container.scrollTop).toBe(1500)

    container.scrollTop = 0
    scrollViewToAnchor(container, -5)
    expect(container.scrollTop).toBe(0)
  })
})

describe('anchor store', () => {
  it('round-trips per tab id', () => {
    expect(readViewAnchor('tab-a')).toBeNull()

    writeViewAnchor('tab-a', 3)
    writeViewAnchor('tab-b', 7)

    expect(readViewAnchor('tab-a')).toBe(3)
    expect(readViewAnchor('tab-b')).toBe(7)
    expect(readViewAnchor('tab-c')).toBeNull()
  })

  it('coalesces scroll captures into one animation frame', async() => {
    container.innerHTML = para('b0') + para('b1')
    mockRects(container, [0, 100])

    syncScrollAnchor(container, 'tab-r')
    syncScrollAnchor(container, 'tab-r')
    // rAF 未跑完前不落盘——一次滚动只算一次。
    expect(readViewAnchor('tab-r')).toBeNull()

    await new Promise(requestAnimationFrame)

    expect(readViewAnchor('tab-r')).toBe(0)
  })
})
