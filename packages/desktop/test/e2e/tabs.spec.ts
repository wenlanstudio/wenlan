import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  getMarkdownContent,
  isActiveTabDirty,
  launchWithMarkdown,
  placeCaretInEditor,
  readActiveTabId,
  readTabCount,
  readTabIds,
  sendIpcToRenderer,
  typeIntoEditor
} from './helpers'

// Open-document ("tab") management. The tab strip itself is gone, so nothing
// renders these documents any more: every assertion below reads the live Pinia
// `editor` store (see helpers.ts), which is the same source the strip used to
// draw from. What is still reachable by a user is: File > New Tab, File > Close
// Tab, Ctrl/Cmd+Tab cycling, opening a file from the side bar tree, and quick
// open — everything these tests drive through its real IPC channel.

// Waits until the window holds `expected` open documents.
const waitForTabCount = async(page: Page, expected: number): Promise<void> => {
  await expect.poll(() => readTabCount(page), { timeout: 5000 }).toBe(expected)
}

test.describe('Open-document management', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown('# Tab base\n')
    app = launched.app
    page = launched.page
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('Initial document loads as a single open document', async() => {
    expect(await readTabCount(page)).toBe(1)
    expect(await readActiveTabId(page)).toBeTruthy()
  })

  test('Creating a new untitled tab grows the document count', async() => {
    const before = await readTabCount(page)
    await sendIpcToRenderer(app, 'mt::new-untitled-tab', true, '')
    await waitForTabCount(page, before + 1)
  })

  test('Creating a new untitled tab auto-focuses the editor', async() => {
    // Drop focus first so the assertion proves the NEW document grabbed focus
    // rather than inheriting a stale one from the previously active editor.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())

    const before = await readTabCount(page)
    await sendIpcToRenderer(app, 'mt::new-untitled-tab', true, '')
    await waitForTabCount(page, before + 1)

    // A freshly created untitled document auto-focuses the WYSIWYG editor: the
    // contenteditable (`.editor-component`) becomes `document.activeElement`,
    // AND a collapsed caret lands inside it — together that's the blinking
    // cursor the user expects without having to click into the editor first.
    const isFocusedWithCaret = () => {
      const root = document.querySelector('.editor-component')
      const active = document.activeElement
      const sel = window.getSelection()
      return (
        !!root &&
        !!active &&
        (root === active || root.contains(active)) &&
        !!sel &&
        sel.rangeCount > 0 &&
        sel.isCollapsed &&
        !!sel.anchorNode &&
        root.contains(sel.anchorNode)
      )
    }
    await page.waitForFunction(isFocusedWithCaret, null, { timeout: 5000 })
    expect(await page.evaluate(isFocusedWithCaret)).toBe(true)
  })

  // Item 251 — switching between two populated documents swaps the editor BODY,
  // not just the selection. Proves UPDATE_CURRENT_FILE -> file-changed ->
  // setContent re-renders the document on every switch.
  test('Switching documents swaps the editor body to match the selection', async() => {
    const before = await readTabCount(page)
    await sendIpcToRenderer(app, 'mt::new-untitled-tab', true, 'second body\n')
    await waitForTabCount(page, before + 1)
    const bId = await readActiveTabId(page)
    expect(bId).toBeTruthy()

    // The newly-selected document B shows B's body.
    await expect
      .poll(async() => (await getMarkdownContent(page, app)).trim(), { timeout: 5000 })
      .toBe('second body')

    // Switch to index 0 — the editor body must revert to A's content and the
    // active document must change away from B.
    await sendIpcToRenderer(app, 'mt::switch-tab-by-index', 0)
    await expect
      .poll(async() => (await getMarkdownContent(page, app)).trim(), { timeout: 5000 })
      .toBe('# Tab base')
    expect(await readActiveTabId(page)).not.toBe(bId)

    // Switch back to B by its id's index — body swaps back to B.
    const ids = await readTabIds(page)
    const bIndex = ids.indexOf(bId as string)
    expect(bIndex).toBeGreaterThanOrEqual(0)
    await sendIpcToRenderer(app, 'mt::switch-tab-by-index', bIndex)
    await expect
      .poll(async() => (await getMarkdownContent(page, app)).trim(), { timeout: 5000 })
      .toBe('second body')
    expect(await readActiveTabId(page)).toBe(bId)
  })

  // Item 262 — a blank untitled document is NOT marked unsaved before any input
  // (the engine's lone-'\n' init json-change is guarded in
  // LISTEN_FOR_CONTENT_CHANGE), and flips to unsaved on the first real keystroke.
  test('Blank untitled document is clean until the first keystroke', async() => {
    const before = await readTabCount(page)
    await sendIpcToRenderer(app, 'mt::new-untitled-tab', true, '')
    await waitForTabCount(page, before + 1)

    // The freshly-created document must stay clean: `file.isSaved` is true
    // before any input. Poll briefly so a late guarded init json-change can't
    // race the assertion.
    await expect.poll(() => isActiveTabDirty(page), { timeout: 3000 }).toBe(false)
    // Hold the clean state for a moment to rule out a delayed dirty flip.
    await page.waitForTimeout(300)
    expect(await isActiveTabDirty(page)).toBe(false)

    // First real character marks the document unsaved.
    await placeCaretInEditor(page)
    await typeIntoEditor(page, 'X')
    await expect.poll(() => isActiveTabDirty(page), { timeout: 5000 }).toBe(true)
  })

  // Item 15 — the engine undo history is per-document (`engineHistoryByTab`),
  // restored on each `file-changed` (switch). After switching back to A, one
  // undo must revert A's OWN last edit back to A's pre-edit (on-disk) baseline,
  // never B's edit; B's edit must never have leaked into A; and the dirty flag
  // must track A's TRUE dirty state across the round-trip (dirty after A's
  // edit, clean once A is undone back to disk).
  test('Per-document undo history survives a document switch', async() => {
    // A: a known saved baseline so the dirty/undo round-trip is observable.
    const aLaunch = await launchWithMarkdown('alpha\n')
    const aApp = aLaunch.app
    const aPage = aLaunch.page
    try {
      // Edit A: append a sentinel so A's engine history has an undo boundary and
      // the document is dirtied. The trailing ' end' padding guards the asserted
      // 'MARKERA' token against the occasional dropped FINAL keystroke when
      // typing into the contenteditable at delay:0.
      await placeCaretInEditor(aPage)
      await typeIntoEditor(aPage, ' MARKERA end')
      await expect
        .poll(async() => (await getMarkdownContent(aPage, aApp)).trim(), { timeout: 5000 })
        .toContain('MARKERA')
      await expect.poll(() => isActiveTabDirty(aPage), { timeout: 5000 }).toBe(true)
      const aTabId = await readActiveTabId(aPage)
      expect(aTabId).toBeTruthy()

      // Open B (auto-selected) and make a DIFFERENT edit in it.
      await sendIpcToRenderer(aApp, 'mt::new-untitled-tab', true, 'bravo\n')
      await waitForTabCount(aPage, 2)
      await aPage.waitForTimeout(250)
      await placeCaretInEditor(aPage)
      await typeIntoEditor(aPage, ' MARKERB end')
      await expect
        .poll(async() => (await getMarkdownContent(aPage, aApp)).trim(), { timeout: 5000 })
        .toContain('MARKERB')

      // Switch back to A by its id's index.
      const ids = await readTabIds(aPage)
      const aIndex = ids.indexOf(aTabId as string)
      expect(aIndex).toBeGreaterThanOrEqual(0)
      await sendIpcToRenderer(aApp, 'mt::switch-tab-by-index', aIndex)
      await expect
        .poll(async() => (await getMarkdownContent(aPage, aApp)).trim(), { timeout: 5000 })
        .toContain('MARKERA')
      // A is shown again (its own edit), B's edit never leaked into A, and A is
      // still dirty from its own un-undone edit.
      expect((await getMarkdownContent(aPage, aApp)).trim()).not.toContain('MARKERB')
      expect(await readActiveTabId(aPage)).toBe(aTabId)
      await expect.poll(() => isActiveTabDirty(aPage), { timeout: 5000 }).toBe(true)

      // Undo against A's RESTORED history reverts A's own edit back to the
      // on-disk baseline 'alpha' — proving the history rode the switch with the
      // right document. The keystroke run may have been recorded as one or
      // (rarely, if a render split it) a few engine undo boundaries, so undo
      // until the document settles on the baseline; each step must keep
      // removing A's text and never resurrect B's.
      await expect
        .poll(
          async() => {
            const current = (await getMarkdownContent(aPage, aApp)).trim()
            if (current === 'alpha') return current
            await sendIpcToRenderer(aApp, 'mt::editor-edit-action', 'undo')
            await aPage.waitForTimeout(300)
            return (await getMarkdownContent(aPage, aApp)).trim()
          },
          { timeout: 8000 }
        )
        .toBe('alpha')
      // It reverted A's edit, NOT B's (B's edit never appears).
      expect((await getMarkdownContent(aPage, aApp)).trim()).not.toContain('MARKERB')
      // Undoing back to the exact on-disk content clears A's dirty flag.
      await expect.poll(() => isActiveTabDirty(aPage), { timeout: 5000 }).toBe(false)
    } finally {
      await aApp.close()
    }
  })
})
