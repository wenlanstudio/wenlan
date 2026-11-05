import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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
  HIDDEN_LEAVES,
  visibleLeafList,
  useEditorViewStore
} from '@/store/editorView'
import { useEditorStore } from '@/store/editor'

const switcherPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../src/renderer/src/components/viewSwitcher/index.vue'
)

// 视图模型 v2（docs/design/view-model.md）：文示二支 × 六叶选择。
// 2026-11-05 key 重排：旧 page（逻辑页）→ spare 雪藏为「备」，旧 paper
// （物理纸）→ page 显示为「页」；用户只见五叶。持久化按 leafSchema 区分
// 旧 key 与新 key（旧 page→flow、旧 paper→page）。
// 顺序即分屏左右顺序（细→粗、编辑左展示右）。
describe('editorView selection model', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('declares the two-branch six-leaf structure (spare + page)', () => {
    expect(LEAVES).toEqual(['flow', 'column', 'spare', 'page', 'slide', 'present'])
    expect(TOP_VIEWS).toEqual(['table', 'figure', 'code'])
  })

  // 2026-11-05 命名调整：用户只会看到「文 [栏] 页 览 示」。
  it('hides only the spare leaf and exposes five visible leaves', () => {
    expect(HIDDEN_LEAVES).toEqual(['spare'])
    expect(visibleLeafList(false)).toEqual(['flow', 'page', 'slide', 'present'])
    expect(visibleLeafList(true)).toEqual(['flow', 'column', 'page', 'slide', 'present'])
  })

  it('refuses to select the hidden spare leaf from any entry point', () => {
    const store = useEditorViewStore()
    store.toggleLeaf('spare')
    expect(store.leafSelection).toEqual(['flow'])
    expect(store.activeLeaf).toBe('flow')

    // 正式的「页」= page（旧 key paper），仍可与文分屏。
    store.toggleLeaf('page')
    expect(store.leafSelection).toEqual(['flow', 'page'])
    expect(store.rightLeaf).toBe('page')
  })

  it('labels page as 页 and the hidden spare as 备 in the switcher', () => {
    const src = readFileSync(switcherPath, 'utf8')
    expect(src).toMatch(/page:\s*\{ label: '页'/)
    expect(src).toMatch(/spare:\s*\{ label: '备'/)
    // 「备」必须真的被挡在可见叶之外，而不只是换了个字。
    expect(src).toContain('visibleLeafList(hasColumns.value)')
  })

  it('defaults to flow fullscreen with the width slider', () => {
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

  it('cross-branch pairs work: (flow, slide) needs no column markers', () => {
    const store = useEditorViewStore()
    store.toggleLeaf('slide')
    expect(store.leftLeaf).toBe('flow')
    expect(store.rightLeaf).toBe('slide')
  })

  it('page (M4.3 projection): splits with flow, fullscreen hides the live editor lens', () => {
    const store = useEditorViewStore()
    store.toggleLeaf('page')
    expect(store.leafSelection).toEqual(['flow', 'page'])
    expect(store.leftLeaf).toBe('flow')
    expect(store.rightLeaf).toBe('page') // 右 pane = 只读真分片投影
    expect(store.editorLens).toBe('flow') // 活引擎在左 pane

    store.toggleLeaf('flow') // 摘掉 flow → 全屏 page
    expect(store.activeLeaf).toBe('page')
    expect(store.editorLens).toBe('page')
    // M4.3：页叶是只读投影，活引擎隐藏留任 bus 服务后端；光标指示无意义。
    expect(store.isEditorVisible).toBe(false)
    expect(store.sliderDuty).toBe('page-zoom') // 页缩放，待接线（§5）

    store.toggleLeaf('slide') // 页×览不可配对 → 单选替换（§5 交互）
    expect(store.leafSelection).toEqual(['slide'])
    expect(store.activeLeaf).toBe('slide')
  })

  it('page pairs only within the edit branch: (flow, page) split survives', () => {
    const store = useEditorViewStore()
    store.toggleLeaf('page')
    expect(store.leafSelection).toEqual(['flow', 'page'])
    expect(store.leftLeaf).toBe('flow')
    expect(store.rightLeaf).toBe('page')
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
    store.toggleLeaf('present') // 摘掉 present → 回 flow 全屏
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

  it('focusEditor resets to flow fullscreen (deck view Esc path)', () => {
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
    expect(raw).toMatchObject({ leafSchema: 2, leaves: ['flow'], rightRatio: 0.6 })
  })

  it('fullscreen column falls back to flow when the document has no markers', async() => {
    const store = useEditorViewStore()
    store.toggleLeaf('column') // → [flow, column] 分屏（无标记也合法）
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

  it('round-trips the page leaf (new key, no migration)', () => {
    let store = reloaded()
    store.toggleLeaf('page')
    store.toggleLeaf('flow') // → 全屏 page

    store = reloaded()
    expect(store.leafSelection).toEqual(['page'])
    expect(store.editorLens).toBe('page')
  })

  it('never restores a fullscreen hidden spare leaf (unclickable state)', () => {
    // 单叶隐藏态最危险：最后一片点不掉、又没有按钮可切换，会卡死。
    localStorage.setItem(
      'marktext-editor-view',
      JSON.stringify({ leafSchema: 2, leaves: ['spare'] })
    )
    const store = reloaded()
    expect(store.leafSelection).toEqual(['flow'])
    expect(store.activeLeaf).toBe('flow')
  })

  it('migrates the legacy paper key to page', () => {
    localStorage.setItem(
      'marktext-editor-view',
      JSON.stringify({ leaves: ['paper'], rightRatio: 0.45 })
    )
    expect(reloaded().leafSelection).toEqual(['page'])
  })

  it('treats a versioned page as the physical-paper leaf, never the old logical page', () => {
    // 没有 leafSchema 就无法区分「旧 page = 逻辑页」与「新 page = 物理纸」。
    localStorage.setItem(
      'marktext-editor-view',
      JSON.stringify({ leafSchema: 2, leaves: ['page'], rightRatio: 0.45 })
    )
    const store = reloaded()
    expect(store.leafSelection).toEqual(['page'])
    expect(store.activeLeaf).toBe('page')
  })

  it('migrates a legacy paper×show pair and sanitizes it down to one leaf', () => {
    localStorage.setItem(
      'marktext-editor-view',
      JSON.stringify({ leaves: ['paper', 'slide'], rightRatio: 0.45 })
    )
    expect(reloaded().leafSelection).toEqual(['page']) // 留 LEAVES 序靠前者
  })

  it('migrates the v1 pair shape (document/page → flow, slides, previewForm)', () => {
    localStorage.setItem(
      'marktext-editor-view',
      JSON.stringify({ mainView: 'document', subView: 'page' })
    )
    expect(reloaded().leafSelection).toEqual(['flow'])

    // 旧 page = 逻辑页（现 key spare、已雪藏）→ 落回 flow；
    // 新版带 leafSchema 的 page 才是物理纸，见上面的迁移护栏。
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

    // 已废的 document/slide 编辑视图 → 落回 flow
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
    // reading→column 的改名链要喂标记，否则全屏 column 的健康回退先把它打回 flow
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

// 「示」一键全屏放映：点按钮不再走配置选择式，而是记住当前选择 → 单叶
// present → 窗口原生全屏；布局层按 presentImmersive 收起侧栏/标题栏/状态栏/
// 底部执行面板。✕、Esc 或系统退出全屏都整包复原。
describe('「示」 immersive fullscreen presentation', () => {
  let setFullScreen: ReturnType<typeof vi.fn>
  let isFullScreen: ReturnType<typeof vi.fn>

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    setFullScreen = vi.fn()
    isFullScreen = vi.fn(() => Promise.resolve(false))
    Object.assign(window.electron, {
      windowControl: { setFullScreen, isFullScreen }
    })
  })

  it('enters single-leaf present with native fullscreen and no editing surface', () => {
    const store = useEditorViewStore()
    store.toggleLeaf('slide') // 进入前是 (flow, slide) 分屏
    store.enterPresentImmersive()

    expect(store.presentImmersive).toBe(true)
    expect(store.leafSelection).toEqual(['present'])
    expect(store.activeLeaf).toBe('present')
    expect(store.isSplit).toBe(false)
    // 底部执行面板由 isCodeRunSurface 驱动，放映态必须为 false。
    expect(store.isEditingSurface).toBe(false)
    expect(store.isCodeRunSurface).toBe(false)
    expect(setFullScreen).toHaveBeenCalledWith(true)
  })

  it('restores the previous leaves and top view on exit', () => {
    const store = useEditorViewStore()
    store.toggleLeaf('present')
    store.toggleTopView('code')
    store.enterPresentImmersive()
    expect(store.topView).toBeNull()

    store.exitPresentImmersive()
    expect(store.presentImmersive).toBe(false)
    expect(store.leafSelection).toEqual(['flow', 'present'])
    expect(store.topView).toBe('code')
    expect(setFullScreen).toHaveBeenLastCalledWith(false)
  })

  it('is idempotent: Esc and leave-full-screen may both fire', () => {
    const store = useEditorViewStore()
    store.enterPresentImmersive()
    store.enterPresentImmersive()
    expect(setFullScreen).toHaveBeenCalledTimes(1)

    store.exitPresentImmersive()
    store.exitPresentImmersive()
    expect(store.presentImmersive).toBe(false)
    expect(store.leafSelection).toEqual(['flow'])
    expect(setFullScreen).toHaveBeenCalledTimes(2)
  })

  it('keeps the window fullscreen when it was already fullscreen before entering', async() => {
    isFullScreen.mockResolvedValue(true)
    const store = useEditorViewStore()
    await store.initWindowFullScreen()
    store.enterPresentImmersive()
    store.exitPresentImmersive()

    expect(setFullScreen).toHaveBeenCalledTimes(1) // 只有进入时的 true
    expect(setFullScreen).toHaveBeenCalledWith(true)
  })

  it('drops the immersive flag without overriding a view changed from outside', async() => {
    const store = useEditorViewStore()
    store.enterPresentImmersive()
    store.toggleLeaf('slide') // 模拟菜单/命令切走
    await nextTick()

    expect(store.presentImmersive).toBe(false)
    expect(store.leafSelection).toEqual(['present', 'slide'])
  })
})
