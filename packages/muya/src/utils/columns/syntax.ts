import { Marked } from 'marked';

// Single source of truth for the `<!-- begin / split / end -->` column format
// (§1.1 syntax, §1.2 rules, §1.3 legality table). Everything that needs to
// recognise or judge these markers — the token-layer pre-transform (§3.1),
// the DOM post-processing (§4.1), the lint (§5) and the editing-only
// visualization (§4.6) — consumes this module instead of re-deriving rules.

export type ColumnMarkerKind = 'begin' | 'split' | 'end';

// `begin` may carry a ratio: a colon-separated sequence of positive integers
// (`1:2`, `1:1:2`). Whitespace inside and around the comment is tolerated and
// the three keywords are case-insensitive (§3.0).
//
// The `begin` suffix is deliberately permissive (`[^>]*?`) rather than
// digit-only: a malformed ratio such as `<!-- begin a:b -->` must still be
// recognised as a `begin` so §1.3 #5 can downgrade it to equal widths and
// report it. A stricter pattern would make it silently inert instead.
const MARKER_RE = /^<!--\s*(begin(?:\s+[^>]*?)?|split|end)\s*-->$/i;

// A comment that opened `<!--` but never closed; the word right after `<!--`
// is one of the three keywords, so it was meant to be a marker (§1.3 #6).
const UNCLOSED_MARKER_RE = /^<!--\s*(?:begin|split|end)\b/i;

const MAX_COLUMNS = 3;

export interface ParsedMarker {
    kind: ColumnMarkerKind;
    /**
     * The ratio exactly as written (e.g. `"1:2"`), present only on `begin`.
     * Kept verbatim so diagnostics can quote it; validate with `parseRatio`.
     */
    ratioText?: string;
}

/** Recognise a single marker comment. Returns null for anything else. */
export function parseMarker(raw: string): ParsedMarker | null {
    const m = raw.trim().match(MARKER_RE);
    if (!m)
        return null;

    const inner = m[1];
    const lower = inner.toLowerCase();
    if (lower.startsWith('begin')) {
        const ratioText = inner.slice(5).trim();

        return { kind: 'begin', ratioText: ratioText || undefined };
    }

    return { kind: lower as ColumnMarkerKind };
}

/** Column widths are percentages, so the parts must add up to exactly this. */
export const RATIO_TOTAL = 100;

/**
 * Parse a ratio into column percentages. Valid only when every part is a
 * positive integer **and** they add up to `RATIO_TOTAL` (§1.1: `30:70`,
 * `25:25:50`). Anything else returns null, which §1.3 #5 downgrades to equal
 * widths — the width is never guessed from a malformed ratio.
 */
export function parseRatio(text: string | undefined): number[] | null {
    if (!text)
        return null;

    const parts = text.split(':');
    const nums: number[] = [];
    for (const part of parts) {
        const t = part.trim();
        if (!/^\d+$/.test(t))
            return null;
        const n = Number(t);
        if (!Number.isSafeInteger(n) || n <= 0)
            return null;
        nums.push(n);
    }

    if (!nums.length)
        return null;

    const total = nums.reduce((sum, n) => sum + n, 0);

    return total === RATIO_TOTAL ? nums : null;
}

/** A marker located in the source, with a 1-based line number. */
export interface ColumnMarkerInfo extends ParsedMarker {
    line: number;
    /**
     * §4.6: whether the editor renders this marker as an inline trailing badge
     * (the comment owns its own line directly under a paragraph) instead of a
     * standalone block badge. Mirrors the merge condition in `markdownToState`
     * so the lint can tell the user which form they got; both forms lay out
     * identically in the Columns view and the export pipeline.
     */
    inline: boolean;
}

export interface ColumnGroup {
    /** begin, the splits in order, then end — the markers that formed it. */
    markers: ColumnMarkerInfo[];
    /** split count + 1. */
    columns: number;
    /** Validated ratio; undefined means "render at equal widths". */
    ratio?: number[];
    /** §1.3 #4: more than 3 columns — the whole group renders linearly. */
    degraded: boolean;
    beginLine: number;
    endLine: number;
}

/** §1.3 case number — the key lint and post-processing both key off. */
export type ColumnRule = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface ColumnDiagnostic {
    rule: ColumnRule;
    level: 'warning' | 'info';
    /** 1-based line; 0 when it could not be determined. */
    line: number;
    message: string;
}

export interface ColumnAnalysis {
    /** The source contains at least one top-level `begin` marker. */
    hasMarkers: boolean;
    groups: ColumnGroup[];
    diagnostics: ColumnDiagnostic[];
}

// A bare Marked instance: only block structure matters here (is a marker a
// top-level token or not), so no extensions are applied.
const marked = new Marked();

// Loose structural view of a marked token — enough to walk for nested markers
// without depending on the full union type.
export interface StructToken {
    type?: string;
    raw?: string;
    text?: string;
    items?: StructToken[];
    tokens?: StructToken[];
    rows?: StructToken[][];
}

