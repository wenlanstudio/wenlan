import type { TDiagramType } from '../../state/types';
import type { TExternalDiagramRenderer } from '../../types';
import { applyBlockStyle, parseDiagramBlock, parseJsonBlock, pixelSize } from './blockSource';
import { loadDrawioDiagram, renderDrawio } from './drawio';
import loadRenderer from './index';

// Mermaid's own `run()` derives the id it stamps on the rendered `<svg>` from
// `Date.now()`, and its renderers then resolve that id with a document-wide
// lookup. Two diagrams whose renders begin in the same millisecond therefore
// draw into a single element: the first block shows both diagrams on top of
// each other, the second stays empty (#5023). Mint the id here instead —
// `render()` takes one — so concurrent renders can never share it.
let mermaidRenderCount = 0;

// Live Chart.js instances by preview container, so a re-render disposes the
// one before it instead of stacking instances on the editor's element.
const chartRegistry = new WeakMap<HTMLElement, { destroy: () => void }>();

const RAPHAEL_DESC = /^Created with Rapha/;

// Stage sizes for the renderers that need to be told how big to draw, either
// because their container is still empty (ECharts) or because they only draw
// into a canvas of their own (Chart.js).
const ECHARTS_HEIGHT = '300px';
const CHART_WIDTH = 640;
const CHART_HEIGHT = 400;

/** The subset of a Chart.js config these blocks set: everything that comes in is handed over. */
interface IChartConfig {
    options?: Record<string, unknown>;
}

// Each renderer arrives from a lazy `import()` whose shape is its own library's,
// so the helper that drives it declares what it needs from it.
type TLoadedRenderer = Awaited<ReturnType<typeof loadRenderer>>;

/**
 * ECharts takes its size from the container, and a preview awaiting its first
 * render measures zero — without a height the chart draws zero pixels tall and
 * the block looks like nothing happened.
 *
 * Live drawing goes to a canvas: that is where the tooltip, the legend and
 * every hover highlight live, and it survives a chart with thousands of points
 * where the svg renderer spends its time building nodes. Anything that leaves
 * the app — an exported image, a saved HTML file — has no canvas to copy, so
 * it asks for the svg renderer instead.
 */
function renderECharts(
    render: TLoadedRenderer,
    target: HTMLElement,
    code: string,
    dark: boolean,
    vector: boolean,
): void {
    const { options, value } = parseJsonBlock(code);
    applyBlockStyle(target, options);
    if (!options.height && !target.style.height)
        target.style.height = ECHARTS_HEIGHT;

    // Rendering replaces `target`'s contents, but echarts keeps a registry
    // entry keyed on the element until disposed — re-initialising without
    // this logs a warning and leaves the old instance unreachable.
    render.dispose(target);
    const chart = render.init(target, dark ? 'dark' : undefined, {
        renderer: vector ? 'svg' : 'canvas',
    });
    chart.setOption(value);
    if (!vector)
        centreCanvasStage(target);
}

/**
 * Centre the canvas ECharts drew.
 *
 * Zrender wraps the canvas in a `<div>` of its own, sized in pixels and
 * carrying `margin: 0`. An `<svg>` is an inline box, so the container's
 * `text-align: center` used to place it; a block-level stage ignores that and
 * sits against the left edge as soon as it is narrower than the column — which
 * is what a block that asks for a width, or one measured before the editor laid
 * it out, produces. Auto margins centre it either way, and do nothing once the
 * stage is already as wide as its container.
 */
function centreCanvasStage(target: HTMLElement): void {
    const stage = target.querySelector('canvas')?.parentElement;
    if (!(stage instanceof HTMLElement))
        return;

    stage.style.marginLeft = 'auto';
    stage.style.marginRight = 'auto';
}

function renderChartJs(render: TLoadedRenderer, target: HTMLElement, code: string): void {
    const { options, value } = parseJsonBlock<IChartConfig>(code);
    applyBlockStyle(target, options);
    target.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.width = pixelSize(options.width) ?? CHART_WIDTH;
    canvas.height = pixelSize(options.height) ?? CHART_HEIGHT;
    target.appendChild(canvas);

    // Export re-renders into an offscreen host, so the chart must draw at
    // its own declared size instead of tracking the container.
    const Chart = render;
    const config = { ...value, options: { animation: false, responsive: false, ...value.options } };
    // Chart.js keeps its own canvas registry; destroying the previous
    // instance stops a re-render from doubling listeners.
    const previous = chartRegistry.get(target);
    previous?.destroy();
    const chart = new Chart(canvas, config);
    chartRegistry.set(target, chart);
}

