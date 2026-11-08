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
import { useEditorViewStore } from '@/store/editorView'
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
const editorViewStore = useEditorViewStore()
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
const scrollToBlock = (blockIndex: number | undefined, text: string | undefined): void => {
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
  scrollViewToAnchorIn(scroller, root, { blockIndex: index, text })
}

const offDocAnchor = onDocAnchorChange(anchor => {
  if (!anchor || !matchesCurrentMarkdown(props.markdown ?? '')) return
  if (anchor.origin === 'reverse') return // 自己发的锚不吃回声
  requestAnimationFrame(() => scrollToBlock(anchor.topBlock, anchor.text))
})

const handleClick = (event: MouseEvent): void => {
  const root = muya.value?.domNode
  const target = event.target instanceof Element ? event.target : null
  if (!root || !target || !root.contains(target)) return

  const blocks = contentBlocks(root)
  const topEl = blocks.find(b => b.contains(target))
  if (!topEl) return
  // 反向定位（§6.3）：发锚 origin=reverse，编辑面滚到对应块（不切视图）。
  writeDocAnchor({
    topBlock: blocks.indexOf(topEl),
    text: blockText(topEl),
    origin: 'reverse'
  })
}

const handleDblClick = (event: MouseEvent): void => {
  const root = muya.value?.domNode
  const target = event.target instanceof Element ? event.target : null
  if (!root || !target || !root.contains(target)) return
  handleClick(event)
  // 跳转编辑（§6.3）：切文；光标落位由 editor.vue 的反向锚订阅 + enterFlowEditor
  // 的透镜 watcher 完成（同 markdown 的第二实例，topBlock 语义一致）。
  editorViewStore.enterFlowEditor()
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

  // 恢复：挂载时按锚停到与编辑面同一个文档区域（分屏建立/换 tab 重建均走此）。
  const anchor = readDocAnchor()
  if (anchor && matchesCurrentMarkdown(props.markdown ?? '')) {
    requestAnimationFrame(() => requestAnimationFrame(() => scrollToBlock(anchor.topBlock, anchor.text)))
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
