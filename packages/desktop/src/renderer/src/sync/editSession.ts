import type { IChangeMeta } from '@muyajs/core'
import { changeMetaFor, transactionHub } from './transactionHub'

// sync-design D6 / M2. A single-block edit session on a projection.
//
// The nine editable surfaces share one rule: a projection node only LOCATES the
// edit; the draft always belongs to the COMPLETE canonical block and is written
// back through the M0 transaction stream. Nothing is ever edited inside a
// clipped / translated / overflow-hidden fragment clone.

export interface CanonicalBlockWriter {
  getBlockMarkdown(index: number): string | null
  replaceBlockMarkdown(index: number, draft: string, meta: IChangeMeta): boolean
}

export type EditCancelReason = 'user' | 'revision' | 'session' | 'block' | 'writer'

export interface EditSessionState {
  active: boolean
  blockId: string
  fragmentId: string
  fragmentRange: string
  index: number
  draft: string
  baseRevision: number
  docSessionId: string
  notice: string | null
}

export interface EditSessionDiagnostics {
  activations: number
  commits: number
  cancels: Record<EditCancelReason, number>
}

const emptyState = (): EditSessionState => ({
  active: false,
  blockId: '',
  fragmentId: '',
  fragmentRange: '',
  index: -1,
  draft: '',
  baseRevision: -1,
  docSessionId: '',
  notice: null
})

let writer: CanonicalBlockWriter | null = null
let state: EditSessionState = emptyState()
const listeners = new Set<(value: EditSessionState) => void>()
const diagnostics: EditSessionDiagnostics = {
  activations: 0,
  commits: 0,
  cancels: { user: 0, revision: 0, session: 0, block: 0, writer: 0 }
}

const notify = (): void => {
  const snapshot = { ...state }
  for (const listener of [...listeners]) listener(snapshot)
}

/** Injected by the live editor shell; the session never owns a Muya instance. */
export const setCanonicalWriter = (value: CanonicalBlockWriter | null): void => {
  writer = value
  if (!value) cancelEdit('writer')
}

export const getEditSession = (): EditSessionState => ({ ...state })

export const getEditSessionDiagnostics = (): EditSessionDiagnostics => ({
  activations: diagnostics.activations,
  commits: diagnostics.commits,
  cancels: { ...diagnostics.cancels }
})

export const subscribeEditSession = (
  listener: (value: EditSessionState) => void
): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const setDraft = (draft: string): void => {
  // No notify: keystrokes (and IME composition) must not re-render the overlay.
  state.draft = draft
}

export const cancelEdit = (reason: EditCancelReason = 'user'): void => {
  if (!state.active) return
  diagnostics.cancels[reason] += 1
  state = {
    ...emptyState(),
    notice: reason === 'user'
      ? null
      : '文档在编辑期间发生变化，草稿已取消（未写入旧版本）'
  }
  notify()
}

const assertFresh = (): boolean => {
  if (!state.active) return false
  if (transactionHub.docSessionId !== state.docSessionId) {
    cancelEdit('session')
    return false
  }
  // An undo, an external reload, or any concurrent commit invalidates the
  // baseline. M2 cancels explicitly; rebase/retaining the draft is a later step.
  if (transactionHub.revision !== state.baseRevision) {
    cancelEdit('revision')
    return false
  }
  if (!transactionHub.blocks.getIds().includes(state.blockId)) {
    cancelEdit('block')
    return false
  }
  return true
}

/** Activate on a fragment, but always edit the whole canonical block. */
export const activateEdit = (
  blockId: string,
  fragmentId: string,
  fragmentRange: string
): boolean => {
  if (!writer || !blockId) return false
  if (state.active) cancelEdit('user')

  const index = transactionHub.blocks.getIds().indexOf(blockId)
  if (index < 0) return false
  const draft = writer.getBlockMarkdown(index)
  if (draft === null) return false

  state = {
    active: true,
    blockId,
    fragmentId,
    fragmentRange,
    index,
    draft,
    baseRevision: transactionHub.revision,
    docSessionId: transactionHub.docSessionId,
    notice: null
  }
  diagnostics.activations += 1
  notify()
  return true
}

/** Commit the draft as ONE external transaction (origin: projection). */
export const commitEdit = (): boolean => {
  if (!assertFresh()) return false
  if (!writer) {
    cancelEdit('writer')
    return false
  }

  const { index, draft } = state
  // Deactivate BEFORE applying: our own doc-changed must not look like a
  // concurrent revision that invalidates the baseline.
  state.active = false
  const before = transactionHub.revision
  const activeWriter = writer

  transactionHub.submitExternal({
    origin: 'projection',
    apply: txnId => {
      activeWriter.replaceBlockMarkdown(index, draft, changeMetaFor(txnId, 'projection'))
    }
  })

  const committed = transactionHub.revision > before
  if (committed) diagnostics.commits += 1
  state = emptyState()
  notify()
  return committed
}

// React to commits that happen while a draft is open (undo, disk reload, typing
// in another surface). switchDocument has no doc-changed broadcast, so the
// editor shell also calls notifyDocumentSwitch() on a whole-tree swap.
transactionHub.subscribe((event) => {
  if (!state.active) return
  if (event.docSessionId !== state.docSessionId) cancelEdit('session')
  else if (event.revision !== state.baseRevision) cancelEdit('revision')
  else if (!event.blockIds.includes(state.blockId)) cancelEdit('block')
})

export const notifyDocumentSwitch = (): void => {
  if (state.active) cancelEdit('session')
}
