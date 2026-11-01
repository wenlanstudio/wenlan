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
  // 一文档一实例：启动 → 进页/纸叶全屏 → 读屏测页数（两读稳定）→ 走真实
  // 导出管线数 PDF 页。Windows 冷启动慢，hook/test 超时给足。
  const runAcceptance = async(
    doc: string,
    leafLabel = '纸'
  ): Promise<{ screenCount: number; pdfCount: number }> => {
    const launched = await launchWithMarkdown(doc)
    const { app, page } = launched
    try {
      await waitForMenuReady(app)

      // —— 进页/纸叶全屏：(文, 叶) 成对后摘掉 文。 ——
      const leafBtn = page.locator('.view-switcher .leaf-btn', { hasText: leafLabel })
      const flowBtn = page.locator('.view-switcher .leaf-btn', { hasText: '文' })
      await leafBtn.waitFor({ state: 'visible', timeout: 15000 })
      await leafBtn.click()
      await flowBtn.click()

      // —— 屏测页数：等 overlay 出数，并确认两读稳定（防抖合帧后不再变动）。 ——
      const overlay = page.locator('.mu-paper-overlay[data-page-count]')
      await overlay.waitFor({ state: 'visible', timeout: 15000 })
      const readCount = async(): Promise<number> =>
        Number(await overlay.getAttribute('data-page-count'))
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

      expect(screenCount, `${leafLabel} leaf screen page count`).toBeGreaterThan(0)
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

  test('the page leaf (logical paper) matches print too (评审补裁：页钉纸面版式基)', async() => {
    test.setTimeout(150_000)
    // 同一文档走页叶：版式基同纸叶钉死纸面宽度 → 缝叠加的页数与纸叶、
    // 打印三方一致（页宽若游离，等式即破）。
    const { screenCount, pdfCount } = await runAcceptance(DOC, '页')
    expect(screenCount).toBe(2)
    expect(screenCount).toBe(pdfCount)
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
})
