// Renderer-side global declarations: build-time defines (electron-vite
// `define` block in electron.vite.config.ts), the contextBridge surface
// exposed by src/preload/index.ts, and a handful of legacy globals that
// survived the sandbox migration.

import type {
  IpcInvokeChannels,
  IpcSendChannels,
  IpcSyncChannels,
  IpcMainEventChannels,
  BootInfo,
  PlantumlFetchResult,
  ExternalDiagramResult,
  SaveDialogRequest
} from '@shared/types/ipc'
import type { MenuTemplate, MenuPopupPosition, MenuStructureItem } from '@shared/types/menu'
import type { SerializedStat } from '@shared/types/files'
import type { Md2rEvent, Md2rJournalEntry, Md2rParseResult, Md2rRunResult } from '@shared/types/mdcode2run'

declare global {
  // ---- Build-time defines (electron-vite `define`) ----
  const MARKTEXT_VERSION: string
  const MARKTEXT_VERSION_STRING: string
  const __static: string

  // ---- contextBridge surface ----

  interface ElectronIpcRenderer {
    send<K extends keyof IpcSendChannels>(channel: K, ...args: IpcSendChannels[K]): void
    sendSync<K extends keyof IpcSyncChannels>(
      channel: K,
      ...args: IpcSyncChannels[K]['args']
    ): IpcSyncChannels[K]['ret']
    invoke<K extends keyof IpcInvokeChannels>(
      channel: K,
      ...args: IpcInvokeChannels[K]['args']
    ): Promise<IpcInvokeChannels[K]['ret']>
    on<K extends keyof IpcMainEventChannels>(
      channel: K,
      listener: (event: unknown, ...args: IpcMainEventChannels[K]) => void
    ): () => void
    once<K extends keyof IpcMainEventChannels>(
      channel: K,
      listener: (event: unknown, ...args: IpcMainEventChannels[K]) => void
    ): () => void
    removeAllListeners(channel: keyof IpcMainEventChannels | string): void
  }

  interface ElectronShellAPI {
    openExternal(url: string): Promise<void>
    showItemInFolder(fullPath: string): void
    openPath(fullPath: string): Promise<string>
  }

  interface ElectronClipboardAPI {
    writeText(text: string): void
    readText(): Promise<string>
    guessFilePath(): Promise<string | null>
    writeImage(png: Uint8Array): Promise<boolean>
  }

  interface ElectronDialogAPI {
    showSave(request: SaveDialogRequest): Promise<string | null>
  }

  interface ElectronWebFrameAPI {
    setZoomFactor(factor: number): void
    setZoomLevel(level: number): void
  }

  interface ElectronWebUtilsAPI {
    getPathForFile(file: File): string
  }

  interface ElectronWindowControlAPI {
    minimize(): void
    maximize(): void
    unmaximize(): void
    toggleMaximize(): void
    close(): void
    setFullScreen(flag: boolean): void
    toggleFullScreen(): void
    isMaximized(): Promise<boolean>
    isFullScreen(): Promise<boolean>
    popupMenu(template: MenuTemplate, position?: MenuPopupPosition): void
    popupApplicationMenu(position?: MenuPopupPosition): void
    getMenuStructure(): Promise<MenuStructureItem[]>
    executeMenuItem(id: string): void
  }

  interface ElectronAPI {
    ipcRenderer: ElectronIpcRenderer
    shell: ElectronShellAPI
    clipboard: ElectronClipboardAPI
    fetchLinkHtml(url: string): Promise<string>
    webFrame: ElectronWebFrameAPI
    webUtils: ElectronWebUtilsAPI
    process: {
      platform: NodeJS.Platform
      arch?: string
      versions: Record<string, string>
      env: Record<string, string>
      resourcesPath?: string
      cwd?: string
    }
    paths: Partial<BootInfo['paths']>
    isUpdatable: boolean
    windowControl: ElectronWindowControlAPI
    dialog: ElectronDialogAPI
  }

  interface DiagramAPI {
    fetchPlantuml(
      server: string,
      encoded: string,
      format: 'svg' | 'png'
    ): Promise<PlantumlFetchResult>
    renderExternal(type: string, code: string): Promise<ExternalDiagramResult>
  }

  interface FileUtilsAPI {
    isFile(p: string): Promise<boolean>
    isDirectory(p: string): Promise<boolean>
    emptyDir(p: string): Promise<void>
    copy(src: string, dest: string): Promise<void>
    copyWithContentHash(src: string, outputDir: string): Promise<string>
    ensureDir(p: string): Promise<void>
    outputFile(p: string, data: string | Uint8Array): Promise<void>
    move(src: string, dest: string): Promise<void>
    stat(p: string): Promise<SerializedStat>
    writeFile(p: string, data: string | Uint8Array): Promise<void>
    readFile(p: string, encoding?: string): Promise<string | Uint8Array>
    pathExists(p: string): Promise<boolean>
    unlink(p: string): Promise<void>
    readdir(p: string): Promise<string[]>
    isExecutable(p: string): Promise<boolean>
    isChildOfDirectory(dir: string, child: string): boolean
    hasMarkdownExtension(filename: string): boolean
    isSamePathSync(a: string, b: string, isNormalized?: boolean): boolean
    isImageFile(p: string): Promise<boolean>
    MARKDOWN_INCLUSIONS: string[]
  }

  interface PathAPI {
    basename(path: string, ext?: string): string
    dirname(path: string): string
    extname(path: string): string
    join(...paths: string[]): string
    resolve(...paths: string[]): string
    relative(from: string, to: string): string
    isAbsolute(path: string): boolean
    normalize(path: string): string
    parse(path: string): { root: string; dir: string; base: string; ext: string; name: string }
    format(pathObject: {
      root?: string
      dir?: string
      base?: string
      ext?: string
      name?: string
    }): string
    sep: string
    delimiter: string
  }

  interface CommandExistsAPI {
    exists(name: string): Promise<boolean>
  }

  interface I18nUtilsAPI {
    loadTranslations(language: string): Promise<Record<string, unknown>>
  }

  interface RipgrepAPI {
    start(req: unknown): Promise<{ searchId: string }>
    cancel(searchId: string): void
    onMatch(handler: (payload: unknown) => void): () => void
    onProgress(handler: (payload: unknown) => void): () => void
    onDone(handler: (payload: unknown) => void): () => void
    onError(handler: (payload: unknown) => void): () => void
    onCancelled(handler: (payload: unknown) => void): () => void
  }

  interface UploaderAPI {
    uploadImage(req: unknown): Promise<unknown>
  }

  interface FontsAPI {
    list(): Promise<string[]>
  }

  interface ProcessShim {
    platform: NodeJS.Platform
    arch?: string
    versions: Record<string, string>
    env: Record<string, string>
    resourcesPath?: string
    cwd: () => string | undefined
    nextTick: (fn: (...args: unknown[]) => void, ...args: unknown[]) => void
  }

  interface Window {
    electron: ElectronAPI
    fileUtils: FileUtilsAPI
    path: PathAPI
    commandExists: CommandExistsAPI
    i18nUtils: I18nUtilsAPI
    ripgrep: RipgrepAPI
    uploader: UploaderAPI
    fonts: FontsAPI
    diagram: DiagramAPI
    md2slides: {
      server(opts: { action: 'start' | 'stop'; allowRoots?: string[] }): Promise<
        { running: boolean; origin: string | null }
      >
      exportPptx(opts: {
        kind: 'image' | 'editable'
        out: string
        imagesDir?: string
        pages?: number
        ir?: unknown
        mediaDir?: string
        issues?: string[]
      }): Promise<
        | { ok: true; pages?: number; warnings?: string[] }
        | { ok: false; error: string }
      >
    }
    mdcode2run: {
      parse(opts: {
        docPath: string
        md: string
      }): Promise<Md2rParseResult>
      run(opts: {
        docPath: string
        md: string
        line: number
        replay?: boolean
        timeout?: number
      }): Promise<Md2rRunResult>
      resetSession(opts: { docPath: string; md: string; line: number }): Promise<boolean>
      journal(opts: {
        docPath: string
        chapterLine: number
      }): Promise<Md2rJournalEntry[]>
      dispose(opts: { docPath: string }): Promise<boolean>
      stopJob(opts: { docPath: string; jobId: string }): Promise<boolean>
      onEvent(listener: (event: Md2rEvent) => void): () => void
    }
    process: ProcessShim
    rgPath: string
    // Set by the legacy editor store at runtime; consumed by muya internals.
    DIRNAME: string
    // Read-only transaction diagnostics (sync-design M0). Installed by
    // renderer/src/sync/transactionHub.ts for e2e assertions and debugging.
    __wenlanSync?: {
      getSnapshot(): {
        docSessionId: string
        revision: number
        broadcastCount: number
        suppressedEchoes: number
        failedApplies: number
        origins: string[]
        pendingTxnId: string | null
        queueLength: number
      }
      getLog(): readonly unknown[]
      isStale(revision: number): boolean
      getIdentity(): {
        sessionId: string
        blockCount: number
        ambiguousCount: number
        lastReanchorMs: number
        blockIds: string[]
      }
      getProjection(): unknown
      getEditSession(): unknown
    }
    marktext?: {
      env?: { windowId: number; [key: string]: unknown }
      initialState?: {
        codeFontFamily?: string | null
        codeFontSize?: string | null
        hideScrollbar?: boolean
        theme?: string | null
        titleBarStyle?: string | null
        [key: string]: unknown
      }
      paths?: { ripgrepBinaryPath?: string; [key: string]: unknown }
      [key: string]: unknown
    }
  }
}

export {}
