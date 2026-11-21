import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

// External-rename pairing: chokidar reports a rename as a bare add(new) +
// unlink(old) pair. The project store must retarget the open tab (pathname,
// filename, DIRNAME) while leaving its save state alone, and must NOT light
// the phantom "removed on disk" dirty dot. A genuine removal still marks the
// tab after the pairing window, and delete-A-then-create-B must not pair
// (fresh birth time).

const { ipcSend, emitToRenderer } = vi.hoisted(() => {
  const ipcSend = vi.fn()
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
      marktext?: { env?: { windowId?: number } }
      path?: {
        sep: string
        normalize: (p: string) => string
        basename: (p: string) => string
        dirname: (p: string) => string
        isAbsolute: (p: string) => boolean
        relative: (from: string, to: string) => string
      }
      fileUtils?: {
        hasMarkdownExtension: (n: string) => boolean
        pathExists: (p: string) => Promise<boolean>
        isSamePathSync: (a: string, b: string) => boolean
        isChildOfDirectory: (dir: string, child: string) => boolean
      }
      electron?: {
        ipcRenderer: {
          send: (...a: unknown[]) => void
          on: (channel: string, handler: (...a: unknown[]) => void) => void
        }
      }
      DIRNAME?: string
    }
  }
  w.window ??= {}
  w.window.marktext ??= { env: { windowId: 1 } }
  w.window.path ??= {
    sep: '/',
    normalize: (p: string) => p,
    basename: (p: string) => (String(p).split('/').pop() ?? p),
    dirname: (p: string) => String(p).split('/').slice(0, -1).join('/') || '/',
    isAbsolute: (p: string) => String(p).startsWith('/'),
    relative: (from: string, to: string) => String(to).slice(String(from).length + 1)
  }
  w.window.fileUtils ??= {
    hasMarkdownExtension: (n: string) => String(n).endsWith('.md'),
    pathExists: () => Promise.resolve(false),
    isSamePathSync: (a: string, b: string) => a === b,
    isChildOfDirectory: (dir: string, child: string) =>
      String(child).startsWith(String(dir).replace(/\/+$/, '') + '/')
  }
  w.window.electron ??= {
    ipcRenderer: {
      send: ipcSend,
      on: (channel: string, handler: (...a: unknown[]) => void) => {
        const list = ipcListeners.get(channel) ?? []
        list.push(handler)
        ipcListeners.set(channel, list)
      }
    }
  }

  return { ipcSend, emitToRenderer }
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))

import { useProjectStore } from '@/store/project'
import { useEditorStore } from '@/store/editor'

const T0 = 1_000_000_000
const BIRTH = T0 - 50_000

type RowInput = {
  pathname: string
  birthTime: number
  mtimeMs?: number
  isMarkdown?: boolean
}

const mdRow = ({ pathname, birthTime, mtimeMs, isMarkdown = true }: RowInput) => ({
  pathname,
  name: pathname.split('/').pop(),
  isFile: true,
  isDirectory: false,
  birthTime,
  mtimeMs: mtimeMs ?? birthTime,
  isMarkdown,
  data: undefined
})

const sendTreeEvent = (type: string, change: Record<string, unknown>): void => {
  // Electron handlers receive (event, payload) — pass a null event slot.
  emitToRenderer('mt::update-object-tree', null, { type, change })
}

const setupProject = (): ReturnType<typeof useProjectStore> => {
  const project = useProjectStore()
  project.LISTEN_FOR_UPDATE_PROJECT()
  project.OPEN_PROJECT('/A')
  return project
}

const seedTree = (rows: RowInput[]): void => {
  emitToRenderer('mt::update-object-tree', null, {
    type: 'batch',
    changes: rows.map((row) => ({ type: 'add', change: mdRow(row) }))
  })
}

const openTab = (pathname: string, isSaved = true) => {
  const editor = useEditorStore()
  const tab = {
    id: 'tab-1',
    pathname,
    filename: pathname.split('/').pop() ?? '',
    isSaved,
    markdown: ''
  }
  editor.tabs.push(tab as never)
  editor.currentFile = tab as never
  return tab
}

const flushTree = async(): Promise<void> => {
  await nextTick()
}

