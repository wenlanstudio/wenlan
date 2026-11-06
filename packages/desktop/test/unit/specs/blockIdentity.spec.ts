// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
  BlockRegistry,
  applyBlockIds,
  blockIdOf
} from '@/sync/blockIdentity'
import { stableHash64, stableStringify } from '@/sync/stableHash'

const para = (text: string, extra: Record<string, unknown> = {}) => ({
  name: 'paragraph',
  text,
  ...extra
})

describe('BlockRegistry — sync-design D1 re-anchoring', () => {
  it('allocates stable ids and reports no affected ids for an unchanged tree', () => {
    const registry = new BlockRegistry('S1')
    const states = [para('one'), para('two'), para('three')]

    const first = registry.reanchor(states)
    expect(new Set(first.blockIds).size).toBe(3)
    expect(first.ambiguousCount).toBe(0)

    const second = registry.reanchor(states)
    expect(second.blockIds).toEqual(first.blockIds)
    expect(second.affectedIds).toEqual([])
  })

  it('keeps untouched ids when a block is inserted in the middle', () => {
    const registry = new BlockRegistry('S1')
    const before = registry.reanchor([para('A'), para('B'), para('C')])
    const after = registry.reanchor([para('A'), para('X'), para('B'), para('C')])

    expect(after.blockIds[0]).toBe(before.blockIds[0])
    expect(after.blockIds[2]).toBe(before.blockIds[1])
    expect(after.blockIds[3]).toBe(before.blockIds[2])
    expect(after.blockIds[1]).not.toBe(before.blockIds[1])
    expect(after.affectedIds).toContain(after.blockIds[1])
    expect(registry.getIds()).toEqual(after.blockIds)
  })

  it('keeps the surviving ids after a deletion', () => {
    const registry = new BlockRegistry('S1')
    const before = registry.reanchor([para('A'), para('B'), para('C')])
    const after = registry.reanchor([para('A'), para('C')])

    expect(after.blockIds).toEqual([before.blockIds[0], before.blockIds[2]])
  })

  it('changes only the edited block id, including on metadata or type changes', () => {
    const registry = new BlockRegistry('S1')
    const before = registry.reanchor([para('A'), para('B'), para('C')])

    const textEdit = registry.reanchor([para('A'), para('B edited'), para('C')])
    expect(textEdit.blockIds[0]).toBe(before.blockIds[0])
    expect(textEdit.blockIds[2]).toBe(before.blockIds[2])
    expect(textEdit.blockIds[1]).not.toBe(before.blockIds[1])

    const metaEdit = registry.reanchor([para('A'), { ...para('B'), meta: { align: 'center' } }, para('C')])
    expect(metaEdit.blockIds[1]).not.toBe(textEdit.blockIds[1])

    const typeEdit = registry.reanchor([
      para('A'),
      { name: 'atx-heading', meta: { level: 2 }, text: 'B' },
      para('C')
    ])
    expect(typeEdit.blockIds[1]).not.toBe(metaEdit.blockIds[1])
  })

  it('never guesses which identical block survived: ambiguity means new ids', () => {
    const registry = new BlockRegistry('S1')
    const states = [para('same'), para('same'), para('tail')]
    // The first re-anchor has no previous identities to be ambiguous about.
    const first = registry.reanchor(states)
    expect(first.ambiguousCount).toBe(0)

    // Swapping two identical paragraphs leaves the sequence byte-identical.
    // An index-based guess would "restore" the wrong identity; we rebuild.
    const swapped = registry.reanchor([para('same'), para('same'), para('tail')])
    expect(swapped.ambiguousCount).toBeGreaterThan(0)
    for (const id of swapped.blockIds.slice(0, 2)) {
      expect(first.blockIds.slice(0, 2)).not.toContain(id)
    }
    // A unique block still keeps its identity.
    expect(swapped.blockIds[2]).toBe(first.blockIds[2])
  })

  it('follows a block when two distinct blocks swap order', () => {
    const registry = new BlockRegistry('S1')
    const before = registry.reanchor([para('A'), para('B'), para('C')])
    const after = registry.reanchor([para('A'), para('C'), para('B')])

    expect(after.blockIds[1]).toBe(before.blockIds[2])
    expect(after.blockIds[2]).toBe(before.blockIds[1])
  })

  it('discards every id when the document session changes', () => {
    const registry = new BlockRegistry('S1')
    const before = registry.reanchor([para('A'), para('B')])
    registry.reset('S2')
    const after = registry.reanchor([para('A'), para('B')])

    expect(after.blockIds[0]).not.toBe(before.blockIds[0])
    expect(after.blockIds[0]).toContain('S2:')
    expect(registry.getDiagnostics().sessionId).toBe('S2')
  })

  it('records re-anchor cost for the M4 incremental-hash benchmark', () => {
    const registry = new BlockRegistry('S1')
    const states = Array.from({ length: 200 }, (_, i) => para(`block ${i}`))
    const result = registry.reanchor(states)

    expect(result.blockIds).toHaveLength(200)
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0)
    expect(registry.getDiagnostics().lastReanchorMs).toBe(result.elapsedMs)
  })
})

describe('stableHash64 / DOM anchors', () => {
  it('hashes canonical state independent of object key order', () => {
    expect(stableStringify({ a: 1, b: [2, { d: 4, c: 3 }] }))
      .toBe(stableStringify({ b: [2, { c: 3, d: 4 }], a: 1 }))
    expect(stableHash64({ name: 'paragraph', text: 'x' }))
      .toBe(stableHash64({ text: 'x', name: 'paragraph' }))
    expect(stableHash64(para('x'))).not.toBe(stableHash64(para('y')))
    expect(stableHash64(para('x'))).not.toBe(stableHash64({ ...para('x'), meta: { lang: 'js' } }))
  })

  it('applies ids to the live container children and reads them back', () => {
    const root = document.createElement('div')
    const container = document.createElement('div')
    container.className = 'mu-container'
    const first = document.createElement('p')
    const second = document.createElement('p')
    container.append(first, second)
    root.appendChild(container)
    document.body.appendChild(root)

    const count = applyBlockIds(root, ['S1:B1', 'S1:B2'])
    expect(count).toBe(2)
    expect(first.dataset.blockId).toBe('S1:B1')
    expect(blockIdOf(first)).toBe('S1:B1')
    const child = document.createElement('span')
    first.appendChild(child)
    expect(blockIdOf(child)).toBe('S1:B1')
    expect(blockIdOf(second)).toBe('S1:B2')

    // A stale id is cleared instead of surviving a shorter document.
    applyBlockIds(root, ['S1:B1'])
    expect(second.dataset.blockId).toBeUndefined()
    root.remove()
  })
})
