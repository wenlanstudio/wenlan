import type { IChangeMeta } from '@muyajs/core'
import { BlockRegistry } from './blockIdentity'

// sync-design v2.2 / M0. One document, one transaction stream, one Revision.
//
// The two write entrances are deliberately asymmetric (D2):
//   - self-sourced Muya edits have ALREADY been applied when `json-change`
//     reaches us, so `ingest()` only wraps them in a Txn envelope in the same
//     tick and never calls apply again;
//   - external edits are queued first, then applied through Muya; the resulting
//     `json-change` is only a confirmation, matched by `txnId`, and must not
//     allocate a second Revision.
//
// The hub never touches the document, the DOM or the editor: it owns ordering,
// identity and notification only. Projections consume `doc-changed` read-only.

export type TxnOrigin =
  | 'muya'
  | 'projection'
  | 'source'
  | 'table'
  | 'figure'
  | 'disk'
  | 'undo'
  | 'redo'

export type ExternalOrigin = Exclude<TxnOrigin, 'muya' | 'undo' | 'redo'>

const ORIGINS = new Set<TxnOrigin>([
  'muya',
  'projection',
  'source',
  'table',
  'figure',
  'disk',
  'undo',
  'redo'
])

/** Shape of the engine's `json-change` payload as far as the adapter cares. */
export interface JsonChange {
  op: unknown
  source: string
  prevDoc?: unknown
  doc?: unknown
  txnId?: string
  origin?: string
}

/** The uniform write envelope. `op` stays the engine's ot-json1 payload. */
export interface Txn {
  txnId: string
  docSessionId: string
  baseRevision: number
  origin: TxnOrigin
  op: unknown
  selectionBefore?: unknown
  selectionAfter?: unknown
}

export interface DocChanged {
  txn: Txn
  revision: number
  docSessionId: string
  /** Session-scoped ids in document order, one per canonical top-level block. */
  blockIds: readonly string[]
  /** Ids that were newly allocated, moved, or whose state hash changed. */
  affectedIds: string[]
}

export interface ExternalIntent {
  origin: ExternalOrigin
  /** Must apply through Muya (`replaceContent` / `updateContents`) synchronously. */
  apply: (txnId: string) => void
  /** Disk intents carry the on-disk text so our own save echo can be suppressed. */
  markdown?: string
  selectionBefore?: unknown
}

export interface HubSnapshot {
  docSessionId: string
  revision: number
  /** Lifetime total, deliberately not reset by `switchDocument` (diff-friendly). */
  broadcastCount: number
  suppressedEchoes: number
  failedApplies: number
  origins: TxnOrigin[]
  pendingTxnId: string | null
  queueLength: number
}

interface PendingExternal {
  txnId: string
  origin: ExternalOrigin
  selectionBefore?: unknown
}

interface QueuedExternal {
  intent: ExternalIntent
}

const MAX_LOG = 500
const MAX_SEEN = 1000
const MAX_SAVED_FINGERPRINTS = 32

const isTxnOrigin = (value: unknown): value is TxnOrigin =>
  typeof value === 'string' && ORIGINS.has(value as TxnOrigin)

const isNoOp = (op: unknown): boolean =>
  op == null || (Array.isArray(op) && op.length === 0)

