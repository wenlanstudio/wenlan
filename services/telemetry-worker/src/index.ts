interface Env {
  DB: D1Database
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const PLATFORMS = new Set(['win32', 'darwin', 'linux'])
const ARCHES = new Set(['x64', 'arm64', 'ia32', 'arm'])
const DAY_MS = 24 * 60 * 60 * 1000

interface LaunchEvent {
  installId: string
  date: string
  version: string
  platform: string
  arch: string
}

const json = (status: number, body: string): Response =>
  new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    }
  })

const isLaunchEvent = (value: unknown): value is LaunchEvent => {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<LaunchEvent>
  return (
    typeof event.installId === 'string' &&
    UUID_RE.test(event.installId) &&
    typeof event.date === 'string' &&
    DATE_RE.test(event.date) &&
    typeof event.version === 'string' &&
    VERSION_RE.test(event.version) &&
    typeof event.platform === 'string' &&
    PLATFORMS.has(event.platform) &&
    typeof event.arch === 'string' &&
    ARCHES.has(event.arch)
  )
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
      return json(405, JSON.stringify({ error: 'method_not_allowed' }))
    }
    const length = Number(request.headers.get('content-length') ?? 0)
    if (length > 4096) {
      return json(413, JSON.stringify({ error: 'payload_too_large' }))
    }

    let payload: unknown
    try {
      payload = await request.json()
    } catch {
      return json(400, JSON.stringify({ error: 'invalid_json' }))
    }
    if (!isLaunchEvent(payload)) {
      return json(400, JSON.stringify({ error: 'invalid_fields' }))
    }

    const today = new Date().toISOString().slice(0, 10)
    if (Math.abs(Date.parse(payload.date) - Date.parse(today)) > 2 * DAY_MS) {
      return json(400, JSON.stringify({ error: 'date_out_of_range' }))
    }

    const now = Date.now()
    try {
      await env.DB.prepare(
        'INSERT OR IGNORE INTO installs (install_id, first_seen, version, platform, arch, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
        .bind(payload.installId, payload.date, payload.version, payload.platform, payload.arch, now)
        .run()
      await env.DB.prepare(
        'INSERT OR IGNORE INTO usage_daily (install_id, day, version, platform, arch, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
        .bind(payload.installId, payload.date, payload.version, payload.platform, payload.arch, now)
        .run()
      return new Response(null, { status: 204 })
    } catch (err) {
      console.warn('[usage] write failed:', err instanceof Error ? err.message : String(err))
      return json(500, JSON.stringify({ error: 'internal_error' }))
    }
  }
}
