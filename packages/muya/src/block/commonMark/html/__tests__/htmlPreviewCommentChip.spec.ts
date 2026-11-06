// @vitest-environment happy-dom

import type Parent from '../../../base/parent';
import { afterEach, describe, expect, it } from 'vitest';
import { Muya } from '../../../../muya';

// Issue #15, first bug: an html block whose source the preview sanitizer
// erases completely (`<!-- test -->`, unknown tags, unclosed comments) used to
// render an empty zero-height preview — invisible, unclickable, unreachable
// by the caret. The block now shows its raw source as a chip, and clicking it
// opens the source editor like any preview content.

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

describe('htmlPreview — sanitizer-erased source renders as a visible chip (#15)', () => {
    it('shows `<!-- test -->` as a chip holding the raw comment', () => {
        const muya = boot('<!-- test -->\n');
        const chip = chipOf(muya);

        expect(chip).not.toBeNull();
        expect(chip!.textContent).toBe('<!-- test -->');
    });

    it('shows an unknown self-closing tag as a chip too', () => {
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

    it('keeps rendering real content through the sanitizer', () => {
        const muya = boot('<p>hello</p>\n');

        expect(chipOf(muya)).toBeNull();
        expect(previewOf(muya).textContent).toContain('hello');
    });

    it('clicking the chip opens the source editor', () => {
        const muya = boot('<!-- test -->\n');

        clickOn(chipOf(muya)!);

        expect(figureOf(muya).classList.contains('mu-active')).toBe(true);
        const firstBlock = muya.editor.scrollPage!.firstChild as unknown as Parent;
        const content = firstBlock.firstContentInDescendant()!;
        expect(content.text).toBe('<!-- test -->');
        expect(content.getCursor()).not.toBeNull();
    });
});
