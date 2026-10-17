// @vitest-environment happy-dom
import type { Muya } from '../../muya';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The clipboard module pulls in CodeBlockContent → utils/prism which touches
// `window` at import time. Stub the prism shim so the test can run under Node.
vi.mock('../../utils/prism/index', () => ({
    default: {},
    walkTokens: () => null,
    loadedLanguages: new Set(),
    transformAliasToOrigin: (s: string) => s,
    loadLanguage: () => null,
    search: () => [],
}));

const ClipboardModule = await import('../index');
const Clipboard = ClipboardModule.default;

// A rendered preview — say the error a broken diagram leaves behind — is a
// `contenteditable=false` island inside the editable document. The reader can
// select its text, but muya's document model has no blocks there, so filling
// the clipboard from the model writes nothing and the reader gets an empty
// paste. Muya must leave such a copy to the browser.

const hosts: HTMLElement[] = [];

afterEach(() => {
    while (hosts.length)
        hosts.pop()!.remove();
    window.getSelection()?.removeAllRanges();
    vi.restoreAllMocks();
});

function makeEditor(): HTMLElement {
    const root = document.createElement('div');
    root.setAttribute('contenteditable', 'true');
    root.innerHTML = `
        <pre class="mu-content" contenteditable="true">\`\`\`mermaid
graph TD; A--&gt;B</pre>
        <div class="mu-diagram-preview" contenteditable="false">
            <div class="mu-diagram-error">&lt; Invalid Diagram Code &gt;</div>
            <div class="mu-diagram-error-detail">Unknown diagram name matplotlib</div>
        </div>
    `;
    document.body.appendChild(root);
    hosts.push(root);
    return root;
}

function makeClipboard(root: HTMLElement, focused = true) {
    const muya = {
        domNode: root,
        hasFocus: () => focused,
    } as unknown as Muya;
    const clipboard = new Clipboard(muya);
    clipboard.copyHandler = vi.fn();
    clipboard.cutHandler = vi.fn();
    return clipboard;
}

function makeEvent(type: 'copy' | 'cut') {
    return {
        type,
        clipboardData: { setData: vi.fn() },
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
    } as unknown as ClipboardEvent;
}

function select(node: Node): void {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
}

describe('clipboard — copying out of a rendered preview', () => {
    it('reports a selection inside the preview', () => {
        const root = makeEditor();
        const clipboard = makeClipboard(root);

        select(root.querySelector('.mu-diagram-error-detail')!);

        expect(clipboard.isSelectionInPreview()).toBe(true);
    });

    it('does not report a selection in editable content', () => {
        const root = makeEditor();
        const clipboard = makeClipboard(root);

        select(root.querySelector('.mu-content')!);

        expect(clipboard.isSelectionInPreview()).toBe(false);
    });

    it('leaves a copy of the preview text to the browser', () => {
        const root = makeEditor();
        const clipboard = makeClipboard(root);
        select(root.querySelector('.mu-diagram-error-detail')!);

        const event = makeEvent('copy');
        clipboard.copyCutHandler(event);

        // No `preventDefault`, so the browser copies the highlighted error —
        // and muya's own writer never runs, because it has nothing to write.
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(clipboard.copyHandler).not.toHaveBeenCalled();
        expect(clipboard.cutHandler).not.toHaveBeenCalled();
        expect(window.getSelection()!.toString()).toContain('Unknown diagram name matplotlib');
    });

    it('still copies the document when the selection is editable', () => {
        const root = makeEditor();
        const clipboard = makeClipboard(root);
        select(root.querySelector('.mu-content')!);

        const event = makeEvent('copy');
        clipboard.copyCutHandler(event);

        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(clipboard.copyHandler).toHaveBeenCalledTimes(1);
    });

    it('copies but does not delete read-only content on cut', () => {
        const root = makeEditor();
        const clipboard = makeClipboard(root);
        select(root.querySelector('.mu-diagram-error-detail')!);
        // happy-dom ships no `execCommand`; Electron/Chromium does, and the
        // rest of this module already relies on it for "copy as …".
        const execCommand = vi.fn();
        Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });

        const event = makeEvent('cut');
        clipboard.copyCutHandler(event);

        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(execCommand).toHaveBeenCalledWith('copy');
        // Cutting must never reach the model: there is nothing there to remove.
        expect(clipboard.cutHandler).not.toHaveBeenCalled();
    });

    it('ignores the event when the editor does not have focus', () => {
        const root = makeEditor();
        const clipboard = makeClipboard(root, false);
        select(root.querySelector('.mu-diagram-error-detail')!);

        const event = makeEvent('copy');
        clipboard.copyCutHandler(event);

        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(clipboard.copyHandler).not.toHaveBeenCalled();
    });
});
