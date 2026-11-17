/**
 * mdcode2run 引擎的 IPC 面（渲染进程全沙箱，起不了子进程——引擎由 main 托管）。
 *
 * invoke（renderer → main）：
 *   mt::mdcode2run::parse         { docPath, md } → 块/章/front-matter 视图（建 UI 用）
 *   mt::mdcode2run::run           { docPath, md, line, replay?, timeout? } → 结果契约
 *   mt::mdcode2run::reset-session / journal / dispose / job-stop
 *   P1 教学接线（MR-EXECUTOR §11）：set-teacher-trace / trace-state / steps /
 *   guard / fill-todos / lab-report —— 教师录制 trace 只读定序，学生执行事实另走
 *   localRuns，两源绝不混；docDir / 任意文件路径不接受渲染端指定（一律用引擎锚定的
 *   documentDir），projectFiles 这类纯数据才允许传入。
 *
 * push（main → renderer）：mt::mdcode2run::event——引擎事件（started/chunk/done/
 * job-done）转发，按 watcher 定向推送；事件自带 docPath，渲染端多文档共存时自查。
 *
 * 通道名护栏：Electron IPC 通道是纯字符串，拼错不会运行时报错——本仓用
 * @shared/types/ipc 的字面量类型 + preload 泛型让两端在编译期对齐。
 */

import { app, ipcMain, webContents, type IpcMainInvokeEvent } from 'electron'

import type {
  Md2rChapterInfo,
  Md2rEvent,
  Md2rFillResult,
  Md2rFillTodosOpts,
  Md2rGuardOpts,
  Md2rGuardResult,
  Md2rJournalEntry,
  Md2rLabReport,
  Md2rLabReportOpts,
  Md2rParseResult,
  Md2rProjectFile,
  Md2rRunDocumentOpts,
  Md2rRunReport,
  Md2rRunResult,
  Md2rSetTeacherTraceOpts,
  Md2rStepSourceOverride,
  Md2rStepsOpts,
  Md2rStepsResult,
  Md2rTeacherTraceResult,
  Md2rTodoFill,
  Md2rTraceState,
  Md2rTraceStateOpts
} from '@shared/types/mdcode2run'
import {
  attachJob,
  disposeAllEngines,
  disposeEngine,
  loadMrProfile,
  setEventSink,
  setTeacherTrace as applyTeacherTrace,
  stopJob,
  unwatchAllFor,
  watchEngine
} from '../mdcode2run/registry'

/** parse 结果的序列化投影：剥离 fences（含 code 正文）、章只留围栏行号，体裁透传。 */
const serializeParse = (parsed: {
  kind: 'mr' | 'generic'
  blocks: unknown[]
  chapters: Array<{ title: string; line: number; fences: Array<{ line: number }> }>
  fm: { codeExec: Record<string, unknown>; top: Record<string, string> }
}): Md2rParseResult => ({
  kind: parsed.kind,
  blocks: parsed.blocks as unknown as Md2rParseResult['blocks'],
  chapters: parsed.chapters.map((c): Md2rChapterInfo => ({
    title: c.title,
    line: c.line,
    fenceLines: c.fences.map((f) => f.line)
  })),
  fm: parsed.fm
})

const parseHandler = (
  e: IpcMainInvokeEvent,
  opts: { docPath: string; md: string }
): Md2rParseResult => {
  if (!opts || typeof opts.docPath !== 'string' || typeof opts.md !== 'string') {
    throw new Error('Invalid mdcode2run parse request')
  }
  const { entry } = watchEngine(opts.docPath, e.sender.id)
  return serializeParse(entry.engine.parse(opts.md))
}

const runHandler = async(
  e: IpcMainInvokeEvent,
  opts: {
    docPath: string
    md: string
    line: number
    replay?: boolean
    timeout?: number
    src?: 'run' | 'replay' | 'trace' | 'present'
  }
): Promise<Md2rRunResult> => {
  if (
    !opts ||
    typeof opts.docPath !== 'string' ||
    typeof opts.md !== 'string' ||
    typeof opts.line !== 'number'
  ) {
    throw new Error('Invalid mdcode2run run request')
  }
  const { entry } = watchEngine(opts.docPath, e.sender.id)
  const ctx = entry.engine.locate(opts.md, { line: opts.line })
  if (!ctx) {
    return {
      ok: false,
      kind: 'none',
      stdout: '',
      text: '',
      error: `第 ${opts.line + 1} 行（0 基 ${opts.line}）附近没有可执行的代码块（语言不支持或角色不可跑）`
    }
  }
  const raw = await entry.engine.run(ctx, {
    replay: !!opts.replay,
    timeout: opts.timeout,
    src: opts.src
  })
  return attachJob(entry, raw)
}

