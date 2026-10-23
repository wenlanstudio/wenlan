// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { applyEditorColumns, revertEditorColumns } from '../editorLayout';

// Mirrors what `htmlPreview` renders for `<!-- begin -->` and friends inside an
// html-block: `figure.mu-html-block > .mu-html-preview > .mu-mdcols-marker`,
// the same badge element as the inline form, carrying kind and ratio on data
// attributes (it doubles as the Columns view's regroup boundary carrier).
const marker = (kind: string, ratio?: string): string =>
    `<div class="mu-html-preview"><span class="mu-mdcols-marker mu-mdcols-inline mu-mdcols-${kind}" data-kind="${kind}"${
        ratio ? ` data-ratio="${ratio}"` : ''
    }></span></div>`;

const block = (kind: string, ratio?: string): string =>
    `<figure class="mu-html-block">${marker(kind, ratio)}</figure>`;

// Mirrors what the inlineRenderer badge (§4.6) renders for a marker comment
// that owns its line under a paragraph: a `.mu-mdcols-inline` span at the
// paragraph tail, carrying kind and ratio on data attributes.
function inlineBadge(kind: string, ratio?: string): string {
    return `<p>正文<span class="mu-mdcols-marker mu-mdcols-inline mu-mdcols-${kind}" data-kind="${kind}"${
        ratio ? ` data-ratio="${ratio}"` : ''
    }></span></p>`;
}

let editor: HTMLDivElement;

beforeEach(() => {
    document.body.innerHTML = '<div class="mu-editor"></div>';
    editor = document.querySelector('.mu-editor') as HTMLDivElement;
});

const colCount = (): number => editor.querySelectorAll('.mu-mdcols-col').length;
const groupCount = (): number => editor.querySelectorAll('.mu-mdcols-group').length;

