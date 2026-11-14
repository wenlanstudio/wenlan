import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 「示」视图放映执行桥（resources-src/md2slides/exec-present.js）的行为护栏。
 *
 * 这份脚本是部署进 deck 页面的独立浏览器脚本（不是 TS 模块），所以用 jsdom
 * eval 它、拿 MessageEvent 模拟宿主消息。重点钉死四件容易回归的事：
 *   ① 分页续片的 data-src-start 落在块体内，必须用区间包含匹配，且 ▶ 回传
 *      的是整块开栏行（与引擎事件 event.line 同口径），不是切片行；
 *   ② 首次运行要先确认，未保存文档根本不注入 ▶；
 *   ③ 结果浮层的输入隔离 / 导出前收起，别惊动播放器与 PPTX 出片；
 *   ④ kind=table 收掉原始 TSV 流——同一份数据别显示两遍（表格 + 弱化尾注）。
 */
const requireFromHere = createRequire(import.meta.url)
// jsdom 没有随包的 @types，只用得到下面这几个成员，就地声明最小形状。
interface BridgeWindow {
  eval(code: string): void
  document: Document
  sessionStorage: Storage
  dispatchEvent(ev: Event): boolean
  MessageEvent: typeof MessageEvent
  MouseEvent: typeof MouseEvent
  KeyboardEvent: typeof KeyboardEvent
  postMessage(msg: unknown): void
  focus(): void
  deckFull?: { getPlayer?: () => { refreshSteps?: () => void } }
}
const { JSDOM } = requireFromHere('jsdom') as {
  JSDOM: new (html: string, opts: { url: string; runScripts: string }) => { window: unknown }
}

const here = dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(
  resolve(here, '../../../resources-src/md2slides/exec-present.js'),
  'utf-8'
)

const HTML = `<!doctype html><html><head></head><body>
<div id="deck" tabindex="-1"><section class="md2s-current">
<pre data-src-start="3" data-src-end="7"><code class="language-python">print("hi")</code></pre>
<pre data-src-start="5" data-src-end="7"><code class="language-python">continued</code></pre>
<pre data-src-start="10" data-src-end="13"><code class="language-bash">echo ok</code></pre>
<pre data-src-start="20" data-src-end="24"><code class="language-mermaid">graph TD</code></pre>
</section></div></body></html>`

const CAP = {
  type: 'md2s:exec-capability',
  docPath: '/tmp/demo.md',
  enabled: true,
  blocks: [
    { line: 2, end: 7, runnable: true, lang: 'python', job: false, replayable: false },
    { line: 9, end: 13, runnable: true, lang: 'bash', job: false, replayable: true },
    { line: 19, end: 24, runnable: false, lang: 'mermaid', job: false, replayable: false }
  ]
}

const boot = (confirmed: boolean) => {
  const dom = new JSDOM(HTML, {
    url: 'http://127.0.0.1:9999/deck.html',
    runScripts: 'outside-only'
  })
  const w = dom.window as unknown as BridgeWindow
  const sent: Array<Record<string, unknown>> = []
  let refreshed = 0
  // 页面脚本用 window.parent.postMessage 回宿主；jsdom 无 iframe，parent 即自身。
  w.postMessage = msg => { sent.push(msg as Record<string, unknown>) }
  w.focus = () => undefined // jsdom 的 focus 未实现，stub 掉免得刷 Not implemented
  w.deckFull = { getPlayer: () => ({ refreshSteps: () => { refreshed += 1 } }) }
  if (confirmed) {
    w.sessionStorage.setItem('md2s-exec-confirmed', JSON.stringify(['/tmp/demo.md']))
  }
  w.eval(SRC)
  const send = (msg: Record<string, unknown>): void => {
    w.dispatchEvent(new w.MessageEvent('message', {
      data: msg,
      source: w as unknown as Window
    }))
  }
  const click = (el: Element | null): void => {
    el?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }))
  }
  return { w, sent, send, click, refreshed: () => refreshed }
}

