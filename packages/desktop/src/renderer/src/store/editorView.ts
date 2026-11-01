import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { hasColumnMarkers } from '@muyajs/core'
import { usePreferencesStore } from './preferences'
import { useEditorStore } from './editor'

/**
 * 视图模型（docs/design/view-model.md）：二组六叶选择。
 *
 * 编辑组（写作姿态，muya 进程内）= { flow 全文, column 分栏, page 逻辑页,
 * paper 纸面(A4) }；展示组（成页姿态）= { slide 页览, present 放映 }（md2slides
 * iframe）。组判据 = 姿态而非可编辑性；引擎边界（muya 四叶 │ iframe 两叶）
 * 不与刻度分隔线重合。page = 逻辑纸（连续流 + 缝叠加，M2/M3 升格为一等叶），
 * paper = 物理纸（推挤流 + 卡层）；两叶共享同一测量基座，版式基同钉纸面宽度。
 *
 * 选择模型：六叶平铺常驻（栏格随文档有无 begin 标记显隐），点击选中至多两叶
 * ——一叶全屏、两叶分屏（左右按 LEAVES 顺序，编辑左展示右、细左粗右自动
 * 成立）。配置选择式（淘宝选规格）：点一下选中、再点一下取消，搭配由用户
 * 自定；已选满两叶时第三叶点不动（先摘一片才能换）；最后一片不可摘（不可
 * 选到零）。编辑面不变量：同一时刻至多一个活编辑面——左 pane/全屏 = 活引擎，
 * 右 pane 一律只读投影。
 * 表/图/本是顶级正交视图，与六叶互斥（挂起不丢）。
 */

export type Leaf = 'flow' | 'column' | 'page' | 'paper' | 'slide' | 'present'

/** 按钮顺序 = 分屏左右顺序（细→粗、编辑左展示右）。page 逻辑页落第三位、
 *  paper 物理纸落第四位（§1/§5：页纸共享测量基座，只差渲染姿态）。 */
export const LEAVES = ['flow', 'column', 'page', 'paper', 'slide', 'present'] as const

const SHOW_LEAVES: readonly Leaf[] = ['slide', 'present']

/** paper 只与前三叶配对（§2）：纸×览/示在 v1 语义不成立——分屏要求两侧对
 *  同一文档做一致解释，而 md2slides 只服务幻灯片形态（览对 A4 文档 v1 不做、
 *  纸对幻灯片文档给不出幻灯片语义；全屏单叶不受此限），与它们相点即单选替换。 */
const isPairable = (a: Leaf, b: Leaf): boolean =>
  !(a === 'paper' && SHOW_LEAVES.includes(b)) && !(b === 'paper' && SHOW_LEAVES.includes(a))

/** 持久化净化：若成对非法（paper×示支），只留 LEAVES 序靠前者。 */
const sanitizeLeaves = (leaves: Leaf[]): Leaf[] => {
  const [a, b] = leaves
  if (a && b && !isPairable(a, b)) {
    return LEAVES.indexOf(a) <= LEAVES.indexOf(b) ? [a] : [b]
  }
  return leaves
}

export type TopView = 'table' | 'figure' | 'code'

export const TOP_VIEWS = ['table', 'figure', 'code'] as const

export type SliderDuty = 'flow-width' | 'page-zoom' | 'slide-zoom' | 'paper-zoom' | 'none'

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

/**
 * 旧持久化形状（mainView/subView 二级结构，含中间形态 previewForm）→ 四叶选择。
 * 迁移映射：document/page→[page]、document/column→[column]、document/slide（P4
 * 已废的 slide 编辑视图）→[page]、present/slides→[present]、table/figure/code→topView；
 * previewForm==='present' → 追加 present 成对。更早的 word/ppt/excel/dev
 * 改名一并收口。
 */
