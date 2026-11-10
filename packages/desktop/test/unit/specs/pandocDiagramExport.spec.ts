import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderDiagramCodeToPngDataUrl, type DiagramThemes } from '@/util/diagramExport'
import { scanDiagramFences, substituteDiagramFences } from '@/util/pandocDiagramExport'

vi.mock('@/util/diagramExport', () => ({
  renderDiagramCodeToPngDataUrl: vi.fn()
}))

const render = vi.mocked(renderDiagramCodeToPngDataUrl)

const THEMES: DiagramThemes = {
  mermaidTheme: 'default',
  vegaTheme: 'latimes',
  plantumlServer: 'https://plantuml.example',
  sequenceTheme: 'hand',
  drawioServer: 'https://draw.example'
}

const IMAGE = 'data:image/png;base64,AAAA'

const matplotlibDoc = [
  '# 报告',
  '',
  '```matplotlib',
  'plt.plot([1, 2], [3, 4])',
  '```',
  '',
  '结尾'
].join('\n')

describe('scanDiagramFences', () => {
  it('finds a fence and reports its exact code body', () => {
    const fences = scanDiagramFences(matplotlibDoc)

    expect(fences).toHaveLength(1)
    expect(fences[0]).toMatchObject({ lang: 'matplotlib', code: 'plt.plot([1, 2], [3, 4])' })
    // The range spans the fence lines themselves, not just the body.
    expect(matplotlibDoc.slice(fences[0]!.start, fences[0]!.end)).toBe(
      '```matplotlib\nplt.plot([1, 2], [3, 4])\n```'
    )
  })

  it('reads the language from an unspaced info string', () => {
    const fences = scanDiagramFences('```matplotlib\nx = 1\n```')
    expect(fences[0]).toMatchObject({ lang: 'matplotlib' })
  })

  it('keeps backtick lines inside a tilde fence as content', () => {
    const source = '~~~mermaid\ngraph TD\n```\nA-->B\n~~~'
    const fences = scanDiagramFences(source)

    expect(fences).toHaveLength(1)
    expect(fences[0]).toMatchObject({ lang: 'mermaid', code: 'graph TD\n```\nA-->B' })
  })

  it('treats a backtick info string as paragraph text, not a fence', () => {
    const source = '```foo `bar`\ntext\n```'
    const fences = scanDiagramFences(source)
    // The first line is paragraph text (its info carries a backtick); the
    // standalone ``` line still opens a fence, which never closes.
    expect(fences).toHaveLength(1)
    expect(fences[0]).toMatchObject({ lang: '', code: '' })
  })

  it('treats an unterminated fence as code to the end of the document', () => {
    const source = '# T\n\n```echarts\n{"x": 1}'
    const fences = scanDiagramFences(source)

    expect(fences).toHaveLength(1)
    expect(fences[0]).toMatchObject({ lang: 'echarts', code: '{"x": 1}' })
    expect(fences[0]!.end).toBe(source.length)
  })

  it('reads indented (up to three spaces) fences and keeps deeper ones out', () => {
    expect(scanDiagramFences('   ```mermaid\nA-->B\n   ```')[0]).toMatchObject({ lang: 'mermaid' })
    // Four spaces is an indented code block, not a fence.
    expect(scanDiagramFences('    ```mermaid\nA-->B\n    ```')).toHaveLength(0)
  })
})

describe('substituteDiagramFences', () => {
  beforeEach(() => {
    render.mockReset()
  })

  it('swaps a rendered fence for its image and keeps every other byte', () => {
    render.mockResolvedValue(IMAGE)

    return expect(substituteDiagramFences(matplotlibDoc, THEMES)).resolves.toBe(
      ['# 报告', '', `![](${IMAGE})`, '', '结尾'].join('\n')
    )
  })

  it('leaves the document alone when the diagram fails to render', () => {
    render.mockRejectedValue(new Error('no python'))

    return expect(substituteDiagramFences(matplotlibDoc, THEMES)).resolves.toBe(matplotlibDoc)
  })

  it('replaces only the fences that rendered', async() => {
    render.mockImplementation(async(type) => {
      if (type === 'matplotlib') return IMAGE
      throw new Error('no server')
    })
    const source = [
      '```matplotlib',
      'plt.plot([1])',
      '```',
      '',
      '```plantuml',
      'A -> B',
      '```'
    ].join('\n')

    await expect(substituteDiagramFences(source, THEMES)).resolves.toBe(
      [`![](${IMAGE})`, '', '```plantuml', 'A -> B', '```'].join('\n')
    )
    expect(render).toHaveBeenCalledTimes(2)
  })

  it('skips drawio and non-diagram languages', async() => {
    render.mockResolvedValue(IMAGE)
    const source = [
      '```drawio',
      '{}',
      '```',
      '',
      '```python',
      'print(1)',
      '```'
    ].join('\n')

    await expect(substituteDiagramFences(source, THEMES)).resolves.toBe(source)
    expect(render).not.toHaveBeenCalled()
  })

  it('preserves CRLF line endings outside the replacement', async() => {
    render.mockResolvedValue(IMAGE)
    const source = matplotlibDoc.split('\n').join('\r\n')

    await expect(substituteDiagramFences(source, THEMES)).resolves.toBe(
      ['# 报告', '', `![](${IMAGE})`, '', '结尾'].join('\r\n')
    )
  })
})