// Give a fixed-size `<svg>` (one with `width`/`height` px attributes but no
// `viewBox`) a viewBox derived from those dimensions, so `max-width: 100%`
// scales it down to fit instead of clipping it. Returns false while the
// dimensions are still missing.
function sizeSvg(svg: Element): boolean {
    if (svg.getAttribute('viewBox'))
        return true;
    const width = Number.parseFloat(svg.getAttribute('width') ?? '');
    const height = Number.parseFloat(svg.getAttribute('height') ?? '');
    if (width > 0 && height > 0) {
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        return true;
    }
    return false;
}

function accessibleName(media: Element, fallback: string): string {
    if (media.tagName.toLowerCase() !== 'svg')
        return fallback;

    const explicit = media.getAttribute('aria-label');
    if (explicit)
        return explicit;

    let title = '';
    let desc = '';
    for (const child of Array.from(media.children)) {
        const tag = child.tagName.toLowerCase();
        if (tag === 'title' && !title)
            title = (child.textContent ?? '').trim();
        else if (tag === 'desc' && !desc)
            desc = (child.textContent ?? '').trim();
    }
    // flowchart.js draws through Raphael, which stamps its own <desc> on every diagram.
    if (RAPHAEL_DESC.test(desc))
        desc = '';

    return [title, desc].filter(Boolean).join('. ') || fallback;
}

function applyFinalizations(target: HTMLElement, fallback: string): boolean {
    // A canvas counts: ECharts and Chart.js draw into one, and there is no
    // `<svg>` for a screen reader to find there.
    const media = target.querySelector('svg, img, canvas');
    if (!media)
        return false;
    if (media.tagName.toLowerCase() === 'svg' && !sizeSvg(media))
        return false;

    target.setAttribute('role', 'img');
    target.setAttribute('aria-label', accessibleName(media, fallback));

    return true;
}

// `drawSVG` (js-sequence-diagrams / flowchart.js) renders the `<svg>`
// asynchronously — it's drawn from a theme callback after its font loads — so
// neither the element nor its `width`/`height` attributes are there
// synchronously. Try once, then observe `target` until the diagram lands.
export function finalizeRenderedDiagram(target: HTMLElement, fallbackLabel: string): () => void {
    if (applyFinalizations(target, fallbackLabel))
        return () => {};

    const observer = new MutationObserver(() => {
        if (applyFinalizations(target, fallbackLabel))
            observer.disconnect();
    });
    observer.observe(target, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['width', 'height'],
    });
    // Safety net so the observer can't leak if the diagram never renders.
    const timer = setTimeout(() => observer.disconnect(), 5000);

    // The caller owns this render: it must be able to give up on one that is
    // still waiting, rather than let it describe what replaced it.
    return () => {
        clearTimeout(timer);
        observer.disconnect();
    };
}

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;

/**
 * Prefix `code` with a mermaid `%%{init}%%` directive so the config applies to
 * this one render. Mermaid's `initialize()` is process-global, and the live
 * preview re-initializes before every render, so mutating it around an export
 * would race whatever else is rendering.
 */
export function withMermaidInit(code: string, config: Record<string, unknown>): string {
    const directive = `%%{init: ${JSON.stringify(config)}}%%`;
    const frontmatter = FRONTMATTER.exec(code)?.[0] ?? '';
    const body = code.slice(frontmatter.length);

    return body.startsWith(directive)
        ? code
        : `${frontmatter}${directive}\n${body}`;
}

export interface IRenderOptions {
    // `string` rather than TDiagramType: hosts pass the type through from
    // their own loosely typed diagram sources.
    type: string;
    code: string;
    target: HTMLElement;
    vegaTheme: string;
    mermaidTheme: string;
    plantumlServer: string;
    sequenceTheme: 'hand' | 'simple';
    /** Base URL of the diagrams.net embed the `drawio` type renders against. */
    drawioServer: string;
    /**
     * Host-provided renderer for diagram types that need a facility outside
     * the browser sandbox (matplotlib runs a local Python). Optional: muya
     * standalone has no such facility and reports that instead.
     */
    renderExternalDiagram?: TExternalDiagramRenderer;
    /**
     * Draw as vector rather than to a canvas, for output that leaves the
     * preview: an exported image, or an HTML file that has to carry the
     * drawing as markup. Only ECharts draws both ways today.
     */
    vector?: boolean;
}

export interface IExportRenderOptions extends IRenderOptions {
    /**
     * Mermaid draws node labels into a `<foreignObject>` by default, and
     * Chromium refuses to paint one when the svg is loaded as an `<img>` —
     * rasterising such a diagram loses every label. Pass false to get a
     * `<text>`-only svg.
     */
    htmlLabels: boolean;
}

