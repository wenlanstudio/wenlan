import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// `@/store/editorView` pulls in `@/store/editor` and `@/store/preferences`,
// which read `window.path.sep` / `window.electron.ipcRenderer` at load and at
// runtime. Stub the preload surfaces before the hoisted imports run.
vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: { sep: string }
      electron?: {
        clipboard: { writeText: (s: string) => void }
        ipcRenderer: { send: (...a: unknown[]) => void; on: (...a: unknown[]) => void }
      }
    }
  }
  w.window ??= {}
  w.window.path ??= { sep: '/' }
  w.window.electron ??= {
    clipboard: { writeText: () => {} },
    ipcRenderer: { send: () => {}, on: () => {} }
  }
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))

import {
  MAIN_VIEWS,
  MAIN_VIEW_META,
  resolveSliderDuty,
  useEditorViewStore
} from '@/store/editorView'

// TODO1 #5 — the dock slider is shared by all views; the active sub-view's
// duty decides whether it renders and what it adjusts.
describe('editorView slider duty', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('declares an explicit slider duty for every sub-view', () => {
    for (const mv of MAIN_VIEWS) {
      for (const sv of MAIN_VIEW_META[mv].subViews) {
        expect(['page-width', 'slide-zoom', 'none']).toContain(sv.slider)
        expect(typeof sv.implemented).toBe('boolean')
      }
    }
  })

  it('assigns page-width to every view that centers a content column', () => {
    expect(resolveSliderDuty('document', 'page')).toBe('page-width')
    expect(resolveSliderDuty('document', 'columns')).toBe('page-width')
    expect(resolveSliderDuty('code', 'source')).toBe('page-width')
    expect(resolveSliderDuty('table', 'all')).toBe('page-width')
  })

  it('keeps placeholder sub-views slider-less until they are implemented', () => {
    // slides/slide becomes slide-zoom and figure/gallery becomes page-width the
    // day their `implemented` flag flips — this pins the gating itself.
    expect(MAIN_VIEW_META.slides.subViews.find((s) => s.key === 'slide')).toMatchObject({
      slider: 'slide-zoom',
      implemented: false
    })
    expect(MAIN_VIEW_META.figure.subViews.find((s) => s.key === 'gallery')).toMatchObject({
      slider: 'page-width',
      implemented: false
    })
    expect(resolveSliderDuty('slides', 'slide')).toBe('none')
    expect(resolveSliderDuty('figure', 'gallery')).toBe('none')
  })

  it('present mode never has a slider, even once implemented', () => {
    expect(MAIN_VIEW_META.slides.subViews.find((s) => s.key === 'present')).toMatchObject({
      slider: 'none',
      implemented: false
    })
    expect(resolveSliderDuty('slides', 'present')).toBe('none')
  })

  it('reports none for an unknown sub-view', () => {
    expect(resolveSliderDuty('document', 'nope')).toBe('none')
  })

  it('tracks the active view: page-width everywhere a width view is active', () => {
    const store = useEditorViewStore()
    expect(store.sliderDuty).toBe('page-width') // default document/page

    store.setMainView('document', 'columns')
    expect(store.sliderDuty).toBe('page-width')

    store.setMainView('code')
    expect(store.sliderDuty).toBe('page-width')

    store.setMainView('slides')
    expect(store.sliderDuty).toBe('none')
  })
})

// The views were renamed Word/PPT/Excel/Dev → Document/Slides/Table/Code. A
// persisted pair written by the old build must still restore, or the user's
// last-used view silently resets on upgrade.
describe('editorView persisted view migration', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('migrates a persisted Word/PPT/Excel/Dev view', () => {
    localStorage.setItem(
      'marktext-editor-view',
      JSON.stringify({ mainView: 'excel', subView: 'sheet' })
    )
    const store = useEditorViewStore()
    expect(store.mainView).toBe('table')
    // `sheet` belonged to the pre-rename Excel view, which had no equivalent
    // in the table view, so the sub-view falls back to that view's default.
    expect(store.subView).toBe('all')
  })

  it('leaves an already-current persisted view untouched', () => {
    localStorage.setItem(
      'marktext-editor-view',
      JSON.stringify({ mainView: 'code', subView: 'source' })
    )
    const store = useEditorViewStore()
    expect(store.mainView).toBe('code')
    expect(store.subView).toBe('source')
  })
})
