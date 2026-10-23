import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { hasColumnMarkers } from '@muyajs/core'
import { usePreferencesStore } from './preferences'
import { useEditorStore } from './editor'

export type MainView = 'word' | 'ppt' | 'excel' | 'dev'

export const MAIN_VIEWS: MainView[] = ['word', 'ppt', 'excel', 'dev']

export const MAIN_VIEW_META: Record<
  MainView,
  { label: string; icon: string; subViews: { key: string; label: string }[] }
> = {
  word: {
    label: 'Word',
    icon: 'W',
    subViews: [
      { key: 'page', label: 'Page' },
      { key: 'columns', label: 'Columns' }
    ]
  },
  ppt: {
    label: 'PPT',
    icon: 'P',
    subViews: [
      { key: 'slide', label: 'Slide' },
      { key: 'present', label: 'Present' }
    ]
  },
  excel: {
    label: 'Excel',
    icon: 'E',
    subViews: [{ key: 'sheet', label: 'Sheet' }]
  },
  dev: {
    label: 'Dev',
    icon: 'D',
    subViews: [{ key: 'source', label: 'Source' }]
  }
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

const loadPersisted = (): EditorViewState | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (
      parsed &&
      typeof parsed === 'object' &&
      'mainView' in parsed &&
      'subView' in parsed &&
      MAIN_VIEWS.includes((parsed as EditorViewState).mainView)
    ) {
      const state = parsed as EditorViewState
      const main = state.mainView
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

  const mainView = ref<MainView>(persisted?.mainView ?? 'word')
  const subView = ref<string>(persisted?.subView ?? 'page')

  const isSourceMode = computed<boolean>(
    () => mainView.value === 'dev' && subView.value === 'source'
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
    if (mainView.value === 'dev') {
      setMainView('word', 'page')
    } else {
      setMainView('dev', 'source')
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
        mainView.value = 'dev'
        subView.value = 'source'
        persist()
      } else if (!isSource && currentlySource) {
        mainView.value = 'word'
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
    hasColumns,
    setMainView,
    setSubView,
    toggleSourceMode
  }
})
