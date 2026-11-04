"use strict"

/**
 * 示视图代码运行 —— 真浏览器 UI 自动化回归。
 *
 *   node test/ui/exec-present-ui.cjs         （在 packages/desktop 下）
 *   pnpm test:ui:exec-present               （仓库根，等价转发）
 *   HEADED=1 ...                            # 开真窗口看
 *   SHOTS_DIR=D:/shots ...                  # 截图输出目录（默认系统临时目录）
 *
 * 不是 jsdom 合成事件：真 Chrome、真鼠标点击、真键盘、真 computedStyle、真截图。
 * 页面按宿主架构跑在跨源 iframe 里（父页 about:blank → iframe 指向本地 deck 服务），
 * 所有宿主↔页面通信都走 postMessage，连同 A 方案的消息桥一起验。
 *
 * 能力表不是手编的：用 mdcode2run 引擎的 parse() 生成，再按 deckPane 的口径投影，
 * 于是「引擎 0 基围栏行 ↔ <pre data-src-start> 1 基行 ↔ ▶ 装饰」整条口径一起受测。
 */

const assert = require("assert")
const fs = require("fs")
const http = require("http")
const os = require("os")
const path = require("path")
const { createEngine } = require("mdcode2run")

const E2E_DIR = __dirname
const DESKTOP_DIR = path.resolve(E2E_DIR, "../..")
const RES_DIR = path.join(DESKTOP_DIR, "resources", "md2slides")
const FIXTURE = path.join(E2E_DIR, "fixtures", "exec-present.md")
const SHOTS_DIR = process.env.SHOTS_DIR || path.join(os.tmpdir(), "wenlan-exec-ui")
const HEADED = process.env.HEADED === "1"

// ── 依赖：wenlan 没装 puppeteer-core，复用 md2slides 已装的那份 ──────────────
const loadPuppeteer = () => {
  const candidates = [
    process.env.PUPPETEER_CORE_PATH,
    "puppeteer-core",
    path.resolve(E2E_DIR, "../../../../../md2slides/node_modules/puppeteer-core"),
    path.resolve(DESKTOP_DIR, "../../node_modules/puppeteer-core"),
  ].filter(Boolean)
  for (const c of candidates) {
    try {
      return require(c)
    } catch { /* 试下一个 */ }
  }
  throw new Error(
    "找不到 puppeteer-core。请 pnpm add -D puppeteer-core，或设 PUPPETEER_CORE_PATH 指到已安装副本。",
  )
}

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean)

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
}

/** 极简静态服务：只服务 resources/md2slides（含注入的 exec-present.js）。 */
const serveDeck = () => new Promise((resolve, reject) => {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "")
    if (/favicon\.ico$/.test(rel)) { res.writeHead(204).end(); return }
    const file = path.resolve(RES_DIR, rel)
    if (file !== RES_DIR && !file.startsWith(RES_DIR + path.sep)) {
      res.writeHead(403).end(); return
    }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end(); return }
      res.writeHead(200, { "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" })
      res.end(data)
    })
  })
  server.on("error", reject)
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address()
    resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise(d => server.close(d)) })
  })
})

/** 照 deckPane.sendExecCapability 的口径，把引擎 parse 结果投成页面能力表。 */
const buildCapability = md => {
  const engine = createEngine({ config: {}, documentPath: FIXTURE, documentDir: path.dirname(FIXTURE) })
  try {
    const parsed = engine.parse(md)
    const runnable = parsed.blocks.filter(b => b.runnable)
    const runnableSet = new Set(runnable.map(b => b.line))
    const chapters = [...parsed.chapters].sort((a, b) => a.line - b.line)
    const firstByChapter = new Map()
    for (const ch of chapters) {
      const first = (ch.fences || []).find(f => runnableSet.has(f.line))
      if (first) firstByChapter.set(ch.line, first.line)
    }
    const chapterLineOf = line => {
      let key = -1
      for (const ch of chapters) { if (ch.line > line) break; key = ch.line }
      return key
    }
    const blocks = runnable.map(b => {
      const first = firstByChapter.get(chapterLineOf(b.line))
      return {
        line: b.line, end: b.end, runnable: true, lang: b.lang, job: b.job,
        replayable: first !== undefined && b.line > first,
      }
    })
    return { docPath: FIXTURE, enabled: true, blocks }
  } finally {
    engine.dispose()
  }
}

