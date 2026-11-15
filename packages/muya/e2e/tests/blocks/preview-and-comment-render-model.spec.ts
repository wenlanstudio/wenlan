import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/muya';
import { getMarkdown } from '../helpers/api';
import { editor } from '../helpers/selectors';

// Three regressions with ONE root: block behaviour used to be decided from
// the DOM (container `blockName`, `mu-active` size swaps) instead of the
// block's state.
//
//   1. triple-Enter split excluded every diagram because its container is
//      `diagram-container`, not `code-block`;
//   2. an active diagram preview was an absolute popover that covered the
//      following paragraph;
//   3. a comment-only html comment got a preview + a collapsed 0×0 source
//      pair; entering the caret changed the layout under it and scrolled.
//
// These are real-browser assertions on layout, not just state snapshots.

interface IBlock {
    constructor: { blockName?: string };
    children?: { forEach: (cb: (b: unknown) => void) => void };
}

async function setCodeCursor(page: Page, offset: number): Promise<void> {
    await page.evaluate((o) => {
        let hit: unknown = null;
        const visit = (b: IBlock) => {
            if (b.constructor.blockName === 'codeblock.content')
                hit ??= b;
            b.children?.forEach(c => visit(c as IBlock));
        };
        visit(window.muya!.editor.scrollPage as unknown as IBlock);
        (hit as { setCursor: (s: number, e: number, force?: boolean) => void })
            .setCursor(o, o, true);
    }, offset);
}

async function burst(page: Page): Promise<void> {
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
}

test.describe('render model — state, not DOM, decides behaviour', () => {
    test('triple Enter splits a mermaid diagram into two diagrams', async ({ page }) => {
        await page.evaluate(
            md => window.muya!.setContent(md),
            '```mermaid\ngraph TD\nA --> B\n```\n',
        );
        await expect(page.locator(editor.diagramBlock)).toHaveCount(1);

        await setCodeCursor(page, 'graph TD'.length);
        await burst(page);

        await expect(page.locator(editor.diagramBlock)).toHaveCount(2);
        await expect(page.locator(editor.codeContent)).toHaveCount(2);
        const md = await getMarkdown(page);
        expect(md.match(/```mermaid/g)).toHaveLength(2);
        expect(md).toContain('graph TD');
        expect(md).toContain('A --> B');
    });

    test('an active diagram preview is inline and never covers the next paragraph', async ({ page }) => {
        await page.evaluate(
            md => window.muya!.setContent(md),
            '```mermaid\ngraph TD\nA --> B\n```\n\nAFTER THE DIAGRAM\n',
        );
        await expect(page.locator(editor.diagramBlock)).toHaveCount(1);

        await page.locator(editor.diagramPreview).first().click();
        await expect(page.locator(editor.diagramBlock).first()).toHaveClass(/mu-active/);

        const layout = await page.evaluate(() => {
            const preview = document.querySelector('.mu-diagram-preview')!;
            const after = [...document.querySelectorAll('.mu-paragraph')]
                .find(p => p.textContent?.includes('AFTER THE DIAGRAM'))!;

            return {
                position: getComputedStyle(preview).position,
                previewBottom: preview.getBoundingClientRect().bottom,
                afterTop: after.getBoundingClientRect().top,
                zIndex: getComputedStyle(preview).zIndex,
            };
        });

        expect(layout.position).not.toBe('absolute');
        expect(layout.zIndex).toBe('auto');
        // The preview occupies its own space; the paragraph starts below it.
        expect(layout.previewBottom).toBeLessThanOrEqual(layout.afterTop + 1);
    });

    test('a quiz comment is inline source: no preview, no container, no layout jump', async ({ page }) => {
        const filler = Array.from({ length: 24 }, (_, i) => `filler ${i}`).join('\n\n');
        await page.evaluate(
            md => window.muya!.setContent(md),
            `${filler}\n\n<!--quiz {"answer":"B","limit":30}-->\n\n${filler}\n`,
        );

        const plain = page.locator('figure.mu-html-block.mu-html-plain');
        await expect(plain).toHaveCount(1);
        await expect(page.locator(editor.htmlPreview)).toHaveCount(0);
        await expect(plain.locator('.mu-html-comment')).toHaveCount(0);
        await expect(plain.locator(editor.codeContent))
            .toHaveText('<!--quiz {"answer":"B","limit":30}-->');

        const measure = () => page.evaluate(() => {
            const figure = document.querySelector('figure.mu-html-block.mu-html-plain')!;
            const source = figure.querySelector('.mu-html-container')!;
            const scrollTops: number[] = [];
            let cur: HTMLElement | null = figure.parentElement;
            while (cur) {
                scrollTops.push(cur.scrollTop);
                cur = cur.parentElement;
            }
            scrollTops.push(document.scrollingElement?.scrollTop ?? 0);

            return {
                figureHeight: figure.getBoundingClientRect().height,
                sourceHeight: source.getBoundingClientRect().height,
                sourceOpacity: getComputedStyle(source).opacity,
                scrollTops,
            };
        });

        // Playwright's own click() scrolls the target into view first. Do that
        // explicitly BEFORE the baseline so the assertion measures only what
        // the EDITOR does when the caret enters the comment.
        await plain.locator(editor.codeContent).scrollIntoViewIfNeeded();
        const before = await measure();
        expect(before.sourceOpacity).toBe('1');

        await plain.locator(editor.codeContent).click();
        await page.waitForTimeout(150);

        const after = await measure();
        // Entering the caret changes NOTHING about the layout — that is the
        // root cause of the old scroll jump, not something to guard downstream.
        expect(after.figureHeight).toBeCloseTo(before.figureHeight, 0);
        expect(after.sourceHeight).toBeCloseTo(before.sourceHeight, 0);
        expect(after.sourceOpacity).toBe('1');
        expect(after.scrollTops).toEqual(before.scrollTops);
    });

    test('an inactive preview leaves no phantom source band; an active one restores the code frame', async ({ page }) => {
        await page.evaluate(
            md => window.muya!.setContent(md),
            '```mermaid\ngraph TD\nA --> B\n```\n\nAFTER THE DIAGRAM\n',
        );
        await expect(page.locator(editor.diagramBlock)).toHaveCount(1);

        const measure = () => page.evaluate(() => {
            const figure = document.querySelector('figure.mu-diagram-block')!;
            const source = figure.querySelector('.mu-diagram-container')!;
            const preview = figure.querySelector('.mu-diagram-preview')!;
            const cs = getComputedStyle(source);

            return {
                sourceHeight: source.getBoundingClientRect().height,
                gap: preview.getBoundingClientRect().top - source.getBoundingClientRect().bottom,
                padding: cs.paddingTop,
                border: cs.borderTopWidth,
            };
        });

        // `height: 0` alone is not enough. The shared code-container rule
        // gives all three families a 1em padding + 1px border, which under
        // border-box still occupies ~31px of invisible band above the image.
        const inactive = await measure();
        expect(inactive.sourceHeight).toBe(0);
        expect(inactive.padding).toBe('0px');
        expect(inactive.border).toBe('0px');
        expect(Math.abs(inactive.gap)).toBeLessThan(1);

        await page.locator(editor.diagramPreview).first().click();
        await expect(page.locator(editor.diagramBlock).first()).toHaveClass(/mu-active/);
        const active = await measure();
        expect(active.sourceHeight).toBeGreaterThan(0);
        expect(active.padding).not.toBe('0px');
        expect(active.border).not.toBe('0px');
    });
});
