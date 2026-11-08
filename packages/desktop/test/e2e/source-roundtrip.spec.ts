import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithDoc } from './helpers'

// 本↔文往返渲染看守（用户报「切到本再切回文，全是空白」且 console 无报错
// ——非异常路径，用 e2e 断言左 pane 块渲染与滚动几何兜住）。

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

const toggleSource = async(): Promise<void> => {
  await page.locator('.leaf-btn', { hasText: '本' }).first().click()
  await page.waitForTimeout(500)
}

test('editor keeps its blocks after a source round-trip (plain flow)', async() => {
  await toggleSource()
  await page.waitForSelector('.source-code', { timeout: 8000 }).catch(() => undefined)
  await toggleSource() // 切回文
  await page.waitForTimeout(900)

  const geo = await page.evaluate(() => {
    const comp = document.querySelector('.pane-left .editor-component') as HTMLElement | null
    const container = comp?.querySelector('.mu-container') as HTMLElement | null
    return {
      compScroll: comp ? `${comp.scrollTop}/${comp.scrollHeight}/${comp.clientHeight}` : 'null',
      blockCount: container ? container.children.length : -1,
      textLen: container?.textContent?.length ?? -1
    }
  })
   
  console.log('ROUNDTRIP:', JSON.stringify(geo))
  expect(geo.blockCount).toBeGreaterThan(0)
  expect(geo.textLen).toBeGreaterThan(50)
})

test('editor keeps its blocks after a source round-trip (split flow×column)', async() => {
  // 先建立分屏，再走一次本往返。
  const splitBefore = await page.locator('.pane-right .leaf-projection').isVisible().catch(() => false)
  if (!splitBefore) {
    await page.locator('.leaf-btn', { hasText: '栏' }).first().click()
    await page.waitForTimeout(400)
  }
  await toggleSource()
  await page.waitForTimeout(600)
  await toggleSource()
  await page.waitForTimeout(900)

  const geo = await page.evaluate(() => {
    const comp = document.querySelector('.pane-left .editor-component') as HTMLElement | null
    const container = comp?.querySelector('.mu-container') as HTMLElement | null
    const right = document.querySelector('.pane-right .leaf-projection') as HTMLElement | null
    return {
      blockCount: container ? container.children.length : -1,
      textLen: container?.textContent?.length ?? -1,
      compVisible: comp ? getComputedStyle(comp).display !== 'none' : false,
      rightPresent: !!right
    }
  })
   
  console.log('SPLIT_ROUNDTRIP:', JSON.stringify(geo))
  expect(geo.blockCount).toBeGreaterThan(0)
  expect(geo.textLen).toBeGreaterThan(50)
  expect(geo.compVisible).toBe(true)
})
