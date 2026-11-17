/**
 * IPC channel contract — single source of truth for renderer↔main messaging.
 *
 * Four channel categories:
 *   - IpcInvokeChannels      : renderer → main, returns Promise<T>
 *   - IpcSendChannels        : renderer → main, fire-and-forget
 *   - IpcSyncChannels        : renderer → main, synchronous
 *   - IpcMainEventChannels   : main → renderer, push events (renderer .on)
 *
 * Channel names are typed strictly; argument and return shapes are
 * intentionally permissive (`unknown[]` / `unknown`) during the migration.
 * Concrete types tighten as each handler/caller converts in commits 5–8.
 *
 * To register a new channel:
 *   1. Add an entry to the appropriate interface here.
 *   2. Wire the handler in src/main (ipcMain.handle / ipcMain.on / webContents.send).
 *   3. Wire the caller via the typed preload bridge in src/preload/index.ts.
 */

import type { IKeyboardLayoutInfo, IKeyboardMapping } from 'native-keymap'
import type {
  MarkdownDocument,
  TabOptions,
  BootstrapEditorConfig,
  PageOptions,
  ExportType,
  SaveOptions,
  SerializedStat,
  LineEnding,
  FileChangeDetail,
  PandocExportPayload,
  UnsavedFile
} from './files'
import type { BufferedState as BufferedStateType } from './bufferedState'
import type { MenuTemplate, MenuPopupPosition, MenuStructureItem } from './menu'
import type { PandocCommandInfo } from './pandoc'
import type {
  Md2rEngineConfig,
  Md2rEvent,
  Md2rFillResult,
  Md2rFillTodosOpts,
  Md2rGetEngineConfigResult,
  Md2rGuardOpts,
  Md2rGuardResult,
  Md2rJournalEntry,
  Md2rLabReport,
  Md2rLabReportOpts,
  Md2rParseResult,
  Md2rRunDocumentOpts,
  Md2rRunReport,
  Md2rRunResult,
  Md2rSetEngineConfigResult,
  Md2rSetTeacherTraceOpts,
  Md2rStepsOpts,
  Md2rStepsResult,
  Md2rTeacherTraceResult,
  Md2rTraceState,
  Md2rTraceStateOpts
} from './mdcode2run'
import type {
  AuthLoginParams,
  AuthRequestOptions,
  AuthRequestResult,
  AuthActionResult,
  AuthState,
  TenantInfo
} from './auth'

export interface SaveDialogRequest {
  title?: string
  defaultPath?: string
  filters?: Array<{ name: string; extensions: string[] }>
}

export type PlantumlFetchResult =
  { ok: true; mime: string; data: Uint8Array } | { ok: false; error: string }

// =================================================================
// Invoke channels (renderer → main, returns Promise<T>)
// =================================================================

export type ExternalDiagramResult =
  { ok: true; mime: string; data: string } | { ok: false; error: string }

