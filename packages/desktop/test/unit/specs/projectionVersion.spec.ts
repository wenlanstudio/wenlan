import { beforeEach, describe, expect, it } from 'vitest'
import { transactionHub } from '@/sync/transactionHub'
import {
  beginProjection,
  finishProjection,
  getProjectionDiagnostics,
  isProjectionStale
} from '@/sync/projectionVersion'

beforeEach(() => {
  // A fresh document session keeps revision counters deterministic per test.
  transactionHub.switchDocument()
})

describe('projection version chain — sync-design §3 / §6', () => {
  it('captures the session and revision a rebuild consumed', () => {
    const request = beginProjection(3)

    expect(request.docSessionId).toBe(transactionHub.docSessionId)
    expect(request.docRevision).toBe(transactionHub.revision)
    expect(request.layoutRevision).toBe(3)
    expect(isProjectionStale(request)).toBe(false)
  })

  it('discards a result whose document session changed', () => {
    const request = beginProjection(1)
    transactionHub.switchDocument()

    expect(isProjectionStale(request)).toBe(true)
  })

  it('discards a result superseded by a later transaction', () => {
    const request = beginProjection(1)
    transactionHub.ingest({ op: ['edit'], source: 'user' })

    expect(transactionHub.revision).toBe(1)
    expect(isProjectionStale(request)).toBe(true)
    expect(transactionHub.isStale(request.docRevision)).toBe(true)
  })

  it('accepts an out-of-order result only when it is the latest revision', () => {
    const stale = beginProjection(1)
    transactionHub.ingest({ op: ['edit'], source: 'user' })
    const fresh = beginProjection(2)

    expect(isProjectionStale(stale)).toBe(true)
    expect(isProjectionStale(fresh)).toBe(false)
  })

  it('counts applied and discarded results for diagnostics', () => {
    const before = getProjectionDiagnostics()
    const stale = beginProjection(1)
    transactionHub.ingest({ op: ['edit'], source: 'user' })
    finishProjection(stale, 0, false)

    const fresh = beginProjection(2)
    finishProjection(fresh, 7, true)

    const after = getProjectionDiagnostics()
    expect(after.applied - before.applied).toBe(1)
    expect(after.discarded - before.discarded).toBe(1)
    expect(after.last).toEqual({
      docSessionId: fresh.docSessionId,
      docRevision: fresh.docRevision,
      layoutRevision: 2,
      projectionRevision: 7
    })
  })
})
