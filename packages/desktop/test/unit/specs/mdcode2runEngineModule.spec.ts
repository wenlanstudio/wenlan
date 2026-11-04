import { tmpdir } from 'os'
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createEngine, type MdcodeEngine } from 'mdcode2run'
import {
  ENGINE_DISPOSE_DELAY_MS,
  acquireEngine,
  attachJob,
  disposeAllEngines,
  disposeEngine,
  setEventSink,
  stopJob,
  unwatchAllFor,
  unwatchEngine,
  watchEngine
} from '../../../src/main/mdcode2run/registry'

/**
 * 钉死 mdcode2run git 依赖（wenlanstudio/mdcode2run）的模块形状与注册表行为。
 *
 * 第一段沿用 md2slidesServerModule.spec 的思路：main 进程按
 * `{ createEngine }` 解构、按 engine.parse/locate/run/... 消费——引擎升级若
 * 改了形状，这里先红，别等真机开窗才炸。
 *
 * 第二段测注册表（src/main/mdcode2run/registry，零 electron 依赖）：
 * 引擎实例按文档路径锚定、watcher 离场延迟回收、作业句柄投影。
 */

const MD = [
  '# 一章', // 0
  '', // 1
  '```python', // 2
  'print(1)', // 3
  '```', // 4
  '', // 5
  '```bash demo', // 6
  'ls ~', // 7
  '```' // 8
].join('\n')

const docPath = (): string =>
  path.join(tmpdir(), `md2r-spec-${Date.now()}-${Math.random().toString(36).slice(2)}.md`)

describe('mdcode2run 引擎模块形状（git 依赖契约）', () => {
  it('exports { createEngine } as a function', () => {
    expect(typeof createEngine).toBe('function')
  })

  it('engine 暴露 main 进程消费的全部方法', () => {
    const engine = createEngine({ documentPath: docPath(), documentDir: tmpdir() })
    for (const fn of ['parse', 'locate', 'run', 'resetSession', 'dispose', 'journalOf', 'traceOf']) {
      expect(
        typeof (engine as unknown as Record<string, unknown>)[fn],
        `engine.${fn}`
      ).toBe('function')
    }
    expect(typeof engine.events.on).toBe('function')
    engine.dispose()
  })

  it('parse 块视图：role/runnable/0 基行号（IPC 序列化的前提）', () => {
    const engine = createEngine({ documentPath: docPath(), documentDir: tmpdir() })
    const parsed = engine.parse(MD)
    expect(
      (parsed.blocks as Array<Record<string, unknown>>).map(b => [
        b['line'],
        b['lang'],
        b['role'],
        b['runnable']
      ])
    ).toEqual([
      [2, 'python', 'code', true],
      [6, 'bash', 'demo', false]
    ])
    expect(parsed.chapters[0]!.line).toBe(0)
    engine.dispose()
  })

  it('locate：块体内 0 基行命中、demo 角色返回 null', () => {
    const engine = createEngine({ documentPath: docPath(), documentDir: tmpdir() })
    const ctx = engine.locate(MD, { line: 3 })
    expect(ctx?.family).toBe('python')
    expect(engine.locate(MD, { line: 7 })).toBeNull()
    engine.dispose()
  })

  it('run 结果契约失败（缺 Python 配置）不抛异常、形状完整', async() => {
    const engine: MdcodeEngine = createEngine({
      documentPath: docPath(),
      documentDir: tmpdir()
    })
    const ctx = engine.locate(MD, { line: 3 })
    const result = await engine.run(ctx!)
    expect(result.ok).toBe(false)
    expect(typeof result.error).toBe('string')
    expect(result.error!.length).toBeGreaterThan(0)
    engine.dispose()
  })
})

