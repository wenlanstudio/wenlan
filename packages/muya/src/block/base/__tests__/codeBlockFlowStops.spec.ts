// @vitest-environment happy-dom

import type Content from '../content';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Muya } from '../../../muya';

// Code-block arrow-key stops follow the visual flow (Typora semantics): the
// block has two stops, the code body and its bottom-right language input, and
// the travel direction orders them — downward = body → language input,
// upward = language input → body. Both directions put the language input at
// the screen-edge stop, where it visually sits. happy-dom gives a collapsed
// caret no client rects, so arrowHandler takes every caret for a block edge —
// the same assumption the codeBlockContent arrowHandler spec relies on.

const MD = 'before\n\n```python\nline1\nline2\n```\n\nafter\n';
const MD_ADJACENT = '```\na\n```\n\n```js\nb\n```\n';

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

type Blocks = {
    before: Content;
    langInput: Content;
    body: Content;
    after: Content;
};

function boot(markdown: string): { muya: Muya; blocks: Blocks } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    bootedHosts.push(muya.domNode);

    const found: Partial<Blocks> & { bodies: Content[]; langInputs: Content[] } = {
        bodies: [],
        langInputs: [],
    };
    const visit = (block: {
        constructor: { blockName?: string };
        text?: string;
        children?: { forEach: (cb: (b: unknown) => void) => void };
    }) => {
        const name = block.constructor.blockName;
        if (name === 'paragraph.content') {
            if (block.text === 'before')
                found.before = block as unknown as Content;
            if (block.text === 'after')
                found.after = block as unknown as Content;
        }
        else if (name === 'language-input') {
            found.langInputs.push(block as unknown as Content);
        }
        else if (name === 'codeblock.content') {
            found.bodies.push(block as unknown as Content);
        }
        block.children?.forEach(b => visit(b as typeof block));
    };
    visit(muya.editor.scrollPage as unknown as Parameters<typeof visit>[0]);

    if (!found.before || !found.after || found.bodies.length !== 1 || found.langInputs.length !== 1)
        throw new Error(`fixture blocks not found: ${JSON.stringify({ ...found, bodies: found.bodies.length, langInputs: found.langInputs.length })}`);

    return {
        muya,
        blocks: {
            before: found.before,
            langInput: found.langInputs[0],
            body: found.bodies[0],
            after: found.after,
        },
    };
}

function pressArrow(content: Content, key: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    content.arrowHandler(event);
    return event;
}

function expectCaret(muya: Muya, target: Content, offset: number) {
    expect(muya.editor.activeContentBlock).toBe(target);
    expect(target.getCursor()?.start.offset).toBe(offset);
}

describe('code block flow stops — downward = body → language input', () => {
    it('entering from above stops at the body, not the language input', () => {
        const { muya, blocks } = boot(MD);
        blocks.before.setCursor(6, 6, true);

        expect(pressArrow(blocks.before, 'ArrowDown').defaultPrevented).toBe(true);
        expectCaret(muya, blocks.body, 0);
    });

    it('the body hands over to the language input before leaving', () => {
        const { muya, blocks } = boot(MD);
        blocks.body.setCursor(11, 11, true);

        expect(pressArrow(blocks.body, 'ArrowDown').defaultPrevented).toBe(true);
        expectCaret(muya, blocks.langInput, 0);
    });

    it('the language input is the exit stop', () => {
        const { muya, blocks } = boot(MD);
        blocks.langInput.setCursor(0, 0, true);

        expect(pressArrow(blocks.langInput, 'ArrowDown').defaultPrevented).toBe(true);
        expectCaret(muya, blocks.after, 0);
    });
});

