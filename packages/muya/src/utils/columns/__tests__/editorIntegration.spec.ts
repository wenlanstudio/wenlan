// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Muya } from '../../../muya';

// 分栏组是块树里的节点（utils/columns/DESIGN.md），所以引擎自己就渲染出分栏
// 结构：`.mu-container` → `.mu-columns` → `.mu-column` → 内容块。DOM 与块树
// 同形，栏内才能正常编辑。这些规格对着真引擎把这条契约钉住。
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

function bootMuya(markdown: string, columnsLayout?: 'flat' | 'columns'): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown, columnsLayout } as ConstructorParameters<typeof Muya>[1]);
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

        // 引擎自己渲染出分栏结构：块树里有 `columns` 节点，DOM 就有一致的形状。
        const groups = [...container.querySelectorAll('.mu-columns')];
        expect(groups).toHaveLength(1);
        const cols = [...groups[0].querySelectorAll('.mu-column')];
        expect(cols).toHaveLength(2);
        expect(cols[0].textContent).toContain('Column A');
        expect(cols[1].textContent).toContain('Column B');

        const outside = [...container.children]
            .filter(el => !el.classList.contains('mu-columns'))
            .map(el => el.textContent ?? '')
            .join(' | ');
        expect(outside).toContain('Title');
        expect(outside).toContain('Tail paragraph.');
    });

    it('re-renders the group after a setContent swap', () => {
        const muya = bootMuya(DOC);

        muya.setContent(DOC.replace('Column A', 'Column X'));

        const cols = [...containerOf(muya).querySelectorAll('.mu-column')];
        expect(cols).toHaveLength(2);
        expect(cols[0].textContent).toContain('Column X');
        // The pre-swap block must not be resurrected.
        expect(containerOf(muya).textContent).not.toContain('Column A');
    });

    it('the group is a node of the block tree, not a DOM post-process', () => {
        const muya = bootMuya(DOC);
        const state = muya.getState();

        // `begin` 前面有空行 → 块级标记块，留在组外。
        expect(state.map(s => s.name)).toEqual(['atx-heading', 'html-block', 'columns', 'paragraph']);
        const group = state[2] as { name: string; children: { name: string }[] };
        expect(group.name).toBe('columns');
        expect(group.children.map(c => c.name)).toEqual(['column', 'column']);
    });

    it('the Columns view switches the layout, the Page view does not', () => {
        const page = bootMuya(DOC);
        const columns = bootMuya(DOC, 'columns');

        expect(page.domNode.classList.contains('mu-columns-layout')).toBe(false);
        expect(columns.domNode.classList.contains('mu-columns-layout')).toBe(true);

        // Both views hold the same blocks — only the layout differs.
        expect(columns.getState().map(s => s.name)).toEqual(page.getState().map(s => s.name));
    });

    it('the column widths follow the begin marker ratio', () => {
        const muya = bootMuya('<!-- begin 30:70 -->\nA\n<!-- split -->\nB\n<!-- end -->\n', 'columns');
        const cols = [...containerOf(muya).querySelectorAll<HTMLElement>('.mu-column')];

        expect(cols).toHaveLength(2);
        expect(cols[0].style.flexGrow).toBe('30');
        expect(cols[1].style.flexGrow).toBe('70');
    });
});
