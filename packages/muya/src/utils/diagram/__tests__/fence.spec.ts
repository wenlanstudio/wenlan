// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createDiagramState, diagramLangs, diagramTypeOfLang } from '../fence';

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

    it('marks the JSON-sourced types as json, the rest as yaml', () => {
        expect(createDiagramState('vega-lite').meta.lang).toBe('json');
        expect(createDiagramState('echarts').meta.lang).toBe('json');
        expect(createDiagramState('chart').meta.lang).toBe('json');
        expect(createDiagramState('wavedrom').meta.lang).toBe('json');
        expect(createDiagramState('graphviz').meta.lang).toBe('yaml');
        expect(createDiagramState('abc').meta.lang).toBe('yaml');
        expect(createDiagramState('drawio').meta.lang).toBe('yaml');
        expect(createDiagramState('matplotlib').meta.lang).toBe('yaml');

        const state = createDiagramState('abc', 'X:1\n');
        expect(state).toEqual({
            name: 'diagram',
            text: 'X:1\n',
            meta: { type: 'abc', lang: 'yaml' },
        });
    });
});
