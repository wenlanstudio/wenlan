import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithMarkdown, clickMenuById } from './helpers'

// Wait until a `v-show`-toggled element's visibility differs from `wasVisible`.
// A missing element counts as "not visible", so the change-detection logic
// stays consistent whether v-show clears the inline style or unmounts the node.
const waitForVisibilityFlip = (page: Page, selector: string, wasVisible: boolean) =>
  page.waitForFunction(
    ({ sel, prior }) => {
      const el = document.querySelector(sel) as HTMLElement | null
      const visible = !!(el && el.style.display !== 'none' && el.offsetParent !== null)
      return visible !== prior
    },
    { sel: selector, prior: wasVisible },
    { timeout: 5000 }
  )

test.describe('Layout panel toggles', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown('# Layout\n\n## Section A\n\n## Section B\n')
    app = launched.app
    page = launched.page
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('Sidebar toggle changes .side-bar visibility', async() => {
    const sideBar = page.locator('.side-bar')
    const initial = await sideBar.isVisible()
    await clickMenuById(app, 'sideBarMenuItem')
    await waitForVisibilityFlip(page, '.side-bar', initial)
    const afterToggle = await sideBar.isVisible()
    expect(afterToggle).not.toBe(initial)
    await clickMenuById(app, 'sideBarMenuItem')
  })

  test('TOC menu toggles ToC panel without throwing', async() => {
    // Ensure sidebar is visible so TOC has somewhere to render.
    const sideBar = page.locator('.side-bar')
    if (!(await sideBar.isVisible())) {
      await clickMenuById(app, 'sideBarMenuItem')
      await page.waitForFunction(
        () => {
          const el = document.querySelector('.side-bar') as HTMLElement | null
          return el && el.offsetParent !== null
        },
        null,
        { timeout: 5000 }
      )
    }
    await clickMenuById(app, 'tocMenuItem')
    // No specific selector to assert (TOC mounts inside the sidebar);
    // verifying the menu invocation does not throw is the main signal.
    await page.waitForTimeout(200)
    await clickMenuById(app, 'tocMenuItem')
  })

  // Regression for the gap left between the editor when the sidebar is hidden:
  // the editor's max-width must follow the *effective* sidebar width, which is
  // 0 while the sidebar is closed, not the raw store value (clamped to >=220).
  test('Editor fills the viewport width while the sidebar is hidden', async() => {
    // Make sure the sidebar is open first.
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.side-bar') as HTMLElement | null
        return !!(el && el.offsetParent !== null)
      },
      null,
      { timeout: 5000 }
    )

    const shownWidth = await page.evaluate(() => {
      const editor = document.querySelector('.editor-with-tabs') as HTMLElement | null
      return editor ? editor.getBoundingClientRect().width : 0
    })

    await clickMenuById(app, 'sideBarMenuItem')
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.side-bar') as HTMLElement | null
        return !el || el.offsetParent === null
      },
      null,
      { timeout: 5000 }
    )

    const { editorWidth, viewportWidth } = await page.evaluate(() => {
      const editor = document.querySelector('.editor-with-tabs') as HTMLElement | null
      return {
        editorWidth: editor ? editor.getBoundingClientRect().width : 0,
        viewportWidth: window.innerWidth
      }
    })
    expect(editorWidth).toBeGreaterThan(shownWidth)
    expect(Math.abs(editorWidth - viewportWidth)).toBeLessThanOrEqual(1)

    // Leave the sidebar open for the other tests in this suite.
    await clickMenuById(app, 'sideBarMenuItem')
  })
})
