import * as contextMenu from './actions'
import { t } from '../../i18n'
import { useTeachingStore } from '@/store/teaching'
import { useAuthStore } from '@/store/auth'

// NOTE: This are mutable fields that may change at runtime.

export const SEPARATOR = {
  type: 'separator'
}

// Use function form to avoid calling the translation function during module load
export const getNewFile = () => ({
  label: t('contextMenu.sideBar.newFile'),
  id: 'newFileMenuItem',
  click(_menuItem: unknown, _browserWindow: unknown) {
    contextMenu.newFile()
  }
})

// Submenu with the built-in document skeletons (deck / quiz deck).
export const getNewFromTemplate = () => ({
  label: t('contextMenu.sideBar.newFromTemplate'),
  id: 'newFromTemplateMenuItem',
  submenu: [
    {
      label: t('contextMenu.sideBar.newDeckFile'),
      id: 'newDeckFileMenuItem',
      click() {
        contextMenu.newFileFromTemplate('deck')
      }
    },
    {
      label: t('contextMenu.sideBar.newQuizFile'),
      id: 'newQuizFileMenuItem',
      click() {
        contextMenu.newFileFromTemplate('quiz')
      }
    }
  ]
})

export const getNewDirectory = () => ({
  label: t('contextMenu.sideBar.newDirectory'),
  id: 'newDirectoryMenuItem',
  click(_menuItem: unknown, _browserWindow: unknown) {
    contextMenu.newDirectory()
  }
})

export const getCOPY = () => ({
  label: t('contextMenu.sideBar.copy'),
  id: 'copyMenuItem',
  click(_menuItem: unknown, _browserWindow: unknown) {
    contextMenu.copy()
  }
})

export const getCUT = () => ({
  label: t('contextMenu.sideBar.cut'),
  id: 'cutMenuItem',
  click(_menuItem: unknown, _browserWindow: unknown) {
    contextMenu.cut()
  }
})

export const getPASTE = () => ({
  label: t('contextMenu.sideBar.paste'),
  id: 'pasteMenuItem',
  click(_menuItem: unknown, _browserWindow: unknown) {
    contextMenu.paste()
  }
})

export const getRENAME = () => ({
  label: t('contextMenu.sideBar.rename'),
  id: 'renameMenuItem',
  click(_menuItem: unknown, _browserWindow: unknown) {
    contextMenu.rename()
  }
})

export const getDELETE = () => ({
  label: t('contextMenu.sideBar.moveToTrash'),
  id: 'deleteMenuItem',
  click(_menuItem: unknown, _browserWindow: unknown) {
    contextMenu.remove()
  }
})

export const getCopyPath = () => ({
  label: t('contextMenu.sideBar.copyPath'),
  id: 'copyPathMenuItem',
  click(_menuItem: unknown, _browserWindow: unknown) {
    contextMenu.copyPath()
  }
})

export const getShowInFolder = () => ({
  label: t('contextMenu.sideBar.showInFolder'),
  id: 'showInFolderMenuItem',
  click(_menuItem: unknown, _browserWindow: unknown) {
    contextMenu.showInFolder()
  }
})

/** 教育版叠加项：把侧栏当前激活的 md 送进发布对话框（E5 步骤 1）。 */
export const getPublishToWenshu = () => ({
  label: t('teaching.publish'),
  id: 'publishToWenshuMenuItem',
  click(_menuItem: unknown, _browserWindow: unknown) {
    if (useAuthStore().isStudent) return
    useTeachingStore().openPublish()
  }
})

// Retained for backward compatibility
export const NEW_FILE = getNewFile()
export const NEW_DIRECTORY = getNewDirectory()
export const COPY = getCOPY()
export const CUT = getCUT()
export const PASTE = getPASTE()
export const RENAME = getRENAME()
export const DELETE = getDELETE()
export const COPY_PATH = getCopyPath()
export const SHOW_IN_FOLDER = getShowInFolder()