export interface IpcInvokeChannels {
  // ===== 教学客户端身份（edu-client E1）=====
  // 请求代理：renderer 永不接触 token，经 main 注入 Authorization + tenant-id。
  'auth::request': { args: [opts: AuthRequestOptions]; ret: AuthRequestResult }
  'auth::login': { args: [params: AuthLoginParams]; ret: AuthActionResult }
  'auth::logout': { args: []; ret: void }
  'auth::get-state': { args: []; ret: AuthState }
  'auth::list-tenants': { args: []; ret: TenantInfo[] }
  // 打开教学启动壳（E2 壳，B 方案后仅供机房/演示的进阶入口）
  'auth::open-teaching-window': { args: []; ret: void }
  // 课程工作区（E3.0）：位置存 main 偏好，renderer 只拿路径/触发打开。
  'teaching::get-projects-root': { args: []; ret: string }
  'teaching::open-projects-root': { args: [options?: { activateTab?: boolean }]; ret: string }
  'teaching::choose-projects-root': { args: []; ret: string | null }
  // E4 实验副本：落盘/保留判定 + 回填写回（路径 main 侧拼装，渲染端只给清洗前
  // 的 courseKey/文件名；写入只放行 sidecar 认识的 doc/ 下 .md）。
  'teaching::lab-copy-put': {
    args: [
      opts: {
        courseKey: string
        fileName: string
        content: string
        releaseId: number
        force?: boolean
      }
    ]
    ret: { docPath: string; kept: boolean }
  }
  'teaching::lab-doc-write': { args: [opts: { docPath: string; content: string }]; ret: boolean }
  // 课堂 ws：连接只存在于 main 进程，renderer 只能拿到脱敏后的事件帧。
  'teaching::ws-join': {
    args: [releaseId: number]
    ret: { ok: boolean; sessionId?: number; error?: string }
  }
  // 教师开班（复用进行中的会话）+ 进房。权限不足时 error 为服务端原话。
  'teaching::ws-host': {
    args: [releaseId: number]
    ret: { ok: boolean; sessionId?: number; error?: string }
  }
  // 课表命中自动开房（ADR-24 / M2c）：零参数幂等，判定权威在服务端。
  'teaching::ws-auto': {
    args: []
    ret: TeachingAutoResult
  }
  // 教师翻页 / 跟随锁：sessionId 由 main 记住，renderer 不传（防越权指定房间）。
  'teaching::ws-page': { args: [page: number]; ret: void }
  'teaching::ws-follow': { args: [locked: boolean]; ret: void }
  'teaching::ws-end': { args: [sessionId: number | null]; ret: void }
  'teaching::ws-leave': { args: []; ret: void }
  // 竞答（发题/收卷/作废）：上行为 fire-and-forget，结果一律由 `teaching::ws-message` 广播回来。
  // questions 例外——ret 报上行是否发出（2026-11-15 诚实化：失败不再伪装成空列表）
  'teaching::ws-race-questions': { args: []; ret: { ok: boolean; error?: string } }
  'teaching::ws-race-open': { args: [questionId: number, limitSec: number]; ret: { ok: boolean; error?: string } }
  'teaching::ws-race-close': { args: [openId: number]; ret: void }
  'teaching::ws-race-void': { args: [openId: number]; ret: void }
  // 学生作答：choice 为本班显示序下标；accepted 回执与 revealed 广播另走事件通道。
  'teaching::ws-race-answer': { args: [openId: number, choice: number]; ret: void }
  'mt::ask-for-image-path': { args: []; ret: string[] }
  'mt::boot-info-async': { args: []; ret: BootInfo }
  'mt::clipboard::guess-file-path': { args: []; ret: string | null }
  'mt::clipboard::read-text': { args: []; ret: string }
  'mt::link::fetch-html': { args: [url: string]; ret: string }
  // md2slides 幻灯片视图（slides/present）的本地 deck 服务：渲染进程沙箱里起不了
  // 服务，由 main 托管（vendored md2slides 资产包里的 server.js）。
  'mt::md2slides::server': {
    args: [opts: { action: 'start' | 'stop'; allowRoots?: string[] }]
    ret: { running: boolean; origin: string | null }
  }
  // mdcode2run 讲义代码执行引擎（git 依赖，main 托管）：块解析建 UI 用。
  'mt::mdcode2run::parse': {
    args: [opts: { docPath: string; md: string }]
    ret: Md2rParseResult
  }
  // 跑一块（或章重放）：结果契约返回；stdout/stderr 实时流走
  // mt::mdcode2run::event 推送（invoke 返回值没法流式）。
  'mt::mdcode2run::run': {
    args: [opts: { docPath: string; md: string; line: number; replay?: boolean; timeout?: number; src?: 'run' | 'replay' | 'trace' | 'present' }]
    ret: Md2rRunResult
  }
  // ⟳ 销毁第 line 行所在块的章会话（下次运行重建）。
  'mt::mdcode2run::reset-session': {
    args: [opts: { docPath: string; md: string; line: number }]
    ret: boolean
  }
  // 运行整份 mr-job 文档（体裁 kind="mr"）：织入 → 校验 → unit/local 后端 → asserts
  // → RunReport。流式日志走 mt::mdcode2run::event（family="hadoop"），终值以 invoke 为准。
  'mt::mdcode2run::run-document': {
    args: [opts: Md2rRunDocumentOpts]
    ret: Md2rRunReport
  }
  // 章执行日志（▶ 序列，供渲染端显示 ran #N / stale）。
  'mt::mdcode2run::journal': {
    args: [opts: { docPath: string; chapterLine: number }]
    ret: Md2rJournalEntry[]
  }
  // 宿主关文档：立即回收该文档的全部常驻会话。
  'mt::mdcode2run::dispose': {
    args: [opts: { docPath: string }]
    ret: boolean
  }
  // 停一个作业（run 结果里 job.id 捎回来）。
  'mt::mdcode2run::job-stop': {
    args: [opts: { docPath: string; jobId: string }]
    ret: boolean
  }
  // ── P1 教学接线：双源分离（MR-EXECUTOR §11）────────────────────────────
  // 教师录制 trace 随发布物下发：只读定序，不写 journal / sidecar / Replay。
  'mt::mdcode2run::set-teacher-trace': {
    args: [opts: Md2rSetTeacherTraceOpts]
    ret: Md2rTeacherTraceResult
  }
  // 两源只读视图：teacher=定序序列，local=学生执行事实，all=整条执行日志。
  'mt::mdcode2run::trace-state': {
    args: [opts: Md2rTraceStateOpts]
    ret: Md2rTraceState
  }
  // 步骤面板：按教师 trace 序聚合，executed 只认学生执行记录。
  'mt::mdcode2run::steps': {
    args: [opts: Md2rStepsOpts]
    ret: Md2rStepsResult
  }
  // 提交某步前的提前做守卫 + 通过判定（只查事实，锁序/计分归服务端）。
  'mt::mdcode2run::guard': {
    args: [opts: Md2rGuardOpts]
    ret: Md2rGuardResult
  }
  // TODO 回填（仅 project 档）与实验报告留存：只产出证据，不参与判分。
  'mt::mdcode2run::fill-todos': {
    args: [opts: Md2rFillTodosOpts]
    ret: Md2rFillResult
  }
  'mt::mdcode2run::lab-report': {
    args: [opts: Md2rLabReportOpts]
    ret: Md2rLabReport
  }
  // ── 引擎层配置（~/.wenlan/mdcode2run.json）：设置面板读写，秘密与机器参数 ──
  // 读：合并自动探测打底 + 文件覆盖，另带落盘原文供面板编辑。
  'mt::mdcode2run::get-engine-config': {
    args: []
    ret: Md2rGetEngineConfigResult
  }
  // 写：merge 到现有文件（不整文件覆盖，避免抹掉面板不认识的外族键）。
  'mt::mdcode2run::set-engine-config': {
    args: [patch: Md2rEngineConfig]
    ret: Md2rSetEngineConfigResult
  }
  // M2 一键导出的出片半边（取数在 renderer 经 deck 页面完成）。大位图走服务旁路
  // 落盘（/x），IPC 只传目录路径——数百 MB 过 invoke 会把进程挂死（真机教训）。
  'mt::md2slides::export': {
    args: [
      opts: {
        kind: 'image' | 'editable'
        out: string
        imagesDir?: string
        pages?: number
        ir?: unknown
        mediaDir?: string
        issues?: string[]
      }
    ]
    ret: { ok: true; pages?: number; warnings?: string[] } | { ok: false; error: string }
  }
  'mt::clipboard::write-image': { args: [png: Uint8Array]; ret: boolean }
  'mt::cmd::exists': { args: [name: string]; ret: boolean }
  'mt::diagram::fetch-plantuml': {
    args: [server: string, encoded: string, format: 'svg' | 'png']
    ret: PlantumlFetchResult
  }
  'mt::diagram::render-external': {
    args: [type: string, code: string]
    ret: ExternalDiagramResult
  }
  'mt::dialog::show-save': { args: [request: SaveDialogRequest]; ret: string | null }
  'mt::fonts::list': { args: []; ret: string[] }
  'mt::fs-trash-item': { args: [pathname: string]; ret: boolean }
  'mt::fs::copy': { args: [src: string, dest: string]; ret: void }
  'mt::fs::copy-with-content-hash': { args: [src: string, outputDir: string]; ret: string }
  'mt::fs::empty-dir': { args: [path: string]; ret: void }
  'mt::fs::ensure-dir': { args: [path: string]; ret: void }
  'mt::fs::is-directory': { args: [path: string]; ret: boolean }
  'mt::fs::is-executable': { args: [path: string]; ret: boolean }
  'mt::fs::is-file': { args: [path: string]; ret: boolean }
  'mt::fs::move': { args: [src: string, dest: string]; ret: void }
  'mt::fs::output-file': { args: [path: string, data: string | Uint8Array]; ret: void }
  'mt::fs::path-exists': { args: [path: string]; ret: boolean }
  'mt::fs::read-file': { args: [path: string, encoding?: string]; ret: string | Uint8Array }
  'mt::fs::readdir': { args: [path: string]; ret: string[] }
  'mt::fs::stat': { args: [path: string]; ret: SerializedStat }
  'mt::fs::unlink': { args: [path: string]; ret: void }
  'mt::fs::write-file': { args: [path: string, data: string | Uint8Array]; ret: void }
  'mt::i18n::is-supported': { args: [lang: string]; ret: boolean }
  'mt::i18n::load': { args: [language: string]; ret: Record<string, unknown> }
  'mt::i18n::supported': { args: []; ret: string[] }
  'mt::keybinding-get-keyboard-info': { args: []; ret: KeyboardInfo }
  'mt::keybinding-get-pref-keybindings': {
    args: []
    ret: { defaultKeybindings: Map<string, string>; userKeybindings: Map<string, string> }
  }
  'mt::keybinding-save-user-keybindings': { args: [bindings: unknown]; ret: boolean }
  // Snapshot of the window's application menu for the in-window menu bar.
  'mt::menu::get-structure': { args: []; ret: MenuStructureItem[] }
  'mt::pandoc::command': { args: []; ret: PandocCommandInfo }
  'mt::paths::is-image': { args: [path: string]; ret: boolean }
  'mt::rg::start': { args: [req: unknown]; ret: { searchId: string } }
  'mt::shell::open-external': { args: [url: string]; ret: void }
  'mt::shell::open-path': { args: [fullPath: string]; ret: string }
  'mt::spellchecker-get-available-dictionaries': { args: []; ret: string[] }
  'mt::spellchecker-get-custom-dictionary-words': { args: []; ret: string[] }
  'mt::spellchecker-remove-word': { args: [word: string]; ret: boolean }
  'mt::spellchecker-set-enabled': { args: [enabled: boolean]; ret: void }
  'mt::spellchecker-switch-language': { args: [language: string]; ret: void }
  'mt::uploader::upload': { args: [req: unknown]; ret: unknown }
  'mt::win::is-fullscreen': { args: []; ret: boolean }
  'mt::win::is-maximized': { args: []; ret: boolean }
  // Main derives the BrowserWindow via BrowserWindow.fromWebContents(e.sender);
  // no need to pass windowId. Payload is the editor+project+layout snapshot.
  'update-buffer-state': { args: [payload: unknown]; ret: void }
}

