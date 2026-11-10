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
    'svg': 'svg',
};

/**
 * The grammar the source of each diagram type is highlighted with — its source
 * is JSON (or Python) rather than a line-oriented language. Anything unlisted
 * reads as `yaml`, which is what mermaid / plantuml / sequence / flowchart /
 * graphviz / abc look like.
 */
const DIAGRAM_GRAMMARS: Readonly<Record<string, string>> = {
    'vega-lite': 'json',
    'wavedrom': 'json',
    'echarts': 'json',
    'chart': 'json',
    'drawio': 'json',
    'matplotlib': 'python',
    'svg': 'markup',
};

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

/**
 * The grammar a diagram's source is highlighted with — `meta.lang`, which is
 * what the code container loads. It is not the fence language: that is
 * `meta.type` (` ```mermaid `), and the two only coincide by accident.
 */
export function diagramGrammarOfType(type: IDiagramMeta['type']): string {
    return DIAGRAM_GRAMMARS[type] ?? 'yaml';
}

export function createDiagramState(type: IDiagramMeta['type'], text = ''): IDiagramState {
    return {
        name: 'diagram',
        text,
        meta: { type, lang: diagramGrammarOfType(type) },
    };
}
