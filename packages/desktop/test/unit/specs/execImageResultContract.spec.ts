import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 执行面板图形结果（#22，Jupyter inline/auto 同款）的源码契约守卫。
 *
 * 组件挂载需要完整的 mdcode2run IPC/会话环境，收益配不上脚手架成本；这里钉
 * 三条最易在重构中丢失的接线（文本断言，与 layoutHeightContract 同风格）：
 *   ① execPanel 输出区渲染选中块的 images（inline 面，表格/原文两分支之外）；
 *   ② 点击内嵌图走 bus（execPanel 摸不到 editor 层的 MediaViewer 实例）；
 *   ③ editor 层订阅该事件并打开 MediaViewer（auto 面）+ 卸载清理。
 */
const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string): string =>
  readFileSync(resolve(here, '../../../src/renderer/src', rel), 'utf-8')

describe('#22 图形结果契约（inline 渲染 + bus 弹大图）', () => {
  it('execPanel 输出区 inline 渲染选中块的 images 并经 bus 转发', () => {
    const src = read('components/editorWithTabs/execPanel.vue')
    // inline：结果卡的 images 数据源与渲染循环
    expect(src).toContain('resultOf(selectedLine.value)?.images ?? []')
    expect(src).toMatch(/class="output-images"/)
    expect(src).toMatch(/class="output-image"/)
    // auto：点击转发走 bus（面板侧无 MediaViewer 实例可直达）
    expect(src).toContain("bus.emit('exec-image-preview', src)")
  })

  it('editor 层订阅 exec-image-preview 打开 MediaViewer，且卸载时解绑', () => {
    const src = read('components/editorWithTabs/editor.vue')
    expect(src).toContain("bus.on('exec-image-preview', handleExecImagePreview)")
    expect(src).toContain("bus.off('exec-image-preview', handleExecImagePreview)")
    expect(src).toMatch(/handleExecImagePreview[\s\S]{0,200}mediaViewer\.value\?\.openImage\(data\)/)
  })
})
