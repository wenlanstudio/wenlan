import path from 'path'
import { app, BrowserWindow } from 'electron'
import type { BrowserWindowConstructorOptions } from 'electron'
import BaseWindow, { WindowLifecycle, WindowType } from './base'
import type Accessor from '../app/accessor'
import { centerWindowOptions } from './utils'
import { preferencesWinOptions, isLinux, isOsx, isWindows } from '../config'
import log from 'electron-log'

/**
 * 教学客户端窗口（edu-client E2）。
 *
 * 加载同一个 renderer bundle 的 `/teaching` 路由（双窗口，不抽包）。与编辑器窗口
 * 共用 main 登录态单例；关闭本窗口 = 离开教学场景，token 留在 main 下次秒进。
 */
class TeachingWindow extends BaseWindow {
  constructor(accessor: Accessor) {
    super(accessor)
    this.type = WindowType.TEACHING
  }

  createWindow(): BrowserWindow {
    const { env, preferences } = this._accessor
    const winOptions: BrowserWindowConstructorOptions = Object.assign(
      {},
      preferencesWinOptions,
      {
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        minimizable: true,
        fullscreenable: true
      }
    )
    centerWindowOptions(
      winOptions as BrowserWindowConstructorOptions & {
        width: number
        height: number
        x?: number
        y?: number
      }
    )
    if (isLinux || (isWindows && !app.isPackaged)) {
      winOptions.icon = path.join(
        (global as unknown as { __static: string }).__static,
        'logo-96px.png'
      )
    }

    winOptions.resizable = true

    const { titleBarStyle, theme } = preferences.getAll()
    if (!isOsx) {
      winOptions.titleBarStyle = 'default'
      if (titleBarStyle === 'native') {
        winOptions.frame = true
      }
    }
    winOptions.backgroundColor = this._getPreferredBackgroundColor(theme)

    let win: BrowserWindow | null = (this.browserWindow = new BrowserWindow(winOptions))

    win.webContents.on('did-fail-load', (_event, code, desc, url) => {
      log.error(`did-fail-load ${code} ${desc} @ ${url}`)
    })
    win.webContents.on('render-process-gone', (_event, details) => {
      log.error(`render-process-gone: ${details.reason} (${details.exitCode})`)
    })

    this.id = win.id

    // D10：/teaching 复用完整 App 壳，壳的 init 旗标要靠这条 bootstrap 才置位
    //（编辑器窗口在 did-finish-load 里发；精简壳时代没有这条，改为 App 后空屏）。
    // 教学窗口永远不自动开文档：addBlankTab=true 只给一个空白工作区。
    win.webContents.once('did-finish-load', () => {
      const { sideBarVisibility, restoreLayoutState, sourceCodeModeEnabled } = preferences.getAll()
      win?.webContents.send('mt::bootstrap-editor', {
        addBlankTab: true,
        markdownList: [],
        lineEnding: preferences.getPreferredEol(),
        sideBarVisibility: restoreLayoutState ? !!sideBarVisibility : true,
        sourceCodeModeEnabled
      })
    })

    win.once('ready-to-show', () => {
      this.lifecycle = WindowLifecycle.READY
      this.emit('window-ready')
    })

    win.on('focus', () => {
      this.emit('window-focus')
      win?.webContents.send('mt::window-active-status', { status: true })
    })

    win.on('blur', () => {
      this.emit('window-blur')
      win?.webContents.send('mt::window-active-status', { status: false })
    })

    win.on('close', () => {
      this.emit('window-close')
      // 教学窗口直接关闭，不拦截：离开教学场景无需确认。
    })

    win.on('closed', () => {
      this.emit('window-closed')
      win = null
    })

    this.lifecycle = WindowLifecycle.LOADING
    win.loadURL(this._buildUrlString(this.id, env, preferences))
    win.setSheetOffset(0)

    return win
  }
}

export default TeachingWindow
