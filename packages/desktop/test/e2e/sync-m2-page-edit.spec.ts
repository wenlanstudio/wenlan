import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  launchWithMarkdown,
  sendIpcToRenderer,
  waitForMenuReady
} from './helpers'

// sync-design v2.2 / M2 acceptance: the page leaf's true-fragment projection
// becomes an editable surface through a STABLE edit layer. A fragment only
// locates the edit; the draft always belongs to the complete canonical block,
// and commit/undo flow through the M0 transaction stream.

interface SyncSnapshot {
  revision: number
  broadcastCount: number
}
interface EditSnapshot {
  state: {
    active: boolean
    blockId: string
    fragmentId: string
    draft: string
    notice: string | null
  }
  diagnostics: {
    activations: number
    commits: number
    cancels: Record<string, number>
  }
}

const snapshot = (page: Page): Promise<SyncSnapshot> =>
  page.evaluate(() => window.__wenlanSync?.getSnapshot() as SyncSnapshot)

const editSnapshot = (page: Page): Promise<EditSnapshot> =>
  page.evaluate(() => window.__wenlanSync?.getEditSession() as EditSnapshot)

const origins = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    (window.__wenlanSync?.getLog() ?? []).map(txn => (txn as { origin: string }).origin)
  )

const switcher = (page: Page, label: string) =>
  page.locator('.view-switcher .leaf-btn', { hasText: label })

const enterPaperFullscreen = async(page: Page): Promise<void> => {
  const leafBtn = switcher(page, '页')
  const flowBtn = switcher(page, '文')
  await leafBtn.waitFor({ state: 'visible', timeout: 15000 })
  await leafBtn.click()
  await flowBtn.click()
  await page.locator('.mu-paper-deck[data-page-count]').waitFor({ state: 'visible', timeout: 15000 })
  await page.waitForTimeout(700)
}

const editorLayer = (page: Page) => page.locator('.mu-paper-edit-layer')
/** The edit layer is a writable Muya instance, not a markdown textarea. */
const draftInput = (page: Page) =>
  page.locator('.mu-paper-edit-layer .mu-editor[contenteditable="true"]')

/** Wait until the projection has consumed the current doc-changed Revision. */
const waitForProjectionRevision = async(page: Page): Promise<void> => {
  const current = (await snapshot(page)).revision
  await expect
    .poll(
      async() => Number(await page.locator('.mu-paper-deck').getAttribute('data-doc-revision')),
      { timeout: 10000 }
    )
    .toBe(current)
}

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

test.describe('M2 page-leaf single-block editing', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown(
      'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n'
    )
    app = launched.app
    page = launched.page
    await waitForMenuReady(app)
    await enterPaperFullscreen(page)
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('clicking a fragment opens a stable layer for the WHOLE canonical block', async() => {
    const block = page.locator('.mu-paper-deck [data-block-id]').first()
    const blockId = await block.getAttribute('data-block-id')
    await block.click()

    await editorLayer(page).waitFor({ state: 'visible', timeout: 5000 })
    expect(await editorLayer(page).getAttribute('data-block-id')).toBe(blockId)
    expect(await draftInput(page).innerText()).toContain('First paragraph.')
    expect(await editorLayer(page).locator('textarea').count()).toBe(0)
    expect(await page.locator('.mu-paper-deck.is-editing').count()).toBe(1)
    const session = await editSnapshot(page)
    expect(session.state.active).toBe(true)
    expect(session.state.blockId).toBe(blockId)
  })

  test('Ctrl+Enter commits one projection transaction (IME text included)', async() => {
    const before = await snapshot(page)
    await draftInput(page).click()
    await page.keyboard.press('End')
    await page.keyboard.insertText(' 中文输入')
    // A single composition + commit must remain ONE undo boundary.
    await page.keyboard.press('Control+Enter')

    await expect.poll(() => snapshot(page).then(s => s.revision)).toBeGreaterThan(before.revision)
    const log = await origins(page)
    expect(log.at(-1)).toBe('projection')
    await editorLayer(page).waitFor({ state: 'detached', timeout: 5000 })

    await expect
      .poll(() => page.locator('.mu-paper-deck').innerText(), { timeout: 10000 })
      .toContain('中文输入')
    const session = await editSnapshot(page)
    expect(session.diagnostics.commits).toBe(1)
    expect(session.state.active).toBe(false)
  })

  test('undo reverts the projection edit through the shared history', async() => {
    const before = await snapshot(page)
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')

    await expect.poll(() => snapshot(page).then(s => s.revision)).toBeGreaterThan(before.revision)
    expect((await origins(page)).at(-1)).toBe('undo')
    await expect
      .poll(() => page.locator('.mu-paper-deck').innerText(), { timeout: 10000 })
      .not.toContain('中文输入')
    await waitForProjectionRevision(page)
  })

  test('Escape discards a draft without creating a transaction', async() => {
    await waitForProjectionRevision(page)
    const before = await snapshot(page)
    await page.locator('.mu-paper-deck [data-block-id]').first().click()
    await editorLayer(page).waitFor({ state: 'visible', timeout: 5000 })
    await draftInput(page).click()
    await page.keyboard.insertText(' DISCARD ME')
    await page.keyboard.press('Escape')

    await editorLayer(page).waitFor({ state: 'detached', timeout: 5000 })
    expect((await snapshot(page)).revision).toBe(before.revision)
    expect(await page.locator('.mu-paper-deck').innerText()).not.toContain('DISCARD ME')
    const session = await editSnapshot(page)
    expect(session.state.active).toBe(false)
    expect(session.diagnostics.cancels.user).toBeGreaterThan(0)
  })

  test('a pure projection refresh never creates a transaction', async() => {
    const before = await snapshot(page)
    await page.waitForTimeout(400)
    expect((await snapshot(page)).revision).toBe(before.revision)
  })
})

