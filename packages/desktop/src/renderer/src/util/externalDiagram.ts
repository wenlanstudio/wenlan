import type { IMuyaOptions } from '@muyajs/core'

/**
 * Matplotlib (and any future out-of-process diagram type) renders in the main
 * process: the document's Python snippet runs there and comes back as an image.
 *
 * Every Muya instance shares this one callback through `buildMuyaViewOptions`
 * — a projection that renders without it shows the "enable them in the
 * preferences" error card where the diagram belongs, which is how the page
 * view shipped. The live editor used to carry its own identical copy.
 */
export const renderExternalDiagram: NonNullable<IMuyaOptions['renderExternalDiagram']> = async(
  type,
  code,
  target
) => {
  const result = await window.diagram.renderExternal(type, code)
  if (!result.ok) throw new Error(result.error)

  target.innerHTML = ''
  const img = document.createElement('img')
  img.src = `data:${result.mime};base64,${result.data}`
  img.alt = type
  target.appendChild(img)
}
