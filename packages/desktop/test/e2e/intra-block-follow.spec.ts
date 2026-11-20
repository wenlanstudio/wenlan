import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithDoc } from './helpers'

// §6.0 块内插值真机看守（view-model §6.0）：文×栏分屏，视口顶停在长块内部
// 不同深度时，右栏投影应落在**同一内容的同一行进度**处（块内比例对齐），
// 而不是跳回块顶——这是 ρᵢ∘Rᵢ = id 的端到端形态。夹具 intra-blocks.md：
// 三道 60 行级代码围栏 + 两个故意拉长的段落（两侧换行宽度不同 → 块高不同，
// 比例是投影对齐，断言用松容差）。同时看守锚携带实数行位（topFrac）与本
// 视图的行位精确恢复（frac 路径）。反向定位/双击语义由 view-sync-follow
// 看守，此处不重复。

let app: ElectronApplication | null = null
let page: Page

test.beforeAll(async() => {
  const launched = await launchWithDoc('test/e2e/data/intra-blocks.md')
  app = launched.app
  page = launched.page
  await page.waitForTimeout(800)
})

test.afterAll(async() => {
  if (app) await app.close()
})

const splitFlowColumn = async(): Promise<void> => {
  const existing = page.locator('.pane-right .leaf-projection')
  if (await existing.isVisible().catch(() => false)) return
  await page.locator('.leaf-btn', { hasText: '栏' }).first().click()
  await page.waitForSelector('.pane-right .leaf-projection', { timeout: 8000 })
  await page.waitForTimeout(400)
}

/** 视口顶块 + 块内像素进度（两侧同构测量：原始 DOM 子序，first bottom > top+1）。 */
const fracOf = (root: ReturnType<typeof page.locator>): Promise<{ text: string; frac: number } | null> =>
  root.evaluate(el => {
    const container = el.querySelector('.mu-container') || el
    const viewTop = el.getBoundingClientRect().top + 1
    const blocks = Array.from(container.children) as HTMLElement[]
    let idx = blocks.findIndex(b => b.getBoundingClientRect().bottom > viewTop)
    if (idx === -1) idx = blocks.length - 1
    const block = blocks[idx]
    const rect = block.getBoundingClientRect()
    const frac = rect.height > 0 ? Math.min(1, Math.max(0, (viewTop - rect.top) / rect.height)) : 0
    return { text: (block.textContent || '').slice(0, 48), frac }
  })

/** 左 pane 回顶再滚到 marker 块内 frac 深度（先位移保证 scroll 事件触发）。 */
const scrollToFrac = async(marker: string, frac: number): Promise<void> => {
  const left = page.locator('.pane-left .editor-component').first()
  await left.evaluate(el => { el.scrollTop = 0 })
  await page.waitForTimeout(200)
  await left.evaluate((el, [m, f]) => {
    const container = el.querySelector('.mu-container') || el
    const block = Array.from(container.children)
      .find(b => (b.textContent || '').includes(m as string))
    if (!block) return
    const r = block.getBoundingClientRect()
    const s = el.getBoundingClientRect()
    el.scrollTop = el.scrollTop + (r.top - s.top) + (f as number) * r.height
  }, [marker, frac])
  await page.waitForTimeout(1100)
}

test('fence: projection follows INTO the block, not to its top（块内插值）', async() => {
  await splitFlowColumn()
  await scrollToFrac('FENCE-ONE', 0.4)

  const left = page.locator('.pane-left .editor-component').first()
  const right = page.locator('.pane-right .leaf-projection').first()
  const [l, r] = await Promise.all([fracOf(left), fracOf(right)])

  expect(l, 'editor should be inside FENCE-ONE').toBeTruthy()
  expect(l!.text).toContain('FENCE-ONE')
  // 块级：两侧停在同一内容块
  expect(r, 'projection should follow').toBeTruthy()
  expect(r!.text).toContain('FENCE-ONE')
  // 块内：编辑面在 40% 深度，投影必须跟到相近深度——**不是**跳回块顶
  //（旧块顶对齐会让 r.frac ≈ 0，此处双重断言：比例相近 + 明确非 0）。
  expect(Math.abs(r!.frac - l!.frac), 'proportional within-block alignment').toBeLessThan(0.12)
  expect(r!.frac, 'not snapped to block top').toBeGreaterThan(0.15)
})

test('wrapped paragraph: proportional alignment tolerates different block heights', async() => {
  await splitFlowColumn()
  // 段落甲在右栏更窄、换行更多 → 块更高；比例是投影对齐，容差放宽到 0.2。
  await scrollToFrac('段落甲', 0.5)

  const left = page.locator('.pane-left .editor-component').first()
  const right = page.locator('.pane-right .leaf-projection').first()
  const [l, r] = await Promise.all([fracOf(left), fracOf(right)])

  expect(l!.text).toContain('段落甲')
  expect(r!.text).toContain('段落甲')
  expect(Math.abs(r!.frac - l!.frac)).toBeLessThan(0.2)
})

