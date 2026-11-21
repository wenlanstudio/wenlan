<template>
  <div class="leaf-projection">
    <div
      ref="host"
      class="leaf-projection-host"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * leafProjection — 分屏右 pane 的栏只读投影（视图模型 §1/§2：右 pane 一律
 * 只读）。同一份 markdown 的**只读第二 muya 实例**（columnsLayout 建构期
 * 定死）——编辑发生在左 pane 的活引擎上，这里只展示"栏这一叶长什么样"。
 *
 * 与 editor.vue 的差异是刻意的最小化：
 * - `readOnly: true`（三层锁死：contenteditable / 事件分发 / 状态提交）；
 * - 不注册任何 UI 插件、不接 json-change（不进保存/TOC/历史管线）、不接
 *   file-changed（换 tab 时整个分屏随 tab 切换重建）；
 * - markdown 变化 250ms 防抖 `setContent`（每次都是全量块树重建，不能跟
 *   打字同频；左 pane 的活引擎才是实时面）。
 *
 * M1 锚服务（§6.0/§6.1/§6.2/§6.3）：双向对等面——消费锚跟随/恢复（行位
 * 基准：topLine + topFrac 跨域一致，σ⁻¹ 经本域覆盖二分；实现算子带块内
 * 插值），用户滚动也发锚（source=column，ρ_column 读出行位，§6.2 再裁决）；
 * 单击 = 反向定位（发锚 origin=reverse，写行位），双击 = 跳转编辑（同上并
 * 切文，光标落在对应块）。
 *
 * 已知妥协：Muya.use 是进程级静态注册——若本组件挂载前 editor.vue 已注册过
 * UI 插件，投影实例也会实例化它们（readOnly 下多数浮层无从触发，风险可接受）。
 */
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { Muya, type IMuyaOptions } from '@muyajs/core'
import { usePreferencesStore } from '@/store/preferences'
import { buildMuyaViewOptions } from '@/util/muyaViewOptions'
import { getMuyaLocale } from '@/util/muyaLocale'
import { parsePaperTheme } from '@/util/paperPagination'
import {
  blockIndexToLine,
  matchesCurrentMarkdown,
  onDocAnchorChange,
  readDocAnchor,
  writeDocAnchor
} from '@/util/docAnchor'
import { locateSpan, spanProgress, spansFromStarts, type LineSpan } from '@/util/docPos'
import { blockText, contentBlocks, scrollViewToAnchorIn } from '@/util/viewScrollSync'

const props = defineProps<{
  /** 投影栏叶：只读第二实例，columnsLayout 建构期定死。 */
  lens: 'column'
  markdown: string
}>()

const preferencesStore = usePreferencesStore()
const { language } = storeToRefs(preferencesStore)

const host = ref<HTMLDivElement | null>(null)
const muya = shallowRef<Muya | null>(null)
// 本域行覆盖（右栏自己的 muya 解析域）：锚的 topBlock 是写锚面私有域坐标，
// 两个域的 contentBlocks 序列**不齐**——分栏标记块在 flow 里是可见徽标（计
// 入）、在 columns 布局里隐藏（剔除），实测块序差 3。跨域跟随一律经**行位
// 基准**（§6.0：源码行跨域一致）：锚的 topLine → 本域覆盖二分 → 本域块；
// topBlock 只作覆盖缺失时的兜底。
const localSpans = shallowRef<LineSpan[] | null>(null)

const rebuildLocalSpans = (): void => {
  if (!muya.value) return
  try {
    const starts = muya.value.getBlockStartLines()
    if (!starts) {
      localSpans.value = null
      return
    }
    const totalLines = (props.markdown ?? '').split('\n').length
    localSpans.value = spansFromStarts(starts, totalLines)
  } catch (e) {
    console.error('[leafProjection] local line table failed:', e)
    localSpans.value = null
  }
}

const PROJECTION_DEBOUNCE_MS = 250
let applyTimer = 0

