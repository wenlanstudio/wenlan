import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithMarkdown } from './helpers'

// Issue #2 — JetBrains-style bottom tool window.
//
// The contract is NOT "a full-height sidebar happens to be covered by an opaque
// panel": .workspace (and therefore the sidebar, the editor column and any
// future right sidebar) must really end where the panel starts, and follow the
// panel height while it is dragged / maximized / closed. The inner document
// canvas must use the *measured* editor viewport, not 100vh, or its tail and
// the typewriter caret still sit behind the panel.
//
// This spec runs against the built Electron renderer and measures the real DOM.
// A fenced code block is needed for the 「码」 button to be enabled.

const MD = [
  '# layout',
  '',
  '```python',
  'print(1)',
  '```',
  '',
  'text',
  ''
].join('\n')

interface Box {
  top: number
  bottom: number
  height: number
}

interface Metrics {
  viewportHeight: number
  workspace: Box | null
  sidebar: Box | null
  middle: Box | null
  editorComponent: Box | null
  paneLeft: Box | null
  sourceCode: Box | null
  panel: Box | null
  status: Box | null
  rightColumn: Box | null
  workspaceVar: number
  bottomPanelVar: number
  editorViewportVar: number
  muPaddingBottom: number
  stackBelowWorkspace: string[]
}

const readMetrics = (page: Page): Promise<Metrics> =>
  page.evaluate(() => {
    const box = (sel: string): Box | null => {
      const el = document.querySelector(sel) as HTMLElement | null
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom, height: r.height }
    }
    const varOf = (sel: string, name: string): number => {
      const el = document.querySelector(sel)
      return el ? Number.parseFloat(getComputedStyle(el).getPropertyValue(name)) : Number.NaN
    }
    const container = document.querySelector('.editor-container') as HTMLElement | null
    const mu = document.querySelector('.mu-container') as HTMLElement | null
    const ws = document.querySelector('.workspace') as HTMLElement | null
    // A point inside the panel: if a column still claimed the full window
    // height it would appear in this stack *underneath* the panel.
    const y = ws ? ws.getBoundingClientRect().bottom + 20 : 0
    const stackBelowWorkspace = document.elementsFromPoint(120, y).map(
      e => (typeof e.className === 'string' ? e.className : '') || e.tagName
    )
    return {
      viewportHeight: window.innerHeight,
      workspace: box('.workspace'),
      sidebar: box('.side-bar'),
      middle: box('.editor-middle'),
      editorComponent: box('.editor-component'),
      paneLeft: box('.pane-left'),
      sourceCode: box('.source-code'),
      panel: box('.exec-panel'),
      status: box('.status-bar'),
      rightColumn: box('#probe-right-column'),
      workspaceVar: container
        ? Number.parseFloat(getComputedStyle(container).getPropertyValue('--workspaceHeight'))
        : Number.NaN,
      bottomPanelVar: container
        ? Number.parseFloat(getComputedStyle(container).getPropertyValue('--bottomPanelHeight'))
        : Number.NaN,
      editorViewportVar: varOf('.editor-wrapper', '--editorViewportHeight'),
      muPaddingBottom: mu ? Number.parseFloat(getComputedStyle(mu).paddingBottom) : Number.NaN,
      stackBelowWorkspace
    }
  })

/** Throw instead of sprinkling `!` through every assertion. */
const must = <T>(value: T | null, label: string): T => {
  if (value === null) throw new Error(`${label} is missing from the DOM`)
  return value
}

/** ResizeObserver → Vue style patch takes a frame; wait for the published truth. */
const settle = async(page: Page): Promise<Metrics> => {
  await expect.poll(async() => {
    const m = await readMetrics(page)
    return m.workspace ? Math.abs(m.workspaceVar - m.workspace.height) : 1
  }, { timeout: 5000 }).toBeLessThanOrEqual(1)
  return readMetrics(page)
}

/** The future right sidebar: a plain flex child must inherit .workspace's height. */
const injectRightColumn = (page: Page): Promise<void> =>
  page.evaluate(() => {
    if (document.querySelector('#probe-right-column')) return
    const el = document.createElement('div')
    el.id = 'probe-right-column'
    el.style.cssText = 'flex:0 0 140px;min-height:0;background:transparent'
    document.querySelector('.workspace')?.append(el)
  })

