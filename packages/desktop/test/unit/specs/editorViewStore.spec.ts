import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

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
  LEAVES,
  TOP_VIEWS,
  useEditorViewStore
} from '@/store/editorView'
import { useEditorStore } from '@/store/editor'

// 视图模型 v2（docs/design/view-model.md）：文示二支 × 四叶选择。
describe('editorView selection model', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('declares the two-branch four-leaf structure', () => {
    expect(LEAVES).toEqual(['page', 'column', 'slide', 'present'])
    expect(TOP_VIEWS).toEqual(['table', 'figure', 'code'])
  })

  it('defaults to page fullscreen with the width slider', () => {
    const store = useEditorViewStore()
    expect(store.leafSelection).toEqual(['page'])
    expect(store.activeLeaf).toBe('page')
    expect(store.isSplit).toBe(false)
    expect(store.sliderDuty).toBe('page-width')
    expect(store.editorLens).toBe('page')
  })

  it('selecting a second leaf splits, ordered fine→coarse with the slider suppressed', () => {
    const store = useEditorViewStore()
    store.toggleLeaf('present')
    expect(store.leafSelection).toEqual(['page', 'present'])
    expect(store.isSplit).toBe(true)
    expect(store.leftLeaf).toBe('page')
    expect(store.rightLeaf).toBe('present')
    expect(store.editorLens).toBe('page') // 活引擎在左 pane
    expect(store.sliderDuty).toBe('none') // 宽度控制被分割条吸收
  })

  it('cross-branch pairs work: (page, slide) needs no column markers', () => {
    const store = useEditorViewStore()
    store.toggleLeaf('slide')
    expect(store.leftLeaf).toBe('page')
    expect(store.rightLeaf).toBe('slide')
  })

  it('a third click is ignored while two are selected (deselect first)', () => {
    const store = useEditorViewStore()
    store.toggleLeaf('present')
    store.toggleLeaf('slide') // 选满两叶，第三叶点不动——配置选择式
    expect(store.leafSelection).toEqual(['page', 'present'])

    store.toggleLeaf('page') // 摘一片后才能换
    store.toggleLeaf('slide')
    expect(store.leafSelection).toEqual(['present', 'slide'])
    expect(store.leftLeaf).toBe('slide')
    expect(store.rightLeaf).toBe('present')
  })

  it('toggling a selected leaf removes it, but the last one is protected', () => {
    const store = useEditorViewStore()
    store.toggleLeaf('present')
    store.toggleLeaf('present') // 摘掉 present → 回 page 全屏
    expect(store.leafSelection).toEqual(['page'])
    expect(store.activeLeaf).toBe('page')

    store.toggleLeaf('page') // 最后一片点不掉
    expect(store.leafSelection).toEqual(['page'])
  })

  it('clicking a leaf dismisses the active top view (mutual exclusion, state kept)', () => {
    const store = useEditorViewStore()
    store.toggleLeaf('present')
    store.toggleTopView('table')
    expect(store.topView).toBe('table')
    expect(store.editorLens).toBe('table')
    expect(store.sliderDuty).toBe('page-width')
    expect(store.leafSelection).toEqual(['page', 'present']) // 挂起不丢

    store.toggleLeaf('column') // 点叶 → 回叶世界（已满两叶，column 点不动）
    expect(store.topView).toBeNull()
    expect(store.leafSelection).toEqual(['page', 'present'])

    store.toggleLeaf('present') // 先摘一片，column 才进得来
    store.toggleLeaf('column')
    expect(store.leafSelection).toEqual(['page', 'column'])
  })

  it('toggling a top view twice returns to the leaves', () => {
    const store = useEditorViewStore()
    store.toggleTopView('code')
    expect(store.isSourceMode).toBe(true)
    expect(store.editorLens).toBeNull()
    expect(store.sliderDuty).toBe('page-width')

    store.toggleTopView('code')
    expect(store.topView).toBeNull()
    expect(store.activeLeaf).toBe('page')
  })

  it('focusEditor resets to page fullscreen (deck view Esc path)', () => {
    const store = useEditorViewStore()
    store.toggleLeaf('slide')
    store.focusEditor()
    expect(store.leafSelection).toEqual(['page'])
    expect(store.topView).toBeNull()
  })

  it('removeLeaf drops one pane but never the last (deck panel ✕ path)', () => {
    const store = useEditorViewStore()
    store.toggleLeaf('present')
    store.removeLeaf('present')
    expect(store.leafSelection).toEqual(['page'])
    store.removeLeaf('page') // 保护
    expect(store.leafSelection).toEqual(['page'])
  })

  it('clamps and persists the split ratio', () => {
    const store = useEditorViewStore()
    store.setRightRatio(0.95)
    expect(store.rightRatio).toBe(0.8)
    store.setRightRatio(0.05)
    expect(store.rightRatio).toBe(0.2)
    store.setRightRatio(0.6)
    const raw = JSON.parse(localStorage.getItem('marktext-editor-view') ?? '{}')
    expect(raw).toMatchObject({ leaves: ['page'], rightRatio: 0.6 })
  })

  it('fullscreen column falls back to page when the document has no markers', async() => {
    const store = useEditorViewStore()
    store.toggleLeaf('column') // → [page, column] 分屏（无标记也合法）
    store.toggleLeaf('page') // 摘掉 page → 全屏 column
    // 无 begin 标记 → 健康回退（§4.4 #5）。watch 异步 flush，等一拍。
    await nextTick()
    expect(store.leafSelection).toEqual(['page'])
  })

  it('fullscreen column stays when the document has markers', () => {
    useEditorStore().currentFile = {
      markdown: '<!-- begin -->\nA\n<!-- end -->'
    } as never
    const store = useEditorViewStore()
    store.toggleLeaf('column')
    store.toggleLeaf('page')
    expect(store.leafSelection).toEqual(['column'])
    expect(store.editorLens).toBe('column')
  })
})