describe('code block flow stops — upward = language input → body', () => {
    it('entering from below stops at the language input first', () => {
        const { muya, blocks } = boot(MD);
        blocks.after.setCursor(0, 0, true);

        expect(pressArrow(blocks.after, 'ArrowUp').defaultPrevented).toBe(true);
        expectCaret(muya, blocks.langInput, blocks.langInput.text.length);
    });

    it('the language input folds back into the body', () => {
        const { muya, blocks } = boot(MD);
        blocks.langInput.setCursor(2, 2, true);

        expect(pressArrow(blocks.langInput, 'ArrowUp').defaultPrevented).toBe(true);
        expectCaret(muya, blocks.body, blocks.body.text.length);
    });

    it('the body is the exit stop upward', () => {
        const { muya, blocks } = boot(MD);
        blocks.body.setCursor(0, 0, true);

        expect(pressArrow(blocks.body, 'ArrowUp').defaultPrevented).toBe(true);
        expectCaret(muya, blocks.before, blocks.before.text.length);
    });
});

describe('horizontal boundary keys share the same stop order', () => {
    it('ArrowRight at the body end stops at the language input', () => {
        const { muya, blocks } = boot(MD);
        blocks.body.setCursor(11, 11, true);

        expect(pressArrow(blocks.body, 'ArrowRight').defaultPrevented).toBe(true);
        expectCaret(muya, blocks.langInput, 0);
    });

    it('ArrowLeft in the language input returns to the body end', () => {
        const { muya, blocks } = boot(MD);
        blocks.langInput.setCursor(0, 0, true);

        expect(pressArrow(blocks.langInput, 'ArrowLeft').defaultPrevented).toBe(true);
        expectCaret(muya, blocks.body, blocks.body.text.length);
    });

    it('ArrowLeft at the body start leaves the block upward', () => {
        const { muya, blocks } = boot(MD);
        blocks.body.setCursor(0, 0, true);

        expect(pressArrow(blocks.body, 'ArrowLeft').defaultPrevented).toBe(true);
        expectCaret(muya, blocks.before, blocks.before.text.length);
    });
});

describe('adjacent code blocks chain through the stops', () => {
    function bootAdjacent() {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const muya = new Muya(host, { markdown: MD_ADJACENT } as ConstructorParameters<typeof Muya>[1]);
        muya.init();
        bootedHosts.push(muya.domNode);

        const bodies: Content[] = [];
        const langInputs: Content[] = [];
        const visit = (block: {
            constructor: { blockName?: string };
            children?: { forEach: (cb: (b: unknown) => void) => void };
        }) => {
            const name = block.constructor.blockName;
            if (name === 'language-input')
                langInputs.push(block as unknown as Content);
            else if (name === 'codeblock.content')
                bodies.push(block as unknown as Content);
            block.children?.forEach(b => visit(b as typeof block));
        };
        visit(muya.editor.scrollPage as unknown as Parameters<typeof visit>[0]);
        if (bodies.length !== 2 || langInputs.length !== 2)
            throw new Error('adjacent fixture blocks not found');
        return { muya, aBody: bodies[0], aLang: langInputs[0], bBody: bodies[1], bLang: langInputs[1] };
    }

    it('leaving downward enters the next block at its body', () => {
        const { muya, aBody, aLang, bBody } = bootAdjacent();
        aBody.setCursor(1, 1, true);
        pressArrow(aBody, 'ArrowDown');
        expect(muya.editor.activeContentBlock).toBe(aLang);

        pressArrow(aLang, 'ArrowDown');
        expect(muya.editor.activeContentBlock).toBe(bBody);
    });

    it('leaving upward enters the previous block at its language input', () => {
        const { muya, aLang, bBody } = bootAdjacent();
        bBody.setCursor(0, 0, true);
        pressArrow(bBody, 'ArrowUp');
        expect(muya.editor.activeContentBlock).toBe(aLang);
    });
});

describe('tree-order primitives keep their old behavior', () => {
    it('nextContentInContext still skips the language input; previous still hits it', () => {
        const { blocks } = boot(MD);
        expect(blocks.body.nextContentInContext()).toBe(blocks.after);
        expect(blocks.body.previousContentInContext()).toBe(blocks.langInput);
        expect(blocks.before.nextContentInContext()).toBe(blocks.langInput);
    });
});
