<template>
  <div
    class="deck-pane"
    :class="{ exclusive: isExclusive }"
  >
    <div
      v-if="error"
      class="deck-error"
    >
      <p class="error-title">
        幻灯片构建失败
      </p>
      <pre class="error-detail">{{ error }}</pre>
      <button
        class="error-retry"
        @click="retry"
      >
        重试
      </button>
    </div>
    <iframe
      v-show="!error"
      ref="deckFrame"
      class="deck-frame"
      :src="frameSrc"
      title="md2slides deck"
    />
    <div
      v-if="missingWarn"
      class="deck-missing-warn"
      :title="missingWarn"
    >
      {{ missingWarn }}
    </div>
    <div class="deck-bar">
      <span class="page-indicator">
        {{ indicator }}
      </span>
      <template v-if="leaf === 'present'">
        <button
          v-if="canToggleExclusive && !isExclusive"
          class="bar-button"
          title="独占放映——放映占满整窗，另一视图收起（Esc 退回）"
          @click="toggleExclusive"
        >
          独占
        </button>
        <button
          class="bar-button"
          :disabled="exporting || total === 0"
          title="导出为图片型 PPTX（逐像素保真，文字不可编辑）"
          @click="onExport('image')"
        >
          {{ exporting ? '导出中…' : '导出PPTX' }}
        </button>
        <button
          class="bar-button"
          :disabled="exporting || total === 0"
          title="导出为可编辑 PPTX（母版原生，可改字 / 换配色；需 Python + python-pptx）"
          @click="onExport('editable')"
        >
          {{ exporting ? '导出中…' : '导出可编辑PPTX' }}
        </button>
      </template>
      <button
        class="exit-button"
        :title="presentImmersive ? '退出全屏放映（Esc）' : isExclusive ? '退出独占（Esc）' : isPanel ? '关闭此视图' : '返回编辑（Esc）'"
        @click="exit"
      >
        ✕
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * deckPane — 映支两叶（present 放映 / slide 页览）共用的 md2slides 投影面
 * （视图模型 §2/§4）。同一套机制（本地服务 + iframe + postMessage 桥 + 300ms
 * 防抖原地重建 + 重建保页 + 面板态键盘归属），两叶只差 runOpts.view：
 * - present → view:"present"（一次一页的播放器）；
 * - slide   → view:"list"（全部物理页堆叠 + 溢出徽章，deck 侧打「N页」标）。
 * 同一 leaf 可在全屏（mode=view）与分屏 pane（mode=panel）间切换：iframe 原地
 * 复用，只重发 build。
 *
 * 本组件**零 md2slides 代码依赖**——main 进程起本地服务（vendored 资产包），
 * iframe 指向 `服务/deck.html`（服务出来的文档不受编辑器 CSP 约束），一切交互走
 * postMessage：boot 握手 → build{md, mdDir} → ready/change/error；graphviz /
 * plantuml 图表经 rpc 托本进程离屏出图（muya 同款 viz WASM / plantuml server）。
 * 大位图导出经服务 /x 旁路落盘（不过 postMessage/IPC——数百 MB 会挂死 Electron）。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { diagramTypeOfLang } from '@muyajs/core'
import type { Md2rEvent } from '@shared/types/mdcode2run'
import { useEditorStore } from '@/store/editor'
import { useEditorViewStore } from '@/store/editorView'
import { usePreferencesStore } from '@/store/preferences'
import { renderGraphvizToDataUrl, renderPlantumlToDataUrl } from '@/util/md2slidesDiagram'

const props = defineProps<{
  /** 映支的叶：present 放映 / slide 页览。 */
  leaf: 'present' | 'slide'
  /** view＝该叶全屏；panel＝分屏 pane（视图模型 §3）。 */
  mode: 'view' | 'panel'
  markdown: string
}>()

const editorStore = useEditorStore()
const editorViewStore = useEditorViewStore()
const preferencesStore = usePreferencesStore()
const { plantumlServer } = storeToRefs(preferencesStore)
const { isSplit, presentExclusive, presentImmersive } = storeToRefs(editorViewStore)

// 独占开关只属于分屏中的 present pane（LEAVES 序保证 present 恒为右叶）。
const canToggleExclusive = computed(() => isPanel.value && isSplit.value && props.leaf === 'present')
const isExclusive = computed(() => presentExclusive.value && props.leaf === 'present')
const toggleExclusive = (): void => {
  editorViewStore.setPresentExclusive(!presentExclusive.value)
}