test('the edit layer renders rich text, not markdown source', async() => {
  test.setTimeout(120_000)
  const launched = await launchWithMarkdown('# Heading one\n\nBody text.\n')
  try {
    const { app, page } = launched
    await waitForMenuReady(app)
    await enterPaperFullscreen(page)

    await page.locator('.mu-paper-deck [data-block-id]').first().click()
    await editorLayer(page).waitFor({ state: 'visible', timeout: 5000 })

    const layer = editorLayer(page)
    expect(await layer.locator('.mu-editor[contenteditable="true"]').count()).toBe(1)
    expect(await layer.locator('textarea').count()).toBe(0)
    // A heading becomes a rendered h1 block, exactly as in the WYSIWYG flow leaf.
    expect(await layer.locator('h1.mu-atx-heading').count()).toBeGreaterThan(0)
    expect(await layer.innerText()).toContain('Heading one')

    // Typing lands directly in the rendered engine — no source textarea.
    // Muya shows its own inline markers in edit mode (same as the flow leaf),
    // so assert that the input reached the contenteditable, not its exact block.
    await draftInput(page).click()
    await page.keyboard.press('End')
    await page.keyboard.insertText('!')
    expect(await draftInput(page).innerText()).toContain('!')
    await page.keyboard.press('Escape')
    await editorLayer(page).waitFor({ state: 'detached', timeout: 5000 })
  } finally {
    await launched.app.close()
  }
})

test('a continuation fragment resolves the same canonical block', async() => {
  test.setTimeout(120_000)
  const bigPara = Array.from(
    { length: 60 },
    (_, i) => `Line ${String(i + 1).padStart(2, '0')} of a paragraph taller than one A4 page.`
  ).join('\n')
  const doc = `${'Intro paragraph.\n\n'.repeat(20)}${bigPara}\n\nTail paragraph.\n`

  const launched = await launchWithMarkdown(doc)
  try {
    await waitForMenuReady(launched.app)
    await enterPaperFullscreen(launched.page)
    await expect
      .poll(async() => Number(await launched.page.locator('.mu-paper-deck').getAttribute('data-page-count')))
      .toBeGreaterThan(2)

    const continuation = launched.page.locator('.mu-paper-deck [data-fragment-id$=":f1"]').first()
    await expect(continuation).toBeVisible()
    const blockId = await continuation.getAttribute('data-block-id')
    await continuation.click()

    await editorLayer(launched.page).waitFor({ state: 'visible', timeout: 5000 })
    expect(await editorLayer(launched.page).getAttribute('data-block-id')).toBe(blockId)
    // The draft is the whole block, not the clipped continuation.
    const value = await draftInput(launched.page).innerText()
    expect(value).toContain('Line 01')
    expect(value).toContain('Line 60')
  } finally {
    await launched.app.close()
  }
})

test('an external reload cancels an open draft instead of writing an old version', async() => {
  test.setTimeout(120_000)
  const launched = await launchWithMarkdown('Original line.\n')
  try {
    const { app, page, filePath } = launched
    await waitForMenuReady(app)
    await sendIpcToRenderer(app, 'mt::user-preference', { autoSave: true })
    await page.waitForTimeout(100)
    await enterPaperFullscreen(page)

    await page.locator('.mu-paper-deck [data-block-id]').first().click()
    await editorLayer(page).waitFor({ state: 'visible', timeout: 5000 })
    await draftInput(page).click()
    await page.keyboard.insertText(' Stale draft')
    const before = await snapshot(page)

    await reportExternalChange(app, filePath, 'Reloaded on disk.\n')
    await expect.poll(() => snapshot(page).then(s => s.revision)).toBeGreaterThan(before.revision)

    await editorLayer(page).waitFor({ state: 'detached', timeout: 5000 })
    expect((await origins(page)).at(-1)).toBe('disk')
    expect(await page.locator('.mu-paper-edit-notice').innerText()).toContain('草稿已取消')
    const session = await editSnapshot(page)
    expect(session.diagnostics.cancels.revision).toBeGreaterThan(0)
    expect(session.state.active).toBe(false)
  } finally {
    await launched.app.close()
  }
})
