import { transactionHub } from './transactionHub'

// sync-design §3 / D4: docRevision -> layoutRevision -> projectionRevision.
// Every asynchronous projection result (measurement, page fitting, iframe build)
// carries the versions it consumed. A result is discarded when the document
// session changed or a newer transaction committed while it was in flight —
// an older revision must never overwrite a newer one.

export interface ProjectionRequest {
  docSessionId: string
  docRevision: number
  layoutRevision: number
}

export interface ProjectionStamp extends ProjectionRequest {
  projectionRevision: number
}

export interface ProjectionDiagnostics {
  applied: number
  discarded: number
  last: ProjectionStamp | null
}

const diagnostics: ProjectionDiagnostics = {
  applied: 0,
  discarded: 0,
  last: null
}

/** Capture the versions consumed by a rebuild before any async work begins. */
export const beginProjection = (layoutRevision: number): ProjectionRequest => ({
  docSessionId: transactionHub.docSessionId,
  docRevision: transactionHub.revision,
  layoutRevision
})

/** Strict equality: a rebuild started before the latest commit is out of date. */
export const isProjectionStale = (request: ProjectionRequest): boolean =>
  request.docSessionId !== transactionHub.docSessionId ||
  request.docRevision !== transactionHub.revision

export const finishProjection = (
  request: ProjectionRequest,
  projectionRevision: number,
  applied: boolean
): void => {
  if (!applied) {
    diagnostics.discarded++
    return
  }
  diagnostics.applied++
  diagnostics.last = {
    docSessionId: request.docSessionId,
    docRevision: request.docRevision,
    layoutRevision: request.layoutRevision,
    projectionRevision
  }
}

export const getProjectionDiagnostics = (): ProjectionDiagnostics => ({
  applied: diagnostics.applied,
  discarded: diagnostics.discarded,
  last: diagnostics.last ? { ...diagnostics.last } : null
})
