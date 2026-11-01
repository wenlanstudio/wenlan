import { onScopeDispose, watch, type WatchSource } from 'vue'

/**
 * 纸面叶（paper）分页测量 —— 视图模型 §5 / M2。
 *
 * 模型 = 连续流 + 缝叠加：muya 保持单一连续 block 流，本模块只做测量与投影
 * ——输入 .mu-container 的块序列，输出缝（页界）与页码徽章的位置，叠加渲染
 * 在 overlay 层（util 层不持有 Vue 组件，usePaperPagination 是接线胶水）。
 *
 * 策略与打印链同源（硬验收：屏显页数 = printToPDF 页数；打印侧同款规则见
 * util/pdf.ts getCssForOptions 的 `.markdown-body>*{break-inside:avoid}`）：
 * - keep-together：块装不下当前页剩余空间 → 整块推下页，缝落块间（塌陷
 *   间隙的中点，纯视觉位置）；
 * - 标题 break-after:avoid 镜像：标题放得下但下一块放不下（且下一块单独
 *   成页放得下）→ 标题一并推下页；best-effort——若标题推下页后下一块仍
 *   放不下，再在标题后落缝（Chromium 同款降级）；
 * - 超整页块（块高 > 页内容高）：穿缝——缝按窗口边界从块内穿过（虚线让
 *   过），不缩字号。
 *
 * 页 origin 语义（打印等效）：Chromium 在 fragmentainer 起始处截断块顶
 * margin，故每页首块的缝上间隙不计容量——屏测里推下页后块顶的屏上间隙
 * （塌陷 margin）不参与 fit 判定。所有 y 坐标以「容器内容盒顶」为 0。
 */

/** A4 内容高：297 − 20(上边距) − 20(下边距) = 257mm（打印链默认，§5）。 */
export const PAGE_CONTENT_HEIGHT_MM = 257

/** CSS 物理单位换算：1mm = 96/25.4 px。 */
export const MM_TO_PX = 96 / 25.4

/** 纸面几何（纸型；边距固定 20/15mm，§5：纸型/边距归 frontmatter）。 */
export interface PaperGeometry {
  pageWidthMm: number
  pageHeightMm: number
}

export const PAPER_SIZES_MM: Record<'a4' | 'letter', PaperGeometry> = {
  a4: { pageWidthMm: 210, pageHeightMm: 297 },
  letter: { pageWidthMm: 215.9, pageHeightMm: 279.4 }
}

/**
 * frontmatter `paper: A4 | letter` → 声明的纸型名；未声明或未知纸型 = null
 * （调用方各回退默认：屏侧 A4，导出对话框保留用户上次选择）。
 */
export const parseDeclaredPaperSize = (markdown: string): 'a4' | 'letter' | null => {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown ?? '')
  const paper = fm ? /^paper:\s*['"]?([A-Za-z0-9_-]+)['"]?\s*$/m.exec(fm[1]) : null
  const key = paper?.[1]?.toLowerCase()
  return key === 'letter' ? 'letter' : key === 'a4' ? 'a4' : null
}

/**
 * frontmatter `paper: A4 | letter` → 纸面几何。无声明或缺纸型 = A4（打印链
 * 默认，导出对话框同默认，屏打天然一致）；未知纸型也落 A4。
 */
export const parsePaperGeometry = (markdown: string): PaperGeometry => {
  const declared = parseDeclaredPaperSize(markdown)
  return declared === 'letter' ? PAPER_SIZES_MM.letter : PAPER_SIZES_MM.a4
}

export interface PaperBlockBox {
  /** 块的 tagName（小写）。 */
  tag: string
  /** 相对容器内容盒顶的 y（视觉 px，含 zoom）。 */
  top: number
  bottom: number
  /** `<!-- pagebreak -->` 标记块（屏测读 muya 的分页符徽标）。 */
  isPagebreak?: boolean
}

export interface PaperSeam {
  /** 相对内容盒顶的 y。 */
  y: number
  /** true = 穿缝：缝从超整页块内部穿过（虚线让过）。 */
  crossed: boolean
}

