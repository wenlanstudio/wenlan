import { spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithMarkdown, waitForEditor } from './helpers'

/**
 * 完整应用级：「示」视图代码运行的跨进程链路。
 *
 * 与 test/ui/exec-present-ui.cjs（真 Chrome + 模拟宿主）分工：那份验 deck 页面
 * 自身的 DOM/CSS/交互，这份验**真 Electron 宿主**——刻度按钮切叶 → deckPane 挂载 →
 * 本地 deck 服务 → 跨源 iframe → preload → main IPC → mdcode2run 单例引擎 →
 * 事件/结果回灌 iframe 浮层。任何一层断掉，这个用例都会挂。
 *
 * 不依赖本机 Python 是否装好：引擎跑成功或返回「没有可用的 Python」都算链路打通
 * （浮层里出现结算内容即可）。真跑 Hive 的门控用例在文件末尾。
 */

const LEAF_PRESENT = '.leaf-btn[title="放映（一次一页）"]'

const MD = `# 放映代码运行 · 应用级回归

点 ▶ 应弹出半透明结果浮层，背后代码仍能透出来。

\`\`\`python
print("hello from app e2e")
\`\`\`
`

test.describe('示视图代码运行 — 完整 Electron 应用', () => {
  test.setTimeout(120000)

  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown(MD)
    app = launched.app
    page = launched.page
    await waitForEditor(page)
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('切「示」叶 → 点 ▶ → 安全确认 → 引擎结果回灌结果浮层', async() => {
    // ① 真点状态栏刻度按钮（不是直接改 pinia store）
    const leafBtn = page.locator(LEAF_PRESENT)
    await expect(leafBtn).toBeVisible()
    await leafBtn.click()
    await expect(leafBtn).toHaveClass(/active/)

    // ② deckPane 起本地服务、挂跨源 iframe、发 build、收到 ready 后下发能力表
    const deck = page.frameLocator('iframe[src*="deck.html"]')
    const runBtn = deck.locator('pre .md2s-exec-run').first()
    await expect(runBtn).toBeVisible({ timeout: 60000 })

    // ③ 真点 ▶；临时文档每次新路径，首次运行必弹授权确认
    await runBtn.click()
    const confirm = deck.locator('.md2s-exec-confirm button')
    await expect(confirm).toBeVisible()
    await confirm.click()

    // ④ 结果浮层出现：main 引擎已经 run 过并把 state/result 或 error 回灌进 iframe。
    //    用「body 出现结算内容」而不是固定成功文案，避免绑死本机运行时。
    const overlay = deck.locator('.md2s-exec-overlay')
    await expect(overlay).toBeVisible()
    await expect
      .poll(
        async() => (await deck.locator('.md2s-exec-body').textContent())?.trim().length ?? 0,
        { timeout: 60000 }
      )
      .toBeGreaterThan(0)

    const status = await deck.locator('.md2s-exec-status').textContent()
    const bodyText = (await deck.locator('.md2s-exec-body').textContent())?.trim() ?? ''
    expect(status).not.toMatch(/等待确认|准备中|运行中/)
    // 必须看到引擎的 stdout 或其运行时诊断：证明 main 的 mdcode2run 单例真的
    // 执行过，而不只是页面自己画了个空浮层。
    expect(bodyText).toMatch(/hello from app e2e|没有可用的 Python/)

    // ⑤ 应用内真实 computedStyle：默认档 68% 半透明 + 轻微模糊
    const bg = await overlay.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(bg).toMatch(/0\.68/)
    const blur = await overlay.evaluate((el) => getComputedStyle(el).backdropFilter)
    expect(blur).toMatch(/blur\(2px\)/)

    // ⑥ Esc 收浮层但不退放映（deckPane 若收到 md2s:esc 会把「示」叶关掉）
    await overlay.press('Escape')
    await expect(overlay).toHaveCount(0)
    await expect(page.locator(LEAF_PRESENT)).toHaveClass(/active/)
  })
})

