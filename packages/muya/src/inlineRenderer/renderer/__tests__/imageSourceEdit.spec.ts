// @vitest-environment happy-dom

import type Content from '../../../block/base/content';
import type Parent from '../../../block/base/parent';
import type { IRenderCursor } from '../../../selection/types';
import { afterEach, describe, expect, it } from 'vitest';
import { Muya } from '../../../muya';

// Issue #13 (merged with #11): clicking an image reveals its markdown source,
// but the old caret test required both endpoints strictly INSIDE the token —
// drag-selecting the whole `![alt](src)` flipped the code back to an image
// mid-selection, so the source could never be edited. The test is now
// interval intersection, and while the source is shown a live preview of the
// image renders right below it (decided interaction: code on top, preview
// underneath, like the diagram blocks).

const bootedHosts: HTMLElement[] = [];

afterEach(() => {
    while (bootedHosts.length)
        bootedHosts.pop()!.remove();
    document.getSelection()?.removeAllRanges();
});

function boot(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    bootedHosts.push(muya.domNode);
    return muya;
}

const DOC = '![alt](pic.png)\n';
// `![alt](pic.png)` spans the whole paragraph: token range [0, 15].
const IMAGE_END = DOC.indexOf(')') + 1;

function paragraphContent(muya: Muya): Content {
    const paragraph = muya.editor.scrollPage!.firstChild as unknown as Parent;
    return paragraph.firstContentInDescendant()!;
}

function cursorAt(muya: Muya, content: Content, anchor: number, focus: number): IRenderCursor {
    muya.editor.activeContentBlock = content;
    return {
        block: content,
        anchor: { offset: anchor },
        focus: { offset: focus },
    } as IRenderCursor;
}

describe('image source editing — intersection test + live preview (#13)', () => {
    it('caret inside the token shows the source and a live preview below', () => {
        const muya = boot(DOC);
        const content = paragraphContent(muya);

        content.update(cursorAt(muya, content, 5, 5));

        const html = content.domNode!.innerHTML;
        expect(html).toContain('mu-image-marked-text');
        expect(html).toContain('mu-image-live-preview');
        expect(content.domNode!.querySelectorAll('.mu-image-live-preview img').length).toBe(1);
    });

    it('a selection spanning the whole token keeps the source visible', () => {
        const muya = boot(DOC);
        const content = paragraphContent(muya);

        content.update(cursorAt(muya, content, 0, IMAGE_END));

        expect(content.domNode!.innerHTML).toContain('mu-image-marked-text');
    });

    it('caret right after the token renders the image again', () => {
        const muya = boot(DOC);
        const content = paragraphContent(muya);

        content.update(cursorAt(muya, content, IMAGE_END, IMAGE_END));

        const html = content.domNode!.innerHTML;
        expect(html).not.toContain('mu-image-marked-text');
        expect(html).toContain('mu-inline-image');
    });

    it('caret right before the token at offset 0 renders the image again', () => {
        const muya = boot(DOC);
        const content = paragraphContent(muya);

        content.update(cursorAt(muya, content, 0, 0));

        const html = content.domNode!.innerHTML;
        expect(html).not.toContain('mu-image-marked-text');
        expect(html).toContain('mu-inline-image');
    });

    it('a selection from outside into the token keeps the source visible', () => {
        const muya = boot(`prose ${DOC}`);
        const content = paragraphContent(muya);
        const end = `prose ${DOC}`.trim().length;

        content.update(cursorAt(muya, content, 2, end));

        expect(content.domNode!.innerHTML).toContain('mu-image-marked-text');
    });
});
