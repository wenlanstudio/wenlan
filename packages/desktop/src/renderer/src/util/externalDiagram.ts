import type { IMuyaOptions } from '@muyajs/core'
import { renderGraphvizWithExe } from './graphvizRender'
import { rasterizeSvgFence } from './svgFence'

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
    const dataUrl = await rasterizeSvgFence(code)
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

  const result = await window.diagram.renderExternal(type, code)
  if (!result.ok) throw new Error(result.error)

  target.innerHTML = ''
  const img = document.createElement('img')
  img.src = `data:${result.mime};base64,${result.data}`
  img.alt = type
  target.appendChild(img)
}
