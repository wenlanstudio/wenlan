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
        {{ contractError ? '文稿不符合 HTML 放映稿契约 v1' : '幻灯片构建失败' }}
      </p>
      <div
        v-if="contractIssues.length"
        class="error-issues"
      >
        <div
          v-for="(issue, n) in contractIssues"
          :key="`${issue.rule}-${issue.code}-${n}`"
          class="error-issue"
          :class="{ warn: issue.severity === 'warn' }"
        >
          <div class="issue-head">
            <span class="issue-rule">{{ issue.rule }} / {{ issue.code }}</span>
            <span
              v-if="(issue.count ?? 0) > 1"
              class="issue-count"
            >×{{ issue.count }}</span>
            <span class="issue-where">{{ issue.where }}</span>
          </div>
          <p class="issue-message">
            {{ issue.message }}
          </p>
          <p class="issue-fix">
            → {{ issue.fix }}
          </p>
        </div>
      </div>
      <pre
        v-else
        class="error-detail"
      >{{ error }}</pre>
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
    <!-- 图表渲染进度遮罩：首帧（total===0）居中卡片 + 暖色进度条；
         rebuild（total>0）顶部细线，不遮挡旧画面。ready/error 即隐藏。 -->
    <div
      v-if="progress || (total === 0 && !error)"
      class="deck-progress-overlay"
      :class="{ 'first-build': total === 0 }"
    >
      <div
        v-if="total === 0"
        class="progress-card"
      >
        <div class="progress-label">
          {{ progressLabel }}
        </div>
        <template v-if="progress?.total">
          <div class="progress-bar">
            <div
              class="progress-fill"
              :style="{ width: progressPct + '%' }"
            />
          </div>
          <div class="progress-count">
            {{ progress.done }} / {{ progress.total }}
          </div>
        </template>
      </div>
      <div
        v-else
        class="progress-line"
      >
        <div
          class="progress-fill"
          :style="{ width: progressPct + '%' }"
        />
      </div>
    </div>
    <div
      v-if="missingWarn"
      class="deck-missing-warn"
      :title="missingWarn"
    >
      {{ missingWarn }}
    </div>
    <!-- ADR-24 封面叠码：课表自动开房命中时，第 1 页叠二维码供大屏学生扫。 -->
    <div
      v-if="coverQr"
      class="deck-qr"
    >
      <img
        v-if="coverQr.dataUrl"
        class="deck-qr-img"
        :src="coverQr.dataUrl"
        alt="学生扫码加入课堂"
      >
      <div
        v-else
        class="deck-qr-fallback"
        :title="coverQr.joinUrl"
      >
        {{ coverQr.error || '二维码生成中…' }}
      </div>
      <div class="deck-qr-meta">
        <div
          v-if="coverQr.courseName"
          class="deck-qr-course"
        >
          {{ coverQr.courseName }}
          <span
            v-if="!coverQr.scheduled"
            style="margin-left: 6px; font-size: 11px; color: #f0a020"
          >临时课</span>
        </div>
        <div class="deck-qr-class">
          {{ classroom.className }}<template v-if="coverQr.location">
            · {{ coverQr.location }}
          </template>
        </div>
      </div>
      <button
        class="deck-qr-hide"
        title="隐藏二维码（重开课自动恢复）"
        @click="qrHidden = true"
      >
        ×
      </button>
    </div>
    <!-- 教师已登录但无发布物（或多班命中）：第 1 页轻量提示，放映照常 -->
    <div
      v-if="roomNotice"
      class="deck-room-notice"
    >
      <div class="deck-room-notice-text">
        {{ roomNotice }}
      </div>
      <div class="deck-room-notice-sub">
        放映不受影响，可继续使用一文多览
      </div>
      <button
        class="deck-room-notice-close"
        title="关闭提示"
        @click="roomNoticeDismissed = true"
      >
        ×
      </button>
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
        <template v-if="!isHtml">
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
import QRCode from 'qrcode'
import { storeToRefs } from 'pinia'
import { diagramTypeOfLang } from '@muyajs/core'
import type { Md2rEvent } from '@shared/types/mdcode2run'
import { DEFAULT_PLANTUML_SERVER } from '@shared/types/preferences'
import { useEditorStore } from '@/store/editor'
import { useEditorViewStore } from '@/store/editorView'
import { usePreferencesStore } from '@/store/preferences'
import { useTeachingStore } from '@/store/teaching'
import { followTargetOf, shouldSnapBack } from '@/util/classroomFollow'
import { POSITION_SYNC_ENABLED, matchesCurrentMarkdown, onDocAnchorChange, writeDocAnchor } from '@/util/docAnchor'
import { renderGraphvizToDataUrl, renderPlantumlToDataUrl, renderMatplotlibToDataUrl } from '@/util/md2slidesDiagram'

