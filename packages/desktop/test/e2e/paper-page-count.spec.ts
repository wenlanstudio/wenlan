import { expect, test } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { inflateRawSync, inflateSync } from 'node:zlib'
import { launchWithMarkdown, waitForMenuReady, sendIpcToRenderer } from './helpers'

// 页/纸叶硬验收（view-model §5 / M2 + §5 评审补裁）：屏显分页数 = printToPDF
// 页数，对页/纸两叶同时成立（两叶同钉纸面版式基，推挤不改块高）。
//
// 同源链条：屏测（util/paperPagination keep-together 贪心，A4 内容高 257mm、
// 视觉 px）↔ 打印（@page 20/15mm + .markdown-body>*{break-inside:avoid}，
// Chromium fragmentainer 等效贪心）。文档 40 个单行段落：按 34px/段、内容高
// 972px 计，首页 28 段、次页 12 段——两页的填充都离页界足够远，字体度量
// ±10% 漂移不会改变页数，验收只对"机制同源"敏感。
//
// 打印边距完全来自 CSS @page（getPdfPageOptions 不向 printToPDF 传 margins，
// file.ts），与屏显的容器 padding 同值——这是页数可比的前提。

const PARA = (n: number): string =>
  `Paragraph ${String(n).padStart(2, '0')} of the paper pagination acceptance document.`
const DOC = Array.from({ length: 40 }, (_, i) => PARA(i + 1)).join('\n\n')

// —— 与 export-pdf.spec 相同的主进程保存对话框桩（导出车道唯一非无头接缝）——
const stubSaveDialog = async(app: ElectronApplication, targetPath: string): Promise<void> => {
  await app.evaluate(async({ dialog }, savePath) => {
    const g = global as unknown as {
      __mt_orig_showSaveDialog__?: typeof dialog.showSaveDialog
    }
    if (!g.__mt_orig_showSaveDialog__) {
      g.__mt_orig_showSaveDialog__ = dialog.showSaveDialog.bind(dialog)
    }
    ;(dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = async() => ({
      canceled: false,
      filePath: savePath
    })
  }, targetPath)
}

const restoreSaveDialog = async(app: ElectronApplication): Promise<void> => {
  await app.evaluate(({ dialog }) => {
    const g = global as unknown as {
      __mt_orig_showSaveDialog__?: typeof dialog.showSaveDialog
    }
    if (g.__mt_orig_showSaveDialog__) {
      ;(dialog as unknown as { showSaveDialog: unknown }).showSaveDialog =
        g.__mt_orig_showSaveDialog__
    }
  })
}

const pollForPdfFile = async(filePath: string, timeoutMs = 20000): Promise<Buffer> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath)
      if (data.length > 0) return data
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`PDF file was not written within ${timeoutMs}ms: ${filePath}`)
}

// Chromium printToPDF 的页对象以 /Type /Page 落盘，但可能压在 FlateDecode
// 对象流里（/Type /Pages 是页树，排除）——解压每段 stream..endstream 后一并
// 计数。
const tryInflate = (buf: Buffer): Buffer => {
  for (const inflate of [inflateSync, inflateRawSync]) {
    try {
      return inflate(buf)
    } catch {
      // 不是 deflate 流（图片/字体等），跳过。
    }
  }
  return Buffer.alloc(0)
}

const countPdfPages = (data: Buffer): number => {
  const texts: string[] = [data.toString('latin1')]
  const raw = texts[0]
  const re = /stream\r?\n/g
  let m: RegExpExecArray | null
  let streams = 0
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length
    const end = raw.indexOf('endstream', start)
    if (end < 0) break
    streams++
    texts.push(tryInflate(data.subarray(start, end)).toString('latin1'))
  }
  const count = (texts.join('').match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length
  if (count === 0) {
    const head = raw.slice(0, 160).replace(/[^\x20-\x7e\n]/g, '.')
    throw new Error(
      `No /Type /Page objects found (${streams} streams scanned, ${data.length} bytes). Head: ${head}`
    )
  }
  return count
}

