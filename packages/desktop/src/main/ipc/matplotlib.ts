import { spawn } from 'child_process'
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { ipcMain } from 'electron'
import type { ExternalDiagramResult } from '@shared/types/ipc'

// Matplotlib has no browser implementation: the code has to run under a real
// Python. The main process runs the document's snippet in a short-lived
// interpreter and hands the renderer back an image.
//
// This executes the code the user wrote in their own document, so it is off
// until the preference turns it on (and a python interpreter must be
// configured) — the same trade-off notebook environments make, gated behind an
// explicit opt-in.

// Documents reach for `np` and `plt` without importing them — that is how the
// chart blocks read throughout Typora's ecosystem, and the ones people paste
// in — so bring them up alongside matplotlib and run the snippet with them in
// scope. Same for CJK fonts: a Chinese axis label silently becomes a row of
// boxes unless one of the families that can draw it is picked first.
/**
 * Marks the one line of the interpreter's stdout that carries the result.
 *
 * The snippet is the user's, and it prints: diagnostics land in the same pipe,
 * flushed after our payload because `print` is buffered and this is not. Taking
 * the last line would read their log instead of the diagram.
 */
const RESULT_PREFIX = '__MT_DIAGRAM__'

export const BOOTSTRAP = `
import base64, io, json, sys

# The channel is UTF-8 whatever the machine's locale says. Left to the text
# layer, a Chinese Windows decodes stdin as GBK with surrogateescape: every
# multi-byte character becomes mojibake, the bytes it cannot decode become
# lone surrogates, and the first UTF-8 writer to touch one — matplotlib
# serialising the svg — raises UnicodeEncodeError "surrogates not allowed".
# Read and write the bytes ourselves so the locale cannot reach them.
def read_source():
    return sys.stdin.buffer.read().decode("utf-8", errors="replace")

def emit(payload):
    # ensure_ascii keeps the payload ASCII, so a surrogate that survived into
    # an error message cannot stop the report from being written.
    sys.stdout.buffer.write(b"${RESULT_PREFIX} ")
    sys.stdout.buffer.write(json.dumps(payload).encode("utf-8", errors="replace"))
    sys.stdout.buffer.write(b"\\n")
    sys.stdout.buffer.flush()

def fail(message):
    emit({"ok": False, "error": message})
    sys.exit(0)

code = read_source()

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib import font_manager
except Exception as err:
    fail("matplotlib is not available: " + str(err))

# Chinese labels silently become boxes unless a family that has the glyphs
# is put in front of the default sans-serif list.
available = {f.name for f in font_manager.fontManager.ttflist}
cjk = [f for f in [
    "Microsoft YaHei", "SimHei", "PingFang SC", "Hiragino Sans GB", "Heiti SC",
    "Noto Sans CJK SC", "Source Han Sans SC", "WenQuanYi Micro Hei",
    "Noto Sans CJK TC", "Microsoft JhengHei",
] if f in available]
if cjk:
    plt.rcParams["font.sans-serif"] = cjk + list(plt.rcParams["font.sans-serif"])
plt.rcParams["axes.unicode_minus"] = False

# numpy is optional: a diagram drawn straight from lists needs only pyplot, and
# anything reaching for numpy without importing it raises the usual NameError.
try:
    import numpy as np
    namespace = {"__name__": "__diagram__", "plt": plt, "np": np}
except Exception:
    namespace = {"__name__": "__diagram__", "plt": plt}

try:
    exec(compile(code, "<diagram>", "exec"), namespace)
except Exception as err:
    fail(type(err).__name__ + ": " + str(err))

figures = [plt.figure(n) for n in plt.get_fignums()]
if not figures:
    fail("The code produced no figure - create one with matplotlib.pyplot.")

buffer = io.BytesIO()
try:
    figures[0].savefig(buffer, format="svg", bbox_inches="tight", facecolor="white")
except Exception as err:
    fail("Could not serialise the figure: " + str(err))

emit({
    "ok": True,
    "mime": "image/svg+xml",
    "data": base64.b64encode(buffer.getvalue()).decode("ascii")
})
`

const OUTPUT_LIMIT = 16 * 1024 * 1024
const RENDER_TIMEOUT = 120000
const DETECT_TIMEOUT = 30000

/** An interpreter and whatever flags reach it, kept apart for `spawn`. */
export interface IPythonCommand {
  command: string
  args: string[]
}

