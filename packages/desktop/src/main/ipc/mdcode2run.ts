/**
 * mdcode2run 引擎的 IPC 面（渲染进程全沙箱，起不了子进程——引擎由 main 托管）。
 *
 * invoke（renderer → main）：
 *   mt::mdcode2run::parse         { docPath, md } → 块/章/front-matter 视图（建 UI 用）
 *   mt::mdcode2run::run           { docPath, md, line, replay?, timeout? } → 结果契约
 *   mt::mdcode2run::reset-session / journal / dispose / job-stop
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
  Md2rJournalEntry,
  Md2rParseResult,
  Md2rRunResult
} from '@shared/types/mdcode2run'
import {
  attachJob,
  disposeAllEngines,
  disposeEngine,
  setEventSink,
  stopJob,
  unwatchAllFor,
  watchEngine
} from '../mdcode2run/registry'

/** parse 结果的序列化投影：剥离 fences（含 code 正文）、章只留围栏行号。 */
const serializeParse = (parsed: {
  blocks: unknown[]
  chapters: Array<{ title: string; line: number; fences: Array<{ line: number }> }>
  fm: { codeExec: Record<string, unknown>; top: Record<string, string> }
}): Md2rParseResult => ({
  blocks: parsed.blocks as unknown as Md2rParseResult['blocks'],
  chapters: parsed.chapters.map(
    (c): Md2rChapterInfo => ({
      title: c.title,
      line: c.line,
      fenceLines: c.fences.map(f => f.line)
    })
  ),
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
    timeout: opts.timeout
  })
  return attachJob(entry, raw)
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
  ipcMain.handle('mt::mdcode2run::reset-session', resetSessionHandler)
  ipcMain.handle('mt::mdcode2run::journal', journalHandler)
  ipcMain.handle('mt::mdcode2run::dispose', disposeHandler)
  ipcMain.handle('mt::mdcode2run::job-stop', jobStopHandler)

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
