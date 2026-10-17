import { describe, it, expect, vi } from 'vitest'
import type { MenuItemConstructorOptions, Menu, MenuItem } from 'electron'
import {
  annotateMenuTemplate,
  resolveMenuClickTarget,
  type MenuItemActionMap
} from 'main_renderer/menu/menuModel'

vi.mock('electron', () => ({ Menu: { sendActionToFirstResponder: vi.fn() } }))
vi.mock('main_renderer/config', () => ({ isOsx: false, isWindows: false, isLinux: true }))

// Follow System Theme crashed with `Cannot read properties of null (reading
// 'checked')`: the in-window menu bar runs a template's `click` directly, and
// the adapter handed it `null` where Electron hands the activated MenuItem.
// The same hole broke Auto Save and the recent-files entries.
//
// These run the real chain the in-window bar uses: mark up the template, look
// the entry up in the built menu, then execute it. The fake menu below stands
// in for `Menu.buildFromTemplate`, whose items are mutable and whose radio
// groups Electron toggles for us.

interface FakeItem {
  id: string
  label: string
  type: string
  checked: boolean
  enabled: boolean
  submenu?: { items: FakeItem[] }
}

/** `Menu.buildFromTemplate`, reduced to what the lookup and toggle touch. */
function buildFakeMenu(template: readonly MenuItemConstructorOptions[]): Menu {
  const build = (items: readonly MenuItemConstructorOptions[]): FakeItem[] =>
    items.map((item, index) => {
      const fake: FakeItem = {
        id: (item.id as string) ?? `anon-${index}`,
        label: item.label ?? '',
        type: (item.type as string) ?? 'normal',
        checked: !!item.checked,
        enabled: item.enabled !== false
      }
      if (Array.isArray(item.submenu)) {
        fake.submenu = { items: build(item.submenu as MenuItemConstructorOptions[]) }
      }
      return fake
    })

  return { items: build(template) as unknown as MenuItem[] } as unknown as Menu
}

/** Run one entry the way `AppMenu.executeMenuItem` does. */
function clickEntry(menu: Menu, actions: MenuItemActionMap, id: string): void {
  const action = actions.get(id)
  expect(action?.click).toBeTruthy()
  action!.click!({} as never, resolveMenuClickTarget(menu, id))
}

describe('in-window menu bar hands the activated item to click handlers', () => {
  it('gives a checkbox handler the state it flips to, not null', () => {
    const seen: boolean[] = []
    const template: MenuItemConstructorOptions[] = [
      {
        label: 'Follow System Theme',
        id: 'follow-system-theme',
        type: 'checkbox',
        checked: false,
        click(menuItem) {
          seen.push(menuItem.checked)
        }
      }
    ]

    const actions: MenuItemActionMap = new Map()
    const menu = buildFakeMenu(annotateMenuTemplate(template, actions))

    clickEntry(menu, actions, 'follow-system-theme')
    clickEntry(menu, actions, 'follow-system-theme')

    expect(seen.length).toBe(2)
    expect(seen[0]).toBe(true)
    expect(seen[1]).toBe(false)
  })

  it('reaches the item and label from inside a submenu', () => {
    const labels: string[] = []
    const template: MenuItemConstructorOptions[] = [
      {
        label: 'File',
        id: 'fileMenu',
        submenu: [
          {
            label: '/tmp/notes.md',
            click(menuItem) {
              labels.push(menuItem.label)
            }
          }
        ]
      }
    ]

    const actions: MenuItemActionMap = new Map()
    const menu = buildFakeMenu(annotateMenuTemplate(template, actions))

    clickEntry(menu, actions, 'fileMenu/0')
    expect(labels).toEqual(['/tmp/notes.md'])
  })

  it('moves the radio mark before calling the handler', () => {
    const seen: boolean[] = []
    const template: MenuItemConstructorOptions[] = [
      {
        label: 'Themes',
        id: 'themeMenu',
        submenu: [
          {
            label: 'Light',
            id: 'light',
            type: 'radio',
            checked: true,
            click(menuItem) {
              seen.push(menuItem.checked)
            }
          },
          {
            label: 'Dark',
            id: 'dark',
            type: 'radio',
            checked: false,
            click(menuItem) {
              seen.push(menuItem.checked)
            }
          }
        ]
      }
    ]

    const actions: MenuItemActionMap = new Map()
    const menu = buildFakeMenu(annotateMenuTemplate(template, actions))
    const items = menu.items[0]!.submenu!.items

    clickEntry(menu, actions, 'dark')

    expect(seen).toEqual([true])
    expect(items[0]!.checked).toBe(false)
    expect(items[1]!.checked).toBe(true)
  })

  it('leaves plain entries checked-state alone', () => {
    const template: MenuItemConstructorOptions[] = [
      {
        label: 'Print',
        id: 'printMenuItem',
        click() {
          /* nothing to read off the item */
        }
      }
    ]

    const actions: MenuItemActionMap = new Map()
    const menu = buildFakeMenu(annotateMenuTemplate(template, actions))

    expect(() => clickEntry(menu, actions, 'printMenuItem')).not.toThrow()
    expect(menu.items[0]!.checked).toBe(false)
  })

  it('degrades to null instead of throwing when the menu cannot be walked', () => {
    const menu = { getMenuItemById: () => null } as unknown as Menu
    expect(resolveMenuClickTarget(menu, 'follow-system-theme')).toBeNull()
    expect(resolveMenuClickTarget(null, 'follow-system-theme')).toBeNull()
  })

  it('registers no action for entries without a click or role', () => {
    const actions: MenuItemActionMap = new Map()
    annotateMenuTemplate(
      [{ label: 'Follow System Theme', id: 'follow-system-theme', enabled: false }],
      actions
    )
    expect(actions.size).toBe(0)
  })
})
