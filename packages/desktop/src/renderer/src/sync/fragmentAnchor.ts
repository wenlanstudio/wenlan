// sync-design D5. A projection node carries both a block anchor and a fragment
// anchor. A single blockId legitimately appears in several fragments (a block
// split across pages/slides), so every reverse lookup must expect MULTIPLE
// nodes and must never assume querySelector found "the" block.

export type FragmentKind = 'whole' | 'lines' | 'table-rows' | 'kids'

export interface FragmentAnchor {
  blockId: string
  fragmentId: string
  kind: FragmentKind
  /** Logical range inside the canonical block: line / table-row / kid index. */
  from: number
  to: number
}

export const fragmentIdOf = (blockId: string, index: number): string =>
  `${blockId}:f${index}`

/** Mark a real or cloned projection node with its logical identity. */
export function markFragment(node: HTMLElement, anchor: FragmentAnchor): void {
  // A projection may be built before the identity layer has observed the
  // document. Render the fragments anyway; never invent an anchor.
  if (!anchor.blockId) return
  node.dataset.blockId = anchor.blockId
  node.dataset.fragmentId = anchor.fragmentId
  node.dataset.fragmentKind = anchor.kind
  node.dataset.fragmentRange = `${anchor.kind}:${anchor.from}-${anchor.to}`
}

/** All nodes belonging to one canonical block, across every fragment. */
export function findFragments(root: ParentNode, blockId: string): HTMLElement[] {
  const escaped = blockId.replace(/["\\]/g, '\\$&')
  return Array.from(
    root.querySelectorAll<HTMLElement>(`[data-block-id="${escaped}"]`)
  )
}

export function findFragment(root: ParentNode, fragmentId: string): HTMLElement[] {
  const escaped = fragmentId.replace(/["\\]/g, '\\$&')
  return Array.from(
    root.querySelectorAll<HTMLElement>(`[data-fragment-id="${escaped}"]`)
  )
}

export function readFragment(node: Element | null): FragmentAnchor | null {
  if (!node) return null
  const element = node as HTMLElement
  const { blockId, fragmentId, fragmentKind, fragmentRange } = element.dataset
  if (!blockId || !fragmentId || !fragmentKind) return null
  const match = /^([a-z-]+):(\d+)-(\d+)$/.exec(fragmentRange ?? '')
  return {
    blockId,
    fragmentId,
    kind: fragmentKind as FragmentKind,
    from: match ? Number(match[2]) : 0,
    to: match ? Number(match[3]) : 0
  }
}

/**
 * The first fragment (the un-cloned canonical node) is the only legal editing
 * surface. Continuation fragments are read-only views of the same block.
 */
export function canonicalNode(root: ParentNode, blockId: string): HTMLElement | null {
  return findFragments(root, blockId).find(node =>
    node.dataset.fragmentId === fragmentIdOf(blockId, 0)
  ) ?? null
}
