import { existsSync } from 'fs'
import path from 'path'
import { app, ipcMain } from 'electron'

/**
 * md2slides 幻灯片视图（slides/present）的本地 deck 服务。
 *
 * 渲染进程全沙箱（nodeIntegration:false + sandbox:true），起不了任何服务；deck 页面
 * 也不能走 srcdoc（CSP `script-src 'self'` 拦内联脚本）。所以服务由 main 托管：
 * require vendored 资产包里的 server.js（md2slides 仓 host/server，CJS、自包含——
 * 只依赖 http/fs/path），把整个资产包挂在 `/` 前缀，deck 页面从 `origin + /deck.html`
 * 加载，自成一篇不受编辑器 CSP 约束的文档。设计与裁决：
 * md2slides 仓 `docs/design/integration-marktext.md` §5。
 *
 * 资产包经 `scripts/sync-md2slides.mjs` 从 `md2slides/out/marktext` 同步（先在
 * md2slides 仓跑 `npm run pack:marktext`）。这份目录是 gitignored 生成物：CI 由
 * `.github/actions/md2slides-assets` 产出，打包前 `check-md2slides-assets.mjs`
 * 把关——没它就会装出一个点「览 / 示」才报错的残包（v1.0.0 的 release 事故）。
 */

// 打包后的布局随 resources 走；dev / preview / e2e 从应用目录读。
// 注意：process.resourcesPath 本身已以 /resources 结尾，下面的 'resources' 是
// electron-builder.yml 里 extraResources 的 `to: resources`，两层不是笔误。
const md2slidesDir = path.join(
  app.isPackaged ? process.resourcesPath : app.getAppPath(),
  'resources',
  'md2slides'
)

/** 修复话术按运行环境分流：装了 release 的用户没法跑本仓的开发脚本。 */
const fixHint = (): string =>
  app.isPackaged
    ? '安装包不完整或已损坏——请重新下载安装最新版；若仍然出现，请把上面的路径和错误一起反馈。'
    : '本机缺 md2slides 资产包：在 md2slides 仓跑 `npm run pack:marktext`，再跑 `node scripts/sync-md2slides.mjs`。'

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const missingError = (what: string, entry: string): Error =>
  new Error(`md2slides ${what}缺失：${entry}\n${fixHint()}`)

const loadError = (what: string, entry: string, error: unknown): Error =>
  new Error(`md2slides ${what}加载失败：${entry}\n${describeError(error)}\n${fixHint()}`)

interface Md2sServerHandle {
  url: string
  close: () => Promise<void>
}

interface StartServerFn {
  (opts: {
    fontsDir: string
    allowRoots: string[]
    assets: Array<{ prefix: string; dir: string }>
  }): Promise<Md2sServerHandle>
}

interface Md2sExportErrorShape {
  message: string
  code?: string
}

interface ExportFromDataFn {
  (opts: {
    kind: 'image' | 'editable'
    out: string
    images?: string[]
    imagesDir?: string
    ir?: unknown
    media?: Array<{ name: string; dataUrl: string }>
    mediaDir?: string
    issues?: string[]
    onProgress?: (stage: string, done: number, total?: number) => void
  }): Promise<{ pages?: number; warnings?: string[] }>
}

/** M2 导出后端（vendored pptx.js = md2slides host/pptx）：进程内单例，构造时验资产。 */
type CreateExporterFn = (o: { libDir: string }) => { exportFromData: ExportFromDataFn }
let exporter: { exportFromData: ExportFromDataFn } | null = null

const loadExporter = (): { exportFromData: ExportFromDataFn } => {
  if (exporter) return exporter
  const entry = path.join(md2slidesDir, 'pptx.js')
  if (!existsSync(entry)) throw missingError('导出后端', entry)
  let create: CreateExporterFn
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(entry) as {
      createExporter?: CreateExporterFn
      default?: { createExporter?: CreateExporterFn }
    }
    create = (mod.createExporter ?? mod.default?.createExporter) as CreateExporterFn
  } catch (error) {
    // 原样带出底层错误：以前统一报「资产包不在」，把 require 内部异常也吞了。
    throw loadError('导出后端', entry, error)
  }
  if (typeof create !== 'function') {
    throw new Error(`md2slides 导出后端形状不对（没有 createExporter）：${entry}\n${fixHint()}`)
  }
  exporter = create({ libDir: path.join(md2slidesDir, 'lib') })
  return exporter
}

