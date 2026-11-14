/**
 * Rendered-diagram markup cache, keyed by everything that changes the drawing
 * (type, theme parameters, source code) — NOT by block identity.
 *
 * Why it exists: every engine rebuild (`setContent`, `_forceRender`, editor
 * remount) reconstructs the block tree, and each fresh `DiagramPreview`
 * unconditionally re-runs its renderer. View switching hits exactly this path
 * — the readOnly lens flips force a full re-render, leaf switches to
 * source/deck destroy and remount the engine — so a lecture page with a dozen
 * mermaid blocks paid a dozen `mermaid.parse + render` runs per flip. Graphviz
 * already caches at the desktop host layer (dot.exe); these caches cover the
 * in-process renderers: mermaid, the Graphviz WASM fallback, wavedrom,
 * vega-lite.
 *
 * Canvas-based renderers (ECharts, Chart.js) and the host-facility types
 * (matplotlib, svg fence, drawio) are deliberately not cached here: the first
 * two draw interactively into a canvas they own, the latter go through
 * `renderExternalDiagram` where the desktop layer keeps its own caches.
 */

const MAX_ENTRIES = 120;
/** Refuse to cache pathological drawings (an SVG in the hundreds of KB). */
const MAX_ENTRY_CHARS = 400_000;

const cache = new Map<string, string>();

/** NUL-separated so no combination of theme/code can alias another key. */
export const diagramMarkupKey = (parts: string[]): string =>
    parts.join(String.fromCharCode(0));

export function getCachedDiagramMarkup(key: string): string | null {
    const hit = cache.get(key);
    if (hit === undefined)
        return null;
    // LRU touch: re-insert so the freshest lookup survives eviction.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
}

export function putCachedDiagramMarkup(key: string, markup: string): void {
    if (markup.length > MAX_ENTRY_CHARS)
        return;
    cache.delete(key);
    cache.set(key, markup);
    if (cache.size > MAX_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined)
            cache.delete(oldest);
    }
}

/** Test helper: forget every cached drawing. */
export function clearDiagramMarkupCache(): void {
    cache.clear();
}
