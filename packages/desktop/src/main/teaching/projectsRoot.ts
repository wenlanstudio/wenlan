import fs from 'fs'
import os from 'os'
import path from 'path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import log from 'electron-log'
import { t } from '../i18n'
import { isDriveRoot } from 'common/filesystem/paths'

/**
 * 课程工作区（edu-client E3.0）的本地根目录。
 *
 * 位置存在偏好 `projectsRoot`：安装器在「选择安装位置」之后可预置一个自定义
 * 目录（写 UTF-16LE 交接文件，首次启动采用一次），运行期从「教学」菜单更换。
 * 每个课程在根下惰性建 `doc/`、`code/`；根锚点 `.wenlan/workspace.json`
 * 用来在用户手动挪动目录后重新识别它。
 */
const ANCHOR_DIR = '.wenlan'
const ANCHOR_FILE = 'workspace.json'
const INSTALLER_HANDOFF = 'installer-projects.txt'
const DEFAULT_DIR_NAME = 'WenlanProjects'

interface PreferencesAccessor {
  getItem<T = unknown>(key: string): T
  setItem(key: string, value: unknown): void
}

let preferences: PreferencesAccessor | null = null

const asPath = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const requirePreferences = (): PreferencesAccessor => {
  if (!preferences) {
    throw new Error('teaching projects root is not initialized')
  }
  return preferences
}

export const defaultProjectsRoot = (): string => path.join(os.homedir(), DEFAULT_DIR_NAME)

/** 解析当前根：空值落默认路径并回写偏好；顺手补齐目录与根锚点。 */
export const ensureProjectsRoot = (): string => {
  const prefs = requirePreferences()
  let root = asPath(prefs.getItem<string>('projectsRoot'))
  if (!root || isDriveRoot(root)) {
    // A persisted volume root (e.g. a bad installer handoff or an old build)
    // would be opened as the file-tree root and watch the entire disk.
    if (root) {
      log.warn(`[teaching] ignoring invalid projectsRoot volume root: ${root}`)
    }
    root = defaultProjectsRoot()
    prefs.setItem('projectsRoot', root)
  }
  fs.mkdirSync(root, { recursive: true })

  const anchorDir = path.join(root, ANCHOR_DIR)
  const anchor = path.join(anchorDir, ANCHOR_FILE)
  if (!fs.existsSync(anchor)) {
    fs.mkdirSync(anchorDir, { recursive: true })
    fs.writeFileSync(
      anchor,
      `${JSON.stringify({ schemaVersion: 1, kind: 'course-workspace' }, null, 2)}\n`,
      'utf8'
    )
  }
  return root
}

const openInWindow = (win: BrowserWindow, root: string, activateTab: boolean): void => {
  ipcMain.emit('app-open-directory-by-id', win.id, root, true, activateTab)
}

/** 安装器交接文件只在偏好为空时采用一次；重复安装不会覆盖用户后来改过的位置。 */
export const applyInstallerProjectsRoot = (userDataPath: string): void => {
  if (!preferences) return
  const handoff = path.join(userDataPath, INSTALLER_HANDOFF)
  if (!fs.existsSync(handoff)) return

  try {
    const picked = fs.readFileSync(handoff, 'utf16le').replace(/^\uFEFF/, '').trim()
    if (picked && isDriveRoot(picked)) {
      log.warn(`[teaching] installer proposed a volume root, ignoring: ${picked}`)
    } else if (picked && !asPath(preferences.getItem<string>('projectsRoot'))) {
      preferences.setItem('projectsRoot', picked)
      log.info(`[teaching] projectsRoot seeded from installer: ${picked}`)
    }
  } catch (error) {
    log.warn('[teaching] failed to read installer projects handoff', error)
  } finally {
    fs.rmSync(handoff, { force: true })
  }
}

const reportFailure = (error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error)
  log.error('[teaching] course workspace unavailable:', error)
  dialog.showErrorBox(t('teaching.workspaceError'), message)
}

export const openProjectsRootForWindow = (win: BrowserWindow, activateTab = true): string => {
  try {
    const root = ensureProjectsRoot()
    openInWindow(win, root, activateTab)
    return root
  } catch (error) {
    reportFailure(error)
    return ''
  }
}

/** 原生目录选择器；取消返回 null，选中即回写偏好并打开。 */
export const chooseProjectsRootForWindow = async(win: BrowserWindow): Promise<string | null> => {
  const current =
    asPath(requirePreferences().getItem<string>('projectsRoot')) || defaultProjectsRoot()
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: t('teaching.workspaceChooseTitle'),
    defaultPath: current,
    properties: ['openDirectory', 'createDirectory']
  })
  if (canceled || !filePaths?.[0]) return null

  if (isDriveRoot(filePaths[0])) {
    dialog.showErrorBox(t('teaching.workspaceError'), t('dialog.driveRootWorkspaceBody'))
    return null
  }

  try {
    requirePreferences().setItem('projectsRoot', filePaths[0])
  } catch (error) {
    reportFailure(error)
    return null
  }
  return openProjectsRootForWindow(win)
}

export const initTeachingProjects = (
  accessor: PreferencesAccessor,
  userDataPath: string
): void => {
  preferences = accessor
  applyInstallerProjectsRoot(userDataPath)

  ipcMain.handle('teaching::get-projects-root', () => {
    const configured = asPath(requirePreferences().getItem<string>('projectsRoot'))
    return configured || defaultProjectsRoot()
  })

  ipcMain.handle('teaching::open-projects-root', (event, options?: { activateTab?: boolean }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) {
      try {
        return ensureProjectsRoot()
      } catch (error) {
        reportFailure(error)
        return ''
      }
    }
    return openProjectsRootForWindow(win, options?.activateTab !== false)
  })

  ipcMain.handle('teaching::choose-projects-root', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win ? chooseProjectsRootForWindow(win) : null
  })
}
