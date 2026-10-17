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
 * `click` is stored as "given a window and the activated item, do the thing"
 * so Electron's three-argument click signature — and the dummy arguments it
 * would need — stay confined to this file. The item is whatever
 * `resolveMenuClickTarget` found; it is null only when the menu cannot be
 * walked (no MenuItem array).
 */
export interface MenuItemAction {
  click?: (win: BrowserWindow, item: MenuItem | null) => void
  role?: string
}

/** Per-window map of menu entry id → how to run it. */
export type MenuItemActionMap = Map<string, MenuItemAction>

/**
 * Give every addressable menu entry a stable id and remember how to run it.
 *
 * The template is rebuilt per window (and again whenever the menu is updated),
 * so marking ids up here keeps the individual template files free of ids that
 * only the menu bar needs. Entries that already declare an id keep it, which
 * matters because main-process code looks some of them up by name.
 *
 * The input template is never mutated: a shallow copy of each entry carries
 * the id, so frozen or shared template objects (and templates from tests)
 * pass through unharmed.
 */
export function annotateMenuTemplate(
  template: readonly MenuItemConstructorOptions[],
  actions: MenuItemActionMap
): MenuItemConstructorOptions[] {
  let anonymous = 0

  const walk = (
    items: readonly MenuItemConstructorOptions[],
    path: string
  ): MenuItemConstructorOptions[] =>
    items.map((item) => {
      if (!item || typeof item !== 'object') return item

      // Separators are drawn by the renderer from `type`; they need no id.
      if (item.type === 'separator') return item

      const id = typeof item.id === 'string' && item.id ? item.id : `${path}/${anonymous++}`

      const click = item.click
      if (click || item.role) {
        actions.set(id, {
          click: click
            ? (win: BrowserWindow, target: MenuItem | null): void => {
              click(target as MenuItem, win, undefined as unknown as KeyboardEvent)
            }
            : undefined,
          role: typeof item.role === 'string' ? item.role : undefined
        })
      }

      if (!Array.isArray(item.submenu)) {
        return { ...item, id }
      }

      return {
        ...item,
        id,
        submenu: walk(item.submenu as readonly MenuItemConstructorOptions[], id)
      }
    })

  return walk(template, 'menu')
}

interface MenuItemLocation {
  item: MenuItem
  /** The siblings this item shares a submenu with — i.e. its radio group. */
  siblings: readonly MenuItem[]
}

function findMenuItemLocation(
  items: readonly MenuItem[],
  id: string
): MenuItemLocation | null {
  for (const item of items) {
    if (item.id === id) return { item, siblings: items }
    if (item.submenu) {
      const nested = findMenuItemLocation(item.submenu.items, id)
      if (nested) return nested
    }
  }
  return null
}

/**
 * Resolve the item an in-window menu-bar click should be handed, and bring it
 * to the state Electron would have put it in before calling `click`.
 *
 * Activating an entry through the native menu bar does two things before the
 * handler runs: it passes the real `MenuItem`, and it updates that item first
 * — flipping a checkbox, or moving the radio mark within the group. The
 * in-window bar reaches the handler directly, so both happen here.
 *
 * Skipping either half broke entries that read the item: Follow System Theme
 * and Auto Save read `menuItem.checked` to know the state to apply, and the
 * recent-files entries read `menuItem.label`.
 */
export function resolveMenuClickTarget(menu: Menu | null, id: string): MenuItem | null {
  if (!menu || !Array.isArray(menu.items)) return null

  const found = findMenuItemLocation(menu.items, id)
  if (!found) return null

  const { item, siblings } = found
  if (item.type === 'checkbox') {
    item.checked = !item.checked
  } else if (item.type === 'radio') {
    for (const sibling of siblings) {
      if (sibling !== item && sibling.type === 'radio') sibling.checked = false
    }
    item.checked = true
  }

  return item
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
