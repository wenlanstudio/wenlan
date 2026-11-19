import { DEFAULT_PLANTUML_SERVER } from '@shared/types/preferences'

export type PlantumlFormat = 'svg' | 'png'

const SERVER = /^https?:\/\/[^\s?#@]{1,512}$/
const ENCODED = /^[A-Za-z0-9_-]{1,20000}$/
const FORMATS: readonly PlantumlFormat[] = ['svg', 'png']

const normalize = (server: string): string => server.trim().replace(/\/+$/, '')

/**
 * Compose a PlantUML render URL from the pieces the renderer sends. The
 * renderer never hands over a URL: it is untrusted, and the main process is
 * the side that can reach the network. `configured` is the server the user set
 * in preferences — without it, a renderer could name any host and turn this
 * handler into a GET against the loopback interface or a cloud metadata
 * endpoint.
 */
export const buildPlantumlUrl = (
  server: string,
  encoded: string,
  format: PlantumlFormat,
  configured: string
): string | null => {
  if (!FORMATS.includes(format)) return null
  if (!SERVER.test(server) || !ENCODED.test(encoded)) return null

  const allowed = normalize(configured) || DEFAULT_PLANTUML_SERVER
  if (!SERVER.test(allowed) || normalize(server) !== allowed) return null

  return `${allowed}/${format}/${encoded}`
}
