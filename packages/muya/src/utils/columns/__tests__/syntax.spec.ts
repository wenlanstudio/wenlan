import { describe, expect, it } from 'vitest';
import { analyzeColumns, hasColumnMarkers, parseMarker, parseRatio } from '../syntax';

// Shared spec for the column format (§3.0): the pre-transform (§3.1), the DOM
// post-processing (§4.1) and the lint (§5) all consume `analyzeColumns`, so
// every §1.3 rule is asserted exactly once, here.
const lines = (...xs: string[]) => xs.join('\n');

// §4.6 rule-8 infos report the block-badge fallback, not a format problem —
// the fixtures below are blank-line separated on purpose, so filter them when
// asserting "no diagnostics". The rule-8 behaviour itself is pinned in the
// `analyzeColumns — §4.6 inline badges` suite.
function formatDiagnostics(r: { diagnostics: Array<{ rule: number }> }) {
    return r.diagnostics.filter(d => d.rule !== 8);
}

describe('parseMarker', () => {
    it('recognizes the three kinds without a ratio', () => {
        expect(parseMarker('<!-- begin -->')).toEqual({ kind: 'begin' });
        expect(parseMarker('<!-- split -->')).toEqual({ kind: 'split' });
        expect(parseMarker('<!-- end -->')).toEqual({ kind: 'end' });
    });

    it('captures the ratio on begin', () => {
        expect(parseMarker('<!-- begin 1:2 -->')).toEqual({ kind: 'begin', ratioText: '1:2' });
        expect(parseMarker('<!-- begin 1:1:2 -->')).toEqual({ kind: 'begin', ratioText: '1:1:2' });
    });

    it('is case-insensitive and tolerates inner whitespace', () => {
        expect(parseMarker('<!-- BEGIN -->')).toEqual({ kind: 'begin' });
        expect(parseMarker('<!--  Split  -->')).toEqual({ kind: 'split' });
        expect(parseMarker('<!--  begin  1:2  -->')).toEqual({ kind: 'begin', ratioText: '1:2' });
    });

    it('keeps a malformed ratio instead of going inert (§1.3 #5)', () => {
        expect(parseMarker('<!-- begin a:b -->')).toEqual({ kind: 'begin', ratioText: 'a:b' });
    });

    it('rejects anything that is not exactly a marker', () => {
        expect(parseMarker('<!-- beginx -->')).toBeNull();
        expect(parseMarker('<!-- a normal comment -->')).toBeNull();
        expect(parseMarker('<div></div>')).toBeNull();
        expect(parseMarker('')).toBeNull();
        expect(parseMarker('文字<!-- begin -->更多')).toBeNull();
    });
});

describe('parseRatio', () => {
    it('parses percentages that add up to 100', () => {
        expect(parseRatio('30:70')).toEqual([30, 70]);
        expect(parseRatio('25:25:50')).toEqual([25, 25, 50]);
        expect(parseRatio('30 : 70')).toEqual([30, 70]);
        expect(parseRatio('100')).toEqual([100]);
    });

    it('rejects ratios that do not add up to 100', () => {
        expect(parseRatio('1:2')).toBeNull();
        expect(parseRatio('1:1:2')).toBeNull();
        expect(parseRatio('50:60')).toBeNull();
    });

    it('rejects absent or non-positive-integer ratios', () => {
        expect(parseRatio(undefined)).toBeNull();
        expect(parseRatio('0:100')).toBeNull();
        expect(parseRatio('a:100')).toBeNull();
        expect(parseRatio('30:')).toBeNull();
    });
});

