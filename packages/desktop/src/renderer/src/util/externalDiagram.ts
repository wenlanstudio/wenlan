import type { IMuyaOptions } from '@muyajs/core'
import { renderGraphvizWithExe } from './graphvizRender'
import { rasterizeSvgFence } from './svgFence'

/**
 * Result cache for the remaining out-of-process renderers — matplotlib (spawns
 * the document's Python) and svg fences (canvas rasterisation). Graphviz has
 * its own cache in graphvizRender.ts; without this one, every engine rebuild
 * (readOnly lens flips, editor remounts, paperProjection's mount sequence)
 * re-spawned Python for identical source.
 *
 * Same contract as graphvizRender: in-flight requests are shared, successful
 * results are cached by (type, source), failures are not — fixing the Python
 * path takes effect on the next render without a restart.
 */
interface ExternalRenderResult {
  ok: boolean
  error?: string
  mime?: string
  data?: string
}

const MAX_EXTERNAL_CACHE = 64

/** Tiny promise-sharing LRU: identical keys collapse into one in-flight call. */
class PromiseLru<T> {
  private readonly cache = new Map<string, Promise<T>>()

  run(key: string, task: () => Promise<T>, keep: (value: T) => boolean): Promise<T> {
    const pending = this.cache.get(key)
    if (pending) return pending

    const request = task().then((value) => {
      // Failures are deliberately not cached (mirrors graphvizRender).
      if (!keep(value)) this.cache.delete(key)
      return value
    })
    this.cache.set(key, request)
    if (this.cache.size > MAX_EXTERNAL_CACHE) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }
    return request
  }

  clear(): void {
    this.cache.clear()
  }
}

const externalRenders = new PromiseLru<ExternalRenderResult>()
const svgRasters = new PromiseLru<string>()

/** FNV-1a over type and source: results are keyed by content, not block identity. */
const hashExternalSource = (type: string, code: string): string => {
  let hash = 2166136261
  const text = `${type}\u0000${code}`
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

const renderExternalCached = (type: string, code: string): Promise<ExternalRenderResult> =>
  externalRenders.run(
    hashExternalSource(type, code),
    () => window.diagram.renderExternal(type, code),
    (result) => result.ok
  )

const rasterizeSvgFenceCached = (code: string): Promise<string> =>
  svgRasters.run(
    hashExternalSource('svg', code),
    () => rasterizeSvgFence(code),
    () => true
  )

/** Test helper: forget cached external renders. */
export const clearExternalDiagramCache = (): void => {
  externalRenders.clear()
  svgRasters.clear()
}

/**
 * Out-of-process diagram rendering, shared by every Muya instance through
 * `buildMuyaViewOptions`. Matplotlib runs the document's Python; Graphviz
 * prefers the installed `dot.exe` over the bundled WASM compiler; an `svg`
 * fence is frozen into a bitmap on a local canvas.
 *
 * A Graphviz failure throws on purpose: muya catches it and draws the same
 * diagram with WASM, so a machine without Graphviz never shows an error card.
 */
export const renderExternalDiagram: NonNullable<IMuyaOptions['renderExternalDiagram']> = async(
  type,
  code,
  target
) => {
  // An `svg` fence carries the whole drawing as markup. Freeze it to a 2x PNG
  // here so every Muya instance (文 / 栏 / 页) measures real pixels, and the
  // export chain receives a media file python-pptx can actually insert.
  if (type === 'svg') {
    const dataUrl = await rasterizeSvgFenceCached(code)
    target.innerHTML = ''
    const img = document.createElement('img')
    img.src = dataUrl
    img.alt = type
    img.dataset.diagramEngine = 'svg'
    target.appendChild(img)
    return
  }

  if (type === 'graphviz') {
    const result = await renderGraphvizWithExe(code)
    if (!result.ok) throw new Error(result.error)

    target.innerHTML = ''
    const img = document.createElement('img')
    img.src = result.dataUrl
    img.alt = type
    // Export and the media viewer use this to tell a dot.exe bitmap apart from
    // the WASM `<svg>` that takes its place on machines without Graphviz.
    img.dataset.graphvizEngine = 'exe'
    target.appendChild(img)
    return
  }

  // matplotlib（等宿主外渲染）：走缓存，视图切换的引擎重建不再重复 spawn Python。
  const result = await renderExternalCached(type, code)
  if (!result.ok) throw new Error(result.error)

  target.innerHTML = ''
  const img = document.createElement('img')
  img.src = `data:${result.mime};base64,${result.data}`
  img.alt = type
  target.appendChild(img)
}
