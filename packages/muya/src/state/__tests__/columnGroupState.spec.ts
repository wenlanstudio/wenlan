import { describe, expect, it } from 'vitest';
import { MarkdownToState } from '../markdownToState';
import ExportMarkdown from '../stateToMarkdown';
import type { IColumnState, IColumnsState, TState } from '../types';

// 分栏组进入块树（utils/columns/DESIGN.md）：`<!-- begin --> … <!-- end -->`
// 之间的内容收成 `columns > column > 内容块`，标记本身仍留在所贴段落的 text 里。

function generate(markdown: string): TState[] {
    return new MarkdownToState({
        footnote: false,
        texMathDollars: false,
        texMathGfm: false,
        texMathSingleBackslash: false,
        texMathDoubleBackslash: false,
        trimUnnecessaryCodeBlockEmptyLines: false,
        frontMatter: false,
    }).generate(markdown);
}

function serialize(states: TState[]): string {
    return new ExportMarkdown().generate(states);
}

function shape(states: TState[]): string[] {
    return states.map(state => {
        if (state.name === 'columns') {
            return `columns(${state.children
                .map(column => `column[${column.children.map(c => c.name).join(',')}]`)
                .join('|')})`;
        }
        return state.name;
    });
}

describe('分栏组状态结构', () => {
    it('行内标记：begin 的段落留在组外，split/end 收进各自的栏', () => {
        const states = generate('正文\n<!-- begin 30:70 -->\nA栏\n<!-- split -->\nB栏\n<!-- end -->\n');

        expect(shape(states)).toEqual([
            'paragraph',
            'columns(column[paragraph]|column[paragraph])',
        ]);

        const group = states[1] as IColumnsState;
        expect(group.meta.ratio).toEqual([30, 70]);
        expect((group.children[0] as IColumnState).children[0]).toMatchObject({
            name: 'paragraph',
            text: 'A栏\n<!-- split -->',
        });
        expect((group.children[1] as IColumnState).children[0]).toMatchObject({
            name: 'paragraph',
            text: 'B栏\n<!-- end -->',
        });
    });

    it('块级标记：标记块是所在栏的最后一个子节点', () => {
        const states = generate('正文\n\n<!-- begin -->\n\nA栏\n\n<!-- split -->\n\nB栏\n\n<!-- end -->\n');

        expect(shape(states)).toEqual([
            'paragraph',
            'html-block',
            'columns(column[paragraph,html-block]|column[paragraph,html-block])',
        ]);
    });

    it('三栏与占比', () => {
        const states = generate('<!-- begin 25:25:50 -->\nA\n<!-- split -->\nB\n<!-- split -->\nC\n<!-- end -->\n');

        // The `begin` marker has no paragraph to ride on, so it stays a
        // standalone html block in front of the group.
        expect(shape(states)).toEqual([
            'html-block',
            'columns(column[paragraph]|column[paragraph]|column[paragraph])',
        ]);
        expect((states[1] as IColumnsState).meta.ratio).toEqual([25, 25, 50]);
    });

    it('不合法的组不建结构（§1.3）', () => {
        // 孤立 end：标记并入了前面的段落，没有成组
        expect(shape(generate('A\n<!-- end -->\n'))).toEqual(['paragraph']);
        // begin 没有 end
        expect(shape(generate('<!-- begin -->\nA\n'))).toEqual(['html-block', 'paragraph']);
        // 超过 3 栏：整组降级为线性
        expect(
            shape(generate('<!-- begin -->\nA\n<!-- split -->\nB\n<!-- split -->\nC\n<!-- split -->\nD\n<!-- end -->\n')),
        ).toEqual([
            'html-block',
            'paragraph',
            'paragraph',
            'paragraph',
            'paragraph',
        ]);
    });

    it('占比非法时按等宽渲染，结构仍然成立（§1.3 #5）', () => {
        const states = generate('<!-- begin 1:2 -->\nA\n<!-- split -->\nB\n<!-- end -->\n');

        expect(shape(states)).toEqual([
            'html-block',
            'columns(column[paragraph]|column[paragraph])',
        ]);
        expect((states[1] as IColumnsState).meta.ratio).toBeUndefined();
    });
});

describe('分栏组的序列化往返', () => {
    it('行内标记：marker 仍紧贴段落，往返是不动点', () => {
        const src = '正文\n<!-- begin 30:70 -->\nA栏\n<!-- split -->\nB栏\n<!-- end -->\n';
        const md = serialize(generate(src));

        // 块间固定空行是既有序列化行为；这里断言的是 marker 与所贴段落之间
        // 不出现空行——行内化语义的核心不变量。
        expect(md).toContain('正文\n<!-- begin 30:70 -->');
        expect(md).toContain('A栏\n<!-- split -->');
        expect(md).toContain('B栏\n<!-- end -->');

        // 闭环：保存后再序列化，字节不再变化。
        expect(serialize(generate(md))).toBe(md);
    });

    it('块级标记：markdown 逐字节相同', () => {
        const src = '正文\n\n<!-- begin -->\n\nA栏\n\n<!-- split -->\n\nB栏\n\n<!-- end -->\n';
        expect(serialize(generate(src))).toBe(src);
    });

    it('往返后结构不变', () => {
        const src = '正文\n<!-- begin 30:70 -->\nA栏\n<!-- split -->\nB栏\n<!-- end -->\n';
        expect(shape(generate(serialize(generate(src))))).toEqual(shape(generate(src)));
    });
});