const removeRightColumn = (page: Page): Promise<void> =>
  page.evaluate(() => document.querySelector('#probe-right-column')?.remove())

const assertColumnsFollowWorkspace = (m: Metrics, label: string): void => {
  const ws = must(m.workspace, `${label}: workspace`)
  const sidebar = must(m.sidebar, `${label}: sidebar`)
  const middle = must(m.middle, `${label}: editor column`)
  const viewport = must(m.editorComponent, `${label}: editor viewport`)
  const right = must(m.rightColumn, `${label}: future right sidebar`)
  must(m.status, `${label}: status bar`)

  // 侧栏、编辑器列、未来的右侧栏都从窗口顶一直延伸到面板顶（32px 标题栏是
  // fixed 浮层，不占流），所以三者的高度就等于 .workspace 的高度。
  for (const [name, col] of [
    ['sidebar', sidebar],
    ['editor middle', middle],
    ['future right sidebar', right]
  ] as const) {
    expect(Math.abs(col.bottom - ws.bottom), `${label}: ${name} bottom`).toBeLessThanOrEqual(1)
    expect(Math.abs(col.height - ws.height), `${label}: ${name} height`).toBeLessThanOrEqual(1)
  }
  // 真正的编辑滚动视口在标题栏之下，比 .workspace 矮一个标题栏，但底边必须
  // 同样落在面板顶上——这才是「随面板收缩」而不是「被面板盖住」。
  expect(Math.abs(viewport.bottom - ws.bottom), `${label}: editor viewport bottom`).toBeLessThanOrEqual(1)
  expect(viewport.height, `${label}: editor viewport is below the title bar`).toBeLessThan(ws.height)

  // CSS variables must describe the real layout, not a stale constant.
  expect(Math.abs(m.workspaceVar - ws.height), `${label}: --workspaceHeight`).toBeLessThanOrEqual(1)
  expect(Math.abs(m.editorViewportVar - viewport.height), `${label}: --editorViewportHeight`).toBeLessThanOrEqual(1)
  expect(Math.abs(m.muPaddingBottom - m.editorViewportVar), `${label}: mu-container tail padding`).toBeLessThanOrEqual(1)
  // The document canvas must no longer be sized from the raw whole-window
  // height (it is exactly the measured viewport, which shrinks with the panel).
  expect(m.muPaddingBottom, `${label}: tail padding is not raw 100vh`).not.toBe(m.viewportHeight)
  // No column may paint underneath the tool window.
  expect(m.stackBelowWorkspace.join(' '), `${label}: no column under the panel`)
    .not.toMatch(/side-bar|editor-middle|editor-component|workspace/)
}

const dragPanelUp = async(page: Page, px: number): Promise<void> => {
  const resizer = page.locator('.panel-resizer')
  const box = await resizer.boundingBox()
  if (!box) throw new Error('panel resizer has no box')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y - px, { steps: 8 })
  await page.mouse.up()
}

