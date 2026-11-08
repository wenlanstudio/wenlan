import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { hasColumnMarkers } from '@muyajs/core'
import { usePreferencesStore } from './preferences'
import { useEditorStore } from './editor'

/**
 * 视图模型（docs/design/view-model.md）：二组五叶选择，UI 刻度「文 栏│页 览 映」。
 *
 * 编辑组（写作姿态，muya 进程内）= { flow 全文, column 分栏 }；
 * 展示组（成页姿态）= { page 物理纸, slide 页览, present 放映 }。组判据 =
 * 姿态而非可编辑性；引擎边界（muya 活叶 │ 投影/iframe）不与刻度分隔线重合。
 * page = 只读真分片预览（A″：切行/续表真渲染，卡内编辑已随推挤退役）。
 *
 * 一文多览（view-model §6）：可编辑面只有文（flow 活引擎）与本（code 顶级
 * 视图），栏/页/览/映一律只读，想编辑即跳转文/本。
 *
 * 选择模型：五叶平铺常驻（栏格随文档有无 begin 标记显隐），点击选中至多两叶
 * ——一叶全屏、两叶分屏（左右按 LEAVES 顺序，编辑左展示右、细左粗右自动
 * 成立）。配置选择式（淘宝选规格）：点一下选中、再点一下取消，搭配由用户
 * 自定；已选满两叶时第三叶点不动（先摘一片才能换）；最后一片不可摘（不可
 * 选到零）。
 * 表/图/本是顶级正交视图，与五叶互斥（挂起不丢）。
 */

export type Leaf = 'flow' | 'column' | 'page' | 'slide' | 'present'

/** 按钮顺序 = 分屏左右顺序（细→粗、编辑左展示右）。 */
export const LEAVES = ['flow', 'column', 'page', 'slide', 'present'] as const

/** 切换器上真正出现的叶：栏格随文档有无 begin 标记显隐。
 *  收口进 store，避免 viewSwitcher 与单测各写一份过滤条件后漂移。 */
export const visibleLeafList = (hasColumns: boolean): Leaf[] =>
  LEAVES.filter((leaf) => leaf !== 'column' || hasColumns)

const SHOW_LEAVES: readonly Leaf[] = ['slide', 'present']

/** page 只与前三叶配对（§2）：页×览/映在 v1 语义不成立——分屏要求两侧对
 *  同一文档做一致解释，而 md2slides 只服务幻灯片形态（览对 A4 文档 v1 不做、
 *  页对幻灯片文档给不出幻灯片语义；全屏单叶不受此限），与它们相点即单选替换。 */
const isPairable = (a: Leaf, b: Leaf): boolean =>
  !(a === 'page' && SHOW_LEAVES.includes(b)) && !(b === 'page' && SHOW_LEAVES.includes(a))

/** 持久化净化：若成对非法（page×映支），只留 LEAVES 序靠前者。 */
const sanitizeLeaves = (leaves: Leaf[]): Leaf[] => {
  const [a, b] = leaves
  if (a && b && !isPairable(a, b)) {
    return LEAVES.indexOf(a) <= LEAVES.indexOf(b) ? [a] : [b]
  }
  return leaves
}

export type TopView = 'table' | 'figure' | 'code'

export const TOP_VIEWS = ['table', 'figure', 'code'] as const

export type SliderDuty = 'flow-width' | 'page-zoom' | 'slide-zoom' | 'none'

const DEFAULT_RATIO = 0.45 // 右 pane 初始占比

const clampRatio = (value: unknown): number => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(0.8, Math.max(0.2, n)) : DEFAULT_RATIO
}

const isLeaf = (v: unknown): v is Leaf => (LEAVES as readonly string[]).includes(v as Leaf)
const isTopView = (v: unknown): v is TopView => (TOP_VIEWS as readonly string[]).includes(v as TopView)

interface EditorViewState {
  /** 选中叶，1..2 项（顺序无关，展示按 LEAVES 序）。 */
  leaves: Leaf[]
  topView: TopView | null
  /** 分屏右 pane 宽度占比（0.2–0.8）。 */
  rightRatio: number
}

