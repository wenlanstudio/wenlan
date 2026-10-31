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
  useEditorViewStore,
  FORM_LADDER,
  canPair,
  type EditForm,
  type PreviewForm
} from '@/store/editorView'
import { useEditorStore } from '@/store/editor'

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
    expect(resolveSliderDuty('document', 'column')).toBe('page-width')
    expect(resolveSliderDuty('code', 'source')).toBe('page-width')
    expect(resolveSliderDuty('table', 'all')).toBe('page-width')
  })

  it('keeps placeholder sub-views slider-less until they are implemented', () => {
    // document/slide shipped its semantic-card lens (P4a) — the slider duty
    // activates with it; figure/gallery stays gated until it flips.
    expect(MAIN_VIEW_META.document.subViews.find((s) => s.key === 'slide')).toMatchObject({
      slider: 'slide-zoom',
      implemented: true
    })
    expect(resolveSliderDuty('document', 'slide')).toBe('slide-zoom')
    expect(MAIN_VIEW_META.figure.subViews.find((s) => s.key === 'gallery')).toMatchObject({
      slider: 'page-width',
      implemented: false
    })
    expect(resolveSliderDuty('figure', 'gallery')).toBe('none')
  })

  it('present mode never has a slider, even once implemented', () => {
    // Implemented since M1 (md2slides presentation view, 2026-10-31) — the point
    // of this test is that flipping the flag must not summon the width slider.
    expect(MAIN_VIEW_META.present.subViews.find((s) => s.key === 'present')).toMatchObject({
      slider: 'none',
      implemented: true
    })
    expect(resolveSliderDuty('present', 'present')).toBe('none')
  })

  it('reports none for an unknown sub-view', () => {
    expect(resolveSliderDuty('document', 'nope')).toBe('none')
  })

  it('tracks the active view: page-width everywhere a width view is active', () => {
    const store = useEditorViewStore()
    expect(store.sliderDuty).toBe('page-width') // default document/page

    store.setMainView('document', 'column')
    expect(store.sliderDuty).toBe('page-width')

    store.setMainView('code')
    expect(store.sliderDuty).toBe('page-width')

    store.setMainView('present')
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

  it('migrates the view-model renames: columns→column, slides→present', () => {
    // 每次重读都要新 pinia（同实例会缓存首载状态）；column 形态需要文档真有
    // 分栏标记，否则健康回退（§4.4 #5）会立刻打回 page——那也是对的行为，
    // 但这里要验的是改名链本身。标记要喂在**新** pinia 的 editor store 上。
    const reloaded = () => {
      setActivePinia(createPinia())
      useEditorStore().currentFile = {
        markdown: '<!-- begin -->\nA\n<!-- end -->'
      } as never
      return useEditorViewStore()
    }

    localStorage.setItem(
      'marktext-editor-view',
      JSON.stringify({ mainView: 'document', subView: 'columns' })
    )
    let store = reloaded()
    expect(store.mainView).toBe('document')
    expect(store.subView).toBe('column')

    // 旧 slides 主视图折叠为 present：present 子视图照常恢复。
    localStorage.setItem(
      'marktext-editor-view',
      JSON.stringify({ mainView: 'slides', subView: 'present' })
    )
    store = reloaded()
    expect(store.mainView).toBe('present')
    expect(store.subView).toBe('present')

    // 旧 slides/slide（占位）在 present 下无对应 → 落该视图默认子视图。
    localStorage.setItem(
      'marktext-editor-view',
      JSON.stringify({ mainView: 'slides', subView: 'slide' })
    )
    store = reloaded()
    expect(store.mainView).toBe('present')
    expect(store.subView).toBe('present')
  })

  it('drops a persisted preview form that is not on the ladder', () => {
    localStorage.setItem(
      'marktext-editor-view',
      JSON.stringify({ mainView: 'document', subView: 'page', previewForm: 'page' })
    )
    const store = useEditorViewStore()
    expect(store.previewForm).toBeNull()
    expect(store.activePreview).toBeNull()
  })
})

// 形态模型（docs/design/view-model.md）：四形态离散度单调递增，分屏 = 序上
// 严格递增的有序对（左编辑右投影）。
describe('editorView form ladder and preview pairing', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('orders the ladder page → column → slide → present', () => {
    expect(FORM_LADDER).toEqual(['page', 'column', 'slide', 'present'])
  })

  it('pairs only strictly-increasing (edit, preview) combinations', () => {
    // 六个合法对（3+2+1）与全部非法对。
    expect(canPair('page', 'column')).toBe(true)
    expect(canPair('page', 'slide')).toBe(true)
    expect(canPair('page', 'present')).toBe(true)
    expect(canPair('column', 'slide')).toBe(true)
    expect(canPair('column', 'present')).toBe(true)
    expect(canPair('slide', 'present')).toBe(true)
    expect(canPair('page' as EditForm, 'page' as PreviewForm)).toBe(false)
    expect(canPair('column', 'column' as PreviewForm)).toBe(false)
    expect(canPair('slide', 'slide' as PreviewForm)).toBe(false)
    expect(canPair('column', 'page' as PreviewForm)).toBe(false)
    expect(canPair('slide', 'column')).toBe(false)
  })

  it('togglePreview opens the present projection from an edit form', () => {
    const store = useEditorViewStore()
    expect(store.editForm).toBe('page') // default document/page
    expect(store.activePreview).toBeNull()

    store.togglePreview()
    expect(store.previewForm).toBe('present')
    expect(store.activePreview).toBe('present')

    store.togglePreview()
    expect(store.previewForm).toBeNull()
    expect(store.activePreview).toBeNull()
  })

  it('suspends, not drops, the preview when the edit side leaves the ladder', () => {
    const store = useEditorViewStore()
    store.togglePreview()
    expect(store.activePreview).toBe('present')

    // 切到 code 源码视图：编辑面不在梯子上 → 投影挂起但意图保留。
    store.setMainView('code')
    expect(store.editForm).toBeNull()
    expect(store.activePreview).toBeNull()
    expect(store.previewForm).toBe('present')

    // 切回 document：投影自动恢复。
    store.setMainView('document', 'page')
    expect(store.activePreview).toBe('present')
  })

  it('rejects a preview that is not strictly more discrete than the edit form', () => {
    const store = useEditorViewStore()
    store.setPreview('column') // page → column 合法
    expect(store.previewForm).toBe('column')
    expect(store.activePreview).toBe('column')

    store.setMainView('document', 'column') // editForm 变 column → column 投影非法
    expect(store.activePreview).toBeNull()
    expect(store.previewForm).toBe('column') // 意图保留，等待合法编辑形态

    // 显式设非法对：静默拒绝。
    store.setPreview('column')
    expect(store.previewForm).toBe('column')
    store.setPreview('present') // column → present 合法，接受
    expect(store.previewForm).toBe('present')
  })

  it('persists the preview form alongside the view pair', () => {
    const store = useEditorViewStore()
    store.togglePreview()
    const raw = JSON.parse(localStorage.getItem('marktext-editor-view') ?? '{}')
    expect(raw).toMatchObject({ mainView: 'document', subView: 'page', previewForm: 'present' })
  })
})
