import { describe, expect, it } from 'vitest';
import { MarkdownToState } from '../markdownToState';

// 块首行表（宿主一文多览锚服务）：index 与宿主 contentBlocks 的 DOM 序同域
// ——分栏组展开为成员块、独立成块的分栏标记剔除、行内徽章所骑段落保留；
// 值 = 块首行（1 基）。token.raw 逐段对位自证，对不上返回 null。

const OPTIONS = {
    footnote: false,
    texMathDollars: false,
    texMathGfm: false,
    texMathSingleBackslash: false,
    texMathDoubleBackslash: false,
    trimUnnecessaryCodeBlockEmptyLines: false,
    frontMatter: false,
};

function table(markdown: string): number[] | null {
    return new MarkdownToState(OPTIONS).topLevelLineTable(markdown);
}

describe('topLevelLineTable — 普通文档', () => {
    it('每个顶层内容块记其首行（1 基）', () => {
        const md = ['# 标题', '', '第一段', '', '- 甲', '- 乙', '', '| a | b |', '| - | - |', '| 1 | 2 |', '', '```js', 'code', '```', '', '尾段'].join('\n');
        // 块序：heading(1) / paragraph(3) / list(5) / table(8) / code(12) / paragraph(16)
        expect(table(md)).toEqual([1, 3, 5, 8, 12, 16]);
    });

    it('空文档返回 null（合成段落无处对位）', () => {
        expect(table('')).toBeNull();
    });
});

describe('topLevelLineTable — 分栏文档（行内标记）', () => {
    it('组外段保留、组内成员展开、行内徽章段不剔除', () => {
        const md = ['正文', '<!-- begin 30:70 -->', 'A栏', '<!-- split -->', 'B栏', '<!-- end -->', '后文'].join('\n');
        // contentBlocks 域：正文段(1，骑 begin)、栏内 A(3)/B(5)、后文(7)
        expect(table(md)).toEqual([1, 3, 5, 7]);
    });
});

describe('topLevelLineTable — 分栏文档（块级标记）', () => {
    it('独立成块的标记（block 级徽章）从表域剔除', () => {
        const md = ['前文', '', '<!-- begin -->', '', 'A', '', '<!-- split -->', '', 'B', '', '<!-- end -->', '', '后文'].join('\n');
        // contentBlocks 域：前文(1)、栏内 A(5)/B(9)、后文(13)；begin/split/end
        // 三个独立 html 标记块（行 3/7/11）剔除
        expect(table(md)).toEqual([1, 5, 9, 13]);
    });
});

describe('topLevelLineTable — 不影响既有 generate 语义', () => {
    it('表查询不改变 generate 的产物', () => {
        const md = '正文\n<!-- begin 30:70 -->\nA栏\n<!-- split -->\nB栏\n<!-- end -->\n';
        const once = new MarkdownToState(OPTIONS).generate(md);
        const parser = new MarkdownToState(OPTIONS);
        parser.topLevelLineTable(md);
        expect(parser.generate(md)).toEqual(once);
    });
});
