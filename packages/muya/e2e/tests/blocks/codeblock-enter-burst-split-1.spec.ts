import type { TState } from '@muyajs/core';
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/muya';
import { getMarkdown } from '../helpers/api';
import { slowType } from '../helpers/keyboard';
import { editor, toolbar } from '../helpers/selectors';

// Issue #1: three Enters pressed in quick succession split a fenced code
// block at the caret (Shimo-style gesture). These are REAL browser keystrokes,
// not state-level unit tests — the burst window, caret placement, undo
// granularity and markdown round-trip are all user-visible "feel".

async function loadCode(page: Page, markdown: string): Promise<void> {
    await page.evaluate(md => window.muya!.setContent(md), markdown);
    await expect(page.locator(editor.codeBlock).first()).toBeVisible();
}

async function codeText(page: Page, index = 0): Promise<string> {
    return page.locator(editor.codeContent).nth(index).evaluate(el => el.textContent ?? '');
}

/** Put the caret `fromEnd` characters before the end of a single-line code block. */
async function placeCaret(page: Page, fromEnd: number): Promise<void> {
    await page.locator(editor.codeContent).first().click();
    await page.keyboard.press('End');
    for (let i = 0; i < fromEnd; i++)
        await page.keyboard.press('ArrowLeft');
}

/**
 * Put the caret at an exact text offset. Arrow keys move by VISUAL line, so
 * a wrapped long line makes them useless for placing the caret on a specific
 * logical line — set the cursor on the muya Content instead.
 */