function collectNestedMarkers(
    tokens: StructToken[],
    skip: Set<StructToken>,
    out: string[],
): void {
    for (const token of tokens) {
        if (token.type === 'html' && !skip.has(token)) {
            const raw = (token.raw ?? '').trim();
            if (raw && parseMarker(raw))
                out.push(raw);
        }
        if (token.items)
            collectNestedMarkers(token.items, skip, out);
        if (token.tokens)
            collectNestedMarkers(token.tokens, skip, out);
        if (token.rows)
            collectNestedMarkers(token.rows.flat(), skip, out);
    }
}

/** Line number (1-based) of `index` in `src`, or 0 when unknown. */
function lineOf(src: string, index: number): number {
    if (index < 0)
        return 0;

    return src.slice(0, index).split('\n').length;
}

interface TopLevelEntry {
    token: StructToken;
    line: number;
}

/**
 * Walk a top-level token array carrying 1-based line numbers. Both
 * `analyzeColumns` and the §3.1 pre-transform go through this, so a marker's
 * line can never be computed two different ways.
 */
function topLevelEntries(tokens: StructToken[]): TopLevelEntry[] {
    const out: TopLevelEntry[] = [];
    let line = 1;
    for (const token of tokens) {
        out.push({ token, line });
        // `raw` carries every newline the block consumed, including trailing
        // blank lines, so this lands on the first line of the next block.
        line += ((token.raw ?? '').match(/\n/g) || []).length;
    }

    return out;
}

export function analyzeColumns(markdown: string): ColumnAnalysis {
    const src = markdown ?? '';
    const tokens = marked.lexer(src) as unknown as StructToken[];
    const markers: ColumnMarkerInfo[] = [];
    const diagnostics: ColumnDiagnostic[] = [];
    const topLevelHtml = new Set<StructToken>();

    // The previous top-level token, tracked for the §4.6 inline-badge decision:
    // a marker directly under a paragraph (no `space` token between them) is
    // rendered inline; anything else falls back to the block badge.
    let prevTopLevel: StructToken | undefined;

    for (const { token, line: startLine } of topLevelEntries(tokens)) {
        if (token.type === 'html') {
            topLevelHtml.add(token);

            const raw = (token.raw ?? '').trim();
            if (raw) {
                // §1.3 #6 — never closed, so CommonMark type 2 swallows the rest.
                if (!raw.includes('-->') && UNCLOSED_MARKER_RE.test(raw)) {
                    diagnostics.push({
                        rule: 6,
                        level: 'warning',
                        line: startLine,
                        message: '注释缺少闭合 -->，其后内容不做分栏',
                    });
                }
                else {
                    const parsed = parseMarker(raw);
                    if (parsed) {
                        markers.push({
                            ...parsed,
                            line: startLine,
                            inline: prevTopLevel?.type === 'paragraph',
                        });
                    }
                }
            }
        }
        prevTopLevel = token;
    }

    // §1.3 #7 — markers that are not top-level stay inert.
    const nested: string[] = [];

    // Inside a code block the marker is literal text, not a nested token,
    // so it has to be scanned out of the token body.
    for (const token of tokens) {
        if (token.type !== 'code')
            continue;
        for (const codeLine of (token.text ?? '').split('\n')) {
            if (parseMarker(codeLine))
                nested.push(codeLine.trim());
        }
    }

    collectNestedMarkers(tokens, topLevelHtml, nested);
    let cursor = 0;
    for (const raw of nested) {
        const index = src.indexOf(raw, cursor);
        if (index >= 0)
            cursor = index + raw.length;
        diagnostics.push({
            rule: 7,
            level: 'info',
            line: lineOf(src, index),
            message: '标记不在顶层（列表 / 引用 / 表格 / 代码块 / 行内），不参与分栏',
        });
    }

    const groups: ColumnGroup[] = [];
    let open: { begin: ColumnMarkerInfo; splits: ColumnMarkerInfo[] } | null = null;
    let sawBegin = false;

    for (const marker of markers) {
        if (marker.kind === 'begin') {
            sawBegin = true;
            if (open) {
                // §1.3 #3 — nesting is not supported; drop the inner begin.
                diagnostics.push({
                    rule: 3,
                    level: 'warning',
                    line: marker.line,
                    message: '不支持嵌套分栏，内层 begin 已忽略',
                });
                continue;
            }
            open = { begin: marker, splits: [] };
            continue;
        }

        if (!open) {
            // §1.3 #1 — orphan split / end.
            diagnostics.push({
                rule: 1,
                level: 'warning',
                line: marker.line,
                message: marker.kind === 'split'
                    ? '孤立的 split 标记（没有对应的 begin），已忽略'
                    : '孤立的 end 标记（没有对应的 begin），已忽略',
            });
            continue;
        }

        if (marker.kind === 'split') {
            open.splits.push(marker);
            continue;
        }

        // end — close the group.
        const columns = open.splits.length + 1;
        const ratio = parseRatio(open.begin.ratioText);
        const degraded = open.splits.length > MAX_COLUMNS - 1;

        if (degraded) {
            diagnostics.push({
                rule: 4,
                level: 'warning',
                line: open.begin.line,
                message: '栏数超过 3（split 多于 2 个），整组降级为线性排列',
            });
        }

        const ratioUsable = !!ratio && ratio.length === columns;
        if (open.begin.ratioText && !ratioUsable) {
            diagnostics.push({
                rule: 5,
                level: 'info',
                line: open.begin.line,
                message: ratio
                    ? '栏宽占比个数与栏数不符，按等宽渲染'
                    : `栏宽占比需为和为 ${RATIO_TOTAL} 的正整数（如 30:70），按等宽渲染`,
            });
        }

        groups.push({
            markers: [open.begin, ...open.splits, marker],
            columns,
            ratio: ratioUsable ? ratio! : undefined,
            degraded,
            beginLine: open.begin.line,
            endLine: marker.line,
        });
        open = null;
    }

    if (open) {
        // §1.3 #2 — begin with no end before EOF.
        diagnostics.push({
            rule: 2,
            level: 'warning',
            line: open.begin.line,
            message: 'begin 没有对应的 end，该组不分栏，内容原位保留',
        });
    }

    // §4.6 — a marker that does not own its line directly under a paragraph is
    // rendered as the block badge instead of an inline one. Reported once per
    // group (on the begin line) so a hand-written, blank-line-separated
    // document does not flood the lint panel. Layout is unaffected.
    for (const group of groups) {
        if (group.markers.some(m => !m.inline)) {
            diagnostics.push({
                rule: 8,
                level: 'info',
                line: group.beginLine,
                message: '该组有标记未紧贴段落，按块级徽标显示（分栏仍生效）',
            });
        }
    }

    return { hasMarkers: sawBegin, groups, diagnostics };
}