const applyMarkdown = (): void => {
  if (muya.value) {
    muya.value.setContent(props.markdown ?? '')
    // 本域覆盖随内容重建（O(文档)，与 setContent 同量级）。
    rebuildLocalSpans()
  }
  // 纸面主题同拍（与页投影、打印导出链单源）：挂在 domNode（.mu-container
  // 祖先）上，命中 .paper-theme-thesis 作用域组。
  muya.value?.domNode?.classList.toggle(
    'paper-theme-thesis',
    parsePaperTheme(props.markdown ?? '') === 'thesis'
  )
}

// —— 锚服务接线（§6.0/§6.3）——
/** 把锚实现到本投影视口（R_column）。σ⁻¹ 经**行位基准**：锚的 topLine +
 * topFrac（实数行位，跨域一致）→ 本域覆盖二分 → 本域块；topBlock 是写锚面
 * 私有域坐标，仅覆盖缺失时经主域行表换算兜底。实现算子 = 块顶 + 块内行进度
 * ×块高（几何活读；块高两侧不同——换行宽窄——时块内是投影对齐，块界不动）。
 * 块根与滚动容器都从 **muya 实例**取：构造时 muya `getContainer` 会
 * `replaceWith` 掉传入的 host div——Vue 的 template ref 从此指着 detached
 * 旧壳（parentElement 为 null），只有 `muya.domNode` 是实时在文档里的；
 * 滚动容器是它的父（.leaf-projection，overflow:auto）。混用 ref 会让跟随
 * 静默失效（M1 首版踩过）。 */
const scrollToAnchor = (
  anchor: { topBlock?: number; topLine?: number; topFrac?: number; text?: string },
  behavior: 'smooth' | 'auto' = 'smooth'
): void => {
  const root = muya.value?.domNode as HTMLElement | null | undefined
  const scroller = (root?.parentElement as HTMLElement | null) ?? null
  if (!root || !scroller) return

  const spans = localSpans.value
  const real = anchor.topLine != null ? anchor.topLine + (anchor.topFrac ?? 0) : null
  let index: number | undefined
  if (real != null && spans?.length) {
    const at = locateSpan(spans, Math.max(1, Math.floor(real)))
    if (at != null) index = at
  }
  if (index == null && anchor.topBlock != null) {
    // 跨域兜底：主域块 → 行（主引擎覆盖）→ 本域块；双表都缺再同域直通
    // （text 校验失败再退 text 桥——scrollViewToAnchorIn 内建）。
    const line = blockIndexToLine(props.markdown ?? '', anchor.topBlock)
    index = (line != null && spans?.length ? locateSpan(spans, line) : anchor.topBlock) ?? undefined
  }

  const el = index != null ? contentBlocks(root)[index] : undefined
  const span = index != null ? spans?.[index] : undefined
  if (el && span) {
    const rect = el.getBoundingClientRect()
    const base = scroller.scrollTop + rect.top - scroller.getBoundingClientRect().top
    const x = real != null ? spanProgress(span, real) : 0
    const target = base + rect.height * x
    // 幂等守卫（§6.2）：目标即当前（<1px）不动，反向链路一步收敛、动画不重启。
    if (Math.abs(target - scroller.scrollTop) < 1) return
    if (behavior === 'smooth') scroller.scrollTo({ top: target, behavior: 'smooth' })
    else scroller.scrollTop = target
    return
  }
  // span/几何不可量：块顶对齐兜底（text 校验 → text 桥，scrollViewToAnchorIn 内建）。
  scrollViewToAnchorIn(scroller, root, { blockIndex: index, text: anchor.text }, { behavior })
}

// —— 点击驱动同步（§6.2 降级 2026-11-21，取代双向滚动同步）——
// 滚动不再驱动同步（任何面的滚动都是本地行为）；**点击是唯一同步触发**：
// 文/本落光标（cursorLine 变化）→ 本投影滚到同一行位的块内比例位置。
// 本投影的单击/双击发 reverse 锚（§6.3）——文对齐时光标不动（cursorLine
// 不变），不构成回路；连续跟随时代的回声防护机械（宽限窗/量化/自抑制）
// 随滚动发布一并退役。
let lastCursorLine: number | null = null