// Trailing newlines are normalized before saving, so an echo may differ from the
// saved buffer only in them. FNV-1a keeps the recent-save set small; a collision
// would at worst suppress one genuine external reload, never a local edit.
const fingerprint = (markdown: string): string => {
  const normalized = markdown.replace(/[\r\n]+$/, '')
  let hash = 0x811c9dc5
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${normalized.length}:${hash >>> 0}`
}

/** Attribution the host passes into Muya so its notification can be matched. */
export const changeMetaFor = (txnId: string, origin: ExternalOrigin): IChangeMeta => ({
  txnId,
  origin
})

export class TransactionHub {
  private _sessionSeq = 0
  private _txnSeq = 0
  private _revision = 0
  private _docSessionId = 'S0'
  private _docId: string | null = null
  private _log: Txn[] = []
  private readonly _listeners = new Set<(event: DocChanged) => void>()
  private readonly _seenTxnIds = new Set<string>()
  private readonly _savedFingerprints = new Set<string>()
  private _pending: PendingExternal | null = null
  private _queue: QueuedExternal[] = []
  private _draining = false
  private _broadcastCount = 0
  private _suppressedEchoes = 0
  private _failedApplies = 0
  private _blockStateProvider: (() => readonly unknown[]) | null = null
  private _blocks: BlockRegistry

  constructor() {
    this._docSessionId = this._newSession()
    this._blocks = new BlockRegistry(this._docSessionId)
  }

  get revision(): number {
    return this._revision
  }

  get docSessionId(): string {
    return this._docSessionId
  }

  get blocks(): BlockRegistry {
    return this._blocks
  }

  /**
   * Injected by the editor shell. Keeps the hub independent of Muya while still
   * letting every commit carry a freshly re-anchored block identity (D1).
   */
  setBlockStateProvider(provider: (() => readonly unknown[]) | null): void {
    this._blockStateProvider = provider
  }

  /** Re-anchor without a transaction, e.g. after a view remount. */
  reanchor(): void {
    if (this._blockStateProvider) this._blocks.reanchor(this._blockStateProvider())
  }

  subscribe(listener: (event: DocChanged) => void): () => void {
    this._listeners.add(listener)
    return () => this._listeners.delete(listener)
  }

  /** Transaction log for replay, diagnostics and regression assertions. */
  getLog(): readonly Txn[] {
    return this._log.slice()
  }

  getSnapshot(): HubSnapshot {
    return {
      docSessionId: this._docSessionId,
      revision: this._revision,
      broadcastCount: this._broadcastCount,
      suppressedEchoes: this._suppressedEchoes,
      failedApplies: this._failedApplies,
      origins: this._log.map(txn => txn.origin),
      pendingTxnId: this._pending?.txnId ?? null,
      queueLength: this._queue.length
    }
  }

  /** Async measurement/build results must carry their request revision. */
  isStale(requestRevision: number): boolean {
    return requestRevision < this._revision
  }

  /** Called once a save has completed; the matching watcher event is an echo. */
  noteSaved(markdown: string): void {
    const key = fingerprint(markdown)
    this._savedFingerprints.delete(key)
    this._savedFingerprints.add(key)
    while (this._savedFingerprints.size > MAX_SAVED_FINGERPRINTS) {
      const oldest = this._savedFingerprints.values().next().value
      if (oldest === undefined) break
      this._savedFingerprints.delete(oldest)
    }
  }

  /**
   * `setContent` swaps the document with no edit; it starts a new session.
   * Passing the same doc id twice is a view remount, not a document change —
   * keep the Revision chain so a source-mode roundtrip stays replayable.
   */
  switchDocument(docId?: string): void {
    if (docId !== undefined && docId === this._docId) return
    this._docId = docId ?? null
    this._docSessionId = this._newSession()
    this._blocks.reset(this._docSessionId)
    this._revision = 0
    this._log = []
    this._seenTxnIds.clear()
    this._savedFingerprints.clear()
    this._pending = null
    this._queue = []
  }

  /**
   * Wrap a self-sourced notification, or confirm a queued external one.
   * Returns the committed Txn, or null for duplicates / identity ops / echoes.
   */
  ingest(change: JsonChange): Txn | null {
    if (change.txnId && this._seenTxnIds.has(change.txnId)) return null

    const matched =
      this._pending && change.txnId === this._pending.txnId ? this._pending : null
    const txnId = change.txnId ?? this._nextTxnId()

    // A no-op still has to retire its pending external intent, otherwise the
    // next self-sourced edit would be mistaken for that transaction's confirm.
    // Do not mark its txnId as seen: a later real notification from the same
    // apply must still be able to commit.
    if (isNoOp(change.op)) {
      if (matched) this._pending = null
      return null
    }

    let origin: TxnOrigin = 'muya'
    if (matched) origin = matched.origin
    else if (isTxnOrigin(change.origin)) origin = change.origin
    else if (change.txnId) origin = 'projection'

    const txn: Txn = {
      txnId,
      docSessionId: this._docSessionId,
      // Commit order follows actual apply order: an external apply that raced a
      // self-sourced edit takes the Revision current at confirmation time.
      baseRevision: this._revision,
      origin,
      op: change.op,
      ...(matched?.selectionBefore !== undefined
        ? { selectionBefore: matched.selectionBefore }
        : {})
    }

    this._commit(txn)
    if (matched) this._pending = null
    return txn
  }

  /** Queue an external intent, then apply it once the queue reaches the front. */
  submitExternal(intent: ExternalIntent): void {
    this._queue.push({ intent })
    this._drain()
  }

  private _drain(): void {
    if (this._draining) return
    this._draining = true
    try {
      while (this._queue.length > 0) {
        const next = this._queue.shift()
        if (!next) break
        const { intent } = next
        if (
          intent.origin === 'disk' &&
          intent.markdown !== undefined &&
          this._consumeSaveEcho(intent.markdown)
        ) {
          this._suppressedEchoes += 1
          continue
        }

        const txnId = this._nextTxnId()
        this._pending = {
          txnId,
          origin: intent.origin,
          ...(intent.selectionBefore !== undefined
            ? { selectionBefore: intent.selectionBefore }
            : {})
        }
        try {
          intent.apply(txnId)
        } catch (error) {
          // One failed external apply must not strand the rest of the queue.
          this._failedApplies += 1
          console.error('[sync] external apply failed', error)
        } finally {
          // `replaceContent` can legitimately produce no notification (identical
          // content); retire the intent so it never pairs with a later edit.
          if (this._pending?.txnId === txnId) {
            this._pending = null
            this._remember(txnId)
          }
        }
      }
    } finally {
      this._draining = false
    }
  }

  private _consumeSaveEcho(markdown: string): boolean {
    const key = fingerprint(markdown)
    if (!this._savedFingerprints.has(key)) return false
    // One save cancels exactly one echo; a later genuine external change to the
    // same text must still reload.
    this._savedFingerprints.delete(key)
    return true
  }

  private _commit(txn: Txn): void {
    this._revision += 1
    this._log.push(txn)
    if (this._log.length > MAX_LOG) this._log.shift()
    this._remember(txn.txnId)

    // Re-anchor at commit time: Muya's json state is already authoritative even
    // when its DOM walker has not finished the incremental update yet.
    let blockIds: readonly string[] = this._blocks.getIds()
    let affectedIds: string[] = []
    if (this._blockStateProvider) {
      try {
        const result = this._blocks.reanchor(this._blockStateProvider())
        blockIds = result.blockIds
        affectedIds = result.affectedIds
      } catch (error) {
        console.error('[sync] block re-anchor failed', error)
      }
    }

    const event: DocChanged = {
      txn,
      revision: this._revision,
      docSessionId: this._docSessionId,
      blockIds,
      affectedIds
    }
    this._broadcastCount += 1
    for (const listener of [...this._listeners]) {
      try {
        listener(event)
      } catch (error) {
        console.error('[sync] doc-changed listener failed', error)
      }
    }
  }

  private _remember(txnId: string): void {
    this._seenTxnIds.add(txnId)
    if (this._seenTxnIds.size > MAX_SEEN) {
      const oldest = this._seenTxnIds.values().next().value
      if (oldest !== undefined) this._seenTxnIds.delete(oldest)
    }
  }

  private _nextTxnId(): string {
    return `T${++this._txnSeq}`
  }

  private _newSession(): string {
    return `S${++this._sessionSeq}`
  }
}

/** Module singleton: it must outlive editor.vue's v-if teardown in source mode. */
export const transactionHub = new TransactionHub()

export interface IdentitySnapshot {
  sessionId: string
  blockCount: number
  ambiguousCount: number
  lastReanchorMs: number
  blockIds: string[]
}

export interface SyncDebugSurface {
  getSnapshot(): HubSnapshot
  getLog(): readonly Txn[]
  isStale(revision: number): boolean
  getIdentity(): IdentitySnapshot
  getProjection(): unknown
}

/**
 * Read-only inspection surface for diagnostics and e2e assertions (N5).
 * Projection diagnostics are injected by the caller to keep the version-layer
 * dependency pointing one way (projectionVersion -> hub).
 */
export function installSyncDebugSurface(
  hub: TransactionHub,
  getProjectionDiagnostics: () => unknown = () => null
): void {
  const surface: SyncDebugSurface = Object.freeze({
    getSnapshot: () => hub.getSnapshot(),
    getLog: () => hub.getLog(),
    isStale: (revision: number) => hub.isStale(revision),
    getIdentity: () => ({
      ...hub.blocks.getDiagnostics(),
      blockIds: [...hub.blocks.getIds()]
    }),
    getProjection: getProjectionDiagnostics
  })
  Object.defineProperty(window, '__wenlanSync', {
    configurable: true,
    value: surface
  })
}
