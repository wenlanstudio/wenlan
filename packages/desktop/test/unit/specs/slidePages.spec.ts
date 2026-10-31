import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HEADING_DIVIDER,
  SLIDE_PAGE_BREAK,
  SLIDE_PAGE_META,
  clampDivider,
  planSlidePages,
  readHeadingDivider
} from '@/util/slidePages'

// 方言契约（形态模型 §3）：本套规则与 md2slides core/split/sectionize.js
// 同族同规则——这里钉住的是“两边不许各改各的”。
describe('planSlidePages (sectionize dialect)', () => {
  it('opens a card per heading at or below the divider (default 3)', () => {
    const pages = planSlidePages([
      { kind: 'heading', level: 1 }, // 卡1（扉页）
      { kind: 'block' }, // 卡1
      { kind: 'heading', level: 3 }, // 卡2
      { kind: 'block' }, // 卡2
      { kind: 'heading', level: 2 }, // 卡3
      { kind: 'block' } // 卡3
    ])
    expect(pages).toEqual([1, 1, 2, 2, 3, 3])
  })

  it('keeps h4–h6 in the current card (they do not divide by default)', () => {
    const pages = planSlidePages([
      { kind: 'heading', level: 2 },
      { kind: 'heading', level: 4 }, // 不分页
      { kind: 'block' },
      { kind: 'heading', level: 6 } // 不分页
    ])
    expect(pages).toEqual([1, 1, 1, 1])
  })

  it('divider raises the cut: headingDivider 6 makes every heading divide', () => {
    const pages = planSlidePages(
      [
        { kind: 'heading', level: 2 },
        { kind: 'heading', level: 5 },
        { kind: 'block' }
      ],
      6
    )
    expect(pages).toEqual([1, 2, 2])
  })

  it('treats preamble content (no leading heading) as card 1', () => {
    const pages = planSlidePages([{ kind: 'block' }, { kind: 'block' }])
    expect(pages).toEqual([1, 1])
  })

  it('breaks on a page-break block without joining a card', () => {
    const pages = planSlidePages([
      { kind: 'block' }, // 卡1
      { kind: 'break' }, // 分页符，不入卡
      { kind: 'block' } // 卡2
    ])
    expect(pages).toEqual([1, SLIDE_PAGE_BREAK, 2])
  })

  it('never yields an empty card: consecutive breaks collapse', () => {
    const pages = planSlidePages([
      { kind: 'block' },
      { kind: 'break' },
      { kind: 'break' },
      { kind: 'break' },
      { kind: 'block' },
      { kind: 'break' }, // 尾随分页符：其后无内容，不再开卡
      { kind: 'break' }
    ])
    expect(pages).toEqual([1, -1, -1, -1, 2, -1, -1])
  })

  it('a heading right after a break opens the next card (no double cut)', () => {
    const pages = planSlidePages([
      { kind: 'block' },
      { kind: 'break' },
      { kind: 'heading', level: 2 },
      { kind: 'block' }
    ])
    expect(pages).toEqual([1, SLIDE_PAGE_BREAK, 2, 2])
  })

  it('a lone heading is a legitimate title-only card', () => {
    const pages = planSlidePages([
      { kind: 'heading', level: 1 },
      { kind: 'heading', level: 2 },
      { kind: 'block' }
    ])
    expect(pages).toEqual([1, 2, 2])
  })

  it('tags front-matter as meta without taking a card slot', () => {
    const pages = planSlidePages([
      { kind: 'frontmatter' },
      { kind: 'heading', level: 2 },
      { kind: 'block' }
    ])
    expect(pages).toEqual([SLIDE_PAGE_META, 1, 1])
  })

  it('ignores heading level 0 / missing level as plain content', () => {
    const pages = planSlidePages([{ kind: 'heading', level: 0 }, { kind: 'heading' }])
    expect(pages).toEqual([1, 1])
  })
})

describe('headingDivider config (compose.js dialect)', () => {
  it('defaults to 3 and clamps to 1–6', () => {
    expect(DEFAULT_HEADING_DIVIDER).toBe(3)
    expect(clampDivider(0)).toBe(1)
    expect(clampDivider(9)).toBe(6)
    expect(clampDivider(2.9)).toBe(2)
    expect(clampDivider('abc')).toBe(3)
    expect(clampDivider(undefined)).toBe(3)
  })

  it('reads headingDivider from the leading front-matter block', () => {
    expect(readHeadingDivider('---\ntitle: T\nheadingDivider: 2\n---\n# A\n')).toBe(2)
    expect(readHeadingDivider('---\nheadingDivider: 6\n---\nbody')).toBe(6)
  })

  it('falls back to the default without usable front-matter', () => {
    expect(readHeadingDivider('# No front-matter')).toBe(3)
    expect(readHeadingDivider('---\ntitle: only\n---\n# A')).toBe(3)
    expect(readHeadingDivider('---\nheadingDivider: x9\n---\n')).toBe(3)
    // 不认正文中间的伪 front-matter
    expect(readHeadingDivider('body\n---\nheadingDivider: 6\n---\n')).toBe(3)
  })
})
