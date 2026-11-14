import { beforeEach, describe, expect, it, vi } from 'vitest'

const renderExternal = vi.fn()
const rasterizeSvgFence = vi.hoisted(() => vi.fn())

vi.mock('@/util/svgFence', () => ({ rasterizeSvgFence: rasterizeSvgFence }))

import { clearExternalDiagramCache, renderExternalDiagram } from '@/util/externalDiagram'

const PNG = { ok: true, mime: 'image/png', data: 'iVBORw0KGgo=' } as const

/**
 * 外进程图表渲染缓存（视图切换反渲染守卫的一半）：matplotlib 每次未缓存调用
 * spawn 一个 Python，svg fence 重走 canvas 光栅化——引擎重建（只读透镜翻转、
 * 编辑器重挂、纸投影 mount 序列）会整树重建块，相同源码必须命中缓存/共享
 * in-flight，失败不缓存（修好 Python 路径下次渲染即生效）。
 */
describe('renderExternalDiagram — matplotlib/svg 结果缓存', () => {
  beforeEach(() => {
    clearExternalDiagramCache()
    renderExternal.mockReset()
    rasterizeSvgFence.mockReset()
    Object.defineProperty(window, 'diagram', {
      value: { renderExternal },
      configurable: true,
      writable: true
    })
  })

  const makeTarget = (): HTMLElement => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    return el
  }

  it('相同源码只 spawn 一次 Python，两个目标都拿到图', async() => {
    renderExternal.mockResolvedValue(PNG)

    const a = makeTarget()
    const b = makeTarget()
    await renderExternalDiagram('matplotlib', 'plt.plot([1,2])', a)
    await renderExternalDiagram('matplotlib', 'plt.plot([1,2])', b)

    expect(renderExternal).toHaveBeenCalledTimes(1)
    expect(a.querySelector('img')).not.toBeNull()
    expect(b.querySelector('img')).not.toBeNull()
    expect(b.querySelector('img')!.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=')
  })

  it('并发调用共享 in-flight 请求', async() => {
    renderExternal.mockResolvedValue(PNG)

    await Promise.all([
      renderExternalDiagram('matplotlib', 'plt.plot([1])', makeTarget()),
      renderExternalDiagram('matplotlib', 'plt.plot([1])', makeTarget())
    ])

    expect(renderExternal).toHaveBeenCalledTimes(1)
  })

  it('失败不缓存：修好环境后下一次重试', async() => {
    renderExternal
      .mockResolvedValueOnce({ ok: false, error: 'python not found' })
      .mockResolvedValueOnce(PNG)

    await expect(
      renderExternalDiagram('matplotlib', 'plt.plot([2])', makeTarget())
    ).rejects.toThrow(/python/)
    await expect(
      renderExternalDiagram('matplotlib', 'plt.plot([2])', makeTarget())
    ).resolves.toBeUndefined()
    expect(renderExternal).toHaveBeenCalledTimes(2)
  })

  it('svg fence 光栅化结果被缓存，目标拿到引擎标记的 img', async() => {
    rasterizeSvgFence.mockResolvedValue('data:image/png;base64,AA==')

    const a = makeTarget()
    const b = makeTarget()
    await renderExternalDiagram('svg', '<svg xmlns="http://www.w3.org/2000/svg"/>', a)
    await renderExternalDiagram('svg', '<svg xmlns="http://www.w3.org/2000/svg"/>', b)

    expect(rasterizeSvgFence).toHaveBeenCalledTimes(1)
    expect(a.querySelector('img[data-diagram-engine="svg"]')).not.toBeNull()
    expect(b.querySelector('img[data-diagram-engine="svg"]')).not.toBeNull()
  })
})