const deckFrame = ref<HTMLIFrameElement | null>(null)
const origin = ref<string | null>(null)
const error = ref('')
const missingWarn = ref('')
const status = ref('正在启动放映服务…')
const index = ref(0)
const total = ref(0)
const warnings = ref(0)
const exporting = ref(false)

const isPanel = computed(() => props.mode === 'panel')

const indicator = computed(() => {
  if (total.value === 0) return status.value
  if (props.leaf === 'slide') {
    return warnings.value > 0 ? `${total.value} 页 · ${warnings.value} 页溢出` : `${total.value} 页`
  }
  return `${index.value} / ${total.value}`
})

/**
 * ready 透出的画布/主题/meta——导出取数要原样带回页面。
 * 必须用 shallowRef：深响应式 ref 在读取时给 meta 套 Proxy，而 postMessage 的
 * 结构化克隆不吃 Proxy（真机翻过车："could not be cloned"）；build 消息全是
 * 字符串所以从未暴露。
 */
const deckInfo = shallowRef<{
  slideWidth: number
  slideHeight: number
  theme: string | null
  meta: Record<string, unknown> | null
} | null>(null)

const pathname = computed(
  () => (editorStore.currentFile as { pathname?: string } | null)?.pathname ?? ''
)
const mdDir = computed(() => (pathname.value ? window.path.dirname(pathname.value) : ''))
const frameSrc = computed(() => (origin.value ? `${origin.value}/deck.html` : ''))

/** 发给 deck 页面（跨源，目标源钉死为服务源）。 */
const postToDeck = (msg: Record<string, unknown>): void => {
  deckFrame.value?.contentWindow?.postMessage(msg, origin.value ?? '*')
}

const sendBuild = (preservePage = false): void => {
  // 每次重建先清旧提示：警告是「这次构建」的结论，修好（补图/改主题名）后
  // 不该继续挂着上一轮的文字。
  missingWarn.value = ''
  // 重建保页（面板态的生命线）：带上最近页号，改字不跳回第 1 页（list 视图
  // 页面侧自保滚动位置，startIndex 被忽略）。
  const startIndex =
    preservePage && index.value > 1 && total.value > 0
      ? Math.min(index.value, total.value)
      : undefined
  postToDeck({
    type: 'md2s:build',
    md: props.markdown,
    mdDir: mdDir.value,
    runOpts: {
      view: props.leaf === 'slide' ? 'list' : 'present',
      ...(startIndex !== undefined ? { startIndex } : {})
    }
  })
}

// —— 放映执行桥（只有 present 叶启用）——
// 页面侧 exec-present.js 是跨源 iframe 里的纯 postMessage 客户端，碰不到 IPC；
// 本层负责：① 把「可跑块能力表」下发让它装饰 ▶；② 把 ▶ 请求转成
// window.mdcode2run.run；③ 把 main 推的事件与结果回灌进 iframe。引擎实例本身
// 由 main 按 docPath 单例托管，与底部 execPanel 共用（会话/journal/trace 互通）。
// 同一时刻只允许一个运行——页面侧结果浮层也是单例。
const EXEC_TIMEOUT_MS = 60000
type ExecReq = { reqId: string; docPath: string; line: number; jobId?: string }
let execReq: ExecReq | null = null
let offExecEvent: (() => void) | null = null

/** 每次 deck 就绪（含 300ms 防抖重建）重新下发：重建会换掉整份 DOM，▶ 要重挂。 */
const sendExecCapability = async (): Promise<void> => {
  if (props.leaf !== 'present') return
  const docPath = pathname.value
  if (!docPath) {
    // 未保存文档不下发 ▶：引擎按 docPath 锚定会话与 documentDir（file= 物化要用）。
    postToDeck({ type: 'md2s:exec-capability', docPath: '', enabled: false, blocks: [] })
    return
  }
  try {
    const parsed = await window.mdcode2run.parse({ docPath, md: props.markdown })
    const runnable = parsed.blocks.filter(
      b => b.runnable && diagramTypeOfLang(b.lang) === null
    )
    const runnableSet = new Set(runnable.map(b => b.line))
    // ⏩ 重放以 h1 章为边界：只有章内已有前置可跑块时才有意义。
    const chapters = [...parsed.chapters].sort((a, b) => a.line - b.line)
    const firstByChapter = new Map<number, number>()
    for (const ch of chapters) {
      const first = ch.fenceLines.find(l => runnableSet.has(l))
      if (first !== undefined) firstByChapter.set(ch.line, first)
    }
    const chapterLineOf = (line: number): number => {
      let key = -1
      for (const ch of chapters) {
        if (ch.line > line) break
        key = ch.line
      }
      return key
    }
    const blocks = runnable.map(b => {
      const first = firstByChapter.get(chapterLineOf(b.line))
      return {
        line: b.line,
        end: b.end,
        runnable: b.runnable,
        lang: b.lang,
        job: b.job,
        replayable: first !== undefined && b.line > first
      }
    })
    postToDeck({ type: 'md2s:exec-capability', docPath, enabled: true, blocks })
  } catch (e) {
    // parse 挂了别把放映拖下水：静默降级为无 ▶，只在控制台留痕。
    console.error('[deckPane] mdcode2run parse failed:', e)
    postToDeck({ type: 'md2s:exec-capability', docPath, enabled: false, blocks: [] })
  }
}

