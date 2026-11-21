// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { search } from '../index';

// The fence picker's suggestion pool (#user-facing: typing after ``` or in the
// language input must suggest everything the editor treats as first-class):
// diagram languages (mermaid/graphviz/matplotlib/…, converted to diagram blocks
// on pick) and mdcode2run executable aliases Prism has no grammar for
// (pwsh/hive/mysql/…). Guarded here so new diagram types / family aliases get
// added to the pool together with their renderer / engine support.
describe('fence language picker pool', () => {
    const namesOf = (query: string) => search(query).map(item => item.name);

    it('suggests diagram languages from partial input', () => {
        expect(namesOf('mer')).toContain('mermaid');
        expect(namesOf('plant')).toContain('plantuml');
        // `mat` alone collides with Prism's mathml/mata/matlab in the top-5 —
        // one more char is enough to surface matplotlib.
        expect(namesOf('matp')).toContain('matplotlib');
        expect(namesOf('graphviz')).toContain('graphviz');
        expect(namesOf('vega')).toContain('vega-lite');
    });

    it('keeps `dot` suggestable (Prism grammar + graphviz diagram type)', () => {
        expect(namesOf('dot')).toContain('dot');
    });

    it('suggests executable aliases beyond Prism grammars', () => {
        expect(namesOf('pwsh')).toContain('pwsh');
        expect(namesOf('ps1')).toContain('ps1');
        expect(namesOf('jshell')).toContain('jshell');
        expect(namesOf('mysql')).toContain('mysql');
        expect(namesOf('hive')).toContain('hive');
        expect(namesOf('hql')).toContain('hql');
        expect(namesOf('hiveql')).toContain('hiveql');
        expect(namesOf('sparksql')).toContain('sparksql');
    });

    it('has exactly one pool entry per overlapping name (Prism vs diagram/extras dedupe)', () => {
        // svg/abc/dot exist both in Prism and the diagram pool — the dedupe on
        // build must leave exactly one entry per name; an exact-name query
        // scores ~0 so any duplicate would sit in the top-5 slice.
        for (const q of ['svg', 'abc', 'dot']) {
            expect(namesOf(q).filter(n => n === q).length, q).toBe(1);
        }
    });
});
