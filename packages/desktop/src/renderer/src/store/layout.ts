import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import bus from '../bus'
import { usePreferencesStore } from './preferences'
import { debouncedSendBufferedState } from './bufferedState'

export type SidebarTab = 'files' | 'toc'

export interface LayoutPartial {
  sidebarTab?: SidebarTab
  showSideBar?: boolean
  showTabBar?: boolean
  sideBarWidth?: number | string
}

interface SetLayoutOptions {
  scheduleBufferUpdate?: boolean
}

const normalizeSideBarWidth = (width: unknown): number => {
  const numericWidth = Number(width)
  return Number.isFinite(numericWidth) ? Math.max(numericWidth, 220) : 280
}

// Legacy buffered states may still carry the pre-rename tab names ('search'
// panel is gone, and the empty string meant the old icon strip).
const normalizeSidebarTab = (tab: unknown): SidebarTab => (tab === 'toc' ? 'toc' : 'files')

interface BufferedLayout {
  sidebarTab: SidebarTab
  showSideBar: boolean
  showTabBar: boolean
  sideBarWidth: number
}

const createBufferedLayoutState = (state: unknown): BufferedLayout | null => {
  if (!state || typeof state !== 'object') return null
  const s = state as LayoutPartial

  return {
    sidebarTab: normalizeSidebarTab(s.sidebarTab),
    showSideBar: !!s.showSideBar,
    showTabBar: !!s.showTabBar,
    sideBarWidth: normalizeSideBarWidth(s.sideBarWidth)
  }
}

const initialWidth = localStorage.getItem('side-bar-width')
const initialSideBarWidth = normalizeSideBarWidth(initialWidth)

export const useLayoutStore = defineStore('layout', () => {
  const sidebarTab = ref<SidebarTab>('files')
  const showSideBar = ref(false)
  const showTabBar = ref(false)
  const sideBarWidth = ref<number>(initialSideBarWidth)

  // Actual rendered sidebar width. `sideBarWidth` is the user-chosen width
  // (clamped to ≥220 by `normalizeSideBarWidth`). Consumers that need to
  // subtract the sidebar from viewport space must use this, not the raw ref.
  const effectiveSideBarWidth = computed<number>(() => {
    if (!showSideBar.value) return 0
    return Number(sideBarWidth.value)
  })

  function SET_LAYOUT(
    layout: LayoutPartial,
    { scheduleBufferUpdate = true }: SetLayoutOptions = {}
  ): void {
    if (layout.showSideBar !== undefined) {
      const { windowId } = window.marktext?.env ?? {}
      window.electron.ipcRenderer.send(
        'mt::update-sidebar-menu',
        Number(windowId),
        !!layout.showSideBar
      )
      const preferencesStore = usePreferencesStore()
      preferencesStore.SET_SINGLE_PREFERENCE({
        type: 'sideBarVisibility',
        value: !!layout.showSideBar
      })
    }
    // Match the pre-migration `Object.assign(this, layout)` semantics: assign
    // each known field as-is (no normalization here; SET_SIDE_BAR_WIDTH owns
    // sideBarWidth's normalization), and skip unknown keys silently.
    if (layout.sidebarTab !== undefined) sidebarTab.value = layout.sidebarTab
    if (layout.showSideBar !== undefined) showSideBar.value = !!layout.showSideBar
    if (layout.showTabBar !== undefined) showTabBar.value = !!layout.showTabBar
    if (layout.sideBarWidth !== undefined) sideBarWidth.value = layout.sideBarWidth as number
    if (scheduleBufferUpdate) {
      debouncedSendBufferedState()
    }
  }

  function CREATE_BUFFERED_STATE(): BufferedLayout | null {
    return createBufferedLayoutState({
      sidebarTab: sidebarTab.value,
      showSideBar: showSideBar.value,
      showTabBar: showTabBar.value,
      sideBarWidth: sideBarWidth.value
    })
  }

  function RESTORE_BUFFERED_STATE(state: unknown): void {
    const layout = createBufferedLayoutState(state)
    if (!layout) return

    SET_SIDE_BAR_WIDTH(layout.sideBarWidth, { scheduleBufferUpdate: false })
    SET_LAYOUT(
      {
        sidebarTab: layout.sidebarTab,
        showSideBar: layout.showSideBar,
        showTabBar: layout.showTabBar
      },
      { scheduleBufferUpdate: false }
    )
    DISPATCH_LAYOUT_MENU_ITEMS()
  }

  function TOGGLE_LAYOUT_ENTRY(entryName: 'showSideBar' | 'showTabBar'): void {
    if (entryName === 'showSideBar') {
      showSideBar.value = !showSideBar.value
      const preferencesStore = usePreferencesStore()
      preferencesStore.SET_SINGLE_PREFERENCE({
        type: 'sideBarVisibility',
        value: !!showSideBar.value
      })
    } else if (entryName === 'showTabBar') {
      showTabBar.value = !showTabBar.value
    }
    debouncedSendBufferedState()
  }

  function SET_SIDE_BAR_WIDTH(
    width: number | string,
    { scheduleBufferUpdate = true }: SetLayoutOptions = {}
  ): void {
    const normalizedWidth = normalizeSideBarWidth(width)
    localStorage.setItem('side-bar-width', String(normalizedWidth))
    sideBarWidth.value = normalizedWidth
    if (scheduleBufferUpdate) {
      debouncedSendBufferedState()
    }
  }

  function LISTEN_FOR_LAYOUT(): void {
    window.electron.ipcRenderer.on('mt::set-view-layout', (_e, layout) => {
      const l = layout as unknown as LayoutPartial
      SET_LAYOUT(l)
      DISPATCH_LAYOUT_MENU_ITEMS()
    })

    window.electron.ipcRenderer.on('mt::toggle-view-layout-entry', (_e, entryName) => {
      TOGGLE_LAYOUT_ENTRY(entryName as 'showSideBar' | 'showTabBar')
      DISPATCH_LAYOUT_MENU_ITEMS()
    })

    bus.on('view:toggle-layout-entry', (entryName: unknown) => {
      const name = entryName as 'showSideBar' | 'showTabBar'
      TOGGLE_LAYOUT_ENTRY(name)
      const { windowId } = window.marktext?.env ?? {}
      window.electron.ipcRenderer.send('mt::view-layout-changed', Number(windowId), {
        [name]: name === 'showSideBar' ? showSideBar.value : showTabBar.value
      })
    })
  }

  function DISPATCH_LAYOUT_MENU_ITEMS(): void {
    const { windowId } = window.marktext?.env ?? {}
    window.electron.ipcRenderer.send('mt::view-layout-changed', Number(windowId), {
      showTabBar: showTabBar.value,
      showSideBar: showSideBar.value
    })
  }

  function CHANGE_SIDE_BAR_WIDTH(width: number | string): void {
    SET_SIDE_BAR_WIDTH(width)
  }

  return {
    sidebarTab,
    showSideBar,
    showTabBar,
    sideBarWidth,
    effectiveSideBarWidth,
    SET_LAYOUT,
    CREATE_BUFFERED_STATE,
    RESTORE_BUFFERED_STATE,
    TOGGLE_LAYOUT_ENTRY,
    SET_SIDE_BAR_WIDTH,
    LISTEN_FOR_LAYOUT,
    DISPATCH_LAYOUT_MENU_ITEMS,
    CHANGE_SIDE_BAR_WIDTH
  }
})
