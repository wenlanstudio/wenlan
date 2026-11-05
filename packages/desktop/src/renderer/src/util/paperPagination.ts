import { onScopeDispose, watch, type WatchSource } from 'vue'
import { cutLinesFitting, countFittingPrefix, type LineCut } from '@/vendor/md2slides/layout-core'

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

/**
 * frontmatter `paperTheme: <名>` → 声明的纸面主题名（如 `thesis`）；未声明
 * = null。纸面主题只动排版层（字体/字号/标题/表格），不动纸面几何——
 * 屏显与打印两侧吃同一份主题 CSS（assets/themes/export/thesis.theme.css）
 *，「屏显页数 = printToPDF 页数」的等价性不因主题而破。
 */
export const parsePaperTheme = (markdown: string): string | null => {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown ?? '')
  const theme = fm ? /^paperTheme:\s*['"]?([A-Za-z0-9_-]+)['"]?\s*$/m.exec(fm[1]) : null
  return theme?.[1]?.toLowerCase() ?? null
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
export const paginateBlocks = (blocks: PaperBlockBox[], pageContentHeight: number): PaperLayout => {
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

// —— v2：行级拟合引擎（M4.3a 纯层，view-model §5 切页策略分级 / 裁决 A）——
// 运行时已翻转（M4.3b 同拍切换）：页叶缝升行级 + 打印链去块级 avoid，屏打
// 两套切分语义不许分先后。#7 扩展：代码块（行级）/列表/引用（子单元级）
// 纳入同一引擎——打印侧本就原生切分这几类块，屏测此前 keep-together 反而
// 破等价（大片空白的来源）。

/** v2 块子结构：块内可切分信息（measureV2 填充；纯层单测给合成值）。 */
export interface PaperBlockBoxV2 extends PaperBlockBox {
  /** 段落/代码块行盒高序列（P；行盒间无 margin）。给了就走内核 cutLinesFitting。 */
  lines?: number[]
  /** 表格：表头高（续表每页重复占一份）+ 各行高。 */
  table?: { headH: number; rowHeights: number[] }
  /**
   * 子单元高序列（列表 = li / 引用 = 直接子块）：仅单元界可切（镜像
   * Chromium 块级碎片化里「兄弟边界任意可断」）；超页子单元降级并入其
   * 内部文本行顶（边界②：镜像 Chromium 进子元素按行盒断开）。边界法
   * 构造：首单元含块顶 padding、末单元含块底 padding，sum = 块高，缝 y
   * = 块顶 + 前缀和，恰落切点顶。
   */
  kids?: number[]
  /**
   * 与 kids 平行的单元归属（子元素序；纯层单测合成数据可缺省 = 平铺
   * 逐单元对应）。真分片执行器据此把单元区间还原成 DOM：整属的子元素
   * 整个搬移，跨段（超页子单元）的做裁剪手术。
   */
  kidOwners?: number[]
}

export interface PaperSeamV2 {
  y: number
  crossed: boolean
  /** 缝落在块内部时的切点（纸叶真分片的渲染依据；页叶只用 y）。 */
  split?: { block: number; kind: 'lines' | 'table-rows' | 'kids'; keep: number }
}

export interface PaperLayoutV2 {
  seams: PaperSeamV2[]
  pageCount: number
  lastBadgeY: number
}

const sum = (xs: number[]): number => xs.reduce((a, c) => a + c, 0)

/**
 * 行级贪心分页（v2 纯函数；块序按文档序，top/bottom 以内容盒顶为 0）。
 *
 * 骨架 = v1（keep-together / 强制缝 / 标题回避 / 间隙跨界 / 穿缝），块内
 * 可切分者升级行级：
 *   - P（`lines` 给了）→ 内核 `cutLinesFitting`：fits / before（整段推下页）
 *     / at+keep（keep 行留本页，缝落行界 y = 块顶 + keep 行累计高；余行
 *     作为无缝续体开新页，local = 块高 − 已留高）；
 *   - 代码块（`pre.mu-code-block`，measureV2 以行起点 caret 矩形产出
 *     `lines`）→ 与段落同路：行界任意可切（Chromium 默认 orphans/widows=2
 *     对块级 line box 生效，含 pre），穿缝退役为超行单元兜底；
 *   - TABLE（`table` 给了）→ 内核 `countFittingPrefix`：表头每页重复占一份
 *     （续表），行切可跨多页（每道续缝 split.keep 记累计行数）；单行高过
 *     「页高 − 表头」的表不切，整块走 v1 穿缝；
 *   - KIDS（`kids` 给了：列表 li / 引用子块）→ 仅单元界可切（Chromium
 *     碎片化里兄弟边界任意可断、无 orphan/widow 约束）；超页子单元的
 *     内部已并入行级切点（测量端边界②），故「超页单元整块穿缝」只剩
 *     「单行 > 整页」的不可能分支；
 *   - 其余块（标题/图…无子结构）照 v1：keep-together、超页穿缝。
 */
export const paginateBlocksV2 = (
  blocks: PaperBlockBoxV2[],
  pageContentHeight: number
): PaperLayoutV2 => {
  const seams: PaperSeamV2[] = []
  let local = 0
  let prevBottom: number | null = null
  let firstOnPage = true
  let pendingForcedBreak = false
  let contentOnPage = false

  const pushSeam = (y: number, crossed: boolean, split?: PaperSeamV2['split']): void => {
    seams.push({ y, crossed, split })
  }

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    const height = b.bottom - b.top
    const gap = prevBottom === null ? 0 : b.top - prevBottom
    let startLocal = firstOnPage ? 0 : local + gap

    // 强制缝（v1 同款：fragmentainer 为空时 forced break 无操作）。
    if (pendingForcedBreak) {
      pendingForcedBreak = false
      if (contentOnPage) {
        if (prevBottom !== null) pushSeam((prevBottom + b.top) / 2, false)
        firstOnPage = true
        startLocal = 0
        contentOnPage = false
      }
    }

    // 剩余空间连块顶都容不下（间隙跨过页界）→ 先按推下页处理。
    if (!firstOnPage && startLocal >= pageContentHeight) {
      if (prevBottom !== null) pushSeam((prevBottom + b.top) / 2, false)
      firstOnPage = true
      startLocal = 0
    }

    const oversized = height > pageContentHeight

    // —— 标题 break-after:avoid 前瞻（v1 同款；标题无子结构，不参与切行）——
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

    const room = pageContentHeight - startLocal

    // —— 段落切行（内核 cutLinesFitting：widow/orphan ≥ 2 镜像 Chromium）——
    if (b.lines && b.lines.length > 0 && room > 0) {
      const cut: LineCut = cutLinesFitting(b.lines, room, pageContentHeight)
      if (cut.kind === 'fits') {
        local = startLocal + sum(b.lines)
        firstOnPage = false
      } else if (cut.kind === 'before') {
        // 整段推下页（缝落块间，v1 keep-together 同款）。
        if (prevBottom !== null) pushSeam((prevBottom + b.top) / 2, false)
        local = height
        firstOnPage = false
      } else {
        // at / split-anyway：keep 行留本页；余行作为无缝续体开新页（行间无
        // margin），尾段高过一整页时逐页续切（与表格分支同款循环）。
        let cursor = cut.keep
        pushSeam(b.top + sum(b.lines.slice(0, cursor)), false, {
          block: i,
          kind: 'lines',
          keep: cursor
        })
        while (cursor < b.lines.length) {
          const rest = b.lines.slice(cursor)
          if (sum(rest) <= pageContentHeight) break
          const cut2 = cutLinesFitting(rest, pageContentHeight, pageContentHeight)
          const k2 = cut2.kind === 'at' || cut2.kind === 'split-anyway' ? cut2.keep : rest.length
          cursor += k2
          if (cursor < b.lines.length) {
            pushSeam(b.top + sum(b.lines.slice(0, cursor)), false, {
              block: i,
              kind: 'lines',
              keep: cursor
            })
          }
        }
        local = sum(b.lines.slice(cursor))
        firstOnPage = false
      }
      prevBottom = b.bottom
      if (b.isPagebreak) pendingForcedBreak = true
      else contentOnPage = true
      continue
    }

    // —— 表格行切（内核 countFittingPrefix；续表表头每页占一份）——
    if (b.table && b.table.rowHeights.length > 0 && room > 0) {
      const { headH, rowHeights } = b.table
      const rowsSum = sum(rowHeights)
      const total = headH + rowsSum
      const oversizedTable = total > pageContentHeight
      // 单行高过「页高 − 表头」的表不切行（切了也只产废页），整块穿缝。
      const rowTolerant = Math.max(...rowHeights) <= pageContentHeight - headH

      if (!rowTolerant) {
        // v1 穿缝语义：窗口边界从块内穿过。
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
      } else {
        const availBody = room - headH
        let keep = availBody > 0 ? countFittingPrefix(rowHeights, availBody) : 0
        if (keep >= rowHeights.length) {
          // 全表放下本页（keep === 行数 ⟹ total ≤ room ≤ 页高，非超页表）。
          local = startLocal + total
          firstOnPage = false
        } else if (!oversizedTable && keep === 0) {
          // 本页连表头 + 一行都容不下（表又非超页）→ 整表推下页。
          if (prevBottom !== null) pushSeam((prevBottom + b.top) / 2, false)
          local = total
          firstOnPage = false
        } else {
          if (keep === 0) {
            // 超页表且本页 room 不足 → 先整表推下页，从新页起切。
            if (prevBottom !== null) pushSeam((prevBottom + b.top) / 2, false)
            keep = countFittingPrefix(rowHeights, pageContentHeight - headH)
          }
          // 首段（本页或新页顶）：表头 + keep 行。
          let cursor = keep
          if (cursor > 0) {
            pushSeam(b.top + headH + sum(rowHeights.slice(0, cursor)), false, {
              block: i,
              kind: 'table-rows',
              keep: cursor
            })
          }
          // 余行逐页续（每页 headH 占一份）；rowTolerant 保证每页至少一行。
          let lastPageFirstRow = 0
          while (cursor < rowHeights.length) {
            lastPageFirstRow = cursor
            const k2 = countFittingPrefix(rowHeights.slice(cursor), pageContentHeight - headH)
            cursor += k2
            if (cursor < rowHeights.length) {
              pushSeam(b.top + headH + sum(rowHeights.slice(0, cursor)), false, {
                block: i,
                kind: 'table-rows',
                keep: cursor
              })
            }
          }
          // 连续流账目：跟在表格后的块从末段页的余量起（续表 = 表头 + 末页行）。
          local = headH + sum(rowHeights.slice(lastPageFirstRow))
          firstOnPage = false
        }
      }
      prevBottom = b.bottom
      if (b.isPagebreak) pendingForcedBreak = true
      else contentOnPage = true
      continue
    }

    // —— 子单元切（列表 li / 引用子块：仅单元界可切，Chromium 兄弟边界镜像）——
    if (b.kids && b.kids.length > 1 && room > 0) {
      const heights = b.kids
      const total = height
      // 单元高过一整页 → 该单元不可表达（切了也只产废页），整块降级 v1 穿缝。
      const unitTolerant = Math.max(...heights) <= pageContentHeight

      if (!unitTolerant) {
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
      } else {
        let keep = countFittingPrefix(heights, room)
        if (keep >= heights.length) {
          // 全部单元放下本页。
          local = startLocal + total
          firstOnPage = false
        } else if (!oversized && keep === 0) {
          // 本页连首单元都容不下（块非超页）→ 整块推下页（v1 keep-together 同款）。
          if (prevBottom !== null) pushSeam((prevBottom + b.top) / 2, false)
          local = total
          firstOnPage = false
        } else {
          if (keep === 0) {
            // 超页块且本页 room 不足 → 先整块推下页，从新页起切。
            if (prevBottom !== null) pushSeam((prevBottom + b.top) / 2, false)
            keep = countFittingPrefix(heights, pageContentHeight)
          }
          let cursor = keep
          if (cursor > 0) {
            pushSeam(b.top + sum(heights.slice(0, cursor)), false, {
              block: i,
              kind: 'kids',
              keep: cursor
            })
          }
          // 余单元逐页续；unitTolerant 保证每页至少一单元。
          let lastPageFirstUnit = 0
          while (cursor < heights.length) {
            lastPageFirstUnit = cursor
            const k2 = countFittingPrefix(heights.slice(cursor), pageContentHeight)
            cursor += k2
            if (cursor < heights.length) {
              pushSeam(b.top + sum(heights.slice(0, cursor)), false, {
                block: i,
                kind: 'kids',
                keep: cursor
              })
            }
          }
          // 连续流账目：跟在块后的块从末段页的余量起（末段 = 末页单元和）。
          local = sum(heights.slice(lastPageFirstUnit))
          firstOnPage = false
        }
      }
      prevBottom = b.bottom
      if (b.isPagebreak) pendingForcedBreak = true
      else contentOnPage = true
      continue
    }

    // —— 无子结构块：v1 语义（keep-together / 超页穿缝）——
    if (oversized) {
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
      if (prevBottom !== null) pushSeam((prevBottom + b.top) / 2, false)
      local = height
      firstOnPage = false
    } else {
      local = startLocal + height
      firstOnPage = false
    }

    prevBottom = b.bottom
    if (b.isPagebreak) pendingForcedBreak = true
    else contentOnPage = true
  }

  const lastBottom = blocks.at(-1)?.bottom ?? 0

  return {
    seams,
    pageCount: seams.length + 1,
    lastBadgeY: lastBottom + 28
  }
}

// 卡网格推挤级联（computePagePushes）已随纸叶改真分片投影退役（A″ 裁决 /
// M4.3b）——实现见 git 历史（M3.5 切片 B）。纸叶页卡格隙见 paperLens.css
// `--paper-page-gap`（值承自 PAPER_PAGE_GAP_MM = 8mm）。

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

export interface PaperBlocksMeasurementV2 {
  blocks: PaperBlockBoxV2[]
  /** 内容盒顶相对容器 border-box 顶的视觉偏移（padding-top × zoom）。 */
  contentTopOffset: number
  /** 页内容高（视觉 px）。 */
  pageContentHeight: number
}

/**
 * 段落行盒高序列（文本节点 Range client rects 按 top 归并同行；行盒间无
 * margin）。行内元素会产生同行的多个矩形，按行带合并取最高；高度全为
 * 视觉 px（含 zoom）。
 *
 * 只走文本节点（TreeWalker）：对整个块 selectNodeContents 会混入内容容器
 * span 的**整体包围盒**（一行 1440px 的假行），吞掉全部真行带。
 */
const measureLineHeights = (el: HTMLElement): number[] => {
  const doc = el.ownerDocument
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const rects: DOMRect[] = []
  let node = walker.nextNode()
  while (node) {
    const text = node as Text
    if (text.nodeValue && text.nodeValue.trim()) {
      const r = doc.createRange()
      r.selectNodeContents(text)
      for (const rect of r.getClientRects()) {
        if (rect.height > 0) rects.push(rect)
      }
    }
    node = walker.nextNode()
  }
  if (!rects.length) return []
  const sorted = [...rects].sort((a, b) => a.top - b.top || a.left - b.left)
  const bands: number[] = []
  let bandTop = sorted[0]!.top
  let bandBottom = sorted[0]!.bottom
  for (const r of sorted) {
    if (r.top <= bandBottom - 1) {
      // 与当前行带重叠（同一行盒；容 1px 亚像素）→ 扩底取最高。
      bandBottom = Math.max(bandBottom, r.bottom)
      bands[bands.length - 1] = bandBottom - bandTop
    } else {
      bandTop = r.top
      bandBottom = r.bottom
      bands.push(bandBottom - bandTop)
    }
  }
  return bands
}

/**
 * 子单元高序列 + 归属（边界法）：cuts = 各可切点（视口坐标 + 归属子元素
 * 序），首单元从块顶起（含块顶 padding/边框）、末单元到块底（含块底
 * padding/边框），单元间 margin 塌陷间隙并入前一单元——sum = 块高，缝 y
 * = 块顶 + 前缀和恰落切点顶（= 打印碎片化的新页起点，页首 margin 截断语
 * 义天然一致）。owners 与 heights 平行：单元 i 的内容属于子元素
 * owners[i]（0 = 首子元素）——整块搬移执行器据此把单元区间还原成 DOM。
 *
 * 首单元自身的顶不是切点（切它 = 块前换页，Chromium 碎片化无此边界）：
 * 若首单元顶与块顶重合（无 padding）则被块顶过滤掉、剩余首点即真切点；
 * 否则剩余首点 = 首单元内容顶（伪切点），弃之。
 */
const unitSpansFromTops = (
  blockTop: number,
  blockBottom: number,
  cuts: Array<{ top: number; owner: number }>
): { heights: number[]; owners: number[] } => {
  const sorted = [...cuts].sort((a, b) => a.top - b.top)
  const firstRemoved = sorted.length > 0 && sorted[0]!.top <= blockTop + 0.5
  const deduped: Array<{ top: number; owner: number }> = []
  for (const c of sorted) {
    if (c.top <= blockTop + 0.5 || c.top >= blockBottom - 0.5) continue
    if (!deduped.length || c.top - deduped[deduped.length - 1]!.top > 0.5) deduped.push(c)
  }
  const cutPoints = firstRemoved ? deduped : deduped.slice(1)
  const points = [blockTop, ...cutPoints.map((c) => c.top), blockBottom]
  const heights: number[] = []
  const owners: number[] = []
  for (let i = 0; i + 1 < points.length; i++) {
    const h = points[i + 1]! - points[i]!
    if (h > 0) {
      heights.push(h)
      owners.push(i === 0 ? 0 : cutPoints[i - 1]!.owner)
    }
  }
  return { heights, owners }
}

/**
 * 代码块行带（#7）：`pre.mu-code-block` 内容 span 的文本节点 range 矩形定
 * 行界。
 *
 * 为什么不用行起点 caret 矩形：Chromium 对贴着 '\n' 的折叠位置常返回空矩
 * 形（换行后的位置「无处可坐」，muya #5114 同源）。实证（e2e 探针）：非折
 * 叠 range 矩形稳定——每个文本节点的 contents 矩形落在它所在行：token 文
 * 本节点 = 单行片段；'\n' 节点 = 它终结的那一行（空行亦有行盒）；未高亮
 * 整段单文本节点 = 每行一个矩形。同顶矩形（同行多 token）由去重合并。
 * pre 上下 padding / 边框并入首末单元（unitHeightsFromTops 边界法）。
 *
 * 只走内容 span 子树（copy/run 按钮挂在 code.mu-code 上、absolute 定位不
 * 入流；trailing-break 的 <br> 无文本节点，天然不入行带）。
 */
const measureCodeLineBands = (pre: HTMLElement): number[] => {
  // muya 代码块结构：pre.mu-code-block > code.mu-code > span.mu-codeblock-content
  // （Content 基类 tagName = span，不是嵌套 code）。
  const content = pre.querySelector<HTMLElement>(':scope > code.mu-code > .mu-codeblock-content')
  if (!content) return []
  const doc = pre.ownerDocument
  const tops: number[] = []
  const walker = doc.createTreeWalker(content, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    const text = node as Text
    if (text.nodeValue && text.nodeValue.length > 0) {
      const r = doc.createRange()
      r.selectNodeContents(text)
      for (const rect of r.getClientRects()) {
        if (rect.height > 0) tops.push(rect.top)
      }
    }
    node = walker.nextNode()
  }
  if (tops.length < 2) return []
  const preRect = pre.getBoundingClientRect()
  return unitSpansFromTops(
    preRect.top,
    preRect.bottom,
    tops.map((top) => ({ top, owner: 0 }))
  ).heights
}

/**
 * 块内文本行顶序列（视口坐标，未去重）：与 measureLineHeights 同源的
 * Range 行盒走法，但只收 top——供超页子单元（#7 边界②）的 intra-kid 行
 * 级切点并入块级 cut 列表（同顶同行由 unitSpansFromTops 去重兜底）。
 */
const collectTextLineTops = (el: HTMLElement): number[] => {
  const doc = el.ownerDocument
  const tops: number[] = []
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    const text = node as Text
    if (text.nodeValue && text.nodeValue.trim()) {
      const r = doc.createRange()
      r.selectNodeContents(text)
      for (const rect of r.getClientRects()) {
        if (rect.height > 0) tops.push(rect.top)
      }
    }
    node = walker.nextNode()
  }
  return tops
}

