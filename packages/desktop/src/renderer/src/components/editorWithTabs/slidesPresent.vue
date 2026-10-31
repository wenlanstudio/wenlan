<template>
  <div class="slides-present">
    <div
      v-if="error"
      class="slides-present-error"
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
      class="slides-present-frame"
      :src="frameSrc"
      title="md2slides deck"
    />
    <div class="slides-present-bar">
      <span class="page-indicator">
        {{ total > 0 ? `${index} / ${total}` : status }}
      </span>
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
      <button
        class="exit-button"
        title="退出放映（Esc）"
        @click="exit"
      >
        ✕ 退出
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * slidesPresent — slides/present 视图：把当前文档交给 md2slides 放映。
 *
 * 形态（md2slides 仓 docs/design/integration-marktext.md §5，2026-10-30 裁决）：
 * 本组件**零 md2slides 代码依赖**——main 进程起本地服务（vendored 资产包），iframe
 * 指向 `服务/deck.html`（服务出来的文档不受编辑器 CSP 约束），一切交互走
 * postMessage：boot 握手 → build{md, mdDir} → ready/change/error；graphviz /
 * plantuml 图表经 rpc 托本进程离屏出图（muya 同款 viz WASM / plantuml server）。
 *
 * 注意：进入本视图时编辑器（muya）已被 v-if 卸载——放映期间没有活编辑 DOM，
 * md 变化来自文件切换/外部重载，经 300ms 防抖原地重建（不重载 iframe，无闪烁）。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useEditorStore } from '@/store/editor'
import { useEditorViewStore } from '@/store/editorView'
import { usePreferencesStore } from '@/store/preferences'
import { renderGraphvizToDataUrl, renderPlantumlToDataUrl } from '@/util/md2slidesDiagram'

const props = defineProps<{
  markdown: string
}>()

const editorStore = useEditorStore()
const editorViewStore = useEditorViewStore()
const preferencesStore = usePreferencesStore()
const { plantumlServer } = storeToRefs(preferencesStore)

const deckFrame = ref<HTMLIFrameElement | null>(null)
const origin = ref<string | null>(null)
const error = ref('')
const status = ref('正在启动放映服务…')
const index = ref(0)
const total = ref(0)
const exporting = ref(false)

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

const sendBuild = (): void => {
  postToDeck({ type: 'md2s:build', md: props.markdown, mdDir: mdDir.value })
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
  editorViewStore.setMainView('document', 'page')
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
      deckInfo.value = {
        slideWidth: Number(data.slideWidth) || 1920,
        slideHeight: Number(data.slideHeight) || 1080,
        theme: (data.theme as string | null) ?? null,
        meta: (data.meta as Record<string, unknown> | null) ?? null
      }
      // 交点给 deck：←/→/触屏手势在 iframe 里生效（点击幻灯片同样可聚焦）。
      deckFrame.value?.contentWindow?.focus()
      break
    case 'md2s:change':
      index.value = Number(data.index) || index.value
      total.value = Number(data.total) || total.value
      break
    case 'md2s:error':
      error.value = String(data.message ?? '未知错误')
      break
    case 'md2s:esc':
      exit()
      break
    case 'md2s:rpc':
      void onRpc(data as unknown as { id: number; diagramType: string; source: string })
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

// —— 导出（M2）：取数在 deck 页面（postMessage），出片在 main（IPC）。——
// 单飞：同一时刻只允许一个导出在跑，取数应答用单一 waiter。
// 大位图由页面直传 deck 服务旁路落盘（/x），桥上与 IPC 只走目录路径——
// 数百 MB 过 postMessage/IPC 会把 Electron 挂死（2026-10-31 真机 79 页教训）。

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

// 防抖原地重建：md 变了重发 build，deck 页面原地重跑 compose，不重载 iframe。
const REBUILD_DEBOUNCE_MS = 300
let rebuildTimer: number | undefined
watch(
  () => props.markdown,
  () => {
    window.clearTimeout(rebuildTimer)
    rebuildTimer = window.setTimeout(() => {
      if (origin.value && !error.value) sendBuild()
    }, REBUILD_DEBOUNCE_MS)
  }
)

// 换文档：图片白名单变了 → 服务重启（端口变、origin 变 → iframe 重挂 → boot 重来）。
watch(pathname, () => {
  if (origin.value) void startServer()
})

onMounted(() => {
  window.addEventListener('message', onMessage)
  window.addEventListener('keydown', onKeydown)
  void startServer()
})

onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage)
  window.removeEventListener('keydown', onKeydown)
  window.clearTimeout(rebuildTimer)
  stopServer()
})
</script>

<style scoped>
.slides-present {
  position: absolute;
  inset: 0;
  background: #1a1a1a;
  overflow: hidden;
}

.slides-present-frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
}

.slides-present-bar {
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
  padding: 4px 12px;
  background: rgba(255, 255, 255, 0.12);
  color: #eee;
  font-size: 13px;
  cursor: pointer;
}

.exit-button:hover {
  background: rgba(255, 255, 255, 0.22);
}

.slides-present-error {
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
  max-height: 40vh;
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
