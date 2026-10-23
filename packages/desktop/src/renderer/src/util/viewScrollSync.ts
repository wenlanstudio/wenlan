// 视图间滚动锚点同步（TODO1 #3）：word/page 与 word/columns 显示同一文档的
// 同一区域。
//
// 两个视图各是一个 Muya 实例：块树一致，但布局不同（columns 视图把分栏组
// regroup 成栏，文档总高与 page 视图不同），scrollTop 数字不能直接互滚。
// 锚点取「内容块序列」中的索引——page 视图是 `.mu-container` 的顶层块，
// columns 视图把栏内块按文档顺序展开、滤掉标记块后，得到同一序列；各视图
// 再各自把索引映射回自己的 DOM。
//
// 锚点按 tab id 存在渲染进程内的模块 Map：视图切换不跨会话，刷新后从文档
// 顶部开始是可接受的行为（columns 视图自身的跨会话 scrollTop 记忆不受影响，
// 两套机制用途不同——那个记住「上次离开文档的位置」，这个保证「两个视图
// 停在同一个地方」）。

/** 非分栏标记块：page 视图的块级数据载体，columns 视图的 hidden 边界块。 */
function isMarkerBlock(el: Element): boolean {
  return (
    el.classList.contains('mu-mdcols-hidden')
    || !!el.querySelector(':scope > .mu-html-preview .mu-mdcols-marker[data-kind]')
  )
}

/**
 * 内容块序列（见文件头注释）。columns 视图的 `.mu-mdcols-group` 按
 * col1 → col2 的文档顺序展开——行内徽标所在段落在栏内，一并入序列；块级
 * 载体块被 editorLayout 加 `mu-mdcols-hidden` 后滤掉。
 */
export function contentBlocks(container: HTMLElement): Element[] {
  const out: Element[] = []
  for (const el of container.children) {
    if (el.classList.contains('mu-mdcols-group')) {
      for (const col of el.children)
        for (const block of col.children) out.push(block)
    }
    else if (!isMarkerBlock(el)) {
      out.push(el)
    }
  }

  return out
}

/** 视口顶部第一个可见块的索引；无可见块时退化为最后一块。 */
export function viewAnchorOf(container: HTMLElement | null): number | null {
  if (!container)
    return null

  const blocks = contentBlocks(container)
  if (!blocks.length)
    return null

  // +1 容忍亚像素：刚好贴边的块不算「开始进入视口」。
  const viewTop = container.getBoundingClientRect().top + 1
  const index = blocks.findIndex((el) => el.getBoundingClientRect().bottom > viewTop)

  return index === -1 ? blocks.length - 1 : index
}

/** 把第 index 个内容块滚到视口顶部（瞬时；越界时夹取到首 / 末块）。 */
export function scrollViewToAnchor(container: HTMLElement | null, index: number): void {
  if (!container)
    return

  const blocks = contentBlocks(container)
  if (!blocks.length)
    return

  const target = blocks[Math.max(0, Math.min(index, blocks.length - 1))]
  container.scrollTop
    += target.getBoundingClientRect().top - container.getBoundingClientRect().top
}

const anchors = new Map<string, number>()

/** 读某 tab 的滚动锚点（块索引）；从未记录过返回 null。 */
export function readViewAnchor(tabId: string): number | null {
  return anchors.get(tabId) ?? null
}

/** 记录某 tab 的滚动锚点。 */
export function writeViewAnchor(tabId: string, index: number): void {
  anchors.set(tabId, index)
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
    const index = viewAnchorOf(container)
    if (index !== null)
      writeViewAnchor(tabId, index)
  })
}