/**
 * 子元素切点（#7 + 边界②）：各子元素顶（owner = 子元素序）＋超页子元素
 * （高 > 页内容高）的内部文本行顶。后者是超页 li / 超页引用子块的降级
 * 兜底——兄弟界表达不了它的碎片化，整块走 v1 穿缝会与打印侧（Chromium
 * 进子元素按行盒断开）分叉；并入行级切点后单元粒度细化到行，「超页单元
 * 整块穿缝」退役为「单行 > 整页」的不可能分支。
 */
const kidCutPoints = (
  block: HTMLElement,
  isList: boolean,
  pageContentHeight: number
): Array<{ top: number; owner: number }> => {
  const kids = Array.from(block.children).filter((el) =>
    isList ? el.tagName === 'LI' : el instanceof HTMLElement
  ) as HTMLElement[]
  const cuts: Array<{ top: number; owner: number }> = []
  kids.forEach((kid, i) => {
    const kr = kid.getBoundingClientRect()
    cuts.push({ top: kr.top, owner: i })
    if (kr.height > pageContentHeight) {
      for (const top of collectTextLineTops(kid)) cuts.push({ top, owner: i })
    }
  })
  return cuts
}

/**
 * v2 测量（M4.3b 提交 1）：v1 步进 + 块内子结构——
 * - P：Range 行盒序列（≥ 2 行才带 lines——单行段落没有可切点，保持 keep-together）；
 * - 代码块（pre.mu-code-block，#7）：行起点 caret 矩形行带（≥ 2 行才带
 *   lines；空行/末行换行由 caret 语义与去重兜底）；
 * - 表格（figure.mu-table > table）：GFM 首行 = 表头（headH，续表每页重复），
 *   余行为行切单位；
 * - 列表（ul/ol）：li 顶为切点 → kids（≥ 2 个 li 才有切点；单个超页 li
 *   也由其内部行顶给出切点——边界②）；
 * - 引用（blockquote.mu-block-quote）：直接子块顶为切点 → kids（≥ 2 个
 *   子块；超页子块同上并入行级切点）。
 */
