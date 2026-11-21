// Helper module (NOT a Pinia store): pure predicates for recognizing the
// chokidar `add`/`unlink` event pair that a filesystem rename emits.
//
// On Windows a rename arrives as `add`(new name) followed ~100ms later by
// `unlink`(old name); on Linux the order is reversed. Pairing the two lets
// the project store follow an external rename with the open tabs
// (editorStore.RENAME_IF_NEEDED) instead of marking them "removed on disk".
//
// The birth-time check is the false-positive guard: a rename preserves the
// file's creation time on NTFS, while a delete-A-then-create-B sequence (or
// a git checkout, which rewrites files) produces a fresh birth time.

export const RENAME_PAIR_WINDOW_MS = 600
export const RENAME_PAIR_BIRTHTIME_TOLERANCE_MS = 1000

export interface RenamePairEvent {
  pathname: string
  birthTime?: number | Date
  at: number
}

/** Recent directory rename (old → new), used to pair files inside it. */
export interface DirMapping {
  from: string
  to: string
  at: number
}

export interface RenamePairOptions {
  /** Arrival time of the later event; mappings/entries are judged against it. */
  at: number
  windowMs?: number
  birthTimeToleranceMs?: number
  dirMappings?: DirMapping[]
}

const toTime = (v?: number | Date): number | undefined =>
  v instanceof Date ? v.getTime() : typeof v === 'number' && isFinite(v) ? v : undefined

const isLive = (at: number, now: number, windowMs: number): boolean =>
  now - at >= 0 && now - at <= windowMs

/**
 * Same directory, counting a live directory-rename mapping as equality
 * (a file's unlink lands under the old dir, its add under the new one).
 */
export const isSameRenameDir = (
  dirA: string,
  dirB: string,
  options: { at: number; windowMs?: number; dirMappings?: DirMapping[] }
): boolean => {
  if (dirA === dirB) return true
  const windowMs = options.windowMs ?? RENAME_PAIR_WINDOW_MS
  return (options.dirMappings ?? []).some(
    (m) => m.from === dirA && m.to === dirB && isLive(m.at, options.at, windowMs)
  )
}

export const birthTimeCompatible = (
  a?: number | Date,
  b?: number | Date,
  toleranceMs: number = RENAME_PAIR_BIRTHTIME_TOLERANCE_MS
): boolean => {
  const ta = toTime(a)
  const tb = toTime(b)
  if (ta === undefined || tb === undefined) return false
  return Math.abs(ta - tb) <= toleranceMs
}

/** Two events of the same file rename (or, for dirs, same parent rename). */
export const isRenamePair = (
  oldEvt: RenamePairEvent,
  newEvt: RenamePairEvent,
  options: RenamePairOptions
): boolean => {
  if (oldEvt.pathname === newEvt.pathname) return false
  const windowMs = options.windowMs ?? RENAME_PAIR_WINDOW_MS
  if (Math.abs(oldEvt.at - newEvt.at) > windowMs) return false
  const sameDir = isSameRenameDir(
    window.path.dirname(oldEvt.pathname),
    window.path.dirname(newEvt.pathname),
    options
  )
  if (!sameDir) return false
  return birthTimeCompatible(oldEvt.birthTime, newEvt.birthTime, options.birthTimeToleranceMs)
}

/** Directory rename pair: same parent, different name, within the window. */
export const isDirRenamePair = (
  oldDir: string,
  newDir: string,
  oldAt: number,
  newAt: number,
  windowMs: number = RENAME_PAIR_WINDOW_MS
): boolean => {
  if (oldDir === newDir) return false
  if (Math.abs(oldAt - newAt) > windowMs) return false
  return window.path.dirname(oldDir) === window.path.dirname(newDir)
}

/**
 * Pick the best rename partner for `evt` out of `candidates` and consume it.
 * Best = birth time closest to the event's; ties resolved by earlier arrival.
 * Returns null when no candidate pairs.
 */
export const takeRenamePartner = <
  T extends { pathname: string; birthTime?: number | Date; at: number }
>(
  candidates: Map<string, T>,
  evt: RenamePairEvent,
  options: RenamePairOptions
): T | null => {
  let best: T | null = null
  let bestKey: string | null = null
  let bestDelta = Number.POSITIVE_INFINITY
  for (const [key, candidate] of candidates) {
    if (!isRenamePair(evt, candidate, options)) continue
    const delta = Math.abs(
      (toTime(candidate.birthTime) ?? 0) - (toTime(evt.birthTime) ?? 0)
    )
    if (
      best === null ||
      delta < bestDelta ||
      (delta === bestDelta && candidate.at < best.at)
    ) {
      best = candidate
      bestKey = key
      bestDelta = delta
    }
  }
  if (best && bestKey) candidates.delete(bestKey)
  return best
}
