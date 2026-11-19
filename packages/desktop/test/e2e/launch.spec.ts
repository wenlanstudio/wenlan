import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchElectron } from './helpers'

test.describe('Check Launch MarkText', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const { app: electronApp, page: firstPage } = await launchElectron()
    app = electronApp
    page = firstPage
  })

  test.afterAll(async() => {
    await app.close()
  })

  test('Empty MarkText', async() => {
    const title = await page.title()
    // Product was renamed to 文览 (Wenlan); accept both the new and legacy titles.
    expect(title).toMatch(/文览|Wenlan|MarkText/)
  })
})