// =================================================================
// Send channels (renderer → main, fire-and-forget)
// =================================================================

export interface IpcSendChannels {
  'app-create-editor-window': [config?: unknown]
  'app-create-settings-window': []
  'app-open-directory-by-id': [windowId: number, dirPath: string]
  'app-open-file-by-id': [windowId: number, filePath: string, options?: unknown]
  'app-open-files-by-id': [windowId: number, filePaths: string[], options?: unknown]
  'app-open-markdown-by-id': [windowId: number, markdown: string, options?: unknown]
  'broadcast-preferences-changed': [partial: unknown]
  'broadcast-user-data-changed': [partial: unknown]
  'menu-add-recently-used': [filePath: string]
  'menu-clear-recently-used': []
  'mt::NEED_UPDATE': [payload?: unknown]
  'mt::add-recently-used-document': [filePath: string]
  'mt::app-try-quit': []
  'mt::ask-for-image-auto-path': [payload: unknown]
  'mt::ask-for-modify-image-folder-path': [imagePath?: string]
  'mt::ask-for-open-project-in-sidebar': []
  'mt::ask-for-user-data': []
  'mt::ask-for-user-preference': []
  'mt::check-for-update': []
  'mt::clipboard::write-text': [text: string]
  'mt::close-window': []
  'mt::close-window-confirm': [unsavedFiles: UnsavedFile[]]
  'mt::cmd-close-window': []
  'mt::cmd-import-file': []
  'mt::cmd-new-editor-window': []
  'mt::cmd-open-file': []
  'mt::cmd-open-folder': []
  'mt::cmd-toggle-autosave': []
  'mt::editor-selection-changed': [windowId: number, state: unknown]
  'mt::format-link-click': [payload: { data: unknown; dirname: string }]
  'mt::get-current-language': []
  'mt::handle-renderer-error': [error: unknown]
  'mt::keybinding-debug-dump-keyboard-info': []
  'mt::make-screenshot': []
  'mt::menu::popup': [template: MenuTemplate, position?: MenuPopupPosition]
  'mt::menu::popup-application': [position?: MenuPopupPosition]
  // Run one entry of the in-window menu bar, addressed by its menu id.
  'mt::menu::execute': [id: string]
  'mt::open-file': [filePath: string, options?: unknown]
  'mt::open-file-by-window-id': [windowId: number, filePath: string, options?: unknown]
  'mt::open-keybindings-config': []
  'mt::open-setting-window': []
  'mt::rename': [
    payload: { id: string; pathname: string; newPathname: string; currentFile?: unknown }
  ]
  'mt::request-keybindings': []
  'mt::set-editor-format-menus-enabled': [windowId: number, enabled: boolean]
  'mt::switch-directory': [directoryPath: string]
  'mt::response-export': [
    payload: {
      type: ExportType
      title: string
      content: string
      filename: string
      pathname: string
      pageOptions: PageOptions
    }
  ]
  'mt::response-file-move-to': [payload: { id: string; pathname: string }]
  'mt::response-file-save': [
    id: string,
    filename: string,
    pathname: string,
    markdown: string,
    options: SaveOptions,
    defaultPath: string
  ]
  'mt::response-file-save-as': [
    id: string,
    filename: string,
    pathname: string,
    markdown: string,
    options: SaveOptions,
    defaultPath: string
  ]
  'mt::response-pandoc-export': [payload: PandocExportPayload]
  'mt::response-print': []
  'mt::rg::cancel': [searchId: string]
  'mt::save-and-close-tabs': [tabs: unknown[]]
  'mt::save-tabs': [tabs: unknown[]]
  'mt::select-default-directory-to-open': []
  'mt::set-user-data': [partial: unknown]
  'mt::set-user-preference': [partial: unknown]
  'mt::shell::open-external': [url: string]
  'mt::shell::show-item': [fullPath: string]
  'mt::update-format-menu': [windowId: number, state: Record<string, boolean>]
  'mt::update-line-ending-menu': [windowId: number, lineEnding: LineEnding]
  'mt::update-sidebar-menu': [windowId: number, visible: boolean]
  'mt::view-layout-changed': [windowId: number, layout: unknown]
  'mt::win::close': []
  'mt::win::maximize': []
  'mt::win::minimize': []
  'mt::win::set-fullscreen': [flag: boolean]
  'mt::win::toggle-fullscreen': []
  'mt::win::toggle-maximize': []
  'mt::win::unmaximize': []
  'mt::window-add-file-path': [windowId: number, filePath: string]
  'mt::window-initialized': []
  'mt::window-tab-closed': [pathname: string]
  'mt::window-toggle-always-on-top': []
  'mt::window::drop': [payload: unknown]
  'screen-capture': [payload: unknown]
  'set-image-folder-path': [path: string]
  'set-user-preference': [partial: unknown]
  'watcher-unwatch-all-by-id': [windowId: number]
  'watcher-unwatch-directory': [windowId: number, path: string]
  'watcher-unwatch-file': [windowId: number, path: string]
  'watcher-watch-directory': [windowId: number, path: string]
  'watcher-watch-file': [windowId: number, path: string]
  'window-add-file-path': [windowId: number, filePath: string]
  'window-change-file-path': [windowId: number, oldPath: string, newPath: string]
  'window-close-by-id': [windowId: number]
  'window-file-saved': [windowId: number, tabId: string]
  'window-reload-by-id': [windowId: number]
  'window-toggle-always-on-top': [windowId: number]
}

