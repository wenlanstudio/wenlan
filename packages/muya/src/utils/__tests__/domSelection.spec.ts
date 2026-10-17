// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { hasTextSelectionIn, isSelectionInReadOnlyIsland } from '../dom';

// Rendered previews (diagram / math / html) are `contenteditable=false`
// islands: the reader can select their text, but the document model has no
// words there. These helpers are what lets a click and a copy respect such a
// selection instead of destroying it — without them a renderer error can be
// read on screen but never copied out.

const hosts: HTMLElement[] = [];

afterEach(() => {
    while (hosts.length)
        hosts.pop()!.remove();
    window.getSelection()?.removeAllRanges();
});

function mount(html: string): HTMLElement {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    hosts.push(host);
    return host;
}

function selectContents(node: Node): void {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
}

function selectNothing(): void {
    window.getSelection()?.removeAllRanges();
}

describe('hasTextSelectionIn', () => {
    it('is false when nothing is selected', () => {
        const host = mount('<div class="mu-diagram-preview"><b>boom</b></div>');

        selectNothing();
        expect(hasTextSelectionIn(host)).toBe(false);
    });

    it('is false for a collapsed caret inside the node', () => {
        const host = mount('<div id="t">boom</div>');
        const text = host.querySelector('#t')!.firstChild!;

        const range = document.createRange();
        range.setStart(text, 2);
        range.collapse(true);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);

        expect(hasTextSelectionIn(host)).toBe(false);
    });

    it('is true when the selection starts inside the node', () => {
        const host = mount('<div class="err">Unknown diagram name matplotlib</div>');

        selectContents(host.querySelector('.err')!);

        expect(hasTextSelectionIn(host)).toBe(true);
        expect(hasTextSelectionIn(host.querySelector('.err')!)).toBe(true);
    });

    it('is false when the selection starts elsewhere', () => {
        const host = mount('<div id="a">alpha</div><div id="b">beta</div>');

        selectContents(host.querySelector('#a')!);

        expect(hasTextSelectionIn(host.querySelector('#b')!)).toBe(false);
    });
});

describe('isSelectionInReadOnlyIsland', () => {
    it('detects a selection inside a contenteditable=false preview', () => {
        const host = mount(`
            <div contenteditable="true">
                <pre class="mu-content">graph TD;</pre>
                <div class="mu-diagram-preview" contenteditable="false">
                    <div class="mu-diagram-error">&lt; Invalid Diagram Code &gt;</div>
                </div>
            </div>
        `);

        selectContents(host.querySelector('.mu-diagram-error')!);

        expect(isSelectionInReadOnlyIsland(host)).toBe(true);
    });

    it('ignores a selection in editable content', () => {
        const host = mount(`
            <div contenteditable="true">
                <pre class="mu-content" contenteditable="true">graph TD;</pre>
            </div>
        `);

        selectContents(host.querySelector('.mu-content')!);

        expect(isSelectionInReadOnlyIsland(host)).toBe(false);
    });

    it('ignores an inline non-editable image inside an editable paragraph', () => {
        // The anchor is the paragraph's text, and walking up reaches the
        // editable block before any `contenteditable=false` wrapper — so a
        // normal copy still goes through the document model.
        const host = mount(`
            <div contenteditable="true">
                <p class="mu-content" contenteditable="true">see <img contenteditable="false"></p>
            </div>
        `);

        selectContents(host.querySelector('p')!);

        expect(isSelectionInReadOnlyIsland(host)).toBe(false);
    });

    it('ignores a selection that starts outside the editor', () => {
        const host = mount('<div contenteditable="true"><p id="p">text</p></div>');
        const outside = document.createElement('div');
        outside.setAttribute('contenteditable', 'false');
        outside.textContent = 'outside';
        document.body.appendChild(outside);
        hosts.push(outside);

        selectContents(outside);

        expect(isSelectionInReadOnlyIsland(host)).toBe(false);
    });

    it('is false when nothing is selected', () => {
        const host = mount('<div contenteditable="true"><p>text</p></div>');

        selectNothing();

        expect(isSelectionInReadOnlyIsland(host)).toBe(false);
    });
});