/**
 * Run the interpreter in UTF-8 mode.
 *
 * The document is UTF-8 and so is the pipe to it, so the snippet's own `open()`
 * and `print()` have to agree: on a Chinese Windows they would otherwise use
 * the ANSI code page and turn the document's text into mojibake, which is how
 * a label arrives at matplotlib holding lone surrogates.
 *
 * Interpreters too old to know the variable ignore it rather than fail.
 */
const utf8Env = (): NodeJS.ProcessEnv => ({ ...process.env, PYTHONUTF8: '1' })

/**
 * Split what the user typed in the preference. A path is one argument even
 * when it holds spaces (`C:\Program Files\Python\python.exe`); anything else
 * is a command with flags (`py -3`).
 */
export const parsePythonCommand = (value: string): IPythonCommand => {
  const trimmed = value.trim()
  if (!trimmed) return { command: '', args: [] }
  if (existsSync(trimmed)) return { command: trimmed, args: [] }

  const [command, ...args] = trimmed.split(/\s+/)
  return { command, args }
}

/** Where an interpreter is usually installed, besides `$PATH`. */
function installedInterpreters(): string[] {
  const found: string[] = []
  const home = process.env.USERPROFILE ?? process.env.HOME ?? ''
  const localAppData = process.env.LOCALAPPDATA ?? ''
  const roots =
    process.platform === 'win32'
      ? // Conda and the Store installer sit wherever Windows was installed,
        // which is a drive letter no amount of guessing gets right.
      [process.env.SystemDrive ?? 'C:', 'C:', 'D:', 'E:'].map(drive => `${drive}\\ProgramData`)
        .concat([home, localAppData])
        .concat([join(localAppData, 'Programs', 'Python')])
      : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/opt/local/bin', '/opt/conda/bin']

  for (const root of roots) {
    if (!root) continue
    for (const name of ['python3', 'python']) {
      const direct = join(root, name + (process.platform === 'win32' ? '.exe' : ''))
      if (existsSync(direct)) found.push(direct)
    }
  }

  // The official installer puts each version in its own `PythonXYZ` folder.
  if (process.platform === 'win32') {
    const bases = [join(localAppData, 'Programs', 'Python'), 'C:\\Python27'].filter(existsSync)
    for (const base of bases) {
      for (const entry of readdirSync(base, { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^Python\d/.test(entry.name)) continue
        const direct = join(base, entry.name, 'python.exe')
        if (existsSync(direct)) found.push(direct)
      }
    }
    for (const root of [process.env.SystemDrive ?? 'C:', 'C:', 'D:', 'E:'].map(d => `${d}\\ProgramData`)
      .concat([home, localAppData])) {
      for (const distro of ['anaconda3', 'miniconda3', 'miniforge3', 'mambaforge']) {
        const direct = join(root, distro, 'python.exe')
        if (existsSync(direct)) found.push(direct)
      }
    }
  }
  else {
    for (const distro of ['miniconda3', 'anaconda3', 'miniforge3']) {
      for (const base of ['/opt', home, '/usr/local']) {
        const direct = join(base, distro, 'bin', 'python3')
        if (existsSync(direct)) found.push(direct)
      }
    }
  }

  return found
}

export function pythonCandidates(): IPythonCommand[] {
  const candidates: IPythonCommand[] = []
  const add = (value: string): void => {
    const parsed = parsePythonCommand(value)
    if (parsed.command) candidates.push(parsed)
  }

  if (process.platform === 'win32') {
    // The Windows launcher knows every interpreter that registered itself,
    // whichever drive it landed on.
    add('py -3')
    add('py')
  }
  add('python3')
  installedInterpreters().forEach(add)
  add('python')

  // `py -3` and `python` can resolve to the same interpreter; the first one to
  // answer wins anyway, so duplicates only cost a spawn.
  return candidates
}

/** Whether `candidate` can actually import matplotlib — not merely start. */
function canDraw(candidate: IPythonCommand): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(candidate.command, [...candidate.args, '-c', 'import matplotlib'], {
      windowsHide: true,
      env: utf8Env(),
    })
    const timer = setTimeout(() => {
      child.kill()
      resolve(false)
    }, DETECT_TIMEOUT)

    child.on('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve(code === 0)
    })
  })
}