describe('applyEditorColumns', () => {
    it('wraps a begin/split/end group into columns', () => {
        editor.innerHTML = block('begin') + '<p>A</p>' + block('split') + '<p>B</p>' + block('end');

        applyEditorColumns(editor);

        expect(groupCount()).toBe(1);
        expect(colCount()).toBe(2);
        const cols = [...editor.querySelectorAll('.mu-mdcols-col')];
        expect(cols[0].innerHTML).toBe('<p>A</p>');
        expect(cols[1].innerHTML).toBe('<p>B</p>');
    });

    it('hides the marker blocks instead of removing them', () => {
        editor.innerHTML = block('begin') + '<p>A</p>' + block('split') + '<p>B</p>' + block('end');

        applyEditorColumns(editor);

        expect(editor.querySelectorAll('.mu-mdcols-hidden').length).toBe(3);
        // Still in the DOM, so a revert needs no re-render.
        expect(editor.querySelectorAll('.mu-mdcols-marker').length).toBe(3);
    });

    it('maps a validated ratio onto flex-grow', () => {
        editor.innerHTML
            = block('begin', '30:70') + '<p>A</p>' + block('split') + '<p>B</p>' + block('end');

        applyEditorColumns(editor);

        const cols = [...editor.querySelectorAll<HTMLElement>('.mu-mdcols-col')];
        expect(cols[0].style.flexGrow).toBe('30');
        expect(cols[1].style.flexGrow).toBe('70');
    });

    it('ignores a ratio whose part count does not match the columns', () => {
        editor.innerHTML
            = block('begin', '30:70') + '<p>A</p>' + block('split') + '<p>B</p>' + block('split')
            + '<p>C</p>' + block('end');

        applyEditorColumns(editor);

        const cols = [...editor.querySelectorAll<HTMLElement>('.mu-mdcols-col')];
        expect(cols).toHaveLength(3);
        expect(cols.every(c => !c.style.flexGrow)).toBe(true);
    });

    it('leaves orphan markers inert (§1.3 #1)', () => {
        editor.innerHTML = '<p>plain</p>' + block('split') + block('end');

        applyEditorColumns(editor);

        expect(groupCount()).toBe(0);
        expect(editor.querySelectorAll('.mu-mdcols-hidden').length).toBe(0);
    });

    it('leaves a group without end inert (§1.3 #2)', () => {
        editor.innerHTML = block('begin') + '<p>A</p>' + block('split') + '<p>B</p>';

        applyEditorColumns(editor);

        expect(groupCount()).toBe(0);
    });

    it('degrades a group with more than three columns (§1.3 #4)', () => {
        editor.innerHTML
            = block('begin') + '<p>A</p>' + block('split') + '<p>B</p>' + block('split') + '<p>C</p>'
            + block('split') + '<p>D</p>' + block('end');

        applyEditorColumns(editor);

        expect(groupCount()).toBe(0);
    });

    it('keeps blocks outside any group where they are', () => {
        editor.innerHTML
            = '<p>before</p>' + block('begin') + '<p>A</p>' + block('split') + '<p>B</p>'
            + block('end') + '<p>after</p>';

        applyEditorColumns(editor);

        const children = [...editor.children];
        expect(children[0].textContent).toBe('before');
        expect(children[1].classList.contains('mu-mdcols-group')).toBe(true);
        expect(children[children.length - 1].textContent).toBe('after');
    });

    it('is idempotent: re-applying reverts first', () => {
        editor.innerHTML = block('begin') + '<p>A</p>' + block('split') + '<p>B</p>' + block('end');

        applyEditorColumns(editor);
        applyEditorColumns(editor);

        expect(groupCount()).toBe(1);
        expect(colCount()).toBe(2);
    });

    it('does not resurrect blocks the engine replaced (setContent)', () => {
        editor.innerHTML = block('begin') + '<p>A</p>' + block('split') + '<p>B</p>' + block('end');

        applyEditorColumns(editor);
        // The engine rebuilds the subtree wholesale: nothing of the recorded
        // child list is still attached.
        editor.innerHTML = block('begin') + '<p>C</p>' + block('split') + '<p>D</p>' + block('end');

        applyEditorColumns(editor);

        expect(colCount()).toBe(2);
        expect(editor.textContent).not.toContain('A');
        expect(editor.textContent).not.toContain('B');
        const cols = [...editor.querySelectorAll('.mu-mdcols-col')];
        expect(cols[0].innerHTML).toBe('<p>C</p>');
        expect(cols[1].innerHTML).toBe('<p>D</p>');
    });

    it('wraps an all-inline group, keeping the badge paragraphs in their columns (§4.6)', () => {
        editor.innerHTML
            = inlineBadge('begin') + '<p>A</p>' + inlineBadge('split') + '<p>B</p>' + inlineBadge('end');

        applyEditorColumns(editor);

        expect(groupCount()).toBe(1);
        const cols = [...editor.querySelectorAll('.mu-mdcols-col')];
        // The begin paragraph stays outside the columns; split / end paragraphs
        // are the last blocks of their column and stay visible.
        expect(cols[0].textContent).toBe('A正文');
        expect(cols[1].textContent).toBe('B正文');
        // Only the badge spans are hidden — never the content paragraphs.
        const hidden = [...editor.querySelectorAll('.mu-mdcols-hidden')];
        expect(hidden).toHaveLength(3);
        expect(hidden.every(el => el.tagName === 'SPAN')).toBe(true);
    });

    it('maps an inline begin ratio onto flex-grow', () => {
        editor.innerHTML
            = inlineBadge('begin', '30:70') + '<p>A</p>' + inlineBadge('split') + '<p>B</p>'
            + inlineBadge('end');

        applyEditorColumns(editor);

        const cols = [...editor.querySelectorAll<HTMLElement>('.mu-mdcols-col')];
        expect(cols[0].style.flexGrow).toBe('30');
        expect(cols[1].style.flexGrow).toBe('70');
    });

    it('supports a mixed group (block-level begin, inline split/end)', () => {
        editor.innerHTML
            = block('begin') + '<p>A</p>' + inlineBadge('split') + '<p>B</p>' + inlineBadge('end');

        applyEditorColumns(editor);

        const cols = [...editor.querySelectorAll('.mu-mdcols-col')];
        expect(cols[0].textContent).toBe('A正文');
        expect(cols[1].textContent).toBe('B正文');
        const hidden = [...editor.querySelectorAll('.mu-mdcols-hidden')];
        // Block marker hides the whole figure; inline markers hide only the span.
        expect(hidden.filter(el => el.tagName === 'FIGURE')).toHaveLength(1);
        expect(hidden.filter(el => el.tagName === 'SPAN')).toHaveLength(2);
    });
});

describe('revertEditorColumns', () => {
    it('restores the original block order and un-hides the markers', () => {
        editor.innerHTML
            = '<p>before</p>' + block('begin') + '<p>A</p>' + block('split') + '<p>B</p>'
            + block('end') + '<p>after</p>';
        const before = editor.innerHTML;

        applyEditorColumns(editor);
        revertEditorColumns(editor);

        expect(editor.innerHTML).toBe(before);
        expect(groupCount()).toBe(0);
        expect(editor.querySelectorAll('.mu-mdcols-hidden').length).toBe(0);
    });

    it('is a no-op when nothing was applied', () => {
        editor.innerHTML = '<p>A</p>';
        const before = editor.innerHTML;

        revertEditorColumns(editor);

        expect(editor.innerHTML).toBe(before);
    });

    it('restores an all-inline group byte-for-byte (§4.6)', () => {
        editor.innerHTML
            = inlineBadge('begin') + '<p>A</p>' + inlineBadge('split') + '<p>B</p>' + inlineBadge('end');
        const before = editor.innerHTML;

        applyEditorColumns(editor);
        revertEditorColumns(editor);

        expect(editor.innerHTML).toBe(before);
        expect(editor.querySelectorAll('.mu-mdcols-hidden').length).toBe(0);
    });
});