describe('mdcode2run 引擎注册表', () => {
  beforeEach(() => {
    vi.useRealTimers()
    disposeAllEngines()
    setEventSink(null)
  })

  it('同一文档路径恒返回同一引擎实例；dispose 后重建', () => {
    const p = docPath()
    const a = acquireEngine(p)
    const b = acquireEngine(p)
    expect(a.engine).toBe(b.engine)

    expect(disposeEngine(p)).toBe(true)
    expect(disposeEngine(p)).toBe(false) // 已回收，幂等

    const c = acquireEngine(p)
    expect(c.engine).not.toBe(a.engine)
  })

  it('最后一个 watcher 离场后延迟回收；宽限期内重新 watch 则取消', () => {
    vi.useFakeTimers()
    const p = docPath()
    const engine = watchEngine(p, 1).entry.engine
    watchEngine(p, 2)

    unwatchEngine(p, 1)
    vi.advanceTimersByTime(ENGINE_DISPOSE_DELAY_MS)
    // 还有 watcher 2：不该回收
    expect(acquireEngine(p).engine).toBe(engine)

    unwatchEngine(p, 2)
    vi.advanceTimersByTime(ENGINE_DISPOSE_DELAY_MS)
    // 全员离场且过了宽限期：回收，下次 acquire 是新实例
    expect(acquireEngine(p).engine).not.toBe(engine)
  })

  it('unwatchAllFor 把 webContents 从全部引擎摘掉（关窗/reload 路径）', () => {
    vi.useFakeTimers()
    const p1 = docPath()
    const p2 = docPath()
    const engine1 = watchEngine(p1, 7).entry.engine
    watchEngine(p2, 7)
    watchEngine(p1, 8)

    unwatchAllFor(7)
    vi.advanceTimersByTime(ENGINE_DISPOSE_DELAY_MS)

    // p1 还有 watcher 8 → 存活；p2 只剩 7（已摘）→ 回收重建
    expect(acquireEngine(p1).engine).toBe(engine1)
    expect(acquireEngine(p2).engine).not.toBe(engine1)
  })

  it('attachJob：函数留在 main，IPC 结果只剩 { id }；done 后句柄移除并推 job-done', async() => {
    const p = docPath()
    const { entry } = watchEngine(p, 1)
    const events: Array<Record<string, unknown>> = []
    setEventSink((e, ids) => {
      events.push({ ...e, ids })
    })

    let stopped = false
    const result = {
      ok: true,
      kind: 'job',
      stdout: '',
      text: '',
      job: {
        id: 'job-1',
        stop: (): void => {
          stopped = true
        },
        done: Promise.resolve({ code: 0, durationMs: 12 })
      }
    }
    const projected = attachJob(entry, result as never)
    expect(projected.job).toEqual({ id: 'job-1' })

    expect(stopJob(p, 'job-1')).toBe(true)
    expect(stopped).toBe(true)
    expect(stopJob(p, 'job-1')).toBe(false) // 已摘

    await vi.waitFor(() => {
      expect(events.some(e => e.type === 'job-done')).toBe(true)
    })
    const jobDone = events.find(e => e.type === 'job-done')!
    expect(jobDone.id).toBe('job-1')
    expect(jobDone.outcome).toMatchObject({ code: 0, durationMs: 12 })
  })

  it('引擎事件经 sink 转发给 watcher 列表', () => {
    const p = docPath()
    const { entry } = watchEngine(p, 42)
    const seen: Array<Record<string, unknown>> = []
    setEventSink((e, ids) => {
      seen.push({ ...e, ids })
    })

    entry.engine.events.emit('started', { family: 'python', line: 3 })
    entry.engine.events.emit('chunk', { family: 'python', line: 3, stream: 'stdout', text: 'hi' })

    expect(seen[0]).toMatchObject({ type: 'started', docPath: p, family: 'python', line: 3 })
    expect(seen[0]!.ids).toEqual([42])
    expect(seen[1]).toMatchObject({ type: 'chunk', stream: 'stdout', text: 'hi' })
  })
})
