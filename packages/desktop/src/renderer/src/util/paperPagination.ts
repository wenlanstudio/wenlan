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

/** 纸姿态卡网格的页间灰隙（mm；§5 推挤流，卡与卡之间的视觉间隙）。 */
export const PAPER_PAGE_GAP_MM = 8

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
  /** 对应 DOM 块（measurePaperBlocks 填充；纯函数单测无需构造）。 */
  el?: HTMLElement
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
  /** 每页首块的块序（纸姿态推挤的对齐目标块；穿缝页从块中间开始、无块界
   *  可推 = -1）。与缝一一对应：length = pageCount = seams.length + 1。 */
  pageStarts: number[]
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
  // 页首块簿记：pageStarts[k] = 第 k 页首块的块序（纸姿态推挤的对齐目标）。
  // 每道缝开一个新页：keep-together/强制/标题回避/间隙跨界的缝开在当前块，
  // 穿缝（超整页块内部）的缝无块界可推 = -1。
  const pageStarts: number[] = [0]
  // 页内已用容量（打印等效：页首块的缝上间隙截断）。
  let local = 0
  let prevBottom: number | null = null
  let firstOnPage = true
  // `<!-- pagebreak -->` 标记后待发的强制缝；本页是否已有正文块（强制缝
  // 镜像 Chromium 语义：fragmentainer 为空时 forced break 无操作——连续
  // 分页符/文档起始的分页符不产空白页）。
  let pendingForcedBreak = false
  let contentOnPage = false

  const pushSeam = (y: number, crossed: boolean, firstBlock: number): void => {
    seams.push({ y, crossed })
    pageStarts.push(firstBlock)
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
        if (prevBottom !== null) pushSeam((prevBottom + b.top) / 2, false, i)
        firstOnPage = true
        startLocal = 0
        contentOnPage = false
      }
    }

    // 剩余空间连块顶都容不下（间隙跨过页界）→ 先按推下页处理。local 无需
    // 清零——其后每个分支都会在读取前重新赋值。
    if (!firstOnPage && startLocal >= pageContentHeight) {
      if (prevBottom !== null) pushSeam((prevBottom + b.top) / 2, false, i)
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
        if (prevBottom !== null) pushSeam((prevBottom + b.top) / 2, false, i)
        local = height
        firstOnPage = false
        prevBottom = b.bottom
        contentOnPage = true
        continue
      }
    }

    if (oversized) {
      // 穿缝：块占据页内 [startLocal, startLocal + height)，窗口边界 kH 落在
      // 区间内即穿缝，缝的文档 y = 块顶 + (kH − startLocal)。穿缝开出的页
      // 从块中间开始，无块界可推（-1）。
      for (
        let boundary = pageContentHeight;
        boundary < startLocal + height;
        boundary += pageContentHeight
      ) {
        pushSeam(b.top + (boundary - startLocal), true, -1)
      }
      const endLocal = startLocal + height
      local = endLocal % pageContentHeight
      firstOnPage = local === 0
    } else if (startLocal + height > pageContentHeight) {
      // keep-together：整块推下页，缝落块间。
      if (prevBottom !== null) pushSeam((prevBottom + b.top) / 2, false, i)
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
    pageStarts,
    pageCount: seams.length + 1,
    lastBadgeY: lastBottom + 28
  }
}

/**
 * 卡网格推挤级联（纯函数，纸姿态专用；视图模型 §5 推挤流 / M3.5 切片 B）。
 *
 * 目标：第 k 页首块落在卡 k 的内容顶——内容坐标恰好 = k·pageStep（卡 k 顶缘
 * 在容器 border-box 顶下方 k·pageStep 处，而容器 padding-top = 卡顶边距，
 * 两者相抵）。Δ_k = k·pageStep − (t_k + Σ_{j<k} Δ_j)，单遍自上而下级联：
 *   - 页 0 允许负——把首块拉到内容原点，镜像打印侧 fragmentainer 起始的
 *     块顶 margin 截断；
 *   - k ≥ 1 取 max(0)——穿缝之后内容落后于网格，不拉回（防与上卡重叠）；
 *     网格每页推进 pageStep（含页间隙）而内容每页 ≤ 页内容高，欠账逐页
 *     收敛，后续页起点自动追上网格（Chromium 穿缝语义的镜像收口）。
 *
 * `pageStep` 与 `blockTops` 同一坐标系（内容盒顶为 0 的视觉 px，含 zoom）。
 */
export const computePagePushes = (
  pageStarts: number[],
  blockTops: number[],
  pageStep: number
): number[] => {
  const pushes: number[] = []
  let cum = 0
  for (let k = 0; k < pageStarts.length; k++) {
    const s = pageStarts[k]
    if (s < 0 || s >= blockTops.length) {
      pushes.push(0) // 穿缝页：无块界可推
      continue
    }
    const delta = k * pageStep - (blockTops[s]! + cum)
    pushes.push(k === 0 ? delta : Math.max(0, delta))
    cum += pushes[k]!
  }
  return pushes
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
      isPagebreak: child.querySelector('.mu-mdcols-pagebreak') !== null,
      el: child
    })
  }

  return { blocks, contentTopOffset, pageContentHeight }
}