const offDocAnchor = onDocAnchorChange(anchor => {
  console.debug('[trace][proj] anchor', anchor && anchor.cursorLine, '/', anchor && anchor.source, 'matches', anchor ? matchesCurrentMarkdown(props.markdown ?? '') : false)
  if (!anchor || !matchesCurrentMarkdown(props.markdown ?? '')) return
  if (anchor.cursorLine == null || anchor.cursorLine === lastCursorLine) return
  lastCursorLine = anchor.cursorLine
  console.debug('[trace][proj] follow cursorLine', anchor.cursorLine, '+', anchor.cursorFrac)
  scrollToAnchor({ topLine: anchor.cursorLine, topFrac: anchor.cursorFrac }, 'smooth')
})

const locateBlockAt = (event: MouseEvent): { index: number; text: string; line: number | null } | null => {
  const root = muya.value?.domNode
  const target = event.target instanceof Element ? event.target : null
  if (!root || !target || !root.contains(target)) return null

  const blocks = contentBlocks(root)
  const topEl = blocks.find(b => b.contains(target))
  if (!topEl) return null
  const index = blocks.indexOf(topEl)
  return { index, text: blockText(topEl), line: localSpans.value?.[index]?.start ?? null }
}

const handleClick = (event: MouseEvent): void => {
  const at = locateBlockAt(event)
  if (!at) return
  // 反向定位（§6.3）：发锚 origin=reverse，编辑面滚到对应块（不切视图、
  // 不动右栏）。行位是基准单位——topLine 跨域一致，文/本消费面各自经自己的
  // 行覆盖换算（块序差 3 的跨域直通从此不进主路径）；topBlock 留作同域兜底。
  // 块顶语义：显式清 topFrac（合并写不覆盖旧值的对冲）。
  writeDocAnchor({
    topBlock: at.index,
    topLine: at.line ?? undefined,
    topFrac: undefined,
    text: at.text,
    origin: 'reverse',
    source: 'column'
  })
}

const handleDblClick = (event: MouseEvent): void => {
  const at = locateBlockAt(event)
  if (!at) return
  // 跳转定位（§6.3 裁决口径：想编辑 = 跳转滚动到相应区域）——右栏先滚到
  // 双击块顶（平滑），左栏经 reverse 锚跟随对齐；不切视图、不落光标。
  scrollToAnchor({ topBlock: at.index, topLine: at.line ?? undefined, text: at.text }, 'smooth')
  writeDocAnchor({
    topBlock: at.index,
    topLine: at.line ?? undefined,
    topFrac: undefined,
    text: at.text,
    origin: 'reverse',
    source: 'column'
  })
}

watch(
  () => props.markdown,
  () => {
    window.clearTimeout(applyTimer)
    applyTimer = window.setTimeout(applyMarkdown, PROJECTION_DEBOUNCE_MS)
  }
)

onMounted(() => {
  if (!host.value) return
  const options: Partial<IMuyaOptions> = {
    ...buildMuyaViewOptions(),
    markdown: props.markdown,
    locale: getMuyaLocale(language.value),
    readOnly: true,
    focusMode: false,
    columnsLayout: 'columns'
  }
  const instance = new Muya(host.value, options)
  instance.init()
  muya.value = instance
  // 本域覆盖初值（后续随 applyMarkdown 防抖重建）。
  rebuildLocalSpans()
  // 首挂内容经构造器传入（不走 applyMarkdown），主题类在此补挂。
  instance.domNode?.classList.toggle(
    'paper-theme-thesis',
    parsePaperTheme(props.markdown ?? '') === 'thesis'
  )

  // 恢复：挂载时按锚停到与编辑面同一个文档区域（分屏建立/换 tab 重建均走
  // 此）；瞬时落位，不演动画。
  const anchor = readDocAnchor()
  if (anchor && matchesCurrentMarkdown(props.markdown ?? '')) {
    requestAnimationFrame(() => requestAnimationFrame(() => scrollToAnchor(anchor, 'auto')))
  }

  const root = instance.domNode
  root?.addEventListener('click', handleClick)
  root?.addEventListener('dblclick', handleDblClick)
})

onBeforeUnmount(() => {
  window.clearTimeout(applyTimer)
  offDocAnchor()
  muya.value?.destroy()
  muya.value = null
})
</script>

<style scoped>
.leaf-projection {
  height: 100%;
  overflow: auto;
  background: var(--editorBgColor);
}

.leaf-projection-host {
  min-height: 100%;
}
</style>
