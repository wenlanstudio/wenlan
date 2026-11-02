import path from 'path'
import { app } from 'electron'
import EnvPaths from 'common/envPaths'
import { ensureDirSync } from 'common/filesystem'
import { migrateLegacyUserData } from './userDataMigration'

class AppPaths extends EnvPaths {
  /**
   * Configure and sets all application paths.
   *
   * @param userDataPath The user data path or empty string for default.
   */
  constructor(userDataPath: string = '') {
    if (!userDataPath) {
      // Use default user data path.
      userDataPath = app.getPath('userData')

      // One-time migration from the MarkText-named user data directory.
      const appDataPath = app.getPath('appData')
      migrateLegacyUserData(userDataPath, [
        path.join(appDataPath, 'MarkText'),
        path.join(appDataPath, 'marktext')
      ])
    }

    // Initialize environment paths
    super(userDataPath)

    // Changing the user data directory is only allowed during application bootstrap.
    app.setPath('userData', this.electronUserDataPath)
  }
}

export const ensureAppDirectoriesSync = (paths: AppPaths): void => {
  ensureDirSync(paths.userDataPath)
  ensureDirSync(paths.logPath)
  // TODO(sessions): enable this...
  // ensureDirSync(paths.electronUserDataPath)
  // ensureDirSync(paths.globalStorage)
  // ensureDirSync(paths.preferencesPath)
  // ensureDirSync(paths.sessionsPath)
}

export default AppPaths
