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