test('anchor carries the real-valued line position（topLine + topFrac）', async() => {
  await splitFlowColumn()
  await scrollToFrac('FENCE-TWO', 0.55)

  const anchor = await page.evaluate(() =>
    (window as unknown as { __mt_docAnchor?: { read: () => { topLine?: number; topFrac?: number; origin?: string } | null } }).__mt_docAnchor?.read()
  )
  expect(anchor, 'anchor exists').toBeTruthy()
  expect(anchor!.topLine, 'topLine present').toBeTruthy()
  expect(typeof anchor!.topFrac, 'topFrac is a number').toBe('number')
  expect(anchor!.topFrac!).toBeGreaterThanOrEqual(0)
  expect(anchor!.topFrac!).toBeLessThan(1)
})

test('source view restores the real line（frac 精确路径）', async() => {
  await splitFlowColumn()
  await scrollToFrac('FENCE-TWO', 0.55)

  await page.locator('.leaf-btn[title^="本"]').click()
  await page.waitForSelector('.source-code', { timeout: 8000 })
  await page.waitForTimeout(1200) // CM 布局 + 恢复 rAF

  const src = await page.evaluate(() => {
    const cm = (window as unknown as { __mt_source_cm?: {
      getScrollerElement: () => HTMLElement
      lineAtHeight: (y: number, mode: string) => number
      heightAtLine: (line: number, mode: string) => number
    } | null }).__mt_source_cm
    const container = document.querySelector('.source-code')
    if (!cm || !container) return null
    const scroller = cm.getScrollerElement()
    const y = container.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    const line0 = cm.lineAtHeight(Math.max(0, y), 'local')
    const topH = cm.heightAtLine(line0, 'local')
    const h = cm.heightAtLine(line0 + 1, 'local') - topH
    const frac = h > 0 ? Math.min(1, Math.max(0, (y - topH) / h)) : 0
    const anchor = (window as unknown as { __mt_docAnchor?: { read: () => { topLine?: number; topFrac?: number } | null } }).__mt_docAnchor?.read()
    return { line: line0 + 1, frac, anchor }
  })
  expect(src, 'source view + cm hook').toBeTruthy()
  // 行位精确：恢复后的视口顶行 == 锚行（frac 只影响行内偏移，不跨行）
  expect(src!.line).toBe(src!.anchor!.topLine)
  // 行内进度也保真（R_source 是逐行精确插值）
  expect(Math.abs(src!.frac - src!.anchor!.topFrac!)).toBeLessThan(0.05)

  // 本 → 文回来：块级恢复停在同一围栏（叶选择挂起不丢）
  await page.locator('.leaf-btn[title^="本"]').click()
  await page.waitForSelector('.pane-left .editor-component', { timeout: 8000 })
  await page.waitForTimeout(1000)
  const back = await fracOf(page.locator('.pane-left .editor-component').first())
  expect(back?.text).toContain('FENCE')
})

test('双向滚动同步：滚「栏」→ 文按行位跟随，栏不被回弹拉走（§6.2 再裁决）', async() => {
  await splitFlowColumn()
  const left = page.locator('.pane-left .editor-component').first()
  const right = page.locator('.pane-right .leaf-projection').first()

  // 编辑面先回顶（保证有位移），再把**投影**滚到 FENCE-TWO 块内 45% 深度
  await left.evaluate(el => { el.scrollTop = 0 })
  await page.waitForTimeout(300)
  await right.evaluate(el => {
    const container = el.querySelector('.mu-container') || el
    const block = Array.from(container.children)
      .find(b => (b.textContent || '').includes('FENCE-TWO'))
    if (!block) return
    const r = block.getBoundingClientRect()
    const s = el.getBoundingClientRect()
    el.scrollTop = el.scrollTop + (r.top - s.top) + 0.45 * r.height
  })
  await page.waitForTimeout(1300) // 投影发锚 + 文跟随（smooth）

  const [l, r] = await Promise.all([fracOf(left), fracOf(right)])
  // 文跟随进同一块、相近比例
  expect(l?.text).toContain('FENCE-TWO')
  expect(Math.abs(l!.frac - r!.frac)).toBeLessThan(0.15)
  // 发起面（栏）守在自己的位置，不被文的对齐回声拉走
  expect(r!.frac).toBeGreaterThan(0.3)
  // 静置后再采样：位置稳定（无自激漂移）
  await page.waitForTimeout(800)
  const l2 = await fracOf(left)
  const r2 = await fracOf(right)
  expect(Math.abs(l2!.frac - l!.frac)).toBeLessThan(0.02)
  expect(Math.abs(r2!.frac - r!.frac)).toBeLessThan(0.02)
})