test.describe('issue #2 — bottom panel really shrinks the three columns', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown(MD)
    app = launched.app
    page = launched.page
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('closed → open → dragged → maximized → closed → source mode', async() => {
    await expect(page.locator('.editor-component')).toBeAttached({ timeout: 10000 })
    await injectRightColumn(page)

    const codeBtn = page.locator('.code-run-btn')
    expect(await codeBtn.isDisabled(), '「码」 must be enabled in flow view').toBe(false)

    // The document auto-opens the panel on first parse; start from a known
    // closed state so every later delta is measured against the same baseline.
    if (await page.locator('.exec-panel').count()) {
      await codeBtn.click({ force: true })
      await expect(page.locator('.exec-panel')).toHaveCount(0)
    }
    const closed = await settle(page)
    const closedWs = must(closed.workspace, 'closed: workspace')
    const closedStatus = must(closed.status, 'closed: status bar')
    assertColumnsFollowWorkspace(closed, 'closed')
    expect(Math.abs(closedWs.bottom - closedStatus.top), 'closed: workspace ends at status bar').toBeLessThanOrEqual(1)
    expect(closed.bottomPanelVar, 'closed: --bottomPanelHeight').toBe(0)

    // —— open ——
    await codeBtn.click({ force: true })
    await expect(page.locator('.exec-panel')).toBeVisible({ timeout: 5000 })
    const open = await settle(page)
    const openPanel = must(open.panel, 'open: panel')
    const openWs = must(open.workspace, 'open: workspace')
    assertColumnsFollowWorkspace(open, 'open')
    expect(Math.abs(openWs.bottom - openPanel.top), 'open: no overlap / no gap').toBeLessThanOrEqual(1)
    expect(Math.abs(openPanel.bottom - must(open.status, 'open: status').top), 'open: panel ends at status bar').toBeLessThanOrEqual(1)
    expect(Math.abs(closedWs.height - openWs.height - openPanel.height), 'open: workspace shrinks by exactly the panel height').toBeLessThanOrEqual(2)
    expect(Math.abs(open.bottomPanelVar - openPanel.height), 'open: --bottomPanelHeight').toBeLessThanOrEqual(1)
    expect(closed.muPaddingBottom - open.muPaddingBottom, 'open: document tail padding shrank with the panel').toBeGreaterThan(100)

    // —— drag taller ——
    await dragPanelUp(page, 120)
    const taller = await settle(page)
    const tallerPanel = must(taller.panel, 'dragged: panel')
    const tallerWs = must(taller.workspace, 'dragged: workspace')
    assertColumnsFollowWorkspace(taller, 'dragged')
    expect(tallerPanel.height - openPanel.height, 'dragged: panel grew ~120px').toBeGreaterThan(100)
    expect(openWs.height - tallerWs.height, 'dragged: workspace shrank ~120px').toBeGreaterThan(100)
    expect(Math.abs(tallerWs.bottom - tallerPanel.top), 'dragged: columns follow the new height').toBeLessThanOrEqual(1)
    expect(open.editorViewportVar - taller.editorViewportVar, 'dragged: editor viewport followed').toBeGreaterThan(100)
    expect(open.muPaddingBottom - taller.muPaddingBottom, 'dragged: tail padding followed').toBeGreaterThan(100)

    // —— double-click maximize: editor column keeps its guaranteed minimum ——
    await page.locator('.panel-resizer').dblclick({ force: true })
    const maximized = await settle(page)
    const maximizedWs = must(maximized.workspace, 'maximized: workspace')
    const maximizedPanel = must(maximized.panel, 'maximized: panel')
    assertColumnsFollowWorkspace(maximized, 'maximized')
    expect(maximizedWs.height, 'maximized: editor keeps >= 200px + title bar').toBeGreaterThanOrEqual(231)
    expect(maximizedPanel.height, 'maximized: panel is taller than before').toBeGreaterThan(tallerPanel.height)

    // —— close again: everything returns to the closed baseline ——
    await codeBtn.click({ force: true })
    await expect(page.locator('.exec-panel')).toHaveCount(0)
    const reclosed = await settle(page)
    const reclosedWs = must(reclosed.workspace, 'reclosed: workspace')
    assertColumnsFollowWorkspace(reclosed, 'reclosed')
    expect(Math.abs(reclosedWs.height - closedWs.height), 'reclosed: back to baseline').toBeLessThanOrEqual(1)
    expect(reclosed.bottomPanelVar, 'reclosed: --bottomPanelHeight').toBe(0)

    // —— 「本」源码视图：CodeMirror must fit its pane, not the whole window ——
    await page.locator('.main-view-btn', { hasText: '本' }).click({ force: true })
    await expect(page.locator('.source-code')).toBeVisible({ timeout: 5000 })
    const source = await readMetrics(page)
    const sourceCode = must(source.sourceCode, 'source: CodeMirror')
    const paneLeft = must(source.paneLeft, 'source: pane')
    const sourceStatus = must(source.status, 'source: status bar')
    expect(Math.abs(sourceCode.height - paneLeft.height), 'source: height follows the pane').toBeLessThanOrEqual(1)
    expect(Math.abs(sourceCode.bottom - sourceStatus.top), 'source: ends exactly at the status bar (no full-window overflow)').toBeLessThanOrEqual(1)

    await removeRightColumn(page)
  })
})