const onExecRequest = async (data: {
  reqId: string
  line: number
  replay?: boolean
}): Promise<void> => {
  const reqId = String(data.reqId ?? '')
  const line = Number(data.line)
  const docPath = pathname.value
  if (!reqId || !Number.isFinite(line) || !docPath) {
    postToDeck({ type: 'md2s:exec-error', reqId, error: '文档未保存或运行请求不合法' })
    return
  }
  if (execReq) {
    postToDeck({ type: 'md2s:exec-error', reqId, error: '已有代码块在运行，请先关闭结果面板' })
    return
  }
  const req: ExecReq = { reqId, docPath, line }
  execReq = req
  try {
    const result = await window.mdcode2run.run({
      docPath,
      md: props.markdown,
      line,
      replay: !!data.replay,
      timeout: EXEC_TIMEOUT_MS
    })
    if (execReq !== req) return // 面板已关 / 文档已换：结果作废
    if (result.job) req.jobId = result.job.id
    postToDeck({ type: 'md2s:exec-result', reqId, result })
  } catch (e) {
    if (execReq !== req) return
    postToDeck({
      type: 'md2s:exec-error',
      reqId,
      error: e instanceof Error ? e.message : String(e)
    })
    execReq = null
  } finally {
    // 同步执行完就释放；job 要留到 job-done 事件（或页面 cancel）才清。
    if (execReq === req && !req.jobId) execReq = null
  }
}

const onExecStop = (data: { jobId: string }): void => {
  const docPath = pathname.value
  const jobId = String(data.jobId ?? '')
  if (docPath && jobId) {
    void window.mdcode2run.stopJob({ docPath, jobId }).catch(() => undefined)
  }
}

/** main 的 started/chunk/done/job-done → iframe；按 docPath + 行号/jobId 定向。 */
const handleExecEvent = (event: Md2rEvent): void => {
  const req = execReq
  if (!req || event.docPath !== req.docPath) return
  if (event.type === 'job-done') {
    if (event.id !== req.jobId) return
  } else if (event.line !== req.line) {
    return
  }
  postToDeck({ type: 'md2s:exec-state', reqId: req.reqId, event })
  if (event.type === 'job-done' && execReq === req) execReq = null
}

/** 图表托渲染：deck 页面画不了的两类（graphviz / plantuml），本进程离屏出位图。 */
const onRpc = async (data: { id: number; diagramType: string; source: string }): Promise<void> => {
  try {
    const dataUrl =
      data.diagramType === 'plantuml'
        ? await renderPlantumlToDataUrl(data.source, plantumlServer.value)
        : await renderGraphvizToDataUrl(data.source)
    postToDeck({ type: 'md2s:rpc-result', id: data.id, ok: true, dataUrl })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    postToDeck({ type: 'md2s:rpc-result', id: data.id, ok: false, error: message })
  }
}

const exit = (): void => {
  // 一键全屏放映态：Esc/✕ 整包退出（恢复视图 + 窗口全屏态）。
  if (presentImmersive.value) {
    editorViewStore.exitPresentImmersive()
    return
  }
  // 独占态下 Esc/✕ 第一优先退独占（回到分屏），不摘叶。
  if (isExclusive.value) {
    editorViewStore.setPresentExclusive(false)
    return
  }
  if (isPanel.value) {
    editorViewStore.removeLeaf(props.leaf)
  } else {
    editorViewStore.focusEditor()
  }
}

const retry = (): void => {
  error.value = ''
  void startServer()
}

