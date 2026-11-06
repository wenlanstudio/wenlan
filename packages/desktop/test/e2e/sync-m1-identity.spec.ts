import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  launchWithMarkdown,
  typeIntoEditor,
  waitForMenuReady
} from './helpers'

// sync-design v2.2 / M1 acceptance: D1 re-anchoring, D5 block/fragment anchors,
// §3 versioned projections. All reads go through the production DOM + the
// read-only __wenlanSync surface; the projections are never written to here.

interface IdentitySnapshot {
  sessionId: string
  blockCount: number
  ambiguousCount: number
  lastReanchorMs: number
  blockIds: string[]
}

interface ProjectionSnapshot {
  applied: number
  discarded: number
  last: {
    docSessionId: string
    docRevision: number
    layoutRevision: number
    projectionRevision: number
  } | null
}

const identity = (page: Page): Promise<IdentitySnapshot | null> =>
  page.evaluate(() => window.__wenlanSync?.getIdentity() ?? null)

const projection = (page: Page): Promise<ProjectionSnapshot | null> =>
  page.evaluate(() => (window.__wenlanSync?.getProjection() ?? null) as ProjectionSnapshot | null)

const revision = (page: Page): Promise<number> =>
  page.evaluate(() => window.__wenlanSync?.getSnapshot().revision ?? -1)

const switcher = (page: Page, label: string) =>
  page.locator('.view-switcher .leaf-btn', { hasText: label })

const paperDeck = (page: Page) => page.locator('.mu-paper-deck[data-page-count]')

/** 单叶「页」全屏：选中页 + 摘掉文，等真分片投影出数。 */
const enterPaperFullscreen = async(page: Page): Promise<void> => {
  const leafBtn = switcher(page, '页')
  const flowBtn = switcher(page, '文')
  await leafBtn.waitFor({ state: 'visible', timeout: 15000 })
  await leafBtn.click()
  await flowBtn.click()
  await paperDeck(page).waitFor({ state: 'visible', timeout: 15000 })
  await page.waitForTimeout(700)
}

/** 返回单叶「文」全屏：选中页 + 摘掉页（与上一步互逆）。 */
const enterFlowFullscreen = async(page: Page): Promise<void> => {
  await switcher(page, '文').click()
  await switcher(page, '页').click()
  await page.locator('.editor-component').waitFor({ state: 'visible', timeout: 15000 })
}

const deckAnchors = (page: Page) =>
  page.evaluate(() => {
    const deck = document.querySelector('.mu-paper-deck') as HTMLElement | null
    if (!deck) return null
    const nodes = Array.from(deck.querySelectorAll<HTMLElement>('[data-block-id]'))
    return {
      docSessionId: deck.dataset.docSessionId ?? '',
      docRevision: Number(deck.dataset.docRevision ?? -1),
      projectionRevision: Number(deck.dataset.projectionRevision ?? -1),
      blockIds: nodes.map(node => node.dataset.blockId ?? ''),
      fragmentIds: nodes.map(node => node.dataset.fragmentId ?? ''),
      fragmentKinds: nodes.map(node => node.dataset.fragmentKind ?? ''),
      fragmentRanges: nodes.map(node => node.dataset.fragmentRange ?? '')
    }
  })

test.describe.configure({ mode: 'serial' })

