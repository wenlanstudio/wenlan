import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { usePreferencesStore } from './preferences'

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
      { key: 'reading', label: 'Reading' }
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
      return parsed as EditorViewState
    }
  } catch {
    // ignore corrupted storage
  }
  return null
}

export const useEditorViewStore = defineStore('editorView', () => {
  const preferencesStore = usePreferencesStore()

  const persisted = loadPersisted()

  const mainView = ref<MainView>(persisted?.mainView ?? 'word')
  const subView = ref<string>(persisted?.subView ?? 'page')

  const isSourceMode = computed<boolean>(
    () => mainView.value === 'dev' && subView.value === 'source'
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
    setMainView,
    setSubView,
    toggleSourceMode
  }
})
