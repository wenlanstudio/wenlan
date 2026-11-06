// @vitest-environment happy-dom

import type { IChangeMeta } from '../state/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Muya } from '../muya';

// sync-design D6 / M2: a projection editor writes back the COMPLETE canonical
// block, not a clipped fragment. The engine parses the draft and records one
// reversible rebuild boundary via the existing replaceContent path.

const hosts: HTMLElement[] = [];
beforeEach(() => {
    window.MUYA_VERSION = 'test';
});
afterEach(() => {
    while (hosts.length)
        hosts.pop()!.remove();
    document.getSelection()?.removeAllRanges();
});

function boot(md: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown: md } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    hosts.push(muya.domNode);
    return muya;
}

function captureChanges(muya: Muya, fn: () => void): Array<{ txnId?: string; origin?: string }> {
    const changes: Array<{ txnId?: string; origin?: string }> = [];
    muya.eventCenter.on('json-change', (payload: unknown) => {
        const { txnId, origin } = payload as { txnId?: string; origin?: string };
        changes.push({ txnId, origin });
    });
    fn();
    return changes;
}

describe('replaceBlockMarkdown — canonical block draft write-back', () => {
    it('replaces one paragraph and leaves its neighbours untouched', () => {
        const muya = boot('alpha\n\nbeta\n\ngamma\n');

        expect(muya.replaceBlockMarkdown(1, 'BETA edited')).toBe(true);
        const md = muya.getMarkdown();
        expect(md).toContain('BETA edited');
        expect(md).toContain('alpha');
        expect(md).toContain('gamma');
        expect(md).not.toContain('\nbeta\n');
        expect(muya.getState()).toHaveLength(3);
    });

    it('accepts a draft that changes the block type or expands into several blocks', () => {
        const muya = boot('alpha\n\nbeta\n\ngamma\n');

        expect(muya.replaceBlockMarkdown(1, '# heading\n\n- one\n- two')).toBe(true);
        const states = muya.getState();
        expect(states.length).toBeGreaterThan(3);
        expect(muya.getMarkdown()).toContain('# heading');
        expect(muya.getMarkdown()).toContain('- one');
    });

    it('is a no-op for identical text, out-of-range indices and empty drafts', () => {
        const muya = boot('alpha\n\nbeta\n');
        const before = muya.getMarkdown();

        expect(muya.replaceBlockMarkdown(1, 'beta')).toBe(false);
        expect(muya.replaceBlockMarkdown(9, 'other')).toBe(false);
        expect(muya.replaceBlockMarkdown(0, '   \n\n')).toBe(false);
        expect(muya.getMarkdown()).toBe(before);
    });

    it('forwards transaction attribution to json-change', () => {
        const muya = boot('alpha\n\nbeta\n');
        const meta: IChangeMeta = { txnId: 'T-42', origin: 'projection' };

        const changes = captureChanges(muya, () => {
            expect(muya.replaceBlockMarkdown(1, 'beta changed', meta)).toBe(true);
        });

        expect(changes).toEqual([{ txnId: 'T-42', origin: 'projection' }]);
    });

    it('reverts the whole draft in one undo step', () => {
        const muya = boot('alpha\n\nbeta\n\ngamma\n');
        muya.replaceBlockMarkdown(1, '# heading\n\n- one');

        muya.undo();
        expect(muya.getMarkdown()).toContain('beta');
        expect(muya.getMarkdown()).not.toContain('# heading');

        muya.redo();
        expect(muya.getMarkdown()).toContain('# heading');
    });

    it('keeps consecutive block edits as separate undo boundaries', () => {
        const muya = boot('alpha\n\nbeta\n\ngamma\n');
        muya.replaceBlockMarkdown(0, 'alpha one');
        muya.replaceBlockMarkdown(2, 'gamma two');

        muya.undo();
        expect(muya.getMarkdown()).toContain('gamma');
        expect(muya.getMarkdown()).toContain('alpha one');
        muya.undo();
        expect(muya.getMarkdown()).toContain('alpha');
    });
});
