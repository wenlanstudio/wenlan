// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CODE_RUN_EVENT } from '../../../../config';
import { Muya } from '../../../../muya';

// Issue #4 — a fenced code block gets a run button next to the copy button.
// Muya only dispatches a DOM event; the desktop host owns execution / panel
// wiring. These tests lock down the event contract and the guard that keeps
// the button off frontmatter / math / diagram / html containers (all of which
// reuse the same Code class).

const bootedHosts: HTMLElement[] = [];

beforeEach(() => {
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (bootedHosts.length)
        bootedHosts.pop()!.remove();
    vi.restoreAllMocks();
});

function bootMuya(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    bootedHosts.push(muya.domNode);
    return muya;
}

describe('code-block run button', () => {
    it('is rendered on a fenced code block and dispatches the raw code text', () => {
        const muya = bootMuya('```js\nconst a = 1\nconst b = 2\n```\n');
        const button = muya.domNode.querySelector<HTMLElement>('a.mu-code-run');
        expect(button).not.toBeNull();

        const events: Array<{ text: string }> = [];
        document.addEventListener(CODE_RUN_EVENT, (event) => {
            events.push((event as CustomEvent<{ text: string }>).detail);
        });

        button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(events).toEqual([{ text: 'const a = 1\nconst b = 2' }]);
    });

    it('does not also trigger the copy action', () => {
        const muya = bootMuya('```js\nsolo line\n```\n');
        const copySpy = vi.spyOn(muya.editor.clipboard, 'copy').mockImplementation(() => {});

        muya.domNode.querySelector<HTMLElement>('a.mu-code-run')!
            .dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(copySpy).not.toHaveBeenCalled();
    });

    it('preventDefaults mousedown so the caret does not move', () => {
        const muya = bootMuya('```js\nsolo line\n```\n');
        const button = muya.domNode.querySelector<HTMLElement>('a.mu-code-run')!;
        const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });

        button.dispatchEvent(mousedown);

        expect(mousedown.defaultPrevented).toBe(true);
    });

    it.each([
        ['frontmatter', '---\ntitle: x\n---\n\nbody\n'],
        ['math', '$$\nx = 1\n$$\n'],
        ['diagram', '```mermaid\ngraph TD\n A --> B\n```\n'],
        ['html', '<div>hello</div>\n'],
    ])('is absent on a %s container', (_name, markdown) => {
        const muya = bootMuya(markdown);
        // These containers still have a copy button — only the run button is
        // reserved for executable fenced code blocks.
        expect(muya.domNode.querySelector('a.mu-code-copy')).not.toBeNull();
        expect(muya.domNode.querySelector('a.mu-code-run')).toBeNull();
    });
});
