import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  launchWithMarkdown,
  sendIpcToRenderer,
  setSourceMarkdown,
  typeIntoEditor
} from './helpers'

// sync-design v2.2 / M0 acceptance: one transaction stream, one Revision chain,
// one doc-changed broadcast per committed Txn. The hub exposes a READ-ONLY
// snapshot (`window.__wenlanSync`) so these assertions can observe ordering
// without monkey-patching the editor or reaching into Vue internals.

interface SyncSnapshot {
  docSessionId: string
  revision: number
  broadcastCount: number
  suppressedEchoes: number
  failedApplies: number
  origins: string[]
  pendingTxnId: string | null
  queueLength: number
}

const snapshot = (page: Page): Promise<SyncSnapshot> =>
  page.evaluate(() => {
    const state = window.__wenlanSync?.getSnapshot()
    if (!state) throw new Error('__wenlanSync debug surface is not installed')
    return state
  })

// Same `mt::update-file` shape the main-process watcher sends; drives
// store/editor.ts LISTEN_FOR_FILE_CHANGE -> loadChange -> file-changed(isReload)
// -> editor.vue handleFileChange -> replaceContent (an external apply).
const reportExternalChange = async(
  app: ElectronApplication,
  pathname: string,
  markdown: string
): Promise<void> => {
  await sendIpcToRenderer(app, 'mt::update-file', {
    type: 'change',
    change: {
      pathname,
      mtimeMs: 1,
      data: {
        markdown,
        filename: 'note.md',
        pathname,
        encoding: { encoding: 'utf8', hasBOM: false },
        lineEnding: 'lf',
        adjustLineEndingOnSave: false,
        trimTrailingNewline: 1,
        isMixedLineEndings: false
      }
    }
  })
}

test.describe.configure({ mode: 'serial' })

test.describe('M0 unified transaction stream', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown('# Hello\n\nStarting paragraph.\n')
    app = launched.app
    page = launched.page
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('starts a clean document session with no pending intents', async() => {
    const state = await snapshot(page)
    expect(state.docSessionId).toMatch(/^S\d+$/)
    expect(state.failedApplies).toBe(0)
    expect(state.queueLength).toBe(0)
    expect(state.pendingTxnId).toBeNull()
  })

  test('self-sourced typing produces only muya transactions and one broadcast each', async() => {
    const before = await snapshot(page)
    await typeIntoEditor(page, ' sync-token')
    await expect
      .poll(async() => (await snapshot(page)).revision)
      .toBeGreaterThan(before.revision)

    const after = await snapshot(page)
    const added = after.origins.slice(before.origins.length)
    expect(added.length).toBeGreaterThan(0)
    expect(added.every(origin => origin === 'muya')).toBe(true)
    // D2: self-sourced edits are wrapped once, never applied or broadcast twice.
    expect(after.broadcastCount - before.broadcastCount).toBe(after.revision - before.revision)
    expect(after.pendingTxnId).toBeNull()
  })

  test('source-mode handoff submits exactly one external transaction', async() => {
    const before = await snapshot(page)
    await setSourceMarkdown(page, app, '# Hello\n\nEdited in source mode.\n')

    // The live engine stays mounted in source mode, so the CodeMirror ->
    // WYSIWYG handoff reaches `replaceContent`: one external intent, one Txn,
    // one broadcast. Entering source mode may flush a pending self-sourced
    // batch, which is why only the source count is pinned.
    await expect
      .poll(async() => (await snapshot(page)).origins.filter(origin => origin === 'source').length)
      .toBe(before.origins.filter(origin => origin === 'source').length + 1)

    const after = await snapshot(page)
    expect(after.broadcastCount - before.broadcastCount).toBe(after.revision - before.revision)
    expect(after.pendingTxnId).toBeNull()
    expect(after.failedApplies).toBe(0)
    expect(after.docSessionId).toBe(before.docSessionId)
  })

  test('external disk reload submits exactly one disk transaction', async() => {
    // A fresh window keeps the tab clean so `loadChange` reloads silently.
    const fresh = await launchWithMarkdown('old content here\n')
    try {
      await sendIpcToRenderer(fresh.app, 'mt::user-preference', { autoSave: true })
      await fresh.page.waitForTimeout(100)
      const before = await snapshot(fresh.page)

      await reportExternalChange(fresh.app, fresh.filePath, 'new content here\n')
      await expect
        .poll(async() => (await snapshot(fresh.page)).origins.filter(origin => origin === 'disk').length)
        .toBeGreaterThan(before.origins.filter(origin => origin === 'disk').length)

      const after = await snapshot(fresh.page)
      expect(after.origins.filter(origin => origin === 'disk')).toHaveLength(1)
      // The engine's json-change is only a confirmation: one apply, one Txn,
      // one broadcast, no second Revision (D2).
      expect(after.broadcastCount - before.broadcastCount).toBe(after.revision - before.revision)
      expect(after.pendingTxnId).toBeNull()
      expect(after.failedApplies).toBe(0)
    } finally {
      await fresh.app.close()
    }
  })

  test('undo is attributed and stays on the same Revision chain', async() => {
    // Seed a definite undoable edit so the test does not depend on how much
    // history the source-mode handoff left in the engine's undo stack.
    const typed = await snapshot(page)
    await typeIntoEditor(page, ' undo-me')
    await expect
      .poll(async() => (await snapshot(page)).revision)
      .toBeGreaterThan(typed.revision)

    const before = await snapshot(page)
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await expect
      .poll(async() => (await snapshot(page)).origins.at(-1))
      .toBe('undo')

    const after = await snapshot(page)
    expect(after.broadcastCount - before.broadcastCount).toBe(after.revision - before.revision)
    expect(after.docSessionId).toBe(before.docSessionId)
  })

  test('exposes stale-result guards for asynchronous projections', async() => {
    const guards = await page.evaluate(() => {
      const sync = window.__wenlanSync
      if (!sync) return null
      return {
        stale: sync.isStale(0),
        fresh: sync.isStale(sync.getSnapshot().revision)
      }
    })
    expect(guards).toEqual({ stale: true, fresh: false })
  })
})
