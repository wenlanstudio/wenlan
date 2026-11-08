import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithDoc } from './helpers'

// M1 分屏同屏跟随（view-model §6.2）：文×栏分屏，左 pane 滚动 → 右 pane
// （leafProjection 只读投影）应停在同一个内容块。真机首验失败的两类根因
// （mdRev 未初始化、滚动容器错位）都在这条链上，此 spec 永久看守。

let app: ElectronApplication | null = null
let page: Page

test.beforeAll(async() => {
  const launched = await launchWithDoc('test/e2e/data/columns-follow.md')
  app = launched.app
  page = launched.page
  await page.waitForTimeout(800)
})

test.afterAll(async() => {
  if (app) await app.close()
})

/** 点切换器建立 文×栏 分屏（幂等：已建立则跳过——两用例共享同一页面，
 *  对已选中的叶再点一次是取消）。 */
const splitFlowColumn = async(): Promise<void> => {
  const existing = page.locator('.pane-right .leaf-projection')
  if (await existing.isVisible().catch(() => false)) return
  await page.locator('.leaf-btn', { hasText: '栏' }).first().click()
  await page.waitForSelector('.pane-right .leaf-projection', { timeout: 8000 })
  await page.waitForTimeout(400) // 投影第二实例渲染
}

/** 视口顶块的文本（前 24 字）。层级注意：左 .editor-component 的
 *  .mu-container 是直接子，右栏的隔一层（muya getContainer replaceWith
 *  后的 domNode 里）——用后代查询兼容两者。 */
const topTextOf = (root: ReturnType<typeof page.locator>): Promise<string | null> =>
  root.evaluate(el => {
    const viewTop = el.getBoundingClientRect().top + 1
    const container = el.querySelector('.mu-container') ?? el
    const blocks = Array.from(container.children) as HTMLElement[]
    const first = blocks.find(b => b.getBoundingClientRect().bottom > viewTop)
    return first ? (first.textContent ?? '').slice(0, 24) : null
  })

test('column projection follows the editor scroll (M1 §6.2)', async() => {
  await splitFlowColumn()

  const left = page.locator('.pane-left .editor-component').first()
  const right = page.locator('.pane-right .leaf-projection').first()
  await left.waitFor({ state: 'visible', timeout: 8000 })

  const rightBefore = await right.evaluate(el => el.scrollTop)

  // 左 pane 滚到中部（真实滚轮语义，触发 scroll 监听 → 锚 → 订阅链）。
  await left.evaluate(el => {
    el.scrollTop = el.scrollHeight * 0.4
  })
  await page.waitForTimeout(600) // rAF 写锚 + 订阅传播 + 投影滚动

  const rightAfter = await right.evaluate(el => el.scrollTop)
  expect(rightAfter).not.toBe(rightBefore)
  expect(rightAfter).toBeGreaterThan(0)
})

test('projection lands on the same block the editor shows (block-level)', async() => {
  await splitFlowColumn()

  const left = page.locator('.pane-left .editor-component').first()
  const right = page.locator('.pane-right .leaf-projection').first()

  // 左 pane 先回顶再滚到 40%：同值赋值不触发 scroll 事件（两用例共享页面，
  // 左栏可能已在目标位置——真实用户的滚动必有位移，这里模拟之）。
  await left.evaluate(el => {
    el.scrollTop = 0
  })
  await page.waitForTimeout(300)
  await left.evaluate(el => {
    el.scrollTop = el.scrollHeight * 0.4
  })
  await page.waitForTimeout(600)

  // 左右视口顶块应是同一个内容块（块级同步语义）：比较首可见块的文本。
  const [leftText, rightText] = await Promise.all([topTextOf(left), topTextOf(right)])
  expect(leftText).toBeTruthy()
  expect(rightText).toBe(leftText)
})

test('single click aligns the editor without moving the projection (§6.3)', async() => {
  await splitFlowColumn()

  const left = page.locator('.pane-left .editor-component').first()
  const right = page.locator('.pane-right .leaf-projection').first()

  // 右栏滚到中部，点它视口中部的一个块：右栏必须原地不动，左栏对齐过来。
  await right.evaluate(el => {
    el.scrollTop = el.scrollHeight * 0.5
  })
  await page.waitForTimeout(300)
  const rightBefore = await right.evaluate(el => el.scrollTop)

  const midBlock = await right.evaluate(() => {
    const container = document.querySelector('.pane-right .leaf-projection-host .mu-container')
    const blocks = Array.from(container?.children ?? []) as HTMLElement[]
    return blocks[Math.floor(blocks.length / 2)]?.textContent?.slice(0, 16) ?? null
  })
  expect(midBlock).toBeTruthy()
  await page.locator('.pane-right .mu-container > *').nth(18).click()
  await page.waitForTimeout(700)

  const rightAfter = await right.evaluate(el => el.scrollTop)
  expect(Math.abs(rightAfter - rightBefore)).toBeLessThan(2)
  const leftTop = await topTextOf(left)
  expect(leftTop).toBeTruthy()
})

test('double click scrolls the projection itself and the editor follows (§6.3)', async() => {
  await splitFlowColumn()

  const left = page.locator('.pane-left .editor-component').first()
  const right = page.locator('.pane-right .leaf-projection').first()

  // 右栏停在顶部，双击视口内首块：右栏滚到该块顶，左栏跟随对齐。
  await right.evaluate(el => {
    el.scrollTop = 0
  })
  await page.waitForTimeout(300)
  await page.locator('.pane-right .mu-container > *').nth(20).dblclick()
  await page.waitForTimeout(900)

  const rightAfter = await right.evaluate(el => el.scrollTop)
  expect(rightAfter).toBeGreaterThan(100)
  const leftTop = await topTextOf(left)
  const rightTop = await topTextOf(right)
  expect(leftTop).toBe(rightTop)
})
