// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLASS_NAMES } from '../../config';
import { Muya } from '../../muya';

// §4.6 行内徽标：marker 注释独占段落行时，markdownToState 把它并入段尾 text，
// inlineRenderer 渲染为 `.mu-mdcols-inline` 徽标（带 data-kind / data-ratio）。
// 同行手打的注释不渲染徽标 —— 与导出管线的「顶层 token」假设保持同构
// （显示徽标 ⟷ 导出时分栏生效）。

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

describe('column marker inline badge', () => {
    it('renders a trailing badge for a marker that owns its line under a paragraph', () => {
        const muya = boot('正文\n<!-- begin 30:70 -->\nA栏\n<!-- split -->\nB栏\n<!-- end -->\n');
        const badges = [...muya.domNode.querySelectorAll<HTMLElement>('.mu-mdcols-inline')];

        expect(badges.map(b => b.dataset.kind)).toEqual(['begin', 'split', 'end']);
        expect(badges[0].dataset.ratio).toBe('30:70');
        expect(badges[1].dataset.ratio).toBeUndefined();
        // 剪贴板 / 输出路径剥除徽标 DOM，真实文本由段落 text 保真。
        expect(badges.every(b => b.classList.contains(CLASS_NAMES.MU_OUTPUT_REMOVE))).toBe(true);
    });

    it('does not badge a marker typed on the same line as text (§1.3 #7)', () => {
        const muya = boot('正文 <!-- begin --> 更多\n');

        expect(muya.domNode.querySelector('.mu-mdcols-inline')).toBeNull();
    });

    it('does not badge an ordinary comment', () => {
        const muya = boot('正文\n<!-- 译者注 -->\n');

        expect(muya.domNode.querySelector('.mu-mdcols-inline')).toBeNull();
    });
});
