// NOTE: This are mutable fields that may change at runtime.

import { type BaseWindow, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { t } from '../../i18n'

// Use function form to avoid calling the translation function during module load
export const getCUT = (): MenuItemConstructorOptions => ({
  label: t('contextMenu.cut'),
  id: 'cutMenuItem',
  role: 'cut'
})

export const getCOPY = (): MenuItemConstructorOptions => ({
  label: t('contextMenu.copy'),
  id: 'copyMenuItem',
  role: 'copy'
})

export const getPASTE = (): MenuItemConstructorOptions => ({
  label: t('contextMenu.paste'),
  id: 'pasteMenuItem',
  role: 'paste'
})

export const getCopyAsRich = (): MenuItemConstructorOptions => ({
  label: t('contextMenu.copyAsRich'),
  id: 'copyAsRichMenuItem',
  click(_menuItem, targetWindow) {
    if (targetWindow) {
      ;(targetWindow as BrowserWindow).webContents.send('mt::cm-copy-as-rich')
    }
  }
})

export const getCopyAsHtml = (): MenuItemConstructorOptions => ({
  label: t('contextMenu.copyAsHtml'),
  id: 'copyAsHtmlMenuItem',
  click(_menuItem, targetWindow) {
    if (targetWindow) {
      ;(targetWindow as BrowserWindow).webContents.send('mt::cm-copy-as-html')
    }
  }
})

export const getPasteAsPlainText = (): MenuItemConstructorOptions => ({
  label: t('contextMenu.pasteAsPlainText'),
  id: 'pasteAsPlainTextMenuItem',
  click(_menuItem, targetWindow) {
    if (targetWindow) {
      ;(targetWindow as BrowserWindow).webContents.send('mt::cm-paste-as-plain-text')
    }
  }
})

type LookupTarget = BaseWindow & {
  webContents: {
    showDefinitionForSelection: () => void
  }
}

const canShowDefinitionForSelection = (
  targetWindow?: BaseWindow | null
): targetWindow is LookupTarget => {
  const candidate = targetWindow as (BaseWindow & {
    webContents?: { showDefinitionForSelection?: unknown }
  }) | null | undefined

  return typeof candidate?.webContents?.showDefinitionForSelection === 'function'
}

export const lookUpSelection = (
  selectionText: string,
  targetWindow?: BaseWindow | null
): boolean => {
  const selection = selectionText.trim()
  if (!selection || !canShowDefinitionForSelection(targetWindow)) {
    return false
  }

  targetWindow.webContents.showDefinitionForSelection()
  return true
}

export const getLookUp = (selectionText: string): MenuItemConstructorOptions => ({
  label: t('contextMenu.lookUp', { selection: selectionText.trim() }),
  id: 'lookUpMenuItem',
  click(_menuItem, targetWindow) {
    lookUpSelection(selectionText, targetWindow)
  }
})

export const getInsertBefore = (): MenuItemConstructorOptions => ({
  label: t('contextMenu.insertParagraphBefore'),
  id: 'insertParagraphBeforeMenuItem',
  click(_menuItem, targetWindow) {
    if (targetWindow) {
      ;(targetWindow as BrowserWindow).webContents.send('mt::cm-insert-paragraph', 'before')
    }
  }
})

export const getInsertAfter = (): MenuItemConstructorOptions => ({
  label: t('contextMenu.insertParagraphAfter'),
  id: 'insertParagraphAfterMenuItem',
  click(_menuItem, targetWindow) {
    if (targetWindow) {
      ;(targetWindow as BrowserWindow).webContents.send('mt::cm-insert-paragraph', 'after')
    }
  }
})

// 光标位于表格内时的「表格」子菜单，条目与 Typora 一致。accelerator 只做
// 显示（popup 菜单不注册按键），真正的按键走 keybindings 的 table.* 命令。
const tableActionItem = (
  label: string,
  id: string,
  type: string,
  accelerator?: string
): MenuItemConstructorOptions => ({
  label,
  id,
  accelerator,
  click(_menuItem, targetWindow) {
    if (targetWindow) {
      ;(targetWindow as BrowserWindow).webContents.send('mt::editor-table-action', { type })
    }
  }
})

export const getTableSubmenu = (): MenuItemConstructorOptions => ({
  label: t('contextMenu.table.table'),
  id: 'tableMenuItem',
  submenu: [
    tableActionItem(t('contextMenu.table.insertRowAbove'), 'tableInsertRowAboveMenuItem', 'insertRowAbove'),
    tableActionItem(t('contextMenu.table.insertRowBelow'), 'tableInsertRowBelowMenuItem', 'insertRowBelow', 'Ctrl+Enter'),
    tableActionItem(t('contextMenu.table.insertColumnLeft'), 'tableInsertColumnLeftMenuItem', 'insertColumnLeft'),
    tableActionItem(t('contextMenu.table.insertColumnRight'), 'tableInsertColumnRightMenuItem', 'insertColumnRight'),
    SEPARATOR,
    tableActionItem(t('contextMenu.table.moveRowUp'), 'tableMoveRowUpMenuItem', 'moveRowUp', 'Alt+Up'),
    tableActionItem(t('contextMenu.table.moveRowDown'), 'tableMoveRowDownMenuItem', 'moveRowDown', 'Alt+Down'),
    tableActionItem(t('contextMenu.table.moveColumnLeft'), 'tableMoveColumnLeftMenuItem', 'moveColumnLeft', 'Alt+Left'),
    tableActionItem(t('contextMenu.table.moveColumnRight'), 'tableMoveColumnRightMenuItem', 'moveColumnRight', 'Alt+Right'),
    SEPARATOR,
    tableActionItem(t('contextMenu.table.deleteRow'), 'tableDeleteRowMenuItem', 'deleteRow', 'Ctrl+Shift+Delete'),
    tableActionItem(t('contextMenu.table.deleteColumn'), 'tableDeleteColumnMenuItem', 'deleteColumn'),
    SEPARATOR,
    tableActionItem(t('contextMenu.table.copyTable'), 'tableCopyMenuItem', 'copyTable'),
    tableActionItem(t('contextMenu.table.deleteTable'), 'tableDeleteTableMenuItem', 'deleteTable')
  ]
})

// Retained for backward compatibility
export const CUT = getCUT()
export const COPY = getCOPY()
export const PASTE = getPASTE()
export const COPY_AS_RICH = getCopyAsRich()
export const COPY_AS_HTML = getCopyAsHtml()
export const PASTE_AS_PLAIN_TEXT = getPasteAsPlainText()
export const INSERT_BEFORE = getInsertBefore()
export const INSERT_AFTER = getInsertAfter()

export const SEPARATOR: MenuItemConstructorOptions = {
  type: 'separator'
}
