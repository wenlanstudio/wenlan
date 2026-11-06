import { isElement } from '../utils';

export function getCursorCoords(preferEnd = false): DOMRect | null {
    const sel = document.getSelection();
    let range;
    let rect: DOMRect | null = null;

    if (sel?.rangeCount) {
        range = sel.getRangeAt(0).cloneRange();
        if (range.getClientRects) {
            let rects: DOMRectList | null = range.getClientRects();
            if (rects.length === 0) {
                rects
                    = range.startContainer && isElement(range.startContainer)
                        ? range.startContainer.getClientRects()
                        : null;
            }

            // Chromium exposes both sides of a soft wrap for a collapsed
            // range. The last rect is the new line's start (#3510).
            if (rects?.length)
                rect = range.collapsed || preferEnd ? rects[rects.length - 1] : rects[0];
        }
    }

    // A zero-size rect means the range's node has no layout box: detached
    // after an inline re-render, hidden, or not yet laid out. Scrolling would
    // read it as "caret at the viewport origin" and yank the viewport away
    // from the block being edited (#14) — report "position unknown" instead.
    if (rect && rect.width === 0 && rect.height === 0)
        return null;

    return rect;
}

export function getSelectionStart(): Node | null {
    const node = document.getSelection()!.anchorNode;

    return node && node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
}

export function getCursorYOffset(paragraph: HTMLElement): { topOffset: number; bottomOffset: number } {
    const coords = getCursorCoords();
    // The collapsed caret can yield no client rects (e.g. an HTML/code block
    // boundary position), so `getCursorCoords()` returns null. Treat that as
    // "position unknown" and let arrow navigation leave the block.
    if (coords == null)
        return { topOffset: 0, bottomOffset: 0 };

    const { y } = coords;
    const { height, top } = paragraph.getBoundingClientRect();
    const lineHeight = Number.parseFloat(getComputedStyle(paragraph).lineHeight);
    const topOffset = Math.floor((y - top) / lineHeight);
    const bottomOffset = Math.round((top + height - lineHeight - y) / lineHeight);

    return { topOffset, bottomOffset };
}
