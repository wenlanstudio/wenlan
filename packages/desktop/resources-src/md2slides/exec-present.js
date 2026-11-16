"use strict";

/**
 * exec-present.js — 「示」视图放映中运行代码块：deck 页面侧执行桥。
 *
 * 归属：运行在 md2slides 的 deck.html 里（与 deck-full.js 同源），由
 * scripts/sync-md2slides.mjs 注入 <script> 并拷入 gitignored 资源包。
 * **不要手改 packages/desktop/resources/ 下的副本**——那是生成物。
 *
 * 分工（三层，跨源 iframe 决定的）：
 *   本文件：装饰 ▶/⏩、结果浮层、输入隔离、postMessage 客户端；零 Node / 零引擎依赖。
 *   Vue 宿主 deckPane.vue：唯一拿得到 docPath 的一层，转 window.mdcode2run IPC。
 *   main 进程：registry 单例引擎 + 子进程（已有，本次零改动）。
 *
 * 行号与连接口径（关键，#18）：deck 的 <pre data-src-start="N"> 中 N 是围栏开栏
 * 行 **1 基**——但那是 md2slides **compose 后文本**上的行号：front-matter 被
 * bodyOf 剥掉（整体提前 F 行）、正文里的「A；B；C。」被 splitSemicolons 展开成
 * 列表（推后 K 行）；而宿主 capability 的 blocks 行号是 **原始 md** 的 0 基行号。
 * 两套坐标系一有 front-matter/分号段就对不上——旧行号包含匹配会把 ▶ 挂到隔壁
 * 围栏上，引擎跑错块（hive 报错只是症状）。所以 pre→块 的连接改按 **内容**：
 * blocks 带围栏体正文 code（宿主 deckPane 从原始 md 切出，与引擎执行体同构），
 * ① 整块 pre 正文与 code 全等；② 分页续片（正文 = code 的整行子串）取行号距离
 * 最近者消歧；③ 宿主没带 code / 内容对不上时退回旧行号区间包含兜底。匹配到的
 * 块开栏行 b.line 发回宿主——与引擎 locate({line}) 的 **0 基** 区间同口径。
 *
 * 契约：
 *   宿主→页  md2s:exec-capability { docPath, enabled, blocks:[{line,end,runnable,lang,job,replayable,code}] }
 *   页→宿主  md2s:exec { reqId, docPath, line, replay }
 *   宿主→页  md2s:exec-state { reqId, event } / md2s:exec-result { reqId, result }
 *            / md2s:exec-error { reqId, error }
 *   页→宿主  md2s:exec-stop { reqId, docPath, jobId } / md2s:exec-cancel { reqId }
 *   宿主→页  md2s:export（已有）→ 顺手关浮层，别让结果条留在出片里
 *   宿主→页  md2s:follow { page, locked } —— 课堂跟随：对齐到老师那一页；
 *            locked 时吃掉导航键（学生端只读跟随）。与 ▶ 桥同源：跨源宿主
 *            只有本文件能直调 window.deckFull.getPlayer()。
 *
 * 安全：▶ 等于在本机执行任意代码。首次对某文档点 ▶ 先在浮层里确认一次，
 * 确认结果按 docPath 记在 sessionStorage（本次会话有效）；未保存文档由宿主
 * 下发 enabled:false，根本不注入 ▶。
 */
