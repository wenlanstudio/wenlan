// @vitest-environment happy-dom

import type Content from '../../../base/content';
import type Format from '../../../base/format';
import type Parent from '../../../base/parent';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../../../muya';

// #15 — `---` alone on the document's first block is the front-matter fence.
//
// Two coupled behaviors: the input-time thematic-break conversion must HOLD
// while the first paragraph is exactly `---` (otherwise the paragraph turns
// into a horizontal rule before Enter ever fires), and Enter must then turn
// it into front matter. Everywhere else `---` keeps converting to a thematic
// break exactly as before.
//
// The in-session shapes are built by assigning `.text` directly — a loaded
// document can never contain a top-level `---` paragraph (the parser reads it
// as a horizontal rule), so only typing can produce the fence situation the
// issue describes.

const bootedHosts: HTMLElement[] = [];
let originalVersion: string | undefined;
let hadVersion = false;

beforeEach(() => {
    hadVersion = 'MUYA_VERSION' in window;
    originalVersion = window.MUYA_VERSION;
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (bootedHosts.length) {
        const host = bootedHosts.pop()!;
        host.remove();
    }
    document.getSelection()?.removeAllRanges();
    if (hadVersion)
        window.MUYA_VERSION = originalVersion as string;
    else
        delete (window as Partial<Window>).MUYA_VERSION;
});

function bootMuya(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    bootedHosts.push(muya.domNode);
    return muya;
}

function contentByText(muya: Muya, text: string): Content {
    let target: Content | null = null;
    const visit = (block: {
        text?: string;
        constructor: { blockName?: string };
        children?: { forEach: (cb: (b: unknown) => void) => void };
    }) => {
        if (block.constructor.blockName?.endsWith('.content') && block.text === text)
            target = block as unknown as Content;
        block.children?.forEach(b => visit(b as typeof block));
    };
    visit(muya.editor.scrollPage as unknown as Parameters<typeof visit>[0]);
    if (!target)
        throw new Error(`content block with text "${text}" not found`);
    return target;
}

function firstParagraphContent(muya: Muya): Content {
    const paragraph = muya.editor.scrollPage!.firstChild as unknown as Parent;
    return paragraph.firstContentInDescendant()!;
}

function flush(): Promise<void> {
    return new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}

function stateNames(state: ReturnType<Muya['getState']>): string[] {
    return state.map(block => block.name);
}

function pressEnterAtEnd(muya: Muya, content: Content): void {
    muya.editor.activeContentBlock = content;
    const offset = content.text.length;
    content.setCursor(offset, offset, true);
    const event = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        key: 'Enter',
    } as unknown as KeyboardEvent;
    content.enterHandler(event);
}

describe('enter on a top-of-document `---` paragraph becomes front matter (#15)', () => {
    it('replaces the first paragraph with a frontmatter block', async () => {
        const muya = bootMuya('body text\n');
        const first = firstParagraphContent(muya);
        first.text = '---';

        pressEnterAtEnd(muya, first);

        await flush();
        const state = muya.getState();
        expect(stateNames(state)).toEqual(['frontmatter']);
        expect(state[0]).toMatchObject({ name: 'frontmatter' });
        // The `---` paragraph is consumed — nothing re-serializes it as an hr.
        expect(muya.getMarkdown()).not.toContain('body text');
    });

    it('lands the caret inside the frontmatter block', async () => {
        const muya = bootMuya('body text\n');
        const first = firstParagraphContent(muya);
        first.text = '---';

        pressEnterAtEnd(muya, first);

        await flush();
        const frontmatter = muya.editor.scrollPage!.firstChild as unknown as Parent;
        const content = frontmatter.firstContentInDescendant()!;
        const cursor = content.getCursor();
        expect(cursor).not.toBeNull();
        expect(cursor!.start.offset).toBe(0);
    });

    it('keeps the rest of the document below the new frontmatter', async () => {
        const muya = bootMuya('one\n\ntwo\n');
        const first = firstParagraphContent(muya);
        first.text = '---';

        pressEnterAtEnd(muya, first);

        await flush();
        const state = muya.getState();
        expect(stateNames(state)).toEqual(['frontmatter', 'paragraph']);
        expect((state[1] as { text: string }).text).toBe('two');
    });
});

describe('the thematic-break conversion yields to the front-matter fence (#15)', () => {
    // Real typing always carries a caret; place one before driving the
    // conversion the way inputHandler would.
    function typeInto(muya: Muya, content: Content, text: string): Format {
        muya.editor.activeContentBlock = content;
        content.text = text;
        content.setCursor(text.length, text.length, true);
        return content as unknown as Format;
    }

    it('holds the conversion while the first paragraph is exactly `---`', async () => {
        const muya = bootMuya('body text\n');
        const first = firstParagraphContent(muya);
        typeInto(muya, first, '---').checkInlineUpdate();
        await flush();

        expect(stateNames(muya.getState())).toEqual(['paragraph']);
    });

    it('still converts to a thematic break for `----` at the top', async () => {
        const muya = bootMuya('body text\n');
        const first = firstParagraphContent(muya);
        typeInto(muya, first, '----').checkInlineUpdate();
        await flush();

        expect(stateNames(muya.getState())).toEqual(['thematic-break']);
    });

    it('still converts to a thematic break once front matter occupies the top', async () => {
        const muya = bootMuya('---\ntitle: t\n---\n\nbody\n');
        const body = contentByText(muya, 'body');
        typeInto(muya, body, '---').checkInlineUpdate();
        await flush();

        expect(stateNames(muya.getState())).toEqual(['frontmatter', 'thematic-break']);
    });

    it('still converts to a thematic break below the first block', async () => {
        const muya = bootMuya('alpha\n\nbeta\n');
        const beta = contentByText(muya, 'beta');
        typeInto(muya, beta, '---').checkInlineUpdate();
        await flush();

        expect(stateNames(muya.getState())).toEqual(['paragraph', 'thematic-break']);
    });
});
