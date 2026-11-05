// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { Muya } from '../../../../muya';

// Issue #5, second half: a rendered HTML block must be reachable for editing.
// Typora's contract for `<details><summary>答案</summary>…</details>`:
//   - clicking the block-level <summary> (or the collapsed block) toggles it;
//   - clicking the exposed content opens the WHOLE <details> source for editing.
// The preview island is contenteditable=false, so without a delegated click
// handler no caret ever reaches the html-container source block.
//
// happy-dom's sanitizer drops the <details> wrapper from the preview markup,
// so the preview subtree is built with createElement here. Real browser
// rendering (and native <details> toggling) is covered by the Playwright spec
// `html-preview-source-edit-5.spec.ts`.

const bootedHosts: HTMLElement[] = [];

afterEach(() => {
    while (bootedHosts.length)
        bootedHosts.pop()!.remove();
    document.getSelection()?.removeAllRanges();
});

function boot(markdown: string, extra: Record<string, unknown> = {}): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, {
        markdown,
        ...extra,
    } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    bootedHosts.push(muya.domNode);
    return muya;
}

const DETAILS_DOC
    = '<details><summary>答案</summary>**B**。误差出现不依赖缓冲区容量。</details>\n';

function clickOn(el: Element | null): MouseEvent {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    el!.dispatchEvent(event);
    return event;
}

function figureOf(muya: Muya): HTMLElement {
    return muya.domNode.querySelector<HTMLElement>('figure.mu-html-block')!;
}

function previewOf(muya: Muya): HTMLElement {
    return muya.domNode.querySelector<HTMLElement>('.mu-html-preview')!;
}

function isActive(muya: Muya): boolean {
    return figureOf(muya).classList.contains('mu-active');
}

function replacePreview(muya: Muya, ...nodes: Node[]): void {
    const preview = previewOf(muya);
    preview.innerHTML = '';
    preview.append(...nodes);
}

/** A <details> whose exposed content is a bare text node (the real-world case). */
function detailsBlock(muya: Muya, open: boolean): HTMLElement {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = '答案';
    details.append(summary, document.createTextNode('**B**。'));
    if (open)
        details.setAttribute('open', '');
    replacePreview(muya, details);
    return details;
}

describe('htmlPreview — click the rendered HTML to edit its source (#5)', () => {
    it('clicking the collapsed <summary> keeps the native toggle', () => {
        const muya = boot(DETAILS_DOC);
        const summary = previewOf(muya).querySelector<HTMLElement>('summary')!;

        clickOn(summary);

        expect(isActive(muya)).toBe(false);
    });

    it('clicking the collapsed block itself also keeps the native toggle', () => {
        const muya = boot(DETAILS_DOC);
        const details = detailsBlock(muya, false);
        expect(details.hasAttribute('open')).toBe(false);

        clickOn(details);

        expect(isActive(muya)).toBe(false);
    });

    it('clicking the exposed content opens the source editor', () => {
        const muya = boot(DETAILS_DOC);
        const details = detailsBlock(muya, true);

        const event = clickOn(details);

        // mu-active makes CSS hide the preview and reveal .mu-html-container.
        expect(isActive(muya)).toBe(true);
        expect(event.defaultPrevented).toBe(true);
    });

    it('puts the caret in the block that holds the WHOLE <details> source', () => {
        const muya = boot(DETAILS_DOC);
        clickOn(detailsBlock(muya, true));
        expect(isActive(muya)).toBe(true);

        const selection = muya.editor.selection.getSelection();
        expect(selection).not.toBeNull();
        expect(selection!.anchor.block.text).toContain('<details>');
        expect(selection!.anchor.block.text).toContain('</details>');
        expect(muya.getMarkdown()).toContain('<details><summary>答案</summary>');
    });

    it('a nested element inside the exposed content also opens the source', () => {
        const muya = boot(DETAILS_DOC);
        const details = detailsBlock(muya, true);
        const paragraph = document.createElement('p');
        paragraph.textContent = '正文';
        details.append(paragraph);

        clickOn(paragraph);

        expect(isActive(muya)).toBe(true);
    });

    it('clicking plain rendered content of a non-details block opens the source', () => {
        const muya = boot('<div>hello</div>\n');
        const div = document.createElement('div');
        div.textContent = 'hello';
        replacePreview(muya, div);

        clickOn(div);

        expect(isActive(muya)).toBe(true);
    });

    it('clicking a link keeps link semantics instead of editing', () => {
        const muya = boot('<div><a href="https://example.com">link</a></div>\n');
        const div = document.createElement('div');
        const anchor = document.createElement('a');
        anchor.setAttribute('href', 'https://example.com');
        anchor.textContent = 'link';
        div.append(anchor);
        replacePreview(muya, div);

        clickOn(anchor);

        expect(isActive(muya)).toBe(false);
    });

    it('read-only projections never enter source editing', () => {
        const muya = boot(DETAILS_DOC, { readOnly: true });

        clickOn(detailsBlock(muya, true));

        expect(isActive(muya)).toBe(false);
    });

    it('the block-level marker badge still opens the source', () => {
        const muya = boot('<!-- pagebreak -->\n');
        const badge = previewOf(muya).querySelector<HTMLElement>('.mu-mdcols-marker')!;

        clickOn(badge);

        expect(isActive(muya)).toBe(true);
    });
});
