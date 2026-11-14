/**
 * 「示」视图 ▶ 连接守卫（#18）——加载真实的 resources-src/md2slides/exec-present.js
 * （sync 注入 deck.html 的那份源文件），在 jsdom 里仿真 deck DOM + capability
 * 消息，钉住 pre→块 的三层匹配：
 *
 *   ① 整块全等（front-matter 剥离造成的坐标系错位，旧行号包含匹配会漏/挂错）；
 *   ② 分页续片 = 围栏体的整行子串（行号距离最近者消歧）；
 *   ③ 宿主未带 code 时退回旧行号区间兜底（行为兼容）。
 *
 * 点击 ▶ 断言发回宿主的 md2s:exec.line 是**原始 md** 的块开栏行——引擎按它
 * locate，挂错块 = 跑错代码。
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import execPresentSource from '../../../resources-src/md2slides/exec-present.js?raw'

type CapBlock = {
  line: number
  end: number
  runnable: boolean
  lang: string
  job: boolean
  replayable: boolean
  code?: string
}

const DOC_PATH = '/docs/lecture.md'

const makePre = (srcStart: number, codeText: string, lang = 'sql'): HTMLElement => {
  const pre = document.createElement('pre')
  pre.setAttribute('data-src-start', String(srcStart))
  const code = document.createElement('code')
  code.className = `language-${lang}`
  code.textContent = codeText
  pre.appendChild(code)
  document.body.appendChild(pre)
  return pre
}

const sendCapability = (blocks: CapBlock[], docPath = DOC_PATH): void => {
  const ev = new MessageEvent('message', {
    data: { type: 'md2s:exec-capability', docPath, enabled: true, blocks }
  })
  // jsdom 顶层 window 的 parent 是自身；source 显式钉上，防实现差异。
  Object.defineProperty(ev, 'source', { value: window })
  window.dispatchEvent(ev)
}

/** 点 ▶ 并等宿主收到 md2s:exec；返回 postMessage 捕获到的消息列表。 */
const clickRun = (pre: HTMLElement): Array<Record<string, unknown>> => {
  const sent: Array<Record<string, unknown>> = []
  const spy = vi.spyOn(window, 'postMessage').mockImplementation(((msg: unknown) => {
    sent.push(msg as Record<string, unknown>)
  }) as typeof window.postMessage)
  const btn = pre.querySelector('.md2s-exec-run:not(.md2s-exec-replay)') as HTMLElement | null
  expect(btn, '▶ 没有装饰到目标 pre 上').not.toBeNull()
  ;(btn as HTMLElement).click()
  spy.mockRestore()
  return sent
}

describe('exec-present ▶ 连接（#18 坐标系错位）', () => {
  beforeAll(() => {
    // IIFE 只评估一次：重复评估会重复注册 window message 监听，跨用例串台。
    new Function(execPresentSource)()
  })

  beforeEach(() => {
    document.body.innerHTML = ''
    sessionStorage.setItem('md2s-exec-confirmed', JSON.stringify([DOC_PATH]))
  })

  afterEach(() => {
    document.body.innerHTML = ''
    sessionStorage.removeItem('md2s-exec-confirmed')
    vi.restoreAllMocks()
  })

  it('front-matter 剥离的坐标系错位：整块全等命中各自的块，点击发回原始行号', () => {
    // 原始 md：0-2 行是 front-matter，fence1 开栏在 4（0 基）、fence2 在 7。
    // compose 剥掉 3 行 fm：fence1 开栏落在 composed 1 → data-src-start=2（1 基）。
    const pre1 = makePre(2, "SELECT DATEDIFF('2022-07-01', '2022-05-01');")
    const pre2 = makePre(5, 'SELECT 2;')
    const blocks: CapBlock[] = [
      { line: 4, end: 7, runnable: true, lang: 'sql', job: false, replayable: false, code: "SELECT DATEDIFF('2022-07-01', '2022-05-01');" },
      { line: 7, end: 10, runnable: true, lang: 'sql', job: false, replayable: false, code: 'SELECT 2;' }
    ]
    sendCapability(blocks)

    // 旧行号包含匹配下：pre1（composed 1）不在 [4,7) 里——▶ 压根不出现；
    // pre2（composed 4）落进 block1 的区间——▶ 挂错块。修复后各自命中。
    expect(clickRun(pre1)).toContainEqual(
      expect.objectContaining({ type: 'md2s:exec', docPath: DOC_PATH, line: 4, replay: false })
    )
    expect(clickRun(pre2)).toContainEqual(
      expect.objectContaining({ type: 'md2s:exec', line: 7, replay: false })
    )
  })

  it('分页续片（整行子串）：两片都连到同一块，行号都是块开栏行', () => {
    // 原始 md：fence 开栏 0、体 5 行、闭合 6。compose 后开栏 composed 0 →
    // data-src-start=1；续片 start = 1 + 3 + 1 = 5（exec-present 头注释口径）。
    const body = 'l0\nl1\nl2\nl3\nl4'
    const head = makePre(1, 'l0\nl1\nl2')
    const tail = makePre(5, 'l3\nl4')
    const blocks: CapBlock[] = [
      { line: 0, end: 7, runnable: true, lang: 'sql', job: false, replayable: false, code: body }
    ]
    sendCapability(blocks)

    expect(clickRun(head)).toContainEqual(expect.objectContaining({ type: 'md2s:exec', line: 0 }))
    expect(clickRun(tail)).toContainEqual(expect.objectContaining({ type: 'md2s:exec', line: 0 }))
  })

  it('宿主未带 code（旧宿主）：退回行号区间包含兜底', () => {
    const pre = makePre(1, 'SELECT 1;')
    const blocks: CapBlock[] = [
      { line: 0, end: 3, runnable: true, lang: 'sql', job: false, replayable: false }
    ]
    sendCapability(blocks)
    expect(clickRun(pre)).toContainEqual(expect.objectContaining({ type: 'md2s:exec', line: 0 }))
  })

  it('行中片段不冒充整行子串；多块都含切片时取行号距离最近者', () => {
    const pre = makePre(4, 'bar\nbaz')
    const blocks: CapBlock[] = [
      // block A：整行含 bar/baz，行号近（composed 3 vs line 2，距离 1）。
      { line: 2, end: 6, runnable: true, lang: 'sql', job: false, replayable: false, code: 'foo\nbar\nbaz' },
      // block B：只有行中片段 "xbar\nbaz y"——containsLineSlice 必须不认。
      { line: 10, end: 14, runnable: true, lang: 'sql', job: false, replayable: false, code: 'xbar\nbaz y' }
    ]
    sendCapability(blocks)
    expect(clickRun(pre)).toContainEqual(expect.objectContaining({ type: 'md2s:exec', line: 2 }))
  })
})
