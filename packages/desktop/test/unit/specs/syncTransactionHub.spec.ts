import { describe, expect, it, vi } from 'vitest'
import {
  TransactionHub,
  changeMetaFor,
  installSyncDebugSurface,
  type DocChanged,
  type JsonChange
} from '@/sync/transactionHub'

const change = (op: unknown = ['edit'], extra: Partial<JsonChange> = {}): JsonChange => ({
  op,
  source: 'user',
  ...extra
})

const externalApply = (hub: TransactionHub, txnId: string, origin = 'source') =>
  hub.ingest(change(['replace'], { source: 'api', txnId, origin }))

describe('TransactionHub — sync-design M0', () => {
  it('wraps a self-sourced notification in the same tick without applying', () => {
    const hub = new TransactionHub()
    const events: DocChanged[] = []
    hub.subscribe(event => events.push(event))

    const txn = hub.ingest(change(['a']))

    expect(txn).toMatchObject({
      origin: 'muya',
      baseRevision: 0,
      op: ['a'],
      docSessionId: hub.docSessionId
    })
    expect(hub.revision).toBe(1)
    expect(events).toHaveLength(1)
    expect(events[0].revision).toBe(1)
    expect(events[0].txn).toBe(txn)
  })

  it('keeps a replayable log with contiguous revisions and stale-result guards', () => {
    const hub = new TransactionHub()
    const ops = [['a'], ['b'], ['c']]
    ops.forEach(op => hub.ingest(change(op)))

    expect(hub.getLog().map(txn => txn.op)).toEqual(ops)
    expect(hub.getLog().map(txn => txn.baseRevision)).toEqual([0, 1, 2])
    expect(hub.revision).toBe(3)
    expect(hub.isStale(2)).toBe(true)
    expect(hub.isStale(3)).toBe(false)
    expect(() => JSON.stringify(hub.getLog())).not.toThrow()
  })

  it('confirms an external intent by txnId exactly once', () => {
    const hub = new TransactionHub()
    const events: DocChanged[] = []
    hub.subscribe(event => events.push(event))
    let applied = 0

    hub.submitExternal({
      origin: 'source',
      apply: txnId => {
        applied += 1
        externalApply(hub, txnId)
        // A duplicated engine notification must not allocate a second Revision.
        externalApply(hub, txnId)
      }
    })

    expect(applied).toBe(1)
    expect(hub.revision).toBe(1)
    expect(events).toHaveLength(1)
    expect(hub.getLog()[0]).toMatchObject({ origin: 'source', op: ['replace'] })
    expect(hub.getSnapshot().pendingTxnId).toBeNull()
  })

  it('serializes re-entrant external intents in apply order', () => {
    const hub = new TransactionHub()
    const order: string[] = []

    hub.submitExternal({
      origin: 'source',
      apply: txnId => {
        order.push('first:apply')
        hub.submitExternal({
          origin: 'table',
          apply: secondId => {
            order.push('second:apply')
            externalApply(hub, secondId, 'table')
          }
        })
        externalApply(hub, txnId)
        order.push('first:confirm')
      }
    })

    expect(order).toEqual(['first:apply', 'first:confirm', 'second:apply'])
    expect(hub.getLog().map(txn => txn.origin)).toEqual(['source', 'table'])
    expect(hub.getLog().map(txn => txn.baseRevision)).toEqual([0, 1])
    expect(hub.getSnapshot().queueLength).toBe(0)
  })

  it('ranks a self-sourced edit that lands during an external apply first', () => {
    const hub = new TransactionHub()
    hub.submitExternal({
      origin: 'projection',
      apply: txnId => {
        hub.ingest(change(['self']))
        externalApply(hub, txnId, 'projection')
      }
    })

    expect(hub.getLog().map(txn => txn.origin)).toEqual(['muya', 'projection'])
    expect(hub.getLog().map(txn => txn.baseRevision)).toEqual([0, 1])
  })

  it('drops identity/no-op notifications instead of writing fake history', () => {
    const hub = new TransactionHub()
    const events: DocChanged[] = []
    hub.subscribe(event => events.push(event))

    expect(hub.ingest(change(null))).toBeNull()
    expect(hub.ingest(change([]))).toBeNull()
    expect(hub.revision).toBe(0)
    expect(events).toHaveLength(0)

    hub.submitExternal({
      origin: 'source',
      apply: txnId => hub.ingest(change([], { source: 'api', txnId, origin: 'source' }))
    })
    expect(hub.revision).toBe(0)
    expect(hub.getSnapshot().pendingTxnId).toBeNull()
  })

  it('attributes undo/redo and falls back to muya for unknown origins', () => {
    const hub = new TransactionHub()

    hub.ingest(change(['u'], { origin: 'undo' }))
    hub.ingest(change(['r'], { origin: 'redo' }))
    hub.ingest(change(['x'], { origin: 'not-an-origin' }))

    expect(hub.getLog().map(txn => txn.origin)).toEqual(['undo', 'redo', 'muya'])
  })

  it('suppresses one save echo without swallowing a later genuine reload', () => {
    const hub = new TransactionHub()
    hub.noteSaved('# saved\n')
    let applied = 0
    const diskIntent = (markdown: string) => ({
      origin: 'disk' as const,
      markdown,
      apply: (txnId: string) => {
        applied += 1
        externalApply(hub, txnId, 'disk')
      }
    })

    hub.submitExternal(diskIntent('# saved'))
    expect(applied).toBe(0)
    expect(hub.getSnapshot().suppressedEchoes).toBe(1)

    hub.submitExternal(diskIntent('# saved'))
    expect(applied).toBe(1)
    expect(hub.revision).toBe(1)

    hub.submitExternal(diskIntent('# externally changed'))
    expect(applied).toBe(2)
    expect(hub.revision).toBe(2)
  })

  it('starts a fresh document session on setContent without a transaction', () => {
    const hub = new TransactionHub()
    const oldSession = hub.docSessionId
    hub.ingest(change(['a']))
    hub.noteSaved('a')

    hub.switchDocument()

    expect(hub.docSessionId).not.toBe(oldSession)
    expect(hub.revision).toBe(0)
    expect(hub.getLog()).toHaveLength(0)
    // Diagnostic counters are lifetime totals; only the document state resets.
    expect(hub.getSnapshot().broadcastCount).toBe(1)
    expect(hub.getSnapshot().queueLength).toBe(0)
  })

  it('treats a remount of the same document as the same session', () => {
    const hub = new TransactionHub()
    hub.switchDocument('tab-1')
    const session = hub.docSessionId
    hub.ingest(change(['a']))

    hub.switchDocument('tab-1')
    expect(hub.docSessionId).toBe(session)
    expect(hub.revision).toBe(1)

    hub.switchDocument('tab-2')
    expect(hub.docSessionId).not.toBe(session)
    expect(hub.revision).toBe(0)
  })

  it('does not strand the queue when an external apply throws', () => {
    const hub = new TransactionHub()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      hub.submitExternal({
        origin: 'figure',
        apply: () => {
          throw new Error('boom')
        }
      })
      hub.submitExternal({
        origin: 'table',
        apply: txnId => externalApply(hub, txnId, 'table')
      })

      expect(hub.getSnapshot().failedApplies).toBe(1)
      expect(hub.getLog().map(txn => txn.origin)).toEqual(['table'])
      expect(hub.getSnapshot().pendingTxnId).toBeNull()
    } finally {
      spy.mockRestore()
    }
  })

  it('exposes a read-only snapshot and forwards engine attribution', () => {
    const hub = new TransactionHub()
    installSyncDebugSurface(hub)
    hub.ingest(change(['a']))

    expect(changeMetaFor('T-9', 'source')).toEqual({ txnId: 'T-9', origin: 'source' })
    expect(window.__wenlanSync?.getSnapshot().revision).toBe(1)
    expect(window.__wenlanSync?.getLog()).toHaveLength(1)
    expect(window.__wenlanSync?.isStale(0)).toBe(true)
    expect(Object.isFrozen(window.__wenlanSync)).toBe(true)
  })
})
