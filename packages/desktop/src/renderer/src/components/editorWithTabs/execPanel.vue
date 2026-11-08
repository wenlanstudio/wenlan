<template>
  <div
    v-if="isCodeRunSurface && panel.open"
    ref="panelEl"
    class="exec-panel"
  >
    <!-- 顶边拖拽条：热区跨在分隔线上（上 3px 在编辑区、下 3px 在面板内），
         双击 = 最大化 / 还原。 -->
    <div
      class="panel-resizer"
      :class="{ dragging }"
      :title="t('execPanel.resizeHint')"
      @mousedown="startResize"
      @dblclick="toggleMaximize"
    />
    <!-- 右上角关闭钮：执行窗开关已从切换器移除（2026-11-08，视图模型 §1），
         这里是唯一常驻关闭途径。输出工具栏让出右侧内边距防重叠。 -->
    <button
      class="panel-close"
      :title="t('execPanel.close')"
      @click="panel.setOpen(false)"
    >
      <svg
        viewBox="0 0 24 24"
        width="12"
        height="12"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
    <div
      class="panel-body"
      :style="{ height: `${panel.height}px` }"
    >
      <!-- 按钮常驻在视图组里：没有代码围栏的文档点开也要有反馈，别像坏了一样。 -->
      <div
        v-if="!visible"
        class="panel-empty"
      >
        {{ t('execPanel.noBlocks') }}
      </div>
      <div
        v-else-if="!docPath"
        class="panel-error"
      >
        {{ t('execPanel.needPath') }}
      </div>
      <div
        v-else-if="parseError"
        class="panel-error"
      >
        {{ parseError }}
      </div>
      <div
        v-else
        class="block-list"
      >
        <div
          v-for="b in blocks"
          :key="b.line"
          class="block-row"
          :class="{ active: selectedLine === b.line, disabled: !b.runnable }"
          :title="reasonOf(b)"
          @click="select(b.line)"
        >
          <span
            class="lang-badge"
            :data-family="b.family ?? ''"
          >{{ b.lang || b.role }}</span>
          <span class="loc">L{{ b.line + 1 }}</span>
          <span class="snippet">{{ snippetOf(b) }}</span>
          <span
            v-if="resultOf(b.line) && staleOf(b.line)"
            class="stale"
          >{{
            t('execPanel.stale')
          }}</span>
          <span
            v-if="seqOf(b.line) !== null"
            class="seq"
          >#{{ seqOf(b.line) }}</span>
          <span
            v-if="resultOf(b.line)?.ok === false"
            class="failed"
          >{{
            t('execPanel.failed')
          }}</span>
          <button
            class="run-btn"
            :disabled="!b.runnable || isRunning(b.line)"
            :title="isRunning(b.line) ? t('execPanel.running') : t('execPanel.run')"
            @click.stop="runBlock(b.line)"
          >
            <svg
              viewBox="0 0 24 24"
              width="12"
              height="12"
              fill="currentColor"
            >
              <path d="M8 5l12 7-12 7z" />
            </svg>
          </button>
        </div>
      </div>
      <div
        v-if="visible && docPath && !parseError && selectedLine !== null"
        class="output-area"
      >
        <div class="output-toolbar">
          <span class="output-label">
            {{ t('execPanel.output') }} · {{ langOf(selectedLine) }} L{{ selectedLine + 1 }}
          </span>
          <button
            v-if="isRunning(selectedLine)"
            class="stop-btn"
            @click="stopSelected"
          >
            {{ t('execPanel.stop') }}
          </button>
        </div>
        <pre
          class="output-text"
          :class="{ error: resultOf(selectedLine)?.ok === false }"
        >{{
          finalOutputOf(selectedLine)
        }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'
import { storeToRefs } from 'pinia'
import { t } from '@/i18n'
import bus from '@/bus'
import { useEditorStore } from '@/store/editor'
import { useEditorViewStore } from '@/store/editorView'
import { useExecPanelStore, PANEL_MIN_HEIGHT, PANEL_DEFAULT_HEIGHT } from '@/store/execPanel'
import type { Md2rBlockInfo, Md2rEvent, Md2rRunResult } from '@shared/types/mdcode2run'
import { diagramTypeOfLang } from '@muyajs/core'
import { codeSlice, findFenceByCode } from '@/util/fenceRun'

/**
 * mdcode2run 底部执行面板（M3 最小闭环）：**只渲染 body**。
 *
 * JetBrains 式分工：底部工具窗口挂在 app.vue 的 .main-col（侧栏右侧那一列）
 * 上，天然只占侧栏右侧的宽度——侧栏展开/收起会压缩面板宽度，但不会盖住它；
 * 开关是右下角视图按钮组里的「码」（viewSwitcher），这里只渲染 body，没有 header。
 *
 * 组件常驻挂载、由 isCodeRunSurface + panel.open 控制 body 显隐——不随视图
 * 切换卸载，引擎事件订阅和进行中的输出缓存才不会丢。isCodeRunSurface 只在
 * 「文」独占时为真（分屏不算）。引擎实例本身更不随面板卸载：main 侧按
 * webContents 存亡 + 60s 宽限回收，切 tab 不杀 JVM/python 会话。
 */

const props = defineProps<{
  markdown: string
}>()

const editorStore = useEditorStore()
const editorViewStore = useEditorViewStore()
const { currentFile } = storeToRefs(editorStore)
const { isCodeRunSurface } = storeToRefs(editorViewStore)
const panel = useExecPanelStore()

const docPath = computed(() => currentFile.value?.pathname ?? '')

// —— 状态：块清单 / 每块输出 / 每块结果 / 运行中标记 ——
const blocks = ref<Md2rBlockInfo[]>([])
/** parse 失败原因（引擎挂了 / IPC 断了都要让人看见，不能静默隐藏面板）。 */
const parseError = ref('')
/** 首次解析出可跑块时自动展开一次——否则用户看不到这个功能存在。 */
let autoOpened = false
const selectedLine = ref<number | null>(null)
/** 块行号 → 实时累计的 chunk 文本（上限截尾防内存膨胀）。 */
const outputs = ref<Record<number, string>>({})
/** 块行号 → 最终结果（同步执行 = invoke 返回值；job = job-done 前无最终值）。 */
const results = ref<Record<number, Md2rRunResult>>({})
/** 块行号 → 运行中（含 jobId 时可停）。 */
const running = ref<Record<number, string | true>>({})
/** 块行号 → 运行那一刻的代码快照（stale 判定）。 */
const ranCode = ref<Record<number, string>>({})
/** jobId → 块行号（job-done 事件找回头）。 */
const jobLine = new Map<string, number>()

/** 累计输出上限：截尾保留尾部（尾部才是最新进展）。 */
const MAX_OUTPUT_CHARS = 1_000_000

const runnableBlocks = computed(() => blocks.value.filter((b) => b.runnable))
const runningCount = computed(() => Object.keys(running.value).length)

/** 围栏是否属于「图表」而非「代码」：语言表以 muya 的 DIAGRAM_LANGS 为
 *  单一来源（mermaid/graphviz(dot)/plantuml/vega-lite/flowchart/sequence/
 *  wavedrom/echarts/chart/abc/drawio/matplotlib），新增图表语言自动跟随。 */
const isDiagramLang = (lang: string): boolean => diagramTypeOfLang(lang) !== null

/** 围栏 info-string 的首词（`{.python title="x"}` → `python`）。 */
const fenceLangOf = (info: string): string =>
  (info ?? '')
    .replace(/^[{\s]+/, '')
    .split(/[\s,{]/)[0]!
    .toLowerCase()

/**
 * 文中有「代码」围栏——图表围栏不算。
 *
 * 未保存文档不经过 parse，可见性只能靠文本扫描判断；若只数围栏，一篇纯
 * mermaid/graphviz 的文档也会亮出「代码执行」按钮，点开是空清单。
 */
const hasCodeFence = computed(() => {
  const re = /^(?:`{3,}|~{3,})(.*)$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(props.markdown)) !== null) {
    if (!isDiagramLang(fenceLangOf(m[1] ?? ''))) return true
  }
  return false
})

/** 面板可见性：有代码围栏 / 已解析出块 / 解析报错，三者其一即露面。 */
const visible = computed(
  () => hasCodeFence.value || blocks.value.length > 0 || parseError.value !== ''
)

// 状态栏读的就是这几个数：可见性、块计数、运行中数量。面板自己不算。
watchEffect(() => {
  panel.sync({
    visible: visible.value,
    total: blocks.value.length,
    runnable: runnableBlocks.value.length,
    running: runningCount.value
  })
})

// —— parse（markdown 变化防抖重解析 + stale 重算）——
let parseTimer: ReturnType<typeof setTimeout> | null = null

const refresh = async (): Promise<void> => {
  const path = docPath.value
  if (!path) return
  try {
    const parsed = await window.mdcode2run.parse({ docPath: path, md: props.markdown })
    parseError.value = ''
    // 图表围栏（mermaid/graphviz/plantuml/…）不进执行面板：引擎的块清单是
    // 「语法事实」（渲染端要画图），而 code run 是「可执行代码」的语义面，
    // 图表既不可跑也不该以置灰块的形式占位——它根本不属于这个工具窗口。
    blocks.value = parsed.blocks.filter((b) => !isDiagramLang(fenceLangOf(b.lang)))
    // stale 重算：行号锚定的块若代码快照变了 → 旧结果标 stale；块没了 → 丢结果
    const byLine = new Map(blocks.value.map((b) => [b.line, b]))
    for (const line of Object.keys(results.value).map(Number)) {
      const b = byLine.get(line)
      if (!b) {
        delete results.value[line]
        delete outputs.value[line]
        delete ranCode.value[line]
      }
    }
    if (selectedLine.value !== null && !byLine.has(selectedLine.value)) {
      selectedLine.value = runnableBlocks.value[0]?.line ?? null
    }
    if (!autoOpened && isCodeRunSurface.value && blocks.value.some((b) => b.runnable)) {
      autoOpened = true
      panel.setOpen(true)
      if (selectedLine.value === null) {
        selectedLine.value = runnableBlocks.value[0]?.line ?? null
      }
    }
  } catch (err) {
    console.error('[mdcode2run] parse failed:', err)
    parseError.value = err instanceof Error ? err.message : String(err)
    blocks.value = []
  }
}

const scheduleRefresh = (): void => {
  if (parseTimer !== null) clearTimeout(parseTimer)
  parseTimer = setTimeout(() => {
    parseTimer = null
    void refresh()
  }, 300)
}

watch(
  () => [props.markdown, docPath.value] as const,
  () => scheduleRefresh(),
  { immediate: false }
)

// —— 事件流（main 推送；按 docPath 过滤——多窗口各看各的文档）——
let offEvent: (() => void) | null = null

const appendChunk = (line: number, text: string): void => {
  const prev = outputs.value[line] ?? ''
  const next = prev + text
  outputs.value[line] = next.length > MAX_OUTPUT_CHARS ? next.slice(-MAX_OUTPUT_CHARS) : next
}

const handleEvent = (event: Md2rEvent): void => {
  if (event.docPath !== docPath.value) return
  switch (event.type) {
    case 'chunk': {
      // 只喂给在跑的块：done 之后的迟到 chunk 丢弃（重跑已清场）
      if (running.value[event.line] !== undefined) {
        appendChunk(event.line, event.text)
      }
      break
    }
    case 'started': {
      // 新一轮开始：清该块旧输出（防上一轮残留）
      outputs.value[event.line] = ''
      break
    }
    case 'job-done': {
      const line = jobLine.get(event.id)
      if (line === undefined) return
      jobLine.delete(event.id)
      delete running.value[line]
      // 作业终局：退出码追加进输出流（job 结果的 stdout 本来就是空的）
      const o = event.outcome
      const tail = o.error
        ? `\n[job] ${o.error}`
        : `\n[job] exit=${o.code ?? '?'} ${Math.round((o.durationMs ?? 0) / 100) / 10}s`
      appendChunk(line, tail)
      break
    }
    default:
      break
  }
}

// —— 运行 ——
const runBlock = async (line: number, opts: { reveal?: boolean } = {}): Promise<void> => {
  const path = docPath.value
  if (!path) return
  const b = blocks.value.find((x) => x.line === line)
  if (!b) return
  selectedLine.value = line
  // reveal 默认开：面板里点块行 / 点 ▶ 要「所见即所跑」。但编辑器围栏上的 ▶
  // 例外（runFenceByText 传 reveal:false）——用户既然点得到这个按钮，说明块就
  // 在眼前，再把它滚到视口顶是干扰（issue #4 反馈：点击后代码块位置跳动）。
  if (opts.reveal !== false) revealBlock(line)
  running.value[line] = true
  outputs.value[line] = ''
  delete results.value[line]
  try {
    const result = await window.mdcode2run.run({
      docPath: path,
      md: props.markdown,
      line
    })
    if (result.job) {
      // 异步作业：invoke 立刻返回 { id }，完成走 job-done 事件。
      // result 照存（session/seq 立即可用），终值输出 = 累计 chunk 流。
      running.value[line] = result.job.id
      jobLine.set(result.job.id, line)
      ranCode.value[line] = codeSlice(props.markdown, b)
      results.value[line] = result
    } else {
      // 同步完成：结果即终值（stdout/text 为权威输出，替换累计 chunk）
      delete running.value[line]
      results.value[line] = result
      ranCode.value[line] = codeSlice(props.markdown, b)
    }
  } catch (err) {
    delete running.value[line]
    results.value[line] = {
      ok: false,
      kind: 'error',
      stdout: '',
      text: '',
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

/**
 * 「文」视图围栏 ▶（issue #4）：muya 只带来块体原文，这里按原文反查开栏行，
 * 展开面板后复用 runBlock 的完整链路（逐块输出 / stale / 反向定位）。
 * 面板原先只在首次 parse 出可跑块时自动展开一次，手动执行不会展开。
 */
const runFenceByText = (text: string): boolean => {
  const target = findFenceByCode(props.markdown, blocks.value, text)
  if (!target) return false
  selectedLine.value = target.line
  if (target.runnable) void runBlock(target.line, { reveal: false })
  return true
}

/**
 * 「文」视图光标进了某个代码块（issue #4 反馈第二问）：反向联动——反查开栏行，
 * 块清单里对应 block-row 高亮并滚到可见。与 runFenceByText 不同：这里**绝不**
 * 调 revealBlock——光标本来就是用户亲手放进去的，任何编辑区滚动都是干扰。
 */
const handleFenceSelectRequest = (payload: unknown): void => {
  const text = (payload as { text?: string } | null)?.text ?? ''
  if (!text) return
  if (text === lastSelectedFenceText) return
  const target = findFenceByCode(props.markdown, blocks.value, text)
  if (!target) return
  lastSelectedFenceText = text
  if (selectedLine.value === target.line) return
  selectedLine.value = target.line
  void nextTick(() => {
    document.querySelector('.exec-panel .block-row.active')?.scrollIntoView({ block: 'nearest' })
  })
}

/** 上一次反向联动命中的块体原文：同一块内反复按键/移动光标不重查。 */
let lastSelectedFenceText = ''

const handleFenceRunRequest = (payload: unknown): void => {
  if (!isCodeRunSurface.value) return
  const text = (payload as { text?: string } | null)?.text ?? ''
  panel.setOpen(true) // 先给可见反馈，后面的反查失败也不能让按钮像坏了一样
  if (!text || runFenceByText(text)) return

  // refresh() 有 300ms 防抖：刚打开文档 / 刚改完代码块就点 ▶ 时 blocks 还是
  // 旧快照，按块体原文反查必然落空。强制同步重解析一次再试，别让用户再点一遍。
  void refresh().then(() => {
    runFenceByText(text)
  })
}

const stopSelected = (): void => {
  const line = selectedLine.value
  if (line === null) return
  const jobId = running.value[line]
  const path = docPath.value
  if (typeof jobId === 'string' && path) {
    void window.mdcode2run.stopJob({ docPath: path, jobId })
    jobLine.delete(jobId)
  }
  delete running.value[line]
}

// —— 视图辅助 ——
/** 让编辑区滚到该块的围栏内容首行（空围栏退回围栏行）——所见即所跑。 */
const revealBlock = (line: number): void => {
  const b = blocks.value.find((x) => x.line === line)
  if (!b) return
  const target = b.end > b.line + 1 ? b.line + 1 : b.line
  bus.emit('mdcode2run-reveal-line', { line: target })
}

const select = (line: number): void => {
  selectedLine.value = line
  revealBlock(line)
}

/** 块内首行非空代码（截断）——列表里一眼知道这块是什么，不必先滚动过去。 */
const snippetOf = (b: Md2rBlockInfo): string => {
  const first = codeSlice(props.markdown, b)
    .split('\n')
    .map((s) => s.trim())
    .find(Boolean)
  if (!first) return ''
  return first.length > 36 ? `${first.slice(0, 36)}…` : first
}

const resultOf = (line: number): Md2rRunResult | undefined => results.value[line]

/** 不可跑块的原因（悬停提示）：标注问题 + 角色 + 语言支持，三选一拼。 */
const reasonOf = (b: Md2rBlockInfo): string => {
  if (b.runnable) return t('execPanel.run')
  const bits = [...b.problems]
  if (b.role !== 'code') bits.push(`role: ${b.role}`)
  if (!b.supported) bits.push(`unsupported: ${b.lang || '?'}`)
  return bits.join(' · ')
}

const isRunning = (line: number): boolean => running.value[line] !== undefined

const staleOf = (line: number): boolean => {
  const b = blocks.value.find((x) => x.line === line)
  if (!b) return false
  const ran = ranCode.value[line]
  if (ran === undefined) return false
  return codeSlice(props.markdown, b) !== ran
}

const seqOf = (line: number): number | null => {
  const seq = results.value[line]?.session?.seq
  return typeof seq === 'number' && seq >= 0 ? seq : null
}

const langOf = (line: number): string => blocks.value.find((x) => x.line === line)?.lang ?? ''

const finalOutputOf = (line: number): string => {
  if (isRunning(line)) {
    return outputs.value[line] || t('execPanel.running')
  }
  const result = results.value[line]
  if (!result) {
    const acc = outputs.value[line]
    return acc || t('execPanel.empty')
  }
  if (!result.ok) {
    return result.error || result.stdout || result.text || t('execPanel.failed')
  }
  if (result.job) {
    // 作业：终值 = 累计 chunk 流（run 结果的 stdout 为空是契约设计）
    return outputs.value[line] || t('execPanel.empty')
  }
  return result.stdout || result.text || t('execPanel.empty')
}

onMounted(() => {
  offEvent = window.mdcode2run.onEvent(handleEvent)
  bus.on('mdcode2run-run-fence', handleFenceRunRequest)
  bus.on('mdcode2run-select-fence', handleFenceSelectRequest)
  void refresh()
})

// —— 面板高度：顶边拖拽 + 双击最大化（JetBrains 式底部工具窗口）——
// 高度存 store（renderer localStorage，与侧栏宽度同一套惯例），拖动时每帧只改
// 内存、松手才落盘。上限按实测的「工作区 + 面板」总量减去标题栏与编辑区保底
// 现算，不写死 vh：窗口变矮后旧的像素高度会挤掉整个编辑区。
const panelEl = ref<HTMLDivElement | null>(null)
const dragging = ref(false)
/** 双击最大化前的还原高度（没最大化过就是默认值）。 */
let restoreHeight: number | null = null
/** 拖动中挂到 window 上的清理函数：组件在拖动途中被卸载也能摘干净。 */
let stopDrag: (() => void) | null = null

/** 拖动时给编辑区留的最小高度（不含标题栏）：再小就没法写东西了。 */
const MIN_EDITOR_HEIGHT = 200

const maxHeight = (): number => {
  // 面板与 .workspace 是同一条 flex column 上的兄弟，二者高度之和是常数
  //（状态栏另占 flex:none）。用实测值而不是 `100vh - 常量` 反推：标题栏在放映
  // 沉浸态会隐藏、状态栏高度随主题可能变，任何写死的 chrome 高度都会漂移。
  // 同时别用「当前剩余空间」——它随面板自身变高而变小，往上拖会把自己夹回去。
  const container = panelEl.value?.parentElement as HTMLElement | null
  if (!container) return PANEL_MIN_HEIGHT
  const workspace = container.querySelector<HTMLElement>('.workspace')
  const titleBar = container.querySelector<HTMLElement>('.title-bar')
  const titleBarPx =
    titleBar && getComputedStyle(titleBar).display !== 'none'
      ? titleBar.getBoundingClientRect().height
      : 0
  const available =
    (workspace?.getBoundingClientRect().height ?? 0) +
    (panelEl.value?.getBoundingClientRect().height ?? 0)
  return Math.max(PANEL_MIN_HEIGHT, Math.round(available - titleBarPx - MIN_EDITOR_HEIGHT))
}

const clampHeight = (px: number): number =>
  Math.min(maxHeight(), Math.max(PANEL_MIN_HEIGHT, Math.round(px)))

const endResize = (): void => {
  dragging.value = false
  document.body.classList.remove('exec-panel-resizing')
  stopDrag?.()
  stopDrag = null
}

const startResize = (event: MouseEvent): void => {
  if (event.button !== 0) return
  event.preventDefault()
  const startY = event.clientY
  const startHeight = panel.height
  // 每帧都读一次上限：拖动过程中若触发 resize，仍不会越界
  let last = startHeight
  const onMove = (e: MouseEvent): void => {
    last = clampHeight(startHeight - (e.clientY - startY))
    panel.setHeight(last)
  }
  const onUp = (): void => {
    panel.setHeight(last, true)
    endResize()
  }
  stopDrag = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  dragging.value = true
  document.body.classList.add('exec-panel-resizing')
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

const toggleMaximize = (): void => {
  const max = maxHeight()
  if (panel.height >= max - 1) {
    panel.setHeight(restoreHeight ?? PANEL_DEFAULT_HEIGHT, true)
    restoreHeight = null
    return
  }
  restoreHeight = panel.height
  panel.setHeight(max, true)
}

// 窗口变矮：把高度收回上限内（不然编辑区被挤没），顺带丢掉失效的还原值
const onWindowResize = (): void => {
  if (panel.height > maxHeight()) panel.setHeight(maxHeight(), true)
}

window.addEventListener('resize', onWindowResize)

onBeforeUnmount(() => {
  bus.off('mdcode2run-run-fence', handleFenceRunRequest)
  bus.off('mdcode2run-select-fence', handleFenceSelectRequest)
  offEvent?.()
  offEvent = null
  if (parseTimer !== null) {
    clearTimeout(parseTimer)
    parseTimer = null
  }
  window.removeEventListener('resize', onWindowResize)
  endResize()
  // 状态栏是共享的：本组件卸载（切视图/关文档）时把可见性收回，别留一个能点
  // 但打不开任何东西的按钮。
  panel.sync({ visible: false })
})
</script>

<style scoped>
/* 只渲染 body：无 header——开关入口在围栏 ▶ 与码透镜点块（2026-11-08 起，
   切换器不再有执行窗开关），右上角常驻关闭钮。
   高度由拖拽条决定（store 里的 px，上限按编辑列高度现算），越界就在块清单/
   输出内部滚动，别把编辑区挤没。 */
.exec-panel {
  position: relative;
  flex: none;
  border-top: 1px solid var(--editorColor10);
  background: var(--editorBgColor);
  font-size: 12px;
  color: var(--editorColor);
  user-select: none;
}

.panel-close {
  position: absolute;
  top: 5px;
  right: 8px;
  z-index: 4; /* 压过 resizer 热区（z-index 3），热区只有 6px 高互不遮挡 */
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--editorColor40);
  cursor: pointer;
}

.panel-close:hover {
  color: var(--editorColor);
  background: var(--editorColor08);
}

/* 拖拽热区跨在分隔线上：上半截落在编辑区里，鼠标够得着。 */
.panel-resizer {
  position: absolute;
  top: -3px;
  left: 0;
  right: 0;
  height: 6px;
  z-index: 3;
  cursor: ns-resize;
}

.panel-resizer::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 0;
  right: 0;
  height: 1px;
  background: transparent;
  transition: background 0.12s ease;
}

.panel-resizer:hover::after,
.panel-resizer.dragging::after {
  background: var(--themeColor);
}

/* 拖动时鼠标可能已经跑出热区：整窗锁光标并禁掉选中，松手即摘。 */
:global(body.exec-panel-resizing) {
  cursor: ns-resize;
  user-select: none;
}

.panel-body {
  display: flex;
  min-height: 0;
}

.block-list {
  flex: none;
  width: 340px;
  overflow: auto;
  border-right: 1px solid var(--editorColor10);
}

.block-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 10px;
  cursor: pointer;
}

.block-row:hover {
  background: var(--editorColor04);
}

.block-row.active {
  background: var(--editorColor08);
}

.block-row.disabled {
  opacity: 0.5;
}

.panel-error {
  flex: 1;
  padding: 8px 12px;
  overflow: auto;
  color: var(--dangerColor, #eb4d4d);
  user-select: text;
}

.panel-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--editorColor40);
}

.lang-badge {
  min-width: 48px;
  text-align: center;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--editorColor10);
  font-family: var(--editorFontMono, monospace);
}

.lang-badge[data-family='python'] {
  color: #3572a5;
}

.lang-badge[data-family='java'] {
  color: #b07219;
}

.lang-badge[data-family='shell'] {
  color: #89e051;
}

.lang-badge[data-family='mysql'],
.lang-badge[data-family='hive'] {
  color: #e38c00;
}

.loc {
  font-family: var(--editorFontMono, monospace);
  color: var(--editorColor50);
}

.snippet {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--editorColor60);
  font-family: var(--editorFontMono, monospace);
}

.stale {
  color: var(--warningColor, #e6a23c);
}

.seq {
  color: var(--editorColor50);
}

.failed {
  color: var(--dangerColor, #eb4d4d);
}

.run-btn {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 18px;
  border: none;
  border-radius: 3px;
  background: var(--themeColor);
  color: var(--editorBgColor);
  cursor: pointer;
}

.run-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.output-area {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.output-toolbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  /* 右侧让出关闭钮的位置（18px 钮 + 8px 边距），stop 按钮不压角。 */
  padding: 3px 34px 3px 10px;
  border-bottom: 1px solid var(--editorColor10);
}

.output-label {
  color: var(--editorColor50);
}

.stop-btn {
  margin-left: auto;
  padding: 1px 8px;
  border: 1px solid var(--editorColor20);
  border-radius: 3px;
  background: transparent;
  color: var(--editorColor);
  cursor: pointer;
}

.output-text {
  flex: 1;
  margin: 0;
  padding: 6px 10px;
  overflow: auto;
  font-family: var(--editorFontMono, monospace);
  white-space: pre-wrap;
  word-break: break-all;
  user-select: text;
}

.output-text.error {
  color: var(--dangerColor, #eb4d4d);
}
</style>
