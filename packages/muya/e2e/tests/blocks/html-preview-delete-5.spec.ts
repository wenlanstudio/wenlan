import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/muya';
import { getMarkdown } from '../helpers/api';

// Issue #5 — a rendered <details> answer block was undeletable in the "文"
// view: the preview island is contenteditable=false, so Backspace/Delete never
// reached a block handler. These are REAL browser keystrokes.

const HTML_MD = '<details><summary>答案</summary>**B**。`(1.5 + 20) / 2 = 10.75`</details>\n';

async function loadHtml(page: Page, markdown = HTML_MD): Promise<void> {
    await page.evaluate(md => window.muya!.setContent(md), markdown);
    await expect(page.locator('.mu-html-preview')).toBeVisible();
}

test.describe('issue #5 — delete a rendered HTML block', () => {
    test('Backspace on the preview island removes the whole block', async ({ page }) => {
        await loadHtml(page);
        await page.locator('.mu-html-preview summary').click();
        await page.keyboard.press('Backspace');

        await expect(page.locator('.mu-html-block')).toHaveCount(0);
        expect(await getMarkdown(page)).not.toContain('<details>');
    });

    test('Delete on the preview island removes the whole block', async ({ page }) => {
        await loadHtml(page);
        await page.locator('.mu-html-preview details').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('Delete');

        await expect(page.locator('.mu-html-block')).toHaveCount(0);
        expect(await getMarkdown(page)).not.toContain('<details>');
    });

    test('Enter on the preview island does not delete the block', async ({ page }) => {
        await loadHtml(page);
        await page.locator('.mu-html-preview summary').click();
        await page.keyboard.press('Enter');

        await expect(page.locator('.mu-html-block')).toHaveCount(1);
        expect(await getMarkdown(page)).toContain('<details>');
    });

    test('the deletion survives a markdown round-trip (source view ↔ editor)', async ({ page }) => {
        await loadHtml(page);
        await page.locator('.mu-html-preview summary').click();
        await page.keyboard.press('Backspace');
        // Wait for both the DOM replacement and the deferred jsonState op
        // before reading markdown, otherwise setContent would reload the OLD
        // document and bring the HTML block straight back.
        await expect(page.locator('.mu-html-block')).toHaveCount(0);
        await expect.poll(() => getMarkdown(page)).not.toContain('<details>');
        const md = await getMarkdown(page);

        await page.evaluate(m => window.muya!.setContent(m), md);

        await expect(page.locator('.mu-html-block')).toHaveCount(0);
        expect(await getMarkdown(page)).toBe(md);
    });

    test('an active (source) HTML block keeps normal editing', async ({ page }) => {
        // A pagebreak marker renders a badge; clicking it activates the source
        // editor, where Backspace must behave like text editing, not delete.
        await loadHtml(page, '<!-- pagebreak -->\n');
        await page.locator('.mu-html-preview .mu-mdcols-marker').click();
        await expect(page.locator('figure.mu-html-block')).toHaveClass(/mu-active/);

        await page.keyboard.press('Backspace');

        await expect(page.locator('.mu-html-block')).toHaveCount(1);
        expect(await getMarkdown(page)).toContain('pagebreak');
    });
});
