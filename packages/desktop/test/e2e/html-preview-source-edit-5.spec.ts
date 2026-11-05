import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithMarkdown } from './helpers'

// Issue #5, desktop full chain. The muya-side spec proves the delegated click
// handler in the standalone harness; this one proves it survives the built
// renderer, where read-only leaf projections host their own Muya instances.

const MD = [
  '# quiz',
  '',
  '<details><summary>答案</summary>**B**。误差出现不依赖缓冲区容量，只要文件数固定，map 数即固定。</details>',
  '',
  '正文。',
  ''
].join('\n')

const editor = (page: Page) => page.locator('.editor-component')
const details = (page: Page) => editor(page).locator('.mu-html-preview details')
const figure = (page: Page) => editor(page).locator('figure.mu-html-block')

/** Click below the <summary> line, i.e. on the exposed content. */
const clickExposedContent = async(page: Page): Promise<void> => {
  const box = await details(page).boundingBox()
  const summaryBox = await editor(page).locator('.mu-html-preview summary').boundingBox()
  if (!box || !summaryBox) throw new Error('details/summary has no box')
  await page.mouse.click(box.x + 20, summaryBox.y + summaryBox.height + 8)
}

test.describe('issue #5 — click rendered HTML to edit its source (desktop)', () => {
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

  test('summary toggles <details> without entering source editing', async() => {
    await expect(details(page)).toBeAttached({ timeout: 10000 })
    expect(await details(page).getAttribute('open')).toBeNull()

    await editor(page).locator('.mu-html-preview summary').click()
    await expect(details(page)).toHaveAttribute('open', '')
    await expect(figure(page)).not.toHaveClass(/mu-active/)

    await editor(page).locator('.mu-html-preview summary').click()
    expect(await details(page).getAttribute('open')).toBeNull()
  })

  test('clicking the exposed content opens the WHOLE details source and edits it', async() => {
    await editor(page).locator('.mu-html-preview summary').click()
    await expect(details(page)).toHaveAttribute('open', '')

    await clickExposedContent(page)

    await expect(figure(page)).toHaveClass(/mu-active/)
    const source = editor(page).locator('.mu-html-container')
    await expect(source).toBeVisible()
    expect(await source.innerText()).toContain('<details>')
    expect(await source.innerText()).toContain('</details>')

    // The caret sits at the end of the source block: typing edits the HTML
    // instead of creating a new block or deleting the whole <details>.
    await page.keyboard.type('!')
    await expect.poll(() => source.innerText()).toContain('!')
    expect(await source.innerText()).toContain('<details>')
    await expect(figure(page)).toHaveCount(1)
  })
})
