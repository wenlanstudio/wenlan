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
      <template v-else>
        <!-- 左栏：mr 文档的整份作业入口 + 块清单（JetBrains 式两栏：左块表、右输出） -->
        <div class="left-col">
          <!-- mr 体裁（kind="mr"）：文档级「运行整份作业」入口。体裁是加法不是减法——
               普通块 ▶ 照旧，这里只是多一条作业管线入口（docs/MR-EXECUTOR.md §2）。 -->
          <div
            v-if="docKind === 'mr'"
            class="job-bar"
          >
            <button
              class="job-run-btn"
              :disabled="mrRunning || !docPath"
              @click="runWholeJob"
            >
              {{ mrRunning ? t('execPanel.jobRunning') : t('execPanel.runJob') }}
            </button>
            <span class="job-hint">{{ t('execPanel.jobHint') }}</span>
          </div>
          <!-- E4 教学模式：本 tab 是已落盘的实验副本 → 锁序步骤卡 + 回填/报告。
               步骤顺序来自教师录制 trace（发布物下发，main 侧注回）；提交走服务端
               锁序/计分裁决，引擎只给事实（guardStep 通过判定）。 -->
          <div
            v-if="lab"
            class="lab-bar"
          >
            <div class="lab-steps">
              <div
                v-for="(s, i) in lab.stepOrder"
                :key="s.key"
                class="lab-step"
                :class="{
                  passed: teachingStore.labSubmitted[s.key]?.passed,
                  failed:
                    teachingStore.labSubmitted[s.key] &&
                    !teachingStore.labSubmitted[s.key].passed
                }"
              >
                <span class="lab-step-idx">{{ i + 1 }}</span>
                <span
                  class="lab-step-name"
                  :title="s.key"
                >{{ stepNameOf(s.key) }}</span>
                <span class="lab-step-point">{{ s.point }}</span>
                <span class="lab-step-status">{{ stepStatusOf(s.key) }}</span>
                <button
                  class="lab-step-submit"
                  :disabled="labBusy"
                  @click="submitStep(s.key)"
                >
                  {{ t('teachingLab.submit') }}
                </button>
              </div>
            </div>
            <div class="lab-actions">
              <button
                class="lab-btn"
                :disabled="labBusy"
                @click="backfillAll"
              >
                {{ t('teachingLab.backfill') }}
              </button>
              <button
                class="lab-btn"
                :disabled="labBusy"
                @click="submitReport"
              >
                {{ t('teachingLab.reportSubmit') }}
              </button>
              <span
                class="lab-msg"
                :class="{ err: labMsgErr }"
              >{{ labMsg }}</span>
            </div>
          </div>
          <div class="block-list">
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
              >{{ badgeOf(b) }}</span>
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
        </div>
        <div class="right-col">
          <div
            v-if="visible && docPath && !parseError && selectedLine !== null"
            class="output-area"
          >
            <div class="output-toolbar">
              <span class="output-label">
                {{ t('execPanel.output') }} · {{ langOf(selectedLine) }} L{{ selectedLine + 1 }}
              </span>
              <!-- 会话族（java/python/shell/powershell）的 ran/total/过期 HUD：
                   引擎 sessionRun.decorate 附带，一次性族（query/file/job…）没有。 -->
              <span
                v-if="sessionHudOf(selectedLine)"
                class="session-hud"
              >{{ sessionHudOf(selectedLine) }}</span>
              <span class="toolbar-flex" />
              <!-- ⟳ 销毁会话：跨块状态（变量/cwd/env）归零，下次运行重建。 -->
              <button
                v-if="selectedIsSessionFamily && !isRunning(selectedLine)"
                class="reset-btn"
                :title="t('execPanel.sessionReset')"
                @click="resetSelected"
              >
                ⟳
              </button>
              <!-- query 原型带结构化行列（rows）时输出区给 表格/原文 双态，默认表格；
                   纯文本块不出开关，走原文分支。 -->
              <span
                v-if="selectedRows"
                class="view-toggle"
              >
                <button
                  class="view-btn"
                  :class="{ on: outputView === 'table' }"
                  @click="outputView = 'table'"
                >
                  {{ t('execPanel.viewTable') }}
                </button>
                <button
                  class="view-btn"
                  :class="{ on: outputView === 'raw' }"
                  @click="outputView = 'raw'"
                >
                  {{ t('execPanel.viewRaw') }}
                </button>
              </span>
              <button
                v-if="isRunning(selectedLine)"
                class="stop-btn"
                @click="stopSelected"
              >
                {{ t('execPanel.stop') }}
              </button>
            </div>
            <div
              v-if="showTable"
              class="output-table-wrap"
            >
              <table class="output-table">
                <thead>
                  <tr>
                    <th
                      v-for="c in selectedRows!.columns"
                      :key="c"
                    >
                      {{ c }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(row, i) in shownRows"
                    :key="i"
                  >
                    <td
                      v-for="(cell, j) in row"
                      :key="j"
                      :class="{ null: cell == null || cell === 'NULL' }"
                    >
                      {{ cell == null ? 'NULL' : cell }}
                    </td>
                  </tr>
                </tbody>
                <tfoot v-if="selectedRows!.cells.length > TABLE_MAX_ROWS">
                  <tr>
                    <td :colspan="selectedRows!.columns.length">
                      {{
                        t('execPanel.rowCap', {
                          total: selectedRows!.cells.length,
                          shown: TABLE_MAX_ROWS
                        })
                      }}
                    </td>
                  </tr>
                </tfoot>
              </table>
              <!-- 尾注（如 beeline 的 N rows selected / 第二结果集）：弱化展示，不混进表格 -->
              <pre
                v-if="tableNote"
                class="output-table-note"
              >{{ tableNote }}</pre>
            </div>
            <pre
              v-else
              class="output-text"
              :class="{ error: resultOf(selectedLine)?.ok === false }"
            >{{
          finalOutputOf(selectedLine)
            }}</pre>
            <!-- 图形结果内嵌（#22，Jupyter inline 同款）：matplotlib 走 Agg 落
                 data URL，文本/表格之外原图嵌在输出区；点击弹 mediaViewer 大图
                 （auto 面，bus 桥到 editor 层）。白底防深色主题吃掉透明图。 -->
            <div
              v-if="selectedImages.length"
              class="output-images"
            >
              <img
                v-for="(src, i) in selectedImages"
                :key="i"
                class="output-image"
                :src="src"
                alt=""
                @click="openImagePreview(src)"
              >
            </div>
          </div>
          <!-- mr 整份作业的 RunReport 卡：流式日志 + 诊断（学生行号）/ 断言 / 运行观测 / 产物 -->
          <div
            v-if="docKind === 'mr' && (mrRunning || mrReport)"
            class="mr-report"
          >
            <div
              class="mr-report-head"
              :class="mrRunning ? 'busy' : mrReport && mrReport.ok ? 'ok' : 'fail'"
            >
              {{
                mrRunning
                  ? t('execPanel.jobRunning')
                  : mrReport && mrReport.ok
                    ? t('execPanel.reportOk')
                    : t('execPanel.reportFail')
              }}
              <template v-if="mrReport">
                · {{ t('execPanel.reportStage') }}: {{ mrReport.stage }}
              </template>
            </div>
            <pre
              v-if="mrOutput"
              class="output-text mr-stream"
            >{{ mrOutput }}</pre>
            <template v-if="mrReport">
              <div
                v-if="mrReport.diagnostics.length"
                class="mr-section"
              >
                <div class="mr-section-title">
                  {{ t('execPanel.reportDiagnostics') }} ({{ mrReport.diagnostics.length }})
                </div>
                <div
                  v-for="(d, i) in mrReport.diagnostics"
                  :key="i"
                  class="mr-diag"
                  :class="d.level"
                >
                  {{ d.message }}
                </div>
              </div>
              <div
                v-if="mrReport.asserts.length"
                class="mr-section"
              >
                <div class="mr-section-title">
                  {{ t('execPanel.reportAsserts') }}
                </div>
                <div
                  v-for="(a, i) in mrReport.asserts"
                  :key="i"
                  class="mr-assert"
                >
                  <span :class="a.passed ? 'pass' : 'fail'">{{ a.passed ? '✓' : '✗' }}</span>
                  {{ a.kind }}<template v-if="a.expected">
                    · {{ a.expected }}
                  </template><template v-if="!a.passed && a.actual">
                    — {{ a.actual }}
                  </template>
                </div>
              </div>
              <div
                v-if="mrReport.job"
                class="mr-section"
              >
                <div class="mr-section-title">
                  {{ t('execPanel.reportJob') }}
                </div>
                <div class="mr-kv">
                  <span>{{ t('execPanel.reportDuration') }}</span><span>{{ jobDurationLabel }}</span>
                </div>
                <div
                  v-if="mrReport.job.code !== undefined && mrReport.job.code !== null"
                  class="mr-kv"
                >
                  <span>{{ t('execPanel.reportExit') }}</span><span>{{ mrReport.job.code }}</span>
                </div>
                <div
                  v-if="counterSummary"
                  class="mr-kv"
                >
                  <span>{{ t('execPanel.reportCounters') }}</span><span>{{ counterSummary }}</span>
                </div>
                <div
                  v-if="mrReport.artifacts.output || mrReport.artifacts.workdir"
                  class="mr-kv"
                >
                  <span>{{ mrReport.artifacts.output ? t('execPanel.reportOutput') : t('execPanel.reportWorkdir') }}</span>
                  <span
                    class="mr-path"
                    :title="mrReport.artifacts.output || mrReport.artifacts.workdir"
                  >{{ mrReport.artifacts.output || mrReport.artifacts.workdir }}</span>
                </div>
              </div>
            </template>
          </div>
        </div>
      </template>
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
import { useTeachingStore } from '@/store/teaching'
import type {
  Md2rBlockInfo,
  Md2rEvent,
  Md2rRunReport,
  Md2rRunResult,
  Md2rStepRecord
} from '@shared/types/mdcode2run'
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

// —— mr 体裁（kind="mr"）：文档级整份作业运行（docs/MR-EXECUTOR.md）——
const docKind = ref<'mr' | 'generic'>('generic')
const mrRunning = ref(false)
/** 整份作业的流式日志（family="hadoop" 的 chunk，独立于块级 outputs 表）。 */
const mrOutput = ref('')
/** RunReport 终值（runDocument invoke 返回；事件 done 只负责熄运行灯）。 */
const mrReport = ref<Md2rRunReport | null>(null)

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
    docKind.value = parsed.kind
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
  // mr 整份作业事件（family="hadoop"，line=-1）：走独立通道，不进块级输出表
  if (event.type !== 'job-done' && event.family === 'hadoop') {
    if (event.type === 'started') {
      mrRunning.value = true
      mrOutput.value = ''
    } else if (event.type === 'chunk') {
      const next = mrOutput.value + event.text
      mrOutput.value = next.length > MAX_OUTPUT_CHARS ? next.slice(-MAX_OUTPUT_CHARS) : next
    } else if (event.type === 'done') {
      mrRunning.value = false
    }
    return
  }
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

// —— mr 整份作业（runDocument）：终值 = invoke 返回的 RunReport ——
const runWholeJob = async (): Promise<void> => {
  const path = docPath.value
  if (!path || mrRunning.value) return
  mrRunning.value = true
  mrOutput.value = ''
  mrReport.value = null
  try {
    mrReport.value = await window.mdcode2run.runDocument({
      docPath: path,
      md: props.markdown
    })
  } catch (err) {
    mrReport.value = {
      ok: false,
      stage: 'spec',
      id: '',
      scaffold: '',
      mode: '',
      diagnostics: [
        {
          level: 'error',
          kind: 'ipc',
          message: err instanceof Error ? err.message : String(err)
        }
      ],
      asserts: [],
      job: null,
      artifacts: {}
    }
  } finally {
    mrRunning.value = false
    // 整份作业跑完：学生的 document 执行记录已落 sidecar → 步骤 executed 状态刷新
    void refreshLabSteps()
  }
}

// —— E4 教学模式（本 tab 是已落盘的实验副本）——
const teachingStore = useTeachingStore()
/** 只在「当前打开的文件 = 已落盘实验副本」时激活；stepOrder 为空（讲义/无步骤）不亮。 */
const lab = computed(() => {
  const opened = teachingStore.openedLab
  return opened && opened.docPath === docPath.value && opened.stepOrder.length > 0 ? opened : null
})
/** stepsOf 的步骤事实（顺序=教师 trace 序，executed=学生本地记录）。 */
const labSteps = ref<Md2rStepRecord[]>([])
const labBusy = ref(false)
const labMsg = ref('')
const labMsgErr = ref(false)

const refreshLabSteps = async (): Promise<void> => {
  if (!lab.value || !docPath.value) {
    labSteps.value = []
    return
  }
  try {
    const r = await window.mdcode2run.steps({ docPath: docPath.value, md: props.markdown })
    labSteps.value = r.steps
  } catch {
    labSteps.value = []
  }
}

watch(
  () => [props.markdown, docPath.value, lab.value?.docPath] as const,
  () => {
    void refreshLabSteps()
  },
  { immediate: true }
)

const setLabMsg = (msg: string, isErr = false): void => {
  labMsg.value = msg
  labMsgErr.value = isErr
}

const stepNameOf = (key: string): string =>
  labSteps.value.find((s) => s.stepId === key)?.name || key

/** 状态徽章：服务端受理记录优先（✓/✗），其次本地执行事实（已执行未提交）。 */
const stepStatusOf = (key: string): string => {
  const submitted = teachingStore.labSubmitted[key]
  if (submitted?.passed) return t('teachingLab.passed')
  if (submitted) return t('teachingLab.rejected')
  const step = labSteps.value.find((s) => s.stepId === key)
  return step?.executed ? t('teachingLab.executed') : ''
}

/** 回填写入文件后重开 tab：磁盘内容变了，内存 tab 必须重载才所见即所得。 */
const reopenLabDoc = (): void => {
  const path = docPath.value
  const current = editorStore.currentFile
  if (current && current.pathname === path) editorStore.FORCE_CLOSE_TAB(current)
  window.electron.ipcRenderer.send('mt::open-file', path)
}

const backfillAll = async (): Promise<void> => {
  const path = docPath.value
  if (!lab.value || !path || labBusy.value) return
  labBusy.value = true
  setLabMsg('')
  try {
    const r = await window.mdcode2run.fillTodos({ docPath: path, md: props.markdown })
    if (r.problems.length) setLabMsg(r.problems.join('；'), true)
    if (r.md !== props.markdown) {
      const written = await window.teachingWorkspace.labDocWrite({ docPath: path, content: r.md })
      if (written) {
        reopenLabDoc()
        setLabMsg(t('teachingLab.backfillDone'))
      } else {
        setLabMsg(t('teachingLab.writeDenied'), true)
      }
    } else if (!r.problems.length) {
      setLabMsg(t('teachingLab.backfillNone'))
    }
  } catch (err) {
    setLabMsg(err instanceof Error ? err.message : String(err), true)
  } finally {
    labBusy.value = false
  }
}

const submitStep = async (key: string): Promise<void> => {
  const path = docPath.value
  if (!lab.value || !path || labBusy.value) return
  labBusy.value = true
  setLabMsg('')
  try {
    const guard = await window.mdcode2run.guard({ docPath: path, md: props.markdown, stepId: key })
    if (guard.problems.length) {
      setLabMsg(guard.problems.join('；'), true)
      return
    }
    if (guard.blocked) {
      setLabMsg(
        guard.diagnostics.map((d) => d.message).join('；') || t('teachingLab.blocked'),
        true
      )
      return
    }
    // 实训/实验（本地判）：project 档步级 executed/asserts 不归属（document 不落
    // 步），通过事实取「最近一次整份运行成功」——没跑过就不准提交（防手填不跑
    // 就交）。作业/考试（服务端判）：裁决权在服务端（证据比对），客户端只装配
    // 证据 = 本步 check-code class= 对应类的回填代码（fences 元数据自 lab/copy，
    // 无 runOk 硬门槛——守卫与整份编译天然互斥，逐步写类时整份编译必失败）。
    const isServerJudge = lab.value.purpose === 3 || lab.value.purpose === 5
    if (!isServerJudge && mrReport.value?.ok !== true) {
      setLabMsg(t('teachingLab.needRun'), true)
      return
    }
    let evidence: string | undefined
    if (isServerJudge) {
      const fence = (lab.value.fences ?? []).find(
        (f) => f.stepKey === key && f.verb === 'check-code' && f.class
      )
      if (fence?.class) {
        const r = await window.mdcode2run.fillTodos({ docPath: path, md: props.markdown })
        const fill = r.fills.find((f) => f.todo?.class === fence.class && f.code)
        if (!fill?.code) {
          setLabMsg(t('teachingLab.evidenceMissing') + ` · ${fence.class}`, true)
          return
        }
        evidence = fill.code
      }
    }
    const msg = await teachingStore.submitLabStep(key, { passed: true, executed: true }, evidence)
    setLabMsg(msg || `${t('teachingLab.submitted')} · ${key}`, !!msg)
    void refreshLabSteps()
  } catch (err) {
    setLabMsg(err instanceof Error ? err.message : String(err), true)
  } finally {
    labBusy.value = false
  }
}

const submitReport = async (): Promise<void> => {
  const path = docPath.value
  if (!lab.value || !path || labBusy.value) return
  labBusy.value = true
  setLabMsg('')
  try {
    const r = await window.mdcode2run.labReport({ docPath: path, md: props.markdown })
    const msg = await teachingStore.submitLabReport(r.md)
    setLabMsg(msg || t('teachingLab.reportDone'), !!msg)
  } catch (err) {
    setLabMsg(err instanceof Error ? err.message : String(err), true)
  } finally {
    labBusy.value = false
  }
}

const jobDurationLabel = computed(() => {
  const ms = mrReport.value?.job?.durationMs ?? 0
  return `${Math.round(ms / 100) / 10}s`
})

/** counters 摘要：只取枚举名键（全大写/下划线/冒号）——引擎同时存了展示名与组名别名，
 *  都列会同一计数出现两遍；没有枚举名形态时退回全部非组名键。截前 6 条。 */
const counterSummary = computed(() => {
  const c = mrReport.value?.job?.counters ?? {}
  const plain = Object.keys(c).filter((k) => !k.includes('/'))
  const enums = plain.filter((k) => /^[A-Z0-9_:]+$/.test(k))
  const keys = enums.length ? enums : plain
  const head = keys
    .slice(0, 6)
    .map((k) => `${k}=${c[k]}`)
    .join(' · ')
  return keys.length > 6 ? `${head} …` : head
})

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

/** 选中块的图形结果（matplotlib 图捕获，PNG data URL）——inline 渲染进输出区。 */
const selectedImages = computed<string[]>(() => {
  if (selectedLine.value === null) return []
  return resultOf(selectedLine.value)?.images ?? []
})

/** 点击内嵌图弹大图（#22 auto 面）：MediaViewer 挂在 editor 层，走 bus。 */
const openImagePreview = (src: string): void => {
  bus.emit('exec-image-preview', src)
}

/** 块徽章：mr 片段显示阶段名（作业管线的消费单位），其余显示语言标签。 */
const badgeOf = (b: Md2rBlockInfo): string => {
  if (b.stage) return b.stage
  if (b.mrOwned && b.job) return 'job'
  return b.lang || b.role
}

/** 不可跑块的原因（悬停提示）：标注问题 + 角色 + 语言支持，三选一拼。 */
const reasonOf = (b: Md2rBlockInfo): string => {
  if (b.runnable) return t('execPanel.run')
  const bits = [...b.problems]
  if (b.mrOwned) bits.push(t('execPanel.mrOwned'))
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

// —— 会话族（2026-11-24 shell/powershell 会话化后与 java/python 同列）——
const SESSION_FAMILIES = new Set(['java', 'python', 'shell', 'powershell'])

const selectedIsSessionFamily = computed(() => {
  const b = blocks.value.find((x) => x.line === selectedLine.value)
  return !!b && SESSION_FAMILIES.has(b.family ?? '')
})

/** 会话 HUD：`会话 ran/total · 过期N`；一次性族无 HUD 字段，返回空串不渲染。 */
const sessionHudOf = (line: number): string => {
  const s = resultOf(line)?.session
  if (!s || typeof s.ran !== 'number' || typeof s.total !== 'number') return ''
  const base = t('execPanel.sessionOf', { ran: s.ran, total: s.total })
  return s.stale ? `${base} · ${t('execPanel.sessionStale', { n: s.stale })}` : base
}

const resetting = ref(false)

/** ⟳ 销毁所选块的族会话：跨块状态归零，清本行结果（重跑即从干净会话开始）。 */
const resetSelected = async (): Promise<void> => {
  const path = docPath.value
  if (!path || selectedLine.value === null || resetting.value) return
  resetting.value = true
  try {
    await window.mdcode2run.resetSession({
      docPath: path,
      md: props.markdown,
      line: selectedLine.value
    })
    delete results.value[selectedLine.value]
  } catch {
    // 引擎侧 locate 失败等——静默，块的运行错误自会在下次运行时显形
  } finally {
    resetting.value = false
  }
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

// —— query 原型的表格视图（rows 契约：{columns, cells}；类型层只标 unknown）——
/** 表格单次渲染上限：超出走 tfoot 汇总行（放映浮层 20 行同思路，编辑区放宽些）。 */
const TABLE_MAX_ROWS = 100

interface QueryRows {
  columns: string[]
  cells: string[][]
}

/** 块行号 → 结构化行列；仅 ok 且 rows 形状成立时返回（text/none/失败均 null）。 */
const rowsOf = (line: number): QueryRows | null => {
  const r = results.value[line]
  if (!r || !r.ok) return null
  const rows = r.rows as unknown
  if (
    !rows ||
    typeof rows !== 'object' ||
    !Array.isArray((rows as QueryRows).columns) ||
    !(rows as QueryRows).columns.length
  ) {
    return null
  }
  return rows as QueryRows
}

/** 输出区视图偏好：query 块默认表格；纯文本块表格分支不生效，自动落回原文。 */
const outputView = ref<'table' | 'raw'>('table')
const selectedRows = computed<QueryRows | null>(() =>
  selectedLine.value === null ? null : rowsOf(selectedLine.value)
)
const showTable = computed(() => outputView.value === 'table' && !!selectedRows.value)
const shownRows = computed(() => selectedRows.value?.cells.slice(0, TABLE_MAX_ROWS) ?? [])
/** 表格态下的弱化尾注（beeline 的 N rows selected / 第二结果集等 stdout 剩余）。 */
const tableNote = computed<string>(() => {
  if (!selectedRows.value || selectedLine.value === null) return ''
  return (results.value[selectedLine.value]?.text ?? '').trim()
})

onMounted(() => {
  offEvent = window.mdcode2run.onEvent(handleEvent)
  bus.on('mdcode2run-run-fence', handleFenceRunRequest)
  bus.on('mdcode2run-select-fence', handleFenceSelectRequest)
  // 挂载即对账：存量高度可能来自更大的窗口/屏幕（上次会话存的值），首帧把它
  // 收回上限内——不然面板底会压到状态栏上。等一拍再量，让 flex 先算完。
  void nextTick(() => requestAnimationFrame(reclampHeight))
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

// 存量高度对账：只在面板 DOM 真实存在时量。关闭态 .exec-panel 根本不渲染
// （panelEl 为 null），maxHeight() 只能兜底返回下限——照算会把用户存的高度
// 清成下限，所以关闭态不动，等下次展开（open watch）再对账。
const reclampHeight = (): void => {
  if (!panelEl.value) return
  if (panel.height > maxHeight()) panel.setHeight(maxHeight(), true)
}

// 窗口变矮：把高度收回上限内（不然编辑区被挤没），顺带丢掉失效的还原值
const onWindowResize = (): void => {
  reclampHeight()
}

// 关闭态不量高度；展开后布局稳定了补一次对账（窗口在面板关着时缩过水）。
watch(
  () => panel.open,
  (open) => {
    if (open) void nextTick(() => requestAnimationFrame(reclampHeight))
  }
)

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
  /* 注意：这里不能 overflow:hidden——resizer 热区上半截刻意伸进编辑区（top:-3px），
     剪了就没法从编辑区侧拖动。硬剪裁放 .panel-body（两栏内容全在它里面）。 */
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
  /* 硬剪裁：面板内容任何情况下都画不出面板盒——压不到状态栏上（2026-11-14
     输出越界事故）。盒子尺寸本身由高度对账保证（挂载/展开/resize 三处钳制）；
     resizer 与关闭钮是本层兄弟节点，不受剪裁影响。 */
  overflow: hidden;
}

/* 两栏：左 = 块表（mr 文档多一条作业入口条），右 = 输出 / RunReport 卡 */
.left-col {
  flex: none;
  width: 340px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--editorColor10);
}

.right-col {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.block-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
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
  /* 自 containment：表格 / 原文都只能在输出区内部滚，绘制逃不出这层
     （flex 链上 column 项的 min-height:auto 会被大表格顶破，必须显式归零）。 */
  min-height: 0;
  overflow: hidden;
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
  padding: 1px 8px;
  border: 1px solid var(--editorColor20);
  border-radius: 3px;
  background: transparent;
  color: var(--editorColor);
  cursor: pointer;
}

.session-hud {
  color: var(--editorColor50);
  font-size: 11px;
}

.reset-btn {
  padding: 1px 7px;
  border: 1px solid var(--editorColor20);
  border-radius: 3px;
  background: transparent;
  color: var(--editorColor);
  cursor: pointer;
  font-size: 12px;
  line-height: 1.4;
}

.reset-btn:hover {
  border-color: var(--editorColor40);
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

/* 图形结果（#22，Jupyter inline 同款）：matplotlib 落 data URL，限宽随面板、
   白底衬透明/白底图（深色主题不吃图），点击弹 mediaViewer 大图。 */
.output-images {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 6px 10px;
}

.output-image {
  max-width: 100%;
  background: #ffffff;
  border: 1px solid var(--editorColor10, #e0e0e0);
  border-radius: 4px;
  cursor: zoom-in;
}

.toolbar-flex {
  flex: 1 1 0;
}

/* 表格/原文 双态开关（query 原型带 rows 时出现）：分段钮样式，主题色勾选态。 */
.view-toggle {
  display: flex;
}

.view-btn {
  padding: 1px 10px;
  border: 1px solid var(--editorColor20);
  background: transparent;
  color: var(--editorColor50);
  cursor: pointer;
}

.view-btn:first-child {
  border-radius: 3px 0 0 3px;
}

.view-btn:last-child {
  border-radius: 0 3px 3px 0;
  margin-left: -1px;
}

.view-btn.on {
  position: relative;
  z-index: 1;
  color: var(--themeColor);
  border-color: var(--themeColor);
}

.output-table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 6px 10px;
  user-select: text;
}

.output-table {
  border-collapse: collapse;
  font-size: 12px;
}

.output-table th,
.output-table td {
  border: 1px solid var(--editorColor20);
  padding: 2px 10px;
  text-align: left;
  vertical-align: top;
  white-space: pre-wrap;
}

.output-table th {
  background: var(--editorColor10);
  color: var(--editorColor);
}

.output-table td {
  color: var(--editorColor80);
}

.output-table td.null {
  color: var(--editorColor30);
  font-style: italic;
}

.output-table tfoot td {
  color: var(--editorColor50);
  font-style: italic;
}

/* 表格态的弱化尾注（N rows selected / 第二结果集）：与表格同卷滚动。 */
.output-table-note {
  margin: 6px 0 0;
  color: var(--editorColor40);
  font-size: 12px;
  white-space: pre-wrap;
}

/* ── mr 体裁：文档级整份作业入口 + RunReport 卡（docs/MR-EXECUTOR.md）── */
.job-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 34px 4px 10px;
  border-bottom: 1px solid var(--editorColor10);
}

.job-run-btn {
  padding: 2px 12px;
  border: none;
  border-radius: 3px;
  background: var(--themeColor);
  color: var(--editorBgColor);
  cursor: pointer;
}

.job-run-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.job-hint {
  color: var(--editorColor50);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mr-report {
  flex: 1;
  min-width: 0;
  overflow: auto;
  border-top: 1px solid var(--editorColor10);
}

.mr-report-head {
  padding: 4px 10px;
  font-weight: 600;
}

.mr-report-head.busy {
  color: var(--warningColor, #e6a23c);
}

.mr-report-head.ok {
  color: var(--successColor, #6ad08b);
}

.mr-report-head.fail {
  color: var(--dangerColor, #eb4d4d);
}

.mr-stream {
  max-height: 30vh;
  padding: 4px 10px;
}

.mr-section {
  padding: 4px 10px;
  border-top: 1px dashed var(--editorColor10);
}

.mr-section-title {
  color: var(--editorColor50);
  margin-bottom: 2px;
}

.mr-diag {
  white-space: pre-wrap;
  word-break: break-all;
  user-select: text;
}

.mr-diag.error {
  color: var(--dangerColor, #eb4d4d);
}

.mr-diag.warn {
  color: var(--warningColor, #e6a23c);
}

.mr-assert .pass {
  color: var(--successColor, #6ad08b);
}

.mr-assert .fail {
  color: var(--dangerColor, #eb4d4d);
}

.mr-kv {
  display: flex;
  gap: 8px;
}

.mr-kv > span:first-child {
  color: var(--editorColor50);
  flex: none;
}

.mr-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  user-select: text;
}

.output-text.error {
  color: var(--dangerColor, #eb4d4d);
}

/* —— E4 教学模式：锁序步骤卡 + 回填/报告（JetBrains 式贴在块清单上方） —— */
.lab-bar {
  border-top: 1px solid var(--editorColor10, rgba(128, 128, 128, 0.2));
  border-bottom: 1px solid var(--editorColor10, rgba(128, 128, 128, 0.2));
  padding: 4px 8px 6px;
  background: var(--editorBgColor, transparent);
}

.lab-steps {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 132px;
  overflow-y: auto;
}

.lab-step {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  line-height: 20px;
}

.lab-step-idx {
  width: 16px;
  text-align: center;
  color: var(--editorColor60);
  font-family: var(--editorFontMono, monospace);
}

.lab-step-name {
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--editorColor80);
}

.lab-step-point {
  color: var(--editorColor60);
  font-family: var(--editorFontMono, monospace);
}

.lab-step-status {
  min-width: 56px;
  text-align: center;
  color: var(--editorColor60);
}

.lab-step.passed .lab-step-status {
  color: var(--successColor, #27ae60);
}

.lab-step.failed .lab-step-status {
  color: var(--dangerColor, #eb4d4d);
}

.lab-step-submit {
  border: none;
  background: transparent;
  color: var(--editorColor80);
  cursor: pointer;
  padding: 0 6px;
  line-height: 18px;
  border-radius: 3px;
}

.lab-step-submit:hover:not(:disabled) {
  background: var(--editorColor10, rgba(128, 128, 128, 0.15));
}

.lab-step-submit:disabled {
  opacity: 0.5;
  cursor: default;
}

.lab-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}

.lab-btn {
  border: 1px solid var(--editorColor30, rgba(128, 128, 128, 0.3));
  background: transparent;
  color: var(--editorColor80);
  cursor: pointer;
  font-size: 12px;
  line-height: 20px;
  padding: 0 10px;
  border-radius: 3px;
}

.lab-btn:hover:not(:disabled) {
  background: var(--editorColor10, rgba(128, 128, 128, 0.15));
}

.lab-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.lab-msg {
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 12px;
  color: var(--editorColor60);
}

.lab-msg.err {
  color: var(--dangerColor, #eb4d4d);
}
</style>