let detection: Promise<IPythonCommand | null> | null = null

/**
 * Find an interpreter that has matplotlib. One that starts but cannot draw is
 * no use — a bare Python is more common than one with the scientific stack —
 * so each candidate is probed for the library itself.
 *
 * The answer is cached: probing means spawning processes, and the first
 * `import matplotlib` on a machine builds a font cache and takes seconds.
 */
export const detectPython = (): Promise<IPythonCommand | null> => {
  detection ??= (async() => {
    for (const candidate of pythonCandidates()) {
      if (await canDraw(candidate)) return candidate
    }
    return null
  })()

  return detection
}

/** Run the detection while the app is idle, so the first diagram is not the one that waits. */
export const warmUpPythonDetection = (): void => {
  void detectPython()
}

/**
 * The result the interpreter reported, read out of a pipe the snippet also
 * printed to.
 *
 * `print` in the user's code is buffered and this payload is not, so the log
 * lands after it: taking the last line reads the log instead of the diagram,
 * which is why the payload carries a marker. A snippet that prints before its
 * figure draws is not unusual — chart code tends to report what it computed.
 */
export const parseRendererOutput = (stdout: string): ExternalDiagramResult | null => {
  const marker = `${RESULT_PREFIX} `
  const line = stdout
    .split('\n')
    .map(entry => entry.trim())
    .filter(entry => entry.startsWith(marker))
    .pop()
  if (!line) return null

  try {
    return JSON.parse(line.slice(marker.length)) as ExternalDiagramResult
  } catch {
    return null
  }
}

interface MatplotlibConfig {
  enabled: boolean
  pythonPath: string
}

let configuredSource: (() => MatplotlibConfig) | null = null

export const setMatplotlibSource = (source: () => MatplotlibConfig): void => {
  configuredSource = source
}

export const registerMatplotlibHandlers = (): void => {
  ipcMain.handle(
    'mt::diagram::render-external',
    async(_e, type: string, code: string): Promise<ExternalDiagramResult> => {
      if (type !== 'matplotlib') return { ok: false, error: `No external renderer for ${type}` }
      if (typeof code !== 'string' || !code.trim()) {
        return { ok: false, error: 'The diagram code is empty' }
      }
      if (!configuredSource) return { ok: false, error: 'Invalid matplotlib request' }

      const { enabled, pythonPath } = configuredSource()
      if (!enabled) {
        return {
          ok: false,
          error:
            'Matplotlib diagrams are disabled — they run your code with a local Python. '
          + 'Enable them in Preferences → Markdown.',
        }
      }

      // An empty preference means "find one"; anything typed there wins.
      const configured = parsePythonCommand(pythonPath)
      const interpreter = configured.command ? configured : await detectPython()
      if (!interpreter) {
        return {
          ok: false,
          error:
            'No Python with matplotlib was found. Install it (`pip install matplotlib`) '
            + 'or set the interpreter in Preferences → Markdown.',
        }
      }
      const label = [interpreter.command, ...interpreter.args].join(' ')

      return new Promise<ExternalDiagramResult>((resolve) => {
        const child = spawn(interpreter.command, [...interpreter.args, '-c', BOOTSTRAP], {
          windowsHide: true,
          env: utf8Env(),
        })
        let stdout = ''
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
          finish({ ok: false, error: `Rendering timed out after ${RENDER_TIMEOUT / 1000}s` })
        }, RENDER_TIMEOUT)

        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk
          if (stdout.length > OUTPUT_LIMIT) child.kill()
        })
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk
          if (stderr.length > OUTPUT_LIMIT) child.kill()
        })

        child.on('error', (err) => {
          finish({
            ok: false,
            error:
              `Could not run "${label}" — ${err.message}. `
              + 'Set the Python path in Preferences → Markdown.',
          })
        })

        child.on('close', (exitCode) => {
          const parsed = parseRendererOutput(stdout)
          if (parsed) {
            finish(parsed)
          }
          else {
            finish({
              ok: false,
              error:
                `The Python renderer exited with code ${exitCode}`
              + (stderr.trim() ? `: ${stderr.trim().slice(-400)}` : '.'),
            })
          }
        })

        // Bytes on the wire: the bootstrap decodes them as UTF-8 itself.
        child.stdin.end(Buffer.from(code, 'utf8'))
      })
    }
  )
}