/**
 * 渲染进程不能引 common/filesystem/paths（会拽入 node 的 fs/fs-extra，浏览器端
 * 打包 externalize 即崩）。只判路径末段扩展名，纯字符串，不依赖 window.path mock。
 */
const isHtmlSlidePath = (pathname: string): boolean => {
  const name = String(pathname || '').split(/[\\/]/).pop() ?? ''
  const dot = name.lastIndexOf('.')
  if (dot < 0) return false
  const ext = name.slice(dot + 1).toLowerCase()
  return ext === 'html' || ext === 'htm'
}

/**
 * front-matter 标量读取（与 md2slides core/parse/frontMatter.js 的 deckMeta 同口径，
 * 只认文档最顶上的 --- 块）。这里只需 stepLines 一个布尔键，不值得拖 md2slides 进来。
 */
const frontScalarOf = (md: string, key: string): string | null => {
  const m = /^[ \t]*---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(md ?? '')
  if (!m) return null
  const hit = new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, 'm').exec(m[1])
  return hit ? hit[1] : null
}

/** 代码块行粒度遍历（front-matter stepLines: true，缺省 false）。 */
const stepLines = computed(() => {
  const raw = frontScalarOf(props.markdown, 'stepLines')
  return raw != null && raw.toLowerCase() === 'true'
})

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
const teachingStore = useTeachingStore()

// ── ADR-24 封面叠码：课表命中自动开房后，第 1 页叠学生入会二维码 ──
const qrHidden = ref(false)
const qrDataUrl = ref('')
const qrError = ref('')
// room 在此处声明，watch 的源必须用它——不能用下面 storeToRefs 解构出来的
// classroom：那个 const 在本段之后才初始化，getter 会在 immediate 首跑时撞 TDZ，
// 生产构建里 Vue 只 console.error 不抛，结果浮层照常渲染但 watcher 永久失效、码恒空。
const room = computed(() => teachingStore.classroom)

const coverQr = computed(() => {
  const auto = room.value.auto
  if (!auto?.joinUrl || qrHidden.value || index.value !== 1) return null
  return {
    dataUrl: qrDataUrl.value,
    joinUrl: auto.joinUrl,
    error: qrError.value,
    courseName: auto.courseName,
    location: auto.location,
    scheduled: auto.scheduled
  }
})
// 无发布物 / 多班命中的提示：只在封面页、无二维码时显示，可关闭，不阻断放映
const roomNoticeDismissed = ref(false)
const roomNotice = computed(() => {
  if (roomNoticeDismissed.value || index.value !== 1 || coverQr.value) return ''
  return room.value.autoNotice || ''
})

/**
 * 二维码 data URL：canvas 路径优先，失败回退纯字符串 SVG（不依赖 canvas / GPU）。
 * 两条都失败时抛出带原始原因的错误，由调用方显示出来，绝不再静默留白。
 */
const buildQrDataUrl = async(url: string): Promise<string> => {
  try {
    return await QRCode.toDataURL(url, { width: 256, margin: 1 })
  } catch (pngErr) {
    try {
      const svg = await QRCode.toString(url, { type: 'svg', width: 256, margin: 1 })
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    } catch (svgErr) {
      throw new Error(`canvas: ${String(pngErr)} / svg: ${String(svgErr)}`, { cause: svgErr })
    }
  }
}

