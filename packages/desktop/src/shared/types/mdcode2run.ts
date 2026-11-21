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
  /** 可执行（支持语言 + 可跑角色 + 无标注冲突；mr 文档的管线自营块恒 false）。 */
  runnable: boolean
  /** 围栏开启行（0 基）。 */
  line: number
  /** 围栏闭合后的下一行（0 基、不含）。 */
  end: number
  /** 块角色：code | demo | setup | file | invalid | todo（mr-job project 档占位块）。 */
  role: 'code' | 'demo' | 'setup' | 'file' | 'invalid' | 'todo'
  /** job 执行模式（异步启动 + 日志流 + 可终止）。 */
  job: boolean
  /** file= 物化的相对路径（file 角色时）。 */
  file: string | undefined
  /** file= 的作用域：chapter = 章临时目录；document = 相对文档所在目录（../）。 */
  fileScope: 'chapter' | 'document'
  /** 块级断言标注（expect=），非断言块为 undefined。 */
  expect: string | undefined
  /** mr-job project 档的 TODO 定位标注：{ class?, file?, method? }。 */
  todo: Md2rTodoSpec | null
  /** 该 TODO 块可回填（mr 体裁 + role=todo + 标注无冲突）。 */
  fillable: boolean
  /** 标注问题（未知/重复/冲突）；非空块只展示不执行。 */
  problems: string[]
  /** mr 文档：stage 片段的阶段名（map/reduce/combine/partition/driver），非片段恒 null。 */
  stage: string | null
  /** mr 文档：管线自营块（stage 片段 / job 提交块）——由 runDocument 消费，块级 ▶ 收口。 */
  mrOwned: boolean
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
  /** 文档体裁：mr = front-matter 带 mr-job: 段的 MapReduce 作业文档（docs/MR-EXECUTOR.md）。 */
  kind: 'mr' | 'generic'
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
 * mr 执行器（runDocument）的 RunReport——文档级结果契约，原样过 IPC（全 JSON 安全）。
 * 形状权威 = mdcode2run docs/MR-EXECUTOR.md §4.3；stage ∈ spec|collect|scaffold|validate|
 * build|submit|assert + 成功终态 done。
 */
export interface Md2rDiagnostic {
  level: 'error' | 'warn' | 'info'
  kind: string
  message: string
  file?: string
  line?: number
  /** 回映后的学生行号（织入产物的 file/line 之外的面向作者坐标）。 */
  studentLine?: number
}

export interface Md2rAssertRecord {
  kind: string
  passed: boolean
  expected?: string
  actual?: string
}

export interface Md2rRunReport {
  ok: boolean
  stage: string
  id: string
  scaffold: string
  mode: string
  diagnostics: Md2rDiagnostic[]
  asserts: Md2rAssertRecord[]
  job: {
    counters: Record<string, number>
    durationMs: number
    outputFiles: string[]
    bytes: number
    code?: number
    stdout?: string
    stderr?: string
  } | null
  artifacts: {
    workdir?: string
    sources?: string[]
    jar?: string | null
    output?: string
  }
  /** P1：按教师录制 trace 序聚合的步骤事实（attachSteps 在 runDocument 返回前附上）。 */
  steps?: Md2rStepRecord[]
}

