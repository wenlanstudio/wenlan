import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

// #26 — project.ts watches `currentFile.pathname` and used to send
// `mt::switch-directory` for every directory change, so clicking a file in a
// subfolder re-rooted the file tree. These tests drive that watcher directly.

const { ipcSend } = vi.hoisted(() => {
  const ipcSend = vi.fn()
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
      electron?: { ipcRenderer: { send: (...a: unknown[]) => void; on: (...a: unknown[]) => void } }
    }
  }
  w.window ??= {}
  w.window.marktext ??= { env: { windowId: 1 } }
  w.window.path ??= {
    sep: '/',
    normalize: (p) => p,
    basename: (p) => p.split('/').pop() ?? p,
    dirname: (p) => p.split('/').slice(0, -1).join('/') || '/',
    isAbsolute: (p) => p.startsWith('/'),
    relative: (from, to) => to.slice(from.length + 1)
  }
  w.window.fileUtils ??= {
    hasMarkdownExtension: (n) => n.endsWith('.md'),
    pathExists: () => Promise.resolve(false),
    isSamePathSync: (a, b) => a === b,
    isChildOfDirectory: (dir, child) => child.startsWith(dir.replace(/\/+$/, '') + '/')
  }
  w.window.electron ??= { ipcRenderer: { send: ipcSend, on: () => {} } }
  return { ipcSend }
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))

import { useProjectStore } from '@/store/project'
import { useEditorStore } from '@/store/editor'

const openFile = async(pathname: string): Promise<void> => {
  const editor = useEditorStore()
  editor.currentFile = { pathname } as never
  await nextTick()
}

describe('#26 sidebar root stays fixed on tree-internal navigation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    ipcSend.mockClear()
  })

  it('does not re-root when the active file moves into a subfolder', async() => {
    const project = useProjectStore()
    project.OPEN_PROJECT('/A')
    ipcSend.mockClear()

    await openFile('/A/B/b.md')

    expect(ipcSend).not.toHaveBeenCalledWith('mt::switch-directory', expect.anything())
    expect(project.projectTree?.pathname).toBe('/A')
  })

  it('does not re-root for a file already in the root folder', async() => {
    const project = useProjectStore()
    project.OPEN_PROJECT('/A')
    ipcSend.mockClear()

    await openFile('/A/a.md')

    expect(ipcSend).not.toHaveBeenCalledWith('mt::switch-directory', expect.anything())
  })

  it('still re-roots for a file opened outside the current tree', async() => {
    const project = useProjectStore()
    project.OPEN_PROJECT('/A')
    ipcSend.mockClear()

    await openFile('/Other/c.md')

    expect(ipcSend).toHaveBeenCalledWith('mt::switch-directory', '/Other')
  })

  it('bootstraps the root when no project tree exists yet', async() => {
    useProjectStore()

    await openFile('/A/a.md')

    expect(ipcSend).toHaveBeenCalledWith('mt::switch-directory', '/A')
  })
})
