import { describe, expect, it } from 'vitest';
import { MarkdownToState } from '../markdownToState';
import ExportMarkdown from '../stateToMarkdown';

interface IStateLike {
    name: string;
    text?: string;
    children?: IStateLike[];
}

function generate(markdown: string): IStateLike[] {
    return new MarkdownToState({
        footnote: false,
        texMathDollars: false,
        texMathGfm: false,
        texMathSingleBackslash: false,
        texMathDoubleBackslash: false,
        trimUnnecessaryCodeBlockEmptyLines: false,
        frontMatter: false,
    }).generate(markdown) as unknown as IStateLike[];
}

function columnsContent(group: IStateLike): IStateLike[] {
    return (group.children ?? []).flatMap(column => column.children ?? []);
}

// §4.6 分栏标记行内化：marker 注释紧贴顶层段落时并入该段 text（inlineRenderer
// 渲染段尾徽标），其余位置保持块级 html-block（htmlPreview 渲染块徽标兜底）。
// 判据的 token 层依据见 utils/columns/__tests__/inlineAdjacency.spec.ts。
//
// 分栏组进入块树之后（utils/columns/DESIGN.md），顶层状态里会出现
// `columns > column > 内容块`；标记落在哪一段上，看它挂在哪个状态里。

describe('markdownToState — 分栏标记行内化', () => {
    it('紧贴段落时并入段尾，无 html-block', () => {
        const states = generate('正文\n<!-- begin 30:70 -->\nA栏\n<!-- split -->\nB栏\n<!-- end -->\n');

        // `begin` 的段落留在组外，组内两栏各收一段。
        expect(states.map(s => s.name)).toEqual(['paragraph', 'columns']);
        expect(states[0].text).toBe('正文\n<!-- begin 30:70 -->');
        expect(columnsContent(states[1]).map(s => s.text)).toEqual([
            'A栏\n<!-- split -->',
            'B栏\n<!-- end -->',
        ]);
    });

    it('begin 上的占比原文完整并入', () => {
        const states = generate('正文\n<!-- begin 25:25:50 -->\nA\n<!-- split -->\nB\n<!-- split -->\nC\n<!-- end -->\n');

        expect(states[0].text).toBe('正文\n<!-- begin 25:25:50 -->');
    });

    it('前有空行时保持块级 html-block', () => {
        const states = generate('正文\n\n<!-- begin -->\n\nA栏\n');

        expect(states.map(s => s.name)).toEqual(['paragraph', 'html-block', 'paragraph']);
        expect(states[1].text).toBe('<!-- begin -->');
    });

    it('上文是标题时保持块级 html-block', () => {
        // begin 前是标题 → 块级；end 紧贴 A栏 段落 → 行内化。组内形态可混合，
        // 栏边界始终以标记位置为准。
        const states = generate('## 标题\n<!-- begin -->\nA栏\n<!-- end -->\n');

        expect(states.map(s => s.name)).toEqual(['atx-heading', 'html-block', 'columns']);
        expect(states[1].text).toBe('<!-- begin -->');
        expect(columnsContent(states[2]).map(s => s.text)).toEqual(['A栏\n<!-- end -->']);
    });

    it('引用容器内保持块级 html-block（§1.3 #7 inert）', () => {
        const states = generate('> 引用\n> <!-- begin -->\n');

        expect(states[0].name).toBe('block-quote');
        expect(states[0].children!.map(c => c.name)).toEqual(['paragraph', 'html-block']);
    });

    it('非 marker 注释保持块级 html-block', () => {
        const states = generate('正文\n<!-- 译者注 -->\n');

        expect(states.map(s => s.name)).toEqual(['paragraph', 'html-block']);
        expect(states[1].text).toBe('<!-- 译者注 -->');
    });

    it('组内允许行内与块级混合，边界以标记位置为准', () => {
        const states = generate('正文\n<!-- begin -->\nA栏\n\n<!-- split -->\nB栏\n<!-- end -->\n');

        expect(states.map(s => s.name)).toEqual(['paragraph', 'columns']);
        expect(states[0].text).toBe('正文\n<!-- begin -->');
        // 块级 split 是左栏的最后一个子节点，行内 end 是右栏的最后一个子节点。
        expect(columnsContent(states[1]).map(s => s.text)).toEqual([
            'A栏',
            '<!-- split -->',
            'B栏\n<!-- end -->',
        ]);
    });

    it('单个 img 的 html token 仍按段落处理（既有行为不变）', () => {
        const states = generate('<img src="a.png">\n');

        expect(states.map(s => s.name)).toEqual(['paragraph']);
        expect(states[0].text).toBe('<img src="a.png">');
    });

    it('往返后 marker 仍紧贴对应段落（位置保真）', () => {
        const src = '正文\n<!-- begin 30:70 -->\nA栏\n<!-- split -->\nB栏\n<!-- end -->\n';
        const states = generate(src);
        const md = new ExportMarkdown().generate(states as never);

        // 块间固定空行分隔是既有序列化行为；这里断言的是 marker 与所贴段落
        // 之间不出现空行 —— 行内化语义的核心不变量。
        expect(md).toContain('正文\n<!-- begin 30:70 -->');
        expect(md).toContain('A栏\n<!-- split -->');
        expect(md).toContain('B栏\n<!-- end -->');

        // 闭环：保存后重开，marker 仍紧贴对应段尾（行内化不漂移）。
        const reparsed = generate(md);
        expect(reparsed[0].text).toBe('正文\n<!-- begin 30:70 -->');
        expect(columnsContent(reparsed[1]).map(s => s.text)).toEqual([
            'A栏\n<!-- split -->',
            'B栏\n<!-- end -->',
        ]);
    });
});