/**
 * 运行整份 mr-job 文档（体裁 kind="mr"）：织入 → 校验 → unit/local 后端 → asserts
 * → RunReport。流式日志走既有事件推送（family="hadoop"，registry wireEvents 原样转发），
 * 终值以 invoke 返回的 RunReport 为准。机器三路径从配置文件 `mr` 键读（空则引擎回落
 * 环境变量）；docDir 不传——引擎实例已锚定文档目录，教学窗 projectsRoot 落位天然成立。
 */
const runDocumentHandler = async(
  e: IpcMainInvokeEvent,
  opts: Md2rRunDocumentOpts
): Promise<Md2rRunReport> => {
  if (!opts || typeof opts.docPath !== 'string' || typeof opts.md !== 'string') {
    throw new Error('Invalid mdcode2run run-document request')
  }
  const { entry } = watchEngine(opts.docPath, e.sender.id)
  const mr = loadMrProfile()
  return entry.engine.runDocument(opts.md, {
    timeoutMs: opts.timeoutMs,
    compileOnly: opts.compileOnly,
    jdkHome: mr.jdkHome,
    hadoopHome: mr.hadoopHome,
    winutilsHome: mr.winutilsHome
  })
}

const resetSessionHandler = (
  e: IpcMainInvokeEvent,
  opts: { docPath: string; md: string; line: number }
): boolean => {
  if (!opts || typeof opts.docPath !== 'string' || typeof opts.md !== 'string') {
    throw new Error('Invalid mdcode2run reset-session request')
  }
  const { entry } = watchEngine(opts.docPath, e.sender.id)
  const ctx = entry.engine.locate(opts.md, { line: opts.line ?? 0 })
  if (!ctx) return false
  entry.engine.resetSession(ctx)
  return true
}

const journalHandler = (
  e: IpcMainInvokeEvent,
  opts: { docPath: string; chapterLine: number }
): Md2rJournalEntry[] => {
  if (!opts || typeof opts.docPath !== 'string') {
    throw new Error('Invalid mdcode2run journal request')
  }
  const { entry } = watchEngine(opts.docPath, e.sender.id)
  return entry.engine.journalOf(opts.chapterLine ?? -1)
}

const disposeHandler = (_e: IpcMainInvokeEvent, opts: { docPath: string }): boolean => {
  if (!opts || typeof opts.docPath !== 'string') {
    throw new Error('Invalid mdcode2run dispose request')
  }
  return disposeEngine(opts.docPath)
}

const jobStopHandler = (
  _e: IpcMainInvokeEvent,
  opts: { docPath: string; jobId: string }
): boolean => {
  if (!opts || typeof opts.docPath !== 'string' || typeof opts.jobId !== 'string') {
    throw new Error('Invalid mdcode2run job-stop request')
  }
  return stopJob(opts.docPath, opts.jobId)
}

// ── P1 教学接线（MR-EXECUTOR §11 双源分离）─────────────────────────────────

/**
 * P1 查询的统一入参校验。**只放行纯数据**：docDir / workdir / tracePath 等路径
 * 一律由引擎锚定的 documentDir 决定（教学窗 projectsRoot 落位），渲染端无权指定。
 */
const p1Request = (
  opts: unknown,
  what: string,
  needMd = false
): { docPath: string; md: string } => {
  const o = opts as { docPath?: unknown; md?: unknown } | null
  if (
    !o ||
    typeof o.docPath !== 'string' ||
    !o.docPath.trim() ||
    (needMd && typeof o.md !== 'string')
  ) {
    throw new Error(`Invalid mdcode2run ${what} request`)
  }
  return { docPath: o.docPath, md: typeof o.md === 'string' ? o.md : '' }
}

/** 两源 + 断言归因的单次覆盖（离线回放/单测用），只收数组与对象。 */
const stepOptsOf = (opts: Md2rStepSourceOverride): Md2rStepSourceOverride => ({
  ...(Array.isArray(opts.teacherTrace) ? { teacherTrace: opts.teacherTrace } : {}),
  ...(Array.isArray(opts.localRuns) ? { localRuns: opts.localRuns } : {}),
  ...(opts.assertsByStep && typeof opts.assertsByStep === 'object'
    ? { assertsByStep: opts.assertsByStep }
    : {})
})

/** 回填/报告的纯数据参数：上次填充清单（stale 比对）与宿主已读的工程文件。 */
const fileOptsOf = (opts: {
  previous?: unknown
  projectFiles?: unknown
}): {
  previous?: Md2rTodoFill[]
  projectFiles?: Md2rProjectFile[]
} => ({
  ...(Array.isArray(opts.previous) ? { previous: opts.previous as Md2rTodoFill[] } : {}),
  ...(Array.isArray(opts.projectFiles)
    ? { projectFiles: opts.projectFiles as Md2rProjectFile[] }
    : {})
})

/**
 * 📥 装载教师录制 trace（发布物下发）：JSONL 文本 / 条目数组 / null 清除。
 * 只进只读定序序列，绝不写 journal / sidecar / Replay Trace。
 */
