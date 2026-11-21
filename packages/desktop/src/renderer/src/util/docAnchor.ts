// 一文多览锚服务（视图模型 §6.0/§6.1）：全窗口单槽 docAnchor + mdRev + 行
// 覆盖换算。锚存的是**归一化后的量**——基准单位「源码行」的实数行位
// ℓ* = topLine + topFrac（§6.0），结构版本化于 mdRev、几何活读。text 桥是
// 行覆盖不可用时的兜底（viewScrollSync 保留纯 DOM/文本换算函数）。
//
// 多标签页已关闭：锚无 tab 维度；多窗口各是独立 renderer 进程，模块级单槽
// 天然隔离。坐标**合并写**（各面只算得出自己的坐标），读时按需取、缺者经
// 行覆盖换算——视图之间从不直接换算，全部经行位基准转手。

import { locateSpan, spansFromStarts, type LineSpan } from './docPos'

/**
 * 位置同步总开关（2026-11-21 用户裁决：**默认禁用**——多视图间不同步位置，
 * 各视图滚动/点击互不影响。点击驱动同步的实现保留在开关后面，待真机验证
 * 成熟后再评估开启）。闸点：editor 的落光标写锚与 reverse 对齐、栏投影的
 * 跟随与点击发锚、deckPane 的 cursor 定位与 locate-up 消费。
 */
export const POSITION_SYNC_ENABLED = false

export interface DocAnchor {
  /** 写锚时的 markdown 版本（reviseMarkdown 每逢内容变化 +1） */
  mdRev: number
  /** 视口顶内容块下标（contentBlocks 展平域：栏组展开、独立标记块剔除）。
   * 写锚面的私有域坐标，消费面只作行覆盖缺失时的兜底 */
  topBlock?: number
  /** 视口顶源行（1 基；topLine + topFrac = 实数行位 ℓ*） */
  topLine?: number
  /** 视口顶行内进度（[0,1) 小数；块顶语义为 0/缺省）。块内行比例是跨面
   * 可迁移的最细粒度——像素不迁移，行位迁移（§6.0） */
  topFrac?: number
  /** 光标源行（1 基；点击驱动同步 §6.2 降级 2026-11-21：文/本落光标 → 各览面
   * 对齐到同一行位） */
  cursorLine?: number
  /** 光标行内进度（[0,1) 小数；行位 ℓ* = cursorLine + cursorFrac） */
  cursorFrac?: number
  /** 点击序号（每次真实落光标 +1）：消费面只认**新序号**——合并写的旧
   * cursorLine 会残留在后续滚动/对齐锚里，按值去重挡不住，序号才是
   * 「这是一次新点击」的可靠判据（§6.2 降级）。 */
  cursorSeq?: number
  /** 兜底桥证据（视口顶块/行的纯文本） */
  text?: string
  /** 锚来源：scroll=编辑面滚动（默认）；reverse=只读面反向定位/跳转编辑 */
  origin?: 'scroll' | 'reverse'
  /** 写锚面标识（滚动同步双向化 §6.2 2026-11-20 再裁决）：flow=文活引擎、
   * column=栏投影、source=本、deck=映（md2slides 列表态）。跟随面据此忽略
   * 自己引发的回声。 */
  source?: 'flow' | 'column' | 'source' | 'deck'
  /** 写锚面正处在**程序对齐动画**中（跟随/反向引发的滚动回声）：接收面一律
   * 忽略。由对齐发起方自己打标——时间窗内无法区分用户滚动与动画帧，只有
   * 发起方知道这次滚动是不是自己引发的。 */
  echo?: boolean
}

type Listener = (anchor: DocAnchor | null) => void

let anchor: DocAnchor | null = null
let rev = 0
let lastMd: string | null = null
const listeners = new Set<Listener>()

/** markdown 变化时推进版本（分屏壳对 markdown prop watch 调用）。 */
export function reviseMarkdown(md: string): number {
  if (md !== lastMd) {
    lastMd = md
    rev += 1
  }
  return rev
}

export function currentMdRev(): number {
  return rev
}

/** 锚的 md 是否就是当前 markdown（消费侧时效校验：防抖窗口内允许旧态，
 * 内容对不上就丢弃，不追）。 */
export function matchesCurrentMarkdown(md: string): boolean {
  return lastMd === md
}

export function readDocAnchor(): DocAnchor | null {
  return anchor ? { ...anchor } : null
}

/** 合并写（坐标合并；mdRev 总取当前——锚跟着最新文档走，防抖窗口内的旧
 * 坐标由读侧校验消化）。写后同步通知订阅者。 */
export function writeDocAnchor(patch: Partial<DocAnchor>): void {
  anchor = { ...(anchor ?? { mdRev: rev }), ...patch, mdRev: rev }
  for (const cb of listeners) cb(anchor)
}

