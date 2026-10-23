// 视图间滚动同步（TODO1 #4）：同一个 txt 的多个视图（document/page、
// document/columns、code/source 源码）是同一份文档的不同排版，切换视图时应当
// 停在同一个文档区域。
//
// 各视图排版不同，scrollTop 的数字不能互滚（分栏视图把分栏组 regroup 成栏，
// 文档总高与 page 视图不同；源码视图是一行一行的纯文本）。因此同步的货币是
// 「文档位置」，用三种坐标共同表达：
//
//   - `blockIndex`：内容块序列中的下标。page 视图是 `.mu-container` 的顶层块，
//     columns 视图把栏内块按文档顺序展开、滤掉标记块后，得到同一序列。
//   - `line`：markdown 源码行号（1-based）。源码视图天然拥有这个坐标。
//   - `text`：视口顶部那一块 / 那一行的纯文本——两种坐标之间的桥。各视图的
//     排版不同但文本相同，用它可以在视图之间换算位置。
//
// 锚点按 tab id 存在渲染进程内的模块 Map：视图切换不跨会话，刷新后从文档
// 顶部开始是可接受的行为。tab 自身的跨会话 scrollTop 另由 store 的
// updateScrollPosition 记忆，两套机制用途不同——那个记住「上次离开文档的
// 位置」，这个保证「多个视图停在同一个地方」。

/**
 * 一个视图的视口位置。字段按视图填充，读取方用自己认得的那个坐标，缺失时
 * 退回到 `text` 换算。
 */
export interface ViewAnchor {
  /** 内容块序列中的下标（word/page、word/columns 视图）。 */
  blockIndex?: number
  /** markdown 源码行号，1-based（dev/md 源码视图）。 */
  line?: number
  /** 视口顶部那一块 / 那一行的纯文本。 */
  text?: string
}

/** 分栏标记块：独立成块的标记（块级徽标），不是内容块。 */
function isMarkerBlock(el: Element): boolean {
  return !!el.querySelector(':scope > .mu-html-preview .mu-mdcols-marker[data-kind]')
}

/**
 * The element whose children are the content blocks.
 *
 * The engine's DOM is `.mu-editor` (the contenteditable AND the scroll
 * container) → `.mu-container` (the text column) → the blocks. Scrolling and
 * viewport geometry belong to the outer element, the block sequence to the
 * inner one — mixing them up silently yields a one-element "block list" (the
 * whole document) and an anchor that always points at the top.
 */
export function contentRoot(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>(':scope > .mu-container') ?? container
}

/**
 * 内容块序列（见文件头注释）。分栏组是块树里的节点，DOM 上是
 * `.mu-columns` > `.mu-column` > 内容块——按 col1 → col2 的文档顺序展开；
 * 栏内独立成块的标记块（块级徽标）不是内容块，滤掉。
 */
export function contentBlocks(container: HTMLElement): Element[] {
  const out: Element[] = []
  for (const el of contentRoot(container).children) {
    if (el.classList.contains('mu-columns')) {
      for (const col of el.children)
        for (const block of col.children) {
          if (!isMarkerBlock(block)) out.push(block)
        }
    }
    else if (!isMarkerBlock(el)) {
      out.push(el)
    }
  }

  return out
}

/** 块的纯文本：取第一段非空内容。 */
export function blockText(block: Element): string {
  for (const line of (block.textContent ?? '').split('\n')) {
    const text = line.trim()
    if (text)
      return text
  }

  return ''
}

/**
 * 去掉行首的 markdown 语法，得到可与块文本比对的纯文本。只处理行首标记：
 * 标题、列表项、引用、代码围栏——它们在渲染后的块文本里都不存在。
 */
