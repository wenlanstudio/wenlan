import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithMarkdown } from './helpers'

// 码透镜看守（2026-11-08，视图模型 §1/§6.3）：点「码」→ 同一活引擎只读态
// 只显代码块（正文/标题/表格/图表全藏，CSS `[data-lens='code']`）；单击块 →
// 执行窗打开并高亮定位该块；面板右上角 × 是唯一常驻关闭途径（切换器已无
// 执行窗开关）。再点「码」→ 回文全屏，全部块恢复可见。

const MD = [
  '# demo',
  '',
  'plain paragraph',
  '',
  '| a | b |',
  '| - | - |',
  '| 1 | 2 |',
  '',
  '```python',
  'print(1)',
  '```',
  ''
].join('\n')

test.describe('码 lens — code blocks only, click locates the run panel', () => {
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

  const lensState = (page: Page): Promise<{ hidden: string[]; shown: string[] }> =>
    page.evaluate(() => {
      const container = document.querySelector(
        ".lens-host[data-lens='code'] .mu-container"
      ) as HTMLElement | null
      if (!container) return { hidden: [], shown: [] }
      const hidden: string[] = []
      const shown: string[] = []
      for (const el of Array.from(container.children) as HTMLElement[]) {
        const cls = el.className.split(' ').find((c) => c.startsWith('mu-')) ?? el.tagName
        ;(getComputedStyle(el).display === 'none' ? hidden : shown).push(cls)
      }
      return { hidden, shown }
    })

  test('码 shows only code blocks; click locates the panel; × closes it', async() => {
    await expect(page.locator('.pane-left .editor-component .mu-container')).toBeVisible({
      timeout: 10000
    })

    // 有可跑块时面板会在载入后自动展开一次（现行行为）——先用右上角 × 收起，
    // 顺带把「× 能关」单独钉死。
    const panel = page.locator('.exec-panel')
    if (await panel.isVisible().catch(() => false)) {
      await page.locator('.panel-close').click()
      await expect(panel).toBeHidden()
    }

    // 切码透镜：非代码块藏、代码块显。
    await page.locator('.main-view-btn', { hasText: '码' }).first().click()
    await expect(page.locator(".lens-host[data-lens='code']")).toBeVisible({ timeout: 5000 })

    const state = await lensState(page)
    expect(state.shown).toEqual(['mu-code-block'])
    expect(state.hidden).toEqual(expect.arrayContaining(['mu-paragraph', 'mu-table']))
    // 图表归图：围栏语言是 python，这里没有图表块——但要防回归把 mu-diagram-block
    // 误藏/误显，先钉住「透镜里类清单只认 mu-code-block」由上一行断言承担。

    // 单击代码块本体（避开右上角 ▶/复制按钮）→ 执行窗打开 + 对应行高亮。
    await page.locator('.lens-host .mu-codeblock-content').first().click()
    await expect(panel).toBeVisible({ timeout: 5000 })
    await expect(page.locator('.exec-panel .block-row.active')).toBeVisible({ timeout: 5000 })

    // × 关闭。
    await page.locator('.panel-close').click()
    await expect(panel).toBeHidden()

    // 再点「码」→ 回文全屏，所有块恢复可见。
    await page.locator('.main-view-btn', { hasText: '码' }).first().click()
    await expect(page.locator(".lens-host[data-lens='code']")).toHaveCount(0)
    const flowState = await page.evaluate(() => {
      const container = document.querySelector(
        '.pane-left .editor-component .mu-container'
      ) as HTMLElement | null
      if (!container) return { hidden: [] as string[], count: -1 }
      return {
        count: container.children.length,
        hidden: (Array.from(container.children) as HTMLElement[])
          .filter((el) => getComputedStyle(el).display === 'none')
          .map((el) => el.className)
      }
    })
    expect(flowState.count).toBeGreaterThan(0)
    expect(flowState.hidden).toEqual([])
  })

  test('panel row click reveals inside the lens without throwing on the readOnly engine', async() => {
    // 执行窗行点击 → mdcode2run-reveal-line → setCursorByOffset（muya 只读
    // 引擎上的行为此处钉死：不许抛错、不许把透镜滚丢；块须留在视口内）。
    await page.locator('.main-view-btn', { hasText: '码' }).first().click()
    await expect(page.locator(".lens-host[data-lens='code']")).toBeVisible({ timeout: 5000 })
    // 前一用例可能已把面板关掉（× 只在面板开着时存在）——条件收起。
    if (await page.locator('.exec-panel').isVisible().catch(() => false)) {
      await page.locator('.panel-close').click()
      await expect(page.locator('.exec-panel')).toHaveCount(0)
    }

    // 码透镜单击块 → 面板重开并定位（§6.3 工具窗定位）。
    await page.locator('.lens-host .mu-codeblock-content').first().click()
    await expect(page.locator('.exec-panel')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('.exec-panel .block-row.active')).toBeVisible({ timeout: 5000 })

    // 再点行 → reveal 通路在只读引擎上走通。
    await page.locator('.exec-panel .block-row.active').click()
    const box = await page.locator('.lens-host .mu-code-block').first().boundingBox()
    expect(box).not.toBeNull()
    if (box) {
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeLessThan(page.viewportSize()?.height ?? Number.MAX_SAFE_INTEGER)
    }
  })
})