/** runDocument 的 invoke 参数（事件流走既有 mt::mdcode2run::event，family="hadoop"）。 */
export interface Md2rRunDocumentOpts {
  docPath: string
  md: string
  timeoutMs?: number
  compileOnly?: boolean
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

// =================================================================
// P1 教学接线：双源分离（教师录制 trace 定序 / 学生执行记录给事实）
// 形状权威 = mdcode2run docs/MR-EXECUTOR.md §11、DESIGN.md §11
// =================================================================

/** TODO 占位块的定位标注（仅 mr-job project 档）。 */
export interface Md2rTodoSpec {
  class?: string
  file?: string
  method?: string
}

/** 学生工程文件（宿主可直接传入，免 main 重复读目录）。 */
export interface Md2rProjectFile {
  path: string
  content: string
}

/** journal / trace 的扁平条目：ch=-1 是文档级整份作业运行（src="document"）。 */
export interface Md2rTraceEntry {
  ch: number
  n: number
  family: string
  line: number
  hash: string
  ok: boolean
  ts: number
  /** run | replay | trace | document。 */
  src: string
}

/** 步骤执行事实摘要（runs/okCount 是记录条数，不是块数）。 */
export interface Md2rStepOutputSummary {
  runs: number
  okCount: number
  lastTs: number
}

/** RunReport.steps / steps 查询的单条步骤事实（只报事实，不算分）。 */
export interface Md2rStepRecord {
  stepId: string
  name: string
  point: number
  blockLines: number[]
  todoLines: number[]
  asserts: Md2rAssertRecord[]
  /** 学生本地执行记录里该步存在 ok:true 条目；教师录制 trace 不点亮它。 */
  executed: boolean
  outputSummary: Md2rStepOutputSummary
}

export interface Md2rStepsResult {
  steps: Md2rStepRecord[]
  problems: string[]
}

/** 通过判定：断言全过 **且** 有成功执行记录（参考布尔，引擎不计分）。 */
export interface Md2rStepVerdict {
  stepId: string
  assertsTotal: number
  assertsPassed: number
  executed: boolean
  passed: boolean
  reasons: string[]
}

export interface Md2rGuardDiagnostic {
  kind: 'guard-project' | 'guard-trace' | string
  message: string
}

export interface Md2rGuardSuspicious {
  kind: 'todo-no-class' | 'extra-class' | string
  line?: number
  file?: string | null
  name?: string
  path?: string
  message?: string
}

/** 提前做守卫结果：往后看第 i+1..n 步是否已被做掉（只查事实，不比代码/md 文本）。 */
export interface Md2rGuardResult {
  blocked: boolean
  laterStepIds: string[]
  diagnostics: Md2rGuardDiagnostic[]
  suspicious: Md2rGuardSuspicious[]
  verdict: Md2rStepVerdict | null
  problems: string[]
}

/** TODO 回填一条：status 四种，missing/invalid 不带 path/sourceHash/code。 */
export interface Md2rTodoFill {
  line: number
  path?: string
  status: 'filled' | 'fallback' | 'missing' | 'invalid'
  sourceHash?: string
  stale: boolean
  todo: Md2rTodoSpec
  code?: string
}

/** fillTodos 结果：回填后的讲义（仅留存，不参与判分）+ 填充清单 + 工程目录。 */
export interface Md2rFillResult {
  md: string
  fills: Md2rTodoFill[]
  problems: string[]
  dir: string
}

/** 实验报告 = 讲义 + 全部 TODO 回填后的自包含 md。 */
export interface Md2rLabReport {
  md: string
  problems: string[]
}

/** setTeacherTrace 的装载回执。 */
export interface Md2rTeacherTraceResult {
  ok: boolean
  count: number
  bad?: number
  error?: string
}

/** 双源只读视图：teacher=教师录制序列，local=学生执行事实，all=整条 journal 时间线。 */
export interface Md2rTraceState {
  teacher: Md2rTraceEntry[]
  local: Md2rTraceEntry[]
  all: Md2rTraceEntry[]
}

// —— 六个 P1 查询的 invoke 参数 ——

export interface Md2rSetTeacherTraceOpts {
  docPath: string
  /** JSONL 文本、条目数组，或 null/空串清除。教师机与学生机路径不同，不做归属校验。 */
  source: string | Md2rTraceEntry[] | null
}

export interface Md2rTraceStateOpts {
  docPath: string
  chapterLine?: number
}

/** 单次可覆盖两源（离线回放/单测用）；日常不传，用引擎实例里的状态。 */
export interface Md2rStepSourceOverride {
  teacherTrace?: Md2rTraceEntry[]
  localRuns?: Md2rTraceEntry[]
  assertsByStep?: Record<string, Md2rAssertRecord[]>
}

export interface Md2rStepsOpts extends Md2rStepSourceOverride {
  docPath: string
  md: string
}

export interface Md2rGuardOpts extends Md2rStepSourceOverride {
  docPath: string
  md: string
  stepId: string
  /** 宿主已读过工程时直接传，免 main 再扫一遍目录。 */
  projectFiles?: Md2rProjectFile[]
}

export interface Md2rFillTodosOpts {
  docPath: string
  md: string
  /** 上次回填的 fills，用于把工程文件变更标 stale。 */
  previous?: Md2rTodoFill[]
  projectFiles?: Md2rProjectFile[]
}

export interface Md2rLabReportOpts {
  docPath: string
  md: string
  previous?: Md2rTodoFill[]
  projectFiles?: Md2rProjectFile[]
}

// =================================================================
// 引擎层配置（~/.wenlan/mdcode2run.json）：秘密与机器相关参数只放这层，
// 讲义 front-matter 无权指定。设置面板「代码执行环境」读写此 JSON。
// =================================================================

/** 引擎层配置的一族（语言族或 mr 执行器的三路径）。键自由，值标量。 */
export type Md2rEngineFamilyConfig = Record<string, unknown>

/** 引擎层配置全文：family → { KEY: value }。`secrets` 给 preset ${NAME} 取真值。 */
export type Md2rEngineConfig = Record<string, Md2rEngineFamilyConfig>

/** 只读环境探测结果（跟随系统变量 / PATH / 内置默认，面板展示用，不可编辑）。 */
export interface Md2rDetectedEnv {
  /** 系统 HADOOP_HOME（未设为空串）；原生层 bin 固定与之同目录。 */
  hadoopHome: string
  /** 自动探测到的 Graphviz dot 可执行文件（未找到为空串）。 */
  dotPath: string
  /** PlantUML 渲染服务地址（内置默认）。 */
  plantumlServer: string
}

/** 读当前引擎配置（含自动探测打底，如 Python 解释器路径）。 */
export interface Md2rGetEngineConfigResult {
  /** 配置文件的绝对路径（面板展示用，只读）。 */
  path: string
  /** 合并后的引擎配置（探测 + 文件覆盖）。 */
  config: Md2rEngineConfig
  /** 配置文件里原始落盘内容（面板编辑的起点，不含探测结果）。 */
  saved: Md2rEngineConfig
  /** 只读环境探测：Hadoop / Graphviz dot / PlantUML。 */
  detected: Md2rDetectedEnv
}

/** 写回引擎配置。merge 到现有文件，不整文件覆盖。 */
export interface Md2rSetEngineConfigResult {
  ok: boolean
  error?: string
}
