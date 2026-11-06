import { stableHash64 } from './stableHash'

// sync-design D1. Block ids are session-scoped view anchors, never persisted to
// disk and never written into the canonical block tree. Every whole-tree rebuild
// (setContent, replaceContent, disk reload, source-mode remount, whole-tree
// undo/redo) re-anchors here: an ordered structural diff over FULL state hashes.
//
// The safety rule is deliberately conservative: when a hash occurs more than
// once on either side, the diff cannot prove which old block a new one came
// from, so those blocks get NEW ids. Rebuilding a projection is cheap; writing
// an edit (or restoring a caret) into the wrong look-alike block is not.

export interface BlockRecord {
  blockId: string
  stateHash: string
}

export interface ReanchorResult {
  blockIds: string[]
  affectedIds: string[]
  ambiguousCount: number
  elapsedMs: number
}

type Pair = [number, number]

// A pathological full-document rewrite must not stall the typing path. Beyond
// this many DP cells we give up on diffing and allocate fresh ids instead.
const MAX_LCS_CELLS = 250000

const counts = (hashes: readonly string[]): Map<string, number> => {
  const result = new Map<string, number>()
  for (const hash of hashes) result.set(hash, (result.get(hash) ?? 0) + 1)
  return result
}

/**
 * A pure reorder keeps the same hash multiset. LCS would keep only one of two
 * swapped blocks and hand the other a fresh id, so pair them by hash instead.
 * Repeated hashes still fail the ambiguity check downstream — no guessing.
 */
const permutationPairs = (
  prev: readonly string[],
  next: readonly string[]
): Pair[] | null => {
  if (prev.length !== next.length) return null
  const before = counts(prev)
  const after = counts(next)
  if (before.size !== after.size) return null
  for (const [hash, count] of before) {
    if (after.get(hash) !== count) return null
  }

  const queues = new Map<string, number[]>()
  prev.forEach((hash, index) => {
    const queue = queues.get(hash)
    if (queue) queue.push(index)
    else queues.set(hash, [index])
  })

  const pairs: Pair[] = []
  for (let j = 0; j < next.length; j++) {
    const queue = queues.get(next[j])
    const oldIndex = queue?.shift()
    if (oldIndex === undefined) return null
    pairs.push([oldIndex, j])
  }
  return pairs
}

/** Longest common subsequence over hash sequences, preserving document order. */
const lcsPairs = (prev: readonly string[], next: readonly string[]): Pair[] => {
  const n = prev.length
  const m = next.length
  if (n * m > MAX_LCS_CELLS) return []

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = prev[i] === next[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const pairs: Pair[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (prev[i] === next[j]) {
      pairs.push([i, j])
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++
    } else {
      j++
    }
  }
  return pairs
}

export class BlockRegistry {
  private _seq = 0
  private _sessionId: string
  private _records: BlockRecord[] = []
  private _ambiguousCount = 0
  private _lastReanchorMs = 0

  constructor(sessionId: string) {
    this._sessionId = sessionId
  }

  get sessionId(): string {
    return this._sessionId
  }

  getIds(): readonly string[] {
    return this._records.map(record => record.blockId)
  }

  getDiagnostics(): {
    sessionId: string
    blockCount: number
    ambiguousCount: number
    lastReanchorMs: number
  } {
    return {
      sessionId: this._sessionId,
      blockCount: this._records.length,
      ambiguousCount: this._ambiguousCount,
      lastReanchorMs: this._lastReanchorMs
    }
  }

  /** A new document session discards every id: ids never cross documents. */
  reset(sessionId: string): void {
    this._sessionId = sessionId
    this._seq = 0
    this._records = []
    this._ambiguousCount = 0
    this._lastReanchorMs = 0
  }

  /**
   * Re-anchor against the current canonical block states. Cheap in the common
   * case: an unchanged prefix/suffix is skipped and only the edited middle runs
   * through the LCS. M4 replaces the full-state hashing with an incremental
   * Merkle summary once its benchmark lands.
   */
  reanchor(states: readonly unknown[]): ReanchorResult {
    const started = performance.now()
    const nextHashes = states.map(state => stableHash64(state))
    const prevRecords = this._records
    const prevHashes = prevRecords.map(record => record.stateHash)

    const reordered = permutationPairs(prevHashes, nextHashes)
    let pairs: Pair[] = []
    let exhausted = false

    if (reordered) {
      pairs = reordered
    } else {
      let head = 0
      while (
        head < prevHashes.length &&
        head < nextHashes.length &&
        prevHashes[head] === nextHashes[head]
      ) head++

      let tail = 0
      while (
        tail < prevHashes.length - head &&
        tail < nextHashes.length - head &&
        prevHashes[prevHashes.length - 1 - tail] === nextHashes[nextHashes.length - 1 - tail]
      ) tail++

      const midPrev = prevHashes.slice(head, prevHashes.length - tail)
      const midNext = nextHashes.slice(head, nextHashes.length - tail)
      exhausted = midPrev.length * midNext.length > MAX_LCS_CELLS
      const middle = exhausted ? [] : lcsPairs(midPrev, midNext)

      for (let k = 0; k < head; k++) pairs.push([k, k])
      for (const [a, b] of middle) pairs.push([head + a, head + b])
      for (let k = 0; k < tail; k++) {
        pairs.push([prevHashes.length - tail + k, nextHashes.length - tail + k])
      }
    }

    const prevCount = counts(prevHashes)
    const nextCount = counts(nextHashes)
    const reused = new Map<number, string>()
    const used = new Set<string>()
    let ambiguousCount = 0

    for (const [oldIndex, newIndex] of pairs) {
      const hash = nextHashes[newIndex]
      if ((prevCount.get(hash) ?? 0) > 1 || (nextCount.get(hash) ?? 0) > 1) {
        ambiguousCount++
        continue
      }
      const record = prevRecords[oldIndex]
      if (record && !used.has(record.blockId)) {
        reused.set(newIndex, record.blockId)
        used.add(record.blockId)
      }
    }

    if (exhausted) {
      ambiguousCount += nextHashes.length
      reused.clear()
    }

    const blockIds = nextHashes.map((_, index) => reused.get(index) ?? this._newId())
    const affectedIds = [...new Set(
      blockIds.filter((id, index) => prevRecords[index]?.blockId !== id)
    )]

    this._records = blockIds.map((blockId, index) => ({
      blockId,
      stateHash: nextHashes[index]
    }))
    this._ambiguousCount = ambiguousCount
    this._lastReanchorMs = performance.now() - started

    return {
      blockIds,
      affectedIds,
      ambiguousCount,
      elapsedMs: this._lastReanchorMs
    }
  }

  private _newId(): string {
    return `${this._sessionId}:B${++this._seq}`
  }
}

/**
 * Apply session ids to the live engine's top-level block nodes. Views consume
 * ids read-only; the canonical state tree itself never carries an id.
 */
export function applyBlockIds(root: Element | null, blockIds: readonly string[]): number {
  if (!root) return 0
  const container = root.querySelector(':scope > .mu-container') ?? root
  const children = Array.from(container.children)
  let applied = 0
  for (let i = 0; i < children.length; i++) {
    const node = children[i] as HTMLElement
    const id = blockIds[i]
    if (id) {
      node.dataset.blockId = id
      applied++
    } else {
      delete node.dataset.blockId
    }
  }
  return applied
}

/** Nearest ancestor (or self) carrying a block id. */
export function blockIdOf(node: Element | null): string | null {
  let current = node
  while (current) {
    const id = (current as HTMLElement).dataset?.blockId
    if (id) return id
    current = current.parentElement
  }
  return null
}