(function () {
  var CSS_ID = "md2s-exec-css";
  var CONFIRM_KEY = "md2s-exec-confirmed";
  var MAX_STREAM = 20000;
  var KIND_LABEL = { figure: "图形", table: "表格", text: "输出", none: "无返回值", job: "作业" };

  /* 结果浮层 = 居中覆盖的「半透明深色玻璃卡片」：形态参考 Typora 旧版
     code-exec/deck-out.js（#0d1117 / 圆角 10px / 状态条 / ✕ 收起），但背景半透明 +
     backdrop-filter，让被盖住的代码仍透得出来；◐ 可在三档透明度间循环。
     内部颜色/背景仍全部显式钉死，主题的 table/pre 样式不会渗进来。 */
  var EXEC_CSS = [
    ".md2s-exec-run { position: absolute; top: 6px; right: 10px; z-index: 30; cursor: pointer;",
    "  font-size: 1em; line-height: 1; padding: 0.15em 0.5em; color: #e6e6e6; opacity: 0.85;",
    "  background: rgba(30, 30, 30, 0.88); border: 1px solid #3c3c3c; border-radius: 0.25em;",
    "  user-select: none; }",
    ".md2s-exec-run:hover { opacity: 1; color: #ff9d2e; border-color: #ff9d2e; }",
    ".md2s-exec-run.md2s-step-current { opacity: 1; color: #ff6a3c; border-color: #ff6a3c;",
    "  box-shadow: 0 0 0.4em rgba(255, 190, 40, 0.75); }",
    ".md2s-exec-replay { right: calc(10px + 2.8em); }",
    ".md2s-exec-overlay { position: fixed; top: 7%; left: 7%; right: 7%; bottom: 7%; z-index: 100000;",
    "  display: flex; flex-direction: column; max-height: none;",
    "  background: rgba(13, 17, 23, 0.68); color: #d1d5db;",
    "  border: 1px solid rgba(90, 100, 115, 0.55); border-radius: 10px;",
    "  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);",
    /* 模糊压到 2px：6px 会把背后的代码糊成光斑，「透出来」等于没透（真浏览器截图实测）。 */
    "  backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px);",
    "  font-size: 13px; overflow: hidden; }",
    "/* ◐ 三档透明度：1=默认 68%（代码可辨），0=52% 更通透，2=94% 结果优先。 */",
    ".md2s-exec-overlay.md2s-exec-alpha-0 { background: rgba(13, 17, 23, 0.52);",
    "  backdrop-filter: blur(1px); -webkit-backdrop-filter: blur(1px); }",
    ".md2s-exec-overlay.md2s-exec-alpha-2 { background: rgba(13, 17, 23, 0.94);",
    "  backdrop-filter: none; -webkit-backdrop-filter: none; }",
    "/* 分栏态：代码与结果并排、互不遮挡，强制实心免得两层文字打架。 */",
    ".md2s-exec-overlay.md2s-exec-split { left: auto; right: 0; top: 0; bottom: 0; width: 44%;",
    "  max-height: 100%; border-radius: 0; border-top: none; border-right: none; border-bottom: none;",
    "  background: rgba(13, 17, 23, 0.97) !important;",
    "  backdrop-filter: none; -webkit-backdrop-filter: none; }",
    "section.md2s-exec-split { padding-right: 46% !important; }",
    ".md2s-exec-head { flex: none; display: flex; align-items: center; gap: 8px;",
    "  padding: 6px 10px; background: rgba(30, 34, 42, 0.86);",
    "  border-bottom: 1px solid #21262d; cursor: default; }",
    ".md2s-exec-title { font-weight: 600; color: #eee; }",
    ".md2s-exec-session { color: #9cdcfe; }",
    ".md2s-exec-status { margin-left: auto; color: #9cdcfe; font-variant-numeric: tabular-nums; }",
    ".md2s-exec-status.md2s-exec-busy { color: #f0a868; }",
    ".md2s-exec-status.md2s-exec-ok { color: #6ad08b; }",
    ".md2s-exec-status.md2s-exec-fail { color: #f48771; }",
    ".md2s-exec-close { cursor: pointer; color: #bbb; padding: 0 4px; }",
    ".md2s-exec-close:hover { color: #fff; }",
    "/* 焦点遍历的可见性：翻页笔走到的头钮要有圈，不然投影上看不出焦点在哪。 */",
    ".md2s-exec-head [tabindex='-1']:focus { outline: 1px solid #7ab3d9; outline-offset: 2px; }",
    ".md2s-exec-splitbtn { cursor: pointer; color: #bbb; padding: 0 6px; font-size: 1.1em; }",
    ".md2s-exec-splitbtn:hover { color: #fff; }",
    ".md2s-exec-splitbtn.md2s-exec-on { color: #ff9d2e; }",
    ".md2s-exec-alphabtn { cursor: pointer; color: #bbb; padding: 0 6px; font-size: 1.1em; }",
    ".md2s-exec-alphabtn:hover { color: #fff; }",
    ".md2s-exec-alphabtn.md2s-exec-on { color: #9cdcfe; }",
    ".md2s-exec-stop { cursor: pointer; color: #f48771; padding: 0 4px; }",
    ".md2s-exec-body { flex: 1 1 auto; overflow: auto; padding: 8px 12px; }",
    ".md2s-exec-body pre { margin: 0 0 8px; font-family: Consolas, monospace;",
    "  line-height: 1.5; white-space: pre-wrap; word-break: break-word;",
    "  color: #d4d4d4 !important; background: transparent !important; }",
    ".md2s-exec-error { color: #f48771 !important; }",
    ".md2s-exec-note { color: #9aa4b2 !important; }",
    ".md2s-exec-body img { display: block; max-width: 100%; background: #fff; border-radius: 4px; margin: 6px 0; }",
    ".md2s-exec-body table { border-collapse: collapse !important; margin: 6px 0; font-size: 0.95em;",
    "  background: rgba(13, 17, 23, 0.35) !important; color: #d1d5db !important; }",
    ".md2s-exec-body th, .md2s-exec-body td { border: 1px solid #30363d !important;",
    "  padding: 0.3em 0.9em; text-align: left; }",
    "/* !important 压过 renderTable 里跟随主题的内联底色，整张表也透得出代码。 */",
    ".md2s-exec-body th { background: rgba(42, 47, 56, 0.9) !important; }",
    ".md2s-exec-body td { color: #d4d4d4 !important; background: transparent !important; }",
    ".md2s-exec-body .md2s-exec-null { color: #6a737d !important; }",
    ".md2s-exec-confirm { display: flex; align-items: center; gap: 12px; flex-wrap: wrap;",
    "  padding: 4px 0 10px; color: #e8c98a !important; }",
    ".md2s-exec-confirm span { flex: 1 1 240px; }",
    ".md2s-exec-confirm button { flex: none; border: 1px solid #ba7517; border-radius: 4px;",
    "  padding: 4px 14px; background: #3a2a12; color: #ffd79a; font-size: 0.95em; cursor: pointer; }",
    ".md2s-exec-confirm button:hover { background: #543c17; }"
  ].join("\n");

  var capability = { docPath: "", enabled: false, blocks: [] };
  var overlay = null;    // 当前浮层控制器（单例）
  var activeRun = null;  // { reqId, line, replay, docPath, started, ... }
  var reqSeq = 0;
  var thStyle = null;

  var post = function (msg) {
    try { window.parent.postMessage(msg, "*"); } catch (e) { /* 宿主已卸载 */ }
  };

  /** 过滤 JShell 变量声明回显（s1 ==> "apple"）——纯展示层，不动引擎日志。 */
  var stripVarEcho = function (s) {
    return (s == null ? "" : String(s)).split(/\r?\n/)
      .filter(function (line) { return !/^\s*(?:\|\s*)?[\w$.]+\s*==>/.test(line); })
      .join("\n");
  };

  var confirmedList = function () {
    try {
      var v = JSON.parse(window.sessionStorage.getItem(CONFIRM_KEY) || "[]");
      return Object.prototype.toString.call(v) === "[object Array]" ? v : [];
    } catch (e) { return []; }
  };
  var isConfirmed = function (docPath) { return confirmedList().indexOf(docPath) >= 0; };
  var markConfirmed = function (docPath) {
    try {
      var list = confirmedList();
      if (list.indexOf(docPath) < 0) list.push(docPath);
      window.sessionStorage.setItem(CONFIRM_KEY, JSON.stringify(list));
    } catch (e) { /* 隐私模式下退化为每次都确认，不影响功能 */ }
  };

  var injectCss = function () {
    if (document.getElementById(CSS_ID)) return;
    var style = document.createElement("style");
    style.id = CSS_ID;
    style.textContent = EXEC_CSS;
    document.head.appendChild(style);
  };

  /** 表头跟随主题：量 deck 里真实 th 的渲染值，量不到回退深灰。 */
  var measureTh = function () {
    try {
      var sample = document.querySelector("section th");
      var cs = sample && window.getComputedStyle(sample);
      var bg = cs && cs.backgroundColor;
      if (sample && bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
        thStyle = { bg: bg, fg: cs.color || "#eee" };
      }
    } catch (e) { /* 无布局环境保持回退 */ }
  };

  // ── 装饰 ────────────────────────────────────────────────────────────────

  /* pre → 块 的连接（内容优先，行号兜底）。理由见文件头「行号与连接口径」。 */
  var normCode = function (s) {
    return String(s == null ? "" : s).replace(/\r\n/g, "\n").replace(/\s+$/, "");
  };
  /* 整行子串：命中处左边界是串首或 \n、右边界是串尾或 \n——续片是围栏体的
     连续整行切片（md2slides overflow.js 逐行搬 textContent），松 indexOf 会把
     行中片段也算进去。 */
  var containsLineSlice = function (body, slice) {
    var i = body.indexOf(slice);
    while (i >= 0) {
      var before = i === 0 ? "\n" : body.charAt(i - 1);
      var after = i + slice.length >= body.length ? "\n" : body.charAt(i + slice.length);
      if (before === "\n" && after === "\n") return true;
      i = body.indexOf(slice, i + 1);
    }
    return false;
  };
  var matchBlock = function (blocks, content, srcLine) {
    var c = normCode(content);
    if (!c) return null;
    var i, b, bc, d, best = null, bestDist = Infinity;
    for (i = 0; i < blocks.length; i++) {
      b = blocks[i];
      if (b.code != null && normCode(b.code) === c) return b;
    }
    for (i = 0; i < blocks.length; i++) {
      b = blocks[i];
      if (b.code == null) continue;
      bc = normCode(b.code);
      if (bc && bc !== c && containsLineSlice(bc, c)) {
        d = Math.abs(srcLine - b.line);
        if (d < bestDist) { best = b; bestDist = d; }
      }
    }
    if (best) return best;
    for (i = 0; i < blocks.length; i++) {
      b = blocks[i];
      if (srcLine >= b.line && srcLine < b.end) return b;
    }
    return null;
  };

  var makeBtn = function (extraClass, text, title, onClick) {
    var el = document.createElement("div");
    el.className = "md2s-exec-run" + (extraClass ? " " + extraClass : "");
    el.textContent = text;
    el.title = title;
    // player 的 P4-a 契约：Enter / activate() 派发 click，翻页笔可逐元素走到 ▶。
    el.setAttribute("data-md2s-activatable", "");
    el.addEventListener("click", function (ev) { ev.stopPropagation(); onClick(); });
    return el;
  };

  var decorate = function (cap) {
    capability = {
      docPath: String(cap.docPath || ""),
      enabled: !!cap.enabled,
      blocks: Array.isArray(cap.blocks) ? cap.blocks : []
    };
    injectCss();
    measureTh();
    if (!capability.enabled) return;

    var blocks = capability.blocks.filter(function (b) { return b && b.runnable; });
    var injected = 0;
    var preList = document.querySelectorAll("pre > code[class*='language-']");
    Array.prototype.forEach.call(preList, function (code) {
      var pre = code.closest ? code.closest("pre") : code.parentElement;
      if (!pre || pre.querySelector(".md2s-exec-run")) return;
      var n = Number(pre.getAttribute("data-src-start"));
      if (!isFinite(n) || n <= 0) return;
      // composed 口径的 0 基行号：只作消歧提示与兜底（见 matchBlock）。
      var line = n - 1;
      // 内容优先连接：续片是整行子串，整块是全等（#18 坐标系错位修复）。
      var b = matchBlock(blocks, code.textContent, line);
      if (!b) return;
      try {
        if (window.getComputedStyle(pre).position === "static") pre.style.position = "relative";
      } catch (e) { pre.style.position = "relative"; }

      pre.appendChild(makeBtn("", "▶", "运行完整代码块（不受分页切片影响；聚焦后按 Enter 也可触发）",
        function () { startRun(b.line, false, b.lang); }));
      injected += 1;
      if (b.replayable) {
        pre.appendChild(makeBtn("md2s-exec-replay", "⏩", "从本章开头连跑到这里（重放）",
          function () { startRun(b.line, true, b.lang); }));
      }
    });
    // 装饰后必须重建步进表，否则 ▶ 进不了翻页笔的步序列。
    if (injected) {
      try {
        var player = window.deckFull && window.deckFull.getPlayer && window.deckFull.getPlayer();
        if (player && player.refreshSteps) player.refreshSteps();
      } catch (e) { /* 播放器尚未就绪：下次 ready 会再装饰 */ }
    }
  };

  // ── 结果浮层 ────────────────────────────────────────────────────────────

  var askOthersToDismiss = function () {
    try {
      window.dispatchEvent(new CustomEvent("md2s-overlay-dismiss", { detail: { by: "exec" } }));
    } catch (e) { /* 老环境无 CustomEvent */ }
  };

  /** 浮层的模态键盘——翻页笔控制与 kit/lightbox.js 对齐（2026-11-14）：
   *  开着时拦下导航键（页码冻结，关闭即回原页原步）；PgDn/↓/Tab=头部按钮焦点
   *  遍历（到边界停住），PgUp/↑ 反向；确定键（Enter/空格，很多翻页笔发空格）=
   *  按下聚焦的按钮；焦点不在按钮上时：确认态=确认运行、已完成=收起、
   *  **运行中=空操作**——确定键不该误杀正在跑的作业（想停就翻页键走到「终止」
   *  再确定，那是明确意图）。挂 window capture 抢在播放器 keyTarget 之前，
   *  与 lightbox 同层；两者靠 md2s-overlay-dismiss 互斥，不会同时开着。
   *  Ctrl 组合键（复制输出）不在拦截之列，照常放行——lightbox 没有可复制物，
   *  全拦无妨；这里的 body 是运行结果，得能 Ctrl+C。 */
  var SWALLOW_KEYS = { Home: 1, End: 1, ArrowLeft: 1, ArrowRight: 1, Backspace: 1 };

  /** 头部可聚焦钮（DOM 序 = [终止] ◐ ⇆ ✕ 收起）。tabindex=-1 不进原生 Tab 序，
   *  焦点全由本层的翻页键遍历与完成态聚焦掌握。 */
  var focusablesOf = function () {
    if (!overlay || !overlay.el) return [];
    var head = overlay.el.querySelector(".md2s-exec-head");
    return head ? Array.prototype.slice.call(head.querySelectorAll("[tabindex='-1']")) : [];
  };

  /** 完成态把焦点交给 ✕ 收起：结果一出来按确定就收（lightbox「默认落在 ✕」同款）。 */
  var focusCloseBtn = function () {
    var list = focusablesOf();
    if (list.length) list[list.length - 1].focus();
  };

  /** 翻页键移动焦点：到边界停住（lightbox 同款）。焦点在浮层外时 PgDn 进第一个、PgUp 进最后一个。 */
  var moveFocus = function (dir) {
    var list = focusablesOf();
    if (!list.length) return;
    var i = list.indexOf(document.activeElement);
    if (i < 0) i = dir > 0 ? -1 : list.length;
    list[Math.min(list.length - 1, Math.max(0, i + dir))].focus();
  };

  var onKey = function (ev) {
    if (!overlay) return;
    switch (ev.key) {
      case "Escape":
        closeOverlay();
        break;
      case "PageDown": case "ArrowDown": case "Tab":
        moveFocus(ev.shiftKey ? -1 : 1);
        break;
      case "PageUp": case "ArrowUp":
        moveFocus(-1);
        break;
      case "Enter": case " ": {
        if (overlay.confirmMode && overlay.confirmRun) {
          overlay.confirmRun();
          break;
        }
        var list = focusablesOf();
        var i = list.indexOf(document.activeElement);
        if (i >= 0) list[i].click();
        else if (overlay.done) closeOverlay();
        break;
      }
      default:
        if (!SWALLOW_KEYS[ev.key]) return;  // 无导航含义的键放行
        break;
    }
    if (ev.cancelable) ev.preventDefault();
    ev.stopPropagation();
  };

  var createOverlay = function (title, lang) {
    var el = document.createElement("div");
    el.className = "md2s-exec-overlay";
    // 静态骨架，不带任何文档数据；标题走 textContent，杜绝 info-string 注入。
    el.innerHTML = [
      '<div class="md2s-exec-head">',
      '  <span class="md2s-exec-title"></span>',
      '  <span class="md2s-exec-session"></span>',
      '  <span class="md2s-exec-status md2s-exec-busy">准备中…</span>',
      '  <span class="md2s-exec-alphabtn" tabindex="-1" title="切换背景透明度">◐</span>',
      '  <span class="md2s-exec-splitbtn" tabindex="-1" title="切换 居中浮层 / 左右分栏">⇆</span>',
      '  <span class="md2s-exec-close" tabindex="-1" title="关闭（Esc；确定键按下聚焦钮）">✕ 收起</span>',
      '</div>',
      '<div class="md2s-exec-body"></div>'
    ].join("");
    el.querySelector(".md2s-exec-title").textContent = title + " · " + (lang || "code");
    document.body.appendChild(el);

    // 字号跟随幻灯片：投屏上写死 13px 是蚂蚁字；封顶 24 免得大表格爆炸。
    try {
      var sample = document.querySelector("section pre");
      var slideFs = sample ? parseFloat(window.getComputedStyle(sample).fontSize) : 0;
      if (slideFs > 0) el.style.fontSize = Math.max(12, Math.min(24, Math.round(slideFs * 0.8))) + "px";
    } catch (e) { /* 保持 CSS 默认 */ }

    var statusEl = el.querySelector(".md2s-exec-status");
    var sessionEl = el.querySelector(".md2s-exec-session");
    var body = el.querySelector(".md2s-exec-body");
    var splitBtn = el.querySelector(".md2s-exec-splitbtn");
    var alphaBtn = el.querySelector(".md2s-exec-alphabtn");
    var sec = document.querySelector("section.md2s-current");
    var splitMode = false;
    var alphaLevel = 1;  // 1=68% 默认；0=52% 更透；2=94% 近实心
    var ALPHA_LABEL = ["52% 通透", "68% 默认", "94% 实心"];

    // 浮层是覆盖在代码之上的：背景半透明，文字/表格保持清晰；◐ 循环三档。
    var applyAlpha = function () {
      el.classList.remove("md2s-exec-alpha-0", "md2s-exec-alpha-1", "md2s-exec-alpha-2");
      el.classList.add("md2s-exec-alpha-" + alphaLevel);
      alphaBtn.classList.toggle("md2s-exec-on", alphaLevel !== 1);
      alphaBtn.title = "背景透明度：" + ALPHA_LABEL[alphaLevel] + "（点按循环切换）";
    };

    var restoreSec = function () {
      if (!sec) return;
      sec.classList.remove("md2s-exec-split");
      sec.style.paddingBottom = "";
      sec.style.paddingRight = "";
    };
    var enableSplit = function () {
      splitMode = true;
      if (sec) {
        sec.style.paddingBottom = "";
        sec.style.paddingRight = "46%";
        sec.classList.add("md2s-exec-split");
      }
      el.classList.add("md2s-exec-split");
      splitBtn.classList.add("md2s-exec-on");
      alphaBtn.title = "分栏态下无需透明度；点 ⇆ 回到居中浮层";
    };
    // 居中覆盖：不再给 section 让位（那会把代码顶走），靠透明度让代码透出来。
    var applyFloat = function () {
      splitMode = false;
      el.classList.remove("md2s-exec-split");
      splitBtn.classList.remove("md2s-exec-on");
      restoreSec();
      applyAlpha();
    };
    var applyLayout = function () { return splitMode ? enableSplit() : applyFloat(); };
    applyAlpha();

    el.querySelector(".md2s-exec-close").addEventListener("click", function () { closeOverlay(); });
    alphaBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (splitMode) applyFloat();  // 分栏态点 ◐ 先回到居中浮层，再改透明度
      alphaLevel = (alphaLevel + 2) % 3;  // 1 → 0 → 2 → 1
      applyAlpha();
    });
    splitBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      splitMode = !splitMode;
      applyLayout();
    });
    window.addEventListener("keydown", onKey, true);
    askOthersToDismiss();

    return {
      el: el,
      body: body,
      statusEl: statusEl,
      sessionEl: sessionEl,
      confirmMode: false,
      confirmRun: null,
      /** 终态标记：结果/错误/作业完结后为 true——确定键的兜底语义（收起）只在
       *  终态生效，运行中空操作防误杀。 */
      done: false,
      setStatus: function (text, cls) {
        statusEl.className = "md2s-exec-status " + (cls || "");
        statusEl.textContent = text;
      },
      applyLayout: applyLayout,
      destroy: function () {
        window.removeEventListener("keydown", onKey, true);
        restoreSec();
        el.remove();
      }
    };
  };

  var closeOverlay = function () {
    var o = overlay;
    if (!o) return;
    overlay = null;
    var r = activeRun;
    if (r) {
      // 作业是常驻子进程：关面板就终止，别留后台无声运行。
      if (r.jobId && !r.jobDone) {
        post({ type: "md2s:exec-stop", reqId: r.reqId, docPath: r.docPath, jobId: r.jobId });
      }
      post({ type: "md2s:exec-cancel", reqId: r.reqId });
      if (r.timer) clearInterval(r.timer);
    }
    activeRun = null;
    o.destroy();
    // 焦点还给播放器容器（lightbox onClose → rootOf().focus() 同款）：翻页笔的
    // 下一次确定键回到播放器手里，不会误触页面上别的可激活元素。
    try {
      var deckEl = document.getElementById("deck");
      (deckEl || document.body).focus();
    } catch (e) { /* jsdom */ }
  };

  var ensureStream = function () {
    var r = activeRun;
    if (!r || !overlay) return null;
    if (!r.streamEl) {
      r.streamEl = document.createElement("pre");
      overlay.body.insertBefore(r.streamEl, overlay.body.firstChild);
    }
    return r.streamEl;
  };

  // ── 运行 ────────────────────────────────────────────────────────────────

  var showConfirm = function (o, onConfirm) {
    var box = document.createElement("div");
    box.className = "md2s-exec-confirm";
    var hint = document.createElement("span");
    hint.textContent = "运行讲义代码会在本机执行子进程。仅在信任此文档时继续。";
    var btn = document.createElement("button");
    btn.textContent = "允许并运行";
    btn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      if (o.confirmRun) o.confirmRun();
    });
    box.appendChild(hint);
    box.appendChild(btn);
    o.body.appendChild(box);
    try { btn.focus(); } catch (e) { /* jsdom */ }  // 确定键直落在「允许并运行」上
    o.confirmMode = true;
    o.confirmRun = function () {
      if (!o.confirmMode) return;
      o.confirmMode = false;
      o.confirmRun = null;
      box.remove();
      onConfirm();
    };
    o.setStatus("等待确认", "md2s-exec-busy");
  };

  var beginExec = function (reqId) {
    var r = activeRun;
    if (!r || r.reqId !== reqId || r.startedExec) return;
    r.startedExec = true;
    if (overlay) { overlay.confirmMode = false; overlay.confirmRun = null; }
    post({ type: "md2s:exec", reqId: reqId, docPath: r.docPath, line: r.line, replay: r.replay });
  };

  var startRun = function (line, replay, lang) {
    closeOverlay();
    var o = createOverlay(replay ? "⏩ 重放" : "▶ 运行", lang);
    overlay = o;
    var reqId = "e" + (++reqSeq);
    activeRun = {
      reqId: reqId, line: line, replay: !!replay, docPath: capability.docPath,
      started: Date.now(), startedExec: false, jobId: null, jobDone: false,
      timer: null, streamEl: null, streamBuf: "", streamChars: 0
    };
    if (!isConfirmed(capability.docPath)) {
      showConfirm(o, function () { markConfirmed(capability.docPath); beginExec(reqId); });
    } else {
      o.setStatus("运行中…", "md2s-exec-busy");
      beginExec(reqId);
    }
  };

  // ── 结果渲染 ────────────────────────────────────────────────────────────

  var renderTable = function (rows, maxRows) {
    var head = thStyle || { bg: "#2a2a2a", fg: "#eee" };
    var table = document.createElement("table");
    var thead = document.createElement("thead");
    var hr = document.createElement("tr");
    (rows.columns || []).forEach(function (c) {
      var th = document.createElement("th");
      th.textContent = c;
      th.style.backgroundColor = head.bg;
      th.style.color = head.fg;
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = document.createElement("tbody");
    var cells = rows.cells || [];
    cells.slice(0, maxRows || 20).forEach(function (row) {
      var tr = document.createElement("tr");
      for (var i = 0; i < (rows.columns || []).length; i++) {
        var td = document.createElement("td");
        var cell = row[i];
        td.textContent = cell == null ? "NULL" : String(cell);
        if (cell == null || cell === "NULL") td.className = "md2s-exec-null";
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    if (cells.length > (maxRows || 20)) {
      var foot = document.createElement("tfoot");
      var fr = document.createElement("tr");
      var td = document.createElement("td");
      td.colSpan = (rows.columns || []).length;
      td.textContent = "… 共 " + cells.length + " 行（已显示前 " + (maxRows || 20) + "）";
      fr.appendChild(td);
      foot.appendChild(fr);
      table.appendChild(foot);
    }
    return table;
  };

  var renderResult = function (result) {
    if (!overlay) return;
    var body = overlay.body;
    (result.images || []).forEach(function (src) {
      var img = document.createElement("img");
      img.src = src;
      body.appendChild(img);
    });
    if (result.rows && result.rows.columns && result.rows.columns.length) {
      body.appendChild(renderTable(result.rows));
    }
    var note = stripVarEcho(result.text || "");
    if (note.trim()) {
      var pre = document.createElement("pre");
      pre.className = "md2s-exec-note";
      pre.textContent = note;
      body.appendChild(pre);
    }
    if (!result.ok && result.error) {
      var err = document.createElement("pre");
      err.className = "md2s-exec-error";
      err.textContent = result.error;
      body.appendChild(err);
    }
    if (result.session) {
      var s = result.session;
      overlay.sessionEl.textContent = "〔" + (s.chapter || "本章") + " · " +
        (s.replayed ? "重放" : "会话") + " " + s.ran + "/" + s.total +
        (s.stale > 0 ? " · 过期" + s.stale : "") + "〕";
    }
    body.scrollTop = body.scrollHeight;
  };

  var handleState = function (reqId, event) {
    var r = activeRun;
    if (!r || r.reqId !== reqId || !overlay || !event) return;
    if (event.type === "started") {
      overlay.setStatus("运行中…", "md2s-exec-busy");
    } else if (event.type === "chunk") {
      if (event.stream !== "stdout" || r.streamChars > MAX_STREAM) return;
      r.streamChars += String(event.text || "").length;
      r.streamBuf += String(event.text || "");
      var s = ensureStream();
      if (s) s.textContent = stripVarEcho(r.streamBuf);
      overlay.body.scrollTop = overlay.body.scrollHeight;
      overlay.applyLayout();
    } else if (event.type === "job-done") {
      var o = event.outcome || {};
      if (r.timer) { clearInterval(r.timer); r.timer = null; }
      var stopBtn = overlay.statusEl.parentElement.querySelector(".md2s-exec-stop");
      if (stopBtn) stopBtn.remove();
      var secs = ((o.durationMs || 0) / 1000).toFixed(1);
      var label = o.killed ? "已终止 · " + secs + "s"
        : o.code === 0 ? "完成 · " + secs + "s" : "退出码 " + o.code + " · " + secs + "s";
      overlay.setStatus(label, o.killed || o.code !== 0 ? "md2s-exec-fail" : "md2s-exec-ok");
      if (o.error) {
        var err = document.createElement("pre");
        err.className = "md2s-exec-error";
        err.textContent = o.error;
        overlay.body.appendChild(err);
      }
      r.jobDone = true;
      o.done = true;
      focusCloseBtn();  // 作业完结：确定键即可收起
      overlay.applyLayout();
    }
    // done：结算统一交给 md2s:exec-result（避免与 result 抢状态）
  };

  var handleResult = function (reqId, result) {
    var r = activeRun;
    if (!r || r.reqId !== reqId || !overlay || !result) return;
    var o = overlay;
    if (result.kind === "job" && result.job) {
      r.jobId = result.job.id;
      r.jobDone = false;
      o.setStatus("作业运行中 · 0.0s", "md2s-exec-busy");
      r.timer = setInterval(function () {
        if (activeRun === r && overlay === o) {
          o.setStatus("作业运行中 · " + ((Date.now() - r.started) / 1000).toFixed(1) + "s", "md2s-exec-busy");
        }
      }, 500);
      var stop = document.createElement("span");
      stop.className = "md2s-exec-stop";
      stop.tabIndex = -1;  // 进头部焦点遍历：翻页笔可走到「终止」再确定
      stop.textContent = "终止";
      stop.title = "终止作业进程（Windows 上按进程树终止）";
      stop.addEventListener("click", function () {
        stop.textContent = "终止中…";
        post({ type: "md2s:exec-stop", reqId: reqId, docPath: r.docPath, jobId: r.jobId });
      });
      o.statusEl.parentElement.insertBefore(stop, o.statusEl);
      renderResult({ ok: result.ok, text: result.text });
      o.applyLayout();
      return;
    }
    var secs = ((Date.now() - r.started) / 1000).toFixed(1);
    o.done = true;  // 同步执行的终态：确定键兜底=收起
    if (!result.ok) {
      o.setStatus("失败", "md2s-exec-fail");
    } else {
      o.setStatus((KIND_LABEL[result.kind] || result.kind) + " · " + secs + "s", "md2s-exec-ok");
      if (result.kind === "table") {
        /* 表格已表达全部行列：原始 TSV 流（含 beeline 横幅）收掉——
           同一份数据显示两遍是噪声，不是「日志」。text/none 维持原文展示。 */
        if (r.streamEl) { r.streamEl.remove(); r.streamEl = null; }
        r.streamBuf = "";
      } else if (result.stdout) {
        var s = ensureStream();
        if (s && !s.textContent.trim()) {
          r.streamBuf = result.stdout;
          s.textContent = stripVarEcho(r.streamBuf);
        }
      }
    }
    renderResult(result);
    focusCloseBtn();  // 结果一出来焦点落 ✕：确定键即可收起
    o.applyLayout();
  };

  var handleError = function (reqId, message) {
    var r = activeRun;
    if (!r || r.reqId !== reqId || !overlay) return;
    overlay.done = true;
    overlay.setStatus("失败", "md2s-exec-fail");
    var err = document.createElement("pre");
    err.className = "md2s-exec-error";
    err.textContent = String(message || "执行失败");
    overlay.body.appendChild(err);
    focusCloseBtn();
    overlay.applyLayout();
  };

  // ── 课堂跟随（学生端）──────────────────────────────────────────────────
  // 宿主 deckPane 收到 ws 的 teaching.session.page 后发 md2s:follow；本层直调
  // player.go(1 基页号)。跨源宿主碰不到 iframe DOM，能直调 player 的只有这里
  // ——与 ▶ 桥同一条理由（见文件头），所以跟随也落在本文件，不进 deck-full.js。
  //
  // locked = 服务端 followLocked（课堂锁定跟随）：
  //   锁 → 导航键在 capture 阶段吃掉，学生翻不走，页永跟老师；
  //   不锁 → 只跟不锁，学生可自己翻，老师下次翻页再对齐。
  // 回弹由宿主做（它有 md2s:change），本层只管对齐与拦键。

  var follow = { page: 0, locked: false };

  var deckPlayer = function () {
    try {
      return window.deckFull && window.deckFull.getPlayer ? window.deckFull.getPlayer() : null;
    } catch (e) { return null; }
  };

  /** 返回是否真的对齐了。播放器还没起来（build 未完成）就返回 false，等下次 ready。 */
  var followTo = function (page) {
    if (!page || page < 1) return false;
    var player = deckPlayer();
    if (!player || typeof player.go !== "function") return false;
    if (player.index === page) return true;
    try { player.go(page); return true; } catch (e) { return false; }
  };

  var NAV_KEYS = {
    ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1,
    PageUp: 1, PageDown: 1, Home: 1, End: 1, " ": 1, Spacebar: 1
  };

  /* player 的 keyTarget 是 #deck，事件从 window 捕获下来先到本层；stopPropagation
     后它收不到。结果浮层也会 capture 拦 Enter/Esc，但那是另一个键集，互不遮挡。 */
  var onFollowKey = function (ev) {
    if (!follow.locked) return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (!NAV_KEYS[ev.key]) return;
    ev.preventDefault();
    ev.stopPropagation();
  };
  document.addEventListener("keydown", onFollowKey, true);

  var applyFollow = function (d) {
    follow.locked = d.locked === true;
    var page = Number(d.page) || 0;
    if (page) follow.page = page;
    followTo(follow.page);
  };


  // ══ 课堂发题（2026-11-16）：页面注入模式 ═══════════════════════════════
  // 「发题」按钮与两栏浮层（左题右实况）都在 deck 页面内——跟幻灯片融为一体，
  // 独占态自然可见；宿主（deckPane）只当数据桥：quiz-open 请求发题、quiz-state
  // 推实况/揭晓投影。模态锁页与执行浮层同一纪律：浮层开着导航键全拦（题目
  // 做完才往下讲），Esc 关浮层恢复翻页。选项是本班显示序（opened 广播投影），
  // 与学生看到的一致；页面侧不含答案字段（揭晓的 answer 由宿主投影下发）。

  var QUIZ_CSS_ID = "md2s-quiz-css";
  var quizEnabled = false;
  var quizOverlay = null;   // { el, questionKey }
  var quizState = null;     // 宿主投影（md2s:quiz-state）
  var quizTick = null;

  var QUIZ_CSS = [
    ".md2s-quiz-launch { display: inline-block; margin-top: 10px; padding: 6px 16px;",
    "  cursor: pointer; font-size: 0.95em; color: #fff; background: #2b8a3e;",
    "  border: 1px solid #237a36; border-radius: 6px; }",
    ".md2s-quiz-launch:hover { background: #237a36; }",
    ".md2s-quiz-launch:disabled { opacity: 0.55; cursor: default; }",
    ".md2s-quiz-ov { position: fixed; inset: 0; z-index: 120000;",
    "  background: rgba(15, 25, 40, 0.55); display: flex;",
    "  align-items: center; justify-content: center; }",
    ".md2s-quiz-card { width: min(900px, 88vw); max-height: 80vh; display: flex;",
    "  background: #fff; border-radius: 14px; overflow: hidden;",
    "  box-shadow: 0 12px 48px rgba(15, 25, 40, 0.35); }",
    ".md2s-quiz-l { flex: 1.2; padding: 22px 24px; border-right: 1px solid #e3e8ee;",
    "  overflow: auto; color: #22303f; }",
    ".md2s-quiz-r { flex: 1; padding: 22px 24px; display: flex; flex-direction: column;",
    "  justify-content: center; gap: 14px; background: #f7f9fb; color: #33414f; }",
    ".md2s-quiz-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }",
    ".md2s-quiz-key { font-size: 12px; color: #2b6cb0; background: #e8f0fa;",
    "  border-radius: 4px; padding: 2px 8px; }",
    ".md2s-quiz-limit { font-size: 12px; color: #8a5a00; background: #fdf3e0;",
    "  border-radius: 4px; padding: 2px 8px; }",
    ".md2s-quiz-stem { font-size: 16px; line-height: 1.7; margin-bottom: 14px; }",
    ".md2s-quiz-opt { display: flex; gap: 8px; padding: 9px 12px; margin-bottom: 8px;",
    "  border: 1px solid #e3e8ee; border-radius: 8px; font-size: 14px; line-height: 1.5; }",
    ".md2s-quiz-opt b { color: #5b6b7c; }",
    ".md2s-quiz-opt.md2s-quiz-correct { border-color: #2b8a3e; background: #e9f7ec; }",
    ".md2s-quiz-opt.md2s-quiz-correct b { color: #2b8a3e; }",
    ".md2s-quiz-answer { margin-top: 12px; font-size: 14px; color: #2b8a3e; }",
    ".md2s-quiz-clock { font-size: 44px; font-weight: 700; color: #1f3a5f;",
    "  text-align: center; font-variant-numeric: tabular-nums; }",
    ".md2s-quiz-clock.done { font-size: 26px; color: #2b8a3e; }",
    ".md2s-quiz-prog { height: 8px; background: #e3e8ee; border-radius: 4px; overflow: hidden; }",
    ".md2s-quiz-prog i { display: block; height: 100%; background: #2b6cb0; }",
    ".md2s-quiz-stat { font-size: 14px; color: #5b6b7c; text-align: center; }",
    ".md2s-quiz-stat b { color: #1f3a5f; font-size: 16px; }",
    ".md2s-quiz-hint { font-size: 12px; color: #8a97a5; text-align: center; }",
    ".md2s-quiz-dist { display: flex; flex-direction: column; gap: 6px; }",
    ".md2s-quiz-drow { display: flex; align-items: center; gap: 8px; }",
    ".md2s-quiz-drow .dletter { width: 18px; font-size: 13px; color: #5b6b7c; text-align: center; }",
    ".md2s-quiz-drow.md2s-quiz-correct .dletter { color: #2b8a3e; font-weight: 700; }",
    ".md2s-quiz-drow .dbar { flex: 1; height: 14px; background: #e9edf2; border-radius: 4px; overflow: hidden; }",
    ".md2s-quiz-drow .dbar i { display: block; height: 100%; background: #7c93ad; }",
    ".md2s-quiz-drow.md2s-quiz-correct .dbar i { background: #2b8a3e; }",
    ".md2s-quiz-drow .dcount { width: 24px; font-size: 13px; color: #33414f; text-align: right; }",
    ".md2s-quiz-close { position: absolute; top: 14px; right: 18px; border: 0;",
    "  border-radius: 50%; width: 32px; height: 32px; font-size: 18px;",
    "  background: rgba(255, 255, 255, 0.85); color: #33414f; cursor: pointer; }"
  ];
  var quizCssInjected = false;
  var injectQuizCss = function () {
    if (quizCssInjected) return;
    var style = document.createElement("style");
    style.id = QUIZ_CSS_ID;
    style.textContent = QUIZ_CSS.join("\n");
    document.head.appendChild(style);
    quizCssInjected = true;
  };

  var letterOf = function (i) { return String.fromCharCode(65 + i); };

  /* 讲义 DOM 里的题目是公开信息（题干/选项就在幻灯片上），页面侧自己读——
     参考 kit/quiz/panel.js 的 readQuizzes。这样点发题浮层左侧立刻有题目，
     不必空等宿主回填 quiz-state（宿主一卡就永远停在"等待发题…"）。
     答案不在这里读：揭晓的正确答案只认宿主投影，页面侧不能提前泄题。 */
  var quizTextOf = function (el) {
    if (!el) return "";
    if (!el.querySelector || !el.querySelector(".katex")) return (el.textContent || "").trim();
    // KaTeX 一份公式渲染出三份内容（MathML + katex-html + annotation），
    // 直接 textContent 会把公式重复三遍；换回 $tex$ 才是作者写的原文。
    var clone = el.cloneNode(true);
    var nodes = clone.querySelectorAll(".katex");
    for (var i = 0; i < nodes.length; i++) {
      var ann = nodes[i].querySelector("annotation");
      var tex = ann ? (ann.textContent || "") : "";
      nodes[i].replaceWith(clone.ownerDocument.createTextNode(tex ? "$" + tex + "$" : ""));
    }
    return (clone.textContent || "").trim();
  };
  var readQuizFromDom = function (questionKey) {
    if (!questionKey) return null;
    var escKey = String(questionKey).replace(/["\\]/g, "\\$&");
    var stemEl = document.querySelector('[data-md2s-quiz="' + escKey + '"]');
    if (!stemEl) return null;
    var optionsEl = document.querySelector('[data-md2s-quiz-options="' + escKey + '"]');
    var options = [];
    if (optionsEl) {
      Array.prototype.forEach.call(optionsEl.children, function (li) {
        if (li.tagName !== "LI") return;
        var t = quizTextOf(li);
        if (t) options.push(t);
      });
    }
    var limitSec = 30;
    try {
      var meta = JSON.parse(stemEl.getAttribute("data-md2s-quiz-meta") || "{}");
      if (Number(meta.limit) > 0) limitSec = Number(meta.limit);
    } catch (e) { /* 题面 meta 坏了就用默认限时，不让浮层开不出来 */ }
    return {
      questionKey: questionKey,
      stem: quizTextOf(stemEl),
      options: options,
      limitSec: limitSec
    };
  };

  /* 题干旁注入「发题」按钮（幂等）；quiz-capability 关闭时整体移除。 */
  var decorateQuizButtons = function () {
    var stems = document.querySelectorAll("[data-md2s-quiz]");
    Array.prototype.forEach.call(stems, function (stemEl) {
      var key = stemEl.getAttribute("data-md2s-quiz");
      if (!key) return;
      var next = stemEl.nextElementSibling;
      if (next && next.classList && next.classList.contains("md2s-quiz-launch")) return; // 已注入
      var btn = document.createElement("button");
      btn.className = "md2s-quiz-launch";
      btn.setAttribute("data-quiz-key", key);
      btn.textContent = "发题";
      btn.addEventListener("click", function () { requestQuizOpen(key); });
      stemEl.insertAdjacentElement("afterend", btn);
    });
  };
  var removeQuizButtons = function () {
    Array.prototype.forEach.call(document.querySelectorAll(".md2s-quiz-launch"), function (b) { b.remove(); });
  };
  var updateQuizButtons = function () {
    var running = quizState && quizState.phase === "running";
    Array.prototype.forEach.call(document.querySelectorAll(".md2s-quiz-launch"), function (b) {
      b.disabled = !!running;
      b.textContent = running ? "答题中…" : "发题";
    });
  };

  var requestQuizOpen = function (questionKey) {
    // 揭晓后重按同题按钮 = 重看结果浮层（不重复发题），沿用现有揭晓态
    if (quizState && quizState.phase === "revealed" && quizState.questionKey === questionKey) {
      openQuizOverlay(questionKey);
      return;
    }
    // 参考 kit/quiz/panel.js：题目是讲义 DOM 里的公开信息，页面侧直接读来渲染浮层左侧。
    // 绝不把 quizState 清空成 null —— 那是"等待发题…"卡死的根因：宿主 quiz-state
    // 一来晚/一来空，浮层就永远没题目。宿主数据到达后只覆盖实况与本班显示序选项。
    var local = readQuizFromDom(questionKey) || { questionKey: questionKey };
    quizState = Object.assign({ phase: "idle" }, local);
    openQuizOverlay(questionKey);
    post({ type: "md2s:quiz-open", questionKey: questionKey });
  };

  /* 两栏浮层：左题右实况。phase/数据由 md2s:quiz-state 投影驱动，页面纯展示。 */
  var openQuizOverlay = function (questionKey) {
    injectQuizCss();
    if (quizOverlay) closeQuizOverlay();
    quizState = quizState || { phase: "idle", questionKey: questionKey };
    quizState.questionKey = questionKey;
    var el = document.createElement("div");
    el.className = "md2s-quiz-ov";
    el.innerHTML =
      '<div class="md2s-quiz-card">' +
      '  <div class="md2s-quiz-l">' +
      '    <div class="md2s-quiz-head"><span class="md2s-quiz-key"></span>' +
      '      <span class="md2s-quiz-limit" style="display:none"></span></div>' +
      '    <div class="md2s-quiz-stem">正在发题…</div>' +
      '    <div class="md2s-quiz-opts"></div>' +
      '    <div class="md2s-quiz-answer" style="display:none"></div>' +
      "  </div>" +
      '  <div class="md2s-quiz-r">' +
      '    <div class="md2s-quiz-clock" style="display:none"></div>' +
      '    <div class="md2s-quiz-prog" style="display:none"><i></i></div>' +
      '    <div class="md2s-quiz-stat" style="display:none"></div>' +
      '    <div class="md2s-quiz-dist" style="display:none"></div>' +
      '    <div class="md2s-quiz-hint">Esc 关闭浮层 · 浮层开着不翻页</div>' +
      "  </div>" +
      "</div>" +
      '<button class="md2s-quiz-close" title="关闭浮层（Esc）——放映继续">×</button>';
    document.body.appendChild(el);
    quizOverlay = { el: el, questionKey: questionKey };
    el.querySelector(".md2s-quiz-close").addEventListener("click", function () { closeQuizOverlay(); });
    el.addEventListener("click", function (ev) { if (ev.target === el) closeQuizOverlay(); });
    renderQuizOverlay();
    document.addEventListener("keydown", onQuizKey, true);
  };
  var closeQuizOverlay = function () {
    if (!quizOverlay) return;
    quizOverlay.el.remove();
    quizOverlay = null;
    if (quizTick) { clearInterval(quizTick); quizTick = null; }
    document.removeEventListener("keydown", onQuizKey, true);
    post({ type: "md2s:quiz-close", questionKey: quizState ? quizState.questionKey : null });
  };

  /* 模态锁页：浮层开着，翻页笔/导航键一律吞掉——题目做完才往下讲。 */
  var QUIZ_SWALLOW = {
    PageUp: 1, PageDown: 1, ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1,
    Home: 1, End: 1, " ": 1, Spacebar: 1, Enter: 1
  };
  var onQuizKey = function (ev) {
    if (!quizOverlay) return;
    if (ev.key === "Escape") { closeQuizOverlay(); }
    else if (!QUIZ_SWALLOW[ev.key]) return;
    if (ev.cancelable) ev.preventDefault();
    ev.stopPropagation();
  };

  var renderQuizOverlay = function () {
    if (!quizOverlay || !quizState) return;
    var st = quizState;
    var root = quizOverlay.el;
    var qkey = root.querySelector(".md2s-quiz-key");
    var limit = root.querySelector(".md2s-quiz-limit");
    var stem = root.querySelector(".md2s-quiz-stem");
    var opts = root.querySelector(".md2s-quiz-opts");
    var answer = root.querySelector(".md2s-quiz-answer");
    var clock = root.querySelector(".md2s-quiz-clock");
    var prog = root.querySelector(".md2s-quiz-prog");
    var stat = root.querySelector(".md2s-quiz-stat");
    var dist = root.querySelector(".md2s-quiz-dist");
    qkey.textContent = st.questionKey || "—";
    if (st.phase === "error") {
      stem.textContent = st.message || "发题失败";
      opts.innerHTML = "";
      answer.style.display = "none";
      clock.style.display = "none";
      prog.style.display = "none";
      stat.style.display = "none";
      dist.style.display = "none";
      return;
    }
    stem.textContent = st.stem || "等待发题…";
    limit.style.display = st.phase === "running" ? "" : "none";
    limit.textContent = "限时 " + (st.limitSec || 30) + "s";
    // 选项（本班显示序，与学生看到的一致）；揭晓后正确项标绿
    opts.innerHTML = "";
    (st.options || []).forEach(function (opt, i) {
      var li = document.createElement("div");
      li.className = "md2s-quiz-opt" +
        (st.reveal && st.reveal.answer === letterOf(i) ? " md2s-quiz-correct" : "");
      var b = document.createElement("b");
      b.textContent = letterOf(i) + ".";
      var span = document.createElement("span");
      span.textContent = opt;
      li.appendChild(b);
      li.appendChild(span);
      opts.appendChild(li);
    });
    if (st.reveal) {
      answer.style.display = "";
      answer.innerHTML = "正确答案 <b>" + String(st.reveal.answer || "—") + "</b>";
    } else {
      answer.style.display = "none";
    }
    if (st.phase === "running") {
      clock.style.display = "";
      clock.className = "md2s-quiz-clock";
      clock.textContent = (st.remainingSec || 0) + "s";
      prog.style.display = "";
      var ratio = st.limitSec ? Math.max(0, Math.min(100, ((st.remainingSec || 0) / st.limitSec) * 100)) : 0;
      prog.querySelector("i").style.width = ratio.toFixed(1) + "%";
      stat.style.display = "";
      stat.innerHTML = "在线 <b>" + (st.online || 0) + "</b> · 已答 <b>" + (st.answered || 0) + "</b>";
      dist.style.display = "none";
      if (!quizTick) {
        quizTick = setInterval(function () {
          if (quizState && quizState.phase === "running" && quizState.remainingSec > 0) {
            quizState.remainingSec -= 1;
            if (quizOverlay) {
              var clk = quizOverlay.el.querySelector(".md2s-quiz-clock");
              if (clk) clk.textContent = quizState.remainingSec + "s";
            }
          }
        }, 1000);
      }
    } else if (st.phase === "revealed") {
      clock.style.display = "";
      clock.className = "md2s-quiz-clock done";
      clock.textContent = "已揭晓";
      prog.style.display = "none";
      var dist0 = (st.reveal && st.reveal.distribution) || [];
      var total = dist0.reduce(function (a, b) { return a + b; }, 0);
      var ai = st.reveal && st.reveal.answer ? st.reveal.answer.charCodeAt(0) - 65 : -1;
      var correct = ai >= 0 ? (dist0[ai] || 0) : 0;
      stat.style.display = "";
      stat.innerHTML = "正确率 <b>" + (total ? Math.round((correct / total) * 100) : 0) + "%</b>" +
        (st.reveal && st.reveal.fastest && st.reveal.fastest.durationMs
          ? " · 最快 " + (st.reveal.fastest.studentNo || "—") + "（" + (st.reveal.fastest.durationMs / 1000).toFixed(1) + "s）"
          : "");
      dist.style.display = "";
      dist.innerHTML = "";
      dist0.forEach(function (count, i) {
        var row = document.createElement("div");
        row.className = "md2s-quiz-drow" + (st.reveal.answer === letterOf(i) ? " md2s-quiz-correct" : "");
        var l = document.createElement("span"); l.className = "dletter"; l.textContent = letterOf(i);
        var bar = document.createElement("span"); bar.className = "dbar";
        var fill = document.createElement("i");
        var max = Math.max.apply(null, [1].concat(dist0));
        fill.style.width = Math.round(((count || 0) / max) * 100) + "%";
        bar.appendChild(fill);
        var c = document.createElement("span"); c.className = "dcount"; c.textContent = String(count || 0);
        row.appendChild(l); row.appendChild(bar); row.appendChild(c);
        dist.appendChild(row);
      });
    } else {
      clock.style.display = "none";
      prog.style.display = "none";
      stat.style.display = "";
      stat.innerHTML = st.phase === "idle"
        ? "正在发题 · 等待同学作答…"
        : "等待实况…";
      dist.style.display = "none";
    }
    updateQuizButtons();
  };

  var handleQuizState = function (d) {
    // 宿主只负责实况 + 本班显示序选项。它若没读到题（题列表未加载 / sessionId 被清），
    // stem/options 会是空——这时保留本地 DOM 读来的题目，别把浮层左侧打回"等待发题…"。
    var prev = quizState || {};
    var merged = Object.assign({}, prev, d || {});
    if (!merged.stem && prev.stem) merged.stem = prev.stem;
    if ((!merged.options || !merged.options.length) && prev.options && prev.options.length) {
      merged.options = prev.options;
    }
    if (d && d.questionKey == null && prev.questionKey) merged.questionKey = prev.questionKey;
    quizState = merged;
    if (quizOverlay) renderQuizOverlay();
    updateQuizButtons();
  };


  // ── 消息入口 ────────────────────────────────────────────────────────────

  window.addEventListener("message", function (ev) {
    if (ev.source !== window.parent) return;
    var d = ev.data;
    if (!d || typeof d !== "object") return;
    switch (d.type) {
      case "md2s:quiz-capability":
        quizEnabled = d.enabled === true;
        if (quizEnabled) decorateQuizButtons(); else removeQuizButtons();
        break;
      case "md2s:quiz-state":
        handleQuizState(d);
        break;
      case "md2s:quiz-close":
        // 页面浮层已自行关闭（协议对称通知），无动作
        break;
      case "md2s:exec-capability":
        // 重建（改字 / 换主题）会换掉整份 DOM 与 section 引用：丢掉旧浮层再装饰。
        closeOverlay();
        decorate(d);
        break;
      case "md2s:exec-state":
        handleState(d.reqId, d.event);
        break;
      case "md2s:exec-result":
        handleResult(d.reqId, d.result);
        break;
      case "md2s:exec-error":
        handleError(d.reqId, d.error);
        break;
      case "md2s:follow":
        applyFollow(d);
        break;
      case "md2s:export":
        // 出片前收掉结果条（▶ 本身由既有 [data-md2s-activatable] 规则排除）。
        closeOverlay();
        break;
      default:
        break;
    }
  });

  // 其它浮层（图片查看器等）打开时礼貌让位——Esc 归它，不两个一起抢。
  window.addEventListener("md2s-overlay-dismiss", function (ev) {
    if (ev.detail && ev.detail.by !== "exec") closeOverlay();
  });
})();
