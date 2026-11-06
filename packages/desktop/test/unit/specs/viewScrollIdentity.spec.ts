// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import {
  contentBlocks,
  readViewAnchor,
  scrollViewToAnchor,
  viewAnchorOf,
  writeViewAnchor
} from '@/util/viewScrollSync'

const mockRects = (container: HTMLElement, tops: number[]): void => {
  container.getBoundingClientRect = () =>
    ({ top: 0, bottom: 600, height: 600 }) as DOMRect
  contentBlocks(container).forEach((block, i) => {
    block.getBoundingClientRect = () =>
      ({ top: tops[i], bottom: tops[i] + 100, height: 100 }) as DOMRect
  })
}

const build = (html: string): HTMLElement => {
  const container = document.createElement('div')
  container.innerHTML = `<div class="mu-container">${html}</div>`
  document.body.appendChild(container)
  return container
}

let container: HTMLElement

beforeEach(() => {
  document.body.innerHTML = ''
  container = build(
    '<p data-block-id="S1:B1">first</p>'
    + '<p data-block-id="S1:B2" data-fragment-id="S1:B2:f0">second</p>'
    + '<p data-block-id="S1:B3">third</p>'
  )
  mockRects(container, [-100, 0, 100])
})

describe('identity-based scroll anchors — sync-design D5', () => {
  it('records block/fragment ids and viewport offset at the viewport top', () => {
    const anchor = viewAnchorOf(container)

    expect(anchor?.blockId).toBe('S1:B2')
    expect(anchor?.fragmentId).toBe('S1:B2:f0')
    expect(anchor?.blockIndex).toBe(1)
    expect(anchor?.viewportOffset).toBe(0)
  })

  it('prefers blockId over a stale blockIndex', () => {
    scrollViewToAnchor(container, {
      blockId: 'S1:B3',
      blockIndex: 0,
      text: 'first'
    })

    // The third block sits at y=100; the stale index would have used y=-100.
    expect(container.scrollTop).toBe(100)
  })

  it('prefers fragmentId when one block has several fragments', () => {
    const extra = document.createElement('p')
    extra.dataset.blockId = 'S1:B3'
    extra.dataset.fragmentId = 'S1:B3:f1'
    extra.textContent = 'third (continued)'
    container.querySelector('.mu-container')?.appendChild(extra)
    mockRects(container, [-100, 0, 100, 200])

    scrollViewToAnchor(container, { fragmentId: 'S1:B3:f1', blockId: 'S1:B3' })
    expect(container.scrollTop).toBe(200)
  })

  it('restores the intra-viewport offset', () => {
    scrollViewToAnchor(container, { blockId: 'S1:B3', viewportOffset: 40 })
    expect(container.scrollTop).toBe(60)
  })

  it('falls back to the legacy text bridge when no identity is available', () => {
    scrollViewToAnchor(container, { text: 'third' })
    expect(container.scrollTop).toBe(100)
  })

  it('merges identity coordinates without dropping source-view line anchors', () => {
    writeViewAnchor('tab-1', { line: 12, text: 'source line' })
    writeViewAnchor('tab-1', { blockId: 'S1:B2', viewportOffset: 8 })

    expect(readViewAnchor('tab-1')).toMatchObject({
      line: 12,
      text: 'source line',
      blockId: 'S1:B2',
      viewportOffset: 8
    })
  })
})
