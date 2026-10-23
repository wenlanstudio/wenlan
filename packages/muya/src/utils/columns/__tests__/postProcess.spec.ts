// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { EXPORT_DOMPURIFY_CONFIG } from '../../../config';
import sanitize from '../../../utils/dompurify';
import { getHighlightHtml } from '../../marked/getHighlightHtml';
import { postProcessColumns } from '../postProcess';
import { analyzeColumns } from '../syntax';

const lines = (...l: string[]) => `${l.join('\n')}\n`;

/**
 * The real Phase 1 → Phase 2 chain: markdown → token transform → sanitize →
 * DOM → post-processing. Asserting on the produced DOM keeps this honest about
 * what DOMPurify actually lets through.
 */
function render(md: string): HTMLDivElement {
    const html = sanitize(getHighlightHtml(md, { columns: true }), EXPORT_DOMPURIFY_CONFIG);
    const container = document.createElement('div');
    container.innerHTML = html;

    return container;
}

function process(md: string): string {
    const container = render(md);
    postProcessColumns(container);

    return container.innerHTML;
}

describe('postProcessColumns (§4.1)', () => {
    it('wraps a two-column group and applies the ratio as flex-grow', () => {
        const out = process(lines(
            '<!-- begin 30:70 -->', '', 'A', '', '<!-- split -->', '', 'B', '', '<!-- end -->',
        ));
        // Trailing newlines are the source's own, left after the group.
        expect(out).toBe(
            '<div class="mdcols-group">'
            + '<div class="mdcols-col" style="flex-grow: 30;"><p>A</p></div>'
            + '<div class="mdcols-col" style="flex-grow: 70;"><p>B</p></div>'
            + '</div>\n\n',
        );
    });

    it('falls back to equal widths when the ratio was downgraded (§1.3 #5)', () => {
        const out = process(lines(
            '<!-- begin 1:2 -->', '', 'A', '', '<!-- split -->', '', 'B', '', '<!-- end -->',
        ));
        expect(out).not.toContain('flex-grow');
        expect(out).toContain('<div class="mdcols-col"><p>A</p></div>');
    });

    it('wraps three columns', () => {
        const out = process(lines(
            '<!-- begin -->', '', 'A', '', '<!-- split -->', '', 'B', '',
            '<!-- split -->', '', 'C', '', '<!-- end -->',
        ));
        expect(out.match(/class="mdcols-col"/g)).toHaveLength(3);
        expect(out).toContain('<p>C</p>');
    });

    it('keeps content outside a group untouched', () => {
        const out = process(lines(
            '# Before', '',
            '<!-- begin -->', '', 'A', '', '<!-- split -->', '', 'B', '', '<!-- end -->', '',
            'After',
        ));
        expect(out).toContain('<h1>Before</h1>');
        expect(out).toContain('<p>After</p>');
        expect(out.indexOf('<h1>Before</h1>')).toBeLessThan(out.indexOf('mdcols-group'));
        expect(out.indexOf('mdcols-group')).toBeLessThan(out.indexOf('<p>After</p>'));
    });

    it('wraps an empty column instead of erroring (§4.3)', () => {
        const out = process(lines(
            '<!-- begin -->', '', '<!-- split -->', '', 'B', '', '<!-- end -->',
        ));
        expect(out).toContain('<div class="mdcols-col"></div>');
        expect(out).toContain('<p>B</p>');
    });

    it('leaves orphan markers out of the output (§1.3 #1 — filtered in Phase 1)', () => {
        const out = process(lines('<!-- split -->', '', 'A', '', '<!-- end -->'));
        expect(out).not.toContain('mdcols');
        expect(out).toContain('<p>A</p>');
    });

    it('keeps content in place when begin has no end (§1.3 #2)', () => {
        const out = process(lines('<!-- begin -->', '', 'A', '', '<!-- split -->', '', 'B'));
        expect(out).not.toContain('mdcols');
        expect(out).toContain('<p>A</p>');
        expect(out).toContain('<p>B</p>');
    });

    it('renders a degraded group linearly (§1.3 #4)', () => {
        const out = process(lines(
            '<!-- begin -->', '', 'A', '', '<!-- split -->', '', 'B', '',
            '<!-- split -->', '', 'C', '', '<!-- split -->', '', 'D', '', '<!-- end -->',
        ));
        expect(analyzeColumns(lines(
            '<!-- begin -->', '', 'A', '', '<!-- split -->', '', 'B', '',
            '<!-- split -->', '', 'C', '', '<!-- split -->', '', 'D', '', '<!-- end -->',
        )).groups[0].degraded).toBe(true);
        expect(out).not.toContain('mdcols-group');
        expect(out).toContain('<p>D</p>');
    });

    it('never triggers on a marker that is not top-level (§1.3 #7)', () => {
        const out = process(lines(
            '- item <!-- begin --> more', '',
            '<!-- begin -->', '', 'A', '', '<!-- split -->', '', 'B', '', '<!-- end -->',
        ));
        expect(out.match(/class="mdcols-col"/g)).toHaveLength(2);
        // The inline comment was already stripped by DOMPurify — it never
        // became a placeholder, so it never reached the post-processing.
        expect(out).toContain('<li>item  more</li>');
        expect(out).not.toContain('data-mdcols');
    });

    it('strips a placeholder nested inside user raw HTML (§4.1 #8)', () => {
        const container = document.createElement('div');
        container.innerHTML = '<div><div data-mdcols="split"></div></div>';
        postProcessColumns(container);
        expect(container.innerHTML).toBe('<div></div>');
    });

    it('reports no fallback diagnostics for well-formed input', () => {
        const container = render(lines(
            '<!-- begin -->', '', 'A', '', '<!-- split -->', '', 'B', '', '<!-- end -->',
        ));
        expect(postProcessColumns(container)).toEqual([]);
    });
});
