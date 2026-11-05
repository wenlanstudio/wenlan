// @vitest-environment happy-dom

import type Content from '../../../base/content';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../../../muya';

// issue #1 — three Enters in quick succession split a fenced code block.
//
// This is a KEYSTROKE GESTURE, not a content rule: `\n\n\n` arriving via
// setContent / paste must stay in one block (5294 line-number regression).
// The burst lives on the Content instance, so changing blocks resets it for
// free; typing or moving the caret changes the offset and resets it too.

const bootedHosts: HTMLElement[] = [];
let clock = 0;

beforeEach(() => {
    clock = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
});

afterEach(() => {
    vi.restoreAllMocks();
    while (bootedHosts.length)
        bootedHosts.pop()!.remove();
    document.getSelection()?.removeAllRanges();
});

function bootMuya(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    bootedHosts.push(muya.domNode);
    return muya;
}

function codeContent(muya: Muya): Content {
    let target: Content | null = null;
    const visit = (block: {
        constructor: { blockName?: string };
        children?: { forEach: (cb: (b: unknown) => void) => void };
    }) => {
        if (block.constructor.blockName === 'codeblock.content')
            target = block as unknown as Content;
        block.children?.forEach(b => visit(b as typeof block));
    };
    visit(muya.editor.scrollPage as unknown as Parameters<typeof visit>[0]);
    if (!target)
        throw new Error('codeblock.content block not found');
    return target;
}

function keyEvent(): KeyboardEvent {
    return {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        key: 'Enter',
        shiftKey: false,
    } as unknown as KeyboardEvent;
}

function flush(): Promise<void> {
    return new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}

// Drives the handler exactly as keydownHandler does. `advance` is the gap
// since the previous Enter; the gesture window is 500ms.
function enter(content: Content, advance = 50) {
    clock += advance;
    content.enterHandler(keyEvent());
}

function stateOf(muya: Muya) {
    return muya.getState() as Array<{
        name: string;
        text: string;
        meta?: { lang?: string; type?: string; fenceChar?: string };
    }>;
}

describe('codeBlockContent — triple Enter splits a fenced code block', () => {
    it('splits at the end: head stays, tail becomes an empty sibling', async () => {
        const muya = bootMuya('```js\nhello\n```\n');
        const content = codeContent(muya);
        muya.editor.activeContentBlock = content;
        content.setCursor(content.text.length, content.text.length, true);

        enter(content);
        enter(content);
        enter(content);
        await flush();

        const state = stateOf(muya);
        expect(state.length).toBe(2);
        expect(state[0].name).toBe('code-block');
        expect(state[1].name).toBe('code-block');
        expect(state[0].text).toBe('hello');
        expect(state[1].text).toBe('');
    });

    it('splits mid-text, discarding everything the three Enters inserted', async () => {
        const muya = bootMuya('```js\nhello\n```\n');
        const content = codeContent(muya);
        muya.editor.activeContentBlock = content;
        content.setCursor(2, 2, true);

        enter(content);
        enter(content);
        enter(content);
        await flush();

        const state = stateOf(muya);
        expect(state.length).toBe(2);
        expect(state[0].text).toBe('he');
        expect(state[1].text).toBe('llo');
    });

    it('inherits lang / fence meta into the new block', async () => {
        const muya = bootMuya('```python\nprint(1)\n```\n');
        const content = codeContent(muya);
        muya.editor.activeContentBlock = content;
        content.setCursor(content.text.length, content.text.length, true);

        enter(content);
        enter(content);
        enter(content);
        await flush();

        const state = stateOf(muya);
        expect(state[1].meta?.lang).toBe('python');
        expect(state[1].meta?.type).toBe('fenced');
        expect(state[1].meta?.fenceChar).toBe(state[0].meta?.fenceChar);
    });

    it('lands the caret at offset 0 of the new block', async () => {
        const muya = bootMuya('```js\nhello\n```\n');
        const content = codeContent(muya);
        muya.editor.activeContentBlock = content;
        content.setCursor(content.text.length, content.text.length, true);

        enter(content);
        enter(content);
        enter(content);
        await flush();

        const active = muya.editor.activeContentBlock!;
        expect(active.getCursor()!.start.offset).toBe(0);
        expect(active.text).toBe('');
    });

    it('one undo restores the original single block', async () => {
        const muya = bootMuya('```js\nhello\n```\n');
        const content = codeContent(muya);
        muya.editor.activeContentBlock = content;
        content.setCursor(content.text.length, content.text.length, true);

        enter(content);
        enter(content);
        enter(content);
        await flush();
        expect(stateOf(muya).length).toBe(2);

        muya.editor.history.undo();
        await flush();

        const state = stateOf(muya);
        expect(state.length).toBe(1);
        expect(state[0].text).toBe('hello');
    });
});

