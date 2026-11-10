import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DOT_ARGS,
  dotInstallCandidates,
  graphvizDotPath,
  renderGraphvizWithDot,
  resolveDotBinary,
  setGraphvizSource
} from 'main_renderer/ipc/graphviz'

const REAL_DOT = 'C:\\Program Files\\Graphviz\\bin\\dot.exe'
const describeDot = existsSync(REAL_DOT) ? describe : describe.skip

describe('dot argv', () => {
  it('matches the offline lecture toolchain: PNG at 192 dpi', () => {
    expect(DOT_ARGS).toEqual(['-Tpng', '-Gdpi=192'])
  })

  it('probes the installer folders, not just PATH', () => {
    const candidates = dotInstallCandidates()
    expect(candidates.length).toBeGreaterThan(0)
    if (process.platform === 'win32') {
      expect(candidates.some(entry => entry.endsWith('dot.exe'))).toBe(true)
    }
  })
})

describe('resolveDotBinary', () => {
  it('does not substitute a different binary for a configured path that is unusable', async() => {
    expect(await resolveDotBinary('D:/definitely/missing/dot.exe')).toBeNull()
  })

  it('reads the preference lazily, so changing it needs no restart', () => {
    let path = 'first'
    setGraphvizSource(() => path)
    expect(graphvizDotPath()).toBe('first')
    path = 'second'
    expect(graphvizDotPath()).toBe('second')
  })
})

// CI has no Graphviz; these run on a workstation that has it installed.
describeDot('real dot.exe', () => {
  it('renders a CJK-labelled graph into a PNG', async() => {
    const result = await renderGraphvizWithDot('digraph G { 中文 -> B [label="标签"]; }', REAL_DOT)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.mime).toBe('image/png')
      const bytes = Buffer.from(result.data, 'base64')
      expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      expect(bytes.length).toBeGreaterThan(1000)
    }
  })

  it('feeds the source through stdin, so shell metacharacters stay inert', async() => {
    const result = await renderGraphvizWithDot(
      'digraph G { A [label="$(whoami) & calc.exe"]; }',
      REAL_DOT
    )
    expect(result.ok).toBe(true)
  })

  it('reports a syntax error as a failure the renderer can fall back from', async() => {
    const result = await renderGraphvizWithDot('this is not dot', REAL_DOT)
    expect(result.ok).toBe(false)
  })
})
