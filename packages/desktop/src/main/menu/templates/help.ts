import path from 'path'
import { shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { isFile } from 'common/filesystem'
import * as actions from '../actions/help'
import { checkUpdates } from '../actions/marktext'
import { t } from '../../i18n'

/// Check whether the package is updatable at runtime.
const isUpdatable = (): boolean => {
  // TODO: If not updatable, allow to check whether there is a new version available.

  const resFile = isFile(path.join(process.resourcesPath, 'app-update.yml'))
  if (!resFile) {
    // No update resource file available.
    return false
  } else if (process.env.APPIMAGE) {
    // We are running as AppImage.
    return true
  } else if (process.platform === 'win32' && isFile(path.join(process.resourcesPath, 'md.ico'))) {
    // Windows is a little but tricky. The update resource file is always available and
    // there is no way to check the target type at runtime (electron-builder#4119).
    // As workaround we check whether "md.ico" exists that is only included in the setup.
    return true
  }

  // Otherwise assume that we cannot perform an auto update (standalone binary, archives,
  // packed for package manager).
  return false
}

export default function(): MenuItemConstructorOptions {
  const submenu: MenuItemConstructorOptions[] = [
    // 离线帮助：四份 frontmatter 文档分别由各项目维护，构建时同步进 static/help/。
    // 独立窗口承载（不与主窗口的 side-bar 文件树争左侧位置），可离线查阅。
    {
      label: t('menu.help.frontmatterDocs'),
      submenu: [
        {
          label: t('menu.help.frontmatterWenlan'),
          click() {
            actions.showHelpDocs('wenlan')
          }
        },
        {
          label: t('menu.help.frontmatterSlides'),
          click() {
            actions.showHelpDocs('md2slides')
          }
        },
        {
          label: t('menu.help.frontmatterCodeRun'),
          click() {
            actions.showHelpDocs('mdcode2run')
          }
        },
        {
          label: t('menu.help.frontmatterQuiz'),
          click() {
            actions.showHelpDocs('classbuzz')
          }
        }
      ]
    },
    {
      type: 'separator'
    },
    {
      label: t('menu.help.markdownReference'),
      click() {
        shell.openExternal(
          'https://marktext.me/docs/markdown-syntax'
        )
      }
    },
    {
      label: t('menu.help.changelog'),
      click() {
        shell.openExternal('https://github.com/wenlanstudio/wenlan/releases')
      }
    },
    {
      type: 'separator'
    },
    {
      label: t('menu.help.askQuestion'),
      click() {
        shell.openExternal('https://github.com/wenlanstudio/wenlan/issues')
      }
    },
    {
      label: t('menu.help.reportBug'),
      click() {
        shell.openExternal('https://github.com/wenlanstudio/wenlan/issues/new/choose')
      }
    },
    {
      label: t('menu.help.viewSource'),
      click() {
        shell.openExternal('https://github.com/wenlanstudio/wenlan')
      }
    },
    {
      type: 'separator'
    },
    {
      label: t('menu.help.license'),
      click() {
        shell.openExternal('https://github.com/wenlanstudio/wenlan/blob/develop/LICENSE')
      }
    }
  ]

  const helpMenu: MenuItemConstructorOptions = {
    label: t('menu.help.help'),
    role: 'help',
    submenu
  }

  if (isUpdatable()) {
    submenu.push(
      {
        type: 'separator'
      },
      {
        label: t('menu.help.checkUpdates'),
        click(_menuItem, browserWindow) {
          checkUpdates((browserWindow as BrowserWindow | undefined) ?? null)
        }
      }
    )
  }

  if (process.platform !== 'darwin') {
    submenu.push(
      {
        type: 'separator'
      },
      {
        label: t('menu.help.about'),
        click(_menuItem, browserWindow) {
          actions.showAboutDialog(browserWindow as BrowserWindow | undefined)
        }
      }
    )
  }
  return helpMenu
}