export const measurePaperBlocksV2 = (
  container: HTMLElement,
  geometry: PaperGeometry = PAPER_SIZES_MM.a4
): PaperBlocksMeasurementV2 => {
  const rect = container.getBoundingClientRect()
  const cs = getComputedStyle(container)
  const zoom = Number.parseFloat(cs.zoom || '1') || 1
  const contentTopOffset = Number.parseFloat(cs.paddingTop || '0') * zoom
  const pageContentHeight = (geometry.pageHeightMm - 40) * MM_TO_PX * zoom

  const blocks: PaperBlockBoxV2[] = []
  for (const child of Array.from(container.children)) {
    if (!(child instanceof HTMLElement)) continue
    if (child.matches(EXCLUDED_SELECTOR)) continue
    const r = child.getBoundingClientRect()
    if (r.height === 0 && child.tagName !== 'HR') continue
    const box: PaperBlockBoxV2 = {
      tag: child.tagName.toLowerCase(),
      top: r.top - rect.top - contentTopOffset,
      bottom: r.bottom - rect.top - contentTopOffset,
      isPagebreak: child.querySelector('.mu-mdcols-pagebreak') !== null,
      el: child
    }
    if (child.tagName === 'P') {
      const lines = measureLineHeights(child)
      if (lines.length > 1) box.lines = lines
    } else if (child.tagName === 'PRE' && child.classList.contains('mu-code-block')) {
      const lines = measureCodeLineBands(child)
      if (lines.length > 1) box.lines = lines
    } else if (child.tagName === 'UL' || child.tagName === 'OL') {
      // li 顶为切点（li0 顶由 unitSpansFromTops 的首切点规则剔除）；超页
      // li 并入其内部文本行顶（边界②：镜像 Chromium 进 li 按行盒断开）。
      const cuts = kidCutPoints(child, true, pageContentHeight)
      if (cuts.length > 1) {
        const { heights, owners } = unitSpansFromTops(r.top, r.bottom, cuts)
        box.kids = heights
        box.kidOwners = owners
      }
    } else if (child.tagName === 'BLOCKQUOTE') {
      const cuts = kidCutPoints(child, false, pageContentHeight)
      if (cuts.length > 1) {
        const { heights, owners } = unitSpansFromTops(r.top, r.bottom, cuts)
        box.kids = heights
        box.kidOwners = owners
      }
    } else if (child.tagName === 'FIGURE' && child.classList.contains('mu-table')) {
      const table = child.querySelector(':scope > table')
      const rows = table
        ? Array.from(table.querySelectorAll(':scope > tr, :scope > thead > tr, :scope > tbody > tr'))
        : []
      if (rows.length > 1) {
        const headH = rows[0]!.getBoundingClientRect().height
        const rowHeights = rows.slice(1).map((tr) => tr.getBoundingClientRect().height)
        box.table = { headH, rowHeights }
      }
    }
    blocks.push(box)
  }

  return { blocks, contentTopOffset, pageContentHeight }
}

