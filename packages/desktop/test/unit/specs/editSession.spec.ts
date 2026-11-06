import type { IChangeMeta } from '@muyajs/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { transactionHub } from '@/sync/transactionHub'
import {
  activateEdit,
  cancelEdit,
  commitEdit,
  getEditSession,
  getEditSessionDiagnostics,
  notifyDocumentSwitch,
  setCanonicalWriter,
  setDraft,
  type CanonicalBlockWriter
} from '@/sync/editSession'

const states = [
  { name: 'paragraph', text: 'alpha' },
  { name: 'paragraph', text: 'beta' },
  { name: 'paragraph', text: 'gamma' }
]

const makeWriter = (): CanonicalBlockWriter & {
  calls: Array<{ index: number; draft: string; meta: IChangeMeta }>
} => {
  const calls: Array<{ index: number; draft: string; meta: IChangeMeta }> = []
  return {
    calls,
    getBlockMarkdown: (index: number) => states[index]?.text ?? null,
    replaceBlockMarkdown: (index: number, draft: string, meta: IChangeMeta) => {
      calls.push({ index, draft, meta })
      transactionHub.ingest({ op: ['replacement'], source: 'api', txnId: meta.txnId, origin: meta.origin })
      return true
    }
  }
}

let writer: ReturnType<typeof makeWriter>

beforeEach(() => {
  if (getEditSession().active) cancelEdit('user')
  transactionHub.switchDocument()
  transactionHub.blocks.reset(transactionHub.docSessionId)
  transactionHub.blocks.reanchor(states)
  writer = makeWriter()
  setCanonicalWriter(writer)
})

const firstId = (): string => transactionHub.blocks.getIds()[0] ?? ''

describe('projection edit session — sync-design D6 / M2', () => {
  it('activates on a fragment but drafts the whole canonical block', () => {
    expect(activateEdit(firstId(), `${firstId()}:f1`, 'lines:10-20')).toBe(true)
    const state = getEditSession()

    expect(state.active).toBe(true)
    expect(state.index).toBe(0)
    expect(state.draft).toBe('alpha')
    expect(state.fragmentId).toBe(`${firstId()}:f1`)
    expect(state.fragmentRange).toBe('lines:10-20')
    expect(state.baseRevision).toBe(transactionHub.revision)
    expect(state.docSessionId).toBe(transactionHub.docSessionId)
  })

  it('commits the draft as exactly one projection transaction', () => {
    activateEdit(firstId(), '', '')
    setDraft('alpha revised')
    const before = transactionHub.revision

    expect(commitEdit()).toBe(true)
    expect(transactionHub.revision).toBe(before + 1)
    expect(transactionHub.getLog().at(-1)?.origin).toBe('projection')
    expect(writer.calls).toHaveLength(1)
    expect(writer.calls[0]).toMatchObject({ index: 0, draft: 'alpha revised' })
    expect(writer.calls[0].meta.origin).toBe('projection')
    expect(writer.calls[0].meta.txnId).toBeTruthy()
    expect(getEditSession().active).toBe(false)
    expect(getEditSessionDiagnostics().commits).toBeGreaterThan(0)
  })

  it('accepts a rich-text draft supplied only at commit time', () => {
    activateEdit(firstId(), '', '')
    // A Muya block editor keeps the draft inside its own engine; the session
    // only sees the serialization when the user commits.
    expect(commitEdit('alpha from rich text')).toBe(true)
    expect(writer.calls).toHaveLength(1)
    expect(writer.calls[0].draft).toBe('alpha from rich text')
    expect(transactionHub.getLog().at(-1)?.origin).toBe('projection')
  })

  it('drops identity/no-op commits instead of writing fake history', () => {
    const noopWriter: CanonicalBlockWriter = {
      getBlockMarkdown: () => 'alpha',
      replaceBlockMarkdown: () => false
    }
    setCanonicalWriter(noopWriter)
    activateEdit(firstId(), '', '')
    const before = transactionHub.revision

    expect(commitEdit()).toBe(false)
    expect(transactionHub.revision).toBe(before)
    expect(getEditSession().active).toBe(false)
  })

  it('Escape cancels the draft without a transaction', () => {
    activateEdit(firstId(), '', '')
    setDraft('discard me')
    const before = transactionHub.revision
    const cancels = getEditSessionDiagnostics().cancels.user

    cancelEdit('user')
    expect(getEditSession().active).toBe(false)
    expect(getEditSession().notice).toBeNull()
    expect(transactionHub.revision).toBe(before)
    expect(getEditSessionDiagnostics().cancels.user).toBe(cancels + 1)
    expect(writer.calls).toHaveLength(0)
  })

  it('cancels an open draft when a concurrent commit invalidates the baseline', () => {
    activateEdit(firstId(), '', '')
    setDraft('stale draft')

    transactionHub.ingest({ op: ['concurrent'], source: 'user' })

    const state = getEditSession()
    expect(state.active).toBe(false)
    expect(state.notice).toContain('草稿已取消')
    expect(commitEdit()).toBe(false)
    expect(writer.calls).toHaveLength(0)
    expect(getEditSessionDiagnostics().cancels.revision).toBeGreaterThan(0)
  })

  it('cancels on a document switch even though switchDocument has no broadcast', () => {
    activateEdit(firstId(), '', '')
    transactionHub.switchDocument('another-tab')
    notifyDocumentSwitch()

    expect(getEditSession().active).toBe(false)
    expect(getEditSessionDiagnostics().cancels.session).toBeGreaterThan(0)
  })

  it('refuses to write a draft into a block that no longer exists', () => {
    activateEdit(firstId(), '', '')
    transactionHub.blocks.reanchor([
      { name: 'atx-heading', meta: { level: 1 }, text: '# alpha' },
      states[1],
      states[2]
    ])

    expect(commitEdit()).toBe(false)
    expect(writer.calls).toHaveLength(0)
    expect(getEditSessionDiagnostics().cancels.block).toBeGreaterThan(0)
  })

  it('never activates for an unknown block id', () => {
    const spy = vi.spyOn(writer, 'getBlockMarkdown')
    expect(activateEdit('S1:B999', '', '')).toBe(false)
    expect(getEditSession().active).toBe(false)
    expect(spy).not.toHaveBeenCalled()
  })
})
