import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  clickMenuById,
  launchElectron,
  openProjectFolder,
  readActiveTabFilename,
  sendIpcToRenderer
} from './helpers'

// #528 — the fixture overflows the list on purpose: the folder of many files
// sorts above the folder holding the deep file, pushing that row below the fold.

const BULK_FILES = 25

interface Fixture {
  root: string
  bulk: string
  target: string
  deep: string
  top: string
  bulkFile: (index: number) => string
}

const createFixture = (): Fixture => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-reveal-'))
  const bulk = path.join(root, 'a-bulk')
  const target = path.join(root, 'z-target')
  fs.mkdirSync(bulk, { recursive: true })
  fs.mkdirSync(target, { recursive: true })
  const bulkFile = (index: number): string =>
    path.join(bulk, `f-${String(index).padStart(2, '0')}.md`)
  for (let i = 0; i < BULK_FILES; i++) {
    fs.writeFileSync(bulkFile(i), `# f-${i}\n`)
  }
  const deep = path.join(target, 'deep.md')
  fs.writeFileSync(deep, '# deep\n')
  const top = path.join(root, 'top.md')
  fs.writeFileSync(top, '# top\n')
  return { root, bulk, target, deep, top, bulkFile }
}

const treeRow = (page: Page, filePath: string) =>
  page.locator(`.tree-wrapper .side-bar-file[title="${filePath}"]`)

const folderHeader = (page: Page, folderPath: string) =>
  page.locator(`.tree-wrapper .folder-name[title="${folderPath}"]`)

// The tab strip is gone: switching to an already-open document is now done from
// the side bar tree (clicking its row calls UPDATE_CURRENT_FILE), exactly the
// way a user reaches it.
const switchToTab = async(page: Page, filePath: string): Promise<void> => {
  await treeRow(page, filePath).click()
  await expect.poll(() => readActiveTabFilename(page)).toBe(path.basename(filePath))
}

// Hide the sidebar through the same View-menu entry the bottom-left button
// routes to (the icon strip it used to collapse to no longer exists).
const filesIcon = async(app: ElectronApplication): Promise<void> => {
  await clickMenuById(app, 'sideBarMenuItem')
}

const sideBarWidth = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const el = document.querySelector('.side-bar') as HTMLElement | null
    return el ? Math.round(el.getBoundingClientRect().width) : 0
  })

const treeScrollTop = (page: Page): Promise<number> =>
  page.evaluate(() => (document.querySelector('.tree-wrapper') as HTMLElement).scrollTop)

const scrollTreeTo = async(page: Page, top: number): Promise<void> => {
  await page.evaluate((value) => {
    ;(document.querySelector('.tree-wrapper') as HTMLElement).scrollTop = value
  }, top)
}

const isFolderCollapsed = (page: Page, folderPath: string): Promise<boolean> =>
  page.evaluate((selector) => {
    const arrow = document.querySelector(`${selector} .icon-arrow`)
    return !!arrow && arrow.classList.contains('fold')
  }, `.tree-wrapper .folder-name[title="${folderPath}"]`)

const setFolderExpanded = async(
  page: Page,
  folderPath: string,
  expanded: boolean
): Promise<void> => {
  if ((await isFolderCollapsed(page, folderPath)) !== expanded) return
  await folderHeader(page, folderPath).click()
}

const isRowVisible = (page: Page, filePath: string): Promise<boolean> =>
  page.evaluate((selector) => {
    const row = document.querySelector(selector)
    const container = document.querySelector('.tree-wrapper')
    if (!row || !container) return false
    const rowRect = row.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    return rowRect.top >= containerRect.top - 1 && rowRect.bottom <= containerRect.bottom + 1
  }, `.tree-wrapper .side-bar-file[title="${filePath}"]`)

const openProject = async(app: ElectronApplication, page: Page, root: string): Promise<void> => {
  await page.waitForSelector('.side-bar', { timeout: 15000 })
  await openProjectFolder(app, page, root, path.join(root, 'top.md'))
}

const openFileFromTree = async(page: Page, filePath: string): Promise<void> => {
  await treeRow(page, filePath).click()
  await expect
    .poll(() => readActiveTabFilename(page), { timeout: 10000 })
    .toBe(path.basename(filePath))
}

