import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/muya';
import { getMarkdown } from '../helpers/api';

// Issue #5, second half — live browser contract for a rendered HTML block.
// `<details><summary>答案</summary>…</details>` behaves like Typora:
//   - the block-level <summary> keeps its native open/close toggle;
//   - clicking the exposed content opens the WHOLE <details> source for editing.

const DETAILS_MD
    = '<details><summary>答案</summary>**B**。误差出现不依赖缓冲区容量，只要文件数固定，map 数即固定。</details>\n';

async function loadHtml(page: Page, markdown = DETAILS_MD): Promise<void> {
    await page.evaluate(md => window.muya!.setContent(md), markdown);
    await expect(page.locator('.mu-html-preview')).toBeVisible();
}

const details = (page: Page) => page.locator('.mu-html-preview details');
const figure = (page: Page) => page.locator('figure.mu-html-block');

/** Click below the <summary> line, i.e. on the exposed content. */
async function clickExposedContent(page: Page): Promise<void> {
    const box = await details(page).boundingBox();
    const summaryBox = await page.locator('.mu-html-preview summary').boundingBox();
    if (!box || !summaryBox)
        throw new Error('details/summary has no box');
    await page.mouse.click(box.x + 20, summaryBox.y + summaryBox.height + 8);
}

test.describe('issue #5 — click rendered HTML to edit its source', () => {
    test('clicking <summary> toggles the block without opening the source', async ({ page }) => {
        await loadHtml(page);
        expect(await details(page).getAttribute('open')).toBeNull();

        await page.locator('.mu-html-preview summary').click();
        await expect(details(page)).toHaveAttribute('open', '');
        await expect(figure(page)).not.toHaveClass(/mu-active/);

        await page.locator('.mu-html-preview summary').click();
        expect(await details(page).getAttribute('open')).toBeNull();
        await expect(figure(page)).not.toHaveClass(/mu-active/);
    });

    test('clicking the collapsed block also keeps native behaviour', async ({ page }) => {
        await loadHtml(page);

        await details(page).click({ position: { x: 5, y: 5 } });

        await expect(figure(page)).not.toHaveClass(/mu-active/);
    });

    test('clicking the exposed content reveals the source editor', async ({ page }) => {
        await loadHtml(page);
        await page.locator('.mu-html-preview summary').click();
        await expect(details(page)).toHaveAttribute('open', '');

        await clickExposedContent(page);

        await expect(figure(page)).toHaveClass(/mu-active/);
        await expect(page.locator('.mu-html-container')).toBeVisible();
    });

    test('the source holds the WHOLE details code and is editable', async ({ page }) => {
        await loadHtml(page);
        await page.locator('.mu-html-preview summary').click();
        await clickExposedContent(page);
        await expect(figure(page)).toHaveClass(/mu-active/);

        const source = page.locator('.mu-html-container');
        await expect(source).toContainText('<details>');
        await expect(source).toContainText('</details>');

        // The caret sits at the end of the source block: typing must edit the
        // HTML rather than create a new block or delete the whole <details>.
        await page.keyboard.type('!');
        await expect.poll(() => getMarkdown(page)).toContain('!');
        expect(await getMarkdown(page)).toContain('<details>');
        await expect(page.locator('.mu-html-block')).toHaveCount(1);
    });

    test('a nested element in the exposed content also opens the source', async ({ page }) => {
        await loadHtml(page, '<details><summary>答案</summary><p>正文</p></details>\n');
        await page.locator('.mu-html-preview summary').click();

        await page.locator('.mu-html-preview details p').click();

        await expect(figure(page)).toHaveClass(/mu-active/);
    });

    test('clicking a link keeps link semantics instead of editing', async ({ page }) => {
        await loadHtml(page, '<div><a href="https://example.com">link</a></div>\n');

        await page.locator('.mu-html-preview a[href]').click();

        await expect(figure(page)).not.toHaveClass(/mu-active/);
    });

    test('the marker badge still opens the source', async ({ page }) => {
        await loadHtml(page, '<!-- pagebreak -->\n');

        await page.locator('.mu-html-preview .mu-mdcols-marker').click();

        await expect(figure(page)).toHaveClass(/mu-active/);
    });

    test('Backspace on the collapsed preview still deletes the block', async ({ page }) => {
        await loadHtml(page);
        await page.locator('.mu-html-preview summary').click();
        await page.keyboard.press('Backspace');

        await expect(page.locator('.mu-html-block')).toHaveCount(0);
    });
});