// 点击序号发号器：cursor 写入方（文/本落光标）每次点击取一个新号。
let cursorSeq = 0
export function bumpCursorSeq(): number {
  return ++cursorSeq
}

export function onDocAnchorChange(cb: Listener): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

// —— rAF 合帧（沿 viewScrollSync syncScrollAnchor 的形状）：滚动事件每帧
// 最多写一次，回调在 rAF 里现算（大文档全块 getBoundingClientRect 合并到
// 帧里算一次更稳）。
let anchorRaf = 0
let pendingCompute: (() => Partial<DocAnchor> | null) | null = null

export function scheduleDocAnchorWrite(compute: () => Partial<DocAnchor> | null): void {
  pendingCompute = compute
  if (!anchorRaf) {
    anchorRaf = requestAnimationFrame(() => {
      anchorRaf = 0
      const fn = pendingCompute
      pendingCompute = null
      const patch = fn?.()
      if (patch) writeDocAnchor(patch)
    })
  }
}

/** 同步写一次并取消 pending rAF（视图卸载时调：rAF 回调可能在组件销毁后才
 * 跑，容器已脱离文档、量到 0；这里取消并以卸载瞬间的状态为准）。 */
export function flushDocAnchorWrite(compute?: () => Partial<DocAnchor> | null): void {
  if (anchorRaf) {
    cancelAnimationFrame(anchorRaf)
    anchorRaf = 0
  }
  const fn = compute ?? pendingCompute
  pendingCompute = null
  const patch = fn?.()
  if (patch) writeDocAnchor(patch)
}

// —— 行覆盖缓存：覆盖与 md 绑定（mdRev 世代），由持有活引擎的面（editor.vue）
// 在 json-change 防抖后重建；只读面与本视图只读。覆盖 miss 时换算返回 null，
// 调用方退回 text 桥。
let tableCache: { md: string; spans: LineSpan[] | null } | null = null

export function updateLineTable(md: string, table: number[] | null): void {
  if (table == null) {
    tableCache = { md, spans: null }
    return
  }
  // 末块封口需要文档总行数——md 在手，此处一次算清（每次重建一次，不进热路径）。
  tableCache = { md, spans: spansFromStarts(table, md ? md.split('\n').length : 0) }
}

function spansFor(md: string): LineSpan[] | null {
  return tableCache?.md === md ? tableCache.spans : null
}

/** 内容块下标 → 块首行（1 基）；覆盖 miss / 越界返回 null。 */
export function blockIndexToLine(md: string, blockIndex: number | undefined | null): number | null {
  if (blockIndex == null) return null
  const spans = spansFor(md)
  if (!spans || blockIndex < 0 || blockIndex >= spans.length) return null
  return spans[blockIndex]!.start
}

/** 源行（1 基）→ 包含该行的内容块下标（最后一个 startLine ≤ line 的块）；
 * 覆盖 miss / 行在首块之前返回 null。 */
export function lineToBlockIndex(md: string, line: number): number | null {
  const spans = spansFor(md)
  if (!spans || !spans.length) return null
  return locateSpan(spans, line)
}

/** 内容块的行区间 [start, end]（1 基含端点；末块 end = 文档总行数）。跟随的
 * 块内插值（§6.0 进度换算）用它取 d；覆盖 miss / 越界返回 null。 */
export function blockLineSpan(md: string, blockIndex: number | undefined | null): LineSpan | null {
  if (blockIndex == null) return null
  const spans = spansFor(md)
  if (!spans || blockIndex < 0 || blockIndex >= spans.length) return null
  return spans[blockIndex]!
}

// —— 最近编辑面记忆（跳转编辑目标规则，视图模型 §6.3）：跳转目标是屏上
// 编辑面；不在屏上时切「最近显示过的编辑面」（缺省文）。文/本挂载时各自
// rememberSurface。
export type EditingSurface = 'flow' | 'source'

let lastSurface: EditingSurface = 'flow'

export function rememberSurface(surface: EditingSurface): void {
  lastSurface = surface
}

export function lastEditingSurface(): EditingSurface {
  return lastSurface
}

// e2e 诊断钩子（同 editor.vue 的 __mt_editor 惯例）：锚链路没有 DOM 直读
// 通道，排查跟随/恢复需要从页面直接读锚与行表状态。
declare global {
  interface Window {
    __mt_docAnchor?: {
      read: typeof readDocAnchor
      matches: typeof matchesCurrentMarkdown
      blockToLine: typeof blockIndexToLine
      size: () => number
      lastMd: () => string | null
    }
  }
}
window.__mt_docAnchor = {
  read: readDocAnchor,
  matches: matchesCurrentMarkdown,
  blockToLine: blockIndexToLine,
  // 诊断：订阅者数量与 lastMd（双实例/守卫早退的判据）。
  size: () => listeners.size,
  lastMd: () => lastMd
}
