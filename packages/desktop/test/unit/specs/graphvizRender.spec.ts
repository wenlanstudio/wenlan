import { beforeEach, describe, expect, it, vi } from 'vitest'

const renderExternal = vi.fn()
const state = vi.hoisted(() => ({ dotPath: '' }))

vi.mock('@/store/preferences', () => ({
  usePreferencesStore: () => ({ graphvizDotPath: state.dotPath })
}))

import { clearGraphvizExeCache, renderGraphvizWithExe } from '@/util/graphvizRender'

const CODE = 'digraph G { A -> B }'
const PNG = { ok: true, mime: 'image/png', data: 'iVBORw0KGgo=' } as const

describe('renderGraphvizWithExe', () => {
  beforeEach(() => {
    clearGraphvizExeCache()
    state.dotPath = ''
    renderExternal.mockReset()
    Object.defineProperty(window, 'diagram', {
      value: { renderExternal },
      configurable: true,
      writable: true
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('prefers dot.exe and hands back a ready-to-use data URL', async() => {
    renderExternal.mockResolvedValue(PNG)

    const result = await renderGraphvizWithExe(CODE)

    expect(result).toEqual({
      ok: true,
      mime: 'image/png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgo='
    })
    expect(renderExternal).toHaveBeenCalledWith('graphviz', CODE)
  })

  it('reports a failure without throwing so the caller can use WASM', async() => {
    renderExternal.mockResolvedValue({ ok: false, error: 'No usable Graphviz dot executable' })

    const result = await renderGraphvizWithExe(CODE)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Graphviz/)
  })

  it('shares in-flight renders and caches successful ones by source', async() => {
    renderExternal.mockResolvedValue(PNG)

    const [first, second] = await Promise.all([
      renderGraphvizWithExe(CODE),
      renderGraphvizWithExe(CODE)
    ])
    await renderGraphvizWithExe(CODE)

    expect(first).toEqual(second)
    expect(renderExternal).toHaveBeenCalledTimes(1)
  })

  it('does not cache failures: a newly available dot.exe is picked up next render', async() => {
    renderExternal
      .mockResolvedValueOnce({ ok: false, error: 'missing' })
      .mockResolvedValueOnce(PNG)

    expect((await renderGraphvizWithExe(CODE)).ok).toBe(false)
    expect((await renderGraphvizWithExe(CODE)).ok).toBe(true)
    expect(renderExternal).toHaveBeenCalledTimes(2)
  })

  it('re-renders when the configured dot path changes', async() => {
    renderExternal.mockResolvedValue(PNG)

    await renderGraphvizWithExe(CODE)
    state.dotPath = 'D:/Graphviz/bin/dot.exe'
    await renderGraphvizWithExe(CODE)

    expect(renderExternal).toHaveBeenCalledTimes(2)
  })

  it('survives an IPC rejection and still lets the caller fall back', async() => {
    renderExternal.mockRejectedValue(new Error('ipc bridge gone'))

    const result = await renderGraphvizWithExe(CODE)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('ipc bridge gone')
  })
})
