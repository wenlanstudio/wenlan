import { exportDrawio, renderDiagramForExport } from '@muyajs/core'
import { renderGraphvizWithExe } from './graphvizRender'
import { normalizeSvgFence, rasterizeSvgFence } from './svgFence'

export type ExportFormat = 'svg' | 'png'

export interface DiagramThemes {
  mermaidTheme: string
  vegaTheme: string
  plantumlServer: string
  sequenceTheme: 'hand' | 'simple'
  drawioServer: string
}

export interface DiagramSource extends DiagramThemes {
  type: string
  code: string
  preview: HTMLElement
}

export interface ExportedImage {
  data: Uint8Array
  mime: string
  extension: ExportFormat
}

const PNG_SCALE = 2
const MAX_PIXELS = 4e7

// Raphael (flowchart.js) and Snap (js-sequence-diagrams) leave their text
// uncoloured and let the editor's stylesheet do it, so a standalone copy of
// their output would come out black on whatever background it lands on.
// Mermaid and Vega-Lite carry their own styling and need none of this.
const NEEDS_INLINE_STYLES = new Set(['flowchart', 'sequence'])
const INLINED_PROPERTIES = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor'
]
const MAX_STYLED_ELEMENTS = 5000

const PLANTUML_SRC = /^(https?:\/\/.+?)\/(?:svg|png|txt)\/([A-Za-z0-9_-]+)$/

export const splitPlantumlSrc = (src: string): { server: string; encoded: string } | null => {
  const match = PLANTUML_SRC.exec(src)
  return match ? { server: match[1], encoded: match[2] } : null
}

const inlineComputedStyles = (live: Element, clone: Element): void => {
  const liveNodes = [live, ...live.querySelectorAll('*')]
  const cloneNodes = [clone, ...clone.querySelectorAll('*')]
  if (liveNodes.length !== cloneNodes.length || liveNodes.length > MAX_STYLED_ELEMENTS) return

  for (let i = 0; i < liveNodes.length; i++) {
    const computed = getComputedStyle(liveNodes[i])
    const declarations = INLINED_PROPERTIES.map(
      (property) => [property, computed.getPropertyValue(property)] as const
    )
      .filter(([, value]) => value)
      .map(([property, value]) => `${property}:${value}`)
      .join(';')

    if (!declarations) continue

    const target = cloneNodes[i]
    const existing = target.getAttribute('style')?.replace(/;\s*$/, '')
    target.setAttribute('style', existing ? `${existing};${declarations}` : declarations)
  }
}

export interface SerializedSvg {
  markup: string
  width: number
  height: number
}

/**
 * The size a diagram was drawn at, which is what its `viewBox` records — the
 * laid-out size is whatever the editor column happened to squeeze it into.
 */
export const naturalSvgSize = (svg: SVGSVGElement): { width: number; height: number } => {
  const box = svg.viewBox?.baseVal
  const rect = svg.getBoundingClientRect()

  return {
    width: Math.max(1, Math.round(box?.width || rect.width)),
    height: Math.max(1, Math.round(box?.height || rect.height))
  }
}

export interface SerializeOptions {
  inlineStyles: boolean
  /** Painted behind the drawing, since an exported file has no editor under it. */
  background: string
}

export const serializeSvg = (svg: SVGSVGElement, options: SerializeOptions): SerializedSvg => {
  const { width, height } = naturalSvgSize(svg)

  const clone = svg.cloneNode(true) as SVGSVGElement
  // Before anything is added to the clone: the walk pairs the two trees up by
  // position and gives up if their shapes differ.
  if (options.inlineStyles) inlineComputedStyles(svg, clone)

  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${width} ${height}`)
  // Mermaid caps its root at the width it was measured in; a standalone file
  // has no such container.
  clone.style.removeProperty('max-width')

  // A dark theme draws pale strokes and pale text. On the transparent canvas an
  // svg defaults to, that is invisible wherever the file is opened.
  const box = svg.viewBox?.baseVal
  const backdrop = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  backdrop.setAttribute('x', String(Math.floor(box?.x ?? 0)))
  backdrop.setAttribute('y', String(Math.floor(box?.y ?? 0)))
  backdrop.setAttribute('width', String(width))
  backdrop.setAttribute('height', String(height))
  // Inline, so a stylesheet the renderer embedded cannot repaint it.
  backdrop.setAttribute('style', `fill:${options.background}`)
  clone.insertBefore(backdrop, clone.firstChild)

  const markup = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`

  return { markup, width, height }
}

