// Type declarations for the VENDORED md2slides layout-core (see layout-core.js
// banner for provenance). Hand-maintained against the single source in the
// md2slides repo (core/paginate/layout-core.js) — regenerate awareness: when
// the source gains/changes exports, update this file in the same change.

export interface BlockDesc {
  tag: string
  soleImg?: boolean
  katexDisplay?: boolean
}

export type CoreType = 'code' | 'table' | 'list' | 'image' | 'math' | null

export interface LayoutUnit {
  role: 'flow' | 'core'
  type: CoreType
  core: number
  intro: number
  outro: number
  start: number
  end: number
}

export interface LayoutStrategy {
  readonly widowFill: number
  readonly coreBreakFill: number
  readonly tocRoomSlack: number
  readonly textShrinkFloor: number
  readonly mediaFitRounds: number
  readonly mediaFitShrink: number
  readonly maxPasses: number
  readonly margin: number
  readonly repeatHeading: boolean
  readonly orphanLines: number
  readonly widowLines: number
}

export type LineCut =
  | { kind: 'fits' }
  | { kind: 'at'; keep: number }
  | { kind: 'before' }
  | { kind: 'split-anyway'; keep: number }

export type LineCutOpts = { orphansMin?: number; widowLines?: number }

export declare const STRATEGY: LayoutStrategy
export declare const isHeadingTag: (tag: string) => boolean
export declare const canBeIntroTag: (tag: string) => boolean
export declare const canBeOutroTag: (tag: string) => boolean
export declare const classifyCore: (desc: BlockDesc) => CoreType
export declare const assembleUnits: (descs: BlockDesc[]) => LayoutUnit[]
export declare const countFittingPrefix: (heights: number[], room: number) => number
export declare const cutIndexByBottom: (bottoms: number[], limit: number) => number
export declare const trimTrailingBlankLines: (lines: string[]) => string[]
export declare const bisectMaxFit: (count: number, fits: (k: number) => boolean) => number
export declare const adjustForWidow: (
  units: LayoutUnit[],
  tops: number[],
  ui: number,
  tailBottom: number,
  budget: number,
  widowFill?: number
) => number | null
export declare const selectCoreBreak: (
  units: LayoutUnit[],
  descs: BlockDesc[],
  rowBottoms: number[],
  avail: number,
  coreBreakFill?: number
) => LayoutUnit | null
export declare const cutLinesFitting: (
  lineHeights: number[],
  room: number,
  pageRoom: number,
  opts?: LineCutOpts
) => LineCut