const migrateLegacy = (parsed: Record<string, unknown>): EditorViewState | null => {
  const mainRaw = parsed.mainView
  if (typeof mainRaw !== 'string') return null
  const RENAMED_MAIN: Record<string, string> = {
    word: 'document',
    ppt: 'present',
    slides: 'present',
    excel: 'table',
    dev: 'code'
  }
  const main = RENAMED_MAIN[mainRaw] ?? mainRaw

  const RENAMED_SUB: Record<string, string> = { reading: 'column', columns: 'column' }
  const subRaw = typeof parsed.subView === 'string' ? (RENAMED_SUB[parsed.subView] ?? parsed.subView) : ''

  const leaves: Leaf[] = []
  let topView: TopView | null = null

  if (main === 'document') {
    leaves.push(subRaw === 'column' ? 'column' : 'flow')
  } else if (main === 'present') {
    leaves.push('present')
  } else if (isTopView(main)) {
    topView = main
    leaves.push('flow')
  } else {
    return null
  }
  if (parsed.previewForm === 'present' && !leaves.includes('present')) leaves.push('present')

  return { leaves, topView, rightRatio: clampRatio(parsed.rightRatio) }
}

const loadPersisted = (): EditorViewState | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const obj = parsed as Record<string, unknown>

    if (Array.isArray(obj.leaves)) {
      // 早期四叶形状的 page 键 → flow（给将来 Word 式 A4「纸面」叶让位）
      const leaves = obj.leaves.map((l) => (l === 'page' ? 'flow' : l)).filter(isLeaf)
      if (leaves.length >= 1) {
        return {
          leaves: sanitizeLeaves(leaves.slice(-2)),
          topView: isTopView(obj.topView) ? obj.topView : null,
          rightRatio: clampRatio(obj.rightRatio)
        }
      }
      return null
    }
    return migrateLegacy(obj)
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

  /** 编辑器透镜：table 是顶级透镜；flow/column/page/paper 作全屏或分屏左
   *  pane 时活。page/paper 共享纸面版式基（版式基钉死纸面宽度，§5）。 */
  const editorLens = computed<'flow' | 'column' | 'page' | 'paper' | 'table' | null>(() => {
    if (topView.value === 'table') return 'table'
    if (topView.value !== null) return null
    return (
      orderedLeaves.value.find(
        (l) => l === 'flow' || l === 'column' || l === 'page' || l === 'paper'
      ) ?? null
    )
  })

  const isSourceMode = computed<boolean>(() => topView.value === 'code')

  /** 滑块职责：分屏时一律收起（宽度控制被分割条吸收），单视图按叶/顶级视图定。 */
  const sliderDuty = computed<SliderDuty>(() => {
    if (isSplit.value) return 'none'
    if (topView.value === 'table' || topView.value === 'figure' || topView.value === 'code') {
      return 'flow-width'
    }
    const leaf = activeLeaf.value
    if (leaf === 'present') return 'none'
    if (leaf === 'slide') return 'slide-zoom' // 页缩放，待接线
    // 页/纸共享测量基座：版式基钉死纸面宽度，缩放是刚需（§5 交互入位）。
    if (leaf === 'page') return 'page-zoom' // 页缩放，待接线（与 paper-zoom 同族）
    if (leaf === 'paper') return 'paper-zoom' // 页缩放，待接线（§5）
    return 'flow-width'
  })

  /** 光标指示（行:列）只在有活编辑面时才有意义。 */
  const isEditorVisible = computed<boolean>(
    () =>
      editorLens.value === 'flow' ||
      editorLens.value === 'column' ||
      editorLens.value === 'page' ||
      editorLens.value === 'paper' ||
      isSourceMode.value
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

  /** 点叶：配置选择式——点一下选中，再点一下取消；选满两叶后第三叶点不动
   *  （先摘一片才能换）；最后一片不可摘。 */
  const toggleLeaf = (leaf: Leaf): void => {
    topView.value = null // 顶级视图与四叶互斥：点叶即回叶
    const sel = leafSelection.value
    if (sel.includes(leaf)) {
      if (sel.length === 1) return // 最后一片点不掉
      leafSelection.value = sel.filter((l) => l !== leaf)
    } else {
      if (sel.length >= 2) return // 已选满：先摘一片才能换（用户自己搭配）
      // paper×示支不可配对：相点即单选替换（§5 交互）——"点啥进啥"的直感
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
    toggleLeaf,
    removeLeaf,
    toggleTopView,
    focusEditor,
    setRightRatio,
    toggleSourceMode
  }
})
