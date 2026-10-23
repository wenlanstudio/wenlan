import {
    MDCOLS_ATTR,
    RATIO_ATTR,
    type ColumnDiagnostic,
    type ColumnMarkerKind,
    parseRatio,
} from './syntax';

// §4.1 — the DOM post-processing. Runs on the export container after
// `innerHTML = html`, before mermaid / heading ids. It is the *render*
// decision-maker: it only sees placeholder elements and DOM structure.
// `analyzeColumns` is the *diagnostic* source of truth (it sees the source, so
// it is the only thing that can report line numbers). Anything this pass finds
// that is already covered by the analysis is therefore reported as a fallback
// with line 0 rather than duplicated — see §4.1 #7 / #9.

const GROUP_CLASS = 'mdcols-group';
const COL_CLASS = 'mdcols-col';

/** split count + 1 is the column count; more than 3 columns degrades (§1.3 #4). */
const MAX_SPLITS = 2;

function kindOf(el: Element): ColumnMarkerKind | null {
    const value = el.getAttribute(MDCOLS_ATTR);
    if (value === 'begin' || value === 'split' || value === 'end')
        return value;

    return null;
}

/** Elements between two siblings, exclusive on both ends. */
function between(startEl: Element, endEl: Element): Element[] {
    const out: Element[] = [];
    let node = startEl.nextElementSibling;
    while (node && node !== endEl) {
        const next = node.nextElementSibling;
        out.push(node);
        node = next;
    }

    return out;
}

interface Group {
    beginEl: Element;
    splitEls: Element[];
    endEl: Element;
    ratio?: number[] | null;
    degraded: boolean;
}

/**
 * Wrap the top-level `data-mdcols` placeholders into column groups.
 *
 * Returns fallback diagnostics (normally empty — §3.1 already refuses to emit
 * placeholders for markers that do not form a renderable group, so the only
 * way to reach these branches is a caller that built the DOM by other means).
 */
export function postProcessColumns(container: HTMLElement): ColumnDiagnostic[] {
    const warnings: ColumnDiagnostic[] = [];

    // §4.1 #8 — strip placeholders that are not direct children. They can only
    // come from a user raw-HTML block that happened to contain a marker, and
    // leaving them would leak empty divs into the output.
    for (const el of [...container.querySelectorAll(`[${MDCOLS_ATTR}]`)]) {
        if (el.parentElement !== container)
            el.remove();
    }

    const groups: Group[] = [];
    let open: { beginEl: Element; splitEls: Element[]; ratio?: number[] | null; degraded: boolean } | null
        = null;

    for (const el of [...container.children]) {
        const kind = kindOf(el);
        if (!kind)
            continue;

        if (kind === 'begin') {
            if (open) {
                // §1.3 #3 — nesting is not supported; drop the inner begin.
                warnings.push({
                    rule: 3,
                    level: 'warning',
                    line: 0,
                    message: '不支持嵌套分栏，内层 begin 已忽略',
                });
                el.remove();
                continue;
            }
            open = {
                beginEl: el,
                splitEls: [],
                ratio: parseRatio(el.getAttribute(RATIO_ATTR) ?? undefined),
                degraded: false,
            };
            continue;
        }

        if (!open) {
            // §1.3 #1 — orphan split / end.
            warnings.push({
                rule: 1,
                level: 'warning',
                line: 0,
                message: kind === 'split'
                    ? '孤立的 split 标记（没有对应的 begin），已忽略'
                    : '孤立的 end 标记（没有对应的 begin），已忽略',
            });
            el.remove();
            continue;
        }

        if (kind === 'split') {
            open.splitEls.push(el);
            if (open.splitEls.length > MAX_SPLITS) {
                open.degraded = true;
                warnings.push({
                    rule: 4,
                    level: 'warning',
                    line: 0,
                    message: '栏数超过 3（split 多于 2 个），整组降级为线性排列',
                });
            }
            continue;
        }

        groups.push({ ...open, endEl: el });
        open = null;
    }

    if (open) {
        // §1.3 #2 — begin with no end before EOF: drop the marker, keep content.
        warnings.push({
            rule: 2,
            level: 'warning',
            line: 0,
            message: 'begin 没有对应的 end，该组不分栏，内容原位保留',
        });
        open.beginEl.remove();
        for (const split of open.splitEls)
            split.remove();
    }

    for (const group of groups) {
        const { beginEl, splitEls, endEl, degraded } = group;
        const markers = [beginEl, ...splitEls, endEl];

        if (degraded) {
            // Content stays where it is; only the markers disappear.
            for (const marker of markers)
                marker.remove();
            continue;
        }

        const boundaries = [beginEl, ...splitEls, endEl];
        const groupEl = container.ownerDocument.createElement('div');
        groupEl.className = GROUP_CLASS;

        for (let i = 0; i < boundaries.length - 1; i++) {
            const colEl = container.ownerDocument.createElement('div');
            colEl.className = COL_CLASS;
            // An empty column is legal (§4.3) — it just renders as an empty box.
            for (const node of between(boundaries[i], boundaries[i + 1]))
                colEl.appendChild(node);
            groupEl.appendChild(colEl);
        }

        // §4.2 — `flex-basis: 0` in the stylesheet means the grow factor alone
        // decides the width, so a validated ratio maps straight onto flex-grow.
        // An absent or mismatched ratio falls back to the equal-width default.
        const ratio = group.ratio;
        const cols = [...groupEl.children] as HTMLElement[];
        if (ratio && ratio.length === cols.length) {
            cols.forEach((col, i) => {
                col.style.flexGrow = String(ratio[i]);
            });
        }

        container.insertBefore(groupEl, beginEl);
        for (const marker of markers)
            marker.remove();
    }

    return warnings;
}
