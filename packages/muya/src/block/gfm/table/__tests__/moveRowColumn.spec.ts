// @vitest-environment happy-dom

import type TreeNode from '../../../base/treeNode';
import type Table from '../index';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Muya } from '../../../../muya';

// Coverage for `Table.moveRow` / `Table.moveColumn` and the `Muya.tableAction`
// funnel the desktop's table context menu and Alt+Arrow keybindings drive.
// The move APIs were extracted from the drag bar's private state swap so the
// keyboard path and the drag path behave identically; a mis-splice here would
// silently reorder or drop row/column data.

const bootedHosts: HTMLElement[] = [];
let originalVersion: string | undefined;
let hadVersion = false;

beforeEach(() => {
    hadVersion = 'MUYA_VERSION' in window;
    originalVersion = window.MUYA_VERSION;
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (bootedHosts.length) {
        const host = bootedHosts.pop()!;
        host.remove();
    }
    document.getSelection()?.removeAllRanges();
    if (hadVersion)
        window.MUYA_VERSION = originalVersion as string;
    else
        delete (window as Partial<Window>).MUYA_VERSION;
});

function bootMuya(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    bootedHosts.push(muya.domNode);
    return muya;
}

function findTable(muya: Muya): Table {
    let table: Table | null = null;
    const visit = (block: TreeNode) => {
        if ((block.constructor as typeof TreeNode)?.blockName === 'table')
            table = block as Table;
        if (block.isParent())
            block.children.forEach(c => visit(c));
    };
    visit(muya.editor.scrollPage!);
    if (!table)
        throw new Error('no table found');
    return table;
}

function findFirstCellContent(muya: Muya) {
    const table = findTable(muya);
    return table.cellAt(1, 0)!.firstContentInDescendant()!;
}

function flush(): Promise<void> {
    return new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}

// 1 header + 2 body rows, 3 columns — enough room to move in both directions.
const TABLE = '| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n';

describe('table.moveRow', () => {
    it('moves a body row up past the row above it', async () => {
        const muya = bootMuya(TABLE);
        findTable(muya).moveRow(1, 0);

        await flush();
        const state = findTable(muya).getState();
        // Body row 1 (1,2,3) is now the first row; nothing was dropped.
        expect(state.children[0].children.map((c: { text: string }) => c.text)).toEqual(['1', '2', '3']);
        expect(state.children[1].children.map((c: { text: string }) => c.text)).toEqual(['a', 'b', 'c']);
        expect(state.children[2].children.map((c: { text: string }) => c.text)).toEqual(['4', '5', '6']);
    });

    it('moves a row down, shifting the rows in between up by one', async () => {
        const muya = bootMuya(TABLE);
        findTable(muya).moveRow(1, 2);

        await flush();
        const state = findTable(muya).getState();
        expect(state.children.map((r: { children: { text: string }[] }) => r.children[0].text))
            .toEqual(['a', '4', '1']);
    });

    it('ignores out-of-range and no-op arguments', async () => {
        const muya = bootMuya(TABLE);
        const before = JSON.stringify(findTable(muya).getState());

        findTable(muya).moveRow(0, 0);
        findTable(muya).moveRow(0, 9);
        findTable(muya).moveRow(-1, 1);

        expect(JSON.stringify(findTable(muya).getState())).toBe(before);
    });

    it('serializes the swapped rows back to GFM markdown', async () => {
        const muya = bootMuya(TABLE);
        findTable(muya).moveRow(1, 0);

        await flush();
        const md = muya.getMarkdown();
        // The serializer pretty-prints, so cells are padded to equal width;
        // the moved body row must still appear as the first data row.
        expect(md).toContain('| 1   | 2   | 3   |');
        expect(md.trimEnd().split('\n')).toHaveLength(4);
    });
});

describe('table.moveColumn', () => {
    it('moves a column right in every row at once', async () => {
        const muya = bootMuya(TABLE);
        findTable(muya).moveColumn(0, 1);

        await flush();
        const state = findTable(muya).getState();
        // Column a lands at index 1, b shifts to index 0 — in every row.
        expect(state.children[0].children.map((c: { text: string }) => c.text)).toEqual(['b', 'a', 'c']);
        expect(state.children[1].children.map((c: { text: string }) => c.text)).toEqual(['2', '1', '3']);
        expect(state.children[2].children.map((c: { text: string }) => c.text)).toEqual(['5', '4', '6']);
    });

    it('moves a column left in every row at once', async () => {
        const muya = bootMuya(TABLE);
        findTable(muya).moveColumn(2, 0);

        await flush();
        const state = findTable(muya).getState();
        // Column c lands at index 0, a/b shift right — in every row.
        expect(state.children[0].children.map((c: { text: string }) => c.text)).toEqual(['c', 'a', 'b']);
        expect(state.children[1].children.map((c: { text: string }) => c.text)).toEqual(['3', '1', '2']);
        expect(state.children[2].children.map((c: { text: string }) => c.text)).toEqual(['6', '4', '5']);
    });

    it('ignores out-of-range and no-op arguments', async () => {
        const muya = bootMuya(TABLE);
        const before = JSON.stringify(findTable(muya).getState());

        findTable(muya).moveColumn(0, 0);
        findTable(muya).moveColumn(0, 9);

        expect(JSON.stringify(findTable(muya).getState())).toBe(before);
    });
});

describe('Muya.tableAction', () => {
    it('returns null when the caret is not inside a table', () => {
        const muya = bootMuya('paragraph\n');

        expect(muya.tableAction('deleteRow')).toBeNull();
        expect(muya.tableAction('moveRowUp')).toBeNull();
    });

    it('deletes the row the caret sits in', async () => {
        const muya = bootMuya(TABLE);
        const cellContent = findFirstCellContent(muya);
        muya.editor.activeContentBlock = cellContent;
        cellContent.setCursor(0, 0, true);

        muya.tableAction('deleteRow');

        await flush();
        expect(findTable(muya).rowCount).toBe(2);
    });

    it('copies the whole table as aligned GFM markdown', async () => {
        const muya = bootMuya(TABLE);
        const cellContent = findFirstCellContent(muya);
        muya.editor.activeContentBlock = cellContent;
        cellContent.setCursor(0, 0, true);

        const markdown = muya.tableAction('copyTable');

        await flush();
        expect(markdown).toBeTruthy();
        expect(markdown!.split('\n').filter(l => l.startsWith('|'))).toHaveLength(4);
        // The serializer's pretty-print pads cells so all pipe characters align.
        const lines = markdown!.trimEnd().split('\n');
        expect(new Set(lines.map(l => l.length)).size).toBe(1);
    });

    it('removes the whole table and reports no caret cell afterwards', async () => {
        const muya = bootMuya(`${TABLE}\nfollowing paragraph\n`);
        const cellContent = findFirstCellContent(muya);
        muya.editor.activeContentBlock = cellContent;
        cellContent.setCursor(0, 0, true);

        muya.tableAction('deleteTable');

        await flush();
        expect(muya.getMarkdown()).not.toContain('|');
        expect(muya.getMarkdown()).toContain('following paragraph');
    });
});
