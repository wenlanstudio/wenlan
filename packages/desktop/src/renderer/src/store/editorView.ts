import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { hasColumnMarkers } from '@muyajs/core'
import { usePreferencesStore } from './preferences'
import { useEditorStore } from './editor'

/**
 * 视图模型 v2（docs/design/view-model.md）：文示二支 × 四叶选择。
 *
 * 文（编辑态，muya）= { page 全文, column 分栏 }；示（展示态，md2slides iframe）
 * = { slide 幻灯片列表, present 放映 }。分界 = 引擎边界 = 可编辑性边界。
 *
 * 选择模型：四叶平铺常驻，点击选中至多两叶——一叶全屏、两叶分屏（左右按
 * LEAVES 顺序，文左示右、细左粗右自动成立）；已两叶再点第三叶替换最早选中
 * （FIFO）；不可选到零。表/图/本是顶级正交视图，与四叶互斥（挂起不丢）。
 */

export type Leaf = 'page' | 'column' | 'slide' | 'present'

/** 按钮顺序 = 分屏左右顺序（细→粗、文→示）。 */
export const LEAVES = ['page', 'column', 'slide', 'present'] as const

export type TopView = 'table' | 'figure' | 'code'

export const TOP_VIEWS = ['table', 'figure', 'code'] as const

export type SliderDuty = 'page-width' | 'slide-zoom' | 'none'

const DEFAULT_RATIO = 0.45 // 右 pane 初始占比

const clampRatio = (value: unknown): number => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(0.8, Math.max(0.2, n)) : DEFAULT_RATIO
}

const isLeaf = (v: unknown): v is Leaf => (LEAVES as readonly string[]).includes(v as Leaf)
const isTopView = (v: unknown): v is TopView => (TOP_VIEWS as readonly string[]).includes(v as TopView)

interface EditorViewState {
  /** 选择顺序（FIFO 换选依据），1..2 项。 */
  leaves: Leaf[]
  topView: TopView | null
  /** 分屏右 pane 宽度占比（0.2–0.8）。 */
  rightRatio: number
}

const STORAGE_KEY = 'marktext-editor-view'

/**
 * 旧持久化形状（v1：mainView/subView[/previewForm]）→ v2 选择模型。
 * 迁移映射：document/page→[page]、document/column→[column]、document/slide（P4
 * 语义卡，已废）→[page]、present/slides→[present]、table/figure/code→topView；
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
    leaves.push(subRaw === 'column' ? 'column' : 'page')
  } else if (main === 'present') {
    leaves.push('present')
  } else if (isTopView(main)) {
    topView = main
    leaves.push('page')
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
      const leaves = obj.leaves.filter(isLeaf)
      if (leaves.length >= 1) {
        return {
          leaves: leaves.slice(-2),
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

  const leafSelection = ref<Leaf[]>(persisted?.leaves ?? ['page'])
  const topView = ref<TopView | null>(persisted?.topView ?? null)
  const rightRatio = ref<number>(persisted?.rightRatio ?? DEFAULT_RATIO)

  // §4.4 #5 — the Column view only makes sense for a document that actually
  // has a `begin` marker. Drives the leaf button filter and the automatic
  // fullscreen fallback back to `page`.
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

  /** 编辑器透镜：table 是顶级透镜；page/column 作全屏或分屏左 pane 时活。 */
  const editorLens = computed<'page' | 'column' | 'table' | null>(() => {
    if (topView.value === 'table') return 'table'
    if (topView.value !== null) return null
    return orderedLeaves.value.find((l) => l === 'page' || l === 'column') ?? null
  })

  const isSourceMode = computed<boolean>(() => topView.value === 'code')

  /** 滑块职责：分屏时一律收起（宽度控制被分割条吸收），单视图按叶/顶级视图定。 */
  const sliderDuty = computed<SliderDuty>(() => {
    if (isSplit.value) return 'none'
    if (topView.value === 'table' || topView.value === 'figure' || topView.value === 'code') {
      return 'page-width'
    }
    const leaf = activeLeaf.value
    if (leaf === 'present') return 'none'
    if (leaf === 'slide') return 'slide-zoom' // 页缩放，待接线
    return 'page-width'
  })

  /** 光标指示（行:列）只在有活编辑面时才有意义。 */
  const isEditorVisible = computed<boolean>(
    () => editorLens.value === 'page' || editorLens.value === 'column' || isSourceMode.value
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

  /** 点叶：切换选中。已两叶再点第三叶 → 替换最早选中（FIFO）；不可选到零。 */
  const toggleLeaf = (leaf: Leaf): void => {
    topView.value = null // 顶级视图与四叶互斥：点叶即回叶
    const sel = leafSelection.value
    const next = sel.includes(leaf)
      ? sel.length > 1
        ? sel.filter((l) => l !== leaf)
        : sel // 最后一片点不掉
      : sel.length < 2
        ? [...sel, leaf]
        : [sel[1]!, leaf]
    if (next !== sel) {
      leafSelection.value = next
      persist()
      syncToPreferences()
    }
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

  /** 回编辑面（放映/列表全屏态 Esc 用）：文侧 page 全屏。 */
  const focusEditor = (): void => {
    topView.value = null
    leafSelection.value = ['page']
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

  // §4.4 #5 — fullscreen column falls back to page when the document has no
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
        leafSelection.value = ['page']
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
