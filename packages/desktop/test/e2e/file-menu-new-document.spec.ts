import { expect, test } from '@playwright/test'
import { launchWithMarkdown, waitForMenuReady } from './helpers'

// #8 文件菜单手术（Word 式无名文档）：
// - 「新建标签页」菜单项雪藏（action / 快捷键 / i18n 保留）；
// - 「在项目中新建」→「新建文档」：无子菜单，落点无名 tab，保存时才定路径；
// - 单独按 Alt 唤出自绘菜单栏并打开首个菜单（「文件」）。
// 语言随系统 locale 自动检测，标签断言做中英双语容错。

interface MenuItemLike {
  label: string
  id?: string
  submenu?: MenuItemLike[]
}

type WindowControl = {
  getMenuStructure: () => Promise<MenuItemLike[]>
  executeMenuItem: (id: string) => void
}

const FILE_LABELS = ['File', '文件']
const NEW_DOC_LABELS = ['New Document', '新建文档']
const NEW_TAB_LABELS = ['New Tab', '新建标签页']

test('#8 file menu: newTab hidden, Word-style newDocument, Alt focuses File', async() => {
  test.setTimeout(120_000)
  const sentinel = 'keepme-sentinel-42'
  const { app, page } = await launchWithMarkdown(`# Title\n\n${sentinel}`)
  try {
    await waitForMenuReady(app)

    // —— 菜单结构：无「新建标签页」；「新建文档」在且无子菜单。 ——
    const fileSubmenu = await page.evaluate(async() => {
      const fileLabels = ['File', '文件']
      const wc = (window as unknown as { electron: { windowControl: WindowControl } }).electron
        .windowControl
      const menus = await wc.getMenuStructure()
      const file = menus.find((m) => fileLabels.includes(m.label))
      return (
        file?.submenu?.map((i) => ({
          label: i.label,
          id: i.id,
          hasSubmenu: (i.submenu?.length ?? 0) > 0
        })) ?? null
      )
    })
    expect(fileSubmenu, 'File menu should exist').not.toBeNull()
    const labels = fileSubmenu!.map((i) => i.label)
    for (const t of NEW_TAB_LABELS) {
      expect(labels, `"${t}" menu entry should be hibernated`).not.toContain(t)
    }
    const newDoc = fileSubmenu!.find((i) => NEW_DOC_LABELS.includes(i.label))
    expect(newDoc, 'New Document entry should exist').toBeDefined()
    expect(newDoc!.hasSubmenu, 'New Document must have no submenu (Word-style)').toBe(false)

    // —— Alt 唤出：展开菜单栏且首个菜单（文件）打开；Esc 收起。 ——
    await page.keyboard.press('Alt')
    await expect(page.locator('.menu-bar-roots')).toBeVisible()
    await expect(page.locator('.menu-bar-root.is-open')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(page.locator('.menu-bar-root.is-open')).toHaveCount(0)

    // —— 执行「新建文档」：换上无名空白 tab（哨兵内容消失）。 ——
    const before = await page.evaluate(
      () => document.querySelector('.mu-container')?.textContent ?? ''
    )
    expect(before).toContain(sentinel)
    await page.evaluate(async() => {
      const fileLabels = ['File', '文件']
      const docLabels = ['New Document', '新建文档']
      const wc = (window as unknown as { electron: { windowControl: WindowControl } }).electron
        .windowControl
      const menus = await wc.getMenuStructure()
      const file = menus.find((m) => fileLabels.includes(m.label))
      const item = file?.submenu?.find((i) => docLabels.includes(i.label))
      if (item?.id) wc.executeMenuItem(item.id)
    })
    await page.waitForTimeout(500)
    const after = await page.evaluate(
      () => document.querySelector('.mu-container')?.textContent ?? ''
    )
    expect(after, 'a blank untitled tab should replace the opened document').not.toContain(sentinel)
  } finally {
    await app.close()
  }
})