describe('exec-present bridge', () => {
  it('装饰可跑块（含分页续片），不可跑块无 ▶，并重建步进表', () => {
    const t = boot(true)
    t.send(CAP)
    const btns = Array.from(t.w.document.querySelectorAll('.md2s-exec-run'))
    expect(btns).toHaveLength(4) // python 两块切片 + bash 的 ▶/⏩
    expect(btns.filter(b => b.textContent === '⏩')).toHaveLength(1)
    expect(t.w.document.querySelectorAll('[data-md2s-activatable]')).toHaveLength(4)
    expect(t.refreshed()).toBe(1)
    expect(t.w.document.querySelector('pre[data-src-start="20"] .md2s-exec-run')).toBeNull()
    expect(t.w.document.getElementById('md2s-exec-css')).not.toBeNull()
  })

  it('续片 ▶ 回传整块开栏行，不是切片行', () => {
    const t = boot(true)
    t.send(CAP)
    const pres = Array.from(t.w.document.querySelectorAll('pre'))
    t.click(pres[1]?.querySelector('.md2s-exec-run') ?? null)
    const req = t.sent.find(m => m.type === 'md2s:exec')
    expect(req).toBeDefined()
    expect(req?.line).toBe(2)
    expect(req?.replay).toBe(false)
    expect(req?.docPath).toBe('/tmp/demo.md')
    expect(t.w.document.querySelector('.md2s-exec-overlay')).not.toBeNull()
  })

  it('渲染结果契约并过滤 JShell 变量回显', () => {
    const t = boot(true)
    t.send(CAP)
    t.click(t.w.document.querySelector('.md2s-exec-run'))
    const req = t.sent.find(m => m.type === 'md2s:exec')
    t.send({
      type: 'md2s:exec-result',
      reqId: req?.reqId,
      result: {
        ok: true, kind: 'text', stdout: 'hello-from-deck\n',
        text: 's1 ==> "x"\nreal output', images: [], rows: null
      }
    })
    const overlay = t.w.document.querySelector('.md2s-exec-overlay')
    expect(overlay?.querySelector('.md2s-exec-body')?.textContent).toContain('hello-from-deck')
    expect(overlay?.querySelector('.md2s-exec-body')?.textContent).toContain('real output')
    expect(overlay?.querySelector('.md2s-exec-body')?.textContent).not.toContain('s1 ==>')
    expect(overlay?.querySelector('.md2s-exec-status')?.textContent).toContain('输出')
  })

  it('kind=table 收掉原始 TSV 流——表格一份 + 弱化尾注，不双显', () => {
    const t = boot(true)
    t.send(CAP)
    t.click(t.w.document.querySelector('.md2s-exec-run'))
    const req = t.sent.find(m => m.type === 'md2s:exec')
    t.send({
      type: 'md2s:exec-state',
      reqId: req?.reqId,
      event: { type: 'chunk', stream: 'stdout', text: 'tab_name\nmedia_index\n' }
    })
    expect(
      t.w.document.querySelector('.md2s-exec-body')?.querySelector('pre')?.textContent
    ).toContain('media_index') // 流式期间原始输出可见
    t.send({
      type: 'md2s:exec-result',
      reqId: req?.reqId,
      result: {
        ok: true, kind: 'table',
        rows: { columns: ['tab_name'], cells: [['media_index']] },
        stdout: 'tab_name\nmedia_index\n', text: '1 row selected (0.5s)', images: []
      }
    })
    const body = t.w.document.querySelector('.md2s-exec-body')
    expect(body?.querySelectorAll('table')).toHaveLength(1)
    expect(body?.querySelectorAll('pre')).toHaveLength(1) // 只剩尾注，原始 TSV 已收
    expect(body?.querySelector('pre')?.textContent).toContain('1 row selected')
    expect(
      t.w.document.querySelector('.md2s-exec-status')?.textContent
    ).toContain('表格')
  })

  it('导出前收起结果面板并通知宿主取消', () => {
    const t = boot(true)
    t.send(CAP)
    t.click(t.w.document.querySelector('.md2s-exec-run'))
    t.send({ type: 'md2s:export', id: 1 })
    expect(t.w.document.querySelector('.md2s-exec-overlay')).toBeNull()
    expect(t.sent.some(m => m.type === 'md2s:exec-cancel')).toBe(true)
  })

  it('首次运行先确认，确认后按 docPath 记住', () => {
    const t = boot(false)
    t.send(CAP)
    t.click(t.w.document.querySelector('.md2s-exec-run'))
    expect(t.sent.filter(m => m.type === 'md2s:exec')).toHaveLength(0)
    const box = t.w.document.querySelector('.md2s-exec-confirm')
    expect(box).not.toBeNull()
    t.click(box?.querySelector('button') ?? null)
    expect(t.sent.filter(m => m.type === 'md2s:exec')).toHaveLength(1)
    expect(JSON.parse(t.w.sessionStorage.getItem('md2s-exec-confirmed') ?? '[]')).toContain(
      '/tmp/demo.md'
    )
  })

  it('未保存文档不下发 ▶', () => {
    const t = boot(true)
    t.send({ type: 'md2s:exec-capability', docPath: '', enabled: false, blocks: [] })
    expect(t.w.document.querySelectorAll('.md2s-exec-run')).toHaveLength(0)
  })

  it('Esc 关面板且吃掉按键，不触发退出放映', () => {
    const t = boot(true)
    t.send(CAP)
    t.click(t.w.document.querySelector('.md2s-exec-run'))
    const ev = new t.w.KeyboardEvent('keydown', {
      key: 'Escape', bubbles: true, cancelable: true
    })
    t.w.dispatchEvent(ev)
    expect(t.w.document.querySelector('.md2s-exec-overlay')).toBeNull()
    expect(ev.defaultPrevented).toBe(true)
    // 焦点还给播放器容器：翻页笔的下一发确定键回播放器手里，不误触页内 ▶
    expect(t.w.document.activeElement?.id).toBe('deck')
  })

  it('翻页键=头钮焦点遍历不翻页，确定键=按下聚焦钮（lightbox 同款契约）', () => {
    const t = boot(true)
    t.send(CAP)
    t.click(t.w.document.querySelector('.md2s-exec-run'))
    const key = (k: string): KeyboardEvent =>
      new t.w.KeyboardEvent('keydown', { key: k, cancelable: true })
    // 焦点在浮层外：PgDn 进第一个头钮（◐），到边界停住
    t.w.dispatchEvent(key('PageDown'))
    expect(t.w.document.activeElement?.classList.contains('md2s-exec-alphabtn')).toBe(true)
    t.w.dispatchEvent(key('PageUp'))
    expect(t.w.document.activeElement?.classList.contains('md2s-exec-alphabtn')).toBe(true)
    // 走到 ✕ 收起（最后一个），确定键按下它 = 关闭
    t.w.dispatchEvent(key('PageDown'))
    t.w.dispatchEvent(key('PageDown'))
    expect(t.w.document.activeElement?.classList.contains('md2s-exec-close')).toBe(true)
    const enter = key('Enter')
    t.w.dispatchEvent(enter)
    expect(t.w.document.querySelector('.md2s-exec-overlay')).toBeNull()
    expect(enter.defaultPrevented).toBe(true)
    expect(t.w.document.activeElement?.id).toBe('deck')
  })

  it('运行中确定键不关面板（防误杀作业），完成即聚焦 ✕、Enter 收起', () => {
    const t = boot(true)
    t.send(CAP)
    t.click(t.w.document.querySelector('.md2s-exec-run'))
    const req = t.sent.find(m => m.type === 'md2s:exec')
    t.send({
      type: 'md2s:exec-state',
      reqId: req?.reqId,
      event: { type: 'started' }
    })
    t.w.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
    expect(t.w.document.querySelector('.md2s-exec-overlay')).not.toBeNull()
    t.send({
      type: 'md2s:exec-result',
      reqId: req?.reqId,
      result: { ok: true, kind: 'text', stdout: 'done', text: '', images: [], rows: null }
    })
    expect(t.w.document.activeElement?.classList.contains('md2s-exec-close')).toBe(true)
    t.w.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
    expect(t.w.document.querySelector('.md2s-exec-overlay')).toBeNull()
  })

  it('确认态按确定键 = 允许并运行（翻页笔可全程键盘走完）', () => {
    const t = boot(false)
    t.send(CAP)
    t.click(t.w.document.querySelector('.md2s-exec-run'))
    expect(t.sent.filter(m => m.type === 'md2s:exec')).toHaveLength(0)
    t.w.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
    expect(t.sent.filter(m => m.type === 'md2s:exec')).toHaveLength(1)
  })

  it('作业运行中翻页键可走到「终止」并确定', () => {
    const t = boot(true)
    t.send(CAP)
    t.click(t.w.document.querySelector('.md2s-exec-run'))
    const req = t.sent.find(m => m.type === 'md2s:exec')
    t.send({
      type: 'md2s:exec-result',
      reqId: req?.reqId,
      result: {
        ok: true, kind: 'job', job: { id: 'j1' },
        text: 'running', stdout: '', images: [], rows: null
      }
    })
    const key = (k: string): KeyboardEvent =>
      new t.w.KeyboardEvent('keydown', { key: k, cancelable: true })
    // 头钮 DOM 序 = [终止] ◐ ⇆ ✕；运行中默认不聚焦任何头钮（确定键空操作防误杀），
    // 从浮层外 PgDn 进第一个 = 「终止」
    t.w.dispatchEvent(key('PageDown'))
    expect(t.w.document.activeElement?.classList.contains('md2s-exec-stop')).toBe(true)
    t.w.dispatchEvent(key('Enter'))
    expect(t.sent.some(m => m.type === 'md2s:exec-stop')).toBe(true)
  })

  it('结果浮层默认居中覆盖且半透明，不再把代码顶走', () => {
    const t = boot(true)
    t.send(CAP)
    t.click(t.w.document.querySelector('.md2s-exec-run'))
    const overlay = t.w.document.querySelector('.md2s-exec-overlay') as HTMLElement
    const css = t.w.document.getElementById('md2s-exec-css')?.textContent ?? ''
    expect(overlay.classList.contains('md2s-exec-alpha-1')).toBe(true)
    expect(css).toContain('rgba(13, 17, 23, 0.68)')
    expect(css).toContain('backdrop-filter: blur(2px)')
    const sec = t.w.document.querySelector('section.md2s-current') as HTMLElement
    expect(sec.style.paddingBottom).toBe('')
    expect(sec.classList.contains('md2s-exec-split')).toBe(false)
  })

  it('◐ 循环切换三档透明度，默认档不高亮', () => {
    const t = boot(true)
    t.send(CAP)
    t.click(t.w.document.querySelector('.md2s-exec-run'))
    const overlay = t.w.document.querySelector('.md2s-exec-overlay') as HTMLElement
    const btn = overlay.querySelector('.md2s-exec-alphabtn') as HTMLElement
    expect(btn.classList.contains('md2s-exec-on')).toBe(false)
    t.click(btn)
    expect(overlay.classList.contains('md2s-exec-alpha-0')).toBe(true)
    expect(btn.title).toContain('52%')
    t.click(btn)
    expect(overlay.classList.contains('md2s-exec-alpha-2')).toBe(true)
    t.click(btn)
    expect(overlay.classList.contains('md2s-exec-alpha-1')).toBe(true)
  })

  it('⇆ 切左右分栏让代码完整可见，切回恢复透明度档位', () => {
    const t = boot(true)
    t.send(CAP)
    t.click(t.w.document.querySelector('.md2s-exec-run'))
    const overlay = t.w.document.querySelector('.md2s-exec-overlay') as HTMLElement
    const sec = t.w.document.querySelector('section.md2s-current') as HTMLElement
    const splitBtn = overlay.querySelector('.md2s-exec-splitbtn')
    t.click(splitBtn)
    expect(overlay.classList.contains('md2s-exec-split')).toBe(true)
    expect(sec.classList.contains('md2s-exec-split')).toBe(true)
    expect(sec.style.paddingRight).toBe('46%')
    expect(t.w.document.getElementById('md2s-exec-css')?.textContent).toContain('0.97')
    t.click(splitBtn)
    expect(overlay.classList.contains('md2s-exec-split')).toBe(false)
    expect(sec.style.paddingRight).toBe('')
    expect(overlay.classList.contains('md2s-exec-alpha-1')).toBe(true)
  })

  it('分栏态点 ◐ 先回到居中浮层再改透明度', () => {
    const t = boot(true)
    t.send(CAP)
    t.click(t.w.document.querySelector('.md2s-exec-run'))
    const overlay = t.w.document.querySelector('.md2s-exec-overlay') as HTMLElement
    t.click(overlay.querySelector('.md2s-exec-splitbtn'))
    t.click(overlay.querySelector('.md2s-exec-alphabtn'))
    expect(overlay.classList.contains('md2s-exec-split')).toBe(false)
    expect(overlay.classList.contains('md2s-exec-alpha-0')).toBe(true)
  })
})
