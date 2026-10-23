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
    expect(resolveSliderDuty('word', 'page')).toBe('page-width')
    expect(resolveSliderDuty('word', 'columns')).toBe('page-width')
    expect(resolveSliderDuty('dev', 'source')).toBe('page-width')
  })

  it('keeps placeholder sub-views slider-less until they are implemented', () => {
    // ppt/slide becomes slide-zoom and excel/sheet becomes page-width the day
    // their `implemented` flag flips — this pins the gating itself.
    expect(MAIN_VIEW_META.ppt.subViews.find((s) => s.key === 'slide')).toMatchObject({
      slider: 'slide-zoom',
      implemented: false
    })
    expect(MAIN_VIEW_META.excel.subViews.find((s) => s.key === 'sheet')).toMatchObject({
      slider: 'page-width',
      implemented: false
    })
    expect(resolveSliderDuty('ppt', 'slide')).toBe('none')
    expect(resolveSliderDuty('excel', 'sheet')).toBe('none')
  })

  it('present mode never has a slider, even once implemented', () => {
    expect(MAIN_VIEW_META.ppt.subViews.find((s) => s.key === 'present')).toMatchObject({
      slider: 'none',
      implemented: false
    })
    expect(resolveSliderDuty('ppt', 'present')).toBe('none')
  })

  it('reports none for an unknown sub-view', () => {
    expect(resolveSliderDuty('word', 'nope')).toBe('none')
  })

  it('tracks the active view: page-width everywhere a width view is active', () => {
    const store = useEditorViewStore()
    expect(store.sliderDuty).toBe('page-width') // default word/page

    store.setMainView('word', 'columns')
    expect(store.sliderDuty).toBe('page-width')

    store.setMainView('dev')
    expect(store.sliderDuty).toBe('page-width')

    store.setMainView('ppt')
    expect(store.sliderDuty).toBe('none')
  })
})