// =================================================================
// Sync channels (synchronous renderer → main)
// =================================================================

export interface IpcSyncChannels {
  'mt::boot-info': { args: []; ret: BootInfo }
  'mt::paths::is-same-sync': { args: [a: string, b: string]; ret: boolean }
}

// =================================================================
// Push events (main → renderer, listened on ipcRenderer.on)
// =================================================================

export interface IpcMainEventChannels {
  // 登录态变化推送（main → 所有 renderer 窗口，含教学客户端窗口）
  'auth::state-changed': [state: AuthState]
  // 课堂 ws 下行帧：content 已在 main 反序列化，绝不含 token。
  'teaching::ws-message': [message: { type: string; content: Record<string, unknown> }]
  'teaching::ws-status': [status: { connected: boolean; sessionId: number | null }]
  'language-changed': [language: string]
  'mt::UPDATE_AVAILABLE': [info?: unknown]
  'mt::UPDATE_DOWNLOADED': [info?: unknown]
  'mt::UPDATE_ERROR': [error: unknown]
  'mt::UPDATE_NOT_AVAILABLE': [info?: unknown]
  'mt::about-dialog': []
  'mt::ask-for-close': []
  'mt::bootstrap-editor': [config: BootstrapEditorConfig]
  'mt::cm-copy-as-html': []
  'mt::cm-copy-as-rich': []
  'mt::cm-insert-paragraph': [direction: 'before' | 'after']
  'mt::cm-paste-as-plain-text': []
  'mt::current-language': [language: string]
  'mt::editor-ask-file-save': []
  'mt::editor-ask-file-save-as': []
  'mt::editor-close-tab': [tabId?: string]
  'mt::editor-edit-action': [action: string]
  'mt::editor-format-action': [payload: { type: string }]
  'mt::editor-move-file': []
  'mt::editor-paragraph-action': [payload: { type: string }]
  'mt::editor-rename-file': []
  'mt::editor-table-action': [payload: { type: string }]
  'mt::execute-command-by-id': [commandId: string]
  'mt::export-success': [payload: { type: string; filePath: string; linksMedia?: boolean }]
  'mt::export-with-pandoc': [target: string]
  'mt::file-saved': [tabId: string]
  'mt::force-close-tabs-by-id': [tabIds: string[]]
  'mt::invalidate-image-cache': []
  'mt::keybindings-response': [bindings: unknown]
  'mt::load-state': [state: BufferedStateType]
  'mt::menu::click': [menuId: string]
  'mt::menu::closed': []
  // mdcode2run 引擎事件转发（started/chunk/done/job-done），按 watcher 定向推送。
  'mt::mdcode2run::event': [payload: Md2rEvent]
  'mt::new-untitled-tab': [selected?: boolean, markdown?: string]
  'mt::sidebar::new-file-in-project': [templateKind: string]
  'mt::open-directory': [directoryPath: string, options?: { activateTab?: boolean }]
  'mt::open-new-tab': [
    markdownDocument: MarkdownDocument | null,
    options?: TabOptions,
    selected?: boolean
  ]
  'mt::pandoc-not-exists': [opts: Record<string, unknown>]
  'mt::print-service-clearup': []
  'mt::rg::cancelled': [payload: unknown]
  'mt::rg::done': [payload: unknown]
  'mt::rg::error': [payload: unknown]
  'mt::rg::match': [payload: unknown]
  'mt::rg::progress': [payload: unknown]
  'mt::screenshot-captured': [filePath: string]
  'mt::set-line-ending': [lineEnding: LineEnding]
  'mt::set-pathname': [payload: { id: string; pathname: string; filename: string }]
  'mt::set-view-layout': [layout: unknown]
  'mt::show-command-palette': []
  'mt::show-export-dialog': [type: ExportType]
  'mt::show-notification': [payload: unknown]
  'mt::spelling-replace-misspelling': [payload: unknown]
  'mt::spelling-show-switch-language': []
  'mt::switch-tab-by-file_path': [filePath: string, options?: TabOptions]
  'mt::switch-tab-by-index': [index: number]
  'mt::tab-save-failure': [tabId: string, message: string]
  'mt::tab-saved': [tabId: string]
  'mt::tabs-cycle-left': []
  'mt::tabs-cycle-right': []
  'mt::toggle-view-layout-entry': [entry: string]
  'mt::toggle-view-mode-entry': [entry: string]
  'mt::update-file': [payload: { type: 'add' | 'change' | 'unlink'; change: FileChangeDetail }]
  'mt::update-object-tree': [payload: unknown]
  'mt::user-preference': [partial: unknown]
  'mt::window-active-status': [active: boolean]
  'mt::window-enter-full-screen': []
  'mt::window-leave-full-screen': []
  'mt::window-maximize': []
  'mt::window-unmaximize': []
  'mt::window-zoom': [zoomLevel: number]
  'settings::change-tab': [tab: string]
}