/** 只有 rgba() 的第 4 个参数才是 alpha；rgb(r,g,b) 一律算 1（别把 B 通道当透明度）。 */
const alphaOf = css => {
  const m = /^rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)$/i
    .exec(String(css || "").trim())
  return m ? Number(m[1]) : 1
}

const report = { steps: [], shots: [], pageErrors: [] }

/**
 * 装饰全量核对。
 *
 * 实测口径：`<pre data-src-start="N">` 里的 N 是**代码内容首行**（1 基），
 * 比 ``` 围栏行大 1。引擎 parse 的 b.line 是围栏行（0 基），所以 N-1 = b.line+1，
 * 落在 [b.line, b.end) 内但**不等于** b.line —— 用 Set 精确匹配会整片漏挂 ▶。
 * 分页续片的 N 还会更大，同样只能靠区间包含命中。
 */
const inspectDecor = async (frame, cap) => {
  const raw = await frame.evaluate(() => {
    const all = [...document.querySelectorAll("pre .md2s-exec-run")]
    return {
      run: all.filter(e => e.textContent === "▶").length,
      replay: all.filter(e => e.textContent === "⏩").length,
      starts: [...document.querySelectorAll("pre[data-src-start]")]
        .map(p => ({ n: Number(p.getAttribute("data-src-start")),
          has: !!p.querySelector(".md2s-exec-run") })),
      visible: all.filter(e => {
        const r = e.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"
      }).length,
    }
  })
  const inBlock = raw.starts.filter(s => {
    const line = s.n - 1
    return cap.blocks.some(b => line >= b.line && line < b.end)
  })
  const missed = inBlock.filter(s => !s.has)
  const continuations = raw.starts.filter(s =>
    s.has && !cap.blocks.some(b => s.n - 1 === b.line + 1))
  return { ...raw, inBlock, missed, continuations }
}