watch(
  () => room.value.auto?.joinUrl,
  (url) => {
    qrError.value = ''
    if (!url) {
      qrDataUrl.value = ''
      return
    }
    // 换会话/重开课时自动恢复被 × 隐藏的码（与隐藏按钮的提示一致）
    qrHidden.value = false
    void buildQrDataUrl(url)
      .then((dataUrl) => {
        // 只在 URL 没变时回填，避免竞态把旧码写进新会话
        if (room.value.auto?.joinUrl === url) {
          qrDataUrl.value = dataUrl
          qrError.value = ''
        }
      })
      .catch((err) => {
        console.error('[deckPane] 二维码生成失败:', err)
        qrDataUrl.value = ''
        qrError.value = '二维码生成失败（详见控制台）'
      })
  },
  { immediate: true }
)
const { isSplit, presentExclusive, presentImmersive } = storeToRefs(editorViewStore)
const { classroom } = storeToRefs(teachingStore)

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

/** 契约校验拒绝时的结构化诊断（core/htmlDeck/validate.js 的 Issue[]）。 */
interface ContractIssue {
  rule: string
  code: string
  severity: 'error' | 'warn'
  where: string
  message: string
  fix: string
  count?: number
}
const contractIssues = ref<ContractIssue[]>([])
const contractError = computed(() => contractIssues.value.length > 0)
const status = ref('正在启动放映服务…')
const index = ref(0)
const total = ref(0)
const warnings = ref(0)
const exporting = ref(false)

/**
 * 图表渲染进度（md2s:progress）。
 * - phase:'assets'   图表运行时注入完毕，接下来逐张渲染
 * - phase:'diagrams' done/total/type 标当前进度与图表类型；缓存命中也算一次 done
 * ready/error 即终态 → null。首帧（total===0）用居中卡片，rebuild 用顶部细线。
 */
const progress = ref<{ phase: string; done?: number; total?: number; type?: string } | null>(null)

const DIAGRAM_TYPE_LABELS: Record<string, string> = {
  mermaid: '流程图',
  graphviz: '拓扑图',
  plantuml: 'UML',
  matplotlib: '数据图',
  echarts: '图表',
  svg: '矢量图',
  'vega-lite': '可视化',
  flowchart: '流程图',
  sequence: '时序图',
  wavedrom: '波形图',
  chart: '图表',
  abc: '乐谱',
  drawio: '流程图',
}

const progressLabel = computed(() => {
  const p = progress.value
  if (!p) return status.value
  if (p.phase === 'assets') return '正在准备图表运行时…'
  if (p.phase === 'diagrams') {
    const label = p.type ? DIAGRAM_TYPE_LABELS[p.type] ?? p.type : ''
    return p.total ? `正在渲染${label ? ' ' + label : '图表'}…` : '正在渲染图表…'
  }
  return '正在构建幻灯片…'
})

const progressPct = computed(() => {
  const p = progress.value
  if (!p || !p.total || !p.done) return 0
  return Math.min(100, Math.round((p.done / p.total) * 100))
})

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

/** 文档是第三方 HTML 放映稿（html/htm）：交给 deck 页面按 player.js 契约播放，
 *  不走 muya、不改写源码（docs/design/html-slide.md）。 */
const isHtml = computed(() => isHtmlSlidePath(pathname.value))

// 画布尺寸不再在渲染进程解析：契约 v1 的 `wenlan-deck:canvas` meta 由宿主在
// 校验阶段（core/htmlDeck/validate.js）解析，随 md2s:ready 回传。单一真源，避免
// 两处正则漂移。

/** 发给 deck 页面（跨源，目标源钉死为服务源）。 */
const postToDeck = (msg: Record<string, unknown>): void => {
  deckFrame.value?.contentWindow?.postMessage(msg, origin.value ?? '*')
}

