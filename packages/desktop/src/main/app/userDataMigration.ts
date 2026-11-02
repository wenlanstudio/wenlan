import fs from 'fs'
import path from 'path'
import log from 'electron-log'

// Caches and single-instance lock files must not be copied: they are either
// rebuildable or would make the new app believe another instance is running.
const SKIP_ENTRIES = new Set([
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'GraphiteDawnCache',
  'ShaderCache',
  'blob_storage',
  'SingletonLock',
  'SingletonCookie',
  'SingletonSocket',
  'lockfile'
])

/**
 * Copy a legacy user-data directory into the new location once.
 *
 * Electron creates the destination directory (Crashpad, caches) before the
 * main bundle runs, so "directory is non-empty" cannot mean "already
 * migrated". preferences.json is written by the app itself after bootstrap
 * and is therefore the reliable marker, while per-entry existence checks
 * leave Chromium's pre-created cache directories alone.
 */
export const migrateLegacyUserData = (destination: string, legacySources: string[]): void => {
  try {
    if (fs.existsSync(path.join(destination, 'preferences.json'))) return

    const source = legacySources.find((candidate) => {
      if (candidate === destination) return false
      return fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()
    })
    if (!source) return

    fs.mkdirSync(destination, { recursive: true })
    for (const entry of fs.readdirSync(source)) {
      if (SKIP_ENTRIES.has(entry)) continue
      const from = path.join(source, entry)
      const to = path.join(destination, entry)
      if (fs.existsSync(to)) continue
      try {
        fs.cpSync(from, to, { recursive: true, force: false, errorOnExist: false })
      } catch (error) {
        // A single locked file (a stale log, a cache) must not abort the rest.
        log.warn(`Failed to migrate user data entry ${entry}: ${String(error)}`)
      }
    }
    log.info(`Migrated user data from ${source} to ${destination}`)
  } catch (error) {
    log.warn(`Failed to migrate legacy user data: ${String(error)}`)
  }
}
