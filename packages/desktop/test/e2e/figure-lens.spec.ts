import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithMarkdown } from './helpers'

// 图透镜看守（2026-11-08，视图模型 §1）：点「图」→ 同一活引擎只读态只显
// 代码型图表块（figure.mu-diagram-block）；正文/代码块/含行内图片的段落全藏
// （muya 无 image 块态——image state 评估后放弃，行内图片不进图）。图表渲染
// 是否出 SVG 不在断言范围（透镜语义是显隐，不是图表引擎）。再点「图」→ 回文。

const MD = [
  '# demo',
  '',
  'plain paragraph',
  '',
  '```python',
  'print(1)',
  '```',
  '',
  '```mermaid',
  'graph TD',
  '  A --> B',
  '```',
  '',
  '![inline pic](file://nonexistent.png)',
  ''
].join('\n')

test.describe('图 lens — code-typed diagrams only', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown(MD)
    app = launched.app
    page = launched.page
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('图 shows only diagram blocks; paragraphs/code/inline-image paragraphs hidden', async() => {
    await expect(page.locator('.pane-left .editor-component .mu-container')).toBeVisible({
      timeout: 10000
    })

    await page.locator('.main-view-btn', { hasText: '图' }).first().click()
    await expect(page.locator(".lens-host[data-lens='figure']")).toBeVisible({ timeout: 5000 })

    const state = await page.evaluate(() => {
      const container = document.querySelector(
        ".lens-host[data-lens='figure'] .mu-container"
      ) as HTMLElement | null
      if (!container) return { hidden: [] as string[], shown: [] as string[] }
      const hidden: string[] = []
      const shown: string[] = []
      for (const el of Array.from(container.children) as HTMLElement[]) {
        const cls = el.className.split(' ').find(c => c.startsWith('mu-')) ?? el.tagName
        ;(getComputedStyle(el).display === 'none' ? hidden : shown).push(cls)
      }
      return { hidden, shown }
    })

    expect(state.shown).toEqual(['mu-diagram-block'])
    expect(state.hidden).toEqual(
      expect.arrayContaining(['mu-paragraph', 'mu-code-block'])
    )
    // 含行内图片的段落也在 hidden 的 mu-paragraph 里——行内图片不进图。

    // 占位已退役：透镜态下没有 view-placeholder。
    await expect(page.locator('.view-placeholder')).toHaveCount(0)

    // 再点「图」→ 回文全屏，所有块恢复可见。
    await page.locator('.main-view-btn', { hasText: '图' }).first().click()
    await expect(page.locator(".lens-host[data-lens='figure']")).toHaveCount(0)
    const flowState = await page.evaluate(() => {
      const container = document.querySelector(
        '.pane-left .editor-component .mu-container'
      ) as HTMLElement | null
      if (!container) return { hidden: [] as string[], count: -1 }
      return {
        count: container.children.length,
        hidden: (Array.from(container.children) as HTMLElement[])
          .filter(el => getComputedStyle(el).display === 'none')
          .map(el => el.className)
      }
    })
    expect(flowState.count).toBeGreaterThan(0)
    expect(flowState.hidden).toEqual([])
  })
})
