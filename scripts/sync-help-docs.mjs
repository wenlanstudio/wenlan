#!/usr/bin/env node
/**
 * sync-help-docs.mjs — 把生态四个组件的 frontmatter 文档同步进 app 离线帮助。
 *
 * 设计：
 *   - 真源在**各项目自己的** `docs/FRONTMATTER.md`：本仓、md2slides、mdcode2run、classbuzz。
 *   - 本脚本「活拉」四份源文档 → 快照写进 `packages/desktop/static/help/sources/*.md`（进 git）。
 *     再统一预渲染成 `packages/desktop/static/help/index.html`（进 git、随包、完全自包含）。
 *   - `static/` 已被 electron-builder 的 extraResources 打进安装包，因此**无需构建期步骤**：
 *     独立发布 CI 里没有兄弟仓也能直接打出带完整帮助的包（用已提交的快照）。
 *   - 落地页 `sources/overview.md` 由 wenlan 侧维护，脚本不覆盖它。
 *
 * 用法（本仓根目录）：
 *   pnpm help:docs             # 活拉 + 重建快照与页面
 *   pnpm help:docs:check       # 只校验：源/快照漂移、页面是否最新（CI 护栏）
 *   HELP_DOCS_ROOT=D:/path/to/ecosystem pnpm help:docs
 *
 * 有个组件新增/修改了配置键：改它自己的 docs/FRONTMATTER.md → 跑 `pnpm help:docs`
 * → 提交更新后的快照与 index.html。`--check` 会挡住漏同步的提交。
 *
 * 有功能变更时：各项目改自己的 docs/FRONTMATTER.md → 在 wenlan 跑一次本脚本 → 提交快照与页面。
 * `--check` 会在 CI 里挡住「改了源忘了同步」和「改了快照忘了重建页面」两种漂移。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
// 生态根：默认本仓的父目录；CI 里兄弟仓 checkout 到别处时用环境变量指过去。
const ecosystem = process.env.HELP_DOCS_ROOT ? resolve(process.env.HELP_DOCS_ROOT) : resolve(root, '..')
const helpDir = resolve(root, 'packages', 'desktop', 'static', 'help')
const sourcesDir = resolve(helpDir, 'sources')
const pagePath = resolve(helpDir, 'index.html')

const CHECK = process.argv.includes('--check')

/** 四份由兄弟仓/本仓维护的真源。id 同时是查看器里的 hash 与菜单参数。 */
const SOURCES = [
  {
    id: 'wenlan',
    title: '文览 · 纸面叶',
    subtitle: 'paper / paperTheme',
    sourceLabel: 'wenlan/docs/FRONTMATTER.md',
    src: resolve(root, 'docs', 'FRONTMATTER.md')
  },
  {
    id: 'md2slides',
    title: '放映 · md2slides',
    subtitle: '16 键：封面 / 分页 / 主题 / 放映',
    sourceLabel: 'md2slides/docs/FRONTMATTER.md',
    src: resolve(ecosystem, 'md2slides', 'docs', 'FRONTMATTER.md')
  },
  {
    id: 'mdcode2run',
    title: '代码运行 · mdcode2run',
    subtitle: 'code-exec 段 / 顶层旧写法',
    sourceLabel: 'mdcode2run/docs/FRONTMATTER.md',
    src: resolve(ecosystem, 'mdcode2run', 'docs', 'FRONTMATTER.md')
  },
  {
    id: 'classbuzz',
    title: '课堂竞答 · classbuzz',
    subtitle: '无 YAML frontmatter · 题注 + 房间',
    sourceLabel: 'classbuzz/docs/FRONTMATTER.md',
    src: resolve(ecosystem, 'classbuzz', 'docs', 'FRONTMATTER.md')
  }
]

/** 查看器页面顺序：总览是落地页（wenlan 侧维护），其后四个组件。 */
const PAGES = [
  {
    id: 'overview',
    title: '总览',
    subtitle: '四个组件的文档配置',
    sourceLabel: 'wenlan/packages/desktop/static/help/sources/overview.md'
  },
  ...SOURCES
]

const normalize = (text) => text.replace(/\r\n/g, '\n').trimEnd() + '\n'
const snapshotPath = (id) => resolve(sourcesDir, `${id}.md`)

const escapeHtml = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * 所有页面快照的内容指纹。写进生成页的 <html data-sources-hash>，让 `--check`
 * 不必重新渲染就能判断「页面是否由当前快照生成」。
 * 这样 CI 护栏只依赖 Node 内置模块，不依赖 marked / 兄弟仓。
 */
const sourcesHash = () => {
  const hash = createHash('sha256')
  for (const page of PAGES) {
    hash.update(page.id + '\n')
    hash.update(normalize(readFileSync(snapshotPath(page.id), 'utf-8')))
    hash.update('\n\u0000\n')
  }
  return hash.digest('hex').slice(0, 16)
}

