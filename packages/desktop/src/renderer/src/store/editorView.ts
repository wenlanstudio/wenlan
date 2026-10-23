import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { hasColumnMarkers } from '@muyajs/core'
import { usePreferencesStore } from './preferences'
import { useEditorStore } from './editor'

export type MainView = 'document' | 'slides' | 'table' | 'figure' | 'code'

export const MAIN_VIEWS: MainView[] = ['document', 'slides', 'table', 'figure', 'code']

/**
 * What the shared dock slider (bottom-right) adjusts in a sub-view (TODO1 #5):
 * - `page-width` — the centered content column's width (document/page,
 *   document/columns, table/all, figure/gallery, code/source)
 * - `slide-zoom` — the slide's scale (slides/slide)
 * - `none` — the view has no use for the slider (slides/present, figure/focus)
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
  document: {
    label: 'Document',
    icon: '文',
    subViews: [
      { key: 'page', label: 'Page', slider: 'page-width', implemented: true },
      { key: 'columns', label: 'Columns', slider: 'page-width', implemented: true }
    ]
  },
  slides: {
    label: 'Slides',
    icon: '示',
    subViews: [
      { key: 'slide', label: 'Slide', slider: 'slide-zoom', implemented: false },
      { key: 'present', label: 'Present', slider: 'none', implemented: false }
    ]
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
}

const STORAGE_KEY = 'marktext-editor-view'

// The old `reading` sub-view was replaced by `columns` (§1.5). A persisted
// value that no longer matches any sub-view used to leave the editor area
// empty, because `loadPersisted` only validated `mainView`.
const RENAMED_SUB_VIEWS: Record<string, string> = { reading: 'columns' }

// The Word/PPT/Excel/Dev views were renamed to Document/Slides/Table/Code;
// `figure` is new and has no persisted history. `loadPersisted` validates
// against `MAIN_VIEWS`, so an unmigrated key would silently reset the user's
// last-used view — migrate before that check, not after.
const RENAMED_MAIN_VIEWS: Record<string, MainView> = {
  word: 'document',
  ppt: 'slides',
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

      return { mainView: main, subView: sub }
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
      JSON.stringify({ mainView: mainView.value, subView: subView.value })
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
      if (subView.value === 'columns' && !hasColumns.value) {
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
    setMainView,
    setSubView,
    toggleSourceMode
  }
})