test.describe('#528 reveal active file in the side bar', () => {
  let app: ElectronApplication
  let page: Page
  const fixture = createFixture()

  test.beforeAll(async() => {
    const launched = await launchElectron()
    app = launched.app
    page = launched.page
    await openProject(app, page, fixture.root)
  })

  test.afterAll(async() => {
    if (app) await app.close()
    fs.rmSync(fixture.root, { recursive: true, force: true })
  })

  test('switching to a tab re-expands its folders and scrolls the row into view', async() => {
    await setFolderExpanded(page, fixture.bulk, true)
    await setFolderExpanded(page, fixture.target, true)
    await openFileFromTree(page, fixture.deep)
    await openFileFromTree(page, fixture.top)

    await setFolderExpanded(page, fixture.target, false)
    await scrollTreeTo(page, 0)
    await expect(treeRow(page, fixture.deep)).toHaveCount(0)

    await switchToTab(page, fixture.deep)

    await expect(treeRow(page, fixture.deep)).toHaveCount(1)
    await expect(treeRow(page, fixture.deep)).toHaveClass(/current/)
    expect(await isFolderCollapsed(page, fixture.target)).toBe(false)
    await expect.poll(() => isRowVisible(page, fixture.deep)).toBe(true)
    expect(await treeScrollTop(page)).toBeGreaterThan(0)
    // Other folders keep the state the user left them in.
    expect(await isFolderCollapsed(page, fixture.bulk)).toBe(false)
  })

  test('leaves the scroll position alone when the row is already visible', async() => {
    await setFolderExpanded(page, fixture.bulk, true)
    await scrollTreeTo(page, 0)

    // Both rows are visible at scrollTop 0, so neither switch may move the list.
    await openFileFromTree(page, fixture.bulkFile(10))
    await expect(treeRow(page, fixture.bulkFile(10))).toHaveClass(/current/)
    await page.waitForTimeout(150)
    expect(await treeScrollTop(page)).toBe(0)

    await openFileFromTree(page, fixture.bulkFile(11))
    await expect(treeRow(page, fixture.bulkFile(11))).toHaveClass(/current/)
    await page.waitForTimeout(150)
    expect(await treeScrollTop(page)).toBe(0)
  })
})

test.describe('#528 reveal with autoRevealInSidebar turned off', () => {
  let app: ElectronApplication
  let page: Page
  const fixture = createFixture()

  test.beforeAll(async() => {
    const launched = await launchElectron(undefined, {
      preferences: { autoRevealInSidebar: false }
    })
    app = launched.app
    page = launched.page
    await openProject(app, page, fixture.root)

    // The state the manual "Show in Side Bar" command has to fix up.
    await setFolderExpanded(page, fixture.bulk, true)
    await setFolderExpanded(page, fixture.target, true)
    await openFileFromTree(page, fixture.deep)
    await openFileFromTree(page, fixture.top)
    await switchToTab(page, fixture.deep)
    await setFolderExpanded(page, fixture.target, false)
  })

  test.afterAll(async() => {
    if (app) await app.close()
    fs.rmSync(fixture.root, { recursive: true, force: true })
  })

  test('switching documents does not touch the tree', async() => {
    await switchToTab(page, fixture.top)
    await switchToTab(page, fixture.deep)

    expect(await isFolderCollapsed(page, fixture.target)).toBe(true)
    await expect(treeRow(page, fixture.deep)).toHaveCount(0)
  })

  // The "reveal" entry point used to live in the tab context menu. Its live
  // equivalent is the `file.reveal-in-sidebar` command (reachable from the
  // command palette), which still walks the same project-store path.
  test('the reveal-in-sidebar command reveals the file anyway', async() => {
    await sendIpcToRenderer(app, 'mt::execute-command-by-id', 'file.reveal-in-sidebar')

    await filesIcon(app)
    await expect.poll(() => sideBarWidth(page)).toBeLessThan(60)

    await sendIpcToRenderer(app, 'mt::execute-command-by-id', 'file.reveal-in-sidebar')

    await expect.poll(() => sideBarWidth(page)).toBeGreaterThan(200)
    await expect(treeRow(page, fixture.deep)).toHaveCount(1)
    await expect(treeRow(page, fixture.deep)).toHaveClass(/current/)
    await expect.poll(() => isRowVisible(page, fixture.deep)).toBe(true)
  })
})

test.describe('#528 reveal when the project is opened after the file', () => {
  let app: ElectronApplication
  let page: Page
  const fixture = createFixture()

  test.beforeAll(async() => {
    // The file is active before its folder becomes the project, the way a
    // restored session or "open the folder I am working in" starts out.
    const launched = await launchElectron([fixture.deep])
    app = launched.app
    page = launched.page
    await expect
      .poll(() => readActiveTabFilename(page), { timeout: 20000 })
      .toBe(path.basename(fixture.deep))
  })

  test.afterAll(async() => {
    if (app) await app.close()
    fs.rmSync(fixture.root, { recursive: true, force: true })
  })

  test('reveals the file once the watcher delivers its folder', async() => {
    await openProjectFolder(app, page, fixture.root, fixture.top)

    await expect(treeRow(page, fixture.deep)).toHaveCount(1, { timeout: 10000 })
    expect(await isFolderCollapsed(page, fixture.target)).toBe(false)
    await expect.poll(() => isRowVisible(page, fixture.deep)).toBe(true)
  })
})