test.describe('page/paper leaf hard acceptance: screen pages == printToPDF pages', () => {
  // 一文档一实例：启动 → 进「页」叶全屏 → 读屏测页数（两读稳定）→ 走真实
  // 导出管线数 PDF 页。Windows 冷启动慢，hook/test 超时给足。
  // 2026-11-05 刻度裁决：原「纸」（物理纸/真分片）改称「页」，原「页」
  // （逻辑页/活引擎缝）改称「备」并隐藏。因此可见页叶的计数一律在
  // .mu-paper-deck 上；.mu-paper-overlay 只属于已隐藏的「备」叶。
  const runAcceptance = async(
    doc: string
  ): Promise<{ screenCount: number; pdfCount: number }> => {
    const launched = await launchWithMarkdown(doc)
    const { app, page } = launched
    try {
      await waitForMenuReady(app)

      // —— 进「页」叶全屏：(文, 叶) 成对后摘掉 文。 ——
      const leafBtn = page.locator('.view-switcher .leaf-btn', { hasText: '页' })
      const flowBtn = page.locator('.view-switcher .leaf-btn', { hasText: '文' })
      await leafBtn.waitFor({ state: 'visible', timeout: 15000 })
      await leafBtn.click()
      await flowBtn.click()

      // —— 屏测页数：等 deck 出数，并确认两读稳定（防抖合帧后不再变动）。 ——
      const counter = page.locator('.mu-paper-deck[data-page-count]')
      await counter.waitFor({ state: 'visible', timeout: 15000 })
      const readCount = async(): Promise<number> =>
        Number(await counter.getAttribute('data-page-count'))
      const first = await readCount()
      await page.waitForTimeout(700)
      const screenCount = await readCount()
      expect(screenCount, 'overlay page count should settle').toBe(first)

      // —— 打印页数：真实导出管线（对话框默认 A4 + 20/15mm 边距）。 ——
      const outPath = path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), 'mt-paper-acceptance-')),
        'acceptance.pdf'
      )
      await stubSaveDialog(app, outPath)
      await sendIpcToRenderer(app, 'mt::show-export-dialog', 'pdf')
      const confirm = page.locator('.print-settings-dialog .button-primary')
      await confirm.waitFor({ state: 'visible', timeout: 10000 })
      await confirm.click()
      const pdf = await pollForPdfFile(outPath)
      const pdfCount = countPdfPages(pdf)

      expect(screenCount, 'page leaf screen page count').toBeGreaterThan(0)
      expect(pdfCount, 'printToPDF page count').toBeGreaterThan(0)
      return { screenCount, pdfCount }
    } finally {
      await restoreSaveDialog(app)
      await app.close()
    }
  }

  test('screen page count equals the exported PDF page count', async() => {
    test.setTimeout(150_000)
    const { screenCount, pdfCount } = await runAcceptance(DOC)
    // 文档设计钉死 2 页：填充远离页界，页数只对"机制同源"敏感。
    expect(screenCount).toBe(2)
    expect(screenCount).toBe(pdfCount)
  })

  test('the retired logical-page leaf stays hidden (刻度裁决：旧「页」→「备」隐藏)', async() => {
    // 旧「页」叶（活引擎缝叠加 / .mu-paper-overlay）已改名「备」并隐藏，
    // 刻度裁决后用户只见「文 [栏] 页 览 示」。这里守住「不再出现第二套
    // 页计数」这一语义，避免旧 data-lens 分支被误重新接上。
    const { app, page } = await launchWithMarkdown(DOC)
    try {
      await waitForMenuReady(app)
      const labels = (await page.locator('.view-switcher .leaf-btn').allInnerTexts()).map(s =>
        s.trim()
      )
      expect(labels).not.toContain('备')
      expect(labels).not.toContain('纸')
      expect(labels).toContain('页')
      expect(await page.locator('.mu-paper-overlay').count()).toBe(0)
    } finally {
      await app.close()
    }
  })

  test('an oversized paragraph fragments at line boundaries on screen and in print alike (v2 行级切分判别)', async() => {
    test.setTimeout(150_000)
    // 高过两整页的段落：块级 keep-together 时代它只能穿缝（v1 语义），
    // v2 行级拟合必须产出**行界切分缝**（data-split="lines"，判别器——
    // v1 穿缝没有 data-split）；屏测页数与 printToPDF 页数（块级 avoid 已
    // 撤，Chromium 原生按行切分）逐条等价。
    const bigPara = Array.from(
      { length: 60 },
      (_, i) =>
        `Line ${String(i + 1).padStart(2, '0')} of the oversized paragraph for the line-level fragmentation acceptance.`
    ).join('\n')
    const splitDoc = [
      ...Array.from({ length: 28 }, (_, i) => PARA(i + 1)),
      bigPara,
      ...Array.from({ length: 5 }, (_, i) => PARA(i + 29))
    ].join('\n\n')

    const launched = await launchWithMarkdown(splitDoc)
    const { app, page } = launched
    try {
      await waitForMenuReady(app)
      const leafBtn = page.locator('.view-switcher .leaf-btn', { hasText: '页' })
      const flowBtn = page.locator('.view-switcher .leaf-btn', { hasText: '文' })
      await leafBtn.waitFor({ state: 'visible', timeout: 15000 })
      await leafBtn.click()
      await flowBtn.click()

      const deck = page.locator('.mu-paper-deck[data-page-count]')
      await deck.waitFor({ state: 'visible', timeout: 15000 })
      await page.waitForTimeout(700)
      const screenCount = Number(await deck.getAttribute('data-page-count'))

      // 判别器：真分片投影把内容结构性搬进页卡，卡片数与屏显页数严格一致
      // （旧逻辑页的 .mu-paper-seam[data-split] 随「备」叶一起隐藏）。
      const cardCount = await page.locator('.mu-paper-page').count()
      expect(cardCount, 'true-fragment page cards should match the page count').toBe(screenCount)

      const outPath = path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), 'mt-paper-split-')),
        'acceptance.pdf'
      )
      await stubSaveDialog(app, outPath)
      await sendIpcToRenderer(app, 'mt::show-export-dialog', 'pdf')
      const confirm = page.locator('.print-settings-dialog .button-primary')
      await confirm.waitFor({ state: 'visible', timeout: 10000 })
      await confirm.click()
      const pdf = await pollForPdfFile(outPath)
      const pdfCount = countPdfPages(pdf)

      expect(screenCount, 'v2 fit page count').toBeGreaterThan(2)
      expect(screenCount, 'screen pages == printToPDF pages (line-level both sides)').toBe(pdfCount)
    } finally {
      await restoreSaveDialog(app)
      await app.close()
    }
  })

  test('a pagebreak marker forces the same page on screen and in print', async() => {
    test.setTimeout(150_000)
    // 10 段 + 分页符 + 10 段 + 分页符 + 30 段：强制缝把文档切成 4 页
    // （尾组 30 段自然分 28+2，均远离页界）。
    const pagebreakDoc = [
      ...Array.from({ length: 10 }, (_, i) => PARA(i + 1)),
      '<!-- pagebreak -->',
      ...Array.from({ length: 10 }, (_, i) => PARA(i + 11)),
      '<!-- pagebreak -->',
      ...Array.from({ length: 30 }, (_, i) => PARA(i + 21))
    ].join('\n\n')
    const { screenCount, pdfCount } = await runAcceptance(pagebreakDoc)
    expect(screenCount).toBe(4)
    expect(screenCount).toBe(pdfCount)
  })

  test('frontmatter paper: letter drives screen and print alike', async() => {
    test.setTimeout(150_000)
    // 55 段 + paper: letter：letter 内容高 ~905px → 26 段/页 = 3 页；若打印
    // 侧没跟上 letter（误用 A4 默认 972px → 28 段/页 = 2 页），等式即破。
    const letterDoc =
      '---\npaper: letter\n---\n\n' +
      Array.from({ length: 55 }, (_, i) => PARA(i + 1)).join('\n\n')
    const { screenCount, pdfCount } = await runAcceptance(letterDoc)
    expect(screenCount).toBe(3)
    expect(screenCount).toBe(pdfCount)
  })

  test('an empty document renders a single blank A4 card (空文档白屏回归)', async() => {
    test.setTimeout(150_000)
    // 空文档（新文件 / 加载失败的 tab）：纸叶不得整屏空白——必须照常出
    // 一张空白 A4 卡（Word 空白页语义）。
    const launched = await launchWithMarkdown('')
    const { app, page } = launched
    try {
      await waitForMenuReady(app)
      const leafBtn = page.locator('.view-switcher .leaf-btn', { hasText: '页' })
      const flowBtn = page.locator('.view-switcher .leaf-btn', { hasText: '文' })
      await leafBtn.waitFor({ state: 'visible', timeout: 15000 })
      await leafBtn.click()
      await flowBtn.click()

      const deck = page.locator('.mu-paper-deck[data-page-count]')
      await deck.waitFor({ state: 'visible', timeout: 15000 })
      await page.waitForTimeout(700)
      expect(Number(await deck.getAttribute('data-page-count'))).toBe(1)
      const cardCount = await page.locator('.mu-paper-page').count()
      expect(cardCount, 'one blank A4 card for the empty document').toBe(1)
    } finally {
      await app.close()
    }
  })

  test('paper projection renders page cards that match the fit and the print (真分片卡片)', async() => {
    test.setTimeout(150_000)
    const launched = await launchWithMarkdown(DOC)
    const { app, page } = launched
    try {
      await waitForMenuReady(app)
      const leafBtn = page.locator('.view-switcher .leaf-btn', { hasText: '页' })
      const flowBtn = page.locator('.view-switcher .leaf-btn', { hasText: '文' })
      await leafBtn.waitFor({ state: 'visible', timeout: 15000 })
      await leafBtn.click()
      await flowBtn.click()

      const deck = page.locator('.mu-paper-deck[data-page-count]')
      await deck.waitFor({ state: 'visible', timeout: 15000 })
      // 等分片重建（setContent → 双 rAF → 量测 → 换装）+ 防抖稳定。
      await page.waitForTimeout(700)
      const pageCount = Number(await deck.getAttribute('data-page-count'))
      expect(pageCount).toBe(2)

      // 页卡几何：min-height = 纸高（297mm·zoom），常流堆叠 + 8mm 灰隙；
      // 每卡首个内容子块顶 = 卡内容顶（卡 padding 20mm，徽章除外）——
      // 分片是结构性搬移，对齐由构造保证。
      const geo = await page.evaluate(() => {
        const MM = 96 / 25.4
        const cards = [...document.querySelectorAll('.mu-paper-page')] as HTMLElement[]
        const tops = cards.map(c => c.getBoundingClientRect().top)
        const heights = cards.map(c => c.getBoundingClientRect().height)
        const firstChildTop = cards.map(c => {
          const kid = [...c.children].find(el => !el.classList.contains('mu-paper-page-num'))
          return kid ? kid.getBoundingClientRect().top : -1
        })
        const view = document.querySelector('.paper-projection-view') as HTMLElement
        const viewRect = view.getBoundingClientRect()
        const viewContentTop = viewRect.top + Number.parseFloat(getComputedStyle(view).paddingTop)
        // 隐藏量测宿主（muya 根 = .mu-editor）必须脱离文档流：它整张 A4 的
        // 高度若在流内，会把纸卡整体顶下去 = 纸视图上方一大片空白。
        const host = document.querySelector('.paper-projection-muya') as HTMLElement
        return {
          tops,
          heights,
          firstChildTop,
          pageHeightPx: 297 * MM,
          viewContentTop,
          hostPosition: getComputedStyle(host).position
        }
      })
      // 纸卡顶 = 滚动区内容顶（宿主脱流回归断言）：宿主 position 必须为
      // absolute，纸卡上方不许有整页高度的空白。
      expect(geo.hostPosition).toBe('absolute')
      expect(
        Math.abs(geo.tops[0]! - geo.viewContentTop),
        'deck must start at the scroll view content top (no hidden-host blank above)'
      ).toBeLessThan(2)
      expect(geo.tops).toHaveLength(pageCount)
      expect(Math.abs(geo.tops[1]! - geo.tops[0]! - (geo.heights[0]! + 8 * (96 / 25.4)))).toBeLessThan(2)
      expect(Math.abs(geo.heights[0]! - geo.pageHeightPx)).toBeLessThan(2)
      // 卡内容顶 = 卡顶 + 20mm 上边距；首子块结构性地贴在那里。
      const contentTop0 = geo.tops[0]! + 20 * (96 / 25.4)
      expect(Math.abs(geo.firstChildTop[0]! - contentTop0)).toBeLessThan(2)
    } finally {
      await app.close()
    }
  })
})
