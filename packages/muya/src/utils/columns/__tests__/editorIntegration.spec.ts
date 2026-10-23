// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Muya } from '../../../muya';
import { applyEditorColumns, revertEditorColumns } from '../editorLayout';

// The desktop Columns view boots a real (read-only) Muya and regroups the
// engine's `.mu-container` — the node that actually holds the top-level blocks.
// `.mu-editor` is only its parent, so grouping `.mu-editor` yields nothing.
// These specs pin that contract against the live engine instead of a fixture.
const DOC = [
    '# Title',
    '',
    '<!-- begin -->',
    '',
    'Column A',
    '',
    '<!-- split -->',
    '',
    'Column B',
    '',
    '<!-- end -->',
    '',
    'Tail paragraph.',
    '',
].join('\n');

const hosts: HTMLElement[] = [];

beforeEach(() => {
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (hosts.length)
        hosts.pop()!.remove();
});

function bootMuya(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    hosts.push(muya.domNode);
    return muya;
}

function containerOf(muya: Muya): HTMLElement {
    return muya.domNode.querySelector<HTMLElement>('.mu-container')!;
}

describe('columns on a live editor', () => {
    it('init() renders the top-level blocks into .mu-container', () => {
        const muya = bootMuya(DOC);
        const container = containerOf(muya);

        expect(container).toBeTruthy();
        expect(container.parentElement?.classList.contains('mu-editor')).toBe(true);
        expect(container.children.length).toBeGreaterThan(0);
    });

    it('groups the markers into columns and keeps the rest in flow', () => {
        const muya = bootMuya(DOC);
        const container = containerOf(muya);

        applyEditorColumns(container);

        expect(container.querySelectorAll('.mu-mdcols-group')).toHaveLength(1);
        const cols = [...container.querySelectorAll('.mu-mdcols-col')];
        expect(cols).toHaveLength(2);
        expect(cols[0].textContent).toContain('Column A');
        expect(cols[1].textContent).toContain('Column B');

        const outside = [...container.children]
            .filter((el) => !el.classList.contains('mu-mdcols-group'))
            .map((el) => el.textContent ?? '')
            .join(' | ');
        expect(outside).toContain('Title');
        expect(outside).toContain('Tail paragraph.');
    });

    it('re-applies cleanly after a setContent swap', () => {
        const muya = bootMuya(DOC);
        const container = containerOf(muya);

        applyEditorColumns(container);
        muya.setContent(DOC.replace('Column A', 'Column X'));
        applyEditorColumns(containerOf(muya));

        const cols = [...containerOf(muya).querySelectorAll('.mu-mdcols-col')];
        expect(cols).toHaveLength(2);
        expect(cols[0].textContent).toContain('Column X');
        // The pre-swap block must not be resurrected by the revert.
        expect(containerOf(muya).textContent).not.toContain('Column A');
    });

    it('revert leaves the document renderable', () => {
        const muya = bootMuya(DOC);
        const container = containerOf(muya);

        applyEditorColumns(container);
        revertEditorColumns(container);

        expect(container.querySelectorAll('.mu-mdcols-group')).toHaveLength(0);
        expect(container.querySelectorAll('.mu-mdcols-hidden')).toHaveLength(0);
        expect(container.textContent).toContain('Column A');
        expect(container.textContent).toContain('Column B');
    });
});