const onMessage = (ev: MessageEvent): void => {
  // 只信自家 iframe 的消息（跨源页面里可能有别的 window）。
  if (!deckFrame.value || ev.source !== deckFrame.value.contentWindow) return
  const data = ev.data as Record<string, unknown> | null
  if (!data || typeof data !== 'object') return

  switch (data.type) {
    case 'md2s:boot':
      status.value = '正在构建幻灯片…'
      sendBuild()
      break
    case 'md2s:ready':
      error.value = ''
      status.value = ''
      index.value = Number(data.index) || 1
      total.value = Number(data.total) || 0
      warnings.value = Number(data.warnings) || 0
      deckInfo.value = {
        slideWidth: Number(data.slideWidth) || 1920,
        slideHeight: Number(data.slideHeight) || 1080,
        theme: (data.theme as string | null) ?? null,
        meta: (data.meta as Record<string, unknown> | null) ?? null
      }
      // 交点给 deck：←/→/触屏手势在 iframe 里生效（点击幻灯片同样可聚焦）。
      // 面板态不抢焦点——编辑器必须保住键盘（视图模型 §3）。
      if (!isPanel.value) deckFrame.value?.contentWindow?.focus()
      // DOM 已分页、player 已就绪：此刻装饰 ▶ 才能进 refreshSteps 的步进表。
      void sendExecCapability()
      break
    case 'md2s:change':
      index.value = Number(data.index) || index.value
      total.value = Number(data.total) || total.value
      break
    case 'md2s:warn':
      // 缺图占位等非致命提示：不挡演示，常驻展示到下次构建/出错
      missingWarn.value = String(data.message ?? '')
      break
    case 'md2s:error':
      missingWarn.value = ''
      error.value = String(data.message ?? '未知错误')
      break
    case 'md2s:esc':
      exit()
      break
    case 'md2s:rpc':
      void onRpc(data as unknown as { id: number; diagramType: string; source: string })
      break
    case 'md2s:exec':
      void onExecRequest(data as unknown as { reqId: string; line: number; replay?: boolean })
      break
    case 'md2s:exec-stop':
      onExecStop(data as unknown as { jobId: string })
      break
    case 'md2s:exec-cancel':
      if (execReq && execReq.reqId === String(data.reqId)) execReq = null
      break
    case 'md2s:export-result':
      exportWaiter?.(data)
      exportWaiter = null
      break
    default:
      break
  }
}

const onKeydown = (ev: KeyboardEvent): void => {
  // 焦点在 deck 里时 Esc 由页面侧转发（md2s:esc）；这里接焦点在外（刚进视图）的情况。
  if (ev.key === 'Escape') exit()
}
// 面板态不挂窗口级 Esc：编辑器打字场景下 Esc 属于编辑器（关弹层/取消），
// 关 pane 走工具条按钮或 deck 聚焦时的 md2s:esc。
const listensWindowKeys = !isPanel.value

// —— 导出（present 叶全屏态）：取数在 deck 页面（postMessage），出片在 main（IPC）。——
// 单飞：同一时刻只允许一个导出在跑，取数应答用单一 waiter。

let exportSeq = 0
let exportWaiter: ((data: Record<string, unknown>) => void) | null = null

const waitExportResult = (timeoutMs = 600000): Promise<Record<string, unknown>> =>
  new Promise(resolve => {
    const timer = window.setTimeout(() => {
      exportWaiter = null
      resolve({ ok: false, error: `导出取数超时（${Math.round(timeoutMs / 60000)} 分钟）——页数多时逐页落盘较慢，请重试` })
    }, timeoutMs)
    exportWaiter = data => {
      window.clearTimeout(timer)
      resolve(data)
    }
  })

const onExport = async (kind: 'image' | 'editable'): Promise<void> => {
  if (!origin.value || !deckInfo.value || exporting.value) return
  if (!pathname.value) {
    error.value = '文档尚未保存——先保存（Ctrl+S）再导出。'
    return
  }
  exporting.value = true
  try {
    const id = ++exportSeq
    postToDeck({ type: 'md2s:export', id, kind, ...deckInfo.value })
    const data = await waitExportResult()
    if (!data.ok) {
      const issues = Array.isArray(data.issues) ? (data.issues as string[]).join('\n  ') : ''
      throw new Error(
        issues ? `导出前内容校验未通过，已中止：\n  ${issues}` : String(data.error ?? '导出取数失败')
      )
    }

    const base = window.path.basename(pathname.value).replace(/\.[^.]+$/, '')
    const out = window.path.join(mdDir.value, `${base}${kind === 'editable' ? '.editable' : ''}.pptx`)
    const result = await window.md2slides.exportPptx({
      kind,
      out,
      imagesDir: data.imagesDir as string | undefined,
      pages: data.pages as number | undefined,
      ir: data.ir,
      mediaDir: data.mediaDir as string | undefined,
      issues: data.issues as string[] | undefined
    })
    if (!result.ok) throw new Error(result.error)
    status.value = `已导出：${out}${result.warnings?.length ? `（${result.warnings.length} 条待查项）` : ''}`
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    exporting.value = false
  }
}

