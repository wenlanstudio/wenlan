import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/muya';

// Issue #4 — a fenced code block's ▶ button must dispatch a real DOM event
// carrying the raw code text. The desktop host listens for it, resolves the
// fence line and opens the code run panel (that half lives in desktop tests).

interface IRunDetail {
    text: string;
}

async function listenForRunEvents(page: Page): Promise<void> {
    await page.evaluate(() => {
        (window as unknown as { __runEvents: IRunDetail[] }).__runEvents = [];
        document.addEventListener('muya:code-run', (event) => {
            (window as unknown as { __runEvents: IRunDetail[] }).__runEvents.push(
                (event as CustomEvent<IRunDetail>).detail,
            );
        });
    });
}

function runEvents(page: Page): Promise<IRunDetail[]> {
    return page.evaluate(
        () => (window as unknown as { __runEvents: IRunDetail[] }).__runEvents,
    );
}

test.describe('issue #4 — code block run button', () => {
    test('dispatches muya:code-run with the raw code text', async ({ page }) => {
        await page.evaluate(md => window.muya!.setContent(md), '```python\nprint(1)\nprint(2)\n```\n');
        const button = page.locator('a.mu-code-run');
        await expect(button).toHaveCount(1);
        await listenForRunEvents(page);

        // The button is intentionally translucent until hover/active; force
        // the click to verify the wiring rather than the CSS reveal.
        await button.click({ force: true });

        expect(await runEvents(page)).toEqual([{ text: 'print(1)\nprint(2)' }]);
    });

    test('does not stop the copy button from working', async ({ page }) => {
        await page.evaluate(md => window.muya!.setContent(md), '```python\nprint(1)\n```\n');
        await expect(page.locator('a.mu-code-copy')).toHaveCount(1);
        await expect(page.locator('a.mu-code-run')).toHaveCount(1);
        await listenForRunEvents(page);

        await page.locator('a.mu-code-copy').click({ force: true });

        expect(await runEvents(page)).toEqual([]);
    });

    // Playwright's test object has no `.each` (unlike vitest / jest).
    const NON_CODE_CONTAINERS: Array<[string, string]> = [
        ['frontmatter', '---\ntitle: x\n---\n\nbody\n'],
        ['math', '$$\nx = 1\n$$\n'],
        ['diagram', '```mermaid\ngraph TD\n A --> B\n```\n'],
        ['html', '<div>hello</div>\n'],
    ];
    for (const [name, markdown] of NON_CODE_CONTAINERS) {
        test(`is absent on a ${name} container`, async ({ page }) => {
            await page.evaluate(md => window.muya!.setContent(md), markdown);
            await expect(page.locator('a.mu-code-run')).toHaveCount(0);
        });
    }
});
