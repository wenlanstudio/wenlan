// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { Muya } from '../../muya';

// Issue #5: a rendered HTML block (<details>…</details>) cannot be deleted
// from the WYSIWYG view. The preview island is contenteditable=false and its
// innerHTML children carry no block property, so the selection gate in
// Editor._dispatchEvents swallows Backspace/Delete. Desktop does not register
// PreviewToolBar, which is the only other delete entry point.

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

const DOC = '<details><summary>答案</summary>**B**。</details>\n';

function press(target: Element, key: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
}

// The block tree updates synchronously but jsonState batches ops until the
// next animation frame, so getState()/getMarkdown() lag one frame behind.
function flush(): Promise<void> {
    return new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}

function stateOf(muya: Muya) {
    return muya.getState() as Array<{ name: string; text?: string }>;
}

/** The click target in a real browser is the focusable <summary> element. */
function summaryOf(muya: Muya): HTMLElement {
    const el = muya.domNode.querySelector<HTMLElement>('.mu-html-preview summary');
    if (!el)
        throw new Error('preview summary not found');
    return el;
}

describe('editor — delete a rendered HTML block from the preview island', () => {
    it('backspace replaces the whole block with an empty paragraph', async () => {
        const muya = boot(DOC);
        const event = press(summaryOf(muya), 'Backspace');
        await flush();

        expect(event.defaultPrevented).toBe(true);
        const state = stateOf(muya);
        expect(state).toHaveLength(1);
        expect(state[0].name).toBe('paragraph');
        expect(state[0].text).toBe('');
        expect(muya.getMarkdown()).not.toContain('<details>');
    });

    it('delete does the same', async () => {
        const muya = boot(DOC);
        press(summaryOf(muya), 'Delete');
        await flush();

        expect(stateOf(muya)[0].name).toBe('paragraph');
        expect(muya.getMarkdown()).not.toContain('<details>');
    });

    it('puts the caret at offset 0 of the new paragraph', () => {
        const muya = boot(DOC);
        press(summaryOf(muya), 'Backspace');

        const active = muya.editor.activeContentBlock;
        expect(active?.getCursor()?.start.offset).toBe(0);
        expect(active?.text).toBe('');
    });

    it('does not fire for other keys (Enter)', async () => {
        const muya = boot(DOC);
        press(summaryOf(muya), 'Enter');
        await flush();

        expect(stateOf(muya)[0].name).toBe('html-block');
    });

    it('does not delete while the block is active (source editor has a real caret)', async () => {
        // A pagebreak marker renders a badge; clicking it activates the source
        // editor and moves the caret to the END of the source. This mirrors the
        // real browser, where an active block shows source instead of preview.
        const muya = boot('<!-- pagebreak -->\n');
        const badge = muya.domNode.querySelector<HTMLElement>('.mu-html-preview .mu-mdcols-marker')!;
        badge.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        const figure = muya.domNode.querySelector<HTMLElement>('figure.mu-html-block')!;
        expect(figure.classList.contains('mu-active')).toBe(true);

        // Even if the keydown still originates inside the preview island, the
        // active block must go through normal source editing, not deletion.
        press(badge, 'Backspace');
        await flush();

        expect(stateOf(muya)[0].name).toBe('html-block');
        expect(muya.getMarkdown()).toContain('pagebreak');
    });

    it('one undo restores the original HTML block', async () => {
        const muya = boot(DOC);
        press(summaryOf(muya), 'Backspace');
        await flush();
        expect(stateOf(muya)[0].name).toBe('paragraph');

        muya.undo();
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

        expect(stateOf(muya)[0].name).toBe('html-block');
        expect(muya.getMarkdown()).toContain('<details>');
    });
});
