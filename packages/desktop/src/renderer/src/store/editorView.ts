import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { hasColumnMarkers } from '@muyajs/core'
import { usePreferencesStore } from './preferences'
import { useEditorStore } from './editor'

export type MainView = 'document' | 'present' | 'table' | 'figure' | 'code'

export const MAIN_VIEWS: MainView[] = ['document', 'present', 'table', 'figure', 'code']

// ——— 形态模型（docs/design/view-model.md）—————————————————————————————
// 文档的四个形态按离散度单调递增：page → column → slide → present。
// 形态名单数（形态 vs 块树结构：column 透镜 / `columns` 块）；present 是
// md2slides 的成片，不是文档的片，因此它是独立主视图，不在 document 之下。

/** 离散度梯子：合法分屏对 = 序上严格递增的有序对（左编辑右投影）。 */
export const FORM_LADDER = ['page', 'column', 'slide', 'present'] as const

/** 可编辑形态（muya 透镜）。slide 为 P4，占位未实现。 */
export type EditForm = 'page' | 'column' | 'slide'

/** 投影形态（只读预览面）。column/slide 为 P3/P4。 */
export type PreviewForm = 'column' | 'slide' | 'present'

const PREVIEW_FORMS: readonly PreviewForm[] = ['column', 'slide', 'present']

/** [edit, preview] 是否合法：离散度必须严格递增（“离散先后关系”）。 */
export const canPair = (edit: EditForm, preview: PreviewForm): boolean =>
  FORM_LADDER.indexOf(preview) > FORM_LADDER.indexOf(edit)

/**
 * What the shared dock slider (bottom-right) adjusts in a sub-view (TODO1 #5):
 * - `page-width` — the centered content column's width (document/page,
 *   document/column, table/all, figure/gallery, code/source)
 * - `slide-zoom` — the slide's scale (document/slide)
 * - `none` — the view has no use for the slider (present, figure/focus)
 */
export type SliderDuty = 'page-width' | 'slide-zoom' | 'none'

export interface SubViewMeta {
  key: string
  label: string
  slider: SliderDuty
  /** False while the sub-view is still a "coming soon" placeholder. */
  implemented: boolean
}

// Icons are single CJK glyphs used as graphic symbols in every locale — they
// are deliberately not translated. Each names what its view shows: 文 the
// document text, 示 presentation (陈列以展示), 表 tables, 图 figures (images and
// diagrams alike), and 本 the markdown source — the root the other views are
// rendered from, never a view of its own. `label` stays English on purpose: it
// is only the tooltip, and these words are widely understood.
export const MAIN_VIEW_META: Record<MainView, { label: string; icon: string; subViews: SubViewMeta[] }> = {
  // 文 = 文档的可编辑形态（透镜）：页 / 栏 / 片。slide = 语义卡透镜（P4a，
  // util/slidePages.ts，与 md2slides sectionize 同族规则）。
  document: {
    label: 'Document',
    icon: '文',
    subViews: [
      { key: 'page', label: 'Page', slider: 'page-width', implemented: true },
      { key: 'column', label: 'Column', slider: 'page-width', implemented: true },
      { key: 'slide', label: 'Slide', slider: 'slide-zoom', implemented: true }
    ]
  },
  // 示 = md2slides 成片（slidesPresent.vue：本地服务 + deck-full 页面，M1 落地）。
  // present 不是文档的片，是另一渲染器的产物，故独立成主视图（形态模型 §1）。
  present: {
    label: 'Present',
    icon: '示',
    subViews: [{ key: 'present', label: 'Present', slider: 'none', implemented: true }]
  },
  table: {
    label: 'Tables',
    icon: '表',
    subViews: [
      { key: 'all', label: 'All', slider: 'page-width', implemented: true }
    ]
  },
  figure: {
    label: 'Figure',
    icon: '图',
    subViews: [
      { key: 'gallery', label: 'Gallery', slider: 'page-width', implemented: false },
      { key: 'focus', label: 'Focus', slider: 'none', implemented: false }
    ]
  },
  code: {
    label: 'Code',
    icon: '本',
    subViews: [
      { key: 'source', label: 'Source', slider: 'page-width', implemented: true }
    ]
  }
}

