import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/muya';
import { focusEditor, loadMarkdown, metaKey, slowType } from '../helpers/keyboard';
import { editor } from '../helpers/selectors';

// Read-only lock (`readOnly` option): the document content cannot be edited.
// The lock replaced the desktop's old DOM `beforeinput` guard, which two real
// edit paths slipped straight through — IME composition (its `beforeinput`
// carries `insertCompositionText`, non-cancelable per the Input Events spec,
// so `preventDefault()` is a no-op) and the engine's own keydown-driven
// structural edits (Enter split, block merge), which never surface as native
// editing events at all. The engine now enforces the lock at three layers:
// the editable surface, the event dispatch, and the state commit.

const MARKDOWN = [
    '# title',
    '',
    'first paragraph',
    '',
    '- [ ] task item',
].join('\n');

async function lock(page: Page): Promise<void> {
    await page.evaluate(() => {
        window.muya!.setOptions({ readOnly: true });
    });
}

async function unlock(page: Page): Promise<void> {
    await page.evaluate(() => {
        window.muya!.setOptions({ readOnly: false });
    });
}

/** Current markdown with the serializer's trailing newline normalized away. */
async function currentMarkdown(page: Page): Promise<string> {
    const md = await page.evaluate(() => window.muya!.getMarkdown());
    return md.replace(/\n+$/, '');
}

test.beforeEach(async ({ page }) => {
    await loadMarkdown(page, MARKDOWN);
    await lock(page);
});

test('renders the surface non-editable and keeps it selectable', async ({ page }) => {
    // The container and every content leaf flip to contenteditable=false;
    // the text itself stays selectable for copy.
    await expect(page.locator(editor.root)).toHaveAttribute('contenteditable', 'false');
    await expect(page.locator(editor.content).first()).toHaveAttribute('contenteditable', 'false');
});

test('blocks typed text and insertText (IME-like) input', async ({ page }) => {
    await focusEditor(page);
    await slowType(page, 'ignored');
    // `keyboard.insertText` commits text without key events — the closest
    // automation proxy for a committed IME composition.
    await page.keyboard.insertText('也进不来');

    expect(await currentMarkdown(page)).toBe(MARKDOWN);
});

test('blocks structural keys: Enter, Backspace, Delete, undo', async ({ page }) => {
    await focusEditor(page);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Delete');
    await page.keyboard.press(`${metaKey()}+z`);
    await page.evaluate(() => window.muya!.undo());

    expect(await currentMarkdown(page)).toBe(MARKDOWN);
});

test('blocks paste and cut (copy stays available)', async ({ page }) => {
    await focusEditor(page);
    await page.keyboard.press(`${metaKey()}+a`);
    await page.evaluate(() => {
        window.muya!.editor.clipboard.pasteHandler(new ClipboardEvent('paste'), 'pasted text');
    });
    // Cut routes through copyCutHandler; with the lock on it must degrade to
    // a copy — the document is untouched.
    await page.keyboard.press(`${metaKey()}+x`);

    expect(await currentMarkdown(page)).toBe(MARKDOWN);
});

test('blocks task checkbox toggling', async ({ page }) => {
    // The native input is disabled — clicking it must not toggle it.
    const checkbox = page.locator(`${editor.taskListItem} input[type="checkbox"]`);
    await expect(checkbox).toBeDisabled();
    await checkbox.click({ force: true });
    await expect(checkbox).not.toBeChecked();

    expect(await currentMarkdown(page)).toBe(MARKDOWN);
});

test('unlock restores the editable surface and typing', async ({ page }) => {
    await unlock(page);
    await expect(page.locator(editor.root)).toHaveAttribute('contenteditable', 'true');
    await expect(page.locator(editor.content).first()).toHaveAttribute('contenteditable', 'true');

    await focusEditor(page);
    await page.keyboard.press(`${metaKey()}+a`);
    await slowType(page, 'rewritten');
    expect(await currentMarkdown(page)).toBe('rewritten');
});

