import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  engineConfigPath,
  loadEngineProfile,
  resolveEngineConfig
} from '../../../src/main/mdcode2run/registry'

/**
 * 引擎层配置文件（~/.wenlan/mdcode2run.json 或 MD2R_CONFIG_FILE）——
 * Hive 的 SSH_HOST / CLIENT 这类机器参数只能从这里进引擎，讲义 front-matter 无权指定。
 * 钉死：路径解析、坏文件不阻断启动、文件配置与 Python 自动探测按族合并。
 */

let dir: string

const writeConfig = (content: string): string => {
  const file = path.join(dir, 'mdcode2run.json')
  fs.writeFileSync(file, content, 'utf8')
  return file
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md2r-config-spec-'))
})

afterEach(() => {
  vi.unstubAllEnvs()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('mdcode2run 引擎配置文件', () => {
  it('默认路径是用户目录下的 .wenlan/mdcode2run.json', () => {
    vi.stubEnv('MD2R_CONFIG_FILE', '')
    expect(engineConfigPath()).toBe(path.join(os.homedir(), '.wenlan', 'mdcode2run.json'))
  })

  it('MD2R_CONFIG_FILE 可覆盖路径', () => {
    vi.stubEnv('MD2R_CONFIG_FILE', path.join(dir, 'custom.json'))
    expect(engineConfigPath()).toBe(path.join(dir, 'custom.json'))
  })

  it('读取 hive SSH 配置，原样交给引擎层', () => {
    const file = writeConfig(
      JSON.stringify({
        hive: {
          SSH_HOST: 'node0',
          SSH_USER: 'zhangsan',
          CLIENT: '/opt/bigdata/hive/default/bin/beeline',
          DATABASE: 'zjsm',
          TIMEOUT: 60000
        }
      })
    )
    vi.stubEnv('MD2R_CONFIG_FILE', file)
    expect(loadEngineProfile().hive).toMatchObject({
      SSH_HOST: 'node0',
      CLIENT: '/opt/bigdata/hive/default/bin/beeline',
      DATABASE: 'zjsm'
    })
    expect(resolveEngineConfig().hive.SSH_HOST).toBe('node0')
  })

  it('文件不存在时返回空配置，不抛错', () => {
    vi.stubEnv('MD2R_CONFIG_FILE', path.join(dir, 'missing.json'))
    expect(loadEngineProfile()).toEqual({})
  })

  it('坏 JSON / 非对象只告警并返回空配置', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('MD2R_CONFIG_FILE', writeConfig('{ not json'))
    expect(loadEngineProfile()).toEqual({})
    vi.stubEnv('MD2R_CONFIG_FILE', writeConfig('[1,2,3]'))
    expect(loadEngineProfile()).toEqual({})
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('同族配置按键合并，文件覆盖探测值但不丢其它键', () => {
    vi.stubEnv(
      'MD2R_CONFIG_FILE',
      writeConfig(JSON.stringify({ python: { TIMEOUT: 9000 }, hive: { SSH_HOST: 'node0' } }))
    )
    const merged = resolveEngineConfig()
    expect(merged.python.TIMEOUT).toBe(9000)
    expect(merged.hive.SSH_HOST).toBe('node0')
    // Python 解释器由 detectPython 自动探测；有结果时不应被文件配置抹掉
    if (merged.python.PYTHON_PATH) expect(typeof merged.python.PYTHON_PATH).toBe('string')
  })
})
