// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Muya } from '../../../../muya';

// §4.6 block-level badge: a marker that did NOT get inlined into a paragraph
// (blank line before it, or a heading / list above) renders the SAME badge as
// the inline form — one visual form whichever way markers are written. The
// badge is also the Columns view's regroup boundary carrier (data-kind /
// data-ratio), and clicking it activates the block's source editing, the only
// edit entry a block badge has (an inline badge is edited by selecting it
// inside its paragraph).

const bootedMuyas: Muya[] = [];

beforeEach(() => {
    (window as unknown as { MUYA_VERSION?: string }).MUYA_VERSION = 'test';
});

afterEach(() => {
    while (bootedMuyas.length)
        bootedMuyas.pop()!.destroy();
    document.body.innerHTML = '';
    delete (window as unknown as { MUYA_VERSION?: string }).MUYA_VERSION;
});

function boot(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    bootedMuyas.push(muya);
    return muya;
}

// 空行分隔：标记不与任何段落紧贴，走块级兜底路径。
const BLANK_LINE_DOC = [
    '<!-- begin 30:70 -->',
    '',
    'A',
    '',
    '<!-- split -->',
    '',
    'B',
    '',
    '<!-- end -->',
].join('\n');

describe('htmlPreview — block-level marker badge (§4.6)', () => {
    it('renders the same badge element as the inline form', () => {
        const muya = boot(BLANK_LINE_DOC);
        const badges = [...muya.domNode.querySelectorAll<HTMLElement>('.mu-html-preview .mu-mdcols-marker')];

        expect(badges).toHaveLength(3);
        expect(badges.map(b => b.dataset.kind)).toEqual(['begin', 'split', 'end']);
        // 与行内徽标同款 class——文字（⇤ 分栏开始 等）由 CSS ::before 提供。
        expect(badges[0].className).toContain('mu-mdcols-inline');
        expect(badges[0].className).toContain('mu-mdcols-begin');
        // 栏宽占比是 columns 视图的 regroup 输入，必须带在 DOM 上。
        expect(badges[0].dataset.ratio).toBe('30:70');
    });

    it('activates the block and moves the caret into the source on click', () => {
        const muya = boot(BLANK_LINE_DOC);
        const badge = muya.domNode.querySelector<HTMLElement>('.mu-html-preview .mu-mdcols-marker')!;
        const figure = badge.closest('figure.mu-html-block')!;
        expect(figure.classList.contains('mu-active')).toBe(false);

        badge.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        // mu-active 让 CSS 把 preview 收起、html-container（源码）显示。
        expect(figure.classList.contains('mu-active')).toBe(true);
        // 光标送入源码容器——落在哪个块上（jsdom 下 offset 会被 selection 同步
        // 重置为 0，真实浏览器里 focus() 后才保得住末尾位置，故只断言块）。
        const selection = muya.editor.selection.getSelection();
        expect(selection).not.toBeNull();
        expect(selection!.anchor.block.text).toBe('<!-- begin 30:70 -->');
    });

    it('keeps the badge as the columns regroup carrier (data attributes)', () => {
        const muya = boot(BLANK_LINE_DOC);

        const kinds = [...muya.domNode.querySelectorAll('.mu-html-preview .mu-mdcols-marker')]
            .map(el => el.getAttribute('data-kind'));

        expect(kinds).toEqual(['begin', 'split', 'end']);
    });
});
