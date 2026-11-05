import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithMarkdown } from './helpers'

// Issue #4 — full-chain verification inside the BUILT Electron app.
//
// The muya-side specs (packages/muya/e2e/tests/blocks/code-block-run-button-4.spec.ts)
// only prove that the button dispatches `muya:code-run` in muya's standalone
// harness. They cannot catch broken desktop wiring: the editor.vue listener,
// the bus hop, execPanel's `isCodeRunSurface` gate, or the actual execution.
// This spec clicks the real button in the real renderer and asserts all of it.

const MD = '# demo\n\n```python\nprint(1)\n```\n'

interface IRunDetail {
  text: string
}

const readRunEvents = (page: Page): Promise<IRunDetail[]> =>
  page.evaluate(() => (window as unknown as { __runEvents: IRunDetail[] }).__runEvents)

const installRunListener = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const w = window as unknown as { __runEvents: IRunDetail[] }
    w.__runEvents = []
    document.addEventListener('muya:code-run', event => {
      w.__runEvents.push((event as CustomEvent<IRunDetail>).detail)
    })
  })

test.describe('issue #4 — code block run button (desktop full chain)', () => {
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

  test('▶ dispatches the DOM event, opens the panel AND runs the block', async() => {
    await installRunListener(page)

    const button = page.locator('a.mu-code-run').first()
    await expect(button).toBeAttached({ timeout: 10000 })
    // The button is translucent until hover/active; force past the CSS reveal.
    await button.click({ force: true })

    expect(await readRunEvents(page)).toEqual([{ text: 'print(1)' }])
    await expect(page.locator('.exec-panel')).toBeVisible({ timeout: 5000 })

    // 「面板弹出来了但代码没跑」同样是用户眼里的「没反应」：把执行链路也
    // 一并钉死，避免只测到事件转发就收工。面板会在打开文档时自动展开，
    // 所以「可见」本身不是点击生效的证据，输出才是。
    await expect(page.locator('.exec-panel .output-text')).toContainText('1', {
      timeout: 20000
    })
  })
})
