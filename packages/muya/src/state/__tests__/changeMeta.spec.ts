// @vitest-environment happy-dom

import type Content from '../../block/base/content';
import type { IChangeMeta } from '../types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Muya } from '../../muya';

// sync-design D2: the engine is the transport for the host adapter's
// transaction attribution. It must not invent, drop or rewrite `txnId`/`origin`,
// and self-sourced edits must stay unattributed so the adapter can tell the two
// entry points apart without guessing from timing.

interface IChangeRecord {
    op: unknown;
    source: string;
    txnId?: string;
    origin?: string;
}

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

function capture(muya: Muya, fn: () => void): IChangeRecord[] {
    const records: IChangeRecord[] = [];
    muya.eventCenter.on('json-change', (payload: unknown) => {
        const { op, source, txnId, origin } = payload as IChangeRecord;
        records.push({ op, source, txnId, origin });
    });
    fn();
    return records;
}

describe('json-change transaction attribution', () => {
    it('forwards txnId and origin on an external whole-document replacement', () => {
        const muya = boot('hello\n');
        const meta: IChangeMeta = { txnId: 'T-17', origin: 'source' };

        const records = capture(muya, () => {
            expect(muya.replaceContent('# changed\n', undefined, meta)).toBe(true);
        });

        expect(records).toHaveLength(1);
        expect(records[0].txnId).toBe('T-17');
        expect(records[0].origin).toBe('source');
        expect(records[0].source).toBe('api');
        expect(muya.getMarkdown().trim()).toBe('# changed');
    });

    it('forwards meta through the incremental updateContents entry', () => {
        const muya = boot('hello\n');

        const records = capture(muya, () => {
            muya.editor.updateContents(null, null, 'api', { txnId: 'T-2', origin: 'table' });
        });

        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({ txnId: 'T-2', origin: 'table', source: 'api' });
    });

    it('leaves self-sourced (flushed) edits unattributed', () => {
        const muya = boot('hello\n');
        const leaf = muya.editor.scrollPage!.firstContentInDescendant() as Content;

        const records = capture(muya, () => {
            leaf.text = 'hello world';
            muya.flush();
        });

        expect(records).toHaveLength(1);
        expect(records[0].txnId).toBeUndefined();
        expect(records[0].origin).toBeUndefined();
        expect(records[0].source).toBe('user');
    });

    it('labels undo and redo applies with their origin', () => {
        const muya = boot('hello\n');
        const leaf = muya.editor.scrollPage!.firstContentInDescendant() as Content;
        leaf.text = 'hello world';
        muya.flush();

        const records = capture(muya, () => {
            muya.undo();
            muya.redo();
        });

        expect(records.map(record => record.origin)).toEqual(['undo', 'redo']);
        expect(records.every(record => record.txnId === undefined)).toBe(true);
        expect(muya.getMarkdown().trim()).toBe('hello world');
    });
});
