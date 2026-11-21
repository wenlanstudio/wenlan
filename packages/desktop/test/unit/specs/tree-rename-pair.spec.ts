import { describe, it, expect } from 'vitest'

// Predicates for recognizing the chokidar add/unlink pair of an external
// rename (see store/treeRenamePair.ts and the store wiring in project.ts).

// The predicates resolve directories via the renderer's `window.path` global.
const g = globalThis as unknown as { window?: Record<string, unknown> }
g.window ??= {}
g.window.path = {
  sep: '/',
  normalize: (p: string) => p,
  basename: (p: string) => p.split('/').pop() ?? p,
  dirname: (p: string) => p.split('/').slice(0, -1).join('/') || '/'
}

import {
  RENAME_PAIR_WINDOW_MS,
  birthTimeCompatible,
  isDirRenamePair,
  isRenamePair,
  isSameRenameDir,
  takeRenamePartner,
  type DirMapping
} from '@/store/treeRenamePair'

const T0 = 1_000_000

const evt = (pathname: string, birthTime: number | Date | undefined, at: number) => ({
  pathname,
  birthTime,
  at
})

describe('isRenamePair', () => {
  const base = { at: T0 }

  it('pairs two same-directory events with equal birth times', () => {
    expect(
      isRenamePair(evt('/A/old.md', 900_000, T0), evt('/A/new.md', 900_000, T0 + 100), base)
    ).toBe(true)
  })

  it('requires different pathnames', () => {
    expect(
      isRenamePair(evt('/A/a.md', 900_000, T0), evt('/A/a.md', 900_000, T0 + 100), base)
    ).toBe(false)
  })

  it('requires both events within the pairing window', () => {
    expect(
      isRenamePair(evt('/A/old.md', 900_000, T0), evt('/A/new.md', 900_000, T0 + RENAME_PAIR_WINDOW_MS), base)
    ).toBe(true)
    expect(
      isRenamePair(evt('/A/old.md', 900_000, T0), evt('/A/new.md', 900_000, T0 + RENAME_PAIR_WINDOW_MS + 1), base)
    ).toBe(false)
  })

  it('rejects different birth times beyond the tolerance (delete A, create B)', () => {
    expect(
      isRenamePair(evt('/A/old.md', 900_000, T0), evt('/A/new.md', 900_500, T0 + 100), base)
    ).toBe(true)
    expect(
      isRenamePair(evt('/A/old.md', 900_000, T0), evt('/A/new.md', 901_100, T0 + 100), base)
    ).toBe(false)
    expect(
      isRenamePair(evt('/A/old.md', 900_000, T0), evt('/A/new.md', 990_000, T0 + 100), base)
    ).toBe(false)
  })

  it('never pairs when a birth time is missing (conservative fallback)', () => {
    expect(
      isRenamePair(evt('/A/old.md', undefined, T0), evt('/A/new.md', 900_000, T0 + 100), base)
    ).toBe(false)
    expect(
      isRenamePair(evt('/A/old.md', 900_000, T0), evt('/A/new.md', undefined, T0 + 100), base)
    ).toBe(false)
  })

  it('accepts Date birth times', () => {
    expect(
      isRenamePair(evt('/A/old.md', new Date(900_000), T0), evt('/A/new.md', 900_000, T0 + 100), base)
    ).toBe(true)
  })

  it('pairs across a live directory mapping (directory rename)', () => {
    const dirMappings: DirMapping[] = [{ from: '/A/sub', to: '/A/sub2', at: T0 }]
    expect(
      isRenamePair(
        evt('/A/sub/old.md', 900_000, T0),
        evt('/A/sub2/new.md', 900_000, T0 + 100),
        { ...base, dirMappings }
      )
    ).toBe(true)
  })

  it('ignores expired directory mappings', () => {
    const dirMappings: DirMapping[] = [{ from: '/A/sub', to: '/A/sub2', at: T0 - RENAME_PAIR_WINDOW_MS - 1 }]
    expect(
      isRenamePair(
        evt('/A/sub/old.md', 900_000, T0),
        evt('/A/sub2/new.md', 900_000, T0 + 100),
        { ...base, dirMappings }
      )
    ).toBe(false)
  })
})

describe('isSameRenameDir / birthTimeCompatible / isDirRenamePair', () => {
  it('treats identical dirs as same', () => {
    expect(isSameRenameDir('/A', '/A', { at: T0 })).toBe(true)
  })

  it('needs a mapping for different dirs', () => {
    expect(isSameRenameDir('/A/sub', '/A/sub2', { at: T0 })).toBe(false)
    expect(
      isSameRenameDir('/A/sub', '/A/sub2', { at: T0, dirMappings: [{ from: '/A/sub', to: '/A/sub2', at: T0 }] })
    ).toBe(true)
  })

  it('compares birth times within tolerance', () => {
    expect(birthTimeCompatible(900_000, 900_500)).toBe(true)
    expect(birthTimeCompatible(900_000, 901_001)).toBe(false)
    expect(birthTimeCompatible(undefined, 900_000)).toBe(false)
  })

  it('pairs directories by parent and window', () => {
    expect(isDirRenamePair('/A/sub', '/A/sub2', T0, T0 + 100)).toBe(true)
    expect(isDirRenamePair('/A/sub', '/B/sub2', T0, T0 + 100)).toBe(false)
    expect(isDirRenamePair('/A/sub', '/A/sub2', T0, T0 + RENAME_PAIR_WINDOW_MS + 1)).toBe(false)
  })
})

describe('takeRenamePartner', () => {
  it('picks and consumes the closest birth time', () => {
    const candidates = new Map([
      ['a', { pathname: '/A/a1.md', birthTime: 900_000, at: T0 }],
      ['b', { pathname: '/A/a2.md', birthTime: 900_800, at: T0 }]
    ])
    const partner = takeRenamePartner(candidates, evt('/A/old.md', 900_750, T0 + 100), { at: T0 + 100 })
    expect(partner?.pathname).toBe('/A/a2.md')
    expect(candidates.size).toBe(1)
    expect(candidates.get('a')?.pathname).toBe('/A/a1.md')
  })

  it('returns null and leaves the map untouched when nothing pairs', () => {
    const candidates = new Map([['a', { pathname: '/B/other.md', birthTime: 900_000, at: T0 }]])
    const partner = takeRenamePartner(candidates, evt('/A/old.md', 900_000, T0 + 100), { at: T0 + 100 })
    expect(partner).toBeNull()
    expect(candidates.size).toBe(1)
  })
})
