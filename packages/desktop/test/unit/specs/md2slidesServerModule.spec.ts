import path from 'path'
import { describe, expect, it } from 'vitest'

/**
 * 钉死 main 进程 md2slides IPC 的一个前提：vendored 资产包里的 server.js 必须以
 * `{ startServer }` 形状导出（handler 里就是这么解构的）。2026-10-31 真机翻过车——
 * handler 把整个模块对象当函数调（"startServer is not a function"），此 spec 让
 * 模块形状与解构方式从此绑在一起变。
 *
 * 资产包是本地生成物（scripts/sync-md2slides.mjs，gitignore）：没同步时跳过，
 * 同步了就必须过。
 */
describe('md2slides vendored server module', () => {
  const serverPath = path.resolve(__dirname, '../../../resources/md2slides/server.js')

  it.skipIf(!exists(serverPath))(
    'server.js exports { startServer } as a function',
    () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(serverPath) as Record<string, unknown>
      expect(typeof mod.startServer).toBe('function')
    }
  )
})

describe('md2slides vendored export backend module', () => {
  const pptxPath = path.resolve(__dirname, '../../../resources/md2slides/pptx.js')

  it.skipIf(!exists(pptxPath))(
    'pptx.js exports { createExporter } as a function (M2 export handler 解构前提)',
    () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(pptxPath) as Record<string, unknown>
      expect(typeof mod.createExporter).toBe('function')
    }
  )
})

function exists(p: string): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('node:fs').accessSync(p)
    return true
  } catch {
    return false
  }
}
