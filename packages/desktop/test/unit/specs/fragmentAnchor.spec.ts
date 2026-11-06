// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import {
  canonicalNode,
  findFragment,
  findFragments,
  fragmentIdOf,
  markFragment,
  readFragment
} from '@/sync/fragmentAnchor'

const blockId = 'S1:B7'

const makeFragment = (index: number, kind: 'lines' | 'kids' = 'lines') => {
  const node = document.createElement('p')
  markFragment(node, {
    blockId,
    fragmentId: fragmentIdOf(blockId, index),
    kind,
    from: index * 10,
    to: index * 10 + 10
  })
  return node
}

let root: HTMLElement

beforeEach(() => {
  document.body.innerHTML = ''
  root = document.createElement('div')
  document.body.appendChild(root)
})

describe('fragment anchors — sync-design D5', () => {
  it('marks a node with its logical range and reads it back', () => {
    const node = makeFragment(0)
    root.appendChild(node)

    expect(node.dataset.blockId).toBe(blockId)
    expect(node.dataset.fragmentId).toBe('S1:B7:f0')
    expect(node.dataset.fragmentKind).toBe('lines')
    expect(readFragment(node)).toEqual({
      blockId,
      fragmentId: 'S1:B7:f0',
      kind: 'lines',
      from: 0,
      to: 10
    })
  })

  it('one block legitimately appears in several fragments', () => {
    root.append(makeFragment(0), makeFragment(1), makeFragment(2, 'kids'))

    const nodes = findFragments(root, blockId)
    expect(nodes).toHaveLength(3)
    expect(nodes.map(node => node.dataset.fragmentId)).toEqual([
      'S1:B7:f0',
      'S1:B7:f1',
      'S1:B7:f2'
    ])
    expect(findFragment(root, 'S1:B7:f1')).toHaveLength(1)
    expect(canonicalNode(root, blockId)?.dataset.fragmentId).toBe('S1:B7:f0')
  })

  it('never confuses two different blocks that share a fragment index', () => {
    const other = document.createElement('p')
    markFragment(other, {
      blockId: 'S1:B8',
      fragmentId: fragmentIdOf('S1:B8', 0),
      kind: 'whole',
      from: 0,
      to: 0
    })
    root.append(makeFragment(0), other)

    expect(findFragments(root, blockId)).toHaveLength(1)
    expect(readFragment(other)?.kind).toBe('whole')
    expect(findFragments(root, blockId)[0]).not.toBe(other)
  })

  it('renders without inventing an anchor when identity is unavailable', () => {
    const node = document.createElement('p')
    markFragment(node, {
      blockId: '',
      fragmentId: fragmentIdOf('', 0),
      kind: 'whole',
      from: 0,
      to: 0
    })
    root.appendChild(node)

    expect(node.dataset.blockId).toBeUndefined()
    expect(readFragment(node)).toBeNull()
  })

  it('escapes selector metacharacters in block ids', () => {
    const odd = 'S1:"B9"'
    const node = document.createElement('p')
    markFragment(node, {
      blockId: odd,
      fragmentId: fragmentIdOf(odd, 0),
      kind: 'whole',
      from: 0,
      to: 0
    })
    root.appendChild(node)

    expect(findFragments(root, odd)).toEqual([node])
  })
})