/**
 * Resolve the dock slider's duty for a (main, sub) pair. A placeholder
 * sub-view reports `none` — its duty activates by flipping `implemented`
 * when the view ships.
 */
export const resolveSliderDuty = (main: MainView, sub: string): SliderDuty => {
  const meta = MAIN_VIEW_META[main].subViews.find((s) => s.key === sub)
  return meta?.implemented ? meta.slider : 'none'
}

interface EditorViewState {
  mainView: MainView
  subView: string
  /** 形态模型 P2 起可能缺席（旧持久化数据）。 */
  previewForm?: PreviewForm | null
}

const STORAGE_KEY = 'marktext-editor-view'

// The old `reading` sub-view was replaced by `column` (§1.5, later renamed
// from plural `columns` to the singular form name). A persisted value that no
// longer matches any sub-view used to leave the editor area empty, because
// `loadPersisted` only validated `mainView`.
const RENAMED_SUB_VIEWS: Record<string, string> = { reading: 'column', columns: 'column' }

// The Word/PPT/Excel/Dev views were renamed to Document/Present/Table/Code
// (`figure` is new); the view-model refactor additionally folded the old
// `slides` main view into `present` (slide moved under document as a form).
// `loadPersisted` validates against `MAIN_VIEWS`, so an unmigrated key would
// silently reset the user's last-used view — migrate before that check.
const RENAMED_MAIN_VIEWS: Record<string, MainView> = {
  word: 'document',
  ppt: 'present',
  slides: 'present',
  excel: 'table',
  dev: 'code'
}