export function stripMarkdownSyntax(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/^\s*(?:```|~~~)\s*/, '')
    .trim()
}

/**
 * 比对用的归一化：抹掉强调 / 行内代码标记并压缩空白，这样「**粗体** 文本」
 * 与渲染后的「粗体 文本」能对上。
 */
function normalizeAnchorText(text: string): string {
  return text.replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim()
}

/** 两段文本是否指向同一处内容：先全等，再退到包含匹配。 */
function sameAnchorText(a: string, b: string): boolean {
  const x = normalizeAnchorText(a)
  const y = normalizeAnchorText(b)
  if (!x || !y)
    return false
  if (x === y)
    return true

  const [shorter, longer] = x.length <= y.length ? [x, y] : [y, x]

  // 一两个字符的包含匹配太容易误命中（满屏都是「的」），只认更长的证据。
  return shorter.length >= 2 && longer.includes(shorter)
}

/**
 * 在块序列里找到与锚点文本对应的下标；找不到返回 -1。先找全等（文档里
 * 重复的段落很常见），再退到包含匹配。
 */
export function findBlockIndex(blocks: Element[], text: string): number {
  if (!text)
    return -1

  const target = normalizeAnchorText(text)
  if (!target)
    return -1

  for (let i = 0; i < blocks.length; i++) {
    if (normalizeAnchorText(blockText(blocks[i])) === target)
      return i
  }

  for (let i = 0; i < blocks.length; i++) {
    if (sameAnchorText(blockText(blocks[i]), text))
      return i
  }

  return -1
}

/** 视口顶部第一个可见块的锚点；无可见块时退化为最后一块。 */
export function viewAnchorOf(container: HTMLElement | null): ViewAnchor | null {
  if (!container)
    return null

  const blocks = contentBlocks(container)
  if (!blocks.length)
    return null

  // +1 容忍亚像素：刚好贴边的块不算「开始进入视口」。
  const viewTop = container.getBoundingClientRect().top + 1
  const index = blocks.findIndex((el) => el.getBoundingClientRect().bottom > viewTop)
  const at = index === -1 ? blocks.length - 1 : index

  return { blockIndex: at, text: blockText(blocks[at]) }
}

/**
 * 把锚点滚到视口顶部（瞬时；越界时夹取到首 / 末块）。优先用 blockIndex，但
 * 校验该坐标处的块文本是否仍与锚点 text 一致——文档编辑会让块序号漂移，校验
 * 失败就放弃精确坐标、退回 text 桥（`findBlockIndex`），避免滚到错误位置。
 * blockIndex 缺失（锚点来自 source 视图）时同样走 text 桥。
 */
export function scrollViewToAnchor(container: HTMLElement | null, anchor: ViewAnchor | null): void {
  if (!container || !anchor)
    return

  const blocks = contentBlocks(container)
  if (!blocks.length)
    return

  let index = anchor.blockIndex
  if (index != null) {
    // 越界夹取到首 / 末块（与原 clamp 行为一致）。
    if (index < 0) index = 0
    else if (index >= blocks.length) index = blocks.length - 1
    // 编辑后块序号会漂移：坐标处的文本若与锚点 text 不符，放弃精确坐标、
    // 退回 text 桥，避免滚到错误位置。
    if (anchor.text && !sameAnchorText(blockText(blocks[index]), anchor.text))
      index = undefined
  }

  if (index == null) {
    const found = findBlockIndex(blocks, anchor.text ?? '')
    if (found < 0)
      return
    index = found
  }

  const target = blocks[Math.max(0, Math.min(index, blocks.length - 1))]
  container.scrollTop
    += target.getBoundingClientRect().top - container.getBoundingClientRect().top
}

/**
 * 源码视图：某一行对应的锚点（1-based 行号 + 该行的纯文本）。视口顶部行常是
 * 空行 / 代码围栏 / 纯标记行，`stripMarkdownSyntax` 后为空——空 text 会让
 * text 桥断链，切到 page/columns 时 `findBlockIndex` 返回 -1、
 * `scrollViewToAnchor` 静默 return，位置停在顶部（跳顶）。因此向上找最近的
 * 有内容行作为桥的文本证据（停在当前块开头，语义比向下跳到下一块更准）；
 * `line` 仍记真实视口顶部行号，保证源码视图内部的恢复精度不受影响。
 */
export function sourceAnchorOf(markdown: string, line: number): ViewAnchor {
  const lines = markdown.split('\n')
  const topIndex = Math.max(0, Math.min(line - 1, lines.length - 1))

  let bridgeIndex = topIndex
  let text = stripMarkdownSyntax(lines[bridgeIndex] ?? '')
  while (!text && bridgeIndex > 0) {
    bridgeIndex--
    text = stripMarkdownSyntax(lines[bridgeIndex] ?? '')
  }

  return { line: topIndex + 1, text }
}

/**
 * 源码视图：把锚点解析成行号（1-based）。锚点带行号时直接用（越界夹取），
 * 只有文本时（来自 page / columns 视图）在源码里找对应行；找不到返回 null。
 */
export function resolveSourceLine(markdown: string, anchor: ViewAnchor | null): number | null {
  if (!anchor)
    return null

  const lines = markdown.split('\n')
  if (anchor.line != null) {
    const ln = Math.max(1, Math.min(anchor.line, lines.length))
    // 编辑后行号会漂移：该行的文本若与锚点 text 不符，放弃精确行号、退回 text 桥。
    if (!anchor.text || sameAnchorText(stripMarkdownSyntax(lines[ln - 1] ?? ''), anchor.text))
      return ln
  }

  if (!anchor.text)
    return null

  const target = normalizeAnchorText(anchor.text)
  if (!target)
    return null

  for (let i = 0; i < lines.length; i++) {
    if (normalizeAnchorText(stripMarkdownSyntax(lines[i])) === target)
      return i + 1
  }

  for (let i = 0; i < lines.length; i++) {
    if (sameAnchorText(stripMarkdownSyntax(lines[i]), anchor.text))
      return i + 1
  }

  return null
}

const anchors = new Map<string, ViewAnchor>()

/** 读某 tab 的滚动锚点；从未记录过返回 null。 */
export function readViewAnchor(tabId: string): ViewAnchor | null {
  return anchors.get(tabId) ?? null
}

/**
 * 记录某 tab 的滚动锚点。**合并而非覆盖**：各视图只能算出自己的坐标
 * （page/columns 有 blockIndex、source 有 line），覆盖会让每次跨视图都必走
 * 脆弱的 text 桥换算——空行断链即跳顶、重复文本即错位。合并后 blockIndex 与
 * line 常驻，任一视图读时直接命中本坐标，仅当本坐标因编辑漂移（读时校验
 * 失败）才退回 text 桥。
 */
export function writeViewAnchor(tabId: string, anchor: ViewAnchor): void {
  const prev = anchors.get(tabId)
  anchors.set(tabId, prev ? { ...prev, ...anchor } : anchor)
}

// 滚动事件每帧最多派发一次，但 viewAnchorOf 要对所有内容块做一次
// getBoundingClientRect，大文档下合并到 rAF 里算一次更稳。两个视图不会
// 同时滚动，一个模块级 rAF 句柄足够。
let anchorRaf = 0

/** 在 scroll 处理器里调用：把容器当前的视口顶部块记为该 tab 的锚点。 */
export function syncScrollAnchor(container: HTMLElement, tabId: string): void {
  if (anchorRaf)
    return

  anchorRaf = requestAnimationFrame(() => {
    anchorRaf = 0
    const anchor = viewAnchorOf(container)
    if (anchor !== null)
      writeViewAnchor(tabId, anchor)
  })
}

/**
 * 同步把容器当前视口顶部块记为该 tab 的锚点（不进 rAF）。视图
 * `onBeforeUnmount` 调它：rAF 合并写法的回调可能在组件销毁后才跑，此时容器
 * 已脱离文档、`getBoundingClientRect` 量到 0，锚点会错。这里取消 pending rAF
 * 并同步算一次，保证切走时锚点是离开瞬间的位置；仍走合并写入，保留其它视图
 * 留下的坐标。
 */
export function flushScrollAnchor(container: HTMLElement, tabId: string): void {
  if (anchorRaf) {
    cancelAnimationFrame(anchorRaf)
    anchorRaf = 0
  }

  const anchor = viewAnchorOf(container)
  if (anchor !== null)
    writeViewAnchor(tabId, anchor)
}
