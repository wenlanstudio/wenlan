// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { EXPORT_DOMPURIFY_CONFIG } from '../../../config';
import sanitize from '../../../utils/dompurify';
import { getHighlightHtml } from '../../marked/getHighlightHtml';
import {
    MDCOLS_ATTR,
    RATIO_ATTR,
    analyzeColumns,
    transformColumnTokens,
    type StructToken,
} from '../syntax';

const lines = (...l: string[]) => `${l.join('\n')}\n`;

/** Lex via the same helper `analyzeColumns` uses, so the fixture stays honest. */
function lex(src: string): StructToken[] {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Marked } = require('marked');

    return new Marked().lexer(src) as unknown as StructToken[];
}

/** Text of every top-level html token, joined — the marker slots only. */
function transform(src: string): string {
    const tokens = transformColumnTokens(lex(src));

    return tokens.filter(t => t.type === 'html').map(t => (t.text ?? '').trim()).join('|');
}

describe('transformColumnTokens (§3.1)', () => {
    it('rewrites a well-formed two-column group into placeholders', () => {
        const src = lines(
            '<!-- begin 30:70 -->', '', 'A', '', '<!-- split -->', '', 'B', '', '<!-- end -->',
        );
        expect(transform(src)).toBe(
            '<div data-mdcols="begin" data-ratio="30:70"></div>'
            + '|<div data-mdcols="split"></div>'
            + '|<div data-mdcols="end"></div>',
        );
    });

    it('drops a ratio that §1.3 #5 downgraded, keeping the begin marker', () => {
        // `1:2` does not add up to 100 → equal widths, so no ratio attribute.
        const src = lines('<!-- begin 1:2 -->', '', 'A', '', '<!-- split -->', '', 'B', '', '<!-- end -->');
        expect(transform(src)).toContain('<div data-mdcols="begin"></div>');
        expect(transform(src)).not.toContain(RATIO_ATTR);
    });

    it('leaves orphan markers alone (§1.3 #1)', () => {
        const src = lines('<!-- split -->', '', 'A', '', '<!-- end -->');
        expect(transform(src)).toBe('<!-- split -->|<!-- end -->');
    });

    it('leaves a begin with no end alone (§1.3 #2)', () => {
        const src = lines('<!-- begin -->', '', 'A', '', '<!-- split -->', '', 'B');
        expect(transform(src)).toBe('<!-- begin -->|<!-- split -->');
    });

    it('leaves a degraded group alone (§1.3 #4, more than 3 columns)', () => {
        const src = lines(
            '<!-- begin -->', '', 'A', '', '<!-- split -->', '', 'B', '',
            '<!-- split -->', '', 'C', '', '<!-- split -->', '', 'D', '', '<!-- end -->',
        );
        expect(analyzeColumns(src).groups[0].degraded).toBe(true);
        expect(transform(src)).not.toContain(MDCOLS_ATTR);
    });

    it('never touches a marker that is not top-level (§1.3 #7, §2.2 g)', () => {
        const src = lines(
            '- item <!-- begin --> more',
            '',
            '> quote <!-- split --> text',
            '',
            '| a | b |',
            '| - | - |',
            '| <!-- end --> | y |',
        );
        expect(transform(src)).not.toContain(MDCOLS_ATTR);
    });
});

describe('getHighlightHtml opt-in (§3.1 #1)', () => {
    const src = lines('<!-- begin 30:70 -->', '', 'A', '', '<!-- split -->', '', 'B', '', '<!-- end -->');

    it('emits placeholders only when the columns option is on', () => {
        const on = getHighlightHtml(src, { columns: true });
        const off = getHighlightHtml(src);

        expect(on).toContain(`<div ${MDCOLS_ATTR}="begin" ${RATIO_ATTR}="30:70"></div>`);
        expect(on).toContain(`<div ${MDCOLS_ATTR}="split"></div>`);
        expect(on).toContain(`<div ${MDCOLS_ATTR}="end"></div>`);
        expect(off).not.toContain(MDCOLS_ATTR);
    });

    it('is byte-identical when the source has no markers', () => {
        const plain = lines('# Title', '', 'para with **bold**', '', '- a', '- b');
        expect(getHighlightHtml(plain, { columns: true })).toBe(getHighlightHtml(plain));
    });

    it('does not split a paragraph that carries an inline comment', () => {
        // §7 core regression: the comment must not force-close the <p>.
        // marked 18 emits the comment as a top-level html token, so both
        // paragraphs stay intact either way (this is §2.2 a's finding).
        const inline = lines('body text', '<!-- begin -->', 'A column');
        const on = getHighlightHtml(inline, { columns: true });
        const off = getHighlightHtml(inline);

        expect(on).toBe(off);
        expect(on).toContain('<p>body text</p>');
        expect(on).toContain('<p>A column</p>');
        expect(on).not.toContain(MDCOLS_ATTR);
    });
});

describe('placeholder whitelist (§3.2)', () => {
    const clean = (html: string) => sanitize(html, EXPORT_DOMPURIFY_CONFIG);

    it('keeps the placeholder and its ratio', () => {
        const out = clean('<div data-mdcols="begin" data-ratio="30:70"></div>');
        expect(out).toContain('data-mdcols="begin"');
        expect(out).toContain('data-ratio="30:70"');
    });

    it('keeps split / end placeholders', () => {
        expect(clean('<div data-mdcols="split"></div>')).toContain('data-mdcols="split"');
        expect(clean('<div data-mdcols="end"></div>')).toContain('data-mdcols="end"');
    });

    it('strips ordinary comments', () => {
        expect(clean('<p>a</p><!-- foo --><p>b</p>')).not.toContain('foo');
    });

    it('does not let a hand-written element trigger columns', () => {
        // Passes through, but carries no data-mdcols, so §4.1 ignores it.
        const out = clean('<div class="mdcols-col">x</div>');
        expect(out).toContain('mdcols-col');
        expect(out).not.toContain(MDCOLS_ATTR);
    });

    it('strips script / event handlers / javascript: urls', () => {
        expect(clean('<script>alert(1)</script>')).not.toContain('script');
        expect(clean('<img src="x" onerror="alert(1)">')).not.toContain('onerror');
        expect(clean('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript:');
    });

    it('keeps inline style — both configs allow it on purpose', () => {
        // §7's matrix claims style is stripped; both configs actually allow it
        // deliberately (see the comments on PREVIEW_/EXPORT_DOMPURIFY_CONFIG).
        // Pre-existing behaviour, out of scope here — recorded so the spec
        // matrix can be corrected rather than silently disagreed with.
        expect(clean('<div style="position:fixed">x</div>')).toContain('position:fixed');
    });
});
