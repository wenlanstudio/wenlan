import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// 版式基是纯 CSS 契约：以文本断言钉住值。M1 的"同源"策略 = 值取打印链默认
// （github-markdown-css@5.9 + exportStyle.css 字体栈 + @page 20/15mm），打印侧
// 零改动；任何一侧升级导致的漂移，由 M2 的"屏显页数 = printToPDF 页数" e2e
// 验收兜底（视图模型 §5）。（vitest 默认 stub 掉 css 模块，?raw 拿不到内容，
// 故按仓库惯例直接读文件。）
const __dirname = dirname(fileURLToPath(import.meta.url))
const paperLens = readFileSync(
  resolve(__dirname, '../../../src/renderer/src/assets/styles/paperLens.css'),
  'utf-8'
)

describe('paper lens basis mirrors the print chain (view-model §5 / M1)', () => {
  it('pins the A4 geometry and @page-consistent margins', () => {
    expect(paperLens).toContain('--paper-page-width: 210mm')
    expect(paperLens).toContain('--paper-page-height: 297mm')
    expect(paperLens).toContain('--paper-margin-top: 20mm')
    expect(paperLens).toContain('--paper-margin-x: 15mm')
    // 内容宽 210−15×2 = 180mm，与打印 @page 内容盒一致（注释即契约）
    expect(paperLens).toContain('210−15×2 = 180mm')
  })

  it('pins the body metrics to the print chain defaults (gh-css 16px/1.5)', () => {
    expect(paperLens).toContain('--paper-font-size: 16px')
    expect(paperLens).toContain('--paper-line-height: 1.5')
  })

  it('overrides the muya inline appearance vars with !important', () => {
    // --mu-* 是 muya 根上的内联 setProperty，非 !important 压不过 applyAppearance
    expect(paperLens).toContain('--mu-font-size: var(--paper-font-size) !important')
    expect(paperLens).toContain('--mu-line-height: var(--paper-line-height) !important')
    expect(paperLens).toContain('--mu-font-family')
    expect(paperLens).toContain("ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas")
  })

  it('makes the A4 card of the muya container (both live lens and projection)', () => {
    expect(paperLens).toContain("[data-lens='page'] .mu-container")
    expect(paperLens).toContain('.paper-projection .mu-container')
    expect(paperLens).toContain('width: var(--paper-page-width) !important')
    expect(paperLens).toContain('min-height: var(--paper-page-height) !important')
  })

  it('keeps the layout basis spare-free (the logical-page leaf is gone)', () => {
    // 旧逻辑页叶（spare）已整体移除：版式基不得再给它留选择器分支。
    expect(paperLens).not.toContain("data-lens='spare'")
  })

  it('mirrors github-markdown-css block metrics (the pagination drivers)', () => {
    expect(paperLens).toContain('margin: 0 0 10px') // p
    expect(paperLens).toContain('margin: 1.5rem 0 1rem') // h1–h6
    expect(paperLens).toContain('line-height: 1.25')
    expect(paperLens).toContain('font-size: 2em') // h1
    expect(paperLens).toContain('padding-left: 2em') // ul/ol
    expect(paperLens).toContain('margin: 0 0 1rem') // ul/ol/dl/table/pre 组
    expect(paperLens).toContain('padding: 1rem') // pre
    expect(paperLens).toContain('line-height: 1.45') // pre 行高独立
    expect(paperLens).toContain('border-left: 0.25em solid') // blockquote
    expect(paperLens).toContain('height: 0.25em') // hr
  })
})