const loadPersisted = (): EditorViewState | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (
      parsed &&
      typeof parsed === 'object' &&
      'mainView' in parsed &&
      'subView' in parsed
    ) {
      const state = parsed as EditorViewState
      const main = RENAMED_MAIN_VIEWS[state.mainView] ?? state.mainView
      if (!MAIN_VIEWS.includes(main)) return null

      let sub = state.subView

      if (typeof sub === 'string') {
        // Migrate a renamed key, then fall back to the default when the value
        // still is not a real sub-view of this main view.
        sub = RENAMED_SUB_VIEWS[sub] ?? sub
        if (!MAIN_VIEW_META[main].subViews.some((s) => s.key === sub)) {
          sub = MAIN_VIEW_META[main].subViews[0]!.key
        }
      } else {
        sub = MAIN_VIEW_META[main].subViews[0]!.key
      }

      // 持久化里的 previewForm 来自不可信 JSON（类型断言会撒谎），按白名单校验。
      const previewRaw: unknown = state.previewForm
      const previewForm = PREVIEW_FORMS.find((f) => f === previewRaw) ?? null

      return { mainView: main, subView: sub, previewForm }
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

  const mainView = ref<MainView>(persisted?.mainView ?? 'document')
  const subView = ref<string>(persisted?.subView ?? 'page')

  // ——— 形态模型：分屏预览（左编辑右投影）—————————————————————
  // previewForm 是用户意图（想看哪个形态的投影）；activePreview 是当下
  // 真正显示的投影——左形态不在梯子上合法位置时挂起而不丢弃，切回
  // document 形态后自动恢复。
  const previewForm = ref<PreviewForm | null>(persisted?.previewForm ?? null)

  const isSourceMode = computed<boolean>(
    () => mainView.value === 'code' && subView.value === 'source'
  )

  // §4.4 #5 — the Columns view only makes sense for a document that actually
  // has a `begin` marker. Drives the sub-view button filter and the automatic
  // fallback back to `page`.
  const currentMarkdown = computed<string>(
    () => (editorStore.currentFile as { markdown?: string } | null)?.markdown ?? ''
  )

  const hasColumns = computed<boolean>(() =>
    currentMarkdown.value ? hasColumnMarkers(currentMarkdown.value) : false
  )

  const currentMeta = computed(() => MAIN_VIEW_META[mainView.value])

  const availableSubViews = computed(() => currentMeta.value.subViews)

  // 当前可编辑形态：只有 document 的三个形态透镜是编辑面（slide 未实现时
  // 占位，editForm 仍报它——合法对检查会保证投影只能比它更离散）。
  const editForm = computed<EditForm | null>(() => {
    if (mainView.value !== 'document') return null
    const sub = subView.value
    return sub === 'page' || sub === 'column' || sub === 'slide' ? (sub as EditForm) : null
  })

  const activePreview = computed<PreviewForm | null>(() => {
    if (!previewForm.value || !editForm.value) return null
    return canPair(editForm.value, previewForm.value) ? previewForm.value : null
  })

  // The dock slider's meaning in the active sub-view — the single source the
  // view switcher renders from (TODO1 #5).
  const sliderDuty = computed<SliderDuty>(() =>
    resolveSliderDuty(mainView.value, subView.value)
  )

  const isSubViewValid = (main: MainView, sub: string): boolean => {
    return MAIN_VIEW_META[main].subViews.some((s) => s.key === sub)
  }

  const persist = (): void => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        mainView: mainView.value,
        subView: subView.value,
        previewForm: previewForm.value
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

  const setMainView = (view: MainView, sub?: string): void => {
    mainView.value = view
    const defaultSub = MAIN_VIEW_META[view].subViews[0]!.key
    subView.value = sub && isSubViewValid(view, sub) ? sub : defaultSub
    persist()
    syncToPreferences()
  }

  const setSubView = (sub: string): void => {
    if (isSubViewValid(mainView.value, sub)) {
      subView.value = sub
      persist()
      syncToPreferences()
    }
  }

  /** 设投影形态；null 关闭。非法对（离散度不递增）静默拒绝。 */
  const setPreview = (form: PreviewForm | null): void => {
    if (form && (!editForm.value || !canPair(editForm.value, form))) return
    if (previewForm.value !== form) {
      previewForm.value = form
      persist()
    }
  }

  /** 预览开关：当前无投影则开 present 成片，有则关。 */
  const togglePreview = (): void => {
    setPreview(activePreview.value ? null : 'present')
  }

  const toggleSourceMode = (): void => {
    if (mainView.value === 'code') {
      setMainView('document', 'page')
    } else {
      setMainView('code', 'source')
    }
  }

  // §4.4 #5 — fall back to `page` when the Columns view is active but the
  // document has no column markers. Covers both "switched to a tab without
  // markers" and "restored a persisted Columns view for a document that no
  // longer has any".
  watch(
    [hasColumns, subView],
    () => {
      if (subView.value === 'column' && !hasColumns.value) {
        subView.value = 'page'
        persist()
      }
    },
    { immediate: true }
  )

  // When preferencesStore.sourceCode changes from outside (e.g. main-process menu),
  // reconcile our state so the UI stays consistent.
  watch(
    () => preferencesStore.sourceCode,
    (isSource) => {
      const currentlySource = isSourceMode.value
      if (isSource && !currentlySource) {
        mainView.value = 'code'
        subView.value = 'source'
        persist()
      } else if (!isSource && currentlySource) {
        mainView.value = 'document'
        subView.value = 'page'
        persist()
      }
    }
  )

  return {
    mainView,
    subView,
    isSourceMode,
    currentMeta,
    availableSubViews,
    sliderDuty,
    hasColumns,
    editForm,
    previewForm,
    activePreview,
    setMainView,
    setSubView,
    setPreview,
    togglePreview,
    toggleSourceMode
  }
})