export interface PaperLayout {
  seams: PaperSeam[]
  pageCount: number
  /** 末页页码徽章的 y（末块底 + 余量）。 */
  lastBadgeY: number
}

const HEADING_RE = /^h[1-6]$/

/**
 * keep-together 贪心分页（纯函数，块序按文档序）。
 * `blocks` 的 top/bottom 以内容盒顶为 0；返回的 y 同坐标系。
 */
export const paginateBlocks = (
  blocks: PaperBlockBox[],
  pageContentHeight: number
): PaperLayout => {
  const seams: PaperSeam[] = []
  // 页内已用容量（打印等效：页首块的缝上间隙截断）。
  let local = 0
  let prevBottom: number | null = null
  let firstOnPage = true
  // `<!-- pagebreak -->` 标记后待发的强制缝；本页是否已有正文块（强制缝
  // 镜像 Chromium 语义：fragmentainer 为空时 forced break 无操作——连续
  // 分页符/文档起始的分页符不产空白页）。
  let pendingForcedBreak = false
  let contentOnPage = false

  const pushSeam = (y: number, crossed: boolean): void => {
    seams.push({ y, crossed })
  }

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    const height = b.bottom - b.top
    // 屏上块顶的塌陷间隙（页首块在打印侧被截断，不计）。
    const gap = prevBottom === null ? 0 : b.top - prevBottom
    const oversized = height > pageContentHeight
    // 块顶的页内位置（首块 = 0，间隙截断）。
    let startLocal = firstOnPage ? 0 : local + gap

    // 强制缝：上一块是分页符标记且本页有正文 → 缝必然落在本块之前。
    if (pendingForcedBreak) {
      pendingForcedBreak = false
      if (contentOnPage) {
        if (prevBottom !== null) pushSeam((prevBottom + b.top) / 2, false)
        firstOnPage = true
        startLocal = 0
        contentOnPage = false
      }
    }

    // 剩余空间连块顶都容不下（间隙跨过页界）→ 先按推下页处理。local 无需
    // 清零——其后每个分支都会在读取前重新赋值。
    if (!firstOnPage && startLocal >= pageContentHeight) {
      if (prevBottom !== null) pushSeam((prevBottom + b.top) / 2, false)
      firstOnPage = true
      startLocal = 0
    }

    // —— 标题 break-after:avoid 前瞻（仅当标题自身放得下）——
    if (
      !firstOnPage &&
      !oversized &&
      startLocal + height <= pageContentHeight &&
      HEADING_RE.test(b.tag) &&
      i + 1 < blocks.length
    ) {
      const next = blocks[i + 1]
      const nextHeight = next.bottom - next.top
      const nextEnd = startLocal + height + (next.top - b.bottom) + nextHeight
      if (nextEnd > pageContentHeight && nextHeight <= pageContentHeight) {
        if (prevBottom !== null) pushSeam((prevBottom + b.top) / 2, false)
        local = height
        firstOnPage = false
        prevBottom = b.bottom
        contentOnPage = true
        continue
      }
    }

    if (oversized) {
      // 穿缝：块占据页内 [startLocal, startLocal + height)，窗口边界 kH 落在
      // 区间内即穿缝，缝的文档 y = 块顶 + (kH − startLocal)。
      for (
        let boundary = pageContentHeight;
        boundary < startLocal + height;
        boundary += pageContentHeight
      ) {
        pushSeam(b.top + (boundary - startLocal), true)
      }
      const endLocal = startLocal + height
      local = endLocal % pageContentHeight
      firstOnPage = local === 0
    } else if (startLocal + height > pageContentHeight) {
      // keep-together：整块推下页，缝落块间。
      if (prevBottom !== null) pushSeam((prevBottom + b.top) / 2, false)
      local = height
      firstOnPage = false
    } else {
      local = startLocal + height
      firstOnPage = false
    }

    prevBottom = b.bottom
    if (b.isPagebreak) {
      pendingForcedBreak = true
    } else {
      contentOnPage = true
    }
  }

  const lastBottom = blocks.at(-1)?.bottom ?? 0

  return {
    seams,
    pageCount: seams.length + 1,
    lastBadgeY: lastBottom + 28
  }
}

