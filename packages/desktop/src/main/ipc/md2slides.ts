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
      let startServer: StartServerFn
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        startServer = require(serverPath) as StartServerFn
      } catch {
        throw new Error(
          `md2slides 资产包不在：${serverPath}\n` +
            '先在 md2slides 仓跑 npm run pack:marktext，再跑 node scripts/sync-md2slides.mjs'
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
}
