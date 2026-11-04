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

// 视图模型 v2（docs/design/view-model.md）：文示二支 × 六叶选择。
// M4.3 起 page（逻辑页）与 paper（物理纸）是两片独立的叶，LEAVES 从 5 扩到 6；
// 顺序即分屏左右顺序（细→粗、编辑左展示右）。
describe('editorView selection model', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('declares the two-branch six-leaf structure (page + paper in the edit branch)', () => {
    expect(LEAVES).toEqual(['flow', 'column', 'page', 'paper', 'slide', 'present'])
    expect(TOP_VIEWS).toEqual(['table', 'figure', 'code'])
  })

  it('defaults to page fullscreen with the width slider', () => {
    const store = useEditorViewStore()
    expect(store.leafSelection).toEqual(['flow'])
    expect(store.activeLeaf).toBe('flow')
    expect(store.isSplit).toBe(false)
    expect(store.sliderDuty).toBe('flow-width')
    expect(store.editorLens).toBe('flow')
  })

  it('selecting a second leaf splits, ordered fine→coarse with the slider suppressed', () => {
    const store = useEditorViewStore()
    store.toggleLeaf('present')
    expect(store.leafSelection).toEqual(['flow', 'present'])
    expect(store.isSplit).toBe(true)
    expect(store.leftLeaf).toBe('flow')
    expect(store.rightLeaf).toBe('present')
    expect(store.editorLens).toBe('flow') // 活引擎在左 pane
    expect(store.sliderDuty).toBe('none') // 宽度控制被分割条吸收
  })

  it('cross-branch pairs work: (page, slide) needs no column markers', () => {
    const store = useEditorViewStore()
    store.toggleLeaf('slide')
    expect(store.leftLeaf).toBe('flow')
    expect(store.rightLeaf).toBe('slide')
  })

  it('paper (M4.3 projection): splits with flow, fullscreen hides the live editor lens', () => {
    const store = useEditorViewStore()
    store.toggleLeaf('paper')
    expect(store.leafSelection).toEqual(['flow', 'paper'])
    expect(store.leftLeaf).toBe('flow')
    expect(store.rightLeaf).toBe('paper') // 右 pane = 只读真分片投影
    expect(store.editorLens).toBe('flow') // 活引擎在左 pane

    store.toggleLeaf('flow') // 摘掉 flow → 全屏 paper
    expect(store.activeLeaf).toBe('paper')
    expect(store.editorLens).toBe('paper')
    // M4.3：纸叶是只读投影，活引擎隐藏留任 bus 服务后端；光标指示无意义。
    expect(store.isEditorVisible).toBe(false)
    expect(store.sliderDuty).toBe('paper-zoom') // 页缩放，待接线（§5）

    store.toggleLeaf('slide') // 纸×览不可配对 → 单选替换（§5 交互）
    expect(store.leafSelection).toEqual(['slide'])
    expect(store.activeLeaf).toBe('slide')
  })

  it('paper pairs only within the edit branch: (flow, paper) split survives', () => {
    const store = useEditorViewStore()
    store.toggleLeaf('paper')
    expect(store.leafSelection).toEqual(['flow', 'paper'])
    expect(store.leftLeaf).toBe('flow')
    expect(store.rightLeaf).toBe('paper')
    expect(store.editorLens).toBe('flow')
  })

  it('a third click is ignored while two are selected (deselect first)', () => {
    const store = useEditorViewStore()
    store.toggleLeaf('present')
    store.toggleLeaf('slide') // 选满两叶，第三叶点不动——配置选择式
    expect(store.leafSelection).toEqual(['flow', 'present'])

    store.toggleLeaf('flow') // 摘一片后才能换
    store.toggleLeaf('slide')
    expect(store.leafSelection).toEqual(['present', 'slide'])
    expect(store.leftLeaf).toBe('slide')
    expect(store.rightLeaf).toBe('present')
  })

  it('toggling a selected leaf removes it, but the last one is protected', () => {
    const store = useEditorViewStore()
    store.toggleLeaf('present')
    store.toggleLeaf('present') // 摘掉 present → 回 page 全屏
    expect(store.leafSelection).toEqual(['flow'])
    expect(store.activeLeaf).toBe('flow')

    store.toggleLeaf('flow') // 最后一片点不掉
    expect(store.leafSelection).toEqual(['flow'])
  })

  it('clicking a leaf dismisses the active top view (mutual exclusion, state kept)', () => {
    const store = useEditorViewStore()
    store.toggleLeaf('present')
    store.toggleTopView('table')
    expect(store.topView).toBe('table')
    expect(store.editorLens).toBe('table')
    expect(store.sliderDuty).toBe('flow-width')
    expect(store.leafSelection).toEqual(['flow', 'present']) // 挂起不丢

    store.toggleLeaf('column') // 点叶 → 回叶世界（已满两叶，column 点不动）
    expect(store.topView).toBeNull()
    expect(store.leafSelection).toEqual(['flow', 'present'])

    store.toggleLeaf('present') // 先摘一片，column 才进得来
    store.toggleLeaf('column')
    expect(store.leafSelection).toEqual(['flow', 'column'])
  })

  it('toggling a top view twice returns to the leaves', () => {
    const store = useEditorViewStore()
    store.toggleTopView('code')
    expect(store.isSourceMode).toBe(true)
    expect(store.editorLens).toBeNull()
    expect(store.sliderDuty).toBe('flow-width')

    store.toggleTopView('code')
    expect(store.topView).toBeNull()
    expect(store.activeLeaf).toBe('flow')
  })

  it('focusEditor resets to page fullscreen (deck view Esc path)', () => {
    const store = useEditorViewStore()
    store.toggleLeaf('slide')
    store.focusEditor()
    expect(store.leafSelection).toEqual(['flow'])
    expect(store.topView).toBeNull()
  })

  it('removeLeaf drops one pane but never the last (deck panel ✕ path)', () => {
    const store = useEditorViewStore()
    store.toggleLeaf('present')
    store.removeLeaf('present')
    expect(store.leafSelection).toEqual(['flow'])
    store.removeLeaf('flow') // 保护
    expect(store.leafSelection).toEqual(['flow'])
  })

  it('clamps and persists the split ratio', () => {
    const store = useEditorViewStore()
    store.setRightRatio(0.95)
    expect(store.rightRatio).toBe(0.8)
    store.setRightRatio(0.05)
    expect(store.rightRatio).toBe(0.2)
    store.setRightRatio(0.6)
    const raw = JSON.parse(localStorage.getItem('marktext-editor-view') ?? '{}')
    expect(raw).toMatchObject({ leaves: ['flow'], rightRatio: 0.6 })
  })

  it('fullscreen column falls back to page when the document has no markers', async() => {
    const store = useEditorViewStore()
    store.toggleLeaf('column') // → [page, column] 分屏（无标记也合法）
    store.toggleLeaf('flow') // 摘掉 flow → 全屏 column
    // 无 begin 标记 → 健康回退（§4.4 #5）。watch 异步 flush，等一拍。
    await nextTick()
    expect(store.leafSelection).toEqual(['flow'])
  })

  it('fullscreen column stays when the document has markers', () => {
    useEditorStore().currentFile = {
      markdown: '<!-- begin -->\nA\n<!-- end -->'
    } as never
    const store = useEditorViewStore()
    store.toggleLeaf('column')
    store.toggleLeaf('flow')
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
    expect(store.leafSelection).toEqual(['flow', 'slide'])
    expect(store.rightRatio).toBe(0.6)
  })

  it('round-trips the paper leaf (new enum value, no migration)', () => {
    let store = reloaded()
    store.toggleLeaf('paper')
    store.toggleLeaf('flow') // → 全屏 paper

    store = reloaded()
    expect(store.leafSelection).toEqual(['paper'])
    expect(store.editorLens).toBe('paper')
  })

  it('sanitizes a persisted paper×show pair down to one leaf', () => {
    localStorage.setItem(
      'marktext-editor-view',
      JSON.stringify({ leaves: ['paper', 'slide'], rightRatio: 0.45 })
    )
    expect(reloaded().leafSelection).toEqual(['paper']) // 留 LEAVES 序靠前者
  })

  it('migrates the v1 pair shape (document/page → flow, slides, previewForm)', () => {
    localStorage.setItem(
      'marktext-editor-view',
      JSON.stringify({ mainView: 'document', subView: 'page' })
    )
    expect(reloaded().leafSelection).toEqual(['flow'])

    // 四叶形状里的 page 键 → flow（给将来 A4「纸面」叶让位）
    localStorage.setItem(
      'marktext-editor-view',
      JSON.stringify({ leaves: ['page', 'slide'], rightRatio: 0.45 })
    )
    expect(reloaded().leafSelection).toEqual(['flow', 'slide'])

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
    expect(reloaded().leafSelection).toEqual(['flow', 'present'])

    // 已废的 document/slide 编辑视图 → 落回 page
    localStorage.setItem(
      'marktext-editor-view',
      JSON.stringify({ mainView: 'document', subView: 'slide' })
    )
    expect(reloaded().leafSelection).toEqual(['flow'])
  })

  it('migrates the renamed main views (word/ppt/excel/dev) and reading/columns', () => {
    localStorage.setItem(
      'marktext-editor-view',
      JSON.stringify({ mainView: 'excel', subView: 'sheet' })
    )
    let store = reloaded()
    expect(store.topView).toBe('table')
    expect(store.leafSelection).toEqual(['flow'])

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
    expect(reloaded().leafSelection).toEqual(['flow'])

    localStorage.setItem(
      'marktext-editor-view',
      JSON.stringify({ leaves: ['nope', 42] })
    )
    expect(reloaded().leafSelection).toEqual(['flow'])
  })
})