describe('external rename follows the open tab', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    ipcSend.mockClear()
    vi.useFakeTimers({ now: T0 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('retargets the tab when unlink follows add (Windows order)', async() => {
    const project = setupProject()
    seedTree([{ pathname: '/A/old.md', birthTime: BIRTH }])
    const tab = openTab('/A/old.md')
    const editor = useEditorStore()
    project.activeItem = project.projectTree!.files[0]

    sendTreeEvent('add', mdRow({ pathname: '/A/new.md', birthTime: BIRTH }))
    vi.advanceTimersByTime(100)
    sendTreeEvent('unlink', { pathname: '/A/old.md' })
    await flushTree()

    expect(tab.pathname).toBe('/A/new.md')
    expect(tab.filename).toBe('new.md')
    expect(tab.isSaved).toBe(true)
    expect((window as unknown as { DIRNAME?: string }).DIRNAME).toBe('/A')
    expect(project.activeItem.pathname).toBe('/A/new.md')
    // Tree rows: new name in, old name gone.
    expect(project.projectTree!.files.map((f) => f.pathname)).toEqual(['/A/new.md'])
    // The tab never got marked dirty.
    expect(editor.tabs[0].isSaved).toBe(true)
  })

  it('retargets the tab when add follows unlink (Linux order)', async() => {
    setupProject()
    seedTree([{ pathname: '/A/old.md', birthTime: BIRTH }])
    const tab = openTab('/A/old.md')

    sendTreeEvent('unlink', { pathname: '/A/old.md' })
    vi.advanceTimersByTime(100)
    sendTreeEvent('add', mdRow({ pathname: '/A/new.md', birthTime: BIRTH }))
    await flushTree()
    vi.advanceTimersByTime(2_000)

    expect(tab.pathname).toBe('/A/new.md')
    expect(tab.isSaved).toBe(true)
  })

  it('keeps a dirty tab dirty after the rename', async() => {
    setupProject()
    seedTree([{ pathname: '/A/old.md', birthTime: BIRTH }])
    const tab = openTab('/A/old.md', false)

    sendTreeEvent('add', mdRow({ pathname: '/A/new.md', birthTime: BIRTH }))
    vi.advanceTimersByTime(100)
    sendTreeEvent('unlink', { pathname: '/A/old.md' })
    await flushTree()
    vi.advanceTimersByTime(2_000)

    expect(tab.pathname).toBe('/A/new.md')
    expect(tab.isSaved).toBe(false)
  })

  it('marks the tab dirty after the window on a genuine removal', async() => {
    setupProject()
    seedTree([{ pathname: '/A/old.md', birthTime: BIRTH }])
    const tab = openTab('/A/old.md')
    const editor = useEditorStore()

    sendTreeEvent('unlink', { pathname: '/A/old.md' })
    vi.advanceTimersByTime(300)
    expect(tab.isSaved).toBe(true) // still inside the pairing window
    vi.advanceTimersByTime(400)
    await flushTree()

    expect(tab.isSaved).toBe(false)
    expect(editor.tabs[0].pathname).toBe('/A/old.md')
  })

  it('does not pair delete-A-then-create-B (fresh birth time)', async() => {
    setupProject()
    seedTree([{ pathname: '/A/old.md', birthTime: BIRTH }])
    const tab = openTab('/A/old.md')

    vi.advanceTimersByTime(5_000)
    const freshBirth = Date.now()
    sendTreeEvent('add', mdRow({ pathname: '/A/other.md', birthTime: freshBirth }))
    vi.advanceTimersByTime(50)
    sendTreeEvent('unlink', { pathname: '/A/old.md' })
    vi.advanceTimersByTime(700)
    await flushTree()

    // The open tab keeps pointing at the deleted file and gets the dirty mark.
    expect(tab.pathname).toBe('/A/old.md')
    expect(tab.isSaved).toBe(false)
  })

  it('retargets tabs inside a renamed directory', async() => {
    const project = setupProject()
    seedTree([
      { pathname: '/A/sub/inner.md', birthTime: BIRTH }
    ])
    const tab = openTab('/A/sub/inner.md')

    sendTreeEvent('unlinkDir', { pathname: '/A/sub' })
    vi.advanceTimersByTime(20)
    sendTreeEvent('addDir', { pathname: '/A/sub2' })
    vi.advanceTimersByTime(20)
    sendTreeEvent('add', mdRow({ pathname: '/A/sub2/inner.md', birthTime: BIRTH }))
    vi.advanceTimersByTime(100)
    sendTreeEvent('unlink', { pathname: '/A/sub/inner.md' })
    await flushTree()
    vi.advanceTimersByTime(2_000)

    expect(tab.pathname).toBe('/A/sub2/inner.md')
    expect(tab.filename).toBe('inner.md')
    expect(tab.isSaved).toBe(true)
    expect(project.projectTree!.folders[0]?.name).toBe('sub2')
    expect(project.projectTree!.folders[0]?.files[0]?.pathname).toBe('/A/sub2/inner.md')
  })
})