/**
 * 页叶分页叠加的生命周期胶水：lens 为 page 时在 muya 根（滚动区）内挂
 * overlay，编辑/缩放后重测，缝与页码以绝对定位投影。活引擎（editor.vue）
 * 与只读投影（leafProjection 的页投影）共用。
 *
 * 姿态（视图模型 §5，A″ 裁决 / M4.3b）：页 = 连续流 + 行级缝叠加——拟合走
 * paginateBlocksV2（行界/行界切分缝，与打印链 Chromium 原生切分逐条等价）。
 * 纸叶已改为只读真分片投影（components/editorWithTabs/paperProjection.vue），
 * M3.5 的推挤级联随卡内编辑一并退役（推挤的存在理由是"连续流必须推到
 * 网格"，投影的页卡即容器）。
 */
export const usePaperPagination = (options: {
  /** 是否处于页叶（响应式 getter）。 */
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

  /** overlay 锚在容器的 border-box 上（视觉 px；root 未被 zoom，直接可用）。 */
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
    overlay?.remove()
    overlay = null
  }

  /** 渲染缝/页码叠加（v1 与 v2 布局同形：seams/pageCount/lastBadgeY；
   *  v2 行级缝带 split——e2e 判别器读 data-split）。 */
  const render = (
    layout: PaperLayoutV2,
    measure: PaperBlocksMeasurementV2,
    container: HTMLElement
  ): void => {
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
      if (seam.split) line.dataset.split = seam.split.kind
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

    anchorLayer(overlay, root, container)

    // frontmatter 纸型 → 容器上的内联 CSS 变量（压过 paperLens.css 的 :root
    // 默认值；纸卡宽高与测量同源，编辑所见 = 打印所得）。frontmatter 变化
    // 会触发 MutationObserver 重测，几何随之更新。
    const geometry = getGeometry?.() ?? PAPER_SIZES_MM.a4
    container.style.setProperty('--paper-page-width', `${geometry.pageWidthMm}mm`)
    container.style.setProperty('--paper-page-height', `${geometry.pageHeightMm}mm`)

    // 行级拟合（M4.3b）：缝可落行界/行界（split 缝带 data-split），与打印链
    // （块级 avoid 已撤，Chromium 原生切分）逐条等价，硬验收把关。
    const m = measurePaperBlocksV2(container, geometry)
    const layout = paginateBlocksV2(m.blocks, m.pageContentHeight)
    render(layout, m, container)
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
    if (container)
      mutationObserver.observe(container, { childList: true, subtree: true, characterData: true })
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
