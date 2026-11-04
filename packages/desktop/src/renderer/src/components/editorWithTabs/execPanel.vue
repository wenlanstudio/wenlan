<template>
  <div
    v-if="visible && panel.open"
    class="exec-panel"
  >
    <div class="panel-body">
      <div
        v-if="!docPath"
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
          >{{ t('execPanel.stale') }}</span>
          <span
            v-if="seqOf(b.line) !== null"
            class="seq"
          >#{{ seqOf(b.line) }}</span>
          <span
            v-if="resultOf(b.line)?.ok === false"
            class="failed"
          >{{ t('execPanel.failed') }}</span>
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
        v-if="docPath && !parseError && selectedLine !== null"
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
        >{{ finalOutputOf(selectedLine) }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'
import { storeToRefs } from 'pinia'
import { t } from '@/i18n'
import bus from '@/bus'
import { useEditorStore } from '@/store/editor'
import { useExecPanelStore } from '@/store/execPanel'
import type { Md2rBlockInfo, Md2rEvent, Md2rRunResult } from '@shared/types/mdcode2run'

/**
 * mdcode2run 底部执行面板（M3 最小闭环）：**只渲染 body**。
 *
 * JetBrains 式分工：底部工具窗口的本体在编辑器列内向上生长，而它的「开关 +
 * 标题 + 计数」长在窗口状态栏里（statusBar 组件读 useExecPanelStore）。所以这里
 * 没有 header，展开时状态栏那条不移动——不存在「两条栏」。
 *
 * 生命周期契约：面板卸载（切 tab/关文档）不 dispose 引擎——main 侧按
 * webContents 存亡 + 60s 宽限管理回收，切 tab 不杀 JVM/python 会话。
 */

const props = defineProps<{
  markdown: string
}>()

const editorStore = useEditorStore()
const { currentFile } = storeToRefs(editorStore)
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

const runnableBlocks = computed(() => blocks.value.filter(b => b.runnable))
const runningCount = computed(() => Object.keys(running.value).length)

/** 文中有围栏（不必经过 parse 就能判断）——未保存文档也据此亮出面板提示。 */
const hasFenceLine = computed(() => /^(?:`{3,}|~{3,})/m.test(props.markdown))

/** 面板可见性：有围栏 / 已解析出块 / 解析报错，三者其一即露面。 */
const visible = computed(
  () => hasFenceLine.value || blocks.value.length > 0 || parseError.value !== ''
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

const codeSlice = (md: string, b: { line: number; end: number }): string => {
  const lines = md.split('\n')
  // 围栏体 = (line, end-1)：跳过开栏行与闭栏行
  return lines.slice(b.line + 1, Math.max(b.line + 1, b.end - 1)).join('\n')
}

const refresh = async (): Promise<void> => {
  const path = docPath.value
  if (!path) return
  try {
    const parsed = await window.mdcode2run.parse({ docPath: path, md: props.markdown })
    parseError.value = ''
    blocks.value = parsed.blocks
    // stale 重算：行号锚定的块若代码快照变了 → 旧结果标 stale；块没了 → 丢结果
    const byLine = new Map(blocks.value.map(b => [b.line, b]))
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
    if (!autoOpened && parsed.blocks.some(b => b.runnable)) {
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
      const tail =
        o.error ? `\n[job] ${o.error}` : `\n[job] exit=${o.code ?? '?'} ${Math.round((o.durationMs ?? 0) / 100) / 10}s`
      appendChunk(line, tail)
      break
    }
    default:
      break
  }
}

// —— 运行 ——
const runBlock = async (line: number): Promise<void> => {
  const path = docPath.value
  if (!path) return
  const b = blocks.value.find(x => x.line === line)
  if (!b) return
  selectedLine.value = line
  revealBlock(line)
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
  const b = blocks.value.find(x => x.line === line)
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
    .map(s => s.trim())
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
  const b = blocks.value.find(x => x.line === line)
  if (!b) return false
  const ran = ranCode.value[line]
  if (ran === undefined) return false
  return codeSlice(props.markdown, b) !== ran
}

const seqOf = (line: number): number | null => {
  const seq = results.value[line]?.session?.seq
  return typeof seq === 'number' && seq >= 0 ? seq : null
}

const langOf = (line: number): string =>
  blocks.value.find(x => x.line === line)?.lang ?? ''

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
  void refresh()
})

onBeforeUnmount(() => {
  offEvent?.()
  offEvent = null
  if (parseTimer !== null) {
    clearTimeout(parseTimer)
    parseTimer = null
  }
  // 状态栏是共享的：本组件卸载（切视图/关文档）时把可见性收回，别留一个能点
  // 但打不开任何东西的按钮。
  panel.sync({ visible: false })
})
</script>

<style scoped>
/* 只渲染 body：开关与计数在状态栏（statusBar），这里没有 header。
   高度上限 40vh，超过就在块清单/输出内部滚动，别把编辑区挤没。 */
.exec-panel {
  flex: none;
  border-top: 1px solid var(--editorColor10);
  background: var(--editorBgColor);
  font-size: 12px;
  color: var(--editorColor);
  user-select: none;
}

.panel-body {
  display: flex;
  height: 240px;
  max-height: 40vh;
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
  padding: 3px 10px;
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
