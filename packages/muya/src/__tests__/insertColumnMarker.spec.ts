// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Muya } from '../muya';

// §4.6 inline insertion: `insertColumnMarker` appends the comment to the
// top-level paragraph at the caret, so the inline renderer draws a trailing
// badge while the export pipeline still reads a top-level token. Outside a
// top-level paragraph (heading / list) it refuses and the caller falls back to
// a standalone block-level paragraph insertion.

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

/** Put the caret at `offset` inside the first content block. */
function caretAtStart(muya: Muya, offset = 0): void {
    const content = muya.editor.scrollPage!.firstContentInDescendant()!;
    muya.editor.activeContentBlock = content;
    content.setCursor(offset, offset, true);
}

describe('insertColumnMarker (§4.6)', () => {
    it('appends the comment to the paragraph at the caret', () => {
        const muya = boot('正文');
        caretAtStart(muya, 2);

        expect(muya.insertColumnMarker('<!-- split -->')).toBe(true);
        muya.flush();
        expect(muya.getMarkdown()).toContain('正文\n<!-- split -->');
    });

    it('puts the caret back before the marker so typing keeps its own line', () => {
        const muya = boot('正文');
        caretAtStart(muya, 2);

        muya.insertColumnMarker('<!-- split -->');

        const cursor = muya.editor.activeContentBlock!.getCursor()!;
        expect(cursor.start.offset).toBe(2);
        expect(cursor.end.offset).toBe(2);
    });

    it('handles an empty paragraph (marker owns the whole block)', () => {
        const muya = boot('');
        caretAtStart(muya);

        expect(muya.insertColumnMarker('<!-- begin -->')).toBe(true);
        muya.flush();
        expect(muya.getMarkdown().trim()).toBe('<!-- begin -->');
    });

    it('refuses when the caret is inside a heading', () => {
        const muya = boot('## 标题');
        caretAtStart(muya);
        const before = muya.getMarkdown();

        expect(muya.insertColumnMarker('<!-- begin -->')).toBe(false);
        muya.flush();
        expect(muya.getMarkdown()).toBe(before);
    });

    it('refuses when the caret is inside a list item (not top level, §1.3 #7)', () => {
        const muya = boot('- 项目');
        caretAtStart(muya);
        const before = muya.getMarkdown();

        expect(muya.insertColumnMarker('<!-- split -->')).toBe(false);
        muya.flush();
        expect(muya.getMarkdown()).toBe(before);
    });
});