// =================================================================
// Auxiliary types
// =================================================================

/**
 * Snapshot of the active OS keyboard layout, returned by
 * `mt::keybinding-get-keyboard-info`. Mirrors the runtime shape produced
 * by `native-keymap` (see `src/main/keyboard/index.ts#getKeyboardInfo`).
 */
export interface KeyboardInfo {
  layout: IKeyboardLayoutInfo
  keymap: IKeyboardMapping
}

export interface BootInfo {
  platform: NodeJS.Platform
  arch: string
  versions: Record<string, string>
  env: Record<string, string>
  paths: {
    resources: string
    userData: string
    cwd: string
    ripgrepBinary: string
  }
  isUpdatable: boolean
  MARKDOWN_INCLUSIONS: string[]
}

// =================================================================
// Helper types for the preload bridge generic wrappers
// =================================================================

export type InvokeArgs<K extends keyof IpcInvokeChannels> = IpcInvokeChannels[K]['args']
export type InvokeRet<K extends keyof IpcInvokeChannels> = IpcInvokeChannels[K]['ret']

export type SyncArgs<K extends keyof IpcSyncChannels> = IpcSyncChannels[K]['args']
export type SyncRet<K extends keyof IpcSyncChannels> = IpcSyncChannels[K]['ret']

export type SendArgs<K extends keyof IpcSendChannels> = IpcSendChannels[K]

export type EventArgs<K extends keyof IpcMainEventChannels> = IpcMainEventChannels[K]
