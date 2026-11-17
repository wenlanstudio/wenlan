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
    Md2rFillResult,
    Md2rGuardResult,
    Md2rJournalEntry,
    Md2rLabReport,
    Md2rProjectFile,
    Md2rRunReport,
    Md2rRunResult,
    Md2rSessionInfo,
    Md2rStepSourceOverride,
    Md2rStepsResult,
    Md2rTeacherTraceResult,
    Md2rTodoFill,
    Md2rTraceEntry
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
    /** 教师录制 trace（发布物下发）：只读定序序列，不写 journal / sidecar（§11 双源分离）。 */
    teacherTrace?: string | Md2rTraceEntry[] | null
  }

  export interface MdcodeRunOptions {
    onChunk?: (info: { stream: string; text: string }) => void
    replay?: boolean
    timeout?: number
    src?: 'run' | 'replay' | 'trace' | 'present'
    /** 逐行执行（放映态会话族）：块内 0 基行号，只执行该行（共享变量）；不传则整块。 */
    line?: number
  }

  /** runDocument 的引擎侧选项（lib/mr runDoc 的透传；docDir 缺省引擎的 documentDir）。 */
  export interface MdcodeRunDocumentOptions {
    docDir?: string
    workdir?: string
    compileOnly?: boolean
    jdkHome?: string
    hadoopHome?: string
    winutilsHome?: string
    timeoutMs?: number
    id?: string
    onChunk?: (info: { stream: string; text: string }) => void
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
      /** 文档体裁：mr = front-matter 带 mr-job: 段（docs/MR-EXECUTOR.md）。 */
      kind: 'mr' | 'generic'
    }
    locate(
      md: string,
      target: { line?: number; code?: string; index?: number },
      opts?: { anyRole?: boolean }
    ): MdcodeCtx | null
    run(ctx: MdcodeCtx, opts?: MdcodeRunOptions): Promise<MdcodeRunResultRaw>
    /** 运行整份 mr-job 文档（M5a）：RunReport 原样返回，事件流照发（family="hadoop"）。 */
    runDocument(md: string, opts?: MdcodeRunDocumentOptions): Promise<Md2rRunReport>
    resetSession(target: MdcodeCtx | { family?: string; key?: string } | string): void
    /** 宿主关文档时回收全部常驻会话（JVM/解释器管道撑着事件循环）。 */
    dispose(): void
    journalOf(chapterLine: number): Md2rJournalEntry[]
    traceOf(): string
    /** 只加载**自己的**执行记录；教师录制 trace 必须走 setTeacherTrace。 */
    traceLoad(text: string): unknown
    replayTrace(opts?: unknown): unknown
    /** 章序扁平执行记录（含 src="document" 的文档级整份作业运行）。 */
    traceEntries(chapterLine?: number | null): Md2rTraceEntry[]
    /** 📥 装载教师录制序列（JSONL / 数组 / null 清除），绝不并入 journal。 */
    setTeacherTrace(source: string | Md2rTraceEntry[] | null): Md2rTeacherTraceResult
    /** 教师序列只读副本（只定序，不是学生做过的事实）。 */
    teacherTraceOf(): Md2rTraceEntry[]
    /** 学生本地执行事实（journal 里排除 src="document"）。 */
    localRuns(chapterLine?: number | null): Md2rTraceEntry[]
    /** 按教师 trace 序聚合步骤 + 按学生执行记录点亮 executed。 */
    stepsOf(md: string, opts?: Md2rStepSourceOverride): Md2rStepsResult
    /** 提交某步前查「提前做」两形态 + 通过判定（只查事实）。 */
    guardStep(
      md: string,
      stepId: string,
      opts?: Md2rStepSourceOverride & { projectFiles?: Md2rProjectFile[] }
    ): Md2rGuardResult
    /** TODO 回填（仅 project 档）：只读学生工程，生成留存用讲义。 */
    fillTodos(
      md: string,
      opts?: { previous?: Md2rTodoFill[]; projectFiles?: Md2rProjectFile[] }
    ): Md2rFillResult
    /** 实验报告 = 讲义 + 全部 TODO 回填后的自包含 md（仅留存，不参与判分）。 */
    labReportOf(
      md: string,
      opts?: { previous?: Md2rTodoFill[]; projectFiles?: Md2rProjectFile[] }
    ): Md2rLabReport
    tracePath?: string
    config?: Record<string, Record<string, unknown>>
  }

  export function createEngine(opts: MdcodeEngineOptions): MdcodeEngine

  export function contractFail(error: string): Md2rRunResult
}