let server: Md2sServerHandle | null = null
let currentRootsKey = ''

const rootsKey = (roots: string[]): string => [...roots].sort().join('\n')

export const registerMd2slidesHandlers = (): void => {
  ipcMain.handle(
    'mt::md2slides::server',
    async(
      _e,
      opts: { action: 'start' | 'stop'; allowRoots?: string[] }
    ): Promise<{ running: boolean; origin: string | null }> => {
      if (!opts || (opts.action !== 'start' && opts.action !== 'stop')) {
        throw new Error('Invalid md2slides server request')
      }

      if (opts.action === 'stop') {
        await server?.close()
        server = null
        currentRootsKey = ''
        return { running: false, origin: null }
      }

      // 同一份白名单直接复用（放映中防抖重建不动服务）；换文档（allowRoots 变了）
      // 才重启——端口会变，渲染进程拿新 origin 重挂 iframe。
      const allowRoots = (opts.allowRoots ?? []).filter(Boolean)
      const key = rootsKey(allowRoots)
      if (server && key === currentRootsKey) {
        return { running: true, origin: server.url }
      }
      await server?.close()

      // 计算路径的 require：打包器无法静态分析，原样留在 CJS 产物里；缺包时给出
      // 人话（安装包不完整，而不是一句 "Cannot find module"）。
      const serverPath = path.join(md2slidesDir, 'server.js')
      if (!existsSync(serverPath)) throw missingError('资产包', serverPath)
      let startServer: StartServerFn | undefined
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require(serverPath) as {
          startServer?: StartServerFn
          default?: { startServer?: StartServerFn }
        }
        startServer = mod.startServer ?? mod.default?.startServer
      } catch (error) {
        throw loadError('资产包', serverPath, error)
      }
      if (typeof startServer !== 'function') {
        throw new Error(
          `md2slides 资产包里的 server.js 没导出 startServer：${serverPath}\n${fixHint()}`
        )
      }

      server = await startServer({
        fontsDir: path.join(md2slidesDir, 'katex', 'fonts'),
        allowRoots,
        // 资产包整体挂 "/"：deck.html、dist/deck-full.js、themes、lib、assets.json。
        // /fonts/ 与 /f?p= 是 server.js 内建端点（字体 + 白名单图片）。
        assets: [{ prefix: '/', dir: md2slidesDir }]
      })
      currentRootsKey = key
      return { running: true, origin: server.url }
    }
  )

  // M2 一键导出：取数（renderer 经 deck 页面 postMessage 完成）之后在这里出片。
  // pptxgenjs / Python sidecar 只在 main 进程能跑——renderer 沙箱里没有 Node。
  ipcMain.handle(
    'mt::md2slides::export',
    async(
      _e,
      opts: {
        kind: 'image' | 'editable'
        out: string
        imagesDir?: string
        pages?: number
        ir?: unknown
        mediaDir?: string
        issues?: string[]
      }
    ): Promise<{ ok: true; pages?: number; warnings?: string[] } | { ok: false; error: string }> => {
      if (!opts || (opts.kind !== 'image' && opts.kind !== 'editable') || !opts.out) {
        return { ok: false, error: 'Invalid md2slides export request' }
      }
      try {
        const result = await loadExporter().exportFromData(opts)
        return { ok: true, ...result }
      } catch (error) {
        const shape = error as Md2sExportErrorShape
        const code = shape?.code ? `（${shape.code}）` : ''
        return { ok: false, error: `${shape?.message ?? String(error)}${code}` }
      }
    }
  )
}
