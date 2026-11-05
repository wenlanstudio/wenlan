import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PANEL_DEFAULT_HEIGHT,
  PANEL_MIN_HEIGHT,
  useExecPanelStore
} from '@/store/execPanel'

// Issue #2: 「底部工具窗口展开时，三列的高度要真实收缩」不是加一条 padding 能
// 糊过去的。内容层过去各自按 100vh / 50vh / calc(100vh - chrome) 反推高度，
// 那是整窗口径，面板一开下半截就只能被盖住或裁掉。现在高度只有一个真值：
// app.vue 的 ResizeObserver 实测 .workspace / .exec-panel 并发布 CSS 变量，
// editor.vue 再实测编辑滚动视口；所有子区域消费变量或父链 100%。
//
// 这组用例守住「结构契约」，防止以后有人图省事又写回视口常量。真机尺寸关系
// 由 e2e/issue-2-bottom-panel-height.spec.ts 断言。

const rendererRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../src/renderer/src'
)
const read = (p: string): string => readFileSync(resolve(rendererRoot, p), 'utf8')
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')
const styleOf = (src: string): string =>
  stripComments(
    [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n')
  )

const WORKSPACE_FILES = [
  'components/editorWithTabs/editor.vue',
  'components/editorWithTabs/sourceCode.vue',
  'components/editorWithTabs/deckPane.vue',
  'components/sideBar/index.vue',
  'assets/styles/paperLens.css'
]

describe('issue #2 — layout height contract', () => {
  it('publishes measured heights from app.vue instead of recomputing chrome', () => {
    const app = read('pages/app.vue')
    expect(app).toContain("'--workspaceHeight'")
    expect(app).toContain("'--bottomPanelHeight'")
    expect(app).toContain('new ResizeObserver(measureLayout)')
    expect(app).toContain('layoutObserver.observe(workspaceEl.value)')
    // 面板 body 是 v-if 挂载的，光靠 workspace 尺寸变化不够：store / 视图态变化
    // 也要重测，否则「开关切换但高度恰好相同」会漏一次。
    expect(app).toContain('editorViewStore.isCodeRunSurface')
    expect(styleOf(app)).toMatch(/\.workspace\s*\{[^}]*align-items:\s*stretch/s)
    // 未来的右侧栏：任何直接子列都不得用 min-height:auto 顶破收缩链。
    expect(styleOf(app)).toMatch(/\.workspace\s*>\s*\*\s*\{[^}]*min-height:\s*0/s)
  })

  it('publishes the real editor viewport from editor.vue', () => {
    const src = read('components/editorWithTabs/editor.vue')
    expect(src).toContain("'--editorViewportHeight'")
    expect(src).toContain('viewportObserver.observe(wrapper)')
    // 观察父级 .editor-wrapper 而不是滚动容器自身，避免留白 → 内容盒 → 再观测回环。
    expect(src).toContain('const wrapper = wrapperRef.value')
    expect(src).toContain('viewportObserver?.disconnect()')
  })

  it('never sizes a workspace descendant from the raw viewport', () => {
    for (const file of WORKSPACE_FILES) {
      const css = file.endsWith('.css') ? stripComments(read(file)) : styleOf(read(file))
      expect(css, `${file}: raw 100vh/50vh value`).not.toMatch(
        /(?:height|padding-bottom|padding-top)\s*:\s*(?:100vh|50vh)/
      )
      expect(css, `${file}: viewport calc`).not.toMatch(/calc\(\s*(?:100vh|50vh)/)
    }
  })

  it('consumes the measured variables in every place that used 100vh', () => {
    const editorCss = styleOf(read('components/editorWithTabs/editor.vue'))
    expect(editorCss).toContain('padding-bottom: var(--editorViewportHeight')
    expect(editorCss).toContain('padding-top: max(0px, calc(var(--editorViewportHeight')
    expect(editorCss).not.toContain('calc(50vh - 136px)')

    const sourceCss = styleOf(read('components/editorWithTabs/sourceCode.vue'))
    expect(sourceCss).toMatch(/\.source-code\s*\{[^}]*height:\s*100%/s)
    expect(sourceCss).not.toContain('calc(100vh')

    const paperCss = stripComments(read('assets/styles/paperLens.css'))
    expect(paperCss).toContain('var(--editorViewportHeight, var(--workspaceHeight, 100vh))')

    const deckCss = styleOf(read('components/editorWithTabs/deckPane.vue'))
    expect(deckCss).toContain('calc(var(--workspaceHeight, 100vh) * 0.4)')
  })

  it('derives the panel max height from measured layout, not 100vh minus constants', () => {
    const src = read('components/editorWithTabs/execPanel.vue')
    expect(src).toContain("querySelector<HTMLElement>('.workspace')")
    expect(src).not.toContain('window.innerHeight')
    expect(src).not.toContain('--statusBarHeight')
  })
})

describe('issue #2 — execPanel height source', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('clamps to the minimum and only persists on demand', () => {
    const panel = useExecPanelStore()
    expect(panel.height).toBe(PANEL_DEFAULT_HEIGHT)

    panel.setHeight(10)
    expect(panel.height).toBe(PANEL_MIN_HEIGHT)
    expect(localStorage.getItem('exec-panel-height')).toBeNull()

    panel.setHeight(321.6, true)
    expect(panel.height).toBe(322)
    expect(localStorage.getItem('exec-panel-height')).toBe('322')
  })

  it('toggles open without mutating the remembered height', () => {
    const panel = useExecPanelStore()
    panel.setHeight(420, true)
    panel.toggle()
    expect(panel.open).toBe(true)
    expect(panel.height).toBe(420)
    panel.toggle()
    expect(panel.open).toBe(false)
    expect(panel.height).toBe(420)
  })
})
