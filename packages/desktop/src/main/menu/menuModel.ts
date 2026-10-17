import {
  Menu,
  type BrowserWindow,
  type MenuItem,
  type MenuItemConstructorOptions
} from 'electron'
import { isOsx } from '../config'
import type { MenuStructureItem } from '@shared/types/menu'

/**
 * How to run one entry when the renderer asks for it. Exactly one of the two
 * is set: menu items either carry a `click` handler or a native `role`.
 *
 * `click` is stored as "given a window, do the thing" so Electron's
 * three-argument click signature — and the dummy arguments it would need —
 * stay confined to this file.
 */
export interface MenuItemAction {
  click?: (win: BrowserWindow) => void
  role?: string
}

/** Per-window map of menu entry id → how to run it. */
export type MenuItemActionMap = Map<string, MenuItemAction>

/**
 * Give every addressable menu entry a stable id and remember how to run it.
 *
 * The template is rebuilt per window (and again whenever the menu is updated),
 * so marking it up here keeps the individual template files free of ids that
 * only the menu bar needs. Entries that already declare an id keep it, which
 * matters because main-process code looks some of them up by name.
 */
export function collectMenuActions(
  template: MenuItemConstructorOptions[],
  actions: MenuItemActionMap
): void {
  let anonymous = 0

  const walk = (items: MenuItemConstructorOptions[], path: string): void => {
    for (const item of items) {
      if (!item) continue

      // Separators are drawn by the renderer from `type`; they need no id.
      if (item.type === 'separator') continue

      const id = typeof item.id === 'string' && item.id ? item.id : `${path}/${anonymous++}`
      item.id = id

      const click = item.click
      if (click || item.role) {
        actions.set(id, {
          click: click
            ? (win: BrowserWindow): void => {
              click(
                null as unknown as MenuItem,
                win,
                undefined as unknown as KeyboardEvent
              )
            }
            : undefined,
          role: typeof item.role === 'string' ? item.role : undefined
        })
      }

      if (Array.isArray(item.submenu)) {
        walk(item.submenu as MenuItemConstructorOptions[], id)
      }
    }
  }

  walk(template, 'menu')
}

/**
 * Snapshot the live window menu so the renderer draws current state — the
 * checked state of View/Theme/Format entries changes constantly, and reading
 * the built menu is what keeps the bar honest.
 */
export function serializeMenu(menu: Menu | null): MenuStructureItem[] {
  if (!menu) return []
  return serializeItems(menu.items)
}

/**
 * MenuItem.type also carries 'header' and 'palette', neither of which the
 * application menu uses; treat anything unrecognised as a plain entry so the
 * renderer always has a valid value to compare against.
 */
function normalizeType(type: MenuItem['type']): MenuStructureItem['type'] {
  switch (type) {
    case 'separator':
      return 'separator'
    case 'submenu':
      return 'submenu'
    case 'checkbox':
      return 'checkbox'
    case 'radio':
      return 'radio'
    default:
      return 'normal'
  }
}

function serializeItems(items: readonly MenuItem[]): MenuStructureItem[] {
  const result: MenuStructureItem[] = []
  let separatorIndex = 0

  for (const item of items) {
    if (item.type === 'separator') {
      if (!item.visible) continue
      result.push({
        id: `separator-${separatorIndex++}`,
        label: '',
        type: 'separator',
        accelerator: null,
        enabled: false,
        visible: true,
        checked: false,
        submenu: []
      })
      continue
    }

    if (!item.visible) continue

    result.push({
      id: item.id || '',
      label: item.label,
      type: normalizeType(item.type),
      accelerator: item.accelerator || null,
      enabled: item.enabled,
      visible: true,
      checked: !!item.checked,
      submenu: item.submenu ? serializeItems(item.submenu.items) : []
    })
  }

  return result
}

/**
 * Run a menu entry that has a native role instead of a `click`.
 *
 * On macOS the action must go through the first responder so it reaches native
 * controls too — which is exactly why the Edit menu keeps real roles
 * (see menu/templates/edit.ts). Elsewhere the equivalent editing commands are
 * available directly on webContents.
 */
export function executeMenuRole(win: BrowserWindow, role: string): void {
  if (isOsx) {
    // `sendActionToFirstResponder` types its parameter as a literal union of
    // macOS roles; ours is the same string set, just widened by the template.
    Menu.sendActionToFirstResponder(role as Parameters<typeof Menu.sendActionToFirstResponder>[0])
    return
  }

  const { webContents } = win
  switch (role) {
    case 'cut':
      webContents.cut()
      break
    case 'copy':
      webContents.copy()
      break
    case 'paste':
      webContents.paste()
      break
    case 'selectAll':
      webContents.selectAll()
      break
    case 'undo':
      webContents.undo()
      break
    case 'redo':
      webContents.redo()
      break
    case 'reload':
      webContents.reload()
      break
    default:
      // Roles we don't emulate (recentdocuments, services, help, …) are either
      // macOS-only or have no in-window counterpart; ignoring them keeps the
      // flat menu from silently doing the wrong thing.
      break
  }
}
