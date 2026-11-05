import {
  app,
  type BaseWindow,
  type BrowserWindow,
  type MenuItem,
  type MenuItemConstructorOptions
} from 'electron'
import * as actions from '../actions/file'
import { userSetting } from '../actions/marktext'
import { isOsx } from '../../config'
import { t } from '../../i18n'
import type Keybindings from '../../keyboard/shortcutHandler'
import type Preference from '../../preferences'
import { PANDOC_EXPORT_FORMATS } from '../../utils/pandoc'

export default function(
  keybindings: Keybindings,
  userPreference: Preference,
  recentlyUsedFiles: string[]
): MenuItemConstructorOptions {
  const { autoSave, showPandocConvert } = userPreference.getAll()

  // Typora 的「导出」把 HTML、PDF、Word、ODT、RTF 等列在同一级，这里同样平铺，
  // 不再单列一个「用 Pandoc 转换」菜单。依赖 pandoc 的格式仍受 showPandocConvert
  // 控制：没装 pandoc 的机器上若常显这些项，点了只会报错。
  const exportSubmenu: MenuItemConstructorOptions[] = [
    {
      label: t('menu.file.exportHtml'),
      click(_menuItem, browserWindow) {
        actions.exportFile(browserWindow as BrowserWindow | undefined, 'styledHtml')
      }
    },
    {
      label: t('menu.file.exportPdf'),
      accelerator: keybindings.getAccelerator('file.export-file.pdf') ?? undefined,
      click(_menuItem, browserWindow) {
        actions.exportFile(browserWindow as BrowserWindow | undefined, 'pdf')
      }
    }
  ]

  if (showPandocConvert) {
    exportSubmenu.push({ type: 'separator' })
    PANDOC_EXPORT_FORMATS.forEach((format) => {
      exportSubmenu.push({
        label: format.label,
        click(_menuItem: MenuItem, browserWindow: BaseWindow | undefined) {
          actions.exportWithPandoc(browserWindow as BrowserWindow | undefined, format.id)
        }
      })
    })
  }

  const submenu: MenuItemConstructorOptions[] = [
    {
      label: t('menu.file.newWindow'),
      accelerator: keybindings.getAccelerator('file.new-window') ?? undefined,
      click() {
        actions.newEditorWindow()
      }
    },
    {
      // Word 式「新建文档」（#8）：先开无名缓冲 tab，保存时才确定路径；
      // deck/quiz 模板仍走侧栏树右键的「在项目中新建」。「新建标签页」
      // 菜单项随本裁决雪藏（action / 快捷键 / i18n 保留，肌肉记忆可达）。
      label: t('menu.file.newDocument'),
      accelerator: keybindings.getAccelerator('file.new-tab') ?? undefined,
      click(_menuItem, browserWindow) {
        actions.newBlankTab(browserWindow as BrowserWindow | undefined)
      }
    },
    {
      type: 'separator'
    },
    {
      label: t('menu.file.openFile'),
      accelerator: keybindings.getAccelerator('file.open-file') ?? undefined,
      click(_menuItem, browserWindow) {
        actions.openFile((browserWindow as BrowserWindow | undefined) ?? null)
      }
    },
    {
      label: t('menu.file.openFolder'),
      accelerator: keybindings.getAccelerator('file.open-folder') ?? undefined,
      click(_menuItem, browserWindow) {
        actions.openFolder((browserWindow as BrowserWindow | undefined) ?? null)
      }
    }
  ]

  const fileMenu: MenuItemConstructorOptions = {
    label: t('menu.file.file'),
    submenu
  }

  if (!isOsx) {
    const recentlyUsedSubmenu: MenuItemConstructorOptions[] = []
    const recentlyUsedMenu: MenuItemConstructorOptions = {
      label: t('menu.file.openRecent'),
      submenu: recentlyUsedSubmenu
    }

    for (const item of recentlyUsedFiles) {
      recentlyUsedSubmenu.push({
        label: item,
        click(menuItem, browserWindow) {
          if (browserWindow) {
            actions.openFileOrFolder(browserWindow as BrowserWindow, menuItem.label)
          }
        }
      })
    }

    recentlyUsedSubmenu.push(
      {
        type: 'separator',
        visible: recentlyUsedFiles.length > 0
      },
      {
        label: t('menu.file.clearRecentlyUsed'),
        enabled: recentlyUsedFiles.length > 0,
        click() {
          actions.clearRecentlyUsed()
        }
      }
    )
    submenu.push(recentlyUsedMenu)
  } else {
    submenu.push({
      // Electron accepts these MenuItem roles. The types stub camelCase
      // ('recentDocuments' / 'clearRecentDocuments') in recent versions; the JS
      // original used lowercase. Cast to satisfy strict role typing while
      // preserving the original runtime string.
      role: 'recentdocuments' as unknown as MenuItemConstructorOptions['role'],
      submenu: [
        {
          role: 'clearrecentdocuments' as unknown as MenuItemConstructorOptions['role']
        }
      ]
    })
  }

  submenu.push(
    {
      type: 'separator'
    },
    {
      label: t('menu.file.save'),
      accelerator: keybindings.getAccelerator('file.save') ?? undefined,
      click(_menuItem, browserWindow) {
        actions.save(browserWindow as BrowserWindow | undefined)
      }
    },
    {
      label: t('menu.file.saveAs'),
      accelerator: keybindings.getAccelerator('file.save-as') ?? undefined,
      click(_menuItem, browserWindow) {
        actions.saveAs(browserWindow as BrowserWindow | undefined)
      }
    },
    {
      label: t('menu.file.autoSave'),
      type: 'checkbox',
      checked: !!autoSave,
      id: 'autoSaveMenuItem',
      click(menuItem, browserWindow) {
        actions.autoSave(menuItem, browserWindow as BrowserWindow | undefined)
      }
    },
    {
      type: 'separator'
    },
    {
      label: t('menu.file.moveTo'),
      accelerator: keybindings.getAccelerator('file.move-file') ?? undefined,
      click(_menuItem, browserWindow) {
        actions.moveTo(browserWindow as BrowserWindow | undefined)
      }
    },
    {
      label: t('menu.file.rename'),
      accelerator: keybindings.getAccelerator('file.rename-file') ?? undefined,
      click(_menuItem, browserWindow) {
        actions.rename(browserWindow as BrowserWindow | undefined)
      }
    },
    {
      type: 'separator'
    },
    {
      label: t('menu.file.import'),
      click(_menuItem, browserWindow) {
        actions.importFile((browserWindow as BrowserWindow | undefined) ?? null)
      }
    },
    {
      label: t('menu.file.export'),
      submenu: exportSubmenu
    },
    {
      label: t('menu.file.print'),
      accelerator: keybindings.getAccelerator('file.print') ?? undefined,
      click(_menuItem, browserWindow) {
        actions.printDocument(browserWindow as BrowserWindow | undefined)
      }
    },
    {
      type: 'separator',
      visible: !isOsx
    },
    {
      label: t('menu.file.preferences'),
      accelerator: keybindings.getAccelerator('file.preferences') ?? undefined,
      visible: !isOsx,
      click() {
        userSetting()
      }
    },
    {
      type: 'separator'
    },
    {
      label: t('menu.file.closeTab'),
      accelerator: keybindings.getAccelerator('file.close-tab') ?? undefined,
      click(_menuItem, browserWindow) {
        actions.closeTab(browserWindow as BrowserWindow | undefined)
      }
    },
    {
      label: t('menu.file.closeWindow'),
      accelerator: keybindings.getAccelerator('file.close-window') ?? undefined,
      click(_menuItem, browserWindow) {
        actions.closeWindow(browserWindow as BrowserWindow | undefined)
      }
    },
    {
      type: 'separator',
      visible: !isOsx
    },
    {
      label: t('menu.file.quit'),
      accelerator: keybindings.getAccelerator('file.quit') ?? undefined,
      visible: !isOsx,
      click: app.quit
    }
  )
  return fileMenu
}