const startServer = async (): Promise<void> => {
  status.value = '正在启动放映服务…'
  try {
    const res = await window.md2slides.server({
      action: 'start',
      allowRoots: mdDir.value ? [mdDir.value] : []
    })
    origin.value = res.origin
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

const stopServer = (): void => {
  void window.md2slides.server({ action: 'stop' }).catch(() => undefined)
}

// (列,放) 同屏 = 两个 deckPane 实例共享同一服务：任一卸载就 stop 会杀掉
// 对方的取图/重建。模块级引用计数——最后一个实例卸载才真正关服务。
let deckPaneAlive = 0

// 防抖原地重建：md 变了重发 build，deck 页面原地重跑 compose，不重载 iframe。
// 面板态的 md 变化就是打字——保页在这里生效。
const REBUILD_DEBOUNCE_MS = 300
let rebuildTimer: number | undefined
watch(
  () => props.markdown,
  () => {
    window.clearTimeout(rebuildTimer)
    rebuildTimer = window.setTimeout(() => {
      if (origin.value && !error.value) sendBuild(true)
    }, REBUILD_DEBOUNCE_MS)
  }
)

// 换文档：图片白名单变了 → 服务重启（端口变、origin 变 → iframe 重挂 → boot 重来）。
watch(pathname, () => {
  execReq = null // 旧文档的运行结果不再回灌到新 iframe
  if (origin.value) void startServer()
})

onMounted(() => {
  deckPaneAlive += 1
  window.addEventListener('message', onMessage)
  offExecEvent = window.mdcode2run.onEvent(handleExecEvent)
  if (listensWindowKeys) window.addEventListener('keydown', onKeydown)
  void startServer()
})

onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage)
  offExecEvent?.()
  offExecEvent = null
  execReq = null
  if (listensWindowKeys) window.removeEventListener('keydown', onKeydown)
  window.clearTimeout(rebuildTimer)
  deckPaneAlive -= 1
  if (deckPaneAlive <= 0) stopServer()
})
</script>

<style scoped>
.deck-pane {
  position: relative;
  height: 100%;
  background: #1a1a1a;
  overflow: hidden;
}

.deck-frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
}

.deck-bar {
  position: absolute;
  right: 16px;
  bottom: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 10px;
  border-radius: 18px;
  background: rgba(0, 0, 0, 0.55);
  color: #eee;
  font-size: 13px;
  user-select: none;
  transition: opacity 0.2s ease;
}

/* 独占态：deck-bar 默认隐藏，鼠标移到右下角浮现（✕ = 退出独占）。 */
.deck-pane.exclusive .deck-bar {
  opacity: 0;
  pointer-events: none;
}

.deck-pane.exclusive:hover .deck-bar {
  opacity: 1;
  pointer-events: auto;
}

/* 缺图占位提示（左下角琥珀色胶囊；独占态同 deck-bar 悬浮策略）。 */
.deck-missing-warn {
  position: absolute;
  left: 16px;
  bottom: 16px;
  max-width: 55%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 6px 12px;
  border-radius: 14px;
  background: rgba(180, 83, 9, 0.85);
  color: #ffedd5;
  font-size: 12px;
  user-select: none;
}

.deck-pane.exclusive .deck-missing-warn {
  opacity: 0;
  transition: opacity 0.2s ease;
}

.deck-pane.exclusive:hover .deck-missing-warn {
  opacity: 1;
}

.page-indicator {
  min-width: 64px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  opacity: 0.9;
}

.bar-button {
  border: 0;
  border-radius: 14px;
  padding: 4px 12px;
  background: rgba(255, 255, 255, 0.12);
  color: #eee;
  font-size: 13px;
  cursor: pointer;
}

.bar-button:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.22);
}

.bar-button:disabled {
  opacity: 0.45;
  cursor: default;
}

.exit-button {
  border: 0;
  border-radius: 14px;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.12);
  color: #eee;
  font-size: 13px;
  cursor: pointer;
}

.exit-button:hover {
  background: rgba(255, 255, 255, 0.22);
}

.deck-error {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 48px;
  background: #1a1a1a;
  color: #eee;
}

.error-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.error-detail {
  max-width: 720px;
  /* 按工作区实测高度而不是整窗：面板展开时错误框也不该长到面板背后。 */
  max-height: calc(var(--workspaceHeight, 100vh) * 0.4);
  overflow: auto;
  margin: 0;
  padding: 12px 16px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: #fbb;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
}

.error-retry {
  border: 0;
  border-radius: 14px;
  padding: 6px 20px;
  background: rgba(255, 255, 255, 0.14);
  color: #eee;
  cursor: pointer;
}
</style>
