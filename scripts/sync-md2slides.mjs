#!/usr/bin/env node
/**
 * sync-md2slides.mjs — 把 md2slides 的 marktext 资产包同步进 desktop 的资源目录。
 *
 * ```sh
 * # 先在 md2slides 仓产包（build:host + pack 一步到位）
 * cd ../md2slides && npm run pack:marktext
 * # 再同步（本仓根目录）
 * node scripts/sync-md2slides.mjs
 * ```
 *
 * 产物 packages/desktop/resources/md2slides/ 不进 git（.gitignore）；main 进程的
 * md2slides IPC（src/main/ipc/md2slides.ts）按这份布局 require server.js 并把整包
 * 挂到本地服务的 `/` 下。deck 页面（deck.html + dist/deck-full.js）、主题、KaTeX
 * 字体、图表运行时全从这里出。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = resolve(here, '..', '..', 'md2slides', 'out', 'marktext')
const dest = resolve(here, '..', 'packages', 'desktop', 'resources', 'md2slides')

if (!existsSync(resolve(src, 'deck.html')) || !existsSync(resolve(src, 'server.js'))) {
  console.error(`资产包不完整：${src}`)
  console.error('先在 md2slides 仓跑 npm run pack:marktext（会先 build:host 再打包）')
  process.exit(1)
}

rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })
cpSync(src, dest, { recursive: true })
console.log(`md2slides 资产包已同步 → ${dest}`)

// M4.2：分页决策内核（md2slides 产包 lib/layout-core.js，纯函数零 DOM）
// vendor 进 renderer 源树——单源在 md2slides，本仓只读；纸叶 v2 块内切分
// 与 deck 共用同一份策略合同（view-model §5 / M4）。改动内核 → 在 md2slides
// 跑 npm run pack:marktext → 重跑本脚本，vendor 文件随包再生。
const vendorSrc = resolve(src, 'lib', 'layout-core.js')
if (!existsSync(vendorSrc)) {
  console.error('资产包缺 lib/layout-core.js——md2slides 侧 pack:marktext 太旧，请重新产包')
  process.exit(1)
}
const vendorDestDir = resolve(
  here, '..', 'packages', 'desktop', 'src', 'renderer', 'src', 'vendor', 'md2slides'
)
mkdirSync(vendorDestDir, { recursive: true })
const banner =
  '// VENDORED — source: md2slides core/paginate/layout-core.js（勿手改；\n' +
  '// 在 md2slides 跑 `npm run pack:marktext` 后重跑 scripts/sync-md2slides.mjs 再生）\n'
// CJS → ESM：单源仓保持 CJS（deck 打包链吃它），vendored 副本必须转 ESM——
// dev 下 vite 对源码文件不做 CJS 互操（生产构建有 rollup 互操），具名导入
// 一个 module.exports 形态的源文件会让整个渲染器模块图在加载期炸掉（纯白）。
const body = readFileSync(vendorSrc, 'utf-8')
const esmBody = body.replace(/module\.exports\s*=\s*\{/, 'export {')
if (esmBody === body || /module\.exports/.test(esmBody)) {
  console.error('layout-core 的导出形态变了（非 module.exports = { … } 或转换后仍有残留）——')
  console.error('请相应更新本脚本的 CJS→ESM 转换与 renderer 侧消费方式')
  process.exit(1)
}
writeFileSync(resolve(vendorDestDir, 'layout-core.js'), banner + esmBody)
console.log(`layout-core 已 vendor（CJS→ESM）→ ${vendorDestDir}`)