export async function renderDiagramForExport({
    htmlLabels,
    ...options
}: IExportRenderOptions): Promise<void> {
    const code = options.type === 'mermaid' && !htmlLabels
        ? withMermaidInit(options.code, { htmlLabels: false })
        : options.code;

    await renderDiagram({ ...options, code, vector: true });
}

export async function renderDiagram({
    type,
    code,
    target,
    vegaTheme,
    mermaidTheme,
    plantumlServer,
    sequenceTheme,
    drawioServer,
    renderExternalDiagram,
    vector,
}: IRenderOptions) {
    // Wenlan prefers the installed Graphviz binary over the bundled WASM
    // compiler. The host callback is optional (muya standalone has no IPC),
    // and a failure is not fatal: fall through to the WASM renderer below.
    // Keeping this ahead of `loadRenderer` also means the WASM module is not
    // imported at all on machines where dot.exe does the drawing.
    let graphvizFallback = false;
    if (type === 'graphviz' && renderExternalDiagram) {
        try {
            await renderExternalDiagram(type, code, target);
            return;
        }
        catch {
            graphvizFallback = true;
        }
    }

    // An `svg` fence carries the complete drawing as markup. Like matplotlib
    // it needs a host facility — here a canvas to freeze the vector into a
    // bitmap — so muya itself owns no rasteriser. Ahead of `loadRenderer` so
    // the type is fully handled by the host before any renderer is looked up.
    if (type === 'svg') {
        if (!renderExternalDiagram) {
            throw new Error(
                'SVG diagrams need a host renderer (canvas rasterisation).',
            );
        }
        await renderExternalDiagram(type, code, target);
        return;
    }

    const render = await loadRenderer(type as TDiagramType);
    const options = {};
    if (type === 'vega-lite') {
        Object.assign(options, {
            actions: false,
            tooltip: false,
            renderer: 'svg',
            theme: vegaTheme,
            ast: true,
        });
    }
    else if (type === 'sequence') {
        Object.assign(options, { theme: sequenceTheme });
    }

    if (type === 'plantuml') {
        const diagram = render.parse(code, plantumlServer);
        target.innerHTML = '';
        diagram.insertImgElement(target);
    }
    else if (type === 'vega-lite') {
        await render(target, JSON.parse(code), options);
    }
    else if (type === 'flowchart' || type === 'sequence') {
        const diagram = render.parse(code);
        target.innerHTML = '';
        diagram.drawSVG(target, options);
    }
    else if (type === 'mermaid') {
        render.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            theme: mermaidTheme,
        });
        await render.parse(code);
        const { svg, bindFunctions } = await render.render(
            `mu-mermaid-${++mermaidRenderCount}`,
            code,
            target,
        );
        target.innerHTML = svg;
        bindFunctions?.(target);
    }
    else if (type === 'graphviz') {
        // The module exports `instance()`, which resolves to a compiler bound
        // to its WASM module; repeated calls reuse the same instance.
        const { instance } = render;
        const viz = await instance();
        target.innerHTML = '';
        const svg = viz.renderSVGElement(code);
        if (graphvizFallback) {
            // Light-touch notice: a tooltip on hover, never an error card.
            svg.setAttribute('data-graphviz-engine', 'wasm-fallback');
            const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            title.textContent = 'Rendered with the built-in WASM engine - dot.exe was unavailable';
            svg.insertBefore(title, svg.firstChild);
        }
        target.appendChild(svg);
    }
    else if (type === 'wavedrom') {
        const { options, value } = parseJsonBlock(code);
        applyBlockStyle(target, options);
        target.innerHTML = '';
        // `renderAny` returns the drawing as ONML; stringify paints it into
        // the block. `renderWaveForm` would go through a document-wide id
        // lookup, which two diagrams on one page would race.
        const onml = render.renderAny(0, value, render.waveSkin);
        target.innerHTML = render.onml.stringify(onml);
    }
    else if (type === 'echarts') {
        renderECharts(render, target, code, mermaidTheme === 'dark', !!vector);
    }
    else if (type === 'chart') {
        renderChartJs(render, target, code);
    }
    else if (type === 'abc') {
        const { options, body } = parseDiagramBlock(code);
        applyBlockStyle(target, options);
        target.innerHTML = '';
        render.renderAbc(target, body, { responsive: 'resize' });
    }
    else if (type === 'drawio') {
        const xml = await loadDrawioDiagram(code);
        await renderDrawio(target, xml, drawioServer);
    }
    else if (type === 'matplotlib') {
        if (!renderExternalDiagram) {
            throw new Error(
                'Matplotlib diagrams need a local Python — enable them in the preferences.',
            );
        }
        await renderExternalDiagram(type, code, target);
    }
}
