import { parseRatio, type ColumnMarkerKind } from './syntax';

// §4.6 — the Columns view is the Page editor rendered read-only, with the
// `begin / split / end` groups laid out as real columns. This runs on the live
// editor DOM (`.mu-editor` children), not on export HTML, so it inherits every
// editor style — theme, font, line width, table width — for free.
//
// Muya does not observe the editor DOM (no MutationObserver wires DOM changes
// back into the block tree), so regrouping siblings is safe here. It is only
// safe because the view is read-only: the block objects still point at their
// original `domNode`s, so editing while columns are applied is not supported.

const GROUP_CLASS = 'mu-mdcols-group';
const COL_CLASS = 'mu-mdcols-col';
const HIDDEN_CLASS = 'mu-mdcols-hidden';
const MARKER_SELECTOR = '.mu-mdcols-marker[data-kind]';

/** split count + 1 is the column count; more than 3 columns degrades (§1.3 #4). */
const MAX_SPLITS = 2;

/** Original child order, keyed by editor element, so `revert` can restore it. */
const originals = new WeakMap<HTMLElement, Element[]>();

interface Group {
    beginEl: Element;
    splitEls: Element[];
    endEl: Element;
    ratio?: number[] | null;
}

function markerOf(el: Element): Element | null {
    return el.querySelector(MARKER_SELECTOR);
}

function kindOf(el: Element): ColumnMarkerKind | null {
    const kind = markerOf(el)?.getAttribute('data-kind') ?? null;

    return kind === 'begin' || kind === 'split' || kind === 'end' ? kind : null;
}

function ratioOf(el: Element): number[] | null {
    return parseRatio(markerOf(el)?.getAttribute('data-ratio') ?? undefined);
}

/**
 * 徽标是否嵌在段落内容里（行内化形态）。块级徽标与行内徽标是同一个 span
 * （视觉统一，§4.6），但块级徽标位于 `html-preview` 附件内——只有行内徽标
 * 所在块需要并入相邻栏、且只隐藏徽标本身；块级徽标整块隐藏。
 */
function isInlineBadge(markerEl: Element | null): boolean {
    return !!markerEl && !markerEl.closest('.mu-html-preview');
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

/**
 * Lay the top-level marker blocks out as columns. Idempotent: calling it again
 * reverts first, which is what a markdown change (a fresh `setContent`) needs.
 */
export function applyEditorColumns(editorEl: HTMLElement): void {
    revertEditorColumns(editorEl);

    const children = [...editorEl.children];
    const groups: Group[] = [];
    let open: { beginEl: Element; splitEls: Element[]; ratio?: number[] | null; degraded: boolean } | null
        = null;

    for (const el of children) {
        const kind = kindOf(el);
        if (!kind)
            continue;

        if (kind === 'begin') {
            // §1.3 #3 — nesting is not supported; the inner begin stays inert.
            if (open)
                continue;

            open = {
                beginEl: el,
                splitEls: [],
                ratio: ratioOf(el),
                degraded: false,
            };
            continue;
        }

        if (!open)
            continue; // §1.3 #1 — orphan split / end stays inert.

        if (kind === 'split') {
            open.splitEls.push(el);
            if (open.splitEls.length > MAX_SPLITS)
                open.degraded = true; // §1.3 #4
            continue;
        }

        if (open.degraded) {
            open = null;
            continue;
        }

        groups.push({ ...open, endEl: el });
        open = null;
    }

    originals.set(editorEl, children);

    for (const group of groups) {
        const { beginEl, splitEls, endEl } = group;
        const boundaries = [beginEl, ...splitEls, endEl];

        // Collect every column's nodes first, move later: an inline split / end
        // paragraph is appended to its column (§4.6), which would take it out
        // of the sibling sequence and break `between()` for the columns after it.
        const colNodes: Element[][] = [];
        for (let i = 0; i < boundaries.length - 1; i++) {
            const nodes = between(boundaries[i], boundaries[i + 1]);
            // 行内化（§4.6）：split / end 徽标嵌在有内容的段落里，该段是
            // 左 / 右栏的最后一块，必须并入本栏；块级 marker 整块隐藏，
            // 并入与否无视觉变化，为保持既有行为仅行内徽标所在块并入。
            const endBoundary = boundaries[i + 1];
            if (isInlineBadge(markerOf(endBoundary)))
                nodes.push(endBoundary);
            colNodes.push(nodes);
        }

        const groupEl = editorEl.ownerDocument.createElement('div');
        groupEl.className = GROUP_CLASS;

        for (const nodes of colNodes) {
            const colEl = editorEl.ownerDocument.createElement('div');
            colEl.className = COL_CLASS;
            for (const node of nodes)
                colEl.appendChild(node);
            groupEl.appendChild(colEl);
        }

        const ratio = group.ratio;
        const cols = [...groupEl.children] as HTMLElement[];
        if (ratio && ratio.length === cols.length) {
            cols.forEach((col, i) => {
                col.style.flexGrow = String(ratio[i]);
            });
        }

        editorEl.insertBefore(groupEl, beginEl);

        // Consumed: hide the marker blocks instead of removing them so a
        // revert can bring them back without re-rendering. An inline badge
        // lives inside a content paragraph (§4.6), so only the badge span is
        // hidden — the paragraph itself belongs to the adjacent column.
        for (const boundary of boundaries) {
            const markerEl = markerOf(boundary);
            if (isInlineBadge(markerEl))
                markerEl.classList.add(HIDDEN_CLASS);
            else
                boundary.classList.add(HIDDEN_CLASS);
        }
    }
}

/** Drop the wrappers and the hidden flags, leaving the blocks where they are. */
function unwrapGroups(editorEl: HTMLElement): void {
    for (const group of [...editorEl.querySelectorAll(`.${GROUP_CLASS}`)])
        group.remove();

    for (const marker of [...editorEl.querySelectorAll(`.${HIDDEN_CLASS}`)])
        marker.classList.remove(HIDDEN_CLASS);
}

/** Undo {@link applyEditorColumns}, restoring the original block order. */
export function revertEditorColumns(editorEl: HTMLElement): void {
    const children = originals.get(editorEl);

    // Only restore when every recorded child is still inside this editor. After
    // a `setContent` the engine rebuilds the subtree, so the recorded nodes are
    // detached — re-appending them would duplicate (or resurrect) stale blocks.
    if (children && children.every((el) => editorEl.contains(el))) {
        // Appending in the recorded order restores it, because appendChild
        // moves each element to the end one by one.
        for (const el of children)
            editorEl.appendChild(el);
    }

    originals.delete(editorEl);
    unwrapGroups(editorEl);
}