async function placeCaretAtOffset(page: Page, offset: number): Promise<void> {
    await page.locator(editor.codeContent).first().click();
    await page.evaluate((o) => {
        interface IBlock {
            constructor: { blockName?: string };
            children?: { forEach: (cb: (b: unknown) => void) => void };
        }
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

/** Three real Enters with no artificial delay — well inside the 500ms window. */
async function burst(page: Page): Promise<void> {
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
}

test.describe('issue #1 — triple-Enter splits a fenced code block', () => {
    test('splits at the caret, inherits the language and consumes the newlines', async ({ page }) => {
        await loadCode(page, '```js\nabcd\n```\n');
        await placeCaret(page, 2); // ab|cd
        await burst(page);

        await expect(page.locator(editor.codeBlock)).toHaveCount(2);
        await expect.poll(() => codeText(page, 0)).toBe('ab');
        await expect.poll(() => codeText(page, 1)).toBe('cd');
        await expect(page.locator(editor.languageInput).nth(0)).toHaveText('js');
        await expect(page.locator(editor.languageInput).nth(1)).toHaveText('js');

        const md = await getMarkdown(page);
        expect(md).toContain('```js\nab\n```');
        expect(md).toContain('```js\ncd\n```');
        expect(md.match(/```js/g)).toHaveLength(2);
        // The three newlines were consumed, not left behind as trailing /
        // leading empty lines. Two adjacent blocks are separated by one
        // blank line, so a run of three newlines would be a leak.
        expect(md).not.toContain('\n\n\n');
    });

    test('puts the caret at the start of the new block so typing continues there', async ({ page }) => {
        await loadCode(page, '```js\nabcd\n```\n');
        await placeCaret(page, 2);
        await burst(page);

        await expect(page.locator(editor.codeBlock)).toHaveCount(2);
        await slowType(page, 'X');
        await expect.poll(() => codeText(page, 1)).toBe('Xcd');
        await expect.poll(() => codeText(page, 0)).toBe('ab');
    });

    test('inherits a tilde fence instead of rewriting it to backticks', async ({ page }) => {
        await loadCode(page, '~~~js\nabcd\n~~~\n');
        await placeCaret(page, 2);
        await burst(page);

        await expect(page.locator(editor.codeBlock)).toHaveCount(2);
        const md = await getMarkdown(page);
        expect(md.match(/~~~js/g)).toHaveLength(2);
        expect(md).not.toContain('```');
    });

    test('one undo restores the original single block', async ({ page }) => {
        await loadCode(page, '```js\nabcd\n```\n');
        await placeCaret(page, 2);
        await burst(page);
        await expect(page.locator(editor.codeBlock)).toHaveCount(2);

        // @muyajs/core does not bind a keyboard shortcut; the host wires
        // undo itself (desktop binds Ctrl/Cmd+Z, this SUT exposes a button).
        await page.locator(toolbar.undo).click();

        await expect(page.locator(editor.codeBlock)).toHaveCount(1);
        await expect.poll(() => codeText(page, 0)).toBe('abcd');
        expect(await getMarkdown(page)).toContain('```js\nabcd\n```');
    });
});

test.describe('issue #1 — the gesture only fires on a fast, uninterrupted burst', () => {
    test.beforeEach(async ({ page }) => {
        await loadCode(page, '```js\nabcd\n```\n');
        await placeCaret(page, 2);
    });

    test('slow Enters stay as three newlines inside one block', async ({ page }) => {
        for (let i = 0; i < 3; i++) {
            await page.keyboard.press('Enter');
            if (i < 2)
                await page.waitForTimeout(650);
        }

        await expect(page.locator(editor.codeBlock)).toHaveCount(1);
        await expect.poll(() => codeText(page)).toBe('ab\n\n\ncd');
    });

    test('typing between Enters breaks the burst', async ({ page }) => {
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');
        await slowType(page, 'x');
        await page.keyboard.press('Enter');

        await expect(page.locator(editor.codeBlock)).toHaveCount(1);
        await expect.poll(() => codeText(page)).toBe('ab\n\nx\ncd');
    });

    test('moving the caret between Enters breaks the burst', async ({ page }) => {
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('Enter');

        await expect(page.locator(editor.codeBlock)).toHaveCount(1);
    });

    test('Shift+Enter breaks the burst', async ({ page }) => {
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');
        await page.keyboard.press('Shift+Enter');
        await page.keyboard.press('Enter');

        await expect(page.locator(editor.codeBlock)).toHaveCount(1);
    });
});

test.describe('issue #1 — splitting on a line boundary / at the end of the block', () => {
    const A = '(new String("a").hashCode() & Integer.MAX_VALUE) % 3;';
    const B = '(new String("b").hashCode() & Integer.MAX_VALUE) % 3;';
    const C = '(new String("c").hashCode() & Integer.MAX_VALUE) % 3;';
    const FENCE = '```';
    const THREE_LINES = `${FENCE}jshell\n${A}\n${B}\n${C}\n${FENCE}\n`;
    const END_OF_B = `${A}\n${B}`.length;
    const START_OF_C = `${A}\n${B}\n`.length;

    test('caret at the end of a line: neither block is padded with blank lines', async ({ page }) => {
        await loadCode(page, THREE_LINES);
        await placeCaretAtOffset(page, END_OF_B); // end of line b
        await burst(page);

        await expect(page.locator(editor.codeBlock)).toHaveCount(2);
        await expect.poll(() => codeText(page, 0)).toBe(
            '(new String("a").hashCode() & Integer.MAX_VALUE) % 3;\n(new String("b").hashCode() & Integer.MAX_VALUE) % 3;',
        );
        await expect.poll(() => codeText(page, 1)).toBe(
            '(new String("c").hashCode() & Integer.MAX_VALUE) % 3;',
        );

        const md = await getMarkdown(page);
        expect(md).not.toContain('```jshell\n\n'); // no leading empty line
        // Two blocks are legitimately separated by one blank line, so match
        // the trailing empty line against the last code line instead.
        expect(md).not.toContain(`${B}\n\n${FENCE}`);
        expect(md.match(/```jshell/g)).toHaveLength(2);
    });

    test('caret at the start of a line: no trailing empty line in the first block', async ({ page }) => {
        await loadCode(page, THREE_LINES);
        await placeCaretAtOffset(page, START_OF_C); // start of line c
        await burst(page);

        await expect(page.locator(editor.codeBlock)).toHaveCount(2);
        await expect.poll(() => codeText(page, 0)).toBe(
            '(new String("a").hashCode() & Integer.MAX_VALUE) % 3;\n(new String("b").hashCode() & Integer.MAX_VALUE) % 3;',
        );
        await expect.poll(() => codeText(page, 1)).toBe(
            '(new String("c").hashCode() & Integer.MAX_VALUE) % 3;',
        );
        expect(await getMarkdown(page)).not.toContain('```jshell\n\n');
    });

    test('markdown round-trip (source view ↔ editor) stays identical', async ({ page }) => {
        await loadCode(page, THREE_LINES);
        await placeCaretAtOffset(page, END_OF_B);
        await burst(page);
        const md = await getMarkdown(page);

        // Switching leaves re-parses the markdown. A stray separator used to
        // survive in the state while the WYSIWYG leaf hid the empty line.
        await page.evaluate(m => window.muya!.setContent(m), md);

        await expect(page.locator(editor.codeBlock)).toHaveCount(2);
        await expect.poll(() => codeText(page, 1)).toBe(
            '(new String("c").hashCode() & Integer.MAX_VALUE) % 3;',
        );
        expect(await getMarkdown(page)).toBe(md);
    });

    test('caret at the very end: new block has one blank line and inherits the fence', async ({ page }) => {
        await loadCode(page, '~~~jshell\na\nb\n~~~\n');
        await page.locator(editor.codeContent).first().click();
        await page.keyboard.press('Control+End');
        await burst(page);

        await expect(page.locator(editor.codeBlock)).toHaveCount(2);
        await expect.poll(() => codeText(page, 0)).toBe('a\nb');
        await expect.poll(() => codeText(page, 1)).toBe('');

        const md = await getMarkdown(page);
        expect(md).toContain('~~~jshell\na\nb\n~~~');
        expect(md).toContain('~~~jshell\n\n~~~'); // exactly one blank line
        expect(md.match(/~~~jshell/g)).toHaveLength(2);
    });
});

test.describe('issue #1 — content, not gesture', () => {
    test('three newlines loaded via setContent never split the block', async ({ page }) => {
        await loadCode(page, '```js\na\n\n\nb\n```\n');

        await expect(page.locator(editor.codeBlock)).toHaveCount(1);
        await expect.poll(() => codeText(page)).toBe('a\n\n\nb');
    });

    test('three Enters inside frontmatter do not split it', async ({ page }) => {
        await page.evaluate(() => {
            const state: TState[] = [{
                name: 'frontmatter',
                meta: { lang: 'yaml', style: '-' },
                text: 'title: hi',
            }];
            window.muya!.setContent(state);
        });
        await expect(page.locator(editor.frontmatter)).toBeVisible();
        await page.locator(`${editor.frontmatter} ${editor.codeContent}`).click();
        await page.keyboard.press('End');
        await burst(page);

        await expect(page.locator(editor.frontmatter)).toHaveCount(1);
        expect((await getMarkdown(page)).match(/---/g)).toHaveLength(2);
    });

    test('an indented code block has no fence to split into', async ({ page }) => {
        await loadCode(page, '    abcd\n');
        await expect(page.locator(editor.codeBlock).first()).toHaveClass(/mu-indented-code/);
        await placeCaret(page, 2);
        await burst(page);

        // Two adjacent indented blocks cannot be expressed in markdown (they
        // would merge back into one on save), so the gesture must not fire.
        await expect(page.locator(editor.codeBlock)).toHaveCount(1);
        await expect.poll(() => codeText(page)).toBe('ab\n\n\ncd');
        expect(await getMarkdown(page)).toContain('    ab');
    });
});
