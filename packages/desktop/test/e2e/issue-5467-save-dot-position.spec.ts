import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { launchElectron, sendIpcToRenderer, typeIntoEditor, waitForEditor, waitForMenuReady } from './helpers'

// The title bar's unsaved-changes dot is now the ONLY thing left in the title
// slot: #5467 pinned it left of the breadcrumb, and the breadcrumb itself was
// removed later (the slot is being kept free for the activity hub). What is
// still worth pinning is that the dot tracks the document's dirty state and
// stays rendered inside the title bar instead of being clipped away.

const SELECTOR = '.title-bar .title .save-dot'

const FILENAME = 'the-document-name.md'
const roots: string[] = []

test.afterAll(() => {
  for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true })
})

const openIn = async(
  folders: string[]
): Promise<{ app: ElectronApplication; page: Page }> => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-e2etest-5467-'))
  roots.push(root)
  const dir = path.join(root, ...folders)
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, FILENAME)
  fs.writeFileSync(filePath, 'Alpha\n', 'utf8')

  const { app, page } = await launchElectron([filePath])
  await waitForEditor(page)
  await waitForMenuReady(app)
  return { app, page }
}

const boxOf = async(page: Page, selector: string) => {
  const box = await page.locator(selector).boundingBox()
  if (!box) throw new Error(`${selector} has no box`)
  return box
}

const markDirty = async(page: Page): Promise<void> => {
  await typeIntoEditor(page, 'x')
  await expect(page.locator(SELECTOR)).toHaveClass(/show/)
}

test('the unsaved dot only shows while the document is dirty', async() => {
  const { app, page } = await openIn(['notes'])
  try {
    const dot = page.locator(SELECTOR)
    await expect(dot).toBeAttached()
    expect(await dot.getAttribute('class')).not.toMatch(/\bshow\b/)

    await markDirty(page)

    // Saving through the File > Save channel replies `mt::tab-saved`, which
    // clears the dot again.
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => dot.getAttribute('class'), { timeout: 5000 }).not.toMatch(
      /\bshow\b/
    )
  } finally {
    await app.close()
  }
})

test('the dot stays visible inside the title bar even for a deep path', async() => {
  const { app, page } = await openIn([
    'aVeryLongFolderNameIndeed',
    'anotherExtremelyLongFolderName',
    'yetAnotherRatherLongFolderName'
  ])
  try {
    await markDirty(page)

    const dot = await boxOf(page, SELECTOR)
    const title = await boxOf(page, '.title-bar .title')
    const bar = await boxOf(page, '.title-bar')

    expect(dot.width).toBeGreaterThan(0)
    expect(dot.height).toBeGreaterThan(0)
    expect(dot.x).toBeGreaterThanOrEqual(bar.x)
    expect(dot.x + dot.width).toBeLessThanOrEqual(bar.x + bar.width + 1)
    expect(dot.x).toBeGreaterThanOrEqual(title.x)
    expect(dot.x + dot.width).toBeLessThanOrEqual(title.x + title.width + 1)
  } finally {
    await app.close()
  }
})