// —— DOM 步进与叠加接线 ——

/** 屏测排除的非正文块：front matter 屏显为 pre.mu-frontmatter，打印侧默认
 *  display:none（pdf.ts），两端一致不参与分页。 */
const EXCLUDED_SELECTOR = 'pre.mu-frontmatter'

interface PaperBlocksMeasurement {
  blocks: PaperBlockBox[]
  /** 内容盒顶相对容器 border-box 顶的视觉偏移（padding-top × zoom）。 */
  contentTopOffset: number
  /** 页内容高（视觉 px）。 */
  pageContentHeight: number
}

/** 步进 .mu-container 的顶层块，产出以内容盒顶为 0 的块盒序列。 */
export const measurePaperBlocks = (
  container: HTMLElement,
  geometry: PaperGeometry = PAPER_SIZES_MM.a4
): PaperBlocksMeasurement => {
  const rect = container.getBoundingClientRect()
  const cs = getComputedStyle(container)
  // CSS zoom 挂在 .mu-container 上（editor.vue）：计算值是未缩放 px，视觉
  // 距离 = ×zoom；rect 已是视觉坐标，统一到视觉空间。
  const zoom = Number.parseFloat(cs.zoom || '1') || 1
  const contentTopOffset = Number.parseFloat(cs.paddingTop || '0') * zoom
  // 边距固定 20mm 上下（§5），内容高 = 纸高 − 40mm。
  const pageContentHeight = (geometry.pageHeightMm - 40) * MM_TO_PX * zoom

  const blocks: PaperBlockBox[] = []
  for (const child of Array.from(container.children)) {
    if (!(child instanceof HTMLElement)) continue
    if (child.matches(EXCLUDED_SELECTOR)) continue
    const r = child.getBoundingClientRect()
    if (r.height === 0 && child.tagName !== 'HR') continue
    blocks.push({
      tag: child.tagName.toLowerCase(),
      top: r.top - rect.top - contentTopOffset,
      bottom: r.bottom - rect.top - contentTopOffset,
      isPagebreak: child.querySelector('.mu-mdcols-pagebreak') !== null
    })
  }

  return { blocks, contentTopOffset, pageContentHeight }
}

/**
 * 纸面分页叠加的生命周期胶水：lens 为 paper 时在 muya 根（滚动区）内挂
 * overlay，编辑/缩放后重测，缝与页码以绝对定位投影。编辑器与只读投影
 * （leafProjection）共用。
 */
