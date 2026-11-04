import path from 'path'
import { app, BrowserWindow, dialog, shell } from 'electron'
import Store from 'electron-store'
import log from 'electron-log'
import { isFile } from 'common/filesystem'
import { checkUpdatesSilently, RELEASES_URL } from './menu/actions/marktext'

const UPDATE_STORE_NAME = 'update-check'
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
const STARTUP_DELAY_MS = 30_000
const GITHUB_LATEST_API = 'https://api.github.com/repos/wenlanstudio/wenlan/releases/latest'

interface UpdateCheckStore {
  lastStartupCheckAt: number
}

// electron-updater needs the `app-update.yml` manifest that electron-builder
// writes into the installer's resources (requires the `publish` config in
// electron-builder.yml). Without it, checkForUpdates() just throws.
const isRuntimeUpdatable = (): boolean =>
  process.platform !== 'darwin' && isFile(path.join(process.resourcesPath, 'app-update.yml'))

const isNewerVersion = (remote: string, current: string): boolean => {
  const parse = (v: string) =>
    v
      .replace(/^v/, '')
      .split(/[.\-+]/)
      .map((part) => Number.parseInt(part, 10) || 0)
  const a = parse(remote)
  const b = parse(current)
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) {
      return (a[i] ?? 0) > (b[i] ?? 0)
    }
  }
  return false
}

// macOS builds are ad-hoc signed, so electron-updater cannot install updates
// (it requires a valid code signature). Fall back to the GitHub API: if a
// newer release exists, ask the user to download it from the releases page.
const checkForUpdateOnMac = async(): Promise<void> => {
  try {
    const response = await fetch(GITHUB_LATEST_API, {
      headers: { Accept: 'application/vnd.github+json' }
    })
    if (!response.ok) {
      log.warn(`[update] GitHub API returned ${response.status}`)
      return
    }
    const data = (await response.json()) as { tag_name?: string }
    const latest = data.tag_name
    if (!latest || !isNewerVersion(latest, app.getVersion())) {
      return
    }
    const win = BrowserWindow.getAllWindows()[0] ?? null
    if (!win) {
      return
    }
    const { response: button } = await dialog.showMessageBox(win, {
      type: 'info',
      message: 'A new version is available',
      detail: `Wenlan ${latest.replace(/^v/, '')} is available for download.`,
      buttons: ['Open Releases Page', 'Later'],
      defaultId: 0,
      cancelId: 1
    })
    if (button === 0) {
      await shell.openExternal(RELEASES_URL)
    }
  } catch (err: unknown) {
    log.warn('[update] macOS update check failed:', err instanceof Error ? err.message : err)
  }
}

// Runs once per day, 30 seconds after startup so it never competes with the
// editor boot sequence. Silent: the user only sees anything when an update
// exists.
export const scheduleStartupUpdateCheck = (): void => {
  if (!app.isPackaged) {
    return
  }

  const store = new Store<UpdateCheckStore>({ name: UPDATE_STORE_NAME })
  const last = store.get('lastStartupCheckAt', 0)
  if (Date.now() - last < CHECK_INTERVAL_MS) {
    return
  }
  store.set('lastStartupCheckAt', Date.now())

  setTimeout(() => {
    if (process.platform === 'darwin') {
      void checkForUpdateOnMac()
      return
    }
    if (!isRuntimeUpdatable()) {
      log.info('[update] runtime is not updatable; skipping startup update check')
      return
    }
    checkUpdatesSilently(BrowserWindow.getAllWindows()[0] ?? null)
  }, STARTUP_DELAY_MS)
}
