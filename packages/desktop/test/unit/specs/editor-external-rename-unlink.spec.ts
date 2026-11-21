import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// The file watcher's unlink races the directory watcher's rename pairing in
// project.ts: whichever lands first decides whether the tab is still on the
// old path. The unlink mark must wait out the pairing window and re-resolve
// then — a tab that already followed the rename to its new path must not get
// the dirty mark or the "removed on disk" notification.

const { emitToRenderer } = vi.hoisted(() => {
  const ipcListeners = new Map<string, Array<(...args: unknown[]) => void>>()
  const emitToRenderer = (channel: string, ...args: unknown[]): void => {
    for (const handler of ipcListeners.get(channel) ?? []) handler(...args)
  }
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, String(value)),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear()
    }
  })
  const w = globalThis as unknown as {
    window?: {
      path?: { sep: string; dirname: (p: string) => string; basename: (p: string) => string }
      fileUtils?: { isSamePathSync: (a: string, b: string) => boolean }
      electron?: {
        clipboard: { writeText: (s: string) => void }
        ipcRenderer: { send: (...a: unknown[]) => void; on: (channel: string, handler: (...a: unknown[]) => void) => void }
      }
      DIRNAME?: string
    }
  }
  w.window ??= {}
  w.window.path ??= {
    sep: '/',
    dirname: (p: string) => String(p).split('/').slice(0, -1).join('/') || '/',
    basename: (p: string) => String(p).split('/').pop() ?? p
  }
  w.window.fileUtils ??= { isSamePathSync: (a: string, b: string) => a === b }
  w.window.electron ??= {
    clipboard: { writeText: () => {} },
    ipcRenderer: {
      send: () => {},
      on: (channel: string, handler: (...a: unknown[]) => void) => {
        const list = ipcListeners.get(channel) ?? []
        list.push(handler)
        ipcListeners.set(channel, list)
      }
    }
  }
  return { emitToRenderer }
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))

import { useEditorStore } from '@/store/editor'

const openTab = (pathname: string) => {
  const editor = useEditorStore()
  const tab = {
    id: 'tab-1',
    pathname,
    filename: pathname.split('/').pop() ?? '',
    isSaved: true,
    markdown: '# content',
    notifications: [] as Array<Record<string, unknown>>
  }
  editor.tabs.push(tab as never)
  editor.currentFile = tab as never
  return tab
}

const sendFileEvent = (type: string, pathname: string): void => {
  emitToRenderer('mt::update-file', null, { type, change: { pathname } })
}

describe('file-watcher unlink waits out the rename pairing window', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers({ now: 1_000_000 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('marks the tab dirty after the window on a genuine removal', () => {
    const editor = useEditorStore()
    editor.LISTEN_FOR_FILE_CHANGE()
    const tab = openTab('/A/old.md')

    sendFileEvent('unlink', '/A/old.md')
    vi.advanceTimersByTime(300)
    expect(tab.isSaved).toBe(true) // still inside the pairing window
    vi.advanceTimersByTime(400)

    expect(tab.isSaved).toBe(false)
    expect(tab.notifications.length).toBe(1)
  })

  it('does not mark the tab when the rename retarget happens first', () => {
    const editor = useEditorStore()
    editor.LISTEN_FOR_FILE_CHANGE()
    const tab = openTab('/A/old.md')

    sendFileEvent('unlink', '/A/old.md')
    // The directory watcher's pairing retargets the tab within the window.
    tab.pathname = '/A/new.md'
    tab.filename = 'new.md'
    vi.advanceTimersByTime(1_000)

    expect(tab.isSaved).toBe(true)
    expect(tab.notifications.length).toBe(0)
  })

  it('does not mark the tab when the unlink arrives after the retarget', () => {
    const editor = useEditorStore()
    editor.LISTEN_FOR_FILE_CHANGE()
    const tab = openTab('/A/old.md')

    tab.pathname = '/A/new.md'
    tab.filename = 'new.md'
    sendFileEvent('unlink', '/A/old.md')
    vi.advanceTimersByTime(1_000)

    expect(tab.isSaved).toBe(true)
    expect(tab.notifications.length).toBe(0)
  })
})
