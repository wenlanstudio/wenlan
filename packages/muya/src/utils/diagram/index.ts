import type { TDiagramType } from '../../state/types';

const rendererCache = new Map();

/**
 * Load a diagram renderer lazily, so each library's bundle is only fetched
 * when a diagram of that kind is actually on screen.
 *
 * What comes back depends on the library's own entry point; render.ts knows
 * how to drive each one.
 *
 * Resolves to null for a type that draws without a bundled library, so the
 * caller can ask for any diagram type and use what comes back where it has one.
 *
 * @param {string} name the renderer name: plantuml, mermaid, vega-lite,
 * flowchart, sequence, graphviz, wavedrom, echarts, chart, abc
 */
async function loadRenderer(name: TDiagramType) {
    if (!rendererCache.has(name)) {
        let m;
        switch (name) {
            case 'plantuml':
                m = await import('./plantuml');
                rendererCache.set(name, m.default);
                break;

            case 'mermaid':
                m = await import('mermaid');
                rendererCache.set(name, m.default);
                break;

            case 'vega-lite':
                m = await import('vega-embed');
                rendererCache.set(name, m.default);
                break;

            case 'flowchart':
                m = await import('flowchart.js');
                rendererCache.set(name, m.default);
                break;

            case 'sequence':
                m = await import('./sequence');
                rendererCache.set(name, m.default);
                break;

            case 'graphviz':
                m = await import('@viz-js/viz');
                rendererCache.set(name, m);
                break;

            case 'wavedrom':
                m = await import('wavedrom');
                rendererCache.set(name, m.default ?? m);
                break;

            case 'echarts':
                m = await import('echarts');
                rendererCache.set(name, m);
                break;

            case 'chart':
                m = await import('chart.js/auto');
                rendererCache.set(name, m.default ?? m);
                break;

            case 'abc':
                m = await import('abcjs');
                rendererCache.set(name, m.default ?? m);
                break;

            // drawio renders in a remote embed, matplotlib runs the document's
            // Python in the host process, and an `svg` fence carries the whole
            // drawing as markup: none has a library to import. Claiming them
            // here is what keeps `renderDiagram` from rejecting them before
            // their branch is reached.
            case 'drawio':
            case 'matplotlib':
            case 'svg':
                rendererCache.set(name, null);
                break;

            default:
                throw new Error(`Unknown diagram name ${name}`);
        }
    }

    return rendererCache.get(name);
}

export default loadRenderer;