/** Derived view used by the desktop view switch (§4.4 #5). */
export function hasColumnMarkers(markdown: string): boolean {
    return analyzeColumns(markdown).hasMarkers;
}

// ---------------------------------------------------------------------------
// §3.1 token-layer pre-transform
// ---------------------------------------------------------------------------

/** Attribute that identifies a placeholder. The only trigger for columns. */
export const MDCOLS_ATTR = 'data-mdcols';
/** Column percentages, only ever present on a `begin` placeholder. */
export const RATIO_ATTR = 'data-ratio';

/**
 * The placeholder element that survives DOMPurify. It has no children and no
 * other attributes, so the XSS surface is zero (§3.2); the column container is
 * only ever produced later by the DOM post-processing (§4.1).
 */
export function placeholderHtml(kind: ColumnMarkerKind, ratio?: number[]): string {
    const ratioAttr = ratio && ratio.length ? ` ${RATIO_ATTR}="${ratio.join(':')}"` : '';

    return `<div ${MDCOLS_ATTR}="${kind}"${ratioAttr}></div>`;
}

/**
 * Rewrite top-level marker comments into placeholder elements.
 *
 * DOMPurify 3.x cannot be configured to keep comments (§2.2 f), so the markers
 * are converted *before* sanitizing. This runs on the top-level token array,
 * which is why markers inside a paragraph / list / quote / table cell / code
 * block are naturally left alone (§2.2 g) — an HTML-string replacement would
 * instead split the enclosing `<p>` (§3.1).
 *
 * Only markers that form a renderable group are rewritten. Everything else —
 * orphan split/end (§1.3 #1), a begin with no end (#2), a nested begin (#3), a
 * degraded group (#4), a begin whose ratio was unusable (#5, still rewritten
 * but without `data-ratio`) — stays a plain comment and is therefore stripped
 * by DOMPurify, which is exactly what §1.3 asks for.
 */
export function transformColumnTokens<T extends StructToken>(tokens: T[]): T[] {
    // `raw` of every top-level token concatenates back to the source, so the
    // analysis sees the same text the caller passed to the lexer.
    const src = tokens.map(t => t.raw ?? '').join('');
    const { groups } = analyzeColumns(src);

    const plan = new Map<number, { kind: ColumnMarkerKind; ratio?: number[] }>();
    for (const group of groups) {
        if (group.degraded)
            continue;
        for (const marker of group.markers) {
            plan.set(marker.line, {
                kind: marker.kind,
                ratio: marker.kind === 'begin' ? group.ratio : undefined,
            });
        }
    }

    if (!plan.size)
        return tokens;

    const rewritten = new Map<StructToken, string>();
    for (const { token, line } of topLevelEntries(tokens)) {
        if (token.type !== 'html')
            continue;
        const entry = plan.get(line);
        if (entry)
            rewritten.set(token, placeholderHtml(entry.kind, entry.ratio));
    }

    if (!rewritten.size)
        return tokens;

    // Only `text` is swapped: `renderer.html` emits it verbatim. `raw` is kept
    // so anything downstream that still measures source lines stays correct.
    return tokens.map(t => {
        const html = rewritten.get(t);

        return html ? { ...t, text: html } : t;
    });
}