const STORAGE_KEY = 'marktext-editor-view'

const loadPersisted = (): EditorViewState | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const obj = parsed as Record<string, unknown>

    // 持久化只认现行形状（leaves 数组）；未知 key / 旧形状一律落默认 flow——
    // 不做旧数据照顾。
    if (Array.isArray(obj.leaves)) {
      const leaves = obj.leaves.filter(isLeaf)
      if (leaves.length >= 1) {
        return {
          leaves: sanitizeLeaves(leaves.slice(-2)),
          topView: isTopView(obj.topView) ? obj.topView : null,
          rightRatio: clampRatio(obj.rightRatio)
        }
      }
    }
  } catch {
    // ignore corrupted storage
  }
  return null
}

export const useEditorViewStore = defineStore('editorView', () => {
  const preferencesStore = usePreferencesStore()
  // Safe: `editor.ts` does not import this store, so there is no cycle.
  const editorStore = useEditorStore()

  const persisted = loadPersisted()

  const leafSelection = ref<Leaf[]>(persisted?.leaves ?? ['flow'])
  const topView = ref<TopView | null>(persisted?.topView ?? null)
  const rightRatio = ref<number>(persisted?.rightRatio ?? DEFAULT_RATIO)

  // §4.4 #5 — the Column view only makes sense for a document that actually
  // has a `begin` marker. Drives the leaf button filter and the automatic
  // fullscreen fallback back to `flow`.
  const currentMarkdown = computed<string>(
    () => (editorStore.currentFile as { markdown?: string } | null)?.markdown ?? ''
  )

  const hasColumns = computed<boolean>(() =>
    currentMarkdown.value ? hasColumnMarkers(currentMarkdown.value) : false
  )

  /** 分屏中的两叶按按钮序（左右 pane）。 */
  const orderedLeaves = computed<Leaf[]>(() =>
    [...leafSelection.value].sort((a, b) => LEAVES.indexOf(a) - LEAVES.indexOf(b))
  )

  const isSplit = computed<boolean>(
    () => topView.value === null && leafSelection.value.length === 2
  )

  const leftLeaf = computed<Leaf | null>(() => (isSplit.value ? orderedLeaves.value[0]! : null))
  const rightLeaf = computed<Leaf | null>(() => (isSplit.value ? orderedLeaves.value[1]! : null))

  /** 全屏态下的那片叶（分屏/顶级视图时为 null）。 */
  const activeLeaf = computed<Leaf | null>(() =>
    topView.value === null && leafSelection.value.length === 1 ? leafSelection.value[0]! : null
  )

  /** 编辑器透镜：table 是顶级透镜；flow/column/page 作全屏或分屏左
   *  pane 时活。page 在全屏态是「隐藏服务后端」——页叶的可见面是真分片
   *  投影（paperProjection，A″），活引擎退居幕后供养 bus 服务（导出/TOC），
   *  由 index.vue 以 paper-fullscreen 收起其占位。 */
  const editorLens = computed<'flow' | 'column' | 'page' | 'table' | null>(() => {
    if (topView.value === 'table') return 'table'
    if (topView.value !== null) return null
    return (
      orderedLeaves.value.find((l) => l === 'flow' || l === 'column' || l === 'page') ?? null
    )
  })

  const isSourceMode = computed<boolean>(() => topView.value === 'code')

  // ── 映面板独占态（分屏时放映占满整窗；不持久化，会话内状态） ──
  // 与 paper-fullscreen 同构：pane-left 收起不卸载（避免 muya 重建），映 pane
  // 占满。leafSelection 不动——退出独占即回到原两视图。
  const presentExclusive = ref(false)
  const setPresentExclusive = (v: boolean): void => {
    presentExclusive.value = v
  }
  // 叶选择离开映支或退出分屏时，独占态失去意义，自动复位。
  watch([leafSelection, isSplit], () => {
    if (!leafSelection.value.includes('present') || !isSplit.value) {
      presentExclusive.value = false
    }
  })

  // ── 「映」一键全屏放映（沉浸式；会话内状态，不持久化） ──
  // 点「映」不再走配置选择式，而是单叶 present + Electron 原生全屏，布局层
  // 据此隐藏侧栏/标题栏/状态栏/底部执行面板。进入前的选择与窗口全屏态由
  // 下面三个变量暂存，退出时复原。侧栏只做显示层屏蔽，不动用户偏好。
  const presentImmersive = ref(false)
  let restoreLeaves: Leaf[] | null = null
  let restoreTopView: TopView | null = null
  let restoreWindowFullScreen = false

  // ── 全屏/独占形态（布局层消费：编辑列、底部工具窗口、浮层的显隐） ──
  // 这三个判断原先各自长在 editorWithTabs/index.vue 里；底部执行面板挪到
  // app.vue 全宽层后，两处都要用同一条判据，故收口进 store，避免两份漂移。

  /** 全屏页叶（A″）：可见面 = 真分片投影，活引擎收起作隐藏服务后端。
   *  名字保留 `paper` 是因为它描述「纸面真分片投影占满」这一渲染形态，
   *  不是叶 key；配套 CSS 类同为 .paper-fullscreen。 */
  const isPaperFullscreen = computed(
    () => !isSplit.value && topView.value === null && activeLeaf.value === 'page'
  )

  /** 映面板独占：分屏 + 用户点「独占」，放映占满整窗。 */
  const isPresentFullscreen = computed(
    () => isSplit.value && presentExclusive.value && rightLeaf.value === 'present'
  )

  /** 单选映支叶全屏（slide 列表 / present 放映独占编辑区）。 */
  const isDeckFullscreen = computed(
    () =>
      !isSplit.value &&
      topView.value === null &&
      (activeLeaf.value === 'slide' || activeLeaf.value === 'present')
  )

  /** 编辑面是否可见：任一全屏/独占形态下都不是编辑场景（底部执行面板只在
   *  编辑场景露面——阅读、成页、放映时它是噪声）。 */
  const isEditingSurface = computed(
    () =>
      !isPaperFullscreen.value &&
      !isPresentFullscreen.value &&
      !isDeckFullscreen.value &&
      !presentImmersive.value
  )

  // ── 窗口全屏态（与 titleBar 同源的 IPC；右下角 dock 等浮层消费） ──
  const isWindowFullScreen = ref(false)
  let fullScreenListenerBound = false
  const initWindowFullScreen = async(): Promise<void> => {
    try {
      isWindowFullScreen.value = !!(await window.electron.windowControl.isFullScreen())
    } catch {
      // 窗口态查询是 best-effort，失败保持现值
    }
    if (fullScreenListenerBound) return
    fullScreenListenerBound = true
    window.electron.ipcRenderer.on('mt::window-enter-full-screen', () => {
      isWindowFullScreen.value = true
    })
    window.electron.ipcRenderer.on('mt::window-leave-full-screen', () => {
      isWindowFullScreen.value = false
      // OS/Chromium 在全屏下按 Esc 会先吃掉按键直接退出全屏，页面可能收不到
      // keydown；此时若仍在沉浸式放映，说明不是我们主动触发的退出 → 同步收尾。
      if (presentImmersive.value) exitPresentImmersive()
    })
  }

  /** 「码」工具窗口（底部代码执行面板）的可用判据。
   *
   *  只在「文」**独占**时可用：分屏（哪怕左叶是文）也不算——面板定位走源码行
   *  → setCursorByOffset，分屏下两侧共享同一编辑面，工具窗口横跨全宽会把两
   *  侧一起挤掉，且与另一侧的视图语义冲突。activeLeaf 只在非分屏的单叶态有值，
   *  故 `activeLeaf === 'flow'` 本身已含 topView === null。
   *
   *  单一来源给 viewSwitcher 的按钮禁用态与 execPanel 的 body 显隐共用，避免
   *  两处各写一份判据后漂移。 */
  const isCodeRunSurface = computed<boolean>(
    () => !isWindowFullScreen.value && isEditingSurface.value && activeLeaf.value === 'flow'
  )

  /** 滑块职责：分屏时一律收起（宽度控制被分割条吸收），单视图按叶/顶级视图定。 */
  const sliderDuty = computed<SliderDuty>(() => {
    if (isSplit.value) return 'none'
    if (topView.value === 'table' || topView.value === 'figure' || topView.value === 'code') {
      return 'flow-width'
    }
    const leaf = activeLeaf.value
    if (leaf === 'present') return 'none'
    if (leaf === 'slide') return 'slide-zoom' // 页缩放，待接线
    if (leaf === 'page') return 'page-zoom' // 物理纸投影页缩放，待接线（§5）
    return 'flow-width'
  })

  /** 光标指示（行:列）只在有活编辑面时才有意义（page 页叶是只读投影，不算）。 */
  const isEditorVisible = computed<boolean>(
    () =>
      editorLens.value === 'flow' || editorLens.value === 'column' || isSourceMode.value
  )

  const persist = (): void => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        leaves: leafSelection.value,
        topView: topView.value,
        rightRatio: rightRatio.value
      })
    )
  }

  const syncToPreferences = (): void => {
    const shouldBeSource = isSourceMode.value
    if (preferencesStore.sourceCode !== shouldBeSource) {
      preferencesStore.SET_MODE({ type: 'sourceCode', checked: shouldBeSource })
    }
    // Keep the main-process menu checkbox in sync.
    preferencesStore.DISPATCH_EDITOR_VIEW_STATE({ sourceCode: shouldBeSource })
  }

  /** 点「映」：记住当前选择 → 单叶放映 → 窗口原生全屏。
   *  布局层（app.vue / sideBar / editorWithTabs）按 presentImmersive 收起所有
   *  chrome；不改 layoutStore.showSideBar，退出即自动恢复侧栏。 */
  const enterPresentImmersive = (): void => {
    if (presentImmersive.value) return
    restoreLeaves = [...leafSelection.value]
    restoreTopView = topView.value
    restoreWindowFullScreen = isWindowFullScreen.value
    presentImmersive.value = true
    presentExclusive.value = false
    topView.value = null
    leafSelection.value = ['present']
    persist()
    syncToPreferences()
    try {
      window.electron.windowControl.setFullScreen(true)
    } catch {
      // 窗口全屏是 best-effort：单测 / 无主进程环境下静默降级为应用内全屏。
    }
  }

  /** 退出全屏放映，恢复进入前的视图与窗口全屏态。
   *  幂等：Esc 可能同时触发页面 keydown 与 leave-full-screen，两条都会进来。 */
  const exitPresentImmersive = (): void => {
    if (!presentImmersive.value) return
    presentImmersive.value = false // 先清，防止 leave-full-screen 回调递归
    if (!restoreWindowFullScreen) {
      try {
        window.electron.windowControl.setFullScreen(false)
      } catch {
        // 同上
      }
    }
    leafSelection.value = restoreLeaves?.length ? [...restoreLeaves] : ['flow']
    topView.value = restoreTopView
    restoreLeaves = null
    restoreTopView = null
    persist()
    syncToPreferences()
  }

  // 沉浸式下若被外部切走（菜单/命令/持久化恢复），只收起沉浸式，不覆盖新选择。
  watch(leafSelection, (sel) => {
    if (presentImmersive.value && !(sel.length === 1 && sel[0] === 'present')) {
      presentImmersive.value = false
      restoreLeaves = null
      restoreTopView = null
    }
  })

  /** 点叶：配置选择式——点一下选中，再点一下取消；选满两叶后第三叶点不动
   *  （先摘一片才能换）；最后一片不可摘。 */
  const toggleLeaf = (leaf: Leaf): void => {
    topView.value = null // 顶级视图与叶互斥：点叶即回叶
    const sel = leafSelection.value
    if (sel.includes(leaf)) {
      if (sel.length === 1) return // 最后一片点不掉
      leafSelection.value = sel.filter((l) => l !== leaf)
    } else {
      if (sel.length >= 2) return // 已选满：先摘一片才能换（用户自己搭配）
      // page×映支不可配对：相点即单选替换（§5 交互）——"点啥进啥"的直感
      const only = sel[0]
      leafSelection.value =
        sel.length === 1 && only && !isPairable(only, leaf) ? [leaf] : [...sel, leaf]
    }
    persist()
    syncToPreferences()
  }

  /** 只移除一片（面板态 Esc 用）；最后一片不可移。 */
  const removeLeaf = (leaf: Leaf): void => {
    if (leafSelection.value.length > 1 && leafSelection.value.includes(leaf)) {
      leafSelection.value = leafSelection.value.filter((l) => l !== leaf)
      persist()
      syncToPreferences()
    }
  }

  const toggleTopView = (tv: TopView): void => {
    topView.value = topView.value === tv ? null : tv
    persist()
    syncToPreferences()
  }

  /** 回编辑面（放映/列表全屏态 Esc 用）：文侧 flow 全屏。 */
  const focusEditor = (): void => {
    topView.value = null
    leafSelection.value = ['flow']
    persist()
    syncToPreferences()
  }

  /** 跳转编辑的目标态（视图模型 §6.3）：让「文」接管编辑面——清顶级视图；
   * 叶选择已含文则保持，否则左叶（全屏即唯一叶）换成文、右叶保留
   * （栏×页 → 文×页、览×映 → 文×映）。与 focusEditor 的区别：不折叠分屏。 */
  const enterFlowEditor = (): void => {
    topView.value = null
    const sel = [...leafSelection.value]
    if (!sel.includes('flow')) {
      // leafSelection 存的是点选顺序，左右按 LEAVES 序排——换左叶先排序。
      sel.sort((a, b) => LEAVES.indexOf(a) - LEAVES.indexOf(b))
      sel[0] = 'flow'
      leafSelection.value = sel
    }
    persist()
    syncToPreferences()
  }

  const setRightRatio = (ratio: number): void => {
    const next = clampRatio(ratio)
    if (next !== rightRatio.value) {
      rightRatio.value = next
      persist()
    }
  }

  const toggleSourceMode = (): void => {
    toggleTopView('code')
  }

  // §4.4 #5 — fullscreen column falls back to flow when the document has no
  // column markers (split keeps it: a projection of nothing is harmless).
  watch(
    [hasColumns, leafSelection, topView],
    () => {
      if (
        topView.value === null &&
        leafSelection.value.length === 1 &&
        leafSelection.value[0] === 'column' &&
        !hasColumns.value
      ) {
        leafSelection.value = ['flow']
        persist()
      }
    },
    { immediate: true }
  )

  // When preferencesStore.sourceCode changes from outside (e.g. main-process
  // menu), reconcile so the UI stays consistent.
  watch(
    () => preferencesStore.sourceCode,
    (isSource) => {
      const currentlySource = isSourceMode.value
      if (isSource && !currentlySource) {
        topView.value = 'code'
        persist()
      } else if (!isSource && currentlySource) {
        topView.value = null
        persist()
      }
    }
  )

  return {
    leafSelection,
    topView,
    rightRatio,
    hasColumns,
    orderedLeaves,
    isSplit,
    leftLeaf,
    rightLeaf,
    activeLeaf,
    editorLens,
    isSourceMode,
    sliderDuty,
    isEditorVisible,
    isWindowFullScreen,
    isPaperFullscreen,
    isPresentFullscreen,
    isDeckFullscreen,
    isEditingSurface,
    isCodeRunSurface,
    initWindowFullScreen,
    presentExclusive,
    setPresentExclusive,
    presentImmersive,
    enterPresentImmersive,
    exitPresentImmersive,
    toggleLeaf,
    removeLeaf,
    enterFlowEditor,
    toggleTopView,
    focusEditor,
    setRightRatio,
    toggleSourceMode
  }
})
