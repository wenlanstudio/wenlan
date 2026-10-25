import { expect, test } from '../fixtures/muya';

// The desktop Columns view is a lens on the editor engine (`editor.vue` toggles
// `mu-columns-layout` on the engine root) — the same engine with the `columns`
// layout: a column group is a node of the block tree, so the engine
// renders the columns itself and the DOM mirrors the tree. These specs pin that
// contract — without `init()` there is no container at all, and a column group
// that never reached the tree would lay out zero columns.
const DOC = [
    '# Title',
    '',
    '<!-- begin -->',
    '',
    'Column A',
    '',
    '<!-- split -->',
    '',
    'Column B',
    '',
    '<!-- end -->',
    '',
    'Tail paragraph.',
    '',
].join('\n');

test.describe('columns: editor layout', () => {
    test('init() produces a .mu-container holding the top-level blocks', async ({ page }) => {
        const structure = await page.evaluate(() => {
            const container = window.muya!.domNode.querySelector('.mu-container');

            return {
                hasContainer: Boolean(container),
                isEditorChild: container?.parentElement?.classList.contains('mu-editor') ?? false,
                blocks: container ? container.children.length : 0,
            };
        });

        expect(structure.hasContainer).toBe(true);
        expect(structure.isEditorChild).toBe(true);
        expect(structure.blocks).toBeGreaterThan(0);
    });

    test('the columns layout lays the markers out as real columns', async ({ page }) => {
        const result = await page.evaluate(
            (markdown) => window.__e2e!.columnsLayout(markdown),
            DOC,
        );

        expect(result).not.toBeNull();
        expect(result!.groups).toBe(1);
        expect(result!.cols).toHaveLength(2);
        // Both columns must be laid out side by side with real width — this is
        // what the empty Columns view was missing.
        expect(result!.cols[0]!.width).toBeGreaterThan(0);
        expect(result!.cols[1]!.width).toBeGreaterThan(0);
        expect(result!.cols[0]!.text).toContain('Column A');
        expect(result!.cols[1]!.text).toContain('Column B');
    });

    test('content outside the group stays in the flow', async ({ page }) => {
        await page.evaluate((markdown) => window.__e2e!.columnsLayout(markdown), DOC);

        const outside = await page.evaluate(() => {
            const container = window.muya!.domNode.querySelector('.mu-container')!;

            return [...container.children]
                .filter((el) => !el.classList.contains('mu-columns'))
                .map((el) => el.textContent?.trim() ?? '');
        });

        expect(outside.join(' | ')).toContain('Title');
        expect(outside.join(' | ')).toContain('Tail paragraph.');
    });

    test('a content swap does not duplicate blocks', async ({ page }) => {
        await page.evaluate((markdown) => window.__e2e!.columnsLayout(markdown), DOC);

        const second = await page.evaluate(
            (markdown) => window.__e2e!.columnsLayout(markdown.replace('Column A', 'Column X')),
            DOC,
        );

        expect(second!.cols).toHaveLength(2);
        expect(second!.cols[0]!.text).toContain('Column X');
        expect(second!.cols[0]!.text).not.toContain('Column A');
    });
});
