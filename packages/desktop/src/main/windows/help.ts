import path from 'path'
import fs from 'fs'
import { app, BrowserWindow, dialog, nativeTheme } from 'electron'
import { t } from '../i18n'
import { isOsx } from '../config'

/**
 * 离线帮助窗口（文档配置 / frontmatter）。
 *
 * 为什么要独立窗口：四份文档合起来篇幅较长，编辑器主窗口的左侧 side-bar
 * 已经是「项目文件树」，再往里塞一套帮助导航会与它争抢同一块位置、语义打架。
 * 独立 BrowserWindow 自带左侧目录、可缩放/多开对比、不受主窗口布局影响。
 *
 * 为什么不用 windowManager / BaseWindow：帮助窗口没有文档、编辑器或 watcher
 * 状态，不该参与编辑器窗口的生命周期与菜单状态机（activeWindow / 退出拦截）。
 * 这里用模块级单例自己管，关闭即释放引用。
 *
 * 页面是 `static/help/index.html` —— 由 scripts/sync-help-docs.mjs 把四个
 * 组件的 docs/FRONTMATTER.md 预渲染成的一份自包含静态页（无外部资源、
 * 无运行时依赖）。static/ 已经由 electron-builder 的 extraResources 随包发布，
 * 因此离线可用，独立发布 CI 里没有兄弟仓也不会缺件。
 */

/** 查看器页里的 section id，同时作为菜单项参数与 URL hash。 */
export const HELP_SECTIONS = [
  'overview',
  'wenlan',
  'md2slides',
  'mdcode2run',
  'classbuzz'
] as const

export type HelpSection = (typeof HELP_SECTIONS)[number]

const isHelpSection = (value: string): value is HelpSection =>
  (HELP_SECTIONS as readonly string[]).includes(value)

let helpWindow: BrowserWindow | null = null

const getHelpFilePath = (): string => {
  // Packaged: extraResources `from: static → to: static` puts it under
  // <resources>/static/help/. Dev / preview / e2e: read from the app directory.
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath()
  return path.join(base, 'static', 'help', 'index.html')
}

/**
 * 打开帮助窗口并定位到指定章节。窗口已存在时复用（重新加载以切章节），
 * 不重复开窗口。
 */
export const openHelpWindow = (section: HelpSection = 'overview'): void => {
  const file = getHelpFilePath()
  if (!fs.existsSync(file)) {
    dialog.showErrorBox(
      t('menu.help.frontmatterDocs'),
      `帮助文档缺失：${file}\n\n请重新安装文览；开发者可在仓库根目录运行 \`node scripts/sync-help-docs.mjs\`。`
    )
    return
  }

  const target = isHelpSection(section) ? section : 'overview'

  if (helpWindow && !helpWindow.isDestroyed()) {
    helpWindow.loadFile(file, { hash: target })
    if (helpWindow.isMinimized()) helpWindow.restore()
    helpWindow.focus()
    return
  }

  // 只影响页面加载前的窗口底色；页面自身用 prefers-color-scheme 跟随系统明暗。
  const backgroundColor = nativeTheme.shouldUseDarkColors ? '#1E1E20' : '#FDFAF3'
  const win = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    title: t('menu.help.frontmatterDocs'),
    backgroundColor,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })
  helpWindow = win

  // Windows/Linux：去掉帮助窗口的菜单栏（主窗口侧栏已够用，也避免菜单项
  // 指向编辑器状态）。macOS 的 setMenu(null) 会连整个应用菜单一起移除，
  // 影响其它窗口，因此只在非 macOS 调用。
  if (!isOsx) {
    win.setMenu(null)
  }

  win.on('closed', () => {
    if (helpWindow === win) helpWindow = null
  })

  win.webContents.on('did-fail-load', (_event, code, desc, url) => {
     
    console.error(`[help] did-fail-load ${code} ${desc} @ ${url}`)
  })

  win.loadFile(file, { hash: target })
}