/** 只在开发者重建页面时才加载 marked（hoisted 依赖，不进 app 运行包）。 */
const renderPage = async () => {
  const { marked } = await import('marked')
  const sections = PAGES.map((page, index) => {
    const md = normalize(readFileSync(snapshotPath(page.id), 'utf-8'))
    // 各文档自带的 H1 与页头重复，去掉第一行标题，正文从「> 依据源码…」开始。
    const body = md.replace(/^#\s+[^\n]*\n+/, '')
    const html = marked.parse(body, { gfm: true, breaks: false, async: false })
    return `      <section class="doc" id="${page.id}" data-index="${index}">
        <div class="source">来源：<code>${escapeHtml(page.sourceLabel)}</code> · 由各项目维护，经 <code>sync-help-docs.mjs</code> 同步</div>
${html}
      </section>`
  }).join('\n')

  const nav = PAGES.map((page) =>
    `        <a href="#${page.id}" data-id="${page.id}" class="nav-item">
          <span class="nav-title">${escapeHtml(page.title)}</span>
          <span class="nav-sub">${escapeHtml(page.subtitle)}</span>
        </a>`
  ).join('\n')

  // 纯 CSS 导航：:target 决定显示哪一节、哪条目录高亮。file:// 下
  // history.replaceState 会抛 SecurityError，内联脚本也可能被 CSP 拦，
  // 所以整页零 JS——只靠锚点 + :has()/:target，离线最稳。
  // 无 hash 时默认高亮总览（body:not(:has(.doc:target))）。
  const activeItemSelectors = PAGES.map(
    (page) => `  body:has(#${page.id}:target) .nav-item[data-id="${page.id}"]`
  ).join(',\n') + `,\n  body:not(:has(.doc:target)) .nav-item[data-id="${PAGES[0].id}"]`
  const activeTitleSelectors = PAGES.map(
    (page) => `  body:has(#${page.id}:target) .nav-item[data-id="${page.id}"] .nav-title`
  ).join(',\n') + `,\n  body:not(:has(.doc:target)) .nav-item[data-id="${PAGES[0].id}"] .nav-title`

  return `<!DOCTYPE html>
<html lang="zh-CN" data-sources-hash="${sourcesHash()}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>文档配置 · 文览帮助</title>
<style>
  :root {
    --paper: #FDFAF3;
    --ink: #1A1A1C;
    --muted: #5F5E5A;
    --line: #D9D5C9;
    --panel: #F4F0E6;
    --accent: #185FA5;
    --code-bg: #F1EFE8;
    --nav-active-bg: #FFFFFF;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif;
    color: var(--ink);
    background: var(--paper);
    font-size: 14px;
    line-height: 1.7;
    -webkit-font-smoothing: antialiased;
  }
  .layout { display: flex; height: 100%; }
  .sidebar {
    width: 244px; flex: 0 0 244px;
    background: var(--panel);
    border-right: 1px solid var(--line);
    display: flex; flex-direction: column;
    overflow-y: auto;
  }
  .brand { padding: 22px 20px 16px; border-bottom: 1px solid var(--line); }
  .brand h1 { margin: 0; font-size: 16px; font-weight: 600; letter-spacing: .02em; }
  .brand p { margin: 4px 0 0; font-size: 12px; color: var(--muted); }
  .nav { padding: 12px 10px; }
  .nav-item {
    display: block; padding: 10px 12px; margin-bottom: 4px;
    border-radius: 8px; text-decoration: none; color: var(--ink);
    border: 1px solid transparent;
  }
  .nav-item:hover { background: rgba(24,95,165,.07); }
  .nav-title { display: block; font-size: 13.5px; font-weight: 600; }
  .nav-sub { display: block; font-size: 11.5px; color: var(--muted); margin-top: 2px; }
  .sidebar-footer { margin-top: auto; padding: 14px 20px; font-size: 11px; color: var(--muted); border-top: 1px solid var(--line); }
  .content { flex: 1; overflow-y: auto; padding: 34px 46px 80px; }
  .doc { max-width: 920px; margin: 0 auto; display: none; }
  .doc:target { display: block; }
  body:not(:has(.doc:target)) #${PAGES[0].id} { display: block; }
${activeItemSelectors} {
    background: var(--nav-active-bg); border-color: var(--line);
  }
${activeTitleSelectors} { color: var(--accent); }
  .source {
    font-size: 12px; color: var(--muted); padding-bottom: 14px;
    margin-bottom: 22px; border-bottom: 1px solid var(--line);
  }
  .source code { font-size: 11.5px; background: var(--code-bg); padding: 1px 5px; border-radius: 4px; }
  h1, h2, h3, h4 { line-height: 1.35; font-weight: 600; }
  h1 { font-size: 25px; margin: 0 0 18px; }
  h2 { font-size: 19px; margin: 34px 0 12px; padding-bottom: 7px; border-bottom: 1px solid var(--line); }
  h3 { font-size: 16px; margin: 24px 0 10px; }
  h4 { font-size: 14px; margin: 18px 0 8px; }
  p { margin: 10px 0; }
  a { color: var(--accent); }
  ul, ol { padding-left: 24px; margin: 10px 0; }
  li { margin: 4px 0; }
  blockquote {
    margin: 14px 0; padding: 10px 16px; background: var(--panel);
    border-left: 3px solid var(--line); color: var(--muted);
  }
  blockquote p { margin: 3px 0; }
  code {
    font-family: "Cascadia Code", Consolas, "SF Mono", monospace;
    font-size: 12.5px; background: var(--code-bg); padding: 1px 5px; border-radius: 4px;
  }
  pre {
    background: var(--code-bg); border: 1px solid var(--line); border-radius: 8px;
    padding: 14px 16px; overflow-x: auto; margin: 14px 0;
  }
  pre code { background: none; padding: 0; font-size: 12.5px; line-height: 1.6; }
  table { border-collapse: collapse; width: 100%; margin: 14px 0 20px; font-size: 13px; display: block; overflow-x: auto; }
  th, td { border: 1px solid var(--line); padding: 8px 11px; text-align: left; vertical-align: top; }
  th { background: var(--panel); font-weight: 600; white-space: nowrap; }
  tbody tr:nth-child(even) { background: rgba(0,0,0,.018); }
  hr { border: none; border-top: 1px solid var(--line); margin: 26px 0; }
  .doc > :first-child { margin-top: 0; }
  @media (prefers-color-scheme: dark) {
    :root { --paper: #1E1E20; --ink: #EDEAE2; --muted: #A8A69F; --line: #3A3A3C; --panel: #27272A; --accent: #85B7EB; --code-bg: #2A2A2D; --nav-active-bg: #1A1A1C; }
    .nav-item:hover { background: rgba(133,183,235,.09); }
    tbody tr:nth-child(even) { background: rgba(255,255,255,.025); }
  }
  @media (max-width: 720px) {
    .layout { flex-direction: column; }
    .sidebar { width: 100%; flex: 0 0 auto; max-height: 190px; border-right: none; border-bottom: 1px solid var(--line); }
    .content { padding: 24px 20px 60px; }
  }
</style>
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">
        <h1>文档配置</h1>
        <p>Frontmatter · 离线帮助</p>
      </div>
      <nav class="nav">
${nav}
      </nav>
      <div class="sidebar-footer">文览生态 · 四份文档分别由各项目维护</div>
    </aside>
    <main class="content">
${sections}
    </main>
  </div>
</body>
</html>
`
}

// ---------------------------------------------------------------------------
// 1. 活拉真源 → 快照
// ---------------------------------------------------------------------------
mkdirSync(sourcesDir, { recursive: true })

const missing = []
const drifted = []
for (const item of SOURCES) {
  const snap = snapshotPath(item.id)
  if (!existsSync(item.src)) {
    // 独立发布 CI 里兄弟仓不在：保留已提交的快照，不视为错误。
    missing.push(item)
    continue
  }
  const source = normalize(readFileSync(item.src, 'utf-8'))
  const current = existsSync(snap) ? normalize(readFileSync(snap, 'utf-8')) : null
  if (current === source) continue
  if (CHECK) {
    drifted.push(item.sourceLabel)
  } else {
    writeFileSync(snap, source, 'utf-8')
    console.log(`已同步 ${item.sourceLabel}`)
  }
}

if (!existsSync(snapshotPath('overview'))) {
  console.error('缺落地页快照 sources/overview.md——它应由 wenlan 侧维护，脚本不生成。')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 2. 校验 / 重建页面
// ---------------------------------------------------------------------------
if (CHECK) {
  // 护栏不渲染、不依赖 marked：只看「源 vs 快照」与「页面指纹 vs 快照指纹」。
  const problems = []
  if (drifted.length) problems.push(`源文档与快照不一致：\n  - ${drifted.join('\n  - ')}`)
  const expectedHash = sourcesHash()
  const currentPage = existsSync(pagePath) ? readFileSync(pagePath, 'utf-8') : ''
  const match = /data-sources-hash="([0-9a-f]{16})"/.exec(currentPage)
  if (!match || match[1] !== expectedHash) {
    problems.push('index.html 不是由当前快照生成的（改了快照忘了重建页面）')
  }
  if (!existsSync(pagePath)) problems.push('index.html 缺失')
  if (problems.length) {
    console.error('帮助文档漂移，请在本仓根目录运行 `node scripts/sync-help-docs.mjs` 并提交产物：\n' + problems.join('\n'))
    process.exit(1)
  }
  console.log(`帮助文档检查通过（${SOURCES.length} 份源文档，${PAGES.length} 个页面）`)
  if (missing.length) {
    console.log(`注意：未找到 ${missing.map((m) => m.sourceLabel).join('、')}，已按已提交快照校验。`)
  }
} else {
  const page = await renderPage()
  writeFileSync(pagePath, page, 'utf-8')
  console.log(`已生成 ${pagePath}`)
  if (missing.length) {
    console.log(`注意：未找到 ${missing.map((m) => m.sourceLabel).join('、')}，沿用已提交快照（独立发布场景属正常）。`)
  }
}
