import { describe, expect, it } from 'vitest';
import { lexBlock } from '../../marked';

// 行内化判据的 token 层依据（markdownToState 的分流实现必须与此一致）：
// marker 注释要并入上一段落的 text，需要前一个顶层 token 是 paragraph 且
// 二者之间没有 space token。空行间隔会产出 space token；上文是标题 / 列表 /
// 引用时前一个 token 不是 paragraph —— 两种场景都保持块级 html-block。

describe('column marker 行内化判据 — lexBlock token 流', () => {
    it('紧贴段落（无空行）时 html token 直接邻接 paragraph', () => {
        const tokens = lexBlock('正文\n<!-- begin 30:70 -->\nA栏\n<!-- split -->\nB栏\n<!-- end -->\n');

        expect(tokens.map(t => t.type)).toEqual([
            'paragraph',
            'html',
            'paragraph',
            'html',
            'paragraph',
            'html',
        ]);
        // 段落 raw 以单个换行结尾，与 html token 之间无 space —— 可并入。
        expect(tokens[0].raw).toBe('正文\n');
        expect(tokens[1].raw).toBe('<!-- begin 30:70 -->\n');
    });

    it('空行间隔时产出 space token', () => {
        const tokens = lexBlock('正文\n\n<!-- begin -->\n\nA栏\n');

        expect(tokens.map(t => t.type)).toEqual(['paragraph', 'space', 'html', 'space', 'paragraph']);
        expect(tokens[1].raw).toBe('\n\n');
    });

    it('上文是标题时紧邻但前块不是 paragraph', () => {
        const tokens = lexBlock('## 标题\n<!-- begin -->\nA栏\n<!-- end -->\n');

        expect(tokens.map(t => t.type)).toEqual(['heading', 'html', 'paragraph', 'html']);
    });
});