describe('analyzeColumns — well-formed groups', () => {
    it('builds a two-column group', () => {
        const r = analyzeColumns(lines(
            '<!-- begin -->', '', 'A', '', '<!-- split -->', '', 'B', '', '<!-- end -->',
        ));
        expect(r.hasMarkers).toBe(true);
        expect(r.groups).toHaveLength(1);
        expect(r.groups[0].columns).toBe(2);
        expect(r.groups[0].ratio).toBeUndefined();
        expect(r.groups[0].degraded).toBe(false);
        expect(r.groups[0].beginLine).toBe(1);
        expect(r.groups[0].endLine).toBe(9);
        expect(formatDiagnostics(r)).toHaveLength(0);
    });

    it('accepts a three-column group with a matching percentage ratio', () => {
        const r = analyzeColumns(lines(
            '<!-- begin 25:25:50 -->', '', 'A', '', '<!-- split -->', '', 'B', '',
            '<!-- split -->', '', 'C', '', '<!-- end -->',
        ));
        expect(r.groups).toHaveLength(1);
        expect(r.groups[0].columns).toBe(3);
        expect(r.groups[0].ratio).toEqual([25, 25, 50]);
        expect(r.groups[0].degraded).toBe(false);
        expect(formatDiagnostics(r)).toHaveLength(0);
    });

    it('accepts a two-column percentage ratio', () => {
        const r = analyzeColumns(lines(
            '<!-- begin 30:70 -->', '', 'A', '', '<!-- split -->', '', 'B', '', '<!-- end -->',
        ));
        expect(r.groups[0].columns).toBe(2);
        expect(r.groups[0].ratio).toEqual([30, 70]);
        expect(formatDiagnostics(r)).toHaveLength(0);
    });

    it('treats begin without split as a single column', () => {
        const r = analyzeColumns(lines('<!-- begin -->', '', 'A', '', '<!-- end -->'));
        expect(r.groups[0].columns).toBe(1);
        expect(r.groups[0].markers.map(m => m.kind)).toEqual(['begin', 'end']);
    });

    it('handles several independent groups in one document', () => {
        const r = analyzeColumns(lines(
            '<!-- begin -->', '', 'A', '', '<!-- split -->', '', 'B', '', '<!-- end -->',
            '', 'middle', '',
            '<!-- begin 30:70 -->', '', 'C', '', '<!-- split -->', '', 'D', '', '<!-- end -->',
        ));
        expect(r.groups).toHaveLength(2);
        expect(r.groups[0].ratio).toBeUndefined();
        expect(r.groups[1].ratio).toEqual([30, 70]);
        expect(formatDiagnostics(r)).toHaveLength(0);
    });
});

describe('analyzeColumns — §1.3 diagnostics', () => {
    it('#1 reports an orphan split and an orphan end', () => {
        const split = analyzeColumns(lines('A', '', '<!-- split -->'));
        expect(split.groups).toHaveLength(0);
        expect(split.diagnostics).toEqual([
            expect.objectContaining({ rule: 1, level: 'warning', line: 3 }),
        ]);

        const end = analyzeColumns('<!-- end -->');
        expect(end.groups).toHaveLength(0);
        expect(end.diagnostics).toEqual([
            expect.objectContaining({ rule: 1, level: 'warning', line: 1 }),
        ]);
    });

    it('#2 reports a begin that never closes', () => {
        const r = analyzeColumns(lines('<!-- begin -->', '', 'A'));
        expect(r.hasMarkers).toBe(true);
        expect(r.groups).toHaveLength(0);
        expect(r.diagnostics).toEqual([
            expect.objectContaining({ rule: 2, level: 'warning', line: 1 }),
        ]);
    });

    it('#3 drops a nested begin and keeps the outer group', () => {
        const r = analyzeColumns(lines(
            '<!-- begin -->', '', 'A', '', '<!-- begin -->', '', 'B', '', '<!-- end -->',
        ));
        expect(r.groups).toHaveLength(1);
        expect(r.groups[0].markers.map(m => m.kind)).toEqual(['begin', 'end']);
        expect(r.diagnostics).toEqual([
            expect.objectContaining({ rule: 3, level: 'warning', line: 5 }),
            // The surviving group is blank-line separated → block badges (§4.6).
            expect.objectContaining({ rule: 8, level: 'info', line: 1 }),
        ]);
    });

    it('#4 degrades the whole group past three columns', () => {
        const r = analyzeColumns(lines(
            '<!-- begin -->', '', 'A', '', '<!-- split -->', '', 'B', '',
            '<!-- split -->', '', 'C', '', '<!-- split -->', '', 'D', '', '<!-- end -->',
        ));
        expect(r.groups).toHaveLength(1);
        expect(r.groups[0].columns).toBe(4);
        expect(r.groups[0].degraded).toBe(true);
        expect(r.diagnostics).toEqual([
            expect.objectContaining({ rule: 4, level: 'warning', line: 1 }),
            expect.objectContaining({ rule: 8, level: 'info', line: 1 }),
        ]);
    });

    it('#5 falls back to equal widths when the ratio is unusable', () => {
        // Positive integers, but they do not add up to 100.
        const notPercent = analyzeColumns(lines(
            '<!-- begin 1:2 -->', '', 'A', '', '<!-- split -->', '', 'B', '', '<!-- end -->',
        ));
        expect(notPercent.groups[0].columns).toBe(2);
        expect(notPercent.groups[0].ratio).toBeUndefined();
        expect(notPercent.diagnostics).toEqual([
            expect.objectContaining({ rule: 5, level: 'info', line: 1 }),
            expect.objectContaining({ rule: 8, level: 'info', line: 1 }),
        ]);
        expect(notPercent.diagnostics[0].message).toContain('100');

        // Not positive integers at all.
        const malformed = analyzeColumns(lines(
            '<!-- begin a:b -->', '', 'A', '', '<!-- split -->', '', 'B', '', '<!-- end -->',
        ));
        expect(malformed.groups[0].ratio).toBeUndefined();
        expect(malformed.diagnostics).toEqual([
            expect.objectContaining({ rule: 5, level: 'info', line: 1 }),
            expect.objectContaining({ rule: 8, level: 'info', line: 1 }),
        ]);

        // Valid percentages, but the count does not match the column count.
        const countMismatch = analyzeColumns(lines(
            '<!-- begin 30:70 -->', '', 'A', '', '<!-- split -->', '', 'B', '',
            '<!-- split -->', '', 'C', '', '<!-- end -->',
        ));
        expect(countMismatch.groups[0].columns).toBe(3);
        expect(countMismatch.groups[0].ratio).toBeUndefined();
        expect(countMismatch.diagnostics[0]).toMatchObject({ rule: 5, level: 'info', line: 1 });
        expect(countMismatch.diagnostics[0].message).toContain('个数');
    });

    it('#6 reports a marker comment that is never closed', () => {
        const r = analyzeColumns(lines('<!-- begin', '', 'A'));
        expect(r.hasMarkers).toBe(false);
        expect(r.groups).toHaveLength(0);
        expect(r.diagnostics).toEqual([
            expect.objectContaining({ rule: 6, level: 'warning', line: 1 }),
        ]);
    });

    it('#7 keeps non-top-level markers inert (list, quote, code, inline)', () => {
        const cases: Array<[string, string]> = [
            ['list', lines('- item', '  <!-- begin -->')],
            ['quote', '> <!-- begin -->'],
            ['code', lines('```', '<!-- begin -->', '```')],
            ['inline', '文字<!-- begin -->更多'],
        ];

        for (const [name, src] of cases) {
            const r = analyzeColumns(src);
            expect(r.hasMarkers, name).toBe(false);
            expect(r.groups, name).toHaveLength(0);
            expect(r.diagnostics.filter(d => d.rule === 7), name).toHaveLength(1);
            expect(r.diagnostics[0].level, name).toBe('info');
        }
    });
});

