// `<!-- pagebreak -->` — the paper-leaf forced page break (marktext view-model
// §5). A sibling of the `<!-- begin / split / end -->` column family: same
// HTML-comment marker form, its own module because the columns machinery
// (`utils/columns/`) owns column semantics only. Consumers: the html-block
// badge visualization (block-level editing affordance) and desktop's paper
// pagination / print chain. A pagebreak is only meaningful as a standalone
// block marker; inline occurrences stay inert comments.

const PAGEBREAK_RE = /^<!--\s*pagebreak\s*-->$/i;

/** Recognise a standalone `<!-- pagebreak -->` comment. */
export function isPagebreakMarker(raw: string): boolean {
    return PAGEBREAK_RE.test(raw.trim());
}
