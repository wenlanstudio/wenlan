import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { launchElectron } from './helpers'

// #26 — clicking a file inside the current project tree must not re-root the
// file panel to that file's subfolder. The root is fixed when the file is
// opened; only files from outside the current root re-root the panel.

const rootTitle = (page: Page) => page.locator('.project-tree > .title > span')

const findProjectWindow = async(app: ElectronApplication, rootName: string): Promise<Page> => {
  const found: { page?: Page } = {}
  await expect
    .poll(
      async() => {
        for (const candidate of app.windows()) {
          const title = await candidate.evaluate(
            () => document.querySelector('.project-tree > .title > span')?.textContent ?? ''
          )
          if (title.trim() === rootName) {
            found.page = candidate
            return true
          }
        }
        return false
      },
      { timeout: 20000 }
    )
    .toBe(true)
  return found.page as Page
}

test.describe('#26 sidebar root stays fixed on tree-internal navigation', () => {
  let app: ElectronApplication
  let page: Page
  let projectDir: string
  let outsideDir: string
  let rootName: string
  let outsideName: string
  let outsideFile: string

  test.beforeAll(async() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wenlan-26-'))
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wenlan-26-outside-'))
    rootName = path.basename(projectDir)
    outsideName = path.basename(outsideDir)

    fs.writeFileSync(path.join(projectDir, 'a.md'), '# A\n', 'utf-8')
    fs.writeFileSync(path.join(projectDir, 'c.md'), '# C\n', 'utf-8')
    fs.mkdirSync(path.join(projectDir, 'B'))
    fs.writeFileSync(path.join(projectDir, 'B', 'b.md'), '# B\n', 'utf-8')
    outsideFile = path.join(outsideDir, 'outside.md')
    fs.writeFileSync(outsideFile, '# Outside\n', 'utf-8')

    const launched = await launchElectron([path.join(projectDir, 'a.md')], {
      preferences: { openFilesInNewWindow: false }
    })
    app = launched.app
    page = await findProjectWindow(app, rootName)
  })

  test.afterAll(async() => {
    if (app) await app.close()
    for (const dir of [projectDir, outsideDir]) {
      if (dir) fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('clicking a subfolder file keeps the root and the rest of the tree', async() => {
    await expect(rootTitle(page)).toHaveText(rootName)

    // Trees start with subfolders collapsed; expand B and open b.md from it.
    const folderB = page.locator('.side-bar-folder > .folder-name', { hasText: 'B' })
    await expect(folderB).toBeVisible()
    await folderB.click()

    const fileB = page.locator('.tree-wrapper .side-bar-file[title$="b.md"]')
    await expect(fileB).toBeVisible()
    await fileB.click()
    await expect(fileB).toHaveClass(/\bcurrent\b/, { timeout: 10000 })

    // Before the fix `mt::switch-directory` rebuilt the tree with B as root:
    // the title became B and a.md / c.md disappeared.
    await expect(rootTitle(page)).toHaveText(rootName)
    await expect(page.locator('.tree-wrapper .side-bar-file[title$="a.md"]')).toHaveCount(1)
    await expect(page.locator('.tree-wrapper .side-bar-file[title$="c.md"]')).toHaveCount(1)
    await expect(folderB).toBeVisible()
  })

  test('opening a file outside the current root still re-roots the tree', async() => {
    await expect(rootTitle(page)).toHaveText(rootName)

    // Same path as the file-open dialog / CLI / a tab from another folder:
    // `mt::open-file-by-window-id` opens a tab in the running window.
    await app.evaluate(({ BrowserWindow, ipcMain }, filePath) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) throw new Error('no editor window')
      ipcMain.emit('mt::open-file-by-window-id', {}, win.id, filePath)
    }, outsideFile)

    await expect(rootTitle(page)).toHaveText(outsideName, { timeout: 15000 })
    await expect(
      page.locator('.tree-wrapper .side-bar-file[title$="outside.md"]')
    ).toHaveCount(1)
  })
})
