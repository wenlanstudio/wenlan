/**
 * mdcode2run 引擎注册表——main 进程里按文档路径锚定的引擎实例管理。
 *
 * 职责（DESIGN.md §9 宿主侧）：
 *   - 每个打开的文档一个引擎实例（章会话/JVM 在实例内长驻，10 分钟空闲自回收）
 *   - 引擎事件（started/chunk/done）转发给正在观看该文档的渲染端（watchers）
 *   - 作业句柄注册：stop 函数留在 main，渲染端经 IPC 捎句柄 ID 来停
 *   - 无人观看的引擎延迟回收（渲染端 reload 会销毁 webContents，立刻回收会把
 *     会话误杀；宽限期内重新 watch 则取消回收）
 *   - 显式 dispose（关文档）立即回收
 *
 * 本文件零 electron 依赖（只 require mdcode2run + node:path），可在 vitest 里
 * 直测；webContents 的 send 推送由 ipc 层经 setEventSink 注入。
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  createEngine,
  type MdcodeEngine,
  type MdcodeRunResultRaw
} from 'mdcode2run'
import type { Md2rEvent, Md2rRunResult } from '@shared/types/mdcode2run'

/** 无 watcher 后延迟回收（毫秒）——覆盖 dev 模式渲染端 reload 的窗口期。 */
export const ENGINE_DISPOSE_DELAY_MS = 60_000

interface EngineEntry {
  engine: MdcodeEngine
  docPath: string
  /** jobId → stop 句柄；作业完成即移除。 */
  jobs: Map<string, { stop: () => void }>
  /** 正在观看此文档的 webContents id 集合。 */
  watchers: Set<number>
  disposeTimer: NodeJS.Timeout | null
  /** 引擎事件已接线（每实例只接一次）。 */
  wired: boolean
}

const entries = new Map<string, EngineEntry>()

/** 由 IPC 层注入：把事件推给 watcher 列表（id 列表由注册表随事件给出）。 */
type EventSink = (event: Md2rEvent, watcherIds: number[]) => void
let eventSink: EventSink | null = null

export const setEventSink = (sink: EventSink | null): void => {
  eventSink = sink
}

const normalize = (docPath: string): string => path.normalize(docPath)

/**
 * 引擎层配置（秘密层，M5 接配置面板：非秘密参数 electron-store、密码 keytar）。
 *
 * M5 之前的临时探测：引擎只认显式 `python.PYTHON_PATH`（或文档 front-matter
 * 钉死），不会自己猜解释器。这里按 env → conda 前缀 → PATH 的顺序找一个，
 * 让「点 ▶ 就能跑」先成立；配置面板落地后这段让位给用户设置。
 * Windows 的 `WindowsApps` 目录里是 Store 别名存根，必须排除。
 */
const detectPython = (): string | null => {
  const isWin = process.platform === 'win32'
  const candidates = [
    process.env.MD2R_PYTHON,
    process.env.PYTHON_PATH,
    process.env.CONDA_PREFIX
      ? path.join(process.env.CONDA_PREFIX, isWin ? 'python.exe' : 'bin/python')
      : null
  ]
  for (const c of candidates) {
    if (c && !c.includes('WindowsApps') && fs.existsSync(c)) return c
  }
  const exts = isWin ? ['.exe'] : ['']
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir || dir.includes('WindowsApps')) continue
    for (const name of ['python', 'python3']) {
      for (const ext of exts) {
        const p = path.join(dir, name + ext)
        if (fs.existsSync(p)) return p
      }
    }
  }
  return null
}

/**
 * 引擎层配置文件（与 CLI `--config` 同形）：秘密、机器相关参数只放这里，
 * 讲义 front-matter 无权指定。默认 `~/.wenlan-studio/mdcode2run.json`，
 * 可用 `MD2R_CONFIG_FILE` 指到别处（多套集群配置切换）。
 *
 * 例：HS2 只在集群节点本机监听时，本机没有 beeline，靠 `hive.SSH_HOST` 走 SSH：
 * { "hive": { "SSH_HOST": "node0", "SSH_USER": "zhangsan",
 *             "CLIENT": "/opt/bigdata/hive/default/bin/beeline",
 *             "HOST": "localhost", "DATABASE": "zjsm", "USER": "zhangsan" } }
 */
export const engineConfigPath = (): string => {
  const override = process.env.MD2R_CONFIG_FILE?.trim()
  return override || path.join(os.homedir(), '.wenlan-studio', 'mdcode2run.json')
}

/** 读配置：坏文件只告警不阻断启动（没配置时引擎仍按 PATH 探测 Python 等）。 */
export const loadEngineProfile = (): Record<string, Record<string, unknown>> => {
  const file = engineConfigPath()
  if (!fs.existsSync(file)) return {}
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      console.warn(`[mdcode2run] 配置文件不是 JSON 对象：${file}`)
      return {}
    }
    const profile: Record<string, Record<string, unknown>> = {}
    for (const [family, value] of Object.entries(parsed as Record<string, unknown>)) {
      // 只收对象值：语言族配置与 config.secrets 都从这层走；数组 / 标量忽略。
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        profile[family] = value as Record<string, unknown>
      }
    }
    return profile
  } catch (error) {
    console.warn(`[mdcode2run] 配置文件读取失败：${file}`, error)
    return {}
  }
}

/** 自动探测打底，文件配置覆盖同族同键（文件只给部分参数时不丢探测结果）。 */
export const resolveEngineConfig = (): Record<string, Record<string, unknown>> => {
  const python = detectPython()
  const merged: Record<string, Record<string, unknown>> = {}
  if (python) merged.python = { PYTHON_PATH: python }
  for (const [family, value] of Object.entries(loadEngineProfile())) {
    merged[family] = { ...(merged[family] ?? {}), ...value }
  }
  return merged
}

