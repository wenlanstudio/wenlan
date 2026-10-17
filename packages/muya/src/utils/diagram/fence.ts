import type { IDiagramMeta, IDiagramState } from '../../state/types';

/**
 * Fence language → diagram type. The five historical types render from a fence
 * named after themselves; the newer ones accept the aliases users actually
 * type (`dot` for GraphViz, `chartjs` for Chart.js).
 */
const DIAGRAM_LANGS: Readonly<Record<string, IDiagramMeta['type']>> = {
    'mermaid': 'mermaid',
    'plantuml': 'plantuml',
    'vega-lite': 'vega-lite',
    'flowchart': 'flowchart',
    'sequence': 'sequence',
    'dot': 'graphviz',
    'graphviz': 'graphviz',
    'wavedrom': 'wavedrom',
    'echarts': 'echarts',
    'chart': 'chart',
    'chartjs': 'chart',
    'abc': 'abc',
    'drawio': 'drawio',
    'matplotlib': 'matplotlib',
};

/** Diagram types whose source is JSON rather than a line-oriented language. */
const JSON_TYPES = new Set(['vega-lite', 'wavedrom', 'echarts', 'chart']);

/**
 * The diagram type a fence language renders as, or null for a code language.
 * @param lang the first word of the fence info string
 */
export function diagramTypeOfLang(lang: string): IDiagramMeta['type'] | null {
    return DIAGRAM_LANGS[lang] ?? null;
}

/** Every fence language that renders as a diagram, for the highlighter. */
export function diagramLangs(): string[] {
    return Object.keys(DIAGRAM_LANGS);
}

export function createDiagramState(type: IDiagramMeta['type'], text = ''): IDiagramState {
    return {
        name: 'diagram',
        text,
        meta: { type, lang: JSON_TYPES.has(type) ? 'json' : 'yaml' },
    };
}
