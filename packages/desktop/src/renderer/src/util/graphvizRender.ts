/**
 * The single decision point for "how does a Graphviz fence become a picture".
 *
 * The installed `dot.exe` is preferred (see main/ipc/graphviz.ts); when it is
 * missing, misconfigured, or fails, callers quietly fall back to @viz-js/viz.
 * Preview, HTML export, PNG/Pandoc export and the deck bridge all go through
 * `renderGraphvizWithExe` so they can never disagree about which engine drew
 * a given diagram.
 *
 * Output format is per-call: the editor preview (文/栏/页/码) asks for SVG —
 * same dot engine, same layout, but vector so it scales without pixelation
 * and its display size follows the SVG viewBox instead of a 192× pixel
 * blow-up that fills the narrow editor column. The deck (览/映) and export
 * keep PNG 192 dpi (IR needs a raster image for media landing). Results are
 * cached separately per (source, format) so the two never pollute each other.
 */

export type GraphvizExeResult =
  | { ok: true; mime: string; dataUrl: string }
  | { ok: false; error: string }

const MAX_CACHE = 64
const cache = new Map<string, Promise<GraphvizExeResult>>()
let lastWarnedError = ''

/** FNV-1a: rendered results are keyed by source, not by block identity. */
const hashSource = (code: string): string => {
  let hash = 2166136261
  for (let i = 0; i < code.length; i++) {
    hash ^= code.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

/** dot 走自动探测（main 侧），路径不再是用户偏好——token 固定；失败结果不缓存，
 * 首次未装 Graphviz 后补装仍会在下次渲染重新探测。 */
const engineToken = (): string => ''

const invokeDot = async(code: string, format: 'svg' | 'png'): Promise<GraphvizExeResult> => {
  try {
    const result = await window.diagram.renderExternal('graphviz', code, { format })
    if (!result.ok) return { ok: false, error: result.error }
    return {
      ok: true,
      mime: result.mime,
      dataUrl: `data:${result.mime};base64,${result.data}`
    }
  }
  catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * In-flight requests are shared and successful renders are cached by source
 * hash. The preview re-renders on every edit, and every miss here spawns a
 * process — without this, holding down a key in a dot block starts a storm of
 * `dot.exe` instances whose older results can land last.
 *
 * Failures are deliberately not cached: installing Graphviz or fixing the
 * configured path should take effect on the next render without a restart.
 */
export const renderGraphvizWithExe = (
  code: string,
  format: 'svg' | 'png' = 'png'
): Promise<GraphvizExeResult> => {
  const key = `${format}\0${hashSource(`${engineToken()}\0${code}`)}`
  const pending = cache.get(key)
  if (pending) return pending

  const request = invokeDot(code, format).then((result) => {
    if (!result.ok) {
      cache.delete(key)
      // Light-touch notice: no error card, no dialog. The editor keeps drawing
      // with WASM; the reason is here for anyone who opens devtools.
      if (lastWarnedError !== result.error) {
        lastWarnedError = result.error
        console.warn('[graphviz] dot.exe unavailable, using built-in WASM:', result.error)
      }
    }
    return result
  })

  cache.set(key, request)
  if (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  return request
}

/** Test helper: forget cached renders after a preference/path change. */
export const clearGraphvizExeCache = (): void => {
  cache.clear()
  lastWarnedError = ''
}
