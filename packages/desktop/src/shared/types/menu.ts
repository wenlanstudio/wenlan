// Menu template shapes used across main↔renderer. Mirrors the Electron
// MenuItemConstructorOptions surface narrowly enough for our use without
// pulling Electron types into renderer-only consumers.

export interface MenuTemplateItem {
  id?: string
  label?: string
  type?: 'normal' | 'separator' | 'submenu' | 'checkbox' | 'radio'
  accelerator?: string
  enabled?: boolean
  visible?: boolean
  checked?: boolean
  role?: string
  click?: string
  submenu?: MenuTemplateItem[]
  // Open shape — main-side menu builder occasionally tucks extra metadata in.
  [key: string]: unknown
}

export type MenuTemplate = MenuTemplateItem[]

/**
 * An application menu entry serialized for the renderer: enough to draw the
 * in-window menu bar and to address an entry by stable id, without leaking an
 * Electron `MenuItem` — or its non-serializable `click` — across IPC.
 */
export interface MenuStructureItem {
  /** Stable within one window menu; empty only for generated separators. */
  id: string
  label: string
  type: 'normal' | 'separator' | 'checkbox' | 'radio' | 'submenu'
  accelerator: string | null
  enabled: boolean
  visible: boolean
  checked: boolean
  submenu: MenuStructureItem[]
}

export interface MenuPopupPosition {
  x: number
  y: number
}
