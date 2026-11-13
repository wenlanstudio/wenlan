import { tmpdir } from 'os'
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Md2rTraceEntry } from '@shared/types/mdcode2run'
import {
  ENGINE_DISPOSE_DELAY_MS,
  acquireEngine,
  disposeAllEngines,
  disposeEngine,
  setTeacherTrace,
  teacherTraceOf,
  unwatchEngine,
  watchEngine
} from '../../../src/main/mdcode2run/registry'

/**
 * P1 教学接线：宿主侧「双源分离」的护栏（mdcode2run docs/MR-EXECUTOR.md §11）。
 *
 * 引擎自己已用 14 项单测钉住算法；这里钉的是 wenlan 注册表这一层最容易漏的
 * 两件事：
 *   ① 教师录制 trace 只进只读定序序列，绝不写 journal；
 *   ② 引擎实例 60s 宽限回收后重建，发布物下发的定序序列不能丢（丢了步骤
 *      顺序就静默退回学生自己的执行记录，整条 P1 验收链报废）。
 * 以及 ③ stepsOf 过注册表实例后仍按教师序列定序、executed 只认学生记录。
 */

const docPath = (): string =>
  path.join(tmpdir(), `md2r-p1-${Date.now()}-${Math.random().toString(36).slice(2)}.md`)

const entry = (line: number, n: number): Md2rTraceEntry => ({
  ch: 0,
  n,
  family: 'bash',
  line,
  hash: 'h',
  ok: true,
  ts: n,
  src: 'run'
})

/** 文档序 a(行1) → b(行5)；教师录制序列故意反过来 b → a。 */
const MD = [
  '<!--step id=a name="A" point=7-->', // 0
  '```bash', // 1
  'echo a',
  '```',
  '<!--step id=b name="B" point=3-->', // 4
  '```bash', // 5
  'echo b',
  '```'
].join('\n')

describe('mdcode2run P1 教学接线（宿主侧双源分离）', () => {
  beforeEach(() => {
    vi.useRealTimers()
    disposeAllEngines()
  })

  it('装载教师序列只进只读定序源，不写 journal / 不落 sidecar', () => {
    const p = docPath()
    const teacher = [entry(5, 1), entry(1, 2)]
    const result = setTeacherTrace(p, teacher)

    expect(result).toMatchObject({ ok: true, count: 2 })
    expect(teacherTraceOf(p).map((e) => e.line)).toEqual([5, 1])
    const { engine } = acquireEngine(p)
    // 教师序列绝不并进 journal：否则 steps[].executed 恒真、守卫形态②恒拦。
    expect(engine.traceEntries()).toEqual([])
    expect(engine.localRuns()).toEqual([])
  })

  it('坏 JSONL 装载失败并清掉旧序列，不留过期定序源', () => {
    const p = docPath()
    expect(setTeacherTrace(p, [entry(5, 1)]).ok).toBe(true)
    const bad = setTeacherTrace(p, '{"v":999,"doc":"x"}\nnot-json\n')
    expect(bad.ok).toBe(false)
    expect(teacherTraceOf(p)).toEqual([])
  })

  it('无人观看的宽限回收后重建实例，教师序列原样注回', () => {
    vi.useFakeTimers()
    const p = docPath()
    const teacher = [entry(5, 1)]
    setTeacherTrace(p, teacher)
    const before = acquireEngine(p).engine

    watchEngine(p, 11)
    unwatchEngine(p, 11)
    vi.advanceTimersByTime(ENGINE_DISPOSE_DELAY_MS)

    const after = acquireEngine(p).engine
    expect(after).not.toBe(before)
    expect(after.teacherTraceOf().map((e) => e.line)).toEqual([5])
  })

  it('显式关文档（dispose）清掉教师序列：换了发布物不该沿用旧定序', () => {
    const p = docPath()
    setTeacherTrace(p, [entry(5, 1)])
    expect(disposeEngine(p)).toBe(true)
    expect(acquireEngine(p).engine.teacherTraceOf()).toEqual([])
    expect(teacherTraceOf(p)).toEqual([])
  })

  it('null 清除序列；清除后 stepsOf 退回自己的执行记录（兼容旧宿主）', () => {
    const p = docPath()
    setTeacherTrace(p, [entry(5, 1)])
    expect(setTeacherTrace(p, null)).toMatchObject({ ok: true, count: 0 })
    expect(teacherTraceOf(p)).toEqual([])
    const { engine } = acquireEngine(p)
    expect(engine.stepsOf(MD).steps.map((s) => s.stepId)).toEqual(['a', 'b'])
  })

  it('stepsOf：顺序只认教师序列，executed 只认学生本地执行记录', () => {
    const p = docPath()
    setTeacherTrace(p, [entry(5, 1), entry(1, 2)])
    const { engine } = acquireEngine(p)

    // 教师录制序列 b→a，但教师跑过每一步都不该点亮学生的 executed。
    const byTeacher = engine.stepsOf(MD)
    expect(byTeacher.steps.map((s) => s.stepId)).toEqual(['b', 'a'])
    expect(byTeacher.steps.every((s) => !s.executed)).toBe(true)

    // 学生只在 a 的块上留过一条成功执行记录 → 只有 a.executed。
    const localRuns = [entry(1, 1)]
    const byStudent = engine.stepsOf(MD, { localRuns })
    expect(byStudent.steps.map((s) => [s.stepId, s.executed])).toEqual([
      ['b', false],
      ['a', true]
    ])
    // 引擎侧 journal 仍是空的：覆盖项是单次查询入参，不是执行事实的来源。
    expect(engine.traceEntries()).toEqual([])
  })
})
