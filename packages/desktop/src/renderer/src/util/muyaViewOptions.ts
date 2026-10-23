import type { IMuyaOptions } from '@muyajs/core'
import { DEFAULT_CODE_FONT_FAMILY, DEFAULT_EDITOR_FONT_FAMILY } from '@/config'
import { usePreferencesStore } from '@/store/preferences'
import { useEditorStore } from '@/store/editor'

export const resolveEditorFont = (family: string): string =>
  family ? `${family}, ${DEFAULT_EDITOR_FONT_FAMILY}` : DEFAULT_EDITOR_FONT_FAMILY

export const resolveCodeFont = (family: string): string =>
  `${family}, ${DEFAULT_CODE_FONT_FAMILY}`

/**
 * Every Muya option that changes how a document *looks*, shared by the live
 * editor and the Columns view.
 *
 * The Columns view is the same engine over the same document — it is the Page
 * view with `mu-columns-layout` toggled on the engine root — so it has to
 * resolve fonts, sizes and render flags exactly like the editor does (§4.4 #3),
 * otherwise the two lenses drift apart the moment a preference changes.
 * Editing-only options (auto-pairing, quick-insert hints, spellcheck, and the
 * clipboard / image callbacks) stay in `editor.vue`; the layout switch
 * (`columnsLayout`) is applied as that class by the lens, not as an engine
 * option.
 */
export function buildMuyaViewOptions(): Partial<IMuyaOptions> {
  const preferencesStore = usePreferencesStore()
  const editorStore = useEditorStore()
  const {
    fontSize,
    lineHeight,
    editorFontFamily,
    codeFontSize,
    codeFontFamily,
    wrapCodeBlocks,
    codeBlockLineNumbers,
    tabSize,
    listIndentation,
    bulletListMarker,
    orderListDelimiter,
    trimUnnecessaryCodeBlockEmptyLines,
    preferLooseListItem,
    frontmatterType,
    superSubScript,
    footnote,
    texMathDollars,
    texMathGfm,
    texMathSingleBackslash,
    texMathDoubleBackslash,
    highlightSyntax,
    inlineDiff,
    multilineBlockquote,
    isHtmlEnabled,
    softNewlineAsSpace,
    sequenceTheme,
    theme,
    plantumlServer,
    drawioServer
  } = preferencesStore

  const isDark = /dark/i.test(theme)

  return {
    fontSize,
    lineHeight,
    // The global read-only lock is an engine concern (the old DOM beforeinput
    // guard could not stop IME composition — non-cancelable — nor the engine's
    // own keydown-driven structural edits).
    readOnly: editorStore.readOnly,
    editorFontFamily: resolveEditorFont(editorFontFamily),
    codeFontSize,
    codeFontFamily: resolveCodeFont(codeFontFamily),
    wrapCodeBlocks,
    codeBlockLineNumbers,
    tabSize,
    listIndentation,
    bulletListMarker,
    orderListDelimiter,
    trimUnnecessaryCodeBlockEmptyLines,
    preferLooseListItem,
    frontmatterType,
    superSubScript,
    footnote,
    texMathDollars,
    texMathGfm,
    texMathSingleBackslash,
    texMathDoubleBackslash,
    highlightSyntax,
    inlineDiff,
    multilineBlockquote,
    disableHtml: !isHtmlEnabled,
    softNewlineAsSpace,
    // Kept a free-form string in the store because it is read back from disk;
    // the engine accepts only its two known values.
    sequenceTheme: sequenceTheme as IMuyaOptions['sequenceTheme'],
    // These drive the live editor too, so they follow the current theme.
    mermaidTheme: isDark ? 'dark' : 'default',
    vegaTheme: isDark ? 'dark' : 'latimes',
    plantumlServer,
    drawioServer
  }
}