const setTeacherTraceHandler = (
  _e: IpcMainInvokeEvent,
  opts: Md2rSetTeacherTraceOpts
): Md2rTeacherTraceResult => {
  const { docPath } = p1Request(opts, 'set-teacher-trace')
  const source = opts.source ?? null
  if (source !== null && typeof source !== 'string' && !Array.isArray(source)) {
    throw new Error('Invalid mdcode2run set-teacher-trace request')
  }
  return applyTeacherTrace(docPath, source)
}

/** 双源只读视图：面板核对清单 / 诊断用，不产生任何执行事实。 */
const traceStateHandler = (e: IpcMainInvokeEvent, opts: Md2rTraceStateOpts): Md2rTraceState => {
  const { docPath } = p1Request(opts, 'trace-state')
  const { entry } = watchEngine(docPath, e.sender.id)
  const ch = typeof opts.chapterLine === 'number' ? opts.chapterLine : null
  return {
    teacher: entry.engine.teacherTraceOf().filter((t) => ch === null || t.ch === ch),
    local: entry.engine.localRuns(ch),
    all: entry.engine.traceEntries(ch)
  }
}

/** 步骤面板：顺序只来自教师序列，executed 只来自学生本地执行记录。 */
const stepsHandler = (e: IpcMainInvokeEvent, opts: Md2rStepsOpts): Md2rStepsResult => {
  const { docPath, md } = p1Request(opts, 'steps', true)
  const { entry } = watchEngine(docPath, e.sender.id)
  return entry.engine.stepsOf(md, stepOptsOf(opts))
}

/** 提交某步前的提前做守卫 + 通过判定（只查事实，锁序/计分仍归服务端）。 */
const guardHandler = (e: IpcMainInvokeEvent, opts: Md2rGuardOpts): Md2rGuardResult => {
  const { docPath, md } = p1Request(opts, 'guard', true)
  if (typeof opts.stepId !== 'string' || !opts.stepId.trim()) {
    throw new Error('Invalid mdcode2run guard request')
  }
  const { entry } = watchEngine(docPath, e.sender.id)
  return entry.engine.guardStep(md, opts.stepId, {
    ...stepOptsOf(opts),
    ...fileOptsOf(opts)
  })
}

/** TODO 回填（仅 project 档）：生成实验报告留存用讲义，不参与判分。 */
const fillTodosHandler = (e: IpcMainInvokeEvent, opts: Md2rFillTodosOpts): Md2rFillResult => {
  const { docPath, md } = p1Request(opts, 'fill-todos', true)
  const { entry } = watchEngine(docPath, e.sender.id)
  return entry.engine.fillTodos(md, fileOptsOf(opts))
}

/** 实验报告 = 讲义 + 全部 TODO 回填后的自包含 md。 */
const labReportHandler = (e: IpcMainInvokeEvent, opts: Md2rLabReportOpts): Md2rLabReport => {
  const { docPath, md } = p1Request(opts, 'lab-report', true)
  const { entry } = watchEngine(docPath, e.sender.id)
  return entry.engine.labReportOf(md, fileOptsOf(opts))
}

export const registerMdcode2runHandlers = (): void => {
  // 引擎事件 → 定向推给 watcher（fromId 可能为 null：销毁竞态，跳过即静默丢帧）
  setEventSink((event: Md2rEvent, watcherIds: number[]): void => {
    for (const id of watcherIds) {
      const wc = webContents.fromId(id)
      if (wc && !wc.isDestroyed()) {
        wc.send('mt::mdcode2run::event', event)
      }
    }
  })

  ipcMain.handle('mt::mdcode2run::parse', parseHandler)
  ipcMain.handle('mt::mdcode2run::run', runHandler)
  ipcMain.handle('mt::mdcode2run::run-document', runDocumentHandler)
  ipcMain.handle('mt::mdcode2run::reset-session', resetSessionHandler)
  ipcMain.handle('mt::mdcode2run::journal', journalHandler)
  ipcMain.handle('mt::mdcode2run::dispose', disposeHandler)
  ipcMain.handle('mt::mdcode2run::job-stop', jobStopHandler)
  ipcMain.handle('mt::mdcode2run::set-teacher-trace', setTeacherTraceHandler)
  ipcMain.handle('mt::mdcode2run::trace-state', traceStateHandler)
  ipcMain.handle('mt::mdcode2run::steps', stepsHandler)
  ipcMain.handle('mt::mdcode2run::guard', guardHandler)
  ipcMain.handle('mt::mdcode2run::fill-todos', fillTodosHandler)
  ipcMain.handle('mt::mdcode2run::lab-report', labReportHandler)

  // watcher 离场：webContents 销毁（关窗/reload）→ 从所有引擎摘掉该 watcher。
  app.on('web-contents-created', (_event, contents) => {
    contents.once('destroyed', () => {
      unwatchAllFor(contents.id)
    })
  })

  // 退出前回收全部常驻会话（JVM/解释器管道撑住事件循环，等 process exit 等不到）。
  app.on('will-quit', () => {
    disposeAllEngines()
  })
}
