import { diagramTypeOfLang } from '@muyajs/core'
import { renderDiagramCodeToPngDataUrl, type DiagramThemes } from './diagramExport'

/**
 * The pandoc exports (Word, ODT, EPUB, …) read the document as markdown, and
 * pandoc has no renderer for the diagram fences: a matplotlib block arrives in
 * the file as its code. Before the markdown leaves the renderer, every diagram
 * fence is drawn here — the same engines the editor renders with — and swapped
 * for the image it produced, which pandoc embeds into the document's media
 * (data: URIs are carried over; PNG works in every writer).
 *
 * A fence that fails to render (matplotlib disabled, no Python, no PlantUML
 * server) is left untouched and exports as the code block it always did.
 * `drawio` is skipped outright, like in the HTML export: a static conversion
 * has no host to drive the embed editor's postMessage protocol.
 */

export interface DiagramFence {
  /** Char offsets into the source: the fence's opening line start / closing line end. */
  start: number
  end: number
  /** The fence info string's first word. */
  lang: string
  /** The fenced source, without the fence lines themselves. */
  code: string
}

// The info string starts right after the fence characters — ` ```python ` is
// as much a fence as ` ``` python ` (CommonMark §4.5). The `\r` is spelled
// out because `.` never matches it: a CRLF file's fence lines must still open.
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)\r?$/

// A closing fence repeats the opening character at least as long, with nothing
// but whitespace after it (CommonMark §4.5).
const fenceClose = (char: string, length: number): RegExp =>
  new RegExp(`^ {0,3}\\${char}{${length},}[ \\t\\r]*$`)

const stripTrailingCr = (line: string): string =>
  line.endsWith('\r') ? line.slice(0, -1) : line

/**
 * The diagram-language fences in `markdown`, in document order.
 *
 * A character scanner rather than a markdown parse: the substitution must not
 * move any byte it does not replace, so the fences are tracked as exact source
 * ranges. Unterminated fences read as code to the end of the document, which
 * is how the editor's own tokenizer treats them.
 */
export const scanDiagramFences = (markdown: string): DiagramFence[] => {
  const lines = markdown.split('\n')

  // Character offset of each line's start, so replacements can be cut out of
  // the raw string instead of rejoining the lines (which would rewrite every
  // line ending in the document).
  const lineStarts: number[] = []
  let offset = 0
  for (const line of lines) {
    lineStarts.push(offset)
    offset += line.length + 1
  }

  const fences: DiagramFence[] = []
  let open: { char: string; length: number; line: number; lang: string } | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (open) {
      if (fenceClose(open.char, open.length).test(line)) {
        const start = lineStarts[open.line]!
        fences.push({
          start,
          // The closing line's `\r` stays: a CRLF document must not lose the
          // carriage return to a replacement that only covers the fence text.
          end: lineStarts[i]! + stripTrailingCr(line).length,
          lang: open.lang,
          code: lines.slice(open.line + 1, i).map(stripTrailingCr).join('\n')
        })
        open = null
      }
      continue
    }

    const match = FENCE_OPEN.exec(line)
    if (!match) continue
    const marker = match[1]!
    // Backtick fences may not carry a backtick in their info string — such a
    // line is paragraph text, not a fence (CommonMark §4.5).
    const info = stripTrailingCr(match[2] ?? '').trim()
    if (marker.startsWith('`') && info.includes('`')) continue

    open = { char: marker[0]!, length: marker.length, line: i, lang: info.split(/\s+/)[0] ?? '' }
  }

  // Code to EOF: the document ends inside the fence.
  if (open) {
    fences.push({
      start: lineStarts[open.line]!,
      end: markdown.length,
      lang: open.lang,
      code: lines.slice(open.line + 1).map(stripTrailingCr).join('\n')
    })
  }

  return fences
}

/**
 * Replace every diagram fence with an image of the rendered diagram, in place.
 *
 * Diagrams render sequentially (each matplotlib block is a Python process),
 * and a fence that fails keeps its place as code. The offsets are all measured
 * on the input, so replacements are applied back-to-front.
 */
export const substituteDiagramFences = async(
  markdown: string,
  themes: DiagramThemes
): Promise<string> => {
  const diagrams: Array<{ fence: DiagramFence; type: string }> = []
  for (const fence of scanDiagramFences(markdown)) {
    const type = diagramTypeOfLang(fence.lang)
    if (type && type !== 'drawio') diagrams.push({ fence, type })
  }
  if (!diagrams.length) return markdown

  const images: Array<string | null> = []
  for (const { fence, type } of diagrams) {
    images.push(await renderDiagramCodeToPngDataUrl(type, fence.code, themes).catch(() => null))
  }

  let result = markdown
  for (let i = diagrams.length - 1; i >= 0; i--) {
    const image = images[i]
    if (!image) continue
    const { fence } = diagrams[i]!
    result = result.slice(0, fence.start) + `![](${image})` + result.slice(fence.end)
  }
  return result
}
