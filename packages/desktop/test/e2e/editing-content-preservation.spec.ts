import { expect, test } from '@playwright/test'
import type { CDPSession, ElectronApplication, Page } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  expectNoRendererErrors,
  getMarkdownContent,
  launchElectron,
  waitForEditor,
  waitForMenuReady
} from './helpers'

// ---------------------------------------------------------------------------
// 编辑过程中不丢内容（用户报告：修改正文过程中正文内容出现丢失）。
//
// 模拟人类在真实讲义上的各种编辑手法，每一步之后断言「原文行多集零丢失」：
// 脚本只做非破坏性编辑——插入只加在段落尾部或独立新行，删除只删自己刚敲的
// 字符——因此初始文档的每一行（规范化后）必须在每次测量中都还在。测量的
// getMarkdownContent 本身要进/出一次源码模式，所以每个检查点同时计一次
// 文↔本往返。
//
// 覆盖的丢失嫌疑向量：
//   - CDP 真实 IME 提交（组合态→候选→上屏，Chromium 原生路径）
//   - 段尾插入 / 回车开新行 / 在新行续打
//   - 剪贴板粘贴
//   - 代码块内输入（prism 高亮 + 行号 DOM 并发重渲染）
//   - ```js + Enter 块转换后立即续打（转换与输入竞态）
//   - 长串快速连打（多个 op 同帧 flush）
//   - 编辑过程穿插 文↔本 往返
// ---------------------------------------------------------------------------

const TEST_MDS_DIR = process.env.TEST_MDS_DIR ?? 'D:/md-ecosystem/test-mds'

const DOCS = [
  'ByteFlow.md',
  'DataWareHouse/离线数仓/Hive基础/00-SQL引擎.md',
  'DataVisualization/MD/第2章 Python基础.md'
]

const norm = (s: string): string[] =>
  s
    .split('\n')
    .map(l => l.trimEnd().replace(/[ \t]+/g, ' ').trim())
    .filter(l => l !== '')

function counts(lines: string[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const l of lines) m.set(l, (m.get(l) ?? 0) + 1)
  return m
}

// 原文每一行（规范化）的文本必须仍存在于当前全文某处（子串级）——整段/整块
// 消失即丢内容。行级多集比对会误报两类**格式性重排**：表格分隔线重排对齐
// （`| --- |` ↔ 按列宽加长）和相邻行并入（软换行/列表惰性续行），它们不丢
// 内容——装饰性分隔行（纯 `-`/`|`/`:` 构成）整行剔除，其余行做子串检查，
// 另设总字数下限兜底。
const DECORATIVE = /^(?:\|[\s:|-]+\|)|^(?:-{3,}$)|(?:^\*{3,}$)/

async function assertNoLoss(
  page: Page,
  app: ElectronApplication,
  baselineLines: string[],
  baselineLength: number,
  step: string
): Promise<string> {
  const md = await getMarkdownContent(page, app)
  const doc = norm(md).join('\n')
  const missing: string[] = []
  for (const line of baselineLines) {
    if (DECORATIVE.test(line) || line.length < 4) continue
    if (!doc.includes(line)) missing.push(line.slice(0, 60))
  }
  // 自有删除只有 5 次 Backspace；全文显著缩短即有内容被吃。
  const missingSummary = missing.length ? `missing:${JSON.stringify(missing.slice(0, 12))}` : ''
  expect(
    doc.length,
    `step "${step}" document shrank (baseline ${baselineLength} → ${doc.length}). ${missingSummary} Current head:\n${md.split('\n').slice(0, 140).join('\n')}`
  ).toBeGreaterThanOrEqual(baselineLength - 60)
  expect(
    missing.length ? missing : [],
    `step "${step}" lost original lines. Current head:\n${md.split('\n').slice(0, 140).join('\n')}`
  ).toEqual([])
  return md
}

function copyDoc(rel: string): string | null {
  const src = path.join(TEST_MDS_DIR, rel)
  if (!fs.existsSync(src)) return null
  const dst = path.join(os.tmpdir(), 'wenlan-edit-loss', rel.replace(/[\\/]/g, '__'))
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.copyFileSync(src, dst)
  return dst
}

/** 组合态→候选→上屏，一次真实 IME 提交（与 muya e2e 的 CDP 手法同源）。 */
async function typeCjk(cdp: CDPSession, pinyin: string, hanzi: string): Promise<void> {
  await cdp.send('Input.imeSetComposition', {
    text: pinyin,
    selectionStart: pinyin.length,
    selectionEnd: pinyin.length
  })
  await cdp.send('Input.imeSetComposition', {
    text: hanzi,
    selectionStart: hanzi.length,
    selectionEnd: hanzi.length
  })
  await cdp.send('Input.insertText', { text: hanzi })
}