// —— 放映发题·页面注入模式（2026-11-16）：按钮/浮层都在 deck 页面内（exec-present），
// 宿主只当数据桥：capability（教师进房开页面按钮）与 quiz-state（实况/揭晓投影）两条推送。
// 实况数据全部来自 teaching store（opened 广播的 classroom.question 为本班显示序选项，
// 与学生看到的一致）；倒计时以服务端 closeAt 为准，页面只递减展示，宿主状态帧一到即覆盖。
// 注意：本段必须位于 postToDeck 定义之后（此前版本插在前面撞 TDZ，deckPane 挂载即炸）。
const quizCapability = computed(() =>
  teachingStore.classroom.role === 'host' &&
  teachingStore.classroom.sessionId != null &&
  teachingStore.classroom.connected
)
const pushQuizCapability = (): void => {
  postToDeck({ type: 'md2s:quiz-capability', enabled: quizCapability.value })
}
const pushQuizState = (): void => {
  const q = teachingStore.classroom.question
  const race = teachingStore.race
  const phase = race.error ? 'error' : race.reveal ? 'revealed' : race.openId != null ? 'running' : 'idle'
  // closeAt 是服务端权威；旧帧没有 closeAt 时才退回本地 openedAt 推算。
  const countdownBase = race.closeAt || (race.openedAt && race.limitSec ? race.openedAt + race.limitSec * 1000 : 0)
  const remainingMs = race.openId != null && countdownBase
    ? Math.max(0, countdownBase - Date.now())
    : 0
  postToDeck({
    type: 'md2s:quiz-state',
    phase,
    questionKey: q?.questionKey ?? null,
    stem: q?.stem ?? null,
    options: q?.options ?? null,
    limitSec: race.limitSec,
    remainingSec: Math.ceil(remainingMs / 1000),
    answered: race.answered,
    // 在线人数在 joined 广播里也可能只更新 classroom（尚未发题时 race.online 还是 0）。
    // 取 race 优先、classroom 兜底，浮层一打开就能看到真实在线数。
    online: race.online || teachingStore.classroom.online || 0,
    reveal: race.reveal
      ? {
          answer: race.reveal.answer,
          distribution: race.reveal.distribution,
          fastest: race.reveal.fastest ?? null,
          leaderboard: race.reveal.leaderboard
        }
      : null,
    error: race.error || null
  })
}
watch(quizCapability, (enabled) => {
  pushQuizCapability()
  if (enabled) {
    // 预拉本发布物题列表：页面「发题」按钮可能先于任何面板点击出现
    teachingStore.loadRaceQuestions()
  } else {
    // 退房/下课：撤页面按钮并收浮层态
    pushQuizState()
  }
})
watch(
  () => [
    teachingStore.race.openId,
    teachingStore.race.openedAt,
    teachingStore.race.closeAt,
    teachingStore.race.limitSec,
    teachingStore.race.answered,
    teachingStore.race.online,
    teachingStore.race.reveal,
    teachingStore.race.error,
    teachingStore.classroom.question,
    teachingStore.classroom.online
  ],
  () => {
    if (quizCapability.value) pushQuizState()
  }
)

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
    mdDir: mdDir.value,
    ...(isHtml.value
      ? {
          // 第三方 HTML：宿主按契约 v1 校验后提取 #deck 子树注入；不合规会结构化拒绝。
          html: props.markdown
        }
      : { md: props.markdown }),
    runOpts: {
      view: props.leaf === 'slide' ? 'list' : 'present',
      // 代码块行粒度遍历（front-matter stepLines: true）：页面侧 player 逐行拆步。
      stepLines: stepLines.value,
      // drawio 围栏的 embed 服务（deck 页面自己渲染 drawio 时用，与编辑器预览同一偏好）。
      drawioServer: preferencesStore.drawioServer || undefined,
      ...(startIndex !== undefined ? { startIndex } : {})
    }
  })
}

// —— 课堂跟随（学生端 M2b）——
// deck 页面与本组件跨源，能直调 player.go 的只有页面侧的 exec-present.js，
// 所以跟随只有一条消息 md2s:follow；判定（进没进会话、角色、锁不锁）抽在
// util/classroomFollow 里单测。教师端虽然也 join 房间（要上报页码），但 role=host
// 时判定恒给「不跟随」，老师翻页不会被自己广播的页号拉回。
const followTarget = computed(() =>
  followTargetOf({
    sessionId: classroom.value.sessionId,
    page: classroom.value.page,
    followLocked: classroom.value.followLocked,
    role: classroom.value.role
  })
)

/** 上次发 follow 的时刻：md2s:change 回弹要一个冷却窗口，否则会抖成死循环。 */
let followSentAt = 0

