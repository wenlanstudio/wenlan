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
 * md2slides 仓跑 `npm run pack:marktext`）。
 */

// 打包后的布局随 resources 走；dev / preview / e2e 从应用目录读。
const md2slidesDir = path.join(
  app.isPackaged ? process.resourcesPath : app.getAppPath(),
  'resources',
  'md2slides'
)

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
  let create: CreateExporterFn
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(entry) as {
      createExporter?: CreateExporterFn
      default?: { createExporter?: CreateExporterFn }
    }
    create = (mod.createExporter ?? mod.default?.createExporter) as CreateExporterFn
  } catch {
    throw new Error(
      `md2slides 导出后端不在：${entry}\n` +
        '先在 md2slides 仓跑 npm run pack:marktext，再跑 node scripts/sync-md2slides.mjs'
    )
  }
  if (typeof create !== 'function') {
    throw new Error(`md2slides 导出后端形状不对（没有 createExporter）：${entry}\n请重跑 sync-md2slides.mjs`)
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
      // 人话（同步脚本没跑，而不是一句 "Cannot find module"）。
      const serverPath = path.join(md2slidesDir, 'server.js')
      let startServer: StartServerFn | undefined
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require(serverPath) as {
          startServer?: StartServerFn
          default?: { startServer?: StartServerFn }
        }
        startServer = mod.startServer ?? mod.default?.startServer
      } catch {
        throw new Error(
          `md2slides 资产包不在：${serverPath}\n` +
            '先在 md2slides 仓跑 npm run pack:marktext，再跑 node scripts/sync-md2slides.mjs'
        )
      }
      if (typeof startServer !== 'function') {
        throw new Error(
          `md2slides 资产包里的 server.js 没导出 startServer：${serverPath}\n` +
            '资产包可能损坏或版本不匹配——重跑 node scripts/sync-md2slides.mjs'
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
