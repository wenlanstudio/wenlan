/**
 * `mdcode2run`（git 依赖 wenlanstudio/mdcode2run，CJS、无自带类型）的最小类型
 * 声明——只声明 main 进程消费到的面。引擎的完整契约见其仓 DESIGN.md §9；
 * 过 IPC 边界的形状在 @shared/types/mdcode2run.ts。
 *
 * 构建链注意：electron-vite main 默认 externalize 依赖 → 产物里是运行时
 * require('mdcode2run')，CJS 原生可用，无需任何形态转换。
 */

declare module 'mdcode2run' {
  import type {
    Md2rJournalEntry,
    Md2rRunResult,
    Md2rSessionInfo
  } from '@shared/types/mdcode2run'

  /** 引擎内部围栏对象（含 code 正文，不可过 IPC）。 */
  export interface MdcodeFence {
    lang: string
    code: string
    meta: { role: string; job?: boolean; file?: string; problems: string[] }
    line: number
    end: number
  }

  /** locate() 的返回：main 进程内部持有，不可过 IPC。 */
  export interface MdcodeCtx {
    family: string
    lang: string
    line: number
    source: string
    session?: { family: string; key: string; workdirKey: string }
    doc: unknown
  }

  export interface MdcodeEngineOptions {
    /** 引擎层配置（秘密）：{ java: {JAVA_HOME}, python: {PYTHON_PATH}, ... }。 */
    config?: Record<string, Record<string, unknown>>
    /** 会话身份的锚（文档绝对路径）。 */
    documentPath: string
    documentDir: string
    /** trace sidecar 路径；给了则启动时自动加载、每次 ▶ 自动追加。单写者。 */
    tracePath?: string
  }

  export interface MdcodeRunOptions {
    onChunk?: (info: { stream: string; text: string }) => void
    replay?: boolean
    timeout?: number
    src?: 'run' | 'replay' | 'trace'
  }

  /** run() 的原始结果——job 字段含函数，过 IPC 前须投影成 { id }。 */
  export interface MdcodeRunResultRaw extends Md2rRunResult {
    job?: { id: string; stop: () => void; done: Promise<MdcodeJobDone> }
    session?: Md2rSessionInfo
  }

  export interface MdcodeJobDone {
    code?: number
    signal?: string | null
    killed?: boolean
    durationMs?: number
    error?: string
  }

  export interface MdcodeEngine {
    /** EventEmitter：started {family,line} / chunk {…,stream,text} / done {ok,duration,error?}。 */
    events: {
      on(event: string, listener: (data: unknown) => void): void
      emit(event: string, data?: unknown): boolean
    }
    parse(md: string): {
      blocks: unknown[]
      chapters: Array<{ title: string; line: number; fences: MdcodeFence[] }>
      fm: { codeExec: Record<string, unknown>; top: Record<string, string> }
      fences: MdcodeFence[]
    }
    locate(
      md: string,
      target: { line?: number; code?: string; index?: number },
      opts?: { anyRole?: boolean }
    ): MdcodeCtx | null
    run(ctx: MdcodeCtx, opts?: MdcodeRunOptions): Promise<MdcodeRunResultRaw>
    resetSession(target: MdcodeCtx | { family?: string; key?: string } | string): void
    /** 宿主关文档时回收全部常驻会话（JVM/解释器管道撑着事件循环）。 */
    dispose(): void
    journalOf(chapterLine: number): Md2rJournalEntry[]
    traceOf(): string
    traceLoad(text: string): unknown
    replayTrace(opts?: unknown): unknown
    tracePath?: string
    config?: Record<string, Record<string, unknown>>
  }

  export function createEngine(opts: MdcodeEngineOptions): MdcodeEngine

  export function contractFail(error: string): Md2rRunResult
}