const sendFollow = (): void => {
  // 只对放映（present）有意义：slide 是整堆物理页的列表态，没有"当前页"。
  if (props.leaf !== 'present') return
  followSentAt = Date.now()
  postToDeck({
    type: 'md2s:follow',
    page: followTarget.value.page,
    locked: followTarget.value.locked
  })
}

watch([() => followTarget.value.page, () => followTarget.value.locked], () => sendFollow())

// —— 点击驱动同步（§6.2 降级 2026-11-21，仅 slide 列表态）——滚动不再驱动
// 同步；只消费**光标行变化**（文/本落光标，离散触发）→ md2s:locate 让 deck
// 列表滚到该行位所在页的页内对应位置（页面侧按页行域插值）。deck 里**点击
// 某页** → locate-up(click) 回来 → 发锚 origin=reverse 让文/栏对齐（onMessage）。
if (props.leaf === 'slide') {
  // 只认**新的点击序号**（同 leafProjection）：合并写残留的旧 cursorLine
  // 帧（文滚动/对齐回声）一律忽略——否则 deck 被拽回文旧光标位。
  let lastCursorSeq: number | null = null
  const offDeckAnchor = onDocAnchorChange((anchor) => {
    if (!anchor || !POSITION_SYNC_ENABLED || !matchesCurrentMarkdown(props.markdown ?? '')) return
    if (anchor.cursorSeq == null || anchor.cursorSeq === lastCursorSeq) return
    lastCursorSeq = anchor.cursorSeq
    if (anchor.cursorLine == null) return
    postToDeck({ type: 'md2s:locate', line: anchor.cursorLine + (anchor.cursorFrac ?? 0) })
  })
  onBeforeUnmount(() => offDeckAnchor())
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

/**
 * 围栏体正文键（▶ 连接用）：与引擎 parseFences 的体提取同构——开启行缩进在体内
 * 剥离、闭合/未闭合的体区间不同（闭合 end 指向闭合围栏下一行，未闭合 end = 总行
 * 数且体含末行）。角色/体裁等语义一律以引擎 parse 为准，这里只产 join 键：
 * deck 页面的 pre 正文是 md2slides 逐字渲染的围栏体，与原始 md 的这一段全等
 * （分页续片是它的整行子串）。
 */
const fenceBodyOf = (mdLines: string[], line: number, end: number): string => {
  const open = /^(\s{0,3})(`{3,}|~{3,})/.exec(mdLines[line] ?? '')
  if (!open) return ''
  const fence = open[2]
  const closeRe = new RegExp(`^\\s{0,3}${fence[0]}{${fence.length},}[ \\t]*$`)
  const closed = end - 1 > line && closeRe.test(mdLines[end - 1] ?? '')
  const last = closed ? end - 1 : end
  const indent = open[1]
  const body: string[] = []
  for (let i = line + 1; i < last; i++) {
    const l = mdLines[i] ?? ''
    body.push(indent && l.startsWith(indent) ? l.slice(indent.length) : l)
  }
  return body.join('\n')
}

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
    // blocks 行号是原始 md 的 0 基行号；deck 页面 pre 上的 data-src-start 却是
    // md2slides compose 后文本的行号（front-matter 被剥掉提前、分号段展开推后），
    // 两套坐标系有 front-matter 就对不上（#18：▶ 挂隔壁围栏、引擎跑错块）。
    // 所以块里带上围栏体正文 code，页面侧改按内容连接，行号只作兜底与消歧。
    const mdLines = props.markdown.split(/\r?\n/)
    const blocks = runnable.map(b => {
      return {
        line: b.line,
        end: b.end,
        runnable: b.runnable,
        lang: b.lang,
        family: b.family,
        job: b.job,
        code: fenceBodyOf(mdLines, b.line, b.end)
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
  lineOffset?: number
}): Promise<void> => {
  const reqId = String(data.reqId ?? '')
  const line = Number(data.line)
  const lineOffset = data.lineOffset == null ? undefined : Number(data.lineOffset)
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
    // 放映态（老师讲台）：真执行、共享会话状态，但不落执行记录（src="present" 不记账）。
    // 学生评判链读的是文视图 ▶ 的记录，放映不该污染它。
    // lineOffset（块内 0 基行号）非空 = 逐行执行（会话族），否则整块执行。
    const result = await window.mdcode2run.run({
      docPath,
      md: props.markdown,
      line,
      ...(lineOffset !== undefined ? { lineOffset } : {}),
      src: 'present',
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

/** 图表托渲染：deck 页面画不了的几类，本进程离屏出位图。 */
const onRpc = async (data: { id: number; diagramType: string; source: string }): Promise<void> => {
  try {
    const dataUrl =
      data.diagramType === 'plantuml'
        ? await renderPlantumlToDataUrl(data.source, DEFAULT_PLANTUML_SERVER)
        : data.diagramType === 'matplotlib'
          ? await renderMatplotlibToDataUrl(data.source)
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
  contractIssues.value = []
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
      progress.value = null
      sendBuild()
      break
    case 'md2s:locate-up': {
      if (!POSITION_SYNC_ENABLED) break
      // 点击驱动（§6.2 降级）：仅消费页面侧**点击某页**的上报（click 标记；
      // 滚动上报已随降级移除）→ 发锚 origin=reverse 让文/栏对齐到该页行位。
      const line = Number(data.line)
      if (data.click && Number.isFinite(line) && line > 0) {
        // 清残留证据（topBlock/text 是文/滚动的旧值，合并写不清会让
        // scrollViewToAnchorIn 的 text 校验否决正确目标块、退 text 桥滚回
        // 旧位置——「点览文不动」的根因）。deck 只知道行号，别无证据。
        writeDocAnchor({ topLine: line, topFrac: 0, topBlock: undefined, text: undefined, origin: 'reverse', source: 'deck' })
      }
      break
    }
    case 'md2s:ready':
      error.value = ''
      contractIssues.value = []
      status.value = ''
      progress.value = null
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
      // 第三方 HTML 放映稿无文览源码，没有可跑代码块，跳过 ▶ 下发。
      if (!isHtml.value) void sendExecCapability()
      // 发题按钮能力必须在此补推：watch(quizCapability) 非 immediate，若 ready 前
      // capability 已 true（挂载时登录态已恢复 / autoStart 已自动开房），watch 不会
      // 二次触发，而重建后的 exec-present 是全新实例（内存 quizEnabled 复位 false）
      // → 永远收不到推送 → 放映页一个发题按钮都不出现。与执行能力同在 ready 下发。
      pushQuizCapability()
      // 同一 watch 非 immediate 也漏了题列表预拉：按钮出来了但 race.questions 空，
      // 点下去报「题目不在本发布物的题列表」。capability 已 true 时在此补一次（幂等）。
      if (quizCapability.value) {
        teachingStore.loadRaceQuestions()
        // 断线重进/恢复已发题房间：页面重建后内存态是空的，补一次实况快照。
        pushQuizState()
      }
      // 跟随必须在 ready 之后发：重建/首帧之前 player 还不存在，消息会被丢弃。
      sendFollow()
      break
    case 'md2s:change': {
      index.value = Number(data.index) || index.value
      total.value = Number(data.total) || total.value
      // 缺口 B（2026-11-15）：deck 侧随 change 带来本页 quiz 标记 id，
      // 发题面板据此把本页题置顶。载荷缺字段（旧 deck 资源）时清空即可。
      teachingStore.setPageQuizKeys(
        Array.isArray((data as { quizKeys?: unknown }).quizKeys)
          ? ((data as { quizKeys: unknown[] }).quizKeys.filter(
              (k): k is string => typeof k === 'string'
            ) as string[])
          : []
      )
      // 教师端上课：翻到哪页就把哪页报给服务端（内部按页号去重，只在 host 角色下发）。
      // 必须在回弹判定之前——老师翻页是「源」，回弹只对学生成立。
      teachingStore.reportPage(index.value)
      // 锁定跟随：学生自己翻走了就拉回老师那页。goto 本身也会触发一次 change
      // （此时 index === 老师页），所以只在「不等 + 过了冷却」时才回弹。
      if (
        shouldSnapBack(
          index.value,
          followTarget.value.page,
          followTarget.value.locked,
          Date.now() - followSentAt
        )
      ) {
        sendFollow()
      }
      break
    }
    case 'md2s:warn':
      // 缺图占位等非致命提示：不挡演示，常驻展示到下次构建/出错
      missingWarn.value = String(data.message ?? '')
      break
    case 'md2s:progress':
      progress.value = {
        phase: String(data.phase ?? ''),
        done: typeof data.done === 'number' ? data.done : undefined,
        total: typeof data.total === 'number' ? data.total : undefined,
        type: (data.diagramType as string) || undefined,
      }
      break
    case 'md2s:error': {
      missingWarn.value = ''
      progress.value = null
      error.value = String(data.message ?? '未知错误')
      // 契约校验拒绝：结构化逐条展示（rule/code/where/message/fix），而非单句。
      const raw = data.issues
      contractIssues.value = Array.isArray(raw)
        ? raw.filter((i): i is ContractIssue =>
            !!i && typeof i === 'object' &&
            typeof i.rule === 'string' && typeof i.message === 'string'
          )
        : []
      break
    }
    case 'md2s:rpc':
      void onRpc(data as unknown as { id: number; diagramType: string; source: string })
      break
    case 'md2s:exec':
      void onExecRequest(data as unknown as { reqId: string; line: number; lineOffset?: number })
      break
    case 'md2s:exec-stop':
      onExecStop(data as unknown as { jobId: string })
      break
    case 'md2s:exec-cancel':
      if (execReq && execReq.reqId === String(data.reqId)) execReq = null
      break
    case 'md2s:link-open': {
      // 链接浮层「↗ 浏览器打开」：iframe 内嵌不了大站时的兜底。只放行 http(s)，
      // 拦掉 javascript:/file: 等——链接文本来自讲义，不能让它借 shell 执行任意东西。
      const raw = String((data as { url?: unknown }).url ?? '').trim()
      try {
        const u = new URL(raw)
        if (u.protocol === 'https:' || u.protocol === 'http:') {
          void window.electron.shell.openExternal(u.href)
        }
      } catch { /* 非法 URL 忽略 */ }
      break
    }
    case 'md2s:export-result':
      exportWaiter?.(data)
      exportWaiter = null
      break
    case 'md2s:quiz-open': {
      // 页面内「发题」按钮：宿主执行发题，成功/失败都回推 quiz-state
      const key = String((data as { questionKey?: unknown }).questionKey ?? '')
      const q = teachingStore.race.questions.find(item => item.questionKey === key)
      if (!q) {
        teachingStore.race.error = `题目 ${key} 不在本发布物的题列表`
        pushQuizState()
        break
      }
      void teachingStore.openRaceQuestion(q).then(() => pushQuizState())
      break
    }
    case 'md2s:quiz-close':
      // 页面浮层 Esc 自行关闭的对称通知，宿主无动作（实况推送继续，供重开取数）
      break
    case 'md2s:quiz-action': {
      // 统一浮层的教师操作：文览与文枢走同一套 teaching.race.*，不再各判一次。
      const action = String((data as { action?: unknown }).action ?? '')
      if (action === 'close') {
        teachingStore.closeRaceRound()
      } else if (action === 'void') {
        teachingStore.voidRaceRound()
      } else if (action === 'reopen') {
        const key = String((data as { questionKey?: unknown }).questionKey ?? '')
        const q = teachingStore.race.questions.find(item => item.questionKey === key)
        if (q) void teachingStore.openRaceQuestion(q).then(() => pushQuizState())
      }
      break
    }
    case 'md2s:esc':
      exit()
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
  // 第三方 HTML 放映稿不经过 compose/IR，导出可编辑/图片型 PPTX 不适用。
  if (isHtml.value) {
    error.value = 'HTML 放映稿不支持导出 PPTX——它并非由文览生成，缺少排版中间表示。'
    return
  }
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
  // 课表命中自动开房（ADR-24）+ 文档对齐（2026-11-15 缺口 A）：幂等静默——
  // 未登录/未命中不打扰普通放映；当前文档有发布物时优先开该文档的房
  void teachingStore.autoStart(pathname.value)
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
.deck-qr {
  position: absolute;
  right: 16px;
  top: 16px;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.96);
  border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
}
.deck-qr-img {
  width: 112px;
  height: 112px;
  display: block;
}
/* 无图时给明确状态，别让 <img src=""> 只显示 alt 文本冒充「图层已出」 */
.deck-qr-fallback {
  flex: none;
  width: 112px;
  height: 112px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  border-radius: 6px;
  background: #f2f3f5;
  color: #666;
  font-size: 11px;
  line-height: 1.4;
  text-align: center;
  word-break: break-all;
}
.deck-qr-meta {
  max-width: 168px;
  color: #1a1a1a;
  font-size: 12px;
  line-height: 1.5;
}
.deck-qr-course {
  font-weight: 600;
}
.deck-qr-class {
  opacity: 0.75;
}
.deck-qr-hide {
  align-self: flex-start;
  border: 0;
  background: transparent;
  color: #1a1a1a;
  font-size: 14px;
  cursor: pointer;
  opacity: 0.55;
}
.deck-qr-hide:hover {
  opacity: 1;
}
/* 教师无发布物提示（封面右上角，与二维码互斥；轻量、可关、不拦截放映交互） */
.deck-room-notice {
  position: absolute;
  right: 16px;
  top: 16px;
  z-index: 30;
  max-width: 300px;
  padding: 10px 30px 10px 12px;
  border-radius: 10px;
  background: rgba(180, 83, 9, 0.9);
  color: #ffedd5;
  font-size: 12px;
  line-height: 1.6;
  user-select: none;
}
.deck-room-notice-text {
  font-weight: 600;
}
.deck-room-notice-sub {
  opacity: 0.85;
  font-size: 11px;
}
.deck-room-notice-close {
  position: absolute;
  right: 8px;
  top: 6px;
  border: 0;
  background: transparent;
  color: #ffedd5;
  font-size: 14px;
  cursor: pointer;
  opacity: 0.7;
}
.deck-room-notice-close:hover {
  opacity: 1;
}
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

/* 图表渲染进度遮罩：首帧居中卡片（#1a1a1a 与 iframe 底色一致），rebuild 顶部细线 */
.deck-progress-overlay {
  position: absolute;
  inset: 0;
  z-index: 5;
  pointer-events: none;
}
.deck-progress-overlay.first-build {
  background: #1a1a1a;
}
/* rebuild：半透明深色盖住旧画面的裸渲染跳变（不全黑，旧内容隐约可见） */
.deck-progress-overlay:not(.first-build) {
  background: rgba(26, 26, 26, 0.7);
}
.progress-card {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  color: #ccc;
  font-size: 14px;
}
.progress-label {
  margin-bottom: 12px;
  white-space: nowrap;
}
.progress-bar {
  width: 200px;
  height: 4px;
  background: #333;
  border-radius: 2px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: #e8a838;
  border-radius: 2px;
  transition: width 0.2s ease;
}
.progress-count {
  margin-top: 8px;
  font-size: 12px;
  color: #888;
}
.progress-line {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: #333;
}
.progress-line .progress-fill {
  border-radius: 0;
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

.error-issues {
  width: min(760px, 100%);
  max-height: calc(var(--workspaceHeight, 100vh) * 0.55);
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  text-align: left;
}

.error-issue {
  padding: 10px 14px;
  border-radius: 8px;
  border-left: 3px solid #f87171;
  background: rgba(255, 255, 255, 0.06);
}

.error-issue.warn {
  border-left-color: #fbbf24;
}

.issue-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 11px;
}

.issue-rule {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  color: #fca5a5;
  font-weight: 600;
}

.issue-count {
  padding: 0 6px;
  border-radius: 8px;
  background: rgba(248, 113, 113, 0.2);
  color: #fecaca;
}

.issue-where {
  color: #bbb;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  overflow-wrap: anywhere;
}

.issue-message {
  margin: 2px 0;
  font-size: 13px;
  line-height: 1.5;
  color: #eee;
}

.issue-fix {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: #a7d3b0;
  overflow-wrap: anywhere;
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
