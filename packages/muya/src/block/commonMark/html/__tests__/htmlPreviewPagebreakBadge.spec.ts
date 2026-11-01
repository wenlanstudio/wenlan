// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Muya } from '../../../../muya';

// `<!-- pagebreak -->` — paper-leaf forced page break (view-model §5), a
// sibling of the column marker family. Standalone comment lines render the
// family badge (click-to-edit affordance); inline occurrences stay inert
// comments. Desktop's paper pagination reads the badge as a forced seam and
// the print chain turns it into `break-after: page`.

const bootedMuyas: Muya[] = [];

beforeEach(() => {
    (window as unknown as { MUYA_VERSION?: string }).MUYA_VERSION = 'test';
});

afterEach(() => {
    while (bootedMuyas.length)
        bootedMuyas.pop()!.destroy();
    document.body.innerHTML = '';
    delete (window as unknown as { MUYA_VERSION?: string }).MUYA_VERSION;
});

function boot(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    bootedMuyas.push(muya);
    return muya;
}

const DOC = [
    'A',
    '',
    '<!-- pagebreak -->',
    '',
    'B'
].join('\n');

describe('htmlPreview — pagebreak marker badge (view-model §5)', () => {
    it('renders the family badge with data-kind=pagebreak', () => {
        const muya = boot(DOC);
        const badges = [...muya.domNode.querySelectorAll<HTMLElement>('.mu-html-preview .mu-mdcols-pagebreak')];

        expect(badges).toHaveLength(1);
        expect(badges[0].dataset.kind).toBe('pagebreak');
        expect(badges[0].className).toContain('mu-mdcols-inline');
        // 同族：badge 仍携带通用 marker class（点击编辑、分栏视图隐藏等族行为）。
        expect(badges[0].className).toContain('mu-mdcols-marker');
    });

    it('keeps the marker text as the block source (click-to-edit path intact)', () => {
        const muya = boot(DOC);
        const badge = muya.domNode.querySelector<HTMLElement>('.mu-mdcols-pagebreak')!;
        badge.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        const selection = muya.editor.selection.getSelection();
        expect(selection).not.toBeNull();
        expect(selection!.anchor.block.text).toBe('<!-- pagebreak -->');
    });

    it('leaves inline pagebreak comments inert (no badge inside a paragraph)', () => {
        const muya = boot('text with <!-- pagebreak --> inside');
        expect(muya.domNode.querySelector('.mu-mdcols-pagebreak')).toBeNull();
    });
});