const wireEvents = (entry: EngineEntry): void => {
  if (entry.wired) return
  entry.wired = true
  const emit = (event: Md2rEvent): void => {
    if (!eventSink || entry.watchers.size === 0) return
    eventSink(event, [...entry.watchers])
  }
  const detail = (d: unknown): { family: string; line: number } => {
    const { family, line } = d as { family?: string; line?: number }
    return { family: family ?? '', line: line ?? -1 }
  }
  entry.engine.events.on('started', d => {
    emit({ docPath: entry.docPath, type: 'started', ...detail(d) })
  })
  entry.engine.events.on('chunk', d => {
    const { stream, text } = d as { stream?: string; text?: string }
    emit({
      docPath: entry.docPath,
      type: 'chunk',
      ...detail(d),
      stream: stream ?? '',
      text: text ?? ''
    })
  })
  entry.engine.events.on('done', d => {
    const { ok, duration, error } = d as {
      ok?: boolean
      duration?: number
      error?: string
    }
    emit({
      docPath: entry.docPath,
      type: 'done',
      ...detail(d),
      ok: !!ok,
      duration: duration ?? 0,
      error
    })
  })
}

const cancelDisposeTimer = (entry: EngineEntry): void => {
  if (entry.disposeTimer) {
    clearTimeout(entry.disposeTimer)
    entry.disposeTimer = null
  }
}

/** 取或建引擎实例（同一文档路径恒返回同一实例）。 */
export const acquireEngine = (docPath: string): EngineEntry => {
  const key = normalize(docPath)
  let entry = entries.get(key)
  if (!entry) {
    const engine = createEngine({
      config: resolveEngineConfig(),
      documentPath: key,
      documentDir: path.dirname(key),
      // trace sidecar：存在则自动加载，每次 ▶ 自动追加（单写者=本注册表单实例）。
      tracePath: `${key}.trace`
    })
    entry = { engine, docPath: key, jobs: new Map(), watchers: new Set(), disposeTimer: null, wired: false }
    entries.set(key, entry)
  }
  cancelDisposeTimer(entry)
  wireEvents(entry)
  return entry
}

/**
 * 让一个 webContents 开始观看文档（parse/run 都会自动 watch）。
 * @returns entry；`added` 表示这是该 watcher 的首次接入（ipc 层据此挂 destroyed 钩子）。
 */
export const watchEngine = (
  docPath: string,
  webContentsId: number
): { entry: EngineEntry; added: boolean } => {
  const entry = acquireEngine(docPath)
  const added = !entry.watchers.has(webContentsId)
  if (added) entry.watchers.add(webContentsId)
  return { entry, added }
}

/** watcher 离场（webContents destroyed）。最后一个 watcher 走 → 延迟回收。 */
export const unwatchEngine = (docPath: string, webContentsId: number): void => {
  const entry = entries.get(normalize(docPath))
  if (!entry) return
  entry.watchers.delete(webContentsId)
  if (entry.watchers.size === 0 && !entry.disposeTimer) {
    entry.disposeTimer = setTimeout(() => {
      entry.disposeTimer = null
      disposeEngine(entry.docPath)
    }, ENGINE_DISPOSE_DELAY_MS)
  }
}

/** 某 webContents 销毁：把它从所有引擎的 watcher 里摘掉（关窗/reload）。 */
export const unwatchAllFor = (webContentsId: number): void => {
  for (const key of [...entries.keys()]) {
    unwatchEngine(key, webContentsId)
  }
}

/** 显式回收（关文档）：立即 dispose 并移除注册（运行中的 stop 句柄一并丢弃）。 */
export const disposeEngine = (docPath: string): boolean => {
  const key = normalize(docPath)
  const entry = entries.get(key)
  if (!entry) return false
  cancelDisposeTimer(entry)
  entry.watchers.clear()
  entry.jobs.clear()
  try {
    entry.engine.dispose()
  } catch {
    // dispose 不该挡关文档流程；引擎自身异常记录即可
  }
  entries.delete(key)
  return true
}

/** app 退出前回收全部引擎（README：常驻会话管道撑住事件循环，等 exit 事件等不到）。 */
export const disposeAllEngines = (): void => {
  for (const key of [...entries.keys()]) disposeEngine(key)
}

/**
 * run() 结果过 IPC 前的投影：job 字段的 stop/done 函数留在 main。
 * done 兑现后经事件 sink 推 job-done；作业句柄从注册表移除。
 */
export const attachJob = (entry: EngineEntry, result: MdcodeRunResultRaw): Md2rRunResult => {
  if (!result?.job) return result as Md2rRunResult
  const { id, stop, done } = result.job
  entry.jobs.set(id, { stop })
  done
    .then(outcome => {
      entry.jobs.delete(id)
      eventSink?.(
        { docPath: entry.docPath, type: 'job-done', id, outcome: outcome ?? {} },
        [...entry.watchers]
      )
    })
    .catch(() => {
      entry.jobs.delete(id)
    })
  return { ...result, job: { id } }
}

/** 停一个作业（渲染端经 IPC 捎 id）。找不到句柄返回 false（已完/已停）。 */
export const stopJob = (docPath: string, jobId: string): boolean => {
  const entry = entries.get(normalize(docPath))
  const job = entry?.jobs.get(jobId)
  if (!job) return false
  entry!.jobs.delete(jobId)
  try {
    job.stop()
    return true
  } catch {
    return false
  }
}
