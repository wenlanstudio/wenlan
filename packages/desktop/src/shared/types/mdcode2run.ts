/**
 * mdcode2run（git 依赖 wenlanstudio/mdcode2run）引擎 ↔ 宿主之间的 IPC 契约类型。
 *
 * 引擎是无头 Node 库，跑在 main 进程（渲染进程全沙箱起不了子进程）；这里只放
 * 过 IPC 边界的形状——块清单、章、结果契约、执行日志条目、推送事件。引擎内部
 * ctx / fences 等不可序列化对象不出 main。
 */

/** 引擎 parse() 的块视图（不含 code 正文——渲染端手里就有 md）。行号 0 基。 */
export interface Md2rBlockInfo {
  index: number
  /** 围栏 info-string 的语言标签（原样小写）。 */
  lang: string
  /** 语言族（python/java/shell/mysql/hive），不支持为 null。 */
  family: string | null
  /** 语言是否受支持（family 非空）。 */
  supported: boolean
  /** 可执行（支持语言 + 可跑角色 + 无标注冲突）。 */
  runnable: boolean
  /** 围栏开启行（0 基）。 */
  line: number
  /** 围栏闭合后的下一行（0 基、不含）。 */
  end: number
  /** 块角色：code | demo | setup | file | invalid。 */
  role: 'code' | 'demo' | 'setup' | 'file' | 'invalid'
  /** job 执行模式（异步启动 + 日志流 + 可终止）。 */
  job: boolean
  /** file= 物化的相对路径（file 角色时）。 */
  file: string | undefined
  /** 标注问题（未知/重复/冲突）；非空块只展示不执行。 */
  problems: string[]
}

/** 章（h1 = 会话边界 = 重放范围）。 */
export interface Md2rChapterInfo {
  title: string
  /** h1 行（0 基）；隐式首章为 -1。 */
  line: number
  /** 归属本章的围栏开启行（0 基，升序）。 */
  fenceLines: number[]
}

/** front-matter 视图（preset、title 等顶层标量 + code-exec 段）。 */
export interface Md2rFrontMatter {
  top: Record<string, string>
  codeExec: Record<string, unknown>
}

export interface Md2rParseResult {
  blocks: Md2rBlockInfo[]
  chapters: Md2rChapterInfo[]
  fm: Md2rFrontMatter
}

/** 章会话 HUD：同章同 family 共享会话，seq 是章内执行序号（▶ ran #N）。 */
export interface Md2rSessionInfo {
  family: string
  key: string
  workdirKey?: string
  seq?: number
}

/** 作业句柄的序列化投影——stop 函数留在 main，经 mt::mdcode2run::job-stop 调。 */
export interface Md2rJobInfo {
  id: string
}

/** 结果契约（引擎与宿主之间唯一的墙；上三层不认识具体语言）。 */
export interface Md2rRunResult {
  ok: boolean
  kind: string
  stdout: string
  text: string
  error?: string
  /** query 原型的结构化行列。 */
  rows?: unknown[]
  /** 图捕获（base64 data URL 或文件路径，由 runner 决定）。 */
  images?: string[]
  session?: Md2rSessionInfo
  job?: Md2rJobInfo
}

/** 执行日志条目（章作用域 ▶ 序列）。 */
export interface Md2rJournalEntry {
  n: number
  family: string
  line: number
  hash: string
  ok: boolean
  ts: number
  /** 执行来源：run / replay / trace。 */
  src: string
}

/** 作业完成结局（job.done 兑现值）。 */
export interface Md2rJobOutcome {
  code?: number
  signal?: string | null
  killed?: boolean
  durationMs?: number
  error?: string
}

/**
 * main → renderer 推送事件（通道 mt::mdcode2run::event）。
 * started/chunk/done 与引擎 EventEmitter 的三事件一一对应；job-done 是
 * 作业异步完成时 main 补推的。
 */
export type Md2rEvent =
  | { docPath: string; type: 'started'; family: string; line: number }
  | {
    docPath: string
    type: 'chunk'
    family: string
    line: number
    stream: string
    text: string
  }
  | {
    docPath: string
    type: 'done'
    family: string
    line: number
    ok: boolean
    duration: number
    error?: string
  }
  | { docPath: string; type: 'job-done'; id: string; outcome: Md2rJobOutcome }