const toBytes = (text: string): Uint8Array => new TextEncoder().encode(text)

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The diagram could not be read back as an image'))
    // A `blob:` URL would be blocked: the renderer's CSP lists `data:` and
    // `file:` under img-src, and `*` matches neither scheme.
    image.src = src
  })

const loadSvgImage = (markup: string): Promise<HTMLImageElement> =>
  loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`)

// `String.fromCharCode` takes a spread, and a multi-megabyte PNG would blow
// the call stack — feed it the bytes in slices.
const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

const rasterize = async(svg: SerializedSvg, background: string): Promise<Uint8Array> => {
  const scale = Math.min(PNG_SCALE, Math.sqrt(MAX_PIXELS / (svg.width * svg.height)))
  const image = await loadSvgImage(svg.markup)

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(svg.width * scale))
  canvas.height = Math.max(1, Math.round(svg.height * scale))

  const context = canvas.getContext('2d')
  if (!context) throw new Error('The diagram could not be rasterised')

  context.fillStyle = background
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('The diagram could not be rasterised')

  return new Uint8Array(await blob.arrayBuffer())
}

// Mermaid puts node labels in a `<foreignObject>`, which only a browser will
// paint. Re-render the same code with plain `<text>` labels — ECharts comes
// through here too, for its svg renderer rather than the canvas it drew with.
const renderForExport = async(source: DiagramSource, options: SerializeOptions): Promise<SerializedSvg> => {
  const host = document.createElement('figure')
  host.className = 'mu-diagram-block'
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'position:fixed;left:-99999px;top:0'
  const target = document.createElement('div')
  target.className = 'mu-diagram-preview'
  host.appendChild(target)
  document.body.appendChild(host)

  try {
    await renderDiagramForExport({
      type: source.type,
      code: source.code,
      target,
      htmlLabels: false,
      mermaidTheme: source.mermaidTheme,
      vegaTheme: source.vegaTheme,
      plantumlServer: source.plantumlServer,
      sequenceTheme: source.sequenceTheme,
      drawioServer: source.drawioServer
    })

    const svg = target.querySelector('svg')
    if (!svg) throw new Error('The diagram could not be re-rendered for export')

    // While it is still in the document: a detached node measures as nothing
    // and has no computed style to read.
    return serializeSvg(svg, options)
  } finally {
    host.remove()
  }
}

const exportPlantuml = async(source: DiagramSource, format: ExportFormat): Promise<ExportedImage> => {
  const img = source.preview.querySelector('img')
  const parts = img?.src ? splitPlantumlSrc(img.src) : null
  if (!parts) throw new Error('The PlantUML diagram has no render URL')

  const result = await window.diagram.fetchPlantuml(parts.server, parts.encoded, format)
  if (!result.ok) throw new Error(result.error)

  return { data: result.data, mime: result.mime, extension: format }
}

const decodeDataUrl = (src: string): { mime: string; data: Uint8Array } | null => {
  const match = /^data:([^;,]+);base64,(.*)$/.exec(src)
  if (!match) return null
  const binary = atob(match[2])
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return { mime: match[1], data: bytes }
}

// matplotlib hands back a finished image, so exporting is decoding the data
// URL — plus a rasterising detour when the requested format differs.
const exportExternalImage = async(
  source: DiagramSource,
  format: ExportFormat
): Promise<ExportedImage> => {
  const img = source.preview.querySelector('img')
  const src = img?.getAttribute('src') ?? ''
  const decoded = decodeDataUrl(src)
  if (!img || !decoded) throw new Error('The diagram has no rendered image')

  const isSvg = decoded.mime.includes('svg')
  if (format === 'svg' && isSvg) return { ...decoded, extension: 'svg' }
  if (format === 'png' && !isSvg) return { ...decoded, extension: 'png' }

  // `src` is already a data URL (SVG or PNG); wrapping it as SVG markup would
  // turn it into an unreadable `data:image/svg+xml,...data%3Aimage...` string.
  const image = await loadImage(src)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, image.naturalWidth * PNG_SCALE)
  canvas.height = Math.max(1, image.naturalHeight * PNG_SCALE)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('The diagram could not be rasterised')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('The diagram could not be rasterised')
  return { data: new Uint8Array(await blob.arrayBuffer()), mime: 'image/png', extension: 'png' }
}

// Chart.js draws into a bitmap canvas: PNG is a straight `toBlob`, SVG has no
// source to serialise. ECharts draws into one too, but it can redraw as vector
// when the file has to be SVG.
const exportCanvas = async(
  source: DiagramSource,
  format: ExportFormat,
  background: string
): Promise<ExportedImage> => {
  const canvas = source.preview.querySelector('canvas')
  if (!canvas) throw new Error('The chart has not rendered')

  if (format === 'svg') {
    if (source.type === 'echarts') {
      const svg = await renderForExport(source, {
        inlineStyles: false,
        background
      })
      return { data: toBytes(svg.markup), mime: 'image/svg+xml', extension: 'svg' }
    }
    throw new Error('Chart.js renders to a bitmap — export the chart as PNG instead')
  }

  const output = document.createElement('canvas')
  output.width = canvas.width
  output.height = canvas.height
  const context = output.getContext('2d')
  if (!context) throw new Error('The chart could not be rasterised')
  context.fillStyle = background
  context.fillRect(0, 0, output.width, output.height)
  context.drawImage(canvas, 0, 0)

  const blob = await new Promise<Blob | null>((resolve) => output.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('The chart could not be rasterised')
  return { data: new Uint8Array(await blob.arrayBuffer()), mime: 'image/png', extension: 'png' }
}

// The embed frame still holds the diagram, so export goes back through the
// DrawIO protocol instead of re-rendering.
const exportDrawioDiagram = async(
  source: DiagramSource,
  format: ExportFormat
): Promise<ExportedImage> => {
  const frame = source.preview.querySelector('iframe')
  if (!frame) throw new Error('The DrawIO embed has not loaded')

  const dataUri = await exportDrawio(frame as HTMLIFrameElement, format)
  const decoded = decodeDataUrl(dataUri)
  if (!decoded) throw new Error('The DrawIO embed returned an unreadable export')

  return {
    data: decoded.data,
    mime: decoded.mime,
    extension: decoded.mime.includes('svg') ? 'svg' : 'png'
  }
}

// A text export (pandoc) carries the drawing inside the markdown as pixels:
// rasterise at the natural size, where a 2x raster would land in the document
// twice as large. White behind the drawing — the exported file has no editor.
const PANDOC_BACKGROUND = '#ffffff'

const rasterizeToPngDataUrl = (image: HTMLImageElement): string => {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, image.naturalWidth)
  canvas.height = Math.max(1, image.naturalHeight)

  const context = canvas.getContext('2d')
  if (!context) throw new Error('The diagram could not be rasterised')
  context.fillStyle = PANDOC_BACKGROUND
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)

  return canvas.toDataURL('image/png')
}

/**
 * Run `code` as a `type` diagram and return a PNG data URL at its natural
 * size — the text-export counterpart of `exportDiagram`, which works from a
 * live preview instead of a fence's source.
 *
 * Throws when the diagram cannot be drawn (matplotlib disabled, no Python, no
 * PlantUML server); the caller falls back to exporting the fence as the code
 * block it always exported as.
 */
export const renderDiagramCodeToPngDataUrl = async(
  type: string,
  code: string,
  themes: DiagramThemes
): Promise<string> => {
  if (type === 'svg') {
    // The fence already carries the finished drawing. Rasterise it directly:
    // renderDiagramForExport deliberately has no external callback injected,
    // so going through the generic path below would find no renderer.
    return rasterizeSvgFence(code)
  }

  if (type === 'matplotlib') {
    // The main process runs the Python and hands back a finished SVG whose pt
    // dimensions become the pixel size the image loads at.
    const result = await window.diagram.renderExternal(type, code)
    if (!result.ok) throw new Error(result.error)
    return rasterizeToPngDataUrl(await loadImage(`data:${result.mime};base64,${result.data}`))
  }

  if (type === 'graphviz') {
    // Same exe-first decision as the preview: a 192 dpi PNG is already the
    // pixels pandoc needs. Without dot.exe, fall through to the WASM render
    // below (renderDiagramForExport has no external callback injected).
    const exe = await renderGraphvizWithExe(code)
    if (exe.ok) return rasterizeToPngDataUrl(await loadImage(exe.dataUrl))
  }

  const host = document.createElement('figure')
  host.className = 'mu-diagram-block'
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'position:fixed;left:-99999px;top:0'
  const target = document.createElement('div')
  target.className = 'mu-diagram-preview'
  host.appendChild(target)
  document.body.appendChild(host)

  try {
    await renderDiagramForExport({
      type,
      code,
      target,
      htmlLabels: false,
      mermaidTheme: themes.mermaidTheme,
      vegaTheme: themes.vegaTheme,
      plantumlServer: themes.plantumlServer,
      sequenceTheme: themes.sequenceTheme,
      drawioServer: themes.drawioServer
    })

    if (type === 'plantuml') {
      // The server drew it, not the browser: the render is an `<img>` pointing
      // at the (server, encoded) pair, and the same diagram is fetched as PNG.
      const img = target.querySelector('img')
      const parts = img?.src ? splitPlantumlSrc(img.src) : null
      if (!parts) throw new Error('The PlantUML diagram has no render URL')

      const result = await window.diagram.fetchPlantuml(parts.server, parts.encoded, 'png')
      if (!result.ok) throw new Error(result.error)
      return `data:${result.mime};base64,${bytesToBase64(result.data)}`
    }

    const svg = target.querySelector('svg')
    if (svg) {
      const serialized = serializeSvg(svg, {
        inlineStyles: NEEDS_INLINE_STYLES.has(type),
        background: PANDOC_BACKGROUND
      })
      return rasterizeToPngDataUrl(await loadSvgImage(serialized.markup))
    }

    // Chart.js only draws onto a bitmap canvas; there is no svg to serialise.
    const canvas = target.querySelector('canvas')
    if (canvas) return canvas.toDataURL('image/png')

    throw new Error('The diagram did not render into an image')
  } finally {
    host.remove()
  }
}

export const exportDiagram = async(
  source: DiagramSource,
  format: ExportFormat,
  background: string
): Promise<ExportedImage> => {
  if (source.type === 'plantuml') return exportPlantuml(source, format)
  if (source.type === 'matplotlib') return exportExternalImage(source, format)
  if (source.type === 'svg') {
    // A vector export keeps the author's markup (normalised to explicit
    // numeric dimensions); a PNG export reuses the bitmap in the live preview.
    if (format === 'svg') {
      return {
        data: toBytes(normalizeSvgFence(source.code).markup),
        mime: 'image/svg+xml',
        extension: 'svg'
      }
    }
    return exportExternalImage(source, format)
  }
  // dot.exe draws a finished bitmap: the live preview holds an <img> instead
  // of the <svg> the WASM fallback produces. PNG exports decode that image;
  // an SVG request is re-rendered with WASM below so the file stays vector.
  const exeBitmap = source.type === 'graphviz'
    && !!source.preview.querySelector('img[data-graphviz-engine="exe"]')
  if (exeBitmap && format !== 'svg') return exportExternalImage(source, format)
  if (source.type === 'drawio') return exportDrawioDiagram(source, format)
  if (source.type === 'chart' || source.type === 'echarts') {
    return exportCanvas(source, format, background)
  }

  const options = { inlineStyles: NEEDS_INLINE_STYLES.has(source.type), background }
  // Mermaid's `<foreignObject>` labels need the re-render; so does a vector
  // export of a dot.exe bitmap, which has no SVG source to serialise.
  let svg: SerializedSvg
  if (source.type === 'mermaid' || (exeBitmap && format === 'svg')) {
    svg = await renderForExport(source, options)
  }
  else {
    const live = source.preview.querySelector('svg')
    if (!live) throw new Error('The diagram has not rendered')
    svg = serializeSvg(live as SVGSVGElement, options)
  }

  if (format === 'svg') {
    return { data: toBytes(svg.markup), mime: 'image/svg+xml', extension: 'svg' }
  }

  return { data: await rasterize(svg, background), mime: 'image/png', extension: 'png' }
}