/**
 * 远端 Hive 真跑：默认关闭，因为要 node0 免密 + HS2 在线 +
 * `~/.wenlan-studio/mdcode2run.json` 里配好 hive.SSH_*。
 * 打开方式：WENLAN_E2E_HIVE=1 pnpm test:e2e -- exec-present-app
 */
const HIVE_CONFIG = path.join(os.homedir(), '.wenlan-studio', 'mdcode2run.json')
const HIVE_ENABLED = process.env.WENLAN_E2E_HIVE === '1' && fs.existsSync(HIVE_CONFIG)

const HIVE_MD = `# Hive 应用级回归

\`\`\`hive
SHOW DATABASES;
\`\`\`
`

/** 探针：集群节点常在关机/换网后不可达，别让用例傻等 120s 才报超时。 */
const probeHiveSsh = (): { ok: boolean; reason: string } => {
  try {
    const cfg = JSON.parse(fs.readFileSync(HIVE_CONFIG, 'utf8')) as {
      hive?: Record<string, string>
    }
    const h = cfg.hive ?? {}
    const bin = h.SSH_BIN || 'ssh'
    const host = h.SSH_HOST || 'node0'
    const target = h.SSH_USER ? `${h.SSH_USER}@${host}` : host
    const r = spawnSync(
      bin,
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-o', 'StrictHostKeyChecking=no',
        target, 'echo HIVE_OK'],
      { encoding: 'utf8', timeout: 12000, windowsHide: true }
    )
    if (r.status === 0 && /HIVE_OK/.test(r.stdout ?? '')) return { ok: true, reason: '' }
    return { ok: false, reason: `${target} SSH 探活失败：${(r.stderr || r.error?.message || '').trim()}` }
  } catch (e) {
    return { ok: false, reason: `读取 ${HIVE_CONFIG} 失败：${String(e)}` }
  }
}

test.describe('示视图 Hive 真跑 — 远端 HS2（门控）', () => {
  test.setTimeout(180000)

  let app: ElectronApplication
  let page: Page
  let reachable = false
  let skipReason = `需 WENLAN_E2E_HIVE=1 且 ${HIVE_CONFIG} 存在`

  test.beforeAll(async() => {
    if (!HIVE_ENABLED) return
    const probe = probeHiveSsh()
    reachable = probe.ok
    if (!reachable) {
      skipReason = probe.reason
      return
    }
    const launched = await launchWithMarkdown(HIVE_MD)
    app = launched.app
    page = launched.page
    await waitForEditor(page)
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('▶ 经 SSH 到集群跑 SQL，结果表格回灌浮层', async() => {
    test.skip(!reachable, skipReason)

    await page.locator(LEAF_PRESENT).click()
    const deck = page.frameLocator('iframe[src*="deck.html"]')
    const runBtn = deck.locator('pre .md2s-exec-run').first()
    await expect(runBtn).toBeVisible({ timeout: 60000 })
    await runBtn.click()
    const confirm = deck.locator('.md2s-exec-confirm button')
    if (await confirm.count()) await confirm.click()

    // 真跑：main → mdcode2run hive SSH 通道 → node0 beeline → HS2 → rows → iframe。
    // 先等「结算内容」再判表格，失败时把引擎诊断带进断言消息，别只报 element not found。
    await expect
      .poll(
        async() => (await deck.locator('.md2s-exec-body').textContent())?.trim().length ?? 0,
        { timeout: 120000 }
      )
      .toBeGreaterThan(0)
    const bodyText = (await deck.locator('.md2s-exec-body').textContent())?.trim() ?? ''
    const tableCount = await deck.locator('.md2s-exec-overlay table').count()
    expect(tableCount, `引擎结算内容：${bodyText.slice(0, 300)}`).toBeGreaterThan(0)
    const head = await deck.locator('.md2s-exec-body th').allTextContents()
    expect(head.length).toBeGreaterThan(0)
    const rows = (await deck.locator('.md2s-exec-body tbody').textContent())?.trim() ?? ''
    expect(rows.length).toBeGreaterThan(0)
  })
})
