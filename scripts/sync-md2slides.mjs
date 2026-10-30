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
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
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
