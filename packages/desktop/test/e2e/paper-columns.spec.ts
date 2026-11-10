import { expect, test } from '@playwright/test'
import { launchWithMarkdown, sendIpcToRenderer, waitForMenuReady } from './helpers'

// 页叶（A4 真分片投影）必须按 `<!-- begin/split/end -->` 渲染成左右双栏，
// 而不是像编辑面那样用 display:contents 摊平——打印链 exportStyle.css 的
// .mdcols-group 本就是 flex 行（视图模型 §5）。此用例守住「屏显所见 =
// 打印所得」里最容易悄悄退化的一环：CSS 覆盖、栏宽、徽标收口。
const DOC = [
  '# 分栏页叶验收',
  '',
  '开篇段落，位于分栏组之前。',
  '',
  '<!-- begin 50:50 -->',
  '',
  '左栏第一段：纸面应把这一栏与右栏并排放置，而不是把分栏标记当作正文摊平。',
  '',
  '左栏第二段：两栏宽度由 begin 标记的 50:50 比例给出，应大致相等。',
  '',
  '<!-- split -->',
  '',
  '右栏第一段：与左栏并排，分栏徽标在成品纸面上不应出现。',
  '',
  '右栏第二段：收口段落，用于确认栏内文字确实进入页卡。',
  '',
  '<!-- end -->',
  '',
  '收尾段落，位于分栏组之后。',
  ''
].join('\n')

test.describe('page leaf renders real column groups (view-model §5)', () => {
  test('begin/split/end become side-by-side columns on A4 cards', async() => {
    test.setTimeout(120_000)
    const { app, page } = await launchWithMarkdown(DOC)
    try {
      await waitForMenuReady(app)
      // 启动可能恢复上一次的缓冲标签；显式开一张只装本用例文档的标签并选中。
      await sendIpcToRenderer(app, 'mt::new-untitled-tab', true, DOC)
      await page.waitForFunction(() => document.body.innerText.includes('左栏第一段'), null, {
        timeout: 20_000
      })

      // 进「页」叶全屏：(文, 页) 成对后摘掉 文（paper-page-count.spec 同款）。
      const leafBtn = page.locator('.view-switcher .leaf-btn', { hasText: '页' })
      const flowBtn = page.locator('.view-switcher .leaf-btn', { hasText: '文' })
      await leafBtn.waitFor({ state: 'visible', timeout: 15_000 })
      await leafBtn.click()
      await flowBtn.click()

      const deck = page.locator('.mu-paper-deck[data-page-count]')
      await deck.waitFor({ state: 'visible', timeout: 20_000 })
      await page.waitForFunction(
        () => document.querySelectorAll('.mu-paper-page .mu-columns').length > 0,
        null,
        { timeout: 20_000 }
      )

      const out = await page.evaluate(() => {
        const groups = [...document.querySelectorAll<HTMLElement>('.mu-paper-page .mu-columns')]
        const group = groups[0]
        const kids = group ? [...group.children] : []
        const rect = (el: Element) => {
          const r = el.getBoundingClientRect()
          return { x: r.x, w: r.width }
        }
        const badges = [...document.querySelectorAll<HTMLElement>('.mu-paper-page .mu-mdcols-marker')]
        return {
          groups: groups.length,
          display: group ? getComputedStyle(group).display : '',
          columnDisplay: kids[0] ? getComputedStyle(kids[0]).display : '',
          left: kids[0] ? rect(kids[0]) : null,
          right: kids[1] ? rect(kids[1]) : null,
          badgesVisible: badges.filter((b) => getComputedStyle(b).display !== 'none').length,
          hasLeftText: !!document.querySelector('.mu-paper-deck')?.textContent?.includes('左栏第一段'),
          hasRightText: !!document.querySelector('.mu-paper-deck')?.textContent?.includes('右栏第一段'),
          pageCount: Number(document.querySelector('.mu-paper-deck')?.getAttribute('data-page-count'))
        }
      })

      expect(out.groups, 'one column group in the paper deck').toBe(1)
      expect(out.display, 'group is a flex row in the paper leaf').toBe('flex')
      expect(out.columnDisplay).toBe('flex')
      expect(out.left && out.right).toBeTruthy()
      if (out.left && out.right) {
        expect(out.right.x).toBeGreaterThan(out.left.x)
        expect(Math.abs(out.left.w - out.right.w)).toBeLessThan(4)
      }
      expect(out.badgesVisible, 'marker badges are hidden on finished paper').toBe(0)
      expect(out.hasLeftText && out.hasRightText).toBe(true)
      expect(out.pageCount).toBeGreaterThan(0)
    } finally {
      await app.close()
    }
  })

  test('a column group taller than one page is sliced into per-page bands', async() => {
    test.setTimeout(150_000)
    const fill = (label: string, n: number): string =>
      Array.from(
        { length: n },
        (_, i) =>
          `${label}第 ${String(i + 1).padStart(2, '0')} 段：这是用于把栏组撑过一整页的填充文字，` +
          '包含足够多的中文字符以便产生多行折行，从而验证超页横带裁切后的续排效果。'
      ).join('\n\n')
    const LONG_DOC = [
      '# 超页分栏组验收',
      '',
      '开篇段落，位于分栏组之前。',
      '',
      '<!-- begin 50:50 -->',
      '',
      fill('左栏', 24),
      '',
      '<!-- split -->',
      '',
      fill('右栏', 18),
      '',
      '<!-- end -->',
      '',
      '收尾段落，位于分栏组之后。',
      ''
    ].join('\n')
    const { app, page } = await launchWithMarkdown(LONG_DOC)
    try {
      await waitForMenuReady(app)
      await sendIpcToRenderer(app, 'mt::new-untitled-tab', true, LONG_DOC)
      const leafBtn = page.locator('.view-switcher .leaf-btn', { hasText: '页' })
      const flowBtn = page.locator('.view-switcher .leaf-btn', { hasText: '文' })
      await leafBtn.waitFor({ state: 'visible', timeout: 15_000 })
      await leafBtn.click()
      await flowBtn.click()
      await page.waitForFunction(
        () => document.querySelectorAll('.mu-paper-band-clip').length >= 2,
        null,
        { timeout: 25_000 }
      )
      const out = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.mu-paper-band-clip')].map((clip) => {
          const group = clip.querySelector<HTMLElement>('.mu-columns')
          return {
            height: clip.getBoundingClientRect().height,
            columns: clip.querySelectorAll('.mu-columns > .mu-column').length,
            display: group ? getComputedStyle(group).display : '',
            overflow: getComputedStyle(clip).overflow,
            transform: group?.style.transform ?? ''
          }
        })
      )
      expect(out.length).toBeGreaterThanOrEqual(2)
      expect(out.every((c) => c.columns === 2 && c.display === 'flex' && c.overflow === 'hidden')).toBe(
        true
      )
      // 续带的累计上移量逐片递增，且不带出重复的首页内容。
      expect(new Set(out.map((c) => c.transform)).size).toBe(out.length)
      expect(out.slice(0, -1).every((c) => c.height > 400)).toBe(true)
    } finally {
      await app.close()
    }
  })
})
