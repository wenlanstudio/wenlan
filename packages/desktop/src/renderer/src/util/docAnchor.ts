// 一文多览锚服务（视图模型 §6.1）：全窗口单槽 docAnchor + mdRev + 块首行表
// 换算。吸收 viewScrollSync 的切换恢复存储（per-tab Map 退役）；text 桥降级
// 为行表不可用时的兜底（viewScrollSync 保留纯 DOM/文本换算函数）。
//
// 多标签页已关闭：锚无 tab 维度；多窗口各是独立 renderer 进程，模块级单槽
// 天然隔离。坐标**合并写**（各面只算得出自己的坐标：文/栏有 topBlock、本有
// topLine/cursorLine），读时按需取、缺者经行表换算——与 viewScrollSync 的
// ViewAnchor 合并哲学同源。

export interface DocAnchor {
  /** 写锚时的 markdown 版本（reviseMarkdown 每逢内容变化 +1） */
  mdRev: number
  /** 视口顶内容块下标（contentBlocks 展平域：栏组展开、独立标记块剔除） */
  topBlock?: number
  /** 视口顶源行（1 基） */
  topLine?: number
  /** 光标源行（1 基；览/示跟随用，本视图原生产出） */
  cursorLine?: number
  /** 兜底桥证据（视口顶块/行的纯文本） */
  text?: string
  /** 锚来源：scroll=编辑面滚动（默认）；reverse=只读面反向定位/跳转编辑 */
  origin?: 'scroll' | 'reverse'
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

// —— 块首行表缓存：行表与 md 绑定，由持有活引擎的面（editor.vue）在
// json-change 防抖后重建；只读面与本视图只读。表 miss 时换算返回 null，
// 调用方退回 text 桥。
let tableCache: { md: string; table: number[] | null } | null = null

export function updateLineTable(md: string, table: number[] | null): void {
  tableCache = { md, table }
}

function lineTableFor(md: string): number[] | null {
  return tableCache?.md === md ? tableCache.table : null
}

/** 内容块下标 → 块首行（1 基）；表 miss / 越界返回 null。 */
export function blockIndexToLine(md: string, blockIndex: number | undefined | null): number | null {
  if (blockIndex == null) return null
  const table = lineTableFor(md)
  if (!table || blockIndex < 0 || blockIndex >= table.length) return null
  return table[blockIndex] ?? null
}

/** 源行（1 基）→ 包含该行的内容块下标（最后一个 startLine ≤ line 的块）；
 * 表 miss / 行在首块之前返回 null。 */
export function lineToBlockIndex(md: string, line: number): number | null {
  const table = lineTableFor(md)
  if (!table || !table.length || line < table[0]!) return null
  let index = 0
  for (let i = 0; i < table.length; i++) {
    if (table[i]! <= line) index = i
    else break
  }
  return index
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
