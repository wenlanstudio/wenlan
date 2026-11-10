import { expect, test } from '@playwright/test'
import { launchWithMarkdown, sendIpcToRenderer, waitForMenuReady } from './helpers'

// 代码块跨页（#7 行级切分）：续片的裁剪窗高度必须等于「剩余内容高」。
// 曾经 lineStarts 少了末尾一项，末段 to === n 取到 undefined ⇒ 窗高
// `NaNpx` 退回 auto（= 整块高 + margin），下一页多出一整截空白。
const codeLines = Array.from(
  { length: 48 },
  (_, i) => `line_${String(i + 1).padStart(2, '0')} = compute(${i + 1}, value=${(i + 1) * 3})  # 数据行`
)
const DOC = [
  '# 代码块跨页验收',
  '',
  '开篇段落。',
  '',
  '```python',
  ...codeLines,
  '```',
  '',
  '收尾段落。',
  ''
].join('\n')

test.describe('page leaf code block fragmentation (view-model §5)', () => {
  test('continuation windows never exceed the remaining content height', async() => {
    test.setTimeout(150_000)
    const { app, page } = await launchWithMarkdown(DOC)
    try {
      await waitForMenuReady(app)
      await sendIpcToRenderer(app, 'mt::new-untitled-tab', true, DOC)
      await page.waitForFunction(() => document.body.innerText.includes('代码块跨页验收'), null, {
        timeout: 20_000
      })

      const leafBtn = page.locator('.view-switcher .leaf-btn', { hasText: '页' })
      const flowBtn = page.locator('.view-switcher .leaf-btn', { hasText: '文' })
      await leafBtn.waitFor({ state: 'visible', timeout: 15_000 })
      await leafBtn.click()
      await flowBtn.click()
      await page.waitForFunction(
        () => document.querySelectorAll('.mu-paper-clip > pre.mu-code-block').length >= 2,
        null,
        { timeout: 25_000 }
      )

      const clips = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.mu-paper-clip')]
          .filter((clip) => clip.querySelector(':scope > pre.mu-code-block'))
          .map((clip) => {
            const pre = clip.firstElementChild as HTMLElement
            const shift = Math.abs(
              Number.parseFloat(/translateY\((-?[\d.]+)px\)/.exec(pre.style.transform)?.[1] ?? '0')
            )
            return {
              height: clip.getBoundingClientRect().height,
              preHeight: pre.getBoundingClientRect().height,
              shift,
              hasText: !!pre.querySelector('.mu-codeblock-content')?.textContent?.trim()
            }
          })
      )

      expect(clips.length, 'code block is really split across pages').toBeGreaterThanOrEqual(2)
      for (const clip of clips) {
        const remaining = clip.preHeight - clip.shift
        expect(clip.hasText).toBe(true)
        // 窗高不得超过剩余内容：旧 bug 的续窗 = preHeight + marginBottom。
        expect(clip.height).toBeLessThanOrEqual(remaining + 2)
        // 也不得把整块内容吞掉（首片必须真的切了一刀）。
        expect(clip.height).toBeGreaterThan(0)
      }
      // 末窗必须贴合剩余内容，不留一整页空白。
      const last = clips.at(-1)
      expect(last).toBeDefined()
      if (last) expect(last.height).toBeGreaterThan(last.preHeight - last.shift - 4)
    } finally {
      await app.close()
    }
  })
})
