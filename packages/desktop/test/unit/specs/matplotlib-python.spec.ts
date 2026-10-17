import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BOOTSTRAP,
  parsePythonCommand,
  parseRendererOutput,
  pythonCandidates,
} from 'main_renderer/ipc/matplotlib'

/**
 * The interpreter a matplotlib diagram runs under is looked up rather than
 * typed, because "python" on a machine usually resolves to something without
 * the scientific stack. What is checked here is the parsing and the ordering
 * of the lookup, not the spawning.
 */
describe('parsePythonCommand', () => {
  it('reads an empty preference as "no preference"', () => {
    expect(parsePythonCommand('').command).toBe('')
    expect(parsePythonCommand('   ').command).toBe('')
  })

  it('splits a command with flags apart for spawn', () => {
    expect(parsePythonCommand('py -3')).toEqual({ command: 'py', args: ['-3'] })
  })

  it('reads a bare interpreter name as-is', () => {
    expect(parsePythonCommand('python3')).toEqual({ command: 'python3', args: [] })
  })

  it('keeps a path that holds spaces in one piece', () => {
    // `C:\Program Files\Python311\python.exe` would split into two tokens if
    // the path were treated as a command line.
    const directory = join(tmpdir(), 'marktext python path with spaces')
    mkdirSync(directory, { recursive: true })
    const interpreter = join(directory, 'python.exe')
    writeFileSync(interpreter, '')

    expect(existsSync(interpreter)).toBe(true)
    expect(parsePythonCommand(interpreter)).toEqual({ command: interpreter, args: [] })
    expect(parsePythonCommand(process.execPath)).toEqual({ command: process.execPath, args: [] })
  })
})

describe('parseRendererOutput', () => {
  const result = (payload: unknown): string => `__MT_DIAGRAM__ ${JSON.stringify(payload)}\n`

  it('reads the result of a snippet that printed nothing', () => {
    expect(parseRendererOutput(result({ ok: true, mime: 'image/svg+xml', data: 'AA' })))
      .toEqual({ ok: true, mime: 'image/svg+xml', data: 'AA' })
  })

  it('reads the result past whatever the snippet printed', () => {
    // `print` is buffered and the payload is not, so the log lands after it.
    const stdout = result({ ok: false, error: 'boom' }) + '[stat] n=400\n[stat] peak=84\n'

    expect(parseRendererOutput(stdout)).toEqual({ ok: false, error: 'boom' })
  })

  it('reports nothing when the interpreter never answered', () => {
    expect(parseRendererOutput('Traceback (most recent call last):\n  File "<diagram>"\n')).toBeNull()
  })
})

/**
 * The pipe to the interpreter is a text channel by default, and on a machine
 * whose locale is not UTF-8 — a Chinese Windows, where it is GBK — the
 * document's UTF-8 arrives as mojibake and lone surrogates. Those are what
 * make matplotlib's svg writer fail with "surrogates not allowed", so the
 * bootstrap has to own the encoding on both ends.
 */
describe('BOOTSTRAP', () => {
  it('reads the source as bytes rather than through the locale', () => {
    expect(BOOTSTRAP).toContain('sys.stdin.buffer.read()')
    expect(BOOTSTRAP).not.toMatch(/^\s*code = sys\.stdin\.read\(\)\s*$/m)
  })

  it('writes the result as bytes, so a surrogate cannot sink the report', () => {
    expect(BOOTSTRAP).toContain('sys.stdout.buffer.write')
    expect(BOOTSTRAP).toContain('__MT_DIAGRAM__')
  })

  it('reaches python as source the interpreter can compile', () => {
    // The bootstrap is a template literal, so an escape in it is resolved here
    // rather than there: a plain `\\n` would arrive as a line break inside the
    // bytes literal and make the whole snippet a SyntaxError.
    expect(BOOTSTRAP).toContain('b"\\n"')
    expect(BOOTSTRAP).not.toContain('${')
  })
})

describe('pythonCandidates', () => {
  it('offers the interpreters on PATH', () => {
    const commands = pythonCandidates().map(({ command }) => command)

    expect(commands).toContain('python')
  })

  it('asks the Windows launcher first, which knows where every install is', () => {
    if (process.platform !== 'win32') return

    const [first] = pythonCandidates()

    expect(first).toEqual({ command: 'py', args: ['-3'] })
  })

  it('never proposes a bare name with an interpreter-less machine', () => {
    for (const candidate of pythonCandidates()) {
      expect(candidate.command).not.toBe('')
      expect(candidate.command).not.toContain('  ')
    }
  })
})
