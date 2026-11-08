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

import { LEAVES, TOP_VIEWS, visibleLeafList, useEditorViewStore } from '@/store/editorView'
import { useEditorStore } from '@/store/editor'

const switcherPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../src/renderer/src/components/viewSwitcher/index.vue'
)

// 视图模型（docs/design/view-model.md）：文示二支 × 五叶选择。
// 用户只见「文 [栏] 页 览 示」。顺序即分屏左右顺序（细→粗、编辑左展示右）。
// 持久化只认现行形状；旧 key / 旧形状一律落默认，不做迁移。
describe('editorView selection model', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('declares the two-branch five-leaf structure', () => {
    expect(LEAVES).toEqual(['flow', 'column', 'page', 'slide', 'present'])
    // 2026-11-08 本/码换名：'source' 即「本」（CodeMirror 源码），'code' 即
    // 「码」（全文代码块只读透镜）。
    expect(TOP_VIEWS).toEqual(['table', 'figure', 'source', 'code'])
  })

  it('exposes five visible leaves (column gated on markers)', () => {
    expect(visibleLeafList(false)).toEqual(['flow', 'page', 'slide', 'present'])
    expect(visibleLeafList(true)).toEqual(['flow', 'column', 'page', 'slide', 'present'])
  })

  it('labels page as 页 in the switcher', () => {
    const src = readFileSync(switcherPath, 'utf8')
    expect(src).toMatch(/page:\s*\{ label: '页'/)
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

  it('toggling 本 (source) twice returns to the leaves', () => {
    const store = useEditorViewStore()
    store.toggleTopView('source')
    expect(store.isSourceMode).toBe(true)
    expect(store.editorLens).toBeNull() // 本是 CodeMirror 独立渲染，非透镜
    expect(store.sliderDuty).toBe('flow-width')

    store.toggleTopView('source')
    expect(store.topView).toBeNull()
    expect(store.activeLeaf).toBe('flow')
  })

  it('toggling 码 (code) twice returns to the leaves', () => {
    const store = useEditorViewStore()
    store.toggleTopView('code')
    expect(store.isSourceMode).toBe(false)
    expect(store.editorLens).toBe('code') // 码 = 第三个内容透镜（只读）
    expect(store.sliderDuty).toBe('flow-width')

    store.toggleTopView('code')
    expect(store.topView).toBeNull()
    expect(store.activeLeaf).toBe('flow')
  })

  it('toggling 图 (figure) rides the lens host, not the placeholder', () => {
    // 2026-11-08：图占位退役，图 = 代码型图表块只读透镜（表/码同构）。
    const store = useEditorViewStore()
    store.toggleTopView('figure')
    expect(store.editorLens).toBe('figure')
    expect(store.sliderDuty).toBe('flow-width')
    expect(store.isCodeRunSurface).toBe(false) // 图不是执行面

    store.toggleTopView('figure')
    expect(store.topView).toBeNull()
    expect(store.activeLeaf).toBe('flow')
  })

  it('the code-run panel surface covers 文独占 and 码透镜独占 only', () => {
    const store = useEditorViewStore()
    expect(store.isCodeRunSurface).toBe(true) // 文独占（现行基线）

    store.toggleTopView('code')
    expect(store.isCodeRunSurface).toBe(true) // 码透镜独占：围栏 ▶ / 点块定位可用

    store.toggleTopView('table')
    expect(store.isCodeRunSurface).toBe(false) // 表透镜不是执行面

    store.toggleTopView('table') // 回 flow 全屏
    store.toggleLeaf('slide') // (flow, slide) 分屏
    expect(store.isCodeRunSurface).toBe(false) // 分屏不可用（现行判据保持）
  })

  it('focusEditor resets to flow fullscreen (deck view Esc path)', () => {
    const store = useEditorViewStore()
    store.toggleLeaf('slide')
    store.focusEditor()
    expect(store.leafSelection).toEqual(['flow'])
    expect(store.topView).toBeNull()
  })

  // 跳转编辑目标态（视图模型 §6.3）：让「文」接管编辑面，但不折叠分屏——
  // 左叶（全屏即唯一叶）换成文、右叶保留；已含文则只清顶级视图。
  it('enterFlowEditor replaces a fullscreen column leaf with flow', () => {
    const store = useEditorViewStore()
    store.leafSelection = ['column']
    store.enterFlowEditor()
    expect(store.leafSelection).toEqual(['flow'])
    expect(store.topView).toBeNull()
  })

  it('enterFlowEditor swaps the left leaf and keeps the right (column×page → flow×page)', () => {
    const store = useEditorViewStore()
    store.leafSelection = ['column', 'page']
    store.enterFlowEditor()
    expect(store.leafSelection).toEqual(['flow', 'page'])
  })

  it('enterFlowEditor normalizes click order to leaf order before swapping', () => {
    const store = useEditorViewStore()
    store.leafSelection = ['page', 'column'] // 点选顺序 ≠ LEAVES 序
    store.enterFlowEditor()
    expect(store.leafSelection).toEqual(['flow', 'page'])
  })

  it('enterFlowEditor keeps a selection that already has flow, dropping only the top view', () => {
    const store = useEditorViewStore()
    store.toggleLeaf('slide') // ['flow', 'slide']
    store.toggleTopView('table')
    expect(store.topView).toBe('table')
    store.enterFlowEditor()
    expect(store.leafSelection).toEqual(['flow', 'slide'])
    expect(store.topView).toBeNull()
  })

  it('enterFlowEditor recovers from a table view over a read-only fullscreen leaf', () => {
    const store = useEditorViewStore()
    store.leafSelection = ['page']
    store.toggleTopView('table')
    store.enterFlowEditor()
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

describe('editorView persistence', () => {
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

  it('round-trips the page leaf', () => {
    let store = reloaded()
    store.toggleLeaf('page')
    store.toggleLeaf('flow') // → 全屏 page

    store = reloaded()
    expect(store.leafSelection).toEqual(['page'])
    expect(store.editorLens).toBe('page')
  })

  it('drops unknown leaf keys and falls back to flow', () => {
    // 旧 key（spare/paper）与任何未知值都不再迁移，一律按非法值丢弃。
    localStorage.setItem(
      'marktext-editor-view',
      JSON.stringify({ leaves: ['spare'], rightRatio: 0.45 })
    )
    expect(reloaded().leafSelection).toEqual(['flow'])

    localStorage.setItem(
      'marktext-editor-view',
      JSON.stringify({ leaves: ['paper'], rightRatio: 0.45 })
    )
    expect(reloaded().leafSelection).toEqual(['flow'])
  })

  it('ignores the pre-leaf shape (mainView/subView) and falls back to defaults', () => {
    localStorage.setItem(
      'marktext-editor-view',
      JSON.stringify({ mainView: 'document', subView: 'page' })
    )
    expect(reloaded().leafSelection).toEqual(['flow'])
  })

  it('sanitizes a non-pairable restored pair down to the earlier leaf', () => {
    // page×示支不可配对：恢复时只留 LEAVES 序靠前者（§2）。
    localStorage.setItem(
      'marktext-editor-view',
      JSON.stringify({ leaves: ['page', 'slide'], rightRatio: 0.45 })
    )
    expect(reloaded().leafSelection).toEqual(['page'])
  })

  it('falls back to defaults on garbage', () => {
    localStorage.setItem('marktext-editor-view', 'not-json{')
    expect(reloaded().leafSelection).toEqual(['flow'])

    localStorage.setItem('marktext-editor-view', JSON.stringify({ leaves: ['nope', 42] }))
    expect(reloaded().leafSelection).toEqual(['flow'])
  })

  // 2026-11-08 本/码换名的一次性归位（视图模型 §2 唯一迁移例外）：旧数据
  // 无 v 字段，topView 'code' 是旧「本」→ 载入读作 'source'；带 v:2 的新数据
  // 'code' 就是码透镜，原样保留。防止换名后旧「本」静默变成码透镜。
  it('relocates the legacy topView code (旧「本」) to source when the blob has no version', () => {
    localStorage.setItem(
      'marktext-editor-view',
      JSON.stringify({ leaves: ['flow'], topView: 'code', rightRatio: 0.45 })
    )
    const store = reloaded()
    expect(store.topView).toBe('source')
    expect(store.isSourceMode).toBe(true)
    expect(store.editorLens).toBeNull()
  })

  it('keeps topView code as the code lens when the blob is v2', () => {
    localStorage.setItem(
      'marktext-editor-view',
      JSON.stringify({ v: 2, leaves: ['flow'], topView: 'code', rightRatio: 0.45 })
    )
    const store = reloaded()
    expect(store.topView).toBe('code')
    expect(store.isSourceMode).toBe(false)
    expect(store.editorLens).toBe('code')
  })

  it('round-trips the code lens across a reload (v2 blob)', () => {
    let store = reloaded()
    store.toggleTopView('code')
    expect(store.editorLens).toBe('code')

    store = reloaded()
    expect(store.topView).toBe('code')
    expect(store.editorLens).toBe('code')
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
    store.toggleTopView('source')
    store.enterPresentImmersive()
    expect(store.topView).toBeNull()

    store.exitPresentImmersive()
    expect(store.presentImmersive).toBe(false)
    expect(store.leafSelection).toEqual(['flow', 'present'])
    expect(store.topView).toBe('source')
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
