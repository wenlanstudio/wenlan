import {
  SEPARATOR,
  getNewFile,
  getNewFromTemplate,
  getNewDirectory,
  getCOPY,
  getCUT,
  getPASTE,
  getRENAME,
  getDELETE,
  getCopyPath,
  getShowInFolder,
  getPublishToWenshu
} from './menuItems'
import { popupContextMenu, type ContextMenuItem } from '../popupMenu'
import { useAuthStore } from '@/store/auth'

export const showContextMenu = (
  event: { clientX: number; clientY: number },
  hasPathCache: boolean
): void => {
  const contextItems: ContextMenuItem[] = [
    getNewFile(),
    getNewFromTemplate(),
    getNewDirectory(),
    SEPARATOR,
    getCOPY(),
    getCUT(),
    getPASTE(),
    SEPARATOR,
    getRENAME(),
    getDELETE(),
    SEPARATOR,
    getCopyPath(),
    getShowInFolder()
  ]

  // 教育版叠加项只在登录后出现（N1：未登录零教学概念）。
  if (useAuthStore().state.loggedIn) {
    contextItems.push(SEPARATOR, getPublishToWenshu())
  }

  // PASTE entry (index 6) toggles based on the cached source path.
  contextItems[6].enabled = hasPathCache

  const items: ContextMenuItem[] = contextItems.map((item) => {
    if (!item || item.type === 'separator') return item
    const click = item.click
    return {
      ...item,
      click: click ? () => click(null, null) : undefined
    }
  })

  popupContextMenu(items, { x: event.clientX, y: event.clientY })
}
