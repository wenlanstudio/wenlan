// @vitest-environment happy-dom

import type Content from '../../block/base/content';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../muya';

// Guard for #28: a delete inside a code block must start a NEW undo group
// even when it lands within the 1 s coalescing window of the previous edit.
//
// History coalesces on push purely by time (History.delay = 1 s); the only
// thing that splits groups is `history.markInputBoundary()`. Paragraph blocks
// mark it on every input/backspace/delete, but `CodeBlockContent` handlers
// mutate `this.text` directly — the two `preventDefault` backspace paths
// suppress the native input event that would otherwise reach inputHandler, so
// without an explicit boundary call a code-block delete always coalesced into
// the preceding edit and one Ctrl+Z reverted both.
//
// We boot a real Muya so the json1 op / history plumbing matches a live
// keystroke, drive the handlers the way the keydown/input listeners do, and
// assert on the undo stack depth + the post-undo text.

const bootedHosts: HTMLElement[] = [];

beforeEach(() => {
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (bootedHosts.length)
        bootedHosts.pop()!.remove();
    delete (window as Partial<Window>).MUYA_VERSION;
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

function undoDepth(muya: Muya): number {
    // @ts-expect-error — reach into the private stack for test assertions.
    return muya.editor.history._stack.undo.length;
}

function inputEvent(over: Partial<InputEvent> = {}): InputEvent {
    return {
        inputType: 'insertText',
        data: 'x',
        key: 'x',
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        ...over,
    } as unknown as InputEvent;
}

function backspaceEvent(): KeyboardEvent {
    return {
        key: 'Backspace',
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        shiftKey: false,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent;
}

describe('code block edits start their own undo group (#28)', () => {
    it('a \\n backspace right after a typed edit does NOT coalesce into it', async () => {
        const muya = bootMuya('```js\nfoo\nbar\n```\n');
        const content = codeContent(muya);
        muya.editor.activeContentBlock = content;

        // "Type" an x at the end through the real inputHandler: append a text
        // node the way a live keystroke leaves the DOM (appending — NOT
        // reassigning textContent, which drops the nodes holding the native
        // selection, and NOT via setCursor afterwards, which re-renders from
        // state and would wipe the injection).
        const end = content.text.length;
        content.setCursor(end, end, true);
        content.domNode!.appendChild(document.createTextNode('x'));
        content.inputHandler(inputEvent());
        expect(content.text).toBe('foo\nbarx');
        await vi.waitFor(() => expect(undoDepth(muya)).toBe(1));

        // Delete the `\n` right after the insert (within the 1 s window):
        // caret directly after the newline, through the real backspaceHandler.
        content.setCursor(4, 4, true);
        content.backspaceHandler(backspaceEvent());
        expect(content.text).toBe('foobarx');
        await vi.waitFor(() => expect(undoDepth(muya)).toBe(2));

        // One undo must revert ONLY the delete — the typed x survives.
        muya.undo();
        await vi.waitFor(() => {
            expect(codeContent(muya).text).toBe('foo\nbarx');
        });
    });

    it('a token backspace (grapheme path) right after a typed edit does NOT coalesce into it', async () => {
        const muya = bootMuya('```js\nconst a = 1\n// done\n```\n');
        const content = codeContent(muya);
        muya.editor.activeContentBlock = content;

        // Preceding edit through the real inputHandler: x appended at the very
        // end (same appendChild trick as the first test), landing on the last
        // line so the comment token swallows it ('// donex').
        const end = content.text.length;
        content.setCursor(end, end, true);
        content.domNode!.appendChild(document.createTextNode('x'));
        content.inputHandler(inputEvent());
        expect(content.text).toBe('const a = 1\n// donex');
        await vi.waitFor(() => expect(undoDepth(muya)).toBe(1));

        // Caret at the end of the comment token: the prism-token backspace
        // path (walkTokens matches the absolute offset against the token end)
        // removes the last grapheme.
        content.setCursor(content.text.length, content.text.length, true);
        content.backspaceHandler(backspaceEvent());
        expect(content.text).toBe('const a = 1\n// done');
        await vi.waitFor(() => expect(undoDepth(muya)).toBe(2));

        // One undo restores the x; only the delete is reverted.
        muya.undo();
        await vi.waitFor(() => {
            expect(codeContent(muya).text).toBe('const a = 1\n// donex');
        });
    });

    it('an undo/redo input event is ignored by codeBlockContent.inputHandler', () => {
        const muya = bootMuya('```js\nfoo\n```\n');
        const content = codeContent(muya);
        muya.editor.activeContentBlock = content;

        // Native undo/redo input events must neither record an op nor corrupt
        // the boundary state (mirrors the base inputHandler guard).
        content.setCursor(3, 3, true);
        content.inputHandler(inputEvent({ inputType: 'historyUndo', data: null }));

        expect(content.text).toBe('foo');
        expect(undoDepth(muya)).toBe(0);
    });
});