describe('analyzeColumns — §4.6 inline badges', () => {
    it('marks markers that own their line directly under a paragraph', () => {
        const r = analyzeColumns(
            lines('正文', '<!-- begin 30:70 -->', 'A', '<!-- split -->', 'B', '<!-- end -->'),
        );
        expect(r.groups).toHaveLength(1);
        expect(r.groups[0].markers.map(m => m.inline)).toEqual([true, true, true]);
        expect(r.diagnostics.filter(d => d.rule === 8)).toHaveLength(0);
    });

    it('reports one rule-8 info per blank-line separated group', () => {
        const r = analyzeColumns(
            lines('<!-- begin -->', '', 'A', '', '<!-- split -->', '', 'B', '', '<!-- end -->'),
        );
        expect(r.groups[0].markers.map(m => m.inline)).toEqual([false, false, false]);
        expect(r.diagnostics.filter(d => d.rule === 8)).toEqual([
            expect.objectContaining({ rule: 8, level: 'info', line: 1 }),
        ]);
    });

    it('keeps a mixed group to a single rule-8 info', () => {
        const r = analyzeColumns(
            lines('正文', '<!-- begin -->', 'A', '', '<!-- split -->', 'B', '<!-- end -->'),
        );
        expect(r.groups[0].markers.map(m => m.inline)).toEqual([true, false, true]);
        expect(r.diagnostics.filter(d => d.rule === 8)).toHaveLength(1);
    });

    it('treats a marker after a heading as block-level', () => {
        const r = analyzeColumns(lines('## 标题', '<!-- begin -->', 'A', '<!-- end -->'));

        expect(r.groups[0].markers.map(m => m.inline)).toEqual([false, true]);
        expect(r.diagnostics.filter(d => d.rule === 8)).toHaveLength(1);
    });

    it('treats a document-initial begin as block-level', () => {
        const r = analyzeColumns(lines('<!-- begin -->', 'A', '<!-- end -->'));

        expect(r.groups[0].markers.map(m => m.inline)).toEqual([false, true]);
    });
});

describe('hasColumnMarkers', () => {
    it('is the derived view of analyzeColumns().hasMarkers', () => {
        expect(hasColumnMarkers(lines('<!-- begin -->', '', 'A', '', '<!-- end -->'))).toBe(true);
        expect(hasColumnMarkers('plain text')).toBe(false);
        expect(hasColumnMarkers('<!-- split -->')).toBe(false);
    });
});