describe('editorView persistence & migration', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  const reloaded = (fileMarkdown?: string) => {
    setActivePinia(createPinia())
    // currentFile 要在**本** pinia 上、view store 建立前喂入——健康回退的
    // immediate watch 在创建时就会跑。
    if (fileMarkdown !== undefined) {
      useEditorStore().currentFile = { markdown: fileMarkdown } as never
    }
    return useEditorViewStore()
  }

  it('round-trips the v2 shape', () => {
    let store = reloaded()
    store.toggleLeaf('slide')
    store.setRightRatio(0.6)

    store = reloaded()
    expect(store.leafSelection).toEqual(['page', 'slide'])
    expect(store.rightRatio).toBe(0.6)
  })

  it('migrates the v1 pair shape (document/page, slides, previewForm)', () => {
    localStorage.setItem(
      'marktext-editor-view',
      JSON.stringify({ mainView: 'document', subView: 'page' })
    )
    expect(reloaded().leafSelection).toEqual(['page'])

    localStorage.setItem(
      'marktext-editor-view',
      JSON.stringify({ mainView: 'slides', subView: 'present' })
    )
    expect(reloaded().leafSelection).toEqual(['present'])

    // 中间形态的分屏意图（previewForm=present）→ 成对选择
    localStorage.setItem(
      'marktext-editor-view',
      JSON.stringify({ mainView: 'document', subView: 'page', previewForm: 'present' })
    )
    expect(reloaded().leafSelection).toEqual(['page', 'present'])

    // 已废的 document/slide 编辑视图 → 落回 page
    localStorage.setItem(
      'marktext-editor-view',
      JSON.stringify({ mainView: 'document', subView: 'slide' })
    )
    expect(reloaded().leafSelection).toEqual(['page'])
  })

  it('migrates the renamed main views (word/ppt/excel/dev) and reading/columns', () => {
    localStorage.setItem(
      'marktext-editor-view',
      JSON.stringify({ mainView: 'excel', subView: 'sheet' })
    )
    let store = reloaded()
    expect(store.topView).toBe('table')
    expect(store.leafSelection).toEqual(['page'])

    localStorage.setItem(
      'marktext-editor-view',
      JSON.stringify({ mainView: 'document', subView: 'columns' })
    )
    store = reloaded('<!-- begin -->\nA\n<!-- end -->')
    expect(store.leafSelection).toEqual(['column'])

    localStorage.setItem(
      'marktext-editor-view',
      JSON.stringify({ mainView: 'document', subView: 'reading' })
    )
    // reading→column 的改名链要喂标记，否则全屏 column 的健康回退先把它打回 page
    expect(reloaded('<!-- begin -->\nA\n<!-- end -->').leafSelection).toEqual(['column'])
  })

  it('falls back to defaults on garbage', () => {
    localStorage.setItem('marktext-editor-view', 'not-json{')
    expect(reloaded().leafSelection).toEqual(['page'])

    localStorage.setItem(
      'marktext-editor-view',
      JSON.stringify({ leaves: ['nope', 42] })
    )
    expect(reloaded().leafSelection).toEqual(['page'])
  })
})
