#!/usr/bin/env node
/**
 * check-md2slides-assets.mjs — 打安装包前的 md2slides 资产完整性闸门。
 *
 * `packages/desktop/resources/` 是 .gitignore 的生成物（scripts/sync-md2slides.mjs
 * 从 md2slides/out/marktext 同步）。electron-builder 的 extraResources 配的是
 * `from: resources → to: resources`：源目录不存在时它**静默跳过**，照样打出一个
 * 完整可安装、但一点「览 / 示」就报 `md2slides 资产包不在` 的残包。v1.0.0 的
 * release 就是这么翻的车——CI 从没跑过 sync，每台电脑装完都缺同一份文件。
 *
 * 所以：所有会调用 electron-builder 的 build:* 脚本、以及 CI 的 composite action，
 * 都在打包前跑本脚本。缺件直接 exit 1，把故障挡在发布之前。
 *
 * 用法：node scripts/check-md2slides-assets.mjs
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const assetsDir = resolve(here, '..', 'packages', 'desktop', 'resources', 'md2slides')
const vendorLayoutCore = resolve(
  here, '..', 'packages', 'desktop', 'src', 'renderer', 'src', 'vendor', 'md2slides', 'layout-core.js'
)
const require = createRequire(import.meta.url)

// main 进程真正会 require / 服务出去的东西，缺一不可。
const REQUIRED_FILES = [
  'server.js', // mt::md2slides::server
  'pptx.js', // mt::md2slides::export
  'deck.html', // 服务的页面壳
  'assets.json', // 主题 / 图表运行时清单
  'exec-present.js', // 本仓放映执行桥（sync 注入）
  'dist/deck-full.js',
  'katex/katex.min.css',
  'lib/mermaid.min.js',
  'lib/echarts.min.js',
  'lib/layout-core.js',
  'lib/pptxgenjs/package.json',
  'lib/sidecar/build_pptx.py'
]

const REQUIRED_NON_EMPTY_DIRS = [
  'themes',
  'katex/fonts',
  'lib/pptxgenjs/node_modules', // 导出后端的依赖闭包
  'lib/sidecar'
]

const problems = []
const at = (rel) => join(assetsDir, rel)

for (const rel of REQUIRED_FILES) {
  if (!existsSync(at(rel)) || !statSync(at(rel)).isFile()) problems.push(`缺文件：${rel}`)
}
for (const rel of REQUIRED_NON_EMPTY_DIRS) {
  if (!existsSync(at(rel)) || !statSync(at(rel)).isDirectory() || readdirSync(at(rel)).length === 0) {
    problems.push(`目录缺失或为空：${rel}`)
  }
}

if (!problems.length) {
  const deckHtml = readFileSync(at('deck.html'), 'utf-8')
  if (!deckHtml.includes('/exec-present.js')) {
    problems.push('deck.html 没注入 /exec-present.js（sync-md2slides.mjs 的注入步骤没跑？）')
  }
  if (!existsSync(vendorLayoutCore)) {
    problems.push('renderer vendor 缺 src/renderer/src/vendor/md2slides/layout-core.js')
  } else if (!readFileSync(vendorLayoutCore, 'utf-8').includes('export {')) {
    problems.push('renderer vendor 的 layout-core.js 不是 ESM（CJS→ESM 转换没跑？）')
  }

  // 形状校验：handler 假定 { startServer } / { createExporter }，模块加载失败也要在这里挡住。
  try {
    const server = require(at('server.js'))
    if (typeof server.startServer !== 'function') problems.push('server.js 没导出 startServer 函数')
  } catch (error) {
    problems.push(`server.js 加载失败：${error instanceof Error ? error.message : String(error)}`)
  }
  try {
    const pptx = require(at('pptx.js'))
    if (typeof pptx.createExporter !== 'function') problems.push('pptx.js 没导出 createExporter 函数')
  } catch (error) {
    problems.push(`pptx.js 加载失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

if (problems.length) {
  console.error(`✗ md2slides 资产包不完整：${assetsDir}`)
  for (const p of problems) console.error(`  - ${p}`)
  console.error('')
  console.error('本地修复：')
  console.error('  cd ../md2slides && npm run pack:marktext')
  console.error('  node scripts/sync-md2slides.mjs')
  console.error('CI 由 .github/actions/md2slides-assets 自动产包；这里失败说明产包/同步步骤没跑或失败了。')
  process.exit(1)
}

console.log(
  `✓ md2slides 资产包完整（${REQUIRED_FILES.length} 个关键文件 + ` +
    `${REQUIRED_NON_EMPTY_DIRS.length} 个目录 + 2 个 CJS 入口形状）→ ${assetsDir}`
)
