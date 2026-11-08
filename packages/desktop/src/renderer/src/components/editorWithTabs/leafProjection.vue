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
 * M1 锚服务（§6.1/§6.3）：消费单槽 docAnchor 跟随与恢复（topBlock 直通，
 * 同一 markdown 的第二实例顶层块序与主引擎一致）；单击 = 反向定位（发锚
 * origin=reverse），双击 = 跳转编辑（同上并切文，光标落在对应块）。
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
// 本域块首行表（右栏自己的 muya 解析域）：锚的 topBlock 是主引擎域，两个
// 域的 contentBlocks 序列**不齐**——分栏标记块在 flow 里是可见徽标（计入）、
// 在 columns 布局里隐藏（剔除），实测块序差 3。跨域跟随须经行号换算
// （主域块 → 行 → 本域块），blockIndex 直通只在同 columnsLayout 下成立。
const localLines = shallowRef<number[] | null>(null)

const PROJECTION_DEBOUNCE_MS = 250
let applyTimer = 0

const applyMarkdown = (): void => {
  if (muya.value) {
    muya.value.setContent(props.markdown ?? '')
    // 本域行表随内容重建（O(文档)，与 setContent 同量级）。
    try {
      localLines.value = muya.value.getBlockStartLines()
    } catch (e) {
      console.error('[leafProjection] local line table failed:', e)
      localLines.value = null
    }
  }
  // 纸面主题同拍（与页投影、打印导出链单源）：挂在 domNode（.mu-container
  // 祖先）上，命中 .paper-theme-thesis 作用域组。
  muya.value?.domNode?.classList.toggle(
    'paper-theme-thesis',
    parsePaperTheme(props.markdown ?? '') === 'thesis'
  )
}

// —— 锚服务接线（§6.1/§6.3）——
/** 把锚的 topBlock 滚到本投影视口顶。同实例语义：投影是同一 markdown 的
 *  第二 muya 实例，topBlock 即本容器 contentBlocks 序的下标。
 *  块根与滚动容器都从 **muya 实例**取：构造时 muya `getContainer` 会
 *  `replaceWith` 掉传入的 host div——Vue 的 template ref 从此指着 detached
 *  旧壳（parentElement 为 null），只有 `muya.domNode` 是实时在文档里的；
 *  滚动容器是它的父（.leaf-projection，overflow:auto）。混用 ref 会让跟随
 *  静默失效（M1 首版踩过）。 */
const scrollToBlock = (
  blockIndex: number | undefined,
  text: string | undefined,
  behavior: 'smooth' | 'auto' = 'smooth'
): void => {
  const root = muya.value?.domNode as HTMLElement | null | undefined
  const scroller = root?.parentElement ?? null
  if (!root || !scroller) return

  // 跨域换算：主域块 → 行（主引擎行表）→ 本域块（localLines）。行表任一侧
  // 不可用时退回直通（text 校验失败再退 text 桥——scrollViewToAnchorIn 内建）。
  let index = blockIndex
  const line = blockIndexToLine(props.markdown ?? '', blockIndex)
  if (line != null && localLines.value && localLines.value.length) {
    const lines = localLines.value
    let i = 0
    for (let k = 0; k < lines.length; k++) {
      if (lines[k]! <= line) i = k
      else break
    }
    index = i
  }
  scrollViewToAnchorIn(scroller, root, { blockIndex: index, text }, { behavior })
}

// —— 回声抑制：单击/双击发 reverse 后，左栏滚到该块顶产生的 scroll 锚会
// 经跟随链路传回来——目标块恰是刚点的块，右栏会被拉到块顶（用户明说右栏
// 不得动）。按「目标块首行 == 最近 reverse 行」判回声，吞掉这一次；用户
// 随后手动滚走（行不同）即恢复跟随。
let lastReverseLine: number | null = null

const offDocAnchor = onDocAnchorChange(anchor => {
  if (!anchor || !matchesCurrentMarkdown(props.markdown ?? '')) return
  if (anchor.origin === 'reverse') return // 自己发的锚不吃回声
  requestAnimationFrame(() => {
    const root = muya.value?.domNode as HTMLElement | null | undefined
    if (!root) return
    // 回声判定要在换算后的本域目标块上做：目标块首行 == 最近 reverse 行
    // ⇒ 这是反向定位的连锁，右栏不动。
    const line = blockIndexToLine(props.markdown ?? '', anchor.topBlock)
    let targetIndex = anchor.topBlock ?? -1
    if (line != null && localLines.value && localLines.value.length) {
      const lines = localLines.value
      let i = 0
      for (let k = 0; k < lines.length; k++) {
        if (lines[k]! <= line) i = k
        else break
      }
      targetIndex = i
    }
    const targetLine = localLines.value?.[targetIndex] ?? null
    if (lastReverseLine != null && targetLine === lastReverseLine) return
    scrollToBlock(anchor.topBlock, anchor.text, 'smooth')
  })
})

const locateBlockAt = (event: MouseEvent): { index: number; text: string; line: number | null } | null => {
  const root = muya.value?.domNode
  const target = event.target instanceof Element ? event.target : null
  if (!root || !target || !root.contains(target)) return null

  const blocks = contentBlocks(root)
  const topEl = blocks.find(b => b.contains(target))
  if (!topEl) return null
  const index = blocks.indexOf(topEl)
  return { index, text: blockText(topEl), line: localLines.value?.[index] ?? null }
}

const handleClick = (event: MouseEvent): void => {
  const at = locateBlockAt(event)
  if (!at) return
  // 反向定位（§6.3）：发锚 origin=reverse，编辑面滚到对应块（不切视图、
  // 不动右栏）。记录行号供跟随回声判定。
  lastReverseLine = at.line
  writeDocAnchor({
    topBlock: at.index,
    text: at.text,
    origin: 'reverse'
  })
}

const handleDblClick = (event: MouseEvent): void => {
  const at = locateBlockAt(event)
  if (!at) return
  // 跳转定位（§6.3 裁决口径：想编辑 = 跳转滚动到相应区域）——右栏先滚到
  // 双击块（平滑），左栏经 reverse 锚跟随对齐；不切视图、不落光标。
  lastReverseLine = at.line
  scrollToBlock(at.index, at.text, 'smooth')
  writeDocAnchor({
    topBlock: at.index,
    text: at.text,
    origin: 'reverse'
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
  // 本域行表初值（后续随 applyMarkdown 防抖重建）。
  try {
    localLines.value = instance.getBlockStartLines()
  } catch (e) {
    console.error('[leafProjection] local line table failed:', e)
  }
  // 首挂内容经构造器传入（不走 applyMarkdown），主题类在此补挂。
  instance.domNode?.classList.toggle(
    'paper-theme-thesis',
    parsePaperTheme(props.markdown ?? '') === 'thesis'
  )

  // 恢复：挂载时按锚停到与编辑面同一个文档区域（分屏建立/换 tab 重建均走
  // 此）；瞬时落位，不演动画。
  const anchor = readDocAnchor()
  if (anchor && matchesCurrentMarkdown(props.markdown ?? '')) {
    requestAnimationFrame(() => requestAnimationFrame(() => scrollToBlock(anchor.topBlock, anchor.text, 'auto')))
  }

  const root = instance.domNode
  root?.addEventListener('click', handleClick)
  root?.addEventListener('dblclick', handleDblClick)
})

onBeforeUnmount(() => {
  window.clearTimeout(applyTimer)
  offDocAnchor()
  // 投影不写锚（跟随是单向的，锚代表编辑面位置；§6.2）。
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
