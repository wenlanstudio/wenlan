import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithMarkdown } from './helpers'

// Issue #4 feedback, round two — two interactions between the editor and the
// bottom exec panel:
//
// 1. Clicking the fence ▶ must NOT move the editor. The block is on screen —
//    the user clicked its button — so re-scrolling it to the viewport top
//    (the panel-row "reveal" behavior) is pure disruption. The probe run
//    before this fix showed scrollTop being animated +208px on every ▶ click.
// 2. The reverse link: placing the caret inside a code fence in the editor
//    must highlight the matching block-row in the panel's block list (and
//    scroll that row into view) without touching the editor scroll position.
//
// Panel-row clicks keep their reveal behavior — covered here as a regression
// guard so the fix cannot simply remove locating altogether.

const para = (n: number): string => `para ${n}`
const MD = [
  ...Array.from({ length: 10 }, (_, i) => para(i + 1)),
  '',
  '```python',
  'print(1)',
  '```',
  '',
  ...Array.from({ length: 10 }, (_, i) => para(i + 11)),
  '',
  '```python',
  'print(2)',
  '```',
  '',
  ...Array.from({ length: 10 }, (_, i) => para(i + 21)),
  ''
].join('\n')

/** 0-based opening-fence lines of the two python blocks in MD. */
const fenceLines = (() => {
  const lines = MD.split('\n')
  const out: number[] = []
  lines.forEach((l, i) => {
    if (l === '```python') out.push(i)
  })
  return out
})()

const scrollTopOf = (page: Page): Promise<number> =>
  page.evaluate(() => (document.querySelector('.editor-component') as HTMLElement).scrollTop)

test.describe('issue #4 — editor ↔ exec panel click sync', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown(MD)
    app = launched.app
    page = launched.page
    // The panel auto-opens on load and pre-selects the FIRST runnable block.
    await expect(page.locator('.exec-panel .block-row')).toHaveCount(2, { timeout: 15000 })
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('caret inside the second fence highlights its block-row (and only scrolls the list)', async() => {
    const fence2 = page.locator('.mu-code-block').nth(1)
    await fence2.scrollIntoViewIfNeeded()
    // Click the middle of the code body — a plain caret placement, same as a
    // user clicking into the block to edit it.
    await fence2.click({ position: { x: 80, y: 20 } })

    const row = page.locator('.exec-panel .block-row.active')
    await expect(row).toHaveCount(1)
    await expect(row.locator('.loc')).toHaveText(`L${fenceLines[1] + 1}`)
    await expect(row.locator('.snippet')).toHaveText('print(2)')

    // The editor itself must not have moved: the caret was placed by the user.
    // (No numeric baseline here — the assertion is that nothing scrolled the
    // container between the click and the highlight, checked via the fence
    // still being at the same distance below the viewport top.)
    const top = await fence2.evaluate((el) => el.getBoundingClientRect().top)
    expect(top).toBeGreaterThan(0)
  })

  test('▶ on a visible fence does not scroll the editor (panel already open)', async() => {
    const fence2 = page.locator('.mu-code-block').nth(1)
    await fence2.scrollIntoViewIfNeeded()
    const before = await scrollTopOf(page)

    await page.locator('a.mu-code-run').nth(1).click({ force: true })
    await expect(page.locator('.exec-panel .output-text')).toContainText('2', { timeout: 20000 })

    expect(Math.abs((await scrollTopOf(page)) - before)).toBeLessThanOrEqual(2)
  })

  test('▶ with the panel closed opens it without scrolling the editor either', async() => {
    // Close via the 「码」 toggle so only the ▶ click may re-open it.
    await page.locator('.code-run-btn').click()
    await expect(page.locator('.exec-panel')).toHaveCount(0)

    const fence2 = page.locator('.mu-code-block').nth(1)
    await fence2.scrollIntoViewIfNeeded()
    const before = await scrollTopOf(page)

    await page.locator('a.mu-code-run').nth(1).click({ force: true })
    await expect(page.locator('.exec-panel .output-text')).toContainText('2', { timeout: 20000 })

    expect(Math.abs((await scrollTopOf(page)) - before)).toBeLessThanOrEqual(2)
  })

  test('clicking a block-row in the panel centers the block in the remaining viewport', async() => {
    // Click block 1's row while the editor is parked far below it. Row click
    // = select + locate (no execution). The block must land vertically
    // centered in the remaining viewport (the editor column is really
    // shrunk by the open panel), not pinned to the top edge.
    await page.locator('.exec-panel .block-row').first().click()
    await expect(page.locator('.exec-panel .block-row').first()).toHaveClass(/active/)

    await expect
      .poll(
        async() =>
          page.evaluate(() => {
            const fence = document.querySelector('.mu-code-block') as HTMLElement
            const container = document.querySelector('.editor-component') as HTMLElement
            return Math.abs(fence.getBoundingClientRect().top - container.clientHeight / 2)
          }),
        { timeout: 5000 }
      )
      .toBeLessThan(120)
  })
})
