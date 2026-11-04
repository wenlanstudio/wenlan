import { autoUpdater } from 'electron-updater'
import { BrowserWindow, Menu, ipcMain } from 'electron'
import log from 'electron-log'
import { COMMANDS } from '../../commands'
import type { CommandManager } from '../../commands'
import { isOsx } from '../../config'

export const RELEASES_URL = 'https://github.com/wenlanstudio/wenlan/releases'

let runningUpdate = false
let win: BrowserWindow | null = null
// Startup checks are silent: they only surface when an update is actually
// available, and swallow "not available"/error noise instead of notifying.
let silentCheck = false

autoUpdater.autoDownload = false

autoUpdater.on('error', (error: Error) => {
  // Preserve the JS behavior: it tolerated `null` here; the typed event
  // shape doesn't, but the same defensive code below stays in place.
  const err = error as Error | null
  const message = err === null ? 'Error: unknown' : (err.message || err).toString()
  if (silentCheck) {
    log.warn('[update] silent update check failed:', message)
  } else if (win) {
    win.webContents.send('mt::UPDATE_ERROR', message)
  }
  silentCheck = false
})

autoUpdater.on('update-available', (_info) => {
  if (win) {
    win.webContents.send(
      'mt::UPDATE_AVAILABLE',
      'Found an update, do you want download and install now?'
    )
  }
  silentCheck = false
  runningUpdate = false
})

autoUpdater.on('update-not-available', (_info) => {
  if (win && !silentCheck) {
    win.webContents.send('mt::UPDATE_NOT_AVAILABLE', 'Current version is up-to-date.')
  }
  silentCheck = false
  runningUpdate = false
})

autoUpdater.on('update-downloaded', (_event) => {
  // TODO: We should ask the user, so that the user can save all documents and
  // not just force close the application.

  if (win) {
    win.webContents.send(
      'mt::UPDATE_DOWNLOADED',
      'Update downloaded, application will be quit for update...'
    )
  }
  setImmediate(() => autoUpdater.quitAndInstall())
})

ipcMain.on('mt::NEED_UPDATE', (_e, { needUpdate }: { needUpdate: boolean }) => {
  if (needUpdate) {
    autoUpdater.downloadUpdate()
  } else {
    runningUpdate = false
  }
})

ipcMain.on('mt::check-for-update', (e) => {
  const senderWin = BrowserWindow.fromWebContents(e.sender)
  checkUpdates(senderWin)
})

// --------------------------------------------------------

export const userSetting = (): void => {
  ipcMain.emit('app-create-settings-window')
}

export const checkUpdates = (browserWindow: BrowserWindow | null): void => {
  if (!runningUpdate) {
    runningUpdate = true
    win = browserWindow
    autoUpdater.checkForUpdates()
  }
}

// Startup check: same flow as the menu action, but "not available" and errors
// are only logged instead of notifying the user.
export const checkUpdatesSilently = (browserWindow: BrowserWindow | null): void => {
  if (runningUpdate) {
    return
  }
  runningUpdate = true
  silentCheck = true
  win = browserWindow
  autoUpdater.checkForUpdates().catch((err: unknown) => {
    log.warn(
      '[update] silent update check failed:',
      err instanceof Error ? err.message : String(err)
    )
    runningUpdate = false
    silentCheck = false
  })
}

export const osxHide = (): void => {
  if (isOsx) {
    Menu.sendActionToFirstResponder('hide:')
  }
}

export const osxHideAll = (): void => {
  if (isOsx) {
    Menu.sendActionToFirstResponder('hideOtherApplications:')
  }
}

export const osxShowAll = (): void => {
  if (isOsx) {
    Menu.sendActionToFirstResponder('unhideAllApplications:')
  }
}

// --- Commands -------------------------------------------------------------

export const loadMarktextCommands = (commandManager: CommandManager): void => {
  commandManager.add(COMMANDS.MT_HIDE, osxHide)
  commandManager.add(COMMANDS.MT_HIDE_OTHERS, osxHideAll)
}
