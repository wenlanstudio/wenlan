import { randomUUID } from 'crypto'
import { app } from 'electron'
import Store from 'electron-store'
import log from 'electron-log'

const USAGE_STORE_NAME = 'usage'
const STARTUP_DELAY_MS = 30_000
const REQUEST_TIMEOUT_MS = 5_000
const MAX_PENDING = 10
const USAGE_ENDPOINT =
  process.env.WENLAN_USAGE_ENDPOINT ?? 'https://REPLACE_ME.service.tcloudbase.com/usage'

interface UsageEvent {
  installId: string
  date: string
  version: string
  platform: string
  arch: string
}

interface UsageStore {
  installId?: string
  lastLaunchDate?: string
  pending: UsageEvent[]
}

interface UsagePreferences {
  getItem<T>(key: string): T | undefined | null
}

const localDay = (): string => {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

const postEvent = async (event: UsageEvent): Promise<void> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(USAGE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      signal: controller.signal
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
  } finally {
    clearTimeout(timer)
  }
}

const sendWithRetryQueue = async (store: Store<UsageStore>, event: UsageEvent): Promise<void> => {
  try {
    await postEvent(event)
  } catch (err) {
    log.warn('[usage] launch report failed:', err instanceof Error ? err.message : String(err))
    const pending = store.get('pending', [])
    store.set('pending', [...pending, event].slice(-MAX_PENDING))
    return
  }

  const pending = store.get('pending', [])
  if (pending.length === 0) {
    return
  }
  const remaining: UsageEvent[] = []
  for (const queued of pending) {
    try {
      await postEvent(queued)
    } catch {
      remaining.push(queued)
    }
  }
  store.set('pending', remaining.slice(-MAX_PENDING))
}

export const scheduleUsageTelemetry = (
  preferences: UsagePreferences,
  delayMs = STARTUP_DELAY_MS
): void => {
  if (!app.isPackaged || USAGE_ENDPOINT.includes('REPLACE_ME')) {
    return
  }
  if (preferences.getItem<boolean>('telemetryEnabled') === false) {
    return
  }

  const store = new Store<UsageStore>({ name: USAGE_STORE_NAME })
  const installId = store.get('installId') ?? randomUUID()
  store.set('installId', installId)

  const date = localDay()
  if (store.get('lastLaunchDate') === date) {
    return
  }
  store.set('lastLaunchDate', date)

  const event: UsageEvent = {
    installId,
    date,
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch
  }
  setTimeout(() => {
    void sendWithRetryQueue(store, event)
  }, delayMs)
}