/**
 * 页/纸分页叠加的生命周期胶水：lens 为 page/paper 时在 muya 根（滚动区）内
 * 挂 overlay，编辑/缩放后重测，缝与页码以绝对定位投影。编辑器与只读投影
 * （leafProjection）共用。
 *
 * 双姿态（视图模型 §5，M3.5 切片 B）：
 * - 页（shouldPush 缺省/false）= 连续流 + 缝叠加——现状渲染，不推挤；
 * - 纸（shouldPush true）= 推挤流 + 卡层——每轮测量先**还原全部推挤**再量
 *   自然几何（防脏 margin 参与拟合），套卡网格级联把各页首块推到卡内容顶，
 *   然后重量测渲染：卡层画每页白卡（z:-1，沉在正文之下），前景层只画穿缝
 *   虚线（卡缝由卡缘本身表达）与逐卡页码。
 */
export const usePaperPagination = (options: {
  /** 是否处于页/纸叶（响应式 getter）。 */
  isActive: () => boolean
  /** muya 根元素（滚动区，overlay 挂其内随之滚动）。 */
  getRoot: () => HTMLElement | null
  /** 文档纸面几何（frontmatter `paper:`；缺省 A4）。 */
  getGeometry?: () => PaperGeometry
  /** 纸姿态推挤（响应式 getter；缺省 = 页姿态纯缝叠加）。 */
  shouldPush?: () => boolean
  /** 额外重测触发源（如 zoom preference）。 */
  watchSources?: WatchSource[]
}): void => {
  const { isActive, getRoot, getGeometry, shouldPush, watchSources = [] } = options

  let overlay: HTMLDivElement | null = null
  let cardsLayer: HTMLDivElement | null = null
  let scheduleTimer = 0
  let rafId = 0
  let mutationObserver: MutationObserver | null = null
  let resizeObserver: ResizeObserver | null = null
  /** 已施加推挤的块（margin-top 内联），还原即摘。 */
  const pushedEls: HTMLElement[] = []

  /** 摘掉全部推挤 margin，回到自然几何（生命周期第一步，detach 时同样执行）。 */
  const restorePushes = (): void => {
    for (const el of pushedEls) el.style.removeProperty('margin-top')
    pushedEls.length = 0
  }

  /** overlay/卡层锚在容器的 border-box 上（视觉 px；root 未被 zoom，直接可用）。 */
  const anchorLayer = (layer: HTMLDivElement, root: HTMLElement, container: HTMLElement): void => {
    const rootRect = root.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    layer.style.top = `${containerRect.top - rootRect.top + root.scrollTop}px`
    layer.style.left = `${containerRect.left - rootRect.left + root.scrollLeft}px`
    layer.style.width = `${containerRect.width}px`
    layer.style.height = `${containerRect.height}px`
  }

  const detach = (): void => {
    window.clearTimeout(scheduleTimer)
    if (rafId) cancelAnimationFrame(rafId)
    mutationObserver?.disconnect()
    mutationObserver = null
    resizeObserver?.disconnect()
    resizeObserver = null
    restorePushes()
    overlay?.remove()
    overlay = null
    cardsLayer?.remove()
    cardsLayer = null
    // 容器纸底交还：推挤类卸下（页/流姿态恢复容器自带白底）。
    getRoot()
      ?.querySelector<HTMLElement>(':scope > .mu-container')
      ?.classList.remove('mu-paper-pushed')
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

  /** 纸姿态渲染：卡层画每页白卡（格距 = 页高 + 隙），前景层只画穿缝虚线
   *  （卡缝由卡缘本身表达，不再画流内中点缝）与逐卡页码。 */
  const renderPaper = (
    layout: PaperLayout,
    m: PaperBlocksMeasurement,
    geometry: PaperGeometry,
    pageStep: number,
    container: HTMLElement
  ): void => {
    if (!overlay || !cardsLayer) return
    const zoom = Number.parseFloat(getComputedStyle(container).zoom || '1') || 1
    const cardHeight = geometry.pageHeightMm * MM_TO_PX * zoom

    // —— 卡层：每页一张白卡；卡 k 顶缘 = k·pageStep（容器 border-box 顶起）。 ——
    cardsLayer.replaceChildren()
    for (let k = 0; k < layout.pageCount; k++) {
      const card = document.createElement('div')
      card.className = 'mu-paper-card'
      card.style.top = `${k * pageStep}px`
      card.style.height = `${cardHeight}px`
      card.dataset.page = String(k + 1)
      cardsLayer.appendChild(card)
    }

    // —— 前景层：穿缝虚线 + 逐卡页码（卡顶边距带内，正文起于卡顶 + 上边距）。 ——
    overlay.replaceChildren()
    overlay.dataset.pageCount = String(layout.pageCount)
    for (const seam of layout.seams) {
      if (!seam.crossed) continue
      const line = document.createElement('div')
      line.className = 'mu-paper-seam crossed'
      line.style.top = `${m.contentTopOffset + seam.y}px`
      line.dataset.crossed = 'true'
      overlay.appendChild(line)
    }
    for (let k = 0; k < layout.pageCount; k++) {
      const badge = document.createElement('div')
      badge.className = 'mu-paper-page-num'
      badge.style.top = `${k * pageStep + 4}px`
      badge.textContent = String(k + 1)
      overlay.appendChild(badge)
    }

    // e2e 钩子：末块底（供外部核对测量；坐标 = 容器 border-box 顶起）。
    overlay.dataset.lastBlockBottom = String(
      m.contentTopOffset + (m.blocks.at(-1)?.bottom ?? 0)
    )
  }

  const measure = (): void => {
    if (!overlay || !isActive()) return
    const root = getRoot()
    const container = root?.querySelector<HTMLElement>(':scope > .mu-container')
    if (!root || !container) return

    // 推挤生命周期第一步：还原全部推挤，让测量只见自然几何（防上一轮脏
    // margin 参与拟合——块高不变故缝判定不动，但位置必须从自然态重算）。
    restorePushes()

    anchorLayer(overlay, root, container)
    if (cardsLayer) anchorLayer(cardsLayer, root, container)

    // frontmatter 纸型 → 容器上的内联 CSS 变量（压过 paperLens.css 的 :root
    // 默认值；纸卡宽高与测量同源，编辑所见 = 打印所得）。frontmatter 变化
    // 会触发 MutationObserver 重测，几何随之更新。
    const geometry = getGeometry?.() ?? PAPER_SIZES_MM.a4
    container.style.setProperty('--paper-page-width', `${geometry.pageWidthMm}mm`)
    container.style.setProperty('--paper-page-height', `${geometry.pageHeightMm}mm`)

    const pushing = shouldPush?.() ?? false
    // 纸姿态把容器白底/阴影移交卡层（mu-paper-pushed 容器透明，白卡由卡层画）。
    container.classList.toggle('mu-paper-pushed', pushing)

    const m1 = measurePaperBlocks(container, geometry)
    const layout1 = paginateBlocks(m1.blocks, m1.pageContentHeight)

    if (!pushing) {
      // 页姿态：连续流 + 缝叠加（不推挤，现状渲染）。
      render(layout1, m1, container)
      return
    }

    // —— 纸姿态：卡网格推挤级联 ——
    // CSS zoom 挂在容器上：计算值未缩放、视觉距离 = ×zoom。pageStep 与块
    // top 同在视觉空间；margin-top 是未缩放 CSS px，施加时除回 zoom。
    const zoom = Number.parseFloat(getComputedStyle(container).zoom || '1') || 1
    const pageStep = (geometry.pageHeightMm + PAPER_PAGE_GAP_MM) * MM_TO_PX * zoom
    const pushes = computePagePushes(
      layout1.pageStarts,
      m1.blocks.map((b) => b.top),
      pageStep
    )
    layout1.pageStarts.forEach((s, k) => {
      const delta = pushes[k]
      if (s < 0 || !delta || Math.abs(delta) < 0.5) return
      const box = m1.blocks[s]
      const el = box?.el
      if (!el || !box) return
      // 页 0：上方是容器 padding（无塌陷伙伴），Δ 可负——拉齐首块到内容
      // 原点，镜像打印侧 fragmentainer 起始的块顶截断。
      // k ≥ 1：新 margin = 原塌陷间隙 + Δ（绝对量）——塌陷可能由上块
      // margin-bottom 主导，「自然值 + Δ」压不过塌陷会欠推；取间隙 + Δ
      // 保证塌陷后视觉间隙恰好多 Δ（推挤恒 ≥ 原间隙，max 收口自动成立）。
      const gap = k === 0 ? 0 : box.top - (m1.blocks[s - 1]?.bottom ?? box.top)
      el.style.marginTop = `${((gap + delta) / zoom).toFixed(2)}px`
      pushedEls.push(el)
    })

    // 推挤改变容器高度：重锚两层，重量测渲染（推挤后的几何）。
    anchorLayer(overlay, root, container)
    if (cardsLayer) anchorLayer(cardsLayer, root, container)
    const m2 = measurePaperBlocks(container, geometry)
    const layout2 = paginateBlocks(m2.blocks, m2.pageContentHeight)
    renderPaper(layout2, m2, geometry, pageStep, container)
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
    // 卡层（z:-1 沉底）与前景层（z:10 缝/页码）同为根的直接子元素。
    cardsLayer = document.createElement('div')
    cardsLayer.className = 'mu-paper-cards'
    root.appendChild(cardsLayer)
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
