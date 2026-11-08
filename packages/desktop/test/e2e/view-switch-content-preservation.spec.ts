import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
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
// 视图切换丢内容回归（用户报告：「视图切换时，内容丢失，最不能接受」）。
//
// 用 test-mds 里的真实讲义做黑盒验证，模拟人类操作：打开文档 → 在 叶视图
// （栏/页/览/映）之间来回切换 → 切「本」源码模式 → 手敲一段增量文字 → 再切
// 一轮视图 → 校验全文逐字节不丢。getMarkdownContent 本身要进/出一次源码
// 模式，所以每次测量同时计一次 文↔本 往返。
//
// 覆盖的真实缺陷（已修）：以 `---` 水平线开头的文档（前导空行挡住 fm()
// 锚定，首次装载是正文），序列化会产出以 `---` 开头的文本——下一次装载
// （切源码/存盘）把直到下一个 `---` 的内容吞成 frontmatter。修复后序列化
// 器把首块 `---` 规则改写成 `***`，重载无歧义。
//
// 文档从 TEST_MDS_DIR（默认仓库外 D:/md-ecosystem/test-mds）复制到系统临时
// 目录再打开——原件不动；目录不存在时整组跳过（CI 环境没有这批私人讲义）。
// ---------------------------------------------------------------------------

const TEST_MDS_DIR = process.env.TEST_MDS_DIR ?? 'D:/md-ecosystem/test-mds'

const DOCS = [
  'Latex.md',
  'ByteFlow.md',
  'DataWareHouse/离线数仓/Hive基础/00-SQL引擎.md',
  'Hadoop/2-0-Hadoop_Env_Setup_Linux_config.md'
]

const EDIT_MARKER = '文览增量测试甲乙丙'

function copyDoc(rel: string): string | null {
  const src = path.join(TEST_MDS_DIR, rel)
  if (!fs.existsSync(src)) return null
  const dst = path.join(os.tmpdir(), 'wenlan-vs-loss', rel.replace(/[\\/]/g, '__'))
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.copyFileSync(src, dst)
  return dst
}

// 叶按钮的可见性随文档形态变（栏只在有 begin 标记时出现），点得到才点。
async function clickLeaf(page: Page, label: string): Promise<boolean> {
  const btn = page.locator('.leaf-btn', { hasText: label }).first()
  if (!(await btn.isVisible().catch(() => false))) return false
  await btn.click()
  return true
}

async function settle(page: Page, ms = 700): Promise<void> {
  await page.waitForTimeout(ms)
}

// 「映」是跨源 iframe 全屏放映：焦点可能落在 iframe 里，父页面收不到 Esc——
// 两个上下文都发一遍；若还在放映态，再点一次「映」按钮切换退出（onLeafClick
// 的 present 是切换语义）。兜底判据：回到 `.editor-component` 可见。
async function exitPresent(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await settle(page, 400)
  for (const frame of page.frames()) {
    if (frame !== page.mainFrame()) {
      await page.keyboard.press('Escape').catch(() => undefined)
      break
    }
  }
  await settle(page, 400)
  const btn = page.locator('.leaf-btn', { hasText: '映' }).first()
  if (await btn.isVisible().catch(() => false)) {
    // 放映态下若刻度仍可见，这个点击是「退出全屏」
    const stillImmersive = await page.evaluate(
      () => !document.querySelector('.editor-component')
        || (document.querySelector('.editor-component') as HTMLElement).offsetParent === null
    )
    if (stillImmersive) await btn.click().catch(() => undefined)
  }
  await settle(page, 500)
}

async function backToEditor(page: Page): Promise<void> {
  const visible = await page.evaluate(() => {
    const el = document.querySelector('.editor-component') as HTMLElement | null
    return !!el && el.offsetParent !== null
  })
  if (!visible) {
    await clickLeaf(page, '文')
    await settle(page)
  }
}

async function leafJourney(page: Page): Promise<string[]> {
  const visited: string[] = []
  for (const leaf of ['栏', '页', '览']) {
    if (await clickLeaf(page, leaf)) {
      visited.push(leaf)
      await settle(page, leaf === '页' ? 1200 : 700)
      await backToEditor(page)
    }
  }
  if (await clickLeaf(page, '映')) {
    visited.push('映')
    await settle(page, 1500)
    await exitPresent(page)
    await backToEditor(page)
    await settle(page)
  }
  return visited
}

test.describe('view switching preserves content (real lecture docs)', () => {
  // 启动 + 两轮叶切换 + 多次源码模式往返（大文档 CodeMirror 全量装载）远超
  // 默认 30s；逐例放宽。
  test.setTimeout(240_000)

  for (const rel of DOCS) {
    test(`no content loss across leaf/source switches + manual edit: ${rel}`, async() => {
      const docPath = copyDoc(rel)
      test.skip(!docPath, `test-mds not available: ${rel}`)
      if (!docPath) return

      const { app, page } = await launchElectron([docPath])
      try {
        await waitForEditor(page)
        await waitForMenuReady(app)
        await page.waitForTimeout(800)

        // 第一次测量（含一次 文↔本 往返）
        const m0 = await getMarkdownContent(page, app)
        expect(m0.length).toBeGreaterThan(0)

        // 叶视图整轮往返后，全文必须逐字节一致
        const visited = await leafJourney(page)
        const m1 = await getMarkdownContent(page, app)
        expect(m1, `leaf journey ${visited.join('→')} mutated the document`).toBe(m0)

        // Latex 类文档（首块是 `---` 规则、原文无 frontmatter）专项：切一轮
        // 之后不得冒出 frontmatter 块
        if (rel === 'Latex.md') {
          const frontmatterCount = await page.evaluate(
            () => document.querySelectorAll('.mu-frontmatter').length
          )
          expect(frontmatterCount, 'leading --- rule was eaten into front matter').toBe(0)
        }

        // 模拟人类编辑：点进第一个段落敲一段字，然后 View↔Source 再切一轮叶
        await page.locator('.mu-paragraph-content').first().click()
        await page.keyboard.type(EDIT_MARKER, { delay: 20 })
        await settle(page, 400)

        const m2 = await getMarkdownContent(page, app)
        expect(m2).toContain(EDIT_MARKER)

        await leafJourney(page)
        const m3 = await getMarkdownContent(page, app)
        expect(m3, 'the manual edit did not survive the second view journey').toBe(m2)

        await expectNoRendererErrors(app)
      }
      finally {
        await app.close()
      }
    })
  }
})