test.describe('M1 identity and versioned projections', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown(
      'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n\nFourth paragraph.\n'
    )
    app = launched.app
    page = launched.page
    await waitForMenuReady(app)
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('the live engine tags every canonical block with a session id', async() => {
    const ids = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('.editor-component .mu-container > [data-block-id]'))
        .map(node => node.dataset.blockId ?? '')
    )
    const state = await identity(page)

    expect(ids.length).toBeGreaterThanOrEqual(4)
    expect(new Set(ids).size).toBe(ids.length)
    expect(state?.blockIds).toEqual(expect.arrayContaining(ids))
    expect(state?.sessionId).toMatch(/^S\d+$/)
  })

  test('the paper projection stamps versions and block anchors', async() => {
    await enterPaperFullscreen(page)
    const anchors = await deckAnchors(page)
    const state = await identity(page)
    const versions = await projection(page)

    expect(anchors).not.toBeNull()
    expect(anchors?.docSessionId).toBe(state?.sessionId)
    expect(anchors?.docRevision).toBe(await revision(page))
    expect(anchors?.projectionRevision).toBeGreaterThan(0)
    expect(anchors?.blockIds.length).toBeGreaterThanOrEqual(4)
    for (const id of anchors?.blockIds ?? []) {
      expect(state?.blockIds).toContain(id)
    }
    expect(versions?.applied).toBeGreaterThan(0)
    expect(versions?.last?.projectionRevision).toBe(anchors?.projectionRevision)
  })

  test('untouched blocks keep their ids across an edit', async() => {
    await enterFlowFullscreen(page)
    const before = await identity(page)
    const beforeRevision = await revision(page)

    await typeIntoEditor(page, ' EDITED')
    await expect.poll(() => revision(page)).toBeGreaterThan(beforeRevision)
    await page.waitForTimeout(300)

    const after = await identity(page)
    const changed = (after?.blockIds ?? []).filter(
      (id, index) => before?.blockIds[index] !== id
    )
    expect(changed.length).toBeLessThanOrEqual(2)
    // At least one unrelated block must keep its identity.
    const stable = (after?.blockIds ?? []).filter(id => before?.blockIds.includes(id))
    expect(stable.length).toBeGreaterThanOrEqual(2)
    expect(after?.sessionId).toBe(before?.sessionId)
  })

  test('the rebuilt projection consumes the current revision and ids', async() => {
    await enterPaperFullscreen(page)
    const current = await revision(page)
    await expect
      .poll(async() => (await deckAnchors(page))?.docRevision, { timeout: 10000 })
      .toBe(current)

    const anchors = await deckAnchors(page)
    const state = await identity(page)
    expect(anchors?.docSessionId).toBe(state?.sessionId)
    for (const id of anchors?.blockIds ?? []) {
      expect(state?.blockIds).toContain(id)
    }
  })

  test('a pure projection refresh never creates a transaction', async() => {
    const before = await revision(page)
    await enterFlowFullscreen(page)
    await enterPaperFullscreen(page)
    expect(await revision(page)).toBe(before)
  })
})

test('a block split across pages exposes multiple fragment anchors', async() => {
  test.setTimeout(120_000)
  const bigPara = Array.from(
    { length: 60 },
    (_, i) => `Line ${String(i + 1).padStart(2, '0')} of a paragraph that is deliberately taller than one A4 page.`
  ).join('\n')
  const doc = `${'Intro paragraph.\n\n'.repeat(20)}${bigPara}\n\nTail paragraph.\n`

  const launched = await launchWithMarkdown(doc)
  try {
    await waitForMenuReady(launched.app)
    await enterPaperFullscreen(launched.page)
    await expect
      .poll(async() => Number(await paperDeck(launched.page).getAttribute('data-page-count')))
      .toBeGreaterThan(2)

    const anchors = await deckAnchors(launched.page)
    expect(anchors).not.toBeNull()
    const byBlock = new Map<string, Set<string>>()
    ;(anchors?.blockIds ?? []).forEach((id, index) => {
      const fragments = byBlock.get(id) ?? new Set<string>()
      fragments.add(anchors?.fragmentIds[index] ?? '')
      byBlock.set(id, fragments)
    })
    const split = [...byBlock.values()].find(fragments => fragments.size > 1)
    expect(split, 'one canonical block should appear in several fragments').toBeDefined()

    // The first fragment is the canonical (un-cloned) node; continuations carry
    // their own logical range.
    const splitId = [...byBlock.entries()].find(([, frags]) => frags.size > 1)?.[0]
    expect(split?.has(`${splitId}:f0`)).toBe(true)
    expect((anchors?.fragmentRanges ?? []).some(range => /^lines:\d+-\d+$/.test(range))).toBe(true)

    const versions = await projection(launched.page)
    expect(versions?.last?.docRevision).toBe(await revision(launched.page))
  } finally {
    await launched.app.close()
  }
})
