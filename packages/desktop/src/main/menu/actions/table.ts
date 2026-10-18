import { type BrowserWindow } from 'electron'
import { COMMANDS } from '../../commands'
import type { CommandManager } from '../../commands'

type Win = BrowserWindow | null | undefined

// Table operations all funnel through one IPC channel; the renderer resolves
// the caret's table itself, so the main process only carries the action name.
// The names are `Muya.tableAction`'s `TableActionType` values verbatim.
const sendTableAction = (win: Win, type: string): void => {
  if (win && win.webContents) {
    win.webContents.send('mt::editor-table-action', { type })
  }
}

export const insertRowAbove = (win: Win): void => sendTableAction(win, 'insertRowAbove')
export const insertRowBelow = (win: Win): void => sendTableAction(win, 'insertRowBelow')
export const insertColumnLeft = (win: Win): void => sendTableAction(win, 'insertColumnLeft')
export const insertColumnRight = (win: Win): void => sendTableAction(win, 'insertColumnRight')
export const deleteRow = (win: Win): void => sendTableAction(win, 'deleteRow')
export const deleteColumn = (win: Win): void => sendTableAction(win, 'deleteColumn')
export const moveRowUp = (win: Win): void => sendTableAction(win, 'moveRowUp')
export const moveRowDown = (win: Win): void => sendTableAction(win, 'moveRowDown')
export const moveColumnLeft = (win: Win): void => sendTableAction(win, 'moveColumnLeft')
export const moveColumnRight = (win: Win): void => sendTableAction(win, 'moveColumnRight')
export const copyTable = (win: Win): void => sendTableAction(win, 'copyTable')
export const deleteTable = (win: Win): void => sendTableAction(win, 'deleteTable')

// --- Commands -------------------------------------------------------------

export const loadTableCommands = (commandManager: CommandManager): void => {
  commandManager.add(COMMANDS.TABLE_COPY, copyTable)
  commandManager.add(COMMANDS.TABLE_DELETE, deleteTable)
  commandManager.add(COMMANDS.TABLE_DELETE_COLUMN, deleteColumn)
  commandManager.add(COMMANDS.TABLE_DELETE_ROW, deleteRow)
  commandManager.add(COMMANDS.TABLE_INSERT_COLUMN_LEFT, insertColumnLeft)
  commandManager.add(COMMANDS.TABLE_INSERT_COLUMN_RIGHT, insertColumnRight)
  commandManager.add(COMMANDS.TABLE_INSERT_ROW_ABOVE, insertRowAbove)
  commandManager.add(COMMANDS.TABLE_INSERT_ROW_BELOW, insertRowBelow)
  commandManager.add(COMMANDS.TABLE_MOVE_COLUMN_LEFT, moveColumnLeft)
  commandManager.add(COMMANDS.TABLE_MOVE_COLUMN_RIGHT, moveColumnRight)
  commandManager.add(COMMANDS.TABLE_MOVE_ROW_DOWN, moveRowDown)
  commandManager.add(COMMANDS.TABLE_MOVE_ROW_UP, moveRowUp)
}