export const usePaperPagination = (options: {
  /** 是否处于纸面叶（响应式 getter）。 */
  isActive: () => boolean
  /** muya 根元素（滚动区，overlay 挂其内随之滚动）。 */
  getRoot: () => HTMLElement | null
  /** 文档纸面几何（frontmatter `paper:`；缺省 A4）。 */
  getGeometry?: () => PaperGeometry
  /** 额外重测触发源（如 zoom preference）。 */
  watchSources?: WatchSource[]
}): void => {
  const { isActive, getRoot, getGeometry, watchSources = [] } = options

  let overlay: HTMLDivElement | null = null
  let scheduleTimer = 0
  let rafId = 0
  let mutationObserver: MutationObserver | null = null
  let resizeObserver: ResizeObserver | null = null

  const detach = (): void => {
    window.clearTimeout(scheduleTimer)
    if (rafId) cancelAnimationFrame(rafId)
    mutationObserver?.disconnect()
    mutationObserver = null
    resizeObserver?.disconnect()
    resizeObserver = null
    overlay?.remove()
    overlay = null
  }

  const render = (layout: PaperLayout, measure: PaperBlocksMeasurement, container: HTMLElement): void => {
    if (!overlay) return
    const host = overlay
    host.dataset.pageCount = String(layout.pageCount)
    host.replaceChildren()

    // —— 页码徽章：每页的号码落在其页尾（缝上方右侧；末页在内容末尾下
    //    方，即连续流视图里该页的"底边"位置）。——
    const badgeTop = (y: number): HTMLDivElement => {
      const el = document.createElement('div')
      el.className = 'mu-paper-page-num'
      el.style.top = `${measure.contentTopOffset + y}px`
      return el
    }

    layout.seams.forEach((seam, index) => {
      const top = measure.contentTopOffset + seam.y
      const line = document.createElement('div')
      line.className = seam.crossed ? 'mu-paper-seam crossed' : 'mu-paper-seam'
      line.style.top = `${top}px`
      line.dataset.crossed = seam.crossed ? 'true' : 'false'
      host.appendChild(line)

      const badge = badgeTop(top - 18)
      badge.textContent = String(index + 1)
      host.appendChild(badge)
    })

    const last = badgeTop(layout.lastBadgeY)
    last.textContent = String(layout.pageCount)
    host.appendChild(last)

    // e2e 钩子：最后一个缝之后的块底（供外部核对测量）。
    host.dataset.lastBlockBottom = String(
      measure.contentTopOffset +
        (container.lastElementChild instanceof HTMLElement
          ? container.lastElementChild.getBoundingClientRect().bottom -
            container.getBoundingClientRect().top
          : 0)
    )
  }

  const measure = (): void => {
    if (!overlay || !isActive()) return
    const root = getRoot()
    const container = root?.querySelector<HTMLElement>(':scope > .mu-container')
    if (!root || !container) return

    const rootRect = root.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    // overlay 锚在容器的 border-box 上（视觉 px；root 未被 zoom，直接可用）。
    overlay.style.top = `${containerRect.top - rootRect.top + root.scrollTop}px`
    overlay.style.left = `${containerRect.left - rootRect.left + root.scrollLeft}px`
    overlay.style.width = `${containerRect.width}px`
    overlay.style.height = `${containerRect.height}px`

    // frontmatter 纸型 → 容器上的内联 CSS 变量（压过 paperLens.css 的 :root
    // 默认值；纸卡宽高与测量同源，编辑所见 = 打印所得）。frontmatter 变化
    // 会触发 MutationObserver 重测，几何随之更新。
    const geometry = getGeometry?.() ?? PAPER_SIZES_MM.a4
    container.style.setProperty('--paper-page-width', `${geometry.pageWidthMm}mm`)
    container.style.setProperty('--paper-page-height', `${geometry.pageHeightMm}mm`)

    const m = measurePaperBlocks(container, geometry)
    render(paginateBlocks(m.blocks, m.pageContentHeight), m, container)
  }

  const schedule = (): void => {
    if (!overlay) return
    window.clearTimeout(scheduleTimer)
    rafId = requestAnimationFrame(() => {
      // 连续输入下的合帧：rAF 之外再给一个短窗，避免高频 mutation 风暴。
      scheduleTimer = window.setTimeout(measure, 80)
    })
  }

  const attach = (): void => {
    const root = getRoot()
    if (!root || overlay) return
    overlay = document.createElement('div')
    overlay.className = 'mu-paper-overlay'
    root.appendChild(overlay)

    mutationObserver = new MutationObserver(schedule)
    // 观察容器（块增删/文本变化都会体现在它的子树里）。
    const container = root.querySelector<HTMLElement>(':scope > .mu-container')
    if (container) mutationObserver.observe(container, { childList: true, subtree: true, characterData: true })
    resizeObserver = new ResizeObserver(schedule)
    resizeObserver.observe(container ?? root)

    void document.fonts?.ready.then(schedule)
    schedule()
  }

  watch(
    isActive,
    (active) => {
      if (active) attach()
      else detach()
    },
    { immediate: true }
  )

  if (watchSources.length) {
    watch(watchSources, schedule)
  }

  onScopeDispose(detach)
}