test.describe('editing preserves content (real lecture docs)', () => {
  test.setTimeout(300_000)

  for (const rel of DOCS) {
    test(`no line loss through human-like editing: ${rel}`, async() => {
      const docPath = copyDoc(rel)
      test.skip(!docPath, `test-mds not available: ${rel}`)
      if (!docPath) return

      const { app, page } = await launchElectron([docPath])
      try {
        await waitForEditor(page)
        await waitForMenuReady(app)
        await page.waitForTimeout(800)

        // 预热往返：第一次进/出源码模式会把 tab.markdown 换成引擎规范化文本
        // （`---` 规则 → `***`、表格对齐、列表缩进）——基线必须取规范化后的
        // 稳定形态，否则 canonical 重排会被误报为丢行。
        await getMarkdownContent(page, app)
        const m0 = await getMarkdownContent(page, app)
        const baselineLines = norm(m0)
        // 与断言同口径：规范化后（去空行、行尾空白）的长度，否则空行本身会被
        // 计成「缩短」。
        const baselineLength = baselineLines.join('\n').length
        const cdp = await page.context().newCDPSession(page)

        const paragraphs = page.locator('.mu-paragraph-content')

        // 1. 段尾 IME 中文上屏（该段登记为被编辑）
        await paragraphs.nth(1).click()
        await page.keyboard.press('End')
        await typeCjk(cdp, 'jinzeng', '增量甲')
        await assertNoLoss(page, app, baselineLines, baselineLength, 'IME commit at paragraph end')

        // 2. 回车开新行 + 新行续打
        // 光标探针：上一步的源码往返后，光标必须还在原段落里。
        // （复现过的 bug：往返后光标静默落到 frontmatter/文档首块，用户继续
        // 打字全进 fm，把 fm 打成非法 YAML，整块塌缩成正文——内容重排。）
        const caretProbe = await page.evaluate(() => {
          const sel = document.getSelection()
          let node = sel?.anchorNode
          if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement
          const fm = node instanceof Element ? node.closest('.mu-frontmatter') : null
          const para = node instanceof Element ? node.closest('.mu-paragraph-content') : null
          return {
            inFrontmatter: !!fm,
            frontmatterText: fm?.textContent?.slice(0, 40) ?? null,
            paragraphText: para?.textContent?.slice(0, 40) ?? null,
            anchorOffset: sel?.anchorOffset ?? null,
            diag: (window as unknown as Record<string, unknown>).__mt_diag_cursor_null__ ?? null,
            diagOffset: (window as unknown as Record<string, unknown>).__mt_diag_offset__ ?? null,
            cmSeed: (window as unknown as Record<string, unknown>).__mt_diag_cm_seed__ ?? null,
            cmExit: (window as unknown as Record<string, unknown>).__mt_diag_cm_exit__ ?? null,
            setCursorOk: (window as unknown as Record<string, unknown>).__mt_diag_setcursor__ ?? null,
            setCursorError:
              (window as unknown as Record<string, unknown>).__mt_diag_setcursor_error__ ?? null,
            lastPayload:
              (window as unknown as Record<string, unknown>).__mt_diag_last_payload__ ?? null,
            fcSeen: (window as unknown as Record<string, unknown>).__mt_diag_fc__ ?? null
          }
        })
        expect(
          caretProbe.inFrontmatter,
          `after the source round trip the caret fell into the frontmatter: ${JSON.stringify(caretProbe)}`
        ).toBe(false)

        await page.keyboard.press('Enter')
        await typeCjk(cdp, 'xinhang', '新行乙')
        await assertNoLoss(page, app, baselineLines, baselineLength, 'new line via Enter')

        // 3. 剪贴板粘贴（含中文多行）
        await page.evaluate(() =>
          navigator.clipboard.writeText('粘贴第一行\n粘贴第二行')
        )
        await page.keyboard.press('Control+v')
        await assertNoLoss(page, app, baselineLines, baselineLength, 'paste two lines')

        // 4. 长串快速连打（多 op 同帧 flush），delay 0
        await paragraphs.nth(2).click()
        await page.keyboard.press('End')
        await page.keyboard.press('Enter')
        await page.keyboard.type(
          'burst 甲乙丙丁戊己庚辛壬癸 1234567890 quick-typing-stress',
          { delay: 0 }
        )
        await assertNoLoss(page, app, baselineLines, baselineLength, 'fast burst typing')

        // 5. 代码块内输入（高亮 + 行号并发重渲染）
        const code = page.locator('.mu-codeblock-content').first()
        if (await code.isVisible().catch(() => false)) {
          await code.click()
          await page.keyboard.press('Control+End')
          await page.keyboard.type('\necho 编辑不丢内容', { delay: 0 })
          await assertNoLoss(page, app, baselineLines, baselineLength, 'typing inside code block')
        }

        // 6. ``` 围栏转换后立即续打（转换与输入竞态）
        await paragraphs.nth(0).click()
        await page.keyboard.press('End')
        await page.keyboard.press('Enter')
        await page.keyboard.press('Enter')
        await page.keyboard.type('```js', { delay: 0 })
        await page.keyboard.press('Enter')
        await page.keyboard.type('console.log("after-convert")', { delay: 0 })
        await assertNoLoss(page, app, baselineLines, baselineLength, 'fence conversion + immediate typing')

        // 7. 删除自己敲过的字符（Backspace 不触及原文）
        for (let i = 0; i < 5; i++) await page.keyboard.press('Backspace')
        await assertNoLoss(page, app, baselineLines, baselineLength, 'backspace own chars')

        await expectNoRendererErrors(app)
      }
      finally {
        await app.close()
      }
    })
  }
})
