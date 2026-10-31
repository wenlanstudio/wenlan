/**
 * slidePages — slide 形态（语义卡透镜）的页归属逻辑。
 *
 * 方言契约：本文件与 md2slides `core/split/sectionize.js` 同族同规则
 * （形态模型 §3，`docs/design/view-model.md`）——级别 ≤ headingDivider 的
 * 标题另起一页；裸分页符（`---`，muya 的 mu-thematic-break 块）切页且自身
 * 不入页；无内容不开页。**改规则必须两边一起改**，共同裁判语料在
 * `md2slides/e2e/fixtures/dialect/slidebreak.md`。
 *
 * 成片与透镜的已接受分歧：封面 / 目录页是引擎生成物（cover.js / toc.js），
 * 透镜只画源码推导的页，不显示它们；front-matter 是封面源，标记为 meta
 * 不成卡。
 */

export type SlideBlockKind = 'frontmatter' | 'heading' | 'break' | 'block'

export interface SlideBlockInput {
  kind: SlideBlockKind
  /** heading 的级别（1–6），其余 kind 忽略。 */
  level?: number
}

/** 卡号特殊值：分页符块（hr）——不成卡，画成分页标记。 */
export const SLIDE_PAGE_BREAK = -1

/** 卡号特殊值：front-matter——不成卡，画成封面源 meta 条。 */
export const SLIDE_PAGE_META = -2

export const DEFAULT_HEADING_DIVIDER = 3

/**
 * 每块所属的语义卡号（1 起）。与 sectionize 的页语义逐条对齐：
 * - 标题（级别 ≤ divider）恒开新卡——「只有标题的扉页」是正当形态；
 * - 分页符把 current 置空且自身不入卡；紧跟的分页符 / 标题不产空卡；
 * - 首个内容块（无先行标题 / 分页符）开第 1 卡。
 */
export const planSlidePages = (
  blocks: SlideBlockInput[],
  divider: number = DEFAULT_HEADING_DIVIDER
): number[] => {
  const limit = clampDivider(divider)
  const pages: number[] = []
  let current = 0
  let open = false

  for (const b of blocks) {
    if (b.kind === 'frontmatter') {
      pages.push(SLIDE_PAGE_META)
      continue // 封面源不占卡位，也不打断 current（其必然在最前）
    }
    if (b.kind === 'break') {
      pages.push(SLIDE_PAGE_BREAK)
      open = false
      continue
    }
    const level = b.kind === 'heading' ? (b.level ?? 0) : 0
    if (b.kind === 'heading' && level >= 1 && level <= limit) {
      current += 1
      open = true
      pages.push(current)
      continue
    }
    if (!open) {
      current += 1
      open = true
    }
    pages.push(current)
  }

  return pages
}

/** 与 md2slides compose.js 的 clampDivider 同值语义：非有限数落默认，钳 1–6。 */
export const clampDivider = (value: unknown): number => {
  const n = Number(value)
  return Number.isFinite(n)
    ? Math.min(6, Math.max(1, Math.trunc(n)))
    : DEFAULT_HEADING_DIVIDER
}

/**
 * 从 markdown 源读 front-matter 的 `headingDivider`（缺省 3）。
 * 只认文档头的 `--- … ---` 块，够用且不惊动引擎的 front-matter 解析器。
 */
export const readHeadingDivider = (markdown: string): number => {
  const raw = markdown ?? ''
  if (!/^---[ \t]*\r?\n/.test(raw)) return DEFAULT_HEADING_DIVIDER
  const end = raw.slice(4).search(/^(---|\.\.\.)[ \t]*\r?$/m)
  if (end < 0) return DEFAULT_HEADING_DIVIDER
  const fm = raw.slice(4, 4 + end)
  const m = fm.match(/^headingDivider:[ \t]*(\S+)[ \t]*$/m)
  return clampDivider(m?.[1])
}

/**
 * 把卡归属打到 muya 顶层块 DOM 上（零 DOM 重组——只设属性，不动结构）：
 * - `data-slide-page="n"`：卡号（P5 物理徽章按卡号聚合 deck src 段）；
 * - `data-slide-first` / `data-slide-last`：卡首/尾块（分段边框的圆角端）；
 * - `data-slide-break`：分页符；`data-slide-meta`：front-matter。
 * 幂等：每次全量重打，块被 snabbdom 重建后属性漂移由下一次调用自愈。
 */
export const applySlideLensTags = (
  container: HTMLElement,
  markdown: string
): void => {
  const children = [...container.children] as HTMLElement[]
  const inputs: SlideBlockInput[] = children.map(el => {
    if (el.classList.contains('mu-frontmatter')) return { kind: 'frontmatter' }
    if (el.classList.contains('mu-thematic-break')) return { kind: 'break' }
    const m = /^H([1-6])$/.exec(el.tagName)
    return m ? { kind: 'heading', level: Number(m[1]) } : { kind: 'block' }
  })

  const pages = planSlidePages(inputs, readHeadingDivider(markdown))

  for (let i = 0; i < children.length; i++) {
    const el = children[i]
    const page = pages[i]
    el.removeAttribute('data-slide-first')
    el.removeAttribute('data-slide-last')

    if (page === SLIDE_PAGE_BREAK) {
      el.removeAttribute('data-slide-page')
      el.removeAttribute('data-slide-meta')
      el.setAttribute('data-slide-break', '')
      continue
    }
    el.removeAttribute('data-slide-break')
    if (page === SLIDE_PAGE_META) {
      el.removeAttribute('data-slide-page')
      el.setAttribute('data-slide-meta', '')
      continue
    }
    el.removeAttribute('data-slide-meta')
    el.setAttribute('data-slide-page', String(page))
    if (pages[i - 1] !== page) el.setAttribute('data-slide-first', '')
    if (pages[i + 1] !== page) el.setAttribute('data-slide-last', '')
  }
}
