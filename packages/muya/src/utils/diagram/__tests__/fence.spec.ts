// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
    createDiagramState,
    diagramGrammarOfType,
    diagramLangs,
    diagramTypeOfLang,
} from '../fence';
import loadRenderer from '../index';

// Every diagram type is reachable through the fence language a user types, so
// adding a renderer without wiring its language in (or vice versa) must fail
// here. The aliases exist because nobody types `graphviz` when the docs say
// `dot`, and the other way around.
describe('diagram fence language → type', () => {
    it('maps every historical type to itself', () => {
        for (const type of ['mermaid', 'plantuml', 'vega-lite', 'flowchart', 'sequence']) {
            expect(diagramTypeOfLang(type)).toBe(type);
        }
    });

    it('maps the new types, including their aliases', () => {
        expect(diagramTypeOfLang('graphviz')).toBe('graphviz');
        expect(diagramTypeOfLang('dot')).toBe('graphviz');
        expect(diagramTypeOfLang('wavedrom')).toBe('wavedrom');
        expect(diagramTypeOfLang('echarts')).toBe('echarts');
        expect(diagramTypeOfLang('chart')).toBe('chart');
        expect(diagramTypeOfLang('chartjs')).toBe('chart');
        expect(diagramTypeOfLang('abc')).toBe('abc');
        expect(diagramTypeOfLang('drawio')).toBe('drawio');
        expect(diagramTypeOfLang('matplotlib')).toBe('matplotlib');
        expect(diagramTypeOfLang('svg')).toBe('svg');
    });

    // An `svg` fence carries the drawing as markup: there is no library to
    // import, but the renderer must still claim the type or `renderDiagram`
    // throws "Unknown diagram name svg" before the host callback is reached.
    it('claims svg as a library-free renderer', async () => {
        await expect(loadRenderer('svg')).resolves.toBeNull();
    });

    it('keeps code languages out of the diagram path', () => {
        for (const lang of ['python', 'js', 'json', 'yaml', 'mermaidx', '']) {
            expect(diagramTypeOfLang(lang)).toBeNull();
        }
    });

    it('lists every language it maps, for the highlighter skip list', () => {
        const langs = diagramLangs();
        expect(new Set(langs).size).toBe(langs.length);
        for (const lang of langs) {
            expect(diagramTypeOfLang(lang)).not.toBeNull();
        }
    });

    // `meta.lang` is the grammar the source is highlighted with, not the fence
    // language: a matplotlib block holds Python, and a drawio block a JSON
    // config, so neither reads as yaml despite being "not JSON-sourced" by the
    // old rule.
    it('highlights each type with the grammar its source is written in', () => {
        expect(createDiagramState('vega-lite').meta.lang).toBe('json');
        expect(createDiagramState('echarts').meta.lang).toBe('json');
        expect(createDiagramState('chart').meta.lang).toBe('json');
        expect(createDiagramState('wavedrom').meta.lang).toBe('json');
        expect(createDiagramState('drawio').meta.lang).toBe('json');
        expect(createDiagramState('matplotlib').meta.lang).toBe('python');
        expect(createDiagramState('svg').meta.lang).toBe('markup');
        expect(createDiagramState('graphviz').meta.lang).toBe('yaml');
        expect(createDiagramState('abc').meta.lang).toBe('yaml');

        expect(diagramGrammarOfType('mermaid')).toBe('yaml');
        expect(diagramGrammarOfType('matplotlib')).toBe('python');

        const state = createDiagramState('abc', 'X:1\n');
        expect(state).toEqual({
            name: 'diagram',
            text: 'X:1\n',
            meta: { type: 'abc', lang: 'yaml' },
        });
    });
});