describe('codeBlockContent — triple Enter does NOT fire outside the gesture', () => {
    it('one or two Enters still just insert newlines', async () => {
        const muya = bootMuya('```js\nhello\n```\n');
        const content = codeContent(muya);
        muya.editor.activeContentBlock = content;
        content.setCursor(content.text.length, content.text.length, true);

        enter(content);
        enter(content);
        await flush();

        const state = stateOf(muya);
        expect(state.length).toBe(1);
        expect(state[0].text).toBe('hello\n\n');
    });

    it('slow Enters (600ms apart) leave three newlines in one block', async () => {
        const muya = bootMuya('```js\nhello\n```\n');
        const content = codeContent(muya);
        muya.editor.activeContentBlock = content;
        content.setCursor(content.text.length, content.text.length, true);

        enter(content, 600);
        enter(content, 600);
        enter(content, 600);
        await flush();

        const state = stateOf(muya);
        expect(state.length).toBe(1);
        expect(state[0].text).toBe('hello\n\n\n');
    });

    it('resets when the caret moves between Enters', async () => {
        const muya = bootMuya('```js\nhello\n```\n');
        const content = codeContent(muya);
        muya.editor.activeContentBlock = content;
        content.setCursor(content.text.length, content.text.length, true);

        enter(content);
        enter(content);
        content.setCursor(0, 0, true);
        enter(content);
        await flush();

        const state = stateOf(muya);
        expect(state.length).toBe(1);
        expect(state[0].text).toBe('\nhello\n\n');
    });

    it('resets when other text is typed between Enters', async () => {
        const muya = bootMuya('```js\nhello\n```\n');
        const content = codeContent(muya);
        muya.editor.activeContentBlock = content;
        content.setCursor(content.text.length, content.text.length, true);

        enter(content);
        enter(content);
        // Simulate an intervening keystroke: text grows and the caret moves on.
        content.text = `${content.text}x`;
        content.setCursor(content.text.length, content.text.length, true);
        enter(content);
        await flush();

        const state = stateOf(muya);
        expect(state.length).toBe(1);
        expect(state[0].text).toBe('hello\n\nx\n');
    });

    it('resets on Shift+Enter (jump out of the block)', async () => {
        const muya = bootMuya('```js\nhello\n```\n');
        const content = codeContent(muya);
        muya.editor.activeContentBlock = content;
        content.setCursor(content.text.length, content.text.length, true);

        enter(content);
        enter(content);
        content.enterHandler({
            ...keyEvent(),
            shiftKey: true,
        } as unknown as KeyboardEvent);
        await flush();

        // Shift+Enter appends a paragraph; a later Enter in a NEW block starts
        // a fresh burst rather than completing this one.
        expect(stateOf(muya).length).toBe(2);
        expect(stateOf(muya)[0].text).toBe('hello\n\n');
    });

    it('does not split an indented code block (two neighbours cannot be serialized)', async () => {
        const muya = bootMuya('    hello\n');
        const content = codeContent(muya);
        muya.editor.activeContentBlock = content;
        content.setCursor(2, 2, true);

        enter(content);
        enter(content);
        enter(content);
        await flush();

        const state = stateOf(muya);
        expect(state.length).toBe(1);
        expect(state[0].meta?.type).toBe('indented');
        expect(state[0].text).toBe('he\n\n\nllo');
    });

    it('does not split a frontmatter container sharing this Content class', async () => {
        const muya = bootMuya('---\ntitle: x\n---\n\nbody\n');
        const content = codeContent(muya);
        muya.editor.activeContentBlock = content;
        content.setCursor(content.text.length, content.text.length, true);
        const before = stateOf(muya).length;

        enter(content);
        enter(content);
        enter(content);
        await flush();

        expect(stateOf(muya).length).toBe(before);
    });
});
