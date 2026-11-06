import { type BrowserWindow } from 'electron'
import { openHelpWindow, type HelpSection } from '../../windows/help'

export const showAboutDialog = (win: BrowserWindow | null | undefined): void => {
  if (win && win.webContents) {
    win.webContents.send('mt::about-dialog')
  }
}

/** 帮助菜单 → 文档配置的四个子项：打开独立离线帮助窗口并定位到对应章节。 */
export const showHelpDocs = (section: HelpSection): void => {
  openHelpWindow(section)
}