const main = async () => {
  assert.ok(fs.existsSync(path.join(RES_DIR, "exec-present.js")),
    `资源包缺 exec-present.js，先跑 node scripts/sync-md2slides.mjs`)
  assert.ok(fs.existsSync(path.join(RES_DIR, "dist", "deck-full.js")), "资源包缺 dist/deck-full.js")
  assert.ok(fs.existsSync(FIXTURE), `缺 fixture ${FIXTURE}`)
  fs.mkdirSync(SHOTS_DIR, { recursive: true })

  const puppeteer = loadPuppeteer()
  const executablePath = CHROME_CANDIDATES.find(p => fs.existsSync(p))
  assert.ok(executablePath, "找不到 Chrome / Edge，设 CHROME_PATH 指一下")

  const srv = await serveDeck()
  const browser = await puppeteer.launch({
    executablePath,
    headless: !HEADED,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
  })

  const check = (name, ok, detail) => {
    report.steps.push({ name, ok: !!ok, detail: detail ?? "" })
    if (!ok) throw new Error(`断言失败：${name}${detail ? " — " + detail : ""}`)
  }
  const shot = async name => {
    const file = path.join(SHOTS_DIR, name)
    await page.screenshot({ path: file })
    report.shots.push(file)
  }

  let page
  try {
    page = await browser.newPage()
    await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 })
    page.on("pageerror", e => report.pageErrors.push("pageerror: " + e.message))
    page.on("console", m => {
      if (m.type() === "error" && !/favicon|woff|ttf|404/i.test(m.text())) {
        report.pageErrors.push("console: " + m.text())
      }
    })

    // 父页（模拟 Electron 渲染进程宿主）：收集页面 post 上来的消息。
    await page.setContent(
      `<style>html,body{margin:0;height:100%;background:#111}iframe{width:100vw;height:100vh;border:0;display:block}</style>` +
      `<iframe src="${srv.url}/deck.html" allow="fullscreen"></iframe>` +
      `<script>window.__hostMsgs=[];window.addEventListener('message',function(e){` +
      `var d=e.data;if(d&&typeof d==='object'&&typeof d.type==='string')window.__hostMsgs.push(d)})</script>`,
      { waitUntil: "domcontentloaded" },
    )

    const frame = await page.waitForFrame(f => /\/deck\.html/.test(f.url()), { timeout: 30000 })
    const hostMsgs = () => page.evaluate(() => window.__hostMsgs.slice())
    const send = msg => page.evaluate(
      m => document.querySelector("iframe").contentWindow.postMessage(m, "*"), msg)

    await page.waitForFunction(
      () => window.__hostMsgs.some(m => m.type === "md2s:boot"), { timeout: 30000 })
    check("页面 boot 握手（postMessage 跨源）", true)

    const md = fs.readFileSync(FIXTURE, "utf8")
    await send({
      type: "md2s:build", md, mdDir: path.dirname(FIXTURE),
      runOpts: { view: "present" },
    })
    await page.waitForFunction(
      () => window.__hostMsgs.some(m => m.type === "md2s:ready"), { timeout: 60000 })
    const ready = (await hostMsgs()).find(m => m.type === "md2s:ready")
    check("deck 构建完成（md2s:ready）", ready.total > 0, `total=${ready.total}`)

    // ── 能力表 + ▶ 装饰 ─────────────────────────────────────────────────
    const cap = buildCapability(md)
    check("引擎 parse 得到可跑块", cap.blocks.length >= 3, `blocks=${cap.blocks.length}`)
    // 宿主 sendExecCapability 是 async（await parse）：等分页 DOM 收敛后再装饰，
    // 免得能力表打在「粗排 DOM」上，测出的 ▶ 数量不代表最终态。
    await frame.waitForFunction(() => document.querySelectorAll("pre[data-src-start]").length > 0,
      { timeout: 10000 })
    await new Promise(r => setTimeout(r, 500))
    await send({ type: "md2s:exec-capability", ...cap })
    await frame.waitForSelector(".md2s-exec-run", { timeout: 10000 })
    const decor = await inspectDecor(frame, cap)
    check("每个块都挂上 ▶（区间包含匹配，零漏挂）",
      decor.inBlock.length >= cap.blocks.length && decor.missed.length === 0 &&
      decor.run === decor.inBlock.length,
      `▶=${decor.run} 块内pre=${decor.inBlock.length} 漏挂=${decor.missed.length} starts=${decor.starts.map(s => s.n).join(",")}`)
    check("data-src-start 是内容首行而非围栏行（精确匹配必全漏）",
      cap.blocks.every(b => decor.starts.some(s => s.has && s.n === b.line + 2)),
      `围栏行1基=${cap.blocks.map(b => b.line + 1).join(",")} 内容首行=${cap.blocks.map(b => b.line + 2).join(",")} starts=${decor.starts.map(s => s.n).join(",")}`)
    check("⏩ 重放按钮按章生成", decor.replay >= 1, `⏩=${decor.replay}`)
    check("至少一个 ▶ 在当前页可见（可真点击）", decor.visible > 0, `visible=${decor.visible}`)

    // ── 真点击 ▶ → 首次确认 → 宿主收到运行请求 ─────────────────────────
    const runBtns = await frame.$$(".md2s-exec-run")
    let clicked = false
    for (const h of runBtns) {
      const box = await h.boundingBox()
      if (box && box.width > 0 && box.height > 0) { await h.click(); clicked = true; break }
    }
    assert.ok(clicked, "没有可点的 ▶")
    await frame.waitForSelector(".md2s-exec-confirm button", { timeout: 5000 })
    check("首次点 ▶ 弹安全确认", true)
    await frame.click(".md2s-exec-confirm button")
    await page.waitForFunction(
      () => window.__hostMsgs.some(m => m.type === "md2s:exec"), { timeout: 5000 })
    const execReq = (await hostMsgs()).find(m => m.type === "md2s:exec")
    check("确认后向宿主发 md2s:exec（整块开栏行）",
      execReq.line === cap.blocks[0].line && execReq.replay === false,
      `line=${execReq.line} expect=${cap.blocks[0].line}`)

    // ── 宿主回灌事件与结果 ───────────────────────────────────────────────
    await send({ type: "md2s:exec-state", reqId: execReq.reqId, event: { type: "started" } })
    await send({ type: "md2s:exec-state", reqId: execReq.reqId,
      event: { type: "chunk", stream: "stdout", text: "hello from exec-present\n" } })
    await send({ type: "md2s:exec-result", reqId: execReq.reqId, result: {
      ok: true, kind: "python",
      rows: { columns: ["name", "cnt"], cells: [["甲", 12], ["乙", 7], [null, 3]] },
      text: "hello from exec-present\nrow 0\nrow 1\nrow 2",
      session: { chapter: "第一章", replayed: false, ran: 1, total: 3, stale: 0 },
    } })
    await frame.waitForFunction(
      () => document.querySelector(".md2s-exec-overlay .md2s-exec-body table"), { timeout: 5000 })
    const resultDom = await frame.evaluate(() => ({
      rows: document.querySelectorAll(".md2s-exec-body tbody tr").length,
      head: [...document.querySelectorAll(".md2s-exec-body th")].map(e => e.textContent),
      session: document.querySelector(".md2s-exec-session").textContent,
      status: document.querySelector(".md2s-exec-status").textContent,
    }))
    check("结果表格渲染", resultDom.rows === 3 && resultDom.head.join(",") === "name,cnt",
      JSON.stringify(resultDom))
    check("会话 HUD / 状态条渲染", /第一章/.test(resultDom.session), resultDom.session)

    // ── 视觉断言：背景半透明、文字不透明、玻璃模糊 ──────────────────────
    const visual = await frame.evaluate(() => {
      const o = document.querySelector(".md2s-exec-overlay")
      const cs = getComputedStyle(o)
      const body = getComputedStyle(document.querySelector(".md2s-exec-body"))
      const th = getComputedStyle(document.querySelector(".md2s-exec-body th"))
      const r = o.getBoundingClientRect()
      return {
        bg: cs.backgroundColor, opacity: cs.opacity, blur: cs.backdropFilter,
        textColor: body.color, thColor: th.color,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        secPad: (document.querySelector("section.md2s-current") || {}).style?.paddingBottom || "",
      }
    })
    check("默认浮层背景 68% 半透明", Math.abs(alphaOf(visual.bg) - 0.68) < 0.02, visual.bg)
    check("整体 opacity=1（文字不被连坐变淡）", visual.opacity === "1", visual.opacity)
    check("文字与表头颜色不透明", alphaOf(visual.textColor) === 1 && alphaOf(visual.thColor) === 1,
      `${visual.textColor} / ${visual.thColor}`)
    const blurPx = Number((/blur\(([\d.]+)px\)/.exec(visual.blur) || [])[1] || 99)
    check("backdrop-filter ≤2px（别把背后代码糊成光斑）", blurPx <= 2, visual.blur)
    check("居中覆盖且不给 section 让位", visual.secPad === "", `paddingBottom=${visual.secPad}`)
    await shot("01-float-default.png")

    // ── ◐ 三档透明度（真点击） ──────────────────────────────────────────
    const alphas = [alphaOf(visual.bg)]
    for (const name of ["02-float-clear.png", "03-float-solid.png", "04-float-back.png"]) {
      await frame.click(".md2s-exec-alphabtn")
      const bg = await frame.$eval(".md2s-exec-overlay", e => getComputedStyle(e).backgroundColor)
      alphas.push(alphaOf(bg))
      if (name === "02-float-clear.png" || name === "03-float-solid.png") await shot(name)
    }
    check("◐ 三档循环 0.68 → 0.52 → 0.94 → 0.68",
      alphas.length === 4 &&
      Math.abs(alphas[1] - 0.52) < 0.02 && Math.abs(alphas[2] - 0.94) < 0.02 &&
      Math.abs(alphas[3] - 0.68) < 0.02, alphas.join(" → "))

    // ── ⇆ 分栏：强制实心、代码让位 ─────────────────────────────────────
    await frame.click(".md2s-exec-splitbtn")
    const split = await frame.evaluate(() => {
      const o = document.querySelector(".md2s-exec-overlay")
      const sec = document.querySelector("section.md2s-current")
      return {
        cls: o.className, bg: getComputedStyle(o).backgroundColor,
        padRight: sec ? sec.style.paddingRight : "",
      }
    })
    check("⇆ 切到右半屏分栏", /md2s-exec-split/.test(split.cls), split.cls)
    check("分栏态强制实心", alphaOf(split.bg) >= 0.94, split.bg)
    check("分栏态给代码让出 46%", split.padRight === "46%", split.padRight)
    await shot("05-split.png")

    // 分栏态点 ◐ 先回浮层
    await frame.click(".md2s-exec-alphabtn")
    const back = await frame.$eval(".md2s-exec-overlay", e => e.className)
    check("分栏态点 ◐ 先回居中浮层", !/md2s-exec-split/.test(back), back)

    // ── Esc 输入隔离：收浮层但不退放映 ──────────────────────────────────
    await frame.evaluate(() => window.focus())
    const escBefore = (await hostMsgs()).filter(m => m.type === "md2s:esc").length
    await page.keyboard.press("Escape")
    await frame.waitForFunction(() => !document.querySelector(".md2s-exec-overlay"), { timeout: 3000 })
    const escAfter = (await hostMsgs()).filter(m => m.type === "md2s:esc").length
    check("Esc 收浮层", true)
    check("Esc 不透传给宿主（不退放映）", escAfter === escBefore,
      `before=${escBefore} after=${escAfter}`)

    // ── 重建后 ▶ 自动重挂（300ms 防抖改字链路） ─────────────────────────
    const md2 = md.replace("# 示视图代码运行 · UI 回归", "# 示视图代码运行 · UI 回归（改字后）")
    const readyBefore = (await hostMsgs()).filter(m => m.type === "md2s:ready").length
    await send({ type: "md2s:build", md: md2, mdDir: path.dirname(FIXTURE),
      runOpts: { view: "present" } })
    await page.waitForFunction(
      n => window.__hostMsgs.filter(m => m.type === "md2s:ready").length > n,
      { timeout: 60000 }, readyBefore)
    const cap2 = buildCapability(md2)
    await send({ type: "md2s:exec-capability", ...cap2 })
    await frame.waitForFunction(() => document.querySelectorAll(".md2s-exec-run").length > 0,
      { timeout: 5000 })
    const d2 = await inspectDecor(frame, cap2)
    check("重建后 ▶ 自动重挂，且分页续片也零漏挂",
      d2.run === d2.inBlock.length && d2.missed.length === 0 && d2.run >= cap2.blocks.length,
      `▶=${d2.run} 块内pre=${d2.inBlock.length} 续片=${d2.continuations.length} 漏挂=${d2.missed.length} starts=${d2.starts.map(s => s.n).join(",")}`)
    check("续片若出现，全部挂上 ▶",
      d2.continuations.every(s => s.has), `续片starts=${d2.continuations.map(s => s.n).join(",")}`)

    // ── 导出前收起浮层 ──────────────────────────────────────────────────
    const runBtns2 = await frame.$$(".md2s-exec-run")
    for (const h of runBtns2) {
      const box = await h.boundingBox()
      if (box && box.width > 0 && box.height > 0) { await h.click(); break }
    }
    await frame.waitForSelector(".md2s-exec-overlay", { timeout: 5000 })
    await send({ type: "md2s:export", id: 1, kind: "image" })
    await frame.waitForFunction(() => !document.querySelector(".md2s-exec-overlay"), { timeout: 3000 })
    check("md2s:export 自动收起结果浮层（不栅格进 PPTX）", true)

    check("页面无 JS 报错", report.pageErrors.length === 0, report.pageErrors.join(" | "))
  } finally {
    await browser.close()
    await srv.close()
  }

  return report
}

main().then(r => {
  console.log("\n=== 示视图代码运行 · UI 自动化 ===")
  for (const s of r.steps) console.log(`  ${s.ok ? "PASS" : "FAIL"}  ${s.name}${s.detail ? "  [" + s.detail + "]" : ""}`)
  console.log(`\n断言 ${r.steps.length} 项，截图 ${r.shots.length} 张：`)
  for (const f of r.shots) console.log("  " + f)
  if (r.pageErrors.length) console.log("\n页面报错：\n  " + r.pageErrors.join("\n  "))
  console.log(`\n结果：${r.steps.every(s => s.ok) ? "全部通过" : "有失败"}`)
}).catch(e => {
  console.log("\n=== 已完成断言（中途失败）===")
  for (const s of report.steps) console.log(`  ${s.ok ? "PASS" : "FAIL"}  ${s.name}${s.detail ? "  [" + s.detail + "]" : ""}`)
  if (report.shots.length) console.log("截图：\n  " + report.shots.join("\n  "))
  console.error("\n[FAILED] " + (e && e.message ? e.message : e))
  process.exit(1)
})
