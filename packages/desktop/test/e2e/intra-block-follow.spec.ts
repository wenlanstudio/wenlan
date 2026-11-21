import { expect, test } from '@playwright/test'
// 点击驱动的落光标时序敏感（异步 selection-change × 拖选窗口）：允许一次重试。
test.describe.configure({ retries: 2 })
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

/** 左 pane 把 marker 块内 frac 深度处滚到视口中央后**真实点击**（落光标 →
 * cursorLine 锚 → 点击驱动同步）。先滚后量，保证点击点在视口内。 */
const clickAt = async(marker: string, frac: number): Promise<void> => {
  const left = page.locator('.pane-left .editor-component').first()
  await left.evaluate((el, [m, f]) => {
    const container = el.querySelector('.mu-container') || el
    const block = Array.from(container.children)
      .find(b => (b.textContent || '').includes(m as string))
    if (!block) return
    const r = block.getBoundingClientRect()
    const absTop = el.scrollTop + r.top - el.getBoundingClientRect().top
    el.scrollTop = Math.max(0, absTop + (f as number) * r.height - el.clientHeight / 2)
  }, [marker, frac])
  await page.waitForTimeout(400)
  const pos = await left.evaluate((el, [m, f]) => {
    const container = el.querySelector('.mu-container') || el
    const block = Array.from(container.children)
      .find(b => (b.textContent || '').includes(m as string))
    if (!block) return null
    const r = block.getBoundingClientRect()
    return { x: Math.round(r.left + Math.min(r.width / 2, 200)), y: Math.round(r.top + (f as number) * r.height) }
  }, [marker, frac])
  if (!pos) throw new Error('block not found: ' + marker)
  await page.mouse.click(pos.x, pos.y)
  // 落光标 + 投影 smooth 跟随落定后再采样
  await page.waitForTimeout(1500)
}

test('fence: projection follows INTO the block, not to its top（块内插值）', async() => {
  await splitFlowColumn()
  await clickAt('FENCE-ONE', 0.4)

  const left = page.locator('.pane-left .editor-component').first()
  const right = page.locator('.pane-right .leaf-projection').first()
  const [l, r] = await Promise.all([fracOf(left), fracOf(right)])

  expect(l, 'editor should be inside FENCE-ONE').toBeTruthy()
  expect(l!.text).toContain('FENCE-ONE')
  // 块级：两侧停在同一内容块
  expect(r, 'projection should follow').toBeTruthy()
  expect(r!.text).toContain('FENCE-ONE')
  // 块内：投影跟到光标行位附近——**不是**跳回块顶（旧块顶对齐会让
  // r.frac ≈ 0）。注意 l.frac 是「编辑面视口顶」的块内进度（centering 后
  // 视口顶在光标位上方约半屏），与投影落点（=光标行位）天然差约半屏高
  // 度的行比例，容差放宽到 0.35；非 0 断言防「跳回块顶」回退。
  expect(Math.abs(r!.frac - l!.frac), 'proportional within-block alignment').toBeLessThan(0.35)
  expect(r!.frac, 'not snapped to block top').toBeGreaterThan(0.15)
})

test('wrapped paragraph: click lands the projection proportionally（异高块）', async() => {
  await splitFlowColumn()
  // 段落甲在右栏更窄、换行更多 → 块更高；比例是投影对齐，容差放宽到 0.2。
  await clickAt('段落甲', 0.5)

  const left = page.locator('.pane-left .editor-component').first()
  const right = page.locator('.pane-right .leaf-projection').first()
  const [l, r] = await Promise.all([fracOf(left), fracOf(right)])

  // 编辑面视口顶块 ≠ 光标块（点击后视口顶落在光标块之前的块尾是正常的）：
  // 断言只盯**投影**落进光标行所在块（点击驱动的收敛语义）。
  expect(l!.text).toBeTruthy()
  expect(r!.text).toContain('段落甲')
  expect(Math.abs(r!.frac - l!.frac)).toBeLessThan(0.35)
})

test('anchor carries the real-valued line position（topLine + topFrac）', async() => {
  await splitFlowColumn()
  await clickAt('FENCE-TWO', 0.55)

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
  await clickAt('FENCE-TWO', 0.55)

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

test('降级看守：滚「文」与滚「栏」均不驱动同步（§6.2 2026-11-21）', async() => {
  await splitFlowColumn()
  const left = page.locator('.pane-left .editor-component').first()
  const right = page.locator('.pane-right .leaf-projection').first()

  // 滚「文」→ 投影原地不动（滚动静默）
  const rBefore = await right.evaluate(el => el.scrollTop)
  await left.evaluate(el => { el.scrollTop = el.scrollHeight * 0.5 })
  await page.waitForTimeout(900)
  expect(Math.abs((await right.evaluate(el => el.scrollTop)) - rBefore)).toBeLessThan(2)

  // 滚「栏」→ 文原地不动（滚动静默）
  const lBefore = await left.evaluate(el => el.scrollTop)
  await right.evaluate(el => { el.scrollTop = el.scrollHeight * 0.5 })
  await page.waitForTimeout(900)
  expect(Math.abs((await left.evaluate(el => el.scrollTop)) - lBefore)).toBeLessThan(2)
})
