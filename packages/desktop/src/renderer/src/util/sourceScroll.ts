import type CodeMirror from 'codemirror'

/** The CodeMirror surface the source scroll helpers need. */
export type ISourceEditor = Pick<
  CodeMirror.Editor,
  'setCursor' | 'heightAtLine' | 'lineAtHeight' | 'getScrollerElement'
>

/**
 * The source view scrolls the OUTER `.source-code` container: CodeMirror runs
 * with `viewportMargin: Infinity`, so it renders the whole document at full
 * height and its own scroller never scrolls. The CodeMirror content therefore
 * sits at an offset (the `.CodeMirror` margin) inside the container's scrolled
 * content, and the container's scrollTop has to be translated into
 * CodeMirror's coordinate space before it means anything.
 */
const contentOffset = (editor: ISourceEditor, container: HTMLElement | null): number => {
  if (!container) return 0
  const scroller = editor.getScrollerElement()
  if (!scroller) return 0

  return scroller.getBoundingClientRect().top
    - container.getBoundingClientRect().top
    + container.scrollTop
}

/**
 * The 0-based line at the top of the scroll container's viewport — the source
 * view's counterpart of the Page view's "first visible block".
 */
export const sourceTopLine = (editor: ISourceEditor, container: HTMLElement | null): number => {
  if (!container) return 0
  const scroller = editor.getScrollerElement()
  if (!scroller) return 0

  // The container's viewport top in CodeMirror's local coordinates. Both
  // elements move together while scrolling, so the offset is scroll-invariant.
  const y = container.getBoundingClientRect().top - scroller.getBoundingClientRect().top

  return editor.lineAtHeight(Math.max(0, y), 'local')
}

/**
 * 视口顶的实数行位（§6.0 的 ρ_source）：整数部分 = 行（1 基），小数部分 =
 * 行内像素进度。本视图的单位就是源码行、CM 逐行有精确坐标——全系统最细的
 * 实现算子，行位在这里无损。
 */
export const sourceTopRealLine = (
  editor: ISourceEditor,
  container: HTMLElement | null
): { line: number; frac: number } => {
  if (!container) return { line: 0, frac: 0 }
  const scroller = editor.getScrollerElement()
  if (!scroller) return { line: 0, frac: 0 }

  const y = container.getBoundingClientRect().top - scroller.getBoundingClientRect().top
  const line = editor.lineAtHeight(Math.max(0, y), 'local')
  const top = editor.heightAtLine(line, 'local')
  const height = editor.heightAtLine(line + 1, 'local') - top
  const frac = height > 0 ? Math.min(1, Math.max(0, (y - top) / height)) : 0
  return { line: line + 1, frac }
}

/**
 * Scroll the source editor so `line` (0-based) sits at the top of the
 * viewport. The caret is left alone — the caller decides whether the scroll
 * should also move it.
 */
export const scrollSourceToLine = (
  editor: ISourceEditor,
  line: number,
  container: HTMLElement | null,
  behavior: ScrollBehavior = 'auto'
): void => {
  if (!container) return
  const top = editor.heightAtLine(line, 'local') + contentOffset(editor, container)
  container.scrollTo({ top, behavior })
}

/**
 * Scroll so the real-valued line (1-based；小数部分 = 行内进度) sits at the
 * viewport top — `sourceTopRealLine` 的逆（§6.0 的 R_source）。行高逐行精确
 * 线性插值，是模型里唯一无损的实现算子。caret 不动。
 */
export const scrollSourceToRealLine = (
  editor: ISourceEditor,
  realLine: number,
  container: HTMLElement | null,
  behavior: ScrollBehavior = 'auto'
): void => {
  if (!container) return
  const line = Math.max(1, Math.floor(realLine))
  const frac = Math.min(1, Math.max(0, realLine - line))
  const top0 = editor.heightAtLine(line - 1, 'local')
  const height = editor.heightAtLine(line, 'local') - top0
  const top = top0 + height * frac + contentOffset(editor, container)
  container.scrollTo({ top, behavior })
}
