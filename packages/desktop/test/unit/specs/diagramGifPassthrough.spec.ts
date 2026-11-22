import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderDiagramCodeToPngDataUrl, type DiagramThemes } from '@/util/diagramExport'
import { renderMatplotlibToDataUrl } from '@/util/md2slidesDiagram'

const renderExternal = vi.fn()

const THEMES: DiagramThemes = {
  mermaidTheme: 'default',
  vegaTheme: 'latimes',
  plantumlServer: 'https://plantuml.example',
  sequenceTheme: 'hand',
  drawioServer: 'https://draw.example'
}

const GIF = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

/**
 * 动画块从主进程回来的是成品 GIF（matplotlib Animation → PillowWriter）。成品
 * 位图必须原样透传：Word 导出与 deck 桥两侧都不允许再过 canvas——栅格会把多帧
 * 压成首帧。静态块的 SVG 栅格路径不在本 spec（jsdom 没有 canvas），由真机验收盖。
 */
describe('成品 GIF 透传（不过 canvas）', () => {
  beforeEach(() => {
    renderExternal.mockReset()
    Object.defineProperty(window, 'diagram', {
      value: { renderExternal },
      configurable: true,
      writable: true
    })
  })

  it('pandoc 导出：matplotlib 动画块按原 data URI 交给 pandoc', async() => {
    renderExternal.mockResolvedValue({ ok: true, mime: 'image/gif', data: GIF })

    const url = await renderDiagramCodeToPngDataUrl('matplotlib', 'ani = FuncAnimation(...)', THEMES)

    expect(url).toBe(`data:image/gif;base64,${GIF}`)
    expect(renderExternal).toHaveBeenCalledWith('matplotlib', 'ani = FuncAnimation(...)')
  })

  it('deck 桥：matplotlib 动画块跳过 SVG 栅格直接回位图 data URL', async() => {
    renderExternal.mockResolvedValue({ ok: true, mime: 'image/gif', data: GIF })

    const url = await renderMatplotlibToDataUrl('ani = FuncAnimation(...)')

    expect(url).toBe(`data:image/gif;base64,${GIF}`)
  })

  it('错误照旧上抛，由调用方决定回退', async() => {
    renderExternal.mockResolvedValue({ ok: false, error: 'no python' })

    await expect(renderMatplotlibToDataUrl('x = 1')).rejects.toThrow(/no python/)
  })
})
