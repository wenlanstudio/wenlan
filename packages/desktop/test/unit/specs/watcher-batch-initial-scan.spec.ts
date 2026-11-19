import { beforeEach, describe, expect, it, vi } from 'vitest'

// Large directories froze the sidebar because chokidar's initial scan emitted
// one IPC send per markdown file, each also reading the full file content.
// During the initial scan the main process now collects metadata-only changes
// and flushes them as a single `batch` event on `ready` (or by size). New files
// created after `ready` still carry content so the renderer can open them.

type Handler = (...args: unknown[]) => void

const watchMock = vi.fn()
let handlers: Record<string, Handler>

function fakeWatcher(): Record<string, unknown> {
  const w: Record<string, unknown> = {}
  handlers = {}
  w.on = vi.fn((event: string, handler: Handler) => {
    handlers[event] = handler
    return w
  })
  w.close = vi.fn()
  w.add = vi.fn()
  w.unwatch = vi.fn()
  return w
}

vi.mock('chokidar', () => ({
  default: {
    watch: (...args: unknown[]) => {
      watchMock(...args)
      return fakeWatcher()
    }
  }
}))

vi.mock('ced', () => ({ default: () => 'UTF-8' }))
vi.mock('electron-log', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('fs/promises', async(importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const stat = vi.fn(async() => ({
    birthtime: new Date(0),
    mtimeMs: 0
  }))
  return { ...actual, default: { ...(actual.default as object), stat }, stat }
})
vi.mock('main_renderer/filesystem/markdown', () => ({
  loadMarkdownFile: vi.fn(async() => ({ markdown: '# new' }))
}))

import Watcher from 'main_renderer/filesystem/watcher'

const flushMicrotasks = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

describe('watcher bulk initial scan', () => {
  let watcher: Watcher
  let send: ReturnType<typeof vi.fn>
  let win: { id: number; webContents: { send: ReturnType<typeof vi.fn> } }

  beforeEach(() => {
    watchMock.mockClear()
    send = vi.fn()
    win = { id: 1, webContents: { send } }
    const preferences = {
      getItem: vi.fn(() => false),
      getAll: vi.fn(() => ({})),
      getPreferredEol: vi.fn(() => 'lf')
    }
    watcher = new Watcher(preferences as never)
  })

  it('coalesces the initial scan into a single metadata-only batch on ready', async() => {
    watcher.watch(win as never, '/project', 'dir')

    await handlers.add('/project/a.md')
    await handlers.add('/project/b.md')
    handlers.addDir('/project/sub')
    expect(send).not.toHaveBeenCalled()

    handlers.ready()
    expect(send).toHaveBeenCalledTimes(1)
    const payload = send.mock.calls[0][1] as { type: string; changes: Array<{ type: string; change: { name: string; data?: unknown } }> }
    expect(payload.type).toBe('batch')
    expect(payload.changes.map((c) => c.type)).toEqual(['add', 'add', 'addDir'])
    expect(payload.changes.every((c) => c.change.data === undefined)).toBe(true)
  })

  it('resumes per-file content events after ready (new file still opens)', async() => {
    watcher.watch(win as never, '/project', 'dir')
    handlers.ready()

    await handlers.add('/project/new.md')
    await flushMicrotasks()
    expect(send).not.toHaveBeenCalledWith('mt::update-object-tree', {
      type: 'batch',
      changes: expect.anything()
    })
    // Non-batch add is sent to the tree channel with content loaded when markdown.
    const treeSends = send.mock.calls.filter((c) => c[0] === 'mt::update-object-tree')
    expect(treeSends.length).toBe(1)
  })
})
