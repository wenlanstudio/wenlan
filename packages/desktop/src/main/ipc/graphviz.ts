import { spawn } from 'child_process'
import { join } from 'path'
import { isExecutableFile } from 'common/filesystem'
import { resolveCommand } from '../utils/resolveCommand'
import type { ExternalDiagramResult } from '@shared/types/ipc'

/**
 * Graphviz (dot) rendering in the main process.
 *
 * Wenlan prefers the real Graphviz binary over the bundled WASM compiler: the
 * installed version, its fonts, its plugins and its 192 dpi bitmap are what
 * the authoring toolchain has always produced. `dot -Tpng -Gdpi=192` matches
 * the md2slides thin-host/CLI output, so a diagram looks the same in the
 * editor, in a deck and in an offline-built lecture.
 *
 * The renderer falls back to @viz-js/viz (WASM) whenever this returns an
 * error, so a machine without Graphviz still renders every document.
 */

const OUTPUT_LIMIT = 16 * 1024 * 1024
const RENDER_TIMEOUT = 30000
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Fixed argv: document source is never interpolated into a command line. */
export const DOT_ARGS = ['-Tpng', '-Gdpi=192'] as const

/** Graphviz's Windows installer does not add itself to PATH. */
export const dotInstallCandidates = (): string[] => {
  if (process.platform === 'win32') {
    const roots = [
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      process.env.SystemDrive ? `${process.env.SystemDrive}\\Program Files` : '',
      'C:\\Program Files',
      'C:\\Program Files (x86)'
    ].filter((value): value is string => !!value)
    return [...new Set(roots)].map(root => join(root, 'Graphviz', 'bin', 'dot.exe'))
  }
  return ['/usr/local/bin/dot', '/opt/homebrew/bin/dot', '/usr/bin/dot']
}

const DETECTION_TTL = 10000
let detectionCache: { key: string; binary: string | null; at: number } | null = null

/**
 * A configured path is an instruction: when it is set but unusable we do not
 * quietly run a different binary the user did not name. An empty path means
 * "find one" — GRAPHVIZ_DOT, the usual install folders, then PATH.
 *
 * Detection is cached briefly. The preview re-renders on every keystroke and
 * `resolveCommand` may consult the login shell; without this, a machine with
 * no Graphviz would rescan the disk and PATH for every character typed. A
 * short TTL still lets a newly installed dot.exe be found without a restart.
 */
const detectDotBinary = async(override: string, fromEnv: string): Promise<string | null> => {
  if (override) return isExecutableFile(override) ? override : null
  if (fromEnv && isExecutableFile(fromEnv)) return fromEnv
  return resolveCommand('dot', { preferred: dotInstallCandidates() })
}

export const resolveDotBinary = async(configured: string): Promise<string | null> => {
  const override = configured.trim()
  const fromEnv = (process.env.GRAPHVIZ_DOT ?? '').trim()
  const key = override || fromEnv
  const now = Date.now()
  if (detectionCache && detectionCache.key === key && now - detectionCache.at < DETECTION_TTL) {
    return detectionCache.binary
  }

  const binary = await detectDotBinary(override, fromEnv)
  detectionCache = { key, binary, at: now }
  return binary
}

let configuredSource: (() => string) | null = null

/** Read lazily so editing the preference takes effect without a restart. */
export const setGraphvizSource = (source: () => string): void => {
  configuredSource = source
}

export const graphvizDotPath = (): string => configuredSource?.() ?? ''

export const renderGraphvizWithDot = async(
  code: string,
  configured: string
): Promise<ExternalDiagramResult> => {
  const binary = await resolveDotBinary(configured)
  if (!binary) {
    return {
      ok: false,
      error:
        'No usable Graphviz dot executable was found. Set its path in Preferences → Markdown, '
        + 'or leave it empty for automatic detection. The built-in WASM renderer is used instead.'
    }
  }

  return new Promise<ExternalDiagramResult>((resolve) => {
    const child = spawn(binary, [...DOT_ARGS], { windowsHide: true })
    const stdout: Buffer[] = []
    let stdoutLength = 0
    let stderr = ''
    let settled = false

    const finish = (result: ExternalDiagramResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const timer = setTimeout(() => {
      child.kill()
      finish({ ok: false, error: `dot timed out after ${RENDER_TIMEOUT / 1000}s` })
    }, RENDER_TIMEOUT)

    // PNG is binary: accumulate Buffers, never concatenate as text.
    child.stdout.on('data', (chunk: Buffer) => {
      stdout.push(chunk)
      stdoutLength += chunk.length
      if (stdoutLength > OUTPUT_LIMIT) child.kill()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })

    child.on('error', (err) => {
      finish({ ok: false, error: `Could not run "${binary}" — ${err.message}` })
    })

    child.on('close', (exitCode) => {
      const bytes = Buffer.concat(stdout)
      if (exitCode !== 0 || !bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
        finish({
          ok: false,
          error:
            `dot exited with code ${exitCode}`
            + (stderr.trim() ? `: ${stderr.trim().slice(-400)}` : ' without a PNG')
        })
        return
      }
      if (bytes.length > OUTPUT_LIMIT) {
        finish({ ok: false, error: 'The diagram exceeded the 16 MB output limit' })
        return
      }
      finish({ ok: true, mime: 'image/png', data: bytes.toString('base64') })
    })

    child.stdin.end(Buffer.from(code, 'utf8'))
  })
}
