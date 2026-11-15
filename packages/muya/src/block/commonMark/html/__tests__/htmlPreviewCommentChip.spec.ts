// @vitest-environment happy-dom

import type Parent from '../../../base/parent';
import { afterEach, describe, expect, it } from 'vitest';
import { Muya } from '../../../../muya';
import { isPlainCommentHtml } from '../index';

// Issue #15 originally patched the symptom: a comment-only html block has no
// rendered form, so its preview was a zero-height hole. The patch painted the
// raw source as a chip inside that preview — which kept the preview/source
// two-state model and its `mu-active` layout jump (the caret entered a 0×0
// absolutely positioned container and selection-change scroll-follow jumped).
//
// The structural fix: such a block IS its source. `HTMLBlock.create()` builds
// only the editable code leaf, inline and permanently visible. No preview, no
// chip, no activation, no container. Only sanitizer-erased NON-comment html
// still falls back to the chip.

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

function previewOf(muya: Muya, index = 0): HTMLElement {
    return muya.domNode.querySelectorAll<HTMLElement>('.mu-html-preview')[index]!;
}

function figureOf(muya: Muya, index = 0): HTMLElement {
    return muya.domNode.querySelectorAll<HTMLElement>('figure.mu-html-block')[index]!;
}

function chipOf(muya: Muya, index = 0): HTMLElement | null {
    return previewOf(muya, index).querySelector<HTMLElement>('.mu-html-comment');
}

function clickOn(el: Element): MouseEvent {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    el.dispatchEvent(event);
    return event;
}

describe('isPlainCommentHtml — rendering strategy comes from the source, not the DOM', () => {
    it('recognises quiz comments and ordinary comments', () => {
        expect(isPlainCommentHtml('<!--quiz {"answer":"B","limit":30}-->')).toBe(true);
        expect(isPlainCommentHtml('<!-- test -->\n')).toBe(true);
        expect(isPlainCommentHtml('<!-- a -->\n<!-- b -->')).toBe(true);
    });

    it('keeps functional markers on the badge/preview path', () => {
        expect(isPlainCommentHtml('<!-- begin 50:50 -->')).toBe(false);
        expect(isPlainCommentHtml('<!-- split -->')).toBe(false);
        expect(isPlainCommentHtml('<!-- pagebreak -->')).toBe(false);
    });

    it('does not claim html with real content', () => {
        expect(isPlainCommentHtml('<div><!-- c --></div>')).toBe(false);
        expect(isPlainCommentHtml('<p>x</p>')).toBe(false);
        expect(isPlainCommentHtml('<!-- c --><p>x</p>')).toBe(false);
    });
});

describe('htmlBlock — a comment-only block has one inline editable source', () => {
    it('renders `<!-- test -->` without a preview, a chip or an activation state', () => {
        const muya = boot('<!-- test -->\n');
        const figure = figureOf(muya);

        expect(figure.classList.contains('mu-html-plain')).toBe(true);
        expect(muya.domNode.querySelector('.mu-html-preview')).toBeNull();
        expect(figure.querySelector('.mu-html-container')).not.toBeNull();
        // The visible source is exactly the comment — no Prism token span
        // duplicating it, no chip, no preview island.
        expect(figure.querySelector('.mu-html-container')!.textContent).toBe('<!-- test -->');
        expect(figure.querySelector('.token')).toBeNull();
        expect(figure.classList.contains('mu-active')).toBe(false);
    });

    it('keeps the html-block state and the markdown byte-for-byte', () => {
        const muya = boot('<!--quiz {"answer":"B","limit":30}-->\n');
        const state = muya.getState() as Array<{ name: string; text: string }>;

        expect(state.length).toBe(1);
        expect(state[0].name).toBe('html-block');
        expect(state[0].text).toBe('<!--quiz {"answer":"B","limit":30}-->');
        expect(muya.getMarkdown()).toContain('<!--quiz {"answer":"B","limit":30}-->');
    });

    it('accepts the caret directly — no click-to-activate source editor', () => {
        const muya = boot('<!-- test -->\n');
        const firstBlock = muya.editor.scrollPage!.firstChild as unknown as Parent;
        const content = firstBlock.firstContentInDescendant()!;

        content.setCursor(content.text.length, content.text.length, true);

        expect(content.text).toBe('<!-- test -->');
        expect(content.getCursor()).not.toBeNull();
        expect(figureOf(muya).querySelector('.mu-html-preview')).toBeNull();
    });

    it('still shows an unknown self-closing tag as a chip', () => {
        const muya = boot('<abc src=""/>\n');
        const chip = chipOf(muya);

        expect(chip).not.toBeNull();
        expect(chip!.textContent).toBe('<abc src=""/>');
    });

    it('keeps marker badges as badges — a begin marker is not a plain comment', () => {
        const muya = boot('<!-- begin 50:50 -->\n\nleft\n\n<!-- end -->\n');
        const beginPreview = previewOf(muya, 0);

        expect(chipOf(muya, 0)).toBeNull();
        expect(beginPreview.querySelector('.mu-mdcols-marker')).not.toBeNull();
    });

    it('keeps the pagebreak badge for paper pagination', () => {
        const muya = boot('<!-- pagebreak -->\n');

        expect(previewOf(muya).querySelector('.mu-mdcols-pagebreak')).not.toBeNull();
    });

    it('keeps rendering real content through the sanitizer', () => {
        const muya = boot('<p>hello</p>\n');

        expect(chipOf(muya)).toBeNull();
        expect(previewOf(muya).textContent).toContain('hello');
    });

    it('clicking a chip still opens the source editor for non-comment html', () => {
        const muya = boot('<abc src=""/>\n');

        clickOn(chipOf(muya)!);

        expect(figureOf(muya).classList.contains('mu-active')).toBe(true);
        const firstBlock = muya.editor.scrollPage!.firstChild as unknown as Parent;
        const content = firstBlock.firstContentInDescendant()!;
        expect(content.text).toBe('<abc src=""/>');
        expect(content.getCursor()).not.toBeNull();
    });
});
